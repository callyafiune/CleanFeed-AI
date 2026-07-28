import { describe, expect, it } from "vitest";

import {
  computeDatasetAuditDigest,
  parseDatasetAudit,
  RELEASE_CORPUS_POLICY,
  sealDataset,
  validateDatasetManifest,
  type DatasetAudit,
  type DatasetFileDigests,
  type DatasetManifest,
} from "../dataset-manifest.ts";
import type { BenchmarkRecord } from "../schema.ts";
import { asGeneratorFamily } from "../generator-family.ts";

const RECORDS_SHA = "d".repeat(64);
const REVIEW_LEDGER_SHA = "e".repeat(64);
const SOURCE_MANIFEST_SHA = "f".repeat(64);

const validFileDigests: DatasetFileDigests = {
  recordsSha256: RECORDS_SHA,
  reviewLedgerSha256: REVIEW_LEDGER_SHA,
  sourceManifestSha256: SOURCE_MANIFEST_SHA,
};

const validManifest: DatasetManifest = {
  schemaVersion: 1,
  datasetId: "ptbr-generic-v1",
  version: "1.0.0",
  scientificUse: "infrastructure-only",
  intendedLanguage: "pt-BR",
  intendedDomain: "generic",
  createdAt: "2026-07-19T00:00:00.000Z",
  normalizationVersion: "cleanfeed-text-v1",
  annotationProtocolVersion: "annotation-v1",
  recordsFile: "records.jsonl",
  recordsSha256: RECORDS_SHA,
  reviewLedgerFile: "private/review-ledger.jsonl",
  reviewLedgerSha256: REVIEW_LEDGER_SHA,
  sourceManifestFile: "private/source-manifest.json",
  sourceManifestSha256: SOURCE_MANIFEST_SHA,
  heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
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
};

const HUMAN_TEXT = Array.from(
  { length: 100 },
  (_, index) => `palavra${index}`,
).join(" ");

const human: BenchmarkRecord = {
  schemaVersion: 2,
  id: "human-0001",
  text: HUMAN_TEXT,
  normalizedTextSha256: "a".repeat(64),
  label: "human",
  language: "pt-BR",
  platform: "generic",
  domain: "corporate",
  topic: "career",
  humanSourceType: "qa-informal",
  hardNegativeFamily: "formulaic",
  wordCount: 100,
  createdAt: 1_735_689_600_000,
  provenance: {
    sourceKind: "authorized-contribution",
    sourceId: "source_001",
    sourceRevision: "rev_001",
    collectedAt: 1_735_689_600_000,
    licenseId: "consent-v1",
    legalBasis: "consent",
    consentId: "consent_001",
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "reviewer_01",
      reviewedAt: 1_735_689_600_000,
    },
  },
  annotation: {
    protocolVersion: "annotation-v1",
    reviewerIds: ["reviewer_01", "reviewer_02"],
    agreement: "agree",
  },
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: "author_001",
    source: "source_001",
    domainSource: "linkedin_contribution_batch_01",
    collectionBatch: "batch_001",
    nearDuplicate: "near_h_001",
    derivationRoot: "human-0001",
  },
};

const ai: BenchmarkRecord = {
  schemaVersion: 2,
  id: "ai-0001",
  text: Array.from({ length: 100 }, (_, index) => `token${index}`).join(" "),
  normalizedTextSha256: "b".repeat(64),
  label: "ai",
  language: "pt-BR",
  platform: "generic",
  domain: "corporate",
  topic: "career",
  wordCount: 100,
  createdAt: 1_735_776_000_000,
  provenance: {
    sourceKind: "controlled-generation",
    sourceId: "source_002",
    sourceRevision: "rev_002",
    collectedAt: 1_735_776_000_000,
    licenseId: "generated-v1",
    legalBasis: "generated",
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "reviewer_03",
      reviewedAt: 1_735_776_000_000,
    },
  },
  annotation: {
    protocolVersion: "annotation-v1",
    reviewerIds: ["reviewer_03", "reviewer_04"],
    agreement: "agree",
  },
  generation: {
    provider: "acme",
    family: "acme-large",
    model: "acme-large-2",
    version: "2026-05",
    promptId: "prompt_001",
    promptSha256: "1".repeat(64),
    generatedAt: 1_735_776_000_000,
  },
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: "author_gen_001",
    source: "source_002",
    domainSource: "generated_batch_01",
    generatorFamily: asGeneratorFamily("acme-large"),
    generatorVersion: "acme_v2",
    promptTemplate: "template_001",
    collectionBatch: "batch_002",
    nearDuplicate: "near_a_001",
    derivationRoot: "ai-0001",
  },
};

