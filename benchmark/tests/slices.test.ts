import { describe, expect, it } from "vitest";

import type {
  DecisionFamilies,
  DecisionMetrics,
  EvaluationItem,
  EvaluationMetrics,
} from "../metrics.ts";
import {
  buildSlices,
  summarizeSlices,
  type SliceAxis,
  type SliceResult,
} from "../slices.ts";
import type { BenchmarkRecord } from "../schema.ts";
import {
  asGeneratorFamily,
  normalizeGeneratorFamily,
} from "../generator-family.ts";

interface RecordFields {
  author: string;
  label: "human" | "ai" | "mixed";
  wordCount?: number;
  aiFraction?: number;
  domain?: string;
  platform?: string;
  sourceId?: string;
  humanSourceType?: string;
  hardNegativeFamily?: string;
  transformationKind?: string;
  severity?: string;
  generatorFamily?: string;
  createdAt?: number;
  generationMode?: "mechanistic" | "ecological";
  // The inner two levels of the ai-recall row and the human parent of the mixed
  // row. Defaulted per label by `record`; named here so a fixture can vary them.
  promptTemplate?: string;
  generationBatch?: string;
  humanSeed?: string;
}

function record(fields: RecordFields): BenchmarkRecord {
  const base: Record<string, unknown> = {
    label: fields.label,
    language: "pt-BR",
    wordCount: fields.wordCount ?? 120,
    domain: fields.domain ?? "corporate",
    platform: fields.platform ?? "generic-platform",
    provenance: { sourceId: fields.sourceId ?? "corpus-generic" },
    createdAt: fields.createdAt ?? 1_000,
    transformation: {
      kind: fields.transformationKind ?? "none",
      severity: fields.severity ?? "none",
    },
    // C4 resolves the resampling unit off the grouping axes, so a fixture that
    // reaches computeEvaluationMetrics has to declare the outer level too.
    groups: { author: fields.author, domainSource: "pool-generic" },
  };
  if (fields.humanSourceType !== undefined) {
    base.humanSourceType = fields.humanSourceType;
  }
  if (fields.hardNegativeFamily !== undefined) {
    base.hardNegativeFamily = fields.hardNegativeFamily;
  }
  if (fields.aiFraction !== undefined) {
    base.mixture = {
      aiFraction: fields.aiFraction,
      humanFraction: 1 - fields.aiFraction,
      spans: [],
      generationMode: fields.generationMode ?? "mechanistic",
    };
  }
  if (fields.generatorFamily !== undefined) {
    // Both fields, as a real record carries them: the provider's own label inside
    // the recipe, and the canonical token in groups — which is the ONLY field the
    // generatorExposure extractor reads (benchmark/generator-family.ts).
    base.generation = { family: fields.generatorFamily };
    (base.groups as Record<string, unknown>).generatorFamily =
      normalizeGeneratorFamily(fields.generatorFamily);
  }
  // The ai-recall row of the frozen table nests generator ⊃ prompt template ⊃
  // batch, so a POSITIVE row has to declare all three or its recall interval has no
  // unit; a mechanistic mixed row also declares the human parent the mixed row
  // crosses. Human rows declare none: an apparatus axis is `notApplicable` on human
  // text by rule, and no design reads one over a human population.
  if (fields.label !== "human") {
    const groups = base.groups as Record<string, unknown>;
    if (groups.generatorFamily === undefined) {
      groups.generatorFamily = normalizeGeneratorFamily("gen-generic");
    }
    groups.promptTemplate = fields.promptTemplate ?? "tpl-generic";
    groups.generationBatch = fields.generationBatch ?? "batch-generic";
    if (
      fields.label === "mixed" &&
      (fields.generationMode ?? "mechanistic") === "mechanistic"
    ) {
      groups.humanSeed = fields.humanSeed ?? `seed-${fields.author}`;
    }
  }
  return base as unknown as BenchmarkRecord;
}

interface ItemFields extends RecordFields {
  documentScore?: number;
  warned?: boolean;
  visualActioned?: boolean;
  // Mirrors the helper in benchmark/tests/metrics.test.ts. Without it every
  // fixture row here is `scored`, and then the end-to-end and the
  // conditional-on-scored families are numerically identical — which would leave
  // this file unable to test the one thing A3 is about: what a row that produced
  // no decision does to a denominator.
  status?: "scored" | "abstained" | "error";
}

