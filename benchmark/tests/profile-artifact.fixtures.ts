// Shared, deterministic fixtures for the Task 12 profile-artifact tests.
//
// Both the benchmark-side test (benchmark/tests/profile-artifact.test.ts) and
// the runtime-boundary test (tests/unit/inference/calibration-profile-contract
// .test.ts) drive `buildModelPublication` through the three §6.5 decision
// branches — pass, indicator-only and reject — plus a NEVER_THRESHOLD edge. The
// fixtures hand-build minimal but parser-valid `FrozenCalibrationArtifact` and
// `BenchmarkReport` shapes (no pipeline run) and read the REAL committed model
// templates so the built publication is proven against the actual Phase 1
// descriptors on disk.
//
// Standalone benchmark test support: MUST NOT import from the extension bundle
// (src/). Deterministic: no Date.now, no randomness.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { wilsonOneSided } from "../intervals.ts";
import {
  selectionThresholdEvidence,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import {
  declaredResamplingPlan,
  type DecisionFamilies,
  type DecisionMetrics,
  type EvaluationMetrics,
  type MetricEstimate,
  type MixedRecallBlock,
} from "../metrics.ts";
import type { GateReport, GateResult, ReleaseDecision } from "../gates.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import type { BenchmarkReport } from "../report.ts";
import type { SliceResult, SliceSummary } from "../slices.ts";
import type { ModelPublicationInput } from "../profile-artifact.ts";
import {
  freezeProvisionalThreshold,
  type ProvisionalThresholdArtifact,
} from "../provisional-threshold.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = resolve(HERE, "../../models/cleanfeed-ptbr-v1");

// The real, committed Phase 1 templates — consumed verbatim so a template drift
// would break these tests instead of being silently papered over.
export const PROFILES_TEMPLATE: unknown = JSON.parse(
  readFileSync(resolve(MODEL_DIR, "calibration-profiles.json"), "utf8"),
);
export const RELEASE_TEMPLATE: unknown = JSON.parse(
  readFileSync(resolve(MODEL_DIR, "release.json"), "utf8"),
);

// Identity copied verbatim from the committed release template so the builder's
// frozen/report/template cross-check agrees byte-for-byte.
const MODEL_ID = "cleanfeed-ptbr-v1";
const MODEL_VERSION = "d8f77f870fbd35a17add2498b73d906bbc299026";
const BUNDLE_DIGEST =
  "2d47d6f3e0a6f2c7836b03c9a47b1b81f6c34159aa35ae1bdffe3507e4dc25bc";
const TOKENIZER_DIGEST =
  "2e3bc97587671b43d32a68bd134abea67f4a3aaaee8a65f7a1f923449ee13135";
const AGGREGATION_VERSION = "tmr-aggregation-v3";
const CONTENT_COMPOSITION_VERSION = "lexical-content-v2";

const DATASET_DIGEST = "a".repeat(64);
const SPLIT_DIGEST = "b".repeat(64);
const EVALUATOR_DIGEST = "c".repeat(64);
// The scientific report digest: `release.evidenceDigest` is a literal copy.
const REPORT_DIGEST = "d".repeat(64);

export const ISSUED_AT = "2026-07-20T00:00:00.000Z";
export const NEVER_THRESHOLD = 2;

const PLATT_DOCUMENT = {
  kind: "platt" as const,
  slope: 2.5,
  intercept: -1,
};
const PLATT_LOCALIZED = {
  kind: "platt" as const,
  slope: 2.1,
  intercept: -0.8,
};

function estimate(successes: number, total: number): MetricEstimate {
  return {
    value: successes / total,
    lower95: wilsonOneSided(successes, total, "lower").value,
    upper95: wilsonOneSided(successes, total, "upper").value,
    method: "wilson-one-sided",
  };
}

function decisionMetrics(
  truePositives: number,
  falsePositives: number,
  positives: number,
  negatives: number,
): DecisionMetrics {
  return {
    family: "end-to-end",
    positivePopulation: "warning-positives",
    sampleSize: positives + negatives,
    positives,
    negatives,
    truePositives,
    falsePositives,
    trueNegatives: negatives - falsePositives,
    falseNegatives: positives - truePositives,
    undecidedPositives: 0,
    undecidedNegatives: 0,
    falsePositiveRate: estimate(falsePositives, negatives),
    clearanceRate: estimate(negatives - falsePositives, negatives),
    recall: estimate(truePositives, positives),
    precision: estimate(truePositives, truePositives + falsePositives),
  };
}

// Nothing errored in these fixtures, so both families carry the same matrix under
// their own role names.
function families(metrics: DecisionMetrics): DecisionFamilies {
  return {
    endToEnd: metrics,
    conditionalOnScored: { ...metrics, family: "conditional-on-scored" },
  };
}

// The three error-rate denominators, kept DIFFERENT on purpose: a fixture that
// gave all three the same rate would hide a block reading the wrong companion.
const ELIGIBLE_ERROR_RATE = estimate(4, 2_000);
const DECISION_POPULATION_ERROR_RATE = estimate(4, 1_900);
const BINARY_POPULATION_ERROR_RATE = estimate(4, 1_800);

// The A6 role-named blocks. The sealed profile reads none of them today, so the
// fixture only has to be structurally complete: the release block mirrors the
// same matrices under the name that says what they decide, and the separability
// and calibration blocks carry the error-rate companion OF THEIR OWN population.
function a6Blocks(
  warning: DecisionFamilies,
  visualAction: DecisionFamilies | null,
): Pick<
  EvaluationMetrics,
  | "release"
  | "separability"
  | "calibration"
  | "labelBasis"
  | "predictiveValue"
  | "multiplicity"
> {
  const frozen = (
    decision: "warning" | "visual-action",
    families: DecisionFamilies,
  ): EvaluationMetrics["release"]["warning"] => ({
    role: "release",
    decision,
    family: "end-to-end",
    recall: families.endToEnd.recall,
    falsePositiveRate: families.endToEnd.falsePositiveRate,
    errorRatePopulation: "eligible-decision-population",
    errorRate: DECISION_POPULATION_ERROR_RATE,
    conditional: {
      role: "diagnostic",
      family: "conditional-on-scored",
      selectiveFailureSensitive: true,
      recall: families.conditionalOnScored.recall,
      falsePositiveRate: families.conditionalOnScored.falsePositiveRate,
      errorRatePopulation: "eligible-decision-population",
      errorRate: DECISION_POPULATION_ERROR_RATE,
    },
  });
  return {
    release: {
      role: "release",
      thresholdSource: "preregistered-provisional-threshold",
      warning: frozen("warning", warning),
      visualAction:
        visualAction === null ? null : frozen("visual-action", visualAction),
    },
    separability: {
      role: "diagnostic",
      purpose: "separability",
      gates: false,
      population: "conditional-on-scored",
      errorRatePopulation: "binary-population",
      errorRate: BINARY_POPULATION_ERROR_RATE,
      auroc: { value: 0.94, method: "point" },
      prAuc: { value: 0.93, method: "point" },
      tprAtOnePercentFpr: {
        targetFpr: 0.01,
        achievedFpr: 0.01,
        tpr: 0.7,
        threshold: 0.9,
        sampleSize: 4_000,
      },
    },
    calibration: {
      role: "diagnostic",
      gatedStatistic: "eceEqualMass15",
      population: "conditional-on-scored",
      scored: 1_800,
      populationSize: 1_900,
      errorRatePopulation: "binary-population",
      errorRate: BINARY_POPULATION_ERROR_RATE,
      brier: { value: 0.08, method: "point" },
      logLoss: 0.3,
      intercept: 0,
      slope: 1,
      bins: 15,
      eceEqualMass15: {
        value: 0.03,
        lower95: 0.02,
        upper95: 0.04,
        method: "point",
      },
      reliability: [],
      byLengthBucket: [],
      bySource: [],
      byLinguisticStratum: [],
    },
    labelBasis: {
      role: "human-negative-label-evidence",
      fieldPresent: false,
      pooledClaimAllowed: false,
      bases: [],
    },
    predictiveValue: {
      role: "release-context",
      family: "end-to-end",
      benchmarkPrevalence: 0.5,
      byPrevalence: [
        { prevalence: 0.01, ppv: 0.1, npv: 0.99 },
        { prevalence: 0.05, ppv: 0.4, npv: 0.98 },
        { prevalence: 0.1, ppv: 0.6, npv: 0.97 },
      ],
    },
    multiplicity: null,
  };
}

function fullMetrics(
  warning: DecisionMetrics,
  visualAction: DecisionMetrics | null,
): EvaluationMetrics {
  return {
    warning: families(warning),
    visualAction: visualAction === null ? null : families(visualAction),
    // B2: the recall that may lift the action ceiling, over integral positives
    // only. Mirrors the visual-action matrix here because this fixture holds no
    // material-assistance rows for the two populations to differ over.
    actionAuthorization:
      visualAction === null
        ? null
        : {
            role: "release",
            decision: "visual-action",
            positivePopulation: "integral-positives",
            family: "end-to-end",
            recall: visualAction.recall,
            positives: visualAction.positives,
            excludedMaterialAssistancePositives: 0,
            excludedEcologicalCohort: 0,
          },
    // B2: diagnostic-only span localization. Empty cohorts here — this fixture
    // scores no spans; the block exists so the shape is complete.
    localization: {
      role: "diagnostic",
      gates: false,
      authorizesVisualAction: false,
      unit: "character-offset",
      byGenerationMode: [],
    },
    // The FPR by pre-registered length band, diagnostic. Every band is present with
    // a zero count: this fixture holds no human negatives with a word count, and a
    // band that vanished when empty is the defect the block exists to prevent.
    lengthBands: {
      role: "diagnostic",
      gates: false,
      spendsAlpha: false,
      bands: PREREGISTRATION_V4.lengthBands.bands.map((band) => ({
        key: band.key,
        minimumWords: band.minimumWords,
        maximumWords: band.maximumWords,
        humanNegatives: 0,
        decidedNegatives: 0,
        falsePositives: 0,
        falsePositiveRate: null,
      })),
    },
    ...a6Blocks(
      families(warning),
      visualAction === null ? null : families(visualAction),
    ),
    // C4: the unit every estimand declares. `declared-only` throughout, because
    // this fixture resamples nothing; the gate still needs the unit to exist.
    resampling: declaredResamplingPlan(),
    ece15: { value: 0.03, method: "point" },
    coverage: estimate(1900, 2000),
    abstentionRate: estimate(60, 2000),
    errorRate: ELIGIBLE_ERROR_RATE,
    decisionPopulationErrorRate: DECISION_POPULATION_ERROR_RATE,
    binaryPopulationErrorRate: BINARY_POPULATION_ERROR_RATE,
    resolution: {
      bySource: [],
      byClass: [],
      byLengthBucket: [],
      byPlatform: [],
    },
    simulatedPrecision: {
      prevalence01: 0.1,
      prevalence05: 0.4,
      prevalence10: 0.6,
    },
    latency: {
      scored: {
        population: "scored",
        sampleSize: 10,
        meanMs: 5,
        p50Ms: 5,
        p95Ms: 8,
        maxMs: 10,
      },
      abstained: null,
      errored: null,
    },
    memory: { sampleSize: 10, meanBytes: 100, maxBytes: 200 },
    mixed: {
      atLeastHalfAi: {
        generationMode: "mechanistic",
        sampleSize: 400,
        warningRecall: 0.7,
        warningRecallLower95: wilsonOneSided(280, 400, "lower").value,
      },
      byGenerationMode: [],
      byFraction: [],
    },
  };
}

// Overall evaluation metrics. `withVisual` toggles whether a visual-action
// matrix exists at all (indicator-only can lack one).
function overallMetrics(withVisual: boolean): EvaluationMetrics {
  const warning = decisionMetrics(1600, 40, 2000, 2000);
  const visualAction = withVisual
    ? decisionMetrics(1000, 10, 2000, 2000)
    : null;
  return fullMetrics(warning, visualAction);
}

const FPR_NEGATIVE_FLOOR =
  PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives;
const RECALL_POSITIVE_FLOOR =
  PREREGISTRATION_V4.powerFloors.criticalRecallPositives;

function lengthSlice(
  key: string,
  negatives: number,
  positives: number,
  withVisual: boolean,
): SliceResult {
  const warning = decisionMetrics(
    Math.round(positives * 0.84),
    Math.round(negatives * 0.02),
    positives,
    negatives,
  );
  const visualAction = withVisual
    ? decisionMetrics(
        Math.round(positives * 0.6),
        Math.round(negatives * 0.01),
        positives,
        negatives,
      )
    : null;
  return {
    axis: "lengthBucket",
    key,
    sampleSize: positives + negatives,
    positives,
    negatives,
    fprGateEligible: negatives >= FPR_NEGATIVE_FLOOR,
    recallGateEligible: positives >= RECALL_POSITIVE_FLOOR,
    fprNegativeFloor: FPR_NEGATIVE_FLOOR,
    recallPositiveFloor: RECALL_POSITIVE_FLOOR,
    metrics: fullMetrics(warning, visualAction),
  };
}

function sliceSummary(slices: SliceResult[]): SliceSummary {
  return {
    slices,
    macro: {
      warningFpr: 0.02,
      warningRecall: 0.82,
      actionFpr: slices.some((s) => s.metrics.visualAction !== null)
        ? 0.01
        : null,
      actionRecall: slices.some((s) => s.metrics.visualAction !== null)
        ? 0.6
        : null,
    },
    worst: {},
  };
}

function actionSliceGate(key: string, passed: boolean): GateResult {
  return {
    id: `action.fpr.slice.lengthBucket.${key}`,
    tier: "action",
    // The action tier holds no member of the primary family: its budget authorizes,
    // it never certifies.
    role: "diagnostic",
    scope: "slice",
    slice: { axis: "lengthBucket", key },
    estimand: "action.fpr.slice",
    evidence: "present",
    observed: 0.015,
    bound: "simultaneous-upper",
    operator: "<=",
    required: 0.02,
    sampleSize: 400,
    eligible: true,
    passed,
    reasons: [],
  };
}

// The per-cell FPR ceiling of a quota cell: a member of the primary family, and the
// kind of gate whose failure a `reject` fixture has to carry.
const REJECTED_CELL = PREREGISTRATION_V4.preRegistration.quotaAxis.cells[0];
const REJECTED_GATE = `warning.fpr.slice.humanSourceType.${REJECTED_CELL}`;

function breachedCellGate(): GateResult {
  return {
    id: REJECTED_GATE,
    tier: "warning",
    role: "certifying",
    hypothesis: `fpr-${REJECTED_CELL}`,
    scope: "slice",
    slice: { axis: "humanSourceType", key: REJECTED_CELL },
    estimand: "warning.fpr.slice",
    evidence: "present",
    observed: 0.09,
    bound: "simultaneous-upper",
    operator: "<=",
    required: 0.05,
    sampleSize: 400,
    eligible: true,
    passed: false,
    reasons: [
      `critical FPR slice humanSourceType/${REJECTED_CELL} warning FPR ` +
        "simultaneous upper bound 0.09 exceeds 0.05",
    ],
  };
}

// The failure lists follow FROM the decision, because the two are not independent in
// the policy that emits them: `reject` is a failed integrity, warning or certifying
// gate, and `indicator-only` is an action failure with none of those. A fixture that
// declares a decision no gate policy can produce proves nothing about the consumer.
function gateReport(
  decision: ReleaseDecision,
  actionSliceGates: GateResult[],
): GateReport {
  const family = PREREGISTRATION_V4.multiplicity.primaryFamily;
  const rejected = decision === "reject";
  return {
    schemaVersion: 3,
    multiplicity: {
      correction: "bonferroni",
      familyAlpha: 0.05,
      descriptiveConfidence: 0.95,
      frozenAt: "G0.2",
      declared: PREREGISTRATION_V4.multiplicity.primaryFamilySize,
      observed: family.length,
      // The action slice gates are diagnostic, so none of them is in the inventory.
      gateIds: rejected ? [REJECTED_GATE] : [],
      primaryFamily: family,
      hypotheses: [...family],
      missingHypotheses: [],
      unexpectedHypotheses: [],
      perGateAlpha: PREREGISTRATION_V4.multiplicity.perHypothesisAlpha,
      covers: true,
    },
    decision,
    gates: rejected
      ? [breachedCellGate(), ...actionSliceGates]
      : [...actionSliceGates],
    failedIntegrity: [],
    failedWarning: rejected ? [REJECTED_GATE] : [],
    failedAction: decision === "indicator-only" ? ["action.fpr.overall"] : [],
    failedCertifying: rejected ? [REJECTED_GATE] : [],
  };
}

function frozen(thresholds: {
  warningDocument: number;
  warningLocalized: number;
  visualDocument: number | null;
}): FrozenCalibrationArtifact {
  return {
    schemaVersion: 1,
    model: {
      modelId: MODEL_ID,
      modelVersion: MODEL_VERSION,
      bundleDigest: BUNDLE_DIGEST,
      tokenizerDigest: TOKENIZER_DIGEST,
      aggregationVersion: AGGREGATION_VERSION,
      contentCompositionVersion: CONTENT_COMPOSITION_VERSION,
    },
    scoringRuntime: {
      runtimeParityDigest: "f".repeat(64),
      extensionBuildDigest: "e".repeat(64),
      backend: "wasm",
      chromeVersion: "150.0.7871.129",
    },
    predictionManifestDigests: {
      development: "1".repeat(64),
      calibration: "2".repeat(64),
    },
    datasetDigest: DATASET_DIGEST,
    datasetAuditDigest: "3".repeat(64),
    sourceReadinessDigest: "4".repeat(64),
    splitDigest: SPLIT_DIGEST,
    evaluatorDigest: EVALUATOR_DIGEST,
    partitionsUsed: ["dev", "cal-A"],
    calibrators: { document: PLATT_DOCUMENT, localized: PLATT_LOCALIZED },
    selectionEvidence: { document: [], localized: [] },
    thresholds,
    thresholdEvidence: {
      warning: selectionThresholdEvidence({
        documentThreshold: thresholds.warningDocument,
        localizedThreshold: thresholds.warningLocalized,
        negatives: 2000,
        falsePositives: 40,
        selectionFprUpper95Nominal: 0.03,
        positives: 2000,
        truePositives: 1600,
        recall: 0.8,
      }),
      visual:
        thresholds.visualDocument === null
          ? null
          : selectionThresholdEvidence({
              documentThreshold: thresholds.visualDocument,
              localizedThreshold: null,
              negatives: 2000,
              falsePositives: 10,
              selectionFprUpper95Nominal: 0.012,
              positives: 2000,
              truePositives: 1000,
              recall: 0.5,
            }),
    },
    fitSeed: 1234,
    artifactDigest: "9".repeat(64),
  };
}

function report(
  decision: ReleaseDecision,
  metrics: EvaluationMetrics,
  slices: SliceResult[],
  gates: GateReport,
): BenchmarkReport {
  return {
    schemaVersion: 2,
    generatedAt: ISSUED_AT,
    holdoutConsumptionId: "consume-holdout-0001",
    dataset: {
      id: "cleanfeed-ptbr-cells-v1",
      version: "1",
      digest: DATASET_DIGEST,
    },
    datasetAuditDigest: "3".repeat(64),
    sourceReadinessDigest: "4".repeat(64),
    split: {
      digest: SPLIT_DIGEST,
      strategy: "blocked-group-time-v2",
      heldOutGeneratorFamilies: [],
      // The markdown renderer reads BOTH family lists off the audit — the
      // reservation the partitions honored and the incidental blind-block
      // concentrations — so the cast states those two rather than an empty object.
      // A published report is sealed with the audit inside it, and a renderer that
      // reads a key the fixture does not carry used to fail here as a TypeError.
      audit: {
        heldOutGeneratorFamilies: [],
        incidentalTestOnlyGeneratorFamilies: [],
      } as unknown as BenchmarkReport["split"]["audit"],
    },
    evaluatorDigest: EVALUATOR_DIGEST,
    runtimeParityDigest: "f".repeat(64),
    model: {
      id: MODEL_ID,
      version: MODEL_VERSION,
      bundleDigest: BUNDLE_DIGEST,
      tokenizerDigest: TOKENIZER_DIGEST,
      aggregationVersion: AGGREGATION_VERSION,
      contentCompositionVersion: CONTENT_COMPOSITION_VERSION,
    },
    scoringRuntime: {
      extensionBuildDigest: "e".repeat(64),
      backend: "wasm",
      chromeVersion: "150.0.7871.129",
    },
    predictionManifestDigests: {
      development: "1".repeat(64),
      calibration: "2".repeat(64),
      test: "5".repeat(64),
    },
    calibrationArtifactDigest: "9".repeat(64),
    metrics,
    slices: sliceSummary(slices),
    gates,
    releaseDecision: decision,
    reportDigest: REPORT_DIGEST,
    notes: [],
  };
}

/**
 * The pre-registered cut every publication fixture is built over, frozen by the shipped
 * function and bound to the SAME dataset/split/evaluator digests the frozen calibration
 * carries — `assertServedCutIsTheMeasuredCut` refuses a foreign one, and a hand-written
 * artifact would not close its own digest.
 *
 * The scores are 0.000 .. 0.495, so the 0.95 upper quantile is 0.475: a cut that sits
 * between the fixtures' negatives and their positives.
 */
export const PROVISIONAL_THRESHOLD: ProvisionalThresholdArtifact =
  freezeProvisionalThreshold({
    samples: Array.from({ length: 100 }, (_unused, index) => ({
      id: `fit_${String(index).padStart(3, "0")}`,
      label: "human",
      partition: PREREGISTRATION_V4.threshold.quantilePartitions[index % 2],
      documentRawScore: index / 200,
    })),
    testIds: [],
    seed: PREREGISTRATION_V4.seeds.split,
    digests: {
      datasetDigest: DATASET_DIGEST,
      datasetAuditDigest: "3".repeat(64),
      splitDigest: SPLIT_DIGEST,
      evaluatorDigest: EVALUATOR_DIGEST,
      sourceReadinessDigest: "4".repeat(64),
      developmentManifestDigest: "1".repeat(64),
      calibrationManifestDigest: "2".repeat(64),
    },
  });

// The length bands the fixtures below carry gates for. They are the PRE-REGISTERED
// keys, and they are read off the policy rather than retyped: a fixture keyed by a
// band the pre-registration no longer names produces a gate report that reaches no
// runtime bucket, which is how the middle bucket silently lost its `hide` ceiling once.
const MIDDLE_BAND = PREREGISTRATION_V4.lengthBands.bands[1].key;
const TOP_BAND = PREREGISTRATION_V4.lengthBands.bands[3].key;

function makeInput(
  decision: ReleaseDecision,
  thresholds: {
    warningDocument: number;
    warningLocalized: number;
    visualDocument: number | null;
  },
  options: { withVisual: boolean; actionSliceGates: GateResult[] },
): ModelPublicationInput {
  const metrics = overallMetrics(options.withVisual);
  const slices = [
    lengthSlice(MIDDLE_BAND, 400, 250, options.withVisual),
    lengthSlice(TOP_BAND, 350, 220, options.withVisual),
  ];
  return {
    frozen: frozen(thresholds),
    provisionalThreshold: PROVISIONAL_THRESHOLD,
    report: report(
      decision,
      metrics,
      slices,
      gateReport(decision, options.actionSliceGates),
    ),
    issuedAt: ISSUED_AT,
    profilesTemplate: PROFILES_TEMPLATE,
    releaseTemplate: RELEASE_TEMPLATE,
  };
}

// PASS: warning + action gates pass; the 80-199 and 200-plus runtime buckets get
// a `hide` ceiling because their constituent length bands passed the action
// gate. The short 50-79 bucket is always capped to `indicator`.
export const passInput: ModelPublicationInput = makeInput(
  "pass",
  { warningDocument: 0.7, warningLocalized: 0.65, visualDocument: 0.85 },
  {
    withVisual: true,
    actionSliceGates: [
      actionSliceGate(MIDDLE_BAND, true),
      actionSliceGate(TOP_BAND, true),
    ],
  },
);

/**
 * PASS in which one runtime bucket has NO action gate for any of its constituent bands.
 *
 * Reachable, and the only shape that separates presence from verdict: with `pass` every
 * action gate that exists passed (a failing or under-powered one lands in `failedAction`
 * and caps the whole release at `indicator-only`), so what the aggregation actually
 * decides per bucket is whether any evidence for it exists at all. A band the corpus
 * never filled produces no slice and therefore no gate, and a bucket with no evidence
 * must authorize nothing.
 */
export const passWithoutMiddleBandGateInput: ModelPublicationInput = makeInput(
  "pass",
  { warningDocument: 0.7, warningLocalized: 0.65, visualDocument: 0.85 },
  { withVisual: true, actionSliceGates: [actionSliceGate(TOP_BAND, true)] },
);

/**
 * PASS carrying an action gate for a length band no runtime bucket names — a band added
 * to the pre-registration, measured, gated, and never mapped.
 *
 * The gate PASSES, because that is the shape `pass` admits and the shape that used to
 * publish: before the coverage guard the unmapped band was filtered out of every
 * bucket's evidence, so its verdict reached no profile and `200-plus` went on
 * authorizing `hide` over a table nobody had aggregated.
 */
export const unmappedBandGateInput: ModelPublicationInput = makeInput(
  "pass",
  { warningDocument: 0.7, warningLocalized: 0.65, visualDocument: 0.85 },
  {
    withVisual: true,
    actionSliceGates: [
      actionSliceGate(MIDDLE_BAND, true),
      actionSliceGate(TOP_BAND, true),
      actionSliceGate("600_PLUS", true),
    ],
  },
);

// INDICATOR-ONLY: the action gate fails (visual FPR too high), so every bucket
// caps at `indicator` and documentAction is disabled (1).
export const indicatorInput: ModelPublicationInput = makeInput(
  "indicator-only",
  { warningDocument: 0.7, warningLocalized: 0.65, visualDocument: 0.85 },
  {
    withVisual: true,
    actionSliceGates: [
      actionSliceGate(MIDDLE_BAND, false),
      actionSliceGate(TOP_BAND, false),
    ],
  },
);

/**
 * A publication input carrying a gate report the caller PRODUCED, instead of a decision
 * this file hands over as a parameter.
 *
 * Every fixture above takes `decision` as an argument, so none of them can observe the
 * gate policy changing its mind about which failures publish: that link is only
 * exercised by feeding `buildModelPublication` the output of `evaluateReleaseGates`.
 *
 * `mixed` REPLACES the material-assistance cohort of the metrics this function builds.
 * It exists because the metrics are rebuilt here rather than carried off `gates`: a
 * caller that measured a cohort while evaluating the gates has to hand that same cohort
 * over, or the publisher reads {@link fullMetrics}'s cohort and not the caller's.
 */
export function publicationInputFor(
  gates: GateReport,
  mixed?: MixedRecallBlock,
): ModelPublicationInput {
  const built = overallMetrics(true);
  const metrics: EvaluationMetrics =
    mixed === undefined
      ? built
      : { ...built, mixed: { ...built.mixed, atLeastHalfAi: mixed } };
  return {
    frozen: frozen({
      warningDocument: 0.7,
      warningLocalized: 0.65,
      visualDocument: 0.85,
    }),
    provisionalThreshold: PROVISIONAL_THRESHOLD,
    report: report(
      gates.decision,
      metrics,
      [
        lengthSlice(MIDDLE_BAND, 400, 250, true),
        lengthSlice(TOP_BAND, 350, 220, true),
      ],
      gates,
    ),
    issuedAt: ISSUED_AT,
    profilesTemplate: PROFILES_TEMPLATE,
    releaseTemplate: RELEASE_TEMPLATE,
  };
}

// REJECT: a per-cell FPR ceiling of the primary family fails, the TMR is not promoted,
// and no profile is published.
export const rejectInput: ModelPublicationInput = makeInput(
  "reject",
  { warningDocument: 0.7, warningLocalized: 0.65, visualDocument: null },
  { withVisual: false, actionSliceGates: [] },
);

// NEVER_THRESHOLD edge: the frozen fit could not place the localized warning
// path inside the 5% budget, so it sealed the sentinel (2). The builder MUST map
// it into a valid [0,1] runtime threshold and never emit a 2.
export const neverThresholdInput: ModelPublicationInput = makeInput(
  "pass",
  {
    warningDocument: 0.7,
    warningLocalized: NEVER_THRESHOLD,
    visualDocument: 0.85,
  },
  {
    withVisual: true,
    actionSliceGates: [
      actionSliceGate(MIDDLE_BAND, true),
      actionSliceGate(TOP_BAND, true),
    ],
  },
);
