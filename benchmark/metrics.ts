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
//     label, never a score; human records are the only negatives — mixed text
//     never inflates the human negative count.
//
//     WHAT COUNTS AS A POSITIVE IS NOT ONE ANSWER (B2). The frozen three-target
//     table gives each target a different product action, so this module publishes
//     two positive populations and names both on every matrix
//     (`DecisionMetrics.positivePopulation`):
//       - WARNING positives — integral generation (`label = "ai"`) plus MECHANISTIC
//         material assistance (`label = "mixed"`, `aiFraction >= 0.50`);
//       - the positives that may AUTHORIZE VISUAL ACTION — integral generation
//         alone, published as `EvaluationMetrics.actionAuthorization`, because
//         material assistance authorizes `indicator` and nothing more.
//     Mixed below the fraction floor and the whole `ecological` cohort are
//     positives of nothing: they are diagnostic slices, kept apart and never
//     pooled (`materialAssistance.cohortsAggregated: false`). Span localization is
//     diagnostic too — see `EvaluationMetrics.localization`.
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
import {
  oneSidedZ,
  wilsonOneSided,
  wilsonOneSidedAtAlpha,
} from "./intervals.ts";
import { REBUILD_V3_POLICY } from "./rebuild-v3-policy.ts";
import type { GenerationMode } from "./rebuild-v3-policy.ts";
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
//
// The 95% bounds are INDIVIDUAL and descriptive. `simultaneous` is the same
// estimator re-evaluated at alpha_family / m (Bonferroni), and it is the only
// bound a release gate may read: with dozens of one-sided gates, individual 95%
// bounds do not control the family-wise error rate. It is present only when the
// caller declared the pre-registered gate count `m`; when it is absent the gate
// fails for missing evidence rather than reusing the 95% bound as if it were
// simultaneous (benchmark/gates.ts).
export interface MetricEstimate {
  value: number;
  lower95?: number;
  upper95?: number;
  method: "point" | "wilson-one-sided" | "author-cluster-percentile";
  simultaneous?: SimultaneousBound;
}

export interface SimultaneousBound {
  correction: "bonferroni";
  familyAlpha: number;
  m: number;
  alpha: number;
  // The normal critical value, on the Wilson path only: a percentile bootstrap
  // bound reads percentiles of the replicate distribution and has no z.
  z?: number;
  // The resampling effort, on the PERCENTILE path only (the Wilson bound is
  // analytic and resamples nothing). `replicates` is how many finite replicates
  // the percentile was read from and `tailReplicates` how many of them lie beyond
  // the bound — at alpha_family / m that is a handful, which is why the numbers
  // are published instead of left to the reader's imagination (R7). A gate refuses
  // a bound whose `replicates` is below the pre-registered count.
  replicates?: number;
  tailReplicates?: number;
  lower: number;
  upper: number;
  method: "wilson-one-sided" | "author-cluster-percentile";
}

// The multiplicity declaration of one evaluation: how many pre-registered
// mandatory statistical gates share the family-wise alpha, and the per-gate alpha
// and critical value that follow. `m` is frozen in G5; a cell without power stays
// inside `m` and fails, it never shrinks the divisor.
export interface MultiplicityDeclaration {
  correction: "bonferroni";
  familyAlpha: number;
  descriptiveConfidence: number;
  m: number;
  perGateAlpha: number;
  z: number;
}

// Which population a confusion matrix was measured over. Every DecisionMetrics
// carries its own role, so no consumer can read a rate without knowing which
// denominator produced it (R5: metrics come out in pairs, never as "the" FPR).
//
//   * "end-to-end"           — every record of the population, whatever its
//                              status. A record whose inference produced no
//                              decision is a NON-DETECTION: for a positive a
//                              false negative, for a negative neither a false
//                              positive nor a true negative but an explicitly
//                              undecided cell.
//   * "conditional-on-scored" — only the records of the population with
//                              `status === "scored"`.
//
// The role names a STATUS rule, not an eligibility rule: "end-to-end" means no
// record is dropped for lacking a decision. WHICH population is handed in is the
// caller's choice, and it is not the same everywhere in this module:
//
//   * `metrics.warning` / `metrics.visualAction` run over the ELIGIBLE subset
//     (pt-BR and at least `minimumEligibleWords` words);
//   * the two `metrics.mixed` blocks deliberately run over EVERY mixed record,
//     eligible or not — see the R3 note above the `mixed:` block in
//     `computeEvaluationMetrics`. `byFraction[].warning` is a full
//     `DecisionMetrics` and still stamps `family: "end-to-end"`, because the
//     label describes the status rule it applies and not its population;
//     `atLeastHalfAi` is a bare recall triple that follows the same status rule
//     without carrying the field at all.
//
// So a consumer must never infer the denominator from `family`: read the
// matrix's own `sampleSize` / `positives` / `negatives`.
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
// WHICH of the frozen targets supplied the positives of a confusion matrix.
// Published on every matrix because "positives" is not one population in this
// module: the warning decision counts integral generation AND mechanistic
// material assistance, while anything that AUTHORIZES visual action counts
// integral generation alone (B2).
export type PositivePopulation = "warning-positives" | "integral-positives";