function item(fields: ItemFields): EvaluationItem {
  const status = fields.status ?? "scored";
  if (status !== "scored") {
    // Both decisions, not just `warned`: an unscored row that quietly kept a
    // `visualActioned: true` would be the same defect one field over, and the
    // visualAction family is the one no assertion in this file reads.
    if (
      fields.documentScore !== undefined ||
      fields.warned !== undefined ||
      fields.visualActioned !== undefined
    ) {
      throw new Error(
        `a ${status} fixture row carries no score and no decision`,
      );
    }
    return {
      record: record(fields),
      status,
      latencyMs: 10,
      memoryBytes: 1_000,
    };
  }
  const positive =
    fields.label === "ai" ||
    (fields.label === "mixed" && (fields.aiFraction ?? 0) >= 0.5);
  return {
    record: record(fields),
    documentScore: fields.documentScore ?? (positive ? 0.9 : 0.1),
    warned: fields.warned ?? positive,
    visualActioned: fields.visualActioned ?? false,
    status: "scored",
    latencyMs: 10,
    memoryBytes: 1_000,
  };
}

function find(
  slices: readonly SliceResult[],
  axis: SliceAxis,
  key: string,
): SliceResult | undefined {
  return slices.find((slice) => slice.axis === axis && slice.key === key);
}

const SEED = {
  bootstrapSeed: 424242,
  heldOutGeneratorFamilies: [asGeneratorFamily("gpt")],
};

// A fixture whose buckets are single-class on every axis, so building slices
// stays cheap while exercising the 300-negative / 200-positive gate floors.
function eligibilityFixture(): EvaluationItem[] {
  const items: EvaluationItem[] = [];
  for (let i = 0; i < 300; i += 1) {
    items.push(
      item({
        author: `corp_${i}`,
        label: "human",
        domain: "corp",
        wordCount: 60,
        humanSourceType: "journalist",
        hardNegativeFamily: "hn_a",
        createdAt: i,
      }),
    );
  }
  for (let i = 0; i < 299; i += 1) {
    items.push(
      item({
        author: `startup_${i}`,
        label: "human",
        domain: "startup",
        wordCount: 85,
        humanSourceType: "blogger",
        hardNegativeFamily: "hn_b",
        createdAt: 300 + i,
      }),
    );
  }
  for (let i = 0; i < 200; i += 1) {
    items.push(
      item({
        author: `tech_${i}`,
        label: "ai",
        domain: "tech",
        wordCount: 120,
        transformationKind: "paraphrase",
        severity: "high",
        generatorFamily: "gpt",
        createdAt: 1_000 + i,
      }),
    );
  }
  for (let i = 0; i < 199; i += 1) {
    items.push(
      item({
        author: `media_${i}`,
        label: "ai",
        domain: "media",
        wordCount: 200,
        transformationKind: "expand",
        severity: "medium",
        generatorFamily: "claude",
        createdAt: 1_300 + i,
      }),
    );
  }
  return items;
}

