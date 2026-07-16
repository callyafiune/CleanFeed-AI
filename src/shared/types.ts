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
  reasonCodes: ReasonCode[];
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
  decision?: DecisionOutcome;
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
}

export interface BatchTextClassifier extends TextClassifier {
  classifyBatch(
    texts: string[],
    options?: ClassificationOptions,
  ): Promise<ClassificationResult[]>;
}

export interface ModelStatus {
  state: "unavailable" | "initializing" | "ready" | "error";
  classifierId: string;
  modelVersion: string;
  backend: Backend;
  fallbackFrom?: "webgpu";
  errorCode?: ErrorCode;
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
