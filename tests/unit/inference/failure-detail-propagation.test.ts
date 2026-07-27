import { describe, expect, it, vi } from "vitest";

import { aggregateWindowsV2, type WindowScore } from "@/inference/aggregator";
import { fitWindowSlice, selectDistributedWindows } from "@/inference/chunker";
import type { CleanFeedModelManifest } from "@/inference/model-bundle";
import {
  ExactTokenizer,
  type LoadedTransformersTokenizer,
} from "@/inference/model-runtime";
import {
  OnnxTextClassifier,
  type ModelTokens,
  type TransformersModelGateway,
} from "@/inference/onnx-classifier";
import { CleanFeedError } from "@/shared/errors";

import {
  sanitizeFailureDetail,
  isSanitizedFailureDetail,
  UNCLASSIFIED_FAILURE_DETAIL_CODE,
} from "../../../contracts/failure-detail.ts";
import validManifest from "../../fixtures/models/valid/cleanfeed-model.json";

// Every origin that used to collapse into one opaque code, driven through its
// REAL throw site: the four aggregator branches, the ONNX classifier wrapper and
// the six tokenizer offset-derivation guards. Each must reach the prediction row
// as a DISTINCT, non-empty, sanitized detail — otherwise no correction can be
// more than a guess. Asserting the message from the throw site (rather than
// copying the literal into the allowlist test) is what makes this a drift guard:
// rewording a guard turns this red.

const PORTUGUESE_TEXT = "Este é um texto em português para classificação.";

// Stands in for corpus text that an underlying runtime error might echo back.
const DOCUMENT_EXCERPT =
  "Considerando o disposto no artigo quinto da resolução vigente, a comissão " +
  "deliberou pelo arquivamento imediato do processo administrativo.";

function detailOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return sanitizeFailureDetail(error);
  }
  throw new Error("expected the call to throw");
}

async function detailOfAsync(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return sanitizeFailureDetail(error);
  }
  throw new Error("expected the call to reject");
}

describe("aggregateWindowsV2 failure codes", () => {
  const window = (rawScore: number): WindowScore[] => [
    { index: 0, tokenStart: 0, tokenEnd: 10, rawScore },
  ];

  it("gives the non-finite score and the zero-weight branch distinct codes", () => {
    const nonFinite = detailOf(() =>
      aggregateWindowsV2(window(Number.NaN), 10),
    );
    const outOfRange = detailOf(() => aggregateWindowsV2(window(1.01), 10));
    const zeroWeight = detailOf(() =>
      aggregateWindowsV2(
        [{ index: 0, tokenStart: 5, tokenEnd: 5, rawScore: 0.5 }],
        10,
      ),
    );
    const badTotal = detailOf(() => aggregateWindowsV2(window(0.5), 0));

    expect(nonFinite).toBe("NON_FINITE_SCORE");
    expect(outOfRange).toBe("SCORE_OUT_OF_RANGE");
    expect(zeroWeight).toBe("ZERO_UNIQUE_TOKEN_WEIGHT");
    expect(badTotal).toBe("INVALID_TOTAL_TOKEN_COUNT");
    expect(new Set([nonFinite, outOfRange, zeroWeight, badTotal]).size).toBe(4);
    for (const detail of [nonFinite, outOfRange, zeroWeight, badTotal]) {
      expect(isSanitizedFailureDetail(detail)).toBe(true);
    }
  });

  // The three windowing guards A2 added. The long-document remedy — dropping
  // content tokens from the end of a window — has two cases where it cannot work
  // (offsets that map every token to the whole text, and an interval the offset
  // array cannot address), and each must be countable as ITSELF rather than as
  // the token-limit overflow that triggered it or as each other.
  it("names the unshrinkable window slice, the bad interval and the selection mismatch", () => {
    const text = Array.from({ length: 12 }, (_, i) => `t${i}`).join(" ");
    const sound = [...text.matchAll(/\S+/gu)].map((match) => ({
      start: match.index,
      end: match.index + match[0].length,
    }));
    const coarse = Array.from({ length: 12 }, () => ({
      start: 0,
      end: text.length,
    }));
    const notReducible = detailOf(() =>
      fitWindowSlice(
        text,
        coarse,
        { index: 0, tokenStart: 0, tokenEnd: 12 },
        4,
        (slice) => slice.trim().split(/\s+/u).length,
      ),
    );
    const outOfRangeInterval = detailOf(() =>
      fitWindowSlice(
        text,
        sound,
        { index: 0, tokenStart: 0, tokenEnd: sound.length + 2 },
        4,
        (slice) => slice.trim().split(/\s+/u).length,
      ),
    );
    const candidates: WindowScore[] = Array.from(
      { length: 20 },
      (_, index) => ({
        index,
        tokenStart: index * 446,
        tokenEnd: index * 446 + 510,
        rawScore: 0.5,
      }),
    );
    const mismatch = detailOf(() =>
      aggregateWindowsV2(candidates, 19 * 446 + 510, {
        selection: selectDistributedWindows(candidates, 8),
      }),
    );

    expect(notReducible).toBe("WINDOW_SLICE_NOT_REDUCIBLE");
    expect(outOfRangeInterval).toBe("WINDOW_OFFSETS_OUT_OF_RANGE");
    expect(mismatch).toBe("WINDOW_SELECTION_MISMATCH");
    // Three distinct details, so a scored artifact can COUNT them apart.
    expect(new Set([notReducible, outOfRangeInterval, mismatch]).size).toBe(3);
    // None may degrade to the opaque code the detail field exists to replace —
    // which is what a code missing from the shared allowlist would produce.
    for (const detail of [notReducible, outOfRangeInterval, mismatch]) {
      expect(isSanitizedFailureDetail(detail)).toBe(true);
      expect(detail).not.toBe(UNCLASSIFIED_FAILURE_DETAIL_CODE);
    }
  });

  it("keeps the coded error class so existing recovery still recognizes it", () => {
    expect(() => aggregateWindowsV2(window(Number.NaN), 10)).toThrowError(
      expect.objectContaining({ code: "INFERENCE_FAILED" }),
    );
    expect(() =>
      aggregateWindowsV2(
        [{ index: 0, tokenStart: 5, tokenEnd: 5, rawScore: 0.5 }],
        10,
      ),
    ).toThrowError(expect.objectContaining({ code: "INFERENCE_FAILED" }));
  });
});

