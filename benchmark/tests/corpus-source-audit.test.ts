import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../contracts/canonical-json.ts";
import {
  CORPUS_SOURCE_BLOCKING_CODES,
  parseCorpusSourceReadinessReport,
  type CorpusSourceBlockingCode,
} from "../../contracts/source-readiness.ts";
import {
  assertCorpusSourcesReady,
  auditCorpusSources,
  type CorpusSourceAuditInput,
} from "../corpus-source-audit.ts";
import {
  computeReviewedSourceManifestDigest,
  type GenerationBatchV1,
  type ReviewedSourceEntryV1,
  type ReviewedSourceManifestV1,
} from "../source-manifest.ts";
import type { BenchmarkRecord } from "../schema.ts";

// --- Reviewed source manifest fixtures -----------------------------------

const consentSource: ReviewedSourceEntryV1 = {
  sourceId: "src_consent",
  sourceType: "linkedin-contribution",
  acquisition: "consent",
  evaluationUseApproved: true,
  licenseId: null,
  consentReceiptDigest: "a".repeat(64),
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_b"],
};

const licensedSource: ReviewedSourceEntryV1 = {
  sourceId: "src_licensed",
  sourceType: "licensed-corpus",
  acquisition: "licensed",
  evaluationUseApproved: true,
  licenseId: "lic_ptbr_1",
  consentReceiptDigest: null,
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_c"],
};

const generatedSource: ReviewedSourceEntryV1 = {
  sourceId: "src_generated",
  sourceType: "controlled-generation",
  acquisition: "generated",
  evaluationUseApproved: true,
  licenseId: "lic_generated_1",
  consentReceiptDigest: null,
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_d"],
};

const batch: GenerationBatchV1 = {
  batchId: "batch_gen",
  sourceId: "src_generated",
  generationProtocolVersion: "generation-v1",
  provider: "acme",
  family: "acme_large",
  model: "acme_large_2",
  version: "2026-05",
  promptTemplateDigest: "1".repeat(64),
  temperature: 0.7,
  generatedAt: 1_735_776_000_000,
  seed: "seed_1",
  seedNullReason: null,
};

// --- Benchmark record fixtures (schema v2) -------------------------------

const humanConsent: BenchmarkRecord = {
  schemaVersion: 2,
  id: "human_c1",
  text: "prosa corporativa autorizada em portugues do brasil",
  normalizedTextSha256: "1".repeat(64),
  label: "human",
  language: "pt-BR",
  platform: "linkedin",
  domain: "corporate",
  topic: "career",
  humanSourceType: "broetry",
  wordCount: 7,
  createdAt: 1_735_689_600_000,
  provenance: {
    sourceKind: "authorized-contribution",
    sourceId: "src_consent",
    sourceRevision: "rev_1",
    collectedAt: 1_735_689_600_000,
    licenseId: "consent_v1",
    legalBasis: "consent",
    consentId: "consent_1",
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "pii_1",
      reviewedAt: 1_735_689_600_000,
    },
  },
  annotation: {
    protocolVersion: "annotation-v1",
    reviewerIds: ["rev_a", "rev_b"],
    agreement: "agree",
  },
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: "author_c1",
    source: "src_consent",
    domainSource: "linkedin_contribution",
    collectionBatch: "batch_h_consent",
    nearDuplicate: "nd_c1",
    derivationRoot: "human_c1",
  },
};

const humanLicensed: BenchmarkRecord = {
  schemaVersion: 2,
  id: "human_l1",
  text: "conteudo licenciado compativel em portugues do brasil",
  normalizedTextSha256: "2".repeat(64),
  label: "human",
  language: "pt-BR",
  platform: "linkedin",
  domain: "corporate",
  topic: "sales",
  humanSourceType: "sales",
  wordCount: 7,
  createdAt: 1_735_690_600_000,
  provenance: {
    sourceKind: "licensed-corpus",
    sourceId: "src_licensed",
    sourceRevision: "rev_2",
    collectedAt: 1_735_690_600_000,
    licenseId: "lic_ptbr_1",
    legalBasis: "license",
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "pii_2",
      reviewedAt: 1_735_690_600_000,
    },
  },
  annotation: {
    protocolVersion: "annotation-v1",
    reviewerIds: ["rev_a", "rev_c"],
    agreement: "agree",
  },
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: "author_l1",
    source: "src_licensed",
    domainSource: "licensed_corpus",
    collectionBatch: "batch_h_licensed",
    nearDuplicate: "nd_l1",
    derivationRoot: "human_l1",
  },
};