describe("buildSlices declared sample size", () => {
  it("declares the population that produced the estimate, not the raw bucket", () => {
    // The slice's decision matrix is measured over the ELIGIBLE subset, so the
    // positive/negative counts it publishes — which become GateResult.sampleSize
    // and the sealed profile's ProportionGateEvidenceV1.sampleSize — must be
    // that same subset. Declaring the raw bucket would advertise statistical
    // power the interval does not have, in the favorable direction.
    //
    // The fixture pins BOTH declared counts against BOTH wrong alternatives at
    // once, so no read can be swapped without a failure. Each class has an
    // eligible row whose inference failed and an ineligible row, which makes the
    // three candidate populations numerically distinct:
    //   negatives — raw bucket 4 (the pre-correction recount), end-to-end
    //     eligible 3, conditional-on-scored 2;
    //   positives — raw bucket 3, end-to-end eligible 2,
    //     conditional-on-scored 1.
    // The conditional family is the one this module documents that it never
    // reads, because a slice whose inference failed must not look better than
    // one that answered.
    const items = [
      item({ author: "h1", label: "human", domain: "corp", wordCount: 120 }),
      item({ author: "h2", label: "human", domain: "corp", wordCount: 120 }),
      // Eligible (pt-BR, 120 words) but its inference failed: it stays in the
      // end-to-end denominator as an undecided negative, and drops out of the
      // conditional one.
      item({
        author: "h3",
        label: "human",
        domain: "corp",
        wordCount: 120,
        status: "error",
      }),
      // Below the 50-word floor: ineligible, so it is in the raw bucket only.
      item({ author: "h4", label: "human", domain: "corp", wordCount: 30 }),
      item({ author: "a1", label: "ai", domain: "corp", wordCount: 120 }),
      // The positive mirror of h3: eligible, inference failed. End-to-end it is
      // an undecided positive — a miss — and it leaves the conditional
      // population. Without it both families report `positives` 1 and the
      // `positives` read in slices.ts is pinned by nothing.
      item({
        author: "a3",
        label: "ai",
        domain: "corp",
        wordCount: 120,
        status: "error",
      }),
      item({ author: "a2", label: "ai", domain: "corp", wordCount: 20 }),
    ];

    const corp = find(buildSlices(items, SEED), "domain", "corp");

    // sampleSize stays descriptive: every row that landed in the bucket.
    expect(corp?.sampleSize).toBe(7);
    expect(corp?.negatives).toBe(3);
    expect(corp?.positives).toBe(2);
    expect(corp?.negatives).toBe(corp?.metrics.warning.endToEnd.negatives);
    expect(corp?.positives).toBe(corp?.metrics.warning.endToEnd.positives);
    // Both declared counts are strictly the UNFAVORABLE one: reading the
    // conditional family instead would drop the errored rows and publish
    // smaller, flattering denominators. For `positives` that is what lets a
    // recall slice damaged by inference failures fall under
    // DEFAULT_MINIMUM_RECALL_POSITIVES and escape the recall gate entirely.
    expect(corp?.metrics.warning.conditionalOnScored.negatives).toBe(2);
    expect(corp?.negatives).toBeGreaterThan(
      corp?.metrics.warning.conditionalOnScored.negatives ?? 0,
    );
    expect(corp?.metrics.warning.conditionalOnScored.positives).toBe(1);
    expect(corp?.positives).toBeGreaterThan(
      corp?.metrics.warning.conditionalOnScored.positives ?? 0,
    );
    expect(corp?.metrics.warning.endToEnd.undecidedNegatives).toBe(1);
    expect(corp?.metrics.warning.endToEnd.undecidedPositives).toBe(1);
    // ...and `negatives` is a CLASS count, not the FPR interval's denominator:
    // falsePositiveRate runs over FP + TN = 2, one row fewer. See the note on
    // SliceResult in benchmark/slices.ts.
    const warning = corp?.metrics.warning.endToEnd;
    expect((warning?.falsePositives ?? 0) + (warning?.trueNegatives ?? 0)).toBe(
      2,
    );
  });
});

