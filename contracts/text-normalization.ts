// The single, shared Unicode normalization every inference path applies BEFORE
// tokenization: `src/inference` (the extension runtime) and `src/model-benchmark`
// (the sealed benchmark page) both call `normalizeForInference` from HERE, so the
// training/bench text and the runtime text can never diverge. It is versioned by
// `CONTENT_COMPOSITION_VERSION` (contracts/content-composition.ts), because it
// changes how a text decomposes into classified units and therefore moves
// `lexicalRatio` and eligibility.
//
// WHY it exists: homoglyph substitution zeroes detectors — Binoculars and
// Fast-DetectGPT drop to 0.000 TPR@1%FPR and Originality loses 75.7 points on
// RAID. The assembler already ran NFKC (`benchmark/lab/near_dupes.py`), but that
// is the corpus builder, not the detector.
//
// It does FOUR things, in this order, and nothing else:
//
//   1. NFKC per grapheme cluster, EXCEPT for the code points in
//      `NFKC_PROTECTED_CHARACTERS`, which NFKC would rewrite into different
//      pt-BR text (`…` → `...`, `º` → `o`, `²` → `2`);
//   2. drops invisible characters (`REMOVED_INVISIBLE_CHARACTERS` plus a
//      category catch-all) and folds every remaining separator to U+0020/U+000A;
//   3. maps confusable Cyrillic/Greek code points to Latin
//      (`CONFUSABLE_TO_LATIN`) — but only inside a word the mixed-script/
//      pseudo-Latin rule below marks as an attack, never inside genuine
//      Cyrillic, Greek, CJK, Hangul or any other script;
//   4. records a `normalized → original` offset map, because the D4 provenance
//      spans are defined in ORIGINAL character offsets and a span head trained
//      on shifted offsets is a silent bug.
//
// WHAT IT DOES NOT CLAIM (R7). It is not "homoglyph-proof". It folds exactly the
// code points enumerated in `CONFUSABLE_TO_LATIN`, in exactly the two word
// contexts named below. A confusable from an unlisted script (Cherokee,
// Armenian, Lisu…) is left as written, and so is an all-confusable Cyrillic or
// Greek word inside text whose non-confusable letters are themselves
// non-Latin — that text is foreign prose, not a pt-BR post under attack.

/**
 * The maximum absolute raw-score difference this contract promises between a
 * text and a homoglyph variant of it whose substitutions are all covered by
 * `CONFUSABLE_TO_LATIN`: EXACTLY ZERO. It is zero rather than merely small
 * because a covered variant normalizes to byte-identical text, so the tokenizer,
 * the window plan and the model all receive the same input — there is no
 * numerical slack to allow for. It is declared here, not chosen after measuring.
 */
export const HOMOGLYPH_SCORE_TOLERANCE = 0;

/**
 * Confusable → Latin, one code point to one ASCII Latin code point, curated by
 * hand rather than imported from a generic confusables list. Every entry is
 * written with its source code point and its target, and the 1:1 shape is what
 * makes the whole table offset-neutral: folding a confusable can never move a
 * character offset.
 *
 * Only the UNAMBIGUOUS pairs are listed. Cyrillic `з`/`и` and Greek
 * `τ`/`σ`/`β`/`λ` are deliberately ABSENT: they carry no Latin look-alike, so
 * leaving them out is what lets `казаки́` and `Κτησίβιος` — both real records in
 * `benchmark/data/corpus-build/records.jsonl` — survive untouched.
 */
