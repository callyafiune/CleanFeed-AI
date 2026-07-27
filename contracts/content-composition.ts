// The single, versioned definition of how a text is decomposed into classified
// units. Runtime eligibility (`src/inference/eligibility.ts`) and the Phase 2
// benchmark MUST both import this function so they can never drift into
// competing definitions of "lexical content".
//
// A unit is classified by this EXACT precedence:
//   1. URL          — http(s):// or www. prefixed token;
//   2. hashtag      — #<letters/numbers/underscore>;
//   3. emoji-only   — a run of emoji / modifiers / variation selectors / ZWJ;
//   4. lexical      — contains at least one Unicode letter or number;
//   5. other        — everything else (pure punctuation, symbols, …).
//
// The decomposition runs over the NORMALIZED text
// (`contracts/text-normalization.ts`): invisible-character removal moves where a
// unit boundary falls, and NFKC, invisible removal and confusable folding all
// move which category a unit lands in. Separator folding moves NEITHER — the
// split below is `/\S+/gu`, and `\s` already matched every separator that
// folding rewrites. `normalizeForInference` is idempotent, so it does not matter
// whether a caller passes raw or already normalized text — the counts are the
// same either way.

import { normalizeForInference } from "./text-normalization.ts";

/**
 * `lexical-content-v2` (A5): the decomposition is now taken over the normalized
 * text. Three concrete movements versus `v1`, each MEASURED against `v1`'s own
 * `/\S+/gu` split on this tree and each pinned by a test in
 * `tests/unit/contracts/content-composition.test.ts`, so the reason for spending
 * the version cannot drift back to an unmeasured one:
 *
 *   1. a unit made only of INVISIBLE characters vanishes, so `totalUnits` goes
 *      DOWN and `lexicalRatio` up: `uma <U+200B> palavra` was 3 units / 2
 *      lexical / ratio 2/3 and is now 2 units / 2 lexical / ratio 1. It has to
 *      be an invisible (U+200B, U+2060, U+180E, U+00AD) and NOT an exotic
 *      separator: JavaScript's `\s` already matches every Zs/Zl/Zp code point,
 *      so `v1` ALREADY split on NO-BREAK SPACE, IDEOGRAPHIC SPACE, LINE
 *      SEPARATOR and OGHAM SPACE MARK — folding those to U+0020 moves no count
 *      at all, and claiming it did was a wrong rationale, removed here;
 *   2. an invisible no longer sits INSIDE a unit, which can move the unit's
 *      CATEGORY: `#Cle<U+200B>anFeed` was `lexical`, because U+200B is not in
 *      `[\p{L}\p{N}_]`, and is now `hashtag`;
 *   3. a URL written with a confusable Cyrillic/Greek code point, or with
 *      full-width Latin, now classifies as `url` instead of `lexical`:
 *      `htt<U+0440>s://exemplo.com` and `<FULLWIDTH>https://exemplo.com`. A
 *      HASHTAG is NOT part of this movement — `\p{L}` matches Cyrillic, so
 *      `#Cle<U+0430>nFeed` already classified as `hashtag` under `v1`.
 *
 * Beyond the counts, the SCORED TEXT itself changes for 222 of the 5000
 * `development` + `calibration` records, which is the other half of why the
 * coordinate has to move: the same units, made of different bytes, reach the
 * tokenizer. It does NOT version the window plan — that is `AGGREGATION_VERSION`
 * (A2, `tmr-aggregation-v3`).
 *
 * The `222` is re-measured, not inherited. A5's second conformance round changed
 * WHOSE characters `foldConfusables` reads its script witnesses from (the source,
 * not NFKC's output — see `countScriptWitnesses`), and the whole dev+cal sweep
 * came out byte-identical: still `changed 222`, still `records with a folded
 * confusable: 0`, still `TNF-α`/`NF-κB`/`Муса` untouched
 * (`benchmark/out/rebuild-v3/a5-r2/`). That is why the coordinate stays at `v2`
 * across that round rather than moving again: no artifact produced under `v2` on
 * this corpus becomes wrong, so a bump would falsely order a re-score.
 */
export const CONTENT_COMPOSITION_VERSION = "lexical-content-v2";

const URL_PATTERN = /^(?:https?:\/\/|www\.)\S+$/iu;
const HASHTAG_PATTERN = /^#[\p{L}\p{N}_]+$/u;
const EMOJI_SEQUENCE_PATTERN =
  /(?:\p{Regional_Indicator}{2}|[#*0-9]️?⃣|\p{Extended_Pictographic}\p{Emoji_Modifier}?)(?:️|‍(?:\p{Extended_Pictographic}\p{Emoji_Modifier}?))*/gu;
const LEXICAL_PATTERN = /[\p{L}\p{N}]/u;

/** Per-category unit counts plus the lexical ratio, for `text`. */
export interface ContentComposition {
  /** Total whitespace-separated units. */
  totalUnits: number;
  lexicalUnits: number;
  urlUnits: number;
  hashtagUnits: number;
  emojiUnits: number;
  otherUnits: number;
  /** `lexicalUnits / totalUnits`, or 0 for empty input. */
  lexicalRatio: number;
}

export type ContentUnitKind = "url" | "hashtag" | "emoji" | "lexical" | "other";

function isEmojiOnly(token: string): boolean {
  return token.length > 0 && token.replace(EMOJI_SEQUENCE_PATTERN, "") === "";
}

/** Classifies a single already-tokenized unit under the fixed precedence. */
export function classifyContentUnit(token: string): ContentUnitKind {
  if (URL_PATTERN.test(token)) {
    return "url";
  }
  if (HASHTAG_PATTERN.test(token)) {
    return "hashtag";
  }
  if (isEmojiOnly(token)) {
    return "emoji";
  }
  if (LEXICAL_PATTERN.test(token)) {
    return "lexical";
  }
  return "other";
}

/**
 * Decomposes `text` into units and counts them by category. The text is put
 * through {@link normalizeForInference} first — the SAME normalization the
 * tokenizer sees, so composition and tokenization can never disagree about what
 * the text is — then CRLF is folded to LF and the result is split on runs of
 * Unicode whitespace.
 */
export function computeContentComposition(text: string): ContentComposition {
  const normalized = normalizeForInference(text).text.replace(/\r\n/gu, "\n");
  const units = normalized.match(/\S+/gu) ?? [];

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
    composition.totalUnits === 0
      ? 0
      : composition.lexicalUnits / composition.totalUnits;

  return composition;
}
