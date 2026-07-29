// Pure release-gate policy for the AI-text detector benchmark (§6.5).
//
// This module consumes the already-computed integrity evidence, overall
// EvaluationMetrics and per-slice SliceSummary and emits a fully structured
// GateReport plus the promotion decision. It is deliberately mechanical: every
// gate records which tier it belongs to, its scope (overall vs a named slice),
// the observed statistic, the bound it read (point / simultaneous / exact), the
// comparison operator, the required threshold, the sample size behind it,
// whether it was gate-eligible and whether it passed, with a human-readable
// reason on every failure. Nothing else — no isolated high score, no model-card
// metric, no partial result — can move the decision: it is a pure function of
// the failed-gate lists.
//
// The three §6.5 decision branches:
//   - a failed INTEGRITY or WARNING gate            => reject (stylometric stays)
//   - all warning gates pass but an ACTION gate fails => indicator-only
//   - every required warning and action gate passing  => pass
//
// The warning and action tiers treat under-powered critical cells asymmetrically
// and on purpose: an FPR cell below the pre-registered floor never blocks the
// warning budget (it is not gate-eligible), but it also cannot AUTHORIZE visual
// action, so it fails the action tier and caps the decision at indicator-only.
// That is the rule for the critical slices and, since A6, for the human-negative
// label bases too: a handful of `observed-process` rows cannot approve a gate,
// lift the action ceiling or back a stronger claim about the aggregate.
//
// Every operating-point gate reads the END-TO-END metric family
// (benchmark/metrics.ts): its denominator is the whole eligible set and a record
// whose inference failed counts as a non-detection, so it is never more favorable
// than the conditional family on recall or clearance. Reading the conditional
// family here would let a fragile run buy a pass with its own failures.
//
// THREE KINDS OF MISSING EVIDENCE FAIL A GATE, AND NONE DEGRADES QUIETLY (A6):
//
//   * The RESAMPLING PLAN. A Wilson or percentile interval over rows assumes the
//     rows are exchangeable. The corpus is not: authors, pages, threads, prompts
//     and generators induce dependence, and the unit of resampling is chosen per
//     estimand by C4. Until that plan exists and declares a hierarchical or
//     multiway unit for an estimand, the gate for that estimand FAILS for missing
//     evidence. It never falls back to treating rows as independent, which is the
//     silent version of the same decision and the one that inflates confidence.
//   * The SIMULTANEOUS BOUND. Dozens of one-sided gates share one release
//     decision, so an individual 95% bound per gate does not control the
//     family-wise error rate. Each interval gate reads the Bonferroni bound at
//     `alpha_família / m` that benchmark/metrics.ts publishes on the estimate; the
//     individual 95% bound stays in the report, marked descriptive, and is never
//     the verdict. `m` is the caller's PRE-REGISTERED count (frozen in G5), never
//     derived from the data: if a cell loses power it stays inside `m` and fails,
//     because a divisor that shrinks with the evidence is not a correction. When
//     the declared `m` does not cover the mandatory gates this report produced,
//     every interval gate fails — the alpha is never quietly recomputed.
//   * The RESAMPLING EFFORT behind that bound. A percentile read at
//     `alpha_família / m` sits `alpha * (n - 1)` order statistics from the extreme
//     of the replicate distribution: with m = 40 and the 2000 replicates
//     benchmark/bootstrap.ts executes today, the verdict would rest on two or
//     three replicates. The frozen contract pre-registers 10.000 in the pilot and
//     says never to reduce the count, so a bound thinner than that is missing
//     evidence, not a faster measurement. Only the percentile path is checked; the
//     Wilson bound is analytic and resamples nothing.
//
// Frozen numbers come from benchmark/rebuild-v3-policy.json through
// benchmark/rebuild-v3-policy.ts; the FPR budgets, the ECE ceiling, the family
// alpha and — since B2 — the material-assistance recall floor are not written down
// here. The remaining §6.5 thresholds (the two recall floors, coverage, the
// inference error ceiling) are not rows of that frozen table and stay as named
// constants below.
//
// WHICH POPULATION AUTHORIZES WHAT (B2). The frozen three-target table gives each
// target its own ceiling, and two of the three consequences are enforced here:
// `warning.mixed-recall` reads ONE cohort (mechanistic material assistance at or
// above the frozen AI fraction) and `action.recall.overall` reads the INTEGRAL
// positives only, so a material-assistance cohort can raise a warning recall but
// can never raise the recall that lifts `actionCeiling`.
//
// Mixed below the fraction floor is a positive of NO gate and a negative of NO
// gate — which is the frozen decision's exact wording, and is NOT the same claim
// as "no gate observes it". Two gates take their denominator from the ELIGIBLE
// SET rather than from a class, and a sub-floor mixed row is eligible, so it
// lands in both: `integrity.error-rate` (the inference-failure rate of the whole
// eligible set) and `warning.coverage` (scored over eligible — see
// `metrics.coverage`). MEASURED, not inferred: 20 human + 10 AI rows give
// coverage 1; adding one abstained mixed row at `aiFraction 0.25` gives
// 0.967741935483871. Near the 0.8 floor a large enough sub-floor cohort can
// therefore flip `warning.coverage`. That is the coverage estimand behaving as
// defined, not a class population absorbing a diagnostic row, and
// benchmark/tests/gates.test.ts names the gate instead of filtering it out.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Pure and deterministic: no Date, no randomness, no I/O of its own (the policy
// module reads its JSON once, at import).

import { isResampledPercentileMethod } from "./bootstrap.ts";
import type { ResamplingPlan, ResamplingPlanEntry } from "./bootstrap.ts";
import type {
  EvaluationMetrics,
  LabelBasisSlice,
  MetricEstimate,
} from "./metrics.ts";
import { REBUILD_V3_POLICY } from "./rebuild-v3-policy.ts";
import type { EceGateBound, ResamplingUnitKind } from "./rebuild-v3-policy.ts";
import type { SliceAxis, SliceResult, SliceSummary } from "./slices.ts";

