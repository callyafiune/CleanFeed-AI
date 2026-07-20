import { createValidatedRuntimeHost } from "@/inference/model-bundle";
import { CleanFeedError } from "@/shared/errors";
import { parseExtensionMessage } from "@/shared/message-validation";
import { WorkerHost } from "@/offscreen/worker-host";
import type { DecisionReasonCode, ModelStatus } from "@/shared/types";

const modelBaseUrl = chrome.runtime.getURL("models/");
const wasmBaseUrl = chrome.runtime.getURL("vendor/transformers-wasm/");

// Parse and JOINTLY cross-validate the sealed descriptor (manifest + release +
// profiles + source lock) BEFORE any WorkerHost is constructed. Only a valid
// descriptor reaches `createWorkerHost`, and the INITIALIZE payload then carries
// the already-parsed descriptor to the worker (which revalidates it as a trust
// boundary before opening any asset).
const workerHostReady: Promise<WorkerHost> = createValidatedRuntimeHost(
  (descriptor) => {
    const host = new WorkerHost();
    host.initialize({ modelBaseUrl, wasmBaseUrl, descriptor });
    return host;
  },
);

// A rejected descriptor validation must not surface as an unhandled rejection;
// the message handlers below fall back to an unavailable status.
void workerHostReady.catch(() => undefined);

function unavailableStatus(
  reasonCodes: DecisionReasonCode[] = ["ARTIFACT_MISMATCH"],
): ModelStatus {
  return {
    state: "error",
    backend: "mock",
    runtimeIdentity: null,
    calibrationCoverage: "none",
    calibrationSetDigest: null,
    profileCount: 0,
    earliestExpiry: null,
    reasonCodes,
  };
}

chrome.runtime.onMessage.addListener((rawMessage, _sender, sendResponse) => {
  let message;
  try {
    message = parseExtensionMessage(rawMessage);
  } catch {
    return undefined;
  }

  if (message.target !== "offscreen") {
    return undefined;
  }

  if (message.type === "CANCEL_CLASSIFICATION") {
    const requestId = message.requestId!;
    void workerHostReady
      .then((host) => host.cancel(requestId))
      .catch(() => undefined);
    sendResponse(undefined);
    return false;
  }

  if (message.type === "MODEL_STATUS_REQUEST") {
    void workerHostReady
      .then((host) => host.getModelStatus())
      .catch(() => unavailableStatus())
      .then((payload) =>
        sendResponse({
          source: "offscreen",
          target: "background",
          type: "MODEL_STATUS_RESULT",
          payload,
        }),
      );
    return true;
  }

  if (message.type !== "OFFSCREEN_CLASSIFY") return undefined;

  void workerHostReady
    .then((host) =>
      host.classify({ requestId: message.requestId, ...message.payload }),
    )
    .then((result) =>
      sendResponse({
        source: "offscreen",
        target: "background",
        type: "OFFSCREEN_RESULT",
        requestId: message.requestId,
        payload: result,
      }),
    )
    .catch((error: unknown) => {
      const cleanFeedError =
        error instanceof CleanFeedError
          ? error
          : new CleanFeedError("INFERENCE_FAILED", "INFERENCE_FAILED");
      sendResponse({
        source: "offscreen",
        target: "background",
        type: "ERROR",
        requestId: message.requestId,
        payload: {
          code: cleanFeedError.code,
          recoverable: cleanFeedError.recoverable,
        },
      });
    });

  return true;
});
