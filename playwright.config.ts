import { defineConfig } from "@playwright/test";

/**
 * E2E gate for the built extension. The extension is loaded from `dist` into a
 * persistent Chromium context by the fixtures in tests/e2e/helpers, and the
 * feed is served from a local, offline server on 127.0.0.1. There is no
 * `webServer` and no `baseURL`: the fixture server is started inside the spec
 * on an ephemeral port and exposed to the test as the only allowed origin.
 */
export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  fullyParallel: false,
  // The persistent extension context is a single shared browser; run serially.
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  // The long-task perf assertion measures wall-clock, so a transient CPU spike
  // on a loaded machine can inflate an otherwise-fine task past the budget.
  // Retry to absorb that environmental noise WITHOUT weakening the assertion —
  // a genuine budget regression still fails every attempt.
  retries: 2,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
