// The immutable split artifact: the frozen, self-verifying contract that records
// exactly how a dataset was partitioned into development/calibration/test. It
// binds together the dataset it splits (datasetDigest), the algorithm and policy
// that produced the split (algorithm/algorithmDigest/seed/policy), the per-record
// assignments and their permutation-invariant digest (assignmentsDigest), the
// temporal cuts and counts, the reserved generator families, and the independent
// leakage audit. The whole object is sealed under `splitDigest`, computed over
// itself minus that field.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// It reuses the Phase 1 canonical serialization/digest verbatim (no redefinition)
// and contains no Date/random — every digest is a pure function of its inputs, and
// the only seed is the one recorded in the split policy.

import { canonicalSha256 } from "../contracts/canonical-json.ts";
import { computeDatasetDigest } from "./digests.ts";
import {
  GeneratorFamilyError,
  assertGeneratorFamiliesEqual,
  isCanonicalGeneratorFamily,
  sortGeneratorFamilies,
  type GeneratorFamily,
} from "./generator-family.ts";
import type { DatasetManifest } from "./dataset-manifest.ts";
import type { BenchmarkRecord } from "./schema.ts";
import type { SplitAudit } from "./split-audit.ts";
import type { BlockedSplitPolicy, DatasetSplit, Partition } from "./split.ts";

const PARTITIONS: readonly Partition[] = ["development", "calibration", "test"];
const ALGORITHM = "blocked-group-time-v1" as const;

export interface SplitAssignment {
  id: string;
  partition: Partition;
}

export interface SplitArtifact {
  schemaVersion: 1;
  datasetDigest: string;
  algorithm: "blocked-group-time-v1";
  algorithmDigest: string;
  seed: number;
  policy: BlockedSplitPolicy;
  assignments: SplitAssignment[];
  assignmentsDigest: string;
  splitDigest: string;
  cutoffs: { calibrationCut: number; testCut: number };
  counts: Record<Partition, number>;
  heldOutGeneratorFamilies: GeneratorFamily[];
  audit: SplitAudit;
}

export interface BuildSplitArtifactInput {
  manifest: DatasetManifest;
  records: readonly BenchmarkRecord[];
  split: DatasetSplit<BenchmarkRecord>;
  policy: BlockedSplitPolicy;
  audit: SplitAudit;
}

/** Coded, fail-closed error thrown by the split-artifact contract. */
export class SplitArtifactError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SplitArtifactError";
    this.code = code;
  }
}

/**
 * Assembles the immutable artifact from a partition and its audit. Assignments are
 * flattened and sorted by id; `assignmentsDigest` is the canonical digest of that
 * ordered list (so it identifies the assignment SET regardless of physical order);
 * `splitDigest` seals the whole object minus itself. Cuts are reconstructed from
 * the audit's observed temporal boundaries.
 */
export async function buildSplitArtifact(
  input: BuildSplitArtifactInput,
): Promise<SplitArtifact> {
  const { manifest, records, split, policy, audit } = input;

  const assignments = buildAssignments(split);
  const assignmentsDigest = await canonicalSha256(assignments);
  const datasetDigest = await computeDatasetDigest(manifest, records);
  const algorithmDigest = await canonicalSha256({
    algorithm: ALGORITHM,
    policy,
  });
  const cutoffs = deriveCutoffs(audit);
  const counts: Record<Partition, number> = {
    development: split.development.length,
    calibration: split.calibration.length,
    test: split.test.length,
  };
  const heldOutGeneratorFamilies = sortGeneratorFamilies(
    policy.heldOutGeneratorFamilies,
  );

  const artifact: SplitArtifact = {
    schemaVersion: 1,
    datasetDigest,
    algorithm: ALGORITHM,
    algorithmDigest,
    seed: policy.seed,
    policy,
    assignments,
    assignmentsDigest,
    splitDigest: "",
    cutoffs,
    counts,
    heldOutGeneratorFamilies,
    audit,
  };
  artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
  return artifact;
}

/**
 * Recomputes every digest and confirms the artifact is a faithful, complete,
 * leakage-free split of the given dataset: the datasetDigest anchors it to the
 * real records, exactly one assignment exists per dataset id (no missing, extra or
 * duplicate), both self-digests recompute, and the embedded audit actually passed.
 * Any mismatch is a hard failure — there is no last-write-wins.
 */
