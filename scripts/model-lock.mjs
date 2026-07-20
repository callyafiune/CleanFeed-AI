#!/usr/bin/env node
// Closed source-lock parser and staging verifier for the TMR model bundle.
//
//   node scripts/model-lock.mjs --verify <directory>
//
// This module is the single source of truth for WHICH upstream assets the TMR
// bundle is pinned to and HOW they are verified. It consumes only Node built-ins
// (fs, crypto, path) plus fetch (in the acquisition module). It imports NOTHING
// from the extension runtime, so it can never widen the build's attack surface.
//
// Everything fails closed: an unknown key, an unsafe path, a size or hash
// mismatch, or an unexpected file all throw a coded ModelLockError rather than
// silently degrading.

import console from "node:console";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath } from "node:url";

/** Immutable upstream revision the whole bundle is pinned to. */
export const PINNED_REVISION = "b9aa251e5bcda7e429fcc936767d921435945b60";

/** The only host/repo/revision base the lock is allowed to reference. */
export const PINNED_BASE_URL = `https://huggingface.co/onnx-community/tmr-ai-text-detector-ONNX/resolve/${PINNED_REVISION}/`;

export const PINNED_MODEL_ID = "tmr-ai-text-detector";

/**
 * The canonical, closed inventory of the seven upstream assets, with the exact
 * byte length and SHA-256 of each. This mirrors the checked-in source-lock.json
 * and exists so callers can reference the pinned truth from code.
 */
export const SOURCE_ARTIFACTS = Object.freeze(
  [
    {
      path: "config.json",
      bytes: 866,
      sha256:
        "d9d45b537b9cf386a0ce958f8b2f840b0529ed846e45c4e26bc53a62dcb06f1f",
    },
    {
      path: "merges.txt",
      bytes: 456318,
      sha256:
        "1ce1664773c50f3e0cc8842619a93edc4624525b728b188a9e0be33b7726adc5",
    },
    {
      path: "onnx/model_int8.onnx",
      bytes: 125855418,
      sha256:
        "a1ff8a917090467375ceaf47667459e431217d5691df463c57b7194624f3ff79",
    },
    {
      path: "special_tokens_map.json",
      bytes: 958,
      sha256:
        "f23c8e6099631c233c16d9bf8dab198f610826cdd1b358f270f6d55c1863e857",
    },
    {
      path: "tokenizer.json",
      bytes: 3558741,
      sha256:
        "1f33749d010b4d63908e5c174c341622cb45039dd73a139dcd95bd74cc7e304b",
    },
    {
      path: "tokenizer_config.json",
      bytes: 1354,
      sha256:
        "288b4077af1ffb3beead6d96fccfc93beb2df9b689cbb038c4eb329165efc43a",
    },
    {
      path: "vocab.json",
      bytes: 798293,
      sha256:
        "ed19656ea1707df69134c4af35c8ceda2cc9860bf2c3495026153a133670ab5e",
    },
  ].map((artifact) => Object.freeze({ ...artifact })),
);

const EXPECTED_ARTIFACT_COUNT = 7;
const LOCK_KEYS = new Set([
  "schemaVersion",
  "modelId",
  "revision",
  "baseUrl",
  "artifacts",
]);
const ARTIFACT_KEYS = new Set(["path", "bytes", "sha256"]);
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/** A coded, fail-closed error every guard in this module throws. */
export class ModelLockError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "ModelLockError";
    this.code = code;
  }
}

function fail(code, message) {
  throw new ModelLockError(code, message);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertClosedKeys(object, allowed, context) {
  for (const key of Object.keys(object)) {
    if (!allowed.has(key)) {
      fail("UNKNOWN_KEY", `${context} has unknown key "${key}"`);
    }
  }
  for (const key of allowed) {
    if (!(key in object)) {
      fail("MISSING_KEY", `${context} is missing required key "${key}"`);
    }
  }
}

/**
 * Rejects anything that is not a safe relative POSIX path: absolute paths,
 * Windows drive letters, backslashes, and any "", "." or ".." segment.
 */
function assertSafeRelativePath(path) {
  if (typeof path !== "string" || path.length === 0) {
    fail("INVALID_PATH", "artifact path must be a non-empty string");
  }
  if (path.includes("\\")) {
    fail("INVALID_PATH", `artifact path uses a backslash: "${path}"`);
  }
  if (path.startsWith("/")) {
    fail("INVALID_PATH", `artifact path is absolute: "${path}"`);
  }
  if (/^[a-zA-Z]:/u.test(path)) {
    fail("INVALID_PATH", `artifact path has a drive letter: "${path}"`);
  }
  for (const segment of path.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      fail("INVALID_PATH", `artifact path has an unsafe segment: "${path}"`);
    }
  }
}