export interface DecisionMetrics {
  family: MetricFamily;
  // The target whose positives are in `positives`. A consumer that needs to know
  // whether a rate may authorize an action reads this, never the field name.
  positivePopulation: PositivePopulation;
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

// --- named roles (A6) ------------------------------------------------------
//
// The plan is emphatic about which number decides a release and which one only
// describes the model, and about the direction never being reversible: recall and
// FPR AT THE FROZEN THRESHOLD are the release metrics, AUROC and TPR@1%FPR are a
// separability diagnostic. The two live in separately named blocks so citing the
// wrong one takes a visible lie rather than a plausible slip: a release claim can
// only be read out of `EvaluationMetrics.release`, and nothing in there is a
// ranking statistic.

// WHICH population an `errorRate` companion was measured over. A conditional
// number is uninterpretable without knowing how much of its own population
// produced no decision — and "its own population" is not the same set in every
// block of this artifact, so the denominator is NAMED instead of assumed (R7):
//
//   * "eligible"                     — every eligible row (pt-BR, at least
//                                      `minimumEligibleWords` words), whatever its
//                                      label. This is `EvaluationMetrics.errorRate`
//                                      and the integrity gate's denominator.
//   * "eligible-decision-population" — the eligible rows that are a warning
//                                      positive or a human negative, i.e. exactly
//                                      what the two decision families count. A
//                                      mixed row below 50% AI is eligible and is
//                                      in NEITHER family (frozen table: diagnostic
//                                      slice only), so this set is smaller.
//   * "binary-population"            — every warning positive or human negative,
//                                      eligibility aside, which is the population
//                                      behind `scoredBinary` and therefore behind
//                                      the ranking and calibration statistics.
export type ErrorRatePopulation =
  "eligible" | "eligible-decision-population" | "binary-population";

/** One decision at its frozen threshold: the release metric, end-to-end. */
export interface FrozenThresholdMetrics {
  role: "release";
  decision: "warning" | "visual-action";
  family: "end-to-end";
  recall: MetricEstimate;
  falsePositiveRate: MetricEstimate;
  // The error rate of the population BOTH families were measured over, published
  // beside the rates because a rate is uninterpretable without knowing how much of
  // its own denominator produced no decision at all.
  errorRatePopulation: "eligible-decision-population";
  errorRate: MetricEstimate;
  // The conditional mirror, kept here and only here: it is a diagnostic, it is
  // sensitive to selective failure (if the documents that would have scored badly
  // are exactly the ones that failed, these numbers improve while nothing does),
  // and it never decides a release on its own.
  conditional: {
    role: "diagnostic";
    family: "conditional-on-scored";
    selectiveFailureSensitive: true;
    recall: MetricEstimate;
    falsePositiveRate: MetricEstimate;
    // The same companion as the release row above: the two rows differ by exactly
    // the rows this rate counts, which is the comparison that exposes selective
    // failure.
    errorRatePopulation: "eligible-decision-population";
    errorRate: MetricEstimate;
  };
}

export interface ReleaseMetrics {
  role: "release";
  thresholdSource: "frozen-calibration-threshold";
  warning: FrozenThresholdMetrics;
  visualAction: FrozenThresholdMetrics | null;
}

/** Highest TPR reachable while the empirical FPR stays at or below the target. */
export interface TprAtFixedFpr {
  targetFpr: number;
  achievedFpr: number;
  tpr: number;
  threshold: number;
  sampleSize: number;
}

// Separability only: how well the score RANKS, which is precisely the family of
// numbers that decouples from behaviour at a low FPR budget (assessment §4.6).
// `gates: false` is a literal so a consumer cannot mistake this block for a gate
// input, and the error rate travels with it because it is measured over the
// scored subset — the error rate of THAT subset's own population, which is every
// binary row and not the whole eligible set.
export interface SeparabilityDiagnostic {
  role: "diagnostic";
  purpose: "separability";
  gates: false;
  population: "conditional-on-scored";
  errorRatePopulation: "binary-population";
  errorRate: MetricEstimate;
  auroc: MetricEstimate;
  prAuc: MetricEstimate;
  tprAtOnePercentFpr: TprAtFixedFpr;
}

export interface ReliabilityBin {
  index: number;
  count: number;
  meanProbability: number;
  positiveRate: number;
  lowestProbability: number;
  highestProbability: number;
}

// Calibration over one slice. BOTH denominators are published: `count` is the
// number of SCORED rows the statistics were computed on, `populationSize` is the
// slice's whole binary population, and `errorRate` is over that population — the
// same construction as the aggregate block, so a slice that looks well calibrated
// because its hard rows failed is visible, and the slices are a decomposition of
// the aggregate rather than a differently-filtered set.
export interface CalibrationSliceMetrics {
  key: string;
  count: number;
  populationSize: number;
  samplingUnits: number;
  samplingUnitAxis: "groups.author";
  brier: number;
  logLoss: number;
  eceEqualMass: number;
  errorRate: MetricEstimate;
}

export interface CalibrationDiagnostics {
  role: "diagnostic";
  // The one statistic in this block a gate reads, and it reads its interval.
  gatedStatistic: "eceEqualMass15";
  population: "conditional-on-scored";
  // The two denominators, published so no consumer has to guess which one a
  // statistic used: `scored` is what every calibration number was computed on,
  // `populationSize` is the binary population behind it, and `errorRate` is the
  // gap between them expressed as a rate.
  scored: number;
  populationSize: number;
  errorRatePopulation: "binary-population";
  errorRate: MetricEstimate;
  brier: MetricEstimate;
  logLoss: number;
  intercept: number;
  slope: number;
  bins: number;
  // Equal-mass bins: the gated calibration statistic. Equal-width ECE stays
  // published as `EvaluationMetrics.ece15` for continuity, as a diagnostic.
  eceEqualMass15: MetricEstimate;
  reliability: ReliabilityBin[];
  byLengthBucket: CalibrationSliceMetrics[];
  bySource: CalibrationSliceMetrics[];
  byLinguisticStratum: CalibrationSliceMetrics[];
  // The label-basis axis is NOT here: it carries a gating role and a sampling-unit
  // count of its own, so it lives in `EvaluationMetrics.labelBasis`.
}

export type LabelBasisKey = "date-cutoff" | "observed-process" | "unknown";

// One evidence basis for the HUMAN negatives, never pooled with another. Counts,
// sampling units and interval are separate per basis because a handful of
// `observed-process` rows must not raise the claim of the whole set: below the
// pre-registered floor the slice is supplementary diagnostic and cannot approve a
// gate, lift an action ceiling or back a stronger aggregate statement.
export interface LabelBasisSlice {
  basis: LabelBasisKey;
  count: number;
  scored: number;
  errored: number;
  samplingUnits: number;
  samplingUnitAxis: "groups.author";
  powered: boolean;
  powerFloor: number;
  evidenceRole: "gating" | "supplementary-diagnostic";
  falsePositiveRate: MetricEstimate;
  errorRate: MetricEstimate;
  brier: number;
  logLoss: number;
  eceEqualMass: number;
}

export interface LabelBasisBreakdown {
  role: "human-negative-label-evidence";
  // `labelBasis` only enters the closed schema in C1. Until then every row lands
  // in the `unknown` basis, which is never evidence — the field is read when
  // present and never invented when absent.
  fieldPresent: boolean;
  pooledClaimAllowed: false;
  bases: LabelBasisSlice[];
}

export interface PredictiveValueAtPrevalence {
  prevalence: number;
  ppv: number;
  npv: number;
}

// PPV and NPV projected onto plausible feed prevalences. `benchmarkPrevalence` is
// published beside them on purpose: the evaluation set is close to 50/50 and a
// real feed is overwhelmingly human, so a calibrated score under this prior is not
// the posterior probability that a document was AI-generated.
export interface PredictiveValueProjection {
  role: "release-context";
  family: "end-to-end";
  benchmarkPrevalence: number;
  byPrevalence: PredictiveValueAtPrevalence[];
}

// The statistic that may AUTHORIZE visual action, over the integral-generation
// positives alone (B2).
//
// Why it is a block of its own rather than a read of `metrics.visualAction`:
// `visualAction` is the operating point of the action threshold over the WARNING
// positives, which include mechanistic material assistance. The frozen table says
// material assistance authorizes `indicator` and nothing more, so if the action
// recall gate read that matrix a cohort of mixed rows crossing the action
// threshold would raise the recall that lifts `actionCeiling` to `hide`. Here the
// denominator is integral positives only, and the two exclusion counts are
// published so the difference between the populations is a number an auditor can
// see instead of a claim they have to trust (R7).
export interface ActionAuthorizationMetrics {
  role: "release";
  decision: "visual-action";
  positivePopulation: "integral-positives";
  family: "end-to-end";
  recall: MetricEstimate;
  // The denominator of `recall`: eligible integral positives.
  positives: number;
  // Eligible warning positives that are material assistance, i.e. exactly the
  // rows this statistic refuses to count.
  excludedMaterialAssistancePositives: number;
  // Eligible mixed rows of the OTHER cohort at or above the fraction floor. They
  // are not warning positives either; the count travels so a future ecological
  // sample is visible here rather than silently absent.
  excludedEcologicalCohort: number;
}

// One mixed-text fraction bucket, per cohort. `key` is `"<mode>/<bucket>"` —
// never the bare bucket — because the two cohorts are separate slices and a
// single key holding both would BE the aggregation the frozen table forbids.
export interface MixedFractionSegment {
  key: string;
  generationMode: GenerationMode;
  fractionBucket: string;
  sampleSize: number;
  warning: DecisionMetrics;
}

// The gated material-assistance recall triple: warned over every mixed row of ONE
// cohort at or above the frozen AI fraction. END-TO-END in the status sense — an
// undecided row is a miss — and never pooled across cohorts.
export interface MixedRecallBlock {
  generationMode: GenerationMode;
  sampleSize: number;
  warningRecall: number;
  warningRecallLower95: number;
}

// One mixed cohort as its own slice. `aggregated: false` is a literal: there is no
// cross-cohort total anywhere in this artifact, and this field says so at the
// point a reader would otherwise go looking for one.
export interface MixedCohort {
  generationMode: GenerationMode;
  role: "diagnostic" | "release";
  aggregated: false;
  sampleSize: number;
  atLeastHalfAi: MixedRecallBlock;
}

/** A half-open character-offset interval `[start, end)` into a record's text. */
export interface SpanInterval {
  start: number;
  end: number;
}

// The agreement between the observed AI spans of one record and what the localized
// path emitted for it, in the unit the spans are DEFINED in.
//
// R7 note on the word "token": the frozen table calls for "precisão/recall de
// token", and `mixture.spans` are character offsets (benchmark/schema.ts), so the
// unit counted here is the character offset and `unit` says so on every published
// block. When a tokenized span head exists the same ratios can be recounted over
// its tokens; until then naming this "token precision" without declaring the unit
// would be a claim about a tokenization that does not exist.
export interface SpanOverlap {
  // Merged lengths, so an input that lists an interval twice is not counted twice.
  observed: number;
  predicted: number;
  intersection: number;
  union: number;
  iou: number;
  tokenPrecision: number;
  tokenRecall: number;
  tokenF1: number;
}

// Localization over one cohort. DIAGNOSTIC in v3: `gates: false` and
// `authorizesVisualAction: false` are literals, matching
// `localization.metricsRole: "diagnostic"` and
// `localization.authorizesVisualAction: false` in the frozen contract.
export interface LocalizationCohort {
  generationMode: GenerationMode;
  role: "diagnostic";
  aggregated: false;
  // Scored rows of the cohort that carry at least one observed AI span. A row
  // whose localized path emitted nothing STAYS here and counts as a miss.
  population: number;
  localizedEmitted: number;
  localizedPathRecall: MetricEstimate;
  // Micro: one ratio over the summed intersections / unions / lengths of the
  // cohort, so a long document weighs what its length says it weighs.
  microIou: number;
  microTokenPrecision: number;
  microTokenRecall: number;
  // Macro: the unweighted mean of the per-row ratios, which is the number a
  // per-document reading of "how well was this located?" wants.
  macroIou: number;
  macroTokenPrecision: number;
  macroTokenRecall: number;
}

export interface LocalizationDiagnostics {
  role: "diagnostic";
  gates: false;
  authorizesVisualAction: false;
  unit: "character-offset";
  // Cohorts only. There is deliberately NO aggregate over both of them: an
  // aggregate is exactly what "as duas coortes são fatias separadas e nunca
  // agregadas" forbids, and a field that does not exist cannot be quoted.
  byGenerationMode: LocalizationCohort[];
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
  // The operating point of the visual-action threshold over the WARNING
  // positives (`positivePopulation: "warning-positives"`). Its FPR is the action
  // budget's statistic — negatives are human rows, so the positive definition
  // cannot touch it. Its RECALL is a diagnostic and is NOT what authorizes an
  // action: read `actionAuthorization` for that (B2).
  visualAction: DecisionFamilies | null;
  // The recall that may lift the action ceiling, over integral positives alone.
  // Null exactly when no visual-action threshold was frozen.
  actionAuthorization: ActionAuthorizationMetrics | null;
  // The release metric, with its role in the field name (A6). Same numbers as
  // `warning`/`visualAction`, projected under the name that says what they decide.
  release: ReleaseMetrics;
  // Ranking quality. AUROC and PR-AUC moved in here from the top level so no
  // consumer can quote them as if they were the release metric.
  separability: SeparabilityDiagnostic;
  calibration: CalibrationDiagnostics;
  labelBasis: LabelBasisBreakdown;
  predictiveValue: PredictiveValueProjection;
  // Null until the caller declares the pre-registered gate count.
  multiplicity: MultiplicityDeclaration | null;
  // Equal-WIDTH ECE-15, kept as a diagnostic and as the statistic the sealed
  // calibration profile still publishes. The GATE reads
  // `calibration.eceEqualMass15`.
  ece15: MetricEstimate;
  coverage: MetricEstimate;
  abstentionRate: MetricEstimate;
  // Inference error over the WHOLE eligible set. This is the integrity gate's
  // denominator and the one the resolution tables decompose; it is NOT the
  // companion of any conditional block, because those were measured over
  // narrower populations (see `ErrorRatePopulation`).
  errorRate: MetricEstimate;
  // Inference error over the population the two decision families were measured
  // over: the eligible rows that are a warning positive or a human negative.
  // Published at the top level so the report can put it inside the two-family
  // table without reaching into `release`.
  decisionPopulationErrorRate: MetricEstimate;
  // Inference error over every warning positive or human negative, eligibility
  // aside: the population behind `scoredBinary`, hence behind AUROC, PR-AUC and
  // every calibration statistic.
  binaryPopulationErrorRate: MetricEstimate;
  // Coverage and error rate per source, class, length band and platform.
  resolution: ResolutionBreakdown;
  simulatedPrecision: Record<
    "prevalence01" | "prevalence05" | "prevalence10",
    number
  >;
  latency: LatencyMetrics;
  memory: MemoryMetrics;
  // Span IoU, token precision/recall and localized-path recall, per cohort, all
  // diagnostic in v3.
  localization: LocalizationDiagnostics;
  mixed: {
    // The GATED block: the mechanistic cohort at or above the frozen AI fraction,
    // and it carries the cohort name so the gate's population is readable off the
    // artifact instead of inferred from the field name.
    atLeastHalfAi: MixedRecallBlock;
    // Every cohort, separately, including the mechanistic one. The gated block
    // above is the mechanistic entry of this list, projected under the name the
    // gate reads; nothing here is a cross-cohort total.
    byGenerationMode: MixedCohort[];
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
  // What the LOCALIZED path emitted for this row, in the character offsets the
  // record's own spans use. Absent means it emitted nothing — which is a miss for
  // the localized-path recall, never a reason to drop the row from a denominator.
  // Diagnostic only: a span explains and locates a warning and authorizes no
  // visual action of its own (`localization.authorizesVisualAction: false`).
  localizedSpans?: readonly SpanInterval[];
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
  // `m` for the Bonferroni correction: the number of PRE-REGISTERED mandatory
  // statistical gates that share `alpha_família`. Frozen in G5. When it is
  // absent no simultaneous bound is published, and benchmark/gates.ts then fails
  // every interval gate for missing evidence instead of reading a 95% bound as if
  // it controlled the family.
  preRegisteredStatisticalGates?: number;
}

// Every threshold below comes from the frozen contract
// (benchmark/rebuild-v3-policy.json); none of them is a local constant.
const ECE_BINS = REBUILD_V3_POLICY.calibrationGate.eceBins;
const BOOTSTRAP_ITERATIONS = 2_000 as const;
const DEFAULT_MINIMUM_ELIGIBLE_WORDS = REBUILD_V3_POLICY.wordFloor.abstainBelow;
const MATERIAL_ASSISTANCE_AI_FRACTION =
  REBUILD_V3_POLICY.materialAssistance.minimumAiFraction;
// The ONE cohort the material-assistance target is defined over. `ecological` is
// a separate cohort and is never added to it (`cohortsAggregated: false`).
const MATERIAL_ASSISTANCE_MODE =
  REBUILD_V3_POLICY.materialAssistance.generationMode;
const GENERATION_MODES = REBUILD_V3_POLICY.materialAssistance.generationModes;
const LABEL_BASIS_POWER_FLOOR =
  REBUILD_V3_POLICY.powerFloors.criticalFprHumanNegatives;
// The legacy `simulatedPrecision` trio is the first three policy prevalences; the
// `predictiveValue` block publishes all of them, with NPV beside every PPV.
const POLICY_PREVALENCES = REBUILD_V3_POLICY.predictiveValuePrevalences;
const DEFAULT_PREVALENCES: SimulatedPrevalences = {
  prevalence01: POLICY_PREVALENCES[0],
  prevalence05: POLICY_PREVALENCES[1],
  prevalence10: POLICY_PREVALENCES[2],
};
// Log loss clamp: a probability of exactly 0 or 1 would make the statistic
// infinite and destroy every aggregate it enters. The clamp is declared, not
// hidden, and it is the only substitution anywhere in this module — it changes a
// finite-precision score, never a missing one (R5 is about absent scores).
const LOG_LOSS_EPSILON = 1e-12;

// --- the three frozen targets, as predicates (B2) ---------------------------
//
// The frozen table (plan, "alvos, métricas e ações de produto") closes three
// targets, and each one authorizes a different product action. The predicates
// below are the only place that translation happens, so a caller cannot pick the
// wrong population by accident:
//
//   | target                        | positive of                  | authorizes |
//   |-------------------------------|------------------------------|------------|
//   | integral generation           | warning AND visual action    | indicator; visual action only if the document gates pass |
//   | mechanistic material assist.  | warning ONLY                 | indicator  |
//   | observed spans                | neither (a localized detail) | explains a warning; never an action on its own |
//
// Mixed below the frozen AI fraction, and the whole `ecological` cohort, are
// positives of NOTHING: they are diagnostic slices of the curve.

/** A document generated integrally by a registered pipeline (`label = "ai"`). */
export function isIntegralPositive(record: BenchmarkRecord): boolean {
  return record.label === REBUILD_V3_POLICY.integralPositive.label;
}

/**
 * Material assistance: `label = "mixed"`, `generationMode = "mechanistic"` and
 * `aiFraction >= 0.50`, all three from the frozen contract. The generation mode
 * is part of the DEFINITION, not a decoration: an `ecological` row above the same
 * fraction belongs to the other cohort and is never pooled into this one.
 */
export function isMaterialAssistancePositive(record: BenchmarkRecord): boolean {
  const mixture = record.mixture;
  return (
    record.label === "mixed" &&
    mixture !== undefined &&
    mixture.generationMode === MATERIAL_ASSISTANCE_MODE &&
    mixture.aiFraction >= MATERIAL_ASSISTANCE_AI_FRACTION
  );
}

/** Warning positives: integral generation plus mechanistic material assistance. */
export function isWarningPositive(record: BenchmarkRecord): boolean {
  return isIntegralPositive(record) || isMaterialAssistancePositive(record);
}

/**
 * The positives that may AUTHORIZE visual action: integral generation only.
 * Material assistance authorizes `indicator` and nothing more
 * (`materialAssistance.authorizes: "warning-only"`), so letting a mixed row into
 * this population would let it raise a recall that lifts the action ceiling —
 * which is the one thing the frozen table says it can never do.
 */
export function isVisualActionPositive(record: BenchmarkRecord): boolean {
  return isIntegralPositive(record);
}

// The only negatives are clean human records; mixed text is never a negative.
export function isHumanNegative(record: BenchmarkRecord): boolean {
  return record.label === "human";
}

/** The cohort of a mixed record, or `undefined` for a non-mixed one. */
function generationModeOf(record: BenchmarkRecord): GenerationMode | undefined {
  if (record.label !== "mixed") return undefined;
  return record.mixture?.generationMode;
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

// PPV and NPV at one prevalence. PPV is `simulatedPrecision`; NPV answers the
// other half of the same question — "if this feed is 99% human, how often is a
// silent document really human?" — and it is the number a reader needs to see the
// asymmetry: at a low prevalence PPV collapses while NPV stays near one.
export function predictiveValues(input: {
  truePositiveRate: number;
  falsePositiveRate: number;
  prevalence: number;
}): { ppv: number; npv: number } {
  const trueNegatives = (1 - input.prevalence) * (1 - input.falsePositiveRate);
  const falseNegatives = input.prevalence * (1 - input.truePositiveRate);
  const negativeDenominator = trueNegatives + falseNegatives;
  return {
    ppv: simulatedPrecision(input),
    npv: negativeDenominator === 0 ? 0 : trueNegatives / negativeDenominator,
  };
}

// Equal-MASS ECE: the points are ordered by probability and split into `bins`
// groups of (near) equal size, so every bin carries real data. Equal-width bins
// are sensitive to a grid the scores may never populate and hide conditional
// error inside one crowded bin (assessment §4.4), which is why the gate reads
// this one. When the count is not a multiple of `bins` the first
// `count % bins` groups take one extra point, and no point is ever dropped.
export function eceEqualMass(
  points: readonly CalibrationPoint[],
  bins: number = ECE_BINS,
): number {
  if (points.length === 0 || bins < 1) return Number.NaN;
  let ece = 0;
  for (const bin of equalMassBins(points, bins)) {
    let probabilitySum = 0;
    let positiveSum = 0;
    for (const point of bin) {
      probabilitySum += point.probability;
      positiveSum += point.label;
    }
    const meanProbability = probabilitySum / bin.length;
    const positiveRate = positiveSum / bin.length;
    ece +=
      (bin.length / points.length) * Math.abs(meanProbability - positiveRate);
  }
  return ece;
}

/** The reliability diagram behind `eceEqualMass`: one row per equal-mass bin. */
export function reliabilityDiagram(
  points: readonly CalibrationPoint[],
  bins: number = ECE_BINS,
): ReliabilityBin[] {
  const rows: ReliabilityBin[] = [];
  let index = 0;
  for (const bin of equalMassBins(points, bins)) {
    let probabilitySum = 0;
    let positiveSum = 0;
    for (const point of bin) {
      probabilitySum += point.probability;
      positiveSum += point.label;
    }
    rows.push({
      index,
      count: bin.length,
      meanProbability: probabilitySum / bin.length,
      positiveRate: positiveSum / bin.length,
      lowestProbability: bin[0].probability,
      highestProbability: bin[bin.length - 1].probability,
    });
    index += 1;
  }
  return rows;
}

function equalMassBins(
  points: readonly CalibrationPoint[],
  bins: number,
): CalibrationPoint[][] {
  if (points.length === 0 || bins < 1) return [];
  const sorted = [...points].sort((a, b) => a.probability - b.probability);
  const groups: CalibrationPoint[][] = [];
  const count = Math.min(bins, sorted.length);
  for (let bin = 0; bin < count; bin += 1) {
    const start = Math.floor((bin * sorted.length) / count);
    const end = Math.floor(((bin + 1) * sorted.length) / count);
    if (end > start) groups.push(sorted.slice(start, end));
  }
  return groups;
}

// Log loss (mean negative log-likelihood). Reported beside Brier because the two
// disagree about which failure is expensive: Brier is quadratic, log loss punishes
// a confident miss without bound, which is the failure mode a warning threshold
// cares about.
export function logLoss(points: readonly CalibrationPoint[]): number {
  if (points.length === 0) return Number.NaN;
  let sum = 0;
  for (const point of points) {
    const p = Math.min(
      1 - LOG_LOSS_EPSILON,
      Math.max(LOG_LOSS_EPSILON, point.probability),
    );
    sum -= point.label === 1 ? Math.log(p) : Math.log(1 - p);
  }
  return sum / points.length;
}

/**
 * Calibration intercept and slope (the Cox calibration line): the logistic
 * regression of the observed label on the LOGIT of the reported probability. A
 * perfectly calibrated score gives intercept 0 and slope 1; a slope below 1 is
 * overconfidence and an intercept away from 0 is a systematic shift — neither is
 * visible in a single ECE number.
 *
 * Fitted by Newton-Raphson on the two-parameter likelihood. Both values are NaN
 * when the fit is not identified (fewer than two points, a single class, or no
 * spread in the logits, where the slope is arbitrary) — never a fabricated 1.
 */
export function calibrationInterceptSlope(
  points: readonly CalibrationPoint[],
): { intercept: number; slope: number } {
  const undefinedFit = { intercept: Number.NaN, slope: Number.NaN };
  if (points.length < 2) return undefinedFit;
  const xs: number[] = [];
  const ys: number[] = [];
  let positives = 0;
  for (const point of points) {
    const p = Math.min(
      1 - LOG_LOSS_EPSILON,
      Math.max(LOG_LOSS_EPSILON, point.probability),
    );
    xs.push(Math.log(p / (1 - p)));
    ys.push(point.label);
    positives += point.label;
  }
  if (positives === 0 || positives === points.length) return undefinedFit;
  const spread = Math.max(...xs) - Math.min(...xs);
  if (!(spread > 0)) return undefinedFit;

  let intercept = 0;
  let slope = 1;
  for (let iteration = 0; iteration < 200; iteration += 1) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (let i = 0; i < xs.length; i += 1) {
      const eta = intercept + slope * xs[i];
      const mu = 1 / (1 + Math.exp(-eta));
      const residual = ys[i] - mu;
      const weight = mu * (1 - mu);
      g0 += residual;
      g1 += residual * xs[i];
      h00 += weight;
      h01 += weight * xs[i];
      h11 += weight * xs[i] * xs[i];
    }
    const determinant = h00 * h11 - h01 * h01;
    if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-14) break;
    const step0 = (h11 * g0 - h01 * g1) / determinant;
    const step1 = (h00 * g1 - h01 * g0) / determinant;
    // Backtracking: an undamped Newton step overshoots badly when the logits are
    // widely spread (it flipped the slope's sign on a deliberately overconfident
    // fixture), so the step is halved until the log-likelihood stops falling.
    // Deterministic: a fixed schedule, no randomness, no tuning parameter.
    const current = logLikelihood(xs, ys, intercept, slope);
    let scale = 1;
    let accepted = false;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const nextIntercept = intercept + scale * step0;
      const nextSlope = slope + scale * step1;
      if (logLikelihood(xs, ys, nextIntercept, nextSlope) >= current) {
        intercept = nextIntercept;
        slope = nextSlope;
        accepted = true;
        break;
      }
      scale /= 2;
    }
    if (!accepted) break;
    if (Math.abs(scale * step0) < 1e-12 && Math.abs(scale * step1) < 1e-12) {
      break;
    }
  }
  if (!Number.isFinite(intercept) || !Number.isFinite(slope)) {
    return undefinedFit;
  }
  return { intercept, slope };
}

