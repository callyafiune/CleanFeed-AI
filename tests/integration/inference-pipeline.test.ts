import { describe, expect, it, vi } from "vitest";

import { PipelineRunner } from "@/inference/inference-worker";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type {
  BatchTextClassifier,
  ClassificationOptions,
  ClassificationResult,
  ClassifierMetadata,
} from "@/shared/types";

const PORTUGUESE_LONG_TEXT = Array.from(
  { length: 260 },
  () =>
    "O conteúdo da publicação explica como as pessoas podem colaborar com atenção.",
).join(" ");

function result(
  text: string,
  options?: ClassificationOptions,
): ClassificationResult {
  return {
    aiScore: 0.86,
    humanScore: 0.14,
    confidence: "medium",
    status: "possibly_ai",
    wordCount: text.split(/\s+/u).length,
    tokenCount: text.split(/\s+/u).length,
    language: options?.language,
    modelVersion: "test",
    modelId: "test",
    backend: "mock",
    processingTimeMs: 1,
    demo: true,
  };
}

function classifier(supportsBatching = false): BatchTextClassifier {
  const metadata: ClassifierMetadata = {
    id: "test",
    name: "Test classifier",
    version: "test",
    backend: "mock",
    supportedLanguages: ["pt"],
    maximumTokens: 256,
    supportsBatching,
  };

  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    classify: vi.fn(async (text: string, options?: ClassificationOptions) =>
      result(text, options),
    ),
    classifyBatch: vi.fn(
      async (texts: string[], options?: ClassificationOptions) =>
        texts.map((text) => result(text, options)),
    ),
    dispose: vi.fn().mockResolvedValue(undefined),
    getMetadata: vi.fn(() => metadata),
  };
}

describe("inference pipeline", () => {
  it("runs language, tokenization, chunks, classification, aggregation and calibration", async () => {
    const runner = new PipelineRunner({ classifier: classifier() });

    const classified = await runner.classify(
      { text: PORTUGUESE_LONG_TEXT, platform: "linkedin", manual: false },
      DEFAULT_SETTINGS,
    );

    expect(classified.language).toBe("pt");
    expect(classified.tokenCount).toBeGreaterThan(192);
    expect(classified.chunks?.length).toBeGreaterThan(1);
    expect(classified.aggregation).toBeDefined();
    expect(classified.explanation?.calibrationProfile).toMatch(/linkedin:pt:/u);
    expect(classified.processingTimeMs).toBeGreaterThanOrEqual(0);
  });

  it("batches only when the classifier declares support", async () => {
    const batchClassifier = classifier(true);
    const runner = new PipelineRunner({ classifier: batchClassifier });

    await runner.classifyBatch(
      [
        { text: PORTUGUESE_LONG_TEXT, platform: "linkedin", manual: false },
        { text: PORTUGUESE_LONG_TEXT, platform: "linkedin", manual: false },
      ],
      DEFAULT_SETTINGS,
    );

    expect(batchClassifier.classifyBatch).toHaveBeenCalledOnce();
  });

  it("returns typed insufficient evidence for a language-policy abstention", async () => {
    const runner = new PipelineRunner({ classifier: classifier() });

    await expect(
      runner.classify(
        {
          text: Array.from({ length: 120 }, () => "the and with").join(" "),
          platform: "linkedin",
          manual: false,
        },
        DEFAULT_SETTINGS,
      ),
    ).resolves.toMatchObject({
      status: "insufficient_evidence",
      decision: { abstained: true, reasonCodes: ["INSUFFICIENT_EVIDENCE"] },
      explanation: { reasonCodes: ["INSUFFICIENT_EVIDENCE"] },
    });
  });

  it("partitions experimental mixed-language requests before classifier batching", async () => {
    const batchClassifier = classifier(true);
    const runner = new PipelineRunner({ classifier: batchClassifier });
    await runner.classifyBatch(
      [
        { text: PORTUGUESE_LONG_TEXT, platform: "linkedin", manual: false },
        {
          text: Array.from(
            { length: 260 },
            () => "the and with a person writes clearly",
          ).join(" "),
          platform: "linkedin",
          manual: false,
        },
      ],
      { ...DEFAULT_SETTINGS, languageMode: "experimental_any" },
    );
    expect(batchClassifier.classifyBatch).toHaveBeenCalledTimes(2);
    const calls = (
      batchClassifier.classifyBatch as unknown as {
        mock: { calls: [unknown, ClassificationOptions | undefined][] };
      }
    ).mock.calls;
    expect(calls.map((call) => call[1]?.language).sort()).toEqual([
      "pt",
      "und",
    ]);
  });
});
