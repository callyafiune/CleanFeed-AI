import { crx } from "@crxjs/vite-plugin";
import react from "@vitejs/plugin-react";
import { isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath, URL } from "node:url";
import { defineConfig, normalizePath, type Plugin } from "vite";
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

/** The Vite mode that authorizes the test-only release-variant metadata alias. */
export const E2E_RELEASE_VARIANT_MODE = "e2e-release-variant";

/** The absolute, POSIX-normalized path of the canonical metadata module. */
const canonicalMetadataModule = normalizePath(
  fileURLToPath(
    new URL("./src/inference/bundled-model-metadata.ts", import.meta.url),
  ),
);

/** The one directory that variant metadata is ever allowed to live under. */
const RELEASE_VARIANTS_ROOT = resolve("test-results/release-variants");

/** Strips a Vite id's `?query`/`#hash` suffix so the bare module path remains. */
function cleanUrl(url: string): string {
  const queryIndex = url.search(/[?#]/);
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

/** Requires an absolute directory string, failing closed on anything else. */
function requireAbsoluteDirectory(value: string | undefined): string {
  if (value === undefined || value.length === 0 || !isAbsolute(value)) {
    throw new Error("E2E_METADATA_DIR_NOT_ABSOLUTE");
  }
  return resolve(value);
}

/** Resolves `target` and proves it is a child of `parent` (no traversal). */
function assertChildPath(parent: string, target: string): string {
  const resolvedTarget = resolve(target);
  const rel = relative(resolve(parent), resolvedTarget);
  if (rel.length === 0 || rel.startsWith("..") || isAbsolute(rel)) {
    throw new Error("E2E_METADATA_PATH_TRAVERSAL");
  }
  return resolvedTarget;
}

/**
 * Emits the SAME closed runtime value exports as the canonical metadata module,
 * but sourcing `release.json`/`calibration-profiles.json` from the test-only
 * variant directory while keeping `cleanfeed-model.json` and `source-lock.json`
 * canonical. Types are erased at build time, so only the four values matter.
 */
function renderVariantMetadataModule(variantDirectory: string): string {
  const releasePath = normalizePath(resolve(variantDirectory, "release.json"));
  const profilesPath = normalizePath(
    resolve(variantDirectory, "calibration-profiles.json"),
  );
  return [
    `import calibrationProfilesJson from ${JSON.stringify(profilesPath)};`,
    `import releaseDescriptorJson from ${JSON.stringify(releasePath)};`,
    `import cleanfeedModelJson from "../../models/cleanfeed-ptbr-v1/cleanfeed-model.json";`,
    `import sourceLockJson from "../../models/cleanfeed-ptbr-v1/source-lock.json";`,
    ``,
    `export const bundledModelManifest = cleanfeedModelJson;`,
    `export const bundledCalibrationProfiles = calibrationProfilesJson;`,
    `export const bundledReleaseDescriptor = releaseDescriptorJson;`,
    `export const bundledSourceLock = sourceLockJson;`,
    ``,
  ].join("\n");
}

/**
 * Test-only plugin that swaps `bundled-model-metadata.ts` for a variant's
 * descriptors DURING a `--mode e2e-release-variant` build ONLY. Outside that
 * mode it is inert and throws if the variant env var leaked in, so a hostile
 * environment can never contaminate a real build. The variant directory must be
 * an absolute path inside `test-results/release-variants`; traversal, a missing
 * directory or execution outside the mode all fail closed.
 */
export function e2eReleaseMetadataPlugin(mode: string): Plugin {
  const directory = process.env.CLEANFEED_E2E_VARIANT_METADATA_DIR;
  if (mode !== E2E_RELEASE_VARIANT_MODE) {
    if (directory !== undefined)
      throw new Error("E2E_METADATA_OUTSIDE_TEST_MODE");
    return { name: "cleanfeed-canonical-model-metadata" };
  }
  const variantDirectory = assertChildPath(
    RELEASE_VARIANTS_ROOT,
    requireAbsoluteDirectory(directory),
  );
  return {
    name: "cleanfeed-e2e-model-metadata",
    enforce: "pre",
    load(id) {
      if (normalizePath(cleanUrl(id)) !== canonicalMetadataModule) return null;
      return renderVariantMetadataModule(variantDirectory);
    },
  };
}

export default defineConfig(({ mode }) => ({
  base: "./",
  assetsInclude: ["**/*.wasm"],
  plugins: [
    react(),
    crx({ manifest }),
    offlineTransformersRuntime(),
    e2eReleaseMetadataPlugin(mode),
  ],
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
}));

// The on-demand manual-analysis panel is injected via chrome.scripting under a
// user gesture and is NOT a content script. chrome.scripting.executeScript runs
// the file as a classic (non-module) script, so it cannot be one of the ES
// module chunks this crxjs build emits. It is built separately, as a single
// self-contained IIFE, by vite.manual-analysis.config.ts into dist/manual-analysis.js.
