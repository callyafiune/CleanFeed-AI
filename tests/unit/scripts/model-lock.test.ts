import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  SOURCE_ARTIFACTS,
  readSourceLock,
  replaceDirectoryAtomically,
  verifyStagedAssets,
} from "../../../scripts/model-lock.mjs";
import type { AtomicDirectoryFs } from "../../../scripts/model-lock.mjs";

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

const CHECKED_IN_LOCK = join(
  process.cwd(),
  "models",
  "tmr-ai-text-detector",
  "source-lock.json",
);

function sha256(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex");
}

/** A structurally valid lock object, used as the mutation base for negatives. */
function baseLock(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    modelId: "tmr-ai-text-detector",
    revision: FIXED_REVISION,
    baseUrl: FIXED_BASE_URL,
    artifacts: SEVEN_PATHS.map((path, index) => ({
      path,
      bytes: 100 + index,
      sha256: "a".repeat(64),
    })),
  };
}

/** Synthetic bytes for every upstream asset; small enough to hash in-test. */
function syntheticContents(): Record<string, Buffer> {
  const contents: Record<string, Buffer> = {};
  for (const path of SEVEN_PATHS) {
    contents[path] = Buffer.from(`synthetic bytes for ${path}\n`);
  }
  return contents;
}

/** A lock whose sizes/hashes describe the given synthetic contents exactly. */
function lockForContents(contents: Record<string, Buffer>): {
  artifacts: Array<{ path: string; bytes: number; sha256: string }>;
} {
  return {
    artifacts: SEVEN_PATHS.map((path) => ({
      path,
      bytes: contents[path].length,
      sha256: sha256(contents[path]),
    })),
  };
}

async function stageContents(
  root: string,
  contents: Record<string, Buffer>,
): Promise<void> {
  for (const [path, buffer] of Object.entries(contents)) {
    const filePath = join(root, ...path.split("/"));
    await mkdir(dirname(filePath), { recursive: true });
    await writeFile(filePath, buffer);
  }
}

/** Deterministic in-memory filesystem for exercising the atomic replace. */
class FakeFs implements AtomicDirectoryFs {
  readonly existing: Set<string>;
  readonly renameLog: Array<[string, string]> = [];
  readonly removeLog: string[] = [];
  renameCalls = 0;
  failRenameAt: number | undefined;

  constructor(existing: string[]) {
    this.existing = new Set(existing);
  }

  async exists(path: string): Promise<boolean> {
    return this.existing.has(path);
  }

  async mkdir(_path: string): Promise<void> {}

  async writeFile(_path: string, _data: Uint8Array): Promise<void> {}

  async rename(from: string, to: string): Promise<void> {
    this.renameCalls += 1;
    if (this.failRenameAt === this.renameCalls) {
      throw new Error(`injected rename failure (#${this.renameCalls})`);
    }
    if (!this.existing.has(from)) {
      throw new Error(`ENOENT: ${from}`);
    }
    this.existing.delete(from);
    this.existing.add(to);
    this.renameLog.push([from, to]);
  }

  async remove(path: string): Promise<void> {
    this.existing.delete(path);
    this.removeLog.push(path);
  }
}

let workDir: string;

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), "cleanfeed-model-lock-"));
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeLock(object: unknown): Promise<string> {
  const lockPath = join(
    workDir,
    `lock-${Math.random().toString(36).slice(2)}.json`,
  );
  await writeFile(lockPath, JSON.stringify(object, null, 2));
  return lockPath;
}

describe("SOURCE_ARTIFACTS", () => {
  it("is the canonical seven-asset inventory in order", () => {
    expect(SOURCE_ARTIFACTS.map((item) => item.path)).toEqual([...SEVEN_PATHS]);
  });

  it("matches the checked-in source-lock.json byte-for-byte", async () => {
    const lock = await readSourceLock(CHECKED_IN_LOCK);
    expect(lock.artifacts).toEqual([...SOURCE_ARTIFACTS]);
  });
});

