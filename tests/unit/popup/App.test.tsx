import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App, type PopupApi } from "@/popup/App";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { PageStats } from "@/shared/types";

const pageStats: PageStats = {
  platform: "linkedin",
  postsFound: 4,
  analyzed: 2,
  skippedByLength: 1,
  skippedByLanguage: 0,
  marked: 1,
  blurred: 0,
  collapsed: 0,
  hidden: 0,
  restored: 0,
  averageInferenceMs: 12,
  queueSize: 0,
};

function fakePopupApi(overrides: Partial<PopupApi> = {}): PopupApi {
  return {
    getPageStats: vi.fn().mockResolvedValue(pageStats),
    getModelStatus: vi.fn().mockResolvedValue({
      state: "ready",
      backend: "mock",
      runtimeIdentity: {
        kind: "builtin",
        modelId: "mock",
        modelVersion: "1.0.0",
        implementationVersion: "mock",
      },
      calibrationCoverage: "none",
      calibrationSetDigest: null,
      profileCount: 0,
      earliestExpiry: null,
      reasonCodes: [],
    }),
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

function valueFor(label: string): string | undefined {
  return screen
    .getByText(label)
    .parentElement?.querySelector("dd")
    ?.textContent?.trim();
}

describe("popup App", () => {
  afterEach(cleanup);

  it("shows the mock warning and page counters", async () => {
    render(<App api={fakePopupApi()} />);

    expect(
      await screen.findByText(
        "Modo de demonstração: nenhum modelo real está sendo utilizado.",
      ),
    ).toBeVisible();
    expect(valueFor("Analisados")).toBe("2");
    expect(screen.getByText("Plataforma: LinkedIn")).toBeVisible();
    expect(screen.getByText("www.linkedin.com")).toBeVisible();
  });

  it("clears presentation without exposing the page text", async () => {
    const api = fakePopupApi();
    render(<App api={api} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Limpar resultados visuais" }),
    );

    await waitFor(() =>
      expect(api.clearPagePresentation).toHaveBeenCalledOnce(),
    );
    expect(document.body.textContent).not.toMatch(/texto do post/u);
  });
});
