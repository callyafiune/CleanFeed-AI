import { describe, expect, it, vi } from "vitest";

import {
  WorkerHost,
  WorkerHostLifecycle,
  type WorkerHostRuntimeFactory,
} from "@/offscreen/worker-host";
import { selectBackend } from "@/inference/backend-selector";
import { classifyWithFallback } from "@/inference/inference-worker";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ModelRuntime } from "@/inference/model-runtime";
import type { ClassificationResult, TextClassifier } from "@/shared/types";

class FakeWorker {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
}

function backendClassifier(backend: "wasm" | "webgpu"): TextClassifier {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    classify: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    getMetadata: () => ({
      id: `cleanfeed-${backend}`,
      name: "CleanFeed",
      version: "1.0.0",
      backend,
      supportedLanguages: ["pt"],
      maximumTokens: 512,
      supportsBatching: false,
    }),
  };
}

function runtimeFor(classifier: TextClassifier): ModelRuntime {
  return {
    classifier,
    tokenizer: {} as ModelRuntime["tokenizer"],
    identity: {
      kind: "bundle",
      modelId: "cleanfeed-ptbr-v1",
      modelVersion: "1.0.0",
      bundleDigest: "a".repeat(64),
      tokenizerDigest: "b".repeat(64),
      aggregationVersion: "tmr-aggregation-v3",
      contentCompositionVersion: "lexical-content-v2",
      calibrationSetDigest:
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    },
    chunkPlan: {
      modelMaxTokens: 512,
      contentTokens: 510,
      overlapTokens: 64,
      maxWindows: 8,
    },
  };
}

function classificationResult(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    aiScore: 0,
    humanScore: 0,
    confidence: "low",
    status: "insufficient_evidence",
    wordCount: 120,
    tokenCount: 150,
    runtimeIdentity: {
      kind: "bundle",
      modelId: "cleanfeed-ptbr-v1",
      modelVersion: "1.0.0",
      bundleDigest: "a".repeat(64),
      tokenizerDigest: "b".repeat(64),
      aggregationVersion: "tmr-aggregation-v3",
      contentCompositionVersion: "lexical-content-v2",
      calibrationSetDigest:
        "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    },
    evidence: {
      quality: "unsupported",
      coverage: 1,
      lexicalRatio: 1,
      truncated: false,
      exactTokenizer: true,
      reasonCodes: ["MODEL_PROFILE_MISSING"],
    },
    decision: {
      status: "insufficient_evidence",
      calibratedScore: 0,
      actionCeiling: "indicator",
      abstained: true,
      presentationAllowed: false,
      triggers: [],
      reasonCodes: ["MODEL_PROFILE_MISSING"],
    },
    modelVersion: "1.0.0",
    modelId: "cleanfeed-ptbr-v1",
    backend: "wasm",
    processingTimeMs: 5,
    demo: false,
    ...overrides,
  };
}

describe("worker hard timeout recovery", () => {
  it("recreates and reinitializes the worker after a hard timeout", async () => {
    vi.useFakeTimers();
    const first = new FakeWorker();
    const second = new FakeWorker();
    const createWorker = vi
      .fn()
      .mockReturnValueOnce(first)
      .mockReturnValueOnce(second);
    const host = new WorkerHost(createWorker);
    const paths = {
      modelBaseUrl: "chrome-extension://test/models/",
      wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
    };
    host.initialize(paths);
    const pending = host.classify({
      requestId: "times-out",
      text: "texto suficiente para forcar a recuperacao do worker",
      platform: "linkedin",
      manual: false,
      settings: { ...DEFAULT_SETTINGS, inferenceTimeoutMs: 1_000 },
    });

    const rejection = expect(pending).rejects.toMatchObject({
      code: "INFERENCE_TIMEOUT",
    });
    await vi.advanceTimersByTimeAsync(1_000);

    await rejection;
    expect(first.terminate).toHaveBeenCalledOnce();
    expect(createWorker).toHaveBeenCalledTimes(2);
    expect(second.postMessage).toHaveBeenCalledWith({
      type: "INITIALIZE",
      requestId: "worker-initialize",
      payload: paths,
    });
    expect(host.getModelStatus()).toEqual({
      state: "initializing",
      backend: "mock",
      runtimeIdentity: null,
      calibrationCoverage: "none",
      calibrationSetDigest: null,
      profileCount: 0,
      earliestExpiry: null,
      reasonCodes: [],
    });
    vi.useRealTimers();
  });
});

