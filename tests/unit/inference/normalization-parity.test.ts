// Three things the contract's own unit tests cannot prove, because they are
// properties of the WIRING rather than of `normalizeForInference`:
//
//   1. the PRODUCTION pipeline really scores a homoglyph variant identically —
//      the acceptance criterion "same text in a homoglyph variant produces an
//      equivalent score within a declared tolerance", measured end to end with a
//      classifier whose score is a pure function of the text it is handed, so a
//      missing normalization moves the number;
//   2. `src/inference` and `src/model-benchmark` route their text through the ONE
//      shared implementation, and neither tokenizes the caller's raw text;
//   3. a CJK ideograph survives the offset tiling across MULTIPLE windows. A2
//      recorded that `mix_src_wikipedia_pt_d3e3087c4ae9` passed only because it
//      fitted in a single window, so the single-window case proves nothing.
//
// (2) reads the two entrypoints from disk relative to the project root, so it
// stays in the default jsdom environment with the pipeline test.

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cwd } from "node:process";

import { describe, expect, it, vi } from "vitest";

import {
  buildContentWindows,
  fitWindowSlice,
  selectDistributedWindows,
} from "@/inference/chunker";
import { PipelineRunner } from "@/inference/inference-worker";
import {
  createTmrChunkPlan,
  ExactTokenizer,
} from "@/inference/model-runtime";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type {
  ClassificationOptions,
  ClassificationResult,
  ClassifierMetadata,
  TextClassifier,
} from "@/shared/types";
import { HOMOGLYPH_SCORE_TOLERANCE } from "../../../contracts/text-normalization";
import { fakeWordPieceTokenizer } from "../../helpers/wordpiece-tokenizer";

/** `src_wikipedia_pt_873ca2935fa4`, real corpus text, repeated to clear 100 words. */
const PARAGRAPH =
  "Mário Raul de Morais Andrade foi um poeta, romancista, musicólogo, " +
  "historiador de arte, crítico e fotógrafo brasileiro, e um dos fundadores " +
  "do modernismo no país.";
const PORTUGUESE_TEXT = Array.from({ length: 8 }, () => PARAGRAPH).join(" ");

/**
 * The RAID-style substitutions, written out here rather than imported. Note
 * that Cyrillic `Р` (U+0420) is a confusable of Latin `P`, NOT of `R`, so `R`
 * has no entry: an attacker cannot disguise it with this script.
 */
const ATTACK: Readonly<Record<string, string>> = {
  a: "а",
  c: "с",
  e: "е",
  i: "і",
  o: "о",
  p: "р",
  s: "ѕ",
  M: "М",
};

function homoglyphVariant(text: string): string {
  return [...text].map((char) => ATTACK[char] ?? char).join("");
}

/**
 * A deterministic classifier whose `aiScore` is a pure function of the text it
 * receives, so two runs agree ONLY when the text handed to it was identical.
 * That is what makes the score-equivalence assertion a real measurement instead
 * of a constant compared with itself.
 */
function textDerivedClassifier(): TextClassifier & {
  seen: string[];
} {
  const seen: string[] = [];
  const metadata: ClassifierMetadata = {
    id: "text-derived",
    name: "Text-derived scorer",
    version: "1.0.0",
    backend: "mock",
    supportedLanguages: ["pt"],
    maximumTokens: 512,
    supportsBatching: false,
  };
  const score = (text: string): number => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0) / 0x100000000;
  };
  return {
    seen,
    initialize: vi.fn().mockResolvedValue(undefined),
    dispose: vi.fn().mockResolvedValue(undefined),
    getMetadata: () => metadata,
    classify: (text: string, options?: ClassificationOptions) => {
      seen.push(text);
      const aiScore = score(text);
      return Promise.resolve({
        aiScore,
        humanScore: 1 - aiScore,
        confidence: "medium",
        status: "possibly_ai",
        wordCount: 0,
        tokenCount: 0,
        language: options?.language,
        runtimeIdentity: {
          kind: "builtin",
          modelId: "mock",
          modelVersion: "1.0.0",
          implementationVersion: "text-derived-v1",
        },
        evidence: {
          quality: "limited",
          coverage: 1,
          lexicalRatio: 1,
          truncated: false,
          exactTokenizer: false,
          reasonCodes: [],
        },
        decision: {
          status: "possibly_ai",
          calibratedScore: aiScore,
          actionCeiling: "indicator",
          abstained: false,
          presentationAllowed: true,
          triggers: [],
          reasonCodes: [],
        },
        modelVersion: "1.0.0",
        modelId: "text-derived",
        backend: "mock",
        processingTimeMs: 1,
        demo: true,
      } satisfies ClassificationResult);
    },
  };
}

async function scoreThroughPipeline(text: string): Promise<{
  documentRawScore: number | undefined;
  chunkTexts: string[];
}> {
  const classifier = textDerivedClassifier();
  const runner = new PipelineRunner({ classifier, initialized: true });
  const result = await runner.classify(
    { text, platform: "generic", manual: false },
    DEFAULT_SETTINGS,
  );
  return {
    documentRawScore: result.aggregation?.documentRawScore,
    chunkTexts: classifier.seen,
  };
}

