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
//   1. NFKC per grapheme cluster, refused for three families NFKC would rewrite
//      into different pt-BR text: `NFKC_PROTECTED_CHARACTERS` (`…` → `...`,
//      `º` → `o`), superscripts and subscripts (`km²` → `km2`, `H₂O` → `H2O`)
//      and any fold that would INVENT whitespace (`´` → `" ́"`);
//   2. drops invisible characters (`REMOVED_INVISIBLE_CHARACTERS` plus a
//      category catch-all) and folds every remaining separator to U+0020/U+000A;
//   3. maps confusable Cyrillic/Greek code points to Latin
//      (`CONFUSABLE_TO_LATIN`) — but only inside a word the mixed-script/
//      pseudo-Latin rule marks as an attack, never inside genuine Cyrillic,
//      Greek, CJK, Hangul or any other script. Step 3 runs AFTER step 1, so the
//      evidence it reads about which scripts the document contains comes from
//      the AUTHOR's own characters and never from NFKC's output — see
//      `countScriptWitnesses`;
//   4. records a `normalized → original` offset map, because the D4 provenance
//      spans are defined in ORIGINAL character offsets and a span head trained
//      on shifted offsets is a silent bug.
//
// WHAT IT DOES NOT CLAIM (R7). It is not "homoglyph-proof". It folds a SUBSET of
// the code points enumerated in `CONFUSABLE_TO_LATIN`, in exactly the word
// contexts `foldConfusables` names. A confusable from an unlisted script
// (Cherokee, Armenian, Lisu…) is left as written; so is an all-confusable word in
// a document that carries any non-Latin witness, a Greek code point in a document
// that also writes Greek, a one-letter word disguised with a Greek confusable,
// and `ϲ` U+03F2 — a table key step 1 folds to `ς` before step 3 can reach it.
// The first three exclusions exist because the looser rule was MEASURED to
// rewrite genuine corpus text; the counts and the record ids are in the comments
// below. The `ϲ` one is not a choice at all, just an order-of-steps fact, and it
// is stated because `HOMOGLYPH_SCORE_TOLERANCE` would otherwise promise zero for
// it.
//
// Nor does it claim never to rewrite legitimate text — only that it rewrites none
// on a measured corpus. It rewrites a genuine non-Latin word made entirely of
// table keys when the document's ONLY non-Latin evidence is a script-neutral
// character NFKC folds into a non-Latin letter: `a constante 𝛽 vale 3 e o nome
// Муса aparece aqui` → `… Myca …`, zero occurrences across `development` +
// `calibration`. That is the price of taking the witness from the source, it is
// argued in `countScriptWitnesses` and pinned as the fourth non-invariant class.

