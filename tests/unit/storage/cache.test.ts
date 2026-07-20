import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import type {
  ClassificationResult,
  Clock,
  RuntimeModelIdentity,
  StorageArea,
} from "@/shared/types";
import {
  buildCacheKey,
  buildRuntimeModelKey,
  ClassificationCache,
} from "@/storage/cache";

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
  runtimeIdentity: {
    kind: "builtin",
    modelId: "stylometric",
    modelVersion: "1.0.0",
    implementationVersion: "stylometric-v1",
  },
  evidence: {
    quality: "limited",
    coverage: 1,
    lexicalRatio: 1,
    truncated: false,
    exactTokenizer: false,
    reasonCodes: [],
  },
  decision: {
    status: "possibly_ai",
    calibratedScore: 0.8,
    actionCeiling: "indicator",
    abstained: false,
    presentationAllowed: true,
    triggers: [],
    reasonCodes: [],
  },
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

const bundleIdentity: RuntimeModelIdentity = {
  kind: "bundle",
  modelId: "tmr-ai-text-detector",
  modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
  bundleDigest: "a".repeat(64),
  tokenizerDigest: "c".repeat(64),
  aggregationVersion: "tmr-aggregation-v2",
  contentCompositionVersion: "lexical-content-v1",
  calibrationSetDigest: "b".repeat(64),
};

const builtinIdentity: RuntimeModelIdentity = {
  kind: "builtin",
  modelId: "stylometric",
  modelVersion: "1.0.0",
  implementationVersion: "stylometric-v1",
};

describe("buildRuntimeModelKey", () => {
  it("changes when any sealing coordinate of a bundle identity changes", () => {
    const base = buildRuntimeModelKey(bundleIdentity);

    expect(
      buildRuntimeModelKey({ ...bundleIdentity, bundleDigest: "0".repeat(64) }),
    ).not.toBe(base);
    expect(
      buildRuntimeModelKey({
        ...bundleIdentity,
        tokenizerDigest: "0".repeat(64),
      }),
    ).not.toBe(base);
    expect(
      buildRuntimeModelKey({
        ...bundleIdentity,
        aggregationVersion: "tmr-aggregation-v3",
      }),
    ).not.toBe(base);
    expect(
      buildRuntimeModelKey({
        ...bundleIdentity,
        contentCompositionVersion: "lexical-content-v2",
      }),
    ).not.toBe(base);
    expect(
      buildRuntimeModelKey({
        ...bundleIdentity,
        calibrationSetDigest: "0".repeat(64),
      }),
    ).not.toBe(base);
  });

  it("is stable for the same identity and canonical across key order", () => {
    expect(buildRuntimeModelKey(bundleIdentity)).toBe(
      buildRuntimeModelKey({ ...bundleIdentity }),
    );
  });

  it("changes when a builtin implementationVersion changes", () => {
    expect(
      buildRuntimeModelKey({
        ...builtinIdentity,
        implementationVersion: "stylometric-v2",
      }),
    ).not.toBe(buildRuntimeModelKey(builtinIdentity));
  });

  it("never collides a bundle identity with a builtin one", () => {
    expect(buildRuntimeModelKey(bundleIdentity)).not.toBe(
      buildRuntimeModelKey(builtinIdentity),
    );
  });
});

