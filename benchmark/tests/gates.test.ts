import { describe, expect, it } from "vitest";

import {
  evaluateReleaseGates,
  type GateInput,
  type GateResult,
  type IntegrityEvidence,
} from "../gates.ts";
import type {
  DecisionMetrics,
  EvaluationMetrics,
  MetricEstimate,
} from "../metrics.ts";
import type { SliceAxis, SliceResult, SliceSummary } from "../slices.ts";

// --- fixture builders ------------------------------------------------------

// An upper bound (the FPR gates read `.upper95`); a lower bound (the recall
// gates read `.lower95`); a bare point estimate.
function upper(bound: number): MetricEstimate {
  return {
    value: bound,
    lower95: 0,
    upper95: bound,
    method: "wilson-one-sided",
  };
}
function lower(bound: number): MetricEstimate {
  return {
    value: bound,
    lower95: bound,
    upper95: 1,
    method: "wilson-one-sided",
  };
}
function point(value: number): MetricEstimate {
  return { value, method: "point" };
}

function decision(
  fpr: MetricEstimate,
  recall: MetricEstimate,
  positives = 500,
  negatives = 2_000,
): DecisionMetrics {
  return {
    sampleSize: positives + negatives,
    positives,
    negatives,
    truePositives: positives,
    falsePositives: 0,
    trueNegatives: negatives,
    falseNegatives: 0,
    falsePositiveRate: fpr,
    recall,
    precision: point(1),
  };
}

interface MetricsOverrides {
  warningFpr?: MetricEstimate;
  warningRecall?: MetricEstimate;
  visual?: { fpr: MetricEstimate; recall: MetricEstimate } | null;
  coverage?: number;
  ece15?: number;
  errorRate?: number;
  mixed?: {
    sampleSize: number;
    warningRecall: number;
    warningRecallLower95: number;
  };
  rocAuc?: number;
}

// Only the fields the gate policy consumes are populated; the remainder of
// EvaluationMetrics is irrelevant to the gates and elided behind the cast.
function metrics(overrides: MetricsOverrides = {}): EvaluationMetrics {
  const visual =
    overrides.visual === undefined
      ? { fpr: upper(0.01), recall: lower(0.5) }
      : overrides.visual;
  return {
    warning: decision(
      overrides.warningFpr ?? upper(0.02),
      overrides.warningRecall ?? lower(0.75),
    ),
    visualAction: visual === null ? null : decision(visual.fpr, visual.recall),
    coverage: point(overrides.coverage ?? 0.95),
    ece15: point(overrides.ece15 ?? 0.02),
    errorRate: point(overrides.errorRate ?? 0.001),
    rocAuc: point(overrides.rocAuc ?? 0.99),
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
      warning: decision(upper(overrides.warningFprUpper ?? 0.01), lower(0.75)),
      visualAction: decision(
        upper(overrides.actionFprUpper ?? 0.005),
        lower(0.5),
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
  metrics: metrics(),
  slices: summary([passingSlice()]),
};

const actionFprFailure: GateInput = {
  integrity: integrity(),
  // Warning FPR still under 5%, but the visual-action matrix breaks the 2% budget.
  metrics: metrics({ visual: { fpr: upper(0.03), recall: lower(0.5) } }),
  slices: summary([passingSlice()]),
};

const actionSampleGap: GateInput = {
  integrity: integrity(),
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
  metrics: metrics({ warningFpr: upper(0.08) }),
  slices: summary([passingSlice()]),
};

const incompletePredictions: GateInput = {
  integrity: integrity({ predictionCompleteness: false }),
  metrics: metrics(),
  slices: summary([passingSlice()]),
};

const lowCoverage: GateInput = {
  integrity: integrity(),
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
    expect(fpr).toMatchObject({
      tier: "warning",
      scope: "overall",
      bound: "upper95",
      operator: "<=",
      required: 0.05,
    });
    expect(gateById(report.gates, "action.fpr.overall")).toMatchObject({
      bound: "upper95",
      operator: "<=",
      required: 0.02,
    });
    expect(gateById(report.gates, "warning.recall.overall")).toMatchObject({
      bound: "lower95",
      operator: ">=",
      required: 0.6,
    });
    expect(gateById(report.gates, "action.recall.overall")).toMatchObject({
      bound: "lower95",
      operator: ">=",
      required: 0.35,
    });
    expect(gateById(report.gates, "warning.coverage")).toMatchObject({
      operator: ">=",
      required: 0.8,
    });
    expect(gateById(report.gates, "warning.ece15")).toMatchObject({
      operator: "<=",
      required: 0.05,
    });
    expect(gateById(report.gates, "warning.mixed-recall")).toMatchObject({
      operator: ">=",
      required: 0.5,
    });
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
      bound: "upper95",
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
      metrics: metrics({ warningRecall: lower(0.5) }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    expect(report.failedWarning).toContain("warning.recall.overall");
  });

  it("rejects when ECE-15 exceeds 0.05", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      metrics: metrics({ ece15: 0.09 }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    expect(report.failedWarning).toContain("warning.ece15");
  });

  it("rejects on mixed >=50% AI warning-recall below 50%, reporting the IC without substituting the point gate", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
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
      metrics: metrics({ visual: { fpr: upper(0.01), recall: lower(0.2) } }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("indicator-only");
    expect(report.failedAction).toContain("action.recall.overall");
  });

  it("caps at indicator-only when no visual-action threshold was frozen", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
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

describe("integrity tier teeth", () => {
  it("rejects a non-release scientific use", () => {
    const report = evaluateReleaseGates({
      integrity: integrity({ scientificUse: "diagnostic" }),
      metrics: metrics(),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    expect(report.failedIntegrity).toContain("integrity.scientific-use");
  });

  it("rejects an error rate at or above 1%", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
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
      // ROC-AUC pinned to a perfect 1, yet the warning FPR budget is broken.
      metrics: metrics({ warningFpr: upper(0.08), rocAuc: 1 }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
  });

  it("prefers reject when both warning and action gates fail", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
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
