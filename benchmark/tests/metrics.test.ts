import { describe, expect, it } from "vitest";

import {
  boundProvenanceOf,
  brierScore,
  calibrationInterceptSlope,
  computeBinaryMetrics,
  computeEvaluationMetrics,
  computeSegmentedMetrics,
  ece15,
  eceEqualMass,
  lengthBandKeyOf,
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
  type MetricEstimate,
  type Prediction,
} from "../metrics.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import type { LengthBandRow } from "../preregistration-v4.ts";
import { ResamplingUnitError } from "../bootstrap.ts";
import type { BenchmarkRecord } from "../schema.ts";

function prediction(
  label: Prediction["label"],
  score: number,
  telemetry: { latencyMs?: number } = {},
): Prediction {
  return { label, score, ...telemetry };
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
  // The source POOL, i.e. the outer level of the frozen resampling hierarchy.
  domainSource?: string;
  // The three levels of the ai-recall row and the human parent of the mixed row.
  // Defaulted per label by `record` below; named here so a fixture that wants
  // several generators, templates, batches or parents can say so.
  promptTemplate?: string;
  generationBatch?: string;
  humanSeed?: string;
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
    // C4 resolves the resampling unit off the grouping axes, so a fixture that
    // wants an interval has to declare one. `domainSource` is the outer level of
    // the human-specificity row; `author` is the inner one.
    groups: {
      author: fields.author,
      domainSource: fields.domainSource ?? "pool-generic",
    },
  };
  // The ai-recall row nests generator ⊃ prompt template ⊃ batch, so a POSITIVE row
  // declares all three or its recall interval has no unit at all; the mixed row
  // crosses the human parent with the edit operation, so a mechanistic mixed row
  // declares its seed too. A human row declares NONE of them: an apparatus axis is
  // `notApplicable` on human text by rule, and no design of the frozen table reads
  // one over a human population. The defaults are single-valued on purpose — a test
  // that needs more than one level per factor overrides them, and one that does not
  // gets a design with a single unit, which the estimator refuses to call an
  // interval.
  if (fields.label !== "human") {
    const groups = base.groups as Record<string, unknown>;
    groups.generatorFamily = fields.generatorFamily ?? "gpt";
    groups.promptTemplate = fields.promptTemplate ?? "tpl-generic";
    groups.generationBatch = fields.generationBatch ?? "batch-generic";
    if (
      fields.label === "mixed" &&
      (fields.generationMode ?? "mechanistic") === "mechanistic"
    ) {
      groups.humanSeed = fields.humanSeed ?? `seed-${fields.author}`;
    }
  }
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

// Every row in ONE resampling unit: one source pool, one author. A replicate can
// then only draw that single cluster once, so every replicate equals the weighted
// statistic at unit weights and the interval collapses onto it. That is what makes
// this fixture a black-box equivalence proof between the weighted replicate forms
// and the exported unweighted definitions.
const SINGLE_UNIT = Array.from({ length: 12 }, (_, index) =>
  item({
    author: "solo",
    domainSource: "pool-solo",
    label: index % 2 === 0 ? "human" : "ai",
    documentScore: index % 2 === 0 ? 0.05 + index / 100 : 0.85 + index / 200,
    warned: index % 2 === 1,
    visualActioned: index % 2 === 1,
  }),
);

const SINGLE_UNIT_POINTS: CalibrationPoint[] = Array.from(
  { length: 12 },
  (_, index) => ({
    probability: index % 2 === 0 ? 0.05 + index / 100 : 0.85 + index / 200,
    label: index % 2 === 0 ? 0 : 1,
  }),
);

describe("the weighted replicate statistics mirror the exported definitions", () => {
  it("collapses onto the unweighted value when the population is one unit", () => {
    const metrics = computeEvaluationMetrics(SINGLE_UNIT, OPTIONS);
    // One cluster, so every replicate is the same weight vector [1]: the interval
    // IS the weighted statistic evaluated at unit weights.
    expect(metrics.calibration.brier.lower95).toBeCloseTo(
      brierScore(SINGLE_UNIT_POINTS),
      12,
    );
    expect(metrics.calibration.brier.upper95).toBeCloseTo(
      brierScore(SINGLE_UNIT_POINTS),
      12,
    );
    expect(metrics.calibration.eceEqualMass15.lower95).toBeCloseTo(
      eceEqualMass(
        SINGLE_UNIT_POINTS,
        PREREGISTRATION_V4.calibrationGate.eceBins,
      ),
      12,
    );
    expect(metrics.ece15.lower95).toBeCloseTo(ece15(SINGLE_UNIT_POINTS), 12);
    // AUROC and PR-AUC have no exported unweighted form, so the point estimate is
    // the reference: it comes from the row-wise implementation, the bounds from the
    // weighted one, and they have to agree.
    for (const estimate of [
      metrics.separability.auroc,
      metrics.separability.prAuc,
    ]) {
      expect(estimate.lower95).toBeCloseTo(estimate.value, 12);
      expect(estimate.upper95).toBeCloseTo(estimate.value, 12);
    }
  });
});

describe("a resampling unit that cannot be resolved fails loudly", () => {
  it("refuses a record whose declared unit is unknown, naming axis and estimand", () => {
    // A v2 record carries no `domainSource`, and an absent axis reads as
    // `unknown` — the truthful mapping, not a flattering one. The frozen contract
    // forbids falling back to independent rows, so the whole computation fails
    // instead of publishing an interval that would look valid.
    // The row that remains on the human estimands is `groups.author` with
    // `groups.source` behind it, so the record has to lose BOTH for the unit to be
    // unresolvable — which is what makes the refusal about the declared unit and not
    // about a missing stratum.
    const withoutUnit = SEPARABLE.map((entry) => ({
      ...entry,
      record: {
        ...entry.record,
        groups: {
          domainSource: (entry.record.groups as { domainSource?: string })
            .domainSource,
        },
      } as BenchmarkRecord,
    }));
    let thrown: unknown;
    try {
      computeEvaluationMetrics(withoutUnit, OPTIONS);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ResamplingUnitError);
    expect((thrown as ResamplingUnitError).axis).toBe("groups.author");
    // The FPR of the warning decision is the first estimand resolved, so it is the
    // one that names itself; every other design over these rows is unusable too.
    expect((thrown as ResamplingUnitError).estimand).toBe("warning.fpr");
    expect((thrown as Error).message).toMatch(/unknown/u);
    expect((thrown as Error).message).toMatch(
      /fallbackToIndependentRows em false/u,
    );
  });

  it("refuses positives with no generator axis, naming the ai-recall row", () => {
    // The human negatives resolve fine here: only the AI positives lose the outer
    // level of the ai-recall row. So the failure has to name THAT estimand and THAT
    // axis — an operator sent to `groups.author` would find nothing wrong.
    const withoutGenerator = SEPARABLE.map((entry) =>
      entry.record.label === "human"
        ? entry
        : {
            ...entry,
            record: {
              ...entry.record,
              groups: {
                ...(entry.record.groups as Record<string, unknown>),
                generatorFamily: undefined,
              },
            } as unknown as BenchmarkRecord,
          },
    );
    let thrown: unknown;
    try {
      computeEvaluationMetrics(withoutGenerator, OPTIONS);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ResamplingUnitError);
    expect((thrown as ResamplingUnitError).axis).toBe("groups.generatorFamily");
    expect((thrown as ResamplingUnitError).estimand).toBe("warning.recall");
  });
});

