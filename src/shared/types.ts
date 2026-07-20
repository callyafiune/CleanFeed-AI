import type { ErrorCode } from "@/shared/errors";
import type { EffectiveSettings } from "@/shared/settings-types";

export type ClassificationStatus =
  | "probably_human"
  | "inconclusive"
  | "possibly_ai"
  | "strong_ai_indication"
  | "insufficient_evidence"
  | "classification_failed";

export type PresentationMode = "indicator" | "blur" | "collapse" | "hide";
export type LanguageMode =
  "portuguese_only" | "model_supported" | "experimental_any";
export type Backend = "mock" | "wasm" | "webgpu";
export type Confidence = "low" | "medium" | "high";
export type LengthBucket =
  "50_79" | "80_99" | "100_149" | "150_299" | "300_PLUS";

export type ReasonCode =
  | "HIGH_CHUNK_CONSISTENCY"
  | "MOST_CHUNKS_ABOVE_THRESHOLD"
  | "HIGH_AVERAGE_SCORE"
  | "HIGH_MEDIAN_SCORE"
  | "FORMULAIC_STRUCTURE"
  | "LOW_SENTENCE_LENGTH_VARIATION"
  | "REPETITIVE_TRANSITIONS"
  | "LISTICLE_PATTERN"
  | "EXCESSIVE_HASHTAGS"
  | "CUSTOM_KEYWORD_RULE"
  | "INSUFFICIENT_EVIDENCE"
  | "LOW_MODEL_CONFIDENCE"
  | "CHUNK_DISAGREEMENT";

/**
 * Full runtime identity of the model that produced a result. A `bundle`
 * identity seals every coordinate that invalidates a calibration profile; a
 * `builtin` identity names the two demonstration-grade classifiers. The
 * `builtin.modelId` union is deliberately closed to `"mock" | "stylometric"`.
 */
export type RuntimeModelIdentity =
  | {
      kind: "bundle";
      modelId: string;
      modelVersion: string;
      bundleDigest: string;
      tokenizerDigest: string;
      aggregationVersion: string;
      contentCompositionVersion: string;
      calibrationSetDigest: string;
    }
  | {
      kind: "builtin";
      modelId: "mock" | "stylometric";
      modelVersion: string;
      implementationVersion: string;
    };

export type EvidenceQuality = "sufficient" | "limited" | "unsupported";
export type DecisionTrigger = "document" | "localized";

/**
 * Reason codes attached to an evidence assessment or a decision. This is a
 * SUPERSET: it enumerates every legacy {@link ReasonCode} (so the existing
 * calibration engine's codes remain valid) plus the model-evidence codes the
 * TMR runtime introduces and `WEBGPU_FALLBACK`, which surfaces a WebGPU→WASM
 * fallback on a {@link ModelStatus}.
 */
export type DecisionReasonCode =
  | ReasonCode
  | "LOCALIZED_SIGNAL"
  | "LIMITED_EVIDENCE"
  | "UNSUPPORTED_LANGUAGE"
  | "TEXT_TOO_SHORT"
  | "LOW_COVERAGE"
  | "TRUNCATED_INPUT"
  | "TOKENIZER_APPROXIMATE"
  | "NON_LEXICAL_CONTENT"
  | "MODEL_PROFILE_MISSING"
  | "MODEL_PROFILE_MISMATCH"
  | "PROFILE_EXPIRED"
  | "BACKEND_ERROR"
  | "ARTIFACT_MISMATCH"
  | "DOCUMENT_EVIDENCE_PENDING"
  | "CIRCUIT_BREAKER_OPEN"
  | "WEBGPU_FALLBACK";

/**
 * The evidence quality behind a decision. The REAL distributed assessment
 * (coverage/agreement over windows, OOD) lands in a later task; builtins
 * report a conservative `limited` assessment today.
 */
export interface EvidenceAssessment {
  quality: EvidenceQuality;
  coverage: number;
  lexicalRatio: number;
  truncated: boolean;
  exactTokenizer: boolean;
  reasonCodes: DecisionReasonCode[];
}

export interface TextLengthInfo {
  characterCount: number;
  wordCount: number;
  tokenCount?: number;
}

export interface EligibilityResult {
  eligible: boolean;
  reason:
    | "ELIGIBLE"
    | "BELOW_MINIMUM_LENGTH"
    | "MOSTLY_LINKS"
    | "MOSTLY_HASHTAGS"
    | "MOSTLY_EMOJIS"
    | "UNSUPPORTED_LANGUAGE"
    | "DUPLICATE_CONTENT"
    | "EXTENSION_DISABLED"
    | "DOMAIN_DISABLED"
    | "MODEL_UNAVAILABLE"
    | "EXTRACTION_FAILED"
    | "INSUFFICIENT_CONTENT";
}

