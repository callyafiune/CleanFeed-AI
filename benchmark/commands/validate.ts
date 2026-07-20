// `validate`: seal the local corpus and emit its governance evidence.
//
// It recomputes recordsSha256/reviewLedgerSha256/sourceManifestSha256 from the
// real file bytes and confirms them against the manifest BEFORE sealing — a
// missing or swapped file ends the command. Only then does `sealDataset` run,
// producing the self-digested dataset-audit.json. A deterministic source
// readiness report is derived from the reviewed source manifest so the seven
// command flow has its governance input; a release corpus reviewed by Phase 3
// replaces it with the authoritative decision.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { join } from "node:path";

import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import {
  computeSourceReadinessDigest,
  type CorpusSourceReadinessReport,
  type SourceReadinessDigestInput,
} from "../../contracts/source-readiness.ts";
import {
  RELEASE_CORPUS_POLICY,
  sealDataset,
  validateDatasetManifest,
  type DatasetFileDigests,
} from "../dataset-manifest.ts";
import { parseBenchmarkDataset, type BenchmarkRecord } from "../schema.ts";
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
}

export async function runValidate(options: ValidateOptions): Promise<string> {
  const { datasetDirectory, outputDirectory } = options;

  const manifestPath = join(datasetDirectory, "manifest.json");
  const recordsPath = join(datasetDirectory, "records.jsonl");
  const reviewLedgerPath = join(
    datasetDirectory,
    "private",
    "review-ledger.jsonl",
  );
  const sourceManifestPath = join(
    datasetDirectory,
    "private",
    "source-manifest.json",
  );

  const manifest = validateDatasetManifest(await readJsonFile(manifestPath));
  const records = parseBenchmarkDataset(await readTextFile(recordsPath));

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

  const audit = await sealDataset(
    manifest,
    records,
    RELEASE_CORPUS_POLICY,
    observed,
  );

  await writeJsonAtomic(join(outputDirectory, "dataset-audit.json"), audit);

  const readiness = await deriveSourceReadiness(records, sourceManifestPath);
  await writeJsonAtomic(
    join(outputDirectory, "source-readiness.json"),
    readiness,
  );

  return (
    `Dataset sealed: ${audit.recordCount} records ` +
    `(human=${audit.counts.human}, ai=${audit.counts.ai}, mixed=${audit.counts.mixed}).`
  );
}

// Deterministic readiness derived from the reviewed source manifest and the
// provenance already validated in each record. The source manifest's own
// self-digest (its declared `sourceManifestDigest`, else the canonical digest of
// its remaining body) bridges the report to the sealed bytes.
async function deriveSourceReadiness(
  records: readonly BenchmarkRecord[],
  sourceManifestPath: string,
): Promise<CorpusSourceReadinessReport> {
  const sourceManifest = await readJsonFile(sourceManifestPath);
  if (
    typeof sourceManifest !== "object" ||
    sourceManifest === null ||
    Array.isArray(sourceManifest)
  ) {
    throw new CommandError(
      "SOURCE_MANIFEST_INVALID",
      "source manifest must be a JSON object",
    );
  }
  const sourceObject = sourceManifest as Record<string, unknown>;
  const declared = sourceObject.sourceManifestDigest;
  let sourceManifestDigest: string;
  if (typeof declared === "string") {
    sourceManifestDigest = declared;
  } else {
    const stripped: Record<string, unknown> = {};
    for (const key of Object.keys(sourceObject)) {
      if (key !== "sourceManifestDigest") stripped[key] = sourceObject[key];
    }
    sourceManifestDigest = await canonicalSha256(stripped);
  }

  const acquisitionCounts = { consent: 0, licensed: 0, generated: 0 };
  const sources = new Set<string>();
  for (const record of records) {
    sources.add(record.provenance.sourceId);
    if (record.provenance.legalBasis === "consent")
      acquisitionCounts.consent += 1;
    else if (record.provenance.legalBasis === "license")
      acquisitionCounts.licensed += 1;
    else acquisitionCounts.generated += 1;
  }

  const base: SourceReadinessDigestInput = {
    schemaVersion: 1,
    status: "ready",
    sourceManifestDigest,
    recordCount: records.length,
    sourceCount: sources.size,
    acquisitionCounts,
    protocols: {
      corpus: "corpus-v1",
      collection: "collection-v1",
      annotation: "annotation-v1",
      generation: "generation-v1",
      pii: "pii-review-v1",
    },
    blockingReasons: [],
  };
  return { ...base, reportDigest: await computeSourceReadinessDigest(base) };
}