describe("primary/fallback lifecycle transitions", () => {
  it("keeps the TMR primary when WebGPU fails but WASM works within the same backend", async () => {
    const gpu = backendClassifier("webgpu");
    vi.mocked(gpu.initialize).mockRejectedValue(new Error("adapter"));
    const wasm = backendClassifier("wasm");
    const backendFactory = {
      webgpu: vi.fn(() => gpu),
      wasm: vi.fn(() => wasm),
    };
    const factory: WorkerHostRuntimeFactory = {
      primary: async () =>
        runtimeFor(
          (
            await selectBackend(
              { preference: "auto", hasWebGpu: true },
              backendFactory,
            )
          ).classifier,
        ),
      fallback: vi.fn(),
    };
    const lifecycle = new WorkerHostLifecycle(factory);

    const state = await lifecycle.initialize();

    expect(state.mode).toBe("primary");
    expect(backendFactory.webgpu).toHaveBeenCalledTimes(1);
    expect(backendFactory.wasm).toHaveBeenCalledTimes(1);
    expect(factory.fallback).not.toHaveBeenCalled();
  });

  it("initializes the stylometric fallback once when both TMR backends fail", async () => {
    const gpu = backendClassifier("webgpu");
    const wasm = backendClassifier("wasm");
    vi.mocked(gpu.initialize).mockRejectedValue(new Error("gpu"));
    vi.mocked(wasm.initialize).mockRejectedValue(new Error("wasm"));
    const backendFactory = {
      webgpu: vi.fn(() => gpu),
      wasm: vi.fn(() => wasm),
    };
    const stylometric = backendClassifier("wasm");
    const fallback = vi.fn(async () => runtimeFor(stylometric));
    const factory: WorkerHostRuntimeFactory = {
      primary: async () =>
        runtimeFor(
          (
            await selectBackend(
              { preference: "auto", hasWebGpu: true },
              backendFactory,
            )
          ).classifier,
        ),
      fallback,
    };
    const lifecycle = new WorkerHostLifecycle(factory);

    const state = await lifecycle.initialize();

    expect(state.mode).toBe("fallback");
    expect(backendFactory.webgpu).toHaveBeenCalledTimes(1);
    expect(backendFactory.wasm).toHaveBeenCalledTimes(1);
    expect(fallback).toHaveBeenCalledTimes(1);
  });
});

describe("classifyWithFallback", () => {
  it("substitutes an indicative builtin result when the TMR profile is missing", async () => {
    const tmr = classificationResult();
    const runFallback = vi.fn(async () =>
      classificationResult({
        status: "possibly_ai",
        aiScore: 0.6,
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
          calibratedScore: 0.6,
          actionCeiling: "indicator",
          abstained: false,
          presentationAllowed: true,
          triggers: [],
          reasonCodes: [],
        },
        backend: "wasm",
        demo: true,
      }),
    );

    const result = await classifyWithFallback(tmr, runFallback);

    expect(runFallback).toHaveBeenCalledTimes(1);
    expect(result.runtimeIdentity.kind).toBe("builtin");
    expect(result.decision.actionCeiling).toBe("indicator");
    // The TMR abstention is preserved in the diagnostic.
    expect(result.decision.reasonCodes).toContain("MODEL_PROFILE_MISSING");
  });

  it("returns the TMR result unchanged when it did not abstain over a profile", async () => {
    const tmr = classificationResult({
      status: "possibly_ai",
      decision: {
        status: "possibly_ai",
        calibratedScore: 0.7,
        actionCeiling: "hide",
        abstained: false,
        presentationAllowed: true,
        triggers: ["document"],
        reasonCodes: [],
      },
    });
    const runFallback = vi.fn();

    const result = await classifyWithFallback(tmr, runFallback);

    expect(runFallback).not.toHaveBeenCalled();
    expect(result).toBe(tmr);
  });

  it("does not fall back for a non-profile content abstention", async () => {
    const tmr = classificationResult({
      evidence: {
        quality: "unsupported",
        coverage: 1,
        lexicalRatio: 1,
        truncated: false,
        exactTokenizer: true,
        reasonCodes: ["UNSUPPORTED_LANGUAGE"],
      },
      decision: {
        status: "insufficient_evidence",
        calibratedScore: 0,
        actionCeiling: "indicator",
        abstained: true,
        presentationAllowed: false,
        triggers: [],
        reasonCodes: ["UNSUPPORTED_LANGUAGE"],
      },
    });
    const runFallback = vi.fn();

    const result = await classifyWithFallback(tmr, runFallback);

    expect(runFallback).not.toHaveBeenCalled();
    expect(result).toBe(tmr);
  });
});
