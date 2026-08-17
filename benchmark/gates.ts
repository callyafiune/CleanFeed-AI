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
// metric, no partial result — can move the decision: it is a pure function of the
// failed-gate lists and of which of those gates certify a pre-registered hypothesis.
//
// WHICH GATES DECIDE. The mandatory inventory is DERIVED from
// `multiplicity.primaryFamily` and is never a list kept here, so the count that
// divides `alpha_família` and the set of gates that decide a release are one
// object. Its four members are the ONE per-cell FPR ceiling on the `humanSourceType`
// axis, the overall recall at the frozen threshold, the global ECE, and integrity —
// and integrity is ONE member however many booleans it holds, because alpha/m spent on
// a boolean conjunction is pure conservatism. The count follows the family: a cell
// added to `quotaAxis.cells` and to `primaryFamily` moves it without an edit here.
//
// Every other gate is published as a DIAGNOSTIC. What a diagnostic does NOT do is
// certify: it holds no share of `alpha_família`, so its bound is not evidence at the
// pre-registered level and it backs no published claim about the population. It still
// BLOCKS, and by its tier, exactly as before the roles existed.
//
// A statistic that decides NOTHING is not a gate of any tier here — it is a BLOCK
// with no verdict field ({@link mixedRecallDiagnostics}, `metrics.lengthBands`).
// "BESIDE the gates" is the rendered Markdown: {@link mixedRecallDiagnostics} has one
// caller, `mixedRecallSection` in benchmark/report.ts, and that caller returns lines of
// text, so nothing this function builds enters `reportDigestInput` or any other
// projection of the report.
//
// The distinction between a gate and a block is mechanical: `GateTier` is a closed union
// of the three values the §6.5 disjunction below reads, and every reader of a tier
// compares by EQUALITY. What a FOURTH value would do is not one thing — it splits by how
// the gate is built, and one of the two ways SOFTENS the verdict:
//   - an interval SPEC never reaches `gates` at all, because the two `spec.tier === …`
//     filters in `evaluateReleaseGates` select what enters the array. Such a gate leaves
//     the published inventory instead of deciding anything from inside it.
//   - a gate built DIRECTLY — the integrity booleans, `warning.coverage`,
//     `action.available` — sits in `gates` whatever its tier says and falls out of every
//     failure list, because `failedIds` selects a tier by equality too. One that was
//     FAILING softens the decision by exactly that much: `warning.coverage` is diagnostic,
//     so `failedCertifying` does not hold it either, and a coverage breach that rejects
//     today would come out `pass`.
// No reader refuses an unknown tier, so the guard lives in the tests — two of them, in
// benchmark/tests/gates.test.ts. "gives no gate a tier outside the three the §6.5 branch
// reads, and publishes every interval spec" covers a gate built directly (a loop over the
// tier of every published gate) and an EXISTING interval spec retiered (the inventory of
// interval ids, pinned by value). "carries a coverage breach into the verdict by the
// warning tier alone" is the one that measures the SOFTENING: it names `failedWarning` as
// the only list that carries that gate's failure, so a tier that drops it from that list
// leaves nothing to reject on.
//
// One shape is guarded by neither, and it was measured rather than reasoned about: a
// DIAGNOSTIC interval spec ADDED with a fourth tier, failing its own threshold, leaves
// every test in that file green. It reaches no field of the report — the spec list is
// local to `evaluateReleaseGates` and the tier filters drop it before `gates` — so only a
// spec that claims a hypothesis is caught, via `multiplicity.gateIds`.
//
// The three §6.5 decision branches, unchanged by the roles:
//   - a failed CERTIFYING, INTEGRITY or WARNING gate  => reject (stylometric stays)
//   - every one of those passes and an ACTION gate fails => indicator-only
//   - nothing fails at all                            => pass
//
// `indicator-only` is not a lower ceiling than `reject` — it is the frontier between
// not publishing and publishing. `reject` yields no calibration profile at all
// (benchmark/profile-artifact.ts builds them only for `pass`/`indicator-only`), a
// `bundle-verified` rollout state that authorizes nothing, and a release package whose
// active runtime stays the built-in stylometric scorer (scripts/release-policy.mjs).
// `indicator-only` publishes the profile set and makes the weights the active runtime.
// So a diagnostic that stops deciding the CLAIM must not stop blocking the RELEASE:
// coverage, the pooled FPR, the label bases and a critical cell off the certifying
// axis all describe the population the release would act on, and none of them became
// safe by losing its share of the alpha.
//
// UNDER-POWERED CELLS, asymmetric between the two ROLES rather than between the two
// tiers. A CERTIFYING cell below the pre-registered negative floor FAILS: the
// hypothesis stays inside `m` (a divisor that shrinks with the evidence is not a
// correction) and a cell without power cannot certify it. A diagnostic FPR cell
// below the floor never blocks the warning budget, but it also cannot AUTHORIZE
// visual action, so it fails the action tier and caps the decision at
// indicator-only. Same rule for the human-negative label bases: a handful of
// `observed-process` rows cannot approve a gate, lift the action ceiling or back a
// stronger claim about the aggregate.
//
// WHY A CELL'S n COUNTS INDEPENDENT UNITS. The denominator of a per-cell FPR is
// human-negative record-lines, and the pre-registration admits at most ONE line per
// origin document per cell (`collection.maximumLinesPerOriginDocument`). Without
// that rule a cell could be filled with many slices of one page: n would count
// correlated draws while the interval assumes exchangeable ones, and the published
// zero-event ceiling `1 - (alpha/7)^(1/n)` would be read off a sample size the
// corpus never had.
//
// Every operating-point gate reads the END-TO-END metric family
// (benchmark/metrics.ts): its denominator is the whole eligible set and a record
// whose inference failed counts as a non-detection, so it is never more favorable
// than the conditional family on recall or clearance. Reading the conditional
// family here would let a fragile run buy a pass with its own failures.
//
// SIX KINDS OF MISSING EVIDENCE FAIL A GATE, AND NONE DEGRADES QUIETLY (A6/C4):
//
//   * The RESAMPLING PLAN. A Wilson or percentile interval over rows assumes the
//     rows are exchangeable. The corpus is not: authors, pages, threads, prompts
//     and generators induce dependence, and the unit of resampling is chosen per
//     estimand by C4. Until that plan exists and declares a hierarchical or
//     multiway unit for an estimand, the gate for that estimand FAILS for missing
//     evidence. It never falls back to treating rows as independent, which is the
//     silent version of the same decision and the one that inflates confidence.
//   * The BOUND ACTUALLY COMING OUT OF THAT UNIT. A declaration is not a property
//     of the number (R7), and the two came apart the moment the plan existed: the
//     plan declared the frozen table's unit for `warning.fpr` while the published
//     bound was still an analytic Wilson interval that counts every correlated
//     record-line as independent. So the gate reconciles them on the ESTIMATE —
//     percentile method, same unit kind, same axes, in order — and refuses the
//     bound otherwise. Checked on the estimate and not on
//     `ResamplingPlanEntry.executed` because a slice's interval is drawn inside
//     that slice's own metrics: the aggregate plan reads `declared-only` for the
//     `*.fpr.slice` estimands while their numbers are resampled, so `executed`
//     would fail a gate whose evidence exists. And when the estimate publishes a
//     bound ENVELOPE — the frozen `resampling.publishedBound` rule choosing between
//     the analytic and the resampled limit — the deciding simultaneous limit keeps
//     the percentile method name whichever estimator supplied it, so the gate reads
//     the envelope's simultaneous pair instead of the name: no pair, or a published
//     limit narrower than the resampled one it records, is refused.
//   * The SIMULTANEOUS BOUND. Dozens of one-sided gates share one release
//     decision, so an individual 95% bound per gate does not control the
//     family-wise error rate. Each interval gate reads the Bonferroni bound at
//     `alpha_família / m` that benchmark/metrics.ts publishes on the estimate; the
//     individual 95% bound stays in the report, marked descriptive, and is never
//     the verdict. `m` is the caller's PRE-REGISTERED count (frozen at G0.2), never
//     derived from the data: if a cell loses power it stays inside `m` and fails,
//     because a divisor that shrinks with the evidence is not a correction. When
//     the mandatory inventory is not the pre-registered family — a member missing, a
//     hypothesis the family does not name, or a declared `m` below the count — every
//     CERTIFYING gate fails and the report names which of the three it was; the
//     alpha is never quietly recomputed.
//   * The RESAMPLING EFFORT behind that bound. A percentile read at
//     `alpha_família / m` sits `alpha * (n - 1)` order statistics from the extreme
//     of the replicate distribution: with m = 40 and the 2000 replicates
//     benchmark/bootstrap.ts executes today, the verdict would rest on two or
//     three replicates. The frozen contract pre-registers 10.000 in the pilot and
//     says never to reduce the count, so a bound thinner than that is missing
//     evidence, not a faster measurement. Every bound that reaches this check is
//     already a percentile: the step above refused the analytic ones.
//   * The BOUND AND THE REPORT AGREEING ON `m`. The divisor reaches the aggregate
//     metrics and every slice's metrics through separate arguments, so a slice
//     interval can carry a divisor the report never published — and 0.05/40 is a
//     WIDER limit than 0.05/7 against the same budget. The gate refuses any bound
//     whose `m` differs from the declared one instead of comparing a number to a
//     budget it was not corrected for.
//   * The SCORE the statistic was measured over. The global calibration hypothesis
//     is about `calibrationGate.scoreBasis` and nothing in an ECE number says which
//     score produced it, so the caller declares it and the gate refuses a basis that
//     is not the pre-registered one: an ECE over a calibrated score answers a
//     different question at the same alpha, and the sealed evidence would carry the
//     pre-registered basis beside it.
//
// Frozen numbers come from benchmark/preregistration-v4.json through
// benchmark/preregistration-v4.ts: the FPR budgets, the ECE ceiling, the family alpha
// and the WARNING recall floor — the last one is `recall-at-threshold`, a member of
// `multiplicity.primaryFamily`, so its number is a certifying value and not a §6.5
// threshold this file may set. What remains as named constants below is only what no
// row of that table names: the action recall floor, coverage and the inference error
// ceiling. The material-assistance recall floor is a row of the table too, and it is
// not a constant here at all: `materialAssistance.decides` is frozen false, so no
// threshold of this file compares anything against it; the number reaches
// {@link mixedRecallDiagnostics} as an argument and is printed by the Markdown renderer.
//
// WHICH POPULATION AUTHORIZES WHAT (B2). The frozen three-target table gives each
// target its own ceiling, and ONE of the three consequences is enforced here:
// `action.recall.overall` reads the INTEGRAL positives only, so a material-assistance
// cohort can never raise the recall that lifts `actionCeiling`. The other — that the
// cohort's own recall authorizes a warning and nothing more — is enforced by no
// threshold: {@link mixedRecallDiagnostics} returns the cohort's recall beside its
// floor, with no verdict field, and the Markdown renderer is what puts the pair on a
// page.
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
import { PREREGISTRATION_V4 } from "./preregistration-v4.ts";
import type {
  EceGateBound,
  GenerationMode,
  ScoreBasis,
} from "./preregistration-v4.ts";
import type { SliceAxis, SliceResult, SliceSummary } from "./slices.ts";

