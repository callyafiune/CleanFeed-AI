import { describe, expect, it } from "vitest";

import { HeuristicTokenizer } from "@/inference/tokenizer";

describe("HeuristicTokenizer", () => {
  const tokenizer = new HeuristicTokenizer();

  it("preserves UTF-16 offsets for words, punctuation and emoji", async () => {
    const source = "Olá, mundo! #CleanFeed 😀";

    const tokenized = await tokenizer.encode(source);

    expect(tokenized.exact).toBe(false);
    expect(
      tokenized.spans.map((span) => source.slice(span.start, span.end)),
    ).toEqual(["Olá", ",", "mundo", "!", "#", "CleanFeed", "😀"]);
    expect(tokenized.spans).toEqual([
      expect.objectContaining({ start: 0, end: 3 }),
      expect.objectContaining({ start: 3, end: 4 }),
      expect.objectContaining({ start: 5, end: 10 }),
      expect.objectContaining({ start: 10, end: 11 }),
      expect.objectContaining({ start: 12, end: 13 }),
      expect.objectContaining({ start: 13, end: 22 }),
      expect.objectContaining({ start: 23, end: 25 }),
    ]);
    expect(tokenized.tokenCount).toBe(7);
  });

  it("does not emit whitespace spans", async () => {
    const source = "  água\t\n123  ";
    const tokenized = await tokenizer.encode(source);

    expect(
      tokenized.spans.map((span) => source.slice(span.start, span.end)),
    ).toEqual(["água", "123"]);
  });

  it("assigns deterministic FNV-style mock ids to each original slice", async () => {
    const source = "palavra, palavra";

    const first = await tokenizer.encode(source);
    const second = await tokenizer.encode(source);

    expect(tokenizer.id).toBe("heuristic-v1");
    expect(first).toEqual(second);
    expect(first.spans[0]?.id).toBe(first.spans[2]?.id);
    expect(first.spans[1]?.id).not.toBe(first.spans[0]?.id);
  });

  it("rejects a pre-aborted signal with the project-standard abort error", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(
      tokenizer.encode("texto", controller.signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
  });

  it("checks for aborts again after every 256 matches", async () => {
    let abortChecks = 0;
    const signal = {
      get aborted() {
        abortChecks += 1;
        return abortChecks === 3;
      },
    } as AbortSignal;

    await expect(
      tokenizer.encode("token ".repeat(257), signal),
    ).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(abortChecks).toBe(3);
  });
});