// Bernoulli log-likelihood of the calibration line, written so overflow cannot
// turn a large |eta| into a NaN: log(sigma(eta)) = -log1p(exp(-eta)) for eta >= 0
// and eta - log1p(exp(eta)) otherwise.
function logLikelihood(
  xs: readonly number[],
  ys: readonly number[],
  intercept: number,
  slope: number,
): number {
  let total = 0;
  for (let i = 0; i < xs.length; i += 1) {
    const eta = intercept + slope * xs[i];
    const logSigma =
      eta >= 0 ? -Math.log1p(Math.exp(-eta)) : eta - Math.log1p(Math.exp(eta));
    total += ys[i] === 1 ? logSigma : logSigma - eta;
  }
  return total;
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

  const bonferroni = multiplicityFrom(options.preRegisteredStatisticalGates);

  const eligible = items.filter((item) =>
    isEligible(item.record, minimumWords),
  );
  const eligibleCount = eligible.length;

  // Both decision families are measured over the ELIGIBLE set: end-to-end over
  // all of it, conditional over the part of it that produced a score.
  const warning = decisionFamilies(eligible, (item) => item.warned, bonferroni);
  const visualAction = visualActionAvailable
    ? decisionFamilies(eligible, (item) => item.visualActioned, bonferroni)
    : null;
  // The authorizing statistic: the SAME decision over the integral positives
  // alone. A separate matrix, not a projection of the one above, because the
  // populations differ (B2).
  const actionAuthorization = visualActionAvailable
    ? actionAuthorizationMetrics(eligible, bonferroni)
    : null;

  // Continuous ranking/calibration metrics run over the scored positive/negative
  // set; mixed records below 50% AI are neither, so they never enter the curve.
  // NOTE the population: `items`, not `eligible`. That is a pre-existing choice
  // of this module (the curve is over every binary row that produced a score),
  // and it is why these statistics need their own error-rate companion.
  const binaryPopulation = items.filter(
    (item) => isWarningPositive(item.record) || isHumanNegative(item.record),
  );
  const scoredBinary = binaryPopulation.filter(isScoredItem);

  // Three denominators, three companions. Handing the whole-eligible-set rate to
  // a block measured over a narrower population is what made the phrase "the
  // error rate of the same population" false: with mixed<50% rows in the corpus
  // (a deliberate diagnostic slice of the frozen table) the sets differ, in
  // either direction, and the printed companion could be an order of magnitude
  // away from the failure rate of the rows the statistic actually used.
  const errorRate = proportionEstimate(
    eligible.filter((item) => item.status === "error").length,
    eligibleCount,
    bonferroni,
  );
  const decisionPopulation = eligible.filter(
    (item) => isWarningPositive(item.record) || isHumanNegative(item.record),
  );
  const decisionPopulationErrorRate = proportionEstimate(
    decisionPopulation.filter((item) => item.status === "error").length,
    decisionPopulation.length,
    bonferroni,
  );
  const binaryPopulationErrorRate = proportionEstimate(
    binaryPopulation.filter((item) => item.status === "error").length,
    binaryPopulation.length,
    bonferroni,
  );

  return {
    warning,
    visualAction,
    actionAuthorization,
    release: {
      role: "release",
      thresholdSource: "frozen-calibration-threshold",
      warning: frozenThresholdMetrics(
        "warning",
        warning,
        decisionPopulationErrorRate,
      ),
      visualAction:
        visualAction === null
          ? null
          : frozenThresholdMetrics(
              "visual-action",
              visualAction,
              decisionPopulationErrorRate,
            ),
    },
    separability: {
      role: "diagnostic",
      purpose: "separability",
      gates: false,
      population: "conditional-on-scored",
      errorRatePopulation: "binary-population",
      errorRate: binaryPopulationErrorRate,
      auroc: continuousEstimate(
        scoredBinary,
        rocAucFromItems,
        seed,
        bonferroni,
      ),
      prAuc: continuousEstimate(scoredBinary, prAucFromItems, seed, bonferroni),
      tprAtOnePercentFpr: tprAtTargetFpr(scoredBinary, DEFAULT_TARGET_FPR),
    },
    calibration: calibrationDiagnostics(
      binaryPopulation,
      scoredBinary,
      seed,
      bonferroni,
      binaryPopulationErrorRate,
    ),
    labelBasis: labelBasisBreakdown(eligible, bonferroni),
    predictiveValue: predictiveValueProjection(warning),
    multiplicity: bonferroni,
    ece15: continuousEstimate(scoredBinary, sampleEce, seed, bonferroni),
    coverage: proportionEstimate(
      eligible.filter((item) => item.status === "scored").length,
      eligibleCount,
      bonferroni,
    ),
    abstentionRate: proportionEstimate(
      eligible.filter((item) => item.status === "abstained").length,
      eligibleCount,
      bonferroni,
    ),
    errorRate,
    decisionPopulationErrorRate,
    binaryPopulationErrorRate,
    resolution: resolutionBreakdown(eligible, bonferroni),
    simulatedPrecision: {
      prevalence01: simulatedPrecisionAt(warning, prevalences.prevalence01),
      prevalence05: simulatedPrecisionAt(warning, prevalences.prevalence05),
      prevalence10: simulatedPrecisionAt(warning, prevalences.prevalence10),
    },
    latency: latencyMetricsAll(items),
    memory: memoryMetricsAll(items),
    // The mixed blocks run over ALL items, not over `eligible`. The eligible
    // restriction A3 introduced belongs to the two decision families and stops
    // there: `mixed.atLeastHalfAi` feeds its own approved gate, and shrinking a
    // gated population is a loosening (R3) — an ineligible mixed row that got no
    // decision would leave the denominator instead of counting as a miss, and at
    // sampleSize 0 gates.ts turns the mixed-recall gate into an unconditional
    // pass. Errored and abstained rows are excluded from the NUMERATOR only,
    // inside mixedAtLeastHalfAi / decisionMetrics.
    //
    // `isEligible` is TWO conditions, and running over all items re-admits both
    // kinds of row, each counting as a miss against MIXED_WARNING_RECALL_MIN:
    //   * the WORD FLOOR — a mixed row under `minimumEligibleWords`, which policy
    //     tells the runtime to abstain on;
    //   * the LANGUAGE axis — a mixed row whose `language !== "pt-BR"`, i.e. out
    //     of this detector's scope entirely.
    // Both directions are conservative (a larger denominator, same numerator), so
    // R3 is satisfied either way, but they are two separate populations and only
    // one of them is a measurement question. Charging an out-of-scope-language row
    // to a pt-BR detector's gate is the §4.1 unsatisfiable-gate pattern; A3 does
    // not decide it, and neither restriction may be reintroduced without measured
    // evidence written into the plan (A6/G2, plan item 7).
    localization: localizationDiagnostics(items),
    mixed: {
      atLeastHalfAi: mixedAtLeastHalfAi(items, MATERIAL_ASSISTANCE_MODE),
      // Sorted by codepoint, like every other keyed collection this module
      // seals; the policy's own order encodes which cohort we produce, not a
      // report ordering.
      byGenerationMode: sortedGenerationModes().map((mode) => ({
        generationMode: mode,
        // The mechanistic cohort is what the approved gate reads; the other one
        // is a separate cohort and carries no gate of its own.
        role: mode === MATERIAL_ASSISTANCE_MODE ? "release" : "diagnostic",
        aggregated: false as const,
        sampleSize: items.filter(
          (item) => generationModeOf(item.record) === mode,
        ).length,
        atLeastHalfAi: mixedAtLeastHalfAi(items, mode),
      })),
      byFraction: mixedByFraction(items, bonferroni),
    },
  };
}

