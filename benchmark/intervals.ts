// Auditable confidence intervals for the benchmark gates.
//
// Two pure estimators live here:
//   - wilsonOneSided: the one-sided 95% Wilson score interval used by the FPR
//     and recall gates. It always reports the exact approved z score so a report
//     can prove which critical value was applied.
//   - percentileInterval: interpolated percentiles (used by the author-cluster
//     bootstrap in bootstrap.ts to derive its 2.5% / 97.5% bounds).
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Pure and deterministic: no Date, no randomness, no I/O.

// One-sided 95% normal critical value. Frozen as an exact literal so the gate
// math is byte-reproducible and provable across the benchmark and the report.
export const ONE_SIDED_95_Z = 1.6448536269514722;

export interface WilsonInterval {
  value: number;
  confidence: 0.95;
  z: typeof ONE_SIDED_95_Z;
  method: "wilson-one-sided";
}

export function wilsonOneSided(
  successes: number,
  total: number,
  bound: "lower" | "upper",
): WilsonInterval {
  return {
    // The 95% path keeps reading the frozen literal, never the approximation in
    // `oneSidedZ`, so no published 95% bound moves by a single bit.
    value: wilsonBound(successes, total, bound, ONE_SIDED_95_Z),
    confidence: 0.95,
    z: ONE_SIDED_95_Z,
    method: "wilson-one-sided",
  };
}

// A one-sided Wilson bound at an arbitrary alpha. A6 needs it for the Bonferroni
// simultaneous bounds: with `m` pre-registered statistical gates, each one-sided
// interval is taken at alpha_family / m instead of at 0.05, so the family-wise
// error rate is controlled. Reported with the exact alpha and z it applied.
export interface WilsonIntervalAtAlpha {
  value: number;
  alpha: number;
  z: number;
  method: "wilson-one-sided";
}

export function wilsonOneSidedAtAlpha(
  successes: number,
  total: number,
  bound: "lower" | "upper",
  alpha: number,
): WilsonIntervalAtAlpha {
  if (!(alpha > 0 && alpha < 0.5)) {
    throw new RangeError("a one-sided alpha must lie in (0, 0.5)");
  }
  const z = oneSidedZ(alpha);
  return {
    value: wilsonBound(successes, total, bound, z),
    alpha,
    z,
    method: "wilson-one-sided",
  };
}

function wilsonBound(
  successes: number,
  total: number,
  bound: "lower" | "upper",
  z: number,
): number {
  if (
    !Number.isInteger(successes) ||
    !Number.isInteger(total) ||
    total <= 0 ||
    successes < 0 ||
    successes > total
  ) {
    throw new RangeError(
      "Wilson counts require integers with 0 <= successes <= total and total > 0",
    );
  }
  const p = successes / total;
  const z2 = z ** 2;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const radius =
    (z / denominator) *
    Math.sqrt((p * (1 - p)) / total + z2 / (4 * total ** 2));
  return Math.max(
    0,
    Math.min(1, bound === "lower" ? center - radius : center + radius),
  );
}

/**
 * The one-sided normal critical value for an upper-tail probability `alpha`:
 * z such that P(Z > z) = alpha. Peter Acklam's rational approximation of the
 * normal quantile function, whose RELATIVE error is bounded by 1.15e-9 over the
 * whole domain — good to nine digits for a gate bound, and deterministic. At
 * alpha = 0.05 it lands 1.8e-9 away from the frozen literal below.
 *
 * It is NOT used for the 95% intervals: `ONE_SIDED_95_Z` above stays the exact
 * frozen literal, so this function only ever produces the extra critical values
 * that a Bonferroni divisor asks for.
 */
export function oneSidedZ(alpha: number): number {
  if (!(alpha > 0 && alpha < 0.5)) {
    throw new RangeError("a one-sided alpha must lie in (0, 0.5)");
  }
  return -normalQuantile(alpha);
}

const ACKLAM_A = [
  -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2,
  1.38357751867269e2, -3.066479806614716e1, 2.506628277459239,
] as const;
const ACKLAM_B = [
  -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2,
  6.680131188771972e1, -1.328068155288572e1,
] as const;
const ACKLAM_C = [
  -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838,
  -2.549732539343734, 4.374664141464968, 2.938163982698783,
] as const;
const ACKLAM_D = [
  7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996,
  3.754408661907416,
] as const;
const ACKLAM_LOW = 0.02425;

function normalQuantile(p: number): number {
  if (p < ACKLAM_LOW) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (
      (((((ACKLAM_C[0] * q + ACKLAM_C[1]) * q + ACKLAM_C[2]) * q +
        ACKLAM_C[3]) *
        q +
        ACKLAM_C[4]) *
        q +
        ACKLAM_C[5]) /
      ((((ACKLAM_D[0] * q + ACKLAM_D[1]) * q + ACKLAM_D[2]) * q + ACKLAM_D[3]) *
        q +
        1)
    );
  }
  // The central branch; `oneSidedZ` never calls with p >= 0.5, so the upper tail
  // branch of the original algorithm is unreachable here.
  const q = p - 0.5;
  const r = q * q;
  return (
    ((((((ACKLAM_A[0] * r + ACKLAM_A[1]) * r + ACKLAM_A[2]) * r + ACKLAM_A[3]) *
      r +
      ACKLAM_A[4]) *
      r +
      ACKLAM_A[5]) *
      q) /
    (((((ACKLAM_B[0] * r + ACKLAM_B[1]) * r + ACKLAM_B[2]) * r + ACKLAM_B[3]) *
      r +
      ACKLAM_B[4]) *
      r +
      1)
  );
}

export interface PercentileInterval {
  lower: number;
  upper: number;
}

// Interpolated percentile interval. Percentiles are fractions in [0, 1]; the
// index is p * (n - 1) with linear interpolation between the neighbouring order
// statistics (the standard "linear" / R-7 method). The input is copied and
// sorted, so callers may pass an unsorted sample.
export function percentileInterval(
  values: readonly number[],
  lowerPercentile: number,
  upperPercentile: number,
): PercentileInterval {
  if (values.length === 0) {
    throw new RangeError("percentileInterval requires at least one value");
  }
  const sorted = [...values].sort((a, b) => a - b);
  return {
    lower: interpolatedPercentile(sorted, lowerPercentile),
    upper: interpolatedPercentile(sorted, upperPercentile),
  };
}

function interpolatedPercentile(
  sortedAscending: readonly number[],
  fraction: number,
): number {
  const n = sortedAscending.length;
  if (n === 1) return sortedAscending[0];
  const clamped = Math.max(0, Math.min(1, fraction));
  const rank = clamped * (n - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  if (low === high) return sortedAscending[low];
  const weight = rank - low;
  return sortedAscending[low] * (1 - weight) + sortedAscending[high] * weight;
}
