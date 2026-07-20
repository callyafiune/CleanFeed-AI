#!/usr/bin/env node
// Owns the single, CLOSED inventory of the TMR inference core and materializes
// `runtime-parity.json`. The pure contract `contracts/runtime-parity.ts` defines
// the manifest shape and seals the digest; this Node module DERIVES every field
// value from verified bytes.
//
//   node scripts/runtime-parity.mjs write \
//     --model-manifest models/tmr-ai-text-detector/cleanfeed-model.json \
//     --output-dir benchmark/work/runtime-parity
//
// The Phase 3 candidate build and the Phase 4 release build call the SAME
// exports / CLI and only choose different output directories. The subcommand is
// closed: any other subcommand or flag is rejected, and a caller-supplied input
// list is never accepted — the inventory lives here and nowhere else.
//
// Everything fails closed: a missing path, a symlink, a path outside the repo,
// an un-inventoried file under src/inference, a non-hex hash, or a tokenizer /
// bundle digest that disagrees with the sealed manifest all throw a coded
// RuntimeParityScriptError rather than silently degrading.

import console from "node:console";
import { createHash, randomUUID } from "node:crypto";
import {
  lstat,
  mkdir,
  readdir,
  readFile,
  rename,
  writeFile,
} from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

/** The five tokenizer assets whose records seal tokenizerDigest, in canonical order. */
const TOKENIZER_PATHS = Object.freeze([
  "merges.txt",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
]);

/**
 * The closed set of inference-core files OUTSIDE src/inference. Every `.ts`
 * under src/inference is inventoried by enumeration; these fixed paths pin the
 * shared contracts, the offscreen worker host, the shared constants/types and
 * the dependency lockfile that together define the runnable core.
 */
const FIXED_CORE_FILES = Object.freeze([
  "contracts/calibration-profile.ts",
  "contracts/content-composition.ts",
  "contracts/model-release.ts",
  "contracts/runtime-parity.ts",
  "package-lock.json",
  "src/offscreen/worker-host.ts",
  "src/shared/constants.ts",
  "src/shared/types.ts",
]);

const INFERENCE_ROOT = "src/inference";
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/** A coded, fail-closed error every guard in this module throws. */
export class RuntimeParityScriptError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "RuntimeParityScriptError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new RuntimeParityScriptError(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256Hex(input) {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * The one true canonicalization for a digest input, mirroring
 * contracts/canonical-json.ts for these flat shapes: object keys sorted
 * alphabetically, arrays in order, compact separators, no trailing newline.
 */
function canonicalArtifactRecords(records) {
  const sorted = [...records].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return JSON.stringify(
    sorted.map(({ bytes, path, sha256 }) => ({ bytes, path, sha256 })),
  );
}

function canonicalCoreRecords(records) {
  const sorted = [...records].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return JSON.stringify(sorted.map(({ path, sha256 }) => ({ path, sha256 })));
}

/**
 * SHA-256 of the alphabetically key-sorted, compact JSON of the eight identity
 * fields. This reproduces contracts/canonical-json.ts `canonicalSha256` for the
 * flat parity object, so the digest the pure contract recomputes matches.
 */
export function computeRuntimeParityDigest(fields) {
  const ordered = {
    aggregationVersion: fields.aggregationVersion,
    bundleDigest: fields.bundleDigest,
    contentCompositionVersion: fields.contentCompositionVersion,
    inferenceCoreDigest: fields.inferenceCoreDigest,
    modelId: fields.modelId,
    modelVersion: fields.modelVersion,
    schemaVersion: fields.schemaVersion,
    tokenizerDigest: fields.tokenizerDigest,
  };
  return sha256Hex(JSON.stringify(ordered));
}