const aiGenerated: BenchmarkRecord = {
  schemaVersion: 2,
  id: "ai_g1",
  text: "conteudo sintetico gerado sob receita controlada",
  normalizedTextSha256: "3".repeat(64),
  label: "ai",
  language: "pt-BR",
  platform: "linkedin",
  domain: "corporate",
  topic: "technology",
  wordCount: 6,
  createdAt: 1_735_776_000_000,
  provenance: {
    sourceKind: "controlled-generation",
    sourceId: "src_generated",
    sourceRevision: "rev_3",
    collectedAt: 1_735_776_000_000,
    licenseId: "lic_generated_1",
    legalBasis: "generated",
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "pii_3",
      reviewedAt: 1_735_776_000_000,
    },
  },
  annotation: {
    protocolVersion: "annotation-v1",
    reviewerIds: ["rev_a", "rev_d"],
    agreement: "agree",
  },
  generation: {
    provider: "acme",
    family: "acme_large",
    model: "acme_large_2",
    version: "2026-05",
    promptId: "prompt_1",
    promptSha256: "1".repeat(64),
    temperature: 0.7,
    seed: "seed_1",
    generatedAt: 1_735_776_000_000,
  },
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: "author_g1",
    source: "src_generated",
    domainSource: "generated_batch",
    generatorFamily: "acme_family",
    generatorVersion: "acme_v2",
    promptTemplate: "template_1",
    collectionBatch: "batch_gen",
    nearDuplicate: "nd_g1",
    derivationRoot: "ai_g1",
  },
};

type ManifestBody = Omit<ReviewedSourceManifestV1, "sourceManifestDigest">;

async function buildInput(options: {
  sources?: ReviewedSourceEntryV1[];
  batches?: GenerationBatchV1[];
  records?: BenchmarkRecord[];
  digestOverride?: string;
}): Promise<CorpusSourceAuditInput> {
  const body: ManifestBody = {
    schemaVersion: 1,
    sources: options.sources ?? [
      consentSource,
      licensedSource,
      generatedSource,
    ],
    generationBatches: options.batches ?? [batch],
  };
  const sourceManifestDigest =
    options.digestOverride ?? (await computeReviewedSourceManifestDigest(body));
  return {
    records: options.records ?? [humanConsent, humanLicensed, aiGenerated],
    sourceManifest: { ...body, sourceManifestDigest },
  };
}

// Launders a deliberately non-compliant source across the typed boundary so the
// audit can be exercised on manifests a well-typed caller could not construct.
function tamperSource(patch: Record<string, unknown>): ReviewedSourceEntryV1 {
  return { ...generatedSource, ...patch } as unknown as ReviewedSourceEntryV1;
}

function codesOf(report: {
  blockingReasons: { code: CorpusSourceBlockingCode }[];
}): CorpusSourceBlockingCode[] {
  return report.blockingReasons.map((reason) => reason.code);
}

