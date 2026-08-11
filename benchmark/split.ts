// The leakage-safe blocked temporal split: `createBlockedSplit` partitions a sealed
// corpus into train/dev/cal-A/cal-B/test, the five proportions the v3 pre-registration
// froze (45/5/10/20/20) for the classifier design §6.4.
//
// It refuses the leakage that would inflate benchmark scores, and it is fail-closed:
// it never relaxes grouping or time to hit a target, it throws instead.
//
// Standalone module: MUST NOT import from the extension bundle (src/).

import { createHash } from "node:crypto";

import {
  generatorFamilyOf,
  sortGeneratorFamilies,
  type GeneratorFamily,
} from "./generator-family.ts";
import {
  groupAxisIdentity,
  type BenchmarkLabel,
  type BenchmarkRecord,
  type GroupAxis,
} from "./schema.ts";

/**
 * The five partitions, in TEMPORAL order — the order is load-bearing, not cosmetic:
 * `CUT_PARTITIONS` is derived from it, and the audit's chain check reads the same
 * sequence.
 *
 * `Partition` is derived from this tuple rather than written twice. Two spellings of
 * one closed vocabulary is how a partition ends up in the type and out of the
 * enumeration a loop iterates, which leaves its class fraction unwatched.
 *
 * The hyphenated spelling is the one the exposure ledger validates persisted events
 * against (`LEDGER_PARTITIONS`), so it is the spelling that cannot move without
 * rewriting history. NOTHING may validate these names with `\w`, `\b` or `/^[a-z]+$/`:
 * `cal-A` carries a hyphen and a capital, and every one of those would reject it.
 */
export const PARTITIONS = ["train", "dev", "cal-A", "cal-B", "test"] as const;

/**
 * The frozen class-fraction tolerance, as a VALUE and not only as a literal type.
 *
 * A sealed artifact is loaded from JSON by every command, so `classTolerance: 0.02`
 * on the policy type says nothing about a file on disk. This is what a runtime check
 * can compare against.
 */
export const CLASS_TOLERANCE = 0.02;

/**
 * The epsilon every tolerance comparison adds, and the ONE place it is written.
 *
 * The tolerance is INCLUSIVE — the contract states that a `dev` holding exactly 3% or 7% of a
 * class is legal — and binary floats make the boundary unrepresentable: in IEEE-754,
 * `Math.abs(0.03 - 0.05)` is `0.020000000000000004`, strictly greater than `0.02`. Comparing
 * raw floats therefore refuses precisely the two values the contract admits.
 *
 * EVERY comparison against `classTolerance` goes through {@link withinClassTolerance},
 * {@link atMostWithinTolerance} or {@link atLeastWithinTolerance}. A comparison written inline
 * reopens the boundary for that one cut, which is invisible to a test that exercises only the
 * helper.
 */
export const CLASS_TOLERANCE_EPSILON = 1e-9;

/** `|fraction - target| <= tolerance`, with the boundary INCLUDED. */
export function withinClassTolerance(
  fraction: number,
  target: number,
  tolerance: number = CLASS_TOLERANCE,
): boolean {
  return Math.abs(fraction - target) <= tolerance + CLASS_TOLERANCE_EPSILON;
}

/**
 * The two HALVES of the same tolerance, for the places that only bound one side.
 *
 * The search prunes on one side at a time — a train share cannot exceed its ceiling, a middle
 * band cannot fall under its floor — and writing those as `share > target + tolerance` reopens
 * the boundary bug one comparison at a time. Both go through the same epsilon as
 * {@link withinClassTolerance}, so there is ONE numeric semantics and not three.
 */
export function atMostWithinTolerance(
  share: number,
  target: number,
  tolerance: number = CLASS_TOLERANCE,
): boolean {
  return share <= target + tolerance + CLASS_TOLERANCE_EPSILON;
}

export function atLeastWithinTolerance(
  share: number,
  target: number,
  tolerance: number = CLASS_TOLERANCE,
): boolean {
  return share >= target - tolerance - CLASS_TOLERANCE_EPSILON;
}

export type Partition = (typeof PARTITIONS)[number];

/**
 * The partitions a prediction manifest may name — the three the scoring lane ever
 * touches, and a NARROWING of {@link Partition} rather than a vocabulary beside it.
 *
 * The narrowing is the point: it makes `cal-B` and `train` UNREPRESENTABLE in a
 * prediction artifact, so no scoring path can name either one even by mistake. `cal-B`
 * has to stay byte-untouched until the v2 blind measurement, and `train` is the
 * detector's own training data — fitting a threshold on it is precisely the leak the
 * split exists to prevent.
 */
export const SCORING_PARTITIONS = [
  "dev",
  "cal-A",
  "test",
] as const satisfies readonly Partition[];

export type ScoringPartition = (typeof SCORING_PARTITIONS)[number];

/**
 * The partitions `fit` may consume: the scoring partitions minus the blind block.
 * Named POSITIVELY on purpose. The negative form `partition !== "test"` describes the same
 * set only while there are three names; with five it silently admits `train` and `cal-B`.
 */
export const FIT_PARTITIONS = [
  "dev",
  "cal-A",
] as const satisfies readonly Partition[];

export type FitPartition = (typeof FIT_PARTITIONS)[number];

/**
 * The four cuts, each named by the partition it CLOSES. `test` closes none: it is
 * everything after the last cut. Derived from {@link PARTITIONS} so the cut list
 * cannot fall out of step with the partition list.
 */
