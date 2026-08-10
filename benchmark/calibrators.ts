// Monotonic score calibrators for the Phase 2 benchmark: Platt scaling, beta
// calibration and isotonic regression. Every family FITS a model that serializes
// to the shared `SerializedCalibratorV1` contract and is applied by the SAME pure
// function the Phase 1 runtime uses. A calibrator fitted here and a profile
// consumed by the extension therefore CANNOT diverge: application is re-exported
// from contracts/, never reimplemented.
//
// Fitting is deterministic — no Date, no randomness, no I/O. Platt/beta use
// projected gradient descent with a fixed schedule (learning rate 0.05, L2 1e-6,
// at most 10_000 iterations, stopping once the absolute log-loss reduction stays
// below 1e-10 for 20 consecutive iterations). Monotonic coefficients are
// projected after every step, so each model is non-decreasing by construction.
// Isotonic uses PAVA with tied-score pooling and emits strictly-increasing knots.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// `SerializedCalibratorV1` lives in contracts/, which is pure and shared.

import type { SerializedCalibratorV1 } from "../contracts/calibration-profile.ts";

// The application half of the round-trip IS the contract's own function: the
// benchmark never forks the runtime math. Fit with the functions below, apply
// with THIS.
export { applyCalibrator } from "../contracts/calibration-profile.ts";

/**
 * The kinds this module can FIT, which is the contract's union minus `identity`.
 * The pass-through has no parameters to estimate, so it is published rather than
 * fitted; widening this alias to the whole union would make `fitCalibrator`
 * fall through to isotonic for it, which is the fail-open direction.
 */
export type CalibratorKind = Exclude<
  SerializedCalibratorV1["kind"],
  "identity"
>;

export interface CalibrationSample {
  rawScore: number;
  label: 0 | 1;
}

// Matches the contract's beta clamp exactly so the fit and the runtime agree.
const BETA_EPSILON = 1e-6;
const PROBABILITY_EPSILON = 1e-12;
const LEARNING_RATE = 0.05;
const L2 = 1e-6;
const MAX_ITERATIONS = 10_000;
const CONVERGENCE_DELTA = 1e-10;
const CONVERGENCE_PATIENCE = 20;

export function fitCalibrator(
  kind: CalibratorKind,
  samples: readonly CalibrationSample[],
): SerializedCalibratorV1 {
  if (samples.length === 0) {
    throw new RangeError("fitCalibrator requires at least one sample");
  }
  if (kind === "platt") return fitPlatt(samples);
  if (kind === "beta") return fitBeta(samples);
  return fitIsotonic(samples);
}

function sigmoid(logit: number): number {
  if (logit >= 0) {
    return 1 / (1 + Math.exp(-logit));
  }
  const exponent = Math.exp(logit);
  return exponent / (1 + exponent);
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

// JSON has no negative zero; normalise so a serialized coefficient is a clean +0.
function normalizeZero(value: number): number {
  return value === 0 ? 0 : value;
}

function meanLogLoss(
  labels: readonly (0 | 1)[],
  probabilities: readonly number[],
): number {
  let sum = 0;
  for (let index = 0; index < labels.length; index += 1) {
    const p = Math.min(
      1 - PROBABILITY_EPSILON,
      Math.max(PROBABILITY_EPSILON, probabilities[index]),
    );
    sum += labels[index] === 1 ? -Math.log(p) : -Math.log(1 - p);
  }
  return sum / labels.length;
}

// Platt scaling: sigmoid(slope * rawScore + intercept), slope projected to >= 0.
function fitPlatt(
  samples: readonly CalibrationSample[],
): SerializedCalibratorV1 {
  const n = samples.length;
  let slope = 0;
  let intercept = 0;
  let previousLoss = Number.POSITIVE_INFINITY;
  let stableSteps = 0;

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    let gradientSlope = 0;
    let gradientIntercept = 0;
    for (const { rawScore, label } of samples) {
      const error = sigmoid(slope * rawScore + intercept) - label;
      gradientSlope += error * rawScore;
      gradientIntercept += error;
    }
    // L2 regularises the slope only; the bias is left unpenalised.
    slope -= LEARNING_RATE * (gradientSlope / n + L2 * slope);
    intercept -= LEARNING_RATE * (gradientIntercept / n);
    if (slope < 0) slope = 0; // monotonic projection

    const loss = meanLogLoss(
      samples.map((sample) => sample.label),
      samples.map((sample) => sigmoid(slope * sample.rawScore + intercept)),
    );
    if (previousLoss - loss < CONVERGENCE_DELTA) {
      stableSteps += 1;
      if (stableSteps >= CONVERGENCE_PATIENCE) break;
    } else {
      stableSteps = 0;
    }
    previousLoss = loss;
  }

  return {
    kind: "platt",
    slope: normalizeZero(slope),
    intercept: normalizeZero(intercept),
  };
}

