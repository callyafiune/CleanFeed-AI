import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App, type PopupApi } from "@/popup/App";
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
      classifierId: "mock",
      modelVersion: "1.0.0",
      backend: "mock",
    }),
    getActiveHost: vi.fn().mockResolvedValue("www.linkedin.com"),
    clearPresentation: vi.fn().mockResolvedValue(undefined),
    openOptions: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("popup App", () => {
  afterEach(cleanup);

  it("shows the mock warning and page counters", async () => {
    render(<App api={fakePopupApi()} />);

    expect(
      await screen.findByText(
        "Modo de demonstração: nenhum modelo real está sendo utilizado.",
      ),
    ).toBeTruthy();
    expect(screen.getByText(/2 analisadas/u)).toBeTruthy();
    expect(screen.getByText("www.linkedin.com")).toBeTruthy();
  });

  it("clears presentation without exposing the page text", async () => {
    const api = fakePopupApi();
    render(<App api={api} />);

    await screen.findByText(/2 analisadas/u);
    fireEvent.click(screen.getByRole("button", { name: "Restaurar posts" }));

    await waitFor(() => expect(api.clearPresentation).toHaveBeenCalledOnce());
    expect(document.body.textContent).not.toMatch(/texto do post/u);
  });
});
