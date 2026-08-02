// `validate`: seal the local corpus and emit its governance evidence.
//
// It recomputes recordsSha256/reviewLedgerSha256/sourceManifestSha256 from the
// real file bytes and confirms them against the manifest BEFORE sealing — a
// missing or swapped file ends the command. The two private paths are resolved
// EXCLUSIVELY from the DatasetManifest (no CLI flag can substitute another source
// manifest or ledger). Only then does `sealDataset` run, producing the
// self-digested dataset-audit.json, and `auditCorpusSources` runs over the same
// records and reviewed source manifest to produce source-readiness.json. There is
// no second sealing implementation: `sealDataset` and the split remain the sole
// scientific seal/split contracts.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { join } from "node:path";

import { auditCorpusSources } from "../corpus-source-audit.ts";
import {
  RELEASE_CORPUS_POLICY,
  type CorpusPolicy,
  sealDataset,
  validateDatasetManifest,
  type DatasetFileDigests,
} from "../dataset-manifest.ts";
import { parseBenchmarkDataset } from "../schema.ts";
import { parseReviewedSourceManifest } from "../source-manifest.ts";
import {
  CommandError,
  readJsonFile,
  readTextFile,
  sha256OfFile,
  writeJsonAtomic,
} from "./io.ts";

export interface ValidateOptions {
  datasetDirectory: string;
  outputDirectory: string;
  /**
   * Composition policy for an `infrastructure-only` corpus. PROGRAMMATIC ONLY — there is
   * deliberately no CLI flag, because a flag would let an operator seal a release corpus
   * against a composition nobody froze. `runValidate` refuses it for a release corpus.
   */
  corpusPolicy?: CorpusPolicy;
}

export async function runValidate(options: ValidateOptions): Promise<string> {
  const { datasetDirectory, outputDirectory } = options;

  const manifestPath = join(datasetDirectory, "manifest.json");
  const recordsPath = join(datasetDirectory, "records.jsonl");

  const manifest = validateDatasetManifest(await readJsonFile(manifestPath));
  const records = parseBenchmarkDataset(await readTextFile(recordsPath));

  // Resolve the two private paths exclusively from the manifest — the command
  // exposes no flag that could point sealing at a different ledger or source
  // manifest than the one the manifest binds.
  const reviewLedgerPath = join(datasetDirectory, manifest.reviewLedgerFile);
  const sourceManifestPath = join(
    datasetDirectory,
    manifest.sourceManifestFile,
  );

  // Recompute the three file digests from the real bytes and confirm them
  // against the manifest before sealing.
  const observed: DatasetFileDigests = {
    recordsSha256: await sha256OfFile(recordsPath),
    reviewLedgerSha256: await sha256OfFile(reviewLedgerPath),
    sourceManifestSha256: await sha256OfFile(sourceManifestPath),
  };
  if (observed.recordsSha256 !== manifest.recordsSha256) {
    throw new CommandError(
      "RECORDS_DIGEST_MISMATCH",
      "observed records.jsonl digest does not match the manifest",
    );
  }
  if (observed.reviewLedgerSha256 !== manifest.reviewLedgerSha256) {
    throw new CommandError(
      "REVIEW_LEDGER_DIGEST_MISMATCH",
      "observed review-ledger.jsonl digest does not match the manifest",
    );
  }
  if (observed.sourceManifestSha256 !== manifest.sourceManifestSha256) {
    throw new CommandError(
      "SOURCE_MANIFEST_DIGEST_MISMATCH",
      "observed source-manifest.json digest does not match the manifest",
    );
  }

  // A release corpus is sealed against the frozen release composition, always. An
  // `infrastructure-only` corpus may declare its own, because its composition proves
  // nothing about a release and pinning it to 4000/4000/2000 made the whole pipeline
  // unexercisable end to end — no corpus of that size can satisfy the power floors.
  //
  // The narrowness is the safety: the override is refused for a release corpus, it is
  // not reachable from the CLI, and it is never derived from the records in front of it.
  // Any of those three would turn a test convenience into a way to loosen a release.
  if (
    options.corpusPolicy !== undefined &&
    manifest.scientificUse === "release"
  ) {
    throw new CommandError(
      "CORPUS_POLICY_OVERRIDE_FORBIDDEN",
      "a release corpus is sealed against the frozen release composition; an explicit corpus policy is accepted only for scientificUse: infrastructure-only",
    );
  }
  const audit = await sealDataset(
    manifest,
    records,
    options.corpusPolicy ?? RELEASE_CORPUS_POLICY,
    observed,
  );

  await writeJsonAtomic(join(outputDirectory, "dataset-audit.json"), audit);

  // Governance readiness is the authoritative Phase 2 audit over the same
  // records and reviewed source manifest, not a hand-rolled summary.
  const sourceManifest = await parseReviewedSourceManifest(
    await readJsonFile(sourceManifestPath),
  );
  const readiness = await auditCorpusSources({ records, sourceManifest });
  await writeJsonAtomic(
    join(outputDirectory, "source-readiness.json"),
    readiness,
  );

  return (
    `Dataset sealed: ${audit.recordCount} records ` +
    `(human=${audit.counts.human}, ai=${audit.counts.ai}, mixed=${audit.counts.mixed}).`
  );
}
