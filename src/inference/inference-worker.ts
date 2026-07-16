import { aggregateChunkResults } from "@/inference/aggregator";
import { buildExplanation } from "@/inference/explanation";
import { calibrateResult, getLengthBucket } from "@/inference/calibration";
import { createTextChunks } from "@/inference/chunker";
import {
  evaluateLanguagePolicy,
  HeuristicPortugueseDetector,
  type LanguageDetector,
} from "@/inference/language-detector";
import { MockClassifier } from "@/inference/mock-classifier";
import { HeuristicTokenizer, type Tokenizer } from "@/inference/tokenizer";
import {
  parseWorkerRequest,
  serializeWorkerError,
  type WorkerRequest,
  type WorkerResponse,
} from "@/inference/worker-protocol";
import { getTextLengthInfo } from "@/shared/word-count";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ClassificationRequest } from "@/shared/messages";
import type { UserSettings } from "@/shared/settings-types";
import type {
  BatchTextClassifier,
  ChunkResult,
  ClassificationOptions,
  ClassificationResult,
  ReasonCode,
  TextClassifier,
} from "@/shared/types";

export interface InferenceWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: WorkerResponse): void;
}

export interface PipelineRunnerOptions {
  classifier?: TextClassifier;
  detector?: LanguageDetector;
  tokenizer?: Tokenizer;
}

type PreparedRequest = {
  request: ClassificationRequest;
  language: string;
  tokenCount: number;
  chunks: ReturnType<typeof createTextChunks>;
  stageTimings: Pick<
    NonNullable<ClassificationResult["stageTimings"]>,
    "languageMs" | "tokenizationMs" | "chunkingMs"
  >;
};
type PreparedOrEarly = PreparedRequest | { early: ClassificationResult };

/** Runs the deterministic local stages without accessing storage or extension APIs. */
export class PipelineRunner {
  private readonly classifier: TextClassifier;
  private readonly detector: LanguageDetector;
  private readonly tokenizer: Tokenizer;
  private initialized?: Promise<void>;

  constructor(options: PipelineRunnerOptions = {}) {
    this.classifier = options.classifier ?? new MockClassifier();
    this.detector = options.detector ?? new HeuristicPortugueseDetector();
    this.tokenizer = options.tokenizer ?? new HeuristicTokenizer();
  }

  async initialize(): Promise<void> {
    this.initialized ??= this.classifier.initialize();
    await this.initialized;
  }

  async classify(
    request: ClassificationRequest,
    settings: UserSettings,
    signal?: AbortSignal,
  ): Promise<ClassificationResult> {
    await this.initialize();
    throwIfAborted(signal);
    const detection = await this.detector.detect(request.text);
    throwIfAborted(signal);
    const policy = evaluateLanguagePolicy(
      detection,
      settings.languageMode,
      this.classifier.getMetadata().supportedLanguages,
    );
    throwIfAborted(signal);
    if (!policy.allowed) {
      return languageAbstention(request, detection.language, this.classifier);
    }
    const [result] = await this.classifyBatch([request], settings, signal);
    return result!;
  }

