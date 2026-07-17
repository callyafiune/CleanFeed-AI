// Binary classification metrics for the AI-text detector.
//
// The headline metric is precisionAmongBlocked: of the posts the extension
// would have blocked (predicted AI at the block threshold), how many were
// truly AI. This is the false-positive-averse framing the product needs;
// "accuracy" is deliberately never computed as a headline.
//
// Standalone module: MUST NOT import from the extension bundle (src/).

export interface Prediction {
  // Ground-truth label of the record.
  label: "human" | "ai";
  // Model-predicted probability that the text is AI (0..1).
  score: number;
  latencyMs?: number;
  memoryBytes?: number;
}

export interface LatencyMetrics {
  sampleSize: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

export interface MemoryMetrics {
  sampleSize: number;
  meanBytes: number;
  maxBytes: number;
}

export interface RecallAtFpr {
  targetFpr: number;
  achievedFpr: number;
  recall: number;
  threshold: number;
}

export interface BinaryMetrics {
  primaryMetric: "precisionAmongBlocked";
  sampleSize: number;
  positives: number;
  negatives: number;
  blockThreshold: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  // Primary, headline metric: TP / (TP + FP) at the block threshold.
  precisionAmongBlocked: number;
  precision: number;
  recall: number;
  f1: number;
  falsePositiveRate: number;
  falseNegativeRate: number;
  // Threshold-independent ranking quality.
  rocAuc: number;
  prAuc: number;
  recallAtTargetFpr: RecallAtFpr;
  latency?: LatencyMetrics;
  memory?: MemoryMetrics;
}

export interface BinaryMetricsOptions {
  blockThreshold: number;
  targetFpr?: number;
}

export interface SegmentMetrics {
  key: string;
  metrics: BinaryMetrics;
}

const DEFAULT_TARGET_FPR = 0.01;

export function computeBinaryMetrics(
  predictions: readonly Prediction[],
  options: BinaryMetricsOptions,
): BinaryMetrics {
  const blockThreshold = options.blockThreshold;
  const targetFpr = options.targetFpr ?? DEFAULT_TARGET_FPR;

  let truePositives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let falseNegatives = 0;
  let positives = 0;
  let negatives = 0;

  for (const prediction of predictions) {
    const isPositive = prediction.label === "ai";
    if (isPositive) positives += 1;
    else negatives += 1;

    const blocked = prediction.score >= blockThreshold;
    if (blocked && isPositive) truePositives += 1;
    else if (blocked && !isPositive) falsePositives += 1;
    else if (!blocked && !isPositive) trueNegatives += 1;
    else falseNegatives += 1;
  }

  const precisionAmongBlocked = ratio(
    truePositives,
    truePositives + falsePositives,
  );
  const recall = ratio(truePositives, truePositives + falseNegatives);
  const f1 =
    precisionAmongBlocked + recall === 0
      ? 0
      : (2 * precisionAmongBlocked * recall) / (precisionAmongBlocked + recall);

  return {
    primaryMetric: "precisionAmongBlocked",
    sampleSize: predictions.length,
    positives,
    negatives,
    blockThreshold,
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    precisionAmongBlocked,
    precision: precisionAmongBlocked,
    recall,
    f1,
    falsePositiveRate: ratio(falsePositives, falsePositives + trueNegatives),
    falseNegativeRate: ratio(falseNegatives, falseNegatives + truePositives),
    rocAuc: rocAuc(predictions, positives, negatives),
    prAuc: averagePrecision(predictions, positives),
    recallAtTargetFpr: recallAtFpr(
      predictions,
      positives,
      negatives,
      targetFpr,
    ),
    latency: latencyMetrics(predictions),
    memory: memoryMetrics(predictions),
  };
}

// Segments predictions by an arbitrary key (size bucket, language, platform,
// generatorModel, transformation, ...) and reports metrics per segment. Each
// segment always carries its own sampleSize.
export function computeSegmentedMetrics<T>(
  items: readonly T[],
  toPrediction: (item: T) => Prediction,
  toSegmentKey: (item: T) => string,
  options: BinaryMetricsOptions,
): SegmentMetrics[] {
  const groups = new Map<string, Prediction[]>();
  for (const item of items) {
    const key = toSegmentKey(item);
    const prediction = toPrediction(item);
    const bucket = groups.get(key);
    if (bucket === undefined) groups.set(key, [prediction]);
    else bucket.push(prediction);
  }

  return [...groups.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, predictions]) => ({
      key,
      metrics: computeBinaryMetrics(predictions, options),
    }));
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed === "" ? 0 : trimmed.split(/\s+/).length;
}

