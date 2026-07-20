import { ensureOffscreenDocument } from "@/background/offscreen-manager";
import { CleanFeedError } from "@/shared/errors";
import { sha256 } from "@/shared/hashing";
import { parseExtensionMessage } from "@/shared/message-validation";
import type {
  ClassificationRequest,
  DomainPauseRequest,
  ExtensionMessage,
  MessageEnvelope,
} from "@/shared/messages";
import { normalizeText } from "@/shared/text-normalization";
import type { UserSettings } from "@/shared/settings-types";
import type {
  ClassificationResult,
  ModelStatus,
  PerformanceTrace,
} from "@/shared/types";
import { buildCacheKey, type ClassificationCache } from "@/storage/cache";
import type { MetricRecord } from "@/storage/metrics";

export interface OffscreenClient {
  classify(request: WorkerClassificationRequest): Promise<ClassificationResult>;
  cancel?(requestId: string): Promise<void>;
  getModelStatus?(): Promise<ModelStatus>;
}

export type WorkerClassificationRequest = ClassificationRequest & {
  requestId: string;
  settings?: UserSettings;
};

export interface MetricsRecorder {
  record(record: MetricRecord): Promise<void>;
  recordInference?(
    trace: PerformanceTrace,
    backend: ClassificationResult["backend"],
    status: ClassificationResult["status"],
  ): Promise<void>;
}

export interface SettingsStore {
  get(): Promise<UserSettings>;
  patch(update: Partial<UserSettings>): Promise<UserSettings>;
}

/**
 * The persistent, hostname-only pause store the popup's "Pausar neste site"
 * control drives. It records nothing but the normalized hostname. A page-session
 * pause — which must expire when the tab's content script goes away — lives in
 * that tab's in-memory SessionState and never reaches this store.
 */
export interface DomainPauseStore {
  pause(hostname: string): Promise<void>;
  resume(hostname: string): Promise<void>;
}

export interface BackgroundMessageRouterOptions {
  cache: Pick<ClassificationCache, "get" | "set">;
  metrics: MetricsRecorder;
  offscreenClient: OffscreenClient;
  modelKey: string;
  settingsFingerprint: string | ((platformId: string) => Promise<string>);
  settings?: SettingsStore;
  domainPause?: DomainPauseStore;
  modelStatus?: () => Promise<ModelStatus>;
}

type ClassifyTextMessage = MessageEnvelope<
  "CLASSIFY_TEXT",
  ClassificationRequest
> & { requestId: string };

type ClassificationErrorMessage = MessageEnvelope<
  "ERROR",
  { code: CleanFeedError["code"]; recoverable: boolean }
> & { requestId: string };

/** Validates and routes background-bound requests without trusting page inputs. */
export class BackgroundMessageRouter {
  constructor(private readonly options: BackgroundMessageRouterOptions) {}

  async handle(
    rawMessage: unknown,
    sender?: chrome.runtime.MessageSender,
  ): Promise<ExtensionMessage | undefined> {
    void sender;
    const message = parseExtensionMessage(rawMessage);
    if (message.target !== "background") {
      return undefined;
    }

    try {
      switch (message.type) {
        case "CLASSIFY_TEXT":
          return await this.handleClassification(
            message as ClassifyTextMessage,
          );
        case "CANCEL_CLASSIFICATION":
          await this.options.offscreenClient.cancel?.(message.requestId!);
          return undefined;
        case "GET_SETTINGS":
          return await this.handleGetSettings(
            message as MessageEnvelope<"GET_SETTINGS", undefined>,
          );
        case "UPDATE_SETTINGS":
          return await this.handleUpdateSettings(
            message as MessageEnvelope<
              "UPDATE_SETTINGS",
              Partial<UserSettings>
            >,
          );
        case "MODEL_STATUS_REQUEST":
          return this.handleModelStatus(
            message as MessageEnvelope<"MODEL_STATUS_REQUEST", undefined>,
          );
        case "PAUSE_DOMAIN":
          await this.handlePauseDomain(
            message as MessageEnvelope<"PAUSE_DOMAIN", DomainPauseRequest>,
          );
          return undefined;
        default:
          return undefined;
      }
    } catch (error) {
      return errorMessage(message, toCleanFeedError(error));
    }
  }

