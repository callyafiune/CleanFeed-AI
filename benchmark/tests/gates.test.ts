import { describe, expect, it } from "vitest";

import {
  evaluateReleaseGates,
  mixedRecallDiagnostics,
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
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import { buildModelPublication } from "../profile-artifact.ts";
import type { BenchmarkRecord } from "../schema.ts";
import { publicationInputFor } from "./profile-artifact.fixtures.ts";
import {
  buildSlices,
  summarizeSlices,
  type SliceAxis,
  type SliceResult,
  type SliceSummary,
} from "../slices.ts";

// --- fixture builders ------------------------------------------------------

// Which score every fixture of this file declares its calibration statistic was
// measured over: the PRE-REGISTERED one, so the two tests that are about the mismatch
// are the only ones that can fail for it.
const CERTIFYING_SCORE_BASIS = PREREGISTRATION_V4.calibrationGate.scoreBasis;

// The FPR gates read the SIMULTANEOUS upper bound and the recall gates the
// simultaneous lower bound; the individual 95% bounds stay in the estimate as the
// descriptive interval. `upper`/`lower` set both to the same number so a fixture
// reads like the budget it means; `splitBound` sets them apart, which is how a
// test proves which one the verdict used.
//
// `M` is the divisor of the BOUNDS and the default divisor the fixture DECLARES: the
// gate refuses a bound corrected for one `m` while the report publishes another, so a
// fixture with two numbers would fail for its own incoherence. `boundM` sets them
// apart, which is how the test for that refusal is written.
const M = PREREGISTRATION_V4.multiplicity.primaryFamilySize;

function simultaneousBound(
  lowerBound: number,
  upperBound: number,
  m: number = M,
): NonNullable<MetricEstimate["simultaneous"]> {
  return {
    correction: "bonferroni",
    familyAlpha: 0.05,
    m,
    alpha: 0.05 / m,
    z: 3.2,
    lower: lowerBound,
    upper: upperBound,
    method: "wilson-one-sided",
  };
}

// The DECLARED unit of the synthetic plan below, as the estimate publishes it. The
// gate reconciles the two — an interval resampled over other axes than the plan
// declares is a different design wearing the estimand's name — so the fixture keeps
// one definition and both sides read it.
const PLAN_AXES = ["groups.author", "groups.nearDuplicate"] as const;

function unitDeclaration(
  estimand: string,
): NonNullable<MetricEstimate["resampling"]> {
  return {
    estimand,
    method: "hierarchical",
    axes: [...PLAN_AXES],
    items: 2_000,
    units: 400,
    levels: PLAN_AXES.map((axis, position) => ({
      position,
      axis,
      levels: position === 0 ? 40 : 400,
      degenerate: false,
    })),
    demotions: [],
    degenerate: false,
  };
}

// Every gated rate the metrics publish is a percentile bootstrap over its declared
// unit, so that is what a gate fixture has to look like: `analyticUpper` /
// `analyticLower` keep the OLD analytic shape, and they exist for the tests that
// prove a gate refuses one.
function analyticUpper(bound: number, m: number = M): MetricEstimate {
  return {
    value: bound,
    lower95: 0,
    upper95: bound,
    method: "wilson-one-sided",
    simultaneous: simultaneousBound(0, bound, m),
  };
}
function analyticLower(bound: number): MetricEstimate {
  return {
    value: bound,
    lower95: bound,
    upper95: 1,
    method: "wilson-one-sided",
    simultaneous: simultaneousBound(bound, 1),
  };
}
function upper(bound: number, m: number = M): MetricEstimate {
  return resampled(analyticUpper(bound, m));
}
function lower(bound: number): MetricEstimate {
  return resampled(analyticLower(bound));
}
// An estimate whose individual 95% bound and whose simultaneous bound disagree.
function analyticSplitBound(
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
function splitBound(
  individual: { lower95: number; upper95: number },
  wide: { lower: number; upper: number },
): MetricEstimate {
  return resampled(analyticSplitBound(individual, wide));
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
const PILOT_REPLICATES = PREREGISTRATION_V4.bootstrapReplicates.pilot;

function resampled(
  estimate: MetricEstimate,
  replicates: number | "undeclared" = PILOT_REPLICATES,
  estimand = "synthetic",
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
    method: "hierarchical-cluster-percentile",
    ...(replicates === "undeclared"
      ? {}
      : {
          replicates,
          tailReplicates: Math.floor(simultaneous.alpha * (replicates - 1)),
        }),
  };
  delete percentile.z;
  return {
    ...estimate,
    method: "hierarchical-cluster-percentile",
    resampling: unitDeclaration(estimand),
    simultaneous: percentile,
  };
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
      unitAxes: [...PLAN_AXES],
      replicates: PREREGISTRATION_V4.bootstrapReplicates.pilot,
      executed: "percentile-bootstrap" as const,
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
    positivePopulation: "warning-positives",
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
  // B2: the recall of the visual-action decision over INTEGRAL positives only.
  // Separate from `visual.recall`, which is the mixed-inclusive operating point,
  // precisely so a test can set the two apart and see which one the gate read.
  actionAuthorizationRecall?: MetricEstimate;
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
      // C4 resolves the resampling unit off the axes, so a fixture that reaches
      // computeEvaluationMetrics has to declare the outer level too.
      groups: { author, domainSource: "ptwiki_lead" },
    } as unknown as BenchmarkRecord,
    status: "scored",
    documentScore: 0.1,
    warned: false,
    visualActioned: false,
  };
}

// The same human negative carrying a QUOTA CELL on the certifying axis, so
// `buildSlices` produces the slice a per-cell hypothesis is measured on.
function cellNegative(cell: string, author: string): EvaluationItem {
  const item = humanNegativeWithoutBasis(author);
  return {
    ...item,
    record: {
      ...item.record,
      humanSourceType: cell,
    } as unknown as BenchmarkRecord,
  };
}

// One integral positive (label = ai), warned and visual-actioned, so the action
// tier has a population of its own that mixed rows cannot supply.
function aiPositive(author: string): EvaluationItem {
  return {
    record: {
      label: "ai",
      language: "pt-BR",
      wordCount: 120,
      domain: "corporate",
      platform: "generic-platform",
      provenance: { sourceId: "generated" },
      createdAt: 1_000,
      transformation: { kind: "none", severity: "none" },
      // The three levels of the ai-recall row, all `known`: the recall interval of
      // an AI positive is drawn over generator ⊃ prompt template ⊃ batch, and an
      // absent axis is `unknown`, which is not a resampling unit.
      groups: {
        author,
        domainSource: "ai_gemini",
        generatorFamily: "gemini_3_5_flash_low",
        promptTemplate: "qa_v1",
        collectionBatch: "gen_batch_01",
      },
      generation: { family: "gemini-3.5-flash-low" },
    } as unknown as BenchmarkRecord,
    status: "scored",
    documentScore: 0.9,
    warned: true,
    visualActioned: true,
  };
}

