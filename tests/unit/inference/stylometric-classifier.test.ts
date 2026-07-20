import { describe, expect, it } from "vitest";

import { PipelineRunner } from "@/inference/inference-worker";
import {
  STYLOMETRIC_MODEL_KEY,
  StylometricClassifier,
} from "@/inference/stylometric-classifier";
import { resolveMode } from "@/content/presentation/presentation-controller";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type {
  ClassificationResult,
  ReasonCode,
  TextClassifier,
} from "@/shared/types";
import {
  createBuiltinRuntimeIdentity,
  createDecisionOutcome,
  createEvidenceAssessment,
} from "../../helpers/model-fixtures";

const STYLOMETRIC_CODES: ReasonCode[] = [
  "FORMULAIC_STRUCTURE",
  "LOW_SENTENCE_LENGTH_VARIATION",
  "REPETITIVE_TRANSITIONS",
  "LISTICLE_PATTERN",
  "EXCESSIVE_HASHTAGS",
];

/**
 * A real pt-BR LinkedIn post with an obviously LLM-styled cadence (dramatic
 * fragments, "Afinal…"/"Então"/"Meu palpite" transitions, parallel openings)
 * that the previous hash-based mock failed to flag.
 */
const LLM_STYLED_POST =
  "As pessoas vivem perguntando por que o Google está atrás do ChatGPT e " +
  "do Claude. Afinal... O Google inventou o Transformer. Eles contam com " +
  "alguns dos melhores pesquisadores de IA do mundo. Sua infraestrutura é " +
  "praticamente inigualável e infinita. E, definitivamente, não lhes falta " +
  "dinheiro. Orçamento infinito também. Então, o que aconteceu? Meu palpite " +
  "é que o modelo em si nunca foi a maior vantagem. A execução é que foi. " +
  "O alfa da operação deles é a execução e não o modelo em si. A OpenAI se " +
  "obcecou em tornar o ChatGPT um produto que as pessoas realmente " +
  "quisessem usar. A Anthropic se obcecou com qualidade, raciocínio e " +
  "programação. Os modelos chineses no custo e na inovação extrema. O " +
  "Google tinha pesquisas incríveis, mas transformar pesquisa em produtos " +
  "na mesma velocidade é um jogo completamente diferente. Ter o melhor " +
  "artigo científico não significa automaticamente que você vai criar o " +
  "melhor produto.";

/**
 * Human "broetry": the line-broken motivational house style that dominated
 * LinkedIn years before LLMs — one-line paragraphs, anaphora ("Não é sobre
 * X. / Não é sobre Y."), a punchy question and trailing hashtags. A human
 * wrote this shape millions of times; it must NOT cross the 0.8 marking
 * threshold end-to-end (adversarial-review finding: it used to score ~0.85+).
 */
const HUMAN_BROETRY_ANAPHORA_POST = [
  "Em 2019 ouvi um não.",
  "Em 2020 ouvi outro não.",
  "Em 2021 quase desisti de tudo.",
  "",
  "E sabe o que eu fiz?",
  "",
  "Continuei.",
  "",
  "Não é sobre talento.",
  "Não é sobre sorte.",
  "Não é sobre conhecer as pessoas certas.",
  "",
  "É sobre constância.",
  "É sobre aparecer todos os dias.",
  "Mesmo cansado.",
  "Mesmo sem vontade.",
  "Mesmo quando ninguém está olhando.",
  "",
  "Nunca subestime uma pessoa comum com um objetivo claro.",
  "Nunca subestime o poder de um hábito repetido por anos.",
  "",
  "O mercado não premia o mais talentoso.",
  "O mercado premia quem não desiste.",
  "",
  "Hoje lidero um time de vinte pessoas.",
  "E continuo ouvindo não quase toda semana.",
  "",
  "A diferença é que hoje o não me move.",
  "",
  "Concorda?",
  "",
  "#carreira #motivacao #mentalidade #sucesso",
].join("\n");

