import { describe, expect, it, vi } from "vitest";

import {
  installInferenceWorker,
  PipelineRunner,
  type InferenceWorkerScope,
} from "@/inference/inference-worker";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { Tokenizer } from "@/inference/tokenizer";
import type { CleanFeedModelManifest } from "@/inference/model-bundle";
import type {
  BatchTextClassifier,
  ClassificationOptions,
  ClassificationResult,
  ClassifierMetadata,
  TextClassifier,
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
    runtimeIdentity: {
      kind: "builtin",
      modelId: "stylometric",
      modelVersion: "1.0.0",
      implementationVersion: "stylometric-v1",
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
      calibratedScore: 0.86,
      actionCeiling: "hide",
      abstained: false,
      presentationAllowed: true,
      triggers: [],
      reasonCodes: [],
    },
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

const localManifest: CleanFeedModelManifest = {
  schemaVersion: 1,
  id: "cleanfeed-local-v1",
  name: "CleanFeed local model",
  version: "1.0.0",
  task: "ai_text_detection",
  architecture: "bert",
  modelPath: "onnx/model_int8.onnx",
  tokenizerPath: "tokenizer.json",
  configPath: "config.json",
  supportedLanguages: ["pt"],
  maximumTokens: 256,
  quantization: "int8",
  labels: { human: 0, ai: 1 },
  output: { name: "logits", kind: "logits" },
  license: "Apache-2.0",
  source: "local fixture",
  calibrationVersion: "1",
  sha256: {
    model: "a".repeat(64),
    tokenizer: "b".repeat(64),
    config: "c".repeat(64),
  },
};

function localClassifier(backend: "wasm" | "webgpu"): TextClassifier {
  return {
    ...classifier(),
    getMetadata: () => ({
      id: localManifest.id,
      name: localManifest.name,
      version: localManifest.version,
      backend,
      quantization: localManifest.quantization,
      supportedLanguages: localManifest.supportedLanguages,
      maximumTokens: localManifest.maximumTokens,
      supportsBatching: false,
    }),
  };
}

function workerScope(): InferenceWorkerScope & {
  dispatch(message: unknown): void;
  messages: unknown[];
} {
  let listener: ((event: MessageEvent<unknown>) => void) | undefined;
  const messages: unknown[] = [];
  return {
    addEventListener: (_type, registered) => {
      listener = registered;
    },
    postMessage: (message) => {
      messages.push(message);
    },
    dispatch: (message) => {
      listener?.({ data: message } as MessageEvent<unknown>);
    },
    messages,
  };
}

function workerBatch(requests: { requestId: string; text: string }[]) {
  return {
    type: "CLASSIFY" as const,
    requestId: requests[0]!.requestId,
    payload: {
      requests: requests.map(({ requestId, text }) => ({
        requestId,
        payload: {
          text,
          platform: "linkedin",
          manual: false,
          settings: { ...DEFAULT_SETTINGS, batchingEnabled: true },
        },
      })),
    },
  };
}

function waitForWorkerMessage(
  scope: ReturnType<typeof workerScope>,
  predicate: (message: unknown) => boolean,
): Promise<unknown> {
  return vi.waitFor(() => {
    const message = scope.messages.find(predicate);
    expect(message, JSON.stringify(scope.messages)).toBeDefined();
    return message;
  });
}

async function initializeWorker(scope: ReturnType<typeof workerScope>) {
  scope.dispatch({
    type: "INITIALIZE",
    requestId: "worker-initialize",
    payload: {
      modelBaseUrl: "chrome-extension://test/models/",
      wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
    },
  });
  await waitForWorkerMessage(
    scope,
    (message) =>
      (message as { type?: string; requestId?: string }).type === "STATUS" &&
      (message as { requestId?: string }).requestId === "worker-initialize" &&
      (message as { payload?: { state?: string } }).payload?.state === "ready",
  );
}

describe("inference pipeline", () => {
  it("configures extension-local Transformer assets before worker initialization", async () => {
    const runner = new PipelineRunner({ classifier: classifier() });
    const configure = vi.fn();
    const scope = workerScope();
    const initialize = vi.spyOn(runner, "initialize");
    installInferenceWorker(scope, () => runner, configure);

    scope.dispatch({
      type: "INITIALIZE",
      requestId: "worker-initialize",
      payload: {
        modelBaseUrl: "chrome-extension://test/models/",
        wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
      },
    });

    await waitForWorkerMessage(
      scope,
      (message) =>
        (message as { type?: string; requestId?: string }).type === "STATUS" &&
        (message as { requestId?: string }).requestId === "worker-initialize" &&
        (message as { payload?: { state?: string } }).payload?.state ===
          "ready",
    );
    expect(configure).toHaveBeenCalledWith({
      modelBaseUrl: "chrome-extension://test/models/",
      wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
    });
    expect(configure.mock.invocationCallOrder[0]).toBeLessThan(
      initialize.mock.invocationCallOrder[0]!,
    );
  });

  it("selects a local WASM classifier after WebGPU fallback and reports its real lifecycle status", async () => {
    const gpu = localClassifier("webgpu");
    vi.mocked(gpu.initialize).mockRejectedValue(new Error("GPU unavailable"));
    const wasm = localClassifier("wasm");
    const scope = workerScope();
    const configure = vi.fn();
    installInferenceWorker(scope, () => new PipelineRunner(), configure, {
      hasWebGpu: () => true,
      backendFactory: () => ({
        webgpu: vi.fn(() => gpu),
        wasm: vi.fn(() => wasm),
      }),
    });

    scope.dispatch({
      type: "INITIALIZE",
      requestId: "select-local-model",
      payload: {
        modelBaseUrl: "chrome-extension://test/models/",
        wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
        modelManifest: localManifest,
        settings: {
          backendPreference: "webgpu",
          webGpuEnabled: true,
          wasmEnabled: true,
        },
      },
    });

    await waitForWorkerMessage(
      scope,
      (message) =>
        (message as { type?: string; requestId?: string }).type === "STATUS" &&
        (message as { requestId?: string }).requestId ===
          "select-local-model" &&
        (message as { payload?: { state?: string } }).payload?.state ===
          "ready",
    );
    expect(gpu.dispose).toHaveBeenCalledOnce();
    expect(scope.messages).toContainEqual({
      type: "STATUS",
      requestId: "select-local-model",
      payload: expect.objectContaining({
        state: "ready",
        backend: "wasm",
        // The test's local classifier is a fake without a bundle identity, so
        // the pipeline reports a builtin identity carrying the manifest's
        // version/id. The behavioural point is that the local model's
        // coordinates and the WebGPU fallback both surface on the status.
        runtimeIdentity: expect.objectContaining({
          modelVersion: localManifest.version,
          implementationVersion: localManifest.id,
        }),
        reasonCodes: ["WEBGPU_FALLBACK"],
      }),
    });
    expect(configure).toHaveBeenCalledWith(
      expect.objectContaining({ modelManifest: localManifest }),
    );
  });

  it("waits for asynchronous runtime configuration before immediate classification", async () => {
    const runner = new PipelineRunner({ classifier: classifier() });
    let finishConfiguration: (() => void) | undefined;
    const configure = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishConfiguration = resolve;
        }),
    );
    const initialize = vi.spyOn(runner, "initialize");
    const scope = workerScope();
    installInferenceWorker(scope, () => runner, configure);

    scope.dispatch({
      type: "INITIALIZE",
      requestId: "worker-initialize",
      payload: {
        modelBaseUrl: "chrome-extension://test/models/",
        wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
      },
    });
    scope.dispatch({
      type: "CLASSIFY",
      requestId: "queued-until-ready",
      payload: {
        text: PORTUGUESE_LONG_TEXT,
        platform: "linkedin",
        manual: false,
      },
    });

    await Promise.resolve();
    expect(initialize).not.toHaveBeenCalled();
    finishConfiguration?.();
    await waitForWorkerMessage(
      scope,
      (message) =>
        (message as { type?: string; requestId?: string }).type === "RESULT" &&
        (message as { requestId?: string }).requestId === "queued-until-ready",
    );
    expect(configure.mock.invocationCallOrder[0]).toBeLessThan(
      initialize.mock.invocationCallOrder[0]!,
    );
  });

  it("leaves no active runner when disposal is requested during configuration", async () => {
    const activeClassifier = classifier();
    const runner = new PipelineRunner({ classifier: activeClassifier });
    let finishConfiguration: (() => void) | undefined;
    const configure = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finishConfiguration = resolve;
        }),
    );
    const scope = workerScope();
    installInferenceWorker(scope, () => runner, configure);

    scope.dispatch({
      type: "INITIALIZE",
      requestId: "initialization-to-dispose",
      payload: {
        modelBaseUrl: "chrome-extension://test/models/",
        wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
      },
    });
    scope.dispatch({
      type: "DISPOSE",
      requestId: "dispose-during-init",
      payload: null,
    });
    await vi.waitFor(() => expect(configure).toHaveBeenCalledOnce());
    finishConfiguration?.();

    await waitForWorkerMessage(
      scope,
      (message) =>
        (message as { type?: string; requestId?: string }).type === "STATUS" &&
        (message as { requestId?: string }).requestId ===
          "dispose-during-init" &&
        (message as { payload?: { state?: string } }).payload?.state ===
          "unavailable",
    );
    expect(activeClassifier.dispose).toHaveBeenCalledOnce();
    scope.dispatch({
      type: "CLASSIFY",
      requestId: "classify-after-dispose",
      payload: {
        text: PORTUGUESE_LONG_TEXT,
        platform: "linkedin",
        manual: false,
      },
    });
    await waitForWorkerMessage(
      scope,
      (message) =>
        (message as { type?: string; requestId?: string }).type === "ERROR" &&
        (message as { requestId?: string }).requestId ===
          "classify-after-dispose" &&
        (message as { payload?: { code?: string } }).payload?.code ===
          "MODEL_LOAD_FAILED",
    );
  });

  it("publishes canonical metadata while a previously-ready worker is transitioning", async () => {
    const runner = new PipelineRunner({ classifier: classifier() });
    const scope = workerScope();
    installInferenceWorker(scope, () => runner);
    await initializeWorker(scope);

    scope.dispatch({
      type: "INITIALIZE",
      requestId: "replace-ready-worker",
      payload: {
        modelBaseUrl: "chrome-extension://test/models/",
        wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
      },
    });

    expect(scope.messages).toContainEqual({
      type: "STATUS",
      requestId: "replace-ready-worker",
      payload: {
        state: "initializing",
        backend: "mock",
        runtimeIdentity: null,
        calibrationCoverage: "none",
        calibrationSetDigest: null,
        profileCount: 0,
        earliestExpiry: null,
        reasonCodes: [],
      },
    });
  });

  it("drains an in-flight classification before disposing its classifier", async () => {
    const local = localClassifier("wasm");
    let releaseClassification: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      releaseClassification = resolve;
    });
    vi.mocked(local.classify).mockImplementation(async (text, options) => {
      await gate;
      return result(text, options);
    });
    const scope = workerScope();
    installInferenceWorker(scope, () => new PipelineRunner(), vi.fn(), {
      hasWebGpu: () => false,
      backendFactory: () => ({
        webgpu: vi.fn(() => local),
        wasm: vi.fn(() => local),
      }),
    });

    scope.dispatch({
      type: "INITIALIZE",
      requestId: "init-inflight",
      payload: {
        modelBaseUrl: "chrome-extension://test/models/",
        wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
        modelManifest: localManifest,
        settings: {
          backendPreference: "wasm",
          webGpuEnabled: false,
          wasmEnabled: true,
        },
      },
    });
    await waitForWorkerMessage(
      scope,
      (message) =>
        (message as { type?: string; requestId?: string }).type === "STATUS" &&
        (message as { requestId?: string }).requestId === "init-inflight" &&
        (message as { payload?: { state?: string } }).payload?.state ===
          "ready",
    );

    scope.dispatch({
      type: "CLASSIFY",
      requestId: "inflight-classify",
      payload: {
        text: PORTUGUESE_LONG_TEXT,
        platform: "linkedin",
        manual: false,
      },
    });
    await vi.waitFor(() =>
      expect(vi.mocked(local.classify)).toHaveBeenCalled(),
    );

    scope.dispatch({
      type: "DISPOSE",
      requestId: "dispose-inflight",
      payload: null,
    });
    for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
    expect(local.dispose).not.toHaveBeenCalled();

    releaseClassification?.();
    await waitForWorkerMessage(
      scope,
      (message) =>
        (message as { type?: string; requestId?: string }).type === "STATUS" &&
        (message as { requestId?: string }).requestId === "dispose-inflight" &&
        (message as { payload?: { state?: string } }).payload?.state ===
          "unavailable",
    );
    expect(local.dispose).toHaveBeenCalledOnce();
    expect(scope.messages).not.toContainEqual(
      expect.objectContaining({
        type: "ERROR",
        requestId: "inflight-classify",
      }),
    );
  });

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

  it("settles one cancelled batch request without cancelling its sibling", async () => {
    const batchClassifier = classifier(true);
    let resolveBatch: ((results: ClassificationResult[]) => void) | undefined;
    (
      batchClassifier.classifyBatch as ReturnType<typeof vi.fn>
    ).mockImplementation(
      () =>
        new Promise<ClassificationResult[]>((resolve) => {
          resolveBatch = resolve;
        }),
    );
    const scope = workerScope();
    installInferenceWorker(
      scope,
      () => new PipelineRunner({ classifier: batchClassifier }),
    );
    await initializeWorker(scope);

    scope.dispatch(
      workerBatch([
        { requestId: "cancel-me", text: PORTUGUESE_LONG_TEXT },
        { requestId: "finish-me", text: PORTUGUESE_LONG_TEXT },
      ]),
    );
    await vi.waitFor(() =>
      expect(batchClassifier.classifyBatch).toHaveBeenCalledOnce(),
    );

    scope.dispatch({ type: "CANCEL", requestId: "cancel-me", payload: null });
    const inputs = (
      batchClassifier.classifyBatch as unknown as {
        mock: { calls: [string[]][] };
      }
    ).mock.calls[0]![0];
    resolveBatch?.(inputs.map((text) => result(text, { language: "pt" })));

    await waitForWorkerMessage(
      scope,
      (message) =>
        (message as { type?: string; requestId?: string }).type === "RESULT" &&
        (message as { requestId?: string }).requestId === "finish-me",
    );
    expect(scope.messages).toContainEqual({
      type: "CANCELLED",
      requestId: "cancel-me",
      payload: null,
    });
    expect(scope.messages).not.toContainEqual(
      expect.objectContaining({ type: "RESULT", requestId: "cancel-me" }),
    );
  });

  it("reports a preparation failure only for its batch request", async () => {
    const batchClassifier = classifier(true);
    const tokenizer: Tokenizer = {
      id: "test",
      encode: vi.fn(async (text) => {
        if (text.startsWith("broken ")) {
          throw new Error("tokenizer failed");
        }
        return {
          spans: [{ id: 1, start: 0, end: text.length }],
          tokenCount: 1,
          exact: false,
        };
      }),
    };
    const scope = workerScope();
    installInferenceWorker(
      scope,
      () => new PipelineRunner({ classifier: batchClassifier, tokenizer }),
    );
    await initializeWorker(scope);

    scope.dispatch(
      workerBatch([
        { requestId: "broken", text: `broken ${PORTUGUESE_LONG_TEXT}` },
        { requestId: "healthy", text: PORTUGUESE_LONG_TEXT },
      ]),
    );

    await waitForWorkerMessage(
      scope,
      (message) =>
        (message as { type?: string; requestId?: string }).type === "ERROR" &&
        (message as { requestId?: string }).requestId === "broken",
    );
    expect(scope.messages).toContainEqual(
      expect.objectContaining({ type: "RESULT", requestId: "healthy" }),
    );
    expect(scope.messages).not.toContainEqual(
      expect.objectContaining({ type: "ERROR", requestId: "healthy" }),
    );
  });

  it("retries a rejected shared batch per active request", async () => {
    const batchClassifier = classifier(true);
    (
      batchClassifier.classifyBatch as ReturnType<typeof vi.fn>
    ).mockRejectedValue(new Error("shared batch failed"));
    (batchClassifier.classify as ReturnType<typeof vi.fn>).mockImplementation(
      async (text: string, options?: ClassificationOptions) => {
        if (text.startsWith("broken ")) {
          throw new Error("individual inference failed");
        }
        return result(text, options);
      },
    );
    const tokenizer: Tokenizer = {
      id: "test",
      encode: vi.fn(async (text) => ({
        spans: [{ id: 1, start: 0, end: text.length }],
        tokenCount: 1,
        exact: false,
      })),
    };
    const scope = workerScope();
    installInferenceWorker(
      scope,
      () => new PipelineRunner({ classifier: batchClassifier, tokenizer }),
    );
    await initializeWorker(scope);

    scope.dispatch(
      workerBatch([
        { requestId: "broken", text: `broken ${PORTUGUESE_LONG_TEXT}` },
        { requestId: "healthy", text: PORTUGUESE_LONG_TEXT },
      ]),
    );

    await waitForWorkerMessage(
      scope,
      (message) =>
        (message as { type?: string; requestId?: string }).type === "ERROR" &&
        (message as { requestId?: string }).requestId === "broken",
    );
    expect(scope.messages).toContainEqual(
      expect.objectContaining({ type: "RESULT", requestId: "healthy" }),
    );
    expect(scope.messages).not.toContainEqual(
      expect.objectContaining({ type: "ERROR", requestId: "healthy" }),
    );
    expect(batchClassifier.classifyBatch).toHaveBeenCalledOnce();
    expect(batchClassifier.classify).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });
});