export interface TextChunk {
  index: number;
  startToken: number;
  endToken: number;
  text: string;
}

export interface ChunkResult {
  index: number;
  startToken: number;
  endToken: number;
  aiScore: number;
  humanScore: number;
  processingTimeMs: number;
}

export interface AggregationResult {
  finalScore: number;
  weightedMean: number;
  median: number;
  maximum: number;
  minimum: number;
  standardDeviation: number;
  highScoreRatio: number;
  chunkAgreement: number;
}

export interface ClassificationExplanation {
  reasonCodes: ReasonCode[];
  chunkAgreement?: number;
  chunksAboveThreshold?: number;
  totalChunks?: number;
  modelScore: number;
  calibratedScore: number;
  ruleScore?: number;
  calibrationProfile: string;
}

export interface DecisionOutcome {
  status: ClassificationStatus;
  calibratedScore: number;
  actionCeiling: PresentationMode;
  abstained: boolean;
  /**
   * Whether the decision permits presenting a result at all. Mirrors current
   * behaviour: a non-abstained decision is presentable (at its ceiling). The
   * profile-driven presentation gate is a later task.
   */
  presentationAllowed: boolean;
  /**
   * Which aggregation paths fired (document/localized). The distributed
   * aggregation that populates this lands in a later task; today it is empty.
   */
  triggers: DecisionTrigger[];
  reasonCodes: DecisionReasonCode[];
}

export interface ClassificationResult {
  aiScore: number;
  humanScore: number;
  confidence: Confidence;
  status: ClassificationStatus;
  wordCount: number;
  tokenCount: number;
  language?: string;
  chunks?: ChunkResult[];
  aggregation?: AggregationResult;
  explanation?: ClassificationExplanation;
  /** Full identity of the model that produced this result. */
  runtimeIdentity: RuntimeModelIdentity;
  /** The evidence behind the decision (conservative for builtins today). */
  evidence: EvidenceAssessment;
  /** The final decision. Required: every result carries an explicit outcome. */
  decision: DecisionOutcome;
  /** Digest of the calibration profile used for THIS request only (never global). */
  selectedProfileDigest?: string;
  /** Upper bound on cache validity, set from the selected profile's expiry. */
  cacheValidUntil?: string;
  modelVersion: string;
  modelId: string;
  backend: Backend;
  processingTimeMs: number;
  stageTimings?: {
    languageMs: number;
    tokenizationMs: number;
    chunkingMs: number;
    inferenceMs: number;
    aggregationMs: number;
    calibrationMs: number;
  };
  errorCode?: ErrorCode;
  demo: boolean;
}

export interface ClassificationOptions {
  signal?: AbortSignal;
  language?: string;
  platform?: string;
}

export interface ClassifierMetadata {
  id: string;
  name: string;
  version: string;
  backend: Backend;
  quantization?: "none" | "int8" | "int4";
  supportedLanguages: string[];
  maximumTokens: number;
  supportsBatching: boolean;
}

export interface TextClassifier {
  initialize(): Promise<void>;
  classify(
    text: string,
    options?: ClassificationOptions,
  ): Promise<ClassificationResult>;
  dispose(): Promise<void>;
  getMetadata(): ClassifierMetadata;
  /**
   * Full runtime identity of this classifier. Optional: builtin classifiers
   * are identified from their metadata via a shared helper; a bundle-backed
   * classifier (ONNX) overrides this to expose its sealed bundle identity.
   */
  getRuntimeIdentity?(): RuntimeModelIdentity;
}

export interface BatchTextClassifier extends TextClassifier {
  classifyBatch(
    texts: string[],
    options?: ClassificationOptions,
  ): Promise<ClassificationResult[]>;
}

export interface ModelStatus {
  state:
    | "unavailable"
    | "initializing"
    | "ready"
    | "degraded"
    | "disposing"
    | "error";
  backend: Backend;
  /** Identity of the loaded model, or null before one is initialized. */
  runtimeIdentity: RuntimeModelIdentity | null;
  /** Coverage of the declared release coordinates by valid profiles. */
  calibrationCoverage: "none" | "partial" | "complete";
  calibrationSetDigest: string | null;
  profileCount: number;
  earliestExpiry: string | null;
  /** Status-level reason codes (e.g. WEBGPU_FALLBACK, a backend error code). */
  reasonCodes: DecisionReasonCode[];
  initializedAt?: number;
  supportsBatching?: boolean;
}

