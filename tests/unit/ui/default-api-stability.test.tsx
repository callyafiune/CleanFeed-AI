import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App as OptionsApp } from "@/options/App";
import { App as PopupApp } from "@/popup/App";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { PageStats } from "@/shared/types";

const pageStats: PageStats = {
  platform: "linkedin",
  postsFound: 1,
  analyzed: 1,
  skippedByLength: 0,
  skippedByLanguage: 0,
  marked: 0,
  blurred: 0,
  collapsed: 0,
  hidden: 0,
  restored: 0,
  averageInferenceMs: 1,
  queueSize: 0,
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("default Chrome APIs", () => {
  it("loads the popup once after its default API updates state", async () => {
    const query = vi
      .fn()
      .mockResolvedValue([{ id: 1, url: "https://www.linkedin.com/feed/" }]);
    const sendToTab = vi.fn().mockResolvedValue({
      source: "content",
      target: "popup",
      type: "PAGE_STATS_RESULT",
      payload: pageStats,
    });
    const sendToRuntime = vi.fn().mockResolvedValue({
      source: "background",
      target: "popup",
      type: "MODEL_STATUS_RESULT",
      payload: {
        state: "ready",
        classifierId: "mock",
        modelVersion: "1.0.0",
        backend: "mock",
      },
    });

    vi.stubGlobal("chrome", {
      tabs: { query, sendMessage: sendToTab },
      runtime: { sendMessage: sendToRuntime, openOptionsPage: vi.fn() },
    });

    render(<PopupApp />);

    await screen.findByText(/1 analisada/u);
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sendToRuntime).toHaveBeenCalledTimes(1);
    expect(sendToTab).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(2);
  });

  it("loads options once after its default API updates state", async () => {
    const sendToRuntime = vi.fn().mockResolvedValue({
      source: "background",
      target: "options",
      type: "SETTINGS_RESULT",
      payload: { ...DEFAULT_SETTINGS },
    });

    vi.stubGlobal("chrome", {
      runtime: { sendMessage: sendToRuntime },
    });

    render(<OptionsApp />);

    await screen.findByRole("heading", { name: /Configura/u });
    await waitFor(() => expect(sendToRuntime).toHaveBeenCalledTimes(1));
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sendToRuntime).toHaveBeenCalledTimes(1);
  });
});
