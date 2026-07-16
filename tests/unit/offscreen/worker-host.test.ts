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
          classifierId: "local-model",
          modelVersion: "1.0.0",
          backend: "wasm",
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
      errorCode: "WORKER_UNAVAILABLE",
    });
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
