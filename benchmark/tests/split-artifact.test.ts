import { describe, expect, it } from "vitest";

import {
  assertSplitArtifactSelfConsistent,
  buildSplitArtifact,
  SplitArtifactError,
  validateSplitArtifact,
  withoutSplitDigest,
  type SplitArtifact,
  type SplitAssignment,
} from "../split-artifact.ts";
import {
  auditBlockedSplit,
  type SplitAudit,
  type SplitAuditPolicy,
} from "../split-audit.ts";
import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import { REBUILD_V3_POLICY } from "../rebuild-v3-policy.ts";
import {
  PARTITIONS,
  createBlockedSplit,
  type BlockedSplitPolicy,
  type DatasetSplit,
  type Partition,
} from "../split.ts";
import type { DatasetManifest } from "../dataset-manifest.ts";
import type {
  BenchmarkLabel,
  BenchmarkRecord,
  TransformationKind,
} from "../schema.ts";
import {
  asGeneratorFamily,
  normalizeGeneratorFamily,
  type GeneratorFamily,
} from "../generator-family.ts";

const SHA = "a".repeat(64);

const MANIFEST: DatasetManifest = {
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
  recordsSha256: "1".repeat(64),
  reviewLedgerFile: "private/review-ledger.jsonl",
  reviewLedgerSha256: "2".repeat(64),
  sourceManifestFile: "private/source-manifest.json",
  sourceManifestSha256: "3".repeat(64),
  heldOutGeneratorFamilies: [asGeneratorFamily("family-unseen")],
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
    platform: "generic",
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
    // Both fields, as a valid record carries them: the provider's own label inside
    // the recipe, and the CANONICAL token in groups — the only field the splitter,
    // the audit and the slices read (benchmark/generator-family.ts). A fixture that
    // set only `generation.family` modelled a record the schema now refuses.
    record.generation = {
      provider: "acme",
      family: spec.family,
      model: `${spec.family}-model`,
      version: spec.generatorVersion ?? "v1",
      promptId: "prompt1",
      promptSha256: SHA,
      generatedAt: spec.createdAt,
    };
    record.groups.generatorFamily = normalizeGeneratorFamily(spec.family);
  }
  if (spec.aiFraction !== undefined) {
    record.mixture = {
      aiFraction: spec.aiFraction,
      humanFraction: Number((1 - spec.aiFraction).toFixed(4)),
      spans: [],
      generationMode: "mechanistic",
    };
  }
  return record;
}

// Release-scale corpus: enough human negatives that the 20% blocked test carries
// >=2000, every critical slice keeps its floor, and the audit passes.
function buildReleaseDataset(): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  const SLOTS = 100;
  // 105, not 46. The audit floor is 2000 human negatives inside the blocked test, and
  // test is 20% of the corpus rather than 50% — so the smallest corpus that clears the
  // floor now holds >= 10 000 humans. This fixture seals nothing, so it is free to be
  // that large.
  const perHuman = 105;
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

