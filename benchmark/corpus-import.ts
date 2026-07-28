// Local-only, atomic ingestion of authorized records into the canonical Phase 2
// dataset directory. This module NEVER collects, scrapes or generates data: it
// consumes materials that an authorized workflow already produced (records with
// opaque ids issued upstream, an independent review ledger, a reviewed source
// manifest and a closed dataset-manifest template) and materializes the exact
// directory the Phase 2 `validate`/`split` commands seal and partition.
//
// It is fail-closed and privacy preserving:
//   - text is normalized to NFC + LF and EVERY content digest is recomputed from
//     the normalized bytes; a caller-supplied hash that disagrees is refused,
//     never trusted;
//   - ids are opaque tokens issued by the collection workflow and are used
//     verbatim — an id is NEVER derived from the text;
//   - exact and cross-lineage near duplicates, duplicate ids/hashes, unknown
//     fields, malformed ids and records whose source is absent from the reviewed
//     manifest are rejected with only a line number and a code — never a text
//     excerpt, url, author or prompt;
//   - filenames and all three SHA-256 values on the dataset manifest are
//     generated here, never accepted from the caller, so a declared-but-wrong
//     hash cannot slip through;
//   - the four canonical files are written atomically (temp file, fsync,
//     rename) only when zero records are rejected.
//
// It reuses the closed Phase 2 contracts (record schema, dataset manifest,
// reviewed source manifest, near-duplicate clustering) rather than redefining
// them, and it introduces NO second sealing implementation: `sealDataset` and
// the split remain the only scientific seal/split contracts.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { join } from "node:path";

import {
  validateDatasetManifest,
  type DatasetManifest,
} from "./dataset-manifest.ts";
import { computeDatasetDigest } from "./digests.ts";
import {
  NEAR_DUPLICATE_V1_OPTIONS,
  clusterNearDuplicates,
} from "./near-duplicates.ts";
import {
  groupAxisIdentity,
  validateBenchmarkRecord,
  type BenchmarkRecord,
} from "./schema.ts";
import {
  parseReviewedSourceManifest,
  type ReviewedSourceManifestV1,
} from "./source-manifest.ts";
import {
  readJsonFile,
  readTextFile,
  sha256OfText,
  writeFileAtomic,
} from "./commands/io.ts";

export interface IngestRequest {
  inputRecordsPath: string;
  inputReviewLedgerPath: string;
  inputSourceManifestPath: string;
  inputDatasetManifestTemplatePath: string;
  datasetDirectory: string;
  expectedDatasetId: "ptbr-generic-v1";
}

export interface IngestRejection {
  inputLine: number;
  code: string;
}

export interface IngestResult {
  accepted: number;
  rejected: IngestRejection[];
  outputDigest?: string;
}

/** Fatal, whole-request failure (bad template, source manifest or ledger). */
export class CorpusImportError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "CorpusImportError";
    this.code = code;
  }
}

// Opaque, pseudonymised id: identical to the record schema's rule, restated so
// the importer can refuse a malformed id BEFORE the closed schema runs and with
// its own dedicated code.
const OPAQUE_ID = /^[A-Za-z0-9_-]+$/u;

// The dataset-manifest fields the importer generates and therefore forbids in
// the closed template: filenames and all three raw SHA-256 digests.
const DERIVED_MANIFEST_KEYS = [
  "recordsFile",
  "recordsSha256",
  "reviewLedgerFile",
  "reviewLedgerSha256",
  "sourceManifestFile",
  "sourceManifestSha256",
] as const;

const RECORDS_FILE = "records.jsonl";
const REVIEW_LEDGER_FILE = "private/review-ledger.jsonl";
const SOURCE_MANIFEST_FILE = "private/source-manifest.json";
const DATASET_MANIFEST_FILE = "manifest.json";

/** NFC + LF normalization applied to every record text before hashing/storing. */
export function normalizeCorpusText(text: string): string {
  return text.replace(/\r\n/gu, "\n").replace(/\r/gu, "\n").normalize("NFC");
}

/** SHA-256 (lowercase hex) of the NFC/LF-normalized text bytes. */
export function corpusContentDigest(text: string): string {
  return sha256OfText(normalizeCorpusText(text));
}

interface Accepted {
  record: BenchmarkRecord;
  inputLine: number;
}

/**
 * Ingests authorized records into the canonical dataset directory. Returns the
 * accepted count, every rejection (line + code, never text), and — only on a
 * fully clean ingest — the stable dataset digest of what was written. Nothing is
 * written when any record is rejected: validation completes before any target is
 * replaced.
 */
