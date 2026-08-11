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
import {
  selectionThresholdEvidence,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import {
  COMPOSITION_GATE_PARTITION,
  compositionBoundsOf,
  compositionBreachesOf,
  type CellComposition,
  type CompositionReport,
} from "../composition-gate.ts";
import { emptyLabelBasisPublication } from "../dataset-manifest.ts";
import { standInClusterReport } from "../split-audit.ts";
import { V3_GROUP_AXES } from "../schema.ts";
import type { DatasetAudit } from "../dataset-manifest.ts";
import type { FitReport } from "../candidate-preflight.ts";
import {
  computePredictionManifestDigest,
  type PredictionManifestV1,
} from "../prediction-schema.ts";
import { buildModelPublication } from "../profile-artifact.ts";
import { freezeProvisionalThreshold } from "../provisional-threshold.ts";
import {
  buildBenchmarkReport,
  type BenchmarkReport,
  type GovernanceSeal,
} from "../report.ts";
import type { GateReport } from "../gates.ts";
import {
  declaredResamplingPlan,
  type DecisionFamilies,
  type DecisionMetrics,
  type EvaluationMetrics,
  type MetricEstimate,
} from "../metrics.ts";
import type { SliceSummary } from "../slices.ts";
import type { SplitArtifact, SplitAssignment } from "../split-artifact.ts";
import { withoutSplitDigest } from "../split-artifact.ts";
import { PARTITIONS } from "../split.ts";
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
const CONTENT_COMPOSITION_VERSION = "lexical-content-v2";

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
    labelBasisCounts: emptyLabelBasisPublication(),
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
// `counts` and `audit.sizes` are checked against the assignments they summarise, so the
// assignments are generated here and the counts DERIVED from them. Typing the three
// numbers separately lets them describe different partitionings while every digest
// still recomputes.
const SPLIT_FIXTURE_COUNTS = {
  train: 45,
  dev: 5,
  "cal-A": 10,
  "cal-B": 20,
  test: 20,
} as const;

function splitFixtureAssignments(): SplitAssignment[] {
  const rows: SplitAssignment[] = [];
  for (const partition of PARTITIONS) {
    for (let index = 0; index < SPLIT_FIXTURE_COUNTS[partition]; index += 1) {
      rows.push({ id: `${partition}-${index}`, partition });
    }
  }
  return rows;
}

// The receipt a `release` seal carries. These fixtures publish a HYPOTHETICAL corpus — the
// assignments are stubs and no records travel with them — so the cell row is authored, but
// the floors and the verdict are DERIVED by the production functions: a receipt whose
// verdict were typed here would agree with a changed policy and nobody would notice.
function passingCompositionReceipt(): CompositionReport {
  const bounds = compositionBoundsOf();
  const cells: readonly CellComposition[] =
    PREREGISTRATION_V4.preRegistration.quotaAxis.cells.map((cell) => ({
      cell,
      humanNegativeLines: bounds.lineFloor,
      ineligibleLines: 0,
      independentUnits: bounds.unitFloor,
      originDocuments: bounds.lineFloor,
      linesWithoutOriginDocument: 0,
      linesInBusiestOriginDocument: bounds.maximumLinesPerOriginDocument,
    }));
  const breaches = compositionBreachesOf(cells, bounds);
  return {
    partition: COMPOSITION_GATE_PARTITION,
    cells,
    ...bounds,
    breaches,
    passed: breaches.length === 0,
  };
}

async function lightSplitArtifact(
  report: BenchmarkReport,
): Promise<SplitArtifact> {
  // `algorithmDigest` is REAL, not a stub: `publish-evidence` recomputes it from the
  // algorithm plus the policy, because that pair is what a re-sealed forgery cannot fake.
  const artifact: SplitArtifact = {
    schemaVersion: 4,
    datasetDigest: report.dataset.digest,
    algorithm: "blocked-group-time-v2",
    algorithmDigest: "",
    seed: PREREGISTRATION_V4.seeds.split,
    compositionAttestation: hex("composition-attestation"),
    compositionReceipt: passingCompositionReceipt(),
    policy: {
      fractions: {
        train: 0.45,
        dev: 0.05,
        "cal-A": 0.1,
        "cal-B": 0.2,
        test: 0.2,
      },
      classTolerance: 0.02,
      heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
      seed: PREREGISTRATION_V4.seeds.split,
    },
    assignments: splitFixtureAssignments(),
    assignmentsDigest: hex("assignments"),
    splitDigest: report.split.digest,
    cutoffs: {
      latestTrain: 100,
      latestDev: 200,
      latestCalA: 300,
      latestCalB: 400,

      earliestCalA: 250,

      earliestCalB: 350,
      earliestTest: 500,
    },
    counts: { ...SPLIT_FIXTURE_COUNTS },
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
    audit: {
      sizes: { ...SPLIT_FIXTURE_COUNTS },
      classFractions: {
        human: {
          train: 0.45,
          dev: 0.05,
          "cal-A": 0.1,
          "cal-B": 0.2,
          test: 0.2,
        },
        ai: {
          train: 0.45,
          dev: 0.05,
          "cal-A": 0.1,
          "cal-B": 0.2,
          test: 0.2,
        },
        mixed: {
          train: 0.45,
          dev: 0.05,
          "cal-A": 0.1,
          "cal-B": 0.2,
          test: 0.2,
        },
      },
      cutoffs: {
        latestTrain: 100,
        latestDev: 200,
        latestCalA: 300,
        latestCalB: 400,

        earliestCalA: 250,

        earliestCalB: 350,
        earliestTest: 500,
      },
      leakages: [],
      clusters: standInClusterReport(V3_GROUP_AXES),
      declaredAxisGaps: [],
      criticalSliceSamples: [],
      // Consistent with THIS fixture's twenty test assignments, and it has to be stated
      // by hand: a count of 2000 over a blind block of twenty rows is cryptographically
      // sealed and semantically impossible, and the publication path cannot detect it
      // because it has no dataset to check against. Only `validateSplitArtifact`
      // re-derives the audit, so a
      // fixture on the publication path has to be honest by construction.
      testHumanNegatives: {
        count: SPLIT_FIXTURE_COUNTS.test,
        reportingThreshold: 2_000,
        sufficientForReleaseFpr: false,
      },
      heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
      incidentalTestOnlyGeneratorFamilies: [],
      passed: true,
      reasons: [],
    },
  };
  artifact.algorithmDigest = await canonicalSha256({
    algorithm: artifact.algorithm,
    policy: artifact.policy,
  });
  return artifact;
}

function lightFitReport(frozen: FrozenCalibrationArtifact): FitReport {
  return {
    schemaVersion: 1,
    // The cut the release decided on, frozen over the SAME governance digests: the
    // sanitizer projects its value, population and digest into the published
    // fit-summary.json, so a hand-written stub would publish a cut that closes over
    // nothing.
    provisionalThreshold: freezeProvisionalThreshold({
      samples: Array.from({ length: 100 }, (_unused, index) => ({
        id: `fit_${String(index).padStart(3, "0")}`,
        label: "human",
        partition: PREREGISTRATION_V4.threshold.quantilePartitions[index % 2]!,
        documentRawScore: index / 200,
      })),
      testIds: [],
      seed: PREREGISTRATION_V4.seeds.split,
      digests: {
        datasetDigest: frozen.datasetDigest,
        datasetAuditDigest: frozen.datasetAuditDigest,
        splitDigest: frozen.splitDigest,
        evaluatorDigest: frozen.evaluatorDigest,
        sourceReadinessDigest: frozen.sourceReadinessDigest,
        developmentManifestDigest: frozen.predictionManifestDigests.development,
        calibrationManifestDigest: frozen.predictionManifestDigests.calibration,
      },
    }),
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
    partitionsUsed: ["dev", "cal-A"],
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
      splitArtifact: await lightSplitArtifact(report),
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
    positivePopulation: "warning-positives",
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
    // B2: no visual-action threshold in this fixture, so nothing may authorize
    // an action either.
    actionAuthorization: null,
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
    // The A6 role-named blocks. This fixture never reads them; it only has to be
    // structurally complete, so the release block mirrors the empty matrix and
    // every conditional block carries its error-rate companion.
    release: {
      role: "release",
      thresholdSource: "preregistered-provisional-threshold",
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
    // C4: the unit every estimand declares. `declared-only` throughout, because
    // this fixture resamples nothing; the gate still needs the unit to exist.
    resampling: declaredResamplingPlan(),
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
    latency: { scored: null, abstained: null, errored: null },
    memory: { sampleSize: 0, meanBytes: 0, maxBytes: 0 },
    mixed: {
      atLeastHalfAi: {
        generationMode: "mechanistic",
        sampleSize: 0,
        warningRecall: 0,
        warningRecallLower95: 0,
      },
      byGenerationMode: [],
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

// A rejected run, and the failing gate is a CERTIFYING one: only a member of the
// primary family produces `reject`, so a fixture whose single failure is a diagnostic
// would be a decision no gate policy can emit. The cell is READ from the frozen quota
// axis for the same reason: `covers: true` beside a hypothesis the family does not
// carry is also a report no gate policy can emit, and a hard-coded cell becomes one the
// moment the frame is amended.
const REJECTED_CELL = PREREGISTRATION_V4.preRegistration.quotaAxis.cells[0];
const REJECTED_GATE = `warning.fpr.slice.humanSourceType.${REJECTED_CELL}`;

export function rejectGates(): GateReport {
  const family = PREREGISTRATION_V4.multiplicity.primaryFamily;
  return {
    schemaVersion: 3,
    multiplicity: {
      correction: "bonferroni",
      familyAlpha: 0.05,
      descriptiveConfidence: 0.95,
      frozenAt: "G0.2",
      declared: PREREGISTRATION_V4.multiplicity.primaryFamilySize,
      observed: family.length,
      gateIds: [REJECTED_GATE],
      primaryFamily: family,
      hypotheses: [...family],
      missingHypotheses: [],
      unexpectedHypotheses: [],
      perGateAlpha: PREREGISTRATION_V4.multiplicity.perHypothesisAlpha,
      covers: true,
    },
    decision: "reject",
    gates: [
      {
        id: REJECTED_GATE,
        tier: "warning",
        role: "certifying",
        hypothesis: `fpr-${REJECTED_CELL}`,
        scope: "slice",
        slice: { axis: "humanSourceType", key: REJECTED_CELL },
        estimand: "warning.fpr.slice",
        evidence: "present",
        observed: 0.1,
        bound: "simultaneous-upper",
        operator: "<=",
        required: 0.05,
        sampleSize: 2_000,
        eligible: true,
        passed: false,
        reasons: [
          `critical FPR slice humanSourceType/${REJECTED_CELL} warning FPR ` +
            "simultaneous upper bound 0.1 exceeds 0.05",
        ],
      },
    ],
    failedIntegrity: [],
    failedWarning: [REJECTED_GATE],
    failedAction: [],
    failedCertifying: [REJECTED_GATE],
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

  const auditBase: Omit<DatasetAudit, "auditDigest"> = {
    datasetId: "cleanfeed-ptbr-cells-v1",
    scientificUse: "release",
    releaseEligible: true,
    recordCount: 10_000,
    counts: { human: 4_000, ai: 4_000, mixed: 2_000 },
    sourceTypes: { "qa-informal": 2_000, encyclopedic: 2_000 },
    hardNegativeFamilies: { formulaic: 500 },
    generatorFamilies: { acme_family: 4_000 },
    labelBasisCounts: emptyLabelBasisPublication(),
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
    schemaVersion: 4,
    datasetDigest,
    algorithm: "blocked-group-time-v2",
    // Sealed below, from the algorithm plus the policy: `publish-evidence` recomputes it.
    algorithmDigest: "",
    seed: PREREGISTRATION_V4.seeds.split,
    compositionAttestation: hex("composition-attestation"),
    compositionReceipt: passingCompositionReceipt(),
    policy: {
      fractions: {
        train: 0.45,
        dev: 0.05,
        "cal-A": 0.1,
        "cal-B": 0.2,
        test: 0.2,
      },
      classTolerance: 0.02,
      heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
      seed: PREREGISTRATION_V4.seeds.split,
    },
    assignments: splitFixtureAssignments(),
    assignmentsDigest: "",
    splitDigest: "",
    cutoffs: {
      latestTrain: 100,
      latestDev: 200,
      latestCalA: 300,
      latestCalB: 400,

      earliestCalA: 250,

      earliestCalB: 350,
      earliestTest: 500,
    },
    counts: { ...SPLIT_FIXTURE_COUNTS },
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
    audit: {
      sizes: { ...SPLIT_FIXTURE_COUNTS },
      classFractions: {
        human: {
          train: 0.45,
          dev: 0.05,
          "cal-A": 0.1,
          "cal-B": 0.2,
          test: 0.2,
        },
        ai: {
          train: 0.45,
          dev: 0.05,
          "cal-A": 0.1,
          "cal-B": 0.2,
          test: 0.2,
        },
        mixed: {
          train: 0.45,
          dev: 0.05,
          "cal-A": 0.1,
          "cal-B": 0.2,
          test: 0.2,
        },
      },
      cutoffs: {
        latestTrain: 100,
        latestDev: 200,
        latestCalA: 300,
        latestCalB: 400,

        earliestCalA: 250,

        earliestCalB: 350,
        earliestTest: 500,
      },
      leakages: [],
      clusters: standInClusterReport(V3_GROUP_AXES),
      declaredAxisGaps: [],
      criticalSliceSamples: [],
      // Consistent with THIS fixture's twenty test assignments. A count of 2000
      // over a blind block of twenty rows: cryptographically sealed and semantically
      // impossible, which the publication path cannot detect because it has no dataset
      // to check against. Only `validateSplitArtifact` re-derives the audit, so a
      // fixture on the publication path has to be honest by construction.
      testHumanNegatives: {
        count: SPLIT_FIXTURE_COUNTS.test,
        reportingThreshold: 2_000,
        sufficientForReleaseFpr: false,
      },
      heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
      incidentalTestOnlyGeneratorFamilies: [],
      passed: true,
      reasons: [],
    },
  };
  // Sealed in dependency order, because each digest covers the ones before it. The
  // fixture cannot carry hand-written hex stubs here, because `publish-evidence`
  // recomputes — and recomputing them is the whole point: a declared digest is exactly
  // what a tampered artifact keeps.
  splitArtifact.assignments.sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  splitArtifact.assignmentsDigest = await canonicalSha256(
    splitArtifact.assignments,
  );
  splitArtifact.algorithmDigest = await canonicalSha256({
    algorithm: splitArtifact.algorithm,
    policy: splitArtifact.policy,
  });
  splitArtifact.splitDigest = await canonicalSha256(
    withoutSplitDigest(splitArtifact),
  );
  const splitDigest = splitArtifact.splitDigest;

  const devManifest = predictionManifest(
    "dev",
    datasetDigest,
    splitDigest,
    null,
  );
  const calManifest = predictionManifest(
    "cal-A",
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
    partitionsUsed: ["dev", "cal-A"],
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
      warning: selectionThresholdEvidence({
        documentThreshold: 0.7,
        localizedThreshold: 0.65,
        negatives: 2_000,
        falsePositives: 40,
        selectionFprUpper95Nominal: 0.03,
        positives: 2_000,
        truePositives: 1_600,
        recall: 0.8,
      }),
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
      id: "cleanfeed-ptbr-cells-v1",
      version: "1.0.0",
      digest: datasetDigest,
    },
    split: {
      digest: splitDigest,
      strategy: "blocked-group-time-v2",
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
  // The pre-registered cut lives beside the frozen calibration, and `publish-profile`
  // REQUIRES it: the served profile carries this threshold, so a publication without it
  // could only serve a cut the evidence never measured.
  await writeJson(
    join(root, "out", "provisional-threshold.json"),
    fitReport.provisionalThreshold,
  );

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