/**
 * The maximum absolute raw-score difference this contract promises between a
 * text and a COVERED homoglyph variant of it: EXACTLY ZERO. It is zero rather
 * than merely small because a covered variant normalizes to byte-identical text,
 * so the tokenizer, the window plan and the model all receive the same input —
 * there is no numerical slack to allow for. It is declared here, not chosen
 * after measuring.
 *
 * "Covered" is the CONTRACT, and it is narrower than the table (R7). It is a
 * property of each SUBSTITUTION, not of the word it sits in: a substitution is
 * covered when its code point is a key of `CONFUSABLE_TO_LATIN` AND
 * `foldConfusables` actually rewrites THAT code point — its word is marked as an
 * attack, and neither Greek exception applies to it. Per-word is the wrong
 * altitude and it would over-claim, because the Greek exceptions are applied per
 * code point INSIDE a word the rule did mark as an attack: measured on this tree,
 * `a constante β vale 3 e uma νidа longa` (Greek `ν`, Latin `id`, Cyrillic `а`)
 * normalizes to `… νida longa` — the `а` was rewritten, so the word IS one
 * `foldConfusables` folds, while the `ν` survives. A variant is covered only when
 * EVERY substitution in it is.
 *
 * Four classes fall OUTSIDE, and for them the difference is not bounded by this
 * constant at all — all four measured on this tree. The first three are attacks the
 * fold deliberately does not restore; the fourth runs the other way, and is genuine
 * text the fold rewrites:
 *
 *   - a WHOLLY-CONFUSABLE word in a document carrying any non-Latin witness.
 *     `Guizhou ou Kueichau (贵州) e uma casa amarela` attacked to `саѕа` keeps the
 *     `саѕа`, because `贵`/`州` are witnesses and the pseudo-Latin gate needs
 *     `unmixedLatin`;
 *   - a GREEK code point in a document that also writes Greek, whatever its word.
 *     `a constante β vale 3 e uma vida longa` attacked to `νida` keeps the `ν`,
 *     because the `β` says the document really writes Greek — and so does the
 *     `νidа` shape above, where the Cyrillic in the SAME word does fold;
 *   - a substitution with a key that NFKC does not leave alone. `ϲ` (U+03F2 GREEK
 *     LUNATE SIGMA SYMBOL) is a table key, but step 1 folds it to `ς` before step
 *     3 ever sees it, and `ς` is not a key: `uma ϲasa` stays `uma ςasa`. Measured
 *     — it is the ONLY key in the table that is not NFKC-stable, which the test
 *     file asserts over the table rather than against a copied count.
 *
 * The fourth is the same contract failing in the opposite direction, so it is worth
 * a sentence of its own: GENUINE non-Latin text is rewritten when the document's
 * only non-Latin evidence is a script-neutral character NFKC folds into a non-Latin
 * letter. `a constante 𝛽 vale 3 e o nome Муса aparece aqui` (U+1D6FD, Script=Common,
 * NFKC → `β`) normalizes to `… o nome Myca aparece aqui`, while the same sentence
 * with a real `β` keeps the name. Zero occurrences across `development` +
 * `calibration`; the full argument, and why the alternative was a 541-entry curated
 * list, is in `countScriptWitnesses`.
 *
 * None of the four is an oversight. The first two are the measured price of not
 * rewriting `TNF-α` and the Chechen name `Муса` in real records (see
 * `countScriptWitnesses`); drop the witness and the very same attack becomes
 * covered again. The third is why the `ϲ` entry stays in the table even though
 * the fold can never reach it: after this file started reading witnesses from the
 * SOURCE, that entry is what stops an attacker's `ϲ` from being counted as a
 * genuine Greek witness. The fourth is what that same source-reading costs. All
 * four are pinned as NON-invariant by
 * `tests/unit/contracts/text-normalization.test.ts`, so neither the unconditional
 * reading of the tolerance nor an unqualified "it does not rewrite legitimate text"
 * can come back green.
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
 * The list is CLOSED, and it is not the only guard: {@link addsWhitespace}
 * refuses any NFKC fold that would INVENT whitespace the source did not have.
 * That is a rule rather than a list because the space-adding folds are a whole
 * family — every spacing diacritic decomposes to U+0020 plus a combining mark
 * (`´` → `" ́"`, `¨` → `" ̈"`, `¸` → `" ̧"`) — and inventing a space invents a
 * word boundary, which moves `totalUnits`, the word count and the length bucket.
 * Measured: `´` occurs in 9 rewrites across `development` + `calibration`.
 *
 * Everything else NFKC does is ALLOWED here, deliberately: ligatures fold
 * (`ﬁ` → `fi`), full-width Latin and styled/mathematical digits fold to ASCII,
 * exotic spaces fold to U+0020 (their source IS whitespace, so the rule above
 * does not fire), the non-breaking hyphen folds to U+2010, and decomposed
 * accents recompose (`a`+U+0303 → `ã`). Travessão (U+2014), en dash (U+2013),
 * curly quotes and guillemets have no compatibility mapping at all, so they
 * survive without protection.
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
const GREEK_LETTER = /\p{Script=Greek}/u;
/**
 * Never evidence that a document contains a particular script. Two of the three
 * classes are script-neutral by Unicode's own definition — Script=Common (digits,
 * punctuation, the mathematical alphanumeric symbols, the squared SI units, U+00B5
 * MICRO SIGN) and Script=Inherited. Read `countScriptWitnesses` for why that
 * matters.
 *
 * The third class, `\p{M}`, is a DELIBERATE addition and not a Unicode property:
 * plenty of combining marks carry a specific Script (U+0483 COMBINING CYRILLIC
 * TITLO is Cyrillic, U+05B0 HEBREW POINT SHEVA is Hebrew, U+0E31 and U+0BBE are
 * Thai and Tamil), so the two script properties alone do not cover them. They are
 * neutralized here because a mark rides on a BASE of its own script and that base
 * attests on its own, so nothing legitimate is lost — while leaving them in was
 * measured to reopen, with one extra character, the very path
 * `countScriptWitnesses` exists to close: step 1 charges every atom of a CHANGED
 * cluster to the whole cluster, so `5 µ҃m e uma саѕа` put the Cyrillic titlo into
 * the source slice read for the folded `μ` and kept its `саѕа`, exactly as the bare
 * micro sign used to. Splitting the class by Script also had no principle behind
 * it: U+064B ARABIC FATHATAN and U+0951 DEVANAGARI STRESS SIGN UDATTA are
 * Script=Inherited and already attested nothing, while their Hebrew and Cyrillic
 * counterparts attested.
 *
 * The residual is stated rather than implied: a mark whose base does NOT attest —
 * a Cyrillic titlo written over a Latin letter, a lone Hebrew point quoted as the
 * subject of a sentence — now attests nothing at all. That is the case where the
 * "the base attests" argument does not hold, it is not covered, and the fold is
 * enabled rather than vetoed there.
 */
