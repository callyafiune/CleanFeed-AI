import type { UserSettings } from "@/shared/settings-types";

export const MAX_CLASSIFICATION_TEXT_LENGTH = 100_000;
export const MAX_REQUEST_ID_LENGTH = 128;
export const MAX_PLATFORM_ID_LENGTH = 128;

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
