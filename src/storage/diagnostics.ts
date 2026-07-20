import type {
  DiagnosticExtensionInfo,
  DiagnosticModelStatus,
  DiagnosticReport,
  DiagnosticSettingsSummary,
} from "@/shared/diagnostic-types";
import type { UserSettings } from "@/shared/settings-types";
import type { AggregateMetricsSnapshot, ModelStatus } from "@/shared/types";

/**
 * Environment facts the report can safely surface. `manifestPermissions` must be
 * the manifest's API `permissions` array; host match patterns and any URL-shaped
 * token are stripped, so callers may pass a superset without leaking hosts.
 */
export interface DiagnosticEnvironment {
  version: string;
  chromeVersion?: string;
  operatingSystem?: string;
  manifestPermissions: readonly string[];
}

/**
 * The report's data sources. They are injected as plain async providers so the
 * repository never reaches into `chrome.*` directly and stays fully testable.
 */
export interface DiagnosticsRepositoryOptions {
  getSettings: () => Promise<UserSettings> | UserSettings;
  getMetrics: () =>
    Promise<AggregateMetricsSnapshot> | AggregateMetricsSnapshot;
  getEnvironment: () => Promise<DiagnosticEnvironment> | DiagnosticEnvironment;
  getPlatformIds: () => Promise<readonly string[]> | readonly string[];
  getModelStatus?: () =>
    Promise<ModelStatus | undefined> | ModelStatus | undefined;
}

/** Bare Chrome API permission tokens (e.g. "storage"); never host patterns/URLs. */
const PERMISSION_TOKEN = /^[a-zA-Z][a-zA-Z0-9_.-]*$/u;
/** Chrome permission names are short identifiers; anything longer (a hash, an
 *  opaque id) is not a permission and is dropped. */
const MAX_PERMISSION_LENGTH = 48;

/**
 * Builds a sanitized, share-safe diagnostic report. Privacy is enforced by
 * copying only allowlisted fields into a fresh object, never by filtering a
 * fuller structure after the fact.
 */
export class DiagnosticsRepository {
  constructor(private readonly options: DiagnosticsRepositoryOptions) {}

  async buildReport(): Promise<DiagnosticReport> {
    const [settings, metrics, environment, platformIds, modelStatus] =
      await Promise.all([
        this.options.getSettings(),
        this.options.getMetrics(),
        this.options.getEnvironment(),
        this.options.getPlatformIds(),
        this.options.getModelStatus?.() ?? undefined,
      ]);

    return {
      extension: buildExtensionInfo(environment),
      manifestPermissions: sanitizePermissions(environment.manifestPermissions),
      metrics,
      modelStatus: sanitizeModelStatus(modelStatus),
      platforms: [...platformIds].sort(),
      settingsSummary: buildSettingsSummary(settings),
    };
  }
}

function buildExtensionInfo(
  environment: DiagnosticEnvironment,
): DiagnosticExtensionInfo {
  const runtime = [environment.chromeVersion, environment.operatingSystem]
    .filter(
      (part): part is string => typeof part === "string" && part.length > 0,
    )
    .join(" / ");

  return {
    version: environment.version,
    ...(runtime.length > 0 ? { runtime } : {}),
  };
}

function sanitizePermissions(permissions: readonly string[]): string[] {
  const tokens = permissions.filter(
    (token) =>
      token.length <= MAX_PERMISSION_LENGTH && PERMISSION_TOKEN.test(token),
  );
  return [...new Set(tokens)].sort();
}

function sanitizeModelStatus(
  status: ModelStatus | undefined,
): DiagnosticModelStatus | null {
  if (status === undefined) {
    return null;
  }

  return {
    state: status.state,
    backend: status.backend,
    modelVersion: status.runtimeIdentity?.modelVersion ?? "unavailable",
    classifierId: status.runtimeIdentity?.modelId ?? "unavailable",
    supportsBatching: status.supportsBatching ?? false,
  };
}

function buildSettingsSummary(
  settings: UserSettings,
): DiagnosticSettingsSummary {
  return {
    enabled: settings.enabled,
    processVisibleOnly: settings.processVisibleOnly,
    experimentalShortTextDetection: settings.experimentalShortTextDetection,
    manualAnalysisEnabled: settings.manualAnalysisEnabled,
    showScore: settings.showScore,
    showExplanation: settings.showExplanation,
    debugMode: settings.debugMode,
    webGpuEnabled: settings.webGpuEnabled,
    wasmEnabled: settings.wasmEnabled,
    useMockModel: settings.useMockModel,
    batchingEnabled: settings.batchingEnabled,
    historyEnabled: settings.historyEnabled,
    storeFullText: settings.storeFullText,
    languageMode: settings.languageMode,
    presentationMode: settings.presentationMode,
    backendPreference: settings.backendPreference,
    minimumWordCount: settings.minimumWordCount,
    wasmConcurrency: settings.wasmConcurrency,
    webGpuConcurrency: settings.webGpuConcurrency,
    maximumQueueSize: settings.maximumQueueSize,
    maximumPostsPerMinute: settings.maximumPostsPerMinute,
    chunkSizeTokens: settings.chunkSizeTokens,
    chunkOverlapTokens: settings.chunkOverlapTokens,
    maximumTokens: settings.maximumTokens,
    inferenceTimeoutMs: settings.inferenceTimeoutMs,
    cacheMaximumEntries: settings.cacheMaximumEntries,
    cacheTtlMs: settings.cacheTtlMs,
    historyRetentionDays: settings.historyRetentionDays,
  };
}
