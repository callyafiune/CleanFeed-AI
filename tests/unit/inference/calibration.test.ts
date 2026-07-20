import { describe, expect, it } from "vitest";

import {
  calibrateResult,
  getLengthBucket,
  resolveCalibrationProfile,
} from "@/inference/calibration";
import type { AggregationResultV2, ClassificationResult } from "@/shared/types";
import {
  createBundleRuntimeIdentity,
  createDecisionOutcome,
  createEvidenceAssessment,
} from "../../helpers/model-fixtures";

const aggregation: AggregationResultV2 = {
  version: "tmr-aggregation-v2",
  documentRawScore: 0.95,
  localizedRawScore: 0.96,
  coverage: 1,
  truncated: false,
  weightedMean: 0.95,
  median: 0.95,
  min: 0.94,
  max: 0.96,
  stdDev: 0.02,
  highScoreRatio: 1,
  chunkAgreement: 0.96,
  candidateWindowCount: 3,
  selectedWindowIndices: [0, 1, 2],
};

function baseResult(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    aiScore: 0.95,
    humanScore: 0.05,
    confidence: "high",
    status: "possibly_ai",
    wordCount: 160,
    tokenCount: 180,
    language: "pt",
    aggregation,
    runtimeIdentity: createBundleRuntimeIdentity(),
    evidence: createEvidenceAssessment(),
    decision: createDecisionOutcome(),
    modelVersion: "test",
    modelId: "test-model",
    backend: "wasm",
    processingTimeMs: 1,
    demo: false,
    ...overrides,
  };
}

describe("calibration", () => {
  it.each([
    [50, "50_79"],
    [79, "50_79"],
    [80, "80_99"],
    [99, "80_99"],
    [100, "100_149"],
    [149, "100_149"],
    [150, "150_299"],
    [300, "300_PLUS"],
  ] as const)("maps %i words to %s", (count, bucket) => {
    expect(getLengthBucket(count)).toBe(bucket);
  });

  it("resolves the conservative profile for the result length and language", () => {
    expect(
      resolveCalibrationProfile(baseResult({ wordCount: 120 })),
    ).toMatchObject({
      id: "default-pt-100_149",
      platform: "default",
      language: "pt",
      lengthBucket: "100_149",
      markingThreshold: 0.8,
      blurThreshold: 0.92,
      collapseThreshold: 1,
      hideThreshold: 1,
    });
  });

  it("caps aggressive action for 100-149 words", () => {
    const outcome = calibrateResult(
      baseResult({ wordCount: 120, aiScore: 0.999, humanScore: 0.001 }),
    );

    expect(outcome.actionCeiling).toBe("blur");
    expect(outcome.status).toBe("strong_ai_indication");
  });

  it("abstains on unsupported language and chunk disagreement", () => {
    const outcome = calibrateResult(
      baseResult({
        language: "und",
        aggregation: {
          ...aggregation,
          stdDev: 0.4,
          chunkAgreement: 0.2,
        },
      }),
    );

    expect(outcome.status).toBe("insufficient_evidence");
    expect(outcome.abstained).toBe(true);
    expect(outcome.actionCeiling).toBe("indicator");
    expect(outcome.reasonCodes).toEqual(
      expect.arrayContaining(["INSUFFICIENT_EVIDENCE", "CHUNK_DISAGREEMENT"]),
    );
  });

  it("abstains for low-confidence real-model output but permits demo mock ranges", () => {
    const realOutcome = calibrateResult(baseResult({ confidence: "low" }));
    const demoOutcome = calibrateResult(
      baseResult({ backend: "mock", confidence: "low", demo: true }),
    );

    expect(realOutcome).toMatchObject({
      status: "insufficient_evidence",
      abstained: true,
      reasonCodes: expect.arrayContaining([
        "INSUFFICIENT_EVIDENCE",
        "LOW_MODEL_CONFIDENCE",
      ]),
    });
    expect(demoOutcome.abstained).toBe(false);
  });

  it("abstains when scores are too close to distinguish", () => {
    const outcome = calibrateResult(
      baseResult({ aiScore: 0.54, humanScore: 0.46, aggregation: undefined }),
    );

    expect(outcome).toMatchObject({
      status: "insufficient_evidence",
      abstained: true,
      reasonCodes: expect.arrayContaining(["INSUFFICIENT_EVIDENCE"]),
    });
  });
});
