import { describe, expect, it } from "vitest";

import { calibrateResult } from "@/inference/calibration";
import { buildExplanation } from "@/inference/explanation";
import type { ClassificationResult } from "@/shared/types";

function result(): ClassificationResult {
  return {
    aiScore: 0.96,
    humanScore: 0.04,
    confidence: "high",
    status: "possibly_ai",
    wordCount: 180,
    tokenCount: 200,
    language: "pt",
    aggregation: {
      finalScore: 0.96,
      weightedMean: 0.96,
      median: 0.95,
      maximum: 0.98,
      minimum: 0.92,
      standardDeviation: 0.02,
      highScoreRatio: 0.9,
      chunkAgreement: 0.96,
    },
    modelVersion: "test",
    modelId: "test-model",
    backend: "wasm",
    processingTimeMs: 1,
    demo: false,
  };
}

describe("buildExplanation", () => {
  it("reports only evidence-derived reasons", () => {
    const outcome = calibrateResult(result());
    const explanation = buildExplanation(outcome);

    expect(explanation.reasonCodes).toEqual(outcome.reasonCodes);
    expect(explanation.reasonCodes).toEqual(
      expect.arrayContaining([
        "HIGH_CHUNK_CONSISTENCY",
        "MOST_CHUNKS_ABOVE_THRESHOLD",
        "HIGH_AVERAGE_SCORE",
        "HIGH_MEDIAN_SCORE",
      ]),
    );
  });

  it("never invents stylistic reasons", () => {
    const outcome = calibrateResult(result());

    expect(buildExplanation(outcome).reasonCodes).not.toContain(
      "FORMULAIC_STRUCTURE",
    );
  });
});
