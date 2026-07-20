import {
  buildBuiltinDecision,
  buildBuiltinEvidence,
  buildBuiltinIdentity,
} from "@/inference/builtin-runtime";
import {
  CircuitBreaker,
  type CircuitBreakerFailureCode,
} from "@/inference/circuit-breaker";
import type { ModelRuntime } from "@/inference/model-runtime";
import { CleanFeedError } from "@/shared/errors";
import type { ClassificationRequest } from "@/shared/messages";
import type { UserSettings } from "@/shared/settings-types";
import type {
  Backend,
  ClassificationResult,
  DecisionReasonCode,
  ModelStatus,
  RuntimeModelIdentity,
} from "@/shared/types";
import {
  parseWorkerResponse,
  type WorkerInitializePayload,
  type WorkerRequest,
  type WorkerResponse,
} from "@/inference/worker-protocol";

export type WorkerClassificationRequest = ClassificationRequest & {
  requestId: string;
  settings?: UserSettings;
};

interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

export interface WorkerClassifierClient {
  classify(request: WorkerClassificationRequest): Promise<ClassificationResult>;
}

type PendingRequest = {
  resolve: (result: ClassificationResult) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
  request: WorkerClassificationRequest;
};

/** Bridges the offscreen document to its one dedicated inference worker. */
export class WorkerHost implements WorkerClassifierClient {
  private worker: WorkerLike;
  private workerAvailable = true;
  private disposed = false;
  private lastInitialization:
    { paths: WorkerInitializePayload; requestId: string } | undefined;
  private modelStatus: ModelStatus = inactiveModelStatus("initializing");
  private cancelledTasks = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly batchQueue: WorkerClassificationRequest[] = [];
  private readonly running = new Set<string>();
  private batchTimer?: ReturnType<typeof setTimeout>;

  constructor(
    private readonly createWorker: () => WorkerLike = () =>
      new Worker(new URL("../inference/inference-worker.ts", import.meta.url), {
        type: "module",
      }),
    private supportsBatching = false,
  ) {
    this.worker = this.createWorker();
    this.attachWorker(this.worker);
  }

  private attachWorker(worker: WorkerLike): void {
    worker.onmessage = (event) => {
      if (this.worker === worker) this.handleMessage(event.data);
    };
    worker.onerror = () => {
      if (this.worker === worker) this.failWorker();
    };
  }

  classify(
    request: WorkerClassificationRequest,
  ): Promise<ClassificationResult> {
    if (!this.workerAvailable) return Promise.reject(workerUnavailableError());
    if (this.pending.has(request.requestId))
      return Promise.reject(
        new CleanFeedError("INVALID_MESSAGE", "DUPLICATE_WORKER_REQUEST"),
      );

    return new Promise<ClassificationResult>((resolve, reject) => {
      const timeout = setTimeout(
        () => this.timeout(request.requestId),
        request.settings?.inferenceTimeoutMs ?? 20_000,
      );
      this.pending.set(request.requestId, {
        resolve,
        reject,
        timeout,
        request,
      });
      this.enqueueOrPost(request);
    });
  }

  cancel(requestId: string): boolean {
    const pending = this.settle(requestId);
    if (pending === undefined) return false;
    this.removeQueued(requestId);
    this.running.delete(requestId);
    this.cancelledTasks += 1;
    this.postCancel(requestId);
    pending.reject(new DOMException("Inference task cancelled", "AbortError"));
    return true;
  }

  stats(): { cancelledTasks: number } {
    return { cancelledTasks: this.cancelledTasks };
  }

  initialize(
    paths: WorkerInitializePayload,
    requestId = "worker-initialize",
  ): void {
    if (!this.workerAvailable) return;
    this.lastInitialization = { paths, requestId };
    this.postInitialize();
  }

  private postInitialize(): void {
    const initialization = this.lastInitialization;
    if (!this.workerAvailable || initialization === undefined) return;
    try {
      this.worker.postMessage({
        type: "INITIALIZE",
        requestId: initialization.requestId,
        payload: initialization.paths,
      });
    } catch {
      /* worker loss is best-effort */
    }
  }

  status(requestId = "worker-status"): void {
    this.postControl("STATUS", requestId);
  }

  getModelStatus(): ModelStatus {
    this.status(`worker-status-${Date.now()}`);
    return { ...this.modelStatus };
  }

  dispose(): void {
    this.disposed = true;
    this.rejectAll();
    if (this.workerAvailable) {
      this.postControl("DISPOSE", "worker-dispose");
      this.workerAvailable = false;
      this.worker.terminate();
      this.modelStatus = inactiveModelStatus("unavailable");
    }
  }