// One mechanistic mixed row at a chosen AI fraction. Scored by default, warned
// AND visual-actioned: the row that would move every rate in the favorable
// direction if it were counted in a gate population. The `abstained` and `error`
// statuses carry no score and no decision (R5), and they are the rows that
// separate a CLASS denominator from the eligible-set denominator behind
// `warning.coverage`: an undecided row raises that denominator alone.
function mixedRow(
  aiFraction: number,
  author: string,
  status: EvaluationItem["status"] = "scored",
): EvaluationItem {
  const record = {
    label: "mixed",
    language: "pt-BR",
    wordCount: 120,
    domain: "corporate",
    platform: "generic-platform",
    provenance: { sourceId: "generated" },
    createdAt: 1_000,
    transformation: { kind: "human-ai-mix", severity: "medium" },
    mixture: {
      aiFraction,
      humanFraction: 1 - aiFraction,
      spans: [],
      generationMode: "mechanistic",
    },
    // A mechanistic mixed row is a warning positive above the fraction floor, so it
    // needs the ai-recall levels; and the mixed row of the frozen table crosses its
    // human parent with the edit operation, so it names the parent too.
    groups: {
      author,
      domainSource: "ai_gemini",
      generatorFamily: "gemini_3_5_flash_low",
      promptTemplate: "mix_edit_v1",
      collectionBatch: "mix_batch_01",
      humanSeed: `seed_${author}`,
    },
  } as unknown as BenchmarkRecord;
  if (status !== "scored") return { record, status };
  return {
    record,
    status,
    documentScore: 0.95,
    warned: true,
    visualActioned: true,
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
    // The human-specificity unit of the frozen table, stated as a fixture would:
    // one source pool holding `count` donor units.
    resamplingUnit: {
      estimand: "warning.fpr.labelBasis",
      method: "hierarchical",
      axes: ["groups.domainSource", "groups.author"],
      items: options.count,
      units: options.count,
      levels: [
        {
          position: 0,
          axis: "groups.domainSource",
          levels: 1,
          degenerate: false,
        },
        {
          position: 1,
          axis: "groups.author",
          levels: options.count,
          degenerate: true,
        },
      ],
      demotions: [],
      degenerate: true,
    },
    powered: options.powered,
    powerFloor: PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives,
    evidenceRole: options.powered ? "gating" : "supplementary-diagnostic",
    falsePositiveRate: resampled(
      analyticUpper(options.fprUpper ?? 0.01),
      PILOT_REPLICATES,
      "warning.fpr.labelBasis",
    ),
    errorRate: analyticUpper(0),
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
    actionAuthorization:
      visual === null
        ? null
        : {
            role: "release",
            decision: "visual-action",
            positivePopulation: "integral-positives",
            family: "end-to-end",
            // Defaults to the mixed-inclusive recall so every pre-B2 fixture
            // keeps its meaning; the two B2 tests set them apart on purpose.
            recall: overrides.actionAuthorizationRecall ?? visual.recall,
            positives: 500,
            excludedMaterialAssistancePositives: 0,
            excludedEcologicalCohort: 0,
          },
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
  // The floor the eligibility verdict above was decided against, which a caller of
  // `buildSlices` may raise above the pre-registered row.
  fprNegativeFloor?: number;
  // The divisor of THIS slice's bounds, apart from the one the report declares.
  boundM?: number;
}

function slice(overrides: SliceOverrides): SliceResult {
  const negatives = overrides.negatives ?? 0;
  const positives = overrides.positives ?? 0;
  const boundM = overrides.boundM ?? M;
  return {
    axis: overrides.axis ?? "domain",
    key: overrides.key,
    sampleSize: negatives + positives,
    positives,
    negatives,
    fprGateEligible: overrides.fprGateEligible ?? false,
    recallGateEligible: overrides.recallGateEligible ?? false,
    fprNegativeFloor:
      overrides.fprNegativeFloor ??
      PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives,
    recallPositiveFloor: PREREGISTRATION_V4.powerFloors.criticalRecallPositives,
    metrics: {
      warning: families(
        decision(upper(overrides.warningFprUpper ?? 0.01, boundM), lower(0.75)),
      ),
      visualAction: families(
        decision(upper(overrides.actionFprUpper ?? 0.005, boundM), lower(0.5)),
      ),
    } as unknown as EvaluationMetrics,
  };
}

// The quota cells whose FPR ceilings the primary family names, and the axis they are
// measured on. A run that does not produce every one of them is a run whose mandatory
// inventory is not the family, which fails every certifying gate — so every scenario
// below starts from the declared cells at full power, and the tests that are ABOUT the
// inventory build their slice list with `bareSummary`. The frame declares ONE cell since
// the amendment, and nothing here is written for that count: the list is read from the
// policy, so a cell added later moves every scenario with it.
const CERTIFYING_CELLS = PREREGISTRATION_V4.preRegistration.quotaAxis.cells;

function cellSlice(key: string, overrides: Partial<SliceOverrides> = {}) {
  return slice({
    axis: "humanSourceType",
    key,
    negatives: 400,
    positives: 400,
    fprGateEligible: true,
    warningFprUpper: 0.02,
    actionFprUpper: 0.01,
    ...overrides,
  });
}

function certifyingCellSlices(): SliceResult[] {
  return CERTIFYING_CELLS.map((cell) => cellSlice(cell));
}

function summary(slices: SliceResult[]): SliceSummary {
  return bareSummary([...certifyingCellSlices(), ...slices]);
}

// The slice list exactly as given, the certifying cells or not.
function bareSummary(slices: SliceResult[]): SliceSummary {
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
  calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
  resampling: plan(),
  metrics: metrics(),
  slices: summary([passingSlice()]),
};

const actionFprFailure: GateInput = {
  integrity: integrity(),
  calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
  resampling: plan(),
  // Warning FPR still under 5%, but the visual-action matrix breaks the 2% budget.
  metrics: metrics({ visual: { fpr: upper(0.03), recall: lower(0.5) } }),
  slices: summary([passingSlice()]),
};

const actionSampleGap: GateInput = {
  integrity: integrity(),
  calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
  calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
  resampling: plan(),
  metrics: metrics({ warningFpr: upper(0.08) }),
  slices: summary([passingSlice()]),
};

const incompletePredictions: GateInput = {
  integrity: integrity({ predictionCompleteness: false }),
  calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
  resampling: plan(),
  metrics: metrics(),
  slices: summary([passingSlice()]),
};

const lowCoverage: GateInput = {
  integrity: integrity(),
  calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
  resampling: plan(),
  metrics: metrics({ coverage: 0.5 }),
  slices: summary([passingSlice()]),
};

// The same 5% breach INSIDE the family: the pooled FPR is a diagnostic — the family
// names four per-cell ceilings and no pooled one — and both reject, because a failed
// warning gate blocks whatever its role is. What the role changes is the CLAIM: only
// this one lands in `failedCertifying`.
const certifyingCellBreach: GateInput = {
  integrity: integrity(),
  calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
  resampling: plan(),
  metrics: metrics(),
  slices: bareSummary([
    ...CERTIFYING_CELLS.slice(1).map((cell) => cellSlice(cell)),
    cellSlice(CERTIFYING_CELLS[0], { warningFprUpper: 0.09 }),
  ]),
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
    ["the pooled warning FPR fails", warningFprFailure, "reject"],
    ["a per-cell FPR ceiling fails", certifyingCellBreach, "reject"],
    ["prediction completeness fails", incompletePredictions, "reject"],
    ["coverage falls below 80%", lowCoverage, "reject"],
  ] as const)("%s -> %s", (_name, evidence, expected) => {
    expect(evaluateReleaseGates(evidence).decision).toBe(expected);
  });

  // The role decides the CLAIM, not the branch: the two warning breaches above reject
  // alike, and only one of them says a pre-registered hypothesis of this version fell.
  it("separates what fell from what it certified", () => {
    expect(evaluateReleaseGates(warningFprFailure)).toMatchObject({
      decision: "reject",
      failedWarning: ["warning.fpr.overall"],
      failedCertifying: [],
    });
    expect(evaluateReleaseGates(certifyingCellBreach)).toMatchObject({
      decision: "reject",
      failedCertifying: [
        `warning.fpr.slice.humanSourceType.${CERTIFYING_CELLS[0]}`,
      ],
    });
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
      required: PREREGISTRATION_V4.fprBudgets.warning,
      evidence: "present",
      descriptive: { bound: "upper95", confidence: 0.95, role: "descriptive" },
    });
    expect(gateById(report.gates, "action.fpr.overall")).toMatchObject({
      bound: "simultaneous-upper",
      operator: "<=",
      required: PREREGISTRATION_V4.fprBudgets.visualAction,
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
      required: PREREGISTRATION_V4.calibrationGate.eceMax,
      bound: "simultaneous-upper",
      estimand: "calibration.ece",
    });
    // The frozen contract names the bound this gate reads, and it names the one
    // the gate actually read: a Bonferroni percentile, not the individual 95%.
    expect(PREREGISTRATION_V4.calibrationGate.eceBound).toBe(
      "bootstrap-simultaneous-upper",
    );
  });

  it("reports the denominator of the statistic it decided, not a wider population", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
  it("rejects when an eligible critical slice off the certifying axis breaches the 5% warning budget, certifying nothing", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
    // A hard-negative family is not a quota cell, so the breach certifies nothing —
    // and it blocks the release all the same: the cell describes the population the
    // release would act on.
    expect(report.decision).toBe("reject");
    const gate = gateById(
      report.gates,
      "warning.fpr.slice.hardNegativeFamily.citation-heavy",
    );
    expect(gate).toMatchObject({
      tier: "warning",
      role: "diagnostic",
      scope: "slice",
      slice: { axis: "hardNegativeFamily", key: "citation-heavy" },
      bound: "simultaneous-upper",
      required: 0.05,
      eligible: true,
      passed: false,
    });
    expect(gate.hypothesis).toBeUndefined();
    expect(gate.observed).toBeCloseTo(0.09, 10);
    expect(gate.reasons[0]).toMatch(/exceeds 0\.05/u);
    expect(report.failedCertifying).toEqual([]);
  });

  it("rejects when a per-cell ceiling of the family breaches the 5% budget", () => {
    const report = evaluateReleaseGates(certifyingCellBreach);
    const gate = gateById(
      report.gates,
      `warning.fpr.slice.humanSourceType.${CERTIFYING_CELLS[0]}`,
    );
    expect(gate).toMatchObject({
      tier: "warning",
      role: "certifying",
      hypothesis: `fpr-${CERTIFYING_CELLS[0]}`,
      required: 0.05,
      eligible: true,
      passed: false,
    });
    expect(gate.observed).toBeCloseTo(0.09, 10);
    expect(report.decision).toBe("reject");
    expect(report.failedCertifying).toEqual([gate.id]);
  });

  it("rejects on a warning recall shortfall", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        ece: resampled(
          analyticSplitBound(
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({ ece: resampled(analyticUpper(0.01), 2_000) }),
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({ ece: resampled(analyticUpper(0.01), "undeclared") }),
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

  it("keeps the release decision independent of EVERY property of the material-assistance cohort", () => {
    // The ratified criterion is that NO property of the cohort is an argument of the
    // decision. The weaker claim — one property, at one sample size, in one surrounding
    // state, changes nothing — leaves two rearms green: a reject term that fires only
    // when `failedAction` is non-empty, and one that fires on an empty cohort. Neither
    // is observable from a fixture where everything else passes at sampleSize 100, so
    // the matrix IS the guard.
    const COHORTS = [
      {
        name: "unmeasured",
        mixed: {
          sampleSize: 0,
          warningRecall: Number.NaN,
          warningRecallLower95: Number.NaN,
        },
      },
      {
        name: "no recall at all",
        mixed: { sampleSize: 100, warningRecall: 0, warningRecallLower95: 0 },
      },
      {
        name: "twenty points under the floor",
        mixed: {
          sampleSize: 100,
          warningRecall: 0.3,
          warningRecallLower95: 0.2,
        },
      },
      {
        name: "exactly at the floor",
        mixed: {
          sampleSize: 100,
          warningRecall: 0.5,
          warningRecallLower95: 0.4,
        },
      },
      {
        name: "clearing the floor",
        mixed: {
          sampleSize: 100,
          warningRecall: 0.8,
          warningRecallLower95: 0.72,
        },
      },
      {
        name: "perfect on a single row",
        mixed: { sampleSize: 1, warningRecall: 1, warningRecallLower95: 0 },
      },
    ];
    // One surrounding state per reachable verdict, because a term keyed on another
    // failure list is only observable where that list is non-empty.
    const SURROUNDINGS = [
      {
        name: "everything else passing",
        expected: "pass",
        slices: () => summary([passingSlice()]),
      },
      {
        name: "an action ceiling breached",
        expected: "indicator-only",
        slices: () =>
          summary([
            slice({
              axis: "temporalCohort",
              key: "cohort-3",
              negatives: 400,
              fprGateEligible: true,
              warningFprUpper: 0.03,
              actionFprUpper: 0.04,
            }),
          ]),
      },
      {
        name: "a warning ceiling breached",
        expected: "reject",
        slices: () =>
          summary([
            slice({
              axis: "hardNegativeFamily",
              key: "citation-heavy",
              negatives: 500,
              fprGateEligible: true,
              warningFprUpper: 0.09,
              actionFprUpper: 0.01,
            }),
          ]),
      },
    ];
    for (const surrounding of SURROUNDINGS) {
      const reports = COHORTS.map((cohort) => ({
        name: cohort.name,
        report: evaluateReleaseGates({
          integrity: integrity(),
          calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
          resampling: plan(),
          metrics: metrics({ mixed: cohort.mixed }),
          slices: surrounding.slices(),
        }),
      }));
      const baseline = reports.at(0);
      if (baseline === undefined)
        throw new Error("no cohort to compare against");
      for (const { name, report } of reports) {
        const where = `${surrounding.name} / ${name}`;
        expect(report.decision, where).toBe(surrounding.expected);
        // The four lists too, so a cohort that pushes an id into one of them without
        // moving the verdict is caught as well.
        expect(report.failedIntegrity, where).toEqual(
          baseline.report.failedIntegrity,
        );
        expect(report.failedWarning, where).toEqual(
          baseline.report.failedWarning,
        );
        expect(report.failedAction, where).toEqual(
          baseline.report.failedAction,
        );
        expect(report.failedCertifying, where).toEqual(
          baseline.report.failedCertifying,
        );
        // Absent from the gates and not merely from the lists: this is what makes
        // putting the block back into `pointWarningGates` an edit someone sees.
        expect(
          report.gates.map((gate) => gate.id),
          where,
        ).not.toContain("warning.mixed-recall");
      }
    }
  });

  it("gives no gate a tier outside the three the §6.5 branch reads", () => {
    // A fourth tier value would be the silent disarm: `failedIds` filters by equality
    // and `profile-artifact.ts` filters `tier === "action"`, so an unknown tier drops
    // out of every list without a single reader refusing it. Nothing here is
    // fail-closed; this assertion is what keeps the hole from being used.
    const report = evaluateReleaseGates(passingEvidence);
    for (const gate of report.gates) {
      expect(["integrity", "warning", "action"]).toContain(gate.tier);
    }
  });

  it("freezes the non-decision and both rearm conditions in the policy, by value", () => {
    expect(PREREGISTRATION_V4.materialAssistance.decides).toBe(false);
    expect([...PREREGISTRATION_V4.materialAssistance.rearmRequires]).toEqual([
      "sentence-or-token-head-formulation",
      "floor-derived-from-sourced-evidence",
    ]);
    // The floor is frozen, not removed: it is the target a rearm is measured against.
    expect(PREREGISTRATION_V4.materialAssistance.minimumWarningRecall).toBe(
      0.5,
    );
  });
});

describe("action tier teeth", () => {
  it("caps at indicator-only when an eligible slice breaks only the 2% action budget", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({ visual: null }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("indicator-only");
    const available = gateById(report.gates, "action.available");
    expect(available.passed).toBe(false);
    expect(available.reasons).toEqual([
      "no visual-action evidence: visualDocument and actionAuthorization are null",
    ]);
  });

  // The authorizing block going missing on its own is the state that used to
  // arrive at the recall gate as `sampleSize: 0` with an undefined estimate. Now
  // `action.available` refuses it by shape, and `actionIntervalSpecs` emits no
  // spec at all — so the tier fails on the availability gate instead of passing
  // with its recall gate quietly absent.
  it("fails the action tier when the authorizing population is missing on its own", () => {
    const base = metrics();
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: { ...base, actionAuthorization: null },
      slices: summary([passingSlice()]),
    });
    const available = gateById(report.gates, "action.available");
    expect(available.passed).toBe(false);
    expect(available.reasons).toEqual([
      "no visual-action evidence: actionAuthorization is null",
    ]);
    expect(report.failedAction).toContain("action.available");
    expect(report.decision).toBe("indicator-only");
    expect(
      report.gates.some((gate) => gate.id === "action.recall.overall"),
    ).toBe(false);
  });
});

