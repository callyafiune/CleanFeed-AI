// Dataset splitting for the benchmark. Two splitters live here:
//
//   * groupTimeSplit — the MVP group-time split (train/calibration/test),
//     still consumed by the monolithic cli.ts pending its migration to the
//     seven-command layout. Kept intentionally, not dead: cli.ts imports it.
//   * createBlockedSplit — the Phase 2 leakage-safe temporal split
//     (development/calibration/test) mandated by the classifier design §6.4.
//
// Both refuse the leakage that would inflate benchmark scores. The Phase 2
// splitter is fail-closed: it never relaxes grouping or time to hit a target,
// it throws instead.
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
  type V3GroupAxis,
} from "./schema.ts";

// --- Legacy MVP group-time split -------------------------------------------

export interface SplitFractions {
  train: number;
  calibration: number;
  test: number;
}

export interface GroupTimeSplitOptions<T> {
  groupBy: keyof T & string;
  timeBy: keyof T & string;
  fractions?: SplitFractions;
}

export interface GroupTimeSplit<T> {
  train: T[];
  calibration: T[];
  test: T[];
}

const DEFAULT_FRACTIONS: SplitFractions = {
  train: 0.6,
  calibration: 0.2,
  test: 0.2,
};

export function groupTimeSplit<T>(
  records: readonly T[],
  options: GroupTimeSplitOptions<T>,
): GroupTimeSplit<T> {
  const split: GroupTimeSplit<T> = { train: [], calibration: [], test: [] };
  if (records.length === 0) return split;

  const fractions = normaliseFractions(options.fractions ?? DEFAULT_FRACTIONS);
  const times = records
    .map((record) => toTime(record, options.timeBy))
    .sort((a, b) => a - b);

  // Records strictly after testCut are eligible for test; records in
  // (calibrationCut, testCut] are eligible for calibration.
  const testCut = quantile(times, 1 - fractions.test);
  const calibrationCut = quantile(
    times,
    1 - fractions.test - fractions.calibration,
  );

  for (const bucket of groupRecords(records, options.groupBy).values()) {
    const bucketTimes = bucket.map((record) => toTime(record, options.timeBy));
    const min = Math.min(...bucketTimes);
    const max = Math.max(...bucketTimes);

    if (min > testCut) {
      split.test.push(...bucket);
    } else if (max <= testCut && min > calibrationCut) {
      split.calibration.push(...bucket);
    } else {
      split.train.push(...bucket);
    }
  }

  return split;
}

function groupRecords<T>(
  records: readonly T[],
  groupBy: keyof T & string,
): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const record of records) {
    const key = String(record[groupBy]);
    const bucket = groups.get(key);
    if (bucket === undefined) {
      groups.set(key, [record]);
    } else {
      bucket.push(record);
    }
  }
  return groups;
}

function normaliseFractions(fractions: SplitFractions): SplitFractions {
  const { train, calibration, test } = fractions;
  if (
    !Number.isFinite(train) ||
    !Number.isFinite(calibration) ||
    !Number.isFinite(test) ||
    train <= 0 ||
    calibration <= 0 ||
    test <= 0
  ) {
    throw new Error("SPLIT_FRACTIONS_INVALID: fractions must be positive");
  }
  const total = train + calibration + test;
  return {
    train: train / total,
    calibration: calibration / total,
    test: test / total,
  };
}

function quantile(sortedAscending: readonly number[], p: number): number {
  const clamped = Math.min(1, Math.max(0, p));
  const index = Math.floor(clamped * (sortedAscending.length - 1));
  return sortedAscending[index];
}

function toTime<T>(record: T, timeBy: keyof T & string): number {
  const value = Number(record[timeBy]);
  if (!Number.isFinite(value)) {
    throw new Error(`SPLIT_TIME_INVALID: ${timeBy} is not a finite number`);
  }
  return value;
}

// --- Phase 2 blocked temporal split ----------------------------------------

export type Partition = "development" | "calibration" | "test";

export interface DatasetSplit<T> {
  development: T[];
  calibration: T[];
  test: T[];
}

export interface BlockedSplitPolicy {
  fractions: { development: 0.2; calibration: 0.3; test: 0.5 };
  classTolerance: 0.02;
  // Canonical families only (benchmark/generator-family.ts). The nominal type is
  // what makes the old defect — matching this set against `generation.family`,
  // the provider's dotted label — a compile error instead of a silent no-op.
  heldOutGeneratorFamilies: readonly GeneratorFamily[];
  seed: number;
}

