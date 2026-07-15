import { describe, expect, it, vi } from "vitest";

import { MockClassifier } from "@/inference/mock-classifier";

describe("MockClassifier", () => {
  it("returns the same bounded score for the same normalized text", async () => {
    const classifier = new MockClassifier({ latencyMs: 0 });
    await classifier.initialize();

    const first = await classifier.classify("texto ".repeat(100));
    const second = await classifier.classify("texto ".repeat(100));

    expect(second.aiScore).toBe(first.aiScore);
    expect(first.aiScore).toBeGreaterThanOrEqual(0);
    expect(first.aiScore).toBeLessThanOrEqual(1);
    expect(first.humanScore).toBe(1 - first.aiScore);
    expect(first.backend).toBe("mock");
    expect(first.confidence).toBe("low");
    expect(first.demo).toBe(true);
  });

  it("derives the same result from equivalent normalized text", async () => {
    const classifier = new MockClassifier({ latencyMs: 0 });
    await classifier.initialize();

    const normalized = await classifier.classify("  texto   de teste\r\n");
    const alreadyNormalized = await classifier.classify("texto de teste");

    expect(normalized.aiScore).toBe(alreadyNormalized.aiScore);
    expect(normalized.humanScore).toBe(alreadyNormalized.humanScore);
    expect(normalized.status).toBe(alreadyNormalized.status);
  });

  it("rejects classification before initialization and after disposal", async () => {
    const classifier = new MockClassifier({ latencyMs: 0 });

    await expect(classifier.classify("texto")).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
    });

    await classifier.initialize();
    await classifier.dispose();

    await expect(classifier.classify("texto")).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
    });
  });

  it("honors AbortSignal during simulated latency", async () => {
    const controller = new AbortController();
    const promise = new MockClassifier({ latencyMs: 100 }).classify("texto", {
      signal: controller.signal,
    });

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  });

  it("honors AbortSignal during simulated latency after initialization", async () => {
    vi.useFakeTimers();
    const classifier = new MockClassifier({ latencyMs: 100 });
    await classifier.initialize();
    const controller = new AbortController();
    const promise = classifier.classify("texto", { signal: controller.signal });

    controller.abort();

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    vi.useRealTimers();
  });

  it("simulates deterministic failures without Math.random", async () => {
    const classifier = new MockClassifier({ latencyMs: 0, failureRate: 1 });
    await classifier.initialize();

    await expect(classifier.classify("texto")).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
    });
  });

  it("exposes mock metadata", () => {
    expect(new MockClassifier().getMetadata()).toMatchObject({
      id: "mock",
      backend: "mock",
      supportsBatching: false,
    });
  });
});
