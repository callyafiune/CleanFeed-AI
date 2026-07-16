import { describe, expect, it } from "vitest";

import { aggregateChunkResults } from "@/inference/aggregator";
import type { ChunkResult } from "@/shared/types";

function chunk(
  aiScore: number,
  length: number,
  startToken = 0,
  index = 0,
): ChunkResult {
  return {
    index,
    startToken,
    endToken: startToken + length,
    aiScore,
    humanScore: 1 - aiScore,
    processingTimeMs: 0,
  };
}

function makeChunks(scores: number[]): ChunkResult[] {
  return scores.map((score, index) => chunk(score, 192, index * 160, index));
}

describe("aggregateChunkResults", () => {
  it.each([
    [[0.1, 0.2, 0.3], "low"],
    [[0.9, 0.92, 0.95], "high"],
    [[0.1, 0.1, 0.99], "isolated-high"],
    [[0.1, 0.9, 0.2, 0.8], "divergent"],
  ])("aggregates %j (%s) within bounds", (scores) => {
    const result = aggregateChunkResults(makeChunks(scores), 0.8);

    expect(result.finalScore).toBeGreaterThanOrEqual(0);
    expect(result.finalScore).toBeLessThanOrEqual(1);
    expect(result.minimum).toBe(Math.min(...scores));
    expect(result.maximum).toBe(Math.max(...scores));
  });

  it("does not let one tiny high chunk dominate", () => {
    const result = aggregateChunkResults(
      [chunk(0.1, 192), chunk(0.12, 192, 160, 1), chunk(0.99, 8, 320, 2)],
      0.8,
    );

    expect(result.finalScore).toBeLessThan(0.4);
  });

  it("weights the high-score ratio by each chunk's effective token length", () => {
    const result = aggregateChunkResults(
      [chunk(0.1, 192), chunk(0.99, 8, 192, 1)],
      0.8,
    );

    expect(result.highScoreRatio).toBeCloseTo(8 / 200, 8);
  });

  it("uses the specified formula", () => {
    const result = aggregateChunkResults(makeChunks([0.8, 0.9]), 0.8);

    expect(result.finalScore).toBeCloseTo(
      0.5 * result.weightedMean +
        0.25 * result.median +
        0.15 * result.highScoreRatio +
        0.1 * result.maximum,
      8,
    );
  });

  it("counts only each overlapping chunk's new tail in the weighted mean", () => {
    const result = aggregateChunkResults(
      [chunk(0.1, 192), chunk(0.9, 192, 160, 1)],
      0.8,
    );

    expect(result.weightedMean).toBeCloseTo((0.1 * 192 + 0.9 * 160) / 352, 8);
  });

  it("rejects empty chunk results as insufficient evidence", () => {
    expect(() => aggregateChunkResults([], 0.8)).toThrowError(
      expect.objectContaining({ code: "INSUFFICIENT_EVIDENCE" }),
    );
  });

  it.each([Number.NaN, -0.01, 1.01])(
    "rejects an invalid chunk score of %s",
    (aiScore) => {
      expect(() => aggregateChunkResults([chunk(aiScore, 192)], 0.8)).toThrow(
        "INFERENCE_FAILED",
      );
    },
  );

  it.each([Number.NaN, -0.01, 1.01])(
    "rejects an invalid high threshold of %s",
    (highThreshold) => {
      expect(() =>
        aggregateChunkResults([chunk(0.5, 192)], highThreshold),
      ).toThrow("INFERENCE_FAILED");
    },
  );

  it("rejects chunks that have no token weight", () => {
    expect(() => aggregateChunkResults([chunk(0.5, 0)], 0.8)).toThrow(
      "INFERENCE_FAILED",
    );
  });
});
