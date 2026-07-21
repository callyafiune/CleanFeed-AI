import { afterEach, describe, expect, it, vi } from "vitest";

import {
  PostController,
  type IntersectionObserverFactory,
} from "@/content/post-controller";
import { CLASSIFICATION_STATUS_COPY } from "@/shared/classification-copy";
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
    runtimeIdentity: {
      kind: "builtin",
      modelId: "stylometric",
      modelVersion: "1.0.0",
      implementationVersion: "stylometric-v1",
    },
    evidence: {
      quality: "limited",
      coverage: 1,
      lexicalRatio: 1,
      truncated: false,
      exactTokenizer: false,
      reasonCodes: [],
    },
    decision: {
      status: "possibly_ai",
      calibratedScore: 0.84,
      actionCeiling: "hide",
      abstained: false,
      presentationAllowed: true,
      triggers: [],
      reasonCodes: [],
    },
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
      new RegExp(
        Object.values(CLASSIFICATION_STATUS_COPY)
          .map((label) => label.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
          .join("|"),
        "u",
      ),
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

  it("attaches to a LinkedIn feed root added after the controller starts", async () => {
    let intersection: FakeIntersectionObserver | undefined;
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
      createIntersectionObserver: (callback) => {
        intersection = new FakeIntersectionObserver(callback);
        return intersection;
      },
      sendMessage,
      hashText: async () => "delayed-feed-post",
    });

    controller.start();
    const root = document.createElement("main");
    const eligiblePost = post(
      Array.from({ length: 120 }, () => "conteúdo").join(" "),
    );
    root.append(eligiblePost);
    document.body.append(root);
    await flushPromises();

    intersection?.emit(eligiblePost, true);
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(eligiblePost.dataset.cleanfeedState).toBe("classified");
  });

  it("cancels queued work when stopped before its microtask can classify", async () => {
    const root = document.createElement("main");
    const eligiblePost = post(
      Array.from({ length: 120 }, () => "conteúdo").join(" "),
    );
    root.append(eligiblePost);
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
      hashText: async () => "stopped-post",
    });

    controller.start();
    intersection?.emit(eligiblePost, true);
    controller.stop();
    await flushPromises();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(
      eligiblePost.parentElement?.querySelector(
        "[data-cleanfeed-owned='badge']",
      ),
    ).toBeNull();
  });

  it("does not present a result when stopped while verifying post identity", async () => {
    const root = document.createElement("main");
    const eligiblePost = post(
      Array.from({ length: 120 }, () => "conteúdo").join(" "),
    );
    root.append(eligiblePost);
    document.body.append(root);
    let intersection: FakeIntersectionObserver | undefined;
    let resolveCurrentHash: ((hash: string) => void) | undefined;
    const currentHash = new Promise<string>((resolve) => {
      resolveCurrentHash = resolve;
    });
    const sendMessage = vi.fn().mockResolvedValue({
      source: "background",
      target: "content",
      type: "CLASSIFICATION_RESULT",
      requestId: "request-1",
      payload: createResult(),
    });
    const hashText = vi
      .fn()
      .mockResolvedValueOnce("eligible-post")
      .mockImplementationOnce(() => currentHash);
    const controller = new PostController({
      adapter: new LinkedInAdapter(),
      document,
      settings: DEFAULT_SETTINGS,
      createIntersectionObserver: (callback) => {
        intersection = new FakeIntersectionObserver(callback);
        return intersection;
      },
      sendMessage,
      hashText,
    });

    controller.start();
    intersection?.emit(eligiblePost, true);
    await vi.waitFor(() => expect(hashText).toHaveBeenCalledTimes(2));
    controller.stop();
    resolveCurrentHash?.("eligible-post");
    await flushPromises();

    expect(
      eligiblePost.parentElement?.querySelector(
        "[data-cleanfeed-owned='badge']",
      ),
    ).toBeNull();
    expect(eligiblePost.dataset.cleanfeedState).toBe("cancelled");
    expect(controller.stats.snapshot().analyzed).toBe(0);
  });

  it("does not restore or count posts that never received presentation", () => {
    const root = document.createElement("main");
    const unpresentedPost = post("Ainda não entrou no viewport.");
    root.append(unpresentedPost);
    document.body.append(root);
    const adapter = new LinkedInAdapter();
    const restorePresentation = vi.spyOn(adapter, "restorePresentation");
    const controller = new PostController({
      adapter,
      document,
      settings: DEFAULT_SETTINGS,
      createIntersectionObserver: () => new FakeIntersectionObserver(() => {}),
    });

    controller.start();
    controller.clearPresentation();

    expect(restorePresentation).not.toHaveBeenCalled();
    expect(controller.stats.snapshot().restored).toBe(0);
  });

  it("counts a non-filterable high-score result as analyzed but never marked or presented", async () => {
    const root = document.createElement("main");
    const eligiblePost = post(
      Array.from({ length: 120 }, () => "conteúdo").join(" "),
    );
    root.append(eligiblePost);
    document.body.append(root);
    let intersection: FakeIntersectionObserver | undefined;
    const sendMessage = vi.fn().mockResolvedValue({
      source: "background",
      target: "content",
      type: "CLASSIFICATION_RESULT",
      requestId: "request-1",
      payload: {
        ...createResult(),
        status: "inconclusive",
        aiScore: 0.95,
        humanScore: 0.05,
      },
    });
    const controller = new PostController({
      adapter: new LinkedInAdapter(),
      document,
      settings: DEFAULT_SETTINGS,
      createIntersectionObserver: (callback) => {
        intersection = new FakeIntersectionObserver(callback);
        return intersection;
      },
      sendMessage,
      hashText: async () => "inconclusive-post",
    });

    controller.start();
    intersection?.emit(eligiblePost, true);
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(
      eligiblePost.parentElement?.querySelector(
        "[data-cleanfeed-owned='badge']",
      ),
    ).toBeNull();
    const snapshot = controller.stats.snapshot();
    expect(snapshot.analyzed).toBe(1);
    expect(snapshot.marked).toBe(0);
  });
});
