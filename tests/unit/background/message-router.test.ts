import { describe, expect, it, vi } from "vitest";

import {
  BackgroundMessageRouter,
  type SettingsStore,
} from "@/background/message-router";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { UserSettings } from "@/shared/settings-types";

function createRouter(settings: SettingsStore): BackgroundMessageRouter {
  return new BackgroundMessageRouter({
    cache: { get: vi.fn(), set: vi.fn() },
    metrics: { record: vi.fn().mockResolvedValue(undefined) },
    offscreenClient: { classify: vi.fn() },
    modelKey: "mock:1.0.0",
    settingsFingerprint: "settings",
    settings,
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
    const save = vi.fn(async (settings: UserSettings) => {
      current = settings;
      return current;
    });
    const router = createRouter({ get: async () => current, save });

    const response = await router.handle({
      source: "options",
      target: "background",
      type: "UPDATE_SETTINGS",
      payload: { minimumWordCount: 150 },
    });

    expect(save).toHaveBeenCalledWith({
      ...DEFAULT_SETTINGS,
      minimumWordCount: 150,
    });
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
      save: async (settings) => settings,
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
});
