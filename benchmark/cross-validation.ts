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
// generation batch or a lineage seed makes two rows dependent without their sharing
// an author at all.
//
// What this module contracts now, stated as what is measured (R7) and not as a
// property:
//
//   * The ATOM is the split/exposure cluster, taken from `clusterAssignments`
//     (benchmark/cluster-exposure-ledger.ts, which delegates to
//     `connectedComponentRoots`). No connectivity is re-derived here. A whole
//     cluster lands in exactly ONE fold's validation half, so no cluster spans a
//     fold's train and validation halves — and therefore no identity on an axis of
//     `CLUSTER_ATOM_AXES` spans them either, because those are exactly the relations
//     the component is closed over. That is why there is NO second, hierarchical
//     cross-validation: the component subsumes it.
//   * The closure claim stops at that list, and the two axes OUTSIDE it are NAMED
//     rather than left to a reader, because a reader who assumes closure over them
//     states a false independence claim. `domainSource` (the stratum) and
//     `sourceMaterialBatch` (the acquisition event) are not union axes: one value of
//     either covers a whole quota cell, so unioning on them would make the cell a
//     single indivisible atom and leave nothing to cross-validate. Both therefore
//     span every fold freely. They carry dependence BETWEEN cells, and the audit
//     publishes them as an inventory per partition; what makes rows inside one cell
//     dependent — `author`, `source`, `nearDuplicate`, the generation axes and
//     lineage — is in the list above.
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
//     placed in the fold that minimises the class imbalance of the WHOLE design in
//     share units ({@link bestFoldIndex}, where the algebra and the two properties it
//     yields are written out). The digest orders the atoms; it does not by itself
//     decide the fold, which also depends on the sizes and class counts of every other
//     atom, and stating it the shorter way would be the kind of almost-true claim this
//     header exists to stop.
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
// THIS module imposes, and it can override the frozen "menor Brier OOF" (a candidate
// with the smallest Brier and an inadmissible ECE loses). Its BUDGET is taken from
// `calibrationGate.eceMax` and its BIN COUNT and BINNING from
// `calibrationGate.eceBins`/`eceBinning` rather than invented here.
//
// What that adoption does NOT buy, because the header said it did and it was false:
// this is not the gate's quantity, and the three keys are the only thing the two
// share. `calibrationGate.eceMax` is checked here against a DIFFERENT ESTIMATOR from
// the one the gate reads (`metrics.calibration.eceEqualMass15`, computed by
// `metrics.ts::eceEqualMass` and read at benchmark/gates.ts's
// `warning.calibration-ece`), and they differ in two ways:
//
//   * TIES. `metrics.ts` sorts by probability and cuts the sorted array at index
//     boundaries, so a group of rows the model scored identically is SPLIT across two
//     bins. {@link equalMassEce} groups by exact clamped score and never splits a
//     group (see its docstring for what splitting one measures instead).
//   * WEIGHTS. `metrics.ts` weights per ROW. This module weights per CLUSTER, which
//     is the aggregation the frozen contract states for this competition.
//
// NEITHER divergence has a sign, and what stands behind that are two FIXTURES that go
// opposite ways — each exact, each re-derivable by hand, both asserted in
// `benchmark/tests/cross-validation.test.ts`:
//
//   * twenty rows all scored 0.5, half of them positive, one cluster each. The weights
//     are uniform, so only the tie handling differs: this module reports 0 (one group,
//     mean score 0.5 against mean label 0.5) and `metrics.ts` reports 0.25 (the tie
//     split across fifteen index-cut bins makes bins that are label-pure for rows the
//     model scored identically). This module BELOW.
//   * one well-calibrated cluster of sixty rows against five badly calibrated
//     singletons. Per-row weights give the singletons 5/65 of the mass and report 0.1;
//     per-cluster weights give them 5/6 and report 0.75. This module ABOVE.
//
// NO FREQUENCY over random populations is claimed, and none should be added. A table of
// such counts stood here — "over 400 random populations per setting, with 2 distinct
// scores the two estimators agree exactly (400/400)", and two more rows like it — and it
// is WITHDRAWN rather than re-stated, because those counts measure the GENERATOR. Fixing
// everything that table named (one row per cluster, the policy's bins, 400 populations of
// 30 to 150 rows, two distinct scores) and varying only the part it left unstated — how
// the label is drawn — flips the majority direction: this module ran below `metrics.ts` in
// 398 of 400 with the label drawn Bernoulli at the score, and above it in 275 of 400 with
// the label drawn as `score >= 0.5`. The withdrawn entry reproduced under neither reading;
// under Bernoulli labels 0 of 400 agreed bit for bit. Those two counts are stated as what
// they are, one sweep of a generator that is nobody's corpus, and they are the reason no
// such count belongs in the contract: a reader cannot tell which sweep their own
// population resembles.
//
// What can be said in general is structural, and it is what kills the tempting version
// of the claim: both estimators partition the score line into contiguous blocks, and
// neither partition refines the other, so the argument that merging bins cannot increase
// the ECE does not carry between them. "Grouping ties makes this a lower bound on the
// gate's estimator" is therefore not available.
//
// The admission is therefore a SCREEN against a grossly miscalibrated candidate at
// the gate's budget and bin count, and NOT a prediction of the gate's verdict in
// either direction — the more so because `calibrationGate.eceBound` says the gate
// decides on a bootstrap simultaneous upper bound while this is a point estimate.
// Whether the admission belongs in the frozen table at all, and which estimator it
// should use, is G1's to settle when it restructures the selection across
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
 * calibrator row ranks by Brier and says nothing about ECE. Adopting the gate's
 * BUDGET, BIN COUNT and BINNING is what keeps the guard from being a number of our
 * choosing — and it is all it does. The estimator behind the gate's number is a
 * different one, in the two ways the header sets out with the fixtures that pin them, so
 * these three keys are shared parameters and not a shared quantity.
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
   * `deviation >= deviationFloor` is the invariant and equality is not promised.
   *
   * IN EXACT ARITHMETIC, that is. This number and {@link deviation} are computed by
   * different expressions — a packing that sits exactly at the floor reaches the same
   * rational number as `2/6 - 1/5` on one side and `4/(5*6)` on the other — so the two
   * can cross by ONE ULP, and two of this module's own test fixtures do
   * (0.1333333333333333 against 0.13333333333333333). Compare them with a tolerance,
   * or read {@link excessOverFloor}, which is clamped for exactly this reason.
   */
  deviationFloor: number;
  /**
   * `max(0, deviation - deviationFloor)`: how much imbalance the greedy packing left
   * above what the atoms make unavoidable. Zero means the packing matched the bound;
   * it is the number that separates "this corpus cannot be balanced" from "this packer
   * did not balance it", which is the whole reason the pair is published.
   *
   * Clamped, and not the raw subtraction, because of the ulp {@link deviationFloor}
   * documents: the raw difference reads -2.7755575615628914e-17 on a packing that sits
   * exactly at the floor, and a negative excess contradicts both this field's "zero
   * means it matched the bound" and the floor's `deviation >= deviationFloor`. The
   * clamp costs nothing a consumer could want — no packing can genuinely undercut a
   * proven lower bound, so a negative value never carries information.
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
 * pseudonymised root id, then by that id; each is placed in the fold that minimises
 * the whole design's class imbalance in share units ({@link bestFoldIndex}).
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
  const totalPositives = samples.filter((sample) => sample.label === 1).length;
  const totalNegatives = samples.length - totalPositives;
  for (const atom of ordered) {
    const target =
      accumulators[
        bestFoldIndex(atom, accumulators, totalPositives, totalNegatives)
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
          `validation record-line(s) over ${byRoot.size} atoms and ${samples.length} ` +
          "record-line(s); an empty half is a fold that contributes no out-of-fold " +
          "prediction, which is a smaller design wearing the frozen one's name. This is " +
          "NOT the corpus being too small for five folds — CLUSTERS_BELOW_FOLDS is the " +
          "refusal that says that, and it already passed — so reaching here means the " +
          "PACKING RULE in bestFoldIndex left a fold empty while atoms remained, which " +
          "its second documented property says cannot happen. Report it as a defect in " +
          "this module, not as a property of the population",
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
    excessOverFloor: Math.max(0, deviation - floor),
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
 * The fold this atom should join: the exact minimiser, over the five choices, of the
 * WHOLE design's class imbalance in share units.
 *
 * The objective being minimised is `sum over classes c of sum over ALL folds j of
 * (count[j][c]/total[c] - 1/folds)^2` — the same share units
 * {@link FoldClassBalance.deviation} is measured in. Expanding it for "the atom goes
 * to fold i" leaves only one term that depends on `i`, because every other fold's
 * count is untouched and `(atom[c]/total[c])^2` is the same wherever the atom lands:
 *
 *   cost(i) = sum_c (atom[c] / total[c]^2) * count[i][c]
 *
 * Two properties fall out of that algebra rather than out of a heuristic, and both
 * are the fix for defects measured on the two rules this replaced.
 *
 * FIRST: a class the atom does not carry contributes NOTHING, since `atom[c] = 0`
 * zeroes its term. The rule this replaced scored only the RECEIVING fold's squared
 * error, `(count[i][pos] + atom[pos] - target[pos])^2 + (...neg...)`, and for an
 * all-negative atom the positive term degenerated to `(count[i][pos] - target[pos])^2`
 * — largest for an EMPTY fold and near zero for a fold already holding its share of
 * positives. So it penalised a fold for a shortfall the atom could not possibly
 * reduce, filled one fold at a time and left later folds empty. Measured with that
 * rule: one 12-row negative atom plus five positive and five negative singletons
 * threw `FOLD_HALF_EMPTY` on fold 4, and 629 of 3000 fuzzed populations with unequal
 * atom sizes and clumped class composition were refused the same way.
 *
 * SECOND, and stronger than a tendency: while any fold is still empty, an empty fold
 * WINS. Every term of `cost` is non-negative and all of an empty fold's counts are
 * zero, so its cost is exactly 0, the minimum available; a cost tie is broken by the
 * smaller resulting fold, which an empty fold also wins. The first `folds` atoms
 * therefore go round-robin into the `folds` folds, and since
 * `CLUSTERS_BELOW_FOLDS` has already refused a population with fewer atoms than
 * folds, no fold can come out empty. That is what makes `FOLD_HALF_EMPTY` below a
 * defect report about this function rather than a statement about the corpus.
 *
 * What is NOT claimed: that greedy placement minimises the objective GLOBALLY. Each
 * step is exact, the sequence of steps is not, and the residual is published as
 * {@link FoldClassBalance.excessOverFloor} instead of being argued away here.
 */
