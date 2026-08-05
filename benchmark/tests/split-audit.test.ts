import { describe, expect, it } from "vitest";

import {
  AUDITED_PARTITIONS,
  CLUSTER_SLICE_AXES,
  DECLARED_GROUP_AXES,
  REPORTED_GROUP_AXES,
  auditBlockedSplit,
  standInClusterReport,
  type AxisClusterReport,
  type AxisConnectivity,
  type LinkageResolution,
  type SplitAuditPolicy,
} from "../split-audit.ts";
import {
  GROUP_KEYS,
  PARTITIONS,
  axisConnectivity,
  connectedComponentRoots,
  createBlockedSplit,
  type BlockedSplitPolicy,
  type DatasetSplit,
  type Partition,
} from "../split.ts";
import { describeSplitProportions } from "../commands/split.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import {
  ALL_GROUP_AXES,
  V3_GROUP_AXES,
  V4_GROUP_AXES,
  validateBenchmarkRecordV3,
  validateBenchmarkRecordV4,
  type BenchmarkLabel,
  type BenchmarkRecord,
  type GroupAxis,
  type TransformationKind,
} from "../schema.ts";
import {
  known,
  unknownAxis,
  v3Ai,
  v4Human,
  v4MixedEcological,
  withAxis,
} from "./helpers/v3-record-fixture.ts";
import {
  asGeneratorFamily,
  assertGeneratorFamiliesEqual,
  normalizeGeneratorFamily,
  type GeneratorFamily,
} from "../generator-family.ts";

// A corpus that reserved nothing. Stated rather than omitted: the audit derives the
// reservation the partitions HONOR, so it has to be told what was reserved, and an
// empty list is the fact "no family was reserved" — not a forgotten argument.
const NO_RESERVATION: readonly GeneratorFamily[] = [];

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

// A release-scale corpus: enough human negatives that the 20% blocked test still
// carries >=2000, and every critical slice keeps >=300 negatives / >=200 positives.
function buildReleaseDataset(): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  const SLOTS = 100;
  // 105 per slot, not 46. The reporting threshold is 2000 human negatives INSIDE the
  // blocked test and test is 20% of the corpus, so the smallest corpus that can reach
  // the threshold holds about 10k humans. That is a consequence of the five-partition
  // proportions, not of this fixture, and it is the same arithmetic
  // the real corpus has to satisfy.
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

// The pre-registered proportions, restated here on purpose. A test that imports the
// same constant the audit reads cannot fail when that constant moves, which is the one
// failure this table exists to cause.
const TARGET_FRACTIONS: ReadonlyArray<readonly [Partition, number]> = [
  ["train", 0.45],
  ["dev", 0.05],
  ["cal-A", 0.1],
  ["cal-B", 0.2],
  ["test", 0.2],
];

const AUDIT_POLICY: SplitAuditPolicy = {
  minimumTestHumanNegatives: 2_000,
  minimumCriticalFprNegatives: 300,
  minimumCriticalRecallPositives: 200,
  classTolerance: 0.02,
};

describe("auditBlockedSplit", () => {
  it("passes a leakage-safe release split and proves the minima", () => {
    const split = createBlockedSplit(RELEASE_DATASET, POLICY);
    const audit = auditBlockedSplit(
      RELEASE_DATASET,
      split,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );

    expect(audit.leakages).toEqual([]);
    expect(audit.passed).toBe(true);
    expect(audit.reasons).toEqual([]);

    // The blocked test holds at least 2000 human negatives.
    const testHumanNegatives = split.test.filter(
      (row) => row.label === "human",
    ).length;
    expect(testHumanNegatives).toBeGreaterThanOrEqual(2_000);

    // Per-class 45/5/10/20/20 within two percentage points, every partition.
    for (const label of ["human", "ai", "mixed"] as const) {
      for (const [partition, target] of TARGET_FRACTIONS) {
        expect(
          Math.abs(audit.classFractions[label][partition] - target),
          `${label} ${partition}`,
        ).toBeLessThanOrEqual(0.02);
      }
    }

    // Temporal ordering: test is strictly the latest slice, against EACH of the other
    // four rather than against the newest of them.
    expect(audit.cutoffs.earliestTest).toBeGreaterThan(
      audit.cutoffs.latestTrain,
    );
    expect(audit.cutoffs.earliestTest).toBeGreaterThan(audit.cutoffs.latestDev);
    expect(audit.cutoffs.earliestTest).toBeGreaterThan(
      audit.cutoffs.latestCalA,
    );
    expect(audit.cutoffs.earliestTest).toBeGreaterThan(
      audit.cutoffs.latestCalB,
    );

    // The reserved family is discovered as unseen straight from the split.
    expect(audit.heldOutGeneratorFamilies).toContain("family-unseen");
  });

  it("marks large critical slices gate-eligible and small ones non-gating", () => {
    const split = createBlockedSplit(RELEASE_DATASET, POLICY);
    const audit = auditBlockedSplit(
      RELEASE_DATASET,
      split,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );

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
    // Move one train record into test while its slot siblings stay behind, so its
    // author, source and near-duplicate values now straddle two partitions. A blind
    // auditor would miss it; this one must not.
    const victim = split.train.find((row) => row.label === "human");
    expect(victim).toBeDefined();
    const leaking: DatasetSplit<BenchmarkRecord> = {
      ...split,
      train: split.train.filter((row) => row.id !== victim!.id),
      test: [...split.test, victim!],
    };
    const audit = auditBlockedSplit(
      RELEASE_DATASET,
      leaking,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );

    expect(audit.leakages.length).toBeGreaterThan(0);
    expect(audit.leakages.some((entry) => entry.axis === "source")).toBe(true);
    expect(audit.passed).toBe(false);
    expect(audit.reasons.some((reason) => /leak/i.test(reason))).toBe(true);
  });

  it("rejects a depth-2 derivation chain that straddles partitions (teeth on parent linkage)", () => {
    // A <- B <- C. A and B are self/child on ROOTAAA (share a derivationRoot
    // value); C is a child of B, so it only ever names B's id — never ROOTAAA.
    // No single value-axis reveals that C is a derivative of A's family. Put the
    // grandparent chain in train and the grandchild in test.
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
      train: [a, b],
      dev: [],
      "cal-A": [],
      "cal-B": [],
      test: [c],
    };
    const audit = auditBlockedSplit(
      records,
      split,
      AUDIT_POLICY,
      NO_RESERVATION,
    );

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
    // cal-A record. The audit must still refuse it.
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
      train: [dev],
      dev: [cal],
      "cal-A": [],
      "cal-B": [],
      test: [test],
    };
    const audit = auditBlockedSplit(
      records,
      split,
      AUDIT_POLICY,
      NO_RESERVATION,
    );

    expect(audit.leakages).toEqual([]);
    expect(audit.cutoffs.earliestTest).toBeLessThanOrEqual(
      audit.cutoffs.latestDev,
    );
    expect(audit.passed).toBe(false);
    expect(audit.reasons.some((reason) => /temporal|newer/i.test(reason))).toBe(
      true,
    );
  });

  it("publishes an insufficient human-negative offer instead of failing on it", () => {
    // A human-light corpus: only 100 human records total, so the 20% blocked
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
      fractions: {
        train: 0.45,
        dev: 0.05,
        "cal-A": 0.1,
        "cal-B": 0.2,
        test: 0.2,
      },
      classTolerance: 0.02,
      heldOutGeneratorFamilies: [],
      seed: 1,
    };
    const split = createBlockedSplit(tiny, noHoldout);
    const audit = auditBlockedSplit(tiny, split, AUDIT_POLICY, NO_RESERVATION);

    // The count is PUBLISHED and the split still freezes. As a failure it would be
    // unsatisfiable by any corpus the repository can seal: the frozen composition is 4000
    // human records and the blind block is 20% of it, so `test` holds at most 880 against
    // a threshold of 2000. It would also put a power gate inside the audit, which this
    // module's contract forbids. The sufficiency comparison lives outside it, against the
    // pre-registered floor, and counts independent clusters per quota cell.
    expect(audit.leakages).toEqual([]);
    expect(audit.testHumanNegatives.count).toBeLessThan(2_000);
    expect(audit.testHumanNegatives.reportingThreshold).toBe(2_000);
    expect(audit.testHumanNegatives.sufficientForReleaseFpr).toBe(false);
    expect(
      audit.reasons.some((reason) => /negative/i.test(reason)),
      "an insufficient offer is reported, never a refusal",
    ).toBe(false);
  });
});

