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
import type { BenchmarkLabel, BenchmarkRecord } from "./schema.ts";
import {
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

export interface SplitAudit {
  sizes: Record<Partition, number>;
  classFractions: Record<BenchmarkLabel, Record<Partition, number>>;
  cutoffs: {
    latestDevelopment: number;
    latestCalibration: number;
    earliestTest: number;
  };
  leakages: Array<{ axis: string; value: string; partitions: Partition[] }>;
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

export function auditBlockedSplit(
  records: readonly BenchmarkRecord[],
  split: DatasetSplitInput,
  policy: SplitAuditPolicy,
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
    byPartition,
    policy,
  );

  return {
    sizes,
    classFractions,
    cutoffs,
    leakages,
    criticalSliceSamples,
    heldOutGeneratorFamilies,
    passed: reasons.length === 0,
    reasons,
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
        const value = record.groups[axis];
        if (value === undefined || value === "") continue;
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
    mixedFractionBucket: (record) =>
      record.mixture === undefined
        ? undefined
        : record.mixture.aiFraction >= 0.5
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
  byPartition: Record<Partition, readonly BenchmarkRecord[]>,
  policy: SplitAuditPolicy,
): string[] {
  const reasons: string[] = [];

  if (leakages.length > 0) {
    reasons.push(
      `grouping leakage: ${leakages.length} group value(s) cross partitions`,
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
