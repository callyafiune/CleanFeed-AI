import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import type { SerializedCalibratorV1 } from "../../contracts/calibration-profile.ts";
import type {
  BenchmarkPage,
  ModelBenchmarkScoreV1,
  ModelBenchmarkStatusV1,
} from "../browser-scorer.ts";
import type { FrozenCalibrationArtifact } from "../calibration-pipeline.ts";
import {
  runConsumeHoldout,
  type ConsumeHoldoutOptions,
  type ConsumeHoldoutTestPage,
} from "../commands/consume-holdout.ts";
import type { DatasetManifest } from "../dataset-manifest.ts";
import { computeDatasetDigest, computeEvaluatorDigest } from "../digests.ts";
import {
  computePredictionManifestDigest,
  RELEASE_CHROME_VERSION,
  type PredictionManifestV1,
} from "../prediction-schema.ts";
import type { BenchmarkRecord } from "../schema.ts";
import { buildSplitArtifact } from "../split-artifact.ts";
import type { SplitAudit } from "../split-audit.ts";
import type { DatasetSplit } from "../split.ts";

// ---------------------------------------------------------------------------
// consume-holdout drives the one-way holdout lease end to end: it opens the
// Phase 2 lease exactly once, browser-scores the sealed test partition under
// that active consumption via an injected page, validates completeness, then
// delegates the scientific decision byte-for-byte to the Phase 2 evaluate/gates.
//
// Every scenario is HAND-CONSTRUCTED (a Platt calibrator with known slope/
// intercept and explicit thresholds) so the calibrated scores — and therefore
// the gate decision — are exact and deterministic, exactly like the CLI test's
// evaluate scenario. runFit is never invoked: consume-holdout must never touch
// fit code after starting a consumption.
// ---------------------------------------------------------------------------

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
const AGGREGATION = "tmr-aggregation-v2";
const COMPOSITION = "lexical-content-v1";
const DATASET_AUDIT = hex("dataset-audit");
const SOURCE_READINESS = hex("source-readiness");
const FIXED_TIME = "2026-07-19T00:00:00.000Z";

// Platt maps raw 0.2 -> ~0.0025 (below every threshold) and raw 0.8 -> ~0.9975
// (above the 0.5 warning and 0.8 action thresholds): clean, exact separation.
const PLATT: SerializedCalibratorV1 = {
  kind: "platt",
  slope: 20,
  intercept: -10,
};

let recordCounter = 0;

interface RecordOptions {
  textMarker?: string;
  authorMarker?: string;
}

function record(
  label: BenchmarkRecord["label"],
  createdAt: number,
  options: RecordOptions = {},
): BenchmarkRecord {
  recordCounter += 1;
  const id = `r${recordCounter}`;
  const textMarker = options.textMarker ?? "texto";
  const authorMarker = options.authorMarker ?? "author";
  const base: BenchmarkRecord = {
    schemaVersion: 2,
    id,
    text: `${textMarker}_${id}`,
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
      author: `${authorMarker}_${id}`,
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
  return base;
}

function datasetManifest(
  scientificUse: DatasetManifest["scientificUse"],
): DatasetManifest {
  return {
    schemaVersion: 1,
    datasetId: "ptbr-generic-v1",
    version: "1.0.0",
    scientificUse,
    intendedLanguage: "pt-BR",
    intendedDomain: "generic",
    createdAt: FIXED_TIME,
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

function predictionManifest(
  partition: PredictionManifestV1["partition"],
  datasetDigest: string,
  splitDigest: string,
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
    chromeVersion: RELEASE_CHROME_VERSION,
    datasetDigest,
    splitDigest,
    partition,
    shardSize: 100,
    shardCount: 0,
    shards: [],
    holdoutConsumptionId: null,
    createdAt: FIXED_TIME,
  };
}

async function frozenCalibration(input: {
  datasetDigest: string;
  splitDigest: string;
  developmentDigest: string;
  calibrationDigest: string;
  evaluatorDigest: string;
  visualDocument: number | null;
}): Promise<FrozenCalibrationArtifact> {
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
      chromeVersion: RELEASE_CHROME_VERSION,
    },
    predictionManifestDigests: {
      development: input.developmentDigest,
      calibration: input.calibrationDigest,
    },
    datasetDigest: input.datasetDigest,
    datasetAuditDigest: DATASET_AUDIT,
    sourceReadinessDigest: SOURCE_READINESS,
    splitDigest: input.splitDigest,
    evaluatorDigest: input.evaluatorDigest,
    partitionsUsed: ["development", "calibration"],
    calibrators: { document: PLATT, localized: PLATT },
    selectionEvidence: { document: [], localized: [] },
    thresholds: {
      warningDocument: 0.5,
      warningLocalized: 0.5,
      visualDocument: input.visualDocument,
    },
    thresholdEvidence: {
      warning: {
        documentThreshold: 0.5,
        localizedThreshold: 0.5,
        negatives: 150,
        falsePositives: 0,
        fprUpper95: 0.02,
        positives: 30,
        truePositives: 30,
        recall: 1,
      },
      visual:
        input.visualDocument === null
          ? null
          : {
              documentThreshold: input.visualDocument,
              localizedThreshold: null,
              negatives: 150,
              falsePositives: 0,
              fprUpper95: 0.018,
              positives: 30,
              truePositives: 30,
              recall: 1,
            },
    },
    fitSeed: 712019,
  };
  return { ...base, artifactDigest: await canonicalSha256(base) };
}

