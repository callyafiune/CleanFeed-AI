import { DEFAULT_SETTINGS } from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";
import type { BackendPreference, UserSettings } from "@/shared/settings-types";
import { validateThresholds } from "@/shared/validation";
import type { StorageArea } from "@/storage/storage-area";

export const SETTINGS_STORAGE_KEY = "cleanfeed.settings.v1";
const SCHEMA_VERSION = 1;

interface PersistedSettings {
  schemaVersion: typeof SCHEMA_VERSION;
  settingsVersion: number;
  settings: UserSettings;
}

const booleanKeys = [
  "enabled",
  "processVisibleOnly",
  "experimentalShortTextDetection",
  "manualAnalysisEnabled",
  "showScore",
  "showExplanation",
  "webGpuEnabled",
  "wasmEnabled",
  "batchingEnabled",
  "historyEnabled",
  "storeFullText",
] as const;

const positiveIntegerKeys = [
  "wasmConcurrency",
  "webGpuConcurrency",
  "maximumQueueSize",
  "maximumPostsPerMinute",
  "chunkSizeTokens",
  "maximumTokens",
  "inferenceTimeoutMs",
  "cacheMaximumEntries",
  "cacheTtlMs",
  "historyRetentionDays",
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
    !isFiniteIntegerInRange(value.minimumWordCount, 50, 5_000) ||
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

  const chunkSizeTokens = value.chunkSizeTokens;
  const chunkOverlapTokens = value.chunkOverlapTokens;
  const maximumTokens = value.maximumTokens;
  if (
    !positiveIntegerKeys.every((key) =>
      isFiniteIntegerInRange(value[key], 1, Number.MAX_SAFE_INTEGER),
    ) ||
    !isFiniteIntegerInRange(chunkOverlapTokens, 0, Number.MAX_SAFE_INTEGER) ||
    !isFiniteIntegerInRange(chunkSizeTokens, 1, Number.MAX_SAFE_INTEGER) ||
    !isFiniteIntegerInRange(maximumTokens, 1, Number.MAX_SAFE_INTEGER) ||
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

function isPersistedSettings(value: unknown): value is PersistedSettings {
  return (
    isRecord(value) &&
    value.schemaVersion === SCHEMA_VERSION &&
    isFiniteIntegerInRange(value.settingsVersion, 0, Number.MAX_SAFE_INTEGER) &&
    isUserSettings(value.settings)
  );
}

function settingsAreEqual(left: UserSettings, right: UserSettings): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>).every(
    (key) => left[key] === right[key],
  );
}

export function assertUserSettings(
  value: unknown,
): asserts value is UserSettings {
  if (!isUserSettings(value)) {
    invalidSettings();
  }
}

export class SettingsRepository {
  constructor(
    private readonly storage: StorageArea,
    private readonly storageKey = SETTINGS_STORAGE_KEY,
  ) {}

  async get(): Promise<UserSettings> {
    const persisted = await this.storage.get<unknown>(this.storageKey);
    if (isPersistedSettings(persisted)) {
      return persisted.settings;
    }

    if (isUserSettings(persisted)) {
      await this.storage.set(this.storageKey, {
        schemaVersion: SCHEMA_VERSION,
        settingsVersion: 1,
        settings: persisted,
      } satisfies PersistedSettings);
      return persisted;
    }

    return DEFAULT_SETTINGS;
  }

  async save(settings: UserSettings): Promise<UserSettings> {
    assertUserSettings(settings);

    const persisted = await this.storage.get<unknown>(this.storageKey);
    const previous = isPersistedSettings(persisted) ? persisted : undefined;
    const settingsVersion =
      previous && settingsAreEqual(previous.settings, settings)
        ? previous.settingsVersion
        : (previous?.settingsVersion ?? 0) + 1;

    await this.storage.set(this.storageKey, {
      schemaVersion: SCHEMA_VERSION,
      settingsVersion,
      settings,
    } satisfies PersistedSettings);

    return settings;
  }

  async reset(): Promise<UserSettings> {
    return this.save(DEFAULT_SETTINGS);
  }
}
