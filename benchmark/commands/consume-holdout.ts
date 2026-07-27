// `consume-holdout`: the Phase 3 orchestrator that spends the ONE-WAY temporal
// holdout lease exactly once and issues an auditable release decision.
//
// The lease is irreversible. This command opens the Phase 2 append-only ledger
// session EXACTLY ONCE (after confirming `--confirm-split-digest` against the
// frozen `SplitArtifact.splitDigest`), browser-scores the sealed test partition
// under that active consumption through the scorer's internal test entry point,
// validates completeness, then DELEGATES the scientific decision byte-for-byte
// to the Phase 2 `evaluate`/gates. It never restates gate policy and never calls
// fit code after the consumption has started.
//
// One-way semantics, enforced by the Phase 2 ledger primitives:
//   - The first `started` event consumes the tuple even if the process later
//     crashes; a plain crash leaves the lease `started` for `--resume`.
//   - `--resume-consumption` reopens ONLY the same id under the identical tuple;
//     it can never mint a new id, and a fresh run of a consumed tuple is refused.
//   - A recognized irrecoverable failure (a candidate that fails identity/parity
//     verification, or an invalid shard set) is declared via
//     `failHoldoutConsumption`; `completed` and `failed` are terminal and stay
//     consumed. Deleting or resetting a ledger is unsupported.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import {
  BrowserScorerError,
  runHoldoutTestScore,
  type BenchmarkPage,
  type BenchmarkScoreItem,
  type HoldoutTestScoreIdentity,
  type ModelBenchmarkScoreV1,
  type ModelBenchmarkStatusV1,
} from "../browser-scorer.ts";
import {
  validateFrozenCalibrationArtifact,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import { validateDatasetManifest } from "../dataset-manifest.ts";
import type { ReleaseDecision } from "../gates.ts";
import {
  beginHoldoutConsumption,
  failHoldoutConsumption,
  resumeHoldoutConsumption,
  type HoldoutConsumption,
  type HoldoutFailureCode,
  type HoldoutIdentity,
} from "../holdout-ledger.ts";
import {
  assertPredictionCompleteness,
  PredictionSchemaError,
} from "../prediction-schema.ts";
import {
  createPredictionShardStore,
  PredictionShardError,
} from "../prediction-shards.ts";
import { parseBenchmarkDataset } from "../schema.ts";
import {
  validateSplitArtifact,
  type SplitArtifact,
} from "../split-artifact.ts";
import { runEvaluate } from "./evaluate.ts";
import {
  CommandError,
  readJsonFile,
  readPredictionArtifact,
  readTextFile,
  writeJsonAtomic,
} from "./io.ts";

import type { Page } from "playwright";

export interface ConsumeHoldoutOptions {
  datasetDirectory: string;
  splitArtifactPath: string;
  frozenCalibrationPath: string;
  ledgerPath: string;
  candidateExtensionDir: string;
  /** Working directory holding the active-session marker and test shards. */
  workDirectory: string;
  outputDirectory: string;
  bootstrapSeed: number;
  /** Sealed opaque-id + text test corpus (private). */
  testInputPath: string;
  /** Sealed private test labels. */
  testLabelsPath: string;
  /** Required to OPEN a fresh consumption; verified against the split digest. */
  confirmSplitDigest?: string;
  /** Reopen the SAME started lease after an unexpected crash (never a new id). */
  resumeConsumptionId?: string;
}

/** An opened candidate page and its teardown. */
export interface ConsumeHoldoutTestPage {
  page: BenchmarkPage;
  close: () => Promise<void>;
}

export interface ConsumeHoldoutDeps {
  /** Deterministic clock; defaults to wall-clock ISO time. */
  now?: () => string;
  /**
   * Opens the candidate page that scores the test partition. Defaults to the
   * real locked Chrome for Testing launch (the deferred operator path); tests
   * inject a page over an in-memory scorer.
   */
  createTestPage?: (
    candidateExtensionDir: string,
  ) => Promise<ConsumeHoldoutTestPage>;
}

/**
 * Consumes the temporal holdout exactly once and returns the sole line the
 * operator reads: `HOLDOUT_COMPLETED decision=pass|indicator-only|reject`. The
 * decision is whatever the Phase 2 gates sealed — never recomputed here.
 */
export async function runConsumeHoldout(
  options: ConsumeHoldoutOptions,
  deps: ConsumeHoldoutDeps = {},
): Promise<string> {
  const now = deps.now ?? ((): string => new Date().toISOString());
  const createTestPage = deps.createTestPage ?? defaultCreateTestPage;

  const manifest = validateDatasetManifest(
    await readJsonFile(join(options.datasetDirectory, "manifest.json")),
  );
  const records = parseBenchmarkDataset(
    await readTextFile(join(options.datasetDirectory, "records.jsonl")),
  );
  const artifact = (await readJsonFile(
    options.splitArtifactPath,
  )) as SplitArtifact;
  await validateSplitArtifact(artifact, manifest, records);

  const frozen = (await readJsonFile(
    options.frozenCalibrationPath,
  )) as FrozenCalibrationArtifact;
  validateFrozenCalibrationArtifact(frozen);

  // The FULL scientific tuple the lease binds — identical to the one evaluate
  // re-verifies on resume, so the begin here and the resume there agree exactly.
  const identity = buildIdentity(frozen, artifact);
  const activeSessionPath = join(options.workDirectory, "active-session.json");

  await mkdir(options.workDirectory, { recursive: true });
  await mkdir(dirname(options.ledgerPath), { recursive: true });

  // Open (or reopen) the single atomic session. On a fresh run the split-digest
  // confirmation is checked FIRST, before any ledger byte is written, so a wrong
  // confirmation can never consume the holdout.
  let session: HoldoutConsumption;
  if (options.resumeConsumptionId !== undefined) {
    session = await resumeHoldoutConsumption(
      options.ledgerPath,
      options.resumeConsumptionId,
      identity,
    );
  } else {
    if (options.confirmSplitDigest === undefined) {
      throw new CommandError(
        "SPLIT_DIGEST_CONFIRMATION_REQUIRED",
        "a fresh consume-holdout run requires --confirm-split-digest",
      );
    }
    if (options.confirmSplitDigest !== artifact.splitDigest) {
      throw new CommandError(
        "SPLIT_DIGEST_CONFIRMATION_MISMATCH",
        "--confirm-split-digest does not match the frozen split artifact splitDigest",
      );
    }
    session = await beginHoldoutConsumption(
      options.ledgerPath,
      identity,
      now(),
      { activeSessionPath },
    );
  }

  const testPredictionsDirectory = join(
    options.workDirectory,
    "predictions",
    "test",
  );
  const testIds = artifact.assignments
    .filter((assignment) => assignment.partition === "test")
    .map((assignment) => assignment.id);

  // Score + validate under the active lease. A recognized irrecoverable fault is
  // declared terminal (`failed`); anything else propagates and leaves the lease
  // `started` so the exact `--resume-consumption` form can retry it.
  try {
    const items = await readTestInput(options.testInputPath);
    const store = createPredictionShardStore({
      directory: testPredictionsDirectory,
      createdAt: now(),
    });
    const scoreIdentity = buildScoreIdentity(frozen, artifact);
    const handle = await createTestPage(options.candidateExtensionDir);
    let scored;
    try {
      scored = await runHoldoutTestScore({
        consumption: session,
        identity: scoreIdentity,
        page: handle.page,
        store,
        items,
      });
    } finally {
      await handle.close();
    }
    // Materialize the artifact the Phase 2 evaluate reads (`manifest.json`
    // alongside the shard files the store already wrote).
    await writeJsonAtomic(
      join(testPredictionsDirectory, "manifest.json"),
      scored,
    );
    const { predictions } = await readPredictionArtifact(
      testPredictionsDirectory,
      { scientificUse: "release" },
    );
    // Missing, extra or duplicate ids are a hard failure — no scientific
    // decision. Individual `error` rows are valid, complete observations.
    assertPredictionCompleteness(testIds, predictions);
  } catch (error) {
    const failureCode = classifyIrrecoverable(error);
    if (failureCode !== null) {
      await failHoldoutConsumption(
        options.ledgerPath,
        session.consumptionId,
        identity,
        failureCode,
        now(),
        { activeSessionPath },
      );
    }
    throw error;
  }

  // Delegate metrics, slices, the gate report and the terminal `completed`
  // ledger event to the frozen Phase 2 evaluator under the SAME consumption id.
  await runEvaluate({
    datasetDirectory: options.datasetDirectory,
    splitArtifactPath: options.splitArtifactPath,
    frozenCalibrationPath: options.frozenCalibrationPath,
    testPredictionsDirectory,
    testLabelsPath: options.testLabelsPath,
    ledgerPath: options.ledgerPath,
    consumptionId: session.consumptionId,
    outputDirectory: options.outputDirectory,
    bootstrapSeed: options.bootstrapSeed,
  });

  const gateReport = (await readJsonFile(
    join(options.outputDirectory, "gate-report.json"),
  )) as { decision: ReleaseDecision };
  return `HOLDOUT_COMPLETED decision=${gateReport.decision}`;
}

// The scientific tuple that identifies the lease — byte-for-byte the identity
// `evaluate` rebuilds from the same frozen calibration and split artifact.
function buildIdentity(
  frozen: FrozenCalibrationArtifact,
  artifact: SplitArtifact,
): HoldoutIdentity {
  return {
    datasetDigest: artifact.datasetDigest,
    datasetAuditDigest: frozen.datasetAuditDigest,
    sourceReadinessDigest: frozen.sourceReadinessDigest,
    splitDigest: artifact.splitDigest,
    modelId: frozen.model.modelId,
    modelVersion: frozen.model.modelVersion,
    bundleDigest: frozen.model.bundleDigest,
    aggregationVersion: frozen.model.aggregationVersion,
    contentCompositionVersion: frozen.model.contentCompositionVersion,
    tokenizerDigest: frozen.model.tokenizerDigest,
    runtimeParityDigest: frozen.scoringRuntime.runtimeParityDigest,
    extensionBuildDigest: frozen.scoringRuntime.extensionBuildDigest,
    backend: "wasm",
    chromeVersion: frozen.scoringRuntime.chromeVersion,
    evaluatorDigest: frozen.evaluatorDigest,
    calibrationArtifactDigest: frozen.artifactDigest,
  };
}

// The identity the test partition is scored under: the frozen model/runtime plus
// the split's dataset/split digests, so the emitted test manifest matches the
// frozen governance seal by construction.
function buildScoreIdentity(
  frozen: FrozenCalibrationArtifact,
  artifact: SplitArtifact,
): HoldoutTestScoreIdentity {
  return {
    datasetDigest: artifact.datasetDigest,
    splitDigest: artifact.splitDigest,
    modelId: frozen.model.modelId,
    modelVersion: frozen.model.modelVersion,
    bundleDigest: frozen.model.bundleDigest,
    aggregationVersion: frozen.model.aggregationVersion,
    contentCompositionVersion: frozen.model.contentCompositionVersion,
    tokenizerDigest: frozen.model.tokenizerDigest,
    runtimeParityDigest: frozen.scoringRuntime.runtimeParityDigest,
    extensionBuildDigest: frozen.scoringRuntime.extensionBuildDigest,
  };
}

// Only these faults are declared terminal `failed`. A candidate that fails
// identity/parity/backend/tokenizer verification is a chrome-verification
// failure; an invalid or incomplete shard set is a shard-invalid failure.
// Everything else (an unexpected scorer death, an evaluate governance error) is
// NOT declared here — it leaves the lease `started` for `--resume-consumption`.
function classifyIrrecoverable(error: unknown): HoldoutFailureCode | null {
  if (error instanceof BrowserScorerError) return "chrome-verification-failed";
  if (
    error instanceof PredictionShardError ||
    error instanceof PredictionSchemaError
  ) {
    return "shard-invalid";
  }
  return null;
}

// Reads the sealed test corpus: one `{ id, text }` per line. Text never leaves
// this process — it is scored and discarded, never stored in a prediction row.
async function readTestInput(path: string): Promise<BenchmarkScoreItem[]> {
  const text = await readTextFile(path);
  const items: BenchmarkScoreItem[] = [];
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new CommandError(
        "TEST_INPUT_INVALID",
        `test input line ${index + 1} is not valid JSON`,
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { id?: unknown }).id !== "string" ||
      typeof (parsed as { text?: unknown }).text !== "string"
    ) {
      throw new CommandError(
        "TEST_INPUT_INVALID",
        `test input line ${index + 1} must be { id, text }`,
      );
    }
    const { id, text: body } = parsed as { id: string; text: string };
    items.push({ id, text: body });
  });
  return items;
}

