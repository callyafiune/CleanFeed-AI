#!/usr/bin/env node
// Closed source-lock parser and staging verifier for the sealed model bundle.
//
//   node scripts/model-lock.mjs --verify <directory>
//
// This module is the single source of truth for WHICH pinned assets the sealed
// bundle is made of and HOW they are verified. It consumes only Node built-ins
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

/** Immutable revision the whole bundle is pinned to (first 40 hex of the onnx SHA-256). */
export const PINNED_REVISION = "d8f77f870fbd35a17add2498b73d906bbc299026";

export const PINNED_MODEL_ID = "cleanfeed-ptbr-v1";

/**
 * The only base URL the lock is allowed to reference. The bundle is trained by
 * the project itself, so there is no upstream to fetch from: the reserved
 * `.invalid` TLD states that syntactically-URL but unresolvable provenance.
 */
export const PINNED_BASE_URL = `https://self-trained.invalid/${PINNED_MODEL_ID}/${PINNED_REVISION}/`;

/**
 * The canonical, closed inventory of the six pinned assets, with the exact
 * byte length and SHA-256 of each. This mirrors the checked-in source-lock.json
 * and exists so callers can reference the pinned truth from code.
 */
export const SOURCE_ARTIFACTS = Object.freeze(
  [
    {
      path: "config.json",
      bytes: 1006,
      sha256:
        "06d604123f03f6eb6d51149f5b00c42df7d94824425ad9bbbeed08f4b55c67cd",
    },
    {
      path: "onnx/model_int8.onnx",
      bytes: 109681931,
      sha256:
        "d8f77f870fbd35a17add2498b73d906bbc299026f95582532f47210ef561015b",
    },
    {
      path: "special_tokens_map.json",
      bytes: 695,
      sha256:
        "5d5b662e421ea9fac075174bb0688ee0d9431699900b90662acd44b2a350503a",
    },
    {
      path: "tokenizer.json",
      bytes: 678043,
      sha256:
        "d665c8154c740c907a233b29bc5ef681965cbdaffb6eba8bf7ee9740493904b2",
    },
    {
      path: "tokenizer_config.json",
      bytes: 1518,
      sha256:
        "82391e0b4e9bae12d0c3bb33393a2d57c8bfa3d885f53771ab65add68cb39706",
    },
    {
      path: "vocab.txt",
      bytes: 209528,
      sha256:
        "69c28584c67a0e5018f85ca734aa272cc38e26b5dd0d33fffa28059299f21707",
    },
  ].map((artifact) => Object.freeze({ ...artifact })),
);

const EXPECTED_ARTIFACT_COUNT = 6;
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
 * or off-revision baseUrl, anything other than exactly six safe relative
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
    if (
      typeof entry.sha256 !== "string" ||
      !SHA256_PATTERN.test(entry.sha256)
    ) {
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
 * Verifies that a SOURCE staging directory contains EXACTLY the six pinned
 * assets and nothing else, each with the declared byte length and SHA-256.
 * Resolves with { fileCount: 6 } or throws a coded ModelLockError.
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
 * Verifies that the six pinned assets are present and intact inside a
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
      "cleanfeed-ptbr-v1",
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
