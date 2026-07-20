import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { acquireModelSourceAssets } from "../../scripts/acquire-model-assets.mjs";
import {
  readSourceLock,
  replaceDirectoryAtomically,
  verifyStagedAssets,
} from "../../scripts/model-lock.mjs";
import type { AtomicDirectoryFs } from "../../scripts/model-lock.mjs";

const FIXED_REVISION = "b9aa251e5bcda7e429fcc936767d921435945b60";
const FIXED_BASE_URL = `https://huggingface.co/onnx-community/tmr-ai-text-detector-ONNX/resolve/${FIXED_REVISION}/`;

const SEVEN_PATHS = [
  "config.json",
  "merges.txt",
  "onnx/model_int8.onnx",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.json",
] as const;

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function syntheticContents(): Record<string, Buffer> {
  const contents: Record<string, Buffer> = {};
  for (const path of SEVEN_PATHS) {
    contents[path] = Buffer.from(`synthetic upstream bytes :: ${path}`);
  }
  return contents;
}

/** Writes a synthetic (small) source-lock describing the given contents. */
async function writeSyntheticLock(
  dir: string,
  contents: Record<string, Buffer>,
): Promise<string> {
  const lock = {
    schemaVersion: 1,
    modelId: "tmr-ai-text-detector",
    revision: FIXED_REVISION,
    baseUrl: FIXED_BASE_URL,
    artifacts: SEVEN_PATHS.map((path) => ({
      path,
      bytes: contents[path].length,
      sha256: sha256(contents[path]),
    })),
  };
  const lockPath = join(dir, "source-lock.json");
  await writeFile(lockPath, JSON.stringify(lock, null, 2));
  return lockPath;
}

/**
 * A fake fetch that only serves the exact per-artifact URLs it was given and
 * throws on anything else. If this ever hit the real network the throw proves
 * it, because no real URL is registered.
 */
function makeFetch(contents: Record<string, Buffer>): {
  fetchImpl: typeof globalThis.fetch;
  calls: Array<{ url: string; redirect: unknown }>;
} {
  const byUrl = new Map<string, Buffer>();
  for (const path of SEVEN_PATHS) {
    byUrl.set(new URL(path, FIXED_BASE_URL).href, contents[path]);
  }
  const calls: Array<{ url: string; redirect: unknown }> = [];
  const fetchImpl = (async (input: unknown, init?: { redirect?: unknown }) => {
    const url = String(input);
    calls.push({ url, redirect: init?.redirect });
    const body = byUrl.get(url);
    if (!body) {
      throw new Error(`UNEXPECTED_URL (no network in tests): ${url}`);
    }
    return new Response(new Uint8Array(body), { status: 200 });
  }) as unknown as typeof globalThis.fetch;
  return { fetchImpl, calls };
}

const realFs: AtomicDirectoryFs = {
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

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const full = join(dir, entry.name);
      return entry.isDirectory() ? listFilesRecursive(full) : [full];
    }),
  );
  return nested.flat();
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "cleanfeed-acquire-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("acquireModelSourceAssets", () => {
  it("stages exactly seven verified assets from injected bytes", async () => {
    const contents = syntheticContents();
    const lockPath = await writeSyntheticLock(workDir, contents);
    const stagingParent = join(workDir, "public-models");
    await mkdir(stagingParent, { recursive: true });
    const { fetchImpl, calls } = makeFetch(contents);

    const result = await acquireModelSourceAssets({
      lockPath,
      stagingParent,
      dependencies: { fetch: fetchImpl, randomUUID: () => "fixedid" },
    });

    expect(result.fileCount).toBe(7);
    expect(result.stagingDirectory).toBe(
      join(stagingParent, ".tmr-ai-text-detector.source-fixedid"),
    );
    const files = await listFilesRecursive(result.stagingDirectory);
    expect(files).toHaveLength(7);
    await expect(
      verifyStagedAssets(result.stagingDirectory, await readSourceLock(lockPath)),
    ).resolves.toEqual({ fileCount: 7 });
    expect(calls).toHaveLength(7);
    expect(calls.every((call) => call.redirect === "error")).toBe(true);
  });

  it("does not promote the staging into the public bundle target", async () => {
    const contents = syntheticContents();
    const lockPath = await writeSyntheticLock(workDir, contents);
    const stagingParent = join(workDir, "public-models");
    await mkdir(stagingParent, { recursive: true });
    const { fetchImpl } = makeFetch(contents);

    const result = await acquireModelSourceAssets({
      lockPath,
      stagingParent,
      dependencies: { fetch: fetchImpl, randomUUID: () => "fixedid" },
    });

    await expect(
      stat(join(stagingParent, "tmr-ai-text-detector")),
    ).rejects.toThrow();
    expect(result.stagingDirectory).toContain(
      ".tmr-ai-text-detector.source-",
    );
  });

  it("fails closed when the fake fetch is asked for an unregistered URL", async () => {
    const contents = syntheticContents();
    const lockPath = await writeSyntheticLock(workDir, contents);
    const stagingParent = join(workDir, "public-models");
    await mkdir(stagingParent, { recursive: true });
    const emptyFetch = (async (input: unknown) => {
      throw new Error(`UNEXPECTED_URL: ${String(input)}`);
    }) as unknown as typeof globalThis.fetch;

    await expect(
      acquireModelSourceAssets({
        lockPath,
        stagingParent,
        dependencies: { fetch: emptyFetch, randomUUID: () => "fixedid" },
      }),
    ).rejects.toThrow(/UNEXPECTED_URL/u);
  });

  it("rejects a non-200 response", async () => {
    const contents = syntheticContents();
    const lockPath = await writeSyntheticLock(workDir, contents);
    const stagingParent = join(workDir, "public-models");
    await mkdir(stagingParent, { recursive: true });
    const notFound = (async () =>
      new Response(null, { status: 404 })) as unknown as typeof globalThis.fetch;

    await expect(
      acquireModelSourceAssets({
        lockPath,
        stagingParent,
        dependencies: { fetch: notFound, randomUUID: () => "fixedid" },
      }),
    ).rejects.toMatchObject({ code: "FETCH_FAILED" });
  });
});

describe("replaceDirectoryAtomically (real filesystem)", () => {
  it("promotes then re-promotes a directory across sibling renames", async () => {
    const parent = join(workDir, "promote");
    const target = join(parent, "bundle");
    await mkdir(parent, { recursive: true });

    const firstStaging = join(parent, "staging-1");
    await mkdir(firstStaging, { recursive: true });
    await writeFile(join(firstStaging, "marker.txt"), "first");
    await replaceDirectoryAtomically(firstStaging, target, realFs);
    expect(await realFs.exists(target)).toBe(true);

    const secondStaging = join(parent, "staging-2");
    await mkdir(secondStaging, { recursive: true });
    await writeFile(join(secondStaging, "marker.txt"), "second");
    await replaceDirectoryAtomically(secondStaging, target, realFs);

    const remaining = await readdir(parent);
    expect(remaining).toEqual(["bundle"]);
    expect(remaining.some((name) => name.includes(".backup-"))).toBe(false);
  });
});
