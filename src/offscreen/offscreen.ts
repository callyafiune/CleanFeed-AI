import {
  crossValidateRuntimeDescriptor,
  loadRuntimeDescriptor,
  type RuntimeDescriptor,
} from "@/inference/model-bundle";
import { buildWorkerInitializePayload } from "@/inference/runtime-activation";
import { CleanFeedError } from "@/shared/errors";
import { parseExtensionMessage } from "@/shared/message-validation";
import { WorkerHost } from "@/offscreen/worker-host";
import type { DecisionReasonCode, ModelStatus } from "@/shared/types";

const modelBaseUrl = chrome.runtime.getURL("models/");
const wasmBaseUrl = chrome.runtime.getURL("vendor/transformers-wasm/");

/**
 * The opt-in "preview experimental / não calibrado" flag as it arrives ON a
 * classify request. The background injects the FRESH per-request settings, so the
 * offscreen learns the current opt-in from the work it is asked to do and never
 * depends on chrome.storage inside the offscreen document (unavailable/unreliable
 * there). Anything but an explicit `true` is fail-closed OFF.
 */
export function resolveExperimentalUncalibratedMode(payload: unknown): boolean {
  const settings = (
    payload as
      { settings?: { experimentalUncalibratedTmr?: unknown } } | undefined
  )?.settings;
  return settings?.experimentalUncalibratedTmr === true;
}

// Load and JOINTLY cross-validate the sealed descriptor (manifest + release +
// profiles + source lock) ONCE. The worker STILL revalidates its digests as a
// trust boundary before opening any asset. An absent/malformed/rejected descriptor
// resolves to undefined so the worker is initialized WITHOUT a manifest and runs
// the indicative stylometric builtin — the fail-closed default.
const descriptorReady: Promise<RuntimeDescriptor | undefined> = (async () => {
  try {
    const descriptor = await loadRuntimeDescriptor();
    await crossValidateRuntimeDescriptor(descriptor);
    return descriptor;
  } catch {
    return undefined;
  }
})();

// The experimental mode the worker was last initialized with, so a classify only
// re-initializes when the opt-in actually flips. `undefined` until the first init.
let activeExperimental: boolean | undefined;

// Initializes (or re-initializes) the worker for the current opt-in. The sealed v1
// modelManifest — which is what makes the worker load the TMR — is carried when
// the descriptor authorizes the CALIBRATED primary OR the user opted into the
// uncalibrated experimental preview; otherwise the worker keeps the stylometric
// fallback (builtin identity, no calibration coverage), reported honestly.
async function configureHost(
  host: WorkerHost,
  experimental: boolean,
): Promise<void> {
  activeExperimental = experimental;
  const descriptor = await descriptorReady;
  if (descriptor === undefined) {
    host.initialize({ modelBaseUrl, wasmBaseUrl });
    return;
  }
  host.initialize(
    buildWorkerInitializePayload({
      modelBaseUrl,
      wasmBaseUrl,
      descriptor,
      experimentalUncalibratedTmr: experimental,
    }),
  );
}

// The worker starts in the fail-closed fallback; the first classify that opts into
// the experimental preview re-initializes it to load the sealed TMR.
const workerHostReady: Promise<WorkerHost> = (async () => {
  const host = new WorkerHost();
  await configureHost(host, false);
  return host;
})();

// Re-initializes the worker ONLY when the requested experimental mode differs from
// the one it was last initialized with. `configureHost` sets `activeExperimental`
// synchronously (before its first await), so concurrent requests re-init exactly
// once, and the INITIALIZE is always posted before the CLASSIFY that follows.
async function ensureExperimentalMode(
  host: WorkerHost,
  experimental: boolean,
): Promise<void> {
  if (experimental === activeExperimental) return;
  await configureHost(host, experimental);
}

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

  // The classify payload carries the fresh per-request settings, so the opt-in is
  // read here and the worker is (re)loaded to match BEFORE the text is scored.
  const experimental = resolveExperimentalUncalibratedMode(message.payload);
  void workerHostReady
    .then(async (host) => {
      await ensureExperimentalMode(host, experimental);
      return host.classify({
        requestId: message.requestId,
        ...message.payload,
      });
    })
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
