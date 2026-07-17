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

/**
 * A single site override. It carries only the normalized hostname plus the
 * handful of settings a domain may change; it must never hold a full URL, path,
 * query string or any post content. A one-hour pause is expressed as an absolute
 * `pausedUntil` timestamp so expiry is a pure comparison against the clock.
 */
export interface DomainSettings {
  hostname: string;
  disabled?: boolean;
  pausedUntil?: number;
  presentationMode?: PresentationMode;
}

/** Which configuration layer a resolved value ultimately came from. */
export type SettingsSource =
  "default" | "global" | "platform" | "domain" | "session";

/** Debug-only map explaining the origin of every resolved setting. */
export type SettingsSourceMap = Record<keyof UserSettings, SettingsSource>;

export type EffectiveSettings = UserSettings & {
  /** Present only in debug mode: the layer each resolved value came from. */
  sourceMap?: SettingsSourceMap;
};
