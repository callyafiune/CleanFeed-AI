// Deterministic fixtures for the Task 6 evidence-publication tests.
//
// Two flavours are provided:
//   - `bundleInputFor(decision)` reuses the Task 12 profile-artifact fixtures
//     (a report/frozen pair plus the real committed model templates) and builds
//     a `ModelPublication` so the evidence sanitizer can be exercised for pass /
//     indicator-only / reject WITHOUT running the pipeline or a ledger.
//   - `buildRejectScenario(root)` writes a fully self-consistent on-disk reject
//     run (real dataset/source/split/fit/report digests, an approved license
//     review and a completed holdout ledger) so `publish-evidence` can be driven
//     end-to-end and `verify-published-evidence` re-checked on the clean output.
//
// Standalone benchmark test support: MUST NOT import from the extension bundle
// (src/). Deterministic: no Date.now, no randomness.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import type { CorpusSourceReadinessReport } from "../../contracts/source-readiness.ts";
import type { FrozenCalibrationArtifact } from "../calibration-pipeline.ts";
import type { DatasetAudit } from "../dataset-manifest.ts";
import type { FitReport } from "../candidate-preflight.ts";
import {
  computePredictionManifestDigest,
  type PredictionManifestV1,
} from "../prediction-schema.ts";
import { buildModelPublication } from "../profile-artifact.ts";
import {
  buildBenchmarkReport,
  type BenchmarkReport,
  type GovernanceSeal,
} from "../report.ts";
import type { GateReport } from "../gates.ts";
import type {
  DecisionFamilies,
  DecisionMetrics,
  EvaluationMetrics,
  MetricEstimate,
} from "../metrics.ts";
import type { SliceSummary } from "../slices.ts";
import type { SplitArtifact } from "../split-artifact.ts";
import type { EvidenceInput } from "../evidence-sanitizer.ts";
import type { ReleaseDecision } from "../gates.ts";
import {
  indicatorInput,
  passInput,
  rejectInput,
} from "./profile-artifact.fixtures.ts";
import { asGeneratorFamily } from "../generator-family.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const MODEL_DIR = resolve(HERE, "../../models/cleanfeed-ptbr-v1");

function hex(label: string): string {
  let out = "";
  for (const ch of label) out += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return out.padEnd(64, "0").slice(0, 64);
}

// Identity copied verbatim from the committed release template so the builder's
// cross-check agrees byte-for-byte.
const MODEL_ID = "cleanfeed-ptbr-v1";
const MODEL_VERSION = "d8f77f870fbd35a17add2498b73d906bbc299026";
const BUNDLE_DIGEST =
  "2d47d6f3e0a6f2c7836b03c9a47b1b81f6c34159aa35ae1bdffe3507e4dc25bc";
const TOKENIZER_DIGEST =
  "2e3bc97587671b43d32a68bd134abea67f4a3aaaee8a65f7a1f923449ee13135";
const AGGREGATION_VERSION = "tmr-aggregation-v3";
const CONTENT_COMPOSITION_VERSION = "lexical-content-v1";

const PROFILES_TEMPLATE_TEXT = await readFile(
  resolve(MODEL_DIR, "calibration-profiles.json"),
  "utf8",
);
const RELEASE_TEMPLATE_TEXT = await readFile(
  resolve(MODEL_DIR, "release.json"),
  "utf8",
);

function profileInputFor(decision: ReleaseDecision) {
  if (decision === "pass") return passInput;
  if (decision === "indicator-only") return indicatorInput;
  return rejectInput;
}

// Light, aggregate-only governance objects for the sanitizer unit tests. They
// are NOT parsed by the sanitizer, so their self-digests are copied from the
// report rather than recomputed.
function lightDatasetAudit(report: BenchmarkReport): DatasetAudit {
  return {
    datasetId: report.dataset.id,
    scientificUse: "release",
    releaseEligible: true,
    recordCount: 10_000,
    counts: { human: 4_000, ai: 4_000, mixed: 2_000 },
    sourceTypes: { "qa-informal": 2_000, encyclopedic: 2_000 },
    hardNegativeFamilies: { formulaic: 500 },
    generatorFamilies: { acme_family: 4_000 },
    licenses: ["consent-v1"],
    recordsSha256: hex("records"),
    reviewLedgerSha256: hex("review-ledger"),
    sourceManifestSha256: hex("source-manifest"),
    sealed: true,
    auditDigest: report.datasetAuditDigest,
  };
}

