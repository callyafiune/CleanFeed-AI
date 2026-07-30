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
//   * The lineage half of that sentence has a CONDITION, and it is stated because
//     the fold construction is not evidence of sampling independence (R7):
//     `humanSeed` and `derivationRoot` are PARENT LINKAGE, so they union a row with
//     the row they name and only when that row is present in the same record set.
//     C2 measured 782 of 783 parent references resolving to no assembled row, so two
//     generations grown from one human prompt whose row was never assembled can land
//     in different folds. The exposure ledger reads those two axes more strongly (a
//     value axis in a lineage MAC domain); this module inherits the splitter's weaker
//     reading, on purpose, because it must atomise by the same components the split
//     did. The inheritance is measured by a test rather than left to a reader.
//   * `unknown` on any axis the component is built from FAILS, because a row whose
//     author or thread was not recovered may belong to a cluster nobody can name,
//     and a fold built over it would silently train on its own validation half.
//     `notApplicable` does NOT fail: it is a legitimate state and R6 forbids
//     treating it as a defect.
//   * The number of folds is the frozen one, read from
//     `benchmark/rebuild-v3-policy.json` (`calibrator.crossValidationFolds`), and the
//     fold of a cluster is a deterministic function of the WHOLE POPULATION: atoms
//     are ordered by size, then by the seeded digest of their pseudonymised root id
//     under the frozen CV seed (`seeds.crossValidation`), then by that id, and each is
//     placed in the fold its own class counts leave closest to the per-fold targets.
//     The digest orders the atoms; it does not by itself decide the fold, which also
//     depends on the sizes and class counts of every other atom, and stating it the
//     shorter way would be the kind of almost-true claim this header exists to stop.
//   * DETERMINISM, in the two senses that are not the same claim. Fold MEMBERSHIP is
//     a function of the population and the seed alone and is invariant to input
//     order. Member ORDER inside each half is not free to follow arrival order, and
//     that is why both halves are returned sorted by record-line id: the calibrator
//     fits accumulate floating-point sums over the array, FP addition is not
//     associative, and before the sort a reversed corpus produced a calibrator that
//     differed in the last two digits — so `artifactDigest` moved for the same
//     population. Record-line ids are required to be distinct here for the same
//     reason (`DUPLICATE_ID`): without that, the sort is not a total order and the
//     claim below would again be almost-true. What is claimed, and tested, is that
//     `createClusteredFolds` and `selectCalibrator` are deep-equal under any
//     permutation of their input.
//   * Class stratification with atoms of unequal size is a packing problem, not a
//     partition. The packing is greedy and deterministic, and what it ACHIEVED is
//     published as a measured deviation next to a proven LOWER BOUND on the deviation
//     of any packing ({@link FoldClassBalance}). Nothing here claims the folds are
//     balanced, and nothing publishes a "within tolerance" flag: the earlier field of
//     that name compared the deviation against the SUM of two lower bounds, which is
//     not a lower bound at all — it read 0.08 on a fixture whose measured deviation
//     was 0, so a floor sat above an achieved value.
//
// Selection rule, and the one part of it that is NOT frozen. The frozen calibrator row
// says: "Platt, beta e isotônico em CV agrupada de 5 folds; vence menor Brier OOF;
// empate <= 1e-4 → Platt, beta, isotônico". So `calibrator.candidates`,
// `calibrator.tieToleranceAbsolute` and `calibrator.tieBreakOrder` are read from
// `benchmark/rebuild-v3-policy.json` and implemented literally — the frozen table
// materialised there says code may not repeat its values as loose constants, and this
// module did: it carried a 0.002 "Platt preference margin", 20x the frozen tie
// tolerance, so a Platt 0.0019 worse than the best candidate won on a tie the contract
// does not consider a tie at all.
//
// The ECE admission — dropping a candidate whose out-of-fold ECE exceeds a bound
// BEFORE the Brier comparison — is NOT in that row. It is an additional constraint
// THIS module imposes, it can override the frozen "menor Brier OOF" (a candidate with
// the smallest Brier and an inadmissible ECE loses), and it is kept because a
// calibrator the release gate would reject is not a calibrator worth selecting. Its
// budget is therefore taken from `calibrationGate.eceMax` rather than invented, and
// its bin count and BINNING from `calibrationGate.eceBins`/`eceBinning`, so the
// selection measures the same quantity the gate does under the same binning. It is
// NOT the gate's decision: `calibrationGate.eceBound` is a bootstrap simultaneous
// upper bound and this is a point estimate, which runs BELOW that bound — so passing
// here predicts nothing about passing there, and the direction is stated because the
// reverse reading would be the reassuring one. Whether the admission belongs in the
// frozen table at all is G1's to settle when it restructures the selection across
// `cal-A`/`cal-B`; that restructuring is deliberately not done here.
//
// The chosen family is then REFIT on the full calibration split (never on test).
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