describe("OnnxTextClassifier failure causes", () => {
  it("preserves the underlying cause instead of discarding it", async () => {
    const underlying = new Error("Aborted(). RuntimeError: out of memory");
    const gateway = new FakeGateway({ logits: [[-1, 2]] });
    gateway.run.mockRejectedValueOnce(underlying);
    const classifier = new OnnxTextClassifier(manifest(), gateway, "wasm");
    await classifier.initialize();

    const rejection = await classifier
      .classify(PORTUGUESE_TEXT)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(CleanFeedError);
    expect((rejection as CleanFeedError).code).toBe("INFERENCE_FAILED");
    expect((rejection as Error).cause).toBe(underlying);
    expect(sanitizeFailureDetail(rejection)).toBe("WASM_OOM");
  });

  it("distinguishes the token limit from a merely malformed input length", async () => {
    const overLimit = await detailOfAsync(async () => {
      const classifier = createClassifier({
        tokens: {
          inputIds: Array.from({ length: 257 }, (_unused, index) => index),
          specialTokenCount: 2,
          tokenOffsets: [],
        },
      });
      await classifier.initialize();
      return classifier.classify(PORTUGUESE_TEXT);
    });
    const malformed = await detailOfAsync(async () => {
      const classifier = createClassifier({
        tokens: {
          inputIds: [101, 11, 102],
          specialTokenCount: 9,
          tokenOffsets: [],
        },
      });
      await classifier.initialize();
      return classifier.classify(PORTUGUESE_TEXT);
    });

    expect(overLimit).toBe(
      "TOKEN_LIMIT_EXCEEDED: Model input exceeds the model token limit.",
    );
    expect(malformed).toBe(
      "INVALID_MODEL_INPUT_LENGTH: Model input has an invalid length.",
    );
  });

  it("never lets an underlying error echo document text into the detail", async () => {
    const gateway = new FakeGateway({ logits: [[-1, 2]] });
    gateway.run.mockRejectedValueOnce(
      new Error(`tokenizer failed on input: ${DOCUMENT_EXCERPT}`),
    );
    const classifier = new OnnxTextClassifier(manifest(), gateway, "wasm");
    await classifier.initialize();

    const detail = await detailOfAsync(() =>
      classifier.classify(PORTUGUESE_TEXT),
    );

    // The wrapper's own message is allowlisted, so the detail stays readable —
    // but nothing from the document reaches it.
    expect(detail).toBe("ONNX_INFERENCE_FAILED: ONNX inference failed.");
    for (const word of ["artigo", "comissão", "arquivamento", "processo"]) {
      expect(detail).not.toContain(word);
    }
    expect(detail).not.toBe("");
    expect(detail).not.toBe(UNCLASSIFIED_FAILURE_DETAIL_CODE);
  });
});

