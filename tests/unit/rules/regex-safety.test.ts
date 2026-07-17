import { describe, expect, it } from "vitest";

import { validateRegexPattern } from "@/rules/regex-safety";

describe("validateRegexPattern", () => {
  it.each([
    "(a+)+$",
    "(a|aa)+$",
    "(.+)*",
    "(a{1,9}){1,9}",
    "(a)\\1",
    "(?<=a)b",
  ])("rejects risky regex %s", (pattern) =>
    expect(validateRegexPattern(pattern)).toEqual(
      expect.objectContaining({ safe: false }),
    ),
  );

  it.each([
    "(\\w|\\d)+$", // overlapping alternation with different literal first tokens
    "(.|a)+z", // '.' overlaps any branch
    "(a|[a-z])+z", // class branch overlaps a literal branch
    "\\d+\\d+@", // adjacent unbounded quantifiers, overlapping (polynomial)
    ".*.*x", // adjacent '.' quantifiers
    "\\w+\\d+", // \\d is a subset of \\w, so adjacency overlaps
  ])("rejects the analyzer-bypass shape %s", (pattern) =>
    expect(validateRegexPattern(pattern)).toEqual(
      expect.objectContaining({ safe: false }),
    ),
  );

  it("accepts bounded literal and simple patterns", () => {
    for (const pattern of ["curso", "promo\\d+", "\\bcompre\\b", "gr[aá]tis"]) {
      expect(validateRegexPattern(pattern)).toEqual({ safe: true });
    }
  });

  it("does not over-reject adjacent quantifiers over disjoint sets", () => {
    // The adjacency guard must fire only when the neighbouring sets overlap;
    // these are all linear and must stay safe so real user rules keep working.
    for (const pattern of [
      "[a-z]+[0-9]+", // disjoint classes
      "\\d+@\\w+", // separated by a literal
      "a+b+", // distinct literals
      "\\d{2,4}\\d{2,4}", // bounded repetition, not unbounded
    ]) {
      expect(validateRegexPattern(pattern)).toEqual({ safe: true });
    }
  });

  it("accepts a group that is quantified but has no inner quantifier", () => {
    expect(validateRegexPattern("(abc)+").safe).toBe(true);
    expect(validateRegexPattern("(a|b)+").safe).toBe(true);
  });

  it("rejects lookbehind and named backreferences", () => {
    expect(validateRegexPattern("(?<!x)y").safe).toBe(false);
    expect(validateRegexPattern("(?<name>a)\\k<name>").safe).toBe(false);
  });

  it("accepts only the unicode and optional case-insensitive flags", () => {
    expect(validateRegexPattern("curso", "u").safe).toBe(true);
    expect(validateRegexPattern("curso", "iu").safe).toBe(true);
    for (const flags of ["g", "m", "s", "y", "gi", "ug"]) {
      expect(validateRegexPattern("curso", flags).safe).toBe(false);
    }
  });

  it("rejects empty and over-long patterns", () => {
    expect(validateRegexPattern("").safe).toBe(false);
    expect(validateRegexPattern("a".repeat(257)).safe).toBe(false);
  });
});
