// Scientific audit of a blocked temporal split. The splitter (benchmark/split.ts)
// produces the partition; this module re-derives, independently, the structural
// properties a release claim rests on, and FAILS on those no later stage can
// repair:
//
//   1. zero group leakage on every connected-component axis (`GROUP_KEYS`),
//   2. a strictly-latest blocked test (no future -> earlier-partition leak),
//   3. dev, cal-A and cal-B in temporal order among themselves,
//   4. per-class 45/5/10/20/20 within a two-point tolerance, and
//   5. no declared group axis left `unknown`: the source states the dependence
//      exists, so an axis nobody recovered cannot support the split.
//
// The axes the splitter does NOT union on are still REPORTED here, per partition, and
// `REPORTED_GROUP_AXES` names the four whose dependence is carried that way on purpose.
// An inventory is what such an axis can honestly support: unioning on a coarse one
// would put a whole quota cell in one partition, and unioning on a recipe one collapses
// the generated class into a block no partition can receive (see `GROUP_KEYS` in
// benchmark/split.ts, which states the criterion). An axis absent from this report is
// an axis nobody downstream can gate on.
//
// The sampling floors are NOT failures. `minimumTestHumanNegatives` counts
// aggregate record-lines while a power claim needs sampling units, so it is
// published as a measurement (`testHumanNegatives`, carrying its threshold and
// whether it suffices for a release FPR claim), and a per-slice floor marks the
// slice non-gating instead of dropping it. Whether a corpus may be sealed for release is
// not decided here either: the artifact RECORDS its composition, and comparing that
// composition against the pre-registered floor happens outside this module.
//
// The audit is deliberately separate from the splitter so a leaking split (even
// a hand-crafted one) is caught rather than trusted. Standalone module: MUST NOT
// import from the extension bundle (src/).

import {
  generatorFamilyOf,
  sortGeneratorFamilies,
  type GeneratorFamily,
} from "./generator-family.ts";
import { PREREGISTRATION_V4 } from "./preregistration-v4.ts";
import { V3_HUMAN_SOURCE_INVENTORY } from "./source-manifest.ts";
import {
  ALL_GROUP_AXES,
  groupAxisDeclaredState,
  groupAxisIdentity,
  groupAxisState,
  recordGroupAxes,
  type BenchmarkLabel,
  type BenchmarkRecord,
  type GroupAxis,
  type GroupAxisState,
} from "./schema.ts";
import {
  axisConnectivity,
  connectedComponentRoots,
  withinClassTolerance,
  GROUP_KEYS,
  type AxisConnectivity,
  type Partition,
} from "./split.ts";

/**
 * The frozen audit policy, and the ONE copy of it.
 *
 * It lives here rather than beside the command because two consumers need it: the command
 * that produces an audit and the validator that re-derives one from a sealed artifact. A
 * sealed audit and a re-derived audit are therefore produced under identical policy by
 * construction, which is what makes comparing them meaningful.
 */
export const FROZEN_SPLIT_AUDIT_POLICY: SplitAuditPolicy = {
  minimumTestHumanNegatives: 2_000,
  minimumCriticalFprNegatives: 300,
  minimumCriticalRecallPositives: 200,
  classTolerance: 0.02,
};

/**
 * The join the audit owes itself: `provenance.sourceId` -> the axes that source DECLARED
 * applicable. Built from the frozen inventory in the tree, so the check needs no private
 * file and cannot be softened by one.
 */
export const DECLARED_GROUP_AXES: ReadonlyMap<string, readonly GroupAxis[]> =
  new Map(
    V3_HUMAN_SOURCE_INVENTORY.map((entry) => [
      entry.sourceId,
      entry.declaredGroupAxes,
    ]),
  );

/**
 * FOUR of the axes the splitter refuses to union on: the ones this audit takes NAMED
 * reporting responsibility for — an inventory per partition, never a cluster the split
 * rests on.
 *
 * It is not the set of axes the report covers, and reading it that way states something
 * false. The per-partition inventory is built by `reportedAxesOf` from every axis the
 * RECORDS declare, so it also carries `generatorFamily`, `generationLane`,
 * `harnessVersion` and `extractionRun` — axes this list does not name and nothing else
 * in the tree names either. {@link groupAxisRole} is where that residue is declared
 * instead of implied.
 *
 * All four name a real dependence and none of them can carry it through the
 * partitioning, for two different arithmetics.
 *
 * `domainSource` and `sourceMaterialBatch` are the MATERIAL pair. There is one
 * acquisition event per source and one stratum per quota cell, so unioning on either
 * would make a whole cell a single indivisible component: the human partition
 * fractions become multiples of ~25%, `dev`'s 0.05 is unreachable, and a unit floor
 * counted in components reads 1 per cell forever.
 *
 * `generatorVersion` and `promptTemplate` are the APPARATUS pair, and they identify a
 * recipe rather than a sampling unit — `EXPOSURE_IDENTITY_AXES`
 * (benchmark/cluster-exposure-ledger.ts) excludes the recipe axes by name, which is a
 * gate saying so in code. Measured on the assembled corpus, `promptTemplate` alone puts
 * 641 of 1170 generated lines (54.79% of the class) in one component, above the largest
 * target plus tolerance; `generatorVersion` alone puts 493 (42.1%), which fits. What
 * does not fit is the PAIR: together they close transitively and the class becomes one
 * component of 100%. `generatorVersion` does NOT carry the identity `generatorFamily`
 * carries — five identities against one, agreeing on 0 of the 1170 lines — so the
 * family argument does not reach it and the closure is the whole of the reason.
 *
 * The argument for both pairs is written out at `GROUP_KEYS` in benchmark/split.ts,
 * which states the criterion and is where the exclusion is enforced. What remains
 * available here is an inventory — how many distinct strata, acquisition events,
 * generator versions and prompt templates each partition holds — and that is what the
 * cluster report publishes for them, with `connectivity.sharedValue: false` stating
 * outright that the splitter did not group by them.
 *
 * This list may never intersect `GROUP_KEYS`. It is not a second vocabulary the audit
 * enforces on the splitter; it is the set whose REPORTED standing the audit is
 * responsible for, and a test pins the disjointness against the splitter's own list.
 */
export const REPORTED_GROUP_AXES = [
  "domainSource",
  "sourceMaterialBatch",
  "generatorVersion",
  "promptTemplate",
] as const satisfies readonly GroupAxis[];

/**
 * The five standings an axis can have, in the order {@link groupAxisRole} decides them.
 *
 * `inventoryOnly` is the RESIDUE and is a named absence, not a role anybody designed:
 * it is what is left when the four lists have spoken. It exists so the residue is
 * declared and pinned by test rather than discovered by a reader who applies the union
 * criterion to an axis nothing names.
 */
export const GROUP_AXIS_ROLES = [
  "unionByValue",
  "parentLinkage",
  "namedReported",
  "diagnostic",
  "inventoryOnly",
] as const;

export type GroupAxisRole = (typeof GROUP_AXIS_ROLES)[number];

