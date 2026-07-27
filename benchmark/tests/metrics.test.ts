import { describe, expect, it } from "vitest";

import {
  brierScore,
  computeBinaryMetrics,
  computeEvaluationMetrics,
  computeSegmentedMetrics,
  ece15,
  simulatedPrecision,
  sizeBucket,
  type EvaluationItem,
  type EvaluationOptions,
  type Prediction,
} from "../metrics.ts";
import type { BenchmarkRecord } from "../schema.ts";

function prediction(label: Prediction["label"], score: number): Prediction {
  return { label, score };
}

// --- v2 evaluation fixtures -----------------------------------------------

interface RecordFields {
  author: string;
  label: "human" | "ai" | "mixed";
  wordCount?: number;
  language?: string;
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
}

function record(fields: RecordFields): BenchmarkRecord {
  const base: Record<string, unknown> = {
    label: fields.label,
    language: fields.language ?? "pt-BR",
    wordCount: fields.wordCount ?? 120,
    domain: fields.domain ?? "corporate",
    platform: fields.platform ?? "generic-platform",
    provenance: { sourceId: fields.sourceId ?? "corpus-generic" },
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
  status?: "scored" | "abstained" | "error";
  latencyMs?: number;
  memoryBytes?: number;
}

// The fixture mirrors the discriminated union: only a `scored` row has a score
// and a decision. A fixture that tries to give an abstained or errored row a
// score fails loudly instead of quietly reproducing the `?? 0` defect.
function item(fields: ItemFields): EvaluationItem {
  const status = fields.status ?? "scored";
  const telemetry: { latencyMs?: number; memoryBytes?: number } = {};
  if (fields.latencyMs !== undefined) telemetry.latencyMs = fields.latencyMs;
  if (fields.memoryBytes !== undefined) {
    telemetry.memoryBytes = fields.memoryBytes;
  }
  if (status !== "scored") {
    if (fields.documentScore !== undefined || fields.warned !== undefined) {
      throw new Error(
        `a ${status} fixture row carries no score and no decision`,
      );
    }
    return { record: record(fields), status, ...telemetry };
  }
  if (fields.documentScore === undefined) {
    throw new Error("a scored fixture row needs a documentScore");
  }
  return {
    record: record(fields),
    status: "scored",
    documentScore: fields.documentScore,
    warned: fields.warned ?? false,
    visualActioned: fields.visualActioned ?? false,
    ...telemetry,
  };
}

const OPTIONS: EvaluationOptions = { bootstrapSeed: 20260719 };

// Forty authors, each contributing one human negative (score 0.1) and one AI
// positive (score 0.9): a perfectly separable, both-classes-per-cluster fixture
// so the author-clustered bootstrap always produces a finite statistic.
const SEPARABLE = Array.from({ length: 40 }, (_, index) => {
  const author = `a${index}`;
  return [
    item({
      author,
      label: "human",
      documentScore: 0.1,
      warned: false,
      latencyMs: 10,
      memoryBytes: 1_000,
    }),
    item({
      author,
      label: "ai",
      documentScore: 0.9,
      warned: true,
      visualActioned: true,
      generatorFamily: "gpt",
      latencyMs: 30,
      memoryBytes: 3_000,
    }),
  ];
}).flat();

describe("calibration metrics", () => {
  it("uses fifteen equal-width bins", () => {
    expect(
      ece15([
        { probability: 0.01, label: 0 },
        { probability: 0.99, label: 1 },
      ]),
    ).toBeCloseTo(0.01);
  });

  it("computes Brier and base-rate precision", () => {
    expect(
      brierScore([
        { probability: 0.2, label: 0 },
        { probability: 0.8, label: 1 },
      ]),
    ).toBeCloseTo(0.04);
    expect(
      simulatedPrecision({
        truePositiveRate: 0.8,
        falsePositiveRate: 0.05,
        prevalence: 0.01,
      }),
    ).toBeCloseTo(0.1391, 3);
  });

  it("places the fifteen ECE bins on the [0,1] grid, not on the data range", () => {
    // All four probabilities land in distinct equal-width bins; a naive
    // data-range binning would collapse them and change the answer.
    const points = [
      { probability: 0.02, label: 0 as const },
      { probability: 0.34, label: 0 as const },
      { probability: 0.67, label: 1 as const },
      { probability: 0.98, label: 1 as const },
    ];
    // bin0 |0.02-0|, bin5 |0.34-0|, bin10 |0.67-1|, bin14 |0.98-1|, each n/n=1/4.
    const expected = (0.02 + 0.34 + 0.33 + 0.02) / 4;
    expect(ece15(points)).toBeCloseTo(expected, 10);
  });

  it("simulates precision at prevalences 1%, 5% and 10%", () => {
    const at = (prevalence: number): number =>
      simulatedPrecision({
        truePositiveRate: 0.6,
        falsePositiveRate: 0.02,
        prevalence,
      });
    expect(at(0.01)).toBeCloseTo((0.01 * 0.6) / (0.01 * 0.6 + 0.99 * 0.02), 10);
    expect(at(0.05)).toBeCloseTo((0.05 * 0.6) / (0.05 * 0.6 + 0.95 * 0.02), 10);
    expect(at(0.1)).toBeCloseTo((0.1 * 0.6) / (0.1 * 0.6 + 0.9 * 0.02), 10);
  });
});

describe("computeEvaluationMetrics", () => {
  it("reports mixed records by AI fraction instead of counting them as human", () => {
    const mixedFixture = [
      item({ author: "h1", label: "human", documentScore: 0.1, warned: false }),
      item({ author: "h2", label: "human", documentScore: 0.2, warned: false }),
      item({ author: "a1", label: "ai", documentScore: 0.95, warned: true }),
      item({
        author: "m1",
        label: "mixed",
        aiFraction: 0.6,
        documentScore: 0.8,
        warned: true,
      }),
      item({
        author: "m2",
        label: "mixed",
        aiFraction: 0.55,
        documentScore: 0.4,
        warned: false,
      }),
      item({
        author: "m3",
        label: "mixed",
        aiFraction: 0.2,
        documentScore: 0.3,
        warned: false,
      }),
    ];

    const metrics = computeEvaluationMetrics(mixedFixture, OPTIONS);

    // Mixed records never inflate the human negative count.
    expect(metrics.warning.endToEnd.negatives).toBe(
      mixedFixture.filter((entry) => entry.record.label === "human").length,
    );
    expect(metrics.warning.endToEnd.negatives).toBe(2);
    // The two >=50% AI mixed records participate in the warning-recall gate.
    expect(metrics.mixed.atLeastHalfAi.sampleSize).toBe(2);
    expect(metrics.mixed.atLeastHalfAi.warningRecall).toBe(0.5);
    expect(metrics.mixed.atLeastHalfAi.warningRecallLower95).toBeLessThan(0.5);
  });

  it("counts AI plus >=50% mixed as warning positives", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    expect(metrics.warning.endToEnd.positives).toBe(40);
    expect(metrics.warning.endToEnd.negatives).toBe(40);
    expect(metrics.warning.endToEnd.truePositives).toBe(40);
    expect(metrics.warning.endToEnd.falsePositives).toBe(0);
    expect(metrics.warning.endToEnd.recall.value).toBe(1);
    expect(metrics.warning.endToEnd.falsePositiveRate.value).toBe(0);
  });

  it("puts a Wilson one-sided interval on every proportion", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    expect(metrics.warning.endToEnd.falsePositiveRate.method).toBe(
      "wilson-one-sided",
    );
    expect(metrics.warning.endToEnd.recall.method).toBe("wilson-one-sided");
    expect(metrics.warning.endToEnd.recall.lower95).toBeGreaterThan(0.9);
    expect(metrics.warning.endToEnd.recall.lower95).toBeLessThanOrEqual(1);
    expect(metrics.warning.endToEnd.falsePositiveRate.upper95).toBeGreaterThan(
      0,
    );
    expect(metrics.coverage.value).toBe(1);
    expect(metrics.coverage.method).toBe("wilson-one-sided");
  });

  it("bootstraps ROC-AUC, PR-AUC, Brier and ECE by author cluster", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    for (const estimate of [
      metrics.rocAuc,
      metrics.prAuc,
      metrics.brier,
      metrics.ece15,
    ]) {
      expect(estimate.method).toBe("author-cluster-percentile");
      expect(estimate.lower95).toBeLessThanOrEqual(estimate.value);
      expect(estimate.upper95).toBeGreaterThanOrEqual(estimate.value);
    }
    expect(metrics.rocAuc.value).toBeCloseTo(1, 10);
    expect(metrics.prAuc.value).toBeCloseTo(1, 10);
    expect(metrics.brier.value).toBeCloseTo(0.01, 10);
    // bin1 |0.1-0| and bin13 |0.9-1|, each weight 40/80.
    expect(metrics.ece15.value).toBeCloseTo(0.1, 10);
  });

  it("derives simulated precision from the observed warning operating point", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    // FPR is 0 here, so precision is 1 at every prevalence.
    expect(metrics.simulatedPrecision.prevalence01).toBeCloseTo(1, 10);
    expect(metrics.simulatedPrecision.prevalence05).toBeCloseTo(1, 10);
    expect(metrics.simulatedPrecision.prevalence10).toBeCloseTo(1, 10);
  });

  it("separates coverage, abstention and error over the eligible set", () => {
    const items = [
      item({ author: "e1", label: "human", documentScore: 0.1, warned: false }),
      item({ author: "e2", label: "ai", documentScore: 0.9, warned: true }),
      item({ author: "e3", label: "human", status: "abstained" }),
      item({ author: "e4", label: "ai", status: "error" }),
      // Ineligible: under 50 words, excluded from the coverage denominator.
      item({
        author: "e5",
        label: "human",
        wordCount: 30,
        documentScore: 0.1,
        warned: false,
      }),
      // Ineligible: not PT-BR.
      item({
        author: "e6",
        label: "human",
        language: "en-US",
        documentScore: 0.1,
        warned: false,
      }),
    ];

    const metrics = computeEvaluationMetrics(items, OPTIONS);
    expect(metrics.coverage.value).toBeCloseTo(0.5, 10);
    expect(metrics.abstentionRate.value).toBeCloseTo(0.25, 10);
    expect(metrics.errorRate.value).toBeCloseTo(0.25, 10);
  });

  it("aggregates only present latency and memory samples", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    expect(metrics.latency.sampleSize).toBe(80);
    expect(metrics.latency.maxMs).toBe(30);
    expect(metrics.memory.sampleSize).toBe(80);
    expect(metrics.memory.maxBytes).toBe(3_000);
  });

  it("reports a null visual-action block when no visual threshold was frozen", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, {
      ...OPTIONS,
      visualActionAvailable: false,
    });
    expect(metrics.visualAction).toBeNull();
  });

  it("is deterministic for a fixed bootstrap seed", () => {
    const first = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    const second = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    expect(first).toEqual(second);
  });
});