function lightReadiness(report: BenchmarkReport): CorpusSourceReadinessReport {
  return {
    schemaVersion: 1,
    status: "ready",
    sourceManifestDigest: hex("source-manifest-digest"),
    recordCount: 10_000,
    sourceCount: 12,
    acquisitionCounts: { consent: 4_000, licensed: 4_000, generated: 2_000 },
    protocols: {
      corpus: "corpus-v1",
      collection: "collection-v1",
      annotation: "annotation-v1",
      generation: "generation-v1",
      pii: "pii-review-v1",
    },
    blockingReasons: [],
    reportDigest: report.sourceReadinessDigest,
  };
}

function lightSplitArtifact(report: BenchmarkReport): SplitArtifact {
  return {
    schemaVersion: 1,
    datasetDigest: report.dataset.digest,
    algorithm: "blocked-group-time-v1",
    algorithmDigest: hex("algorithm"),
    seed: 712_019,
    policy: {
      fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
      classTolerance: 0.02,
      heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
      seed: 712_019,
    },
    assignments: [],
    assignmentsDigest: hex("assignments"),
    splitDigest: report.split.digest,
    cutoffs: { calibrationCut: 100, testCut: 200 },
    counts: { development: 2_000, calibration: 3_000, test: 5_000 },
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
    audit: {
      sizes: { development: 2_000, calibration: 3_000, test: 5_000 },
      classFractions: {
        human: { development: 0.2, calibration: 0.3, test: 0.5 },
        ai: { development: 0.2, calibration: 0.3, test: 0.5 },
        mixed: { development: 0.2, calibration: 0.3, test: 0.5 },
      },
      cutoffs: {
        latestDevelopment: 100,
        latestCalibration: 200,
        earliestTest: 300,
      },
      leakages: [],
      criticalSliceSamples: [],
      heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
      passed: true,
      reasons: [],
    },
  };
}

function lightFitReport(frozen: FrozenCalibrationArtifact): FitReport {
  return {
    schemaVersion: 1,
    preflight: {
      status: "ready",
      datasetDigest: frozen.datasetDigest,
      datasetAuditDigest: frozen.datasetAuditDigest,
      sourceReadinessDigest: frozen.sourceReadinessDigest,
      splitDigest: frozen.splitDigest,
      model: {
        modelId: frozen.model.modelId,
        modelVersion: frozen.model.modelVersion,
        bundleDigest: frozen.model.bundleDigest,
        aggregationVersion: frozen.model.aggregationVersion,
        contentCompositionVersion: frozen.model.contentCompositionVersion,
        tokenizerDigest: frozen.model.tokenizerDigest,
        runtimeParityDigest: frozen.scoringRuntime.runtimeParityDigest,
        extensionBuildDigest: frozen.scoringRuntime.extensionBuildDigest,
        backend: frozen.scoringRuntime.backend,
        chromeVersion: frozen.scoringRuntime.chromeVersion,
      },
      developmentPredictionManifestDigest:
        frozen.predictionManifestDigests.development,
      calibrationPredictionManifestDigest:
        frozen.predictionManifestDigests.calibration,
      freeDiskBytes: 30 * 1024 ** 3,
      blockingReasons: [],
    },
    calibrationArtifactDigest: frozen.artifactDigest,
    fitSeed: frozen.fitSeed,
    partitionsUsed: ["development", "calibration"],
    model: frozen.model,
    scoringRuntime: frozen.scoringRuntime,
    predictionManifestDigests: frozen.predictionManifestDigests,
    datasetDigest: frozen.datasetDigest,
    datasetAuditDigest: frozen.datasetAuditDigest,
    sourceReadinessDigest: frozen.sourceReadinessDigest,
    splitDigest: frozen.splitDigest,
    evaluatorDigest: frozen.evaluatorDigest,
    thresholds: frozen.thresholds,
    thresholdEvidence: frozen.thresholdEvidence,
    selectionEvidence: frozen.selectionEvidence,
  };
}

export interface BundleFixture {
  input: EvidenceInput;
  release: EvidenceInput["release"];
  profiles: EvidenceInput["profiles"];
}

