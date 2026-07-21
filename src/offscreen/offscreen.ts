import {
  crossValidateRuntimeDescriptor,
  loadRuntimeDescriptor,
  type RuntimeDescriptor,
} from "@/inference/model-bundle";
import { buildWorkerInitializePayload } from "@/inference/runtime-activation";
import { SETTINGS_STORAGE_KEYS } from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";
import { parseExtensionMessage } from "@/shared/message-validation";
import { WorkerHost } from "@/offscreen/worker-host";
import type { DecisionReasonCode, ModelStatus } from "@/shared/types";

const modelBaseUrl = chrome.runtime.getURL("models/");
const wasmBaseUrl = chrome.runtime.getURL("vendor/transformers-wasm/");

/**
 * Best-effort, side-effect-free read of the opt-in "preview experimental / não
 * calibrado" flag. It NEVER migrates or writes settings (that is the service
 * worker's job); any unreadable or legacy shape defaults to false, so the
 * experimental TMR stays OFF unless the user explicitly enabled it — fail closed.
 */
async function readExperimentalFlag(): Promise<boolean> {
  try {
    const key = SETTINGS_STORAGE_KEYS.global;
    const stored = await chrome.storage.local.get(key);
    const envelope = stored[key] as
      { settings?: Record<string, unknown> } | undefined;
    const settings = envelope?.settings ?? envelope;
    return (
      (settings as Record<string, unknown> | undefined)
        ?.experimentalUncalibratedTmr === true
    );
  } catch {
    return false;
  }
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

// The experimental flag the worker was last initialized with, so a storage change
// only re-initializes when the flag actually flips.
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

const workerHostReady: Promise<WorkerHost> = (async () => {
  const host = new WorkerHost();
  await configureHost(host, await readExperimentalFlag());
  return host;
})();

// Re-initialize the worker when the user toggles the experimental preview, so the
// sealed TMR is loaded/unloaded to match the opt-in without an extension reload.
// Every other settings change leaves the runtime untouched.
chrome.storage?.onChanged?.addListener((changes, area) => {
  if (area !== "local" || changes[SETTINGS_STORAGE_KEYS.global] === undefined) {
    return;
  }
  void (async () => {
    const experimental = await readExperimentalFlag();
    if (experimental === activeExperimental) return;
    const host = await workerHostReady;
    await configureHost(host, experimental);
  })();
});

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
