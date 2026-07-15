import { describe, expect, it } from "vitest";

import type { StorageArea } from "@/shared/types";
import { MetricsRepository } from "@/storage/metrics";

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

describe("MetricsRepository", () => {
  it("aggregates bounded counter, status, backend and latency data", async () => {
    const storage = new MemoryStorageArea();
    const metrics = new MetricsRepository(storage);

    await metrics.record({
      postsDetected: 2,
      postsAnalyzed: 1,
      cacheHits: 1,
      inferenceMs: 24,
      status: "possibly_ai",
      backend: "mock",
    });
    await metrics.record({ inferenceMs: 36, status: "probably_human" });

    await expect(metrics.get()).resolves.toEqual({
      postsDetected: 2,
      postsAnalyzed: 1,
      postsSkipped: 0,
      skippedByLength: 0,
      skippedByLanguage: 0,
      cacheHits: 1,
      cacheMisses: 0,
      inferenceFailures: 0,
      cancelledTasks: 0,
      revealedPosts: 0,
      averageInferenceMs: 30,
      medianInferenceMs: 30,
      resultsByStatus: {
        probably_human: 1,
        inconclusive: 0,
        possibly_ai: 1,
        strong_ai_indication: 0,
        insufficient_evidence: 0,
        classification_failed: 0,
      },
      backendUsage: { mock: 1 },
    });
  });

  it("rejects unallowlisted event data before it can be persisted", async () => {
    const metrics = new MetricsRepository(new MemoryStorageArea());

    await expect(
      metrics.record({ text: "conteúdo privado" } as never),
    ).rejects.toThrowError("INVALID_METRIC_EVENT");
    await expect(metrics.record({ inferenceMs: -1 })).rejects.toThrowError(
      "INVALID_METRIC_EVENT",
    );
  });

  it("recovers from corrupt persisted metrics", async () => {
    const storage = new MemoryStorageArea();
    await storage.set("cleanfeed.metrics.v1", { postsDetected: -1 });
    const metrics = new MetricsRepository(storage);

    expect((await metrics.get()).postsDetected).toBe(0);
    await expect(storage.get("cleanfeed.metrics.v1")).resolves.toBeUndefined();
  });

  it("clears aggregate metrics", async () => {
    const storage = new MemoryStorageArea();
    const metrics = new MetricsRepository(storage);
    await metrics.record({ postsDetected: 1 });

    await metrics.clear();

    await expect(storage.get("cleanfeed.metrics.v1")).resolves.toBeUndefined();
    expect((await metrics.get()).postsDetected).toBe(0);
  });
});