// Recall of the visual-action decision over the eligible INTEGRAL positives, with
// the two populations it refuses to count published beside it.
function actionAuthorizationMetrics(
  eligible: readonly EvaluationItem[],
  bonferroni: MultiplicityDeclaration | null,
): ActionAuthorizationMetrics {
  const families = decisionFamilies(
    eligible,
    (item) => item.visualActioned,
    bonferroni,
    "integral-positives",
  );
  return {
    role: "release",
    decision: "visual-action",
    positivePopulation: "integral-positives",
    family: "end-to-end",
    recall: families.endToEnd.recall,
    positives: families.endToEnd.positives,
    excludedMaterialAssistancePositives: eligible.filter((item) =>
      isMaterialAssistancePositive(item.record),
    ).length,
    excludedEcologicalCohort: eligible.filter(
      (item) =>
        generationModeOf(item.record) !== undefined &&
        generationModeOf(item.record) !== MATERIAL_ASSISTANCE_MODE &&
        (item.record.mixture?.aiFraction ?? 0) >=
          MATERIAL_ASSISTANCE_AI_FRACTION,
    ).length,
  };
}

// --- named roles, calibration and label bases (A6) -------------------------

// The release projection of one decision. It reads the SAME matrices as
// `metrics.warning` / `metrics.visualAction`; the point is the naming, and that
// the conditional mirror can only be reached through a field that says it is a
// selective-failure-sensitive diagnostic and that carries the error rate with it.
function frozenThresholdMetrics(
  decision: "warning" | "visual-action",
  families: DecisionFamilies,
  // The error rate of the population BOTH families count, never the whole
  // eligible set: the two differ by every eligible row that is neither a warning
  // positive nor a human negative.
  errorRate: MetricEstimate,
): FrozenThresholdMetrics {
  return {
    role: "release",
    decision,
    family: "end-to-end",
    recall: families.endToEnd.recall,
    falsePositiveRate: families.endToEnd.falsePositiveRate,
    errorRatePopulation: "eligible-decision-population",
    errorRate,
    conditional: {
      role: "diagnostic",
      family: "conditional-on-scored",
      selectiveFailureSensitive: true,
      recall: families.conditionalOnScored.recall,
      falsePositiveRate: families.conditionalOnScored.falsePositiveRate,
      errorRatePopulation: "eligible-decision-population",
      errorRate,
    },
  };
}

