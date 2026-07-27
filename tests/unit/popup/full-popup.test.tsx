import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App, type PopupApi } from "@/popup/App";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ModelStatus, PageStats } from "@/shared/types";

const fullStats: PageStats = {
  platform: "linkedin",
  postsFound: 12,
  analyzed: 9,
  skippedByLength: 2,
  skippedByLanguage: 1,
  marked: 4,
  blurred: 2,
  collapsed: 1,
  hidden: 1,
  restored: 3,
  averageInferenceMs: 18,
  queueSize: 2,
};

const readyStatus: ModelStatus = {
  state: "ready",
  backend: "wasm",
  runtimeIdentity: {
    kind: "bundle",
    modelId: "mock-classifier",
    modelVersion: "1.2.3",
    bundleDigest: "a".repeat(64),
    tokenizerDigest: "b".repeat(64),
    aggregationVersion: "tmr-aggregation-v3",
    contentCompositionVersion: "lexical-content-v2",
    calibrationSetDigest:
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
  },
  calibrationCoverage: "none",
  calibrationSetDigest: null,
  profileCount: 0,
  earliestExpiry: null,
  reasonCodes: [],
};

function fakePopupApi(overrides: Partial<PopupApi> = {}): PopupApi {
  return {
    getPageStats: vi.fn().mockResolvedValue(fullStats),
    getModelStatus: vi.fn().mockResolvedValue(readyStatus),
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    getActiveHost: vi.fn().mockResolvedValue("www.linkedin.com"),
    isDomainPaused: vi.fn().mockResolvedValue(false),
    setEnabled: vi.fn().mockResolvedValue(undefined),
    pauseDomain: vi.fn().mockResolvedValue(undefined),
    resumeDomain: vi.fn().mockResolvedValue(undefined),
    clearPagePresentation: vi.fn().mockResolvedValue(undefined),
    openOptions: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("full popup", () => {
  afterEach(cleanup);

  it("renders all requested counters and model state", async () => {
    render(<App api={fakePopupApi()} />);

    for (const label of [
      "Encontrados",
      "Analisados",
      "Ignorados por tamanho",
      "Ignorados por idioma",
      "Marcados",
      "Desfocados",
      "Recolhidos",
      "Ocultados",
      "Restaurados",
      "Latência média",
      "Fila",
      "Não analisados (rolagem/filtros)",
      "Modelo",
      "Backend",
      "Estado",
    ]) {
      expect(await screen.findByText(label)).toBeVisible();
    }
    // The long revision SHA is intentionally not shown on the compact card.
    expect(screen.queryByText("Versão")).toBeNull();
  });

  it("pauses only the current hostname and can clear page presentation", async () => {
    const api = fakePopupApi();
    render(<App api={api} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Pausar neste site" }),
    );
    expect(api.pauseDomain).toHaveBeenCalledWith("www.linkedin.com");

    fireEvent.click(
      screen.getByRole("button", { name: "Limpar resultados visuais" }),
    );
    expect(api.clearPagePresentation).toHaveBeenCalledOnce();
  });

  it("shows the demonstration warning as the first region after the title", async () => {
    render(<App api={fakePopupApi()} />);

    const title = screen.getByRole("heading", { name: "CleanFeed AI" });
    const warning = await screen.findByText(
      "Modo de demonstração: nenhum modelo real está sendo utilizado.",
    );
    expect(warning).toBeVisible();
    expect(
      title.compareDocumentPosition(warning) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("shows only the hostname, never a full URL", async () => {
    render(<App api={fakePopupApi()} />);

    expect(await screen.findByText("www.linkedin.com")).toBeVisible();
    expect(document.body.textContent).not.toMatch(/https?:\/\//u);
  });

  it("explains an unsupported platform without a technical error", async () => {
    const api = fakePopupApi({
      getPageStats: vi.fn().mockResolvedValue(null),
      getActiveHost: vi.fn().mockResolvedValue("example.com"),
    });
    render(<App api={api} />);

    expect(await screen.findByText("Plataforma não suportada")).toBeVisible();
    expect(screen.queryByText(/erro|Error|undefined/u)).toBeNull();
  });

  it("toggles the extension off through the general control", async () => {
    const api = fakePopupApi();
    render(<App api={api} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Desativar CleanFeed" }),
    );
    expect(api.setEnabled).toHaveBeenCalledWith(false);
  });

  it("resumes a site that is already paused", async () => {
    const api = fakePopupApi({
      isDomainPaused: vi.fn().mockResolvedValue(true),
    });
    render(<App api={api} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Retomar neste site" }),
    );
    expect(api.resumeDomain).toHaveBeenCalledWith("www.linkedin.com");
  });

  it("surfaces a recoverable action error in a status region", async () => {
    const api = fakePopupApi({
      clearPagePresentation: vi.fn().mockRejectedValue(new Error("boom")),
    });
    render(<App api={api} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Limpar resultados visuais" }),
    );

    expect(
      await screen.findByText(
        "Não foi possível restaurar os posts nesta página.",
      ),
    ).toBeVisible();
    // The technical error text is never shown to the user.
    expect(document.body.textContent).not.toMatch(/boom/u);
  });
});
