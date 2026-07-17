import type {
  AggregateMetricsSnapshot,
  Backend,
  ClassificationStatus,
  PerformanceTrace,
} from "@/shared/types";
import type { StorageArea } from "@/storage/storage-area";

const METRICS_KEY = "cleanfeed.metrics.v1";
const SCHEMA_VERSION = 2;
const MODEL_ID_MAX_LENGTH = 128;

/**
 * Upper bounds (in milliseconds) of the bounded latency histogram. A final,
 * implicit +Inf bucket captures everything above the last bound, so we retain
 * count/sum/min/max/buckets rather than the raw latency samples themselves.
 */
export const LATENCY_BUCKET_BOUNDS = [
  5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000,
] as const;
const BUCKET_COUNT = LATENCY_BUCKET_BOUNDS.length + 1;

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
  model?: string;
  queueSize?: number;
};

interface LatencyHistogram {
  count: number;
  sum: number;
  minimum: number;
  maximum: number;
  buckets: number[];
}

interface StoredMetrics {
  postsDetected: number;
  postsAnalyzed: number;
  postsSkipped: number;
  skippedByLength: number;
  skippedByLanguage: number;
  cacheHits: number;
  cacheMisses: number;
  inferenceFailures: number;
  cancelledTasks: number;
  revealedPosts: number;
  maximumQueueSize: number;
  resultsByStatus: Record<ClassificationStatus, number>;
  backendUsage: Record<string, number>;
  modelUsage: Record<string, number>;
  latency: LatencyHistogram;
}

interface PersistedMetrics {
  schemaVersion: typeof SCHEMA_VERSION;
  metrics: StoredMetrics;
}

export class MetricsRepository {
  private mutation = Promise.resolve();

  constructor(private readonly storage: StorageArea) {}

  record(record: MetricRecord): Promise<void> {
    if (!isMetricRecord(record)) {
      return Promise.reject(new Error("INVALID_METRIC_EVENT"));
    }

    return this.runMutation(async () => {
      const stored = cloneStored((await this.readPersisted()).metrics);
      for (const counter of counterNames) {
        stored[counter] += record[counter] ?? 0;
      }
      if (record.status !== undefined) {
        stored.resultsByStatus[record.status] += 1;
      }
      if (record.backend !== undefined) {
        stored.backendUsage[record.backend] =
          (stored.backendUsage[record.backend] ?? 0) + 1;
      }
      if (record.model !== undefined) {
        stored.modelUsage[record.model] =
          (stored.modelUsage[record.model] ?? 0) + 1;
      }
      if (record.queueSize !== undefined) {
        stored.maximumQueueSize = Math.max(
          stored.maximumQueueSize,
          record.queueSize,
        );
      }
      if (record.inferenceMs !== undefined) {
        addLatency(stored.latency, record.inferenceMs);
      }

      await this.writePersisted({
        schemaVersion: SCHEMA_VERSION,
        metrics: stored,
      });
    });
  }

  /** Records a single inference latency into the bounded histogram. */
  recordLatency(latencyMs: number): Promise<void> {
    return this.record({ inferenceMs: latencyMs });
  }

  /** Persists only aggregate latency and classification metadata. */
  recordInference(
    trace: PerformanceTrace,
    backend: Backend,
    status: ClassificationStatus,
    model?: string,
  ): Promise<void> {
    return this.record({
      inferenceMs: trace.totalMs,
      backend,
      status,
      ...(model !== undefined ? { model } : {}),
    });
  }

  get(): Promise<AggregateMetricsSnapshot> {
    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      return summarize(persisted.metrics);
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
    metrics: emptyStoredMetrics(),
  };
}

function emptyStoredMetrics(): StoredMetrics {
  return {
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
    maximumQueueSize: 0,
    resultsByStatus: Object.fromEntries(
      statuses.map((status) => [status, 0]),
    ) as Record<ClassificationStatus, number>,
    backendUsage: {},
    modelUsage: {},
    latency: emptyHistogram(),
  };
}

function emptyHistogram(): LatencyHistogram {
  return {
    count: 0,
    sum: 0,
    minimum: 0,
    maximum: 0,
    buckets: new Array<number>(BUCKET_COUNT).fill(0),
  };
}

function addLatency(latency: LatencyHistogram, value: number): void {
  latency.count += 1;
  latency.sum += value;
  latency.minimum =
    latency.count === 1 ? value : Math.min(latency.minimum, value);
  latency.maximum = Math.max(latency.maximum, value);
  latency.buckets[bucketIndex(value)] += 1;
}

