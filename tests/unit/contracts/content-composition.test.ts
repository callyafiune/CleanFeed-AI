import { describe, expect, it } from "vitest";

import {
  CONTENT_COMPOSITION_VERSION,
  classifyContentUnit,
  computeContentComposition,
} from "../../../contracts/content-composition";
import { evaluateEligibility } from "@/inference/eligibility";
import type { EligibilityInput } from "@/inference/eligibility";

// A shared literal fixture with every category: two lexical words (one
// accented), a URL, a hashtag, a composed ZWJ-family emoji, a number
// (lexical), a pure-punctuation "other" unit and a trailing word.
const MIXED_FIXTURE =
  "Visite https://exemplo.com hoje #CleanFeed \u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466} análise 2024 !!! ok";

describe("CONTENT_COMPOSITION_VERSION", () => {
  it("is the sealed lexical content version", () => {
    expect(CONTENT_COMPOSITION_VERSION).toBe("lexical-content-v1");
  });
});

describe("classifyContentUnit", () => {
  it("applies the fixed precedence", () => {
    expect(classifyContentUnit("https://exemplo.com")).toBe("url");
    expect(classifyContentUnit("www.exemplo.com/x")).toBe("url");
    expect(classifyContentUnit("#CleanFeed")).toBe("hashtag");
    expect(classifyContentUnit("\u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466}")).toBe(
      "emoji",
    );
    expect(classifyContentUnit("análise")).toBe("lexical");
    expect(classifyContentUnit("2024")).toBe("lexical");
    expect(classifyContentUnit("!!!")).toBe("other");
  });
});

describe("computeContentComposition", () => {
  it("counts every category on the shared fixture", () => {
    const composition = computeContentComposition(MIXED_FIXTURE);
    expect(composition).toEqual({
      totalUnits: 9,
      lexicalUnits: 5,
      urlUnits: 1,
      hashtagUnits: 1,
      emojiUnits: 1,
      otherUnits: 1,
      lexicalRatio: 5 / 9,
    });
  });

  it("returns a zero lexicalRatio for empty input", () => {
    expect(computeContentComposition("")).toEqual({
      totalUnits: 0,
      lexicalUnits: 0,
      urlUnits: 0,
      hashtagUnits: 0,
      emojiUnits: 0,
      otherUnits: 0,
      lexicalRatio: 0,
    });
  });

  it("normalizes CRLF to LF before splitting", () => {
    const crlf = computeContentComposition("uma\r\nduas\r\ntrês");
    const lf = computeContentComposition("uma\nduas\ntrês");
    expect(crlf).toEqual(lf);
    expect(crlf.totalUnits).toBe(3);
    expect(crlf.lexicalUnits).toBe(3);
  });
});

describe("eligibility shares the exact composition definition", () => {
  function input(overrides: Partial<EligibilityInput>): EligibilityInput {
    return {
      text: "",
      enabled: true,
      domainEnabled: true,
      modelAvailable: true,
      extractionSucceeded: true,
      duplicateContent: false,
      experimentalShortTextDetection: false,
      ...overrides,
    };
  }

  it("flags a mostly-URL text using the same classification the contract exposes", () => {
    const text = "https://a.com https://b.com https://c.com palavra";
    const composition = computeContentComposition(text);
    // 3 URLs out of 4 meaningful units (>= 0.6) — the contract and eligibility
    // agree on what "mostly links" means.
    const meaningful =
      composition.urlUnits +
      composition.hashtagUnits +
      composition.emojiUnits +
      composition.lexicalUnits;
    expect(composition.urlUnits / meaningful).toBeGreaterThanOrEqual(0.6);
    expect(evaluateEligibility(input({ text })).reason).toBe("MOSTLY_LINKS");
  });

  it("flags a mostly-hashtag text consistently", () => {
    const text = "#a #b #c #d palavra";
    expect(evaluateEligibility(input({ text })).reason).toBe("MOSTLY_HASHTAGS");
  });
});