const SCRIPT_NEUTRAL = /[\p{Script=Common}\p{Script=Inherited}\p{M}]/u;
const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;
const SPACE_SEPARATOR = /\p{Zs}/u;
const WHITESPACE = /\s/u;
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

/**
 * True when an NFKC fold would INVENT whitespace. Every spacing diacritic
 * decomposes to U+0020 plus a combining mark, and a space the author did not
 * write is a word boundary the author did not write: it splits a unit, moves the
 * word count and can move the length bucket. A source that already carried
 * whitespace (an exotic space folding to U+0020) is not affected.
 */
function addsWhitespace(source: string, folded: string): boolean {
  return WHITESPACE.test(folded) && !WHITESPACE.test(source);
}

/**
 * Superscripts and subscripts, which NFKC FLATTENS onto the baseline: `km²`
 * becomes `km2`, `10⁻⁶` becomes `10−6` and `H₂O` becomes `H2O`. That is a change
 * of meaning, not of encoding, and the corpus is full of it — `₂` alone accounts
 * for 28 rewrites across `development` + `calibration`, plus `⁶ ⁸ ⁹ ₃ ₄ ₓ ⁻`.
 *
 * What it protects is the three Latin-1 legacy characters (`² ³ ¹`) plus
 * U+2070-U+209C, the tightest range that SPANS every assigned code point of the
 * SUPERSCRIPTS-AND-SUBSCRIPTS block (U+2070-U+209F). It is not "the assigned part"
 * of that block, because the assigned part is not an interval: six code points of
 * the block carry no general category — U+2072, U+2073, U+208F, U+209D, U+209E,
 * U+209F — and THREE of them (U+2072, U+2073, U+208F) sit inside the guarded range,
 * so the guard covers them too. That is harmless and is exactly why the guard is
 * block-shaped rather than a hand-picked list of the characters this corpus happens
 * to contain; the count and the interior three are pinned by test. What the range
 * holds is mostly raised and lowered digits and operators, where flattening merges
 * `km²` into `km2`, plus two raised LETTERS that ride along inside it — `ⁱ`
 * (U+2071) and `ⁿ` (U+207F), both verified to survive.
 *
 * The residual is stated as a PROPERTY, not as a list, because a list of the
 * ranges this file happened to look at is the same over-claim one altitude down:
 * every NFKC-flattening raised letter OUTSIDE U+2070-U+209C stays outside the
 * guard. The Phonetic Extensions modifier letters (U+1D2C-U+1D6A, U+1D78,
 * U+1D9B-U+1DBF) and the Spacing Modifier Letters (U+02B0-U+02B8, U+02E0-U+02E4)
 * are among them — measured, `xʰ` → `xh` and `xʷ` → `xw` flatten exactly like
 * `30ᵉ` → `30e` — and they are not an exhaustive enumeration either. Of that whole
 * residual this corpus contains exactly `ᵉ` (U+1D49) and `ᶰ` (U+1DB0), one rewrite
 * each across `development` + `calibration`
 * (`benchmark/out/rebuild-v3/a5/normalization-rewrites.txt`), and both are pinned
 * by a test. Extending the guard over them would move the scored text of those two
 * records, so it is a measurement job — a new dev+cal sweep and a re-measured
 * `222 of 5000` — not a comment fix; it was left out deliberately and this
 * sentence is the record of that.
 */