const CUT_PARTITIONS: readonly Partition[] = PARTITIONS.slice(0, -1);

export interface DatasetSplit<T> {
  train: T[];
  dev: T[];
  "cal-A": T[];
  "cal-B": T[];
  test: T[];
}

export interface BlockedSplitPolicy {
  fractions: {
    train: 0.45;
    dev: 0.05;
    "cal-A": 0.1;
    "cal-B": 0.2;
    test: 0.2;
  };
  // Absolute, not relative to the target, and therefore NOT uniform across the five:
  // fifteen constraints over four degrees of freedom in aggregate, but `dev`'s target
  // is 0.05, so two absolute points is forty percent of it — a `dev` holding 3% or 7%
  // of a class is legal here. That band is a consequence of the number, not a defect.
  classTolerance: 0.02;
  // Canonical families only (benchmark/generator-family.ts). The nominal type makes
  // matching this set against `generation.family` — the provider's dotted label — a
  // compile error instead of a silent no-op.
  heldOutGeneratorFamilies: readonly GeneratorFamily[];
  seed: number;
}

/**
 * The connected-component axes: every axis two record-lines are unioned by when
 * they carry the SAME identity on it.
 *
 * THE LIST HAS A CRITERION, and it is a NECESSARY condition — never a definition.
 * Every axis here satisfies at least one of
 *
 *   (a) it identifies MATERIAL — it is a member of `EXPOSURE_IDENTITY_AXES`
 *       (benchmark/cluster-exposure-ledger.ts), the list a gate already executes to
 *       decide that the same SAMPLING UNIT reappeared — or
 *   (b) unioning on it is INERT over the corpus MEASURED, which is a measurement and not
 *       an argument: that corpus has the same number of components with the axis in this
 *       list and without it. Inertness is a property of the corpus and not of the axis,
 *       so the scope travels with the claim. The members admitted on that ground are
 *       named in {@link INERT_UNION_AXES}, so the two legs are a list each and a test
 *       holds this list against their union.
 *
 * `author`, `source` and `derivationRoot` are here by (a). `nearDuplicate` and
 * `generationBatch` are here by (b): after pruning, `nearDuplicate` is the row's own
 * id (1170 identities over the 1170 assembled generated lines), and `generationBatch`
 * is `unknown` on every generated row until the assembler derives it AFTER
 * partitioning, from a key that contains `generatedAt` — which the block stamp
 * overwrites with the block's own time, so a batch is confined to one block and
 * co-locates nothing across a cut. That second entry is therefore CONDITIONAL on the
 * overwrite, and the condition is pinned by test on the assembler's side.
 *
 * THE CONVERSE IS FALSE, and it is not false in the abstract: two axes of this very
 * schema refute it, so an "if and only if" here would publish a claim the tree next to
 * it contradicts.
 *
 *   * `humanSeed` satisfies (a) — `EXPOSURE_IDENTITY_AXES` names it — and is NOT in
 *     this list. It is in {@link PARENT_LINKAGE_AXES}, because its identity names
 *     ANOTHER RECORD-LINE'S ID rather than a value two rows share: unioning it here
 *     would be a different relation, not this one. Read as a biconditional the
 *     criterion concludes that it belongs in this list — the exact change the contract
 *     refused, on the exact axis this file records having published a false
 *     independence claim about once (see {@link CONNECTIVITY_AXES}).
 *   * `extractionRun` satisfies (b) over the corpus that exists, and vacuously: it is
 *     `notApplicable` on all 1170 assembled generated lines, so unioning on it unions
 *     nothing and the component count does not move. It is NOT here either, and for a
 *     reason (b) cannot see — re-extracting one dump produces no new material, so
 *     unioning on it would count one dependence twice. It is DIAGNOSTIC, and named as
 *     such by `PREREGISTRATION_V4.connectivity.diagnosticAxes` rather than by this
 *     comment. The SCOPE of that measurement is the point: over a corpus that holds
 *     human lines the same axis is NOT inert, because one extraction writes thousands of
 *     rows carrying one run id — measured, in the same test. Leg (b) is a property of
 *     the corpus measured, so satisfying it is never a licence to union.
 *
 * So an axis's STANDING is decided by four lists and never by (a)/(b) alone. The
 * function that reads them, total over every axis any version declares, is
 * `groupAxisRole` (benchmark/split-audit.ts):
 *
 *   * UNION BY VALUE — this list. Equal identities are ALWAYS one cluster.
 *   * PARENT LINKAGE — {@link PARENT_LINKAGE_AXES}. Unions only when the named row is
 *     present in the same record set.
 *   * REPORTED — `REPORTED_GROUP_AXES` (benchmark/split-audit.ts): the FOUR whose
 *     inventory the audit takes named responsibility for.
 *   * DIAGNOSTIC — `PREREGISTRATION_V4.connectivity.diagnosticAxes`: `extractionRun`.
 *
 * THE FOUR DO NOT COVER THE FOURTEEN, and the residue is declared here rather than
 * left to be discovered: `generatorFamily`, `generationLane` and `harnessVersion` — and
 * `collectionBatch`, which only v3 declares — are in none of the four. Nothing in the
 * tree takes named responsibility for them; what they do get is the per-partition
 * cluster inventory, which covers them because it is built from every axis the RECORDS
 * declare (`reportedAxesOf`) and not from `REPORTED_GROUP_AXES`. `generatorFamily` is
 * the one with a second mechanism, and it is narrower than a dependence claim: only the
 * RESERVED families are constrained, and only to being test-only. A test walks all
 * fourteen and pins which of the five standings each axis has.
 *
 * `domain` and `groups.generatorFamily` are DELIBERATELY excluded: unioning on them
 * would collapse every LinkedIn record or a whole generator family into one
 * indivisible block. The reserved holdout family is enforced separately, as an
 * explicit test-only constraint.
 *
 * `promptTemplate` and `generatorVersion` are excluded BY THE SAME DECISION, and the
 * arithmetic is measured rather than feared. `promptTemplate` alone has four identities
 * over the 1170 assembled generated lines and its largest is 641, which is 54.79% of
 * the class: above the largest target plus the tolerance, so no partition can receive
 * it whole. `generatorVersion` alone has five, the largest 493 (42.1%), which fits —
 * what does not fit is the pair. The two TOGETHER close transitively (a version run
 * crosses template boundaries and a template crosses version runs) and the whole class
 * becomes ONE component, 100% of it: that closure, and not either axis by itself, is
 * what the exclusion buys. Neither axis identifies material —
 * `EXPOSURE_IDENTITY_AXES` excludes the recipe axes BY NAME, for the reason written
 * there — so they fail (a), and neither is inert, so they fail (b) too.
 *
 * What this comment must NOT say, because it was measured false: that
 * `generatorVersion` carries the identity `generatorFamily` carries. Version REFINES
 * family — five identities against one, agreeing on 0 of the 1170 lines — so unioning
 * on version is strictly WEAKER than unioning on the family, and the family argument
 * of the paragraph above does not reach it.
 *
 * WHAT THAT COSTS, stated because a reader must not take a split under this list for
 * independence: two generated lines grown from one prompt ARE dependent, and after
 * this exclusion the splitter no longer models that dependence. It is carried instead
 * by the two gates that read it — the ledger's eligibility comparison and the frozen
 * resampling table of the estimand class (`PREREGISTRATION_V4.resampling`), which
 * resamples `ai-recall` over family -> template -> batch — so an interval published
 * over `test` REPORTS it. A point estimate does not: a recall or FPR measured in the
 * blind block is a measurement over prompts the training set SAW and seeds it did not,
 * and any report that uses the word independence without that qualifier states
 * something false.
 *
 * `domainSource` and `sourceMaterialBatch` fail (a), and they fail (b) OVER A CORPUS
 * THAT HOLDS HUMAN LINES — which is the scope leg (b) is measured on, and it has to be
 * said, because over the all-generated body both axes are `notApplicable` on every line
 * and are therefore inert there for the same vacuous reason `extractionRun` is. The way
 * they fail is arithmetic rather than taste. There is ONE acquisition event per source
 * and one stratum per quota cell, so either axis unions a whole cell into a single
 * indivisible component. With the one cell the frame declares that component IS the
 * whole `human` class, so its fraction is 100% of the class, `dev`'s 0.05 target is
 * unreachable by construction, every corpus is refused with `SplitConstraintError`, and
 * a floor counted in independent units reads 1 per cell forever. More cells only soften
 * the arithmetic without repairing it — four would read ~25% each, still above `dev`'s
 * target plus tolerance. Both axes still carry dependence — `sourceMaterialBatch`
 * is the declared unit of dependence BETWEEN acquisitions — and they carry it as axes
 * of REGISTRATION, MANIFEST and LEDGER. Neither may be unioned on here. Dependence
 * INSIDE a cell is carried by `author`, `source` (the origin document),
 * `nearDuplicate` and the lineage axes.
 *
 * `satisfies` ties the list to the record schema, so an axis no version declares —
 * a typo, or a renamed axis — is a compile error rather than a key that reads
 * `undefined` on every row and silently unions nothing.
 */
