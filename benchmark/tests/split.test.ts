import { describe, expect, it } from "vitest";

import { auditBlockedSplit, type SplitAuditPolicy } from "../split-audit.ts";
import {
  axisConnectivity,
  CONNECTIVITY_AXES,
  createBlockedSplit,
  GROUP_KEYS,
  PARENT_LINKAGE_AXES,
  SplitConstraintError,
  type BlockedSplitPolicy,
  type Partition,
} from "../split.ts";
import {
  groupAxisIdentity,
  type BenchmarkLabel,
  type BenchmarkRecord,
  type TransformationKind,
} from "../schema.ts";
import {
  asGeneratorFamily,
  generatorFamilyOf,
  normalizeGeneratorFamily,
} from "../generator-family.ts";

// The blocked split is exercised through the public API only (no lower-level
// hooks), so every fixture is a full, self-consistent dataset that the temporal
// 20/30/50 cut can actually satisfy within tolerance. A record factory keeps the
// closed schema fields realistic while leaving the axes the splitter reads
// (label, createdAt, domain, the canonical generator family and every groups.* key)
// under
// direct test control.
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

// Even class interleaving across 100 time slots. Because human, ai and mixed are
// each spread uniformly over time, one global temporal cut lands every class at
// ~20/30/50, and every (slot, class) shares all eight grouping axes so the audit
// exercises real — never vacuous — cohesion. Mixed records point their
// derivationRoot at the slot's human parent, so parent + derivatives cluster.
// The unseen generator family appears only in the newest slots so it is both
// held-out-eligible and temporally in test.
function buildDataset(options: {
  perHuman: number;
  perAi: number;
  perMixed: number;
  unseenPerSlot: number;
  unseenFromSlot: number;
  unseenFamilyFromSlot?: number;
}): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  const SLOTS = 100;
  const lengths = [40, 180, 520];
  const aiKinds: TransformationKind[] = [
    "paraphrase",
    "back-translation",
    "expand",
  ];

  for (let slot = 1; slot <= SLOTS; slot += 1) {
    for (let i = 0; i < options.perHuman; i += 1) {
      records.push(
        rec({
          id: `h_${slot}_${i}`,
          label: "human",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: lengths[i % 3],
          humanSourceType: i % 2 === 0 ? "employee-post" : "newsletter",
          hardNegativeFamily: i % 2 === 0 ? "hn-legal" : "hn-marketing",
          author: `auth_h_${slot}`,
          source: `src_h_${slot}`,
          domainSource: `ds_h_${slot}`,
          collectionBatch: `cb_h_${slot}`,
          nearDuplicate: `nd_h_${slot}`,
          derivationRoot: `h_${slot}_0`,
        }),
      );
    }
    for (let i = 0; i < options.perAi; i += 1) {
      records.push(
        rec({
          id: `a_${slot}_${i}`,
          label: "ai",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: [50, 200, 480][i % 3],
          transformationKind: aiKinds[i % 3],
          family: "family-seen",
          author: `auth_a_${slot}`,
          source: `src_a_${slot}`,
          domainSource: `ds_a_${slot}`,
          collectionBatch: `cb_a_${slot}`,
          nearDuplicate: `nd_a_${slot}`,
          derivationRoot: `a_${slot}_0`,
          generatorVersion: `gv_seen_${slot}`,
          promptTemplate: `pt_a_${slot}`,
        }),
      );
    }
    for (let i = 0; i < options.perMixed; i += 1) {
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
          author: `auth_m_${slot}`,
          source: `src_m_${slot}`,
          domainSource: `ds_m_${slot}`,
          collectionBatch: `cb_m_${slot}`,
          nearDuplicate: `nd_m_${slot}`,
          derivationRoot: `h_${slot}_0`,
          promptTemplate: `pt_m_${slot}`,
        }),
      );
    }
  }

  const unseenStart = options.unseenFamilyFromSlot ?? options.unseenFromSlot;
  for (let slot = unseenStart; slot <= SLOTS; slot += 1) {
    for (let i = 0; i < options.unseenPerSlot; i += 1) {
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

const DATASET = buildDataset({
  perHuman: 6,
  perAi: 4,
  perMixed: 3,
  unseenPerSlot: 1,
  unseenFromSlot: 96,
});

const POLICY: BlockedSplitPolicy = {
  fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
  classTolerance: 0.02,
  heldOutGeneratorFamilies: [asGeneratorFamily("family-unseen")],
  seed: 712_019,
};

const RELEASE_AUDIT_POLICY: SplitAuditPolicy = {
  minimumTestHumanNegatives: 2_000,
  minimumCriticalFprNegatives: 300,
  minimumCriticalRecallPositives: 200,
  classTolerance: 0.02,
};

const GROUP_AXES = [
  "author",
  "source",
  "domainSource",
  "generatorVersion",
  "promptTemplate",
  "collectionBatch",
  "nearDuplicate",
  "derivationRoot",
] as const;

describe("createBlockedSplit", () => {
  it("keeps connected groups together and the holdout family in test", () => {
    const split = createBlockedSplit(DATASET, {
      fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
      classTolerance: 0.02,
      heldOutGeneratorFamilies: [asGeneratorFamily("family-unseen")],
      seed: 712_019,
    });
    const audit = auditBlockedSplit(DATASET, split, RELEASE_AUDIT_POLICY);
    expect(audit.leakages).toEqual([]);
    // Reads the CANONICAL field, like the splitter does. Asserting on
    // `generation.family` here would keep passing even if the held-out mark stopped
    // working, because the two spellings coincide in this fixture.
    expect(
      split.test.filter((row) => generatorFamilyOf(row) === "family-unseen"),
    ).not.toHaveLength(0);
    expect(
      [...split.development, ...split.calibration].filter(
        (row) => generatorFamilyOf(row) === "family-unseen",
      ),
    ).toHaveLength(0);
  });

  it("does not collapse every linkedin record or every seen family into one component", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    expect(split.development.some((row) => row.domain === "corporate")).toBe(
      true,
    );
    expect(split.test.some((row) => row.domain === "corporate")).toBe(true);
    expect(
      split.calibration.some((row) => generatorFamilyOf(row) === "family-seen"),
    ).toBe(true);
    expect(
      split.test.some((row) => generatorFamilyOf(row) === "family-seen"),
    ).toBe(true);
  });

  it("confines every grouping axis to a single partition (no leakage on all eight axes)", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    const partitions: Array<[Partition, BenchmarkRecord[]]> = [
      ["development", split.development],
      ["calibration", split.calibration],
      ["test", split.test],
    ];
    for (const axis of GROUP_AXES) {
      const partitionsByValue = new Map<string, Set<Partition>>();
      const recordsByValue = new Map<string, number>();
      for (const [partition, rows] of partitions) {
        for (const row of rows) {
          const value = groupAxisIdentity(row, axis);
          if (value === undefined) continue;
          const set = partitionsByValue.get(value) ?? new Set<Partition>();
          set.add(partition);
          partitionsByValue.set(value, set);
          recordsByValue.set(value, (recordsByValue.get(value) ?? 0) + 1);
        }
      }
      // No value on this axis may straddle a partition boundary.
      for (const set of partitionsByValue.values()) {
        expect([...set]).toHaveLength(1);
      }
      // Proves the assertion is non-vacuous: this axis genuinely binds multiple
      // records into a shared group, and that group stayed together.
      expect(Math.max(...recordsByValue.values())).toBeGreaterThanOrEqual(2);
    }
  });

  it("splits every class 20/30/50 within the two-point tolerance", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    const audit = auditBlockedSplit(DATASET, split, RELEASE_AUDIT_POLICY);
    for (const label of ["human", "ai", "mixed"] as const) {
      expect(audit.classFractions[label].development).toBeCloseTo(0.2, 1);
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
  });

  it("keeps the blocked test strictly newer than calibration and development", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    const latestNonTest = Math.max(
      ...split.development.map((row) => row.createdAt),
      ...split.calibration.map((row) => row.createdAt),
    );
    const earliestTest = Math.min(...split.test.map((row) => row.createdAt));
    expect(earliestTest).toBeGreaterThan(latestNonTest);
  });

  it("is deterministic for a fixed seed", () => {
    const first = createBlockedSplit(DATASET, POLICY);
    const second = createBlockedSplit(DATASET, POLICY);
    const ids = (rows: BenchmarkRecord[]): string[] =>
      rows.map((row) => row.id);
    expect(ids(first.development)).toEqual(ids(second.development));
    expect(ids(first.calibration)).toEqual(ids(second.calibration));
    expect(ids(first.test)).toEqual(ids(second.test));
  });

  it("throws when a held-out family is not temporally eligible for test", () => {
    const dataset = buildDataset({
      perHuman: 6,
      perAi: 4,
      perMixed: 3,
      unseenPerSlot: 1,
      unseenFromSlot: 96,
      // Plant the unseen family in an early slot: it can never be test-only
      // without leaking future data, so the splitter must refuse.
      unseenFamilyFromSlot: 2,
    });
    expect(() => createBlockedSplit(dataset, POLICY)).toThrow(
      SplitConstraintError,
    );
  });

  it("throws when no temporal cut exists at all (single timestamp)", () => {
    // Every record shares one timestamp, so no legal (calibrationCut < testCut)
    // pair exists: fail closed at the no-cut branch rather than relax anything.
    const degenerate = Array.from({ length: 12 }, (_, index) =>
      rec({
        id: `d_${index}`,
        label: "human",
        createdAt: 1,
        domain: "corporate",
        wordCount: 100,
        author: `auth_${index}`,
        source: `src_${index}`,
        domainSource: `ds_${index}`,
        collectionBatch: `cb_${index}`,
        nearDuplicate: `nd_${index}`,
        derivationRoot: `d_${index}`,
      }),
    );
    expect(() => createBlockedSplit(degenerate, POLICY)).toThrow(
      /no temporal cut can realise/,
    );
  });

  it("throws the class-fraction error when 20/30/50 is unreachable within tolerance", () => {
    // Human lives entirely in the oldest half of the timeline, AI entirely in
    // the newest half. Candidate cuts exist (many distinct timestamps), the
    // search finds its best pair, but NO single global cut can put ~50% of both
    // classes in test — so the per-class ±2pp guard must throw, exercising the
    // class-fraction path (not the no-cut branch).
    const skewed: BenchmarkRecord[] = [];
    for (let slot = 1; slot <= 10; slot += 1) {
      skewed.push(
        rec({
          id: `hh_${slot}`,
          label: "human",
          createdAt: slot,
          domain: "corporate",
          wordCount: 100,
          author: `auth_hh_${slot}`,
          source: `src_hh_${slot}`,
          domainSource: `ds_hh_${slot}`,
          collectionBatch: `cb_hh_${slot}`,
          nearDuplicate: `nd_hh_${slot}`,
          derivationRoot: `hh_${slot}`,
        }),
      );
    }
    for (let slot = 11; slot <= 20; slot += 1) {
      skewed.push(
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
      );
    }
    expect(() => createBlockedSplit(skewed, POLICY)).toThrow(
      /fractions unreachable within tolerance/,
    );
  });
});

