// The test-only MV3 manifest for the isolated model-benchmark extension.
//
// This extension is NEVER shipped: it exists solely to assemble the EXACT
// uncalibrated TMR inference core (Transformers.js + ONNX) in a Chrome page so the
// Playwright benchmark scorer can score fixed public fixtures. It is built into
// `dist-model-benchmark/` by `vite.model-benchmark.config.ts` and is deliberately
// absent from `manifest.config.ts`, `vite.config.ts` and the production `dist/`.
//
// It carries only what the scorer needs: the production content-security-policy
// (so ONNX WASM and offline `connect-src 'self'` behave exactly as in the real
// extension) and a trivial background service worker whose only job is to let the
// Playwright fixture resolve the extension id. It declares NO externally_connectable,
// NO content script and NO network listener, and reaches NO network.

/** The extension page the benchmark exposes its scoring API from. */
export const MODEL_BENCHMARK_PAGE = "model-benchmark.html";

/** The trivial background worker emitted alongside the build for id resolution. */
export const MODEL_BENCHMARK_SERVICE_WORKER = "service-worker.js";

/** The global the benchmark page publishes its page-local API on. */
export const MODEL_BENCHMARK_GLOBAL = "__cleanfeedModelBenchmark";

/** The runtime-parity manifest the build embeds and emits alongside the page. */
export const MODEL_BENCHMARK_PARITY_FILE = "runtime-parity.json";

/** The test-only MV3 manifest object, emitted verbatim as `manifest.json`. */
export const modelBenchmarkManifest = {
  manifest_version: 3,
  name: "CleanFeed AI — Model Benchmark (test only)",
  version: "0.0.0",
  description:
    "Test-only harness that scores the exact uncalibrated TMR core in Chrome. Never shipped.",
  minimum_chrome_version: "116",
  background: {
    service_worker: MODEL_BENCHMARK_SERVICE_WORKER,
    type: "module",
  },
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; connect-src 'self'",
  },
} as const;
