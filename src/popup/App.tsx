import { useEffect, useState } from "react";

import { DemoWarning } from "@/popup/components/DemoWarning";
import { PageStatsSummary } from "@/popup/components/PageStatsSummary";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { ModelStatus, PageStats } from "@/shared/types";

export interface PopupApi {
  getPageStats(): Promise<PageStats | null>;
  getModelStatus(): Promise<ModelStatus | null>;
  getActiveHost(): Promise<string | null>;
  clearPresentation(): Promise<void>;
  openOptions(): Promise<void>;
}

const defaultPopupApi = createChromePopupApi();

export function App({ api = defaultPopupApi }: { api?: PopupApi }) {
  const [stats, setStats] = useState<PageStats | null>(null);
  const [status, setStatus] = useState<ModelStatus | null>(null);
  const [host, setHost] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const refresh = () =>
      Promise.all([
        api.getPageStats(),
        api.getModelStatus(),
        api.getActiveHost(),
      ])
        .then(([pageStats, modelStatus, activeHost]) => {
          setStats(pageStats);
          setStatus(modelStatus);
          setHost(activeHost);
        })
        .catch(() =>
          setError("Não foi possível consultar o estado desta página."),
        );
    void refresh();
    const interval = setInterval(() => void refresh(), 1_000);
    return () => clearInterval(interval);
  }, [api]);

  return (
    <main>
      <h1>CleanFeed AI</h1>
      <DemoWarning />
      <p>{host ?? "Página atual indisponível"}</p>
      {stats === null ? (
        <p>Nenhuma estatística disponível nesta página.</p>
      ) : (
        <PageStatsSummary stats={stats} />
      )}
      <p>
        Modelo: {status?.classifierId ?? "indisponível"} · Versão:{" "}
        {status?.modelVersion ?? "indisponível"} · Backend:{" "}
        {status?.backend ?? "indisponível"} · Estado:{" "}
        {modelStateLabel(status?.state)}
      </p>
      {error === null ? null : <p role="alert">{error}</p>}
      <button
        type="button"
        onClick={() => {
          void api
            .clearPresentation()
            .catch(() =>
              setError("Não foi possível restaurar os posts nesta página."),
            );
        }}
      >
        Restaurar posts
      </button>
      <button type="button" onClick={() => void api.openOptions()}>
        Abrir opções
      </button>
    </main>
  );
}

function modelStateLabel(state: ModelStatus["state"] | undefined): string {
  switch (state) {
    case "initializing":
      return "inicializando";
    case "ready":
      return "pronto";
    case "error":
      return "erro";
    default:
      return "indisponível";
  }
}

export function createChromePopupApi(): PopupApi {
  return {
    async getPageStats() {
      const response = await sendToActiveTab({
        source: "popup",
        target: "content",
        type: "GET_PAGE_STATS",
        payload: undefined,
      });
      if (response === undefined) return null;
      const message = parseExtensionMessage(response);
      return message.type === "PAGE_STATS_RESULT" ? message.payload : null;
    },
    async getModelStatus() {
      const response = await chrome.runtime.sendMessage({
        source: "popup",
        target: "background",
        type: "MODEL_STATUS_REQUEST",
        payload: undefined,
      });
      const message = parseExtensionMessage(response);
      return message.type === "MODEL_STATUS_RESULT" ? message.payload : null;
    },
    async getActiveHost() {
      const tab = await activeTab();
      if (tab?.url === undefined) return null;
      return new URL(tab.url).host;
    },
    async clearPresentation() {
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
