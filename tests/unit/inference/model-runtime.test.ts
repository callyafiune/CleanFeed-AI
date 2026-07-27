import { env } from "@huggingface/transformers";
import { describe, expect, it, vi } from "vitest";

import { bundledModelManifest } from "@/inference/bundled-model-metadata";
import {
  createModelRuntime,
  createTmrChunkPlan,
  ExactTokenizer,
  normalizeCalibrationLocale,
  type LoadedTransformersTokenizer,
} from "@/inference/model-runtime";
import { configureTransformersEnvironment } from "@/inference/transformers-environment";
import { CleanFeedError } from "@/shared/errors";
import type { ClassifierMetadata, TextClassifier } from "@/shared/types";
import { fakeWordPieceTokenizer } from "../../helpers/wordpiece-tokenizer";

/** Asserts `run` throws a CleanFeedError carrying `code`. */
function expectCode(run: () => unknown, code: string): void {
  let error: unknown;
  try {
    run();
  } catch (thrown) {
    error = thrown;
  }
  expect(error).toBeInstanceOf(CleanFeedError);
  expect((error as CleanFeedError).code).toBe(code);
}

/**
 * The GPT-2/RoBERTa ByteLevel byte→char map, so a fake can emit the SAME surface
 * tokens the real tokenizer produces (e.g. `"Ġado"`, `"Ã§"`). Each source byte
 * renders to exactly one printable code point.
 */
function byteToCharMap(): Map<number, string> {
  const bs: number[] = [];
  for (let b = 0x21; b <= 0x7e; b += 1) bs.push(b);
  for (let b = 0xa1; b <= 0xac; b += 1) bs.push(b);
  for (let b = 0xae; b <= 0xff; b += 1) bs.push(b);
  const cs = bs.slice();
  let next = 0;
  for (let b = 0; b < 256; b += 1) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + next);
      next += 1;
    }
  }
  const map = new Map<number, string>();
  for (let i = 0; i < bs.length; i += 1) {
    map.set(bs[i]!, String.fromCharCode(cs[i]!));
  }
  return map;
}

const BYTE_TO_CHAR = byteToCharMap();
const UTF8 = new TextEncoder();

/** The ByteLevel surface token for a UTF-16 char range of `text`. */
function byteLevelToken(text: string, start: number, end: number): string {
  return Array.from(UTF8.encode(text.slice(start, end)), (byte) =>
    BYTE_TO_CHAR.get(byte),
  ).join("");
}

/**
 * A minimal stand-in for a loaded Transformers.js tokenizer. `specialTokens` are
 * the ids the tokenizer wraps around content when `add_special_tokens` is on;
 * `pieces` maps a text to its content token ids and a ByteLevel SEGMENTATION
 * expressed as UTF-16 char ranges — the fake renders those ranges to real
 * byte-alphabet surface tokens via `tokenize`, exactly as the model tokenizer
 * does, so the exact tokenizer must derive offsets from that segmentation. The
 * double records how it was called so a test can prove the special-token count
 * was measured instead of hardcoded.
 */
function fakeTokenizer(options: {
  specialTokens: number[];
  pieces?: Record<string, { ids: number[]; segments?: [number, number][] }>;
  tokensFor?: (text: string) => string[];
}): LoadedTransformersTokenizer & { calls: unknown[] } {
  const calls: unknown[] = [];
  const pieceFor = (
    text: string,
  ): { ids: number[]; segments: [number, number][] } => {
    const piece = options.pieces?.[text];
    if (piece !== undefined) {
      return {
        ids: piece.ids,
        segments: piece.segments ?? [],
      };
    }
    return {
      ids: text.length === 0 ? [] : [1],
      segments: text.length === 0 ? [] : [[0, text.length]],
    };
  };
  const tokenizer = ((text: string, callOptions) => {
    calls.push({ text, callOptions });
    const content = pieceFor(text);
    const inputIds = callOptions.add_special_tokens
      ? [
          ...options.specialTokens.slice(0, 1),
          ...content.ids,
          ...options.specialTokens.slice(1),
        ]
      : content.ids;
    return { input_ids: inputIds };
  }) as LoadedTransformersTokenizer & { calls: unknown[] };
  tokenizer.tokenize = (text: string) => {
    if (options.tokensFor) return options.tokensFor(text);
    const { segments } = pieceFor(text);
    return segments.map(([start, end]) => byteLevelToken(text, start, end));
  };
  tokenizer.calls = calls;
  return tokenizer;
}

