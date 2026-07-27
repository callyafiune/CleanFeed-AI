import { describe, expect, it } from "vitest";

import {
  brierScore,
  calibrationInterceptSlope,
  computeBinaryMetrics,
  computeEvaluationMetrics,
  computeSegmentedMetrics,
  ece15,
  eceEqualMass,
  logLoss,
  predictiveValues,
  reliabilityDiagram,
  simulatedPrecision,
  sizeBucket,
  type CalibrationPoint,
  type EvaluationItem,
  type EvaluationOptions,
  type Prediction,
} from "../metrics.ts";
import { REBUILD_V3_POLICY } from "../rebuild-v3-policy.ts";
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
  // Only C1 adds `labelBasis` to the closed schema, so the fixture writes it as
  // an extra field: A6 must read it tolerantly today and must not invent it.
  labelBasis?: string;
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
  if (fields.labelBasis !== undefined) base.labelBasis = fields.labelBasis;
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
    // All three fields the `scored` branch owns, so "no score and no decision"
    // is enforced in full: `visualActioned` is a decision too, and leaving it
    // out let an unscored row declare a visual action that was then discarded.
    if (
      fields.documentScore !== undefined ||
      fields.warned !== undefined ||
      fields.visualActioned !== undefined
    ) {
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

  it("keeps the mixed gate population over every mixed row, eligible or not", () => {
    // R3 pin. The two DECISION families are restricted to the eligible set;
    // `metrics.mixed` is a separate gated block and its population is NOT ours
    // to shrink. Restricting it to eligible rows would move a gated number in
    // the favorable direction (an ineligible mixed row that got no decision
    // would leave the denominator instead of counting as a miss) and, at
    // sampleSize 0, gates.ts turns the mixed-recall gate into an unconditional
    // pass. So the row below stays in, and stays a miss.
    const fixture = [
      item({
        author: "m1",
        label: "mixed",
        aiFraction: 0.9,
        wordCount: 120,
        documentScore: 0.8,
        warned: true,
      }),
      item({
        author: "m2",
        label: "mixed",
        aiFraction: 0.9,
        wordCount: 30,
        status: "abstained",
      }),
    ];

    const metrics = computeEvaluationMetrics(fixture, OPTIONS);

    expect(metrics.mixed.atLeastHalfAi.sampleSize).toBe(2);
    expect(metrics.mixed.atLeastHalfAi.warningRecall).toBe(0.5);
    const bucket = metrics.mixed.byFraction.find(
      (segment) => segment.key === "75_100",
    );
    expect(bucket?.sampleSize).toBe(2);
    expect(bucket?.warning.positives).toBe(2);
    expect(bucket?.warning.truePositives).toBe(1);
    expect(bucket?.warning.falseNegatives).toBe(1);
    // The eligible restriction still governs the decision families, so the two
    // populations are deliberately different sizes.
    expect(metrics.warning.endToEnd.positives).toBe(1);
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

  it("bootstraps AUROC, PR-AUC, Brier and both ECEs by author cluster", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    for (const estimate of [
      metrics.separability.auroc,
      metrics.separability.prAuc,
      metrics.calibration.brier,
      metrics.calibration.eceEqualMass15,
      metrics.ece15,
    ]) {
      expect(estimate.method).toBe("author-cluster-percentile");
      expect(estimate.lower95).toBeLessThanOrEqual(estimate.value);
      expect(estimate.upper95).toBeGreaterThanOrEqual(estimate.value);
    }
    expect(metrics.separability.auroc.value).toBeCloseTo(1, 10);
    expect(metrics.separability.prAuc.value).toBeCloseTo(1, 10);
    expect(metrics.calibration.brier.value).toBeCloseTo(0.01, 10);
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

// --- A6: named roles, calibration, label bases, PPV/NPV, multiplicity ------

function points(
  probability: number,
  positives: number,
  total: number,
): CalibrationPoint[] {
  return Array.from({ length: total }, (_, index) => ({
    probability,
    label: index < positives ? (1 as const) : (0 as const),
  }));
}

describe("equal-mass calibration statistics", () => {
  it("bins by mass, not by a fixed grid the data never populates", () => {
    // Three probabilities crowded near zero and one far away. With TWO
    // equal-mass bins each holds two points: {0.01, 0.02} (meanP 0.015, rate 0)
    // and {0.03, 0.9} (meanP 0.465, rate 1).
    const skewed: CalibrationPoint[] = [
      { probability: 0.01, label: 0 },
      { probability: 0.02, label: 0 },
      { probability: 0.03, label: 1 },
      { probability: 0.9, label: 1 },
    ];
    expect(eceEqualMass(skewed, 2)).toBeCloseTo(
      0.5 * 0.015 + 0.5 * 0.535,
      10,
    );
    // The equal-width answer over the same points is a different number: it
    // pools the three low scores into one bin. That difference is the reason the
    // gate moves to equal-mass.
    expect(eceEqualMass(skewed, 2)).not.toBeCloseTo(0.26, 10);
  });

  it("keeps every point in exactly one bin when the count is not a multiple of the bins", () => {
    const five: CalibrationPoint[] = [
      { probability: 0.1, label: 0 },
      { probability: 0.2, label: 0 },
      { probability: 0.3, label: 1 },
      { probability: 0.4, label: 0 },
      { probability: 0.5, label: 1 },
    ];
    const diagram = reliabilityDiagram(five, 2);
    expect(diagram.reduce((total, bin) => total + bin.count, 0)).toBe(5);
    expect(diagram).toHaveLength(2);
    expect(diagram[0].lowestProbability).toBeCloseTo(0.1, 10);
    expect(diagram[1].highestProbability).toBeCloseTo(0.5, 10);
    expect(Number.isFinite(eceEqualMass(five, 2))).toBe(true);
  });

  it("reports log loss with a declared clamp instead of an infinity", () => {
    expect(
      logLoss([
        { probability: 0.5, label: 1 },
        { probability: 0.5, label: 0 },
      ]),
    ).toBeCloseTo(Math.log(2), 10);
    // A confident miss is finite: the probability is clamped, never 0 or 1.
    const confidentMiss = logLoss([{ probability: 1, label: 0 }]);
    expect(Number.isFinite(confidentMiss)).toBe(true);
    expect(confidentMiss).toBeGreaterThan(20);
  });

  it("fits a calibration intercept and slope on the logit scale", () => {
    // Two design points whose observed rates equal their probabilities: the
    // maximum-likelihood fit reproduces them exactly, so the line is the
    // identity (intercept 0, slope 1).
    const calibrated = [...points(0.2, 20, 100), ...points(0.8, 80, 100)];
    const identity = calibrationInterceptSlope(calibrated);
    expect(identity.intercept).toBeCloseTo(0, 6);
    expect(identity.slope).toBeCloseTo(1, 6);

    // Same observed rates, far more extreme probabilities: overconfidence shows
    // up as a slope well below one.
    const overconfident = [...points(0.02, 20, 100), ...points(0.98, 80, 100)];
    const shrunk = calibrationInterceptSlope(overconfident);
    expect(shrunk.slope).toBeGreaterThan(0);
    expect(shrunk.slope).toBeLessThan(0.5);
  });

  it("has no slope to report when the scores carry no spread", () => {
    const flat = points(0.5, 50, 100);
    const fit = calibrationInterceptSlope(flat);
    expect(Number.isNaN(fit.slope)).toBe(true);
    expect(Number.isNaN(fit.intercept)).toBe(true);
  });
});

describe("predictive values at plausible prevalences", () => {
  it("reports PPV and NPV, not precision alone", () => {
    const projected = predictiveValues({
      truePositiveRate: 0.8,
      falsePositiveRate: 0.05,
      prevalence: 0.01,
    });
    expect(projected.ppv).toBeCloseTo(0.1391, 4);
    expect(projected.ppv).toBeCloseTo(
      simulatedPrecision({
        truePositiveRate: 0.8,
        falsePositiveRate: 0.05,
        prevalence: 0.01,
      }),
      12,
    );
    // NPV = (1-p)(1-FPR) / ((1-p)(1-FPR) + p(1-TPR)).
    expect(projected.npv).toBeCloseTo(
      (0.99 * 0.95) / (0.99 * 0.95 + 0.01 * 0.2),
      10,
    );
  });

  it("publishes the benchmark's own prevalence beside the projections", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    // The fixture is exactly 50/50, which is the whole point of publishing it:
    // a calibrated score under this prior is not a feed's posterior.
    expect(metrics.predictiveValue.benchmarkPrevalence).toBeCloseTo(0.5, 10);
    expect(
      metrics.predictiveValue.byPrevalence.map((row) => row.prevalence),
    ).toEqual([...REBUILD_V3_POLICY.predictiveValuePrevalences]);
    for (const row of metrics.predictiveValue.byPrevalence) {
      expect(row.ppv).toBeGreaterThan(0);
      expect(row.npv).toBeGreaterThan(0);
    }
  });
});

describe("named metric roles", () => {
  it("puts recall and FPR at the frozen threshold in the release block", () => {
    const metrics = computeEvaluationMetrics(familiesFixture(), OPTIONS);
    const release = metrics.release;
    expect(release.role).toBe("release");
    expect(release.warning.family).toBe("end-to-end");
    expect(release.warning.recall.value).toBe(
      metrics.warning.endToEnd.recall.value,
    );
    expect(release.warning.falsePositiveRate.value).toBe(
      metrics.warning.endToEnd.falsePositiveRate.value,
    );
  });

  it("keeps AUROC and TPR@1%FPR in the separability diagnostic, never in the release block", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    expect(metrics.separability.role).toBe("diagnostic");
    expect(metrics.separability.purpose).toBe("separability");
    expect(metrics.separability.gates).toBe(false);
    expect(metrics.separability.tprAtOnePercentFpr.targetFpr).toBe(0.01);
    expect(metrics.separability.tprAtOnePercentFpr.tpr).toBeCloseTo(1, 10);
    expect(metrics.separability.tprAtOnePercentFpr.achievedFpr).toBe(0);
    expect("tprAtOnePercentFpr" in metrics.release.warning).toBe(false);
    expect("auroc" in metrics.release.warning).toBe(false);
  });

  it("never publishes a conditional number without the error rate of the same population", () => {
    const metrics = computeEvaluationMetrics(familiesFixture(), OPTIONS);
    const conditional = metrics.release.warning.conditional;
    expect(conditional.family).toBe("conditional-on-scored");
    expect(conditional.selectiveFailureSensitive).toBe(true);
    expect(conditional.errorRate.value).toBe(metrics.errorRate.value);
    expect(conditional.errorRate.value).toBeGreaterThan(0);
    // The separability and calibration blocks are conditional too, so they carry
    // the same companion.
    expect(metrics.separability.errorRate.value).toBe(metrics.errorRate.value);
    expect(metrics.calibration.errorRate.value).toBe(metrics.errorRate.value);
    expect(metrics.calibration.population).toBe("conditional-on-scored");
  });

  it("breaks calibration down by length, source and linguistic stratum", () => {
    const items = [
      item({
        author: "s1",
        label: "human",
        wordCount: 60,
        sourceId: "ptwiki",
        humanSourceType: "encyclopedic",
        documentScore: 0.1,
      }),
      item({
        author: "s2",
        label: "human",
        wordCount: 250,
        sourceId: "b2w-reviews01",
        humanSourceType: "social-media",
        status: "error",
      }),
      item({
        author: "s3",
        label: "ai",
        wordCount: 250,
        sourceId: "controlled-generation",
        documentScore: 0.9,
        warned: true,
      }),
    ];
    const calibration = computeEvaluationMetrics(items, OPTIONS).calibration;

    expect(calibration.byLengthBucket.map((row) => row.key)).toEqual([
      "150_299",
      "50_79",
    ]);
    const long = calibration.byLengthBucket.find(
      (row) => row.key === "150_299",
    );
    // Two eligible rows in the bucket, one of them errored: the calibration
    // count is the SCORED one and the error rate sits beside it.
    expect(long?.count).toBe(1);
    expect(long?.samplingUnits).toBe(1);
    expect(long?.errorRate.value).toBeCloseTo(0.5, 10);

    expect(calibration.bySource.map((row) => row.key)).toEqual([
      "b2w-reviews01",
      "controlled-generation",
      "ptwiki",
    ]);
    expect(calibration.byLinguisticStratum.map((row) => row.key)).toEqual([
      "encyclopedic",
      "social-media",
      "unknown",
    ]);
  });
});

describe("human negative label bases", () => {
  it("keeps the count, the sampling units and the interval of each basis separate", () => {
    const items = [
      item({
        author: "d1",
        label: "human",
        labelBasis: "date-cutoff",
        documentScore: 0.1,
      }),
      item({
        author: "d1",
        label: "human",
        labelBasis: "date-cutoff",
        documentScore: 0.9,
        warned: true,
      }),
      item({
        author: "d2",
        label: "human",
        labelBasis: "date-cutoff",
        status: "error",
      }),
      item({
        author: "o1",
        label: "human",
        labelBasis: "observed-process",
        documentScore: 0.1,
      }),
      item({
        author: "o2",
        label: "human",
        labelBasis: "observed-process",
        documentScore: 0.2,
      }),
      item({ author: "a1", label: "ai", documentScore: 0.9, warned: true }),
    ];

    const labelBasis = computeEvaluationMetrics(items, OPTIONS).labelBasis;
    expect(labelBasis.fieldPresent).toBe(true);
    expect(labelBasis.pooledClaimAllowed).toBe(false);
    expect(labelBasis.bases.map((row) => row.basis)).toEqual([
      "date-cutoff",
      "observed-process",
    ]);

    const dateCutoff = labelBasis.bases[0];
    // Three human negatives under two authors, one of them errored.
    expect(dateCutoff.count).toBe(3);
    expect(dateCutoff.samplingUnits).toBe(2);
    expect(dateCutoff.samplingUnitAxis).toBe("groups.author");
    expect(dateCutoff.errored).toBe(1);
    expect(dateCutoff.falsePositiveRate.value).toBeCloseTo(0.5, 10);
    expect(dateCutoff.falsePositiveRate.upper95).toBeGreaterThan(0.5);
    expect(dateCutoff.errorRate.value).toBeCloseTo(1 / 3, 10);

    const observed = labelBasis.bases[1];
    expect(observed.count).toBe(2);
    expect(observed.samplingUnits).toBe(2);
    expect(observed.falsePositiveRate.value).toBe(0);
    // The two intervals are separate objects over separate denominators; the
    // pooled rate (1/5) appears nowhere as a basis-level claim.
    expect(observed.falsePositiveRate.upper95).not.toBe(
      dateCutoff.falsePositiveRate.upper95,
    );
  });

  it("marks an under-powered basis as supplementary diagnostic, and a powered one as gating", () => {
    const floor = REBUILD_V3_POLICY.powerFloors.criticalFprHumanNegatives;
    const powered = Array.from({ length: floor }, (_, index) =>
      item({
        author: `p${index}`,
        label: "human",
        labelBasis: "date-cutoff",
        documentScore: 0.1,
      }),
    );
    const sparse = Array.from({ length: 4 }, (_, index) =>
      item({
        author: `q${index}`,
        label: "human",
        labelBasis: "observed-process",
        documentScore: 0.1,
      }),
    );
    const bases = computeEvaluationMetrics([...powered, ...sparse], OPTIONS)
      .labelBasis.bases;

    const dateCutoff = bases.find((row) => row.basis === "date-cutoff");
    expect(dateCutoff?.count).toBe(floor);
    expect(dateCutoff?.powered).toBe(true);
    expect(dateCutoff?.evidenceRole).toBe("gating");

    const observed = bases.find((row) => row.basis === "observed-process");
    expect(observed?.count).toBe(4);
    expect(observed?.powered).toBe(false);
    expect(observed?.evidenceRole).toBe(
      REBUILD_V3_POLICY.labelBasis.underPoweredRole,
    );
    expect(observed?.powerFloor).toBe(floor);
  });

  it("never invents a basis for a record that has none", () => {
    const metrics = computeEvaluationMetrics(familiesFixture(), OPTIONS);
    expect(metrics.labelBasis.fieldPresent).toBe(false);
    expect(metrics.labelBasis.bases.map((row) => row.basis)).toEqual([
      "unknown",
    ]);
    // An unknown basis is never evidence for anything.
    expect(metrics.labelBasis.bases[0].evidenceRole).toBe(
      "supplementary-diagnostic",
    );
  });
});

describe("simultaneous (Bonferroni) bounds", () => {
  it("publishes none until the pre-registered gate count is declared", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    expect(metrics.multiplicity).toBeNull();
    expect(
      metrics.warning.endToEnd.falsePositiveRate.simultaneous,
    ).toBeUndefined();
  });

  it("widens every proportion at alpha_family / m", () => {
    const metrics = computeEvaluationMetrics(familiesFixture(), {
      ...OPTIONS,
      preRegisteredStatisticalGates: 8,
    });
    const declaration = metrics.multiplicity;
    expect(declaration).not.toBeNull();
    expect(declaration?.correction).toBe("bonferroni");
    expect(declaration?.familyAlpha).toBe(
      REBUILD_V3_POLICY.multiplicity.familyAlpha,
    );
    expect(declaration?.descriptiveConfidence).toBe(
      REBUILD_V3_POLICY.multiplicity.descriptiveConfidence,
    );
    expect(declaration?.m).toBe(8);
    expect(declaration?.perGateAlpha).toBeCloseTo(0.05 / 8, 12);

    const fpr = metrics.warning.endToEnd.falsePositiveRate;
    expect(fpr.simultaneous?.m).toBe(8);
    expect(fpr.simultaneous?.alpha).toBeCloseTo(0.05 / 8, 12);
    // Simultaneous coverage is strictly more conservative than the individual
    // 95% interval, in both directions.
    expect(fpr.simultaneous?.upper).toBeGreaterThan(fpr.upper95 as number);
    const recall = metrics.warning.endToEnd.recall;
    expect(recall.simultaneous?.lower).toBeLessThan(recall.lower95 as number);
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
