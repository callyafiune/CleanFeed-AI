import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    include: [
      "tests/**/*.test.ts",
      "tests/**/*.test.tsx",
      "benchmark/**/*.test.ts",
    ],
    // Raised from the 5.000 ms default because of a PRE-REGISTERED cost, not a slow
    // test. `computeEvaluationMetrics` resamples every gated rate over the unit its
    // row of the frozen resampling table declares, and the frozen contract fixes
    // the replicate count at 10.000 in the pilot and 100.000 in the release with
    // "never reduce it for run time". One call over ~600 record-lines therefore
    // costs a few hundred milliseconds, and the tests that assert what the REAL
    // pipeline puts in a denominator legitimately make several calls. Measured on
    // this tree, such a test takes ~1,2 s alone and 5-6 s when the whole suite runs
    // it under load — over the default, which made `npx vitest run` fail
    // load-dependently while every test passed in isolation. The lever here is the
    // timeout; reducing the replicate count is forbidden.
    testTimeout: 20_000,
  },
});