// The connected-component axes. `domain` and `groups.generatorFamily` are
// DELIBERATELY excluded: unioning on them would collapse every LinkedIn record
// or a whole generator family into one indivisible block. The reserved holdout
// family is enforced separately, as an explicit test-only constraint.
export const GROUP_KEYS = [
  "author",
  "source",
  "domainSource",
  "generatorVersion",
  "promptTemplate",
  "collectionBatch",
  "nearDuplicate",
  "derivationRoot",
] as const;

export type GroupKey = (typeof GROUP_KEYS)[number];

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
 */
export const CONNECTIVITY_AXES: readonly V3GroupAxis[] = [
  ...new Set<V3GroupAxis>([...GROUP_KEYS, ...PARENT_LINKAGE_AXES]),
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
 *   **only when that row is present in the same record set**. C2 measured 782 of
 *   783 parent references resolving to no row of the assembled corpus, so for the
 *   corpus that exists this relation usually unions nothing — which is why the
 *   audit publishes a resolution count next to the flag instead of a bare `true`.
 *
 * A reader must therefore NOT infer from `parentLinkage: true` that two rows
 * sharing a seed value are kept together. Whether `humanSeed` should also become a
 * VALUE axis — two generations grown from the same human prompt are dependent
 * whether or not the seed row was assembled — is a substantive question for E2/E3
 * and is deliberately not decided here.
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

const PARTITIONS: readonly Partition[] = ["development", "calibration", "test"];

export class SplitConstraintError extends Error {
  constructor(message: string) {
    super(`SPLIT_CONSTRAINT: ${message}`);
    this.name = "SplitConstraintError";
  }
}

interface Component {
  ids: string[];
  records: BenchmarkRecord[];
  minCreatedAt: number;
  maximumCreatedAt: number;
  smallestId: string;
  order: string;
  heldOut: boolean;
}

type SplitObjective = readonly [
  maximumClassFractionError: number,
  totalClassFractionError: number,
  developmentOverflow: number,
  calibrationCut: number,
  testCut: number,
];

export function createBlockedSplit(
  records: readonly BenchmarkRecord[],
  policy: BlockedSplitPolicy,
): DatasetSplit<BenchmarkRecord> {
  const split: DatasetSplit<BenchmarkRecord> = {
    development: [],
    calibration: [],
    test: [],
  };
  if (records.length === 0) return split;

  const heldOutFamilies = new Set(policy.heldOutGeneratorFamilies);
  const { components } = buildComponents(records, heldOutFamilies, policy.seed);

  const targets: Record<Partition, number> = {
    development: policy.fractions.development,
    calibration: policy.fractions.calibration,
    test: policy.fractions.test,
  };

  const labels = new Set<BenchmarkLabel>(records.map((record) => record.label));
  const totals = classTotals(records, labels);

  const times = records.map((record) => record.createdAt).sort((a, b) => a - b);
  const { calibrationCuts, testCuts } = candidateCuts(times, targets);

  let best:
    { objective: SplitObjective; calCut: number; testCut: number } | undefined;
  for (const calCut of calibrationCuts) {
    for (const testCut of testCuts) {
      if (calCut >= testCut) continue;
      const objective = scoreCut(
        components,
        labels,
        totals,
        targets,
        calCut,
        testCut,
      );
      if (best === undefined || isBetter(objective, best.objective)) {
        best = { objective, calCut, testCut };
      }
    }
  }

  if (best === undefined) {
    throw new SplitConstraintError(
      "no temporal cut can realise the development/calibration/test proportions",
    );
  }

  // Held-out families must sit entirely after the test cut. If any reserved
  // component reaches into calibration/development time, forcing it into test
  // would leak the future — refuse rather than relax.
  for (const component of components) {
    if (component.heldOut && component.minCreatedAt <= best.testCut) {
      throw new SplitConstraintError(
        "held-out generator family is not temporally eligible for test",
      );
    }
  }

  const [maximumClassFractionError] = best.objective;
  if (maximumClassFractionError > policy.classTolerance) {
    const fractions = describeFractions(
      components,
      labels,
      totals,
      best.calCut,
      best.testCut,
    );
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
    const partition = assignPartition(component, best.calCut, best.testCut);
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
  // two rows share no axis value at all. This is E2's invariant 4 ("the whole
  // lineage seed -> generation -> derivatives in one partition"), enforced where
  // the connectivity is defined.
  //
  // A parent that is ABSENT from these records is skipped, deliberately: C2
  // measured 782 of 783 parent references resolving to no row of the assembled
  // corpus, and a missing parent must neither invent a cluster nor refuse the row.
  // Refusing an unresolved lineage is a SELECTION question, and it belongs to
  // `assertDerivedParentsResolve` on the whole-corpus path, not to connectivity.
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

  // Deterministic order tie-break: a seeded digest of the smallest id. The seed
  // is recorded in the policy so the ordering is reproducible.
  for (const component of byRoot.values()) {
    component.order = createHash("sha256")
      .update(`${seed}:${component.smallestId}`, "utf8")
      .digest("hex");
  }
  return { components: [...byRoot.values()], marked };
}

function assignPartition(
  component: Component,
  calibrationCut: number,
  testCut: number,
): Partition {
  if (component.heldOut) return "test";
  if (component.minCreatedAt > testCut) return "test";
  if (
    component.minCreatedAt > calibrationCut &&
    component.maximumCreatedAt <= testCut
  ) {
    return "calibration";
  }
  return "development";
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

function scoreCut(
  components: readonly Component[],
  labels: ReadonlySet<BenchmarkLabel>,
  totals: ReadonlyMap<BenchmarkLabel, number>,
  targets: Record<Partition, number>,
  calibrationCut: number,
  testCut: number,
): SplitObjective {
  const counts = tally(components, calibrationCut, testCut);

  let maximumError = 0;
  let totalError = 0;
  let developmentOverflow = 0;
  for (const label of labels) {
    const total = totals.get(label) ?? 0;
    if (total === 0) continue;
    for (const partition of PARTITIONS) {
      const fraction = (counts.get(label)?.[partition] ?? 0) / total;
      const error = Math.abs(fraction - targets[partition]);
      if (error > maximumError) maximumError = error;
      totalError += error;
      if (partition === "development") {
        developmentOverflow += Math.max(0, fraction - targets.development);
      }
    }
  }
  return [
    maximumError,
    totalError,
    developmentOverflow,
    calibrationCut,
    testCut,
  ];
}

function tally(
  components: readonly Component[],
  calibrationCut: number,
  testCut: number,
): Map<BenchmarkLabel, Record<Partition, number>> {
  const counts = new Map<BenchmarkLabel, Record<Partition, number>>();
  for (const component of components) {
    const partition = assignPartition(component, calibrationCut, testCut);
    for (const record of component.records) {
      let row = counts.get(record.label);
      if (row === undefined) {
        row = { development: 0, calibration: 0, test: 0 };
        counts.set(record.label, row);
      }
      row[partition] += 1;
    }
  }
  return counts;
}

function describeFractions(
  components: readonly Component[],
  labels: ReadonlySet<BenchmarkLabel>,
  totals: ReadonlyMap<BenchmarkLabel, number>,
  calibrationCut: number,
  testCut: number,
): string {
  const counts = tally(components, calibrationCut, testCut);
  const parts: string[] = [];
  for (const label of labels) {
    const total = totals.get(label) ?? 0;
    if (total === 0) continue;
    const row = counts.get(label) ?? {
      development: 0,
      calibration: 0,
      test: 0,
    };
    parts.push(
      `${label}=[dev ${(row.development / total).toFixed(3)}, ` +
        `cal ${(row.calibration / total).toFixed(3)}, ` +
        `test ${(row.test / total).toFixed(3)}]`,
    );
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

// Candidate cut timestamps: every distinct time whose cumulative record share
// falls within ±10% of the target quantile, plus the closest distinct time as a
// fallback so a legal pair always exists. A component is placed in test only
// when its minimum time is strictly greater than testCut, so cuts are real
// record times acting as exclusive lower bounds.
function candidateCuts(
  sortedTimes: readonly number[],
  targets: Record<Partition, number>,
): { calibrationCuts: number[]; testCuts: number[] } {
  const distinct = [...new Set(sortedTimes)].sort((a, b) => a - b);
  const total = sortedTimes.length;
  const cumulative = (time: number): number => {
    let count = 0;
    for (const value of sortedTimes) {
      if (value <= time) count += 1;
      else break;
    }
    return count / total;
  };
  const fractionByTime = new Map<number, number>();
  for (const time of distinct) fractionByTime.set(time, cumulative(time));

  const testTarget = targets.development + targets.calibration; // 0.5
  const calibrationTarget = targets.development; // 0.2

  return {
    calibrationCuts: window(distinct, fractionByTime, calibrationTarget),
    testCuts: window(distinct, fractionByTime, testTarget),
  };
}

function window(
  distinct: readonly number[],
  fractionByTime: ReadonlyMap<number, number>,
  target: number,
): number[] {
  const selected = distinct.filter((time) => {
    const fraction = fractionByTime.get(time) ?? 0;
    return Math.abs(fraction - target) <= 0.1 + 1e-9;
  });
  let closest = distinct[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const time of distinct) {
    const distance = Math.abs((fractionByTime.get(time) ?? 0) - target);
    if (distance < bestDistance) {
      bestDistance = distance;
      closest = time;
    }
  }
  if (!selected.includes(closest)) selected.push(closest);
  return selected;
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
