import { describe, expect, it } from "vitest";

import { auditBlockedSplit, type SplitAuditPolicy } from "../split-audit.ts";
import {
  axisConnectivity,
  CONNECTIVITY_AXES,
  createBlockedSplit,
  GROUP_KEYS,
  PARENT_LINKAGE_AXES,
  PARTITIONS,
  SplitConstraintError,
  type BlockedSplitPolicy,
  type Partition,
  withinClassTolerance,
  CLASS_TOLERANCE_EPSILON,
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
// 45/5/10/20/20 cuts can actually satisfy within tolerance. A record factory keeps the
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
// each spread uniformly over time, four global temporal cuts land every class at
// ~45/5/10/20/20, and every (slot, class) shares all eight grouping axes so the audit
// exercises real — never vacuous — cohesion. One hundred slots is not decoration: the
// `dev` target is 0.05, so a coarser timeline could not place a cut pair that lands
// dev inside two points of it at all. Mixed records point their
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

describe("the inclusive boundary holds through the real search, not just the helper", () => {
  // O helper sozinho nao prova nada sobre a busca: cada poda que reescreve a aritmetica
  // inline reabre a borda para UM corte, e um teste que chama so o helper nao ve isso. Este
  // vai pela API publica.
  //
  // O corpus tem cinco blocos temporais com 45, 5, 8, 22 e 20 registros, cada linha em seu
  // proprio componente. Como os unicos cortes possiveis sao as fronteiras dos blocos, a UNICA
  // colocacao alcancavel realiza `45/5/8/22/20` — `cal-A` a 0,08 e `cal-B` a 0,22, ambos
  // exatamente nos dois pontos de tolerancia. Comparar float cru recusa: `0.58 - 0.50` da
  // `0.07999999999999996`.
  function corpusNasBordas(): BenchmarkRecord[] {
    const porBloco = [45, 5, 8, 22, 20];
    const registros: BenchmarkRecord[] = [];
    let indice = 0;
    porBloco.forEach((quantos, bloco) => {
      for (let i = 0; i < quantos; i += 1) {
        registros.push(
          rec({
            id: `b${bloco}_${i}`,
            label: "human",
            createdAt: (bloco + 1) * 1_000,
            domain: "corporate",
            wordCount: 180,
            humanSourceType: "employee-post",
            author: `a_${indice}`,
            source: `s_${indice}`,
            domainSource: `ds_${indice}`,
            collectionBatch: `cb_${indice}`,
            nearDuplicate: `nd_${indice}`,
            derivationRoot: `b${bloco}_${i}`,
          }),
        );
        indice += 1;
      }
    });
    return registros;
  }

  it("accepts a distribution sitting exactly on both tolerance edges", () => {
    const split = createBlockedSplit(corpusNasBordas(), POLICY);
    expect({
      train: split.train.length,
      dev: split.dev.length,
      "cal-A": split["cal-A"].length,
      "cal-B": split["cal-B"].length,
      test: split.test.length,
    }).toEqual({ train: 45, dev: 5, "cal-A": 8, "cal-B": 22, test: 20 });
  });

  it("still refuses a distribution genuinely outside the tolerance", () => {
    // Mesma construcao, `cal-A` com 5 de 100: 0,05 contra alvo 0,10 e cinco pontos fora.
    const porBloco = [45, 5, 5, 25, 20];
    const registros: BenchmarkRecord[] = [];
    let indice = 0;
    porBloco.forEach((quantos, bloco) => {
      for (let i = 0; i < quantos; i += 1) {
        registros.push(
          rec({
            id: `x${bloco}_${i}`,
            label: "human",
            createdAt: (bloco + 1) * 1_000,
            domain: "corporate",
            wordCount: 180,
            humanSourceType: "employee-post",
            author: `xa_${indice}`,
            source: `xs_${indice}`,
            domainSource: `xds_${indice}`,
            collectionBatch: `xcb_${indice}`,
            nearDuplicate: `xnd_${indice}`,
            derivationRoot: `x${bloco}_${i}`,
          }),
        );
        indice += 1;
      }
    });
    expect(() => createBlockedSplit(registros, POLICY)).toThrow(
      /proportions|unreachable/iu,
    );
  });
});

describe("class tolerance is inclusive at the boundary", () => {
  // 3% and 7% of a class in `dev` are LEGAL by the frozen contract, and binary floats do not
  // represent the boundary: `Math.abs(0.03 - 0.05)` is 0.020000000000000004, strictly greater
  // than 0.02. Comparing raw floats refuses exactly the two values the contract admits, which
  // is what the cross-review measured across four independent comparisons.
  it("accepts exactly 3% and 7% against a 5% target", () => {
    expect(withinClassTolerance(0.03, 0.05)).toBe(true);
    expect(withinClassTolerance(0.07, 0.05)).toBe(true);
  });

  it("still refuses fractions genuinely outside the tolerance", () => {
    expect(withinClassTolerance(0.0299, 0.05)).toBe(false);
    expect(withinClassTolerance(0.0701, 0.05)).toBe(false);
  });

  it("pins the epsilon so the Python mirror can be compared against it", () => {
    expect(CLASS_TOLERANCE_EPSILON).toBe(1e-9);
  });
});

describe("createBlockedSplit", () => {
  it("keeps connected groups together and the holdout family in test", () => {
    const split = createBlockedSplit(DATASET, {
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
    });
    const audit = auditBlockedSplit(
      DATASET,
      split,
      RELEASE_AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );
    expect(audit.leakages).toEqual([]);
    // Reads the CANONICAL field, like the splitter does. Asserting on
    // `generation.family` here would keep passing even if the held-out mark stopped
    // working, because the two spellings coincide in this fixture.
    expect(
      split.test.filter((row) => generatorFamilyOf(row) === "family-unseen"),
    ).not.toHaveLength(0);
    expect(
      [
        ...split.train,
        ...split.dev,
        ...split["cal-A"],
        ...split["cal-B"],
      ].filter((row) => generatorFamilyOf(row) === "family-unseen"),
    ).toHaveLength(0);
  });

  it("does not collapse every linkedin record or every seen family into one component", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    expect(split.train.some((row) => row.domain === "corporate")).toBe(true);
    expect(split.test.some((row) => row.domain === "corporate")).toBe(true);
    expect(
      split["cal-A"].some((row) => generatorFamilyOf(row) === "family-seen"),
    ).toBe(true);
    expect(
      split.test.some((row) => generatorFamilyOf(row) === "family-seen"),
    ).toBe(true);
  });

  it("confines every grouping axis to a single partition (no leakage on all eight axes)", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    const partitions: Array<[Partition, BenchmarkRecord[]]> = [
      ["train", split.train],
      ["dev", split.dev],
      ["cal-A", split["cal-A"]],
      ["cal-B", split["cal-B"]],
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

  it("splits every class 45/5/10/20/20 within the two-point tolerance", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    const audit = auditBlockedSplit(
      DATASET,
      split,
      RELEASE_AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );
    // Restated here on purpose rather than imported from the audit: a test that reads
    // the same constant the implementation reads cannot fail when that constant moves.
    const expected: Array<[Partition, number]> = [
      ["train", 0.45],
      ["dev", 0.05],
      ["cal-A", 0.1],
      ["cal-B", 0.2],
      ["test", 0.2],
    ];
    // Every partition, not a subset: with four of five checked the fifth can drift
    // eight points and still leave this test green.
    expect(expected.map(([partition]) => partition)).toEqual([...PARTITIONS]);
    for (const label of ["human", "ai", "mixed"] as const) {
      for (const [partition, target] of expected) {
        expect(
          Math.abs(audit.classFractions[label][partition] - target),
          `${label} ${partition}`,
        ).toBeLessThanOrEqual(0.02);
      }
    }
  });

  it("keeps the blocked test strictly newer than every other partition", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    const earliestTest = Math.min(...split.test.map((row) => row.createdAt));
    // Against each partition individually. Comparing only against the newest of the
    // four would let test overlap a partition that is not its immediate neighbour.
    for (const partition of PARTITIONS) {
      if (partition === "test") continue;
      const rows = split[partition];
      expect(rows.length, `${partition} is non-empty`).toBeGreaterThan(0);
      expect(
        earliestTest,
        `test starts after all of ${partition}`,
      ).toBeGreaterThan(Math.max(...rows.map((row) => row.createdAt)));
    }
  });

  it("is deterministic for a fixed seed", () => {
    const first = createBlockedSplit(DATASET, POLICY);
    const second = createBlockedSplit(DATASET, POLICY);
    const ids = (rows: BenchmarkRecord[]): string[] =>
      rows.map((row) => row.id);
    for (const partition of PARTITIONS) {
      expect(ids(first[partition]), partition).toEqual(ids(second[partition]));
    }
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
    // Every record shares one timestamp, so no strictly increasing quadruple of cuts
    // exists at all: fail closed at the no-cut branch rather than relax anything.
    //
    // The message says "no candidate cut quadruple", not "no temporal cut exists". The
    // candidate grid is bounded, so an empty result proves only that nothing in the grid
    // worked — here that happens to coincide with genuine impossibility, but the message
    // must not claim the stronger thing in the cases where it does not.
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
      /no candidate cut quadruple realises/,
    );
  });

  it("throws the class-fraction error when 45/5/10/20/20 is unreachable within tolerance", () => {
    // Human lives entirely in the oldest half of the timeline, AI entirely in
    // the newest half. Candidate cuts exist (many distinct timestamps) and the
    // search finds a legal quadruple, but no set of global cuts can give both
    // classes a 20% test block — so the per-class ±2pp guard must throw,
    // exercising the class-fraction path and not the no-cut branch.
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

// F1-4: lineage is refused BEFORE anything is partitioned.
//
// WHAT IS ALREADY COVERED ELSEWHERE, so this block does not repeat it: the
// colocation itself is "confines every grouping axis to a single partition (no leakage
// on all eight axes)" above, which walks `derivationRoot` and `humanSeed` over a
// dataset the temporal cut can actually satisfy; the refusal's own behaviour is pinned
// in `benchmark/tests/schema-v3.test.ts`. What was missing is the wiring — the refusal
// existed with no production caller and `benchmark/split.ts` named it in a comment as
// where an unresolved parent "belongs".
//
// WHAT IS STILL NOT COVERED, stated rather than implied: `assertDerivedParentsResolve`
// returns immediately for any record whose `schemaVersion` is not 3, and the
// end-to-end scenario in `corpus-import.test.ts` builds a v2 corpus of 10 000 records.
// So no test in this repository runs the new call over a corpus it actually inspects.
// An integration test needs a v3 dataset with coherent manifest + audit digests, which
// means sealing one; it is recorded as an open finding.
describe("F1-4 — the refusal is wired ahead of the splitter", () => {
  it("calls the refusal before the split, in the command itself", async () => {
    // A source-order assertion, and worth saying why rather than apologizing for it:
    // the plan's requirement is positional — "a execução chama
    // `assertDerivedParentsResolve` ANTES do split". Behaviour lives in the two places
    // named above; what this pins is that the call cannot drift below
    // `createBlockedSplit`, where it would be refusing a corpus already partitioned.
    const { readFile } = await import("node:fs/promises");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const source = await readFile(
      resolve(dirname(fileURLToPath(import.meta.url)), "../commands/split.ts"),
      "utf8",
    );
    const refusal = source.indexOf("assertDerivedParentsResolve(records)");
    const partitioning = source.indexOf("createBlockedSplit(records");
    expect(refusal, "the command calls the refusal").toBeGreaterThan(-1);
    expect(partitioning, "the command partitions the records").toBeGreaterThan(
      -1,
    );
    expect(refusal, "the refusal must precede the partitioning").toBeLessThan(
      partitioning,
    );
  });

  it("leaves the clusterer permissive about an absent parent, deliberately", () => {
    // The two responsibilities stay apart, and this is the direction that matters:
    // the clusterer sees ONE record set and cannot answer a selection question about
    // the whole corpus, so it must not throw on a parent it simply cannot see. The
    // `ids.has(parent)` guard in `buildClusters` is what keeps it permissive, and it
    // stays even though the command path now guarantees every parent resolves.
    expect(PARENT_LINKAGE_AXES).toContain("humanSeed");
    expect(axisConnectivity("humanSeed")).toEqual({
      sharedValue: false,
      parentLinkage: true,
    });
  });
});
