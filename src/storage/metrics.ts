import type {
  AggregateMetrics,
  Backend,
  ClassificationStatus,
} from "@/shared/types";
import type { StorageArea } from "@/storage/storage-area";

const METRICS_KEY = "cleanfeed.metrics.v1";
const SCHEMA_VERSION = 1;
const MAX_LATENCY_SAMPLES = 100;

const counterNames = [
  "postsDetected",
  "postsAnalyzed",
  "postsSkipped",
  "skippedByLength",
  "skippedByLanguage",
  "cacheHits",
  "cacheMisses",
  "inferenceFailures",
  "cancelledTasks",
  "revealedPosts",
] as const;
type CounterName = (typeof counterNames)[number];

const statuses = [
  "probably_human",
  "inconclusive",
  "possibly_ai",
  "strong_ai_indication",
  "insufficient_evidence",
  "classification_failed",
] as const satisfies readonly ClassificationStatus[];
const backends = [
  "mock",
  "wasm",
  "webgpu",
] as const satisfies readonly Backend[];

export type MetricRecord = Partial<Record<CounterName, number>> & {
  inferenceMs?: number;
  status?: ClassificationStatus;
  backend?: Backend;
};

interface PersistedMetrics {
  schemaVersion: typeof SCHEMA_VERSION;
  metrics: AggregateMetrics;
  latencySamples: number[];
}

export class MetricsRepository {
  private mutation = Promise.resolve();

  constructor(private readonly storage: StorageArea) {}

  record(record: MetricRecord): Promise<void> {
    if (!isMetricRecord(record)) {
      return Promise.reject(new Error("INVALID_METRIC_EVENT"));
    }

    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      const metrics = cloneMetrics(persisted.metrics);
      for (const counter of counterNames) {
        metrics[counter] += record[counter] ?? 0;
      }
      if (record.status !== undefined) {
        metrics.resultsByStatus[record.status] += 1;
      }
      if (record.backend !== undefined) {
        metrics.backendUsage[record.backend] =
          (metrics.backendUsage[record.backend] ?? 0) + 1;
      }

      const latencySamples =
        record.inferenceMs === undefined
          ? persisted.latencySamples
          : [...persisted.latencySamples, record.inferenceMs].slice(
              -MAX_LATENCY_SAMPLES,
            );
      const summarized = summarizeLatencies(metrics, latencySamples);
      await this.writePersisted({
        schemaVersion: SCHEMA_VERSION,
        metrics: summarized,
        latencySamples,
      });
    });
  }

  get(): Promise<AggregateMetrics> {
    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      return cloneMetrics(persisted.metrics);
    });
  }

  clear(): Promise<void> {
    return this.runMutation(() => this.storage.remove(METRICS_KEY));
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async readPersisted(): Promise<PersistedMetrics> {
    const value = await this.storage.get<unknown>(METRICS_KEY);
    if (value === undefined) {
      return emptyPersistedMetrics();
    }

    if (!isPersistedMetrics(value)) {
      await this.storage.remove(METRICS_KEY);
      return emptyPersistedMetrics();
    }

    return value;
  }

  private async writePersisted(value: PersistedMetrics): Promise<void> {
    await this.storage.set(METRICS_KEY, value);
  }
}

function emptyPersistedMetrics(): PersistedMetrics {
  return {
    schemaVersion: SCHEMA_VERSION,
    metrics: {
      postsDetected: 0,
      postsAnalyzed: 0,
      postsSkipped: 0,
      skippedByLength: 0,
      skippedByLanguage: 0,
      cacheHits: 0,
      cacheMisses: 0,
      inferenceFailures: 0,
      cancelledTasks: 0,
      revealedPosts: 0,
      averageInferenceMs: 0,
      medianInferenceMs: 0,
      resultsByStatus: Object.fromEntries(
        statuses.map((status) => [status, 0]),
      ) as Record<ClassificationStatus, number>,
      backendUsage: {},
    },
    latencySamples: [],
  };
}

function isMetricRecord(value: unknown): value is MetricRecord {
  if (!isRecord(value)) {
    return false;
  }

  const allowedKeys = new Set([
    ...counterNames,
    "inferenceMs",
    "status",
    "backend",
  ]);
  if (!Object.keys(value).every((key) => allowedKeys.has(key))) {
    return false;
  }

  return (
    counterNames.every(
      (counter) =>
        value[counter] === undefined || isNonNegativeInteger(value[counter]),
    ) &&
    (value.inferenceMs === undefined ||
      isNonNegativeFinite(value.inferenceMs)) &&
    (value.status === undefined ||
      statuses.includes(value.status as ClassificationStatus)) &&
    (value.backend === undefined || backends.includes(value.backend as Backend))
  );
}

function isPersistedMetrics(value: unknown): value is PersistedMetrics {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    value.schemaVersion === SCHEMA_VERSION &&
    isAggregateMetrics(value.metrics) &&
    Array.isArray(value.latencySamples) &&
    value.latencySamples.length <= MAX_LATENCY_SAMPLES &&
    value.latencySamples.every(isNonNegativeFinite) &&
    hasConsistentLatencySummary(value.metrics, value.latencySamples)
  );
}

function isAggregateMetrics(value: unknown): value is AggregateMetrics {
  if (!isRecord(value)) {
    return false;
  }

  const expectedKeys = [
    ...counterNames,
    "averageInferenceMs",
    "medianInferenceMs",
    "resultsByStatus",
    "backendUsage",
  ];
  return (
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    counterNames.every((counter) => isNonNegativeInteger(value[counter])) &&
    isNonNegativeFinite(value.averageInferenceMs) &&
    isNonNegativeFinite(value.medianInferenceMs) &&
    isStatusCounts(value.resultsByStatus) &&
    isBackendUsage(value.backendUsage)
  );
}

function isStatusCounts(
  value: unknown,
): value is Record<ClassificationStatus, number> {
  return (
    isRecord(value) &&
    Object.keys(value).length === statuses.length &&
    statuses.every((status) => isNonNegativeInteger(value[status]))
  );
}

function isBackendUsage(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([backend, count]) =>
        backends.includes(backend as Backend) && isNonNegativeInteger(count),
    )
  );
}

function summarizeLatencies(
  metrics: AggregateMetrics,
  latencySamples: number[],
): AggregateMetrics {
  const { average, median } = summarizeLatencySamples(latencySamples);
  return { ...metrics, averageInferenceMs: average, medianInferenceMs: median };
}

function hasConsistentLatencySummary(
  metrics: AggregateMetrics,
  latencySamples: number[],
): boolean {
  const { average, median } = summarizeLatencySamples(latencySamples);
  return (
    areNearlyEqual(metrics.averageInferenceMs, average) &&
    areNearlyEqual(metrics.medianInferenceMs, median)
  );
}

function summarizeLatencySamples(latencySamples: number[]): {
  average: number;
  median: number;
} {
  if (latencySamples.length === 0) {
    return { average: 0, median: 0 };
  }

  const sorted = [...latencySamples].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  const average =
    latencySamples.reduce((sum, latency) => sum + latency, 0) /
    latencySamples.length;

  return { average, median };
}

function areNearlyEqual(left: number, right: number): boolean {
  return (
    Math.abs(left - right) <= Number.EPSILON * Math.max(1, left, right) * 4
  );
}

function cloneMetrics(metrics: AggregateMetrics): AggregateMetrics {
  return {
    ...metrics,
    resultsByStatus: { ...metrics.resultsByStatus },
    backendUsage: { ...metrics.backendUsage },
  };
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