export const CONFUSABLE_TO_LATIN: ReadonlyMap<string, string> = new Map([
  // --- Cyrillic, capitals -------------------------------------------------
  ["А", "A"], // U+0410 CYRILLIC CAPITAL LETTER A → U+0041
  ["В", "B"], // U+0412 CYRILLIC CAPITAL LETTER VE → U+0042
  ["Е", "E"], // U+0415 CYRILLIC CAPITAL LETTER IE → U+0045
  ["К", "K"], // U+041A CYRILLIC CAPITAL LETTER KA → U+004B
  ["М", "M"], // U+041C CYRILLIC CAPITAL LETTER EM → U+004D
  ["Н", "H"], // U+041D CYRILLIC CAPITAL LETTER EN → U+0048
  ["О", "O"], // U+041E CYRILLIC CAPITAL LETTER O → U+004F
  ["Р", "P"], // U+0420 CYRILLIC CAPITAL LETTER ER → U+0050
  ["С", "C"], // U+0421 CYRILLIC CAPITAL LETTER ES → U+0043
  ["Т", "T"], // U+0422 CYRILLIC CAPITAL LETTER TE → U+0054
  ["У", "Y"], // U+0423 CYRILLIC CAPITAL LETTER U → U+0059
  ["Х", "X"], // U+0425 CYRILLIC CAPITAL LETTER HA → U+0058
  ["Ѕ", "S"], // U+0405 CYRILLIC CAPITAL LETTER DZE → U+0053
  ["І", "I"], // U+0406 CYRILLIC CAPITAL LETTER BYELORUSSIAN-UKRAINIAN I → U+0049
  ["Ј", "J"], // U+0408 CYRILLIC CAPITAL LETTER JE → U+004A
  ["Ӏ", "I"], // U+04C0 CYRILLIC LETTER PALOCHKA → U+0049
  // --- Cyrillic, smalls ---------------------------------------------------
  ["а", "a"], // U+0430 CYRILLIC SMALL LETTER A → U+0061
  ["е", "e"], // U+0435 CYRILLIC SMALL LETTER IE → U+0065
  ["к", "k"], // U+043A CYRILLIC SMALL LETTER KA → U+006B
  ["о", "o"], // U+043E CYRILLIC SMALL LETTER O → U+006F
  ["р", "p"], // U+0440 CYRILLIC SMALL LETTER ER → U+0070
  ["с", "c"], // U+0441 CYRILLIC SMALL LETTER ES → U+0063
  ["у", "y"], // U+0443 CYRILLIC SMALL LETTER U → U+0079
  ["х", "x"], // U+0445 CYRILLIC SMALL LETTER HA → U+0078
  ["ѕ", "s"], // U+0455 CYRILLIC SMALL LETTER DZE → U+0073
  ["і", "i"], // U+0456 CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I → U+0069
  ["ј", "j"], // U+0458 CYRILLIC SMALL LETTER JE → U+006A
  ["һ", "h"], // U+04BB CYRILLIC SMALL LETTER SHHA → U+0068
  ["ӏ", "l"], // U+04CF CYRILLIC SMALL LETTER PALOCHKA → U+006C
  ["ԁ", "d"], // U+0501 CYRILLIC SMALL LETTER KOMI DE → U+0064
  ["ԛ", "q"], // U+051B CYRILLIC SMALL LETTER QA → U+0071
  ["ԝ", "w"], // U+051D CYRILLIC SMALL LETTER WE → U+0077
  // --- Greek, capitals ----------------------------------------------------
  ["Α", "A"], // U+0391 GREEK CAPITAL LETTER ALPHA → U+0041
  ["Β", "B"], // U+0392 GREEK CAPITAL LETTER BETA → U+0042
  ["Ε", "E"], // U+0395 GREEK CAPITAL LETTER EPSILON → U+0045
  ["Ζ", "Z"], // U+0396 GREEK CAPITAL LETTER ZETA → U+005A
  ["Η", "H"], // U+0397 GREEK CAPITAL LETTER ETA → U+0048
  ["Ι", "I"], // U+0399 GREEK CAPITAL LETTER IOTA → U+0049
  ["Κ", "K"], // U+039A GREEK CAPITAL LETTER KAPPA → U+004B
  ["Μ", "M"], // U+039C GREEK CAPITAL LETTER MU → U+004D
  ["Ν", "N"], // U+039D GREEK CAPITAL LETTER NU → U+004E
  ["Ο", "O"], // U+039F GREEK CAPITAL LETTER OMICRON → U+004F
  ["Ρ", "P"], // U+03A1 GREEK CAPITAL LETTER RHO → U+0050
  ["Τ", "T"], // U+03A4 GREEK CAPITAL LETTER TAU → U+0054
  ["Υ", "Y"], // U+03A5 GREEK CAPITAL LETTER UPSILON → U+0059
  ["Χ", "X"], // U+03A7 GREEK CAPITAL LETTER CHI → U+0058
  // --- Greek, smalls ------------------------------------------------------
  ["α", "a"], // U+03B1 GREEK SMALL LETTER ALPHA → U+0061
  ["ι", "i"], // U+03B9 GREEK SMALL LETTER IOTA → U+0069
  ["κ", "k"], // U+03BA GREEK SMALL LETTER KAPPA → U+006B
  ["ν", "v"], // U+03BD GREEK SMALL LETTER NU → U+0076
  ["ο", "o"], // U+03BF GREEK SMALL LETTER OMICRON → U+006F
  ["ρ", "p"], // U+03C1 GREEK SMALL LETTER RHO → U+0070
  ["υ", "u"], // U+03C5 GREEK SMALL LETTER UPSILON → U+0075
  ["ϲ", "c"], // U+03F2 GREEK LUNATE SIGMA SYMBOL → U+0063
]);