export type ReleaseDecision = "pass" | "indicator-only" | "reject";

export type GateTier = "integrity" | "warning" | "action";
export type GateScope = "overall" | "slice";
export type GateBound =
  | "point"
  | "lower95"
  | "upper95"
  | "exact"
  | "simultaneous-lower"
  | "simultaneous-upper";
export type GateOperator = "<" | "<=" | ">=" | "==";

/** Why a gate could or could not read a bound at all. */
export type GateEvidence =
  // The bound the verdict needed was there.
  | "present"
  // No C4 plan declares a resampling unit for this estimand.
  | "missing-resampling-plan"
  // No multiplicity-corrected bound was published for this estimate, or the
  // declared `m` does not cover this report's mandatory gates.
  | "missing-simultaneous-interval"
  // A bound was published, the plan declares a unit for the estimand — and the
  // bound was not produced BY resampling that unit. An analytic Wilson bound over
  // correlated record-lines is the case that matters: it treats every row as
  // independent, which is the defect C4 exists to remove, and a declaration beside
  // it is not a property of the number (R7).
  | "unresampled-interval"
  // A percentile bound was published, but it was read from fewer replicates than
  // the frozen contract pre-registers, so at alpha_family / m it has no resolution.
  | "insufficient-resampling-effort"
  // The gate reads no interval (a boolean or an approved point gate), or the cell
  // has no pre-registered power and therefore no bound was read.
  | "not-applicable";

/** The individual 95% interval: published, labelled, and never the verdict. */
export interface DescriptiveBound {
  bound: "lower95" | "upper95";
  value: number | null;
  confidence: 0.95;
  role: "descriptive";
}

export interface GateResult {
  id: string;
  tier: GateTier;
  scope: GateScope;
  slice?: { axis: SliceAxis; key: string };
  // The estimand whose resampling unit C4's plan must declare. Absent on the
  // boolean integrity gates and on the approved point gates.
  estimand?: string;
  evidence: GateEvidence;
  observed: number | null;
  bound: GateBound;
  operator: GateOperator;
  required: number | boolean;
  // The DENOMINATOR of the statistic this gate decided, never a wider count: a
  // gate that reported the whole population while its rate was computed over the
  // scored subset overstates the n behind its own verdict (R7).
  sampleSize: number;
  // The population that denominator came out of, present only when the two
  // differ — an ECE over scored rows inside an eligible population, a label-basis
  // FPR over the scored rows of a basis. Both numbers are then visible at once.
  populationSize?: number;
  eligible: boolean;
  passed: boolean;
  descriptive?: DescriptiveBound;
  simultaneous?: { familyAlpha: number; m: number; alpha: number };
  reasons: string[];
}

/** How the family-wise alpha was split across the mandatory statistical gates. */
export interface MultiplicityReport {
  correction: "bonferroni";
  familyAlpha: number;
  descriptiveConfidence: number;
  frozenAt: "G5";
  // The pre-registered count the metrics were computed with; null when the caller
  // declared none, in which case no interval gate can read a corrected bound.
  declared: number | null;
  // The mandatory interval gates this run produced, under-powered cells included.
  observed: number;
  gateIds: string[];
  perGateAlpha: number | null;
  // Whether `declared` covers `observed`. False fails every interval gate.
  covers: boolean;
}

export interface GateReport {
  schemaVersion: 2;
  decision: ReleaseDecision;
  gates: GateResult[];
  multiplicity: MultiplicityReport;
  failedIntegrity: string[];
  failedWarning: string[];
  failedAction: string[];
}

// The outcomes of every upstream governance/identity validation the evaluate
// command performs before the gate policy runs. Each is a settled boolean the
// policy renders as one integrity gate; the error-rate gate reads the metrics.
export interface IntegrityEvidence {
  scientificUse: "release" | "diagnostic";
  licenseInventoryComplete: boolean;
  reviewLedgerHashMatches: boolean;
  sourceManifestHashMatches: boolean;
  datasetAuditSealed: boolean;
  sourceReadinessReady: boolean;
  schemaValid: boolean;
  datasetDigestMatches: boolean;
  splitDigestMatches: boolean;
  evaluatorDigestMatches: boolean;
  calibrationDigestMatches: boolean;
  splitAuditPassed: boolean;
  predictionCompleteness: boolean;
  predictionManifestDigestsMatch: boolean;
  runtimeIdentityUnique: boolean;
  holdoutSessionActive: boolean;
}

// One estimand's resampling unit, and the plan that holds them. The shapes moved
// to benchmark/bootstrap.ts when C4 produced the plan: the module that BUILDS a
// value owns its type, and the gate is a reader. Re-exported here so every
// consumer that learned the names from the gate keeps compiling.
export type { ResamplingPlan, ResamplingPlanEntry } from "./bootstrap.ts";

export interface GateInput {
  integrity: IntegrityEvidence;
  metrics: EvaluationMetrics;
  slices: SliceSummary;
  // C4's plan, or `null` when it does not exist yet. Required, not optional: a
  // caller must state that it has no plan rather than omit the question.
  resampling: ResamplingPlan | null;
}

// §6.5 thresholds that are NOT rows of the frozen rebuild table.
const WARNING_RECALL_MIN = 0.6;
const ACTION_RECALL_MIN = 0.35;
const COVERAGE_MIN = 0.8;
const MAX_ERROR_RATE = 0.01;

