import {
  DEFAULT_SETTINGS,
  MAX_PLATFORM_ID_LENGTH,
  SETTINGS_LIMITS,
  SETTINGS_STORAGE_KEYS,
} from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";
import type { BackendPreference, UserSettings } from "@/shared/settings-types";
import { validateThresholds } from "@/shared/validation";
import { runWithSettingsMutationLock } from "@/storage/settings-lock";
import type { StorageArea } from "@/storage/storage-area";

export const SETTINGS_STORAGE_KEY = SETTINGS_STORAGE_KEYS.global;
const SCHEMA_VERSION = 3;
const PLATFORM_SCHEMA_VERSION = 1;

interface PersistedSettings {
  schemaVersion: typeof SCHEMA_VERSION;
  settingsVersion: number;
  settings: UserSettings;
}

type V2UserSettings = Omit<UserSettings, "useMockModel">;
type V1UserSettings = Omit<UserSettings, "debugMode" | "useMockModel">;

interface PersistedSettingsV2 {
  schemaVersion: 2;
  settingsVersion: number;
  settings: V2UserSettings;
}

interface PersistedSettingsV1 {
  schemaVersion: 1;
  settingsVersion: number;
  settings: V1UserSettings;
}

const booleanKeys = [
  "enabled",
  "processVisibleOnly",
  "experimentalShortTextDetection",
  "manualAnalysisEnabled",
  "showScore",
  "showExplanation",
  "debugMode",
  "webGpuEnabled",
  "wasmEnabled",
  "useMockModel",
  "batchingEnabled",
  "historyEnabled",
  "storeFullText",
] as const;

function invalidSettings(): never {
  throw new CleanFeedError("INVALID_SETTINGS", "INVALID_SETTINGS");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteIntegerInRange(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isSafeInteger(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function isUserSettings(value: unknown): value is UserSettings {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>;
  if (
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => Object.hasOwn(value, key))
  ) {
    return false;
  }

  if (
    !isFiniteIntegerInRange(
      value.minimumWordCount,
      SETTINGS_LIMITS.minimumWordCount.minimum,
      SETTINGS_LIMITS.minimumWordCount.maximum,
    ) ||
    !["portuguese_only", "model_supported", "experimental_any"].includes(
      value.languageMode as string,
    ) ||
    !["indicator", "blur", "collapse", "hide"].includes(
      value.presentationMode as string,
    ) ||
    !["auto", "wasm", "webgpu"].includes(
      value.backendPreference as BackendPreference,
    )
  ) {
    return false;
  }

  if (!booleanKeys.every((key) => typeof value[key] === "boolean")) {
    return false;
  }

  const { chunkSizeTokens, chunkOverlapTokens, maximumTokens } = value;
  if (
    !isFiniteIntegerInRange(
      value.wasmConcurrency,
      SETTINGS_LIMITS.wasmConcurrency.minimum,
      SETTINGS_LIMITS.wasmConcurrency.maximum,
    ) ||
    !isFiniteIntegerInRange(
      value.webGpuConcurrency,
      SETTINGS_LIMITS.webGpuConcurrency.minimum,
      SETTINGS_LIMITS.webGpuConcurrency.maximum,
    ) ||
    !isFiniteIntegerInRange(
      value.maximumQueueSize,
      SETTINGS_LIMITS.maximumQueueSize.minimum,
      SETTINGS_LIMITS.maximumQueueSize.maximum,
    ) ||
    !isFiniteIntegerInRange(
      value.maximumPostsPerMinute,
      SETTINGS_LIMITS.maximumPostsPerMinute.minimum,
      SETTINGS_LIMITS.maximumPostsPerMinute.maximum,
    ) ||
    !isFiniteIntegerInRange(
      chunkSizeTokens,
      SETTINGS_LIMITS.chunkSizeTokens.minimum,
      SETTINGS_LIMITS.chunkSizeTokens.maximum,
    ) ||
    !isFiniteIntegerInRange(
      maximumTokens,
      SETTINGS_LIMITS.maximumTokens.minimum,
      SETTINGS_LIMITS.maximumTokens.maximum,
    ) ||
    !isFiniteIntegerInRange(
      value.inferenceTimeoutMs,
      SETTINGS_LIMITS.inferenceTimeoutMs.minimum,
      SETTINGS_LIMITS.inferenceTimeoutMs.maximum,
    ) ||
    !isFiniteIntegerInRange(
      value.cacheMaximumEntries,
      SETTINGS_LIMITS.cacheMaximumEntries.minimum,
      SETTINGS_LIMITS.cacheMaximumEntries.maximum,
    ) ||
    !isFiniteIntegerInRange(
      value.cacheTtlMs,
      SETTINGS_LIMITS.cacheTtlMs.minimum,
      SETTINGS_LIMITS.cacheTtlMs.maximum,
    ) ||
    !isFiniteIntegerInRange(
      value.historyRetentionDays,
      SETTINGS_LIMITS.historyRetentionDays.minimum,
      SETTINGS_LIMITS.historyRetentionDays.maximum,
    ) ||
    !isFiniteIntegerInRange(chunkOverlapTokens, 0, chunkSizeTokens - 1) ||
    chunkOverlapTokens >= chunkSizeTokens ||
    maximumTokens < chunkSizeTokens
  ) {
    return false;
  }

  try {
    validateThresholds({
      marking: value.markingThreshold as number,
      blur: value.blurThreshold as number,
      collapse: value.collapseThreshold as number,
      hide: value.hideThreshold as number,
    });
  } catch {
    return false;
  }

  return true;
}

function isV2UserSettings(value: unknown): value is V2UserSettings {
  if (!isRecord(value) || Object.hasOwn(value, "useMockModel")) return false;
  const expectedKeys = Object.keys(DEFAULT_SETTINGS).filter(
    (key) => key !== "useMockModel",
  );
  return (
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    isUserSettings({ ...value, useMockModel: false })
  );
}

function isV1UserSettings(value: unknown): value is V1UserSettings {
  if (
    !isRecord(value) ||
    Object.hasOwn(value, "debugMode") ||
    Object.hasOwn(value, "useMockModel")
  ) {
    return false;
  }
  const expectedKeys = Object.keys(DEFAULT_SETTINGS).filter(
    (key) => key !== "debugMode" && key !== "useMockModel",
  );
  return (
    Object.keys(value).length === expectedKeys.length &&
    expectedKeys.every((key) => Object.hasOwn(value, key)) &&
    isUserSettings({ ...value, debugMode: false, useMockModel: false })
  );
}

function isPersistedSettings(value: unknown): value is PersistedSettings {
  return (
    isRecord(value) &&
    value.schemaVersion === SCHEMA_VERSION &&
    isFiniteIntegerInRange(value.settingsVersion, 0, Number.MAX_SAFE_INTEGER) &&
    isUserSettings(value.settings)
  );
}

function isPersistedSettingsV2(value: unknown): value is PersistedSettingsV2 {
  return (
    isRecord(value) &&
    value.schemaVersion === 2 &&
    isFiniteIntegerInRange(value.settingsVersion, 0, Number.MAX_SAFE_INTEGER) &&
    isV2UserSettings(value.settings)
  );
}

function isPersistedSettingsV1(value: unknown): value is PersistedSettingsV1 {
  return (
    isRecord(value) &&
    value.schemaVersion === 1 &&
    isFiniteIntegerInRange(value.settingsVersion, 0, Number.MAX_SAFE_INTEGER) &&
    isV1UserSettings(value.settings)
  );
}

function settingsAreEqual(left: UserSettings, right: UserSettings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>).every(
    (key) => left[key] === right[key],
  );
}

function getPlatformOverrides(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== "platformId"),
  );
}