const mixed: BenchmarkRecord = {
  schemaVersion: 2,
  id: "mixed-0001",
  text: Array.from({ length: 100 }, (_, index) => `misto${index}`).join(" "),
  normalizedTextSha256: "c".repeat(64),
  label: "mixed",
  language: "pt-BR",
  platform: "generic",
  domain: "corporate",
  topic: "career",
  wordCount: 100,
  createdAt: 1_735_862_400_000,
  provenance: {
    sourceKind: "controlled-generation",
    sourceId: "source_003",
    sourceRevision: "rev_003",
    collectedAt: 1_735_862_400_000,
    licenseId: "generated-v1",
    legalBasis: "generated",
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "reviewer_05",
      reviewedAt: 1_735_862_400_000,
    },
  },
  annotation: {
    protocolVersion: "annotation-v1",
    reviewerIds: ["reviewer_05", "reviewer_06"],
    agreement: "agree",
  },
  mixture: {
    aiFraction: 0.5,
    humanFraction: 0.5,
    spans: [{ start: 0, end: 10, origin: "ai" }],
    generationMode: "mechanistic",
  },
  transformation: { kind: "human-ai-mix", severity: "medium" },
  groups: {
    author: "author_001",
    source: "source_003",
    domainSource: "mixed_batch_01",
    generatorFamily: asGeneratorFamily("acme-large"),
    generatorVersion: "acme_v2",
    promptTemplate: "template_001",
    collectionBatch: "batch_003",
    nearDuplicate: "near_m_001",
    derivationRoot: "human-0001",
  },
};

