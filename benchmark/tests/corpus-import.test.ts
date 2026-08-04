import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CorpusImportError,
  corpusContentDigest,
  ingestAuthorizedRecords,
  normalizeCorpusText,
  type IngestRequest,
} from "../corpus-import.ts";
import {
  RELEASE_CORPUS_POLICY,
  validateDatasetManifest,
  type DatasetManifest,
  computeDatasetAuditDigest,
  type DatasetAudit,
} from "../dataset-manifest.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import { parseBenchmarkDataset, type BenchmarkRecordV2 } from "../schema.ts";
import {
  computeReviewedSourceManifestDigest,
  type GenerationBatchV1,
  type ReviewedSourceEntryV1,
  type ReviewedSourceManifestV1,
} from "../source-manifest.ts";
import { runValidate } from "../commands/validate.ts";
import { runIngest } from "../commands/ingest.ts";
import { runSplit } from "../commands/split.ts";
import { connectedComponentRoots } from "../split.ts";
import { validateSplitArtifact } from "../split-artifact.ts";
import { normalizeGeneratorFamily } from "../generator-family.ts";

// ---------------------------------------------------------------------------
// Shared fixtures.
// ---------------------------------------------------------------------------

// The human-content source of every fixture below. It used to be a
// `linkedin-contribution` / `acquisition: "consent"` entry; B3 (2026-07-26)
// refuses per-document consent as an acquisition route, and the refusal now runs
// inside `parseReviewedSourceManifest`, so a consent entry cannot be sealed into
// a manifest at all and the fixture would have been testing an impossible input.
// Nothing else about these tests depends on the route: the importer's only
// manifest cross-check is `provenance.sourceId` against the manifest's id set
// (corpus-import.ts, `SOURCE_ENTRY_ABSENT`), and there is no
// `sourceKind`/`legalBasis` pairing rule anywhere, so the records that reference
// it move to `licensed-corpus`/`license` without any schema change.
const LICENSED_HUMAN_SOURCE: ReviewedSourceEntryV1 = {
  sourceId: "src_licensed_human",
  sourceType: "licensed-corpus",
  acquisition: "licensed",
  evaluationUseApproved: true,
  licenseId: "licensed-v1",
  consentReceiptDigest: null,
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_b"],
};

const GEN_SOURCE: ReviewedSourceEntryV1 = {
  sourceId: "src_gen",
  sourceType: "controlled-generation",
  acquisition: "generated",
  evaluationUseApproved: true,
  licenseId: "lic_gen",
  consentReceiptDigest: null,
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_c"],
};

const PROMPT_DIGEST = "1".repeat(64);

interface TemplateLike {
  schemaVersion: 1;
  datasetId: string;
  version: string;
  scientificUse: "release" | "infrastructure-only";
  intendedLanguage: "pt-BR";
  intendedDomain: "scoped-cells";
  createdAt: string;
  normalizationVersion: string;
  annotationProtocolVersion: "annotation-v1";
  heldOutGeneratorFamilies: [string, ...string[]];
  licenses: DatasetManifest["licenses"];
}

function template(overrides: Partial<TemplateLike> = {}): TemplateLike {
  return {
    schemaVersion: 1,
    datasetId: "cleanfeed-ptbr-cells-v1",
    version: "1.0.0",
    scientificUse: "infrastructure-only",
    intendedLanguage: "pt-BR",
    intendedDomain: "scoped-cells",
    createdAt: "2026-07-19T00:00:00.000Z",
    normalizationVersion: "cleanfeed-text-v1",
    annotationProtocolVersion: "annotation-v1",
    heldOutGeneratorFamilies: ["heldout_family"],
    licenses: [
      {
        id: "licensed-v1",
        name: "Licensed pt-BR corpus",
        source: "fixture://licensed",
        evaluationUseApproved: true,
        redistribution: "not-published",
        notice: "Used under a compatible public licence; raw text stays local.",
      },
      {
        id: "generated-v1",
        name: "Controlled generation",
        source: "fixture://generated",
        evaluationUseApproved: true,
        redistribution: "not-published",
        notice: "Synthetic material generated for internal evaluation.",
      },
    ],
    ...overrides,
  };
}

async function sealedManifest(
  sources: ReviewedSourceEntryV1[],
  batches: GenerationBatchV1[] = [],
): Promise<ReviewedSourceManifestV1> {
  const body = {
    schemaVersion: 1 as const,
    sources,
    generationBatches: batches,
  };
  return {
    ...body,
    sourceManifestDigest: await computeReviewedSourceManifestDigest(body),
  };
}

// A minimal, schema-valid human record. The content digest is recomputed from
// the NFC/LF-normalized text so the importer never rejects a well-formed input.
function humanRecord(
  id: string,
  overrides: Partial<BenchmarkRecordV2> = {},
): BenchmarkRecordV2 {
  const text = overrides.text ?? `texto unico do registro ${id} alfa beta gama`;
  const record: BenchmarkRecordV2 = {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256: corpusContentDigest(text),
    label: "human",
    language: "pt-BR",
    platform: "generic",
    domain: "corporate",
    topic: "career",
    humanSourceType: "qa-informal",
    wordCount: 8,
    createdAt: 1000,
    provenance: {
      sourceKind: "licensed-corpus",
      sourceId: "src_licensed_human",
      sourceRevision: "rev_001",
      collectedAt: 1000,
      licenseId: "licensed-v1",
      legalBasis: "license",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "reviewer_pii",
        reviewedAt: 1000,
      },
    },
    annotation: {
      protocolVersion: "annotation-v1",
      reviewerIds: ["reviewer_a", "reviewer_b"],
      agreement: "agree",
    },
    transformation: { kind: "none", severity: "none" },
    groups: {
      author: `author_${id}`,
      source: `source_${id}`,
      domainSource: `ds_${id}`,
      collectionBatch: `hb_${id}`,
      nearDuplicate: `nd_${id}`,
      derivationRoot: id,
    },
    ...overrides,
  };
  // Keep the digest consistent when a caller overrides only the text.
  if (
    overrides.text !== undefined &&
    overrides.normalizedTextSha256 === undefined
  ) {
    record.normalizedTextSha256 = corpusContentDigest(overrides.text);
  }
  return record;
}

function ledgerLine(record: BenchmarkRecordV2): string {
  return JSON.stringify({
    recordId: record.id,
    reviewerIds: record.annotation.reviewerIds,
    agreement: record.annotation.agreement,
  });
}

interface Incoming {
  recordLines: string[];
  ledgerLines: string[];
  sourceManifest: ReviewedSourceManifestV1;
  template: unknown;
}

