import { describe, expect, it } from "vitest";

import { getTextLengthInfo } from "@/shared/word-count";

describe("getTextLengthInfo", () => {
  it("counts Unicode words and excludes punctuation", () => {
    expect(getTextLengthInfo("Olá, mundo! Não, sim 2026.")).toEqual({
      characterCount: 26,
      wordCount: 5,
    });
  });

  it("returns zero words for emoji-only content", () => {
    expect(getTextLengthInfo("😀 🎉")).toEqual({
      characterCount: 5,
      wordCount: 0,
    });
  });

  it("falls back to Unicode word matching when Intl.Segmenter is unavailable", () => {
    const originalSegmenter = Intl.Segmenter;
    Object.defineProperty(Intl, "Segmenter", {
      configurable: true,
      value: undefined,
    });

    try {
      expect(getTextLengthInfo("d'água não-é 2026").wordCount).toBe(3);
    } finally {
      Object.defineProperty(Intl, "Segmenter", {
        configurable: true,
        value: originalSegmenter,
      });
    }
  });
});
