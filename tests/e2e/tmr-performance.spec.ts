import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { env } from "node:process";
import { fileURLToPath } from "node:url";

import { expect, test, type Page } from "@playwright/test";

import { canonicalSha256 } from "../../contracts/canonical-json";
import { startFixtureServer } from "./fixtures/linkedin-server";
import {
  connectDevToolsCdpClient,
  sampleExtensionHeap,
} from "./helpers/cdp-extension-metrics";
import {
  getExtensionServiceWorker,
  launchReferenceExtension,
} from "./helpers/load-extension";
import {
  assertPerformanceReport,
  assertReferenceEnvironment,
  assertReleasePerformanceEvidence,
  buildEligiblePortugueseTexts,
  classifyText,
  composeReleasePerformanceReport,
  configureReferenceSettings,
  ReleasePerformanceRecorder,
  writeReleasePerformanceEvidence,
  type ReleasePerformanceEvidence,
} from "./helpers/release-performance";

/**
 * The REAL reference-performance lane. It opens exclusively the canonical `dist`
 * built by `build:release`, measures cold start + warm p95 + incremental memory
 * + main-thread long tasks through the SEALED `CLASSIFY_TEXT` protocol on the
 * pinned Chrome for Testing (WASM), and enforces the budget gate. A regression
 * blocks promotion even if accuracy passes.
 *
 * OPERATOR STEP: this spec only runs when the runner provides the pinned
 * executable + facts + output via the three CLEANFEED_REFERENCE_* env vars. On a
 * machine without the pinned Chrome for Testing 150.0.7871.129 it is skipped —
 * the REAL numbers are produced on the reference hardware and never fabricated.
 * The bundled-Chromium main-thread budget check lives in tests/e2e/extension.spec.ts.
 */

const DIST = fileURLToPath(new URL("../../dist", import.meta.url));
const METADATA = fileURLToPath(
  new URL("../../models/tmr-ai-text-detector", import.meta.url),
);
const TMR_DIST_DIR = join(DIST, "models", "tmr-ai-text-detector");

const EXECUTABLE = env.CLEANFEED_REFERENCE_EXECUTABLE;
const ENV_FILE = env.CLEANFEED_REFERENCE_ENV_FILE;
const OUTPUT = env.CLEANFEED_PERFORMANCE_OUTPUT;

const WARM_SAMPLE_COUNT = 100;

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

/** Fails if a canonical file in `dist` is not byte-identical to its source. */
function assertByteIdentical(relative: string): void {
  const inDist = readFileSync(join(TMR_DIST_DIR, relative));
  const inSource = readFileSync(join(METADATA, relative));
  if (!inDist.equals(inSource)) {
    throw new Error(`DIST_METADATA_MISMATCH — ${relative} differs from source`);
  }
}

/** Records every long task on `page` from load; returns the max seen so far. */
async function installLongTaskObserver(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const store = window as unknown as { __cleanfeedLongTasks: number[] };
    store.__cleanfeedLongTasks = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        store.__cleanfeedLongTasks.push(entry.duration);
      }
    }).observe({ entryTypes: ["longtask"] });
  });
}

async function maxLongTaskMs(page: Page): Promise<number> {
  const durations = await page.evaluate(
    () =>
      (window as unknown as { __cleanfeedLongTasks: number[] })
        .__cleanfeedLongTasks,
  );
  return durations.length === 0 ? 0 : Math.max(...durations);
}

