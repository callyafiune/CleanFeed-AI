import { afterEach, describe, expect, it, vi } from "vitest";

import type { ClassificationResult, StorageArea } from "@/shared/types";
import { BackgroundMessageRouter } from "@/background/message-router";
import { ClassificationCache } from "@/storage/cache";

const cachedResult: ClassificationResult = {
  aiScore: 0.8,
  humanScore: 0.2,
  confidence: "low",
  status: "possibly_ai",
  wordCount: 100,
  tokenCount: 100,
  modelVersion: "1.0.0",
  modelId: "mock",
  backend: "mock",
  processingTimeMs: 3,
  demo: true,
};

class MemoryStorage implements StorageArea {
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
      keys
        .filter((key) => this.values.has(key))
        .map((key) => [key, this.values.get(key) as T]),
    );
  }
}

const classifyMessage = {
  source: "content" as const,
  target: "background" as const,
  type: "CLASSIFY_TEXT" as const,
  requestId: "request-1",
  payload: {
    text: "Um texto longo o suficiente para testar o roteamento local.",
    platform: "linkedin",
    manual: false,
  },
};

function createRouter(cache: ClassificationCache, classify = vi.fn()) {
  return {
    classify,
    router: new BackgroundMessageRouter({
      cache,
      metrics: { record: vi.fn().mockResolvedValue(undefined) },
      offscreenClient: { classify },
      settingsFingerprint: "settings-v1",
      modelKey: "mock:1.0.0",
    }),
  };
}

describe("mock worker flow", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("classifies a valid protocol request inside the dedicated worker", async () => {
    let onMessage: ((event: MessageEvent<unknown>) => void) | undefined;
    let resolveResponse: (response: unknown) => void;
    const response = new Promise<unknown>((resolve) => {
      resolveResponse = resolve;
    });
    const workerScope = {
      addEventListener: vi.fn(
        (_type: string, listener: (event: MessageEvent<unknown>) => void) => {
          onMessage = listener;
        },
      ),
      postMessage: vi.fn((message: unknown) => resolveResponse(message)),
    };
    vi.stubGlobal("self", workerScope);

    await import("@/inference/inference-worker");

    onMessage?.({
      data: {
        type: "CLASSIFY",
        requestId: "worker-request-1",
        payload: classifyMessage.payload,
      },
    } as MessageEvent<unknown>);

    await expect(response).resolves.toMatchObject({
      type: "RESULT",
      requestId: "worker-request-1",
      payload: {
        modelId: "mock",
        backend: "mock",
        demo: true,
      },
    });
  });

  it("returns cached results without posting to the worker", async () => {
    const cache = new ClassificationCache(
      new MemoryStorage(),
      { now: () => 1_000 },
      { maximumEntries: 10, ttlMs: 60_000 },
    );
    const { buildCacheKey } = await import("@/storage/cache");
    const { sha256 } = await import("@/shared/hashing");
    const { normalizeText } = await import("@/shared/text-normalization");
    const hash = await sha256(normalizeText(classifyMessage.payload.text));
    await cache.set(
      buildCacheKey("linkedin", "mock:1.0.0", "settings-v1", hash),
      cachedResult,
    );
    const { router, classify } = createRouter(cache);

    const result = await router.handle(classifyMessage);

    expect(result).toMatchObject({
      source: "background",
      target: "content",
      type: "CLASSIFICATION_RESULT",
      requestId: "request-1",
      payload: cachedResult,
    });
    expect(classify).not.toHaveBeenCalled();
  });

  it("routes a cache miss through the offscreen client and caches its valid result", async () => {
    const cache = new ClassificationCache(
      new MemoryStorage(),
      { now: () => 1_000 },
      { maximumEntries: 10, ttlMs: 60_000 },
    );
    const { router, classify } = createRouter(
      cache,
      vi.fn().mockResolvedValue(cachedResult),
    );

    await expect(router.handle(classifyMessage)).resolves.toMatchObject({
      type: "CLASSIFICATION_RESULT",
      payload: cachedResult,
    });
    expect(classify).toHaveBeenCalledWith({
      requestId: "request-1",
      ...classifyMessage.payload,
    });
  });
});
