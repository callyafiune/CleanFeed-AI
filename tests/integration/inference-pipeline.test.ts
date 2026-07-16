import { describe, expect, it, vi } from "vitest";

import {
  installInferenceWorker,
  PipelineRunner,
  type InferenceWorkerScope,
} from "@/inference/inference-worker";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { Tokenizer } from "@/inference/tokenizer";
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