interface ScenarioSpec {
  scientificUse: DatasetManifest["scientificUse"];
  visualDocument: number | null;
  realEvaluator: boolean;
  testNegatives: number;
  testPositives: number;
  negativeTag: "LOW" | "HIGH";
  errorNegatives?: number;
  textMarker?: string;
  authorMarker?: string;
  /** Omit some test ids from test-input.jsonl to force a completeness failure. */
  omitInputIds?: number;
}

interface Scenario {
  options: ConsumeHoldoutOptions;
  status: ModelBenchmarkStatusV1;
  testIds: string[];
  ledgerPath: string;
  workDirectory: string;
  outputDirectory: string;
}

async function buildScenario(
  root: string,
  spec: ScenarioSpec,
): Promise<Scenario> {
  recordCounter = 0;
  const marker: RecordOptions = {
    textMarker: spec.textMarker,
    authorMarker: spec.authorMarker,
  };
  const dev = [record("human", 10, marker), record("human", 11, marker)];
  const cal = [record("human", 110, marker), record("human", 111, marker)];

  const testNegativeRecords: BenchmarkRecord[] = [];
  for (let i = 0; i < spec.testNegatives; i += 1) {
    testNegativeRecords.push(record("human", 300, marker));
  }
  const testPositiveRecords: BenchmarkRecord[] = [];
  for (let i = 0; i < spec.testPositives; i += 1) {
    testPositiveRecords.push(record("ai", 300, marker));
  }
  const testRecords = [...testNegativeRecords, ...testPositiveRecords];
  const records = [...dev, ...cal, ...testRecords];

  const manifest = datasetManifest(spec.scientificUse);
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
    development: dev,
    calibration: cal,
    test: testRecords,
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

  const fitDir = join(root, "fit");
  await mkdir(fitDir, { recursive: true });
  const devManifest = predictionManifest(
    "development",
    datasetDigest,
    splitDigest,
  );
  const calManifest = predictionManifest(
    "calibration",
    datasetDigest,
    splitDigest,
  );
  const developmentDigest = await computePredictionManifestDigest(devManifest);
  const calibrationDigest = await computePredictionManifestDigest(calManifest);
  await writeFile(
    join(fitDir, "development-prediction-manifest.json"),
    `${JSON.stringify(devManifest, null, 2)}\n`,
  );
  await writeFile(
    join(fitDir, "calibration-prediction-manifest.json"),
    `${JSON.stringify(calManifest, null, 2)}\n`,
  );
  const evaluatorDigest = spec.realEvaluator
    ? await computeEvaluatorDigest(REPO_ROOT)
    : hex("evaluator");
  const frozen = await frozenCalibration({
    datasetDigest,
    splitDigest,
    developmentDigest,
    calibrationDigest,
    evaluatorDigest,
    visualDocument: spec.visualDocument,
  });
  const frozenCalibrationPath = join(fitDir, "frozen-calibration.json");
  await writeFile(
    frozenCalibrationPath,
    `${JSON.stringify(frozen, null, 2)}\n`,
  );

  const testLabelsPath = join(datasetDir, "private", "test-labels.jsonl");
  await writeFile(
    testLabelsPath,
    `${testRecords
      .map((r) => JSON.stringify({ id: r.id, label: r.label }))
      .join("\n")}\n`,
  );

  // test-input.jsonl: opaque id + text the injected page scores. The tag drives
  // the mock scorer's raw score; the marker proves no raw text reaches a report.
  const errorNegatives = spec.errorNegatives ?? 0;
  const inputLines: string[] = [];
  testNegativeRecords.forEach((r, index) => {
    const tag = index < errorNegatives ? "ERR" : spec.negativeTag;
    inputLines.push(JSON.stringify({ id: r.id, text: `${tag}_${r.id}` }));
  });
  testPositiveRecords.forEach((r) => {
    inputLines.push(JSON.stringify({ id: r.id, text: `HIGH_${r.id}` }));
  });
  const omit = spec.omitInputIds ?? 0;
  const keptLines =
    omit > 0 ? inputLines.slice(0, inputLines.length - omit) : inputLines;
  const testInputPath = join(datasetDir, "private", "test-input.jsonl");
  await writeFile(testInputPath, `${keptLines.join("\n")}\n`);

  const workDirectory = join(root, "work", "holdout");
  await mkdir(workDirectory, { recursive: true });
  const ledgerPath = join(datasetDir, "private", "holdout-ledger.jsonl");
  const outputDirectory = join(root, "out");

  const status: ModelBenchmarkStatusV1 = {
    schemaVersion: 1,
    state: "ready",
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: BUNDLE,
    aggregationVersion: AGGREGATION,
    contentCompositionVersion: COMPOSITION,
    tokenizerDigest: TOKENIZER,
    runtimeParityDigest: PARITY,
    backend: "wasm",
    exactTokenizer: true,
    errorCode: null,
  };

  const options: ConsumeHoldoutOptions = {
    datasetDirectory: datasetDir,
    splitArtifactPath,
    frozenCalibrationPath,
    ledgerPath,
    candidateExtensionDir: join(root, "candidate"),
    workDirectory,
    outputDirectory,
    bootstrapSeed: 712019,
    testInputPath,
    testLabelsPath,
    confirmSplitDigest: splitDigest,
  };

  return {
    options,
    status,
    testIds: testRecords.map((r) => r.id),
    ledgerPath,
    workDirectory,
    outputDirectory,
  };
}

