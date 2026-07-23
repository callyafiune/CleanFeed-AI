import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App as OptionsApp, type OptionsApi } from "@/options/App";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ModelDiagnosticsView } from "@/shared/diagnostic-types";
import {
  createBuiltinRuntimeIdentity,
  createBundleRuntimeIdentity,
  createModelStatus,
} from "../../helpers/model-fixtures";

const CALIBRATION_SET_DIGEST = "9".repeat(64);

const bundleView: ModelDiagnosticsView = {
  status: createModelStatus({
    backend: "wasm",
    runtimeIdentity: createBundleRuntimeIdentity({ modelVersion: "1.0.0" }),
    calibrationCoverage: "partial",
    calibrationSetDigest: CALIBRATION_SET_DIGEST,
    profileCount: 2,
    earliestExpiry: "2027-01-15T00:00:00.000Z",
  }),
  release: { gateDecision: "indicator-only", rolloutState: "indicator" },
};

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

    // Each region is a labelled fieldset (legend = accessible group name),
    // giving the same navigable structure the old section headings provided.
    for (const name of [
      "Geral",
      "Plataformas",
      "Desempenho",
      "Privacidade",
      "Avançado",
    ]) {
      expect(await screen.findByRole("group", { name })).toBeVisible();
    }
  });

  it("still shows the local, probabilistic disclosures", async () => {
    render(<OptionsApp api={fakeOptionsApi()} />);

    await screen.findByRole("group", { name: "Privacidade" });
    expect(document.body.textContent).not.toMatch(
      /foi escrito por IA|comprovadamente artificial/u,
    );
  });

  it("exposes an opt-in, off-by-default technical score toggle in Avançado", async () => {
    const api = fakeOptionsApi();
    render(<OptionsApp api={api} />);

    await screen.findByRole("group", { name: "Avançado" });
    const toggle = screen.getByLabelText(
      "Exibir score técnico no diagnóstico avançado",
    );
    // DEFAULT_SETTINGS.showScore is false: the diagnostic score is opt-in.
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);
    expect(api.updateSettings).toHaveBeenCalledWith({ showScore: true });
  });

  it("clarifies the technical score never enters the feed and is not authorship probability", async () => {
    render(<OptionsApp api={fakeOptionsApi()} />);

    await screen.findByRole("group", { name: "Avançado" });
    expect(
      screen.getByText(
        /não aparece no selo.*não equivale à probabilidade real de autoria/su,
      ),
    ).toBeVisible();
  });

  it("offers the four presentation modes and never a threshold label", async () => {
    render(<OptionsApp api={fakeOptionsApi()} />);

    const select = await screen.findByLabelText("Apresentação");
    const labels = Array.from(
      select.querySelectorAll("option"),
      (option) => option.textContent,
    );
    expect(labels).toEqual([
      "Apenas indicador",
      "Desfocar",
      "Recolher",
      "Ocultar",
    ]);
    expect(screen.queryByLabelText(/Limiar/u)).toBeNull();
  });

  it("reveals the experimental marking threshold ONLY when the preview is enabled", async () => {
    // Off by default: the calibrated/normal surface never exposes a threshold.
    const { unmount } = render(<OptionsApp api={fakeOptionsApi()} />);
    await screen.findByRole("group", { name: "Avançado" });
    expect(
      screen.queryByLabelText("Limiar de marcação experimental (%)"),
    ).toBeNull();
    unmount();

    // Enabled: the field appears so the user can tune the provisional cut.
    render(
      <OptionsApp
        api={fakeOptionsApi({
          getSettings: vi.fn().mockResolvedValue({
            ...DEFAULT_SETTINGS,
            experimentalUncalibratedTmr: true,
          }),
        })}
      />,
    );
    expect(
      await screen.findByLabelText("Limiar de marcação experimental (%)"),
    ).toBeVisible();
  });

  it("shows the ceiling-only presentation note", async () => {
    render(<OptionsApp api={fakeOptionsApi()} />);

    await screen.findByLabelText("Apresentação");
    expect(
      screen.getByText(
        "A escolha define somente como apresentar um resultado autorizado. O perfil calibrado pode reduzir esta ação, nunca aumentá-la.",
      ),
    ).toBeVisible();
  });

  it("submits a chosen presentation mode through updateSettings", async () => {
    const api = fakeOptionsApi();
    render(<OptionsApp api={api} />);

    fireEvent.change(await screen.findByLabelText("Apresentação"), {
      target: { value: "hide" },
    });
    expect(api.updateSettings).toHaveBeenCalledWith({
      presentationMode: "hide",
    });
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

  it("surfaces the scientific decision, rollout and calibration coverage in the model card", async () => {
    const api = fakeOptionsApi({
      getModelDiagnostics: vi.fn().mockResolvedValue(bundleView),
    });
    render(<OptionsApp api={api} />);

    // Rollout state (from the descriptor) is distinct from the gate decision.
    expect(await screen.findByText("Avisos autorizados")).toBeVisible();
    expect(screen.getByText("Autorizado somente para avisos")).toBeVisible();
    expect(screen.getByText("Cobertura parcial de calibração")).toBeVisible();
  });

  it("formats the earliest profile expiry in pt-BR and never leaks the calibration digest", async () => {
    const api = fakeOptionsApi({
      getModelDiagnostics: vi.fn().mockResolvedValue(bundleView),
    });
    render(<OptionsApp api={api} />);

    const expectedExpiry = new Intl.DateTimeFormat("pt-BR", {
      dateStyle: "medium",
      timeZone: "UTC",
    }).format(new Date("2027-01-15T00:00:00.000Z"));
    expect(await screen.findByText(expectedExpiry)).toBeVisible();
    // The set digest is a technical field for the advanced diagnostic export,
    // never a value on the read-only cards.
    expect(document.body.textContent).not.toContain(CALIBRATION_SET_DIGEST);
  });

  it("shows an empty-profile expiry as a plain-language note", async () => {
    const api = fakeOptionsApi({
      getModelDiagnostics: vi.fn().mockResolvedValue({
        status: createModelStatus({
          calibrationCoverage: "none",
          earliestExpiry: null,
        }),
        release: { gateDecision: "pending", rolloutState: "bundle-verified" },
      } satisfies ModelDiagnosticsView),
    });
    render(<OptionsApp api={api} />);

    expect(await screen.findByText("Nenhum perfil aplicável")).toBeVisible();
    expect(
      screen.getByText(
        "Sem perfil aplicável; o detector se abstém e o fallback local pode apenas indicar.",
      ),
    ).toBeVisible();
  });

  it("distinguishes the stylometric fallback from the descriptor rollout", async () => {
    const api = fakeOptionsApi({
      getModelDiagnostics: vi.fn().mockResolvedValue({
        status: createModelStatus({
          runtimeIdentity: createBuiltinRuntimeIdentity({
            modelId: "stylometric",
          }),
          calibrationCoverage: "none",
        }),
        release: { gateDecision: "reject", rolloutState: "bundle-verified" },
      } satisfies ModelDiagnosticsView),
    });
    render(<OptionsApp api={api} />);

    expect(
      await screen.findByText("Fallback estilométrico ativo"),
    ).toBeVisible();
    expect(
      screen.getByText("Bundle verificado; inativo no feed"),
    ).toBeVisible();
  });

  it("surfaces the circuit-breaker degraded state in the model card", async () => {
    const api = fakeOptionsApi({
      getModelDiagnostics: vi.fn().mockResolvedValue({
        status: createModelStatus({
          reasonCodes: ["CIRCUIT_BREAKER_OPEN"],
        }),
        release: { gateDecision: "pass", rolloutState: "actions" },
      } satisfies ModelDiagnosticsView),
    });
    render(<OptionsApp api={api} />);

    expect(
      await screen.findByText(
        "Detector temporariamente desativado; usando fallback local.",
      ),
    ).toBeVisible();
  });

  it("still renders the settings sections when the diagnostics view fails to load", async () => {
    const api = fakeOptionsApi({
      getModelDiagnostics: vi.fn().mockRejectedValue(new Error("offline")),
    });
    render(<OptionsApp api={api} />);

    // A diagnostics failure must not block editing settings.
    expect(
      await screen.findByRole("group", { name: "Avançado" }),
    ).toBeVisible();
    const toggle = screen.getByLabelText(
      "Exibir score técnico no diagnóstico avançado",
    );
    fireEvent.click(toggle);
    expect(api.updateSettings).toHaveBeenCalledWith({ showScore: true });
  });
});
