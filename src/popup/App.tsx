import { useCallback, useEffect, useState } from "react";

import { DemoWarning } from "@/popup/components/DemoWarning";
import { ExtensionStatus } from "@/popup/components/ExtensionStatus";
import { ModelStatusCard } from "@/popup/components/ModelStatusCard";
import { PageActions } from "@/popup/components/PageActions";
import { PageStatsSummary } from "@/popup/components/PageStatsSummary";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { UserSettings } from "@/shared/settings-types";
import type { ModelStatus, PageStats } from "@/shared/types";
import { DomainPauseRepository } from "@/storage/domain-pause";
import { ChromeStorageArea } from "@/storage/storage-area";

export interface PopupApi {
  getPageStats(): Promise<PageStats | null>;
  getModelStatus(): Promise<ModelStatus | null>;
  getSettings(): Promise<UserSettings | null>;
  getActiveHost(): Promise<string | null>;
  isDomainPaused(hostname: string): Promise<boolean>;
  setEnabled(enabled: boolean): Promise<void>;
  pauseDomain(hostname: string): Promise<void>;
  resumeDomain(hostname: string): Promise<void>;
  clearPagePresentation(): Promise<void>;
  openOptions(): Promise<void>;
}

const defaultPopupApi = createChromePopupApi();

const REFRESH_INTERVAL_MS = 1_000;

export function App({ api = defaultPopupApi }: { api?: PopupApi }) {
  const [stats, setStats] = useState<PageStats | null>(null);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [host, setHost] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const [pageStats, modelStatus, userSettings, activeHost] =
          await Promise.all([
            api.getPageStats(),
            api.getModelStatus(),
            api.getSettings(),
            api.getActiveHost(),
          ]);
        if (!active) return;
        setStats(pageStats);
        setStatus(modelStatus);
        setSettings(userSettings);
        setHost(activeHost);
        const domainPaused =
          activeHost === null ? false : await api.isDomainPaused(activeHost);
        if (!active) return;
        setPaused(domainPaused);
      } finally {
        if (active) setLoaded(true);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [api]);

  const runAction = useCallback(
    (key: string, action: () => Promise<void>, errorMessage: string) => {
      setPending((previous) => new Set(previous).add(key));
      setError(null);
      void action()
        .catch(() => setError(errorMessage))
        .finally(() =>
          setPending((previous) => {
            const next = new Set(previous);
            next.delete(key);
            return next;
          }),
        );
    },
    [],
  );

  const enabled = settings?.enabled ?? true;
  const supported = stats !== null;

  return (
    <main>
      <h1>CleanFeed AI</h1>
      <DemoWarning />
      <ExtensionStatus
        host={host}
        enabled={enabled}
        paused={paused}
        toggling={pending.has("enabled")}
        onToggleEnabled={() =>
          runAction(
            "enabled",
            () => api.setEnabled(!enabled),
            "Não foi possível atualizar a preferência.",
          )
        }
      />
      {stats !== null ? (
        <PageStatsSummary stats={stats} />
      ) : loaded ? (
        <p>Plataforma não suportada</p>
      ) : null}
      <ModelStatusCard status={status} />
      <PageActions
        host={host}
        paused={paused}
        supported={supported}
        pending={pending}
        onPause={() =>
          host !== null &&
          runAction(
            "pause",
            () => api.pauseDomain(host),
            "Não foi possível pausar neste site.",
          )
        }
        onResume={() =>
          host !== null &&
          runAction(
            "pause",
            () => api.resumeDomain(host),
            "Não foi possível retomar neste site.",
          )
        }
        onClear={() =>
          runAction(
            "clear",
            () => api.clearPagePresentation(),
            "Não foi possível restaurar os posts nesta página.",
          )
        }
        onOpenOptions={() =>
          runAction(
            "options",
            () => api.openOptions(),
            "Não foi possível abrir as opções.",
          )
        }
      />
      {error === null ? null : <p role="status">{error}</p>}
    </main>
  );
}

export function createChromePopupApi(): PopupApi {
  return {
    async getPageStats() {
      try {
        const response = await sendToActiveTab({
          source: "popup",
          target: "content",
          type: "GET_PAGE_STATS",
          payload: undefined,
        });
        if (response === undefined) return null;
        const message = parseExtensionMessage(response);
        return message.type === "PAGE_STATS_RESULT" ? message.payload : null;
      } catch {
        // No content script on this tab: the page is simply unsupported.
        return null;
      }
    },
    async getModelStatus() {
      try {
        const response = await chrome.runtime.sendMessage({
          source: "popup",
          target: "background",
          type: "MODEL_STATUS_REQUEST",
          payload: undefined,
        });
        const message = parseExtensionMessage(response);
        return message.type === "MODEL_STATUS_RESULT" ? message.payload : null;
      } catch {
        return null;
      }
    },
    async getSettings() {
      try {
        const response = await chrome.runtime.sendMessage({
          source: "popup",
          target: "background",
          type: "GET_SETTINGS",
          payload: undefined,
        });
        const message = parseExtensionMessage(response);
        return message.type === "SETTINGS_RESULT" ? message.payload : null;
      } catch {
        return null;
      }
    },
    async getActiveHost() {
      const tab = await activeTab();
      if (tab?.url === undefined) return null;
      try {
        return new URL(tab.url).hostname;
      } catch {
        return null;
      }
    },
    async isDomainPaused(hostname) {
      try {
        return await new DomainPauseRepository(
          new ChromeStorageArea(),
        ).isPaused(hostname);
      } catch {
        return false;
      }
    },
    async setEnabled(enabled) {
      await chrome.runtime.sendMessage({
        source: "popup",
        target: "background",
        type: "UPDATE_SETTINGS",
        payload: { enabled },
      });
    },
    async pauseDomain(hostname) {
      await chrome.runtime.sendMessage({
        source: "popup",
        target: "background",
        type: "PAUSE_DOMAIN",
        payload: { hostname, paused: true },
      });
    },
    async resumeDomain(hostname) {
      await chrome.runtime.sendMessage({
        source: "popup",
        target: "background",
        type: "PAUSE_DOMAIN",
        payload: { hostname, paused: false },
      });
    },
    async clearPagePresentation() {
      await sendToActiveTab({
        source: "popup",
        target: "content",
        type: "CLEAR_PAGE_PRESENTATION",
        payload: undefined,
      });
    },
    openOptions: () => chrome.runtime.openOptionsPage(),
  };
}

async function activeTab(): Promise<chrome.tabs.Tab | undefined> {
  return (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
}

async function sendToActiveTab(message: unknown): Promise<unknown> {
  const tab = await activeTab();
  if (tab?.id === undefined) return undefined;
  return chrome.tabs.sendMessage(tab.id, message);
}