describe("eligible-slice gating (undersized slices do not block the warning budget)", () => {
  it("ignores an undersized critical slice with a catastrophic FPR for the warning budget", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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

describe("C4's real plan closes the gap A6 left open", () => {
  it("stops every interval gate failing for a missing plan", () => {
    // The plan the metrics themselves publish, not a hand-written one: it is
    // assembled from the resolutions the intervals were drawn over, which is what
    // `benchmark/commands/evaluate.ts` hands the gate.
    const computed = computeEvaluationMetrics(
      [
        ...Array.from({ length: 400 }, (_, index) =>
          humanNegativeWithoutBasis(`n${index}`),
        ),
        ...Array.from({ length: 200 }, (_, index) => aiPositive(`p${index}`)),
      ],
      { bootstrapSeed: 20260726, preRegisteredStatisticalGates: M },
    );
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: computed.resampling,
      metrics: computed,
      slices: summary([passingSlice()]),
    });
    // Not one gate is left without a declared unit.
    expect(
      report.gates.filter(
        (gate) => gate.evidence === "missing-resampling-plan",
      ),
    ).toEqual([]);
    // And every estimand the gates name is covered by an entry of the plan.
    const declared = new Set(
      computed.resampling.entries.map((entry) => entry.estimand),
    );
    for (const gate of report.gates) {
      if (gate.estimand === undefined) continue;
      expect(declared.has(gate.estimand)).toBe(true);
    }
    // And the plan does not merely DECLARE the unit of the gated rates: the bounds
    // the FPR and recall gates read are percentiles of the design, so no gate is
    // deciding a release on an interval that treats correlated rows as independent.
    for (const id of [
      "warning.fpr.overall",
      "warning.recall.overall",
      "action.fpr.overall",
      "action.recall.overall",
    ]) {
      const gate = gateById(report.gates, id);
      expect(gate.evidence).not.toBe("unresampled-interval");
      expect(gate.evidence).not.toBe("missing-resampling-plan");
    }
    expect(
      computed.resampling.entries.find(
        (entry) => entry.estimand === "warning.fpr",
      )?.executed,
    ).toBe("percentile-bootstrap");
  });

  // The floor reaches the gate through THREE hands — the policy, `buildSlices`, and the
  // gate composing the reason — and every fixture above writes `fprGateEligible` by
  // hand, which exercises none of them. Here the eligibility verdict is the one
  // `buildSlices` computed over real rows, one line below the floor.
  it("fails a certifying cell that buildSlices found one line below the floor", () => {
    const floor = PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives;
    const [starved, ...rest] = CERTIFYING_CELLS;
    const items = [
      ...Array.from({ length: floor - 1 }, (_, index) =>
        cellNegative(starved, `s${index}`),
      ),
      // The other three cells exist so the inventory IS the family and the refusal
      // under test is about power and not about a missing hypothesis.
      ...rest.flatMap((cell) => [
        cellNegative(cell, `${cell}-0`),
        cellNegative(cell, `${cell}-1`),
      ]),
      ...Array.from({ length: 10 }, (_, index) => aiPositive(`p${index}`)),
    ];
    const options = {
      bootstrapSeed: 20260804,
      preRegisteredStatisticalGates: M,
    };
    const computed = computeEvaluationMetrics(items, options);
    const slices = summarizeSlices(
      buildSlices(items, { ...options, heldOutGeneratorFamilies: [] }),
    );
    const cell = slices.slices.find(
      (candidate) =>
        candidate.axis === "humanSourceType" && candidate.key === starved,
    );
    expect(cell?.negatives).toBe(floor - 1);
    expect(cell?.fprGateEligible).toBe(false);
    expect(cell?.fprNegativeFloor).toBe(floor);

    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: computed.resampling,
      metrics: computed,
      slices,
    });
    expect(report.multiplicity.missingHypotheses).toEqual([]);
    const gate = gateById(
      report.gates,
      `warning.fpr.slice.humanSourceType.${starved}`,
    );
    expect(gate.role).toBe("certifying");
    expect(gate.eligible).toBe(false);
    expect(gate.passed).toBe(false);
    expect(gate.reasons[0]).toMatch(
      new RegExp(
        `a célula ${starved} tem ${floor - 1} negativos humanos, abaixo do piso aplicado de ${floor}`,
        "u",
      ),
    );
    expect(report.decision).toBe("reject");
    expect(report.failedCertifying).toContain(gate.id);
  });
});