/**
 * Human hustle-culture broetry with en-dash bullet lines, one discourse
 * connective and hashtags. Also exercises the dash double-count fix: the
 * bullet dashes must be measured only by the listicle signal, never again as
 * prose cadence.
 */
const HUMAN_BROETRY_HUSTLE_POST = [
  "Todo mundo quer o resultado.",
  "Ninguém quer o processo.",
  "",
  "Todo mundo quer o palco.",
  "Ninguém quer o ensaio.",
  "",
  "Todos querem a foto da conquista.",
  "Quase ninguém aguenta a segunda-feira às seis.",
  "",
  "A verdade é que a disciplina cobra caro:",
  "– Acordar às cinco da manhã.",
  "– Treinar antes do expediente.",
  "– Estudar depois do jantar.",
  "– Dormir cedo enquanto todos saem.",
  "",
  "Eu vivi isso na pele por três anos.",
  "Sem atalho.",
  "Sem sorte.",
  "Sem plano B.",
  "",
  "E o resultado?",
  "Hoje colho o que plantei em silêncio.",
  "",
  "O preço da disciplina dói uma vez.",
  "O preço do arrependimento dói para sempre.",
  "",
  "Você escolhe qual dor vai carregar.",
  "",
  "#disciplina #foco #mentalidade #resultados",
].join("\n");

/**
 * A 150+ word, maximally templated post (every stylometric signal firing)
 * used to prove the honesty invariant: even when the heuristic marks a post,
 * the uncalibrated pipeline may never exceed the indicator action ceiling.
 */
const TEMPLATED_MARKETING_POST =
  "Em primeiro lugar, a consistência transforma qualquer carreira profissional. " +
  "Além disso, a disciplina diária constrói resultados sólidos rapidamente. " +
  "Dessa forma, cada hábito pequeno gera um impacto enorme. " +
  "Portanto, comece hoje a organizar sua rotina de trabalho. " +
  "Ou seja: pequenas decisões diárias definem o seu futuro. " +
  "Além disso, a clareza de metas evita distrações caras. " +
  "Então, o que importa? " +
  "A resposta é simples: foco absoluto no processo diário. " +
  "Em resumo, a jornada importa mais que o resultado. " +
  "Por fim, celebre cada vitória pequena do seu progresso. " +
  "No entanto, evite comparar sua rotina com outras pessoas. " +
  "Por outro lado, aceite que o processo leva tempo. " +
  "Afinal, o que fica? " +
  "A verdade é que a constância vence o talento parado. " +
  "Portanto, escolha um sistema simples e repita todos os dias. " +
  "Em suma, resultados extraordinários nascem de rotinas ordinárias repetidas. " +
  "Além disso, a repetição transforma o esforço em resultado consistente. " +
  "#produtividade #carreira #foco #disciplina";

/** A natural, bursty human-style paragraph: varied lengths, no formula. */
const HUMAN_BURSTY_POST =
  "Ontem levei meu filho na escola e acabei conversando quase meia hora " +
  "com a professora dele sobre o campeonato de robótica que a turma quer " +
  "montar no segundo semestre. Saí de lá atrasado, claro, e ainda peguei " +
  "chuva. No caminho para o escritório fui pensando que a gente reclama " +
  "demais de reunião e esquece que boa parte do trabalho de verdade " +
  "acontece nessas conversas de corredor, sem pauta nenhuma. Quando " +
  "cheguei, o time já tinha resolvido o bug que me tirou o sono na " +
  "véspera, e eu nem precisei abrir o notebook.";

function stylometricCodesOf(reasonCodes: readonly ReasonCode[]): ReasonCode[] {
  return reasonCodes.filter((code) => STYLOMETRIC_CODES.includes(code));
}