// --- the axis lists the audit and D0b read ----------------------------------

describe("the connectivity axis lists", () => {
  it("names every axis the splitter unions on exactly once", () => {
    // `derivationRoot` is BOTH a value axis and a linkage axis, so a plain
    // concatenation of the two lists carried it twice. Harmless to `.includes()`,
    // wrong for anything that counts or serialises the list — and this one is
    // exported and read downstream.
    expect(CONNECTIVITY_AXES.length).toBe(new Set(CONNECTIVITY_AXES).size);
    expect(
      CONNECTIVITY_AXES.filter((axis) => axis === "derivationRoot").length,
    ).toBe(1);

    // It is the union of the two relations, and nothing else is in it.
    expect([...CONNECTIVITY_AXES].sort()).toEqual(
      [...new Set([...GROUP_KEYS, ...PARENT_LINKAGE_AXES])].sort(),
    );
  });

  it("separates the two relations instead of flattening them to one flag", () => {
    // A value axis: sharing the identity is enough.
    expect(axisConnectivity("source")).toEqual({
      sharedValue: true,
      parentLinkage: false,
    });
    // Linkage only. The named row has to be PRESENT for anything to be unioned,
    // so this flag alone must never be read as "these rows are kept together".
    expect(axisConnectivity("humanSeed")).toEqual({
      sharedValue: false,
      parentLinkage: true,
    });
    // Both, said as both.
    expect(axisConnectivity("derivationRoot")).toEqual({
      sharedValue: true,
      parentLinkage: true,
    });
    // An axis the splitter deliberately refuses to union on, and one it never saw.
    expect(axisConnectivity("generatorFamily")).toEqual({
      sharedValue: false,
      parentLinkage: false,
    });
    expect(axisConnectivity("noSuchAxis")).toEqual({
      sharedValue: false,
      parentLinkage: false,
    });
  });
});
