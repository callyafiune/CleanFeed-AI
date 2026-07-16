import { createHash } from "node:crypto";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

const runtimeDirectory = dirname(fileURLToPath(import.meta.url));
const ASSET_MANIFEST = "assets-manifest.json";
const assetName = /^[a-z0-9][a-z0-9.-]*\.(?:mjs|wasm)$/u;
const sha256 = /^[a-f0-9]{64}$/u;

export async function copyTransformersAssets({
  sourceDirectory = resolve(
    runtimeDirectory,
    "../node_modules/onnxruntime-web/dist",
  ),
  transformersDistDirectory = resolve(
    runtimeDirectory,
    "../node_modules/@huggingface/transformers/dist",
  ),
  outputDirectory = resolve(
    runtimeDirectory,
    "../public/vendor/transformers-wasm",
  ),
} = {}) {
  const requiredAssets = await resolveTransformersWasmAssets(
    transformersDistDirectory,
  );
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });

  const assets = [];
  for (const file of requiredAssets) {
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

  const manifest = {
    version: 1,
    runtime: {
      transformers: await packageVersion(
        join(transformersDistDirectory, "../package.json"),
      ),
      onnxruntimeWeb: await packageVersion(
        join(sourceDirectory, "../package.json"),
      ),
    },
    assets,
  };
  await writeFile(
    join(outputDirectory, ASSET_MANIFEST),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await assertOfflineAssetInventory(outputDirectory, requiredAssets);
  return manifest;
}

export async function resolveTransformersWasmAssets(transformersDistDirectory) {
  let runtime;
  try {
    runtime = await readFile(
      join(transformersDistDirectory, "transformers.web.js"),
      "utf8",
    );
  } catch {
    modelLoadFailed();
  }
  const assets = [
    ...new Set(
      runtime.match(/ort-wasm-simd-threaded[\w.-]*\.(?:mjs|wasm)/gu) ?? [],
    ),
  ].sort();
  if (assets.length === 0 || assets.some((asset) => !assetName.test(asset))) {
    modelLoadFailed();
  }
  return assets;
}

export async function assertOfflineAssetInventory(
  assetDirectory,
  requiredAssets,
) {
  requiredAssets ??= await resolveTransformersWasmAssets(
    resolve(runtimeDirectory, "../node_modules/@huggingface/transformers/dist"),
  );
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
      .join("\n") !== [...requiredAssets].sort().join("\n") ||
    files.some((file) => !file.isFile()) ||
    files
      .map((file) => file.name)
      .sort()
      .join("\n") !== [...requiredAssets, ASSET_MANIFEST].sort().join("\n")
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
    isRuntimeProvenance(value.runtime) &&
    Array.isArray(value.assets) &&
    value.assets.length > 0 &&
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

function isRuntimeProvenance(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.keys(value).length === 2 &&
    typeof value.transformers === "string" &&
    value.transformers.length > 0 &&
    typeof value.onnxruntimeWeb === "string" &&
    value.onnxruntimeWeb.length > 0
  );
}

async function packageVersion(packageJsonPath) {
  let value;
  try {
    value = JSON.parse(await readFile(packageJsonPath, "utf8"));
  } catch {
    modelLoadFailed();
  }
  if (
    value === null ||
    typeof value !== "object" ||
    typeof value.version !== "string" ||
    value.version.length === 0
  ) {
    modelLoadFailed();
  }
  return value.version;
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
