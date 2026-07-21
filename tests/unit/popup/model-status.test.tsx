import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App, type PopupApi } from "@/popup/App";
import type { ModelDiagnosticsView } from "@/shared/diagnostic-types";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ModelStatus, PageStats } from "@/shared/types";
import {
  createBuiltinRuntimeIdentity,
  createBundleRuntimeIdentity,
  createModelStatus,
} from "../../helpers/model-fixtures";

const stats: PageStats = {
  platform: "linkedin",
  postsFound: 5,
  analyzed: 4,
  skippedByLength: 0,
  skippedByLanguage: 0,
  marked: 1,
  blurred: 0,
  collapsed: 0,
  hidden: 0,
  restored: 0,
  averageInferenceMs: 20,
  queueSize: 3,
};

/**
 * A ready bundle-backed status carrying full calibration coverage. Individual
 * tests override the runtime status inside the diagnostics view to exercise the
 * degraded, fallback and calibration-coverage branches.
 */
const readyStatus: ModelStatus = createModelStatus({
  backend: "wasm",
  runtimeIdentity: createBundleRuntimeIdentity({ modelVersion: "1.0.0" }),
  calibrationCoverage: "complete",
  profileCount: 3,
  earliestExpiry: "2027-01-15T00:00:00.000Z",
});

const readyDiagnostics: ModelDiagnosticsView = {
  status: readyStatus,
  release: { gateDecision: "pass", rolloutState: "actions" },
};

function fakePopupApi(): PopupApi {
  return {
    getPageStats: vi.fn().mockResolvedValue(stats),
    getModelStatus: vi.fn().mockResolvedValue(readyStatus),
    getModelDiagnostics: vi.fn().mockResolvedValue(readyDiagnostics),
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    getActiveHost: vi.fn().mockResolvedValue("www.linkedin.com"),
    isDomainPaused: vi.fn().mockResolvedValue(false),
    setEnabled: vi.fn().mockResolvedValue(undefined),
    pauseDomain: vi.fn().mockResolvedValue(undefined),
    resumeDomain: vi.fn().mockResolvedValue(undefined),
    clearPagePresentation: vi.fn().mockResolvedValue(undefined),
    openOptions: vi.fn().mockResolvedValue(undefined),
  };
}

function valueFor(label: string): string | undefined {
  return screen
    .getByText(label)
    .parentElement?.querySelector("dd")
    ?.textContent?.trim();
}

describe("popup model status", () => {
  afterEach(cleanup);

  it("shows queue size, model version, backend and readiness", async () => {
    render(<App api={fakePopupApi()} />);

    expect(await screen.findByText("Estado")).toBeVisible();
    expect(valueFor("Fila")).toBe("3");
    expect(valueFor("Versão")).toBe("1.0.0");
    expect(valueFor("Backend")).toBe("wasm");
    expect(valueFor("Estado")).toBe("pronto");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it.each([
    ["bundle-verified", "pending", "Bundle verificado; inativo no feed"],
    ["shadow", "pass", "Modo sombra; sem apresentação"],
    ["indicator", "indicator-only", "Avisos autorizados"],
    ["actions", "pass", "Ações visuais autorizadas"],
  ] as const)(
    "renders rollout %s with decision %s as %s",
    async (rolloutState, gateDecision, label) => {
      const api = fakePopupApi();
      vi.mocked(api.getModelDiagnostics!).mockResolvedValue({
        status: readyStatus,
        release: {
          gateDecision,
          rolloutState,
        },
      });
      render(<App api={api} />);
      expect(await screen.findByText(label)).toBeVisible();
    },
  );

  it("renders builtin fallback separately from descriptor rollout", async () => {
    const api = fakePopupApi();
    vi.mocked(api.getModelDiagnostics!).mockResolvedValue({
      status: {
        ...readyStatus,
        runtimeIdentity: createBuiltinRuntimeIdentity({
          modelId: "stylometric",
        }),
        calibrationCoverage: "none",
      },
      release: { gateDecision: "reject", rolloutState: "bundle-verified" },
    });
    render(<App api={api} />);
    expect(
      await screen.findByText("Fallback estilométrico ativo"),
    ).toBeVisible();
    expect(
      screen.getByText("Bundle verificado; inativo no feed"),
    ).toBeVisible();
  });

  it.each([
    [
      "none",
      "Sem perfil aplicável; o TMR se abstém e o fallback local pode apenas indicar.",
    ],
    ["partial", "Cobertura parcial de calibração"],
    ["complete", "Cobertura completa de calibração"],
  ] as const)(
    "surfaces calibration coverage %s",
    async (calibrationCoverage, label) => {
      const api = fakePopupApi();
      vi.mocked(api.getModelDiagnostics!).mockResolvedValue({
        status: { ...readyStatus, calibrationCoverage },
        release: { gateDecision: "pass", rolloutState: "actions" },
      });
      render(<App api={api} />);
      expect(await screen.findByText(label)).toBeVisible();
    },
  );

  it("surfaces the circuit-breaker degraded state as a status message", async () => {
    const api = fakePopupApi();
    vi.mocked(api.getModelDiagnostics!).mockResolvedValue({
      status: { ...readyStatus, reasonCodes: ["CIRCUIT_BREAKER_OPEN"] },
      release: { gateDecision: "pass", rolloutState: "actions" },
    });
    render(<App api={api} />);
    expect(
      await screen.findByText(
        "TMR temporariamente desativado; usando fallback local.",
      ),
    ).toBeVisible();
  });

  it("surfaces the WebGPU fallback via a status reason code", async () => {
    const api = fakePopupApi();
    vi.mocked(api.getModelDiagnostics!).mockResolvedValue({
      status: {
        ...readyStatus,
        runtimeIdentity: createBundleRuntimeIdentity({
          modelId: "local-model",
          modelVersion: "1.0.0",
        }),
        reasonCodes: ["WEBGPU_FALLBACK"],
      },
      release: { gateDecision: "pass", rolloutState: "actions" },
    });
    render(<App api={api} />);

    expect(
      await screen.findByText("WebGPU indisponível; usando WASM local."),
    ).toBeVisible();
  });

  it("polls diagnostics at most once per second and stops on unmount", async () => {
    vi.useFakeTimers();
    const api = fakePopupApi();
    const view = render(<App api={api} />);

    await vi.advanceTimersByTimeAsync(0);
    expect(api.getModelDiagnostics).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(api.getModelDiagnostics).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getModelDiagnostics).toHaveBeenCalledTimes(2);

    view.unmount();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.getModelDiagnostics).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
