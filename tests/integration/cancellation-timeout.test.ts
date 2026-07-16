import { describe, expect, it, vi } from "vitest";

import { WorkerHost } from "@/offscreen/worker-host";
import { parseExtensionMessage } from "@/shared/message-validation";
import { DEFAULT_SETTINGS } from "@/shared/constants";

function workerThatNeverResponds() {
  return {
    postMessage: vi.fn(),
    onmessage: null,
    onerror: null,
    terminate: vi.fn(),
  };
}

describe("worker cancellation and timeout", () => {
  it("accepts a complete settings snapshot on the production offscreen route", () => {
    expect(
      parseExtensionMessage({
        source: "background",
        target: "offscreen",
        type: "OFFSCREEN_CLASSIFY",
        requestId: "snapshot",
        payload: {
          text: "texto suficiente para a requisição",
          platform: "linkedin",
          manual: false,
          settings: DEFAULT_SETTINGS,
        },
      }),
    ).toMatchObject({ type: "OFFSCREEN_CLASSIFY", requestId: "snapshot" });
  });
  it("cancels a queued or running request by requestId", async () => {
    const worker = workerThatNeverResponds();
    const host = new WorkerHost(() => worker);
    const promise = host.classify({
      requestId: "r-cancel",
      text: "texto suficiente para a requisição",
      platform: "linkedin",
      manual: false,
      settings: DEFAULT_SETTINGS,
    });

    host.cancel("r-cancel");

    await expect(promise).rejects.toMatchObject({ name: "AbortError" });
    expect(host.stats().cancelledTasks).toBe(1);
    expect(worker.postMessage).toHaveBeenLastCalledWith({
      type: "CANCEL",
      requestId: "r-cancel",
      payload: null,
    });
  });

  it("converts timeout into a recoverable classification failure", async () => {
    vi.useFakeTimers();
    const worker = workerThatNeverResponds();
    const host = new WorkerHost(() => worker);
    const promise = host.classify({
      requestId: "r-timeout",
      text: "texto suficiente para a requisição",
      platform: "linkedin",
      manual: false,
      settings: { ...DEFAULT_SETTINGS, inferenceTimeoutMs: 1 },
    });

    await vi.advanceTimersByTimeAsync(1);

    await expect(promise).resolves.toMatchObject({
      status: "classification_failed",
      errorCode: "INFERENCE_TIMEOUT",
    });
    vi.useRealTimers();
  });

  it("settles cancellation even when posting CANCEL throws", async () => {
    const worker = workerThatNeverResponds();
    worker.postMessage
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("worker closed");
      });
    const host = new WorkerHost(() => worker);
    const pending = host.classify({
      requestId: "post-throws",
      text: "texto suficiente para a requisição",
      platform: "linkedin",
      manual: false,
      settings: DEFAULT_SETTINGS,
    });

    expect(() => host.cancel("post-throws")).not.toThrow();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("holds compatible batching-enabled work for one ten millisecond window", async () => {
    vi.useFakeTimers();
    const worker = workerThatNeverResponds();
    const host = new WorkerHost(() => worker, true);
    void host.classify({
      requestId: "batch-1",
      text: "texto",
      platform: "linkedin",
      manual: false,
      settings: { ...DEFAULT_SETTINGS, batchingEnabled: true },
    });
    void host.classify({
      requestId: "batch-2",
      text: "texto",
      platform: "linkedin",
      manual: false,
      settings: { ...DEFAULT_SETTINGS, batchingEnabled: true },
    });

    expect(worker.postMessage).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    expect(worker.postMessage).toHaveBeenCalledOnce();
    expect(worker.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "CLASSIFY",
        payload: {
          requests: expect.arrayContaining([
            expect.objectContaining({ requestId: "batch-1" }),
            expect.objectContaining({ requestId: "batch-2" }),
          ]),
        },
      }),
    );
    vi.useRealTimers();
  });

  it("emits worker lifecycle protocol controls", () => {
    const worker = workerThatNeverResponds();
    const host = new WorkerHost(() => worker);
    host.initialize("initialize");
    host.status("status");
    host.dispose();
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "INITIALIZE",
      requestId: "initialize",
      payload: null,
    });
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "STATUS",
      requestId: "status",
      payload: null,
    });
    expect(worker.postMessage).toHaveBeenCalledWith({
      type: "DISPOSE",
      requestId: "worker-dispose",
      payload: null,
    });
  });
});
