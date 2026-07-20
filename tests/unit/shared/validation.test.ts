import { expect, it } from "vitest";

import { validateChunkWindow } from "@/shared/validation";

it("accepts a window plan within the model capacity", () => {
  expect(
    validateChunkWindow({
      chunkSizeTokens: 192,
      overlapTokens: 32,
      maximumTokens: 256,
    }),
  ).toBeUndefined();
});

it("rejects an overlap that is not a proper prefix of the chunk", () => {
  expect(() =>
    validateChunkWindow({
      chunkSizeTokens: 100,
      overlapTokens: 100,
      maximumTokens: 256,
    }),
  ).toThrowError("INVALID_SETTINGS");
});

it("rejects a budget beyond the model capacity", () => {
  expect(() =>
    validateChunkWindow({
      chunkSizeTokens: 192,
      overlapTokens: 32,
      maximumTokens: 513,
    }),
  ).toThrowError("INVALID_SETTINGS");
});