// Highest TPR whose empirical FPR stays at or below the target, with the score at
// which it happens. Diagnostic: the threshold here is chosen POST HOC on this very
// sample, which is exactly why it can never be a release number (A7 makes the same
// point about the fit-time search).
function tprAtTargetFpr(
  items: readonly ScoredEvaluationItem[],
  targetFpr: number,
): TprAtFixedFpr {
  let positives = 0;
  let negatives = 0;
  for (const item of items) {
    if (isWarningPositive(item.record)) positives += 1;
    else negatives += 1;
  }
  if (positives === 0 || negatives === 0) {
    return {
      targetFpr,
      achievedFpr: Number.NaN,
      tpr: Number.NaN,
      threshold: Number.NaN,
      sampleSize: items.length,
    };
  }
  const sorted = [...items].sort((a, b) => b.documentScore - a.documentScore);
  let truePositives = 0;
  let falsePositives = 0;
  let best = { achievedFpr: 0, tpr: 0, threshold: Number.POSITIVE_INFINITY };
  for (let i = 0; i < sorted.length;) {
    const currentScore = sorted[i].documentScore;
    while (i < sorted.length && sorted[i].documentScore === currentScore) {
      if (isWarningPositive(sorted[i].record)) truePositives += 1;
      else falsePositives += 1;
      i += 1;
    }
    const fpr = falsePositives / negatives;
    const tpr = truePositives / positives;
    if (fpr <= targetFpr && tpr >= best.tpr) {
      best = { achievedFpr: fpr, tpr, threshold: currentScore };
    }
  }
  return { targetFpr, ...best, sampleSize: items.length };
}

