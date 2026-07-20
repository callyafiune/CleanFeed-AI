import { SETTINGS_STORAGE_KEYS } from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";
import {
  EXPORT_SCHEMA_VERSION,
  validateExportInput,
  type ExtensionExport,
} from "@/shared/export-validation";
import type { PlatformSettings, UserSettings } from "@/shared/settings-types";
import type { Clock, HistoryEntry, StorageArea } from "@/shared/types";
import { FeedbackRepository, type FeedbackRecord } from "@/storage/feedback";
import {
  HISTORY_INDEX_KEY,
  HISTORY_TEXT_KEY,
  HISTORY_MAXIMUM_ENTRIES_RANGE,
  HistoryRepository,
  historyPageKey,
} from "@/storage/history";
import { KeywordRuleRepository } from "@/storage/keyword-rules";
import {
  SettingsRepository,
  withoutLegacyThresholds,
} from "@/storage/settings";
import type { KeywordRule } from "@/rules/rule-engine";

/**
 * Storage keys the repositories keep private. They are restated here (never
 * re-exported from those modules) so the importer can snapshot the exact keys a
 * category owns without modifying the repositories. Kept in lock-step with the
 * corresponding repository constants.
 */
const KEYWORD_RULES_STORAGE_KEY = "cleanfeed.keyword-rules.v1";
const FEEDBACK_STORAGE_KEY = "cleanfeed.feedback.v1";
const METRICS_STORAGE_KEY = "cleanfeed.metrics.v1";

/** Mirrors {@link HistoryRepository}'s internal page size. */
const HISTORY_PAGE_SIZE = 100;

/** The categories a user may include in an export or select on import. */
export type ImportCategory =
  | "settings"
  | "platformSettings"
  | "keywordRules"
  | "feedback"
  | "history"
  | "metrics";

export type ImportMode = "merge" | "replace";

/** The canonical apply order; settings first so later failures can revert it. */
const CATEGORY_ORDER: readonly ImportCategory[] = [
  "settings",
  "platformSettings",
  "keywordRules",
  "feedback",
  "history",
  "metrics",
];

export interface ExportSelection {
  includeSettings?: boolean;
  includePlatformSettings?: boolean;
  includeKeywordRules?: boolean;
  includeFeedback?: boolean;
  includeHistory?: boolean;
  includeMetrics?: boolean;
}

export interface ImportCategorySummary {
  present: boolean;
  count: number;
}

export interface ImportPreview {
  parsed: ExtensionExport;
  extensionVersion: string;
  exportedAt: string;
  categories: Record<ImportCategory, ImportCategorySummary>;
  warnings: string[];
}

export interface ApplyImportOptions {
  mode: ImportMode;
  categories: ImportCategory[];
}

export interface ImportApplyResult {
  applied: ImportCategory[];
  mode: ImportMode;
  warnings: string[];
}

export interface ImportExportOptions {
  storage: StorageArea;
  /** Defaults to `chrome.runtime.getManifest().version` when available. */
  extensionVersion?: string;
  clock?: Clock;
}

export interface ImportExport {
  buildExport(selection: ExportSelection): Promise<ExtensionExport>;
  parseImport(input: string): Promise<ExtensionExport>;
  previewImport(parsed: ExtensionExport): ImportPreview;
  applyImport(
    preview: ImportPreview,
    options: ApplyImportOptions,
  ): Promise<ImportApplyResult>;
}

/**
 * Builds the versioned import/export surface over a single {@link StorageArea}.
 *
 * - `buildExport` reads the selected categories through their repositories'
 *   public APIs, so history is text-free and cache/post-text/domain settings
 *   are never included.
 * - `parseImport` runs only the PURE {@link validateExportInput} validator; it
 *   never writes storage, so a rejected file leaves the store untouched.
 * - `previewImport` derives counts/warnings only — it compiles no regex and
 *   writes nothing.
 * - `applyImport` is a two-phase compensating transaction: it snapshots every
 *   affected storage key, re-validates, then writes each category in order;
 *   any failure restores the snapshot for EVERY category before rejecting.
 */