export const GROUP_KEYS = [
  "author",
  "source",
  "generationBatch",
  "nearDuplicate",
  "derivationRoot",
] as const satisfies readonly GroupAxis[];

export type GroupKey = (typeof GROUP_KEYS)[number];

/**
 * The members of {@link GROUP_KEYS} admitted by MEASURED INERTNESS — leg (b) of the
 * criterion — rather than by identifying material.
 *
 * A list and not a sentence, because it is what makes the criterion checkable: the test
 * holds `GROUP_KEYS` against `EXPOSURE_IDENTITY_AXES` plus this list, so an axis added
 * to the union list with neither justification fails there instead of arriving with a
 * paragraph. It states which leg admitted the axis and NOTHING about the other three
 * standings — an axis absent from both lists is not thereby reported or diagnostic.
 *
 * Inertness is a property of the CORPUS that was measured, not of the axis, and the two
 * entries are not equally durable. `nearDuplicate` is inert because pruning leaves it a
 * singleton per row; a corpus that was not pruned makes it false. `generationBatch` is
 * inert only while the block stamp overwrites `generatedAt` — the assembler derives the
 * batch after partitioning — so this entry is exactly as true as the test on the
 * assembler's side, and no truer.
 */
export const INERT_UNION_AXES = [
  "generationBatch",
  "nearDuplicate",
] as const satisfies readonly GroupKey[];

// The axes `connectedComponentRoots` follows as PARENT LINKAGE — a row whose
// value names another row's ID joins that row — rather than as a shared value.
// Exported so nothing has to restate the pair; `connectedComponentRoots` reads it
// and so does the audit, through `axisConnectivity`.
export const PARENT_LINKAGE_AXES = ["derivationRoot", "humanSeed"] as const;

