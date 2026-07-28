// A4 — the canonical generator-family identifier.
//
// One spelling error broke two mechanisms at once. `generation.family` carried the
// provider's literal label (`gemini-3.5-flash-low`, with dots) while
// `groups.generatorFamily` and `manifest.heldOutGeneratorFamilies` carried the
// pseudonymised token (`gemini-3_5-flash-low`, with underscores) — and both the
// `generatorExposure` slice and the splitter's held-out mark compared the DECLARED
// set against `generation.family`. Neither comparison could ever match, so the
// slice only ever produced `seen` and `component.heldOut` was never true.
//
// Every fixture below carries BOTH spellings, exactly as the real corpus did, so a
// regression to the non-canonical read makes these tests fail again.

import { describe, expect, it } from "vitest";

import {
  asGeneratorFamily,
  assertGeneratorFamilyAgreement,
  GeneratorFamilyError,
  generatorFamilyOf,
  isCanonicalGeneratorFamily,
  normalizeGeneratorFamily,
} from "../generator-family.ts";
import type { EvaluationItem } from "../metrics.ts";
import { validateBenchmarkRecord } from "../schema.ts";
import { buildSlices } from "../slices.ts";
import {
  createBlockedSplit,
  markedHeldOutGeneratorFamilies,
  SplitConstraintError,
  type BlockedSplitPolicy,
} from "../split.ts";
import type {
  BenchmarkLabel,
  BenchmarkRecord,
  TransformationKind,
} from "../schema.ts";

const SHA = "a".repeat(64);

const PROVIDER_SPELLING = "gemini-3.5-flash-low";
const CANONICAL_SPELLING = "gemini-3_5-flash-low";
const SEEN_FAMILY = "family-seen";

interface RecordSpec {
  id: string;
  label: BenchmarkLabel;
  createdAt: number;
  domain: string;
  wordCount: number;
  humanSourceType?: string;
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

function plain(spec: RecordSpec): Record<string, unknown> {
  const kind: TransformationKind = spec.transformationKind ?? "none";
  const groups: Record<string, unknown> = {
    author: spec.author,
    source: spec.source,
    domainSource: spec.domainSource,
    collectionBatch: spec.collectionBatch,
    nearDuplicate: spec.nearDuplicate,
    derivationRoot: spec.derivationRoot,
  };
  if (spec.generatorVersion !== undefined) {
    groups.generatorVersion = spec.generatorVersion;
  }
  if (spec.promptTemplate !== undefined) {
    groups.promptTemplate = spec.promptTemplate;
  }
  if (spec.family !== undefined) {
    // The canonical field is the normalized form of the provider's label — the
    // single fact, written once.
    groups.generatorFamily = normalizeGeneratorFamily(spec.family);
  }
  const record: Record<string, unknown> = {
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
    transformation: { kind, severity: kind === "none" ? "none" : "medium" },
    groups,
  };
  if (spec.humanSourceType !== undefined) {
    record.humanSourceType = spec.humanSourceType;
  }
  if (spec.family !== undefined) {
    record.generation = {
      provider: "google",
      family: spec.family,
      model: spec.family,
      version: spec.family,
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
      generationMode: "mechanistic",
    };
  }
  return record;
}

function rec(spec: RecordSpec): BenchmarkRecord {
  return validateBenchmarkRecord(plain(spec));
}

function buildDataset(options: { unseenFromSlot: number }): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  const SLOTS = 100;
  const lengths = [40, 180, 520];
  const aiKinds: TransformationKind[] = [
    "paraphrase",
    "back-translation",
    "expand",
  ];