/**
 * What standing one axis has, TOTAL over every axis any record version declares and
 * derived from the four lists that decide it — never from the union criterion, which is
 * a necessary condition on `GROUP_KEYS` and decides nothing on its own (the argument is
 * written at `GROUP_KEYS` in benchmark/split.ts).
 *
 * The order of the four tests is a PRECEDENCE and not a partition of the lists, because
 * the lists overlap by design: `derivationRoot` is in `GROUP_KEYS` and in
 * `PARENT_LINKAGE_AXES`, carrying both relations. It answers `unionByValue`, the
 * stronger one, and a caller that needs the pair reads {@link axisConnectivity}, which
 * is what publishes both flags. Nothing else overlaps, and a test pins that.
 *
 * `inventoryOnly` is not a synonym for "carries no dependence". `generatorFamily` is
 * there and DOES carry one; what the tree does about it is narrower than grouping —
 * only the reserved families are constrained, and only to being test-only — so calling
 * it reported or diagnostic would name a responsibility nobody took.
 */
export function groupAxisRole(axis: GroupAxis): GroupAxisRole {
  const connectivity = axisConnectivity(axis);
  if (connectivity.sharedValue) return "unionByValue";
  if (connectivity.parentLinkage) return "parentLinkage";
  if ((REPORTED_GROUP_AXES as readonly string[]).includes(axis)) {
    return "namedReported";
  }
  if (
    (
      PREREGISTRATION_V4.connectivity.diagnosticAxes as readonly string[]
    ).includes(axis)
  ) {
    return "diagnostic";
  }
  return "inventoryOnly";
}

export interface SplitAuditPolicy {
  /**
   * The human-negative count the blind block needs to support a released FPR bound.
   *
   * REPORTING threshold, not a gate — the same standing as the two slice floors below.
   * This module measures the offer and does not compute power: a hard failure here would
   * wire a power gate into the audit that the audit's own inputs cannot decide.
   *
   * It is also unmeetable as a gate: the frozen corpus composition is 4000 human records
   * and the blind block is 20% of it, so `test` holds at most 800 of them — the count the
   * policy publishes as `zeroEventCeiling.blindBlockLinesAtCollectionTarget`. The floors
   * that bind are the pre-registered ones — 300 human-negative record-lines AND 300
   * independent sampling units per quota cell — applied before sealing, elsewhere.
   */
  minimumTestHumanNegatives: 2_000;
  minimumCriticalFprNegatives: 300;
  minimumCriticalRecallPositives: 200;
  classTolerance: 0.02;
}

/**
 * The slices the cluster report is broken down by. `partition` first, because
 * "how many independent clusters does each partition hold" is the question the
 * composition gate asks; the rest are the slices a per-stratum power calculation needs an
 * OFFER for.
 */
export const CLUSTER_SLICE_AXES = [
  "partition",
  "label",
  "lengthBucket",
  "domain",
  "humanSourceType",
] as const;

export type ClusterSliceAxis = (typeof CLUSTER_SLICE_AXES)[number];

/**
 * How much independent grouping one axis (or the connected component) actually
 * offers. `groups` counts the DISTINCT identities, `largest` the biggest one,
 * `singletons` how many hold exactly one record-line, and `recordLines` how
 * many record-lines carried an identity at all.
 *
 * A degenerate reading is not a defect. After pruning, `nearDuplicate` is
 * expected to be all singletons, and generated text has no human author, so an
 * axis whose `groups` is 0 or whose `largest` is 1 is a DESCRIPTION of the corpus
 * of the corpus. Nothing here fails on it, and nothing here computes power: this module
 * measures the OFFER, and computing power and applying a gate happen outside it. A power
 * gate wired in here would make the audit turn on a decision its own inputs cannot make.
 */
export interface ClusterCount {
  groups: number;
  largest: number;
  singletons: number;
  /**
   * How many record-lines carried an identity at all. Named `recordLines` and
   * not `records`, deliberately: `records` is a FORBIDDEN key in published
   * evidence (benchmark/evidence-sanitizer.ts) precisely because a key of that
   * name is almost always a record list, and this audit is published.
   */
  recordLines: number;
}

export interface ClusterSliceCount {
  slice: ClusterSliceAxis;
  key: string;
  count: ClusterCount;
}

/**
 * How the splitter unions an axis, as the TWO relations it really is.
 *
 * The single boolean this replaced could not tell them apart, and the conflation
 * published a FALSE independence claim: `humanSeed` is linkage-only, linkage
 * unions only when the named row is present, and 782 of 783 parent references in the
 * assembled corpus resolve to no row — so `true` next to `largest: 2` read as "one
 * indivisible block of two record-lines" about two rows the splitter had just put
 * on opposite sides of the test cut.
 *
 * RE-EXPORTED, never restated: the type is declared next to
 * {@link axisConnectivity} in split.ts, the one place that derives the values, so a
 * third relation added there cannot leave this side describing two while the sealed
 * artifact carries three.
 */
export type { AxisConnectivity };

/**
 * What the `known` references on a PARENT-LINKAGE axis resolved to inside the
 * record set that was audited. `references` is their total, and the other three
 * partition it by the exact predicate `connectedComponentRoots` applies:
 *
 * - `joinedAnotherRecordLine` — the named row is present and is not this row, so
 *   the splitter DID union the two. This is the only branch that creates a cluster.
 * - `selfReference` — the identity names the row's own id (the shape a v2 record
 *   carries on `derivationRoot`), which unions nothing.
 * - `absentFromRecordSet` — the named row is in no record of this set, which unions
 *   nothing either, and is the case for 782 of 783 references in the assembled corpus.
 *
 * It exists so a consumer never has to guess how strong `parentLinkage: true` is
 * for the corpus in front of it. This module publishes the number; it computes no power
 * and applies no gate.
 */
export interface LinkageResolution {
  references: number;
  joinedAnotherRecordLine: number;
  selfReference: number;
  absentFromRecordSet: number;
}

/**
 * The two union relations PLUS the measurement that says how strong the conditional
 * one actually was — with the measurement sitting behind its own discriminant.
 *
 * `linkage` used to be a sibling field typed `LinkageResolution | null`, whose
 * discriminant lived one field away in `connectivity.parentLinkage`. TypeScript
 * cannot narrow across two fields, so every reader either asserted with `!` or
 * checked the flag and got no narrowing for its trouble. Here `parentLinkage` is a
 * literal in each branch, so `if (connectivity.parentLinkage)` narrows `linkage` to
 * `LinkageResolution` and the else-branch to `null`.
 *
 * `null` is kept on the false branch rather than the field being absent: this object
 * is serialised into the `splitDigest`-sealed artifact, and an explicit `null` states
 * "measured, and the question does not arise" where a missing key would be
 * indistinguishable from an older writer that never measured.
 *
 * Both branches spread {@link AxisConnectivity} whole, so a third relation added
 * there appears here too instead of being silently understated.
 */
export type AxisConnectivityReport =
  | (Omit<AxisConnectivity, "parentLinkage"> & {
      parentLinkage: false;
      linkage: null;
    })
  | (Omit<AxisConnectivity, "parentLinkage"> & {
      parentLinkage: true;
      linkage: LinkageResolution;
    });

