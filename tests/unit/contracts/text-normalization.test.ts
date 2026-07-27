// The three acceptance tests A5 owes, plus the risk-class coverage the curated
// homoglyph table has to carry:
//
//   1. the same text in a homoglyph variant normalizes to the SAME bytes, so
//      every downstream stage receives identical input and the raw-score
//      difference is exactly `HOMOGLYPH_SCORE_TOLERANCE` (declared as 0);
//   2. pt-BR accents, cedilla and legitimate punctuation SURVIVE;
//   3. original offsets are RECONSTRUCTED from the map.
//
// Every fixture whose name is a record id is REAL corpus text, copied verbatim
// from `benchmark/data/corpus-build/records.jsonl` (the pre-split corpus; the
// blind `test` partition is never read), so "does not destroy legitimate text"
// is asserted against text we actually score rather than a synthetic string.
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
  "Os pesquisadores identificaram níveis elevados de TNF-α, IL-1β e IL-6 no " +
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
  // Japanese kanji, Chinese hanzi, a genuine Cyrillic name, a genuine Greek
  // name, and a Cyrillic homoglyph attack on a Portuguese word.
  const MIXED_SCRIPTS =
    `${HANAMAKI}\n${GUIZHOU}\n${MADRAS_CJK}\n${COSSACOS}\n${CTESIBIO}\n` +
    `Aqui a palavra аbacate foi atacada.`;

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
  });

  it("reconstructs the original offsets of every CJK run", () => {
    const normalized = normalizeForInference(MIXED_SCRIPTS);
    for (const cjk of ["花巻市", "贵州", "貴州", "当我们"]) {
      const start = normalized.text.indexOf(cjk);
      expect(start, cjk).toBeGreaterThanOrEqual(0);
      expect(
        originalSliceFromNormalized(normalized, start, start + cjk.length),
        cjk,
      ).toBe(cjk);
    }
  });
});
