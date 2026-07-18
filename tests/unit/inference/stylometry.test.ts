import { describe, expect, it } from "vitest";

import {
  extractStylometricFeatures,
  getStylometricReasonCodes,
} from "@/inference/stylometry";

const LISTICLE_TEXT = [
  "Como crescer no LinkedIn de forma consistente:",
  "1. Poste todo dia um conteúdo original.",
  "2. Responda comentários com atenção real.",
  "3. Use ganchos fortes na primeira linha.",
  "4. Seja consistente por noventa dias.",
].join("\n");

const UNIFORM_SENTENCES_TEXT = [
  "O relatório mensal chegou cedo para todos hoje.",
  "A diretoria pediu novos indicadores de venda regional.",
  "O time revisou cada número antes da reunião.",
  "As metas seguem estáveis desde o trimestre passado.",
  "Os clientes aprovaram a proposta na semana anterior.",
  "A equipe fechou o ciclo sem pendências abertas.",
].join(" ");

const REPEATED_TRANSITIONS_TEXT =
  "Além disso, o projeto avançou bem neste ciclo. " +
  "Além disso, a equipe entregou tudo dentro do prazo. " +
  "Além disso, o cliente aprovou o resultado final. " +
  "O restante segue como estava planejado antes.";

const HASHTAG_HEAVY_TEXT =
  "Hoje quero falar sobre carreira e propósito no trabalho. " +
  "#carreira #proposito #trabalho #linkedin #sucesso #vagas";

const TINY_TEXT = "Oi. Tudo bem?";