export interface AxisClusterReport {
  axis: GroupAxis;
  /**
   * The two union relations and the measured resolution of the conditional one,
   * never one flag: see {@link AxisConnectivityReport}.
   */
  connectivity: AxisConnectivityReport;
  /** How many record-lines state each of the three axis states on this axis. */
  states: Record<GroupAxisState, number>;
  overall: ClusterCount;
  bySlice: ClusterSliceCount[];
}

/**
 * The count and distribution of independent clusters, per axis and per slice.
 *
 * This is what replaces `leakages: []` as the audit's evidence of independence.
 * An empty leakage list over identifiers minted to be unique is a tautology — it
 * is §3.6 of the assessment — and it is what let a corpus of 10.000 singleton
 * "authors" pass a leakage audit. A count and a distribution can be wrong out
 * loud.
 */
export interface SplitClusterReport {
  axes: AxisClusterReport[];
  /** The split/exposure cluster: the connected component of the axis union. */
  connected: { overall: ClusterCount; bySlice: ClusterSliceCount[] };
}

/**
 * A grouping axis a SOURCE declared applicable that a record-line left `unknown`.
 *
 * Only `unknown` is reported, and the precision is deliberate: `notApplicable` is
 * legitimate (Wikipedia has no single author) and does NOT make a record
 * ineligible, while `unknown` means the axis was not recovered and the record-line
 * is ineligible. `assertDeclaredAxesResolved` (benchmark/schema.ts) is
 * STRICTER — it also refuses `notApplicable` as a contradiction of the source's
 * own declaration — and that stricter rule belongs to the ingest path, where a
 * record is being accepted into the corpus. The audit's question is whether the
 * partitions can be trusted, and a legitimately inapplicable axis does not make
 * them untrustworthy.
 */
export interface DeclaredAxisGap {
  sourceId: string;
  axis: GroupAxis;
  state: "unknown";
  recordLines: number;
}

export interface SplitAudit {
  sizes: Record<Partition, number>;
  classFractions: Record<BenchmarkLabel, Record<Partition, number>>;
  /**
   * The OBSERVED temporal boundaries, one per partition — not the cuts the search
   * chose. The distinction matters: `train` is the splitter's fallback and collects
   * every component that straddles a cut, so `latestTrain` can legitimately exceed
   * every other boundary, and reading it back as "the first cut" would be false.
   */
  cutoffs: {
    latestTrain: number;
    latestDev: number;
    latestCalA: number;
    latestCalB: number;
    /**
     * The EARLIEST of the two later middle partitions, published because the relation the
     * audit asserts about them is earliest-against-latest and `latest` alone cannot express
     * it: monotonic `latest` values follow from ordered ranges but do not imply them, so two
     * overlapping middle ranges satisfy `latestDev < latestCalA` while violating the order.
     */
    earliestCalA: number;
    earliestCalB: number;
    earliestTest: number;
  };
  /**
   * A group identity that crosses partitions, on the axes the splitter unions by
   * VALUE (`GROUP_KEYS`) plus the connected component of the whole union.
   *
   * What it therefore does NOT report: a LINKAGE-only axis whose identity is shared
   * across the cut while the row it names is absent from the corpus — two
   * generations grown from the same unassembled human prompt. That is not a leakage
   * under the current definition of a cluster, because the splitter does not union
   * on the value; whether it SHOULD (the two generations are dependent regardless)
   * is a substantive question this module does not decide. It is visible in
   * {@link AxisConnectivityReport}'s `linkage`, which counts exactly those references.
   */
  leakages: Array<{ axis: string; value: string; partitions: Partition[] }>;
  /** The published cluster counts. Never `undefined`: see {@link SplitClusterReport}. */
  clusters: SplitClusterReport;
  declaredAxisGaps: DeclaredAxisGap[];
  criticalSliceSamples: Array<{
    axis: string;
    key: string;
    negatives: number;
    positives: number;
    fprGateEligible: boolean;
    recallGateEligible: boolean;
  }>;
  /**
   * Human negatives in the blind block, measured and PUBLISHED rather than gated on.
   *
   * `sufficientForReleaseFpr` is an offer, exactly like `fprGateEligible` on a slice:
   * it says whether this block could carry a released FPR bound at the reporting
   * threshold. Nothing in this module fails on `false`; the composition gate is what
   * refuses a corpus, and it does so on the pre-registered unit (independent clusters
   * per quota cell) rather than on a raw row count.
   */
  testHumanNegatives: {
    count: number;
    reportingThreshold: number;
    sufficientForReleaseFpr: boolean;
  };
  /**
   * The reservation the partitions HONOR: every DECLARED family whose record-lines
   * all sit in `test` and none of which sits anywhere else. Read back off the
   * partitions, in canonical form, so it can be compared for exact equality against
   * the declared, marked and published sets.
   *
   * It is not "the families that happen to be test-only", and the difference is the
   * whole of A4-fix. That inference read a SYMPTOM of a reservation: under exact
   * equality with a hard failure, any generated family the split concentrated in
   * test — by time, by block size, by luck — reproved a split it was never reserved
   * in. Measured on `benchmark/data/corpus-build/out/split/split-artifact.json`, the
   * inferred set carried `gemini-3_5-flash-medium`, a family nobody declared, while
   * the corpus builder DELIBERATELY leaves a family below the 200-positive floor
   * undeclared: `validate` and `split` then demanded contradictory things, which is
   * the unsatisfiable-gate class of §4.1 the rebuild exists to remove.
   *
   * A family with no record-line at all is NOT honored. Vacuous truth over zero rows
   * would publish a reserve with no population, and the exact equality is what turns
   * that into the hard failure it has to be.
   *
   * The failing direction stays here rather than in {@link SplitAudit.reasons}: a
   * declared family found outside `test` is simply absent from this list, so the
   * exact-equality gates in benchmark/commands/split.ts,
   * benchmark/split-artifact.ts and benchmark/report.ts fail hard and name it.
   * Restating it as an audit reason would make those three gates unreachable and
   * therefore untestable.
   */
  heldOutGeneratorFamilies: GeneratorFamily[];
  /**
   * Families whose every record-line landed in `test` without anyone reserving
   * them. DIAGNOSTIC, and deliberately outside the exact equality: the
   * concentration may be design or accident, so the report publishes it and no gate
   * reads it (it is not one of the pre-registered `m` hypotheses either).
   *
   * The corpus restriction behind it is a property of the corpus, not of this check: an
   * undeclared family needs at least one record-line outside `test`, or it consumes
   * blind-block capacity without sustaining any unseen-generator claim.
   */
  incidentalTestOnlyGeneratorFamilies: GeneratorFamily[];
  passed: boolean;
  reasons: string[];
}

interface DatasetSplitInput {
  train: readonly BenchmarkRecord[];
  dev: readonly BenchmarkRecord[];
  "cal-A": readonly BenchmarkRecord[];
  "cal-B": readonly BenchmarkRecord[];
  test: readonly BenchmarkRecord[];
}