describe("a declared unit is not a property of the number (R7)", () => {
  // The gap the previous round left open, closed as a test: the plan declared the
  // frozen table's unit for `warning.fpr` while the published bound came from the
  // analytic Wilson estimator, and the gate read the declaration as satisfaction of
  // the unit requirement. It decided a release on an interval that counts every
  // correlated record-line as independent — the exact defect C4 exists to remove,
  // reached through the plan instead of through the estimator.
  it("fails the gate when the bound is analytic and the plan only declares the unit", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({ warningFpr: analyticUpper(0.02) }),
      slices: summary([passingSlice()]),
    });
    // The refusal is the subject here, and it blocks whether or not the number was
    // going to certify anything: the pooled FPR is a diagnostic, so it rejects without
    // adding to `failedCertifying`.
    expect(report.decision).toBe("reject");
    expect(report.failedCertifying).toEqual([]);
    const fpr = gateById(report.gates, "warning.fpr.overall");
    expect(fpr.evidence).toBe("unresampled-interval");
    expect(fpr.passed).toBe(false);
    expect(fpr.observed).toBeNull();
    expect(fpr.reasons[0]).toMatch(/não reamostra nada/u);
    expect(fpr.reasons[0]).toMatch(/declarar a unidade não é medi-la/u);
    // The descriptive interval is still published: it is precisely the number the
    // gate refuses to decide on, and hiding it would hide the refusal's subject.
    expect(fpr.descriptive).toMatchObject({ value: 0.02, role: "descriptive" });
  });

  it("fails the gate when the interval was resampled over other axes than the plan declares", () => {
    const overOtherAxes = upper(0.02);
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        warningFpr: {
          ...overOtherAxes,
          resampling: {
            ...(overOtherAxes.resampling as NonNullable<
              MetricEstimate["resampling"]
            >),
            axes: ["groups.source"],
          },
        },
      }),
      slices: summary([passingSlice()]),
    });
    const fpr = gateById(report.gates, "warning.fpr.overall");
    expect(fpr.evidence).toBe("unresampled-interval");
    expect(fpr.reasons[0]).toMatch(/groups\.source/u);
  });

  // The published bound of a rate is chosen between two estimators by the frozen
  // contract's `resampling.publishedBound`, and the chosen simultaneous limit keeps
  // the PERCENTILE method name even when the analytic estimator supplied it. That is
  // the one place a method name can outrun the estimator behind the number, so the
  // gate checks the envelope instead of trusting the name.
  it("fails the gate when an envelope is published without its simultaneous pair", () => {
    const withoutPair = upper(0.02);
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        warningFpr: {
          ...withoutPair,
          boundEnvelope: {
            rule: "wider-of-analytic-and-resampled",
            analytic: { lower: 0, upper: 0.02, method: "wilson-one-sided" },
            resampled: {
              lower: 0,
              upper: 0,
              method: "hierarchical-cluster-percentile",
            },
            lowerFrom: "resampled",
            upperFrom: "analytic",
          },
        },
      }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    const fpr = gateById(report.gates, "warning.fpr.overall");
    expect(fpr.evidence).toBe("unresampled-interval");
    expect(fpr.passed).toBe(false);
    expect(fpr.reasons[0]).toMatch(/não traz o par simultâneo/u);
  });

  it("fails the gate when the published simultaneous limit is narrower than the resampled one", () => {
    // The rule can only move a limit outward. A published upper bound BELOW the
    // resampled one it records means the rule was not applied — the declared design
    // was executed and then narrowed, which is the direction R3 forbids.
    const narrowed = upper(0.02);
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        warningFpr: {
          ...narrowed,
          boundEnvelope: {
            rule: "wider-of-analytic-and-resampled",
            analytic: { lower: 0, upper: 0.02, method: "wilson-one-sided" },
            resampled: {
              lower: 0,
              upper: 0.02,
              method: "hierarchical-cluster-percentile",
            },
            lowerFrom: "resampled",
            upperFrom: "resampled",
            simultaneous: {
              analytic: { lower: 0, upper: 0.02, method: "wilson-one-sided" },
              resampled: {
                lower: 0,
                upper: 0.09,
                method: "hierarchical-cluster-percentile",
              },
              lowerFrom: "resampled",
              upperFrom: "resampled",
            },
          },
        },
      }),
      slices: summary([passingSlice()]),
    });
    const fpr = gateById(report.gates, "warning.fpr.overall");
    expect(fpr.evidence).toBe("unresampled-interval");
    expect(fpr.passed).toBe(false);
    expect(fpr.reasons[0]).toMatch(/mais estreito que o limite reamostrado/u);
    // The four limits that make the diagnosis, not the estimator names dressed as
    // an interval: a reader has to see 0.02 against 0.09 to see the narrowing.
    expect(fpr.reasons[0]).toMatch(/\[0, 0\.02\]/u);
    expect(fpr.reasons[0]).toMatch(/\[0, 0\.09\]/u);
    expect(fpr.reasons[0]).not.toMatch(/\[resampled, resampled\]/u);
  });

  // Defensive, and therefore only reachable from an estimate this module did not
  // produce: `rateEnvelope` always writes the published simultaneous method into
  // the envelope's resampled pair. Nothing else exercises the branch, so without
  // this case the check could be deleted and the suite would stay green.
  it("fails the gate when the envelope names a resampled estimator other than the published one", () => {
    const mismatched = upper(0.02);
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        warningFpr: {
          ...mismatched,
          boundEnvelope: {
            rule: "wider-of-analytic-and-resampled",
            analytic: { lower: 0, upper: 0.02, method: "wilson-one-sided" },
            resampled: {
              lower: 0,
              upper: 0.02,
              method: "hierarchical-cluster-percentile",
            },
            lowerFrom: "resampled",
            upperFrom: "resampled",
            simultaneous: {
              analytic: { lower: 0, upper: 0.02, method: "wilson-one-sided" },
              resampled: {
                lower: 0,
                upper: 0.02,
                method: "multiway-cluster-percentile",
              },
              lowerFrom: "resampled",
              upperFrom: "resampled",
            },
          },
        },
      }),
      slices: summary([passingSlice()]),
    });
    expect(report.decision).toBe("reject");
    const fpr = gateById(report.gates, "warning.fpr.overall");
    expect(fpr.evidence).toBe("unresampled-interval");
    expect(fpr.passed).toBe(false);
    expect(fpr.reasons[0]).toMatch(/multiway-cluster-percentile/u);
    expect(fpr.reasons[0]).toMatch(/hierarchical-cluster-percentile/u);
  });

  it("fails the gate when a crossed design was drawn as a nested one", () => {
    const nested = upper(0.02);
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan({
        entries: plan().entries.map((entry) =>
          entry.estimand === "warning.fpr"
            ? { ...entry, unitKind: "multiway" as const }
            : entry,
        ),
      }),
      metrics: metrics({ warningFpr: nested }),
      slices: summary([passingSlice()]),
    });
    const fpr = gateById(report.gates, "warning.fpr.overall");
    expect(fpr.evidence).toBe("unresampled-interval");
    expect(fpr.reasons[0]).toMatch(/aninhar o que é cruzado/u);
  });
});

