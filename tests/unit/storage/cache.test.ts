import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ClassificationResult, Clock, StorageArea } from "@/shared/types";
import { buildCacheKey, ClassificationCache } from "@/storage/cache";

class MemoryStorageArea implements StorageArea {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.values.delete(key);
    }
  }

  async getMany<T>(keys: string[]): Promise<Record<string, T>> {
    return Object.fromEntries(
      keys
        .filter((key) => this.values.has(key))
        .map((key) => [key, this.values.get(key) as T]),
    );
  }
}

class TestClock implements Clock {
  constructor(private time = 1_000) {}

  now(): number {
    return this.time;
  }

  advanceBy(milliseconds: number): void {
    this.time += milliseconds;
  }
}

const result: ClassificationResult = {
  aiScore: 0.8,
  humanScore: 0.2,
  confidence: "medium",
  status: "possibly_ai",
  wordCount: 100,
  tokenCount: 120,
  modelVersion: "m1",
  modelId: "model",
  backend: "mock",
  processingTimeMs: 12,
  demo: true,
};

function createCache(
  options: { maximumEntries?: number; ttlMs?: number } = {},
) {
  const storage = new MemoryStorageArea();
  const clock = new TestClock();
  const cache = new ClassificationCache(storage, clock, {
    maximumEntries:
      options.maximumEntries ?? DEFAULT_SETTINGS.cacheMaximumEntries,
    ttlMs: options.ttlMs ?? DEFAULT_SETTINGS.cacheTtlMs,
  });

  return { cache, storage, clock };
}

describe("ClassificationCache", () => {
  it("never retains debug timings in a cached classification", async () => {
    const { cache, storage } = createCache();
    const debugResult = {
      ...result,
      stageTimings: {
        languageMs: 1,
        tokenizationMs: 2,
        chunkingMs: 3,
        inferenceMs: 4,
        aggregationMs: 5,
        calibrationMs: 6,
      },
    };

    await cache.set("debug", debugResult);

    await expect(cache.get("debug")).resolves.toEqual(result);
    expect(
      JSON.stringify(await storage.get("cleanfeed.cache.entry.debug")),
    ).not.toContain("stageTimings");
  });

  it("removes debug timings from legacy cache entries before returning them", async () => {
    const { cache, storage } = createCache();
    const debugResult = {
      ...result,
      stageTimings: {
        languageMs: 1,
        tokenizationMs: 2,
        chunkingMs: 3,
        inferenceMs: 4,
        aggregationMs: 5,
        calibrationMs: 6,
      },
    };
    await storage.set("cleanfeed.cache.index.v1", {
      entries: [{ key: "legacy", lastAccessedAt: 1_000, expiresAt: 2_000 }],
    });
    await storage.set("cleanfeed.cache.entry.legacy", {
      result: debugResult,
      createdAt: 1_000,
      lastAccessedAt: 1_000,
      expiresAt: 2_000,
    });

    await expect(cache.get("legacy")).resolves.toEqual(result);
    expect(
      JSON.stringify(await storage.get("cleanfeed.cache.entry.legacy")),
    ).not.toContain("stageTimings");
  });

  it("returns a stored entry and updates its recency", async () => {
    const { cache, storage, clock } = createCache();

    await cache.set("entry", result);
    clock.advanceBy(5);

    await expect(cache.get("entry")).resolves.toEqual(result);
    await expect(storage.get("cleanfeed.cache.index.v1")).resolves.toEqual({
      entries: [
        {
          key: "entry",
          lastAccessedAt: 1_005,
          expiresAt: 1_000 + DEFAULT_SETTINGS.cacheTtlMs,
        },
      ],
    });
  });

  it("expires and removes stale entries", async () => {
    const { cache, storage, clock } = createCache();

    await cache.set("entry", result);
    clock.advanceBy(DEFAULT_SETTINGS.cacheTtlMs + 1);

    await expect(cache.get("entry")).resolves.toBeUndefined();
    await expect(
      storage.get("cleanfeed.cache.entry.entry"),
    ).resolves.toBeUndefined();
  });

  it("evicts least recently used entries", async () => {
    const { cache, clock } = createCache({ maximumEntries: 2 });

    await cache.set("a", result);
    await cache.set("b", result);
    clock.advanceBy(1);
    await cache.get("a");
    await cache.set("c", result);

    await expect(cache.get("b")).resolves.toBeUndefined();
    await expect(cache.get("a")).resolves.toEqual(result);
    await expect(cache.get("c")).resolves.toEqual(result);
  });

  it("removes corrupt stored entries and their index metadata", async () => {
    const { cache, storage } = createCache();
    await storage.set("cleanfeed.cache.index.v1", {
      entries: [{ key: "bad", lastAccessedAt: 1_000, expiresAt: 2_000 }],
    });
    await storage.set("cleanfeed.cache.entry.bad", {
      result: { aiScore: "not-a-score" },
      createdAt: 1_000,
      lastAccessedAt: 1_000,
      expiresAt: 2_000,
    });

    await expect(cache.get("bad")).resolves.toBeUndefined();
    await expect(
      storage.get("cleanfeed.cache.entry.bad"),
    ).resolves.toBeUndefined();
    await expect(storage.get("cleanfeed.cache.index.v1")).resolves.toEqual({
      entries: [],
    });
  });

  it("clears every cache entry tracked by the index", async () => {
    const { cache, storage } = createCache();
    await cache.set("a", result);
    await cache.set("b", result);

    await cache.clear();

    await expect(
      storage.get("cleanfeed.cache.index.v1"),
    ).resolves.toBeUndefined();
    await expect(
      storage.get("cleanfeed.cache.entry.a"),
    ).resolves.toBeUndefined();
    await expect(
      storage.get("cleanfeed.cache.entry.b"),
    ).resolves.toBeUndefined();
  });

  it("invalidates model and settings versions via the key", () => {
    expect(buildCacheKey("linkedin", "m1", "s1", "hash")).toBe(
      "linkedin:m1:s1:hash",
    );
  });
});
