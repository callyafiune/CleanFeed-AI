import { describe, expect, it } from "vitest";

import { calibrateResult } from "@/inference/calibration";
import { buildExplanation } from "@/inference/explanation";
import type { ClassificationResult, DecisionOutcome } from "@/shared/types";
import {
  createBundleRuntimeIdentity,
  createDecisionOutcome,
  createEvidenceAssessment,
} from "../../helpers/model-fixtures";

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
      version: "tmr-aggregation-v3",
      documentRawScore: 0.96,
      localizedRawScore: 0.98,
      coverage: 1,
      truncated: false,
      weightedMean: 0.96,
      median: 0.95,
      min: 0.92,
      max: 0.98,
      stdDev: 0.02,
      highScoreRatio: 0.9,
      chunkAgreement: 0.96,
      candidateWindowCount: 3,
      selectedWindowIndices: [0, 1, 2],
    },
    runtimeIdentity: createBundleRuntimeIdentity(),
    evidence: createEvidenceAssessment(),
    decision: createDecisionOutcome(),
    modelVersion: "test",
    modelId: "test-model",
    backend: "wasm",
    processingTimeMs: 1,
    demo: false,
  };
}

describe("buildExplanation", () => {
  it("requires result evidence rather than fabricating an explanation from a decision", () => {
    const outcome = calibrateResult(result());

    expect(() =>
      (buildExplanation as unknown as (outcome: DecisionOutcome) => unknown)(
        outcome,
      ),
    ).toThrow("ClassificationResult");
  });

  it("reports the raw model score and reasons derived from the actual result", () => {
    const classification = result();
    classification.aiScore = 0.91;
    classification.aggregation = {
      ...classification.aggregation!,
      documentRawScore: 0.96,
    };
    const outcome = {
      ...calibrateResult(classification),
      reasonCodes: ["FORMULAIC_STRUCTURE" as const],
    };
    const explanation = buildExplanation(classification, outcome);

    expect(explanation.modelScore).toBe(0.91);
    expect(explanation.reasonCodes).toEqual(
      expect.arrayContaining([
        "HIGH_CHUNK_CONSISTENCY",
        "MOST_CHUNKS_ABOVE_THRESHOLD",
        "HIGH_AVERAGE_SCORE",
        "HIGH_MEDIAN_SCORE",
      ]),
    );
    expect(explanation.reasonCodes).not.toContain("FORMULAIC_STRUCTURE");
  });

  it("never invents stylistic reasons", () => {
    const classification = result();
    const outcome = calibrateResult(classification);

    expect(buildExplanation(classification, outcome).reasonCodes).not.toContain(
      "FORMULAIC_STRUCTURE",
    );
  });
});
