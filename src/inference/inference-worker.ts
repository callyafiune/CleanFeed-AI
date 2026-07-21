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
  calibrateResult,
  contractLengthBucket,
  decideWithProfile,
  getLengthBucket,
  type ProfileDecision,
} from "@/inference/calibration";
import { bundledModelManifest } from "@/inference/bundled-model-metadata";
import type {
  CalibrationCoordinates,
  CalibrationRegistry,
  ProfileLookup,
} from "@/inference/calibration-registry";
import { createTextChunks, type TextChunkOptions } from "@/inference/chunker";
import { assessEvidence } from "@/inference/evidence";
import {
  createTmrChunkPlan,
  type LoadedTransformersTokenizer,
} from "@/inference/model-runtime";
import {
  authorizesTmrPrimary,
  buildCalibratedRuntimeParts,
  type TokenizerLoader,
} from "@/inference/runtime-activation";
import { computeContentComposition } from "../../contracts/content-composition";
import {
  evaluateLanguagePolicy,
  HeuristicPortugueseDetector,
  type LanguageDetector,
} from "@/inference/language-detector";
import {
  crossValidateRuntimeDescriptor,
  type CleanFeedModelManifest,
  type RuntimeDescriptor,
} from "@/inference/model-bundle";
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
  DecisionOutcome,
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
  /**
   * The authoritative SEALED bundle identity for the calibrated (TMR) path.
   * When present it OVERRIDES the classifier's self-reported identity so the
   * calibration coordinates, the emitted `runtimeIdentity` and the cache key all
   * use the v2 bundle digests the profiles were measured against — the ONNX
   * classifier only knows its v1 manifest. The builtin/stylometric runtimes
   * leave it undefined and keep their own identity.
   */
  identity?: RuntimeModelIdentity;
}

type RuntimeConfigurator = (
  paths: WorkerInitializePayload,
) => void | Promise<void>;

export interface InferenceWorkerRuntimeOptions {
  hasWebGpu?: () => boolean;
  backendFactory?: (manifest: CleanFeedModelManifest) => BackendFactory;
  /**
   * How the calibrated TMR path loads the raw Transformers.js tokenizer for its
   * ExactTokenizer. Defaults to the offline `AutoTokenizer` loader; tests inject
   * a fake so the calibrated wiring can be exercised without the real bundle.
   */
  loadTokenizer?: TokenizerLoader;
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
  private readonly calibration: CalibrationRegistry | undefined;
  private readonly chunkPlan: TextChunkOptions | undefined;
  private readonly identity: RuntimeModelIdentity | undefined;
  private initialized?: Promise<void>;

