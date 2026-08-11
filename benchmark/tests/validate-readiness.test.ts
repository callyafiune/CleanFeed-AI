import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { parseCorpusSourceReadinessReport } from "../../contracts/source-readiness.ts";
import {
  corpusContentDigest,
  ingestAuthorizedRecords,
  type IngestRequest,
} from "../corpus-import.ts";
import { runValidate } from "../commands/validate.ts";
import { sha256OfFile } from "../commands/io.ts";
import {
  RELEASE_CORPUS_POLICY,
  type DatasetManifest,
} from "../dataset-manifest.ts";
import { normalizeGeneratorFamily } from "../generator-family.ts";
import type { BenchmarkRecordV2 } from "../schema.ts";
import {
  computeReviewedSourceManifestDigest,
  type GenerationBatchV1,
  type ReviewedSourceEntryV1,
  type ReviewedSourceManifestV1,
} from "../source-manifest.ts";

// The composition this corpus is sealed against. `infrastructure-only` is not a
// convenience here: `runValidate` refuses a corpus policy override for a release
// corpus (CORPUS_POLICY_OVERRIDE_FORBIDDEN), so a three-record fixture can only be
// sealed under this scientific use — and the readiness refusal has to hold for it,
// because there is no release branch in the guard.
const POLICY = {
  ...RELEASE_CORPUS_POLICY,
  counts: { human: 2, ai: 1, mixed: 0 },
};

const SEALED_MESSAGE = "Dataset sealed: 3 records (human=2, ai=1, mixed=0).";

const HUMAN_ID_A = "rec_humano_alfa_0001";
// The record whose `provenance.sourceId` is orphaned in the blocked fixture. Spelled
// as a token no blocking code and no message of this pipeline contains, so the
// privacy assertion below cannot pass by coincidence.
const HUMAN_ID_ORPHAN = "rec_humano_orfao_0002";
const AI_ID = "rec_gerado_0003";
const ORPHAN_SOURCE_ID = "src_fora_do_manifesto_0009";

const HUMAN_BATCH = "hb_1";
const GENERATION_BATCH = "gb_ai_1";
const FAMILY = "seen_family";
const CREATED_AT = 1000;
const PROMPT_DIGEST = "1".repeat(64);

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

const GENERATION_BATCHES: GenerationBatchV1[] = [
  {
    batchId: GENERATION_BATCH,
    sourceId: "src_gen",
    generationProtocolVersion: "generation-v1",
    provider: "acme",
    family: FAMILY,
    model: "acme-1",
    version: "v1",
    promptTemplateDigest: PROMPT_DIGEST,
    temperature: 0.7,
    temperatureNullReason: null,
    generatedAt: CREATED_AT,
    seed: "seed_1",
    seedNullReason: null,
  },
];

const ANNOTATION: BenchmarkRecordV2["annotation"] = {
  protocolVersion: "annotation-v1",
  reviewerIds: ["reviewer_a", "reviewer_b"],
  agreement: "agree",
};

function buildText(id: string): string {
  return Array.from({ length: 12 }, (_, i) => `${id}_${i}`).join(" ");
}

function human(id: string): BenchmarkRecordV2 {
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
    wordCount: 12,
    createdAt: CREATED_AT,
    provenance: {
      sourceKind: "licensed-corpus",
      sourceId: "src_licensed_human",
      sourceRevision: "rev_001",
      collectedAt: CREATED_AT,
      licenseId: "licensed-v1",
      legalBasis: "license",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "reviewer_pii",
        reviewedAt: CREATED_AT,
      },
    },
    annotation: ANNOTATION,
    transformation: { kind: "none", severity: "none" },
    // `collectionBatch` must NOT name a declared generation batch on a human row:
    // the source audit reads that as GENERATION_RECIPE_MISMATCH, which would put a
    // second code into the refusal message the tests below match word for word.
    groups: {
      author: `author_${id}`,
      source: `doc_${id}`,
      domainSource: `ds_${id}`,
      collectionBatch: HUMAN_BATCH,
      nearDuplicate: `nd_${id}`,
      derivationRoot: id,
    },
  };
}

function ai(id: string): BenchmarkRecordV2 {
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
    wordCount: 12,
    createdAt: CREATED_AT,
    provenance: {
      sourceKind: "controlled-generation",
      sourceId: "src_gen",
      sourceRevision: "rev_001",
      collectedAt: CREATED_AT,
      licenseId: "generated-v1",
      legalBasis: "generated",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "reviewer_pii",
        reviewedAt: CREATED_AT,
      },
    },
    annotation: ANNOTATION,
    generation: {
      provider: "acme",
      family: FAMILY,
      model: "acme-1",
      version: "v1",
      promptId: "prompt_gen",
      promptSha256: PROMPT_DIGEST,
      temperature: 0.7,
      seed: "seed_1",
      generatedAt: CREATED_AT,
    },
    transformation: { kind: "none", severity: "none" },
    groups: {
      author: `author_${id}`,
      source: `doc_${id}`,
      domainSource: `ds_${id}`,
      collectionBatch: GENERATION_BATCH,
      nearDuplicate: `nd_${id}`,
      derivationRoot: id,
      generatorFamily: normalizeGeneratorFamily(FAMILY),
    },
  };
}