export type ReleaseDecision = "pass" | "indicator-only" | "reject";

export type GateTier = "integrity" | "warning" | "action";

/**
 * Whether a gate decides the pre-registered claim or is published beside it.
 *
 * A `certifying` gate is one of the members of `multiplicity.primaryFamily` and is
 * the only kind that consumes a share of `alpha_família`. A `diagnostic` gate holds no
 * share of it, so its bound is not evidence at the pre-registered level and backs no
 * published claim — which is not the same as being inert: a failed diagnostic blocks
 * by its tier, exactly as it did before the roles existed.
 */
export type GateRole = "certifying" | "diagnostic";

/**
 * The score a run's calibration statistic was actually measured over.
 *
 * {@link ScoreBasis} is the pre-registration's vocabulary — the scores a policy may
 * NAME — and a run can also have measured the calibrated score, which is not a
 * pre-registrable basis and is exactly the mismatch the ECE gate has to refuse. The
 * gate cannot read it off the number: an ECE is a number either way.
 */
export type MeasuredScoreBasis = ScoreBasis | "document-calibrated-score";

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
  // No multiplicity-corrected bound was published for this estimate, or the mandatory
  // inventory of this report is not the pre-registered family.
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
  // A bound was published at a DIFFERENT `m` than the report declares. The aggregate
  // and every slice receive the divisor separately, so this is the shape a mis-wired
  // call site takes, and a wider limit compared to the same budget passes cells the
  // pre-registered alpha would fail.
  | "divergent-multiplicity"
  // The statistic was measured over a score other than the pre-registered basis, so
  // the bound answers a different question at the same alpha.
  | "score-basis-mismatch"
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
  role: GateRole;
  // Which member of `multiplicity.primaryFamily` this gate decides. Present exactly
  // on the certifying gates, and the same value on every boolean of the integrity
  // conjunction: they are one hypothesis, not seventeen.
  hypothesis?: string;
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
  frozenAt: "G0.2";
  // The pre-registered count the metrics were computed with; null when the caller
  // declared none, in which case no certifying gate can read a corrected bound.
  declared: number | null;
  // The hypotheses this run's mandatory inventory produced, under-powered cells
  // included. Integrity counts ONCE, so on a coherent run this is the family size.
  observed: number;
  // The certifying INTERVAL gates, in the order the specs were built. Every member of
  // the family but one: integrity is the boolean conjunction and has no single id.
  gateIds: string[];
  // The pre-registered family the inventory is derived from, and the hypotheses the
  // inventory actually named.
  primaryFamily: readonly string[];
  hypotheses: string[];
  // The two directions in which the inventory can stop BEING the family: a member no
  // gate of this run decided, and a hypothesis the family does not name (a repeated
  // one lands here too).
  missingHypotheses: string[];
  unexpectedHypotheses: string[];
  perGateAlpha: number | null;
  // Whether the inventory is the pre-registered family and `declared` covers it.
  // False fails every certifying gate.
  covers: boolean;
}

