import { describe, expect, it } from "vitest";

import {
  buildSplitArtifact,
  validateSplitArtifact,
  type SplitArtifact,
} from "../split-artifact.ts";
import { auditBlockedSplit, type SplitAuditPolicy } from "../split-audit.ts";
import { createBlockedSplit, type BlockedSplitPolicy } from "../split.ts";
import type { DatasetManifest } from "../dataset-manifest.ts";
import type {
  BenchmarkLabel,
  BenchmarkRecord,
  TransformationKind,
} from "../schema.ts";

const SHA = "a".repeat(64);

const MANIFEST: DatasetManifest = {
  schemaVersion: 1,
  datasetId: "ptbr-linkedin-v1",
  version: "1.0.0",
  scientificUse: "infrastructure-only",
  intendedLanguage: "pt-BR",
  intendedDomain: "linkedin",
  createdAt: "2026-07-19T00:00:00.000Z",
  normalizationVersion: "cleanfeed-text-v1",
  annotationProtocolVersion: "annotation-v1",
  recordsFile: "records.jsonl",
  recordsSha256: "1".repeat(64),
  reviewLedgerFile: "private/review-ledger.jsonl",
  reviewLedgerSha256: "2".repeat(64),
  sourceManifestFile: "private/source-manifest.json",
  sourceManifestSha256: "3".repeat(64),
  heldOutGeneratorFamilies: ["family-unseen"],
  licenses: [
    {
      id: "cc-by",
      name: "CC BY",
      source: "fixture://license",
      evaluationUseApproved: true,
      redistribution: "allowed",
      notice: "fixture-only",
    },
  ],
};

interface RecordSpec {
  id: string;
  label: BenchmarkLabel;
  createdAt: number;
  domain: string;
  wordCount: number;
  humanSourceType?: string;
  hardNegativeFamily?: string;
  transformationKind?: TransformationKind;
  family?: string;
  aiFraction?: number;
  author: string;
  source: string;
  domainSource: string;
  collectionBatch: string;
  nearDuplicate: string;
  derivationRoot: string;
  generatorVersion?: string;
  promptTemplate?: string;
}

function rec(spec: RecordSpec): BenchmarkRecord {
  const kind: TransformationKind = spec.transformationKind ?? "none";
  const record: BenchmarkRecord = {
    schemaVersion: 2,
    id: spec.id,
    text: `texto ${spec.id}`,
    normalizedTextSha256: SHA,
    label: spec.label,
    language: "pt-BR",
    platform: "linkedin",
    domain: spec.domain,
    topic: "carreira",
    wordCount: spec.wordCount,
    createdAt: spec.createdAt,
    provenance: {
      sourceKind: "licensed-corpus",
      sourceId: "src",
      sourceRevision: "rev1",
      collectedAt: spec.createdAt,
      licenseId: "cc-by",
      legalBasis: "license",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "rev1",
        reviewedAt: spec.createdAt,
      },
    },
    annotation: {
      protocolVersion: "annotation-v1",
      reviewerIds: ["rev1", "rev2"],
      agreement: "agree",
    },
    transformation: {
      kind,
      severity: kind === "none" ? "none" : "medium",
    },
    groups: {
      author: spec.author,
      source: spec.source,
      domainSource: spec.domainSource,
      collectionBatch: spec.collectionBatch,
      nearDuplicate: spec.nearDuplicate,
      derivationRoot: spec.derivationRoot,
    },
  };
  if (spec.humanSourceType !== undefined) {
    record.humanSourceType = spec.humanSourceType;
  }
  if (spec.hardNegativeFamily !== undefined) {
    record.hardNegativeFamily = spec.hardNegativeFamily;
  }
  if (spec.generatorVersion !== undefined) {
    record.groups.generatorVersion = spec.generatorVersion;
  }
  if (spec.promptTemplate !== undefined) {
    record.groups.promptTemplate = spec.promptTemplate;
  }
  if (spec.family !== undefined) {
    record.generation = {
      provider: "acme",
      family: spec.family,
      model: `${spec.family}-model`,
      version: spec.generatorVersion ?? "v1",
      promptId: "prompt1",
      promptSha256: SHA,
      generatedAt: spec.createdAt,
    };
  }
  if (spec.aiFraction !== undefined) {
    record.mixture = {
      aiFraction: spec.aiFraction,
      humanFraction: Number((1 - spec.aiFraction).toFixed(4)),
      spans: [],
    };
  }
  return record;
}

