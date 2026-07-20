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
  validateDatasetManifest,
  type DatasetManifest,
} from "../dataset-manifest.ts";
import { parseBenchmarkDataset, type BenchmarkRecord } from "../schema.ts";
import {
  computeReviewedSourceManifestDigest,
  type GenerationBatchV1,
  type ReviewedSourceEntryV1,
  type ReviewedSourceManifestV1,
} from "../source-manifest.ts";
import { runValidate } from "../commands/validate.ts";
import { runSplit } from "../commands/split.ts";
import { validateSplitArtifact } from "../split-artifact.ts";

// ---------------------------------------------------------------------------
// Shared fixtures.
// ---------------------------------------------------------------------------

const CONSENT_SOURCE: ReviewedSourceEntryV1 = {
  sourceId: "src_consent",
  sourceType: "linkedin-contribution",
  acquisition: "consent",
  evaluationUseApproved: true,
  licenseId: null,
  consentReceiptDigest: "a".repeat(64),
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
  intendedDomain: "linkedin";
  createdAt: string;
  normalizationVersion: string;
  annotationProtocolVersion: "annotation-v1";
  heldOutGeneratorFamilies: [string, ...string[]];
  licenses: DatasetManifest["licenses"];
}

function template(overrides: Partial<TemplateLike> = {}): TemplateLike {
  return {
    schemaVersion: 1,
    datasetId: "ptbr-linkedin-v1",
    version: "1.0.0",
    scientificUse: "infrastructure-only",
    intendedLanguage: "pt-BR",
    intendedDomain: "linkedin",
    createdAt: "2026-07-19T00:00:00.000Z",
    normalizationVersion: "cleanfeed-text-v1",
    annotationProtocolVersion: "annotation-v1",
    heldOutGeneratorFamilies: ["heldout_family"],
    licenses: [
      {
        id: "consent-v1",
        name: "Authorized contribution",
        source: "fixture://consent",
        evaluationUseApproved: true,
        redistribution: "not-published",
        notice: "Contributed under explicit consent; raw text stays local.",
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
  overrides: Partial<BenchmarkRecord> = {},
): BenchmarkRecord {
  const text = overrides.text ?? `texto unico do registro ${id} alfa beta gama`;
  const record: BenchmarkRecord = {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256: corpusContentDigest(text),
    label: "human",
    language: "pt-BR",
    platform: "linkedin",
    domain: "corporate",
    topic: "career",
    humanSourceType: "broetry",
    wordCount: 8,
    createdAt: 1000,
    provenance: {
      sourceKind: "authorized-contribution",
      sourceId: "src_consent",
      sourceRevision: "rev_001",
      collectedAt: 1000,
      licenseId: "consent-v1",
      legalBasis: "consent",
      consentId: "consent_001",
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

function ledgerLine(record: BenchmarkRecord): string {
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
  const datasetDirectory = join(root, "ptbr-linkedin-v1");
  return {
    datasetDirectory,
    request: {
      inputRecordsPath: join(inDir, "records.jsonl"),
      inputReviewLedgerPath: join(inDir, "review-ledger.jsonl"),
      inputSourceManifestPath: join(inDir, "sources.json"),
      inputDatasetManifestTemplatePath: join(inDir, "template.json"),
      datasetDirectory,
      expectedDatasetId: "ptbr-linkedin-v1",
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
  return sealedManifest([CONSENT_SOURCE, GEN_SOURCE]);
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

const ANNOTATION: BenchmarkRecord["annotation"] = {
  protocolVersion: "annotation-v1",
  reviewerIds: ["reviewer_a", "reviewer_b"],
  agreement: "agree",
};

const DEV_TIME = 1000;
const CAL_TIME = 2000;
const TEST_TIME = 3000;
const SEEN_FAMILY = "seen_family";
const HELDOUT_FAMILY = "heldout_family";

function buildText(id: string): string {
  return Array.from({ length: 12 }, (_, i) => `${id}_${i}`).join(" ");
}

function baseGroups(id: string, batch: string): BenchmarkRecord["groups"] {
  return {
    author: `author_${id}`,
    source: `source_${id}`,
    domainSource: `ds_${id}`,
    collectionBatch: batch,
    nearDuplicate: `nd_${id}`,
    derivationRoot: id,
  };
}

function human(id: string, createdAt: number, batch: string): BenchmarkRecord {
  const text = buildText(id);
  return {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256: corpusContentDigest(text),
    label: "human",
    language: "pt-BR",
    platform: "linkedin",
    domain: "corporate",
    topic: "geral",
    humanSourceType: "broetry",
    wordCount: 60,
    createdAt,
    provenance: {
      sourceKind: "authorized-contribution",
      sourceId: "src_consent",
      sourceRevision: "rev_001",
      collectedAt: createdAt,
      licenseId: "consent-v1",
      legalBasis: "consent",
      consentId: "consent_001",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "reviewer_pii",
        reviewedAt: createdAt,
      },
    },
    annotation: ANNOTATION,
    transformation: { kind: "none", severity: "none" },
    groups: baseGroups(id, batch),
  };
}

function generationRecipe(
  family: string,
  createdAt: number,
): NonNullable<BenchmarkRecord["generation"]> {
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
): BenchmarkRecord {
  const text = buildText(id);
  return {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256: corpusContentDigest(text),
    label: "ai",
    language: "pt-BR",
    platform: "linkedin",
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
    groups: baseGroups(id, batch),
  };
}

function mixed(
  id: string,
  createdAt: number,
  batch: string,
  parentId: string,
): BenchmarkRecord {
  const text = buildText(id);
  const groups = baseGroups(id, batch);
  groups.derivationRoot = parentId;
  return {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256: corpusContentDigest(text),
    label: "mixed",
    language: "pt-BR",
    platform: "linkedin",
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
  mixed: number;
  aiBatch: string;
  aiHeldBatch: string;
  mixedBatch: string;
  humanBatch: string;
}

const BLOCKS: readonly Block[] = [
  {
    time: DEV_TIME,
    human: 800,
    aiSeen: 800,
    aiHeld: 0,
    mixed: 400,
    aiBatch: "gb_ai_dev",
    aiHeldBatch: "gb_ai_dev_held",
    mixedBatch: "gb_mx_dev",
    humanBatch: "hb_dev",
  },
  {
    time: CAL_TIME,
    human: 1200,
    aiSeen: 1200,
    aiHeld: 0,
    mixed: 600,
    aiBatch: "gb_ai_cal",
    aiHeldBatch: "gb_ai_cal_held",
    mixedBatch: "gb_mx_cal",
    humanBatch: "hb_cal",
  },
  {
    time: TEST_TIME,
    human: 2000,
    aiSeen: 1500,
    aiHeld: 500,
    mixed: 1000,
    aiBatch: "gb_ai_test_seen",
    aiHeldBatch: "gb_ai_test_held",
    mixedBatch: "gb_mx_test",
    humanBatch: "hb_test",
  },
];

function generateCorpus(): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  let index = 0;
  const nextId = (): string => {
    index += 1;
    return `r${index.toString().padStart(6, "0")}`;
  };

  for (const block of BLOCKS) {
    const humanIds: string[] = [];
    for (let n = 0; n < block.human; n += 1) {
      const id = nextId();
      humanIds.push(id);
      records.push(human(id, block.time, block.humanBatch));
    }
    for (let n = 0; n < block.aiSeen; n += 1) {
      records.push(ai(nextId(), block.time, block.aiBatch, SEEN_FAMILY));
    }
    for (let n = 0; n < block.aiHeld; n += 1) {
      records.push(ai(nextId(), block.time, block.aiHeldBatch, HELDOUT_FAMILY));
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
    generatedAt: createdAt,
    seed: "seed_1",
    seedNullReason: null,
  });
  return [
    batch("gb_ai_dev", SEEN_FAMILY, DEV_TIME),
    batch("gb_ai_cal", SEEN_FAMILY, CAL_TIME),
    batch("gb_ai_test_seen", SEEN_FAMILY, TEST_TIME),
    batch("gb_ai_test_held", HELDOUT_FAMILY, TEST_TIME),
    batch("gb_mx_dev", SEEN_FAMILY, DEV_TIME),
    batch("gb_mx_cal", SEEN_FAMILY, CAL_TIME),
    batch("gb_mx_test", SEEN_FAMILY, TEST_TIME),
  ];
}

describe("ingest -> validate -> split integration (10k)", () => {
  it("materializes a sealable, splittable corpus with chained digests and downstream invalidation", async () => {
    const root = await scratch();
    const records = generateCorpus();
    expect(records).toHaveLength(10_000);

    const manifest = await sealedManifest(
      [CONSENT_SOURCE, GEN_SOURCE],
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
      seed: 712019,
    });
    expect(splitMessage).toBe(
      "Split frozen: development=20%, calibration=30%, test=50%; leakage=0.",
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
});