/**
 * Every axis the splitter unions on IN EITHER SENSE, each named once.
 *
 * Membership answers "does the splitter look at this axis at all", and NOTHING
 * stronger. It deliberately does not answer "are two rows sharing this axis kept
 * together": that question has two different answers for the two relations, and
 * `axisConnectivity` is the function that separates them. Reading indivisibility
 * off this list published a false independence claim for `humanSeed` once already.
 *
 * De-duplicated at construction because `derivationRoot` is in both lists, so a
 * consumer that counts or serialises it does not see the axis twice.
 *
 * Typed as axes rather than as bare strings because C6 reads each entry through
 * {@link groupAxisDeclaredState}: the cross-validation atom is this same connected
 * component, so the axes whose `unknown` state makes the atom unknowable are exactly
 * the ones named here, and restating the list there would let the two drift.
 *
 * The type is {@link GroupAxis} and not one version's tuple: `GROUP_KEYS` names a
 * v4-only axis, so narrowing this to the v3 vocabulary would not compile.
 */
export const CONNECTIVITY_AXES: readonly GroupAxis[] = [
  ...new Set<GroupAxis>([...GROUP_KEYS, ...PARENT_LINKAGE_AXES]),
];

/**
 * The TWO relations the splitter can union an axis by. They are separate because
 * they are not equally strong, and collapsing them into one boolean states
 * something false about `humanSeed`:
 *
 * - `sharedValue` — the axis is in `GROUP_KEYS`: two record-lines carrying the
 *   SAME identity here are always placed in one cluster, unconditionally.
 * - `parentLinkage` — the axis is in `PARENT_LINKAGE_AXES`: a record-line whose
 *   identity here NAMES ANOTHER RECORD-LINE'S ID is unioned with that row, and
 *   **only when that row is present in the same record set**. In the assembled corpus
 *   782 of 783 parent references resolve to no row, so for the
 *   corpus that exists this relation usually unions nothing — which is why the
 *   audit publishes a resolution count next to the flag instead of a bare `true`.
 *
 * A reader must therefore NOT infer from `parentLinkage: true` that two rows
 * sharing a seed value are kept together. Whether `humanSeed` should also become a
 * VALUE axis — two generations grown from the same human prompt are dependent
 * whether or not the seed row was assembled — is resolved on the command path by
 * the whole-corpus lineage refusal, and remains open only for callers that
 * partition records without passing through it. On that path the answer is also
 * MEASURED and not only argued: with every seed RESOLVING — the only state
 * `assertDerivedParentsResolve` admits — the components are identical with and without
 * `humanSeed` as a value axis, because the parent linkage already unions two
 * generations of one seed through the seed row that is present. Adding the value
 * relation there changes no component; it only costs a co-location the block stamp
 * would then have to honour. The measurement is pinned by test, and it says nothing
 * about a corpus whose seeds do NOT resolve — for that corpus the two relations differ,
 * and the command path refuses it before partitioning.
 *
 * The TYPE lives here too, with the function, and not only the values. It was once
 * an anonymous inline return here plus a hand-restated interface in
 * `split-audit.ts`: since the audit assigns a variable rather than a fresh literal,
 * excess-property checking does not apply, so adding a third relation would have put
 * the new flag into the published, `splitDigest`-sealed artifact at runtime while the
 * type consumers read still described two — with a green typecheck.
 */
export interface AxisConnectivity {
  /** The axis is in `GROUP_KEYS`: equal identities are ALWAYS one cluster. */
  sharedValue: boolean;
  /**
   * The axis is in `PARENT_LINKAGE_AXES`: an identity naming another record-line's
   * id unions with that row, and ONLY when that row is present in the same record
   * set. So `true` alone does not mean rows sharing this identity are kept
   * together; the audit publishes the measured resolution next to it.
   */
  parentLinkage: boolean;
}

export function axisConnectivity(axis: string): AxisConnectivity {
  return {
    sharedValue: (GROUP_KEYS as readonly string[]).includes(axis),
    parentLinkage: (PARENT_LINKAGE_AXES as readonly string[]).includes(axis),
  };
}

export class SplitConstraintError extends Error {
  constructor(message: string) {
    super(`SPLIT_CONSTRAINT: ${message}`);
    this.name = "SplitConstraintError";
  }
}

interface Component {
  ids: string[];
  records: BenchmarkRecord[];
  /**
   * How many record-lines of each class this component holds — a property of the
   * component alone, so it is computed once instead of per candidate cut.
   *
   * This is what keeps the four-cut search affordable. Scoring re-tallies every
   * component for every candidate quadruple; walking each component's RECORDS there
   * made the cost proportional to corpus size times the number of leaves, which on a
   * ten-thousand-record corpus is hundreds of millions of visits.
   */
  labelCounts: Map<BenchmarkLabel, number>;
  minCreatedAt: number;
  maximumCreatedAt: number;
  smallestId: string;
  order: string;
  heldOut: boolean;
}

/**
 * The four cut timestamps, each named by the partition it closes. Carried as one
 * object rather than four positional numbers because four same-typed parameters in a
 * row is an argument-order defect waiting to happen, and transposing two cuts is the
 * one mutation no fraction test can see: `cal-B` and `test` share the target 0.20, so
 * a split with the two swapped hits all fifteen fraction targets exactly.
 */
interface Cuts {
  trainCut: number;
  devCut: number;
  calACut: number;
  calBCut: number;
}