async function buildRequest(
  root: string,
  incoming: Incoming,
): Promise<{ request: IngestRequest; datasetDirectory: string }> {
  const inDir = join(root, "incoming");
  await mkdir(inDir, { recursive: true });
  await writeFile(
    join(inDir, "records.jsonl"),
    `${incoming.recordLines.join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    join(inDir, "review-ledger.jsonl"),
    `${incoming.ledgerLines.join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    join(inDir, "sources.json"),
    `${JSON.stringify(incoming.sourceManifest, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(inDir, "template.json"),
    `${JSON.stringify(incoming.template, null, 2)}\n`,
    "utf8",
  );
  const datasetDirectory = join(root, "cleanfeed-ptbr-cells-v1");
  return {
    datasetDirectory,
    request: {
      inputRecordsPath: join(inDir, "records.jsonl"),
      inputReviewLedgerPath: join(inDir, "review-ledger.jsonl"),
      inputSourceManifestPath: join(inDir, "sources.json"),
      inputDatasetManifestTemplatePath: join(inDir, "template.json"),
      datasetDirectory,
      expectedDatasetId: "cleanfeed-ptbr-cells-v1",
    },
  };
}

const created: string[] = [];
async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cf-corpus-import-"));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

// Convenience for the common valid two-source manifest.
async function validSources(): Promise<ReviewedSourceManifestV1> {
  return sealedManifest([LICENSED_HUMAN_SOURCE, GEN_SOURCE]);
}

// ---------------------------------------------------------------------------
// Unit: normalization, opaque ids, closed schema and dedup rejections.
// ---------------------------------------------------------------------------

describe("ingestAuthorizedRecords — normalization and content digests", () => {
  it("normalizes NFC/LF and recomputes the content digest", async () => {
    const root = await scratch();
    const rawText = "café primeiro\r\nsegunda linha unica registro rec1";
    const record = humanRecord("rec1", { text: rawText });
    const { request, datasetDirectory } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });

    const result = await ingestAuthorizedRecords(request);
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toBe(1);
    expect(result.outputDigest).toMatch(/^[0-9a-f]{64}$/u);

    const written = await readFile(
      join(datasetDirectory, "records.jsonl"),
      "utf8",
    );
    const parsed = parseBenchmarkDataset(written);
    // Precomposed é and LF-only, never the decomposed/CRLF input bytes.
    expect(parsed[0].text).toBe(normalizeCorpusText(rawText));
    expect(parsed[0].text.includes("\r")).toBe(false);
    expect(parsed[0].text.normalize("NFC")).toBe(parsed[0].text);
    expect(parsed[0].normalizedTextSha256).toBe(corpusContentDigest(rawText));
  });

  it("rejects a caller content hash that conflicts with the recomputed digest", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    record.normalizedTextSha256 = "0".repeat(64); // deliberately wrong
    const { request, datasetDirectory } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });

    const result = await ingestAuthorizedRecords(request);
    expect(result.accepted).toBe(0);
    expect(result.outputDigest).toBeUndefined();
    expect(result.rejected).toEqual([
      { inputLine: 1, code: "CONTENT_HASH_CONFLICT" },
    ]);
    expect(existsSync(join(datasetDirectory, "manifest.json"))).toBe(false);
  });
});

describe("ingestAuthorizedRecords — opaque id validation", () => {
  it("uses the caller-issued opaque id verbatim, never deriving it from text", async () => {
    const root = await scratch();
    const record = humanRecord("OpaqueId_123-XYZ");
    const { request, datasetDirectory } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    const result = await ingestAuthorizedRecords(request);
    expect(result.rejected).toEqual([]);
    const parsed = parseBenchmarkDataset(
      await readFile(join(datasetDirectory, "records.jsonl"), "utf8"),
    );
    expect(parsed[0].id).toBe("OpaqueId_123-XYZ");
  });

  it("rejects a malformed / non-opaque id", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const malformed = { ...record, id: "not opaque @id" };
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(malformed)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    const result = await ingestAuthorizedRecords(request);
    expect(result.accepted).toBe(0);
    expect(result.rejected).toEqual([{ inputLine: 1, code: "MALFORMED_ID" }]);
  });
});

describe("ingestAuthorizedRecords — closed schema and duplicates", () => {
  it("rejects an unknown field (closed record schema)", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const rogue = { ...record, rogue: true };
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(rogue)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    const result = await ingestAuthorizedRecords(request);
    expect(result.rejected).toEqual([
      { inputLine: 1, code: "RECORD_SCHEMA_INVALID" },
    ]);
  });

  it("rejects a malformed JSON line", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const { request } = await buildRequest(root, {
      recordLines: ["{ this is not json", JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    const result = await ingestAuthorizedRecords(request);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toEqual([{ inputLine: 1, code: "INVALID_JSON" }]);
  });

  it("rejects a duplicate id and a duplicate content hash", async () => {
    const root = await scratch();
    const first = humanRecord("rec1");
    const dupId = humanRecord("rec1", {
      text: "outro texto totalmente diferente para o registro dois xyz",
    });
    const dupHash = humanRecord("rec3", { text: first.text });
    const { request } = await buildRequest(root, {
      recordLines: [
        JSON.stringify(first),
        JSON.stringify(dupId),
        JSON.stringify(dupHash),
      ],
      ledgerLines: [ledgerLine(first)],
      sourceManifest: await validSources(),
      template: template(),
    });
    const result = await ingestAuthorizedRecords(request);
    expect(result.accepted).toBe(1);
    expect(result.rejected).toEqual([
      { inputLine: 2, code: "DUPLICATE_ID" },
      { inputLine: 3, code: "DUPLICATE_HASH" },
    ]);
  });
});

describe("ingestAuthorizedRecords — near duplicates and source presence", () => {
  it("refuses a cross-lineage near duplicate", async () => {
    const root = await scratch();
    const base = Array.from({ length: 30 }, (_, i) => `palavra${i}`).join(" ");
    const a = humanRecord("recA", { text: `${base} alfa` });
    const b = humanRecord("recB", { text: `${base} beta` });
    // Distinct declared lineage: neither is a declared derivation of the other.
    a.groups.derivationRoot = "root_a";
    b.groups.derivationRoot = "root_b";
    const { request, datasetDirectory } = await buildRequest(root, {
      recordLines: [JSON.stringify(a), JSON.stringify(b)],
      ledgerLines: [ledgerLine(a), ledgerLine(b)],
      sourceManifest: await validSources(),
      template: template(),
    });
    const result = await ingestAuthorizedRecords(request);
    expect(result.accepted).toBe(0);
    expect(result.rejected).toEqual([
      { inputLine: 1, code: "CROSS_LINEAGE_NEAR_DUPLICATE" },
      { inputLine: 2, code: "CROSS_LINEAGE_NEAR_DUPLICATE" },
    ]);
    expect(existsSync(join(datasetDirectory, "manifest.json"))).toBe(false);
  });

  it("accepts near duplicates that share a declared lineage", async () => {
    const root = await scratch();
    const base = Array.from({ length: 30 }, (_, i) => `palavra${i}`).join(" ");
    const a = humanRecord("recA", { text: `${base} alfa` });
    const b = humanRecord("recB", { text: `${base} beta` });
    a.groups.derivationRoot = "shared_root";
    b.groups.derivationRoot = "shared_root";
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(a), JSON.stringify(b)],
      ledgerLines: [ledgerLine(a), ledgerLine(b)],
      sourceManifest: await validSources(),
      template: template(),
    });
    const result = await ingestAuthorizedRecords(request);
    expect(result.rejected).toEqual([]);
    expect(result.accepted).toBe(2);
  });

  it("rejects a record whose source is absent from the reviewed source manifest", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    record.provenance.sourceId = "src_unknown";
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    const result = await ingestAuthorizedRecords(request);
    expect(result.accepted).toBe(0);
    expect(result.rejected).toEqual([
      { inputLine: 1, code: "SOURCE_ENTRY_ABSENT" },
    ]);
  });
});

describe("ingestAuthorizedRecords — closed dataset-manifest template", () => {
  it("rejects a template that carries a generated file/sha field", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const badTemplate = { ...template(), recordsSha256: "9".repeat(64) };
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: badTemplate,
    });
    await expect(ingestAuthorizedRecords(request)).rejects.toBeInstanceOf(
      CorpusImportError,
    );
  });

  it("rejects a template whose datasetId is not the expected one", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template({ datasetId: "some-other-dataset" }),
    });
    await expect(ingestAuthorizedRecords(request)).rejects.toThrow(
      /datasetId/iu,
    );
  });

  it("generates filenames and all three sha256 values itself", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const { request, datasetDirectory } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    await ingestAuthorizedRecords(request);
    const manifest = validateDatasetManifest(
      JSON.parse(
        await readFile(join(datasetDirectory, "manifest.json"), "utf8"),
      ),
    );
    const recordsBytes = await readFile(
      join(datasetDirectory, "records.jsonl"),
    );
    const expected = createHash("sha256").update(recordsBytes).digest("hex");
    expect(manifest.recordsSha256).toBe(expected);
    expect(manifest.recordsFile).toBe("records.jsonl");
    expect(manifest.reviewLedgerFile).toBe("private/review-ledger.jsonl");
    expect(manifest.sourceManifestFile).toBe("private/source-manifest.json");
  });
});

describe("ingestAuthorizedRecords — atomic output set and stability", () => {
  it("writes exactly the four canonical files and nothing else", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const { request, datasetDirectory } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    await ingestAuthorizedRecords(request);
    const top = (await readdir(datasetDirectory)).sort();
    expect(top).toEqual(["manifest.json", "private", "records.jsonl"]);
    const priv = (await readdir(join(datasetDirectory, "private"))).sort();
    expect(priv).toEqual(["review-ledger.jsonl", "source-manifest.json"]);
  });

  it("produces a stable output digest for identical inputs", async () => {
    const record = humanRecord("rec1");
    const first = await buildRequest(await scratch(), {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    const second = await buildRequest(await scratch(), {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    const a = await ingestAuthorizedRecords(first.request);
    const b = await ingestAuthorizedRecords(second.request);
    expect(a.outputDigest).toBe(b.outputDigest);
  });
});

// ---------------------------------------------------------------------------
// Integration: ingest -> Phase 2 validate -> Phase 2 split, digest chaining
// and downstream invalidation. Builds a full 10k audit-ready infrastructure
// corpus so the real seal/split contracts run end to end.
// ---------------------------------------------------------------------------

const ANNOTATION: BenchmarkRecordV2["annotation"] = {
  protocolVersion: "annotation-v1",
  reviewerIds: ["reviewer_a", "reviewer_b"],
  agreement: "agree",
};

// One block per partition, in temporal order. The splitter looks for four cuts
// BETWEEN these, so only the strict increase matters — the same values the corpus
// assembler stamps (benchmark/lab/assemble_corpus.py BLOCK_TIME).
const TRAIN_TIME = 1000;
const DEV_TIME = 2000;
const CAL_A_TIME = 3000;
const CAL_B_TIME = 4000;
const TEST_TIME = 5000;
const SEEN_FAMILY = "seen_family";
const HELDOUT_FAMILY = "heldout_family";
// A generated family whose every record-line lands in the blind block and that the
// manifest NEVER declares. It reproduces, at corpus scale, what
// `benchmark/data/corpus-build/out/split/split-artifact.json` holds: the corpus
// builder deliberately leaves a family below the 200-positive floor undeclared, and
// the split then has to accept it as an incidental concentration rather than read it
// back as a reservation nobody made (A4-fix).
const INCIDENTAL_FAMILY = "incidental_family";

function buildText(id: string): string {
  return Array.from({ length: 12 }, (_, i) => `${id}_${i}`).join(" ");
}

function baseGroups(id: string, batch: string): BenchmarkRecordV2["groups"] {
  return {
    author: `author_${id}`,
    source: `source_${id}`,
    domainSource: `ds_${id}`,
    collectionBatch: batch,
    nearDuplicate: `nd_${id}`,
    derivationRoot: id,
  };
}

// How many human record-lines come out of ONE origin document. `source` is the origin
// document and it unions by value, so this is what gives the 10k corpus components
// larger than a record-line — without it every human row is its own atom and the
// audit's leakage check over `GROUP_KEYS` is satisfied by identifiers minted never to
// collide, which is the tautology the audit exists not to be.
const HUMAN_ROWS_PER_DOCUMENT = 10;

function humanDocument(batch: string, index: number): string {
  return `doc_${batch}_${Math.floor(index / HUMAN_ROWS_PER_DOCUMENT)}`;
}

function human(
  id: string,
  createdAt: number,
  batch: string,
  document: string,
): BenchmarkRecordV2 {
  const text = buildText(id);
  return {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256: corpusContentDigest(text),
    label: "human",
    language: "pt-BR",
    platform: "generic",
    domain: "corporate",
    topic: "geral",
    humanSourceType: "qa-informal",
    wordCount: 60,
    createdAt,
    provenance: {
      sourceKind: "licensed-corpus",
      sourceId: "src_licensed_human",
      sourceRevision: "rev_001",
      collectedAt: createdAt,
      licenseId: "licensed-v1",
      legalBasis: "license",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "reviewer_pii",
        reviewedAt: createdAt,
      },
    },
    annotation: ANNOTATION,
    transformation: { kind: "none", severity: "none" },
    groups: { ...baseGroups(id, batch), source: document },
  };
}

function generationRecipe(
  family: string,
  createdAt: number,
): NonNullable<BenchmarkRecordV2["generation"]> {
  return {
    provider: "acme",
    family,
    model: "acme-1",
    version: "v1",
    promptId: "prompt_gen",
    promptSha256: PROMPT_DIGEST,
    temperature: 0.7,
    seed: "seed_1",
    generatedAt: createdAt,
  };
}

function ai(
  id: string,
  createdAt: number,
  batch: string,
  family: string,
): BenchmarkRecordV2 {
  const text = buildText(id);
  return {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256: corpusContentDigest(text),
    label: "ai",
    language: "pt-BR",
    platform: "generic",
    domain: "corporate",
    topic: "geral",
    wordCount: 60,
    createdAt,
    provenance: {
      sourceKind: "controlled-generation",
      sourceId: "src_gen",
      sourceRevision: "rev_001",
      collectedAt: createdAt,
      licenseId: "generated-v1",
      legalBasis: "generated",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "reviewer_pii",
        reviewedAt: createdAt,
      },
    },
    annotation: ANNOTATION,
    generation: generationRecipe(family, createdAt),
    transformation: { kind: "none", severity: "none" },
    // The canonical field must be the canonical form of the recipe's own label, or
    // the schema refuses the record (benchmark/generator-family.ts).
    groups: {
      ...baseGroups(id, batch),
      generatorFamily: normalizeGeneratorFamily(family),
    },
  };
}

function mixed(
  id: string,
  createdAt: number,
  batch: string,
  parentId: string,
): BenchmarkRecordV2 {
  const text = buildText(id);
  const groups = baseGroups(id, batch);
  groups.derivationRoot = parentId;
  groups.generatorFamily = normalizeGeneratorFamily(SEEN_FAMILY);
  return {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256: corpusContentDigest(text),
    label: "mixed",
    language: "pt-BR",
    platform: "generic",
    domain: "corporate",
    topic: "geral",
    wordCount: 60,
    createdAt,
    provenance: {
      sourceKind: "controlled-generation",
      sourceId: "src_gen",
      sourceRevision: "rev_001",
      collectedAt: createdAt,
      licenseId: "generated-v1",
      legalBasis: "generated",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "reviewer_pii",
        reviewedAt: createdAt,
      },
    },
    annotation: ANNOTATION,
    generation: generationRecipe(SEEN_FAMILY, createdAt),
    mixture: {
      aiFraction: 0.6,
      humanFraction: 0.4,
      spans: [{ start: 0, end: 5, origin: "ai" }],
      // Everything this project mixes is mechanistic: we chose and executed the
      // edit (benchmark/schema.ts).
      generationMode: "mechanistic",
    },
    transformation: { kind: "human-ai-mix", severity: "medium" },
    groups,
  };
}

interface Block {
  time: number;
  human: number;
  aiSeen: number;
  aiHeld: number;
  aiIncidental: number;
  mixed: number;
  aiBatch: string;
  aiHeldBatch: string;
  aiIncidentalBatch: string;
  mixedBatch: string;
  humanBatch: string;
}

// 45/5/10/20/20 of every class, one block per partition, over the composition the
// frozen corpus policy pins: human 4000 / ai 4000 / mixed 2000.
//
// `aiSeen` in the test block is 200 rather than 800 because the held-out (500) and
// incidental (100) families are already seated there and count toward ai's 20%.
const BLOCKS: readonly Block[] = [
  {
    time: TRAIN_TIME,
    human: 1800,
    aiSeen: 1800,
    aiHeld: 0,
    aiIncidental: 0,
    mixed: 900,
    aiBatch: "gb_ai_train",
    aiHeldBatch: "gb_ai_train_held",
    aiIncidentalBatch: "gb_ai_train_incidental",
    mixedBatch: "gb_mx_train",
    humanBatch: "hb_train",
  },
  {
    time: DEV_TIME,
    human: 200,
    aiSeen: 200,
    aiHeld: 0,
    aiIncidental: 0,
    mixed: 100,
    aiBatch: "gb_ai_dev",
    aiHeldBatch: "gb_ai_dev_held",
    aiIncidentalBatch: "gb_ai_dev_incidental",
    mixedBatch: "gb_mx_dev",
    humanBatch: "hb_dev",
  },
  {
    time: CAL_A_TIME,
    human: 400,
    aiSeen: 400,
    aiHeld: 0,
    aiIncidental: 0,
    mixed: 200,
    aiBatch: "gb_ai_cal_a",
    aiHeldBatch: "gb_ai_cal_a_held",
    aiIncidentalBatch: "gb_ai_cal_a_incidental",
    mixedBatch: "gb_mx_cal_a",
    humanBatch: "hb_cal_a",
  },
  {
    time: CAL_B_TIME,
    human: 800,
    aiSeen: 800,
    aiHeld: 0,
    aiIncidental: 0,
    mixed: 400,
    aiBatch: "gb_ai_cal_b",
    aiHeldBatch: "gb_ai_cal_b_held",
    aiIncidentalBatch: "gb_ai_cal_b_incidental",
    mixedBatch: "gb_mx_cal_b",
    humanBatch: "hb_cal_b",
  },
  {
    time: TEST_TIME,
    human: 800,
    aiSeen: 200,
    aiHeld: 500,
    // Below the 200-positive floor a declaration would have to clear, which is why
    // the manifest cannot declare it and the audit must not infer it.
    aiIncidental: 100,
    mixed: 400,
    aiBatch: "gb_ai_test_seen",
    aiHeldBatch: "gb_ai_test_held",
    aiIncidentalBatch: "gb_ai_test_incidental",
    mixedBatch: "gb_mx_test",
    humanBatch: "hb_test",
  },
];

/**
 * `straddleLastCut` faz UM humano do bloco de `test` declarar o DOCUMENTO DE ORIGEM de um
 * humano do bloco de `train`.
 *
 * `source` é o documento de origem e une por valor, então os dois passam a ser UM componente,
 * cujo intervalo de tempo vai de `TRAIN_TIME` a `TEST_TIME`. O splitter só coloca um
 * componente numa partição do meio quando o intervalo INTEIRO cabe na banda dela, e `train` é
 * o fallback — então o componente cai em `train` levando texto com tempo da banda de teste. O
 * splitter constrói isso sem notar, porque uma linha em dez mil não move fração alguma para
 * fora da tolerância e a conectividade continua satisfeita; a auditoria é o único lugar que
 * recusa, por `earliest(test) > latest(train)`.
 *
 * As duas linhas são escolhidas entre os humanos SEM filho `mixed` dos dois blocos, para que o
 * componente atravessador seja o documento do treino (dez linhas, nenhuma com filho) mais a
 * única linha de `test`, e o que a auditoria recusa fique legível. Os pais são
 * `humanIds[n % humanIds.length]` para n em [0, block.mixed), ou seja os índices
 * 0..mixed-1, então o primeiro sem filho é o índice `block.mixed`.
 */
function generateCorpus(
  opts: { straddleLastCut?: boolean } = {},
): BenchmarkRecordV2[] {
  const records: BenchmarkRecordV2[] = [];
  let index = 0;
  const nextId = (): string => {
    index += 1;
    return `r${index.toString().padStart(6, "0")}`;
  };
  // Capturado do registro construído, nunca escrito à mão: o token vem de `baseGroups`, e
  // uma segunda grafia dele aqui aceitaria a mudança de `baseGroups` sem unir nada.
  let documentoDoTreino: string | undefined;

  for (const block of BLOCKS) {
    const humanIds: string[] = [];
    for (let n = 0; n < block.human; n += 1) {
      const id = nextId();
      humanIds.push(id);
      const registro = human(
        id,
        block.time,
        block.humanBatch,
        humanDocument(block.humanBatch, n),
      );
      if (block.time === TRAIN_TIME && n === block.mixed) {
        documentoDoTreino = registro.groups.source;
      }
      if (
        opts.straddleLastCut === true &&
        block.time === TEST_TIME &&
        n === block.mixed &&
        documentoDoTreino !== undefined
      ) {
        registro.groups = { ...registro.groups, source: documentoDoTreino };
      }
      records.push(registro);
    }
    for (let n = 0; n < block.aiSeen; n += 1) {
      records.push(ai(nextId(), block.time, block.aiBatch, SEEN_FAMILY));
    }
    for (let n = 0; n < block.aiHeld; n += 1) {
      records.push(ai(nextId(), block.time, block.aiHeldBatch, HELDOUT_FAMILY));
    }
    for (let n = 0; n < block.aiIncidental; n += 1) {
      records.push(
        ai(nextId(), block.time, block.aiIncidentalBatch, INCIDENTAL_FAMILY),
      );
    }
    for (let n = 0; n < block.mixed; n += 1) {
      const parentId = humanIds[n % humanIds.length];
      records.push(mixed(nextId(), block.time, block.mixedBatch, parentId));
    }
  }
  return records;
}

function generationBatches(): GenerationBatchV1[] {
  const batch = (
    batchId: string,
    family: string,
    createdAt: number,
  ): GenerationBatchV1 => ({
    batchId,
    sourceId: "src_gen",
    generationProtocolVersion: "generation-v1",
    provider: "acme",
    family,
    model: "acme-1",
    version: "v1",
    promptTemplateDigest: PROMPT_DIGEST,
    temperature: 0.7,
    temperatureNullReason: null,
    generatedAt: createdAt,
    seed: "seed_1",
    seedNullReason: null,
  });
  return [
    batch("gb_ai_train", SEEN_FAMILY, TRAIN_TIME),
    batch("gb_ai_dev", SEEN_FAMILY, DEV_TIME),
    batch("gb_ai_cal_a", SEEN_FAMILY, CAL_A_TIME),
    batch("gb_ai_cal_b", SEEN_FAMILY, CAL_B_TIME),
    batch("gb_ai_test_seen", SEEN_FAMILY, TEST_TIME),
    batch("gb_ai_test_held", HELDOUT_FAMILY, TEST_TIME),
    batch("gb_ai_test_incidental", INCIDENTAL_FAMILY, TEST_TIME),
    batch("gb_mx_train", SEEN_FAMILY, TRAIN_TIME),
    batch("gb_mx_dev", SEEN_FAMILY, DEV_TIME),
    batch("gb_mx_cal_a", SEEN_FAMILY, CAL_A_TIME),
    batch("gb_mx_cal_b", SEEN_FAMILY, CAL_B_TIME),
    batch("gb_mx_test", SEEN_FAMILY, TEST_TIME),
  ];
}

describe("ingest -> validate -> split integration (10k)", () => {
  it("carries components larger than a record-line, so the leakage check is not a tautology", () => {
    // Measured on the fixture rather than on the pipeline, because the property being
    // measured is the fixture's: every OTHER assertion in this file about grouping
    // ("`leakages` empty", the sealed audit re-deriving) is satisfied for free by a
    // corpus of ten thousand atoms whose identities were minted never to collide.
    const records = generateCorpus();
    const roots = connectedComponentRoots(records);
    const sizes = new Map<string, number>();
    for (const root of roots.values()) {
      sizes.set(root, (sizes.get(root) ?? 0) + 1);
    }
    // 400 human documents (4000 human rows, ten per document) with their `mixed`
    // children folded in by `derivationRoot`, plus 4000 generated singletons. The
    // arithmetic is restated rather than derived so that losing a union axis moves it.
    expect(records).toHaveLength(10_000);
    expect(sizes.size).toBe(4_400);
    expect(sizes.size).toBeLessThan(records.length);
    // Ten rows of one document plus the ten `mixed` rows derived from them.
    expect(Math.max(...sizes.values())).toBe(20);
  });

  async function preparar(
    root: string,
    records: BenchmarkRecordV2[],
  ): Promise<{ datasetDirectory: string; datasetAuditPath: string }> {
    const manifest = await sealedManifest(
      [LICENSED_HUMAN_SOURCE, GEN_SOURCE],
      generationBatches(),
    );
    const { request, datasetDirectory } = await buildRequest(root, {
      recordLines: records.map((r) => JSON.stringify(r)),
      ledgerLines: records.map((r) => ledgerLine(r)),
      sourceManifest: manifest,
      template: template(),
    });
    const ingestResult = await ingestAuthorizedRecords(request);
    expect(ingestResult.rejected).toEqual([]);

    const validateOut = join(root, "out", "validate");
    await runValidate({
      datasetDirectory,
      outputDirectory: validateOut,
      corpusPolicy: {
        ...RELEASE_CORPUS_POLICY,
        counts: { human: 4_000, ai: 4_000, mixed: 2_000 },
      },
    });
    return {
      datasetDirectory,
      datasetAuditPath: join(validateOut, "dataset-audit.json"),
    };
  }

  it("refuses a corpus the splitter accepts and the audit does not", async () => {
    // A ÚNICA guarda de `commands/split.ts` que ficou sem teste, e a razão de ter ficado é
    // que ela exige exatamente esta combinação: splitter com SUCESSO e auditoria reprovando.
    // Um componente que atravessa o último corte cai em `train` levando tempo da banda de
    // teste; proporção e conectividade seguem satisfeitas, então o splitter não vê nada.
    const root = await scratch();
    const records = generateCorpus({ straddleLastCut: true });
    expect(records).toHaveLength(10_000);
    const { datasetDirectory, datasetAuditPath } = await preparar(
      root,
      records,
    );

    // A RAZÃO, e não só o código: o mecanismo do atravessador é o documento de origem, e
    // qualquer outra reprovação da auditoria — um vazamento de grupo, uma fração fora da
    // tolerância — satisfaria `code` sozinho e deixaria esta guarda medindo outra coisa.
    await expect(
      runSplit({
        datasetDirectory,
        datasetAuditPath,
        outputDirectory: join(root, "out", "split-atravessado"),
        seed: 20260804,
      }),
    ).rejects.toMatchObject({
      code: "SPLIT_AUDIT_FAILED",
      message: expect.stringContaining(
        "temporal leakage: the blocked test is not strictly newer than every other partition",
      ) as unknown as string,
    });
  }, 180_000);

  it("materializes a sealable, splittable corpus with chained digests and downstream invalidation", async () => {
    const root = await scratch();
    const records = generateCorpus();
    expect(records).toHaveLength(10_000);

    const manifest = await sealedManifest(
      [LICENSED_HUMAN_SOURCE, GEN_SOURCE],
      generationBatches(),
    );
    const { request, datasetDirectory } = await buildRequest(root, {
      recordLines: records.map((r) => JSON.stringify(r)),
      ledgerLines: records.map((r) => ledgerLine(r)),
      sourceManifest: manifest,
      template: template(),
    });

    // 1. Ingest accepts the whole corpus and writes the canonical directory.
    const ingestResult = await ingestAuthorizedRecords(request);
    expect(ingestResult.rejected).toEqual([]);
    expect(ingestResult.accepted).toBe(10_000);
    expect(ingestResult.outputDigest).toMatch(/^[0-9a-f]{64}$/u);

    // 2. Phase 2 validate seals the corpus (no second sealing implementation).
    const validateOut = join(root, "out", "validate");
    const sealMessage = await runValidate({
      datasetDirectory,
      outputDirectory: validateOut,
      // This corpus is `infrastructure-only`, so it declares its own composition. Pinned
      // to the release 4000/4000/2000, no corpus this test can build satisfies the power
      // floors, and the pipeline could not be exercised end to end at all. The override is
      // refused for a release corpus, which is what keeps it from loosening anything.
      corpusPolicy: {
        ...RELEASE_CORPUS_POLICY,
        counts: { human: 4_000, ai: 4_000, mixed: 2_000 },
      },
    });
    expect(sealMessage).toBe(
      "Dataset sealed: 10000 records (human=4000, ai=4000, mixed=2000).",
    );
    const audit = JSON.parse(
      await readFile(join(validateOut, "dataset-audit.json"), "utf8"),
    );
    const datasetManifest = validateDatasetManifest(
      JSON.parse(
        await readFile(join(datasetDirectory, "manifest.json"), "utf8"),
      ),
    );
    expect(audit.recordsSha256).toBe(datasetManifest.recordsSha256);
    expect(audit.reviewLedgerSha256).toBe(datasetManifest.reviewLedgerSha256);
    expect(audit.sourceManifestSha256).toBe(
      datasetManifest.sourceManifestSha256,
    );
    expect(audit.auditDigest).toMatch(/^[0-9a-f]{64}$/u);

    const readiness = JSON.parse(
      await readFile(join(validateOut, "source-readiness.json"), "utf8"),
    );
    expect(readiness.status).toBe("ready");
    expect(readiness.blockingReasons).toEqual([]);

    // 3. Phase 2 split freezes the leakage-safe blocked partition.
    const splitOut = join(root, "out", "split");
    const splitMessage = await runSplit({
      datasetDirectory,
      datasetAuditPath: join(validateOut, "dataset-audit.json"),
      outputDirectory: splitOut,
      seed: 20260804,
    });
    expect(splitMessage).toBe(
      "Split frozen: train=45%, dev=5%, cal-A=10%, cal-B=20%, test=20%; leakage=0.",
    );
    const artifact = JSON.parse(
      await readFile(join(splitOut, "split-artifact.json"), "utf8"),
    );
    const parsedRecords = parseBenchmarkDataset(
      await readFile(join(datasetDirectory, "records.jsonl"), "utf8"),
    );
    await expect(
      validateSplitArtifact(artifact, datasetManifest, parsedRecords),
    ).resolves.toBeDefined();
    expect(artifact.audit.passed).toBe(true);
    expect(artifact.audit.leakages).toEqual([]);
    expect(artifact.splitDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(artifact.schemaVersion).toBe(4);
    expect(artifact.algorithm).toBe("blocked-group-time-v2");

    // Every partition file is published, and the two that must never be readable are
    // under private/ — the directory IS the enforcement, so this asserts the layout
    // rather than trusting the writer.
    for (const file of [
      "train.jsonl",
      "dev.jsonl",
      "cal-A.jsonl",
      "test-input.jsonl",
    ]) {
      await expect(
        readFile(join(splitOut, file), "utf8"),
      ).resolves.toBeTruthy();
    }
    for (const file of ["cal-B.jsonl", "test-labels.jsonl"]) {
      await expect(
        readFile(join(splitOut, "private", file), "utf8"),
      ).resolves.toBeTruthy();
    }

    // The human-negative count is PUBLISHED and not gated on: this corpus holds 800 in
    // the blind block against a reporting threshold of 2000, so the offer is
    // insufficient for a released FPR bound and the split still freezes. Refusing here
    // would be a power gate inside the audit; what refuses a corpus is the
    // pre-registered floor, on independent clusters per quota cell.
    expect(artifact.audit.testHumanNegatives.count).toBe(800);
    expect(artifact.audit.testHumanNegatives.sufficientForReleaseFpr).toBe(
      false,
    );

    // The reservation is what the manifest declared and the partitions honored, and
    // the family that merely concentrated itself in the blind block is published
    // beside it as diagnosis.
    expect(artifact.audit.heldOutGeneratorFamilies).toEqual([HELDOUT_FAMILY]);
    expect(artifact.audit.incidentalTestOnlyGeneratorFamilies).toEqual([
      INCIDENTAL_FAMILY,
    ]);

    // 3b. A reservation the corpus stocks with nothing is refused by the command's own
    // guard. Only manifest.json changes, so the sealed audit still binds the same
    // records and the failure is the family disagreement rather than a digest mismatch.
    const manifestPath = join(datasetDirectory, "manifest.json");
    const declaredJson = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...JSON.parse(declaredJson),
        heldOutGeneratorFamilies: ["never_generated_family"],
      }),
      "utf8",
    );
    await expect(
      runSplit({
        datasetDirectory,
        datasetAuditPath: join(validateOut, "dataset-audit.json"),
        outputDirectory: join(root, "out", "split-unstocked"),
        seed: 20260804,
      }),
    ).rejects.toThrow(/HELD_OUT_FAMILY_DISAGREEMENT|never_generated_family/u);
    await writeFile(manifestPath, declaredJson, "utf8"); // restore for isolation

    // 3c. The same corpus, declared `release`, is REFUSED — the composition attestation
    // the pre-registration demands does not exist yet, so a release freeze is unavailable
    // by design. Only `scientificUse` changes, so the sealed audit still binds the same
    // bytes and the refusal is the attestation, not a digest mismatch.
    const releaseJson = await readFile(manifestPath, "utf8");
    await writeFile(
      manifestPath,
      JSON.stringify({
        ...JSON.parse(releaseJson),
        scientificUse: "release",
      }),
      "utf8",
    );
    await expect(
      runSplit({
        datasetDirectory,
        datasetAuditPath: join(validateOut, "dataset-audit.json"),
        outputDirectory: join(root, "out", "split-release"),
        seed: 20260804,
      }),
    ).rejects.toThrow(/COMPOSITION_FLOOR_NOT_APPLIED|pre-registered floor/u);
    await writeFile(manifestPath, releaseJson, "utf8"); // restore for isolation

    // 3d. A seed que nao e a PRE-REGISTRADA e recusada, e a recusa vem antes de qualquer
    // trabalho. O numero pre-registrado vive em `PREREGISTRATION_V4.seeds.split`; aceitar
    // outro poria um parametro escolhido pelo chamador num artefato cuja razao de existir e
    // que os parametros foram fixados de antemao.
    await expect(
      runSplit({
        datasetDirectory,
        datasetAuditPath: join(validateOut, "dataset-audit.json"),
        outputDirectory: join(root, "out", "split-seed-errada"),
        seed: 999_999,
      }),
    ).rejects.toThrow(
      /SPLIT_SEED_NOT_PRE_REGISTERED|pre-registered split seed/u,
    );

    // 3e. Uma auditoria selada para OUTRO dataset e recusada, e a forja e competente: o
    // `auditDigest` e RECOMPUTADO sobre a identidade alterada, senao a checagem do auto-digest
    // recusaria primeiro e o teste provaria coerencia interna em vez do vinculo ao dataset.
    const auditPath = join(validateOut, "dataset-audit.json");
    const auditJson = await readFile(auditPath, "utf8");
    const auditObjeto = JSON.parse(auditJson) as Record<string, unknown>;
    delete auditObjeto.auditDigest;
    const outroDataset = {
      ...auditObjeto,
      datasetId: "outro-dataset-qualquer",
    } as unknown as Omit<DatasetAudit, "auditDigest">;
    await writeFile(
      auditPath,
      JSON.stringify({
        ...outroDataset,
        auditDigest: await computeDatasetAuditDigest(outroDataset),
      }),
      "utf8",
    );
    await expect(
      runSplit({
        datasetDirectory,
        datasetAuditPath: auditPath,
        outputDirectory: join(root, "out", "split-outro-dataset"),
        seed: 20260804,
      }),
    ).rejects.toThrow(/DATASET_AUDIT_MISMATCH|different dataset/u);
    await writeFile(auditPath, auditJson, "utf8"); // restore for isolation

    // 4a. A later record change invalidates the split artifact's datasetDigest.
    const tampered = parsedRecords.map((r) => ({ ...r }));
    tampered[0] = { ...tampered[0], text: `${tampered[0].text} adulterado` };
    await expect(
      validateSplitArtifact(artifact, datasetManifest, tampered),
    ).rejects.toThrow(/datasetDigest|MISMATCH/iu);

    // 4b. Any later record/ledger/source-manifest byte change fails the seal.
    const files: Array<{ path: string; code: RegExp }> = [
      {
        path: join(datasetDirectory, "records.jsonl"),
        code: /records\.jsonl digest does not match/u,
      },
      {
        path: join(datasetDirectory, "private", "review-ledger.jsonl"),
        code: /review-ledger\.jsonl digest does not match/u,
      },
      {
        path: join(datasetDirectory, "private", "source-manifest.json"),
        code: /source-manifest\.json digest does not match/u,
      },
    ];
    for (const { path, code } of files) {
      const original = await readFile(path, "utf8");
      await writeFile(path, `${original}\n`, "utf8");
      await expect(
        runValidate({
          datasetDirectory,
          outputDirectory: join(root, "out", "revalidate"),
        }),
      ).rejects.toThrow(code);
      await writeFile(path, original, "utf8"); // restore for isolation
    }
  }, 180_000);

  it("refuses a composition override for a release corpus", async () => {
    // The override exists so an infrastructure corpus can be exercised at a size the
    // release floors cannot reach. Reachable for a release corpus, it would be a way to
    // seal a release against a composition nobody froze — so it is refused there, and
    // there is no CLI flag for it at all.
    const root = await scratch();
    const records = generateCorpus();
    const manifest = await sealedManifest(
      [LICENSED_HUMAN_SOURCE, GEN_SOURCE],
      generationBatches(),
    );
    const { request, datasetDirectory } = await buildRequest(root, {
      recordLines: records.map((r) => JSON.stringify(r)),
      ledgerLines: records.map((r) => ledgerLine(r)),
      sourceManifest: manifest,
      template: template({ scientificUse: "release" }),
    });
    await ingestAuthorizedRecords(request);
    await expect(
      runValidate({
        datasetDirectory,
        outputDirectory: join(root, "out", "validate-override"),
        corpusPolicy: {
          ...RELEASE_CORPUS_POLICY,
          counts: { human: 4_000, ai: 4_000, mixed: 2_000 },
        },
      }),
    ).rejects.toThrow(
      /CORPUS_POLICY_OVERRIDE_FORBIDDEN|only for scientificUse/u,
    );
  }, 180_000);
});

// ---------------------------------------------------------------------------
// As guardas do TEMPLATE e do LEDGER DE REVISAO.
//
// A ordem dentro de `ingestAuthorizedRecords` decide o que cada teste precisa montar: template
// primeiro, manifesto de fontes depois, ledger de revisao em terceiro e so entao os registros.
// Por isso os dois primeiros nao precisam de ledger valido, e os dois ultimos precisam de
// template valido.
// ---------------------------------------------------------------------------

describe("ingestAuthorizedRecords — template e ledger de revisao", () => {
  async function pedido(
    incoming: Partial<Incoming> & Pick<Incoming, "template">,
  ): Promise<IngestRequest> {
    const root = await scratch();
    const record = humanRecord("rec1");
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      ...incoming,
    });
    return request;
  }

  it("refuses a template that is not a JSON object", async () => {
    await expect(
      ingestAuthorizedRecords(await pedido({ template: [] })),
    ).rejects.toMatchObject({ code: "TEMPLATE_INVALID" });
  });

  it("refuses a template carrying a field the importer generates", async () => {
    // Os seis campos derivados (arquivo e sha256 de registros, ledger e manifesto) sao
    // computados no ingest. Aceitar um deles no template deixaria o operador DECLARAR o digest
    // do que ele mesmo entregou.
    await expect(
      ingestAuthorizedRecords(
        await pedido({
          template: { ...template(), recordsSha256: "0".repeat(64) },
        }),
      ),
    ).rejects.toMatchObject({ code: "TEMPLATE_HAS_DERIVED_FIELD" });
  });

  it("refuses a template declaring another datasetId", async () => {
    await expect(
      ingestAuthorizedRecords(
        await pedido({ template: template({ datasetId: "outro-dataset" }) }),
      ),
    ).rejects.toMatchObject({ code: "DATASET_ID_MISMATCH" });
  });

  it("refuses a review ledger line that is not JSON", async () => {
    await expect(
      ingestAuthorizedRecords(
        await pedido({
          template: template(),
          ledgerLines: ["isto nao e json"],
        }),
      ),
    ).rejects.toMatchObject({ code: "REVIEW_LEDGER_INVALID" });
  });

  it("refuses a source manifest the parser cannot read", async () => {
    // A coercao existe porque o que esta corrompido e o ARQUIVO, e o tipo do arnes nao tem como
    // expressar isso. `loadSourceManifest` embrulha qualquer falha do parser neste codigo, para
    // que o operador veja de qual dos quatro insumos veio a recusa.
    await expect(
      ingestAuthorizedRecords(
        await pedido({
          template: template(),
          sourceManifest: {} as unknown as ReviewedSourceManifestV1,
        }),
      ),
    ).rejects.toMatchObject({ code: "SOURCE_MANIFEST_INVALID" });
  });

  it("refuses a review ledger with no entries at all", async () => {
    // Esta e a guarda que impede selar um dataset sem UMA entrada de revisao humana. O ledger e
    // tratado como dado opaco de governanca — o importador prova que parseia e nunca inspeciona
    // valor de campo —, entao "vazio" e a unica coisa que ele pode recusar sobre o conteudo.
    await expect(
      ingestAuthorizedRecords(
        await pedido({ template: template(), ledgerLines: [] }),
      ),
    ).rejects.toMatchObject({ code: "REVIEW_LEDGER_EMPTY" });
  });
});

// ---------------------------------------------------------------------------
// `ingest`: a recusa do COMANDO, distinta das rejeicoes da biblioteca.
//
// `ingestAuthorizedRecords` COLETA rejeicoes e devolve; o comando as transforma em recusa. A
// distincao e o ponto: a biblioteca serve quem quer o relatorio, e o comando serve quem nao pode
// selar um dataset parcialmente aceito sem notar.
// ---------------------------------------------------------------------------

describe("runIngest", () => {
  it("refuses the whole run when any record was rejected", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const { request } = await buildRequest(root, {
      // O MESMO registro duas vezes: `DUPLICATE_ID` e motivo de rejeicao, nao lancamento, entao a
      // biblioteca aceitaria um e rejeitaria o outro. O comando tem de recusar a corrida.
      recordLines: [JSON.stringify(record), JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    await expect(
      runIngest({
        inputRecordsPath: request.inputRecordsPath,
        reviewLedgerPath: request.inputReviewLedgerPath,
        sourceManifestPath: request.inputSourceManifestPath,
        datasetManifestTemplatePath: request.inputDatasetManifestTemplatePath,
        datasetDirectory: request.datasetDirectory,
      }),
    ).rejects.toMatchObject({ code: "INGEST_REJECTED" });
  });

  // T14 — the abandoned corpus identity is refused BY NAME, in both places that can
  // carry it. The dead id named a claim about "pt-BR text in general", which has no
  // sampling frame; a pipeline handed that id would build the corpus of a claim nobody
  // makes any more, and it would build it successfully.
  it("reads the live dataset id from the pre-registration instead of a literal", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    expect(request.expectedDatasetId).toBe(PREREGISTRATION_V4.dataset.id);
    await expect(
      runIngest({
        inputRecordsPath: request.inputRecordsPath,
        reviewLedgerPath: request.inputReviewLedgerPath,
        sourceManifestPath: request.inputSourceManifestPath,
        datasetManifestTemplatePath: request.inputDatasetManifestTemplatePath,
        datasetDirectory: request.datasetDirectory,
      }),
    ).resolves.toContain("Ingested 1 records");
  });
});

describe("the abandoned dataset identity", () => {
  const deadId = PREREGISTRATION_V4.dataset.refusedIds[0].id;
  // `expectedDatasetId` is typed as the frozen literal, so a caller cannot reach these
  // refusals by accident any more — which is the point. The cast is what a test needs
  // to prove the RUNTIME guard still fires for a caller that defeats the type.
  const asRequestedId = (id: string) =>
    id as typeof PREREGISTRATION_V4.dataset.id;

  it("refuses a request that asks for the abandoned corpus", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: template(),
    });
    await expect(
      ingestAuthorizedRecords({
        ...request,
        expectedDatasetId: asRequestedId(deadId),
      }),
    ).rejects.toMatchObject({ code: "DATASET_ID_ABANDONED" });
    // And the diagnosis names the live corpus, so the refusal is actionable.
    await expect(
      ingestAuthorizedRecords({
        ...request,
        expectedDatasetId: asRequestedId(deadId),
      }),
    ).rejects.toThrow(
      new RegExp(`${deadId}.*${PREREGISTRATION_V4.dataset.id}`, "su"),
    );
  });

  // The template is the second carrier, and it is refused with the SAME code rather
  // than as a mismatch against the live id: "you asked for a dataset that no longer
  // exists" and "your template disagrees with your request" are different failures.
  it("refuses a template that declares the abandoned corpus", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: { ...template(), datasetId: deadId },
    });
    await expect(ingestAuthorizedRecords(request)).rejects.toMatchObject({
      code: "DATASET_ID_ABANDONED",
    });
  });

  it("still reports a plain mismatch when the template names a live-looking id", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: { ...template(), datasetId: "cleanfeed-ptbr-cells-v2" },
    });
    await expect(ingestAuthorizedRecords(request)).rejects.toMatchObject({
      code: "DATASET_ID_MISMATCH",
    });
  });

  // The hole the refusal list alone leaves: an id that is neither the live corpus nor
  // any NAMED dead one. Written into BOTH carriers, so the template agrees with the
  // request and the mismatch check has nothing to say — the ingest used to build a
  // corpus whose identity nothing pinned.
  it("refuses an id that is neither live nor a named dead one, in both carriers", async () => {
    const root = await scratch();
    const record = humanRecord("rec1");
    const invented = "cleanfeed-ptbr-cells-v9";
    const { request } = await buildRequest(root, {
      recordLines: [JSON.stringify(record)],
      ledgerLines: [ledgerLine(record)],
      sourceManifest: await validSources(),
      template: { ...template(), datasetId: invented },
    });
    const asked = {
      ...request,
      expectedDatasetId: asRequestedId(invented),
    };
    await expect(ingestAuthorizedRecords(asked)).rejects.toMatchObject({
      code: "DATASET_ID_UNKNOWN",
    });
    // A code of its own, distinct from both neighbours: this is not an abandoned
    // corpus and not a disagreement between request and template.
    await expect(ingestAuthorizedRecords(asked)).rejects.toThrow(
      new RegExp(`${invented}.*${PREREGISTRATION_V4.dataset.id}`, "su"),
    );
  });
});
