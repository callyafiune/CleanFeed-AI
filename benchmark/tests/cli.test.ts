import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import type { SerializedCalibratorV1 } from "../../contracts/calibration-profile.ts";
import { parseCliArgs, runCli } from "../cli.ts";
import type { FrozenCalibrationArtifact } from "../calibration-pipeline.ts";
import type { DatasetManifest } from "../dataset-manifest.ts";
import { computeDatasetDigest, sha256BytesHex } from "../digests.ts";
import {
  beginHoldoutConsumption,
  resumeHoldoutConsumption,
  type HoldoutIdentity,
} from "../holdout-ledger.ts";
import type { PredictionManifestV1 } from "../prediction-schema.ts";
import type { BenchmarkRecord } from "../schema.ts";
import { buildSplitArtifact } from "../split-artifact.ts";
import type { SplitAudit } from "../split-audit.ts";
import type { DatasetSplit } from "../split.ts";

// ---------------------------------------------------------------------------
// Parsing and dispatch guards (no I/O required).
// ---------------------------------------------------------------------------

describe("benchmark CLI parsing and dispatch", () => {
  it("requires a named subcommand", () => {
    expect(() => parseCliArgs([])).toThrow(
      /expected one of ingest, validate, split, validate-predictions, fit, evaluate, publish-profile, verify-evidence/u,
    );
  });

  it("rejects an unknown subcommand", () => {
    expect(() => parseCliArgs(["score"])).toThrow(
      /expected one of ingest, validate, split, validate-predictions, fit, evaluate, publish-profile, verify-evidence/u,
    );
  });

  it("parses a known subcommand and its flags", () => {
    const parsed = parseCliArgs([
      "validate",
      "--dataset-dir",
      "d",
      "--output",
      "o",
    ]);
    expect(parsed.command).toBe("validate");
    expect(parsed.flags.get("dataset-dir")).toBe("d");
  });

  it("rejects an unknown flag on a known subcommand", async () => {
    await expect(
      runCli([
        "validate",
        "--dataset-dir",
        "d",
        "--output",
        "o",
        "--bogus",
        "x",
      ]),
    ).rejects.toThrow(/unknown flag --bogus/u);
  });

  it("requires validate's mandatory flags", async () => {
    await expect(runCli(["validate", "--dataset-dir", "d"])).rejects.toThrow(
      /--output/u,
    );
  });

  it("prints usage for --help without dispatching a command", async () => {
    await expect(runCli(["--help"])).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Partition guards: fit never touches test; validate-predictions ledger rules.
// ---------------------------------------------------------------------------

describe("benchmark CLI partition and ledger flag guards", () => {
  const FIT_ARGS = [
    "--dataset-dir",
    "d",
    "--dataset-audit",
    "a.json",
    "--source-readiness",
    "s.json",
    "--split-artifact",
    "split.json",
    "--runtime-parity",
    "rp.json",
    "--development-predictions",
    "dev",
    "--calibration-predictions",
    "cal",
    "--output",
    "out",
    "--seed",
    "712019",
  ];

  it("prevents fit from receiving test labels", async () => {
    await expect(
      runCli(["fit", ...FIT_ARGS, "--partition", "test"]),
    ).rejects.toThrow(/fit accepts only development and calibration/u);
  });

  it("forbids a ledger/consumption id on a development prediction validation", async () => {
    await expect(
      runCli([
        "validate-predictions",
        "--dataset-dir",
        "d",
        "--split-artifact",
        "split.json",
        "--partition",
        "development",
        "--predictions",
        "dev",
        "--runtime-parity",
        "rp.json",
        "--ledger",
        "ledger.jsonl",
      ]),
    ).rejects.toThrow(/ledger.*only.*test|test.*ledger/iu);
  });

  it("requires ledger and consumption id when validating test predictions", async () => {
    await expect(
      runCli([
        "validate-predictions",
        "--dataset-dir",
        "d",
        "--split-artifact",
        "split.json",
        "--partition",
        "test",
        "--predictions",
        "test",
        "--runtime-parity",
        "rp.json",
      ]),
    ).rejects.toThrow(/--ledger|--consumption-id/u);
  });
});

// ---------------------------------------------------------------------------
// Full holdout consumption flow driven through the evaluate subcommand.
//
// A compact but end-to-end valid scenario: a tiny sealed-shaped dataset, a
// frozen split artifact and calibration, a test prediction manifest+shard and
// the private test labels. The scenario is deliberately small so the run stays
// in milliseconds while still exercising the real evaluate pipeline and the
// ledger's one-way lease.
// ---------------------------------------------------------------------------

function hex(label: string): string {
  let out = "";
  for (const ch of label) out += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return out.padEnd(64, "0").slice(0, 64);
}

const MODEL_ID = "tmr-ai-text-detector";
const MODEL_VERSION = "1.0.0";
const BUNDLE = hex("bundle");
const TOKENIZER = hex("tokenizer");
const PARITY = hex("runtime-parity");
const BUILD = hex("extension-build");
const AGGREGATION = "tmr-aggregation-v2";
const COMPOSITION = "lexical-content-v1";
const DATASET_AUDIT = hex("dataset-audit");
const SOURCE_READINESS = hex("source-readiness");
const EVALUATOR = hex("evaluator");
const SESSION_TIME = "2026-07-19T00:00:00.000Z";

let recordCounter = 0;
function record(
  label: BenchmarkRecord["label"],
  createdAt: number,
): BenchmarkRecord {
  recordCounter += 1;
  const id = `r${recordCounter}`;
  const base: BenchmarkRecord = {
    schemaVersion: 2,
    id,
    text: `Texto de exemplo suficientemente longo para o registro ${id}.`,
    normalizedTextSha256: hex(`content-${id}`),
    label,
    language: "pt-BR",
    platform: "linkedin",
    domain: "corporate",
    topic: "geral",
    wordCount: 60,
    createdAt,
    provenance: {
      sourceKind: "authorized-contribution",
      sourceId: `src_${id}`,
      sourceRevision: "rev_001",
      collectedAt: createdAt,
      licenseId: "consent-v1",
      legalBasis: "consent",
      consentId: `consent_${id}`,
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "reviewer_01",
        reviewedAt: createdAt,
      },
    },
    annotation: {
      protocolVersion: "annotation-v1",
      reviewerIds: ["reviewer_01", "reviewer_02"],
      agreement: "agree",
    },
    transformation: { kind: "none", severity: "none" },
    groups: {
      author: `author_${id}`,
      source: `src_${id}`,
      domainSource: "linkedin_batch_01",
      collectionBatch: "batch_001",
      nearDuplicate: `nd_${id}`,
      derivationRoot: id,
    },
  };
  if (label === "ai") {
    base.generation = {
      provider: "acme",
      family: "acme_family",
      model: "acme-1",
      version: "v1",
      promptId: `prompt_${id}`,
      promptSha256: hex(`prompt-${id}`),
      generatedAt: createdAt,
    };
  }
  if (label === "mixed") {
    base.mixture = {
      aiFraction: 0.6,
      humanFraction: 0.4,
      spans: [{ start: 0, end: 10, origin: "ai" }],
    };
    base.groups.derivationRoot = `parent_${id}`;
  }
  return base;
}

function datasetManifest(): DatasetManifest {
  return {
    schemaVersion: 1,
    datasetId: "ptbr-linkedin-v1",
    version: "1.0.0",
    scientificUse: "infrastructure-only",
    intendedLanguage: "pt-BR",
    intendedDomain: "linkedin",
    createdAt: "2026-07-19T00:00:00.000Z",
    normalizationVersion: "cleanfeed-text-v1",
    annotationProtocolVersion: "annotation-v1",
    recordsFile: "records.jsonl",
    recordsSha256: hex("records"),
    reviewLedgerFile: "private/review-ledger.jsonl",
    reviewLedgerSha256: hex("review-ledger"),
    sourceManifestFile: "private/source-manifest.json",
    sourceManifestSha256: hex("source-manifest"),
    heldOutGeneratorFamilies: ["heldout_family"],
    licenses: [
      {
        id: "consent-v1",
        name: "Authorized contribution",
        source: "fixture://consent",
        evaluationUseApproved: true,
        redistribution: "not-published",
        notice: "Contributed under explicit consent.",
      },
    ],
  };
}

function passingAudit(split: DatasetSplit<BenchmarkRecord>): SplitAudit {
  return {
    sizes: {
      development: split.development.length,
      calibration: split.calibration.length,
      test: split.test.length,
    },
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

const PLATT: SerializedCalibratorV1 = {
  kind: "platt",
  slope: 2,
  intercept: -1,
};

function predictionManifest(
  partition: PredictionManifestV1["partition"],
  datasetDigest: string,
  splitDigest: string,
  holdoutConsumptionId: string | null,
  shards: PredictionManifestV1["shards"],
): PredictionManifestV1 {
  return {
    schemaVersion: 1,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: BUNDLE,
    aggregationVersion: AGGREGATION,
    contentCompositionVersion: COMPOSITION,
    tokenizerDigest: TOKENIZER,
    runtimeParityDigest: PARITY,
    extensionBuildDigest: BUILD,
    backend: "wasm",
    chromeVersion: "150.0.7871.129",
    datasetDigest,
    splitDigest,
    partition,
    shardSize: 100,
    shardCount: shards.length,
    shards,
    holdoutConsumptionId,
    createdAt: "2026-07-19T00:00:00.000Z",
  };
}

async function frozenCalibration(
  datasetDigest: string,
  splitDigest: string,
  developmentDigest: string,
  calibrationDigest: string,
): Promise<FrozenCalibrationArtifact> {
  const base: Omit<FrozenCalibrationArtifact, "artifactDigest"> = {
    schemaVersion: 1,
    model: {
      modelId: MODEL_ID,
      modelVersion: MODEL_VERSION,
      bundleDigest: BUNDLE,
      tokenizerDigest: TOKENIZER,
      aggregationVersion: AGGREGATION,
      contentCompositionVersion: COMPOSITION,
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
    datasetAuditDigest: DATASET_AUDIT,
    sourceReadinessDigest: SOURCE_READINESS,
    splitDigest,
    evaluatorDigest: EVALUATOR,
    partitionsUsed: ["development", "calibration"],
    calibrators: { document: PLATT, localized: PLATT },
    selectionEvidence: { document: [], localized: [] },
    thresholds: {
      warningDocument: 0.5,
      warningLocalized: 0.5,
      visualDocument: 0.8,
    },
    thresholdEvidence: {
      warning: {
        documentThreshold: 0.5,
        localizedThreshold: 0.5,
        negatives: 2,
        falsePositives: 0,
        fprUpper95: 0.01,
        positives: 2,
        truePositives: 2,
        recall: 1,
      },
      visual: {
        documentThreshold: 0.8,
        localizedThreshold: null,
        negatives: 2,
        falsePositives: 0,
        fprUpper95: 0.01,
        positives: 2,
        truePositives: 1,
        recall: 0.5,
      },
    },
    fitSeed: 712019,
  };
  return { ...base, artifactDigest: await canonicalSha256(base) };
}

interface Scenario {
  datasetDir: string;
  splitArtifactPath: string;
  frozenCalibrationPath: string;
  testPredictionsDir: string;
  testLabelsPath: string;
  ledgerPath: string;
  outputDir: string;
  activeSessionPath: string;
  identity: HoldoutIdentity;
}

async function buildScenario(root: string): Promise<Scenario> {
  recordCounter = 0;
  const records: BenchmarkRecord[] = [
    record("human", 10),
    record("ai", 20),
    record("human", 110),
    record("mixed", 120),
    record("human", 310),
    record("human", 320),
    record("ai", 330),
    record("mixed", 340),
  ];
  const manifest = datasetManifest();
  const datasetDir = join(root, "dataset");
  await mkdir(join(datasetDir, "private"), { recursive: true });
  await writeFile(
    join(datasetDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(datasetDir, "records.jsonl"),
    `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );

  const split: DatasetSplit<BenchmarkRecord> = {
    development: [records[0], records[1]],
    calibration: [records[2], records[3]],
    test: [records[4], records[5], records[6], records[7]],
  };
  const policy = {
    fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
    classTolerance: 0.02,
    heldOutGeneratorFamilies: ["heldout_family"],
    seed: 712019,
  } as const;
  const artifact = await buildSplitArtifact({
    manifest,
    records,
    split,
    policy,
    audit: passingAudit(split),
  });
  const splitArtifactPath = join(root, "split-artifact.json");
  await writeFile(splitArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  const datasetDigest = await computeDatasetDigest(manifest, records);
  const splitDigest = artifact.splitDigest;

  // Fit output directory: frozen calibration plus the two prediction manifests
  // it consumed, which evaluate re-reads for the report.
  const fitDir = join(root, "fit");
  await mkdir(fitDir, { recursive: true });
  const devManifest = predictionManifest(
    "development",
    datasetDigest,
    splitDigest,
    null,
    [],
  );
  const calManifest = predictionManifest(
    "calibration",
    datasetDigest,
    splitDigest,
    null,
    [],
  );
  const { computePredictionManifestDigest } =
    await import("../prediction-schema.ts");
  const devDigest = await computePredictionManifestDigest(devManifest);
  const calDigest = await computePredictionManifestDigest(calManifest);
  await writeFile(
    join(fitDir, "development-prediction-manifest.json"),
    `${JSON.stringify(devManifest, null, 2)}\n`,
  );
  await writeFile(
    join(fitDir, "calibration-prediction-manifest.json"),
    `${JSON.stringify(calManifest, null, 2)}\n`,
  );
  const frozen = await frozenCalibration(
    datasetDigest,
    splitDigest,
    devDigest,
    calDigest,
  );
  const frozenCalibrationPath = join(fitDir, "frozen-calibration.json");
  await writeFile(
    frozenCalibrationPath,
    `${JSON.stringify(frozen, null, 2)}\n`,
  );

  // Private test labels for the four test records.
  const testRecords = split.test;
  const testLabelsPath = join(datasetDir, "private", "test-labels.jsonl");
  await writeFile(
    testLabelsPath,
    `${testRecords
      .map((r) => JSON.stringify({ id: r.id, label: r.label }))
      .join("\n")}\n`,
  );

  const identity: HoldoutIdentity = {
    datasetDigest,
    datasetAuditDigest: DATASET_AUDIT,
    sourceReadinessDigest: SOURCE_READINESS,
    splitDigest,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: BUNDLE,
    aggregationVersion: AGGREGATION,
    contentCompositionVersion: COMPOSITION,
    tokenizerDigest: TOKENIZER,
    runtimeParityDigest: PARITY,
    extensionBuildDigest: BUILD,
    backend: "wasm",
    chromeVersion: "150.0.7871.129",
    evaluatorDigest: EVALUATOR,
    calibrationArtifactDigest: frozen.artifactDigest,
  };

  const holdoutDir = join(root, "work", "holdout");
  await mkdir(holdoutDir, { recursive: true });

  return {
    datasetDir,
    splitArtifactPath,
    frozenCalibrationPath,
    // filled in after the session id is known
    testPredictionsDir: "",
    testLabelsPath,
    ledgerPath: join(datasetDir, "private", "holdout-ledger.jsonl"),
    outputDir: join(root, "out"),
    activeSessionPath: join(holdoutDir, "active-session.json"),
    identity,
  };
}

async function writeTestPredictions(
  root: string,
  scenario: Scenario,
  consumptionId: string,
): Promise<string> {
  const datasetDigest = scenario.identity.datasetDigest;
  const splitDigest = scenario.identity.splitDigest;
  const dir = join(root, "work", "holdout", consumptionId, "predictions");
  await mkdir(dir, { recursive: true });
  const rows = ["r5", "r6", "r7", "r8"].map((id, index) =>
    JSON.stringify({
      schemaVersion: 2,
      id,
      status: "scored",
      documentRawScore: 0.4 + index * 0.1,
      localizedRawScore: 0.3 + index * 0.1,
      evidenceQuality: "sufficient",
      reasonCode: "SCORED",
      coverage: 1,
      latencyMs: 40,
      memoryBytes: 1000,
    }),
  );
  const shardBody = `${rows.join("\n")}\n`;
  await writeFile(join(dir, "shard-000.jsonl"), shardBody);
  const shardSha = sha256BytesHex(new TextEncoder().encode(shardBody));
  const manifest = predictionManifest(
    "test",
    datasetDigest,
    splitDigest,
    consumptionId,
    [{ index: 0, file: "shard-000.jsonl", sha256: shardSha, recordCount: 4 }],
  );
  await writeFile(
    join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return dir;
}

describe("benchmark CLI holdout consumption via evaluate", () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(
      created.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    created.length = 0;
  });

  it("requires an active consumption session and rejects a repeated tuple", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-bench-cli-eval-"));
    created.push(root);
    const scenario = await buildScenario(root);

    const evaluateArgs = (predictionsDir: string): string[] => [
      "evaluate",
      "--dataset-dir",
      scenario.datasetDir,
      "--split-artifact",
      scenario.splitArtifactPath,
      "--frozen-calibration",
      scenario.frozenCalibrationPath,
      "--test-predictions",
      predictionsDir,
      "--test-labels",
      scenario.testLabelsPath,
      "--ledger",
      scenario.ledgerPath,
      "--output",
      scenario.outputDir,
      "--bootstrap-seed",
      "712019",
    ];

    // Missing --consumption-id is rejected at flag validation.
    await expect(
      runCli(evaluateArgs(join(root, "placeholder"))),
    ).rejects.toThrow(/--consumption-id/u);

    // Open the atomic session and prove resume reopens the SAME started lease.
    const session = await beginHoldoutConsumption(
      scenario.ledgerPath,
      scenario.identity,
      SESSION_TIME,
      { activeSessionPath: scenario.activeSessionPath },
    );
    await expect(
      resumeHoldoutConsumption(
        scenario.ledgerPath,
        session.consumptionId,
        scenario.identity,
      ),
    ).resolves.toMatchObject({
      consumptionId: session.consumptionId,
      status: "started",
    });

    const predictionsDir = await writeTestPredictions(
      root,
      scenario,
      session.consumptionId,
    );

    await runCli([
      ...evaluateArgs(predictionsDir),
      "--consumption-id",
      session.consumptionId,
    ]);

    // The report was written and the session was consumed.
    const report = JSON.parse(
      await readFile(join(scenario.outputDir, "benchmark-report.json"), "utf8"),
    );
    expect(report.reportDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.holdoutConsumptionId).toBe(session.consumptionId);
    await expect(stat(scenario.activeSessionPath)).rejects.toThrow();

    // The tuple is consumed once; neither begin nor resume reopens it.
    await expect(
      beginHoldoutConsumption(
        scenario.ledgerPath,
        scenario.identity,
        SESSION_TIME,
        { activeSessionPath: scenario.activeSessionPath },
      ),
    ).rejects.toThrow(/holdout tuple was already consumed/u);
    await expect(
      resumeHoldoutConsumption(
        scenario.ledgerPath,
        session.consumptionId,
        scenario.identity,
      ),
    ).rejects.toThrow(/holdout session is terminal/u);
  });
});
