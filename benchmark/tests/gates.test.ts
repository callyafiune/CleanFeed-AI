import { describe, expect, it } from "vitest";

import {
  evaluateReleaseGates,
  type GateInput,
  type GateResult,
  type IntegrityEvidence,
  type ResamplingPlan,
} from "../gates.ts";
import { computeEvaluationMetrics } from "../metrics.ts";
import type {
  DecisionFamilies,
  DecisionMetrics,
  EvaluationItem,
  EvaluationMetrics,
  LabelBasisSlice,
  MetricEstimate,
} from "../metrics.ts";
import { REBUILD_V3_POLICY } from "../rebuild-v3-policy.ts";
import type { BenchmarkRecord } from "../schema.ts";
import type { SliceAxis, SliceResult, SliceSummary } from "../slices.ts";

// --- fixture builders ------------------------------------------------------

// The FPR gates read the SIMULTANEOUS upper bound and the recall gates the
// simultaneous lower bound; the individual 95% bounds stay in the estimate as the
// descriptive interval. `upper`/`lower` set both to the same number so a fixture
// reads like the budget it means; `splitBound` sets them apart, which is how a
// test proves which one the verdict used.
const M = 40;

function simultaneousBound(
  lowerBound: number,
  upperBound: number,
): NonNullable<MetricEstimate["simultaneous"]> {
  return {
    correction: "bonferroni",
    familyAlpha: 0.05,
    m: M,
    alpha: 0.05 / M,
    z: 3.2,
    lower: lowerBound,
    upper: upperBound,
    method: "wilson-one-sided",
  };
}

function upper(bound: number): MetricEstimate {
  return {
    value: bound,
    lower95: 0,
    upper95: bound,
    method: "wilson-one-sided",
    simultaneous: simultaneousBound(0, bound),
  };
}
function lower(bound: number): MetricEstimate {
  return {
    value: bound,
    lower95: bound,
    upper95: 1,
    method: "wilson-one-sided",
    simultaneous: simultaneousBound(bound, 1),
  };
}
// An estimate whose individual 95% bound and whose simultaneous bound disagree.
function splitBound(
  individual: { lower95: number; upper95: number },
  wide: { lower: number; upper: number },
): MetricEstimate {
  return {
    value: individual.upper95,
    lower95: individual.lower95,
    upper95: individual.upper95,
    method: "wilson-one-sided",
    simultaneous: simultaneousBound(wide.lower, wide.upper),
  };
}
// An estimate with no simultaneous bound: the metrics were computed without a
// declared `m`, so no gate may read them.
function withoutSimultaneous(bound: number): MetricEstimate {
  return {
    value: bound,
    lower95: 0,
    upper95: bound,
    method: "wilson-one-sided",
  };
}
function point(value: number): MetricEstimate {
  return { value, method: "point" };
}

// The same estimate as a RESAMPLED bound: the ECE gate reads a percentile of a
// cluster bootstrap, not an analytic Wilson bound, and a percentile carries the
// number of replicates it was read from. `"undeclared"` is a bound that never said
// what its effort was — a literal, not `undefined`, because `undefined` would just
// select the default parameter.
const PILOT_REPLICATES = REBUILD_V3_POLICY.bootstrapReplicates.pilot;

function resampled(
  estimate: MetricEstimate,
  replicates: number | "undeclared" = PILOT_REPLICATES,
): MetricEstimate {
  const simultaneous = estimate.simultaneous;
  if (simultaneous === undefined) {
    throw new Error(
      "resampled() needs an estimate that has a bound to decorate",
    );
  }
  // No `z`: a percentile bound reads order statistics and has no critical value.
  const percentile: NonNullable<MetricEstimate["simultaneous"]> = {
    ...simultaneous,
    method: "author-cluster-percentile",
    ...(replicates === "undeclared"
      ? {}
      : {
          replicates,
          tailReplicates: Math.floor(simultaneous.alpha * (replicates - 1)),
        }),
  };
  delete percentile.z;
  return { ...estimate, simultaneous: percentile };
}

// A valid synthetic C4 plan: one entry per estimand the gates measure, with a
// hierarchical unit and the pre-registered pilot replicate count.
const ESTIMANDS = [
  "warning.fpr",
  "warning.fpr.slice",
  "warning.fpr.labelBasis",
  "warning.recall",
  "calibration.ece",
  "action.fpr",
  "action.fpr.slice",
  "action.fpr.labelBasis",
  "action.recall",
] as const;

function plan(overrides: Partial<ResamplingPlan> = {}): ResamplingPlan {
  return {
    planId: "synthetic-c4-plan",
    source: "synthetic",
    entries: ESTIMANDS.map((estimand) => ({
      estimand,
      unitKind: "hierarchical" as const,
      unitAxes: ["groups.author", "groups.nearDuplicate"],
      replicates: REBUILD_V3_POLICY.bootstrapReplicates.pilot,
    })),
    ...overrides,
  };
}

