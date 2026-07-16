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
  type WorkerInitializePayload,
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

type RuntimeConfigurator = (
  paths: WorkerInitializePayload,
) => void | Promise<void>;

/** A single request in a worker batch, with cancellation owned by that request. */
export interface PipelineBatchItem {
  request: ClassificationRequest;
  signal?: AbortSignal;
}

export type PipelineBatchOutcome =
  | { kind: "result"; result: ClassificationResult }
  | { kind: "cancelled" }
  | { kind: "error"; error: unknown };

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
    const [outcome] = await this.classifyBatchSettled(
      [{ request, signal }],
      settings,
    );
    return unwrapOutcome(outcome!);
  }

  async classifyBatch(
    requests: ClassificationRequest[],
    settings: UserSettings,
  ): Promise<ClassificationResult[]>;
  async classifyBatch(
    items: PipelineBatchItem[],
    settings: UserSettings,
  ): Promise<ClassificationResult[]>;
  async classifyBatch(
    requestsOrItems: ClassificationRequest[] | PipelineBatchItem[],
    settings: UserSettings,
  ): Promise<ClassificationResult[]> {
    const outcomes = await this.classifyBatchSettled(
      requestsOrItems.map((item) =>
        "request" in item ? item : { request: item },
      ),
      settings,
    );
    return outcomes.map(unwrapOutcome);
  }

  async classifyBatchSettled(
    items: PipelineBatchItem[],
    settings: UserSettings,
  ): Promise<PipelineBatchOutcome[]> {
    const startedAt = performance.now();
    await this.initialize();
    const outcomes: (PipelineBatchOutcome | undefined)[] = Array.from({
      length: items.length,
    });
    const prepared = await Promise.all(
      items.map(async (item, index) => {
        try {
          const preparedItem = await this.prepare(
            item.request,
            settings,
            item.signal,
          );
          if ("early" in preparedItem) {
            outcomes[index] = { kind: "result", result: preparedItem.early };
            return undefined;
          }
          return { index, item, prepared: preparedItem };
        } catch (error) {
          outcomes[index] = outcomeForError(error, item.signal);
          return undefined;
        }
      }),
    );
    const preparedItems = prepared.filter(
      (
        item,
      ): item is {
        index: number;
        item: PipelineBatchItem;
        prepared: PreparedRequest;
      } => item !== undefined,
    );
    const languageGroups = Map.groupBy(
      preparedItems,
      (item) => item.prepared.language,
    );
    await Promise.all(
      [...languageGroups.values()].map((group) =>
        this.classifyPreparedGroup(group, settings, startedAt, outcomes),
      ),
    );
    return outcomes.map(
      (outcome): PipelineBatchOutcome =>
        outcome ?? {
          kind: "error",
          error: new Error("The batch request did not settle."),
        },
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

  private async classifyPreparedGroup(
    group: {
      index: number;
      item: PipelineBatchItem;
      prepared: PreparedRequest;
    }[],
    settings: UserSettings,
    startedAt: number,
    outcomes: (PipelineBatchOutcome | undefined)[],
  ): Promise<void> {
    const active = group.filter(({ item, index }) => {
      if (!item.signal?.aborted) return true;
      outcomes[index] = { kind: "cancelled" };
      return false;
    });
    if (active.length === 0) return;

    const inputs = active.flatMap(({ prepared }) =>
      prepared.chunks.map((chunk) => chunk.text),
    );
    const options: ClassificationOptions = {
      ...(active.length === 1 && active[0]!.item.signal !== undefined
        ? { signal: active[0]!.item.signal }
        : {}),
      language: active[0]!.prepared.language,
      platform: active[0]!.item.request.platform,
    };
    const inferenceStartedAt = performance.now();
    let classified: ClassificationResult[];
    try {
      classified =
        inputs.length === 0 ? [] : await this.classifyChunks(inputs, options);
    } catch (error) {
      if (active.length > 1 && this.supportsBatching()) {
        await Promise.all(
          active.map((entry) =>
            this.retryPreparedRequest(entry, settings, startedAt, outcomes),
          ),
        );
        return;
      }
      for (const { index, item } of active) {
        outcomes[index] = outcomeForError(error, item.signal);
      }
      return;
    }
    const inferenceMs = performance.now() - inferenceStartedAt;
    let cursor = 0;
    for (const entry of active) {
      const itemResults = classified.slice(
        cursor,
        cursor + entry.prepared.chunks.length,
      );
      cursor += entry.prepared.chunks.length;
      if (entry.item.signal?.aborted) {
        outcomes[entry.index] = { kind: "cancelled" };
        continue;
      }
      try {
        outcomes[entry.index] = {
          kind: "result",
          result: completePreparedRequest(
            entry.prepared,
            itemResults,
            settings,
            startedAt,
            inferenceMs,
          ),
        };
      } catch (error) {
        outcomes[entry.index] = outcomeForError(error, entry.item.signal);
      }
    }
  }

  private async retryPreparedRequest(
    entry: {
      index: number;
      item: PipelineBatchItem;
      prepared: PreparedRequest;
    },
    settings: UserSettings,
    startedAt: number,
    outcomes: (PipelineBatchOutcome | undefined)[],
  ): Promise<void> {
    if (entry.item.signal?.aborted) {
      outcomes[entry.index] = { kind: "cancelled" };
      return;
    }
    const options: ClassificationOptions = {
      ...(entry.item.signal === undefined ? {} : { signal: entry.item.signal }),
      language: entry.prepared.language,
      platform: entry.item.request.platform,
    };
    const inferenceStartedAt = performance.now();
    try {
      const classified = await Promise.all(
        entry.prepared.chunks.map((chunk) =>
          this.classifier.classify(chunk.text, options),
        ),
      );
      if (entry.item.signal?.aborted) {
        outcomes[entry.index] = { kind: "cancelled" };
        return;
      }
      outcomes[entry.index] = {
        kind: "result",
        result: completePreparedRequest(
          entry.prepared,
          classified,
          settings,
          startedAt,
          performance.now() - inferenceStartedAt,
        ),
      };
    } catch (error) {
      outcomes[entry.index] = outcomeForError(error, entry.item.signal);
    }
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

function completePreparedRequest(
  item: PreparedRequest,
  classified: ClassificationResult[],
  settings: UserSettings,
  startedAt: number,
  inferenceMs: number,
): ClassificationResult {
  const chunkResults = item.chunks.map((chunk, index) => {
    const result = classified[index]!;
    return {
      index: chunk.index,
      startToken: chunk.startToken,
      endToken: chunk.endToken,
      aiScore: result.aiScore,
      humanScore: result.humanScore,
      processingTimeMs: result.processingTimeMs,
    } satisfies ChunkResult;
  });
  const first = classified[0]!;
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
    ...(settings.debugMode
      ? {
          stageTimings: {
            ...item.stageTimings,
            inferenceMs,
            aggregationMs,
            calibrationMs,
          },
        }
      : {}),
  };
}

function outcomeForError(
  error: unknown,
  signal?: AbortSignal,
): PipelineBatchOutcome {
  if (signal?.aborted || isAbortError(error)) return { kind: "cancelled" };
  return { kind: "error", error };
}

function unwrapOutcome(outcome: PipelineBatchOutcome): ClassificationResult {
  if (outcome.kind === "result") return outcome.result;
  if (outcome.kind === "cancelled") {
    throw new DOMException("The classification was aborted.", "AbortError");
  }
  throw outcome.error;
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
export function installInferenceWorker(
  scope: InferenceWorkerScope,
  runnerFactory: () => PipelineRunner = () => new PipelineRunner(),
  configureRuntime: RuntimeConfigurator = async (paths) => {
    const { configureTransformersEnvironment } =
      await import("@/inference/transformers-environment");
    configureTransformersEnvironment(paths);
  },
): void {
  const runner = runnerFactory();
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

    void handleMessage(request, runner, controllers, scope, configureRuntime);
  });
}

async function handleMessage(
  request: Exclude<WorkerRequest, { type: "CANCEL" }>,
  runner: PipelineRunner,
  controllers: Map<string, AbortController>,
  scope: InferenceWorkerScope,
  configureRuntime: RuntimeConfigurator,
): Promise<void> {
  const batchItems =
    request.type === "CLASSIFY"
      ? "requests" in request.payload
        ? request.payload.requests
        : [{ requestId: request.requestId, payload: request.payload }]
      : [];
  try {
    if (request.type === "INITIALIZE") {
      await configureRuntime(request.payload);
      scope.postMessage({
        type: "STATUS",
        requestId: request.requestId,
        payload: { ...readyStatus(runner), state: "initializing" },
      });
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
        payload: { ...readyStatus(runner), state: "unavailable" },
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
    const outcomes = await runner.classifyBatchSettled(
      items.map((item) => ({
        request: item.payload,
        signal: controllers.get(item.requestId)?.signal,
      })),
      settings,
    );
    for (const [index, outcome] of outcomes.entries()) {
      const requestId = items[index]?.requestId ?? request.requestId;
      if (controllers.get(requestId)?.signal.aborted) continue;
      if (outcome.kind === "result") {
        scope.postMessage({
          type: "RESULT",
          requestId,
          payload: outcome.result,
        });
      } else if (outcome.kind === "cancelled") {
        scope.postMessage({ type: "CANCELLED", requestId, payload: null });
      } else {
        scope.postMessage({
          type: "ERROR",
          requestId,
          payload: serializeWorkerError(outcome.error),
        });
      }
    }
  } catch (error) {
    for (const requestId of batchItems.length === 0
      ? [request.requestId]
      : batchItems.map((item) => item.requestId)) {
      if (controllers.get(requestId)?.signal.aborted) continue;
      scope.postMessage(
        isAbortError(error)
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

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

installInferenceWorker(self as unknown as InferenceWorkerScope);
