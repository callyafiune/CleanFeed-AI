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
import { parseBenchmarkDataset, type BenchmarkRecord } from "../schema.ts";
import { buildSplitArtifact } from "../split-artifact.ts";
import { auditBlockedSplit, type SplitAuditPolicy } from "../split-audit.ts";
import { createBlockedSplit, type BlockedSplitPolicy } from "../split.ts";
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

  const policy: BlockedSplitPolicy = {
    fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
    classTolerance: 0.02,
    heldOutGeneratorFamilies: manifest.heldOutGeneratorFamilies,
    seed,
  };

  const split = createBlockedSplit(records, policy);
  const splitAudit = auditBlockedSplit(records, split, SPLIT_AUDIT_POLICY);
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