/**
 * The label vocabulary, EXHAUSTIVE by type.
 *
 * `readonly BenchmarkLabel[]` checks each element and not the coverage, so a label added to
 * `BenchmarkLabel` would leave this list short — and `auditClassFractions` builds its map with
 * `{} as Record<BenchmarkLabel, ...>`, a cast that then lies: the missing label reads back
 * `undefined` and every fraction derived from it is `NaN`. Keyed by the union instead, an
 * unlisted label is a compile error.
 */
const LABEL_COVERAGE: Record<BenchmarkLabel, true> = {
  human: true,
  ai: true,
  mixed: true,
};
const LABELS = Object.keys(LABEL_COVERAGE) as readonly BenchmarkLabel[];
// Composite-map key separator: the unit separator cannot occur in a slice name,
// a source id or an axis name, so no pair of parts can be re-parenthesised into
// another pair. Written as an escape, never as a literal control byte.
const KEY_SEP = "\u001f";
/**
 * The class-fraction targets, READ from the frozen pre-registration and never
 * restated here.
 *
 * Deriving them rather than copying them is what closes the last gap between the
 * splitter's typed literal and the decision that was actually frozen:
 * `partitionFractions` is pinned value by value by `frozenNumber`, covered by its own
 * test, and in `.prettierignore` so no formatter can move it — none of which is true
 * of a number retyped in this file.
 *
 * They are deliberately NOT read from the splitter's policy object. The audit exists
 * to disagree with the splitter, and a shared source of targets is exactly how a
 * partition omitted on one side stops being caught on the other.
 *
 * This object also declares the field/value correspondence: the pre-registration keys
 * its fractions by FIELD name (`calA`, a JS identifier) while a partition is a VALUE
 * (`cal-A`, the spelling the exposure ledger validates persisted events against). Those
 * are different lexical layers. It is declared TWICE in the benchmark, and the second
 * one is not a copy of this one: `FRACTION_KEY_BY_PARTITION` in
 * `benchmark/viability-preflight.ts` maps a partition to the KEY rather than to the
 * resolved target, because that module is handed a policy as a parameter and has to read
 * the field off whichever policy it received. Both halves are total by `satisfies`, so
 * neither can lose a partition silently.
 */
export const PARTITION_TARGETS: Record<Partition, number> = {
  train: PREREGISTRATION_V4.preRegistration.partitionFractions.train,
  dev: PREREGISTRATION_V4.preRegistration.partitionFractions.dev,
  "cal-A": PREREGISTRATION_V4.preRegistration.partitionFractions.calA,
  "cal-B": PREREGISTRATION_V4.preRegistration.partitionFractions.calB,
  test: PREREGISTRATION_V4.preRegistration.partitionFractions.test,
};

/**
 * The ONLY partition enumeration in this module, and it is derived rather than typed.
 *
 * There is no second hand-written list on purpose. A list written out by hand can drop
 * a partition, and a dropped partition is not a loud failure — its class fraction
 * simply stops being checked, so it can drift by any amount while the audit still
 * passes. Reading the enumeration off `PARTITION_TARGETS` makes that unexpressible, because
 * `Record<Partition, number>` refuses to compile with an entry missing.
 *
 * The ORDER is `PARTITION_TARGETS`' insertion order, which is the temporal order the literal is
 * written in, and the chain check depends on that order. `Object.keys` preserves it
 * for string keys by specification; it would only reorder integer-like keys, and none
 * of these five is one.
 */
const PARTITIONS: readonly Partition[] = Object.keys(
  PARTITION_TARGETS,
) as readonly Partition[];

/** Exported only so a test can pin this enumeration to the splitter's. */
export const AUDITED_PARTITIONS: readonly Partition[] = PARTITIONS;

// The critical slices from the classifier design §6.4. `generatorExposure`
// resolves to `unseen` for the DECLARED reserved families and `seen` for the rest.
const FPR_AXES = [
  "lengthBucket",
  "domain",
  "humanSourceType",
  "temporalCohort",
  "hardNegativeFamily",
] as const;
const RECALL_AXES = [
  "lengthBucket",
  "domain",
  "generatorExposure",
  "transformation",
  "mixedFractionBucket",
] as const;

/**
 * @param declaredHeldOutGeneratorFamilies the reservation itself
 *   (`manifest.heldOutGeneratorFamilies`). REQUIRED, and positioned ahead of the
 *   axis map because the audit cannot check that a reservation was honored without
 *   being told which families were reserved. An empty list states "nothing was
 *   reserved", which is a legitimate corpus and not a missing argument: the audit
 *   then honors nothing, and every test-only family is reported as incidental.
 * @param declaredGroupAxes `provenance.sourceId` -> the axes that source declares
 *   applicable (`HumanSourceRegistrationV1.declaredGroupAxes`). Passed in as a
 *   plain map rather than imported, for the same reason
 *   `assertDeclaredAxesResolved` takes a list: this module must not reach for the
 *   source manifest. An absent entry means the source declared nothing to compare
 *   against, and the audit stays silent about it — which is why the map has to be
 *   supplied by the command that owns both halves.
 */
