import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import {
  PLATFORM_SETTINGS_STORAGE_KEY,
  PlatformSettingsRepository,
  platformSettingsOverrides,
} from "@/storage/platform-settings";
import { SettingsRepository } from "@/storage/settings";
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
      keys.flatMap((key) =>
        this.values.has(key) ? [[key, this.values.get(key) as T]] : [],
      ),
    );
  }
}

describe("PlatformSettingsRepository", () => {
  it("persists a validated partial override per platform", async () => {
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

  it("rejects an override outside the allowed range", async () => {
    const repository = new PlatformSettingsRepository(new MemoryStorageArea());

    await expect(
      repository.save({ platformId: "linkedin", maximumQueueSize: 0 }),
    ).rejects.toThrowError("INVALID_SETTINGS");
  });

  it("rejects an override that conflicts with persisted global thresholds", async () => {
    const storage = new MemoryStorageArea();
    await new SettingsRepository(storage).save({
      ...DEFAULT_SETTINGS,
      markingThreshold: 0.9,
    });
    const repository = new PlatformSettingsRepository(storage);

    await expect(
      repository.save({ platformId: "linkedin", blurThreshold: 0.85 }),
    ).rejects.toThrowError("INVALID_SETTINGS");
    await expect(repository.get("linkedin")).resolves.toBeUndefined();
  });

  it("removes a corrupt platform record during recovery", async () => {
    const storage = new MemoryStorageArea();
    await storage.set(PLATFORM_SETTINGS_STORAGE_KEY, {
      schemaVersion: 1,
      settingsVersion: 1,
      platforms: {
        linkedin: { platformId: "linkedin", maximumTokens: 257 },
      },
    });
    const repository = new PlatformSettingsRepository(storage);

    await expect(repository.get("linkedin")).resolves.toBeUndefined();
  });
});

describe("platformSettingsOverrides", () => {
  it("strips the platformId and keeps only the setting overrides", () => {
    expect(
      platformSettingsOverrides({
        platformId: "linkedin",
        minimumWordCount: 150,
        presentationMode: "blur",
      }),
    ).toEqual({ minimumWordCount: 150, presentationMode: "blur" });
  });

  it("returns an empty object when there is no platform override", () => {
    expect(platformSettingsOverrides(undefined)).toEqual({});
  });
});
