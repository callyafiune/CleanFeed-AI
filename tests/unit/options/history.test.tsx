import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App as OptionsApp, type OptionsApi } from "@/options/App";
import { CLASSIFICATION_STATUS_COPY } from "@/shared/classification-copy";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { UserSettings } from "@/shared/settings-types";
import type { HistoryEntry } from "@/shared/types";

function hashFor(seed: number): string {
  return (seed >>> 0).toString(16).padStart(64, "0");
}

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    textHash: hashFor(1),
    platform: "linkedin",
    status: "possibly_ai",
    score: 0.9,
    timestamp: 1_700_000_000_000,
    ...overrides,
  };
}

function fakeApi(
  settings: UserSettings = DEFAULT_SETTINGS,
  entries: HistoryEntry[] = [],
): OptionsApi {
  return {
    getSettings: vi.fn().mockResolvedValue(settings),
    updateSettings: vi.fn().mockResolvedValue(settings),
    settings: {
      save: vi.fn().mockResolvedValue(settings),
    },
    history: {
      query: vi.fn().mockResolvedValue(entries),
      export: vi.fn().mockResolvedValue({ schemaVersion: 1, entries }),
      clear: vi.fn().mockResolvedValue(undefined),
      getTexts: vi.fn().mockResolvedValue({ [hashFor(1)]: "texto opt-in" }),
    },
  };
}

describe("options history", () => {
  afterEach(cleanup);

  it("does not enable full-text history without explicit acknowledgement", async () => {
    const api = fakeApi();
    render(<OptionsApp api={api} />);

    fireEvent.click(await screen.findByLabelText("Armazenar texto integral"));

    expect(
      screen.getByRole("dialog", { name: "Confirmar armazenamento de texto" }),
    ).toBeVisible();
    expect(api.settings?.save).not.toHaveBeenCalled();
  });

  it("saves full-text only after confirming the acknowledgement", async () => {
    const api = fakeApi();
    render(<OptionsApp api={api} />);

    fireEvent.click(await screen.findByLabelText("Armazenar texto integral"));
    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar armazenamento" }),
    );

    expect(api.settings?.save).toHaveBeenCalledWith(
      expect.objectContaining({ storeFullText: true }),
    );
  });

  it("cancels the acknowledgement without saving", async () => {
    const api = fakeApi();
    render(<OptionsApp api={api} />);

    fireEvent.click(await screen.findByLabelText("Armazenar texto integral"));
    fireEvent.click(
      screen.getByRole("button", { name: "Cancelar armazenamento" }),
    );

    expect(
      screen.queryByRole("dialog", {
        name: "Confirmar armazenamento de texto",
      }),
    ).not.toBeInTheDocument();
    expect(api.settings?.save).not.toHaveBeenCalled();
  });

  it("enables history recording with a single toggle", async () => {
    const api = fakeApi();
    render(<OptionsApp api={api} />);

    fireEvent.click(await screen.findByLabelText("Registrar histórico local"));

    expect(api.settings?.save).toHaveBeenCalledWith(
      expect.objectContaining({ historyEnabled: true }),
    );
  });

  it("omits the text column while full text is disabled", async () => {
    const api = fakeApi({ ...DEFAULT_SETTINGS, historyEnabled: true }, [
      entry(),
    ]);
    render(<OptionsApp api={api} />);

    await screen.findByRole("table", { name: "Histórico de classificações" });
    expect(
      screen.queryByRole("columnheader", { name: "Texto integral" }),
    ).not.toBeInTheDocument();
  });

  it("labels the result with the centralized neutral band copy, not the old assertive wording", async () => {
    const api = fakeApi({ ...DEFAULT_SETTINGS, historyEnabled: true }, [
      entry({ status: "possibly_ai" }),
    ]);
    render(<OptionsApp api={api} />);

    await screen.findByRole("table", { name: "Histórico de classificações" });

    // The history row's result cell renders the neutral band from the single
    // source of truth ...
    expect(
      screen.getByRole("cell", {
        name: CLASSIFICATION_STATUS_COPY.possibly_ai,
      }),
    ).toBeVisible();
    // ... and no history cell carries the pre-P4-T1 assertive wording (the local
    // STATUS_LABELS map is gone). Scoped to cells so the HistorySettings filter
    // dropdown — a separate surface — is not implicated.
    expect(
      screen.queryByRole("cell", { name: "Possivelmente IA" }),
    ).not.toBeInTheDocument();
  });

  it("never renders a raw score or percentage and labels model origin as Modelo", async () => {
    const api = fakeApi({ ...DEFAULT_SETTINGS, historyEnabled: true }, [
      entry({ score: 0.999, origin: "ai" }),
    ]);
    render(<OptionsApp api={api} />);

    await screen.findByRole("table", { name: "Histórico de classificações" });

    // The score column and value are gone entirely: no percentage, no raw
    // decimal, and no "Pontuação"/"Score"/"Confiança" wording anywhere.
    expect(
      screen.queryByRole("columnheader", { name: "Pontuação" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("columnheader", { name: /Score/iu }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(
      /0[.,]999|99[.,]9\s*%|Confiança/u,
    );
    // Origin is now expressed as the neutral "Modelo", never "IA".
    expect(screen.getByRole("cell", { name: "Modelo" })).toBeVisible();
  });

  it("shows the text column when full text is enabled", async () => {
    const api = fakeApi(
      { ...DEFAULT_SETTINGS, historyEnabled: true, storeFullText: true },
      [entry()],
    );
    render(<OptionsApp api={api} />);

    expect(
      await screen.findByRole("columnheader", { name: "Texto integral" }),
    ).toBeVisible();
  });

  it("requires explicit confirmation before clearing history", async () => {
    const api = fakeApi({ ...DEFAULT_SETTINGS, historyEnabled: true }, [
      entry(),
    ]);
    render(<OptionsApp api={api} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Limpar histórico" }),
    );
    expect(api.history?.clear).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar limpeza de histórico" }),
    );
    expect(api.history?.clear).toHaveBeenCalledTimes(1);
  });
});
