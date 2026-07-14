import { DEFAULT_SETTINGS, MAX_PLATFORM_ID_LENGTH } from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";
import type { PlatformSettings, UserSettings } from "@/shared/settings-types";
import { assertUserSettings } from "@/storage/settings";
import type { StorageArea } from "@/storage/storage-area";

export const PLATFORM_SETTINGS_STORAGE_KEY = "cleanfeed.platform-settings.v1";
const SCHEMA_VERSION = 1;

interface PersistedPlatformSettings {
  schemaVersion: typeof SCHEMA_VERSION;
  settingsVersion: number;
  platforms: Record<string, PlatformSettings>;
}

function invalidSettings(): never {
  throw new CleanFeedError("INVALID_SETTINGS", "INVALID_SETTINGS");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasValidPlatformId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_PLATFORM_ID_LENGTH
  );
}

function isValidPlatformSettings(value: unknown): value is PlatformSettings {
  if (!isRecord(value) || !hasValidPlatformId(value.platformId)) {
    return false;
  }

  const keys = Object.keys(value);
  const allowedKeys = new Set(["platformId", ...Object.keys(DEFAULT_SETTINGS)]);
  if (!keys.every((key) => allowedKeys.has(key))) {
    return false;
  }

  try {
    const overrides = { ...value };
    delete overrides.platformId;
    assertUserSettings({ ...DEFAULT_SETTINGS, ...overrides } as UserSettings);
  } catch {
    return false;
  }

  return true;
}

function isPersistedPlatformSettings(
  value: unknown,
): value is PersistedPlatformSettings {
  return (
    isRecord(value) &&
    value.schemaVersion === SCHEMA_VERSION &&
    typeof value.settingsVersion === "number" &&
    Number.isSafeInteger(value.settingsVersion) &&
    value.settingsVersion >= 0 &&
    isRecord(value.platforms) &&
    Object.entries(value.platforms).every(
      ([platformId, settings]) =>
        isValidPlatformSettings(settings) && settings.platformId === platformId,
    )
  );
}

export class PlatformSettingsRepository {
  constructor(
    private readonly storage: StorageArea,
    private readonly storageKey = PLATFORM_SETTINGS_STORAGE_KEY,
  ) {}

  async get(platformId: string): Promise<PlatformSettings | undefined> {
    const persisted = await this.storage.get<unknown>(this.storageKey);
    if (!isPersistedPlatformSettings(persisted)) {
      return undefined;
    }

    return persisted.platforms[platformId];
  }

  async save(settings: PlatformSettings): Promise<PlatformSettings> {
    if (!isValidPlatformSettings(settings)) {
      invalidSettings();
    }

    const persisted = await this.storage.get<unknown>(this.storageKey);
    const previous = isPersistedPlatformSettings(persisted)
      ? persisted
      : { schemaVersion: SCHEMA_VERSION, settingsVersion: 0, platforms: {} };
    const settingsVersion = previous.settingsVersion + 1;

    await this.storage.set(this.storageKey, {
      schemaVersion: SCHEMA_VERSION,
      settingsVersion,
      platforms: { ...previous.platforms, [settings.platformId]: settings },
    } satisfies PersistedPlatformSettings);

    return settings;
  }

  async remove(platformId: string): Promise<void> {
    const persisted = await this.storage.get<unknown>(this.storageKey);
    if (
      !isPersistedPlatformSettings(persisted) ||
      !(platformId in persisted.platforms)
    ) {
      return;
    }

    const platforms = { ...persisted.platforms };
    delete platforms[platformId];
    await this.storage.set(this.storageKey, {
      schemaVersion: SCHEMA_VERSION,
      settingsVersion: persisted.settingsVersion + 1,
      platforms,
    } satisfies PersistedPlatformSettings);
  }
}
