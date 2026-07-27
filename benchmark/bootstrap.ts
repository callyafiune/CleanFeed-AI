// Author-clustered percentile bootstrap for AUC and calibration intervals.
//
// The unit of resampling is the whole cluster (an author, by construction of the
// clusterBy key), never the individual record: fractioning an author would leak
// within-author correlation into the interval and understate its width. Each
// replicate draws `clusterCount` clusters with replacement and concatenates them
// whole. Randomness comes exclusively from a seeded xorshift32 PRNG, so two runs
// with the same seed produce byte-identical intervals; Math.random is never used.
//
// Non-finite replicate statistics are discarded, and eligibility fails hard when
// fewer than 1000 finite replicates survive — the interval is never silently
// downgraded to a per-record bootstrap.
//
// A SIMULTANEOUS (Bonferroni) percentile bound is published only when the tail it
// is read from contains at least one replicate; otherwise the "bound" would be the
// most extreme replicate observed and nothing more. The count of replicates behind
// every simultaneous bound travels WITH it, because at alpha_family / m the
// resolution of a fixed 2000-replicate distribution is a real limit on what the
// bound can mean.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Pure apart from the caller-supplied seed: no Date, no wall-clock, no I/O.

import { percentileInterval } from "./intervals.ts";

export interface BootstrapOptions<T> {
  clusterBy: (item: T) => string;
  iterations: 2_000;
  seed: number;
  statistic: (sample: readonly T[]) => number;
  // One-sided alpha for a SIMULTANEOUS (Bonferroni-corrected) percentile bound,
  // taken from the same replicates as the 95% interval. Present only when the
  // caller declared a pre-registered gate count; absent means no simultaneous
  // bound is published, and a gate that needs one then fails for missing
  // evidence instead of reading the 95% bound (benchmark/gates.ts).
  simultaneousAlpha?: number;
}

// A percentile bound, WITH the resampling effort that produced it. The effort is
// not decoration: a percentile read at alpha sits `alpha * (n - 1)` order
// statistics from the extreme of the replicate distribution, so at a Bonferroni
// alpha the same 2000 replicates that give a comfortable 95% bound can leave the
// simultaneous bound resting on two or three of them. A consumer that decides
// something on this bound has to be able to see that (R7), and the gate refuses a
// bound whose effort is below the pre-registered replicate count
// (benchmark/gates.ts).
export interface SimultaneousPercentileBound {
  alpha: number;
  lower: number;
  upper: number;
  // Finite replicates the percentile was read from.
  replicates: number;
  // How many replicates lie beyond the bound: floor(alpha * (replicates - 1)).
  // One means the bound IS the second-most-extreme replicate.
  tailReplicates: number;
}

export interface BootstrapInterval {
  lower95: number;
  upper95: number;
  requestedReplicates: 2_000;
  validReplicates: number;
  discardedReplicates: number;
  seed: number;
  method: "author-cluster-percentile";
  simultaneous?: SimultaneousPercentileBound;
}

const MINIMUM_VALID_REPLICATES = 1_000;

// Below one replicate in the tail the percentile is not an estimate of anything:
// it is the most extreme replicate observed, and reporting it as a bound at that
// alpha would be an extrapolation dressed as a measurement. This is a
// DEFINEDNESS floor, not a power floor — the pre-registered replicate counts of
// the frozen contract are checked by the gate, which is where policy lives.
const MINIMUM_TAIL_REPLICATES = 1;

export function clusterBootstrap<T>(
  items: readonly T[],
  options: BootstrapOptions<T>,
): BootstrapInterval {
  const { clusterBy, iterations, seed, statistic } = options;

  // Group once. Insertion order is preserved so the cluster list is a stable,
  // deterministic function of the input order and the seed alone.
  const clusters = new Map<string, T[]>();
  for (const item of items) {
    const key = clusterBy(item);
    const bucket = clusters.get(key);
    if (bucket === undefined) clusters.set(key, [item]);
    else bucket.push(item);
  }
  const clusterList = [...clusters.values()];
  const clusterCount = clusterList.length;
  if (clusterCount === 0) {
    throw new RangeError("clusterBootstrap requires at least one cluster");
  }

  const nextUnit = xorshift32(seed);
  const replicates: number[] = [];
  let discardedReplicates = 0;

  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sample: T[] = [];
    for (let draw = 0; draw < clusterCount; draw += 1) {
      const index = Math.min(
        clusterCount - 1,
        Math.floor(nextUnit() * clusterCount),
      );
      for (const item of clusterList[index]) sample.push(item);
    }
    const value = statistic(sample);
    if (Number.isFinite(value)) replicates.push(value);
    else discardedReplicates += 1;
  }

  const validReplicates = replicates.length;
  if (validReplicates < MINIMUM_VALID_REPLICATES) {
    throw new RangeError(
      `clusterBootstrap produced only ${validReplicates} finite replicates ` +
        `(need >= ${MINIMUM_VALID_REPLICATES}); never fall back to a per-record bootstrap`,
    );
  }

  const { lower, upper } = percentileInterval(replicates, 0.025, 0.975);

  const interval: BootstrapInterval = {
    lower95: lower,
    upper95: upper,
    requestedReplicates: iterations,
    validReplicates,
    discardedReplicates,
    seed,
    method: "author-cluster-percentile",
  };
  const simultaneousAlpha = options.simultaneousAlpha;
  if (simultaneousAlpha !== undefined) {
    if (!(simultaneousAlpha > 0 && simultaneousAlpha < 0.5)) {
      throw new RangeError("a one-sided alpha must lie in (0, 0.5)");
    }
    // The same replicates, read at a wider pair of percentiles. Reusing them is
    // deliberate: a second resample would answer a different question and cost
    // another 2000 statistic evaluations.
    const tailReplicates = Math.floor(
      simultaneousAlpha * (validReplicates - 1),
    );
    if (tailReplicates >= MINIMUM_TAIL_REPLICATES) {
      const wide = percentileInterval(
        replicates,
        simultaneousAlpha,
        1 - simultaneousAlpha,
      );
      interval.simultaneous = {
        alpha: simultaneousAlpha,
        lower: wide.lower,
        upper: wide.upper,
        replicates: validReplicates,
        tailReplicates,
      };
    }
    // No else: with an empty tail no bound is published at all, so a gate that
    // needs one fails for missing evidence instead of reading the maximum
    // replicate as if it were a percentile.
  }
  return interval;
}

// Deterministic 32-bit xorshift PRNG. Returns a generator producing values in
// the half-open interval [0, 1). The state is guarded against the zero fixed
// point so any integer seed yields a full-period stream.
function xorshift32(seed: number): () => number {
  let state = seed >>> 0;
  if (state === 0) state = 0x9e3779b9;
  return () => {
    let x = state;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    state = x;
    return x / 0x1_0000_0000;
  };
}