// Release-scale corpus: >=4000 human negatives so the 50% blocked test carries
// >=2000, every critical slice keeps its floor, and the audit passes.
function buildReleaseDataset(): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  const SLOTS = 100;
  const perHuman = 46;
  const perAi = 15;
  const perMixed = 10;
  const lengths = [40, 180, 520];
  const aiKinds: TransformationKind[] = [
    "paraphrase",
    "back-translation",
    "expand",
  ];

  for (let slot = 1; slot <= SLOTS; slot += 1) {
    for (let i = 0; i < perHuman; i += 1) {
      records.push(
        rec({
          id: `h_${slot}_${i}`,
          label: "human",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: lengths[i % 3],
          humanSourceType: i % 2 === 0 ? "employee-post" : "newsletter",
          hardNegativeFamily: i % 2 === 0 ? "hn-legal" : "hn-marketing",
          author: `auth_h_${slot}_${i}`,
          source: `src_h_${slot}`,
          domainSource: `ds_h_${slot}`,
          collectionBatch: `cb_h_${slot}`,
          nearDuplicate: `nd_h_${slot}_${i}`,
          derivationRoot: `h_${slot}_${i}`,
        }),
      );
    }
    for (let i = 0; i < perAi; i += 1) {
      records.push(
        rec({
          id: `a_${slot}_${i}`,
          label: "ai",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: [50, 200, 480][i % 3],
          transformationKind: aiKinds[i % 3],
          family: "family-seen",
          author: `auth_a_${slot}_${i}`,
          source: `src_a_${slot}`,
          domainSource: `ds_a_${slot}`,
          collectionBatch: `cb_a_${slot}`,
          nearDuplicate: `nd_a_${slot}_${i}`,
          derivationRoot: `a_${slot}_${i}`,
          generatorVersion: `gv_seen_${slot}`,
          promptTemplate: `pt_a_${slot}`,
        }),
      );
    }
    for (let i = 0; i < perMixed; i += 1) {
      records.push(
        rec({
          id: `m_${slot}_${i}`,
          label: "mixed",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: [60, 220, 500][i % 3],
          transformationKind: "human-ai-mix",
          family: "family-seen",
          aiFraction: i % 2 === 0 ? 0.7 : 0.4,
          author: `auth_m_${slot}_${i}`,
          source: `src_m_${slot}`,
          domainSource: `ds_m_${slot}`,
          collectionBatch: `cb_m_${slot}`,
          nearDuplicate: `nd_m_${slot}_${i}`,
          derivationRoot: `m_${slot}_${i}`,
          promptTemplate: `pt_m_${slot}`,
        }),
      );
    }
  }
  for (let slot = 96; slot <= SLOTS; slot += 1) {
    for (let i = 0; i < 4; i += 1) {
      records.push(
        rec({
          id: `u_${slot}_${i}`,
          label: "ai",
          createdAt: slot,
          domain: "linkedin",
          wordCount: 300,
          transformationKind: "paraphrase",
          family: "family-unseen",
          author: `auth_u_${slot}_${i}`,
          source: `src_u_${slot}_${i}`,
          domainSource: `ds_u_${slot}_${i}`,
          collectionBatch: `cb_u_${slot}_${i}`,
          nearDuplicate: `nd_u_${slot}_${i}`,
          derivationRoot: `u_${slot}_${i}`,
          generatorVersion: `gv_unseen_${slot}`,
          promptTemplate: `pt_u_${slot}`,
        }),
      );
    }
  }
  return records;
}