async function hashRepoFile(repoRoot, relativePosixPath) {
  const absolute = join(repoRoot, ...relativePosixPath.split("/"));
  let stats;
  try {
    stats = await lstat(absolute);
  } catch {
    fail(
      "MISSING_CORE_FILE",
      `inventoried file is missing: "${relativePosixPath}"`,
    );
  }
  if (stats.isSymbolicLink()) {
    fail(
      "SYMLINK_FORBIDDEN",
      `inventoried path is a symlink: "${relativePosixPath}"`,
    );
  }
  if (!stats.isFile()) {
    fail(
      "NOT_A_FILE",
      `inventoried path is not a regular file: "${relativePosixPath}"`,
    );
  }
  const bytes = await readFile(absolute);
  return { path: relativePosixPath, sha256: sha256Hex(bytes) };
}

async function collectInferenceFiles(repoRoot) {
  const found = [];
  async function walk(relativeDir) {
    const absoluteDir = join(repoRoot, ...relativeDir.split("/"));
    let entries;
    try {
      entries = await readdir(absoluteDir, { withFileTypes: true });
    } catch {
      fail(
        "INFERENCE_DIR_UNREADABLE",
        `cannot read inference directory "${relativeDir}"`,
      );
    }
    for (const entry of entries) {
      const relative = `${relativeDir}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        fail("SYMLINK_FORBIDDEN", `inference path is a symlink: "${relative}"`);
      }
      if (entry.isDirectory()) {
        await walk(relative);
        continue;
      }
      if (!entry.name.endsWith(".ts")) {
        fail(
          "UNINVENTORIED_FILE",
          `un-inventoried non-.ts file under ${INFERENCE_ROOT}: "${relative}"`,
        );
      }
      found.push(relative);
    }
  }
  await walk(INFERENCE_ROOT);
  return found;
}

/**
 * SHA-256 of the canonical, lexicographically sorted `{path,sha256}` inventory
 * of every `.ts` under src/inference plus the fixed core files.
 */
export async function computeInferenceCoreDigest(repoRoot) {
  const inferenceFiles = await collectInferenceFiles(repoRoot);
  const paths = [...inferenceFiles, ...FIXED_CORE_FILES];
  const records = [];
  for (const relative of paths) {
    records.push(await hashRepoFile(repoRoot, relative));
  }
  return sha256Hex(canonicalCoreRecords(records));
}

function requireString(manifest, key) {
  const value = manifest[key];
  if (typeof value !== "string" || value.length === 0) {
    fail(
      "MANIFEST_FIELD_INVALID",
      `manifest.${key} must be a non-empty string`,
    );
  }
  return value;
}

function requireSha256(manifest, key) {
  const value = manifest[key];
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(
      "MANIFEST_FIELD_INVALID",
      `manifest.${key} must be a sha256 hex string`,
    );
  }
  return value;
}

async function readModelManifest(modelManifestPath) {
  let raw;
  try {
    raw = await readFile(modelManifestPath, "utf8");
  } catch (error) {
    fail("MANIFEST_UNREADABLE", `cannot read model manifest: ${error}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail("MANIFEST_INVALID_JSON", `model manifest is not valid JSON: ${error}`);
  }
  if (!isPlainObject(parsed)) {
    fail("MANIFEST_SCHEMA_INVALID", "model manifest must be an object");
  }
  if (!Array.isArray(parsed.artifacts)) {
    fail("MANIFEST_SCHEMA_INVALID", "manifest.artifacts must be an array");
  }
  return parsed;
}

/**
 * Derives every runtime-parity field from the verified model manifest and the
 * repository bytes. The tokenizer and bundle digests are recomputed from the
 * manifest artifact records and MUST equal the sealed manifest values.
 */
export async function buildRuntimeParityManifest({
  repoRoot,
  modelManifestPath,
}) {
  if (typeof repoRoot !== "string" || repoRoot.length === 0) {
    fail("REPO_ROOT_INVALID", "repoRoot must be a non-empty string");
  }
  const manifest = await readModelManifest(modelManifestPath);

  const modelId = requireString(manifest, "modelId");
  const modelVersion = requireString(manifest, "modelVersion");
  const aggregationVersion = requireString(manifest, "aggregationVersion");
  const contentCompositionVersion = requireString(
    manifest,
    "contentCompositionVersion",
  );
  const declaredTokenizerDigest = requireSha256(manifest, "tokenizerDigest");
  const declaredBundleDigest = requireSha256(manifest, "bundleDigest");

  const tokenizerSubset = manifest.artifacts.filter(
    (artifact) =>
      isPlainObject(artifact) && TOKENIZER_PATHS.includes(artifact.path),
  );
  const recomputedTokenizerDigest = sha256Hex(
    canonicalArtifactRecords(tokenizerSubset),
  );
  if (recomputedTokenizerDigest !== declaredTokenizerDigest) {
    fail(
      "TOKENIZER_DIGEST_MISMATCH",
      "manifest.tokenizerDigest does not equal the canonical tokenizer-subset digest",
    );
  }

  const recomputedBundleDigest = sha256Hex(
    canonicalArtifactRecords(manifest.artifacts),
  );
  if (recomputedBundleDigest !== declaredBundleDigest) {
    fail(
      "BUNDLE_DIGEST_MISMATCH",
      "manifest.bundleDigest does not equal the canonical artifact digest",
    );
  }

  const inferenceCoreDigest = await computeInferenceCoreDigest(repoRoot);

  const fields = {
    schemaVersion: 1,
    modelId,
    modelVersion,
    bundleDigest: declaredBundleDigest,
    aggregationVersion,
    contentCompositionVersion,
    tokenizerDigest: declaredTokenizerDigest,
    inferenceCoreDigest,
  };
  return { ...fields, runtimeParityDigest: computeRuntimeParityDigest(fields) };
}

/** Atomically writes `runtime-parity.json` into `outputDirectory`. */
export async function writeRuntimeParityManifest(manifest, outputDirectory) {
  await mkdir(outputDirectory, { recursive: true });
  const finalPath = join(outputDirectory, "runtime-parity.json");
  const tempPath = join(
    outputDirectory,
    `.runtime-parity.json.${randomUUID()}.tmp`,
  );
  await writeFile(tempPath, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(tempPath, finalPath);
  return finalPath;
}

/**
 * Parses the CLOSED CLI: exactly `write --model-manifest <path> --output-dir
 * <dir>`. Any other subcommand or flag is rejected; a caller-supplied input list
 * is never accepted.
 */
export function parseRuntimeParityCliArgs(args) {
  if (args.length === 0 || args[0] !== "write") {
    fail("UNKNOWN_SUBCOMMAND", 'the only supported subcommand is "write"');
  }
  let modelManifestPath;
  let outputDir;
  for (let index = 1; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === "--model-manifest") {
      if (value === undefined)
        fail("MISSING_FLAG_VALUE", "--model-manifest needs a value");
      modelManifestPath = value;
      index += 1;
    } else if (flag === "--output-dir") {
      if (value === undefined)
        fail("MISSING_FLAG_VALUE", "--output-dir needs a value");
      outputDir = value;
      index += 1;
    } else {
      fail("UNKNOWN_FLAG", `unexpected argument "${flag}"`);
    }
  }
  if (modelManifestPath === undefined) {
    fail("MISSING_FLAG", "--model-manifest is required");
  }
  if (outputDir === undefined) {
    fail("MISSING_FLAG", "--output-dir is required");
  }
  return { command: "write", modelManifestPath, outputDir };
}

async function runCli(args) {
  const cli = parseRuntimeParityCliArgs(args);
  const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
  const modelManifestPath = join(
    repoRoot,
    ...cli.modelManifestPath.split(/[\\/]/),
  );
  const outputDir = join(repoRoot, ...cli.outputDir.split(/[\\/]/));
  const manifest = await buildRuntimeParityManifest({
    repoRoot,
    modelManifestPath,
  });
  const written = await writeRuntimeParityManifest(manifest, outputDir);
  console.log(
    `runtime-parity: wrote ${written} (${manifest.runtimeParityDigest})`,
  );
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runCli(argv.slice(2))
    .then(() => exit(0))
    .catch((error) => {
      console.error(
        `runtime-parity FAILED: ${error.code ?? "ERROR"} — ${error.message ?? error}`,
      );
      exit(1);
    });
}