  for (let slot = 1; slot <= SLOTS; slot += 1) {
    for (let i = 0; i < 6; i += 1) {
      records.push(
        rec({
          id: `h_${slot}_${i}`,
          label: "human",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: lengths[i % 3],
          humanSourceType: i % 2 === 0 ? "employee-post" : "newsletter",
          author: `auth_h_${slot}`,
          source: `src_h_${slot}`,
          domainSource: `ds_h_${slot}`,
          collectionBatch: `cb_h_${slot}`,
          nearDuplicate: `nd_h_${slot}`,
          derivationRoot: `h_${slot}_0`,
        }),
      );
    }
    for (let i = 0; i < 4; i += 1) {
      records.push(
        rec({
          id: `a_${slot}_${i}`,
          label: "ai",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: [50, 200, 480][i % 3],
          transformationKind: aiKinds[i % 3],
          family: SEEN_FAMILY,
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
    for (let i = 0; i < 3; i += 1) {
      records.push(
        rec({
          id: `m_${slot}_${i}`,
          label: "mixed",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: [60, 220, 500][i % 3],
          transformationKind: "human-ai-mix",
          family: SEEN_FAMILY,
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

  for (let slot = options.unseenFromSlot; slot <= SLOTS; slot += 1) {
    records.push(
      rec({
        id: `u_${slot}_0`,
        label: "ai",
        createdAt: slot,
        domain: "linkedin",
        wordCount: 300,
        transformationKind: "paraphrase",
        family: PROVIDER_SPELLING,
        author: `auth_u_${slot}`,
        source: `src_u_${slot}`,
        domainSource: `ds_u_${slot}`,
        collectionBatch: `cb_u_${slot}`,
        nearDuplicate: `nd_u_${slot}`,
        derivationRoot: `u_${slot}_0`,
        generatorVersion: `gv_unseen_${slot}`,
        promptTemplate: `pt_u_${slot}`,
      }),
    );
  }
  return records;
}

const DATASET = buildDataset({ unseenFromSlot: 96 });

const POLICY: BlockedSplitPolicy = {
  fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
  classTolerance: 0.02,
  heldOutGeneratorFamilies: [asGeneratorFamily(CANONICAL_SPELLING)],
  seed: 712_019,
};

function item(record: BenchmarkRecord): EvaluationItem {
  const positive =
    record.label === "ai" ||
    (record.label === "mixed" && (record.mixture?.aiFraction ?? 0) >= 0.5);
  return {
    record,
    documentScore: positive ? 0.9 : 0.1,
    warned: positive,
    visualActioned: false,
    status: "scored",
    latencyMs: 10,
    memoryBytes: 1_000,
  };
}

// (c) — a divergent spelling FAILS instead of passing silently.
describe("schema refuses a divergent generator-family spelling", () => {
  function generated(overrides: {
    generationFamily?: string;
    canonicalFamily?: string | null;
  }): Record<string, unknown> {
    const record = plain({
      id: "g1",
      label: "ai",
      createdAt: 1,
      domain: "linkedin",
      wordCount: 120,
      family: PROVIDER_SPELLING,
      author: "a",
      source: "s",
      domainSource: "ds",
      collectionBatch: "cb",
      nearDuplicate: "nd",
      derivationRoot: "g1",
    });
    if (overrides.generationFamily !== undefined) {
      (record.generation as Record<string, unknown>).family =
        overrides.generationFamily;
    }
    const groups = record.groups as Record<string, unknown>;
    if (overrides.canonicalFamily === null) {
      delete groups.generatorFamily;
    } else if (overrides.canonicalFamily !== undefined) {
      groups.generatorFamily = overrides.canonicalFamily;
    }
    return record;
  }

  it("accepts the coherent pair", () => {
    expect(() => validateBenchmarkRecord(generated({}))).not.toThrow();
  });

  it("refuses a canonical field that names a different family", () => {
    expect(() =>
      validateBenchmarkRecord(
        generated({ canonicalFamily: "gemini-3_6-flash-low" }),
      ),
    ).toThrow(/groups\.generatorFamily/);
  });

  it("refuses a canonical field left in the provider's spelling", () => {
    expect(() =>
      validateBenchmarkRecord(
        generated({ canonicalFamily: PROVIDER_SPELLING }),
      ),
    ).toThrow(/groups\.generatorFamily/);
  });

  it("refuses a generated record that carries no canonical field at all", () => {
    expect(() =>
      validateBenchmarkRecord(generated({ canonicalFamily: null })),
    ).toThrow(/groups\.generatorFamily/);
  });

  // generator-family.ts cannot import schema.ts (schema.ts imports it), so it keeps
  // its own copy of the pseudonym character class. This pins that the two agree by
  // running the values through the validator itself, not by comparing regexes: a
  // token the module calls canonical is one the schema accepts, and one it rejects
  // the schema rejects too.
  it("agrees with the schema on exactly which tokens are canonical", () => {
    for (const candidate of [
      "gemini-3_5-flash-low",
      "A",
      "acme_family",
      "madras_victory_1",
      "gemini-3.5-flash-low",
      "gemini 3 5",
      "_leading",
      "trailing_",
      "família",
    ]) {
      const accepted = (() => {
        try {
          validateBenchmarkRecord(
            generated({
              generationFamily: candidate,
              canonicalFamily: candidate,
            }),
          );
          return true;
        } catch {
          return false;
        }
      })();
      expect(accepted).toBe(isCanonicalGeneratorFamily(candidate));
    }
  });
});

// (a) — the split FORCES the declared family into test, and the mark is real.
describe("createBlockedSplit and the held-out family", () => {
  it("puts every record of the declared family in test and none elsewhere", () => {
    const split = createBlockedSplit(DATASET, POLICY);
    expect(
      split.test.filter((row) => generatorFamilyOf(row) === CANONICAL_SPELLING),
    ).not.toHaveLength(0);
    expect(
      [...split.development, ...split.calibration].filter(
        (row) => generatorFamilyOf(row) === CANONICAL_SPELLING,
      ),
    ).toHaveLength(0);
  });

  it("reports the declared family as actually marked, not silently ignored", () => {
    expect(markedHeldOutGeneratorFamilies(DATASET, POLICY)).toEqual([
      CANONICAL_SPELLING,
    ]);
  });

  it("marks nothing when the declared spelling is the provider's, and says so", () => {
    // The exact shape of the original defect, now visible instead of silent: a
    // reservation written in the dotted spelling matches no record, so the marked
    // set is empty and the four-way invariant in benchmark/commands/split.ts
    // refuses the split instead of producing a test partition that reserves
    // nothing.
    const dotted: BlockedSplitPolicy = {
      ...POLICY,
      heldOutGeneratorFamilies: [
        asGeneratorFamily(PROVIDER_SPELLING.replaceAll(".", "-")),
      ],
    };
    expect(markedHeldOutGeneratorFamilies(DATASET, dotted)).toEqual([]);
    expect(() =>
      assertGeneratorFamilyAgreement({
        declared: dotted.heldOutGeneratorFamilies,
        marked: markedHeldOutGeneratorFamilies(DATASET, dotted),
        derived: dotted.heldOutGeneratorFamilies,
        published: dotted.heldOutGeneratorFamilies,
      }),
    ).toThrow(/the marked generator families diverge from the declared set/);
  });

  // The non-vacuous half of (a): this constraint fires ONLY when
  // `component.heldOut` is true.
  it("refuses a declared family that is not temporally eligible for test", () => {
    const early = buildDataset({ unseenFromSlot: 2 });
    expect(() => createBlockedSplit(early, POLICY)).toThrow(
      SplitConstraintError,
    );
    expect(() => createBlockedSplit(early, POLICY)).toThrow(
      /not temporally eligible for test/,
    );
  });
});

// (b) — the generatorExposure slice produces a NON-EMPTY `unseen` bucket.
//
// Its own small fixture rather than DATASET: buildSlices bootstraps an interval per
// bucket on nine axes, and the 1,300-record split fixture makes that the slowest
// assertion in the file for no added coverage. Three seen positives and two unseen
// ones are enough to distinguish an empty `unseen` bucket from a populated one.
describe("the generatorExposure slice", () => {
  function exposureItem(id: string, family: string): EvaluationItem {
    return item(
      rec({
        id,
        label: "ai",
        createdAt: 1,
        domain: "linkedin",
        wordCount: 120,
        family,
        author: `auth_${id}`,
        source: `src_${id}`,
        domainSource: `ds_${id}`,
        collectionBatch: `cb_${id}`,
        nearDuplicate: `nd_${id}`,
        derivationRoot: id,
      }),
    );
  }

  it("buckets the declared family as unseen and the rest as seen", () => {
    const items = [
      exposureItem("s1", SEEN_FAMILY),
      exposureItem("s2", SEEN_FAMILY),
      exposureItem("s3", SEEN_FAMILY),
      // Declared with underscores, carried in the recipe with dots: the pair that
      // used to make this bucket unreachable.
      exposureItem("u1", PROVIDER_SPELLING),
      exposureItem("u2", PROVIDER_SPELLING),
    ];
    const slices = buildSlices(items, {
      bootstrapSeed: 424_242,
      heldOutGeneratorFamilies: [asGeneratorFamily(CANONICAL_SPELLING)],
    });
    const exposure = slices.filter(
      (slice) => slice.axis === "generatorExposure",
    );
    const unseen = exposure.find((slice) => slice.key === "unseen");
    const seen = exposure.find((slice) => slice.key === "seen");
    expect(unseen).toBeDefined();
    expect(unseen?.sampleSize).toBe(2);
    // Non-vacuous: the declared set selects a subset, it does not relabel
    // everything.
    expect(seen).toBeDefined();
    expect(seen?.sampleSize).toBe(3);
  });
});

describe("normalizeGeneratorFamily", () => {
  it("converges both corpus spellings onto one canonical token", () => {
    expect(normalizeGeneratorFamily(PROVIDER_SPELLING)).toBe(
      CANONICAL_SPELLING,
    );
    expect(normalizeGeneratorFamily(CANONICAL_SPELLING)).toBe(
      CANONICAL_SPELLING,
    );
  });

  it("is idempotent under re-normalization", () => {
    for (const raw of [
      PROVIDER_SPELLING,
      "madras:victory (1)",
      "gpt-5.6-luna",
      "  spaced name  ",
      "A",
      "gemini_3_5_",
    ]) {
      const once = normalizeGeneratorFamily(raw);
      expect(normalizeGeneratorFamily(once)).toBe(once);
      expect(isCanonicalGeneratorFamily(once)).toBe(true);
    }
  });

  it("refuses a label with no canonical content instead of inventing one", () => {
    expect(() => normalizeGeneratorFamily("...")).toThrow(GeneratorFamilyError);
    expect(() => normalizeGeneratorFamily("")).toThrow(
      /carries no character of/,
    );
  });

  it("preserves case, so two provider labels never collapse into one family", () => {
    expect(normalizeGeneratorFamily("Gemini-3.5")).toBe("Gemini-3_5");
    expect(normalizeGeneratorFamily("gemini-3.5")).toBe("gemini-3_5");
  });
});

describe("asGeneratorFamily", () => {
  it("refuses a non-canonical spelling instead of silently correcting it", () => {
    expect(() => asGeneratorFamily(PROVIDER_SPELLING)).toThrow(
      /not in canonical form/,
    );
    // The refusal still names the canonical spelling, so a caller can fix the
    // input rather than guess at it.
    expect(() => asGeneratorFamily(PROVIDER_SPELLING)).toThrow(
      new RegExp(CANONICAL_SPELLING),
    );
  });

  it("accepts a token already in canonical form", () => {
    expect(asGeneratorFamily(CANONICAL_SPELLING)).toBe(CANONICAL_SPELLING);
  });
});

describe("generatorFamilyOf", () => {
  it("reads the canonical field and leaves the provider's label alone", () => {
    const record = rec({
      id: "one",
      label: "ai",
      createdAt: 1,
      domain: "linkedin",
      wordCount: 120,
      family: PROVIDER_SPELLING,
      author: "a",
      source: "s",
      domainSource: "ds",
      collectionBatch: "cb",
      nearDuplicate: "nd",
      derivationRoot: "one",
    });
    expect(generatorFamilyOf(record)).toBe(CANONICAL_SPELLING);
    // The provider's own label survives unnormalized inside the recipe, because
    // benchmark/corpus-source-audit.ts matches it byte for byte against the
    // declared generation batch.
    expect(record.generation?.family).toBe(PROVIDER_SPELLING);
  });
});

describe("assertGeneratorFamilyAgreement", () => {
  const declared = [asGeneratorFamily("a_one"), asGeneratorFamily("b_two")];

  it("accepts four sets that agree exactly, in any order", () => {
    expect(() =>
      assertGeneratorFamilyAgreement({
        declared,
        marked: [asGeneratorFamily("b_two"), asGeneratorFamily("a_one")],
        derived: declared,
        published: declared,
      }),
    ).not.toThrow();
  });

  it("names which set diverged from which, and fails hard", () => {
    const diverging = {
      declared,
      marked: [asGeneratorFamily("a_one")],
      derived: declared,
      published: declared,
    };
    expect(() => assertGeneratorFamilyAgreement(diverging)).toThrow(
      GeneratorFamilyError,
    );
    expect(() => assertGeneratorFamilyAgreement(diverging)).toThrow(
      /the marked generator families diverge from the declared set/,
    );
  });

  it("refuses a set that omits a member and a set that adds one", () => {
    expect(() =>
      assertGeneratorFamilyAgreement({
        declared,
        marked: declared,
        derived: [...declared, asGeneratorFamily("c_three")],
        published: declared,
      }),
    ).toThrow(/derived omits \[\] and adds \[c_three\]/);
    expect(() =>
      assertGeneratorFamilyAgreement({
        declared,
        marked: declared,
        derived: declared,
        published: [asGeneratorFamily("a_one")],
      }),
    ).toThrow(/published omits \[b_two\] and adds \[\]/);
  });

  it("refuses a duplicated member rather than let it hide a difference", () => {
    expect(() =>
      assertGeneratorFamilyAgreement({
        declared,
        marked: [...declared, asGeneratorFamily("a_one")],
        derived: declared,
        published: declared,
      }),
    ).toThrow(/the marked generator families list "a_one" more than once/);
  });
});