// --- R5: an inference error never becomes a score -------------------------

// Four eligible human negatives — two correctly cleared, one wrongly warned and
// one whose inference ERRORED — plus three eligible AI positives: one warned,
// one missed and one whose inference errored.
function familiesFixture(): EvaluationItem[] {
  return [
    item({ author: "h1", label: "human", documentScore: 0.1, warned: false }),
    item({ author: "h2", label: "human", documentScore: 0.2, warned: false }),
    item({ author: "h3", label: "human", documentScore: 0.9, warned: true }),
    item({ author: "h4", label: "human", status: "error" }),
    item({ author: "a1", label: "ai", documentScore: 0.9, warned: true }),
    item({ author: "a2", label: "ai", documentScore: 0.3, warned: false }),
    item({ author: "a3", label: "ai", status: "error" }),
  ];
}

describe("metric families (R5)", () => {
  it("publishes the pair with both roles named in the artifact", () => {
    const metrics = computeEvaluationMetrics(familiesFixture(), OPTIONS);
    expect(metrics.warning.endToEnd.family).toBe("end-to-end");
    expect(metrics.warning.conditionalOnScored.family).toBe(
      "conditional-on-scored",
    );
  });

  it("differs between the two families when a row errored", () => {
    const metrics = computeEvaluationMetrics(familiesFixture(), OPTIONS);
    const endToEnd = metrics.warning.endToEnd;
    const conditional = metrics.warning.conditionalOnScored;

    // End-to-end: every eligible row is in the denominator and an errored row is
    // a non-detection — for a positive a false negative, for a negative neither
    // a false positive nor a true negative, but an explicitly undecided cell.
    expect(endToEnd.positives).toBe(3);
    expect(endToEnd.truePositives).toBe(1);
    expect(endToEnd.falseNegatives).toBe(2);
    expect(endToEnd.undecidedPositives).toBe(1);
    expect(endToEnd.negatives).toBe(4);
    expect(endToEnd.falsePositives).toBe(1);
    expect(endToEnd.trueNegatives).toBe(2);
    expect(endToEnd.undecidedNegatives).toBe(1);
    expect(endToEnd.recall.value).toBeCloseTo(1 / 3, 10);
    expect(endToEnd.clearanceRate.value).toBeCloseTo(0.5, 10);

    // Conditional: only the rows that actually produced a score.
    expect(conditional.positives).toBe(2);
    expect(conditional.truePositives).toBe(1);
    expect(conditional.falseNegatives).toBe(1);
    expect(conditional.undecidedPositives).toBe(0);
    expect(conditional.negatives).toBe(3);
    expect(conditional.undecidedNegatives).toBe(0);
    expect(conditional.recall.value).toBeCloseTo(0.5, 10);
    expect(conditional.clearanceRate.value).toBeCloseTo(2 / 3, 10);

    expect(endToEnd.recall.value).not.toBe(conditional.recall.value);
    expect(endToEnd.clearanceRate.value).not.toBe(
      conditional.clearanceRate.value,
    );
  });

  it("never counts an errored human record as a true negative", () => {
    const metrics = computeEvaluationMetrics(familiesFixture(), OPTIONS);
    // The old `?? 0` turned the errored row into the most human score possible
    // and parked it in trueNegatives, so FPR read 1/4. Three negatives got a
    // decision and one of them was wrongly warned: the honest rate is 1/3.
    expect(metrics.warning.endToEnd.trueNegatives).toBe(2);
    expect(metrics.warning.endToEnd.falsePositiveRate.value).toBeCloseTo(
      1 / 3,
      10,
    );
    // The accusation rate is measured over the negatives that got a decision in
    // BOTH families: an undecided row can never dilute it downward either.
    expect(
      metrics.warning.conditionalOnScored.falsePositiveRate.value,
    ).toBeCloseTo(1 / 3, 10);
  });

  it("coincides between the two families when nothing errored", () => {
    const withoutErrors = familiesFixture().filter(
      (entry) => entry.status !== "error",
    );
    const metrics = computeEvaluationMetrics(withoutErrors, OPTIONS);
    const { family: endFamily, ...endToEnd } = metrics.warning.endToEnd;
    const { family: conditionalFamily, ...conditional } =
      metrics.warning.conditionalOnScored;
    expect(endFamily).toBe("end-to-end");
    expect(conditionalFamily).toBe("conditional-on-scored");
    expect(endToEnd).toEqual(conditional);
  });

  it("reports coverage and error rate by source, class, length bucket and platform", () => {
    const items = [
      item({
        author: "w1",
        label: "human",
        sourceId: "ptwiki",
        platform: "wikipedia",
        wordCount: 60,
        documentScore: 0.1,
        warned: false,
      }),
      item({
        author: "w2",
        label: "human",
        sourceId: "ptwiki",
        platform: "wikipedia",
        wordCount: 60,
        status: "error",
      }),
      item({
        author: "g1",
        label: "ai",
        sourceId: "controlled-generation",
        platform: "linkedin",
        wordCount: 250,
        documentScore: 0.9,
        warned: true,
      }),
      item({
        author: "g2",
        label: "ai",
        sourceId: "controlled-generation",
        platform: "linkedin",
        wordCount: 250,
        status: "abstained",
      }),
    ];

    const resolution = computeEvaluationMetrics(items, OPTIONS).resolution;

    const wiki = resolution.bySource.find((row) => row.key === "ptwiki");
    expect(wiki?.eligible).toBe(2);
    expect(wiki?.scored).toBe(1);
    expect(wiki?.errored).toBe(1);
    expect(wiki?.coverage.value).toBeCloseTo(0.5, 10);
    expect(wiki?.errorRate.value).toBeCloseTo(0.5, 10);

    const generated = resolution.bySource.find(
      (row) => row.key === "controlled-generation",
    );
    expect(generated?.abstained).toBe(1);
    expect(generated?.errored).toBe(0);
    expect(generated?.errorRate.value).toBe(0);
    expect(generated?.abstentionRate.value).toBeCloseTo(0.5, 10);

    expect(resolution.byClass.map((row) => row.key)).toEqual(["ai", "human"]);
    expect(
      resolution.byClass.find((row) => row.key === "human")?.errorRate.value,
    ).toBeCloseTo(0.5, 10);

    expect(resolution.byLengthBucket.map((row) => row.key)).toEqual([
      "150_299",
      "50_79",
    ]);
    expect(
      resolution.byLengthBucket.find((row) => row.key === "50_79")?.errored,
    ).toBe(1);

    expect(resolution.byPlatform.map((row) => row.key)).toEqual([
      "linkedin",
      "wikipedia",
    ]);
    expect(
      resolution.byPlatform.find((row) => row.key === "wikipedia")?.coverage
        .value,
    ).toBeCloseTo(0.5, 10);
  });
});