function decision(
  fpr: MetricEstimate,
  recall: MetricEstimate,
  positives = 500,
  negatives = 2_000,
): DecisionMetrics {
  return {
    family: "end-to-end",
    sampleSize: positives + negatives,
    positives,
    negatives,
    truePositives: positives,
    falsePositives: 0,
    trueNegatives: negatives,
    falseNegatives: 0,
    undecidedPositives: 0,
    undecidedNegatives: 0,
    falsePositiveRate: fpr,
    clearanceRate: point(1),
    recall,
    precision: point(1),
  };
}

// The gates read the end-to-end family; these fixtures have no failed inference,
// so the conditional family is the same matrix under its own role name.
function families(metrics: DecisionMetrics): DecisionFamilies {
  return {
    endToEnd: metrics,
    conditionalOnScored: { ...metrics, family: "conditional-on-scored" },
  };
}

interface MetricsOverrides {
  warningFpr?: MetricEstimate;
  warningRecall?: MetricEstimate;
  visual?: { fpr: MetricEstimate; recall: MetricEstimate } | null;
  coverage?: number;
  ece?: MetricEstimate;
  errorRate?: number;
  mixed?: {
    sampleSize: number;
    warningRecall: number;
    warningRecallLower95: number;
  };
  auroc?: number;
  declaredM?: number | null;
  labelBases?: LabelBasisSlice[];
}

// One scored human negative with NO `labelBasis` field, which is every human
// negative the corpus has until C1 adds the field to the closed schema. Built
// here rather than imported so the gate test can feed the REAL metrics pipeline.
function humanNegativeWithoutBasis(author: string): EvaluationItem {
  return {
    record: {
      label: "human",
      language: "pt-BR",
      wordCount: 120,
      domain: "corporate",
      platform: "generic-platform",
      provenance: { sourceId: "ptwiki" },
      createdAt: 1_000,
      transformation: { kind: "none", severity: "none" },
      groups: { author },
    } as unknown as BenchmarkRecord,
    status: "scored",
    documentScore: 0.1,
    warned: false,
    visualActioned: false,
  };
}

// One human-negative label basis. `powered` decides whether it may gate at all.
function basis(
  key: LabelBasisSlice["basis"],
  options: {
    count: number;
    powered: boolean;
    fprUpper?: number;
    // Scored negatives, i.e. the DENOMINATOR of the basis FPR. Defaults to the
    // whole count; a run with failed inferences has fewer.
    scored?: number;
  },
): LabelBasisSlice {
  const scored = options.scored ?? options.count;
  return {
    basis: key,
    count: options.count,
    scored,
    errored: options.count - scored,
    samplingUnits: options.count,
    samplingUnitAxis: "groups.author",
    powered: options.powered,
    powerFloor: REBUILD_V3_POLICY.powerFloors.criticalFprHumanNegatives,
    evidenceRole: options.powered ? "gating" : "supplementary-diagnostic",
    falsePositiveRate: upper(options.fprUpper ?? 0.01),
    errorRate: upper(0),
    brier: 0.05,
    logLoss: 0.2,
    eceEqualMass: 0.02,
  };
}

// Only the fields the gate policy consumes are populated; the remainder of
// EvaluationMetrics is irrelevant to the gates and elided behind the cast.
function metrics(overrides: MetricsOverrides = {}): EvaluationMetrics {
  const visual =
    overrides.visual === undefined
      ? { fpr: upper(0.01), recall: lower(0.5) }
      : overrides.visual;
  const declaredM = overrides.declaredM === undefined ? M : overrides.declaredM;
  return {
    warning: families(
      decision(
        overrides.warningFpr ?? upper(0.02),
        overrides.warningRecall ?? lower(0.75),
      ),
    ),
    visualAction:
      visual === null ? null : families(decision(visual.fpr, visual.recall)),
    coverage: point(overrides.coverage ?? 0.95),
    ece15: point(0.02),
    calibration: {
      role: "diagnostic",
      gatedStatistic: "eceEqualMass15",
      population: "conditional-on-scored",
      // The ECE runs over the scored rows of the binary population, which is
      // smaller than the population itself whenever an inference failed.
      scored: 1_800,
      populationSize: 2_000,
      eceEqualMass15: overrides.ece ?? resampled(upper(0.02)),
    },
    labelBasis: {
      role: "human-negative-label-evidence",
      fieldPresent: true,
      pooledClaimAllowed: false,
      bases: overrides.labelBases ?? [
        basis("date-cutoff", { count: 1_000, powered: true }),
      ],
    },
    multiplicity:
      declaredM === null
        ? null
        : {
            correction: "bonferroni",
            familyAlpha: 0.05,
            descriptiveConfidence: 0.95,
            m: declaredM,
            perGateAlpha: 0.05 / declaredM,
            z: 3.2,
          },
    errorRate: point(overrides.errorRate ?? 0.001),
    separability: { role: "diagnostic", auroc: point(overrides.auroc ?? 0.99) },
    mixed: {
      atLeastHalfAi: overrides.mixed ?? {
        sampleSize: 100,
        warningRecall: 0.8,
        warningRecallLower95: 0.72,
      },
    },
  } as unknown as EvaluationMetrics;
}