/**
 * Every settled number of the calibrator competition, read from the policy and none
 * of them written down again here: `benchmark/rebuild-v3-policy.json` is the single
 * place the frozen values of the rebuild live (A6), and its own header states that
 * code may not repeat them as loose constants.
 */
const FOLD_COUNT = REBUILD_V3_POLICY.calibrator.crossValidationFolds;
const CV_SEED = REBUILD_V3_POLICY.seeds.crossValidation;
const FAMILIES: readonly CalibratorKind[] =
  REBUILD_V3_POLICY.calibrator.candidates;
const TIE_TOLERANCE = REBUILD_V3_POLICY.calibrator.tieToleranceAbsolute;
const TIE_BREAK_ORDER: readonly CalibratorKind[] =
  REBUILD_V3_POLICY.calibrator.tieBreakOrder;

/**
 * The three fields of the release gate's ECE specification that this module's own
 * admission guard adopts. The guard is not frozen (see the header): the frozen
 * calibrator row ranks by Brier and says nothing about ECE. What is frozen is the
 * gate's budget and estimator, and adopting them is what makes the guard mean
 * "this candidate would not survive release" instead of a number of our choosing.
 *
 * `eceBound` is deliberately NOT read: the gate's bound is a bootstrap simultaneous
 * upper bound and {@link aggregateOutOfFold} computes a point estimate. Reading it
 * would claim this module computes the gate's quantity.
 */
const SELECTION_ECE_BUDGET = REBUILD_V3_POLICY.calibrationGate.eceMax;
const ECE_BINS = REBUILD_V3_POLICY.calibrationGate.eceBins;
const ECE_BINNING = REBUILD_V3_POLICY.calibrationGate.eceBinning;

/**
 * A candidate's position in the frozen tie-break order, refusing a family the order
 * does not name. The policy pins `candidates` and `tieBreakOrder` to the same three
 * families as frozen lists, so an unranked kind means a caller built a summary for a
 * family the contract never admitted — silently sorting it last would let it win a
 * tie.
 */
function tieBreakRank(kind: CalibratorKind): number {
  const rank = TIE_BREAK_ORDER.indexOf(kind);
  if (rank < 0) {
    throw new CalibrationSelectionError(
      `calibrator kind ${JSON.stringify(kind)} is not in the frozen tie-break order ` +
        `[${TIE_BREAK_ORDER.join(", ")}], so a Brier tie involving it has no settled winner`,
    );
  }
  return rank;
}

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