describe("the production pipeline is normalization-invariant", () => {
  it("scores a homoglyph variant within the declared tolerance", async () => {
    const attacked = homoglyphVariant(PORTUGUESE_TEXT);
    expect(attacked).not.toBe(PORTUGUESE_TEXT);

    const clean = await scoreThroughPipeline(PORTUGUESE_TEXT);
    const variant = await scoreThroughPipeline(attacked);

    expect(clean.documentRawScore).toBeTypeOf("number");
    // The classifier saw the SAME text in both runs — that is WHY the scores
    // agree, and it is the property the normalization actually provides.
    expect(variant.chunkTexts).toEqual(clean.chunkTexts);
    expect(
      Math.abs(variant.documentRawScore! - clean.documentRawScore!),
    ).toBeLessThanOrEqual(HOMOGLYPH_SCORE_TOLERANCE);
  });

  it("would have scored differently without the normalization", async () => {
    // The measurement that makes the assertion above meaningful: the classifier
    // is genuinely text-sensitive, so an unnormalized variant DOES move it.
    const clean = await scoreThroughPipeline(PORTUGUESE_TEXT);
    const unrelated = await scoreThroughPipeline(
      PORTUGUESE_TEXT.replace("Mário", "Mario"),
    );
    expect(unrelated.documentRawScore).not.toBe(clean.documentRawScore);
  });
});

describe("both inference entrypoints use the one shared normalizer", () => {
  async function source(relative: string): Promise<string> {
    return readFile(join(cwd(), ...relative.split("/")), "utf8");
  }

  it("imports normalizeForInference from the shared contract in both", async () => {
    for (const path of [
      "src/inference/inference-worker.ts",
      "src/model-benchmark/main.ts",
    ]) {
      const text = await source(path);
      expect(text, path).toContain("normalizeForInference");
      expect(text, path).toContain('"../../contracts/text-normalization"');
    }
  });

  it("never hands the caller's raw text to the tokenizer", async () => {
    const worker = await source("src/inference/inference-worker.ts");
    expect(worker).toContain("this.tokenizer.encode(normalized.text");
    expect(worker).not.toContain("this.tokenizer.encode(request.text");
    expect(worker).toContain("createTextChunks(\n      normalized.text,");

    const benchmark = await source("src/model-benchmark/main.ts");
    expect(benchmark).toContain("const normalized = normalizeForInference(");
    expect(benchmark).not.toContain("encodeWithOffsets(rawText)");
  });
});

describe("CJK survives the offset tiling across multiple windows", () => {
  // The sentence is `mix_src_wikipedia_pt_d3e3087c4ae9`'s opening, verbatim, and
  // it is repeated so the token stream needs SEVERAL windows: A2 measured that
  // the single-window case hid the defect rather than fixing it.
  const SENTENCE =
    "Hanamaki (花巻市; -shi) é uma cidade japonesa localizada na província de Iwate.";
  const TEXT = Array.from({ length: 6 }, () => SENTENCE).join(" ");

  function exactTokenizer(): ExactTokenizer {
    return ExactTokenizer.create(
      fakeWordPieceTokenizer({
        Hanamaki: ["Hana", "##maki"],
        shi: ["shi"],
        é: ["é"],
        uma: ["uma"],
        cidade: ["cidade"],
        japonesa: ["japo", "##nesa"],
        localizada: ["local", "##izada"],
        na: ["na"],
        província: ["pro", "##víncia"],
        de: ["de"],
        Iwate: ["I", "##wate"],
      }),
    );
  }

  it("tiles every window and keeps each ideograph's own offsets", () => {
    const tokenizer = exactTokenizer();
    const encoding = tokenizer.encodeWithOffsets(TEXT);
    const plan = createTmrChunkPlan(
      { modelMaxTokens: 34, contentTokens: 32, overlapTokens: 4, maxWindows: 8 },
      encoding.specialTokenCount,
    );
    const selection = selectDistributedWindows(
      buildContentWindows(encoding.inputIds.length, plan),
      plan.maxWindows,
    );
    expect(selection.candidateWindowCount).toBeGreaterThan(1);

    const maxContentTokens = plan.modelMaxTokens - encoding.specialTokenCount;
    const countContentTokens = (slice: string): number =>
      tokenizer.encodeWithOffsets(slice).inputIds.length;
    for (const candidate of selection.selectedWindows) {
      const fitted = fitWindowSlice(
        TEXT,
        encoding.offsets,
        candidate,
        maxContentTokens,
        countContentTokens,
      );
      // No window is the whole document: that is exactly what the coarse
      // fallback used to produce, and `fitWindowSlice` refuses it as
      // WINDOW_SLICE_NOT_REDUCIBLE once a document needs more than one window.
      expect(fitted.text.length).toBeLessThan(TEXT.length);
      expect(countContentTokens(fitted.text)).toBeLessThanOrEqual(
        maxContentTokens,
      );
    }

    // Each ideograph token still owns exactly its own character.
    const ideographs = encoding.offsets
      .map(({ start, end }) => TEXT.slice(start, end))
      .filter((slice) => /^[一-鿿]$/u.test(slice));
    expect(ideographs).toEqual(
      Array.from({ length: 6 }, () => ["花", "巻", "市"]).flat(),
    );
  });
});
