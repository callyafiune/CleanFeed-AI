import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App as OptionsApp, type OptionsApi } from "@/options/App";
import { App as PopupApp, type PopupApi } from "@/popup/App";
import { DEFAULT_SETTINGS } from "@/shared/constants";

describe("Phase 1 acceptance", () => {
  afterEach(cleanup);

  it("keeps popup and settings local, probabilistic, and explicit about mock mode", async () => {
    const popupApi: PopupApi = {
      getPageStats: vi.fn().mockResolvedValue({
        platform: "linkedin",
        postsFound: 1,
        analyzed: 1,
        skippedByLength: 0,
        skippedByLanguage: 0,
        marked: 1,
        blurred: 0,
        collapsed: 0,
        hidden: 0,
        restored: 0,
        averageInferenceMs: 10,
        queueSize: 0,
      }),
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
    };
    const optionsApi: OptionsApi = {
      getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
      updateSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    };

    render(
      <>
        <PopupApp api={popupApi} />
        <OptionsApp api={optionsApi} />
      </>,
    );

    expect(
      await screen.findByText(
        "Modo de demonstração: nenhum modelo real está sendo utilizado.",
      ),
    ).toBeTruthy();
    await screen.findByRole("group", { name: "Geral" });
    expect(document.body.textContent).not.toMatch(
      /foi escrito por IA|comprovadamente artificial/u,
    );
  });
});
