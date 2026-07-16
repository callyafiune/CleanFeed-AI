import { PriorityQueue } from "@/queue/priority-queue";
import { TaskRegistry, type TaskState } from "@/queue/task-registry";

export type TaskVisibility = "visible" | "near" | "hidden";

export interface InferenceQueueTask {
  id: string;
  textHash: string;
  modelId: string;
  settingsFingerprint: string;
  platform: string;
  manual: boolean;
  visibility: TaskVisibility;
  distancePx: number;
  createdAt: number;
  expiresAt: number;
}

export interface InferenceQueueStats {
  queued: number;
  running: number;
  completed: number;
  cancelled: number;
  expired: number;
  failed: number;
}

export interface InferenceQueueOptions<TResult> {
  run(task: InferenceQueueTask): Promise<TResult>;
  cancelRunner?(requestId: string): void;
  maximumSize?: number;
  concurrency?: number;
  now?: () => number;
}

interface Deferred<TResult> {
  resolve(result: TResult): void;
  reject(error: Error): void;
}

interface WorkItem<TResult> {
  task: InferenceQueueTask;
  key: string;
  listeners: Map<string, Deferred<TResult>>;
  state: TaskState;
}

const MAXIMUM_POSTS_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60_000;

export class InferenceQueue<TResult> {
  private readonly maximumSize: number;
  private readonly concurrency: number;
  private readonly now: () => number;
  private readonly pending = new PriorityQueue<WorkItem<TResult>>(
    (left, right) => compareTasks(left.task, right.task),
  );
  private readonly registry = new TaskRegistry<InferenceQueueTask>();
  private readonly workByKey = new Map<string, WorkItem<TResult>>();
  private readonly workByTaskId = new Map<string, WorkItem<TResult>>();
  private readonly running = new Set<WorkItem<TResult>>();
  private readonly startedByPlatform = new Map<string, number[]>();
  private readonly totals: InferenceQueueStats = {
    queued: 0,
    running: 0,
    completed: 0,
    cancelled: 0,
    expired: 0,
    failed: 0,
  };
  private pumpScheduled = false;
  private rateLimitTimer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;

  constructor(private readonly options: InferenceQueueOptions<TResult>) {
    this.maximumSize = options.maximumSize ?? 100;
    this.concurrency = options.concurrency ?? 1;
    this.now = options.now ?? Date.now;
    if (!Number.isInteger(this.maximumSize) || this.maximumSize < 1) {
      throw new RangeError("maximumSize must be a positive integer");
    }
    if (!Number.isInteger(this.concurrency) || this.concurrency < 1) {
      throw new RangeError("concurrency must be a positive integer");
    }
  }

  get size(): number {
    return this.pending.size + this.running.size;
  }

  enqueue(task: InferenceQueueTask): Promise<TResult> {
    if (this.disposed) {
      return Promise.reject(abortError());
    }
    if (this.registry.has(task.id)) {
      return Promise.reject(new Error(`Task already exists: ${task.id}`));
    }

    const deferred = createDeferred<TResult>();
    this.registry.add(task);

    if (task.expiresAt <= this.now()) {
      this.registry.setState(task.id, "expired");
      this.totals.expired += 1;
      deferred.reject(abortError());
      return deferred.promise;
    }

    const key = dedupeKey(task);
    const duplicate = this.workByKey.get(key);
    if (duplicate) {
      duplicate.listeners.set(task.id, deferred);
      this.workByTaskId.set(task.id, duplicate);
      this.schedulePump();
      return deferred.promise;
    }

    const work: WorkItem<TResult> = {
      task,
      key,
      listeners: new Map([[task.id, deferred]]),
      state: "queued",
    };
    this.workByKey.set(key, work);
    this.workByTaskId.set(task.id, work);
    this.pending.push(work);
    this.enforceMaximumSize();
    this.schedulePump();
    return deferred.promise;
  }

  cancel(requestId: string): boolean {
    const work = this.workByTaskId.get(requestId);
    if (!work) {
      return false;
    }

    if (work.state === "queued") {
      this.cancelListener(work, requestId);
      if (work.listeners.size === 0) {
        this.pending.remove((candidate) => candidate === work);
        this.forgetWork(work);
      }
      this.schedulePump();
      return true;
    }

    if (work.state === "running") {
      this.cancelListener(work, requestId);
      this.options.cancelRunner?.(requestId);
      return true;
    }

    return false;
  }

  pendingIds(): string[] {
    return this.pending.values().flatMap((work) => [...work.listeners.keys()]);
  }

  has(requestId: string): boolean {
    return this.workByTaskId.has(requestId);
  }

  stats(): InferenceQueueStats {
    return {
      ...this.totals,
      queued: this.pending.size,
      running: this.running.size,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.rateLimitTimer) {
      clearTimeout(this.rateLimitTimer);
      this.rateLimitTimer = undefined;
    }

    for (const work of [...this.pending.values(), ...this.running]) {
      for (const id of [...work.listeners.keys()]) {
        this.cancelListener(work, id);
        if (work.state === "running") {
          this.options.cancelRunner?.(id);
        }
      }
      this.forgetWork(work);
    }
    this.pending.clear();
  }

  private schedulePump(): void {
    if (this.pumpScheduled || this.disposed) {
      return;
    }
    this.pumpScheduled = true;
    queueMicrotask(() => {
      this.pumpScheduled = false;
      this.pump();
    });
  }

