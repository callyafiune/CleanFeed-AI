import { buildBuiltinIdentity } from "@/inference/builtin-runtime";
import { CleanFeedError } from "@/shared/errors";
import type {
  Backend,
  DecisionReasonCode,
  ModelStatus,
  TextClassifier,
} from "@/shared/types";
import type { BackendPreference } from "@/shared/settings-types";

export type InferenceBackend = Exclude<Backend, "mock">;
export type ModelLifecycleState =
  "unavailable" | "initializing" | "ready" | "disposing" | "error";

export interface BackendSelectionOptions {
  preference: BackendPreference;
  hasWebGpu: boolean;
  webGpuEnabled?: boolean;
  wasmEnabled?: boolean;
}

export interface BackendFactory {
  wasm(): TextClassifier | Promise<TextClassifier>;
  webgpu(): TextClassifier | Promise<TextClassifier>;
}

export interface BackendSelection {
  backend: InferenceBackend;
  classifier: TextClassifier;
  fallbackFrom?: "webgpu";
  warning?: "WEBGPU_FALLBACK";
}

export interface BackendSelectorOptions {
  onFallback?: () => void;
}

/** Selects one local backend and releases a failed partial session before fallback. */
export class BackendSelector {
  constructor(
    private readonly factory: BackendFactory,
    private readonly options: BackendSelectorOptions = {},
  ) {}

  initialize(options: BackendSelectionOptions): Promise<BackendSelection> {
    return selectBackend(options, this.factory, this.options);
  }
}

export async function selectBackend(
  options: BackendSelectionOptions,
  factory: BackendFactory,
  selectorOptions: BackendSelectorOptions = {},
): Promise<BackendSelection> {
  if (options.preference === "wasm") {
    return {
      backend: "wasm",
      classifier: await initializeEnabledBackend(factory, "wasm", options),
    };
  }

  const shouldTryWebGpu = options.hasWebGpu && options.webGpuEnabled !== false;
  if (shouldTryWebGpu) {
    try {
      return {
        backend: "webgpu",
        classifier: await initialize(factory, "webgpu"),
      };
    } catch {
      selectorOptions.onFallback?.();
      try {
        return {
          backend: "wasm",
          classifier: await initializeEnabledBackend(factory, "wasm", options),
          fallbackFrom: "webgpu",
          ...(options.preference === "webgpu"
            ? { warning: "WEBGPU_FALLBACK" as const }
            : {}),
        };
      } catch (error) {
        throw modelLoadFailed(error);
      }
    }
  }

  try {
    const fallback = options.preference === "webgpu";
    if (fallback) selectorOptions.onFallback?.();
    return {
      backend: "wasm",
      classifier: await initializeEnabledBackend(factory, "wasm", options),
      ...(fallback
        ? {
            fallbackFrom: "webgpu" as const,
            warning: "WEBGPU_FALLBACK" as const,
          }
        : {}),
    };
  } catch (error) {
    throw modelLoadFailed(error);
  }
}

/** Serializes classifier replacement so no two initialized sessions overlap. */
export class ClassifierLifecycleManager {
  private active: BackendSelection | undefined;
  private operation = Promise.resolve();
  private status: ModelStatus = inactiveStatus("unavailable");

  constructor(private readonly selector: BackendSelector) {}

  initialize(options: BackendSelectionOptions): Promise<BackendSelection> {
    return this.serialize(async () => {
      this.status = inactiveStatus("initializing");
      try {
        await this.disposeActive();
        const selection = await this.selector.initialize(options);
        this.active = selection;
        const metadata = selection.classifier.getMetadata();
        this.status = {
          state: "ready",
          backend: selection.backend,
          runtimeIdentity:
            selection.classifier.getRuntimeIdentity?.() ??
            buildBuiltinIdentity(metadata),
          calibrationCoverage: "none",
          calibrationSetDigest: null,
          profileCount: 0,
          earliestExpiry: null,
          // The WebGPU→WASM fallback signal (previously `warning`) now travels
          // as a status reason code. Authoritative degraded semantics is a
          // later task; the state is left as the current logic produced it.
          reasonCodes:
            selection.fallbackFrom === "webgpu" ? ["WEBGPU_FALLBACK"] : [],
          initializedAt: Date.now(),
          supportsBatching: metadata.supportsBatching,
        };
        return selection;
      } catch (error) {
        this.status = inactiveStatus("error", ["BACKEND_ERROR"]);
        throw error;
      }
    });
  }

  dispose(): Promise<void> {
    return this.serialize(async () => {
      this.status = inactiveStatus("disposing");
      try {
        await this.disposeActive();
        this.status = inactiveStatus("unavailable");
      } catch (error) {
        this.status = inactiveStatus("error", ["BACKEND_ERROR"]);
        throw error;
      }
    });
  }

  getClassifier(): TextClassifier | undefined {
    return this.active?.classifier;
  }

  getStatus(): ModelStatus {
    return { ...this.status };
  }

  private async disposeActive(): Promise<void> {
    const active = this.active;
    this.active = undefined;
    await active?.classifier.dispose();
  }

  private serialize<T>(work: () => Promise<T>): Promise<T> {
    const next = this.operation.then(work, work);
    this.operation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }
}

async function initialize(
  factory: BackendFactory,
  backend: InferenceBackend,
): Promise<TextClassifier> {
  let classifier: TextClassifier | undefined;
  try {
    classifier = await factory[backend]();
    await classifier.initialize();
    return classifier;
  } catch (error) {
    await classifier?.dispose();
    throw error;
  }
}

async function initializeEnabledBackend(
  factory: BackendFactory,
  backend: InferenceBackend,
  options: BackendSelectionOptions,
): Promise<TextClassifier> {
  if (backend === "wasm" && options.wasmEnabled === false) {
    throw modelLoadFailed(undefined);
  }
  try {
    return await initialize(factory, backend);
  } catch (error) {
    throw modelLoadFailed(error);
  }
}

function modelLoadFailed(cause: unknown): CleanFeedError {
  if (cause instanceof CleanFeedError && cause.code === "MODEL_LOAD_FAILED") {
    return cause;
  }
  return new CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED");
}

function inactiveStatus(
  state: Exclude<ModelLifecycleState, "ready">,
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
