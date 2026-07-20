// Metrics for the AI-text detector benchmark.
//
// Two contracts live here:
//
//   * The v2 statistical evaluation report (`computeEvaluationMetrics`) is the
//     release-grade contract §6.5 mandates: warning/visual-action confusion
//     matrices with one-sided Wilson intervals, author-clustered bootstrap
//     intervals for ROC-AUC/PR-AUC/Brier/ECE-15, coverage/abstention/error over
//     the eligible set, prevalence-simulated precision, latency/memory and the
//     mixed-text (>=50% AI) warning-recall block. Ground truth is the record
//     label, never a score; warning positives are the AI records PLUS the mixed
//     records with at least 50% AI contribution, and human records are the only
//     negatives — mixed text never inflates the human negative count.
//
//   * The legacy binary contract (`computeBinaryMetrics` /
//     `computeSegmentedMetrics`) still feeds the pre-migration MVP CLI report
//     (`benchmark/report.ts`), whose headline is precisionAmongBlocked and which
//     never reports accuracy. It is retained until that report is migrated.
//
// Standalone module: MUST NOT import from the extension bundle (src/). Sibling
// imports use explicit .ts extensions for Node's native TypeScript execution.
// Deterministic: the only randomness is the caller-supplied bootstrap seed.

import { clusterBootstrap } from "./bootstrap.ts";
import { wilsonOneSided } from "./intervals.ts";
import type { BenchmarkRecord } from "./schema.ts";

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

// ===========================================================================
// v2 statistical evaluation report (§6.5).
// ===========================================================================

// A point estimate with an optional interval and the method that produced it,
// so a report can prove which estimator (Wilson vs author-clustered bootstrap)
// backs every number.
export interface MetricEstimate {
  value: number;
  lower95?: number;
  upper95?: number;
  method: "point" | "wilson-one-sided" | "author-cluster-percentile";
}

// A confusion matrix at one operating point with Wilson one-sided intervals on
// every rate. Negatives are human records only; positives are AI plus the mixed
// records with at least 50% AI contribution.
export interface DecisionMetrics {
  sampleSize: number;
  positives: number;
  negatives: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  falsePositiveRate: MetricEstimate;
  recall: MetricEstimate;
  precision: MetricEstimate;
}

export interface CalibrationPoint {
  probability: number;
  label: 0 | 1;
}

export interface SimulatedPrevalences {
  prevalence01: number;
  prevalence05: number;
  prevalence10: number;
}

// One mixed-text fraction bucket ("0_24" | "25_49" | "50_74" | "75_100") with
// the warning decision measured over the >=50% AI records it contains.
export interface MixedFractionSegment {
  key: string;
  sampleSize: number;
  warning: DecisionMetrics;
}

export interface EvaluationMetrics {
  warning: DecisionMetrics;
  visualAction: DecisionMetrics | null;
  rocAuc: MetricEstimate;
  prAuc: MetricEstimate;
  brier: MetricEstimate;
  ece15: MetricEstimate;
  coverage: MetricEstimate;
  abstentionRate: MetricEstimate;
  errorRate: MetricEstimate;
  simulatedPrecision: Record<
    "prevalence01" | "prevalence05" | "prevalence10",
    number
  >;
  latency: LatencyMetrics;
  memory: MemoryMetrics;
  mixed: {
    atLeastHalfAi: {
      sampleSize: number;
      warningRecall: number;
      warningRecallLower95: number;
    };
    byFraction: MixedFractionSegment[];
  };
}

// One scored (or abstained/errored) holdout record. The warning/visual-action
// decisions are already applied from the frozen thresholds; `documentScore` is
// the calibrated document probability used for ranking and calibration metrics.
export interface EvaluationItem {
  record: BenchmarkRecord;
  documentScore: number;
  warned: boolean;
  visualActioned: boolean;
  status: "scored" | "abstained" | "error";
  latencyMs?: number;
  memoryBytes?: number;
}

export interface EvaluationOptions {
  // Seed for the author-clustered bootstrap of the continuous metrics.
  bootstrapSeed: number;
  // Prevalences for the simulated-precision projection. Defaults to 1/5/10%.
  prevalences?: SimulatedPrevalences;
  // Coverage eligibility floor: PT-BR and at least this many words. Default 50.
  minimumEligibleWords?: number;
  // Whether a visual-action threshold was frozen. When false, visualAction is
  // reported as null rather than a matrix over a threshold that does not exist.
  visualActionAvailable?: boolean;
}

