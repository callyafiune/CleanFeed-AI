import { fileURLToPath, URL } from "node:url";
import { defineConfig, type Plugin } from "vite";

import {
  MODEL_SMOKE_SERVICE_WORKER,
  modelSmokeManifest,
} from "./tests/e2e/model-smoke-manifest";

/**
 * Isolated, TEST-ONLY build for the real-model smoke.
 *
 * It emits `dist-model-smoke/` — a self-contained MV3 extension whose only page,
 * `model-smoke.html`, imports the REAL TMR runtime and runs it once in Chrome.
 * It copies the verified bundle and the offline WASM by reusing `public/` as the
 * public dir (so the materialized `public/models/tmr-ai-text-detector/` and the
 * `public/vendor/transformers-wasm/` assets travel along), and it rewrites the
 * Transformers.js remote-host constants to `offline` exactly like the production
 * build so nothing can reach the network.
 *
 * This entrypoint is deliberately absent from `vite.config.ts`,
 * `manifest.config.ts` and the production `dist/`. It never ships.
 */

const SMOKE_ROOT = fileURLToPath(new URL("./src/model-smoke", import.meta.url));
const SMOKE_OUT = fileURLToPath(new URL("./dist-model-smoke", import.meta.url));
const SMOKE_HTML = fileURLToPath(
  new URL("./src/model-smoke/model-smoke.html", import.meta.url),
);
const PUBLIC_DIR = fileURLToPath(new URL("./public", import.meta.url));

/** Emits the test-only manifest and a trivial id-resolution service worker. */
function emitModelSmokeExtension(): Plugin {
  return {
    name: "cleanfeed-model-smoke-extension",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.json",
        source: `${JSON.stringify(modelSmokeManifest, null, 2)}\n`,
      });
      this.emitFile({
        type: "asset",
        fileName: MODEL_SMOKE_SERVICE_WORKER,
        source:
          "// Test-only service worker: exists so the Playwright fixture can\n" +
          "// resolve the extension id. It does no work and reaches no network.\n" +
          "self.addEventListener('install', () => {});\n",
      });
    },
  };
}

/** Mirrors production: neutralize the remote-host constants Transformers.js ships. */
function offlineTransformersRuntime(): Plugin {
  return {
    name: "cleanfeed-offline-transformers-runtime",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle) as {
        type: string;
        code?: string;
      }[]) {
        if (output.type !== "chunk" || output.code === undefined) continue;
        output.code = output.code
          .replaceAll("https://huggingface.co", "offline")
          .replaceAll("https://cdn.jsdelivr.net", "offline");
      }
    },
  };
}

export default defineConfig({
  base: "./",
  root: SMOKE_ROOT,
  publicDir: PUBLIC_DIR,
  assetsInclude: ["**/*.wasm"],
  plugins: [emitModelSmokeExtension(), offlineTransformersRuntime()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    outDir: SMOKE_OUT,
    emptyOutDir: true,
    rollupOptions: {
      input: SMOKE_HTML,
    },
  },
});
