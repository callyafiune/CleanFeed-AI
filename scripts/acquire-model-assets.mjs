#!/usr/bin/env node
// Fail-closed, no-implicit-network acquisition of the pinned bundle assets.
//
//   node scripts/acquire-model-assets.mjs
//
// The CURRENT pinned bundle (cleanfeed-ptbr-v1) is SELF-TRAINED: its
// source-lock baseUrl uses the reserved `.invalid` TLD, so there is no upstream
// to fetch from and the CLI below fails closed with SELF_TRAINED_BUNDLE,
// pointing at `scripts/package-own-model.mjs` (which packages a local
// checkpoint export into the sealed layout).
//
// The acquisition machinery itself is kept intact for any future bundle with a
// real upstream: every network request is derived strictly from the pinned
// source-lock, the URL must stay within the locked baseUrl, redirects are
// refused, only HTTP 200 is accepted, the byte budget is enforced while
// streaming, and the SHA-256 is checked incrementally. Downloads land in a
// private SOURCE staging directory under stagingParent. This function
// DELIBERATELY does not promote that staging to the public bundle target — that
// 6 -> 9 materialization belongs to a later step, after the
// license/notice/manifest files are added.
//
// All effectful dependencies (fetch, randomUUID, fs) are injectable so tests can
// serve local bytes and prove no real network is ever touched.

import { Buffer } from "node:buffer";
import console from "node:console";
import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";
import { cp, mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv, exit } from "node:process";
import { fileURLToPath, URL } from "node:url";

import {
  ModelLockError,
  readSourceLock,
  replaceDirectoryAtomically,
  verifyStagedAssets,
} from "./model-lock.mjs";
import {
  MATERIALIZED_METADATA,
  verifyMaterializedBundle,
} from "./verify-model-bundle.mjs";

const STAGING_PREFIX = ".cleanfeed-ptbr-v1.source-";
const MATERIALIZED_PREFIX = ".cleanfeed-ptbr-v1.materialized-";

/** Real filesystem adapter used when no injectable fs is supplied. */
const nodeFs = {
  async exists(path) {
    try {
      await stat(path);
      return true;
    } catch {
      return false;
    }
  },
  async mkdir(path) {
    await mkdir(path, { recursive: true });
  },
  async writeFile(path, data) {
    await writeFile(path, data);
  },
  async rename(from, to) {
    await rename(from, to);
  },
  async remove(path) {
    await rm(path, { recursive: true, force: true });
  },
};

function fail(code, message) {
  throw new ModelLockError(code, message);
}

/**
 * Fails closed when the pinned lock describes a SELF-TRAINED bundle (a baseUrl
 * on the reserved `.invalid` TLD): there is no upstream to fetch from, so any
 * acquisition attempt must stop BEFORE a single network request is derived.
 */
export function assertFetchableLock(lock) {
  const host = new URL(lock.baseUrl).hostname;
  if (host === "invalid" || host.endsWith(".invalid")) {
    fail(
      "SELF_TRAINED_BUNDLE",
      `the pinned bundle "${lock.modelId}" is self-trained (baseUrl ${lock.baseUrl}); ` +
        "there is no upstream to download. Package a local checkpoint export with " +
        "`node scripts/package-own-model.mjs --artifacts <dir> --model-id " +
        `${lock.modelId}\` instead of \`npm run model:fetch\`.`,
    );
  }
}

/**
 * Streams one artifact from `url`, enforcing status, byte budget and hash. The
 * fetch response is never trusted for size: the budget is checked as bytes
 * arrive so a lying Content-Length cannot exhaust memory.
 */
