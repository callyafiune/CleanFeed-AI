// The immutable split artifact: the frozen, self-verifying contract that records
// exactly how a dataset was partitioned into train/dev/cal-A/cal-B/test. It
// binds together the dataset it splits (datasetDigest), the algorithm and policy
// that produced the split (algorithm/algorithmDigest/seed/policy), the per-record
// assignments and their permutation-invariant digest (assignmentsDigest), the
// observed temporal boundaries and counts, the reserved generator families, and the
// independent leakage audit. The whole object is sealed under `splitDigest`, computed
// over itself minus that field.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// It reuses the Phase 1 canonical serialization/digest verbatim (no redefinition)
// and contains no Date/random — every digest is a pure function of its inputs, and
// the only seed is the one recorded in the split policy.

import { canonicalSha256 } from "../contracts/canonical-json.ts";
import {
  COMPOSITION_GATE_PARTITION,
  auditReleaseComposition,
  compositionBoundsOf,
  compositionBreachesOf,
  type CellComposition,
  type CompositionReport,
} from "./composition-gate.ts";
import { computeDatasetDigest } from "./digests.ts";
import {
  GeneratorFamilyError,
  assertGeneratorFamiliesEqual,
  isCanonicalGeneratorFamily,
  sortGeneratorFamilies,
  type GeneratorFamily,
} from "./generator-family.ts";
import type { DatasetManifest } from "./dataset-manifest.ts";
import type { BenchmarkLabel, BenchmarkRecord } from "./schema.ts";
import { PREREGISTRATION_V4 } from "./preregistration-v4.ts";
import {
  DECLARED_GROUP_AXES,
  FROZEN_SPLIT_AUDIT_POLICY,
  PARTITION_TARGETS,
  auditBlockedSplit,
  type SplitAudit,
} from "./split-audit.ts";
import {
  CLASS_TOLERANCE,
  PARTITIONS,
  withinClassTolerance,
  connectedComponentRoots,
  createBlockedSplit,
  type BlockedSplitPolicy,
  type DatasetSplit,
  type Partition,
} from "./split.ts";

const ALGORITHM = "blocked-group-time-v2" as const;
const SCHEMA_VERSION = 4 as const;
const SHA256_HEX = /^[0-9a-f]{64}$/u;

export interface SplitAssignment {
  id: string;
  partition: Partition;
}

export interface SplitArtifact {
  schemaVersion: 4;
  datasetDigest: string;
  algorithm: "blocked-group-time-v2";
  algorithmDigest: string;
  seed: number;
  policy: BlockedSplitPolicy;
  assignments: SplitAssignment[];
  assignmentsDigest: string;
  splitDigest: string;
  /**
   * Digest of the composition this split commits to, or `null` for a corpus that is not
   * `scientificUse: "release"`.
   *
   * DERIVED, never supplied: it is the canonical digest of the per-partition, per-class
   * inventory of record-lines AND independent connected components, recomputed from the
   * dataset and the assignments. A caller cannot hand one in, so no string satisfies the
   * field by being non-empty — the only value that validates is the one the corpus produces.
   *
   * Counted in components as well as lines because the pre-registered floor is written in
   * sampling units: a quota cell holding 300 lines collapsed into two components carries two
   * independent observations, not 300. Whether a given inventory SUFFICES is not decided here
   * (see the pre-registered floor); this field fixes what was actually composed.
   */
  compositionAttestation: string | null;
  /**
   * The composition gate's VERDICT over the blind block, or `null` for a corpus that is not
   * `scientificUse: "release"`.
   *
   * DERIVED, never supplied: the three quantities the pre-registered bounds are written in
   * — eligible human-negative record-lines, independent sampling units, and lines per origin
   * document — are counted per quota cell out of the partition this artifact seals, so no
   * caller can hand a receipt in and no number in it can be chosen.
   *
   * It RECORDS and does not JUDGE: a receipt whose `passed` is false is sealed as faithfully
   * as one that passes, and refusing to freeze such a corpus belongs to
   * benchmark/commands/split.ts, the one path that writes an artifact to disk. What sealing
   * buys is the LINK: the numbers a release was accepted against sit inside the
   * `splitDigest` projection, so everything that already compares that digest attests them
   * too, and they can be recomputed from the corpus rather than believed.
   */
  compositionReceipt: CompositionReport | null;
  cutoffs: SplitAudit["cutoffs"];
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

/**
 * The exact root keys a sealed artifact may carry, and the label vocabulary its audit may
 * report fractions for.
 *
 * Written as `Record<keyof …, true>` rather than an array so that a field added to the
 * contract without being listed here is a COMPILE error. The runtime need is separate and
 * real: a parsed file enters by cast, and `splitDigest` covers a projection that enumerates
 * known fields — so an unknown root key is invisible to the seal and rides along unsealed
 * unless the key SET itself is checked.
 */
const SEALED_ARTIFACT_KEYS: Record<keyof SplitArtifact, true> = {
  schemaVersion: true,
  datasetDigest: true,
  algorithm: true,
  algorithmDigest: true,
  seed: true,
  policy: true,
  assignments: true,
  assignmentsDigest: true,
  splitDigest: true,
  compositionAttestation: true,
  compositionReceipt: true,
  cutoffs: true,
  counts: true,
  heldOutGeneratorFamilies: true,
  audit: true,
};

/**
 * The boundaries a published cutoffs object must carry, keyed by the contract's own type so a
 * boundary added to the audit and not listed here is a COMPILE error. Written out once and
 * used for BOTH copies — the artifact republishes the audit's boundaries, and a hand-kept
 * list drifts from the type the moment the shape grows.
 */
const CUTOFF_KEYS: Record<keyof SplitAudit["cutoffs"], true> = {
  latestTrain: true,
  latestDev: true,
  latestCalA: true,
  latestCalB: true,
  earliestCalA: true,
  earliestCalB: true,
  earliestTest: true,
};

const AUDIT_CLASS_LABELS: Record<BenchmarkLabel, true> = {
  human: true,
  ai: true,
  mixed: true,
};

/**
 * The exact keys a sealed composition receipt and each of its per-cell rows may carry, keyed
 * by the GATE's own types so a quantity added there and not listed here is a COMPILE error.
 *
 * The runtime need is different from the root's: `splitDigest` hashes the receipt WHOLE, so a
 * key added inside it IS covered — and re-sealing restores that agreement, which is what a
 * forger does. What the key set buys is that a number nothing reads cannot sit beside the ones
 * a release was accepted against and be taken for one of them.
 */
const COMPOSITION_RECEIPT_KEYS: Record<keyof CompositionReport, true> = {
  partition: true,
  cells: true,
  lineFloor: true,
  unitFloor: true,
  maximumLinesPerOriginDocument: true,
  breaches: true,
  passed: true,
};

const CELL_COMPOSITION_KEYS: Record<keyof CellComposition, true> = {
  cell: true,
  humanNegativeLines: true,
  ineligibleLines: true,
  independentUnits: true,
  originDocuments: true,
  linesWithoutOriginDocument: true,
  linesInBusiestOriginDocument: true,
};

/**
 * The VALUE side of the same boundary. `assertExactKeys` establishes which keys exist; these
 * establish that what sits under them is the kind of thing the typed world assumes.
 *
 * Needed because the artifact is loaded with `as SplitArtifact` over parsed JSON: a numeric
 * `assignment.id`, a fraction that is the string "0.45" and a cutoff that is a string all
 * satisfy every digest — the file agrees with itself — and then reach the published evidence
 * summary as if they had been checked.
 */
function assertNonEmptyString(
  what: string,
  value: unknown,
  code: string,
): void {
  if (typeof value === "string" && value.length > 0) return;
  throw new SplitArtifactError(
    code,
    `${what} must be a non-empty string, received ${typeof value}`,
  );
}

function assertFiniteNumber(
  what: string,
  value: unknown,
  code: string,
  range?: { min: number; max: number },
): void {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new SplitArtifactError(
      code,
      `${what} must be a finite number, received ${typeof value}`,
    );
  }
  if (range && (value < range.min || value > range.max)) {
    throw new SplitArtifactError(
      code,
      `${what} is ${value}, outside [${range.min}, ${range.max}]`,
    );
  }
}