  private pump(): void {
    if (this.disposed) {
      return;
    }
    while (this.running.size < this.concurrency) {
      const work = this.nextWork();
      if (!work) {
        return;
      }
      const waitMs = this.rateLimitWait(work.task.platform);
      if (waitMs > 0) {
        this.pending.push(work);
        this.scheduleRateLimitPump(waitMs);
        return;
      }
      this.start(work);
    }
  }

  private nextWork(): WorkItem<TResult> | undefined {
    const candidates: WorkItem<TResult>[] = [];
    let work: WorkItem<TResult> | undefined;
    while ((work = this.pending.pop())) {
      if (work.listeners.size === 0) {
        continue;
      }
      if (work.task.expiresAt <= this.now()) {
        this.rejectWork(work, "expired", abortError());
        continue;
      }
      candidates.push(work);
    }
    if (candidates.length === 0) {
      return undefined;
    }

    candidates.sort((left, right) =>
      compareTasks(left.task, right.task, this.now()),
    );
    const [next, ...remaining] = candidates;
    for (const candidate of remaining) {
      this.pending.push(candidate);
    }
    return next;
  }

  private start(work: WorkItem<TResult>): void {
    this.recordStart(work.task.platform);
    work.state = "running";
    this.running.add(work);
    this.setWorkState(work, "running");

    void this.options.run(work.task).then(
      (result) => this.resolveWork(work, result),
      (error: unknown) =>
        this.rejectWork(
          work,
          "failed",
          error instanceof Error ? error : new Error("Inference task failed"),
        ),
    );
  }

  private resolveWork(work: WorkItem<TResult>, result: TResult): void {
    this.running.delete(work);
    if (work.listeners.size > 0) {
      for (const [id, listener] of work.listeners) {
        this.registry.setState(id, "completed");
        listener.resolve(result);
      }
      this.totals.completed += work.listeners.size;
    }
    this.forgetWork(work);
    this.schedulePump();
  }

  private rejectWork(
    work: WorkItem<TResult>,
    state: Extract<TaskState, "expired" | "failed">,
    error: Error,
  ): void {
    this.pending.remove((candidate) => candidate === work);
    this.running.delete(work);
    for (const [id, listener] of work.listeners) {
      this.registry.setState(id, state);
      listener.reject(error);
    }
    this.totals[state] += work.listeners.size;
    this.forgetWork(work);
    this.schedulePump();
  }

  private cancelListener(work: WorkItem<TResult>, id: string): void {
    const listener = work.listeners.get(id);
    if (!listener) {
      return;
    }
    work.listeners.delete(id);
    this.workByTaskId.delete(id);
    this.registry.setState(id, "cancelled");
    this.totals.cancelled += 1;
    listener.reject(abortError());
  }

  private enforceMaximumSize(): void {
    while (this.size > this.maximumSize) {
      const pending = this.pending.values();
      const lowest = pending.at(-1);
      if (!lowest) {
        return;
      }
      this.pending.remove((candidate) => candidate === lowest);
      this.rejectWork(lowest, "failed", new Error("Inference queue is full"));
    }
  }

  private rateLimitWait(platform: string): number {
    const now = this.now();
    const starts = this.startedByPlatform.get(platform) ?? [];
    const recent = starts.filter(
      (timestamp) => timestamp > now - RATE_WINDOW_MS,
    );
    this.startedByPlatform.set(platform, recent);
    if (recent.length < MAXIMUM_POSTS_PER_MINUTE) {
      return 0;
    }
    return Math.max(1, recent[0] + RATE_WINDOW_MS - now);
  }

  private recordStart(platform: string): void {
    const starts = this.startedByPlatform.get(platform) ?? [];
    starts.push(this.now());
    this.startedByPlatform.set(platform, starts);
  }

  private scheduleRateLimitPump(waitMs: number): void {
    if (this.rateLimitTimer) {
      return;
    }
    this.rateLimitTimer = setTimeout(() => {
      this.rateLimitTimer = undefined;
      this.schedulePump();
    }, waitMs);
  }

  private setWorkState(work: WorkItem<TResult>, state: TaskState): void {
    for (const id of work.listeners.keys()) {
      this.registry.setState(id, state);
    }
  }

  private forgetWork(work: WorkItem<TResult>): void {
    this.workByKey.delete(work.key);
    for (const id of work.listeners.keys()) {
      this.workByTaskId.delete(id);
    }
  }
}

function compareTasks(
  left: InferenceQueueTask,
  right: InferenceQueueTask,
  now = 0,
): number {
  const priorityDifference = priority(right, now) - priority(left, now);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }
  return left.createdAt - right.createdAt;
}

function priority(task: InferenceQueueTask, now: number): number {
  const base = task.manual ? 1_000 : task.visibility === "visible" ? 100 : 50;
  const aging = Math.floor(Math.max(0, now - task.createdAt) / 1_000);
  const proximity =
    task.visibility === "near" ? 1 / (1 + Math.max(0, task.distancePx)) : 0;
  return base + aging + proximity;
}

function dedupeKey(task: InferenceQueueTask): string {
  return [
    task.textHash,
    task.modelId,
    task.settingsFingerprint,
    task.platform,
  ].join("\u0000");
}

function abortError(): DOMException {
  return new DOMException("Inference task cancelled", "AbortError");
}

function createDeferred<TResult>(): Deferred<TResult> & {
  promise: Promise<TResult>;
} {
  let resolve!: (result: TResult) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<TResult>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}