// Frozen rebuild contract.
const WARNING_FPR_MAX = REBUILD_V3_POLICY.fprBudgets.warning;
const ACTION_FPR_MAX = REBUILD_V3_POLICY.fprBudgets.visualAction;
const ECE_MAX = REBUILD_V3_POLICY.calibrationGate.eceMax;
// The material-assistance recall floor and the cohort it is measured over. B2
// made both rows of the frozen table: the FORMULATION changed (the denominator is
// now the `mechanistic` cohort at or above `aiFraction >= 0.50`, per assessment
// §4.5), so the number moved out of this file and into the policy. The VALUE is
// unchanged at 0.50 — R3 forbids loosening a limit, and nothing here was loosened.
const MIXED_WARNING_RECALL_MIN =
  REBUILD_V3_POLICY.materialAssistance.minimumWarningRecall;
const MATERIAL_ASSISTANCE_MODE =
  REBUILD_V3_POLICY.materialAssistance.generationMode;
// The frozen contract NAMES the bound the ECE gate reads, and the gate derives its
// direction from that name instead of restating it. The switch is exhaustive: a
// different declared bound stops compiling here rather than drifting away from the
// behaviour, which is the whole reason the field exists.
const ECE_DIRECTION: "upper" | "lower" = eceDirection(
  REBUILD_V3_POLICY.calibrationGate.eceBound,
);

function eceDirection(declared: EceGateBound): "upper" | "lower" {
  switch (declared) {
    case "bootstrap-simultaneous-upper":
      return "upper";
  }
}
const ALLOWED_UNIT_KINDS: ReadonlySet<string> = new Set(
  REBUILD_V3_POLICY.resampling.allowedUnitKinds,
);
const MINIMUM_DECLARED_REPLICATES = REBUILD_V3_POLICY.bootstrapReplicates.pilot;

// The estimand names the resampling plan must cover. One per family of gate, not
// one per cell: the unit of resampling is a property of the estimand, and every
// critical cell of the same estimand shares it.
const ESTIMAND_WARNING_FPR = "warning.fpr";
const ESTIMAND_WARNING_FPR_SLICE = "warning.fpr.slice";
const ESTIMAND_WARNING_FPR_LABEL_BASIS = "warning.fpr.labelBasis";
const ESTIMAND_WARNING_RECALL = "warning.recall";
const ESTIMAND_CALIBRATION_ECE = "calibration.ece";
const ESTIMAND_ACTION_FPR = "action.fpr";
const ESTIMAND_ACTION_FPR_SLICE = "action.fpr.slice";
const ESTIMAND_ACTION_FPR_LABEL_BASIS = "action.fpr.labelBasis";
const ESTIMAND_ACTION_RECALL = "action.recall";

// The critical FPR axes: only these need the pre-registered negative floor to
// gate the warning budget and to authorize visual action. Mirrors
// benchmark/slices.ts.
const FPR_AXES: ReadonlySet<SliceAxis> = new Set([
  "lengthBucket",
  "domain",
  "humanSourceType",
  "temporalCohort",
  "hardNegativeFamily",
]);

// --- gate specifications ---------------------------------------------------
//
// The gates are built in two passes because `m` is a property of the SET of
// mandatory gates: pass one describes them, pass two decides them under the
// alpha that follows from the count.

interface IntervalGateSpec {
  id: string;
  tier: "warning" | "action";
  scope: GateScope;
  slice?: { axis: SliceAxis; key: string };
  estimand: string;
  estimate: MetricEstimate | undefined;
  direction: "upper" | "lower";
  threshold: number;
  sampleSize: number;
  populationSize?: number;
  subject: string;
  eligible: boolean;
  // What an ineligible cell means in this tier.
  ineligible: { passed: boolean; reason: string | null };
}

interface DecidedContext {
  plan: ResamplingPlan | null;
  multiplicity: MultiplicityReport;
}

/**
 * The outcome of looking one estimand up in the resampling plan. A discriminated
 * rejection, not a bare `null`: all four ways a plan can fail to cover an estimand
 * fail the gate the same way, but they send an operator to four different places.
 */
export type ResamplingRejection =
  | "no-plan"
  | "no-entry"
  | "unit-kind-not-allowed"
  | "no-unit-axis"
  | "replicates-below-pilot";

type ResamplingLookup =
  | { ok: true; entry: ResamplingPlanEntry }
  | { ok: false; reason: ResamplingRejection; detail: string };

export function evaluateReleaseGates(input: GateInput): GateReport {
  const intervalSpecs = [
    ...warningIntervalSpecs(input.metrics, input.slices),
    ...actionIntervalSpecs(input.metrics, input.slices),
  ];

  const declared = input.metrics.multiplicity;
  const multiplicity: MultiplicityReport = {
    correction: "bonferroni",
    familyAlpha: REBUILD_V3_POLICY.multiplicity.familyAlpha,
    descriptiveConfidence: REBUILD_V3_POLICY.multiplicity.descriptiveConfidence,
    frozenAt: REBUILD_V3_POLICY.multiplicity.frozenAt,
    declared: declared === null ? null : declared.m,
    observed: intervalSpecs.length,
    gateIds: intervalSpecs.map((spec) => spec.id),
    perGateAlpha: declared === null ? null : declared.perGateAlpha,
    covers: declared !== null && declared.m >= intervalSpecs.length,
  };

  const context: DecidedContext = { plan: input.resampling, multiplicity };

  const gates: GateResult[] = [
    ...integrityGates(input.integrity, input.metrics),
    ...pointWarningGates(input.metrics),
    ...intervalSpecs
      .filter((spec) => spec.tier === "warning")
      .map((spec) => decideInterval(spec, context)),
    ...actionAvailabilityGate(input.metrics),
    ...intervalSpecs
      .filter((spec) => spec.tier === "action")
      .map((spec) => decideInterval(spec, context)),
  ];

  const failedIntegrity = failedIds(gates, "integrity");
  const failedWarning = failedIds(gates, "warning");
  const failedAction = failedIds(gates, "action");

  const decision: ReleaseDecision =
    failedIntegrity.length > 0 || failedWarning.length > 0
      ? "reject"
      : failedAction.length > 0
        ? "indicator-only"
        : "pass";

  return {
    schemaVersion: 2,
    decision,
    gates,
    multiplicity,
    failedIntegrity,
    failedWarning,
    failedAction,
  };
}

