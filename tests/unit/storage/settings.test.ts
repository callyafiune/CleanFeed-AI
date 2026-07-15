import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import { SettingsRepository } from "@/storage/settings";
import { PLATFORM_SETTINGS_STORAGE_KEY } from "@/storage/platform-settings";
import type { StorageArea } from "@/storage/storage-area";
import { ChromeStorageArea } from "@/storage/storage-area";
import { installChromeStorageMock } from "../../setup/chrome";

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

describe("SettingsRepository", () => {
  let storage: ReturnType<typeof installChromeStorageMock>;
  let repository: SettingsRepository;

  beforeEach(() => {
    storage = installChromeStorageMock();
    repository = new SettingsRepository(new ChromeStorageArea());
  });

  it("returns defaults when no persisted settings exist", async () => {
    await expect(repository.get()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("recovers from a corrupt settings value", async () => {
    storage.seed("cleanfeed.settings.v1", { minimumWordCount: -3 });

    await expect(repository.get()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(storage.read("cleanfeed.settings.v1")).toBeUndefined();
  });

  it("migrates a valid legacy settings object into the versioned envelope", async () => {
    const legacySettings = { ...DEFAULT_SETTINGS, minimumWordCount: 150 };
    storage.seed("cleanfeed.settings.v1", legacySettings);

    await expect(repository.get()).resolves.toEqual(legacySettings);
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 1,
      settingsVersion: 1,
      settings: legacySettings,
    });
  });

  it("stores a versioned envelope and increments its version after each change", async () => {
    const first = { ...DEFAULT_SETTINGS, minimumWordCount: 150 };
    const second = { ...first, presentationMode: "blur" as const };

    await repository.save(first);
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 1,
      settingsVersion: 1,
      settings: first,
    });

    await repository.save(second);
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 1,
      settingsVersion: 2,
      settings: second,
    });
  });

  it("rejects invalid settings before persisting them", async () => {
    await expect(
      repository.save({
        ...DEFAULT_SETTINGS,
        minimumWordCount: 49,
      }),
    ).rejects.toThrowError("INVALID_SETTINGS");

    await expect(
      repository.save({ ...DEFAULT_SETTINGS, maximumTokens: 257 }),
    ).rejects.toThrowError("INVALID_SETTINGS");
    await expect(
      repository.save({ ...DEFAULT_SETTINGS, wasmConcurrency: 2 }),
    ).rejects.toThrowError("INVALID_SETTINGS");
    await expect(
      repository.save({ ...DEFAULT_SETTINGS, maximumQueueSize: 501 }),
    ).rejects.toThrowError("INVALID_SETTINGS");
    await expect(
      repository.save({ ...DEFAULT_SETTINGS, inferenceTimeoutMs: 999 }),
    ).rejects.toThrowError("INVALID_SETTINGS");
    await expect(
      repository.save({ ...DEFAULT_SETTINGS, cacheMaximumEntries: 9 }),
    ).rejects.toThrowError("INVALID_SETTINGS");

    await expect(
      repository.save({
        ...DEFAULT_SETTINGS,
        markingThreshold: 0.95,
        blurThreshold: 0.9,
      }),
    ).rejects.toThrowError("INVALID_SETTINGS");
  });

  it("resets settings and advances the version", async () => {
    await repository.save({ ...DEFAULT_SETTINGS, minimumWordCount: 150 });

    await expect(repository.reset()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 1,
      settingsVersion: 2,
      settings: DEFAULT_SETTINGS,
    });
  });

  it("rejects a changed value when incrementing its version would overflow", async () => {
    const storage = new MemoryStorageArea();
    await storage.set("cleanfeed.settings.v1", {
      schemaVersion: 1,
      settingsVersion: Number.MAX_SAFE_INTEGER,
      settings: DEFAULT_SETTINGS,
    });
    const overflowRepository = new SettingsRepository(storage);

    await expect(
      overflowRepository.save({ ...DEFAULT_SETTINGS, minimumWordCount: 150 }),
    ).rejects.toThrowError("STORAGE_VERSION_OVERFLOW");
  });

  it("rejects a global change that invalidates an existing platform override", async () => {
    const storage = new MemoryStorageArea();
    await storage.set(PLATFORM_SETTINGS_STORAGE_KEY, {
      schemaVersion: 1,
      settingsVersion: 1,
      platforms: {
        linkedin: { platformId: "linkedin", blurThreshold: 0.85 },
      },
    });
    const repository = new SettingsRepository(storage);

    await expect(
      repository.save({ ...DEFAULT_SETTINGS, markingThreshold: 0.9 }),
    ).rejects.toThrowError("INVALID_SETTINGS");
    await expect(repository.get()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("serializes concurrent global saves and preserves their version order", async () => {
    const storage = new MemoryStorageArea();
    const firstRepository = new SettingsRepository(storage);
    const secondRepository = new SettingsRepository(storage);
    const first = { ...DEFAULT_SETTINGS, minimumWordCount: 150 };
    const second = { ...DEFAULT_SETTINGS, minimumWordCount: 200 };

    await Promise.all([
      firstRepository.save(first),
      secondRepository.save(second),
    ]);

    await expect(storage.get("cleanfeed.settings.v1")).resolves.toEqual({
      schemaVersion: 1,
      settingsVersion: 2,
      settings: second,
    });
  });
});
