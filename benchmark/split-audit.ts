// Scientific audit of a blocked temporal split. The splitter (benchmark/split.ts)
// produces the partition; this module PROVES, independently, that the partition
// is release-worthy:
//
//   1. zero group leakage on all eight connected-component axes,
//   2. a strictly-latest blocked test (no future -> train/calibration leak),
//   3. per-class 20/30/50 within a two-point tolerance, and
//   4. the sampling floors that let a slice gate a release: at least 2000 human
//      negatives in test, 300 negatives for a critical FPR slice, 200 positives
//      for a critical recall slice. Under-powered slices stay in the report but
//      are flagged non-gating rather than silently dropped.
//
// The audit is deliberately separate from the splitter so a leaking split (even
// a hand-crafted one) is caught rather than trusted. Standalone module: MUST NOT
// import from the extension bundle (src/).

import {
  generatorFamilyOf,
  sortGeneratorFamilies,
  type GeneratorFamily,
} from "./generator-family.ts";
import { REBUILD_V3_POLICY } from "./rebuild-v3-policy.ts";
import {
  V3_GROUP_AXES,
  groupAxisIdentity,
  groupAxisState,
  type BenchmarkLabel,
  type BenchmarkRecord,
  type GroupAxisState,
  type V3GroupAxis,
} from "./schema.ts";
import {
  axisConnectivity,
  connectedComponentRoots,
  GROUP_KEYS,
  type Partition,
} from "./split.ts";

export interface SplitAuditPolicy {
  minimumTestHumanNegatives: 2_000;
  minimumCriticalFprNegatives: 300;
  minimumCriticalRecallPositives: 200;
  classTolerance: 0.02;
}

/**
 * The slices the cluster report is broken down by. `partition` first, because
 * "how many independent clusters does each partition hold" is the question E3's
 * composition gate asks; the rest are the slices a per-stratum power calculation
 * (D0b) needs an OFFER for.
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
 * (R6). Nothing here fails on it, and nothing here computes power: C3 measures the
 * offer, D0b computes the power and E3 applies the gate. Wiring a power gate here
 * would create exactly the circular dependency the plan split apart.
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
 * How the splitter unions this axis, as the TWO relations it really is.
 *
 * The single boolean this replaced could not tell them apart, and the conflation
 * published a FALSE independence claim: `humanSeed` is linkage-only, linkage
 * unions only when the named row is present, and C2 measured 782 of 783 parent
 * references resolving to no row — so `true` next to `largest: 2` read as "one
 * indivisible block of two record-lines" about two rows the splitter had just put
 * on opposite sides of the test cut.
 *
 * Definition of each flag: {@link axisConnectivity} in split.ts, which is the one
 * place that derives them, from the same two lists `connectedComponentRoots`
 * iterates.
 */
export interface AxisConnectivity {
  /** Two record-lines with the same identity here are ALWAYS one cluster. */
  sharedValue: boolean;
  /**
   * A record-line whose identity here names another record-line's ID is unioned
   * with it — ONLY when that record-line is present in the same record set. So
   * `true` does NOT mean rows sharing this identity are kept together; read
   * {@link AxisClusterReport.linkage} for how often the condition actually held.
   */
  parentLinkage: boolean;
}

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
 *   nothing either, and is the case C2 measured for 782 of 783 references.
 *
 * It exists so a consumer never has to guess how strong `parentLinkage: true` is
 * for the corpus in front of it. C3 publishes the number; it computes no power and
 * applies no gate (D0b and E3 own those).
 */
export interface LinkageResolution {
  references: number;
  joinedAnotherRecordLine: number;
  selfReference: number;
  absentFromRecordSet: number;
}