function failedIds(gates: readonly GateResult[], tier: GateTier): string[] {
  return gates
    .filter((gate) => gate.tier === tier && !gate.passed)
    .map((gate) => gate.id);
}

// --- integrity -------------------------------------------------------------

function integrityGates(
  evidence: IntegrityEvidence,
  metrics: EvaluationMetrics,
): GateResult[] {
  return [
    booleanGate(
      "integrity.scientific-use",
      evidence.scientificUse === "release",
      `scientificUse must be "release", was "${evidence.scientificUse}"`,
    ),
    booleanGate(
      "integrity.license-inventory",
      evidence.licenseInventoryComplete,
      "license inventory is incomplete or unverified",
    ),
    booleanGate(
      "integrity.review-ledger-hash",
      evidence.reviewLedgerHashMatches,
      "review ledger hash does not match the sealed manifest",
    ),
    booleanGate(
      "integrity.source-manifest-hash",
      evidence.sourceManifestHashMatches,
      "source manifest hash does not match the sealed manifest",
    ),
    booleanGate(
      "integrity.dataset-audit-sealed",
      evidence.datasetAuditSealed,
      "dataset audit is not sealed or is incoherent",
    ),
    booleanGate(
      "integrity.source-readiness-ready",
      evidence.sourceReadinessReady,
      "source readiness is not ready or is incoherent",
    ),
    booleanGate(
      "integrity.schema",
      evidence.schemaValid,
      "closed schema validation failed",
    ),
    booleanGate(
      "integrity.dataset-digest",
      evidence.datasetDigestMatches,
      "dataset digest does not match the sealed dataset",
    ),
    booleanGate(
      "integrity.split-digest",
      evidence.splitDigestMatches,
      "split digest does not match the frozen split",
    ),
    booleanGate(
      "integrity.evaluator-digest",
      evidence.evaluatorDigestMatches,
      "evaluator digest does not match the frozen evaluator",
    ),
    booleanGate(
      "integrity.calibration-digest",
      evidence.calibrationDigestMatches,
      "calibration artifact digest does not match the frozen calibration",
    ),
    booleanGate(
      "integrity.split-audit",
      evidence.splitAuditPassed,
      "split audit did not pass",
    ),
    booleanGate(
      "integrity.prediction-completeness",
      evidence.predictionCompleteness,
      "prediction completeness failed: a holdout record is missing, extra or duplicated",
    ),
    booleanGate(
      "integrity.prediction-manifest-digests",
      evidence.predictionManifestDigestsMatch,
      "one of the three prediction manifest digests does not match the sealed run",
    ),
    booleanGate(
      "integrity.runtime-identity",
      evidence.runtimeIdentityUnique,
      "bundle/aggregation/composition/tokenizer/runtime-parity/build/backend/Chrome is not the single frozen identity",
    ),
    booleanGate(
      "integrity.holdout-session",
      evidence.holdoutSessionActive,
      "no active consume-holdout session backs this evaluation",
    ),
    errorRateGate(metrics.errorRate.value),
  ];
}

function booleanGate(id: string, ok: boolean, detail: string): GateResult {
  return {
    id,
    tier: "integrity",
    scope: "overall",
    evidence: "not-applicable",
    observed: null,
    bound: "exact",
    operator: "==",
    required: true,
    sampleSize: 0,
    eligible: true,
    passed: ok,
    reasons: ok ? [] : [detail],
  };
}

function errorRateGate(value: number): GateResult {
  const observed = finiteOrNull(value);
  // The inference error rate must stay STRICTLY below 1%: exactly 0.01 is not
  // "below 1%" and fails the gate. An approved POINT gate, so no interval and no
  // resampling unit is involved.
  const passed = observed !== null && observed < MAX_ERROR_RATE;
  return {
    id: "integrity.error-rate",
    tier: "integrity",
    scope: "overall",
    evidence: "not-applicable",
    observed,
    bound: "point",
    operator: "<",
    required: MAX_ERROR_RATE,
    sampleSize: 0,
    eligible: true,
    passed,
    reasons: passed
      ? []
      : [`error rate ${show(observed)} is not below ${MAX_ERROR_RATE}`],
  };
}

// --- warning ---------------------------------------------------------------

// The two approved POINT gates of the warning tier. They read no interval, so
// there is no interval to correct for multiplicity and no resampling unit to
// declare; both facts are recorded as `evidence: "not-applicable"` rather than
// left to inference.
function pointWarningGates(metrics: EvaluationMetrics): GateResult[] {
  return [
    pointGate(
      "warning.coverage",
      "warning",
      metrics.coverage.value,
      ">=",
      COVERAGE_MIN,
      "coverage without abstention",
    ),
    mixedRecallGate(metrics.mixed.atLeastHalfAi),
  ];
}

