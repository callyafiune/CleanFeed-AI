import { cpSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";

import cleanfeedModel from "../../models/tmr-ai-text-detector/cleanfeed-model.json" with { type: "json" };
import type { ModelSmokeReport } from "../../src/model-smoke/main";
import { MODEL_SMOKE_GLOBAL, MODEL_SMOKE_PAGE } from "./model-smoke-manifest";

/**
 * The REAL-model smoke.
 *
 * It loads the isolated `dist-model-smoke/` extension into the bundled, pinned
 * Chromium and proves the TMR runtime runs entirely offline: it fails on any
 * `http:`/`https:` request, resolves the extension id from the service worker,
 * opens `model-smoke.html` and asserts the privacy-safe `ModelSmokeReport`.
 *
 * With the sealed bundle present it asserts the full contract (bundle identity
 * with the expected digests, an exact tokenizer measuring two special tokens, at
 * most eight windows under aggregation v2, both raw scores finite in [0,1] and
 * finite/positive cold and warm timings). Without the ONNX binary the report is
 * the structured `MODEL_ARTIFACT_MISSING` failure — never a fabricated pass. A
 * separate case corrupts a local asset and proves ONE switch to the indicative
 * builtin fallback, with the page still responsive (no loop).
 *
 * The 10s / 2s / 512MiB budgets belong ONLY to the Phase-4 reference lane; here
 * cold/warm/memory are recorded, not gated, so a developer machine never fails a
 * functional smoke over environmental variance.
 */

const DIST = fileURLToPath(new URL("../../dist-model-smoke", import.meta.url));
const ONNX_RELATIVE = cleanfeedModel.modelFile;
const EXPECTED_BUNDLE_DIGEST = cleanfeedModel.bundleDigest;
const EXPECTED_TOKENIZER_DIGEST = cleanfeedModel.tokenizerDigest;

async function launch(distDir: string): Promise<BrowserContext> {
  // The exact launch shape verified for this environment: headless, the
  // "chromium" channel, and the two extension flags. No host-resolver rules and
  // no allowed origins — the smoke must reach nothing off the extension.
  return chromium.launchPersistentContext("", {
    headless: true,
    channel: "chromium",
    args: [
      `--disable-extensions-except=${distDir}`,
      `--load-extension=${distDir}`,
    ],
  });
}

async function resolveExtensionId(context: BrowserContext): Promise<string> {
  const [existing] = context.serviceWorkers();
  const worker: Worker =
    existing ?? (await context.waitForEvent("serviceworker"));
  return new URL(worker.url()).host;
}

async function readReport(page: Page): Promise<ModelSmokeReport> {
  const handle = await page.waitForFunction(
    (globalName) =>
      (window as unknown as Record<string, ModelSmokeReport | undefined>)[
        globalName
      ] ?? null,
    MODEL_SMOKE_GLOBAL,
  );
  return handle.jsonValue() as Promise<ModelSmokeReport>;
}

/** Records every request that leaves the extension over http/https. */
function trackExternalRequests(context: BrowserContext): string[] {
  const external: string[] = [];
  context.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http:") || url.startsWith("https:")) {
      external.push(url);
    }
  });
  return external;
}