function assertExactKeys(
  what: string,
  value: unknown,
  allowed: Record<string, true>,
  code: string,
): void {
  const present = new Set(Object.keys(value as Record<string, unknown>));
  const expected = Object.keys(allowed);
  // `Object.hasOwn`, never `in`: `in` walks the prototype chain, so `__proto__` and
  // `constructor` read as allowed on any plain object and the exact-key check lets them
  // through — which is the whole class of key this guard exists to catch.
  const extra = [...present]
    .filter((key) => !Object.hasOwn(allowed, key))
    .sort();
  const missing = expected.filter((key) => !present.has(key)).sort();
  if (extra.length === 0 && missing.length === 0) return;
  const parts: string[] = [];
  if (extra.length > 0) parts.push(`unknown ${extra.join(", ")}`);
  if (missing.length > 0) parts.push(`absent ${missing.join(", ")}`);
  throw new SplitArtifactError(code, `${what} carries ${parts.join(" and ")}`);
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
 * The composition a `release` split commits to: for every partition, how many record-lines
 * and how many independent connected components each class contributes.
 *
 * Both numbers, because they answer different questions and only their pair is honest. Lines
 * say how much text there is; components say how many independent observations it carries,
 * and the two diverge by orders of magnitude on a corpus whose rows share generator,
 * generation batch or derivation chain.
 *
 * `connectedComponentRoots` is the single source of connectivity truth (benchmark/split.ts),
 * the same one the splitter and the audit call, so this inventory cannot disagree with the
 * partition it describes.
 */
async function compositionAttestationOf(
  records: readonly BenchmarkRecord[],
  assignments: readonly SplitAssignment[],
): Promise<string> {
  const roots = connectedComponentRoots(records);
  const labelOf = new Map(records.map((record) => [record.id, record.label]));
  // `Map`, not an object literal: the keys come from a parsed file, and `__proto__` used as
  // a key on a plain object mutates `Object.prototype` instead of creating an entry.
  const perPartition = new Map<
    string,
    Map<string, { recordLines: number; components: Set<string> }>
  >();
  for (const partition of PARTITIONS) perPartition.set(partition, new Map());

  for (const assignment of assignments) {
    const label = labelOf.get(assignment.id);
    const root = roots.get(assignment.id);
    if (label === undefined || root === undefined) continue;
    let cell = perPartition.get(assignment.partition);
    if (cell === undefined) {
      cell = new Map();
      perPartition.set(assignment.partition, cell);
    }
    let bucket = cell.get(label);
    if (bucket === undefined) {
      bucket = { recordLines: 0, components: new Set() };
      cell.set(label, bucket);
    }
    bucket.recordLines += 1;
    bucket.components.add(root);
  }

  const inventory: Record<
    string,
    Record<string, { recordLines: number; components: number }>
  > = {};
  for (const partition of PARTITIONS) {
    const cell = perPartition.get(partition) ?? new Map();
    const counted: Record<string, { recordLines: number; components: number }> =
      {};
    for (const label of [...cell.keys()].sort()) {
      const bucket = cell.get(label);
      if (bucket === undefined) continue;
      counted[label] = {
        recordLines: bucket.recordLines,
        components: bucket.components.size,
      };
    }
    inventory[partition] = counted;
  }

  // The INVENTORY alone. Folding the dataset and assignment digests in here would move the
  // field when neither the composition nor anything about it changed, and both are already
  // sealed by the artifact that carries this value.
  return canonicalSha256(inventory);
}

/**
 * Assembles the immutable artifact from a partition and its audit. Assignments are
 * flattened and sorted by id; `assignmentsDigest` is the canonical digest of that
 * ordered list (so it identifies the assignment SET regardless of physical order);
 * `splitDigest` seals the whole object minus itself. The temporal boundaries are the
 * audit's observed ones, copied rather than reconstructed.
 */
export async function buildSplitArtifact(
  input: BuildSplitArtifactInput,
): Promise<SplitArtifact> {
  const { manifest, records, split, policy, audit } = input;

  const assignments = buildAssignments(split);
  const assignmentsDigest = await canonicalSha256(assignments);
  const datasetDigest = await computeDatasetDigest(manifest, records);
  const compositionAttestation =
    manifest.scientificUse === "release"
      ? await compositionAttestationOf(records, assignments)
      : null;
  // The gate runs ONCE for a release, here, and its verdict is sealed instead of logged: the
  // three quantities per quota cell are counted off the partition being sealed, so the
  // receipt cannot describe another one.
  const compositionReceipt =
    manifest.scientificUse === "release"
      ? auditReleaseComposition(split)
      : null;
  const algorithmDigest = await canonicalSha256({
    algorithm: ALGORITHM,
    policy,
  });
  const cutoffs = requireFiniteCutoffs(audit);
  const counts: Record<Partition, number> = {
    train: split.train.length,
    dev: split.dev.length,
    "cal-A": split["cal-A"].length,
    "cal-B": split["cal-B"].length,
    test: split.test.length,
  };
  const heldOutGeneratorFamilies = sortGeneratorFamilies(
    policy.heldOutGeneratorFamilies,
  );

  const artifact: SplitArtifact = {
    schemaVersion: SCHEMA_VERSION,
    datasetDigest,
    algorithm: ALGORITHM,
    algorithmDigest,
    seed: policy.seed,
    policy,
    compositionAttestation,
    compositionReceipt,
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
  // Shape and vocabulary FIRST, before any string from the file is used for anything.
  // Every check in there is decidable without the dataset, and running them later lets a
  // parsed object drive lookups and digests while still unvalidated.
  await assertSplitArtifactSelfConsistent(artifact);

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
    assigned.add(assignment.id);
  }
  if (assigned.size !== datasetIds.size) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_MISSING_ASSIGNMENT",
      `${datasetIds.size - assigned.size} dataset id(s) have no assignment`,
    );
  }

  // The attestation is RECOMPUTED, so a sealed file cannot claim a composition its own
  // records and assignments do not produce.
  //
  // Reached only AFTER the dataset-independent guard, and the order is load-bearing: this
  // walks `assignments` and keys by `assignment.partition`, so a partition name from an
  // unvalidated file would drive a lookup before the vocabulary check that rejects it. A non-release corpus must carry none: an
  // attestation there would assert an inventory nobody is entitled to publish.
  if (manifest.scientificUse === "release") {
    const recomputed = await compositionAttestationOf(
      records,
      artifact.assignments,
    );
    if (artifact.compositionAttestation !== recomputed) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MISMATCH",
        "compositionAttestation does not match the composition the dataset and the " +
          "assignments produce",
      );
    }
  } else if (artifact.compositionAttestation !== null) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_UNEXPECTED",
      `a ${manifest.scientificUse} corpus must not carry a composition attestation`,
    );
  }

  // The sealed AUDIT, re-derived from the records rather than believed.
  //
  // Everything above proves the file agrees with itself, which a re-sealed forgery does
  // by construction. None of it looks at whether the audit DATA is true of the dataset:
  // `classFractions`, `cutoffs`, `leakages`, `testHumanNegatives` and `passed` were all
  // taken from the file. So a sealed artifact could publish 2000 human negatives over a
  // blind block holding twenty rows, recompute every digest, and re-enter fit, score and
  // evaluate as a typed value.
  //
  // This function is the one caller that HAS the dataset, so it is the only place the
  // audit can be reproduced. The partitions come back from the assignments — which the
  // coverage checks above already bound to the dataset one-to-one — and the audit runs
  // again under the same frozen policy, read from one place so the two cannot diverge.
  const byPartition: DatasetSplit<BenchmarkRecord> = {
    train: [],
    dev: [],
    "cal-A": [],
    "cal-B": [],
    test: [],
  };
  const recordById = new Map(records.map((record) => [record.id, record]));
  for (const assignment of [...artifact.assignments].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  )) {
    byPartition[assignment.partition].push(
      recordById.get(assignment.id) as BenchmarkRecord,
    );
  }

  // The RECEIPT, recounted from the partition the assignments describe. Every dataset-free
  // guard proves the receipt is internally coherent, which a re-sealed forgery is by
  // construction; none of them can decide WHO was counted — whether those record-lines are
  // human negatives, whether they clear the word floor, whether their origin documents are
  // distinct. This function is the one entry point that has the records, so it is the only
  // place that can, and it compares by canonical digest rather than by reference.
  if (manifest.scientificUse === "release") {
    const recountedReceipt = auditReleaseComposition(byPartition);
    if (
      (await canonicalSha256(artifact.compositionReceipt)) !==
      (await canonicalSha256(recountedReceipt))
    ) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MISMATCH",
        "compositionReceipt does not match the composition the dataset and the assignments " +
          "produce",
      );
    }
  } else if (artifact.compositionReceipt !== null) {
    // UNREACHABLE from here, and named rather than dropped so that a lock which moves fails
    // by name instead of obscurely: a receipt without an attestation is already refused as
    // UNPAIRED by the dataset-independent guard, and a non-release artifact carrying BOTH is
    // refused as an unexpected ATTESTATION above. This is the second lock, which is why a
    // mutation audit finds no test that reaches it.
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_UNEXPECTED",
      `a ${manifest.scientificUse} corpus must not carry a composition receipt`,
    );
  }
  // The RESERVE, against the manifest this validator was handed — not against the copy
  // inside the artifact.
  //
  // Re-deriving the audit from `artifact.policy.heldOutGeneratorFamilies` proves the file
  // agrees with ITSELF, which a forger restores by re-sealing: swap or erase the reserve,
  // re-derive, re-seal, and every digest recomputes. `runSplit` imposes equality across the
  // four sets, but it is not the only way in — so the comparison belongs here too, where the
  // external authority is present.
  try {
    assertGeneratorFamiliesEqual(
      "manifest",
      manifest.heldOutGeneratorFamilies,
      "artifact policy",
      artifact.policy.heldOutGeneratorFamilies,
    );
  } catch (error) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_HELD_OUT_FAMILY_DISAGREEMENT",
      error instanceof GeneratorFamilyError ? error.message : String(error),
    );
  }

  const rederived = auditBlockedSplit(
    records,
    byPartition,
    FROZEN_SPLIT_AUDIT_POLICY,
    artifact.policy.heldOutGeneratorFamilies,
    DECLARED_GROUP_AXES,
  );
  // A partition left empty by the assignments makes `latest`/`earliest` non-finite, and
  // canonicalizing that throws a JSON error instead of naming the problem.
  //
  // UNREACHABLE BY DESIGN, and that is the point rather than a gap: an empty partition puts a
  // class fraction at 0 against a target of at least 0.05, so the coherence check above refuses
  // it first. This exists to convert an obscure failure into a named one if the earlier lock
  // ever moves — which is a different thing from a redundant check, and the reason a mutation
  // audit finds no test for it.
  for (const [boundary, value] of Object.entries(rederived.cutoffs)) {
    if (!Number.isFinite(value)) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_CUTOFFS_INVALID",
        `re-deriving the audit left ${boundary} non-finite: the assignments leave a partition empty`,
      );
    }
  }

  const sealedAuditDigest = await canonicalSha256(artifact.audit);
  const rederivedAuditDigest = await canonicalSha256(rederived);
  if (sealedAuditDigest !== rederivedAuditDigest) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_AUDIT_NOT_REPRODUCIBLE",
      "the sealed audit does not reproduce from the dataset and the assignments" +
        (rederived.passed === artifact.audit.passed
          ? ""
          : `; sealed passed=${String(artifact.audit.passed)} but re-derived passed=${String(rederived.passed)}`),
    );
  }

  // Provenance of the ASSIGNMENT. Everything above establishes that the partition HAS the
  // properties a release rests on; none of it establishes that the declared ALGORITHM,
  // over these records and this policy, is what produced it — a hand-tuned partition can
  // satisfy every audited property. The seed is not part of that claim: it is validated
  // against the frozen pre-registration and selects nothing, because placement is a pure
  // function of the records, the fractions, the tolerance and the reserve. So the splitter runs again over the same records under the artifact's
  // own policy, and only `id` and `partition` are compared: the rest of an assignment is
  // record data already bound to the dataset by the coverage checks.
  const reproduced = createBlockedSplit(records, artifact.policy);
  const byId = (a: { id: string }, b: { id: string }): number =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  const reproducedPlacement = PARTITIONS.flatMap((partition) =>
    reproduced[partition].map((record) => ({ id: record.id, partition })),
  ).sort(byId);
  const sealedPlacement = artifact.assignments
    .map((assignment) => ({
      id: assignment.id,
      partition: assignment.partition,
    }))
    .sort(byId);
  if (
    (await canonicalSha256(reproducedPlacement)) !==
    (await canonicalSha256(sealedPlacement))
  ) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_ASSIGNMENTS_NOT_REPRODUCIBLE",
      `re-running ${artifact.algorithm} over the same dataset under this policy ` +
        "produces a different partition than the one sealed",
    );
  }

  return artifact;
}

