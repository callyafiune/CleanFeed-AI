import { describe, expect, it } from "vitest";

import type { GateReport } from "../gates.ts";
import { declaredResamplingPlan, type EvaluationMetrics } from "../metrics.ts";
import type {
  ResamplingDemotion,
  ResamplingUnitDeclaration,
} from "../bootstrap.ts";
import {
  computePredictionManifestDigest,
  type PredictionManifestV1,
} from "../prediction-schema.ts";
import {
  buildBenchmarkReport,
  mixedRecallSection,
  renderReportMarkdown,
  ReportGovernanceError,
  type BenchmarkReportInput,
  type GovernanceSeal,
} from "../report.ts";
import type { SliceResult, SliceSummary } from "../slices.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import { standInClusterReport, type SplitAudit } from "../split-audit.ts";
import { V3_GROUP_AXES } from "../schema.ts";
import { asGeneratorFamily } from "../generator-family.ts";

// --- fixture builders ------------------------------------------------------

// One resampling unit as a producer publishes it: the frozen human/calibration
// hierarchy, with the measured level counts and any demotion it forced.
function unit(
  estimand: string,
  items: number,
  units: number,
  demotions: readonly ResamplingDemotion[],
): ResamplingUnitDeclaration {
  return {
    estimand,
    method: "hierarchical",
    axes: ["groups.domainSource", "groups.author"],
    items,
    units,
    levels: [
      {
        position: 0,
        axis: "groups.domainSource",
        levels: 2,
        degenerate: false,
      },
      { position: 1, axis: "groups.author", levels: units, degenerate: false },
    ],
    demotions,
    degenerate: false,
  };
}

// A distinct lowercase 64-char hex per label.
function hex(label: string): string {
  let out = "";
  for (const ch of label) out += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return out.padEnd(64, "0").slice(0, 64);
}

const SESSION = "session-2026-07-19";
const DATASET_AUDIT = hex("dataset-audit");
const SOURCE_READINESS = hex("source-readiness");
const PARITY = hex("runtime-parity");
const BUNDLE = hex("bundle");
const TOKENIZER = hex("tokenizer");
const BUILD = hex("extension-build");
const DATASET_DIGEST = hex("dataset-digest");
const SPLIT_DIGEST = hex("split-digest");
const EVALUATOR = hex("evaluator");
const CALIBRATION = hex("cal-A");

function seal(): GovernanceSeal {
  return {
    datasetAuditDigest: DATASET_AUDIT,
    sourceReadinessDigest: SOURCE_READINESS,
    holdoutConsumptionId: SESSION,
    runtimeParityDigest: PARITY,
    model: {
      id: "cleanfeed-ptbr-v1",
      version: "1.0.0",
      bundleDigest: BUNDLE,
      tokenizerDigest: TOKENIZER,
      aggregationVersion: "aggregation-v1",
      contentCompositionVersion: "content-composition-v1",
    },
    scoringRuntime: {
      extensionBuildDigest: BUILD,
      backend: "wasm",
      chromeVersion: "150.0.7871.129",
    },
  };
}

function cloneSeal(source: GovernanceSeal): GovernanceSeal {
  return {
    ...source,
    model: { ...source.model },
    scoringRuntime: { ...source.scoringRuntime },
  };
}

function manifest(
  partition: PredictionManifestV1["partition"],
  holdoutConsumptionId: string | null,
  shard: string,
): PredictionManifestV1 {
  return {
    schemaVersion: 1,
    modelId: "cleanfeed-ptbr-v1",
    modelVersion: "1.0.0",
    bundleDigest: BUNDLE,
    aggregationVersion: "aggregation-v1",
    contentCompositionVersion: "content-composition-v1",
    tokenizerDigest: TOKENIZER,
    runtimeParityDigest: PARITY,
    extensionBuildDigest: BUILD,
    backend: "wasm",
    chromeVersion: "150.0.7871.129",
    datasetDigest: DATASET_DIGEST,
    splitDigest: SPLIT_DIGEST,
    partition,
    shardSize: 100,
    shardCount: 1,
    shards: [
      {
        index: 0,
        file: `${partition}/shard-000.jsonl`,
        sha256: hex(shard),
        recordCount: 100,
      },
    ],
    holdoutConsumptionId,
    createdAt: "2026-07-19T00:00:00.000Z",
  };
}

function splitAudit(): SplitAudit {
  return {
    sizes: {
      train: 4_500,
      dev: 500,
      "cal-A": 1_000,
      "cal-B": 2_000,
      test: 2_000,
    },
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
    testHumanNegatives: {
      count: 2_000,
      reportingThreshold: 2_000,
      sufficientForReleaseFpr: true,
    },
    heldOutGeneratorFamilies: [],
    incidentalTestOnlyGeneratorFamilies: [],
    passed: true,
    reasons: [],
  };
}

function gateReport(overrides: Partial<GateReport> = {}): GateReport {
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
      gateIds: [],
      primaryFamily: family,
      hypotheses: [...family],
      missingHypotheses: [],
      unexpectedHypotheses: [],
      perGateAlpha: PREREGISTRATION_V4.multiplicity.perHypothesisAlpha,
      covers: true,
    },
    decision: "pass",
    gates: [
      {
        id: "warning.fpr.overall",
        tier: "warning",
        // The pooled FPR is not a member of the primary family: the four per-cell
        // ceilings are.
        role: "diagnostic",
        scope: "overall",
        estimand: "warning.fpr",
        evidence: "present",
        observed: 0.01,
        bound: "simultaneous-upper",
        descriptive: {
          bound: "upper95",
          value: 0.012,
          confidence: 0.95,
          role: "descriptive",
        },
        operator: "<=",
        required: 0.05,
        sampleSize: 2_000,
        eligible: true,
        passed: true,
        reasons: [],
      },
    ],
    failedIntegrity: [],
    failedWarning: [],
    failedAction: [],
    failedCertifying: [],
    ...overrides,
  };
}

