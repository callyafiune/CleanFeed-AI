import { describe, expect, it, vi } from "vitest";

import {
  BackgroundMessageRouter,
  type DomainPauseStore,
  type SettingsStore,
} from "@/background/message-router";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { UserSettings } from "@/shared/settings-types";
import type {
  ClassificationResult,
  ModelStatus,
  RuntimeModelIdentity,
} from "@/shared/types";
import {
  buildCacheKey,
  buildRuntimeModelKey,
  type ClassificationCache,
} from "@/storage/cache";
import { SettingsRepository } from "@/storage/settings";
import { ChromeStorageArea } from "@/storage/storage-area";
import { installChromeStorageMock } from "../../setup/chrome";

function createRouter(
  settings: SettingsStore,
  domainPause?: DomainPauseStore,
): BackgroundMessageRouter {
  return new BackgroundMessageRouter({
    cache: {
      getCachedClassification: vi.fn().mockResolvedValue(undefined),
      set: vi.fn().mockResolvedValue(undefined),
      remove: vi.fn().mockResolvedValue(undefined),
    },
    metrics: { record: vi.fn().mockResolvedValue(undefined) },
    offscreenClient: { classify: vi.fn() },
    modelKey: "mock:1.0.0",
    settingsFingerprint: "settings",
    settings,
    ...(domainPause === undefined ? {} : { domainPause }),
    modelStatus: vi.fn().mockResolvedValue({
      state: "ready",
      backend: "mock",
      runtimeIdentity: {
        kind: "builtin",
        modelId: "mock",
        modelVersion: "1.0.0",
        implementationVersion: "mock",
      },
      calibrationCoverage: "none",
      calibrationSetDigest: null,
      profileCount: 0,
      earliestExpiry: null,
      reasonCodes: [],
    }),
  });
}

const tmrIdentity: RuntimeModelIdentity = {
  kind: "bundle",
  modelId: "tmr-ai-text-detector",
  modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
  bundleDigest: "a".repeat(64),
  tokenizerDigest: "c".repeat(64),
  aggregationVersion: "tmr-aggregation-v2",
  contentCompositionVersion: "lexical-content-v1",
  calibrationSetDigest: "b".repeat(64),
};

const stylometricIdentity: RuntimeModelIdentity = {
  kind: "builtin",
  modelId: "stylometric",
  modelVersion: "1.0.0",
  implementationVersion: "stylometric-v1",
};

function readyStatus(
  identity: RuntimeModelIdentity | null,
  state: ModelStatus["state"] = "ready",
): ModelStatus {
  return {
    state,
    backend: "mock",
    runtimeIdentity: identity,
    calibrationCoverage: "none",
    calibrationSetDigest: null,
    profileCount: 0,
    earliestExpiry: null,
    reasonCodes: [],
  };
}

function classificationResult(
  identity: RuntimeModelIdentity,
): ClassificationResult {
  return {
    aiScore: 0.8,
    humanScore: 0.2,
    confidence: "medium",
    status: "possibly_ai",
    wordCount: 100,
    tokenCount: 120,
    runtimeIdentity: identity,
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
      calibratedScore: 0.8,
      actionCeiling: "indicator",
      abstained: false,
      presentationAllowed: true,
      triggers: [],
      reasonCodes: [],
    },
    modelVersion: "m1",
    modelId: "model",
    backend: "mock",
    processingTimeMs: 12,
    demo: true,
  };
}

function createClassificationRouter(options: {
  status: ModelStatus;
  classifyResult: ClassificationResult;
  cached?: ClassificationResult;
}) {
  const cache = {
    getCachedClassification: vi
      .fn<ClassificationCache["getCachedClassification"]>()
      .mockResolvedValue(options.cached ?? undefined),
    set: vi.fn<ClassificationCache["set"]>().mockResolvedValue(undefined),
    remove: vi.fn<ClassificationCache["remove"]>().mockResolvedValue(undefined),
  };
  const classify = vi.fn().mockResolvedValue(options.classifyResult);
  const router = new BackgroundMessageRouter({
    cache,
    metrics: { record: vi.fn().mockResolvedValue(undefined) },
    offscreenClient: { classify },
    modelKey: "stylometric-v1:1.0.0",
    settingsFingerprint: "settings",
    modelStatus: vi.fn().mockResolvedValue(options.status),
  });
  return { router, cache, classify };
}

function classifyMessage() {
  return {
    source: "content" as const,
    target: "background" as const,
    type: "CLASSIFY_TEXT" as const,
    requestId: "classify-1",
    payload: {
      text: "Um texto de publicação suficientemente longo para ser classificado.",
      platform: "linkedin",
      manual: false,
    },
  };
}

