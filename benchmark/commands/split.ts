// `split`: freeze the leakage-safe 45/5/10/20/20 temporal split and its audit.
//
// It re-parses the sealed dataset audit, recomputes its digest and confirms it
// belongs to the same manifest/bytes, then runs the blocked group-time splitter
// and the INDEPENDENT leakage audit. A split that leaks or misses the class
// proportions is refused, never relaxed, and a `release` corpus is refused as well
// when the blind block falls outside any pre-registered composition bound per quota
// cell (benchmark/composition-gate.ts). The precise scope of "nothing
// is written": a constraint failure writes no OUTPUT — inputs are opened first, so the
// claim is about outputs and not about all file access. A failure during publication can
// leave partition files without the artifact that certifies them, never the reverse,
// because the artifact is renamed into place last. The frozen split-artifact.json binds
// the dataset digest, the algorithm/policy, the assignments and the audit under one
// self-verifying splitDigest. The blind test-input.jsonl carries NO labels, so it can be
// scored without revealing them; the test labels and the whole of cal-B are written under
// private/, which is what keeps both off the readable path.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { join } from "node:path";

import {
  COMPOSITION_BOUNDS_NOT_MET,
  COMPOSITION_RECEIPT_ABSENT,
  describeCompositionBreaches,
} from "../composition-gate.ts";
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
} from "../schema.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import { buildSplitArtifact } from "../split-artifact.ts";
import {
  DECLARED_GROUP_AXES,
  FROZEN_SPLIT_AUDIT_POLICY,
  auditBlockedSplit,
} from "../split-audit.ts";
import {
  PARTITIONS,
  createBlockedSplit,
  markedHeldOutGeneratorFamilies,
  type BlockedSplitPolicy,
} from "../split.ts";
import {
  CommandError,
  readJsonFile,
  readTextFile,
  writeFileSetAtomic,
} from "./io.ts";

export interface SplitOptions {
  datasetDirectory: string;
  datasetAuditPath: string;
  outputDirectory: string;
  seed: number;
}

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

  // Lineage is refused BEFORE anything is partitioned, which is what turns the
  // connectivity union from conditional into total,
  // and that is the colocation the plan asks for rather than a second mechanism.
  // `buildClusters` unions a record with its parent only `if (ids.has(parent))`,
  // because a missing parent must neither invent a cluster nor silently refuse a row;
  // 782 of 783 parent references in the assembled corpus resolve to no row of the
  // corpus, so on that corpus the relation unioned almost nothing. With this call in
  // front, a corpus whose parents do not resolve never REACHES the splitter, so every
  // parent the clusterer looks for is present and parent + generations + derivatives
  // always land in one cluster, hence one partition.
  //
  // It also settles, for this path, whether `humanSeed` would need to be a value axis
  // as well — so two generations grown from the same human prompt stay together even
  // when the seed row itself was never assembled. On this path it need not, and the
  // reason is this call rather than an
  // argument about dependence — both generations resolve to a parent that is present,
  // so both are unioned with it and therefore with each other. The open question
  // survives only for callers that partition records without passing through here.

  assertDerivedParentsResolve(records);

  // The split seed is PRE-REGISTERED, so it is not a caller's choice: a flag that accepts any
  // number lets an arbitrary value into an artifact whose whole point is that its parameters
  // were fixed in advance. The value also collides in the neighbourhood — `publishableCheckpoint`
  // is a different seed for a different purpose — so the authority is named rather than copied.
  if (seed !== PREREGISTRATION_V4.seeds.split) {
    throw new CommandError(
      "SPLIT_SEED_NOT_PRE_REGISTERED",
      `--seed ${seed} is not the pre-registered split seed ` +
        `${PREREGISTRATION_V4.seeds.split}`,
    );
  }

  const policy: BlockedSplitPolicy = {
    fractions: {
      train: 0.45,
      dev: 0.05,
      "cal-A": 0.1,
      "cal-B": 0.2,
      test: 0.2,
    },
    classTolerance: 0.02,
    heldOutGeneratorFamilies: manifest.heldOutGeneratorFamilies,
    seed,
  };

  const split = createBlockedSplit(records, policy);
  const splitAudit = auditBlockedSplit(
    records,
    split,
    FROZEN_SPLIT_AUDIT_POLICY,
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

  // A release seal needs the blind block to carry the power the pre-registration
  // promised, per quota cell, in all three quantities: the FPR denominator in
  // record-lines, the independent sampling units behind it, and the cap of one line per
  // origin document that makes the first two the same draws. The artifact RECORDS that
  // verdict (`compositionReceipt`), and recording is not judging — so the refusal is
  // here, reading the SEALED receipt, which makes what refuses the freeze and what a
  // downstream reader can recompute the same numbers.
  //
  // After the leakage audit and before any output: a corpus that leaks has a worse
  // problem than a short cell, and the composition verdict would only bury it; a corpus
  // outside any bound leaves no partition file behind.
  if (manifest.scientificUse === "release") {
    const receipt = artifact.compositionReceipt;
    if (receipt === null) {
      throw new CommandError(
        COMPOSITION_RECEIPT_ABSENT,
        "a release corpus cannot be frozen without the composition receipt: the three " +
          "quantities per quota cell were never counted, so no bound was compared",
      );
    }
    if (!receipt.passed) {
      throw new CommandError(
        COMPOSITION_BOUNDS_NOT_MET,
        "a release corpus cannot be frozen outside the pre-registered composition " +
          `bounds: ${describeCompositionBreaches(receipt)}`,
      );
    }
  }

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

  // One set, published so `split-artifact.json` lands LAST. Six independent atomic
  // writes would let a failure on the fourth leave a directory that already carried the
  // artifact certifying all six — which reads as a frozen split that does not exist.
  // With the artifact last, its presence means the five partition files are in place.
  await writeFileSetAtomic([
    {
      path: join(outputDirectory, "train.jsonl"),
      content: toJsonl(split.train),
    },
    { path: join(outputDirectory, "dev.jsonl"), content: toJsonl(split.dev) },
    {
      path: join(outputDirectory, "cal-A.jsonl"),
      content: toJsonl(split["cal-A"]),
    },
    // `cal-B` goes under `private/` with the test labels, and the directory IS the
    // enforcement: everything below it is already off-limits to read until the v2
    // measurement, so the "byte-untouched" invariant stops depending on anyone
    // remembering which of the five files it applies to.
    {
      path: join(outputDirectory, "private", "cal-B.jsonl"),
      content: toJsonl(split["cal-B"]),
    },
    {
      path: join(outputDirectory, "test-input.jsonl"),
      content: toJsonl(split.test.map(toBlindInput)),
    },
    {
      path: join(outputDirectory, "private", "test-labels.jsonl"),
      content: toJsonl(
        split.test.map((record) => ({ id: record.id, label: record.label })),
      ),
    },
    {
      path: join(outputDirectory, "split-artifact.json"),
      content: `${JSON.stringify(artifact, null, 2)}
`,
    },
  ]);

  return `Split frozen: ${describeSplitProportions(policy)}; leakage=${splitAudit.leakages.length}.`;
}

/**
 * The proportions line of the success message, derived from the policy rather than
 * restated so a frozen number has one spelling.
 */
export function describeSplitProportions(policy: BlockedSplitPolicy): string {
  return PARTITIONS.map(
    (partition) => `${partition}=${policy.fractions[partition] * 100}%`,
  ).join(", ");
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
