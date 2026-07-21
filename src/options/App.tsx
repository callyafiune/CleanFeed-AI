import { useEffect, useState } from "react";

import "./options.css";

import type {
  DiagnosticsApi,
  HistoryApi,
  ImportExportApi,
  KeywordRulesApi,
  SettingsApi,
} from "@/options/api-types";
import { AdvancedSettings } from "@/options/components/AdvancedSettings";
import { DangerZone } from "@/options/components/DangerZone";
import { GeneralSettings } from "@/options/components/GeneralSettings";
import { HistorySettings } from "@/options/components/HistorySettings";
import { ImportExportSettings } from "@/options/components/ImportExportSettings";
import { KeywordRulesSettings } from "@/options/components/KeywordRulesSettings";
import { PerformanceSettings } from "@/options/components/PerformanceSettings";
import { PlatformSettings } from "@/options/components/PlatformSettings";
import { PrivacyNotice } from "@/options/components/PrivacyNotice";
import { downloadJson } from "@/options/download";
import type { KeywordRule } from "@/rules/rule-engine";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ModelDiagnosticsView } from "@/shared/diagnostic-types";
import type { DiagnosticEnvironment } from "@/storage/diagnostics";
import { parseExtensionMessage } from "@/shared/message-validation";
import { requestModelDiagnostics } from "@/shared/model-diagnostics-client";
import type {
  PlatformSettings as PlatformSettingsValue,
  UserSettings,
} from "@/shared/settings-types";
import { ClassificationCache } from "@/storage/cache";
import { DiagnosticsRepository } from "@/storage/diagnostics";
import { FeedbackRepository } from "@/storage/feedback";
import { HISTORY_TEXT_KEY, HistoryRepository } from "@/storage/history";
import { createImportExport } from "@/storage/import-export";
import {
  KeywordRuleRepository,
  KNOWN_PLATFORM_IDS,
} from "@/storage/keyword-rules";
import { MetricsRepository } from "@/storage/metrics";
import { PlatformSettingsRepository } from "@/storage/platform-settings";
import { ChromeStorageArea } from "@/storage/storage-area";

const LINKEDIN_PLATFORM_ID = "linkedin";

export interface OptionsApi {
  getSettings(): Promise<UserSettings>;
  updateSettings(update: Partial<UserSettings>): Promise<UserSettings>;
  save?(settings: UserSettings): Promise<UserSettings>;
  resetSettings?(): Promise<UserSettings>;
  clearFeedback?(): Promise<void>;
  clearCache?(): Promise<void>;
  clearMetrics?(): Promise<void>;
  getPlatformSettings?(
    platformId: string,
  ): Promise<PlatformSettingsValue | null>;
  savePlatformSettings?(
    settings: PlatformSettingsValue,
  ): Promise<PlatformSettingsValue>;
  resetPlatformSettings?(platformId: string): Promise<void>;
  /** Namespaced settings persistence used by the sensitive history toggles. */
  settings?: SettingsApi;
  /** Personal keyword rules. */
  rules?: KeywordRulesApi;
  /** Local classification history (text-free rows). */
  history?: HistoryApi;
  /** Versioned import/export surface. */
  importExport?: ImportExportApi;
  /** Sanitized diagnostics report. */
  diagnostics?: DiagnosticsApi;
  /**
   * The sanitized diagnostics view (runtime status + descriptor rollout) shown
   * on the model card. Optional so a load failure never blocks editing settings.
   */
  getModelDiagnostics?(): Promise<ModelDiagnosticsView | null>;
}

const defaultOptionsApi = createChromeOptionsApi();

const LOAD_ERROR = "Não foi possível carregar as configurações.";
const SAVE_ERROR = "A configuração informada não é válida.";
const CLEAR_ERROR = "Não foi possível concluir a limpeza solicitada.";

