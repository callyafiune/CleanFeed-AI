import { describe, expect, it, vi } from "vitest";

import {
  createContentMessageListener,
  resolveContentSettings,
} from "@/content/content-script";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { StorageArea } from "@/storage/storage-area";
import { PlatformSettingsRepository } from "@/storage/platform-settings";
import { SettingsRepository } from "@/storage/settings";

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

describe("content script runtime bridge", () => {
  it("uses persisted global and platform settings instead of defaults", async () => {
    const storage = new MemoryStorageArea();
    await new SettingsRepository(storage).save({
      ...DEFAULT_SETTINGS,
      minimumWordCount: 150,
    });
    await new PlatformSettingsRepository(storage).save({
      platformId: "linkedin",
      presentationMode: "blur",
    });

    await expect(
      resolveContentSettings("linkedin", storage),
    ).resolves.toMatchObject({
      minimumWordCount: 150,
      presentationMode: "blur",
    });
  });

  it("returns the page stats snapshot for a validated popup request", () => {
    const snapshot = {
      platform: "linkedin",
      postsFound: 2,
      analyzed: 1,
      skippedByLength: 1,
      skippedByLanguage: 0,
      marked: 1,
      blurred: 0,
      collapsed: 0,
      hidden: 0,
      restored: 0,
      averageInferenceMs: 12,
      queueSize: 0,
    };
    const listener = createContentMessageListener(() => ({
      stats: { snapshot: () => snapshot },
      clearPresentation: vi.fn(),
    }));
    const sendResponse = vi.fn();

    listener(
      {
        source: "popup",
        target: "content",
        type: "GET_PAGE_STATS",
        payload: undefined,
      },
      undefined,
      sendResponse,
    );

    expect(sendResponse).toHaveBeenCalledWith({
      source: "content",
      target: "popup",
      type: "PAGE_STATS_RESULT",
      payload: snapshot,
    });
  });

  it("clears only through a validated popup clear request", () => {
    const clearPresentation = vi.fn();
    const listener = createContentMessageListener(() => ({
      stats: {
        snapshot: () => ({
          platform: "linkedin",
          postsFound: 0,
          analyzed: 0,
          skippedByLength: 0,
          skippedByLanguage: 0,
          marked: 0,
          blurred: 0,
          collapsed: 0,
          hidden: 0,
          restored: 0,
          averageInferenceMs: 0,
          queueSize: 0,
        }),
      },
      clearPresentation,
    }));

    listener(
      {
        source: "popup",
        target: "content",
        type: "CLEAR_PAGE_PRESENTATION",
        payload: undefined,
      },
      undefined,
      vi.fn(),
    );
    listener(
      {
        source: "background",
        target: "content",
        type: "GET_PAGE_STATS",
        payload: undefined,
      },
      undefined,
      vi.fn(),
    );

    expect(clearPresentation).toHaveBeenCalledTimes(1);
  });
});