/**
 * Everything about a sealed artifact that can be checked WITHOUT the dataset: the
 * partition vocabulary, the three self-digests, the audit verdict and the canonical
 * generator-family forms.
 *
 * Separate and exported because `validateSplitArtifact` needs the manifest and the
 * records, and not every consumer has them. `publish-evidence` had neither, so it cast
 * the JSON and compared only the DECLARED `splitDigest` against the report — which a
 * tampered file satisfies by keeping the old digest string. Every field that reaches
 * public evidence (`algorithm`, `counts`, `cutoffs`, the whole `audit`) sits inside the
 * `splitDigest` projection, so recomputing that digest here is what makes the
 * comparison mean something.
 */
export async function assertSplitArtifactSelfConsistent(
  artifact: SplitArtifact,
): Promise<SplitArtifact> {
  await assertDatasetIndependentInvariants(artifact);

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
  // Checked for the same reason even though NO gate compares it: the report prints
  // this list and reads `.length` on it, so a non-canonical spelling would reach a
  // published document unexamined, and an absent key would surface as a TypeError
  // from the renderer instead of naming the file and the path. It stays out of the
  // set agreements below — it is diagnosis, not reserve.
  assertCanonicalFamilies(
    "audit.incidentalTestOnlyGeneratorFamilies",
    artifact.audit.incidentalTestOnlyGeneratorFamilies,
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

/**
 * The version, algorithm and partition VOCABULARY, checked at runtime.
 *
 * Every command reaches this artifact by casting parsed JSON (`as SplitArtifact`), so the
 * literal types on `schemaVersion` and `algorithm` constrain nothing about a file on
 * disk: a fully self-consistent artifact of an older shape recomputes all of its own
 * digests and passes every one of them. This is the only thing standing between such a
 * file and the typed world.
 *
 * `algorithmDigest` is recomputed rather than only compared, because it is what binds the
 * policy to the algorithm: a file whose `policy` was edited and re-sealed keeps a valid
 * `splitDigest`, since that digest covers the edited policy.
 */
async function assertDatasetIndependentInvariants(
  artifact: SplitArtifact,
): Promise<void> {
  // The key SET first, before any digest is trusted: a digest computed over a projection of
  // known fields agrees with itself no matter what else the parsed object carries.
  assertExactKeys(
    "the split artifact",
    artifact,
    SEALED_ARTIFACT_KEYS,
    "SPLIT_ARTIFACT_UNKNOWN_FIELD",
  );
  assertExactKeys(
    "audit.classFractions",
    artifact.audit.classFractions,
    AUDIT_CLASS_LABELS,
    "SPLIT_ARTIFACT_UNKNOWN_CLASS_LABEL",
  );
  if (artifact.compositionReceipt !== null) {
    assertCompositionReceiptShape(artifact.compositionReceipt);
  }

  if (artifact.schemaVersion !== SCHEMA_VERSION) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_SCHEMA_UNSUPPORTED",
      `schemaVersion must be ${SCHEMA_VERSION}, received ${String(artifact.schemaVersion)}`,
    );
  }
  if (artifact.algorithm !== ALGORITHM) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_ALGORITHM_UNSUPPORTED",
      `algorithm must be ${ALGORITHM}, received ${String(artifact.algorithm)}`,
    );
  }

  const known = new Set<string>(PARTITIONS);
  for (const [index, assignment] of artifact.assignments.entries()) {
    assertNonEmptyString(
      `assignments[${index}].id`,
      assignment.id,
      "SPLIT_ARTIFACT_ASSIGNMENT_ID_INVALID",
    );
    if (!known.has(assignment.partition)) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_PARTITION_UNKNOWN",
        `assignment "${String(assignment.id)}" names partition "${String(assignment.partition)}", which is not one of ${PARTITIONS.join(", ")}`,
      );
    }
  }

  // Exact key sets, not merely "the five are present": an extra key names a vocabulary this
  // build does not implement, and reading it as absent leaves that partition unaudited.
  for (const [field, value] of [
    ["counts", artifact.counts],
    ["policy.fractions", artifact.policy.fractions],
  ] as const) {
    const keys = Object.keys(value).sort();
    if (keys.join(",") !== [...PARTITIONS].sort().join(",")) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_PARTITION_UNKNOWN",
        `${field} must carry exactly ${PARTITIONS.join(", ")}, received ${keys.join(", ")}`,
      );
    }
  }

  // The AUDIT's own partition-keyed shapes, not just the top-level ones. A header naming this
  // build's schema over an audit keyed by other partition names is internally consistent and
  // seals cleanly: the fraction check INSIDE that audit ran over names this build does not
  // implement, and `passed: true` would be taken at face value here.
  const expectedKeys = [...PARTITIONS].sort().join(",");
  // Derived from the label vocabulary, not written out: a class added to `BenchmarkLabel`
  // and forgotten in a hand-kept list leaves that class's shape unchecked, and an unchecked
  // shape is how a partition goes unaudited.
  const shapes: Array<[string, Record<string, unknown>]> = [
    ["audit.sizes", artifact.audit.sizes],
    ...(Object.keys(AUDIT_CLASS_LABELS) as BenchmarkLabel[]).map(
      (label): [string, Record<string, unknown>] => [
        `audit.classFractions.${label}`,
        artifact.audit.classFractions[label] as unknown as Record<
          string,
          unknown
        >,
      ],
    ),
  ];
  for (const [field, value] of shapes) {
    const keys = Object.keys(value).sort().join(",");
    if (keys !== expectedKeys) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_PARTITION_UNKNOWN",
        `${field} must carry exactly ${PARTITIONS.join(", ")}, received ${keys}`,
      );
    }
  }
  assertExactKeys(
    "audit.cutoffs",
    artifact.audit.cutoffs,
    CUTOFF_KEYS,
    "SPLIT_ARTIFACT_PARTITION_UNKNOWN",
  );
  assertExactKeys(
    "cutoffs",
    artifact.cutoffs,
    CUTOFF_KEYS,
    "SPLIT_ARTIFACT_PARTITION_UNKNOWN",
  );
  for (const leakage of artifact.audit.leakages) {
    for (const partition of leakage.partitions) {
      if (!known.has(partition)) {
        throw new SplitArtifactError(
          "SPLIT_ARTIFACT_PARTITION_UNKNOWN",
          `audit.leakages names partition "${String(partition)}", which is not one of ${PARTITIONS.join(", ")}`,
        );
      }
    }
  }

  // `counts` against the assignments it summarises, and against the audit's own sizes.
  // Three numbers describing one partitioning could disagree while every digest still
  // recomputed, because each digest only proves the file is consistent with ITSELF.
  const fromAssignments = new Map<string, number>(
    PARTITIONS.map((partition) => [partition, 0]),
  );
  for (const assignment of artifact.assignments) {
    fromAssignments.set(
      assignment.partition,
      (fromAssignments.get(assignment.partition) ?? 0) + 1,
    );
  }
  for (const partition of PARTITIONS) {
    const counted = fromAssignments.get(partition) ?? 0;
    if (artifact.counts[partition] !== counted) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_COUNTS_MISMATCH",
        `counts.${partition} is ${artifact.counts[partition]} but ${counted} assignment(s) name it`,
      );
    }
    if (artifact.audit.sizes[partition] !== counted) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_COUNTS_MISMATCH",
        `audit.sizes.${partition} is ${artifact.audit.sizes[partition]} but ${counted} assignment(s) name it`,
      );
    }
  }

  // The POLICY against the authorities outside this file. Every check above proves the
  // artifact agrees with ITSELF, which a re-sealed file does by construction: recompute
  // both digests after editing `policy` and every one of them passes. Only an external
  // frozen value separates a sealed artifact from a plausible forgery, and there are two
  // — the pre-registered fractions, and the frozen tolerance.
  for (const partition of PARTITIONS) {
    const expected = PARTITION_TARGETS[partition];
    if (artifact.policy.fractions[partition] !== expected) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_POLICY_NOT_PREREGISTERED",
        `policy.fractions.${partition} is ${String(artifact.policy.fractions[partition])}, not the pre-registered ${expected}`,
      );
    }
  }
  if (artifact.policy.classTolerance !== CLASS_TOLERANCE) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_POLICY_NOT_PREREGISTERED",
      `policy.classTolerance is ${String(artifact.policy.classTolerance)}, not the frozen ${CLASS_TOLERANCE}`,
    );
  }

  // The attestation's SHAPE, decidable without the dataset. A parsed file enters by cast,
  // so `string | null` is a compile-time claim only: a number, or a string that is not a
  // sha256, would reach the pairing check and the digest comparison as if it were one.
  const attestation: unknown = artifact.compositionAttestation;
  // `typeof` before the regex: `String(["<64 hex>"])` is that hex string, so testing the
  // coerced form accepts an array — and anything else whose `toString` lands on a digest.
  if (
    attestation !== null &&
    !(typeof attestation === "string" && SHA256_HEX.test(attestation))
  ) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MALFORMED",
      "compositionAttestation must be null or a lowercase 64-character sha256",
    );
  }

  // The two composition fields stand or fall TOGETHER: both are derived from
  // `scientificUse: "release"` and from nothing else, so one present without the other
  // describes a corpus that is release and is not. It is also what makes the PUBLICATION
  // path demand a receipt without a line changing in benchmark/commands/publish-evidence.ts:
  // that command already refuses a release whose attestation is null, so release implies
  // attestation and attestation implies receipt.
  const receipt: CompositionReport | null = artifact.compositionReceipt;
  if ((attestation === null) !== (receipt === null)) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_UNPAIRED",
      `compositionAttestation is ${attestation === null ? "null" : "present"} while ` +
        `compositionReceipt is ${receipt === null ? "null" : "present"}: both are derived ` +
        "from the same corpus and cannot disagree",
    );
  }
  if (receipt !== null) await assertCompositionReceiptCoherent(receipt);

  // The pre-registered seed HERE, not only in the full validator: the publication path
  // reaches this guard alone, and an arbitrary seed sealed into an artifact is decidable
  // without the dataset.
  if (artifact.policy.seed !== PREREGISTRATION_V4.seeds.split) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_SEED_NOT_PRE_REGISTERED",
      `policy.seed ${String(artifact.policy.seed)} is not the pre-registered split seed ` +
        `${PREREGISTRATION_V4.seeds.split}`,
    );
  }

  // The seed is published twice — once at the top, once inside the policy that the
  // algorithmDigest covers. Only the second is bound by a digest, so they can disagree.
  if (artifact.seed !== artifact.policy.seed) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_SEED_MISMATCH",
      `seed ${artifact.seed} disagrees with policy.seed ${artifact.policy.seed}`,
    );
  }

  // `passed` against its own reasons. Nothing here needs the dataset, the two can disagree
  // in a re-sealed file, and every downstream gate reads `passed` and nothing else.
  if (!Array.isArray(artifact.audit.reasons)) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
      "audit.reasons must be an array",
    );
  }
  for (const [index, reason] of artifact.audit.reasons.entries()) {
    assertNonEmptyString(
      `audit.reasons[${index}]`,
      reason,
      "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
    );
  }
  if (artifact.audit.passed !== (artifact.audit.reasons.length === 0)) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
      `audit.passed is ${String(artifact.audit.passed)} over ${artifact.audit.reasons.length} reason(s)`,
    );
  }

  // Assignment ids are unique. This needs no dataset — only the list — so leaving it in
  // the full validator let a duplicate id through the publication path with counts that
  // still added up.
  const seen = new Set<string>();
  for (const assignment of artifact.assignments) {
    if (seen.has(assignment.id)) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_DUPLICATE_ASSIGNMENT",
        `duplicate assignment: id "${assignment.id}" appears more than once`,
      );
    }
    seen.add(assignment.id);
  }

  // The artifact republishes the audit's boundaries, so the two copies must agree — also
  // dataset-independent, and divergent copies were accepted by the publication path.
  const published = await canonicalSha256(artifact.cutoffs);
  const measured = await canonicalSha256(artifact.audit.cutoffs);
  if (published !== measured) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_CUTOFFS_MISMATCH",
      "cutoffs disagree with the audit's observed boundaries",
    );
  }

  const algorithmDigest = await canonicalSha256({
    algorithm: artifact.algorithm,
    policy: artifact.policy,
  });
  if (artifact.algorithmDigest !== algorithmDigest) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_ALGORITHM_DIGEST_MISMATCH",
      "algorithmDigest does not match the recorded algorithm and policy",
    );
  }
  // VALUE types last: the vocabulary checks above decide which keys must exist, and an
  // artifact carrying the old partition names has to be refused for THAT rather than for
  // a missing key reading as a non-number.
  //
  // `counts` and `audit.sizes` are deliberately absent: both are compared against the tally
  // of the assignments, and no non-number can equal a tallied one, so a type check on them
  // would be unreachable.
  for (const label of Object.keys(AUDIT_CLASS_LABELS)) {
    const perPartition = artifact.audit.classFractions[
      label as BenchmarkLabel
    ] as unknown as Record<string, unknown>;
    for (const partition of PARTITIONS) {
      assertFiniteNumber(
        `audit.classFractions.${label}.${partition}`,
        perPartition[partition],
        "SPLIT_ARTIFACT_CLASS_FRACTION_INVALID",
        { min: 0, max: 1 },
      );
    }
  }

  for (const [boundary, value] of Object.entries(
    artifact.cutoffs as unknown as Record<string, unknown>,
  )) {
    assertFiniteNumber(
      `cutoffs.${boundary}`,
      value,
      "SPLIT_ARTIFACT_CUTOFFS_INVALID",
    );
  }
  for (const [boundary, value] of Object.entries(
    artifact.audit.cutoffs as unknown as Record<string, unknown>,
  )) {
    assertFiniteNumber(
      `audit.cutoffs.${boundary}`,
      value,
      "SPLIT_ARTIFACT_CUTOFFS_INVALID",
    );
  }

  // The audit's own INTERNAL implications, all of them decidable without the dataset. Digest
  // agreement proves the file agrees with itself, and `passed === (reasons.length === 0)`
  // proves one pair agrees — neither looks at whether the verdict is compatible with the rest
  // of the audit it publishes. This guard is the only one the publication path reaches.
  if (!Array.isArray(artifact.audit.leakages)) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
      "audit.leakages must be an array",
    );
  }
  if (artifact.audit.leakages.length > 0) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
      `audit publishes ${artifact.audit.leakages.length} leakage(s) while passing: a group ` +
        "value crossing partitions is the one thing no later stage can repair",
    );
  }
  if (!Array.isArray(artifact.audit.criticalSliceSamples)) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
      "audit.criticalSliceSamples must be an array",
    );
  }
  if (!Array.isArray(artifact.audit.declaredAxisGaps)) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
      "audit.declaredAxisGaps must be an array",
    );
  }
  if (artifact.audit.declaredAxisGaps.length > 0) {
    throw new SplitArtifactError(
      "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
      `audit publishes ${artifact.audit.declaredAxisGaps.length} declared-axis gap(s) while ` +
        "passing: a declared axis left unknown cannot support the split",
    );
  }

  // The published fractions against the frozen targets. A class ABSENT from the corpus
  // publishes zeros in all five, which the splitter and the audit both skip, so a class whose
  // fractions sum to zero is not compared — the same vacuity rule, stated once.
  for (const label of Object.keys(AUDIT_CLASS_LABELS) as BenchmarkLabel[]) {
    const perPartition = artifact.audit.classFractions[label];
    const total = PARTITIONS.reduce(
      (sum, partition) => sum + perPartition[partition],
      0,
    );
    if (total === 0) continue;
    // The five cells of a PRESENT class partition the class, so they sum to 1. Checking each
    // cell against its target does not imply it: every cell can sit inside its tolerance while
    // the five sum to 1.01, which is a partition of nothing.
    if (Math.abs(total - 1) > 1e-9) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
        `audit passes while classFractions.${label} sums to ${total} instead of 1`,
      );
    }
    for (const partition of PARTITIONS) {
      const target = PARTITION_TARGETS[partition];
      if (!withinClassTolerance(perPartition[partition], target)) {
        throw new SplitArtifactError(
          "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
          `audit passes while publishing classFractions.${label}.${partition} = ` +
            `${perPartition[partition]}, outside ${target} ± ${CLASS_TOLERANCE}`,
        );
      }
    }
  }

  // The published boundaries against the temporal relations the audit asserts. `earliestTest`
  // strictly after every other partition's latest INCLUDING train, because train is the
  // fallback and absorbs straddlers — that is test-period text inside training data. The three
  // middle partitions are ordered among themselves, and each holds only components lying
  // entirely inside its band, so their `latest` values inherit that order.
  const boundaries = artifact.cutoffs;
  for (const [name, value] of [
    ["latestTrain", boundaries.latestTrain],
    ["latestDev", boundaries.latestDev],
    ["latestCalA", boundaries.latestCalA],
    ["latestCalB", boundaries.latestCalB],
  ] as const) {
    if (!(boundaries.earliestTest > value)) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
        `audit passes while publishing earliestTest ${boundaries.earliestTest} not strictly ` +
          `after ${name} ${value}`,
      );
    }
  }
  // EARLIEST against LATEST, which is the relation the audit asserts. Comparing `latest`
  // values only would accept overlapping middle ranges: ordered ranges imply monotonic
  // `latest`, and the converse does not hold.
  for (const [current, previous] of [
    ["cal-A", "dev"],
    ["cal-B", "cal-A"],
  ] as const) {
    const earliest =
      current === "cal-A" ? boundaries.earliestCalA : boundaries.earliestCalB;
    const latestPrevious =
      previous === "dev" ? boundaries.latestDev : boundaries.latestCalA;
    if (!(earliest > latestPrevious)) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_AUDIT_INCOHERENT",
        `audit passes while publishing earliest(${current}) ${earliest} not strictly after ` +
          `latest(${previous}) ${latestPrevious}`,
      );
    }
  }
}