  private handleMessage(rawMessage: unknown): void {
    let message: WorkerResponse;
    try {
      message = parseWorkerResponse(rawMessage);
    } catch (error) {
      this.failWorker(error);
      return;
    }
    if (message.type === "STATUS") {
      this.supportsBatching =
        message.payload.state === "ready"
          ? (message.payload.supportsBatching ?? false)
          : false;
      this.modelStatus = normalizeModelStatus(message.payload);
    }
    const pending = this.settle(message.requestId);
    this.running.delete(message.requestId);
    if (pending === undefined) return;
    if (message.type === "RESULT") {
      pending.resolve(message.payload);
      return;
    }
    if (message.type === "CANCELLED") {
      this.cancelledTasks += 1;
      pending.reject(
        new DOMException("Inference task cancelled", "AbortError"),
      );
      return;
    }
    if (message.type === "STATUS") return;
    pending.reject(
      new CleanFeedError(
        message.payload.code,
        message.payload.message,
        message.payload.recoverable,
      ),
    );
  }

  private timeout(requestId: string): void {
    const pending = this.pending.get(requestId);
    if (pending === undefined) return;
    if (this.running.has(requestId) && this.lastInitialization !== undefined) {
      this.recoverFromHardTimeout();
      return;
    }
    this.settle(requestId);
    this.removeQueued(requestId);
    this.postCancel(requestId);
    const wordCount = pending.request.text
      .trim()
      .split(/\s+/u)
      .filter(Boolean).length;
    pending.resolve({
      aiScore: 0,
      humanScore: 0,
      confidence: "low",
      status: "classification_failed",
      wordCount,
      tokenCount: 0,
      // No classifier produced this result; carry the active fallback builtin's
      // identity (spec's conservative choice for a no-output timeout/error).
      runtimeIdentity: buildBuiltinIdentity({
        id: "stylometric-v1",
        version: "unavailable",
      }),
      evidence: buildBuiltinEvidence(pending.request.text, {
        quality: "unsupported",
        coverage: 0,
        reasonCodes: ["BACKEND_ERROR"],
      }),
      decision: buildBuiltinDecision({
        status: "classification_failed",
        calibratedScore: 0,
        abstained: true,
        reasonCodes: ["BACKEND_ERROR"],
      }),
      modelVersion: "unavailable",
      modelId: "unavailable",
      backend: "mock",
      processingTimeMs: pending.request.settings?.inferenceTimeoutMs ?? 20_000,
      errorCode: "INFERENCE_TIMEOUT",
      demo: true,
    });
  }

  private settle(requestId: string): PendingRequest | undefined {
    const pending = this.pending.get(requestId);
    if (pending !== undefined) {
      clearTimeout(pending.timeout);
      this.pending.delete(requestId);
    }
    return pending;
  }

  private postCancel(requestId: string): void {
    if (!this.workerAvailable) return;
    try {
      this.worker.postMessage({ type: "CANCEL", requestId, payload: null });
    } catch {
      // The caller was settled before cancellation was sent; worker loss is best-effort.
    }
  }

  private postControl(type: "STATUS" | "DISPOSE", requestId: string): void {
    if (!this.workerAvailable) return;
    try {
      this.worker.postMessage({ type, requestId, payload: null });
    } catch {
      /* worker loss is best-effort */
    }
  }

  private enqueueOrPost(request: WorkerClassificationRequest): void {
    if (!request.settings?.batchingEnabled || !this.supportsBatching) {
      this.postClassification(request);
      return;
    }
    this.batchQueue.push(request);
    this.batchTimer ??= setTimeout(() => this.flushBatch(), 10);
  }

  private flushBatch(): void {
    this.batchTimer = undefined;
    const first = this.batchQueue.shift();
    if (first === undefined) return;
    const batch = [first];
    for (let index = 0; index < this.batchQueue.length && batch.length < 8;) {
      const candidate = this.batchQueue[index]!;
      if (
        candidate.platform === first.platform &&
        JSON.stringify(candidate.settings) === JSON.stringify(first.settings)
      ) {
        batch.push(candidate);
        this.batchQueue.splice(index, 1);
      } else index += 1;
    }
    if (batch.length === 1) this.postClassification(batch[0]!);
    else this.postBatch(batch);
    if (this.batchQueue.length > 0)
      this.batchTimer = setTimeout(() => this.flushBatch(), 10);
  }

  private removeQueued(requestId: string): void {
    const index = this.batchQueue.findIndex(
      (request) => request.requestId === requestId,
    );
    if (index >= 0) this.batchQueue.splice(index, 1);
  }

  private postClassification(request: WorkerClassificationRequest): void {
    try {
      this.running.add(request.requestId);
      this.worker.postMessage({
        type: "CLASSIFY",
        requestId: request.requestId,
        payload: {
          text: request.text,
          platform: request.platform,
          manual: request.manual,
          ...(request.settings === undefined
            ? {}
            : { settings: request.settings }),
        },
      } as WorkerRequest);
    } catch (error) {
      this.running.delete(request.requestId);
      const pending = this.settle(request.requestId);
      pending?.reject(error);
    }
  }