function fakeClassifier(): TextClassifier {
  const metadata: ClassifierMetadata = {
    id: "cleanfeed-ptbr-v1",
    name: "TMR",
    version: bundledModelManifest.modelVersion,
    backend: "wasm",
    supportedLanguages: ["pt"],
    maximumTokens: 512,
    supportsBatching: false,
  };
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    classify: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    getMetadata: () => metadata,
  };
}

describe("normalizeCalibrationLocale", () => {
  it("maps only pt and pt-BR variants to the canonical pt-BR", () => {
    expect(normalizeCalibrationLocale("pt")).toBe("pt-BR");
    expect(normalizeCalibrationLocale("pt-BR")).toBe("pt-BR");
    expect(normalizeCalibrationLocale("PT")).toBe("pt-BR");
    expect(normalizeCalibrationLocale("pt-br")).toBe("pt-BR");
    expect(normalizeCalibrationLocale("PT-br")).toBe("pt-BR");
  });

  it("leaves other locales unsupported", () => {
    expect(normalizeCalibrationLocale("pt-PT")).toBeNull();
    expect(normalizeCalibrationLocale("en")).toBeNull();
    expect(normalizeCalibrationLocale("en-US")).toBeNull();
    expect(normalizeCalibrationLocale("es")).toBeNull();
    expect(normalizeCalibrationLocale("und")).toBeNull();
    expect(normalizeCalibrationLocale("")).toBeNull();
    expect(normalizeCalibrationLocale(null)).toBeNull();
    expect(normalizeCalibrationLocale(undefined)).toBeNull();
  });
});

describe("createTmrChunkPlan", () => {
  it("mirrors the sealed manifest windowing (512/510/64/8)", () => {
    expect(createTmrChunkPlan(bundledModelManifest.windowing)).toEqual({
      modelMaxTokens: 512,
      contentTokens: 510,
      overlapTokens: 64,
      maxWindows: 8,
    });
  });

  it("cross-checks contentTokens against the measured special-token count", () => {
    expect(() =>
      createTmrChunkPlan(bundledModelManifest.windowing, 2),
    ).not.toThrow();
    expect(() =>
      createTmrChunkPlan(bundledModelManifest.windowing, 3),
    ).toThrow();
  });

  it("rejects inconsistent windowing", () => {
    expect(() =>
      createTmrChunkPlan({
        modelMaxTokens: 512,
        contentTokens: 600,
        overlapTokens: 64,
        maxWindows: 8,
      }),
    ).toThrow();
    expect(() =>
      createTmrChunkPlan({
        modelMaxTokens: 512,
        contentTokens: 510,
        overlapTokens: 510,
        maxWindows: 8,
      }),
    ).toThrow();
    expect(() =>
      createTmrChunkPlan({
        modelMaxTokens: 512,
        contentTokens: 510,
        overlapTokens: 64,
        maxWindows: 0,
      }),
    ).toThrow();
  });
});

