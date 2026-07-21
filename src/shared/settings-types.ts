import type { Backend, LanguageMode, PresentationMode } from "@/shared/types";

export type BackendPreference = "auto" | Exclude<Backend, "mock">;

export interface UserSettings {
  enabled: boolean;
  minimumWordCount: number;
  languageMode: LanguageMode;
  presentationMode: PresentationMode;
  processVisibleOnly: boolean;
  experimentalShortTextDetection: boolean;
  /**
   * Opt-in "preview experimental / não calibrado" mode. When true AND the sealed
   * TMR bundle is present, the TMR runs as the feed classifier even though NO
   * scientific holdout decision or calibration profile exists yet. Its output is
   * UNCALIBRATED: results carry the experimental reason code, the release stays
   * `pending`, and the calibrated path (a promoted release with a profile) always
   * takes precedence over it. Default false — the fail-closed stylometric builtin
   * stays primary until the user explicitly enables this.
   */
  experimentalUncalibratedTmr: boolean;
  /**
   * Marking threshold (percent, 1–100) for the experimental preview: the raw TMR
   * document score must reach this to surface a mark. Default 70. Consulted ONLY
   * when {@link experimentalUncalibratedTmr} is on; the calibrated path ignores it
   * entirely (its operating points come from the sealed profile). The "strong"
   * band is derived as max(threshold, 90%), so it never falls below marking.
   */
  experimentalMarkingThresholdPercent: number;
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
  /**
   * Window plan for the experimental/builtin runtimes. The calibrated TMR path
   * IGNORES these three fields and always uses the sealed manifest window plan
   * (510 content tokens, 64 overlap, 512 total); they exist only so a compatible
   * experimental runtime can be tuned.
   */
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