/** What the packing achieved for one class, against what any packing must exceed. */
export interface FoldClassBalance {
  label: 0 | 1;
  /** Record-lines of this label over the whole population. */
  total: number;
  /** Record-lines of this label in each fold's VALIDATION half, in fold order. */
  perFold: readonly number[];
  /** `max |perFold[i]/total - 1/folds|`, the measured imbalance in share units. */
  deviation: number;
  /**
   * A proven LOWER BOUND on the `deviation` of any packing of these atoms — the
   * larger of two bounds, each of which every packing must satisfy on its own:
   *
   *   * the fold that holds the largest atom of this class holds at least that many
   *     record-lines, hence at least `largest/total - 1/folds` of excess share;
   *   * `folds` integers summing to `total` cannot all sit closer to the ideal share
   *     than `max(r, folds - r) / (folds * total)`, with `r = total % folds` — and
   *     that term is exactly 0 when `total` is a multiple of `folds`.
   *
   * The LARGER and not the sum, which is the arithmetic this field used to carry: a
   * sum of two lower bounds is not a lower bound, and it published 0.08 next to a
   * measured deviation of 0 — a floor above an achieved value. It is a bound and not
   * an achievable target: indivisible atoms can make even this bound unreachable, so
   * `deviation >= deviationFloor` is the invariant, never equality.
   */
  deviationFloor: number;
  /**
   * `deviation - deviationFloor`: how much imbalance the greedy packing left above
   * what the atoms make unavoidable. Zero means the packing matched the bound; it is
   * the number that separates "this corpus cannot be balanced" from "this packer did
   * not balance it", which is the whole reason the pair is published.
   */
  excessOverFloor: number;
}

/** The fold design as it came out over one population. */
export interface FoldStratification {
  folds: number;
  seed: number;
  clusters: number;
  items: number;
  /**
   * `clusters === items`: every atom is a single record-line, so these folds are the
   * per-record-line folds of assessment §3.6 wearing the grouped design's name.
   *
   * Published because it cannot be refused. R6 forbids a "no axis may be all
   * singletons" criterion — after pruning, `nearDuplicate` IS all singletons — so a
   * legitimate population can be all singletons and throwing would be wrong. And
   * because {@link clusterRootsOf} cannot force a caller to come through it (see its
   * docstring), this flag is the only thing standing between a synthesised root and
   * a silently degenerate cross-validation. `benchmark/commands/fit.ts` prints it.
   */
  perRecordLineAtoms: boolean;
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
  /**
   * The out-of-fold expected calibration error, as {@link aggregateOutOfFold}
   * measures it. Named `ece` and no longer `ece15`, because the bin count is read
   * from the policy: a field name that hardcodes 15 becomes a lie the day the frozen
   * number moves, and `metrics.ts` already publishes an `ece15` that is a DIFFERENT
   * quantity (equal-width, per-row weights). The bin count and binning that produced
   * this number travel with it in {@link CandidateCalibrationSummary}.
   */
  ece: number;
}