type SplitObjective = readonly [
  maximumClassFractionError: number,
  totalClassFractionError: number,
  trainOverflow: number,
  trainCut: number,
  devCut: number,
  calACut: number,
  calBCut: number,
];

export function createBlockedSplit(
  records: readonly BenchmarkRecord[],
  policy: BlockedSplitPolicy,
): DatasetSplit<BenchmarkRecord> {
  const split: DatasetSplit<BenchmarkRecord> = {
    train: [],
    dev: [],
    "cal-A": [],
    "cal-B": [],
    test: [],
  };
  if (records.length === 0) return split;

  const heldOutFamilies = new Set(policy.heldOutGeneratorFamilies);
  const { components } = buildComponents(records, heldOutFamilies, policy.seed);

  const targets: Record<Partition, number> = {
    train: policy.fractions.train,
    dev: policy.fractions.dev,
    "cal-A": policy.fractions["cal-A"],
    "cal-B": policy.fractions["cal-B"],
    test: policy.fractions.test,
  };

  const labels = new Set<BenchmarkLabel>(records.map((record) => record.label));
  const totals = classTotals(records, labels);

  const times = records.map((record) => record.createdAt).sort((a, b) => a - b);
  const distinct = [...new Set(times)].sort((a, b) => a - b);
  const shareByTime = cumulativeShares(times, distinct);
  const candidates = candidateCuts(distinct, shareByTime, targets);

  // Held-out components go to test whatever the cuts say, so they are the one mass
  // the test band's feasibility bound has to be told about.
  const heldOutShare =
    components
      .filter((component) => component.heldOut)
      .reduce((count, component) => count + component.records.length, 0) /
    records.length;

  const best = searchCuts({
    components,
    labels,
    totals,
    targets,
    candidates,
    shareByTime,
    heldOutShare,
    tolerance: policy.classTolerance,
  });

  if (best === undefined) {
    // Deliberately not "no temporal cut exists": the candidate grid is bounded, so
    // an empty result proves only that nothing IN THE GRID worked. Blaming the corpus
    // for a limit of the search would be the stronger claim, and it is not available.
    throw new SplitConstraintError(
      "no candidate cut quadruple realises the train/dev/cal-A/cal-B/test proportions",
    );
  }

  // Held-out families must sit entirely after the last cut. If any reserved
  // component reaches into an earlier partition's time, forcing it into test would
  // leak the future — refuse rather than relax.
  for (const component of components) {
    if (component.heldOut && component.minCreatedAt <= best.cuts.calBCut) {
      throw new SplitConstraintError(
        "held-out generator family is not temporally eligible for test",
      );
    }
  }

  const [maximumClassFractionError] = best.objective;
  if (
    !atMostWithinTolerance(maximumClassFractionError, 0, policy.classTolerance)
  ) {
    const fractions = describeFractions(components, labels, totals, best.cuts);
    throw new SplitConstraintError(
      `class split fractions unreachable within tolerance ${policy.classTolerance}: ${fractions}`,
    );
  }

  const ordered = [...components].sort((a, b) => {
    if (a.minCreatedAt !== b.minCreatedAt) {
      return a.minCreatedAt - b.minCreatedAt;
    }
    return a.order < b.order ? -1 : a.order > b.order ? 1 : 0;
  });
  for (const component of ordered) {
    const partition = assignPartition(component, best.cuts);
    split[partition].push(...component.records);
  }

  for (const partition of PARTITIONS) {
    split[partition].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }
  return split;
}

// The single source of connectivity truth. Both the splitter and the audit
// MUST enumerate identical connected components, so they call THIS function:
// union-find over every value-axis in GROUP_KEYS PLUS the parent/derivative
// linkage (a record whose derivationRoot names another record's id joins that
// parent, so a depth-N derivation chain collapses into one component). Returns
// each record id mapped to its component root, an opaque but stable key.
export function connectedComponentRoots(
  records: readonly BenchmarkRecord[],
): Map<string, string> {
  const disjoint = new DisjointSet();
  for (const record of records) disjoint.add(record.id);

  for (const key of GROUP_KEYS) {
    const firstByValue = new Map<string, string>();
    for (const record of records) {
      // Read through the accessor, not the block: a v3 axis is a three-valued
      // object, and only a `known` state is an identity two rows can share.
      // `notApplicable` and `unknown` both mean "this row joins no other here".
      const value = groupAxisIdentity(record, key);
      if (value === undefined) continue;
      const first = firstByValue.get(value);
      if (first === undefined) {
        firstByValue.set(value, record.id);
      } else {
        disjoint.union(first, record.id);
      }
    }
  }

  // Parent linkage: joins a row to the row it came OUT of, even across a chain, so
  // A <- B <- C become one component regardless of intermediate depth.
  //
  // BOTH lineage axes, and they are not synonyms (see V3_GROUP_AXES): the
  // `original` recipe generates fresh text from a human prompt, so its
  // `derivationRoot` is legitimately `notApplicable` while `humanSeed` names the
  // human row it started from. Following only `derivationRoot` therefore left the
  // commonest lineage in v3 — human text in one partition, the generation it
  // seeded in another — glued by nothing, and no VALUE axis reveals it because the
  // two rows share no axis value at all. Keeping the whole lineage
  // seed -> generation -> derivatives in one partition is enforced here, where the
  // connectivity is defined.
  //
  // A parent that is ABSENT from these records is skipped, deliberately: 782 of 783
  // parent references in the assembled corpus resolve to no row, and a missing parent
  // must neither invent a cluster nor refuse the row.
  // Refusing an unresolved lineage is a SELECTION question, and it belongs to
  // `assertDerivedParentsResolve` on the whole-corpus path, not to connectivity.
  //
  // That refusal is now WIRED, which changes what this `ids.has(parent)` guard means
  // without changing the code: `benchmark/commands/split.ts` calls
  // `assertDerivedParentsResolve(records)` before `createBlockedSplit`, so on the
  // command path every parent reference resolves and the guard never skips anything.
  // It stays because this function is also called directly — by tests and by any
  // future caller that has not passed the whole-corpus gate — and a clusterer that
  // threw on an absent parent would be answering a selection question it cannot see
  // the whole input for.
  const ids = new Set(records.map((record) => record.id));
  for (const record of records) {
    for (const axis of PARENT_LINKAGE_AXES) {
      const parent = groupAxisIdentity(record, axis);
      if (parent !== undefined && parent !== record.id && ids.has(parent)) {
        disjoint.union(record.id, parent);
      }
    }
  }

  const roots = new Map<string, string>();
  for (const record of records) roots.set(record.id, disjoint.find(record.id));
  return roots;
}

