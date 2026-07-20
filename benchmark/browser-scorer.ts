// The Node-side browser scorer: it drives the isolated candidate extension in a
// locked Chrome for Testing, maps every page response to a strict prediction row
// and never recomputes a committed id. It owns the run identity (`BrowserScoreRun`
// carries every scientific field exactly once, WITHOUT a nested RuntimeModel
// identity) and the store contract (`PredictionShardStore`).
//
// It compares every identity and parity field of the page's `ModelBenchmarkStatusV1`
// (embedded at build time) to the run (derived from the emitted runtime-parity
// manifest) BEFORE sending any corpus text, so an embedded/emitted drift or a
// stylometric/backend-selector substitution can never score. Development and
// calibration use an opaque run id and a null consumption; the test partition is
// admitted only when the internal call already holds the active Phase 2
// `HoldoutConsumption` whose id equals both the run id and the run's
// holdoutConsumptionId.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Node-only (node:fs/node:crypto for the built-directory inventory); the actual
// Chrome launch lives in `commands/score.ts`, so this module stays unit-testable
// over an injected page and store.

import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import type { HoldoutConsumption } from "./holdout-ledger.ts";
import {
  RELEASE_CHROME_VERSION,
  type PredictionManifestV1,
  type StrictPredictionV2,
} from "./prediction-schema.ts";

/**
 * The Node-side scoring run. Every scientific identity field appears exactly
 * once (flat, no nested RuntimeModelIdentity); `chromeVersion` is pinned to the
 * release Chrome for Testing build and `shardSize` to 100.
 */
export interface BrowserScoreRun {
  schemaVersion: 1;
  runId: string;
  datasetDigest: string;
  splitDigest: string;
  partition: "development" | "calibration" | "test";
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  runtimeParityDigest: string;
  extensionBuildDigest: string;
  chromeVersion: typeof RELEASE_CHROME_VERSION;
  backend: "wasm";
  holdoutConsumptionId: string | null;
  shardSize: 100;
}

/** The append-only, resumable shard writer for one scoring run. */
export interface PredictionShardStore {
  open(run: BrowserScoreRun): Promise<void>;
  completedIds(): Promise<ReadonlySet<string>>;
  writeAtomic(
    index: number,
    rows: readonly StrictPredictionV2[],
  ): Promise<void>;
  finalize(expectedIds: readonly string[]): Promise<PredictionManifestV1>;
}

/**
 * The page-local status the candidate extension publishes once its runtime is
 * assembled. It re-declares the wire shape independently of `src/model-benchmark`
 * (which this module must never import), so the two sides agree structurally.
 */
export interface ModelBenchmarkStatusV1 {
  schemaVersion: 1;
  state: "ready" | "failed";
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  runtimeParityDigest: string;
  backend: "wasm";
  exactTokenizer: boolean;
  errorCode: string | null;
}

/** The page-local per-document scoring outcome. */
export interface ModelBenchmarkScoreV1 {
  status: "scored" | "abstained" | "error";
  documentRawScore: number | null;
  localizedRawScore: number | null;
  evidenceQuality: "sufficient" | "limited" | "unsupported";
  reasonCode: string;
  coverage: number;
  latencyMs: number;
  memoryBytes: number | null;
}

/** One corpus item to score: an opaque id and its text (text is never stored). */
export interface BenchmarkScoreItem {
  id: string;
  text: string;
}

/** The minimal surface the driver needs from the driven Chrome page. */
export interface BenchmarkPage {
  status(): Promise<ModelBenchmarkStatusV1>;
  score(text: string): Promise<ModelBenchmarkScoreV1>;
}

export interface RunBrowserScoreInput {
  run: BrowserScoreRun;
  page: BenchmarkPage;
  store: PredictionShardStore;
  items: readonly BenchmarkScoreItem[];
  consumption?: HoldoutConsumption | null;
}

/** Coded, fail-closed error thrown by every scorer guard. */
export class BrowserScorerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "BrowserScorerError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new BrowserScorerError(code, message);
}

/**
 * Guards the holdout lease. Development and calibration use an opaque run id and
 * MUST carry no consumption; the test partition is admitted only when the caller
 * already holds the active `HoldoutConsumption` whose id equals both the run id
 * and the run's declared holdoutConsumptionId.
 */
export function assertBrowserScoreRunConsumption(
  run: BrowserScoreRun,
  consumption: HoldoutConsumption | null | undefined,
): void {
  if (run.partition === "test") {
    if (consumption === null || consumption === undefined) {
      fail(
        "HOLDOUT_CONSUMPTION_REQUIRED",
        "test scoring requires an active holdout consumption session",
      );
    }
    if (
      run.runId !== consumption.consumptionId ||
      run.holdoutConsumptionId !== consumption.consumptionId
    ) {
      fail(
        "HOLDOUT_CONSUMPTION_MISMATCH",
        "the run id and holdoutConsumptionId must equal the active consumption id",
      );
    }
    return;
  }
  if (consumption !== null && consumption !== undefined) {
    fail(
      "SCORE_RUN_FORBIDS_CONSUMPTION",
      "development and calibration scoring must not carry a holdout consumption",
    );
  }
  if (run.holdoutConsumptionId !== null) {
    fail(
      "SCORE_RUN_FORBIDS_CONSUMPTION",
      "development and calibration runs must declare a null holdoutConsumptionId",
    );
  }
}