async function downloadArtifact(fetchImpl, url, artifact) {
  const response = await fetchImpl(url, { redirect: "error" });
  if (!response || response.status !== 200) {
    fail(
      "FETCH_FAILED",
      `unexpected status for ${url}: ${response ? response.status : "no response"}`,
    );
  }

  const hash = createHash("sha256");
  const chunks = [];
  let total = 0;

  if (response.body) {
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > artifact.bytes) {
        fail(
          "SIZE_MISMATCH",
          `${artifact.path} exceeds ${artifact.bytes} bytes`,
        );
      }
      hash.update(value);
      chunks.push(Buffer.from(value));
    }
  } else {
    const buffer = Buffer.from(await response.arrayBuffer());
    total = buffer.length;
    if (total > artifact.bytes) {
      fail("SIZE_MISMATCH", `${artifact.path} exceeds ${artifact.bytes} bytes`);
    }
    hash.update(buffer);
    chunks.push(buffer);
  }

  if (total !== artifact.bytes) {
    fail(
      "SIZE_MISMATCH",
      `${artifact.path} is ${total} bytes, expected ${artifact.bytes}`,
    );
  }
  if (hash.digest("hex") !== artifact.sha256) {
    fail("HASH_MISMATCH", `${artifact.path} has an unexpected sha256`);
  }
  return Buffer.concat(chunks);
}

export async function acquireModelSourceAssets({
  lockPath,
  stagingParent,
  dependencies = {},
}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const uuid = dependencies.randomUUID ?? nodeRandomUUID;
  const fs = dependencies.fs ?? nodeFs;

  const lock = await readSourceLock(lockPath);
  const stagingDirectory = join(stagingParent, `${STAGING_PREFIX}${uuid()}`);
  await fs.mkdir(stagingDirectory);

  for (const artifact of lock.artifacts) {
    const url = new URL(artifact.path, lock.baseUrl);
    if (url.protocol !== "https:" || !url.href.startsWith(lock.baseUrl)) {
      fail("INVALID_URL", `artifact URL escapes the pinned base: ${url.href}`);
    }
    const bytes = await downloadArtifact(fetchImpl, url.href, artifact);
    const filePath = join(stagingDirectory, ...artifact.path.split("/"));
    await fs.mkdir(dirname(filePath));
    await fs.writeFile(filePath, bytes);
  }

  const { fileCount } = await verifyStagedAssets(stagingDirectory, lock);
  return { fileCount, stagingDirectory };
}

/**
 * Materializes the closed nine-file bundle and promotes it atomically to
 * `target`. It copies the six verified source assets from `sourceStaging`
 * plus the three versioned metadata/legal files from `versionedDir` into a
 * FRESH materialized staging (a sibling of `target`), runs the exact-nine
 * verifier, and only then replaces `target`. It never mixes files with an
 * existing target. In `finally` it deletes only the materialized staging it
 * created — a validated sibling — which is a no-op once the atomic rename has
 * consumed it.
 */
export async function materializeModelBundle({
  sourceStaging,
  versionedDir,
  target,
  lock,
  dependencies = {},
}) {
  const uuid = dependencies.randomUUID ?? nodeRandomUUID;
  const fs = dependencies.fs ?? nodeFs;
  const copyFile = dependencies.cp ?? cp;

  const materialized = join(dirname(target), `${MATERIALIZED_PREFIX}${uuid()}`);

  try {
    await copyFile(sourceStaging, materialized, { recursive: true });
    for (const name of MATERIALIZED_METADATA) {
      await copyFile(join(versionedDir, name), join(materialized, name));
    }
    const { fileCount } = await verifyMaterializedBundle(materialized, {
      lock,
    });
    await replaceDirectoryAtomically(materialized, target, fs);
    return { fileCount, target };
  } finally {
    await fs.remove(materialized);
  }
}

if (argv[1] === fileURLToPath(import.meta.url)) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const versionedDir = join(scriptDir, "..", "models", "cleanfeed-ptbr-v1");
  const lockPath = join(versionedDir, "source-lock.json");
  const stagingParent = join(scriptDir, "..", "public", "models");
  const target = join(stagingParent, "cleanfeed-ptbr-v1");

  const lock = await readSourceLock(lockPath);
  try {
    // The pinned bundle is self-trained: this fails closed BEFORE any network
    // request is derived, pointing at the packaging script instead.
    assertFetchableLock(lock);
  } catch (error) {
    console.error(
      `model:fetch FAILED: ${error.code ?? "ERROR"} — ${error.message ?? error}`,
    );
    exit(1);
  }
  const { stagingDirectory } = await acquireModelSourceAssets({
    lockPath,
    stagingParent,
  });
  try {
    await materializeModelBundle({
      sourceStaging: stagingDirectory,
      versionedDir,
      target,
      lock,
    });
  } finally {
    await rm(stagingDirectory, { recursive: true, force: true });
  }
}
