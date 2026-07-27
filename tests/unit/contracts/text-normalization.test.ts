// The three acceptance tests A5 owes, plus the risk-class coverage the curated
// homoglyph table has to carry:
//
//   1. the same text in a COVERED homoglyph variant normalizes to the SAME
//      bytes, so every downstream stage receives identical input and the
//      raw-score difference is exactly `HOMOGLYPH_SCORE_TOLERANCE` (declared as
//      0). "Covered" is a property of each SUBSTITUTION, narrower than "the code
//      point is in the table", and the three classes it excludes are pinned here
//      as NON-invariant rather than left to be read out of the constant's name;
//   2. pt-BR accents, cedilla and legitimate punctuation SURVIVE;
//   3. original offsets are RECONSTRUCTED from the map.
//
// Every fixture whose name is a record id is REAL corpus text, an EXACT
// substring of that record in `benchmark/data/corpus-build/records.jsonl` (the
// pre-split corpus; the blind `test` partition is never read), so "does not
// destroy legitimate text" is asserted against text we actually score rather
// than a synthetic string. The substring property is checked out of band, NOT by
// a test in this file: `records.jsonl` is gitignored (`.gitignore:28`), so a test
// that read it would fail on a clean checkout. It was re-checked for all ten
// fixtures in A5's conformance round, which is when `CITOCINAS` was found to have
// prepended an `Os ` the record does not contain and was corrected.
// Two of them are load-bearing: `ANDORRA` carries U+00BA/U+00B2 and `DEMETER`
// carries U+2026 — the three characters NFKC would silently rewrite.
// The Wikipedia excerpts are CC BY-SA.

import { describe, expect, it } from "vitest";

import {
  CONFUSABLE_TO_LATIN,
  HOMOGLYPH_SCORE_TOLERANCE,
  NFKC_PROTECTED_CHARACTERS,
  REMOVED_INVISIBLE_CHARACTERS,
  normalizeForInference,
  originalOffsetFromNormalized,
  originalSliceFromNormalized,
  originalSpanFromNormalized,
} from "../../../contracts/text-normalization";

const ZWSP = "\u200B";
const SOFT_HYPHEN = "\u00AD";
const ZWJ = "\u200D";

// --- real corpus fixtures ----------------------------------------------------

/** `mix_src_wikipedia_pt_d3e3087c4ae9` — the record A2 left to A5. */
const HANAMAKI =
  "Hanamaki (花巻市; -shi) é uma cidade japonesa localizada na província de " +
  "Iwate. Em 2003 a cidade tinha uma população estimada em 72 926 habitantes.";

/** `src_wikipedia_pt_542bc3474bb5` — Chinese toponyms inside pt-BR prose. */
const GUIZHOU =
  "Guizhou ou Kueichau (贵州 ou 貴州 em chinês) é uma província da República " +
  "Popular da China com capital em Guiyang.";

/** `src_ai_public_madras_5a06a06a65c4` — the `当我们` break A2 measured. */
const MADRAS_CJK =
  "Hoje,当我们 compramos uma fruta exótica, estamos participando de uma rede " +
  "global de ciência e tecnologia que desafiou as limitações da geografia e do " +
  "tempo.";

/** `src_wikipedia_pt_8afa92570ee8` — GENUINE Russian/Ukrainian, not an attack. */
const COSSACOS =
  "Os cossacos (russo: казаки́, kazakí; ucraniano: коза́ки, kozáky; polaco: " +
  "Kozacy) são um povo nativo das estepes das regiões do sudeste europeu";

/** `src_wikipedia_pt_5618f83ee32d` — GENUINE Greek, not an attack. */
const CTESIBIO =
  "Ctesíbio ou Ktesíbios, (em grego: Κτησίβιος), foi um matemático e " +
  "engenheiro grego que viveu cerca de 285-222 a.C. em Alexandria.";

/** `src_wikipedia_pt_873ca2935fa4` — travessão (U+2014) in real prose. */
const ANDRADE =
  "Mário Raul de Morais Andrade (São Paulo, 9 de outubro de 1893 — São Paulo, " +
  "25 de fevereiro de 1945) foi um poeta, romancista, musicólogo, historiador " +
  "de arte, crítico e fotógrafo brasileiro.";

/** `src_wikipedia_pt_bd7eb4154e14` — reticências (U+2026) in real prose. */
const DEMETER =
  "Depois de muito tempo, Hades e Deméter fizeram um acordo… Perséfone " +
  "ficaria com a mãe 3/4 do ano e ficaria com Hades 1/4 do ano.";

/**
 * `src_ai_public_madras_7fe4198396df` — Greek letters as SCIENTIFIC NOTATION in
 * pt-BR prose. Measured: the first pseudo-Latin rule folded `TNF-α` to `TNF-a`
 * in this record and three others.
 */
const CITOCINAS =
  "Pesquisadores identificaram níveis elevados de TNF-α, IL-1β e IL-6 no " +
  "líquido cefalorraquidiano";

/**
 * `mix_src_wikipedia_pt_5eff3608eeb8` — a Chechen/Russian name gloss. Measured:
 * the first pseudo-Latin rule folded `Муса` to `Myca` here, because every one of
 * its four letters happens to have a Latin confusable.
 */
const DUDAEV =
  "Džokhar Musaevič Dudaev (em checheno: Дудин Муса кант Жовхар; em russo: " +
  "Джохар Мусаевич Дудаев)";

