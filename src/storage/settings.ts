import {
  DEFAULT_SETTINGS,
  MAX_PLATFORM_ID_LENGTH,
  SETTINGS_LIMITS,
  SETTINGS_STORAGE_KEYS,
} from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";
import type { BackendPreference, UserSettings } from "@/shared/settings-types";
import { runWithSettingsMutationLock } from "@/storage/settings-lock";
import type { StorageArea } from "@/storage/storage-area";

export const SETTINGS_STORAGE_KEY = SETTINGS_STORAGE_KEYS.global;
const SCHEMA_VERSION = 5;
const PLATFORM_SCHEMA_VERSION = 1;

/**
 * The four decision-threshold keys removed in schema v4. Scientific thresholds
 * now live ONLY in the calibration profile; the user settings surface never
 * carries them. This closed list drives both the v3→v4 migration and the
 * stripping of legacy platform overrides — it is the single source of truth.
 */
export const LEGACY_THRESHOLD_KEYS = [
  "markingThreshold",
  "blurThreshold",
  "collapseThreshold",
  "hideThreshold",
] as const;

/** Removes the legacy threshold keys from a settings-shaped record. */
export function withoutLegacyThresholds(
  value: object,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...value };
  for (const key of LEGACY_THRESHOLD_KEYS) {
    delete result[key];
  }
  return result;
}

/**
 * Fields introduced in schema v5. Every pre-v5 record lacks them and gains their
 * default on migration. The historical shape checks anchor on the FIXED pre-v5
 * key set below (never the mutable DEFAULT_SETTINGS), so adding more fields later
 * cannot silently invalidate a genuine v1–v4 record.
 */
const V5_ADDED_KEYS = ["experimentalUncalibratedTmr"] as const;
const V5_ADDED_DEFAULTS = Object.fromEntries(
  V5_ADDED_KEYS.map((key) => [key, DEFAULT_SETTINGS[key]]),
) as Pick<UserSettings, (typeof V5_ADDED_KEYS)[number]>;
const PRE_V5_SETTING_KEYS = (
  Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>
).filter((key) => !(V5_ADDED_KEYS as readonly string[]).includes(key));

/** Completes a schema-v4-shaped record to the current shape with v5 defaults. */
function completeToCurrent(v4Shaped: Record<string, unknown>): UserSettings {
  return { ...v4Shaped, ...V5_ADDED_DEFAULTS } as unknown as UserSettings;
}

interface PersistedSettings {
  schemaVersion: typeof SCHEMA_VERSION;
  settingsVersion: number;
  settings: UserSettings;
}

type LegacyThresholdRecord = Record<
  (typeof LEGACY_THRESHOLD_KEYS)[number],
  number
>;
/** The schema-v4 settings shape: the current settings minus the v5 additions. */
type V4UserSettings = Omit<UserSettings, (typeof V5_ADDED_KEYS)[number]>;
/** The v3 (pre-threshold-removal) shape: v4 settings plus the four thresholds. */
type V3UserSettings = V4UserSettings & LegacyThresholdRecord;
type V2UserSettings = Omit<V3UserSettings, "useMockModel">;
type V1UserSettings = Omit<V3UserSettings, "debugMode" | "useMockModel">;

const booleanKeys = [
  "enabled",
  "processVisibleOnly",
  "experimentalShortTextDetection",
  "experimentalUncalibratedTmr",
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

  return true;
}

/** The four legacy thresholds must be finite, within [0,1] and non-decreasing. */
function hasOrderedLegacyThresholds(value: Record<string, unknown>): boolean {
  const values = LEGACY_THRESHOLD_KEYS.map((key) => value[key]);
  if (
    !values.every((item) => typeof item === "number" && item >= 0 && item <= 1)
  ) {
    return false;
  }
  const [marking, blur, collapse, hide] = values as number[];
  return marking! <= blur! && blur! <= collapse! && collapse! <= hide!;
}

/**
 * A schema-v4 record: the current settings minus the v5 additions. Recognized by
 * the ABSENCE of every v5 key plus validity once the v5 defaults are filled in.
 */
function isV4UserSettings(value: unknown): value is V4UserSettings {
  if (!isRecord(value)) {
    return false;
  }
  if (V5_ADDED_KEYS.some((key) => Object.hasOwn(value, key))) {
    return false;
  }
  return isUserSettings({ ...value, ...V5_ADDED_DEFAULTS });
}

/** Validates the FULL v3 shape (v4 keys plus the four ordered thresholds). */
function isV3UserSettings(value: unknown): value is V3UserSettings {
  if (!isRecord(value)) {
    return false;
  }
  const expected = new Set<string>([
    ...PRE_V5_SETTING_KEYS,
    ...LEGACY_THRESHOLD_KEYS,
  ]);
  if (
    Object.keys(value).length !== expected.size ||
    ![...expected].every((key) => Object.hasOwn(value, key))
  ) {
    return false;
  }
  return (
    hasOrderedLegacyThresholds(value) &&
    isV4UserSettings(withoutLegacyThresholds(value))
  );
}