interface SliceOverrides {
  axis?: SliceAxis;
  key: string;
  negatives?: number;
  positives?: number;
  fprGateEligible?: boolean;
  recallGateEligible?: boolean;
  warningFprUpper?: number;
  actionFprUpper?: number;
}

function slice(overrides: SliceOverrides): SliceResult {
  const negatives = overrides.negatives ?? 0;
  const positives = overrides.positives ?? 0;
  return {
    axis: overrides.axis ?? "domain",
    key: overrides.key,
    sampleSize: negatives + positives,
    positives,
    negatives,
    fprGateEligible: overrides.fprGateEligible ?? false,
    recallGateEligible: overrides.recallGateEligible ?? false,
    metrics: {
      warning: families(
        decision(upper(overrides.warningFprUpper ?? 0.01), lower(0.75)),
      ),
      visualAction: families(
        decision(upper(overrides.actionFprUpper ?? 0.005), lower(0.5)),
      ),
    } as unknown as EvaluationMetrics,
  };
}

function summary(slices: SliceResult[]): SliceSummary {
  return {
    slices,
    macro: {
      warningFpr: 0,
      warningRecall: 0,
      actionFpr: null,
      actionRecall: null,
    },
    worst: {},
  };
}

function integrity(
  overrides: Partial<IntegrityEvidence> = {},
): IntegrityEvidence {
  return {
    scientificUse: "release",
    licenseInventoryComplete: true,
    reviewLedgerHashMatches: true,
    sourceManifestHashMatches: true,
    datasetAuditSealed: true,
    sourceReadinessReady: true,
    schemaValid: true,
    datasetDigestMatches: true,
    splitDigestMatches: true,
    evaluatorDigestMatches: true,
    calibrationDigestMatches: true,
    splitAuditPassed: true,
    predictionCompleteness: true,
    predictionManifestDigestsMatch: true,
    runtimeIdentityUnique: true,
    holdoutSessionActive: true,
    ...overrides,
  };
}

// A single adequately-sampled critical FPR slice that passes both budgets.
function passingSlice(): SliceResult {
  return slice({
    axis: "domain",
    key: "corporate",
    negatives: 400,
    positives: 400,
    fprGateEligible: true,
    recallGateEligible: true,
    warningFprUpper: 0.02,
    actionFprUpper: 0.01,
  });
}

function gateById(gates: readonly GateResult[], id: string): GateResult {
  const found = gates.find((gate) => gate.id === id);
  if (found === undefined) throw new Error(`no gate ${id}`);
  return found;
}

// --- the plan's decision table --------------------------------------------

const passingEvidence: GateInput = {
  integrity: integrity(),
  resampling: plan(),
  metrics: metrics(),
  slices: summary([passingSlice()]),
};

const actionFprFailure: GateInput = {
  integrity: integrity(),
  resampling: plan(),
  // Warning FPR still under 5%, but the visual-action matrix breaks the 2% budget.
  metrics: metrics({ visual: { fpr: upper(0.03), recall: lower(0.5) } }),
  slices: summary([passingSlice()]),
};

const actionSampleGap: GateInput = {
  integrity: integrity(),
  resampling: plan(),
  metrics: metrics(),
  slices: summary([
    passingSlice(),
    // A critical FPR slice under the 300-negative floor: it never gates the
    // warning budget, but it cannot authorize visual action.
    slice({
      axis: "domain",
      key: "legal",
      negatives: 299,
      fprGateEligible: false,
      warningFprUpper: 0.02,
      actionFprUpper: 0.01,
    }),
  ]),
};

const warningFprFailure: GateInput = {
  integrity: integrity(),
  resampling: plan(),
  metrics: metrics({ warningFpr: upper(0.08) }),
  slices: summary([passingSlice()]),
};

const incompletePredictions: GateInput = {
  integrity: integrity({ predictionCompleteness: false }),
  resampling: plan(),
  metrics: metrics(),
  slices: summary([passingSlice()]),
};

const lowCoverage: GateInput = {
  integrity: integrity(),
  resampling: plan(),
  metrics: metrics({ coverage: 0.5 }),
  slices: summary([passingSlice()]),
};

describe("release decision", () => {
  it.each([
    ["all gates pass", passingEvidence, "pass"],
    ["warning passes but action FPR fails", actionFprFailure, "indicator-only"],
    [
      "warning passes but an action slice lacks 300 negatives",
      actionSampleGap,
      "indicator-only",
    ],
    ["warning FPR fails", warningFprFailure, "reject"],
    ["prediction completeness fails", incompletePredictions, "reject"],
    ["coverage falls below 80%", lowCoverage, "reject"],
  ] as const)("%s -> %s", (_name, evidence, expected) => {
    expect(evaluateReleaseGates(evidence).decision).toBe(expected);
  });
});

