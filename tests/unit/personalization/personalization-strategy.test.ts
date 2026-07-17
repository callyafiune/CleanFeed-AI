import { describe, expect, it } from "vitest";

import { getPersonalizationStage } from "@/personalization/personalization-strategy";

describe("getPersonalizationStage", () => {
  it("keeps feedback in collect-only mode in the MVP", () => {
    expect(getPersonalizationStage(150)).toEqual({
      stage: "collect_only",
      appliesThresholdAdjustment: false,
      trainsAuxiliaryClassifier: false,
    });
  });

  it("returns collect_only for every count, including the documented future stages", () => {
    for (const count of [0, 1, 19, 20, 21, 50, 99, 100, 101, 1_000, 10_000]) {
      expect(getPersonalizationStage(count)).toEqual({
        stage: "collect_only",
        appliesThresholdAdjustment: false,
        trainsAuxiliaryClassifier: false,
      });
    }
  });

  it("never applies threshold adjustment nor trains an auxiliary classifier", () => {
    const stage = getPersonalizationStage(500);
    expect(stage.appliesThresholdAdjustment).toBe(false);
    expect(stage.trainsAuxiliaryClassifier).toBe(false);
  });

  it("treats negative or non-finite counts as collect_only without throwing", () => {
    expect(getPersonalizationStage(-10).stage).toBe("collect_only");
    expect(getPersonalizationStage(Number.NaN).stage).toBe("collect_only");
  });
});
