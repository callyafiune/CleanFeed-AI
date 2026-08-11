import { describe, expect, it } from "vitest";

import {
  computeDatasetAuditDigest,
  DatasetManifestError,
  emptyLabelBasisPublication,
  parseDatasetAudit,
  RELEASE_CORPUS_POLICY,
  sealDataset,
  validateDatasetManifest,
  type DatasetAudit,
  type DatasetFileDigests,
  type DatasetManifest,
} from "../dataset-manifest.ts";
import {
  recordEligibility,
  validateBenchmarkRecord,
  validateBenchmarkRecordV3,
  validateBenchmarkRecordV4,
  type BenchmarkRecord,
} from "../schema.ts";
import { asGeneratorFamily } from "../generator-family.ts";
import {
  automatedUnreviewed,
  humanReviewed,
  labelDispute,
  unknownAxis,
  v3Ai,
  v3Human,
  v3Mixed,
  v4Ai,
  v4Human,
  v4Mixed,
  withAxis,
  withReview,
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
  datasetId: "cleanfeed-ptbr-cells-v1",
  version: "1.0.0",
  scientificUse: "infrastructure-only",
  intendedLanguage: "pt-BR",
  intendedDomain: "scoped-cells",
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
  // `encyclopedic` and not `qa-informal`: A1 (2026-07-31) left that stratum with no
  // source, so no fixture stamps it and `RELEASE_CORPUS_POLICY` no longer requires it.
  humanSourceType: "encyclopedic",
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
  // The recipe that produced the AI stretches. v2 leaves it optional on a mixed
  // row, but the family in `groups` names a generator, and the schema now refuses a
  // family with no recipe behind it in either version.
  generation: {
    provider: "acme",
    family: "acme-large",
    model: "acme-large-2",
    version: "2026-05",
    promptId: "prompt_002",
    promptSha256: "2".repeat(64),
    generatedAt: 1_735_862_400_000,
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
      "cleanfeed-ptbr-cells-v1",
    );
  });

  it("rejects an unknown manifest key", () => {
    expect(() =>
      validateDatasetManifest({ ...validManifest, rogue: true }),
    ).toThrow(/unknown key.*rogue/i);
  });

  // The manifest is the reservation, and it is the likeliest door for a real
  // dotted spelling: `generation.family` carries the provider's own label, so a
  // hand-written or script-written manifest that copies it lands here. Refused,
  // never normalized into shape — a reservation nobody else can match by exact
  // equality reserves nothing, and silent correction is what let two spellings of
  // one family coexist in the corpus.
  it("refuses a reservation written in the provider's dotted spelling", () => {
    expect(() =>
      validateDatasetManifest({
        ...validManifest,
        heldOutGeneratorFamilies: ["gemini-3.5-flash-low"],
      }),
    ).toThrow(
      /heldOutGeneratorFamilies\[0\].*not in canonical form.*gemini-3_5-flash-low/u,
    );
  });

  it("refuses a reservation that normalizes to nothing at all", () => {
    expect(() =>
      validateDatasetManifest({
        ...validManifest,
        heldOutGeneratorFamilies: ["..."],
      }),
    ).toThrow(/heldOutGeneratorFamilies\[0\]/u);
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
        datasetId: "cleanfeed-ptbr-cells-v1",
        version: "1.0.0",
        scientificUse: "release",
        intendedLanguage: "pt-BR",
        intendedDomain: "scoped-cells",
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

  // The composition of the frame amendment: 4.000 human lines in the ONE declared cell,
  // 4.000 AI and 2.000 mixed. Pinned as the numbers a corpus must hold rather than by
  // reading the policy back, because `sealDataset` compares by EXACT equality and this is
  // the test that would notice the quota moving with nothing else.
  it("enforces the sealed 4k/4k/2k release quota", async () => {
    expect(RELEASE_CORPUS_POLICY.counts).toEqual({
      human: 4000,
      ai: 4000,
      mixed: 2000,
    });
    await expect(
      sealDataset(
        validManifest,
        [human, ai, mixed],
        RELEASE_CORPUS_POLICY,
        validFileDigests,
      ),
    ).rejects.toThrow(/expected human=4000, received human=1/);
    // And a composition of the PREVIOUS frame is refused by the same comparison: four
    // cells at 1.750 was 7.000 human lines, which is what a corpus assembled before the
    // amendment would carry.
    await expect(
      sealDataset(
        validManifest,
        [human, ai, mixed],
        {
          ...RELEASE_CORPUS_POLICY,
          counts: { human: 7000, ai: 4000, mixed: 2000 },
        },
        validFileDigests,
      ),
    ).rejects.toThrow(/expected human=7000, received human=1/);
  });

  it("rejects a duplicated record, by id and by normalized text", async () => {
    // A única guarda deste módulo que a auditoria por mutação achou sem teste. As duas
    // condições compartilham o código, e as duas contam: id repetido é o mesmo registro
    // entregue duas vezes, e hash repetido é o MESMO TEXTO sob dois ids — que infla a
    // contagem de suporte de uma alegação sem acrescentar evidência.
    //
    // A contagem por classe é decidida depois do laço, então acrescentar um quarto registro
    // não faz a política reclamar antes: a duplicidade recusa primeiro.
    const policy = {
      ...RELEASE_CORPUS_POLICY,
      counts: { human: 1, ai: 1, mixed: 1 },
    };
    await expect(
      sealDataset(
        validManifest,
        [human, ai, mixed, human],
        policy,
        validFileDigests,
      ),
    ).rejects.toMatchObject({ code: "DATASET_DUPLICATE" });

    const mesmoTexto: BenchmarkRecord = {
      ...human,
      id: "human-0002",
      groups: {
        ...human.groups,
        derivationRoot: "human-0002",
        nearDuplicate: "near_h_002",
      },
    };
    await expect(
      sealDataset(
        validManifest,
        [human, ai, mixed, mesmoTexto],
        policy,
        validFileDigests,
      ),
    ).rejects.toMatchObject({ code: "DATASET_DUPLICATE" });
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

// ---------------------------------------------------------------------------
// C1 correction round — the held-out coverage block must read the CANONICAL
// family through the version-aware accessor.
//
// `record.groups.generatorFamily === family` typechecks on the union (the v2 arm
// overlaps `GeneratorFamily`), so the "every unmigrated read breaks at compile
// time" net did not catch these two comparisons, and they are always false on a
// v3 record: the value there is `{ state, id }`. The consequence on a v3 release
// corpus is a misleading refusal — "requires at least 200 eligible positives"
// with all 200 positives present — and a silently dead leak check. Same defect
// class A4 fixed: two spellings that never meet.
//
// Nothing caught it because the synthetic release-corpus helper is pinned to
// `BenchmarkRecordV2`, so no test sealed a v3 release corpus at all. These do.
// ---------------------------------------------------------------------------

describe("held-out generator-family coverage on a release corpus", () => {
  const HELD_OUT = asGeneratorFamily("gemini-3_5-flash-medium");

  const releaseManifest: DatasetManifest = {
    ...validManifest,
    scientificUse: "release",
    heldOutGeneratorFamilies: [HELD_OUT],
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

  // The floor is 200 positives per reserved family, so the fixture has to reach
  // it: a smaller corpus could not tell "the accessor reads nothing" apart from
  // "the corpus is thin", which is exactly the confusion the defect produced.
  // C5 — a RELEASE corpus must substantiate its review claim, so the rows of this
  // block carry a receipt. The fixture pool is `automated/unreviewed` by default,
  // which is the honest state of every record this project actually holds; a
  // release seal is the one place that state is not enough, and giving these rows a
  // receipt is what keeps this block's subject (the held-out family FLOOR) reachable
  // instead of masked by a governance refusal. A test fixture is hypothetical data:
  // no assembler, artifact or corpus may write this shape until a real review exists.
  function v3AiRow(n: number): BenchmarkRecord {
    const raw = withReview(v3Ai(), humanReviewed("ai"));
    raw.id = `a_agy_${n.toString().padStart(4, "0")}`;
    raw.normalizedTextSha256 = n.toString(16).padStart(64, "0");
    return validateBenchmarkRecordV3(raw);
  }

  function v3HumanRow(): BenchmarkRecord {
    return validateBenchmarkRecordV3(
      withReview(v3Human(), humanReviewed("human")),
    );
  }

  function releasePolicy(aiCount: number) {
    return {
      counts: { human: 1, ai: aiCount, mixed: 0 },
      requiredHumanSourceTypes: ["encyclopedic"],
      requiredHardNegativeFamilies: [],
    };
  }

  function v3ReleaseCorpus(aiCount: number): BenchmarkRecord[] {
    const records: BenchmarkRecord[] = [v3HumanRow()];
    for (let n = 1; n <= aiCount; n += 1) records.push(v3AiRow(n));
    return records;
  }

  it("counts the positives of a held-out family on v3 records", async () => {
    const audit = await sealDataset(
      releaseManifest,
      v3ReleaseCorpus(200),
      releasePolicy(200),
      validFileDigests,
    );
    expect(audit.releaseEligible).toBe(true);
    // The tally already went through `generatorFamilyOf`; the FLOOR now reads the
    // same value, so the two agree by construction instead of by coincidence.
    expect(audit.generatorFamilies[HELD_OUT]).toBe(200);
  });

  it("still refuses a held-out family that misses the positives floor", async () => {
    // The counting direction, pinned from below: 199 v3 positives are counted as
    // 199 and refused, not counted as 0 and refused for the wrong reason.
    await expect(
      sealDataset(
        releaseManifest,
        v3ReleaseCorpus(199),
        releasePolicy(199),
        validFileDigests,
      ),
    ).rejects.toThrow(/requires at least 200 eligible positives/u);
  });

  // The floor's message has always promised "eligible positives" while the
  // counter applied no eligibility filter at all. That was harmless on v2, which
  // has no `unknown` axis state to fail on, and unreachable on v3 while the
  // comparison read the raw axis and counted 0 — so fixing the counting is what
  // opened it. The counting half is pinned above (200 and 199); these pin the
  // eligibility half.
  function ineligibleV3AiRow(n: number): BenchmarkRecord {
    const raw = withAxis(
      withReview(v3Ai(), humanReviewed("ai")),
      "humanSeed",
      // A real gap and the honest state for it: the row's human seed was not
      // recovered, so under R6 the record is INELIGIBLE and is never given a
      // synthesized one. `humanSeed` admits `unknown` on an `ai` row, so the
      // record is valid — it is the FLOOR that must not count it.
      unknownAxis("the human seed was not recovered"),
    );
    raw.id = `a_agy_${n.toString().padStart(4, "0")}`;
    raw.normalizedTextSha256 = n.toString(16).padStart(64, "0");
    return validateBenchmarkRecordV3(raw);
  }

  it("refuses a reserved family whose 200 positives are all ineligible", async () => {
    const records: BenchmarkRecord[] = [v3HumanRow()];
    for (let n = 1; n <= 200; n += 1) records.push(ineligibleV3AiRow(n));
    // The rows are present, valid and of the reserved family — and every one of
    // them carries an `unknown` grouping axis, so none can be placed in a split
    // cluster or a resampling unit. Certifying the reservation on them would be
    // §3.3's empty-unseen-generator failure arriving THROUGH the gate.
    expect(recordEligibility(records[1]!).eligible).toBe(false);
    await expect(
      sealDataset(
        releaseManifest,
        records,
        releasePolicy(200),
        validFileDigests,
      ),
    ).rejects.toThrow(
      /requires at least 200 eligible positives, received 0 eligible of 200 positive rows/u,
    );
  });

  // C5 quality round — the REVIEW-CLAIM refusal on a corpus whose shortfall is NOT
  // the automated filter, which is the case the sentence used to misdescribe.
  //
  // The refusal closed with "A record whose only governance is the automated filter
  // is automated/unreviewed — legitimate in the corpus, and it never counts toward a
  // gate that requires review": true of one of the four reasons and printed for all
  // four, so a corpus refused solely over `1 label-disputed` got a diagnosis about a
  // filter that had nothing to do with it. My previous round filed the corpus-level
  // test as blocked on migrating the synthetic release helper to v3; that was wrong,
  // and the fixture above is the refutation — `v3ReleaseCorpus` is a fully reviewed
  // v3 release corpus that SEALS, so one disputed row is the whole cost.
  function disputedV3AiRow(n: number): BenchmarkRecord {
    const raw = withReview(
      v3Ai(),
      humanReviewed("human", { labelDispute: labelDispute("human", "ai") }),
    );
    raw.id = `a_agy_${n.toString().padStart(4, "0")}`;
    raw.normalizedTextSha256 = n.toString(16).padStart(64, "0");
    return validateBenchmarkRecordV3(raw);
  }

  it("refuses a release corpus over one disputed row, with the dispute's own action", async () => {
    const records = v3ReleaseCorpus(200);
    // Replaces the last positive rather than adding one, so the label counts and
    // the held-out family's 200 are untouched: the ONLY thing that changes is that
    // one row's two blind reviewers contradict its provenance-derived label.
    records[records.length - 1] = disputedV3AiRow(200);
    const attempt = sealDataset(
      releaseManifest,
      records,
      releasePolicy(200),
      validFileDigests,
    );
    await expect(attempt).rejects.toThrow(
      /1 of 201 sustain no review claim \(1 label-disputed\), first a_agy_0200/u,
    );
    // The action belongs to the reason: this row needs the label's own evidence
    // re-derived or the row withdrawn (D1/D5), which no record can do for itself.
    await expect(attempt).rejects.toThrow(/nothing in a record resolves it/u);
    // And the automated filter's sentence is ABSENT, because no row of this corpus
    // is `automated/unreviewed`. This is the direction that was broken.
    await expect(attempt).rejects.not.toThrow(
      /only governance is the automated filter/u,
    );
  });

  // The OTHER half of `REVIEW_SHORTFALL_ACTION`'s promise. The test above pins
  // "never the acts of reasons absent"; this one pins "the act that answers EACH
  // reason present", which nothing pinned: replacing `reasons.map(...)` with
  // `reasons.slice(0, 1).map(...)` type-checks (tsc exit 0) and left
  // `benchmark/tests/` at 35 files / 727 tests green, because both assertions on
  // this message covered a corpus with exactly ONE distinct reason, so neither the
  // map nor the sort over more than one element was ever exercised. An operator
  // refused for two reasons was then told the act for one of them, silently.
  //
  // Two rows, two reasons, and the mixture is the honest one rather than a
  // contrivance: a corpus mid-review has rows nobody reached yet
  // (`automated/unreviewed`) beside rows whose reviewers dissent from the label
  // (`label-disputed`), and the two need OPPOSITE acts — assign a reviewer versus
  // re-derive the label's evidence or withdraw the row.
  function unreviewedV3AiRow(n: number): BenchmarkRecord {
    const raw = withReview(v3Ai(), automatedUnreviewed());
    raw.id = `a_agy_${n.toString().padStart(4, "0")}`;
    raw.normalizedTextSha256 = n.toString(16).padStart(64, "0");
    return validateBenchmarkRecordV3(raw);
  }

  it("names the act of every reason present, in the breakdown's order", async () => {
    const records = v3ReleaseCorpus(200);
    // Replaces two positives rather than adding any, so the label counts and the
    // held-out family's 200 are untouched and the FLOOR still passes: review state
    // is not eligibility, so both rows still count toward the reservation.
    //
    // The DISPUTED row is placed FIRST on purpose, so that encounter order
    // (label-disputed, automated-filter-only) is the reverse of sorted order. That is
    // what makes the assertion below pin the sort: with the comparator dropped the
    // breakdown would read `1 label-disputed, 1 automated-filter-only`. If both rows
    // were in sorted order to begin with, dropping the sort would change nothing and
    // the assertion would be pinning the fixture instead of the code.
    records[records.length - 2] = disputedV3AiRow(199);
    records[records.length - 1] = unreviewedV3AiRow(200);
    const attempt = sealDataset(
      releaseManifest,
      records,
      releasePolicy(200),
      validFileDigests,
    );
    // Three properties in one assertion, each independently mutable: the count, the
    // breakdown sorted by reason NAME, and `first` reported in RECORD order — the
    // disputed row, which is second by reason and first by position, so the message
    // cannot be reading one order for both.
    await expect(attempt).rejects.toThrow(
      /2 of 201 sustain no review claim \(1 automated-filter-only, 1 label-disputed\), first a_agy_0199/u,
    );
    // Both acts, each identified by a phrase unique to it. This pair is what kills
    // the `slice(0, 1)` mutation.
    await expect(attempt).rejects.toThrow(
      /only governance is the automated filter/u,
    );
    await expect(attempt).rejects.toThrow(/nothing in a record resolves it/u);
    // And they are two SENTENCES. The acts carried no terminal punctuation and were
    // joined with a space, so they fused at "requires review A record whose" — a
    // run-on in the sole operator-facing diagnosis of this gate, which is where a
    // reader stops trusting the message. Asserting the boundary rather than the
    // period alone, because the property is that the join cannot swallow it.
    await expect(attempt).rejects.toThrow(
      /requires review\. A record whose blind reviewers/u,
    );
  });

  it("counts the eligible positives and names both numbers", async () => {
    // One ineligible row inside an otherwise complete family: the refusal has to
    // say 199 of 200, not "0" and not "200". Pinning both numbers is what stops a
    // later edit from swapping the population and leaving the message true.
    const records: BenchmarkRecord[] = [v3HumanRow()];
    for (let n = 1; n <= 199; n += 1) records.push(v3AiRow(n));
    records.push(ineligibleV3AiRow(200));
    await expect(
      sealDataset(
        releaseManifest,
        records,
        releasePolicy(200),
        validFileDigests,
      ),
    ).rejects.toThrow(
      /requires at least 200 eligible positives, received 199 eligible of 200 positive rows/u,
    );
  });

  // UPDATED BY C5, and the update is the point rather than a casualty.
  //
  // This test used to assert that a complete v2 release corpus SEALS
  // (`releaseEligible: true`). It cannot any more, and that is the result C5 set out
  // to produce: every one of those rows declares `agreement: "agree"` and a passed
  // PII audit that never happened, `reviewOf` reads the v2 annotation block as
  // `automated/unreviewed`, and a release corpus with no review receipt on any row
  // sustains no review claim. Reproved gates are the correct outcome of removing
  // fabricated governance, not a regression to accommodate (R3: the gate was not
  // relaxed; a real review is the missing input, and it belongs to D1/D5).
  //
  // What the test still has to pin is what it always pinned — that the held-out
  // FLOOR counts v2 positives on presence and reaches 200 rather than zeroing them.
  // The floor check runs BEFORE the review claim (it names one family; the review
  // claim names a count over the corpus), so the refusal below proves the floor did
  // not fire: with the eligibility filter widened to v2 the message would be the
  // floor's, not the review's. The two sibling tests immediately after this one pin
  // the floor's own sentence on v2 directly.
  it("refuses a v2 release corpus for its simulated review, after the floor accepted it", async () => {
    // The reason the eligibility filter is asked of v3 rows ONLY, pinned so nobody
    // widens it. On v2 `recordEligibility` is constant false for structural reasons
    // rather than per-record ones: `groups` is a closed object of nine keys with no
    // `humanSeed`, `generationLane` or `harnessVersion`, so those three read as
    // `unknown` on every v2 record ever written.
    expect(recordEligibility(ai).eligible).toBe(false);
    expect(recordEligibility(ai).unknownAxes).toContain("humanSeed");
    const reserved = asGeneratorFamily("heldout_family");
    const v2Positives: BenchmarkRecord[] = [];
    for (let n = 1; n <= 200; n += 1) {
      v2Positives.push({
        ...ai,
        id: `ai-v2-${n.toString().padStart(4, "0")}`,
        normalizedTextSha256: n.toString(16).padStart(64, "0"),
        // A4's rule holds in v2 too: the canonical axis must be the canonical
        // form of the recipe's own label, so BOTH move together.
        generation: { ...ai.generation!, family: reserved },
        groups: { ...ai.groups, generatorFamily: reserved },
      });
    }
    const attempt = sealDataset(
      { ...validManifest, scientificUse: "release" },
      [human, ...v2Positives],
      {
        counts: { human: 1, ai: 200, mixed: 0 },
        requiredHumanSourceTypes: ["encyclopedic"],
        requiredHardNegativeFamilies: [],
      },
      validFileDigests,
    );
    await expect(attempt).rejects.toThrow(
      /201 of 201 sustain no review claim \(201 automated-filter-only\)/u,
    );
    // Both halves: the review claim is what refused it, and the FLOOR did not —
    // 200 positives of the reserved family were counted, on presence.
    await expect(attempt).rejects.not.toThrow(/positives/u);
  });

  it("still counts a v2 corpus's reserved positives while refusing the corpus", async () => {
    // The tally itself, on the version whose rows state no eligibility. Read off an
    // `infrastructure-only` seal, which is the honest shape for a corpus of
    // `automated/unreviewed` rows: the review claim is a RELEASE claim, so a
    // diagnostic corpus seals and publishes its counts.
    const reserved = asGeneratorFamily("heldout_family");
    const v2Positives: BenchmarkRecord[] = [];
    for (let n = 1; n <= 200; n += 1) {
      v2Positives.push({
        ...ai,
        id: `ai-v2-${n.toString().padStart(4, "0")}`,
        normalizedTextSha256: n.toString(16).padStart(64, "0"),
        generation: { ...ai.generation!, family: reserved },
        groups: { ...ai.groups, generatorFamily: reserved },
      });
    }
    const audit = await sealDataset(
      validManifest,
      [human, ...v2Positives],
      {
        counts: { human: 1, ai: 200, mixed: 0 },
        requiredHumanSourceTypes: ["encyclopedic"],
        requiredHardNegativeFamilies: [],
      },
      validFileDigests,
    );
    expect(audit.releaseEligible).toBe(false);
    expect(audit.generatorFamilies[reserved]).toBe(200);
  });

  // C1 second correction round — the refusal SENTENCE, on the version that
  // cannot state eligibility.
  //
  // `countsTowardHeldOutFloor` returns true for every non-v3 row, so on a v2
  // corpus the counted number equals the row count and the message printed it as
  // "N eligible of N positive rows" — asserting eligibility for rows this same
  // module reports as INELIGIBLE (the test above asserts
  // `recordEligibility(ai).eligible === false` on exactly such a row, with six
  // unknown axes). That is the over-claim this round set out to remove, surviving
  // in the one place an operator actually reads. The docstring's honest wording —
  // "a v2 corpus is judged by the only criterion its schema can express, presence"
  // — never reached the sentence.
  it("does not call a v2 corpus's positives eligible when it refuses them", async () => {
    const reserved = asGeneratorFamily("heldout_family");
    const thin: BenchmarkRecord[] = [];
    for (let n = 1; n <= 5; n += 1) {
      thin.push({
        ...ai,
        id: `ai-v2-thin-${n}`,
        normalizedTextSha256: n.toString(16).padStart(64, "0"),
        generation: { ...ai.generation!, family: reserved },
        groups: { ...ai.groups, generatorFamily: reserved },
      });
    }
    const attempt = sealDataset(
      { ...validManifest, scientificUse: "release" },
      [human, ...thin],
      {
        counts: { human: 1, ai: 5, mixed: 0 },
        requiredHumanSourceTypes: ["encyclopedic"],
        requiredHardNegativeFamilies: [],
      },
      validFileDigests,
    );
    // Both halves are asserted, because either alone is satisfiable by a wrong
    // fix: the count and denominator still have to be right, AND the word
    // "eligible" must be absent from a claim about rows that state no eligibility.
    await expect(attempt).rejects.toThrow(
      /requires at least 200 positives, received 5 of 5 positive rows \(no positive row states eligibility: schemaVersion 2 has no axis states, so the floor is judged on presence\)/u,
    );
    await expect(attempt).rejects.not.toThrow(/eligible positives/u);
  });

  it("names both populations when one corpus mixes the two schema versions", async () => {
    // The third state, and it is reachable in exactly one direction: a v3 record
    // and a v2 record cannot share a JSONL (`parseBenchmarkDataset` refuses a
    // mixed dataset), but `sealDataset` takes an ARRAY, and the calibration and
    // preflight paths build theirs in memory. So the sentence must not silently
    // pick one of the two rules for a population judged under both.
    const reserved = asGeneratorFamily("gemini-3_5-flash-medium");
    const v2Positive: BenchmarkRecord = {
      ...ai,
      id: "ai-v2-mixed-1",
      normalizedTextSha256: "f".repeat(64),
      generation: { ...ai.generation!, family: reserved },
      groups: { ...ai.groups, generatorFamily: reserved },
    };
    await expect(
      sealDataset(
        {
          ...releaseManifest,
          // Both fixture pools' licences, because the corpus draws on both.
          licenses: [...releaseManifest.licenses, ...validManifest.licenses],
        },
        [v3HumanRow(), v3AiRow(1), v2Positive],
        {
          counts: { human: 1, ai: 2, mixed: 0 },
          requiredHumanSourceTypes: ["encyclopedic"],
          requiredHardNegativeFamilies: [],
        },
        validFileDigests,
      ),
    ).rejects.toThrow(
      /requires at least 200 positives, received 2 of 2 positive rows \(1 judged by eligibility, 1 of schemaVersion 2 judged on presence\)/u,
    );
  });

  it("refuses a v2 human record that names a reserved family, at the record schema", async () => {
    // The leak now fails on the RECORD, not on the corpus, and that is the whole
    // point of imposing the family/recipe coherence in both directions: a human row
    // carrying a generator family is refused whatever the corpus is for, whereas
    // `sealDataset`'s coverage guard runs only for `scientificUse: "release"` — so a
    // non-release corpus used to accept the row and let it into the
    // `generatorExposure` denominator.
    const leaked: BenchmarkRecord = {
      ...human,
      groups: {
        ...human.groups,
        generatorFamily: asGeneratorFamily("heldout_family"),
      },
    };
    for (const scientificUse of ["release", "infrastructure-only"] as const) {
      await expect(
        sealDataset(
          { ...validManifest, scientificUse },
          [leaked, ai, mixed],
          {
            counts: { human: 1, ai: 1, mixed: 1 },
            requiredHumanSourceTypes: ["encyclopedic"],
            requiredHardNegativeFamilies: ["formulaic"],
          },
          validFileDigests,
        ),
      ).rejects.toThrow(
        /groups\.generatorFamily is "heldout_family" on a record that carries no generation recipe/u,
      );
    }
  });

  it("refuses the same leak on a v3 record too, at the axis rule", () => {
    // v3 reaches the same outcome through a different door: `AXIS_STATE_RULE` allows
    // only `notApplicable` for `generatorFamily` on a human row. Both versions now
    // refuse the record itself, which is why `sealDataset`'s `appearsInHuman` guard
    // is no longer the thing standing between a reserved family and the negatives —
    // it is a second line no current path reaches.
    expect(() =>
      validateBenchmarkRecordV3(
        withAxis(v3Human(), "generatorFamily", {
          state: "known",
          id: "gemini-3_5-flash-medium",
        }),
      ),
    ).toThrow(
      /groups\.generatorFamily of a human record must be notApplicable/u,
    );
  });
});

// ---------------------------------------------------------------------------
// The v4 half of every block above.
//
// Each guard in this module asks "is this v2", never "is this v3", and the two
// predicates are extensionally IDENTICAL on v2 and v3 — only a v4 record separates
// them. Without a v4 fixture the whole file is blind to the difference: reverting
// `=== 2` to `!== 3` leaves the suite green while a v4 corpus publishes an empty
// label basis and certifies a reserved family on rows the same module calls
// ineligible.
// ---------------------------------------------------------------------------

describe("the sealed audit judges a v4 corpus by the axes v4 declares", () => {
  const HELD_OUT_V4 = asGeneratorFamily("gemini-3_5-flash-medium");

  const twoLicenses = [
    {
      id: "cc-by-sa-4.0",
      name: "Creative Commons Attribution-ShareAlike 4.0",
      source: "https://creativecommons.org/licenses/by-sa/4.0/",
      evaluationUseApproved: true as const,
      redistribution: "not-published" as const,
      notice: "Atribuição e share-alike obrigatórios.",
    },
    {
      id: "autoria-propria-v1",
      name: "Autoria própria do operador",
      source: "declaração do operador",
      evaluationUseApproved: true as const,
      redistribution: "not-published" as const,
      notice: "Gerado pelo próprio operador para avaliação interna.",
    },
  ];

  const v4Manifest: DatasetManifest = {
    ...validManifest,
    licenses: twoLicenses,
  };

  const v4ReleaseManifest: DatasetManifest = {
    ...validManifest,
    scientificUse: "release",
    heldOutGeneratorFamilies: [HELD_OUT_V4],
    licenses: twoLicenses,
  };

  function v4AiRow(n: number, axisPatch?: [string, unknown]): BenchmarkRecord {
    let raw = withReview(v4Ai(), humanReviewed("ai"));
    if (axisPatch !== undefined)
      raw = withAxis(raw, axisPatch[0], axisPatch[1]);
    raw.id = `a_agy_${n.toString().padStart(4, "0")}`;
    raw.normalizedTextSha256 = n.toString(16).padStart(64, "0");
    return validateBenchmarkRecordV4(raw);
  }

  function v4ReleaseCorpus(
    aiCount: number,
    axisPatch?: [string, unknown],
  ): BenchmarkRecord[] {
    const records: BenchmarkRecord[] = [
      validateBenchmarkRecordV4(withReview(v4Human(), humanReviewed("human"))),
    ];
    for (let n = 1; n <= aiCount; n += 1) records.push(v4AiRow(n, axisPatch));
    return records;
  }

  const releasePolicyV4 = (aiCount: number) => ({
    counts: { human: 1, ai: aiCount, mixed: 0 },
    requiredHumanSourceTypes: ["encyclopedic"],
    requiredHardNegativeFamilies: [],
  });

  it("publishes the label basis of a v4 corpus, over the axes v4 has", async () => {
    const audit = await sealDataset(
      v4Manifest,
      [
        validateBenchmarkRecordV4(v4Human()),
        validateBenchmarkRecordV4(v4Ai()),
        validateBenchmarkRecordV4(v4Mixed()),
      ],
      { ...RELEASE_CORPUS_POLICY, counts: { human: 1, ai: 1, mixed: 1 } },
      validFileDigests,
    );
    // Publishing this block only for v3 would report a v4 corpus as having recorded
    // no label basis at all — the same over-claim as the v2 zeros, with the versions
    // swapped, and this time FALSE rather than merely uninformative.
    expect(audit.labelBasisCounts.records).toEqual({
      "date-cutoff": 1,
      "observed-process": 0,
    });
    const units = audit.labelBasisCounts.samplingUnits["date-cutoff"];
    // The three axes v4 introduces are counted, and the axis it retired is absent.
    // Collecting over a pinned v3 tuple loses them; emitting over one keeps them out
    // of the published block after collecting them — two different mutations, both
    // visible here.
    expect(units).toEqual({
      author: 1,
      source: 1,
      domainSource: 1,
      sourceMaterialBatch: 1,
      extractionRun: 1,
      nearDuplicate: 1,
    });
    expect(units).not.toHaveProperty("collectionBatch");
  });

  it("counts the positives of a v4 held-out family by eligibility", async () => {
    const audit = await sealDataset(
      v4ReleaseManifest,
      v4ReleaseCorpus(200),
      releasePolicyV4(200),
      validFileDigests,
    );
    expect(audit.releaseEligible).toBe(true);
    expect(audit.generatorFamilies[HELD_OUT_V4]).toBe(200);
  });

  it("refuses a v4 reserved family whose 200 positives are all ineligible", async () => {
    // The floor's promise is "eligible positives". Judged by presence instead, these
    // 200 rows certify a reservation on records that cannot enter a split cluster or
    // a resampling unit — §3.3's empty-unseen-generator failure arriving THROUGH the
    // gate, on the version the corpus will actually be written in.
    const records = v4ReleaseCorpus(200, [
      "humanSeed",
      unknownAxis("the human seed was not recovered"),
    ]);
    expect(recordEligibility(records[1]!).eligible).toBe(false);
    await expect(
      sealDataset(
        v4ReleaseManifest,
        records,
        releasePolicyV4(200),
        validFileDigests,
      ),
    ).rejects.toThrow(
      /requires at least 200 eligible positives, received 0 eligible of 200 positive rows/u,
    );
  });

  it("names eligibility as the criterion when a v4 family is thin", async () => {
    // Every row of a v4 corpus STATES eligibility, so the shortfall says "eligible"
    // and says it truthfully. Read as v3-only, `stateEligibility` would be 0 and an
    // operator would be told "no positive row states eligibility: schemaVersion 2 has
    // no axis states" about a corpus with no v2 row in it.
    await expect(
      sealDataset(
        v4ReleaseManifest,
        v4ReleaseCorpus(199),
        releasePolicyV4(199),
        validFileDigests,
      ),
    ).rejects.toThrow(
      /requires at least 200 eligible positives, received 199 eligible of 199 positive rows/u,
    );
  });
});

describe("the ratified composition is not written twice with two values", () => {
  it("makes every evaluator file that states the human count state RELEASE_CORPUS_POLICY.counts", async () => {
    // A comment cannot be muted, so a frozen count written in prose inside
    // `EVALUATOR_FILES` ages in silence: its bytes decide the `evaluatorDigest` while no
    // test reads them. Two members carried the retired composition for a whole amendment
    // — `split-audit.ts` said 7000 human records and a 1400-line blind block, and
    // `viability-preflight.ts` said 7.000 — with the suite green. This sweep is the read.
    const { readdir, readFile } = await import("node:fs/promises");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const benchmarkDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    // Every module of the bench, not only `EVALUATOR_FILES`: the twin that states the
    // same composition (`viability-preflight.ts`) is NOT an evaluator file, and a sweep
    // scoped to the digest would have left exactly the copy that drifted unread.
    const modules = [
      ...(await readdir(benchmarkDir)).map((name) => `benchmark/${name}`),
      ...(await readdir(resolve(benchmarkDir, "commands"))).map(
        (name) => `benchmark/commands/${name}`,
      ),
    ];
    const repoRoot = resolve(benchmarkDir, "..");
    // Both phrasings the two files use, and a count with either separator: the point is
    // to catch the NUMBER, so the pattern may not be stricter than the prose.
    const patterns = [
      /composition is ([\d_.]+) human/gu,
      /composition \(([\d_.]+) human/gu,
    ];
    let found = 0;
    for (const relativePath of modules) {
      if (!relativePath.endsWith(".ts")) continue;
      const body = await readFile(resolve(repoRoot, relativePath), "utf8");
      for (const pattern of patterns) {
        for (const match of body.matchAll(pattern)) {
          found += 1;
          expect(
            Number(match[1].replaceAll(/[_.]/gu, "")),
            `${relativePath}: ${match[0]}`,
          ).toBe(RELEASE_CORPUS_POLICY.counts.human);
        }
      }
    }
    // Non-vacuous: if the prose is reworded so no pattern matches, this fails instead of
    // passing over an empty sweep.
    expect(found).toBeGreaterThanOrEqual(2);
  });
});

// THE FRAME IS A PARTITION, not a checklist of cells that hold at least one row.
//
// The release claim is published as one row per declared quota cell, and the
// denominator of each row IS the cell. A human row that declares no cell of the
// frame is in no row of that table: the split audit, the slices and the composition
// gate all drop it without a word, so no published ceiling covers it and no
// `fpr-<cell>` hypothesis is ever raised about it. Coverage read as presence lets ONE
// row in a cell stand for four thousand.
//
// Two guards, in cause-then-consequence order: every human row declares a cell of
// the frame, and every cell of the frame holds a human row. Neither subsumes the
// other — all rows in cell A leaves cell B empty, one row in each cell leaves the
// rest with nothing — and both are priced only on a `release` corpus.
describe("the declared frame partitions the human class of a release corpus", () => {
  const HELD_OUT = asGeneratorFamily("gemini-3_5-flash-medium");

  const frameLicenses = [
    {
      id: "cc-by-sa-4.0",
      name: "Creative Commons Attribution-ShareAlike 4.0",
      source: "https://creativecommons.org/licenses/by-sa/4.0/",
      evaluationUseApproved: true as const,
      redistribution: "not-published" as const,
      notice: "Atribuição e share-alike obrigatórios.",
    },
    {
      id: "autoria-propria-v1",
      name: "Autoria própria do operador",
      source: "declaração do operador",
      evaluationUseApproved: true as const,
      redistribution: "not-published" as const,
      notice: "Gerado pelo próprio operador para avaliação interna.",
    },
    ...validManifest.licenses,
  ];

  const frameReleaseManifest: DatasetManifest = {
    ...validManifest,
    scientificUse: "release",
    heldOutGeneratorFamilies: [HELD_OUT],
    licenses: frameLicenses,
  };

  const frameInfraManifest: DatasetManifest = {
    ...validManifest,
    heldOutGeneratorFamilies: [HELD_OUT],
    licenses: frameLicenses,
  };

  // `undefined` is the row that declares NO cell; a string is the cell it declares,
  // inside the frame or outside it. The two are different populations of the same
  // guard, so one builder produces both.
  function v3HumanRow(n: number, cell: string | undefined): BenchmarkRecord {
    const raw = withReview(v3Human(), humanReviewed("human"));
    raw.id = `h_ptwk_${n.toString().padStart(4, "0")}`;
    raw.normalizedTextSha256 = (0x1_00_00 + n).toString(16).padStart(64, "0");
    if (cell === undefined) delete raw.humanSourceType;
    else raw.humanSourceType = cell;
    return validateBenchmarkRecordV3(raw);
  }

  function v3AiRow(n: number, cell?: string): BenchmarkRecord {
    const raw = withReview(v3Ai(), humanReviewed("ai"));
    raw.id = `a_agy_${n.toString().padStart(4, "0")}`;
    raw.normalizedTextSha256 = n.toString(16).padStart(64, "0");
    if (cell !== undefined) raw.humanSourceType = cell;
    return validateBenchmarkRecordV3(raw);
  }

  function v3MixedRow(): BenchmarkRecord {
    return validateBenchmarkRecordV3(
      withReview(v3Mixed(), humanReviewed("mixed")),
    );
  }

  // 200 positives of the reserved family is the held-out floor, so a corpus meant to
  // SEAL has to carry them; every corpus in this block is built to seal so that a
  // refusal is attributable to the frame and to nothing else.
  const AI_ROWS = 200;

  function frameCorpus(
    humanCells: ReadonlyArray<string | undefined>,
    options: { aiCell?: string; withMixed?: boolean } = {},
  ): BenchmarkRecord[] {
    const records: BenchmarkRecord[] = humanCells.map((cell, index) =>
      v3HumanRow(index + 1, cell),
    );
    for (let n = 1; n <= AI_ROWS; n += 1) {
      records.push(v3AiRow(n, n === 1 ? options.aiCell : undefined));
    }
    if (options.withMixed === true) records.push(v3MixedRow());
    return records;
  }

  function framePolicy(
    humanCount: number,
    cells: readonly string[],
    options: { mixed?: number } = {},
  ) {
    return {
      counts: { human: humanCount, ai: AI_ROWS, mixed: options.mixed ?? 0 },
      requiredHumanSourceTypes: cells,
      requiredHardNegativeFamilies: [],
    };
  }

  it("seals a release corpus whose every human row declares a declared cell", async () => {
    const audit = await sealDataset(
      frameReleaseManifest,
      frameCorpus(["encyclopedic", "encyclopedic", "encyclopedic"]),
      framePolicy(3, ["encyclopedic"]),
      validFileDigests,
    );
    expect(audit.releaseEligible).toBe(true);
    expect(audit.sourceTypes).toEqual({ encyclopedic: 3 });
  });

  it("refuses a release corpus whose human rows declare no quota cell", async () => {
    await expect(
      sealDataset(
        frameReleaseManifest,
        frameCorpus(["encyclopedic", undefined, undefined]),
        framePolicy(3, ["encyclopedic"]),
        validFileDigests,
      ),
    ).rejects.toThrow(
      /requires every human row to declare one of its quota cells: 2 of 3 human rows declare none \(2 \(none declared\)\), first h_ptwk_0002; declared cells: encyclopedic\./u,
    );
  });

  it("does not mint an audit for a corpus it refuses", async () => {
    // The refusal has to REPLACE the audit, not annotate it: a `sealed: true` object
    // is admitted downstream by `runSplit` on its own, so a guard that resolved with a
    // warning would be a guard that seals.
    const settled: unknown = await sealDataset(
      frameReleaseManifest,
      frameCorpus(["encyclopedic", undefined, undefined]),
      framePolicy(3, ["encyclopedic"]),
      validFileDigests,
    ).then(
      (audit) => audit,
      (error: unknown) => error,
    );
    expect(settled).toBeInstanceOf(DatasetManifestError);
    expect((settled as DatasetManifestError).code).toBe(
      "DATASET_COVERAGE_INVALID",
    );
    expect(settled).not.toHaveProperty("sealed");
  });

  it("counts every human row outside the frame, not the first", async () => {
    await expect(
      sealDataset(
        frameReleaseManifest,
        frameCorpus(["encyclopedic", undefined, undefined]),
        framePolicy(3, ["encyclopedic"]),
        validFileDigests,
      ),
    ).rejects.toThrow(/2 of 3 human rows declare none/u);
  });

  it("names every observed spelling outside the frame, in order", async () => {
    // Both populations and TWO spellings inside the second one, because a breakdown
    // truncated to its first entry is indistinguishable from a whole one when only a
    // single spelling is offending. The row that declares nothing comes first, being
    // the coarser failure, and the declared spellings follow sorted.
    await expect(
      sealDataset(
        frameReleaseManifest,
        frameCorpus(["ptwiki", undefined, "institutional", "encyclopedic"]),
        framePolicy(4, ["ptwiki"]),
        validFileDigests,
      ),
    ).rejects.toThrow(
      /3 of 4 human rows declare none \(1 \(none declared\), 1 encyclopedic, 1 institutional\), first h_ptwk_0002/u,
    );
  });

  it("does not offer a frame amendment when every offending row is merely missing the field", async () => {
    const settled: unknown = await sealDataset(
      frameReleaseManifest,
      frameCorpus(["encyclopedic", undefined, undefined]),
      framePolicy(3, ["encyclopedic"]),
      validFileDigests,
    ).then(
      (audit) => audit,
      (error: unknown) => error,
    );
    const message = (settled as Error).message;
    expect(message).toMatch(
      /receives the cell of the material it was drawn from/u,
    );
    // A corpus whose rows merely omit the field has no cell to amend the frame WITH,
    // so offering the amendment would send an operator to the wrong file.
    expect(message).not.toMatch(/the frame is amended/u);
  });

  it("names both acts when both populations are present", async () => {
    const settled: unknown = await sealDataset(
      frameReleaseManifest,
      frameCorpus(["ptwiki", undefined, "encyclopedic"]),
      framePolicy(3, ["ptwiki"]),
      validFileDigests,
    ).then(
      (audit) => audit,
      (error: unknown) => error,
    );
    const message = (settled as Error).message;
    expect(message).toMatch(
      /receives the cell of the material it was drawn from/u,
    );
    expect(message).toMatch(/the frame is amended to declare that cell/u);
  });

  it("bounds the spelling breakdown and says how many it left out", async () => {
    const five = ["cell_a", "cell_b", "cell_c", "cell_d", "cell_e"];
    const atLimit: unknown = await sealDataset(
      frameReleaseManifest,
      frameCorpus(five),
      framePolicy(five.length, ["ptwiki"]),
      validFileDigests,
    ).then(
      (audit) => audit,
      (error: unknown) => error,
    );
    // At the limit the breakdown is whole and says nothing about omissions.
    expect((atLimit as Error).message).toMatch(
      /5 of 5 human rows declare none \(1 cell_a, 1 cell_b, 1 cell_c, 1 cell_d, 1 cell_e\), first/u,
    );
    expect((atLimit as Error).message).not.toMatch(/more spellings/u);

    const overLimit: unknown = await sealDataset(
      frameReleaseManifest,
      frameCorpus([...five, "cell_f"]),
      framePolicy(five.length + 1, ["ptwiki"]),
      validFileDigests,
    ).then(
      (audit) => audit,
      (error: unknown) => error,
    );
    // One past the limit the sentence truncates AND says so. A breakdown that
    // truncated in silence would be worse than no breakdown: it is the only text an
    // operator reads, and it would report five offending spellings out of six.
    expect((overLimit as Error).message).toMatch(
      /6 of 6 human rows declare none \(1 cell_a, 1 cell_b, 1 cell_c, 1 cell_d, 1 cell_e, \+1 more spellings\), first/u,
    );
    expect((overLimit as Error).message).not.toMatch(/cell_f/u);
  });

  it("refuses a release corpus whose SECOND declared cell holds no human row", async () => {
    // Every declared cell, not the first one: a policy with two cells and every human
    // row in the first is a corpus whose second published row has an empty
    // denominator, and membership alone says nothing about it.
    await expect(
      sealDataset(
        frameReleaseManifest,
        frameCorpus(["encyclopedic", "encyclopedic"]),
        framePolicy(2, ["encyclopedic", "institutional"]),
        validFileDigests,
      ),
    ).rejects.toThrow(
      /release corpus is missing required human source type "institutional"/u,
    );
    // The same corpus with one row moved into the second cell seals, so the empty
    // cell is the whole of the cost.
    const audit = await sealDataset(
      frameReleaseManifest,
      frameCorpus(["encyclopedic", "institutional"]),
      framePolicy(2, ["encyclopedic", "institutional"]),
      validFileDigests,
    );
    expect(audit.releaseEligible).toBe(true);
  });

  it("names the rows outside the frame before the empty cell, when both hold", async () => {
    // Both guards fire on this corpus. The one that speaks is membership, because the
    // rows that declare no cell are WHY both cells are empty; the empty cell alone
    // would send an operator looking for material to collect.
    const settled: unknown = await sealDataset(
      frameReleaseManifest,
      frameCorpus([undefined, undefined]),
      framePolicy(2, ["encyclopedic", "institutional"]),
      validFileDigests,
    ).then(
      (audit) => audit,
      (error: unknown) => error,
    );
    expect((settled as Error).message).toMatch(
      /requires every human row to declare one of its quota cells: 2 of 2/u,
    );
    expect((settled as Error).message).not.toMatch(
      /missing required human source type/u,
    );
  });

  it("refuses a release corpus whose only row in a declared cell is generated", async () => {
    // The cell's denominator is the HUMAN class. A generated row may carry a
    // `humanSourceType` — the schema allows it and the published table counts it —
    // and it can produce no false positive, so it fills no cell of the FPR table.
    await expect(
      sealDataset(
        frameReleaseManifest,
        frameCorpus(["encyclopedic", "encyclopedic"], {
          aiCell: "institutional",
        }),
        framePolicy(2, ["encyclopedic", "institutional"]),
        validFileDigests,
      ),
    ).rejects.toThrow(
      /release corpus is missing required human source type "institutional"/u,
    );
  });

  it("seals a release corpus whose ai and mixed rows declare no quota cell", async () => {
    // The guard is about the human class only. Widening it to every record would
    // refuse every corpus this project can build: no generated row carries a cell.
    const audit = await sealDataset(
      frameReleaseManifest,
      frameCorpus(["encyclopedic", "encyclopedic", "encyclopedic"], {
        withMixed: true,
      }),
      framePolicy(3, ["encyclopedic"], { mixed: 1 }),
      validFileDigests,
    );
    expect(audit.releaseEligible).toBe(true);
    expect(audit.counts).toEqual({ human: 3, ai: AI_ROWS, mixed: 1 });
  });

  it("refuses a v2 release corpus whose human rows declare no quota cell", async () => {
    function v2HumanRow(n: number, cell: string | undefined): BenchmarkRecord {
      const raw: Record<string, unknown> = { ...human };
      raw.id = `human-${n.toString().padStart(4, "0")}`;
      raw.normalizedTextSha256 = (0x2_00_00 + n).toString(16).padStart(64, "0");
      if (cell === undefined) delete raw.humanSourceType;
      else raw.humanSourceType = cell;
      return validateBenchmarkRecord(raw);
    }
    const v2Policy = {
      counts: { human: 3, ai: 0, mixed: 0 },
      requiredHumanSourceTypes: ["encyclopedic"],
      requiredHardNegativeFamilies: [],
    };
    // The shape of the corpus on disk: `schemaVersion: 2`, and the field present on
    // some rows. There is no version exemption here — a v2 row CAN declare a cell, so
    // the criterion is satisfiable by v2 and skipping it would leave the only corpus
    // this project holds unjudged.
    await expect(
      sealDataset(
        frameReleaseManifest,
        [
          v2HumanRow(1, "encyclopedic"),
          v2HumanRow(2, undefined),
          v2HumanRow(3, undefined),
        ],
        v2Policy,
        validFileDigests,
      ),
    ).rejects.toThrow(
      /requires every human row to declare one of its quota cells: 2 of 3 human rows declare none/u,
    );
    // With the cell on every row the SAME corpus gets past membership and is refused
    // for the next thing wrong with it — the reserved family it stocks with nothing —
    // so the cell is the only thing this fixture changed.
    await expect(
      sealDataset(
        frameReleaseManifest,
        [
          v2HumanRow(1, "encyclopedic"),
          v2HumanRow(2, "encyclopedic"),
          v2HumanRow(3, "encyclopedic"),
        ],
        v2Policy,
        validFileDigests,
      ),
    ).rejects.toThrow(/held-out generator family/u);
  });

  it("requires a cell of a human row the axis eligibility calls ineligible", async () => {
    // More strict than the composition gate's admission, deliberately. The gate drops
    // an ineligible row from the per-cell FLOOR; the seal still demands the row
    // declare its cell, because a row with no cell is outside the published table
    // whether it was going to be counted in it or not.
    const ineligible = validateBenchmarkRecordV4(
      withAxis(
        (() => {
          const raw = withReview(v4Human(), humanReviewed("human"));
          delete raw.humanSourceType;
          return raw;
        })(),
        "author",
        unknownAxis("HMAC keyring unavailable"),
      ),
    );
    expect(recordEligibility(ineligible).eligible).toBe(false);
    const records: BenchmarkRecord[] = [ineligible];
    for (let n = 1; n <= AI_ROWS; n += 1) {
      const raw = withReview(v4Ai(), humanReviewed("ai"));
      raw.id = `a_agy_${n.toString().padStart(4, "0")}`;
      raw.normalizedTextSha256 = n.toString(16).padStart(64, "0");
      records.push(validateBenchmarkRecordV4(raw));
    }
    await expect(
      sealDataset(
        frameReleaseManifest,
        records,
        framePolicy(1, ["encyclopedic"]),
        validFileDigests,
      ),
    ).rejects.toThrow(
      /requires every human row to declare one of its quota cells: 1 of 1 human rows declare none/u,
    );
  });

  it("seals an infrastructure-only corpus whose human rows declare no quota cell", async () => {
    // The frame belongs to a RELEASE claim. An infrastructure corpus publishes no
    // per-cell table, and pinning it to the frame would make the pipeline
    // unexercisable — which is also why two fixture corpora elsewhere in the bench
    // seal human rows the release frame would refuse.
    const audit = await sealDataset(
      frameInfraManifest,
      frameCorpus([undefined, "blog"]),
      framePolicy(2, ["encyclopedic"]),
      validFileDigests,
    );
    expect(audit.releaseEligible).toBe(false);
    expect(audit.sealed).toBe(true);
  });

  it("publishes no cell key for a human row that declares none", async () => {
    // The PUBLISHED table is unmoved by the guard above. Its keys are inside
    // `auditDigest`, and a default key for a row that declares nothing would rename
    // absence into a cell — a number every reader of the audit would then count.
    const audit = await sealDataset(
      frameInfraManifest,
      frameCorpus([undefined, "encyclopedic"], { aiCell: "institutional" }),
      framePolicy(2, ["encyclopedic"]),
      validFileDigests,
    );
    expect(audit.sourceTypes).toEqual({
      encyclopedic: 1,
      // A generated row that carries the field still counts here: this table is over
      // every record that declares one, and it is NOT the cell denominator.
      institutional: 1,
    });
    expect(Object.keys(audit.sourceTypes)).not.toContain("unknown");
    const { auditDigest, ...withoutDigest } = audit;
    expect(await computeDatasetAuditDigest(withoutDigest)).toBe(auditDigest);
  });

  it("the only production caller hands sealDataset the frozen policy and the manifest's own scientificUse", async () => {
    // The release ARM of `sealDataset` is reached by no test of `runValidate` — doing
    // so needs a 4.000/4.000/2.000 corpus with a receipt on every row — so what the
    // outermost site passes is pinned by its bytes instead. `benchmark/commands/validate.ts`
    // is read, never written, by this file.
    const { readFile } = await import("node:fs/promises");
    const { resolve, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const callerPath = resolve(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "commands",
      "validate.ts",
    );
    const body = await readFile(callerPath, "utf8");
    const calls = [...body.matchAll(/\bsealDataset\(([^)]*)\)/gu)];
    expect(calls).toHaveLength(1);
    const args = calls[0]![1]
      .split(",")
      .map((argument) => argument.trim())
      .filter((argument) => argument.length > 0);
    expect(args).toEqual([
      "manifest",
      "records",
      "options.corpusPolicy ?? RELEASE_CORPUS_POLICY",
      "observed",
    ]);
    // A release corpus cannot be handed anything else: the command refuses an explicit
    // policy for `scientificUse: "release"` before it seals.
    expect(body).toMatch(/CORPUS_POLICY_OVERRIDE_FORBIDDEN/u);
    // And the caller declares no frame of its own, so the vocabulary the guard reads
    // is the frozen one for every release corpus.
    expect(body).not.toMatch(/requiredHumanSourceTypes/u);
    // It reads the manifest's own use and hands the manifest itself through, so the
    // release arm is entered on the corpus's own declaration rather than on a flag the
    // command computes.
    expect(body).toMatch(/manifest\.scientificUse === "release"/u);
    expect(body).not.toMatch(/scientificUse\s*[:=]\s*"release"/u);
  });
});