describe("readSourceLock", () => {
  it("parses the checked-in lock and lists exactly the seven upstream paths", async () => {
    const lock = await readSourceLock(CHECKED_IN_LOCK);
    expect(lock.artifacts.map((item) => item.path)).toEqual([
      "config.json",
      "merges.txt",
      "onnx/model_int8.onnx",
      "special_tokens_map.json",
      "tokenizer.json",
      "tokenizer_config.json",
      "vocab.json",
    ]);
    expect(lock.revision).toBe(FIXED_REVISION);
    expect(lock.baseUrl).toBe(FIXED_BASE_URL);
  });

  it("accepts a structurally valid lock", async () => {
    const lockPath = await writeLock(baseLock());
    const lock = await readSourceLock(lockPath);
    expect(lock.artifacts).toHaveLength(7);
  });

  it("rejects unknown top-level keys", async () => {
    const lockPath = await writeLock({ ...baseLock(), rogue: true });
    await expect(readSourceLock(lockPath)).rejects.toMatchObject({
      code: "UNKNOWN_KEY",
    });
  });

  it("rejects an absolute artifact path", async () => {
    const lock = baseLock();
    (lock.artifacts as Array<{ path: string }>)[0].path = "/etc/passwd";
    const lockPath = await writeLock(lock);
    await expect(readSourceLock(lockPath)).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("rejects a parent-traversal artifact path", async () => {
    const lock = baseLock();
    (lock.artifacts as Array<{ path: string }>)[0].path = "../secret.onnx";
    const lockPath = await writeLock(lock);
    await expect(readSourceLock(lockPath)).rejects.toMatchObject({
      code: "INVALID_PATH",
    });
  });

  it("rejects a baseUrl outside the pinned host and revision", async () => {
    const lock = baseLock();
    lock.baseUrl = "https://evil.example.com/resolve/deadbeef/";
    const lockPath = await writeLock(lock);
    await expect(readSourceLock(lockPath)).rejects.toMatchObject({
      code: "INVALID_BASE_URL",
    });
  });

  it("rejects normalized duplicate paths", async () => {
    const lock = baseLock();
    (lock.artifacts as Array<{ path: string }>)[1].path = "config.json";
    const lockPath = await writeLock(lock);
    await expect(readSourceLock(lockPath)).rejects.toMatchObject({
      code: "DUPLICATE_ARTIFACT",
    });
  });
});

describe("verifyStagedAssets", () => {
  it("resolves with a seven-file count for a pristine staging", async () => {
    const contents = syntheticContents();
    await stageContents(workDir, contents);
    await expect(
      verifyStagedAssets(workDir, lockForContents(contents)),
    ).resolves.toEqual({ fileCount: 7 });
  });

  it("rejects when an unexpected file is present", async () => {
    const contents = syntheticContents();
    await stageContents(workDir, contents);
    await writeFile(join(workDir, "EXTRA.txt"), "surprise");
    await expect(
      verifyStagedAssets(workDir, lockForContents(contents)),
    ).rejects.toMatchObject({ code: "UNEXPECTED_ARTIFACT" });
  });

  it("rejects when a declared file is missing", async () => {
    const contents = syntheticContents();
    const { ["config.json"]: _omitted, ...partial } = contents;
    await stageContents(workDir, partial);
    await expect(
      verifyStagedAssets(workDir, lockForContents(contents)),
    ).rejects.toMatchObject({ code: "MISSING_ARTIFACT" });
  });

  it("rejects when a file size disagrees with the lock", async () => {
    const contents = syntheticContents();
    await stageContents(workDir, contents);
    const lock = lockForContents(contents);
    lock.artifacts[0].bytes += 1;
    await expect(verifyStagedAssets(workDir, lock)).rejects.toMatchObject({
      code: "SIZE_MISMATCH",
    });
  });

  it("rejects when a file hash disagrees with the lock", async () => {
    const contents = syntheticContents();
    await stageContents(workDir, contents);
    const lock = lockForContents(contents);
    lock.artifacts[0].sha256 = "b".repeat(64);
    await expect(verifyStagedAssets(workDir, lock)).rejects.toMatchObject({
      code: "HASH_MISMATCH",
    });
  });
});

describe("replaceDirectoryAtomically", () => {
  const parent = join(tmpdir(), "cleanfeed-atomic-replace");
  const staging = join(parent, "staging");
  const target = join(parent, "target");

  it("renames staging into an absent target without a backup", async () => {
    const fs = new FakeFs([staging]);
    await replaceDirectoryAtomically(staging, target, fs);
    expect(fs.renameLog).toEqual([[staging, target]]);
    expect(fs.removeLog).toEqual([]);
    expect(fs.existing.has(target)).toBe(true);
  });

  it("backs up, replaces, then deletes the backup when target preexists", async () => {
    const fs = new FakeFs([staging, target]);
    await replaceDirectoryAtomically(staging, target, fs);
    expect(fs.renameLog).toHaveLength(2);
    const [firstFrom, backupPath] = fs.renameLog[0];
    expect(firstFrom).toBe(target);
    expect(backupPath.startsWith(join(parent, ".backup-"))).toBe(true);
    expect(fs.renameLog[1]).toEqual([staging, target]);
    expect(fs.removeLog).toEqual([backupPath]);
    expect(fs.existing.has(target)).toBe(true);
  });

  it("propagates and leaves the target intact if the first rename fails", async () => {
    const fs = new FakeFs([staging, target]);
    fs.failRenameAt = 1;
    await expect(
      replaceDirectoryAtomically(staging, target, fs),
    ).rejects.toThrow();
    expect(fs.renameLog).toEqual([]);
    expect(fs.removeLog).toEqual([]);
    expect(fs.existing.has(target)).toBe(true);
    expect(fs.existing.has(staging)).toBe(true);
  });

  it("rolls the backup back if the second rename fails", async () => {
    const fs = new FakeFs([staging, target]);
    fs.failRenameAt = 2;
    await expect(
      replaceDirectoryAtomically(staging, target, fs),
    ).rejects.toThrow();
    expect(fs.renameLog).toHaveLength(2);
    expect(fs.renameLog[0][0]).toBe(target);
    const backupPath = fs.renameLog[0][1];
    expect(fs.renameLog[1]).toEqual([backupPath, target]);
    expect(fs.removeLog).toEqual([]);
    expect(fs.existing.has(target)).toBe(true);
    expect(fs.existing.has(staging)).toBe(true);
  });

  it("supports a second successful run over a now-existing target", async () => {
    const fs = new FakeFs([staging]);
    await replaceDirectoryAtomically(staging, target, fs);
    fs.existing.add(staging);
    await replaceDirectoryAtomically(staging, target, fs);
    expect(fs.existing.has(target)).toBe(true);
    expect([...fs.existing].some((path) => path.includes(".backup-"))).toBe(
      false,
    );
  });

  it("rejects non-sibling paths", async () => {
    const fs = new FakeFs([staging]);
    await expect(
      replaceDirectoryAtomically(staging, join(tmpdir(), "elsewhere"), fs),
    ).rejects.toMatchObject({ code: "NOT_SIBLINGS" });
  });
});