export interface AxisClusterReport {
  axis: V3GroupAxis;
  /** The two union relations, never one flag: see {@link AxisConnectivity}. */
  connectivity: AxisConnectivity;
  /**
   * The measured resolution of this axis's references, or `null` when the axis is
   * not followed as parent linkage at all (`connectivity.parentLinkage === false`),
   * where the question does not arise.
   */
  linkage: LinkageResolution | null;
  /** How many record-lines state each of R6's three states on this axis. */
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
 * is ineligible (R6). `assertDeclaredAxesResolved` (benchmark/schema.ts) is
 * STRICTER — it also refuses `notApplicable` as a contradiction of the source's
 * own declaration — and that stricter rule belongs to the ingest path, where a
 * record is being accepted into the corpus. The audit's question is whether the
 * partitions can be trusted, and a legitimately inapplicable axis does not make
 * them untrustworthy.
 */
export interface DeclaredAxisGap {
  sourceId: string;
  axis: V3GroupAxis;
  state: "unknown";
  recordLines: number;
}

export interface SplitAudit {
  sizes: Record<Partition, number>;
  classFractions: Record<BenchmarkLabel, Record<Partition, number>>;
  cutoffs: {
    latestDevelopment: number;
    latestCalibration: number;
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
   * is a substantive question for E2/E3, not one C3 decides. It is visible in
   * {@link AxisClusterReport.linkage}, which counts exactly those references.
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
  // Read back off the partitions, in canonical form, so it can be compared for
  // exact equality against the declared, marked and published sets.
  heldOutGeneratorFamilies: GeneratorFamily[];
  passed: boolean;
  reasons: string[];
}

interface DatasetSplitInput {
  development: readonly BenchmarkRecord[];
  calibration: readonly BenchmarkRecord[];
  test: readonly BenchmarkRecord[];
}

const PARTITIONS: readonly Partition[] = ["development", "calibration", "test"];
const LABELS: readonly BenchmarkLabel[] = ["human", "ai", "mixed"];
// Composite-map key separator: the unit separator cannot occur in a slice name,
// a source id or an axis name, so no pair of parts can be re-parenthesised into
// another pair. Written as an escape, never as a literal control byte.
const KEY_SEP = "\u001f";
const TARGETS: Record<Partition, number> = {
  development: 0.2,
  calibration: 0.3,
  test: 0.5,
};

// The critical slices from the classifier design §6.4. `generatorExposure`
// resolves to `unseen` for the reserved families and `seen` for the rest.
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
  declaredGroupAxes: ReadonlyMap<string, readonly V3GroupAxis[]> = new Map(),
): SplitAudit {
  const byPartition: Record<Partition, readonly BenchmarkRecord[]> = {
    development: split.development,
    calibration: split.calibration,
    test: split.test,
  };

  const sizes = auditSizes(byPartition);
  const classFractions = auditClassFractions(records, byPartition);
  const cutoffs = auditCutoffs(byPartition);
  const leakages = auditLeakages(records, byPartition);
  const clusters = auditClusters(records, byPartition);
  const declaredAxisGaps = auditDeclaredAxes(records, declaredGroupAxes);

  const heldOutGeneratorFamilies = deriveHeldOutFamilies(byPartition);
  const criticalSliceSamples = auditCriticalSlices(
    records,
    split.test,
    heldOutGeneratorFamilies,
    policy,
  );

  const reasons = collectReasons(
    classFractions,
    cutoffs,
    leakages,
    declaredAxisGaps,
    byPartition,
    policy,
  );

  return {
    sizes,
    classFractions,
    cutoffs,
    leakages,
    clusters,
    declaredAxisGaps,
    criticalSliceSamples,
    heldOutGeneratorFamilies,
    passed: reasons.length === 0,
    reasons,
  };
}

/**
 * A stand-in cluster report for a HAND-BUILT audit object in a test fixture.
 *
 * `auditBlockedSplit` never returns this: it measures. It exists so a fixture that
 * only needs a structurally valid `SplitAudit` does not have to fabricate counts,
 * and it is deliberately all-zero so a fixture that leaks into a real assertion is
 * obviously empty rather than plausibly wrong.
 */
export function standInClusterReport(): SplitClusterReport {
  return {
    axes: V3_GROUP_AXES.map((axis) => {
      const connectivity = axisConnectivity(axis);
      return {
        axis,
        connectivity,
        linkage: connectivity.parentLinkage
          ? {
              references: 0,
              joinedAnotherRecordLine: 0,
              selfReference: 0,
              absentFromRecordSet: 0,
            }
          : null,
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
    development: byPartition.development.length,
    calibration: byPartition.calibration.length,
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
    fractions[label] = { development: 0, calibration: 0, test: 0 };
  }
  for (const partition of PARTITIONS) {
    for (const record of byPartition[partition]) {
      const total = totals.get(record.label) ?? 0;
      if (total > 0) fractions[record.label][partition] += 1 / total;
    }
  }
  return fractions;
}

function auditCutoffs(
  byPartition: Record<Partition, readonly BenchmarkRecord[]>,
): SplitAudit["cutoffs"] {
  const latest = (rows: readonly BenchmarkRecord[]): number =>
    rows.length === 0
      ? Number.NEGATIVE_INFINITY
      : Math.max(...rows.map((row) => row.createdAt));
  const earliest = (rows: readonly BenchmarkRecord[]): number =>
    rows.length === 0
      ? Number.POSITIVE_INFINITY
      : Math.min(...rows.map((row) => row.createdAt));
  return {
    latestDevelopment: latest(byPartition.development),
    latestCalibration: latest(byPartition.calibration),
    earliestTest: earliest(byPartition.test),
  };
}

function auditLeakages(
  records: readonly BenchmarkRecord[],
  byPartition: Record<Partition, readonly BenchmarkRecord[]>,
): SplitAudit["leakages"] {
  const leakages: SplitAudit["leakages"] = [];

  // Per-value checks on each of the eight grouping axes.
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
  // depth->=2 derivation chain (child in test, parent in development) that no
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

  const axes = V3_GROUP_AXES.map((axis) => {
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
    const connectivity = axisConnectivity(axis);
    return {
      axis,
      connectivity,
      linkage: connectivity.parentLinkage
        ? measureLinkage(assigned, axis)
        : null,
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
  axis: V3GroupAxis,
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
 */
function auditDeclaredAxes(
  records: readonly BenchmarkRecord[],
  declaredGroupAxes: ReadonlyMap<string, readonly V3GroupAxis[]>,
): DeclaredAxisGap[] {
  const counts = new Map<string, number>();
  for (const record of records) {
    const declared = declaredGroupAxes.get(record.provenance.sourceId);
    if (declared === undefined) continue;
    for (const axis of declared) {
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
        axis: axis as V3GroupAxis,
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

// The reserved families are those present in test yet absent from development
// and calibration — derived from the split itself so the audit never trusts an
// external declaration.
function deriveHeldOutFamilies(
  byPartition: Record<Partition, readonly BenchmarkRecord[]>,
): GeneratorFamily[] {
  const inTest = familySet(byPartition.test);
  const seenElsewhere = new Set<GeneratorFamily>([
    ...familySet(byPartition.development),
    ...familySet(byPartition.calibration),
  ]);
  return sortGeneratorFamilies(
    [...inTest].filter((family) => !seenElsewhere.has(family)),
  );
}

// Reads the CANONICAL field through the single accessor. Reading
// `row.generation?.family` here would derive the provider's dotted labels, which
// could never equal the underscore-spelled families the manifest declares — so
// the audit's set and the declared set were incomparable by construction.
function familySet(rows: readonly BenchmarkRecord[]): Set<GeneratorFamily> {
  const families = new Set<GeneratorFamily>();
  for (const row of rows) {
    const family = generatorFamilyOf(row);
    if (family !== undefined) families.add(family);
  }
  return families;
}

function auditCriticalSlices(
  records: readonly BenchmarkRecord[],
  test: readonly BenchmarkRecord[],
  heldOutGeneratorFamilies: readonly GeneratorFamily[],
  policy: SplitAuditPolicy,
): SplitAudit["criticalSliceSamples"] {
  const held = new Set(heldOutGeneratorFamilies);
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
            REBUILD_V3_POLICY.materialAssistance.minimumAiFraction
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

  const testAfterCalibration =
    byPartition.test.length === 0 ||
    byPartition.calibration.length === 0 ||
    cutoffs.earliestTest > cutoffs.latestCalibration;
  const testAfterDevelopment =
    byPartition.test.length === 0 ||
    byPartition.development.length === 0 ||
    cutoffs.earliestTest > cutoffs.latestDevelopment;
  // Complete the temporal chain development < calibration < test, so a
  // grouping-glued spanning component cannot silently leave a development record
  // newer than a calibration record.
  const calibrationAfterDevelopment =
    byPartition.calibration.length === 0 ||
    byPartition.development.length === 0 ||
    cutoffs.latestCalibration > cutoffs.latestDevelopment;
  if (
    !testAfterCalibration ||
    !testAfterDevelopment ||
    !calibrationAfterDevelopment
  ) {
    reasons.push(
      "temporal leakage: the blocked split is not strictly ordered development < calibration < test in time",
    );
  }

  for (const label of LABELS) {
    for (const partition of PARTITIONS) {
      const fraction = classFractions[label][partition];
      if (
        Math.abs(fraction - TARGETS[partition]) >
        policy.classTolerance + 1e-9
      ) {
        reasons.push(
          `class ${label} ${partition} fraction ${fraction.toFixed(3)} is outside ±${policy.classTolerance} of ${TARGETS[partition]}`,
        );
      }
    }
  }

  const testHumanNegatives = byPartition.test.filter(
    (row) => row.label === "human",
  ).length;
  if (testHumanNegatives < policy.minimumTestHumanNegatives) {
    reasons.push(
      `blocked test holds ${testHumanNegatives} human negatives, below the required minimum ${policy.minimumTestHumanNegatives}`,
    );
  }

  return reasons;
}