export interface CandidateCalibrationSummary extends CandidateScore {
  /** The frozen fold count this candidate was scored over. */
  foldCount: number;
  /** Distinct atoms the out-of-fold aggregation weighted equally. */
  clusterCount: number;
  /** Bins `ece` was measured over, from `calibrationGate.eceBins`. */
  eceBins: number;
  /** Binning `ece` was measured under, from `calibrationGate.eceBinning`. */
  eceBinning: typeof ECE_BINNING;
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
 * Connectivity itself is C3's and is not recomputed: {@link clusterAssignments}
 * delegates to `connectedComponentRoots`, the single definition in the benchmark.
 *
 * WHAT THIS DOES NOT DO, stated because the docstring here used to claim the
 * opposite: it is not the only way a `clusterRoot` can reach
 * {@link createClusteredFolds}, and the cross-validation cannot tell whether a
 * caller came through here. `ClusteredCalibrationSample.clusterRoot` is a string;
 * the only property the fold builder can check is that it is a pseudonym token, and
 * a record-line's own id satisfies that. So a caller passing `clusterRoot:
 * record.id` gets one atom per record-line — precisely the per-record-line folds of
 * assessment §3.6 — with every guard here passing. Deriving the roots inside the CV
 * is not possible either: the fit pipeline hands it scores, not records.
 *
 * Coming through here is therefore a CALLER OBLIGATION, and the two things that
 * stand in for enforcement are (1) `fit` calling this over the whole corpus, and (2)
 * `FoldStratification.perRecordLineAtoms`, which publishes the degeneracy when the
 * obligation is broken. Refusing `clusters === items` outright is not available: R6
 * forbids a "no axis may be all singletons" criterion, so an all-singleton
 * population can be legitimate.
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
 * pseudonymised root id, then by that id; each is placed in the fold that its own
 * class counts leave closest to the per-fold class targets ({@link bestFoldIndex}).
 * Size-first ordering is what keeps a big atom from arriving last and forcing the
 * whole imbalance onto one fold, and the digest is what makes the order independent
 * of arrival order.
 *
 * Both halves of every fold come back sorted by record-line id, so the returned
 * object — and therefore the calibrator fitted over it — is invariant under any
 * permutation of `samples`. See the determinism bullet in this file's header for the
 * floating-point reason that is not cosmetic.
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

  const seenIds = new Set<string>();
  for (const sample of samples) {
    if (seenIds.has(sample.id)) {
      throw new ClusterFoldError(
        "DUPLICATE_ID",
        `record-line "${sample.id}" appears twice in the cross-validation population; ` +
          "the id is what orders the members of a fold, so a repeated one leaves the " +
          "fold order — and the floating-point sums of the calibrator fit — dependent " +
          "on arrival order",
      );
    }
    seenIds.add(sample.id);
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
  let placedPositives = 0;
  let placedNegatives = 0;
  for (const atom of ordered) {
    placedPositives += atom.positives;
    placedNegatives += atom.negatives;
    const target =
      accumulators[
        bestFoldIndex(
          atom,
          accumulators,
          placedPositives / FOLD_COUNT,
          placedNegatives / FOLD_COUNT,
        )
      ];
    target.validation.push(...atom.members);
    target.positives += atom.positives;
    target.negatives += atom.negatives;
    target.total += atom.members.length;
  }

  const byId = (
    a: ClusteredCalibrationSample,
    b: ClusteredCalibrationSample,
  ): number => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const folds = accumulators.map((accumulator) => {
    const validationClusters = new Set(
      accumulator.validation.map((sample) => sample.clusterRoot),
    );
    return {
      train: samples
        .filter((sample) => !validationClusters.has(sample.clusterRoot))
        .sort(byId),
      validation: [...accumulator.validation].sort(byId),
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
      perRecordLineAtoms: byRoot.size === samples.length,
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
  const floor = deviationFloor(total, largest);
  return {
    label,
    total,
    perFold,
    deviation,
    deviationFloor: floor,
    excessOverFloor: deviation - floor,
  };
}

/**
 * The larger of the two bounds documented on {@link FoldClassBalance.deviationFloor}.
 * The maximum and not the sum: each term is a valid lower bound on its own, and the
 * maximum of two lower bounds is a lower bound while their sum is not.
 */
function deviationFloor(total: number, largest: number): number {
  const idealShare = 1 / FOLD_COUNT;
  const largestExcess = Math.max(0, largest / total - idealShare);
  const residue = total % FOLD_COUNT;
  // Zero when `total` divides evenly: `folds` equal integers then hit the ideal
  // share exactly, and the term the old formula used — `(folds - 1)/(folds*total)`
  // — is the value for `residue === 1` applied to every case.
  const integerResidue =
    residue === 0
      ? 0
      : Math.max(residue, FOLD_COUNT - residue) / (FOLD_COUNT * total);
  return Math.max(largestExcess, integerResidue);
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

/**
 * The fold this atom should join: the one whose class counts, AFTER the atom lands,
 * sit closest to the per-fold targets in squared error. Ties go to the lowest fold
 * index, because the scan is ascending and the comparison strict.
 *
 * The atom's OWN class counts are what make this class-aware, and that is the part
 * the rule this replaced got wrong. It compared the folds' running
 * `[positives, negatives, total]` and ignored what was being placed, which is
 * class-aware only while every atom has the same composition. Measured on ten
 * same-size atoms — five all-positive, five all-negative — it produced negatives per
 * fold of `[3, 3, 6, 3, 0]`: one validation half with no negative at all, at a
 * deviation of 0.2 where 0 was attainable. It filled the folds by positives first
 * and then had no negatives left to place.
 *
 * The targets are PROGRESSIVE — the counts placed SO FAR, this atom included, divided
 * by the fold count — and not the whole population's. Against the final targets every
 * fold is under-filled until the packing is nearly done, so a fold already sitting on
 * target looks exactly as good as an empty one (both are one atom from the target, in
 * opposite directions) and the atoms pile onto the low indices. Measured on fifteen
 * singleton atoms against final targets: fold 0 absorbed five of them and fold 4 got
 * nothing, which `FOLD_HALF_EMPTY` then refuses. Progressive targets ask the right
 * question at each step — "which fold does this atom leave closest to the shape of
 * what has been placed" — and the last placements are compared against the final
 * targets anyway, since by then everything has been placed.
 *
 * Equal class cost is broken by the SMALLER resulting fold and only then by the lower
 * index, so identical atoms spread instead of stacking.
 */
function bestFoldIndex(
  atom: Atom,
  accumulators: readonly FoldAccumulator[],
  targetPositives: number,
  targetNegatives: number,
): number {
  let bestIndex = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestTotal = Number.POSITIVE_INFINITY;
  for (const [index, accumulator] of accumulators.entries()) {
    const positiveError =
      accumulator.positives + atom.positives - targetPositives;
    const negativeError =
      accumulator.negatives + atom.negatives - targetNegatives;
    const cost = positiveError ** 2 + negativeError ** 2;
    const total = accumulator.total + atom.members.length;
    if (cost < bestCost || (cost === bestCost && total < bestTotal)) {
      bestCost = cost;
      bestTotal = total;
      bestIndex = index;
    }
  }
  return bestIndex;
}

/**
 * The pure selection rule over already-scored candidates, in two parts that must not
 * be confused with each other.
 *
 * FROZEN, implemented literally: take the smallest out-of-fold Brier, counting every
 * candidate within `calibrator.tieToleranceAbsolute` of that minimum as TIED and
 * deciding between the tied ones by `calibrator.tieBreakOrder`. The tolerance is
 * symmetric in effect and not a preference for one family: the rule this replaced was
 * "a Platt within 0.002 of the minimum wins", which is a different rule and not merely
 * a looser number. It let Platt take a gap 20x the frozen tolerance, and it could not
 * let `beta` win a genuine tie against a marginally lower `isotonic`, which
 * `tieBreakOrder` says it should.
 *
 * NOT FROZEN, imposed by THIS module: candidates whose `ece` exceeds
 * `calibrationGate.eceMax` are dropped first, and the function throws when that leaves
 * nobody. The frozen calibrator row says only "vence menor Brier OOF" and mentions no
 * ECE, and this guard can OVERRIDE it — a candidate with the smallest Brier and an
 * inadmissible ECE loses to a worse-Brier admissible one. It is kept because a
 * calibrator the release gate would reject is not worth selecting, and its budget is
 * taken from the gate rather than invented. See this file's header for why it is not
 * the gate's decision, and G1 for whether it belongs in the frozen table.
 */
export function selectCandidateSummary<T extends CandidateScore>(
  candidates: readonly T[],
): T {
  // Fail closed on entry rather than let `Math.min` and a `NaN` comparison walk to an
  // empty tie set and return `undefined` under a declared return type of `T`. The
  // exported rule is generic over anything shaped like a candidate, so a caller that
  // is not `selectCalibrator` can reach it with a non-finite score.
  for (const candidate of candidates) {
    if (Number.isFinite(candidate.brier) && Number.isFinite(candidate.ece)) {
      continue;
    }
    throw new CalibrationSelectionError(
      `candidate ${JSON.stringify(candidate.kind)} carries a non-finite score ` +
        `(brier=${candidate.brier}, ece=${candidate.ece}); a competition cannot be ` +
        "decided on one, and coercing it would let the worst candidate win",
    );
  }
  const admissible = candidates.filter(
    (candidate) => candidate.ece <= SELECTION_ECE_BUDGET,
  );
  if (admissible.length === 0) {
    throw new CalibrationSelectionError(
      `no calibrator satisfies the selection's ECE admission (ECE-${ECE_BINS} ` +
        `<= ${SELECTION_ECE_BUDGET})`,
    );
  }
  const smallestBrier = Math.min(
    ...admissible.map((candidate) => candidate.brier),
  );
  const tied = admissible.filter(
    (candidate) => candidate.brier - smallestBrier <= TIE_TOLERANCE,
  );
  const winner = [...tied].sort(
    (a, b) => tieBreakRank(a.kind) - tieBreakRank(b.kind),
  )[0];
  if (winner === undefined) {
    throw new CalibrationSelectionError(
      "no candidate is within the frozen tie tolerance of the smallest Brier, which " +
        "is arithmetically impossible for finite scores and therefore a defect here " +
        "rather than a corpus property",
    );
  }
  return winner;
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
  /** See {@link CandidateScore.ece} for why this is not called `ece15`. */
  ece: number;
  /** Bins `ece` was measured over, from `calibrationGate.eceBins`. */
  eceBins: number;
  /** Binning `ece` was measured under, from `calibrationGate.eceBinning`. */
  eceBinning: typeof ECE_BINNING;
  clusters: number;
  items: number;
}