function template(): unknown {
  return {
    schemaVersion: 1,
    datasetId: "cleanfeed-ptbr-cells-v1",
    version: "1.0.0",
    scientificUse: "infrastructure-only",
    intendedLanguage: "pt-BR",
    intendedDomain: "scoped-cells",
    createdAt: "2026-08-11T00:00:00.000Z",
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
  };
}

const created: string[] = [];

async function scratch(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cf-u1-validate-readiness-"));
  created.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(
    created.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
  );
});

async function sealedSourceManifest(): Promise<ReviewedSourceManifestV1> {
  const body = {
    schemaVersion: 1 as const,
    sources: [LICENSED_HUMAN_SOURCE, GEN_SOURCE],
    generationBatches: GENERATION_BATCHES,
  };
  return {
    ...body,
    sourceManifestDigest: await computeReviewedSourceManifestDigest(body),
  };
}

/**
 * Builds the canonical dataset directory through the importer, so the manifest and
 * the three file digests are the ones the real pipeline writes.
 */
async function buildCorpus(root: string): Promise<string> {
  const records = [human(HUMAN_ID_A), human(HUMAN_ID_ORPHAN), ai(AI_ID)];
  const incoming = join(root, "incoming");
  await mkdir(incoming, { recursive: true });
  await writeFile(
    join(incoming, "records.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    join(incoming, "review-ledger.jsonl"),
    `${records
      .map((record) =>
        JSON.stringify({
          recordId: record.id,
          reviewerIds: record.annotation.reviewerIds,
          agreement: record.annotation.agreement,
        }),
      )
      .join("\n")}\n`,
    "utf8",
  );
  await writeFile(
    join(incoming, "sources.json"),
    `${JSON.stringify(await sealedSourceManifest(), null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    join(incoming, "template.json"),
    `${JSON.stringify(template(), null, 2)}\n`,
    "utf8",
  );
  const datasetDirectory = join(root, "cleanfeed-ptbr-cells-v1");
  const request: IngestRequest = {
    inputRecordsPath: join(incoming, "records.jsonl"),
    inputReviewLedgerPath: join(incoming, "review-ledger.jsonl"),
    inputSourceManifestPath: join(incoming, "sources.json"),
    inputDatasetManifestTemplatePath: join(incoming, "template.json"),
    datasetDirectory,
    expectedDatasetId: "cleanfeed-ptbr-cells-v1",
  };
  const result = await ingestAuthorizedRecords(request);
  expect(result.rejected).toEqual([]);
  expect(result.accepted).toBe(3);
  return datasetDirectory;
}

/**
 * Points one human record at a `sourceId` the reviewed manifest does not declare and
 * re-binds the manifest to the new bytes, so the three digest guards still pass and
 * the corpus reaches the source audit.
 *
 * It is done AFTER ingestion because the importer refuses such a record outright
 * (SOURCE_ENTRY_ABSENT), and because `sealDataset` cross-checks
 * `provenance.licenseId` against the licence inventory and NEVER `sourceId` against
 * the reviewed source manifest — which is what makes this corpus seal green while its
 * governance readiness comes out blocked.
 */
async function blockSources(datasetDirectory: string): Promise<void> {
  const recordsPath = join(datasetDirectory, "records.jsonl");
  const manifestPath = join(datasetDirectory, "manifest.json");
  const lines = (await readFile(recordsPath, "utf8"))
    .split("\n")
    .filter((line) => line.length > 0);
  const rewritten = lines.map((line) => {
    const record = JSON.parse(line) as BenchmarkRecordV2;
    if (record.id !== HUMAN_ID_ORPHAN) return line;
    return JSON.stringify({
      ...record,
      provenance: { ...record.provenance, sourceId: ORPHAN_SOURCE_ID },
    });
  });
  await writeFile(recordsPath, `${rewritten.join("\n")}\n`, "utf8");
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as DatasetManifest;
  manifest.recordsSha256 = await sha256OfFile(recordsPath);
  await writeFile(
    manifestPath,
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

interface Refusal {
  code?: unknown;
  message?: string;
}

async function refusalOf(promise: Promise<unknown>): Promise<Refusal> {
  try {
    await promise;
  } catch (error) {
    return error as Refusal;
  }
  throw new Error("expected runValidate to refuse, and it resolved");
}

describe("runValidate — governance readiness", () => {
  it("validate recusa corpus cujas fontes a auditoria bloqueou", async () => {
    const root = await scratch();
    const datasetDirectory = await buildCorpus(root);
    await blockSources(datasetDirectory);

    await expect(
      runValidate({
        datasetDirectory,
        outputDirectory: join(root, "out", "recusa"),
        corpusPolicy: POLICY,
      }),
    ).rejects.toMatchObject({ code: "SOURCE_READINESS_BLOCKED" });
  }, 60_000);

  it("a recusa é a do módulo que decide, palavra por palavra", async () => {
    const root = await scratch();
    const datasetDirectory = await buildCorpus(root);
    await blockSources(datasetDirectory);

    const refusal = await refusalOf(
      runValidate({
        datasetDirectory,
        outputDirectory: join(root, "out", "mensagem"),
        corpusPolicy: POLICY,
      }),
    );
    expect(refusal.message).toBe(
      "corpus sources are not ready: SOURCE_REFERENCE_MISSING",
    );
  }, 60_000);

  it("corpus bloqueado não cunha dataset-audit.json", async () => {
    const root = await scratch();
    const datasetDirectory = await buildCorpus(root);
    await blockSources(datasetDirectory);
    const outputDirectory = join(root, "out", "sem-auditoria");

    await refusalOf(
      runValidate({ datasetDirectory, outputDirectory, corpusPolicy: POLICY }),
    );

    // The exit code is not the fail-closed criterion: `runSplit` takes
    // `--dataset-audit` and never a readiness report, so an audit left on disk freezes
    // the test cut over a corpus whose sources nobody authorized.
    await expect(
      readFile(join(outputDirectory, "dataset-audit.json"), "utf8"),
    ).rejects.toThrow(/ENOENT/u);
  }, 60_000);

  it("o relatório bloqueado é escrito antes da recusa", async () => {
    const root = await scratch();
    const datasetDirectory = await buildCorpus(root);
    await blockSources(datasetDirectory);
    const outputDirectory = join(root, "out", "evidencia");

    await refusalOf(
      runValidate({ datasetDirectory, outputDirectory, corpusPolicy: POLICY }),
    );

    // Through the closed parser on purpose: it proves in one act that the file exists,
    // that it is the readiness report, and that it was not left half written.
    const report = await parseCorpusSourceReadinessReport(
      JSON.parse(
        await readFile(join(outputDirectory, "source-readiness.json"), "utf8"),
      ),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({ code: "SOURCE_REFERENCE_MISSING" }),
    );
  }, 60_000);

  it("a recusa nomeia códigos, nunca um recordId", async () => {
    const root = await scratch();
    const datasetDirectory = await buildCorpus(root);
    await blockSources(datasetDirectory);
    const outputDirectory = join(root, "out", "privacidade");

    const refusal = await refusalOf(
      runValidate({ datasetDirectory, outputDirectory, corpusPolicy: POLICY }),
    );

    expect(refusal.message).toContain("SOURCE_REFERENCE_MISSING");
    expect(refusal.message).not.toContain(HUMAN_ID_ORPHAN);
    expect(refusal.message).not.toContain(ORPHAN_SOURCE_ID);
    // The report on disk is where the identifiers belong, and it must still carry them.
    const report = await parseCorpusSourceReadinessReport(
      JSON.parse(
        await readFile(join(outputDirectory, "source-readiness.json"), "utf8"),
      ),
    );
    expect(report.blockingReasons).toContainEqual({
      code: "SOURCE_REFERENCE_MISSING",
      recordId: HUMAN_ID_ORPHAN,
      sourceId: ORPHAN_SOURCE_ID,
    });
  }, 60_000);

  it("corpus pronto ainda sela, escreve os dois artefatos e devolve a mensagem inalterada", async () => {
    const root = await scratch();
    const datasetDirectory = await buildCorpus(root);
    const outputDirectory = join(root, "out", "verde");

    // Byte for byte the format `corpus-import.test.ts` fixes with `toBe`, restated here
    // so a break in it fails inside this file instead of another unit's suite.
    expect(
      await runValidate({
        datasetDirectory,
        outputDirectory,
        corpusPolicy: POLICY,
      }),
    ).toBe(SEALED_MESSAGE);

    const audit = JSON.parse(
      await readFile(join(outputDirectory, "dataset-audit.json"), "utf8"),
    ) as { recordCount: number; sealed: boolean };
    expect(audit.recordCount).toBe(3);
    const report = await parseCorpusSourceReadinessReport(
      JSON.parse(
        await readFile(join(outputDirectory, "source-readiness.json"), "utf8"),
      ),
    );
    expect(report.status).toBe("ready");
    expect(report.blockingReasons).toEqual([]);
  }, 60_000);
});
