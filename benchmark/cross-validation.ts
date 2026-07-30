// Cross-validation for calibrator selection, ATOMISED BY THE SPLIT/EXPOSURE
// CLUSTER — the connected component of the union of the applicable grouping axes.
//
// The header this file carried until C6 said "author-grouped … the same
// author-as-atom discipline", and it was false twice over. `groups.author` is
// `notApplicable` on every generated row BY RULE (generated text has no human
// author) and was one singleton per row on the v2 corpus, so an author-keyed fold
// was a per-record-line fold: the folds were random by row and the calibrator this
// module returns inherited that degeneration (assessment §3.6). And the atom was
// never the author to begin with — a thread, a page, a prompt template, a
// collection batch or a lineage seed makes two rows dependent without their sharing
// an author at all.
//
// What this module contracts now, stated as what is measured (R7) and not as a
// property:
//
//   * The ATOM is the split/exposure cluster, taken from `clusterAssignments`
//     (benchmark/cluster-exposure-ledger.ts, which delegates to
//     `connectedComponentRoots`). No connectivity is re-derived here. A whole
//     cluster lands in exactly ONE fold's validation half, so no cluster spans a
//     fold's train and validation halves — and therefore no author, source,
//     domainSource, prompt template, generator version, collection batch,
//     near-duplicate group or lineage parent spans them either, because each of
//     those relations is already closed over inside the component. That is why
//     there is NO second, hierarchical cross-validation: the component subsumes it.
//   * `unknown` on any axis the component is built from FAILS, because a row whose
//     author or thread was not recovered may belong to a cluster nobody can name,
//     and a fold built over it would silently train on its own validation half.
//     `notApplicable` does NOT fail: it is a legitimate state and R6 forbids
//     treating it as a defect.
//   * The number of folds is the frozen one, read from
//     `benchmark/rebuild-v3-policy.json` (`calibrator.crossValidationFolds`), and
//     the fold of a cluster is a function of the seeded digest of its PSEUDONYMISED
//     root id under the frozen CV seed (`seeds.crossValidation`) — so the same
//     population yields the same folds bit for bit, in any input order.
//   * Class stratification with atoms of unequal size is a packing problem, not a
//     partition. The packing is greedy and deterministic, and what it ACHIEVED is
//     published beside the deviation no packing of these atoms could have beaten
//     ({@link FoldStratification}). Nothing here claims the folds are balanced.
//
// Selection rule (classifier design §6.5): score every family on out-of-fold
// predictions aggregated with EQUAL WEIGHT PER CLUSTER, drop any candidate whose
// ECE-15 exceeds 0.05, and take the smallest Brier among the survivors; a Brier tie
// within 0.002 favours Platt. The chosen family is then REFIT on the full
// calibration split (never on test). Restructuring the selection across the
// `cal-A`/`cal-B` partitions is G1's and is deliberately not done here.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { createHash } from "node:crypto";

import {
  applyCalibrator,
  fitCalibrator,
  type CalibrationSample,
  type CalibratorKind,
} from "./calibrators.ts";
import { clusterAssignments } from "./cluster-exposure-ledger.ts";
import { REBUILD_V3_POLICY } from "./rebuild-v3-policy.ts";
import {
  groupAxisDeclaredState,
  isPseudonymToken,
  type BenchmarkRecord,
} from "./schema.ts";
import { CONNECTIVITY_AXES } from "./split.ts";
import type { SerializedCalibratorV1 } from "../contracts/calibration-profile.ts";

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

/**
 * The frozen fold count and CV seed, read from the policy and never written down
 * as a constant here: `benchmark/rebuild-v3-policy.json` is the single place the
 * settled values of the rebuild live (A6).
 */
const FOLD_COUNT = REBUILD_V3_POLICY.calibrator.crossValidationFolds;
const CV_SEED = REBUILD_V3_POLICY.seeds.crossValidation;

/**
 * The axes the split/exposure cluster is built from, and therefore the axes whose
 * `unknown` state makes the cluster of a row unknowable. Imported from the splitter
 * so the CV cannot come to name a different set than the connectivity it consumes.
 */
export const CLUSTER_ATOM_AXES = CONNECTIVITY_AXES;