describe("BackgroundMessageRouter two-phase identity cache", () => {
  it("reads under the ready identity and returns a hit without classifying", async () => {
    const cached = classificationResult(tmrIdentity);
    const { router, cache, classify } = createClassificationRouter({
      status: readyStatus(tmrIdentity),
      classifyResult: classificationResult(tmrIdentity),
      cached,
    });

    const response = await router.handle(classifyMessage());

    expect(classify).not.toHaveBeenCalled();
    const [readKey, , readIdentity] =
      cache.getCachedClassification.mock.calls[0]!;
    expect(readKey).toContain(buildRuntimeModelKey(tmrIdentity));
    expect(readIdentity).toEqual(tmrIdentity);
    expect(response).toMatchObject({
      type: "CLASSIFICATION_RESULT",
      payload: cached,
    });
  });

  it("skips the cache read entirely while the model is still initializing", async () => {
    const { router, cache, classify } = createClassificationRouter({
      status: readyStatus(null, "initializing"),
      classifyResult: classificationResult(stylometricIdentity),
    });

    await router.handle(classifyMessage());

    expect(cache.getCachedClassification).not.toHaveBeenCalled();
    expect(classify).toHaveBeenCalledOnce();
  });

  it("writes a result under the identity that produced it, never the read identity", async () => {
    // The model was ready as TMR, but the breaker flipped the runtime to the
    // stylometric fallback mid-flight; the result must not be cached as TMR.
    const { router, cache } = createClassificationRouter({
      status: readyStatus(tmrIdentity),
      classifyResult: classificationResult(stylometricIdentity),
    });

    await router.handle(classifyMessage());

    const [writeKey] = cache.set.mock.calls[0]!;
    expect(writeKey).toContain(buildRuntimeModelKey(stylometricIdentity));
    expect(writeKey).not.toContain(buildRuntimeModelKey(tmrIdentity));
  });

  it("purges the old fixed-model cache key after writing the identity-bound one", async () => {
    const { router, cache } = createClassificationRouter({
      status: readyStatus(stylometricIdentity),
      classifyResult: classificationResult(stylometricIdentity),
    });

    await router.handle(classifyMessage());

    const [removedKey] = cache.remove.mock.calls[0]!;
    expect(removedKey).toContain("stylometric-v1:1.0.0");
    expect(
      removedKey.startsWith("linkedin:stylometric-v1:1.0.0:settings:"),
    ).toBe(true);
    // The removed legacy key is exactly the pre-identity buildCacheKey shape.
    expect(removedKey).not.toContain(buildRuntimeModelKey(stylometricIdentity));
    expect(
      buildCacheKey("linkedin", "stylometric-v1:1.0.0", "settings", "x"),
    ).toBe("linkedin:stylometric-v1:1.0.0:settings:x");
  });
});

describe("BackgroundMessageRouter settings bridge", () => {
  it("merges a validated options update and returns the persisted settings", async () => {
    let current: UserSettings = DEFAULT_SETTINGS;
    const patch = vi.fn(async (update: Partial<UserSettings>) => {
      current = { ...current, ...update };
      return current;
    });
    const router = createRouter({ get: async () => current, patch });

    const response = await router.handle({
      source: "options",
      target: "background",
      type: "UPDATE_SETTINGS",
      payload: { minimumWordCount: 150 },
    });

    expect(patch).toHaveBeenCalledWith({ minimumWordCount: 150 });
    expect(response).toMatchObject({
      source: "background",
      target: "options",
      type: "SETTINGS_RESULT",
      payload: { minimumWordCount: 150 },
    });
  });

  it("returns the model status without inspecting post content", async () => {
    const router = createRouter({
      get: async () => DEFAULT_SETTINGS,
      patch: async (update) => ({ ...DEFAULT_SETTINGS, ...update }),
    });

    await expect(
      router.handle({
        source: "popup",
        target: "background",
        type: "MODEL_STATUS_REQUEST",
        payload: undefined,
      }),
    ).resolves.toMatchObject({
      type: "MODEL_STATUS_RESULT",
      target: "popup",
      payload: { backend: "mock" },
    });
  });

  it("persists only the hostname when the popup pauses the current site", async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue(undefined);
    const router = createRouter(
      {
        get: async () => DEFAULT_SETTINGS,
        patch: async () => DEFAULT_SETTINGS,
      },
      { pause, resume },
    );

    await router.handle({
      source: "popup",
      target: "background",
      type: "PAUSE_DOMAIN",
      payload: { hostname: "www.linkedin.com", paused: true },
    });

    expect(pause).toHaveBeenCalledWith("www.linkedin.com");
    expect(resume).not.toHaveBeenCalled();
  });

  it("resumes a site when the popup unpauses it", async () => {
    const pause = vi.fn().mockResolvedValue(undefined);
    const resume = vi.fn().mockResolvedValue(undefined);
    const router = createRouter(
      {
        get: async () => DEFAULT_SETTINGS,
        patch: async () => DEFAULT_SETTINGS,
      },
      { pause, resume },
    );

    await router.handle({
      source: "popup",
      target: "background",
      type: "PAUSE_DOMAIN",
      payload: { hostname: "www.linkedin.com", paused: false },
    });

    expect(resume).toHaveBeenCalledWith("www.linkedin.com");
    expect(pause).not.toHaveBeenCalled();
  });

  it("serializes disjoint concurrent updates without losing either patch", async () => {
    installChromeStorageMock();
    const store = new SettingsRepository(new ChromeStorageArea());
    const router = createRouter(store);

    const [minimumWordCountResponse, presentationResponse] = await Promise.all([
      router.handle({
        source: "options",
        target: "background",
        type: "UPDATE_SETTINGS",
        payload: { minimumWordCount: 150 },
      }),
      router.handle({
        source: "options",
        target: "background",
        type: "UPDATE_SETTINGS",
        payload: { presentationMode: "blur" },
      }),
    ]);

    expect(minimumWordCountResponse).toMatchObject({
      type: "SETTINGS_RESULT",
      payload: { minimumWordCount: 150 },
    });
    expect(presentationResponse).toMatchObject({
      type: "SETTINGS_RESULT",
      payload: { minimumWordCount: 150, presentationMode: "blur" },
    });
    await expect(store.get()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      minimumWordCount: 150,
      presentationMode: "blur",
    });
    await expect(store.getVersion()).resolves.toBe(2);
  });
});
