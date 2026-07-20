import { describe, expect, it } from "vitest";

import { applyCalibrator, fitCalibrator } from "../calibrators.ts";
import {
  BETA_CALIBRATOR,
  BETA_VECTORS,
  ISOTONIC_CALIBRATOR,
  ISOTONIC_VECTORS,
  PLATT_CALIBRATOR,
  PLATT_VECTORS,
} from "../../tests/helpers/calibration-vectors.ts";

const samples = [
  { rawScore: 0.05, label: 0 as const },
  { rawScore: 0.2, label: 0 as const },
  { rawScore: 0.7, label: 1 as const },
  { rawScore: 0.95, label: 1 as const },
];

describe.each(["platt", "beta", "isotonic"] as const)(
  "%s calibration",
  (kind) => {
    it("serializes a monotonic mapping inside [0,1]", () => {
      const model = fitCalibrator(kind, samples);
      const mapped = [0, 0.1, 0.5, 0.9, 1].map((score) =>
        applyCalibrator(model, score),
      );
      expect(mapped.every((score) => score >= 0 && score <= 1)).toBe(true);
      expect(mapped).toEqual([...mapped].sort((a, b) => a - b));
      expect(JSON.parse(JSON.stringify(model))).toEqual(model);
    });
  },
);

describe.each(["platt", "beta", "isotonic"] as const)(
  "%s serialize<->apply round-trip",
  (kind) => {
    it("applies identically through the contract before and after JSON serialization", () => {
      const model = fitCalibrator(kind, samples);
      const restored = JSON.parse(JSON.stringify(model));
      for (const score of [0, 0.05, 0.25, 0.5, 0.75, 0.95, 1]) {
        // The serialized model round-trips EXACTLY through the SAME apply the
        // Phase 1 runtime uses (re-exported from contracts/), never a fork.
        expect(applyCalibrator(restored, score)).toBe(
          applyCalibrator(model, score),
        );
      }
    });
  },
);

describe("shared calibration vector round-trip", () => {
  // These are the SAME fixtures the Phase 1 runtime tests assert (see
  // tests/helpers/calibration-vectors.ts and tests/unit/inference/
  // calibration.test.ts). Fit-side and runtime-side apply MUST agree, so both
  // suites pin the identical input->output pairs and neither forks the vector.
  it("reproduces the shared isotonic vector 0.25->0.25, -1->0.1, 2->0.9", () => {
    for (const { rawScore, expected } of ISOTONIC_VECTORS) {
      expect(applyCalibrator(ISOTONIC_CALIBRATOR, rawScore)).toBeCloseTo(
        expected,
        10,
      );
    }
  });

  it("reproduces the shared platt vector", () => {
    for (const { rawScore, expected } of PLATT_VECTORS) {
      expect(applyCalibrator(PLATT_CALIBRATOR, rawScore)).toBeCloseTo(
        expected,
        10,
      );
    }
  });

  it("reproduces the shared beta vector", () => {
    for (const { rawScore, expected } of BETA_VECTORS) {
      expect(applyCalibrator(BETA_CALIBRATOR, rawScore)).toBeCloseTo(
        expected,
        6,
      );
    }
  });
});