describe("missing resampling evidence fails the gate, never falls back to i.i.d. rows", () => {
  it("fails every interval gate when no plan backs its estimand", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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

  it("counts only the certifying interval gates in m, never integrity, diagnostics or the pooled cells", () => {
    const report = evaluateReleaseGates(passingEvidence);
    const multiplicity = report.multiplicity;
    expect(multiplicity.correction).toBe("bonferroni");
    expect(multiplicity.familyAlpha).toBe(
      PREREGISTRATION_V4.multiplicity.familyAlpha,
    );
    expect(multiplicity.descriptiveConfidence).toBe(
      PREREGISTRATION_V4.multiplicity.descriptiveConfidence,
    );
    expect(multiplicity.frozenAt).toBe("G0.2");
    for (const id of multiplicity.gateIds) {
      expect(id.startsWith("integrity.")).toBe(false);
    }
    // The inventory is the SIX interval gates of the family: four per-cell ceilings,
    // the overall recall and the global ECE. Integrity is member seven and has no
    // single id, so `observed` is one more than the list.
    expect(multiplicity.gateIds).toEqual([
      ...CERTIFYING_CELLS.map(
        (cell) => `warning.fpr.slice.humanSourceType.${cell}`,
      ),
      "warning.recall.overall",
      "warning.calibration-ece",
    ]);
    expect(multiplicity.observed).toBe(multiplicity.gateIds.length + 1);
    expect(multiplicity.observed).toBe(
      PREREGISTRATION_V4.multiplicity.primaryFamilySize,
    );
    // Neither the point gate (no interval to correct), nor the pooled FPR, nor the
    // label bases, nor any action gate: none of them is a hypothesis of this version.
    for (const id of [
      "warning.coverage",
      "warning.fpr.overall",
      "warning.fpr.labelBasis.date-cutoff",
      "action.fpr.overall",
      "action.recall.overall",
    ]) {
      expect(multiplicity.gateIds).not.toContain(id);
      expect(gateById(report.gates, id).role).toBe("diagnostic");
    }
    // The material-assistance recall is not in the inventory either, and the reason is
    // one step stronger than diagnostic: it is not a gate at all. Kept out of the loop
    // above precisely because `gateById` would throw instead of asserting.
    expect(multiplicity.gateIds).not.toContain("warning.mixed-recall");
    expect(report.gates.map((gate) => gate.id)).not.toContain(
      "warning.mixed-recall",
    );
    const intervalGates = report.gates.filter(
      (gate) =>
        gate.bound === "simultaneous-upper" ||
        gate.bound === "simultaneous-lower",
    );
    // Far more interval gates are PUBLISHED than are counted: that gap is the whole
    // point of a derived inventory.
    expect(intervalGates.length).toBeGreaterThan(multiplicity.gateIds.length);
    expect(multiplicity.covers).toBe(true);
  });

  // X1 — the length bands are a DIAGNOSTIC, so `m` is blind to how many there are.
  //
  // The mandatory inventory is derived from `multiplicity.primaryFamily` and the bands
  // are not in it, so every per-band FPR gate is published and none of them certifies.
  // The second half is the one that matters: adding a band adds a published gate and
  // leaves `m`, the per-hypothesis alpha and the inventory exactly where they were. If
  // a band ever moved `m`, the wiring would be wrong.
  it("keeps every length band out of m, and adding a band moves neither m nor the alpha", () => {
    const bandKeys = PREREGISTRATION_V4.lengthBands.bands.map(
      (band) => band.key,
    );
    const bandSlice = (key: string): SliceResult =>
      slice({
        axis: "lengthBucket",
        key,
        negatives: 400,
        positives: 400,
        fprGateEligible: true,
        warningFprUpper: 0.02,
        actionFprUpper: 0.01,
      });
    const withBands = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics(),
      slices: summary(bandKeys.map(bandSlice)),
    });
    // Every band is a published gate...
    for (const key of bandKeys) {
      const gate = gateById(
        withBands.gates,
        `warning.fpr.slice.lengthBucket.${key}`,
      );
      expect(gate.role).toBe("diagnostic");
      expect(gate.hypothesis ?? null).toBeNull();
      expect(withBands.multiplicity.gateIds).not.toContain(gate.id);
    }
    // ...and none of them is in the inventory, which is still the four of the family.
    expect(withBands.multiplicity.observed).toBe(4);
    expect(withBands.multiplicity.observed).toBe(
      PREREGISTRATION_V4.multiplicity.primaryFamilySize,
    );
    expect([...withBands.multiplicity.hypotheses].sort()).toEqual(
      [...PREREGISTRATION_V4.multiplicity.primaryFamily].sort(),
    );
    expect(withBands.multiplicity.missingHypotheses).toEqual([]);
    expect(withBands.multiplicity.covers).toBe(true);

    // A FIFTH band, which is what "acrescentar faixa" means at the gate layer.
    const withOneMore = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics(),
      slices: summary([...bandKeys, "600_PLUS"].map(bandSlice)),
    });
    expect(withOneMore.multiplicity.observed).toBe(
      withBands.multiplicity.observed,
    );
    expect(withOneMore.multiplicity.gateIds).toEqual(
      withBands.multiplicity.gateIds,
    );
    expect(withOneMore.multiplicity.familyAlpha).toBe(
      withBands.multiplicity.familyAlpha,
    );
    expect(withOneMore.multiplicity.declared).toBe(
      withBands.multiplicity.declared,
    );
    // One more PUBLISHED gate, zero more counted.
    expect(withOneMore.gates.length).toBe(withBands.gates.length + 2);
    expect(
      gateById(withOneMore.gates, "warning.fpr.slice.lengthBucket.600_PLUS")
        .role,
    ).toBe("diagnostic");
  });

  it("keeps an under-powered cell of the family inside m and fails it, instead of shrinking the divisor", () => {
    const starved = CERTIFYING_CELLS[0];
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics(),
      slices: bareSummary(
        CERTIFYING_CELLS.map((cell) =>
          cell === starved
            ? cellSlice(cell, { negatives: 12, fprGateEligible: false })
            : cellSlice(cell),
        ),
      ),
    });
    // The hypothesis is still in the inventory — the family is pre-registered — and
    // the divisor is still the family size.
    expect(report.multiplicity.observed).toBe(
      PREREGISTRATION_V4.multiplicity.primaryFamilySize,
    );
    expect(report.multiplicity.hypotheses).toContain(`fpr-${starved}`);
    expect(report.multiplicity.covers).toBe(true);
    // And the powerless cell FAILS rather than passing for want of evidence.
    const gate = gateById(
      report.gates,
      `warning.fpr.slice.humanSourceType.${starved}`,
    );
    expect(gate.eligible).toBe(false);
    expect(gate.passed).toBe(false);
    expect(gate.reasons[0]).toMatch(
      new RegExp(
        `a célula ${starved} tem 12 negativos humanos, abaixo do piso ` +
          `aplicado de ${PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives}`,
        "u",
      ),
    );
    // The floor counts origin documents because the pre-registration admits one line
    // per document per cell, and the reason attributes the rule rather than claiming it
    // was verified here: the count is the composition gate's.
    expect(gate.reasons[0]).toMatch(
      new RegExp(
        `a pré-inscrição conta o piso em documentos de origem, admitindo ` +
          `≤${PREREGISTRATION_V4.collection.maximumLinesPerOriginDocument} linha por documento`,
        "u",
      ),
    );
    expect(gate.reasons[0]).toMatch(/a imposição é do gate de composição/u);
    expect(report.decision).toBe("reject");
    expect(report.failedCertifying).toEqual([gate.id]);
  });

  it("names the floor the eligibility was decided against, not the pre-registered row", () => {
    // A caller may RAISE the floor (`SliceOptions.minimumFprNegatives`) for a narrower
    // question. The cell below is ineligible against 500 with 400 negatives — a count
    // ABOVE the pre-registered 300 — so a reason composed from the policy row would
    // publish, in sealed evidence, a comparison this cell never lost.
    const starved = CERTIFYING_CELLS[0];
    const raised = 500;
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics(),
      slices: bareSummary(
        CERTIFYING_CELLS.map((cell) =>
          cell === starved
            ? cellSlice(cell, {
                negatives: 400,
                fprGateEligible: false,
                fprNegativeFloor: raised,
              })
            : cellSlice(cell),
        ),
      ),
    });
    const gate = gateById(
      report.gates,
      `warning.fpr.slice.humanSourceType.${starved}`,
    );
    expect(gate.passed).toBe(false);
    expect(gate.reasons[0]).toMatch(
      new RegExp(
        `a célula ${starved} tem 400 negativos humanos, abaixo do piso aplicado de ${raised}`,
        "u",
      ),
    );
    expect(gate.reasons[0]).not.toMatch(
      new RegExp(
        `piso aplicado de ${PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives}`,
        "u",
      ),
    );
  });

  it("fails every certifying gate when the declared m does not cover the family", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      // One declared hypothesis against the whole family: the divisor is wrong and
      // the answer is a failure, never a recomputed alpha.
      metrics: metrics({ declaredM: 1 }),
      slices: summary([passingSlice()]),
    });
    expect(report.multiplicity.declared).toBe(1);
    expect(report.multiplicity.covers).toBe(false);
    expect(report.decision).toBe("reject");
    const cell = gateById(
      report.gates,
      `warning.fpr.slice.humanSourceType.${CERTIFYING_CELLS[0]}`,
    );
    expect(cell.passed).toBe(false);
    expect(cell.evidence).toBe("missing-simultaneous-interval");
    expect(cell.reasons[0]).toMatch(
      new RegExp(
        `o m declarado \\(1\\) não cobre as ${PREREGISTRATION_V4.multiplicity.primaryFamilySize} hipóteses obrigatórias`,
        "u",
      ),
    );
  });

  it("fails every certifying gate when no multiplicity was declared at all, naming the absent m", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({ declaredM: null }),
      slices: summary([passingSlice()]),
    });
    expect(report.multiplicity.declared).toBeNull();
    expect(report.multiplicity.perGateAlpha).toBeNull();
    expect(report.multiplicity.covers).toBe(false);
    expect(report.decision).toBe("reject");
    // Every one of the seven, and the reason names the MULTIPLICITY rather than a
    // budget: this is the shape a run takes when the measurement was computed without
    // the pre-registered family size.
    expect(report.failedCertifying).toEqual(report.multiplicity.gateIds);
    for (const id of report.multiplicity.gateIds) {
      const gate = gateById(report.gates, id);
      expect(gate.evidence).toBe("missing-simultaneous-interval");
      expect(gate.reasons[0]).toMatch(
        /nenhum m pré-registrado foi declarado, então não há limite unilateral simultâneo/u,
      );
    }
    // And the diagnostics are untouched by it: they hold no share of the alpha the
    // inventory divides.
    expect(gateById(report.gates, "warning.fpr.overall").passed).toBe(true);
  });

  // Declaring the divisor is not using it. The number reaches the aggregate metrics
  // and each slice's metrics through separate arguments, so the report can publish
  // m=7 while a cell's ceiling was decided at 0.05/40 — a WIDER limit against the very
  // same budget, which is a pass no pre-registered alpha bought.
  it("refuses a per-cell ceiling whose bound was corrected for another m", () => {
    const divergent = 40;
    const target = CERTIFYING_CELLS[0];
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        declaredM: PREREGISTRATION_V4.multiplicity.primaryFamilySize,
      }),
      slices: bareSummary(
        CERTIFYING_CELLS.map((cell) =>
          cell === target
            ? cellSlice(cell, { boundM: divergent })
            : cellSlice(cell),
        ),
      ),
    });
    // The inventory IS the family: nothing about the count is wrong here.
    expect(report.multiplicity.covers).toBe(true);
    expect(report.multiplicity.declared).toBe(
      PREREGISTRATION_V4.multiplicity.primaryFamilySize,
    );
    const gate = gateById(
      report.gates,
      `warning.fpr.slice.humanSourceType.${target}`,
    );
    expect(gate.evidence).toBe("divergent-multiplicity");
    expect(gate.passed).toBe(false);
    // The refused bound is PUBLISHED with the divisor it came from, so the mismatch is
    // legible in the sealed report and not only in the message.
    expect(gate.simultaneous).toMatchObject({ m: divergent });
    expect(gate.observed).toBeNull();
    expect(gate.reasons[0]).toMatch(
      new RegExp(
        `o limite simultâneo foi corrigido para m=${divergent} .* enquanto o relatório declara m=${PREREGISTRATION_V4.multiplicity.primaryFamilySize}`,
        "u",
      ),
    );
    expect(report.decision).toBe("reject");
    expect(report.failedCertifying).toEqual([gate.id]);
    // The three coherent cells are decided as usual.
    for (const cell of CERTIFYING_CELLS.filter((key) => key !== target)) {
      expect(
        gateById(report.gates, `warning.fpr.slice.humanSourceType.${cell}`)
          .evidence,
      ).toBe("present");
    }
  });
});

// ===========================================================================
// The global calibration hypothesis is about ONE score (Q1/Q2(b)): ECE-15 equal-mass
// over `document-raw-score`, the same number the frozen cut cuts. An ECE is a number
// whichever score produced it, so the gate cannot read the basis off it — the caller
// declares it and the gate refuses anything but the pre-registered one.
// ===========================================================================

