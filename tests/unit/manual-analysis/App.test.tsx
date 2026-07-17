import "@testing-library/jest-dom/vitest";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { App, type ManualAnalysisApi } from "@/manual-analysis/App";
import type { ClassificationRequest } from "@/shared/messages";
import type { ClassificationResult } from "@/shared/types";

const PORTUGUESE_LONG_TEXT = Array.from({ length: 120 }, () => "conteúdo").join(
  " ",
);

function result(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    aiScore: 0.86,
    humanScore: 0.14,
    confidence: "high",
    status: "possibly_ai",
    wordCount: 120,
    tokenCount: 150,
    modelVersion: "mock-v1",
    modelId: "mock",
    backend: "mock",
    processingTimeMs: 12,
    demo: true,
    explanation: {
      reasonCodes: ["HIGH_AVERAGE_SCORE"],
      modelScore: 0.86,
      calibratedScore: 0.86,
      calibrationProfile: "default",
    },
    ...overrides,
  };
}

function fakeApi(
  overrides: Partial<ManualAnalysisApi> = {},
): ManualAnalysisApi {
  return {
    classify: vi.fn().mockResolvedValue(result()),
    ...overrides,
  };
}

describe("manual analysis App", () => {
  afterEach(cleanup);

  it("prompts the user to select text when nothing was provided", () => {
    render(<App api={fakeApi()} selectedText="" />);

    expect(
      screen.getByText("Selecione um texto na página para analisar."),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Analisar seleção" }),
    ).toBeNull();
  });

  it("explains minimum length failures", () => {
    render(<App api={fakeApi()} selectedText="texto curto" />);

    expect(
      screen.getByText(
        "Este conteúdo possui menos palavras do que o mínimo configurado.",
      ),
    ).toBeVisible();
    expect(
      screen.queryByRole("button", { name: "Analisar seleção" }),
    ).toBeNull();
  });

  it("sends manual requests at maximum priority and displays the result", async () => {
    const api = fakeApi();
    render(<App api={api} selectedText={PORTUGUESE_LONG_TEXT} />);

    fireEvent.click(screen.getByRole("button", { name: "Analisar seleção" }));

    expect(api.classify).toHaveBeenCalledWith(
      expect.objectContaining({ manual: true }),
    );
    expect(
      await screen.findByText(/Resultado inconclusivo|Possivelmente/u),
    ).toBeVisible();
  });

  it("reports word count, confidence and calculated reasons in the result", async () => {
    render(<App api={fakeApi()} selectedText={PORTUGUESE_LONG_TEXT} />);

    fireEvent.click(screen.getByRole("button", { name: "Analisar seleção" }));

    expect(
      await screen.findByText("Possivelmente gerado por IA"),
    ).toBeVisible();
    expect(screen.getByText(/120 palavras/u)).toBeVisible();
    expect(screen.getByText("Confiança: alta")).toBeVisible();
    expect(
      screen.getByText("A pontuação média dos trechos ficou alta."),
    ).toBeVisible();
  });

  it("warns that the demonstration model was used", async () => {
    render(<App api={fakeApi()} selectedText={PORTUGUESE_LONG_TEXT} />);

    fireEvent.click(screen.getByRole("button", { name: "Analisar seleção" }));

    expect(
      await screen.findByText(
        "Modo de demonstração: nenhum modelo real está sendo utilizado.",
      ),
    ).toBeVisible();
  });

  it("re-runs classification when the user retries", async () => {
    const api = fakeApi();
    render(<App api={api} selectedText={PORTUGUESE_LONG_TEXT} />);

    fireEvent.click(screen.getByRole("button", { name: "Analisar seleção" }));
    await screen.findByText("Possivelmente gerado por IA");

    fireEvent.click(screen.getByRole("button", { name: "Analisar novamente" }));

    await vi.waitFor(() => expect(api.classify).toHaveBeenCalledTimes(2));
  });

  it("surfaces a recoverable error and lets the user try again", async () => {
    const classify = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(result({ status: "inconclusive" }));
    render(
      <App api={fakeApi({ classify })} selectedText={PORTUGUESE_LONG_TEXT} />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Analisar seleção" }));

    expect(await screen.findByRole("alert")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Analisar novamente" }));

    expect(await screen.findByText("Resultado inconclusivo")).toBeVisible();
  });

  it("reports the completed result to the background when supported", async () => {
    const reportResult = vi.fn();
    render(
      <App
        api={fakeApi({ reportResult })}
        selectedText={PORTUGUESE_LONG_TEXT}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Analisar seleção" }));
    await screen.findByText("Possivelmente gerado por IA");

    expect(reportResult).toHaveBeenCalledWith(
      expect.objectContaining({ status: "possibly_ai" }),
    );
  });

  it("closes the panel through its close control", () => {
    const onClose = vi.fn();
    render(
      <App
        api={fakeApi()}
        selectedText={PORTUGUESE_LONG_TEXT}
        onClose={onClose}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("classifies with a manual platform identifier and the selection text", () => {
    const api = fakeApi();
    render(<App api={api} selectedText={PORTUGUESE_LONG_TEXT} />);

    fireEvent.click(screen.getByRole("button", { name: "Analisar seleção" }));

    const request = (api.classify as ReturnType<typeof vi.fn>).mock
      .calls[0][0] as ClassificationRequest;
    expect(request.text).toBe(PORTUGUESE_LONG_TEXT);
    expect(request.platform).toBe("manual");
    expect(request.manual).toBe(true);
  });
});