/** One record-line's calibration sample, tagged with the atom it belongs to. */
export interface ClusteredCalibrationSample extends CalibrationSample {
  /** The record-line id, a pseudonymised token. */
  id: string;
  /**
   * The root of this row's split/exposure cluster, as `clusterRootsOf` produced
   * it. It is itself a record-line id, hence also a pseudonym — which is what makes
   * it safe to seed a digest with.
   */
  clusterRoot: string;
}

export interface CalibrationFold {
  train: ClusteredCalibrationSample[];
  validation: ClusteredCalibrationSample[];
}

/**
 * An atom whose share of one class is bigger than a single fold's ideal share, so
 * no packing of these atoms can balance that class across the folds. Published
 * rather than absorbed: the measured deviation next to it is then a property of the
 * corpus, and a reader who cannot see the oversized atom would read it as the
 * packer's failure.
 */
export interface OversizedCluster {
  clusterRoot: string;
  label: 0 | 1;
  /** Record-lines of this label inside the atom. */
  records: number;
  /** `total / folds`, the share one fold would hold under a perfect packing. */
  idealPerFold: number;
}

/** What the packing achieved for one class, and what it could have achieved. */
export interface FoldClassBalance {
  label: 0 | 1;
  /** Record-lines of this label over the whole population. */
  total: number;
  /** Record-lines of this label in each fold's VALIDATION half, in fold order. */
  perFold: readonly number[];
  /** `max |perFold[i]/total - 1/folds|`, the measured imbalance in share units. */
  deviation: number;
  /**
   * The smallest deviation ANY packing of these atoms could reach, from two terms
   * that are both derived and neither invented: the largest atom's excess over one
   * fold's ideal share, plus the residue of a total that is not a multiple of the
   * fold count. It is a FLOOR on what is possible, not a promise about the greedy
   * packing — which is why {@link withinAttainable} is measured and published
   * instead of asserted.
   */
  attainable: number;
  withinAttainable: boolean;
}

/** The fold design as it came out over one population. */
export interface FoldStratification {
  folds: number;
  seed: number;
  clusters: number;
  items: number;
  balance: readonly FoldClassBalance[];
  oversizedClusters: readonly OversizedCluster[];
}

export interface ClusteredFolds {
  folds: CalibrationFold[];
  stratification: FoldStratification;
}

/** The minimal shape the pure selection rule needs from each candidate. */
export interface CandidateScore {
  kind: CalibratorKind;
  brier: number;
  ece15: number;
}

export interface CandidateCalibrationSummary extends CandidateScore {
  /** The frozen fold count this candidate was scored over. */
  foldCount: number;
  /** Distinct atoms the out-of-fold aggregation weighted equally. */
  clusterCount: number;
}

export interface SelectedCalibrator {
  model: SerializedCalibratorV1;
  selection: CandidateCalibrationSummary;
  candidates: CandidateCalibrationSummary[];
  stratification: FoldStratification;
}

/** Coded, fail-closed error thrown by the calibrator selection. */
export class CalibrationSelectionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationSelectionError";
  }
}

/**
 * A fold design that cannot be built over this population, or an atom that cannot
 * be named, raised instead of quietly cross-validating something weaker.
 *
 * It is NOT `ResamplingUnitError` (benchmark/bootstrap.ts) even though it enforces
 * the same R6 rule, and the reason is the glossary's: that error names an estimand
 * and a RESAMPLING UNIT, which is chosen per estimand and is not this. Reusing it
 * would state that the split/exposure cluster is a resampling unit. The rule itself
 * is not duplicated — both read the three axis states through the schema's own
 * accessors and neither re-implements them.
 */
export class ClusterFoldError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`CROSS_VALIDATION_${code}: ${message}`);
    this.name = "ClusterFoldError";
    this.code = code;
  }
}

/**
 * The split/exposure cluster root of every record-line, refusing any row that
 * declares `unknown` on an axis the cluster is built from.
 *
 * This is the only sanctioned way to produce the `clusterRoot` a
 * {@link ClusteredCalibrationSample} carries, which is what makes the refusal part
 * of the CV path rather than advice to a caller. Connectivity itself is C3's and is
 * not recomputed: {@link clusterAssignments} delegates to `connectedComponentRoots`,
 * the single definition in the benchmark.
 */
export function clusterRootsOf(
  records: readonly BenchmarkRecord[],
): Map<string, string> {
  for (const record of records) {
    for (const axis of CLUSTER_ATOM_AXES) {
      if (groupAxisDeclaredState(record, axis) !== "unknown") continue;
      throw new ClusterFoldError(
        "AXIS_UNKNOWN",
        `record-line "${record.id}" declares groups.${axis} unknown, so the split/exposure ` +
          "cluster it belongs to cannot be named and a fold over it would train on its own " +
          "validation half; notApplicable is a legitimate state here and unknown is not",
      );
    }
  }
  return clusterAssignments(records).rootById;
}

