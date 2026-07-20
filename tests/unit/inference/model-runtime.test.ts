import { env } from "@huggingface/transformers";
import { describe, expect, it, vi } from "vitest";

import { bundledModelManifest } from "@/inference/bundled-model-metadata";
import {
  createModelRuntime,
  createTmrChunkPlan,
  ExactTokenizer,
  normalizeCalibrationLocale,
  type LoadedTransformersTokenizer,
} from "@/inference/model-runtime";
import { configureTransformersEnvironment } from "@/inference/transformers-environment";
import type { ClassifierMetadata, TextClassifier } from "@/shared/types";

/**
 * A minimal stand-in for a loaded Transformers.js tokenizer. `specialTokens`
 * are the ids the tokenizer wraps around content when `add_special_tokens` is
 * on; `pieces` maps a text to its content token ids and native char offsets.
 * The double records how it was called so a test can prove the exact tokenizer
 * measured the count instead of hardcoding it.
 */
function fakeTokenizer(options: {
  specialTokens: number[];
  pieces?: Record<string, { ids: number[]; offsets: [number, number][] }>;
}): LoadedTransformersTokenizer & { calls: unknown[] } {
  const calls: unknown[] = [];
  const contentIdsFor = (text: string): { ids: number[]; offsets: [number, number][] } =>
    options.pieces?.[text] ?? {
      ids: text.length === 0 ? [] : [1],
      offsets: text.length === 0 ? [] : [[0, text.length]],
    };
  const tokenizer = ((text: string, callOptions) => {
    calls.push({ text, callOptions });
    const content = contentIdsFor(text);
    const inputIds = callOptions.add_special_tokens
      ? [...options.specialTokens.slice(0, 1), ...content.ids, ...options.specialTokens.slice(1)]
      : content.ids;
    return {
      input_ids: inputIds,
      ...(callOptions.return_offsets_mapping ? { offset_mapping: content.offsets } : {}),
    };
  }) as LoadedTransformersTokenizer & { calls: unknown[] };
  tokenizer.calls = calls;
  return tokenizer;
}

function fakeClassifier(): TextClassifier {
  const metadata: ClassifierMetadata = {
    id: "tmr-ai-text-detector",
    name: "TMR",
    version: bundledModelManifest.modelVersion,
    backend: "wasm",
    supportedLanguages: ["pt"],
    maximumTokens: 512,
    supportsBatching: false,
  };
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    classify: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    getMetadata: () => metadata,
  };
}

describe("normalizeCalibrationLocale", () => {
  it("maps only pt and pt-BR variants to the canonical pt-BR", () => {
    expect(normalizeCalibrationLocale("pt")).toBe("pt-BR");
    expect(normalizeCalibrationLocale("pt-BR")).toBe("pt-BR");
    expect(normalizeCalibrationLocale("PT")).toBe("pt-BR");
    expect(normalizeCalibrationLocale("pt-br")).toBe("pt-BR");
    expect(normalizeCalibrationLocale("PT-br")).toBe("pt-BR");
  });

  it("leaves other locales unsupported", () => {
    expect(normalizeCalibrationLocale("pt-PT")).toBeNull();
    expect(normalizeCalibrationLocale("en")).toBeNull();
    expect(normalizeCalibrationLocale("en-US")).toBeNull();
    expect(normalizeCalibrationLocale("es")).toBeNull();
    expect(normalizeCalibrationLocale("und")).toBeNull();
    expect(normalizeCalibrationLocale("")).toBeNull();
    expect(normalizeCalibrationLocale(null)).toBeNull();
    expect(normalizeCalibrationLocale(undefined)).toBeNull();
  });
});

describe("createTmrChunkPlan", () => {
  it("mirrors the sealed manifest windowing (512/510/64/8)", () => {
    expect(createTmrChunkPlan(bundledModelManifest.windowing)).toEqual({
      modelMaxTokens: 512,
      contentTokens: 510,
      overlapTokens: 64,
      maxWindows: 8,
    });
  });

  it("cross-checks contentTokens against the measured special-token count", () => {
    expect(() => createTmrChunkPlan(bundledModelManifest.windowing, 2)).not.toThrow();
    expect(() => createTmrChunkPlan(bundledModelManifest.windowing, 3)).toThrow();
  });

  it("rejects inconsistent windowing", () => {
    expect(() =>
      createTmrChunkPlan({
        modelMaxTokens: 512,
        contentTokens: 600,
        overlapTokens: 64,
        maxWindows: 8,
      }),
    ).toThrow();
    expect(() =>
      createTmrChunkPlan({
        modelMaxTokens: 512,
        contentTokens: 510,
        overlapTokens: 510,
        maxWindows: 8,
      }),
    ).toThrow();
    expect(() =>
      createTmrChunkPlan({
        modelMaxTokens: 512,
        contentTokens: 510,
        overlapTokens: 64,
        maxWindows: 0,
      }),
    ).toThrow();
  });
});