  private postBatch(requests: WorkerClassificationRequest[]): void {
    try {
      for (const request of requests) this.running.add(request.requestId);
      this.worker.postMessage({
        type: "CLASSIFY",
        requestId: requests[0]!.requestId,
        payload: {
          requests: requests.map((request) => ({
            requestId: request.requestId,
            payload: {
              text: request.text,
              platform: request.platform,
              manual: request.manual,
              settings: request.settings,
            },
          })),
        },
      } as WorkerRequest);
    } catch (error) {
      for (const request of requests) {
        this.running.delete(request.requestId);
        this.settle(request.requestId)?.reject(error);
      }
    }
  }

  private rejectAll(reason: unknown = workerUnavailableError()): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
      this.pending.delete(requestId);
      this.running.delete(requestId);
    }
  }

  private failWorker(reason: unknown = workerUnavailableError()): void {
    if (this.workerAvailable) {
      this.workerAvailable = false;
      this.worker.terminate();
    }
    this.modelStatus = inactiveModelStatus("error", ["BACKEND_ERROR"]);
    this.rejectAll(reason);
  }

  private recoverFromHardTimeout(): void {
    if (!this.workerAvailable || this.disposed) return;
    this.workerAvailable = false;
    this.worker.terminate();
    const timeoutError = new CleanFeedError(
      "INFERENCE_TIMEOUT",
      "INFERENCE_TIMEOUT",
    );
    for (const requestId of this.running) {
      this.settle(requestId)?.reject(timeoutError);
    }
    this.running.clear();
    this.modelStatus = inactiveModelStatus("initializing");
    this.worker = this.createWorker();
    this.workerAvailable = true;
    this.attachWorker(this.worker);
    this.postInitialize();
  }
}

// ---------------------------------------------------------------------------
// Primary/fallback lifecycle state machine.
//
// The host runs the TMR primary until it can no longer produce a decision; then
// it makes AT MOST ONE immediate switch to the indicative stylometric fallback.
// The fallback failing is terminal — there is NO automatic path back to TMR, and
// no sequence restarts TMR or oscillates. Concurrent transition requests share
// ONE promise so the fallback is built exactly once.
// ---------------------------------------------------------------------------

export type WorkerHostState =
  | { mode: "primary"; phase: "initializing" | "ready"; runtime: ModelRuntime }
  | {
      mode: "fallback";
      phase: "initializing" | "ready";
      runtime: ModelRuntime;
      reasonCodes: DecisionReasonCode[];
    }
  | { mode: "terminal"; phase: "error"; reasonCodes: DecisionReasonCode[] };

/** Builds the primary (TMR) and fallback (stylometric) runtimes on demand. */
export interface WorkerHostRuntimeFactory {
  primary(): Promise<ModelRuntime>;
  fallback(): Promise<ModelRuntime>;
}

/**
 * Drives the primary→fallback→terminal transitions. The primary factory owns
 * the WebGPU→WASM attempt internally (via the backend selector), so a backend
 * fallback WITHIN TMR keeps the host in `primary`. Only a TMR that cannot
 * initialize — or a TMR worker death — triggers the single switch to fallback.
 */
export class WorkerHostLifecycle {
  private current: WorkerHostState | undefined;
  private transition: Promise<WorkerHostState> | undefined;

  constructor(
    private readonly factory: WorkerHostRuntimeFactory,
    private readonly breaker: CircuitBreaker = new CircuitBreaker(),
  ) {}

  getState(): WorkerHostState {
    if (this.current === undefined) {
      return { mode: "terminal", phase: "error", reasonCodes: ["BACKEND_ERROR"] };
    }
    return this.current;
  }

  /**
   * Records an operational TMR failure against the circuit breaker. The failure
   * that opens the breaker — three eligible failures inside the moving
   * ten-minute window — trips the SINGLE Task-7 transition to the stylometric
   * fallback with a CIRCUIT_BREAKER_OPEN reason, disposing TMR exactly once.
   * Concurrent failures all receive that one shared promise, so twenty racing
   * failures still cause exactly one dispose and one fallback initialization.
   * Non-operational codes never count, and a breaker that opens while already
   * in fallback or terminal does nothing (there is no path back to TMR here).
   */
  recordFailure(
    code: CircuitBreakerFailureCode,
    now: number,
  ): Promise<WorkerHostState> | undefined {
    this.breaker.recordFailure(code, now);
    if (this.breaker.canAttempt(now)) {
      return undefined;
    }
    if (this.transition !== undefined) {
      return this.transition;
    }
    if (this.current?.mode !== "primary") {
      return undefined;
    }
    return this.enterFallback(["CIRCUIT_BREAKER_OPEN"]);
  }