interface Atom {
  clusterRoot: string;
  members: ClusteredCalibrationSample[];
  positives: number;
  negatives: number;
  hash: string;
}

interface FoldAccumulator {
  validation: ClusteredCalibrationSample[];
  positives: number;
  negatives: number;
  total: number;
}

/**
 * Packs the atoms into exactly the frozen number of class-stratified folds.
 *
 * There is no fold-count parameter: the count is the frozen one. The seed IS a
 * parameter, so the determinism is testable and the caller that matters
 * ({@link selectCalibrator}) passes the frozen CV seed rather than a fit seed.
 *
 * Atoms are ordered by size descending, then by the seeded digest of their
 * pseudonymised root id, then by that id; each is placed in the fold with the
 * smallest running `[positives, negatives, total, foldIndex]`. Size-first ordering
 * is what keeps a big atom from arriving last and forcing the whole imbalance onto
 * one fold, and the digest is what makes the order independent of arrival order.
 */
export function createClusteredFolds(
  samples: readonly ClusteredCalibrationSample[],
  seed: number,
): ClusteredFolds {
  if (samples.length === 0) {
    throw new ClusterFoldError(
      "EMPTY_POPULATION",
      "cross-validation requires at least one record-line",
    );
  }

  const byRoot = new Map<string, Atom>();
  for (const sample of samples) {
    // The digest below is seeded with this id, so the pseudonymised FORM is
    // asserted rather than assumed: a raw identifier must never reach a hash that
    // is published or compared.
    if (!isPseudonymToken(sample.clusterRoot)) {
      throw new ClusterFoldError(
        "IDENTITY_NOT_PSEUDONYM",
        `cluster root ${JSON.stringify(sample.clusterRoot)} of record-line "${sample.id}" ` +
          "is not a pseudonymised token, so it is not an identity this module may hash",
      );
    }
    let atom = byRoot.get(sample.clusterRoot);
    if (atom === undefined) {
      atom = {
        clusterRoot: sample.clusterRoot,
        members: [],
        positives: 0,
        negatives: 0,
        hash: createHash("sha256")
          .update(`${seed}:${sample.clusterRoot}`, "utf8")
          .digest("hex"),
      };
      byRoot.set(sample.clusterRoot, atom);
    }
    atom.members.push(sample);
    if (sample.label === 1) atom.positives += 1;
    else atom.negatives += 1;
  }

  if (byRoot.size < FOLD_COUNT) {
    throw new ClusterFoldError(
      "CLUSTERS_BELOW_FOLDS",
      `${byRoot.size} cluster(s) cannot fill ${FOLD_COUNT} folds while staying indivisible; ` +
        "splitting an atom would put a cluster on both sides of a fold, and running fewer " +
        "folds would silently change the frozen design",
    );
  }

  const labels: (0 | 1)[] = [];
  for (const label of [0, 1] as const) {
    if (samples.some((sample) => sample.label === label)) labels.push(label);
  }
  for (const label of labels) {
    const holders = [...byRoot.values()].filter((atom) =>
      label === 1 ? atom.positives > 0 : atom.negatives > 0,
    ).length;
    if (holders < FOLD_COUNT) {
      throw new ClusterFoldError(
        "CLASS_CLUSTERS_BELOW_FOLDS",
        `label ${label} lives in ${holders} cluster(s), fewer than ${FOLD_COUNT} clusters, so it ` +
          `cannot reach every fold's validation half; the folds would not be stratified by class`,
      );
    }
  }

  const ordered = [...byRoot.values()].sort((a, b) => {
    if (a.members.length !== b.members.length) {
      return b.members.length - a.members.length;
    }
    if (a.hash !== b.hash) return a.hash < b.hash ? -1 : 1;
    return a.clusterRoot < b.clusterRoot
      ? -1
      : a.clusterRoot > b.clusterRoot
        ? 1
        : 0;
  });

  const accumulators: FoldAccumulator[] = Array.from(
    { length: FOLD_COUNT },
    () => ({ validation: [], positives: 0, negatives: 0, total: 0 }),
  );
  for (const atom of ordered) {
    // Ascending scan keeps the lowest foldIndex on a full [pos,neg,total] tie,
    // which is the last element of the balancing tuple.
    let bestIndex = 0;
    for (let index = 1; index < FOLD_COUNT; index += 1) {
      if (foldIsLighter(accumulators[index], accumulators[bestIndex])) {
        bestIndex = index;
      }
    }
    const target = accumulators[bestIndex];
    target.validation.push(...atom.members);
    target.positives += atom.positives;
    target.negatives += atom.negatives;
    target.total += atom.members.length;
  }

  const folds = accumulators.map((accumulator) => {
    const validationClusters = new Set(
      accumulator.validation.map((sample) => sample.clusterRoot),
    );
    return {
      train: samples.filter(
        (sample) => !validationClusters.has(sample.clusterRoot),
      ),
      validation: accumulator.validation,
    };
  });

  for (const [index, fold] of folds.entries()) {
    if (fold.validation.length === 0 || fold.train.length === 0) {
      throw new ClusterFoldError(
        "FOLD_HALF_EMPTY",
        `fold ${index} has ${fold.train.length} training and ${fold.validation.length} ` +
          "validation record-line(s); an empty half is a fold that contributes no " +
          "out-of-fold prediction, which is a smaller design wearing the frozen one's name",
      );
    }
    for (const label of labels) {
      if (fold.train.some((sample) => sample.label === label)) continue;
      throw new ClusterFoldError(
        "TRAIN_MISSING_LABEL",
        `fold ${index} has no label ${label} in its training half, so its calibrator would be ` +
          "fitted on a single class",
      );
    }
  }

  return {
    folds,
    stratification: {
      folds: FOLD_COUNT,
      seed,
      clusters: byRoot.size,
      items: samples.length,
      balance: labels.map((label) =>
        classBalance(label, samples, [...byRoot.values()], accumulators),
      ),
      oversizedClusters: oversized(labels, samples, [...byRoot.values()]),
    },
  };
}

