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

export const CONTENT_COMPOSITION_VERSION = "lexical-content-v1";

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
 * Decomposes `text` into units and counts them by category. CRLF is normalized
 * to LF first, then the text is split on runs of Unicode whitespace.
 */
export function computeContentComposition(text: string): ContentComposition {
  const normalized = text.replace(/\r\n/gu, "\n");
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