export interface GateReport {
  schemaVersion: 3;
  decision: ReleaseDecision;
  gates: GateResult[];
  multiplicity: MultiplicityReport;
  failedIntegrity: string[];
  failedWarning: string[];
  failedAction: string[];
  // The failures that fall on a member of the primary family, across tiers: the
  // subset of the three lists above that speaks at the pre-registered level. A
  // non-empty list means no certifying claim of this version stands; it is a
  // SUFFICIENT condition for `reject` and not a necessary one, because a failed
  // diagnostic of the warning tier rejects too.
  failedCertifying: string[];
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
  // Which score `metrics.calibration.eceEqualMass15` was measured over. Required for
  // the same reason as `resampling`: the number carries no trace of the score behind
  // it, and the global calibration hypothesis is about one specific score.
  calibrationScoreBasis: MeasuredScoreBasis;
}

// §6.5 thresholds that are NOT rows of the frozen pre-registration.
const ACTION_RECALL_MIN = 0.35;
const COVERAGE_MIN = 0.8;
const MAX_ERROR_RATE = 0.01;

// Frozen pre-registration.
//
// The recall floor is one of the FOUR certifying hypotheses ("recall-at-threshold"
// in `multiplicity.primaryFamily`, whose size is `primaryFamilySize`), so its number
// is a pre-registered value and not a §6.5 threshold this file may set. R3 forbids
// loosening a limit, and no value below is looser than the frozen one it reads.
const WARNING_RECALL_MIN = PREREGISTRATION_V4.recallFloor;
const WARNING_FPR_MAX = PREREGISTRATION_V4.fprBudgets.warning;
const ACTION_FPR_MAX = PREREGISTRATION_V4.fprBudgets.visualAction;
const ECE_MAX = PREREGISTRATION_V4.calibrationGate.eceMax;
// The material-assistance recall floor is deliberately NOT a constant of this file.
// `materialAssistance.decides` is frozen false, so no threshold of §6.5 compares
// anything against it; the number reaches {@link mixedRecallDiagnostics} as an
// argument, from the policy, at the one call site that publishes the block.
// The frozen contract NAMES the bound the ECE gate reads, and the gate derives its
// direction from that name instead of restating it. The switch is exhaustive: a
// different declared bound stops compiling here rather than drifting away from the
// behaviour, which is the whole reason the field exists.
const ECE_DIRECTION: "upper" | "lower" = eceDirection(
  PREREGISTRATION_V4.calibrationGate.eceBound,
);

