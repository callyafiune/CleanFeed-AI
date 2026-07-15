import type { UserSettings } from "@/shared/settings-types";

export const MAX_CLASSIFICATION_TEXT_LENGTH = 100_000;
export const MAX_REQUEST_ID_LENGTH = 128;
export const MAX_PLATFORM_ID_LENGTH = 128;

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
  chunkSizeTokens: { minimum: 32, maximum: 256 },
  maximumTokens: { minimum: 32, maximum: 256 },
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
  markingThreshold: 0.8,
  blurThreshold: 0.92,
  collapseThreshold: 0.96,
  hideThreshold: 0.99,
  processVisibleOnly: true,
  experimentalShortTextDetection: false,
  manualAnalysisEnabled: true,
  showScore: false,
  showExplanation: true,
  backendPreference: "auto",
  webGpuEnabled: true,
  wasmEnabled: true,
  wasmConcurrency: 1,
  webGpuConcurrency: 2,
  maximumQueueSize: 50,
  maximumPostsPerMinute: 30,
  batchingEnabled: false,
  chunkSizeTokens: 192,
  chunkOverlapTokens: 32,
  maximumTokens: 256,
  inferenceTimeoutMs: 20_000,
  cacheMaximumEntries: 500,
  cacheTtlMs: 604_800_000,
  historyEnabled: false,
  historyRetentionDays: 30,
  storeFullText: false,
};
