#!/usr/bin/env node
// Closed verifier for the sealed TMR model bundle — metadata and materialized
// inventory.
//
//   node scripts/verify-model-bundle.mjs --metadata
//   node scripts/verify-model-bundle.mjs --bundle <directory>
//
// `--metadata` validates the three versioned descriptors (cleanfeed-model.json,
// calibration-profiles.json, release.json) against the pinned source-lock. It
// needs NO local binary: the bundle/tokenizer digests are recomputed from the
// lock records themselves, so CI and a developer build can verify identity
// without the 125MB ONNX artifact ever being present.
//
// `--bundle <dir>` verifies a MATERIALIZED bundle: exactly the closed ten-file
// inventory, each upstream asset intact by byte length and SHA-256, and the
// in-bundle manifest coherent. Any extra, missing, or tampered file fails
// closed with a coded ModelBundleError.
//
// The canonicalization used for every digest is exact and non-negotiable: an
// array of records sorted lexicographically by `path`, each serialized with
// keys in alphabetical order (`bytes`, `path`, `sha256`), compact separators
// and no trailing newline.

import console from "node:console";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

import {
  PINNED_MODEL_ID,
  PINNED_REVISION,
  readSourceLock,
  verifyRequiredAssets,
} from "./model-lock.mjs";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/** The five tokenizer assets, in canonical order, hashed into tokenizerDigest. */
const TOKENIZER_PATHS = Object.freeze([
  "merges.txt",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
]);

/** The three versioned metadata/legal files copied into the materialized bundle. */
const MATERIALIZED_METADATA = Object.freeze([
  "cleanfeed-model.json",
  "LICENSE",
  "NOTICE.md",
]);

const MANIFEST_FILENAME = "cleanfeed-model.json";

/**
 * The exact ten-file closed inventory of a materialized bundle: the seven
 * pinned upstream assets plus the manifest and the two legal files. Ordered as
 * a directory sort produces it, which is what verifyMaterializedBundle returns.
 */
export const MATERIALIZED_INVENTORY = Object.freeze([
  "LICENSE",
  "NOTICE.md",
  "cleanfeed-model.json",
  "config.json",
  "merges.txt",
  "onnx/model_int8.onnx",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
]);

/**
 * The exact TWELVE-file closed inventory of a materialized RELEASE package: the
 * ten acquisition files plus the two versioned canonical descriptors copied
 * beside them (`calibration-profiles.json`, `release.json`), in directory-sort
 * order. Only the release build materializes these two extra files, and only
 * ever inside `dist`.
 */
export const RELEASE_INVENTORY = Object.freeze([
  "LICENSE",
  "NOTICE.md",
  "calibration-profiles.json",
  "cleanfeed-model.json",
  "config.json",
  "merges.txt",
  "onnx/model_int8.onnx",
  "release.json",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
]);

/** The two versioned canonical descriptors materialized into the package. */
const RELEASE_CANONICAL_METADATA = Object.freeze([
  "calibration-profiles.json",
  "release.json",
]);

/** Fixed manifest fields whose exact literal values seal the bundle identity. */
const EXPECTED_MANIFEST_FIELDS = Object.freeze({
  task: "text-classification",
  backend: "transformers-onnx",
  modelFile: "onnx/model_int8.onnx",
  aggregationVersion: "tmr-aggregation-v2",
  contentCompositionVersion: "lexical-content-v1",
});

const EXPECTED_WINDOWING = Object.freeze({
  modelMaxTokens: 512,
  contentTokens: 510,
  overlapTokens: 64,
  maxWindows: 8,
});

const KNOWN_GATE_DECISIONS = new Set([
  "pending",
  "reject",
  "indicator",
  "actions",
]);