describe("auditCorpusSources", () => {
  it("returns a ready report for fully authorized sources", async () => {
    const report = await auditCorpusSources(await buildInput({}));
    expect(report).toMatchObject({
      status: "ready",
      blockingReasons: [],
      recordCount: 3,
      sourceCount: 3,
      acquisitionCounts: { consent: 1, licensed: 1, generated: 1 },
      protocols: {
        corpus: "corpus-v1",
        collection: "collection-v1",
        annotation: "annotation-v1",
        generation: "generation-v1",
        pii: "pii-review-v1",
      },
    });
    expect(() => assertCorpusSourcesReady(report)).not.toThrow();
  });

  it("re-parses cleanly through the Phase 2 closed contract", async () => {
    const report = await auditCorpusSources(await buildInput({}));
    await expect(parseCorpusSourceReadinessReport(report)).resolves.toEqual(
      report,
    );
    expect(report.sourceManifestDigest).toBe(
      await computeReviewedSourceManifestDigest({
        schemaVersion: 1,
        sources: [consentSource, licensedSource, generatedSource],
        generationBatches: [batch],
      }),
    );
  });

  it("flags a LinkedIn source that is not authorized", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          {
            ...consentSource,
            evaluationUseApproved: false,
          } as unknown as ReviewedSourceEntryV1,
          licensedSource,
          generatedSource,
        ],
      }),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "LINKEDIN_SOURCE_NOT_AUTHORIZED",
        sourceId: "src_consent",
      }),
    );
  });

  it("flags a source that is not approved for evaluation use", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          consentSource,
          licensedSource,
          tamperSource({ evaluationUseApproved: false }),
        ],
      }),
    );
    expect(codesOf(report)).toContain("EVALUATION_USE_NOT_APPROVED");
  });

  it("flags non-independent legal reviewers", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          consentSource,
          licensedSource,
          tamperSource({ legalReviewerIds: ["legal_a", "legal_a"] }),
        ],
      }),
    );
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "SOURCE_REVIEWERS_NOT_INDEPENDENT",
        sourceId: "src_generated",
      }),
    );
  });

  it("flags a missing legal review", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          consentSource,
          licensedSource,
          tamperSource({ legalReviewerIds: ["legal_a"] }),
        ],
      }),
    );
    expect(codesOf(report)).toContain("SOURCE_LEGAL_REVIEW_MISSING");
  });

  it("flags a collection protocol mismatch", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          consentSource,
          licensedSource,
          tamperSource({ collectionProtocolVersion: "collection-v0" }),
        ],
      }),
    );
    expect(codesOf(report)).toContain("COLLECTION_PROTOCOL_MISMATCH");
  });

  it("flags a record whose source is absent from the manifest", async () => {
    const orphan: BenchmarkRecord = {
      ...humanConsent,
      provenance: { ...humanConsent.provenance, sourceId: "src_absent" },
      groups: { ...humanConsent.groups, source: "src_absent" },
    };
    const report = await auditCorpusSources(
      await buildInput({ records: [orphan, humanLicensed, aiGenerated] }),
    );
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "SOURCE_REFERENCE_MISSING",
        recordId: "human_c1",
      }),
    );
  });

  it("flags a generated record with no linked batch", async () => {
    const unlinked: BenchmarkRecord = {
      ...aiGenerated,
      groups: { ...aiGenerated.groups, collectionBatch: "batch_absent" },
    };
    const report = await auditCorpusSources(
      await buildInput({ records: [humanConsent, humanLicensed, unlinked] }),
    );
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "GENERATION_RECIPE_MISSING",
        recordId: "ai_g1",
      }),
    );
  });

  it("flags a generated record whose recipe diverges from its batch", async () => {
    const drifted: BenchmarkRecord = {
      ...aiGenerated,
      generation: { ...aiGenerated.generation!, model: "acme_large_9" },
    };
    const report = await auditCorpusSources(
      await buildInput({ records: [humanConsent, humanLicensed, drifted] }),
    );
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "GENERATION_RECIPE_MISMATCH",
        recordId: "ai_g1",
      }),
    );
  });

  it("forbids a human record from linking a generation batch", async () => {
    const linked: BenchmarkRecord = {
      ...humanConsent,
      groups: { ...humanConsent.groups, collectionBatch: "batch_gen" },
    };
    const report = await auditCorpusSources(
      await buildInput({ records: [linked, humanLicensed, aiGenerated] }),
    );
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "GENERATION_RECIPE_MISMATCH",
        recordId: "human_c1",
      }),
    );
  });

  it("flags a manifest whose self-digest does not match its body", async () => {
    const report = await auditCorpusSources(
      await buildInput({ digestOverride: "0".repeat(64) }),
    );
    expect(codesOf(report)).toContain("SOURCE_MANIFEST_INVALID");
  });

  it("only ever emits Phase 2 blocking codes", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          {
            ...consentSource,
            evaluationUseApproved: false,
          } as unknown as ReviewedSourceEntryV1,
          tamperSource({ collectionProtocolVersion: "collection-v0" }),
          tamperSource({ legalReviewerIds: ["legal_a", "legal_a"] }),
        ],
        records: [
          {
            ...humanConsent,
            provenance: {
              ...humanConsent.provenance,
              sourceId: "src_absent",
            },
          },
          humanLicensed,
          aiGenerated,
        ],
        digestOverride: "0".repeat(64),
      }),
    );
    const allowed = new Set<string>(CORPUS_SOURCE_BLOCKING_CODES);
    for (const code of codesOf(report)) {
      expect(allowed.has(code)).toBe(true);
    }
    await expect(parseCorpusSourceReadinessReport(report)).resolves.toEqual(
      report,
    );
  });

  it("throws from assertCorpusSourcesReady when blocked", async () => {
    const report = await auditCorpusSources(
      await buildInput({ digestOverride: "0".repeat(64) }),
    );
    expect(() => assertCorpusSourcesReady(report)).toThrow(
      /SOURCE_MANIFEST_INVALID/,
    );
  });
});

describe("corpus source readiness privacy and determinism", () => {
  it("never serializes text, urls, prompts or raw receipts", async () => {
    const orphan: BenchmarkRecord = {
      ...humanConsent,
      provenance: { ...humanConsent.provenance, sourceId: "src_absent" },
    };
    const report = await auditCorpusSources(
      await buildInput({ records: [orphan, humanLicensed, aiGenerated] }),
    );
    const serialized = JSON.stringify(report);
    for (const forbidden of [
      "text",
      "url",
      "prompt",
      "authorGroup",
      "consentReceiptDigest",
      "contentSha256",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("produces byte-identical output when records are permuted", async () => {
    const forward = await auditCorpusSources(
      await buildInput({
        records: [humanConsent, humanLicensed, aiGenerated],
      }),
    );
    const permuted = await auditCorpusSources(
      await buildInput({
        records: [aiGenerated, humanConsent, humanLicensed],
      }),
    );
    expect(canonicalJson(permuted)).toBe(canonicalJson(forward));
    expect(permuted.reportDigest).toBe(forward.reportDigest);
  });
});
