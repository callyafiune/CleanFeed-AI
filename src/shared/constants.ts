import type { UserSettings } from "@/shared/settings-types";

export const MAX_CLASSIFICATION_TEXT_LENGTH = 100_000;
export const MAX_REQUEST_ID_LENGTH = 128;
export const MAX_PLATFORM_ID_LENGTH = 128;
/** RFC 1035 caps a hostname at 253 characters; nothing longer is a hostname. */
export const MAX_HOSTNAME_LENGTH = 253;

/**
 * The largest token budget a window may use. The TMR release declares 512
 * (510 content tokens plus two measured special tokens), so the editable
 * settings and the chunker accept up to this capacity. The calibrated TMR path
 * IGNORES the editable fields and always uses the manifest window plan; these
 * limits only bound the experimental/builtin runtimes.
 */
export const MODEL_MAX_TOKENS = 512;

export const CLEANFEED_ATTRIBUTES = {
  state: "data-cleanfeed-state",
  hash: "data-cleanfeed-hash",
  version: "data-cleanfeed-version",
  owned: "data-cleanfeed-owned",
} as const;

export const SETTINGS_STORAGE_KEYS = {
  global: "cleanfeed.settings.v1",
  platform: "cleanfeed.platform-settings.v1",
} as const;

export const SETTINGS_LIMITS = {
  minimumWordCount: { minimum: 50, maximum: 5_000 },
  wasmConcurrency: { minimum: 1, maximum: 1 },
  webGpuConcurrency: { minimum: 1, maximum: 4 },
  maximumQueueSize: { minimum: 1, maximum: 500 },
  maximumPostsPerMinute: { minimum: 1, maximum: 30 },
  chunkSizeTokens: { minimum: 32, maximum: MODEL_MAX_TOKENS },
  maximumTokens: { minimum: 32, maximum: MODEL_MAX_TOKENS },
  inferenceTimeoutMs: { minimum: 1_000, maximum: 120_000 },
  cacheMaximumEntries: { minimum: 10, maximum: 5_000 },
  cacheTtlMs: { minimum: 60_000, maximum: 2_592_000_000 },
  historyRetentionDays: { minimum: 1, maximum: 3_650 },
} as const;

export const DEFAULT_SETTINGS: UserSettings = {
  enabled: true,
  minimumWordCount: 100,
  languageMode: "portuguese_only",
  presentationMode: "indicator",
  processVisibleOnly: true,
  experimentalShortTextDetection: false,
  manualAnalysisEnabled: true,
  showScore: false,
  showExplanation: true,
  debugMode: false,
  backendPreference: "auto",
  webGpuEnabled: true,
  wasmEnabled: true,
  useMockModel: false,
  wasmConcurrency: 1,
  webGpuConcurrency: 2,
  maximumQueueSize: 50,
  maximumPostsPerMinute: 30,
  batchingEnabled: false,
  chunkSizeTokens: 510,
  chunkOverlapTokens: 64,
  maximumTokens: 512,
  inferenceTimeoutMs: 20_000,
  cacheMaximumEntries: 500,
  cacheTtlMs: 604_800_000,
  historyEnabled: false,
  historyRetentionDays: 30,
  storeFullText: false,
};
