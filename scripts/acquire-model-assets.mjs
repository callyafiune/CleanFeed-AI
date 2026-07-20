#!/usr/bin/env node
// Fail-closed, no-implicit-network acquisition of the seven pinned TMR assets.
//
//   node scripts/acquire-model-assets.mjs
//
// Every network request is derived strictly from the pinned source-lock: the
// URL must stay within the locked baseUrl, redirects are refused, only HTTP 200
// is accepted, the byte budget is enforced while streaming, and the SHA-256 is
// checked incrementally. Downloads land in a private SOURCE staging directory
// under stagingParent. This function DELIBERATELY does not promote that staging
// to the public bundle target — that 7 -> 10 materialization belongs to a later
// step, after the license/notice/manifest files are added.
//
// All effectful dependencies (fetch, randomUUID, fs) are injectable so tests can
// serve local bytes and prove no real network is ever touched.

import { createHash, randomUUID as nodeRandomUUID } from "node:crypto";
import { mkdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";

import {
  ModelLockError,
  readSourceLock,
  verifyStagedAssets,
} from "./model-lock.mjs";

const STAGING_PREFIX = ".tmr-ai-text-detector.source-";

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
        fail("SIZE_MISMATCH", `${artifact.path} exceeds ${artifact.bytes} bytes`);
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

if (argv[1] === fileURLToPath(import.meta.url)) {
  const scriptDir = dirname(fileURLToPath(import.meta.url));
  const lockPath = join(
    scriptDir,
    "..",
    "models",
    "tmr-ai-text-detector",
    "source-lock.json",
  );
  const stagingParent = join(scriptDir, "..", "public", "models");
  await acquireModelSourceAssets({ lockPath, stagingParent });
}
