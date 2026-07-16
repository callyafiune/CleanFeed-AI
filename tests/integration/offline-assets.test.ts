import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  assertOfflineAssetInventory,
  resolveTransformersWasmAssets,
} from "../../scripts/copy-transformers-assets.mjs";

const distDirectory = join(process.cwd(), "dist");
const distAssetDirectory = join(distDirectory, "vendor", "transformers-wasm");
const transformersDistDirectory = join(
  process.cwd(),
  "node_modules",
  "@huggingface",
  "transformers",
  "dist",
);

describe("offline Transformers assets", () => {
  it("fails the build inventory when a referenced WASM asset is absent", async () => {
    await expect(
      assertOfflineAssetInventory(join(distDirectory, "missing-runtime")),
    ).rejects.toThrow("MODEL_LOAD_FAILED");
  });

  it("ships exactly the WASM files resolved by the installed Transformers runtime", async () => {
    const resolvedAssets = await resolveTransformersWasmAssets(
      transformersDistDirectory,
    );
    const manifest = await assertOfflineAssetInventory(
      distAssetDirectory,
      resolvedAssets,
    );
    expect(manifest.assets.map((asset) => asset.file).sort()).toEqual(
      resolvedAssets,
    );
    expect(manifest.runtime).toEqual({
      transformers: expect.any(String),
      onnxruntimeWeb: expect.any(String),
    });
    expect(
      manifest.assets.every((asset) => /^[a-f0-9]{64}$/u.test(asset.sha256)),
    ).toBe(true);
  });

  it("ships no remote runtime references in extension code or local assets", async () => {
    const files = await collectTextFiles(distDirectory);
    const contents = await Promise.all(
      files.map((file) => readFile(file, "utf8")),
    );

    expect(contents.join("\n")).not.toMatch(
      /https?:\/\/(?:[^/]+\.)?(?:huggingface\.co|cdn[^/]*)/iu,
    );
  });
});

async function collectTextFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) return collectTextFiles(path);
      return /\.(?:html|js|json|mjs)$/u.test(entry.name) ? [path] : [];
    }),
  );
  return files.flat();
}
