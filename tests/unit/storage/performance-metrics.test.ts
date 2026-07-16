import { describe, expect, it } from "vitest";

import type { StorageArea } from "@/shared/types";
import { MetricsRepository } from "@/storage/metrics";

const PORTUGUESE_LONG_TEXT =
  "Este texto privado nunca deve ser persistido com as metricas de desempenho.";

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

  dump(): Record<string, unknown> {
    return Object.fromEntries(this.values);
  }
}

describe("MetricsRepository performance telemetry", () => {
  it("stores aggregate latency without storing traces or text by default", async () => {
    const storage = new MemoryStorageArea();
    const metrics = new MetricsRepository(storage);
    const trace = {
      extractionMs: 1,
      normalizationMs: 2,
      eligibilityMs: 3,
      hashingMs: 4,
      queueWaitMs: 5,
      languageDetectionMs: 6,
      tokenizationMs: 7,
      inferenceMs: 8,
      aggregationMs: 9,
      presentationMs: 10,
      totalMs: 55,
      text: PORTUGUESE_LONG_TEXT,
    };

    await metrics.recordInference(trace, "mock", "possibly_ai");

    const stored = storage.dump();
    expect(stored).not.toHaveProperty("text");
    expect(JSON.stringify(stored)).not.toContain(
      PORTUGUESE_LONG_TEXT.slice(0, 30),
    );
    expect((await metrics.get()).averageInferenceMs).toBe(trace.totalMs);
  });
});