function isV2UserSettings(value: unknown): value is V2UserSettings {
  if (!isRecord(value) || Object.hasOwn(value, "useMockModel")) {
    return false;
  }
  return isV3UserSettings({ ...value, useMockModel: false });
}

function isV1UserSettings(value: unknown): value is V1UserSettings {
  if (
    !isRecord(value) ||
    Object.hasOwn(value, "debugMode") ||
    Object.hasOwn(value, "useMockModel")
  ) {
    return false;
  }
  return isV3UserSettings({ ...value, debugMode: false, useMockModel: false });
}

function isPersistedSettings(value: unknown): value is PersistedSettings {
  return (
    isRecord(value) &&
    value.schemaVersion === SCHEMA_VERSION &&
    isFiniteIntegerInRange(value.settingsVersion, 0, Number.MAX_SAFE_INTEGER) &&
    isUserSettings(value.settings)
  );
}

function hasVersionedEnvelope(
  value: unknown,
  schemaVersion: number,
): value is {
  schemaVersion: number;
  settingsVersion: number;
  settings: unknown;
} {
  return (
    isRecord(value) &&
    value.schemaVersion === schemaVersion &&
    isFiniteIntegerInRange(value.settingsVersion, 0, Number.MAX_SAFE_INTEGER)
  );
}

function settingsAreEqual(left: UserSettings, right: UserSettings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>).every(
    (key) => left[key] === right[key],
  );
}

/** The overriding fields of a platform record: no platformId, no legacy thresholds. */
function getPlatformOverrides(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return withoutLegacyThresholds(
    Object.fromEntries(
      Object.entries(value).filter(([key]) => key !== "platformId"),
    ),
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

  // Legacy thresholds are strippable, not "unknown": a platform record may still
  // carry them from v3 and its surviving overrides stay valid.
  const allowedKeys = new Set([
    "platformId",
    ...Object.keys(DEFAULT_SETTINGS),
    ...LEGACY_THRESHOLD_KEYS,
  ]);
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

async function storeMigrated(
  storage: StorageArea,
  storageKey: string,
  settingsVersion: number,
  settings: UserSettings,
): Promise<PersistedSettings> {
  const migrated = {
    schemaVersion: SCHEMA_VERSION,
    settingsVersion,
    settings,
  } satisfies PersistedSettings;
  await storage.set(storageKey, migrated);
  return migrated;
}

async function readPersistedSettingsForMutation(
  storage: StorageArea,
  storageKey: string = SETTINGS_STORAGE_KEY,
): Promise<PersistedSettings | undefined> {
  const persisted = await storage.get<unknown>(storageKey);
  if (isPersistedSettings(persisted)) {
    return persisted;
  }

  // Versioned v4 envelope (the immediate predecessor): fill the v5 defaults.
  if (
    hasVersionedEnvelope(persisted, 4) &&
    isV4UserSettings(persisted.settings)
  ) {
    return storeMigrated(
      storage,
      storageKey,
      persisted.settingsVersion,
      completeToCurrent(persisted.settings),
    );
  }

  // Versioned v3 envelope: validate the whole v3 shape, then drop the thresholds.
  if (
    hasVersionedEnvelope(persisted, 3) &&
    isV3UserSettings(persisted.settings)
  ) {
    return storeMigrated(
      storage,
      storageKey,
      persisted.settingsVersion,
      completeToCurrent(withoutLegacyThresholds(persisted.settings)),
    );
  }

  if (
    hasVersionedEnvelope(persisted, 2) &&
    isV2UserSettings(persisted.settings)
  ) {
    return storeMigrated(
      storage,
      storageKey,
      persisted.settingsVersion,
      completeToCurrent(
        withoutLegacyThresholds({
          ...persisted.settings,
          useMockModel: false,
        }),
      ),
    );
  }

  if (
    hasVersionedEnvelope(persisted, 1) &&
    isV1UserSettings(persisted.settings)
  ) {
    return storeMigrated(
      storage,
      storageKey,
      persisted.settingsVersion,
      completeToCurrent(
        withoutLegacyThresholds({
          ...persisted.settings,
          debugMode: false,
          useMockModel: false,
        }),
      ),
    );
  }

  // Bare (un-enveloped) legacy objects.
  if (isV3UserSettings(persisted)) {
    return storeMigrated(
      storage,
      storageKey,
      1,
      completeToCurrent(withoutLegacyThresholds(persisted)),
    );
  }

  if (isV2UserSettings(persisted)) {
    return storeMigrated(
      storage,
      storageKey,
      1,
      completeToCurrent(
        withoutLegacyThresholds({
          ...persisted,
          useMockModel: false,
        }),
      ),
    );
  }

  if (isV1UserSettings(persisted)) {
    return storeMigrated(
      storage,
      storageKey,
      1,
      completeToCurrent(
        withoutLegacyThresholds({
          ...persisted,
          debugMode: false,
          useMockModel: false,
        }),
      ),
    );
  }

  // Bare schema-v4 object (current keys minus the v5 additions).
  if (isV4UserSettings(persisted)) {
    return storeMigrated(storage, storageKey, 1, completeToCurrent(persisted));
  }

  if (isUserSettings(persisted)) {
    return storeMigrated(storage, storageKey, 1, persisted);
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