export function createImportExport(options: ImportExportOptions): ImportExport {
  const { storage } = options;
  const clock: Clock = options.clock ?? { now: () => Date.now() };
  const extensionVersion = options.extensionVersion ?? readManifestVersion();

  async function buildExport(
    selection: ExportSelection,
  ): Promise<ExtensionExport> {
    const includeSettings = selection.includeSettings ?? true;
    const includePlatformSettings = selection.includePlatformSettings ?? true;
    const includeKeywordRules = selection.includeKeywordRules ?? true;
    const includeFeedback = selection.includeFeedback ?? false;
    const includeHistory = selection.includeHistory ?? false;
    const includeMetrics = selection.includeMetrics ?? false;

    const value: ExtensionExport = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      extensionVersion,
      exportedAt: new Date(clock.now()).toISOString(),
    };

    if (includeSettings) {
      value.settings = await new SettingsRepository(storage).get();
    }
    if (includePlatformSettings) {
      value.platformSettings = await readPersistedPlatforms(storage);
    }
    if (includeKeywordRules) {
      value.keywordRules = await new KeywordRuleRepository(storage).list();
    }
    if (includeFeedback) {
      value.feedback = await new FeedbackRepository(storage).list();
    }
    if (includeHistory) {
      // export() returns only text-free rows, never the opted-in full text.
      value.history = (await new HistoryRepository(storage).export()).entries;
    }
    if (includeMetrics) {
      const metrics = await storage.get<unknown>(METRICS_STORAGE_KEY);
      if (metrics !== undefined) {
        value.metrics = metrics;
      }
    }

    return value;
  }

  async function parseImport(input: string): Promise<ExtensionExport> {
    const result = validateExportInput(input);
    if (!result.ok) {
      throw new CleanFeedError("INVALID_SETTINGS", result.reason);
    }
    return result.value;
  }

  function previewImport(parsed: ExtensionExport): ImportPreview {
    const warnings: string[] = [];
    if (parsed.extensionVersion !== extensionVersion) {
      warnings.push(
        `Export was created by extension version ${parsed.extensionVersion}; this build is ${extensionVersion}.`,
      );
    }

    const categories: Record<ImportCategory, ImportCategorySummary> = {
      settings: summarize(parsed.settings !== undefined ? 1 : 0),
      platformSettings: summarize(
        isRecord(parsed.platformSettings)
          ? Object.keys(parsed.platformSettings).length
          : 0,
        parsed.platformSettings !== undefined,
      ),
      keywordRules: summarize(
        Array.isArray(parsed.keywordRules) ? parsed.keywordRules.length : 0,
        parsed.keywordRules !== undefined,
      ),
      feedback: summarize(
        Array.isArray(parsed.feedback) ? parsed.feedback.length : 0,
        parsed.feedback !== undefined,
      ),
      history: summarize(
        Array.isArray(parsed.history) ? parsed.history.length : 0,
        parsed.history !== undefined,
      ),
      metrics: summarize(parsed.metrics !== undefined ? 1 : 0),
    };

    return {
      parsed,
      extensionVersion: parsed.extensionVersion,
      exportedAt: parsed.exportedAt,
      categories,
      warnings,
    };
  }

  async function applyImport(
    preview: ImportPreview,
    { mode, categories }: ApplyImportOptions,
  ): Promise<ImportApplyResult> {
    // Re-validate from scratch: never trust that the preview was not tampered
    // with between parse and apply.
    const revalidated = validateExportInput(JSON.stringify(preview.parsed));
    if (!revalidated.ok) {
      throw new CleanFeedError("INVALID_SETTINGS", revalidated.reason);
    }
    const parsed = revalidated.value;

    const requested = new Set(categories);
    const effective = CATEGORY_ORDER.filter(
      (category) =>
        requested.has(category) && categoryHasData(parsed, category),
    );

    const affectedKeys = [
      ...new Set(effective.flatMap((category) => storageKeysFor(category))),
    ];
    const snapshot = await storage.getMany<unknown>(affectedKeys);
    const presentKeys = new Set(Object.keys(snapshot));

    try {
      for (const category of effective) {
        await applyCategory(storage, parsed, category, mode);
      }
    } catch (error) {
      await restoreSnapshot(storage, affectedKeys, snapshot, presentKeys);
      throw new CleanFeedError(
        "STORAGE_ERROR",
        error instanceof Error ? error.message : "import failed",
      );
    }

    return { applied: effective, mode, warnings: preview.warnings };
  }

  return { buildExport, parseImport, previewImport, applyImport };
}

function summarize(count: number, present = count > 0): ImportCategorySummary {
  return { present, count };
}

function categoryHasData(
  parsed: ExtensionExport,
  category: ImportCategory,
): boolean {
  switch (category) {
    case "settings":
      return parsed.settings !== undefined;
    case "platformSettings":
      return isRecord(parsed.platformSettings);
    case "keywordRules":
      return Array.isArray(parsed.keywordRules);
    case "feedback":
      return Array.isArray(parsed.feedback);
    case "history":
      return Array.isArray(parsed.history);
    case "metrics":
      return parsed.metrics !== undefined;
  }
}

function storageKeysFor(category: ImportCategory): string[] {
  switch (category) {
    case "settings":
      // SettingsRepository.save re-validates and can DELETE the platform-settings
      // key as a side effect (pruning overrides incompatible with the new global
      // settings). Snapshot it too so a later failure can restore a platform blob
      // that save() removed, even when platformSettings was not itself selected.
      return [SETTINGS_STORAGE_KEYS.global, SETTINGS_STORAGE_KEYS.platform];
    case "platformSettings":
      return [SETTINGS_STORAGE_KEYS.platform];
    case "keywordRules":
      return [KEYWORD_RULES_STORAGE_KEY];
    case "feedback":
      return [FEEDBACK_STORAGE_KEY];
    case "history":
      return historyStorageKeys();
    case "metrics":
      return [METRICS_STORAGE_KEY];
  }
}