function warningIntervalSpecs(
  metrics: EvaluationMetrics,
  slices: SliceSummary,
): IntervalGateSpec[] {
  const specs: IntervalGateSpec[] = [
    {
      id: "warning.fpr.overall",
      tier: "warning",
      scope: "overall",
      estimand: ESTIMAND_WARNING_FPR,
      estimate: metrics.warning.endToEnd.falsePositiveRate,
      direction: "upper",
      threshold: WARNING_FPR_MAX,
      sampleSize: metrics.warning.endToEnd.negatives,
      subject: "overall warning FPR",
      eligible: true,
      ineligible: { passed: true, reason: null },
    },
  ];

  for (const critical of criticalFprSlices(slices)) {
    specs.push({
      id: `warning.fpr.slice.${critical.axis}.${critical.key}`,
      tier: "warning",
      scope: "slice",
      slice: { axis: critical.axis, key: critical.key },
      estimand: ESTIMAND_WARNING_FPR_SLICE,
      estimate: critical.metrics.warning.endToEnd.falsePositiveRate,
      direction: "upper",
      threshold: WARNING_FPR_MAX,
      sampleSize: critical.negatives,
      subject: `critical FPR slice ${critical.axis}/${critical.key} warning FPR`,
      // Under-powered critical slices never gate the warning budget.
      eligible: critical.fprGateEligible,
      ineligible: { passed: true, reason: null },
    });
  }

  for (const basis of metrics.labelBasis.bases) {
    specs.push(labelBasisSpec(basis, "warning"));
  }

  specs.push({
    id: "warning.recall.overall",
    tier: "warning",
    scope: "overall",
    estimand: ESTIMAND_WARNING_RECALL,
    estimate: metrics.warning.endToEnd.recall,
    direction: "lower",
    threshold: WARNING_RECALL_MIN,
    sampleSize: metrics.warning.endToEnd.positives,
    subject: "overall warning recall",
    eligible: true,
    ineligible: { passed: true, reason: null },
  });

  specs.push({
    id: "warning.calibration-ece",
    tier: "warning",
    scope: "overall",
    estimand: ESTIMAND_CALIBRATION_ECE,
    // Equal-mass bins and an INTERVAL: the point estimate of ECE was the one
    // numeric gate in §6.5 with no bound at all (assessment §4.4).
    estimate: metrics.calibration.eceEqualMass15,
    direction: ECE_DIRECTION,
    threshold: ECE_MAX,
    // The ECE is computed over the SCORED rows of the binary population, not over
    // the eligible set: the denominator of the statistic is the n of the gate.
    sampleSize: metrics.calibration.scored,
    populationSize: metrics.calibration.populationSize,
    subject: `equal-mass ECE-${REBUILD_V3_POLICY.calibrationGate.eceBins}`,
    eligible: true,
    ineligible: { passed: true, reason: null },
  });

  return specs;
}

// One human-negative label basis as a gate cell. A basis is gate-eligible only
// when the metrics declared it powered; an under-powered or `unknown` basis is
// supplementary diagnostic, which means: it cannot approve the warning budget
// (not gating) and it cannot authorize visual action (fails the action tier).
function labelBasisSpec(
  basis: LabelBasisSlice,
  tier: "warning" | "action",
): IntervalGateSpec {
  const warning = tier === "warning";
  return {
    id: `${tier}.fpr.labelBasis.${basis.basis}`,
    tier,
    scope: "overall",
    estimand: warning
      ? ESTIMAND_WARNING_FPR_LABEL_BASIS
      : ESTIMAND_ACTION_FPR_LABEL_BASIS,
    estimate: basis.falsePositiveRate,
    direction: "upper",
    threshold: warning ? WARNING_FPR_MAX : ACTION_FPR_MAX,
    // The basis FPR has the SCORED negatives of the basis in its denominator; the
    // whole count is the population and is what the power floor is measured on, so
    // both travel.
    sampleSize: basis.scored,
    populationSize: basis.count,
    subject: `label basis ${basis.basis} ${tier} FPR`,
    eligible: basis.evidenceRole === "gating",
    ineligible: warning
      ? { passed: true, reason: null }
      : {
          passed: false,
          reason:
            `label basis ${basis.basis} is supplementary-diagnostic ` +
            `(${basis.count} human negatives against a floor of ${basis.powerFloor}): ` +
            "it cannot authorize visual action",
        },
  };
}

// The material-assistance gate. Its population is ONE cohort — the mechanistic
// one — at or above the frozen AI fraction, and the block it reads names that
// cohort itself, so a pooled figure could not reach this gate even if some future
// caller built one.
function mixedRecallGate(
  mixed: EvaluationMetrics["mixed"]["atLeastHalfAi"],
): GateResult {
  const eligible = mixed.sampleSize > 0;
  const observed = eligible ? finiteOrNull(mixed.warningRecall) : null;
  const passed =
    !eligible || (observed !== null && observed >= MIXED_WARNING_RECALL_MIN);
  return {
    id: "warning.mixed-recall",
    tier: "warning",
    scope: "overall",
    evidence: "not-applicable",
    observed,
    bound: "point",
    operator: ">=",
    required: MIXED_WARNING_RECALL_MIN,
    sampleSize: mixed.sampleSize,
    eligible,
    passed,
    // The mixed interval is reported for context but never substitutes the
    // approved point gate.
    reasons: passed
      ? []
      : [
          `${MATERIAL_ASSISTANCE_MODE} mixed >=${REBUILD_V3_POLICY.materialAssistance.minimumAiFraction} AI warning recall ${show(observed)} is below ${MIXED_WARNING_RECALL_MIN} (lower95 ${mixed.warningRecallLower95} reported, not gating)`,
        ],
  };
}

// --- action ----------------------------------------------------------------

