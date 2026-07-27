import { describe, expect, it, vi } from "vitest";

import {
  buildRuntimeSetStatus,
  WorkerHost,
  WorkerHostLifecycle,
  type WorkerHostRuntimeFactory,
} from "@/offscreen/worker-host";
import type { ModelRuntime } from "@/inference/model-runtime";
import type { TextClassifier } from "@/shared/types";

function fakeRuntime(): ModelRuntime {
  const classifier: TextClassifier = {
    initialize: vi.fn().mockResolvedValue(undefined),
    classify: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    getMetadata: () => ({
      id: "stylometric-v1",
      name: "Stylometric",
      version: "1.0.0",
      backend: "wasm",
      supportedLanguages: ["pt"],
      maximumTokens: 512,
      supportsBatching: false,
    }),
  };
  return {
    classifier,
    tokenizer: {} as ModelRuntime["tokenizer"],
    identity: {
      kind: "builtin",
      modelId: "stylometric",
      modelVersion: "1.0.0",
      implementationVersion: "stylometric-v1",
    },
    chunkPlan: {
      modelMaxTokens: 512,
      contentTokens: 510,
      overlapTokens: 64,
      maxWindows: 8,
    },
  };
}

class FakeWorker {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
}

const request = {
  requestId: "worker-request-1",
  text: "Texto suficiente para exercitar a falha do worker.",
  platform: "linkedin",
  manual: false,
};

