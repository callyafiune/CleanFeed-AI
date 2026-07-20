// Pure release-gate policy for the AI-text detector benchmark (§6.5).
//
// This module consumes the already-computed integrity evidence, overall
// EvaluationMetrics and per-slice SliceSummary and emits a fully structured
// GateReport plus the promotion decision. It is deliberately mechanical: every
// gate records which tier it belongs to, its scope (overall vs a named slice),
// the observed statistic, the bound it read (point / lower95 / upper95 / exact),
// the comparison operator, the required threshold, the sample size behind it,
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
// The warning and action tiers treat under-powered critical slices asymmetrically
// and on purpose: an FPR slice below the 300-negative floor never blocks the
// warning budget (it is not gate-eligible), but it also cannot AUTHORIZE visual
// action, so it fails the action tier and caps the decision at indicator-only.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Pure and deterministic: no Date, no randomness, no I/O.

import type { EvaluationMetrics, MetricEstimate } from "./metrics.ts";
import type { SliceAxis, SliceResult, SliceSummary } from "./slices.ts";

export type ReleaseDecision = "pass" | "indicator-only" | "reject";

export type GateTier = "integrity" | "warning" | "action";
export type GateScope = "overall" | "slice";
export type GateBound = "point" | "lower95" | "upper95" | "exact";
export type GateOperator = "<=" | ">=" | "==";

export interface GateResult {
  id: string;
  tier: GateTier;
  scope: GateScope;
  slice?: { axis: SliceAxis; key: string };
  observed: number | null;
  bound: GateBound;
  operator: GateOperator;
  required: number | boolean;
  sampleSize: number;
  eligible: boolean;
  passed: boolean;
  reasons: string[];
}

