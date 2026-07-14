import { defineManifest } from "@crxjs/vite-plugin";

const manifest = {
  manifest_version: 3,
  minimum_chrome_version: "116",
  name: "CleanFeed AI",
  version: "0.1.0",
  description: "Filtro local e probabilístico para publicações longas.",
  permissions: [
    "storage",
    "contextMenus",
    "activeTab",
    "scripting",
    "offscreen",
  ],
  host_permissions: ["https://www.linkedin.com/*"],
  background: {
    service_worker: "src/background/service-worker.ts",
    type: "module",
  },
  action: {
    default_popup: "src/popup/popup.html",
    default_title: "CleanFeed AI",
  },
  options_page: "src/options/options.html",
  content_scripts: [
    {
      matches: ["https://www.linkedin.com/*"],
      js: ["src/content/content-script.ts"],
      css: ["src/styles/injected.css"],
      run_at: "document_idle",
      world: "ISOLATED",
    },
  ],
  content_security_policy: {
    extension_pages:
      "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; worker-src 'self'",
  },
} satisfies chrome.runtime.ManifestV3;

export default defineManifest(manifest) as typeof manifest;