/**
 * The code points NFKC is NOT allowed to touch, because its compatibility
 * mapping would turn legitimate pt-BR orthography into different text. Each one
 * is a character NFKC really does rewrite — that is why it is on this list — and
 * each one occurs in the corpus: `benchmark/data/corpus-build/records.jsonl`
 * carries `16º` and `468&nbsp;km²` (`src_wikipedia_pt_201e401b7ee6`) and
 * `um acordo…` (`src_wikipedia_pt_bd7eb4154e14`).
 *
 * Everything else NFKC does is ALLOWED here, deliberately: ligatures fold
 * (`ﬁ` → `fi`), full-width Latin and styled/mathematical digits fold to ASCII,
 * exotic spaces fold to U+0020, and decomposed accents recompose (`a`+U+0303 →
 * `ã`). Travessão (U+2014), en dash (U+2013), curly quotes and guillemets have
 * no compatibility mapping at all, so they survive without protection.
 */
export const NFKC_PROTECTED_CHARACTERS: ReadonlySet<string> = new Set([
  "ª", // FEMININE ORDINAL INDICATOR — NFKC: "a"
  "²", // SUPERSCRIPT TWO — NFKC: "2"
  "³", // SUPERSCRIPT THREE — NFKC: "3"
  "¹", // SUPERSCRIPT ONE — NFKC: "1"
  "º", // MASCULINE ORDINAL INDICATOR — NFKC: "o"
  "…", // HORIZONTAL ELLIPSIS — NFKC: "..."
]);

/**
 * Invisible code points removed UNCONDITIONALLY. They render as nothing, so a
 * reader cannot see them, but they split tokens and are the cheapest known way
 * to break a detector. U+200D (ZWJ) and the variation selectors are NOT here:
 * they carry meaning inside an emoji sequence and are removed only when their
 * neighbour is not emoji-like (see `isEmojiJoinable`).
 */
export const REMOVED_INVISIBLE_CHARACTERS: ReadonlySet<string> = new Set([
  "\u00AD", // SOFT HYPHEN
  "\u034F", // COMBINING GRAPHEME JOINER
  "\u061C", // ARABIC LETTER MARK
  "\u115F", // HANGUL CHOSEONG FILLER
  "\u1160", // HANGUL JUNGSEONG FILLER
  "\u180E", // MONGOLIAN VOWEL SEPARATOR
  "\u200B", // ZERO WIDTH SPACE
  "\u200C", // ZERO WIDTH NON-JOINER
  "\u200E", // LEFT-TO-RIGHT MARK
  "\u200F", // RIGHT-TO-LEFT MARK
  "\u202A", // LEFT-TO-RIGHT EMBEDDING
  "\u202B", // RIGHT-TO-LEFT EMBEDDING
  "\u202C", // POP DIRECTIONAL FORMATTING
  "\u202D", // LEFT-TO-RIGHT OVERRIDE
  "\u202E", // RIGHT-TO-LEFT OVERRIDE
  "\u2060", // WORD JOINER
  "\u2061", // FUNCTION APPLICATION
  "\u2062", // INVISIBLE TIMES
  "\u2063", // INVISIBLE SEPARATOR
  "\u2064", // INVISIBLE PLUS
  "\u2066", // LEFT-TO-RIGHT ISOLATE
  "\u2067", // RIGHT-TO-LEFT ISOLATE
  "\u2068", // FIRST STRONG ISOLATE
  "\u2069", // POP DIRECTIONAL ISOLATE
  "\u3164", // HANGUL FILLER - NFKC folds it to U+1160, also removed
  "\uFEFF", // ZERO WIDTH NO-BREAK SPACE (BOM)
  "\uFFA0", // HALFWIDTH HANGUL FILLER - NFKC folds it to U+1160
]);

