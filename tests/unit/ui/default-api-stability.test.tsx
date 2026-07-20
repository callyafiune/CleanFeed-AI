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
    // The default popup API asks the background for both the model status and
    // the current settings, so it responds by request type.
    const sendToRuntime = vi.fn(async (message: { type: string }) =>
      message.type === "GET_SETTINGS"
        ? {
            source: "background",
            target: "popup",
            type: "SETTINGS_RESULT",
            payload: { ...DEFAULT_SETTINGS },
          }
        : {
            source: "background",
            target: "popup",
            type: "MODEL_STATUS_RESULT",
            payload: {
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
            },
          },
    );

    vi.stubGlobal("chrome", {
      tabs: { query, sendMessage: sendToTab },
      runtime: { sendMessage: sendToRuntime, openOptionsPage: vi.fn() },
      storage: { local: { get: vi.fn().mockResolvedValue({}) } },
    });

    render(<PopupApp />);

    await screen.findByText("Analisados");
    await new Promise((resolve) => setTimeout(resolve, 20));

    // One refresh cycle: model status + settings over runtime, page stats over
    // the tab, and two active-tab lookups (page stats and hostname).
    expect(sendToRuntime).toHaveBeenCalledTimes(2);
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
