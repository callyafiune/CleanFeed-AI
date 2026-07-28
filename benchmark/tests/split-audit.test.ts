import { describe, expect, it } from "vitest";

import {
  CLUSTER_SLICE_AXES,
  auditBlockedSplit,
  type SplitAuditPolicy,
} from "../split-audit.ts";
import {
  createBlockedSplit,
  type BlockedSplitPolicy,
  type DatasetSplit,
} from "../split.ts";
import {
  V3_GROUP_AXES,
  type BenchmarkLabel,
  type BenchmarkRecord,
  type TransformationKind,
  type V3GroupAxis,
} from "../schema.ts";
import {
  asGeneratorFamily,
  normalizeGeneratorFamily,
} from "../generator-family.ts";

const SHA = "a".repeat(64);

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

// A release-scale corpus: >=4000 human negatives so the 50% blocked test carries
// >=2000, and every critical slice keeps >=300 negatives / >=200 positives.
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
  // A small unseen family, planted only in the newest slots. It stays a reported
  // recall slice but below the 200-positive gate, proving non-gating slices are
  // surfaced rather than dropped.
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

const RELEASE_DATASET = buildReleaseDataset();

const POLICY: BlockedSplitPolicy = {
  fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
  classTolerance: 0.02,
  heldOutGeneratorFamilies: [asGeneratorFamily("family-unseen")],
  seed: 712_019,
};

const AUDIT_POLICY: SplitAuditPolicy = {
  minimumTestHumanNegatives: 2_000,
  minimumCriticalFprNegatives: 300,
  minimumCriticalRecallPositives: 200,
  classTolerance: 0.02,
};

