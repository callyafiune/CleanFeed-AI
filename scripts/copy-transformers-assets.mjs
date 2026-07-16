import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const REQUIRED_ASSETS = [
  "ort-wasm-simd-threaded.mjs",
  "ort-wasm-simd-threaded.wasm",
];
const ASSET_MANIFEST = "assets-manifest.json";
const assetName = /^[a-z0-9][a-z0-9.-]*\.(?:mjs|wasm)$/u;
const sha256 = /^[a-f0-9]{64}$/u;

export async function copyTransformersAssets({
  sourceDirectory = resolve(
    runtimeDirectory,
    "../node_modules/onnxruntime-web/dist",
  ),
  outputDirectory = resolve(
    runtimeDirectory,
    "../public/vendor/transformers-wasm",
  ),
} = {}) {
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const assets = [];
  for (const file of REQUIRED_ASSETS) {
    if (!assetName.test(file)) modelLoadFailed();
    const source = join(sourceDirectory, file);
    const destination = join(outputDirectory, file);
    let contents;
    try {
      contents = await readFile(source);
    } catch {
      modelLoadFailed();
    }
    await cp(source, destination);
    assets.push({ file, sha256: hash(contents) });
  }

  const manifest = { version: 1, assets };
  await writeFile(
    join(outputDirectory, ASSET_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await assertOfflineAssetInventory(outputDirectory);
  return manifest;
}

export async function assertOfflineAssetInventory(assetDirectory) {
  let manifest;
  let files;
  try {
    manifest = JSON.parse(
      await readFile(join(assetDirectory, ASSET_MANIFEST), "utf8"),
    );
    files = await readdir(assetDirectory, { withFileTypes: true });
  } catch {
    modelLoadFailed();
  }

  if (
    !isManifest(manifest) ||
    manifest.assets
      .map(({ file }) => file)
      .sort()
      .join("\n") !== [...REQUIRED_ASSETS].sort().join("\n") ||
    files.some((file) => !file.isFile()) ||
    files
      .map((file) => file.name)
      .sort()
      .join("\n") !== [...REQUIRED_ASSETS, ASSET_MANIFEST].sort().join("\n")
  ) {
    modelLoadFailed();
  }

  for (const asset of manifest.assets) {
    let contents;
    try {
      contents = await readFile(join(assetDirectory, asset.file));
    } catch {
      modelLoadFailed();
    }
    if (hash(contents) !== asset.sha256) modelLoadFailed();
  }
  return manifest;
}

function isManifest(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.version === 1 &&
    Array.isArray(value.assets) &&
    value.assets.length === REQUIRED_ASSETS.length &&
    value.assets.every(
      (asset) =>
        asset !== null &&
        typeof asset === "object" &&
        Object.keys(asset).length === 2 &&
        typeof asset.file === "string" &&
        assetName.test(asset.file) &&
        typeof asset.sha256 === "string" &&
        sha256.test(asset.sha256),
    )
  );
}

function hash(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function modelLoadFailed() {
  throw new Error("MODEL_LOAD_FAILED");
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  await copyTransformersAssets();
}
