import { describe, expect, it, vi } from "vitest";

import { WorkerHost } from "@/offscreen/worker-host";

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
            aggregationVersion: "tmr-aggregation-v2",
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
            aggregationVersion: "tmr-aggregation-v2",
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
            aggregationVersion: "tmr-aggregation-v2",
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
