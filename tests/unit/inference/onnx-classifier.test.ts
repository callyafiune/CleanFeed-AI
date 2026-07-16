import { describe, expect, it, vi } from "vitest";

import {
  OnnxTextClassifier,
  type ModelTokens,
  type TransformersModelGateway,
} from "@/inference/onnx-classifier";
import type { CleanFeedModelManifest } from "@/inference/model-bundle";
import validManifest from "../../fixtures/models/valid/cleanfeed-model.json";

const PORTUGUESE_TEXT = "Este é um texto em português para classificação.";

describe("OnnxTextClassifier", () => {
  it("maps manifest labels instead of assuming output order", async () => {
    const classifier = createClassifier({
      manifest: { ...manifest(), labels: { human: 1, ai: 0 } },
      output: { logits: [[2, -1]] },
    });

    await classifier.initialize();
    const result = await classifier.classify(PORTUGUESE_TEXT);

    expect(result.aiScore).toBeGreaterThan(result.humanScore);
    expect(result.aiScore + result.humanScore).toBeCloseTo(1, 8);
  });

  it.each([
    { logits: [] },
    { logits: [[Number.NaN, 1]] },
    { logits: [[1]] },
    { probabilities: [[0.7, 0.7]] },
  ])("rejects malformed model output %#", async (output) => {
    const classifier = createClassifier({ output });

    await classifier.initialize();

    await expect(classifier.classify(PORTUGUESE_TEXT)).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
    });
  });

  it("rejects probabilities that do not sum to one", async () => {
    const classifier = createClassifier({
      manifest: {
        ...manifest(),
        output: { name: "probabilities", kind: "probabilities" },
      },
      output: { probabilities: [[0.7, 0.7]] },
    });
    await classifier.initialize();

    await expect(classifier.classify(PORTUGUESE_TEXT)).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
    });
  });

  it("exposes manifest metadata and only loads the gateway once", async () => {
    const gateway = new FakeGateway({ logits: [[-1, 2]] });
    const classifier = new OnnxTextClassifier(manifest(), gateway, "wasm");

    await Promise.all([classifier.initialize(), classifier.initialize()]);

    expect(gateway.load).toHaveBeenCalledTimes(1);
    expect(classifier.getMetadata()).toMatchObject({
      id: "cleanfeed-detector-v1",
      version: "1.0.0",
      backend: "wasm",
      maximumTokens: 256,
      supportsBatching: false,
    });
  });

  it("rejects an input that exceeds the model limit after special tokens", async () => {
    const classifier = createClassifier({
      tokens: {
        inputIds: Array.from({ length: 257 }, (_, index) => index),
        specialTokenCount: 2,
        tokenOffsets: [],
      },
    });
    await classifier.initialize();

    await expect(classifier.classify(PORTUGUESE_TEXT)).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
    });
  });

  it("checks an abort signal before tokenization, before the session, and after it", async () => {
    const gateway = new FakeGateway({ logits: [[-1, 2]] });
    const classifier = new OnnxTextClassifier(manifest(), gateway, "wasm");
    await classifier.initialize();

    const beforeTokenization = new AbortController();
    beforeTokenization.abort();
    await expect(
      classifier.classify(PORTUGUESE_TEXT, {
        signal: beforeTokenization.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(gateway.tokenize).not.toHaveBeenCalled();

    const beforeSession = new AbortController();
    gateway.tokenize.mockImplementationOnce(async () => {
      beforeSession.abort();
      return {
        inputIds: [101, 1, 102],
        specialTokenCount: 2,
        tokenOffsets: [{ start: 0, end: 1 }],
      };
    });
    await expect(
      classifier.classify(PORTUGUESE_TEXT, { signal: beforeSession.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(gateway.run).not.toHaveBeenCalled();

    const afterSession = new AbortController();
    gateway.run.mockImplementationOnce(async () => {
      afterSession.abort();
      return { logits: [[-1, 2]] };
    });
    await expect(
      classifier.classify(PORTUGUESE_TEXT, { signal: afterSession.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  it("disposes the gateway at most once", async () => {
    const gateway = new FakeGateway({ logits: [[-1, 2]] });
    const classifier = new OnnxTextClassifier(manifest(), gateway, "wasm");
    await classifier.initialize();

    await Promise.all([classifier.dispose(), classifier.dispose()]);

    expect(gateway.dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans a pending initialization and can initialize a new session afterward", async () => {
    const firstLoad = deferred<undefined>();
    const gateway = new FakeGateway({ logits: [[-1, 2]] });
    gateway.load.mockImplementationOnce(() => firstLoad.promise);
    const classifier = new OnnxTextClassifier(manifest(), gateway, "wasm");

    const initializing = classifier.initialize();
    const disposing = classifier.dispose();
    firstLoad.resolve(undefined);
    await Promise.all([initializing, disposing]);

    expect(gateway.dispose).toHaveBeenCalledTimes(1);
    await expect(classifier.classify(PORTUGUESE_TEXT)).rejects.toMatchObject({
      code: "INFERENCE_FAILED",
    });

    await classifier.initialize();

    expect(gateway.load).toHaveBeenCalledTimes(2);
    await expect(classifier.classify(PORTUGUESE_TEXT)).resolves.toMatchObject({
      aiScore: expect.any(Number),
    });
  });

  it("waits for disposal and a live reload before resolving a concurrent initialize", async () => {
    const firstLoad = deferred<undefined>();
    const secondLoad = deferred<undefined>();
    const gateway = new FakeGateway({ logits: [[-1, 2]] });
    gateway.load
      .mockImplementationOnce(() => firstLoad.promise)
      .mockImplementationOnce(() => secondLoad.promise);
    const classifier = new OnnxTextClassifier(manifest(), gateway, "wasm");

    const firstInitialize = classifier.initialize();
    const disposing = classifier.dispose();
    const secondInitialize = classifier.initialize();
    let secondResolved = false;
    void secondInitialize.then(() => {
      secondResolved = true;
    });

    firstLoad.resolve(undefined);
    await Promise.all([firstInitialize, disposing]);

    expect(secondResolved).toBe(false);
    expect(gateway.load).toHaveBeenCalledTimes(2);
    secondLoad.resolve(undefined);
    await secondInitialize;

    expect(secondResolved).toBe(true);
    await expect(classifier.classify(PORTUGUESE_TEXT)).resolves.toMatchObject({
      aiScore: expect.any(Number),
    });
  });
});

class FakeGateway implements TransformersModelGateway {
  readonly load = vi.fn(async () => undefined);
  readonly tokenize = vi.fn(async () => this.tokens);
  readonly run = vi.fn(async () => this.output);
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
  manifest: modelManifest = manifest(),
  output = { logits: [[-1, 2]] },
  tokens,
}: {
  manifest?: CleanFeedModelManifest;
  output?: Record<string, unknown>;
  tokens?: ModelTokens;
} = {}): OnnxTextClassifier {
  return new OnnxTextClassifier(
    modelManifest,
    new FakeGateway(output, tokens),
    "wasm",
  );
}

function manifest(): CleanFeedModelManifest {
  return structuredClone(validManifest) as CleanFeedModelManifest;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}
