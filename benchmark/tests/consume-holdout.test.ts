import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
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
import {
  selectionThresholdEvidence,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import {
  runConsumeHoldout,
  type ConsumeHoldoutDeps,
  type ConsumeHoldoutOptions,
  type ConsumeHoldoutTestPage,
} from "../commands/consume-holdout.ts";
import { buildIdentity, runEvaluate } from "../commands/evaluate.ts";
import { sha256OfFile } from "../commands/io.ts";
import { runValidatePredictions } from "../commands/validate-predictions.ts";
import { computeRuntimeParityDigest } from "../../contracts/runtime-parity.ts";
import { beginHoldoutConsumption } from "../holdout-ledger.ts";
import type { SplitArtifact } from "../split-artifact.ts";
import type { DatasetManifest } from "../dataset-manifest.ts";
import { computeDatasetDigest, computeEvaluatorDigest } from "../digests.ts";
import {
  computePredictionManifestDigest,
  RELEASE_CHROME_VERSION,
  type PredictionManifestV1,
} from "../prediction-schema.ts";
import type { BenchmarkRecord } from "../schema.ts";
import { buildSplitArtifact } from "../split-artifact.ts";
import {
  DECLARED_GROUP_AXES,
  FROZEN_SPLIT_AUDIT_POLICY,
  auditBlockedSplit,
} from "../split-audit.ts";
import type { DatasetSplit } from "../split.ts";
import {
  asGeneratorFamily,
  normalizeGeneratorFamily,
} from "../generator-family.ts";
import { writeEvaluatorFixture } from "./helpers/evaluator-tree.ts";

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
const AGGREGATION = "tmr-aggregation-v3";
const COMPOSITION = "lexical-content-v2";
const DATASET_AUDIT = hex("dataset-audit");
const SOURCE_READINESS = hex("source-readiness");
// The part of the sealed gate report these tests read back off disk.
interface GateReportShape {
  decision: string;
  gates: Array<{ id: string; evidence: string; passed: boolean }>;
  multiplicity: { declared: number | null; observed: number };
  failedIntegrity: string[];
  failedWarning: string[];
  failedAction: string[];
}

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
  // The provider's family label for a generated record. Test-partition positives
  // carry the reserved family, so the manifest's reservation names a family the
  // corpus actually contains — the four-way invariant in
  // benchmark/generator-family.ts refuses a reservation nothing satisfies.
  family?: string;
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
      // Per record, like `collectionBatch` above and for the same reason: a value axis shared
      // corpus-wide unions every row into ONE component, and no split separates one component.
      domainSource: `linkedin_${id}`,
      // Per record, not one shared batch: `collectionBatch` is a value axis, so a single
      // batch across the corpus is ONE connected component and the split cannot separate
      // it. The fabricated audit hid that for as long as it existed.
      collectionBatch: `batch_${id}`,
      nearDuplicate: `nd_${id}`,
      derivationRoot: id,
    },
  };
  if (label === "ai") {
    base.generation = {
      provider: "acme",
      family: options.family ?? "acme_family",
      model: "acme-1",
      version: "v1",
      promptId: `prompt_${id}`,
      promptSha256: hex(`prompt-${id}`),
      generatedAt: createdAt,
    };
    // The canonical field, required by the schema on every generated record and
    // the only one the split/slices/audit read (benchmark/generator-family.ts).
    base.groups.generatorFamily = normalizeGeneratorFamily(
      options.family ?? "acme_family",
    );
    // The middle level of the ai-recall row of the frozen resampling table: the
    // recall interval of a positive is drawn over generator ⊃ prompt template ⊃
    // batch, and an absent axis is `unknown`, which is not a resampling unit.
    // Derived from the RECIPE and never from the record-line: a template id per row
    // makes that middle level one unit per row by construction, which is the
    // degeneration the resampling design exists to remove arriving through a fixture.
    //
    // Keyed by family AND by the partition's block time, because it IS a value axis: one
    // template per family alone is a single connected component spanning every partition
    // that family reaches, and no split can separate it. Each block time has several rows,
    // so the unit stays multi-row — the non-degeneracy the resampling needs — without crossing a
    // boundary.
    base.groups.promptTemplate = `pt_${normalizeGeneratorFamily(
      options.family ?? "acme_family",
    )}_${createdAt}`;
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

function predictionManifest(
  partition: PredictionManifestV1["partition"],
  datasetDigest: string,
  splitDigest: string,
  bundleDigest: string,
): PredictionManifestV1 {
  return {
    schemaVersion: 1,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest,
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
  bundleDigest: string;
  visualDocument: number | null;
}): Promise<FrozenCalibrationArtifact> {
  const base: Omit<FrozenCalibrationArtifact, "artifactDigest"> = {
    schemaVersion: 1,
    model: {
      modelId: MODEL_ID,
      modelVersion: MODEL_VERSION,
      bundleDigest: input.bundleDigest,
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
    partitionsUsed: ["dev", "cal-A"],
    calibrators: { document: PLATT, localized: PLATT },
    selectionEvidence: { document: [], localized: [] },
    thresholds: {
      warningDocument: 0.5,
      warningLocalized: 0.5,
      visualDocument: input.visualDocument,
    },
    thresholdEvidence: {
      warning: selectionThresholdEvidence({
        documentThreshold: 0.5,
        localizedThreshold: 0.5,
        negatives: 150,
        falsePositives: 0,
        selectionFprUpper95Nominal: 0.02,
        positives: 30,
        truePositives: 30,
        recall: 1,
      }),
      visual:
        input.visualDocument === null
          ? null
          : selectionThresholdEvidence({
              documentThreshold: input.visualDocument,
              localizedThreshold: null,
              negatives: 150,
              falsePositives: 0,
              selectionFprUpper95Nominal: 0.018,
              positives: 30,
              truePositives: 30,
              recall: 1,
            }),
    },
    fitSeed: 712019,
  };
  return { ...base, artifactDigest: await canonicalSha256(base) };
}

interface ScenarioSpec {
  scientificUse: DatasetManifest["scientificUse"];
  visualDocument: number | null;
  /**
   * Hash the real repository tree. Otherwise the scenario gets a synthetic tree
   * under its own root, which the frozen artifact then declares: the pre-exposure
   * check is a real check in both cases, and the synthetic one is far cheaper.
   */
  realEvaluator: boolean;
  testNegatives: number;
  testPositives: number;
  negativeTag: "LOW" | "HIGH";
  errorNegatives?: number;
  textMarker?: string;
  authorMarker?: string;
  /** Omit some test ids from test-input.jsonl to force a completeness failure. */
  omitInputIds?: number;
  /** Declare an evaluatorDigest that no tree on disk hashes to. */
  frozenEvaluatorDigest?: string;
  /** A different CANDIDATE over the same blind block. */
  bundleDigest?: string;
}

interface Scenario {
  options: ConsumeHoldoutOptions;
  status: ModelBenchmarkStatusV1;
  testIds: string[];
  ledgerPath: string;
  workDirectory: string;
  outputDirectory: string;
  evaluatorRoot: string;
}

// The evaluator root is injected through deps and never through a flag, so every
// scenario has to hand it over explicitly.
function holdoutDeps(
  scenario: Scenario,
  createTestPage: () => Promise<ConsumeHoldoutTestPage>,
): ConsumeHoldoutDeps {
  return {
    now: () => FIXED_TIME,
    createTestPage,
    evaluatorRoot: scenario.evaluatorRoot,
  };
}

async function buildScenario(
  root: string,
  spec: ScenarioSpec,
): Promise<Scenario> {
  recordCounter = 0;
  const bundleDigest = spec.bundleDigest ?? BUNDLE;
  const marker: RecordOptions = {
    textMarker: spec.textMarker,
    authorMarker: spec.authorMarker,
  };
  // Sizes follow from `test` being 20% of each class: with two fixed dev rows the split
  // could only satisfy the frozen proportions for one exact corpus size.
  const humanTotal = spec.testNegatives * 5;
  const aiTotal = spec.testPositives * 5;
  const share = (total: number, fraction: number): number =>
    Math.round(total * fraction);
  const fill = (
    label: "human" | "ai",
    count: number,
    createdAt: number,
  ): BenchmarkRecord[] =>
    Array.from({ length: Math.max(0, count) }, () =>
      // Never the reserved family: a held-out row outside `test` makes the split refuse.
      record(label, createdAt, marker),
    );

  const dev = [
    ...fill("human", share(humanTotal, 0.05), 10),
    ...fill("ai", share(aiTotal, 0.05), 11),
  ];
  const cal = [
    ...fill("human", share(humanTotal, 0.1), 110),
    ...fill("ai", share(aiTotal, 0.1), 111),
  ];

  const testNegativeRecords: BenchmarkRecord[] = [];
  for (let i = 0; i < spec.testNegatives; i += 1) {
    testNegativeRecords.push(record("human", 300, marker));
  }
  const testPositiveRecords: BenchmarkRecord[] = [];
  for (let i = 0; i < spec.testPositives; i += 1) {
    testPositiveRecords.push(
      record("ai", 300, { ...marker, family: "heldout_family" }),
    );
  }
  const testRecords = [...testNegativeRecords, ...testPositiveRecords];

  // `test` is 20% of each class by construction, so the remaining partitions are the
  // class total times their own targets, and `train` absorbs the rounding remainder.
  const calBFill = [
    ...fill("human", share(humanTotal, 0.2), 200),
    ...fill("ai", share(aiTotal, 0.2), 201),
  ];
  const humansPlaced =
    dev.filter((r) => r.label === "human").length +
    cal.filter((r) => r.label === "human").length +
    calBFill.filter((r) => r.label === "human").length +
    spec.testNegatives;
  const aisPlaced =
    dev.filter((r) => r.label === "ai").length +
    cal.filter((r) => r.label === "ai").length +
    calBFill.filter((r) => r.label === "ai").length +
    spec.testPositives;
  const trainFill = [
    ...fill("human", humanTotal - humansPlaced, 2),
    ...fill("ai", aiTotal - aisPlaced, 3),
  ];

  const records = [...trainFill, ...dev, ...cal, ...calBFill, ...testRecords];

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
    train: trainFill,
    dev,
    "cal-A": cal,
    "cal-B": calBFill,
    test: testRecords,
  };
  const policy = {
    fractions: {
      train: 0.45,
      dev: 0.05,
      "cal-A": 0.1,
      "cal-B": 0.2,
      test: 0.2,
    },
    classTolerance: 0.02,
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
    seed: 20260726,
  } as const;
  const artifact = await buildSplitArtifact({
    manifest,
    records,
    split,
    policy,
    // Measured, never written: `validateSplitArtifact` re-derives it and refuses an audit
    // that does not reproduce from these records.
    audit: auditBlockedSplit(
      records,
      split,
      FROZEN_SPLIT_AUDIT_POLICY,
      policy.heldOutGeneratorFamilies,
      DECLARED_GROUP_AXES,
    ),
  });
  const splitArtifactPath = join(root, "split-artifact.json");
  await writeFile(splitArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  const datasetDigest = await computeDatasetDigest(manifest, records);
  const splitDigest = artifact.splitDigest;

  const fitDir = join(root, "fit");
  await mkdir(fitDir, { recursive: true });
  const devManifest = predictionManifest(
    "dev",
    datasetDigest,
    splitDigest,
    bundleDigest,
  );
  const calManifest = predictionManifest(
    "cal-A",
    datasetDigest,
    splitDigest,
    bundleDigest,
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
  const evaluatorRoot = spec.realEvaluator
    ? REPO_ROOT
    : join(root, "evaluator");
  if (!spec.realEvaluator) await writeEvaluatorFixture(evaluatorRoot);
  const evaluatorDigest =
    spec.frozenEvaluatorDigest ?? (await computeEvaluatorDigest(evaluatorRoot));
  const frozen = await frozenCalibration({
    datasetDigest,
    splitDigest,
    developmentDigest,
    calibrationDigest,
    evaluatorDigest,
    bundleDigest,
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
  // Genesis of a release ledger is a deliberate act OUTSIDE the command, because a
  // release run refuses an absent `--ledger` instead of creating one. Zero bytes is
  // the honest starting height, so a scenario that expects "nothing consumed yet"
  // now expects an empty ledger and not a missing one.
  await writeFile(ledgerPath, "");
  const outputDirectory = join(root, "out");

  const status: ModelBenchmarkStatusV1 = {
    schemaVersion: 1,
    state: "ready",
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest,
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
    evaluatorRoot,
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

interface LedgerEvent {
  consumptionId: string;
  status: string;
  failureCode: string | null;
  evaluatorDigest: string;
}

/** The `code` of a coded rejection, so a test pins the code and not the prose. */
async function rejectionCode(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    return (error as { code?: string }).code ?? "";
  }
  throw new Error("expected the call to reject");
}

const ACTIVE_SESSION_FILE = "active-session.json";
const RECEIPT_FILE = "pre-exposure-check.json";
const INCIDENT_FILE = "holdout-exposure-incident.json";

function readLedgerEvents(path: string): LedgerEvent[] {
  if (!existsSync(path)) return [];
  const raw = readFileSync(path, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "")
    .map((line) => JSON.parse(line) as LedgerEvent);
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
      testPositives: 4,
      negativeTag: "LOW",
    });
    const page = stubPage(scenario.status);
    await expect(
      runConsumeHoldout(
        { ...scenario.options, confirmSplitDigest: hex("wrong-split") },
        holdoutDeps(scenario, page.createTestPage),
      ),
    ).rejects.toThrow(/split.?digest/iu);

    // No lease was opened, no session marker written, no scoring attempted. The
    // ledger exists because genesis precedes the command; what it must not hold is
    // an event.
    expect(readLedgerEvents(scenario.ledgerPath)).toEqual([]);
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
      testPositives: 4,
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

    const message = await runConsumeHoldout(
      scenario.options,
      holdoutDeps(scenario, page.createTestPage),
    );

    // The atomic started event and its marker existed before any text was scored.
    expect(startedVisibleAtFirstInteraction).toBe(true);

    const events = readLedgerEvents(scenario.ledgerPath);
    const started = events.filter((event) => event.status === "started");
    const completed = events.filter((event) => event.status === "completed");
    expect(started).toHaveLength(1); // beginHoldoutConsumption called exactly once
    expect(completed).toHaveLength(1);
    // active-session.json is removed once the session is terminal.
    await expect(stat(activeSessionPath)).rejects.toMatchObject({
      code: "ENOENT",
    });

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
      testPositives: 4,
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
      runConsumeHoldout(
        scenario.options,
        holdoutDeps(scenario, crashing.createTestPage),
      ),
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
      runConsumeHoldout(
        scenario.options,
        holdoutDeps(scenario, stubPage(scenario.status).createTestPage),
      ),
    ).rejects.toThrow(/already consumed/iu);

    // A resume can never mint a different id.
    await expect(
      runConsumeHoldout(
        { ...scenario.options, resumeConsumptionId: hex("bogus").slice(0, 24) },
        holdoutDeps(scenario, stubPage(scenario.status).createTestPage),
      ),
    ).rejects.toThrow(/no started holdout session|session/iu);

    // Run 2: resume the SAME id with a working scorer -> the session completes.
    const working = stubPage(scenario.status);
    const message = await runConsumeHoldout(
      { ...scenario.options, resumeConsumptionId: consumptionId },
      holdoutDeps(scenario, working.createTestPage),
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
      testPositives: 4,
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
      runConsumeHoldout(
        scenario.options,
        holdoutDeps(scenario, page.createTestPage),
      ),
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
      runConsumeHoldout(
        scenario.options,
        holdoutDeps(scenario, stubPage(scenario.status).createTestPage),
      ),
    ).rejects.toThrow(/already consumed/iu);
    await expect(
      runConsumeHoldout(
        { ...scenario.options, resumeConsumptionId: failed[0].consumptionId },
        holdoutDeps(scenario, stubPage(scenario.status).createTestPage),
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
      testPositives: 4,
      negativeTag: "LOW",
      omitInputIds: 1,
    });
    const page = stubPage(scenario.status);
    await expect(
      runConsumeHoldout(
        scenario.options,
        holdoutDeps(scenario, page.createTestPage),
      ),
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
    // Until A6 this scenario reached `pass`. It cannot any more, and not because
    // anything got worse: the gate policy now refuses to read an interval that no
    // C4 resampling plan backs, and `evaluate` passes `resampling: null` because
    // no such plan exists. So the assertion moved to what is actually true — the
    // decision is delegated byte-for-byte to the gates, EVERY substantive gate
    // still passes, and the only failures are the kinds of missing evidence (no
    // resampling plan, no pre-registered m, and — once a plan exists — a bootstrap
    // thinner than the pre-registered replicate count). This is the test that
    // should go back to `pass`, and it needs C4 (the plan), G5 (the frozen m) and
    // C6 (the replicate count actually executed) to get there.
    "delegates the decision to the Phase 2 gates, which reject for missing resampling evidence, and leaks no raw content",
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
      const message = await runConsumeHoldout(
        scenario.options,
        holdoutDeps(scenario, page.createTestPage),
      );

      const gates = JSON.parse(
        await readFile(
          join(scenario.outputDirectory, "gate-report.json"),
          "utf8",
        ),
      ) as GateReportShape;
      expect(gates.decision).toBe("reject");
      expect(message).toBe("HOLDOUT_COMPLETED decision=reject");
      // No integrity gate failed, and no substantive statistic failed either:
      // every failure names missing evidence, never a breached budget.
      expect(gates.failedIntegrity).toEqual([]);
      expect(gates.failedAction).not.toContain("action.available");
      // The label basis of every human negative is `unknown` until C1 puts the
      // field in the closed schema, so the action tier's label-basis cell is
      // supplementary-diagnostic and cannot authorize visual action. That is the
      // one failure here that is about power rather than about missing evidence.
      expect(gates.failedAction).toContain("action.fpr.labelBasis.unknown");
      for (const id of [...gates.failedWarning, ...gates.failedAction]) {
        if (id.startsWith("action.fpr.labelBasis.")) continue;
        const gate = gates.gates.find((candidate) => candidate.id === id);
        expect(gate?.evidence).toMatch(
          /missing-resampling-plan|missing-simultaneous-interval|insufficient-resampling-effort/u,
        );
      }
      // And the divisor was never quietly recomputed to fit.
      expect(gates.multiplicity.declared).toBeNull();
      expect(gates.multiplicity.observed).toBeGreaterThan(0);

      // Exactly one lease over the real evaluator, opened once and concluded once,
      // with no exposure incident anywhere.
      const events = readLedgerEvents(scenario.ledgerPath);
      expect(events.map((event) => event.status)).toEqual([
        "started",
        "completed",
      ]);
      expect(page.scoreCalls).toBeGreaterThan(0);
      expect(existsSync(join(scenario.outputDirectory, INCIDENT_FILE))).toBe(
        false,
      );

      // The `started` event is the receipt: its evaluatorDigest is the value that
      // was confirmed against the bytes on disk, not a figure copied from the
      // frozen artifact and never checked.
      const receipt = JSON.parse(
        await readFile(join(scenario.workDirectory, RECEIPT_FILE), "utf8"),
      ) as {
        frozenEvaluatorDigest: string;
        observedEvaluatorDigest: string;
        files: { path: string; digest: string; writable: boolean }[];
        checkedAt: string;
      };
      expect(receipt.observedEvaluatorDigest).toBe(
        receipt.frozenEvaluatorDigest,
      );
      expect(events[0].evaluatorDigest).toBe(receipt.observedEvaluatorDigest);
      expect(receipt.files.length).toBeGreaterThan(0);
      expect(receipt.checkedAt).toBe(FIXED_TIME);

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
    // Same reason as above: the missing C4 plan fails warning gates too, so the
    // decision is reject rather than indicator-only. What this scenario still
    // proves is the part that belongs to it — with no frozen visual threshold the
    // action tier is unavailable, and it is the gates that say so.
    "reports the action tier as unavailable when no visual-action threshold was frozen",
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
      const message = await runConsumeHoldout(
        scenario.options,
        holdoutDeps(scenario, page.createTestPage),
      );
      const gates = JSON.parse(
        await readFile(
          join(scenario.outputDirectory, "gate-report.json"),
          "utf8",
        ),
      ) as GateReportShape;
      expect(gates.decision).toBe("reject");
      expect(message).toBe("HOLDOUT_COMPLETED decision=reject");
      expect(gates.failedAction).toContain("action.available");
      expect(gates.failedIntegrity).toEqual([]);
      // Every warning failure is a missing-evidence failure, not a breach.
      for (const id of gates.failedWarning) {
        const gate = gates.gates.find((candidate) => candidate.id === id);
        expect(gate?.evidence).toMatch(
          /missing-resampling-plan|missing-simultaneous-interval|insufficient-resampling-effort/u,
        );
      }
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
      const message = await runConsumeHoldout(
        scenario.options,
        holdoutDeps(scenario, page.createTestPage),
      );
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

  // ---------------------------------------------------------------------------
  // One use is per BLOCK, and the evaluator is judged before the block is opened.
  // The two live together because a digest confirmed before the lease still leaves
  // the block reconsumable if admission compares the candidate, and a block-level
  // refusal still leaves the numbers to an evaluator nobody checked.
  // ---------------------------------------------------------------------------

  it("refuses the same block under a different candidate, writing no ledger event", async () => {
    const first = await buildScenario(await newRoot(), {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 4,
      negativeTag: "LOW",
    });
    expect(
      await runConsumeHoldout(
        first.options,
        holdoutDeps(first, stubPage(first.status).createTestPage),
      ),
    ).toMatch(/^HOLDOUT_COMPLETED decision=/u);
    const spentLedger = readFileSync(first.ledgerPath, "utf8");

    // Same records and the same split policy, so the same blind material — under a
    // different bundle, which also moves the calibration artifact digest.
    const second = await buildScenario(await newRoot(), {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 4,
      negativeTag: "LOW",
      bundleDigest: hex("bundle-2"),
    });
    expect(second.options.confirmSplitDigest).toBe(
      first.options.confirmSplitDigest,
    );
    const page = stubPage(second.status);
    await expect(
      runConsumeHoldout(
        { ...second.options, ledgerPath: first.ledgerPath },
        holdoutDeps(second, page.createTestPage),
      ),
    ).rejects.toThrow(/holdout block was already consumed/u);

    // Refused before the append and before the candidate went up.
    expect(readFileSync(first.ledgerPath, "utf8")).toBe(spentLedger);
    expect(page.createCalls).toBe(0);
    expect(page.scoreCalls).toBe(0);
  });

  it("opens a fresh lease for a genuinely different block under the same candidate", async () => {
    const first = await buildScenario(await newRoot(), {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 4,
      negativeTag: "LOW",
    });
    await runConsumeHoldout(
      first.options,
      holdoutDeps(first, stubPage(first.status).createTestPage),
    );

    // Different material, so nothing is measured twice. Without this case a guard
    // that refused every second run would look correct.
    const second = await buildScenario(await newRoot(), {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 6,
      testPositives: 4,
      negativeTag: "LOW",
    });
    expect(second.options.confirmSplitDigest).not.toBe(
      first.options.confirmSplitDigest,
    );
    expect(
      await runConsumeHoldout(
        { ...second.options, ledgerPath: first.ledgerPath },
        holdoutDeps(second, stubPage(second.status).createTestPage),
      ),
    ).toMatch(/^HOLDOUT_COMPLETED decision=/u);

    const events = readLedgerEvents(first.ledgerPath);
    expect(events.filter((event) => event.status === "started")).toHaveLength(
      2,
    );
    expect(events.filter((event) => event.status === "completed")).toHaveLength(
      2,
    );
    expect(new Set(events.map((event) => event.consumptionId)).size).toBe(2);
  });

  it("costs nothing when the evaluator already diverges before the lease exists", async () => {
    const root = await newRoot();
    const scenario = await buildScenario(root, {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 4,
      negativeTag: "LOW",
      frozenEvaluatorDigest: hex("stale-evaluator"),
    });
    const page = stubPage(scenario.status);
    expect(
      await rejectionCode(
        runConsumeHoldout(
          scenario.options,
          holdoutDeps(scenario, page.createTestPage),
        ),
      ),
    ).toBe("EVALUATOR_DIGEST_PRE_EXPOSURE_MISMATCH");

    expect(readLedgerEvents(scenario.ledgerPath)).toEqual([]);
    expect(existsSync(join(scenario.workDirectory, ACTIVE_SESSION_FILE))).toBe(
      false,
    );
    expect(existsSync(join(scenario.workDirectory, RECEIPT_FILE))).toBe(false);
    expect(existsSync(scenario.outputDirectory)).toBe(false);
    expect(page.createCalls).toBe(0);
    expect(page.scoreCalls).toBe(0);
  });

  it(
    "turns a mismatch provoked after the shards exist into a terminal exposure with no numbers",
    async () => {
      const scenario = await buildScenario(await newRoot(), {
        scientificUse: "release",
        visualDocument: 0.8,
        realEvaluator: false,
        // Over one shard's worth, so a shard is committed to disk while scoring is
        // still running: the boundary this defends is "before any number exists",
        // not "before the labels are opened".
        testNegatives: 100,
        testPositives: 10,
        negativeTag: "LOW",
        textMarker: "SEGREDO",
        authorMarker: "AUTORSEGREDO",
      });
      const drifted = join(scenario.evaluatorRoot, "benchmark", "gates.ts");
      let mutated = false;
      const page = stubPage(scenario.status, {
        scoreFor: (text) => {
          if (!mutated) {
            mutated = true;
            appendFileSync(drifted, "// drift\n");
          }
          return decode(text);
        },
      });

      expect(
        await rejectionCode(
          runConsumeHoldout(
            scenario.options,
            holdoutDeps(scenario, page.createTestPage),
          ),
        ),
      ).toBe("EVALUATOR_DIGEST_POST_EXPOSURE_MISMATCH");

      // The exposed run does not escape a terminal event.
      const events = readLedgerEvents(scenario.ledgerPath);
      expect(events.map((event) => event.status)).toEqual([
        "started",
        "failed",
      ]);
      expect(events[1].failureCode).toBe("identity-mismatch");
      expect(events[1].consumptionId).toBe(events[0].consumptionId);
      expect(
        existsSync(join(scenario.workDirectory, ACTIVE_SESSION_FILE)),
      ).toBe(false);
      // The run began legitimately, and the receipt is what says so.
      expect(existsSync(join(scenario.workDirectory, RECEIPT_FILE))).toBe(true);
      // No claim was sealed: the evaluator that would have computed it is not the
      // certified one.
      expect(
        existsSync(join(scenario.outputDirectory, "benchmark-report.json")),
      ).toBe(false);
      expect(
        existsSync(join(scenario.outputDirectory, "gate-report.json")),
      ).toBe(false);

      const body = await readFile(
        join(scenario.outputDirectory, INCIDENT_FILE),
        "utf8",
      );
      const incident = JSON.parse(body) as {
        consumptionId: string;
        frozenEvaluatorDigest: string;
        observedEvaluatorDigest: string;
        changedFiles: string[] | null;
        receiptMissing: boolean;
        exposedShardCount: number;
        failureCode: string;
      };
      expect(incident.consumptionId).toBe(events[0].consumptionId);
      expect(incident.failureCode).toBe("identity-mismatch");
      expect(incident.receiptMissing).toBe(false);
      expect(incident.changedFiles).toEqual(["benchmark/gates.ts"]);
      expect(incident.frozenEvaluatorDigest).not.toBe(
        incident.observedEvaluatorDigest,
      );
      // Two shards: one of them was committed before the last document scored.
      expect(incident.exposedShardCount).toBe(2);
      // Published beside the ledger event, so it carries paths and counts only.
      expect(body).not.toMatch(/SEGREDO/u);
      expect(body).not.toMatch(/AUTORSEGREDO/u);
      expect(body).not.toMatch(/[Ss]core/u);
    },
    TIMEOUT_MS,
  );

  it("tells a pre-existing mismatch apart from a provoked one, by the ledger alone", async () => {
    const stale = await buildScenario(await newRoot(), {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 4,
      negativeTag: "LOW",
      frozenEvaluatorDigest: hex("stale-evaluator"),
    });
    await expect(
      runConsumeHoldout(
        stale.options,
        holdoutDeps(stale, stubPage(stale.status).createTestPage),
      ),
    ).rejects.toMatchObject({ code: "EVALUATOR_DIGEST_PRE_EXPOSURE_MISMATCH" });

    const provoked = await buildScenario(await newRoot(), {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 4,
      negativeTag: "LOW",
    });
    const drifted = join(provoked.evaluatorRoot, "benchmark", "report.ts");
    let mutated = false;
    await expect(
      runConsumeHoldout(
        provoked.options,
        holdoutDeps(
          provoked,
          stubPage(provoked.status, {
            scoreFor: (text) => {
              if (!mutated) {
                mutated = true;
                appendFileSync(drifted, "// drift\n");
              }
              return decode(text);
            },
          }).createTestPage,
        ),
      ),
    ).rejects.toMatchObject({
      code: "EVALUATOR_DIGEST_POST_EXPOSURE_MISMATCH",
    });

    // The distinction is in the ledger and nowhere else: nothing at all for the
    // block that was never opened, `started` then `failed(identity-mismatch)` for
    // the block that was.
    expect(readLedgerEvents(stale.ledgerPath)).toEqual([]);
    const provokedEvents = readLedgerEvents(provoked.ledgerPath);
    expect(
      provokedEvents.map((event) => `${event.status}:${event.failureCode}`),
    ).toEqual(["started:null", "failed:identity-mismatch"]);
  });

  it("refuses a resume whose evaluator drifted, and spends nothing on the refusal", async () => {
    const scenario = await buildScenario(await newRoot(), {
      scientificUse: "release",
      visualDocument: 0.8,
      realEvaluator: false,
      testNegatives: 4,
      testPositives: 4,
      negativeTag: "LOW",
    });
    const crashing = stubPage(scenario.status, { throwOnFirstScore: true });
    await expect(
      runConsumeHoldout(
        scenario.options,
        holdoutDeps(scenario, crashing.createTestPage),
      ),
    ).rejects.toThrow(/scorer boom/u);
    const afterCrash = readLedgerEvents(scenario.ledgerPath);
    const consumptionId = afterCrash[0].consumptionId;

    // An editor touches an inventory file between the crash and the resume. A
    // resume rescores everything, so it is fresh exposure and gets the same check.
    appendFileSync(
      join(scenario.evaluatorRoot, "benchmark", "report.ts"),
      "// drift\n",
    );
    const refused = stubPage(scenario.status);
    expect(
      await rejectionCode(
        runConsumeHoldout(
          { ...scenario.options, resumeConsumptionId: consumptionId },
          holdoutDeps(scenario, refused.createTestPage),
        ),
      ),
    ).toBe("EVALUATOR_DIGEST_PRE_EXPOSURE_MISMATCH");
    expect(refused.createCalls).toBe(0);
    expect(refused.scoreCalls).toBe(0);
    // Nothing was spent by the refusal itself: the session is exactly as the crash
    // left it. The BLOCK stays consumed either way — no other candidate can reopen
    // it — so a tree restored to the frozen digest is allowed to finish the run.
    expect(readLedgerEvents(scenario.ledgerPath)).toEqual(afterCrash);

    await writeEvaluatorFixture(scenario.evaluatorRoot);
    const working = stubPage(scenario.status);
    expect(
      await runConsumeHoldout(
        { ...scenario.options, resumeConsumptionId: consumptionId },
        holdoutDeps(scenario, working.createTestPage),
      ),
    ).toMatch(/^HOLDOUT_COMPLETED decision=/u);
    expect(working.scoreCalls).toBeGreaterThan(0);
    const events = readLedgerEvents(scenario.ledgerPath);
    expect(events.filter((event) => event.status === "started")).toHaveLength(
      1,
    );
    expect(events.filter((event) => event.status === "completed")).toHaveLength(
      1,
    );
  });

  // ---------------------------------------------------------------------------
  // The two ways around the pair above, and both are cheaper than what it refuses.
  //
  // A ledger nobody wrote answers "unspent" for every block there is, so the command
  // must refuse an absent `--ledger` rather than create the path it was handed. And
  // the aggregate THROWS on a file it cannot read, so unless the post-exposure check
  // catches that, removing one of the fifty files buys what editing one does not:
  // block spent, nothing terminal, nothing published.
  // ---------------------------------------------------------------------------

  const RELEASE_SCENARIO: ScenarioSpec = {
    scientificUse: "release",
    visualDocument: 0.8,
    realEvaluator: false,
    testNegatives: 4,
    testPositives: 4,
    negativeTag: "LOW",
  };

  it("refuses a release run whose --ledger does not exist, and creates nothing", async () => {
    const root = await newRoot();
    const scenario = await buildScenario(root, RELEASE_SCENARIO);
    // The shape an operator types by hand: a ledger under a private directory that
    // nothing has created yet.
    const absentDirectory = join(root, "unwritten", "private");
    const absentLedger = join(absentDirectory, "holdout-ledger.jsonl");
    const page = stubPage(scenario.status);
    expect(
      await rejectionCode(
        runConsumeHoldout(
          { ...scenario.options, ledgerPath: absentLedger },
          holdoutDeps(scenario, page.createTestPage),
        ),
      ),
    ).toBe("HOLDOUT_LEDGER_ABSENT");

    // Nothing was backfilled: no directory, no ledger, no marker, no receipt, and
    // the candidate never went up. The refusal precedes records.jsonl.
    expect(existsSync(join(root, "unwritten"))).toBe(false);
    expect(existsSync(absentLedger)).toBe(false);
    expect(existsSync(join(scenario.workDirectory, ACTIVE_SESSION_FILE))).toBe(
      false,
    );
    expect(existsSync(join(scenario.workDirectory, RECEIPT_FILE))).toBe(false);
    expect(page.createCalls).toBe(0);
    expect(page.scoreCalls).toBe(0);

    // A missing FILE beside an existing directory is the same refusal: it is the
    // ledger that has to exist, not somewhere to put one.
    expect(
      await rejectionCode(
        runConsumeHoldout(
          {
            ...scenario.options,
            ledgerPath: join(root, "holdout-ledger.jsonl"),
          },
          holdoutDeps(scenario, stubPage(scenario.status).createTestPage),
        ),
      ),
    ).toBe("HOLDOUT_LEDGER_ABSENT");
    expect(existsSync(join(root, "holdout-ledger.jsonl"))).toBe(false);

    // And the refusal is about the ledger, not about the block: the honest path over
    // the very same material still runs. Without this the guard could be refusing
    // everything and still look correct.
    expect(
      await runConsumeHoldout(
        scenario.options,
        holdoutDeps(scenario, stubPage(scenario.status).createTestPage),
      ),
    ).toMatch(/^HOLDOUT_COMPLETED decision=/u);
  });

  it("refuses a --ledger that is a directory", async () => {
    const root = await newRoot();
    const scenario = await buildScenario(root, RELEASE_SCENARIO);
    const asDirectory = join(root, "ledger-as-dir");
    mkdirSync(asDirectory);
    expect(
      await rejectionCode(
        runConsumeHoldout(
          { ...scenario.options, ledgerPath: asDirectory },
          holdoutDeps(scenario, stubPage(scenario.status).createTestPage),
        ),
      ),
    ).toBe("HOLDOUT_LEDGER_ABSENT");
    expect(readLedgerEvents(scenario.ledgerPath)).toEqual([]);
  });

  it("admits a release run over a ledger that exists and holds zero events", async () => {
    const scenario = await buildScenario(await newRoot(), RELEASE_SCENARIO);
    // The decision the guard rests on, pinned: zero bytes is genesis and not
    // truncation, because nothing attests this ledger's height (the exposure ledger's
    // keyring is what lets IT call a short file an attack). Refusing zero bytes would
    // refuse the first honest consumption of every corpus.
    expect(statSync(scenario.ledgerPath).size).toBe(0);
    expect(
      await runConsumeHoldout(
        scenario.options,
        holdoutDeps(scenario, stubPage(scenario.status).createTestPage),
      ),
    ).toMatch(/^HOLDOUT_COMPLETED decision=/u);
    expect(
      readLedgerEvents(scenario.ledgerPath).map((event) => event.status),
    ).toEqual(["started", "completed"]);
  });

  it("lets an infrastructure-only run bring its own ledger into being", async () => {
    const root = await newRoot();
    const scenario = await buildScenario(root, {
      ...RELEASE_SCENARIO,
      scientificUse: "infrastructure-only",
    });
    // A diagnostic run measures nothing that a second measurement could spoil, so it
    // may create a throwaway ledger. Without this case the release/non-release branch
    // would be indistinguishable from an unconditional refusal.
    const freshLedger = join(root, "diagnostic", "holdout-ledger.jsonl");
    await runConsumeHoldout(
      { ...scenario.options, ledgerPath: freshLedger },
      holdoutDeps(scenario, stubPage(scenario.status).createTestPage),
    );
    expect(
      readLedgerEvents(freshLedger).map((event) => event.status),
    ).toContain("started");
  });

  it("refuses before the lease when an inventory file is already unreadable", async () => {
    const scenario = await buildScenario(await newRoot(), RELEASE_SCENARIO);
    rmSync(join(scenario.evaluatorRoot, "benchmark", "gates.ts"));
    const page = stubPage(scenario.status);
    // A digest that cannot be computed is a refusal, never a pass: at this point the
    // block is untouched, so stopping costs only the run.
    expect(
      await rejectionCode(
        runConsumeHoldout(
          scenario.options,
          holdoutDeps(scenario, page.createTestPage),
        ),
      ),
    ).toBe("EVALUATOR_INVENTORY_UNREADABLE");
    expect(readLedgerEvents(scenario.ledgerPath)).toEqual([]);
    expect(existsSync(join(scenario.workDirectory, ACTIVE_SESSION_FILE))).toBe(
      false,
    );
    expect(existsSync(join(scenario.workDirectory, RECEIPT_FILE))).toBe(false);
    expect(existsSync(scenario.outputDirectory)).toBe(false);
    expect(page.createCalls).toBe(0);
    expect(page.scoreCalls).toBe(0);
  });

  it(
    "writes the terminal event even when the exposure incident cannot be written",
    async () => {
      const scenario = await buildScenario(await newRoot(), {
        ...RELEASE_SCENARIO,
        testNegatives: 100,
        testPositives: 10,
      });
      // A directory where the incident file belongs: the atomic rename onto it fails,
      // which is the readable ATTACHMENT failing. The ledger event is the durable
      // half and must already exist by then — written first for exactly this reason.
      mkdirSync(join(scenario.outputDirectory, INCIDENT_FILE), {
        recursive: true,
      });
      const target = join(scenario.evaluatorRoot, "benchmark", "gates.ts");
      let mutated = false;
      await expect(
        runConsumeHoldout(
          scenario.options,
          holdoutDeps(
            scenario,
            stubPage(scenario.status, {
              scoreFor: (text) => {
                if (!mutated) {
                  mutated = true;
                  rmSync(target);
                }
                return decode(text);
              },
            }).createTestPage,
          ),
        ),
      ).rejects.toThrow(/EPERM|EACCES|EISDIR/u);

      const events = readLedgerEvents(scenario.ledgerPath);
      expect(events.map((event) => event.status)).toEqual([
        "started",
        "failed",
      ]);
      expect(events[1].failureCode).toBe("identity-mismatch");
      expect(
        existsSync(join(scenario.workDirectory, ACTIVE_SESSION_FILE)),
      ).toBe(false);
      expect(
        existsSync(join(scenario.outputDirectory, "gate-report.json")),
      ).toBe(false);
    },
    TIMEOUT_MS,
  );

  // Deleting, renaming and replacing-with-a-directory are three ways to say "this
  // file can no longer be read", and each must land where an added byte lands.
  const AFTER_EXPOSURE_TAMPERS: ReadonlyArray<{
    name: string;
    apply: (path: string) => void;
  }> = [
    { name: "deleted", apply: (path) => rmSync(path) },
    { name: "renamed", apply: (path) => renameSync(path, `${path}.moved`) },
    {
      name: "unreadable",
      apply: (path) => {
        // A directory where a file belongs: `readFile` fails on it on every OS this
        // repository runs on, which a chmod would not.
        rmSync(path);
        mkdirSync(path);
      },
    },
  ];

  for (const tamper of AFTER_EXPOSURE_TAMPERS) {
    it(
      `turns an inventory file ${tamper.name} after the shards exist into the same terminal exposure`,
      async () => {
        const scenario = await buildScenario(await newRoot(), {
          scientificUse: "release",
          visualDocument: 0.8,
          realEvaluator: false,
          // Over one shard's worth, so committed shards exist when the tamper lands.
          testNegatives: 100,
          testPositives: 10,
          negativeTag: "LOW",
          textMarker: "SEGREDO",
          authorMarker: "AUTORSEGREDO",
        });
        const target = join(scenario.evaluatorRoot, "benchmark", "gates.ts");
        let mutated = false;
        const page = stubPage(scenario.status, {
          scoreFor: (text) => {
            if (!mutated) {
              mutated = true;
              tamper.apply(target);
            }
            return decode(text);
          },
        });

        expect(
          await rejectionCode(
            runConsumeHoldout(
              scenario.options,
              holdoutDeps(scenario, page.createTestPage),
            ),
          ),
        ).toBe("EVALUATOR_DIGEST_POST_EXPOSURE_MISMATCH");

        // The durable half: a terminal event, and the SAME id the lease opened under.
        const events = readLedgerEvents(scenario.ledgerPath);
        expect(events.map((event) => event.status)).toEqual([
          "started",
          "failed",
        ]);
        expect(events[1].failureCode).toBe("identity-mismatch");
        expect(events[1].consumptionId).toBe(events[0].consumptionId);
        expect(
          existsSync(join(scenario.workDirectory, ACTIVE_SESSION_FILE)),
        ).toBe(false);
        // No claim was sealed.
        expect(
          existsSync(join(scenario.outputDirectory, "benchmark-report.json")),
        ).toBe(false);
        expect(
          existsSync(join(scenario.outputDirectory, "gate-report.json")),
        ).toBe(false);

        // The attachment: it survived a tree it could not hash, and it names the file.
        const body = await readFile(
          join(scenario.outputDirectory, INCIDENT_FILE),
          "utf8",
        );
        const incident = JSON.parse(body) as {
          consumptionId: string;
          observedEvaluatorDigest: string | null;
          changedFiles: string[] | null;
          receiptMissing: boolean;
          exposedShardCount: number;
          failureCode: string;
        };
        expect(incident.consumptionId).toBe(events[0].consumptionId);
        expect(incident.failureCode).toBe("identity-mismatch");
        expect(incident.receiptMissing).toBe(false);
        // The aggregate could not be computed at all, which is reported as `null`
        // rather than as a digest of a tree that no longer exists.
        expect(incident.observedEvaluatorDigest).toBeNull();
        expect(incident.changedFiles).toEqual(["benchmark/gates.ts"]);
        expect(incident.exposedShardCount).toBe(2);
        expect(body).not.toMatch(/SEGREDO/u);
        expect(body).not.toMatch(/AUTORSEGREDO/u);
      },
      TIMEOUT_MS,
    );
  }
});

// ---------------------------------------------------------------------------
// As guardas que `evaluate` aplica ao ARTEFATO DE PREDICAO, dirigidas direto.
//
// `runEvaluate` sela o relatorio de release e fecha o lease, e o CLI o despacha por conta
// propria (`benchmark/cli.ts`), entao um artefato de outra particao ou de outra sessao chega a
// ele por caminho normal, sem passar por `consume-holdout`.
//
// O arnes e barato porque `fitDirectory` sai de `dirname(frozenCalibrationPath)`, e nao do
// diretorio de predicoes: as predicoes podem morar em qualquer lugar.
//
// A ORDEM interna do comando decide o que cada teste precisa montar: particao, sessao declarada
// no manifesto, completude, rotulos, retomada do lease e so entao o selo de governanca. Por isso
// os testes de rotulo nao abrem sessao, e os de governanca abrem.
// ---------------------------------------------------------------------------

describe("evaluate — guardas do artefato de predicao", () => {
  const criados: string[] = [];

  afterEach(async () => {
    await Promise.all(
      criados.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function raiz(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "cf-evaluate-guardas-"));
    criados.push(dir);
    return dir;
  }

  const SPEC: ScenarioSpec = {
    scientificUse: "release",
    visualDocument: 0.8,
    realEvaluator: false,
    testNegatives: 4,
    testPositives: 4,
    negativeTag: "LOW",
  };

  const CONSUMO = "consumo-sob-teste";
  const SHARD = "shard-000.jsonl";

  function opcoes(scenario: Scenario, predicoes: string, consumo = CONSUMO) {
    return {
      datasetDirectory: scenario.options.datasetDirectory,
      splitArtifactPath: scenario.options.splitArtifactPath,
      frozenCalibrationPath: scenario.options.frozenCalibrationPath,
      testPredictionsDirectory: predicoes,
      testLabelsPath: scenario.options.testLabelsPath,
      ledgerPath: scenario.ledgerPath,
      consumptionId: consumo,
      outputDirectory: join(scenario.workDirectory, "saida-sob-teste"),
      bootstrapSeed: scenario.options.bootstrapSeed,
      evaluatorRoot: scenario.evaluatorRoot,
    };
  }

  async function congelado(
    scenario: Scenario,
  ): Promise<FrozenCalibrationArtifact> {
    return JSON.parse(
      await readFile(scenario.options.frozenCalibrationPath, "utf8"),
    ) as FrozenCalibrationArtifact;
  }

  // Um manifesto SEM shard nenhum: valido de forma, e suficiente para as guardas que ficam antes
  // de qualquer comparacao de digest do manifesto — o que permite digest sintetico aqui sem que a
  // recusa venha pelo motivo errado.
  async function escreveManifestoVazio(
    scenario: Scenario,
    override: Partial<PredictionManifestV1>,
  ): Promise<string> {
    const predicoes = join(scenario.workDirectory, "predicoes-sob-teste");
    await mkdir(predicoes, { recursive: true });
    const { splitDigest } = await congelado(scenario);
    const manifesto: PredictionManifestV1 = {
      ...predictionManifest(
        "test",
        hex("dataset-sintetico"),
        splitDigest,
        BUNDLE,
      ),
      holdoutConsumptionId: CONSUMO,
      ...override,
    };
    await writeFile(
      join(predicoes, "manifest.json"),
      `${JSON.stringify(manifesto, null, 2)}\n`,
      "utf8",
    );
    return predicoes;
  }

  // Um artefato COMPLETO: uma predicao por id do `test`, num shard cujo sha256 e computado com a
  // MESMA funcao que o leitor usa. Aqui os digests saem do artefato congelado, porque as guardas
  // alcancadas daqui pra frente ficam DEPOIS das comparacoes de digest.
  async function escrevePredicoes(
    scenario: Scenario,
    override: Partial<PredictionManifestV1> = {},
    extras: { idExtra?: string; consumo?: string } = {},
  ): Promise<string> {
    const frozen = await congelado(scenario);
    const predicoes = join(scenario.workDirectory, "predicoes-completas");
    await mkdir(predicoes, { recursive: true });

    const ids = [...scenario.testIds];
    if (extras.idExtra !== undefined) ids.push(extras.idExtra);
    const corpo = `${ids
      .map((id) =>
        JSON.stringify({
          schemaVersion: 2,
          id,
          status: "scored",
          documentRawScore: 0.9,
          localizedRawScore: 0.9,
          evidenceQuality: "sufficient",
          reasonCode: "SCORED",
          coverage: 1,
          latencyMs: 20,
          memoryBytes: 1000,
        }),
      )
      .join("\n")}\n`;
    await writeFile(join(predicoes, SHARD), corpo, "utf8");

    const manifesto: PredictionManifestV1 = {
      ...predictionManifest(
        "test",
        frozen.datasetDigest,
        frozen.splitDigest,
        frozen.model.bundleDigest,
      ),
      shardCount: 1,
      shards: [
        {
          index: 0,
          file: SHARD,
          sha256: await sha256OfFile(join(predicoes, SHARD)),
          recordCount: ids.length,
        },
      ],
      holdoutConsumptionId: extras.consumo ?? CONSUMO,
      ...override,
    };
    await writeFile(
      join(predicoes, "manifest.json"),
      `${JSON.stringify(manifesto, null, 2)}\n`,
      "utf8",
    );
    return predicoes;
  }

  // Os rotulos sao SINTETICOS, gravados pelo proprio cenario num diretorio temporario. Nada
  // nestes testes le os rotulos reais do `test`.
  async function comRotulos(
    scenario: Scenario,
    transforma: (linhas: string[]) => string[],
  ): Promise<void> {
    const caminho = scenario.options.testLabelsPath;
    const linhas = (await readFile(caminho, "utf8"))
      .split(/\r?\n/u)
      .filter((linha) => linha.trim() !== "");
    await writeFile(caminho, `${transforma(linhas).join("\n")}\n`, "utf8");
  }

  async function abreSessao(scenario: Scenario): Promise<string> {
    const frozen = await congelado(scenario);
    const artifact = JSON.parse(
      await readFile(scenario.options.splitArtifactPath, "utf8"),
    ) as SplitArtifact;
    const sessao = await beginHoldoutConsumption(
      scenario.ledgerPath,
      buildIdentity(frozen, artifact),
      FIXED_TIME,
      { activeSessionPath: join(scenario.workDirectory, ACTIVE_SESSION_FILE) },
    );
    return sessao.consumptionId;
  }

  it(
    "refuses a prediction artifact that declares another partition",
    async () => {
      // Duas amarras do esquema estreitam a forja possivel: as particoes de pontuacao sao
      // `dev`/`cal-A`/`test` (o modulo mantem enumeracao PROPRIA, para poder discordar do
      // splitter), e fora do `test` o `holdoutConsumptionId` tem de ser nulo. Logo o unico
      // artefato de outra particao que chega a esta guarda e um `dev` sem sessao.
      const scenario = await buildScenario(await raiz(), SPEC);
      const predicoes = await escreveManifestoVazio(scenario, {
        partition: "dev",
        holdoutConsumptionId: null,
      });
      expect(
        await rejectionCode(runEvaluate(opcoes(scenario, predicoes))),
      ).toBe("TEST_PARTITION_EXPECTED");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a test artifact sealed under another consumption id",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      const predicoes = await escreveManifestoVazio(scenario, {
        holdoutConsumptionId: "outra-sessao-qualquer",
      });
      expect(
        await rejectionCode(runEvaluate(opcoes(scenario, predicoes))),
      ).toBe("HOLDOUT_SESSION_MISMATCH");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a test artifact that covers only part of the partition",
    async () => {
      // Nenhuma predicao cobre nenhum id do `test`: o caso extremo da selecao que melhora FPR,
      // pontuar um subconjunto e relatar como se fosse a particao.
      const scenario = await buildScenario(await raiz(), SPEC);
      const predicoes = await escreveManifestoVazio(scenario, {});
      expect(
        await rejectionCode(runEvaluate(opcoes(scenario, predicoes))),
      ).toBe("TEST_COMPLETENESS_FAILED");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a prediction for an id outside the partition, by completeness",
    async () => {
      // A completude compara CONJUNTOS, entao um id a mais e recusado aqui. E por isso que
      // `PREDICTION_UNKNOWN_ID`, logo adiante, nao tem estado alcancavel: para chegar la o
      // conjunto predito teria de ser exatamente o do `test` e ainda conter um id sem registro,
      // e `validateSplitArtifact` amarra cada assignment a um registro do dataset.
      const scenario = await buildScenario(await raiz(), SPEC);
      const predicoes = await escrevePredicoes(
        scenario,
        {},
        { idExtra: "id-que-nao-pertence-ao-test" },
      );
      expect(
        await rejectionCode(runEvaluate(opcoes(scenario, predicoes))),
      ).toBe("TEST_COMPLETENESS_FAILED");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a labels file holding a line that is not JSON",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      const predicoes = await escrevePredicoes(scenario);
      await comRotulos(scenario, (linhas) => [...linhas, "isto nao e json"]);
      expect(
        await rejectionCode(runEvaluate(opcoes(scenario, predicoes))),
      ).toBe("TEST_LABELS_INVALID");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a labels file naming the same id twice",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      const predicoes = await escrevePredicoes(scenario);
      await comRotulos(scenario, (linhas) => [...linhas, linhas[0]]);
      expect(
        await rejectionCode(runEvaluate(opcoes(scenario, predicoes))),
      ).toBe("TEST_LABELS_DUPLICATE");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a labels file that leaves a test id unlabelled",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      const predicoes = await escrevePredicoes(scenario);
      await comRotulos(scenario, (linhas) => linhas.slice(1));
      expect(
        await rejectionCode(runEvaluate(opcoes(scenario, predicoes))),
      ).toBe("TEST_LABELS_INCOMPLETE");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a label that disagrees with the dataset record",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      const predicoes = await escrevePredicoes(scenario);
      await comRotulos(scenario, (linhas) => {
        const entradas = linhas.map(
          (linha) => JSON.parse(linha) as { id: string; label: string },
        );
        // O outro rotulo vem do PROPRIO arquivo, para a divergencia ser entre valores do
        // dominio em vez de uma string inventada, que cairia na guarda de forma.
        const outro = entradas.find(
          (entrada) => entrada.label !== entradas[0].label,
        );
        expect(outro).toBeDefined();
        return [
          JSON.stringify({ id: entradas[0].id, label: outro?.label }),
          ...linhas.slice(1),
        ];
      });
      expect(
        await rejectionCode(runEvaluate(opcoes(scenario, predicoes))),
      ).toBe("TEST_LABELS_DIVERGENT");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a manifest declaring a backend the frozen run did not use",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      const consumo = await abreSessao(scenario);
      const predicoes = await escrevePredicoes(
        scenario,
        { backend: "webgpu" },
        { consumo },
      );
      expect(
        await rejectionCode(runEvaluate(opcoes(scenario, predicoes, consumo))),
      ).toBe("OBSERVED_BACKEND_INVALID");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a Chrome the frozen run did not use",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      // Os dois lados desta comparacao estao pinados: o manifesto de release pelo parser, em
      // runtime, e o artefato congelado pelo proprio TIPO, que fixa `chromeVersion` no literal
      // do release. O estado so existe num ARQUIVO adulterado, e a forja tem de ser re-selada
      // porque `artifactDigest` cobre o artefato sem ele.
      const caminho = scenario.options.frozenCalibrationPath;
      const bruto = JSON.parse(await readFile(caminho, "utf8")) as Record<
        string,
        unknown
      >;
      delete bruto.artifactDigest;
      const adulterado = {
        ...bruto,
        scoringRuntime: {
          ...(bruto.scoringRuntime as Record<string, unknown>),
          chromeVersion: "999.0.0.0",
        },
      };
      await writeFile(
        caminho,
        `${JSON.stringify(
          { ...adulterado, artifactDigest: await canonicalSha256(adulterado) },
          null,
          2,
        )}\n`,
        "utf8",
      );
      // A sessao abre DEPOIS da forja: `chromeVersion` entra na tupla de identidade, entao uma
      // sessao aberta antes divergiria na retomada e o teste provaria a guarda vizinha.
      const consumo = await abreSessao(scenario);
      const predicoes = await escrevePredicoes(scenario, {}, { consumo });
      expect(
        await rejectionCode(runEvaluate(opcoes(scenario, predicoes, consumo))),
      ).toBe("OBSERVED_CHROME_INVALID");
    },
    TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// `validate-predictions`: as seis recusas do comando que amarra o artefato de predicao ao
// dataset, ao split e a paridade de runtime.
//
// A auditoria por mutacao mediu 0 de 6. O fecho daquele modulo tem duas suites — `cli` e
// `cluster-exposure-ledger` — e nenhuma o dirige: a `cli` o alcanca na validacao de bandeiras.
//
// A ORDEM interna decide o que cada teste precisa ter valido: particao, dataset, split,
// paridade, completude e so entao a sessao de holdout. Por isso as duas ultimas exigem um mundo
// inteiro coerente, e as tres primeiras nao.
// ---------------------------------------------------------------------------

describe("validate-predictions — as seis recusas", () => {
  const criados: string[] = [];

  afterEach(async () => {
    await Promise.all(
      criados.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function raiz(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "cf-validate-predicoes-"));
    criados.push(dir);
    return dir;
  }

  const SPEC: ScenarioSpec = {
    scientificUse: "release",
    visualDocument: 0.8,
    realEvaluator: false,
    testNegatives: 4,
    testPositives: 4,
    negativeTag: "LOW",
  };
  const SHARD = "shard-000.jsonl";
  const CONSUMO = "consumo-validate-predicoes";

  // Um manifesto de paridade COERENTE: o digest sai de `computeRuntimeParityDigest` sobre os oito
  // campos, e nao de constante. Fixar um hex a mao daria um manifesto que o parser recusa, e o
  // teste mediria o parser em vez da guarda.
  async function paridadeCoerente(
    scenario: Scenario,
  ): Promise<{ caminho: string; digest: string }> {
    const base = {
      schemaVersion: 1 as const,
      modelId: MODEL_ID,
      modelVersion: MODEL_VERSION,
      bundleDigest: BUNDLE,
      aggregationVersion: AGGREGATION,
      contentCompositionVersion: COMPOSITION,
      tokenizerDigest: TOKENIZER,
      inferenceCoreDigest: hex("inference-core"),
    };
    const digest = await computeRuntimeParityDigest(base);
    const caminho = join(scenario.workDirectory, "runtime-parity.json");
    await writeFile(
      caminho,
      `${JSON.stringify({ ...base, runtimeParityDigest: digest }, null, 2)}\n`,
      "utf8",
    );
    return { caminho, digest };
  }

  async function predicoesDoTest(
    scenario: Scenario,
    override: Partial<PredictionManifestV1> = {},
  ): Promise<string> {
    const frozen = JSON.parse(
      await readFile(scenario.options.frozenCalibrationPath, "utf8"),
    ) as FrozenCalibrationArtifact;
    const dir = join(scenario.workDirectory, "predicoes-validadas");
    await mkdir(dir, { recursive: true });
    const corpo = `${scenario.testIds
      .map((id) =>
        JSON.stringify({
          schemaVersion: 2,
          id,
          status: "scored",
          documentRawScore: 0.9,
          localizedRawScore: 0.9,
          evidenceQuality: "sufficient",
          reasonCode: "SCORED",
          coverage: 1,
          latencyMs: 20,
          memoryBytes: 1000,
        }),
      )
      .join("\n")}\n`;
    await writeFile(join(dir, SHARD), corpo, "utf8");
    const manifesto: PredictionManifestV1 = {
      ...predictionManifest(
        "test",
        frozen.datasetDigest,
        frozen.splitDigest,
        frozen.model.bundleDigest,
      ),
      shardCount: 1,
      shards: [
        {
          index: 0,
          file: SHARD,
          sha256: await sha256OfFile(join(dir, SHARD)),
          recordCount: scenario.testIds.length,
        },
      ],
      holdoutConsumptionId: CONSUMO,
      ...override,
    };
    await writeFile(
      join(dir, "manifest.json"),
      `${JSON.stringify(manifesto, null, 2)}\n`,
      "utf8",
    );
    return dir;
  }

  function opcoes(
    scenario: Scenario,
    predicoes: string,
    paridade: string,
    extra: Record<string, unknown> = {},
  ) {
    return {
      datasetDirectory: scenario.options.datasetDirectory,
      splitArtifactPath: scenario.options.splitArtifactPath,
      partition: "test" as const,
      predictionsDirectory: predicoes,
      runtimeParityPath: paridade,
      ...extra,
    };
  }

  it(
    "refuses a shard whose bytes do not hash to the manifest",
    async () => {
      // Guarda de `commands/io.ts`, no leitor que TODO consumidor de predicao usa. O manifesto
      // declara um sha256 e os bytes sao outros: sem esta recusa, um shard trocado depois da
      // selagem passaria por todos os comandos rio abaixo.
      const scenario = await buildScenario(await raiz(), SPEC);
      const { caminho } = await paridadeCoerente(scenario);
      const predicoes = await predicoesDoTest(scenario);
      const manifesto = JSON.parse(
        await readFile(join(predicoes, "manifest.json"), "utf8"),
      ) as PredictionManifestV1;
      manifesto.shards[0].sha256 = "a".repeat(64);
      await writeFile(
        join(predicoes, "manifest.json"),
        `${JSON.stringify(manifesto, null, 2)}\n`,
        "utf8",
      );
      expect(
        await rejectionCode(
          runValidatePredictions(opcoes(scenario, predicoes, caminho)),
        ),
      ).toBe("SHARD_DIGEST_MISMATCH");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a file that is not valid JSON, naming the file",
    async () => {
      // A outra guarda de `io.ts`: o leitor de JSON. Qualquer insumo serve para alcanca-la, e o
      // manifesto de paridade e o mais barato de corromper sem tocar em digest algum.
      const scenario = await buildScenario(await raiz(), SPEC);
      const { caminho } = await paridadeCoerente(scenario);
      const predicoes = await predicoesDoTest(scenario);
      await writeFile(caminho, "{ isto nao fecha", "utf8");
      expect(
        await rejectionCode(
          runValidatePredictions(opcoes(scenario, predicoes, caminho)),
        ),
      ).toBe("JSON_INVALID");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses an artifact that declares another partition",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      const { caminho } = await paridadeCoerente(scenario);
      const predicoes = await predicoesDoTest(scenario);
      expect(
        await rejectionCode(
          runValidatePredictions({
            ...opcoes(scenario, predicoes, caminho),
            partition: "dev",
          }),
        ),
      ).toBe("PREDICTION_PARTITION_MISMATCH");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses an artifact whose datasetDigest is not the split artifact's",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      const { caminho } = await paridadeCoerente(scenario);
      const predicoes = await predicoesDoTest(scenario, {
        datasetDigest: hex("outro-dataset"),
      });
      expect(
        await rejectionCode(
          runValidatePredictions(opcoes(scenario, predicoes, caminho)),
        ),
      ).toBe("PREDICTION_DATASET_MISMATCH");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses an artifact whose splitDigest is not the split artifact's",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      const { caminho } = await paridadeCoerente(scenario);
      const predicoes = await predicoesDoTest(scenario, {
        splitDigest: hex("outro-split"),
      });
      expect(
        await rejectionCode(
          runValidatePredictions(opcoes(scenario, predicoes, caminho)),
        ),
      ).toBe("PREDICTION_SPLIT_MISMATCH");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses an artifact scored under another runtime parity",
    async () => {
      // O manifesto de predicao declara o `PARITY` do cenario; o de paridade e coerente e portanto
      // declara OUTRO digest. A divergencia e entre dois artefatos validos, que e a unica forma de
      // provar esta guarda em vez do parser.
      const scenario = await buildScenario(await raiz(), SPEC);
      const { caminho } = await paridadeCoerente(scenario);
      const predicoes = await predicoesDoTest(scenario);
      expect(
        await rejectionCode(
          runValidatePredictions(opcoes(scenario, predicoes, caminho)),
        ),
      ).toBe("RUNTIME_PARITY_MISMATCH");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses test predictions with no ledger and no consumption id",
    async () => {
      // Daqui em diante o mundo tem de ser coerente ATE a completude, senao a recusa vem de uma
      // guarda anterior: a paridade do manifesto passa a ser a computada.
      const scenario = await buildScenario(await raiz(), SPEC);
      const { caminho, digest } = await paridadeCoerente(scenario);
      const predicoes = await predicoesDoTest(scenario, {
        runtimeParityDigest: digest,
      });
      expect(
        await rejectionCode(
          runValidatePredictions(opcoes(scenario, predicoes, caminho)),
        ),
      ).toBe("HOLDOUT_SESSION_REQUIRED");
    },
    TIMEOUT_MS,
  );

  it(
    "refuses test predictions sealed under another consumption id",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      const { caminho, digest } = await paridadeCoerente(scenario);
      const predicoes = await predicoesDoTest(scenario, {
        runtimeParityDigest: digest,
        holdoutConsumptionId: "outra-sessao",
      });
      expect(
        await rejectionCode(
          runValidatePredictions(
            opcoes(scenario, predicoes, caminho, {
              ledgerPath: scenario.ledgerPath,
              consumptionId: CONSUMO,
            }),
          ),
        ),
      ).toBe("HOLDOUT_SESSION_MISMATCH");
    },
    TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// As duas recusas de `consume-holdout` que a auditoria mediu sem teste.
// ---------------------------------------------------------------------------

describe("consume-holdout — confirmacao do split e forma do test-input", () => {
  const criados: string[] = [];

  afterEach(async () => {
    await Promise.all(
      criados.splice(0).map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function raiz(): Promise<string> {
    const dir = await mkdtemp(join(tmpdir(), "cf-consume-duas-"));
    criados.push(dir);
    return dir;
  }

  const SPEC: ScenarioSpec = {
    scientificUse: "release",
    visualDocument: 0.8,
    realEvaluator: false,
    testNegatives: 4,
    testPositives: 4,
    negativeTag: "LOW",
  };

  it(
    "refuses a fresh run with no split-digest confirmation",
    async () => {
      // A confirmacao e conferida ANTES de qualquer byte do ledger, e e isso que a torna barata:
      // uma confirmacao errada nunca consome o holdout. Sem ela o operador abriria o lease sem
      // ter declarado sobre qual split esta apostando.
      const scenario = await buildScenario(await raiz(), SPEC);
      expect(
        await rejectionCode(
          runConsumeHoldout(
            { ...scenario.options, confirmSplitDigest: undefined },
            holdoutDeps(scenario, stubPage(scenario.status).createTestPage),
          ),
        ),
      ).toBe("SPLIT_DIGEST_CONFIRMATION_REQUIRED");
      // E nada foi ESCRITO no ledger. O arquivo existe porque o cenario o cria; o que a guarda
      // impede e o EVENTO — sem esta assercao o teste nao distinguiria "recusou antes de abrir o
      // lease" de "recusou depois de abrir".
      expect(readLedgerEvents(scenario.ledgerPath)).toEqual([]);
    },
    TIMEOUT_MS,
  );

  it(
    "refuses a test-input line that is not an object with id and text",
    async () => {
      const scenario = await buildScenario(await raiz(), SPEC);
      const original = await readFile(scenario.options.testInputPath, "utf8");
      await writeFile(
        scenario.options.testInputPath,
        `${original}{"id":"sem-texto"}\n`,
        "utf8",
      );
      expect(
        await rejectionCode(
          runConsumeHoldout(
            scenario.options,
            holdoutDeps(scenario, stubPage(scenario.status).createTestPage),
          ),
        ),
      ).toBe("TEST_INPUT_INVALID");
    },
    TIMEOUT_MS,
  );
});
