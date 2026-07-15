import { CleanFeedError } from "@/shared/errors";
import type { ClassificationRequest } from "@/shared/messages";
import type { ClassificationResult } from "@/shared/types";
import {
  parseWorkerResponse,
  type WorkerRequest,
  type WorkerResponse,
} from "@/inference/worker-protocol";

export type WorkerClassificationRequest = ClassificationRequest & {
  requestId: string;
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
};

/** Bridges the offscreen document to its one dedicated inference worker. */
export class WorkerHost implements WorkerClassifierClient {
  private readonly worker: WorkerLike;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    createWorker: () => WorkerLike = () =>
      new Worker(new URL("../inference/inference-worker.ts", import.meta.url), {
        type: "module",
      }),
  ) {
    this.worker = createWorker();
    this.worker.onmessage = (event) => this.handleMessage(event.data);
    this.worker.onerror = () => this.rejectAll();
  }

  classify(
    request: WorkerClassificationRequest,
  ): Promise<ClassificationResult> {
    if (this.pending.has(request.requestId)) {
      return Promise.reject(
        new CleanFeedError("INVALID_MESSAGE", "DUPLICATE_WORKER_REQUEST"),
      );
    }

    return new Promise<ClassificationResult>((resolve, reject) => {
      this.pending.set(request.requestId, { resolve, reject });
      try {
        this.worker.postMessage({
          type: "CLASSIFY",
          requestId: request.requestId,
          payload: {
            text: request.text,
            platform: request.platform,
            manual: request.manual,
          },
        });
      } catch (error) {
        this.pending.delete(request.requestId);
        reject(error);
      }
    });
  }

  dispose(): void {
    this.rejectAll();
    this.worker.terminate();
  }

  private handleMessage(rawMessage: unknown): void {
    let message: WorkerResponse;
    try {
      message = parseWorkerResponse(rawMessage);
    } catch (error) {
      this.rejectAll(error);
      return;
    }

    const pending = this.pending.get(message.requestId);
    if (pending === undefined) {
      return;
    }

    this.pending.delete(message.requestId);
    if (message.type === "RESULT") {
      pending.resolve(message.payload);
      return;
    }

    pending.reject(
      new CleanFeedError(
        message.payload.code,
        message.payload.message,
        message.payload.recoverable,
      ),
    );
  }

  private rejectAll(reason: unknown = workerUnavailableError()): void {
    for (const pending of this.pending.values()) {
      pending.reject(reason);
    }
    this.pending.clear();
  }
}

function workerUnavailableError(): CleanFeedError {
  return new CleanFeedError("WORKER_UNAVAILABLE", "WORKER_UNAVAILABLE");
}
