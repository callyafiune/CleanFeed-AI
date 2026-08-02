// `score`: drive the isolated candidate extension in the locked Chrome for
// Testing and write raw TMR prediction shards for development or calibration.
//
// It reads only the sealed split and the emitted runtime-parity manifest, resolves
// the pinned Chrome for Testing executable from the LOCAL cache (never system
// Chrome, never the Playwright-bundled Chromium), launches the unpacked candidate
// extension, blocks every http/https request, verifies the four-part browser
// version and the full identity/parity tuple, and maps each page response to a
// strict shard row. It NEVER touches the holdout: the test partition is rejected
// at CLI parse time, so this command carries no ledger.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// This command DOES launch a real browser (`chromium.launchPersistentContext` below), with
// the candidate extension loaded, and it is the only benchmark command that does.

import { resolve } from "node:path";

import { parseRuntimeParityManifestV1 } from "../../contracts/runtime-parity.ts";
import {
  resolveLockedTestBrowser,
  loadTestBrowserLock,
  assertLockedBrowserVersion,
} from "../../scripts/test-browser-lock.mjs";
import {
  computeExtensionBuildDigest,
  runBrowserScore,
  type BenchmarkPage,
  type BrowserScoreRun,
  type ModelBenchmarkScoreV1,
  type ModelBenchmarkStatusV1,
} from "../browser-scorer.ts";
import { validateDatasetManifest } from "../dataset-manifest.ts";
import { computeDatasetDigest } from "../digests.ts";
import { createPredictionShardStore } from "../prediction-shards.ts";
import { RELEASE_CHROME_VERSION } from "../prediction-schema.ts";
import { parseBenchmarkDataset } from "../schema.ts";
import {
  validateSplitArtifact,
  type SplitArtifact,
} from "../split-artifact.ts";
import { CommandError, readJsonFile, readTextFile } from "./io.ts";

import { chromium, type BrowserContext, type Page } from "playwright";
import { join } from "node:path";
import type { FitPartition } from "../split.ts";

/** The page and global the candidate extension publishes its API on. */
const CANDIDATE_PAGE = "model-benchmark.html";
const CANDIDATE_GLOBAL = "__cleanfeedModelBenchmark";
// Cold WASM start for the pinned bundle; generous on purpose, since the only
// alternative reading of a slow start is a false "API unavailable".
const CANDIDATE_READY_TIMEOUT_MS = 300_000;

export interface ScoreOptions {
  datasetDirectory: string;
  splitArtifactPath: string;
  partition: FitPartition;
  candidateExtensionDir: string;
  outputDirectory: string;
  resume: boolean;
  /** ISO timestamp sealed into the prediction manifest; defaults to now. */
  createdAt?: string;
}

/** The candidate page API shape, mirrored for the Playwright evaluate casts. */
interface CandidatePageApi {
  status: ModelBenchmarkStatusV1;
  score(text: string): Promise<ModelBenchmarkScoreV1>;
}

export async function runScore(options: ScoreOptions): Promise<string> {
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
  const datasetDigest = await computeDatasetDigest(manifest, records);

  const candidateDir = resolve(options.candidateExtensionDir);
  const parity = await parseRuntimeParityManifestV1(
    await readJsonFile(join(candidateDir, "runtime-parity.json")),
  );
  const extensionBuildDigest = await computeExtensionBuildDigest(candidateDir);

  const partitionIds = artifact.assignments
    .filter((assignment) => assignment.partition === options.partition)
    .map((assignment) => assignment.id)
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const textById = new Map(records.map((record) => [record.id, record.text]));
  const items = partitionIds.map((id) => {
    const text = textById.get(id);
    if (text === undefined) {
      throw new CommandError(
        "SCORE_MISSING_RECORD",
        `split assigns id ${id} that is absent from the dataset`,
      );
    }
    return { id, text };
  });

  const run: BrowserScoreRun = {
    schemaVersion: 1,
    runId: `${options.partition}-${parity.runtimeParityDigest.slice(0, 8)}-${artifact.splitDigest.slice(0, 8)}-${extensionBuildDigest.slice(0, 8)}`,
    datasetDigest,
    splitDigest: artifact.splitDigest,
    partition: options.partition,
    modelId: parity.modelId,
    modelVersion: parity.modelVersion,
    bundleDigest: parity.bundleDigest,
    aggregationVersion: parity.aggregationVersion,
    contentCompositionVersion: parity.contentCompositionVersion,
    tokenizerDigest: parity.tokenizerDigest,
    runtimeParityDigest: parity.runtimeParityDigest,
    extensionBuildDigest,
    chromeVersion: RELEASE_CHROME_VERSION,
    backend: "wasm",
    holdoutConsumptionId: null,
    shardSize: 100,
  };

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
    await blockExternalRequests(context);
    const extensionId = await resolveExtensionId(context);
    const page = await context.newPage();
    await openScoreCandidatePage(page, extensionId);

    const store = createPredictionShardStore({
      directory: options.outputDirectory,
      createdAt: options.createdAt ?? new Date().toISOString(),
    });
    const predictionManifest = await runBrowserScore({
      run,
      page: adaptPage(page),
      store,
      items,
    });
    return (
      `Scored ${options.partition}: ${predictionManifest.shardCount} shard(s), ` +
      `${items.length} ids, backend=${predictionManifest.backend}, ` +
      `chrome=${predictionManifest.chromeVersion}.`
    );
  } finally {
    await context.close();
  }
}

/**
 * Navigates the dev/cal-A driver and waits until the candidate
 * has published its terminal API. Exported so the race regression is testable
 * without launching the 106M model bundle.
 */
export async function openScoreCandidatePage(
  page: Pick<Page, "goto" | "waitForFunction">,
  extensionId: string,
): Promise<void> {
  await page.goto(`chrome-extension://${extensionId}/${CANDIDATE_PAGE}`);
  // The candidate publishes its API only once model assembly reaches a
  // TERMINAL outcome — success or failure — precisely so no scorer can read a
  // half-initialized runtime. That means the global is absent at navigation
  // time: bringing a 106M ONNX bundle up under WASM takes tens of seconds.
  // Wait for publication rather than racing it, and let a genuinely stuck
  // candidate surface as a timeout instead of as "API unavailable".
  await page.waitForFunction(
    (globalName) => globalName in globalThis,
    CANDIDATE_GLOBAL,
    { timeout: CANDIDATE_READY_TIMEOUT_MS },
  );
}

async function blockExternalRequests(context: BrowserContext): Promise<void> {
  await context.route("**/*", (route) => {
    const url = route.request().url();
    if (url.startsWith("http:") || url.startsWith("https:")) {
      void route.abort();
      return;
    }
    void route.continue();
  });
}

async function resolveExtensionId(context: BrowserContext): Promise<string> {
  const [existing] = context.serviceWorkers();
  const worker = existing ?? (await context.waitForEvent("serviceworker"));
  return new URL(worker.url()).host;
}

function adaptPage(page: Page): BenchmarkPage {
  return {
    status(): Promise<ModelBenchmarkStatusV1> {
      return page.evaluate((globalName) => {
        const api = (
          globalThis as unknown as Record<string, CandidatePageApi | undefined>
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
}