/** A coded, fail-closed error every guard in this module throws. */
export class ModelBundleError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ModelBundleError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ModelBundleError(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSha256(value) {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

/**
 * The one true canonicalization: records sorted lexicographically by `path`,
 * each serialized as `{bytes,path,sha256}` (alphabetical keys), compact
 * separators, no trailing newline. In Node this is exactly:
 *   JSON.stringify(records.map(({bytes,path,sha256}) => ({bytes,path,sha256})))
 */
function canonicalize(records) {
  const sorted = [...records].sort((a, b) =>
    a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
  );
  return JSON.stringify(
    sorted.map(({ bytes, path, sha256 }) => ({ bytes, path, sha256 })),
  );
}

function sha256Hex(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** SHA-256 of the canonical JSON of the given artifact records. */
export function computeBundleDigest(artifacts) {
  return sha256Hex(canonicalize(artifacts));
}

/** SHA-256 of the canonical JSON of just the five tokenizer records. */
export function computeTokenizerDigest(artifacts) {
  const subset = artifacts.filter((artifact) =>
    TOKENIZER_PATHS.includes(artifact.path),
  );
  return sha256Hex(canonicalize(subset));
}

/**
 * Canonical digest of a calibration set: the profile digests sorted
 * lexicographically, serialized compactly with no trailing newline, hashed.
 * The empty set canonicalizes to "[]".
 */
export function computeCalibrationSetDigest(profileDigests) {
  const sorted = [...profileDigests].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return sha256Hex(JSON.stringify(sorted));
}

function assertArtifactsMatchLock(actual, expected) {
  if (!Array.isArray(actual) || actual.length !== expected.length) {
    fail(
      "ARTIFACT_SET_MISMATCH",
      `manifest must list exactly ${expected.length} artifacts`,
    );
  }
  for (let index = 0; index < expected.length; index += 1) {
    const got = actual[index];
    const want = expected[index];
    if (
      !isPlainObject(got) ||
      got.path !== want.path ||
      got.bytes !== want.bytes ||
      got.sha256 !== want.sha256
    ) {
      fail(
        "ARTIFACT_SET_MISMATCH",
        `manifest artifact #${index} does not match the pinned lock record for "${want.path}"`,
      );
    }
  }
}

function verifyCalibrationProfiles(file) {
  if (!isPlainObject(file)) {
    fail(
      "CALIBRATION_SCHEMA_INVALID",
      "calibration profiles must be an object",
    );
  }
  if (file.schemaVersion !== 1) {
    fail("CALIBRATION_SCHEMA_INVALID", "calibration schemaVersion must be 1");
  }
  if (!Array.isArray(file.profiles)) {
    fail("CALIBRATION_SCHEMA_INVALID", "profiles must be an array");
  }
}

function verifyReleaseDescriptor(release) {
  if (!isPlainObject(release)) {
    fail("RELEASE_SCHEMA_INVALID", "release descriptor must be an object");
  }
  if (release.schemaVersion !== 1) {
    fail("RELEASE_SCHEMA_INVALID", "release schemaVersion must be 1");
  }
  if (typeof release.rolloutState !== "string") {
    fail("RELEASE_SCHEMA_INVALID", "rolloutState must be a string");
  }
  if (!KNOWN_GATE_DECISIONS.has(release.gateDecision)) {
    fail(
      "RELEASE_SCHEMA_INVALID",
      `unknown gateDecision "${release.gateDecision}"`,
    );
  }
  if (
    !Array.isArray(release.profileDigests) ||
    !release.profileDigests.every(isSha256)
  ) {
    fail(
      "RELEASE_SCHEMA_INVALID",
      "profileDigests must be an array of sha256 hex strings",
    );
  }
  if (release.evidenceDigest !== null && !isSha256(release.evidenceDigest)) {
    fail(
      "RELEASE_SCHEMA_INVALID",
      "evidenceDigest must be null or a sha256 hex string",
    );
  }
  if (!isSha256(release.calibrationSetDigest)) {
    fail(
      "RELEASE_SCHEMA_INVALID",
      "calibrationSetDigest must be a sha256 hex string",
    );
  }
  if (
    release.calibrationSetDigest !==
    computeCalibrationSetDigest(release.profileDigests)
  ) {
    fail(
      "RELEASE_DIGEST_MISMATCH",
      "calibrationSetDigest does not match the canonical digest of profileDigests",
    );
  }
}

/**
 * Validates the versioned descriptors against the pinned lock WITHOUT touching
 * any binary. Throws a coded ModelBundleError (or ModelLockError) on any drift;
 * returns the recomputed { bundleDigest, tokenizerDigest } on success.
 */
export function verifyModelMetadata({
  manifest,
  calibrationProfiles,
  release,
  lock,
}) {
  if (!isPlainObject(manifest)) {
    fail("MANIFEST_SCHEMA_INVALID", "manifest must be an object");
  }
  if (manifest.schemaVersion !== 2) {
    fail("MANIFEST_SCHEMA_INVALID", "manifest schemaVersion must be 2");
  }
  if (manifest.modelId !== PINNED_MODEL_ID) {
    fail("MANIFEST_FIELD_INVALID", `modelId must be "${PINNED_MODEL_ID}"`);
  }
  if (manifest.modelVersion !== PINNED_REVISION) {
    fail(
      "MANIFEST_FIELD_INVALID",
      "modelVersion must equal the pinned revision",
    );
  }
  for (const [key, value] of Object.entries(EXPECTED_MANIFEST_FIELDS)) {
    if (manifest[key] !== value) {
      fail("MANIFEST_FIELD_INVALID", `${key} must be "${value}"`);
    }
  }
  if (!isPlainObject(manifest.windowing)) {
    fail("MANIFEST_FIELD_INVALID", "windowing must be an object");
  }
  for (const [key, value] of Object.entries(EXPECTED_WINDOWING)) {
    if (manifest.windowing[key] !== value) {
      fail("MANIFEST_FIELD_INVALID", `windowing.${key} must be ${value}`);
    }
  }
  if (!isSha256(manifest.tokenizerDigest)) {
    fail(
      "MANIFEST_FIELD_INVALID",
      "tokenizerDigest must be a sha256 hex string",
    );
  }
  if (!isSha256(manifest.bundleDigest)) {
    fail("MANIFEST_FIELD_INVALID", "bundleDigest must be a sha256 hex string");
  }

  assertArtifactsMatchLock(manifest.artifacts, lock.artifacts);

  const bundleDigest = computeBundleDigest(manifest.artifacts);
  if (manifest.bundleDigest !== bundleDigest) {
    fail(
      "BUNDLE_DIGEST_MISMATCH",
      "bundleDigest does not equal the canonical digest of the records",
    );
  }
  const tokenizerDigest = computeTokenizerDigest(manifest.artifacts);
  if (manifest.tokenizerDigest !== tokenizerDigest) {
    fail(
      "TOKENIZER_DIGEST_MISMATCH",
      "tokenizerDigest does not equal the canonical tokenizer-subset digest",
    );
  }

  if (calibrationProfiles !== undefined) {
    verifyCalibrationProfiles(calibrationProfiles);
  }
  if (release !== undefined) {
    verifyReleaseDescriptor(release);
  }

  return { bundleDigest, tokenizerDigest };
}

async function listRelativePosixFiles(directory, prefix = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    fail(
      "BUNDLE_UNREADABLE",
      `cannot read bundle directory ${directory}: ${error}`,
    );
  }
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(
        ...(await listRelativePosixFiles(
          join(directory, entry.name),
          relative,
        )),
      );
    } else {
      files.push(relative);
    }
  }
  return files;
}