/**
 * The receipt's SHAPE: an object carrying exactly the gate's keys, whose `cells` is an array
 * of rows carrying exactly the gate's per-cell keys and whose `breaches` is an array.
 *
 * Runs before any count under those keys is read, for the reason the root key check exists: a
 * digest computed over an enumerated projection agrees with itself whatever else the parsed
 * object carries, so an unknown key beside the counts rides along uninspected.
 */
function assertCompositionReceiptShape(receipt: unknown): void {
  const code = "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED";
  if (
    typeof receipt !== "object" ||
    receipt === null ||
    Array.isArray(receipt)
  ) {
    throw new SplitArtifactError(
      code,
      `compositionReceipt must be null or an object, received ${Array.isArray(receipt) ? "array" : typeof receipt}`,
    );
  }
  assertExactKeys(
    "compositionReceipt",
    receipt,
    COMPOSITION_RECEIPT_KEYS,
    code,
  );
  const { cells, breaches } = receipt as { cells: unknown; breaches: unknown };
  for (const [field, value] of [
    ["cells", cells],
    ["breaches", breaches],
  ] as const) {
    if (!Array.isArray(value)) {
      throw new SplitArtifactError(
        code,
        `compositionReceipt.${field} must be an array, received ${typeof value}`,
      );
    }
  }
  for (const [index, row] of (cells as unknown[]).entries()) {
    if (typeof row !== "object" || row === null || Array.isArray(row)) {
      throw new SplitArtifactError(
        code,
        `compositionReceipt.cells[${index}] must be an object, received ${Array.isArray(row) ? "array" : typeof row}`,
      );
    }
    assertExactKeys(
      `compositionReceipt.cells[${index}]`,
      row,
      CELL_COMPOSITION_KEYS,
      code,
    );
  }
}

