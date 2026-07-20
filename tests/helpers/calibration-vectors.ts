// The single shared numeric calibrator vector. This phase's runtime tests
// (applySerializedCalibrator) and the Phase 2 fit/serialization tests MUST both
// import THESE fixtures so a calibrator that fits one and breaks the other can
// never slip through. Each entry pins an exact input→output the contract math
// (`applyCalibrator`) is required to reproduce.

import type { SerializedCalibratorV1 } from "../../contracts/calibration-profile";

export interface CalibratorVector {
  rawScore: number;
  expected: number;
}

/**
 * Isotonic knots `(0,0.1),(0.5,0.4),(1,0.9)`. Linear interpolation between
 * adjacent knots with clamping at the extremes — never a step function.
 */
export const ISOTONIC_CALIBRATOR: SerializedCalibratorV1 = {
  kind: "isotonic",
  interpolation: "linear",
  clamp: true,
  knots: [
    { rawScore: 0, calibratedScore: 0.1 },
    { rawScore: 0.5, calibratedScore: 0.4 },
    { rawScore: 1, calibratedScore: 0.9 },
  ],
};

/** The fixed isotonic vector: midpoint interpolation and both clamps. */
export const ISOTONIC_VECTORS: readonly CalibratorVector[] = [
  // Halfway between (0,0.1) and (0.5,0.4): 0.1 + 0.5*(0.4-0.1) = 0.25.
  { rawScore: 0.25, expected: 0.25 },
  // Below the first knot after the [0,1] clamp -> the first calibrated value.
  { rawScore: -1, expected: 0.1 },
  // Above the last knot after the [0,1] clamp -> the last calibrated value.
  { rawScore: 2, expected: 0.9 },
];

/** Platt scaling `sigmoid(slope*score + intercept)`. */
export const PLATT_CALIBRATOR: SerializedCalibratorV1 = {
  kind: "platt",
  slope: 2,
  intercept: -1,
};

/** With slope 2 and intercept -1, raw 0.5 lands exactly on the sigmoid midpoint. */
export const PLATT_VECTORS: readonly CalibratorVector[] = [
  { rawScore: 0.5, expected: 0.5 },
];

/**
 * Beta calibration with alpha=beta=1, intercept=0 collapses to
 * `sigmoid(logit(p)) = p`, so it is the identity on the clamped [1e-6,1-1e-6]
 * interval — a clean fixture that isolates the beta code path.
 */
export const BETA_CALIBRATOR: SerializedCalibratorV1 = {
  kind: "beta",
  alpha: 1,
  beta: 1,
  intercept: 0,
};

export const BETA_VECTORS: readonly CalibratorVector[] = [
  { rawScore: 0.8, expected: 0.8 },
  { rawScore: 0.2, expected: 0.2 },
];