// --- teeth: every branch tripped by exactly one breach ---------------------

describe("gate thresholds match the §6.5 table", () => {
  it("wires each gate to its bound, operator and threshold", () => {
    const report = evaluateReleaseGates(passingEvidence);
    const fpr = gateById(report.gates, "warning.fpr.overall");
    // The verdict reads the SIMULTANEOUS bound (A6); the individual 95% bound is
    // still published beside it, marked descriptive.
    expect(fpr).toMatchObject({
      tier: "warning",
      scope: "overall",
      bound: "simultaneous-upper",
      operator: "<=",
      required: REBUILD_V3_POLICY.fprBudgets.warning,
      evidence: "present",
      descriptive: { bound: "upper95", confidence: 0.95, role: "descriptive" },
    });
    expect(gateById(report.gates, "action.fpr.overall")).toMatchObject({
      bound: "simultaneous-upper",
      operator: "<=",
      required: REBUILD_V3_POLICY.fprBudgets.visualAction,
    });
    expect(gateById(report.gates, "warning.recall.overall")).toMatchObject({
      bound: "simultaneous-lower",
      operator: ">=",
      required: 0.6,
    });
    expect(gateById(report.gates, "action.recall.overall")).toMatchObject({
      bound: "simultaneous-lower",
      operator: ">=",
      required: 0.35,
    });
    expect(gateById(report.gates, "warning.coverage")).toMatchObject({
      operator: ">=",
      required: 0.8,
    });
    expect(gateById(report.gates, "warning.calibration-ece")).toMatchObject({
      operator: "<=",
      required: REBUILD_V3_POLICY.calibrationGate.eceMax,
      bound: "simultaneous-upper",
      estimand: "calibration.ece",
    });
    // The frozen contract names the bound this gate reads, and it names the one
    // the gate actually read: a Bonferroni percentile, not the individual 95%.
    expect(REBUILD_V3_POLICY.calibrationGate.eceBound).toBe(
      "bootstrap-simultaneous-upper",
    );
    expect(gateById(report.gates, "warning.mixed-recall")).toMatchObject({
      operator: ">=",
      required: 0.5,
    });
  });

  it("reports the denominator of the statistic it decided, not a wider population", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({
        labelBases: [
          // 900 human negatives of which 850 got a score: the FPR has 850 in its
          // denominator and the power floor is measured on the 900.
          basis("date-cutoff", { count: 900, powered: true, scored: 850 }),
        ],
      }),
      slices: summary([passingSlice()]),
    });

    const ece = gateById(report.gates, "warning.calibration-ece");
    expect(ece.sampleSize).toBe(1_800);
    expect(ece.populationSize).toBe(2_000);

    const labelBasis = gateById(
      report.gates,
      "warning.fpr.labelBasis.date-cutoff",
    );
    expect(labelBasis.sampleSize).toBe(850);
    expect(labelBasis.populationSize).toBe(900);

    // Where the two coincide, only the one number is published.
    const fpr = gateById(report.gates, "warning.fpr.overall");
    expect(fpr.sampleSize).toBe(2_000);
    expect(fpr.populationSize).toBeUndefined();
  });

  it("passes cleanly with empty failure lists and structured gates", () => {
    const report = evaluateReleaseGates(passingEvidence);
    expect(report.decision).toBe("pass");
    expect(report.failedIntegrity).toEqual([]);
    expect(report.failedWarning).toEqual([]);
    expect(report.failedAction).toEqual([]);
    for (const gate of report.gates) {
      expect(gate.passed).toBe(true);
      expect(gate.reasons).toEqual([]);
      expect(typeof gate.id).toBe("string");
    }
  });
});