/** A ready-to-sanitize `EvidenceInput` for one of the three §6.5 decisions. */
export async function bundleInputFor(
  decision: ReleaseDecision,
): Promise<BundleFixture> {
  const profileInput = profileInputFor(decision);
  const { release, profiles } = await buildModelPublication(profileInput);
  const report = profileInput.report;
  const frozen = profileInput.frozen;
  return {
    input: {
      datasetAudit: lightDatasetAudit(report),
      sourceReadiness: lightReadiness(report),
      splitArtifact: lightSplitArtifact(report),
      frozenCalibration: frozen,
      fitReport: lightFitReport(frozen),
      report,
      release,
      profiles,
    },
    release,
    profiles,
  };
}

// --- fully consistent on-disk reject scenario ------------------------------

const PARITY = hex("runtime-parity");
const BUILD = hex("extension-build");
const EVALUATOR = hex("evaluator");
const CONSUMPTION_ID = "consume-holdout-reject-0001";
const GENERATED_AT = "2026-07-20T00:00:00.000Z";

function estimate(value: number): MetricEstimate {
  return { value, lower95: value, upper95: value, method: "wilson-one-sided" };
}

function emptyDecisionMetrics(): DecisionMetrics {
  return {
    family: "end-to-end",
    sampleSize: 0,
    positives: 0,
    negatives: 0,
    truePositives: 0,
    falsePositives: 0,
    trueNegatives: 0,
    falseNegatives: 0,
    undecidedPositives: 0,
    undecidedNegatives: 0,
    falsePositiveRate: estimate(0),
    clearanceRate: estimate(0),
    recall: estimate(0),
    precision: estimate(0),
  };
}

// No failed inference in this fixture, so the two families are the same matrix
// under their two role names.
function emptyDecisionFamilies(): DecisionFamilies {
  return {
    endToEnd: emptyDecisionMetrics(),
    conditionalOnScored: {
      ...emptyDecisionMetrics(),
      family: "conditional-on-scored",
    },
  };
}

function minimalMetrics(): EvaluationMetrics {
  return {
    warning: emptyDecisionFamilies(),
    visualAction: null,
    // The A6 role-named blocks. This fixture never reads them; it only has to be
    // structurally complete, so the release block mirrors the empty matrix and
    // every conditional block carries its error-rate companion.
    release: {
      role: "release",
      thresholdSource: "frozen-calibration-threshold",
      warning: {
        role: "release",
        decision: "warning",
        family: "end-to-end",
        recall: estimate(0),
        falsePositiveRate: estimate(0),
        errorRatePopulation: "eligible-decision-population",
        errorRate: estimate(0),
        conditional: {
          role: "diagnostic",
          family: "conditional-on-scored",
          selectiveFailureSensitive: true,
          recall: estimate(0),
          falsePositiveRate: estimate(0),
          errorRatePopulation: "eligible-decision-population",
          errorRate: estimate(0),
        },
      },
      visualAction: null,
    },
    separability: {
      role: "diagnostic",
      purpose: "separability",
      gates: false,
      population: "conditional-on-scored",
      errorRatePopulation: "binary-population",
      errorRate: estimate(0),
      auroc: { value: 0.5, method: "point" },
      prAuc: { value: 0.5, method: "point" },
      tprAtOnePercentFpr: {
        targetFpr: 0.01,
        achievedFpr: 0,
        tpr: 0,
        threshold: Number.POSITIVE_INFINITY,
        sampleSize: 0,
      },
    },
    calibration: {
      role: "diagnostic",
      gatedStatistic: "eceEqualMass15",
      population: "conditional-on-scored",
      scored: 0,
      populationSize: 0,
      errorRatePopulation: "binary-population",
      errorRate: estimate(0),
      brier: { value: 0, method: "point" },
      logLoss: 0,
      intercept: 0,
      slope: 1,
      bins: 15,
      eceEqualMass15: { value: 0, lower95: 0, upper95: 0, method: "point" },
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
      byPrevalence: [],
    },
    multiplicity: null,
    ece15: { value: 0, method: "point" },
    coverage: estimate(1),
    abstentionRate: estimate(0),
    errorRate: estimate(0),
    decisionPopulationErrorRate: estimate(0),
    binaryPopulationErrorRate: estimate(0),
    resolution: {
      bySource: [],
      byClass: [],
      byLengthBucket: [],
      byPlatform: [],
    },
    simulatedPrecision: { prevalence01: 0, prevalence05: 0, prevalence10: 0 },
    latency: { sampleSize: 0, meanMs: 0, p50Ms: 0, p95Ms: 0, maxMs: 0 },
    memory: { sampleSize: 0, meanBytes: 0, maxBytes: 0 },
    mixed: {
      atLeastHalfAi: {
        sampleSize: 0,
        warningRecall: 0,
        warningRecallLower95: 0,
      },
      byFraction: [],
    },
  };
}