describe("StylometricClassifier", () => {
  it("scores the LLM-styled post high and explains at least two signals", async () => {
    const classifier = new StylometricClassifier();
    await classifier.initialize();

    const result = await classifier.classify(LLM_STYLED_POST);

    expect(result.aiScore).toBeGreaterThanOrEqual(0.6);
    expect(result.humanScore).toBeCloseTo(1 - result.aiScore, 10);
    expect(result.confidence).toBe("low");
    expect(result.modelId).toBe("stylometric-v1");
    expect(result.backend).toBe("mock");
    expect(result.demo).toBe(true);
    const fired = stylometricCodesOf(result.explanation?.reasonCodes ?? []);
    expect(fired.length).toBeGreaterThanOrEqual(2);
    expect(fired).toEqual(
      expect.arrayContaining(["REPETITIVE_TRANSITIONS", "FORMULAIC_STRUCTURE"]),
    );
  });

  it("scores a bursty human-style paragraph low with at most one signal", async () => {
    const classifier = new StylometricClassifier();
    await classifier.initialize();

    const result = await classifier.classify(HUMAN_BURSTY_POST);

    expect(result.aiScore).toBeLessThanOrEqual(0.45);
    expect(
      stylometricCodesOf(result.explanation?.reasonCodes ?? []).length,
    ).toBeLessThanOrEqual(1);
  });

  it("only ever attaches signal codes it actually computed", async () => {
    const classifier = new StylometricClassifier();
    await classifier.initialize();

    for (const text of [LLM_STYLED_POST, HUMAN_BURSTY_POST, "Texto curto."]) {
      const result = await classifier.classify(text);
      const codes = result.explanation?.reasonCodes ?? [];
      expect(stylometricCodesOf(codes)).toEqual(codes);
      expect(result.aiScore).toBeGreaterThanOrEqual(0.05);
      expect(result.aiScore).toBeLessThanOrEqual(0.95);
    }
  });

  it("returns identical results for identical text", async () => {
    const classifier = new StylometricClassifier();
    await classifier.initialize();

    const first = await classifier.classify(LLM_STYLED_POST);
    const second = await classifier.classify(LLM_STYLED_POST);

    expect(second.aiScore).toBe(first.aiScore);
    expect(second.status).toBe(first.status);
    expect(second.explanation?.reasonCodes).toEqual(
      first.explanation?.reasonCodes,
    );
  });

  it("rejects classification before initialization and after disposal", async () => {
    const classifier = new StylometricClassifier();

    await expect(classifier.classify("texto")).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
    });

    await classifier.initialize();
    await classifier.dispose();

    await expect(classifier.classify("texto")).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
    });
  });

  it("honors an already-aborted signal", async () => {
    const classifier = new StylometricClassifier();
    await classifier.initialize();
    const controller = new AbortController();
    controller.abort();

    await expect(
      classifier.classify("texto", { signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("exposes uncalibrated heuristic metadata", () => {
    expect(new StylometricClassifier().getMetadata()).toMatchObject({
      id: "stylometric-v1",
      version: "1.0.0",
      backend: "mock",
      supportsBatching: false,
    });
  });

  it("derives the cache model key from its own metadata", () => {
    const metadata = new StylometricClassifier().getMetadata();

    expect(STYLOMETRIC_MODEL_KEY).toBe("stylometric-v1:1.0.0");
    expect(STYLOMETRIC_MODEL_KEY).toBe(`${metadata.id}:${metadata.version}`);
  });

  it("caps the uncalibrated stylometric decision at the indicator ceiling", async () => {
    const runner = new PipelineRunner();

    const result = await runner.classify(
      { text: LLM_STYLED_POST, platform: "linkedin", manual: false },
      { ...DEFAULT_SETTINGS, languageMode: "experimental_any" },
    );

    expect(result.runtimeIdentity.kind).toBe("builtin");
    expect(result.decision.actionCeiling).toBe("indicator");
  });
});

describe("stylometric evidence through the worker pipeline", () => {
  it("carries fired signal codes into the final explanation", async () => {
    const runner = new PipelineRunner();

    const result = await runner.classify(
      { text: LLM_STYLED_POST, platform: "linkedin", manual: false },
      { ...DEFAULT_SETTINGS, languageMode: "experimental_any" },
    );

    expect(result.modelId).toBe("stylometric-v1");
    expect(result.explanation?.reasonCodes).toEqual(
      expect.arrayContaining(["REPETITIVE_TRANSITIONS", "FORMULAIC_STRUCTURE"]),
    );
    expect(result.decision?.actionCeiling).toBeDefined();
    expect(result.demo).toBe(true);
  });

  it("does not attach signal codes the classifier never fired", async () => {
    const runner = new PipelineRunner();

    const result = await runner.classify(
      { text: HUMAN_BURSTY_POST, platform: "linkedin", manual: false },
      { ...DEFAULT_SETTINGS, languageMode: "experimental_any" },
    );

    expect(
      stylometricCodesOf(result.explanation?.reasonCodes ?? []).length,
    ).toBeLessThanOrEqual(1);
  });
});

describe("human broetry stays unmarked (honesty regression)", () => {
  const MARKED_STATUSES = ["possibly_ai", "strong_ai_indication"];

  it.each([
    ["anaphora broetry", HUMAN_BROETRY_ANAPHORA_POST],
    ["hustle broetry with dash bullets", HUMAN_BROETRY_HUSTLE_POST],
  ])(
    "never crosses the marking threshold end-to-end for %s",
    async (_name, text) => {
      const runner = new PipelineRunner();

      const result = await runner.classify(
        { text, platform: "linkedin", manual: false },
        DEFAULT_SETTINGS,
      );

      expect(result.decision?.calibratedScore).toBeLessThan(0.8);
      expect(MARKED_STATUSES).not.toContain(result.decision?.status);
      expect(result.decision?.actionCeiling).toBe("indicator");
      // The house style must not be presented as templated-transition
      // evidence: anaphora alone may never fire REPETITIVE_TRANSITIONS.
      expect(result.explanation?.reasonCodes).not.toContain(
        "REPETITIVE_TRANSITIONS",
      );
    },
  );

  it("keeps the LLM-styled post separated from human broetry by a margin", async () => {
    const runner = new PipelineRunner();
    const classify = (text: string) =>
      runner.classify(
        { text, platform: "linkedin", manual: false },
        DEFAULT_SETTINGS,
      );

    const llm = await classify(LLM_STYLED_POST);
    const broetry = await Promise.all([
      classify(HUMAN_BROETRY_ANAPHORA_POST),
      classify(HUMAN_BROETRY_HUSTLE_POST),
    ]);

    for (const human of broetry) {
      expect(llm.aiScore).toBeGreaterThanOrEqual(human.aiScore + 0.1);
      expect(llm.decision!.calibratedScore).toBeGreaterThanOrEqual(
        human.decision!.calibratedScore + 0.1,
      );
    }
    expect(
      stylometricCodesOf(llm.explanation?.reasonCodes ?? []).length,
    ).toBeGreaterThanOrEqual(2);
  });
});

describe("uncalibrated action ceiling through the pipeline", () => {
  it("caps a marked 150+ word post to the indicator ceiling even under presentationMode hide", async () => {
    const runner = new PipelineRunner();
    const settings = { ...DEFAULT_SETTINGS, presentationMode: "hide" as const };

    const result = await runner.classify(
      { text: TEMPLATED_MARKETING_POST, platform: "linkedin", manual: false },
      settings,
    );

    // The post is long enough for the length bucket whose uncapped ceiling
    // would be "hide", and templated enough to be marked.
    expect(result.wordCount).toBeGreaterThanOrEqual(150);
    expect(result.decision?.status).toBe("possibly_ai");
    expect(result.decision?.calibratedScore).toBeGreaterThanOrEqual(0.8);

    // The honesty invariant: an uncalibrated classifier may only indicate.
    expect(result.decision?.actionCeiling).toBe("indicator");

    // And presentation respects it: the user's configured hide/collapse/blur
    // never exceeds the ceiling, so the post is never visually suppressed.
    expect(resolveMode(result, settings)).toBe("indicator");
    for (const mode of ["blur", "collapse"] as const) {
      expect(resolveMode(result, { ...settings, presentationMode: mode })).toBe(
        "indicator",
      );
    }
  });
});

describe("multi-chunk reason-code relay", () => {
  function chunkResult(
    aiScore: number,
    reasonCodes: ReasonCode[],
  ): ClassificationResult {
    return {
      aiScore,
      humanScore: 1 - aiScore,
      confidence: "medium",
      status: "inconclusive",
      wordCount: 50,
      tokenCount: 50,
      runtimeIdentity: createBuiltinRuntimeIdentity(),
      evidence: createEvidenceAssessment(),
      decision: createDecisionOutcome({ status: "inconclusive" }),
      modelVersion: "stub",
      modelId: "stub",
      backend: "mock",
      processingTimeMs: 1,
      demo: true,
      explanation: {
        reasonCodes,
        modelScore: aiScore,
        calibratedScore: aiScore,
        calibrationProfile: "stub",
      },
    };
  }

  function stubClassifier(
    resultForChunk: (chunkIndex: number) => ClassificationResult,
  ): TextClassifier {
    let calls = 0;
    return {
      initialize: async () => undefined,
      classify: async () => resultForChunk(calls++),
      dispose: async () => undefined,
      getMetadata: () => ({
        id: "stub",
        name: "Stub classifier",
        version: "stub",
        backend: "mock",
        supportedLanguages: ["pt"],
        maximumTokens: 256,
        supportsBatching: false,
      }),
    };
  }

  const LONG_MULTI_CHUNK_TEXT = [
    LLM_STYLED_POST,
    LLM_STYLED_POST,
    LLM_STYLED_POST,
  ].join(" ");

  // The relay seam is about splitting a post across several windows, not about
  // the model's 512-token budget; a small editable window keeps the tripled
  // post at three-plus chunks so the majority rule is actually exercised.
  const MULTI_CHUNK_SETTINGS = {
    ...DEFAULT_SETTINGS,
    chunkSizeTokens: 192,
    chunkOverlapTokens: 32,
    maximumTokens: 256,
  };

  it("relays codes that fire on at least half of the chunks", async () => {
    const runner = new PipelineRunner();

    const result = await runner.classify(
      { text: LONG_MULTI_CHUNK_TEXT, platform: "linkedin", manual: false },
      MULTI_CHUNK_SETTINGS,
    );

    // The relay seam must actually be exercised across several chunks.
    expect(result.chunks!.length).toBeGreaterThanOrEqual(3);
    // Every chunk of the tripled post carries the same styled cadence, so the
    // majority-fired codes survive to the final explanation.
    expect(result.explanation?.reasonCodes).toEqual(
      expect.arrayContaining(["REPETITIVE_TRANSITIONS"]),
    );
  });

  it("drops a code observed on a single chunk of a long post", async () => {
    const classifier = stubClassifier((chunkIndex) =>
      chunkResult(
        0.3,
        chunkIndex === 0
          ? ["FORMULAIC_STRUCTURE", "EXCESSIVE_HASHTAGS"]
          : ["FORMULAIC_STRUCTURE"],
      ),
    );
    const runner = new PipelineRunner({ classifier, initialized: true });

    const result = await runner.classify(
      { text: LONG_MULTI_CHUNK_TEXT, platform: "linkedin", manual: false },
      MULTI_CHUNK_SETTINGS,
    );

    expect(result.chunks!.length).toBeGreaterThanOrEqual(3);
    // Fired on every chunk: a whole-post claim the classifier stands behind.
    expect(result.explanation?.reasonCodes).toContain("FORMULAIC_STRUCTURE");
    // Fired on one chunk only: a chunk-local artifact, never asserted about
    // the whole post.
    expect(result.explanation?.reasonCodes).not.toContain("EXCESSIVE_HASHTAGS");
  });
});
