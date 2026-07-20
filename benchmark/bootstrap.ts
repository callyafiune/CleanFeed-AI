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
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Pure apart from the caller-supplied seed: no Date, no wall-clock, no I/O.

import { percentileInterval } from "./intervals.ts";

export interface BootstrapOptions<T> {
  clusterBy: (item: T) => string;
  iterations: 2_000;
  seed: number;
  statistic: (sample: readonly T[]) => number;
}

export interface BootstrapInterval {
  lower95: number;
  upper95: number;
  requestedReplicates: 2_000;
  validReplicates: number;
  discardedReplicates: number;
  seed: number;
  method: "author-cluster-percentile";
}

const MINIMUM_VALID_REPLICATES = 1_000;

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

  return {
    lower95: lower,
    upper95: upper,
    requestedReplicates: iterations,
    validReplicates,
    discardedReplicates,
    seed,
    method: "author-cluster-percentile",
  };
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
