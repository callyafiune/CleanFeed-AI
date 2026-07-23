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
import type { FrozenCalibrationArtifact } from "../calibration-pipeline.ts";
import type {
  DecisionMetrics,
  EvaluationMetrics,
  MetricEstimate,
} from "../metrics.ts";
import type { GateReport, GateResult, ReleaseDecision } from "../gates.ts";
import type { BenchmarkReport } from "../report.ts";
import type { SliceResult, SliceSummary } from "../slices.ts";
import type { ModelPublicationInput } from "../profile-artifact.ts";

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
const AGGREGATION_VERSION = "tmr-aggregation-v2";
const CONTENT_COMPOSITION_VERSION = "lexical-content-v1";

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
    sampleSize: positives + negatives,
    positives,
    negatives,
    truePositives,
    falsePositives,
    trueNegatives: negatives - falsePositives,
    falseNegatives: positives - truePositives,
    falsePositiveRate: estimate(falsePositives, negatives),
    recall: estimate(truePositives, positives),
    precision: estimate(truePositives, truePositives + falsePositives),
  };
}

function fullMetrics(
  warning: DecisionMetrics,
  visualAction: DecisionMetrics | null,
): EvaluationMetrics {
  return {
    warning,
    visualAction,
    rocAuc: { value: 0.94, method: "point" },
    prAuc: { value: 0.93, method: "point" },
    brier: { value: 0.08, method: "point" },
    ece15: { value: 0.03, method: "point" },
    coverage: estimate(1900, 2000),
    abstentionRate: estimate(60, 2000),
    errorRate: estimate(4, 2000),
    simulatedPrecision: {
      prevalence01: 0.1,
      prevalence05: 0.4,
      prevalence10: 0.6,
    },
    latency: { sampleSize: 10, meanMs: 5, p50Ms: 5, p95Ms: 8, maxMs: 10 },
    memory: { sampleSize: 10, meanBytes: 100, maxBytes: 200 },
    mixed: {
      atLeastHalfAi: {
        sampleSize: 400,
        warningRecall: 0.7,
        warningRecallLower95: wilsonOneSided(280, 400, "lower").value,
      },
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
    fprGateEligible: negatives >= 300,
    recallGateEligible: positives >= 200,
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
    scope: "slice",
    slice: { axis: "lengthBucket", key },
    observed: 0.015,
    bound: "upper95",
    operator: "<=",
    required: 0.02,
    sampleSize: 400,
    eligible: true,
    passed,
    reasons: [],
  };
}

function gateReport(
  decision: ReleaseDecision,
  actionSliceGates: GateResult[],
): GateReport {
  return {
    schemaVersion: 1,
    decision,
    gates: [...actionSliceGates],
    failedIntegrity: [],
    failedWarning: [],
    failedAction: decision === "pass" ? [] : ["action.fpr.overall"],
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
    partitionsUsed: ["development", "calibration"],
    calibrators: { document: PLATT_DOCUMENT, localized: PLATT_LOCALIZED },
    selectionEvidence: { document: [], localized: [] },
    thresholds,
    thresholdEvidence: {
      warning: {
        documentThreshold: thresholds.warningDocument,
        localizedThreshold: thresholds.warningLocalized,
        negatives: 2000,
        falsePositives: 40,
        fprUpper95: 0.03,
        positives: 2000,
        truePositives: 1600,
        recall: 0.8,
      },
      visual:
        thresholds.visualDocument === null
          ? null
          : {
              documentThreshold: thresholds.visualDocument,
              localizedThreshold: null,
              negatives: 2000,
              falsePositives: 10,
              fprUpper95: 0.012,
              positives: 2000,
              truePositives: 1000,
              recall: 0.5,
            },
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
    dataset: { id: "ptbr-linkedin-v1", version: "1", digest: DATASET_DIGEST },
    datasetAuditDigest: "3".repeat(64),
    sourceReadinessDigest: "4".repeat(64),
    split: {
      digest: SPLIT_DIGEST,
      strategy: "blocked-group-time-v1",
      audit: {} as BenchmarkReport["split"]["audit"],
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
    lengthSlice("80_99", 400, 250, options.withVisual),
    lengthSlice("300_PLUS", 350, 220, options.withVisual),
  ];
  return {
    frozen: frozen(thresholds),
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
// a `hide` ceiling because their constituent length slices passed the action
// gate. The short 50-79 bucket is always capped to `indicator`.
export const passInput: ModelPublicationInput = makeInput(
  "pass",
  { warningDocument: 0.7, warningLocalized: 0.65, visualDocument: 0.85 },
  {
    withVisual: true,
    actionSliceGates: [
      actionSliceGate("80_99", true),
      actionSliceGate("300_PLUS", true),
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
      actionSliceGate("80_99", false),
      actionSliceGate("300_PLUS", false),
    ],
  },
);

// REJECT: the warning gate fails, the TMR is not promoted, and no profile is
// published.
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
      actionSliceGate("80_99", true),
      actionSliceGate("300_PLUS", true),
    ],
  },
);