describe("warning tier teeth", () => {
  it("rejects when an eligible critical slice breaches the 5% warning budget", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics(),
      slices: summary([
        slice({
          axis: "hardNegativeFamily",
          key: "citation-heavy",
          negatives: 500,
          fprGateEligible: true,
          warningFprUpper: 0.09,
          actionFprUpper: 0.01,
        }),
      ]),
    });
    expect(report.decision).toBe("reject");
    const gate = gateById(
      report.gates,
      "warning.fpr.slice.hardNegativeFamily.citation-heavy",
    );
    expect(gate).toMatchObject({
      tier: "warning",
      scope: "slice",
      slice: { axis: "hardNegativeFamily", key: "citation-heavy" },
      bound: "simultaneous-upper",
      required: 0.05,
      eligible: true,
      passed: false,
    });
    expect(gate.observed).toBeCloseTo(0.09, 10);
    expect(gate.reasons[0]).toMatch(/exceeds 0\.05/u);
  });

  it("rejects on a warning recall shortfall", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({ warningRecall: lower(0.5) }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    expect(report.failedWarning).toContain("warning.recall.overall");
  });

  it("rejects on the equal-mass ECE interval, never on its point estimate", () => {
    // The point estimate sits comfortably inside the budget and the interval does
    // not. Before A6 this gate read the point and passed.
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({
        ece: resampled(
          splitBound(
            { lower95: 0.02, upper95: 0.04 },
            { lower: 0.02, upper: 0.09 },
          ),
        ),
      }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    expect(report.failedWarning).toContain("warning.calibration-ece");
    const gate = gateById(report.gates, "warning.calibration-ece");
    expect(gate.observed).toBeCloseTo(0.09, 10);
    expect(gate.descriptive).toMatchObject({
      bound: "upper95",
      value: 0.04,
      role: "descriptive",
    });
  });

  it("fails the ECE gate when no interval was produced at all", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({ ece: withoutSimultaneous(0.01) }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    const gate = gateById(report.gates, "warning.calibration-ece");
    expect(gate.passed).toBe(false);
    expect(gate.evidence).toBe("missing-simultaneous-interval");
    expect(gate.observed).toBeNull();
  });

  it("fails the ECE gate when the percentile bound came from fewer replicates than the frozen count", () => {
    // A comfortable point estimate AND a comfortable bound, refused on effort:
    // read at alpha_family/40 = 0.00125, 2000 replicates leave two order
    // statistics beyond the bound. The frozen contract pre-registers 10.000 and
    // says never to reduce the count, so this is missing evidence.
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({ ece: resampled(upper(0.01), 2_000) }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    const gate = gateById(report.gates, "warning.calibration-ece");
    expect(gate.evidence).toBe("insufficient-resampling-effort");
    expect(gate.passed).toBe(false);
    // No number is published as the verdict: a bound that thin decides nothing.
    expect(gate.observed).toBeNull();
    expect(gate.reasons[0]).toMatch(/2000 réplicas/u);
    expect(gate.reasons[0]).toMatch(String(PILOT_REPLICATES));
    // The 95% interval stays in the report, still marked descriptive.
    expect(gate.descriptive).toMatchObject({
      value: 0.01,
      role: "descriptive",
    });
  });

  it("fails the ECE gate when the percentile bound never says how many replicates produced it", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({ ece: resampled(upper(0.01), "undeclared") }),
      slices: summary([passingSlice()]),
    });
    const gate = gateById(report.gates, "warning.calibration-ece");
    expect(gate.evidence).toBe("insufficient-resampling-effort");
    expect(gate.passed).toBe(false);
    expect(gate.reasons[0]).toMatch(/réplicas/u);
  });

  it("leaves the analytic Wilson bounds alone: they resample nothing", () => {
    // Every FPR and recall gate reads a Wilson bound, which has no replicates. The
    // effort check must not turn that into missing evidence.
    const report = evaluateReleaseGates(passingEvidence);
    for (const id of [
      "warning.fpr.overall",
      "warning.recall.overall",
      "action.fpr.overall",
      "action.recall.overall",
    ]) {
      expect(gateById(report.gates, id).evidence).toBe("present");
    }
    expect(report.decision).toBe("pass");
  });

  it("rejects on mixed >=50% AI warning-recall below 50%, reporting the IC without substituting the point gate", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({
        mixed: {
          sampleSize: 100,
          warningRecall: 0.3,
          warningRecallLower95: 0.2,
        },
      }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    const gate = gateById(report.gates, "warning.mixed-recall");
    expect(gate.bound).toBe("point");
    expect(gate.passed).toBe(false);
    expect(gate.reasons[0]).toMatch(/lower95/u);
  });
});

describe("action tier teeth", () => {
  it("caps at indicator-only when an eligible slice breaks only the 2% action budget", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics(),
      slices: summary([
        slice({
          axis: "temporalCohort",
          key: "cohort-3",
          negatives: 400,
          fprGateEligible: true,
          warningFprUpper: 0.03,
          actionFprUpper: 0.04,
        }),
      ]),
    });
    expect(report.decision).toBe("indicator-only");
    expect(report.failedWarning).toEqual([]);
    const gate = gateById(
      report.gates,
      "action.fpr.slice.temporalCohort.cohort-3",
    );
    expect(gate).toMatchObject({
      tier: "action",
      required: 0.02,
      passed: false,
    });
  });

  it("caps at indicator-only on an action recall shortfall", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({ visual: { fpr: upper(0.01), recall: lower(0.2) } }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("indicator-only");
    expect(report.failedAction).toContain("action.recall.overall");
  });

  it("caps at indicator-only when no visual-action threshold was frozen", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({ visual: null }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("indicator-only");
    expect(gateById(report.gates, "action.available").passed).toBe(false);
  });
});