// Visual action is available only when BOTH blocks are there: the matrix over the
// frozen action threshold and the authorizing statistic over the integral
// positives. `computeEvaluationMetrics` publishes them together, so requiring the
// pair costs nothing today and buys two things: `actionIntervalSpecs` can read a
// NON-NULL authorization (no `?? 0` sample size can hand the recall gate an empty
// denominator), and a metrics build that ever published one without the other
// fails HERE, loudly, instead of passing an action tier whose recall gate silently
// went missing.
function actionAvailabilityGate(metrics: EvaluationMetrics): GateResult[] {
  const missing = [
    metrics.visualAction === null ? "visualDocument" : null,
    metrics.actionAuthorization === null ? "actionAuthorization" : null,
  ].filter((name): name is string => name !== null);
  const available = missing.length === 0;
  return [
    {
      id: "action.available",
      tier: "action",
      scope: "overall",
      evidence: "not-applicable",
      observed: null,
      bound: "exact",
      operator: "==",
      required: true,
      sampleSize: 0,
      eligible: true,
      passed: available,
      reasons: available
        ? []
        : [
            "no visual-action evidence: " +
              `${missing.join(" and ")} ${missing.length === 1 ? "is" : "are"} null`,
          ],
    },
  ];
}

function actionIntervalSpecs(
  metrics: EvaluationMetrics,
  slices: SliceSummary,
): IntervalGateSpec[] {
  const visualAction = metrics.visualAction;
  // The authorizing block is required here, not defaulted: `actionAvailabilityGate`
  // fails the whole action tier when either block is missing, so returning no
  // specs is fail-CLOSED and the recall spec below reads a non-null denominator.
  const authorization = metrics.actionAuthorization;
  if (visualAction === null || authorization === null) return [];

  const specs: IntervalGateSpec[] = [
    {
      id: "action.fpr.overall",
      tier: "action",
      scope: "overall",
      estimand: ESTIMAND_ACTION_FPR,
      estimate: visualAction.endToEnd.falsePositiveRate,
      direction: "upper",
      threshold: ACTION_FPR_MAX,
      sampleSize: visualAction.endToEnd.negatives,
      subject: "overall action FPR",
      eligible: true,
      ineligible: { passed: true, reason: null },
    },
  ];

  for (const critical of criticalFprSlices(slices)) {
    specs.push({
      id: `action.fpr.slice.${critical.axis}.${critical.key}`,
      tier: "action",
      scope: "slice",
      slice: { axis: critical.axis, key: critical.key },
      estimand: ESTIMAND_ACTION_FPR_SLICE,
      estimate: critical.metrics.visualAction?.endToEnd.falsePositiveRate,
      direction: "upper",
      threshold: ACTION_FPR_MAX,
      sampleSize: critical.negatives,
      subject: `critical FPR slice ${critical.axis}/${critical.key} action FPR`,
      eligible: critical.fprGateEligible,
      ineligible: {
        // A critical FPR cell below the floor cannot authorize visual action: it
        // fails the action tier and caps the decision at indicator-only.
        passed: false,
        reason:
          `critical FPR slice ${critical.axis}/${critical.key} has ` +
          `${critical.negatives} human negatives ` +
          "(too few to authorize visual action)",
      },
    });
  }

  for (const basis of metrics.labelBasis.bases) {
    specs.push(labelBasisSpec(basis, "action"));
  }

  // The recall that AUTHORIZES visual action, over the integral-generation
  // positives alone (B2). It deliberately does NOT read
  // `visualAction.endToEnd.recall`: that matrix counts the warning positives, so
  // a cohort of mechanistic material-assistance rows crossing the action
  // threshold would raise it and lift `actionCeiling` to `hide` — and the frozen
  // table authorizes `indicator` and nothing more for that target. The block is
  // narrowed at the top of this function, so both the estimate and its denominator
  // come from the same non-null object; an absent block never arrives here as a
  // zero sample size, it fails `action.available` instead.
  specs.push({
    id: "action.recall.overall",
    tier: "action",
    scope: "overall",
    estimand: ESTIMAND_ACTION_RECALL,
    estimate: authorization.recall,
    direction: "lower",
    threshold: ACTION_RECALL_MIN,
    sampleSize: authorization.positives,
    subject: "overall action recall over integral positives",
    eligible: true,
    ineligible: { passed: true, reason: null },
  });

  return specs;
}

// --- deciding one interval gate -------------------------------------------