export function sizeBucket(wordCount: number): string {
  if (wordCount < 50) return "0_49";
  if (wordCount < 80) return "50_79";
  if (wordCount < 100) return "80_99";
  if (wordCount < 150) return "100_149";
  if (wordCount < 300) return "150_299";
  return "300_PLUS";
}

// ROC-AUC by trapezoidal integration over the (FPR, TPR) curve. Undefined when
// a class is absent, reported as NaN so a report can render it as "n/a" rather
// than a misleading 0.5.
function rocAuc(
  predictions: readonly Prediction[],
  positives: number,
  negatives: number,
): number {
  if (positives === 0 || negatives === 0) return Number.NaN;

  const sorted = sortByScoreDescending(predictions);
  let truePositives = 0;
  let falsePositives = 0;
  let previousFpr = 0;
  let previousTpr = 0;
  let area = 0;

  for (let i = 0; i < sorted.length;) {
    const currentScore = sorted[i].score;
    while (i < sorted.length && sorted[i].score === currentScore) {
      if (sorted[i].label === "ai") truePositives += 1;
      else falsePositives += 1;
      i += 1;
    }
    const tpr = truePositives / positives;
    const fpr = falsePositives / negatives;
    area += ((fpr - previousFpr) * (tpr + previousTpr)) / 2;
    previousFpr = fpr;
    previousTpr = tpr;
  }

  return area;
}

// PR-AUC as average precision (the step-wise estimator), which does not
// interpolate optimistically between operating points.
function averagePrecision(
  predictions: readonly Prediction[],
  positives: number,
): number {
  if (positives === 0) return Number.NaN;

  const sorted = sortByScoreDescending(predictions);
  let truePositives = 0;
  let falsePositives = 0;
  let previousRecall = 0;
  let ap = 0;

  for (let i = 0; i < sorted.length;) {
    const currentScore = sorted[i].score;
    while (i < sorted.length && sorted[i].score === currentScore) {
      if (sorted[i].label === "ai") truePositives += 1;
      else falsePositives += 1;
      i += 1;
    }
    const recall = truePositives / positives;
    const precision = ratio(truePositives, truePositives + falsePositives);
    ap += (recall - previousRecall) * precision;
    previousRecall = recall;
  }

  return ap;
}

// Highest recall achievable while keeping FPR at or below the target. The
// threshold is the score at which the model would block; "block if score >=
// threshold".
function recallAtFpr(
  predictions: readonly Prediction[],
  positives: number,
  negatives: number,
  targetFpr: number,
): RecallAtFpr {
  if (positives === 0 || negatives === 0) {
    return {
      targetFpr,
      achievedFpr: 0,
      recall: 0,
      threshold: Number.POSITIVE_INFINITY,
    };
  }

  const sorted = sortByScoreDescending(predictions);
  let truePositives = 0;
  let falsePositives = 0;
  let best: Omit<RecallAtFpr, "targetFpr"> = {
    achievedFpr: 0,
    recall: 0,
    threshold: Number.POSITIVE_INFINITY,
  };

  for (let i = 0; i < sorted.length;) {
    const currentScore = sorted[i].score;
    while (i < sorted.length && sorted[i].score === currentScore) {
      if (sorted[i].label === "ai") truePositives += 1;
      else falsePositives += 1;
      i += 1;
    }
    const fpr = falsePositives / negatives;
    const recall = truePositives / positives;
    if (fpr <= targetFpr && recall >= best.recall) {
      best = { achievedFpr: fpr, recall, threshold: currentScore };
    }
  }

  return { targetFpr, ...best };
}

function latencyMetrics(
  predictions: readonly Prediction[],
): LatencyMetrics | undefined {
  const samples = predictions
    .map((prediction) => prediction.latencyMs)
    .filter((value): value is number => isFiniteNumber(value))
    .sort((a, b) => a - b);
  if (samples.length === 0) return undefined;

  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    sampleSize: samples.length,
    meanMs: sum / samples.length,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: samples[samples.length - 1],
  };
}

function memoryMetrics(
  predictions: readonly Prediction[],
): MemoryMetrics | undefined {
  const samples = predictions
    .map((prediction) => prediction.memoryBytes)
    .filter((value): value is number => isFiniteNumber(value));
  if (samples.length === 0) return undefined;

  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    sampleSize: samples.length,
    meanBytes: sum / samples.length,
    maxBytes: Math.max(...samples),
  };
}

function percentile(sortedAscending: readonly number[], p: number): number {
  const index = Math.min(
    sortedAscending.length - 1,
    Math.max(0, Math.ceil(p * sortedAscending.length) - 1),
  );
  return sortedAscending[index];
}

function sortByScoreDescending(
  predictions: readonly Prediction[],
): Prediction[] {
  return [...predictions].sort((a, b) => b.score - a.score);
}

function ratio(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : numerator / denominator;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