describe("eligible-slice gating (undersized slices do not block the warning budget)", () => {
  it("ignores an undersized critical slice with a catastrophic FPR for the warning budget", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics(),
      slices: summary([
        passingSlice(),
        slice({
          axis: "domain",
          key: "rare",
          negatives: 100,
          fprGateEligible: false,
          warningFprUpper: 0.99,
          actionFprUpper: 0.99,
        }),
      ]),
    });
    // The under-powered slice cannot authorize visual action, so the decision is
    // capped at indicator-only — but it never forces a reject.
    expect(report.decision).toBe("indicator-only");
    const warn = gateById(report.gates, "warning.fpr.slice.domain.rare");
    expect(warn.eligible).toBe(false);
    expect(warn.passed).toBe(true);
    expect(report.failedWarning).toEqual([]);
  });

  it("fully ignores an undersized non-FPR-axis slice", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics(),
      slices: summary([
        passingSlice(),
        slice({
          axis: "severity",
          key: "high",
          positives: 50,
          recallGateEligible: false,
          warningFprUpper: 0.99,
          actionFprUpper: 0.99,
        }),
      ]),
    });
    expect(report.decision).toBe("pass");
    expect(report.gates.some((gate) => gate.slice?.axis === "severity")).toBe(
      false,
    );
  });
});

// --- A6: resampling evidence, Bonferroni and label bases -------------------

describe("missing resampling evidence fails the gate, never falls back to i.i.d. rows", () => {
  it("fails every interval gate when no plan backs its estimand", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      // C4 has not run: there is no hierarchical or multiway plan.
      resampling: null,
      metrics: metrics(),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    const fpr = gateById(report.gates, "warning.fpr.overall");
    expect(fpr.passed).toBe(false);
    expect(fpr.evidence).toBe("missing-resampling-plan");
    expect(fpr.observed).toBeNull();
    expect(fpr.reasons[0]).toMatch(/reamostragem/u);
    // The reason says WHICH of the four shortfalls this is: there is no plan.
    expect(fpr.reasons[0]).toMatch(
      /nenhum plano de reamostragem foi declarado/u,
    );
    // The individual 95% bound is still published, and still marked descriptive:
    // it is exactly the number the gate refuses to decide on.
    expect(fpr.descriptive).toMatchObject({ value: 0.02, role: "descriptive" });
    // The boolean integrity gates are untouched by a missing plan.
    expect(gateById(report.gates, "integrity.schema").passed).toBe(true);
    expect(gateById(report.gates, "integrity.schema").evidence).toBe(
      "not-applicable",
    );
  });

  it("fails when the plan omits one estimand", () => {
    const partial = plan();
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: {
        ...partial,
        entries: partial.entries.filter(
          (entry) => entry.estimand !== "warning.recall",
        ),
      },
      metrics: metrics(),
      slices: summary([passingSlice()]),
    });
    expect(report.failedWarning).toContain("warning.recall.overall");
    expect(report.failedWarning).not.toContain("warning.fpr.overall");
    const gate = gateById(report.gates, "warning.recall.overall");
    expect(gate.evidence).toBe("missing-resampling-plan");
    // A plan that exists but skips this estimand says so, and names the plan.
    expect(gate.reasons[0]).toMatch(
      /não tem entrada para o estimando warning\.recall/u,
    );
    expect(gate.reasons[0]).toMatch(/synthetic-c4-plan/u);
  });

  it("refuses a plan whose unit is not one of the two the policy allows", () => {
    const partial = plan();
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: {
        ...partial,
        entries: partial.entries.map((entry) =>
          entry.estimand === "warning.fpr"
            ? {
                ...entry,
                // Independent rows is precisely the fallback the plan forbids.
                unitKind: "independent-rows" as unknown as "hierarchical",
              }
            : entry,
        ),
      },
      metrics: metrics(),
      slices: summary([passingSlice()]),
    });
    expect(report.failedWarning).toContain("warning.fpr.overall");
    const gate = gateById(report.gates, "warning.fpr.overall");
    expect(gate.evidence).toBe("missing-resampling-plan");
    expect(gate.reasons[0]).toMatch(/unitKind "independent-rows"/u);
  });

  it("refuses a plan that declares no unit axis, or fewer replicates than the pilot", () => {
    const noAxis = plan();
    const withoutAxes = evaluateReleaseGates({
      integrity: integrity(),
      resampling: {
        ...noAxis,
        entries: noAxis.entries.map((entry) => ({ ...entry, unitAxes: [] })),
      },
      metrics: metrics(),
      slices: summary([passingSlice()]),
    });
    expect(withoutAxes.decision).toBe("reject");
    // Not "there is no plan entry": the entry is there and names no axis.
    expect(
      gateById(withoutAxes.gates, "warning.fpr.overall").reasons[0],
    ).toMatch(/não nomeia nenhum eixo de dependência/u);

    const thin = plan();
    const tooFewReplicates = evaluateReleaseGates({
      integrity: integrity(),
      resampling: {
        ...thin,
        entries: thin.entries.map((entry) => ({ ...entry, replicates: 500 })),
      },
      metrics: metrics(),
      slices: summary([passingSlice()]),
    });
    expect(tooFewReplicates.decision).toBe("reject");
    // And this one is about the replicate count, not about a missing entry -- the
    // single "nenhum plano declara a unidade" sentence sent an operator hunting
    // for an entry that was right there.
    const thinReason = gateById(tooFewReplicates.gates, "warning.fpr.overall")
      .reasons[0];
    expect(thinReason).toMatch(/declara 500 réplicas/u);
    expect(thinReason).toMatch(String(PILOT_REPLICATES));
    expect(thinReason).not.toMatch(/não tem entrada/u);
  });
});