function bucketIndex(value: number): number {
  for (let index = 0; index < LATENCY_BUCKET_BOUNDS.length; index += 1) {
    if (value <= LATENCY_BUCKET_BOUNDS[index]) {
      return index;
    }
  }
  return LATENCY_BUCKET_BOUNDS.length;
}

function summarize(stored: StoredMetrics): AggregateMetricsSnapshot {
  const { latency } = stored;
  return {
    postsDetected: stored.postsDetected,
    postsAnalyzed: stored.postsAnalyzed,
    postsSkipped: stored.postsSkipped,
    skippedByLength: stored.skippedByLength,
    skippedByLanguage: stored.skippedByLanguage,
    cacheHits: stored.cacheHits,
    cacheMisses: stored.cacheMisses,
    inferenceFailures: stored.inferenceFailures,
    cancelledTasks: stored.cancelledTasks,
    revealedPosts: stored.revealedPosts,
    averageInferenceMs: latency.count === 0 ? 0 : latency.sum / latency.count,
    medianInferenceMs: percentile(latency, 0.5),
    p90InferenceMs: percentile(latency, 0.9),
    p95InferenceMs: percentile(latency, 0.95),
    maximumQueueSize: stored.maximumQueueSize,
    resultsByStatus: { ...stored.resultsByStatus },
    backendUsage: { ...stored.backendUsage },
    modelUsage: { ...stored.modelUsage },
  };
}

/**
 * Approximates a percentile from the first cumulative bucket that reaches the
 * target rank, using the bucket's upper bound (capped by the observed maximum)
 * as the representative value. The +Inf bucket resolves to the maximum.
 */
function percentile(latency: LatencyHistogram, quantile: number): number {
  if (latency.count === 0) {
    return 0;
  }

  const target = Math.ceil(quantile * latency.count);
  let cumulative = 0;
  for (let index = 0; index < latency.buckets.length; index += 1) {
    cumulative += latency.buckets[index];
    if (cumulative >= target) {
      const bound = LATENCY_BUCKET_BOUNDS[index] as number | undefined;
      return bound === undefined
        ? latency.maximum
        : Math.min(bound, latency.maximum);
    }
  }
  return latency.maximum;
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
    "model",
    "queueSize",
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
    (value.backend === undefined ||
      backends.includes(value.backend as Backend)) &&
    (value.model === undefined || isModelId(value.model)) &&
    (value.queueSize === undefined || isNonNegativeInteger(value.queueSize))
  );
}

function isPersistedMetrics(value: unknown): value is PersistedMetrics {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.schemaVersion === SCHEMA_VERSION &&
    isStoredMetrics(value.metrics)
  );
}

function isStoredMetrics(value: unknown): value is StoredMetrics {
  if (!isRecord(value)) {
    return false;
  }

  const expectedKeys = [
    ...counterNames,
    "maximumQueueSize",
    "resultsByStatus",
    "backendUsage",
    "modelUsage",
    "latency",
  ];
  return (
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    counterNames.every((counter) => isNonNegativeInteger(value[counter])) &&
    isNonNegativeInteger(value.maximumQueueSize) &&
    isStatusCounts(value.resultsByStatus) &&
    isBackendUsage(value.backendUsage) &&
    isModelUsage(value.modelUsage) &&
    isLatencyHistogram(value.latency)
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

function isModelUsage(value: unknown): value is Record<string, number> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([model, count]) => isModelId(model) && isNonNegativeInteger(count),
    )
  );
}

function isLatencyHistogram(value: unknown): value is LatencyHistogram {
  return (
    isRecord(value) &&
    Object.keys(value).length === 5 &&
    isNonNegativeInteger(value.count) &&
    isNonNegativeFinite(value.sum) &&
    isNonNegativeFinite(value.minimum) &&
    isNonNegativeFinite(value.maximum) &&
    Array.isArray(value.buckets) &&
    value.buckets.length === BUCKET_COUNT &&
    value.buckets.every(isNonNegativeInteger) &&
    value.buckets.reduce((total, count) => total + count, 0) === value.count
  );
}

function cloneStored(stored: StoredMetrics): StoredMetrics {
  return {
    ...stored,
    resultsByStatus: { ...stored.resultsByStatus },
    backendUsage: { ...stored.backendUsage },
    modelUsage: { ...stored.modelUsage },
    latency: { ...stored.latency, buckets: [...stored.latency.buckets] },
  };
}

function isModelId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MODEL_ID_MAX_LENGTH
  );
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