/** One row as the ECE estimator sees it: a clamped score, a label and a weight. */
interface WeightedPoint {
  prediction: number;
  label: 0 | 1;
  weight: number;
}

/**
 * Weighted EQUAL-MASS expected calibration error over at most `bins` bins.
 *
 * Equal-mass and not fixed-width because `calibrationGate.eceBinning` says
 * `equal-mass` and this module reads that field instead of contradicting it: a
 * fixed-width estimator taking its bin COUNT from a block that pins the binning was
 * one policy key serving two incompatible estimators.
 *
 * TIES ARE NEVER SPLIT, and that is the load-bearing part of the definition. Rows are
 * grouped by their exact clamped score first, and a whole group goes into one bin: it
 * is placed where the MIDPOINT of the group's weight interval falls in the cumulative
 * weight, a weighted quantile rule that gives exactly equal mass per bin when the
 * weights are equal and no value repeats. Splitting a tie by anything else — the first
 * version of this sorted the tied rows by record-line id — makes bins that are pure in
 * label for a set of rows the model scored identically, and the estimator then reports
 * as calibration error what is only the id ordering. Measured: on the fit fixture,
 * where 108 rows share one raw score, the split version reported every candidate above
 * the 0.05 admission and the whole fit failed; grouped, the same fixture reports the
 * order of 0.02.
 *
 * A consequence worth naming: with fewer distinct scores than bins, fewer than `bins`
 * bins are occupied. That is what equal-mass means on discrete scores, not a defect,
 * and it is why the bin count travels with the number instead of being read off the
 * name.
 */