/**
 * One contiguous piece of the normalization, mapping a run of the normalized
 * text onto the run of the ORIGINAL text it came from. The segments partition
 * BOTH texts exactly and in order: `segments[i].normalizedEnd ===
 * segments[i + 1].normalizedStart` and `segments[i].originalEnd ===
 * segments[i + 1].originalStart`, the first starts at 0 in both and the last
 * ends at each text's length. A segment whose two lengths are equal is a 1:1
 * run (nothing moved inside it); any other segment is a rewrite — a removal, an
 * expansion, or a fold — and offsets inside it round OUTWARD to the whole
 * segment, so a reconstructed span always CONTAINS its source characters.
 */
export interface NormalizationSegment {
  readonly normalizedStart: number;
  readonly normalizedEnd: number;
  readonly originalStart: number;
  readonly originalEnd: number;
}

/** A normalized text plus the map back to the offsets D4's spans are defined in. */
export interface NormalizedText {
  /** The text every downstream stage sees: tokenizer, windowing, model. */
  readonly text: string;
  /** The caller's text, unchanged, so the map has something to point at. */
  readonly original: string;
  /** `text !== original`. */
  readonly changed: boolean;
  readonly segments: readonly NormalizationSegment[];
}

/** Which side of a boundary an offset is being mapped as. */
export type OffsetEdge = "start" | "end";

const COMBINING_MARK = /\p{M}/u;
const LETTER = /\p{L}/u;
const LATIN_LETTER = /\p{Script=Latin}/u;
const CONFUSABLE_SCRIPT_LETTER = /[\p{Script=Cyrillic}\p{Script=Greek}]/u;
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;
const SPACE_SEPARATOR = /\p{Zs}/u;
const LINE_SEPARATOR = /[\p{Zl}\p{Zp}]/u;
const FORMAT_CHARACTER = /\p{Cf}/u;
const CONTROL_CHARACTER = /\p{Cc}/u;
const EMOJI_JOINABLE =
  /[\p{Extended_Pictographic}\p{Emoji_Modifier}\p{Regional_Indicator}]/u;
