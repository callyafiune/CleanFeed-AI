import { afterEach, describe, expect, it, vi } from "vitest";

import { attachContextMenuTracking } from "@/content/content-script";
import {
  PostController,
  type IntersectionObserverFactory,
} from "@/content/post-controller";
import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ClassificationResult } from "@/shared/types";
import { FeedbackRepository } from "@/storage/feedback";
import type { StorageArea } from "@/storage/storage-area";

const POST_TEXT = Array.from({ length: 120 }, () => "conteúdo").join(" ");
const VALID_HASH = "a".repeat(64);

class MemoryStorageArea implements StorageArea {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.values.delete(key);
    }
  }

  async getMany<T>(keys: string[]): Promise<Record<string, T>> {
    return Object.fromEntries(
      keys.flatMap((key) =>
        this.values.has(key) ? [[key, this.values.get(key) as T]] : [],
      ),
    );
  }

  dump(): Record<string, unknown> {
    return Object.fromEntries(this.values.entries());
  }
}

class FakeIntersectionObserver {
  constructor(
    private readonly callback: (
      changes: { element: HTMLElement; nearViewport: boolean }[],
    ) => void,
  ) {}

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

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
    modelVersion: "test-v1",
    modelId: "test",
    backend: "mock",
    processingTimeMs: 8,
    demo: true,
  };
}

