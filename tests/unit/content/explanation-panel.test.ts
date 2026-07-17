import "@testing-library/jest-dom/vitest";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyBadge,
  attachExplanationDisclosure,
} from "@/content/presentation/badge";
import { createExplanationPanel } from "@/content/presentation/explanation-panel";
import { restorePresentation } from "@/content/presentation/restore";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type {
  ClassificationExplanation,
  ClassificationResult,
  ReasonCode,
} from "@/shared/types";

function makeResult(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    aiScore: 0.9,
    humanScore: 0.1,
    confidence: "high",
    status: "possibly_ai",
    wordCount: 140,
    tokenCount: 150,
    modelVersion: "mock-v1",
    modelId: "mock-detector",
    backend: "mock",
    processingTimeMs: 4,
    demo: true,
    ...overrides,
  };
}

function withReasons(
  reasonCodes: ReasonCode[],
  extra: Partial<ClassificationExplanation> = {},
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  const explanation: ClassificationExplanation = {
    reasonCodes,
    modelScore: 0.9,
    calibratedScore: 0.91,
    calibrationProfile: "default-pt-100_149",
    ...extra,
  };
  return makeResult({ explanation, ...overrides });
}

describe("createExplanationPanel", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("renders only calculated evidence under the approved heading", () => {
    const panel = createExplanationPanel(withReasons(["HIGH_AVERAGE_SCORE"]), {
      onFeedback: vi.fn(),
    });
    document.body.append(panel);

    expect(
      screen.getByRole("heading", { name: "Indícios observados" }),
    ).toBeVisible();
    expect(screen.getByText(/pontuação média/u)).toBeVisible();
    expect(document.body.textContent).not.toMatch(/provas|foi escrito por IA/u);
  });

  it("maps every present reason code to a distinct probabilistic phrase", () => {
    const panel = createExplanationPanel(
      withReasons([
        "HIGH_CHUNK_CONSISTENCY",
        "LOW_MODEL_CONFIDENCE",
        "EXCESSIVE_HASHTAGS",
      ]),
      { onFeedback: vi.fn() },
    );
    document.body.append(panel);

    const items = panel.querySelectorAll("li");
    expect(items).toHaveLength(3);
    const texts = Array.from(items, (item) => item.textContent ?? "");
    expect(new Set(texts).size).toBe(3);
    expect(texts.some((text) => /consistente/u.test(text))).toBe(true);
    expect(texts.some((text) => /confian/u.test(text))).toBe(true);
    expect(texts.some((text) => /hashtag/u.test(text))).toBe(true);
  });

  it("declares the panel language as pt-BR for assistive technology", () => {
    const panel = createExplanationPanel(withReasons(["HIGH_AVERAGE_SCORE"]), {
      onFeedback: vi.fn(),
    });

    expect(panel.getAttribute("lang")).toBe("pt-BR");
  });

  it("keeps keyboard focus in the panel after feedback by moving it to the confirmation", () => {
    const panel = createExplanationPanel(withReasons(["HIGH_AVERAGE_SCORE"]), {
      onFeedback: vi.fn(),
    });
    document.body.append(panel);
    const humanButton = panel.querySelector<HTMLButtonElement>(
      '[data-verdict="human"]',
    );
    if (humanButton === null) throw new Error("feedback button not found");
    humanButton.focus();
    expect(document.activeElement).toBe(humanButton);

    fireEvent.click(humanButton);

    expect(document.activeElement).toBe(
      panel.querySelector(".cleanfeed-explanation__confirmation"),
    );
  });

  it("shows the model identity and word and token counts", () => {
    const panel = createExplanationPanel(withReasons(["HIGH_AVERAGE_SCORE"]), {
      onFeedback: vi.fn(),
    });
    document.body.append(panel);

    expect(panel).toHaveTextContent("mock-detector");
    expect(panel).toHaveTextContent("mock-v1");
    expect(panel).toHaveTextContent("140");
    expect(panel).toHaveTextContent("150");
  });

  it("shows chunk, consistency and calibration profile only when present", () => {
    const withMeta = createExplanationPanel(
      withReasons(["HIGH_AVERAGE_SCORE"], {
        totalChunks: 3,
        chunkAgreement: 0.82,
      }),
      { onFeedback: vi.fn() },
    );
    document.body.append(withMeta);
    expect(withMeta).toHaveTextContent(/Trechos/u);
    expect(withMeta).toHaveTextContent(/Consist/u);
    expect(withMeta).toHaveTextContent("default-pt-100_149");
  });

  it("omits chunk, consistency and profile metadata when the result lacks an explanation", () => {
    const panel = createExplanationPanel(
      makeResult({
        decision: {
          status: "possibly_ai",
          calibratedScore: 0.9,
          actionCeiling: "blur",
          abstained: false,
          reasonCodes: ["HIGH_AVERAGE_SCORE"],
        },
      }),
      { onFeedback: vi.fn() },
    );
    document.body.append(panel);

    expect(screen.getByText(/pontuação média/u)).toBeVisible();
    expect(panel).not.toHaveTextContent(/Trechos analisados/u);
    expect(panel).not.toHaveTextContent(/Perfil de calibração/u);
  });

  it("offers the three feedback verdicts and reports the chosen one", () => {
    const onFeedback = vi.fn();
    const panel = createExplanationPanel(withReasons(["HIGH_AVERAGE_SCORE"]), {
      onFeedback,
    });
    document.body.append(panel);

    fireEvent.click(screen.getByRole("button", { name: "Era humano" }));
    expect(onFeedback).toHaveBeenCalledWith("human");

    const aiPanel = createExplanationPanel(
      withReasons(["HIGH_AVERAGE_SCORE"]),
      {
        onFeedback,
      },
    );
    document.body.append(aiPanel);
    fireEvent.click(screen.getAllByRole("button", { name: "Era IA" })[1]);
    expect(onFeedback).toHaveBeenCalledWith("ai");

    const unknownPanel = createExplanationPanel(
      withReasons(["HIGH_AVERAGE_SCORE"]),
      { onFeedback },
    );
    document.body.append(unknownPanel);
    fireEvent.click(screen.getAllByRole("button", { name: "Não sei" })[2]);
    expect(onFeedback).toHaveBeenCalledWith("unknown");
  });

  it("confirms feedback locally without claiming the model was trained", () => {
    const panel = createExplanationPanel(withReasons(["HIGH_AVERAGE_SCORE"]), {
      onFeedback: vi.fn(),
    });
    document.body.append(panel);

    fireEvent.click(screen.getByRole("button", { name: "Era humano" }));

    const status = panel.querySelector("[role='status']");
    expect(status?.textContent ?? "").not.toBe("");
    expect(panel.textContent).not.toMatch(/trein|aprend/u);
  });

  it("never renders HTML embedded in result fields", () => {
    const panel = createExplanationPanel(
      withReasons(
        ["HIGH_AVERAGE_SCORE"],
        {},
        {
          modelId: '<img src=x onerror="boom">',
          modelVersion: "<script>alert(1)</script>",
        },
      ),
      { onFeedback: vi.fn() },
    );
    document.body.append(panel);

    expect(panel.querySelector("img")).toBeNull();
    expect(panel.querySelector("script")).toBeNull();
  });

  it("invokes onClose from the close control", () => {
    const onClose = vi.fn();
    const panel = createExplanationPanel(withReasons(["HIGH_AVERAGE_SCORE"]), {
      onFeedback: vi.fn(),
      onClose,
    });
    document.body.append(panel);

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("attachExplanationDisclosure", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  function presentedPost(): { post: HTMLElement; badge: HTMLButtonElement } {
    const container = document.createElement("div");
    const post = document.createElement("article");
    post.textContent = "conteúdo original";
    container.append(post);
    document.body.append(container);
    applyBadge(post, makeResult(), DEFAULT_SETTINGS, "indicator");
    const badge = document.querySelector<HTMLButtonElement>(
      "[data-cleanfeed-owned='badge']",
    );
    if (badge === null) throw new Error("badge not created");
    return { post, badge };
  }

  it("wires the badge as a disclosure that toggles the panel", () => {
    const { post, badge } = presentedPost();

    attachExplanationDisclosure(
      post,
      badge,
      withReasons(["HIGH_AVERAGE_SCORE"]),
      {
        onFeedback: vi.fn(),
      },
    );

    expect(badge.getAttribute("aria-expanded")).toBe("false");
    expect(badge.getAttribute("aria-controls")).not.toBeNull();
    expect(
      document.querySelector("[data-cleanfeed-owned='explanation']"),
    ).toBeNull();

    fireEvent.click(badge);
    expect(badge.getAttribute("aria-expanded")).toBe("true");
    const panel = document.querySelector<HTMLElement>(
      "[data-cleanfeed-owned='explanation']",
    );
    expect(panel).not.toBeNull();
    expect(badge.getAttribute("aria-controls")).toBe(panel?.id);

    fireEvent.click(badge);
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    expect(
      document.querySelector("[data-cleanfeed-owned='explanation']"),
    ).toBeNull();
  });

  it("moves focus to the heading on open and back to the badge on close", () => {
    const { post, badge } = presentedPost();
    attachExplanationDisclosure(
      post,
      badge,
      withReasons(["HIGH_AVERAGE_SCORE"]),
      {
        onFeedback: vi.fn(),
      },
    );

    fireEvent.click(badge);
    const heading = screen.getByRole("heading", {
      name: "Indícios observados",
    });
    expect(document.activeElement).toBe(heading);

    fireEvent.click(screen.getByRole("button", { name: "Fechar" }));
    expect(badge.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(badge);
  });

  it("registers the panel as owned so restore removes it", () => {
    const { post, badge } = presentedPost();
    attachExplanationDisclosure(
      post,
      badge,
      withReasons(["HIGH_AVERAGE_SCORE"]),
      {
        onFeedback: vi.fn(),
      },
    );
    fireEvent.click(badge);
    expect(
      document.querySelector("[data-cleanfeed-owned='explanation']"),
    ).not.toBeNull();

    restorePresentation(post);

    expect(document.querySelectorAll("[data-cleanfeed-owned]")).toHaveLength(0);
  });
});