/** `src_wikipedia_pt_201e401b7ee6` — ordinal indicators and a superscript. */
const ANDORRA =
  "Andorra é a sexta menor nação da Europa, com uma área de 468&nbsp;km² e " +
  "uma população de aproximadamente 77.281 habitantes. Os andorranos são um " +
  "grupo étnico românico de ascendência originalmente catalã. Andorra é o 16º " +
  "menor país do mundo em terra e o 11º menor país em população.";

// --- the homoglyph attack, defined HERE and not imported ---------------------

/**
 * The attack direction: Latin → confusable. It is written out in the test on
 * purpose, so the assertion is never "the implementation agrees with itself".
 */
const ATTACK: Readonly<Record<string, string>> = {
  a: "а", // CYRILLIC SMALL LETTER A
  c: "с", // CYRILLIC SMALL LETTER ES
  e: "е", // CYRILLIC SMALL LETTER IE
  i: "і", // CYRILLIC SMALL LETTER BYELORUSSIAN-UKRAINIAN I
  k: "к", // CYRILLIC SMALL LETTER KA
  o: "о", // CYRILLIC SMALL LETTER O
  p: "р", // CYRILLIC SMALL LETTER ER
  s: "ѕ", // CYRILLIC SMALL LETTER DZE
  u: "υ", // GREEK SMALL LETTER UPSILON
  v: "ν", // GREEK SMALL LETTER NU
  x: "х", // CYRILLIC SMALL LETTER HA
  y: "у", // CYRILLIC SMALL LETTER U
  A: "А",
  B: "В",
  C: "С",
  E: "Е",
  H: "Н",
  I: "І",
  K: "К",
  M: "М",
  N: "Ν", // GREEK CAPITAL LETTER NU
  O: "О",
  P: "Р",
  S: "Ѕ",
  T: "Т",
  X: "Х",
  Y: "У",
};

function homoglyphVariant(text: string): string {
  return [...text].map((char) => ATTACK[char] ?? char).join("");
}