describe("buildSlices gate eligibility", () => {
  it("marks slices gate-eligible per the 300-negative / 200-positive floors", () => {
    const slices = buildSlices(eligibilityFixture(), SEED);

    const corp = find(slices, "domain", "corp");
    expect(corp?.negatives).toBe(300);
    expect(corp?.fprGateEligible).toBe(true);

    const startup = find(slices, "domain", "startup");
    expect(startup?.negatives).toBe(299);
    expect(startup?.fprGateEligible).toBe(false);

    const tech = find(slices, "domain", "tech");
    expect(tech?.positives).toBe(200);
    expect(tech?.recallGateEligible).toBe(true);

    const media = find(slices, "domain", "media");
    expect(media?.positives).toBe(199);
    expect(media?.recallGateEligible).toBe(false);

    // humanSourceType is an FPR-only axis.
    const journalist = find(slices, "humanSourceType", "journalist");
    expect(journalist?.negatives).toBe(300);
    expect(journalist?.fprGateEligible).toBe(true);
    expect(journalist?.recallGateEligible).toBe(false);

    // severity is a recall-only axis: 599 negatives never make it FPR-eligible.
    const cleanSeverity = find(slices, "severity", "none");
    expect(cleanSeverity?.negatives).toBe(599);
    expect(cleanSeverity?.fprGateEligible).toBe(false);
    const highSeverity = find(slices, "severity", "high");
    expect(highSeverity?.positives).toBe(200);
    expect(highSeverity?.recallGateEligible).toBe(true);

    // generatorExposure compares family to the held-out set.
    const unseen = find(slices, "generatorExposure", "unseen");
    expect(unseen?.positives).toBe(200);
    expect(unseen?.recallGateEligible).toBe(true);
    const seen = find(slices, "generatorExposure", "seen");
    expect(seen?.positives).toBe(199);
    expect(seen?.recallGateEligible).toBe(false);
  }, 60_000);

  it("honors overridden sample floors", () => {
    const items = [
      item({ author: "b1", label: "human", domain: "big" }),
      item({ author: "b2", label: "human", domain: "big" }),
      item({ author: "b3", label: "human", domain: "big" }),
      item({ author: "s1", label: "human", domain: "small" }),
      item({ author: "s2", label: "human", domain: "small" }),
      item({ author: "p1", label: "ai", domain: "pos" }),
      item({ author: "p2", label: "ai", domain: "pos" }),
      item({ author: "q1", label: "ai", domain: "posSmall" }),
    ];

    const slices = buildSlices(items, {
      bootstrapSeed: 7,
      heldOutGeneratorFamilies: [],
      minimumFprNegatives: 3,
      minimumRecallPositives: 2,
    });

    expect(find(slices, "domain", "big")?.fprGateEligible).toBe(true);
    expect(find(slices, "domain", "small")?.fprGateEligible).toBe(false);
    expect(find(slices, "domain", "pos")?.recallGateEligible).toBe(true);
    expect(find(slices, "domain", "posSmall")?.recallGateEligible).toBe(false);
  });

  it("counts >=50% mixed records as slice positives", () => {
    const items = [
      item({ author: "m1", label: "mixed", aiFraction: 0.6, warned: true }),
      item({ author: "m2", label: "mixed", aiFraction: 0.8, warned: false }),
      item({ author: "m3", label: "mixed", aiFraction: 0.2, warned: false }),
    ];

    const slices = buildSlices(items, {
      bootstrapSeed: 7,
      heldOutGeneratorFamilies: [],
    });

    // Keys are `"<mode>/<bucket>"`, the SAME format as
    // `MixedFractionSegment.key`: the cohort is part of the slice identity, so a
    // published slice never pools the two.
    // The 50-74% mixed counts as a warning positive.
    const halfAi = find(slices, "mixedFraction", "mechanistic/50_74");
    expect(halfAi?.sampleSize).toBe(1);
    expect(halfAi?.positives).toBe(1);
    // The >=75% mixed lands in its own bucket and still counts as a positive.
    const dominant = find(slices, "mixedFraction", "mechanistic/75_100");
    expect(dominant?.positives).toBe(1);
    // The <50% mixed is neither a positive nor a human negative.
    const weakAi = find(slices, "mixedFraction", "mechanistic/0_24");
    expect(weakAi?.positives).toBe(0);
    expect(weakAi?.negatives).toBe(0);
  });

  // `mixedFraction` is a RECALL axis (RECALL_AXES), so this slice reaches
  // `criticalRecallSlices` in the published profile and the recall floor that
  // declares a slice gate-eligible. A bare fraction key would put a mechanistic
  // and an ecological row of the same band in ONE published slice — the
  // aggregation the frozen table forbids (`cohortsAggregated: false`) — and it
  // would do it silently, because the pooled slice still looks well-formed while
  // its `sampleSize` counts rows its recall never measured (an ecological row is
  // a warning positive of nothing).
  it("never pools the mechanistic and ecological cohorts into one slice", () => {
    const items = [
      item({
        author: "m1",
        label: "mixed",
        aiFraction: 0.8,
        generationMode: "mechanistic",
        warned: true,
      }),
      item({
        author: "e1",
        label: "mixed",
        aiFraction: 0.8,
        generationMode: "ecological",
        warned: true,
      }),
    ];

    const slices = buildSlices(items, {
      bootstrapSeed: 7,
      heldOutGeneratorFamilies: [],
    });
    const mixedKeys = slices
      .filter((slice) => slice.axis === "mixedFraction")
      .map((slice) => slice.key);

    expect(mixedKeys).toEqual(["ecological/75_100", "mechanistic/75_100"]);
    expect(
      find(slices, "mixedFraction", "mechanistic/75_100")?.sampleSize,
    ).toBe(1);
    expect(find(slices, "mixedFraction", "ecological/75_100")?.sampleSize).toBe(
      1,
    );
    // Only the mechanistic cohort supplies a warning positive; the ecological row
    // is a positive of nothing, so its slice declares zero and can never become
    // recall-gate-eligible on borrowed rows.
    expect(find(slices, "mixedFraction", "mechanistic/75_100")?.positives).toBe(
      1,
    );
    expect(find(slices, "mixedFraction", "ecological/75_100")?.positives).toBe(
      0,
    );
  });

  it("is deterministic for a fixed bootstrap seed", () => {
    const items = [
      item({ author: "a", label: "human" }),
      item({ author: "a", label: "ai" }),
      item({ author: "b", label: "human" }),
      item({ author: "b", label: "ai" }),
    ];
    const options = { bootstrapSeed: 99, heldOutGeneratorFamilies: [] };
    expect(buildSlices(items, options)).toEqual(buildSlices(items, options));
  });

  it("orders slice keys by unicode codepoint, never host locale collation", () => {
    const items = [
      item({ author: "a1", label: "human", domain: "alpha" }),
      item({ author: "a2", label: "human", domain: "alpha" }),
      item({ author: "b1", label: "human", domain: "Beta" }),
      item({ author: "b2", label: "ai", domain: "Beta" }),
    ];
    const slices = buildSlices(items, {
      bootstrapSeed: 7,
      heldOutGeneratorFamilies: [],
    });
    const domainKeys = slices
      .filter((slice) => slice.axis === "domain")
      .map((slice) => slice.key);
    // Codepoint order puts uppercase "Beta" (U+0042) before lowercase "alpha"
    // (U+0061); a locale collation would instead yield ["alpha","Beta"]. Slice
    // key order flows into the gate array order and reportDigest, so it must be
    // locale-independent — matching benchmark/split-audit.ts's codepoint sort.
    expect(domainKeys).toEqual(["Beta", "alpha"]);
  });
});

