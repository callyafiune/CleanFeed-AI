import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App as OptionsApp, type OptionsApi } from "@/options/App";
import { DEFAULT_SETTINGS } from "@/shared/constants";

function fakeOptionsApi(overrides: Partial<OptionsApi> = {}): OptionsApi {
  return {
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    updateSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    save: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    resetSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    clearFeedback: vi.fn().mockResolvedValue(undefined),
    clearCache: vi.fn().mockResolvedValue(undefined),
    clearMetrics: vi.fn().mockResolvedValue(undefined),
    getPlatformSettings: vi.fn().mockResolvedValue(null),
    savePlatformSettings: vi.fn().mockResolvedValue({ platformId: "linkedin" }),
    resetPlatformSettings: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("options settings sections", () => {
  afterEach(cleanup);

  it("organizes the requested settings into accessible sections", async () => {
    render(<OptionsApp api={fakeOptionsApi()} />);

    for (const name of [
      "Geral",
      "Plataformas",
      "Desempenho",
      "Privacidade",
      "Avançado",
    ]) {
      expect(await screen.findByRole("heading", { name })).toBeVisible();
    }
  });

  it("still shows the local, probabilistic disclosures", async () => {
    render(<OptionsApp api={fakeOptionsApi()} />);

    await screen.findByRole("heading", { name: "Privacidade" });
    expect(document.body.textContent).not.toMatch(
      /foi escrito por IA|comprovadamente artificial/u,
    );
  });

  it("blocks inconsistent thresholds before persistence", async () => {
    const api = fakeOptionsApi();
    render(<OptionsApp api={api} />);

    fireEvent.change(await screen.findByLabelText("Limiar de desfoque"), {
      target: { value: "0.70" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(screen.getByRole("alert")).toHaveTextContent(/ordem dos limiares/u);
    expect(api.save).not.toHaveBeenCalled();
  });

  it("persists an ordered threshold set atomically on save", async () => {
    const api = fakeOptionsApi();
    render(<OptionsApp api={api} />);

    fireEvent.change(await screen.findByLabelText("Limiar de desfoque"), {
      target: { value: "0.93" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar" }));

    expect(api.save).toHaveBeenCalledTimes(1);
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({ blurThreshold: 0.93 }),
    );
  });

  it("requires explicit confirmation before clearing feedback", async () => {
    const api = fakeOptionsApi();
    render(<OptionsApp api={api} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Limpar feedback" }),
    );
    expect(api.clearFeedback).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar limpeza de feedback" }),
    );
    expect(api.clearFeedback).toHaveBeenCalledTimes(1);
  });

  it("moves focus to the confirm control when armed and restores it on cancel", async () => {
    render(<OptionsApp api={fakeOptionsApi()} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Limpar feedback" }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Confirmar limpeza de feedback" }),
    );

    fireEvent.click(
      screen.getByRole("button", { name: "Cancelar limpeza de feedback" }),
    );
    expect(document.activeElement).toBe(
      screen.getByRole("button", { name: "Limpar feedback" }),
    );
  });

  it("requires explicit confirmation before clearing cache and metrics", async () => {
    const api = fakeOptionsApi();
    render(<OptionsApp api={api} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Limpar cache" }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar limpeza de cache" }),
    );
    expect(api.clearCache).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: "Limpar métricas" }));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar limpeza de métricas" }),
    );
    expect(api.clearMetrics).toHaveBeenCalledTimes(1);
  });
});