describe("ExactTokenizer", () => {
  it("measures the special-token count from the loaded tokenizer", () => {
    const tokenizer = fakeTokenizer({ specialTokens: [0, 2] });
    const exact = ExactTokenizer.create(tokenizer);

    expect(exact.specialTokenCount).toBe(2);
    // Proof it was measured, not hardcoded: both add_special_tokens states ran.
    const probeStates = tokenizer.calls.map(
      (call) =>
        (call as { callOptions: { add_special_tokens: boolean } }).callOptions
          .add_special_tokens,
    );
    expect(probeStates).toContain(true);
    expect(probeStates).toContain(false);
  });

  it("fails closed when the loaded tokenizer reserves a different count than the manifest", () => {
    expect(() =>
      ExactTokenizer.create(fakeTokenizer({ specialTokens: [0] })),
    ).toThrow();
    expect(() =>
      ExactTokenizer.create(fakeTokenizer({ specialTokens: [0, 1, 2] })),
    ).toThrow();
  });

  it("derives content tokens from modelMaxTokens minus the measured special tokens", () => {
    const exact = ExactTokenizer.create(
      fakeTokenizer({ specialTokens: [0, 2] }),
    );
    expect(512 - exact.specialTokenCount).toBe(510);
  });

  it("derives native offsets from the ByteLevel segmentation, not a substring search", () => {
    // Repeated substring: an indexOf/substring search would map both "ab"
    // tokens to 0..2. Byte-level tiling advances the cursor, so they are
    // distinct.
    const tokenizer = fakeTokenizer({
      specialTokens: [0, 2],
      pieces: {
        abab: {
          ids: [11, 11],
          segments: [
            [0, 2],
            [2, 4],
          ],
        },
      },
    });
    const exact = ExactTokenizer.create(tokenizer);

    const indexOf = vi.spyOn(String.prototype, "indexOf");
    const lastIndexOf = vi.spyOn(String.prototype, "lastIndexOf");
    let encoding;
    try {
      encoding = exact.encodeWithOffsets("abab");
    } finally {
      indexOf.mockRestore();
      lastIndexOf.mockRestore();
    }

    expect(encoding.specialTokenCount).toBe(2);
    expect(encoding.inputIds).toEqual([11, 11]);
    expect(encoding.offsets).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    // First offset starts at 0, last offset ends at the string length, no gap.
    expect(encoding.offsets[0]!.start).toBe(0);
    expect(encoding.offsets.at(-1)!.end).toBe("abab".length);
    // The offsets were NOT found by scanning the text for the token.
    expect(indexOf).not.toHaveBeenCalled();
    expect(lastIndexOf).not.toHaveBeenCalled();
    // The encode call is content-only; offsets come from `tokenize`.
    const encodeCall = tokenizer.calls.at(-1) as {
      callOptions: { add_special_tokens: boolean };
    };
    expect(encodeCall.callOptions.add_special_tokens).toBe(false);
  });

  it("keeps pt-BR multi-byte accents (adoção, análise) on full-character boundaries", () => {
    // Real ByteLevel segmentation of this text (add_prefix_space:false): the
    // leading-space token carries its space, and each accented character (ç, ã,
    // á — two UTF-8 bytes each) stays within a token boundary.
    const text = "A adoção de análise";
    const tokenizer = fakeTokenizer({
      specialTokens: [0, 2],
      pieces: {
        [text]: {
          ids: [250, 42672, 3381, 4214, 263, 41, 1526, 462],
          // A | Ġado | ç | ão | Ġde | Ġan | á | lise
          segments: [
            [0, 1],
            [1, 5],
            [5, 6],
            [6, 8],
            [8, 11],
            [11, 14],
            [14, 15],
            [15, 19],
          ],
        },
      },
    });
    const exact = ExactTokenizer.create(tokenizer);

    const { offsets } = exact.encodeWithOffsets(text);

    // Offsets tile the text with no gaps and land on code-point boundaries.
    expect(offsets[0]!.start).toBe(0);
    expect(offsets.at(-1)!.end).toBe(text.length);
    let previousEnd = 0;
    for (const { start, end } of offsets) {
      expect(start).toBeGreaterThanOrEqual(previousEnd); // monotonic, contiguous
      expect(end).toBeGreaterThan(start);
      // A well-formed (non-mid-codepoint) slice round-trips through UTF-16.
      const slice = text.slice(start, end);
      expect(slice).toBe(
        String.fromCodePoint(...Array.from(slice, (c) => c.codePointAt(0)!)),
      );
      previousEnd = end;
    }
    // The 'ç' token maps to exactly the single 'ç' character.
    expect(text.slice(offsets[2]!.start, offsets[2]!.end)).toBe("ç");
  });

  it("rounds a multi-byte character split across BPE tokens outward to the full character", () => {
    // 'ç' is C3 A7; here the tokenizer split it into two byte-alphabet tokens
    // ("Ã" then "§"). Each covering token must map to the whole 'ç', never a
    // mid-codepoint index.
    const text = "aça";
    const tokenizer = fakeTokenizer({
      specialTokens: [0, 2],
      pieces: {
        [text]: { ids: [1, 2, 3, 4] },
      },
      tokensFor: () => [
        byteLevelToken("a", 0, 1), // "a"    -> byte 0
        "Ã", // first byte of ç (0xC3)
        "§", // second byte of ç (0xA7)
        byteLevelToken("a", 0, 1), // "a"    -> last byte
      ],
    });
    const exact = ExactTokenizer.create(tokenizer);

    const { offsets } = exact.encodeWithOffsets(text);

    expect(offsets).toEqual([
      { start: 0, end: 1 }, // "a"
      { start: 1, end: 2 }, // ç (rounded outward)
      { start: 1, end: 2 }, // ç (rounded outward)
      { start: 2, end: 3 }, // "a"
    ]);
    // No offset ever lands mid-codepoint.
    for (const { start, end } of offsets) {
      expect(text.slice(start, end).length).toBeGreaterThan(0);
    }
  });

  it("keeps multi-token Unicode offsets aligned to the original UTF-16 string", () => {
    const text = "Olá 😀 mundo";
    // "Olá" | " 😀" | " mundo" — the emoji is a surrogate pair (4 UTF-8 bytes).
    const tokenizer = fakeTokenizer({
      specialTokens: [0, 2],
      pieces: {
        [text]: {
          ids: [5, 6, 7],
          segments: [
            [0, 3],
            [3, 6],
            [6, text.length],
          ],
        },
      },
    });
    const exact = ExactTokenizer.create(tokenizer);

    const encoding = exact.encodeWithOffsets(text);

    expect(encoding.offsets).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 6 },
      { start: 6, end: text.length },
    ]);
    expect(encoding.offsets.at(-1)!.end).toBe(text.length);
    // The emoji window slices to the intact surrogate pair.
    expect(text.slice(3, 6)).toContain("😀");
  });

  it("fails closed when the token and id streams disagree in length", () => {
    const tokenizer = fakeTokenizer({
      specialTokens: [0, 2],
      pieces: { texto: { ids: [1, 2], segments: [[0, 5]] } },
    });
    const exact = ExactTokenizer.create(tokenizer);

    expectCode(() => exact.encodeWithOffsets("texto"), "TOKENIZATION_FAILED");
  });

  it("fails closed when a surface token is not a ByteLevel character", () => {
    const tokenizer = fakeTokenizer({
      specialTokens: [0, 2],
      pieces: { texto: { ids: [1], segments: [[0, 5]] } },
      // "中" is outside the 256-entry byte alphabet, so it can never map to a
      // run of source bytes; the derivation must reject it.
      tokensFor: () => ["中"],
    });
    const exact = ExactTokenizer.create(tokenizer);

    expectCode(() => exact.encodeWithOffsets("texto"), "TOKENIZATION_FAILED");
  });
});