/**
 * Verifies a materialized bundle directory: the file SET must equal the closed
 * ten-file inventory (so a missing legal file, or a leaked license-review.json,
 * fails), the seven upstream assets must be intact by size and hash, and the
 * in-bundle manifest must itself verify. Returns { fileCount, paths }.
 */
export async function verifyMaterializedBundle(bundleDir, { lock }) {
  const actual = (await listRelativePosixFiles(bundleDir)).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const allowed = new Set(MATERIALIZED_INVENTORY);
  for (const file of actual) {
    if (!allowed.has(file)) {
      fail(
        "BUNDLE_SET_MISMATCH",
        `bundle contains an unexpected file: "${file}"`,
      );
    }
  }
  const present = new Set(actual);
  for (const file of MATERIALIZED_INVENTORY) {
    if (!present.has(file)) {
      fail(
        "BUNDLE_SET_MISMATCH",
        `bundle is missing a required file: "${file}"`,
      );
    }
  }

  // Verify the seven upstream assets sequentially (streamed) to bound memory.
  await verifyRequiredAssets(bundleDir, lock);

  // The copied manifest must itself verify against the pinned lock.
  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(join(bundleDir, MANIFEST_FILENAME), "utf8"),
    );
  } catch (error) {
    fail("MANIFEST_UNREADABLE", `cannot read in-bundle manifest: ${error}`);
  }
  verifyModelMetadata({ manifest, lock });

  return { fileCount: MATERIALIZED_INVENTORY.length, paths: actual };
}

