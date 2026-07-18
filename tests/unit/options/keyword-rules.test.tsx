import "@testing-library/jest-dom/vitest";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App as OptionsApp, type OptionsApi } from "@/options/App";
import type { KeywordRule } from "@/rules/rule-engine";
import { DEFAULT_SETTINGS } from "@/shared/constants";

function rule(overrides: Partial<KeywordRule> = {}): KeywordRule {
  return {
    id: "rule-1",
    pattern: "spam",
    matchType: "contains",
    caseSensitive: false,
    action: "label",
    platforms: ["linkedin"],
    enabled: true,
    ...overrides,
  };
}

function fakeApi(initial: KeywordRule[] = []): OptionsApi {
  const rules = [...initial];
  return {
    getSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    updateSettings: vi.fn().mockResolvedValue(DEFAULT_SETTINGS),
    rules: {
      list: vi
        .fn()
        .mockImplementation(async () => rules.map((entry) => ({ ...entry }))),
      create: vi.fn().mockImplementation(async (entry: KeywordRule) => {
        rules.push(entry);
      }),
      update: vi.fn().mockImplementation(async (entry: KeywordRule) => {
        const index = rules.findIndex((existing) => existing.id === entry.id);
        if (index >= 0) rules[index] = entry;
      }),
      remove: vi.fn().mockImplementation(async (id: string) => {
        const index = rules.findIndex((existing) => existing.id === id);
        if (index >= 0) rules.splice(index, 1);
      }),
    },
  };
}

describe("options keyword rules", () => {
  afterEach(cleanup);

  it("creates a keyword rule with the typed pattern", async () => {
    const api = fakeApi();
    render(<OptionsApp api={api} />);

    fireEvent.click(await screen.findByRole("button", { name: "Criar regra" }));
    fireEvent.change(screen.getByLabelText("Palavra ou expressão"), {
      target: { value: "curso imperdível" },
    });
    fireEvent.change(screen.getByLabelText("Ação"), {
      target: { value: "blur" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar regra" }));

    expect(api.rules?.create).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: "curso imperdível", action: "blur" }),
    );
  });

  it("edits an existing rule", async () => {
    const api = fakeApi([rule({ id: "rule-1", pattern: "antigo" })]);
    render(<OptionsApp api={api} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Editar regra: antigo" }),
    );
    const input = screen.getByLabelText("Palavra ou expressão");
    fireEvent.change(input, { target: { value: "novo padrão" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar regra" }));

    expect(api.rules?.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rule-1", pattern: "novo padrão" }),
    );
  });

  it("disables an enabled rule", async () => {
    const api = fakeApi([
      rule({ id: "rule-1", pattern: "promoção", enabled: true }),
    ]);
    render(<OptionsApp api={api} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Desativar regra: promoção" }),
    );

    expect(api.rules?.update).toHaveBeenCalledWith(
      expect.objectContaining({ id: "rule-1", enabled: false }),
    );
  });

  it("deletes a rule after explicit confirmation", async () => {
    const api = fakeApi([rule({ id: "rule-1", pattern: "descartável" })]);
    render(<OptionsApp api={api} />);

    fireEvent.click(
      await screen.findByRole("button", { name: "Excluir regra: descartável" }),
    );
    expect(api.rules?.remove).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Confirmar exclusão" }));
    expect(api.rules?.remove).toHaveBeenCalledWith("rule-1");
  });

  it("blocks saving an unsafe regex and shows a safety error", async () => {
    const api = fakeApi();
    render(<OptionsApp api={api} />);

    fireEvent.click(await screen.findByRole("button", { name: "Criar regra" }));
    fireEvent.change(screen.getByLabelText("Palavra ou expressão"), {
      target: { value: "(a+)+" },
    });
    fireEvent.change(screen.getByLabelText("Tipo de correspondência"), {
      target: { value: "regex" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Salvar regra" }));

    // The alert must surface the SPECIFIC safety reason ((a+)+ is a nested
    // quantifier), not merely be present.
    expect(screen.getByRole("alert")).toHaveTextContent(
      /quantificadores aninhados/iu,
    );
    expect(api.rules?.create).not.toHaveBeenCalled();
  });

  it("keeps the full pattern in the accessible name even when long", async () => {
    const longPattern = "atenção investidores ".repeat(6).trim();
    const api = fakeApi([rule({ id: "rule-1", pattern: longPattern })]);
    render(<OptionsApp api={api} />);

    const table = await screen.findByRole("table", {
      name: "Regras personalizadas",
    });
    // The pattern is CSS-truncated visually, but the full text must remain in
    // the DOM and, crucially, in the per-row controls' accessible names so they
    // stay distinguishable for screen readers.
    expect(within(table).getByText(longPattern)).toBeInTheDocument();
    expect(
      within(table).getByRole("button", {
        name: `Editar regra: ${longPattern}`,
      }),
    ).toBeInTheDocument();
    expect(
      within(table).getByRole("button", {
        name: `Excluir regra: ${longPattern}`,
      }),
    ).toBeInTheDocument();
  });
});