describe("ExactTokenizer", () => {
  it("measures the special-token count from the loaded tokenizer", () => {
    const tokenizer = fakeTokenizer({ specialTokens: [0, 2] });
    const exact = ExactTokenizer.create(tokenizer);

    expect(exact.specialTokenCount).toBe(2);
    // Proof it was measured, not hardcoded: both add_special_tokens states ran.
    const probeStates = tokenizer.calls.map(
      (call) => (call as { callOptions: { add_special_tokens: boolean } }).callOptions.add_special_tokens,
    );
    expect(probeStates).toContain(true);
    expect(probeStates).toContain(false);
  });

  it("fails closed when the loaded tokenizer reserves a different count than the manifest", () => {
    expect(() => ExactTokenizer.create(fakeTokenizer({ specialTokens: [0] }))).toThrow();
    expect(() =>
      ExactTokenizer.create(fakeTokenizer({ specialTokens: [0, 1, 2] })),
    ).toThrow();
  });

  it("derives content tokens from modelMaxTokens minus the measured special tokens", () => {
    const exact = ExactTokenizer.create(fakeTokenizer({ specialTokens: [0, 2] }));
    expect(512 - exact.specialTokenCount).toBe(510);
  });

  it("returns native offsets without substring reconstruction", () => {
    // Repeated substring: a substring search would map both "ab" tokens to 0..2.
    const tokenizer = fakeTokenizer({
      specialTokens: [0, 2],
      pieces: { abab: { ids: [11, 11], offsets: [[0, 2], [2, 4]] } },
    });
    const exact = ExactTokenizer.create(tokenizer);

    const encoding = exact.encodeWithOffsets("abab");

    expect(encoding.specialTokenCount).toBe(2);
    expect(encoding.inputIds).toEqual([11, 11]);
    expect(encoding.offsets).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
    ]);
    // First offset starts at 0, last offset ends at the string length, no gap.
    expect(encoding.offsets[0]!.start).toBe(0);
    expect(encoding.offsets.at(-1)!.end).toBe("abab".length);
    // Native offsets require return_offsets_mapping on the encode call.
    const encodeCall = tokenizer.calls.at(-1) as {
      callOptions: { return_offsets_mapping?: boolean; add_special_tokens: boolean };
    };
    expect(encodeCall.callOptions.return_offsets_mapping).toBe(true);
    expect(encodeCall.callOptions.add_special_tokens).toBe(false);
  });

  it("keeps multi-token Unicode offsets aligned to the original UTF-16 string", () => {
    const text = "Olá 😀 mundo";
    const tokenizer = fakeTokenizer({
      specialTokens: [0, 2],
      pieces: {
        [text]: {
          ids: [5, 6, 7],
          offsets: [
            [0, 3],
            [4, 6],
            [7, text.length],
          ],
        },
      },
    });
    const exact = ExactTokenizer.create(tokenizer);

    const encoding = exact.encodeWithOffsets(text);

    expect(encoding.offsets).toEqual([
      { start: 0, end: 3 },
      { start: 4, end: 6 },
      { start: 7, end: text.length },
    ]);
    expect(encoding.offsets.at(-1)!.end).toBe(text.length);
  });

  it("rejects an encode when the loaded tokenizer cannot provide offsets", () => {
    const tokenizer = ((text: string, callOptions) => ({
      input_ids: callOptions.add_special_tokens ? [0, 1, 2] : [1],
    })) as LoadedTransformersTokenizer;
    const exact = ExactTokenizer.create(tokenizer);

    expect(() => exact.encodeWithOffsets("texto")).toThrow(
      "MODEL_TOKEN_OFFSETS_UNAVAILABLE",
    );
  });
});

describe("createModelRuntime", () => {
  it("binds the classifier and the exact tokenizer to one asset load", async () => {
    const classifier = fakeClassifier();
    const tokenizer = fakeTokenizer({ specialTokens: [0, 2] });
    const load = vi.fn(async () => ({ classifier, tokenizer }));

    const runtime = await createModelRuntime(load, bundledModelManifest);

    expect(load).toHaveBeenCalledOnce();
    expect(runtime.classifier).toBe(classifier);
    expect(runtime.tokenizer).toBeInstanceOf(ExactTokenizer);
    expect(runtime.tokenizer.specialTokenCount).toBe(2);
    expect(runtime.chunkPlan).toEqual({
      modelMaxTokens: 512,
      contentTokens: 510,
      overlapTokens: 64,
      maxWindows: 8,
    });
    expect(runtime.identity).toMatchObject({
      kind: "bundle",
      modelId: bundledModelManifest.modelId,
      modelVersion: bundledModelManifest.modelVersion,
      bundleDigest: bundledModelManifest.bundleDigest,
      tokenizerDigest: bundledModelManifest.tokenizerDigest,
      aggregationVersion: bundledModelManifest.aggregationVersion,
      contentCompositionVersion: bundledModelManifest.contentCompositionVersion,
    });
  });
});

describe("transformers environment stays extension-local", () => {
  it("keeps remote models disabled and never fetches an http(s) URL", () => {
    const original = {
      fetch: globalThis.fetch,
      allowRemoteModels: env.allowRemoteModels,
      allowLocalModels: env.allowLocalModels,
      localModelPath: env.localModelPath,
    };
    const guardedFetch = vi.fn((input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (/^https?:/iu.test(url)) {
        throw new Error("REMOTE_FETCH_FORBIDDEN");
      }
      return original.fetch(input);
    });
    globalThis.fetch = guardedFetch as unknown as typeof fetch;

    try {
      configureTransformersEnvironment({
        modelBaseUrl: "chrome-extension://abc/models/",
        wasmBaseUrl: "chrome-extension://abc/vendor/transformers-wasm/",
      });

      expect(env.allowRemoteModels).toBe(false);
      expect(env.allowLocalModels).toBe(true);
      expect(env.localModelPath).toBe("chrome-extension://abc/models/");
      // Configuring the environment never reached out to a remote host.
      for (const call of guardedFetch.mock.calls) {
        expect(String(call[0])).not.toMatch(/^https?:/iu);
      }
      // The guard itself rejects any remote host (recorded after the check).
      expect(() => guardedFetch("https://huggingface.co/model.onnx")).toThrow(
        "REMOTE_FETCH_FORBIDDEN",
      );
    } finally {
      globalThis.fetch = original.fetch;
      env.allowRemoteModels = original.allowRemoteModels;
      env.allowLocalModels = original.allowLocalModels;
      env.localModelPath = original.localModelPath;
    }
  });
});