export interface PerformanceTrace {
  extractionMs: number;
  normalizationMs: number;
  eligibilityMs: number;
  hashingMs: number;
  queueWaitMs: number;
  languageDetectionMs: number;
  tokenizationMs: number;
  inferenceMs: number;
  aggregationMs: number;
  presentationMs: number;
  totalMs: number;
}

export interface AggregateMetrics {
  postsDetected: number;
  postsAnalyzed: number;
  postsSkipped: number;
  skippedByLength: number;
  skippedByLanguage: number;
  cacheHits: number;
  cacheMisses: number;
  inferenceFailures: number;
  cancelledTasks: number;
  revealedPosts: number;
  averageInferenceMs: number;
  medianInferenceMs: number;
  resultsByStatus: Record<ClassificationStatus, number>;
  backendUsage: Record<string, number>;
}

/**
 * The aggregate metrics `MetricsRepository.get()` exposes: every field of
 * {@link AggregateMetrics} plus the approximate high percentiles, the largest
 * observed queue size and the per-model usage tally. None of these can carry
 * post text, hashes or URLs. Declared here (beside its base) so the `shared`
 * layer stays self-contained and storage/diagnostics import it, not vice versa.
 */
export interface AggregateMetricsSnapshot extends AggregateMetrics {
  p90InferenceMs: number;
  p95InferenceMs: number;
  maximumQueueSize: number;
  modelUsage: Record<string, number>;
}

export interface CachedClassification {
  result: ClassificationResult;
  createdAt: number;
  lastAccessedAt: number;
  expiresAt: number;
}

export interface LanguageDetectionResult {
  language: string;
  confidence: number;
  supported: boolean;
}

export interface CalibrationProfile {
  id: string;
  platform: string;
  language: string;
  lengthBucket: LengthBucket;
  markingThreshold: number;
  blurThreshold: number;
  collapseThreshold: number;
  hideThreshold: number;
}

export interface InferenceTask {
  id: string;
  textHash: string;
  text: string;
  platform: string;
  priority: number;
  createdAt: number;
  signal?: AbortSignal;
}

export interface ExtractedPost {
  platform: string;
  postId?: string;
  text: string;
  element: HTMLElement;
}

export interface PageStats {
  platform: string | null;
  postsFound: number;
  analyzed: number;
  skippedByLength: number;
  skippedByLanguage: number;
  marked: number;
  blurred: number;
  collapsed: number;
  hidden: number;
  restored: number;
  averageInferenceMs: number;
  queueSize: number;
}

export interface PlatformAdapter {
  id: string;
  matches(url: URL): boolean;
  findFeedRoot(document: Document): HTMLElement | null;
  findPostElements(root: ParentNode): HTMLElement[];
  extractPost(element: HTMLElement): ExtractedPost | null;
  applyPresentation(
    element: HTMLElement,
    result: ClassificationResult,
    settings: EffectiveSettings,
  ): void;
  restorePresentation(element: HTMLElement): void;
  isPostElement(element: HTMLElement): boolean;
}

export interface StorageArea {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(keys: string | string[]): Promise<void>;
  getMany<T>(keys: string[]): Promise<Record<string, T>>;
}

export interface Clock {
  now(): number;
}

/** How a history row was produced: AI classification or a personal rule. */
export type HistoryOrigin = "ai" | "rule";

/** The user's local, non-identifying verdict recorded alongside a history row. */
export type HistoryFeedbackVerdict = "human" | "ai" | "unknown";

/**
 * One row of the optional local history. It carries only a content hash plus the
 * minimal metadata needed to render a diagnostics list. It MUST never hold the
 * post's text, author or URL. Opted-in full text (only when the user enables it)
 * is stored under a separate storage key and is never part of a row.
 */
export interface HistoryEntry {
  textHash: string;
  platform: string;
  status: ClassificationStatus;
  score: number;
  timestamp: number;
  origin?: HistoryOrigin;
  action?: PresentationMode;
  revealed?: boolean;
  feedback?: HistoryFeedbackVerdict;
}

/**
 * The MVP personalization boundary. Feedback is collect-only: it never adjusts
 * thresholds nor trains a classifier. The named future stages
 * (`threshold_adjustment` for 20–99 samples, `auxiliary_classifier` for 100+)
 * remain disabled until a dedicated spec and an explicit opt-in exist.
 */
export interface PersonalizationStage {
  stage: "collect_only" | "threshold_adjustment" | "auxiliary_classifier";
  appliesThresholdAdjustment: boolean;
  trainsAuxiliaryClassifier: boolean;
}