function calibrationDiagnostics(
  // The whole binary population, not the eligible set: `scoredBinary` is the part
  // of THIS that produced a score, so the companion rate and the slices decompose
  // the same denominator the statistics used.
  binaryPopulation: readonly EvaluationItem[],
  scoredBinary: readonly ScoredEvaluationItem[],
  seed: number,
  bonferroni: MultiplicityDeclaration | null,
  errorRate: MetricEstimate,
): CalibrationDiagnostics {
  const points = scoredBinary.map(toCalibrationPoint);
  const fit = calibrationInterceptSlope(points);
  return {
    role: "diagnostic",
    gatedStatistic: "eceEqualMass15",
    population: "conditional-on-scored",
    scored: scoredBinary.length,
    populationSize: binaryPopulation.length,
    errorRatePopulation: "binary-population",
    errorRate,
    brier: continuousEstimate(scoredBinary, sampleBrier, seed, bonferroni),
    logLoss: logLoss(points),
    intercept: fit.intercept,
    slope: fit.slope,
    bins: ECE_BINS,
    eceEqualMass15: continuousEstimate(
      scoredBinary,
      sampleEceEqualMass,
      seed,
      bonferroni,
    ),
    reliability: reliabilityDiagram(points, ECE_BINS),
    byLengthBucket: calibrationSlices(binaryPopulation, (record) =>
      sizeBucket(record.wordCount),
    ),
    bySource: calibrationSlices(
      binaryPopulation,
      (record) => record.provenance.sourceId,
    ),
    byLinguisticStratum: calibrationSlices(
      binaryPopulation,
      (record) => record.humanSourceType ?? "unknown",
    ),
  };
}

// Calibration by slice, over the same binary population as the aggregate block.
// Both denominators are published: the statistics run over the SCORED rows of the
// slice, `errorRate` runs over the whole slice, and the gap between them is how a
// slice that looks well calibrated because its hard rows failed becomes visible.
function calibrationSlices(
  binaryPopulation: readonly EvaluationItem[],
  keyOf: (record: BenchmarkRecord) => string,
): CalibrationSliceMetrics[] {
  const buckets = new Map<string, EvaluationItem[]>();
  for (const item of binaryPopulation) {
    const key = keyOf(item.record);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [item]);
    else bucket.push(item);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, bucket]) => {
      const scored = bucket.filter(isScoredItem);
      const points = scored.map(toCalibrationPoint);
      return {
        key,
        count: scored.length,
        populationSize: bucket.length,
        samplingUnits: samplingUnits(scored),
        samplingUnitAxis: "groups.author",
        brier: brierScore(points),
        logLoss: logLoss(points),
        eceEqualMass: eceEqualMass(points, ECE_BINS),
        errorRate: proportionEstimate(
          bucket.filter((item) => item.status === "error").length,
          bucket.length,
        ),
      };
    });
}

// `labelBasis` reaches the closed schema only in C1; today it is read off the
// record when a producer already wrote it and is NEVER invented. A row without a
// readable basis lands in `unknown`, which is not evidence about either basis.
function labelBasisOf(record: BenchmarkRecord): LabelBasisKey {
  if (record.label !== REBUILD_V3_POLICY.labelBasis.appliesToLabel) {
    return "unknown";
  }
  const raw = (record as { labelBasis?: unknown }).labelBasis;
  if (
    typeof raw === "string" &&
    (REBUILD_V3_POLICY.labelBasis.allowed as readonly string[]).includes(raw)
  ) {
    return raw as LabelBasisKey;
  }
  return "unknown";
}

function labelBasisBreakdown(
  eligible: readonly EvaluationItem[],
  bonferroni: MultiplicityDeclaration | null,
): LabelBasisBreakdown {
  const negatives = eligible.filter((item) => isHumanNegative(item.record));
  const buckets = new Map<LabelBasisKey, EvaluationItem[]>();
  for (const item of negatives) {
    const basis = labelBasisOf(item.record);
    const bucket = buckets.get(basis);
    if (bucket === undefined) buckets.set(basis, [item]);
    else bucket.push(item);
  }
  const bases = [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([basis, bucket]) => {
      const scored = bucket.filter(isScoredItem);
      const falsePositives = scored.filter((item) => item.warned).length;
      const points = scored.map(toCalibrationPoint);
      // A basis is powered when it clears the pre-registered §6.4 FPR floor of
      // human negatives. The SAMPLING-UNIT count is published but is not a pass
      // criterion: no floor for it has been pre-registered, and inventing one
      // here would be inventing evidence.
      const powered =
        basis !== "unknown" && bucket.length >= LABEL_BASIS_POWER_FLOOR;
      return {
        basis,
        count: bucket.length,
        scored: scored.length,
        errored: bucket.filter((item) => item.status === "error").length,
        samplingUnits: samplingUnits(bucket),
        samplingUnitAxis: "groups.author" as const,
        powered,
        powerFloor: LABEL_BASIS_POWER_FLOOR,
        evidenceRole: powered
          ? ("gating" as const)
          : REBUILD_V3_POLICY.labelBasis.underPoweredRole,
        falsePositiveRate: proportionEstimate(
          falsePositives,
          scored.length,
          bonferroni,
        ),
        errorRate: proportionEstimate(
          bucket.filter((item) => item.status === "error").length,
          bucket.length,
          bonferroni,
        ),
        brier: brierScore(points),
        logLoss: logLoss(points),
        eceEqualMass: eceEqualMass(points, ECE_BINS),
      };
    });
  return {
    role: "human-negative-label-evidence",
    fieldPresent: bases.some((slice) => slice.basis !== "unknown"),
    pooledClaimAllowed: REBUILD_V3_POLICY.labelBasis.pooledClaimAllowed,
    bases,
  };
}