const ECE_BINS = 15;
const BOOTSTRAP_ITERATIONS = 2_000 as const;
const DEFAULT_MINIMUM_ELIGIBLE_WORDS = 50;
const DEFAULT_PREVALENCES: SimulatedPrevalences = {
  prevalence01: 0.01,
  prevalence05: 0.05,
  prevalence10: 0.1,
};

// Warning positives are AI records and mixed records with at least 50% AI.
export function isWarningPositive(record: BenchmarkRecord): boolean {
  if (record.label === "ai") return true;
  if (record.label === "mixed") {
    return (record.mixture?.aiFraction ?? 0) >= 0.5;
  }
  return false;
}

// The only negatives are clean human records; mixed text is never a negative.
export function isHumanNegative(record: BenchmarkRecord): boolean {
  return record.label === "human";
}

// ECE-15: exactly fifteen equal-width bins on [0,1] — [0,1/15), ... [14/15,1].
// Each non-empty bin contributes n_bin/n * |meanProbability - positiveRate|.
export function ece15(points: readonly CalibrationPoint[]): number {
  if (points.length === 0) return Number.NaN;
  const counts = new Array<number>(ECE_BINS).fill(0);
  const probabilitySum = new Array<number>(ECE_BINS).fill(0);
  const positiveSum = new Array<number>(ECE_BINS).fill(0);
  for (const point of points) {
    const clamped = Math.min(1, Math.max(0, point.probability));
    const bin = Math.min(ECE_BINS - 1, Math.floor(clamped * ECE_BINS));
    counts[bin] += 1;
    probabilitySum[bin] += point.probability;
    positiveSum[bin] += point.label;
  }
  let ece = 0;
  for (let bin = 0; bin < ECE_BINS; bin += 1) {
    const count = counts[bin];
    if (count === 0) continue;
    const meanProbability = probabilitySum[bin] / count;
    const positiveRate = positiveSum[bin] / count;
    ece += (count / points.length) * Math.abs(meanProbability - positiveRate);
  }
  return ece;
}

// Brier score: the mean squared error between probability and label.
export function brierScore(points: readonly CalibrationPoint[]): number {
  if (points.length === 0) return Number.NaN;
  let sum = 0;
  for (const point of points) {
    const error = point.probability - point.label;
    sum += error * error;
  }
  return sum / points.length;
}

// Precision projected to a hypothetical base rate: with prevalence p, a true
// positive rate and a false positive rate, precision = p*TPR / (p*TPR +
// (1-p)*FPR). Answers "if only p% of real traffic were AI, how often would a
// warning be right?" without pretending the benchmark prevalence is realistic.
export function simulatedPrecision(input: {
  truePositiveRate: number;
  falsePositiveRate: number;
  prevalence: number;
}): number {
  const truePositives = input.prevalence * input.truePositiveRate;
  const falsePositives = (1 - input.prevalence) * input.falsePositiveRate;
  const denominator = truePositives + falsePositives;
  return denominator === 0 ? 0 : truePositives / denominator;
}

// The full v2 report. Deterministic for a fixed bootstrap seed.
export function computeEvaluationMetrics(
  items: readonly EvaluationItem[],
  options: EvaluationOptions,
): EvaluationMetrics {
  const minimumWords =
    options.minimumEligibleWords ?? DEFAULT_MINIMUM_ELIGIBLE_WORDS;
  const prevalences = options.prevalences ?? DEFAULT_PREVALENCES;
  const visualActionAvailable = options.visualActionAvailable ?? true;
  const seed = options.bootstrapSeed;

  const positives = items.filter((item) => isWarningPositive(item.record));
  const negatives = items.filter((item) => isHumanNegative(item.record));

  const warning = decisionMetrics(positives, negatives, (item) => item.warned);
  const visualAction = visualActionAvailable
    ? decisionMetrics(positives, negatives, (item) => item.visualActioned)
    : null;

  // Continuous ranking/calibration metrics run over the scored positive/negative
  // set; mixed records below 50% AI are neither, so they never enter the curve.
  const scoredBinary = items.filter(
    (item) =>
      item.status === "scored" &&
      (isWarningPositive(item.record) || isHumanNegative(item.record)),
  );

  const eligible = items.filter((item) =>
    isEligible(item.record, minimumWords),
  );
  const eligibleCount = eligible.length;

  return {
    warning,
    visualAction,
    rocAuc: continuousEstimate(scoredBinary, rocAucFromItems, seed),
    prAuc: continuousEstimate(scoredBinary, prAucFromItems, seed),
    brier: continuousEstimate(scoredBinary, sampleBrier, seed),
    ece15: continuousEstimate(scoredBinary, sampleEce, seed),
    coverage: proportionEstimate(
      eligible.filter((item) => item.status === "scored").length,
      eligibleCount,
    ),
    abstentionRate: proportionEstimate(
      eligible.filter((item) => item.status === "abstained").length,
      eligibleCount,
    ),
    errorRate: proportionEstimate(
      eligible.filter((item) => item.status === "error").length,
      eligibleCount,
    ),
    simulatedPrecision: {
      prevalence01: simulatedPrecisionAt(warning, prevalences.prevalence01),
      prevalence05: simulatedPrecisionAt(warning, prevalences.prevalence05),
      prevalence10: simulatedPrecisionAt(warning, prevalences.prevalence10),
    },
    latency: latencyMetricsAll(items),
    memory: memoryMetricsAll(items),
    mixed: {
      atLeastHalfAi: mixedAtLeastHalfAi(items),
      byFraction: mixedByFraction(items),
    },
  };
}

