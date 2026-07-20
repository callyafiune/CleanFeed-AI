// The test-only MV3 manifest for the isolated model-smoke extension.
//
// This extension is NEVER shipped: it exists solely to load the REAL TMR runtime
// (Transformers.js + ONNX) into a Chrome page so a Playwright spec can prove the
// model runs offline. It is built into `dist-model-smoke/` by
// `vite.model-smoke.config.ts` and is deliberately absent from `manifest.config.ts`,
// `vite.config.ts` and the production `dist/`.
//
// It carries only what the smoke needs: the production content-security-policy
// (so ONNX WASM and offline `connect-src 'self'` behave exactly as in the real
// extension) and a trivial background service worker whose only job is to let the
// Playwright fixture resolve the extension id. It requests NO host permissions
// and reaches NO network.

/**
 * The pinned extension id the model-smoke fixture is addressed by. Chrome derives
 * the real id from the package, so the spec resolves the actual id from the
 * service worker; this constant documents the intended fixture identity.
 */
export const MODEL_SMOKE_EXTENSION_ID = "abcdefghijklmnopabcdefghijklmnop";

/** The extension page the smoke publishes its report from. */
export const MODEL_SMOKE_PAGE = "model-smoke.html";

/** The trivial background worker emitted alongside the build for id resolution. */
export const MODEL_SMOKE_SERVICE_WORKER = "service-worker.js";

/** The global the smoke page publishes its terminal {@link "ModelSmokeReport"} on. */
export const MODEL_SMOKE_GLOBAL = "__cleanfeedModelSmoke";

/** The test-only MV3 manifest object, emitted verbatim as `manifest.json`. */
export const modelSmokeManifest = {
  manifest_version: 3,
  name: "CleanFeed AI — Model Smoke (test only)",
  version: "0.0.0",
  description:
    "Test-only harness that runs the real TMR runtime in Chrome. Never shipped.",
  minimum_chrome_version: "116",
  background: {
    service_worker: MODEL_SMOKE_SERVICE_WORKER,
    type: "module",
  },
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'; connect-src 'self'",
  },
} as const;
