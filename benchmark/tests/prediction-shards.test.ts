import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { BrowserScoreRun } from "../browser-scorer.ts";
import { sha256BytesHex } from "../digests.ts";
import {
  parsePredictionManifest,
  type StrictPredictionV2,
} from "../prediction-schema.ts";
import { createPredictionShardStore } from "../prediction-shards.ts";

const CREATED_AT = "2026-07-19T00:00:00.000Z";
const created: string[] = [];

afterEach(async () => {
  await Promise.all(
    created.map((dir) => rm(dir, { recursive: true, force: true })),
  );
  created.length = 0;
});

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "cf-shards-"));
  created.push(dir);
  return dir;
}

function hex(label: string): string {
  let out = "";
  for (const ch of label) out += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return out.padEnd(64, "0").slice(0, 64);
}

function devRun(overrides: Partial<BrowserScoreRun> = {}): BrowserScoreRun {
  return {
    schemaVersion: 1,
    runId: "run-development-0001",
    datasetDigest: hex("dataset"),
    splitDigest: hex("split"),
    partition: "development",
    modelId: "cleanfeed-ptbr-v1",
    modelVersion: "1.0.0",
    bundleDigest: hex("bundle"),
    aggregationVersion: "tmr-aggregation-v3",
    contentCompositionVersion: "lexical-content-v2",
    tokenizerDigest: hex("tokenizer"),
    runtimeParityDigest: hex("parity"),
    extensionBuildDigest: hex("build"),
    chromeVersion: "150.0.7871.129",
    backend: "wasm",
    holdoutConsumptionId: null,
    shardSize: 100,
    ...overrides,
  };
}

function row(
  id: string,
  overrides: Partial<StrictPredictionV2> = {},
): StrictPredictionV2 {
  return {
    schemaVersion: 2,
    id,
    status: "scored",
    documentRawScore: 0.6,
    localizedRawScore: 0.7,
    evidenceQuality: "sufficient",
    reasonCode: "SCORED",
    coverage: 1,
    latencyMs: 20,
    memoryBytes: 1000,
    ...overrides,
  };
}

function ids(count: number, offset = 0): string[] {
  return Array.from(
    { length: count },
    (_unused, index) => `post-${String(index + offset).padStart(4, "0")}`,
  );
}

describe("prediction shard store", () => {
  it("writes 100-id shards and finalizes a valid strict manifest", async () => {
    const dir = await tempDir();
    const run = devRun();
    const store = createPredictionShardStore({
      directory: dir,
      createdAt: CREATED_AT,
    });
    await store.open(run);
    const first = ids(100, 0);
    const second = ids(50, 100);
    await store.writeAtomic(
      0,
      first.map((id) => row(id)),
    );
    await store.writeAtomic(
      1,
      second.map((id) => row(id)),
    );
    const manifest = await store.finalize([...first, ...second]);

    expect(manifest.shardSize).toBe(100);
    expect(manifest.shardCount).toBe(2);
    expect(manifest.shards[0].file).toBe("000000.jsonl");
    expect(manifest.shards[0].recordCount).toBe(100);
    expect(manifest.shards[1].file).toBe("000001.jsonl");
    expect(manifest.shards[1].recordCount).toBe(50);
    expect(manifest.partition).toBe("development");
    expect(manifest.holdoutConsumptionId).toBeNull();

    // The written manifest round-trips through the closed parser, and each shard
    // digest matches the real bytes on disk. The name is `manifest.json` because
    // that is what readPredictionArtifact — and therefore validate-predictions,
    // fit, evaluate and consume-holdout — opens.
    const rawManifest = JSON.parse(
      await readFile(join(dir, "manifest.json"), "utf8"),
    );
    const parsed = parsePredictionManifest(rawManifest, {
      scientificUse: "release",
    });
    for (const shard of parsed.shards) {
      const bytes = await readFile(join(dir, shard.file));
      expect(sha256BytesHex(new Uint8Array(bytes))).toBe(shard.sha256);
    }
  });

  it("never serializes text, spans, author, url, prompt or content hash", async () => {
    const dir = await tempDir();
    const store = createPredictionShardStore({
      directory: dir,
      createdAt: CREATED_AT,
    });
    await store.open(devRun());
    const forbidden = { ...row("post-0001"), text: "conteúdo privado" };
    await expect(
      store.writeAtomic(0, [forbidden as unknown as StrictPredictionV2]),
    ).rejects.toThrow(/forbidden|text/iu);
  });

  it("rejects a duplicate id across shards at finalize", async () => {
    const dir = await tempDir();
    const store = createPredictionShardStore({
      directory: dir,
      createdAt: CREATED_AT,
    });
    await store.open(devRun());
    await store.writeAtomic(0, [row("post-0000")]);
    await store.writeAtomic(1, [row("post-0000")]);
    await expect(store.finalize(["post-0000"])).rejects.toThrow(/duplicate/iu);
  });

  it("rejects a duplicate id within a single shard write", async () => {
    const dir = await tempDir();
    const store = createPredictionShardStore({
      directory: dir,
      createdAt: CREATED_AT,
    });
    await store.open(devRun());
    await expect(
      store.writeAtomic(0, [row("post-0000"), row("post-0000")]),
    ).rejects.toThrow(/duplicate/iu);
  });

  it("rejects missing or extra ids against the expected set", async () => {
    const dir = await tempDir();
    const store = createPredictionShardStore({
      directory: dir,
      createdAt: CREATED_AT,
    });
    await store.open(devRun());
    await store.writeAtomic(0, [row("post-0000"), row("post-0001")]);
    await expect(
      store.finalize(["post-0000", "post-0001", "post-0002"]),
    ).rejects.toThrow(/missing/iu);
    await expect(store.finalize(["post-0000"])).rejects.toThrow(/extra/iu);
  });

  it("resumes an identical run, returning committed ids and ignoring temp files", async () => {
    const dir = await tempDir();
    const run = devRun();
    const first = createPredictionShardStore({
      directory: dir,
      createdAt: CREATED_AT,
    });
    await first.open(run);
    const shardIds = ids(100, 0);
    await first.writeAtomic(
      0,
      shardIds.map((id) => row(id)),
    );

    // A crash may leave a stray temp file behind; resume must ignore it.
    await writeFile(join(dir, ".12345.99.tmp"), "partial garbage");

    const resumed = createPredictionShardStore({
      directory: dir,
      createdAt: CREATED_AT,
    });
    await resumed.open(run);
    const completed = await resumed.completedIds();
    expect(completed.size).toBe(100);
    expect([...completed].sort()).toEqual([...shardIds].sort());
  });

  it("refuses to resume when the browser score run drifts (four-part chrome version)", async () => {
    const dir = await tempDir();
    const run = devRun();
    const first = createPredictionShardStore({
      directory: dir,
      createdAt: CREATED_AT,
    });
    await first.open(run);
    await first.writeAtomic(0, [row("post-0000")]);

    const drifted = {
      ...run,
      chromeVersion: "150.0.7871.130",
    } as unknown as BrowserScoreRun;
    const resumed = createPredictionShardStore({
      directory: dir,
      createdAt: CREATED_AT,
    });
    await expect(resumed.open(drifted)).rejects.toThrow(/SHARD_RUN_MISMATCH/u);
  });
});
