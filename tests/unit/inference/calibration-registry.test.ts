import { beforeEach, describe, expect, it } from "vitest";

import { calibrateWithRegistry } from "@/inference/calibration";
import {
  CalibrationRegistry,
  CONSERVATIVE_UNCALIBRATED_PROFILE,
  type CalibrationQuery,
  type VersionedCalibrationProfile,
} from "@/inference/calibration-registry";
import type { AggregationResult, ClassificationResult } from "@/shared/types";
import {
  createBundleRuntimeIdentity,
  createDecisionOutcome,
  createEvidenceAssessment,
} from "../../helpers/model-fixtures";

function profile(
  overrides: Partial<VersionedCalibrationProfile> = {},
): VersionedCalibrationProfile {
  return {
    id: "candidate-pt-150_299",
    modelId: "candidate",
    modelVersion: "1.0.0",
    platform: "linkedin",
    language: "pt",
    lengthBucket: "150_299",
    markingThreshold: 0.8,
    blurThreshold: 0.92,
    collapseThreshold: 0.96,
    hideThreshold: 0.99,
    calibrated: true,
    actionCeiling: "hide",
    ...overrides,
  };
}

function query(overrides: Partial<CalibrationQuery> = {}): CalibrationQuery {
  return {
    modelId: "candidate",
    modelVersion: "1.0.0",
    platform: "linkedin",
    language: "pt",
    lengthBucket: "150_299",
    ...overrides,
  };
}

const aggregation: AggregationResult = {
  finalScore: 0.95,
  weightedMean: 0.95,
  median: 0.95,
  maximum: 0.96,
  minimum: 0.94,
  standardDeviation: 0.02,
  highScoreRatio: 1,
  chunkAgreement: 0.96,
};

function realResult(
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
    modelVersion: "1.0.0",
    modelId: "candidate",
    backend: "wasm",
    processingTimeMs: 1,
    demo: false,
    ...overrides,
  };
}

describe("CalibrationRegistry", () => {
  let registry: CalibrationRegistry;

  beforeEach(() => {
    registry = new CalibrationRegistry();
  });

  it("returns the calibrated profile for an exact-match query", () => {
    const added = profile({
      id: "candidate-pt-150_299",
      markingThreshold: 0.83,
    });
    registry.add(added);

    expect(registry.get(query())).toEqual(added);
  });

  it("never reuses calibration from a different model version", () => {
    registry.add(
      profile({
        modelId: "candidate",
        modelVersion: "1.0.0",
        markingThreshold: 0.8,
      }),
    );

    expect(registry.get(query({ modelVersion: "1.0.1" }))).toEqual(
      CONSERVATIVE_UNCALIBRATED_PROFILE,
    );
  });

  it("never reuses calibration from a different model id", () => {
    registry.add(profile());

    expect(registry.get(query({ modelId: "other-model" }))).toEqual(
      CONSERVATIVE_UNCALIBRATED_PROFILE,
    );
  });

  it("misses on a different platform, language, or length bucket", () => {
    registry.add(profile());

    expect(registry.get(query({ platform: "twitter" }))).toEqual(
      CONSERVATIVE_UNCALIBRATED_PROFILE,
    );
    expect(registry.get(query({ language: "en" }))).toEqual(
      CONSERVATIVE_UNCALIBRATED_PROFILE,
    );
    expect(registry.get(query({ lengthBucket: "50_79" }))).toEqual(
      CONSERVATIVE_UNCALIBRATED_PROFILE,
    );
  });

  it("marks missing benchmark calibration as uncalibrated", () => {
    expect(registry.get(query({ modelId: "new-model" })).calibrated).toBe(
      false,
    );
  });

  it("exposes the conservative fallback as an indicator-only miss", () => {
    expect(CONSERVATIVE_UNCALIBRATED_PROFILE.calibrated).toBe(false);
    expect(CONSERVATIVE_UNCALIBRATED_PROFILE.actionCeiling).toBe("indicator");
  });

  it("refuses to store an uncalibrated profile", () => {
    expect(() => registry.add(profile({ calibrated: false }))).toThrow();
  });
});

describe("calibrateWithRegistry", () => {
  let registry: CalibrationRegistry;

  beforeEach(() => {
    registry = new CalibrationRegistry();
  });

  it("caps an uncalibrated real model to an indicator without hiding score", () => {
    const outcome = calibrateWithRegistry(realResult(), registry);

    expect(outcome.actionCeiling).toBe("indicator");
    expect(outcome.status).toBe("strong_ai_indication");
    expect(outcome.calibratedScore).toBeCloseTo(0.95);
  });

  it("keeps the aggressive ceiling once a matching calibration is verified", () => {
    registry.add(
      profile({
        id: "candidate-default-150_299",
        platform: "default",
        modelId: "candidate",
        modelVersion: "1.0.0",
        language: "pt",
        lengthBucket: "150_299",
      }),
    );

    const outcome = calibrateWithRegistry(realResult(), registry);

    expect(outcome.actionCeiling).toBe("hide");
    expect(outcome.status).toBe("strong_ai_indication");
  });

  // Adjusted after the honesty review: this test previously asserted that the
  // mock/demo path kept its aggressive length-bucket ceiling ("blur"), which
  // contradicted the documented invariant that an UNCALIBRATED classifier may
  // only indicate (README, docs/model-validation.md, docs/decisions.md). The
  // demo mock and the stylometric heuristic are uncalibrated by definition
  // (the registry refuses uncalibrated profiles), so they too are capped.
  it("caps the uncalibrated mock demo path to the indicator ceiling", () => {
    const mock = realResult({
      backend: "mock",
      demo: true,
      confidence: "low",
      wordCount: 120,
      aiScore: 0.999,
      humanScore: 0.001,
      aggregation: {
        ...aggregation,
        finalScore: 0.999,
        weightedMean: 0.999,
        median: 0.999,
      },
    });

    const outcome = calibrateWithRegistry(mock, registry);

    expect(outcome.actionCeiling).toBe("indicator");
    // The demo score and status stay visible; only the ceiling is capped.
    expect(outcome.status).toBe("strong_ai_indication");
    expect(outcome.abstained).toBe(false);
  });
});