  private async handleClassification(
    message: ClassifyTextMessage,
  ): Promise<ExtensionMessage> {
    const normalizedText = normalizeText(message.payload.text);
    const textHash = await sha256(normalizedText);
    const settingsFingerprint = await this.getSettingsFingerprint(
      message.payload.platform,
    );
    const key = buildCacheKey(
      message.payload.platform,
      this.options.modelKey,
      settingsFingerprint,
      textHash,
    );
    const cached = await this.options.cache.get(key);

    if (cached !== undefined) {
      await this.options.metrics.record({ cacheHits: 1 });
      return classificationResultMessage(message, cached);
    }

    await this.options.metrics.record({ cacheMisses: 1 });
    const settings = await this.options.settings?.get();
    const result = await this.options.offscreenClient.classify({
      requestId: message.requestId,
      ...message.payload,
      ...(settings === undefined ? {} : { settings }),
    });
    assertClassificationResult(result);
    await this.options.cache.set(key, result);
    await this.recordInference(result);
    return classificationResultMessage(message, result);
  }

  private getSettingsFingerprint(platformId: string): Promise<string> {
    const { settingsFingerprint } = this.options;
    return Promise.resolve(
      typeof settingsFingerprint === "string"
        ? settingsFingerprint
        : settingsFingerprint(platformId),
    );
  }

  private recordInference(result: ClassificationResult): Promise<void> {
    const trace = inferenceTrace(result);
    if (this.options.metrics.recordInference !== undefined) {
      return this.options.metrics.recordInference(
        trace,
        result.backend,
        result.status,
      );
    }
    return this.options.metrics.record({
      inferenceMs: trace.totalMs,
      status: result.status,
      backend: result.backend,
    });
  }

  private async handleGetSettings(
    request: MessageEnvelope<"GET_SETTINGS", undefined>,
  ): Promise<ExtensionMessage> {
    const settings = await this.settingsStore().get();
    return {
      source: "background",
      target: request.source,
      type: "SETTINGS_RESULT",
      payload: settings,
    };
  }

  private async handleUpdateSettings(
    request: MessageEnvelope<"UPDATE_SETTINGS", Partial<UserSettings>>,
  ): Promise<ExtensionMessage> {
    const store = this.settingsStore();
    const settings = await store.patch(request.payload);
    return {
      source: "background",
      target: request.source,
      type: "SETTINGS_RESULT",
      payload: settings,
    };
  }

  private async handleModelStatus(
    request: MessageEnvelope<"MODEL_STATUS_REQUEST", undefined>,
  ): Promise<ExtensionMessage> {
    const status = await (this.options.modelStatus?.() ??
      Promise.resolve<ModelStatus>({
        state: "unavailable",
        backend: "mock",
        runtimeIdentity: null,
        calibrationCoverage: "none",
        calibrationSetDigest: null,
        profileCount: 0,
        earliestExpiry: null,
        reasonCodes: [],
      }));
    return {
      source: "background",
      target: request.source,
      type: "MODEL_STATUS_RESULT",
      payload: status,
    };
  }

  /**
   * Pauses or resumes CleanFeed for a single hostname. Only the hostname the
   * validator already accepted crosses into the store; no path, query or text
   * is ever touched.
   */
  private async handlePauseDomain(
    request: MessageEnvelope<"PAUSE_DOMAIN", DomainPauseRequest>,
  ): Promise<void> {
    const store = this.domainPauseStore();
    if (request.payload.paused) {
      await store.pause(request.payload.hostname);
    } else {
      await store.resume(request.payload.hostname);
    }
  }

  private settingsStore(): SettingsStore {
    if (this.options.settings === undefined) {
      throw new CleanFeedError("STORAGE_ERROR", "SETTINGS_UNAVAILABLE");
    }
    return this.options.settings;
  }

  private domainPauseStore(): DomainPauseStore {
    if (this.options.domainPause === undefined) {
      throw new CleanFeedError("STORAGE_ERROR", "DOMAIN_PAUSE_UNAVAILABLE");
    }
    return this.options.domainPause;
  }
}

function inferenceTrace(result: ClassificationResult): PerformanceTrace {
  const timings = result.stageTimings;
  return {
    extractionMs: 0,
    normalizationMs: 0,
    eligibilityMs: 0,
    hashingMs: 0,
    queueWaitMs: 0,
    languageDetectionMs: timings?.languageMs ?? 0,
    tokenizationMs: timings?.tokenizationMs ?? 0,
    inferenceMs: timings?.inferenceMs ?? result.processingTimeMs,
    aggregationMs: timings?.aggregationMs ?? 0,
    presentationMs: 0,
    totalMs: result.processingTimeMs,
  };
}

