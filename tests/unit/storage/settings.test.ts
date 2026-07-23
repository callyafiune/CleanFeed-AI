import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { UserSettings } from "@/shared/settings-types";
import { SettingsRepository } from "@/storage/settings";
import { PLATFORM_SETTINGS_STORAGE_KEY } from "@/storage/platform-settings";
import type { StorageArea } from "@/storage/storage-area";
import { ChromeStorageArea } from "@/storage/storage-area";
import { installChromeStorageMock } from "../../setup/chrome";

/** The four decision thresholds every pre-v4 envelope carried. */
const LEGACY_THRESHOLDS = {
  markingThreshold: 0.8,
  blurThreshold: 0.92,
  collapseThreshold: 0.96,
  hideThreshold: 0.99,
} as const;

/**
 * DEFAULT_SETTINGS as it existed at schema v4, before every post-v4 field (the v5
 * flag `experimentalUncalibratedTmr`, and v6's `experimentalMarkingThresholdPercent`
 * which v7 later removed). Historical envelopes (v1–v4) never carried them, so a
 * faithful seed omits the v5 flag; the migration fills it with its default.
 */
const V4_DEFAULTS = (() => {
  const base = { ...DEFAULT_SETTINGS } as Record<string, unknown>;
  delete base.experimentalUncalibratedTmr;
  return base;
})();

/**
 * DEFAULT_SETTINGS as it existed at schema v5: v4 plus the v5 flag. Since v6's
 * marking threshold was removed in v7, the v5 shape now equals the current one.
 */
const V5_DEFAULTS = { ...DEFAULT_SETTINGS } as Record<string, unknown>;

/**
 * DEFAULT_SETTINGS as it existed at schema v6: the current settings plus the
 * marking threshold that v7 removed. Seeds the v6→v7 migration test.
 */