describe("the frozen replicate count is a floor, not a default", () => {
  it("refuses fewer replicates than the pre-registered pilot count", () => {
    expect(() =>
      computeEvaluationMetrics(SEPARABLE, {
        ...OPTIONS,
        bootstrapReplicates: PREREGISTRATION_V4.bootstrapReplicates.pilot - 1,
      }),
    ).toThrow(
      new RegExp(String(PREREGISTRATION_V4.bootstrapReplicates.pilot), "u"),
    );
  });

  it("accepts the release count, which is higher", () => {
    const plan = computeEvaluationMetrics(SEPARABLE, {
      ...OPTIONS,
      bootstrapReplicates: PREREGISTRATION_V4.bootstrapReplicates.release,
    }).resampling;
    for (const entry of plan.entries) {
      expect(entry.replicates).toBe(
        PREREGISTRATION_V4.bootstrapReplicates.release,
      );
    }
  });
});

describe("the published plan declares a unit for every estimand", () => {
  it("names the unit, the method and whether the interval was resampled", () => {
    const plan = computeEvaluationMetrics(SEPARABLE, OPTIONS).resampling;
    const byEstimand = new Map(
      plan.entries.map((entry) => [entry.estimand, entry]),
    );
    // The frozen table, estimand by estimand.
    expect(byEstimand.get("warning.fpr")?.unitKind).toBe("hierarchical");
    // ONE level, because the frame declares one cell: `groups.domainSource` would draw
    // the same stratum in every replicate, and the published plan may not name a factor
    // the design did not vary.
    expect(byEstimand.get("warning.fpr")?.unitAxes).toEqual(["groups.author"]);
    expect(byEstimand.get("warning.recall")?.unitAxes).toEqual([
      "groups.generatorFamily",
      "groups.promptTemplate",
      "groups.generationBatch",
    ]);
    expect(byEstimand.get("mixed.warning.recall")?.unitKind).toBe("multiway");
    expect(byEstimand.get("mixed.warning.recall")?.unitAxes).toEqual([
      "groups.humanSeed",
      "groups.promptTemplate",
      "groups.generatorFamily",
    ]);
    // Only the estimands this run actually resampled say so, and they carry the
    // measured unit; the rest declare the unit without claiming a resample (R7).
    expect(byEstimand.get("calibration.ece")?.executed).toBe(
      "percentile-bootstrap",
    );
    expect(byEstimand.get("calibration.ece")?.measured?.units).toBe(40);
    expect(byEstimand.get("warning.fpr")?.executed).toBe(
      "percentile-bootstrap",
    );
    expect(byEstimand.get("warning.fpr")?.measured?.units).toBe(40);
    expect(byEstimand.get("warning.recall")?.executed).toBe(
      "percentile-bootstrap",
    );
    // The SLICE variants are declared here and measured elsewhere, and the entry
    // says so instead of leaving a bare `measured: null` to be read as a failure.
    expect(byEstimand.get("warning.fpr.slice")?.measured).toBeNull();
    expect(byEstimand.get("warning.fpr.slice")?.measurementNote).toMatch(
      /plano da própria fatia/u,
    );
    // No entry may declare fewer replicates than the pre-registered pilot count.
    for (const entry of plan.entries) {
      expect(entry.replicates).toBeGreaterThanOrEqual(
        PREREGISTRATION_V4.bootstrapReplicates.pilot,
      );
    }
  });

  // `executed` says the DESIGN ran; it does not say which estimator supplied the
  // limit that got published. On this fixture the two answers differ — zero false
  // positives make every resampled replicate 0, so the contract's rule publishes
  // Wilson's upper bound under a design that ran — and a plan that carried only
  // `executed` would let a reader take the published bound for a resampled one (R7).
  it("names which estimator supplied each published limit, apart from whether the design ran", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, {
      ...OPTIONS,
      preRegisteredStatisticalGates: 8,
    });
    const entry = metrics.resampling.entries.find(
      (candidate) => candidate.estimand === "warning.fpr",
    );
    expect(entry?.executed).toBe("percentile-bootstrap");
    const provenance = entry?.publishedBound;
    if (provenance?.kind !== "envelope") {
      throw new Error(
        `expected an envelope provenance, got ${provenance?.kind}`,
      );
    }
    expect(provenance.rule).toBe(PREREGISTRATION_V4.resampling.publishedBound);
    // The plan's provenance is the estimate's, not a second opinion about it.
    const envelope = metrics.warning.endToEnd.falsePositiveRate.boundEnvelope;
    expect(provenance.individual).toEqual({
      lowerFrom: envelope?.lowerFrom,
      upperFrom: envelope?.upperFrom,
    });
    expect(provenance.simultaneous).toEqual({
      kind: "both-estimators",
      lowerFrom: envelope?.simultaneous?.lowerFrom,
      upperFrom: envelope?.simultaneous?.upperFrom,
    });
    // And on THIS population the deciding limit is the analytic one, while the
    // design ran: the two facts the single `executed` column could not separate.
    if (provenance.simultaneous.kind !== "both-estimators") {
      throw new Error(
        `expected two competing estimators, got ${provenance.simultaneous.kind}`,
      );
    }
    expect(provenance.simultaneous.upperFrom).toBe("analytic");
    expect(envelope?.simultaneous?.resampled.upper).toBe(0);

    // The five continuous statistics have no analytic estimator competing for the
    // slot, so their published limit IS the resampled percentile — stated, not
    // inferred from the absence of an envelope.
    expect(
      metrics.resampling.entries.find(
        (candidate) => candidate.estimand === "calibration.ece",
      )?.publishedBound,
    ).toEqual({ kind: "resampled-only" });
    // The label-basis entry stands for several intervals, one per basis, so it says
    // where the per-interval provenance is instead of averaging it away.
    const perBasis = metrics.resampling.entries.find(
      (candidate) => candidate.estimand === "warning.fpr.labelBasis",
    )?.publishedBound;
    expect(perBasis?.kind).toBe("per-interval");
    // A row this plan does not measure claims nothing about provenance.
    expect(
      metrics.resampling.entries.find(
        (candidate) => candidate.estimand === "warning.fpr.slice",
      )?.publishedBound ?? null,
    ).toBeNull();
  });

  // Naming an estimator is a claim that the estimator produced a limit. Two states
  // carry no limit at all, and the provenance has to say so instead of falling back
  // on Wilson: a rate whose denominator is zero publishes no interval, and an alpha
  // at which neither estimator produced a simultaneous bound publishes none either.
  // Both states are REACHABLE from the sealed pipeline, so a provenance that named
  // Wilson in them would assert a bound the number does not have (R7).
  it("names no estimator for a rate whose denominator is zero", () => {
    // Every human negative errored: `status = "error"` is never a score (R5), so
    // the FPR denominator is zero over a population that is not empty.
    const humansErrored = Array.from({ length: 40 }, (_, index) => {
      const author = `a${index}`;
      return [
        item({ author, label: "human", status: "error" }),
        item({
          author,
          label: "ai",
          documentScore: 0.9,
          warned: true,
          visualActioned: true,
          generatorFamily: "gpt",
        }),
      ];
    }).flat();
    const metrics = computeEvaluationMetrics(humansErrored, {
      ...OPTIONS,
      preRegisteredStatisticalGates: 8,
    });
    const fpr = metrics.warning.endToEnd.falsePositiveRate;
    expect(fpr.value).toBeNaN();
    expect(fpr.lower95).toBeUndefined();
    expect(fpr.upper95).toBeUndefined();
    const entry = metrics.resampling.entries.find(
      (candidate) => candidate.estimand === "warning.fpr",
    );
    expect(entry?.executed).toBe("declared-only");
    expect(entry?.publishedBound).toEqual({ kind: "no-published-bound" });
  });

  it("says no simultaneous limit was published when neither estimator produced one", () => {
    // The configuration `benchmark/commands/evaluate.ts` actually uses: a bootstrap
    // seed and no pre-registered gate count, so there is no Bonferroni family and
    // NO estimand gets a simultaneous bound.
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    expect(
      metrics.warning.endToEnd.falsePositiveRate.simultaneous,
    ).toBeUndefined();
    expect(
      metrics.warning.endToEnd.falsePositiveRate.boundEnvelope?.simultaneous,
    ).toBeUndefined();
    const provenance = metrics.resampling.entries.find(
      (candidate) => candidate.estimand === "warning.fpr",
    )?.publishedBound;
    if (provenance?.kind !== "envelope") {
      throw new Error(
        `expected an envelope provenance, got ${provenance?.kind}`,
      );
    }
    expect(provenance.simultaneous).toEqual({ kind: "none" });
  });

  it("names the one estimator behind a simultaneous limit only one of them produced", () => {
    // Unreachable from the sealed pipeline by construction — `rateEnvelope` only
    // takes this branch when the analytic simultaneous bound exists and the design's
    // tail held no replicate at the family alpha — so it is exercised directly. It
    // is the state the single `null` used to stand for, alongside the two above.
    const provenance = boundProvenanceOf({
      value: 0.03,
      lower95: 0.02,
      upper95: 0.041,
      method: "hierarchical-cluster-percentile",
      simultaneous: {
        correction: "bonferroni",
        familyAlpha: 0.05,
        m: 8,
        alpha: 0.00625,
        z: 2.734,
        lower: 0.01,
        upper: 0.08,
        method: "wilson-one-sided",
      },
      boundEnvelope: {
        rule: PREREGISTRATION_V4.resampling.publishedBound,
        analytic: { lower: 0.02, upper: 0.041, method: "wilson-one-sided" },
        resampled: {
          lower: 0.021,
          upper: 0.037,
          method: "hierarchical-cluster-percentile",
        },
        lowerFrom: "resampled",
        upperFrom: "analytic",
      },
    });
    if (provenance.kind !== "envelope") {
      throw new Error(
        `expected an envelope provenance, got ${provenance.kind}`,
      );
    }
    expect(provenance.simultaneous).toEqual({
      kind: "single-estimator",
      method: "wilson-one-sided",
    });
  });

  it("publishes the mixed multiway as measured and degenerate, with its proxy factor", () => {
    // Four mechanistic mixed rows above the frozen fraction, each with its own human
    // parent — which is what the assembled corpus looks like: 782 parent labels, no
    // two alike. The crossed design is therefore singleton in the parent factor and
    // one-level in the substitute factor, and BOTH numbers are published rather than
    // dressed up as a clustered interval.
    const mixed = Array.from({ length: 4 }, (_, index) =>
      item({
        author: `h${index}`,
        label: "mixed",
        aiFraction: 0.8,
        documentScore: 0.8,
        warned: true,
        humanSeed: `seed-${index}`,
      }),
    );
    const entry = computeEvaluationMetrics(
      [
        ...mixed,
        item({ author: "n1", label: "human", documentScore: 0.1 }),
        item({ author: "n2", label: "human", documentScore: 0.2 }),
      ],
      OPTIONS,
    ).resampling.entries.find(
      (candidate) => candidate.estimand === "mixed.warning.recall",
    );
    expect(entry?.unitKind).toBe("multiway");
    expect(entry?.measured?.items).toBe(4);
    // One level per row in the parent factor, one level in the whole substitute
    // factor: the crossing has nothing to cross.
    expect(entry?.measured?.levels[0].levels).toBe(4);
    expect(entry?.measured?.levels[0].degenerate).toBe(true);
    expect(entry?.measured?.levels[1].levels).toBe(1);
    expect(entry?.measured?.degenerate).toBe(true);
    // The substitution is on the level AND on the entry, because a reader of either
    // one has to see that the table's own factor is not what ran.
    expect(entry?.measured?.levels[1].proxyFor).toBe("operação de edição");
    expect(entry?.proxies).toEqual([
      {
        axis: "groups.promptTemplate",
        standsInFor: "operação de edição",
        reason: expect.stringMatching(/nenhum eixo do schema v4/u),
      },
    ]);
    // Measured, not resampled: the bound beside `mixed.atLeastHalfAi` is analytic.
    expect(entry?.executed).toBe("declared-only");
    expect(entry?.measurementNote).toMatch(/proxy declarado/u);
  });
});

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

  it("keeps the mixed published population over every mixed row, eligible or not", () => {
    // R3 pin. The two DECISION families are restricted to the eligible set;
    // `metrics.mixed` is a separate published block and its population is NOT ours
    // to shrink. Restricting it to eligible rows would move a published number in
    // the favorable direction (an ineligible mixed row that got no decision
    // would leave the denominator instead of counting as a miss) and, at
    // sampleSize 0, there is no measurement to publish at all. So the row below
    // stays in, and stays a miss.
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

  it("puts a Wilson one-sided interval on the proportions the frozen table does not cover", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    // No row of the frozen resampling table covers coverage, abstention, the three
    // error rates or precision, so they keep the analytic estimator and declare NO
    // unit. That absence is the claim: an interval with a unit beside it that never
    // resampled the unit is what R7 forbids.
    for (const estimate of [
      metrics.coverage,
      metrics.abstentionRate,
      metrics.errorRate,
      metrics.warning.endToEnd.precision,
    ]) {
      expect(estimate.method).toBe("wilson-one-sided");
      expect(estimate.resampling).toBeUndefined();
      expect(estimate.boundEnvelope).toBeUndefined();
    }
    expect(metrics.coverage.value).toBe(1);
  });

  it("draws the gated rates over the unit their row of the frozen table declares", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    // Row 1 — FPR and its specificity companion over human text — resamples the author,
    // falling back to the origin document. It nests no stratum: with one declared cell
    // that level holds a single value, and a level with one value is not a level.
    for (const [estimand, estimate] of [
      ["warning.fpr", metrics.warning.endToEnd.falsePositiveRate],
      ["warning.clearanceRate", metrics.warning.endToEnd.clearanceRate],
      ["action.fpr", metrics.visualAction?.endToEnd.falsePositiveRate],
    ] as ReadonlyArray<readonly [string, MetricEstimate]>) {
      expect(estimate.method).toBe("hierarchical-cluster-percentile");
      expect(estimate.resampling?.estimand).toBe(estimand);
      expect(estimate.resampling?.axes).toEqual(["groups.author"]);
    }
    // Row 2 — recall over AI text — nests generator, prompt template and batch, in
    // that order, over the POSITIVES, which is a different population and therefore
    // a different design.
    for (const [estimand, estimate] of [
      ["warning.recall", metrics.warning.endToEnd.recall],
      ["action.recall", metrics.actionAuthorization?.recall],
    ] as ReadonlyArray<readonly [string, MetricEstimate]>) {
      expect(estimate.method).toBe("hierarchical-cluster-percentile");
      expect(estimate.resampling?.estimand).toBe(estimand);
      expect(estimate.resampling?.axes).toEqual([
        "groups.generatorFamily",
        "groups.promptTemplate",
        "groups.generationBatch",
      ]);
    }
  });

  it("publishes the WIDER of the analytic and the resampled bound, with both", () => {
    // Perfect separation: not one false positive anywhere, so every replicate of
    // the FPR is 0 and the percentile "interval" is [0, 0] — the point twice, and
    // NARROWER than the analytic bound rather than more conservative. The published
    // upper bound is therefore the analytic one, and both are printed.
    const fpr = computeEvaluationMetrics(SEPARABLE, OPTIONS).warning.endToEnd
      .falsePositiveRate;
    expect(fpr.value).toBe(0);
    // The rule is READ from the frozen contract, not written down in the estimator.
    expect(fpr.boundEnvelope?.rule).toBe(
      PREREGISTRATION_V4.resampling.publishedBound,
    );
    expect(fpr.boundEnvelope?.resampled.upper).toBe(0);
    expect(fpr.boundEnvelope?.analytic.upper).toBeGreaterThan(0);
    expect(fpr.upper95).toBe(fpr.boundEnvelope?.analytic.upper);
    expect(fpr.boundEnvelope?.upperFrom).toBe("analytic");
    // Both limits are 0 on the lower side, and a tie is credited to the design that
    // ran rather than to the estimator that happens to agree with it.
    expect(fpr.boundEnvelope?.lowerFrom).toBe("resampled");
    // And the design is still named: the unit was resampled, its bound just lost
    // the comparison.
    expect(fpr.resampling?.axes).toEqual(["groups.author"]);
  });

  it("names the estimator behind the SIMULTANEOUS limit, which is the one a gate decides on", () => {
    // The 95% pair already said which estimator won. The simultaneous bound is the
    // only one a release gate reads, it keeps the percentile method name, and on a
    // zero-count rate its published limit is the analytic one — so the envelope has
    // to carry that pair too or the name would be the only thing a reader gets.
    const fpr = computeEvaluationMetrics(SEPARABLE, {
      ...OPTIONS,
      preRegisteredStatisticalGates: 8,
    }).warning.endToEnd.falsePositiveRate;
    const simultaneous = fpr.simultaneous;
    const envelope = fpr.boundEnvelope?.simultaneous;
    expect(simultaneous?.method).toBe("hierarchical-cluster-percentile");
    expect(envelope).not.toBeUndefined();
    expect(envelope?.resampled.method).toBe("hierarchical-cluster-percentile");
    expect(envelope?.analytic.method).toBe("wilson-one-sided");
    // Zero false positives: every replicate is 0, so the resampled bound at the
    // Bonferroni alpha is 0 too and the analytic one decides.
    expect(envelope?.resampled.upper).toBe(0);
    expect(envelope?.analytic.upper).toBeGreaterThan(0);
    expect(envelope?.upperFrom).toBe("analytic");
    expect(simultaneous?.upper).toBe(envelope?.analytic.upper);
    // Wider than the individual pair, because the alpha is.
    expect(simultaneous?.upper).toBeGreaterThan(
      fpr.boundEnvelope?.analytic.upper as number,
    );
  });

  it("takes the resampled bound when intra-cluster correlation makes it the wider one", () => {
    // Twelve source pools of five human rows each, and the whole pool agrees:
    // six pools are false positives outright, six are clean. The rate is 0.5 either
    // way, but the information is twelve independent units, not sixty, and the
    // analytic bound is the one that does not know it.
    const correlated = Array.from({ length: 12 }, (_, pool) =>
      Array.from({ length: 5 }, (_, row) =>
        item({
          author: `p${pool}-a${row}`,
          domainSource: `pool-${pool}`,
          label: "human",
          documentScore: pool % 2 === 0 ? 0.9 : 0.1,
          warned: pool % 2 === 0,
        }),
      ),
    ).flat();
    const fpr = computeEvaluationMetrics(correlated, OPTIONS).warning.endToEnd
      .falsePositiveRate;
    expect(fpr.value).toBeCloseTo(0.5, 12);
    const envelope = fpr.boundEnvelope;
    expect(envelope).not.toBeUndefined();
    expect(envelope?.resampled.upper).toBeGreaterThan(
      envelope?.analytic.upper as number,
    );
    expect(fpr.upper95).toBe(envelope?.resampled.upper);
    // The outer level IS the author now, so the count of drawn units is the number of
    // authors and not the number of strata: 60 authors over the correlated fixture.
    expect(fpr.resampling?.levels[0].levels).toBe(60);
  });

  it("bootstraps AUROC, PR-AUC, Brier and both ECEs over the unit their estimand declares", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    for (const [estimand, estimate] of [
      ["separability.auroc", metrics.separability.auroc],
      ["separability.prAuc", metrics.separability.prAuc],
      ["calibration.brier", metrics.calibration.brier],
      ["calibration.ece", metrics.calibration.eceEqualMass15],
      ["calibration.ece15", metrics.ece15],
    ] as ReadonlyArray<readonly [string, MetricEstimate]>) {
      expect(estimate.method).toBe("hierarchical-cluster-percentile");
      expect(estimate.lower95).toBeLessThanOrEqual(estimate.upper95 as number);
      // The point is bracketed to within summation noise, not exactly: the
      // replicate statistic sums per cluster in draw order while the exported
      // definition sums per row, and a percentile interval is under no obligation
      // to contain the point estimate in the first place.
      expect(estimate.lower95).toBeLessThanOrEqual(estimate.value + 1e-9);
      expect(estimate.upper95).toBeGreaterThanOrEqual(estimate.value - 1e-9);
      // Every published estimate NAMES its unit; none of them is implicit.
      expect(estimate.resampling?.estimand).toBe(estimand);
      expect(estimate.resampling?.method).toBe("hierarchical");
      expect(estimate.resampling?.axes).toEqual(["groups.author"]);
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
    expect(metrics.latency.scored).toMatchObject({
      sampleSize: 80,
      maxMs: 30,
    });
    expect(metrics.memory.sampleSize).toBe(80);
    expect(metrics.memory.maxBytes).toBe(3_000);
  });

  // The latency aggregate is the FOURTH door of the same §3.1 asymmetry, and the
  // one nothing guarded because latency was never a gate: a failed inference
  // reported `latencyMs: 0`, `0` is finite, and the aggregate filtered on
  // finiteness alone — so every failure pushed the mean, p50 and p95 of the
  // PUBLISHED latency down. The pair below mirrors what A3 fixed for the two
  // decision families: with failures present the scored block must DIFFER from
  // the pooled number, and with none it must COINCIDE with it.
  it("keeps failed and abstained rows out of the published latency aggregate", () => {
    const items = [
      ...SEPARABLE,
      item({ author: "u1", label: "human", status: "abstained", latencyMs: 3 }),
      item({ author: "u2", label: "human", status: "error", latencyMs: 0 }),
      item({ author: "u3", label: "human", status: "error", latencyMs: 1 }),
      item({ author: "u4", label: "human", status: "error", latencyMs: 2 }),
    ];

    const metrics = computeEvaluationMetrics(items, OPTIONS);

    expect(metrics.latency).toEqual({
      scored: {
        population: "scored",
        sampleSize: 80,
        meanMs: 20,
        p50Ms: 10,
        p95Ms: 30,
        maxMs: 30,
      },
      abstained: {
        population: "abstained",
        sampleSize: 1,
        meanMs: 3,
        p50Ms: 3,
        p95Ms: 3,
        maxMs: 3,
      },
      errored: {
        population: "error",
        sampleSize: 3,
        meanMs: 1,
        p50Ms: 1,
        p95Ms: 2,
        maxMs: 2,
      },
    });

    // The case is DISCRIMINATING: pooling the four undecided samples into the
    // published mean is what the defect did, and it lands below the scored mean.
    const pooledSamples = items
      .map((entry) => entry.latencyMs)
      .filter((value): value is number => value !== undefined);
    const pooledMean =
      pooledSamples.reduce((total, value) => total + value, 0) /
      pooledSamples.length;
    expect(pooledSamples).toHaveLength(84);
    expect(pooledMean).toBeLessThan(20);
  });

  it("publishes the scored latency aggregate over every sample when nothing failed", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    const pooledSamples = SEPARABLE.map((entry) => entry.latencyMs).filter(
      (value): value is number => value !== undefined,
    );
    const pooledMean =
      pooledSamples.reduce((total, value) => total + value, 0) /
      pooledSamples.length;

    expect(metrics.latency.scored?.sampleSize).toBe(pooledSamples.length);
    expect(metrics.latency.scored?.meanMs).toBe(pooledMean);
    // A block is `null` when the population is EMPTY, which cannot be read as a
    // latency of zero.
    expect(metrics.latency.abstained).toBeNull();
    expect(metrics.latency.errored).toBeNull();
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
    ).toEqual([...PREREGISTRATION_V4.predictiveValuePrevalences]);
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
    expect(long?.resamplingUnit?.units).toBe(1);
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
    expect(dateCutoff.resamplingUnit?.units).toBe(2);
    expect(dateCutoff.resamplingUnit?.axes).toEqual(["groups.author"]);
    expect(dateCutoff.resamplingUnit?.method).toBe("hierarchical");
    expect(dateCutoff.errored).toBe(1);
    expect(dateCutoff.falsePositiveRate.value).toBeCloseTo(0.5, 10);
    expect(dateCutoff.falsePositiveRate.upper95).toBeGreaterThan(0.5);
    expect(dateCutoff.errorRate.value).toBeCloseTo(1 / 3, 10);

    const observed = labelBasis.bases[1];
    expect(observed.count).toBe(2);
    expect(observed.resamplingUnit?.units).toBe(2);
    expect(observed.falsePositiveRate.value).toBe(0);
    // The two intervals are separate objects over separate denominators; the
    // pooled rate (1/5) appears nowhere as a basis-level claim.
    expect(observed.falsePositiveRate.upper95).not.toBe(
      dateCutoff.falsePositiveRate.upper95,
    );
  });

  it("marks an under-powered basis as supplementary diagnostic, and a powered one as gating", () => {
    const floor = PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives;
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
      PREREGISTRATION_V4.labelBasis.underPoweredRole,
    );
    expect(observed?.powerFloor).toBe(floor);
  });

  it("never lets the unknown basis become gating evidence, however many rows it holds", () => {
    // This is the case a real corpus hits TODAY: `labelBasis` only enters the
    // closed schema in C1, so every human negative lands in `unknown` — and a real
    // corpus has far more than the 300-row floor, so the count check alone would
    // wave it through. The basis guard is the only thing between a nonexistent
    // evidence basis and an approved FPR budget (R4/R6).
    const floor = PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives;
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
      PREREGISTRATION_V4.labelBasis.underPoweredRole,
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
      PREREGISTRATION_V4.multiplicity.familyAlpha,
    );
    expect(declaration?.descriptiveConfidence).toBe(
      PREREGISTRATION_V4.multiplicity.descriptiveConfidence,
    );
    expect(declaration?.m).toBe(8);
    expect(declaration?.perGateAlpha).toBeCloseTo(0.05 / 8, 12);

    const fpr = metrics.warning.endToEnd.falsePositiveRate;
    expect(fpr.simultaneous?.m).toBe(8);
    expect(fpr.simultaneous?.alpha).toBeCloseTo(0.05 / 8, 12);
    // Simultaneous coverage is never INSIDE the individual 95% interval. On the
    // gated rates it is not strictly outside either, and that is the percentile
    // estimator, not a bug: the replicate distribution has a finite maximum, so once
    // a replicate reaches 1 both bounds sit there and a wider alpha cannot move
    // further out. The strict version of the claim belongs to the analytic path.
    expect(fpr.simultaneous?.upper).toBeGreaterThanOrEqual(
      fpr.upper95 as number,
    );
    const recall = metrics.warning.endToEnd.recall;
    expect(recall.simultaneous?.lower).toBeLessThanOrEqual(
      recall.lower95 as number,
    );
    // Wilson, where the bound is a continuous function of alpha: strictly wider.
    expect(metrics.coverage.method).toBe("wilson-one-sided");
    expect(metrics.coverage.simultaneous?.lower).toBeLessThan(
      metrics.coverage.lower95 as number,
    );
    expect(metrics.errorRate.simultaneous?.upper).toBeGreaterThan(
      metrics.errorRate.upper95 as number,
    );
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
    const floor = PREREGISTRATION_V4.materialAssistance.minimumAiFraction;
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
    // The published mixed-recall block has the same denominator before and after.
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
    expect(PREREGISTRATION_V4.mixedBelowHalfAiRole).toBe(
      "diagnostic-curve-only",
    );
  });

  it("never lets material assistance raise the action ceiling above indicator", () => {
    expect(PREREGISTRATION_V4.materialAssistance.authorizes).toBe(
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
    expect(PREREGISTRATION_V4.materialAssistance.cohortsAggregated).toBe(false);
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
    expect(PREREGISTRATION_V4.localization.metricsRole).toBe("diagnostic");
    expect(PREREGISTRATION_V4.localization.authorizesVisualAction).toBe(false);

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

  // The OTHER side of the null: `spanProducer` is `!== undefined` and not
  // `length > 0` on purpose, because a span head that ran and emitted an empty
  // list is a producer whose zeros are a real, measured total miss. That
  // distinction is the entire basis of the test above, and until this test existed
  // NO assertion reached it: replacing `item.localizedSpans !== undefined` with
  // `(item.localizedSpans ?? []).length > 0` left the file at 58/58 green, and
  // nothing outside metrics.ts reads a localization cohort. The flip is not
  // cosmetic — under it the fixture below reports `spanProducer: "absent"`,
  // `localizedPathRecall: null`, `overlap: null`, i.e. a measured total
  // localization failure silently becomes "no measurement", in an EVALUATOR_FILES
  // member, in the direction that hides the failure.
  it("treats a producer that emitted an empty list as present, so its zeros stay a measurement", () => {
    const fixture = [
      item({ author: "h1", label: "human", documentScore: 0.1 }),
      // Both rows got a decision AND carry the field; the span head simply found
      // nothing in either. That is a detector result, not a missing stage.
      item({
        author: "m1",
        label: "mixed",
        aiFraction: 0.6,
        observedAiSpans: [{ start: 0, end: 10 }],
        localizedSpans: [],
        documentScore: 0.9,
        warned: true,
      }),
      item({
        author: "m2",
        label: "mixed",
        aiFraction: 0.6,
        observedAiSpans: [{ start: 0, end: 10 }],
        localizedSpans: [],
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

    expect(cohort?.spanProducer).toBe("present");
    expect(cohort?.endToEnd.population).toBe(2);
    expect(cohort?.endToEnd.localizedEmitted).toBe(0);
    // Zero, published — NOT null. Twenty observed characters, none of them found.
    expect(cohort?.endToEnd.localizedPathRecall?.value).toBe(0);
    expect(cohort?.endToEnd.localizedPathRecall).not.toBeNull();
    expect(cohort?.endToEnd.overlap).not.toBeNull();
    expect(cohort?.endToEnd.overlap?.microIou).toBe(0);
    expect(cohort?.endToEnd.overlap?.macroIou).toBe(0);
    expect(cohort?.endToEnd.overlap?.microTokenRecall).toBe(0);
    // Same statement in the conditional family: every row here is scored.
    expect(cohort?.conditionalOnScored.overlap?.microIou).toBe(0);
  });

  // Producer presence is a property of the RUN, and inferring it from a cohort's
  // scored rows re-created the very defect the family pair removed: a cohort whose
  // every row failed inference reported `"absent"` and null ratios while a producer
  // had emitted a span one cohort over, so 100% inference failure DELETED the
  // number instead of reading 0, and the published reason was false besides (R7).
  // MEASURED on the committed tree at f513ac8 with this exact fixture:
  // `{"mode":"ecological","spanProducer":"absent","e2ePopulation":2,
  // "e2eUndecided":2,"e2eRecall":null,"e2eOverlapNull":true}`.
  it("publishes the end-to-end zeros of an all-undecided cohort when the run has a producer", () => {
    const fixture = [
      item({ author: "h1", label: "human", documentScore: 0.1 }),
      // The producer's witness, in the OTHER cohort.
      item({
        author: "m1",
        label: "mixed",
        aiFraction: 0.6,
        observedAiSpans: [{ start: 0, end: 10 }],
        localizedSpans: [{ start: 0, end: 10 }],
        documentScore: 0.9,
        warned: true,
      }),
      // Two rows with observed spans that the pipeline never decided.
      item({
        author: "e1",
        label: "mixed",
        aiFraction: 0.6,
        generationMode: "ecological",
        observedAiSpans: [{ start: 0, end: 10 }],
        status: "error",
      }),
      item({
        author: "e2",
        label: "mixed",
        aiFraction: 0.6,
        generationMode: "ecological",
        observedAiSpans: [{ start: 0, end: 20 }],
        status: "error",
      }),
    ];

    const localization = computeEvaluationMetrics(
      fixture,
      OPTIONS,
    ).localization;
    const ecological = localization.byGenerationMode.find(
      (entry) => entry.generationMode === "ecological",
    );

    // The run has a producer, so this cohort's silence is measurable silence.
    expect(ecological?.spanProducer).toBe("present");
    expect(ecological?.endToEnd.population).toBe(2);
    expect(ecological?.endToEnd.undecidedRows).toBe(2);
    expect(ecological?.endToEnd.localizedEmitted).toBe(0);
    expect(ecological?.endToEnd.localizedPathRecall?.value).toBe(0);
    expect(ecological?.endToEnd.overlap).not.toBeNull();
    expect(ecological?.endToEnd.overlap?.microIou).toBe(0);
    expect(ecological?.endToEnd.overlap?.microTokenRecall).toBe(0);
    // The conditional family is null for a DIFFERENT reason — it has no row —
    // which is why the two nulls must not be spelled the same way.
    expect(ecological?.conditionalOnScored.population).toBe(0);
    expect(ecological?.conditionalOnScored.localizedPathRecall).toBeNull();
    expect(ecological?.conditionalOnScored.overlap).toBeNull();

    // One derivation, handed down: every cohort of one artifact says the same
    // thing about the producer, because the producer is not a cohort property.
    expect(
      localization.byGenerationMode.map((cohort) => cohort.spanProducer),
    ).toEqual(["present", "present"]);

    // And every published family's stated denominator rule agrees with its own
    // family label, for both cohorts — `populationRule` is derived from `family`
    // rather than passed beside it, so the pair cannot be built mismatched.
    expect(
      localization.byGenerationMode.flatMap((cohort) =>
        [cohort.endToEnd, cohort.conditionalOnScored].map((family) => [
          family.family,
          family.populationRule,
        ]),
      ),
    ).toEqual([
      ["end-to-end", "cohort-rows-with-observed-spans"],
      ["conditional-on-scored", "scored-cohort-rows-with-observed-spans"],
      ["end-to-end", "cohort-rows-with-observed-spans"],
      ["conditional-on-scored", "scored-cohort-rows-with-observed-spans"],
    ]);
  });

  // The third state. `"absent"` is a claim with a witness — a row that GOT a
  // decision and carried no span field. A run that decided nothing has no such
  // witness, so blaming an absent producer would be a false reason under R7.
  it("declares the producer undeterminable when the run produced no decision at all", () => {
    const fixture = [
      item({ author: "h1", label: "human", status: "error" }),
      item({
        author: "m1",
        label: "mixed",
        aiFraction: 0.6,
        observedAiSpans: [{ start: 0, end: 10 }],
        status: "error",
      }),
      item({
        author: "m2",
        label: "mixed",
        aiFraction: 0.6,
        observedAiSpans: [{ start: 0, end: 20 }],
        status: "error",
      }),
    ];

    const cohort = computeEvaluationMetrics(
      fixture,
      OPTIONS,
    ).localization.byGenerationMode.find(
      (entry) => entry.generationMode === "mechanistic",
    );

    expect(cohort?.spanProducer).toBe("undeterminable");
    // The counts still say how much span evidence is waiting.
    expect(cohort?.endToEnd.population).toBe(2);
    expect(cohort?.endToEnd.undecidedRows).toBe(2);
    // But there is no producer to charge the misses to, so no ratio is published.
    expect(cohort?.endToEnd.localizedPathRecall).toBeNull();
    expect(cohort?.endToEnd.overlap).toBeNull();
  });

  // Requisito 2 of the B2 brief asks for the v0-v8 curve as the diagnostic beside
  // the material-assistance recall. `mixed.byFraction` is NOT that curve: it is a
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

  // The legacy row type REQUIRES a score, so it cannot represent an abstention or
  // a failure at all. That is why its latency block is scored-only, and the block
  // says so on itself instead of leaving the population to be assumed (R7).
  it("names the population of the latency block it publishes", () => {
    const metrics = computeBinaryMetrics(
      [
        prediction("ai", 0.9, { latencyMs: 30 }),
        prediction("human", 0.1, { latencyMs: 10 }),
      ],
      { blockThreshold: 0.5 },
    );

    expect(metrics.latency).toEqual({
      population: "scored",
      sampleSize: 2,
      meanMs: 20,
      p50Ms: 10,
      p95Ms: 30,
      maxMs: 30,
    });
  });
});

describe("sizeBucket", () => {
  it.each([
    [50, "50_79"],
    [79, "50_79"],
    [80, "80_149"],
    [100, "80_149"],
    [149, "80_149"],
    [150, "150_299"],
    [299, "150_299"],
    [300, "300_PLUS"],
    [5000, "300_PLUS"],
  ] as const)("maps %i words to %s", (words, bucket) => {
    expect(sizeBucket(words)).toBe(bucket);
  });

  // A row the measurement abstains on belongs to no band, so it appears in no table
  // keyed by band. The pre-registration refuses a first band below the abstain floor,
  // and this is the runtime half of the same rule.
  it.each([0, 1, 49] as const)(
    "gives %i words no band at all, because the first band starts at the abstain floor",
    (words) => {
      expect(sizeBucket(words)).toBeUndefined();
    },
  );

  // The edges are NOT literals here: they are read back off the frozen policy, so a
  // band edge moved in the JSON and not here cannot leave this pin green.
  it("reads its edges from the pre-registered bands and nowhere else", () => {
    const bands = PREREGISTRATION_V4.lengthBands.bands;
    expect(bands.map((band) => band.key)).toEqual([
      "50_79",
      "80_149",
      "150_299",
      "300_PLUS",
    ]);
    for (const band of bands) {
      expect(sizeBucket(band.minimumWords)).toBe(band.key);
      if (band.maximumWords !== null) {
        expect(sizeBucket(band.maximumWords)).toBe(band.key);
        expect(sizeBucket(band.maximumWords + 1)).not.toBe(band.key);
      }
    }
    expect(sizeBucket(bands[0].minimumWords - 1)).toBeUndefined();
    // And the wiring: `sizeBucket` is the shipped bands applied to the same derivation
    // exercised below, at every edge and one word either side of it.
    for (const band of bands) {
      for (const words of [
        band.minimumWords - 1,
        band.minimumWords,
        band.minimumWords + 1,
      ]) {
        expect(sizeBucket(words)).toBe(lengthBandKeyOf(bands, words));
      }
    }
  });

  // The assertion above cannot, on its own, tell a function that READS the policy from
  // one whose edges happen to be the same literals — against one band list the two
  // agree everywhere. So the derivation is exercised against a band list that is NOT the
  // shipped one, where a literal implementation answers 89 with the wrong band.
  it("follows the edges of a band list that is not the shipped one", () => {
    const moved: LengthBandRow[] = [
      {
        key: "50_89",
        minimumWords: 50,
        maximumWords: 89,
        expectedBlindBlockLines: 400,
        diagnosticCeilingAtExpectedLines: 0.010_9,
      },
      {
        key: "90_PLUS",
        minimumWords: 90,
        maximumWords: null,
        expectedBlindBlockLines: 400,
        diagnosticCeilingAtExpectedLines: 0.010_9,
      },
    ];
    expect(lengthBandKeyOf(moved, 49)).toBeUndefined();
    expect(lengthBandKeyOf(moved, 50)).toBe("50_89");
    // 89 is inside the shipped 80_149 and inside this list's FIRST band: the one word
    // count that separates reading the edges from copying them.
    expect(lengthBandKeyOf(moved, 89)).toBe("50_89");
    expect(sizeBucket(89)).toBe("80_149");
    expect(lengthBandKeyOf(moved, 90)).toBe("90_PLUS");
    expect(lengthBandKeyOf(moved, 5000)).toBe("90_PLUS");
    // A floor of its own, too: the abstain edge is the list's, not a constant.
    const raised = moved.map((band) =>
      band.key === "50_89" ? { ...band, minimumWords: 60 } : band,
    );
    expect(lengthBandKeyOf(raised, 59)).toBeUndefined();
    expect(lengthBandKeyOf(raised, 60)).toBe("50_89");
  });
});

// --- FPR by pre-registered length band (X1) ---------------------------------
//
// The reason the block exists: short text probably FLATTERS the rate, so a single
// ceiling over the whole cell can be honest and still not TRANSFER to the reader who
// scores 600 words. These tests hold the two properties that make the table readable —
// the n of every band is published, and a band with no rows is published as empty
// rather than dropped.
describe("lengthBands diagnostic", () => {
  const bandKeys = PREREGISTRATION_V4.lengthBands.bands.map((band) => band.key);

  it("publishes one row per pre-registered band, in the pre-registered order", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    expect(metrics.lengthBands.role).toBe("diagnostic");
    expect(metrics.lengthBands.gates).toBe(false);
    expect(metrics.lengthBands.spendsAlpha).toBe(false);
    expect(metrics.lengthBands.bands.map((band) => band.key)).toEqual(bandKeys);
  });

  // A band the corpus never filled is exactly where a vanished row misleads: the
  // reader cannot tell "no false positives here" from "nothing was measured here".
  it("publishes an empty band as empty instead of dropping it", () => {
    const metrics = computeEvaluationMetrics(SEPARABLE, OPTIONS);
    // Every SEPARABLE row is 120 words, so three of the four bands hold nothing. The
    // EMPTY ones are named here rather than filtered out of the assertion: a loop over
    // the published rows that skips the filled band asserts nothing at all once the
    // empty rows are dropped, so it would pass on exactly the defect it is about.
    const emptyKeys = bandKeys.filter((key) => key !== "80_149");
    expect(emptyKeys).toHaveLength(3);
    const byKey = new Map(
      metrics.lengthBands.bands.map((band) => [band.key, band]),
    );
    expect([...byKey.keys()]).toEqual(bandKeys);
    for (const key of emptyKeys) {
      const band = byKey.get(key);
      expect(band, `band ${key} disappeared from the table`).toBeDefined();
      expect(band?.humanNegatives).toBe(0);
      expect(band?.decidedNegatives).toBe(0);
      expect(band?.falsePositives).toBe(0);
      // NULL, never 0: zero of zero is not a rate, and publishing it as one turns an
      // unmeasured band into a perfect one.
      expect(band?.falsePositiveRate).toBeNull();
    }
    expect(byKey.get("80_149")?.humanNegatives).toBeGreaterThan(0);
  });

  it("counts the human negatives, the decided subset and the false positives of each band", () => {
    const items = [
      // 50_79: two negatives, one of them warned.
      item({
        author: "s1",
        label: "human",
        wordCount: 60,
        documentScore: 0.9,
        warned: true,
      }),
      item({
        author: "s2",
        label: "human",
        wordCount: 79,
        documentScore: 0.1,
        warned: false,
      }),
      // 80_149: two negatives, one errored, so it is in the band and in no decision.
      item({
        author: "m1",
        label: "human",
        wordCount: 80,
        documentScore: 0.1,
        warned: false,
      }),
      item({ author: "m2", label: "human", wordCount: 149, status: "error" }),
      // 300_PLUS: one negative, not warned.
      item({
        author: "l1",
        label: "human",
        wordCount: 900,
        documentScore: 0.1,
        warned: false,
      }),
      // An AI positive is not a negative and never enters the denominator.
      item({
        author: "p1",
        label: "ai",
        wordCount: 60,
        documentScore: 0.9,
        warned: true,
      }),
    ];
    const bands = computeEvaluationMetrics(items, OPTIONS).lengthBands.bands;
    const byKey = new Map(bands.map((band) => [band.key, band]));
    expect(byKey.get("50_79")).toMatchObject({
      humanNegatives: 2,
      decidedNegatives: 2,
      falsePositives: 1,
      falsePositiveRate: 0.5,
    });
    // The errored row stays in `humanNegatives` and leaves the FPR denominator: it is
    // neither an accusation nor a correct clearance.
    expect(byKey.get("80_149")).toMatchObject({
      humanNegatives: 2,
      decidedNegatives: 1,
      falsePositives: 0,
      falsePositiveRate: 0,
    });
    expect(byKey.get("150_299")).toMatchObject({
      humanNegatives: 0,
      falsePositiveRate: null,
    });
    expect(byKey.get("300_PLUS")).toMatchObject({
      humanNegatives: 1,
      decidedNegatives: 1,
      falsePositives: 0,
    });
  });

  // The whole point of the table: a rate that is low in the short band and high in the
  // long one is a rate that does not transfer, and the aggregate hides it.
  it("separates a rate the aggregate averages away", () => {
    const items = [
      ...Array.from({ length: 10 }, (_, index) =>
        item({
          author: `s${index}`,
          label: "human",
          wordCount: 60,
          documentScore: 0.1,
          warned: false,
        }),
      ),
      ...Array.from({ length: 10 }, (_, index) =>
        item({
          author: `l${index}`,
          label: "human",
          wordCount: 900,
          documentScore: 0.9,
          warned: true,
        }),
      ),
    ];
    const metrics = computeEvaluationMetrics(items, OPTIONS);
    const byKey = new Map(
      metrics.lengthBands.bands.map((band) => [band.key, band]),
    );
    expect(metrics.warning.endToEnd.falsePositiveRate.value).toBeCloseTo(
      0.5,
      6,
    );
    expect(byKey.get("50_79")?.falsePositiveRate).toBe(0);
    expect(byKey.get("300_PLUS")?.falsePositiveRate).toBe(1);
  });

  // A row under the abstain floor is not eligible, so it reaches no band. The floor is
  // the pre-registration's, and the band table may not name a population under it.
  it("leaves a row below the abstain floor out of every band", () => {
    const items = [
      item({
        author: "tiny",
        label: "human",
        wordCount: 10,
        documentScore: 0.9,
        warned: true,
      }),
      item({
        author: "ok",
        label: "human",
        wordCount: 60,
        documentScore: 0.1,
        warned: false,
      }),
    ];
    const bands = computeEvaluationMetrics(items, OPTIONS).lengthBands.bands;
    expect(bands.reduce((total, band) => total + band.humanNegatives, 0)).toBe(
      1,
    );
    expect(bands.find((band) => band.key === "50_79")?.humanNegatives).toBe(1);
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