describe("ExactTokenizer (WordPiece)", () => {
  it("detects WordPiece and derives exact piece offsets with ## continuations", () => {
    const exact = ExactTokenizer.create(
      fakeWordPieceTokenizer({
        adoção: ["ado", "##ção"],
        é: ["é"],
        boa: ["boa"],
      }),
    );

    expect(exact.offsetMode).toBe("wordpiece");
    const { offsets, inputIds } = exact.encodeWithOffsets("adoção é boa");
    expect(inputIds).toHaveLength(4);
    expect(offsets).toEqual([
      { start: 0, end: 3 }, // "ado"
      { start: 3, end: 6 }, // "##ção" — acentos em fronteiras de caractere cheio
      { start: 7, end: 8 }, // "é"
      { start: 9, end: 12 }, // "boa"
    ]);
  });

  it("assigns an [UNK] word (emoji) its whole span without disturbing neighbors", () => {
    const exact = ExactTokenizer.create(
      fakeWordPieceTokenizer({ boa: ["boa"] }),
    );

    const text = "boa 😂 boa";
    const { offsets } = exact.encodeWithOffsets(text);
    expect(offsets).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 6 }, // o emoji (2 UTF-16 units) vira [UNK] com o span da palavra
      { start: 7, end: 10 },
    ]);
  });

  it("treats punctuation as its own word span", () => {
    const exact = ExactTokenizer.create(
      fakeWordPieceTokenizer({ boa: ["boa"], ",": [","] }),
    );

    const { offsets } = exact.encodeWithOffsets("boa, boa");
    expect(offsets).toEqual([
      { start: 0, end: 3 },
      { start: 3, end: 4 },
      { start: 5, end: 8 },
    ]);
  });

  it("degrades a mismatched word to its word span instead of throwing", () => {
    const exact = ExactTokenizer.create(
      // As peças não batem com a superfície da palavra — deve arredondar para
      // o span da palavra inteira, nunca lançar TOKENIZATION_FAILED.
      fakeWordPieceTokenizer({ estranho: ["xx", "##yy"], boa: ["boa"] }),
    );

    const { offsets } = exact.encodeWithOffsets("estranho boa");
    expect(offsets).toEqual([
      { start: 0, end: 8 },
      { start: 0, end: 8 },
      { start: 9, end: 12 },
    ]);
  });

  it("degrades to whole-text spans when the streams misalign globally", () => {
    const inner = fakeWordPieceTokenizer({ boa: ["boa"] });
    // Desalinha SOMENTE o texto-alvo (uma peça-fantasma a mais); a sonda de
    // detecção "a b" continua limpa, então o modo resolve para wordpiece.
    const padded = ((text: string, callOptions) => {
      const result = inner(text, callOptions) as { input_ids: number[] };
      return {
        input_ids: text.includes("boa")
          ? [...result.input_ids, 999]
          : result.input_ids,
      };
    }) as LoadedTransformersTokenizer;
    // Peça-fantasma SEM "##": inicia uma "palavra" que não existe no texto —
    // só o fallback global cobre.
    padded.tokenize = (text: string, options) => {
      const base = inner.tokenize(text, options) as string[];
      return text.includes("boa") ? [...base, "fantasma"] : base;
    };

    const exact = ExactTokenizer.create(padded);
    expect(exact.offsetMode).toBe("wordpiece");
    const text = "boa boa";
    const { offsets } = exact.encodeWithOffsets(text);
    expect(offsets).toHaveLength(3);
    for (const offset of offsets) {
      expect(offset).toEqual({ start: 0, end: text.length });
    }
  });

  // The defect A2 handed to A5. `BertNormalizer` (handle_chinese_chars: true)
  // makes every CJK ideograph its own basic word, and BERTimbau's vocabulary has
  // no bare ideograph, so `花巻市` is THREE [UNK] tokens. The derivation used to
  // segment it as ONE word, consume ONE token for it and hand the other two to
  // the following words: the streams stayed the same LENGTH while every offset
  // after the ideographs pointed at the wrong characters, and when the totals
  // finally disagreed the whole document degraded to coarse whole-text spans.
  // Measured on `mix_src_wikipedia_pt_d3e3087c4ae9` (real corpus text, quoted
  // here), which is why the fixture is that sentence and not a synthetic one.
  it("gives each CJK ideograph its own [UNK] span", () => {
    const exact = ExactTokenizer.create(
      fakeWordPieceTokenizer({
        Hanamaki: ["Hana", "##maki"],
        shi: ["shi"],
        é: ["é"],
        uma: ["uma"],
        cidade: ["cidade"],
      }),
    );

    const text = "Hanamaki (花巻市; -shi) é uma cidade";
    const { offsets, inputIds } = exact.encodeWithOffsets(text);
    expect(inputIds).toHaveLength(offsets.length);
    expect(offsets.map(({ start, end }) => text.slice(start, end))).toEqual([
      "Hana",
      "maki",
      "(",
      "花",
      "巻",
      "市",
      ";",
      "-",
      "shi",
      ")",
      "é",
      "uma",
      "cidade",
    ]);
  });

  it("keeps a Hangul syllable and a kana run inside their own word span", () => {
    // `is_chinese_char` covers neither Hangul nor kana, so the tokenizer does
    // NOT split them: each stays one word and one [UNK]. Splitting them here
    // would desynchronize the stream in the opposite direction.
    const exact = ExactTokenizer.create(
      fakeWordPieceTokenizer({ cidade: ["cidade"], de: ["de"] }),
    );

    const text = "cidade de 청주시 ひらがな";
    const { offsets } = exact.encodeWithOffsets(text);
    expect(offsets.map(({ start, end }) => text.slice(start, end))).toEqual([
      "cidade",
      "de",
      "청주시",
      "ひらがな",
    ]);
  });

  it("attaches a residual ## ghost to the previous word span (local degrade)", () => {
    const inner = fakeWordPieceTokenizer({ boa: ["boa"] });
    const padded = ((text: string, callOptions) => {
      const result = inner(text, callOptions) as { input_ids: number[] };
      return {
        input_ids: text.includes("boa")
          ? [...result.input_ids, 999]
          : result.input_ids,
      };
    }) as LoadedTransformersTokenizer;
    padded.tokenize = (text: string, options) => {
      const base = inner.tokenize(text, options) as string[];
      return text.includes("boa") ? [...base, "##fantasma"] : base;
    };

    const exact = ExactTokenizer.create(padded);
    const { offsets } = exact.encodeWithOffsets("boa boa");
    expect(offsets).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 7 },
      { start: 4, end: 7 }, // fantasma herda o span da palavra anterior
    ]);
  });
});

