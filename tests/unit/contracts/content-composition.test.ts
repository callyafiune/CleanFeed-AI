import { describe, expect, it } from "vitest";

import {
  CONTENT_COMPOSITION_VERSION,
  classifyContentUnit,
  computeContentComposition,
} from "../../../contracts/content-composition";
import type { ContentComposition } from "../../../contracts/content-composition";
import {
  bundledModelManifest,
  bundledReleaseDescriptor,
} from "@/inference/bundled-model-metadata";
import { evaluateEligibility } from "@/inference/eligibility";
import type { EligibilityInput } from "@/inference/eligibility";

// A shared literal fixture with every category: two lexical words (one
// accented), a URL, a hashtag, a composed ZWJ-family emoji, a number
// (lexical), a pure-punctuation "other" unit and a trailing word.
const MIXED_FIXTURE =
  "Visite https://exemplo.com hoje #CleanFeed \u{1F468}‍\u{1F469}‍\u{1F467}‍\u{1F466} análise 2024 !!! ok";

describe("CONTENT_COMPOSITION_VERSION", () => {
  it("is the sealed lexical content version", () => {
    expect(CONTENT_COMPOSITION_VERSION).toBe("lexical-content-v2");
  });

  // The constant and the sealed manifest are two halves of ONE coordinate:
  // `identityMatchesParity` (src/model-benchmark/main.ts) compares the runtime
  // identity built from the manifest against the parity manifest derived from it,
  // and the runtime composition is this constant. Pinning the literal alone left
  // "they must stay equal" as prose; this makes a one-sided bump a red test.
  it("equals the sealed bundle manifest's composition coordinate", () => {
    expect(CONTENT_COMPOSITION_VERSION).toBe(
      bundledModelManifest.contentCompositionVersion,
    );
    expect(CONTENT_COMPOSITION_VERSION).toBe(
      bundledReleaseDescriptor.contentCompositionVersion,
    );
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

// The rationale recorded on CONTENT_COMPOSITION_VERSION names three movements
// versus `v1`. These tests ARE that rationale: each one reproduces `v1`'s split
// exactly — `text.replace(/\r\n/gu, "\n").match(/\S+/gu)` fed through
// `classifyContentUnit`, which is byte-identical between the two versions — and
// asserts the direction of the movement against what `v2` now reports. A first
// draft of the rationale claimed a movement for exotic separators; running this
// comparison is what disproved it, so the same claim cannot come back unnoticed.
describe("the movements that justify lexical-content-v2", () => {
  function v1(text: string): ContentComposition {
    const units = text.replace(/\r\n/gu, "\n").match(/\S+/gu) ?? [];
    const composition: ContentComposition = {
      totalUnits: units.length,
      lexicalUnits: 0,
      urlUnits: 0,
      hashtagUnits: 0,
      emojiUnits: 0,
      otherUnits: 0,
      lexicalRatio: 0,
    };
    for (const unit of units) {
      switch (classifyContentUnit(unit)) {
        case "url":
          composition.urlUnits += 1;
          break;
        case "hashtag":
          composition.hashtagUnits += 1;
          break;
        case "emoji":
          composition.emojiUnits += 1;
          break;
        case "lexical":
          composition.lexicalUnits += 1;
          break;
        default:
          composition.otherUnits += 1;
          break;
      }
    }
    composition.lexicalRatio =
      units.length === 0 ? 0 : composition.lexicalUnits / units.length;
    return composition;
  }

  // Movement 1, and its direction: an invisible-only unit VANISHES, so the count
  // goes DOWN. Asserted for each invisible class the normalization removes.
  it("drops a unit made only of invisible characters", () => {
    for (const invisible of [
      "\u200B", // ZERO WIDTH SPACE
      "\u2060", // WORD JOINER
      "\u180E", // MONGOLIAN VOWEL SEPARATOR
      "\u00AD", // SOFT HYPHEN
    ]) {
      const text = `uma ${invisible} palavra`;
      expect(v1(text), invisible).toMatchObject({
        totalUnits: 3,
        lexicalUnits: 2,
        otherUnits: 1,
        lexicalRatio: 2 / 3,
      });
      expect(computeContentComposition(text), invisible).toMatchObject({
        totalUnits: 2,
        lexicalUnits: 2,
        otherUnits: 0,
        lexicalRatio: 1,
      });
    }
  });

  // The NEGATIVE half of movement 1, and the reason it is phrased about
  // invisibles rather than separators: JavaScript's `\s` covers Zs, Zl and Zp, so
  // `v1` already split on every separator the folding step rewrites. Folding them
  // to U+0020 moves NO count, and this test is what keeps that out of the
  // rationale.
  it("does not move any count for an exotic separator, which v1 already split", () => {
    for (const separator of [
      "\u00A0", // NO-BREAK SPACE
      "\u1680", // OGHAM SPACE MARK
      "\u2003", // EM SPACE
      "\u2028", // LINE SEPARATOR
      "\u2029", // PARAGRAPH SEPARATOR
      "\u202F", // NARROW NO-BREAK SPACE
      "\u205F", // MEDIUM MATHEMATICAL SPACE
      "\u3000", // IDEOGRAPHIC SPACE
    ]) {
      const text = `palavra${separator}outra`;
      expect(v1(text), separator).toMatchObject({
        totalUnits: 2,
        lexicalUnits: 2,
      });
      expect(computeContentComposition(text), separator).toEqual(v1(text));
    }
  });

  // Movement 2: the invisible sat INSIDE the unit, so the unit's own category was
  // wrong. U+200B is not in `[\p{L}\p{N}_]`, which is what made the hashtag read
  // as lexical.
  it("recovers the category of a unit an invisible was hiding inside", () => {
    const text = "veja #Cle\u200BanFeed agora";
    expect(v1(text)).toMatchObject({
      totalUnits: 3,
      lexicalUnits: 3,
      hashtagUnits: 0,
    });
    expect(computeContentComposition(text)).toMatchObject({
      totalUnits: 3,
      lexicalUnits: 2,
      hashtagUnits: 1,
    });
  });

  // Movement 3: a URL disguised with a confusable, or written full-width. Both
  // break the literal `https://` the URL pattern requires, so `v1` counted them
  // as lexical.
  it("recovers a URL written with a confusable or full-width Latin", () => {
    for (const disguised of [
      "htt\u0440s://exemplo.com", // U+0440 CYRILLIC SMALL LETTER ER
      "\uFF48\uFF54\uFF54\uFF50\uFF53://exemplo.com", // FULLWIDTH h t t p s
    ]) {
      const text = `veja ${disguised} agora`;
      expect(v1(text), disguised).toMatchObject({
        totalUnits: 3,
        lexicalUnits: 3,
        urlUnits: 0,
      });
      expect(computeContentComposition(text), disguised).toMatchObject({
        totalUnits: 3,
        lexicalUnits: 2,
        urlUnits: 1,
      });
    }
  });

  // The NEGATIVE half of movement 3: a confusable-disguised HASHTAG is not a
  // movement, because `\p{L}` matches Cyrillic and `v1` already classified it as
  // a hashtag. The rationale says so explicitly; this pins it.
  it("does not move a hashtag written with a confusable, which v1 already matched", () => {
    const text = "veja #Cle\u0430nFeed agora"; // U+0430 CYRILLIC SMALL LETTER A
    expect(v1(text)).toMatchObject({ hashtagUnits: 1, lexicalUnits: 2 });
    expect(computeContentComposition(text)).toEqual(v1(text));
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
