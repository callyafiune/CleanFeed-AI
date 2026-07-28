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
import {
  computeRuntimeParityDigest,
  type RuntimeParityManifestV1,
} from "../../contracts/runtime-parity.ts";
import {
  computeSourceReadinessDigest,
  type CorpusSourceReadinessReport,
} from "../../contracts/source-readiness.ts";
import { parseCliArgs, runCli } from "../cli.ts";
import {
  selectionThresholdEvidence,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import { runFit, type FitOptions } from "../commands/fit.ts";
import {
  emptyLabelBasisPublication,
  computeDatasetAuditDigest,
  type DatasetAudit,
  type DatasetManifest,
} from "../dataset-manifest.ts";
import { computeDatasetDigest, sha256BytesHex } from "../digests.ts";
import {
  beginHoldoutConsumption,
  resumeHoldoutConsumption,
  type HoldoutIdentity,
} from "../holdout-ledger.ts";
import {
  RELEASE_CHROME_VERSION,
  type PredictionManifestV1,
} from "../prediction-schema.ts";
import type { BenchmarkRecord } from "../schema.ts";
import { buildSplitArtifact } from "../split-artifact.ts";
import type { SplitAudit } from "../split-audit.ts";
import type { DatasetSplit } from "../split.ts";
import {
  asGeneratorFamily,
  generatorFamilyOf,
  normalizeGeneratorFamily,
  type GeneratorFamily,
} from "../generator-family.ts";

// ---------------------------------------------------------------------------
// Parsing and dispatch guards (no I/O required).
// ---------------------------------------------------------------------------

describe("benchmark CLI parsing and dispatch", () => {
  it("requires a named subcommand", () => {
    expect(() => parseCliArgs([])).toThrow(
      /expected one of ingest, validate, split, validate-predictions, score, fit, evaluate, consume-holdout, publish-profile, verify-evidence/u,
    );
  });

  it("rejects an unknown subcommand", () => {
    expect(() => parseCliArgs(["frobnicate"])).toThrow(
      /expected one of ingest, validate, split, validate-predictions, score, fit, evaluate, consume-holdout, publish-profile, verify-evidence/u,
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
// score guards: the candidate-only scorer never touches the holdout and never
// runs the production dist.
// ---------------------------------------------------------------------------

describe("benchmark CLI score guards", () => {
  const SCORE_ARGS = [
    "--dataset-dir",
    "benchmark/data/ptbr-generic-v1",
    "--split-artifact",
    "split.json",
    "--candidate-extension-dir",
    "dist-model-benchmark",
    "--output",
    "out/predictions/development",
  ];

  it("parses the score subcommand and its flags", () => {
    const parsed = parseCliArgs([
      "score",
      ...SCORE_ARGS,
      "--partition",
      "development",
    ]);
    expect(parsed.command).toBe("score");
    expect(parsed.flags.get("candidate-extension-dir")).toBe(
      "dist-model-benchmark",
    );
  });

  it("rejects the test partition with HOLDOUT_REQUIRES_CONSUME_COMMAND", async () => {
    await expect(
      runCli(["score", ...SCORE_ARGS, "--partition", "test"]),
    ).rejects.toThrow(/HOLDOUT_REQUIRES_CONSUME_COMMAND/u);
  });

  it("rejects the production dist directory", async () => {
    await expect(
      runCli([
        "score",
        "--dataset-dir",
        "benchmark/data/ptbr-generic-v1",
        "--split-artifact",
        "split.json",
        "--candidate-extension-dir",
        "dist",
        "--output",
        "out/predictions/development",
        "--partition",
        "development",
      ]),
    ).rejects.toThrow(/production|dist/iu);
  });

  it("rejects an unknown flag on score", async () => {
    await expect(
      runCli([
        "score",
        ...SCORE_ARGS,
        "--partition",
        "development",
        "--bogus",
        "x",
      ]),
    ).rejects.toThrow(/unknown flag --bogus/u);
  });
});

describe("benchmark CLI consume-holdout parsing", () => {
  const CONSUME_ARGS = [
    "consume-holdout",
    "--dataset-dir",
    "benchmark/data/ptbr-generic-v1",
    "--split-artifact",
    "benchmark/out/ptbr-v1/split/split-artifact.json",
    "--frozen-calibration",
    "benchmark/out/ptbr-v1/fit/frozen-calibration.json",
    "--ledger",
    "benchmark/data/ptbr-generic-v1/private/holdout-ledger.jsonl",
    "--candidate-extension-dir",
    "dist-model-benchmark",
    "--work-dir",
    "benchmark/work/holdout",
    "--output",
    "benchmark/out/ptbr-v1/evaluate",
    "--bootstrap-seed",
    "712019",
  ];

  it("recognizes the consume-holdout subcommand", () => {
    const parsed = parseCliArgs(CONSUME_ARGS);
    expect(parsed.command).toBe("consume-holdout");
  });

  it("rejects a fresh run without --confirm-split-digest or --resume-consumption", async () => {
    await expect(runCli(CONSUME_ARGS)).rejects.toThrow(/confirm-split-digest/u);
  });

  it("rejects an unknown flag on consume-holdout", async () => {
    await expect(
      runCli([
        ...CONSUME_ARGS,
        "--confirm-split-digest",
        "abc",
        "--bogus",
        "x",
      ]),
    ).rejects.toThrow(/unknown flag --bogus/u);
  });
});

describe("benchmark CLI evidence-publication parsing", () => {
  const PUBLISH_EVIDENCE_ARGS = [
    "publish-evidence",
    "--source-readiness",
    "sr.json",
    "--dataset-audit",
    "da.json",
    "--split-artifact",
    "split.json",
    "--frozen-calibration",
    "frozen.json",
    "--fit-report",
    "fit.json",
    "--report",
    "report.json",
    "--ledger",
    "ledger.jsonl",
    "--consumption-id",
    "consume-0001",
    "--model-dir",
    "models/cleanfeed-ptbr-v1",
    "--output",
    "benchmark/evidence/tmr-ptbr-v1",
  ];

  it("recognizes publish-evidence and verify-published-evidence", () => {
    expect(parseCliArgs(PUBLISH_EVIDENCE_ARGS).command).toBe(
      "publish-evidence",
    );
    expect(
      parseCliArgs([
        "verify-published-evidence",
        "--evidence-dir",
        "benchmark/evidence/tmr-ptbr-v1",
        "--model-dir",
        "models/cleanfeed-ptbr-v1",
      ]).command,
    ).toBe("verify-published-evidence");
  });

  it("still lists the Phase 2 subcommands in the dispatch error", () => {
    expect(() => parseCliArgs(["frobnicate"])).toThrow(
      /expected one of ingest, validate, split, validate-predictions, score, fit, evaluate, consume-holdout, publish-profile, verify-evidence/u,
    );
  });

  it("rejects an unknown flag on publish-evidence", async () => {
    await expect(
      runCli([...PUBLISH_EVIDENCE_ARGS, "--bogus", "x"]),
    ).rejects.toThrow(/unknown flag --bogus/u);
  });

  it("requires publish-evidence's mandatory flags", async () => {
    await expect(
      runCli(["publish-evidence", "--report", "report.json"]),
    ).rejects.toThrow(/--source-readiness|--dataset-audit|--output/u);
  });

  it("requires verify-published-evidence's mandatory flags", async () => {
    await expect(
      runCli(["verify-published-evidence", "--evidence-dir", "e"]),
    ).rejects.toThrow(/--model-dir/u);
  });

  it("rejects an unknown flag on verify-published-evidence", async () => {
    await expect(
      runCli([
        "verify-published-evidence",
        "--evidence-dir",
        "e",
        "--model-dir",
        "m",
        "--bogus",
        "x",
      ]),
    ).rejects.toThrow(/unknown flag --bogus/u);
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

const MODEL_ID = "cleanfeed-ptbr-v1";
const MODEL_VERSION = "1.0.0";
const BUNDLE = hex("bundle");
const TOKENIZER = hex("tokenizer");
const PARITY = hex("runtime-parity");
const BUILD = hex("extension-build");
const AGGREGATION = "tmr-aggregation-v3";
const COMPOSITION = "lexical-content-v2";
const DATASET_AUDIT = hex("dataset-audit");
const SOURCE_READINESS = hex("source-readiness");
const EVALUATOR = hex("evaluator");
const SESSION_TIME = "2026-07-19T00:00:00.000Z";

let recordCounter = 0;
function record(
  label: BenchmarkRecord["label"],
  createdAt: number,
  // The provider's family label for a generated record. Callers pass the reserved
  // one for rows they place in the test partition, so the manifest's reservation
  // names a family the corpus actually contains — the four-way invariant in
  // benchmark/generator-family.ts refuses a reservation nothing satisfies.
  family = "acme_family",
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
    platform: "generic",
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
      family,
      model: "acme-1",
      version: "v1",
      promptId: `prompt_${id}`,
      promptSha256: hex(`prompt-${id}`),
      generatedAt: createdAt,
    };
    // The canonical field, required by the schema on every generated record and
    // the only one the split/slices/audit read (benchmark/generator-family.ts).
    base.groups.generatorFamily = normalizeGeneratorFamily(family);
  }
  if (label === "mixed") {
    base.mixture = {
      aiFraction: 0.6,
      humanFraction: 0.4,
      spans: [{ start: 0, end: 10, origin: "ai" }],
      generationMode: "mechanistic",
    };
    base.groups.derivationRoot = `parent_${id}`;
  }
  return base;
}

function datasetManifest(): DatasetManifest {
  return {
    schemaVersion: 1,
    datasetId: "ptbr-generic-v1",
    version: "1.0.0",
    scientificUse: "infrastructure-only",
    intendedLanguage: "pt-BR",
    intendedDomain: "generic",
    createdAt: "2026-07-19T00:00:00.000Z",
    normalizationVersion: "cleanfeed-text-v1",
    annotationProtocolVersion: "annotation-v1",
    recordsFile: "records.jsonl",
    recordsSha256: hex("records"),
    reviewLedgerFile: "private/review-ledger.jsonl",
    reviewLedgerSha256: hex("review-ledger"),
    sourceManifestFile: "private/source-manifest.json",
    sourceManifestSha256: hex("source-manifest"),
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
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
    heldOutGeneratorFamilies: derivedHeldOutFamilies(split),
    passed: true,
    reasons: [],
  };
}

// The families present in the test partition and absent from development and
// calibration — derived from the split exactly as benchmark/split-audit.ts derives
// them, so this stand-in audit cannot claim a reservation the partitions do not
// show. Hardcoding it was harmless only while nothing compared the four sets.
function derivedHeldOutFamilies(
  split: DatasetSplit<BenchmarkRecord>,
): GeneratorFamily[] {
  const families = (rows: readonly BenchmarkRecord[]): GeneratorFamily[] =>
    rows
      .map((row) => generatorFamilyOf(row))
      .filter((family): family is GeneratorFamily => family !== undefined);
  const elsewhere = new Set<GeneratorFamily>([
    ...families(split.development),
    ...families(split.calibration),
  ]);
  return [...new Set(families(split.test))]
    .filter((family) => !elsewhere.has(family))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
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
      warning: selectionThresholdEvidence({
        documentThreshold: 0.5,
        localizedThreshold: 0.5,
        negatives: 2,
        falsePositives: 0,
        selectionFprUpper95Nominal: 0.01,
        positives: 2,
        truePositives: 2,
        recall: 1,
      }),
      visual: selectionThresholdEvidence({
        documentThreshold: 0.8,
        localizedThreshold: null,
        negatives: 2,
        falsePositives: 0,
        selectionFprUpper95Nominal: 0.01,
        positives: 2,
        truePositives: 1,
        recall: 0.5,
      }),
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
    record("ai", 330, "heldout_family"),
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
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
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

// ---------------------------------------------------------------------------
// Candidate freeze: the fit gate refuses any test-prediction flag, the freeze
// is byte-identical under changed hidden test labels/scores, the fit report
// carries no test metric, and the append-only holdout ledger is never opened.
//
// A self-contained on-disk fit scenario (distinct from the evaluate scenario
// above): a sealed-shaped dataset, the governance triplet, two sharded
// prediction artifacts, plus HIDDEN test labels and a HIDDEN test-prediction
// artifact that fit must never read. Every digest is COMPUTED so the fit's own
// recomputation matches. 70 human negatives clear the 5% Wilson-upper warning
// budget with zero false positives; 20 positives score clearly higher.
// ---------------------------------------------------------------------------

const FIT_BUNDLE = hex("fit-bundle");
const FIT_TOKENIZER = hex("fit-tokenizer");
const FIT_BUILD = hex("fit-extension-build");
const FIT_INFERENCE = hex("fit-inference-core");
const FIT_PRED_DATASET = hex("fit-pred-dataset");
const FIT_PRED_SPLIT = hex("fit-pred-split");

interface FitScoreRow {
  schemaVersion: 2;
  id: string;
  status: "scored";
  documentRawScore: number;
  localizedRawScore: number;
  evidenceQuality: "sufficient";
  reasonCode: string;
  coverage: number;
  latencyMs: number;
  memoryBytes: number;
}

function fitScored(id: string, doc: number, loc: number): FitScoreRow {
  return {
    schemaVersion: 2,
    id,
    status: "scored",
    documentRawScore: doc,
    localizedRawScore: loc,
    evidenceQuality: "sufficient",
    reasonCode: "SCORED",
    coverage: 1,
    latencyMs: 40,
    memoryBytes: 1000,
  };
}

function humanScore(index: number): number {
  return 0.03 + (index % 5) * 0.01;
}
function aiScore(index: number): number {
  return 0.75 + (index % 4) * 0.03;
}

async function writeFitPredictions(
  dir: string,
  partition: "development" | "calibration",
  rows: readonly FitScoreRow[],
  parityDigest: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const shardBody = `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
  await writeFile(join(dir, "shard-000.jsonl"), shardBody);
  const shardSha = sha256BytesHex(new TextEncoder().encode(shardBody));
  const manifest: PredictionManifestV1 = {
    schemaVersion: 1,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: FIT_BUNDLE,
    aggregationVersion: AGGREGATION,
    contentCompositionVersion: COMPOSITION,
    tokenizerDigest: FIT_TOKENIZER,
    runtimeParityDigest: parityDigest,
    extensionBuildDigest: FIT_BUILD,
    backend: "wasm",
    chromeVersion: RELEASE_CHROME_VERSION,
    datasetDigest: FIT_PRED_DATASET,
    splitDigest: FIT_PRED_SPLIT,
    partition,
    shardSize: 100,
    shardCount: 1,
    shards: [
      {
        index: 0,
        file: "shard-000.jsonl",
        sha256: shardSha,
        recordCount: rows.length,
      },
    ],
    holdoutConsumptionId: null,
    createdAt: "2026-07-19T00:00:00.000Z",
  };
  await writeFile(
    join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

interface FitScenario {
  options: FitOptions;
  datasetDir: string;
  testLabelsPath: string;
  testPredictionsDir: string;
  ledgerPath: string;
}

// Builds the scenario twice-reproducibly: the development/calibration inputs
// and all governance are IDENTICAL across calls (recordCounter is reset), and
// only the hidden test labels/scores vary with `testVariant`.
async function buildFitScenario(
  root: string,
  testVariant: number,
  freeDiskBytes: number,
): Promise<FitScenario> {
  recordCounter = 0;
  const devHumans = Array.from({ length: 35 }, (_u, i) =>
    record("human", 10 + i),
  );
  const devAis = Array.from({ length: 10 }, (_u, i) => record("ai", 50 + i));
  const calHumans = Array.from({ length: 35 }, (_u, i) =>
    record("human", 110 + i),
  );
  const calAis = Array.from({ length: 10 }, (_u, i) => record("ai", 150 + i));
  const testRecords = [
    record("human", 310),
    record("human", 311),
    record("ai", 320, "heldout_family"),
    record("ai", 321, "heldout_family"),
  ];
  const allRecords = [
    ...devHumans,
    ...devAis,
    ...calHumans,
    ...calAis,
    ...testRecords,
  ];

  // Source manifest: raw bytes gate the audit/manifest raw SHA; the canonical
  // self-digest (its own field excluded) gates the readiness report.
  const sourceBase = {
    schemaVersion: 1,
    corpus: "ptbr-generic-v1",
    note: "fixture source manifest",
  };
  const sourceDigest = await canonicalSha256(sourceBase);
  const sourceBytes = JSON.stringify({
    ...sourceBase,
    sourceManifestDigest: sourceDigest,
  });
  const sourceSha = sha256BytesHex(new TextEncoder().encode(sourceBytes));
  const reviewLedgerSha = hex("fit-review-ledger");

  const manifest: DatasetManifest = {
    schemaVersion: 1,
    datasetId: "ptbr-generic-v1",
    version: "1.0.0",
    scientificUse: "infrastructure-only",
    intendedLanguage: "pt-BR",
    intendedDomain: "generic",
    createdAt: "2026-07-19T00:00:00.000Z",
    normalizationVersion: "cleanfeed-text-v1",
    annotationProtocolVersion: "annotation-v1",
    recordsFile: "records.jsonl",
    recordsSha256: hex("fit-records"),
    reviewLedgerFile: "private/review-ledger.jsonl",
    reviewLedgerSha256: reviewLedgerSha,
    sourceManifestFile: "private/source-manifest.json",
    sourceManifestSha256: sourceSha,
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
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

  const datasetDir = join(root, "dataset");
  await mkdir(join(datasetDir, "private"), { recursive: true });
  await writeFile(
    join(datasetDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(datasetDir, "records.jsonl"),
    `${allRecords.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
  await writeFile(
    join(datasetDir, "private", "source-manifest.json"),
    sourceBytes,
  );

  const split: DatasetSplit<BenchmarkRecord> = {
    development: [...devHumans, ...devAis],
    calibration: [...calHumans, ...calAis],
    test: testRecords,
  };
  const policy = {
    fractions: { development: 0.2, calibration: 0.3, test: 0.5 },
    classTolerance: 0.02,
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
    seed: 712019,
  } as const;
  const splitArtifact = await buildSplitArtifact({
    manifest,
    records: allRecords,
    split,
    policy,
    audit: passingAudit(split),
  });
  const splitArtifactPath = join(root, "split-artifact.json");
  await writeFile(
    splitArtifactPath,
    `${JSON.stringify(splitArtifact, null, 2)}\n`,
  );

  const humanCount = allRecords.filter((r) => r.label === "human").length;
  const aiCount = allRecords.filter((r) => r.label === "ai").length;
  const auditBase: Omit<DatasetAudit, "auditDigest"> = {
    datasetId: "ptbr-generic-v1",
    scientificUse: "infrastructure-only",
    releaseEligible: false,
    recordCount: allRecords.length,
    counts: { human: humanCount, ai: aiCount, mixed: 0 },
    sourceTypes: { "qa-informal": 1 },
    hardNegativeFamilies: { formulaic: 1 },
    generatorFamilies: { acme_family: aiCount },
    labelBasisCounts: emptyLabelBasisPublication(),
    licenses: ["consent-v1"],
    recordsSha256: hex("fit-records"),
    reviewLedgerSha256: reviewLedgerSha,
    sourceManifestSha256: sourceSha,
    sealed: true,
  };
  const audit: DatasetAudit = {
    ...auditBase,
    auditDigest: await computeDatasetAuditDigest(auditBase),
  };
  const datasetAuditPath = join(root, "dataset-audit.json");
  await writeFile(datasetAuditPath, `${JSON.stringify(audit, null, 2)}\n`);

  const readinessBase = {
    schemaVersion: 1 as const,
    status: "ready" as const,
    sourceManifestDigest: sourceDigest,
    recordCount: 94,
    sourceCount: 3,
    acquisitionCounts: { consent: 40, licensed: 40, generated: 14 },
    protocols: {
      corpus: "corpus-v1" as const,
      collection: "collection-v1" as const,
      annotation: "annotation-v1" as const,
      generation: "generation-v1" as const,
      pii: "pii-review-v1" as const,
    },
    blockingReasons: [],
  };
  const readiness: CorpusSourceReadinessReport = {
    ...readinessBase,
    reportDigest: await computeSourceReadinessDigest(readinessBase),
  };
  const sourceReadinessPath = join(root, "source-readiness.json");
  await writeFile(
    sourceReadinessPath,
    `${JSON.stringify(readiness, null, 2)}\n`,
  );

  const parityBase = {
    schemaVersion: 1 as const,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: FIT_BUNDLE,
    aggregationVersion: AGGREGATION,
    contentCompositionVersion: COMPOSITION,
    tokenizerDigest: FIT_TOKENIZER,
    inferenceCoreDigest: FIT_INFERENCE,
  };
  const parity: RuntimeParityManifestV1 = {
    ...parityBase,
    runtimeParityDigest: await computeRuntimeParityDigest(parityBase),
  };
  const runtimeParityPath = join(root, "runtime-parity.json");
  await writeFile(runtimeParityPath, `${JSON.stringify(parity, null, 2)}\n`);

  const developmentPredictionsDirectory = join(root, "dev");
  const calibrationPredictionsDirectory = join(root, "cal");
  await writeFitPredictions(
    developmentPredictionsDirectory,
    "development",
    [
      ...devHumans.map((r, i) => fitScored(r.id, humanScore(i), humanScore(i))),
      ...devAis.map((r, i) => fitScored(r.id, aiScore(i), aiScore(i))),
    ],
    parity.runtimeParityDigest,
  );
  await writeFitPredictions(
    calibrationPredictionsDirectory,
    "calibration",
    [
      ...calHumans.map((r, i) => fitScored(r.id, humanScore(i), humanScore(i))),
      ...calAis.map((r, i) => fitScored(r.id, aiScore(i), aiScore(i))),
    ],
    parity.runtimeParityDigest,
  );

  // HIDDEN test labels and HIDDEN test scores — fit must read NEITHER. Their
  // contents vary with `testVariant` so a byte-identical freeze proves it.
  const testLabelsPath = join(datasetDir, "private", "test-labels.jsonl");
  await writeFile(
    testLabelsPath,
    `${testRecords
      .map((r, i) =>
        JSON.stringify({
          id: r.id,
          label: testVariant === 0 ? r.label : i % 2 === 0 ? "ai" : "human",
        }),
      )
      .join("\n")}\n`,
  );
  const testPredictionsDir = join(root, "test-predictions");
  await mkdir(testPredictionsDir, { recursive: true });
  await writeFile(
    join(testPredictionsDir, "shard-000.jsonl"),
    `${testRecords
      .map((r, i) =>
        JSON.stringify(
          fitScored(
            r.id,
            testVariant === 0 ? 0.1 + i * 0.1 : 0.9 - i * 0.1,
            testVariant === 0 ? 0.2 + i * 0.1 : 0.8 - i * 0.1,
          ),
        ),
      )
      .join("\n")}\n`,
  );

  const outputDirectory = join(root, "out");
  await mkdir(outputDirectory, { recursive: true });

  return {
    options: {
      datasetDirectory: datasetDir,
      datasetAuditPath,
      sourceReadinessPath,
      splitArtifactPath,
      runtimeParityPath,
      developmentPredictionsDirectory,
      calibrationPredictionsDirectory,
      outputDirectory,
      seed: 712019,
      freeDiskBytes,
    },
    datasetDir,
    testLabelsPath,
    testPredictionsDir,
    ledgerPath: join(datasetDir, "private", "holdout-ledger.jsonl"),
  };
}

const FIT_FREEZE_TIMEOUT_MS = 120_000;
const SUFFICIENT_DISK = 30 * 1024 ** 3;

describe("benchmark CLI fit freeze — holdout independence", () => {
  const created: string[] = [];
  afterEach(async () => {
    await Promise.all(
      created.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    created.length = 0;
  });
  async function newRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "cf-fit-freeze-"));
    created.push(root);
    return root;
  }

  it("rejects a test-prediction flag on fit as an unknown flag", async () => {
    await expect(
      runCli([
        "fit",
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
        "--test-predictions",
        "test",
      ]),
    ).rejects.toThrow(/unknown flag --test-predictions/u);
  });

  it(
    "freezes byte-identically under changed hidden test labels/scores, writes no test metric, and never opens the ledger",
    async () => {
      const rootA = await newRoot();
      const scenarioA = await buildFitScenario(rootA, 0, SUFFICIENT_DISK);
      await expect(runFit(scenarioA.options)).resolves.toContain(
        "Calibration frozen without test access",
      );
      const frozenA = await readFile(
        join(scenarioA.options.outputDirectory, "frozen-calibration.json"),
        "utf8",
      );
      const fitReportA = await readFile(
        join(scenarioA.options.outputDirectory, "fit-report.json"),
        "utf8",
      );

      const rootB = await newRoot();
      const scenarioB = await buildFitScenario(rootB, 1, SUFFICIENT_DISK);
      await runFit(scenarioB.options);
      const frozenB = await readFile(
        join(scenarioB.options.outputDirectory, "frozen-calibration.json"),
        "utf8",
      );
      const fitReportB = await readFile(
        join(scenarioB.options.outputDirectory, "fit-report.json"),
        "utf8",
      );

      // The hidden test labels/scores genuinely differ between the two runs...
      expect(await readFile(scenarioA.testLabelsPath, "utf8")).not.toEqual(
        await readFile(scenarioB.testLabelsPath, "utf8"),
      );
      // ...yet the frozen calibration and the fit report are byte-identical.
      expect(frozenA).toEqual(frozenB);
      expect(fitReportA).toEqual(fitReportB);

      // The fit report binds the ready preflight and carries no test metric.
      const fitReport = JSON.parse(fitReportA);
      expect(fitReport.preflight.status).toBe("ready");
      expect(fitReport.partitionsUsed).toEqual(["development", "calibration"]);
      const frozen = JSON.parse(frozenA);
      expect(fitReport.calibrationArtifactDigest).toBe(frozen.artifactDigest);
      expect(fitReport.datasetAuditDigest).toBe(
        fitReport.preflight.datasetAuditDigest,
      );
      expect(fitReport.predictionManifestDigests).toEqual({
        development: fitReport.preflight.developmentPredictionManifestDigest,
        calibration: fitReport.preflight.calibrationPredictionManifestDigest,
      });
      const forbidden = /test|holdout|consumption/i;
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(walk);
        } else if (value !== null && typeof value === "object") {
          for (const key of Object.keys(value)) {
            expect(key).not.toMatch(forbidden);
            walk((value as Record<string, unknown>)[key]);
          }
        }
      };
      walk(fitReport);

      // The append-only holdout ledger is never opened by a fit.
      await expect(stat(scenarioA.ledgerPath)).rejects.toThrow();
      await expect(
        stat(join(scenarioA.datasetDir, "private", "active-session.json")),
      ).rejects.toThrow();
    },
    FIT_FREEZE_TIMEOUT_MS,
  );

  it(
    "requires a ready preflight: a fit with under 20 GiB free disk is blocked before it fits",
    async () => {
      const root = await newRoot();
      const scenario = await buildFitScenario(root, 0, 19 * 1024 ** 3);
      await expect(runFit(scenario.options)).rejects.toThrow(
        /CANDIDATE_PREFLIGHT_BLOCKED|disk/u,
      );
      // Nothing was frozen and the ledger stays unopened.
      await expect(
        stat(join(scenario.options.outputDirectory, "frozen-calibration.json")),
      ).rejects.toThrow();
      await expect(stat(scenario.ledgerPath)).rejects.toThrow();
    },
    FIT_FREEZE_TIMEOUT_MS,
  );
});
