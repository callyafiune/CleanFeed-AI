import { fileURLToPath, URL } from "node:url";

import { defineConfig } from "@playwright/test";

/**
 * The REAL-model smoke lane. It loads the isolated `dist-model-smoke/` extension
 * into the bundled, pinned Chromium (`channel: "chromium"`) and runs ONLY
 * `real-model-smoke.spec.ts`. There is no `webServer` and no `baseURL`: the smoke
 * must reach zero network, and the spec fails on any `http:`/`https:` request.
 *
 * The JSON reporter is written to a fixed file that `scripts/run-real-model-tests.mjs`
 * parses, so a skipped test (or a missing spec) is surfaced as MODEL_SMOKE_SKIPPED
 * rather than being silently tolerated. `forbidOnly` under CI keeps a stray
 * `.only` from turning the gate green with a single hand-picked case.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /real-model-smoke\.spec\.ts$/,
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
          new URL("./test-results/model-smoke.json", import.meta.url),
        ),
      },
    ],
  ],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