const POLICY: BlockedSplitPolicy = {
  fractions: {
    train: 0.45,
    dev: 0.05,
    "cal-A": 0.1,
    "cal-B": 0.2,
    test: 0.2,
  },
  classTolerance: 0.02,
  heldOutGeneratorFamilies: [asGeneratorFamily("family-unseen")],
  seed: 20_260_726,
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
  POLICY.heldOutGeneratorFamilies,
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

// Re-seals whatever mutation is applied, so the artifact stays SELF-CONSISTENT and
// the test cannot pass merely because a digest stopped matching.
async function resealed(
  mutate: (artifact: SplitArtifact) => void,
): Promise<SplitArtifact> {
  const artifact = structuredClone(await buildRelease()) as SplitArtifact;
  mutate(artifact);
  const sorted = [...artifact.assignments].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  artifact.assignments = sorted;
  artifact.assignmentsDigest = await canonicalSha256(sorted);
  artifact.algorithmDigest = await canonicalSha256({
    algorithm: artifact.algorithm,
    policy: artifact.policy,
  });
  artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
  return artifact;
}

describe("buildSplitArtifact", () => {
  it("captures one assignment per record and coherent counts", async () => {
    expect(RELEASE_AUDIT.passed).toBe(true);
    const artifact = await buildRelease();

    expect(artifact.schemaVersion).toBe(4);
    expect(artifact.algorithm).toBe("blocked-group-time-v2");
    expect(artifact.seed).toBe(POLICY.seed);
    expect(artifact.heldOutGeneratorFamilies).toEqual(["family-unseen"]);

    expect(artifact.assignments).toHaveLength(RELEASE_DATASET.length);
    const assignedIds = new Set(artifact.assignments.map((a) => a.id));
    expect(assignedIds.size).toBe(RELEASE_DATASET.length);

    expect(artifact.counts).toEqual({
      train: RELEASE_SPLIT.train.length,
      dev: RELEASE_SPLIT.dev.length,
      "cal-A": RELEASE_SPLIT["cal-A"].length,
      "cal-B": RELEASE_SPLIT["cal-B"].length,
      test: RELEASE_SPLIT.test.length,
    });
    expect(
      PARTITIONS.reduce(
        (total, partition) => total + artifact.counts[partition],
        0,
      ),
    ).toBe(RELEASE_DATASET.length);

    for (const digest of [
      artifact.datasetDigest,
      artifact.algorithmDigest,
      artifact.assignmentsDigest,
      artifact.splitDigest,
    ]) {
      expect(digest).toMatch(HEX64);
    }

    // The published boundaries are the audit's OBSERVED ones, copied rather than
    // reconstructed into cuts — `train` is the fallback, so its newest record can be
    // newer than a middle partition's and no cut is recoverable from a finished split.
    expect(artifact.cutoffs).toEqual(RELEASE_AUDIT.cutoffs);
    expect(artifact.cutoffs.earliestTest).toBeGreaterThan(
      artifact.cutoffs.latestCalB,
    );
  });

  it("is deterministic and permutation-invariant", async () => {
    const first = await buildRelease();
    const shuffled = await buildSplitArtifact({
      manifest: MANIFEST,
      records: [...RELEASE_DATASET].reverse(),
      split: {
        train: [...RELEASE_SPLIT.train].reverse(),
        dev: [...RELEASE_SPLIT.dev].reverse(),
        "cal-A": [...RELEASE_SPLIT["cal-A"]].reverse(),
        "cal-B": [...RELEASE_SPLIT["cal-B"]].reverse(),
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
              partition: assignment.partition === "test" ? "train" : "test",
            }
          : assignment,
      ),
    };
    // `counts` is what catches it now, and earlier than the digests: moving one
    // assignment makes the published per-partition totals disagree with the assignments
    // they summarise. The digest checks would also have caught it; this one names the
    // field that is wrong instead of only saying a hash moved.
    await expect(
      validateSplitArtifact(tampered, MANIFEST, RELEASE_DATASET),
    ).rejects.toThrow(/counts|assignments|digest/i);
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
    // RE-SEALED on purpose. Editing `datasetDigest` and leaving the digests stale is caught by
    // self-consistency, which says nothing about whether the artifact describes THIS dataset.
    // Only a competent forgery isolates the binding that has to refuse it.
    const forged = await resealed((artifact) => {
      artifact.datasetDigest = "0".repeat(64);
    });
    await expect(
      validateSplitArtifact(forged, MANIFEST, RELEASE_DATASET),
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

  // The two refusals a sealed artifact re-entering the typed world from JSON needs,
  // exercised through `buildSplitArtifact` so `splitDigest` is computed OVER the
  // divergence: mutating a built artifact in place would fail on the digest first
  // and never reach these branches, which is how both mappings stayed untested.
  it("rejects a sealed artifact whose audited reserve is not the declared one", async () => {
    const artifact = await buildSplitArtifact({
      manifest: MANIFEST,
      records: RELEASE_DATASET,
      split: RELEASE_SPLIT,
      policy: POLICY,
      // The partitions honoured nothing while the policy reserved `family-unseen`:
      // the report would print a reserve the blind block does not hold.
      audit: { ...RELEASE_AUDIT, heldOutGeneratorFamilies: [] },
    });
    const failure = await validateSplitArtifact(
      artifact,
      MANIFEST,
      RELEASE_DATASET,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SplitArtifactError);
    expect((failure as SplitArtifactError).code).toBe(
      "SPLIT_ARTIFACT_HELD_OUT_FAMILY_DISAGREEMENT",
    );
    expect((failure as Error).message).toMatch(/omits \[family-unseen\]/u);
  });

  it("rejects a sealed artifact carrying the provider's dotted spelling", async () => {
    const artifact = await buildSplitArtifact({
      manifest: MANIFEST,
      records: RELEASE_DATASET,
      split: RELEASE_SPLIT,
      policy: POLICY,
      audit: {
        ...RELEASE_AUDIT,
        // A JSON-loaded artifact is only nominally typed, so the cast models the
        // real hazard: a dotted label that reached the file cannot be compared as a
        // plain string, it has to be refused.
        heldOutGeneratorFamilies: [
          "family.unseen",
        ] as unknown as GeneratorFamily[],
      },
    });
    const failure = await validateSplitArtifact(
      artifact,
      MANIFEST,
      RELEASE_DATASET,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SplitArtifactError);
    expect((failure as SplitArtifactError).code).toBe(
      "SPLIT_ARTIFACT_HELD_OUT_FAMILY_INVALID",
    );
    expect((failure as Error).message).toMatch(
      /audit\.heldOutGeneratorFamilies\[0\]/u,
    );
  });

  // The incidental list enters no set agreement — it is diagnosis — but the report
  // prints it, so the canonical form and the presence of the key are still refused
  // here rather than surfacing later as a TypeError from the renderer.
  it("rejects a dotted spelling in the incidental test-only families", async () => {
    const artifact = await buildSplitArtifact({
      manifest: MANIFEST,
      records: RELEASE_DATASET,
      split: RELEASE_SPLIT,
      policy: POLICY,
      audit: {
        ...RELEASE_AUDIT,
        incidentalTestOnlyGeneratorFamilies: [
          "family.incidental",
        ] as unknown as GeneratorFamily[],
      },
    });
    const failure = await validateSplitArtifact(
      artifact,
      MANIFEST,
      RELEASE_DATASET,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SplitArtifactError);
    expect((failure as SplitArtifactError).code).toBe(
      "SPLIT_ARTIFACT_HELD_OUT_FAMILY_INVALID",
    );
    expect((failure as Error).message).toMatch(
      /audit\.incidentalTestOnlyGeneratorFamilies\[0\]/u,
    );
  });

  it("rejects a sealed artifact that never measured the incidental families", async () => {
    const staleAudit: SplitAudit = { ...RELEASE_AUDIT };
    delete (staleAudit as Partial<SplitAudit>)
      .incidentalTestOnlyGeneratorFamilies;
    const artifact = await buildSplitArtifact({
      manifest: MANIFEST,
      records: RELEASE_DATASET,
      split: RELEASE_SPLIT,
      policy: POLICY,
      // The shape a split-artifact.json sealed BEFORE the field existed really has:
      // the key is ABSENT, not `undefined` (contracts/canonical-json.ts refuses an
      // undefined property outright, so no writer can even digest that). Absent is
      // the hazard that gets past every digest — the stale file's own splitDigest
      // recomputes perfectly, because canonicalizing it reproduces the bytes the old
      // writer signed — which is why the check has to live in the validator. A
      // missing key must stay distinguishable from a writer that measured and found
      // nothing, so it fails naming the path instead of being defaulted to `[]`.
      audit: staleAudit,
    });
    const failure = await validateSplitArtifact(
      artifact,
      MANIFEST,
      RELEASE_DATASET,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SplitArtifactError);
    expect((failure as SplitArtifactError).code).toBe(
      "SPLIT_ARTIFACT_HELD_OUT_FAMILY_INVALID",
    );
    expect((failure as Error).message).toMatch(
      /audit\.incidentalTestOnlyGeneratorFamilies must be an array/u,
    );
  });

  it("rejects an artifact whose audit did not pass", async () => {
    // The failure mode is TEMPORAL, not the human-negative count. That count is a
    // published reporting threshold and no longer fails an audit, so a fixture that
    // relied on it would now produce `passed: true` and prove nothing here.
    //
    // Five populated partitions with `test` oldest: every boundary is finite, so the
    // artifact still builds, and the audit refuses on ordering.
    const solo = (id: string, createdAt: number): BenchmarkRecord =>
      rec({
        id,
        label: "human",
        createdAt,
        domain: "corporate",
        wordCount: 100,
        author: `auth_${id}`,
        source: `src_${id}`,
        domainSource: `ds_${id}`,
        collectionBatch: `cb_${id}`,
        nearDuplicate: `nd_${id}`,
        derivationRoot: id,
      });
    const failingDataset = [
      solo("tr", 10),
      solo("dv", 20),
      solo("ca", 30),
      solo("cb", 40),
      solo("ts", 1),
    ];
    const failingPolicy: BlockedSplitPolicy = {
      ...POLICY,
      heldOutGeneratorFamilies: [],
    };
    const split: DatasetSplit<BenchmarkRecord> = {
      train: [failingDataset[0] as BenchmarkRecord],
      dev: [failingDataset[1] as BenchmarkRecord],
      "cal-A": [failingDataset[2] as BenchmarkRecord],
      "cal-B": [failingDataset[3] as BenchmarkRecord],
      test: [failingDataset[4] as BenchmarkRecord],
    };
    const audit = auditBlockedSplit(
      failingDataset,
      split,
      AUDIT_POLICY,
      failingPolicy.heldOutGeneratorFamilies,
    );
    expect(audit.passed).toBe(false);
    expect(audit.reasons.some((reason) => /temporal/.test(reason))).toBe(true);

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

// --- a stale artifact must not re-enter the typed world -----------------------
//
// Every command loads this artifact with `as SplitArtifact` over parsed JSON, so the
// literal types on `schemaVersion` and `algorithm` constrain nothing about a file. Each
// case below is internally CONSISTENT — every digest recomputes and every coverage check
// passes — while naming a split vocabulary this build does not implement, so only a
// runtime check separates it from an honest artifact.
describe("validateSplitArtifact refuses a stale vocabulary", () => {
  async function codeOf(artifact: SplitArtifact): Promise<string> {
    try {
      await validateSplitArtifact(artifact, MANIFEST, RELEASE_DATASET);
    } catch (error) {
      return (error as SplitArtifactError).code;
    }
    return "ACCEPTED";
  }

  it("refuses the previous schemaVersion", async () => {
    const stale = await resealed((artifact) => {
      (artifact as { schemaVersion: number }).schemaVersion = 1;
    });
    expect(await codeOf(stale)).toBe("SPLIT_ARTIFACT_SCHEMA_UNSUPPORTED");
  });

  it("refuses the previous algorithm identity", async () => {
    const stale = await resealed((artifact) => {
      (artifact as { algorithm: string }).algorithm = "blocked-group-time-v1";
    });
    expect(await codeOf(stale)).toBe("SPLIT_ARTIFACT_ALGORITHM_UNSUPPORTED");
  });

  it("refuses an assignment naming a partition from the old vocabulary", async () => {
    const stale = await resealed((artifact) => {
      const first = artifact.assignments[0] as { partition: string };
      first.partition = "development";
    });
    expect(await codeOf(stale)).toBe("SPLIT_ARTIFACT_PARTITION_UNKNOWN");
  });

  it("refuses counts keyed by the old vocabulary", async () => {
    const stale = await resealed((artifact) => {
      (artifact as unknown as { counts: Record<string, number> }).counts = {
        development: 2_000,
        calibration: 3_000,
        test: 5_000,
      };
    });
    expect(await codeOf(stale)).toBe("SPLIT_ARTIFACT_PARTITION_UNKNOWN");
  });

  it("refuses a policy edited after sealing even when BOTH digests are recomputed", async () => {
    // `resealed` recomputes BOTH digests, and that is what makes this a competent
    // forgery: every digest in the file only proves the file agrees with itself, which
    // re-sealing restores. Leaving `algorithmDigest` stale would refuse for the wrong
    // reason and prove nothing.
    const forged = await resealed((artifact) => {
      artifact.seed = 999_999;
    });
    // The TOP-LEVEL copy is the one edited: `policy.seed` stays the pre-registered value, so
    // the authority check passes and what remains is the divergence between the two published
    // copies — of which only the one inside the policy is under `algorithmDigest`.
    expect(await codeOf(forged)).toBe("SPLIT_ARTIFACT_SEED_MISMATCH");
  });

  it("refuses fractions that are not the pre-registered ones, both digests recomputed", async () => {
    // Nothing inside the file can catch this: the edited policy is covered by both
    // recomputed digests. It is refused only because the fractions are compared against
    // the frozen pre-registration, which lives outside the artifact.
    const forged = await resealed((artifact) => {
      (artifact.policy.fractions as unknown as Record<string, number>).train =
        0.5;
      (artifact.policy.fractions as unknown as Record<string, number>)[
        "cal-B"
      ] = 0.15;
    });
    expect(await codeOf(forged)).toBe(
      "SPLIT_ARTIFACT_POLICY_NOT_PREREGISTERED",
    );
  });

  it("refuses a widened classTolerance, both digests recomputed", async () => {
    const forged = await resealed((artifact) => {
      (artifact.policy as unknown as Record<string, number>).classTolerance =
        0.5;
    });
    expect(await codeOf(forged)).toBe(
      "SPLIT_ARTIFACT_POLICY_NOT_PREREGISTERED",
    );
  });

  it("refuses counts that disagree with the assignments they summarise", async () => {
    const forged = await resealed((artifact) => {
      (artifact.counts as unknown as Record<string, number>).train += 1;
    });
    expect(await codeOf(forged)).toBe("SPLIT_ARTIFACT_COUNTS_MISMATCH");
  });

  it("refuses an audit whose own shapes still use the old vocabulary", async () => {
    // A current header over an audit keyed by other partition names. Every digest recomputes,
    // because the audit is sealed as-is — so what has to refuse it is the audit's OWN shapes
    // being checked, not the header.
    const forged = await resealed((artifact) => {
      (artifact.audit as unknown as { sizes: Record<string, number> }).sizes = {
        development: 2_000,
        calibration: 3_000,
        test: 5_000,
      };
    });
    expect(await codeOf(forged)).toBe("SPLIT_ARTIFACT_PARTITION_UNKNOWN");
  });
});

// --- the sealed audit has to reproduce from the dataset -----------------------
//
// The checks above all prove the file agrees with ITSELF, which a re-sealed forgery does
// by construction. None of them reads the dataset, so none can tell whether the audit
// DATA is true of it. `validateSplitArtifact` is the one entry point that receives the
// records, so it is the only place the audit can be reproduced — and every case below was
// ACCEPTED before it did.
describe("validateSplitArtifact reproduces the sealed audit", () => {
  async function forgedAudit(
    mutate: (audit: SplitAudit) => void,
  ): Promise<SplitArtifact> {
    const artifact = structuredClone(await buildRelease()) as SplitArtifact;
    mutate(artifact.audit);
    // Re-sealed in dependency order, so every digest agrees with the forgery.
    artifact.assignmentsDigest = await canonicalSha256(artifact.assignments);
    artifact.algorithmDigest = await canonicalSha256({
      algorithm: artifact.algorithm,
      policy: artifact.policy,
    });
    artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
    return artifact;
  }

  async function codeOfFull(artifact: SplitArtifact): Promise<string> {
    try {
      await validateSplitArtifact(artifact, MANIFEST, RELEASE_DATASET);
    } catch (error) {
      return (error as SplitArtifactError).code;
    }
    return "ACCEPTED";
  }

  it("refuses a human-negative count the blind block cannot hold", async () => {
    // The exact shape that reached a fixture: a number far larger than the partition it
    // describes, sealed consistently.
    const forged = await forgedAudit((audit) => {
      audit.testHumanNegatives = {
        count: 2_000_000,
        reportingThreshold: 2_000,
        sufficientForReleaseFpr: true,
      };
    });
    expect(await codeOfFull(forged)).toBe(
      "SPLIT_ARTIFACT_AUDIT_NOT_REPRODUCIBLE",
    );
  });

  it("refuses class fractions that were never measured, even inside the tolerance", async () => {
    // The 0.01 is REDISTRIBUTED, not invented: moving it from `cal-B` keeps the five cells
    // summing to 1 and every cell inside its tolerance, so neither the sum check nor the
    // per-cell check can see it. What remains is a value the policy would accept and the
    // corpus never produced — which only re-derivation decides.
    const forged = await forgedAudit((audit) => {
      audit.classFractions.human.train = 0.46;
      audit.classFractions.human["cal-B"] = 0.19;
    });
    expect(await codeOfFull(forged)).toBe(
      "SPLIT_ARTIFACT_AUDIT_NOT_REPRODUCIBLE",
    );
  });

  it("refuses a fraction outside the frozen target without needing the dataset", async () => {
    const forged = await forgedAudit((audit) => {
      audit.classFractions.human.train = 0.99;
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_AUDIT_INCOHERENT");
  });

  it("refuses a verdict flipped to passing over reasons that remain", async () => {
    // The coherence check precedes re-derivation, so the refusal names the field rather
    // than reporting that a hash moved.
    const forged = await forgedAudit((audit) => {
      audit.reasons = ["temporal leakage: invented"];
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_AUDIT_INCOHERENT");
  });

  it("refuses observed boundaries the audit did not measure", async () => {
    // Editing `audit.cutoffs` makes the artifact's republished copy disagree with it, and
    // that comparison precedes re-derivation.
    const forged = await forgedAudit((audit) => {
      audit.cutoffs = { ...audit.cutoffs, earliestTest: 0 };
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_CUTOFFS_MISMATCH");
  });

  it("refuses artifact boundaries that disagree with the audit's", async () => {
    const artifact = structuredClone(await buildRelease()) as SplitArtifact;
    artifact.cutoffs = { ...artifact.cutoffs, latestTrain: 12_345 };
    artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
    expect(await codeOfFull(artifact)).toBe("SPLIT_ARTIFACT_CUTOFFS_MISMATCH");
  });

  it("refuses a seed that is not the pre-registered one", async () => {
    // Re-running the splitter cannot catch this: the algorithm consumes no randomness, so a
    // swapped seed produces the identical placement. What makes the seed verifiable is the
    // frozen pre-registration naming the value, so the refusal comes from that authority.
    const forged = await resealed((artifact) => {
      artifact.seed = REBUILD_V3_POLICY.seeds.split + 1;
      artifact.policy = {
        ...artifact.policy,
        seed: REBUILD_V3_POLICY.seeds.split + 1,
      };
    });
    expect(await codeOfFull(forged)).toBe(
      "SPLIT_ARTIFACT_SEED_NOT_PRE_REGISTERED",
    );
  });

  it("refuses a placement the algorithm would not produce, with an audit that reproduces and passes", async () => {
    // The only forgery class the re-execution decides ALONE. Every other placement tamper is
    // caught earlier: on a corpus whose rows share a generator, a collection batch or a
    // derivation chain, moving a single record splits its connected component and the leakage
    // check refuses it. So the corpus here is all singletons — every group axis unique per
    // record — which is what lets one record cross a boundary without leaking.
    //
    // The record moved is cal-B's EARLIEST, derived rather than fixed: sending it back to
    // cal-A keeps `latest(cal-A) < earliest(cal-B)`, so temporal order still holds, and one
    // record shifts each fraction by 1/classTotal, inside the two-point tolerance. The audit
    // therefore re-derives IDENTICAL and passing over the tampered placement — leaving the
    // provenance check as the only thing between the file and acceptance.
    const singletons: BenchmarkRecord[] = [];
    const labels: BenchmarkLabel[] = ["human", "ai", "mixed"];
    for (let index = 0; index < 300; index += 1) {
      const label = labels[index % 3] as BenchmarkLabel;
      // The reserve has to be POPULATED: a declared held-out family with no record-line is
      // not honored, so the derived reserve would come back empty and disagree with the
      // policy before provenance is ever reached. The newest instants land in `test`, which
      // is where a reserved family belongs.
      const family =
        label === "human"
          ? undefined
          : index >= 294
            ? "family-unseen"
            : "acme_family";
      singletons.push(
        rec({
          id: `s_${String(index).padStart(3, "0")}`,
          label,
          createdAt: index + 1,
          domain: "corporate",
          wordCount: 180,
          humanSourceType: label === "human" ? "employee-post" : undefined,
          transformationKind: label === "human" ? "none" : "paraphrase",
          family,
          aiFraction: label === "mixed" ? 0.5 : undefined,
          author: `auth_${index}`,
          source: `src_${index}`,
          domainSource: `ds_${index}`,
          collectionBatch: `cb_${index}`,
          nearDuplicate: `nd_${index}`,
          derivationRoot: `s_${String(index).padStart(3, "0")}`,
          promptTemplate: label === "human" ? undefined : `tpl_${index}`,
        }),
      );
    }

    const honestSplit = createBlockedSplit(singletons, POLICY);
    const honestAudit = auditBlockedSplit(
      singletons,
      honestSplit,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );
    expect(honestAudit.passed).toBe(true);

    const calB = [...honestSplit["cal-B"]].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    const moved = calB[0] as BenchmarkRecord;
    const forgedSplit: DatasetSplit<BenchmarkRecord> = {
      train: [...honestSplit.train],
      dev: [...honestSplit.dev],
      "cal-A": [...honestSplit["cal-A"], moved],
      "cal-B": calB.slice(1),
      test: [...honestSplit.test],
    };
    const forgedAuditVerdict = auditBlockedSplit(
      singletons,
      forgedSplit,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );
    expect(forgedAuditVerdict.reasons).toEqual([]);
    expect(forgedAuditVerdict.passed).toBe(true);

    const forged = await buildSplitArtifact({
      manifest: MANIFEST,
      records: singletons,
      split: forgedSplit,
      policy: POLICY,
      audit: forgedAuditVerdict,
    });
    expect(forged.assignments.find((a) => a.id === moved.id)?.partition).toBe(
      "cal-A",
    );

    await expect(
      validateSplitArtifact(forged, MANIFEST, singletons),
    ).rejects.toMatchObject({
      code: "SPLIT_ARTIFACT_ASSIGNMENTS_NOT_REPRODUCIBLE",
    });
  });

  // --- guardas que uma auditoria de MUTACAO mostrou sem teste ------------------------
  //
  // Desligar o `throw` de cada codigo e rodar a suite mede quais guardas alguma coisa
  // exercita. Sete nao eram mencionadas por teste nenhum, entre elas as duas do atestado de
  // composicao — que sao o centro da regra que exige o atestado derivado. Uma guarda que
  // nenhuma entrada alcanca nao protege nada.

  const RELEASE_MANIFEST = {
    ...MANIFEST,
    scientificUse: "release" as const,
  };

  async function buildForRelease(): Promise<SplitArtifact> {
    return buildSplitArtifact({
      manifest: RELEASE_MANIFEST,
      records: RELEASE_DATASET,
      split: RELEASE_SPLIT,
      policy: POLICY,
      audit: RELEASE_AUDIT,
    });
  }

  it("refuses a composition attestation the corpus does not produce", async () => {
    // O atestado e DERIVADO do inventario por classe e particao. Trocar o digest por outro
    // bem formado passa por toda checagem de forma; so recomputar do dataset separa os dois.
    const artifact = await buildForRelease();
    expect(artifact.compositionAttestation).not.toBeNull();
    const forged = structuredClone(artifact) as SplitArtifact;
    forged.compositionAttestation = "b".repeat(64);
    forged.splitDigest = await canonicalSha256(withoutSplitDigest(forged));
    await expect(
      validateSplitArtifact(forged, RELEASE_MANIFEST, RELEASE_DATASET),
    ).rejects.toMatchObject({
      code: "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MISMATCH",
    });
  });

  it("refuses an attestation on a corpus that is not release", async () => {
    // Publicar inventario de composicao para corpus que nao e release afirma algo que ninguem
    // tem direito de afirmar sobre ele.
    const forged = await resealed((artifact) => {
      artifact.compositionAttestation = "c".repeat(64);
    });
    expect(await codeOfFull(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_UNEXPECTED",
    );
  });

  it("refuses an audit that failed, coherently", async () => {
    // `passed: false` com razoes presentes e INTERNAMENTE coerente, entao a checagem de
    // coerencia aceita — o que recusa e a guarda que exige veredito aprovado.
    const forged = await resealed((artifact) => {
      artifact.audit.passed = false;
      artifact.audit.reasons = ["temporal leakage: invented"];
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_AUDIT_FAILED");
  });

  it("refuses a stale assignmentsDigest", async () => {
    const artifact = structuredClone(await buildRelease()) as SplitArtifact;
    artifact.assignmentsDigest = "d".repeat(64);
    artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
    expect(await codeOfFull(artifact)).toBe(
      "SPLIT_ARTIFACT_ASSIGNMENTS_DIGEST_MISMATCH",
    );
  });

  it("refuses a stale algorithmDigest even with the seal recomputed", async () => {
    const artifact = structuredClone(await buildRelease()) as SplitArtifact;
    artifact.algorithmDigest = "e".repeat(64);
    artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
    expect(await codeOfFull(artifact)).toBe(
      "SPLIT_ARTIFACT_ALGORITHM_DIGEST_MISMATCH",
    );
  });

  it("refuses an assignment for an id the dataset does not contain", async () => {
    const forged = await resealed((artifact) => {
      (artifact.assignments[0] as SplitAssignment).id = "id_que_nao_existe";
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_EXTRA_ASSIGNMENT");
  });

  it("refuses a dataset id left without an assignment", async () => {
    // As CONTAGENS acompanham a remocao, senao a incoerencia entre `counts` e a tally recusa
    // antes e o teste provaria outra coisa.
    const forged = await resealed((artifact) => {
      const removida = artifact.assignments[0] as SplitAssignment;
      artifact.assignments = artifact.assignments.slice(1);
      artifact.counts[removida.partition] -= 1;
      artifact.audit.sizes[removida.partition] -= 1;
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_MISSING_ASSIGNMENT");
  });

  it("accepts the honest artifact, so the refusals above are about the forgery", async () => {
    expect(await codeOfFull(await buildRelease())).toBe("ACCEPTED");
  });
});

// --- the publication path carries every dataset-independent check ---------------
//
// `publish-evidence` has no dataset, so the partial guard is the only one it can call. Every
// forgery below is decidable WITHOUT the dataset, which is why that guard alone must refuse it —
// and the refusal code names which invariant caught it, since several of these would also be
// refused later by re-derivation.
describe("assertSplitArtifactSelfConsistent covers what needs no dataset", () => {
  async function codeOfPartial(artifact: SplitArtifact): Promise<string> {
    try {
      await assertSplitArtifactSelfConsistent(artifact);
    } catch (error) {
      return (error as SplitArtifactError).code;
    }
    return "ACCEPTED";
  }

  it("refuses a passing verdict over reasons that remain", async () => {
    const forged = await resealed((artifact) => {
      artifact.audit.reasons = ["temporal leakage: invented"];
    });
    expect(await codeOfPartial(forged)).toBe("SPLIT_ARTIFACT_AUDIT_INCOHERENT");
  });

  it("refuses a duplicate assignment id even when the counts still add up", async () => {
    const forged = await resealed((artifact) => {
      const first = artifact.assignments[0] as SplitAssignment;
      const second = artifact.assignments[1] as SplitAssignment;
      // Same id twice in the same partition: `counts` stays coherent, so only a uniqueness
      // check separates this from a legitimate artifact.
      second.id = first.id;
      second.partition = first.partition;
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_DUPLICATE_ASSIGNMENT",
    );
  });

  it("refuses artifact boundaries that disagree with the audit's", async () => {
    const forged = await resealed((artifact) => {
      artifact.cutoffs = { ...artifact.cutoffs, latestTrain: 12_345 };
    });
    expect(await codeOfPartial(forged)).toBe("SPLIT_ARTIFACT_CUTOFFS_MISMATCH");
  });

  it("refuses an unknown root field, which no digest covers", async () => {
    // `splitDigest` seals a projection of KNOWN fields, so an extra root key is invisible to
    // it: the file re-verifies untouched while carrying payload nobody sealed. Only checking
    // the key SET catches it, which is why this runs before any digest is trusted.
    const smuggled = structuredClone(await buildRelease()) as SplitArtifact & {
      unsealedExtra?: string;
    };
    smuggled.unsealedExtra = "rides along unsealed";
    expect(await codeOfPartial(smuggled)).toBe("SPLIT_ARTIFACT_UNKNOWN_FIELD");
  });

  it("refuses a class label outside the closed vocabulary", async () => {
    // Re-sealed, so every digest recomputes. The per-class checks look up `human`, `ai` and
    // `mixed` individually and never ask what else the object holds, so an invented label
    // publishes fractions for a class the corpus has no vocabulary for.
    const forged = await resealed((artifact) => {
      (
        artifact.audit.classFractions as unknown as Record<string, unknown>
      ).robot = {
        train: 0.45,
        dev: 0.05,
        "cal-A": 0.1,
        "cal-B": 0.2,
        test: 0.2,
      };
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_UNKNOWN_CLASS_LABEL",
    );
  });

  it("refuses an unknown partition BEFORE it is used as a key, leaving Object.prototype clean", async () => {
    // `__proto__` as a partition name is not a hypothetical: the composition inventory keys by
    // the partition string, so on a plain object this assignment would write through to
    // `Object.prototype` and every later object in the process would inherit the entry. The
    // vocabulary check has to precede any use of the value, and the inventory uses `Map`.
    const forged = await resealed((artifact) => {
      (artifact.assignments[0] as SplitAssignment).partition =
        "__proto__" as Partition;
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_PARTITION_UNKNOWN",
    );
    expect(
      (Object.prototype as unknown as Record<string, unknown>).human,
    ).toBeUndefined();
  });

  it("refuses an attestation that is not a sha256, which the type cannot prevent", async () => {
    // A parsed file enters by cast, so `string | null` is a compile-time claim only.
    const forged = await resealed((artifact) => {
      (artifact as unknown as Record<string, unknown>).compositionAttestation =
        42;
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MALFORMED",
    );
  });

  it("refuses a seed that is not the pre-registered one, on the publication path too", async () => {
    // `publish-evidence` has no dataset, so it reaches this guard and nothing else. An
    // arbitrary seed needs no dataset to be refused.
    const forged = await resealed((artifact) => {
      artifact.seed = 99;
      artifact.policy = { ...artifact.policy, seed: 99 };
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_SEED_NOT_PRE_REGISTERED",
    );
  });

  it("refuses a __proto__ root key, which only a PARSED file can carry", async () => {
    // In an object literal `__proto__` sets the prototype instead of creating a key, so this
    // forgery exists only on parsed JSON — which is exactly how every command loads the
    // artifact. `key in allowed` would have called it permitted, because `in` walks the
    // prototype chain.
    const honest = await buildRelease();
    const smuggled = JSON.parse(
      JSON.stringify(honest).replace(/^\{/u, '{"__proto__":{"smuggled":true},'),
    ) as SplitArtifact;
    expect(await codeOfPartial(smuggled)).toBe("SPLIT_ARTIFACT_UNKNOWN_FIELD");
  });

  it("refuses a __proto__ class label on a parsed audit", async () => {
    const honest = await buildRelease();
    const smuggled = JSON.parse(
      JSON.stringify(honest).replace(
        '"classFractions":{',
        '"classFractions":{"__proto__":{"train":0.45,"dev":0.05,"cal-A":0.1,"cal-B":0.2,"test":0.2},',
      ),
    ) as SplitArtifact;
    expect(await codeOfPartial(smuggled)).toBe(
      "SPLIT_ARTIFACT_UNKNOWN_CLASS_LABEL",
    );
  });

  it("refuses an attestation whose toString lands on a digest", async () => {
    // `String(["<64 hex>"])` IS that hex string, so a coerced test accepts an array. The
    // check has to establish the type before it establishes the shape.
    const forged = await resealed((artifact) => {
      (artifact as unknown as Record<string, unknown>).compositionAttestation =
        ["a".repeat(64)];
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MALFORMED",
    );
  });

  it("refuses values whose TYPE the parsed file never established", async () => {
    // Key sets say which fields exist; they say nothing about what sits under them. A numeric
    // id, a fraction that is the string "0.45" and a string cutoff all satisfy every digest —
    // the file agrees with itself — and then reach the published evidence summary.
    const numericId = await resealed((artifact) => {
      (artifact.assignments[0] as unknown as Record<string, unknown>).id = 42;
    });
    expect(await codeOfPartial(numericId)).toBe(
      "SPLIT_ARTIFACT_ASSIGNMENT_ID_INVALID",
    );

    const stringFraction = await resealed((artifact) => {
      (
        artifact.audit.classFractions.human as unknown as Record<
          string,
          unknown
        >
      ).train = "0.45";
    });
    expect(await codeOfPartial(stringFraction)).toBe(
      "SPLIT_ARTIFACT_CLASS_FRACTION_INVALID",
    );

    // BOTH copies, so the agreement check between them passes and the type check is the only
    // thing left that can refuse it.
    const stringCutoff = await resealed((artifact) => {
      (artifact.cutoffs as unknown as Record<string, unknown>).latestTrain =
        "100";
      (
        artifact.audit.cutoffs as unknown as Record<string, unknown>
      ).latestTrain = "100";
    });
    expect(await codeOfPartial(stringCutoff)).toBe(
      "SPLIT_ARTIFACT_CUTOFFS_INVALID",
    );
  });

  it("refuses overlapping middle ranges whose latest values are still monotonic", async () => {
    // The relation the audit asserts is earliest-against-latest. Ordered ranges IMPLY
    // monotonic `latest`, and the converse does not hold: here `latestDev < latestCalA` while
    // cal-A starts before dev ends, so the two bands overlap and a check on `latest` alone
    // calls it ordered.
    const forged = await resealed((artifact) => {
      artifact.cutoffs = { ...artifact.cutoffs, earliestCalA: 1 };
      artifact.audit.cutoffs = { ...artifact.audit.cutoffs, earliestCalA: 1 };
    });
    expect(await codeOfPartial(forged)).toBe("SPLIT_ARTIFACT_AUDIT_INCOHERENT");
  });

  it("accepts the honest artifact, so the refusals above are about the forgery", async () => {
    expect(await codeOfPartial(await buildRelease())).toBe("ACCEPTED");
  });
});
