import {
  DEFAULT_SETTINGS,
  MAX_PLATFORM_ID_LENGTH,
  SETTINGS_STORAGE_KEYS,
} from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";
import type { PlatformSettings, UserSettings } from "@/shared/settings-types";
import {
  assertUserSettings,
  incrementSettingsVersion,
  readSettingsForMutation,
  withoutLegacyThresholds,
} from "@/storage/settings";
import { runWithSettingsMutationLock } from "@/storage/settings-lock";
import type { StorageArea } from "@/storage/storage-area";

export const PLATFORM_SETTINGS_STORAGE_KEY = SETTINGS_STORAGE_KEYS.platform;
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

/**
 * Extracts the validated setting overrides from a platform record, dropping the
 * `platformId` discriminator. Shared with the effective-settings resolver so the
 * platform layer is applied through one definition of "the overriding fields".
 */
export function platformSettingsOverrides(
  settings: PlatformSettings | undefined,
): Partial<UserSettings> {
  if (settings === undefined) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(settings).filter(([key]) => key !== "platformId"),
  ) as Partial<UserSettings>;
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
    assertUserSettings({
      ...DEFAULT_SETTINGS,
      ...platformSettingsOverrides(value as unknown as PlatformSettings),
    });
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

function platformSettingsAreEqual(
  left: PlatformSettings,
  right: PlatformSettings,
): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key) =>
        Object.hasOwn(right, key) &&
        left[key as keyof PlatformSettings] ===
          right[key as keyof PlatformSettings],
    )
  );
}

/**
 * Drops legacy threshold keys from every persisted platform override, keeping
 * the surviving overrides (presentationMode, minimumWordCount, …) intact.
 * Returns `undefined` when the blob is not a platform envelope.
 */
function stripLegacyPlatformThresholds(
  value: unknown,
): { value: Record<string, unknown>; changed: boolean } | undefined {
  if (!isRecord(value) || !isRecord(value.platforms)) {
    return undefined;
  }
  let changed = false;
  const platforms: Record<string, unknown> = {};
  for (const [platformId, override] of Object.entries(value.platforms)) {
    if (!isRecord(override)) {
      platforms[platformId] = override;
      continue;
    }
    const cleaned = withoutLegacyThresholds(override);
    if (Object.keys(cleaned).length !== Object.keys(override).length) {
      changed = true;
    }
    platforms[platformId] = cleaned;
  }
  return { value: { ...value, platforms }, changed };
}

async function readPlatformSettingsForMutation(
  storage: StorageArea,
  storageKey: string,
): Promise<PersistedPlatformSettings | undefined> {
  const persisted = await storage.get<unknown>(storageKey);
  const stripped = stripLegacyPlatformThresholds(persisted);
  const candidate = stripped?.value ?? persisted;

  if (isPersistedPlatformSettings(candidate)) {
    if (stripped?.changed) {
      await storage.set(storageKey, candidate);
    }
    return candidate;
  }

  if (persisted !== undefined) {
    await storage.remove(storageKey);
  }

  return undefined;
}

export class PlatformSettingsRepository {
  constructor(
    private readonly storage: StorageArea,
    private readonly storageKey = PLATFORM_SETTINGS_STORAGE_KEY,
  ) {}

  async get(platformId: string): Promise<PlatformSettings | undefined> {
    return runWithSettingsMutationLock(async () => {
      const persisted = await readPlatformSettingsForMutation(
        this.storage,
        this.storageKey,
      );
      return persisted && Object.hasOwn(persisted.platforms, platformId)
        ? persisted.platforms[platformId]
        : undefined;
    });
  }

  async getVersion(): Promise<number> {
    return runWithSettingsMutationLock(async () => {
      return (
        (await readPlatformSettingsForMutation(this.storage, this.storageKey))
          ?.settingsVersion ?? 0
      );
    });
  }

  async save(settings: PlatformSettings): Promise<PlatformSettings> {
    if (!isValidPlatformSettings(settings)) {
      invalidSettings();
    }

    return runWithSettingsMutationLock(async () => {
      const overrides = platformSettingsOverrides(settings);
      const globalSettings = await readSettingsForMutation(this.storage);
      assertUserSettings({ ...globalSettings, ...overrides });

      const persisted = await readPlatformSettingsForMutation(
        this.storage,
        this.storageKey,
      );
      const previous = persisted ?? {
        schemaVersion: SCHEMA_VERSION,
        settingsVersion: 0,
        platforms: {},
      };
      const existing = previous.platforms[settings.platformId];
      if (existing && platformSettingsAreEqual(existing, settings)) {
        return settings;
      }

      await this.storage.set(this.storageKey, {
        schemaVersion: SCHEMA_VERSION,
        settingsVersion: incrementSettingsVersion(previous.settingsVersion),
        platforms: { ...previous.platforms, [settings.platformId]: settings },
      } satisfies PersistedPlatformSettings);

      return settings;
    });
  }

  async remove(platformId: string): Promise<void> {
    await runWithSettingsMutationLock(async () => {
      const persisted = await readPlatformSettingsForMutation(
        this.storage,
        this.storageKey,
      );
      if (!persisted || !Object.hasOwn(persisted.platforms, platformId)) {
        return;
      }

      const platforms = { ...persisted.platforms };
      delete platforms[platformId];
      await this.storage.set(this.storageKey, {
        schemaVersion: SCHEMA_VERSION,
        settingsVersion: incrementSettingsVersion(persisted.settingsVersion),
        platforms,
      } satisfies PersistedPlatformSettings);
    });
  }
}
