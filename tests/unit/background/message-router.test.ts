import { describe, expect, it, vi } from "vitest";

import {
  BackgroundMessageRouter,
  type DomainPauseStore,
  type SettingsStore,
} from "@/background/message-router";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { UserSettings } from "@/shared/settings-types";
import { SettingsRepository } from "@/storage/settings";
import { ChromeStorageArea } from "@/storage/storage-area";
import { installChromeStorageMock } from "../../setup/chrome";

function createRouter(
  settings: SettingsStore,
  domainPause?: DomainPauseStore,
): BackgroundMessageRouter {
  return new BackgroundMessageRouter({
    cache: { get: vi.fn(), set: vi.fn() },
    metrics: { record: vi.fn().mockResolvedValue(undefined) },
    offscreenClient: { classify: vi.fn() },
    modelKey: "mock:1.0.0",
    settingsFingerprint: "settings",
    settings,
    ...(domainPause === undefined ? {} : { domainPause }),
    modelStatus: vi.fn().mockResolvedValue({
      state: "ready",
      classifierId: "mock",
      modelVersion: "1.0.0",
      backend: "mock",
    }),
  });
}

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