describe("the ECE gate refuses a score basis that is not the pre-registered one", () => {
  it("fails the certifying calibration gate when the statistic came off the calibrated score", () => {
    const report = evaluateReleaseGates({
      ...passingEvidence,
      calibrationScoreBasis: "document-calibrated-score",
    });
    const gate = gateById(report.gates, "warning.calibration-ece");
    expect(gate.role).toBe("certifying");
    expect(gate.hypothesis).toBe("calibration-global");
    expect(gate.evidence).toBe("score-basis-mismatch");
    expect(gate.passed).toBe(false);
    // No number is published as the verdict: a comfortable ECE over the wrong score is
    // not a weaker piece of evidence, it is evidence about something else.
    expect(gate.observed).toBeNull();
    expect(gate.reasons[0]).toMatch(
      /a estatística foi medida sobre document-calibrated-score, e a hipótese calibration-global é sobre document-raw-score/u,
    );
    expect(report.decision).toBe("reject");
    expect(report.failedCertifying).toEqual(["warning.calibration-ece"]);
    // The mismatch is confined to the hypothesis it is about: the other six members
    // are decided normally.
    for (const id of report.multiplicity.gateIds.filter(
      (candidate) => candidate !== "warning.calibration-ece",
    )) {
      expect(gateById(report.gates, id).evidence).toBe("present");
    }
  });

  it("reads the basis from the policy rather than from a literal", () => {
    expect(PREREGISTRATION_V4.calibrationGate.scoreBasis).toBe(
      "document-raw-score",
    );
    // And the threshold cuts the SAME score, which is what makes an ECE over it a
    // statement about the published decision.
    expect(PREREGISTRATION_V4.threshold.basis).toBe(
      PREREGISTRATION_V4.calibrationGate.scoreBasis,
    );
    const gate = gateById(
      evaluateReleaseGates(passingEvidence).gates,
      "warning.calibration-ece",
    );
    expect(gate.evidence).toBe("present");
  });

  // The refusal was INEVITABLE, which is a different defect from the refusal being
  // wrong: `benchmark/commands/evaluate.ts` declared `document-calibrated-score` as the
  // only basis it could produce, so every certifying run reproved on this hypothesis by
  // construction and no measurement could pass. A conforming body now reaches a verdict.
  it("decides the calibration hypothesis on its number once the bases agree", () => {
    const report = evaluateReleaseGates(passingEvidence);
    const gate = gateById(report.gates, "warning.calibration-ece");
    expect(gate.observed).not.toBeNull();
    expect(gate.passed).toBe(true);
    expect(report.failedCertifying).toEqual([]);
    expect(
      report.gates.filter(
        (candidate) => candidate.evidence === "score-basis-mismatch",
      ),
    ).toEqual([]);
  });
});

// ===========================================================================
// The mandatory inventory IS the primary family (T12). Both directions, because a
// wrong wiring is silent in both: an inventory larger than `m` fails every
// certifying gate as if a budget had been breached, and an inventory smaller than
// the family certifies fewer hypotheses than the version promised while every gate
// reads green.
// ===========================================================================

describe("the mandatory inventory is derived from policy.primaryFamily", () => {
  it("names the four per-cell hypotheses after the frozen quota cells", () => {
    const cellHypotheses = PREREGISTRATION_V4.multiplicity.primaryFamily
      .filter((member) => member.startsWith("fpr-"))
      .map((member) => member.slice("fpr-".length));
    expect([...cellHypotheses].sort()).toEqual([...CERTIFYING_CELLS].sort());
    expect(PREREGISTRATION_V4.multiplicity.primaryFamily).toContain(
      "recall-at-threshold",
    );
    expect(PREREGISTRATION_V4.multiplicity.primaryFamily).toContain(
      "calibration-global",
    );
    expect(PREREGISTRATION_V4.multiplicity.primaryFamily).toContain(
      "integrity",
    );
  });

  it("covers the family at the frozen m, and passes", () => {
    const report = evaluateReleaseGates({
      ...passingEvidence,
      metrics: metrics({
        declaredM: PREREGISTRATION_V4.multiplicity.primaryFamilySize,
      }),
    });
    // m = 4 since the frame amendment, and the count is asserted as a LITERAL beside the
    // policy read: the divisor of alpha_família is the whole reason the family list is
    // frozen, so a test that only compared the report against the policy would follow it
    // anywhere.
    expect(PREREGISTRATION_V4.multiplicity.primaryFamilySize).toBe(4);
    expect(report.multiplicity.declared).toBe(4);
    expect(report.multiplicity.observed).toBe(4);
    expect([...report.multiplicity.hypotheses].sort()).toEqual(
      [...PREREGISTRATION_V4.multiplicity.primaryFamily].sort(),
    );
    expect(report.multiplicity.missingHypotheses).toEqual([]);
    expect(report.multiplicity.unexpectedHypotheses).toEqual([]);
    expect(report.multiplicity.covers).toBe(true);
    expect(report.decision).toBe("pass");
    expect(report.failedCertifying).toEqual([]);
  });

  it("a fifth mandatory gate makes covers false and names the hypothesis the family does not have", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        declaredM: PREREGISTRATION_V4.multiplicity.primaryFamilySize,
      }),
      // A second cell on the certifying axis: a FIFTH hypothesis, at full power and
      // with a flawless FPR, which is exactly why it must not be absorbed silently.
      slices: bareSummary([
        ...certifyingCellSlices(),
        cellSlice("b2w-reviews"),
      ]),
    });
    expect(report.multiplicity.observed).toBe(
      PREREGISTRATION_V4.multiplicity.primaryFamilySize + 1,
    );
    expect(report.multiplicity.unexpectedHypotheses).toEqual([
      "fpr-b2w-reviews",
    ]);
    expect(report.multiplicity.missingHypotheses).toEqual([]);
    expect(report.multiplicity.covers).toBe(false);
    expect(report.decision).toBe("reject");
    // Every certifying gate fails, and none of them for a breached budget.
    expect(report.failedCertifying.length).toBeGreaterThan(0);
    for (const id of report.multiplicity.gateIds) {
      const gate = gateById(report.gates, id);
      expect(gate.evidence).toBe("missing-simultaneous-interval");
      expect(gate.reasons[0]).toMatch(
        /o inventário obrigatório não é a família primária/u,
      );
      expect(gate.reasons[0]).toMatch(
        new RegExp(
          `fpr-b2w-reviews não está entre os ${PREREGISTRATION_V4.multiplicity.primaryFamilySize}`,
          "u",
        ),
      );
    }
  });

  it("a topic slice at full power adds no hypothesis and no gate", () => {
    // Forced gate-eligible, which `buildSlices` never does for a diagnostic axis: this
    // exercises the SECOND barrier — gates.ts keeps its own `FPR_AXES`, and a topic slice
    // that arrived eligible must still build no gate. The FPR is catastrophic on purpose,
    // so a gate built from it could not pass unnoticed.
    const report = evaluateReleaseGates({
      ...passingEvidence,
      metrics: metrics({
        declaredM: PREREGISTRATION_V4.multiplicity.primaryFamilySize,
      }),
      slices: bareSummary([
        ...certifyingCellSlices(),
        slice({
          axis: "topic",
          key: "geografia",
          negatives: 4_000,
          positives: 4_000,
          fprGateEligible: true,
          recallGateEligible: true,
          warningFprUpper: 0.99,
          actionFprUpper: 0.99,
        }),
      ]),
    });
    expect(report.multiplicity.observed).toBe(
      PREREGISTRATION_V4.multiplicity.primaryFamilySize,
    );
    expect(report.multiplicity.unexpectedHypotheses).toEqual([]);
    expect(report.multiplicity.missingHypotheses).toEqual([]);
    expect(report.multiplicity.covers).toBe(true);
    expect(report.decision).toBe("pass");
    expect(report.gates.filter((gate) => gate.slice?.axis === "topic")).toEqual(
      [],
    );
    expect(report.gates.map((gate) => gate.id)).not.toContain(
      "warning.fpr.slice.topic.geografia",
    );
  });

  it("refuses a fifth hypothesis even under a divisor large enough to cover the count", () => {
    // A larger `m` is conservative and is accepted — it only widens every bound — but
    // it buys no membership: the family has its frozen members whatever the divisor is,
    // and a count check alone would let the extra hypothesis through here.
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({ declaredM: 40 }),
      slices: bareSummary([
        ...certifyingCellSlices(),
        cellSlice("b2w-reviews"),
      ]),
    });
    expect(report.multiplicity.declared).toBe(40);
    expect(report.multiplicity.observed).toBe(
      PREREGISTRATION_V4.multiplicity.primaryFamilySize + 1,
    );
    expect(report.multiplicity.unexpectedHypotheses).toEqual([
      "fpr-b2w-reviews",
    ]);
    expect(report.multiplicity.covers).toBe(false);
    expect(report.decision).toBe("reject");
  });

  it("a missing cell makes covers false and names the hypothesis nothing decided", () => {
    const absent = CERTIFYING_CELLS[0];
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        declaredM: PREREGISTRATION_V4.multiplicity.primaryFamilySize,
      }),
      slices: bareSummary(
        CERTIFYING_CELLS.filter((cell) => cell !== absent).map((cell) =>
          cellSlice(cell),
        ),
      ),
    });
    expect(report.multiplicity.observed).toBe(
      PREREGISTRATION_V4.multiplicity.primaryFamilySize - 1,
    );
    expect(report.multiplicity.missingHypotheses).toEqual([`fpr-${absent}`]);
    expect(report.multiplicity.unexpectedHypotheses).toEqual([]);
    expect(report.multiplicity.covers).toBe(false);
    expect(report.decision).toBe("reject");
    const gate = gateById(report.gates, "warning.recall.overall");
    expect(gate.reasons[0]).toMatch(
      new RegExp(`nenhum gate deste relatório decide fpr-${absent}`, "u"),
    );
  });

  it("refuses a corpus whose humanSourceType carries the retired register names instead of the quota cells", () => {
    // The FPR ceilings are named after quota CELLS. A corpus whose axis carries the
    // register vocabulary the frame amendment retired produces hypotheses the family does
    // not name and leaves its own undecided, and the report says both.
    //
    // The register words are written down here rather than read from the policy, and that
    // is the point of the test after the amendment: `humanCoreStrata` IS the cell list
    // now, so reading the "other" vocabulary out of the policy would compare the cells
    // against themselves and pass without measuring anything.
    const retired = ["encyclopedic", "judicial", "social-media", "university"];
    for (const word of retired) {
      expect([...PREREGISTRATION_V4.humanCoreStrata]).not.toContain(word);
      expect([...CERTIFYING_CELLS]).not.toContain(word);
    }
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        declaredM: PREREGISTRATION_V4.multiplicity.primaryFamilySize,
      }),
      slices: bareSummary(retired.map((stratum) => cellSlice(stratum))),
    });
    expect(report.multiplicity.covers).toBe(false);
    expect(report.multiplicity.missingHypotheses).toEqual(
      CERTIFYING_CELLS.map((cell) => `fpr-${cell}`),
    );
    expect(report.multiplicity.unexpectedHypotheses).toEqual(
      retired.map((stratum) => `fpr-${stratum}`),
    );
    expect(report.decision).toBe("reject");
  });

  it("reads the certifying ceilings off ONE axis: the same cell key elsewhere is a diagnostic", () => {
    const cell = CERTIFYING_CELLS[0];
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        declaredM: PREREGISTRATION_V4.multiplicity.primaryFamilySize,
      }),
      slices: summary([
        slice({
          axis: "domain",
          key: cell,
          negatives: 400,
          fprGateEligible: true,
          warningFprUpper: 0.02,
          actionFprUpper: 0.01,
        }),
      ]),
    });
    // The family and nothing more: the cell key on another axis buys no membership.
    expect(report.multiplicity.observed).toBe(
      PREREGISTRATION_V4.multiplicity.primaryFamilySize,
    );
    expect(report.multiplicity.covers).toBe(true);
    const elsewhere = gateById(
      report.gates,
      `warning.fpr.slice.domain.${cell}`,
    );
    expect(elsewhere.role).toBe("diagnostic");
    expect(elsewhere.hypothesis).toBeUndefined();
    expect(
      gateById(report.gates, `warning.fpr.slice.humanSourceType.${cell}`)
        .hypothesis,
    ).toBe(`fpr-${cell}`);
  });
});

