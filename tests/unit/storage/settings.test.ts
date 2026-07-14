import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import { SettingsRepository } from "@/storage/settings";
import { ChromeStorageArea } from "@/storage/storage-area";
import { installChromeStorageMock } from "../../setup/chrome";

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
});
