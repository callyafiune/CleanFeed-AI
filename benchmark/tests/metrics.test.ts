import { describe, expect, it } from "vitest";

import {
  computeBinaryMetrics,
  computeSegmentedMetrics,
  sizeBucket,
  type Prediction,
} from "../metrics";

function prediction(label: Prediction["label"], score: number): Prediction {
  return { label, score };
}

describe("computeBinaryMetrics", () => {
  it("computes precision among blocked as the primary metric", () => {
    const metrics = computeBinaryMetrics(
      [
        prediction("ai", 0.99),
        prediction("human", 0.98),
        prediction("ai", 0.2),
        prediction("human", 0.1),
      ],
      { blockThreshold: 0.92 },
    );

    expect(metrics.precisionAmongBlocked).toBe(0.5);
    expect(metrics.truePositives).toBe(1);
    expect(metrics.falsePositives).toBe(1);
  });

  it("names precisionAmongBlocked as the headline and never reports accuracy", () => {
    const metrics = computeBinaryMetrics([prediction("ai", 0.95)], {
      blockThreshold: 0.9,
    });

    expect(metrics.primaryMetric).toBe("precisionAmongBlocked");
    expect(metrics).not.toHaveProperty("accuracy");
  });

  it("scores perfect separation with ROC-AUC and PR-AUC of 1", () => {
    const metrics = computeBinaryMetrics(
      [
        prediction("ai", 0.9),
        prediction("ai", 0.8),
        prediction("human", 0.4),
        prediction("human", 0.3),
      ],
      { blockThreshold: 0.5 },
    );

    expect(metrics.rocAuc).toBe(1);
    expect(metrics.prAuc).toBe(1);
    expect(metrics.recall).toBe(1);
    expect(metrics.precisionAmongBlocked).toBe(1);
    expect(metrics.falsePositiveRate).toBe(0);
  });

  it("aggregates latency and memory samples when present", () => {
    const metrics = computeBinaryMetrics(
      [
        { label: "ai", score: 0.99, latencyMs: 10, memoryBytes: 1_000 },
        { label: "human", score: 0.1, latencyMs: 30, memoryBytes: 3_000 },
      ],
      { blockThreshold: 0.5 },
    );

    expect(metrics.latency?.sampleSize).toBe(2);
    expect(metrics.latency?.maxMs).toBe(30);
    expect(metrics.memory?.maxBytes).toBe(3_000);
  });
});

describe("sizeBucket", () => {
  it.each([
    [10, "0_49"],
    [50, "50_79"],
    [79, "50_79"],
    [80, "80_99"],
    [100, "100_149"],
    [150, "150_299"],
    [299, "150_299"],
    [300, "300_PLUS"],
  ] as const)("maps %i words to %s", (words, bucket) => {
    expect(sizeBucket(words)).toBe(bucket);
  });
});

describe("computeSegmentedMetrics", () => {
  it("reports metrics per segment and always includes the sample size", () => {
    const items = [
      { language: "pt", label: "ai" as const, score: 0.95 },
      { language: "pt", label: "human" as const, score: 0.1 },
      { language: "en", label: "ai" as const, score: 0.99 },
    ];

    const segments = computeSegmentedMetrics(
      items,
      (item) => ({ label: item.label, score: item.score }),
      (item) => item.language,
      { blockThreshold: 0.9 },
    );

    const pt = segments.find((segment) => segment.key === "pt");
    const en = segments.find((segment) => segment.key === "en");

    expect(pt?.metrics.sampleSize).toBe(2);
    expect(en?.metrics.sampleSize).toBe(1);
    expect(
      segments.every(
        (segment) => typeof segment.metrics.sampleSize === "number",
      ),
    ).toBe(true);
  });
});
