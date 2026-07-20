// Author-grouped cross-validation and calibrator selection for the Phase 2
// benchmark. Five disjoint folds are formed so that NO author ever spans a
// fold's train and validation halves — the same author-as-atom discipline the
// canonical union enforces upstream — and the winner among Platt, beta and
// isotonic is chosen from strictly out-of-fold predictions.
//
// Selection rule (classifier design §6.5): score every family on concatenated
// out-of-fold predictions, drop any candidate whose ECE-15 exceeds 0.05, and
// take the smallest Brier among the survivors; a Brier tie within 0.002 favours
// Platt. The chosen family is then REFIT on the full calibration split (never on
// test). Everything is deterministic given the recorded seed.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { createHash } from "node:crypto";

import {
  applyCalibrator,
  fitCalibrator,
  type CalibrationSample,
  type CalibratorKind,
} from "./calibrators.ts";
import type { SerializedCalibratorV1 } from "../contracts/calibration-profile.ts";

const FOLD_COUNT = 5;
const ECE_BINS = 15;
const ECE_MAXIMUM = 0.05;
const PLATT_PREFERENCE_MARGIN = 0.002;
const FAMILIES: readonly CalibratorKind[] = ["platt", "beta", "isotonic"];
// Deterministic tie-break order when Briers are equal outside the Platt margin.
const KIND_RANK: Record<CalibratorKind, number> = {
  platt: 0,
  beta: 1,
  isotonic: 2,
};

export interface GroupedCalibrationSample extends CalibrationSample {
  id: string;
  authorGroup: string;
}

export interface CalibrationFold {
  train: GroupedCalibrationSample[];
  validation: GroupedCalibrationSample[];
}

/** The minimal shape the pure selection rule needs from each candidate. */
export interface CandidateScore {
  kind: CalibratorKind;
  brier: number;
  ece15: number;
}

export interface CandidateCalibrationSummary extends CandidateScore {
  foldCount: 5;
}

export interface SelectedCalibrator {
  model: SerializedCalibratorV1;
  selection: CandidateCalibrationSummary;
  candidates: CandidateCalibrationSummary[];
}

/** Coded, fail-closed error thrown by the calibrator selection. */
export class CalibrationSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationSelectionError";
  }
}

interface FoldAccumulator {
  validation: GroupedCalibrationSample[];
  positives: number;
  negatives: number;
  total: number;
}

/**
 * Splits samples into `foldCount` folds so that a whole author group lands in
 * exactly ONE fold's validation set (and therefore in the train set of the
 * other folds), never split across a single fold's train/validation halves.
 *
 * Groups are ordered by size descending, then by a seeded hash, then by key.
 * Each group is greedily assigned to the fold with the smallest running tuple
 * `[positiveCount, negativeCount, totalCount, foldIndex]` so the folds stay
 * balanced deterministically.
 */
export function createGroupedFolds(
  samples: readonly GroupedCalibrationSample[],
  foldCount: 5,
  seed: number,
): CalibrationFold[] {
  const groups = new Map<string, GroupedCalibrationSample[]>();
  for (const sample of samples) {
    const bucket = groups.get(sample.authorGroup);
    if (bucket === undefined) groups.set(sample.authorGroup, [sample]);
    else bucket.push(sample);
  }

  const ordered = [...groups.entries()]
    .map(([authorGroup, members]) => ({
      authorGroup,
      members,
      positives: members.filter((sample) => sample.label === 1).length,
      negatives: members.filter((sample) => sample.label === 0).length,
      hash: createHash("sha256")
        .update(`${seed}:${authorGroup}`, "utf8")
        .digest("hex"),
    }))
    .sort((a, b) => {
      if (a.members.length !== b.members.length) {
        return b.members.length - a.members.length;
      }
      if (a.hash !== b.hash) return a.hash < b.hash ? -1 : 1;
      return a.authorGroup < b.authorGroup
        ? -1
        : a.authorGroup > b.authorGroup
          ? 1
          : 0;
    });

  const accumulators: FoldAccumulator[] = Array.from(
    { length: foldCount },
    () => ({ validation: [], positives: 0, negatives: 0, total: 0 }),
  );

  for (const group of ordered) {
    // Ascending scan keeps the lowest foldIndex on a full [pos,neg,total] tie,
    // which is the last element of the balancing tuple.
    let bestIndex = 0;
    for (let index = 1; index < foldCount; index += 1) {
      if (foldIsLighter(accumulators[index], accumulators[bestIndex])) {
        bestIndex = index;
      }
    }
    const target = accumulators[bestIndex];
    target.validation.push(...group.members);
    target.positives += group.positives;
    target.negatives += group.negatives;
    target.total += group.members.length;
  }

  return accumulators.map((accumulator) => {
    const validationIds = new Set(
      accumulator.validation.map((sample) => sample.id),
    );
    return {
      train: samples.filter((sample) => !validationIds.has(sample.id)),
      validation: accumulator.validation,
    };
  });
}