  async classifyBatch(
    requests: ClassificationRequest[],
    settings: UserSettings,
    signal?: AbortSignal,
  ): Promise<ClassificationResult[]> {
    const startedAt = performance.now();
    await this.initialize();
    const preparedOrEarly = await Promise.all(
      requests.map((request) => this.prepare(request, settings, signal)),
    );
    const prepared = preparedOrEarly.filter(
      (item): item is PreparedRequest => !("early" in item),
    );
    const languageGroups = Map.groupBy(prepared, (item) => item.language);
    if (languageGroups.size > 1) {
      const resultsByRequest = new Map<
        ClassificationRequest,
        ClassificationResult
      >();
      for (const group of languageGroups.values()) {
        const results = await this.classifyBatch(
          group.map((item) => item.request),
          settings,
          signal,
        );
        group.forEach((item, index) =>
          resultsByRequest.set(item.request, results[index]!),
        );
      }
      return preparedOrEarly.map((item) =>
        "early" in item ? item.early : resultsByRequest.get(item.request)!,
      );
    }
    const inputs = prepared.flatMap((item) =>
      item.chunks.map((chunk) => chunk.text),
    );
    const options: ClassificationOptions = {
      signal,
      language: prepared[0]?.language,
      platform: prepared[0]?.request.platform,
    };
    const inferenceStartedAt = performance.now();
    const classified =
      inputs.length === 0 ? [] : await this.classifyChunks(inputs, options);
    const inferenceMs = performance.now() - inferenceStartedAt;
    throwIfAborted(signal);
    let cursor = 0;

    const completed = prepared.map((item) => {
      const chunkResults = item.chunks.map((chunk) => {
        const result = classified[cursor++]!;
        return {
          index: chunk.index,
          startToken: chunk.startToken,
          endToken: chunk.endToken,
          aiScore: result.aiScore,
          humanScore: result.humanScore,
          processingTimeMs: result.processingTimeMs,
        } satisfies ChunkResult;
      });
      const first = classified[cursor - chunkResults.length]!;
      const aggregationStartedAt = performance.now();
      const aggregation = aggregateChunkResults(
        chunkResults,
        settings.markingThreshold,
      );
      const aggregationMs = performance.now() - aggregationStartedAt;
      const base: ClassificationResult = {
        ...first,
        wordCount: getTextLengthInfo(item.request.text).wordCount,
        tokenCount: item.tokenCount,
        language: item.language,
        chunks: chunkResults,
        aggregation,
        processingTimeMs: performance.now() - startedAt,
      };
      const calibrationStartedAt = performance.now();
      const decision = calibrateResult(base);
      const explanation = buildExplanation(base, decision);
      const calibrationMs = performance.now() - calibrationStartedAt;
      return {
        ...base,
        status: decision.status,
        decision,
        explanation: {
          ...explanation,
          calibrationProfile: `${item.request.platform}:${item.language}:${getLengthBucket(base.wordCount)}`,
        },
        stageTimings: {
          ...item.stageTimings,
          inferenceMs,
          aggregationMs,
          calibrationMs,
        },
      };
    });
    let completedIndex = 0;
    return preparedOrEarly.map((item) =>
      "early" in item ? item.early : completed[completedIndex++]!,
    );
  }

  async dispose(): Promise<void> {
    await this.classifier.dispose();
    this.initialized = undefined;
  }

  supportsBatching(): boolean {
    return (
      this.classifier.getMetadata().supportsBatching &&
      "classifyBatch" in this.classifier
    );
  }

  getMetadata(): TextClassifier["getMetadata"] extends () => infer Metadata
    ? Metadata
    : never {
    return this.classifier.getMetadata();
  }

  private async prepare(
    request: ClassificationRequest,
    settings: UserSettings,
    signal?: AbortSignal,
  ): Promise<PreparedOrEarly> {
    throwIfAborted(signal);
    const languageStartedAt = performance.now();
    const detection = await this.detector.detect(request.text);
    throwIfAborted(signal);
    const policy = evaluateLanguagePolicy(
      detection,
      settings.languageMode,
      this.classifier.getMetadata().supportedLanguages,
    );
    if (!policy.allowed) {
      return {
        early: languageAbstention(request, detection.language, this.classifier),
      };
    }
    throwIfAborted(signal);
    const languageMs = performance.now() - languageStartedAt;
    const tokenizationStartedAt = performance.now();
    const tokenized = await this.tokenizer.encode(request.text, signal);
    throwIfAborted(signal);
    const tokenizationMs = performance.now() - tokenizationStartedAt;
    const chunkingStartedAt = performance.now();
    const chunks = createTextChunks(request.text, tokenized, {
      chunkSizeTokens: settings.chunkSizeTokens,
      overlapTokens: settings.chunkOverlapTokens,
      maximumTokens: settings.maximumTokens,
    });
    const prepared = {
      request,
      language: detection.language,
      tokenCount: tokenized.tokenCount,
      chunks,
      stageTimings: {
        languageMs,
        tokenizationMs,
        chunkingMs: performance.now() - chunkingStartedAt,
      },
    };
    throwIfAborted(signal);
    return prepared;
  }

  private async classifyChunks(
    texts: string[],
    options: ClassificationOptions,
  ): Promise<ClassificationResult[]> {
    const classifier = this.classifier as BatchTextClassifier;
    if (this.supportsBatching()) {
      return classifier.classifyBatch(texts, options);
    }
    return Promise.all(
      texts.map((text) => this.classifier.classify(text, options)),
    );
  }
}