export async function ingestAuthorizedRecords(
  request: IngestRequest,
): Promise<IngestResult> {
  // 1. Closed dataset-manifest template — parsed and constrained before records.
  const template = await loadTemplate(
    request.inputDatasetManifestTemplatePath,
    request.expectedDatasetId,
  );

  // 2. Reviewed source manifest — the immutable authorized-source inventory.
  const sourceManifest = await loadSourceManifest(
    request.inputSourceManifestPath,
  );
  const knownSourceIds = new Set(
    sourceManifest.sources.map((source) => source.sourceId),
  );

  // 3. Independent review ledger — parsed (every line valid JSON) and kept as
  // LF-normalized bytes for the digest.
  const reviewLedger = await loadReviewLedger(request.inputReviewLedgerPath);

  // 4. Records — validated line by line.
  const recordsText = await readTextFile(request.inputRecordsPath);
  const rejected: IngestRejection[] = [];
  const accepted: Accepted[] = [];
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();

  const lines = recordsText.split(/\r?\n/u);
  for (let index = 0; index < lines.length; index += 1) {
    const inputLine = index + 1;
    const trimmed = lines[index].trim();
    if (trimmed === "") continue;

    let raw: unknown;
    try {
      raw = JSON.parse(trimmed);
    } catch {
      rejected.push({ inputLine, code: "INVALID_JSON" });
      continue;
    }

    const outcome = evaluateRecord(raw, knownSourceIds, seenIds, seenHashes);
    if (typeof outcome === "string") {
      rejected.push({ inputLine, code: outcome });
      continue;
    }
    seenIds.add(outcome.id);
    seenHashes.add(outcome.normalizedTextSha256);
    accepted.push({ record: outcome, inputLine });
  }

  // 5. Cross-lineage near-duplicate refusal over the accepted set. A cluster
  // whose members declare more than one derivation lineage is an undeclared
  // near duplicate and every member of it is refused.
  refuseCrossLineageNearDuplicates(accepted, rejected);

  rejected.sort((a, b) => a.inputLine - b.inputLine);

  // 6. Fail closed: never replace a target when anything was rejected.
  if (rejected.length > 0) {
    return { accepted: accepted.length, rejected };
  }

  const outputDigest = await writeDataset(
    request.datasetDirectory,
    template,
    accepted.map((entry) => entry.record),
    reviewLedger,
    sourceManifest,
  );

  return { accepted: accepted.length, rejected: [], outputDigest };
}

// Validates one already-parsed record. Returns the closed, normalized record on
// success or a rejection code string on failure. Duplicate detection uses the
// caller's running seen sets but never mutates them (the caller records the
// accepted id/hash so a rejected record cannot poison the set).
function evaluateRecord(
  raw: unknown,
  knownSourceIds: ReadonlySet<string>,
  seenIds: ReadonlySet<string>,
  seenHashes: ReadonlySet<string>,
): BenchmarkRecord | string {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return "RECORD_SCHEMA_INVALID";
  }
  const object = raw as Record<string, unknown>;

  // Opaque id issued upstream — used verbatim, never derived from text.
  const id = object.id;
  if (typeof id !== "string" || !OPAQUE_ID.test(id)) {
    return "MALFORMED_ID";
  }

  // Recompute the content digest from the normalized text and refuse any
  // conflicting caller-supplied hash rather than trusting it.
  const candidate: Record<string, unknown> = { ...object };
  const text = object.text;
  if (typeof text === "string") {
    const normalized = normalizeCorpusText(text);
    const digest = sha256OfText(normalized);
    const declared = object.normalizedTextSha256;
    if (typeof declared === "string" && declared !== digest) {
      return "CONTENT_HASH_CONFLICT";
    }
    candidate.text = normalized;
    candidate.normalizedTextSha256 = digest;
  }

  let record: BenchmarkRecord;
  try {
    record = validateBenchmarkRecord(candidate);
  } catch {
    return "RECORD_SCHEMA_INVALID";
  }

  if (seenIds.has(record.id)) return "DUPLICATE_ID";
  if (seenHashes.has(record.normalizedTextSha256)) return "DUPLICATE_HASH";
  if (!knownSourceIds.has(record.provenance.sourceId)) {
    return "SOURCE_ENTRY_ABSENT";
  }
  return record;
}

