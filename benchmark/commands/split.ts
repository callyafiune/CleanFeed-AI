// `split`: freeze the leakage-safe 20/30/50 temporal split and its audit.
//
// It re-parses the sealed dataset audit, recomputes its digest and confirms it
// belongs to the same manifest/bytes, then runs the blocked group-time splitter
// and the INDEPENDENT leakage audit. A split that leaks or misses the class
// proportions / sampling floors is refused, never relaxed. The frozen
// split-artifact.json binds the dataset digest, the algorithm/policy, the
// assignments and the audit under one self-verifying splitDigest. The blind
// test-input.jsonl (no labels) is written for Phase 3 to score; the private test
// labels are written separately.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { join } from "node:path";

import {
  parseDatasetAudit,
  validateDatasetManifest,
} from "../dataset-manifest.ts";
import {
  GeneratorFamilyError,
  assertGeneratorFamilyAgreement,
} from "../generator-family.ts";
import {
  assertDerivedParentsResolve,
  parseBenchmarkDataset,
  type BenchmarkRecord,
  type V3GroupAxis,
} from "../schema.ts";
import { V3_HUMAN_SOURCE_INVENTORY } from "../source-manifest.ts";
import { buildSplitArtifact } from "../split-artifact.ts";
import { auditBlockedSplit, type SplitAuditPolicy } from "../split-audit.ts";
import {
  createBlockedSplit,
  markedHeldOutGeneratorFamilies,
  type BlockedSplitPolicy,
} from "../split.ts";
import {
  CommandError,
  readJsonFile,
  readTextFile,
  writeFileAtomic,
  writeJsonAtomic,
} from "./io.ts";

export interface SplitOptions {
  datasetDirectory: string;
  datasetAuditPath: string;
  outputDirectory: string;
  seed: number;
}

const SPLIT_AUDIT_POLICY: SplitAuditPolicy = {
  minimumTestHumanNegatives: 2_000,
  minimumCriticalFprNegatives: 300,
  minimumCriticalRecallPositives: 200,
  classTolerance: 0.02,
};

/**
 * The join C3 owes the audit: `provenance.sourceId` -> the axes that source
 * DECLARED applicable. This is the only place both halves exist at once — the
 * declaration is a frozen constant of the inventory, and the filling is a property
 * of each record — so it is the only place the comparison can be made.
 *
 * Built from `V3_HUMAN_SOURCE_INVENTORY` and NOT from `private/source-manifest.json`:
 * the declaration is versioned in the tree, so the check needs no private file and
 * cannot be softened by one. A source the inventory does not name contributes no
 * declaration, and the audit stays silent about it rather than inventing one.
 */
const DECLARED_GROUP_AXES: ReadonlyMap<string, readonly V3GroupAxis[]> =
  new Map(
    V3_HUMAN_SOURCE_INVENTORY.map((entry) => [
      entry.sourceId,
      entry.declaredGroupAxes,
    ]),
  );

