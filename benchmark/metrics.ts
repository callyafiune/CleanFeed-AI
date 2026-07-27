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

// Which population a confusion matrix was measured over. Every DecisionMetrics
// carries its own role, so no consumer can read a rate without knowing which
// denominator produced it (R5: metrics come out in pairs, never as "the" FPR).
//
//   * "end-to-end"           — every eligible record, whatever its status. A
//                              record whose inference produced no decision is a
//                              NON-DETECTION: for a positive a false negative,
//                              for a negative neither a false positive nor a
//                              true negative but an explicitly undecided cell.
//   * "conditional-on-scored" — only the eligible records with
//                              `status === "scored"`.
export type MetricFamily = "end-to-end" | "conditional-on-scored";

// A confusion matrix at one operating point with Wilson one-sided intervals on
// every rate. Negatives are human records only; positives are AI plus the mixed
// records with at least 50% AI contribution.
//
// The four classic cells count DECIDED records only. A record that produced no
// decision (`abstained` or `error`) lands in `undecidedPositives` /
// `undecidedNegatives`: it is never a success, and it is never a fabricated
// accusation either. That is the whole defect this shape removes — an errored
// row used to be scored 0 and counted as a true negative.
export interface DecisionMetrics {
  family: MetricFamily;
  sampleSize: number;
  positives: number;
  negatives: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  undecidedPositives: number;
  undecidedNegatives: number;
  // FP / (FP + TN): how often a human record that GOT a decision was wrongly
  // accused. Undecided rows are excluded from this denominator on purpose —
  // adding them would shrink the rate, which is exactly the favorable bias the
  // `?? 0` substitution produced. It is identical in both families by
  // construction, because only a scored record can be decided.
  falsePositiveRate: MetricEstimate;
  // TN / negatives: how often a human record was actively and correctly cleared,
  // over ALL negatives of the family. An undecided row is not a clearance, so
  // this is where an inference failure lands on the unfavorable side.
  clearanceRate: MetricEstimate;
  // TP / positives: end-to-end this charges every undecided positive as a miss.
  recall: MetricEstimate;
  // TP / (TP + FP), over decided records only.
  precision: MetricEstimate;
}

