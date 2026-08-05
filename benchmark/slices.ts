// Risk slices, macro-average and worst-slice for the v2 benchmark report.
//
// Each slice is a subset of the holdout along one axis (the §6.4 critical slices
// plus transformation severity), carrying its full EvaluationMetrics and the
// sampling-floor verdict: an FPR slice can gate a release only at or above
// `powerFloors.criticalFprHumanNegatives` human negatives, a recall slice only at or
// above `powerFloors.criticalRecallPositives` positives. Those floors
// count the population the matrix was MEASURED over (the eligible subset), not
// the raw bucket, so a slice is never declared powered on rows its rate never
// saw. Under-powered slices stay in the report but are flagged non-gating rather
// than silently dropped, and the worst-slice search considers only gate-eligible
// slices so a tiny, noisy slice never becomes the reported worst case.
//
// Every rate this module macro-averages or ranks reads the END-TO-END metric
// family (benchmark/metrics.ts): a slice whose inference failed must not look
// better than one that answered, so the worst-slice search and the macro average
// never read the conditional family. The conditional numbers stay available per
// slice, inside each slice's own metrics.
//
// Standalone module: MUST NOT import from the extension bundle (src/). Pure and
// deterministic apart from the caller-supplied bootstrap seed. Sibling imports
// use explicit .ts extensions for Node's native TypeScript execution.

import {
  computeEvaluationMetrics,
  mixedSegmentOf,
  sizeBucket,
  type EvaluationItem,
  type EvaluationMetrics,
  type EvaluationOptions,
} from "./metrics.ts";
import { generatorFamilyOf, type GeneratorFamily } from "./generator-family.ts";
import { PREREGISTRATION_V4 } from "./preregistration-v4.ts";
import type { BenchmarkRecord } from "./schema.ts";

export type SliceAxis =
  | "lengthBucket"
  | "domain"
  | "humanSourceType"
  | "temporalCohort"
  | "hardNegativeFamily"
  | "generatorExposure"
  | "transformation"
  | "severity"
  | "mixedFraction";

export interface SliceResult {
  axis: SliceAxis;
  key: string;
  // Every row that fell in this bucket, eligible or not — descriptive only.
  sampleSize: number;
  // The CLASS counts of the population the decision matrix was MEASURED over
  // (the eligible subset, end-to-end family), so the sampling floors below and
  // every declared sampleSize downstream match the population behind the
  // interval. Invariant: `positives === metrics.warning.endToEnd.positives` and
  // likewise for `negatives`; pinned by benchmark/tests/slices.test.ts.
  //
  // NOT every rate's own denominator, and the claim stops here on purpose:
  //   * `clearanceRate` (TN/negatives) and `recall` (TP/positives) run over
  //     exactly these two counts;
  //   * `falsePositiveRate` (FP/(FP+TN)) and `precision` (TP/(TP+FP)) run over
  //     the DECIDED subset, so `negatives` still over-declares an FPR interval's
  //     n by `metrics.warning.endToEnd.undecidedNegatives` (and `positives`
  //     likewise for precision).
  // Whether the published FPR evidence should declare FP+TN as its own
  // sampleSize — profile-artifact.ts pairs these counts with
  // `indicatorFpr`/`actionFpr`, which contracts/calibration-profile.ts checks
  // against MINIMUM_CRITICAL_FPR_SAMPLE — is A6/G2's call, not A3's; it is
  // recorded as an open item in the plan's A3 section, under the item titled
  // after this slice-count invariant (the one that names `undecidedNegatives`).
  positives: number;
  negatives: number;
  fprGateEligible: boolean;
  recallGateEligible: boolean;
  // The floors the two verdicts above were decided AGAINST. Published because a
  // caller may raise them (`SliceOptions.minimumFprNegatives`): a consumer that
  // composes a message from the pre-registered row instead would name a number this
  // slice was never compared to.
  fprNegativeFloor: number;
  recallPositiveFloor: number;
  metrics: EvaluationMetrics;
}

export interface SliceSummary {
  slices: SliceResult[];
  macro: {
    warningFpr: number;
    warningRecall: number;
    actionFpr: number | null;
    actionRecall: number | null;
  };
  worst: {
    warningFpr?: SliceResult;
    warningRecall?: SliceResult;
    actionFpr?: SliceResult;
    actionRecall?: SliceResult;
  };
}

export interface SliceOptions extends EvaluationOptions {
  // REQUIRED here and optional on EvaluationOptions, and the asymmetry is the guard:
  // a per-cell FPR ceiling of the primary family is decided on the simultaneous bound
  // drawn INSIDE its own slice, so a slice set built without the divisor publishes no
  // simultaneous bound at all and every one of those hypotheses reaches
  // benchmark/gates.ts as missing evidence — a wiring mistake shaped exactly like a
  // breached budget. Omitting it has to stop compiling, not produce a report.
  preRegisteredStatisticalGates: number;
  // The generator families reserved to the blocked test as unseen, from the
  // split. A record's generator family is "unseen" when it is in this set.
  // Canonical values only (benchmark/generator-family.ts): the nominal type is
  // what stops this set from being matched against `generation.family`, the
  // provider's dotted label — the bug that left this axis with no `unseen`
  // bucket at all, reporting every record seeded to measure an unseen generator
  // as seen.
  heldOutGeneratorFamilies: readonly GeneratorFamily[];
  // Sampling floors. Default to the PRE-REGISTERED power floors; a caller may raise
  // them for a narrower question but never has to restate them to get the frozen
  // ones.
  minimumFprNegatives?: number;
  minimumRecallPositives?: number;
}

