import {
  crossValidateRuntimeDescriptor,
  loadRuntimeDescriptor,
} from "@/inference/model-bundle";
import { buildWorkerInitializePayload } from "@/inference/runtime-activation";
import { CleanFeedError } from "@/shared/errors";
import { parseExtensionMessage } from "@/shared/message-validation";
import { WorkerHost } from "@/offscreen/worker-host";
import type { DecisionReasonCode, ModelStatus } from "@/shared/types";

const modelBaseUrl = chrome.runtime.getURL("models/");
const wasmBaseUrl = chrome.runtime.getURL("vendor/transformers-wasm/");

// Parse and JOINTLY cross-validate the sealed descriptor (manifest + release +
// profiles + source lock) BEFORE the WorkerHost is initialized. A VALID descriptor
// carries the already-parsed descriptor to the worker (which revalidates it as a
// trust boundary before opening any asset), and the sealed v1 modelManifest is
// included ONLY when the descriptor authorizes the calibrated TMR primary (a
// promoted release with usable profiles); a pending/bundle-verified release omits
// it, so the worker keeps the indicative stylometric fallback.
//
// A descriptor that is absent, malformed, rejected, or carries an expired profile
// must NOT leave the extension without a model: the WorkerHost is still created
// and initialized WITHOUT a manifest, so the worker runs the indicative
// stylometric builtin (builtin identity, no calibration coverage). This keeps the
// Phase-1 fail-closed default active and lets the popup report the honest
// "Fallback estilométrico ativo" state instead of an unavailable/null runtime.
const workerHostReady: Promise<WorkerHost> = (async () => {
  const host = new WorkerHost();
  try {
    const descriptor = await loadRuntimeDescriptor();
    await crossValidateRuntimeDescriptor(descriptor);
    host.initialize(
      buildWorkerInitializePayload({ modelBaseUrl, wasmBaseUrl, descriptor }),
    );
  } catch {
    host.initialize({ modelBaseUrl, wasmBaseUrl });
  }
  return host;
})();

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
