// Metrics for the AI-text detector benchmark.
//
// Two contracts live here:
//
//   * The v2 statistical evaluation report (`computeEvaluationMetrics`) is the
//     release-grade contract §6.5 mandates: warning/visual-action confusion
//     matrices, coverage/abstention/error over the eligible set,
//     prevalence-simulated precision, latency/memory and the mixed-text (>=50%
//     AI) warning-recall block. Ground truth is the record label, never a score;
//     human records are the only negatives — mixed text never inflates the human
//     negative count.
//
//     TWO ESTIMATORS, AND WHICH ONE BACKS A NUMBER IS PUBLISHED ON IT (C4). The
//     estimands of the frozen resampling table — the FPR/specificity rates over
//     human text, recall over AI text, and the five continuous
//     ranking/calibration statistics — get a PERCENTILE BOOTSTRAP over the
//     hierarchical or multiway unit that table gives their row, and each estimate
//     carries the unit it was drawn over. Everything else (coverage, abstention,
//     the three error rates, precision, the resolution slices, the localized-path
//     recall, the diagnostic mixed bands) keeps the analytic one-sided WILSON
//     interval and declares no unit, because no row of the frozen table covers
//     those estimands and inventing one would be inventing the contract. Reading
//     which is which is a field read, never an assumption: `MetricEstimate.method`
//     and `MetricEstimate.resampling`.
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

import {
  clusteredPercentileBootstrapAll,
  isResampledPercentileMethod,
  resolveResampling,
  ResamplingUnitError,
  type PublishedBoundProvenance,
  type PublishedSimultaneousProvenance,
  type ResampledPercentileMethod,
  type ResamplingDesign,
  type ResamplingIdentity,
  type ResamplingLevel,
  type ResamplingLevelChain,
  type ResamplingPlan,
  type ResamplingPlanEntry,
  type ResamplingProxy,
  type ResamplingResolution,
  type ResamplingUnitDeclaration,
} from "./bootstrap.ts";
import {
  oneSidedZ,
  wilsonOneSided,
  wilsonOneSidedAtAlpha,
} from "./intervals.ts";
import { PREREGISTRATION_V4 } from "./preregistration-v4.ts";
import type {
  GenerationMode,
  PublishedBoundRule,
  ResamplingClassRow,
  ResamplingLevelRow,
} from "./preregistration-v4.ts";
import {
  ALL_GROUP_AXES,
  groupAxisDeclaredState,
  groupAxisIdentity,
  groupAxisState,
  type BenchmarkRecord,
  type GroupAxis,
} from "./schema.ts";

export interface Prediction {
  // Ground-truth label of the record.
  label: "human" | "ai";
  // Model-predicted probability that the text is AI (0..1).
  score: number;
  latencyMs?: number;
  memoryBytes?: number;
}

/**
 * Which scoring outcome a latency block was measured over. Carried ON the block so
 * a consumer that receives one cannot read a duration without knowing whose it is
 * (R7) — the same reason `DecisionMetrics` carries its own `family`.
 */
export type LatencyPopulation = "scored" | "abstained" | "error";

export interface LatencyMetrics {
  population: LatencyPopulation;
  sampleSize: number;
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  maxMs: number;
}

/**
 * Latency SPLIT BY OUTCOME and never pooled.
 *
 * This is the fourth door of the §3.1 asymmetry A3 closed for the decision
 * families, and the one nothing guarded because latency was never a gate: a failed
 * inference reported `latencyMs: 0`, `0` is finite, the aggregate filtered on
 * finiteness alone, and every failure therefore pulled the PUBLISHED mean, p50 and
 * p95 down. On the run of 2026-07-25 that would be 325 zero-millisecond samples in
 * 5.000 — 6,5% of the denominator, all in the flattering direction.
 *
 * So `scored` is the aggregate a budget is read from, and the other two outcomes
 * get their OWN blocks. There is deliberately no pooled total: how long a document
 * took to fail is a real and useful number, but it is not a scoring cost and
 * summing the two would recreate exactly the defect. Knowing that it aborted is
 * one thing; knowing in how long is another, and it is the one that informs the
 * budget.
 *
 * `null` means the population is EMPTY, which cannot be misread as a latency of
 * zero — the reading a zero-filled block invited.
 */