export async function runSplit(options: SplitOptions): Promise<string> {
  const { datasetDirectory, datasetAuditPath, outputDirectory, seed } = options;

  const manifest = validateDatasetManifest(
    await readJsonFile(join(datasetDirectory, "manifest.json")),
  );
  const records = parseBenchmarkDataset(
    await readTextFile(join(datasetDirectory, "records.jsonl")),
  );

  // Re-parse the sealed audit (recomputes its own digest) and bind it to the
  // same dataset the split is about to partition.
  const audit = await parseDatasetAudit(await readJsonFile(datasetAuditPath));
  if (audit.datasetId !== manifest.datasetId) {
    throw new CommandError(
      "DATASET_AUDIT_MISMATCH",
      "dataset audit was sealed for a different dataset",
    );
  }
  if (
    audit.recordsSha256 !== manifest.recordsSha256 ||
    audit.reviewLedgerSha256 !== manifest.reviewLedgerSha256 ||
    audit.sourceManifestSha256 !== manifest.sourceManifestSha256
  ) {
    throw new CommandError(
      "DATASET_AUDIT_MISMATCH",
      "dataset audit file digests diverge from the manifest",
    );
  }

  // Lineage is refused BEFORE anything is partitioned. The function existed and had
  // no production caller: only `benchmark/tests/schema-v3.test.ts` reached it, and
  // `benchmark/split.ts` mentioned it in a comment as the place where an unresolved
  // parent "belongs" — which is true and was not wired.
  //
  // Calling it here is what turns the connectivity union from conditional into total,
  // and that is the colocation the plan asks for rather than a second mechanism.
  // `buildClusters` unions a record with its parent only `if (ids.has(parent))`,
  // because a missing parent must neither invent a cluster nor silently refuse a row;
  // C2 measured 782 of 783 parent references resolving to no row of the assembled
  // corpus, so on that corpus the relation unioned almost nothing. With this call in
  // front, a corpus whose parents do not resolve never REACHES the splitter, so every
  // parent the clusterer looks for is present and parent + generations + derivatives
  // always land in one cluster, hence one partition.
  //
  // It also settles, for this path, the question `AxisUnionRelation` left open for
  // E2/E3: whether `humanSeed` should ALSO become a value axis, so two generations
  // grown from the same human prompt stay together even when the seed row was never
  // assembled. On this path it need not, and the reason is this call and not an
  // argument about dependence — both generations resolve to a parent that is present,
  // so both are unioned with it and therefore with each other. The open question
  // survives only for callers that partition records without passing through here.
  assertDerivedParentsResolve(records);

  const policy: BlockedSplitPolicy = {
    fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
    classTolerance: 0.02,
    heldOutGeneratorFamilies: manifest.heldOutGeneratorFamilies,
    seed,
  };

  const split = createBlockedSplit(records, policy);
  const splitAudit = auditBlockedSplit(
    records,
    split,
    SPLIT_AUDIT_POLICY,
    manifest.heldOutGeneratorFamilies,
    DECLARED_GROUP_AXES,
  );
  if (!splitAudit.passed) {
    throw new CommandError(
      "SPLIT_AUDIT_FAILED",
      `split audit failed: ${splitAudit.reasons.join("; ")}`,
    );
  }

  const artifact = await buildSplitArtifact({
    manifest,
    records,
    split,
    policy,
    audit: splitAudit,
  });

  // The exact-equality invariant, at the one place where all four sets exist at
  // once: what the manifest RESERVED, what the splitter actually MARKED, what the
  // independent audit read back as HONORED by the partitions, and what the sealed
  // artifact PUBLISHES (which is the list the report prints, since report.ts reads
  // it from this artifact). Hard failure, not a warning: a family the manifest
  // reserved but the splitter never marked means the "unseen generator" measurement
  // has no population at all, and a reservation the partitions do not honor means
  // the report would publish a reserve the blind block does not hold. Both used to
  // be silent — the spelling mismatch made every one of these comparisons
  // impossible to satisfy.
  //
  // What is NOT compared here: `audit.incidentalTestOnlyGeneratorFamilies`, the
  // families that landed in `test` with nobody reserving them. Comparing those
  // reproved a split for a concentration it was never asked to avoid (A4-fix), so
  // they are published as diagnosis and gate nothing.
  try {
    assertGeneratorFamilyAgreement({
      declared: manifest.heldOutGeneratorFamilies,
      marked: markedHeldOutGeneratorFamilies(records, policy),
      derived: splitAudit.heldOutGeneratorFamilies,
      published: artifact.heldOutGeneratorFamilies,
    });
  } catch (error) {
    throw new CommandError(
      "HELD_OUT_FAMILY_DISAGREEMENT",
      error instanceof GeneratorFamilyError ? error.message : String(error),
    );
  }

  await writeJsonAtomic(join(outputDirectory, "split-artifact.json"), artifact);
  await writeFileAtomic(
    join(outputDirectory, "development.jsonl"),
    toJsonl(split.development),
  );
  await writeFileAtomic(
    join(outputDirectory, "calibration.jsonl"),
    toJsonl(split.calibration),
  );
  await writeFileAtomic(
    join(outputDirectory, "test-input.jsonl"),
    toJsonl(split.test.map(toBlindInput)),
  );
  await writeFileAtomic(
    join(outputDirectory, "private", "test-labels.jsonl"),
    toJsonl(
      split.test.map((record) => ({ id: record.id, label: record.label })),
    ),
  );

  return (
    "Split frozen: development=20%, calibration=30%, test=50%; " +
    `leakage=${splitAudit.leakages.length}.`
  );
}

function toJsonl(rows: readonly unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

// The blind scoring input: identifier and text plus the length/locale metadata
// the scorer needs, with the label and every class-revealing field (generation,
// mixture, annotation) withheld.
function toBlindInput(record: BenchmarkRecord): {
  id: string;
  text: string;
  language: string;
  platform: string;
  domain: string;
  topic: string;
  wordCount: number;
  createdAt: number;
} {
  return {
    id: record.id,
    text: record.text,
    language: record.language,
    platform: record.platform,
    domain: record.domain,
    topic: record.topic,
    wordCount: record.wordCount,
    createdAt: record.createdAt,
  };
}