// The floors are rows of the frozen pre-registration, not §6.4 minima this module
// may choose: `criticalFprHumanNegatives` is the denominator floor of every per-cell
// FPR ceiling the release certifies, and the same number is the `n` the published
// zero-event ceiling is computed at. A literal here would be a second copy of a
// value the pre-registration already cross-checks against that ceiling.
const DEFAULT_MINIMUM_FPR_NEGATIVES =
  PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives;
const DEFAULT_MINIMUM_RECALL_POSITIVES =
  PREREGISTRATION_V4.powerFloors.criticalRecallPositives;

const AXIS_ORDER: readonly SliceAxis[] = [
  "lengthBucket",
  "domain",
  "humanSourceType",
  "temporalCohort",
  "hardNegativeFamily",
  "generatorExposure",
  "transformation",
  "severity",
  "mixedFraction",
];

// Which axes can gate an FPR budget (they need human negatives) and which can
// gate a recall floor (they need positives). Mirrors benchmark/split-audit.ts,
// extended with `severity`, a recall axis: transformation severity characterizes
// how hard the positives are to catch.
const FPR_AXES: ReadonlySet<SliceAxis> = new Set([
  "lengthBucket",
  "domain",
  "humanSourceType",
  "temporalCohort",
  "hardNegativeFamily",
]);
const RECALL_AXES: ReadonlySet<SliceAxis> = new Set([
  "lengthBucket",
  "domain",
  "generatorExposure",
  "transformation",
  "severity",
  "mixedFraction",
]);

export function buildSlices(
  items: readonly EvaluationItem[],
  options: SliceOptions,
): SliceResult[] {
  const minimumFprNegatives =
    options.minimumFprNegatives ?? DEFAULT_MINIMUM_FPR_NEGATIVES;
  const minimumRecallPositives =
    options.minimumRecallPositives ?? DEFAULT_MINIMUM_RECALL_POSITIVES;
  const heldOut = new Set(options.heldOutGeneratorFamilies);
  const cohortOf = temporalCohortResolver(items);

  const extractors: Record<
    SliceAxis,
    (record: BenchmarkRecord) => string | undefined
  > = {
    lengthBucket: (record) => sizeBucket(record.wordCount),
    domain: (record) => record.domain,
    humanSourceType: (record) => record.humanSourceType,
    temporalCohort: (record) => cohortOf(record.createdAt),
    hardNegativeFamily: (record) => record.hardNegativeFamily,
    generatorExposure: (record) => {
      const family = generatorFamilyOf(record);
      if (family === undefined) return undefined;
      return heldOut.has(family) ? "unseen" : "seen";
    },
    transformation: (record) => record.transformation.kind,
    severity: (record) => record.transformation.severity,
    // Keyed by COHORT AND fraction (`"<mode>/<bucket>"`, the same identity
    // `MixedFractionSegment.key` uses, built by the same helper). `mixedFraction`
    // is a RECALL axis, so this slice reaches the recall floor that declares a
    // slice gate-eligible and, through profile-artifact.ts, the published
    // `criticalRecallSlices`. A bare fraction key would put a mechanistic and an
    // ecological row of the same band in ONE published slice — the aggregation
    // `materialAssistance.cohortsAggregated: false` forbids — and silently: the
    // pooled slice still looks well-formed while its `sampleSize` counts rows its
    // recall never measured, because an ecological row is a warning positive of
    // nothing. A mixed record with no `mixture` yields no key at all (the schema
    // refuses it) rather than a fraction of zero.
    mixedFraction: (record) => mixedSegmentOf(record)?.key,
  };

  const results: SliceResult[] = [];
  for (const axis of AXIS_ORDER) {
    const buckets = new Map<string, EvaluationItem[]>();
    for (const item of items) {
      const key = extractors[axis](item.record);
      if (key === undefined) continue;
      const bucket = buckets.get(key);
      if (bucket === undefined) buckets.set(key, [item]);
      else bucket.push(item);
    }
    const keys = [...buckets.keys()].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const key of keys) {
      const bucket = buckets.get(key) as EvaluationItem[];
      const metrics = computeEvaluationMetrics(bucket, options);
      // The declared class counts are READ OFF the measured population's own
      // matrix, never recounted over the raw bucket. See SliceResult above for
      // exactly how far that claim goes: they are class counts, and the FPR and
      // precision intervals run over the decided subset of them.
      // `computeEvaluationMetrics` measures the decision matrix over the eligible
      // subset only, so counting `bucket.filter(isHumanNegative)` here would
      // publish a denominator larger than the one behind the interval —
      // advertising statistical power that does not exist, in the favorable
      // direction — and would let a slice be declared gate-eligible on rows its
      // FPR was never measured over. These two numbers are consumed as
      // `GateResult.sampleSize` (benchmark/gates.ts) and as
      // `ProportionGateEvidenceV1.sampleSize` in the sealed profile
      // (benchmark/profile-artifact.ts), so they are a contract, not a display.
      // The end-to-end family is deliberate, and BOTH reads below are pinned by
      // that test — its fixture has an errored eligible row in each class, so
      // swapping either line to `conditionalOnScored` fails. Reading the
      // conditional family here would drop the errored rows and shrink the
      // declared population in the flattering direction: for `negatives` it
      // understates the FPR floor, and for `positives` it can push a recall
      // slice below the floor so it stops gating altogether.
      const positives = metrics.warning.endToEnd.positives;
      const negatives = metrics.warning.endToEnd.negatives;
      results.push({
        axis,
        key,
        // Descriptive: every row that landed in the bucket, eligible or not.
        sampleSize: bucket.length,
        positives,
        negatives,
        fprGateEligible: FPR_AXES.has(axis) && negatives >= minimumFprNegatives,
        recallGateEligible:
          RECALL_AXES.has(axis) && positives >= minimumRecallPositives,
        fprNegativeFloor: minimumFprNegatives,
        recallPositiveFloor: minimumRecallPositives,
        metrics,
      });
    }
  }
  return results;
}