// --- legacy binary metrics (MVP CLI report path) --------------------------

describe("computeBinaryMetrics", () => {
  it("computes precision among blocked as the primary metric", () => {
    const metrics = computeBinaryMetrics(
      [
        prediction("ai", 0.99),
        prediction("human", 0.98),
        prediction("ai", 0.2),
        prediction("human", 0.1),
      ],
      { blockThreshold: 0.92 },
    );

    expect(metrics.precisionAmongBlocked).toBe(0.5);
    expect(metrics.truePositives).toBe(1);
    expect(metrics.falsePositives).toBe(1);
  });

  it("scores perfect separation with ROC-AUC and PR-AUC of 1", () => {
    const metrics = computeBinaryMetrics(
      [
        prediction("ai", 0.9),
        prediction("ai", 0.8),
        prediction("human", 0.4),
        prediction("human", 0.3),
      ],
      { blockThreshold: 0.5 },
    );

    expect(metrics.rocAuc).toBe(1);
    expect(metrics.prAuc).toBe(1);
  });
});

describe("sizeBucket", () => {
  it.each([
    [10, "0_49"],
    [50, "50_79"],
    [79, "50_79"],
    [80, "80_99"],
    [100, "100_149"],
    [150, "150_299"],
    [299, "150_299"],
    [300, "300_PLUS"],
  ] as const)("maps %i words to %s", (words, bucket) => {
    expect(sizeBucket(words)).toBe(bucket);
  });
});

describe("computeSegmentedMetrics", () => {
  it("reports metrics per segment and always includes the sample size", () => {
    const items = [
      { language: "pt", label: "ai" as const, score: 0.95 },
      { language: "pt", label: "human" as const, score: 0.1 },
      { language: "en", label: "ai" as const, score: 0.99 },
    ];

    const segments = computeSegmentedMetrics(
      items,
      (entry) => ({ label: entry.label, score: entry.score }),
      (entry) => entry.language,
      { blockThreshold: 0.9 },
    );

    const pt = segments.find((segment) => segment.key === "pt");
    expect(pt?.metrics.sampleSize).toBe(2);
  });
});