/**
 * Verifies a materialized RELEASE package directory: exactly the closed
 * twelve-file inventory, the seven upstream assets intact, the in-bundle
 * manifest coherent, AND the two canonical descriptors (`release.json`,
 * `calibration-profiles.json`) byte-identical to the versioned sources under
 * `metadataDir`. Any extra, missing or drifted file fails closed. Returns
 * { fileCount, paths }.
 */
export async function verifyReleaseModelDirectory(
  bundleDir,
  { lock, metadataDir },
) {
  const actual = (await listRelativePosixFiles(bundleDir)).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const allowed = new Set(RELEASE_INVENTORY);
  for (const file of actual) {
    if (!allowed.has(file)) {
      fail(
        "RELEASE_SET_MISMATCH",
        `release package contains an unexpected file: "${file}"`,
      );
    }
  }
  const present = new Set(actual);
  for (const file of RELEASE_INVENTORY) {
    if (!present.has(file)) {
      fail(
        "RELEASE_SET_MISMATCH",
        `release package is missing a required file: "${file}"`,
      );
    }
  }

  await verifyRequiredAssets(bundleDir, lock);

  let manifest;
  try {
    manifest = JSON.parse(
      await readFile(join(bundleDir, MANIFEST_FILENAME), "utf8"),
    );
  } catch (error) {
    fail("MANIFEST_UNREADABLE", `cannot read in-bundle manifest: ${error}`);
  }
  verifyModelMetadata({ manifest, lock });

  // The two canonical descriptors must be byte-for-byte the versioned sources.
  for (const name of RELEASE_CANONICAL_METADATA) {
    let packaged;
    let versioned;
    try {
      packaged = await readFile(join(bundleDir, name));
      versioned = await readFile(join(metadataDir, name));
    } catch (error) {
      fail(
        "RELEASE_METADATA_DRIFT",
        `cannot read canonical descriptor "${name}": ${error}`,
      );
    }
    if (!packaged.equals(versioned)) {
      fail(
        "RELEASE_METADATA_DRIFT",
        `packaged "${name}" is not byte-identical to the versioned source`,
      );
    }
  }

  return { fileCount: RELEASE_INVENTORY.length, paths: actual };
}

export { MATERIALIZED_METADATA };

async function runCli() {
  const modelsDir = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "models",
    "tmr-ai-text-detector",
  );
  const lock = await readSourceLock(join(modelsDir, "source-lock.json"));

  if (argv.includes("--metadata")) {
    const manifest = JSON.parse(
      await readFile(join(modelsDir, "cleanfeed-model.json"), "utf8"),
    );
    const calibrationProfiles = JSON.parse(
      await readFile(join(modelsDir, "calibration-profiles.json"), "utf8"),
    );
    const release = JSON.parse(
      await readFile(join(modelsDir, "release.json"), "utf8"),
    );
    const { bundleDigest } = verifyModelMetadata({
      manifest,
      calibrationProfiles,
      release,
      lock,
    });
    console.log(`model metadata OK — bundleDigest ${bundleDigest}`);
    return;
  }

  const bundleIndex = argv.indexOf("--bundle");
  if (bundleIndex !== -1 && argv[bundleIndex + 1]) {
    const bundleDir = argv[bundleIndex + 1];
    const { fileCount } = await verifyMaterializedBundle(bundleDir, { lock });
    console.log(`bundle OK — ${fileCount} files verified in ${bundleDir}`);
    return;
  }

  console.error(
    "usage: node scripts/verify-model-bundle.mjs --metadata | --bundle <dir>",
  );
  exit(2);
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  runCli()
    .then(() => exit(0))
    .catch((error) => {
      console.error(
        `model bundle verification FAILED: ${error.code ?? "ERROR"} — ${error.message ?? error}`,
      );
      exit(1);
    });
}
