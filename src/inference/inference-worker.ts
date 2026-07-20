import { aggregateWindowsV2 } from "@/inference/aggregator";
import {
  BackendSelector,
  ClassifierLifecycleManager,
  type BackendFactory,
} from "@/inference/backend-selector";
import {
  buildBuiltinDecision,
  buildBuiltinEvidence,
  buildBuiltinIdentity,
} from "@/inference/builtin-runtime";
import { buildExplanation } from "@/inference/explanation";
import {
  calibrateWithRegistry,
  getLengthBucket,
} from "@/inference/calibration";
import { bundledModelManifest } from "@/inference/bundled-model-metadata";
import { CalibrationRegistry } from "@/inference/calibration-registry";
import { createTextChunks, type TextChunkOptions } from "@/inference/chunker";
import { assessEvidence } from "@/inference/evidence";
import { createTmrChunkPlan } from "@/inference/model-runtime";
import { computeContentComposition } from "../../contracts/content-composition";
import {
  evaluateLanguagePolicy,
  HeuristicPortugueseDetector,
  type LanguageDetector,
} from "@/inference/language-detector";
import type { CleanFeedModelManifest } from "@/inference/model-bundle";
import {
  OnnxTextClassifier,
  TransformersJsModelGateway,
} from "@/inference/onnx-classifier";
import { StylometricClassifier } from "@/inference/stylometric-classifier";
import { HeuristicTokenizer, type Tokenizer } from "@/inference/tokenizer";
import {
  parseWorkerRequest,
  serializeWorkerError,
  type WorkerInitializePayload,
  type WorkerBackendSettings,
  type WorkerRequest,
  type WorkerResponse,
} from "@/inference/worker-protocol";
import { getTextLengthInfo } from "@/shared/word-count";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";
import type { ClassificationRequest } from "@/shared/messages";
import type { UserSettings } from "@/shared/settings-types";
import type {
  BatchTextClassifier,
  ChunkResult,
  ClassificationOptions,
  ClassificationResult,
  DecisionReasonCode,
  ModelStatus,
  ReasonCode,
  RuntimeModelIdentity,
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
  initialized?: boolean;
  /**
   * Benchmark-verified calibrations. The default is EMPTY on purpose: no
   * shipped classifier is calibrated, so every decision is capped to the
   * indicator-only action ceiling until a verified profile is registered.
   */
  calibration?: CalibrationRegistry;
  /**
   * Fixed window plan for the calibrated bundle (TMR) path. When present,
   * chunking uses it and IGNORES the editable `settings.chunk*` fields; the
   * builtin/experimental runtimes leave it undefined and chunk from settings.
   */
  chunkPlan?: TextChunkOptions;
}

type RuntimeConfigurator = (
  paths: WorkerInitializePayload,
) => void | Promise<void>;