describe("auditBlockedSplit", () => {
  it("passes a leakage-safe release split and proves the minima", () => {
    const split = createBlockedSplit(RELEASE_DATASET, POLICY);
    const audit = auditBlockedSplit(RELEASE_DATASET, split, AUDIT_POLICY);

    expect(audit.leakages).toEqual([]);
    expect(audit.passed).toBe(true);
    expect(audit.reasons).toEqual([]);

    // The blocked test holds at least 2000 human negatives.
    const testHumanNegatives = split.test.filter(
      (row) => row.label === "human",
    ).length;
    expect(testHumanNegatives).toBeGreaterThanOrEqual(2_000);

    // Per-class 20/30/50 within two percentage points.
    for (const label of ["human", "ai", "mixed"] as const) {
      expect(
        Math.abs(audit.classFractions[label].development - 0.2),
      ).toBeLessThanOrEqual(0.02);
      expect(
        Math.abs(audit.classFractions[label].calibration - 0.3),
      ).toBeLessThanOrEqual(0.02);
      expect(
        Math.abs(audit.classFractions[label].test - 0.5),
      ).toBeLessThanOrEqual(0.02);
    }

    // Temporal ordering: the test is strictly the latest slice.
    expect(audit.cutoffs.earliestTest).toBeGreaterThan(
      audit.cutoffs.latestCalibration,
    );
    expect(audit.cutoffs.earliestTest).toBeGreaterThan(
      audit.cutoffs.latestDevelopment,
    );

    // The reserved family is discovered as unseen straight from the split.
    expect(audit.heldOutGeneratorFamilies).toContain("family-unseen");
  });

  it("marks large critical slices gate-eligible and small ones non-gating", () => {
    const split = createBlockedSplit(RELEASE_DATASET, POLICY);
    const audit = auditBlockedSplit(RELEASE_DATASET, split, AUDIT_POLICY);

    const corporateFpr = audit.criticalSliceSamples.find(
      (slice) => slice.axis === "domain" && slice.key === "corporate",
    );
    expect(corporateFpr).toBeDefined();
    expect(corporateFpr!.negatives).toBeGreaterThanOrEqual(300);
    expect(corporateFpr!.fprGateEligible).toBe(true);

    const seenExposure = audit.criticalSliceSamples.find(
      (slice) => slice.axis === "generatorExposure" && slice.key === "seen",
    );
    expect(seenExposure).toBeDefined();
    expect(seenExposure!.positives).toBeGreaterThanOrEqual(200);
    expect(seenExposure!.recallGateEligible).toBe(true);

    // The reserved family is tiny on purpose: it is reported but cannot gate.
    const unseenExposure = audit.criticalSliceSamples.find(
      (slice) => slice.axis === "generatorExposure" && slice.key === "unseen",
    );
    expect(unseenExposure).toBeDefined();
    expect(unseenExposure!.positives).toBeLessThan(200);
    expect(unseenExposure!.recallGateEligible).toBe(false);
  });

  it("rejects a deliberately author-leaking split (teeth on grouping)", () => {
    const split = createBlockedSplit(RELEASE_DATASET, POLICY);
    // Move one development record into test while its five slot siblings stay
    // behind, so its author/source/domainSource values now straddle two
    // partitions. A blind auditor would miss it; this one must not.
    const victim = split.development.find((row) => row.label === "human");
    expect(victim).toBeDefined();
    const leaking: DatasetSplit<BenchmarkRecord> = {
      development: split.development.filter((row) => row.id !== victim!.id),
      calibration: split.calibration,
      test: [...split.test, victim!],
    };
    const audit = auditBlockedSplit(RELEASE_DATASET, leaking, AUDIT_POLICY);

    expect(audit.leakages.length).toBeGreaterThan(0);
    expect(audit.leakages.some((entry) => entry.axis === "source")).toBe(true);
    expect(audit.passed).toBe(false);
    expect(audit.reasons.some((reason) => /leak/i.test(reason))).toBe(true);
  });

  it("rejects a depth-2 derivation chain that straddles partitions (teeth on parent linkage)", () => {
    // A <- B <- C. A and B are self/child on ROOTAAA (share a derivationRoot
    // value); C is a child of B, so it only ever names B's id — never ROOTAAA.
    // No single value-axis reveals that C is a derivative of A's family. Put the
    // grandparent chain in development and the grandchild in test.
    const a = rec({
      id: "ROOTAAA",
      label: "human",
      createdAt: 1,
      domain: "corporate",
      wordCount: 100,
      author: "auth_a",
      source: "src_a",
      domainSource: "ds_a",
      collectionBatch: "cb_a",
      nearDuplicate: "nd_a",
      derivationRoot: "ROOTAAA",
    });
    const b = rec({
      id: "MIDBBBB",
      label: "human",
      createdAt: 2,
      domain: "corporate",
      wordCount: 100,
      author: "auth_b",
      source: "src_b",
      domainSource: "ds_b",
      collectionBatch: "cb_b",
      nearDuplicate: "nd_b",
      derivationRoot: "ROOTAAA",
    });
    const c = rec({
      id: "LEAFCCC",
      label: "ai",
      createdAt: 3,
      domain: "corporate",
      wordCount: 100,
      family: "family-seen",
      author: "auth_c",
      source: "src_c",
      domainSource: "ds_c",
      collectionBatch: "cb_c",
      nearDuplicate: "nd_c",
      derivationRoot: "MIDBBBB",
    });
    const records = [a, b, c];
    const split: DatasetSplit<BenchmarkRecord> = {
      development: [a, b],
      calibration: [],
      test: [c],
    };
    const audit = auditBlockedSplit(records, split, AUDIT_POLICY);

    // No single grouping value-axis catches it...
    expect(
      audit.leakages.some((entry) => entry.axis === "derivationRoot"),
    ).toBe(false);
    // ...but the shared connectivity check (parent linkage) does.
    expect(
      audit.leakages.some((entry) => entry.axis === "connectedComponent"),
    ).toBe(true);
    expect(audit.passed).toBe(false);
    expect(audit.reasons.some((reason) => /leak/i.test(reason))).toBe(true);
  });

  it("rejects a temporally leaking split even without group leakage (teeth on time)", () => {
    // Unique groups everywhere, so the only defect is a test record older than a
    // calibration record. The audit must still refuse it.
    const dev = rec({
      id: "dev1",
      label: "human",
      createdAt: 1,
      domain: "corporate",
      wordCount: 100,
      author: "auth_dev",
      source: "src_dev",
      domainSource: "ds_dev",
      collectionBatch: "cb_dev",
      nearDuplicate: "nd_dev",
      derivationRoot: "dev1",
    });
    const cal = rec({
      id: "cal1",
      label: "human",
      createdAt: 5,
      domain: "corporate",
      wordCount: 100,
      author: "auth_cal",
      source: "src_cal",
      domainSource: "ds_cal",
      collectionBatch: "cb_cal",
      nearDuplicate: "nd_cal",
      derivationRoot: "cal1",
    });
    const test = rec({
      id: "test1",
      label: "ai",
      createdAt: 3,
      domain: "corporate",
      wordCount: 100,
      family: "family-seen",
      author: "auth_test",
      source: "src_test",
      domainSource: "ds_test",
      collectionBatch: "cb_test",
      nearDuplicate: "nd_test",
      derivationRoot: "test1",
    });
    const records = [dev, cal, test];
    const split: DatasetSplit<BenchmarkRecord> = {
      development: [dev],
      calibration: [cal],
      test: [test],
    };
    const audit = auditBlockedSplit(records, split, AUDIT_POLICY);

    expect(audit.leakages).toEqual([]);
    expect(audit.cutoffs.earliestTest).toBeLessThanOrEqual(
      audit.cutoffs.latestCalibration,
    );
    expect(audit.passed).toBe(false);
    expect(audit.reasons.some((reason) => /temporal|newer/i.test(reason))).toBe(
      true,
    );
  });

  it("fails a split whose blocked test has too few human negatives", () => {
    // A human-light corpus: only 100 human records total, so the 50% blocked
    // test can never reach the 2000-negative floor.
    const tiny: BenchmarkRecord[] = [];
    for (let slot = 1; slot <= 100; slot += 1) {
      tiny.push(
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

    const noHoldout: BlockedSplitPolicy = {
      fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
      classTolerance: 0.02,
      heldOutGeneratorFamilies: [],
      seed: 1,
    };
    const split = createBlockedSplit(tiny, noHoldout);
    const audit = auditBlockedSplit(tiny, split, AUDIT_POLICY);

    expect(audit.leakages).toEqual([]);
    expect(audit.passed).toBe(false);
    expect(audit.reasons.some((reason) => /negative/i.test(reason))).toBe(true);
  });
});

// --- C3: the audit publishes real cluster counts, not `leakages: []` ---------

describe("the cluster report the audit publishes", () => {
  it("counts independent clusters per axis and per slice, with the largest", () => {
    const split = createBlockedSplit(RELEASE_DATASET, POLICY);
    const audit = auditBlockedSplit(RELEASE_DATASET, split, AUDIT_POLICY);

    // Every declared axis is reported, whether or not this corpus fills it: an
    // axis that is absent from the report is an axis nobody can gate on.
    expect(audit.clusters.axes.map((row) => row.axis)).toEqual([
      ...V3_GROUP_AXES,
    ]);

    const source = audit.clusters.axes.find((row) => row.axis === "source");
    expect(source).toBeDefined();
    // 100 human slots + 100 ai + 100 mixed + 5*4 unseen source values.
    expect(source!.overall.groups).toBe(320);
    // The slot siblings really do share a source, so the distribution is a
    // measurement rather than the tautology `leakages: []` used to be.
    expect(source!.overall.largest).toBeGreaterThan(1);
    expect(source!.overall.recordLines).toBe(RELEASE_DATASET.length);
    expect(source!.connectivityAxis).toBe(true);

    // The connected component — the union of the applicable axes — is the split
    // and exposure cluster, and it is what E3 will gate on.
    expect(audit.clusters.connected.overall.groups).toBeGreaterThan(1);
    expect(audit.clusters.connected.overall.groups).toBeLessThan(
      RELEASE_DATASET.length,
    );
    expect(audit.clusters.connected.overall.recordLines).toBe(
      RELEASE_DATASET.length,
    );

    // Per slice: every declared slice axis appears, and the partition slice
    // accounts for exactly the whole corpus.
    const slices = new Set(
      audit.clusters.connected.bySlice.map((row) => row.slice),
    );
    for (const axis of CLUSTER_SLICE_AXES) expect(slices).toContain(axis);
    const partitionRecords = audit.clusters.connected.bySlice
      .filter((row) => row.slice === "partition")
      .reduce((total, row) => total + row.count.recordLines, 0);
    expect(partitionRecords).toBe(RELEASE_DATASET.length);
  });

  it("does not fail an axis that is legitimately all singletons or absent", () => {
    const split = createBlockedSplit(RELEASE_DATASET, POLICY);
    const audit = auditBlockedSplit(RELEASE_DATASET, split, AUDIT_POLICY);

    const nearDuplicate = audit.clusters.axes.find(
      (row) => row.axis === "nearDuplicate",
    );
    expect(nearDuplicate!.overall.largest).toBe(1);
    expect(nearDuplicate!.overall.singletons).toBe(nearDuplicate!.overall.groups);

    // `harnessVersion` is a v3 axis no v2 record carries: it reads as `unknown`
    // for every row, and that is a description of the corpus, not a defect the
    // audit invents a failure for (R6).
    const harness = audit.clusters.axes.find(
      (row) => row.axis === "harnessVersion",
    );
    expect(harness!.overall.groups).toBe(0);

    expect(audit.passed).toBe(true);
    expect(audit.reasons).toEqual([]);
  });
});

// --- C3 acceptance 7: a declared axis left `unknown` fails the audit ---------

const V3_SHA = "d".repeat(64);

function v3Axis(
  state: "known" | "notApplicable" | "unknown",
  value: string,
): { state: "known"; id: string } | { state: "notApplicable" | "unknown"; reason: string } {
  return state === "known"
    ? { state: "known", id: value }
    : { state, reason: value };
}

interface V3Spec {
  id: string;
  createdAt: number;
  sourceId: string;
  authorState: "known" | "notApplicable" | "unknown";
}

// A minimal v3 human record: the only thing under test is the state of a
// declared axis, so everything else is the honest constant shape C2 emits.
function v3Human(spec: V3Spec): BenchmarkRecord {
  const notOurs = "human record: no generator produced this text";
  return {
    schemaVersion: 3,
    id: spec.id,
    text: `texto ${spec.id}`,
    normalizedTextSha256: V3_SHA,
    label: "human",
    language: "pt-BR",
    platform: "generic",
    domain: "qa-informal",
    topic: "programacao",
    humanSourceType: "qa-informal",
    wordCount: 120,
    createdAt: spec.createdAt,
    labelBasis: "date-cutoff",
    provenance: {
      sourceKind: "licensed-corpus",
      sourceId: spec.sourceId,
      sourceRevision: "rev_001",
      collectedAt: spec.createdAt,
      licenseId: "cc-by-sa-4.0",
      legalBasis: "license",
    },
    review: {
      state: "automated/unreviewed",
      automatedFilters: [
        {
          filter: "pii-pattern-scan",
          implementation: "benchmark/lab/common.py:pii_hits",
          outcome: "passed",
        },
      ],
      humanAuditAbsentReason:
        "no human reviewer was assigned to this corpus build; only the automated filters ran",
    },
    transformation: { kind: "none", severity: "none" },
    groups: {
      author: v3Axis(
        spec.authorState,
        spec.authorState === "known"
          ? `person_${spec.id.padEnd(16, "0").slice(0, 16)}`
          : spec.authorState === "notApplicable"
            ? "collectively written: this source names no single author"
            : "the extractor did not recover the account for this row",
      ),
      source: v3Axis("known", `th_${spec.id}`),
      domainSource: v3Axis("known", "ds_ptso_qa"),
      humanSeed: v3Axis(
        "notApplicable",
        "a human record is not seeded by another text",
      ),
      promptTemplate: v3Axis("notApplicable", notOurs),
      generatorFamily: v3Axis("notApplicable", notOurs),
      generatorVersion: v3Axis("notApplicable", notOurs),
      generationLane: v3Axis("notApplicable", notOurs),
      harnessVersion: v3Axis("notApplicable", notOurs),
      collectionBatch: v3Axis("known", "cb_ptso_20260727"),
      nearDuplicate: v3Axis("known", `nd_${spec.id}`),
      derivationRoot: v3Axis(
        "notApplicable",
        "original human text, not derived from another record",
      ),
    },
  } as unknown as BenchmarkRecord;
}

const DECLARED: ReadonlyMap<string, readonly V3GroupAxis[]> = new Map([
  ["src_ptso", ["author", "source"] as readonly V3GroupAxis[]],
]);

function v3Split(
  authorState: "known" | "notApplicable" | "unknown",
): {
  records: BenchmarkRecord[];
  split: DatasetSplit<BenchmarkRecord>;
} {
  const dev = v3Human({
    id: "d1",
    createdAt: 1,
    sourceId: "src_ptso",
    authorState,
  });
  const cal = v3Human({
    id: "c1",
    createdAt: 2,
    sourceId: "src_ptso",
    authorState: "known",
  });
  const test = v3Human({
    id: "t1",
    createdAt: 3,
    sourceId: "src_ptso",
    authorState: "known",
  });
  return {
    records: [dev, cal, test],
    split: { development: [dev], calibration: [cal], test: [test] },
  };
}

// A generated row whose ONLY link to the corpus is the human text that seeded it.
// Every other axis is distinct, so nothing but the seed can glue the two.
function v3Generated(spec: { id: string; createdAt: number; seedId: string }): BenchmarkRecord {
  const notOurs = "generated text has no human author";
  return {
    schemaVersion: 3,
    id: spec.id,
    text: `gerado ${spec.id}`,
    normalizedTextSha256: "e".repeat(64),
    label: "ai",
    language: "pt-BR",
    platform: "generic",
    domain: "qa-informal",
    topic: "programacao",
    wordCount: 120,
    createdAt: spec.createdAt,
    provenance: {
      sourceKind: "controlled-generation",
      sourceId: "src_ai_agy",
      sourceRevision: "rev_001",
      collectedAt: spec.createdAt,
      licenseId: "autoria-propria-v1",
      legalBasis: "generated",
    },
    review: {
      state: "automated/unreviewed",
      automatedFilters: [
        {
          filter: "pii-pattern-scan",
          implementation: "benchmark/lab/common.py:pii_hits",
          outcome: "passed",
        },
      ],
      humanAuditAbsentReason:
        "no human reviewer was assigned to this corpus build; only the automated filters ran",
    },
    transformation: { kind: "none", severity: "none" },
    groups: {
      author: v3Axis("notApplicable", notOurs),
      source: v3Axis("notApplicable", "generated text has no source document"),
      domainSource: v3Axis("known", `ds_${spec.id}`),
      humanSeed: v3Axis("known", spec.seedId),
      promptTemplate: v3Axis("known", `pt_${spec.id}`),
      generatorFamily: v3Axis("known", "gemini-3_5-flash-medium"),
      generatorVersion: v3Axis("known", `gv_${spec.id}`),
      generationLane: v3Axis("known", "agy"),
      harnessVersion: v3Axis("known", `agy_${spec.id}`),
      collectionBatch: v3Axis("known", `gb_${spec.id}`),
      nearDuplicate: v3Axis("known", `nd_${spec.id}`),
      derivationRoot: v3Axis(
        "notApplicable",
        "the original recipe generates fresh text rather than deriving it",
      ),
    },
  } as unknown as BenchmarkRecord;
}

describe("the seed that produced a generation", () => {
  it("glues the generation to its human seed, so the lineage cannot straddle partitions", () => {
    // The human text is in development and the text it seeded is in test. No value
    // axis is shared, and `derivationRoot` is notApplicable on the child because
    // the `original` recipe generates fresh text rather than deriving it — so the
    // ONLY thing that can catch this is the humanSeed parent linkage.
    const seed = v3Human({
      id: "h1",
      createdAt: 1,
      sourceId: "src_ptso",
      authorState: "known",
    });
    const generated = v3Generated({ id: "g1", createdAt: 3, seedId: "h1" });
    const records = [seed, generated];
    const audit = auditBlockedSplit(
      records,
      { development: [seed], calibration: [], test: [generated] },
      AUDIT_POLICY,
    );

    expect(audit.leakages.some((entry) => entry.axis === "humanSeed")).toBe(
      false,
    );
    expect(
      audit.leakages.some((entry) => entry.axis === "connectedComponent"),
    ).toBe(true);
    expect(audit.passed).toBe(false);

    // And the cluster report counts them as ONE cluster, not two.
    expect(audit.clusters.connected.overall.groups).toBe(1);
  });

  it("leaves a seed that is absent from the corpus alone", () => {
    // C2 measured 782 of 783 parent references resolving to no row. An absent
    // parent must not invent a cluster, and must not refuse the row either.
    const generated = v3Generated({ id: "g1", createdAt: 3, seedId: "absent" });
    const other = v3Generated({ id: "g2", createdAt: 4, seedId: "also-absent" });
    const roots = auditBlockedSplit(
      [generated, other],
      { development: [generated], calibration: [], test: [other] },
      AUDIT_POLICY,
    );
    expect(
      roots.leakages.some((entry) => entry.axis === "connectedComponent"),
    ).toBe(false);
    expect(roots.clusters.connected.overall.groups).toBe(2);
  });
});

describe("a grouping axis the source declared", () => {
  it("fails the audit when a record leaves it unknown", () => {
    const { records, split } = v3Split("unknown");
    const audit = auditBlockedSplit(records, split, AUDIT_POLICY, DECLARED);

    expect(audit.declaredAxisGaps).toEqual([
      {
        sourceId: "src_ptso",
        axis: "author",
        state: "unknown",
        recordLines: 1,
      },
    ]);
    expect(
      audit.reasons.some((reason) => /declares axis "author"/.test(reason)),
    ).toBe(true);
    expect(audit.passed).toBe(false);
  });

  it("passes when the record states notApplicable, which is legitimate", () => {
    const { records, split } = v3Split("notApplicable");
    const audit = auditBlockedSplit(records, split, AUDIT_POLICY, DECLARED);

    expect(audit.declaredAxisGaps).toEqual([]);
    expect(
      audit.reasons.some((reason) => /declares axis/.test(reason)),
    ).toBe(false);
  });

  it("says nothing about an axis no source declared", () => {
    const { records, split } = v3Split("unknown");
    const audit = auditBlockedSplit(records, split, AUDIT_POLICY);

    expect(audit.declaredAxisGaps).toEqual([]);
    expect(
      audit.reasons.some((reason) => /declares axis/.test(reason)),
    ).toBe(false);
  });
});
