import "@testing-library/jest-dom/vitest";

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App, type PopupApi } from "@/popup/App";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { PageStats } from "@/shared/types";

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

function fakePopupApi(): PopupApi {
  return {
    getPageStats: vi.fn().mockResolvedValue(stats),
    getModelStatus: vi.fn().mockResolvedValue({
      state: "ready",
      classifierId: "mock",
      modelVersion: "1.0.0",
      backend: "wasm",
    }),
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

  it("surfaces the explicit WebGPU fallback warning", async () => {
    const api = fakePopupApi();
    vi.mocked(api.getModelStatus).mockResolvedValue({
      state: "ready",
      classifierId: "local-model",
      modelVersion: "1.0.0",
      backend: "wasm",
      fallbackFrom: "webgpu",
      warning: "WEBGPU_FALLBACK",
    });
    render(<App api={api} />);

    expect((await screen.findByRole("status")).textContent).toBe(
      "WebGPU indisponível; usando WASM local.",
    );
  });

  it("polls status at most once per second and stops on unmount", async () => {
    vi.useFakeTimers();
    const api = fakePopupApi();
    const view = render(<App api={api} />);

    await vi.advanceTimersByTimeAsync(0);
    expect(api.getModelStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(api.getModelStatus).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(api.getModelStatus).toHaveBeenCalledTimes(2);

    view.unmount();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(api.getModelStatus).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