export async function validateSplitArtifact(
  artifact: SplitArtifact,
  manifest: DatasetManifest,
  records: readonly BenchmarkRecord[],
): Promise<SplitArtifact> {
  const datasetDigest = await computeDatasetDigest(manifest, records);
  if (artifact.datasetDigest !== datasetDigest) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_DATASET_MISMATCH",
      "datasetDigest does not match the dataset the artifact claims to split",
    );
  }

  const datasetIds = new Set(records.map((record) => record.id));
  const assigned = new Set<string>();
  for (const assignment of artifact.assignments) {
    if (!datasetIds.has(assignment.id)) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_EXTRA_ASSIGNMENT",
        `assignment references id "${assignment.id}" absent from the dataset`,
      );
    }
    if (assigned.has(assignment.id)) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_DUPLICATE_ASSIGNMENT",
        `duplicate assignment: id "${assignment.id}" appears in more than one partition`,
      );
    }
    assigned.add(assignment.id);
  }
  if (assigned.size !== datasetIds.size) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_MISSING_ASSIGNMENT",
      `${datasetIds.size - assigned.size} dataset id(s) have no assignment`,
    );
  }

  const sorted = [...artifact.assignments].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const assignmentsDigest = await canonicalSha256(sorted);
  if (artifact.assignmentsDigest !== assignmentsDigest) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_ASSIGNMENTS_DIGEST_MISMATCH",
      "assignmentsDigest does not match the recomputed assignment digest",
    );
  }

  const splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
  if (artifact.splitDigest !== splitDigest) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_SPLIT_DIGEST_MISMATCH",
      "splitDigest does not match the recomputed split digest",
    );
  }

  if (artifact.audit.passed !== true) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_AUDIT_FAILED",
      "split artifact carries a leakage audit that did not pass",
    );
  }

  // This is where a sealed artifact re-enters the typed world from JSON (every
  // command loads it with a cast), so the canonical form and the set agreement are
  // re-checked here rather than assumed from the type. Three of the four places
  // are present: the declared policy, the sealed list, and the audit's derived
  // list. The splitter's marks are asserted in benchmark/commands/split.ts, where
  // the splitter itself runs.
  assertCanonicalFamilies(
    "policy.heldOutGeneratorFamilies",
    artifact.policy.heldOutGeneratorFamilies,
  );
  assertCanonicalFamilies(
    "heldOutGeneratorFamilies",
    artifact.heldOutGeneratorFamilies,
  );
  assertCanonicalFamilies(
    "audit.heldOutGeneratorFamilies",
    artifact.audit.heldOutGeneratorFamilies,
  );
  try {
    assertGeneratorFamiliesEqual(
      "declared",
      artifact.policy.heldOutGeneratorFamilies,
      "sealed",
      artifact.heldOutGeneratorFamilies,
    );
    assertGeneratorFamiliesEqual(
      "declared",
      artifact.policy.heldOutGeneratorFamilies,
      "derived",
      artifact.audit.heldOutGeneratorFamilies,
    );
  } catch (error) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_HELD_OUT_FAMILY_DISAGREEMENT",
      error instanceof GeneratorFamilyError ? error.message : String(error),
    );
  }

  return artifact;
}

// A JSON-loaded artifact is only nominally typed, so the canonical form is a
// runtime check here: a dotted spelling that slipped into a sealed file must be
// refused, never silently compared as a plain string.
function assertCanonicalFamilies(
  path: string,
  families: readonly GeneratorFamily[],
): void {
  if (!Array.isArray(families)) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_HELD_OUT_FAMILY_INVALID",
      `${path} must be an array of canonical generator families`,
    );
  }
  for (const [index, family] of families.entries()) {
    if (!isCanonicalGeneratorFamily(family)) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_HELD_OUT_FAMILY_INVALID",
        `${path}[${index}] is not a canonical generator family: ${JSON.stringify(family)}`,
      );
    }
  }
}

function buildAssignments(
  split: DatasetSplit<BenchmarkRecord>,
): SplitAssignment[] {
  const assignments: SplitAssignment[] = [];
  for (const partition of PARTITIONS) {
    for (const record of split[partition]) {
      assignments.push({ id: record.id, partition });
    }
  }
  assignments.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return assignments;
}

// The blocked cuts, reconstructed from the audit's observed boundaries: the newest
// development record is the calibration cut, the newest calibration record the test
// cut. Both must be finite, which they are for any split whose partitions are all
// populated (a precondition of a passing audit).
function deriveCutoffs(audit: SplitAudit): {
  calibrationCut: number;
  testCut: number;
} {
  const calibrationCut = audit.cutoffs.latestDevelopment;
  const testCut = audit.cutoffs.latestCalibration;
  if (!Number.isFinite(calibrationCut) || !Number.isFinite(testCut)) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_CUTOFFS_INVALID",
      "cannot derive finite calibration/test cutoffs from an empty partition",
    );
  }
  return { calibrationCut, testCut };
}

// The exact projection sealed by splitDigest: every field except splitDigest
// itself. Built explicitly (rather than by destructuring the field away) so the
// hashed key set is identical in build and validate and never drifts.
function withoutSplitDigest(
  artifact: SplitArtifact,
): Omit<SplitArtifact, "splitDigest"> {
  return {
    schemaVersion: artifact.schemaVersion,
    datasetDigest: artifact.datasetDigest,
    algorithm: artifact.algorithm,
    algorithmDigest: artifact.algorithmDigest,
    seed: artifact.seed,
    policy: artifact.policy,
    assignments: artifact.assignments,
    assignmentsDigest: artifact.assignmentsDigest,
    cutoffs: artifact.cutoffs,
    counts: artifact.counts,
    heldOutGeneratorFamilies: artifact.heldOutGeneratorFamilies,
    audit: artifact.audit,
  };
}