// --- default operator path: the locked Chrome for Testing launch -----------
// Only used when no page is injected (the deferred Step 8 real consumption). The
// Vitest suite always injects a page over an in-memory scorer, so this launch is
// exercised only by the live operator run, never by the unit tests.

const CANDIDATE_PAGE = "model-benchmark.html";
const CANDIDATE_GLOBAL = "__cleanfeedModelBenchmark";
/** Cold WASM start for the pinned bundle; see runScore for the rationale. */
const CANDIDATE_READY_TIMEOUT_MS = 300_000;

interface CandidatePageApi {
  status: ModelBenchmarkStatusV1;
  score(text: string): Promise<ModelBenchmarkScoreV1>;
}

async function defaultCreateTestPage(
  candidateExtensionDir: string,
): Promise<ConsumeHoldoutTestPage> {
  const { chromium } = await import("playwright");
  const {
    resolveLockedTestBrowser,
    loadTestBrowserLock,
    assertLockedBrowserVersion,
  } = await import("../../scripts/test-browser-lock.mjs");

  const candidateDir = resolve(candidateExtensionDir);
  const lock = await loadTestBrowserLock();
  const resolved = await resolveLockedTestBrowser(lock);
  const context = await chromium.launchPersistentContext("", {
    headless: true,
    executablePath: resolved.executablePath,
    args: [
      `--disable-extensions-except=${candidateDir}`,
      `--load-extension=${candidateDir}`,
    ],
  });
  try {
    assertLockedBrowserVersion(
      (await context.browser()?.version()) ?? "",
      lock,
    );
    await context.route("**/*", (route) => {
      const url = route.request().url();
      if (url.startsWith("http:") || url.startsWith("https:")) {
        void route.abort();
        return;
      }
      void route.continue();
    });
    const [existing] = context.serviceWorkers();
    const worker = existing ?? (await context.waitForEvent("serviceworker"));
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    await openHoldoutCandidatePage(page, extensionId);
    const benchmarkPage: BenchmarkPage = {
      status(): Promise<ModelBenchmarkStatusV1> {
        return page.evaluate((globalName) => {
          const api = (
            globalThis as unknown as Record<
              string,
              CandidatePageApi | undefined
            >
          )[globalName];
          if (api === undefined) {
            throw new Error("candidate benchmark API is unavailable");
          }
          return api.status;
        }, CANDIDATE_GLOBAL);
      },
      score(text: string): Promise<ModelBenchmarkScoreV1> {
        return page.evaluate(
          ([globalName, input]) => {
            const api = (
              globalThis as unknown as Record<
                string,
                CandidatePageApi | undefined
              >
            )[globalName];
            if (api === undefined) {
              throw new Error("candidate benchmark API is unavailable");
            }
            return api.score(input);
          },
          [CANDIDATE_GLOBAL, text] as const,
        );
      },
    };
    return { page: benchmarkPage, close: () => context.close() };
  } catch (error) {
    await context.close();
    throw error;
  }
}

/**
 * Navigates the one-way holdout driver and waits until the candidate has
 * published its terminal API. Kept separate from the score path so a regression
 * in either browser driver is detected independently.
 */
export async function openHoldoutCandidatePage(
  page: Pick<Page, "goto" | "waitForFunction">,
  extensionId: string,
): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/${CANDIDATE_PAGE}`);
  // The candidate publishes its API only once model assembly reaches a
  // TERMINAL outcome, so the global does not exist at navigation time — a 106M
  // ONNX bundle takes tens of seconds under WASM. Racing it reads as
  // "candidate benchmark API is unavailable", which on THIS path costs a
  // resume of the one-way holdout lease.
  await page.waitForFunction(
    (globalName) => globalName in globalThis,
    CANDIDATE_GLOBAL,
    { timeout: CANDIDATE_READY_TIMEOUT_MS },
  );
}