/** Every key a history write can touch, so the snapshot fully covers a clear. */
function historyStorageKeys(): string[] {
  const maxPages = Math.ceil(
    HISTORY_MAXIMUM_ENTRIES_RANGE.maximum / HISTORY_PAGE_SIZE,
  );
  const pages = Array.from({ length: maxPages }, (_, page) =>
    historyPageKey(page),
  );
  return [HISTORY_INDEX_KEY, HISTORY_TEXT_KEY, ...pages];
}

async function applyCategory(
  storage: StorageArea,
  parsed: ExtensionExport,
  category: ImportCategory,
  mode: ImportMode,
): Promise<void> {
  switch (category) {
    case "settings":
      await applySettings(storage, parsed.settings);
      return;
    case "platformSettings":
      await applyPlatformSettings(storage, parsed.platformSettings ?? {}, mode);
      return;
    case "keywordRules":
      await applyKeywordRules(storage, parsed.keywordRules ?? [], mode);
      return;
    case "feedback":
      await applyFeedback(storage, parsed.feedback ?? [], mode);
      return;
    case "history":
      await applyHistory(storage, parsed.history ?? [], mode);
      return;
    case "metrics":
      await applyMetrics(storage, parsed.metrics);
      return;
  }
}

async function applySettings(
  storage: StorageArea,
  settings: UserSettings | undefined,
): Promise<void> {
  if (settings === undefined) {
    return;
  }
  // A full settings object; merge and replace are equivalent. A v1 export still
  // carries the legacy decision thresholds, so they are dropped here before the
  // repository asserts the v4 shape. `save` rejects an ill-formed object,
  // aborting the transaction.
  await new SettingsRepository(storage).save(
    withoutLegacyThresholds(settings) as unknown as UserSettings,
  );
}

async function applyPlatformSettings(
  storage: StorageArea,
  incoming: Record<string, PlatformSettings>,
  mode: ImportMode,
): Promise<void> {
  const platforms =
    mode === "merge"
      ? { ...(await readPersistedPlatforms(storage)), ...incoming }
      : incoming;
  await storage.set(SETTINGS_STORAGE_KEYS.platform, {
    schemaVersion: 1,
    settingsVersion: 1,
    platforms,
  });
}

async function applyKeywordRules(
  storage: StorageArea,
  incoming: KeywordRule[],
  mode: ImportMode,
): Promise<void> {
  const repository = new KeywordRuleRepository(storage);
  let rules = incoming;
  if (mode === "merge") {
    const byId = new Map<string, KeywordRule>(
      (await repository.list()).map((rule) => [rule.id, rule]),
    );
    for (const rule of incoming) {
      byId.set(rule.id, rule);
    }
    rules = [...byId.values()];
  }
  await repository.save(rules);
}

async function applyFeedback(
  storage: StorageArea,
  records: FeedbackRecord[],
  mode: ImportMode,
): Promise<void> {
  const repository = new FeedbackRepository(storage);
  if (mode === "replace") {
    await repository.clear();
  }
  for (const record of records) {
    await repository.add(record);
  }
}

async function applyHistory(
  storage: StorageArea,
  entries: HistoryEntry[],
  mode: ImportMode,
): Promise<void> {
  const repository = new HistoryRepository(storage);
  if (mode === "replace") {
    await repository.clear();
  }
  for (const entry of entries) {
    // Force the write on (the user explicitly chose the history category) but
    // never provide text, so imported rows stay text-free.
    await repository.add(entry, { historyEnabled: true });
  }
}

async function applyMetrics(
  storage: StorageArea,
  metrics: unknown,
): Promise<void> {
  if (metrics === undefined) {
    return;
  }
  // Written as an opaque blob; the metrics repository self-heals a malformed
  // value on its next read.
  await storage.set(METRICS_STORAGE_KEY, metrics);
}

async function restoreSnapshot(
  storage: StorageArea,
  keys: string[],
  snapshot: Record<string, unknown>,
  presentKeys: Set<string>,
): Promise<void> {
  for (const key of keys) {
    try {
      if (presentKeys.has(key)) {
        await storage.set(key, snapshot[key]);
      } else {
        await storage.remove(key);
      }
    } catch {
      // Best-effort compensation: keep restoring the remaining keys.
    }
  }
}

async function readPersistedPlatforms(
  storage: StorageArea,
): Promise<Record<string, PlatformSettings>> {
  const raw = await storage.get<unknown>(SETTINGS_STORAGE_KEYS.platform);
  if (isRecord(raw) && isRecord(raw.platforms)) {
    return raw.platforms as Record<string, PlatformSettings>;
  }
  return {};
}

function readManifestVersion(): string {
  try {
    const runtime = (
      globalThis as {
        chrome?: { runtime?: { getManifest?: () => { version?: string } } };
      }
    ).chrome?.runtime;
    return runtime?.getManifest?.().version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
