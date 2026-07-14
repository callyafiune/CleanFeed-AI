import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import { resolveEffectiveSettings } from "@/storage/effective-settings";
import { PlatformSettingsRepository } from "@/storage/platform-settings";
import type { StorageArea } from "@/storage/storage-area";

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
      keys
        .filter((key) => this.values.has(key))
        .map((key) => [key, this.values.get(key) as T]),
    );
  }
}

describe("resolveEffectiveSettings", () => {
  it("merges defaults, global, platform and session in that order", () => {
    const result = resolveEffectiveSettings({
      global: { minimumWordCount: 80, presentationMode: "blur" },
      platform: { platformId: "linkedin", minimumWordCount: 150 },
      session: { presentationMode: "indicator" },
    });

    expect(result.minimumWordCount).toBe(150);
    expect(result.presentationMode).toBe("indicator");
    expect(result.enabled).toBe(DEFAULT_SETTINGS.enabled);
  });
});

describe("PlatformSettingsRepository", () => {
  it("persists settings separately for each platform", async () => {
    const repository = new PlatformSettingsRepository(new MemoryStorageArea());

    await repository.save({ platformId: "linkedin", minimumWordCount: 150 });
    await repository.save({ platformId: "example", presentationMode: "hide" });

    await expect(repository.get("linkedin")).resolves.toEqual({
      platformId: "linkedin",
      minimumWordCount: 150,
    });
    await expect(repository.get("example")).resolves.toEqual({
      platformId: "example",
      presentationMode: "hide",
    });
  });

  it("rejects invalid platform overrides", async () => {
    const repository = new PlatformSettingsRepository(new MemoryStorageArea());

    await expect(
      repository.save({ platformId: "linkedin", maximumQueueSize: 0 }),
    ).rejects.toThrowError("INVALID_SETTINGS");
  });
});