/**
 * Reads and closed-parses a source-lock file. Rejects unknown keys, an off-host
 * or off-revision baseUrl, anything other than exactly seven safe relative
 * POSIX paths, malformed sizes/hashes, and normalized duplicate paths. Byte and
 * hash CONTENT is verified later against staged files by verifyStagedAssets.
 */
export async function readSourceLock(lockPath) {
  let raw;
  try {
    raw = await readFile(lockPath, "utf8");
  } catch (error) {
    fail("READ_FAILED", `cannot read source lock at ${lockPath}: ${error}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    fail("INVALID_JSON", `source lock is not valid JSON: ${error}`);
  }

  if (!isPlainObject(parsed)) {
    fail("INVALID_LOCK", "source lock must be a JSON object");
  }
  assertClosedKeys(parsed, LOCK_KEYS, "source lock");

  if (parsed.schemaVersion !== 1) {
    fail("INVALID_SCHEMA_VERSION", "schemaVersion must be 1");
  }
  if (parsed.modelId !== PINNED_MODEL_ID) {
    fail("INVALID_MODEL_ID", `modelId must be "${PINNED_MODEL_ID}"`);
  }
  if (parsed.revision !== PINNED_REVISION) {
    fail("INVALID_REVISION", "revision must equal the pinned revision");
  }
  if (parsed.baseUrl !== PINNED_BASE_URL) {
    fail(
      "INVALID_BASE_URL",
      "baseUrl must be the pinned host/repo/revision resolve URL",
    );
  }

  if (
    !Array.isArray(parsed.artifacts) ||
    parsed.artifacts.length !== EXPECTED_ARTIFACT_COUNT
  ) {
    fail(
      "INVALID_ARTIFACT_COUNT",
      `artifacts must be an array of exactly ${EXPECTED_ARTIFACT_COUNT} entries`,
    );
  }

  const seen = new Set();
  const artifacts = parsed.artifacts.map((entry) => {
    if (!isPlainObject(entry)) {
      fail("INVALID_ARTIFACT", "each artifact must be an object");
    }
    assertClosedKeys(entry, ARTIFACT_KEYS, "artifact");
    assertSafeRelativePath(entry.path);
    if (!Number.isInteger(entry.bytes) || entry.bytes <= 0) {
      fail("INVALID_SIZE", `artifact "${entry.path}" has invalid bytes`);
    }
    if (typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256)) {
      fail("INVALID_HASH", `artifact "${entry.path}" has invalid sha256`);
    }
    const normalized = posix.normalize(entry.path);
    if (seen.has(normalized)) {
      fail("DUPLICATE_ARTIFACT", `duplicate artifact path "${entry.path}"`);
    }
    seen.add(normalized);
    return { path: entry.path, bytes: entry.bytes, sha256: entry.sha256 };
  });

  return {
    schemaVersion: parsed.schemaVersion,
    modelId: parsed.modelId,
    revision: parsed.revision,
    baseUrl: parsed.baseUrl,
    artifacts,
  };
}

/** Streams a file, returning its byte length and SHA-256 without buffering it. */
async function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    let bytes = 0;
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => {
      bytes += chunk.length;
      hash.update(chunk);
    });
    stream.on("error", reject);
    stream.on("end", () => resolve({ bytes, sha256: hash.digest("hex") }));
  });
}

async function listRelativePosixFiles(directory, prefix = "") {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    fail("READ_FAILED", `cannot read staging directory: ${error}`);
  }
  const files = [];
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      files.push(
        ...(await listRelativePosixFiles(join(directory, entry.name), relative)),
      );
    } else {
      files.push(relative);
    }
  }
  return files;
}

/**
 * Verifies that a SOURCE staging directory contains EXACTLY the seven pinned
 * assets and nothing else, each with the declared byte length and SHA-256.
 * Resolves with { fileCount: 7 } or throws a coded ModelLockError.
 */
export async function verifyStagedAssets(directory, lock) {
  const expected = lock.artifacts;
  const expectedPaths = new Set(expected.map((artifact) => artifact.path));

  const actual = await listRelativePosixFiles(directory);
  for (const relative of actual) {
    if (!expectedPaths.has(relative)) {
      fail(
        "UNEXPECTED_ARTIFACT",
        `staging contains an unexpected file: "${relative}"`,
      );
    }
  }

  for (const artifact of expected) {
    const filePath = join(directory, ...artifact.path.split("/"));
    let measured;
    try {
      measured = await hashFile(filePath);
    } catch {
      fail("MISSING_ARTIFACT", `staged asset is missing: "${artifact.path}"`);
    }
    if (measured.bytes !== artifact.bytes) {
      fail(
        "SIZE_MISMATCH",
        `"${artifact.path}" is ${measured.bytes} bytes, expected ${artifact.bytes}`,
      );
    }
    if (measured.sha256 !== artifact.sha256) {
      fail("HASH_MISMATCH", `"${artifact.path}" has an unexpected sha256`);
    }
  }

  return { fileCount: expected.length };
}

/**
 * Verifies that the seven pinned assets are present and intact inside a
 * directory that MAY also hold other files (e.g. the materialized bundle's
 * license/notice/manifest). Unlike verifyStagedAssets it does not forbid extra
 * files, so it is safe to run against either a source staging or a bundle.
 */
export async function verifyRequiredAssets(directory, lock) {
  for (const artifact of lock.artifacts) {
    const filePath = join(directory, ...artifact.path.split("/"));
    let measured;
    try {
      measured = await hashFile(filePath);
    } catch {
      fail("MISSING_ARTIFACT", `required asset is missing: "${artifact.path}"`);
    }
    if (measured.bytes !== artifact.bytes) {
      fail(
        "SIZE_MISMATCH",
        `"${artifact.path}" is ${measured.bytes} bytes, expected ${artifact.bytes}`,
      );
    }
    if (measured.sha256 !== artifact.sha256) {
      fail("HASH_MISMATCH", `"${artifact.path}" has an unexpected sha256`);
    }
  }
  return { fileCount: lock.artifacts.length };
}

/**
 * Atomically replaces `target` with `staging` in a Windows-recoverable way.
 * Both must be absolute sibling paths. If `target` exists it is first renamed
 * to a sibling `.backup-<uuid>`; `staging` is then renamed onto `target`. If
 * that second rename fails the backup is restored and the error rethrown. The
 * backup is deleted only after a fully successful replace. No recursive removal
 * ever escapes the validated parent directory.
 */
export async function replaceDirectoryAtomically(staging, target, fsAdapter) {
  assertAbsolute(staging, "staging");
  assertAbsolute(target, "target");
  const parent = dirname(target);
  if (dirname(staging) !== parent) {
    fail("NOT_SIBLINGS", "staging and target must share a parent directory");
  }

  const backup = join(parent, `.backup-${randomUUID()}`);
  const targetExisted = await fsAdapter.exists(target);
  if (targetExisted) {
    await fsAdapter.rename(target, backup);
  }

  try {
    await fsAdapter.rename(staging, target);
  } catch (error) {
    if (targetExisted) {
      // Second rename failed: restore the backup so target is never lost.
      await fsAdapter.rename(backup, target);
    }
    throw error;
  }

  if (targetExisted) {
    await fsAdapter.remove(backup);
  }
}

function assertAbsolute(path, label) {
  const isPosixAbsolute = path.startsWith("/");
  const isWindowsAbsolute = /^[a-zA-Z]:[\\/]/u.test(path);
  if (!isPosixAbsolute && !isWindowsAbsolute) {
    fail("NOT_ABSOLUTE", `${label} path must be absolute: "${path}"`);
  }
}

async function runVerifyCli(directory) {
  const lock = await readSourceLock(
    join(
      dirname(fileURLToPath(import.meta.url)),
      "..",
      "models",
      "tmr-ai-text-detector",
      "source-lock.json",
    ),
  );
  await verifyRequiredAssets(directory, lock);
  console.log(
    `model-lock: verified ${lock.artifacts.length} pinned asset(s) in ${directory}`,
  );
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  const verifyIndex = argv.indexOf("--verify");
  if (verifyIndex === -1 || !argv[verifyIndex + 1]) {
    console.error("usage: node scripts/model-lock.mjs --verify <directory>");
    exit(2);
  }
  try {
    await runVerifyCli(argv[verifyIndex + 1]);
    exit(0);
  } catch (error) {
    console.error(
      `model-lock verification FAILED: ${error.code ?? "ERROR"} — ${error.message ?? error}`,
    );
    exit(1);
  }
}