// The mandatory pair (R5). A report publishes BOTH; a gate that wants an
// error-conservative bound reads `endToEnd`, which is never more favorable than
// `conditionalOnScored` on either recall or clearance.
export interface DecisionFamilies {
  endToEnd: DecisionMetrics;
  conditionalOnScored: DecisionMetrics;
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

// Coverage / abstention / error over one slice of the eligible set, so a
// fragility concentrated in one source, class, length band or platform shows up
// instead of being diluted into a single overall error rate.
export interface ResolutionSlice {
  key: string;
  // Denominator: the eligible records in this slice.
  eligible: number;
  scored: number;
  abstained: number;
  errored: number;
  coverage: MetricEstimate;
  abstentionRate: MetricEstimate;
  errorRate: MetricEstimate;
}

// The four required breakdown axes. Keys are sorted by unicode codepoint, like
// every other keyed collection the report seals.
export interface ResolutionBreakdown {
  bySource: ResolutionSlice[];
  byClass: ResolutionSlice[];
  byLengthBucket: ResolutionSlice[];
  byPlatform: ResolutionSlice[];
}

export interface EvaluationMetrics {
  warning: DecisionFamilies;
  visualAction: DecisionFamilies | null;
  rocAuc: MetricEstimate;
  prAuc: MetricEstimate;
  brier: MetricEstimate;
  ece15: MetricEstimate;
  coverage: MetricEstimate;
  abstentionRate: MetricEstimate;
  errorRate: MetricEstimate;
  // Coverage and error rate per source, class, length band and platform.
  resolution: ResolutionBreakdown;
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

// One holdout record's scoring outcome, as a union DISCRIMINATED BY `status`.
//
// This shape is load-bearing, not stylistic. While the item was one object with
// `documentScore: number` and a separate `status`, every caller had to invent a
// score for the rows that have none, `evaluate.ts` did it with `?? 0` — the most
// human score possible — and 325 failed inferences were counted as true
// negatives. Now only the `scored` branch HAS a score and a decision, so a
// consumer cannot read `documentScore` or `warned` without first narrowing on
// `status`, and there is nothing to substitute (R5).
interface EvaluationItemTelemetry {
  record: BenchmarkRecord;
  latencyMs?: number;
  memoryBytes?: number;
}

/** The only branch that carries a probability and the two frozen decisions. */
export interface ScoredEvaluationItem extends EvaluationItemTelemetry {
  status: "scored";
  documentScore: number;
  warned: boolean;
  visualActioned: boolean;
}

/** The runtime declined to decide (below the word floor, unsupported evidence). */
export interface AbstainedEvaluationItem extends EvaluationItemTelemetry {
  status: "abstained";
}

/** Inference failed. No score, no decision, no substitution. */
export interface ErroredEvaluationItem extends EvaluationItemTelemetry {
  status: "error";
}

export type EvaluationItem =
  ScoredEvaluationItem | AbstainedEvaluationItem | ErroredEvaluationItem;

/** Narrowing guard: `Array.prototype.filter` keeps the `scored` branch typed. */
export function isScoredItem(
  item: EvaluationItem,
): item is ScoredEvaluationItem {
  return item.status === "scored";
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

  const eligible = items.filter((item) =>
    isEligible(item.record, minimumWords),
  );
  const eligibleCount = eligible.length;

  // Both decision families are measured over the ELIGIBLE set: end-to-end over
  // all of it, conditional over the part of it that produced a score.
  const warning = decisionFamilies(eligible, (item) => item.warned);
  const visualAction = visualActionAvailable
    ? decisionFamilies(eligible, (item) => item.visualActioned)
    : null;

  // Continuous ranking/calibration metrics run over the scored positive/negative
  // set; mixed records below 50% AI are neither, so they never enter the curve.
  const scoredBinary = items
    .filter(isScoredItem)
    .filter(
      (item) => isWarningPositive(item.record) || isHumanNegative(item.record),
    );

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
    resolution: resolutionBreakdown(eligible),
    simulatedPrecision: {
      prevalence01: simulatedPrecisionAt(warning, prevalences.prevalence01),
      prevalence05: simulatedPrecisionAt(warning, prevalences.prevalence05),
      prevalence10: simulatedPrecisionAt(warning, prevalences.prevalence10),
    },
    latency: latencyMetricsAll(items),
    memory: memoryMetricsAll(items),
    mixed: {
      atLeastHalfAi: mixedAtLeastHalfAi(eligible),
      byFraction: mixedByFraction(eligible),
    },
  };
}

// The mandatory pair for one decision (warning or visual action) over one
// already-eligible population. A6 adds new estimands by extending
// DecisionMetrics and reusing this helper, so every new number arrives in both
// families at once instead of as a single unqualified figure.
function decisionFamilies(
  eligible: readonly EvaluationItem[],
  decide: (item: ScoredEvaluationItem) => boolean,
): DecisionFamilies {
  return {
    endToEnd: decisionMetrics(eligible, decide, "end-to-end"),
    conditionalOnScored: decisionMetrics(
      eligible.filter(isScoredItem),
      decide,
      "conditional-on-scored",
    ),
  };
}

// One confusion matrix over one population. `decide` is only ever called on a
// scored item — the union makes that a type rule rather than a convention — and
// a record with no decision is counted as undecided, never as a success.
function decisionMetrics(
  population: readonly EvaluationItem[],
  decide: (item: ScoredEvaluationItem) => boolean,
  family: MetricFamily,
): DecisionMetrics {
  let positives = 0;
  let negatives = 0;
  let truePositives = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let undecidedPositives = 0;
  let undecidedNegatives = 0;

  for (const item of population) {
    const positive = isWarningPositive(item.record);
    const negative = isHumanNegative(item.record);
    if (!positive && !negative) continue;
    if (positive) positives += 1;
    else negatives += 1;

    if (!isScoredItem(item)) {
      // No score, so no decision. A positive that never got a decision is a
      // missed detection; a negative that never got one is NOT a correct
      // clearance and NOT an accusation.
      if (positive) {
        undecidedPositives += 1;
        falseNegatives += 1;
      } else {
        undecidedNegatives += 1;
      }
      continue;
    }

    const decided = decide(item);
    if (positive) {
      if (decided) truePositives += 1;
      else falseNegatives += 1;
    } else if (decided) falsePositives += 1;
    else trueNegatives += 1;
  }

  return {
    family,
    sampleSize: positives + negatives,
    positives,
    negatives,
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    undecidedPositives,
    undecidedNegatives,
    falsePositiveRate: proportionEstimate(
      falsePositives,
      falsePositives + trueNegatives,
    ),
    clearanceRate: proportionEstimate(trueNegatives, negatives),
    recall: proportionEstimate(truePositives, positives),
    precision: proportionEstimate(
      truePositives,
      truePositives + falsePositives,
    ),
  };
}

// --- coverage / error by slice ---------------------------------------------

// The four required axes. `source` is the provenance source id and `class` the
// record label, so a coverage hole in one corpus or one class is visible instead
// of averaged away.
const RESOLUTION_AXES: ReadonlyArray<
  readonly [keyof ResolutionBreakdown, (record: BenchmarkRecord) => string]
> = [
  ["bySource", (record) => record.provenance.sourceId],
  ["byClass", (record) => record.label],
  ["byLengthBucket", (record) => sizeBucket(record.wordCount)],
  ["byPlatform", (record) => record.platform],
];

function resolutionBreakdown(
  eligible: readonly EvaluationItem[],
): ResolutionBreakdown {
  const breakdown = {} as ResolutionBreakdown;
  for (const [axis, keyOf] of RESOLUTION_AXES) {
    breakdown[axis] = resolutionSlices(eligible, keyOf);
  }
  return breakdown;
}

function resolutionSlices(
  eligible: readonly EvaluationItem[],
  keyOf: (record: BenchmarkRecord) => string,
): ResolutionSlice[] {
  const buckets = new Map<string, EvaluationItem[]>();
  for (const item of eligible) {
    const key = keyOf(item.record);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [item]);
    else bucket.push(item);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, bucket]) => {
      const scored = bucket.filter((item) => item.status === "scored").length;
      const abstained = bucket.filter(
        (item) => item.status === "abstained",
      ).length;
      const errored = bucket.filter((item) => item.status === "error").length;
      return {
        key,
        eligible: bucket.length,
        scored,
        abstained,
        errored,
        coverage: proportionEstimate(scored, bucket.length),
        abstentionRate: proportionEstimate(abstained, bucket.length),
        errorRate: proportionEstimate(errored, bucket.length),
      };
    });
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
  items: readonly ScoredEvaluationItem[],
  statistic: (sample: readonly ScoredEvaluationItem[]) => number,
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

