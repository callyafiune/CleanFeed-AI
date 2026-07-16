import { CleanFeedError } from "@/shared/errors";
import type { ClassificationRequest } from "@/shared/messages";
import type { UserSettings } from "@/shared/settings-types";
import type { ClassificationResult } from "@/shared/types";
import {
  parseWorkerResponse,
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
  private cancelledTasks = 0;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly batchQueue: WorkerClassificationRequest[] = [];
  private batchTimer?: ReturnType<typeof setTimeout>;

  constructor(
    createWorker: () => WorkerLike = () =>
      new Worker(new URL("../inference/inference-worker.ts", import.meta.url), {
        type: "module",
      }),
    private supportsBatching = false,
  ) {
    this.worker = createWorker();
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = () => this.failWorker();
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
    this.cancelledTasks += 1;
    this.postCancel(requestId);
    pending.reject(new DOMException("Inference task cancelled", "AbortError"));
    return true;
  }

  stats(): { cancelledTasks: number } {
    return { cancelledTasks: this.cancelledTasks };
  }

  initialize(requestId = "worker-initialize"): void {
    this.postControl("INITIALIZE", requestId);
  }

  status(requestId = "worker-status"): void {
    this.postControl("STATUS", requestId);
  }

  dispose(): void {
    this.rejectAll();
    if (this.workerAvailable) {
      this.postControl("DISPOSE", "worker-dispose");
      this.workerAvailable = false;
      this.worker.terminate();
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
    if (message.type === "STATUS")
      this.supportsBatching = message.payload.supportsBatching ?? false;
    const pending = this.settle(message.requestId);
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
    const pending = this.settle(requestId);
    if (pending === undefined) return;
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

  private postControl(
    type: "INITIALIZE" | "STATUS" | "DISPOSE",
    requestId: string,
  ): void {
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
      const pending = this.settle(request.requestId);
      pending?.reject(error);
    }
  }

  private postBatch(requests: WorkerClassificationRequest[]): void {
    try {
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
      for (const request of requests)
        this.settle(request.requestId)?.reject(error);
    }
  }

  private rejectAll(reason: unknown = workerUnavailableError()): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      pending.reject(reason);
      this.pending.delete(requestId);
    }
  }

  private failWorker(reason: unknown = workerUnavailableError()): void {
    if (this.workerAvailable) {
      this.workerAvailable = false;
      this.worker.terminate();
    }
    this.rejectAll(reason);
  }
}

function workerUnavailableError(): CleanFeedError {
  return new CleanFeedError("WORKER_UNAVAILABLE", "WORKER_UNAVAILABLE");
}