describe("ExactTokenizer offset-derivation failures", () => {
  // Five source bytes, so a surface-token stream can be made to under- or
  // over-tile it.
  const TARGET = "texto";

  it("gives each of the six tokenizer guards its own readable code", () => {
    const details = {
      streamsDisagree: detailOf(() =>
        // Two ids, one surface token.
        encode({ ids: [1, 2], tokens: [byteLevelToken(TARGET)] }),
      ),
      invalidTokenId: detailOf(() =>
        // 1.5 is not a safe integer, so it is not a token id.
        encode({ ids: [1.5], tokens: [byteLevelToken(TARGET)] }),
      ),
      invalidIdsShape: detailOf(() =>
        // input_ids is neither an array nor a typed-array view.
        encode({ ids: { unexpected: true }, tokens: [byteLevelToken(TARGET)] }),
      ),
      byteLayoutOverflow: detailOf(() =>
        // Seven token bytes over a five-byte source.
        encode({ ids: [1], tokens: [byteLevelToken("textoos")] }),
      ),
      streamDoesNotTile: detailOf(() =>
        // Three token bytes leave two source bytes uncovered.
        encode({ ids: [1], tokens: [byteLevelToken("tex")] }),
      ),
      nonByteLevelChar: detailOf(() =>
        // "中" is outside the 256-entry byte alphabet.
        encode({ ids: [1], tokens: ["中"] }),
      ),
    };

    expect(details).toEqual({
      streamsDisagree:
        "TOKENIZER_STREAM_LENGTH_MISMATCH: The loaded tokenizer's token and id streams disagree.",
      invalidTokenId:
        "TOKENIZER_INVALID_TOKEN_ID: The loaded tokenizer emitted an invalid token id.",
      invalidIdsShape:
        "TOKENIZER_INVALID_INPUT_IDS_SHAPE: The loaded tokenizer produced an invalid input_ids shape.",
      byteLayoutOverflow:
        "BYTE_LEVEL_OFFSET_OVERFLOW: A ByteLevel token does not fit the source byte layout.",
      streamDoesNotTile:
        "BYTE_LEVEL_STREAM_NOT_TILED: The ByteLevel token stream did not tile the source text.",
      nonByteLevelChar:
        "BYTE_LEVEL_NON_ALPHABET_CHARACTER: A tokenizer surface token used a non-ByteLevel character.",
    });
    expect(new Set(Object.values(details)).size).toBe(6);
    for (const detail of Object.values(details)) {
      expect(isSanitizedFailureDetail(detail)).toBe(true);
    }
  });

  it("keeps the coded error class, and never echoes the document", () => {
    // Every one of these throws carries code TOKENIZATION_FAILED, which is what
    // `errorScore` records as reasonCode — so the detail is the ONLY place the
    // six become distinguishable. The source text must not appear in either.
    expect(() => encode({ ids: [1], tokens: ["中"] })).toThrowError(
      expect.objectContaining({ code: "TOKENIZATION_FAILED" }),
    );
    expect(detailOf(() => encode({ ids: [1], tokens: ["中"] }))).not.toContain(
      TARGET,
    );
  });

  /** Renders a string's UTF-8 bytes as ByteLevel surface characters. */
  function byteLevelToken(text: string): string {
    return Array.from(new TextEncoder().encode(text), (byte) =>
      byte === 0x20 ? "Ġ" : String.fromCharCode(byte),
    ).join("");
  }

  function encode(target: { ids: unknown; tokens: unknown }): unknown {
    return exactTokenizerOver(target).encodeWithOffsets(TARGET);
  }

  /**
   * The smallest tokenizer double that reaches the guards: any text other than
   * TARGET (the special-token probe "cleanfeed" and the mode probe "a b") gets a
   * well-formed one-id, byte-tiling answer, so construction measures two special
   * tokens and detects ByteLevel; TARGET gets whatever the case needs.
   */
  function exactTokenizerOver(target: {
    ids: unknown;
    tokens: unknown;
  }): ExactTokenizer {
    const call = (text: string, options: { add_special_tokens: boolean }) =>
      text === TARGET
        ? { input_ids: target.ids }
        : { input_ids: options.add_special_tokens ? [0, 1, 2] : [1] };
    const tokenize = (text: string) =>
      text === TARGET ? target.tokens : [byteLevelToken(text)];

    return ExactTokenizer.create(
      Object.assign(call, {
        tokenize,
      }) as unknown as LoadedTransformersTokenizer,
    );
  }
});

class FakeGateway implements TransformersModelGateway {
  readonly load = vi.fn(async () => undefined);
  readonly tokenize = vi.fn(async () => this.tokens);
  readonly run = vi.fn(
    async (): Promise<Record<string, unknown>> => this.output,
  );
  readonly dispose = vi.fn(async () => undefined);

  constructor(
    private output: Record<string, unknown>,
    private readonly tokens: ModelTokens = {
      inputIds: [101, 11, 12, 102],
      specialTokenCount: 2,
      tokenOffsets: [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
      ],
    },
  ) {}
}

function createClassifier({
  tokens,
}: { tokens?: ModelTokens } = {}): OnnxTextClassifier {
  return new OnnxTextClassifier(
    manifest(),
    new FakeGateway({ logits: [[-1, 2]] }, tokens),
    "wasm",
  );
}

function manifest(): CleanFeedModelManifest {
  return structuredClone(validManifest) as CleanFeedModelManifest;
}