describe("extractStylometricFeatures", () => {
  it("is deterministic for the same input", () => {
    const first = extractStylometricFeatures(REPEATED_TRANSITIONS_TEXT);
    const second = extractStylometricFeatures(REPEATED_TRANSITIONS_TEXT);

    expect(second).toEqual(first);
  });

  it("keeps every contribution inside [0, 1]", () => {
    for (const text of [
      LISTICLE_TEXT,
      UNIFORM_SENTENCES_TEXT,
      REPEATED_TRANSITIONS_TEXT,
      HASHTAG_HEAVY_TEXT,
      TINY_TEXT,
      "",
    ]) {
      const { contributions } = extractStylometricFeatures(text);
      for (const value of Object.values(contributions)) {
        expect(value).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
        expect(Number.isFinite(value)).toBe(true);
      }
    }
  });

  it("flags enumerated single-line paragraphs as a listicle pattern", () => {
    const features = extractStylometricFeatures(LISTICLE_TEXT);

    expect(features.bulletLines).toBeGreaterThanOrEqual(4);
    expect(features.contributions.listiclePattern).toBeGreaterThanOrEqual(0.5);
    expect(getStylometricReasonCodes(features)).toEqual(
      expect.arrayContaining(["LISTICLE_PATTERN"]),
    );
  });

  it("flags uniform sentence lengths as low variation", () => {
    const features = extractStylometricFeatures(UNIFORM_SENTENCES_TEXT);

    expect(features.sentence.sentenceCount).toBe(6);
    expect(features.sentence.lengthCoefficientOfVariation).toBeLessThan(0.1);
    expect(
      features.contributions.lowSentenceLengthVariation,
    ).toBeGreaterThanOrEqual(0.5);
    expect(getStylometricReasonCodes(features)).toEqual(
      expect.arrayContaining(["LOW_SENTENCE_LENGTH_VARIATION"]),
    );
  });

  it("flags repeated sentence-initial connectives as repetitive transitions", () => {
    const features = extractStylometricFeatures(REPEATED_TRANSITIONS_TEXT);

    expect(features.connectiveSentenceStarts).toBe(3);
    expect(features.repeatedOpeningBigrams).toBeGreaterThanOrEqual(2);
    expect(features.contributions.repetitiveTransitions).toBeGreaterThanOrEqual(
      0.5,
    );
    expect(getStylometricReasonCodes(features)).toEqual(
      expect.arrayContaining(["REPETITIVE_TRANSITIONS"]),
    );
  });

  it("flags a high hashtag density as excessive hashtags", () => {
    const features = extractStylometricFeatures(HASHTAG_HEAVY_TEXT);

    expect(features.hashtagCount).toBe(6);
    expect(features.contributions.excessiveHashtags).toBeGreaterThanOrEqual(
      0.5,
    );
    expect(getStylometricReasonCodes(features)).toEqual(
      expect.arrayContaining(["EXCESSIVE_HASHTAGS"]),
    );
  });

  it("never fires repetitive transitions for a single connective in a short text", () => {
    const features = extractStylometricFeatures(
      "O time entregou o projeto na sexta-feira. " +
        "A revisão apontou dois ajustes pequenos no fluxo. " +
        "Portanto, o lançamento ficou para a próxima semana. " +
        "O cliente aprovou o novo cronograma sem ressalvas.",
    );

    expect(features.connectiveSentenceStarts).toBe(1);
    // A lone opener is normal writing: the signal is zero, not "damped" onto
    // the exact reason-code threshold as before the honesty review.
    expect(features.contributions.repetitiveTransitions).toBe(0);
    expect(getStylometricReasonCodes(features)).not.toContain(
      "REPETITIVE_TRANSITIONS",
    );
  });

  it("counts dash bullets once: listicle shape, not prose cadence", () => {
    const jobPost = [
      "Estamos contratando para a equipe de plataforma:",
      "– Pessoa desenvolvedora backend com experiência em Node.",
      "– Pessoa desenvolvedora frontend com experiência em React.",
      "– Pessoa de dados com experiência em pipelines batch.",
      "– Analista de QA com olhar forte para automação.",
      "Interessadas podem enviar o currículo pelo link da vaga.",
      "#vagas #react #typescript #campinas",
    ].join("\n");
    const features = extractStylometricFeatures(jobPost);

    expect(features.bulletLines).toBe(4);
    expect(features.contributions.listiclePattern).toBeGreaterThanOrEqual(0.5);
    // Only the introductory colon is prose cadence; the four line-opening
    // dashes are bullet markers and must not be double-counted.
    expect(features.cadenceMarks).toBe(1);
    // The trailing hashtag-only line is not a "dramatic fragment" either.
    expect(features.fragmentSentences).toBe(0);
    expect(features.contributions.formulaicStructure).toBeLessThan(0.5);
    expect(getStylometricReasonCodes(features)).not.toContain(
      "FORMULAIC_STRUCTURE",
    );
  });

  it("counts fragments only inside flowing prose, not as standalone lines", () => {
    const standaloneLines = [
      "Acorde cedo.",
      "Treine muito.",
      "Durma bem.",
      "Repita.",
      "Confie no processo.",
      "O resto acompanha.",
    ].join("\n");
    const flowingProse =
      "Eu tinha um plano enorme para o lançamento. Falhou. " +
      "Recomeçei do zero na semana seguinte com metade do escopo. De novo. " +
      "Só na terceira tentativa o produto finalmente encontrou clientes. " +
      "Hoje a receita cobre os custos e o time cresceu para seis pessoas.";

    // Line-broken punchy lines are the broetry/listicle layout, measured by
    // the listicle signal alone.
    expect(extractStylometricFeatures(standaloneLines).fragmentSentences).toBe(
      0,
    );
    // Punctuated fragments inside a paragraph are dramatic prose cadence.
    expect(
      extractStylometricFeatures(flowingProse).fragmentSentences,
    ).toBeGreaterThanOrEqual(2);
  });

  it("stays linear on a long interior punctuation run", () => {
    // A single whitespace-free token shaped <letter><dots><letter> made the
    // previous $-anchored edge-trim regex backtrack quadratically (~10s at
    // this size). The manual trim must stay far under a generous bound.
    const pathological = `a${".".repeat(100_000)}b e mais algum texto normal.`;
    const startedAt = performance.now();

    const features = extractStylometricFeatures(pathological);

    expect(performance.now() - startedAt).toBeLessThan(2_000);
    expect(features.wordCount).toBeGreaterThan(0);
  });

  it("guards tiny texts instead of firing structural signals", () => {
    const features = extractStylometricFeatures(TINY_TEXT);

    expect(features.contributions.lowSentenceLengthVariation).toBe(0);
    expect(features.contributions.formulaicStructure).toBe(0);
    expect(features.contributions.repetitiveTransitions).toBe(0);
    expect(getStylometricReasonCodes(features)).toEqual([]);
  });

  it("handles empty text without producing invalid numbers", () => {
    const features = extractStylometricFeatures("");

    expect(features.wordCount).toBe(0);
    expect(features.sentence.sentenceCount).toBe(0);
    expect(getStylometricReasonCodes(features)).toEqual([]);
  });
});