function foldIsLighter(
  candidate: FoldAccumulator,
  incumbent: FoldAccumulator,
): boolean {
  if (candidate.positives !== incumbent.positives) {
    return candidate.positives < incumbent.positives;
  }
  if (candidate.negatives !== incumbent.negatives) {
    return candidate.negatives < incumbent.negatives;
  }
  return candidate.total < incumbent.total;
}

/**
 * The pure selection rule over already-scored candidates. Drops any candidate
 * with `ece15 > 0.05`; throws when none survive. Among the survivors it takes
 * the smallest Brier, but a Platt within `0.002` of that minimum is preferred.
 * Ties outside the Platt margin break `platt < beta < isotonic`.
 */
export function selectCandidateSummary<T extends CandidateScore>(
  candidates: readonly T[],
): T {
  const admissible = candidates.filter(
    (candidate) => candidate.ece15 <= ECE_MAXIMUM,
  );
  if (admissible.length === 0) {
    throw new CalibrationSelectionError(
      "no calibrator satisfies ECE-15 <= 0.05",
    );
  }
  const ranked = [...admissible].sort((a, b) => {
    if (a.brier !== b.brier) return a.brier - b.brier;
    return KIND_RANK[a.kind] - KIND_RANK[b.kind];
  });
  const smallestBrier = ranked[0].brier;
  const platt = admissible.find((candidate) => candidate.kind === "platt");
  if (
    platt !== undefined &&
    platt.brier - smallestBrier < PLATT_PREFERENCE_MARGIN
  ) {
    return platt;
  }
  return ranked[0];
}

interface OutOfFoldPrediction {
  prediction: number;
  label: 0 | 1;
}

/**
 * Runs 5-fold author-grouped CV, scores each family on its concatenated
 * out-of-fold predictions, applies the selection rule and refits the winner on
 * the FULL calibration split (never on test). Deterministic for a fixed seed.
 */
export function selectCalibrator(
  samples: readonly GroupedCalibrationSample[],
  seed: number,
): SelectedCalibrator {
  if (samples.length === 0) {
    throw new CalibrationSelectionError(
      "selectCalibrator requires at least one sample",
    );
  }
  const folds = createGroupedFolds(samples, FOLD_COUNT, seed);

  const candidates: CandidateCalibrationSummary[] = FAMILIES.map((kind) => {
    const outOfFold: OutOfFoldPrediction[] = [];
    for (const fold of folds) {
      if (fold.train.length === 0 || fold.validation.length === 0) continue;
      const model = fitCalibrator(kind, fold.train);
      for (const sample of fold.validation) {
        outOfFold.push({
          prediction: applyCalibrator(model, sample.rawScore),
          label: sample.label,
        });
      }
    }
    return {
      kind,
      brier: brierScore(outOfFold),
      ece15: expectedCalibrationError(outOfFold),
      foldCount: FOLD_COUNT,
    };
  });

  const selection = selectCandidateSummary(candidates);
  const model = fitCalibrator(selection.kind, samples);
  return { model, selection, candidates };
}

function brierScore(predictions: readonly OutOfFoldPrediction[]): number {
  if (predictions.length === 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  for (const { prediction, label } of predictions) {
    sum += (prediction - label) ** 2;
  }
  return sum / predictions.length;
}

function expectedCalibrationError(
  predictions: readonly OutOfFoldPrediction[],
): number {
  if (predictions.length === 0) return Number.POSITIVE_INFINITY;
  const bins = Array.from({ length: ECE_BINS }, () => ({
    predictionSum: 0,
    labelSum: 0,
    count: 0,
  }));
  for (const { prediction, label } of predictions) {
    const clamped = Math.min(1, Math.max(0, prediction));
    const index = Math.min(ECE_BINS - 1, Math.floor(clamped * ECE_BINS));
    const bin = bins[index];
    bin.predictionSum += clamped;
    bin.labelSum += label;
    bin.count += 1;
  }
  let ece = 0;
  for (const bin of bins) {
    if (bin.count === 0) continue;
    const averagePrediction = bin.predictionSum / bin.count;
    const averageLabel = bin.labelSum / bin.count;
    ece +=
      (bin.count / predictions.length) *
      Math.abs(averagePrediction - averageLabel);
  }
  return ece;
}