describe("Bonferroni simultaneous bounds", () => {
  it("decides on the simultaneous bound, not on the individual 95% one", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      // 4% individually — inside the 5% budget — and 6% simultaneously.
      metrics: metrics({
        warningFpr: splitBound(
          { lower95: 0, upper95: 0.04 },
          { lower: 0, upper: 0.06 },
        ),
      }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    const gate = gateById(report.gates, "warning.fpr.overall");
    expect(gate.bound).toBe("simultaneous-upper");
    expect(gate.observed).toBeCloseTo(0.06, 10);
    expect(gate.simultaneous).toMatchObject({ m: M, familyAlpha: 0.05 });
    expect(gate.descriptive).toMatchObject({
      bound: "upper95",
      value: 0.04,
      confidence: 0.95,
      role: "descriptive",
    });
  });

  it("counts only the mandatory interval gates in m, never integrity or diagnostics", () => {
    const report = evaluateReleaseGates(passingEvidence);
    const multiplicity = report.multiplicity;
    expect(multiplicity.correction).toBe("bonferroni");
    expect(multiplicity.familyAlpha).toBe(
      REBUILD_V3_POLICY.multiplicity.familyAlpha,
    );
    expect(multiplicity.descriptiveConfidence).toBe(
      REBUILD_V3_POLICY.multiplicity.descriptiveConfidence,
    );
    expect(multiplicity.frozenAt).toBe("G5");
    for (const id of multiplicity.gateIds) {
      expect(id.startsWith("integrity.")).toBe(false);
    }
    // Not every gate is in m: the point gates (coverage, mixed recall) read no
    // interval, so there is no interval to correct.
    expect(multiplicity.gateIds).not.toContain("warning.coverage");
    expect(multiplicity.gateIds).not.toContain("warning.mixed-recall");
    expect(multiplicity.observed).toBe(multiplicity.gateIds.length);
    const intervalGates = report.gates.filter(
      (gate) =>
        gate.bound === "simultaneous-upper" ||
        gate.bound === "simultaneous-lower",
    );
    expect(multiplicity.observed).toBe(intervalGates.length);
    expect(multiplicity.covers).toBe(true);
  });

  it("keeps an under-powered cell inside m and fails it, instead of shrinking the divisor", () => {
    const powered = evaluateReleaseGates(passingEvidence).multiplicity.observed;
    const withUnderPowered = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics(),
      slices: summary([
        passingSlice(),
        slice({
          axis: "domain",
          key: "legal",
          negatives: 12,
          fprGateEligible: false,
          warningFprUpper: 0.01,
          actionFprUpper: 0.01,
        }),
      ]),
    });
    // Two more gates (a warning cell and an action cell), both counted in m.
    expect(withUnderPowered.multiplicity.observed).toBe(powered + 2);
    expect(withUnderPowered.multiplicity.gateIds).toContain(
      "action.fpr.slice.domain.legal",
    );
    // And the powerless cell fails the action tier rather than leaving m.
    expect(withUnderPowered.failedAction).toContain(
      "action.fpr.slice.domain.legal",
    );
    expect(withUnderPowered.decision).toBe("indicator-only");
  });

  it("fails every interval gate when the declared m does not cover the mandatory gates", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      // One declared gate against a report full of them: the divisor is wrong and
      // the answer is a failure, never a recomputed alpha.
      metrics: metrics({ declaredM: 1 }),
      slices: summary([passingSlice()]),
    });
    expect(report.multiplicity.declared).toBe(1);
    expect(report.multiplicity.covers).toBe(false);
    expect(report.decision).toBe("reject");
    expect(gateById(report.gates, "warning.fpr.overall").passed).toBe(false);
  });

  it("fails every interval gate when no multiplicity was declared at all", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({ declaredM: null }),
      slices: summary([passingSlice()]),
    });
    expect(report.multiplicity.declared).toBeNull();
    expect(report.decision).toBe("reject");
    expect(gateById(report.gates, "warning.fpr.overall").evidence).toBe(
      "missing-simultaneous-interval",
    );
  });
});

