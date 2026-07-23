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
import type { SplitAudit } from "../split-audit.ts";

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
    criticalSliceSamples: [],
    heldOutGeneratorFamilies: [],
    passed: true,
    reasons: [],
  };
}

function gateReport(overrides: Partial<GateReport> = {}): GateReport {
  return {
    schemaVersion: 1,
    decision: "pass",
    gates: [
      {
        id: "warning.fpr.overall",
        tier: "warning",
        scope: "overall",
        observed: 0.01,
        bound: "upper95",
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
    warning: { recall: { value: 0.75, method: "point" } },
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
    dataset: { id: "ptbr-linkedin", version: "v1", digest: DATASET_DIGEST },
    split: {
      digest: SPLIT_DIGEST,
      strategy: "blocked-group-time-v1",
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
              observed: 0.08,
              bound: "upper95",
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
});
