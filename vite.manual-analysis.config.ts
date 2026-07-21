import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";

import { e2eReleaseMetadataPlugin } from "./vite.config";

/**
 * Separate build for the on-demand manual-analysis panel.
 *
 * The service worker injects this file with `chrome.scripting.executeScript`,
 * which runs it as a classic (non-module) script in the isolated world. It must
 * therefore be a single self-contained IIFE with NO `import`/`export` — the
 * crxjs build (vite.config.ts) emits ES module chunks that would fail to parse
 * there. `inlineDynamicImports` + `format: "iife"` bundle React, the panel and
 * its dependencies into one file; `emptyOutDir: false` keeps the crxjs output
 * intact (this build must run after `vite build`).
 */
export default defineConfig(({ mode }) => ({
  base: "./",
  plugins: [react(), e2eReleaseMetadataPlugin(mode)],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    emptyOutDir: false,
    rollupOptions: {
      input: fileURLToPath(
        new URL("./src/manual-analysis/inject.ts", import.meta.url),
      ),
      output: {
        format: "iife",
        name: "__cleanfeedManualAnalysis",
        entryFileNames: "manual-analysis.js",
        inlineDynamicImports: true,
      },
    },
  },
}));