/**
 * The declared held-out families that the splitter ACTUALLY marked — i.e. that
 * set `component.heldOut` on at least one component of this dataset. Exists so
 * the pipeline can assert exact agreement between what the manifest reserved and
 * what the split acted on: a reservation the splitter silently ignored used to be
 * invisible, and was precisely the A4 defect.
 *
 * It calls the same `buildComponents` the splitter calls — never a
 * re-implementation of the marking rule — but it is a SECOND call, over the whole
 * record set, whose result the splitter's own call never sees. The two therefore
 * agree by DETERMINISM (same records, same declared set, same seed, no clock and no
 * randomness) and not by identity, and the cost is one extra union-find pass. Making
 * it identity would mean `createBlockedSplit` returning its marks alongside the
 * partitions, which changes the shape every caller destructures; that is a
 * deliberate deferral, not an oversight.
 */
export function markedHeldOutGeneratorFamilies(
  records: readonly BenchmarkRecord[],
  policy: BlockedSplitPolicy,
): GeneratorFamily[] {
  const { marked } = buildComponents(
    records,
    new Set(policy.heldOutGeneratorFamilies),
    policy.seed,
  );
  return sortGeneratorFamilies([...marked]);
}

function buildComponents(
  records: readonly BenchmarkRecord[],
  heldOutFamilies: ReadonlySet<GeneratorFamily>,
  seed: number,
): { components: Component[]; marked: Set<GeneratorFamily> } {
  const roots = connectedComponentRoots(records);
  const marked = new Set<GeneratorFamily>();

  const byRoot = new Map<string, Component>();
  for (const record of records) {
    const root = roots.get(record.id) as string;
    let component = byRoot.get(root);
    if (component === undefined) {
      component = {
        ids: [],
        records: [],
        labelCounts: new Map<BenchmarkLabel, number>(),
        minCreatedAt: record.createdAt,
        maximumCreatedAt: record.createdAt,
        smallestId: record.id,
        order: "",
        heldOut: false,
      };
      byRoot.set(root, component);
    }
    component.ids.push(record.id);
    component.records.push(record);
    component.labelCounts.set(
      record.label,
      (component.labelCounts.get(record.label) ?? 0) + 1,
    );
    component.minCreatedAt = Math.min(component.minCreatedAt, record.createdAt);
    component.maximumCreatedAt = Math.max(
      component.maximumCreatedAt,
      record.createdAt,
    );
    if (record.id < component.smallestId) component.smallestId = record.id;
    // The CANONICAL field, read through the single accessor. Reading
    // `record.generation?.family` here — the provider's dotted label — is what
    // kept `component.heldOut` permanently false, so the test-only constraint
    // below never ran and the invariant held only by accident of createdAt.
    const family = generatorFamilyOf(record);
    if (family !== undefined && heldOutFamilies.has(family)) {
      component.heldOut = true;
      marked.add(family);
    }
  }

  // Tie-break for the ITERATION order of components with identical `minCreatedAt`, from a
  // seeded digest of the smallest id. It does not select a placement: `assignPartition`
  // decides from the component's own time range against the cuts, and each partition is
  // re-sorted by id afterwards, so iteration order cannot change `id -> partition`.
  for (const component of byRoot.values()) {
    component.order = createHash("sha256")
      .update(`${seed}:${component.smallestId}`, "utf8")
      .digest("hex");
  }
  return { components: [...byRoot.values()], marked };
}

/**
 * A component belongs to a middle partition only when its WHOLE time range fits
 * inside that partition's band; anything straddling a cut falls through to `train`.
 *
 * `train` is the fallback because it is the largest target (0.45) and therefore the
 * one that absorbs bridging components without leaving its tolerance. The objective
 * penalises train overflow for the same reason: without that term the excess drains
 * into `train` unpriced until it breaches the tolerance outright.
 */
function assignPartition(component: Component, cuts: Cuts): Partition {
  if (component.heldOut) return "test";
  if (component.minCreatedAt > cuts.calBCut) return "test";
  if (
    component.minCreatedAt > cuts.calACut &&
    component.maximumCreatedAt <= cuts.calBCut
  ) {
    return "cal-B";
  }
  if (
    component.minCreatedAt > cuts.devCut &&
    component.maximumCreatedAt <= cuts.calACut
  ) {
    return "cal-A";
  }
  if (
    component.minCreatedAt > cuts.trainCut &&
    component.maximumCreatedAt <= cuts.devCut
  ) {
    return "dev";
  }
  return "train";
}

