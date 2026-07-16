import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  assertOfflineAssetInventory,
  copyTransformersAssets,
} from "../../scripts/copy-transformers-assets.mjs";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

describe("offline Transformers assets", () => {
  it("fails the build inventory when a referenced WASM asset is absent", async () => {
    const missingAssetDir = await temporaryDirectory("cleanfeed-missing-wasm-");

    await expect(assertOfflineAssetInventory(missingAssetDir)).rejects.toThrow(
      "MODEL_LOAD_FAILED",
    );
  });

  it("copies only hashed local WASM runtime assets", async () => {
    const outputDirectory = await temporaryDirectory("cleanfeed-wasm-assets-");
    const sourceDirectory = join(
      process.cwd(),
      "node_modules",
      "onnxruntime-web",
      "dist",
    );

    await copyTransformersAssets({ sourceDirectory, outputDirectory });

    await expect(assertOfflineAssetInventory(outputDirectory)).resolves.toEqual(
      expect.objectContaining({ assets: expect.any(Array) }),
    );
    const manifest = await assertOfflineAssetInventory(outputDirectory);
    expect(manifest.assets.map((asset) => asset.file).sort()).toEqual([
      "ort-wasm-simd-threaded.mjs",
      "ort-wasm-simd-threaded.wasm",
    ]);
    expect(
      manifest.assets.every((asset) => /^[a-f0-9]{64}$/u.test(asset.sha256)),
    ).toBe(true);
  });
});
