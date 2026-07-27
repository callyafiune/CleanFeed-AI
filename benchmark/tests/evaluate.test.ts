// The prediction row -> evaluation item mapping, on its own.
//
// `runEvaluate` needs a real open holdout session, so the one line that used to
// hold the defect (`prediction.documentRawScore ?? 0`) was only reachable through
// a full consume-holdout run. `buildEvaluationItem` is exported precisely so the
// branch on `status` is testable directly: an error row must come out with no
// score and no decision, and a contradictory row must fail closed.

import { describe, expect, it } from "vitest";

import type { FrozenCalibrationArtifact } from "../calibration-pipeline.ts";
import { buildEvaluationItem } from "../commands/evaluate.ts";
import { CommandError } from "../commands/io.ts";
import type { StrictPredictionV2 } from "../prediction-schema.ts";
import type { BenchmarkRecord } from "../schema.ts";

// A steep Platt calibrator (sigmoid(20*raw - 10)) with low thresholds: a raw 0.9
// calibrates near 1 and a raw 0 near 0, so any score substituted for a missing
// one would be plainly visible as a decision.
const FROZEN = {
  calibrators: {
    document: { kind: "platt", slope: 20, intercept: -10 },
    localized: { kind: "platt", slope: 20, intercept: -10 },
  },
  thresholds: {
    warningDocument: 0.5,
    warningLocalized: 0.5,
    visualDocument: 0.8,
  },
} as unknown as FrozenCalibrationArtifact;

const RECORD = {
  id: "rec-1",
  label: "human",
  language: "pt-BR",
  wordCount: 120,
} as unknown as BenchmarkRecord;

function prediction(
  overrides: Partial<StrictPredictionV2> = {},
): StrictPredictionV2 {
  return {
    schemaVersion: 2,
    id: "rec-1",
    status: "scored",
    documentRawScore: 0.9,
    localizedRawScore: 0.9,
    evidenceQuality: "sufficient",
    reasonCode: "SCORED",
    coverage: 1,
    latencyMs: 12,
    memoryBytes: 2_048,
    ...overrides,
  } as StrictPredictionV2;
}

describe("buildEvaluationItem", () => {
  it("carries the score and both decisions for a scored row", () => {
    const item = buildEvaluationItem(FROZEN, RECORD, prediction());
    expect(item.status).toBe("scored");
    if (item.status !== "scored") throw new Error("expected a scored item");
    expect(item.documentScore).toBeGreaterThan(0.5);
    expect(item.warned).toBe(true);
    expect(item.visualActioned).toBe(true);
    expect(item.latencyMs).toBe(12);
    expect(item.memoryBytes).toBe(2_048);
  });

  it("gives an errored row no score and no decision at all", () => {
    const item = buildEvaluationItem(
      FROZEN,
      RECORD,
      prediction({
        status: "error",
        documentRawScore: null,
        localizedRawScore: null,
        evidenceQuality: "unsupported",
        reasonCode: "INFERENCE_FAILED",
        failureDetail: "MODEL_TIMEOUT",
        coverage: 0,
        memoryBytes: null,
      }),
    );

    expect(item.status).toBe("error");
    // No substituted score, and therefore no decision to be counted as a true
    // negative: the keys do not exist on the row at all.
    expect("documentScore" in item).toBe(false);
    expect("warned" in item).toBe(false);
    expect("visualActioned" in item).toBe(false);
    expect("memoryBytes" in item).toBe(false);
  });

  it("gives an abstained row no score and no decision either", () => {
    const item = buildEvaluationItem(
      FROZEN,
      RECORD,
      prediction({
        status: "abstained",
        documentRawScore: null,
        localizedRawScore: null,
        evidenceQuality: "limited",
        reasonCode: "INSUFFICIENT_EVIDENCE",
        coverage: 0,
      }),
    );

    expect(item.status).toBe("abstained");
    expect("documentScore" in item).toBe(false);
    expect("warned" in item).toBe(false);
  });

  it("fails closed on a scored row whose raw score is null", () => {
    for (const overrides of [
      { documentRawScore: null },
      { localizedRawScore: null },
    ]) {
      let thrown: unknown;
      try {
        buildEvaluationItem(FROZEN, RECORD, prediction(overrides));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CommandError);
      expect((thrown as CommandError).code).toBe(
        "SCORED_PREDICTION_WITHOUT_SCORE",
      );
    }
  });
});