describe("WorkerHost", () => {
  it("sends extension-local model and WASM paths when initializing", () => {
    const worker = new FakeWorker();
    const host = new WorkerHost(() => worker);

    host.initialize({
      modelBaseUrl: "chrome-extension://test/models/",
      wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
    });

    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "INITIALIZE",
      requestId: "worker-initialize",
      payload: {
        modelBaseUrl: "chrome-extension://test/models/",
        wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
      },
    });
  });

  it("proxies worker lifecycle transitions and exposes worker loss as an error", () => {
    const worker = new FakeWorker();
    const host = new WorkerHost(() => worker);

    expect(host.getModelStatus().state).toBe("initializing");
    worker.onmessage?.({
      data: {
        type: "STATUS",
        requestId: "worker-status",
        payload: {
          state: "ready",
          backend: "wasm",
          runtimeIdentity: {
            kind: "bundle",
            modelId: "local-model",
            modelVersion: "1.0.0",
            bundleDigest: "a".repeat(64),
            tokenizerDigest: "b".repeat(64),
            aggregationVersion: "tmr-aggregation-v3",
            contentCompositionVersion: "lexical-content-v1",
            calibrationSetDigest:
              "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          },
          calibrationCoverage: "none",
          calibrationSetDigest: null,
          profileCount: 0,
          earliestExpiry: null,
          reasonCodes: [],
        },
      },
    } as MessageEvent<unknown>);
    expect(host.getModelStatus()).toMatchObject({
      state: "ready",
      backend: "wasm",
    });

    worker.onerror?.(new Event("error") as ErrorEvent);
    expect(host.getModelStatus()).toMatchObject({
      state: "error",
      backend: "mock",
      runtimeIdentity: null,
      reasonCodes: ["BACKEND_ERROR"],
    });
  });

  it("drops stale model metadata from inactive and transitional worker statuses", () => {
    const worker = new FakeWorker();
    const host = new WorkerHost(() => worker);
    worker.onmessage?.({
      data: {
        type: "STATUS",
        requestId: "ready",
        payload: {
          state: "ready",
          backend: "wasm",
          runtimeIdentity: {
            kind: "bundle",
            modelId: "previous-model",
            modelVersion: "1.0.0",
            bundleDigest: "a".repeat(64),
            tokenizerDigest: "b".repeat(64),
            aggregationVersion: "tmr-aggregation-v3",
            contentCompositionVersion: "lexical-content-v1",
            calibrationSetDigest:
              "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          },
          calibrationCoverage: "none",
          calibrationSetDigest: null,
          profileCount: 0,
          earliestExpiry: null,
          reasonCodes: ["WEBGPU_FALLBACK"],
          supportsBatching: true,
        },
      },
    } as MessageEvent<unknown>);
    worker.onmessage?.({
      data: {
        type: "STATUS",
        requestId: "disposing",
        payload: {
          state: "disposing",
          backend: "wasm",
          runtimeIdentity: {
            kind: "bundle",
            modelId: "previous-model",
            modelVersion: "1.0.0",
            bundleDigest: "a".repeat(64),
            tokenizerDigest: "b".repeat(64),
            aggregationVersion: "tmr-aggregation-v3",
            contentCompositionVersion: "lexical-content-v1",
            calibrationSetDigest:
              "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
          },
          calibrationCoverage: "none",
          calibrationSetDigest: null,
          profileCount: 0,
          earliestExpiry: null,
          reasonCodes: ["WEBGPU_FALLBACK"],
          supportsBatching: true,
        },
      },
    } as MessageEvent<unknown>);

    // A non-ready status drops the model identity and batching capability.
    expect(host.getModelStatus()).toMatchObject({
      state: "disposing",
      backend: "mock",
      runtimeIdentity: null,
    });
    expect(host.getModelStatus()).not.toHaveProperty("supportsBatching");
  });

  it("rejects pending and later requests after its worker errors", async () => {
    const worker = new FakeWorker();
    const host = new WorkerHost(() => worker);
    const pending = host.classify(request);

    worker.onerror?.(new Event("error") as ErrorEvent);

    await expect(pending).rejects.toMatchObject({
      code: "WORKER_UNAVAILABLE",
    });
    await expect(
      host.classify({ ...request, requestId: "worker-request-2" }),
    ).rejects.toMatchObject({ code: "WORKER_UNAVAILABLE" });
    expect(worker.postMessage).toHaveBeenCalledTimes(1);
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("cleans up pending requests when the worker sends an invalid message", async () => {
    const worker = new FakeWorker();
    const host = new WorkerHost(() => worker);
    const first = host.classify(request);
    const second = host.classify({ ...request, requestId: "worker-request-2" });

    worker.onmessage?.({ data: { type: "RESULT" } } as MessageEvent<unknown>);

    await expect(first).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
    await expect(second).rejects.toMatchObject({ code: "INVALID_MESSAGE" });
    expect(worker.terminate).toHaveBeenCalledOnce();
    await expect(
      host.classify({ ...request, requestId: "worker-request-3" }),
    ).rejects.toMatchObject({ code: "WORKER_UNAVAILABLE" });
  });
});

describe("WorkerHostLifecycle", () => {
  it("stays primary when the TMR runtime initializes", async () => {
    const primaryRuntime = fakeRuntime();
    const factory: WorkerHostRuntimeFactory = {
      primary: vi.fn().mockResolvedValue(primaryRuntime),
      fallback: vi.fn(),
    };
    const lifecycle = new WorkerHostLifecycle(factory);

    const state = await lifecycle.initialize();

    expect(state).toMatchObject({ mode: "primary", phase: "ready" });
    expect(factory.primary).toHaveBeenCalledTimes(1);
    expect(factory.fallback).not.toHaveBeenCalled();
  });

  it("switches to the stylometric fallback exactly once when both TMR backends fail", async () => {
    const fallbackRuntime = fakeRuntime();
    const factory: WorkerHostRuntimeFactory = {
      primary: vi.fn().mockRejectedValue(new Error("no backend")),
      fallback: vi.fn().mockResolvedValue(fallbackRuntime),
    };
    const lifecycle = new WorkerHostLifecycle(factory);

    const state = await lifecycle.initialize();

    expect(state.mode).toBe("fallback");
    expect(factory.primary).toHaveBeenCalledTimes(1);
    expect(factory.fallback).toHaveBeenCalledTimes(1);
  });

  it("initializes the fallback once when the TMR worker dies after becoming ready", async () => {
    const primaryRuntime = fakeRuntime();
    const fallbackRuntime = fakeRuntime();
    const factory: WorkerHostRuntimeFactory = {
      primary: vi.fn().mockResolvedValue(primaryRuntime),
      fallback: vi.fn().mockResolvedValue(fallbackRuntime),
    };
    const lifecycle = new WorkerHostLifecycle(factory);
    await lifecycle.initialize();

    const state = await lifecycle.reportWorkerDeath(["BACKEND_ERROR"]);

    expect(state.mode).toBe("fallback");
    expect(factory.primary).toHaveBeenCalledTimes(1);
    expect(factory.fallback).toHaveBeenCalledTimes(1);
    expect(primaryRuntime.classifier.dispose).toHaveBeenCalledTimes(1);
  });

  it("goes terminal when the stylometric fallback also fails", async () => {
    const factory: WorkerHostRuntimeFactory = {
      primary: vi.fn().mockResolvedValue(fakeRuntime()),
      fallback: vi.fn().mockRejectedValue(new Error("stylometric failed")),
    };
    const lifecycle = new WorkerHostLifecycle(factory);
    await lifecycle.initialize();

    const state = await lifecycle.reportWorkerDeath(["BACKEND_ERROR"]);

    expect(state).toMatchObject({ mode: "terminal", phase: "error" });
    expect(factory.fallback).toHaveBeenCalledTimes(1);
  });

  it("goes terminal, with no path back to TMR, when the worker dies already in fallback", async () => {
    const factory: WorkerHostRuntimeFactory = {
      primary: vi.fn().mockRejectedValue(new Error("no backend")),
      fallback: vi.fn().mockResolvedValue(fakeRuntime()),
    };
    const lifecycle = new WorkerHostLifecycle(factory);
    await lifecycle.initialize();
    expect(lifecycle.getState().mode).toBe("fallback");

    const state = await lifecycle.reportWorkerDeath(["BACKEND_ERROR"]);

    expect(state.mode).toBe("terminal");
    expect(factory.primary).toHaveBeenCalledTimes(1);
    expect(factory.fallback).toHaveBeenCalledTimes(1);
  });

  it("shares one transition promise across concurrent worker-death reports", async () => {
    const primaryRuntime = fakeRuntime();
    const fallbackRuntime = fakeRuntime();
    const factory: WorkerHostRuntimeFactory = {
      primary: vi.fn().mockResolvedValue(primaryRuntime),
      fallback: vi.fn().mockResolvedValue(fallbackRuntime),
    };
    const lifecycle = new WorkerHostLifecycle(factory);
    await lifecycle.initialize();

    const first = lifecycle.reportWorkerDeath(["BACKEND_ERROR"]);
    const second = lifecycle.reportWorkerDeath(["BACKEND_ERROR"]);

    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(factory.fallback).toHaveBeenCalledTimes(1);
    expect(primaryRuntime.classifier.dispose).toHaveBeenCalledTimes(1);
  });

  it("stays primary until the third eligible operational failure", async () => {
    const factory: WorkerHostRuntimeFactory = {
      primary: vi.fn().mockResolvedValue(fakeRuntime()),
      fallback: vi.fn(),
    };
    const lifecycle = new WorkerHostLifecycle(factory);
    await lifecycle.initialize();

    lifecycle.recordFailure("MODEL_INFERENCE_FAILED", 0);
    lifecycle.recordFailure("MODEL_TIMEOUT", 1);

    expect(lifecycle.getState().mode).toBe("primary");
    expect(factory.fallback).not.toHaveBeenCalled();
  });

  it("never counts cancellations toward the breaker threshold", async () => {
    const factory: WorkerHostRuntimeFactory = {
      primary: vi.fn().mockResolvedValue(fakeRuntime()),
      fallback: vi.fn(),
    };
    const lifecycle = new WorkerHostLifecycle(factory);
    await lifecycle.initialize();

    for (let attempt = 0; attempt < 5; attempt += 1) {
      lifecycle.recordFailure("CANCELLED", attempt);
    }

    expect(lifecycle.getState().mode).toBe("primary");
    expect(factory.fallback).not.toHaveBeenCalled();
  });

  it("opens the breaker exactly once under twenty concurrent operational failures", async () => {
    const primaryRuntime = fakeRuntime();
    const fallbackRuntime = fakeRuntime();
    const factory: WorkerHostRuntimeFactory = {
      primary: vi.fn().mockResolvedValue(primaryRuntime),
      fallback: vi.fn().mockResolvedValue(fallbackRuntime),
    };
    const lifecycle = new WorkerHostLifecycle(factory);
    await lifecycle.initialize();

    const transitions = Array.from({ length: 20 }, (_unused, index) =>
      lifecycle.recordFailure("MODEL_INFERENCE_FAILED", index),
    );
    await Promise.all(transitions);

    const state = lifecycle.getState();
    expect(state.mode).toBe("fallback");
    if (state.mode === "fallback") {
      expect(state.reasonCodes).toContain("CIRCUIT_BREAKER_OPEN");
    }
    expect(factory.fallback).toHaveBeenCalledTimes(1);
    expect(primaryRuntime.classifier.dispose).toHaveBeenCalledTimes(1);
  });
});

describe("buildRuntimeSetStatus", () => {
  const setInput = {
    calibrationCoverage: "partial" as const,
    calibrationSetDigest: "d".repeat(64),
    profileCount: 1,
    earliestExpiry: "2026-12-31T00:00:00.000Z",
    identity: {
      kind: "builtin" as const,
      modelId: "stylometric" as const,
      modelVersion: "1.0.0",
      implementationVersion: "stylometric-v1",
    },
    backend: "wasm" as const,
  };

  it("publishes a degraded set status in fallback and never a selected profile", () => {
    const status = buildRuntimeSetStatus(
      {
        mode: "fallback",
        phase: "ready",
        runtime: fakeRuntime(),
        reasonCodes: ["BACKEND_ERROR"],
      },
      setInput,
    );

    expect(status.state).toBe("degraded");
    expect(status.calibrationCoverage).toBe("partial");
    expect(status.calibrationSetDigest).toBe("d".repeat(64));
    expect(status.reasonCodes).toContain("BACKEND_ERROR");
    expect(status).not.toHaveProperty("selectedProfileDigest");
  });

  it("marks partial coverage as degraded even on the primary runtime", () => {
    const status = buildRuntimeSetStatus(
      { mode: "primary", phase: "ready", runtime: fakeRuntime() },
      setInput,
    );

    expect(status.state).toBe("degraded");
    expect(status.reasonCodes).toEqual([]);
    expect(status).not.toHaveProperty("selectedProfileDigest");
  });
});