function classificationResponse(): unknown {
  return {
    source: "background",
    target: "content",
    type: "CLASSIFICATION_RESULT",
    requestId: "request-1",
    payload: createResult(),
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
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

interface Harness {
  controller: PostController;
  feedback: FeedbackRepository;
  storage: MemoryStorageArea;
  intersection: FakeIntersectionObserver;
  detach: () => void;
}

function createHarness(): Harness {
  const storage = new MemoryStorageArea();
  const feedback = new FeedbackRepository(storage);
  let intersection: FakeIntersectionObserver | undefined;
  const createIntersectionObserver: IntersectionObserverFactory = (
    callback,
  ) => {
    intersection = new FakeIntersectionObserver(callback);
    return intersection;
  };
  const controller = new PostController({
    adapter: new LinkedInAdapter(),
    document,
    settings: DEFAULT_SETTINGS,
    createIntersectionObserver,
    sendMessage: vi.fn().mockResolvedValue(classificationResponse()),
    hashText: async () => VALID_HASH,
    feedback,
    now: () => 1,
  });
  const detach = attachContextMenuTracking(document, () => controller);
  // Start here so the observer exists (and candidates in the current DOM are
  // observed) before the test emits viewport changes.
  controller.start();
  if (intersection === undefined) {
    throw new Error("intersection observer was not created");
  }
  return {
    controller,
    feedback,
    storage,
    intersection,
    detach,
  };
}

function rightClick(target: Element): void {
  target.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
}

describe("current post context actions", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("remembers only the right-clicked post element, not its text or author", async () => {
    const root = document.createElement("main");
    const article = post(POST_TEXT);
    root.append(article);
    document.body.append(root);

    const { controller, intersection, detach } = createHarness();
    intersection.emit(article, true);
    await flushPromises();

    const textRegion = article.querySelector(".update-components-text");
    expect(textRegion).not.toBeNull();
    rightClick(textRegion as Element);

    expect(controller.getContextPost()).toBe(article);
    detach();
  });

  it("reports the current post as feedback keyed only by hash", async () => {
    const root = document.createElement("main");
    const article = post(POST_TEXT);
    root.append(article);
    document.body.append(root);

    const { controller, feedback, storage, intersection, detach } =
      createHarness();
    intersection.emit(article, true);
    await flushPromises();

    rightClick(article.querySelector(".update-components-text") as Element);
    await expect(controller.reportContextFeedback("human")).resolves.toBe(true);

    const records = await feedback.list();
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      textHash: VALID_HASH,
      feedback: "human",
      predictedStatus: "possibly_ai",
      platform: "linkedin",
    });
    expect(JSON.stringify(storage.dump())).not.toContain("conteúdo");
    detach();
  });

  it("forgets the remembered post once it leaves the DOM", async () => {
    const root = document.createElement("main");
    const article = post(POST_TEXT);
    root.append(article);
    document.body.append(root);

    const { controller, intersection, detach } = createHarness();
    intersection.emit(article, true);
    await flushPromises();

    rightClick(article.querySelector(".update-components-text") as Element);
    expect(controller.getContextPost()).toBe(article);

    article.remove();

    expect(controller.getContextPost()).toBeUndefined();
    await expect(controller.reportContextFeedback("ai")).resolves.toBe(false);
    detach();
  });

  it("analyzes an observed post on demand when the user right-clicks it", async () => {
    const root = document.createElement("main");
    const article = post(POST_TEXT);
    root.append(article);
    document.body.append(root);

    const sendMessage = vi.fn().mockResolvedValue(classificationResponse());
    const controller = new PostController({
      adapter: new LinkedInAdapter(),
      document,
      settings: DEFAULT_SETTINGS,
      createIntersectionObserver: () => new FakeIntersectionObserver(() => {}),
      sendMessage,
      hashText: async () => VALID_HASH,
      feedback: new FeedbackRepository(new MemoryStorageArea()),
    });
    const detach = attachContextMenuTracking(document, () => controller);

    controller.start();
    // Never emitted into the viewport, so it stays observed and unclassified.
    expect(sendMessage).not.toHaveBeenCalled();

    rightClick(article.querySelector(".update-components-text") as Element);
    expect(controller.analyzeContextPost()).toBe(true);
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(article.dataset.cleanfeedState).toBe("classified");
    detach();
  });

  it("does nothing when no post was right-clicked", async () => {
    const { controller, detach } = createHarness();

    expect(controller.getContextPost()).toBeUndefined();
    expect(controller.analyzeContextPost()).toBe(false);
    await expect(controller.reportContextFeedback("human")).resolves.toBe(
      false,
    );
    detach();
  });

  it("re-analyzes an already-classified post instead of skipping it as duplicate", async () => {
    const root = document.createElement("main");
    const article = post(POST_TEXT);
    root.append(article);
    document.body.append(root);

    let intersection: FakeIntersectionObserver | undefined;
    const sendMessage = vi.fn().mockResolvedValue(classificationResponse());
    const controller = new PostController({
      adapter: new LinkedInAdapter(),
      document,
      settings: DEFAULT_SETTINGS,
      createIntersectionObserver: (callback) =>
        (intersection = new FakeIntersectionObserver(callback)),
      sendMessage,
      hashText: async () => VALID_HASH,
      feedback: new FeedbackRepository(new MemoryStorageArea()),
    });
    const detach = attachContextMenuTracking(document, () => controller);
    controller.start();

    intersection?.emit(article, true);
    await flushPromises();
    expect(sendMessage).toHaveBeenCalledTimes(1);

    rightClick(article.querySelector(".update-components-text") as Element);
    // The post's own hash is already remembered; without the manual-run bypass
    // this second run would skip as DUPLICATE_CONTENT and never re-classify.
    expect(controller.analyzeContextPost()).toBe(true);
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledTimes(2);
    expect(article.dataset.cleanfeedState).toBe("classified");
    detach();
  });

  it("refuses to report feedback while a re-analysis is in flight", async () => {
    const root = document.createElement("main");
    const article = post(POST_TEXT);
    root.append(article);
    document.body.append(root);

    const { controller, intersection, detach } = createHarness();
    intersection.emit(article, true);
    await flushPromises();

    rightClick(article.querySelector(".update-components-text") as Element);
    // Re-analysis moves the post out of the "classified" state; reporting now
    // must refuse rather than pair the hash with a stale/pending result.
    expect(controller.analyzeContextPost()).toBe(true);
    await expect(controller.reportContextFeedback("human")).resolves.toBe(
      false,
    );
    detach();
  });
});
