import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import manifest from "./manifest.config";

function offlineTransformersRuntime() {
  return {
    name: "cleanfeed-offline-transformers-runtime",
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== "chunk") continue;
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