export interface InferenceWorkerRuntimeOptions {
  hasWebGpu?: () => boolean;
  backendFactory?: (manifest: CleanFeedModelManifest) => BackendFactory;
}

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
  /** Whether the tokenizer produced exact native offsets (TMR) or an estimate. */
  exact: boolean;
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
  private readonly calibration: CalibrationRegistry;
  private readonly chunkPlan: TextChunkOptions | undefined;
  private initialized?: Promise<void>;

  constructor(options: PipelineRunnerOptions = {}) {
    // The fallback backend is the transparent stylometric heuristic: real,
    // explainable signals, but still an uncalibrated indicator — never a
    // validated detector.
    this.classifier = options.classifier ?? new StylometricClassifier();
    this.detector = options.detector ?? new HeuristicPortugueseDetector();
    this.tokenizer = options.tokenizer ?? new HeuristicTokenizer();
    // Empty by default: with no verified calibration registered, every
    // decision leaves this pipeline with actionCeiling "indicator".
    this.calibration = options.calibration ?? new CalibrationRegistry();
    this.chunkPlan = options.chunkPlan;
    if (options.initialized) this.initialized = Promise.resolve();
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

  getRuntimeIdentity(): RuntimeModelIdentity {
    return (
      this.classifier.getRuntimeIdentity?.() ??
      buildBuiltinIdentity(this.classifier.getMetadata())
    );
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
    // The calibrated bundle path uses the sealed window plan; the builtin path
    // uses the editable settings.
    const chunks = createTextChunks(
      request.text,
      tokenized,
      this.chunkPlan ?? {
        chunkSizeTokens: settings.chunkSizeTokens,
        overlapTokens: settings.chunkOverlapTokens,
        maximumTokens: settings.maximumTokens,
      },
    );
    const prepared = {
      request,
      language: detection.language,
      tokenCount: tokenized.tokenCount,
      exact: tokenized.exact,
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
            this.calibration,
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
          this.calibration,
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
  calibration: CalibrationRegistry,
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
  const aggregation = aggregateWindowsV2(
    chunkResults.map((chunk) => ({
      index: chunk.index,
      tokenStart: chunk.startToken,
      tokenEnd: chunk.endToken,
      rawScore: chunk.aiScore,
    })),
    item.tokenCount,
  );
  const aggregationMs = performance.now() - aggregationStartedAt;
  const wordCount = getTextLengthInfo(item.request.text).wordCount;
  // The calibrated TMR (bundle) path derives its evidence from the shared,
  // pure assessor; the demonstration builtins keep their own conservative
  // `limited` evidence. Real exact-tokenizer wiring for the bundle path lands
  // in Task 7, so today the bundle path is fail-closed (approximate tokenizer).
  const evidence =
    first.runtimeIdentity.kind === "bundle"
      ? assessEvidence({
          locale: item.language,
          wordCount,
          coverage: aggregation.coverage,
          lexicalRatio: computeContentComposition(item.request.text)
            .lexicalRatio,
          stdDev: aggregation.stdDev,
          chunkAgreement: aggregation.chunkAgreement,
          truncated: aggregation.truncated,
          exactTokenizer: item.exact,
          backendError: false,
          artifactMismatch: false,
        })
      : first.evidence;
  const base: ClassificationResult = {
    ...first,
    wordCount,
    tokenCount: item.tokenCount,
    language: item.language,
    chunks: chunkResults,
    aggregation,
    evidence,
    processingTimeMs: performance.now() - startedAt,
  };
  const calibrationStartedAt = performance.now();
  // Registry-aware calibration is the pipeline's honesty gate: any classifier
  // without a benchmark-verified calibration (the stylometric heuristic, the
  // demo mock, an unbenchmarked real model) is capped to the indicator-only
  // action ceiling here, regardless of score, word count or user settings.
  const decision = calibrateWithRegistry(base, calibration, {
    platform: item.request.platform,
  });
  const explanation = buildExplanation(base, decision);
  const classifierEvidence = collectClassifierReasonCodes(classified);
  const calibrationMs = performance.now() - calibrationStartedAt;
  return {
    ...base,
    status: decision.status,
    decision,
    explanation: {
      ...explanation,
      reasonCodes: [
        ...new Set([...explanation.reasonCodes, ...classifierEvidence]),
      ],
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

/**
 * Evidence the classifier itself computed for the chunks of one request (for
 * example the stylometric signal codes). The pipeline only relays codes a
 * backend actually calculated; it never invents stylistic reasons on its own.
 * A code must fire on at least half of the chunks (rounded up) to be relayed:
 * the final explanation speaks about the whole post, so a signal observed on
 * a single chunk of a long post is a chunk-local artifact, not evidence.
 */
function collectClassifierReasonCodes(
  classified: ClassificationResult[],
): ReasonCode[] {
  const chunkQuorum = Math.ceil(classified.length / 2);
  const codeCounts = new Map<ReasonCode, number>();
  for (const result of classified) {
    for (const code of new Set(result.explanation?.reasonCodes ?? [])) {
      codeCounts.set(code, (codeCounts.get(code) ?? 0) + 1);
    }
  }
  return [...codeCounts.entries()]
    .filter(([, count]) => count >= chunkQuorum)
    .map(([code]) => code);
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
  const identity =
    classifier.getRuntimeIdentity?.() ?? buildBuiltinIdentity(metadata);
  return {
    aiScore: 0,
    humanScore: 0,
    confidence: "low",
    status: "insufficient_evidence",
    wordCount,
    tokenCount: 0,
    language,
    runtimeIdentity: identity,
    evidence: buildBuiltinEvidence(request.text, {
      quality: "unsupported",
      coverage: 0,
      reasonCodes: ["UNSUPPORTED_LANGUAGE"],
    }),
    decision: buildBuiltinDecision({
      status: "insufficient_evidence",
      calibratedScore: 0,
      abstained: true,
      reasonCodes: ["INSUFFICIENT_EVIDENCE"],
    }),
    modelVersion: metadata.version,
    modelId: metadata.id,
    backend: metadata.backend,
    processingTimeMs: 0,
    demo: metadata.backend === "mock",
    explanation: {
      reasonCodes: ["INSUFFICIENT_EVIDENCE"] satisfies ReasonCode[],
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
  options: InferenceWorkerRuntimeOptions = {},
): void {
  const runtime = new WorkerRuntime(runnerFactory, options);
  const controllers = new Map<string, AbortController>();
  let runtimeInitialization: Promise<void> | undefined;

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

    if (request.type === "INITIALIZE") {
      runtimeInitialization = runtime.initialize(
        request.payload,
        configureRuntime,
      );
    }
    void handleMessage(
      request,
      runtime,
      controllers,
      scope,
      runtimeInitialization,
    );
  });
}

async function handleMessage(
  request: Exclude<WorkerRequest, { type: "CANCEL" }>,
  runtime: WorkerRuntime,
  controllers: Map<string, AbortController>,
  scope: InferenceWorkerScope,
  runtimeInitialization: Promise<void> | undefined,
): Promise<void> {
  const batchItems =
    request.type === "CLASSIFY"
      ? "requests" in request.payload
        ? request.payload.requests
        : [{ requestId: request.requestId, payload: request.payload }]
      : [];
  try {
    if (request.type === "INITIALIZE") {
      scope.postMessage({
        type: "STATUS",
        requestId: request.requestId,
        payload: unavailableStatus("initializing"),
      });
      await runtimeInitialization;
      scope.postMessage({
        type: "STATUS",
        requestId: request.requestId,
        payload: runtime.getStatus(),
      });
      return;
    }
    if (request.type === "STATUS") {
      scope.postMessage({
        type: "STATUS",
        requestId: request.requestId,
        payload: runtime.getStatus(),
      });
      return;
    }
    if (request.type === "DISPOSE") {
      scope.postMessage({
        type: "STATUS",
        requestId: request.requestId,
        payload: unavailableStatus("disposing"),
      });
      await runtime.dispose();
      scope.postMessage({
        type: "STATUS",
        requestId: request.requestId,
        payload: runtime.getStatus(),
      });
      return;
    }

    if (request.type === "CLASSIFY") {
      if (runtimeInitialization === undefined) {
        throw new CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED");
      }
      await runtimeInitialization;
      if (runtime.getStatus().state !== "ready") {
        throw new CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED");
      }
    }

    const items = batchItems;
    const settings = items[0]?.payload.settings ?? {
      ...DEFAULT_SETTINGS,
      languageMode: "experimental_any",
    };
    for (const item of items)
      controllers.set(item.requestId, new AbortController());
    const outcomes = await runtime.runClassification((runner) =>
      runner.classifyBatchSettled(
        items.map((item) => ({
          request: item.payload,
          signal: controllers.get(item.requestId)?.signal,
        })),
        settings,
      ),
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
    if (request.type === "INITIALIZE") {
      scope.postMessage({
        type: "STATUS",
        requestId: request.requestId,
        payload: runtime.getStatus(),
      });
    }
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

class WorkerRuntime {
  private runner: PipelineRunner;
  private lifecycle: ClassifierLifecycleManager | undefined;
  private status: ModelStatus;
  private operation = Promise.resolve();
  private readonly inflight = new Set<Promise<unknown>>();

  constructor(
    private readonly runnerFactory: () => PipelineRunner,
    private readonly options: InferenceWorkerRuntimeOptions,
  ) {
    this.runner = runnerFactory();
    this.status = readyStatus(this.runner);
  }

  initialize(
    payload: WorkerInitializePayload,
    configureRuntime: RuntimeConfigurator,
  ): Promise<void> {
    return this.serialize(async () => {
      this.status = unavailableStatus("initializing");
      try {
        if (this.inflight.size > 0) await this.drainInflight();
        await configureRuntime(payload);
        const manifest = payload.modelManifest;
        if (manifest === undefined) {
          if (await this.disposeLifecycle()) this.runner = this.runnerFactory();
          await this.runner.initialize();
          this.status = readyStatus(this.runner);
          return;
        }

        await this.disposeLifecycle();
        const selector = new BackendSelector(
          (this.options.backendFactory ?? createLocalBackendFactory)(manifest),
        );
        const lifecycle = new ClassifierLifecycleManager(selector);
        this.lifecycle = lifecycle;
        const settings = backendSettings(payload.settings);
        const selection = await lifecycle.initialize({
          preference: settings.backendPreference,
          webGpuEnabled: settings.webGpuEnabled,
          wasmEnabled: settings.wasmEnabled,
          hasWebGpu: (this.options.hasWebGpu ?? hasWebGpu)(),
        });
        this.runner = new PipelineRunner({
          classifier: selection.classifier,
          initialized: true,
          // A bundle runtime is the sealed TMR model: chunk with its manifest
          // window plan (510 content / 64 overlap / 512 total), never the
          // editable settings fields.
          chunkPlan: tmrChunkOptions(),
        });
        this.status = lifecycle.getStatus();
      } catch (error) {
        this.status = unavailableStatus("error", ["BACKEND_ERROR"]);
        throw error;
      }
    });
  }

  dispose(): Promise<void> {
    return this.serialize(async () => {
      this.status = unavailableStatus("disposing");
      try {
        if (this.inflight.size > 0) await this.drainInflight();
        const releasedLifecycle = await this.disposeLifecycle();
        if (!releasedLifecycle) await this.runner.dispose();
        this.runner = this.runnerFactory();
        this.status = unavailableStatus("unavailable");
      } catch (error) {
        this.status = unavailableStatus("error", ["BACKEND_ERROR"]);
        throw error;
      }
    });
  }

  runClassification<T>(
    work: (runner: PipelineRunner) => Promise<T>,
  ): Promise<T> {
    const active = work(this.runner);
    this.inflight.add(active);
    const settle = (): void => {
      this.inflight.delete(active);
    };
    active.then(settle, settle);
    return active;
  }

  getStatus(): ModelStatus {
    return { ...this.status };
  }

  private async drainInflight(): Promise<void> {
    if (this.inflight.size === 0) return;
    await Promise.allSettled([...this.inflight]);
  }

  private async disposeLifecycle(): Promise<boolean> {
    if (this.lifecycle === undefined) return false;
    await this.lifecycle.dispose();
    this.lifecycle = undefined;
    return true;
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

function backendSettings(
  settings: WorkerBackendSettings | undefined,
): WorkerBackendSettings {
  return (
    settings ?? {
      backendPreference: "auto",
      webGpuEnabled: true,
      wasmEnabled: true,
    }
  );
}

/**
 * The sealed TMR window plan expressed as chunker options. `contentTokens` is
 * the per-window chunk size; the two special tokens raise it to the model's
 * `modelMaxTokens` budget. These are pinned by the manifest, not user settings.
 */
function tmrChunkOptions(): TextChunkOptions {
  const plan = createTmrChunkPlan(bundledModelManifest.windowing);
  return {
    chunkSizeTokens: plan.contentTokens,
    overlapTokens: plan.overlapTokens,
    maximumTokens: plan.modelMaxTokens,
  };
}

function createLocalBackendFactory(
  manifest: CleanFeedModelManifest,
): BackendFactory {
  return {
    wasm: () =>
      new OnnxTextClassifier(
        manifest,
        new TransformersJsModelGateway(),
        "wasm",
      ),
    webgpu: () =>
      new OnnxTextClassifier(
        manifest,
        new TransformersJsModelGateway(),
        "webgpu",
      ),
  };
}

function hasWebGpu(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { gpu?: unknown }).gpu !== undefined
  );
}

function unavailableStatus(
  state: Exclude<ModelStatus["state"], "ready"> = "unavailable",
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

function readyStatus(runner: PipelineRunner): ModelStatus {
  const metadata = runner.getMetadata();
  return {
    state: "ready" as const,
    backend: metadata.backend,
    runtimeIdentity: runner.getRuntimeIdentity(),
    // No verified calibration ships in the MVP, so no coordinates are covered.
    calibrationCoverage: "none",
    calibrationSetDigest: null,
    profileCount: 0,
    earliestExpiry: null,
    reasonCodes: [],
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
