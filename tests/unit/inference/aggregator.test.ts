import { describe, expect, it } from "vitest";

import { aggregateWindowsV2, type WindowScore } from "@/inference/aggregator";

// The canonical Task 5 fixture: three overlapping content windows with no
// special tokens. Unique-token weights (each token attributed to the FIRST
// selected window covering it) are [510, 446, 244].
const windows: WindowScore[] = [
  { index: 0, tokenStart: 0, tokenEnd: 510, rawScore: 0.2 },
  { index: 1, tokenStart: 446, tokenEnd: 956, rawScore: 0.8 },
  { index: 2, tokenStart: 892, tokenEnd: 1_200, rawScore: 0.6 },
];

describe("aggregateWindowsV2", () => {
  it("keeps the document and localized raw scores separate", () => {
    const result = aggregateWindowsV2(windows, 1_200);

    expect(result.version).toBe("tmr-aggregation-v2");
    // (0.2*510 + 0.8*446 + 0.6*244) / 1200
    expect(result.documentRawScore).toBe(0.5043333333333333);
    expect(result.localizedRawScore).toBe(0.8);
    expect(result.weightedMean).toBe(result.documentRawScore);
    expect(result.coverage).toBe(1);
    expect(result.median).toBe(0.6);
    expect(result.min).toBe(0.2);
    expect(result.max).toBe(0.8);
    // Diagnostic raw threshold >= 0.80; only the 0.8 window qualifies.
    expect(result.highScoreRatio).toBeCloseTo(1 / 3, 12);
    expect(result.candidateWindowCount).toBe(3);
    expect(result.selectedWindowIndices).toEqual([0, 1, 2]);
    expect(result.truncated).toBe(false);
  });

  it("computes population stdDev and chunkAgreement weighted by unique tokens", () => {
    const result = aggregateWindowsV2(windows, 1_200);

    const weights = [510, 446, 244];
    const scores = [0.2, 0.8, 0.6];
    const total = 1_200;
    const mean =
      scores.reduce((sum, score, index) => sum + score * weights[index]!, 0) /
      total;
    const variance =
      scores.reduce(
        (sum, score, index) => sum + weights[index]! * (score - mean) ** 2,
        0,
      ) / total;

    expect(result.stdDev).toBeCloseTo(Math.sqrt(variance), 12);
    // Only the 0.6 window lies within 0.15 of the 0.5043 document score.
    expect(result.chunkAgreement).toBeCloseTo(1 / 3, 12);
  });

  it("counts overlapping tokens once against the total token count", () => {
    const overlapping: WindowScore[] = [
      { index: 0, tokenStart: 0, tokenEnd: 100, rawScore: 0.4 },
      { index: 1, tokenStart: 50, tokenEnd: 150, rawScore: 0.6 },
    ];

    const result = aggregateWindowsV2(overlapping, 200);

    // Union of [0,100) and [50,150) is tokens 0..149 = 150 unique of 200.
    expect(result.coverage).toBeCloseTo(150 / 200, 12);
    // Unique weights [100, 50] discount the overlap exactly once.
    expect(result.documentRawScore).toBeCloseTo(
      (0.4 * 100 + 0.6 * 50) / 150,
      12,
    );
  });

  it("selects at most eight windows, preserving the first and last", () => {
    const many: WindowScore[] = Array.from({ length: 20 }, (_, index) => ({
      index,
      tokenStart: index * 446,
      tokenEnd: index * 446 + 510,
      rawScore: index === 19 ? 0.95 : 0.1,
    }));

    const result = aggregateWindowsV2(many, 20 * 446 + 64);

    expect(result.candidateWindowCount).toBe(20);
    expect(result.selectedWindowIndices).toEqual([0, 3, 5, 8, 11, 14, 16, 19]);
    expect(result.truncated).toBe(true);
    // The isolated high window is the localized signal.
    expect(result.localizedRawScore).toBe(0.95);
  });

  it("rejects empty windows as insufficient evidence", () => {
    expect(() => aggregateWindowsV2([], 100)).toThrowError(
      expect.objectContaining({ code: "INSUFFICIENT_EVIDENCE" }),
    );
  });

  // The rejected inputs are unchanged; only the message changed. Each branch now
  // names its own cause instead of every one of them reporting "INFERENCE_FAILED",
  // which is what made a scored error row undiagnosable. The coded error class
  // stays INFERENCE_FAILED, so existing recovery still recognizes it.
  it.each([
    [Number.NaN, "NON_FINITE_SCORE"],
    [Number.POSITIVE_INFINITY, "NON_FINITE_SCORE"],
    [-0.01, "SCORE_OUT_OF_RANGE"],
    [1.01, "SCORE_OUT_OF_RANGE"],
  ])("rejects an invalid window score of %s as %s", (rawScore, message) => {
    expect(() =>
      aggregateWindowsV2(
        [{ index: 0, tokenStart: 0, tokenEnd: 10, rawScore }],
        10,
      ),
    ).toThrowError(
      expect.objectContaining({ code: "INFERENCE_FAILED", message }),
    );
  });

  it("rejects windows with no unique token weight", () => {
    expect(() =>
      aggregateWindowsV2(
        [{ index: 0, tokenStart: 5, tokenEnd: 5, rawScore: 0.5 }],
        10,
      ),
    ).toThrowError(
      expect.objectContaining({
        code: "INFERENCE_FAILED",
        message: "ZERO_UNIQUE_TOKEN_WEIGHT",
      }),
    );
  });

  it.each([0, -5, Number.NaN])(
    "rejects a total token count of %s with its own code",
    (totalTokenCount) => {
      expect(() =>
        aggregateWindowsV2(
          [{ index: 0, tokenStart: 0, tokenEnd: 10, rawScore: 0.5 }],
          totalTokenCount,
        ),
      ).toThrowError(
        expect.objectContaining({
          code: "INFERENCE_FAILED",
          message: "INVALID_TOTAL_TOKEN_COUNT",
        }),
      );
    },
  );
});
