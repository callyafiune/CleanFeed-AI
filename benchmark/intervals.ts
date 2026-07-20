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
  const z2 = ONE_SIDED_95_Z ** 2;
  const denominator = 1 + z2 / total;
  const center = (p + z2 / (2 * total)) / denominator;
  const radius =
    (ONE_SIDED_95_Z / denominator) *
    Math.sqrt((p * (1 - p)) / total + z2 / (4 * total ** 2));
  return {
    value: Math.max(
      0,
      Math.min(1, bound === "lower" ? center - radius : center + radius),
    ),
    confidence: 0.95,
    z: ONE_SIDED_95_Z,
    method: "wilson-one-sided",
  };
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