function decisionMetrics(
  positives: readonly EvaluationItem[],
  negatives: readonly EvaluationItem[],
  decide: (item: EvaluationItem) => boolean,
): DecisionMetrics {
  let truePositives = 0;
  let falseNegatives = 0;
  for (const item of positives) {
    if (decide(item)) truePositives += 1;
    else falseNegatives += 1;
  }
  let falsePositives = 0;
  let trueNegatives = 0;
  for (const item of negatives) {
    if (decide(item)) falsePositives += 1;
    else trueNegatives += 1;
  }
  return {
    sampleSize: positives.length + negatives.length,
    positives: positives.length,
    negatives: negatives.length,
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    falsePositiveRate: proportionEstimate(falsePositives, negatives.length),
    recall: proportionEstimate(truePositives, positives.length),
    precision: proportionEstimate(
      truePositives,
      truePositives + falsePositives,
    ),
  };
}

// Wilson one-sided lower and upper bounds on a proportion. A zero-denominator
// proportion is undefined, reported as a NaN point rather than a false 0.
function proportionEstimate(successes: number, total: number): MetricEstimate {
  if (total === 0) return { value: Number.NaN, method: "point" };
  return {
    value: successes / total,
    lower95: wilsonOneSided(successes, total, "lower").value,
    upper95: wilsonOneSided(successes, total, "upper").value,
    method: "wilson-one-sided",
  };
}

// A continuous metric with a 2000-replicate author-clustered bootstrap
// interval. When the statistic is undefined (a single class) or the bootstrap
// cannot muster enough finite replicates, it degrades to a bare point estimate
// rather than fabricating an interval or throwing.
function continuousEstimate(
  items: readonly EvaluationItem[],
  statistic: (sample: readonly EvaluationItem[]) => number,
  seed: number,
): MetricEstimate {
  const value = statistic(items);
  if (!Number.isFinite(value)) return { value, method: "point" };
  try {
    const interval = clusterBootstrap(items, {
      clusterBy: (item) => item.record.groups.author,
      iterations: BOOTSTRAP_ITERATIONS,
      seed,
      statistic,
    });
    return {
      value,
      lower95: interval.lower95,
      upper95: interval.upper95,
      method: "author-cluster-percentile",
    };
  } catch {
    return { value, method: "point" };
  }
}