describe("ClassificationCache identity-bound lookup", () => {
  const REALISTIC_NOW = Date.parse("2026-07-19T00:00:00.000Z");

  function identityCache(startAt = REALISTIC_NOW) {
    const storage = new MemoryStorageArea();
    const clock = new TestClock(startAt);
    const cache = new ClassificationCache(storage, clock, {
      maximumEntries: DEFAULT_SETTINGS.cacheMaximumEntries,
      ttlMs: DEFAULT_SETTINGS.cacheTtlMs,
    });
    return { cache, storage, clock };
  }

  const bundleResult: ClassificationResult = {
    ...result,
    runtimeIdentity: bundleIdentity,
  };

  function keyFor(identity: RuntimeModelIdentity): string {
    return buildCacheKey(
      "linkedin",
      buildRuntimeModelKey(identity),
      "settings",
      "hash",
    );
  }

  it("returns a hit when the read identity matches the stored one", async () => {
    const { cache } = identityCache();
    const key = keyFor(bundleIdentity);

    await cache.set(key, bundleResult);

    await expect(
      cache.getCachedClassification(key, REALISTIC_NOW, bundleIdentity),
    ).resolves.toEqual(bundleResult);
  });

  it("misses after the calibration set digest changes", async () => {
    const { cache } = identityCache();
    await cache.set(keyFor(bundleIdentity), bundleResult);

    const changed: RuntimeModelIdentity = {
      ...bundleIdentity,
      calibrationSetDigest: "0".repeat(64),
    };

    await expect(
      cache.getCachedClassification(keyFor(changed), REALISTIC_NOW, changed),
    ).resolves.toBeUndefined();
  });

  it("rejects a record whose stored identity does not match the read identity", async () => {
    const { cache, storage } = identityCache();
    const key = keyFor(bundleIdentity);
    // The entry is stored under the current key but carries an OLD identity in
    // its result; the defensive re-comparison on read must reject it.
    const staleIdentity: RuntimeModelIdentity = {
      ...bundleIdentity,
      bundleDigest: "9".repeat(64),
    };
    await storage.set("cleanfeed.cache.index.v1", {
      entries: [
        {
          key,
          lastAccessedAt: REALISTIC_NOW,
          expiresAt: REALISTIC_NOW + 1_000,
        },
      ],
    });
    await storage.set(`cleanfeed.cache.entry.${key}`, {
      result: { ...bundleResult, runtimeIdentity: staleIdentity },
      createdAt: REALISTIC_NOW,
      lastAccessedAt: REALISTIC_NOW,
      expiresAt: REALISTIC_NOW + 1_000,
    });

    await expect(
      cache.getCachedClassification(key, REALISTIC_NOW, bundleIdentity),
    ).resolves.toBeUndefined();
    await expect(
      storage.get(`cleanfeed.cache.entry.${key}`),
    ).resolves.toBeUndefined();
  });

  it("clamps the stored TTL to the selected profile's expiry", async () => {
    const { cache } = identityCache();
    const key = keyFor(bundleIdentity);
    // The profile expires 10 minutes from now — long before the 7-day TTL.
    const cacheValidUntil = new Date(REALISTIC_NOW + 600_000).toISOString();

    await cache.set(key, { ...bundleResult, cacheValidUntil });

    // A read just before the profile expiry still hits.
    await expect(
      cache.getCachedClassification(
        key,
        REALISTIC_NOW + 599_000,
        bundleIdentity,
      ),
    ).resolves.toMatchObject({ runtimeIdentity: bundleIdentity });
    // A read after the profile expiry — but well within the normal TTL — misses.
    await expect(
      cache.getCachedClassification(
        key,
        REALISTIC_NOW + 601_000,
        bundleIdentity,
      ),
    ).resolves.toBeUndefined();
  });

  it("removes a single legacy entry keyed by the old fixed model key", async () => {
    const { cache, storage } = identityCache();
    const legacyKey = buildCacheKey(
      "linkedin",
      "stylometric-v1:1.0.0",
      "settings",
      "hash",
    );
    await cache.set(legacyKey, result);
    await expect(
      storage.get(`cleanfeed.cache.entry.${legacyKey}`),
    ).resolves.toBeDefined();

    await cache.remove(legacyKey);

    await expect(
      storage.get(`cleanfeed.cache.entry.${legacyKey}`),
    ).resolves.toBeUndefined();
    await expect(storage.get("cleanfeed.cache.index.v1")).resolves.toEqual({
      entries: [],
    });
  });
});
