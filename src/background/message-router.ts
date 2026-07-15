import { ensureOffscreenDocument } from "@/background/offscreen-manager";
import { CleanFeedError } from "@/shared/errors";
import { sha256 } from "@/shared/hashing";
import { parseExtensionMessage } from "@/shared/message-validation";
import type {
  ClassificationRequest,
  ExtensionMessage,
  MessageEnvelope,
} from "@/shared/messages";
import { normalizeText } from "@/shared/text-normalization";
import type { ClassificationResult } from "@/shared/types";
import { buildCacheKey, type ClassificationCache } from "@/storage/cache";
import type { MetricRecord } from "@/storage/metrics";

export interface OffscreenClient {
  classify(request: WorkerClassificationRequest): Promise<ClassificationResult>;
}

export type WorkerClassificationRequest = ClassificationRequest & {
  requestId: string;
};

export interface MetricsRecorder {
  record(record: MetricRecord): Promise<void>;
}

export interface BackgroundMessageRouterOptions {
  cache: Pick<ClassificationCache, "get" | "set">;
  metrics: MetricsRecorder;
  offscreenClient: OffscreenClient;
  modelKey: string;
  settingsFingerprint: string | (() => Promise<string>);
}

type ClassifyTextMessage = MessageEnvelope<
  "CLASSIFY_TEXT",
  ClassificationRequest
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
    if (message.target !== "background" || message.type !== "CLASSIFY_TEXT") {
      return undefined;
    }

    return this.handleClassification(message as ClassifyTextMessage);
  }

  private async handleClassification(
    message: ClassifyTextMessage,
  ): Promise<ExtensionMessage> {
    const normalizedText = normalizeText(message.payload.text);
    const textHash = await sha256(normalizedText);
    const settingsFingerprint = await this.getSettingsFingerprint();
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
    const result = await this.options.offscreenClient.classify({
      requestId: message.requestId,
      ...message.payload,
    });
    assertClassificationResult(result);
    await this.options.cache.set(key, result);
    await this.options.metrics.record({
      inferenceMs: result.processingTimeMs,
      status: result.status,
      backend: result.backend,
    });
    return classificationResultMessage(message, result);
  }

  private getSettingsFingerprint(): Promise<string> {
    const { settingsFingerprint } = this.options;
    return Promise.resolve(
      typeof settingsFingerprint === "string"
        ? settingsFingerprint
        : settingsFingerprint(),
    );
  }
}

/** Sends a directed request to the offscreen document after ensuring it exists. */
export class RuntimeOffscreenClient implements OffscreenClient {
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
      },
    });
    const message = parseExtensionMessage(response);
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