function rocAucFromItems(items: readonly ScoredEvaluationItem[]): number {
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

function prAucFromItems(items: readonly ScoredEvaluationItem[]): number {
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

function sampleBrier(items: readonly ScoredEvaluationItem[]): number {
  return brierScore(items.map(toCalibrationPoint));
}

function sampleEce(items: readonly ScoredEvaluationItem[]): number {
  return ece15(items.map(toCalibrationPoint));
}

function toCalibrationPoint(item: ScoredEvaluationItem): CalibrationPoint {
  return {
    probability: item.documentScore,
    label: isWarningPositive(item.record) ? 1 : 0,
  };
}

// Projected from the END-TO-END operating point: the prevalence projection is a
// product question ("how often would a warning be right in real traffic?"), and
// real traffic includes the documents whose inference fails.
function simulatedPrecisionAt(
  warning: DecisionFamilies,
  prevalence: number,
): number {
  return simulatedPrecision({
    truePositiveRate: warning.endToEnd.recall.value,
    falsePositiveRate: warning.endToEnd.falsePositiveRate.value,
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

// END-TO-END by construction: the denominator is every eligible >=50% AI mixed
// record and an undecided one counts as a miss, so an inference failure can
// never raise this recall.
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
  const warned = strong.filter(
    (item) => isScoredItem(item) && item.warned,
  ).length;
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
      // A mixed bucket holds no human negatives, so this matrix is a pure recall
      // block; it is the end-to-end family, like the aggregate above.
      warning: decisionMetrics(bucket, (item) => item.warned, "end-to-end"),
    }));
}