function languageAbstention(
  request: ClassificationRequest,
  language: string,
  classifier: TextClassifier,
): ClassificationResult {
  const wordCount = getTextLengthInfo(request.text).wordCount;
  const metadata = classifier.getMetadata();
  const decision = {
    status: "insufficient_evidence" as const,
    calibratedScore: 0,
    actionCeiling: "indicator" as const,
    abstained: true,
    reasonCodes: ["INSUFFICIENT_EVIDENCE"] satisfies ReasonCode[],
  };
  return {
    aiScore: 0,
    humanScore: 0,
    confidence: "low",
    status: decision.status,
    wordCount,
    tokenCount: 0,
    language,
    modelVersion: metadata.version,
    modelId: metadata.id,
    backend: metadata.backend,
    processingTimeMs: 0,
    demo: metadata.backend === "mock",
    decision,
    explanation: {
      reasonCodes: [...decision.reasonCodes],
      modelScore: 0,
      calibratedScore: 0,
      calibrationProfile: `${request.platform}:${language}:policy`,
    },
  };
}

/** Installs the worker message protocol and keeps cancellation scoped to request IDs. */
export function installInferenceWorker(scope: InferenceWorkerScope): void {
  const runner = new PipelineRunner();
  const controllers = new Map<string, AbortController>();

  scope.addEventListener("message", (event) => {
    let request: WorkerRequest;
    try {
      request = parseWorkerRequest(event.data);
    } catch (error) {
      scope.postMessage({
        type: "ERROR",
        requestId: "unknown",
        payload: serializeWorkerError(error),
      });
      return;
    }

    if (request.type === "CANCEL") {
      controllers.get(request.requestId)?.abort();
      scope.postMessage({
        type: "CANCELLED",
        requestId: request.requestId,
        payload: null,
      });
      return;
    }

    void handleMessage(request, runner, controllers, scope);
  });
}

async function handleMessage(
  request: Exclude<WorkerRequest, { type: "CANCEL" }>,
  runner: PipelineRunner,
  controllers: Map<string, AbortController>,
  scope: InferenceWorkerScope,
): Promise<void> {
  const batchItems =
    request.type === "CLASSIFY"
      ? "requests" in request.payload
        ? request.payload.requests
        : [{ requestId: request.requestId, payload: request.payload }]
      : [];
  try {
    if (request.type === "INITIALIZE") {
      await runner.initialize();
      scope.postMessage({
        type: "STATUS",
        requestId: request.requestId,
        payload: readyStatus(runner),
      });
      return;
    }
    if (request.type === "STATUS") {
      scope.postMessage({
        type: "STATUS",
        requestId: request.requestId,
        payload: readyStatus(runner),
      });
      return;
    }
    if (request.type === "DISPOSE") {
      await runner.dispose();
      scope.postMessage({
        type: "STATUS",
        requestId: request.requestId,
        payload: { ...readyStatus(runner), state: "disposing" },
      });
      return;
    }

    const items = batchItems;
    const settings = items[0]?.payload.settings ?? {
      ...DEFAULT_SETTINGS,
      languageMode: "experimental_any",
    };
    for (const item of items)
      controllers.set(item.requestId, new AbortController());
    const results = await runner.classifyBatch(
      items.map((item) => item.payload),
      settings,
      items.length === 1
        ? controllers.get(items[0]!.requestId)?.signal
        : undefined,
    );
    for (const [index, result] of results.entries()) {
      scope.postMessage({
        type: "RESULT",
        requestId: items[index]?.requestId ?? request.requestId,
        payload: result,
      });
    }
  } catch (error) {
    for (const requestId of batchItems.length === 0
      ? [request.requestId]
      : batchItems.map((item) => item.requestId)) {
      scope.postMessage(
        error instanceof DOMException && error.name === "AbortError"
          ? { type: "CANCELLED", requestId, payload: null }
          : { type: "ERROR", requestId, payload: serializeWorkerError(error) },
      );
    }
  } finally {
    if (request.type === "CLASSIFY") {
      for (const item of batchItems) controllers.delete(item.requestId);
    }
  }
}

function readyStatus(runner: PipelineRunner) {
  const metadata = runner.getMetadata();
  return {
    state: "ready" as const,
    classifierId: metadata.id,
    modelVersion: metadata.version,
    backend: metadata.backend,
    supportsBatching: runner.supportsBatching(),
  };
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The classification was aborted.", "AbortError");
  }
}

installInferenceWorker(self as unknown as InferenceWorkerScope);