function eceDirection(declared: EceGateBound): "upper" | "lower" {
  switch (declared) {
    case "bootstrap-simultaneous-upper":
      return "upper";
  }
}
const ALLOWED_UNIT_KINDS: ReadonlySet<string> = new Set(
  PREREGISTRATION_V4.resampling.allowedUnitKinds,
);
const MINIMUM_DECLARED_REPLICATES =
  PREREGISTRATION_V4.bootstrapReplicates.pilot;

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

// --- the certifying family -------------------------------------------------
//
// The certifying hypotheses, read from the frozen pre-registration. The names are the
// inventory: a member is `integrity`, `recall-at-threshold`, `calibration-global` or
// `fpr-<quota cell>`, and the cell part is the key of the `humanSourceType` slice
// that measures it. So a corpus whose `humanSourceType` does not carry the
// quota-cell vocabulary produces hypotheses this family does not name, and the
// report says WHICH — in both directions — instead of deciding a different family
// under the same alpha.
const PRIMARY_FAMILY: readonly string[] =
  PREREGISTRATION_V4.multiplicity.primaryFamily;
const INTEGRITY_HYPOTHESIS = "integrity";
const RECALL_HYPOTHESIS = "recall-at-threshold";
const CALIBRATION_HYPOTHESIS = "calibration-global";
const CELL_FPR_HYPOTHESIS_PREFIX = "fpr-";
/**
 * The slice axis the per-cell ceilings are measured on, and the record field a
 * quota cell is read out of.
 *
 * Exported because the composition gate (benchmark/composition-gate.ts) defends the
 * DENOMINATOR of these same ceilings at sealing time: if the two named the axis
 * separately, a corpus could satisfy a floor counted on one field while the ceiling
 * was measured on another.
 *
 * `as const satisfies` and not a `SliceAxis` annotation: the literal type is what lets
 * a consumer index a record with it, and the `satisfies` keeps it inside the closed
 * slice vocabulary.
 */
