import { describe, expect, it } from "vitest";

import { createTextChunks } from "@/inference/chunker";
import type { TokenizedText } from "@/inference/tokenizer";

const options = {
  chunkSizeTokens: 192,
  overlapTokens: 32,
  maximumTokens: 256,
};

function textOfTokens(count: number): string {
  return Array.from({ length: count }, (_, index) => `t${index}`).join(" ");
}

function tokens(count: number): TokenizedText {
  const text = textOfTokens(count);
  const spans = [...text.matchAll(/\S+/g)].map((match, index) => ({
    id: index,
    start: match.index ?? 0,
    end: (match.index ?? 0) + match[0].length,
  }));

  return { spans, tokenCount: spans.length, exact: false };
}

describe("createTextChunks", () => {
  it("returns no chunks when the text has zero tokens", () => {
    expect(createTextChunks("   \n\t", tokens(0), options)).toEqual([]);
  });

  it("keeps a short text in one non-empty chunk", () => {
    const text = textOfTokens(10);

    expect(createTextChunks(text, tokens(10), options)).toEqual([
      expect.objectContaining({ index: 0, startToken: 0, endToken: 10 }),
    ]);
  });

  it("keeps an exact chunk-size text in one chunk", () => {
    const text = textOfTokens(192);

    expect(createTextChunks(text, tokens(192), options)).toEqual([
      expect.objectContaining({ index: 0, startToken: 0, endToken: 192 }),
    ]);
  });

  it("creates 192-token chunks with 32-token overlap", () => {
    const text = textOfTokens(400);
    const chunks = createTextChunks(text, tokens(400), options);

    expect(
      chunks.map(({ startToken, endToken }) => [startToken, endToken]),
    ).toEqual([
      [0, 192],
      [160, 352],
      [320, 400],
    ]);
    expect(chunks.every((chunk) => chunk.text.length > 0)).toBe(true);
  });

  it("uses UTF-16 token spans and removes only outer whitespace", () => {
    const text = "  Olá 😀  mundo!  ";
    const tokenized: TokenizedText = {
      spans: [
        { id: 0, start: 2, end: 5 },
        { id: 1, start: 6, end: 8 },
        { id: 2, start: 10, end: 15 },
        { id: 3, start: 15, end: 16 },
      ],
      tokenCount: 4,
      exact: false,
    };

    expect(
      createTextChunks(text, tokenized, {
        chunkSizeTokens: 2,
        overlapTokens: 0,
        maximumTokens: 256,
      }),
    ).toEqual([
      { index: 0, startToken: 0, endToken: 2, text: "Olá 😀" },
      { index: 1, startToken: 2, endToken: 4, text: "mundo!" },
    ]);
  });

  it("chunks with the sealed TMR window plan (510 content / 64 overlap)", () => {
    const text = textOfTokens(1_100);
    const chunks = createTextChunks(text, tokens(1_100), {
      chunkSizeTokens: 510,
      overlapTokens: 64,
      maximumTokens: 512,
    });

    expect(
      chunks.map(({ startToken, endToken }) => [startToken, endToken]),
    ).toEqual([
      [0, 510],
      [446, 956],
      [892, 1_100],
    ]);
    // First chunk opens at token 0; the last closes on the final token — the
    // sliding window never cuts a token off the end.
    expect(chunks[0]!.startToken).toBe(0);
    expect(chunks.at(-1)!.endToken).toBe(1_100);
    expect(chunks.every((chunk) => chunk.text.length > 0)).toBe(true);
  });

  it("rejects invalid chunk settings", () => {
    expect(() =>
      createTextChunks("x", tokens(1), { ...options, chunkSizeTokens: 0 }),
    ).toThrow("INVALID_SETTINGS");
    expect(() =>
      createTextChunks("x", tokens(1), { ...options, chunkSizeTokens: 257 }),
    ).toThrow("INVALID_SETTINGS");
    // The token budget may not exceed the model capacity of 512.
    expect(() =>
      createTextChunks("x", tokens(1), { ...options, maximumTokens: 513 }),
    ).toThrow("INVALID_SETTINGS");
    expect(() =>
      createTextChunks("x", tokens(1), { ...options, overlapTokens: -1 }),
    ).toThrow("INVALID_SETTINGS");
    expect(() =>
      createTextChunks("x", tokens(1), { ...options, overlapTokens: 192 }),
    ).toThrow("INVALID_SETTINGS");
  });
});