export function summarizeSlices(slices: readonly SliceResult[]): SliceSummary {
  const withVisual = slices.filter(
    (slice) => slice.metrics.visualAction !== null,
  );

  const worst: SliceSummary["worst"] = {};
  const worstWarningFpr = worstBy(
    slices.filter((slice) => slice.fprGateEligible),
    (slice) => slice.metrics.warning.endToEnd.falsePositiveRate.value,
    "max",
  );
  const worstWarningRecall = worstBy(
    slices.filter((slice) => slice.recallGateEligible),
    (slice) => slice.metrics.warning.endToEnd.recall.value,
    "min",
  );
  const worstActionFpr = worstBy(
    slices.filter(
      (slice) => slice.fprGateEligible && slice.metrics.visualAction !== null,
    ),
    (slice) => actionFprValue(slice),
    "max",
  );
  const worstActionRecall = worstBy(
    slices.filter(
      (slice) =>
        slice.recallGateEligible && slice.metrics.visualAction !== null,
    ),
    (slice) => actionRecallValue(slice),
    "min",
  );
  if (worstWarningFpr !== undefined) worst.warningFpr = worstWarningFpr;
  if (worstWarningRecall !== undefined)
    worst.warningRecall = worstWarningRecall;
  if (worstActionFpr !== undefined) worst.actionFpr = worstActionFpr;
  if (worstActionRecall !== undefined) worst.actionRecall = worstActionRecall;

  return {
    slices: [...slices],
    macro: {
      warningFpr: meanFinite(
        slices.map(
          (slice) => slice.metrics.warning.endToEnd.falsePositiveRate.value,
        ),
      ),
      warningRecall: meanFinite(
        slices.map((slice) => slice.metrics.warning.endToEnd.recall.value),
      ),
      actionFpr:
        withVisual.length === 0
          ? null
          : meanFinite(withVisual.map((slice) => actionFprValue(slice))),
      actionRecall:
        withVisual.length === 0
          ? null
          : meanFinite(withVisual.map((slice) => actionRecallValue(slice))),
    },
    worst,
  };
}

function actionFprValue(slice: SliceResult): number {
  return slice.metrics.visualAction === null
    ? Number.NaN
    : slice.metrics.visualAction.endToEnd.falsePositiveRate.value;
}

function actionRecallValue(slice: SliceResult): number {
  return slice.metrics.visualAction === null
    ? Number.NaN
    : slice.metrics.visualAction.endToEnd.recall.value;
}

function meanFinite(values: readonly number[]): number {
  const finite = values.filter((value) => Number.isFinite(value));
  if (finite.length === 0) return Number.NaN;
  return finite.reduce((total, value) => total + value, 0) / finite.length;
}

function worstBy(
  slices: readonly SliceResult[],
  value: (slice: SliceResult) => number,
  direction: "max" | "min",
): SliceResult | undefined {
  let best: SliceResult | undefined;
  let bestValue =
    direction === "max" ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  for (const slice of slices) {
    const current = value(slice);
    if (!Number.isFinite(current)) continue;
    if (direction === "max" ? current > bestValue : current < bestValue) {
      bestValue = current;
      best = slice;
    }
  }
  return best;
}

// Four temporal cohorts over the min/max createdAt window of the item set,
// matching benchmark/split-audit.ts so slices and audit agree on cohort labels.
function temporalCohortResolver(
  items: readonly EvaluationItem[],
): (createdAt: number) => string {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const item of items) {
    const createdAt = item.record.createdAt;
    if (createdAt < min) min = createdAt;
    if (createdAt > max) max = createdAt;
  }
  const span = max - min;
  return (createdAt: number): string => {
    if (span <= 0) return "cohort-0";
    const index = Math.min(3, Math.floor(((createdAt - min) / span) * 4));
    return `cohort-${index}`;
  };
}
