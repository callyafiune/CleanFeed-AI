import { describe, expect, it, vi } from "vitest";

import type {
  ModelTokens,
  TransformersModelGateway,
} from "@/inference/onnx-classifier";
import { createTextChunks } from "@/inference/chunker";
import { TransformersTokenizer } from "@/inference/tokenizer";

const PORTUGUESE_TEXT = "Este é um texto em português para classificação.";

describe("TransformersTokenizer", () => {
  it("reports exact model token count and never silently truncates", async () => {
    const gateway = {
      inputIds: [101, 9, 12, 23, 102],
      specialTokenCount: 2,
      load: vi.fn(async () => undefined),
      tokenize: vi.fn(async function (this: {
        inputIds: number[];
        specialTokenCount: number;
      }) {
        return {
          inputIds: this.inputIds,
          specialTokenCount: this.specialTokenCount,
          tokenOffsets: [
            { start: 0, end: 1 },
            { start: 1, end: 2 },
            { start: 2, end: 3 },
          ],
        };
      }),
      run: vi.fn(async () => ({})),
      dispose: vi.fn(async () => undefined),
    } as TransformersModelGateway & {
      inputIds: number[];
      specialTokenCount: number;
    };
    const tokenizer = new TransformersTokenizer(
      "cleanfeed-detector-v1",
      gateway,
    );

    const tokenized = await tokenizer.encode(PORTUGUESE_TEXT);

    expect(tokenized.exact).toBe(true);
    expect(tokenized.tokenCount).toBe(
      gateway.inputIds.length - gateway.specialTokenCount,
    );
    expect(gateway.tokenize).toHaveBeenCalledWith(PORTUGUESE_TEXT);
  });

  it("uses model token offsets when one lexeme splits into multiple tokens", async () => {
    const text = "desnecessariamente";
    const gateway = fakeGatewayFor(text, [
      { start: 0, end: 3 },
      { start: 3, end: 9 },
      { start: 9, end: 13 },
      { start: 13, end: text.length },
    ]);
    const tokenizer = new TransformersTokenizer(
      "cleanfeed-detector-v1",
      gateway,
    );

    const tokenized = await tokenizer.encode(text);
    const chunks = createTextChunks(text, tokenized, {
      chunkSizeTokens: 2,
      overlapTokens: 0,
      maximumTokens: 2,
    });
    const reTokenized = await Promise.all(
      chunks.map((chunk) => tokenizer.encode(chunk.text)),
    );

    expect(tokenized.exact).toBe(true);
    expect(tokenized.spans).toEqual([
      expect.objectContaining({ start: 0, end: 3 }),
      expect.objectContaining({ start: 3, end: 9 }),
      expect.objectContaining({ start: 9, end: 13 }),
      expect.objectContaining({ start: 13, end: text.length }),
    ]);
    expect(chunks.map((chunk) => chunk.text)).toEqual([
      "desnecess",
      "ariamente",
    ]);
    expect(reTokenized.every(({ tokenCount }) => tokenCount <= 2)).toBe(true);
  });

  it("uses the model offsets verbatim for a repeated substring", async () => {
    // A substring search for "ab" would map both tokens to 0..2; the exact
    // path must instead honour the offsets the model tokenizer emitted.
    const gateway = {
      load: vi.fn(async () => undefined),
      tokenize: vi.fn(async () => ({
        inputIds: [101, 11, 11, 102],
        specialTokenCount: 2,
        tokenOffsets: [
          { start: 0, end: 2 },
          { start: 2, end: 4 },
        ],
      })),
      run: vi.fn(async () => ({})),
      dispose: vi.fn(async () => undefined),
    } as unknown as TransformersModelGateway;
    const tokenizer = new TransformersTokenizer(
      "cleanfeed-detector-v1",
      gateway,
    );

    const tokenized = await tokenizer.encode("abab");

    expect(tokenized.tokenCount).toBe(2);
    expect(tokenized.spans).toEqual([
      expect.objectContaining({ start: 0, end: 2 }),
      expect.objectContaining({ start: 2, end: 4 }),
    ]);
    expect(tokenized.spans.at(-1)!.end).toBe("abab".length);
  });

  it("rejects exact chunking when the model gateway cannot provide offsets", async () => {
    const gateway = fakeGateway([101, 1, 2, 102]);
    const tokenizer = new TransformersTokenizer(
      "cleanfeed-detector-v1",
      gateway,
    );

    await expect(tokenizer.encode("texto")).rejects.toThrow(
      "MODEL_TOKEN_OFFSETS_UNAVAILABLE",
    );
  });
});

function fakeGateway(inputIds: number[]): TransformersModelGateway & {
  inputIds: number[];
  specialTokenCount: number;
} {
  return {
    inputIds,
    specialTokenCount: 2,
    load: vi.fn(async () => undefined),
    tokenize: vi.fn(async function (this: {
      inputIds: number[];
      specialTokenCount: number;
    }) {
      return {
        inputIds: this.inputIds,
        specialTokenCount: this.specialTokenCount,
      } as unknown as ModelTokens;
    }),
    run: vi.fn(async () => ({})),
    dispose: vi.fn(async () => undefined),
  };
}

function fakeGatewayFor(
  original: string,
  offsets: ModelTokens["tokenOffsets"],
): TransformersModelGateway {
  return {
    load: vi.fn(async () => undefined),
    tokenize: vi.fn(async (text: string) => {
      if (text === original) {
        return {
          inputIds: [101, 1, 2, 3, 4, 102],
          specialTokenCount: 2,
          tokenOffsets: offsets,
        };
      }
      return {
        inputIds: [101, 1, 2, 102],
        specialTokenCount: 2,
        tokenOffsets: [
          { start: 0, end: Math.ceil(text.length / 2) },
          { start: Math.ceil(text.length / 2), end: text.length },
        ],
      };
    }),
    run: vi.fn(async () => ({})),
    dispose: vi.fn(async () => undefined),
  };
}