function equalMassEce(points: readonly WeightedPoint[], bins: number): number {
  const totalWeight = points.reduce((sum, point) => sum + point.weight, 0);
  if (totalWeight <= 0) return Number.POSITIVE_INFINITY;

  const byScore = new Map<
    number,
    { predictionSum: number; labelSum: number; weight: number }
  >();
  for (const point of points) {
    const group = byScore.get(point.prediction) ?? {
      predictionSum: 0,
      labelSum: 0,
      weight: 0,
    };
    group.predictionSum += point.prediction * point.weight;
    group.labelSum += point.label * point.weight;
    group.weight += point.weight;
    byScore.set(point.prediction, group);
  }
  const ordered = [...byScore.entries()].sort(
    ([left], [right]) => left - right,
  );

  const accumulated = Array.from({ length: bins }, () => ({
    predictionSum: 0,
    labelSum: 0,
    weight: 0,
  }));
  let consumed = 0;
  for (const [, group] of ordered) {
    const midpoint = (consumed + group.weight / 2) / totalWeight;
    const index = Math.min(bins - 1, Math.max(0, Math.floor(midpoint * bins)));
    const bin = accumulated[index];
    bin.predictionSum += group.predictionSum;
    bin.labelSum += group.labelSum;
    bin.weight += group.weight;
    consumed += group.weight;
  }

  let ece = 0;
  for (const bin of accumulated) {
    if (bin.weight === 0) continue;
    const averagePrediction = bin.predictionSum / bin.weight;
    const averageLabel = bin.labelSum / bin.weight;
    ece +=
      (bin.weight / totalWeight) * Math.abs(averagePrediction - averageLabel);
  }
  return ece;
}