function predictiveValueProjection(
  warning: DecisionFamilies,
): PredictiveValueProjection {
  const endToEnd = warning.endToEnd;
  const total = endToEnd.positives + endToEnd.negatives;
  return {
    role: "release-context",
    family: "end-to-end",
    benchmarkPrevalence: total === 0 ? Number.NaN : endToEnd.positives / total,
    byPrevalence: POLICY_PREVALENCES.map((prevalence) => ({
      prevalence,
      ...predictiveValues({
        truePositiveRate: endToEnd.recall.value,
        falsePositiveRate: endToEnd.falsePositiveRate.value,
        prevalence,
      }),
    })),
  };
}

function samplingUnits(items: readonly EvaluationItem[]): number {
  const units = new Set<string>();
  for (const item of items) units.add(item.record.groups.author);
  return units.size;
}

// Bonferroni: alpha_família / m, with the family alpha and the descriptive
// confidence read from the frozen contract. `m` is the caller's declaration of the
// pre-registered mandatory statistical gate count; it is never derived from the
// data, because a divisor that shrinks when a cell loses power is not a correction.
function multiplicityFrom(
  preRegisteredStatisticalGates: number | undefined,
): MultiplicityDeclaration | null {
  if (preRegisteredStatisticalGates === undefined) return null;
  if (
    !Number.isInteger(preRegisteredStatisticalGates) ||
    preRegisteredStatisticalGates < 1
  ) {
    throw new RangeError(
      "preRegisteredStatisticalGates must be a positive integer count of gates",
    );
  }
  const familyAlpha = REBUILD_V3_POLICY.multiplicity.familyAlpha;
  const perGateAlpha = familyAlpha / preRegisteredStatisticalGates;
  return {
    correction: "bonferroni",
    familyAlpha,
    descriptiveConfidence: REBUILD_V3_POLICY.multiplicity.descriptiveConfidence,
    m: preRegisteredStatisticalGates,
    perGateAlpha,
    z: oneSidedZ(perGateAlpha),
  };
}

// The mandatory pair for one decision (warning or visual action) over one
// already-eligible population. A6 adds new estimands by extending
// DecisionMetrics and reusing this helper, so every new number arrives in both
// families at once instead of as a single unqualified figure.
function decisionFamilies(
  eligible: readonly EvaluationItem[],
  decide: (item: ScoredEvaluationItem) => boolean,
  bonferroni: MultiplicityDeclaration | null,
  // Which target's positives this matrix counts. Explicit at every call site
  // because it is the difference between a rate that may authorize an action and
  // one that may not (B2).
  positivePopulation: PositivePopulation = "warning-positives",
): DecisionFamilies {
  return {
    endToEnd: decisionMetrics(
      eligible,
      decide,
      "end-to-end",
      bonferroni,
      positivePopulation,
    ),
    conditionalOnScored: decisionMetrics(
      eligible.filter(isScoredItem),
      decide,
      "conditional-on-scored",
      bonferroni,
      positivePopulation,
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
  bonferroni: MultiplicityDeclaration | null = null,
  positivePopulation: PositivePopulation = "warning-positives",
): DecisionMetrics {
  const isPositive =
    positivePopulation === "integral-positives"
      ? isIntegralPositive
      : isWarningPositive;
  let positives = 0;
  let negatives = 0;
  let truePositives = 0;
  let falseNegatives = 0;
  let falsePositives = 0;
  let trueNegatives = 0;
  let undecidedPositives = 0;
  let undecidedNegatives = 0;

  for (const item of population) {
    const positive = isPositive(item.record);
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
    positivePopulation,
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
      bonferroni,
    ),
    clearanceRate: proportionEstimate(trueNegatives, negatives, bonferroni),
    recall: proportionEstimate(truePositives, positives, bonferroni),
    precision: proportionEstimate(
      truePositives,
      truePositives + falsePositives,
      bonferroni,
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
  bonferroni: MultiplicityDeclaration | null,
): ResolutionBreakdown {
  const breakdown = {} as ResolutionBreakdown;
  for (const [axis, keyOf] of RESOLUTION_AXES) {
    breakdown[axis] = resolutionSlices(eligible, keyOf, bonferroni);
  }
  return breakdown;
}

function resolutionSlices(
  eligible: readonly EvaluationItem[],
  keyOf: (record: BenchmarkRecord) => string,
  bonferroni: MultiplicityDeclaration | null,
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
        coverage: proportionEstimate(scored, bucket.length, bonferroni),
        abstentionRate: proportionEstimate(
          abstained,
          bucket.length,
          bonferroni,
        ),
        errorRate: proportionEstimate(errored, bucket.length, bonferroni),
      };
    });
}

// Wilson one-sided lower and upper bounds on a proportion. A zero-denominator
// proportion is undefined, reported as a NaN point rather than a false 0.
function proportionEstimate(
  successes: number,
  total: number,
  bonferroni: MultiplicityDeclaration | null = null,
): MetricEstimate {
  if (total === 0) return { value: Number.NaN, method: "point" };
  const estimate: MetricEstimate = {
    value: successes / total,
    lower95: wilsonOneSided(successes, total, "lower").value,
    upper95: wilsonOneSided(successes, total, "upper").value,
    method: "wilson-one-sided",
  };
  if (bonferroni !== null) {
    const alpha = bonferroni.perGateAlpha;
    estimate.simultaneous = {
      correction: "bonferroni",
      familyAlpha: bonferroni.familyAlpha,
      m: bonferroni.m,
      alpha,
      z: bonferroni.z,
      lower: wilsonOneSidedAtAlpha(successes, total, "lower", alpha).value,
      upper: wilsonOneSidedAtAlpha(successes, total, "upper", alpha).value,
      method: "wilson-one-sided",
    };
  }
  return estimate;
}

