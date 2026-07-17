import { afterEach, describe, expect, it, vi } from "vitest";

import {
  attachContextMenuTracking,
  resolveDomainPaused,
} from "@/content/content-script";
import {
  PostController,
  type IntersectionObserverFactory,
} from "@/content/post-controller";
import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ClassificationResult } from "@/shared/types";
import { DomainPauseRepository } from "@/storage/domain-pause";
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

function classificationResponse(): unknown {
  const result: ClassificationResult = {
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
  return {
    source: "background",
    target: "content",
    type: "CLASSIFICATION_RESULT",
    requestId: "request-1",
    payload: result,
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

describe("domain pause gate", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("does not classify posts when the domain is paused", async () => {
    const root = document.createElement("main");
    const article = post(POST_TEXT);
    root.append(article);
    document.body.append(root);

    let intersection: FakeIntersectionObserver | undefined;
    const sendMessage = vi.fn().mockResolvedValue(classificationResponse());
    const createIntersectionObserver: IntersectionObserverFactory = (
      callback,
    ) => (intersection = new FakeIntersectionObserver(callback));
    const controller = new PostController({
      adapter: new LinkedInAdapter(),
      document,
      settings: DEFAULT_SETTINGS,
      domainEnabled: false,
      createIntersectionObserver,
      sendMessage,
      hashText: async () => VALID_HASH,
      feedback: new FeedbackRepository(new MemoryStorageArea()),
    });
    const detach = attachContextMenuTracking(document, () => controller);
    controller.start();

    intersection?.emit(article, true);
    await flushPromises();

    expect(sendMessage).not.toHaveBeenCalled();
    expect(article.dataset.cleanfeedState).toBe("domain-disabled");
    detach();
  });

  it("still classifies posts on a domain that is not paused", async () => {
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
      domainEnabled: true,
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
    detach();
  });

  it("live-pausing an active domain restores presentation and stops classifying", async () => {
    const root = document.createElement("main");
    const first = post(POST_TEXT);
    root.append(first);
    document.body.append(root);

    let intersection: FakeIntersectionObserver | undefined;
    const sendMessage = vi.fn().mockResolvedValue(classificationResponse());
    const controller = new PostController({
      adapter: new LinkedInAdapter(),
      document,
      settings: DEFAULT_SETTINGS,
      domainEnabled: true,
      createIntersectionObserver: (callback) =>
        (intersection = new FakeIntersectionObserver(callback)),
      sendMessage,
      hashText: async () => VALID_HASH,
      feedback: new FeedbackRepository(new MemoryStorageArea()),
    });
    const detach = attachContextMenuTracking(document, () => controller);
    controller.start();

    intersection?.emit(first, true);
    await flushPromises();
    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(controller.stats.snapshot().restored).toBe(0);

    // Pause mid-session: the open tab must react, not wait for a reload.
    controller.setDomainEnabled(false);
    expect(controller.stats.snapshot().restored).toBeGreaterThan(0);

    const second = post(POST_TEXT);
    root.append(second);
    controller.observeCandidates(root);
    intersection?.emit(second, true);
    await flushPromises();

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(second.dataset.cleanfeedState).toBe("domain-disabled");
    detach();
  });

  it("resolves the paused state of a hostname from the store", async () => {
    const storage = new MemoryStorageArea();
    await new DomainPauseRepository(storage).pause("www.linkedin.com");

    await expect(
      resolveDomainPaused("www.linkedin.com", storage),
    ).resolves.toBe(true);
    await expect(resolveDomainPaused("example.com", storage)).resolves.toBe(
      false,
    );
  });
});
