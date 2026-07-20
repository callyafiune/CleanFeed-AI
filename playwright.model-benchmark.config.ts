import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "@playwright/test";

/**
 * The candidate-scorer benchmark lane. It loads the isolated `dist-model-benchmark/`
 * extension into the PINNED Chrome for Testing Stable `150.0.7871.129` (resolved
 * from the local cache, never system Chrome and never the Playwright-bundled
 * Chromium) and runs ONLY `benchmark-browser-scorer.spec.ts`. There is no
 * `webServer` and no `baseURL`: scoring must reach zero network, and the spec
 * fails on any `http:`/`https:` request.
 *
 * `forbidOnly` under CI keeps a stray `.only` from turning the lane green with a
 * single hand-picked case. The locked-browser executable is supplied by the spec
 * itself (via `scripts/test-browser-lock.mjs`), so no `channel`/`executablePath`
 * is configured here.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /benchmark-browser-scorer\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  timeout: 120_000,
  expect: { timeout: 30_000 },
  reporter: [
    ["list"],
    [
      "json",
      {
        outputFile: fileURLToPath(
          new URL("./test-results/model-benchmark.json", import.meta.url),
        ),
      },
    ],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