function rocAucFromItems(items: readonly EvaluationItem[]): number {
  let positives = 0;
  let negatives = 0;
  for (const item of items) {
    if (isWarningPositive(item.record)) positives += 1;
    else negatives += 1;
  }
  if (positives === 0 || negatives === 0) return Number.NaN;

  const sorted = [...items].sort((a, b) => b.documentScore - a.documentScore);
  let truePositives = 0;
  let falsePositives = 0;
  let previousFpr = 0;
  let previousTpr = 0;
  let area = 0;
  for (let i = 0; i < sorted.length;) {
    const currentScore = sorted[i].documentScore;
    while (i < sorted.length && sorted[i].documentScore === currentScore) {
      if (isWarningPositive(sorted[i].record)) truePositives += 1;
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

function prAucFromItems(items: readonly EvaluationItem[]): number {
  let positives = 0;
  for (const item of items) {
    if (isWarningPositive(item.record)) positives += 1;
  }
  if (positives === 0 || positives === items.length) return Number.NaN;

  const sorted = [...items].sort((a, b) => b.documentScore - a.documentScore);
  let truePositives = 0;
  let falsePositives = 0;
  let previousRecall = 0;
  let averagePrecision = 0;
  for (let i = 0; i < sorted.length;) {
    const currentScore = sorted[i].documentScore;
    while (i < sorted.length && sorted[i].documentScore === currentScore) {
      if (isWarningPositive(sorted[i].record)) truePositives += 1;
      else falsePositives += 1;
      i += 1;
    }
    const recall = truePositives / positives;
    const precision = ratio(truePositives, truePositives + falsePositives);
    averagePrecision += (recall - previousRecall) * precision;
    previousRecall = recall;
  }
  return averagePrecision;
}

function sampleBrier(items: readonly EvaluationItem[]): number {
  return brierScore(items.map(toCalibrationPoint));
}

function sampleEce(items: readonly EvaluationItem[]): number {
  return ece15(items.map(toCalibrationPoint));
}

function toCalibrationPoint(item: EvaluationItem): CalibrationPoint {
  return {
    probability: item.documentScore,
    label: isWarningPositive(item.record) ? 1 : 0,
  };
}

function simulatedPrecisionAt(
  warning: DecisionMetrics,
  prevalence: number,
): number {
  return simulatedPrecision({
    truePositiveRate: warning.recall.value,
    falsePositiveRate: warning.falsePositiveRate.value,
    prevalence,
  });
}

function isEligible(record: BenchmarkRecord, minimumWords: number): boolean {
  return record.language === "pt-BR" && record.wordCount >= minimumWords;
}

function latencyMetricsAll(items: readonly EvaluationItem[]): LatencyMetrics {
  const samples = items
    .map((item) => item.latencyMs)
    .filter((value): value is number => isFiniteNumber(value))
    .sort((a, b) => a - b);
  if (samples.length === 0) {
    return { sampleSize: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 };
  }
  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    sampleSize: samples.length,
    meanMs: sum / samples.length,
    p50Ms: percentile(samples, 0.5),
    p95Ms: percentile(samples, 0.95),
    maxMs: samples[samples.length - 1],
  };
}

function memoryMetricsAll(items: readonly EvaluationItem[]): MemoryMetrics {
  const samples = items
    .map((item) => item.memoryBytes)
    .filter((value): value is number => isFiniteNumber(value));
  if (samples.length === 0) return { sampleSize: 0, meanBytes: 0, maxBytes: 0 };
  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    sampleSize: samples.length,
    meanBytes: sum / samples.length,
    maxBytes: Math.max(...samples),
  };
}

function mixedAtLeastHalfAi(items: readonly EvaluationItem[]): {
  sampleSize: number;
  warningRecall: number;
  warningRecallLower95: number;
} {
  const strong = items.filter(
    (item) =>
      item.record.label === "mixed" &&
      (item.record.mixture?.aiFraction ?? 0) >= 0.5,
  );
  const warned = strong.filter((item) => item.warned).length;
  if (strong.length === 0) {
    return { sampleSize: 0, warningRecall: 0, warningRecallLower95: 0 };
  }
  return {
    sampleSize: strong.length,
    warningRecall: warned / strong.length,
    warningRecallLower95: wilsonOneSided(warned, strong.length, "lower").value,
  };
}

const MIXED_FRACTION_BUCKETS: ReadonlyArray<readonly [string, number, number]> =
  [
    ["0_24", 0, 0.25],
    ["25_49", 0.25, 0.5],
    ["50_74", 0.5, 0.75],
    ["75_100", 0.75, Number.POSITIVE_INFINITY],
  ];

export function mixedFractionBucket(aiFraction: number): string {
  for (const [key, lower, upper] of MIXED_FRACTION_BUCKETS) {
    if (aiFraction >= lower && aiFraction < upper) return key;
  }
  return "75_100";
}

function mixedByFraction(
  items: readonly EvaluationItem[],
): MixedFractionSegment[] {
  const buckets = new Map<string, EvaluationItem[]>();
  for (const item of items) {
    if (item.record.label !== "mixed") continue;
    const key = mixedFractionBucket(item.record.mixture?.aiFraction ?? 0);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [item]);
    else bucket.push(item);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([key, bucket]) => ({
      key,
      sampleSize: bucket.length,
      warning: decisionMetrics(
        bucket.filter((item) => isWarningPositive(item.record)),
        [],
        (item) => item.warned,
      ),
    }));
}