test.describe("TMR reference performance budgets", () => {
  test.skip(
    EXECUTABLE === undefined || ENV_FILE === undefined || OUTPUT === undefined,
    "reference lane requires CLEANFEED_REFERENCE_EXECUTABLE / _ENV_FILE / _PERFORMANCE_OUTPUT (operator step)",
  );

  test("measures and enforces the pinned-environment budgets", async () => {
    test.setTimeout(600_000);

    // The canonical package must carry byte-identical descriptors.
    assertByteIdentical("release.json");
    assertByteIdentical("calibration-profiles.json");

    const facts = assertReferenceEnvironment(readJson(ENV_FILE as string));

    const server = await startFixtureServer();
    const port = new URL(server.origin).port;
    const origin = `http://www.linkedin.com:${port}`;
    const launch = await launchReferenceExtension(EXECUTABLE as string, {
      secureOrigin: origin,
    });
    const { context } = launch;
    const cdp = await connectDevToolsCdpClient(launch.cdpEndpoint);

    try {
      const serviceWorker = await getExtensionServiceWorker(context);
      const extensionId = new URL(serviceWorker.url()).host;

      // Fix the canonical WASM-only settings from the options page.
      const optionsPage = await context.newPage();
      await optionsPage.goto(
        `chrome-extension://${extensionId}/src/options/options.html`,
      );
      await configureReferenceSettings(optionsPage);

      // The extension runtime page that fires the sealed CLASSIFY_TEXT envelope.
      const manualPage = await context.newPage();
      await installLongTaskObserver(manualPage);
      await manualPage.goto(
        `chrome-extension://${extensionId}/src/options/options.html`,
      );

      // Baseline heap AFTER bootstrap and BEFORE the first classification.
      const before = await sampleExtensionHeap(cdp.client, extensionId);

      const recorder = new ReleasePerformanceRecorder();
      const texts = buildEligiblePortugueseTexts(WARM_SAMPLE_COUNT + 2);
      let attempts = 0;

      // The first eligible request is the cold sample (includes model load).
      attempts += 1;
      const cold = await classifyText(manualPage, texts[0] as string, "cold-0");
      recorder.recordCold({
        durationMs: cold.processingTimeMs,
        failed: cold.status === "classification_failed",
        runtimeIdentity: cold.runtimeIdentity,
        backend: cold.backend,
      });

      // One discarded warm-up, then 100 unique warm samples (no cache hits).
      attempts += 1;
      await classifyText(manualPage, texts[1] as string, "warmup-0");
      for (let index = 0; index < WARM_SAMPLE_COUNT; index += 1) {
        attempts += 1;
        const text = texts[index + 2] as string;
        try {
          const warm = await classifyText(manualPage, text, `warm-${index}`);
          expect(warm.backend).toBe("wasm");
          expect(warm.runtimeIdentity.kind).toBe("bundle");
          recorder.recordWarm({
            durationMs: warm.processingTimeMs,
            failed: warm.status === "classification_failed",
            runtimeIdentity: warm.runtimeIdentity,
            backend: warm.backend,
          });
        } catch {
          recorder.recordWarm({
            durationMs: 0,
            failed: true,
            runtimeIdentity: cold.runtimeIdentity,
            backend: cold.backend,
          });
        }
      }

      // Second heap sample after the last response; delta is never clamped.
      const after = await sampleExtensionHeap(cdp.client, extensionId);
      const incrementalMemoryBytes =
        after.footprintBytes - before.footprintBytes;
      const maximumMainThreadTaskMs = await maxLongTaskMs(manualPage);

      const distRelease = readJson(join(TMR_DIST_DIR, "release.json"));
      const descriptorDigest = await canonicalSha256(distRelease);
      const parity = readJson(join(DIST, "runtime-parity.json"));

      const report = composeReleasePerformanceReport({
        snapshot: recorder.snapshot(),
        environment: facts,
        incrementalMemoryBytes,
        maximumMainThreadTaskMs,
        inferenceAttempts: attempts,
        releaseDescriptorDigest: descriptorDigest,
        runtimeParityDigest: parity.runtimeParityDigest as string,
      });

      assertPerformanceReport(report, {
        releaseDescriptorDigest: descriptorDigest,
        runtimeParityDigest: parity.runtimeParityDigest as string,
        runtimeIdentity: report.runtimeIdentity,
        browserExecutableSha256: facts.browserExecutableSha256,
      });

      const evidence: ReleasePerformanceEvidence = {
        status: "measured",
        report,
      };
      assertReleasePerformanceEvidence(evidence, {
        descriptorDigest,
        gateDecision: distRelease.gateDecision as "indicator-only" | "pass",
        rolloutState: distRelease.rolloutState as "indicator" | "actions",
        tmrDirectoryPresent: existsSync(TMR_DIST_DIR),
      });

      writeReleasePerformanceEvidence(evidence, OUTPUT as string);
    } finally {
      await cdp.close();
      await context.close();
      await server.close();
    }
  });
});