  constructor(options: PipelineRunnerOptions = {}) {
    // The fallback backend is the transparent stylometric heuristic: real,
    // explainable signals, but still an uncalibrated indicator — never a
    // validated detector.
    this.classifier = options.classifier ?? new StylometricClassifier();
    this.detector = options.detector ?? new HeuristicPortugueseDetector();
    this.tokenizer = options.tokenizer ?? new HeuristicTokenizer();
    // Undefined by default: with no verified calibration release loaded, the
    // calibrated TMR path fails closed (abstains) and builtins may only
    // indicate — every decision leaves this pipeline unable to act on the feed.
    this.calibration = options.calibration;
    this.chunkPlan = options.chunkPlan;
    // The sealed bundle identity, present only for the calibrated TMR primary.
    this.identity = options.identity;
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
      this.identity ??
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
            this.identity,
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
          this.identity,
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
  calibration: CalibrationRegistry | undefined,
  identity: RuntimeModelIdentity | undefined,
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
  // The calibrated TMR path stamps the SEALED bundle identity over the ONNX
  // classifier's v1 self-report, so evidence, decision coordinates and the
  // emitted identity all agree with the profiles' measured coordinates.
  const runtimeIdentity = identity ?? first.runtimeIdentity;
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
  // The calibrated TMR (bundle) path derives its evidence from the shared, pure
  // assessor over the EXACT native-offset tokenization (`item.exact`); the
  // demonstration builtins keep their own conservative `limited` evidence.
  const evidence =
    runtimeIdentity.kind === "bundle"
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
    runtimeIdentity,
    wordCount,
    tokenCount: item.tokenCount,
    language: item.language,
    chunks: chunkResults,
    aggregation,
    evidence,
    processingTimeMs: performance.now() - startedAt,
  };
  const calibrationStartedAt = performance.now();
  // The decision is authoritative. The calibrated bundle (TMR) path applies the
  // EXACT profile via the release-bound registry or fails closed; the builtin
  // heuristics (stylometric/mock) are uncalibrated and can only ever indicate.
  const profileDecision: ProfileDecision =
    base.runtimeIdentity.kind === "bundle"
      ? decideBundle(
          base,
          base.runtimeIdentity,
          item.request.platform,
          calibration,
        )
      : { outcome: capToIndicator(calibrateResult(base)) };
  const decision = profileDecision.outcome;
  const explanation = buildExplanation(base, decision);
  const classifierEvidence = collectClassifierReasonCodes(classified);
  const calibrationMs = performance.now() - calibrationStartedAt;
  return {
    ...base,
    status: decision.status,
    decision,
    // The applied profile's digest and expiry are emitted ONLY when a real TMR
    // profile actually drove this verdict, so a cached positive verdict can
    // never outlive the calibration it rode on. Abstentions and the
    // uncalibrated builtins leave both fields undefined.
    ...(profileDecision.appliedProfile
      ? {
          selectedProfileDigest: profileDecision.appliedProfile.profileDigest,
          cacheValidUntil: profileDecision.appliedProfile.expiresAt,
        }
      : {}),
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

type BundleIdentity = Extract<RuntimeModelIdentity, { kind: "bundle" }>;

/**
 * Resolves the calibrated (TMR) decision. Without a loaded, release-bound
 * registry the profile lookup is a typed miss and the rollout is treated as
 * `bundle-verified`, so {@link decideWithProfile} fails closed and abstains.
 */
function decideBundle(
  base: ClassificationResult,
  identity: BundleIdentity,
  platform: string,
  registry: CalibrationRegistry | undefined,
): ProfileDecision {
  const aggregation = base.aggregation ?? {
    version: "tmr-aggregation-v2" as const,
    documentRawScore: base.aiScore,
    localizedRawScore: base.aiScore,
    coverage: 0,
    truncated: false,
    weightedMean: base.aiScore,
    median: base.aiScore,
    min: base.aiScore,
    max: base.aiScore,
    stdDev: 0,
    highScoreRatio: 0,
    chunkAgreement: 1,
    candidateWindowCount: 0,
    selectedWindowIndices: [],
  };
  const coordinates: CalibrationCoordinates = {
    modelId: identity.modelId,
    modelVersion: identity.modelVersion,
    bundleDigest: identity.bundleDigest,
    tokenizerDigest: identity.tokenizerDigest,
    platform,
    locale: base.language,
    lengthBucket: contractLengthBucket(base.wordCount),
    aggregationVersion: identity.aggregationVersion,
    contentCompositionVersion: identity.contentCompositionVersion,
  };
  const lookup: ProfileLookup =
    registry === undefined
      ? { status: "missing", reason: "MODEL_PROFILE_MISSING" }
      : registry.findExact(coordinates, Date.now());
  const rolloutState = registry?.release.rolloutState ?? "bundle-verified";
  return decideWithProfile({
    lookup,
    aggregation,
    evidence: base.evidence,
    rolloutState,
    wordCount: base.wordCount,
  });
}

/** Uncalibrated builtins may only indicate: cap any stronger ceiling. */
function capToIndicator(outcome: DecisionOutcome): DecisionOutcome {
  return outcome.actionCeiling === "indicator"
    ? outcome
    : { ...outcome, actionCeiling: "indicator" };
}

/** The TMR abstentions that a per-request stylometric fallback answers once. */
const PROFILE_ABSTENTION_CODES: ReadonlySet<DecisionReasonCode> = new Set([
  "MODEL_PROFILE_MISSING",
  "MODEL_PROFILE_MISMATCH",
  "PROFILE_EXPIRED",
]);

/**
 * Applies the single per-request fallback: when the TMR (bundle) path abstains
 * because the EXACT profile is missing/expired/incompatible, run the stylometric
 * builtin ONCE to produce a NEW indicative result (builtin identity), preserving
 * the original TMR abstention reason in the decision diagnostic. Every other
 * outcome — a real TMR decision, or a content-unsupported abstention — is
 * returned unchanged (it never triggers the fallback and stays abstained).
 */
export async function classifyWithFallback(
  primary: ClassificationResult,
  runFallback: () => Promise<ClassificationResult>,
): Promise<ClassificationResult> {
  const abstainedOverProfile =
    primary.runtimeIdentity.kind === "bundle" &&
    primary.decision.abstained &&
    primary.decision.reasonCodes.some((code) =>
      PROFILE_ABSTENTION_CODES.has(code),
    );
  if (!abstainedOverProfile) {
    return primary;
  }
  const fallback = await runFallback();
  const preserved = primary.decision.reasonCodes.filter((code) =>
    PROFILE_ABSTENTION_CODES.has(code),
  );
  return {
    ...fallback,
    decision: {
      ...fallback.decision,
      reasonCodes: [
        ...new Set([...fallback.decision.reasonCodes, ...preserved]),
      ],
    },
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
        // Trust boundary: even though the offscreen document already validated
        // the descriptor, the worker revalidates its digests before opening any
        // asset. A divergent descriptor fails closed here.
        if (payload.descriptor !== undefined) {
          await crossValidateRuntimeDescriptor(payload.descriptor);
        }
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
        // Activate the calibrated TMR primary ONLY when the cross-validated
        // descriptor authorizes it (a promoted release with usable profiles).
        // That builds the ExactTokenizer-based ModelRuntime (native offsets +
        // sealed identity) and the release-bound CalibrationRegistry, so the
        // bundle path routes through `decideWithProfile`. Otherwise the pipeline
        // keeps the heuristic tokenizer and no registry, and the bundle decision
        // fails closed to the indicative stylometric fallback.
        const calibrated =
          payload.descriptor !== undefined &&
          authorizesTmrPrimary(payload.descriptor)
            ? await buildCalibratedRuntimeParts({
                classifier: selection.classifier,
                descriptor: payload.descriptor,
                loadTokenizer:
                  this.options.loadTokenizer ?? loadTransformersTokenizer,
              })
            : undefined;
        this.runner = new PipelineRunner({
          classifier: selection.classifier,
          initialized: true,
          // A bundle runtime is the sealed TMR model: chunk with its manifest
          // window plan (510 content / 64 overlap / 512 total), never the
          // editable settings fields.
          chunkPlan: tmrChunkOptions(),
          ...(calibrated
            ? {
                tokenizer: calibrated.tokenizer,
                calibration: calibrated.calibration,
                identity: calibrated.identity,
              }
            : {}),
        });
        // When the calibrated TMR primary is active, the published SET status
        // reflects that active promoted runtime: the sealed bundle identity the
        // calibrated decision rides on, plus the loaded calibration set's
        // coverage/digest/count/expiry. It never carries a per-post selected
        // profile. The builtin/experimental paths keep the lifecycle status
        // (builtin identity, no coverage) unchanged, so the fallback stays honest.
        this.status =
          calibrated !== undefined && payload.descriptor !== undefined
            ? {
                ...lifecycle.getStatus(),
                runtimeIdentity: calibrated.identity,
                ...summarizeCalibrationSet(payload.descriptor),
              }
            : lifecycle.getStatus();
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

/**
 * The offline default {@link TokenizerLoader}: loads the model's own
 * Transformers.js tokenizer from the extension-local bundle (never the network;
 * `configureTransformersEnvironment` has already pinned `local_files_only` and
 * disabled remote models before this runs).
 */
async function loadTransformersTokenizer(
  modelId: string,
): Promise<LoadedTransformersTokenizer> {
  const { AutoTokenizer } = await import("@huggingface/transformers");
  const tokenizer = await AutoTokenizer.from_pretrained(modelId, {
    local_files_only: true,
  });
  return tokenizer as unknown as LoadedTransformersTokenizer;
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

/**
 * The SET-level calibration facts for an ACTIVE promoted (TMR) runtime, derived
 * from the already cross-validated descriptor. A promoted release ships its full
 * catalog of unexpired, in-release profiles, so a loaded set is `complete`; the
 * digest, count and earliest expiry come straight from the sealed descriptor.
 * Per-post applicability (a missing bucket → abstain) is a decision concern and
 * is never conflated with the set status, and no selected profile is exposed.
 */
function summarizeCalibrationSet(
  descriptor: RuntimeDescriptor,
): Pick<
  ModelStatus,
  | "calibrationCoverage"
  | "calibrationSetDigest"
  | "profileCount"
  | "earliestExpiry"
> {
  const profiles = descriptor.profiles.profiles;
  let earliestExpiry: string | null = null;
  for (const profile of profiles) {
    if (
      earliestExpiry === null ||
      Date.parse(profile.expiresAt) < Date.parse(earliestExpiry)
    ) {
      earliestExpiry = profile.expiresAt;
    }
  }
  return {
    calibrationCoverage: profiles.length > 0 ? "complete" : "none",
    calibrationSetDigest: descriptor.release.calibrationSetDigest,
    profileCount: profiles.length,
    earliestExpiry,
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