const V6_DEFAULTS = {
  ...DEFAULT_SETTINGS,
  experimentalMarkingThresholdPercent: 70,
} as Record<string, unknown>;

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

  it("migrates a bare v3 object (with thresholds) into a v7 envelope", async () => {
    storage.seed("cleanfeed.settings.v1", {
      ...V4_DEFAULTS,
      ...LEGACY_THRESHOLDS,
      minimumWordCount: 150,
    });

    await expect(repository.get()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      minimumWordCount: 150,
    });
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 7,
      settingsVersion: 1,
      settings: { ...DEFAULT_SETTINGS, minimumWordCount: 150 },
    });
  });

  it("migrates a persisted v3 envelope to v7, dropping the four thresholds", async () => {
    storage.seed("cleanfeed.settings.v1", {
      schemaVersion: 3,
      settingsVersion: 9,
      settings: {
        ...V4_DEFAULTS,
        ...LEGACY_THRESHOLDS,
        minimumWordCount: 200,
      },
    });

    const settings = await repository.get();
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, minimumWordCount: 200 });
    expect(settings).not.toHaveProperty("markingThreshold");
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 7,
      settingsVersion: 9,
      settings: { ...DEFAULT_SETTINGS, minimumWordCount: 200 },
    });
  });

  it("preserves v1 preferences while adding new defaults and dropping thresholds", async () => {
    const v1Settings = {
      ...V4_DEFAULTS,
      ...LEGACY_THRESHOLDS,
      minimumWordCount: 150,
    } as Record<string, unknown>;
    delete v1Settings.debugMode;
    delete v1Settings.useMockModel;
    storage.seed("cleanfeed.settings.v1", {
      schemaVersion: 1,
      settingsVersion: 7,
      settings: v1Settings,
    });

    await expect(repository.get()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      minimumWordCount: 150,
      debugMode: false,
      useMockModel: false,
    });
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 7,
      settingsVersion: 7,
      settings: {
        ...DEFAULT_SETTINGS,
        minimumWordCount: 150,
        debugMode: false,
        useMockModel: false,
      },
    });
  });

  it("preserves v2 preferences while adding mock fallback and dropping thresholds", async () => {
    const v2Settings = {
      ...V4_DEFAULTS,
      ...LEGACY_THRESHOLDS,
      minimumWordCount: 150,
    } as Record<string, unknown>;
    delete v2Settings.useMockModel;
    storage.seed("cleanfeed.settings.v1", {
      schemaVersion: 2,
      settingsVersion: 4,
      settings: v2Settings,
    });

    await expect(repository.get()).resolves.toEqual({
      ...DEFAULT_SETTINGS,
      minimumWordCount: 150,
      useMockModel: false,
    });
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 7,
      settingsVersion: 4,
      settings: {
        ...DEFAULT_SETTINGS,
        minimumWordCount: 150,
        useMockModel: false,
      },
    });
  });

  it("migrates a v4 envelope to v7, filling every post-v4 default", async () => {
    storage.seed("cleanfeed.settings.v1", {
      schemaVersion: 4,
      settingsVersion: 3,
      settings: { ...V4_DEFAULTS, minimumWordCount: 175 },
    });

    const settings = await repository.get();
    expect(settings).toEqual({ ...DEFAULT_SETTINGS, minimumWordCount: 175 });
    expect(settings.experimentalUncalibratedTmr).toBe(false);
    expect(settings).not.toHaveProperty("experimentalMarkingThresholdPercent");
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 7,
      settingsVersion: 3,
      settings: { ...DEFAULT_SETTINGS, minimumWordCount: 175 },
    });
  });

  it("migrates a v5 envelope to v7, preserving the opted-in experimental flag", async () => {
    // A v5 envelope carried the experimental flag. Its shape already matches the
    // current one (v6's threshold was removed in v7), so the migration KEEPS the
    // user's opted-in flag unchanged and only re-stamps the schema version.
    storage.seed("cleanfeed.settings.v1", {
      schemaVersion: 5,
      settingsVersion: 8,
      settings: { ...V5_DEFAULTS, experimentalUncalibratedTmr: true },
    });

    const settings = await repository.get();
    expect(settings.experimentalUncalibratedTmr).toBe(true);
    expect(settings).not.toHaveProperty("experimentalMarkingThresholdPercent");
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 7,
      settingsVersion: 8,
      settings: { ...DEFAULT_SETTINGS, experimentalUncalibratedTmr: true },
    });
  });

  it("migrates a v6 envelope to v7, dropping the marking threshold and keeping prefs", async () => {
    // A v6 envelope carried the experimental marking threshold. v7 removes it (a
    // score cut is a scientific decision, never a user preference); the migration
    // must KEEP the user's other preferences and STRIP only the threshold.
    storage.seed("cleanfeed.settings.v1", {
      schemaVersion: 6,
      settingsVersion: 8,
      settings: {
        ...V6_DEFAULTS,
        experimentalUncalibratedTmr: true,
        experimentalMarkingThresholdPercent: 55,
        minimumWordCount: 150,
      },
    });

    const settings = await repository.get();
    expect(settings).not.toHaveProperty("experimentalMarkingThresholdPercent");
    expect(settings).toEqual({
      ...DEFAULT_SETTINGS,
      experimentalUncalibratedTmr: true,
      minimumWordCount: 150,
    });
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 7,
      settingsVersion: 8,
      settings: {
        ...DEFAULT_SETTINGS,
        experimentalUncalibratedTmr: true,
        minimumWordCount: 150,
      },
    });
  });

  it("stores a versioned envelope and increments its version after each change", async () => {
    const first = { ...DEFAULT_SETTINGS, minimumWordCount: 150 };
    const second = { ...first, presentationMode: "blur" as const };

    await repository.save(first);
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 7,
      settingsVersion: 1,
      settings: first,
    });

    await repository.save(second);
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 7,
      settingsVersion: 2,
      settings: second,
    });
  });

  it("rejects invalid settings before persisting them", async () => {
    await expect(
      repository.save({ ...DEFAULT_SETTINGS, minimumWordCount: 49 }),
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
  });

  it("rejects a settings object that still carries a legacy threshold key", async () => {
    await expect(
      repository.save({
        ...DEFAULT_SETTINGS,
        markingThreshold: 0.9,
      } as unknown as UserSettings),
    ).rejects.toThrowError("INVALID_SETTINGS");
  });

  it("resets settings and advances the version", async () => {
    await repository.save({ ...DEFAULT_SETTINGS, minimumWordCount: 150 });

    await expect(repository.reset()).resolves.toEqual(DEFAULT_SETTINGS);
    expect(storage.read("cleanfeed.settings.v1")).toEqual({
      schemaVersion: 7,
      settingsVersion: 2,
      settings: DEFAULT_SETTINGS,
    });
  });

  it("rejects a changed value when incrementing its version would overflow", async () => {
    const storage = new MemoryStorageArea();
    await storage.set("cleanfeed.settings.v1", {
      schemaVersion: 7,
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
        linkedin: { platformId: "linkedin", chunkOverlapTokens: 200 },
      },
    });
    const repository = new SettingsRepository(storage);

    // A chunk window of 100 tokens cannot host the platform's 200-token overlap.
    await expect(
      repository.save({ ...DEFAULT_SETTINGS, chunkSizeTokens: 100 }),
    ).rejects.toThrowError("INVALID_SETTINGS");
    await expect(repository.get()).resolves.toEqual(DEFAULT_SETTINGS);
  });

  it("removes a platform envelope with an invalid platform identifier", async () => {
    const storage = new MemoryStorageArea();
    const invalidPlatformId = "a".repeat(129);
    await storage.set(PLATFORM_SETTINGS_STORAGE_KEY, {
      schemaVersion: 1,
      settingsVersion: 1,
      platforms: {
        [invalidPlatformId]: {
          platformId: invalidPlatformId,
          minimumWordCount: 150,
        },
      },
    });
    const repository = new SettingsRepository(storage);

    await expect(repository.save(DEFAULT_SETTINGS)).resolves.toEqual(
      DEFAULT_SETTINGS,
    );
    await expect(
      storage.get(PLATFORM_SETTINGS_STORAGE_KEY),
    ).resolves.toBeUndefined();
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
      schemaVersion: 7,
      settingsVersion: 2,
      settings: second,
    });
  });
});