async function validatePlatformOverridesForGlobal(
  storage: StorageArea,
  settings: UserSettings,
): Promise<void> {
  const persisted = await storage.get<unknown>(SETTINGS_STORAGE_KEYS.platform);
  if (persisted === undefined) {
    return;
  }

  if (
    !isRecord(persisted) ||
    persisted.schemaVersion !== PLATFORM_SCHEMA_VERSION ||
    !isFiniteIntegerInRange(
      persisted.settingsVersion,
      0,
      Number.MAX_SAFE_INTEGER,
    ) ||
    !isRecord(persisted.platforms)
  ) {
    await storage.remove(SETTINGS_STORAGE_KEYS.platform);
    return;
  }

  const allowedKeys = new Set(["platformId", ...Object.keys(DEFAULT_SETTINGS)]);
  for (const [platformId, rawOverrides] of Object.entries(
    persisted.platforms,
  )) {
    if (
      !isRecord(rawOverrides) ||
      platformId.length === 0 ||
      platformId.length > MAX_PLATFORM_ID_LENGTH ||
      rawOverrides.platformId !== platformId ||
      !Object.keys(rawOverrides).every((key) => allowedKeys.has(key))
    ) {
      await storage.remove(SETTINGS_STORAGE_KEYS.platform);
      return;
    }

    try {
      assertUserSettings({
        ...DEFAULT_SETTINGS,
        ...getPlatformOverrides(rawOverrides),
      });
    } catch {
      await storage.remove(SETTINGS_STORAGE_KEYS.platform);
      return;
    }

    assertUserSettings({ ...settings, ...getPlatformOverrides(rawOverrides) });
  }
}

export function assertUserSettings(
  value: unknown,
): asserts value is UserSettings {
  if (!isUserSettings(value)) {
    invalidSettings();
  }
}

