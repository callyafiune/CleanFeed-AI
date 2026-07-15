import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PostController,
  type IntersectionObserverFactory,
} from "@/content/post-controller";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ClassificationResult } from "@/shared/types";
import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";

class FakeIntersectionObserver {
  private readonly observed = new Set<HTMLElement>();

  constructor(
    private readonly callback: (
      changes: {
        element: HTMLElement;
        nearViewport: boolean;
      }[],
    ) => void,
  ) {}

  observe(element: HTMLElement): void {
    this.observed.add(element);
  }

  unobserve(element: HTMLElement): void {
    this.observed.delete(element);
  }

  disconnect(): void {
    this.observed.clear();
  }

  emit(element: HTMLElement, nearViewport: boolean): void {
    this.callback([{ element, nearViewport }]);
  }
}

function createResult(): ClassificationResult {
  return {
    aiScore: 0.84,
    humanScore: 0.16,
    confidence: "medium",
    status: "possibly_ai",
    wordCount: 120,
    tokenCount: 130,
    modelVersion: "test",
    modelId: "test",
    backend: "mock",
    processingTimeMs: 8,
    demo: true,
  };
}

function post(text: string): HTMLElement {
  const element = document.createElement("article");
  element.innerHTML = `<div class="update-components-text">${text}</div><div data-test-actions><button>Curtir</button></div>`;
  return element;
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("content classification pipeline", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("classifies an eligible visible post once and applies probabilistic copy", async () => {
    const root = document.createElement("main");
    const eligiblePost = post(
      Array.from({ length: 120 }, () => "conteúdo").join(" "),
    );
    root.append(eligiblePost);
    document.body.append(root);
    let intersection: FakeIntersectionObserver | undefined;
    const createIntersectionObserver: IntersectionObserverFactory = (
      callback,
    ) => {
      intersection = new FakeIntersectionObserver(callback);
      return intersection;
    };
    const sendMessage = vi.fn().mockResolvedValue({
      source: "background",
      target: "content",
      type: "CLASSIFICATION_RESULT",
      requestId: "request-1",
      payload: createResult(),
    });
    const controller = new PostController({
      adapter: new LinkedInAdapter(),
      document,
      settings: DEFAULT_SETTINGS,
      createIntersectionObserver,
      sendMessage,
      hashText: async () => "eligible-post",
    });

    controller.start();
    intersection?.emit(eligiblePost, true);
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(
      eligiblePost.parentElement?.querySelector(
        "[data-cleanfeed-owned='badge']",
      )?.textContent,
    ).toMatch(
      /Provavelmente escrito por uma pessoa|Resultado inconclusivo|Possivelmente gerado por IA|Fortes indícios/u,
    );
    expect(eligiblePost.getAttribute("data-cleanfeed-state")).toBe(
      "classified",
    );

    intersection?.emit(eligiblePost, true);
    await flushPromises();
    expect(sendMessage).toHaveBeenCalledTimes(1);
  });

  it("explains why a short post was skipped without classifying it", async () => {
    const root = document.createElement("main");
    const shortPost = post("Texto curto e humano.");
    root.append(shortPost);
    document.body.append(root);
    let intersection: FakeIntersectionObserver | undefined;
    const sendMessage = vi.fn();
    const controller = new PostController({
      adapter: new LinkedInAdapter(),
      document,
      settings: DEFAULT_SETTINGS,
      createIntersectionObserver: (callback) => {
        intersection = new FakeIntersectionObserver(callback);
        return intersection;
      },
      sendMessage,
      hashText: async () => "short-post",
    });

    controller.start();
    intersection?.emit(shortPost, true);
    await flushPromises();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(shortPost.dataset.cleanfeedState).toBe("below-minimum-length");
    expect(controller.stats.snapshot().skippedByLength).toBe(1);
  });

  it("does not classify posts that never enter the viewport", async () => {
    const root = document.createElement("main");
    root.append(post(Array.from({ length: 120 }, () => "conteúdo").join(" ")));
    document.body.append(root);
    let intersection: FakeIntersectionObserver | undefined;
    const sendMessage = vi.fn();
    const controller = new PostController({
      adapter: new LinkedInAdapter(),
      document,
      settings: DEFAULT_SETTINGS,
      createIntersectionObserver: (callback) => {
        intersection = new FakeIntersectionObserver(callback);
        return intersection;
      },
      sendMessage,
      hashText: async () => "invisible-post",
    });

    controller.start();
    await flushPromises();

    expect(intersection).toBeDefined();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