describe("human-negative label bases as gate evidence", () => {
  it("gates on a powered basis that breaches the warning budget", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({
        labelBases: [
          basis("date-cutoff", { count: 900, powered: true, fprUpper: 0.09 }),
        ],
      }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    const gate = gateById(report.gates, "warning.fpr.labelBasis.date-cutoff");
    expect(gate.eligible).toBe(true);
    expect(gate.passed).toBe(false);
    expect(gate.sampleSize).toBe(900);
  });

  it("lets an under-powered observed-process basis neither approve a gate nor lift the action ceiling", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({
        labelBases: [
          basis("date-cutoff", { count: 900, powered: true, fprUpper: 0.01 }),
          // Twelve instrumented rows with a flawless FPR: they must not buy
          // anything, in either direction.
          basis("observed-process", { count: 12, powered: false, fprUpper: 0 }),
        ],
      }),
      slices: summary([passingSlice()]),
    });
    const warning = gateById(
      report.gates,
      "warning.fpr.labelBasis.observed-process",
    );
    expect(warning.eligible).toBe(false);
    expect(warning.passed).toBe(true);
    expect(report.failedWarning).toEqual([]);
    const action = gateById(
      report.gates,
      "action.fpr.labelBasis.observed-process",
    );
    expect(action.eligible).toBe(false);
    expect(action.passed).toBe(false);
    expect(action.reasons[0]).toMatch(/supplementary|suplementar/u);
    expect(report.decision).toBe("indicator-only");
  });

  it("refuses the unknown basis as evidence even past the power floor, so the action tier cannot be authorized today", () => {
    // The state of the world until C1 puts `labelBasis` in the closed schema:
    // every human negative lands in `unknown`, and a real corpus is far past the
    // 300-row floor, so nothing but the basis guard stops an evidence basis that
    // does not exist from approving the FPR budget (R4/R6). The label-basis block
    // here is the REAL one, computed by metrics.ts over 305 unlabelled negatives.
    const floor = REBUILD_V3_POLICY.powerFloors.criticalFprHumanNegatives;
    const computed = computeEvaluationMetrics(
      Array.from({ length: floor + 5 }, (_, index) =>
        humanNegativeWithoutBasis(`u${index}`),
      ),
      { bootstrapSeed: 20260728 },
    );
    expect(computed.labelBasis.bases.map((row) => row.basis)).toEqual([
      "unknown",
    ]);

    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({ labelBases: [...computed.labelBasis.bases] }),
      slices: summary([passingSlice()]),
    });

    const warning = gateById(report.gates, "warning.fpr.labelBasis.unknown");
    expect(warning.eligible).toBe(false);
    expect(warning.passed).toBe(true);
    const action = gateById(report.gates, "action.fpr.labelBasis.unknown");
    expect(action.eligible).toBe(false);
    expect(action.passed).toBe(false);
    expect(report.failedAction).toContain("action.fpr.labelBasis.unknown");
    expect(report.decision).toBe("indicator-only");
  });
});

describe("integrity tier teeth", () => {
  it("rejects a non-release scientific use", () => {
    const report = evaluateReleaseGates({
      integrity: integrity({ scientificUse: "diagnostic" }),
      resampling: plan(),
      metrics: metrics(),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    expect(report.failedIntegrity).toContain("integrity.scientific-use");
  });

  it("rejects an error rate at or above 1%", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({ errorRate: 0.02 }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    expect(report.failedIntegrity).toContain("integrity.error-rate");
  });

  it("rejects an error rate of exactly 1% (strictly below, not at or below)", () => {
    // The spec requires the inference error rate to stay BELOW 1%; exactly 0.01
    // is not below 1% and must fail the gate.
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({ errorRate: 0.01 }),
      slices: summary([passingSlice()]),
    });
    const gate = gateById(report.gates, "integrity.error-rate");
    expect(gate.observed).toBeCloseTo(0.01, 10);
    expect(gate.operator).toBe("<");
    expect(gate.passed).toBe(false);
    expect(report.failedIntegrity).toContain("integrity.error-rate");
    expect(report.decision).toBe("reject");
  });

  it("passes an error rate just below 1%", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({ errorRate: 0.009 }),
      slices: summary([passingSlice()]),
    });
    expect(gateById(report.gates, "integrity.error-rate").passed).toBe(true);
    expect(report.decision).toBe("pass");
  });
});

describe("decision is driven only by gate outcomes", () => {
  it("does not let a perfect isolated score override a failed warning gate", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      // AUROC pinned to a perfect 1, yet the warning FPR budget is broken.
      metrics: metrics({ warningFpr: upper(0.08), auroc: 1 }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
  });

  it("prefers reject when both warning and action gates fail", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      resampling: plan(),
      metrics: metrics({
        warningFpr: upper(0.08),
        visual: { fpr: upper(0.09), recall: lower(0.5) },
      }),
      slices: summary([passingSlice()]),
    });
    expect(report.failedWarning.length).toBeGreaterThan(0);
    expect(report.failedAction.length).toBeGreaterThan(0);
    expect(report.decision).toBe("reject");
  });
});