  async initialize(): Promise<WorkerHostState> {
    try {
      const runtime = await this.factory.primary();
      this.current = { mode: "primary", phase: "ready", runtime };
      return this.current;
    } catch {
      return this.enterFallback(["BACKEND_ERROR"]);
    }
  }

  /**
   * Reports a TMR worker death (or an init failure). Transitions to the
   * stylometric fallback exactly once; a death already in fallback is terminal.
   */
  reportWorkerDeath(
    reasonCodes: DecisionReasonCode[] = ["BACKEND_ERROR"],
  ): Promise<WorkerHostState> {
    return this.enterFallback(reasonCodes);
  }

  private enterFallback(
    reasonCodes: DecisionReasonCode[],
  ): Promise<WorkerHostState> {
    if (this.transition !== undefined) {
      return this.transition;
    }
    if (this.current?.mode === "terminal") {
      return Promise.resolve(this.current);
    }
    if (this.current?.mode === "fallback") {
      this.current = { mode: "terminal", phase: "error", reasonCodes };
      return Promise.resolve(this.current);
    }

    const previous = this.current;
    const done = (async (): Promise<WorkerHostState> => {
      if (previous?.mode === "primary") {
        this.current = {
          mode: "fallback",
          phase: "initializing",
          runtime: previous.runtime,
          reasonCodes,
        };
      }
      try {
        const runtime = await this.factory.fallback();
        if (previous?.mode === "primary") {
          await disposeRuntime(previous.runtime);
        }
        this.current = {
          mode: "fallback",
          phase: "ready",
          runtime,
          reasonCodes,
        };
      } catch {
        if (previous?.mode === "primary") {
          await disposeRuntime(previous.runtime);
        }
        this.current = {
          mode: "terminal",
          phase: "error",
          reasonCodes: [...reasonCodes, "BACKEND_ERROR"],
        };
      }
      return this.current;
    })();

    this.transition = done;
    void done.finally(() => {
      if (this.transition === done) this.transition = undefined;
    });
    return done;
  }
}

async function disposeRuntime(runtime: ModelRuntime): Promise<void> {
  try {
    await runtime.classifier.dispose();
  } catch {
    // Disposal is best-effort; a partial session must never block the switch.
  }
}

/** Coordinates the published ModelStatus of the whole runtime SET. */
export interface RuntimeSetStatusInput {
  calibrationCoverage: "none" | "partial" | "complete";
  calibrationSetDigest: string | null;
  profileCount: number;
  earliestExpiry: string | null;
  identity: RuntimeModelIdentity | null;
  backend: Backend;
  supportsBatching?: boolean;
}

/**
 * Publishes the ModelStatus of the SET. `degraded` means the fallback is active
 * OR calibration coverage is partial. A selected calibration profile is NEVER
 * part of the status — only the set-level coverage/digest/count/expiry.
 */
export function buildRuntimeSetStatus(
  state: WorkerHostState,
  input: RuntimeSetStatusInput,
): ModelStatus {
  const set = {
    calibrationCoverage: input.calibrationCoverage,
    calibrationSetDigest: input.calibrationSetDigest,
    profileCount: input.profileCount,
    earliestExpiry: input.earliestExpiry,
  };
  if (state.mode === "terminal") {
    return {
      state: "error",
      backend: "mock",
      runtimeIdentity: null,
      ...set,
      reasonCodes: state.reasonCodes,
    };
  }
  const partial = input.calibrationCoverage === "partial";
  const degraded = state.mode === "fallback" || partial;
  const baseState =
    state.phase === "initializing"
      ? "initializing"
      : degraded
        ? "degraded"
        : "ready";
  return {
    state: baseState,
    backend: input.backend,
    runtimeIdentity: input.identity,
    ...set,
    reasonCodes: state.mode === "fallback" ? state.reasonCodes : [],
    ...(input.supportsBatching === undefined
      ? {}
      : { supportsBatching: input.supportsBatching }),
  };
}

function workerUnavailableError(): CleanFeedError {
  return new CleanFeedError("WORKER_UNAVAILABLE", "WORKER_UNAVAILABLE");
}

function normalizeModelStatus(status: ModelStatus): ModelStatus {
  return status.state === "ready"
    ? { ...status }
    : inactiveModelStatus(status.state, status.reasonCodes);
}

function inactiveModelStatus(
  state: Exclude<ModelStatus["state"], "ready">,
  reasonCodes: DecisionReasonCode[] = [],
): ModelStatus {
  return {
    state,
    backend: "mock",
    runtimeIdentity: null,
    calibrationCoverage: "none",
    calibrationSetDigest: null,
    profileCount: 0,
    earliestExpiry: null,
    reasonCodes,
  };
}
