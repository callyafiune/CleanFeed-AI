import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  acquireModelSourceAssets,
  assertFetchableLock,
} from "../../scripts/acquire-model-assets.mjs";
import {
  readSourceLock,
  replaceDirectoryAtomically,
  verifyStagedAssets,
} from "../../scripts/model-lock.mjs";
import type { AtomicDirectoryFs } from "../../scripts/model-lock.mjs";

const FIXED_REVISION = "d8f77f870fbd35a17add2498b73d906bbc299026";
const FIXED_BASE_URL = `https://self-trained.invalid/cleanfeed-ptbr-v1/${FIXED_REVISION}/`;

const SIX_PATHS = [
  "config.json",
  "onnx/model_int8.onnx",
  "special_tokens_map.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "vocab.txt",
] as const;

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

function syntheticContents(): Record<string, Buffer> {
  const contents: Record<string, Buffer> = {};
  for (const path of SIX_PATHS) {
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
    modelId: "cleanfeed-ptbr-v1",
    revision: FIXED_REVISION,
    baseUrl: FIXED_BASE_URL,
    artifacts: SIX_PATHS.map((path) => ({
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
  for (const path of SIX_PATHS) {
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
  it("stages exactly six verified assets from injected bytes", async () => {
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

    expect(result.fileCount).toBe(6);
    expect(result.stagingDirectory).toBe(
      join(stagingParent, ".cleanfeed-ptbr-v1.source-fixedid"),
    );
    const files = await listFilesRecursive(result.stagingDirectory);
    expect(files).toHaveLength(6);
    await expect(
      verifyStagedAssets(
        result.stagingDirectory,
        await readSourceLock(lockPath),
      ),
    ).resolves.toEqual({ fileCount: 6 });
    expect(calls).toHaveLength(6);
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
      stat(join(stagingParent, "cleanfeed-ptbr-v1")),
    ).rejects.toThrow();
    expect(result.stagingDirectory).toContain(".cleanfeed-ptbr-v1.source-");
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
      new Response(null, {
        status: 404,
      })) as unknown as typeof globalThis.fetch;

    await expect(
      acquireModelSourceAssets({
        lockPath,
        stagingParent,
        dependencies: { fetch: notFound, randomUUID: () => "fixedid" },
      }),
    ).rejects.toMatchObject({ code: "FETCH_FAILED" });
  });
});

describe("assertFetchableLock (self-trained bundle guard)", () => {
  it("fails closed on the checked-in self-trained lock, pointing at the packaging script", async () => {
    const lock = await readSourceLock(
      join(process.cwd(), "models", "cleanfeed-ptbr-v1", "source-lock.json"),
    );
    expect(() => assertFetchableLock(lock)).toThrowError(
      /package-own-model\.mjs/u,
    );
    try {
      assertFetchableLock(lock);
    } catch (error) {
      expect((error as { code?: string }).code).toBe("SELF_TRAINED_BUNDLE");
    }
  });

  it("accepts a lock whose baseUrl has a real (non-.invalid) host", () => {
    expect(() =>
      assertFetchableLock({
        modelId: "some-upstream-model",
        baseUrl: "https://huggingface.co/acme/some-upstream-model/resolve/rev/",
      }),
    ).not.toThrow();
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