// Human-light corpus: only 100 human records, so the blocked test can never reach
// the 2000-negative floor and the audit fails while every partition stays
// non-empty (so cutoffs remain finite and the artifact still builds).
function buildFailingDataset(): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  for (let slot = 1; slot <= 100; slot += 1) {
    records.push(
      rec({
        id: `hh_${slot}`,
        label: "human",
        createdAt: slot,
        domain: slot % 2 === 0 ? "corporate" : "linkedin",
        wordCount: 100,
        author: `auth_hh_${slot}`,
        source: `src_hh_${slot}`,
        domainSource: `ds_hh_${slot}`,
        collectionBatch: `cb_hh_${slot}`,
        nearDuplicate: `nd_hh_${slot}`,
        derivationRoot: `hh_${slot}`,
      }),
      rec({
        id: `aa_${slot}`,
        label: "ai",
        createdAt: slot,
        domain: "linkedin",
        wordCount: 100,
        family: "family-seen",
        author: `auth_aa_${slot}`,
        source: `src_aa_${slot}`,
        domainSource: `ds_aa_${slot}`,
        collectionBatch: `cb_aa_${slot}`,
        nearDuplicate: `nd_aa_${slot}`,
        derivationRoot: `aa_${slot}`,
      }),
      rec({
        id: `mm_${slot}`,
        label: "mixed",
        createdAt: slot,
        domain: "linkedin",
        wordCount: 100,
        family: "family-seen",
        aiFraction: 0.6,
        author: `auth_mm_${slot}`,
        source: `src_mm_${slot}`,
        domainSource: `ds_mm_${slot}`,
        collectionBatch: `cb_mm_${slot}`,
        nearDuplicate: `nd_mm_${slot}`,
        derivationRoot: `mm_${slot}`,
      }),
    );
  }
  return records;
}

const POLICY: BlockedSplitPolicy = {
  fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
  classTolerance: 0.02,
  heldOutGeneratorFamilies: ["family-unseen"],
  seed: 712_019,
};

const AUDIT_POLICY: SplitAuditPolicy = {
  minimumTestHumanNegatives: 2_000,
  minimumCriticalFprNegatives: 300,
  minimumCriticalRecallPositives: 200,
  classTolerance: 0.02,
};

const RELEASE_DATASET = buildReleaseDataset();
const RELEASE_SPLIT = createBlockedSplit(RELEASE_DATASET, POLICY);
const RELEASE_AUDIT = auditBlockedSplit(
  RELEASE_DATASET,
  RELEASE_SPLIT,
  AUDIT_POLICY,
);

const HEX64 = /^[0-9a-f]{64}$/;

async function buildRelease(): Promise<SplitArtifact> {
  return buildSplitArtifact({
    manifest: MANIFEST,
    records: RELEASE_DATASET,
    split: RELEASE_SPLIT,
    policy: POLICY,
    audit: RELEASE_AUDIT,
  });
}

describe("buildSplitArtifact", () => {
  it("captures one assignment per record and coherent counts", async () => {
    expect(RELEASE_AUDIT.passed).toBe(true);
    const artifact = await buildRelease();

    expect(artifact.schemaVersion).toBe(1);
    expect(artifact.algorithm).toBe("blocked-group-time-v1");
    expect(artifact.seed).toBe(POLICY.seed);
    expect(artifact.heldOutGeneratorFamilies).toEqual(["family-unseen"]);

    expect(artifact.assignments).toHaveLength(RELEASE_DATASET.length);
    const assignedIds = new Set(artifact.assignments.map((a) => a.id));
    expect(assignedIds.size).toBe(RELEASE_DATASET.length);

    expect(artifact.counts).toEqual({
      development: RELEASE_SPLIT.development.length,
      calibration: RELEASE_SPLIT.calibration.length,
      test: RELEASE_SPLIT.test.length,
    });
    expect(
      artifact.counts.development +
        artifact.counts.calibration +
        artifact.counts.test,
    ).toBe(RELEASE_DATASET.length);

    for (const digest of [
      artifact.datasetDigest,
      artifact.algorithmDigest,
      artifact.assignmentsDigest,
      artifact.splitDigest,
    ]) {
      expect(digest).toMatch(HEX64);
    }

    // The recorded cuts reconstruct the blocked temporal boundaries.
    expect(artifact.cutoffs.calibrationCut).toBeLessThan(
      artifact.cutoffs.testCut,
    );
  });

  it("is deterministic and permutation-invariant", async () => {
    const first = await buildRelease();
    const shuffled = await buildSplitArtifact({
      manifest: MANIFEST,
      records: [...RELEASE_DATASET].reverse(),
      split: {
        development: [...RELEASE_SPLIT.development].reverse(),
        calibration: [...RELEASE_SPLIT.calibration].reverse(),
        test: [...RELEASE_SPLIT.test].reverse(),
      },
      policy: POLICY,
      audit: RELEASE_AUDIT,
    });
    expect(shuffled.datasetDigest).toBe(first.datasetDigest);
    expect(shuffled.assignmentsDigest).toBe(first.assignmentsDigest);
    expect(shuffled.splitDigest).toBe(first.splitDigest);
  });
});

