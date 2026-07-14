import { expect, it } from "vitest";

import { validateThresholds } from "@/shared/validation";

it("accepts ordered thresholds in the inclusive unit interval", () => {
  expect(
    validateThresholds({ marking: 0.8, blur: 0.92, collapse: 0.96, hide: 1 }),
  ).toBeUndefined();
});

it("rejects unordered thresholds", () => {
  expect(() =>
    validateThresholds({ marking: 0.8, blur: 0.7, collapse: 0.9, hide: 1 }),
  ).toThrowError("INVALID_SETTINGS");
});

it("rejects a threshold outside the unit interval", () => {
  expect(() =>
    validateThresholds({
      marking: 0.8,
      blur: 0.92,
      collapse: 0.96,
      hide: 1.01,
    }),
  ).toThrowError("INVALID_SETTINGS");
});
