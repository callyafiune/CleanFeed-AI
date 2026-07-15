import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App as OptionsApp, type OptionsApi } from "@/options/App";
import { DEFAULT_SETTINGS } from "@/shared/constants";

function fakeOptionsApi(): OptionsApi {
  return {
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    updateSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
  };
}

describe("options App", () => {
  afterEach(cleanup);

  it("persists a valid minimum word count", async () => {
    const api = fakeOptionsApi();
    render(<OptionsApp api={api} />);

    await screen.findByLabelText("Mínimo de palavras");
    fireEvent.change(screen.getByLabelText("Mínimo de palavras"), {
      target: { value: "150" },
    });

    expect(api.updateSettings).toHaveBeenCalledWith({ minimumWordCount: 150 });
  });

  it("contains no definitive authorship claim", async () => {
    render(<OptionsApp api={fakeOptionsApi()} />);

    await screen.findByText("Configurações gerais");
    expect(document.body.textContent).not.toMatch(
      /foi escrito por IA|comprovadamente artificial/u,
    );
  });
});