function labelCount(atom: Atom, label: 0 | 1): number {
  return label === 1 ? atom.positives : atom.negatives;
}

function classBalance(
  label: 0 | 1,
  samples: readonly ClusteredCalibrationSample[],
  atoms: readonly Atom[],
  accumulators: readonly FoldAccumulator[],
): FoldClassBalance {
  const total = samples.filter((sample) => sample.label === label).length;
  const perFold = accumulators.map((accumulator) =>
    label === 1 ? accumulator.positives : accumulator.negatives,
  );
  const idealShare = 1 / FOLD_COUNT;
  let deviation = 0;
  for (const count of perFold) {
    const error = Math.abs(count / total - idealShare);
    if (error > deviation) deviation = error;
  }
  const largest = Math.max(...atoms.map((atom) => labelCount(atom, label)));
  const attainable =
    Math.max(0, largest / total - idealShare) +
    (FOLD_COUNT - 1) / (FOLD_COUNT * total);
  return {
    label,
    total,
    perFold,
    deviation,
    attainable,
    withinAttainable: deviation <= attainable,
  };
}

function oversized(
  labels: readonly (0 | 1)[],
  samples: readonly ClusteredCalibrationSample[],
  atoms: readonly Atom[],
): OversizedCluster[] {
  const found: OversizedCluster[] = [];
  for (const label of labels) {
    const total = samples.filter((sample) => sample.label === label).length;
    const idealPerFold = total / FOLD_COUNT;
    for (const atom of atoms) {
      const records = labelCount(atom, label);
      if (records <= idealPerFold) continue;
      found.push({
        clusterRoot: atom.clusterRoot,
        label,
        records,
        idealPerFold,
      });
    }
  }
  return found.sort((a, b) =>
    a.label !== b.label
      ? a.label - b.label
      : a.clusterRoot < b.clusterRoot
        ? -1
        : a.clusterRoot > b.clusterRoot
          ? 1
          : 0,
  );
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

/** One out-of-fold prediction, carrying the atom it must be weighted under. */
export interface OutOfFoldPrediction {
  id: string;
  clusterRoot: string;
  prediction: number;
  label: 0 | 1;
}

export interface OutOfFoldAggregate {
  brier: number;
  ece15: number;
  clusters: number;
  items: number;
}

/**
 * Brier and ECE-15 over out-of-fold predictions with EQUAL WEIGHT PER CLUSTER —
 * the aggregation rule the frozen contract states for the calibrator competition
 * ("menor Brier OOF agregado com pesos iguais por cluster").
 *
 * It lives here, with the fold construction, because this is where the out-of-fold
 * predictions are produced; `benchmark/calibration-pipeline.ts` consumes the score,
 * not the rows. Row weighting would let one fat atom decide the competition: a
 * cluster of 400 near-identical university answers would outvote 40 clusters of 10,
 * which is the same degeneration in the aggregation that per-row folds were in the
 * partition.
 *
 * A cluster's contribution is the MEAN over its own record-lines, so the aggregate
 * is the unweighted mean over clusters. ECE-15 uses the same weights: each row
 * carries `1 / (clusters * rows in its cluster)` into its bin, and the bins are
 * fixed-width over [0, 1] (the equal-mass binning of the release gate is
 * `calibrationGate.eceBinning` and belongs to the gate, not to this selection).
 */
export function aggregateOutOfFold(
  predictions: readonly OutOfFoldPrediction[],
): OutOfFoldAggregate {
  const byCluster = new Map<string, OutOfFoldPrediction[]>();
  for (const prediction of predictions) {
    const bucket = byCluster.get(prediction.clusterRoot);
    if (bucket === undefined)
      byCluster.set(prediction.clusterRoot, [prediction]);
    else bucket.push(prediction);
  }
  const clusters = byCluster.size;
  if (clusters === 0) {
    return {
      brier: Number.POSITIVE_INFINITY,
      ece15: Number.POSITIVE_INFINITY,
      clusters: 0,
      items: 0,
    };
  }

  let brier = 0;
  const bins = Array.from({ length: ECE_BINS }, () => ({
    predictionSum: 0,
    labelSum: 0,
    weight: 0,
  }));
  for (const bucket of byCluster.values()) {
    const rowWeight = 1 / (clusters * bucket.length);
    let squared = 0;
    for (const { prediction, label } of bucket) {
      squared += (prediction - label) ** 2;
      const clamped = Math.min(1, Math.max(0, prediction));
      const index = Math.min(ECE_BINS - 1, Math.floor(clamped * ECE_BINS));
      const bin = bins[index];
      bin.predictionSum += clamped * rowWeight;
      bin.labelSum += label * rowWeight;
      bin.weight += rowWeight;
    }
    brier += squared / bucket.length / clusters;
  }

  let ece15 = 0;
  for (const bin of bins) {
    if (bin.weight === 0) continue;
    const averagePrediction = bin.predictionSum / bin.weight;
    const averageLabel = bin.labelSum / bin.weight;
    ece15 += bin.weight * Math.abs(averagePrediction - averageLabel);
  }

  return { brier, ece15, clusters, items: predictions.length };
}

/**
 * Runs the frozen-count, cluster-atomised CV under the frozen CV seed, scores each
 * family on its out-of-fold predictions with equal weight per cluster, applies the
 * selection rule and refits the winner on the FULL calibration split (never on
 * test).
 *
 * There is no seed parameter on purpose. The fold assignment is a frozen decision
 * (`seeds.crossValidation`), and the caller used to pass the FIT seed here, which
 * made the folds — and so the selected calibrator — move with a number that is not
 * the one the contract froze for them.
 */
export function selectCalibrator(
  samples: readonly ClusteredCalibrationSample[],
): SelectedCalibrator {
  if (samples.length === 0) {
    throw new CalibrationSelectionError(
      "selectCalibrator requires at least one sample",
    );
  }
  const { folds, stratification } = createClusteredFolds(samples, CV_SEED);

  const candidates: CandidateCalibrationSummary[] = FAMILIES.map((kind) => {
    const outOfFold: OutOfFoldPrediction[] = [];
    for (const fold of folds) {
      const model = fitCalibrator(kind, fold.train);
      for (const sample of fold.validation) {
        outOfFold.push({
          id: sample.id,
          clusterRoot: sample.clusterRoot,
          prediction: applyCalibrator(model, sample.rawScore),
          label: sample.label,
        });
      }
    }
    const aggregate = aggregateOutOfFold(outOfFold);
    return {
      kind,
      brier: aggregate.brier,
      ece15: aggregate.ece15,
      foldCount: stratification.folds,
      clusterCount: aggregate.clusters,
    };
  });

  const selection = selectCandidateSummary(candidates);
  const model = fitCalibrator(selection.kind, samples);
  return { model, selection, candidates, stratification };
}
