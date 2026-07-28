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
  mixedFractionBucket,
  predictiveValues,
  reliabilityDiagram,
  simulatedPrecision,
  sizeBucket,
  spanOverlap,
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
  // B2: which mixed cohort the row belongs to. Defaults to `mechanistic`,
  // because that is the only cohort this project produces and the only one the
  // material-assistance target is defined over; a fixture that wants the other
  // cohort has to say so, which is what makes the non-aggregation testable.
  generationMode?: "mechanistic" | "ecological";
  // Observed AI spans (character offsets into the record text), as D4's
  // operation records them.
  observedAiSpans?: ReadonlyArray<{ start: number; end: number }>;
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
      spans: (fields.observedAiSpans ?? []).map((span) => ({
        ...span,
        origin: "ai",
      })),
      generationMode: fields.generationMode ?? "mechanistic",
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
  // What the localized path emitted for this row. `undefined` means it emitted
  // nothing at all, which is a miss for the localized-path recall and not an
  // excuse to leave the row out of the denominator.
  localizedSpans?: ReadonlyArray<{ start: number; end: number }>;
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
    ...(fields.localizedSpans === undefined
      ? {}
      : { localizedSpans: fields.localizedSpans }),
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
      (segment) => segment.key === "mechanistic/75_100",
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

