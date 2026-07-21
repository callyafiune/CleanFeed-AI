import type { ModelReleaseDescriptorV1 } from "../../contracts/model-release";
import type { BackendPreference } from "@/shared/settings-types";
import type {
  AggregateMetricsSnapshot,
  LanguageMode,
  ModelStatus,
  PresentationMode,
} from "@/shared/types";

/**
 * A sanitized, share-safe snapshot of the extension's state. It is defined as an
 * explicit allowlist: only the fields declared here are ever emitted, so browsing
 * data (post text, content hashes, authors, domains, URLs, cache keys, feedback,
 * history and stack traces) can never leak into a diagnostic report.
 */
export interface DiagnosticReport {
  extension: DiagnosticExtensionInfo;
  manifestPermissions: string[];
  metrics: AggregateMetricsSnapshot;
  /**
   * The active runtime status combined with the descriptor's rollout coordinates,
   * or null when no runtime is available. Reduced to the closed allowlist below,
   * so it never carries an individual score, `selectedProfileDigest`,
   * `cacheValidUntil`, post text, a URL, an author or a content hash.
   */
  modelStatus: ModelDiagnosticsView | null;
  platforms: string[];
  settingsSummary: DiagnosticSettingsSummary;
  /**
   * The TMR circuit breaker's state, present only when a breaker source is
   * available. It carries counters, bounded timestamps and a single reason
   * code — never post text, a URL, a hash or a stack trace.
   */
  circuitBreaker?: DiagnosticCircuitBreaker;
}

/**
 * A share-safe view of the circuit breaker. By construction it is limited to
 * numeric counters, a bounded list of failure timestamps and one enumerated
 * reason code, so it can never leak browsing data.
 */
export interface DiagnosticCircuitBreaker {
  open: boolean;
  failureCount: number;
  recentFailureTimestamps: number[];
  reasonCode: "CIRCUIT_BREAKER_OPEN" | null;
}

export interface DiagnosticExtensionInfo {
  version: string;
  /** Aggregate "Chrome X / OS" string, present only when the runtime exposes it. */
  runtime?: string;
}

/**
 * The active runtime status reduced to its closed, share-safe allowlist. It is a
 * `Pick` of {@link ModelStatus} so it always matches the Phase 1 contract, and it
 * deliberately excludes the per-result `selectedProfileDigest`/`cacheValidUntil`,
 * which belong to an individual {@link ClassificationResult}, never to status.
 * `calibrationSetDigest` is a technical digest of the calibration SET — never a
 * content hash.
 */
export type DiagnosticRuntimeStatus = Pick<
  ModelStatus,
  | "state"
  | "backend"
  | "runtimeIdentity"
  | "calibrationCoverage"
  | "calibrationSetDigest"
  | "profileCount"
  | "earliestExpiry"
  | "reasonCodes"
  | "initializedAt"
  | "supportsBatching"
>;

/**
 * The two rollout coordinates surfaced from the immutable release descriptor. The
 * active runtime status is never confused with this evidence stage: they travel
 * as distinct fields.
 */
export type DiagnosticReleaseStatus = Pick<
  ModelReleaseDescriptorV1,
  "gateDecision" | "rolloutState"
>;

/**
 * The sanitized diagnostics view: the active runtime status plus the descriptor's
 * rollout coordinates. This is the only model shape emitted to popup, options and
 * the diagnostic export.
 */
export interface ModelDiagnosticsView {
  status: DiagnosticRuntimeStatus;
  release: DiagnosticReleaseStatus;
}

/**
 * The unsanitized combined source the background and the repository run through
 * {@link sanitizeModelDiagnostics}. Callers may hand over a fuller object; only
 * the allowlisted fields are ever copied out.
 */
export interface ModelDiagnosticsSource {
  status: ModelStatus;
  release: DiagnosticReleaseStatus;
}

/**
 * Settings reduced to booleans, numeric limits and enumerated modes. No free-form
 * or user-supplied text is included, so the summary is always safe to share.
 */
export interface DiagnosticSettingsSummary {
  enabled: boolean;
  processVisibleOnly: boolean;
  experimentalShortTextDetection: boolean;
  experimentalUncalibratedTmr: boolean;
  manualAnalysisEnabled: boolean;
  showScore: boolean;
  showExplanation: boolean;
  debugMode: boolean;
  webGpuEnabled: boolean;
  wasmEnabled: boolean;
  useMockModel: boolean;
  batchingEnabled: boolean;
  historyEnabled: boolean;
  storeFullText: boolean;
  languageMode: LanguageMode;
  presentationMode: PresentationMode;
  backendPreference: BackendPreference;
  minimumWordCount: number;
  wasmConcurrency: number;
  webGpuConcurrency: number;
  maximumQueueSize: number;
  maximumPostsPerMinute: number;
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  maximumTokens: number;
  inferenceTimeoutMs: number;
  cacheMaximumEntries: number;
  cacheTtlMs: number;
  historyRetentionDays: number;
}
