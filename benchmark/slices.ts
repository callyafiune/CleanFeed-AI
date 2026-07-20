// Risk slices, macro-average and worst-slice for the v2 benchmark report.
//
// Each slice is a subset of the holdout along one axis (the §6.4 critical slices
// plus transformation severity), carrying its full EvaluationMetrics and the
// sampling-floor verdict: an FPR slice can gate a release only with at least 300
// human negatives; a recall slice only with at least 200 positives. Under-powered
// slices stay in the report but are flagged non-gating rather than silently
// dropped, and the worst-slice search considers only gate-eligible slices so a
// tiny, noisy slice never becomes the reported worst case.
//
// Standalone module: MUST NOT import from the extension bundle (src/). Pure and
// deterministic apart from the caller-supplied bootstrap seed. Sibling imports
// use explicit .ts extensions for Node's native TypeScript execution.

import {
  computeEvaluationMetrics,
  isHumanNegative,
  isWarningPositive,
  mixedFractionBucket,
  sizeBucket,
  type EvaluationItem,
  type EvaluationMetrics,
  type EvaluationOptions,
} from "./metrics.ts";
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
  sampleSize: number;
  positives: number;
  negatives: number;
  fprGateEligible: boolean;
  recallGateEligible: boolean;
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
  // The generator families reserved to the blocked test as unseen, from the
  // split. A record's generator family is "unseen" when it is in this set.
  heldOutGeneratorFamilies: readonly string[];
  // Sampling floors. Default to the §6.4 minima of 300 negatives / 200 positives.
  minimumFprNegatives?: number;
  minimumRecallPositives?: number;
}

const DEFAULT_MINIMUM_FPR_NEGATIVES = 300;
const DEFAULT_MINIMUM_RECALL_POSITIVES = 200;

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
    generatorExposure: (record) =>
      record.generation === undefined
        ? undefined
        : heldOut.has(record.generation.family)
          ? "unseen"
          : "seen",
    transformation: (record) => record.transformation.kind,
    severity: (record) => record.transformation.severity,
    mixedFraction: (record) =>
      record.label === "mixed"
        ? mixedFractionBucket(record.mixture?.aiFraction ?? 0)
        : undefined,
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
    const keys = [...buckets.keys()].sort((a, b) => a.localeCompare(b));
    for (const key of keys) {
      const bucket = buckets.get(key) as EvaluationItem[];
      const positives = bucket.filter((item) =>
        isWarningPositive(item.record),
      ).length;
      const negatives = bucket.filter((item) =>
        isHumanNegative(item.record),
      ).length;
      results.push({
        axis,
        key,
        sampleSize: bucket.length,
        positives,
        negatives,
        fprGateEligible: FPR_AXES.has(axis) && negatives >= minimumFprNegatives,
        recallGateEligible:
          RECALL_AXES.has(axis) && positives >= minimumRecallPositives,
        metrics: computeEvaluationMetrics(bucket, options),
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
    (slice) => slice.metrics.warning.falsePositiveRate.value,
    "max",
  );
  const worstWarningRecall = worstBy(
    slices.filter((slice) => slice.recallGateEligible),
    (slice) => slice.metrics.warning.recall.value,
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
        slices.map((slice) => slice.metrics.warning.falsePositiveRate.value),
      ),
      warningRecall: meanFinite(
        slices.map((slice) => slice.metrics.warning.recall.value),
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
    : slice.metrics.visualAction.falsePositiveRate.value;
}

function actionRecallValue(slice: SliceResult): number {
  return slice.metrics.visualAction === null
    ? Number.NaN
    : slice.metrics.visualAction.recall.value;
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
