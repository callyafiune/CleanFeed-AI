import { describe, expect, it, vi } from "vitest";

import type { TransformersModelGateway } from "@/inference/onnx-classifier";
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

  it("produces exact-count spans that make nonempty chunks from original text", async () => {
    const gateway = fakeGateway([101, 5, 6, 7, 8, 102]);
    const tokenizer = new TransformersTokenizer(
      "cleanfeed-detector-v1",
      gateway,
    );
    const text = "Olá, mundo! Texto suficiente.";

    const tokenized = await tokenizer.encode(text);
    const chunks = createTextChunks(text, tokenized, {
      chunkSizeTokens: 3,
      overlapTokens: 1,
      maximumTokens: 8,
    });

    expect(tokenized.exact).toBe(true);
    expect(tokenized.spans).toHaveLength(tokenized.tokenCount);
    expect(tokenized.spans[0]).toMatchObject({ start: 0 });
    expect(tokenized.spans.at(-1)).toMatchObject({ end: text.length });
    expect(chunks).not.toHaveLength(0);
    expect(chunks.every((chunk) => chunk.text.trim().length > 0)).toBe(true);
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
      };
    }),
    run: vi.fn(async () => ({})),
    dispose: vi.fn(async () => undefined),
  };
}
