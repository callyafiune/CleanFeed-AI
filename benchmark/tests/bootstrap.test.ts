import { describe, expect, it } from "vitest";

import { clusterBootstrap } from "../bootstrap.ts";

interface ScoredItem {
  author: string;
  score: number;
}

// Each author owns a distinct number of records so a whole-cluster draw is
// detectable: any author present in a replicate must appear as an exact multiple
// of its cluster size.
const items: readonly ScoredItem[] = [
  { author: "ana", score: 0.05 },
  { author: "ana", score: 0.15 },
  { author: "bruno", score: 0.9 },
  { author: "bruno", score: 0.8 },
  { author: "bruno", score: 0.7 },
  { author: "carla", score: 0.5 },
  { author: "davi", score: 0.4 },
  { author: "davi", score: 0.6 },
];

function meanScore(sample: readonly ScoredItem[]): number {
  if (sample.length === 0) return Number.NaN;
  return sample.reduce((total, item) => total + item.score, 0) / sample.length;
}

describe("clusterBootstrap", () => {
  it("resamples whole authors and is seed deterministic", () => {
    const first = clusterBootstrap(items, {
      clusterBy: (item) => item.author,
      iterations: 2_000,
      seed: 712_019,
      statistic: meanScore,
    });
    const second = clusterBootstrap(items, {
      clusterBy: (item) => item.author,
      iterations: 2_000,
      seed: 712_019,
      statistic: meanScore,
    });
    expect(first).toEqual(second);
    expect(first.requestedReplicates).toBe(2_000);
  });

  it("reports an author-cluster percentile interval with the recorded seed", () => {
    const interval = clusterBootstrap(items, {
      clusterBy: (item) => item.author,
      iterations: 2_000,
      seed: 712_019,
      statistic: meanScore,
    });
    expect(interval.method).toBe("author-cluster-percentile");
    expect(interval.seed).toBe(712_019);
    expect(interval.validReplicates).toBe(2_000);
    expect(interval.discardedReplicates).toBe(0);
    expect(interval.validReplicates + interval.discardedReplicates).toBe(2_000);
    expect(interval.lower95).toBeLessThanOrEqual(interval.upper95);
    expect(interval.lower95).toBeGreaterThanOrEqual(0);
    expect(interval.upper95).toBeLessThanOrEqual(1);
  });

  it("never fractions an author within a replicate", () => {
    const clusterSizes = new Map<string, number>();
    for (const item of items) {
      clusterSizes.set(item.author, (clusterSizes.get(item.author) ?? 0) + 1);
    }
    clusterBootstrap(items, {
      clusterBy: (item) => item.author,
      iterations: 2_000,
      seed: 712_019,
      statistic: (sample) => {
        const counts = new Map<string, number>();
        for (const item of sample) {
          counts.set(item.author, (counts.get(item.author) ?? 0) + 1);
        }
        for (const [author, count] of counts) {
          expect(count % (clusterSizes.get(author) as number)).toBe(0);
        }
        return meanScore(sample);
      },
    });
  });

  it("differs across seeds while each seed is byte-for-byte reproducible", () => {
    const options = {
      clusterBy: (item: ScoredItem) => item.author,
      iterations: 2_000 as const,
      statistic: meanScore,
    };
    const a1 = clusterBootstrap(items, { ...options, seed: 1 });
    const a2 = clusterBootstrap(items, { ...options, seed: 1 });
    const b = clusterBootstrap(items, { ...options, seed: 2 });
    expect(a1).toEqual(a2);
    expect(a1).not.toEqual(b);
  });

  it("publishes the resampling effort behind a simultaneous bound", () => {
    // m = 40 gates sharing alpha_family = 0.05: the bound is read at 0.00125, i.e.
    // floor(0.00125 * 1999) = 2 replicates from the extreme. That is exactly the
    // fact the effort fields exist to expose.
    const interval = clusterBootstrap(items, {
      clusterBy: (item) => item.author,
      iterations: 2_000,
      seed: 712_019,
      statistic: meanScore,
      simultaneousAlpha: 0.05 / 40,
    });
    expect(interval.simultaneous?.replicates).toBe(2_000);
    expect(interval.simultaneous?.tailReplicates).toBe(2);
    expect(interval.simultaneous?.alpha).toBeCloseTo(0.00125, 12);
    // Still a wider interval than the descriptive 95% one, in both directions.
    expect(interval.simultaneous?.upper).toBeGreaterThanOrEqual(
      interval.upper95,
    );
    expect(interval.simultaneous?.lower).toBeLessThanOrEqual(interval.lower95);
  });

  it("publishes no simultaneous bound at all when the tail holds no replicate", () => {
    // alpha * (n - 1) < 1: the percentile would BE the most extreme replicate, so
    // there is nothing to report. A gate that needs the bound then fails for
    // missing evidence instead of reading an extrapolation.
    const interval = clusterBootstrap(items, {
      clusterBy: (item) => item.author,
      iterations: 2_000,
      seed: 712_019,
      statistic: meanScore,
      simultaneousAlpha: 1 / 4_000,
    });
    expect(interval.simultaneous).toBeUndefined();
    // The descriptive 95% interval is untouched by the refusal.
    expect(interval.lower95).toBeLessThanOrEqual(interval.upper95);
  });

  it("throws an eligibility error when fewer than 1000 replicates are finite", () => {
    expect(() =>
      clusterBootstrap(items, {
        clusterBy: (item) => item.author,
        iterations: 2_000,
        seed: 712_019,
        statistic: () => Number.NaN,
      }),
    ).toThrow(/1000/);
  });
});