/** Sends a directed request to the offscreen document after ensuring it exists. */
export class RuntimeOffscreenClient implements OffscreenClient {
  async getModelStatus(): Promise<ModelStatus> {
    try {
      await ensureOffscreenDocument();
      const response = await chrome.runtime.sendMessage({
        source: "background",
        target: "offscreen",
        type: "MODEL_STATUS_REQUEST",
        payload: undefined,
      });
      const message = parseExtensionMessage(response);
      if (
        message.type === "MODEL_STATUS_RESULT" &&
        message.source === "offscreen" &&
        message.target === "background"
      ) {
        return message.payload;
      }
    } catch {
      // The status below makes offscreen/worker loss visible without rejecting popup polling.
    }
    return {
      state: "error",
      backend: "mock",
      runtimeIdentity: null,
      calibrationCoverage: "none",
      calibrationSetDigest: null,
      profileCount: 0,
      earliestExpiry: null,
      reasonCodes: ["BACKEND_ERROR"],
    };
  }

  async cancel(requestId: string): Promise<void> {
    await ensureOffscreenDocument();
    await chrome.runtime.sendMessage({
      source: "background",
      target: "offscreen",
      type: "CANCEL_CLASSIFICATION",
      requestId,
      payload: undefined,
    });
  }

  async classify(
    request: WorkerClassificationRequest,
  ): Promise<ClassificationResult> {
    await ensureOffscreenDocument();
    const response = await chrome.runtime.sendMessage({
      source: "background",
      target: "offscreen",
      type: "OFFSCREEN_CLASSIFY",
      requestId: request.requestId,
      payload: {
        text: request.text,
        platform: request.platform,
        manual: request.manual,
        ...(request.settings === undefined
          ? {}
          : { settings: request.settings }),
      },
    });
    const message = parseExtensionMessage(response);
    if (
      message.type === "ERROR" &&
      message.source === "offscreen" &&
      message.target === "background" &&
      message.requestId === request.requestId
    ) {
      throw new CleanFeedError(
        message.payload.code,
        message.payload.code,
        message.payload.recoverable,
      );
    }

    if (
      message.type !== "OFFSCREEN_RESULT" ||
      message.source !== "offscreen" ||
      message.target !== "background" ||
      message.requestId !== request.requestId
    ) {
      throw new CleanFeedError("INVALID_MESSAGE", "INVALID_OFFSCREEN_RESPONSE");
    }

    return message.payload;
  }
}

export function classificationErrorMessage(
  request: ClassifyTextMessage,
  error: CleanFeedError,
): ClassificationErrorMessage {
  return {
    source: "background",
    target: request.source,
    type: "ERROR",
    requestId: request.requestId,
    payload: {
      code: error.code,
      recoverable: error.recoverable,
    },
  };
}

function errorMessage(
  request: MessageEnvelope<string, unknown>,
  error: CleanFeedError,
): ExtensionMessage {
  return {
    source: "background",
    target: request.source,
    type: "ERROR",
    ...(request.requestId === undefined
      ? {}
      : { requestId: request.requestId }),
    payload: { code: error.code, recoverable: error.recoverable },
  };
}

function toCleanFeedError(error: unknown): CleanFeedError {
  if (error instanceof CleanFeedError) {
    return error;
  }

  return new CleanFeedError("INFERENCE_FAILED", "INFERENCE_FAILED");
}

function classificationResultMessage(
  request: ClassifyTextMessage,
  result: ClassificationResult,
): MessageEnvelope<"CLASSIFICATION_RESULT", ClassificationResult> & {
  requestId: string;
} {
  return {
    source: "background",
    target: "content",
    type: "CLASSIFICATION_RESULT",
    requestId: request.requestId,
    payload: result,
  };
}

function assertClassificationResult(
  result: ClassificationResult,
): asserts result is ClassificationResult {
  parseExtensionMessage({
    source: "offscreen",
    target: "background",
    type: "OFFSCREEN_RESULT",
    requestId: "classification-result-validation",
    payload: result,
  });
}