/** Every normalized word span, for the offset-reconstruction assertions. */
function wordSpans(text: string): { start: number; end: number }[] {
  return [...text.matchAll(/[\p{L}\p{M}\p{N}]+/gu)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
}

describe("the curated homoglyph table", () => {
  it("maps one code point to one ASCII Latin code point, per entry", () => {
    expect(CONFUSABLE_TO_LATIN.size).toBeGreaterThan(0);
    for (const [source, target] of CONFUSABLE_TO_LATIN) {
      // One code point in, one out: the mapping can never move an offset, so
      // the whole table is offset-neutral by construction.
      expect([...source], JSON.stringify(source)).toHaveLength(1);
      expect([...target], JSON.stringify(source)).toHaveLength(1);
      expect(target).toMatch(/^[A-Za-z]$/u);
      // A source that is already Latin would be a self-map, i.e. a table bug.
      expect(source, JSON.stringify(source)).not.toMatch(/^\p{Script=Latin}$/u);
    }
  });

  it("covers the Cyrillic risk class inside a Latin word", () => {
    // "аbacate": CYRILLIC SMALL LETTER A + Latin "bacate" — mixed script.
    expect(normalizeForInference("Comi um аbacate hoje").text).toBe(
      "Comi um abacate hoje",
    );
  });

  it("covers the Greek risk class inside a Latin word", () => {
    // "νida": GREEK SMALL LETTER NU + Latin "ida".
    expect(normalizeForInference("uma νida longa").text).toBe("uma vida longa");
  });

  it("covers full-width Latin, which NFKC folds rather than the table", () => {
    expect(normalizeForInference("ａｂｃ ＡＢ").text).toBe("abc AB");
  });

  it("covers mathematical and styled digits, which NFKC folds", () => {
    // DOUBLE-STRUCK DIGIT ONE, DOUBLE-STRUCK DIGIT TWO, FULLWIDTH DIGIT THREE.
    expect(normalizeForInference("\u{1D7D9}\u{1D7DA}３").text).toBe("123");
  });

  it("folds every exotic separator to U+0020 or U+000A", () => {
    // NO-BREAK SPACE, EM SPACE, NARROW NO-BREAK SPACE, MEDIUM MATHEMATICAL
    // SPACE, IDEOGRAPHIC SPACE, LINE SEPARATOR, PARAGRAPH SEPARATOR, OGHAM
    // SPACE MARK — the last one is Zs that NFKC does NOT fold on its own.
    const exotic =
      "a\u00A0b\u2003c\u202Fd\u205Fe\u3000f\u2028g\u2029h\u1680i j";
    expect(normalizeForInference(exotic).text).toBe("a b c d e f\ng\nh i j");
  });

  it("removes every invisible character in the declared table", () => {
    for (const invisible of REMOVED_INVISIBLE_CHARACTERS) {
      const { text } = normalizeForInference(`pa${invisible}lavra`);
      expect(text, JSON.stringify(invisible)).toBe("palavra");
    }
  });

  it("keeps the zero-width joiner that composes an emoji sequence", () => {
    const family = `\u{1F468}${ZWJ}\u{1F469}${ZWJ}\u{1F467}`;
    // The real gendered sequence puts a VARIATION SELECTOR-16 immediately before
    // the joiner, so the joiner's left neighbour is the selector and not the
    // pictograph. Two development/calibration records carry exactly this shape.
    const facepalm = `\u{1F926}️${ZWJ}♀️`;
    const skinToned = `\u{1F937}\u{1F3FB}${ZWJ}♂️`;
    for (const emoji of [family, facepalm, skinToned]) {
      const { text, changed } = normalizeForInference(`reação ${emoji} aqui`);
      expect(text, JSON.stringify(emoji)).toBe(`reação ${emoji} aqui`);
      expect(changed, JSON.stringify(emoji)).toBe(false);
    }
  });

  it("removes a zero-width joiner that is only padding a word", () => {
    expect(normalizeForInference(`pa${ZWJ}lavra`).text).toBe("palavra");
  });
});

describe("legitimate Portuguese survives normalization", () => {
  it("leaves accents, cedilla and the æ ligature untouched", () => {
    const ptbr = "coração à noite: ãõáâàéêíóôúüñÑ cælum çedilha";
    const { text, changed } = normalizeForInference(ptbr);
    expect(text).toBe(ptbr);
    expect(changed).toBe(false);
  });

  it("leaves travessão, curly quotes and guillemets untouched", () => {
    const punctuation = "um — dois “três” ‘quatro’ " + "«cinco» – seis";
    expect(normalizeForInference(punctuation).text).toBe(punctuation);
  });

  it("protects the characters NFKC would destroy in pt-BR", () => {
    for (const kept of NFKC_PROTECTED_CHARACTERS) {
      // Each protected character is one NFKC WOULD have rewritten; that is the
      // whole reason it is on the list.
      expect(kept.normalize("NFKC"), JSON.stringify(kept)).not.toBe(kept);
      expect(
        normalizeForInference(`x${kept}y`).text,
        JSON.stringify(kept),
      ).toBe(`x${kept}y`);
    }
  });

  it("keeps superscripts and subscripts off the baseline", () => {
    // NFKC flattens them, which changes meaning rather than encoding. Measured
    // on the corpus: `₂` alone is 28 rewrites across development + calibration.
    for (const [text, marker] of [
      ["a área é 468 km² por ali", "²"],
      ["a molécula H₂O é polar", "₂"],
      ["a ordem é 10⁻⁶ metros", "⁻⁶"],
      ["o volume em m³ do tanque", "³"],
    ] as const) {
      expect(marker.normalize("NFKC")).not.toBe(marker);
      expect(normalizeForInference(text).text, marker).toBe(text);
    }
  });

  it("protects the two raised LETTERS that sit inside the guarded range", () => {
    // U+2071 and U+207F are letters, not digits or operators, and they are inside
    // U+2070-U+209C, so they are protected like the rest of the range. Pinned
    // because the docstring used to gloss the range as "digits and operators".
    expect("ⁱ".codePointAt(0)).toBe(0x2071); // SUPERSCRIPT LATIN SMALL LETTER I
    expect("ⁿ".codePointAt(0)).toBe(0x207f); // SUPERSCRIPT LATIN SMALL LETTER N
    for (const raised of ["ⁱ", "ⁿ"]) {
      expect(raised.normalize("NFKC"), raised).not.toBe(raised);
      expect(normalizeForInference(`x ${raised} y`).text, raised).toBe(
        `x ${raised} y`,
      );
    }
  });

  it("guards a range that SPANS the assigned block rather than one that equals it", () => {
    // U+2070-U+209C is the tightest range containing every ASSIGNED code point of
    // SUPERSCRIPTS-AND-SUBSCRIPTS (U+2070-U+209F) — it is not "the assigned part" of
    // the block, which is not an interval: six code points of the block carry no
    // general category and THREE of those sit inside the guarded range. Pinned
    // because the docstring said "the assigned part" and "the last three code
    // points", and both were false in the same direction.
    const unassigned: number[] = [];
    for (let cp = 0x2070; cp <= 0x209f; cp += 1) {
      if (/\p{Cn}/u.test(String.fromCodePoint(cp))) {
        unassigned.push(cp);
      }
    }
    expect(unassigned).toEqual([
      0x2072, 0x2073, 0x208f, 0x209d, 0x209e, 0x209f,
    ]);
    expect(unassigned.filter((cp) => cp <= 0x209c)).toEqual([
      0x2072, 0x2073, 0x208f,
    ]);
    // The guard therefore covers unassigned code points too, which is harmless and
    // is the point of using a block-shaped range instead of a hand-picked list.
    for (const cp of [0x2072, 0x208f]) {
      const ch = String.fromCodePoint(cp);
      expect(normalizeForInference(`x${ch} y`).text, ch).toBe(`x${ch} y`);
    }
  });

  it("names its residual as a property: every raised letter outside the guarded range still flattens", () => {
    // The guard is the three Latin-1 legacy characters plus U+2070-U+209C, and
    // NOT every raised character in Unicode. The residual is a PROPERTY, not the
    // enumeration of the ranges this file happened to look at, so it is asserted
    // over two DIFFERENT blocks: the Phonetic Extensions modifier letters and the
    // Spacing Modifier Letters. Named by code point, so no fixture can drift.
    expect("ᵉ".codePointAt(0)).toBe(0x1d49); // MODIFIER LETTER SMALL E
    expect("ᶰ".codePointAt(0)).toBe(0x1db0); // MODIFIER LETTER SMALL CAPITAL N
    expect("ʰ".codePointAt(0)).toBe(0x02b0); // MODIFIER LETTER SMALL H
    expect("ʷ".codePointAt(0)).toBe(0x02b7); // MODIFIER LETTER SMALL W
    // Phonetic Extensions — the two this corpus actually contains, one rewrite
    // each across development + calibration
    // (`benchmark/out/rebuild-v3/a5/normalization-rewrites.txt`).
    expect(normalizeForInference("a 30ᵉ volta").text).toBe("a 30e volta");
    expect(normalizeForInference("o xᶰ fica").text).toBe("o xɴ fica");
    // Spacing Modifier Letters — a different block, flattening the same way, so
    // the residual cannot be read back as "the three ranges named in the comment".
    expect(normalizeForInference("o xʰ fica").text).toBe("o xh fica");
    expect(normalizeForInference("o xʷ fica").text).toBe("o xw fica");
    // Pinned as a residual, not as a promise: it is here so the docstring can
    // never again say the guard protects "the whole family" of raised letters.
  });

  it("refuses any NFKC fold that would invent whitespace", () => {
    // Every spacing diacritic decomposes to U+0020 plus a combining mark, and an
    // invented space is an invented word boundary. Measured on the corpus: `´`
    // alone accounts for 9 rewrites across development + calibration.
    for (const diacritic of [
      "´",
      "¨",
      "¯",
      "¸",
      "˘",
      "˙",
      "˚",
      "˛",
      "˜",
      "˝",
    ]) {
      expect(diacritic.normalize("NFKC"), diacritic).toMatch(/^\s/u);
      expect(normalizeForInference(`ha${diacritic}bil`).text, diacritic).toBe(
        `ha${diacritic}bil`,
      );
    }
    // An exotic SPACE still folds: its source already was whitespace, so the
    // guard does not fire and no boundary is invented.
    expect(normalizeForInference("ha bil").text).toBe("ha bil");
  });

  it("leaves real corpus pt-BR prose byte-identical", () => {
    for (const [name, fixture] of Object.entries({
      ANDRADE,
      DEMETER,
      ANDORRA,
      CTESIBIO,
      COSSACOS,
      CITOCINAS,
      DUDAEV,
      HANAMAKI,
      GUIZHOU,
      MADRAS_CJK,
    })) {
      const { text, changed } = normalizeForInference(fixture);
      expect(text, name).toBe(fixture);
      expect(changed, name).toBe(false);
    }
  });

  it("does not Latinize genuine Cyrillic or Greek words", () => {
    // казаки́ and Κτησίβιος each carry letters with NO Latin confusable, so
    // neither word is a pseudo-Latin rendering and both stay as written.
    expect(normalizeForInference("russo: казаки́, kazakí").text).toBe(
      "russo: казаки́, kazakí",
    );
    expect(normalizeForInference("grego: Κτησίβιος").text).toBe(
      "grego: Κτησίβιος",
    );
  });

  it("does not Latinize an all-confusable word in text that carries any foreign witness", () => {
    // "рок" is entirely confusable, but `ж`, `д`, `и`, `н` prove the document
    // really contains Cyrillic: it is Russian, not a pt-BR post under attack.
    const russian = "Журнал about рок и джаз выходил в Москве больше двадцати";
    expect(normalizeForInference(russian).text).toBe(russian);
    // The corpus cases the majority rule got wrong. `Муса` is all-confusable and
    // `TNF-α` is a lone confusable letter; both survive.
    expect(normalizeForInference(DUDAEV).text).toBe(DUDAEV);
    expect(normalizeForInference(CITOCINAS).text).toBe(CITOCINAS);
  });

  it("keeps a Greek letter beside Latin capitals when the document writes Greek", () => {
    // `NF-κB` splits into `NF` and `κB`; `κB` is mixed-script by the letter of
    // the rule, and only the `β` two words away says the document really writes
    // Greek. Measured on `src_ai_public_madras_7e8a1465ec45`.
    const citocinas =
      "as citocinas ativam vias de sinalização (como NF-κB) e IL-1β que promovem";
    expect(normalizeForInference(citocinas).text).toBe(citocinas);
    // With no Greek witness anywhere, a mixed-script Greek word IS still folded:
    // that is the attack case, and it must not be lost to the exception above.
    expect(normalizeForInference("uma νida longa").text).toBe("uma vida longa");
  });

  it("does not let NFKC MANUFACTURE the witness that switches the fold off", () => {
    // U+00B5 MICRO SIGN is the SI prefix of `µm`/`µg`/`µl` — ordinary pt-BR
    // encyclopedic and scientific prose — and Unicode calls it Script=Common, i.e.
    // evidence of no script at all. NFKC folds it to U+03BC GREEK SMALL LETTER MU.
    // Counted off the FOLDED atom it was both a `nonLatin` and a `greek` witness,
    // so `unmixedLatin` went false and `greekIsContent` went true for the whole
    // document and the confusable fold silently turned itself off. Measured on
    // `src_carolina_23f8e515f0eb` (one development record, four occurrences), and
    // typing a micro sign was a one-character way to disable the defense.
    expect(/\p{Script=Greek}/u.test("µ")).toBe(false);
    expect(/\p{Script=Common}/u.test("µ")).toBe(true);
    expect("µ".normalize("NFKC")).toBe("μ");
    expect("µ".codePointAt(0)).toBe(0x00b5);
    expect("μ".codePointAt(0)).toBe(0x03bc);
    const clean = "a medida de 5 µm e uma casa fica ali";
    const attacked = clean.replace("casa", homoglyphVariant("casa"));
    // The micro sign itself still folds — that is NFKC doing its job — but it no
    // longer vetoes the fold, so the attacked word is restored.
    expect(normalizeForInference(clean).text).toBe(
      "a medida de 5 μm e uma casa fica ali",
    );
    expect(normalizeForInference(attacked).text).toBe(
      normalizeForInference(clean).text,
    );
    // And a Greek-disguised word in the same document folds too, because a micro
    // sign is not the document "really writing Greek".
    expect(
      normalizeForInference("uma dose de 5 µg e uma νida longa").text,
    ).toBe("uma dose de 5 μg e uma vida longa");
  });

  it("does not let an attacker's own confusable become the Greek witness", () => {
    // `ϲ` U+03F2 is a table KEY that NFKC folds to `ς`, which is not one. Counted
    // off the folded atom, the attacker's own substitution became a genuine Greek
    // witness and switched `greekIsContent` on document-wide, so the `νida` in the
    // SAME text stopped folding. Now the witness is read from the source, where
    // `ϲ` is a known confusable and therefore a suspect rather than a witness.
    expect(CONFUSABLE_TO_LATIN.has("ϲ")).toBe(true);
    expect("ϲ".normalize("NFKC")).toBe("ς");
    expect(CONFUSABLE_TO_LATIN.has("ς")).toBe(false);
    expect(normalizeForInference("uma ϲasa e uma νida").text).toBe(
      "uma ςasa e uma vida",
    );
  });

  it("does not let one combining mark re-manufacture the witness on the micro sign", () => {
    // The cluster is the unit of step 1, and a CHANGED cluster charges every atom
    // it produces to its whole source range — so the source slice the witness rule
    // reads contains the base AND its combining marks. That made the closed
    // micro-sign path reopen with one extra character: a mark whose Script is a
    // specific script (rather than Inherited) attested that script for the whole
    // document. Measured before the fix: `5 µ҃m e uma саѕа` kept its `саѕа`.
    //
    // The old neutral set matched only Inherited marks, which split the class for
    // no reason the question can see: U+064B and U+0951 already attested nothing
    // while U+0483 and U+05B0 attested. `\p{M}` is now neutral as a whole, which is
    // sound because a mark rides on a base of its own script and the BASE attests
    // on its own — asserted below, not assumed.
    expect(/\p{M}/u.test("҃")).toBe(true);
    expect(/\p{Script=Cyrillic}/u.test("҃")).toBe(true); // COMBINING CYRILLIC TITLO
    expect(/\p{Script=Hebrew}/u.test("ְ")).toBe(true); // HEBREW POINT SHEVA
    expect(/\p{Script=Inherited}/u.test("̀")).toBe(true); // COMBINING GRAVE
    const clean = "a medida de 5 µm e uma casa fica ali";
    for (const mark of ["҃", "ְ", "ั", "ா"]) {
      const marked = clean.replace("µ", `µ${mark}`);
      const attacked = marked.replace("casa", homoglyphVariant("casa"));
      // The mark itself SURVIVES — this closes a witness path, it does not delete
      // anything the author wrote.
      expect(normalizeForInference(marked).text, mark).toBe(
        `a medida de 5 μ${mark}m e uma casa fica ali`,
      );
      expect(normalizeForInference(attacked).text, mark).toBe(
        normalizeForInference(marked).text,
      );
    }
    // And the BASE still attests: a Cyrillic titlo over a Cyrillic base changes
    // nothing, because `ж`/`д`/`и`/`н` are witnesses on their own.
    const russian = "Журнал about ро҃к и джаз выходил в Москве больше";
    expect(normalizeForInference(russian).text).toBe(russian);
  });

  it("still takes a Han witness from a source Unicode assigns to Han", () => {
    // The counterpart of the two tests above: the fix must not throw away real
    // evidence. `⼀` U+2F00 KANGXI RADICAL ONE is Script=Han but category So, not a
    // letter, and NFKC folds it to the letter `一`, so requiring letterhood of the
    // SOURCE would have lost the witness and folded the Cyrillic word below.
    expect(/\p{Script=Han}/u.test("⼀")).toBe(true);
    expect(/\p{L}/u.test("⼀")).toBe(false);
    expect("⼀".normalize("NFKC")).toBe("一");
    const attackedWord = homoglyphVariant("casa");
    const text = `o radical ⼀ e uma ${attackedWord} amarela`;
    expect(normalizeForInference(text).text).toContain(attackedWord);
    // The price this rule does charge, pinned so it is not discovered later: a
    // Script=Common character that folds to a genuine ideograph attests nothing.
    // Zero occurrences across development + calibration.
    expect(/\p{Script=Common}/u.test("㈠")).toBe(true);
    expect("㈠".normalize("NFKC")).toBe("(一)");
    expect(
      normalizeForInference(
        `o item ㈠ e uma ${attackedWord} amarela`,
      ).text.includes(attackedWord),
    ).toBe(false);
  });

  it("keeps a lone Greek letter used as notation, even with no other witness", () => {
    // `src_carolina_7bb17c80e5de` is the measured case: `TNF-α` is the ONLY Greek
    // in the record, so the zero-witness test alone would still have folded it.
    const carolina = "de PGE2, leucotrieno B4 (LTB4), IL-6 e TNF-α de maneira";
    expect(normalizeForInference(carolina).text).toBe(carolina);
    expect(normalizeForInference("a constante α vale 2 e β vale 3").text).toBe(
      "a constante α vale 2 e β vale 3",
    );
  });
});

describe("homoglyph variants score identically", () => {
  it("declares a tolerance of exactly zero", () => {
    // Not chosen after seeing a result: the contract's promise is that a
    // covered variant normalizes to the SAME bytes, so every downstream stage
    // — tokenizer, windowing, model — receives identical input and the raw
    // score difference is exactly 0, not merely small.
    expect(HOMOGLYPH_SCORE_TOLERANCE).toBe(0);
  });

  it("normalizes a homoglyph variant of real pt-BR prose to the same bytes", () => {
    for (const [name, fixture] of Object.entries({ ANDRADE, ANDORRA })) {
      const attacked = homoglyphVariant(fixture);
      expect(attacked, name).not.toBe(fixture);
      expect(normalizeForInference(attacked).text, name).toBe(
        normalizeForInference(fixture).text,
      );
    }
  });

  it("restores a word the attack rendered entirely in Cyrillic", () => {
    // "casa" -> "саѕа": every letter is confusable, so the word carries no
    // Latin witness at all. It is still restored, because the DOCUMENT's
    // non-confusable letters are Latin.
    const attacked = homoglyphVariant("a casa amarela fica ali");
    expect(attacked).not.toBe("a casa amarela fica ali");
    expect(normalizeForInference(attacked).text).toBe(
      "a casa amarela fica ali",
    );
  });

  // The FOUR classes the tolerance does NOT cover, pinned as NON-invariant. For the
  // first three, table coverage alone is not the precondition: `foldConfusables`
  // also has to rewrite that very code point, and in each of them it deliberately
  // does not. The fourth runs the OTHER way — the fold fires where it should not —
  // and it is here because it is the price charged by the same witness rule the
  // first two spend. These tests exist so the unconditional reading of the
  // tolerance — "covered by CONFUSABLE_TO_LATIN is enough" — cannot come back
  // green. All four were measured on this tree before being written, and all fail
  // if asserted as invariant.

  it("does NOT restore a wholly-confusable word when the document carries a non-Latin witness", () => {
    // Every substituted code point is a table key, and the word still survives
    // as written: `贵`/`州` are non-Latin witnesses, so `unmixedLatin` is false
    // and the pseudo-Latin gate never fires. This is the price of not rewriting
    // genuine Cyrillic prose, and it means the score difference here is NOT
    // bounded by HOMOGLYPH_SCORE_TOLERANCE.
    const attackedWord = homoglyphVariant("casa");
    for (const char of new Set([...attackedWord])) {
      expect(CONFUSABLE_TO_LATIN.has(char), JSON.stringify(char)).toBe(true);
    }
    const clean = `${GUIZHOU} e uma casa amarela`;
    const attacked = clean.replace("casa", attackedWord);
    expect(normalizeForInference(attacked).text).not.toBe(
      normalizeForInference(clean).text,
    );
    expect(normalizeForInference(attacked).text).toContain(attackedWord);
    // Remove the CJK and the SAME attack IS covered, which proves the exclusion
    // is the witness rather than the word or the table.
    const noWitness = "Guizhou ou Kueichau e uma casa amarela";
    expect(
      normalizeForInference(noWitness.replace("casa", attackedWord)).text,
    ).toBe(normalizeForInference(noWitness).text);
  });

  it("does NOT restore a Greek-disguised word when the document writes Greek", () => {
    // `ν` is a table key, `νida` is mixed-script by the letter of the rule, and
    // it still survives: the `β` says the document really writes Greek. Price of
    // not rewriting `TNF-α`; again outside HOMOGLYPH_SCORE_TOLERANCE.
    expect(CONFUSABLE_TO_LATIN.get("ν")).toBe("v");
    const clean = "a constante β vale 3 e uma vida longa";
    const attacked = clean.replace("vida", "νida");
    expect(normalizeForInference(attacked).text).not.toBe(
      normalizeForInference(clean).text,
    );
    expect(normalizeForInference(attacked).text).toContain("νida");
    // Drop the `β` witness and the same attack IS covered.
    const noWitness = "a constante vale 3 e uma vida longa";
    expect(normalizeForInference(noWitness.replace("vida", "νida")).text).toBe(
      normalizeForInference(noWitness).text,
    );
    // "Covered" is per SUBSTITUTION and not per word, and these two clauses are
    // not the same thing: `νidа` (Greek nu + Latin `id` + Cyrillic `а`) is a word
    // `foldConfusables` DOES fold — the `а` is rewritten — and the `ν` in it is
    // still kept. A per-word definition would call this variant covered and
    // promise a score difference of exactly zero for it.
    expect(CONFUSABLE_TO_LATIN.get("а")).toBe("a");
    const mixedDisguise = clean.replace("vida", "νidа");
    expect(normalizeForInference(mixedDisguise).text).toBe(
      "a constante β vale 3 e uma νida longa",
    );
    expect(normalizeForInference(mixedDisguise).text).not.toBe(
      normalizeForInference(clean).text,
    );
  });

  it("does NOT restore a substitution whose table key NFKC folds away first", () => {
    // Step 1 runs before step 3. `ϲ` U+03F2 GREEK LUNATE SIGMA SYMBOL is a table
    // key, but NFKC folds it to `ς`, which is not — so the fold can never reach
    // it and the score difference is not bounded by HOMOGLYPH_SCORE_TOLERANCE.
    // Asserted over the whole table rather than against a copied count, so a new
    // NFKC-unstable entry has to confront this test.
    const unstable = [...CONFUSABLE_TO_LATIN.keys()].filter(
      (key) => key.normalize("NFKC") !== key,
    );
    expect(unstable).toEqual(["ϲ"]);
    const clean = "uma casa amarela";
    const attacked = clean.replace("c", "ϲ");
    expect(normalizeForInference(attacked).text).not.toBe(
      normalizeForInference(clean).text,
    );
    expect(normalizeForInference(attacked).text).toBe("uma ςasa amarela");
    // Every other key IS reachable: the same one-letter attack with the Cyrillic
    // `с` is covered, which is what makes the exclusion about NFKC and not about
    // one-letter substitutions.
    expect(normalizeForInference(clean.replace("c", "с")).text).toBe(clean);
  });

  it("does NOT protect genuine non-Latin text whose only witness is a script-neutral fold", () => {
    // The fourth class, and the one that runs in the harmful direction: here the
    // input is GENUINE text and normalization rewrites it. It is the exact price of
    // reading the witness from the source — a Script=Common character that NFKC
    // folds into a non-Latin letter attests nothing, so a document whose ONLY
    // non-Latin evidence is such a fold loses the protection that keeps a genuine
    // non-Latin word made entirely of table keys intact.
    //
    // U+1D6FD MATHEMATICAL ITALIC SMALL BETA is the centre of the class, not a
    // corner of it: the whole mathematical Greek range U+1D6A8-U+1D7CB behaves this
    // way, and so do `㎛` U+339B and `㈠` U+3220. Measured: 0 differing records
    // across the 5000 `development` + `calibration` texts, which is why the rule
    // was taken; this test is what turns a later corpus carrying mathematical Greek
    // or parenthesized CJK in volume into a red line instead of a silent rewrite.
    const MATH_ITALIC_BETA = "\u{1D6FD}";
    expect(MATH_ITALIC_BETA.codePointAt(0)).toBe(0x1d6fd);
    expect(/\p{Script=Common}/u.test(MATH_ITALIC_BETA)).toBe(true);
    expect(MATH_ITALIC_BETA.normalize("NFKC")).toBe("β");
    // `Муса` is the Chechen name from `mix_src_wikipedia_pt_5eff3608eeb8`; all four
    // of its letters are table keys, which is what makes it destructible.
    for (const char of "Муса") {
      expect(CONFUSABLE_TO_LATIN.has(char), JSON.stringify(char)).toBe(true);
    }
    const manufactured = `a constante ${MATH_ITALIC_BETA} vale 3 e o nome Муса aparece aqui`;
    expect(normalizeForInference(manufactured).text).toBe(
      "a constante β vale 3 e o nome Myca aparece aqui",
    );
    // Swap the fold for a REAL Greek beta — one code point of difference, same
    // rendering — and the same sentence is left exactly as written. That contrast is
    // the mechanism: the loss is the witness rule's, not the table's or the word's.
    const witnessed = "a constante β vale 3 e o nome Муса aparece aqui";
    expect(normalizeForInference(witnessed).text).toBe(witnessed);
  });

  it("survives an attack combined with zero-width padding", () => {
    const attacked =
      `${homoglyphVariant("uma")}${ZWSP} ` +
      `${homoglyphVariant("casa")}${SOFT_HYPHEN} nova`;
    expect(normalizeForInference(attacked).text).toBe("uma casa nova");
  });
});

describe("the normalized → original offset map", () => {
  it("is an identity map when nothing changed", () => {
    const normalized = normalizeForInference(ANDRADE);
    expect(normalized.changed).toBe(false);
    for (let offset = 0; offset <= ANDRADE.length; offset += 1) {
      expect(originalOffsetFromNormalized(normalized, offset)).toBe(offset);
    }
  });

  it("partitions both texts contiguously and maps monotonically", () => {
    const attacked = `${homoglyphVariant("uma")}${ZWSP} casa${SOFT_HYPHEN} com ａｂ e … e ª`;
    const normalized = normalizeForInference(attacked);
    const segments = normalized.segments;

    expect(segments.length).toBeGreaterThan(1);
    expect(segments[0]!.normalizedStart).toBe(0);
    expect(segments[0]!.originalStart).toBe(0);
    expect(segments.at(-1)!.normalizedEnd).toBe(normalized.text.length);
    expect(segments.at(-1)!.originalEnd).toBe(attacked.length);
    for (let index = 1; index < segments.length; index += 1) {
      expect(segments[index]!.normalizedStart).toBe(
        segments[index - 1]!.normalizedEnd,
      );
      expect(segments[index]!.originalStart).toBe(
        segments[index - 1]!.originalEnd,
      );
    }

    let previous = -1;
    for (let offset = 0; offset <= normalized.text.length; offset += 1) {
      const mapped = originalOffsetFromNormalized(normalized, offset);
      expect(mapped).toBeGreaterThanOrEqual(previous);
      previous = mapped;
    }
  });

  it("reconstructs every original word from a normalized word span", () => {
    // One fixture exercising removal (zero width), 1:1 substitution
    // (homoglyph), expansion (ligature → two letters) and protection (…).
    const original = `${homoglyphVariant("Sao")}${ZWSP} Paulo ﬁcou … ª`;
    const normalized = normalizeForInference(original);
    expect(normalized.text).toBe("Sao Paulo ficou … ª");

    const recovered = wordSpans(normalized.text).map((span) =>
      originalSliceFromNormalized(normalized, span.start, span.end),
    );
    expect(recovered).toEqual([homoglyphVariant("Sao"), "Paulo", "ﬁcou", "ª"]);
  });

  it("rounds an expanded span outward so it always contains its source", () => {
    const normalized = normalizeForInference("aﬁb");
    expect(normalized.text).toBe("afib");
    // "f" and "i" both come from the single source character ﬁ, so either one
    // maps back to that whole character rather than to half of it.
    expect(originalSpanFromNormalized(normalized, 1, 2)).toEqual({
      start: 1,
      end: 2,
    });
    expect(originalSpanFromNormalized(normalized, 2, 3)).toEqual({
      start: 1,
      end: 2,
    });
    expect(originalSpanFromNormalized(normalized, 0, 4)).toEqual({
      start: 0,
      end: 3,
    });
  });

  it("keeps offsets reconstructible when the change is only removal", () => {
    const original = `${ZWSP}${ZWSP}palavra${ZWSP}`;
    const normalized = normalizeForInference(original);
    expect(normalized.text).toBe("palavra");
    expect(originalSliceFromNormalized(normalized, 0, 7)).toBe(original);
  });

  it("is idempotent", () => {
    for (const fixture of [ANDRADE, HANAMAKI, COSSACOS, CTESIBIO, ANDORRA]) {
      const once = normalizeForInference(fixture).text;
      expect(normalizeForInference(once).text).toBe(once);
    }
    const once = normalizeForInference(homoglyphVariant(ANDORRA)).text;
    expect(normalizeForInference(once).text).toBe(once);
  });
});

describe("non-Latin scripts survive while confusables are folded", () => {
  // The brief's obligatory case, in ONE fixture built from real corpus text:
  // Japanese kanji (HANAMAKI), Chinese hanzi (GUIZHOU, MADRAS_CJK), genuine
  // Cyrillic NAMES (DUDAEV — `Джохар Мусаевич Дудаев`, and the Chechen gloss
  // `Дудин Муса кант Жовхар`), genuine Cyrillic common nouns (COSSACOS), a
  // genuine Greek name (CTESIBIO), and a Cyrillic homoglyph attack on a
  // Portuguese word. DUDAEV is here and not only in the witness test because the
  // brief asks the obligatory fixture for "um nome russo em cirílico"
  // specifically: `казаки́` is a common noun, and a NAME is the harder case —
  // every one of `Муса`'s four letters has a Latin confusable, so it is exactly
  // the shape the pseudo-Latin rule would destroy.
  const MIXED_SCRIPTS =
    `${HANAMAKI}\n${GUIZHOU}\n${MADRAS_CJK}\n${COSSACOS}\n${CTESIBIO}\n` +
    `${DUDAEV}\nAqui a palavra аbacate foi atacada.`;

  it("keeps the surrounding pt-BR intact", () => {
    const { text } = normalizeForInference(MIXED_SCRIPTS);
    expect(text).toContain("é uma cidade japonesa localizada na província");
    expect(text).toContain("matemático e engenheiro grego");
    expect(text).toContain("povo nativo das estepes");
  });

  it("normalizes the confusable Cyrillic and leaves CJK untouched", () => {
    const { text } = normalizeForInference(MIXED_SCRIPTS);
    expect(text).toContain("palavra abacate foi atacada");
    expect(text).not.toContain("аbacate");
    expect(text).toContain("花巻市");
    expect(text).toContain("贵州 ou 貴州");
    expect(text).toContain("当我们");
    expect(text).toContain("казаки́");
    expect(text).toContain("Κτησίβιος");
    // The Cyrillic NAMES, letter for letter. `Муса` is the one that matters
    // most: М, у, с and а are all in CONFUSABLE_TO_LATIN, so a rule that folded
    // a wholly-confusable word unconditionally would write `Myca` here.
    expect(text).toContain("Дудин Муса кант Жовхар");
    expect(text).toContain("Джохар Мусаевич Дудаев");
  });

  // (b) and (c) of the brief's obligatory case together: the folded homoglyph and
  // the preserved scripts have to BOTH reconstruct, because a map that only
  // survives the untouched runs would not catch a fold that shifted offsets.
  it("reconstructs the original offsets of every non-Latin run and of the fold", () => {
    const normalized = normalizeForInference(MIXED_SCRIPTS);
    for (const run of [
      "花巻市",
      "贵州",
      "貴州",
      "当我们",
      "Муса",
      "Жовхар",
      "Дудаев",
      "Мусаевич",
      "казаки́",
      "Κτησίβιος",
    ]) {
      const start = normalized.text.indexOf(run);
      expect(start, run).toBeGreaterThanOrEqual(0);
      expect(
        originalSliceFromNormalized(normalized, start, start + run.length),
        run,
      ).toBe(run);
    }
    // The folded word reconstructs to its ATTACKED original, not to the
    // normalized spelling — the fold is 1:1, so the span does not even widen.
    const folded = normalized.text.indexOf("abacate");
    expect(folded).toBeGreaterThanOrEqual(0);
    expect(
      originalSliceFromNormalized(
        normalized,
        folded,
        folded + "abacate".length,
      ),
    ).toBe("аbacate");
  });
});