function decideInterval(
  spec: IntervalGateSpec,
  context: DecidedContext,
): GateResult {
  const bound: GateBound =
    spec.direction === "upper" ? "simultaneous-upper" : "simultaneous-lower";
  const descriptive = describe(spec);
  const base = {
    id: spec.id,
    tier: spec.tier,
    scope: spec.scope,
    ...(spec.slice === undefined ? {} : { slice: spec.slice }),
    estimand: spec.estimand,
    bound,
    operator: (spec.direction === "upper" ? "<=" : ">=") as GateOperator,
    required: spec.threshold,
    sampleSize: spec.sampleSize,
    ...(spec.populationSize === undefined ||
    spec.populationSize === spec.sampleSize
      ? {}
      : { populationSize: spec.populationSize }),
    descriptive,
  };

  // 1. No pre-registered power in this cell: nothing was read, and what that
  //    means is a property of the tier (§6.5), not of the evidence.
  if (!spec.eligible) {
    return {
      ...base,
      evidence: "not-applicable",
      observed: null,
      eligible: false,
      passed: spec.ineligible.passed,
      reasons: spec.ineligible.reason === null ? [] : [spec.ineligible.reason],
    };
  }

  // 2. No usable resampling unit for this estimand: fail, never assume rows. The
  //    reason names WHICH of the four ways the plan came up short, because "no
  //    plan declares this estimand" sent an operator looking for an entry that was
  //    right there with the wrong replicate count.
  const lookup = resamplingEntry(context.plan, spec.estimand);
  if (!lookup.ok) {
    return {
      ...base,
      evidence: "missing-resampling-plan",
      observed: null,
      eligible: true,
      passed: false,
      reasons: [
        `${spec.subject}: ${lookup.detail}; sem essa evidência o gate reprova e ` +
          "nunca cai para linhas independentes",
      ],
    };
  }

  // 3. No simultaneous bound to read (or a divisor that does not cover this
  //    report's mandatory gates): fail, never read the 95% bound instead.
  const simultaneous = spec.estimate?.simultaneous;
  if (!context.multiplicity.covers || simultaneous === undefined) {
    return {
      ...base,
      evidence: "missing-simultaneous-interval",
      observed: null,
      eligible: true,
      passed: false,
      reasons: [missingSimultaneousReason(spec, context)],
    };
  }

  // 4. A bound that does not come out of the declared unit. The plan lookup above
  //    proves a unit was DECLARED for this estimand; this proves the number the
  //    verdict rests on was drawn over it. Without this step the two are
  //    independent: a `declared-only` entry passed step 2 while the bound came from
  //    the analytic Wilson estimator, and the release decided a correlated-rows
  //    interval on the strength of a declaration the number never honoured.
  //
  //    It is checked on the ESTIMATE and not on `ResamplingPlanEntry.executed`,
  //    which is the stronger of the two and the only one that works everywhere: a
  //    slice's interval is drawn inside that slice's own metrics, so the aggregate
  //    plan says `declared-only` for `*.fpr.slice` while the slice's number IS
  //    resampled — reading `executed` there would fail a gate whose evidence
  //    exists. The reverse mistake is impossible: an estimate that names a
  //    resampled unit was produced by resampling it, because the estimator is the
  //    only thing that writes the field.
  const unresampled = unresampledFailure(
    spec.estimate,
    simultaneous,
    lookup.entry,
  );
  if (unresampled !== null) {
    return {
      ...base,
      evidence: "unresampled-interval",
      observed: null,
      eligible: true,
      passed: false,
      simultaneous: {
        familyAlpha: simultaneous.familyAlpha,
        m: simultaneous.m,
        alpha: simultaneous.alpha,
      },
      reasons: [`${spec.subject}: ${unresampled}`],
    };
  }

  // 5. A percentile bound read from fewer replicates than the frozen contract
  //    pre-registers. This is not a formatting quibble: at alpha_family / m the
  //    bound sits `alpha * (n - 1)` order statistics from the extreme, so with
  //    m = 40 and 2000 replicates the verdict rests on two of them. The frozen
  //    table says 10.000 replicates in the pilot and "nunca reduzir por tempo", so
  //    a thinner bound is missing evidence, not a cheaper measurement. Step 4 has
  //    already refused every non-percentile bound, so this reaches only percentile
  //    bounds.
  const effort = simultaneousEffortFailure(simultaneous);
  if (effort !== null) {
    return {
      ...base,
      evidence: "insufficient-resampling-effort",
      observed: null,
      eligible: true,
      passed: false,
      simultaneous: {
        familyAlpha: simultaneous.familyAlpha,
        m: simultaneous.m,
        alpha: simultaneous.alpha,
      },
      reasons: [`${spec.subject}: ${effort}`],
    };
  }

  const observed = finiteOrNull(
    spec.direction === "upper" ? simultaneous.upper : simultaneous.lower,
  );
  const passed =
    observed !== null &&
    (spec.direction === "upper"
      ? observed <= spec.threshold
      : observed >= spec.threshold);
  return {
    ...base,
    evidence: "present",
    observed,
    eligible: true,
    passed,
    simultaneous: {
      familyAlpha: simultaneous.familyAlpha,
      m: simultaneous.m,
      alpha: simultaneous.alpha,
    },
    reasons: passed
      ? []
      : [
          spec.direction === "upper"
            ? `${spec.subject} simultaneous upper bound ${show(observed)} exceeds ${spec.threshold}`
            : `${spec.subject} simultaneous lower bound ${show(observed)} is below ${spec.threshold}`,
        ],
  };
}

function describe(spec: IntervalGateSpec): DescriptiveBound {
  const value =
    spec.direction === "upper"
      ? spec.estimate?.upper95
      : spec.estimate?.lower95;
  return {
    bound: spec.direction === "upper" ? "upper95" : "lower95",
    value: finiteOrNull(value),
    confidence: 0.95,
    role: "descriptive",
  };
}

/**
 * Why the bound this gate would read is not evidence about the unit the plan
 * declares, or `null` when it is. Four ways it can fail, and each one names what a
 * reader has to go fix:
 *
 *   * the bound is analytic (Wilson) — it resamples nothing, so the declared unit
 *     played no part in it and every correlated record-line was counted as
 *     independent;
 *   * the estimate names no unit at all, so nothing connects it to the plan;
 *   * the unit's METHOD differs from the declared one — a hierarchical draw where
 *     the table crosses two factors understates the variance, and vice versa;
 *   * the unit's AXES differ from the declared ones, which is a different design
 *     wearing the estimand's name.
 */
function unresampledFailure(
  estimate: MetricEstimate | undefined,
  simultaneous: NonNullable<MetricEstimate["simultaneous"]>,
  entry: ResamplingPlanEntry,
): string | null {
  const declared = entry.unitAxes.join(
    entry.unitKind === "multiway" ? " × " : " ⊃ ",
  );
  if (!isResampledPercentileMethod(simultaneous.method)) {
    return (
      `o limite simultâneo veio do estimador "${simultaneous.method}", que não ` +
      `reamostra nada: o plano declara a unidade ${declared} para ` +
      `${entry.estimand}, mas o número trata registros-linha correlacionados como ` +
      "independentes; declarar a unidade não é medi-la (R7)"
    );
  }
  const unit = estimate?.resampling;
  if (unit === undefined) {
    return (
      "o limite diz ser percentil de bootstrap mas a estimativa não publica " +
      "unidade de reamostragem alguma, então não há como ligá-la à unidade " +
      `declarada (${declared})`
    );
  }
  if (unit.method !== entry.unitKind) {
    return (
      `a estimativa foi reamostrada com método "${unit.method}" enquanto o plano ` +
      `declara "${entry.unitKind}" para ${entry.estimand}; aninhar o que é cruzado ` +
      "(ou cruzar o que é aninhado) muda a variância"
    );
  }
  if (
    unit.axes.length !== entry.unitAxes.length ||
    unit.axes.some((axis, index) => axis !== entry.unitAxes[index])
  ) {
    return (
      `a estimativa foi reamostrada sobre ${unit.axes.join(" / ")} enquanto o ` +
      `plano declara ${declared} para ${entry.estimand}`
    );
  }
  return null;
}