describe("human-negative label bases as gate evidence", () => {
  it("gates on a powered basis that breaches the warning budget", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        labelBases: [
          basis("date-cutoff", { count: 900, powered: true, fprUpper: 0.09 }),
        ],
      }),
      slices: summary([passingSlice()]),
    });
    // A label basis is evidence ABOUT the human label and not a member of the certifying
    // family, so a breach certifies nothing — and blocks: the basis is the evidence
    // the whole human-negative denominator rests on.
    expect(report.decision).toBe("reject");
    expect(report.failedCertifying).toEqual([]);
    const gate = gateById(report.gates, "warning.fpr.labelBasis.date-cutoff");
    expect(gate.eligible).toBe(true);
    expect(gate.role).toBe("diagnostic");
    expect(gate.passed).toBe(false);
    expect(gate.sampleSize).toBe(900);
  });

  it("lets an under-powered observed-process basis neither approve a gate nor lift the action ceiling", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
    const floor = PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives;
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
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
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({ errorRate: 0.009 }),
      slices: summary([passingSlice()]),
    });
    expect(gateById(report.gates, "integrity.error-rate").passed).toBe(true);
    expect(report.decision).toBe("pass");
  });

  // Member seven of the family is the whole CONJUNCTION, and it is the one member the
  // inventory does not derive from the presence of a gate: it is always counted. So
  // what the inventory cannot notice is the conjunction SHRINKING — dropping a boolean
  // leaves `observed` at seven and `covers` true — and this list is the guard. Every id
  // is named, so removing or renaming one fails here with the id in the diff.
  it("names every boolean of the integrity conjunction, the member the inventory always counts", () => {
    const report = evaluateReleaseGates(passingEvidence);
    const integrityIds = report.gates
      .filter((gate) => gate.tier === "integrity")
      .map((gate) => gate.id);
    expect(integrityIds).toEqual([
      "integrity.scientific-use",
      "integrity.license-inventory",
      "integrity.review-ledger-hash",
      "integrity.source-manifest-hash",
      "integrity.dataset-audit-sealed",
      "integrity.source-readiness-ready",
      "integrity.schema",
      "integrity.dataset-digest",
      "integrity.split-digest",
      "integrity.evaluator-digest",
      "integrity.calibration-digest",
      "integrity.split-audit",
      "integrity.prediction-completeness",
      "integrity.prediction-manifest-digests",
      "integrity.runtime-identity",
      "integrity.holdout-session",
      "integrity.error-rate",
    ]);
    // One hypothesis, seventeen booleans: alpha/7 spent on a boolean conjunction is
    // conservatism, and one share per boolean would divide the alpha by 23.
    for (const id of integrityIds) {
      expect(gateById(report.gates, id)).toMatchObject({
        role: "certifying",
        hypothesis: "integrity",
      });
    }
    expect(
      report.multiplicity.hypotheses.filter((h) => h === "integrity"),
    ).toEqual(["integrity"]);
    expect(report.multiplicity.gateIds).not.toContain("integrity.error-rate");
  });
});

// ===========================================================================
// B2 — the frozen three-target table, at the gate boundary.
// ===========================================================================

describe("the material-assistance block is published without deciding (B2)", () => {
  const cohort = (
    sampleSize: number,
    warningRecall: number,
    warningRecallLower95: number,
  ) => ({
    generationMode: "mechanistic" as const,
    sampleSize,
    warningRecall,
    warningRecallLower95,
  });

  it("carries the floor it was GIVEN, so the number travels instead of being restated", () => {
    // 0.42 is not the frozen floor and is not a value anywhere in the production
    // path: a producer that read the policy itself, or that hard-coded 0.5, fails
    // here. `expect(floor).toBe(policyFloor)` with the policy floor as the input is
    // satisfied by a literal 0.5 in the source and proves nothing.
    expect(mixedRecallDiagnostics(cohort(200, 0.49, 0.42), 0.42).floor).toBe(
      0.42,
    );
    expect(mixedRecallDiagnostics(cohort(200, 0.49, 0.42), 0.5).floor).toBe(
      0.5,
    );
  });

  it("publishes the observed recall, the interval and the cohort, and NO verdict field", () => {
    const block = mixedRecallDiagnostics(cohort(200, 0.49, 0.42), 0.5);
    expect([...Object.keys(block)].sort()).toEqual([
      "decides",
      "floor",
      "generationMode",
      "lower95",
      "observed",
      "role",
      "sampleSize",
      "spendsAlpha",
    ]);
    // Named separately from the key list above, because these two are the ones that
    // turn the block back into a gate the moment either returns.
    expect(Object.keys(block)).not.toContain("passed");
    expect(Object.keys(block)).not.toContain("tier");
    expect(block).toMatchObject({
      role: "diagnostic",
      decides: false,
      spendsAlpha: false,
      generationMode: "mechanistic",
      observed: 0.49,
      lower95: 0.42,
      sampleSize: 200,
    });
  });

  it("publishes neither a recall nor its bound for an empty cohort, instead of a zero it never measured", () => {
    // A LOWER BOUND of zero beside an absent point estimate reads as a measured floor
    // of zero, so both fields go null on the same condition. The input hands a finite
    // 0 as the bound precisely so a producer that passed it through fails here.
    const empty = mixedRecallDiagnostics(cohort(0, Number.NaN, 0), 0.5);
    expect(empty.observed).toBeNull();
    expect(empty.lower95).toBeNull();
    expect(empty.sampleSize).toBe(0);
    // The contrast, so the assertions above are a difference and not a constant: one
    // measured row publishes both numbers, zero included.
    const measured = mixedRecallDiagnostics(cohort(1, 0, 0), 0.5);
    expect(measured.observed).toBe(0);
    expect(measured.lower95).toBe(0);
  });
});

describe("the v1 may ship blind to mixed text — ACCEPTED RESIDUE, executable", () => {
  // Not a claim about what SHOULD happen: this is the residue the operator ratified,
  // written so nobody rediscovers it by reading the model card. After this, the only
  // barrier against a release that hides the limitation is TEXT — `limitations.md`
  // and the model card of Phase 6 — and text is not a gate.
  //
  // TWENTY POINTS under the frozen floor, and the number is derived from the policy
  // rather than typed, so a rearm that raises the floor raises this cohort with it.
  const FLOOR = PREREGISTRATION_V4.materialAssistance.minimumWarningRecall;
  const subFloor = {
    generationMode: "mechanistic" as const,
    sampleSize: 100,
    warningRecall: FLOOR - 0.2,
    warningRecallLower95: FLOOR - 0.3,
  };

  it("decides pass on a gate report whose material-assistance cohort misses the floor by twenty points", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({ mixed: subFloor }),
      slices: summary([passingSlice()]),
    });
    expect(subFloor.warningRecall).toBeLessThan(FLOOR);
    expect(report.decision).toBe("pass");
  });

  it("publishes the profile set AND re-parses it at the runtime loader carrying that same sub-floor cohort", async () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({ mixed: subFloor }),
      slices: summary([passingSlice()]),
    });
    // The cohort is handed to `publicationInputFor` EXPLICITLY. It rebuilds the metrics
    // from its own fixture and reads only `gates.decision` off the report, so a cohort
    // left off this argument would be silently replaced by the fixture's above-floor
    // one and nothing below would be about 0.30 at all.
    const input = publicationInputFor(report, subFloor);
    expect(input.report.metrics.mixed.atLeastHalfAi.warningRecall).toBe(
      subFloor.warningRecall,
    );

    const published = await buildModelPublication(input);
    expect(published.profiles.profiles.length).toBeGreaterThan(0);
    expect(published.release.rolloutState).toBe("indicator");
    // `buildModelPublication` re-parses its own output through the parser the runtime
    // uses at load, so these are the PARSED profiles: the sub-floor recall crossed the
    // publisher and the loader untouched, and every published band carries it.
    for (const profile of published.profiles.profiles) {
      expect(profile.gateEvidence.overall.mixedRecall.estimate).toBe(
        subFloor.warningRecall,
      );
      expect(profile.gateEvidence.overall.mixedRecall.sampleSize).toBe(
        subFloor.sampleSize,
      );
    }
  });
});

