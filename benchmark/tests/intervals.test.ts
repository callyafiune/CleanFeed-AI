import { describe, expect, it } from "vitest";

import {
  ONE_SIDED_95_Z,
  oneSidedZ,
  percentileInterval,
  wilsonOneSided,
  wilsonOneSidedAtAlpha,
} from "../intervals.ts";

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

describe("one-sided critical values at an arbitrary alpha", () => {
  it("reproduces the frozen 95% z to nine digits without replacing it", () => {
    // The 95% path keeps reading the exact literal; this only proves the
    // approximation agrees with it, so a Bonferroni bound and a 95% bound are on
    // the same scale.
    expect(oneSidedZ(0.05)).toBeCloseTo(ONE_SIDED_95_Z, 8);
    expect(wilsonOneSided(1, 100, "upper").z).toBe(ONE_SIDED_95_Z);
  });

  it("matches the published normal quantiles", () => {
    expect(oneSidedZ(0.025)).toBeCloseTo(1.959963985, 8);
    expect(oneSidedZ(0.005)).toBeCloseTo(2.575829304, 8);
  });

  it("is monotone: a smaller alpha is a wider bound", () => {
    const individual = wilsonOneSidedAtAlpha(5, 200, "upper", 0.05);
    const simultaneous = wilsonOneSidedAtAlpha(5, 200, "upper", 0.05 / 8);
    expect(simultaneous.value).toBeGreaterThan(individual.value);
    expect(simultaneous.alpha).toBeCloseTo(0.00625, 12);
    expect(simultaneous.z).toBeGreaterThan(individual.z);
  });

  it("refuses an alpha outside (0, 0.5)", () => {
    expect(() => oneSidedZ(0)).toThrow(RangeError);
    expect(() => oneSidedZ(0.5)).toThrow(RangeError);
    expect(() => wilsonOneSidedAtAlpha(1, 10, "upper", 1)).toThrow(RangeError);
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
