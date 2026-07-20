import { describe, expect, it } from "vitest";

import type {
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

interface RecordFields {
  author: string;
  label: "human" | "ai" | "mixed";
  wordCount?: number;
  aiFraction?: number;
  domain?: string;
  humanSourceType?: string;
  hardNegativeFamily?: string;
  transformationKind?: string;
  severity?: string;
  generatorFamily?: string;
  createdAt?: number;
}

function record(fields: RecordFields): BenchmarkRecord {
  const base: Record<string, unknown> = {
    label: fields.label,
    language: "pt-BR",
    wordCount: fields.wordCount ?? 120,
    domain: fields.domain ?? "corporate",
    createdAt: fields.createdAt ?? 1_000,
    transformation: {
      kind: fields.transformationKind ?? "none",
      severity: fields.severity ?? "none",
    },
    groups: { author: fields.author },
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
    };
  }
  if (fields.generatorFamily !== undefined) {
    base.generation = { family: fields.generatorFamily };
  }
  return base as unknown as BenchmarkRecord;
}

interface ItemFields extends RecordFields {
  documentScore?: number;
  warned?: boolean;
  visualActioned?: boolean;
}

function item(fields: ItemFields): EvaluationItem {
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

const SEED = { bootstrapSeed: 424242, heldOutGeneratorFamilies: ["gpt"] };

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

    // The 50-74% mixed counts as a warning positive.
    const halfAi = find(slices, "mixedFraction", "50_74");
    expect(halfAi?.sampleSize).toBe(1);
    expect(halfAi?.positives).toBe(1);
    // The >=75% mixed lands in its own bucket and still counts as a positive.
    const dominant = find(slices, "mixedFraction", "75_100");
    expect(dominant?.positives).toBe(1);
    // The <50% mixed is neither a positive nor a human negative.
    const weakAi = find(slices, "mixedFraction", "0_24");
    expect(weakAi?.positives).toBe(0);
    expect(weakAi?.negatives).toBe(0);
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
    sampleSize: 1,
    positives: 1,
    negatives: 1,
    truePositives: 1,
    falsePositives: 0,
    trueNegatives: 1,
    falseNegatives: 0,
    falsePositiveRate: estimate(fpr),
    recall: estimate(recall),
    precision: estimate(1),
  };
}

function metrics(
  warningFpr: number,
  warningRecall: number,
  visual: { fpr: number; recall: number } | null,
): EvaluationMetrics {
  return {
    warning: decision(warningFpr, warningRecall),
    visualAction: visual === null ? null : decision(visual.fpr, visual.recall),
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