// The metrics/slices are stored in the report body verbatim but never enter the
// report digest, so a minimal cast is enough for these tests.
function metrics(): EvaluationMetrics {
  return {
    simulatedPrecision: {
      prevalence01: 0.5,
      prevalence05: 0.8,
      prevalence10: 0.9,
    },
    warning: {
      endToEnd: {
        family: "end-to-end",
        positives: 4,
        negatives: 4,
        undecidedPositives: 1,
        undecidedNegatives: 1,
        falsePositiveRate: { value: 1 / 3, upper95: 0.6, method: "point" },
        clearanceRate: { value: 0.5, method: "point" },
        recall: { value: 0.5, lower95: 0.2, method: "point" },
      },
      conditionalOnScored: {
        family: "conditional-on-scored",
        positives: 3,
        negatives: 3,
        undecidedPositives: 0,
        undecidedNegatives: 0,
        falsePositiveRate: { value: 1 / 3, upper95: 0.6, method: "point" },
        clearanceRate: { value: 2 / 3, method: "point" },
        recall: { value: 0.75, lower95: 0.4, method: "point" },
      },
    },
    visualAction: null,
    release: {
      role: "release",
      thresholdSource: "preregistered-provisional-threshold",
      warning: {
        role: "release",
        decision: "warning",
        family: "end-to-end",
        recall: { value: 0.5, lower95: 0.2, method: "wilson-one-sided" },
        falsePositiveRate: {
          value: 1 / 3,
          upper95: 0.6,
          method: "wilson-one-sided",
          simultaneous: {
            correction: "bonferroni",
            familyAlpha: 0.05,
            m: 8,
            alpha: 0.00625,
            lower: 0,
            upper: 0.71,
            method: "wilson-one-sided",
          },
        },
        errorRatePopulation: "eligible-decision-population",
        errorRate: { value: 0.2, method: "point" },
        conditional: {
          role: "diagnostic",
          family: "conditional-on-scored",
          selectiveFailureSensitive: true,
          recall: { value: 0.75, lower95: 0.4, method: "wilson-one-sided" },
          falsePositiveRate: {
            value: 1 / 3,
            upper95: 0.6,
            method: "wilson-one-sided",
          },
          errorRatePopulation: "eligible-decision-population",
          errorRate: { value: 0.2, method: "point" },
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
      errorRate: { value: 0.3, method: "point" },
      auroc: {
        value: 0.9647,
        lower95: 0.95,
        upper95: 0.97,
        method: "hierarchical-cluster-percentile",
      },
      prAuc: { value: 0.9788, method: "hierarchical-cluster-percentile" },
      tprAtOnePercentFpr: {
        targetFpr: 0.01,
        achievedFpr: 0.0098,
        tpr: 0.4213,
        threshold: 0.87,
        sampleSize: 8,
      },
    },
    calibration: {
      role: "diagnostic",
      gatedStatistic: "eceEqualMass15",
      population: "conditional-on-scored",
      scored: 7,
      populationSize: 10,
      errorRatePopulation: "binary-population",
      errorRate: { value: 0.3, method: "point" },
      brier: { value: 0.0812, method: "hierarchical-cluster-percentile" },
      logLoss: 0.2731,
      intercept: -0.12,
      slope: 0.71,
      bins: 15,
      eceEqualMass15: {
        value: 0.0819,
        lower95: 0.0731,
        upper95: 0.0908,
        method: "hierarchical-cluster-percentile",
        // The bound the ECE gate reads, with the effort behind it: at m = 40 the
        // alpha is 0.00125, so 2000 replicates leave two beyond the bound.
        simultaneous: {
          correction: "bonferroni",
          familyAlpha: 0.05,
          m: 40,
          alpha: 0.00125,
          replicates: 2_000,
          tailReplicates: 2,
          lower: 0.0605,
          upper: 0.1032,
          method: "hierarchical-cluster-percentile",
        },
      },
      reliability: [
        {
          index: 0,
          count: 4,
          meanProbability: 0.12,
          positiveRate: 0.25,
          lowestProbability: 0.1,
          highestProbability: 0.2,
        },
      ],
      byLengthBucket: [
        {
          key: "50_79",
          count: 3,
          populationSize: 4,
          resamplingUnit: unit("calibration.ece", 4, 3, []),
          brier: 0.08,
          logLoss: 0.27,
          eceEqualMass: 0.09,
          errorRate: { value: 0.25, method: "point" },
        },
      ],
      bySource: [],
      byLinguisticStratum: [],
    },
    labelBasis: {
      role: "human-negative-label-evidence",
      fieldPresent: true,
      pooledClaimAllowed: false,
      bases: [
        {
          basis: "date-cutoff",
          count: 900,
          scored: 890,
          errored: 10,
          resamplingUnit: unit("warning.fpr.labelBasis", 900, 640, [
            {
              position: 1,
              from: "groups.author",
              to: "groups.source",
              items: 12,
            },
          ]),
          powered: true,
          powerFloor: 300,
          evidenceRole: "gating",
          // The published upper bound is Wilson's under a design that RAN: the
          // envelope's rule took the wider of the two, and the plan's entry for
          // `warning.fpr.labelBasis` points here for exactly this reason.
          falsePositiveRate: {
            value: 0.03,
            upper95: 0.041,
            method: "hierarchical-cluster-percentile",
            boundEnvelope: {
              rule: "wider-of-analytic-and-resampled",
              analytic: {
                lower: 0.021,
                upper: 0.041,
                method: "wilson-one-sided",
              },
              resampled: {
                lower: 0.021,
                upper: 0.037,
                method: "hierarchical-cluster-percentile",
              },
              lowerFrom: "resampled",
              upperFrom: "analytic",
            },
          },
          errorRate: { value: 0.011, method: "wilson-one-sided" },
          brier: 0.07,
          logLoss: 0.24,
          eceEqualMass: 0.06,
        },
        {
          basis: "observed-process",
          count: 12,
          scored: 12,
          errored: 0,
          resamplingUnit: unit("warning.fpr.labelBasis", 12, 9, []),
          powered: false,
          powerFloor: 300,
          evidenceRole: "supplementary-diagnostic",
          falsePositiveRate: {
            value: 0,
            upper95: 0.221,
            method: "wilson-one-sided",
          },
          errorRate: { value: 0, method: "wilson-one-sided" },
          brier: 0.03,
          logLoss: 0.11,
          eceEqualMass: 0.04,
        },
      ],
    },
    predictiveValue: {
      role: "release-context",
      family: "end-to-end",
      benchmarkPrevalence: 0.5,
      byPrevalence: [
        { prevalence: 0.01, ppv: 0.0151, npv: 0.9949 },
        { prevalence: 0.05, ppv: 0.0732, npv: 0.9739 },
        { prevalence: 0.1, ppv: 0.1429, npv: 0.9459 },
      ],
    },
    // C4: the units, declared per estimand. Two entries are overridden below so
    // the section has both a measured unit and a recorded demotion to publish.
    resampling: (() => {
      const plan = declaredResamplingPlan();
      return {
        ...plan,
        entries: plan.entries.map((entry) => {
          // The case the previous round published wrong: the design RAN and the
          // limit a gate decides on came out of Wilson anyway, because zero false
          // positives make the resampled upper bound 0 and the frozen rule takes
          // the wider of the two. Measured on the 40-author fixture in
          // metrics.test.ts, not invented here.
          if (entry.estimand === "warning.fpr") {
            return {
              ...entry,
              executed: "percentile-bootstrap" as const,
              publishedBound: {
                kind: "envelope" as const,
                rule: "wider-of-analytic-and-resampled" as const,
                individual: {
                  lowerFrom: "resampled" as const,
                  upperFrom: "analytic" as const,
                },
                simultaneous: {
                  kind: "both-estimators" as const,
                  lowerFrom: "resampled" as const,
                  upperFrom: "analytic" as const,
                },
              },
              measured: unit("warning.fpr", 80, 40, []),
            };
          }
          if (entry.estimand === "calibration.ece") {
            return {
              ...entry,
              executed: "percentile-bootstrap" as const,
              publishedBound: { kind: "resampled-only" as const },
              measured: unit("calibration.ece", 8, 5, [
                {
                  position: 1,
                  from: "groups.author",
                  to: "groups.source",
                  items: 3,
                },
              ]),
            };
          }
          // The mixed row as a real run publishes it: MEASURED and degenerate in
          // both factors, with the substitute factor at a single level. The report
          // has to print the degeneracy, not the prose about degeneracy.
          if (entry.estimand === "warning.fpr.labelBasis") {
            return {
              ...entry,
              executed: "percentile-bootstrap" as const,
              publishedBound: {
                kind: "per-interval" as const,
                where:
                  'coluna "Procedência do limite" da tabela de bases de rótulo ' +
                  "humano (labelBasis.bases[].falsePositiveRate.boundEnvelope)",
              },
              measurementNote:
                "medida por base: 2 base(s); a unidade de cada base está em " +
                "labelBasis.bases[].resamplingUnit",
            };
          }
          if (entry.estimand === "mixed.warning.recall") {
            return {
              ...entry,
              executed: "declared-only" as const,
              publishedBound: { kind: "analytic-only" as const },
              measured: {
                estimand: "mixed.warning.recall",
                method: "multiway" as const,
                axes: ["groups.humanSeed", "groups.promptTemplate"],
                items: 3,
                units: 3,
                levels: [
                  {
                    position: 0,
                    axis: "groups.humanSeed",
                    levels: 3,
                    degenerate: true,
                  },
                  {
                    position: 1,
                    axis: "groups.promptTemplate",
                    levels: 1,
                    degenerate: false,
                    proxyFor: "operação de edição",
                  },
                ],
                demotions: [],
                degenerate: true,
              },
            };
          }
          return entry;
        }),
      };
    })(),
    multiplicity: {
      correction: "bonferroni",
      familyAlpha: 0.05,
      descriptiveConfidence: 0.95,
      m: 8,
      perGateAlpha: 0.00625,
      z: 2.4977,
    },
    // Only the material-assistance triple of `mixed`: the diagnostic section reads
    // that one block and the cast covers the cohort lists no section of this file
    // renders.
    mixed: {
      atLeastHalfAi: {
        generationMode: "mechanistic",
        sampleSize: 100,
        warningRecall: 0.3,
        warningRecallLower95: 0.2,
      },
    },
    coverage: { value: 0.75, method: "point" },
    abstentionRate: { value: 0.125, method: "point" },
    errorRate: { value: 0.125, method: "point" },
    decisionPopulationErrorRate: { value: 0.2, method: "point" },
    binaryPopulationErrorRate: { value: 0.3, method: "point" },
    resolution: {
      bySource: [
        {
          key: "ptwiki",
          eligible: 4,
          scored: 3,
          abstained: 0,
          errored: 1,
          coverage: { value: 0.75, method: "point" },
          abstentionRate: { value: 0, method: "point" },
          errorRate: { value: 0.25, method: "point" },
        },
      ],
      byClass: [
        {
          key: "human",
          eligible: 4,
          scored: 3,
          abstained: 0,
          errored: 1,
          coverage: { value: 0.75, method: "point" },
          abstentionRate: { value: 0, method: "point" },
          errorRate: { value: 0.25, method: "point" },
        },
      ],
      byLengthBucket: [
        {
          key: "50_79",
          eligible: 4,
          scored: 3,
          abstained: 0,
          errored: 1,
          coverage: { value: 0.75, method: "point" },
          abstentionRate: { value: 0, method: "point" },
          errorRate: { value: 0.25, method: "point" },
        },
      ],
      byPlatform: [
        {
          key: "wikipedia",
          eligible: 4,
          scored: 3,
          abstained: 0,
          errored: 1,
          coverage: { value: 0.75, method: "point" },
          abstentionRate: { value: 0, method: "point" },
          errorRate: { value: 0.25, method: "point" },
        },
      ],
    },
    // FPR per PRE-REGISTERED band. Two bands hold rows and two hold none, so the
    // rendered table has to show the empty ones as empty rather than skip them.
    lengthBands: {
      role: "diagnostic",
      gates: false,
      spendsAlpha: false,
      bands: [
        {
          key: "50_79",
          minimumWords: 50,
          maximumWords: 79,
          humanNegatives: 4,
          decidedNegatives: 3,
          falsePositives: 1,
          falsePositiveRate: 1 / 3,
        },
        {
          key: "80_149",
          minimumWords: 80,
          maximumWords: 149,
          humanNegatives: 0,
          decidedNegatives: 0,
          falsePositives: 0,
          falsePositiveRate: null,
        },
        {
          key: "150_299",
          minimumWords: 150,
          maximumWords: 299,
          humanNegatives: 0,
          decidedNegatives: 0,
          falsePositives: 0,
          falsePositiveRate: null,
        },
        {
          key: "300_PLUS",
          minimumWords: 300,
          maximumWords: null,
          humanNegatives: 2,
          decidedNegatives: 2,
          falsePositives: 2,
          falsePositiveRate: 1,
        },
      ],
    },
  } as unknown as EvaluationMetrics;
}

function slices(): SliceSummary {
  return {
    slices: [],
    macro: {
      warningFpr: 0.01,
      warningRecall: 0.75,
      actionFpr: null,
      actionRecall: null,
    },
    worst: {},
  };
}

// A topic slice, with the two class counts the diagnostic table reads and nothing else:
// the section prints `n/a` off the COUNTS, so a fixture that only set the rates could not
// tell the empty cell from a cell whose rate is genuinely zero.
function topicSlice(
  key: string,
  negatives: number,
  positives: number,
  falsePositiveRate: number,
  recall: number,
): SliceResult {
  return {
    axis: "topic",
    key,
    sampleSize: negatives + positives,
    negatives,
    positives,
    fprGateEligible: false,
    recallGateEligible: false,
    fprNegativeFloor: PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives,
    recallPositiveFloor: PREREGISTRATION_V4.powerFloors.criticalRecallPositives,
    metrics: {
      warning: {
        endToEnd: {
          falsePositiveRate: { value: falsePositiveRate },
          recall: { value: recall },
        },
      },
      visualAction: null,
    } as unknown as EvaluationMetrics,
  };
}

interface InputOverrides {
  frozen?: GovernanceSeal;
  observed?: GovernanceSeal;
  gates?: GateReport;
  testShard?: string;
  metrics?: EvaluationMetrics;
  slices?: SliceSummary;
}

function baseInput(overrides: InputOverrides = {}): BenchmarkReportInput {
  return {
    generatedAt: "2026-07-19T12:00:00.000Z",
    dataset: { id: "ptbr-generic", version: "v1", digest: DATASET_DIGEST },
    split: {
      digest: SPLIT_DIGEST,
      strategy: "blocked-group-time-v2",
      heldOutGeneratorFamilies: [],
      audit: splitAudit(),
    },
    evaluatorDigest: EVALUATOR,
    calibrationArtifactDigest: CALIBRATION,
    frozen: overrides.frozen ?? seal(),
    observed: overrides.observed ?? seal(),
    predictionManifests: {
      development: manifest("dev", null, "dev-shard"),
      calibration: manifest("cal-A", null, "cal-shard"),
      test: manifest("test", SESSION, overrides.testShard ?? "test-shard"),
    },
    metrics: overrides.metrics ?? metrics(),
    slices: overrides.slices ?? slices(),
    gates: overrides.gates ?? gateReport(),
  };
}

// One "## <title>" section of the markdown, up to the next "## ".
function section(markdown: string, title: string): string {
  const lines = markdown.split("\n");
  const start = lines.findIndex(
    (line) => line.startsWith("## ") && line.includes(title),
  );
  if (start < 0) throw new Error(`no section ${title} in the report`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

// --- sealing --------------------------------------------------------------

describe("buildBenchmarkReport governance sealing", () => {
  it("seals governance, session and the three executions into a schema v2 report", async () => {
    const report = await buildBenchmarkReport(baseInput());

    expect(report.schemaVersion).toBe(2);
    expect(report.holdoutConsumptionId).toBe(SESSION);
    expect(report.datasetAuditDigest).toBe(DATASET_AUDIT);
    expect(report.sourceReadinessDigest).toBe(SOURCE_READINESS);
    expect(report.runtimeParityDigest).toBe(PARITY);
    expect(report.evaluatorDigest).toBe(EVALUATOR);
    expect(report.calibrationArtifactDigest).toBe(CALIBRATION);
    expect(report.releaseDecision).toBe("pass");

    expect(report.predictionManifestDigests.development).toBe(
      await computePredictionManifestDigest(manifest("dev", null, "dev-shard")),
    );
    expect(report.predictionManifestDigests.calibration).toBe(
      await computePredictionManifestDigest(
        manifest("cal-A", null, "cal-shard"),
      ),
    );
    expect(report.predictionManifestDigests.test).toBe(
      await computePredictionManifestDigest(
        manifest("test", SESSION, "test-shard"),
      ),
    );

    expect(report.reportDigest).toMatch(/^[0-9a-f]{64}$/u);
  });
});

// --- divergence fails before metrics --------------------------------------

const DIVERGENCES: ReadonlyArray<
  readonly [string, (seal: GovernanceSeal) => void, RegExp]
> = [
  [
    "dataset audit",
    (s) => (s.datasetAuditDigest = hex("other-audit")),
    /datasetAuditDigest/u,
  ],
  [
    "source readiness",
    (s) => (s.sourceReadinessDigest = hex("other-ready")),
    /sourceReadinessDigest/u,
  ],
  [
    "consumption ID",
    (s) => (s.holdoutConsumptionId = "other-session"),
    /holdoutConsumptionId/u,
  ],
  [
    "tokenizer",
    (s) => (s.model.tokenizerDigest = hex("other-tok")),
    /tokenizerDigest/u,
  ],
  [
    "runtime parity",
    (s) => (s.runtimeParityDigest = hex("other-parity")),
    /runtimeParityDigest/u,
  ],
  [
    "build",
    (s) => (s.scoringRuntime.extensionBuildDigest = hex("other-build")),
    /extensionBuildDigest/u,
  ],
  [
    "backend",
    (s) => ((s.scoringRuntime as { backend: string }).backend = "webgpu"),
    /backend/u,
  ],
  [
    "Chrome",
    (s) =>
      ((s.scoringRuntime as { chromeVersion: string }).chromeVersion =
        "999.0.0.0"),
    /chromeVersion/u,
  ],
];

describe("buildBenchmarkReport rejects divergence before touching metrics", () => {
  it.each(DIVERGENCES)(
    "fails when the active %s diverges from the frozen seal",
    async (_name, mutate, pattern) => {
      const observed = cloneSeal(seal());
      mutate(observed);
      // A poison metrics object: any read throws, proving the governance check
      // runs BEFORE metrics are consulted.
      const poison = new Proxy(
        {},
        {
          get() {
            throw new Error(
              "metrics must not be read before governance passes",
            );
          },
        },
      ) as unknown as EvaluationMetrics;

      await expect(
        buildBenchmarkReport(baseInput({ observed, metrics: poison })),
      ).rejects.toThrow(ReportGovernanceError);
      await expect(
        buildBenchmarkReport(baseInput({ observed, metrics: poison })),
      ).rejects.toThrow(pattern);
    },
  );
});

// --- reportDigest sensitivity ---------------------------------------------

describe("reportDigest seals governance, session and the three executions", () => {
  it("changes when the dataset audit, source readiness, parity, consumption ID or a manifest digest changes", async () => {
    const base = await buildBenchmarkReport(baseInput());

    async function digestWith(
      mutate: (seal: GovernanceSeal) => void,
    ): Promise<string> {
      const frozen = cloneSeal(seal());
      const observed = cloneSeal(seal());
      mutate(frozen);
      mutate(observed);
      const report = await buildBenchmarkReport(
        baseInput({ frozen, observed }),
      );
      return report.reportDigest;
    }

    const auditChanged = await digestWith(
      (s) => (s.datasetAuditDigest = hex("audit-2")),
    );
    const readyChanged = await digestWith(
      (s) => (s.sourceReadinessDigest = hex("ready-2")),
    );
    const parityChanged = await digestWith(
      (s) => (s.runtimeParityDigest = hex("parity-2")),
    );
    const sessionChanged = await digestWith(
      (s) => (s.holdoutConsumptionId = "session-2"),
    );
    const manifestChanged = await buildBenchmarkReport(
      baseInput({ testShard: "test-shard-2" }),
    );

    for (const digest of [
      auditChanged,
      readyChanged,
      parityChanged,
      sessionChanged,
      manifestChanged.reportDigest,
    ]) {
      expect(digest).not.toBe(base.reportDigest);
    }
  });

  it("changes when a gate outcome changes", async () => {
    const base = await buildBenchmarkReport(baseInput());
    const rejected = await buildBenchmarkReport(
      baseInput({
        gates: gateReport({
          decision: "reject",
          // A `reject` is a CERTIFYING failure by construction of the policy, so the
          // gate that fails here is a member of the primary family.
          failedWarning: ["warning.fpr.slice.humanSourceType.ptwiki"],
          failedCertifying: ["warning.fpr.slice.humanSourceType.ptwiki"],
          gates: [
            {
              id: "warning.fpr.slice.humanSourceType.ptwiki",
              tier: "warning",
              role: "certifying",
              hypothesis: "fpr-ptwiki",
              scope: "slice",
              slice: { axis: "humanSourceType", key: "ptwiki" },
              estimand: "warning.fpr.slice",
              evidence: "present",
              observed: 0.08,
              bound: "simultaneous-upper",
              operator: "<=",
              required: 0.05,
              sampleSize: 2_000,
              eligible: true,
              passed: false,
              reasons: [
                "critical FPR slice humanSourceType/ptwiki warning FPR " +
                  "simultaneous upper bound 0.08 exceeds 0.05",
              ],
            },
          ],
        }),
      }),
    );
    expect(rejected.reportDigest).not.toBe(base.reportDigest);
    expect(rejected.releaseDecision).toBe("reject");
  });

  // The multiplicity block is the layer that says WHICH hypotheses the run decided and
  // under which divisor. Every gate can read green with `covers: false` — that is the
  // fail-closed shape of a run whose inventory is not the family — so a digest blind to
  // this block would let the two most consequential edits in the sealed report pass
  // unnoticed.
  it("changes when the multiplicity block changes, gates untouched", async () => {
    const base = await buildBenchmarkReport(baseInput());
    const family = PREREGISTRATION_V4.multiplicity.primaryFamily;
    const coversFlipped = await buildBenchmarkReport(
      baseInput({
        gates: gateReport({
          multiplicity: {
            ...gateReport().multiplicity,
            covers: false,
            missingHypotheses: ["fpr-ptwiki"],
            hypotheses: family.filter((member) => member !== "fpr-ptwiki"),
            observed: family.length - 1,
          },
        }),
      }),
    );
    const divisorChanged = await buildBenchmarkReport(
      baseInput({
        gates: gateReport({
          multiplicity: { ...gateReport().multiplicity, declared: 40 },
        }),
      }),
    );
    for (const digest of [
      coversFlipped.reportDigest,
      divisorChanged.reportDigest,
    ]) {
      expect(digest).not.toBe(base.reportDigest);
    }
    // And the two are not the same edit.
    expect(coversFlipped.reportDigest).not.toBe(divisorChanged.reportDigest);
  });

  it("changes when a gate's role or hypothesis changes, outcome untouched", async () => {
    const base = await buildBenchmarkReport(baseInput());
    const promoted = await buildBenchmarkReport(
      baseInput({
        gates: gateReport({
          gates: gateReport().gates.map((gate) => ({
            ...gate,
            role: "certifying" as const,
            hypothesis: "calibration-global",
          })),
        }),
      }),
    );
    expect(promoted.reportDigest).not.toBe(base.reportDigest);
    expect(promoted.releaseDecision).toBe("pass");
  });
});

// --- markdown -------------------------------------------------------------

describe("renderReportMarkdown", () => {
  it("leads with the decision and never prints accuracy as a headline", async () => {
    const report = await buildBenchmarkReport(baseInput());
    const md = renderReportMarkdown(report);

    expect(md.startsWith("# ")).toBe(true);
    const heading = md.split("\n", 1)[0].toLowerCase();
    expect(heading).toContain("pass");
    expect(md.toLowerCase()).not.toContain("# accuracy");
    expect(md.toLowerCase()).not.toContain("headline: accuracy");
  });

  // A4: the report is the fourth place the reserved families must agree, and the
  // only one a reader sees. The `generatorExposure` slice reports an `unseen`
  // bucket, and "unseen" is unreadable without the set beside it.
  it("publishes the reserved generator families, declared beside derived", async () => {
    const declared = [
      asGeneratorFamily("gemini-3_5-flash-low"),
      asGeneratorFamily("gemini-3_6-flash"),
    ];
    const input = baseInput();
    const report = await buildBenchmarkReport({
      ...input,
      split: {
        ...input.split,
        heldOutGeneratorFamilies: declared,
        audit: { ...input.split.audit, heldOutGeneratorFamilies: declared },
      },
    });
    const md = renderReportMarkdown(report);

    expect(md).toContain(
      "## Famílias geradoras retidas (não vistas no treino)",
    );
    expect(md).toContain(
      "- Declaradas e publicadas: `gemini-3_5-flash-low`, `gemini-3_6-flash`",
    );
    expect(md).toContain(
      "- Reserva honrada pelas partições (auditoria do split): `gemini-3_5-flash-low`, `gemini-3_6-flash`",
    );
    // Nothing merely concentrated itself in the blind block here, so the diagnostic
    // line is absent rather than printed empty.
    expect(md).not.toContain("Concentradas no bloco cego");
  });

  // A4-fix: an undeclared family whose every record-line landed in test is
  // DIAGNOSIS, printed apart from the reservation and gating nothing. Reading it as
  // a reservation is what made the exact equality unsatisfiable.
  it("publishes an incidental blind-block concentration apart from the reservation", async () => {
    const declared = [asGeneratorFamily("gemini-3_5-flash-low")];
    const input = baseInput();
    const report = await buildBenchmarkReport({
      ...input,
      split: {
        ...input.split,
        heldOutGeneratorFamilies: declared,
        audit: {
          ...input.split.audit,
          heldOutGeneratorFamilies: declared,
          incidentalTestOnlyGeneratorFamilies: [
            asGeneratorFamily("gemini-3_5-flash-medium"),
          ],
        },
      },
    });
    const md = renderReportMarkdown(report);

    expect(md).toContain("- Declaradas e publicadas: `gemini-3_5-flash-low`");
    expect(md).toContain(
      "- Concentradas no bloco cego sem reserva declarada (diagnóstico, não " +
        "reserva e não gate): `gemini-3_5-flash-medium`",
    );
  });

  it("publishes FPR and recall by topic, an empty cell as empty, and no topic gate", async () => {
    const md = renderReportMarkdown(
      await buildBenchmarkReport(
        baseInput({
          slices: {
            ...slices(),
            slices: [
              topicSlice("geografia", 400, 400, 0.0125, 0.94),
              // Positives only, and the rate is `NaN` because that is what `buildSlices`
              // PRODUCES over an empty side: `proportionEstimate` returns NaN on a zero
              // total (asserted against the real body in slices.test.ts, "keeps a topic
              // whose measured population is empty on one side").
              topicSlice("quimica", 0, 12, Number.NaN, 0.5),
              // Negatives only: the recall cell has no population at all.
              topicSlice("botanica", 12, 0, 0, Number.NaN),
              // The DEFENSIVE shape, and the reason the count is read beside the rate:
              // `metrics.ts` carries both conventions for a vanished denominator —
              // `proportionEstimate` gives NaN, and `ratio` gives 0 — so a slice with no
              // negatives arriving with a finite 0 is one refactor away and must still
              // print `n/a` rather than a perfect topic.
              topicSlice("fisica", 0, 8, 0, 0.25),
            ],
          },
        }),
      ),
    );
    const topic = section(md, "FPR e recall por tópico");
    expect(md).toContain("## FPR e recall por tópico (diagnóstico)");
    expect(topic).toContain(
      "| geografia | 800 | 400 | 400 | 0.0125 | 0.9400 | não |",
    );
    // The empty cells say `n/a` and never `0`: a rate of zero over nothing decided reads
    // as a perfect topic, which is the flattering direction.
    expect(topic).toContain(
      "| quimica | 12 | 0 | 12 | n/a (fatia vazia) | 0.5000 | não |",
    );
    expect(topic).toContain(
      "| fisica | 8 | 0 | 8 | n/a (fatia vazia) | 0.2500 | não |",
    );
    // A GENUINE zero over 12 decided negatives, printed as a rate — the row beside it
    // shows the difference the `n/a` exists to keep visible.
    expect(topic).toContain(
      "| botanica | 12 | 12 | 0 | 0 | n/a (fatia vazia) | não |",
    );
    // The thin topics are PRESENT rather than dropped, and none of them gates.
    expect(topic).not.toContain("| sim |");
  });

  // X1 — the published band table, and the two properties that make it readable.
  it("publishes the FPR of every pre-registered band with its own n, and an empty band as empty", async () => {
    const md = renderReportMarkdown(await buildBenchmarkReport(baseInput()));
    expect(md).toContain("## FPR por faixa de comprimento (diagnóstico)");
    expect(md).toContain(
      "- Papel: diagnostic · decide gate: não · gasta alpha: não",
    );
    // The block the shares add up to is in the HEADER, and it is the policy's number
    // rather than a literal beside cells that come from the policy.
    expect(md).toContain(
      `| n esperado a n=${PREREGISTRATION_V4.preRegistration.zeroEventCeiling.blindBlockLinesAtCollectionTarget} |`,
    );
    // The n of the band, not only its rate: a rate without its denominator is what
    // lets a band of 119 lines read like the headline's 800.
    expect(md).toContain("| 50–79 | 4 | 3 | 1 | 0.3333 | 238 | 0.0182 |");
    // The empty bands are PRESENT and say so, instead of vanishing from the table.
    expect(md).toContain(
      "| 80–149 | 0 | 0 | 0 | n/a (faixa vazia) | 239 | 0.0182 |",
    );
    expect(md).toContain(
      "| 150–299 | 0 | 0 | 0 | n/a (faixa vazia) | 204 | 0.0213 |",
    );
    // The top band is unbounded, and its expected n and ceiling are its OWN: 119
    // lines and 3.62 %, not the headline's 800 and 0.55 %.
    expect(md).toContain("| 300+ | 2 | 2 | 2 | 1 | 119 | 0.0362 |");
  });

  it("publishes the material-assistance recall beside its floor, with no verdict cell", async () => {
    const base = metrics();
    const mixedRow = async (warningRecall: number): Promise<string> => {
      const markdown = renderReportMarkdown(
        await buildBenchmarkReport(
          baseInput({
            metrics: {
              ...base,
              mixed: {
                ...base.mixed,
                atLeastHalfAi: {
                  ...base.mixed.atLeastHalfAi,
                  warningRecall,
                  warningRecallLower95: warningRecall - 0.1,
                },
              },
            },
          }),
        ),
      );
      const table = section(markdown, "Recall de assistência material");
      const row = table
        .split("\n")
        .find((line) => line.startsWith("| mechanistic |"));
      if (row === undefined) throw new Error("no cohort row in the section");
      return row;
    };

    // The FLOOR is the policy's number reaching the published row, and the OBSERVED
    // recall moves with the measurement: the two runs differ in one cell and agree in
    // the other. A `toContain("0.5")` would be satisfied by the AI-fraction sentence
    // in the section's own prose.
    const floor = PREREGISTRATION_V4.materialAssistance.minimumWarningRecall;
    expect(await mixedRow(0.3)).toBe(
      `| mechanistic | 100 | 0.3000 | 0.2000 | ${floor.toFixed(4)} |`,
    );
    expect(await mixedRow(0.8)).toBe(
      `| mechanistic | 100 | 0.8000 | 0.7000 | ${floor.toFixed(4)} |`,
    );

    const markdown = renderReportMarkdown(
      await buildBenchmarkReport(baseInput()),
    );
    const table = section(markdown, "Recall de assistência material");
    expect(table).toContain(
      "- Papel: diagnostic · decide release: não · gasta alpha: não",
    );
    // No verdict cell anywhere in the section: the gate table prints these two words
    // and this section must not.
    expect(table).not.toContain("passou");
    expect(table).not.toContain("reprovou");
    // Both rearm conditions appear. This is a PRESENCE check and nothing more — a
    // section that typed the two strings satisfies it, which is why the sealed values
    // are driven out of the section by the test below and not by this loop.
    for (const condition of PREREGISTRATION_V4.materialAssistance
      .rearmRequires) {
      expect(table).toContain(`- \`${condition}\``);
    }
  });

  it("prints the floor, the AI fraction and both rearm conditions off the policy it is GIVEN, not off values typed into the section", async () => {
    // The section is driven with a material-assistance block that is NOT the embedded
    // one — the same discipline `lengthBandKeyOf` is proved under. Every sealed value
    // the section prints is absent from this policy, so a section that retyped 0.5, the
    // 0.5 AI fraction or either condition name goes red on the `standIn` run and stays
    // green on the `sealed` one.
    const standIn = {
      ...PREREGISTRATION_V4.materialAssistance,
      minimumAiFraction: 0.62,
      minimumWarningRecall: 0.42,
      rearmRequires: ["condicao-de-teste-a", "condicao-de-teste-b"] as const,
    };
    const cohort = {
      generationMode: "mechanistic" as const,
      sampleSize: 100,
      warningRecall: 0.3,
      warningRecallLower95: 0.2,
    };

    const rendered = mixedRecallSection(cohort, standIn).join("\n");
    expect(rendered).toContain(
      "| mechanistic | 100 | 0.3000 | 0.2000 | 0.4200 |",
    );
    expect(rendered).toContain(">= 0.62");
    expect(rendered).toContain("- `condicao-de-teste-a`");
    expect(rendered).toContain("- `condicao-de-teste-b`");
    // And the sealed values are nowhere in the output when the sealed policy is not
    // the one handed over: that is the half a presence check cannot see.
    const sealed = PREREGISTRATION_V4.materialAssistance;
    expect(rendered).not.toContain(sealed.minimumWarningRecall.toFixed(4));
    for (const condition of sealed.rearmRequires) {
      expect(rendered).not.toContain(condition);
    }

    // The embedded policy is what `renderReportMarkdown` hands over, so the same
    // section renders the sealed numbers on the real path.
    const md = renderReportMarkdown(await buildBenchmarkReport(baseInput()));
    const table = section(md, "Recall de assistência material");
    expect(table).toContain(`>= ${sealed.minimumAiFraction}`);
    expect(table).toContain(`| ${sealed.minimumWarningRecall.toFixed(4)} |`);
    for (const condition of sealed.rearmRequires) {
      expect(table).toContain(`- \`${condition}\``);
    }
  });

  it("prints an empty cohort as an absence in BOTH statistic cells, where the row is rendered", async () => {
    // The producer returns `null` for an unmeasured recall and for its bound; this is
    // the assertion at the RENDER site, because a renderer that printed `fmt(null)`
    // would put a bare "n/a" — indistinguishable from a number that failed to
    // serialize — or, worse, a 0 that reads as a measured floor of zero.
    const base = metrics();
    const md = renderReportMarkdown(
      await buildBenchmarkReport(
        baseInput({
          metrics: {
            ...base,
            mixed: {
              ...base.mixed,
              atLeastHalfAi: {
                ...base.mixed.atLeastHalfAi,
                sampleSize: 0,
                warningRecall: Number.NaN,
                warningRecallLower95: 0,
              },
            },
          },
        }),
      ),
    );
    const table = section(md, "Recall de assistência material");
    expect(table).toContain(
      "| mechanistic | 0 | n/a (coorte vazia) | n/a (coorte vazia) |",
    );
    // The zero the producer was handed does not reach the page in either cell.
    expect(table).not.toContain("| 0.0000 |");
  });

  it("says plainly when nothing was reserved, instead of printing an empty list", async () => {
    const md = renderReportMarkdown(await buildBenchmarkReport(baseInput()));
    expect(md).toContain("Nenhuma família geradora foi reservada");
  });

  it("refuses to assemble a report whose published families diverge from the audit's", async () => {
    const input = baseInput();
    await expect(
      buildBenchmarkReport({
        ...input,
        split: {
          ...input.split,
          heldOutGeneratorFamilies: [asGeneratorFamily("gemini-3_5-flash-low")],
        },
      }),
    ).rejects.toThrow(
      /the derived generator families diverge from the published set/,
    );
  });

  it("prints the metric pair with both roles named, never a single FPR", async () => {
    const report = await buildBenchmarkReport(baseInput());
    const md = renderReportMarkdown(report);

    // Both denominators are named, in the same table, so no row can be read as
    // "the" FPR or "the" recall.
    expect(md).toContain(
      "| Grandeza | fim-a-fim | condicional a status=scored |",
    );
    expect(md).toContain("| Recall (ponto) | 0.5000 | 0.7500 |");
    expect(md).toContain("| Taxa de liberação correta | 0.5000 | 0.6667 |");
    // The undecided cells are published, so a failed inference is visible rather
    // than absorbed into a true negative.
    expect(md).toContain("| Sem decisão (negativos) | 1 | 0 |");
    // The three error-rate denominators are printed as three named lines, so no
    // reader can take the rate over the whole eligible set for the rate over the
    // population a conditional column was measured on.
    expect(md).toContain(
      "Erro de inferência (todo o conjunto elegível): 0.1250",
    );
    expect(md).toContain(
      "Erro de inferência (população das duas famílias de decisão): 0.2000",
    );
    expect(md).toContain(
      "Erro de inferência (população binária, denominador das curvas): 0.3000",
    );
  });

  it("breaks coverage and error rate out by source, class, length band and platform", async () => {
    const report = await buildBenchmarkReport(baseInput());
    const md = renderReportMarkdown(report);

    expect(md).toContain("## Cobertura e erro por fatia");
    for (const heading of [
      "### Por fonte",
      "### Por classe",
      "### Por faixa de comprimento",
      "### Por plataforma",
    ]) {
      expect(md).toContain(heading);
    }
    expect(md).toContain("| ptwiki | 4 | 3 | 0 | 1 | 0.7500 | 0.2500 |");
    expect(md).toContain("| wikipedia | 4 | 3 | 0 | 1 | 0.7500 | 0.2500 |");
  });
});

// --- A6: named roles, calibration, label bases, PPV/NPV in the markdown -----

describe("renderReportMarkdown publishes the A6 evidence with its roles named", () => {
  it("puts TPR@1%FPR beside AUROC and marks both as separability diagnostics", async () => {
    const markdown = renderReportMarkdown(
      await buildBenchmarkReport(baseInput()),
    );
    const separability = section(markdown, "Diagnóstico de separabilidade");
    expect(separability).toMatch(/AUROC/u);
    expect(separability).toMatch(/0\.9647/u);
    expect(separability).toMatch(/TPR@1%FPR/u);
    expect(separability).toMatch(/0\.4213/u);
    // The section says out loud that it decides nothing.
    expect(separability).toMatch(/não decide|nunca decide/u);
    // And the release section carries recall and FPR at the PRE-REGISTERED cut, naming
    // the source of that cut: the section was headed "limiar congelado" while the items
    // were cut on the calibrated score, which is the divergence this unit closed.
    const release = section(markdown, "Métrica de release");
    expect(release).toMatch(/corte pré-inscrito/u);
    expect(release).toMatch(/Origem do corte/u);
    expect(release).toMatch(/document-raw-score/u);
    expect(release).toMatch(/probabilisticCalibrator: "none"/u);
    expect(release).toMatch(/Recall/u);
    expect(release).toMatch(/FPR/u);
    expect(release).not.toMatch(/AUROC/u);
  });

  it("declares that the conditional family is sensitive to selective failure, in the body", async () => {
    const markdown = renderReportMarkdown(
      await buildBenchmarkReport(baseInput()),
    );
    expect(markdown).toMatch(/falha seletiva/u);
    // Every conditional block shows the error rate of the same population — in
    // the release table, in the two-family table, and in both diagnostics.
    expect(section(markdown, "Métrica de release")).toMatch(/Taxa de erro/u);
    // "Mesma população" is checked against the VALUE, not just the words: the
    // two-family table must carry the decision-population rate (0.2) and the two
    // conditional diagnostics the binary-population rate (0.3), never the 0.1250
    // of the whole eligible set.
    expect(section(markdown, "Overall")).toContain(
      "| Taxa de erro (mesma população: elegíveis positivos/negativos) | 0.2000 | 0.2000 |",
    );
    expect(section(markdown, "Diagnóstico de separabilidade")).toContain(
      "Taxa de erro da mesma população (binary-population): 0.3000",
    );
    expect(section(markdown, "Calibração")).toContain(
      "Taxa de erro da mesma população (binary-population): 0.3000",
    );
    expect(section(markdown, "Calibração")).toContain(
      "Denominadores: 7 linhas escoradas de uma população de 10",
    );
  });

  it("publishes calibration with both ECEs, the line and the reliability diagram", async () => {
    const calibration = section(
      renderReportMarkdown(await buildBenchmarkReport(baseInput())),
      "Calibração",
    );
    expect(calibration).toMatch(/equal-mass/u);
    expect(calibration).toMatch(/0\.0908/u);
    expect(calibration).toMatch(/Brier/u);
    expect(calibration).toMatch(/log-loss/u);
    expect(calibration).toMatch(/intercept/u);
    expect(calibration).toMatch(/slope/u);
    expect(calibration).toMatch(/0\.71/u);
  });

  it("never hides the count, the sampling units or the interval of one label basis", async () => {
    const markdown = renderReportMarkdown(
      await buildBenchmarkReport(baseInput()),
    );
    const bases = section(markdown, "Bases de rótulo humano");
    expect(bases).toMatch(/date-cutoff/u);
    expect(bases).toMatch(/observed-process/u);
    // Each basis brings its own count, sampling units and upper bound.
    expect(bases).toMatch(/900/u);
    expect(bases).toMatch(/640/u);
    expect(bases).toMatch(/0\.0410/u);
    expect(bases).toMatch(/12/u);
    expect(bases).toMatch(/0\.2210/u);
    // And the under-powered one is labelled supplementary, not pooled away.
    expect(bases).toMatch(/supplementary-diagnostic/u);
    expect(bases).toMatch(/não aprova gate/u);
    // The provenance of each published bound, because the plan's entry for
    // `warning.fpr.labelBasis` stands for these intervals and points here. The
    // gating basis resampled and still publishes Wilson's upper limit; the
    // under-powered one never had a competing resampled bound at all.
    expect(bases).toMatch(/Procedência do limite/u);
    const gatingRow = bases
      .split("\n")
      .find((line) => line.startsWith("| date-cutoff "));
    expect(gatingRow).toMatch(/inf reamostrado \/ sup Wilson/u);
    const supplementaryRow = bases
      .split("\n")
      .find((line) => line.startsWith("| observed-process "));
    expect(supplementaryRow).toMatch(/Wilson analítico/u);
  });

  // "Which estimator supplied the limit" only has an answer when some estimator
  // did. Three states carry no answer and the column has to say so rather than
  // fall back on Wilson: a basis whose rows all errored publishes no interval at
  // all; an alpha at which neither estimator produced a simultaneous bound
  // publishes none (the DEFAULT of the sealed pipeline, which passes no gate
  // count); and a simultaneous bound from one estimator alone has to name it
  // instead of pointing the reader at a field that may not exist.
  it("never names an estimator for a limit nobody published", async () => {
    const base = metrics();
    const labelBasis = base.labelBasis;
    if (labelBasis === undefined) throw new Error("fixture lost labelBasis");
    const markdown = renderReportMarkdown(
      await buildBenchmarkReport(
        baseInput({
          metrics: {
            ...base,
            labelBasis: {
              ...labelBasis,
              bases: [
                ...labelBasis.bases,
                {
                  // What `labelBasisBreakdown` produces when every row of a basis
                  // errored: count above zero, zero scored, so the rate has a zero
                  // denominator and `proportionEstimate` returns a bare point.
                  basis: "observed-process",
                  count: 12,
                  scored: 0,
                  errored: 12,
                  resamplingUnit: unit("warning.fpr.labelBasis", 12, 9, []),
                  powered: false,
                  powerFloor: 300,
                  evidenceRole: "supplementary-diagnostic",
                  falsePositiveRate: {
                    value: Number.NaN,
                    method: "point",
                  },
                  errorRate: { value: 1, method: "wilson-one-sided" },
                  brier: Number.NaN,
                  logLoss: Number.NaN,
                  eceEqualMass: Number.NaN,
                },
              ],
            },
            resampling: {
              ...base.resampling,
              entries: base.resampling.entries.map((entry) => {
                if (entry.estimand === "warning.recall") {
                  return {
                    ...entry,
                    executed: "percentile-bootstrap" as const,
                    publishedBound: {
                      kind: "envelope" as const,
                      rule: PREREGISTRATION_V4.resampling.publishedBound,
                      individual: {
                        lowerFrom: "resampled" as const,
                        upperFrom: "resampled" as const,
                      },
                      simultaneous: { kind: "none" as const },
                    },
                    measured: unit("warning.recall", 80, 40, []),
                  };
                }
                if (entry.estimand === "action.fpr") {
                  return {
                    ...entry,
                    executed: "percentile-bootstrap" as const,
                    publishedBound: {
                      kind: "envelope" as const,
                      rule: PREREGISTRATION_V4.resampling.publishedBound,
                      individual: {
                        lowerFrom: "resampled" as const,
                        upperFrom: "analytic" as const,
                      },
                      simultaneous: {
                        kind: "single-estimator" as const,
                        method: "wilson-one-sided",
                      },
                    },
                    measured: unit("action.fpr", 80, 40, []),
                  };
                }
                if (entry.estimand === "action.recall") {
                  return {
                    ...entry,
                    executed: "declared-only" as const,
                    publishedBound: { kind: "no-published-bound" as const },
                    measured: unit("action.recall", 0, 0, []),
                  };
                }
                return entry;
              }),
            },
          },
        }),
      ),
    );
    const bases = section(markdown, "Bases de rótulo humano");
    const erroredRow = bases
      .split("\n")
      .filter((line) => line.startsWith("| observed-process "))
      .at(-1);
    // No number, therefore no estimator: the cell may not read "Wilson analítico"
    // beside two `n/a` limits.
    expect(erroredRow).toMatch(
      /\| n\/a \| n\/a \| nenhum limite publicado \|/u,
    );
    expect(erroredRow).not.toMatch(/Wilson analítico/u);

    const units = section(markdown, "Unidades de reamostragem");
    const noSimultaneous = units
      .split("\n")
      .find((line) => line.startsWith("| warning.recall |"));
    expect(noSimultaneous).toMatch(/sem limite simultâneo publicado/u);
    expect(noSimultaneous).not.toMatch(/um estimador só/u);
    // One estimator: the report NAMES it instead of sending the reader to
    // `simultaneous.method`, which does not exist in the state above.
    expect(
      units.split("\n").find((line) => line.startsWith("| action.fpr |")),
    ).toMatch(/simultâneo: um estimador só \(wilson-one-sided\)/u);
    const nothingPublished = units
      .split("\n")
      .find((line) => line.startsWith("| action.recall |"));
    expect(nothingPublished).toMatch(/nenhum limite publicado/u);
    expect(nothingPublished).not.toMatch(/Wilson/u);
  });

  it("names the resampling unit of every published estimand, with its demotion", async () => {
    const markdown = renderReportMarkdown(
      await buildBenchmarkReport(baseInput()),
    );
    const units = section(markdown, "Unidades de reamostragem");
    // Every estimand of the frozen table is named, with its method.
    expect(units).toMatch(/warning\.fpr/u);
    expect(units).toMatch(/warning\.recall/u);
    expect(units).toMatch(/calibration\.ece/u);
    expect(units).toMatch(/mixed\.warning\.recall/u);
    expect(units).toMatch(/hierarchical/u);
    expect(units).toMatch(/multiway/u);
    // The declared unit is spelled out, nested and crossed differently. The human rows
    // nest nothing since the frame amendment — one cell means `groups.domainSource` holds
    // one value, and a level with one value is not a level — so the nesting the report
    // prints is the one the AI-recall row still has.
    expect(units).toMatch(
      /groups\.generatorFamily ⊃ groups\.promptTemplate ⊃ groups\.generationBatch/u,
    );
    // ...and the DECLARED UNIT column of a human row is the author alone. The level
    // inventory beside it still counts `groups.domainSource`, because that column reports
    // what the corpus HOLDS on every axis and not what the design drew on.
    expect(units).toMatch(
      /\| warning\.fpr \| hierarchical \| groups\.author \|/u,
    );
    expect(units).toMatch(/groups\.humanSeed × groups\.promptTemplate/u);
    // Whether the DESIGN ran, in its own column.
    expect(units).toMatch(/Desenho executado/u);
    expect(units).toMatch(/percentile-bootstrap/u);
    expect(units).toMatch(/declared-only/u);
    // And, in a column of its own, WHICH ESTIMATOR supplied the published limit.
    // The two are different facts: `warning.fpr` here ran its design and still
    // publishes Wilson's upper bound, which is what the frozen rule does to a
    // zero-count rate — and the old single column asserted the opposite.
    expect(units).toMatch(/Limite publicado/u);
    const fprRow = units
      .split("\n")
      .find((line) => line.startsWith("| warning.fpr |"));
    expect(fprRow).toBeDefined();
    expect(fprRow).toMatch(/percentile-bootstrap/u);
    expect(fprRow).toMatch(/95%: inf reamostrado \/ sup Wilson/u);
    expect(fprRow).toMatch(/simultâneo: inf reamostrado \/ sup Wilson/u);
    expect(fprRow).toMatch(/wider-of-analytic-and-resampled/u);
    // A continuous statistic has no analytic estimator competing for the slot.
    expect(
      units.split("\n").find((line) => line.startsWith("| calibration.ece |")),
    ).toMatch(/percentil reamostrado/u);
    // An entry standing for several intervals says where each one's provenance is,
    // instead of averaging two estimators into one claim.
    expect(
      units
        .split("\n")
        .find((line) => line.startsWith("| warning.fpr.labelBasis |")),
    ).toMatch(/Procedência do limite/u);
    // A row this plan does not measure claims no provenance at all.
    expect(
      units
        .split("\n")
        .find((line) => line.startsWith("| warning.fpr.slice |")),
    ).toMatch(/não declarada/u);
    // The prose no longer promises that one column makes the distinction.
    expect(units).toMatch(/`executed` diz apenas que o desenho rodou/u);
    // And the demotion `notApplicable` forced is recorded, not silent.
    expect(units).toMatch(/groups\.author→groups\.source \(3\)/u);
    // The mixed row's DEGENERACY, read off its own row rather than off the prose
    // the section always prints: three parent levels over three rows (one per
    // record-line) crossed with a factor that has exactly one level, so the crossing
    // has nothing to cross.
    const mixedRow = units
      .split("\n")
      .find((line) => line.startsWith("| mixed.warning.recall "));
    expect(mixedRow).toBeDefined();
    expect(mixedRow).toMatch(/3\/3 \(degenerada\)/u);
    expect(mixedRow).toMatch(/groups\.humanSeed=3 \(uma por linha\)/u);
    expect(mixedRow).toMatch(/groups\.promptTemplate=1/u);
    // The substitution is named, with the factor it replaces and why.
    expect(units).toMatch(
      /`groups\.promptTemplate` no lugar de "operação de edição"/u,
    );
    expect(units).toMatch(/nenhum eixo do schema v4 registra/u);
    // The section says which estimands the plan covers, and that the rest declare
    // no unit at all — the claim `MetricEstimate.method` backs per number.
    expect(units).toMatch(/não têm unidade declarada em nenhum lugar/u);
    // And it names the two coverages that are a STRETCHED row rather than a row of
    // their own, so "o plano cobre estes estimandos" cannot be read as "a linha da
    // tabela nomeia estes estimandos".
    // The COUNT in that sentence is read from the contract that owns the list, so
    // a third extension (or one fewer) cannot leave the report asserting a number
    // the file no longer says.
    const extensionCount = Object.keys(
      PREREGISTRATION_V4.resampling.estimandExtensions,
    ).length;
    expect(units).toMatch(
      new RegExp(
        `\\*\\*${extensionCount} coberturas? (é|são) extensão declarada, ` +
          "não linha própria\\.\\*\\*",
        "u",
      ),
    );
    // And the list under it has exactly that many bullets.
    expect(
      units
        .split("\n")
        .filter((line) => /^- `[^`]+` herda a linha /u.test(line)).length,
    ).toBe(extensionCount);
    expect(units).toMatch(
      /`separability\.auroc` herda a linha "calibração \(ECE, Brier\)"/u,
    );
    expect(units).toMatch(/`separability\.prAuc` herda a linha/u);
    expect(units).toMatch(/separability\.gates = false/u);
    // A row this plan does not measure says WHERE it is measured.
    const sliceRow = units
      .split("\n")
      .find((line) => line.startsWith("| warning.fpr.slice "));
    expect(sliceRow).toMatch(/não medida — medida no plano da própria fatia/u);
  });

  it("publishes PPV and NPV beside the benchmark's own prevalence", async () => {
    const values = section(
      renderReportMarkdown(await buildBenchmarkReport(baseInput())),
      "PPV e NPV",
    );
    expect(values).toMatch(/PPV/u);
    expect(values).toMatch(/NPV/u);
    expect(values).toMatch(/0\.9949/u);
    // The ~50/50 prior is declared next to the projection, not left implicit.
    expect(values).toMatch(/prevalência do benchmark/u);
    expect(values).toMatch(/0\.5000|0\.5/u);
  });

  it("marks the 95% intervals as descriptive and names the Bonferroni divisor", async () => {
    const markdown = renderReportMarkdown(
      await buildBenchmarkReport(baseInput()),
    );
    const multiplicity = section(markdown, "Multiplicidade");
    expect(multiplicity).toMatch(/bonferroni/iu);
    expect(multiplicity).toMatch(/0\.05/u);
    expect(multiplicity).toMatch(/descritiv/u);
    // The gate table says which bound decided each gate.
    expect(section(markdown, "Gates")).toMatch(/simultaneous-upper/u);
  });

  it("says how much resampling produced the simultaneous bound it decides on", async () => {
    // A percentile read at alpha_família/m is an interpolation between a couple of
    // order statistics; a reader cannot judge the bound without the replicate count
    // and the size of the tail it came from (R7).
    const multiplicity = section(
      renderReportMarkdown(await buildBenchmarkReport(baseInput())),
      "Multiplicidade",
    );
    expect(multiplicity).toContain(
      "Esforço de reamostragem do limite simultâneo (ECE): 2000 réplicas em alpha=0.00125, cauda de 2 réplicas.",
    );
  });

  // The document an operator reads before an irreversible button. Two facts about the
  // gate report used to be invisible in it: which of the published gates decides a
  // pre-registered hypothesis, and WHY the inventory does not cover the family.
  it("says which gates certify, and names the hypotheses behind a covers: não", async () => {
    const family = PREREGISTRATION_V4.multiplicity.primaryFamily;
    const markdown = renderReportMarkdown(
      await buildBenchmarkReport(
        baseInput({
          gates: gateReport({
            gates: [
              {
                ...gateReport().gates[0],
                id: "warning.calibration-ece",
                role: "certifying",
                hypothesis: "calibration-global",
                passed: false,
                reasons: ["equal-mass ECE-15: refused"],
              },
            ],
            failedWarning: ["warning.calibration-ece"],
            failedCertifying: ["warning.calibration-ece"],
            multiplicity: {
              ...gateReport().multiplicity,
              covers: false,
              observed: family.length - 1,
              hypotheses: family.filter((member) => member !== "fpr-ptwiki"),
              missingHypotheses: ["fpr-ptwiki"],
              unexpectedHypotheses: ["fpr-b2w-reviews"],
            },
          }),
        }),
      ),
    );
    const gates = section(markdown, "Gates");
    expect(gates).toMatch(/\| Papel \| Hipótese \|/u);
    expect(gates).toMatch(/\| certifying \| calibration-global \|/u);
    // The role travels with the reason too, where a single line used to say only the
    // tier beside a decision the tier no longer explains alone.
    expect(section(markdown, "Razões dos gates")).toContain(
      "[warning] [certifying: calibration-global] warning.calibration-ece",
    );
    const multiplicity = section(markdown, "Multiplicidade");
    expect(multiplicity).toContain("cobre: não");
    expect(multiplicity).toMatch(
      /nenhum gate deste relatório decidiu: `fpr-ptwiki`/u,
    );
    expect(multiplicity).toMatch(
      /fora da família pré-registrada: `fpr-b2w-reviews`/u,
    );
    // And the label of the count says what it counts: hypotheses, integrity included.
    expect(multiplicity).toMatch(
      /hipóteses obrigatórias decididas neste relatório: 3/u,
    );
  });
});

// --- A7: the release section says where the certified FPR bound comes from ---

describe("renderReportMarkdown separates the certified FPR bound from the fit's", () => {
  it("attributes certification to the blind test and names the fit's bound nominal", async () => {
    const release = section(
      renderReportMarkdown(await buildBenchmarkReport(baseInput())),
      "Métrica de release",
    );
    // The reader arrives here from the frozen artifact, where a number sits at
    // the edge of the 5% budget. The report has to say that THIS table is the
    // certification and that the fit's own bound never was one (R7, §4.8).
    expect(release).toMatch(/selectionFprUpper95Nominal/u);
    expect(release).toMatch(/teste cego/u);
    expect(release).toMatch(/nominal/u);
    expect(release).toMatch(/não certifica|não é garantia|não é uma garantia/u);
  });

  it("names the simultaneous cell as the certified one and the UCB95 column as descriptive", async () => {
    // The paragraph alone, not the section: the section also contains the table
    // header, where BOTH column names appear by construction, so matching them
    // there would prove nothing about what the prose points at.
    const paragraph = certifiedBoundParagraph(
      renderReportMarkdown(await buildBenchmarkReport(baseInput())),
    );
    // `frozenThresholdTable` emits two upper bounds per row and only one of them
    // is a gate: `evaluateReleaseGates` reads `estimate.simultaneous` and fails
    // with `missing-simultaneous-interval` rather than falling back. So the word
    // "certificado" has to land on that cell by name, or an auditor quotes the
    // individual bound — the very nominal-read-as-guarantee mistake A7 removed
    // from the fit artifact (R7).
    expect(paragraph).toMatch(/`FPR \(limite simultâneo\)`/u);
    expect(paragraph).toMatch(/Bonferroni|alpha_família/u);
    // And the descriptive column is named too, as certifying nothing.
    expect(paragraph).toMatch(
      /`FPR \(UCB95 descritivo\)`[\s\S]*?não certifica/u,
    );
  });

  it("points only at column names the frozen threshold table actually renders", async () => {
    // The paragraph's whole job is to send an auditor to ONE cell. Naming the
    // cell in prose is worthless if the header can be renamed without the prose
    // following: the published `benchmark-report.md` would then point at a column
    // that does not exist, leaving `FPR (UCB95 descritivo)` — the column the
    // paragraph says certifies nothing — as the only recognizable upper bound.
    // Measured: renaming the header cell to `FPR (limite conjunto)` left the
    // whole suite green before this test existed. So the coupling is asserted
    // here structurally, over whatever names the two sides use, and not against
    // a literal that a rename would take with it.
    const markdown = renderReportMarkdown(
      await buildBenchmarkReport(baseInput()),
    );
    const release = section(markdown, "Métrica de release");
    const header = release
      .split("\n")
      .find((line) => line.startsWith("| Papel |"));
    expect(header).toBeDefined();
    const quotedColumns = [
      ...certifiedBoundParagraph(markdown).matchAll(/`(FPR \([^`]+\))`/gu),
    ].map((match) => match[1]);
    // Both bounds, or the paragraph is not doing the disambiguation at all.
    expect(quotedColumns.length).toBeGreaterThanOrEqual(2);
    for (const column of quotedColumns) {
      expect(header as string).toContain(`| ${column} |`);
    }
  });

  it("does not promise that the artifact's certifiedFprUpper is ever filled in", async () => {
    const paragraph = certifiedBoundParagraph(
      renderReportMarkdown(await buildBenchmarkReport(baseInput())),
    );
    // The report is generated BY the blind-test consumption, so the measurement
    // already exists above this sentence while the sealed artifact still reads
    // `certifiedFprUpper: null` — permanently, since the field's type is the
    // literal `null` and `artifactDigest` seals the bytes. "Nulo até que a
    // medição exista" would send a reader hunting for a post-H1 artifact that
    // cannot exist.
    expect(paragraph).not.toMatch(/até que (esta|essa) medição exista/u);
    expect(paragraph).toMatch(/selado|imutável|por construção/u);
  });
});

/** The one paragraph of the release section that speaks about the bound. */
function certifiedBoundParagraph(markdown: string): string {
  const line = section(markdown, "Métrica de release")
    .split("\n")
    .find((candidate) => candidate.startsWith("O limite de FPR"));
  expect(line).toBeDefined();
  return line as string;
}
