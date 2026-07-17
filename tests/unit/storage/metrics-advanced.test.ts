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

describe("MetricsRepository advanced latency telemetry", () => {
  it("approximates latency percentiles from bounded histogram buckets", async () => {
    const metrics = new MetricsRepository(new MemoryStorageArea());

    for (const latency of [10, 20, 30, 40, 100]) {
      await metrics.recordLatency(latency);
    }

    const snapshot = await metrics.get();
    // Deterministic bucket-approximated values with bounds
    // [5,10,20,50,100,...] and a ceil() target rank: the 3rd-of-5 value lands
    // in the <=50 bucket and the 5th in the <=100 bucket. A Math.floor
    // off-by-one would return 20 / 50 here and this pins it exactly.
    expect(snapshot.averageInferenceMs).toBe(40);
    expect(snapshot.medianInferenceMs).toBe(50);
    expect(snapshot.p90InferenceMs).toBe(100);
    expect(snapshot.p95InferenceMs).toBe(100);
  });

  it("captures the heavy tail in p95 while keeping percentiles ordered", async () => {
    const metrics = new MetricsRepository(new MemoryStorageArea());

    for (const latency of [5, 5, 5, 5, 5, 5, 5, 5, 5, 9000]) {
      await metrics.recordLatency(latency);
    }

    const snapshot = await metrics.get();
    // Nine 5ms samples + one 9000ms outlier (count 10). Median and p90 rest at
    // the 5ms bucket; only p95 (rank 10 -> the 9000 bucket, capped at max) must
    // reach the tail. A floor off-by-one would collapse p95 back to 5ms and
    // silently hide the outlier — so pin p95 to the tail explicitly.
    expect(snapshot.medianInferenceMs).toBe(5);
    expect(snapshot.p90InferenceMs).toBe(5);
    expect(snapshot.p95InferenceMs).toBe(9000);
    expect(snapshot.p95InferenceMs).toBeGreaterThanOrEqual(
      snapshot.p90InferenceMs,
    );
  });

  it("persists bounded histogram aggregates, never raw latency samples", async () => {
    const storage = new MemoryStorageArea();
    const metrics = new MetricsRepository(storage);

    for (const latency of [12, 34, 56]) {
      await metrics.recordLatency(latency);
    }

    const persisted = JSON.stringify(await storage.get("cleanfeed.metrics.v1"));
    expect(persisted).not.toContain("latencySamples");
    expect(persisted).toContain("buckets");
    // The individual samples must not survive as an inspectable list.
    expect(persisted).not.toContain("[12,34,56]");
  });

  it("tracks maximum queue size and model usage as bounded aggregates", async () => {
    const metrics = new MetricsRepository(new MemoryStorageArea());

    await metrics.record({ queueSize: 7, model: "mock-v1", inferenceMs: 15 });
    await metrics.record({ queueSize: 3, model: "mock-v1" });
    await metrics.record({ queueSize: 5, model: "onnx-v2" });

    const snapshot = await metrics.get();
    expect(snapshot.maximumQueueSize).toBe(7);
    expect(snapshot.modelUsage).toEqual({ "mock-v1": 2, "onnx-v2": 1 });
  });

  it("rejects unallowlisted advanced event data before it can be persisted", async () => {
    const metrics = new MetricsRepository(new MemoryStorageArea());

    await expect(metrics.record({ queueSize: -1 })).rejects.toThrowError(
      "INVALID_METRIC_EVENT",
    );
    await expect(metrics.record({ model: "" })).rejects.toThrowError(
      "INVALID_METRIC_EVENT",
    );
  });
});
