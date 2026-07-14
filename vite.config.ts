import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import manifest from "./manifest.config";

export default defineConfig({
  base: "./",
  plugins: [react(), crx({ manifest })],
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