// --- summarizeSlices (pure over hand-built slice results) -----------------

function estimate(value: number) {
  return {
    value,
    lower95: value,
    upper95: value,
    method: "wilson-one-sided" as const,
  };
}

function decision(fpr: number, recall: number): DecisionMetrics {
  return {
    family: "end-to-end",
    positivePopulation: "warning-positives",
    sampleSize: 1,
    positives: 1,
    negatives: 1,
    truePositives: 1,
    falsePositives: 0,
    trueNegatives: 1,
    falseNegatives: 0,
    undecidedPositives: 0,
    undecidedNegatives: 0,
    falsePositiveRate: estimate(fpr),
    clearanceRate: estimate(1),
    recall: estimate(recall),
    precision: estimate(1),
  };
}

// summarizeSlices reads the end-to-end family; nothing errored in these
// hand-built slices, so the conditional copy is the same matrix.
function families(metrics: DecisionMetrics): DecisionFamilies {
  return {
    endToEnd: metrics,
    conditionalOnScored: { ...metrics, family: "conditional-on-scored" },
  };
}

function metrics(
  warningFpr: number,
  warningRecall: number,
  visual: { fpr: number; recall: number } | null,
): EvaluationMetrics {
  return {
    warning: families(decision(warningFpr, warningRecall)),
    visualAction:
      visual === null ? null : families(decision(visual.fpr, visual.recall)),
  } as unknown as EvaluationMetrics;
}

function slice(
  key: string,
  fprGateEligible: boolean,
  recallGateEligible: boolean,
  warningFpr: number,
  warningRecall: number,
  visual: { fpr: number; recall: number } | null,
): SliceResult {
  return {
    axis: "domain",
    key,
    sampleSize: 2,
    positives: 1,
    negatives: 1,
    fprGateEligible,
    recallGateEligible,
    metrics: metrics(warningFpr, warningRecall, visual),
  };
}

describe("summarizeSlices", () => {
  const slices: SliceResult[] = [
    slice("s1", true, false, 0.03, 0.7, { fpr: 0.01, recall: 0.4 }),
    slice("s2", true, true, 0.05, 0.6, { fpr: 0.015, recall: 0.35 }),
    // Highest FPR by far, but under-powered for the FPR gate: must not become
    // the reported worst slice.
    slice("s3", false, true, 0.9, 0.5, null),
  ];

  it("macro-averages the four operating rates across all slices", () => {
    const summary = summarizeSlices(slices);
    expect(summary.macro.warningFpr).toBeCloseTo((0.03 + 0.05 + 0.9) / 3, 10);
    expect(summary.macro.warningRecall).toBeCloseTo((0.7 + 0.6 + 0.5) / 3, 10);
    expect(summary.macro.actionFpr).toBeCloseTo((0.01 + 0.015) / 2, 10);
    expect(summary.macro.actionRecall).toBeCloseTo((0.4 + 0.35) / 2, 10);
  });

  it("reports the worst slice only among gate-eligible slices", () => {
    const summary = summarizeSlices(slices);
    // s3 has the highest FPR (0.9) but is not FPR-gate-eligible, so s2 wins.
    expect(summary.worst.warningFpr?.key).toBe("s2");
    // Lowest recall among recall-gate-eligible slices {s2, s3} is s3.
    expect(summary.worst.warningRecall?.key).toBe("s3");
    expect(summary.worst.actionFpr?.key).toBe("s2");
    // s3 has no visual block, so the only eligible visual recall is s2.
    expect(summary.worst.actionRecall?.key).toBe("s2");
  });
});
