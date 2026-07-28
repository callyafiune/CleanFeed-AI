import { describe, expect, it } from "vitest";

import type { GateReport } from "../gates.ts";
import type { EvaluationMetrics } from "../metrics.ts";
import {
  computePredictionManifestDigest,
  type PredictionManifestV1,
} from "../prediction-schema.ts";
import {
  buildBenchmarkReport,
  renderReportMarkdown,
  ReportGovernanceError,
  type BenchmarkReportInput,
  type GovernanceSeal,
} from "../report.ts";
import type { SliceSummary } from "../slices.ts";
import {
  standInClusterReport,
  type SplitAudit,
} from "../split-audit.ts";
import { asGeneratorFamily } from "../generator-family.ts";

// --- fixture builders ------------------------------------------------------

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
const CALIBRATION = hex("calibration");

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
    clusters: standInClusterReport(),
    declaredAxisGaps: [],
    criticalSliceSamples: [],
    heldOutGeneratorFamilies: [],
    passed: true,
    reasons: [],
  };
}

function gateReport(overrides: Partial<GateReport> = {}): GateReport {
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
    decision: "pass",
    gates: [
      {
        id: "warning.fpr.overall",
        tier: "warning",
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
      thresholdSource: "frozen-calibration-threshold",
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
        method: "author-cluster-percentile",
      },
      prAuc: { value: 0.9788, method: "author-cluster-percentile" },
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
      brier: { value: 0.0812, method: "author-cluster-percentile" },
      logLoss: 0.2731,
      intercept: -0.12,
      slope: 0.71,
      bins: 15,
      eceEqualMass15: {
        value: 0.0819,
        lower95: 0.0731,
        upper95: 0.0908,
        method: "author-cluster-percentile",
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
          method: "author-cluster-percentile",
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
          samplingUnits: 3,
          samplingUnitAxis: "groups.author",
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
          samplingUnits: 640,
          samplingUnitAxis: "groups.author",
          powered: true,
          powerFloor: 300,
          evidenceRole: "gating",
          falsePositiveRate: {
            value: 0.03,
            upper95: 0.041,
            method: "wilson-one-sided",
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
          samplingUnits: 9,
          samplingUnitAxis: "groups.author",
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
    multiplicity: {
      correction: "bonferroni",
      familyAlpha: 0.05,
      descriptiveConfidence: 0.95,
      m: 8,
      perGateAlpha: 0.00625,
      z: 2.4977,
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

interface InputOverrides {
  frozen?: GovernanceSeal;
  observed?: GovernanceSeal;
  gates?: GateReport;
  testShard?: string;
  metrics?: EvaluationMetrics;
}

function baseInput(overrides: InputOverrides = {}): BenchmarkReportInput {
  return {
    generatedAt: "2026-07-19T12:00:00.000Z",
    dataset: { id: "ptbr-generic", version: "v1", digest: DATASET_DIGEST },
    split: {
      digest: SPLIT_DIGEST,
      strategy: "blocked-group-time-v1",
      heldOutGeneratorFamilies: [],
      audit: splitAudit(),
    },
    evaluatorDigest: EVALUATOR,
    calibrationArtifactDigest: CALIBRATION,
    frozen: overrides.frozen ?? seal(),
    observed: overrides.observed ?? seal(),
    predictionManifests: {
      development: manifest("development", null, "dev-shard"),
      calibration: manifest("calibration", null, "cal-shard"),
      test: manifest("test", SESSION, overrides.testShard ?? "test-shard"),
    },
    metrics: overrides.metrics ?? metrics(),
    slices: slices(),
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
      await computePredictionManifestDigest(
        manifest("development", null, "dev-shard"),
      ),
    );
    expect(report.predictionManifestDigests.calibration).toBe(
      await computePredictionManifestDigest(
        manifest("calibration", null, "cal-shard"),
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
          failedWarning: ["warning.fpr.overall"],
          gates: [
            {
              id: "warning.fpr.overall",
              tier: "warning",
              scope: "overall",
              estimand: "warning.fpr",
              evidence: "present",
              observed: 0.08,
              bound: "simultaneous-upper",
              operator: "<=",
              required: 0.05,
              sampleSize: 2_000,
              eligible: true,
              passed: false,
              reasons: ["overall warning FPR upper95 0.08 exceeds 0.05"],
            },
          ],
        }),
      }),
    );
    expect(rejected.reportDigest).not.toBe(base.reportDigest);
    expect(rejected.releaseDecision).toBe("reject");
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
      "- Derivadas pela auditoria do split: `gemini-3_5-flash-low`, `gemini-3_6-flash`",
    );
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
    // And the release section carries recall and FPR at the frozen threshold.
    const release = section(markdown, "Métrica de release");
    expect(release).toMatch(/limiar congelado/u);
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
