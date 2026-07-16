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

interface Subscriber<TResult> {
  task: InferenceQueueTask;
  deferred: Deferred<TResult>;
}

interface WorkItem<TResult> {
  runnerTask: InferenceQueueTask;
  key: string;
  subscribers: Map<string, Subscriber<TResult>>;
  state: "queued" | "running";
  runnerCancellationRequested: boolean;
}

const MAXIMUM_POSTS_PER_MINUTE = 30;
const RATE_WINDOW_MS = 60_000;
const MAX_TIMER_DELAY_MS = 2_147_483_647;

export class InferenceQueue<TResult> {
  private readonly maximumSize: number;
  private readonly concurrency: number;
  private readonly now: () => number;
  private readonly pending = new PriorityQueue<WorkItem<TResult>>(
    (left, right) => compareWork(left, right),
  );
  private readonly registry = new TaskRegistry<InferenceQueueTask>();
  private readonly workByKey = new Map<string, WorkItem<TResult>>();
  private readonly workByTaskId = new Map<string, WorkItem<TResult>>();
  private readonly running = new Set<WorkItem<TResult>>();
  private readonly startedByPlatform = new Map<string, number[]>();
  private readonly totals: InferenceQueueStats = emptyStats();
  private pumpScheduled = false;
  private rateLimitTimer: ReturnType<typeof setTimeout> | undefined;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
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
      this.settleStandalone(task.id, deferred, "expired", expirationError());
      return deferred.promise;
    }

    const key = dedupeKey(task);
    const existing = this.workByKey.get(key);
    if (existing) {
      this.addSubscriber(existing, task, deferred);
      this.scheduleExpiry();
      this.schedulePump();
      return deferred.promise;
    }

    const work: WorkItem<TResult> = {
      runnerTask: task,
      key,
      subscribers: new Map(),
      state: "queued",
      runnerCancellationRequested: false,
    };
    this.addSubscriber(work, task, deferred);
    this.workByKey.set(key, work);
    this.pending.push(work);
    this.enforceMaximumSize();
    this.scheduleExpiry();
    this.schedulePump();
    return deferred.promise;
  }

  cancel(requestId: string): boolean {
    const work = this.workByTaskId.get(requestId);
    if (!work) {
      return false;
    }

    this.settleSubscriber(work, requestId, "cancelled", abortError());
    if (work.subscribers.size === 0) {
      if (work.state === "queued") {
        this.pending.remove((candidate) => candidate === work);
        this.forgetWork(work);
      } else {
        this.cancelRunner(work);
        this.forgetWork(work);
      }
    }
    this.scheduleExpiry();
    this.schedulePump();
    return true;
  }

  pendingIds(): string[] {
    return this.pending
      .values()
      .flatMap((work) => [...work.subscribers.keys()]);
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
    this.clearTimers();

    const activeWork = new Set([
      ...this.pending.values(),
      ...this.running.values(),
    ]);
    for (const work of activeWork) {
      if (work.state === "running") {
        this.cancelRunner(work);
      }
      for (const id of [...work.subscribers.keys()]) {
        this.settleSubscriber(work, id, "cancelled", abortError());
      }
    }

    this.pending.clear();
    this.running.clear();
    this.workByKey.clear();
    this.workByTaskId.clear();
    this.registry.clear();
    this.startedByPlatform.clear();
    Object.assign(this.totals, emptyStats());
  }

  private addSubscriber(
    work: WorkItem<TResult>,
    task: InferenceQueueTask,
    deferred: Deferred<TResult>,
  ): void {
    work.subscribers.set(task.id, { task, deferred });
    this.workByTaskId.set(task.id, work);
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
    this.expireDueSubscribers();
    while (this.running.size < this.concurrency) {
      const work = this.nextEligibleWork();
      if (!work) {
        return;
      }
      this.start(work);
    }
  }

  private nextEligibleWork(): WorkItem<TResult> | undefined {
    const candidates = this.drainPending();
    if (candidates.length === 0) {
      return undefined;
    }

    let next: WorkItem<TResult> | undefined;
    let shortestWait: number | undefined;
    for (const candidate of candidates) {
      const wait = this.rateLimitWait(candidate.runnerTask.platform);
      if (!next && wait === 0) {
        next = candidate;
        continue;
      }
      this.pending.push(candidate);
      if (wait > 0) {
        shortestWait = Math.min(shortestWait ?? wait, wait);
      }
    }
    if (shortestWait !== undefined) {
      this.scheduleRateLimitPump(shortestWait);
    }
    return next;
  }

  private drainPending(): WorkItem<TResult>[] {
    const candidates: WorkItem<TResult>[] = [];
    let work: WorkItem<TResult> | undefined;
    while ((work = this.pending.pop())) {
      if (work.subscribers.size === 0) {
        this.forgetWork(work);
        continue;
      }
      this.expireWorkSubscribers(work);
      if (work.subscribers.size > 0) {
        candidates.push(work);
      }
    }
    return candidates.sort((left, right) =>
      compareWork(left, right, this.now()),
    );
  }

  private start(work: WorkItem<TResult>): void {
    this.recordStart(work.runnerTask.platform);
    work.state = "running";
    this.running.add(work);
    for (const id of work.subscribers.keys()) {
      this.registry.setState(id, "running");
    }

    void this.options.run(work.runnerTask).then(
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
    for (const id of [...work.subscribers.keys()]) {
      this.resolveSubscriber(work, id, result);
    }
    this.forgetWork(work);
    this.scheduleExpiry();
    this.schedulePump();
  }

  private rejectWork(
    work: WorkItem<TResult>,
    state: Extract<TaskState, "failed">,
    error: Error,
  ): void {
    this.pending.remove((candidate) => candidate === work);
    this.running.delete(work);
    for (const id of [...work.subscribers.keys()]) {
      this.settleSubscriber(work, id, state, error);
    }
    this.forgetWork(work);
    this.scheduleExpiry();
    this.schedulePump();
  }

  private resolveSubscriber(
    work: WorkItem<TResult>,
    id: string,
    result: TResult,
  ): void {
    const subscriber = work.subscribers.get(id);
    if (!subscriber) {
      return;
    }
    work.subscribers.delete(id);
    this.workByTaskId.delete(id);
    this.registry.setState(id, "completed");
    this.registry.delete(id);
    this.totals.completed += 1;
    subscriber.deferred.resolve(result);
  }

  private settleSubscriber(
    work: WorkItem<TResult>,
    id: string,
    state: Exclude<TaskState, "queued" | "running" | "completed">,
    error: Error,
  ): void {
    const subscriber = work.subscribers.get(id);
    if (!subscriber) {
      return;
    }
    work.subscribers.delete(id);
    this.workByTaskId.delete(id);
    this.registry.setState(id, state);
    this.registry.delete(id);
    this.totals[state] += 1;
    subscriber.deferred.reject(error);
  }

  private settleStandalone(
    id: string,
    deferred: Deferred<TResult>,
    state: Extract<TaskState, "expired">,
    error: Error,
  ): void {
    this.registry.setState(id, state);
    this.registry.delete(id);
    this.totals[state] += 1;
    deferred.reject(error);
  }

  private expireDueSubscribers(): void {
    for (const work of new Set(this.workByKey.values())) {
      this.expireWorkSubscribers(work);
    }
    this.scheduleExpiry();
  }

  private expireWorkSubscribers(work: WorkItem<TResult>): void {
    for (const [id, subscriber] of [...work.subscribers]) {
      if (subscriber.task.expiresAt <= this.now()) {
        this.settleSubscriber(work, id, "expired", expirationError());
      }
    }
    if (work.subscribers.size !== 0) {
      return;
    }
    if (work.state === "queued") {
      this.pending.remove((candidate) => candidate === work);
      this.forgetWork(work);
    } else {
      this.cancelRunner(work);
      this.forgetWork(work);
    }
  }

  private enforceMaximumSize(): void {
    while (this.size > this.maximumSize) {
      const lowest = this.pending.values().at(-1);
      if (!lowest) {
        return;
      }
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

  private cancelRunner(work: WorkItem<TResult>): void {
    if (work.runnerCancellationRequested) {
      return;
    }
    work.runnerCancellationRequested = true;
    this.options.cancelRunner?.(work.runnerTask.id);
  }

  private scheduleRateLimitPump(waitMs: number): void {
    if (this.rateLimitTimer || this.disposed) {
      return;
    }
    this.rateLimitTimer = setTimeout(() => {
      this.rateLimitTimer = undefined;
      this.schedulePump();
    }, waitMs);
  }

  private scheduleExpiry(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
    if (this.disposed) {
      return;
    }

    let nextExpiry: number | undefined;
    for (const work of this.workByKey.values()) {
      for (const subscriber of work.subscribers.values()) {
        nextExpiry = Math.min(
          nextExpiry ?? subscriber.task.expiresAt,
          subscriber.task.expiresAt,
        );
      }
    }
    if (nextExpiry === undefined) {
      return;
    }
    const delay = nextExpiry - this.now();
    this.expiryTimer = setTimeout(
      () => {
        this.expiryTimer = undefined;
        this.expireDueSubscribers();
        this.schedulePump();
      },
      Math.min(MAX_TIMER_DELAY_MS, Math.max(0, delay)),
    );
  }

  private forgetWork(work: WorkItem<TResult>): void {
    if (this.workByKey.get(work.key) === work) {
      this.workByKey.delete(work.key);
    }
    for (const id of work.subscribers.keys()) {
      this.workByTaskId.delete(id);
    }
  }

  private clearTimers(): void {
    if (this.rateLimitTimer) {
      clearTimeout(this.rateLimitTimer);
      this.rateLimitTimer = undefined;
    }
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = undefined;
    }
  }
}

function compareWork<TResult>(
  left: WorkItem<TResult>,
  right: WorkItem<TResult>,
  now = 0,
): number {
  const priorityDifference = workPriority(right, now) - workPriority(left, now);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }
  return oldestCreatedAt(left) - oldestCreatedAt(right);
}

function workPriority<TResult>(work: WorkItem<TResult>, now: number): number {
  return Math.max(
    ...[...work.subscribers.values()].map(({ task }) =>
      taskPriority(task, now),
    ),
  );
}

function oldestCreatedAt<TResult>(work: WorkItem<TResult>): number {
  return Math.min(
    ...[...work.subscribers.values()].map(({ task }) => task.createdAt),
  );
}

function taskPriority(task: InferenceQueueTask, now: number): number {
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

function expirationError(): DOMException {
  return new DOMException("Inference task expired", "TimeoutError");
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

function emptyStats(): InferenceQueueStats {
  return {
    queued: 0,
    running: 0,
    completed: 0,
    cancelled: 0,
    expired: 0,
    failed: 0,
  };
}
