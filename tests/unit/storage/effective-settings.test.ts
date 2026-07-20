import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import { resolveEffectiveSettings } from "@/storage/effective-settings";
import {
  PLATFORM_SETTINGS_STORAGE_KEY,
  PlatformSettingsRepository,
} from "@/storage/platform-settings";
import { SettingsRepository } from "@/storage/settings";
import type { StorageArea } from "@/storage/storage-area";

class MemoryStorageArea implements StorageArea {
  private readonly values = new Map<string, unknown>();

  setCalls = 0;

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.setCalls += 1;
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

  it("rejects an override that conflicts with the persisted global window", async () => {
    const storage = new MemoryStorageArea();
    const globalRepository = new SettingsRepository(storage);
    const platformRepository = new PlatformSettingsRepository(storage);
    const global = { ...DEFAULT_SETTINGS, chunkSizeTokens: 100 };
    await globalRepository.save(global);

    await expect(
      platformRepository.save({
        platformId: "linkedin",
        chunkOverlapTokens: 200,
      }),
    ).rejects.toThrowError("INVALID_SETTINGS");
    await expect(platformRepository.get("linkedin")).resolves.toBeUndefined();
    expect(resolveEffectiveSettings({ global })).toEqual(global);
  });

  it("does not return or remove inherited platform-map properties", async () => {
    const storage = new MemoryStorageArea();
    const persisted = {
      schemaVersion: 1,
      settingsVersion: 1,
      platforms: {},
    };
    await storage.set(PLATFORM_SETTINGS_STORAGE_KEY, persisted);
    const repository = new PlatformSettingsRepository(storage);

    await expect(repository.get("constructor")).resolves.toBeUndefined();
    await expect(repository.get("toString")).resolves.toBeUndefined();
    await repository.remove("constructor");
    await repository.remove("toString");

    await expect(storage.get(PLATFORM_SETTINGS_STORAGE_KEY)).resolves.toBe(
      persisted,
    );
  });

  it("removes a corrupt platform settings record during recovery", async () => {
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
    await expect(
      storage.get(PLATFORM_SETTINGS_STORAGE_KEY),
    ).resolves.toBeUndefined();
  });

  it("rejects a platform update when its version would overflow", async () => {
    const storage = new MemoryStorageArea();
    await storage.set(PLATFORM_SETTINGS_STORAGE_KEY, {
      schemaVersion: 1,
      settingsVersion: Number.MAX_SAFE_INTEGER,
      platforms: {},
    });
    const repository = new PlatformSettingsRepository(storage);

    await expect(
      repository.save({ platformId: "linkedin", minimumWordCount: 150 }),
    ).rejects.toThrowError("STORAGE_VERSION_OVERFLOW");
  });

  it("serializes concurrent platform saves without dropping either override", async () => {
    const storage = new MemoryStorageArea();
    const firstRepository = new PlatformSettingsRepository(storage);
    const secondRepository = new PlatformSettingsRepository(storage);

    await Promise.all([
      firstRepository.save({ platformId: "linkedin", minimumWordCount: 150 }),
      secondRepository.save({
        platformId: "example",
        presentationMode: "hide",
      }),
    ]);

    await expect(storage.get(PLATFORM_SETTINGS_STORAGE_KEY)).resolves.toEqual({
      schemaVersion: 1,
      settingsVersion: 2,
      platforms: {
        linkedin: { platformId: "linkedin", minimumWordCount: 150 },
        example: { platformId: "example", presentationMode: "hide" },
      },
    });
  });

  it("does not write or increment the version for an identical override", async () => {
    const storage = new MemoryStorageArea();
    const repository = new PlatformSettingsRepository(storage);
    const override = { platformId: "linkedin", minimumWordCount: 150 };

    await repository.save(override);
    const writesAfterFirstSave = storage.setCalls;
    await repository.save(override);

    expect(storage.setCalls).toBe(writesAfterFirstSave);
    await expect(storage.get(PLATFORM_SETTINGS_STORAGE_KEY)).resolves.toEqual({
      schemaVersion: 1,
      settingsVersion: 1,
      platforms: { linkedin: override },
    });
  });
});