/**
 * Compares the page status (embedded at build time) to the run (derived from the
 * emitted parity manifest and the model metadata). Any drift fails closed before
 * a single corpus item is scored.
 */
export function assertBenchmarkStatusMatchesRun(
  status: ModelBenchmarkStatusV1,
  run: BrowserScoreRun,
): void {
  if (status.state !== "ready") {
    fail(
      "SCORER_NOT_READY",
      `candidate runtime is not ready (errorCode=${status.errorCode ?? "unknown"})`,
    );
  }
  const identityFields: (keyof ModelBenchmarkStatusV1 &
    keyof BrowserScoreRun)[] = [
    "modelId",
    "modelVersion",
    "bundleDigest",
    "aggregationVersion",
    "contentCompositionVersion",
    "tokenizerDigest",
  ];
  for (const field of identityFields) {
    if (status[field] !== run[field]) {
      fail(
        "SCORER_IDENTITY_MISMATCH",
        `candidate ${field} (${String(status[field])}) diverges from the run (${String(run[field])})`,
      );
    }
  }
  if (status.runtimeParityDigest !== run.runtimeParityDigest) {
    fail(
      "SCORER_PARITY_MISMATCH",
      "candidate runtimeParityDigest diverges from the emitted parity manifest",
    );
  }
  if (status.backend !== run.backend) {
    fail(
      "SCORER_BACKEND_MISMATCH",
      "candidate backend is not the pinned WASM backend",
    );
  }
  if (status.exactTokenizer !== true) {
    fail(
      "SCORER_INEXACT_TOKENIZER",
      "candidate did not measure the exact tokenizer",
    );
  }
}

/**
 * Maps one page score plus its opaque id to a strict v2 row. It carries ONLY the
 * id and the scoring outcome — never text, spans, author/source, url, prompt or
 * a content hash.
 */
export function toPredictionRow(
  id: string,
  score: ModelBenchmarkScoreV1,
): StrictPredictionV2 {
  return {
    schemaVersion: 2,
    id,
    status: score.status,
    documentRawScore: score.documentRawScore,
    localizedRawScore: score.localizedRawScore,
    evidenceQuality: score.evidenceQuality,
    reasonCode: score.reasonCode,
    coverage: score.coverage,
    latencyMs: score.latencyMs,
    memoryBytes: score.memoryBytes,
  };
}

/**
 * Drives one full scoring run: guards the lease, opens the store, verifies the
 * page identity/parity, then scores each 100-id shard the store has not already
 * committed and finalizes the strict manifest. Items are ordered by opaque id so
 * shard `000000` owns the first hundred ids; a shard whose ids are all already
 * committed is skipped entirely (no recomputation).
 */
export async function runBrowserScore(
  input: RunBrowserScoreInput,
): Promise<PredictionManifestV1> {
  const { run, page, store, items } = input;
  assertBrowserScoreRunConsumption(run, input.consumption ?? null);
  await store.open(run);
  const status = await page.status();
  assertBenchmarkStatusMatchesRun(status, run);

  const ordered = [...items].sort((left, right) =>
    left.id < right.id ? -1 : left.id > right.id ? 1 : 0,
  );
  const completed = await store.completedIds();
  const shardCount = Math.ceil(ordered.length / run.shardSize);
  for (let shardIndex = 0; shardIndex < shardCount; shardIndex += 1) {
    const start = shardIndex * run.shardSize;
    const shardItems = ordered.slice(start, start + run.shardSize);
    if (shardItems.every((item) => completed.has(item.id))) {
      continue;
    }
    const rows: StrictPredictionV2[] = [];
    for (const item of shardItems) {
      const score = await page.score(item.text);
      rows.push(toPredictionRow(item.id, score));
    }
    await store.writeAtomic(shardIndex, rows);
  }
  return store.finalize(ordered.map((item) => item.id));
}

/**
 * Hashes the closed built-directory inventory into the `extensionBuildDigest`:
 * every file under `directory`, in lexicographic relative-posix order, hashed as
 * `relPath` + NUL + raw bytes. This is distinct from the runtime-parity digest —
 * it identifies THIS harness build, not the shared inference core.
 */
export async function computeExtensionBuildDigest(
  directory: string,
): Promise<string> {
  const files = await collectFiles(directory, directory);
  files.sort((left, right) =>
    left.path < right.path ? -1 : left.path > right.path ? 1 : 0,
  );
  const hash = createHash("sha256");
  for (const file of files) {
    hash.update(file.path);
    hash.update(Uint8Array.of(0));
    hash.update(file.bytes);
  }
  return hash.digest("hex");
}

async function collectFiles(
  root: string,
  directory: string,
): Promise<{ path: string; bytes: Buffer }[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const out: { path: string; bytes: Buffer }[] = [];
  for (const entry of entries) {
    const absolute = join(directory, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await collectFiles(root, absolute)));
      continue;
    }
    const bytes = await readFile(absolute);
    out.push({ path: relative(root, absolute).split("\\").join("/"), bytes });
  }
  return out;
}