export function App({ api = defaultOptionsApi }: { api?: OptionsApi }) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [platform, setPlatform] = useState<PlatformSettingsValue | null>(null);
  const [diagnostics, setDiagnostics] = useState<ModelDiagnosticsView | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    // Settings, per-platform overrides and the diagnostics view load in
    // parallel. Only a settings failure is fatal; per-platform overrides and the
    // diagnostics view degrade silently so a diagnostics failure never blocks
    // editing settings.
    void (async () => {
      const [settingsResult, platformResult, diagnosticsResult] =
        await Promise.allSettled([
          Promise.resolve(api.getSettings()),
          Promise.resolve(api.getPlatformSettings?.(LINKEDIN_PLATFORM_ID)),
          Promise.resolve(api.getModelDiagnostics?.() ?? null),
        ]);
      if (!active) return;

      if (settingsResult.status === "fulfilled") {
        setSettings(settingsResult.value);
      } else {
        setError(LOAD_ERROR);
        return;
      }
      if (
        platformResult.status === "fulfilled" &&
        platformResult.value !== undefined
      ) {
        setPlatform(platformResult.value);
      }
      if (
        diagnosticsResult.status === "fulfilled" &&
        diagnosticsResult.value != null
      ) {
        setDiagnostics(diagnosticsResult.value);
      }
    })();
    return () => {
      active = false;
    };
  }, [api]);

  const persist = (value: UserSettings): Promise<UserSettings> =>
    api.save !== undefined ? api.save(value) : api.updateSettings(value);

  const update = (change: Partial<UserSettings>) => {
    void api
      .updateSettings(change)
      .then((updated) => {
        setSettings(updated);
        setError(null);
      })
      .catch(() => setError(SAVE_ERROR));
  };

  const reset = () => {
    const run =
      api.resetSettings !== undefined
        ? api.resetSettings()
        : persist(DEFAULT_SETTINGS);
    void run
      .then((updated) => {
        setSettings(updated);
        setError(null);
      })
      .catch(() => setError(SAVE_ERROR));
  };

  const runClear = (action?: () => Promise<void>) => {
    if (action === undefined) return;
    void action()
      .then(() => setError(null))
      .catch(() => setError(CLEAR_ERROR));
  };

  const togglePlatformEnabled = (enabled: boolean) => {
    if (api.savePlatformSettings === undefined) return;
    const value: PlatformSettingsValue = {
      ...platform,
      platformId: LINKEDIN_PLATFORM_ID,
      enabled,
    };
    void api
      .savePlatformSettings(value)
      .then((saved) => {
        setPlatform(saved);
        setError(null);
      })
      .catch(() => setError(SAVE_ERROR));
  };

  const resetPlatform = () => {
    if (api.resetPlatformSettings === undefined) return;
    void api
      .resetPlatformSettings(LINKEDIN_PLATFORM_ID)
      .then(() => {
        setPlatform(null);
        setError(null);
      })
      .catch(() => setError(SAVE_ERROR));
  };

  // Persist a history-related settings change through the namespaced settings
  // API so the sensitive full-text toggle has a distinct, guarded save path.
  const saveHistorySettings = (change: Partial<UserSettings>) => {
    if (api.settings === undefined) return;
    void api.settings
      .save({ ...settings, ...change })
      .then((updated) => {
        setSettings(updated);
        setError(null);
      })
      .catch(() => setError(SAVE_ERROR));
  };

  const downloadDiagnostics = () => {
    if (api.diagnostics === undefined) return;
    void api.diagnostics
      .buildReport()
      .then((report) => downloadJson("cleanfeed-diagnostics.json", report))
      .catch(() => setError(CLEAR_ERROR));
  };

  return (
    <main>
      <h1>CleanFeed AI</h1>

      <GeneralSettings settings={settings} onUpdate={update} />

      <PlatformSettings
        platform={platform}
        onReset={resetPlatform}
        onToggleEnabled={togglePlatformEnabled}
      />

      <PerformanceSettings settings={settings} onUpdate={update} />

      {api.rules === undefined ? null : (
        <KeywordRulesSettings api={api.rules} />
      )}

      {api.history === undefined || api.settings === undefined ? null : (
        <HistorySettings
          api={api.history}
          settings={settings}
          onSaveSettings={saveHistorySettings}
        />
      )}

      {api.importExport === undefined ? null : (
        <ImportExportSettings api={api.importExport} />
      )}

      <PrivacyNotice>
        <DangerZone
          onClearCache={() => runClear(api.clearCache)}
          onClearFeedback={() => runClear(api.clearFeedback)}
          onClearMetrics={() => runClear(api.clearMetrics)}
        />
      </PrivacyNotice>

      <AdvancedSettings
        settings={settings}
        diagnostics={diagnostics}
        onDownloadDiagnostics={
          api.diagnostics === undefined ? undefined : downloadDiagnostics
        }
        onReset={reset}
        onUpdate={update}
      />

      {error === null ? null : <p role="alert">{error}</p>}
    </main>
  );
}

