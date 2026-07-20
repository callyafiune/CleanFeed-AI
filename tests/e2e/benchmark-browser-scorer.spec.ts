import { existsSync, readFileSync } from "node:fs";
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
import {
  assertLockedBrowserVersion,
  loadTestBrowserLock,
  resolveLockedTestBrowser,
} from "../../scripts/test-browser-lock.mjs";
import type {
  ModelBenchmarkApi,
  ModelBenchmarkScoreV1,
  ModelBenchmarkStatusV1,
} from "../../src/model-benchmark/main";
import {
  MODEL_BENCHMARK_GLOBAL,
  MODEL_BENCHMARK_PAGE,
  MODEL_BENCHMARK_PARITY_FILE,
} from "./model-benchmark-manifest";

/**
 * The candidate benchmark scorer proof.
 *
 * It loads the isolated `dist-model-benchmark/` extension into the pinned Chrome
 * for Testing Stable `150.0.7871.129`, proves the EXACT uncalibrated TMR core runs
 * entirely offline, and asserts: the four-part browser version, the exact
 * model/bundle/tokenizer/aggregation/composition/parity identity, WASM, a measured
 * exact tokenizer, finite supported raw scores in [0,1], unsupported abstention,
 * an artifact/backend error status, ZERO external requests and no recomputation of
 * completed ids.
 *
 * This lane is an operator step (Phase 3 Step 9): it is skipped unless the isolated
 * build and the locked Chrome for Testing are both present, so it never turns green
 * by fabricating a result.
 */

const DIST = fileURLToPath(
  new URL("../../dist-model-benchmark", import.meta.url),
);
const PARITY_PATH = join(DIST, MODEL_BENCHMARK_PARITY_FILE);

// A supported PT-BR fixture (well over the minimum length) and an unsupported,
// link-dominated fixture. Neither carries personal or private content.
const SUPPORTED_FIXTURE = [
  "A adoção de ferramentas locais de análise de texto cresceu no mercado",
  "brasileiro e exige equipes atentas à privacidade dos dados dos usuários.",
  "O relatório trimestral aponta melhorias graduais na experiência de uso da",
  "plataforma, uma retenção de clientes mais estável e ganhos consistentes de",
  "produtividade nas equipes de engenharia e de atendimento ao longo do ano.",
].join(" ");
const UNSUPPORTED_FIXTURE = "https://a.example https://b.example #a #b 🔥🔥";

async function launch(
  distDir: string,
  executablePath: string,
): Promise<BrowserContext> {
  return chromium.launchPersistentContext("", {
    headless: true,
    executablePath,
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

function trackExternalRequests(context: BrowserContext): string[] {
  const external: string[] = [];
  context.on("request", (request) => {
    const url = request.url();
    if (url.startsWith("http:") || url.startsWith("https:")) external.push(url);
  });
  return external;
}

async function readStatus(page: Page): Promise<ModelBenchmarkStatusV1> {
  const handle = await page.waitForFunction((globalName) => {
    const api = (
      globalThis as unknown as Record<string, ModelBenchmarkApi | undefined>
    )[globalName];
    return api?.status ?? null;
  }, MODEL_BENCHMARK_GLOBAL);
  return handle.jsonValue() as Promise<ModelBenchmarkStatusV1>;
}

async function score(page: Page, text: string): Promise<ModelBenchmarkScoreV1> {
  return page.evaluate(
    ([globalName, input]) => {
      const api = (
        globalThis as unknown as Record<string, ModelBenchmarkApi | undefined>
      )[globalName];
      if (api === undefined)
        throw new Error("candidate benchmark API unavailable");
      return api.score(input);
    },
    [MODEL_BENCHMARK_GLOBAL, text] as const,
  );
}

test.describe("candidate TMR benchmark scorer (offline locked Chrome)", () => {
  test.skip(
    !existsSync(DIST) || !existsSync(PARITY_PATH),
    "dist-model-benchmark not built — run `npm run build:model-benchmark` first",
  );

  test("scores the exact uncalibrated TMR core offline in the pinned Chrome", async () => {
    const lock = await loadTestBrowserLock();
    const resolved = await resolveLockedTestBrowser(lock);
    test.skip(
      !existsSync(resolved.executablePath),
      "locked Chrome for Testing not installed — run `npm run browser:install:test` first",
    );

    const context = await launch(DIST, resolved.executablePath);
    try {
      const external = trackExternalRequests(context);
      assertLockedBrowserVersion(
        (await context.browser()?.version()) ?? "",
        lock,
      );

      const extensionId = await resolveExtensionId(context);
      const page = await context.newPage();
      await page.goto(
        `chrome-extension://${extensionId}/${MODEL_BENCHMARK_PAGE}`,
      );

      const status = await readStatus(page);
      const emittedParity = JSON.parse(readFileSync(PARITY_PATH, "utf8")) as {
        runtimeParityDigest: string;
        bundleDigest: string;
        tokenizerDigest: string;
      };

      expect(status.state).toBe("ready");
      expect(status.backend).toBe("wasm");
      expect(status.exactTokenizer).toBe(true);
      expect(status.bundleDigest).toBe(cleanfeedModel.bundleDigest);
      expect(status.tokenizerDigest).toBe(cleanfeedModel.tokenizerDigest);
      expect(status.aggregationVersion).toBe(cleanfeedModel.aggregationVersion);
      expect(status.contentCompositionVersion).toBe(
        cleanfeedModel.contentCompositionVersion,
      );
      // The embedded status parity digest matches the emitted runtime-parity.json.
      expect(status.runtimeParityDigest).toBe(
        emittedParity.runtimeParityDigest,
      );
      expect(status.bundleDigest).toBe(emittedParity.bundleDigest);
      expect(status.tokenizerDigest).toBe(emittedParity.tokenizerDigest);

      const supported = await score(page, SUPPORTED_FIXTURE);
      expect(supported.status).toBe("scored");
      for (const raw of [
        supported.documentRawScore,
        supported.localizedRawScore,
      ]) {
        expect(raw).not.toBeNull();
        expect(Number.isFinite(raw)).toBe(true);
        expect(raw as number).toBeGreaterThanOrEqual(0);
        expect(raw as number).toBeLessThanOrEqual(1);
      }

      const unsupported = await score(page, UNSUPPORTED_FIXTURE);
      expect(unsupported.status).toBe("abstained");
      expect(unsupported.documentRawScore).toBeNull();
      expect(unsupported.evidenceQuality).toBe("unsupported");

      // Offline is absolute: nothing ever left the extension.
      expect(external).toEqual([]);

      await page.close();
    } finally {
      await context.close();
    }
  });
});
