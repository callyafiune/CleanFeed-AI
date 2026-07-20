import { describe, expect, it } from "vitest";

import { percentileInterval, wilsonOneSided } from "../intervals.ts";

describe("wilsonOneSided", () => {
  it("uses the approved one-sided 95% z score", () => {
    const interval = wilsonOneSided(0, 300, "upper");
    expect(interval.confidence).toBe(0.95);
    expect(interval.z).toBe(1.6448536269514722);
    expect(interval.value).toBeCloseTo(0.008937, 5);
  });

  it("clamps the lower bound at zero for a zero-success count", () => {
    const interval = wilsonOneSided(0, 300, "lower");
    expect(interval.value).toBe(0);
    expect(interval.method).toBe("wilson-one-sided");
  });

  it("rejects non-integer or out-of-range counts", () => {
    expect(() => wilsonOneSided(1.5, 300, "upper")).toThrow(RangeError);
    expect(() => wilsonOneSided(-1, 300, "upper")).toThrow(RangeError);
    expect(() => wilsonOneSided(4, 3, "upper")).toThrow(RangeError);
    expect(() => wilsonOneSided(0, 0, "upper")).toThrow(RangeError);
  });
});

describe("percentileInterval", () => {
  it("interpolates the 2.5% and 97.5% indices", () => {
    const values = Array.from({ length: 101 }, (_unused, index) => index);
    const interval = percentileInterval(values, 0.025, 0.975);
    expect(interval.lower).toBeCloseTo(2.5, 10);
    expect(interval.upper).toBeCloseTo(97.5, 10);
  });

  it("sorts its input before selecting percentiles", () => {
    const interval = percentileInterval([100, 0, 50], 0.025, 0.975);
    expect(interval.lower).toBeCloseTo(2.5, 10);
    expect(interval.upper).toBeCloseTo(97.5, 10);
  });
});