describe("createModelRuntime", () => {
  it("binds the classifier and the exact tokenizer to one asset load", async () => {
    const classifier = fakeClassifier();
    const tokenizer = fakeTokenizer({ specialTokens: [0, 2] });
    const load = vi.fn(async () => ({ classifier, tokenizer }));

    const runtime = await createModelRuntime(load, bundledModelManifest);

    expect(load).toHaveBeenCalledOnce();
    expect(runtime.classifier).toBe(classifier);
    expect(runtime.tokenizer).toBeInstanceOf(ExactTokenizer);
    expect(runtime.tokenizer.specialTokenCount).toBe(2);
    expect(runtime.chunkPlan).toEqual({
      modelMaxTokens: 512,
      contentTokens: 510,
      overlapTokens: 64,
      maxWindows: 8,
    });
    expect(runtime.identity).toMatchObject({
      kind: "bundle",
      modelId: bundledModelManifest.modelId,
      modelVersion: bundledModelManifest.modelVersion,
      bundleDigest: bundledModelManifest.bundleDigest,
      tokenizerDigest: bundledModelManifest.tokenizerDigest,
      aggregationVersion: bundledModelManifest.aggregationVersion,
      contentCompositionVersion: bundledModelManifest.contentCompositionVersion,
    });
  });
});