/**
 * The ECE under whichever binning the policy pins, through an exhaustive switch: a
 * new value of `calibrationGate.eceBinning` becomes a type error here rather than a
 * silent divergence, the same discipline `benchmark/gates.ts` applies to `eceBound`.
 */
function selectionEce(points: readonly WeightedPoint[]): number {
  switch (ECE_BINNING) {
    case "equal-mass":
      return equalMassEce(points, ECE_BINS);
    default: {
      const unhandled: never = ECE_BINNING;
      throw new CalibrationSelectionError(
        `calibrationGate.eceBinning ${JSON.stringify(unhandled)} has no estimator in ` +
          "the calibrator selection, so the ECE admission cannot be evaluated",
      );
    }
  }
}

/**
 * Brier and ECE over out-of-fold predictions with EQUAL WEIGHT PER CLUSTER — the
 * aggregation rule the frozen contract states for the calibrator competition ("menor
 * Brier OOF agregado com pesos iguais por cluster").
 *
 * It lives here, with the fold construction, because this is where the out-of-fold
 * predictions are produced; `benchmark/calibration-pipeline.ts` consumes the score,
 * not the rows. Row weighting would let one fat atom decide the competition: a
 * cluster of 400 near-identical university answers would outvote 40 clusters of 10,
 * which is the same degeneration in the aggregation that per-row folds were in the
 * partition.
 *
 * A cluster's contribution is the MEAN over its own record-lines, so the aggregate is
 * the unweighted mean over clusters. The ECE uses the same weights — each row carries
 * `1 / (clusters * rows in its cluster)` — under the frozen bin count and binning
 * ({@link selectionEce}). It is still a POINT estimate and not
 * `calibrationGate.eceBound`, which is a bootstrap simultaneous upper bound: the
 * number published here runs BELOW the gate's, so it must not be read as the gate's
 * quantity or as evidence a release would pass.
 *
 * Scores are clamped to [0, 1] for the calibration arithmetic, because a calibrated
 * score outside that range is not a probability and `applyCalibrator` clamps anyway;
 * the Brier is computed on the value as given, so a caller feeding it something else
 * sees the penalty rather than a silently repaired number.
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
      ece: Number.POSITIVE_INFINITY,
      eceBins: ECE_BINS,
      eceBinning: ECE_BINNING,
      clusters: 0,
      items: 0,
    };
  }

  let brier = 0;
  const points: WeightedPoint[] = [];
  for (const bucket of byCluster.values()) {
    const rowWeight = 1 / (clusters * bucket.length);
    let squared = 0;
    for (const { prediction, label } of bucket) {
      squared += (prediction - label) ** 2;
      points.push({
        prediction: Math.min(1, Math.max(0, prediction)),
        label,
        weight: rowWeight,
      });
    }
    brier += squared / bucket.length / clusters;
  }

  return {
    brier,
    ece: selectionEce(points),
    eceBins: ECE_BINS,
    eceBinning: ECE_BINNING,
    clusters,
    items: predictions.length,
  };
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
 *
 * The population is put in record-line id order before anything reads it, and the
 * final refit runs over that order too. Otherwise the refit's floating-point sums
 * follow the caller's array order and the sealed `calibrators` block — hence
 * `artifactDigest` — moves when the same corpus arrives permuted.
 */
export function selectCalibrator(
  samples: readonly ClusteredCalibrationSample[],
): SelectedCalibrator {
  if (samples.length === 0) {
    throw new CalibrationSelectionError(
      "selectCalibrator requires at least one sample",
    );
  }
  const population = [...samples].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const { folds, stratification } = createClusteredFolds(population, CV_SEED);

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
      ece: aggregate.ece,
      foldCount: stratification.folds,
      clusterCount: aggregate.clusters,
      eceBins: aggregate.eceBins,
      eceBinning: aggregate.eceBinning,
    };
  });

  const selection = selectCandidateSummary(candidates);
  const model = fitCalibrator(selection.kind, population);
  return { model, selection, candidates, stratification };
}