// A continuous metric with a 2000-replicate author-clustered bootstrap
// interval. When the statistic is undefined (a single class) or the bootstrap
// cannot muster enough finite replicates, it degrades to a bare point estimate
// rather than fabricating an interval or throwing.
function continuousEstimate(
  items: readonly ScoredEvaluationItem[],
  statistic: (sample: readonly ScoredEvaluationItem[]) => number,
  seed: number,
  bonferroni: MultiplicityDeclaration | null = null,
): MetricEstimate {
  const value = statistic(items);
  if (!Number.isFinite(value)) return { value, method: "point" };
  try {
    const interval = clusterBootstrap(items, {
      clusterBy: (item) => item.record.groups.author,
      iterations: BOOTSTRAP_ITERATIONS,
      seed,
      statistic,
      ...(bonferroni === null
        ? {}
        : { simultaneousAlpha: bonferroni.perGateAlpha }),
    });
    const estimate: MetricEstimate = {
      value,
      lower95: interval.lower95,
      upper95: interval.upper95,
      method: "author-cluster-percentile",
    };
    if (bonferroni !== null && interval.simultaneous !== undefined) {
      estimate.simultaneous = {
        correction: "bonferroni",
        familyAlpha: bonferroni.familyAlpha,
        m: bonferroni.m,
        alpha: interval.simultaneous.alpha,
        // The effort travels with the bound; the gate reads it.
        replicates: interval.simultaneous.replicates,
        tailReplicates: interval.simultaneous.tailReplicates,
        lower: interval.simultaneous.lower,
        upper: interval.simultaneous.upper,
        method: "author-cluster-percentile",
      };
    }
    return estimate;
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

function sampleEceEqualMass(items: readonly ScoredEvaluationItem[]): number {
  return eceEqualMass(items.map(toCalibrationPoint), ECE_BINS);
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

// --- span localization, diagnostic only (B2) --------------------------------

// Merges a list of half-open intervals into a disjoint, ascending list, so a
// caller that lists the same stretch twice cannot inflate a length. Malformed and
// empty intervals (`end <= start`) are dropped rather than clamped: an empty span
// carries no evidence in either direction.
function mergeSpans(spans: readonly SpanInterval[]): SpanInterval[] {
  const sorted = spans
    .filter((span) => Number.isFinite(span.start) && Number.isFinite(span.end))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  const merged: SpanInterval[] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last !== undefined && span.start <= last.end) {
      last.end = Math.max(last.end, span.end);
    } else merged.push({ start: span.start, end: span.end });
  }
  return merged;
}

function totalLength(spans: readonly SpanInterval[]): number {
  return spans.reduce((total, span) => total + (span.end - span.start), 0);
}

function intersectionLength(
  left: readonly SpanInterval[],
  right: readonly SpanInterval[],
): number {
  let total = 0;
  for (const a of left) {
    for (const b of right) {
      const start = Math.max(a.start, b.start);
      const end = Math.min(a.end, b.end);
      if (end > start) total += end - start;
    }
  }
  return total;
}

/**
 * Span agreement between the OBSERVED AI spans of a record and what the localized
 * path emitted for it, counted in character offsets (see {@link SpanOverlap} for
 * why the unit is declared rather than called "token").
 *
 * A ratio with an empty denominator is 0, not NaN, and the reason is a policy one:
 * this is a recall-style diagnostic where "predicted nothing" must read as a total
 * miss, and a NaN would silently drop the row out of every average it enters.
 */
export function spanOverlap(
  observedSpans: readonly SpanInterval[],
  predictedSpans: readonly SpanInterval[],
): SpanOverlap {
  const observedMerged = mergeSpans(observedSpans);
  const predictedMerged = mergeSpans(predictedSpans);
  const observed = totalLength(observedMerged);
  const predicted = totalLength(predictedMerged);
  const intersection = intersectionLength(observedMerged, predictedMerged);
  const union = observed + predicted - intersection;
  const tokenPrecision = ratio(intersection, predicted);
  const tokenRecall = ratio(intersection, observed);
  return {
    observed,
    predicted,
    intersection,
    union,
    iou: ratio(intersection, union),
    tokenPrecision,
    tokenRecall,
    tokenF1:
      tokenPrecision + tokenRecall === 0
        ? 0
        : (2 * tokenPrecision * tokenRecall) / (tokenPrecision + tokenRecall),
  };
}

// Localization per cohort. Nothing here gates: the frozen table makes span IoU,
// token precision/recall and localized-path recall diagnostics of this version,
// and a span explains or locates a warning without ever authorizing a visual
// action on its own.
function localizationDiagnostics(
  items: readonly EvaluationItem[],
): LocalizationDiagnostics {
  return {
    role: "diagnostic",
    gates: false,
    authorizesVisualAction:
      REBUILD_V3_POLICY.localization.authorizesVisualAction,
    unit: "character-offset",
    byGenerationMode: sortedGenerationModes().map((mode) =>
      localizationCohort(items, mode),
    ),
  };
}

function sortedGenerationModes(): GenerationMode[] {
  return [...GENERATION_MODES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function localizationCohort(
  items: readonly EvaluationItem[],
  generationMode: GenerationMode,
): LocalizationCohort {
  // The denominator: scored rows of this cohort that HAVE an observed AI span.
  // A row whose localized path emitted nothing stays in, because dropping it
  // would turn silence into an absence of evidence rather than a miss.
  const population = items.filter(
    (item): item is ScoredEvaluationItem =>
      isScoredItem(item) &&
      generationModeOf(item.record) === generationMode &&
      observedAiSpans(item.record).length > 0,
  );
  let intersection = 0;
  let union = 0;
  let observed = 0;
  let predicted = 0;
  let iouSum = 0;
  let precisionSum = 0;
  let recallSum = 0;
  let localizedEmitted = 0;
  for (const item of population) {
    const overlap = spanOverlap(
      observedAiSpans(item.record),
      item.localizedSpans ?? [],
    );
    intersection += overlap.intersection;
    union += overlap.union;
    observed += overlap.observed;
    predicted += overlap.predicted;
    iouSum += overlap.iou;
    precisionSum += overlap.tokenPrecision;
    recallSum += overlap.tokenRecall;
    if (overlap.predicted > 0) localizedEmitted += 1;
  }
  const count = population.length;
  return {
    generationMode,
    role: "diagnostic",
    aggregated: false,
    population: count,
    localizedEmitted,
    localizedPathRecall: proportionEstimate(localizedEmitted, count),
    microIou: ratio(intersection, union),
    microTokenPrecision: ratio(intersection, predicted),
    microTokenRecall: ratio(intersection, observed),
    macroIou: ratio(iouSum, count),
    macroTokenPrecision: ratio(precisionSum, count),
    macroTokenRecall: ratio(recallSum, count),
  };
}

function observedAiSpans(record: BenchmarkRecord): SpanInterval[] {
  return (record.mixture?.spans ?? [])
    .filter((span) => span.origin === "ai")
    .map((span) => ({ start: span.start, end: span.end }));
}

// END-TO-END by construction, in the status sense (see MetricFamily): the
// denominator is every >=50% AI mixed record, ELIGIBLE OR NOT, and an undecided
// one counts as a miss, so an inference failure can never raise this recall.
// The population is deliberately not eligibility-filtered — the R3 reason is
// written above the `mixed:` block in `computeEvaluationMetrics`; do not add an
// `isEligible` filter here without reading it.
// ONE cohort at a time: the caller names the generation mode, and the frozen gate
// asks for `mechanistic`. Pooling the cohorts here would report a coauthorship
// distribution we manufactured as if it had been observed
// (`materialAssistance.cohortsAggregated: false`).
function mixedAtLeastHalfAi(
  items: readonly EvaluationItem[],
  generationMode: GenerationMode,
): MixedRecallBlock {
  const strong = items.filter(
    (item) =>
      generationModeOf(item.record) === generationMode &&
      (item.record.mixture?.aiFraction ?? 0) >= MATERIAL_ASSISTANCE_AI_FRACTION,
  );
  const warned = strong.filter(
    (item) => isScoredItem(item) && item.warned,
  ).length;
  if (strong.length === 0) {
    return {
      generationMode,
      sampleSize: 0,
      warningRecall: 0,
      warningRecallLower95: 0,
    };
  }
  return {
    generationMode,
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
  bonferroni: MultiplicityDeclaration | null,
): MixedFractionSegment[] {
  // Keyed by COHORT AND fraction. A key of just the fraction would put a
  // mechanistic and an ecological row of the same band into one segment, which is
  // the aggregation the frozen table forbids — and it would do it silently,
  // because the segment would still look like a well-formed diagnostic row.
  const buckets = new Map<
    string,
    { mode: GenerationMode; fractionBucket: string; items: EvaluationItem[] }
  >();
  for (const item of items) {
    const mode = generationModeOf(item.record);
    if (mode === undefined) continue;
    const fractionBucket = mixedFractionBucket(
      item.record.mixture?.aiFraction ?? 0,
    );
    const key = `${mode}/${fractionBucket}`;
    const bucket = buckets.get(key);
    if (bucket === undefined) {
      buckets.set(key, { mode, fractionBucket, items: [item] });
    } else bucket.items.push(item);
  }
  return [...buckets.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([key, { mode, fractionBucket, items: bucket }]) => ({
      key,
      generationMode: mode,
      fractionBucket,
      sampleSize: bucket.length,
      // A mixed bucket holds no human negatives, so this matrix is a pure recall
      // block. `family: "end-to-end"` is the STATUS rule (an undecided row is a
      // miss, never a removal), not an eligibility claim: like the aggregate
      // above, the bucket holds every mixed record, eligible or not. MetricFamily
      // documents that distinction.
      warning: decisionMetrics(
        bucket,
        (item) => item.warned,
        "end-to-end",
        bonferroni,
      ),
    }));
}