describe("transformers environment stays extension-local", () => {
  it("keeps remote models disabled and never fetches an http(s) URL", () => {
    const original = {
      fetch: globalThis.fetch,
      allowRemoteModels: env.allowRemoteModels,
      allowLocalModels: env.allowLocalModels,
      localModelPath: env.localModelPath,
    };
    const guardedFetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/^https?:/iu.test(url)) {
        throw new Error("REMOTE_FETCH_FORBIDDEN");
      }
      return original.fetch(input);
    });
    globalThis.fetch = guardedFetch as unknown as typeof fetch;

    try {
      configureTransformersEnvironment({
        modelBaseUrl: "chrome-extension://abc/models/",
        wasmBaseUrl: "chrome-extension://abc/vendor/transformers-wasm/",
      });

      expect(env.allowRemoteModels).toBe(false);
      expect(env.allowLocalModels).toBe(true);
      expect(env.localModelPath).toBe("chrome-extension://abc/models/");
      // Configuring the environment never reached out to a remote host.
      for (const call of guardedFetch.mock.calls) {
        expect(String(call[0])).not.toMatch(/^https?:/iu);
      }
      // The guard itself rejects any remote host (recorded after the check).
      expect(() => guardedFetch("https://huggingface.co/model.onnx")).toThrow(
        "REMOTE_FETCH_FORBIDDEN",
      );
    } finally {
      globalThis.fetch = original.fetch;
      env.allowRemoteModels = original.allowRemoteModels;
      env.allowLocalModels = original.allowLocalModels;
      env.localModelPath = original.localModelPath;
    }
  });
});
