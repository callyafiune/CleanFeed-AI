import { describe, expect, it } from "vitest";

import {
  buildContentWindows,
  createTextChunks,
  distributedIndices,
  fitWindowSlice,
  selectDistributedWindows,
} from "@/inference/chunker";
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

describe("distributedIndices", () => {
  it("returns no indices for an empty window set", () => {
    expect(distributedIndices(0, 8)).toEqual([]);
  });

  it("returns every index when the candidate count fits under the limit", () => {
    expect(distributedIndices(3, 8)).toEqual([0, 1, 2]);
  });

  it("spreads eight windows across twenty candidates, preserving first and last", () => {
    expect(distributedIndices(20, 8)).toEqual([0, 3, 5, 8, 11, 14, 16, 19]);
  });

  it("keeps only the sole window when there is one candidate", () => {
    expect(distributedIndices(1, 8)).toEqual([0]);
  });
});

describe("selectDistributedWindows", () => {
  function windowsOf(count: number) {
    return Array.from({ length: count }, (_, index) => ({
      index,
      tokenStart: index * 446,
      tokenEnd: index * 446 + 510,
    }));
  }

  it("keeps every window and reports no truncation under the limit", () => {
    const selection = selectDistributedWindows(windowsOf(3), 8);

    expect(selection).toEqual({
      candidateWindowCount: 3,
      selectedWindowCount: 3,
      selectedIndices: [0, 1, 2],
      selectedWindows: windowsOf(3),
      coveredIntervals: [
        { start: 0, end: 510 },
        { start: 446, end: 956 },
        { start: 892, end: 1_402 },
      ],
      truncated: false,
    });
  });

  it("truncates to the first, last and evenly distributed windows", () => {
    const selection = selectDistributedWindows(windowsOf(20), 8);

    expect(selection.candidateWindowCount).toBe(20);
    expect(selection.selectedWindowCount).toBe(8);
    expect(selection.selectedIndices).toEqual([0, 3, 5, 8, 11, 14, 16, 19]);
    expect(selection.truncated).toBe(true);
    // First and last candidate windows are always preserved.
    expect(selection.selectedIndices[0]).toBe(0);
    expect(selection.selectedIndices.at(-1)).toBe(19);
  });

  it("returns an empty selection for no windows", () => {
    expect(selectDistributedWindows([], 8)).toEqual({
      candidateWindowCount: 0,
      selectedWindowCount: 0,
      selectedIndices: [],
      selectedWindows: [],
      coveredIntervals: [],
      truncated: false,
    });
  });

  // The windows to infer must be carried by the selection itself, with their
  // ORIGINAL indices: selecting BEFORE inference is only safe if the caller can
  // loop over exactly the chosen windows without re-deriving which they were.
  it("carries the selected windows themselves, keeping their original indices", () => {
    const candidates = windowsOf(20);
    const selection = selectDistributedWindows(candidates, 8);

    expect(selection.selectedWindows).toHaveLength(8);
    expect(selection.selectedWindows.map((window) => window.index)).toEqual(
      selection.selectedIndices,
    );
    expect(selection.selectedWindows).toEqual(
      selection.selectedIndices.map((index) => candidates[index]),
    );
  });
});

describe("buildContentWindows", () => {
  const plan = { contentTokens: 510, overlapTokens: 64 };

  it("returns no window for an empty encoding", () => {
    expect(buildContentWindows(0, plan)).toEqual([]);
  });

  it("keeps a short document in one window bounded by the token count", () => {
    expect(buildContentWindows(120, plan)).toEqual([
      { index: 0, tokenStart: 0, tokenEnd: 120 },
    ]);
  });

  it("tiles a long document with the sealed stride and ends on the last token", () => {
    const windows = buildContentWindows(5_000, plan);

    expect(windows).toHaveLength(12);
    expect(windows[0]).toEqual({ index: 0, tokenStart: 0, tokenEnd: 510 });
    expect(windows[1]).toEqual({ index: 1, tokenStart: 446, tokenEnd: 956 });
    expect(windows.at(-1)!.tokenEnd).toBe(5_000);
    expect(windows.map((window) => window.index)).toEqual(
      windows.map((_, index) => index),
    );
  });
});

describe("fitWindowSlice", () => {
  // A whitespace-unit "tokenizer": each unit is one token, so the fitter's
  // arithmetic is checkable by counting words.
  const text = Array.from({ length: 12 }, (_, index) => `t${index}`).join(" ");
  const offsets = [...text.matchAll(/\S+/gu)].map((match) => ({
    start: match.index,
    end: match.index + match[0].length,
  }));
  const countUnits = (slice: string): number =>
    slice.trim().length === 0 ? 0 : slice.trim().split(/\s+/u).length;
  const wholeWindow = { index: 0, tokenStart: 0, tokenEnd: 12 };

  it("leaves a window that already fits untouched", () => {
    const fitted = fitWindowSlice(text, offsets, wholeWindow, 12, countUnits);

    expect(fitted.window).toEqual(wholeWindow);
    expect(fitted.text).toBe(text);
    expect(fitted.trimmedTokens).toBe(0);
  });

  it("drops content tokens from the END until the slice fits the budget", () => {
    const fitted = fitWindowSlice(text, offsets, wholeWindow, 10, countUnits);

    expect(fitted.trimmedTokens).toBe(2);
    expect(fitted.window).toEqual({ index: 0, tokenStart: 0, tokenEnd: 10 });
    expect(countUnits(fitted.text)).toBe(10);
    // The offsets still describe exactly what was scored: the returned slice is
    // the source text between the first and the LAST KEPT token's offsets.
    expect(fitted.text).toBe(
      text.slice(offsets[0]!.start, offsets[fitted.window.tokenEnd - 1]!.end),
    );
    expect(fitted.text.endsWith("t9")).toBe(true);
  });

  it("trims only the tail, keeping the window's own start", () => {
    const fitted = fitWindowSlice(
      text,
      offsets,
      { index: 3, tokenStart: 4, tokenEnd: 12 },
      5,
      countUnits,
    );

    expect(fitted.window).toEqual({ index: 3, tokenStart: 4, tokenEnd: 9 });
    expect(fitted.text).toBe(text.slice(offsets[4]!.start, offsets[8]!.end));
    expect(fitted.trimmedTokens).toBe(3);
  });

  // Degenerate offsets (the WordPiece coarse fallback maps EVERY token to the
  // whole text) make the slice unshrinkable. Fabricating a score from a window
  // that is really the whole document is worse than an error row, so this fails
  // closed under its own code.
  it("fails closed when the slice cannot be shrunk", () => {
    const coarse = offsets.map(() => ({ start: 0, end: text.length }));

    expect(() =>
      fitWindowSlice(text, coarse, wholeWindow, 10, countUnits),
    ).toThrowError(
      expect.objectContaining({
        code: "INFERENCE_FAILED",
        message: "WINDOW_SLICE_NOT_REDUCIBLE",
      }),
    );
  });

  it("fails closed when even a single token exceeds the budget", () => {
    expect(() =>
      fitWindowSlice(text, offsets, wholeWindow, 0, countUnits),
    ).toThrowError(
      expect.objectContaining({
        code: "INFERENCE_FAILED",
        message: "WINDOW_SLICE_NOT_REDUCIBLE",
      }),
    );
  });
});
