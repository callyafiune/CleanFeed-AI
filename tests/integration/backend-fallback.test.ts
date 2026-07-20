import { describe, expect, it, vi } from "vitest";

import { WorkerHost } from "@/offscreen/worker-host";
import { DEFAULT_SETTINGS } from "@/shared/constants";

class FakeWorker {
  readonly postMessage = vi.fn();
  readonly terminate = vi.fn();
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
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
