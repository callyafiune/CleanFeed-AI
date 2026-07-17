import type { Backend, LanguageMode, PresentationMode } from "@/shared/types";

export type BackendPreference = "auto" | Exclude<Backend, "mock">;

export interface Thresholds {
  marking: number;
  blur: number;
  collapse: number;
  hide: number;
}

export interface UserSettings {
  enabled: boolean;
  minimumWordCount: number;
  languageMode: LanguageMode;
  presentationMode: PresentationMode;
  markingThreshold: number;
  blurThreshold: number;
  collapseThreshold: number;
  hideThreshold: number;
  processVisibleOnly: boolean;
  experimentalShortTextDetection: boolean;
  manualAnalysisEnabled: boolean;
  showScore: boolean;
  showExplanation: boolean;
  debugMode: boolean;
  backendPreference: BackendPreference;
  webGpuEnabled: boolean;
  wasmEnabled: boolean;
  useMockModel: boolean;
  wasmConcurrency: number;
  webGpuConcurrency: number;
  maximumQueueSize: number;
  maximumPostsPerMinute: number;
  batchingEnabled: boolean;
  chunkSizeTokens: number;
  chunkOverlapTokens: number;
  maximumTokens: number;
  inferenceTimeoutMs: number;
  cacheMaximumEntries: number;
  cacheTtlMs: number;
  historyEnabled: boolean;
  historyRetentionDays: number;
  storeFullText: boolean;
}

export interface PlatformSettings extends Partial<UserSettings> {
  platformId: string;
}

export type EffectiveSettings = UserSettings;
