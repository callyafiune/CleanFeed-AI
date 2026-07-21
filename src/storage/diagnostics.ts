import type { CircuitBreakerSnapshot } from "@/inference/circuit-breaker";
import type {
  DiagnosticCircuitBreaker,
  DiagnosticExtensionInfo,
  DiagnosticRuntimeStatus,
  DiagnosticSettingsSummary,
  DiagnosticReport,
  ModelDiagnosticsSource,
  ModelDiagnosticsView,
} from "@/shared/diagnostic-types";
import type { UserSettings } from "@/shared/settings-types";
import type {
  AggregateMetricsSnapshot,
  ModelStatus,
  RuntimeModelIdentity,
} from "@/shared/types";

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
  /**
   * The combined runtime status + release descriptor. It is sanitized through
   * {@link sanitizeModelDiagnostics} on the way into the report, so callers may
   * hand over a fuller object without leaking anything beyond the allowlist.
   */
  getModelDiagnostics?: () =>
    | Promise<ModelDiagnosticsSource | undefined>
    | ModelDiagnosticsSource
    | undefined;
  getCircuitBreaker?: () =>
    | Promise<CircuitBreakerSnapshot | undefined>
    | CircuitBreakerSnapshot
    | undefined;
}

/** Failure timestamps are capped so a report can never grow unbounded. */
const MAX_DIAGNOSTIC_FAILURE_TIMESTAMPS = 16;

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
    const [
      settings,
      metrics,
      environment,
      platformIds,
      modelDiagnostics,
      breaker,
    ] = await Promise.all([
      this.options.getSettings(),
      this.options.getMetrics(),
      this.options.getEnvironment(),
      this.options.getPlatformIds(),
      this.options.getModelDiagnostics?.() ?? undefined,
      this.options.getCircuitBreaker?.() ?? undefined,
    ]);

    const circuitBreaker = sanitizeCircuitBreaker(breaker);
    return {
      extension: buildExtensionInfo(environment),
      manifestPermissions: sanitizePermissions(environment.manifestPermissions),
      metrics,
      modelStatus:
        modelDiagnostics === undefined
          ? null
          : sanitizeModelDiagnostics(modelDiagnostics),
      platforms: [...platformIds].sort(),
      settingsSummary: buildSettingsSummary(settings),
      // Present only when a breaker source is wired in; absent otherwise so the
      // report's shape is unchanged for callers without one.
      ...(circuitBreaker === undefined ? {} : { circuitBreaker }),
    };
  }
}

/**
 * Reduces a breaker snapshot to counters, bounded timestamps and one reason
 * code. Only allowlisted numeric fields are copied and the timestamp list is
 * capped, so no text, URL or hash can ever enter the report.
 */
function sanitizeCircuitBreaker(
  snapshot: CircuitBreakerSnapshot | undefined,
): DiagnosticCircuitBreaker | undefined {
  if (snapshot === undefined) {
    return undefined;
  }

  return {
    open: snapshot.open === true,
    failureCount: sanitizeCount(snapshot.failureCount),
    recentFailureTimestamps: snapshot.failureTimestamps
      .filter((timestamp) => Number.isSafeInteger(timestamp) && timestamp >= 0)
      .slice(-MAX_DIAGNOSTIC_FAILURE_TIMESTAMPS),
    reasonCode: snapshot.open === true ? "CIRCUIT_BREAKER_OPEN" : null,
  };
}

function sanitizeCount(value: number): number {
  return Number.isSafeInteger(value) && value >= 0 ? value : 0;
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

/**
 * Reduces the combined runtime status + release descriptor to the closed
 * {@link ModelDiagnosticsView} allowlist. Every field is copied explicitly and
 * the runtime identity is discriminated by `kind` before its fields are copied —
 * the source objects are never spread — so a smuggled `aiScore`, `postText`,
 * `author`, URL, content hash, `selectedProfileDigest` or `cacheValidUntil` can
 * never survive into a diagnostic report.
 */
export function sanitizeModelDiagnostics(
  source: ModelDiagnosticsSource,
): ModelDiagnosticsView {
  return {
    status: sanitizeRuntimeStatus(source.status),
    release: {
      gateDecision: source.release.gateDecision,
      rolloutState: source.release.rolloutState,
    },
  };
}

function sanitizeRuntimeStatus(status: ModelStatus): DiagnosticRuntimeStatus {
  return {
    state: status.state,
    backend: status.backend,
    runtimeIdentity: sanitizeRuntimeIdentity(status.runtimeIdentity),
    calibrationCoverage: status.calibrationCoverage,
    calibrationSetDigest: status.calibrationSetDigest,
    profileCount: sanitizeCount(status.profileCount),
    earliestExpiry: status.earliestExpiry,
    reasonCodes: [...status.reasonCodes],
    ...(status.initializedAt === undefined
      ? {}
      : { initializedAt: status.initializedAt }),
    ...(status.supportsBatching === undefined
      ? {}
      : { supportsBatching: status.supportsBatching }),
  };
}

function sanitizeRuntimeIdentity(
  identity: RuntimeModelIdentity | null,
): RuntimeModelIdentity | null {
  if (identity === null) {
    return null;
  }
  if (identity.kind === "builtin") {
    return {
      kind: "builtin",
      modelId: identity.modelId,
      modelVersion: identity.modelVersion,
      implementationVersion: identity.implementationVersion,
    };
  }
  return {
    kind: "bundle",
    modelId: identity.modelId,
    modelVersion: identity.modelVersion,
    bundleDigest: identity.bundleDigest,
    tokenizerDigest: identity.tokenizerDigest,
    aggregationVersion: identity.aggregationVersion,
    contentCompositionVersion: identity.contentCompositionVersion,
    calibrationSetDigest: identity.calibrationSetDigest,
  };
}

function buildSettingsSummary(
  settings: UserSettings,
): DiagnosticSettingsSummary {
  return {
    enabled: settings.enabled,
    processVisibleOnly: settings.processVisibleOnly,
    experimentalShortTextDetection: settings.experimentalShortTextDetection,
    experimentalUncalibratedTmr: settings.experimentalUncalibratedTmr,
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