function scoredRow(doc: number, loc: number): ModelBenchmarkScoreV1 {
  return {
    status: "scored",
    documentRawScore: doc,
    localizedRawScore: loc,
    evidenceQuality: "sufficient",
    reasonCode: "SCORED",
    coverage: 1,
    latencyMs: 20,
    memoryBytes: 1000,
  };
}

function errorRow(): ModelBenchmarkScoreV1 {
  return {
    status: "error",
    documentRawScore: null,
    localizedRawScore: null,
    evidenceQuality: "unsupported",
    reasonCode: "RUNTIME_ERROR",
    // Every error row must now name a sanitized cause; the closed row parser
    // rejects an error outcome that reports no diagnosable reason.
    failureDetail: "WASM_OOM",
    coverage: 0,
    latencyMs: 5,
    memoryBytes: null,
  };
}

function decode(text: string): ModelBenchmarkScoreV1 {
  if (text.startsWith("HIGH")) return scoredRow(0.8, 0.8);
  if (text.startsWith("LOW")) return scoredRow(0.2, 0.2);
  if (text.startsWith("ERR")) return errorRow();
  return scoredRow(0.2, 0.2);
}

interface PageHandle {
  createTestPage: () => Promise<ConsumeHoldoutTestPage>;
  createCalls: number;
  scoreCalls: number;
}