const KEYCAP_BASE = /[0-9#*]/u;
const ZERO_WIDTH_JOINER = "\u200D";
const VARIATION_SELECTOR = /[\uFE00-\uFE0F]/u;
/** Text made only of these can never change, so it skips the whole pipeline. */
const PLAIN_ASCII = /^[\t\n\r\x20-\x7E]*$/u;

/** One output code point and the original range it is accountable for. */
interface Atom {
  char: string;
  originalStart: number;
  originalEnd: number;
}

/** Control characters that survive: the tokenizer's own whitespace set. */
function isKeptControl(char: string): boolean {
  return char === "\t" || char === "\n" || char === "\r";
}

/** True for a neighbour that can legitimately carry a ZWJ or a selector. */
function isEmojiJoinable(char: string | undefined): boolean {
  return char !== undefined && EMOJI_JOINABLE.test(char);
}

/** Splits `text` into base-plus-marks clusters, in UTF-16 index space. */
function clusterRanges(text: string): { start: number; end: number }[] {
  const ranges: { start: number; end: number }[] = [];
  let index = 0;
  while (index < text.length) {
    const base = String.fromCodePoint(text.codePointAt(index)!);
    let end = index + base.length;
    while (end < text.length) {
      const next = String.fromCodePoint(text.codePointAt(end)!);
      if (!COMBINING_MARK.test(next)) {
        break;
      }
      end += next.length;
    }
    ranges.push({ start: index, end });
    index = end;
  }
  return ranges;
}

/**
 * Step 1: NFKC, cluster by cluster, skipping any cluster whose base is
 * protected. Working per cluster keeps the transformation LOCAL, so each output
 * code point can name the original characters it came from; a whole-string
 * `normalize()` cannot. When a cluster is unchanged, each of its code points
 * keeps its own exact range (the common case, and the one that keeps the map an
 * identity); when it changed, every output code point is charged to the whole
 * cluster, which is what makes an expansion round outward.
 */
function composeAtoms(original: string): Atom[] {
  const atoms: Atom[] = [];
  for (const range of clusterRanges(original)) {
    const source = original.slice(range.start, range.end);
    const base = String.fromCodePoint(source.codePointAt(0)!);
    const folded = NFKC_PROTECTED_CHARACTERS.has(base)
      ? source
      : source.normalize("NFKC");
    if (folded === source) {
      let cursor = range.start;
      for (const char of source) {
        atoms.push({
          char,
          originalStart: cursor,
          originalEnd: cursor + char.length,
        });
        cursor += char.length;
      }
      continue;
    }
    for (const char of folded) {
      atoms.push({
        char,
        originalStart: range.start,
        originalEnd: range.end,
      });
    }
  }
  return atoms;
}

/**
 * Step 2: drop the invisible characters and fold every remaining separator.
 * Neighbours are read from the PRE-removal stream, so an attacker's inserted
 * character sees the characters it was inserted between, and a genuine emoji
 * sequence keeps the joiners that compose it.
 */
function stripInvisible(atoms: readonly Atom[]): Atom[] {
  const kept: Atom[] = [];
  for (let index = 0; index < atoms.length; index += 1) {
    const atom = atoms[index]!;
    const char = atom.char;
    if (char === ZERO_WIDTH_JOINER) {
      if (
        isEmojiJoinable(atoms[index - 1]?.char) &&
        isEmojiJoinable(atoms[index + 1]?.char)
      ) {
        kept.push(atom);
      }
      continue;
    }
    if (VARIATION_SELECTOR.test(char)) {
      const previous = atoms[index - 1]?.char;
      if (
        isEmojiJoinable(previous) ||
        (previous !== undefined && KEYCAP_BASE.test(previous))
      ) {
        kept.push(atom);
      }
      continue;
    }
    if (REMOVED_INVISIBLE_CHARACTERS.has(char)) {
      continue;
    }
    if (CONTROL_CHARACTER.test(char)) {
      if (isKeptControl(char)) {
        kept.push(atom);
      }
      continue;
    }
    if (FORMAT_CHARACTER.test(char)) {
      continue;
    }
    if (SPACE_SEPARATOR.test(char)) {
      kept.push({ ...atom, char: " " });
      continue;
    }
    if (LINE_SEPARATOR.test(char)) {
      kept.push({ ...atom, char: "\n" });
      continue;
    }
    kept.push(atom);
  }
  return kept;
}

/**
 * Whether the document's SCRIPT WITNESSES are Latin. A witness is a letter with
 * no Latin confusable at all — `b`, `f`, `ç` on one side, `з`, `и`, `ж` on the
 * other. Counting witnesses rather than letters is what survives a total attack:
 * substituting every confusable in a pt-BR text leaves all of its witnesses
 * Latin, while a Russian sentence's witnesses stay Cyrillic however many
 * confusables it happens to contain.
 */
function isLatinDominant(atoms: readonly Atom[]): boolean {
  let latin = 0;
  let other = 0;
  for (const atom of atoms) {
    if (!LETTER.test(atom.char) || CONFUSABLE_TO_LATIN.has(atom.char)) {
      continue;
    }
    if (LATIN_LETTER.test(atom.char)) {
      latin += 1;
    } else {
      other += 1;
    }
  }
  return latin > other;
}

/**
 * Step 3: fold confusables, word by word. A word is folded when it is
 *
 *   - MIXED SCRIPT: it carries at least one Latin letter AND at least one
 *     Cyrillic or Greek letter (`аbacate` — nobody writes that on purpose); or
 *   - PSEUDO-LATIN: it carries no Latin letter, every one of its letters has a
 *     Latin confusable, and the document is Latin-dominant (`саѕа`, the shape a
 *     total substitution of `casa` produces).
 *
 * Everything else is left exactly as written, which is what keeps `花巻市`,
 * `казаки́` and `Κτησίβιος` intact. The fold is 1:1 per code point, so no offset
 * moves here.
 */
function foldConfusables(atoms: Atom[]): void {
  const latinDominant = isLatinDominant(atoms);
  let index = 0;
  while (index < atoms.length) {
    if (!WORD_CHARACTER.test(atoms[index]!.char)) {
      index += 1;
      continue;
    }
    let end = index;
    while (end < atoms.length && WORD_CHARACTER.test(atoms[end]!.char)) {
      end += 1;
    }
    let hasLatin = false;
    let hasConfusableScript = false;
    let letters = 0;
    let allLettersConfusable = true;
    for (let scan = index; scan < end; scan += 1) {
      const char = atoms[scan]!.char;
      if (!LETTER.test(char)) {
        continue;
      }
      letters += 1;
      if (LATIN_LETTER.test(char)) {
        hasLatin = true;
      } else if (CONFUSABLE_SCRIPT_LETTER.test(char)) {
        hasConfusableScript = true;
      }
      if (!CONFUSABLE_TO_LATIN.has(char)) {
        allLettersConfusable = false;
      }
    }
    const mixedScript = hasLatin && hasConfusableScript;
    const pseudoLatin =
      !hasLatin &&
      hasConfusableScript &&
      letters > 0 &&
      allLettersConfusable &&
      latinDominant;
    if (mixedScript || pseudoLatin) {
      for (let scan = index; scan < end; scan += 1) {
        const replacement = CONFUSABLE_TO_LATIN.get(atoms[scan]!.char);
        if (replacement !== undefined) {
          atoms[scan]!.char = replacement;
        }
      }
    }
    index = end;
  }
}

/**
 * Step 4: build the text and the segment map. Consecutive atoms charged to the
 * SAME original range become one segment (that is how an expansion stays
 * attributable), any original characters that were dropped are absorbed into
 * the segment that follows them, and adjacent 1:1 segments are coalesced so the
 * unchanged case collapses to a single identity segment.
 */
function buildSegments(
  original: string,
  atoms: readonly Atom[],
): { text: string; segments: NormalizationSegment[] } {
  const pieces: string[] = [];
  const segments: NormalizationSegment[] = [];
  let normalizedPos = 0;
  let originalCursor = 0;
  let index = 0;
  while (index < atoms.length) {
    const first = atoms[index]!;
    let end = index + 1;
    while (
      end < atoms.length &&
      atoms[end]!.originalStart === first.originalStart &&
      atoms[end]!.originalEnd === first.originalEnd
    ) {
      end += 1;
    }
    let run = "";
    for (let scan = index; scan < end; scan += 1) {
      run += atoms[scan]!.char;
    }
    pieces.push(run);
    const segment: NormalizationSegment = {
      normalizedStart: normalizedPos,
      normalizedEnd: normalizedPos + run.length,
      originalStart: originalCursor,
      originalEnd: first.originalEnd,
    };
    normalizedPos = segment.normalizedEnd;
    originalCursor = segment.originalEnd;
    const previous = segments.at(-1);
    if (previous !== undefined && isOneToOne(previous) && isOneToOne(segment)) {
      segments[segments.length - 1] = {
        normalizedStart: previous.normalizedStart,
        normalizedEnd: segment.normalizedEnd,
        originalStart: previous.originalStart,
        originalEnd: segment.originalEnd,
      };
    } else {
      segments.push(segment);
    }
    index = end;
  }
  // Characters dropped at the very end have no following segment to absorb
  // them, so the last segment answers for them and the map stays total.
  const last = segments.at(-1);
  if (last !== undefined && last.originalEnd < original.length) {
    segments[segments.length - 1] = {
      ...last,
      originalEnd: original.length,
    };
  }
  return { text: pieces.join(""), segments };
}

function isOneToOne(segment: NormalizationSegment): boolean {
  return (
    segment.normalizedEnd - segment.normalizedStart ===
    segment.originalEnd - segment.originalStart
  );
}

/** The identity result, for text no step can change. */
function unchanged(original: string): NormalizedText {
  return {
    text: original,
    original,
    changed: false,
    segments:
      original.length === 0
        ? []
        : [
            {
              normalizedStart: 0,
              normalizedEnd: original.length,
              originalStart: 0,
              originalEnd: original.length,
            },
          ],
  };
}

/**
 * Normalizes `text` for inference and returns it with the map back to `text`'s
 * own offsets. Idempotent: normalizing the result again returns it unchanged.
 */
export function normalizeForInference(text: string): NormalizedText {
  if (PLAIN_ASCII.test(text)) {
    return unchanged(text);
  }
  const atoms = stripInvisible(composeAtoms(text));
  foldConfusables(atoms);
  const { text: normalized, segments } = buildSegments(text, atoms);
  if (normalized === text) {
    return unchanged(text);
  }
  return { text: normalized, original: text, changed: true, segments };
}

function segmentIndexFor(
  segments: readonly NormalizationSegment[],
  offset: number,
  edge: OffsetEdge,
): number {
  let low = 0;
  let high = segments.length - 1;
  while (low <= high) {
    const middle = (low + high) >> 1;
    const segment = segments[middle]!;
    const before =
      edge === "end" ? offset <= segment.normalizedStart : offset < segment.normalizedStart;
    const after =
      edge === "end" ? offset > segment.normalizedEnd : offset >= segment.normalizedEnd;
    if (before) {
      high = middle - 1;
    } else if (after) {
      low = middle + 1;
    } else {
      return middle;
    }
  }
  return Math.min(Math.max(low, 0), segments.length - 1);
}

/**
 * The offset in the ORIGINAL text for `offset` in the normalized text. `edge`
 * says which side of a boundary is being asked about, which is what makes a
 * rewritten segment round OUTWARD: a "start" lands on the segment's first
 * original character, an "end" past its last one.
 */
export function originalOffsetFromNormalized(
  normalized: NormalizedText,
  offset: number,
  edge: OffsetEdge = "start",
): number {
  if (normalized.segments.length === 0) {
    return edge === "end" ? normalized.original.length : 0;
  }
  if (offset <= 0) {
    return 0;
  }
  if (offset >= normalized.text.length) {
    return normalized.original.length;
  }
  const segment = normalized.segments[
    segmentIndexFor(normalized.segments, offset, edge)
  ]!;
  if (isOneToOne(segment)) {
    return segment.originalStart + (offset - segment.normalizedStart);
  }
  return edge === "end" ? segment.originalEnd : segment.originalStart;
}

/**
 * The ORIGINAL span for a normalized `[start, end)` span, rounded outward so it
 * always contains every original character that produced the normalized range.
 * This is the function a span-level head must use to place a D4 provenance span.
 */
export function originalSpanFromNormalized(
  normalized: NormalizedText,
  start: number,
  end: number,
): { start: number; end: number } {
  const originalStart = originalOffsetFromNormalized(normalized, start, "start");
  const originalEnd = originalOffsetFromNormalized(normalized, end, "end");
  return {
    start: originalStart,
    end: Math.max(originalStart, originalEnd),
  };
}

/** The original text behind a normalized `[start, end)` span. */
export function originalSliceFromNormalized(
  normalized: NormalizedText,
  start: number,
  end: number,
): string {
  const span = originalSpanFromNormalized(normalized, start, end);
  return normalized.original.slice(span.start, span.end);
}