/**
 * Everything about a sealed receipt that is decidable WITHOUT the dataset: the counts are
 * counts, their arithmetic is one a tally can have, the bounds and the cell list are the
 * pre-registered ones, and the breach list and the verdict follow from the cells.
 *
 * What it cannot decide, and does not claim: WHO was counted. Whether those record-lines are
 * human negatives, whether they clear the word floor, whether their origin documents are
 * distinct — only a recompute against the corpus decides that, and it lives in
 * {@link validateSplitArtifact}. It also does not require `passed`: recording a verdict is
 * not imposing it, and the refusal to freeze a short corpus belongs to the command that
 * writes the artifact.
 */
async function assertCompositionReceiptCoherent(
  receipt: CompositionReport,
): Promise<void> {
  const malformed = "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED";
  // Derived from the key vocabulary rather than written out: every key but `cell` IS one of
  // the counts, so a quantity added to the contract is type-checked here by construction
  // instead of being silently skipped.
  const countedQuantities = (
    Object.keys(CELL_COMPOSITION_KEYS) as Array<keyof CellComposition>
  ).filter((key) => key !== "cell");

  for (const [index, row] of receipt.cells.entries()) {
    const where = `compositionReceipt.cells[${index}]`;
    assertNonEmptyString(`${where}.cell`, row.cell, malformed);
    const counts = row as unknown as Record<string, unknown>;
    for (const quantity of countedQuantities) {
      const value = counts[quantity];
      // `Number.isInteger`, NOT `assertFiniteNumber`, and the difference is the whole point:
      // relational comparison COERCES, so `"300" < 300` is `false` and a count that is the
      // string "300" clears a floor in silence — while the recomputed breach list agrees with
      // the sealed one, because both sides coerce identically. A fraction is refused for the
      // same reason a count of 2.5 lines is not a count.
      if (!Number.isInteger(value) || (value as number) < 0) {
        throw new SplitArtifactError(
          malformed,
          `${where}.${quantity} must be an integer >= 0, received ${JSON.stringify(value)}`,
        );
      }
    }

    // WELL-FORMATION, which is neither the criterion nor an anti-forgery device: it is the
    // shape every tally the gate can produce has. Each counted line sits in exactly one
    // bucket — an origin document, or the ONE bucket holding the lines whose origin was not
    // recovered — so the lines cannot be fewer than the documents plus that bucket; units are
    // components OF those lines; and the busiest bucket is the maximum over the buckets, the
    // unrecoverable one included, so it bounds that bucket from above and is at least one
    // whenever any line was counted. What this refuses is the direction that OVER-states
    // power: 300 lines of unrecoverable origin published behind a busiest document of one.
    for (const [holds, description] of [
      [
        row.humanNegativeLines >=
          row.originDocuments + row.linesWithoutOriginDocument,
        `humanNegativeLines ${row.humanNegativeLines} is fewer than originDocuments ` +
          `${row.originDocuments} plus linesWithoutOriginDocument ${row.linesWithoutOriginDocument}`,
      ],
      [
        row.independentUnits <= row.humanNegativeLines,
        `independentUnits ${row.independentUnits} exceeds humanNegativeLines ${row.humanNegativeLines}`,
      ],
      [
        row.linesInBusiestOriginDocument <= row.humanNegativeLines,
        `linesInBusiestOriginDocument ${row.linesInBusiestOriginDocument} exceeds ` +
          `humanNegativeLines ${row.humanNegativeLines}`,
      ],
      [
        row.linesWithoutOriginDocument <= row.linesInBusiestOriginDocument,
        `linesWithoutOriginDocument ${row.linesWithoutOriginDocument} exceeds the busiest ` +
          `origin document's ${row.linesInBusiestOriginDocument}, and that bucket is one of them`,
      ],
      [
        row.humanNegativeLines === 0 || row.linesInBusiestOriginDocument >= 1,
        `humanNegativeLines ${row.humanNegativeLines} were counted into no origin document bucket`,
      ],
    ] as const) {
      if (!holds) {
        throw new SplitArtifactError(
          malformed,
          `${where} (${row.cell}): ${description}`,
        );
      }
    }
  }

  // The AUTHORITY OUTSIDE the file. Everything above proves the receipt agrees with itself,
  // which a re-sealed forgery does by construction: lower both floors to whatever the cells
  // happen to hold, re-derive an empty breach list, re-seal, and an internally perfect receipt
  // publishes a verdict measured against a bound nobody pre-registered. So the three limits
  // are compared against the frozen pre-registration and NEVER against the receipt's own
  // numbers, and the cell list against the declared quota axis — in ORDER, because the rows
  // are the pre-registered cells and a receipt naming other ones measured other cells.
  const notPreRegistered =
    "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_NOT_PREREGISTERED";
  if (receipt.partition !== COMPOSITION_GATE_PARTITION) {
    throw new SplitArtifactError(
      notPreRegistered,
      `compositionReceipt.partition is "${String(receipt.partition)}", not the blind block ` +
        `"${COMPOSITION_GATE_PARTITION}" the pre-registered bounds are about`,
    );
  }
  const declaredCells = PREREGISTRATION_V4.preRegistration.quotaAxis.cells;
  const sealedCells = receipt.cells.map((row) => row.cell);
  if (
    sealedCells.length !== declaredCells.length ||
    sealedCells.some((cell, index) => cell !== declaredCells[index])
  ) {
    throw new SplitArtifactError(
      notPreRegistered,
      `compositionReceipt names cells [${sealedCells.join(", ")}] and the pre-registered ` +
        `quota axis declares [${declaredCells.join(", ")}]`,
    );
  }
  const bounds = compositionBoundsOf();
  for (const [field, sealed, preRegistered] of [
    ["lineFloor", receipt.lineFloor, bounds.lineFloor],
    ["unitFloor", receipt.unitFloor, bounds.unitFloor],
    [
      "maximumLinesPerOriginDocument",
      receipt.maximumLinesPerOriginDocument,
      bounds.maximumLinesPerOriginDocument,
    ],
  ] as const) {
    if (sealed !== preRegistered) {
      throw new SplitArtifactError(
        notPreRegistered,
        `compositionReceipt.${field} is ${String(sealed)}, not the pre-registered ${preRegistered}`,
      );
    }
  }

  // The breach list RECOMPUTED by the criterion itself — called, never copied, so the three
  // limits have one spelling — and the verdict against the list it publishes. Two distinct
  // refusals: the digest catches a list that was emptied over cells that still miss a bound,
  // the equivalence catches a verdict flipped over breaches that are still there.
  const incoherent = "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_INCOHERENT";
  const recomputed = compositionBreachesOf(receipt.cells, bounds);
  if (
    (await canonicalSha256(receipt.breaches)) !==
    (await canonicalSha256(recomputed))
  ) {
    throw new SplitArtifactError(
      incoherent,
      `compositionReceipt publishes ${receipt.breaches.length} breach(es) where the ` +
        `pre-registered bounds produce ${recomputed.length} over the same cells`,
    );
  }
  if (receipt.passed !== (receipt.breaches.length === 0)) {
    throw new SplitArtifactError(
      incoherent,
      `compositionReceipt.passed is ${String(receipt.passed)} over ${receipt.breaches.length} breach(es)`,
    );
  }
}