function stubPage(
  status: ModelBenchmarkStatusV1,
  behaviour: {
    scoreFor?: (text: string) => ModelBenchmarkScoreV1;
    throwOnFirstScore?: boolean;
    onStatus?: () => void;
  } = {},
): PageHandle {
  const handle: PageHandle = {
    createCalls: 0,
    scoreCalls: 0,
    createTestPage: () => {
      handle.createCalls += 1;
      let firstScore = true;
      const page: BenchmarkPage = {
        status(): Promise<ModelBenchmarkStatusV1> {
          behaviour.onStatus?.();
          return Promise.resolve(status);
        },
        score(text: string): Promise<ModelBenchmarkScoreV1> {
          handle.scoreCalls += 1;
          if (behaviour.throwOnFirstScore && firstScore) {
            firstScore = false;
            throw new Error("scorer boom");
          }
          return Promise.resolve((behaviour.scoreFor ?? decode)(text));
        },
      };
      return Promise.resolve({ page, close: () => Promise.resolve() });
    },
  };
  return handle;
}

function readLedgerEvents(
  path: string,
): { consumptionId: string; status: string }[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map(
      (line) => JSON.parse(line) as { consumptionId: string; status: string },
    );
}

const TIMEOUT_MS = 120_000;

describe("consume-holdout one-way lease", () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(
      created.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    created.length = 0;
  });

  async function newRoot(prefix = "cf-consume-"): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), prefix));
    created.push(root);
    return root;
  }

  it("refuses a wrong --confirm-split-digest before any ledger mutation", async () => {
    const root = await newRoot();
    const scenario = await buildScenario(root, {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 2,
      negativeTag: "LOW",
    });
    const page = stubPage(scenario.status);
    await expect(
      runConsumeHoldout(
        { ...scenario.options, confirmSplitDigest: hex("wrong-split") },
        { now: () => FIXED_TIME, createTestPage: page.createTestPage },
      ),
    ).rejects.toThrow(/split.?digest/iu);

    // No lease was opened, no session marker written, no scoring attempted.
    expect(existsSync(scenario.ledgerPath)).toBe(false);
    expect(
      existsSync(join(scenario.workDirectory, "active-session.json")),
    ).toBe(false);
    expect(page.createCalls).toBe(0);
    expect(page.scoreCalls).toBe(0);
  });

  it("writes the started lease exactly once before the first scored text and completes", async () => {
    const root = await newRoot();
    const scenario = await buildScenario(root, {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 2,
      negativeTag: "LOW",
    });
    let startedVisibleAtFirstInteraction = false;
    const activeSessionPath = join(
      scenario.workDirectory,
      "active-session.json",
    );
    const page = stubPage(scenario.status, {
      onStatus: () => {
        const started = readLedgerEvents(scenario.ledgerPath).some(
          (event) => event.status === "started",
        );
        startedVisibleAtFirstInteraction =
          started && existsSync(activeSessionPath);
      },
    });

    const message = await runConsumeHoldout(scenario.options, {
      now: () => FIXED_TIME,
      createTestPage: page.createTestPage,
    });

    // The atomic started event and its marker existed before any text was scored.
    expect(startedVisibleAtFirstInteraction).toBe(true);

    const events = readLedgerEvents(scenario.ledgerPath);
    const started = events.filter((event) => event.status === "started");
    const completed = events.filter((event) => event.status === "completed");
    expect(started).toHaveLength(1); // beginHoldoutConsumption called exactly once
    expect(completed).toHaveLength(1);
    // active-session.json is removed once the session is terminal.
    await expect(stat(activeSessionPath)).rejects.toThrow();

    // The printed decision is delegated byte-for-byte to the Phase 2 gates.
    const gates = JSON.parse(
      await readFile(
        join(scenario.outputDirectory, "gate-report.json"),
        "utf8",
      ),
    ) as { decision: string };
    expect(message).toBe(`HOLDOUT_COMPLETED decision=${gates.decision}`);
    expect(message).toMatch(
      /^HOLDOUT_COMPLETED decision=(pass|indicator-only|reject)$/u,
    );
  });

  it("keeps the started lease consumed on an unexpected crash and resumes the same id", async () => {
    const root = await newRoot();
    const scenario = await buildScenario(root, {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 2,
      negativeTag: "LOW",
    });
    const activeSessionPath = join(
      scenario.workDirectory,
      "active-session.json",
    );

    // Run 1: the scorer dies unexpectedly on the first text (not a recognized,
    // declared failure), so the started lease must survive for a resume.
    const crashing = stubPage(scenario.status, { throwOnFirstScore: true });
    await expect(
      runConsumeHoldout(scenario.options, {
        now: () => FIXED_TIME,
        createTestPage: crashing.createTestPage,
      }),
    ).rejects.toThrow(/scorer boom/u);

    const afterCrash = readLedgerEvents(scenario.ledgerPath);
    expect(afterCrash.filter((e) => e.status === "started")).toHaveLength(1);
    expect(afterCrash.some((e) => e.status !== "started")).toBe(false);
    expect(existsSync(activeSessionPath)).toBe(true);
    expect(
      existsSync(join(scenario.outputDirectory, "benchmark-report.json")),
    ).toBe(false);
    const consumptionId = afterCrash[0].consumptionId;

    // A fresh (non-resume) run of the SAME tuple is refused; the lease is spent.
    await expect(
      runConsumeHoldout(scenario.options, {
        now: () => FIXED_TIME,
        createTestPage: stubPage(scenario.status).createTestPage,
      }),
    ).rejects.toThrow(/already consumed/iu);

    // A resume can never mint a different id.
    await expect(
      runConsumeHoldout(
        { ...scenario.options, resumeConsumptionId: hex("bogus").slice(0, 24) },
        {
          now: () => FIXED_TIME,
          createTestPage: stubPage(scenario.status).createTestPage,
        },
      ),
    ).rejects.toThrow(/no started holdout session|session/iu);

    // Run 2: resume the SAME id with a working scorer -> the session completes.
    const working = stubPage(scenario.status);
    const message = await runConsumeHoldout(
      { ...scenario.options, resumeConsumptionId: consumptionId },
      { now: () => FIXED_TIME, createTestPage: working.createTestPage },
    );
    expect(message).toMatch(
      /^HOLDOUT_COMPLETED decision=(pass|indicator-only|reject)$/u,
    );
    const afterResume = readLedgerEvents(scenario.ledgerPath);
    // Still exactly one started event and the SAME id; a completed terminal event.
    expect(afterResume.filter((e) => e.status === "started")).toHaveLength(1);
    const completed = afterResume.filter((e) => e.status === "completed");
    expect(completed).toHaveLength(1);
    expect(completed[0].consumptionId).toBe(consumptionId);
    expect(existsSync(activeSessionPath)).toBe(false);
  });

  it("marks a recognized irrecoverable scorer failure as failed and stays consumed", async () => {
    const root = await newRoot();
    const scenario = await buildScenario(root, {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 2,
      negativeTag: "LOW",
    });
    // A candidate whose runtime parity diverges from the frozen identity fails
    // closed before any text is scored (SCORER_PARITY_MISMATCH).
    const drifted: ModelBenchmarkStatusV1 = {
      ...scenario.status,
      runtimeParityDigest: hex("other-parity"),
    };
    const page = stubPage(drifted);
    await expect(
      runConsumeHoldout(scenario.options, {
        now: () => FIXED_TIME,
        createTestPage: page.createTestPage,
      }),
    ).rejects.toThrow(/SCORER_PARITY_MISMATCH/u);

    const events = readLedgerEvents(scenario.ledgerPath);
    expect(events.filter((e) => e.status === "started")).toHaveLength(1);
    const failed = events.filter((e) => e.status === "failed");
    expect(failed).toHaveLength(1);
    expect(
      existsSync(join(scenario.workDirectory, "active-session.json")),
    ).toBe(false);

    // Terminal + consumed: neither a fresh run nor a resume reopens it.
    await expect(
      runConsumeHoldout(scenario.options, {
        now: () => FIXED_TIME,
        createTestPage: stubPage(scenario.status).createTestPage,
      }),
    ).rejects.toThrow(/already consumed/iu);
    await expect(
      runConsumeHoldout(
        { ...scenario.options, resumeConsumptionId: failed[0].consumptionId },
        {
          now: () => FIXED_TIME,
          createTestPage: stubPage(scenario.status).createTestPage,
        },
      ),
    ).rejects.toThrow(/terminal/iu);
  });

  it("hard-fails on missing test prediction ids with no scientific decision", async () => {
    const root = await newRoot();
    const scenario = await buildScenario(root, {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 2,
      negativeTag: "LOW",
      omitInputIds: 1,
    });
    const page = stubPage(scenario.status);
    await expect(
      runConsumeHoldout(scenario.options, {
        now: () => FIXED_TIME,
        createTestPage: page.createTestPage,
      }),
    ).rejects.toThrow(/completeness|missing/iu);

    // No report/decision was produced, and the spent lease is terminal (failed).
    expect(
      existsSync(join(scenario.outputDirectory, "benchmark-report.json")),
    ).toBe(false);
    const events = readLedgerEvents(scenario.ledgerPath);
    expect(events.some((e) => e.status === "failed")).toBe(true);
    expect(events.some((e) => e.status === "completed")).toBe(false);
  });

  it(
    "delegates a pass decision to the Phase 2 gates and leaks no raw content",
    async () => {
      const root = await newRoot();
      const scenario = await buildScenario(root, {
        scientificUse: "release",
        visualDocument: 0.8,
        realEvaluator: true,
        testNegatives: 300,
        testPositives: 20,
        negativeTag: "LOW",
        errorNegatives: 1,
        textMarker: "SEGREDO",
        authorMarker: "AUTORSEGREDO",
      });
      const page = stubPage(scenario.status);
      const message = await runConsumeHoldout(scenario.options, {
        now: () => FIXED_TIME,
        createTestPage: page.createTestPage,
      });

      const gates = JSON.parse(
        await readFile(
          join(scenario.outputDirectory, "gate-report.json"),
          "utf8",
        ),
      ) as { decision: string };
      expect(gates.decision).toBe("pass");
      expect(message).toBe("HOLDOUT_COMPLETED decision=pass");

      // Report privacy: no raw text, author, url or prompt in any public output.
      const report = await readFile(
        join(scenario.outputDirectory, "benchmark-report.json"),
        "utf8",
      );
      const gateReport = await readFile(
        join(scenario.outputDirectory, "gate-report.json"),
        "utf8",
      );
      const reportMd = await readFile(
        join(scenario.outputDirectory, "benchmark-report.md"),
        "utf8",
      );
      for (const body of [report, gateReport, reportMd]) {
        expect(body).not.toMatch(/SEGREDO/u);
        expect(body).not.toMatch(/AUTORSEGREDO/u);
      }
    },
    TIMEOUT_MS,
  );

  it(
    "delegates an indicator-only decision when no visual-action threshold was frozen",
    async () => {
      const root = await newRoot();
      const scenario = await buildScenario(root, {
        scientificUse: "release",
        visualDocument: null,
        realEvaluator: true,
        testNegatives: 60,
        testPositives: 10,
        negativeTag: "LOW",
      });
      const page = stubPage(scenario.status);
      const message = await runConsumeHoldout(scenario.options, {
        now: () => FIXED_TIME,
        createTestPage: page.createTestPage,
      });
      const gates = JSON.parse(
        await readFile(
          join(scenario.outputDirectory, "gate-report.json"),
          "utf8",
        ),
      ) as { decision: string };
      expect(gates.decision).toBe("indicator-only");
      expect(message).toBe("HOLDOUT_COMPLETED decision=indicator-only");
    },
    TIMEOUT_MS,
  );

  it(
    "delegates a reject decision when a warning gate fails",
    async () => {
      const root = await newRoot();
      const scenario = await buildScenario(root, {
        scientificUse: "release",
        visualDocument: 0.8,
        realEvaluator: true,
        testNegatives: 60,
        testPositives: 10,
        negativeTag: "HIGH",
      });
      const page = stubPage(scenario.status);
      const message = await runConsumeHoldout(scenario.options, {
        now: () => FIXED_TIME,
        createTestPage: page.createTestPage,
      });
      const gates = JSON.parse(
        await readFile(
          join(scenario.outputDirectory, "gate-report.json"),
          "utf8",
        ),
      ) as { decision: string };
      expect(gates.decision).toBe("reject");
      expect(message).toBe("HOLDOUT_COMPLETED decision=reject");
    },
    TIMEOUT_MS,
  );
});
