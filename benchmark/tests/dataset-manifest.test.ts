import { describe, expect, it } from "vitest";

import {
  computeDatasetAuditDigest,
  emptyLabelBasisPublication,
  parseDatasetAudit,
  RELEASE_CORPUS_POLICY,
  sealDataset,
  validateDatasetManifest,
  type DatasetAudit,
  type DatasetFileDigests,
  type DatasetManifest,
} from "../dataset-manifest.ts";
import { validateBenchmarkRecordV3, type BenchmarkRecord } from "../schema.ts";
import { asGeneratorFamily } from "../generator-family.ts";
import {
  unknownAxis,
  v3Ai,
  v3Human,
  v3Mixed,
  withAxis,
} from "./helpers/v3-record-fixture.ts";

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
        labelBasisCounts: audit.labelBasisCounts,
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

// ---------------------------------------------------------------------------
// C1 — what the PUBLIC audit publishes about the evidence behind human labels,
// and what it must never publish.
// ---------------------------------------------------------------------------

describe("labelBasisCounts in the sealed audit", () => {
  const v3Manifest: DatasetManifest = {
    ...validManifest,
    licenses: [
      {
        id: "cc-by-sa-4.0",
        name: "Creative Commons Attribution-ShareAlike 4.0",
        source: "https://creativecommons.org/licenses/by-sa/4.0/",
        evaluationUseApproved: true,
        redistribution: "not-published",
        notice: "Atribuição e share-alike obrigatórios.",
      },
      {
        id: "autoria-propria-v1",
        name: "Autoria própria do operador",
        source: "declaração do operador",
        evaluationUseApproved: true,
        redistribution: "not-published",
        notice: "Gerado pelo próprio operador para avaliação interna.",
      },
    ],
  };
  const policy = {
    ...RELEASE_CORPUS_POLICY,
    counts: { human: 1, ai: 1, mixed: 1 },
  };

  function v3Corpus(): BenchmarkRecord[] {
    return [
      validateBenchmarkRecordV3(v3Human()),
      validateBenchmarkRecordV3(v3Ai()),
      validateBenchmarkRecordV3(v3Mixed()),
    ];
  }

  it("publishes the record count and the sampling units per basis", async () => {
    const audit = await sealDataset(
      v3Manifest,
      v3Corpus(),
      policy,
      validFileDigests,
    );
    // Only the human row rests on a basis, which is why the unit counts describe
    // the human negatives — the population an FPR budget is spent against.
    expect(audit.labelBasisCounts.records).toEqual({
      "date-cutoff": 1,
      "observed-process": 0,
    });
    expect(audit.labelBasisCounts.ineligible).toEqual({
      "date-cutoff": 0,
      "observed-process": 0,
    });
    expect(audit.labelBasisCounts.samplingUnits).toEqual({
      "date-cutoff": {
        author: 1,
        source: 1,
        domainSource: 1,
        collectionBatch: 1,
        nearDuplicate: 1,
      },
    });
  });

  it("counts an ineligible human row without dropping it from the basis", async () => {
    const ineligible = validateBenchmarkRecordV3(
      withAxis(v3Human(), "author", unknownAxis("HMAC keyring unavailable")),
    );
    const audit = await sealDataset(
      v3Manifest,
      [
        ineligible,
        validateBenchmarkRecordV3(v3Ai()),
        validateBenchmarkRecordV3(v3Mixed()),
      ],
      policy,
      validFileDigests,
    );
    // The row still counts toward its basis and is ALSO counted as ineligible, so
    // an eligible denominator is read rather than inferred by subtraction.
    expect(audit.labelBasisCounts.records["date-cutoff"]).toBe(1);
    expect(audit.labelBasisCounts.ineligible["date-cutoff"]).toBe(1);
    // ...and the axis that is unknown contributes no unit, which is the honest
    // count: an unrecovered identity is not a sampling unit.
    expect(
      audit.labelBasisCounts.samplingUnits["date-cutoff"]?.author,
    ).toBeUndefined();
  });

  it("publishes zeros for a v2 corpus instead of omitting the block", async () => {
    const audit = await sealDataset(
      validManifest,
      [human, ai, mixed],
      policy,
      validFileDigests,
    );
    // A v2 corpus recorded no label basis at all. Zero is the truthful value and
    // an absent block would read as "not measured", which is a different claim.
    expect(audit.labelBasisCounts).toEqual(emptyLabelBasisPublication());
    expect(audit.labelBasisCounts.records).toEqual({
      "date-cutoff": 0,
      "observed-process": 0,
    });
  });

  it("survives a digest round-trip, so the counts are inside the seal", async () => {
    const audit = await sealDataset(
      v3Manifest,
      v3Corpus(),
      policy,
      validFileDigests,
    );
    await expect(parseDatasetAudit(audit)).resolves.toEqual(audit);
    // Tampering with a published count invalidates the audit digest, which is what
    // makes the block evidence rather than decoration.
    await expect(
      parseDatasetAudit({
        ...audit,
        labelBasisCounts: {
          ...audit.labelBasisCounts,
          records: { "date-cutoff": 99, "observed-process": 0 },
        },
      }),
    ).rejects.toThrow(/auditDigest does not match/u);
  });

  // The privacy requirement, asserted against the SERIALIZED artifact rather than
  // against a field list: a new key that leaked an identity would pass a field
  // check and fail this one.
  it("carries no person identifier and no private-manifest entry", async () => {
    const audit = await sealDataset(
      v3Manifest,
      v3Corpus(),
      policy,
      validFileDigests,
    );
    const serialized = JSON.stringify(audit);
    const human0 = validateBenchmarkRecordV3(v3Human());
    const author = human0.groups.author;
    const origin = human0.groups.source;
    expect(author.state).toBe("known");
    expect(origin.state).toBe("known");
    const forbidden = [
      // the pseudonymised PERSON (HMAC of a Stack Exchange account)
      author.state === "known" ? author.id : "",
      // the origin document, which identifies a thread and thereby its posters
      origin.state === "known" ? origin.id : "",
      // the private source manifest's evidence entry, and its digest
      human0.labelEvidenceRef?.entryId ?? "",
      human0.labelEvidenceRef?.entryDigest ?? "",
      // the date field and the observed value: a per-record timestamp narrows a
      // thread to one post as effectively as its id does
      "Posts.xml@CreationDate",
      "2013-12-11T00:00:00.000Z",
    ];
    for (const token of forbidden) {
      expect(token).not.toBe("");
      expect(serialized).not.toContain(token);
    }
  });
});