/**
 * The audit's OBSERVED per-partition boundaries, published verbatim.
 *
 * They are deliberately not turned back into the four cut timestamps the search
 * chose. That reconstruction is not available from a finished split: `train` is the
 * fallback and holds every component that straddles a cut, so its newest record can be
 * newer than any middle partition's, and calling it "the first cut" would publish a
 * number that is false about the split it describes. The boundaries are a measurement;
 * the cuts are an input the artifact does not need, since `assignments` already pins
 * every record.
 *
 * Non-finite means an empty partition (`latest` of nothing is -Infinity), which a
 * passing audit already excludes — this is the second lock, not the first.
 */
function requireFiniteCutoffs(audit: SplitAudit): SplitAudit["cutoffs"] {
  for (const [boundary, value] of Object.entries(audit.cutoffs)) {
    if (!Number.isFinite(value)) {
      throw new SplitArtifactError(
        "SPLIT_ARTIFACT_CUTOFFS_INVALID",
        `cannot publish a non-finite ${boundary} boundary: the partition is empty`,
      );
    }
  }
  return { ...audit.cutoffs };
}

// The exact projection sealed by splitDigest: every field except splitDigest
// itself. Built explicitly (rather than by destructuring the field away) so the
// hashed key set is identical in build and validate and never drifts.
export function withoutSplitDigest(
  artifact: SplitArtifact,
): Omit<SplitArtifact, "splitDigest"> {
  return {
    schemaVersion: artifact.schemaVersion,
    datasetDigest: artifact.datasetDigest,
    algorithm: artifact.algorithm,
    algorithmDigest: artifact.algorithmDigest,
    seed: artifact.seed,
    policy: artifact.policy,
    compositionAttestation: artifact.compositionAttestation,
    compositionReceipt: artifact.compositionReceipt,
    assignments: artifact.assignments,
    assignmentsDigest: artifact.assignmentsDigest,
    cutoffs: artifact.cutoffs,
    counts: artifact.counts,
    heldOutGeneratorFamilies: artifact.heldOutGeneratorFamilies,
    audit: artifact.audit,
  };
}