// Why a resampled simultaneous bound cannot be read, or `null` when it can. Only
// the percentile path is checked: `wilson-one-sided` is an analytic bound with no
// replicates, so a replicate count would be meaningless there rather than absent.
function simultaneousEffortFailure(
  simultaneous: NonNullable<MetricEstimate["simultaneous"]>,
): string | null {
  if (!isResampledPercentileMethod(simultaneous.method)) return null;
  const replicates = simultaneous.replicates;
  if (replicates === undefined) {
    return (
      "o limite simultâneo é um percentil de bootstrap mas não declara quantas " +
      "réplicas o produziram; sem esse número o limite não é auditável"
    );
  }
  if (replicates < MINIMUM_DECLARED_REPLICATES) {
    return (
      `o limite simultâneo em alpha=${simultaneous.alpha} foi lido de ` +
      `${replicates} réplicas (cauda de ${simultaneous.tailReplicates ?? 0} ` +
      `réplicas), abaixo das ${MINIMUM_DECLARED_REPLICATES} pré-registradas; ` +
      "o contrato congelado diz para nunca reduzir a contagem de réplicas"
    );
  }
  return null;
}

function missingSimultaneousReason(
  spec: IntervalGateSpec,
  context: DecidedContext,
): string {
  const multiplicity = context.multiplicity;
  if (multiplicity.declared === null) {
    return (
      `${spec.subject}: nenhum m pré-registrado foi declarado, então não há ` +
      "limite unilateral simultâneo; o intervalo individual de 95% é descritivo " +
      "e não decide gate"
    );
  }
  if (multiplicity.declared < multiplicity.observed) {
    return (
      `${spec.subject}: o m declarado (${multiplicity.declared}) não cobre os ` +
      `${multiplicity.observed} gates estatísticos obrigatórios deste relatório; ` +
      "o divisor não é recalculado para caber"
    );
  }
  return (
    `${spec.subject}: a estimativa não trouxe limite simultâneo (o bootstrap ou ` +
    "o Wilson corrigido não foi produzido); o ponto não substitui o limite"
  );
}

// A plan entry is usable only when it declares one of the two allowed unit kinds,
// at least one dependence axis and at least the pre-registered pilot replicate
// count. NOTE: this checks the count DECLARED in the plan. The count actually
// EXECUTED is checked separately, against the same floor, by
// `simultaneousEffortFailure` on the published bound; reconciling the two against
// each other (declared == executed, per estimand) belongs to C6/G2.
function resamplingEntry(
  plan: ResamplingPlan | null,
  estimand: string,
): ResamplingLookup {
  if (plan === null) {
    return {
      ok: false,
      reason: "no-plan",
      detail:
        "nenhum plano de reamostragem foi declarado (C4 ainda não produziu um)",
    };
  }
  const entry = plan.entries.find(
    (candidate) => candidate.estimand === estimand,
  );
  if (entry === undefined) {
    return {
      ok: false,
      reason: "no-entry",
      detail: `o plano ${plan.planId} não tem entrada para o estimando ${estimand}`,
    };
  }
  if (!ALLOWED_UNIT_KINDS.has(entry.unitKind)) {
    return {
      ok: false,
      reason: "unit-kind-not-allowed",
      detail:
        `a entrada de ${estimand} declara unitKind "${entry.unitKind}", que não é ` +
        `uma das unidades permitidas (${[...ALLOWED_UNIT_KINDS].join(", ")})`,
    };
  }
  if (entry.unitAxes.length === 0) {
    return {
      ok: false,
      reason: "no-unit-axis",
      detail: `a entrada de ${estimand} não nomeia nenhum eixo de dependência`,
    };
  }
  if (
    !Number.isInteger(entry.replicates) ||
    entry.replicates < MINIMUM_DECLARED_REPLICATES
  ) {
    return {
      ok: false,
      reason: "replicates-below-pilot",
      detail:
        `a entrada de ${estimand} declara ${entry.replicates} réplicas, abaixo das ` +
        `${MINIMUM_DECLARED_REPLICATES} pré-registradas`,
    };
  }
  return { ok: true, entry };
}

// --- shared gate constructors ---------------------------------------------

function criticalFprSlices(slices: SliceSummary): SliceResult[] {
  return slices.slices.filter((slice) => FPR_AXES.has(slice.axis));
}

function pointGate(
  id: string,
  tier: GateTier,
  value: number,
  operator: "<=" | ">=",
  threshold: number,
  subject: string,
): GateResult {
  const observed = finiteOrNull(value);
  const passed =
    observed !== null &&
    (operator === "<=" ? observed <= threshold : observed >= threshold);
  const relation = operator === "<=" ? "exceeds" : "is below";
  return {
    id,
    tier,
    scope: "overall",
    evidence: "not-applicable",
    observed,
    bound: "point",
    operator,
    required: threshold,
    sampleSize: 0,
    eligible: true,
    passed,
    reasons: passed
      ? []
      : [`${subject} ${show(observed)} ${relation} ${threshold}`],
  };
}

function finiteOrNull(value: number | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function show(value: number | null): string {
  return value === null ? "n/a" : String(value);
}