function emptySlices(): SliceSummary {
  return {
    slices: [],
    macro: {
      warningFpr: 0,
      warningRecall: 0,
      actionFpr: null,
      actionRecall: null,
    },
    worst: {},
  };
}

function rejectGates(): GateReport {
  return {
    schemaVersion: 2,
    multiplicity: {
      correction: "bonferroni",
      familyAlpha: 0.05,
      descriptiveConfidence: 0.95,
      frozenAt: "G5",
      declared: 40,
      observed: 1,
      gateIds: ["warning.fpr.overall"],
      perGateAlpha: 0.05 / 40,
      covers: true,
    },
    decision: "reject",
    gates: [
      {
        id: "warning.fpr.overall",
        tier: "warning",
        scope: "overall",
        estimand: "warning.fpr",
        evidence: "present",
        observed: 0.1,
        bound: "simultaneous-upper",
        operator: "<=",
        required: 0.05,
        sampleSize: 2_000,
        eligible: true,
        passed: false,
        reasons: ["overall warning FPR upper95 0.1 exceeds 0.05"],
      },
    ],
    failedIntegrity: [],
    failedWarning: ["warning.fpr.overall"],
    failedAction: [],
  };
}

function predictionManifest(
  partition: PredictionManifestV1["partition"],
  datasetDigest: string,
  splitDigest: string,
  holdoutConsumptionId: string | null,
): PredictionManifestV1 {
  return {
    schemaVersion: 1,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: BUNDLE_DIGEST,
    aggregationVersion: AGGREGATION_VERSION,
    contentCompositionVersion: CONTENT_COMPOSITION_VERSION,
    tokenizerDigest: TOKENIZER_DIGEST,
    runtimeParityDigest: PARITY,
    extensionBuildDigest: BUILD,
    backend: "wasm",
    chromeVersion: "150.0.7871.129",
    datasetDigest,
    splitDigest,
    partition,
    shardSize: 100,
    shardCount: 0,
    shards: [],
    holdoutConsumptionId,
    createdAt: GENERATED_AT,
  };
}