export interface LatencyByStatus {
  scored: LatencyMetrics | null;
  abstained: LatencyMetrics | null;
  errored: LatencyMetrics | null;
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

/**
 * The legacy row type REQUIRES a score, so it cannot represent an abstention or a
 * failure at all: every `Prediction` is a scored row by construction, and the block
 * declares that population rather than leaving it to be assumed. A caller that has
 * unscored rows to report belongs on `EvaluationItem`, whose union keeps them apart
 * — substituting a score to fit them in here is the defect A3 removed.
 */
function latencyMetrics(
  predictions: readonly Prediction[],
): LatencyMetrics | undefined {
  return (
    latencyOf(
      predictions.map((prediction) => prediction.latencyMs),
      "scored",
    ) ?? undefined
  );
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

// A point estimate with an optional interval and the method that produced it, so
// a report can prove which estimator backs every number: the analytic one-sided
// Wilson bound, or the percentile bootstrap over the per-estimand
// hierarchical/multiway unit of the frozen table (C4). `resampling` is present on
// the second only, and a consumer that decides something on the bound reads it
// rather than assuming a declared unit was honoured (R7).
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
  method: "point" | "wilson-one-sided" | ResampledPercentileMethod;
  simultaneous?: SimultaneousBound;
  // The resampling unit the interval was drawn over, named (C4). Present only on
  // the percentile paths: an analytic Wilson interval resamples nothing, so
  // attaching a unit to it would claim a property it does not have (R7). Which
  // unit each estimand DECLARES, resampled or not, is in
  // `EvaluationMetrics.resampling`.
  resampling?: ResamplingUnitDeclaration;
  // On a RATE of the frozen table's first two rows, the published bound is chosen
  // between two estimators by the rule the frozen contract names
  // (`resampling.publishedBound`), and this field carries both bounds and which one
  // won — for the individual 95% pair AND for the simultaneous bound, which is the
  // only one a release gate may read. See `rateEnvelope`.
  boundEnvelope?: BoundEnvelope;
}

/** One estimator's limits at one alpha, with the estimator named. */
export interface EnvelopeBound<M extends string> {
  lower: number;
  upper: number;
  method: M;
}

/**
 * Which estimator supplied each published limit. `"resampled"` on a tie: the
 * design was executed and its limit is the one being reported, so a tie is not a
 * case of the analytic bound deciding anything.
 */
export interface EnvelopeSource {
  lowerFrom: "analytic" | "resampled";
  upperFrom: "analytic" | "resampled";
}

export interface EnvelopePair extends EnvelopeSource {
  analytic: EnvelopeBound<"wilson-one-sided">;
  resampled: EnvelopeBound<ResampledPercentileMethod>;
}

export interface BoundEnvelope extends EnvelopePair {
  /** The rule, read from the frozen contract and never decided here. */
  rule: PublishedBoundRule;
  /**
   * The SIMULTANEOUS (Bonferroni) bound's own envelope. Present only when both
   * estimators produced a simultaneous bound — which is the only case in which the
   * published simultaneous limit can differ from the resampled one. Its absence
   * therefore means the published limit came from one estimator alone, and
   * `MetricEstimate.simultaneous.method` names which.
   *
   * It exists because `simultaneous` is the bound a release gate DECIDES on. That
   * bound keeps the percentile method name (the design was executed and its limit
   * is inside the envelope), so without this field a reader could not tell that on
   * a zero-count rate the deciding number is the analytic one. The gate refuses a
   * percentile-named simultaneous bound that carries no resampled pair here
   * (benchmark/gates.ts), so the name is backed by evidence rather than asserted.
   */
  simultaneous?: EnvelopePair;
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
  method: "wilson-one-sided" | ResampledPercentileMethod;
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
  // The resampling unit of THIS slice, resolved over its scored rows: the frozen
  // table says a calibration statistic inherits the unit of the stratum under
  // analysis, so the unit is a property of the slice and not of the module. Null
  // when the slice scored nothing and there was no population to resolve.
  resamplingUnit: ResamplingUnitDeclaration | null;
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
  // The human-specificity unit of the frozen table, resolved over this basis.
  // Null when the basis has no rows to resolve.
  resamplingUnit: ResamplingUnitDeclaration | null;
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

// The six overlap ratios of one cohort under one status rule. Grouped rather than
// flattened onto the family so ONE null covers all six: when there is no span
// producer at all (see `spanProducer`) none of them is a measurement, and six
// separate nulls would invite a consumer to read five of them and miss one.
export interface LocalizationOverlapRatios {
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

// Whether this RUN has a span producer at all. Producer presence is a property
// of the run, not of a cohort: `localizedSpans` is written — or not — by a
// pipeline stage, so the answer cannot honestly differ between two cohorts of one
// evaluation. Deriving it per cohort was a defect, and the direction was the bad
// one: a cohort whose every row failed inference read `"absent"` and published
// null ratios even though a producer had demonstrably emitted a span one cohort
// over, so 100% inference failure DELETED the number instead of reading 0 (R5),
// and the published reason was false besides (R7). MEASURED on the committed tree
// at f513ac8 with three rows — one scored `mechanistic` row carrying
// `localizedSpans`, two `status: "error"` `ecological` rows with observed spans:
// `{"mode":"ecological","spanProducer":"absent","e2ePopulation":2,
// "e2eUndecided":2,"e2eRecall":null,"e2eOverlapNull":true}`.
//
// Three-valued, because `"absent"` is a claim that needs a witness: it says a row
// that GOT a decision carried no span field. With no scored row anywhere in the
// run there is no such witness, so a third state says that instead of blaming a
// producer that was never given the chance to emit.
//
// - `present` — some scored row of the run carries `localizedSpans`.
//   Present-and-EMPTY counts as present: a producer that ran and found nothing is
//   a real, measured total miss, so its zeros are published rather than nulled.
// - `absent` — the run produced decisions and none of them carries the field.
//   This is today's answer on every real run: `benchmark/prediction-schema.ts`
//   has no span column and `benchmark/commands/evaluate.ts` forwards
//   `localizedRawScore` alone, so NO stage of the sealed pipeline writes it. D4
//   owns the span head that will.
// - `undeterminable` — the run produced no decision at all, so nothing could have
//   carried the field either way.
export type SpanProducerState = "present" | "absent" | "undeterminable";

// One localization family over one cohort. R5 requires the pair, and the reason
// is the same here as for the decision matrices: while this block published only
// the scored rows, an errored row of the cohort left every denominator, so an
// inference failure could only ever RAISE the localized-path recall and the IoUs.
// MEASURED before the fix, on a one-row cohort: adding one `status: "error"` row
// with an observed AI span left `population: 1, localizedPathRecall: 1,
// microIou: 1` byte-identical while `mixed.atLeastHalfAi.sampleSize` in the same
// artifact went 1 -> 2. Two mixed-cohort recall blocks, opposite conventions.
export interface LocalizationFamily {
  family: MetricFamily;
  // The denominator rule in words, because "population" alone does not say which
  // of the two it is and `family` is a status label a consumer may not know how
  // to apply to spans. `end-to-end` counts EVERY row of the cohort that carries
  // an observed AI span, undecided ones included; the conditional family keeps
  // the scored rows only.
  populationRule:
    | "cohort-rows-with-observed-spans"
    | "scored-cohort-rows-with-observed-spans";
  population: number;
  // Rows of `population` that produced no decision, so the two families can be
  // reconciled from the artifact alone (it is 0 in the conditional one by
  // construction). An undecided row emitted nothing and is charged as a MISS —
  // never dropped, never substituted (R5).
  undecidedRows: number;
  localizedEmitted: number;
  // `null`, never 0, when the run has no producer (or cannot be asked) or this
  // family has no row: see `SpanProducerState`. With a producer, a population of
  // undecided rows publishes 0 — that is a measured integral miss, not an absence
  // of measurement.
  localizedPathRecall: MetricEstimate | null;
  overlap: LocalizationOverlapRatios | null;
}

// Localization over one cohort. DIAGNOSTIC in v3: `gates: false` and
// `authorizesVisualAction: false` are literals, matching
// `localization.metricsRole: "diagnostic"` and
// `localization.authorizesVisualAction: false` in the frozen contract.
export interface LocalizationCohort {
  generationMode: GenerationMode;
  role: "diagnostic";
  aggregated: false;
  // The RUN's producer state (see `SpanProducerState`), restated on every cohort
  // beside the ratios it explains. It is identical across the cohorts of one
  // artifact by construction — `localizationDiagnostics` derives it once and hands
  // the same value down — and it is repeated here and not published once at the
  // top because it is the reason a cohort's ratios are `null`, and a reason a
  // reader has to go looking for is a reason a reader will skip. Without it,
  // "the detector located nothing" and "nothing was asked to locate anything"
  // both spell 0 (R7: declare the contract, not the property).
  spanProducer: SpanProducerState;
  endToEnd: LocalizationFamily;
  conditionalOnScored: LocalizationFamily;
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
  // C4's resampling plan: one entry per published estimand, naming the unit it
  // resamples over and whether the published interval was actually produced by
  // resampling it. The release gate reads this and refuses to decide an interval
  // for an estimand the plan does not cover (benchmark/gates.ts); it never
  // substitutes independent rows. It is built from the SAME resolutions the
  // intervals used, so the declared unit cannot drift from the executed one.
  resampling: ResamplingPlan;
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
  // One block per scoring outcome, never pooled: the budget is read off `scored`
  // and the cost of a failure is published beside it, not inside it.
  latency: LatencyByStatus;
  memory: MemoryMetrics;
  // Span IoU, token precision/recall and localized-path recall, per cohort, in
  // both status families, all diagnostic in v3 — and every cohort restates the
  // run's `SpanProducerState`, because today no stage of the sealed pipeline
  // produces a span at all.
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
    // A FOUR-BAND AGGREGATION of the frozen v0-v8 coverage curve, not the curve:
    // `MIXED_FRACTION_BUCKETS` says which levels each band pools and why B2 cannot
    // split them (the level belongs to D4's mixing lane, not to the record).
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
  //
  // NO PRODUCER YET, and the artifact says so rather than implying one: nothing in
  // the sealed pipeline writes this field. `benchmark/prediction-schema.ts` has no
  // span column and `benchmark/commands/evaluate.ts` forwards `localizedRawScore`
  // alone, so on a real run only the unit fixtures populate it and the run
  // publishes `spanProducer: "absent"` with null ratios. Note the asymmetry that
  // makes both readings possible: the RUN decides whether a producer exists (any
  // scored row carrying the field, `SpanProducerState`), while WITHIN a run that
  // has one, a scored row missing the field emitted nothing and is a miss. D4 is the task that adds
  // the span head, and A5's `originalSpanFromNormalized` is what it must translate
  // through — the offsets here are the ORIGINAL text's, like `mixture.spans`.
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
  // Seed for the clustered bootstrap of the continuous metrics.
  bootstrapSeed: number;
  // Replicates for that bootstrap. Defaults to the pre-registered pilot count and
  // is REFUSED below it: the frozen contract sets 10.000 in the pilot and 100.000
  // in the release and says never to reduce the count for run time, so this
  // parameter exists to raise it for the release, never to lower it.
  bootstrapReplicates?: number;
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
// (benchmark/preregistration-v4.json); none of them is a local constant.
const ECE_BINS = PREREGISTRATION_V4.calibrationGate.eceBins;
// The pre-registered pilot replicate count, and the FLOOR: 10.000 in the pilot,
// 100.000 in the release, "nunca reduzir por tempo".
const PILOT_REPLICATES = PREREGISTRATION_V4.bootstrapReplicates.pilot;
const RESAMPLING_TABLE = PREREGISTRATION_V4.resampling;
const DEFAULT_MINIMUM_ELIGIBLE_WORDS =
  PREREGISTRATION_V4.wordFloor.abstainBelow;
const MATERIAL_ASSISTANCE_AI_FRACTION =
  PREREGISTRATION_V4.materialAssistance.minimumAiFraction;
// The ONE cohort the material-assistance target is defined over. `ecological` is
// a separate cohort and is never added to it (`cohortsAggregated: false`).
const MATERIAL_ASSISTANCE_MODE =
  PREREGISTRATION_V4.materialAssistance.generationMode;
const GENERATION_MODES = PREREGISTRATION_V4.materialAssistance.generationModes;
const LABEL_BASIS_POWER_FLOOR =
  PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives;
// The legacy `simulatedPrecision` trio is the first three policy prevalences; the
// `predictiveValue` block publishes all of them, with NPV beside every PPV.
const POLICY_PREVALENCES = PREREGISTRATION_V4.predictiveValuePrevalences;
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

// --- the resampling unit, per estimand (C4) --------------------------------
//
// The unit of resampling is NOT a property of this module: it is a row of the
// frozen table in `benchmark/preregistration-v4.json`, read here and turned into a
// design over evaluation items. Nothing below names an axis as a local constant.
//
// One thing this replaces deserves naming, because it is the defect C4 exists to
// remove: every continuous interval used to be drawn over `groups.author` as a
// single flat key. On a v3 corpus `author` is `notApplicable` on every generated
// row BY RULE, and in the v2 corpus it was 10.000 singletons — so the "clustered"
// bootstrap was an i.i.d. row bootstrap wearing a cluster's name, and every
// interval in the report was too narrow by an unrecoverable amount.

// EVERY axis any record version declares, not one version's tuple. The frozen table
// names `groups.generationBatch` on the AI-recall row, which only v4 has, so a set
// built from the v3 tuple would make `resamplingDesignFor("warning.recall")` throw
// on the shipped policy. What the set still refuses is an axis NO version declares —
// a typo, or a synthetic per-row key, which is the one thing R6 forbids outright.
const AXIS_NAMES: ReadonlySet<string> = new Set(ALL_GROUP_AXES);
const AXIS_PREFIX = "groups.";

// The name an OLDER record version gives the same fact a v4 axis names.
//
// DOMAIN FACT the code cannot show: schema v4 split v3's single `collectionBatch`
// into three axes, and on a GENERATED row that axis already held the generation
// batch (`gb_*`) — exactly what `generationBatch` names now. On a HUMAN row it held
// the extraction run instead, which is a different fact and must not be read as a
// batch, so the alias is restricted to non-human rows. No row of the frozen table
// reads the batch level over a human population, so the restriction costs nothing.
const OLDER_VERSION_AXIS_NAME: ReadonlyMap<GroupAxis, GroupAxis> = new Map([
  ["generationBatch", "collectionBatch"],
]);

/**
 * WHICH key of this record answers for `axis`, or `null` when none does.
 *
 * Version-aware in the same way the audit is: an axis the record's version does not
 * DECLARE has not answered `unknown` — it has not answered at all — so the older
 * spelling of the same fact is consulted before the level is failed. Inside a version
 * that declares the axis, an absent key stays a gap.
 */
function axisKeyOn(record: BenchmarkRecord, axis: GroupAxis): GroupAxis | null {
  if (groupAxisDeclaredState(record, axis) !== undefined) return axis;
  const older = OLDER_VERSION_AXIS_NAME.get(axis);
  if (older === undefined || record.label === "human") return null;
  return groupAxisDeclaredState(record, older) === undefined ? null : older;
}

// Reads one declared axis of one item in its three R6 states. `known` is the only
// state that is an identity two rows can share; `notApplicable` demotes to the
// next unit the source declares and `unknown` fails, and the difference between
// those two is enforced by benchmark/bootstrap.ts, not here.
function axisLevel(declared: string): ResamplingLevel<EvaluationItem> {
  const axis = declared.startsWith(AXIS_PREFIX)
    ? declared.slice(AXIS_PREFIX.length)
    : declared;
  if (!AXIS_NAMES.has(axis)) {
    throw new RangeError(
      `the resampling table names "${declared}", which is not a record grouping axis`,
    );
  }
  const typed = axis as GroupAxis;
  return {
    axis: declared,
    identity: (item): ResamplingIdentity => {
      const key = axisKeyOn(item.record, typed);
      if (key === null) return { state: "unknown" };
      const state = groupAxisState(item.record, key);
      if (state === "unknown") return { state: "unknown" };
      if (state === "notApplicable") return { state: "notApplicable" };
      const id = groupAxisIdentity(item.record, key);
      // An axis that says `known` and yields no identity contradicts itself;
      // treating it as unknown is the fail-closed reading, not a substitution.
      return id === undefined ? { state: "unknown" } : { state: "known", id };
    },
  };
}

function levelChain(
  row: ResamplingLevelRow,
): ResamplingLevelChain<EvaluationItem> {
  const declared = axisLevel(row.axis);
  return {
    declared:
      row.proxyFor === undefined
        ? declared
        : {
            ...declared,
            proxyFor: row.proxyFor,
            ...(row.proxyReason === undefined
              ? {}
              : { proxyReason: row.proxyReason }),
          },
    fallbacks: row.fallbacks.map(axisLevel),
  };
}

/** The substitutions one estimand's declared unit rests on, in level order. */
function proxiesOf(estimand: string): ResamplingProxy[] {
  const row =
    RESAMPLING_TABLE.estimandClasses[RESAMPLING_TABLE.estimands[estimand]];
  if (row === undefined) return [];
  const proxies: ResamplingProxy[] = [];
  for (const level of row.levels) {
    if (level.proxyFor === undefined) continue;
    proxies.push({
      axis: level.axis,
      standsInFor: level.proxyFor,
      reason: level.proxyReason ?? "",
    });
  }
  return proxies;
}

/**
 * The design one CLASS ROW declares, for one estimand name.
 *
 * Separate from {@link resamplingDesignFor} because the two failures are different:
 * an estimand with no row is a gap in the contract, while a row naming something that
 * is not a grouping axis is a malformed row. Only the row is needed to build a design,
 * so the row is the parameter — which also makes the axis-name refusal reachable
 * without a malformed policy on disk.
 */
export function resamplingDesignOf(
  estimand: string,
  declared: ResamplingClassRow,
): ResamplingDesign<EvaluationItem> {
  const chains = declared.levels.map(levelChain);
  return declared.unitKind === "hierarchical"
    ? { method: "hierarchical", estimand, levels: chains }
    : { method: "multiway", estimand, factors: chains };
}

/**
 * The design of one estimand, straight from the frozen table. Throws when no row
 * covers the estimand, because a missing row is a gap in the contract and not a
 * licence to resample rows.
 */
export function resamplingDesignFor(
  estimand: string,
): ResamplingDesign<EvaluationItem> {
  const row = RESAMPLING_TABLE.estimands[estimand];
  if (row === undefined) {
    throw new RangeError(
      `no row of the frozen resampling table covers the estimand "${estimand}"`,
    );
  }
  return resamplingDesignOf(estimand, RESAMPLING_TABLE.estimandClasses[row]);
}

/** The unit of one population under one estimand, or null when it is empty. */
function resamplingUnitOf(
  items: readonly EvaluationItem[],
  estimand: string,
): ResamplingUnitDeclaration | null {
  if (items.length === 0) return null;
  return resolveResampling(items, resamplingDesignFor(estimand)).declaration;
}

// The estimands whose PUBLISHED interval is a percentile bootstrap over the unit
// the frozen table gives them. Every other entry of the plan declares the table's
// unit while its published interval comes from the analytic Wilson estimator, and
// the plan says so per entry (`executed`) instead of letting a reader assume.
const ESTIMAND_CALIBRATION_ECE = "calibration.ece";
const ESTIMAND_CALIBRATION_ECE15 = "calibration.ece15";
const ESTIMAND_CALIBRATION_BRIER = "calibration.brier";
const ESTIMAND_SEPARABILITY_AUROC = "separability.auroc";
const ESTIMAND_SEPARABILITY_PR_AUC = "separability.prAuc";
// The two gated decisions, each with the human-negative row (FPR and its
// specificity companion) and the AI-recall row. Row 1 of the frozen table is named
// "FPR / especificidade em texto humano", so the clearance rate is the same row and
// shares the same resample stream — one draw, two statistics over it.
const ESTIMAND_WARNING_FPR = "warning.fpr";
const ESTIMAND_WARNING_CLEARANCE = "warning.clearanceRate";
const ESTIMAND_WARNING_RECALL = "warning.recall";
const ESTIMAND_ACTION_FPR = "action.fpr";
const ESTIMAND_ACTION_CLEARANCE = "action.clearanceRate";
const ESTIMAND_ACTION_RECALL = "action.recall";
const ESTIMAND_WARNING_FPR_LABEL_BASIS = "warning.fpr.labelBasis";
const ESTIMAND_ACTION_FPR_LABEL_BASIS = "action.fpr.labelBasis";
// Measured but not resampled: the mixed multiway is resolved over the mechanistic
// cohort so its degeneracy is a published number instead of a paragraph, and the
// bound beside `mixed.atLeastHalfAi` stays the analytic one — see the note above
// the resolution in `computeEvaluationMetrics`.
const ESTIMAND_MIXED_WARNING_RECALL = "mixed.warning.recall";
// The slice variants of the two FPR rows. THIS plan never measures them: a slice's
// interval is drawn inside that slice's own `computeEvaluationMetrics` call
// (benchmark/slices.ts), which publishes its own plan, so the aggregate plan says
// where the measurement lives instead of leaving `measured: null` unexplained.
const PER_SLICE_ESTIMANDS: readonly string[] = [
  "warning.fpr.slice",
  "action.fpr.slice",
];

/**
 * The plan as the frozen table declares it, with nothing measured yet: one entry
 * per published estimand, naming the unit and the pre-registered replicate count.
 * Exported because a caller that has no evaluation to measure — a fixture, a
 * pre-flight check — still has to be able to state the unit rather than omit it.
 */
export function declaredResamplingPlan(
  replicates: number = PILOT_REPLICATES,
): ResamplingPlan {
  const entries: ResamplingPlanEntry[] = Object.keys(RESAMPLING_TABLE.estimands)
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((estimand) => {
      const row =
        RESAMPLING_TABLE.estimandClasses[RESAMPLING_TABLE.estimands[estimand]];
      return {
        estimand,
        unitKind: row.unitKind,
        unitAxes: row.levels.map((level) => level.axis),
        replicates,
        executed: "declared-only" as const,
        // Nothing is published yet, so there is no estimator to name. A declared
        // plan that claimed provenance would be claiming a measurement.
        publishedBound: null,
        measured: null,
        measurementNote: PER_SLICE_ESTIMANDS.includes(estimand)
          ? PER_SLICE_NOTE
          : null,
        proxies: proxiesOf(estimand),
      };
    });
  return {
    planId: `c4-resampling-plan/${PREREGISTRATION_V4.policyVersion}`,
    source: "benchmark/preregistration-v4.json#resampling",
    entries,
  };
}

const PER_SLICE_NOTE =
  "medida no plano da própria fatia: buildSlices chama computeEvaluationMetrics " +
  "por fatia e cada uma publica o seu plano; este plano agregado não calcula fatia";

/** What one estimand's resolution produced, or why it produced nothing. */
interface MeasuredUnit {
  readonly unit: ResamplingUnitDeclaration | null;
  readonly resampled: boolean;
  /**
   * Which estimator's limits were published. Stated by each producer rather than
   * derived from `resampled`: a design that ran can still publish the analytic
   * limit under the frozen `resampling.publishedBound` rule.
   */
  readonly bound: PublishedBoundProvenance;
  readonly note: string | null;
}

/**
 * The provenance an estimate's envelope records, in the shape the plan publishes.
 *
 * Exported because the report renders the same fact for the estimates it prints
 * beside their numbers (the label-basis table), and two copies of this derivation
 * drift the day `MetricEstimate.method` gains a name: one rule, one place.
 */
export function boundProvenanceOf(
  estimate: MetricEstimate | undefined,
): PublishedBoundProvenance {
  if (estimate === undefined) return { kind: "no-published-bound" };
  const envelope = estimate.boundEnvelope;
  if (envelope === undefined) {
    // NO LIMIT AT ALL comes before either estimator's name. `proportionEstimate`
    // returns a bare point on a zero denominator, and a bare point carries no
    // interval, so calling it `analytic-only` would credit Wilson with a bound
    // Wilson never produced (R7). Read off the interval and not off `method`: the
    // absence of a limit is the fact that matters, and it is what `method` encodes
    // only by coincidence.
    if (estimate.lower95 === undefined && estimate.upper95 === undefined) {
      return { kind: "no-published-bound" };
    }
    return isResampledPercentileMethod(estimate.method)
      ? { kind: "resampled-only" }
      : { kind: "analytic-only" };
  }
  return {
    kind: "envelope",
    rule: envelope.rule,
    individual: {
      lowerFrom: envelope.lowerFrom,
      upperFrom: envelope.upperFrom,
    },
    simultaneous: simultaneousProvenanceOf(estimate),
  };
}

/**
 * Which estimator stands behind the simultaneous limit, read from BOTH halves: the
 * envelope's simultaneous pair says two estimators competed, and `estimate.
 * simultaneous` says whether any limit was published at that alpha at all. The
 * second read is what separates "one estimator produced it" from "nobody did" —
 * without it the default run of `benchmark/commands/evaluate.ts`, which declares no
 * gate count and therefore no Bonferroni family, would report a single estimator for
 * every estimand and point at a field that is absent.
 */
function simultaneousProvenanceOf(
  estimate: MetricEstimate,
): PublishedSimultaneousProvenance {
  const pair = estimate.boundEnvelope?.simultaneous;
  if (pair !== undefined) {
    return {
      kind: "both-estimators",
      lowerFrom: pair.lowerFrom,
      upperFrom: pair.upperFrom,
    };
  }
  const published = estimate.simultaneous;
  return published === undefined
    ? { kind: "none" }
    : { kind: "single-estimator", method: published.method };
}

/**
 * The plan the release gate reads. `measured` carries the resolutions the run
 * actually performed, so a declared unit cannot drift from an executed one: the
 * same declaration object goes into the interval and into the plan.
 */
function buildResamplingPlan(
  replicates: number,
  measured: ReadonlyMap<string, MeasuredUnit>,
): ResamplingPlan {
  const declared = declaredResamplingPlan(replicates);
  return {
    ...declared,
    entries: declared.entries.map((entry) => {
      const found = measured.get(entry.estimand);
      if (found === undefined) return entry;
      return {
        ...entry,
        executed: found.resampled
          ? ("percentile-bootstrap" as const)
          : ("declared-only" as const),
        publishedBound: found.bound,
        measured: found.unit,
        measurementNote: found.note ?? entry.measurementNote ?? null,
      };
    }),
  };
}

// --- weighted statistics over cluster weights ------------------------------
//
// A replicate is a WEIGHT VECTOR over leaf clusters, never a copy of the rows, so
// every resampled statistic has to be expressible over those weights. Each
// builder below aggregates the sufficient statistics ONCE and returns a closure
// that reads the weight vector; at unit weights every one of them reproduces the
// unweighted function it mirrors, which is asserted by test.

type WeightedStatistic = (weights: readonly number[]) => number;

interface BinaryPoints {
  probability: Float64Array;
  label: Float64Array;
  cluster: readonly number[];
  /** Indices ordered by probability ascending (stable), for equal-mass bins. */
  byProbability: readonly number[];
  /** Indices ordered by score descending (stable), for the ROC/PR walks. */
  byScoreDescending: readonly number[];
  /** Document score, i.e. the ranking key. */
  score: Float64Array;
}

function binaryPoints(
  items: readonly ScoredEvaluationItem[],
  cluster: readonly number[],
): BinaryPoints {
  const size = items.length;
  const probability = new Float64Array(size);
  const label = new Float64Array(size);
  const score = new Float64Array(size);
  for (let index = 0; index < size; index += 1) {
    const point = toCalibrationPoint(items[index]);
    probability[index] = point.probability;
    label[index] = point.label;
    score[index] = items[index].documentScore;
  }
  const indices = [...items.keys()];
  const byProbability = [...indices].sort((a, b) =>
    probability[a] !== probability[b] ? probability[a] - probability[b] : a - b,
  );
  const byScoreDescending = [...indices].sort((a, b) =>
    score[a] !== score[b] ? score[b] - score[a] : a - b,
  );
  return {
    probability,
    label,
    cluster,
    byProbability,
    byScoreDescending,
    score,
  };
}

function weightedBrier(
  points: BinaryPoints,
  clusters: number,
): WeightedStatistic {
  const squaredError = new Float64Array(clusters);
  const counts = new Float64Array(clusters);
  for (let index = 0; index < points.probability.length; index += 1) {
    const error = points.probability[index] - points.label[index];
    squaredError[points.cluster[index]] += error * error;
    counts[points.cluster[index]] += 1;
  }
  return (weights) => {
    let total = 0;
    let mass = 0;
    for (let cluster = 0; cluster < clusters; cluster += 1) {
      const weight = weights[cluster];
      if (weight === 0) continue;
      total += weight * squaredError[cluster];
      mass += weight * counts[cluster];
    }
    return mass === 0 ? Number.NaN : total / mass;
  };
}

// Equal-WIDTH ECE over fifteen bins, weighted. Mirrors `ece15`: the bin is chosen
// from the clamped probability and the bin mean is taken over the raw one.
function weightedEce15(points: BinaryPoints): WeightedStatistic {
  const size = points.probability.length;
  const bin = new Int32Array(size);
  for (let index = 0; index < size; index += 1) {
    const clamped = Math.min(1, Math.max(0, points.probability[index]));
    bin[index] = Math.min(ECE_BINS - 1, Math.floor(clamped * ECE_BINS));
  }
  const mass = new Float64Array(ECE_BINS);
  const probabilitySum = new Float64Array(ECE_BINS);
  const positiveSum = new Float64Array(ECE_BINS);
  return (weights) => {
    mass.fill(0);
    probabilitySum.fill(0);
    positiveSum.fill(0);
    let total = 0;
    for (let index = 0; index < size; index += 1) {
      const weight = weights[points.cluster[index]];
      if (weight === 0) continue;
      const slot = bin[index];
      mass[slot] += weight;
      probabilitySum[slot] += weight * points.probability[index];
      positiveSum[slot] += weight * points.label[index];
      total += weight;
    }
    if (total === 0) return Number.NaN;
    let ece = 0;
    for (let slot = 0; slot < ECE_BINS; slot += 1) {
      const inBin = mass[slot];
      if (inBin === 0) continue;
      ece +=
        (inBin / total) *
        Math.abs(probabilitySum[slot] / inBin - positiveSum[slot] / inBin);
    }
    return ece;
  };
}

// Equal-MASS ECE, weighted. The weighted sample is the multiset in which each
// point appears `weight` times, and the bin boundaries are the same
// `floor(bin * n / count)` cut points `equalMassBins` uses — with `n` the TOTAL
// WEIGHT. A point whose weight straddles a boundary is split across the two bins,
// which is exactly what expanding the multiset would do.
function weightedEceEqualMass(points: BinaryPoints): WeightedStatistic {
  const order = points.byProbability;
  return (weights) => {
    let totalWeight = 0;
    for (const index of order) totalWeight += weights[points.cluster[index]];
    if (!(totalWeight > 0)) return Number.NaN;
    const bins = Math.min(ECE_BINS, Math.floor(totalWeight));
    if (bins < 1) return Number.NaN;

    let ece = 0;
    let consumed = 0;
    let bin = 0;
    let binEnd = Math.floor(totalWeight / bins);
    let mass = 0;
    let probabilitySum = 0;
    let positiveSum = 0;
    const closeBin = (): void => {
      if (mass > 0) {
        ece +=
          (mass / totalWeight) *
          Math.abs(probabilitySum / mass - positiveSum / mass);
      }
      mass = 0;
      probabilitySum = 0;
      positiveSum = 0;
    };

    for (const index of order) {
      let remaining = weights[points.cluster[index]];
      if (remaining <= 0) continue;
      const probability = points.probability[index];
      const label = points.label[index];
      while (remaining > 0) {
        while (consumed >= binEnd && bin < bins - 1) {
          closeBin();
          bin += 1;
          binEnd = Math.floor(((bin + 1) * totalWeight) / bins);
        }
        const take = Math.min(remaining, binEnd - consumed);
        // The last bin ends at the total weight, so `take` is only ever zero if
        // the accumulated weight overshot it, which cannot happen.
        const step = take > 0 ? take : remaining;
        mass += step;
        probabilitySum += step * probability;
        positiveSum += step * label;
        consumed += step;
        remaining -= step;
      }
    }
    closeBin();
    return ece;
  };
}

// AUROC over the weighted multiset. Mirrors `rocAucFromItems`: the same
// tie-grouped trapezoid, with `+= 1` replaced by `+= weight`.
function weightedAuroc(points: BinaryPoints): WeightedStatistic {
  const order = points.byScoreDescending;
  return (weights) => {
    let positives = 0;
    let negatives = 0;
    for (const index of order) {
      const weight = weights[points.cluster[index]];
      if (points.label[index] === 1) positives += weight;
      else negatives += weight;
    }
    if (positives === 0 || negatives === 0) return Number.NaN;
    let truePositives = 0;
    let falsePositives = 0;
    let previousFpr = 0;
    let previousTpr = 0;
    let area = 0;
    for (let cursor = 0; cursor < order.length;) {
      const score = points.score[order[cursor]];
      while (cursor < order.length && points.score[order[cursor]] === score) {
        const index = order[cursor];
        const weight = weights[points.cluster[index]];
        if (points.label[index] === 1) truePositives += weight;
        else falsePositives += weight;
        cursor += 1;
      }
      const tpr = truePositives / positives;
      const fpr = falsePositives / negatives;
      area += ((fpr - previousFpr) * (tpr + previousTpr)) / 2;
      previousFpr = fpr;
      previousTpr = tpr;
    }
    return area;
  };
}

// Average precision over the weighted multiset. Mirrors `prAucFromItems`.
function weightedPrAuc(points: BinaryPoints): WeightedStatistic {
  const order = points.byScoreDescending;
  return (weights) => {
    let positives = 0;
    let total = 0;
    for (const index of order) {
      const weight = weights[points.cluster[index]];
      total += weight;
      if (points.label[index] === 1) positives += weight;
    }
    if (positives === 0 || positives === total) return Number.NaN;
    let truePositives = 0;
    let falsePositives = 0;
    let previousRecall = 0;
    let averagePrecision = 0;
    for (let cursor = 0; cursor < order.length;) {
      const score = points.score[order[cursor]];
      while (cursor < order.length && points.score[order[cursor]] === score) {
        const index = order[cursor];
        const weight = weights[points.cluster[index]];
        if (points.label[index] === 1) truePositives += weight;
        else falsePositives += weight;
        cursor += 1;
      }
      const recall = truePositives / positives;
      const precision = ratio(truePositives, truePositives + falsePositives);
      averagePrecision += (recall - previousRecall) * precision;
      previousRecall = recall;
    }
    return averagePrecision;
  };
}

// --- rates over a clustered design -----------------------------------------
//
// A RATE is the one shape the frozen table's first two rows are about, and it is
// the shape that used to escape resampling entirely: FPR, specificity and recall
// were analytic Wilson bounds, which treat every record-line as independent no
// matter what unit the plan declared beside them. Written over cluster weights a
// rate is a ratio of two weighted sums, so it costs one pass over the clusters per
// replicate and never touches a record-line.
//
// The two counters are aggregated ONCE per cluster before the first draw:
// `numerator[c]` is how many rows of cluster `c` are in the numerator and
// `denominator[c]` how many are in the denominator. FPR and specificity have
// DIFFERENT denominators over the same population — FP+TN counts the decided
// negatives, TN/negatives counts all of them — which is why the denominator is
// per statistic and not shared.
function weightedRate(
  numerator: Float64Array,
  denominator: Float64Array,
): WeightedStatistic {
  const clusters = numerator.length;
  return (weights) => {
    let top = 0;
    let bottom = 0;
    for (let cluster = 0; cluster < clusters; cluster += 1) {
      const weight = weights[cluster];
      if (weight === 0) continue;
      top += weight * numerator[cluster];
      bottom += weight * denominator[cluster];
    }
    // A replicate that drew no denominator says nothing about the rate; it is
    // discarded as non-finite rather than counted as zero (R5's rule, one level
    // down: an undefined statistic is never substituted).
    return bottom === 0 ? Number.NaN : top / bottom;
  };
}

/**
 * One rate to resample: its estimand, the point value from the row-wise counts,
 * and the two PER-ROW indicators the sufficient statistics are aggregated from.
 * They are per row here and per cluster in `weightedRate`, and the aggregation
 * happens once, before the first draw.
 */
interface RateStatistic {
  readonly estimand: string;
  /** 1 for a row in the numerator, 0 otherwise, in the order the rows were given. */
  readonly numerator: readonly number[];
  /** 1 for a row in the denominator, 0 otherwise, in the same order. */
  readonly denominator: readonly number[];
  /** The analytic estimate, which is also the point value and the other half of
   *  the published envelope (`rateEnvelope`). */
  readonly analytic: MetricEstimate;
}

/**
 * The seed and the effort one population's rates are resampled with, plus where
 * the measured unit is recorded. Absent means "publish the analytic bound and
 * declare no unit", which is what the diagnostic blocks do: no row of the frozen
 * table covers a band of the mixed curve, and inventing one to have an interval
 * would be inventing the contract.
 */
interface RateResampling {
  readonly seed: number;
  readonly replicates: number;
  readonly bonferroni: MultiplicityDeclaration | null;
  /** The human-negative row: the FPR estimand and its specificity companion. */
  readonly humanEstimands: { fpr: string; clearance: string } | null;
  /** The AI-recall row. */
  readonly recallEstimand: string | null;
  /**
   * Where a measured unit goes. Called only for the family a release gate reads,
   * so the plan carries the unit of the interval the verdict came from and not the
   * one of its diagnostic mirror over a narrower population.
   */
  readonly record: ((estimand: string, measured: MeasuredUnit) => void) | null;
}

/**
 * The rates of one population, drawn over the unit each estimand declares. Every
 * statistic gets an entry, resampled or degraded, and the caller decides which it
 * may publish (`usableRateInterval`).
 */
function resampledRates(
  resolution: ResamplingResolution,
  statistics: readonly RateStatistic[],
  resampling: RateResampling,
): Map<string, MetricEstimate> {
  const clusters = resolution.clusterCount;
  return resampledEstimates({
    resolution,
    statistics: statistics.map((entry) => ({
      estimand: entry.estimand,
      value: entry.analytic.value,
      weighted: weightedRate(
        perCluster(entry.numerator, resolution.clusterOf, clusters),
        perCluster(entry.denominator, resolution.clusterOf, clusters),
      ),
    })),
    seed: resampling.seed,
    replicates: resampling.replicates,
    bonferroni: resampling.bonferroni,
  });
}

// The rule that picks the published limit, read from the frozen contract. It is
// NOT a decision of this module: it shapes release verdicts, so it is a contract
// value like `fallbackToIndependentRows` beside it, and `PublishedBoundRule` in
// benchmark/preregistration-v4.ts carries the measured reason it is what it is.
const PUBLISHED_BOUND_RULE = PREREGISTRATION_V4.resampling.publishedBound;

// The outer of two limits at one alpha, plus which estimator supplied each side.
function envelopeOf(
  analytic: EnvelopeBound<"wilson-one-sided">,
  resampled: EnvelopeBound<ResampledPercentileMethod>,
): { lower: number; upper: number; pair: EnvelopePair } {
  if (PUBLISHED_BOUND_RULE !== "wider-of-analytic-and-resampled") {
    // Unreachable while the contract freezes the one rule, and deliberately not
    // an `else`: a rule this function does not implement must stop the run rather
    // than fall through to the rule it happens to have code for.
    throw new RangeError(
      `resampling.publishedBound declares "${String(PUBLISHED_BOUND_RULE)}", ` +
        "which this estimator does not implement",
    );
  }
  return {
    lower: Math.min(analytic.lower, resampled.lower),
    upper: Math.max(analytic.upper, resampled.upper),
    pair: {
      analytic,
      resampled,
      lowerFrom: resampled.lower <= analytic.lower ? "resampled" : "analytic",
      upperFrom: resampled.upper >= analytic.upper ? "resampled" : "analytic",
    },
  };
}

/**
 * The published bound of one rate under the frozen contract's
 * `resampling.publishedBound` rule, with BOTH estimators' bounds recorded — for the
 * individual 95% pair and for the simultaneous bound a gate decides on. `null` when
 * the design produced no interval at all, and the caller then publishes the analytic
 * bound alone — which leaves the plan at `declared-only` for that estimand, and the
 * release gate refuses to decide on it (benchmark/gates.ts).
 *
 * WHY THE PUBLISHED BOUND IS NOT SIMPLY THE RESAMPLED ONE is a contract question,
 * answered in `PublishedBoundRule`, not here. What is this function's business is
 * that the answer be VISIBLE on the number it produces: `simultaneous.method` keeps
 * the percentile name because the design was executed and its limit is inside the
 * envelope, and `boundEnvelope.simultaneous` then says which of the two estimators
 * the deciding limit actually came from. Without it a zero-count rate would publish
 * the analytic limit under a percentile name with nothing recording the swap (R7).
 */
function rateEnvelope(
  analytic: MetricEstimate,
  resampled: MetricEstimate | undefined,
): MetricEstimate | null {
  const unit = resampled?.resampling;
  const method = resampled?.method;
  if (
    resampled === undefined ||
    unit === undefined ||
    method === undefined ||
    !isResampledPercentileMethod(method) ||
    resampled.lower95 === undefined ||
    resampled.upper95 === undefined ||
    analytic.lower95 === undefined ||
    analytic.upper95 === undefined
  ) {
    return null;
  }
  const individual = envelopeOf(
    {
      lower: analytic.lower95,
      upper: analytic.upper95,
      method: "wilson-one-sided",
    },
    { lower: resampled.lower95, upper: resampled.upper95, method },
  );
  const envelope: BoundEnvelope = {
    rule: PUBLISHED_BOUND_RULE,
    ...individual.pair,
  };
  const combined: MetricEstimate = {
    value: analytic.value,
    lower95: individual.lower,
    upper95: individual.upper,
    method,
    resampling: unit,
    boundEnvelope: envelope,
  };
  const analyticSimultaneous = analytic.simultaneous;
  const resampledSimultaneous = resampled.simultaneous;
  if (
    analyticSimultaneous !== undefined &&
    resampledSimultaneous !== undefined
  ) {
    const simultaneous = envelopeOf(
      {
        lower: analyticSimultaneous.lower,
        upper: analyticSimultaneous.upper,
        method: "wilson-one-sided",
      },
      {
        lower: resampledSimultaneous.lower,
        upper: resampledSimultaneous.upper,
        method,
      },
    );
    combined.simultaneous = {
      ...resampledSimultaneous,
      lower: simultaneous.lower,
      upper: simultaneous.upper,
    };
    envelope.simultaneous = simultaneous.pair;
  } else if (analyticSimultaneous !== undefined) {
    // The design gave no simultaneous bound (its tail held no replicate at this
    // alpha). Publishing the analytic one alone keeps the number honest and the
    // gate fail-closed: its method says `wilson-one-sided`, so the gate refuses it
    // for an unresampled interval instead of deciding on it. No envelope either:
    // there is no pair to choose between.
    combined.simultaneous = analyticSimultaneous;
  }
  return combined;
}

// Row indicators summed into their leaf cluster: the sufficient statistic of a
// rate under a clustered design, computed once per statistic.
function perCluster(
  perRow: readonly number[],
  clusterOf: readonly number[],
  clusters: number,
): Float64Array {
  const totals = new Float64Array(clusters);
  for (let index = 0; index < perRow.length; index += 1) {
    totals[clusterOf[index]] += perRow[index];
  }
  return totals;
}

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
  return record.label === PREREGISTRATION_V4.integralPositive.label;
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

/**
 * The two fields that identify a mixed row's diagnostic segment, read TOGETHER
 * from one narrowing of `record.mixture`. Reading them apart is what forced the
 * `?? 0` defaults this replaced: a caller that had already established the cohort
 * still had to re-open `mixture` for the fraction, and the fallback silently
 * classified a mixture-less record as `aiFraction 0` — i.e. as sub-floor, the
 * favorable direction. Absent `mixture` is not a fraction of zero; the schema
 * refuses a mixed record without it, so there is nothing to bucket.
 */
function mixedCohortOf(
  record: BenchmarkRecord,
): { generationMode: GenerationMode; aiFraction: number } | undefined {
  if (record.label !== "mixed") return undefined;
  const mixture = record.mixture;
  if (mixture === undefined) return undefined;
  return {
    generationMode: mixture.generationMode,
    aiFraction: mixture.aiFraction,
  };
}

/** The cohort of a mixed record, or `undefined` for a non-mixed one. */
function generationModeOf(record: BenchmarkRecord): GenerationMode | undefined {
  return mixedCohortOf(record)?.generationMode;
}

/**
 * The identity of one mixed-text diagnostic segment: the cohort, the fraction
 * bucket and the `"<mode>/<bucket>"` key built from them. ONE function, because
 * `MixedFractionSegment.key` here and the `mixedFraction` slice axis in
 * benchmark/slices.ts must be the SAME string — the slice axis is a RECALL axis,
 * so it reaches `criticalRecallSlices` in the published profile, and two
 * spellings of one segment would let a consumer join them wrongly or, worse, let
 * one of the two keep pooling the cohorts. `undefined` for a row that has no
 * segment (not mixed, or no mixture at all), never a default bucket.
 */
export function mixedSegmentOf(record: BenchmarkRecord):
  | {
      key: string;
      generationMode: GenerationMode;
      fractionBucket: string;
    }
  | undefined {
  const cohort = mixedCohortOf(record);
  if (cohort === undefined) return undefined;
  const fractionBucket = mixedFractionBucket(cohort.aiFraction);
  return {
    key: `${cohort.generationMode}/${fractionBucket}`,
    generationMode: cohort.generationMode,
    fractionBucket,
  };
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
  const replicates = options.bootstrapReplicates ?? PILOT_REPLICATES;
  if (!Number.isInteger(replicates) || replicates < PILOT_REPLICATES) {
    throw new RangeError(
      `bootstrapReplicates must be an integer of at least ${PILOT_REPLICATES} ` +
        `(the pre-registered pilot count), got ${replicates}; the frozen contract ` +
        "says never to reduce the replicate count for run time",
    );
  }

  const bonferroni = multiplicityFrom(options.preRegisteredStatisticalGates);

  const eligible = items.filter((item) =>
    isEligible(item.record, minimumWords),
  );
  const eligibleCount = eligible.length;

  // What the plan will publish as MEASURED: one entry per estimand whose unit this
  // run resolved, saying whether the published interval came out of the design.
  const measuredUnits = new Map<string, MeasuredUnit>();
  const recordUnit = (estimand: string, measured: MeasuredUnit): void => {
    if (!measuredUnits.has(estimand)) measuredUnits.set(estimand, measured);
  };
  const rateResampling = (
    humanEstimands: { fpr: string; clearance: string } | null,
    recallEstimand: string | null,
  ): RateResampling => ({
    seed,
    replicates,
    bonferroni,
    humanEstimands,
    recallEstimand,
    record: recordUnit,
  });

  // Both decision families are measured over the ELIGIBLE set: end-to-end over
  // all of it, conditional over the part of it that produced a score. Their rates
  // are drawn from the frozen table's first two rows — source ⊃ author over the
  // human negatives, generator ⊃ prompt template ⊃ batch over the AI positives —
  // and never from an analytic bound that would treat correlated rows as
  // independent while declaring a unit beside itself.
  const warning = decisionFamilies(
    eligible,
    (item) => item.warned,
    bonferroni,
    "warning-positives",
    rateResampling(
      { fpr: ESTIMAND_WARNING_FPR, clearance: ESTIMAND_WARNING_CLEARANCE },
      ESTIMAND_WARNING_RECALL,
    ),
  );
  const visualAction = visualActionAvailable
    ? decisionFamilies(
        eligible,
        (item) => item.visualActioned,
        bonferroni,
        "warning-positives",
        rateResampling(
          { fpr: ESTIMAND_ACTION_FPR, clearance: ESTIMAND_ACTION_CLEARANCE },
          // NOT the gated action recall: this matrix counts the WARNING positives,
          // and `action.recall` is the recall over integral positives alone
          // (`actionAuthorization`). Resampling it here under that estimand would
          // put the wrong population's measurement in the plan.
          null,
        ),
      )
    : null;
  // The authorizing statistic: the SAME decision over the integral positives
  // alone. A separate matrix, not a projection of the one above, because the
  // populations differ (B2).
  const actionAuthorization = visualActionAvailable
    ? actionAuthorizationMetrics(
        eligible,
        bonferroni,
        rateResampling(null, ESTIMAND_ACTION_RECALL),
      )
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

  // ONE resolution for the whole binary population: the five continuous
  // statistics belong to the same row of the frozen table, so they share the unit
  // and must publish the same one. Resolved OUTSIDE the interval helpers so a
  // `ResamplingUnitError` cannot be swallowed by a per-statistic fallback.
  const binaryResolution =
    scoredBinary.length === 0
      ? null
      : resolveResampling(
          scoredBinary,
          resamplingDesignFor(ESTIMAND_CALIBRATION_ECE),
        );
  const binaryStatistics =
    binaryResolution === null
      ? null
      : binaryPoints(scoredBinary, binaryResolution.clusterOf);
  // The five continuous statistics, in ONE resample stream over that unit.
  const continuous = resampledEstimates({
    resolution: binaryResolution,
    statistics:
      binaryStatistics === null
        ? []
        : [
            {
              estimand: ESTIMAND_SEPARABILITY_AUROC,
              value: rocAucFromItems(scoredBinary),
              weighted: weightedAuroc(binaryStatistics),
            },
            {
              estimand: ESTIMAND_SEPARABILITY_PR_AUC,
              value: prAucFromItems(scoredBinary),
              weighted: weightedPrAuc(binaryStatistics),
            },
            {
              estimand: ESTIMAND_CALIBRATION_BRIER,
              value: sampleBrier(scoredBinary),
              weighted: weightedBrier(
                binaryStatistics,
                binaryResolution?.clusterCount ?? 0,
              ),
            },
            {
              estimand: ESTIMAND_CALIBRATION_ECE,
              value: sampleEceEqualMass(scoredBinary),
              weighted: weightedEceEqualMass(binaryStatistics),
            },
            {
              estimand: ESTIMAND_CALIBRATION_ECE15,
              value: sampleEce(scoredBinary),
              weighted: weightedEce15(binaryStatistics),
            },
          ],
    seed,
    replicates,
    bonferroni,
  });
  const estimateOf = (estimand: string): MetricEstimate =>
    continuous.get(estimand) ?? absentEstimate();
  for (const [estimand, estimate] of continuous) {
    const unit = estimate.resampling;
    if (unit === undefined) continue;
    // No analytic estimator competes for a Brier, an ECE or an AUROC limit, so the
    // published bound IS the resampled percentile — recorded, not inferred by a
    // reader from the absence of an envelope.
    recordUnit(estimand, {
      unit,
      resampled: true,
      bound: { kind: "resampled-only" },
      note: null,
    });
  }

  // The MIXED row of the frozen table, resolved over the cohort its gate reads
  // (mechanistic, at or above the frozen AI fraction). It is resolved and NOT
  // resampled, on purpose: the crossed pair is `human parent × edit operation` and
  // no axis of the v3 schema records the edit operation, so the second factor is a
  // declared PROXY (`groups.promptTemplate`, see the policy row) that measured one
  // single level over the assembled corpus while the parent factor measured one
  // level per row. Publishing the measurement is the point — a reader sees the
  // degeneracy as a number instead of reading a crossed interval that is really
  // i.i.d. The bound beside `mixed.atLeastHalfAi` stays the analytic one and the
  // plan says `declared-only` for this estimand.
  const mixedCohort = items.filter((item) => {
    const cohort = mixedCohortOf(item.record);
    return (
      cohort?.generationMode === MATERIAL_ASSISTANCE_MODE &&
      cohort.aiFraction >= MATERIAL_ASSISTANCE_AI_FRACTION
    );
  });
  if (mixedCohort.length > 0) {
    recordUnit(
      ESTIMAND_MIXED_WARNING_RECALL,
      measuredMixedUnit(
        mixedCohort,
        resamplingDesignFor(ESTIMAND_MIXED_WARNING_RECALL),
      ),
    );
  }

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
      auroc: estimateOf(ESTIMAND_SEPARABILITY_AUROC),
      prAuc: estimateOf(ESTIMAND_SEPARABILITY_PR_AUC),
      tprAtOnePercentFpr: tprAtTargetFpr(scoredBinary, DEFAULT_TARGET_FPR),
    },
    calibration: calibrationDiagnostics(
      binaryPopulation,
      scoredBinary,
      estimateOf(ESTIMAND_CALIBRATION_BRIER),
      estimateOf(ESTIMAND_CALIBRATION_ECE),
      binaryPopulationErrorRate,
    ),
    labelBasis: labelBasisBreakdown(eligible, bonferroni, {
      seed,
      replicates,
      bonferroni,
      humanEstimands: null,
      recallEstimand: null,
      record: recordUnit,
    }),
    predictiveValue: predictiveValueProjection(warning),
    resampling: buildResamplingPlan(replicates, measuredUnits),
    multiplicity: bonferroni,
    ece15: estimateOf(ESTIMAND_CALIBRATION_ECE15),
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
  resampling: RateResampling | null = null,
): ActionAuthorizationMetrics {
  const families = decisionFamilies(
    eligible,
    (item) => item.visualActioned,
    bonferroni,
    "integral-positives",
    resampling,
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
    // Read through ONE narrowing of `mixture`, so the fraction cannot arrive as a
    // default: a mixed record without `mixture` has no cohort and no fraction, and
    // `?? 0` used to file it as sub-floor, which is the favorable direction.
    excludedEcologicalCohort: eligible.filter((item) => {
      const cohort = mixedCohortOf(item.record);
      return (
        cohort !== undefined &&
        cohort.generationMode !== MATERIAL_ASSISTANCE_MODE &&
        cohort.aiFraction >= MATERIAL_ASSISTANCE_AI_FRACTION
      );
    }).length,
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
  // Both come from the single resample stream of `computeEvaluationMetrics`; this
  // function no longer resamples, so the unit it publishes cannot differ from the
  // one AUROC and PR-AUC were drawn over.
  brier: MetricEstimate,
  eceEqualMass15: MetricEstimate,
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
    brier,
    logLoss: logLoss(points),
    intercept: fit.intercept,
    slope: fit.slope,
    bins: ECE_BINS,
    eceEqualMass15,
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
        resamplingUnit: resamplingUnitOf(scored, ESTIMAND_CALIBRATION_ECE),
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
  if (record.label !== PREREGISTRATION_V4.labelBasis.appliesToLabel) {
    return "unknown";
  }
  const raw = (record as { labelBasis?: unknown }).labelBasis;
  if (
    typeof raw === "string" &&
    (PREREGISTRATION_V4.labelBasis.allowed as readonly string[]).includes(raw)
  ) {
    return raw as LabelBasisKey;
  }
  return "unknown";
}

function labelBasisBreakdown(
  eligible: readonly EvaluationItem[],
  bonferroni: MultiplicityDeclaration | null,
  // The seed and effort the per-basis FPR is resampled with, and where the plan
  // records what happened. Only `seed`, `replicates`, `bonferroni` and `record` are
  // read: the estimand is fixed by the block (`warning.fpr.labelBasis`, which the
  // action gate reads as `action.fpr.labelBasis` off the same interval).
  resampling: RateResampling | null = null,
): LabelBasisBreakdown {
  const negatives = eligible.filter((item) => isHumanNegative(item.record));
  const buckets = new Map<LabelBasisKey, EvaluationItem[]>();
  for (const item of negatives) {
    const basis = labelBasisOf(item.record);
    const bucket = buckets.get(basis);
    if (bucket === undefined) buckets.set(basis, [item]);
    else bucket.push(item);
  }
  let resampledBases = 0;
  let intervalBases = 0;
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
      const analyticFpr = proportionEstimate(
        falsePositives,
        scored.length,
        bonferroni,
      );
      // The unit is resolved over the WHOLE basis and the FPR's denominator is its
      // scored subset — the same split `decisionMetrics` uses, so the published
      // `resamplingUnit` is the unit the interval was actually drawn over.
      const resolution =
        bucket.length === 0
          ? null
          : resolveResampling(
              bucket,
              resamplingDesignFor(ESTIMAND_WARNING_FPR_LABEL_BASIS),
            );
      const drawnFpr =
        resampling === null || resolution === null
          ? undefined
          : resampledRates(
              resolution,
              [
                {
                  estimand: ESTIMAND_WARNING_FPR_LABEL_BASIS,
                  numerator: bucket.map((item) =>
                    isScoredItem(item) && item.warned ? 1 : 0,
                  ),
                  denominator: bucket.map((item) =>
                    isScoredItem(item) ? 1 : 0,
                  ),
                  analytic: analyticFpr,
                },
              ],
              resampling,
            ).get(ESTIMAND_WARNING_FPR_LABEL_BASIS);
      const resampledFpr = rateEnvelope(analyticFpr, drawnFpr) ?? undefined;
      if (Number.isFinite(analyticFpr.value)) intervalBases += 1;
      if (resampledFpr !== undefined) resampledBases += 1;
      return {
        basis,
        count: bucket.length,
        scored: scored.length,
        errored: bucket.filter((item) => item.status === "error").length,
        resamplingUnit: resolution?.declaration ?? null,
        powered,
        powerFloor: LABEL_BASIS_POWER_FLOOR,
        evidenceRole: powered
          ? ("gating" as const)
          : PREREGISTRATION_V4.labelBasis.underPoweredRole,
        falsePositiveRate: resampledFpr ?? analyticFpr,
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
  // ONE interval per basis, and BOTH gate estimands read it: the warning tier and
  // the action tier decide the same number against different budgets. The plan
  // therefore records the same outcome under both names, with `measured: null` —
  // there are several bases and one entry, so the per-basis unit lives on the
  // basis (`LabelBasisSlice.resamplingUnit`) and the note says where.
  if (resampling?.record !== null && resampling !== null) {
    const note =
      `medida por base: ${bases.length} base(s), ${resampledBases} de ` +
      `${intervalBases} com taxa definida reamostrada(s); a unidade de cada base ` +
      "está em labelBasis.bases[].resamplingUnit";
    for (const estimand of [
      ESTIMAND_WARNING_FPR_LABEL_BASIS,
      ESTIMAND_ACTION_FPR_LABEL_BASIS,
    ]) {
      resampling.record(estimand, {
        unit: null,
        // Every basis whose rate is defined at all had to come out of the design;
        // one that did not leaves the entry `declared-only`, and the gate then
        // refuses the analytic bound that took its place.
        resampled: intervalBases > 0 && resampledBases === intervalBases,
        bound: {
          kind: "per-interval",
          where:
            'coluna "Procedência do limite" da tabela de bases de rótulo humano ' +
            "(labelBasis.bases[].falsePositiveRate.boundEnvelope)",
        },
        note,
      });
    }
  }
  return {
    role: "human-negative-label-evidence",
    fieldPresent: bases.some((slice) => slice.basis !== "unknown"),
    pooledClaimAllowed: PREREGISTRATION_V4.labelBasis.pooledClaimAllowed,
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
  const familyAlpha = PREREGISTRATION_V4.multiplicity.familyAlpha;
  const perGateAlpha = familyAlpha / preRegisteredStatisticalGates;
  return {
    correction: "bonferroni",
    familyAlpha,
    descriptiveConfidence:
      PREREGISTRATION_V4.multiplicity.descriptiveConfidence,
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
  // How the rates of BOTH families are resampled. Both, not only the gated one: a
  // reader compares the conditional mirror against the end-to-end number directly,
  // and giving one an honest interval and the other a too-narrow one would invite
  // exactly the wrong comparison. Only the end-to-end family feeds the plan
  // (`RateResampling.record`), because that is the interval a gate reads.
  resampling: RateResampling | null = null,
): DecisionFamilies {
  return {
    endToEnd: decisionMetrics(
      eligible,
      decide,
      "end-to-end",
      bonferroni,
      positivePopulation,
      resampling,
    ),
    conditionalOnScored: decisionMetrics(
      eligible.filter(isScoredItem),
      decide,
      "conditional-on-scored",
      bonferroni,
      positivePopulation,
      resampling,
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
  resampling: RateResampling | null = null,
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
  // The two sub-populations the frozen table gives DIFFERENT units, kept apart as
  // they are counted: rows 1 and 2 are not two views of one design. Row 1 nests
  // source ⊃ author over the human negatives; row 2 nests generator ⊃ prompt
  // template ⊃ batch over the AI positives.
  const negativeRows: EvaluationItem[] = [];
  const negativeDecided: number[] = [];
  const negativeFalsePositive: number[] = [];
  const negativeTrueNegative: number[] = [];
  const positiveRows: EvaluationItem[] = [];
  const positiveTruePositive: number[] = [];

  for (const item of population) {
    const positive = isPositive(item.record);
    const negative = isHumanNegative(item.record);
    if (!positive && !negative) continue;
    if (positive) positives += 1;
    else negatives += 1;

    const scored = isScoredItem(item);
    const decided = scored && decide(item);
    if (positive) {
      positiveRows.push(item);
      positiveTruePositive.push(decided ? 1 : 0);
    } else {
      negativeRows.push(item);
      negativeDecided.push(scored ? 1 : 0);
      negativeFalsePositive.push(decided ? 1 : 0);
      negativeTrueNegative.push(scored && !decided ? 1 : 0);
    }

    if (!scored) {
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

    if (positive) {
      if (decided) truePositives += 1;
      else falseNegatives += 1;
    } else if (decided) falsePositives += 1;
    else trueNegatives += 1;
  }

  const analyticFpr = proportionEstimate(
    falsePositives,
    falsePositives + trueNegatives,
    bonferroni,
  );
  const analyticClearance = proportionEstimate(
    trueNegatives,
    negatives,
    bonferroni,
  );
  const analyticRecall = proportionEstimate(
    truePositives,
    positives,
    bonferroni,
  );
  const resampled =
    resampling === null
      ? new Map<string, MetricEstimate>()
      : new Map([
          ...rateEstimates(
            negativeRows,
            resampling.humanEstimands === null
              ? []
              : [
                  {
                    estimand: resampling.humanEstimands.fpr,
                    numerator: negativeFalsePositive,
                    denominator: negativeDecided,
                    analytic: analyticFpr,
                  },
                  {
                    estimand: resampling.humanEstimands.clearance,
                    numerator: negativeTrueNegative,
                    denominator: negativeRows.map(() => 1),
                    analytic: analyticClearance,
                  },
                ],
            resampling.humanEstimands?.fpr ?? null,
            resampling,
            family,
          ),
          ...rateEstimates(
            positiveRows,
            resampling.recallEstimand === null
              ? []
              : [
                  {
                    estimand: resampling.recallEstimand,
                    numerator: positiveTruePositive,
                    denominator: positiveRows.map(() => 1),
                    analytic: analyticRecall,
                  },
                ],
            resampling.recallEstimand,
            resampling,
            family,
          ),
        ]);

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
    falsePositiveRate:
      resampled.get(resampling?.humanEstimands?.fpr ?? "") ?? analyticFpr,
    clearanceRate:
      resampled.get(resampling?.humanEstimands?.clearance ?? "") ??
      analyticClearance,
    recall: resampled.get(resampling?.recallEstimand ?? "") ?? analyticRecall,
    // PRECISION IS NOT A ROW OF THE FROZEN TABLE and gets no unit. Its
    // denominator TP+FP spans both populations — AI positives and human negatives
    // — so neither row applies to it, and picking one would be choosing a unit by
    // convenience for a quantity the table does not cover. It keeps the analytic
    // bound and declares nothing (R7).
    precision: proportionEstimate(
      truePositives,
      truePositives + falsePositives,
      bonferroni,
    ),
  };
}

/**
 * The rates of one sub-population, resampled over ONE unit, plus the measurement
 * recorded in the plan. The resolution happens here and is NOT wrapped in a
 * try/catch: an `unknown` axis on a required unit has to surface, because the
 * failure this module exists to remove is the one that produced an interval that
 * looked valid.
 */
function rateEstimates(
  rows: readonly EvaluationItem[],
  statistics: readonly RateStatistic[],
  unitEstimand: string | null,
  resampling: RateResampling,
  family: MetricFamily,
): Map<string, MetricEstimate> {
  if (statistics.length === 0 || rows.length === 0 || unitEstimand === null) {
    return new Map();
  }
  const resolution = resolveResampling(rows, resamplingDesignFor(unitEstimand));
  const drawn = resampledRates(resolution, statistics, resampling);
  const publishable = new Map<string, MetricEstimate>();
  for (const entry of statistics) {
    const combined = rateEnvelope(entry.analytic, drawn.get(entry.estimand));
    if (combined !== null) publishable.set(entry.estimand, combined);
  }
  // Only the gated family is recorded. An estimand the design could not carry is
  // recorded as MEASURED-BUT-NOT-RESAMPLED, with the reason: the measured unit is
  // the evidence a reader needs, and `executed` stays `declared-only` so the gate
  // refuses the analytic bound that took its place instead of reading it as if the
  // declared unit had been honoured.
  if (resampling.record !== null && family === "end-to-end") {
    for (const entry of statistics) {
      const published = publishable.get(entry.estimand);
      resampling.record(entry.estimand, {
        unit: published?.resampling ?? resolution.declaration,
        resampled: published !== undefined,
        // The provenance of the number that GOT published: when the envelope did
        // not form, the analytic estimate is what the metric block carries, and it
        // is the one whose limits (or absence of limits) a reader sees.
        bound: boundProvenanceOf(published ?? entry.analytic),
        note:
          published !== undefined
            ? null
            : unresampledRateNote(entry.analytic.value),
      });
    }
  }
  return publishable;
}

/**
 * The mixed row's unit, measured over the mechanistic cohort — or the reason it
 * could not be.
 *
 * This is the ONE place a `ResamplingUnitError` is caught, and the reason it is
 * safe here is exactly the reason it is not safe anywhere else: no interval is
 * published from this design. `mixed.atLeastHalfAi` carries an analytic lower bound
 * and its gate reads the point, so an unresolvable unit cannot produce a number
 * that looks valid — the failure mode the rest of this module refuses to allow. It
 * would, however, take down the whole evaluation over a declaration nothing gates,
 * and it does so for a corpus that CANNOT satisfy it: a v2 record has no
 * `groups.humanSeed` axis at all, so the crossed pair is unresolvable there by
 * construction rather than by omission. The plan then carries the reason instead of
 * a bare `measured: null`.
 */
function measuredMixedUnit(
  cohort: readonly EvaluationItem[],
  design: ResamplingDesign<EvaluationItem>,
): MeasuredUnit {
  try {
    return {
      unit: resolveResampling(cohort, design).declaration,
      resampled: false,
      bound: { kind: "analytic-only" },
      note:
        "unidade medida, intervalo não reamostrado: o limite publicado ao lado de " +
        "mixed.atLeastHalfAi é o de Wilson, e o segundo fator cruzado é um proxy " +
        "declarado até D4 gravar a operação de edição como eixo",
    };
  } catch (error) {
    if (!(error instanceof ResamplingUnitError)) throw error;
    return {
      unit: null,
      resampled: false,
      bound: { kind: "analytic-only" },
      note: `unidade não resolvida sobre a coorte mecanística: ${error.message}`,
    };
  }
}

// Why a rate whose unit RESOLVED still has no resampled bound in its interval.
function unresampledRateNote(value: number): string {
  if (!Number.isFinite(value)) {
    return (
      "a taxa é indefinida nesta população (denominador zero), logo não há " +
      "estatística para reamostrar"
    );
  }
  return (
    "as réplicas finitas não bastaram para ler um percentil sobre a unidade " +
    "declarada, então o limite publicado é só o de Wilson e o gate reprova por " +
    "intervalo não reamostrado"
  );
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

/**
 * A continuous metric with a clustered percentile bootstrap interval over the
 * unit its estimand declares.
 *
 * The resolution is handed in already built, because the five continuous
 * statistics of one run share one estimand class and therefore one unit: doing
 * the resolution once is what stops the published unit from differing between two
 * statistics over the same population.
 *
 * It degrades to a bare point estimate only when the statistic is undefined (a
 * single class) or when the replicate distribution is too thin to read a
 * percentile from. A `ResamplingUnitError` is NOT caught: an unusable unit must
 * surface, because the failure this whole module exists to remove is the one that
 * produced an interval that looked valid.
 */
/**
 * The continuous statistics of one population, each with a clustered percentile
 * bootstrap interval over the unit its estimand declares — all from ONE resample
 * stream.
 *
 * One stream and not five: the statistics belong to the same row of the frozen
 * table over the same population, so they share the unit and the seed and were
 * already drawing identical weight vectors. Paying the draw once is the same
 * computation, and it is what keeps 100.000 replicates over a real corpus from
 * costing five times what it has to.
 *
 * A statistic degrades to a bare point estimate only when it is undefined (a
 * single class) or when its replicate distribution is too thin to read a
 * percentile from. A `ResamplingUnitError` is NOT caught anywhere on this path:
 * the resolution is built by the caller, before any statistic runs, because an
 * unusable unit must surface instead of quietly becoming a point estimate.
 */
function resampledEstimates(input: {
  resolution: ResamplingResolution | null;
  /** Estimand name, the point value from the exported definition, and the
   *  weighted form the replicates use. */
  statistics: ReadonlyArray<{
    estimand: string;
    value: number;
    weighted: WeightedStatistic;
  }>;
  seed: number;
  replicates: number;
  bonferroni: MultiplicityDeclaration | null;
}): Map<string, MetricEstimate> {
  const { resolution, bonferroni } = input;
  const estimates = new Map<string, MetricEstimate>();
  const resampleable = input.statistics.filter((entry) =>
    Number.isFinite(entry.value),
  );
  for (const entry of input.statistics) {
    if (!resampleable.includes(entry)) {
      estimates.set(entry.estimand, { value: entry.value, method: "point" });
    }
  }
  if (resolution === null || resampleable.length === 0) {
    for (const entry of resampleable) {
      estimates.set(entry.estimand, { value: entry.value, method: "point" });
    }
    return estimates;
  }

  const intervals = clusteredPercentileBootstrapAll(resolution, {
    iterations: input.replicates,
    seed: input.seed,
    statistics: resampleable.map((entry) => entry.weighted),
    ...(bonferroni === null
      ? {}
      : { simultaneousAlpha: bonferroni.perGateAlpha }),
  });

  resampleable.forEach((entry, index) => {
    const interval = intervals[index];
    if (interval === null) {
      estimates.set(entry.estimand, { value: entry.value, method: "point" });
      return;
    }
    const estimate: MetricEstimate = {
      value: entry.value,
      lower95: interval.lower95,
      upper95: interval.upper95,
      method: interval.method,
      resampling: { ...interval.unit, estimand: entry.estimand },
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
        method: interval.method,
      };
    }
    estimates.set(entry.estimand, estimate);
  });
  return estimates;
}

// A statistic the run did not compute, published as an absent point rather than
// invented: it happens only when the population scored nothing.
function absentEstimate(): MetricEstimate {
  return { value: Number.NaN, method: "point" };
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

function latencyMetricsAll(items: readonly EvaluationItem[]): LatencyByStatus {
  // One argument, on purpose: the population is BOTH the filter and the label the
  // block publishes, so spelling them separately would let a block carry samples
  // from one outcome under the name of another and still typecheck.
  const blockFor = (population: LatencyPopulation): LatencyMetrics | null =>
    latencyOf(
      items
        .filter((item) => item.status === population)
        .map((item) => item.latencyMs),
      population,
    );
  return {
    scored: blockFor("scored"),
    abstained: blockFor("abstained"),
    errored: blockFor("error"),
  };
}

function latencyOf(
  values: readonly (number | undefined)[],
  population: LatencyPopulation,
): LatencyMetrics | null {
  const samples = values
    .filter((value): value is number => isFiniteNumber(value))
    .sort((a, b) => a - b);
  if (samples.length === 0) return null;

  const sum = samples.reduce((total, value) => total + value, 0);
  return {
    population,
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
//
// Every cohort publishes BOTH status families (R5) and declares whether a span
// producer exists at all. The second half is not defensive programming: on a real
// run today the answer is `"absent"`, because no stage writes `localizedSpans`
// (D4 owns the span head), and the numbers a `"present"` run would publish are the
// same zeros an absent producer would — so the block has to say which of the two
// it is instead of leaving a reader to assume the detector was measured and failed.
//
// The producer state is derived ONCE here, over every item of the run, and handed
// to each cohort. It must not be re-derived per cohort: see `SpanProducerState`
// for the measured defect that shape produced.
function localizationDiagnostics(
  items: readonly EvaluationItem[],
): LocalizationDiagnostics {
  const spanProducer = spanProducerOfRun(items);
  return {
    role: "diagnostic",
    gates: false,
    authorizesVisualAction:
      PREREGISTRATION_V4.localization.authorizesVisualAction,
    unit: "character-offset",
    byGenerationMode: sortedGenerationModes().map((mode) =>
      localizationCohort(items, mode, spanProducer),
    ),
  };
}

// Derived over the WHOLE run, never over a cohort or a family: only a scored row
// can carry `localizedSpans`, so a population that by construction holds none —
// an all-errored cohort — carries no evidence about the producer at all.
function spanProducerOfRun(
  items: readonly EvaluationItem[],
): SpanProducerState {
  const scored = items.filter(isScoredItem);
  // No decision anywhere: nothing could have carried the field, so neither
  // "present" nor "absent" is supportable.
  if (scored.length === 0) return "undeterminable";
  // `!== undefined` and not `length > 0`: a span head that ran and emitted an
  // empty list IS a producer, and its zeros are a measurement (pinned by the
  // present-and-empty test in benchmark/tests/metrics.test.ts, which dies under
  // the `length > 0` spelling).
  return scored.some((item) => item.localizedSpans !== undefined)
    ? "present"
    : "absent";
}

function sortedGenerationModes(): GenerationMode[] {
  return [...GENERATION_MODES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function localizationCohort(
  items: readonly EvaluationItem[],
  generationMode: GenerationMode,
  spanProducer: SpanProducerState,
): LocalizationCohort {
  // The cohort: every row of this generation mode that HAS an observed AI span,
  // whatever its status. A row whose localized path emitted nothing stays in,
  // because dropping it would turn silence into an absence of evidence rather
  // than a miss — and that is as true of an undecided row as of a scored one.
  // The two families differ ONLY by the status rule applied to this selection.
  const cohortRows = items.filter(
    (item) =>
      generationModeOf(item.record) === generationMode &&
      observedAiSpans(item.record).length > 0,
  );
  return {
    generationMode,
    role: "diagnostic",
    aggregated: false,
    // Handed down from the run, never recomputed here.
    spanProducer,
    endToEnd: localizationFamily(cohortRows, "end-to-end", spanProducer),
    conditionalOnScored: localizationFamily(
      cohortRows.filter(isScoredItem),
      "conditional-on-scored",
      spanProducer,
    ),
  };
}

// The denominator rule of each family, in words. Derived from `family` and not
// passed alongside it, so the label and the rule it describes cannot be
// constructed disagreeing — the same shape A7 resolved for the two FPR column
// headers by routing both through one constructor.
const LOCALIZATION_POPULATION_RULES: Readonly<
  Record<MetricFamily, LocalizationFamily["populationRule"]>
> = {
  "end-to-end": "cohort-rows-with-observed-spans",
  "conditional-on-scored": "scored-cohort-rows-with-observed-spans",
};

function localizationFamily(
  rows: readonly EvaluationItem[],
  family: MetricFamily,
  spanProducer: SpanProducerState,
): LocalizationFamily {
  let intersection = 0;
  let union = 0;
  let observed = 0;
  let predicted = 0;
  let iouSum = 0;
  let precisionSum = 0;
  let recallSum = 0;
  let localizedEmitted = 0;
  let undecidedRows = 0;
  for (const item of rows) {
    // One classification drives both the emission and the count, in that order:
    // an undecided row emitted nothing, so it enters every ratio as a total miss —
    // full observed length into the union, zero into the intersection. There is
    // no substitution and no removal here (R5).
    const scored = isScoredItem(item);
    if (!scored) undecidedRows += 1;
    const emitted = scored ? (item.localizedSpans ?? []) : [];
    const overlap = spanOverlap(observedAiSpans(item.record), emitted);
    intersection += overlap.intersection;
    union += overlap.union;
    observed += overlap.observed;
    predicted += overlap.predicted;
    iouSum += overlap.iou;
    precisionSum += overlap.tokenPrecision;
    recallSum += overlap.tokenRecall;
    if (overlap.predicted > 0) localizedEmitted += 1;
  }
  const count = rows.length;
  // The counts are published either way — they say how much span evidence is
  // waiting — but a ratio needs both a denominator AND a producer to be a
  // measurement. Without a producer every ratio below would be exactly 0,
  // indistinguishable from a detector that located nothing; with `count === 0`
  // `proportionEstimate` returns a NaN value, which is not a statement either.
  // Note what this does NOT exclude: a run WITH a producer whose every row in this
  // family is undecided is measurable and publishes 0. That is the measured
  // integral miss R5 asks for, and nulling it was the defect `SpanProducerState`
  // records.
  const measurable = count > 0 && spanProducer === "present";
  return {
    family,
    populationRule: LOCALIZATION_POPULATION_RULES[family],
    population: count,
    undecidedRows,
    localizedEmitted,
    localizedPathRecall: measurable
      ? proportionEstimate(localizedEmitted, count)
      : null,
    overlap: measurable
      ? {
          microIou: ratio(intersection, union),
          microTokenPrecision: ratio(intersection, predicted),
          microTokenRecall: ratio(intersection, observed),
          macroIou: ratio(iouSum, count),
          macroTokenPrecision: ratio(precisionSum, count),
          macroTokenRecall: ratio(recallSum, count),
        }
      : null,
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
  // One narrowing of `mixture` for both fields (`mixedCohortOf`), so the fraction
  // of this GATED denominator can never arrive as a default. This is the third
  // instance of that read; the other two are in `mixedByFraction` and
  // `actionAuthorizationMetrics`.
  const strong = items.filter((item) => {
    const cohort = mixedCohortOf(item.record);
    return (
      cohort?.generationMode === generationMode &&
      cohort.aiFraction >= MATERIAL_ASSISTANCE_AI_FRACTION
    );
  });
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

// FOUR BANDS, NOT THE v0-v8 CURVE. The frozen diagnostic beside the
// `warning.mixed-recall` gate is the nine-level coverage curve (0%, 15%, 25%, 40%,
// 50%, 60%, 75%, 90%, 100% — D4 in the plan), and these bands POOL it: v0 with v1
// into `0_24`, v2 with v3 into `25_49`, v4 with v5 into `50_74`, and v6/v7/v8 into
// `75_100`. So nothing that keys off these bands — `mixed.byFraction`, the
// `mixedFraction` slice axis, `criticalRecallSlices` in the published profile —
// can be read as a per-level curve, and a nine-point curve cannot be recovered
// from four aggregated points.
//
// Why B2 stops here instead of splitting them: the level is a property of the
// MIXING OPERATION, not of the record's observed `aiFraction` (D4 targets a level
// and lands near it, so keying by the achieved fraction would produce one key per
// record). Publishing a per-level curve therefore needs a level field written by
// the mixing lane, and that lane is D4's — `benchmark/lab/make_mixed_v3.py` does
// not exist yet. The pooling is pinned by a test over the nine frozen levels, so
// this shortfall is executable rather than a paragraph someone can delete.
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
    // Through the shared helper, so this key and the `mixedFraction` slice axis
    // key are the same string by construction and not by two template literals
    // that happen to match today.
    const segment = mixedSegmentOf(item.record);
    if (segment === undefined) continue;
    const { key, generationMode: mode, fractionBucket } = segment;
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