describe("an empty mixed cohort still blocks the profile it would be published in", () => {
  it("refuses the publication for sampleSize 0, so disarming the gate cannot be followed by emptying the cohort", async () => {
    const passed = evaluateReleaseGates(passingEvidence);
    expect(passed.decision).toBe("pass");
    const input = publicationInputFor(passed);
    const emptied = {
      ...input,
      report: {
        ...input.report,
        metrics: {
          ...input.report.metrics,
          mixed: {
            ...input.report.metrics.mixed,
            atLeastHalfAi: {
              ...input.report.metrics.mixed.atLeastHalfAi,
              sampleSize: 0,
            },
          },
        },
      },
    };
    await expect(buildModelPublication(emptied)).rejects.toMatchObject({
      code: "GATE_EVIDENCE_INCOMPLETE",
    });

    // And the same input with the cohort intact publishes, carrying the evidence off
    // `metrics.mixed.atLeastHalfAi` — which is why `profile-artifact.ts` needed no
    // edit: it never read the gate.
    const published = await buildModelPublication(input);
    const evidence = published.profiles.profiles[0]?.gateEvidence.overall;
    expect(evidence?.mixedRecall.estimate).toBe(
      input.report.metrics.mixed.atLeastHalfAi.warningRecall,
    );
    expect(evidence?.mixedRecall.sampleSize).toBe(
      input.report.metrics.mixed.atLeastHalfAi.sampleSize,
    );
  });
});

describe("material assistance never authorizes visual action (B2)", () => {
  it("reads the action recall gate off the integral-positive population", () => {
    // The visual-action matrix looks excellent because mixed rows crossed the
    // action threshold; the INTEGRAL positives did not. The gate must read the
    // second number, so a material-assistance cohort can never lift the ceiling.
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        visual: { fpr: upper(0.01), recall: lower(0.95) },
        actionAuthorizationRecall: lower(0.1),
      }),
      slices: summary([passingSlice()]),
    });
    const gate = gateById(report.gates, "action.recall.overall");
    expect(gate.passed).toBe(false);
    expect(gate.observed).toBe(0.1);
    expect(report.decision).toBe("indicator-only");
  });

  it("passes when the integral positives carry the recall themselves", () => {
    const report = evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metrics({
        visual: { fpr: upper(0.01), recall: lower(0.36) },
        actionAuthorizationRecall: lower(0.6),
      }),
      slices: summary([passingSlice()]),
    });
    expect(gateById(report.gates, "action.recall.overall").observed).toBe(0.6);
    expect(report.decision).toBe("pass");
  });
});

// The frozen decision's wording is "não é positivo nem negativo de gate": a
// sub-floor mixed row enters no CLASS population. That is not the same claim as
// "no gate observes it at all", and the difference is measurable. Two gates take
// their denominator from the ELIGIBLE SET rather than from a class:
// `integrity.error-rate` and `warning.coverage`. A sub-floor mixed row is
// eligible (PT-BR, 120 words), so it lands in both denominators.
//
// The first version of this block fed a `scored` sub-floor row, which raises
// coverage's numerator and denominator together — the value is 1 in both arms, so
// the `toEqual` held for `warning.coverage` vacuously while the prose beside it
// claimed the gate was not an exception. The undecided rows below are the case
// that separates the two.
describe("mixed below the AI-fraction floor enters no gate denominator (B2)", () => {
  // Fed through the REAL metrics pipeline, not a hand-built matrix: the claim is
  // about what `computeEvaluationMetrics` puts in a denominator.
  const base: readonly EvaluationItem[] = [
    ...Array.from({ length: 400 }, (_, index) =>
      humanNegativeWithoutBasis(`n${index}`),
    ),
    ...Array.from({ length: 200 }, (_, index) => aiPositive(`p${index}`)),
  ];
  // One abstained and one errored sub-floor row: the two undecided statuses, so
  // the coverage numerator stays put while its denominator grows.
  const withDiagnosticRows: readonly EvaluationItem[] = [
    ...base,
    mixedRow(0.25, "d0", "abstained"),
    mixedRow(0.25, "d1", "error"),
  ];

  // Memoised per population. Two populations reach the real pipeline and the four
  // tests below want them six times between them; at the frozen 10.000 replicates
  // each resolution is a few hundred milliseconds of resampling, and recomputing a
  // deterministic result from an identical input asserts nothing extra.
  const metricsCache = new Map<readonly EvaluationItem[], EvaluationMetrics>();
  const metricsOf = (items: readonly EvaluationItem[]): EvaluationMetrics => {
    const cached = metricsCache.get(items);
    if (cached !== undefined) return cached;
    const computed = computeEvaluationMetrics(items, {
      bootstrapSeed: 20260726,
      preRegisteredStatisticalGates: M,
    });
    metricsCache.set(items, computed);
    return computed;
  };

  const of = (items: readonly EvaluationItem[]): GateResult[] =>
    evaluateReleaseGates({
      integrity: integrity(),
      calibrationScoreBasis: CERTIFYING_SCORE_BASIS,
      resampling: plan(),
      metrics: metricsOf(items),
      slices: summary([passingSlice()]),
    }).gates.filter((gate) => gate.tier !== "integrity");

  const COVERAGE = "warning.coverage";

  it("leaves every warning and action gate except warning.coverage byte-identical", () => {
    const without = (gates: readonly GateResult[]): GateResult[] =>
      gates.filter((gate) => gate.id !== COVERAGE);

    expect(without(of(withDiagnosticRows))).toEqual(without(of(base)));
  });

  it("moves warning.coverage, whose denominator is the eligible set and not a class", () => {
    const before = gateById(of(base), COVERAGE);
    const after = gateById(of(withDiagnosticRows), COVERAGE);

    // 600/600 -> 600/602. This is the coverage estimand doing exactly what it is
    // defined to do (`proportionEstimate(eligible scored, eligibleCount)`), NOT a
    // class denominator absorbing a diagnostic row: near the floor a large enough
    // sub-floor cohort could flip this gate, which is why it is named here rather
    // than filtered out.
    expect(before.observed).toBe(1);
    expect(after.observed).toBe(600 / 602);
    expect(after.passed).toBe(true);
  });

  it("counts the sub-floor rows as neither a positive nor a negative of any class", () => {
    const before = metricsOf(base);
    const after = metricsOf(withDiagnosticRows);

    for (const family of ["endToEnd", "conditionalOnScored"] as const) {
      expect(after.warning[family].positives).toBe(
        before.warning[family].positives,
      );
      expect(after.warning[family].negatives).toBe(
        before.warning[family].negatives,
      );
      expect(after.visualAction?.[family].positives).toBe(
        before.visualAction?.[family].positives,
      );
      expect(after.visualAction?.[family].negatives).toBe(
        before.visualAction?.[family].negatives,
      );
    }
    expect(after.actionAuthorization?.positives).toBe(
      before.actionAuthorization?.positives,
    );
    // The gated material-assistance cohort is `aiFraction >= 0.50`, so a 0.25 row
    // is not in its denominator either.
    expect(after.mixed.atLeastHalfAi.sampleSize).toBe(
      before.mixed.atLeastHalfAi.sampleSize,
    );
    // It IS in the eligible set, which is what moved coverage above.
    expect(after.coverage.value).toBeLessThan(before.coverage.value);
  });
});

describe("decision is driven only by gate outcomes", () => {
  it("does not let a perfect isolated score override a failed certifying gate", () => {
    const report = evaluateReleaseGates({
      ...certifyingCellBreach,
      // AUROC pinned to a perfect 1, yet a per-cell FPR ceiling is broken.
      metrics: metrics({ auroc: 1 }),
    });
    expect(report.decision).toBe("reject");
  });

  it("prefers reject when both a certifying and an action gate fail", () => {
    const report = evaluateReleaseGates({
      ...certifyingCellBreach,
      metrics: metrics({
        visual: { fpr: upper(0.09), recall: lower(0.5) },
      }),
    });
    expect(report.failedWarning.length).toBeGreaterThan(0);
    expect(report.failedAction.length).toBeGreaterThan(0);
    expect(report.decision).toBe("reject");
  });
});

// ===========================================================================
// What the decision AUTHORIZES, measured through the consumer instead of asserted
// about the string. `indicator-only` is not a lower ceiling than `reject`: it is the
// frontier between not publishing and publishing, and the only way to see that is to
// hand `buildModelPublication` a report `evaluateReleaseGates` produced.
// ===========================================================================

describe("the decision reaches the publisher", () => {
  it("publishes nothing for a diagnostic warning breach, and the whole profile set for a pass", async () => {
    const rejected = evaluateReleaseGates(warningFprFailure);
    // A pooled FPR over budget: it certifies nothing — and it blocks.
    expect(rejected.failedWarning).toEqual(["warning.fpr.overall"]);
    expect(rejected.failedCertifying).toEqual([]);
    expect(rejected.decision).toBe("reject");

    const blocked = await buildModelPublication(publicationInputFor(rejected));
    // `bundle-verified` authorizes nothing: the active runtime stays the built-in
    // stylometric scorer and no calibration profile exists for the weights.
    expect(blocked.profiles.profiles).toEqual([]);
    expect(blocked.release.profileDigests).toEqual([]);
    expect(blocked.release.rolloutState).toBe("bundle-verified");
    expect(blocked.release.gateDecision).toBe("reject");

    // The contrast, so the assertion above is a difference and not a constant: a
    // clean run publishes the profile set and makes the weights the active runtime.
    const passed = evaluateReleaseGates(passingEvidence);
    expect(passed.decision).toBe("pass");
    const published = await buildModelPublication(publicationInputFor(passed));
    expect(published.profiles.profiles.length).toBeGreaterThan(0);
    expect(published.release.profileDigests.length).toBe(
      published.profiles.profiles.length,
    );
    expect(published.release.rolloutState).toBe("indicator");
  });
});