export interface RejectScenario {
  root: string;
  modelDir: string;
  outputDir: string;
  reportPath: string;
  frozenCalibrationPath: string;
  datasetAuditPath: string;
  sourceReadinessPath: string;
  splitArtifactPath: string;
  fitReportPath: string;
  ledgerPath: string;
  consumptionId: string;
  report: BenchmarkReport;
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/**
 * Materialises a self-consistent reject run under `root`: real dataset/source/
 * split/fit/report digests, an approved license review and a completed holdout
 * ledger, with the two model-metadata files already written by publish-profile.
 */
export async function buildRejectScenario(
  root: string,
  runPublishProfile: (options: {
    reportPath: string;
    frozenCalibrationPath: string;
    issuedAt: string;
    modelDirectory: string;
  }) => Promise<string>,
): Promise<RejectScenario> {
  const datasetDigest = hex("reject-dataset");
  const splitDigest = hex("reject-split");

  const auditBase: Omit<DatasetAudit, "auditDigest"> = {
    datasetId: "ptbr-generic-v1",
    scientificUse: "release",
    releaseEligible: true,
    recordCount: 10_000,
    counts: { human: 4_000, ai: 4_000, mixed: 2_000 },
    sourceTypes: { "qa-informal": 2_000, encyclopedic: 2_000 },
    hardNegativeFamilies: { formulaic: 500 },
    generatorFamilies: { acme_family: 4_000 },
    licenses: ["consent-v1"],
    recordsSha256: hex("reject-records"),
    reviewLedgerSha256: hex("reject-review-ledger"),
    sourceManifestSha256: hex("reject-source-manifest"),
    sealed: true,
  };
  const datasetAudit: DatasetAudit = {
    ...auditBase,
    auditDigest: await canonicalSha256(auditBase),
  };

  const readinessBase = {
    schemaVersion: 1 as const,
    status: "ready" as const,
    sourceManifestDigest: hex("reject-source-digest"),
    recordCount: 10_000,
    sourceCount: 12,
    acquisitionCounts: { consent: 4_000, licensed: 4_000, generated: 2_000 },
    protocols: {
      corpus: "corpus-v1" as const,
      collection: "collection-v1" as const,
      annotation: "annotation-v1" as const,
      generation: "generation-v1" as const,
      pii: "pii-review-v1" as const,
    },
    blockingReasons: [],
  };
  const sourceReadiness: CorpusSourceReadinessReport = {
    ...readinessBase,
    reportDigest: await canonicalSha256(readinessBase),
  };

  const splitArtifact: SplitArtifact = {
    schemaVersion: 1,
    datasetDigest,
    algorithm: "blocked-group-time-v1",
    algorithmDigest: hex("reject-algorithm"),
    seed: 712_019,
    policy: {
      fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
      classTolerance: 0.02,
      heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
      seed: 712_019,
    },
    assignments: [],
    assignmentsDigest: hex("reject-assignments"),
    splitDigest,
    cutoffs: { calibrationCut: 100, testCut: 200 },
    counts: { development: 2_000, calibration: 3_000, test: 5_000 },
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
    audit: {
      sizes: { development: 2_000, calibration: 3_000, test: 5_000 },
      classFractions: {
        human: { development: 0.2, calibration: 0.3, test: 0.5 },
        ai: { development: 0.2, calibration: 0.3, test: 0.5 },
        mixed: { development: 0.2, calibration: 0.3, test: 0.5 },
      },
      cutoffs: {
        latestDevelopment: 100,
        latestCalibration: 200,
        earliestTest: 300,
      },
      leakages: [],
      criticalSliceSamples: [],
      heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
      passed: true,
      reasons: [],
    },
  };

  const devManifest = predictionManifest(
    "development",
    datasetDigest,
    splitDigest,
    null,
  );
  const calManifest = predictionManifest(
    "calibration",
    datasetDigest,
    splitDigest,
    null,
  );
  const testManifest = predictionManifest(
    "test",
    datasetDigest,
    splitDigest,
    CONSUMPTION_ID,
  );
  const developmentDigest = await computePredictionManifestDigest(devManifest);
  const calibrationDigest = await computePredictionManifestDigest(calManifest);

  const frozenBase: Omit<FrozenCalibrationArtifact, "artifactDigest"> = {
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
      runtimeParityDigest: PARITY,
      extensionBuildDigest: BUILD,
      backend: "wasm",
      chromeVersion: "150.0.7871.129",
    },
    predictionManifestDigests: {
      development: developmentDigest,
      calibration: calibrationDigest,
    },
    datasetDigest,
    datasetAuditDigest: datasetAudit.auditDigest,
    sourceReadinessDigest: sourceReadiness.reportDigest,
    splitDigest,
    evaluatorDigest: EVALUATOR,
    partitionsUsed: ["development", "calibration"],
    calibrators: {
      document: { kind: "platt", slope: 2, intercept: -1 },
      localized: { kind: "platt", slope: 2, intercept: -1 },
    },
    selectionEvidence: { document: [], localized: [] },
    thresholds: {
      warningDocument: 0.7,
      warningLocalized: 0.65,
      visualDocument: null,
    },
    thresholdEvidence: {
      warning: {
        documentThreshold: 0.7,
        localizedThreshold: 0.65,
        negatives: 2_000,
        falsePositives: 40,
        fprUpper95: 0.03,
        positives: 2_000,
        truePositives: 1_600,
        recall: 0.8,
      },
      visual: null,
    },
    fitSeed: 712_019,
  };
  const frozenCalibration: FrozenCalibrationArtifact = {
    ...frozenBase,
    artifactDigest: await canonicalSha256(frozenBase),
  };

  const seal: GovernanceSeal = {
    datasetAuditDigest: datasetAudit.auditDigest,
    sourceReadinessDigest: sourceReadiness.reportDigest,
    holdoutConsumptionId: CONSUMPTION_ID,
    runtimeParityDigest: PARITY,
    model: {
      id: MODEL_ID,
      version: MODEL_VERSION,
      bundleDigest: BUNDLE_DIGEST,
      tokenizerDigest: TOKENIZER_DIGEST,
      aggregationVersion: AGGREGATION_VERSION,
      contentCompositionVersion: CONTENT_COMPOSITION_VERSION,
    },
    scoringRuntime: {
      extensionBuildDigest: BUILD,
      backend: "wasm",
      chromeVersion: "150.0.7871.129",
    },
  };