// Beta calibration: sigmoid(alpha*ln(p) - beta*ln(1-p) + intercept), with alpha
// and beta projected to >= 0 and p clamped to the contract's [1e-6, 1-1e-6].
function fitBeta(
  samples: readonly CalibrationSample[],
): SerializedCalibratorV1 {
  const features = samples.map(({ rawScore, label }) => {
    const bounded = Math.min(
      1 - BETA_EPSILON,
      Math.max(BETA_EPSILON, clampUnit(rawScore)),
    );
    return {
      logP: Math.log(bounded),
      logComplement: Math.log(1 - bounded),
      label,
    };
  });
  const n = features.length;
  let alpha = 1;
  let beta = 1;
  let intercept = 0;
  let previousLoss = Number.POSITIVE_INFINITY;
  let stableSteps = 0;

  const predict = (feature: (typeof features)[number]): number =>
    sigmoid(alpha * feature.logP - beta * feature.logComplement + intercept);

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration += 1) {
    let gradientAlpha = 0;
    let gradientBeta = 0;
    let gradientIntercept = 0;
    for (const feature of features) {
      const error = predict(feature) - feature.label;
      gradientAlpha += error * feature.logP;
      gradientBeta += error * -feature.logComplement;
      gradientIntercept += error;
    }
    alpha -= LEARNING_RATE * (gradientAlpha / n + L2 * alpha);
    beta -= LEARNING_RATE * (gradientBeta / n + L2 * beta);
    intercept -= LEARNING_RATE * (gradientIntercept / n);
    if (alpha < 0) alpha = 0; // monotonic projection
    if (beta < 0) beta = 0;

    const loss = meanLogLoss(
      features.map((feature) => feature.label),
      features.map((feature) => predict(feature)),
    );
    if (previousLoss - loss < CONVERGENCE_DELTA) {
      stableSteps += 1;
      if (stableSteps >= CONVERGENCE_PATIENCE) break;
    } else {
      stableSteps = 0;
    }
    previousLoss = loss;
  }

  return {
    kind: "beta",
    alpha: normalizeZero(alpha),
    beta: normalizeZero(beta),
    intercept: normalizeZero(intercept),
  };
}

interface IsotonicBlock {
  value: number;
  weight: number;
  rawScores: number[];
}

// Isotonic regression by the Pool Adjacent Violators Algorithm. Tied raw scores
// are pooled into one weighted point BEFORE the fit so knots stay unique, and
// one knot is emitted per distinct raw score with its block's non-decreasing
// pooled value. Application is linear interpolation with extreme clamping.
function fitIsotonic(
  samples: readonly CalibrationSample[],
): SerializedCalibratorV1 {
  const pooledByScore = new Map<number, { labelSum: number; count: number }>();
  for (const { rawScore, label } of samples) {
    const clamped = clampUnit(rawScore);
    const entry = pooledByScore.get(clamped) ?? { labelSum: 0, count: 0 };
    entry.labelSum += label;
    entry.count += 1;
    pooledByScore.set(clamped, entry);
  }

  const points = [...pooledByScore.entries()]
    .map(([rawScore, { labelSum, count }]) => ({
      rawScore,
      value: labelSum / count,
      weight: count,
    }))
    .sort((a, b) => a.rawScore - b.rawScore);

  if (points.length < 2) {
    throw new RangeError(
      "fitIsotonic requires at least two distinct raw scores",
    );
  }

  const blocks: IsotonicBlock[] = [];
  for (const point of points) {
    let block: IsotonicBlock = {
      value: point.value,
      weight: point.weight,
      rawScores: [point.rawScore],
    };
    while (blocks.length > 0 && blocks[blocks.length - 1].value > block.value) {
      const previous = blocks.pop() as IsotonicBlock;
      const totalWeight = previous.weight + block.weight;
      block = {
        value:
          (previous.value * previous.weight + block.value * block.weight) /
          totalWeight,
        weight: totalWeight,
        rawScores: [...previous.rawScores, ...block.rawScores],
      };
    }
    blocks.push(block);
  }

  const knots: Array<{ rawScore: number; calibratedScore: number }> = [];
  for (const block of blocks) {
    for (const rawScore of block.rawScores) {
      knots.push({ rawScore, calibratedScore: clampUnit(block.value) });
    }
  }
  knots.sort((a, b) => a.rawScore - b.rawScore);

  return { kind: "isotonic", interpolation: "linear", clamp: true, knots };
}