// familiesFixture plus the two kinds of row that make the three error-rate
// denominators differ: three ELIGIBLE mixed rows below 50% AI (eligible, but
// neither a warning positive nor a human negative, so no decision family and no
// curve ever sees them) and one INELIGIBLE errored human negative (a binary row
// the continuous statistics count in their population but the decision families
// drop for the word floor).
function companionFixture(): EvaluationItem[] {
  return [
    ...familiesFixture(),
    item({ author: "x1", label: "human", wordCount: 30, status: "error" }),
    ...Array.from({ length: 3 }, (_, index) =>
      item({
        author: `mx${index}`,
        label: "mixed",
        aiFraction: 0.3,
        documentScore: 0.3,
      }),
    ),
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

// Five points, two bins: the counts (2 and 3) differ, so the mass weighting and a
// flat 1/bins weighting give different answers.
const UNEVEN_BINS: CalibrationPoint[] = [
  { probability: 0.1, label: 0 },
  { probability: 0.2, label: 0 },
  { probability: 0.3, label: 1 },
  { probability: 0.4, label: 0 },
  { probability: 0.5, label: 1 },
];

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
    expect(eceEqualMass(skewed, 2)).toBeCloseTo(0.5 * 0.015 + 0.5 * 0.535, 10);
    // The equal-width answer over the same points is a different number: it
    // pools the three low scores into one bin. That difference is the reason the
    // gate moves to equal-mass.
    expect(eceEqualMass(skewed, 2)).not.toBeCloseTo(0.26, 10);
  });

  it("keeps every point in exactly one bin when the count is not a multiple of the bins", () => {
    const diagram = reliabilityDiagram(UNEVEN_BINS, 2);
    expect(diagram.reduce((total, bin) => total + bin.count, 0)).toBe(5);
    expect(diagram).toHaveLength(2);
    expect(diagram[0].lowestProbability).toBeCloseTo(0.1, 10);
    expect(diagram[1].highestProbability).toBeCloseTo(0.5, 10);
    expect(Number.isFinite(eceEqualMass(UNEVEN_BINS, 2))).toBe(true);
  });

  it("weighs each bin by its MASS, not by 1/bins", () => {
    // Unequal bins are the normal case, not the edge case: `equalMassBins` gives
    // the first `count % bins` groups one extra point, so a 60-row probe comes out
    // 3,4,4,3,4,... Five points in two bins split 2 | 3:
    //   bin0 {0.1, 0.2}      meanP 0.15  observed 0/2  gap 0.15       weight 2/5
    //   bin1 {0.3, 0.4, 0.5} meanP 0.40  observed 2/3  gap 4/15       weight 3/5
    const expected = (2 / 5) * 0.15 + (3 / 5) * (2 / 3 - 0.4);
    expect(eceEqualMass(UNEVEN_BINS, 2)).toBeCloseTo(expected, 10);
    expect(expected).toBeCloseTo(0.22, 10);
    // The flat 1/bins weighting answers 0.2083..., so replacing the mass weight
    // with `1 / bins` breaks this assertion instead of going unnoticed.
    const flatWeighting = 0.5 * 0.15 + 0.5 * (2 / 3 - 0.4);
    expect(eceEqualMass(UNEVEN_BINS, 2)).not.toBeCloseTo(flatWeighting, 4);

    // The diagram and the statistic read the same bins, so the mass behind each
    // row is auditable.
    const diagram = reliabilityDiagram(UNEVEN_BINS, 2);
    expect(diagram[0].count).toBe(2);
    expect(diagram[1].count).toBe(3);
    expect(diagram[1].meanProbability).toBeCloseTo(0.4, 10);
    expect(diagram[1].positiveRate).toBeCloseTo(2 / 3, 10);
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
    const metrics = computeEvaluationMetrics(companionFixture(), OPTIONS);
    const conditional = metrics.release.warning.conditional;
    expect(conditional.family).toBe("conditional-on-scored");
    expect(conditional.selectiveFailureSensitive).toBe(true);
    expect(conditional.errorRate.value).toBe(
      metrics.decisionPopulationErrorRate.value,
    );
    expect(conditional.errorRate.value).toBeGreaterThan(0);
    // The separability and calibration blocks are conditional too, and they were
    // measured over a THIRD population, so they carry their own companion.
    expect(metrics.separability.errorRate.value).toBe(
      metrics.binaryPopulationErrorRate.value,
    );
    expect(metrics.calibration.errorRate.value).toBe(
      metrics.binaryPopulationErrorRate.value,
    );
    expect(metrics.calibration.population).toBe("conditional-on-scored");
  });

  it("gives each block the error rate of ITS denominator, not the global one", () => {
    // Three populations, three different rates, so no assertion here can be
    // satisfied by the wrong denominator (the bug this pins: every block used to
    // receive `metrics.errorRate`, whose denominator is the whole eligible set).
    //
    //   * eligible                     — 10 rows, 2 errored  => 0.2
    //   * eligible decision population — the 7 rows that are a warning positive
    //     or a human negative (the three mixed<50% rows are neither), 2 errored
    //     => 2/7
    //   * binary population            — every positive/negative row, eligibility
    //     aside, so the 30-word human joins: 8 rows, 3 errored => 3/8
    const metrics = computeEvaluationMetrics(companionFixture(), OPTIONS);

    expect(metrics.errorRate.value).toBeCloseTo(0.2, 10);
    expect(metrics.decisionPopulationErrorRate.value).toBeCloseTo(2 / 7, 10);
    expect(metrics.binaryPopulationErrorRate.value).toBeCloseTo(3 / 8, 10);

    // Release: the population both families were measured over.
    expect(metrics.release.warning.errorRatePopulation).toBe(
      "eligible-decision-population",
    );
    expect(metrics.release.warning.errorRate.value).toBeCloseTo(2 / 7, 10);
    expect(metrics.release.visualAction?.errorRate.value).toBeCloseTo(
      2 / 7,
      10,
    );

    // Separability and calibration: the population behind `scoredBinary`.
    expect(metrics.separability.errorRatePopulation).toBe("binary-population");
    expect(metrics.separability.errorRate.value).toBeCloseTo(3 / 8, 10);
    expect(metrics.calibration.errorRatePopulation).toBe("binary-population");
    expect(metrics.calibration.errorRate.value).toBeCloseTo(3 / 8, 10);
    // The two denominators are published, not inferred: 5 scored rows out of a
    // binary population of 8.
    expect(metrics.calibration.scored).toBe(5);
    expect(metrics.calibration.population).toBe("conditional-on-scored");
    expect(metrics.calibration.populationSize).toBe(8);
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

  it("never lets the unknown basis become gating evidence, however many rows it holds", () => {
    // This is the case a real corpus hits TODAY: `labelBasis` only enters the
    // closed schema in C1, so every human negative lands in `unknown` — and a real
    // corpus has far more than the 300-row floor, so the count check alone would
    // wave it through. The basis guard is the only thing between a nonexistent
    // evidence basis and an approved FPR budget (R4/R6).
    const floor = REBUILD_V3_POLICY.powerFloors.criticalFprHumanNegatives;
    const unlabelled = Array.from({ length: floor + 5 }, (_, index) =>
      item({
        author: `u${index}`,
        label: "human",
        documentScore: 0.1,
      }),
    );
    const labelBasis = computeEvaluationMetrics(unlabelled, OPTIONS).labelBasis;

    expect(labelBasis.fieldPresent).toBe(false);
    expect(labelBasis.bases).toHaveLength(1);
    const unknown = labelBasis.bases[0];
    expect(unknown.basis).toBe("unknown");
    // The count clears the floor and the basis is STILL not powered.
    expect(unknown.count).toBeGreaterThan(unknown.powerFloor);
    expect(unknown.powered).toBe(false);
    expect(unknown.evidenceRole).toBe(
      REBUILD_V3_POLICY.labelBasis.underPoweredRole,
    );
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

// ===========================================================================
// B2 — the three frozen targets. Each block below pins one thing the frozen
// table makes IMPOSSIBLE rather than merely unlikely.
// ===========================================================================

describe("the three product targets (B2)", () => {
  // Two authors' worth of clean evidence so every population below is non-empty
  // and the added rows are the only thing that can move a number.
  const BASE: readonly EvaluationItem[] = [
    item({ author: "h1", label: "human", documentScore: 0.1 }),
    item({ author: "h2", label: "human", documentScore: 0.15 }),
    item({
      author: "a1",
      label: "ai",
      documentScore: 0.95,
      warned: true,
      visualActioned: true,
    }),
    item({
      author: "m1",
      label: "mixed",
      aiFraction: 0.7,
      documentScore: 0.8,
      warned: true,
    }),
  ];

  it("keeps a mixed row below the frozen AI fraction out of every gate population", () => {
    const floor = REBUILD_V3_POLICY.materialAssistance.minimumAiFraction;
    expect(floor).toBe(0.5);
    // A row that WOULD move every one of these numbers if it were counted: it is
    // warned and visual-actioned, so counting it as a positive would raise both
    // recalls, and counting it as a negative would raise both FPRs.
    const withDiagnosticRow = [
      ...BASE,
      item({
        author: "m2",
        label: "mixed",
        aiFraction: floor - 0.01,
        documentScore: 0.9,
        warned: true,
        visualActioned: true,
      }),
    ];

    const before = computeEvaluationMetrics(BASE, OPTIONS);
    const after = computeEvaluationMetrics(withDiagnosticRow, OPTIONS);

    for (const families of [
      [before.warning, after.warning] as const,
      [before.visualAction, after.visualAction] as const,
    ]) {
      const [a, b] = families;
      expect(b?.endToEnd.positives).toBe(a?.endToEnd.positives);
      expect(b?.endToEnd.negatives).toBe(a?.endToEnd.negatives);
      expect(b?.endToEnd.sampleSize).toBe(a?.endToEnd.sampleSize);
      expect(b?.endToEnd.truePositives).toBe(a?.endToEnd.truePositives);
      expect(b?.endToEnd.falsePositives).toBe(a?.endToEnd.falsePositives);
      expect(b?.endToEnd.recall.value).toBe(a?.endToEnd.recall.value);
      expect(b?.endToEnd.falsePositiveRate.value).toBe(
        a?.endToEnd.falsePositiveRate.value,
      );
    }
    // The gated mixed-recall block has the same denominator before and after.
    expect(after.mixed.atLeastHalfAi.sampleSize).toBe(
      before.mixed.atLeastHalfAi.sampleSize,
    );
    expect(after.mixed.atLeastHalfAi.warningRecall).toBe(
      before.mixed.atLeastHalfAi.warningRecall,
    );
    // And it IS visible, as the diagnostic curve slice the frozen table says it
    // is — dropped from the gates, never dropped from the report.
    expect(after.mixed.byFraction.map((segment) => segment.key)).toContain(
      "mechanistic/25_49",
    );
    expect(REBUILD_V3_POLICY.mixedBelowHalfAiRole).toBe(
      "diagnostic-curve-only",
    );
  });

  it("never lets material assistance raise the action ceiling above indicator", () => {
    expect(REBUILD_V3_POLICY.materialAssistance.authorizes).toBe(
      "warning-only",
    );
    // A corpus whose ONLY visual-actioned positives are material assistance:
    // three mechanistic mixed rows above the fraction floor, all actioned, and
    // one integral AI positive that the action threshold missed.
    const fixture = [
      item({ author: "h1", label: "human", documentScore: 0.1 }),
      item({
        author: "a1",
        label: "ai",
        documentScore: 0.6,
        warned: true,
        visualActioned: false,
      }),
      ...[0.6, 0.7, 0.8].map((aiFraction, index) =>
        item({
          author: `m${index}`,
          label: "mixed",
          aiFraction,
          documentScore: 0.99,
          warned: true,
          visualActioned: true,
        }),
      ),
    ];

    const metrics = computeEvaluationMetrics(fixture, OPTIONS);

    // The warning target counts both: integral generation AND mechanistic
    // material assistance are warning positives.
    expect(metrics.warning.endToEnd.positives).toBe(4);
    expect(metrics.warning.endToEnd.recall.value).toBe(1);

    // The statistic that authorizes visual action counts INTEGRAL positives
    // only, and it says so in the artifact.
    const authorization = metrics.actionAuthorization;
    expect(authorization?.role).toBe("release");
    expect(authorization?.positivePopulation).toBe("integral-positives");
    expect(authorization?.positives).toBe(1);
    expect(authorization?.excludedMaterialAssistancePositives).toBe(3);
    // One integral positive, not actioned: recall 0. Three actioned mixed rows
    // cannot lift it, which is the whole point.
    expect(authorization?.recall.value).toBe(0);
  });

  it("never aggregates the mechanistic and ecological cohorts", () => {
    expect(REBUILD_V3_POLICY.materialAssistance.cohortsAggregated).toBe(false);
    const fixture = [
      item({ author: "h1", label: "human", documentScore: 0.1 }),
      item({ author: "a1", label: "ai", documentScore: 0.95, warned: true }),
      item({
        author: "m1",
        label: "mixed",
        aiFraction: 0.8,
        generationMode: "mechanistic",
        documentScore: 0.9,
        warned: true,
      }),
      // An ecological row above the fraction floor. If the cohorts were pooled
      // it would be a warning positive and would enter the gated block.
      item({
        author: "e1",
        label: "mixed",
        aiFraction: 0.8,
        generationMode: "ecological",
        documentScore: 0.05,
        warned: false,
      }),
    ];

    const metrics = computeEvaluationMetrics(fixture, OPTIONS);

    // The gated block is the MECHANISTIC cohort: one row, warned, recall 1.
    expect(metrics.mixed.atLeastHalfAi.generationMode).toBe("mechanistic");
    expect(metrics.mixed.atLeastHalfAi.sampleSize).toBe(1);
    expect(metrics.mixed.atLeastHalfAi.warningRecall).toBe(1);

    // The ecological row is a warning positive of NEITHER family.
    expect(metrics.warning.endToEnd.positives).toBe(2);
    expect(metrics.warning.endToEnd.negatives).toBe(1);
    expect(metrics.warning.endToEnd.sampleSize).toBe(3);

    // Both cohorts are published, separately, and each carries its own count.
    const cohorts = metrics.mixed.byGenerationMode;
    expect(cohorts.map((cohort) => cohort.generationMode)).toEqual([
      "ecological",
      "mechanistic",
    ]);
    expect(cohorts.every((cohort) => cohort.aggregated === false)).toBe(true);
    const ecological = cohorts.find(
      (cohort) => cohort.generationMode === "ecological",
    );
    expect(ecological?.atLeastHalfAi.sampleSize).toBe(1);
    expect(ecological?.atLeastHalfAi.warningRecall).toBe(0);
    expect(ecological?.role).toBe("diagnostic");
    // No key of the fraction curve mixes the two cohorts either.
    expect(metrics.mixed.byFraction.map((segment) => segment.key)).toEqual([
      "ecological/75_100",
      "mechanistic/75_100",
    ]);
  });
});

describe("span localization metrics are diagnostic (B2)", () => {
  it("scores span overlap in the unit the spans are defined in", () => {
    // Observed [0,10) and [20,30); predicted [5,25). Intersection = [5,10) plus
    // [20,25) = 10 characters; union = [0,10) + [20,30) + [10,20) = 30.
    const overlap = spanOverlap(
      [
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ],
      [{ start: 5, end: 25 }],
    );
    expect(overlap.observed).toBe(20);
    expect(overlap.predicted).toBe(20);
    expect(overlap.intersection).toBe(10);
    expect(overlap.union).toBe(30);
    expect(overlap.iou).toBeCloseTo(1 / 3, 12);
    expect(overlap.tokenPrecision).toBe(0.5);
    expect(overlap.tokenRecall).toBe(0.5);
    expect(overlap.tokenF1).toBe(0.5);
  });

  it("merges overlapping spans instead of double counting them", () => {
    const overlap = spanOverlap(
      [
        { start: 0, end: 10 },
        { start: 5, end: 12 },
      ],
      [{ start: 0, end: 12 }],
    );
    expect(overlap.observed).toBe(12);
    expect(overlap.iou).toBe(1);
  });

  it("publishes localization as a diagnostic, per cohort, never as a gate", () => {
    const fixture = [
      item({ author: "h1", label: "human", documentScore: 0.1 }),
      // Perfect localization.
      item({
        author: "m1",
        label: "mixed",
        aiFraction: 0.6,
        observedAiSpans: [{ start: 0, end: 10 }],
        localizedSpans: [{ start: 0, end: 10 }],
        documentScore: 0.9,
        warned: true,
      }),
      // The localized path emitted nothing: a miss for its recall, and the row
      // stays in the denominator.
      item({
        author: "m2",
        label: "mixed",
        aiFraction: 0.6,
        observedAiSpans: [{ start: 0, end: 10 }],
        documentScore: 0.9,
        warned: true,
      }),
      // The other cohort, kept apart.
      item({
        author: "e1",
        label: "mixed",
        aiFraction: 0.6,
        generationMode: "ecological",
        observedAiSpans: [{ start: 0, end: 10 }],
        localizedSpans: [{ start: 5, end: 15 }],
        documentScore: 0.9,
        warned: true,
      }),
    ];

    const localization = computeEvaluationMetrics(
      fixture,
      OPTIONS,
    ).localization;

    expect(localization.role).toBe("diagnostic");
    expect(localization.gates).toBe(false);
    expect(localization.authorizesVisualAction).toBe(false);
    expect(localization.unit).toBe("character-offset");
    expect(REBUILD_V3_POLICY.localization.metricsRole).toBe("diagnostic");
    expect(REBUILD_V3_POLICY.localization.authorizesVisualAction).toBe(false);

    // There is no cross-cohort aggregate to misread: only cohorts.
    expect(
      localization.byGenerationMode.map((cohort) => cohort.generationMode),
    ).toEqual(["ecological", "mechanistic"]);

    const mechanistic = localization.byGenerationMode.find(
      (cohort) => cohort.generationMode === "mechanistic",
    );
    // Every row of this cohort is scored, so the two families coincide here —
    // which is exactly why this fixture could not see the status defect. The
    // test below adds the undecided row that separates them.
    expect(mechanistic?.spanProducer).toBe("present");
    expect(mechanistic?.endToEnd.population).toBe(2);
    expect(mechanistic?.conditionalOnScored.population).toBe(2);
    expect(mechanistic?.endToEnd.localizedEmitted).toBe(1);
    expect(mechanistic?.endToEnd.localizedPathRecall?.value).toBe(0.5);
    // Micro: intersection 10 over union 10 for the first row, 0 over 10 for the
    // second — 10/20.
    expect(mechanistic?.endToEnd.overlap?.microIou).toBe(0.5);
    expect(mechanistic?.endToEnd.overlap?.macroIou).toBe(0.5);
    expect(mechanistic?.endToEnd.overlap?.microTokenRecall).toBe(0.5);
    // Precision has the PREDICTED length in its denominator, and only one row
    // predicted anything at all.
    expect(mechanistic?.endToEnd.overlap?.microTokenPrecision).toBe(1);

    const ecological = localization.byGenerationMode.find(
      (cohort) => cohort.generationMode === "ecological",
    );
    // [0,10) against [5,15): intersection 5, union 15.
    expect(ecological?.endToEnd.population).toBe(1);
    expect(ecological?.endToEnd.overlap?.microIou).toBeCloseTo(1 / 3, 12);
    expect(ecological?.endToEnd.overlap?.microTokenPrecision).toBe(0.5);
    expect(ecological?.endToEnd.overlap?.microTokenRecall).toBe(0.5);
  });

  // R5's pairing rule applied to the localization diagnostics. Before this test
  // the block published ONE population — scored rows only — so an errored row of
  // the cohort left the denominator of the localized-path recall AND of every
  // micro/macro ratio, and an inference failure could only ever raise them.
  // MEASURED on the committed tree at 5812cdf with a scratch probe: adding the
  // errored row below left `population: 1, localizedPathRecall: 1, microIou: 1`
  // byte-identical, while `mixed.atLeastHalfAi.sampleSize` in the SAME artifact
  // went 1 -> 2 and its recall 1 -> 0.5. Two mixed-cohort recall blocks with
  // opposite status conventions, and the localization one favorable to failure.
  it("charges an undecided cohort row as a localization miss end to end, and leaves the conditional family alone", () => {
    const base = [
      item({ author: "h1", label: "human", documentScore: 0.1 }),
      item({
        author: "m1",
        label: "mixed",
        aiFraction: 0.6,
        observedAiSpans: [{ start: 0, end: 10 }],
        localizedSpans: [{ start: 0, end: 10 }],
        documentScore: 0.9,
        warned: true,
      }),
    ];
    // Same cohort, same observed span, no decision and therefore no emission.
    const errored = item({
      author: "m2",
      label: "mixed",
      aiFraction: 0.6,
      observedAiSpans: [{ start: 0, end: 10 }],
      status: "error",
    });

    const mechanistic = (items: readonly EvaluationItem[]) => {
      const cohort = computeEvaluationMetrics(
        items,
        OPTIONS,
      ).localization.byGenerationMode.find(
        (entry) => entry.generationMode === "mechanistic",
      );
      if (cohort === undefined) throw new Error("no mechanistic cohort");
      return cohort;
    };
    const before = mechanistic(base);
    const after = mechanistic([...base, errored]);

    // Conditional on scored: unchanged by construction — that is what the family
    // conditions on, and it is the ONLY family the block used to publish.
    expect(after.conditionalOnScored).toEqual(before.conditionalOnScored);
    expect(after.conditionalOnScored.population).toBe(1);
    expect(after.conditionalOnScored.undecidedRows).toBe(0);
    expect(after.conditionalOnScored.localizedPathRecall?.value).toBe(1);
    expect(after.conditionalOnScored.overlap?.microIou).toBe(1);

    // End to end: the undecided row is IN the denominator and emitted nothing.
    expect(before.endToEnd.population).toBe(1);
    expect(before.endToEnd.localizedPathRecall?.value).toBe(1);
    expect(after.endToEnd.population).toBe(2);
    expect(after.endToEnd.undecidedRows).toBe(1);
    expect(after.endToEnd.localizedEmitted).toBe(1);
    expect(after.endToEnd.localizedPathRecall?.value).toBe(0.5);
    expect(after.endToEnd.localizedPathRecall?.value).toBeLessThan(
      before.endToEnd.localizedPathRecall?.value ?? Number.NaN,
    );
    // Intersection 10 over union 10 + 10: the errored row contributes its whole
    // observed length to the union and nothing to the intersection.
    expect(after.endToEnd.overlap?.microIou).toBe(0.5);
    expect(after.endToEnd.overlap?.microTokenRecall).toBe(0.5);
    expect(after.endToEnd.overlap?.macroIou).toBe(0.5);
    // Precision's denominator is the PREDICTED length, which an undecided row
    // does not move — so micro precision is the one ratio that cannot fall.
    expect(after.endToEnd.overlap?.microTokenPrecision).toBe(1);

    // The direction now agrees with the other mixed-cohort recall block in the
    // same artifact, which is where the divergence was.
    expect(
      computeEvaluationMetrics([...base, errored], OPTIONS).mixed.atLeastHalfAi
        .warningRecall,
    ).toBe(0.5);

    // Both families name their own denominator rule, so the artifact is readable
    // without inferring the population from the field names.
    expect(after.endToEnd.family).toBe("end-to-end");
    expect(after.endToEnd.populationRule).toBe(
      "cohort-rows-with-observed-spans",
    );
    expect(after.conditionalOnScored.family).toBe("conditional-on-scored");
    expect(after.conditionalOnScored.populationRule).toBe(
      "scored-cohort-rows-with-observed-spans",
    );
  });

  // No stage of the sealed pipeline populates `localizedSpans` yet: there is no
  // span field in benchmark/prediction-schema.ts and benchmark/commands/evaluate.ts
  // forwards `localizedRawScore` only. D4 owns the span head. Until then a zero
  // ratio here would read as a measured localization failure of the detector when
  // in fact nothing emitted anything, so the ratios are `null` and the absence is
  // declared instead of being spelled `0`.
  it("publishes no localization ratio at all when no row carries a localized span", () => {
    const fixture = [
      item({ author: "h1", label: "human", documentScore: 0.1 }),
      item({
        author: "m1",
        label: "mixed",
        aiFraction: 0.6,
        observedAiSpans: [{ start: 0, end: 10 }],
        documentScore: 0.9,
        warned: true,
      }),
      item({
        author: "m2",
        label: "mixed",
        aiFraction: 0.9,
        observedAiSpans: [{ start: 20, end: 40 }],
        documentScore: 0.9,
        warned: true,
      }),
    ];

    const cohort = computeEvaluationMetrics(
      fixture,
      OPTIONS,
    ).localization.byGenerationMode.find(
      (entry) => entry.generationMode === "mechanistic",
    );

    expect(cohort?.spanProducer).toBe("absent");
    // The counts stay: they say how much evidence is waiting for a producer.
    expect(cohort?.endToEnd.population).toBe(2);
    expect(cohort?.endToEnd.localizedEmitted).toBe(0);
    // The ratios do not, because there is nothing to be a ratio OF.
    expect(cohort?.endToEnd.localizedPathRecall).toBeNull();
    expect(cohort?.endToEnd.overlap).toBeNull();
    expect(cohort?.conditionalOnScored.localizedPathRecall).toBeNull();
    expect(cohort?.conditionalOnScored.overlap).toBeNull();

    // An empty cohort is the same statement for a different reason, and a NaN
    // recall (which `proportionEstimate(0, 0)` returns) is not that statement.
    const empty = computeEvaluationMetrics(
      fixture,
      OPTIONS,
    ).localization.byGenerationMode.find(
      (entry) => entry.generationMode === "ecological",
    );
    expect(empty?.endToEnd.population).toBe(0);
    expect(empty?.endToEnd.localizedPathRecall).toBeNull();
    expect(empty?.spanProducer).toBe("absent");
  });

  // Requisito 2 of the B2 brief asks for the v0-v8 curve as the diagnostic beside
  // the `warning.mixed-recall` gate. `mixed.byFraction` is NOT that curve: it is a
  // four-band aggregation of it, and this test pins WHICH levels it pools so the
  // shortfall is executable rather than a sentence someone can delete. D4 owns
  // the per-level curve (it owns the mixing lane that would write the level).
  it("pools the nine frozen curve levels into four bands, so byFraction is not the curve", () => {
    // The frozen v0-v8 coverage levels, from D4 in the plan.
    const levels = [0, 0.15, 0.25, 0.4, 0.5, 0.6, 0.75, 0.9, 1];
    const pooled = new Map<string, number[]>();
    for (const level of levels) {
      const band = mixedFractionBucket(level);
      pooled.set(band, [...(pooled.get(band) ?? []), level]);
    }
    expect([...pooled.entries()]).toEqual([
      ["0_24", [0, 0.15]],
      ["25_49", [0.25, 0.4]],
      ["50_74", [0.5, 0.6]],
      ["75_100", [0.75, 0.9, 1]],
    ]);
    // Four keys for nine levels: no consumer of `mixed.byFraction`, of the
    // `mixedFraction` slice axis or of `criticalRecallSlices` can read v0 apart
    // from v1, v2 apart from v3, or v4 apart from v5.
    expect(pooled.size).toBe(4);
    expect(pooled.size).toBeLessThan(levels.length);
  });
});

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