export function createChromeOptionsApi(): OptionsApi {
  const storage = new ChromeStorageArea();
  const feedback = new FeedbackRepository(storage);
  const metrics = new MetricsRepository(storage);
  const cache = new ClassificationCache(
    storage,
    { now: () => Date.now() },
    {
      maximumEntries: DEFAULT_SETTINGS.cacheMaximumEntries,
      ttlMs: DEFAULT_SETTINGS.cacheTtlMs,
    },
  );
  const platform = new PlatformSettingsRepository(storage);
  const keywordRules = new KeywordRuleRepository(storage);
  const history = new HistoryRepository(storage);
  const importExport = createImportExport({ storage });

  const sendSettings = async (
    type: "GET_SETTINGS" | "UPDATE_SETTINGS",
    payload: Partial<UserSettings> | undefined,
  ): Promise<UserSettings> => {
    const response = await chrome.runtime.sendMessage({
      source: "options",
      target: "background",
      type,
      payload,
    });
    const message = parseExtensionMessage(response);
    if (message.type !== "SETTINGS_RESULT") {
      throw new Error("SETTINGS_UNAVAILABLE");
    }
    return message.payload;
  };

  const readEnvironment = (): DiagnosticEnvironment => {
    const manifest = chrome.runtime.getManifest();
    return {
      version: manifest.version,
      manifestPermissions: manifest.permissions ?? [],
    };
  };

  const diagnostics = new DiagnosticsRepository({
    getSettings: () => sendSettings("GET_SETTINGS", undefined),
    getMetrics: () => metrics.get(),
    getEnvironment: readEnvironment,
    getPlatformIds: () => [...KNOWN_PLATFORM_IDS],
    // The same closed round-trip the UI uses; buildReport re-sanitizes it.
    getModelDiagnostics: async () =>
      (await requestModelDiagnostics("options")) ?? undefined,
  });

  return {
    getSettings: () => sendSettings("GET_SETTINGS", undefined),
    updateSettings: (update) => sendSettings("UPDATE_SETTINGS", update),
    save: (settings) => sendSettings("UPDATE_SETTINGS", settings),
    resetSettings: () => sendSettings("UPDATE_SETTINGS", DEFAULT_SETTINGS),
    clearFeedback: () => feedback.clear(),
    clearCache: () => cache.clear(),
    clearMetrics: () => metrics.clear(),
    async getPlatformSettings(platformId) {
      try {
        return (await platform.get(platformId)) ?? null;
      } catch {
        return null;
      }
    },
    savePlatformSettings: (settings) => platform.save(settings),
    resetPlatformSettings: (platformId) => platform.remove(platformId),
    settings: {
      save: (settings) => sendSettings("UPDATE_SETTINGS", settings),
    },
    rules: {
      list: () => keywordRules.list(),
      create: (rule: KeywordRule) => keywordRules.add(rule),
      update: (rule: KeywordRule) => keywordRules.add(rule),
      remove: (id: string) => keywordRules.remove(id),
    },
    history: {
      query: (filter) => history.query(filter),
      export: () => history.export(),
      clear: () => history.clear(),
      getTexts: () => readHistoryTexts(storage),
    },
    importExport: {
      buildExport: (selection) => importExport.buildExport(selection),
      parseImport: (input) => importExport.parseImport(input),
      previewImport: (parsed) => importExport.previewImport(parsed),
      applyImport: (preview, options) =>
        importExport.applyImport(preview, options),
    },
    diagnostics: {
      buildReport: () => diagnostics.buildReport(),
    },
    async getModelDiagnostics() {
      try {
        return await requestModelDiagnostics("options");
      } catch {
        return null;
      }
    },
  };
}

/**
 * Reads the opted-in `hash -> text` map directly from its public storage key so
 * the history table can show full text only when the user enabled that storage.
 * Returns an empty map for an absent or malformed value.
 */
async function readHistoryTexts(
  storage: ChromeStorageArea,
): Promise<Record<string, string>> {
  const value = await storage.get<unknown>(HISTORY_TEXT_KEY);
  if (
    typeof value !== "object" ||
    value === null ||
    !("texts" in value) ||
    typeof (value as { texts: unknown }).texts !== "object" ||
    (value as { texts: unknown }).texts === null
  ) {
    return {};
  }
  const texts: Record<string, string> = {};
  for (const [hash, text] of Object.entries(
    (value as { texts: Record<string, unknown> }).texts,
  )) {
    if (typeof text === "string") texts[hash] = text;
  }
  return texts;
}
