import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App as OptionsApp, type OptionsApi } from "@/options/App";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { StorageArea } from "@/shared/types";
import { createImportExport } from "@/storage/import-export";

class MemoryStorageArea implements StorageArea {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.values.delete(key);
    }
  }

  async getMany<T>(keys: string[]): Promise<Record<string, T>> {
    return Object.fromEntries(
      keys
        .filter((key) => this.values.has(key))
        .map((key) => [key, this.values.get(key) as T]),
    );
  }
}

function hashFor(seed: number): string {
  return (seed >>> 0).toString(16).padStart(64, "0");
}

const VALID_EXPORT = JSON.stringify({
  schemaVersion: 1,
  extensionVersion: "unknown",
  exportedAt: "2026-01-01T00:00:00.000Z",
  keywordRules: Array.from({ length: 3 }, (_, index) => ({
    id: `rule-${index}`,
    pattern: `padrão ${index}`,
    matchType: "contains",
    caseSensitive: false,
    action: "label",
    platforms: ["linkedin"],
    enabled: true,
  })),
  feedback: Array.from({ length: 12 }, (_, index) => ({
    textHash: hashFor(index + 1),
    predictedScore: 0.9,
    predictedStatus: "possibly_ai",
    feedback: "ai",
    modelVersion: "v1",
    platform: "linkedin",
    createdAt: 1_700_000_000_000 + index,
  })),
});

function fakeApi(): OptionsApi {
  const importExport = createImportExport({
    storage: new MemoryStorageArea(),
    extensionVersion: "unknown",
    clock: { now: () => 0 },
  });
  return {
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    updateSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    importExport: {
      buildExport: vi.fn(importExport.buildExport),
      parseImport: vi.fn(importExport.parseImport),
      previewImport: vi.fn(importExport.previewImport),
      applyImport: vi.fn(importExport.applyImport),
    },
  };
}

function uploadFile(input: HTMLElement, contents: string): void {
  const file = new File([contents], "cleanfeed-export.json", {
    type: "application/json",
  });
  fireEvent.change(input, { target: { files: [file] } });
}

describe("options import/export", () => {
  afterEach(cleanup);

  it("shows an import summary before enabling apply", async () => {
    const api = fakeApi();
    render(<OptionsApp api={api} />);

    uploadFile(
      await screen.findByLabelText("Arquivo de importação"),
      VALID_EXPORT,
    );

    expect(await screen.findByText(/3 regras, 12 feedbacks/u)).toBeVisible();
    expect(
      screen.getByRole("button", { name: "Aplicar importação" }),
    ).toBeEnabled();
  });

  it("requires a final confirmation before applying the import", async () => {
    const api = fakeApi();
    render(<OptionsApp api={api} />);

    uploadFile(
      await screen.findByLabelText("Arquivo de importação"),
      VALID_EXPORT,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "Aplicar importação" }),
    );
    expect(api.importExport?.applyImport).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", { name: "Confirmar importação" }),
    );
    expect(api.importExport?.applyImport).toHaveBeenCalledTimes(1);
  });

  it("keeps apply disabled until a valid file is parsed", async () => {
    const api = fakeApi();
    render(<OptionsApp api={api} />);

    await screen.findByLabelText("Arquivo de importação");
    expect(
      screen.getByRole("button", { name: "Aplicar importação" }),
    ).toBeDisabled();
  });

  it("keeps sensitive categories unchecked by default and exports only what is selected", async () => {
    const api = fakeApi();
    render(<OptionsApp api={api} />);

    const feedbackCheckbox = await screen.findByLabelText(
      "Incluir feedback na exportação",
    );
    const historyCheckbox = screen.getByLabelText(
      "Incluir histórico na exportação",
    );
    // Sensitive categories start unchecked.
    expect(feedbackCheckbox).not.toBeChecked();
    expect(historyCheckbox).not.toBeChecked();

    // Opting feedback in and exporting must pass exactly that selection through
    // to buildExport (history stays out because it was never checked).
    fireEvent.click(feedbackCheckbox);
    fireEvent.click(screen.getByRole("button", { name: "Exportar dados" }));

    expect(api.importExport?.buildExport).toHaveBeenCalledTimes(1);
    expect(api.importExport?.buildExport).toHaveBeenCalledWith(
      expect.objectContaining({
        includeFeedback: true,
        includeHistory: false,
      }),
    );
  });
});