describe("dataset manifest", () => {
  it("accepts the fully specified infrastructure manifest", () => {
    expect(validateDatasetManifest(validManifest).datasetId).toBe(
      "ptbr-generic-v1",
    );
  });

  it("rejects an unknown manifest key", () => {
    expect(() =>
      validateDatasetManifest({ ...validManifest, rogue: true }),
    ).toThrow(/unknown key.*rogue/i);
  });

  it("rejects a non-literal intendedDomain", () => {
    expect(() =>
      validateDatasetManifest({ ...validManifest, intendedDomain: "twitter" }),
    ).toThrow(/intendedDomain/i);
  });

  it("rejects a source not approved for internal evaluation", () => {
    expect(() =>
      validateDatasetManifest({
        schemaVersion: 1,
        datasetId: "ptbr-generic-v1",
        version: "1.0.0",
        scientificUse: "release",
        intendedLanguage: "pt-BR",
        intendedDomain: "generic",
        createdAt: "2026-07-19T00:00:00.000Z",
        normalizationVersion: "cleanfeed-text-v1",
        annotationProtocolVersion: "annotation-v1",
        recordsFile: "records.jsonl",
        recordsSha256: "a".repeat(64),
        reviewLedgerFile: "private/review-ledger.jsonl",
        reviewLedgerSha256: "b".repeat(64),
        sourceManifestFile: "private/source-manifest.json",
        sourceManifestSha256: "c".repeat(64),
        heldOutGeneratorFamilies: ["heldout-family"],
        licenses: [
          {
            id: "bad",
            name: "Fixture license",
            source: "fixture://license",
            evaluationUseApproved: false,
            redistribution: "not-published",
            notice: "Fixture-only material",
          },
        ],
      }),
    ).toThrow(/evaluationUseApproved/);
  });

  it("seals only the exact release composition", async () => {
    const policy = {
      ...RELEASE_CORPUS_POLICY,
      counts: { human: 1, ai: 1, mixed: 1 },
    };
    await expect(
      sealDataset(
        validManifest,
        [human] as BenchmarkRecord[],
        policy,
        validFileDigests,
      ),
    ).rejects.toThrow(/expected ai=1, received ai=0/);
  });

  it("enforces the sealed 4k/4k/2k release quota", async () => {
    await expect(
      sealDataset(
        validManifest,
        [human, ai, mixed],
        RELEASE_CORPUS_POLICY,
        validFileDigests,
      ),
    ).rejects.toThrow(/expected human=4000, received human=1/);
  });

  it("rejects a record byte digest that drifts from the manifest", async () => {
    const policy = {
      ...RELEASE_CORPUS_POLICY,
      counts: { human: 1, ai: 1, mixed: 1 },
    };
    await expect(
      sealDataset(validManifest, [human, ai, mixed], policy, {
        ...validFileDigests,
        recordsSha256: "9".repeat(64),
      }),
    ).rejects.toThrow(/recordsSha256/i);
    await expect(
      sealDataset(validManifest, [human, ai, mixed], policy, {
        ...validFileDigests,
        reviewLedgerSha256: "9".repeat(64),
      }),
    ).rejects.toThrow(/reviewLedgerSha256/i);
    await expect(
      sealDataset(validManifest, [human, ai, mixed], policy, {
        ...validFileDigests,
        sourceManifestSha256: "9".repeat(64),
      }),
    ).rejects.toThrow(/sourceManifestSha256/i);
  });

  it("rejects two identical reviewers on a record", async () => {
    const policy = {
      ...RELEASE_CORPUS_POLICY,
      counts: { human: 1, ai: 1, mixed: 1 },
    };
    const sameReviewers: BenchmarkRecord = {
      ...human,
      annotation: {
        ...human.annotation,
        reviewerIds: ["reviewer_01", "reviewer_01"],
      },
    };
    await expect(
      sealDataset(
        validManifest,
        [sameReviewers, ai, mixed],
        policy,
        validFileDigests,
      ),
    ).rejects.toThrow(/distinct reviewers/i);
  });

  it("rejects an adjudicator who is also a reviewer", async () => {
    const policy = {
      ...RELEASE_CORPUS_POLICY,
      counts: { human: 1, ai: 1, mixed: 1 },
    };
    const selfAdjudicated: BenchmarkRecord = {
      ...human,
      annotation: {
        protocolVersion: "annotation-v1",
        reviewerIds: ["reviewer_01", "reviewer_02"],
        agreement: "adjudicated",
        adjudicatorId: "reviewer_01",
      },
    };
    await expect(
      sealDataset(
        validManifest,
        [selfAdjudicated, ai, mixed],
        policy,
        validFileDigests,
      ),
    ).rejects.toThrow(/adjudicator/i);
  });

  it("rejects a record whose license is absent from the inventory", async () => {
    const policy = {
      ...RELEASE_CORPUS_POLICY,
      counts: { human: 1, ai: 1, mixed: 1 },
    };
    const unlicensed: BenchmarkRecord = {
      ...ai,
      provenance: { ...ai.provenance, licenseId: "unknown-license" },
    };
    await expect(
      sealDataset(
        validManifest,
        [human, unlicensed, mixed],
        policy,
        validFileDigests,
      ),
    ).rejects.toThrow(/license/i);
  });

  it("seals a coherent infrastructure corpus that is not release eligible", async () => {
    const policy = {
      ...RELEASE_CORPUS_POLICY,
      counts: { human: 1, ai: 1, mixed: 1 },
    };
    const audit = await sealDataset(
      validManifest,
      [human, ai, mixed],
      policy,
      validFileDigests,
    );
    expect(audit.sealed).toBe(true);
    expect(audit.releaseEligible).toBe(false);
    expect(audit.recordCount).toBe(3);
    expect(audit.counts).toEqual({ human: 1, ai: 1, mixed: 1 });
    await expect(parseDatasetAudit(audit)).resolves.toEqual(audit);
    expect(audit.auditDigest).toBe(
      await computeDatasetAuditDigest({
        datasetId: audit.datasetId,
        scientificUse: audit.scientificUse,
        releaseEligible: audit.releaseEligible,
        recordCount: audit.recordCount,
        counts: audit.counts,
        sourceTypes: audit.sourceTypes,
        hardNegativeFamilies: audit.hardNegativeFamilies,
        generatorFamilies: audit.generatorFamilies,
        licenses: audit.licenses,
        recordsSha256: audit.recordsSha256,
        reviewLedgerSha256: audit.reviewLedgerSha256,
        sourceManifestSha256: audit.sourceManifestSha256,
        sealed: audit.sealed,
      }),
    );
  });

  it("detects a changed conclusion in a signed dataset audit", async () => {
    const policy = {
      ...RELEASE_CORPUS_POLICY,
      counts: { human: 1, ai: 1, mixed: 1 },
    };
    const audit = await sealDataset(
      validManifest,
      [human, ai, mixed],
      policy,
      validFileDigests,
    );
    await expect(
      parseDatasetAudit({ ...audit, recordCount: 4 }),
    ).rejects.toThrow(/auditDigest/i);
  });

  it("rejects a tampered dataset audit under a stale digest", async () => {
    const policy = {
      ...RELEASE_CORPUS_POLICY,
      counts: { human: 1, ai: 1, mixed: 1 },
    };
    const audit = await sealDataset(
      validManifest,
      [human, ai, mixed],
      policy,
      validFileDigests,
    );

    await expect(parseDatasetAudit({ ...audit, rogue: true })).rejects.toThrow(
      /unknown key.*rogue/i,
    );

    await expect(
      parseDatasetAudit({ ...audit, sealed: false }),
    ).rejects.toThrow(/sealed/i);

    await expect(
      parseDatasetAudit({
        ...audit,
        recordsSha256: audit.recordsSha256.toUpperCase(),
      }),
    ).rejects.toThrow(/recordsSha256/i);

    const licenseTampered: DatasetAudit = {
      ...audit,
      licenses: [...audit.licenses, "smuggled-license"],
    };
    await expect(parseDatasetAudit(licenseTampered)).rejects.toThrow(
      /auditDigest/i,
    );
  });
});