// --- C3: the audit publishes real cluster counts, not `leakages: []` ---------

describe("the cluster report the audit publishes", () => {
  it("counts independent clusters per axis and per slice, with the largest", () => {
    const split = createBlockedSplit(RELEASE_DATASET, POLICY);
    const audit = auditBlockedSplit(
      RELEASE_DATASET,
      split,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );

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
    expect(source!.connectivity.sharedValue).toBe(true);

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

  it("reports connectivity as the two relations it is, never as one flag", () => {
    const split = createBlockedSplit(RELEASE_DATASET, POLICY);
    const audit = auditBlockedSplit(
      RELEASE_DATASET,
      split,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );
    // The two RELATIONS alone: `linkage` is the measurement of the conditional one
    // and has its own test below. The return annotation is the re-exported
    // `AxisConnectivity`, so if split.ts ever adds a third relation this helper
    // stops compiling instead of quietly asserting two out of three.
    const connectivityOf = (axis: string): AxisConnectivity => {
      const { sharedValue, parentLinkage } = audit.clusters.axes.find(
        (row) => row.axis === axis,
      )!.connectivity;
      return { sharedValue, parentLinkage };
    };

    // `source` is a VALUE axis: two rows carrying the same identity are unioned,
    // unconditionally, and nothing has to be present for that to happen.
    expect(connectivityOf("source")).toEqual({
      sharedValue: true,
      parentLinkage: false,
    });

    // `humanSeed` is followed ONLY as parent linkage, and linkage is conditional:
    // it unions a row with the row its seed NAMES, and only when that row is in
    // the same record set. Publishing one boolean over both relations claimed
    // rows sharing a seed VALUE are one indivisible block, which is false — see
    // the absent-seed case below.
    expect(connectivityOf("humanSeed")).toEqual({
      sharedValue: false,
      parentLinkage: true,
    });

    // `derivationRoot` is genuinely both, and the two flags say so instead of
    // one of the relations hiding the other.
    expect(connectivityOf("derivationRoot")).toEqual({
      sharedValue: true,
      parentLinkage: true,
    });

    // And both stay false for the axes the splitter deliberately refuses to
    // union on, because unioning would collapse a whole family or lane.
    expect(connectivityOf("generatorFamily")).toEqual({
      sharedValue: false,
      parentLinkage: false,
    });
    expect(connectivityOf("generationLane")).toEqual({
      sharedValue: false,
      parentLinkage: false,
    });

    // The fixture stand-in must agree, or a hand-built audit would carry a
    // different claim from a measured one.
    const standIn = standInClusterReport(V3_GROUP_AXES);
    expect(
      standIn.axes.find((row) => row.axis === "humanSeed")!.connectivity,
    ).toEqual({
      sharedValue: false,
      parentLinkage: true,
      linkage: {
        references: 0,
        joinedAnotherRecordLine: 0,
        selfReference: 0,
        absentFromRecordSet: 0,
      },
    });
  });

  it("does not fail an axis that is legitimately all singletons or absent", () => {
    const split = createBlockedSplit(RELEASE_DATASET, POLICY);
    const audit = auditBlockedSplit(
      RELEASE_DATASET,
      split,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );

    const nearDuplicate = audit.clusters.axes.find(
      (row) => row.axis === "nearDuplicate",
    );
    expect(nearDuplicate!.overall.largest).toBe(1);
    expect(nearDuplicate!.overall.singletons).toBe(
      nearDuplicate!.overall.groups,
    );

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
):
  | { state: "known"; id: string }
  | { state: "notApplicable" | "unknown"; reason: string } {
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

const DECLARED: ReadonlyMap<string, readonly GroupAxis[]> = new Map([
  ["src_ptso", ["author", "source"] as readonly GroupAxis[]],
]);

function v3Split(authorState: "known" | "notApplicable" | "unknown"): {
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
    split: {
      train: [dev],
      dev: [cal],
      "cal-A": [],
      "cal-B": [],
      test: [test],
    },
  };
}

// A generated row whose ONLY link to the corpus is the human text that seeded it.
// Every other axis is distinct, so nothing but the seed can glue the two.
function v3Generated(spec: {
  id: string;
  createdAt: number;
  seedId: string;
}): BenchmarkRecord {
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
    // The human text is in train and the text it seeded is in test. No value
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
      {
        train: [seed],
        dev: [],
        "cal-A": [],
        "cal-B": [],
        test: [generated],
      },
      AUDIT_POLICY,
      NO_RESERVATION,
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
    const other = v3Generated({
      id: "g2",
      createdAt: 4,
      seedId: "also-absent",
    });
    const roots = auditBlockedSplit(
      [generated, other],
      {
        train: [generated],
        dev: [],
        "cal-A": [],
        "cal-B": [],
        test: [other],
      },
      AUDIT_POLICY,
      NO_RESERVATION,
    );
    expect(
      roots.leakages.some((entry) => entry.axis === "connectedComponent"),
    ).toBe(false);
    expect(roots.clusters.connected.overall.groups).toBe(2);
  });
});

// --- the absent parent: linkage is CONDITIONAL, and the report must say so ---

/**
 * A v3 generated row, SCHEMA-VALIDATED, whose only tie to anything is `seedId`.
 * Every value axis is per-row, so no shared value can union two of these.
 */
function seededRow(
  id: string,
  seedId: string,
  createdAt: number,
): BenchmarkRecord {
  let raw: Record<string, unknown> = { ...v3Ai(), id, createdAt };
  raw = withAxis(raw, "humanSeed", known(seedId));
  raw = withAxis(raw, "domainSource", known(`ds_${id}`));
  raw = withAxis(raw, "promptTemplate", known(`pt_${id}`));
  raw = withAxis(raw, "generatorVersion", known(`gv_${id}`));
  raw = withAxis(raw, "collectionBatch", known(`cb_${id}`));
  raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
  return validateBenchmarkRecordV3(raw) as unknown as BenchmarkRecord;
}

/**
 * The published `linkage`, read WITHOUT a non-null assertion.
 *
 * The discriminant is a literal in each branch of `AxisConnectivityReport`, so
 * checking `parentLinkage` narrows `linkage` to `LinkageResolution` — which is the
 * whole point of moving it behind the flag. When it was a sibling field typed
 * `LinkageResolution | null`, these three assertions read `linkage!` and the check
 * would have bought no narrowing anyway.
 */
function linkageOf(report: AxisClusterReport): LinkageResolution {
  const { connectivity } = report;
  if (!connectivity.parentLinkage) {
    throw new Error(`${report.axis} is not followed as parent linkage`);
  }
  return connectivity.linkage;
}

describe("two rows naming a seed no record carries", () => {
  it("is never published as one indivisible block on humanSeed", () => {
    // The fixture C2's measurement makes the COMMON case, not the exotic one:
    // 782 of 783 parent references resolved to no row of the assembled corpus.
    const g1 = seededRow("g_1", "h_absent", 1);
    const g2 = seededRow("g_2", "h_absent", 2);
    const records = [g1, g2];
    const audit = auditBlockedSplit(
      records,
      {
        train: [g1],
        dev: [],
        "cal-A": [],
        "cal-B": [],
        test: [g2],
      },
      AUDIT_POLICY,
      NO_RESERVATION,
    );
    const seed = audit.clusters.axes.find((row) => row.axis === "humanSeed")!;

    // The IDENTITY is shared — one group of two record-lines on this axis...
    expect(seed.overall).toEqual({
      groups: 1,
      largest: 2,
      singletons: 0,
      recordLines: 2,
    });
    // ...and yet the splitter put the two rows on opposite sides of the test cut,
    // because linkage needs the named row to be PRESENT. A single
    // `connectivityAxis: true` next to `largest: 2` read as "one indivisible
    // block of 2 on an axis the splitter unions on", which is the dangerous
    // direction to be wrong in: D0b would size the stratum as if the seed and
    // its generation were one unit here.
    //
    // Asserted as ONE object, because the measurement is what settles the flag and
    // the two travel together in the published artifact: zero of the two references
    // joined anything.
    expect(seed.connectivity).toEqual({
      sharedValue: false,
      parentLinkage: true,
      linkage: {
        references: 2,
        joinedAnotherRecordLine: 0,
        selfReference: 0,
        absentFromRecordSet: 2,
      },
    });

    // And the splitter agrees: two components, not one.
    const roots = connectedComponentRoots(records);
    expect(roots.get("g_1")).not.toBe(roots.get("g_2"));
    expect(audit.clusters.connected.overall).toEqual({
      groups: 2,
      largest: 1,
      singletons: 2,
      recordLines: 2,
    });
  });

  it("counts a resolved reference as joined, and a self-reference as neither", () => {
    // Same axis, the other two branches of the same predicate the splitter uses.
    const seed = v3Split("known").records[0];
    const child = seededRow("g_1", seed.id, 5);
    const audit = auditBlockedSplit(
      [seed, child],
      {
        train: [seed],
        dev: [],
        "cal-A": [],
        "cal-B": [],
        test: [child],
      },
      AUDIT_POLICY,
      NO_RESERVATION,
    );
    const humanSeed = audit.clusters.axes.find(
      (row) => row.axis === "humanSeed",
    )!;
    expect(linkageOf(humanSeed)).toEqual({
      references: 1,
      joinedAnotherRecordLine: 1,
      selfReference: 0,
      absentFromRecordSet: 0,
    });
    // One cluster: the linkage resolved, so this pair really is indivisible.
    expect(audit.clusters.connected.overall.groups).toBe(1);

    // `derivationRoot` in the v2 release fixture names the row's OWN id, which
    // unions nothing — the splitter skips `parent === record.id`. A count that
    // called those "joined" would inflate the linkage evidence for every row.
    const releaseSplit = createBlockedSplit(RELEASE_DATASET, POLICY);
    const release = auditBlockedSplit(
      RELEASE_DATASET,
      releaseSplit,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );
    const derivation = release.clusters.axes.find(
      (row) => row.axis === "derivationRoot",
    )!;
    expect(linkageOf(derivation).references).toBe(RELEASE_DATASET.length);
    expect(linkageOf(derivation).selfReference).toBe(RELEASE_DATASET.length);
    expect(linkageOf(derivation).joinedAnotherRecordLine).toBe(0);
  });

  it("leaves `linkage` null for an axis that is not followed as linkage", () => {
    const split = createBlockedSplit(RELEASE_DATASET, POLICY);
    const audit = auditBlockedSplit(
      RELEASE_DATASET,
      split,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );
    for (const axis of ["source", "author", "generatorFamily"]) {
      expect(
        audit.clusters.axes.find((row) => row.axis === axis)!.connectivity
          .linkage,
      ).toBeNull();
    }
    // The stand-in agrees, and is all-zero rather than plausible.
    const standIn = standInClusterReport(V3_GROUP_AXES);
    expect(
      standIn.axes.find((row) => row.axis === "source")!.connectivity.linkage,
    ).toBeNull();
    expect(
      standIn.axes.find((row) => row.axis === "humanSeed")!.connectivity
        .linkage,
    ).toEqual({
      references: 0,
      joinedAnotherRecordLine: 0,
      selfReference: 0,
      absentFromRecordSet: 0,
    });
  });
});

describe("a grouping axis the source declared", () => {
  it("fails the audit when a record leaves it unknown", () => {
    const { records, split } = v3Split("unknown");
    const audit = auditBlockedSplit(
      records,
      split,
      AUDIT_POLICY,
      NO_RESERVATION,
      DECLARED,
    );

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
    const audit = auditBlockedSplit(
      records,
      split,
      AUDIT_POLICY,
      NO_RESERVATION,
      DECLARED,
    );

    expect(audit.declaredAxisGaps).toEqual([]);
    expect(audit.reasons.some((reason) => /declares axis/.test(reason))).toBe(
      false,
    );
  });

  it("says nothing about an axis no source declared", () => {
    const { records, split } = v3Split("unknown");
    const audit = auditBlockedSplit(
      records,
      split,
      AUDIT_POLICY,
      NO_RESERVATION,
    );

    expect(audit.declaredAxisGaps).toEqual([]);
    expect(audit.reasons.some((reason) => /declares axis/.test(reason))).toBe(
      false,
    );
  });

  it("says nothing about an axis the record's schema version never had", () => {
    // `src_wikipedia_pt` declares `sourceMaterialBatch`, and a v3 record has no such
    // KEY in its contract at all. Reading the plain eligibility state here would map the
    // absent key to `unknown` and fail every v3 corpus over an axis its schema never
    // offered. What the join asks instead is whether the RECORD'S OWN VERSION declares
    // the axis, which is also why the v4 row missing that key further down IS a gap.
    const row = v3Human({
      id: "w1",
      createdAt: 1,
      sourceId: "src_wikipedia_pt",
      authorState: "known",
    });
    const later = v3Human({
      id: "w2",
      createdAt: 2,
      sourceId: "src_wikipedia_pt",
      authorState: "known",
    });
    // Non-vacuous: the declaration really does name the axis this corpus cannot have.
    expect(DECLARED_GROUP_AXES.get("src_wikipedia_pt")).toContain(
      "sourceMaterialBatch",
    );
    const audit = auditBlockedSplit(
      [row, later],
      { train: [row], dev: [], "cal-A": [], "cal-B": [], test: [later] },
      AUDIT_POLICY,
      NO_RESERVATION,
      DECLARED_GROUP_AXES,
    );

    expect(audit.declaredAxisGaps).toEqual([]);
    expect(audit.reasons.some((reason) => /declares axis/.test(reason))).toBe(
      false,
    );
  });
});

// --- the axes the split REPORTS instead of unioning on -----------------------

/**
 * A v4 human row of ONE quota cell: its own origin document, author and
 * near-duplicate cluster, and the cell's single acquisition event and single stratum.
 *
 * Built through the validator, so the axis states are the ones a real v4 human row is
 * allowed to carry: `domainSource` and `sourceMaterialBatch` are `known` on every
 * human row BY RULE, which is precisely why a union on either would collapse the cell
 * into one indivisible component.
 */
function v4CellRow(id: string, createdAt: number): BenchmarkRecord {
  let raw: Record<string, unknown> = { ...v4Human(), id, createdAt };
  raw = withAxis(raw, "author", known(`au_hmac_${id}`));
  raw = withAxis(raw, "source", known(`th_doc_${id}`));
  raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
  return validateBenchmarkRecordV4(raw) as unknown as BenchmarkRecord;
}

describe("an axis the splitter does not union on", () => {
  it("stays out of the splitter's union list, and says so per axis", () => {
    // The CONTENT, restated, before anything iterates it. Every other assertion in
    // this file about the reported axes is a loop over this tuple, so an empty tuple
    // would satisfy all of them by executing nothing, and a tuple that lost
    // `sourceMaterialBatch` would silently drop the dependence axis from the
    // inventory the composition gate reads. Equality and not `length`: a length check
    // accepts one axis swapped for another.
    expect([...REPORTED_GROUP_AXES]).toEqual([
      "domainSource",
      "sourceMaterialBatch",
    ]);

    for (const axis of REPORTED_GROUP_AXES) {
      // A real axis of some record version, not a name only this module knows.
      expect(ALL_GROUP_AXES, axis).toContain(axis);
      expect(GROUP_KEYS as readonly string[], axis).not.toContain(axis);
      // Published per axis, so a reader of the sealed artifact does not have to
      // consult the splitter to learn that it did not group by this identity.
      expect(axisConnectivity(axis), axis).toEqual({
        sharedValue: false,
        parentLinkage: false,
      });
    }
  });

  it("is published as an inventory per partition, and crossing a cut is not leakage", () => {
    // One row per partition, ALL FIVE populated. `auditClusters` creates a `bySlice`
    // bucket only for a partition that holds a record, so a fixture leaving `cal-A` and
    // `cal-B` empty pins their ABSENCE from the inventory — and those two are the blind
    // partitions whose inventory the composition gate is the one that will read.
    const rows = [
      v4CellRow("h_train", 1),
      v4CellRow("h_dev", 2),
      v4CellRow("h_cal_a", 3),
      v4CellRow("h_cal_b", 4),
      v4CellRow("h_test", 5),
    ];
    const [train, dev, calA, calB, test] = rows as [
      BenchmarkRecord,
      BenchmarkRecord,
      BenchmarkRecord,
      BenchmarkRecord,
      BenchmarkRecord,
    ];
    const audit = auditBlockedSplit(
      rows,
      {
        train: [train],
        dev: [dev],
        "cal-A": [calA],
        "cal-B": [calB],
        test: [test],
      },
      AUDIT_POLICY,
      NO_RESERVATION,
      DECLARED_GROUP_AXES,
    );

    // A v4 corpus publishes exactly the v4 axes: `collectionBatch` is an axis no record
    // here declares, and reporting it would publish `states.unknown = N` for an axis
    // that is absent rather than broken.
    //
    // The ORDER is restated rather than derived from the constant the implementation
    // reads. `clusters.axes` is an ARRAY inside the `splitDigest`-sealed artifact, so a
    // reordering moves the digest, and it is `ALL_GROUP_AXES` order — the shared axes
    // in v3's order, then the three v4 introduced — which is also the order the Python
    // mirror (`benchmark/lab/group_axes.py`) reports in.
    expect(audit.clusters.axes.map((row) => row.axis)).toEqual([
      "author",
      "source",
      "domainSource",
      "humanSeed",
      "promptTemplate",
      "generatorFamily",
      "generatorVersion",
      "generationLane",
      "harnessVersion",
      "nearDuplicate",
      "derivationRoot",
      "sourceMaterialBatch",
      "generationBatch",
      "extractionRun",
    ]);
    // Exactly the v4 axes as a SET, which the order above cannot state on its own: a
    // list that dropped one axis and added another would still be "in order".
    expect(new Set(audit.clusters.axes.map((row) => row.axis))).toEqual(
      new Set(V4_GROUP_AXES),
    );

    for (const axis of REPORTED_GROUP_AXES) {
      const report = audit.clusters.axes.find((row) => row.axis === axis);
      expect(report, axis).toBeDefined();
      // ONE identity over the five record-lines — the cell as an acquisition really
      // offers it — so the inventory is a measurement and not a tautology.
      expect(report!.states, axis).toEqual({
        known: 5,
        notApplicable: 0,
        unknown: 0,
      });
      expect(report!.overall, axis).toEqual({
        groups: 1,
        largest: 5,
        singletons: 0,
        recordLines: 5,
      });
      expect(report!.connectivity.sharedValue, axis).toBe(false);
      // The inventory the composition gate will read: how many distinct acquisition
      // events and strata each partition holds. All five keys, the two BLIND ones
      // included — a partition dropped from `sliceKeysOf` or from `AUDITED_PARTITIONS`
      // vanishes from this list silently otherwise.
      const perPartition = report!.bySlice.filter(
        (row) => row.slice === "partition",
      );
      expect(
        perPartition.map((row) => row.key),
        axis,
      ).toEqual(["cal-A", "cal-B", "dev", "test", "train"]);
      for (const row of perPartition) {
        expect(row.count, `${axis} ${row.key}`).toEqual({
          groups: 1,
          largest: 1,
          singletons: 1,
          recordLines: 1,
        });
      }
    }

    // The identity spans all five partitions and that is NOT leakage: the splitter
    // does not union on it, so nothing was kept together and nothing crossed a cluster
    // boundary. A union on either axis would make this list non-empty — and would make
    // the cell one component, which the roots below refuse.
    expect(audit.leakages).toEqual([]);
    expect(new Set(connectedComponentRoots(rows).values()).size).toBe(5);
  });

  it("fails the audit when a source declares the acquisition event and a row leaves it unknown", () => {
    // The `mixed-ecological` cohort is the one class where `unknown` is a LEGAL state
    // for the acquisition event: the observed coauthored document exists, and whether
    // we hold its acquisition record is a fact about our records. So this row passes
    // the validator, and the audit is the stage that refuses it — which is the whole
    // point of declaring the axis on a source the splitter does not union by.
    let raw: Record<string, unknown> = {
      ...v4MixedEcological(),
      id: "m_eco_coauthored",
      createdAt: 3,
    };
    raw = withAxis(
      raw,
      "sourceMaterialBatch",
      unknownAxis(
        "the coauthored document was acquired with the package and its acquisition event was not recorded",
      ),
    );
    raw = {
      ...raw,
      provenance: {
        ...(raw.provenance as Record<string, unknown>),
        sourceId: "src_wikipedia_pt",
      },
    };
    const ecological = validateBenchmarkRecordV4(
      raw,
    ) as unknown as BenchmarkRecord;
    // The five partitions are populated, `cal-A` and `cal-B` included, so the gap is
    // counted over a corpus shaped like the one the gate will read and not over three
    // partitions with two vacuous ones.
    const filler = [
      v4CellRow("h_train", 1),
      v4CellRow("h_dev", 2),
      v4CellRow("h_cal_a", 4),
      v4CellRow("h_cal_b", 5),
    ] as const;
    const [train, dev, calA, calB] = filler;

    const audit = auditBlockedSplit(
      [...filler, ecological],
      {
        train: [train],
        dev: [dev],
        "cal-A": [calA],
        "cal-B": [calB],
        test: [ecological],
      },
      AUDIT_POLICY,
      NO_RESERVATION,
      DECLARED_GROUP_AXES,
    );

    expect(audit.declaredAxisGaps).toEqual([
      {
        sourceId: "src_wikipedia_pt",
        axis: "sourceMaterialBatch",
        state: "unknown",
        recordLines: 1,
      },
    ]);
    expect(
      audit.reasons.some((reason) =>
        /declares axis "sourceMaterialBatch"/.test(reason),
      ),
    ).toBe(true);
    expect(audit.passed).toBe(false);
  });

  it("fails the audit when a v4 row has no key at all for the axis its source declared", () => {
    // The version-aware half of the join, in the direction that is NOT about v2/v3.
    // `sourceMaterialBatch` is a MANDATORY key of v4, so a v4 row without it has not
    // answered the declaration with `unknown` — it has not answered at all, and reading
    // only "did the producer WRITE unknown" would let it through. The row is built by
    // hand and past the validator on purpose: `parseBenchmarkDataset` refuses it on the
    // command path, and this is the audit's own depth behind that.
    const stocked = v4CellRow("h_stocked", 2);
    const groups = { ...(stocked.groups as Record<string, unknown>) };
    delete groups.sourceMaterialBatch;
    const missing = {
      ...stocked,
      id: "h_no_batch_key",
      groups,
      provenance: { ...stocked.provenance, sourceId: "src_wikipedia_pt" },
    } as unknown as BenchmarkRecord;
    // Non-vacuous: the key really is gone, and the anchor really does carry it.
    expect(Object.hasOwn(missing.groups as object, "sourceMaterialBatch")).toBe(
      false,
    );
    const anchor = {
      ...v4CellRow("h_with_batch_key", 1),
      provenance: {
        ...v4CellRow("h_with_batch_key", 1).provenance,
        sourceId: "src_wikipedia_pt",
      },
    } as unknown as BenchmarkRecord;

    const audit = auditBlockedSplit(
      [anchor, missing],
      {
        train: [anchor],
        dev: [],
        "cal-A": [],
        "cal-B": [],
        test: [missing],
      },
      AUDIT_POLICY,
      NO_RESERVATION,
      DECLARED_GROUP_AXES,
    );

    expect(audit.declaredAxisGaps).toEqual([
      {
        sourceId: "src_wikipedia_pt",
        axis: "sourceMaterialBatch",
        state: "unknown",
        recordLines: 1,
      },
    ]);
    expect(audit.passed).toBe(false);
  });
});

describe("the reservation the partitions honor", () => {
  const RESERVED = asGeneratorFamily("family-reserved");
  const INCIDENTAL = asGeneratorFamily("family-incidental");

  // Three generated families over five record-lines. `family-seen` is spread
  // across the three partitions; `family-reserved` and `family-incidental` each
  // hold one record-line and both sit ONLY in test. The two test-only families
  // differ in exactly one respect — whether the reservation named them — which is
  // the distinction the audit has to make and the one it used to be blind to.
  const ai = (id: string, createdAt: number, family: string): BenchmarkRecord =>
    rec({
      id,
      label: "ai",
      createdAt,
      domain: "corporate",
      wordCount: 120,
      family,
      author: `auth_${id}`,
      source: `src_${id}`,
      domainSource: `ds_${id}`,
      collectionBatch: `cb_${id}`,
      nearDuplicate: `nd_${id}`,
      derivationRoot: id,
      generatorVersion: `gv_${id}`,
      promptTemplate: `pt_${id}`,
    });

  function corpus(): {
    records: BenchmarkRecord[];
    split: DatasetSplit<BenchmarkRecord>;
  } {
    const development = [ai("dev_seen", 1, "family-seen")];
    const calibration = [ai("cal_seen", 2, "family-seen")];
    const test = [
      ai("tst_seen", 3, "family-seen"),
      ai("tst_reserved", 4, "family-reserved"),
      ai("tst_incidental", 5, "family-incidental"),
    ];
    return {
      records: [...development, ...calibration, ...test],
      split: {
        train: development,
        dev: calibration,
        "cal-A": [],
        "cal-B": [],
        test,
      },
    };
  }

  // The same three families, except the reservation is only PARTLY violated:
  // `family-reserved` keeps a record-line in `test` and has a second one in
  // `train`. This is the corpus that tells the two possible keyings of the
  // `generatorExposure` axis apart. In `corpus()` every declared family has all
  // its record-lines in `test`, so declared and honored are the same set and the
  // axis reads identically whichever one it is keyed on.
  function partlyViolatedCorpus(): {
    records: BenchmarkRecord[];
    split: DatasetSplit<BenchmarkRecord>;
  } {
    const { records, split } = corpus();
    const strayed = ai("dev_reserved", 0, "family-reserved");
    return {
      records: [strayed, ...records],
      split: { ...split, train: [strayed, ...split.train] },
    };
  }

  it("derives the declared families whose every record-line sits in test", () => {
    const { records, split } = corpus();
    const audit = auditBlockedSplit(records, split, AUDIT_POLICY, [RESERVED]);

    expect(audit.heldOutGeneratorFamilies).toEqual([RESERVED]);
  });

  it("publishes an undeclared test-only family as incidental, and the exact equality still holds", () => {
    const { records, split } = corpus();
    const audit = auditBlockedSplit(records, split, AUDIT_POLICY, [RESERVED]);

    expect(audit.incidentalTestOnlyGeneratorFamilies).toEqual([INCIDENTAL]);
    expect(audit.heldOutGeneratorFamilies).not.toContain(INCIDENTAL);
    // The whole point of the correction: a family that merely landed in test does
    // NOT reprove the split. Under the inferred set this threw.
    expect(() =>
      assertGeneratorFamiliesEqual(
        "declared",
        [RESERVED],
        "derived",
        audit.heldOutGeneratorFamilies,
      ),
    ).not.toThrow();
  });

  it("withdraws a declared family with one record-line outside test, and that fails hard", () => {
    const { records, split } = corpus();
    const violated: DatasetSplit<BenchmarkRecord> = {
      ...split,
      train: [
        ...split.train,
        ...split.test.filter((row) => row.id === "tst_reserved"),
      ],
      test: split.test.filter((row) => row.id !== "tst_reserved"),
    };
    const audit = auditBlockedSplit(records, violated, AUDIT_POLICY, [
      RESERVED,
    ]);

    expect(audit.heldOutGeneratorFamilies).toEqual([]);
    expect(audit.incidentalTestOnlyGeneratorFamilies).toEqual([INCIDENTAL]);
    expect(() =>
      assertGeneratorFamiliesEqual(
        "declared",
        [RESERVED],
        "derived",
        audit.heldOutGeneratorFamilies,
      ),
    ).toThrow(/omits \[family-reserved\]/);
  });

  it("does not honor a declared family the corpus stocks with nothing", () => {
    const { records, split } = corpus();
    const audit = auditBlockedSplit(records, split, AUDIT_POLICY, [
      asGeneratorFamily("family-absent"),
    ]);

    expect(audit.heldOutGeneratorFamilies).toEqual([]);
    // A reservation nothing satisfies is still a hard failure: vacuous truth over
    // zero record-lines must not publish a reserve with no population.
    expect(() =>
      assertGeneratorFamiliesEqual(
        "declared",
        [asGeneratorFamily("family-absent")],
        "derived",
        audit.heldOutGeneratorFamilies,
      ),
    ).toThrow(/omits \[family-absent\]/);
  });

  it("withdraws a declared family whose record-line is assigned to no partition", () => {
    const { records, split } = corpus();
    // Present in the record set, absent from every partition of this fixture. It must not
    // pass for "absent from development and calibration": the predicate is
    // measured over the whole record set exactly so this row withdraws the
    // reservation instead of reading as harmless here. (split-artifact.ts refuses
    // the incomplete assignment separately; the reservation is not the place that
    // gets to be lenient about it.)
    const orphan = ai("orphan_reserved", 6, "family-reserved");
    const audit = auditBlockedSplit([...records, orphan], split, AUDIT_POLICY, [
      RESERVED,
    ]);

    expect(audit.heldOutGeneratorFamilies).toEqual([]);
    expect(() =>
      assertGeneratorFamiliesEqual(
        "declared",
        [RESERVED],
        "derived",
        audit.heldOutGeneratorFamilies,
      ),
    ).toThrow(/omits \[family-reserved\]/);
  });

  it("keys generatorExposure on the declared set, so an incidental family reads seen", () => {
    const { records, split } = corpus();
    const audit = auditBlockedSplit(records, split, AUDIT_POLICY, [RESERVED]);

    const exposure = audit.criticalSliceSamples.filter(
      (slice) => slice.axis === "generatorExposure",
    );
    expect(exposure.find((slice) => slice.key === "unseen")!.positives).toBe(1);
    // `family-seen` and `family-incidental`: two positives that were never
    // reserved, whatever partition they landed in.
    expect(exposure.find((slice) => slice.key === "seen")!.positives).toBe(2);
  });

  it("keeps the unseen slice of a VIOLATED reservation in the published audit", () => {
    const { records, split } = partlyViolatedCorpus();
    const audit = auditBlockedSplit(records, split, AUDIT_POLICY, [RESERVED]);

    // Withdrawn — one record-line sits in `development` — and yet the axis still
    // has to publish the `unseen` row, because keying it on the honored subset
    // would relabel the violated reservation as `seen` and erase from
    // `criticalSliceSamples` (sealed into split-artifact.json) the very
    // divergence the exact equality is about to fail on.
    expect(audit.heldOutGeneratorFamilies).toEqual([]);

    const exposure = audit.criticalSliceSamples.filter(
      (slice) => slice.axis === "generatorExposure",
    );
    expect(exposure.find((slice) => slice.key === "unseen")?.positives).toBe(1);
    expect(exposure.find((slice) => slice.key === "seen")?.positives).toBe(2);
  });
});

// --- the mutations a fraction test cannot see ---------------------------------
//
// Three mutations of the five-partition split, each chosen because the OBVIOUS test
// stays green under it. They are written against `auditBlockedSplit` with splits built
// by hand, because that is the level at which a transposed or omitted partition is
// expressible at all — `createBlockedSplit` cannot be asked to produce one.
describe("the five-partition audit has teeth on the mutations fractions miss", () => {
  // No reservation, deliberately: with a held-out family declared, the reservation rule
  // would also catch the transposition below, and the test would not prove that the
  // temporal chain catches it on its own.
  const UNRESERVED_POLICY: BlockedSplitPolicy = {
    ...POLICY,
    heldOutGeneratorFamilies: [],
  };
  const unreservedSplit = (): DatasetSplit<BenchmarkRecord> =>
    createBlockedSplit(RELEASE_DATASET, UNRESERVED_POLICY);

  const auditOf = (split: DatasetSplit<BenchmarkRecord>) =>
    auditBlockedSplit(RELEASE_DATASET, split, AUDIT_POLICY, NO_RESERVATION);

  it("passes the unreserved split, so the refusals below are about the mutation", () => {
    const audit = auditOf(unreservedSplit());
    expect(audit.reasons).toEqual([]);
    expect(audit.passed).toBe(true);
  });

  it("refuses cal-B and test transposed, which every fraction target survives", () => {
    // `cal-B` and `test` are the ONE pair of partitions that share a target (0.20), so
    // swapping them lands all fifteen class fractions inside tolerance. Whole
    // partitions are exchanged, so no connected component is broken either, and the
    // blocked test still holds enough human negatives. Nothing but the temporal
    // ordering can tell this split from the correct one.
    const split = unreservedSplit();
    const transposed: DatasetSplit<BenchmarkRecord> = {
      ...split,
      "cal-B": split.test,
      test: split["cal-B"],
    };
    const audit = auditOf(transposed);

    // The mutation is invisible to all three of the cheaper checks...
    for (const label of ["human", "ai", "mixed"] as const) {
      for (const [partition, target] of TARGET_FRACTIONS) {
        expect(
          Math.abs(audit.classFractions[label][partition] - target),
          `${label} ${partition} still hits its target`,
        ).toBeLessThanOrEqual(0.02);
      }
    }
    expect(audit.leakages).toEqual([]);
    expect(
      transposed.test.filter((row) => row.label === "human").length,
    ).toBeGreaterThanOrEqual(2_000);

    // ...and the temporal ordering is the single reason that refuses it.
    expect(audit.passed).toBe(false);
    expect(audit.reasons).toHaveLength(1);
    expect(audit.reasons[0]).toMatch(/temporal/i);
  });

  it("names EVERY partition whose class fraction is wrong, one at a time", () => {
    // The mutation this defends against is an enumeration that covers four of the five
    // partitions: the omitted one's fraction then goes unwatched and can drift by any
    // amount. Emptying each partition in turn is the sharpest available probe, because
    // a fraction of zero breaches the tolerance for every class and every target.
    for (const partition of PARTITIONS) {
      const split = unreservedSplit();
      const sink: Partition = partition === "train" ? "test" : "train";
      const mutated: DatasetSplit<BenchmarkRecord> = {
        ...split,
        [partition]: [],
        [sink]: [...split[sink], ...split[partition]],
      };
      const audit = auditOf(mutated);

      expect(audit.passed, `${partition} emptied`).toBe(false);
      expect(
        audit.reasons.some(
          (reason) =>
            reason.includes(`${partition} fraction`) &&
            reason.includes("outside"),
        ),
        `a class-fraction reason names ${partition}: ${audit.reasons.join(" | ")}`,
      ).toBe(true);
    }
  });

  it("still refuses when two middle partitions are empty at the same time", () => {
    // Every temporal comparison is guarded on both partitions being non-empty, so
    // emptying two middle partitions at once makes several links of the chain
    // vacuously true. What keeps that safe is arithmetic and not luck: all five targets
    // are larger than `classTolerance`, so an empty partition ALWAYS breaks the
    // class-fraction check. If a future target ever drops below the tolerance, this
    // test is the one that should start failing.
    const split = unreservedSplit();
    const collapsed: DatasetSplit<BenchmarkRecord> = {
      ...split,
      dev: [],
      "cal-A": [],
      train: [...split.train, ...split.dev, ...split["cal-A"]],
    };
    const audit = auditOf(collapsed);

    expect(audit.passed).toBe(false);
    for (const partition of ["dev", "cal-A"] as const) {
      expect(
        audit.reasons.some((reason) =>
          reason.includes(`${partition} fraction 0.000`),
        ),
        `${partition} is reported empty: ${audit.reasons.join(" | ")}`,
      ).toBe(true);
    }
    for (const [, target] of TARGET_FRACTIONS) {
      expect(target, "every target exceeds the tolerance").toBeGreaterThan(
        0.02,
      );
    }
  });
});

// --- the enumerations that must not drift apart -------------------------------
describe("the five partition names are pinned, not repeated by hand", () => {
  it("audits exactly the partitions the splitter produces, in the same order", () => {
    // `AUDITED_PARTITIONS` IS the audit's only enumeration — the one the chain walks
    // and the fraction check iterates — and it is read off a `Record<Partition,
    // number>`, so dropping a partition from it is a compile error rather than a
    // silently unchecked fraction. What the type cannot check is that its ORDER is the
    // splitter's temporal order, and the chain check depends on that order, so it is
    // asserted here as a sequence and not as a set.
    expect([...AUDITED_PARTITIONS]).toEqual([...PARTITIONS]);
  });

  it("pins the splitter's frozen fractions to the pre-registered ones", () => {
    // The missing link between a typed literal in `split.ts` and the decision that was
    // actually frozen. The pre-registration keys its fractions by FIELD name and the
    // splitter by partition VALUE, so the mapping is spelled out here too — a second
    // reader of the correspondence the audit declares once.
    const frozen = PREREGISTRATION_V4.preRegistration.partitionFractions;
    expect(POLICY.fractions).toEqual({
      train: frozen.train,
      dev: frozen.dev,
      "cal-A": frozen.calA,
      "cal-B": frozen.calB,
      test: frozen.test,
    });
    // And the table the tests above assert against is the same set of numbers.
    expect(Object.fromEntries(TARGET_FRACTIONS)).toEqual(POLICY.fractions);
  });
});

// --- the success message, tested here because no end-to-end path renders it ------
describe("the split command's proportions line", () => {
  it("renders the five frozen proportions, in temporal order, with no float dust", () => {
    // Worth a test of its own precisely because it is unreachable end to end: the
    // command only emits this line after an audit that passes, and the human-negative
    // floor makes no sealable corpus satisfy that.
    //
    // The literal is also the guard against float dust: the line multiplies frozen
    // fractions by 100, and `0.05 * 100` is only exactly 5 because that product
    // happens to round back to an integer — a different tolerance or fraction could
    // print `5.000000000000001%` into an operator-facing message.
    expect(describeSplitProportions(POLICY)).toBe(
      "train=45%, dev=5%, cal-A=10%, cal-B=20%, test=20%",
    );
  });
});

// --- train is the fallback, so it has no temporal place in the chain ----------
describe("the temporal chain excludes train, and that is load-bearing", () => {
  it("accepts a split whose train holds a component spanning the middle bands", () => {
    // A component glued across four timestamps lands in `train` because it fits no
    // single band — that is exactly what a fallback is for. Its newest record is then
    // newer than every middle partition's, and the split is still legal: nothing about
    // training data being interleaved with dev or cal leaks the blocked test.
    //
    // A chain that required `latest(dev) > latest(train)` refused this split, which
    // `createBlockedSplit` produces on purpose. The chain now covers the three middle
    // partitions only.
    const rows: BenchmarkRecord[] = [];
    const spanning = (id: string, createdAt: number): BenchmarkRecord =>
      rec({
        id,
        label: "human",
        createdAt,
        domain: "corporate",
        wordCount: 100,
        // One shared collectionBatch across four timestamps: this is the glue that
        // makes the four rows a single indivisible component.
        author: `auth_${id}`,
        source: "src_span",
        domainSource: "ds_span",
        collectionBatch: "cb_span",
        nearDuplicate: `nd_${id}`,
        derivationRoot: id,
      });
    for (const [index, time] of [1, 2, 3, 4].entries()) {
      rows.push(spanning(`span_${index}`, time));
    }

    const roots = connectedComponentRoots(rows);
    expect(
      new Set(roots.values()).size,
      "the four rows are one component",
    ).toBe(1);

    // Hand-built so the case is expressible at all: the audit is what is under test,
    // and it must not refuse this arrangement.
    const later = (id: string, time: number): BenchmarkRecord =>
      rec({
        id,
        label: "human",
        createdAt: time,
        domain: "corporate",
        wordCount: 100,
        author: `auth_${id}`,
        source: `src_${id}`,
        domainSource: `ds_${id}`,
        collectionBatch: `cb_${id}`,
        nearDuplicate: `nd_${id}`,
        derivationRoot: id,
      });
    const dev = later("d1", 2);
    const calA = later("a1", 3);
    const calB = later("b1", 4);
    const test = later("t1", 5);
    const records = [...rows, dev, calA, calB, test];
    const split: DatasetSplit<BenchmarkRecord> = {
      train: rows,
      dev: [dev],
      "cal-A": [calA],
      "cal-B": [calB],
      test: [test],
    };
    const audit = auditBlockedSplit(
      records,
      split,
      AUDIT_POLICY,
      NO_RESERVATION,
    );

    // `train` ends at 4, later than dev (2) and cal-A (3) — by design.
    expect(audit.cutoffs.latestTrain).toBeGreaterThan(audit.cutoffs.latestDev);
    expect(audit.cutoffs.latestTrain).toBeGreaterThan(audit.cutoffs.latestCalA);
    // And no temporal reason is raised, which is the whole point of this test.
    expect(audit.reasons.filter((reason) => /temporal/.test(reason))).toEqual(
      [],
    );
  });

  it("still refuses train reaching past the start of the blocked test", () => {
    // The direction that IS leakage: a spanning component in `train` carrying a record
    // newer than the earliest test record puts test-period text into training data.
    // Construction cannot prevent it, so the audit is the only thing that can.
    const shared = (id: string, createdAt: number): BenchmarkRecord =>
      rec({
        id,
        label: "human",
        createdAt,
        domain: "corporate",
        wordCount: 100,
        author: `auth_${id}`,
        source: "src_leak",
        domainSource: "ds_leak",
        collectionBatch: "cb_leak",
        nearDuplicate: `nd_${id}`,
        derivationRoot: id,
      });
    const early = shared("leak_early", 1);
    const late = shared("leak_late", 9);
    const solo = (id: string, time: number): BenchmarkRecord =>
      rec({
        id,
        label: "human",
        createdAt: time,
        domain: "corporate",
        wordCount: 100,
        author: `auth_${id}`,
        source: `src_${id}`,
        domainSource: `ds_${id}`,
        collectionBatch: `cb_${id}`,
        nearDuplicate: `nd_${id}`,
        derivationRoot: id,
      });
    const dev = solo("d1", 2);
    const calA = solo("a1", 3);
    const calB = solo("b1", 4);
    const test = solo("t1", 5);
    const records = [early, late, dev, calA, calB, test];
    const audit = auditBlockedSplit(
      records,
      {
        train: [early, late],
        dev: [dev],
        "cal-A": [calA],
        "cal-B": [calB],
        test: [test],
      },
      AUDIT_POLICY,
      NO_RESERVATION,
    );

    expect(audit.cutoffs.latestTrain).toBeGreaterThan(
      audit.cutoffs.earliestTest,
    );
    expect(audit.passed).toBe(false);
    expect(
      audit.reasons.some((reason) => /strictly newer/.test(reason)),
      audit.reasons.join(" | "),
    ).toBe(true);
  });
});
