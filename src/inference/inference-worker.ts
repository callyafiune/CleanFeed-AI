import { MockClassifier } from "@/inference/mock-classifier";
import {
  parseWorkerRequest,
  serializeWorkerError,
  type WorkerResponse,
} from "@/inference/worker-protocol";

export interface InferenceWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: WorkerResponse): void;
}

/** Installs the isolated mock classifier without using DOM, storage, or Chrome APIs. */
export function installInferenceWorker(scope: InferenceWorkerScope): void {
  const classifier = new MockClassifier();
  const initialized = classifier.initialize();

  scope.addEventListener("message", (event) => {
    void handleMessage(event.data, classifier, initialized, scope);
  });
}

async function handleMessage(
  rawMessage: unknown,
  classifier: MockClassifier,
  initialized: Promise<void>,
  scope: InferenceWorkerScope,
): Promise<void> {
  let requestId = "unknown";

  try {
    const request = parseWorkerRequest(rawMessage);
    requestId = request.requestId;
    await initialized;
    const result = await classifier.classify(request.payload.text, {
      platform: request.payload.platform,
    });
    scope.postMessage({ type: "RESULT", requestId, payload: result });
  } catch (error) {
    scope.postMessage({
      type: "ERROR",
      requestId,
      payload: serializeWorkerError(error),
    });
  }
}

installInferenceWorker(self as unknown as InferenceWorkerScope);