export function incrementSettingsVersion(settingsVersion: number): number {
  if (
    !Number.isSafeInteger(settingsVersion) ||
    settingsVersion < 0 ||
    settingsVersion >= Number.MAX_SAFE_INTEGER
  ) {
    throw new CleanFeedError("STORAGE_ERROR", "STORAGE_VERSION_OVERFLOW");
  }

  return settingsVersion + 1;
}

async function readPersistedSettingsForMutation(
  storage: StorageArea,
  storageKey: string = SETTINGS_STORAGE_KEY,
): Promise<PersistedSettings | undefined> {
  const persisted = await storage.get<unknown>(storageKey);
  if (isPersistedSettings(persisted)) {
    return persisted;
  }

  if (isPersistedSettingsV2(persisted)) {
    const migrated = {
      schemaVersion: SCHEMA_VERSION,
      settingsVersion: persisted.settingsVersion,
      settings: { ...persisted.settings, useMockModel: false },
    } satisfies PersistedSettings;
    await storage.set(storageKey, migrated);
    return migrated;
  }

  if (isPersistedSettingsV1(persisted)) {
    const migrated = {
      schemaVersion: SCHEMA_VERSION,
      settingsVersion: persisted.settingsVersion,
      settings: {
        ...persisted.settings,
        debugMode: false,
        useMockModel: false,
      },
    } satisfies PersistedSettings;
    await storage.set(storageKey, migrated);
    return migrated;
  }

  if (isV2UserSettings(persisted)) {
    const migrated = {
      schemaVersion: SCHEMA_VERSION,
      settingsVersion: 1,
      settings: { ...persisted, useMockModel: false },
    } satisfies PersistedSettings;
    await storage.set(storageKey, migrated);
    return migrated;
  }

  if (isV1UserSettings(persisted)) {
    const migrated = {
      schemaVersion: SCHEMA_VERSION,
      settingsVersion: 1,
      settings: { ...persisted, debugMode: false, useMockModel: false },
    } satisfies PersistedSettings;
    await storage.set(storageKey, migrated);
    return migrated;
  }

  if (isUserSettings(persisted)) {
    const migrated = {
      schemaVersion: SCHEMA_VERSION,
      settingsVersion: 1,
      settings: persisted,
    } satisfies PersistedSettings;
    await storage.set(storageKey, migrated);
    return migrated;
  }

  if (persisted !== undefined) {
    await storage.remove(storageKey);
  }

  return undefined;
}

export async function readSettingsForMutation(
  storage: StorageArea,
  storageKey: string = SETTINGS_STORAGE_KEY,
): Promise<UserSettings> {
  return (
    (await readPersistedSettingsForMutation(storage, storageKey))?.settings ??
    DEFAULT_SETTINGS
  );
}

async function persistSettings(
  storage: StorageArea,
  storageKey: string,
  settings: UserSettings,
): Promise<UserSettings> {
  await validatePlatformOverridesForGlobal(storage, settings);

  const previous = await readPersistedSettingsForMutation(storage, storageKey);
  const settingsVersion =
    previous && settingsAreEqual(previous.settings, settings)
      ? previous.settingsVersion
      : incrementSettingsVersion(previous?.settingsVersion ?? 0);

  await storage.set(storageKey, {
    schemaVersion: SCHEMA_VERSION,
    settingsVersion,
    settings,
  } satisfies PersistedSettings);

  return settings;
}

export class SettingsRepository {
  constructor(
    private readonly storage: StorageArea,
    private readonly storageKey = SETTINGS_STORAGE_KEY,
  ) {}

  async get(): Promise<UserSettings> {
    return runWithSettingsMutationLock(() =>
      readSettingsForMutation(this.storage, this.storageKey),
    );
  }

  async getVersion(): Promise<number> {
    return runWithSettingsMutationLock(async () => {
      return (
        (await readPersistedSettingsForMutation(this.storage, this.storageKey))
          ?.settingsVersion ?? 0
      );
    });
  }

  async save(settings: UserSettings): Promise<UserSettings> {
    assertUserSettings(settings);

    return runWithSettingsMutationLock(() =>
      persistSettings(this.storage, this.storageKey, settings),
    );
  }

  /** Atomically applies a validated partial update to the persisted settings. */
  async patch(update: Partial<UserSettings>): Promise<UserSettings> {
    return runWithSettingsMutationLock(async () => {
      const current =
        (await readPersistedSettingsForMutation(this.storage, this.storageKey))
          ?.settings ?? DEFAULT_SETTINGS;
      const settings = { ...current, ...update };
      assertUserSettings(settings);

      return persistSettings(this.storage, this.storageKey, settings);
    });
  }

  async reset(): Promise<UserSettings> {
    return this.save(DEFAULT_SETTINGS);
  }
}