test.describe("real TMR model smoke (offline Chrome)", () => {
  test.skip(
    !existsSync(DIST),
    "dist-model-smoke not built — run `npm run build:model-smoke` first",
  );

  test("runs the sealed TMR runtime offline and publishes a privacy-safe report", async () => {
    const context = await launch(DIST);
    try {
      const external = trackExternalRequests(context);
      const extensionId = await resolveExtensionId(context);
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/${MODEL_SMOKE_PAGE}`);

      const report = await readReport(page);

      // Offline is absolute: nothing ever left the extension.
      expect(external).toEqual([]);

      // The report never carries text, tokens, a page URL or per-sample scores.
      expect(Object.keys(report).sort()).toEqual(
        [
          "candidateWindowCount",
          "coldStartMs",
          "documentRawScore",
          "errorCode",
          "exactTokenizer",
          "localizedRawScore",
          "peakMemoryBytes",
          "runtimeIdentity",
          "selectedWindowCount",
          "specialTokenCount",
          "state",
          "warmInferenceMs",
        ].sort(),
      );

      if (report.state === "passed") {
        expect(report.errorCode).toBeNull();
        expect(report.runtimeIdentity).not.toBeNull();
        expect(report.runtimeIdentity?.kind).toBe("bundle");
        if (report.runtimeIdentity?.kind === "bundle") {
          expect(report.runtimeIdentity.bundleDigest).toBe(
            EXPECTED_BUNDLE_DIGEST,
          );
          expect(report.runtimeIdentity.tokenizerDigest).toBe(
            EXPECTED_TOKENIZER_DIGEST,
          );
          expect(report.runtimeIdentity.aggregationVersion).toBe(
            "tmr-aggregation-v2",
          );
        }
        expect(report.exactTokenizer).toBe(true);
        expect(report.specialTokenCount).toBe(2);
        expect(report.candidateWindowCount).toBeGreaterThanOrEqual(1);
        expect(report.candidateWindowCount).toBeLessThanOrEqual(8);
        expect(report.selectedWindowCount).toBeGreaterThanOrEqual(1);
        expect(report.selectedWindowCount).toBeLessThanOrEqual(8);
        for (const score of [
          report.documentRawScore,
          report.localizedRawScore,
        ]) {
          expect(score).not.toBeNull();
          expect(Number.isFinite(score)).toBe(true);
          expect(score as number).toBeGreaterThanOrEqual(0);
          expect(score as number).toBeLessThanOrEqual(1);
        }
        expect(Number.isFinite(report.coldStartMs)).toBe(true);
        expect(report.coldStartMs).toBeGreaterThan(0);
        expect(Number.isFinite(report.warmInferenceMs)).toBe(true);
        expect(report.warmInferenceMs).toBeGreaterThan(0);
        expect(
          report.peakMemoryBytes === null || report.peakMemoryBytes > 0,
        ).toBe(true);
      } else {
        // The only honest non-passed outcome in this lane is the sealed binary
        // being absent. It is a structured failure, never a silent skip and
        // never a fabricated score.
        expect(report.errorCode).toBe("MODEL_ARTIFACT_MISSING");
        expect(report.runtimeIdentity).toBeNull();
        expect(report.documentRawScore).toBeNull();
        expect(report.localizedRawScore).toBeNull();
      }

      // Memory is measured via CDP when available and only recorded, not gated.
      let cdpMemoryBytes: number | null = null;
      try {
        const client = await context.newCDPSession(page);
        await client.send("Performance.enable");
        const { metrics } = await client.send("Performance.getMetrics");
        const heap = metrics.find((metric) => metric.name === "JSHeapUsedSize");
        cdpMemoryBytes = heap ? heap.value : null;
      } catch {
        cdpMemoryBytes = null;
      }
      expect(cdpMemoryBytes === null || cdpMemoryBytes > 0).toBe(true);

      // The page is still responsive after the terminal report.
      expect(await page.evaluate(() => 1 + 1)).toBe(2);

      await page.close();
    } finally {
      await context.close();
    }
  });

  test("switches once to the indicative builtin fallback when a sealed asset is corrupt", async () => {
    // Copy the built extension and corrupt ONLY the ONNX binary in the copy, so
    // the sealed-asset verification fails on a present-but-tampered file. This
    // exercises the fallback path even before the real 125MB binary exists.
    const corruptDir = mkdtempSync(join(tmpdir(), "cleanfeed-smoke-corrupt-"));
    cpSync(DIST, corruptDir, { recursive: true });
    const onnxPath = join(
      corruptDir,
      "models",
      "tmr-ai-text-detector",
      ...ONNX_RELATIVE.split("/"),
    );
    writeFileSync(onnxPath, "corrupted-not-a-real-onnx-model");

    const context = await launch(corruptDir);
    try {
      const external = trackExternalRequests(context);
      const extensionId = await resolveExtensionId(context);
      const page = await context.newPage();
      await page.goto(
        `chrome-extension://${extensionId}/${MODEL_SMOKE_PAGE}?scenario=corrupt`,
      );

      const report = await readReport(page);

      expect(external).toEqual([]);
      // Exactly one switch to the indicative builtin fallback — no loop.
      expect(report.state).toBe("failed");
      expect(report.runtimeIdentity).not.toBeNull();
      expect(report.runtimeIdentity?.kind).toBe("builtin");
      expect(report.errorCode).toBe("MODEL_ASSET_CORRUPTED");

      // The page did not hang or oscillate: it is still responsive.
      expect(await page.evaluate(() => 1 + 1)).toBe(2);

      await page.close();
    } finally {
      await context.close();
    }
  });
});