export function auditBlockedSplit(
  records: readonly BenchmarkRecord[],
  split: DatasetSplitInput,
  policy: SplitAuditPolicy,
  declaredHeldOutGeneratorFamilies: readonly GeneratorFamily[],
  declaredGroupAxes: ReadonlyMap<string, readonly GroupAxis[]> = new Map(),
): SplitAudit {
  const byPartition: Record<Partition, readonly BenchmarkRecord[]> = {
    train: split.train,
    dev: split.dev,
    "cal-A": split["cal-A"],
    "cal-B": split["cal-B"],
    test: split.test,
  };

  const testHumanNegativeCount = byPartition.test.filter(
    (row) => row.label === "human",
  ).length;
  const testHumanNegatives = {
    count: testHumanNegativeCount,
    reportingThreshold: policy.minimumTestHumanNegatives,
    sufficientForReleaseFpr:
      testHumanNegativeCount >= policy.minimumTestHumanNegatives,
  };

  const sizes = auditSizes(byPartition);
  const classFractions = auditClassFractions(records, byPartition);
  const cutoffs = auditCutoffs(byPartition);
  const leakages = auditLeakages(records, byPartition);
  const clusters = auditClusters(records, byPartition);
  const declaredAxisGaps = auditDeclaredAxes(records, declaredGroupAxes);

  const { honored, incidental } = auditReservation(
    records,
    split.test,
    declaredHeldOutGeneratorFamilies,
  );
  // The exposure axis is keyed on the DECLARED set and not on the honored one, for
  // the same reason benchmark/slices.ts keys it on the published list: the question
  // is "was this family reserved", and answering it with the honored subset would
  // relabel a violated reservation as `seen` — hiding, in the published audit, the
  // very divergence the exact equality is about to fail on.
  const criticalSliceSamples = auditCriticalSlices(
    records,
    split.test,
    declaredHeldOutGeneratorFamilies,
    policy,
  );

  const corpusTotals = new Map<BenchmarkLabel, number>();
  for (const record of records) {
    corpusTotals.set(record.label, (corpusTotals.get(record.label) ?? 0) + 1);
  }
  const reasons = collectReasons(
    classFractions,
    cutoffs,
    leakages,
    declaredAxisGaps,
    byPartition,
    policy,
    corpusTotals,
  );

  return {
    sizes,
    classFractions,
    cutoffs,
    leakages,
    clusters,
    declaredAxisGaps,
    criticalSliceSamples,
    testHumanNegatives,
    heldOutGeneratorFamilies: honored,
    incidentalTestOnlyGeneratorFamilies: incidental,
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * The axes a cluster report over THESE record-lines carries, in {@link ALL_GROUP_AXES}
 * order.
 *
 * Derived from the records and never pinned to one version's tuple. A v4 corpus read
 * against the v3 tuple publishes `collectionBatch` with `states.unknown = N` — an axis
 * nobody declared, reported as broken rather than as absent — and OMITS the three axes
 * v4 introduced, including the two members of {@link REPORTED_GROUP_AXES} that only v4
 * names. A mixed-version corpus carries the union, because each record answers for its
 * own version.
 */
function reportedAxesOf(records: readonly BenchmarkRecord[]): GroupAxis[] {
  const declared = new Set<GroupAxis>();
  for (const record of records) {
    for (const axis of recordGroupAxes(record)) declared.add(axis);
  }
  return ALL_GROUP_AXES.filter((axis) => declared.has(axis));
}

/**
 * A stand-in cluster report for a HAND-BUILT audit object in a test fixture.
 *
 * `auditBlockedSplit` never returns this: it measures. It exists so a fixture that
 * only needs a structurally valid `SplitAudit` does not have to fabricate counts,
 * and it is deliberately all-zero so a fixture that leaks into a real assertion is
 * obviously empty rather than plausibly wrong.
 *
 * `axes` is REQUIRED, and a default would defeat the purpose: a fixture standing in
 * for a v4 audit has to say so, because the axis list is exactly what the two versions
 * disagree about. Pass the tuple of the version the fixture models.
 */
export function standInClusterReport(
  axes: readonly GroupAxis[],
): SplitClusterReport {
  return {
    axes: axes.map((axis) => {
      return {
        axis,
        connectivity: connectivityReport(axis, () => ({
          references: 0,
          joinedAnotherRecordLine: 0,
          selfReference: 0,
          absentFromRecordSet: 0,
        })),
        states: { known: 0, notApplicable: 0, unknown: 0 },
        overall: { groups: 0, largest: 0, singletons: 0, recordLines: 0 },
        bySlice: [],
      };
    }),
    connected: {
      overall: { groups: 0, largest: 0, singletons: 0, recordLines: 0 },
      bySlice: [],
    },
  };
}

function auditSizes(
  byPartition: Record<Partition, readonly BenchmarkRecord[]>,
): Record<Partition, number> {
  return {
    train: byPartition.train.length,
    dev: byPartition.dev.length,
    "cal-A": byPartition["cal-A"].length,
    "cal-B": byPartition["cal-B"].length,
    test: byPartition.test.length,
  };
}

function auditClassFractions(
  records: readonly BenchmarkRecord[],
  byPartition: Record<Partition, readonly BenchmarkRecord[]>,
): Record<BenchmarkLabel, Record<Partition, number>> {
  const totals = new Map<BenchmarkLabel, number>();
  for (const record of records) {
    totals.set(record.label, (totals.get(record.label) ?? 0) + 1);
  }
  const fractions = {} as Record<BenchmarkLabel, Record<Partition, number>>;
  for (const label of LABELS) {
    fractions[label] = { train: 0, dev: 0, "cal-A": 0, "cal-B": 0, test: 0 };
  }
  for (const partition of PARTITIONS) {
    for (const record of byPartition[partition]) {
      const total = totals.get(record.label) ?? 0;
      if (total > 0) fractions[record.label][partition] += 1 / total;
    }
  }
  return fractions;
}

const latestOf = (rows: readonly BenchmarkRecord[]): number =>
  rows.length === 0
    ? Number.NEGATIVE_INFINITY
    : Math.max(...rows.map((row) => row.createdAt));

const earliestOf = (rows: readonly BenchmarkRecord[]): number =>
  rows.length === 0
    ? Number.POSITIVE_INFINITY
    : Math.min(...rows.map((row) => row.createdAt));

function auditCutoffs(
  byPartition: Record<Partition, readonly BenchmarkRecord[]>,
): SplitAudit["cutoffs"] {
  const latest = latestOf;
  const earliest = earliestOf;
  return {
    latestTrain: latest(byPartition.train),
    latestDev: latest(byPartition.dev),
    latestCalA: latest(byPartition["cal-A"]),
    latestCalB: latest(byPartition["cal-B"]),
    earliestCalA: earliest(byPartition["cal-A"]),
    earliestCalB: earliest(byPartition["cal-B"]),
    earliestTest: earliest(byPartition.test),
  };
}

function auditLeakages(
  records: readonly BenchmarkRecord[],
  byPartition: Record<Partition, readonly BenchmarkRecord[]>,
): SplitAudit["leakages"] {
  const leakages: SplitAudit["leakages"] = [];

  // Per-value checks on each grouping axis the splitter unions by VALUE.
  for (const axis of GROUP_KEYS) {
    const partitionsByValue = new Map<string, Set<Partition>>();
    for (const partition of PARTITIONS) {
      for (const record of byPartition[partition]) {
        // Same accessor the splitter uses, for the same reason: the audit must
        // enumerate the identities the splitter did, not a second reading of them.
        const value = groupAxisIdentity(record, axis);
        if (value === undefined) continue;
        const set = partitionsByValue.get(value) ?? new Set<Partition>();
        set.add(partition);
        partitionsByValue.set(value, set);
      }
    }
    for (const [value, set] of partitionsByValue) {
      if (set.size > 1) {
        leakages.push({
          axis,
          value,
          partitions: PARTITIONS.filter((partition) => set.has(partition)),
        });
      }
    }
  }

  // Full-connectivity check. Re-derive the exact connected components the
  // splitter builds — value-axes AND the parent/derivative chain linkage — and
  // flag any component whose records straddle partitions. This catches a
  // depth->=2 derivation chain (child in test, parent in train) that no
  // single value-axis reveals, because grandparent and grandchild never share a
  // derivationRoot value directly.
  const roots = connectedComponentRoots(records);
  const partitionOfId = new Map<string, Partition>();
  for (const partition of PARTITIONS) {
    for (const record of byPartition[partition]) {
      partitionOfId.set(record.id, partition);
    }
  }
  const spanByRoot = new Map<string, Set<Partition>>();
  const labelIdByRoot = new Map<string, string>();
  for (const record of records) {
    const root = roots.get(record.id);
    const partition = partitionOfId.get(record.id);
    if (root === undefined || partition === undefined) continue;
    const set = spanByRoot.get(root) ?? new Set<Partition>();
    set.add(partition);
    spanByRoot.set(root, set);
    const smallest = labelIdByRoot.get(root);
    if (smallest === undefined || record.id < smallest) {
      labelIdByRoot.set(root, record.id);
    }
  }
  for (const [root, set] of spanByRoot) {
    if (set.size > 1) {
      leakages.push({
        axis: "connectedComponent",
        value: labelIdByRoot.get(root) ?? root,
        partitions: PARTITIONS.filter((partition) => set.has(partition)),
      });
    }
  }
  return leakages;
}

// --- the cluster report -----------------------------------------------------

function countGroups(sizes: readonly number[]): ClusterCount {
  let largest = 0;
  let singletons = 0;
  let recordLines = 0;
  for (const size of sizes) {
    if (size > largest) largest = size;
    if (size === 1) singletons += 1;
    recordLines += size;
  }
  return { groups: sizes.length, largest, singletons, recordLines };
}

// The slice keys one record-line belongs to. `partition` comes from the caller
// because it is a property of the SPLIT and not of the record.
function sliceKeysOf(
  record: BenchmarkRecord,
  partition: Partition,
): Record<ClusterSliceAxis, string | undefined> {
  return {
    partition,
    label: record.label,
    lengthBucket: lengthBucket(record.wordCount),
    domain: record.domain,
    humanSourceType: record.humanSourceType,
  };
}

/**
 * Counts the independent clusters this split offers, per axis and per slice, plus
 * the connected component of the axis union — the split/exposure cluster.
 *
 * The per-axis identities are read through `groupAxisIdentity`, the SAME accessor
 * the splitter and the leakage check use, so the three cannot enumerate different
 * identities. The component count delegates to `connectedComponentRoots` for the
 * same reason.
 */
function auditClusters(
  records: readonly BenchmarkRecord[],
  byPartition: Record<Partition, readonly BenchmarkRecord[]>,
): SplitClusterReport {
  const partitionOf = new Map<string, Partition>();
  for (const partition of PARTITIONS) {
    for (const record of byPartition[partition]) {
      partitionOf.set(record.id, partition);
    }
  }
  // Only assigned records are counted: an unassigned row is a defect the
  // completeness check in split-artifact.ts refuses, not a cluster.
  const assigned = records.filter((record) => partitionOf.has(record.id));

  const axes = reportedAxesOf(assigned).map((axis) => {
    const states: Record<GroupAxisState, number> = {
      known: 0,
      notApplicable: 0,
      unknown: 0,
    };
    const overall = new Map<string, number>();
    const bySlice = new Map<string, Map<string, number>>();
    for (const record of assigned) {
      states[groupAxisState(record, axis)] += 1;
      const identity = groupAxisIdentity(record, axis);
      if (identity === undefined) continue;
      overall.set(identity, (overall.get(identity) ?? 0) + 1);
      const keys = sliceKeysOf(record, partitionOf.get(record.id) as Partition);
      for (const slice of CLUSTER_SLICE_AXES) {
        const key = keys[slice];
        if (key === undefined) continue;
        const bucketKey = `${slice}${KEY_SEP}${key}`;
        const bucket = bySlice.get(bucketKey) ?? new Map<string, number>();
        bucket.set(identity, (bucket.get(identity) ?? 0) + 1);
        bySlice.set(bucketKey, bucket);
      }
    }
    return {
      axis,
      connectivity: connectivityReport(axis, () =>
        measureLinkage(assigned, axis),
      ),
      states,
      overall: countGroups([...overall.values()]),
      bySlice: toSliceCounts(bySlice),
    };
  });

  const roots = connectedComponentRoots(assigned);
  const overall = new Map<string, number>();
  const bySlice = new Map<string, Map<string, number>>();
  for (const record of assigned) {
    const root = roots.get(record.id) as string;
    overall.set(root, (overall.get(root) ?? 0) + 1);
    const keys = sliceKeysOf(record, partitionOf.get(record.id) as Partition);
    for (const slice of CLUSTER_SLICE_AXES) {
      const key = keys[slice];
      if (key === undefined) continue;
      const bucketKey = `${slice}${KEY_SEP}${key}`;
      const bucket = bySlice.get(bucketKey) ?? new Map<string, number>();
      bucket.set(root, (bucket.get(root) ?? 0) + 1);
      bySlice.set(bucketKey, bucket);
    }
  }

  return {
    axes,
    connected: {
      overall: countGroups([...overall.values()]),
      bySlice: toSliceCounts(bySlice),
    },
  };
}

/**
 * Builds the published connectivity, and is the ONE place that decides whether the
 * linkage measurement is due.
 *
 * `measure` is a thunk on purpose: the counting walks the whole record set, and an
 * axis that is not followed as parent linkage must not pay for a number the report
 * is going to state as `null` anyway. It also keeps the branch that decides
 * "measured / does not arise" in a single place, so the audit and
 * {@link standInClusterReport} cannot disagree about which axes carry a resolution.
 */
function connectivityReport(
  axis: GroupAxis,
  measure: () => LinkageResolution,
): AxisConnectivityReport {
  const connectivity = axisConnectivity(axis);
  return connectivity.parentLinkage
    ? { ...connectivity, parentLinkage: true, linkage: measure() }
    : { ...connectivity, parentLinkage: false, linkage: null };
}

/**
 * Measures what a parent-linkage axis's references resolved to, over the SAME
 * record set the components were built from.
 *
 * The three branches are the predicate `connectedComponentRoots` applies, written
 * out: `parent !== undefined && parent !== record.id && ids.has(parent)`. Only the
 * middle branch unions. If that predicate ever changes, this counter has to change
 * with it — which is the point of stating it here rather than describing it.
 */
function measureLinkage(
  records: readonly BenchmarkRecord[],
  axis: GroupAxis,
): LinkageResolution {
  const ids = new Set(records.map((record) => record.id));
  const resolution: LinkageResolution = {
    references: 0,
    joinedAnotherRecordLine: 0,
    selfReference: 0,
    absentFromRecordSet: 0,
  };
  for (const record of records) {
    const parent = groupAxisIdentity(record, axis);
    if (parent === undefined) continue;
    resolution.references += 1;
    if (parent === record.id) {
      resolution.selfReference += 1;
    } else if (ids.has(parent)) {
      resolution.joinedAnotherRecordLine += 1;
    } else {
      resolution.absentFromRecordSet += 1;
    }
  }
  return resolution;
}

function toSliceCounts(
  bySlice: ReadonlyMap<string, ReadonlyMap<string, number>>,
): ClusterSliceCount[] {
  const rows: ClusterSliceCount[] = [];
  for (const [bucketKey, groups] of bySlice) {
    const [slice, key] = bucketKey.split(KEY_SEP);
    rows.push({
      slice: slice as ClusterSliceAxis,
      key,
      count: countGroups([...groups.values()]),
    });
  }
  rows.sort((a, b) => {
    const left = CLUSTER_SLICE_AXES.indexOf(a.slice);
    const right = CLUSTER_SLICE_AXES.indexOf(b.slice);
    if (left !== right) return left - right;
    return a.key < b.key ? -1 : a.key > b.key ? 1 : 0;
  });
  return rows;
}

/**
 * Which axes a source DECLARED applicable were left `unknown` by its records.
 *
 * The join key is `provenance.sourceId`, which is the same token
 * `HumanSourceRegistrationV1.sourceId` carries. A record of a source the map does
 * not mention is not examined: there is no declaration to contradict, and
 * inventing one would be inventing the very thing the declaration exists to make
 * checkable.
 *
 * The reading is VERSION-AWARE, and that is load-bearing now that a source may
 * declare an axis only v4 has. Plain {@link groupAxisState} maps an ABSENT key to
 * `unknown`, which is the truthful reading for ELIGIBILITY and the wrong one for a
 * refusal: it would fault every v2 and v3 record for leaving `sourceMaterialBatch`
 * unrecovered when their schema version has no such key to fill.
 *
 * Version awareness is asked two ways because the versions answer it two ways, and
 * reading only the key's presence ({@link groupAxisDeclaredState} alone) is too weak:
 * v3 and v4 make every axis key MANDATORY, so their own tuple is exact and an absent
 * key there is a MALFORMED row rather than a version that was never asked — a v4 row
 * whose `sourceMaterialBatch` key went missing answers the declaration with nothing at
 * all, and must still be a gap. A v2 `groups` block carries nine keys and no states,
 * and {@link recordGroupAxes} answers for it with the v3 tuple, so for v2 only the
 * key's own presence can be read.
 */
function auditDeclaredAxes(
  records: readonly BenchmarkRecord[],
  declaredGroupAxes: ReadonlyMap<string, readonly GroupAxis[]>,
): DeclaredAxisGap[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const declared = declaredGroupAxes.get(record.provenance.sourceId);
    if (declared === undefined) continue;
    for (const axis of declared) {
      const versionHasAxis =
        record.schemaVersion === 2
          ? groupAxisDeclaredState(record, axis) !== undefined
          : (recordGroupAxes(record) as readonly string[]).includes(axis);
      if (!versionHasAxis) continue;
      if (groupAxisState(record, axis) !== "unknown") continue;
      const key = `${record.provenance.sourceId}${KEY_SEP}${axis}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([key, recordLines]) => {
      const [sourceId, axis] = key.split(KEY_SEP);
      return {
        sourceId,
        axis: axis as GroupAxis,
        state: "unknown" as const,
        recordLines,
      };
    })
    .sort((a, b) =>
      a.sourceId === b.sourceId
        ? a.axis < b.axis
          ? -1
          : 1
        : a.sourceId < b.sourceId
          ? -1
          : 1,
    );
}

/**
 * Reads the reservation back off the partitions: which DECLARED families the split
 * honored, and which families concentrated in `test` without being declared.
 *
 * The predicate is the property a reservation actually asserts — every record-line
 * of the family is in `test` and none is anywhere else — and it is measured over
 * the WHOLE record set rather than over the non-test partitions. A record-line
 * assigned to no partition at all therefore withdraws the reservation too, instead
 * of passing for "absent from the partitions that were checked". (Such a row is separately
 * refused as
 * an incomplete assignment by benchmark/split-artifact.ts; the reservation must not
 * be the one place it reads as harmless.)
 *
 * The canonical field is read through `generatorFamilyOf`. Reading
 * `row.generation?.family` here would derive the provider's dotted labels, which
 * could never equal the underscore-spelled families the manifest declares — so the
 * audit's set and the declared set would be incomparable by construction.
 */
function auditReservation(
  records: readonly BenchmarkRecord[],
  test: readonly BenchmarkRecord[],
  declared: readonly GeneratorFamily[],
): { honored: GeneratorFamily[]; incidental: GeneratorFamily[] } {
  const testIds = new Set(test.map((row) => row.id));
  const tally = new Map<GeneratorFamily, { total: number; inTest: number }>();
  for (const row of records) {
    const family = generatorFamilyOf(row);
    if (family === undefined) continue;
    const counts = tally.get(family) ?? { total: 0, inTest: 0 };
    counts.total += 1;
    if (testIds.has(row.id)) counts.inTest += 1;
    tally.set(family, counts);
  }
  const testOnly = (family: GeneratorFamily): boolean => {
    const counts = tally.get(family);
    return (
      counts !== undefined && counts.total > 0 && counts.inTest === counts.total
    );
  };
  const declaredSet = new Set(declared);
  return {
    honored: sortGeneratorFamilies(declared.filter(testOnly)),
    incidental: sortGeneratorFamilies(
      [...tally.keys()].filter(
        (family) => !declaredSet.has(family) && testOnly(family),
      ),
    ),
  };
}

function auditCriticalSlices(
  records: readonly BenchmarkRecord[],
  test: readonly BenchmarkRecord[],
  declaredHeldOutGeneratorFamilies: readonly GeneratorFamily[],
  policy: SplitAuditPolicy,
): SplitAudit["criticalSliceSamples"] {
  const held = new Set(declaredHeldOutGeneratorFamilies);
  const cohortOf = temporalCohortResolver(records);
  const extractors: Record<
    string,
    (record: BenchmarkRecord) => string | undefined
  > = {
    lengthBucket: (record) => lengthBucket(record.wordCount),
    domain: (record) => record.domain,
    humanSourceType: (record) => record.humanSourceType,
    temporalCohort: (record) => cohortOf(record.createdAt),
    hardNegativeFamily: (record) => record.hardNegativeFamily,
    generatorExposure: (record) => {
      const family = generatorFamilyOf(record);
      if (family === undefined) return undefined;
      return held.has(family) ? "unseen" : "seen";
    },
    transformation: (record) => record.transformation.kind,
    // The floor is the frozen `materialAssistance.minimumAiFraction`, read from
    // the policy rather than written here: this is the SAME 0.50 that defines the
    // material-assistance target in benchmark/metrics.ts, and a second copy of it
    // as a literal is how one side of the pipeline ends up calling a row a
    // positive that the other side does not.
    //
    // Deliberately NOT cohort-keyed, unlike the `mixedFraction` axis in
    // benchmark/slices.ts. This axis audits the blind partition's COVERAGE of the
    // two fraction bands (does test hold enough of each to sample a critical
    // recall slice), and it is never a metric denominator: nothing here reads a
    // rate. Splitting it by cohort would halve two coverage counts to describe a
    // cohort that does not exist yet, and `ecological` has no records in v3 (only
    // `mechanistic` is producible — see the frozen table), so the two keys would
    // be identical to these by construction. If an ecological sample ever lands,
    // this axis must be split before its counts are read as per-cohort power.
    //
    // The two key names spell the frozen floor, so moving
    // `materialAssistance.minimumAiFraction` means renaming them in the same
    // change — deliberately a rename and not a silently recomputed label, because
    // these keys identify rows of a published audit.
    mixedFractionBucket: (record) =>
      record.mixture === undefined
        ? undefined
        : record.mixture.aiFraction >=
            PREREGISTRATION_V4.materialAssistance.minimumAiFraction
          ? "ai-ge-50"
          : "ai-lt-50",
  };

  const fprAxes = new Set<string>(FPR_AXES);
  const recallAxes = new Set<string>(RECALL_AXES);
  const axes = [...new Set<string>([...FPR_AXES, ...RECALL_AXES])];

  const samples: SplitAudit["criticalSliceSamples"] = [];
  for (const axis of axes) {
    const counts = new Map<string, { negatives: number; positives: number }>();
    for (const record of test) {
      const key = extractors[axis](record);
      if (key === undefined) continue;
      const bucket = counts.get(key) ?? { negatives: 0, positives: 0 };
      if (record.label === "human") bucket.negatives += 1;
      else bucket.positives += 1;
      counts.set(key, bucket);
    }
    const keys = [...counts.keys()].sort((a, b) =>
      a < b ? -1 : a > b ? 1 : 0,
    );
    for (const key of keys) {
      const bucket = counts.get(key)!;
      samples.push({
        axis,
        key,
        negatives: bucket.negatives,
        positives: bucket.positives,
        fprGateEligible:
          fprAxes.has(axis) &&
          bucket.negatives >= policy.minimumCriticalFprNegatives,
        recallGateEligible:
          recallAxes.has(axis) &&
          bucket.positives >= policy.minimumCriticalRecallPositives,
      });
    }
  }
  return samples;
}

function lengthBucket(wordCount: number): string {
  if (wordCount < 100) return "short";
  if (wordCount < 300) return "medium";
  return "long";
}

function temporalCohortResolver(
  records: readonly BenchmarkRecord[],
): (createdAt: number) => string {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const record of records) {
    if (record.createdAt < min) min = record.createdAt;
    if (record.createdAt > max) max = record.createdAt;
  }
  const span = max - min;
  return (createdAt: number): string => {
    if (span <= 0) return "cohort-0";
    const index = Math.min(3, Math.floor(((createdAt - min) / span) * 4));
    return `cohort-${index}`;
  };
}

function collectReasons(
  classFractions: Record<BenchmarkLabel, Record<Partition, number>>,
  cutoffs: SplitAudit["cutoffs"],
  leakages: SplitAudit["leakages"],
  declaredAxisGaps: readonly DeclaredAxisGap[],
  byPartition: Record<Partition, readonly BenchmarkRecord[]>,
  policy: SplitAuditPolicy,
  /**
   * How many record-lines of each class the CORPUS holds — not the split.
   *
   * It has to come from the corpus and not from `byPartition`, because the two differ in
   * exactly the case that matters: a class with no records at all has no fraction to
   * check, while a class that HAS records none of which reached a partition must fail.
   * Both read as all-zero fractions, and only the corpus count separates them.
   */
  corpusTotals: ReadonlyMap<BenchmarkLabel, number>,
): string[] {
  const reasons: string[] = [];

  if (leakages.length > 0) {
    reasons.push(
      `grouping leakage: ${leakages.length} group value(s) cross partitions`,
    );
  }

  // A declared axis left `unknown` is a hard failure, not a note: the source says
  // the dependence exists, the extractor did not recover it, and a split built on
  // an axis nobody filled is a split whose independence claim has no support. This
  // is the ONE direction that fails — `notApplicable` does not appear here.
  for (const gap of declaredAxisGaps) {
    reasons.push(
      `source ${gap.sourceId} declares axis "${gap.axis}" applicable and ` +
        `${gap.recordLines} record-line(s) leave it unknown: those record-lines are ` +
        "ineligible and the axis cannot support the split",
    );
  }

  // `test` is the only STRICT block: nothing anywhere else may be as new as its
  // earliest record, against all four other partitions. Comparing against the newest of the
  // four would be EQUIVALENT — `x > max(a,b,c,d)` is the four comparisons — so the four are
  // written out for the message they produce, naming which partition `test` reaches into. What
  // would NOT be equivalent is a CHAIN of neighbour-to-neighbour comparisons, which says
  // nothing about a partition that is not `test`'s immediate neighbour.
  //
  // This is the check that catches transposing `cal-B` with `test` — the one mutation
  // no fraction test can see, since the two share the target 0.20 and a swapped pair
  // hits all fifteen fraction targets exactly.
  // `test` strictly newer than every one of the other four, each compared separately.
  //
  // `train` is in this comparison deliberately, and NOT because construction guarantees it:
  // `train` is the fallback, so a component straddling the last cut lands there with records
  // on both sides of it. That is test-period text sitting in training data, which is real
  // leakage, and the audit is the only place that can refuse it.
  const testIsStrictlyNewest = PARTITIONS.every((partition) => {
    if (partition === "test") return true;
    if (byPartition.test.length === 0) return true;
    if (byPartition[partition].length === 0) return true;
    return cutoffs.earliestTest > latestOf(byPartition[partition]);
  });

  // The three MIDDLE partitions are strictly ordered EARLIEST against LATEST, which is
  // both stronger and true: each holds only components lying entirely inside its own
  // band, so `latest(dev) <= devCut < earliest(cal-A)`.
  //
  // `train` is excluded, and that exclusion is the whole point. It absorbs every
  // straddling component, so its newest record can exceed any middle partition's while
  // the split is perfectly legal — a chain that included it refused splits
  // `createBlockedSplit` legitimately produces. `test` is excluded because the check
  // above already states the stronger thing about it.
  const middlePartitions = PARTITIONS.slice(1, -1);
  const middleIsOrdered = middlePartitions.every((partition, index) => {
    if (index === 0) return true;
    const previous = middlePartitions[index - 1] as Partition;
    if (byPartition[partition].length === 0) return true;
    if (byPartition[previous].length === 0) return true;
    return earliestOf(byPartition[partition]) > latestOf(byPartition[previous]);
  });

  // Every vacuity guard above is safe ONLY because an empty partition is refused
  // elsewhere: all five targets exceed `classTolerance`, so a partition holding no
  // record fails the class-fraction check below for every class. Weaken a target below
  // the tolerance and these guards start hiding a real temporal defect.
  if (!testIsStrictlyNewest) {
    reasons.push(
      "temporal leakage: the blocked test is not strictly newer than every other partition",
    );
  }
  if (!middleIsOrdered) {
    reasons.push(
      "temporal leakage: dev, cal-A and cal-B are not strictly ordered in time",
    );
  }

  // A class the corpus does not contain has no fraction to check. `scoreCut` in the
  // splitter already skips it (`if (total === 0) continue`), so checking it here made the
  // two halves disagree about the same corpus: the splitter would produce a split the
  // audit then refused for a class that has no records at all.
  //
  // This cannot hide a release corpus missing a class: `sealDataset` pins the per-class
  // counts exactly for `scientificUse: "release"`, so a class of zero is refused before
  // the split runs. For an `infrastructure-only` corpus a missing class is legitimate, and
  // `classFractions` still publishes the zeros.
  for (const label of LABELS) {
    if ((corpusTotals.get(label) ?? 0) === 0) continue;
    for (const partition of PARTITIONS) {
      const fraction = classFractions[label][partition];
      if (
        !withinClassTolerance(
          fraction,
          PARTITION_TARGETS[partition],
          policy.classTolerance,
        )
      ) {
        reasons.push(
          `class ${label} ${partition} fraction ${fraction.toFixed(3)} is outside ±${policy.classTolerance} of ${PARTITION_TARGETS[partition]}`,
        );
      }
    }
  }

  return reasons;
}