function classTotals(
  records: readonly BenchmarkRecord[],
  labels: ReadonlySet<BenchmarkLabel>,
): Map<BenchmarkLabel, number> {
  const totals = new Map<BenchmarkLabel, number>();
  for (const label of labels) totals.set(label, 0);
  for (const record of records) {
    totals.set(record.label, (totals.get(record.label) ?? 0) + 1);
  }
  return totals;
}

interface SearchInput {
  components: readonly Component[];
  labels: ReadonlySet<BenchmarkLabel>;
  totals: ReadonlyMap<BenchmarkLabel, number>;
  targets: Record<Partition, number>;
  candidates: readonly (readonly number[])[];
  shareByTime: ReadonlyMap<number, number>;
  heldOutShare: number;
  tolerance: number;
}

/**
 * Exhaustive over a BOUNDED candidate grid, monotone by construction, with two
 * feasibility bounds that are admissible rather than heuristic.
 *
 * Why bounded at all: the three-partition search enumerated every distinct time in a
 * ±10-point window for each of two cuts, which is O(k²). Four cuts make the same
 * shape O(k⁴), and on a corpus with hundreds of distinct times per window that does
 * not finish. The grid has a fixed size per cut, so the leaf count is bounded by
 * construction and no corpus is ever refused merely for being large.
 *
 * Why the bounds are sound. Both are stated over the ALL-CLASS share, and that is
 * legitimate: the overall share is a weighted mean of the per-class shares, so if
 * every class sits within the tolerance the overall does too — hence an overall share
 * outside the tolerance proves some class is outside it, and the split is infeasible.
 *
 *   - `train` only ever RECEIVES mass, since it is the fallback for every straddling
 *     component. So its realised share is at least its band share, and a band share
 *     above `target + tolerance` can never come back down. The ONE exception is a
 *     held-out component sitting inside train's band, which leaves for `test` — and
 *     that costs nothing, because a held-out component anywhere at or before the last
 *     cut makes the caller refuse the split outright. The bound therefore holds for
 *     every cut vector that could be accepted, which is the only place it is used.
 *   - the middle partitions only ever LOSE mass, to `train`. So a realised share is
 *     at most the band share, and a band share below `target - tolerance` can never
 *     be topped up.
 *   - `test` also gains the held-out components, wherever they sit in time, so its
 *     bound has to add that mass before comparing.
 *
 * The search is a heuristic and the contract is not: whatever it returns is checked
 * in full by the caller and by the independent audit, and an unmet constraint becomes
 * a refusal rather than a published claim. The price of a narrower search is that
 * more FEASIBLE corpora get refused — fail-closed in the right direction.
 */
function searchCuts(
  input: SearchInput,
): { objective: SplitObjective; cuts: Cuts } | undefined {
  const {
    components,
    labels,
    totals,
    targets,
    candidates,
    shareByTime,
    heldOutShare,
    tolerance,
  } = input;
  const share = (time: number): number => shareByTime.get(time) ?? 0;
  const [trainCandidates, devCandidates, calACandidates, calBCandidates] =
    candidates;
  if (
    trainCandidates === undefined ||
    devCandidates === undefined ||
    calACandidates === undefined ||
    calBCandidates === undefined
  ) {
    // One list per cut, always. Defaulting a missing list to empty instead would
    // make a wrong candidate list indistinguishable from an unsplittable corpus:
    // the search would return nothing and the caller would refuse the corpus with
    // "no temporal cut can realise the proportions", which would be a lie.
    throw new Error(
      `expected one candidate list per cut, received ${candidates.length}`,
    );
  }

  let best: { objective: SplitObjective; cuts: Cuts } | undefined;
  for (const trainCut of trainCandidates) {
    if (!atMostWithinTolerance(share(trainCut), targets.train, tolerance))
      continue;
    for (const devCut of devCandidates) {
      if (devCut <= trainCut) continue;
      if (
        !atLeastWithinTolerance(
          share(devCut) - share(trainCut),
          targets.dev,
          tolerance,
        )
      )
        continue;
      for (const calACut of calACandidates) {
        if (calACut <= devCut) continue;
        if (
          !atLeastWithinTolerance(
            share(calACut) - share(devCut),
            targets["cal-A"],
            tolerance,
          )
        ) {
          continue;
        }
        for (const calBCut of calBCandidates) {
          if (calBCut <= calACut) continue;
          if (
            !atLeastWithinTolerance(
              share(calBCut) - share(calACut),
              targets["cal-B"],
              tolerance,
            )
          ) {
            continue;
          }
          if (
            !atLeastWithinTolerance(
              1 - share(calBCut) + heldOutShare,
              targets.test,
              tolerance,
            )
          ) {
            continue;
          }
          const cuts: Cuts = { trainCut, devCut, calACut, calBCut };
          const objective = scoreCut(components, labels, totals, targets, cuts);
          if (best === undefined || isBetter(objective, best.objective)) {
            best = { objective, cuts };
          }
        }
      }
    }
  }
  return best;
}