  const report = await buildBenchmarkReport({
    generatedAt: GENERATED_AT,
    dataset: {
      id: "ptbr-generic-v1",
      version: "1.0.0",
      digest: datasetDigest,
    },
    split: {
      digest: splitDigest,
      strategy: "blocked-group-time-v1",
      heldOutGeneratorFamilies: splitArtifact.heldOutGeneratorFamilies,
      audit: splitArtifact.audit,
    },
    evaluatorDigest: EVALUATOR,
    calibrationArtifactDigest: frozenCalibration.artifactDigest,
    frozen: seal,
    observed: seal,
    predictionManifests: {
      development: devManifest,
      calibration: calManifest,
      test: testManifest,
    },
    metrics: minimalMetrics(),
    slices: emptySlices(),
    gates: rejectGates(),
  });

  const fitReport = lightFitReport(frozenCalibration);

  // Lay everything down on disk.
  const modelDir = join(root, "models", "cleanfeed-ptbr-v1");
  await mkdir(modelDir, { recursive: true });
  await writeFile(
    join(modelDir, "calibration-profiles.json"),
    PROFILES_TEMPLATE_TEXT,
    "utf8",
  );
  await writeFile(
    join(modelDir, "release.json"),
    RELEASE_TEMPLATE_TEXT,
    "utf8",
  );

  const reportPath = join(root, "out", "benchmark-report.json");
  const frozenCalibrationPath = join(root, "out", "frozen-calibration.json");
  const datasetAuditPath = join(root, "out", "dataset-audit.json");
  const sourceReadinessPath = join(root, "out", "source-readiness.json");
  const splitArtifactPath = join(root, "out", "split-artifact.json");
  const fitReportPath = join(root, "out", "fit-report.json");
  const ledgerPath = join(root, "data", "private", "holdout-ledger.jsonl");

  await writeJson(reportPath, report);
  await writeJson(frozenCalibrationPath, frozenCalibration);
  await writeJson(datasetAuditPath, datasetAudit);
  await writeJson(sourceReadinessPath, sourceReadiness);
  await writeJson(splitArtifactPath, splitArtifact);
  await writeJson(fitReportPath, fitReport);

  // publish-profile writes the two model-metadata files (Phase 2 owns them).
  await runPublishProfile({
    reportPath,
    frozenCalibrationPath,
    issuedAt: GENERATED_AT,
    modelDirectory: modelDir,
  });

  // An approved model license review (the deferred real publish requires this).
  await writeJson(join(modelDir, "license-review.json"), {
    schemaVersion: 1,
    modelId: MODEL_ID,
    status: "approved",
    declaredLicense: "MIT",
    reviewedAt: GENERATED_AT,
    reviewer: "legal-reviewer-01",
    evidence: [],
  });

  // A completed holdout ledger: started then completed with the sealed digest.
  const identity = {
    datasetDigest,
    datasetAuditDigest: datasetAudit.auditDigest,
    sourceReadinessDigest: sourceReadiness.reportDigest,
    splitDigest,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: BUNDLE_DIGEST,
    aggregationVersion: AGGREGATION_VERSION,
    contentCompositionVersion: CONTENT_COMPOSITION_VERSION,
    tokenizerDigest: TOKENIZER_DIGEST,
    runtimeParityDigest: PARITY,
    extensionBuildDigest: BUILD,
    backend: "wasm" as const,
    chromeVersion: "150.0.7871.129" as const,
    evaluatorDigest: EVALUATOR,
    calibrationArtifactDigest: frozenCalibration.artifactDigest,
  };
  const started = {
    schemaVersion: 1,
    ...identity,
    consumptionId: CONSUMPTION_ID,
    startedAt: GENERATED_AT,
    terminalAt: null,
    status: "started",
    reportDigest: null,
    failureCode: null,
  };
  const completed = {
    ...started,
    terminalAt: GENERATED_AT,
    status: "completed",
    reportDigest: report.reportDigest,
    failureCode: null,
  };
  await mkdir(dirname(ledgerPath), { recursive: true });
  await writeFile(
    ledgerPath,
    `${JSON.stringify(started)}\n${JSON.stringify(completed)}\n`,
    "utf8",
  );

  return {
    root,
    modelDir,
    outputDir: join(root, "evidence", "tmr-ptbr-v1"),
    reportPath,
    frozenCalibrationPath,
    datasetAuditPath,
    sourceReadinessPath,
    splitArtifactPath,
    fitReportPath,
    ledgerPath,
    consumptionId: CONSUMPTION_ID,
    report,
  };
}