export interface GateReport {
  schemaVersion: 1;
  decision: ReleaseDecision;
  gates: GateResult[];
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

export interface GateInput {
  integrity: IntegrityEvidence;
  metrics: EvaluationMetrics;
  slices: SliceSummary;
}

// §6.5 thresholds, verbatim.
const WARNING_FPR_MAX = 0.05;
const ACTION_FPR_MAX = 0.02;
const WARNING_RECALL_MIN = 0.6;
const ACTION_RECALL_MIN = 0.35;
const COVERAGE_MIN = 0.8;
const ECE_MAX = 0.05;
const MIXED_WARNING_RECALL_MIN = 0.5;
const MAX_ERROR_RATE = 0.01;

// The critical FPR axes: only these need the 300-negative floor to gate the
// warning budget and to authorize visual action. Mirrors benchmark/slices.ts.
const FPR_AXES: ReadonlySet<SliceAxis> = new Set([
  "lengthBucket",
  "domain",
  "humanSourceType",
  "temporalCohort",
  "hardNegativeFamily",
]);

export function evaluateReleaseGates(input: GateInput): GateReport {
  const gates: GateResult[] = [
    ...integrityGates(input.integrity, input.metrics),
    ...warningGates(input.metrics, input.slices),
    ...actionGates(input.metrics, input.slices),
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
    schemaVersion: 1,
    decision,
    gates,
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
  const passed = observed !== null && observed <= MAX_ERROR_RATE;
  return {
    id: "integrity.error-rate",
    tier: "integrity",
    scope: "overall",
    observed,
    bound: "point",
    operator: "<=",
    required: MAX_ERROR_RATE,
    sampleSize: 0,
    eligible: true,
    passed,
    reasons: passed
      ? []
      : [`error rate ${show(observed)} exceeds ${MAX_ERROR_RATE}`],
  };
}

// --- warning ---------------------------------------------------------------

function warningGates(
  metrics: EvaluationMetrics,
  slices: SliceSummary,
): GateResult[] {
  const gates: GateResult[] = [];

  gates.push(
    upperGate(
      "warning.fpr.overall",
      "warning",
      metrics.warning.falsePositiveRate,
      WARNING_FPR_MAX,
      metrics.warning.negatives,
      "overall warning FPR",
    ),
  );

  for (const critical of criticalFprSlices(slices)) {
    gates.push(warningSliceFprGate(critical));
  }

  gates.push(
    lowerGate(
      "warning.recall.overall",
      "warning",
      metrics.warning.recall,
      WARNING_RECALL_MIN,
      metrics.warning.positives,
      "overall warning recall",
    ),
  );

  gates.push(
    pointGate(
      "warning.coverage",
      "warning",
      metrics.coverage.value,
      ">=",
      COVERAGE_MIN,
      "coverage without abstention",
    ),
  );

  gates.push(
    pointGate(
      "warning.ece15",
      "warning",
      metrics.ece15.value,
      "<=",
      ECE_MAX,
      "ECE-15",
    ),
  );

  gates.push(mixedRecallGate(metrics.mixed.atLeastHalfAi));

  return gates;
}

function warningSliceFprGate(slice: SliceResult): GateResult {
  const id = `warning.fpr.slice.${slice.axis}.${slice.key}`;
  if (!slice.fprGateEligible) {
    // Under-powered critical slices never gate the warning budget.
    return {
      id,
      tier: "warning",
      scope: "slice",
      slice: { axis: slice.axis, key: slice.key },
      observed: null,
      bound: "upper95",
      operator: "<=",
      required: WARNING_FPR_MAX,
      sampleSize: slice.negatives,
      eligible: false,
      passed: true,
      reasons: [],
    };
  }
  const observed = finiteOrNull(
    slice.metrics.warning.falsePositiveRate.upper95,
  );
  const passed = observed !== null && observed <= WARNING_FPR_MAX;
  return {
    id,
    tier: "warning",
    scope: "slice",
    slice: { axis: slice.axis, key: slice.key },
    observed,
    bound: "upper95",
    operator: "<=",
    required: WARNING_FPR_MAX,
    sampleSize: slice.negatives,
    eligible: true,
    passed,
    reasons: passed
      ? []
      : [
          `critical FPR slice ${slice.axis}/${slice.key} warning FPR upper95 ${show(observed)} exceeds ${WARNING_FPR_MAX}`,
        ],
  };
}

function mixedRecallGate(mixed: {
  sampleSize: number;
  warningRecall: number;
  warningRecallLower95: number;
}): GateResult {
  const eligible = mixed.sampleSize > 0;
  const observed = eligible ? finiteOrNull(mixed.warningRecall) : null;
  const passed =
    !eligible || (observed !== null && observed >= MIXED_WARNING_RECALL_MIN);
  return {
    id: "warning.mixed-recall",
    tier: "warning",
    scope: "overall",
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
          `mixed >=50% AI warning recall ${show(observed)} is below ${MIXED_WARNING_RECALL_MIN} (lower95 ${mixed.warningRecallLower95} reported, not gating)`,
        ],
  };
}

// --- action ----------------------------------------------------------------

function actionGates(
  metrics: EvaluationMetrics,
  slices: SliceSummary,
): GateResult[] {
  const gates: GateResult[] = [];

  const visualAction = metrics.visualAction;
  const available = visualAction !== null;
  gates.push({
    id: "action.available",
    tier: "action",
    scope: "overall",
    observed: null,
    bound: "exact",
    operator: "==",
    required: true,
    sampleSize: 0,
    eligible: true,
    passed: available,
    reasons: available
      ? []
      : ["no visual-action threshold was frozen (visualDocument is null)"],
  });
  if (visualAction === null) return gates;

  gates.push(
    upperGate(
      "action.fpr.overall",
      "action",
      visualAction.falsePositiveRate,
      ACTION_FPR_MAX,
      visualAction.negatives,
      "overall action FPR",
    ),
  );

  for (const critical of criticalFprSlices(slices)) {
    gates.push(actionSliceFprGate(critical));
  }

  gates.push(
    lowerGate(
      "action.recall.overall",
      "action",
      visualAction.recall,
      ACTION_RECALL_MIN,
      visualAction.positives,
      "overall action recall",
    ),
  );

  return gates;
}

function actionSliceFprGate(slice: SliceResult): GateResult {
  const id = `action.fpr.slice.${slice.axis}.${slice.key}`;
  if (!slice.fprGateEligible) {
    // A critical FPR slice below the 300-negative floor cannot authorize visual
    // action: it fails the action tier and caps the decision at indicator-only.
    return {
      id,
      tier: "action",
      scope: "slice",
      slice: { axis: slice.axis, key: slice.key },
      observed: null,
      bound: "upper95",
      operator: "<=",
      required: ACTION_FPR_MAX,
      sampleSize: slice.negatives,
      eligible: false,
      passed: false,
      reasons: [
        `critical FPR slice ${slice.axis}/${slice.key} has ${slice.negatives} human negatives (< 300 required to authorize visual action)`,
      ],
    };
  }
  const observed = finiteOrNull(
    slice.metrics.visualAction?.falsePositiveRate.upper95,
  );
  const passed = observed !== null && observed <= ACTION_FPR_MAX;
  return {
    id,
    tier: "action",
    scope: "slice",
    slice: { axis: slice.axis, key: slice.key },
    observed,
    bound: "upper95",
    operator: "<=",
    required: ACTION_FPR_MAX,
    sampleSize: slice.negatives,
    eligible: true,
    passed,
    reasons: passed
      ? []
      : [
          `critical FPR slice ${slice.axis}/${slice.key} action FPR upper95 ${show(observed)} exceeds ${ACTION_FPR_MAX}`,
        ],
  };
}

// --- shared gate constructors ---------------------------------------------

function criticalFprSlices(slices: SliceSummary): SliceResult[] {
  return slices.slices.filter((slice) => FPR_AXES.has(slice.axis));
}

function upperGate(
  id: string,
  tier: GateTier,
  estimate: MetricEstimate,
  threshold: number,
  sampleSize: number,
  subject: string,
): GateResult {
  const observed = finiteOrNull(estimate.upper95);
  const passed = observed !== null && observed <= threshold;
  return {
    id,
    tier,
    scope: "overall",
    observed,
    bound: "upper95",
    operator: "<=",
    required: threshold,
    sampleSize,
    eligible: true,
    passed,
    reasons: passed
      ? []
      : [`${subject} upper95 ${show(observed)} exceeds ${threshold}`],
  };
}

function lowerGate(
  id: string,
  tier: GateTier,
  estimate: MetricEstimate,
  threshold: number,
  sampleSize: number,
  subject: string,
): GateResult {
  const observed = finiteOrNull(estimate.lower95);
  const passed = observed !== null && observed >= threshold;
  return {
    id,
    tier,
    scope: "overall",
    observed,
    bound: "lower95",
    operator: ">=",
    required: threshold,
    sampleSize,
    eligible: true,
    passed,
    reasons: passed
      ? []
      : [`${subject} lower95 ${show(observed)} is below ${threshold}`],
  };
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