function scoreCut(
  components: readonly Component[],
  labels: ReadonlySet<BenchmarkLabel>,
  totals: ReadonlyMap<BenchmarkLabel, number>,
  targets: Record<Partition, number>,
  cuts: Cuts,
): SplitObjective {
  const counts = tally(components, cuts);

  let maximumError = 0;
  let totalError = 0;
  let trainOverflow = 0;
  for (const label of labels) {
    const total = totals.get(label) ?? 0;
    if (total === 0) continue;
    for (const partition of PARTITIONS) {
      const fraction = (counts.get(label)?.[partition] ?? 0) / total;
      const error = Math.abs(fraction - targets[partition]);
      if (error > maximumError) maximumError = error;
      totalError += error;
      if (partition === "train") {
        trainOverflow += Math.max(0, fraction - targets.train);
      }
    }
  }
  return [
    maximumError,
    totalError,
    trainOverflow,
    cuts.trainCut,
    cuts.devCut,
    cuts.calACut,
    cuts.calBCut,
  ];
}

/**
 * Zeroed counts for every partition. `Record<Partition, number>` is what makes a
 * forgotten partition a compile error instead of an unwatched fraction: with four of
 * the five counted, the fifth could drift eight points and nothing would refuse it.
 */
function emptyPartitionCounts(): Record<Partition, number> {
  return { train: 0, dev: 0, "cal-A": 0, "cal-B": 0, test: 0 };
}

function tally(
  components: readonly Component[],
  cuts: Cuts,
): Map<BenchmarkLabel, Record<Partition, number>> {
  const counts = new Map<BenchmarkLabel, Record<Partition, number>>();
  for (const component of components) {
    const partition = assignPartition(component, cuts);
    for (const [label, count] of component.labelCounts) {
      let row = counts.get(label);
      if (row === undefined) {
        row = emptyPartitionCounts();
        counts.set(label, row);
      }
      row[partition] += count;
    }
  }
  return counts;
}

function describeFractions(
  components: readonly Component[],
  labels: ReadonlySet<BenchmarkLabel>,
  totals: ReadonlyMap<BenchmarkLabel, number>,
  cuts: Cuts,
): string {
  const counts = tally(components, cuts);
  const parts: string[] = [];
  for (const label of labels) {
    const total = totals.get(label) ?? 0;
    if (total === 0) continue;
    const row = counts.get(label) ?? emptyPartitionCounts();
    const shares = PARTITIONS.map(
      (partition) => `${partition} ${(row[partition] / total).toFixed(3)}`,
    );
    parts.push(`${label}=[${shares.join(", ")}]`);
  }
  return parts.join(" ");
}

function isBetter(a: SplitObjective, b: SplitObjective): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] < b[i]) return true;
    if (a[i] > b[i]) return false;
  }
  return false;
}

/**
 * The cumulative record share at each distinct time, in one ascending pass over both
 * lists. Both MUST be sorted ascending, and `distinct` MUST be the distinct values of
 * `sortedTimes`: the walk never rewinds.
 */
function cumulativeShares(
  sortedTimes: readonly number[],
  distinct: readonly number[],
): Map<number, number> {
  const total = sortedTimes.length;
  const shares = new Map<number, number>();
  let index = 0;
  let count = 0;
  for (const time of distinct) {
    while (index < total && (sortedTimes[index] as number) <= time) {
      index += 1;
      count += 1;
    }
    shares.set(time, count / total);
  }
  return shares;
}

// How far either side of a cut's cumulative target the grid reaches, and how many
// levels it places inside that span.
const CUT_WINDOW = 0.1;
const CUT_GRID_STEPS = 12;

/**
 * One candidate list per cut, in the temporal order of {@link CUT_PARTITIONS}.
 *
 * The levels are spaced evenly in CUMULATIVE-SHARE space, not ranked by proximity to
 * the target. Proximity ranking is what a two-cut search could afford and a four-cut
 * one cannot: the cumulative targets 0.45 and 0.50 are five points apart, so the
 * times nearest either of them are largely the same times, and a list of the nearest
 * k would explore almost nothing. The exact target is added last so the single best
 * cut of the narrower search is always among the candidates.
 */
function candidateCuts(
  distinct: readonly number[],
  shareByTime: ReadonlyMap<number, number>,
  targets: Record<Partition, number>,
): number[][] {
  let cumulative = 0;
  const lists: number[][] = [];
  for (const partition of CUT_PARTITIONS) {
    cumulative += targets[partition];
    const selected = new Set<number>();
    for (let step = 0; step <= CUT_GRID_STEPS; step += 1) {
      const level =
        cumulative - CUT_WINDOW + (2 * CUT_WINDOW * step) / CUT_GRID_STEPS;
      selected.add(nearestTime(distinct, shareByTime, level));
    }
    selected.add(nearestTime(distinct, shareByTime, cumulative));
    lists.push([...selected].sort((a, b) => a - b));
  }
  return lists;
}

function nearestTime(
  distinct: readonly number[],
  shareByTime: ReadonlyMap<number, number>,
  level: number,
): number {
  let best = distinct[0] as number;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const time of distinct) {
    const distance = Math.abs((shareByTime.get(time) ?? 0) - level);
    // Strictly-less keeps the EARLIEST time on a tie, so the grid is a function of
    // the timestamps alone rather than of iteration order.
    if (distance < bestDistance) {
      bestDistance = distance;
      best = time;
    }
  }
  return best;
}

// Local union-find over string ids: the smaller root always becomes the parent,
// so the structure is deterministic and independent of insertion order.
class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (parent === undefined) throw new Error(`unknown disjoint-set id ${id}`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(left: string, right: string): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a === b) return;
    if (a < b) {
      this.parent.set(b, a);
    } else {
      this.parent.set(a, b);
    }
  }
}
