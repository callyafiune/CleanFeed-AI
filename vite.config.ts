import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import manifest from "./manifest.config";

function offlineTransformersRuntime() {
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
  assetsInclude: ["**/*.wasm"],
  plugins: [react(), crx({ manifest }), offlineTransformersRuntime()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  build: {
    rollupOptions: {
      input: {
        offscreen: fileURLToPath(
          new URL("./src/offscreen/offscreen.html", import.meta.url),
        ),
      },
    },
  },
});

// The on-demand manual-analysis panel is injected via chrome.scripting under a
// user gesture and is NOT a content script. chrome.scripting.executeScript runs
// the file as a classic (non-module) script, so it cannot be one of the ES
// module chunks this crxjs build emits. It is built separately, as a single
// self-contained IIFE, by vite.manual-analysis.config.ts into dist/manual-analysis.js.
