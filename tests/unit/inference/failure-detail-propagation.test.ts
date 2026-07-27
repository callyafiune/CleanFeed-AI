import { describe, expect, it, vi } from "vitest";

import { aggregateWindowsV2, type WindowScore } from "@/inference/aggregator";
import type { CleanFeedModelManifest } from "@/inference/model-bundle";
import {
  OnnxTextClassifier,
  type ModelTokens,
  type TransformersModelGateway,
} from "@/inference/onnx-classifier";
import { CleanFeedError } from "@/shared/errors";

import {
  sanitizeFailureDetail,
  isSanitizedFailureDetail,
  UNCLASSIFIED_FAILURE_DETAIL_CODE,
} from "../../../contracts/failure-detail.ts";
import validManifest from "../../fixtures/models/valid/cleanfeed-model.json";

// The three origins that used to collapse into one opaque INFERENCE_FAILED:
// the two aggregator branches and the ONNX classifier wrapper. Each must reach
// the prediction row as a DISTINCT, non-empty, sanitized detail — otherwise no
// correction can be more than a guess.

const PORTUGUESE_TEXT = "Este é um texto em português para classificação.";

// Stands in for corpus text that an underlying runtime error might echo back.
const DOCUMENT_EXCERPT =
  "Considerando o disposto no artigo quinto da resolução vigente, a comissão " +
  "deliberou pelo arquivamento imediato do processo administrativo.";

function detailOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return sanitizeFailureDetail(error);
  }
  throw new Error("expected the call to throw");
}

async function detailOfAsync(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return sanitizeFailureDetail(error);
  }
  throw new Error("expected the call to reject");
}

describe("aggregateWindowsV2 failure codes", () => {
  const window = (rawScore: number): WindowScore[] => [
    { index: 0, tokenStart: 0, tokenEnd: 10, rawScore },
  ];

  it("gives the non-finite score and the zero-weight branch distinct codes", () => {
    const nonFinite = detailOf(() =>
      aggregateWindowsV2(window(Number.NaN), 10),
    );
    const outOfRange = detailOf(() => aggregateWindowsV2(window(1.01), 10));
    const zeroWeight = detailOf(() =>
      aggregateWindowsV2(
        [{ index: 0, tokenStart: 5, tokenEnd: 5, rawScore: 0.5 }],
        10,
      ),
    );
    const badTotal = detailOf(() => aggregateWindowsV2(window(0.5), 0));

    expect(nonFinite).toBe("NON_FINITE_SCORE");
    expect(outOfRange).toBe("SCORE_OUT_OF_RANGE");
    expect(zeroWeight).toBe("ZERO_UNIQUE_TOKEN_WEIGHT");
    expect(badTotal).toBe("INVALID_TOTAL_TOKEN_COUNT");
    expect(new Set([nonFinite, outOfRange, zeroWeight, badTotal]).size).toBe(4);
    for (const detail of [nonFinite, outOfRange, zeroWeight, badTotal]) {
      expect(isSanitizedFailureDetail(detail)).toBe(true);
    }
  });

  it("keeps the coded error class so existing recovery still recognizes it", () => {
    expect(() => aggregateWindowsV2(window(Number.NaN), 10)).toThrowError(
      expect.objectContaining({ code: "INFERENCE_FAILED" }),
    );
    expect(() =>
      aggregateWindowsV2(
        [{ index: 0, tokenStart: 5, tokenEnd: 5, rawScore: 0.5 }],
        10,
      ),
    ).toThrowError(expect.objectContaining({ code: "INFERENCE_FAILED" }));
  });
});

describe("OnnxTextClassifier failure causes", () => {
  it("preserves the underlying cause instead of discarding it", async () => {
    const underlying = new Error("Aborted(). RuntimeError: out of memory");
    const gateway = new FakeGateway({ logits: [[-1, 2]] });
    gateway.run.mockRejectedValueOnce(underlying);
    const classifier = new OnnxTextClassifier(manifest(), gateway, "wasm");
    await classifier.initialize();

    const rejection = await classifier
      .classify(PORTUGUESE_TEXT)
      .then(() => undefined)
      .catch((error: unknown) => error);

    expect(rejection).toBeInstanceOf(CleanFeedError);
    expect((rejection as CleanFeedError).code).toBe("INFERENCE_FAILED");
    expect((rejection as Error).cause).toBe(underlying);
    expect(sanitizeFailureDetail(rejection)).toBe("WASM_OOM");
  });

  it("distinguishes the token limit from a merely malformed input length", async () => {
    const overLimit = await detailOfAsync(async () => {
      const classifier = createClassifier({
        tokens: {
          inputIds: Array.from({ length: 257 }, (_unused, index) => index),
          specialTokenCount: 2,
          tokenOffsets: [],
        },
      });
      await classifier.initialize();
      return classifier.classify(PORTUGUESE_TEXT);
    });
    const malformed = await detailOfAsync(async () => {
      const classifier = createClassifier({
        tokens: {
          inputIds: [101, 11, 102],
          specialTokenCount: 9,
          tokenOffsets: [],
        },
      });
      await classifier.initialize();
      return classifier.classify(PORTUGUESE_TEXT);
    });

    expect(overLimit).toBe(
      "TOKEN_LIMIT_EXCEEDED: Model input exceeds the model token limit.",
    );
    expect(malformed).toBe(
      "INVALID_MODEL_INPUT_LENGTH: Model input has an invalid length.",
    );
  });

  it("never lets an underlying error echo document text into the detail", async () => {
    const gateway = new FakeGateway({ logits: [[-1, 2]] });
    gateway.run.mockRejectedValueOnce(
      new Error(`tokenizer failed on input: ${DOCUMENT_EXCERPT}`),
    );
    const classifier = new OnnxTextClassifier(manifest(), gateway, "wasm");
    await classifier.initialize();

    const detail = await detailOfAsync(() =>
      classifier.classify(PORTUGUESE_TEXT),
    );

    // The wrapper's own message is allowlisted, so the detail stays readable —
    // but nothing from the document reaches it.
    expect(detail).toBe("ONNX_INFERENCE_FAILED: ONNX inference failed.");
    for (const word of ["artigo", "comissão", "arquivamento", "processo"]) {
      expect(detail).not.toContain(word);
    }
    expect(detail).not.toBe("");
    expect(detail).not.toBe(UNCLASSIFIED_FAILURE_DETAIL_CODE);
  });
});

class FakeGateway implements TransformersModelGateway {
  readonly load = vi.fn(async () => undefined);
  readonly tokenize = vi.fn(async () => this.tokens);
  readonly run = vi.fn(
    async (): Promise<Record<string, unknown>> => this.output,
  );
  readonly dispose = vi.fn(async () => undefined);

  constructor(
    private output: Record<string, unknown>,
    private readonly tokens: ModelTokens = {
      inputIds: [101, 11, 12, 102],
      specialTokenCount: 2,
      tokenOffsets: [
        { start: 0, end: 1 },
        { start: 1, end: 2 },
      ],
    },
  ) {}
}

function createClassifier({
  tokens,
}: { tokens?: ModelTokens } = {}): OnnxTextClassifier {
  return new OnnxTextClassifier(
    manifest(),
    new FakeGateway({ logits: [[-1, 2]] }, tokens),
    "wasm",
  );
}

function manifest(): CleanFeedModelManifest {
  return structuredClone(validManifest) as CleanFeedModelManifest;
}