const SUPERSCRIPT_OR_SUBSCRIPT = /^[\u00B2\u00B3\u00B9\u2070-\u209C]$/u;

/**
 * True for a neighbour that can legitimately carry a ZWJ or a selector. The
 * variation selectors count: the real sequence for `🤦‍♀️` is
 * `🤦 FE0F ZWJ ♀ FE0F`, so the character immediately before that ZWJ is a
 * selector, not the pictograph. Measured — leaving them out dropped the joiner
 * of two real records' emoji.
 */
function isEmojiJoinable(char: string | undefined): boolean {
  return (
    char !== undefined &&
    (EMOJI_JOINABLE.test(char) || VARIATION_SELECTOR.test(char))
  );
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
    const candidate =
      NFKC_PROTECTED_CHARACTERS.has(base) || SUPERSCRIPT_OR_SUBSCRIPT.test(base)
        ? source
        : source.normalize("NFKC");
    const folded = addsWhitespace(source, candidate) ? source : candidate;
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
 * How many SCRIPT WITNESSES the document carries, per side. A witness is a letter
 * with NO Latin confusable at all — `b`, `f`, `ç` on one side; `з`, `и`, `ж`, `β`,
 * `λ`, `花` on the other. Witnesses rather than letters, because substituting
 * every confusable in a pt-BR text leaves all of its witnesses Latin, while ONE
 * Cyrillic, Greek or Han witness anywhere proves the document really does contain
 * that script.
 *
 * Both thresholds below are `=== 0` rather than a majority, and that is a
 * measured correction. Under a majority rule the fold rewrote genuine text in 5
 * of the 5000 development + calibration records: `TNF-α` became `TNF-a` and
 * `NF-κB` became `NF-kB` (`src_ai_public_madras_7e700c7f00ab`, `…_7e8a1465ec45`,
 * `…_7fe4198396df`, `src_carolina_7bb17c80e5de`) and the Chechen name `Муса`
 * became `Myca` (`mix_src_wikipedia_pt_5eff3608eeb8`). Each of those documents
 * carries a witness — `β`, or `Дудин`'s `д` — while a homoglyph variant of pt-BR
 * prose produces none at all, so zero is the threshold that separates them.
 *
 * WHOSE EVIDENCE IT IS. The claim above is about what the AUTHOR wrote, so the
 * non-Latin side is read from the ORIGINAL characters each atom came from and NOT
 * from the atom itself. Reading the atom made NFKC able to manufacture the very
 * evidence that then switched the fold off for the whole document. Measured, and
 * this is why the parameter exists rather than a comment saying it should:
 *
 *   - U+00B5 MICRO SIGN is Script=Common in the source — it is the SI prefix of
 *     `µm`/`µg`/`µl`, ordinary pt-BR encyclopedic and scientific prose — but NFKC
 *     folds it to U+03BC GREEK SMALL LETTER MU. Read off the atom it was both a
 *     `nonLatin` and a `greek` witness, so `5 µm e uma саѕа` kept its `саѕа`. One
 *     development record (`src_carolina_23f8e515f0eb`, four occurrences) scored
 *     that way, and typing a micro sign was a one-character way to disable the
 *     defense;
 *   - `ϲ` U+03F2 is a table KEY that NFKC folds to `ς`, which is not a key. Read
 *     off the atom, an attacker's own substitution became a Greek witness and
 *     switched `greekIsContent` on document-wide.
 *
 * The rule that fixes both is one rule: script evidence comes from a character
 * Unicode assigns to a SPECIFIC script, taken from the source. Script=Common and
 * Script=Inherited characters are script-neutral by Unicode's own definition and
 * so cannot be evidence for any script (`SCRIPT_NEUTRAL`), and a source character
 * that is already a known confusable is a suspect, not a witness. Letterhood is
 * NOT required of the source: `⼀` U+2F00 KANGXI RADICAL ONE is Script=Han but
 * category So, and it folds to the letter `一` — demanding a letter would throw
 * that Han witness away.
 *
 * WHAT THE SOURCE SLICE CONTAINS, which the rule has to answer for. Step 1 works
 * per grapheme cluster and charges every atom of a CHANGED cluster to the WHOLE
 * cluster, so the slice read below is a base plus its combining marks — never a
 * neighbouring letter, but not a single character either. That is why `\p{M}` as a
 * whole is neutral (`SCRIPT_NEUTRAL`) and not only the Inherited marks Unicode
 * happens to call script-neutral: measured, `5 µ҃m e uma саѕа` kept its `саѕа`
 * because U+0483 COMBINING CYRILLIC TITLO rode along in the micro sign's cluster and
 * attested Cyrillic for the whole document. Marks are neutralized rather than the
 * slice narrowed, because narrowing it to the base would be a second rule with no
 * argument behind it, while "a mark rides on a base of its own script and the base
 * attests on its own" is one.
 *
 * THE PRICE, named in the direction that hurts. A Script=Common character that
 * folds to a genuine non-Latin letter no longer attests its script either — and the
 * consequence is not only that an attacked word beside it gets folded, which is the
 * benign half. The harmful half: a document whose ONLY non-Latin evidence is such a
 * fold LOSES the protection this whole function exists to give, so a genuine
 * non-Latin word made entirely of table keys is rewritten. Measured on this tree,
 * one code point of difference either way:
 *
 *   - `a constante 𝛽 vale 3 e o nome Муса aparece aqui` (U+1D6FD MATHEMATICAL
 *     ITALIC SMALL BETA, Script=Common, NFKC → `β`) → `… o nome Myca aparece aqui`.
 *     The Chechen name is destroyed, because every one of `М у с а` is a table key
 *     and the pseudo-Latin gate now sees no witness;
 *   - the same sentence written with a real `β` keeps `Муса` untouched.
 *
 * That is the centre of the rule and not a corner of it: the mathematical Greek
 * alphabets U+1D6A8-U+1D7CB are 297 of the folds counted below, and `㎛` U+339B and
 * `㈠` U+3220 PARENTHESIZED IDEOGRAPH ONE → `(一)` behave the same way. On THIS
 * corpus the cost is nil — 0 records of the 5000 in `development` + `calibration`
 * normalize differently — which is the measurement the rule was chosen on, and both
 * halves of the price are pinned as a fourth NON-invariant class by
 * `tests/unit/contracts/text-normalization.test.ts`, so a later corpus carrying
 * mathematical Greek or parenthesized CJK in volume turns it into a red test rather
 * than a silent rewrite. Going finer would mean judging 297 Greek-producing and 541
 * non-Latin-producing compatibility folds one by one, which is a curated list this
 * file would then have to keep against every Unicode revision — the general rule is
 * what is maintainable. Genuinely Greek-script sources still attest, including `Ω`
 * U+2126 OHM SIGN, whose Script IS Greek; that is the conservative direction (it
 * only ever switches the fold OFF) and it is left alone deliberately.
 *
 * The Latin side is deliberately NOT source-read, and the asymmetry is load
 * bearing in two ways. It is the side that ENABLES the pseudo-Latin gate rather
 * than vetoing a rewrite, so it should describe the text the model will actually
 * see; and reading it from the source would break idempotence — `𝐚 саѕа` (math
 * bold `a`, Script=Common) would fold nothing on the first pass and then fold
 * `саѕа` on the second, once NFKC had turned the `𝐚` into a plain `a`.
 */
interface ScriptWitnesses {
  latin: number;
  greek: number;
  nonLatin: number;
}

function countScriptWitnesses(
  original: string,
  atoms: readonly Atom[],
): ScriptWitnesses {
  const witnesses: ScriptWitnesses = { latin: 0, greek: 0, nonLatin: 0 };
  for (const atom of atoms) {
    if (!LETTER.test(atom.char) || CONFUSABLE_TO_LATIN.has(atom.char)) {
      continue;
    }
    if (LATIN_LETTER.test(atom.char)) {
      witnesses.latin += 1;
      continue;
    }
    let attestsNonLatin = false;
    let attestsGreek = false;
    for (const char of original.slice(atom.originalStart, atom.originalEnd)) {
      if (
        CONFUSABLE_TO_LATIN.has(char) ||
        SCRIPT_NEUTRAL.test(char) ||
        LATIN_LETTER.test(char)
      ) {
        continue;
      }
      attestsNonLatin = true;
      if (GREEK_LETTER.test(char)) {
        attestsGreek = true;
      }
    }
    if (!attestsNonLatin) {
      continue;
    }
    witnesses.nonLatin += 1;
    if (attestsGreek) {
      witnesses.greek += 1;
    }
  }
  return witnesses;
}

/**
 * Step 3: fold confusables, word by word. A word is folded when it is
 *
 *   - MIXED SCRIPT: it carries at least one Latin letter AND at least one
 *     Cyrillic or Greek letter (`аbacate` — nobody writes that on purpose); or
 *   - PSEUDO-LATIN: it carries no Latin letter, every one of its letters has a
 *     Latin confusable, and the document carries no non-Latin witness at all
 *     (`саѕа`, the shape a total substitution of `casa` produces).
 *
 * Two GREEK exceptions ride on top, both measured on the corpus, because Greek
 * letters are ordinary pt-BR scientific notation while Cyrillic ones are not:
 *
 *   - a Greek code point is never folded in a document that carries a Greek
 *     witness. `NF-κB` splits into `NF` and `κB`, and `κB` is mixed-script by the
 *     letter of the rule; the `β` two words away is what says the document really
 *     writes Greek (`src_ai_public_madras_7e8a1465ec45`);
 *   - a word that is a LONE Greek letter is never pseudo-Latin. `TNF-α` in
 *     `src_carolina_7bb17c80e5de` is that record's only Greek, so the witness test
 *     alone would still have folded it.
 *
 * The price is named rather than hidden: a Greek code point inside a document that
 * also contains genuine Greek is NOT restored — and note that the two exceptions
 * are applied per CODE POINT, inside a word the rule has already marked as an
 * attack, so `νidа` folds its Cyrillic `а` and keeps its Greek `ν`. Neither is a
 * one-letter Portuguese word disguised with `α`/`ο`/`ι`. Cyrillic disguises are
 * still folded in both cases, including one-letter words, which is what keeps the
 * attacked `a`/`e`/`o` of real prose covered.
 *
 * Both exceptions and the pseudo-Latin gate read `countScriptWitnesses`, which
 * takes its non-Latin evidence from the ORIGINAL characters and not from NFKC's
 * output, and treats every combining mark as neutral. Neither is a detail: read the
 * other way, U+00B5 MICRO SIGN and the table's own `ϲ` both manufactured the witness
 * that switched the fold off, and with the marks left script-bearing a single
 * U+0483 on that same micro sign manufactured it again.
 *
 * Everything else is left exactly as written, which is what keeps `花巻市`,
 * `казаки́` and `Κτησίβιος` intact. The fold is 1:1 per code point, so no offset
 * moves here.
 */
function foldConfusables(original: string, atoms: Atom[]): void {
  const witnesses = countScriptWitnesses(original, atoms);
  const unmixedLatin = witnesses.latin > 0 && witnesses.nonLatin === 0;
  const greekIsContent = witnesses.greek > 0;
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
    let hasGreek = false;
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
        if (GREEK_LETTER.test(char)) {
          hasGreek = true;
        }
      }
      if (!CONFUSABLE_TO_LATIN.has(char)) {
        allLettersConfusable = false;
      }
    }
    const loneGreekSymbol = hasGreek && end - index === 1;
    const mixedScript = hasLatin && hasConfusableScript;
    const pseudoLatin =
      !hasLatin &&
      hasConfusableScript &&
      letters > 0 &&
      allLettersConfusable &&
      unmixedLatin &&
      !loneGreekSymbol;
    if (mixedScript || pseudoLatin) {
      for (let scan = index; scan < end; scan += 1) {
        const char = atoms[scan]!.char;
        if (greekIsContent && GREEK_LETTER.test(char)) {
          continue;
        }
        const replacement = CONFUSABLE_TO_LATIN.get(char);
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
  foldConfusables(text, atoms);
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
      edge === "end"
        ? offset <= segment.normalizedStart
        : offset < segment.normalizedStart;
    const after =
      edge === "end"
        ? offset > segment.normalizedEnd
        : offset >= segment.normalizedEnd;
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
  const segment =
    normalized.segments[segmentIndexFor(normalized.segments, offset, edge)]!;
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
  const originalStart = originalOffsetFromNormalized(
    normalized,
    start,
    "start",
  );
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
