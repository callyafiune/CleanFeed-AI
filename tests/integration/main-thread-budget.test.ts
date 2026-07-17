import { afterEach, describe, expect, it, vi } from "vitest";

import { createFeedMutationObserver } from "@/content/observers/mutation-observer";

/**
 * The maximum candidates the feed observer may hand to its callback in one
 * synchronous cycle. The observer must yield to the main thread between cycles
 * so a large virtual-scroll insertion can never monopolise it.
 */
const MAX_CANDIDATES_PER_CYCLE = 100;

function buildPost(doc: Document, index: number): HTMLElement {
  const article = doc.createElement("article");
  article.dataset.urn = `urn:li:activity:${index}`;

  const body = doc.createElement("div");
  body.className = "update-components-text";
  const paragraph = doc.createElement("p");
  paragraph.textContent = `Publicação número ${index} com conteúdo suficiente para exercitar a extração do texto principal em português, com pontuação, acentuação e várias palavras reais.`;
  body.append(paragraph);

  const actions = doc.createElement("div");
  actions.setAttribute("data-test-actions", "");
  const like = doc.createElement("button");
  like.type = "button";
  like.textContent = "Curtir";
  actions.append(like);

  article.append(body, actions);
  return article;
}

function buildFeed(
  doc: Document,
  count: number,
): { root: HTMLElement; posts: HTMLElement[] } {
  const root = doc.createElement("main");
  const posts: HTMLElement[] = [];
  for (let index = 0; index < count; index += 1) {
    const post = buildPost(doc, index);
    root.append(post);
    posts.push(post);
  }
  return { root, posts };
}

function mutationFor(node: Node): MutationRecord {
  return { addedNodes: [node] } as unknown as MutationRecord;
}

describe("feed mutation observer main-thread budget", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("splits the feed into capped cycles so no single synchronous cycle is large", async () => {
    // The observer callback is the only synchronous entry point; it must never
    // process the whole feed in one cycle. This test verifies the batching/cap
    // that keeps each synchronous cycle small. The real 50 ms wall-clock budget
    // over the rendered feed is enforced by the E2E longtask check
    // (tests/e2e/extension.spec.ts); jsdom cannot faithfully time real-browser
    // DOM work, so a duration assertion here would be vacuous.
    const { root, posts } = buildFeed(document, 500);
    const cycleSizes: number[] = [];
    let processed = 0;
    let articles = 0;

    const observer = createFeedMutationObserver(
      root,
      (candidates) => {
        for (const candidate of candidates) {
          if (candidate.tagName === "ARTICLE") articles += 1;
        }
        cycleSizes.push(candidates.length);
        processed += candidates.length;
      },
      { debounceMs: 0 },
    );

    observer.handle(posts.map((post) => mutationFor(post)));
    await vi.waitFor(() => {
      expect(processed).toBe(posts.length);
    });
    observer.disconnect();

    // The whole feed is processed, but never in a single synchronous cycle, and
    // no cycle exceeds the cap.
    expect(processed).toBe(posts.length);
    expect(articles).toBe(posts.length);
    expect(cycleSizes.length).toBeGreaterThan(1);
    expect(Math.max(...cycleSizes)).toBeLessThanOrEqual(
      MAX_CANDIDATES_PER_CYCLE,
    );
  });

  it("caps each cycle at 100 candidates and yields between cycles", async () => {
    const { root, posts } = buildFeed(document, 500);
    const batchSizes: number[] = [];
    let processed = 0;

    const observer = createFeedMutationObserver(
      root,
      (candidates) => {
        batchSizes.push(candidates.length);
        processed += candidates.length;
      },
      { debounceMs: 0 },
    );

    observer.handle(posts.map((post) => mutationFor(post)));
    await vi.waitFor(() => {
      expect(processed).toBe(posts.length);
    });
    observer.disconnect();

    expect(batchSizes.every((size) => size <= MAX_CANDIDATES_PER_CYCLE)).toBe(
      true,
    );
    expect(batchSizes.reduce((sum, size) => sum + size, 0)).toBe(posts.length);
    expect(batchSizes).toEqual([100, 100, 100, 100, 100]);
  });

  it("prefers scheduler.yield to yield between cycles when it is available", async () => {
    const schedulerYield = vi.fn(() => Promise.resolve());
    vi.stubGlobal("scheduler", { yield: schedulerYield });

    const { root, posts } = buildFeed(document, 500);
    let processed = 0;

    const observer = createFeedMutationObserver(
      root,
      (candidates) => {
        processed += candidates.length;
      },
      { debounceMs: 0 },
    );

    observer.handle(posts.map((post) => mutationFor(post)));
    await vi.waitFor(() => {
      expect(processed).toBe(posts.length);
    });
    observer.disconnect();

    // Five cycles of 100 leave four gaps that must each yield to the main thread.
    expect(schedulerYield).toHaveBeenCalledTimes(4);
  });
});