function refuseCrossLineageNearDuplicates(
  accepted: Accepted[],
  rejected: IngestRejection[],
): void {
  if (accepted.length < 2) return;

  const clusters = clusterNearDuplicates(
    accepted.map((entry) => ({
      id: entry.record.id,
      text: entry.record.text,
    })),
    NEAR_DUPLICATE_V1_OPTIONS,
  );

  const lineagesByCluster = new Map<string, Set<string>>();
  for (const entry of accepted) {
    const clusterId = clusters.clusterById.get(entry.record.id);
    if (clusterId === undefined) continue;
    const lineages = lineagesByCluster.get(clusterId) ?? new Set<string>();
    // A v3 record whose derivationRoot is notApplicable is an ORIGINAL, and an
    // original contributes no lineage to the cluster rather than a placeholder one.
    const lineage = groupAxisIdentity(entry.record, "derivationRoot");
    if (lineage !== undefined) lineages.add(lineage);
    lineagesByCluster.set(clusterId, lineages);
  }

  const crossLineageClusters = new Set<string>();
  for (const [clusterId, lineages] of lineagesByCluster) {
    if (lineages.size > 1) crossLineageClusters.add(clusterId);
  }
  if (crossLineageClusters.size === 0) return;

  for (let i = accepted.length - 1; i >= 0; i -= 1) {
    const entry = accepted[i];
    const clusterId = clusters.clusterById.get(entry.record.id);
    if (clusterId !== undefined && crossLineageClusters.has(clusterId)) {
      rejected.push({
        inputLine: entry.inputLine,
        code: "CROSS_LINEAGE_NEAR_DUPLICATE",
      });
      accepted.splice(i, 1);
    }
  }
}

async function loadTemplate(
  path: string,
  expectedDatasetId: "ptbr-generic-v1",
): Promise<Omit<DatasetManifest, (typeof DERIVED_MANIFEST_KEYS)[number]>> {
  const value = await readJsonFile(path);
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new CorpusImportError(
      "TEMPLATE_INVALID",
      "dataset-manifest template must be a JSON object",
    );
  }
  const object = value as Record<string, unknown>;
  for (const key of DERIVED_MANIFEST_KEYS) {
    if (Object.hasOwn(object, key)) {
      throw new CorpusImportError(
        "TEMPLATE_HAS_DERIVED_FIELD",
        `dataset-manifest template must not carry the generated field "${key}"`,
      );
    }
  }
  if (object.datasetId !== expectedDatasetId) {
    throw new CorpusImportError(
      "DATASET_ID_MISMATCH",
      `template datasetId must equal "${expectedDatasetId}"`,
    );
  }
  return object as unknown as Omit<
    DatasetManifest,
    (typeof DERIVED_MANIFEST_KEYS)[number]
  >;
}

async function loadSourceManifest(
  path: string,
): Promise<ReviewedSourceManifestV1> {
  try {
    return await parseReviewedSourceManifest(await readJsonFile(path));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new CorpusImportError("SOURCE_MANIFEST_INVALID", message);
  }
}

// Reads the independent review ledger, requires every non-empty line to be valid
// JSON, and returns the LF-normalized bytes (trailing newline) that will be
// hashed and stored. The ledger content is treated as opaque governance data:
// the importer proves it parses but never inspects field values.
async function loadReviewLedger(path: string): Promise<string> {
  const text = await readTextFile(path);
  const kept: string[] = [];
  for (const line of text.split(/\r?\n/u)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    try {
      JSON.parse(trimmed);
    } catch {
      throw new CorpusImportError(
        "REVIEW_LEDGER_INVALID",
        "review ledger line is not valid JSON",
      );
    }
    kept.push(normalizeCorpusText(trimmed));
  }
  if (kept.length === 0) {
    throw new CorpusImportError(
      "REVIEW_LEDGER_EMPTY",
      "review ledger contains no entries",
    );
  }
  return `${kept.join("\n")}\n`;
}

async function writeDataset(
  datasetDirectory: string,
  template: Omit<DatasetManifest, (typeof DERIVED_MANIFEST_KEYS)[number]>,
  records: readonly BenchmarkRecord[],
  reviewLedger: string,
  sourceManifest: ReviewedSourceManifestV1,
): Promise<string> {
  const recordsJsonl = `${records
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;
  const sourceManifestJson = `${JSON.stringify(sourceManifest, null, 2)}\n`;

  const manifest = validateDatasetManifest({
    ...template,
    recordsFile: RECORDS_FILE,
    recordsSha256: sha256OfText(recordsJsonl),
    reviewLedgerFile: REVIEW_LEDGER_FILE,
    reviewLedgerSha256: sha256OfText(reviewLedger),
    sourceManifestFile: SOURCE_MANIFEST_FILE,
    sourceManifestSha256: sha256OfText(sourceManifestJson),
  });
  const manifestJson = `${JSON.stringify(manifest, null, 2)}\n`;

  // Every byte is assembled and validated above; only now are targets replaced.
  await writeFileAtomic(join(datasetDirectory, RECORDS_FILE), recordsJsonl);
  await writeFileAtomic(
    join(datasetDirectory, REVIEW_LEDGER_FILE),
    reviewLedger,
  );
  await writeFileAtomic(
    join(datasetDirectory, SOURCE_MANIFEST_FILE),
    sourceManifestJson,
  );
  await writeFileAtomic(
    join(datasetDirectory, DATASET_MANIFEST_FILE),
    manifestJson,
  );

  return computeDatasetDigest(manifest, records);
}
