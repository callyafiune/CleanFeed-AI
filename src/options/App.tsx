import { useEffect, useState } from "react";

import { AdvancedSettings } from "@/options/components/AdvancedSettings";
import { DangerZone } from "@/options/components/DangerZone";
import { GeneralSettings } from "@/options/components/GeneralSettings";
import { PerformanceSettings } from "@/options/components/PerformanceSettings";
import { PlatformSettings } from "@/options/components/PlatformSettings";
import { PrivacyNotice } from "@/options/components/PrivacyNotice";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import { parseExtensionMessage } from "@/shared/message-validation";
import type {
  PlatformSettings as PlatformSettingsValue,
  UserSettings,
} from "@/shared/settings-types";
import { ClassificationCache } from "@/storage/cache";
import { FeedbackRepository } from "@/storage/feedback";
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
}

const defaultOptionsApi = createChromeOptionsApi();

const LOAD_ERROR = "Não foi possível carregar as configurações.";
const SAVE_ERROR = "A configuração informada não é válida.";
const CLEAR_ERROR = "Não foi possível concluir a limpeza solicitada.";

export function App({ api = defaultOptionsApi }: { api?: OptionsApi }) {
  const [settings, setSettings] = useState<UserSettings>(DEFAULT_SETTINGS);
  const [platform, setPlatform] = useState<PlatformSettingsValue | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const loaded = await api.getSettings();
        if (active) setSettings(loaded);
      } catch {
        if (active) setError(LOAD_ERROR);
        return;
      }
      try {
        const loadedPlatform =
          await api.getPlatformSettings?.(LINKEDIN_PLATFORM_ID);
        if (active && loadedPlatform !== undefined) {
          setPlatform(loadedPlatform);
        }
      } catch {
        // Per-platform overrides are optional; a load failure is not fatal.
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

  const save = (change: Partial<UserSettings>) => {
    void persist({ ...settings, ...change })
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

  return (
    <main>
      <h1>CleanFeed AI</h1>

      <section aria-labelledby="general-section-heading">
        <h2 id="general-section-heading">Geral</h2>
        <GeneralSettings settings={settings} onUpdate={update} />
      </section>

      <PlatformSettings
        platform={platform}
        onReset={resetPlatform}
        onToggleEnabled={togglePlatformEnabled}
      />

      <PerformanceSettings settings={settings} onUpdate={update} />

      <PrivacyNotice>
        <DangerZone
          onClearCache={() => runClear(api.clearCache)}
          onClearFeedback={() => runClear(api.clearFeedback)}
          onClearMetrics={() => runClear(api.clearMetrics)}
        />
      </PrivacyNotice>

      <AdvancedSettings
        settings={settings}
        onReset={reset}
        onSave={save}
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
  };
}
