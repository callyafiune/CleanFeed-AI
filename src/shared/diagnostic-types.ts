import type { BackendPreference } from "@/shared/settings-types";
import type {
  AggregateMetricsSnapshot,
  Backend,
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
  modelStatus: DiagnosticModelStatus | null;
  platforms: string[];
  settingsSummary: DiagnosticSettingsSummary;
}

export interface DiagnosticExtensionInfo {
  version: string;
  /** Aggregate "Chrome X / OS" string, present only when the runtime exposes it. */
  runtime?: string;
}

export interface DiagnosticModelStatus {
  state: ModelStatus["state"];
  backend: Backend;
  modelVersion: string;
  classifierId: string;
  supportsBatching: boolean;
}

/**
 * Settings reduced to booleans, numeric limits and enumerated modes. No free-form
 * or user-supplied text is included, so the summary is always safe to share.
 */
export interface DiagnosticSettingsSummary {
  enabled: boolean;
  processVisibleOnly: boolean;
  experimentalShortTextDetection: boolean;
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
  markingThreshold: number;
  blurThreshold: number;
  collapseThreshold: number;
  hideThreshold: number;
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
