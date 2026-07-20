import { describe, expect, it } from "vitest";

import {
  HeuristicPortugueseDetector,
  evaluateLanguagePolicy,
} from "@/inference/language-detector";

const PORTUGUESE_PROSE = `
  A tecnologia pode ajudar pessoas a organizar melhor o trabalho diário, mas
  ela não substitui a conversa honesta entre equipes. Quando cada pessoa
  compartilha contexto, escuta dúvidas e registra decisões, o projeto ganha
  clareza, confiança e espaço para aprender com os próprios erros.
`;

const ENGLISH_PROSE = `
  Technology can help people organize their daily work, but it cannot replace
  honest conversations between teams. When everyone shares context, listens
  to questions, and records decisions, projects gain clarity and trust.
`;

describe("HeuristicPortugueseDetector", () => {
  const detector = new HeuristicPortugueseDetector();

  it("recognizes long Portuguese prose with confidence", async () => {
    const result = await detector.detect(PORTUGUESE_PROSE);

    expect(result.language).toBe("pt");
    expect(result.confidence).toBeGreaterThanOrEqual(0.65);
    expect(result.supported).toBe(true);
  });

  it("does not classify English prose as Portuguese", async () => {
    const result = await detector.detect(ENGLISH_PROSE);

    expect(result.language).not.toBe("pt");
    expect(result.supported).toBe(false);
  });

  it("keeps mixed prose below the Portuguese-only confidence threshold", async () => {
    const result = await detector.detect(
      `${PORTUGUESE_PROSE} ${ENGLISH_PROSE}`,
    );

    expect(result.confidence).toBeLessThan(0.65);
  });

  it("does not claim a language for insufficient lexical evidence", async () => {
    await expect(detector.detect("OK 😀")).resolves.toEqual({
      language: "und",
      confidence: 0,
      supported: false,
    });
  });
});

describe("evaluateLanguagePolicy", () => {
  it("allows only confident Portuguese in portuguese-only mode", () => {
    expect(
      evaluateLanguagePolicy(
        { language: "pt", confidence: 0.65, supported: true },
        "portuguese_only",
        ["pt"],
      ),
    ).toEqual({ allowed: true, abstain: false });

    expect(
      evaluateLanguagePolicy(
        { language: "pt", confidence: 0.64, supported: true },
        "portuguese_only",
        ["pt"],
      ),
    ).toEqual({
      allowed: false,
      abstain: true,
      reason: "LOW_LANGUAGE_CONFIDENCE",
    });
  });

  it("normalizes the detected locale before deciding pt-BR support", () => {
    for (const language of ["pt", "pt-BR", "PT", "pt-br"]) {
      expect(
        evaluateLanguagePolicy(
          { language, confidence: 0.9, supported: true },
          "portuguese_only",
          ["pt"],
        ),
      ).toEqual({ allowed: true, abstain: false });
    }

    for (const language of ["pt-PT", "en", "es", "und"]) {
      expect(
        evaluateLanguagePolicy(
          { language, confidence: 0.9, supported: true },
          "portuguese_only",
          ["pt"],
        ),
      ).toEqual({
        allowed: false,
        abstain: true,
        reason: "UNSUPPORTED_LANGUAGE",
      });
    }
  });

  it("requires a supported, confident language in model-supported mode", () => {
    expect(
      evaluateLanguagePolicy(
        { language: "en", confidence: 0.9, supported: false },
        "model_supported",
        ["pt"],
      ),
    ).toEqual({
      allowed: false,
      abstain: true,
      reason: "UNSUPPORTED_LANGUAGE",
    });
  });

  it("lets experimental mode continue with a low-confidence language", () => {
    expect(
      evaluateLanguagePolicy(
        { language: "und", confidence: 0.2, supported: false },
        "experimental_any",
        ["pt"],
      ),
    ).toEqual({ allowed: true, abstain: false });
  });
});