function bestFoldIndex(
  atom: Atom,
  accumulators: readonly FoldAccumulator[],
  totalPositives: number,
  totalNegatives: number,
): number {
  // A class absent from the whole population has `total === 0` and, necessarily,
  // `atom === 0`: the weight is 0 rather than 0/0.
  const positiveWeight =
    totalPositives === 0 ? 0 : atom.positives / totalPositives ** 2;
  const negativeWeight =
    totalNegatives === 0 ? 0 : atom.negatives / totalNegatives ** 2;
  let bestIndex = 0;
  let bestCost = Number.POSITIVE_INFINITY;
  let bestTotal = Number.POSITIVE_INFINITY;
  for (const [index, accumulator] of accumulators.entries()) {
    const cost =
      positiveWeight * accumulator.positives +
      negativeWeight * accumulator.negatives;
    if (
      cost < bestCost ||
      (cost === bestCost && accumulator.total < bestTotal)
    ) {
      bestCost = cost;
      bestTotal = accumulator.total;
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
 * inadmissible ECE loses to a worse-Brier admissible one. It is kept as a SCREEN
 * against a grossly miscalibrated candidate, at the gate's budget and bin count rather
 * than at one of our choosing. It is NOT "a calibrator the release gate would reject",
 * which is what this docstring used to say: the estimator behind `ece` differs from the
 * gate's in two ways with no reliable sign, so admission here neither implies nor is
 * implied by passing there. The header carries the two fixtures that go opposite ways;
 * G1 owns whether the admission belongs in the frozen table and which estimator it
 * should use.
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
 * weight. Splitting a tie by anything else — the first version of this sorted the tied
 * rows by record-line id — makes bins that are pure in label for a set of rows the
 * model scored identically, and the estimator then reports as calibration error what is
 * only the id ordering. Measured: on the fit fixture, where 108 rows share one raw
 * score, the split version reported every candidate above the 0.05 admission and the
 * whole fit failed; grouped, the same fixture reports the order of 0.02.
 *
 * "EQUAL MASS" IS THEREFORE AS EQUAL AS THE GROUPS ALLOW, never exact. Two ways it is
 * inexact, and the module's own tests depend on both:
 *
 *   * an indivisible group carries whatever weight it carries, so with fewer distinct
 *     scores than `bins` fewer than `bins` bins are occupied at all;
 *   * even with equal weights and no repeated value, a count that is not a multiple of
 *     `bins` cannot divide evenly — 16 distinct equally weighted scores over 15 bins
 *     put ranks 7 and 8 in the same bin, their midpoints falling at 7.03/15 and
 *     7.97/15, which is exactly what `aggregateOutOfFold`'s bin-count test relies on.
 *     `metrics.ts::eceEqualMass` documents the same remainder the other way round, as
 *     the first `count % bins` groups taking one extra point.
 *
 * That is what equal-mass means on discrete scores, not a defect, and it is why the bin
 * count travels with the number instead of being read off the name.
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
 * ({@link selectionEce}). It is a POINT estimate and not `calibrationGate.eceBound`,
 * which is a bootstrap simultaneous upper bound, and it is not the gate's ESTIMATOR
 * either: see this file's header for the two divergences and the two fixtures showing
 * neither has a reliable sign. So this number must not be read as the gate's quantity
 * or as evidence a release would pass.
 *
 * ORDER INVARIANCE, made true rather than assumed. Clusters are visited in sorted root
 * order and each cluster's rows in sorted record-line id order, so both the Brier's and
 * the ECE's floating-point sums accumulate in an order that is a function of the rows
 * and not of the array. Without that the result was invariant only up to floating point
 * — which is the same non-associativity argument that made `createClusteredFolds` sort
 * its halves, and the reason a small fixture can look order-invariant while a real
 * population is not. It is exact only for DISTINCT ids inside a cluster, which
 * `createClusteredFolds` enforces upstream (`DUPLICATE_ID`).
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
  const orderedRoots = [...byCluster.keys()].sort();
  for (const root of orderedRoots) {
    const bucket = [...(byCluster.get(root) as OutOfFoldPrediction[])].sort(
      (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    );
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