export const CELL_FPR_AXIS = "humanSourceType" as const satisfies SliceAxis;
// How many record-lines one origin document may contribute to a cell. It is what
// makes a floor counted in LINES also a floor counted in independent units, and it is
// pre-registered collection policy: the count is imposed by the composition gate at
// sealing time, never re-derived from the numbers a gate sees.
const MAXIMUM_LINES_PER_ORIGIN_DOCUMENT =
  PREREGISTRATION_V4.collection.maximumLinesPerOriginDocument;
// The score the global calibration hypothesis is about.
const CALIBRATION_SCORE_BASIS: ScoreBasis =
  PREREGISTRATION_V4.calibrationGate.scoreBasis;

/** The family member a per-cell FPR gate on the certifying axis decides. */
function cellFprHypothesis(cell: string): string {
  return `${CELL_FPR_HYPOTHESIS_PREFIX}${cell}`;
}

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
  // The family member this spec decides, or `undefined` for a diagnostic. Its
  // presence is what makes the gate certifying, so there is one source of truth for
  // the role and for the inventory.
  hypothesis?: string;
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
  // A fact about WHAT was measured that disqualifies the number before any question
  // about how much of it there was: no sample size and no interval repairs a
  // statistic computed over the wrong quantity.
  refusal?: { evidence: GateEvidence; reason: string };
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
    ...warningIntervalSpecs(
      input.metrics,
      input.slices,
      input.calibrationScoreBasis,
    ),
    ...actionIntervalSpecs(input.metrics, input.slices),
  ];

  const declared = input.metrics.multiplicity;
  // The integrity conjunction is always produced, so the member is always in the
  // inventory; the certifying intervals are whichever specs claim a hypothesis.
  const certifyingIds = intervalSpecs
    .filter((spec) => spec.hypothesis !== undefined)
    .map((spec) => spec.id);
  const hypotheses = [
    INTEGRITY_HYPOTHESIS,
    ...intervalSpecs
      .map((spec) => spec.hypothesis)
      .filter((hypothesis): hypothesis is string => hypothesis !== undefined),
  ];
  const missingHypotheses = PRIMARY_FAMILY.filter(
    (member) => !hypotheses.includes(member),
  );
  const unexpectedHypotheses = hypotheses.filter(
    (hypothesis, index) =>
      !PRIMARY_FAMILY.includes(hypothesis) ||
      hypotheses.indexOf(hypothesis) !== index,
  );
  const multiplicity: MultiplicityReport = {
    correction: "bonferroni",
    familyAlpha: PREREGISTRATION_V4.multiplicity.familyAlpha,
    descriptiveConfidence:
      PREREGISTRATION_V4.multiplicity.descriptiveConfidence,
    frozenAt: PREREGISTRATION_V4.multiplicity.frozenAt,
    declared: declared === null ? null : declared.m,
    observed: hypotheses.length,
    gateIds: certifyingIds,
    primaryFamily: PRIMARY_FAMILY,
    hypotheses,
    missingHypotheses,
    unexpectedHypotheses,
    perGateAlpha: declared === null ? null : declared.perGateAlpha,
    // A LARGER declared `m` is conservative and is not refused here; equality with
    // the frozen family size is enforced where the number enters the measurement
    // (benchmark/commands/evaluate.ts reads `primaryFamilySize`).
    covers:
      declared !== null &&
      missingHypotheses.length === 0 &&
      unexpectedHypotheses.length === 0 &&
      declared.m >= hypotheses.length,
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
  const failedCertifying = gates
    .filter((gate) => gate.role === "certifying" && !gate.passed)
    .map((gate) => gate.id);

  // `failedCertifying` is named in the branch and not left implicit: every certifying
  // gate built here belongs to the integrity or warning tier, so the first two terms
  // already cover it today — and a member of the family added to the action tier
  // tomorrow must reject rather than inherit that tier's ceiling.
  const decision: ReleaseDecision =
    failedCertifying.length > 0 ||
    failedIntegrity.length > 0 ||
    failedWarning.length > 0
      ? "reject"
      : failedAction.length > 0
        ? "indicator-only"
        : "pass";

  return {
    schemaVersion: 3,
    decision,
    gates,
    multiplicity,
    failedIntegrity,
    failedWarning,
    failedAction,
    failedCertifying,
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

// Every integrity gate carries the SAME hypothesis: the conjunction is member 7 of
// the family, not one member per boolean, so the inventory counts it once however
// many digests, seals and leases it holds.
function booleanGate(id: string, ok: boolean, detail: string): GateResult {
  return {
    id,
    tier: "integrity",
    role: "certifying",
    hypothesis: INTEGRITY_HYPOTHESIS,
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
    role: "certifying",
    hypothesis: INTEGRITY_HYPOTHESIS,
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

// The one approved POINT gate of the warning tier. It reads no interval, so there is
// no interval to correct for multiplicity and no resampling unit to declare; both
// facts are recorded as `evidence: "not-applicable"` rather than left to inference.
// Coverage is not a member of the primary family — it is not a hypothesis the version
// certifies — so it is published diagnostic, and it REJECTS all the same: the warning
// tier is a term of the §6.5 disjunction whatever a gate's role says.
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
  ];
}

function warningIntervalSpecs(
  metrics: EvaluationMetrics,
  slices: SliceSummary,
  measuredScoreBasis: MeasuredScoreBasis,
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
    // The per-cell ceilings of the family are measured on ONE axis; a critical slice
    // on any other axis is the same statistic over a grouping the version does not
    // certify.
    const certifying = critical.axis === CELL_FPR_AXIS;
    specs.push({
      id: `warning.fpr.slice.${critical.axis}.${critical.key}`,
      tier: "warning",
      ...(certifying ? { hypothesis: cellFprHypothesis(critical.key) } : {}),
      scope: "slice",
      slice: { axis: critical.axis, key: critical.key },
      estimand: ESTIMAND_WARNING_FPR_SLICE,
      estimate: critical.metrics.warning.endToEnd.falsePositiveRate,
      direction: "upper",
      threshold: WARNING_FPR_MAX,
      sampleSize: critical.negatives,
      subject: `critical FPR slice ${critical.axis}/${critical.key} warning FPR`,
      eligible: critical.fprGateEligible,
      ineligible: certifying
        ? {
            // A certifying cell stays inside `m` and FAILS when it has no power:
            // the hypothesis was pre-registered and an under-sampled cell does not
            // certify it. The floor named is the one the eligibility verdict was
            // DECIDED against — `SliceOptions.minimumFprNegatives` lets a caller
            // raise it — and never the pre-registered row, which would put a number
            // in sealed evidence that nothing compared this cell to.
            passed: false,
            reason:
              `a célula ${critical.key} tem ${critical.negatives} negativos ` +
              `humanos, abaixo do piso aplicado de ${critical.fprNegativeFloor} ` +
              `(a pré-inscrição conta o piso em documentos de origem, admitindo ` +
              `≤${MAXIMUM_LINES_PER_ORIGIN_DOCUMENT} linha por documento por ` +
              `célula; a imposição é do gate de composição): a hipótese ` +
              `${cellFprHypothesis(critical.key)} permanece dentro de m e reprova`,
          }
        : // A diagnostic FPR cell below the floor never blocks the warning budget.
          { passed: true, reason: null },
    });
  }

  for (const basis of metrics.labelBasis.bases) {
    specs.push(labelBasisSpec(basis, "warning"));
  }

  specs.push({
    id: "warning.recall.overall",
    tier: "warning",
    hypothesis: RECALL_HYPOTHESIS,
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
    hypothesis: CALIBRATION_HYPOTHESIS,
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
    subject: `equal-mass ECE-${PREREGISTRATION_V4.calibrationGate.eceBins}`,
    eligible: true,
    ineligible: { passed: true, reason: null },
    ...(measuredScoreBasis === CALIBRATION_SCORE_BASIS
      ? {}
      : {
          refusal: {
            evidence: "score-basis-mismatch" as GateEvidence,
            reason:
              `equal-mass ECE-${PREREGISTRATION_V4.calibrationGate.eceBins}: a ` +
              `estatística foi medida sobre ${measuredScoreBasis}, e a hipótese ` +
              `${CALIBRATION_HYPOTHESIS} é sobre ${CALIBRATION_SCORE_BASIS} — o ` +
              "escore que o limiar congelado corta; um limite sobre outro escore " +
              "não decide essa hipótese ao mesmo alpha",
          },
        }),
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

/**
 * The material-assistance recall of ONE cohort, for the Markdown renderer to print
 * beside the gate table. It is built at render time and reaches no projection of the
 * sealed report.
 *
 * NO VERDICT FIELD, and the absence is the shape: a block carrying `passed` or a
 * `tier` is a gate whatever its `role` says, and some reader eventually compares it.
 * `floor` travels so that what the recall MISSES is readable without a comparison
 * having been made on the reader's behalf.
 *
 * The population is one cohort — the mechanistic one — at or above the frozen AI
 * fraction, and `generationMode` is copied off the MEASUREMENT rather than restated
 * from the policy, so the block names the cohort it describes instead of leaving a
 * reader to infer that from the field name.
 */
export interface MixedRecallDiagnostics {
  role: "diagnostic";
  decides: false;
  spendsAlpha: false;
  generationMode: GenerationMode;
  floor: number;
  // `observed` and `lower95` go NULL TOGETHER on an empty cohort: an unmeasured recall
  // is not a recall of zero, and `lower95` bounds that same unmeasured recall, so a 0
  // published there would read as a measured floor of zero.
  observed: number | null;
  lower95: number | null;
  sampleSize: number;
}

/**
 * The floor arrives as an ARGUMENT, is compared against nothing here, and is copied
 * into the block so a reader sees what the recall missed.
 *
 * This function reads no policy of its own, so the number in the block is the one the
 * call site handed over — a unit test drives it with 0.42 to prove exactly that. What
 * keeps the PUBLISHED number on the frozen row is the single call site that renders the
 * block (`mixedRecallSection` in benchmark/report.ts, which passes
 * `materialAssistance.minimumWarningRecall`), never a check in here.
 */
export function mixedRecallDiagnostics(
  mixed: EvaluationMetrics["mixed"]["atLeastHalfAi"],
  floor: number,
): MixedRecallDiagnostics {
  const measured = mixed.sampleSize > 0;
  return {
    role: "diagnostic",
    decides: false,
    spendsAlpha: false,
    generationMode: mixed.generationMode,
    floor,
    observed: measured ? finiteOrNull(mixed.warningRecall) : null,
    lower95: measured ? finiteOrNull(mixed.warningRecallLower95) : null,
    sampleSize: mixed.sampleSize,
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
      role: "diagnostic",
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
    role: (spec.hypothesis === undefined
      ? "diagnostic"
      : "certifying") as GateRole,
    ...(spec.hypothesis === undefined ? {} : { hypothesis: spec.hypothesis }),
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

  // 0. The wrong QUANTITY was measured. This precedes the power question because no
  //    sample size repairs it: the gate would otherwise publish a verdict about the
  //    number it had rather than about the hypothesis it names.
  if (spec.refusal !== undefined) {
    return {
      ...base,
      evidence: spec.refusal.evidence,
      observed: null,
      eligible: true,
      passed: false,
      reasons: [spec.refusal.reason],
    };
  }

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

  // 3. No simultaneous bound to read, or — for a CERTIFYING gate only — an inventory
  //    that is not the pre-registered family: fail, never read the 95% bound instead.
  //    The inventory check is scoped to the certifying gates because a diagnostic
  //    holds no share of the alpha the inventory divides; failing it here is what
  //    made a wrong wiring look like a statistical verdict.
  const simultaneous = spec.estimate?.simultaneous;
  const inventoryRefused =
    spec.hypothesis !== undefined && !context.multiplicity.covers;
  if (inventoryRefused || simultaneous === undefined) {
    return {
      ...base,
      evidence: "missing-simultaneous-interval",
      observed: null,
      eligible: true,
      passed: false,
      reasons: [missingSimultaneousReason(spec, context)],
    };
  }

  // 3b. A bound corrected for a DIFFERENT family than the one the report publishes.
  //     The divisor reaches the aggregate metrics and each slice's metrics through
  //     separate arguments, so the two can disagree while every number looks well
  //     formed — and the direction of the mistake is not safe: alpha/40 is a wider
  //     one-sided limit than alpha/7, compared against the very same budget. The
  //     equality with the FROZEN family size is enforced at the call site
  //     (benchmark/commands/evaluate.ts); what is checked here is that the number the
  //     verdict rests on is the number the report claims.
  const declaredM = context.multiplicity.declared;
  if (declaredM !== null && simultaneous.m !== declaredM) {
    return {
      ...base,
      evidence: "divergent-multiplicity",
      observed: null,
      eligible: true,
      passed: false,
      simultaneous: {
        familyAlpha: simultaneous.familyAlpha,
        m: simultaneous.m,
        alpha: simultaneous.alpha,
      },
      reasons: [
        `${spec.subject}: o limite simultâneo foi corrigido para m=${simultaneous.m} ` +
          `(alpha=${simultaneous.alpha}) enquanto o relatório declara m=${declaredM}; ` +
          "um limite lido em outro divisor não é o limite que este relatório publica",
      ],
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
 * declares, or `null` when it is. Five ways it can fail, and each one names what a
 * reader has to go fix:
 *
 *   * the bound is analytic (Wilson) — it resamples nothing, so the declared unit
 *     played no part in it and every correlated record-line was counted as
 *     independent;
 *   * the estimate names no unit at all, so nothing connects it to the plan;
 *   * the unit's METHOD differs from the declared one — a hierarchical draw where
 *     the table crosses two factors understates the variance, and vice versa;
 *   * the unit's AXES differ from the declared ones, which is a different design
 *     wearing the estimand's name;
 *   * the estimate publishes a bound ENVELOPE (the frozen contract's
 *     `resampling.publishedBound` chose between two estimators) and its simultaneous
 *     bound fails one of three checks: no resampled pair inside it, a pair naming a
 *     resampled estimator other than the published one, or a published limit
 *     narrower than the resampled one recorded beside it. This is the only case in
 *     which a percentile method name can sit on a limit the analytic estimator
 *     supplied, so it is checked rather than trusted (R7). `rateEnvelope` cannot
 *     produce the middle case — it copies the published method into the pair — which
 *     is precisely why the check exists and is tested: an estimate from any other
 *     producer has nothing else standing between it and a gate.
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
  const envelope = estimate?.boundEnvelope;
  if (envelope !== undefined) {
    const pair = envelope.simultaneous;
    if (pair === undefined) {
      return (
        `o limite simultâneo diz vir de "${simultaneous.method}" e a estimativa ` +
        `publica um envelope de regra "${envelope.rule}", mas o envelope não traz ` +
        "o par simultâneo: sem ele não há como saber se o número que decide o gate " +
        "saiu do desenho reamostrado ou do estimador analítico (R7)"
      );
    }
    if (pair.resampled.method !== simultaneous.method) {
      return (
        `o envelope do limite simultâneo nomeia o estimador reamostrado ` +
        `"${pair.resampled.method}" enquanto o limite publicado diz ` +
        `"${simultaneous.method}"`
      );
    }
    if (
      simultaneous.lower > pair.resampled.lower ||
      simultaneous.upper < pair.resampled.upper
    ) {
      return (
        `o limite simultâneo publicado [${simultaneous.lower}, ` +
        `${simultaneous.upper}] é mais estreito que o limite reamostrado ` +
        `[${pair.resampled.lower}, ${pair.resampled.upper}] que o envelope ` +
        `registra (procedência declarada: inferior "${pair.lowerFrom}", ` +
        `superior "${pair.upperFrom}"), logo a regra "${envelope.rule}" não foi ` +
        "aplicada e o desenho declarado foi estreitado em vez de honrado"
      );
    }
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
  if (multiplicity.missingHypotheses.length > 0) {
    return (
      `${spec.subject}: o inventário obrigatório não é a família primária — ` +
      `nenhum gate deste relatório decide ${multiplicity.missingHypotheses.join(", ")}; ` +
      "a família é pré-registrada e não se encolhe para caber no que a corrida produziu"
    );
  }
  if (multiplicity.unexpectedHypotheses.length > 0) {
    return (
      `${spec.subject}: o inventário obrigatório não é a família primária — ` +
      `${multiplicity.unexpectedHypotheses.join(", ")} não está entre os ` +
      `${multiplicity.primaryFamily.length} membros pré-registrados; alpha_família ` +
      "não se divide por uma hipótese que a pré-inscrição não nomeia"
    );
  }
  if (multiplicity.declared < multiplicity.observed) {
    return (
      `${spec.subject}: o m declarado (${multiplicity.declared}) não cobre as ` +
      `${multiplicity.observed} hipóteses obrigatórias deste relatório; ` +
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
    // The integrity conjunction has its own constructors, so every gate built here
    // is outside the family by construction.
    role: "diagnostic",
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