describe("validateSplitArtifact", () => {
  it("accepts a freshly built, audited artifact", async () => {
    const artifact = await buildRelease();
    await expect(
      validateSplitArtifact(artifact, MANIFEST, RELEASE_DATASET),
    ).resolves.toEqual(artifact);
  });

  it("rejects a tampered assignment partition", async () => {
    const artifact = await buildRelease();
    const tampered: SplitArtifact = {
      ...artifact,
      assignments: artifact.assignments.map((assignment, index) =>
        index === 0
          ? {
              id: assignment.id,
              partition:
                assignment.partition === "test" ? "development" : "test",
            }
          : assignment,
      ),
    };
    await expect(
      validateSplitArtifact(tampered, MANIFEST, RELEASE_DATASET),
    ).rejects.toThrow(/assignments|digest/i);
  });

  it("rejects a tampered splitDigest", async () => {
    const artifact = await buildRelease();
    await expect(
      validateSplitArtifact(
        { ...artifact, splitDigest: "0".repeat(64) },
        MANIFEST,
        RELEASE_DATASET,
      ),
    ).rejects.toThrow(/split.*digest/i);
  });

  it("rejects a datasetDigest that does not match the dataset", async () => {
    const artifact = await buildRelease();
    await expect(
      validateSplitArtifact(
        { ...artifact, datasetDigest: "0".repeat(64) },
        MANIFEST,
        RELEASE_DATASET,
      ),
    ).rejects.toThrow(/dataset/i);
  });

  it("rejects a missing assignment", async () => {
    const artifact = await buildRelease();
    await expect(
      validateSplitArtifact(
        { ...artifact, assignments: artifact.assignments.slice(1) },
        MANIFEST,
        RELEASE_DATASET,
      ),
    ).rejects.toThrow(/assignment/i);
  });

  it("rejects an extra assignment", async () => {
    const artifact = await buildRelease();
    await expect(
      validateSplitArtifact(
        {
          ...artifact,
          assignments: [
            ...artifact.assignments,
            { id: "ZZZ_not_in_dataset", partition: "test" },
          ],
        },
        MANIFEST,
        RELEASE_DATASET,
      ),
    ).rejects.toThrow(/assignment/i);
  });

  it("rejects a duplicate assignment", async () => {
    const artifact = await buildRelease();
    await expect(
      validateSplitArtifact(
        {
          ...artifact,
          assignments: [...artifact.assignments, artifact.assignments[0]],
        },
        MANIFEST,
        RELEASE_DATASET,
      ),
    ).rejects.toThrow(/assignment/i);
  });

  it("rejects an artifact whose audit did not pass", async () => {
    const failingDataset = buildFailingDataset();
    const failingPolicy: BlockedSplitPolicy = {
      fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
      classTolerance: 0.02,
      heldOutGeneratorFamilies: [],
      seed: 1,
    };
    const split = createBlockedSplit(failingDataset, failingPolicy);
    const audit = auditBlockedSplit(failingDataset, split, AUDIT_POLICY);
    expect(audit.passed).toBe(false);

    const artifact = await buildSplitArtifact({
      manifest: MANIFEST,
      records: failingDataset,
      split,
      policy: failingPolicy,
      audit,
    });
    await expect(
      validateSplitArtifact(artifact, MANIFEST, failingDataset),
    ).rejects.toThrow(/audit/i);
  });
});
