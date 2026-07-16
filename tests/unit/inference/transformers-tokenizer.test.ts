import { describe, expect, it, vi } from "vitest";

import type { TransformersModelGateway } from "@/inference/onnx-classifier";
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
});
