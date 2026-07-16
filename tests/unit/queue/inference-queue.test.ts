import { describe, expect, it, vi } from "vitest";

import {
  InferenceQueue,
  type InferenceQueueTask,
} from "@/queue/inference-queue";

interface ControlledRunner {
  readonly run: (task: InferenceQueueTask) => Promise<string>;
  readonly activeIds: string[];
  readonly runCalls: InferenceQueueTask[];
  resolveNext(result: string): void;
}

function createRunner(): ControlledRunner {
  const activeIds: string[] = [];
  const runCalls: InferenceQueueTask[] = [];
  const resolvers: Array<(value: string) => void> = [];
  const run = (task: InferenceQueueTask) =>
    new Promise<string>((resolve) => {
      runCalls.push(task);
      activeIds.push(task.id);
      resolvers.push((value) => {
        activeIds.splice(activeIds.indexOf(task.id), 1);
        resolve(value);
      });
    });

  return {
    run,
    activeIds,
    runCalls,
    resolveNext(result) {
      const resolve = resolvers.shift();
      if (!resolve) {
        throw new Error("No running task to resolve");
      }
      resolve(result);
    },
  };
}

function task(
  id: string,
  overrides: Partial<InferenceQueueTask> = {},
): InferenceQueueTask {
  return {
    id,
    textHash: id,
    modelId: "model-a",
    settingsFingerprint: "settings-a",
    platform: "linkedin",
    manual: false,
    visibility: "near",
    distancePx: 200,
    createdAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
    ...overrides,
  };
}

async function flushQueue(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("InferenceQueue", () => {
  it("orders manual before visible before near viewport", () => {
    const runner = createRunner();
    const queue = new InferenceQueue({ run: runner.run });

    queue.enqueue(task("near", { visibility: "near" }));
    queue.enqueue(task("visible", { visibility: "visible" }));
    queue.enqueue(task("manual", { manual: true }));

    expect(queue.pendingIds()).toEqual(["manual", "visible", "near"]);
  });

  it("uses viewport distance to order tasks with the same near priority", () => {
    const runner = createRunner();
    const queue = new InferenceQueue({ run: runner.run });

    void queue.enqueue(task("far", { distancePx: 900 }));
    void queue.enqueue(task("close", { distancePx: 10 }));

    expect(queue.pendingIds()).toEqual(["close", "far"]);
  });

  it("elevates a deduplicated queued task when a manual request joins it", async () => {
    const runner = createRunner();
    const queue = new InferenceQueue({ run: runner.run, concurrency: 1 });
    const blocker = queue.enqueue(task("blocker"));
    await flushQueue();
    const deduplicated = queue.enqueue(task("near", { textHash: "shared" }));
    const visible = queue.enqueue(task("visible", { visibility: "visible" }));
    queue.enqueue(task("manual", { textHash: "shared", manual: true }));

    runner.resolveNext("blocker-result");
    await blocker;
    await flushQueue();

    expect(runner.runCalls.map(({ id }) => id)).toEqual(["blocker", "near"]);
    runner.resolveNext("shared-result");
    await expect(deduplicated).resolves.toBe("shared-result");
    await flushQueue();
    runner.resolveNext("visible-result");
    await expect(visible).resolves.toBe("visible-result");
  });

  it("deduplicates by text hash, model, settings and platform and fans out the result", async () => {
    const runner = createRunner();
    const queue = new InferenceQueue({ run: runner.run });
    const first = queue.enqueue(task("a", { textHash: "same" }));
    const second = queue.enqueue(task("b", { textHash: "same" }));

    await flushQueue();
    runner.resolveNext("result");

    await expect(Promise.all([first, second])).resolves.toEqual([
      "result",
      "result",
    ]);
    expect(runner.runCalls).toHaveLength(1);
  });

  it("keeps deduplicated work queued when one follower cancels", async () => {
    const runner = createRunner();
    const queue = new InferenceQueue({ run: runner.run, concurrency: 1 });
    const blocker = queue.enqueue(task("blocker"));
    const first = queue.enqueue(task("a", { textHash: "same" }));
    const follower = queue.enqueue(task("b", { textHash: "same" }));

    await flushQueue();
    queue.cancel("b");
    await expect(follower).rejects.toMatchObject({ name: "AbortError" });
    runner.resolveNext("blocker-result");
    await blocker;
    await flushQueue();
    runner.resolveNext("shared-result");

    await expect(first).resolves.toBe("shared-result");
  });

  it("never exceeds maximum size and evicts the lowest priority pending task", async () => {
    const runner = createRunner();
    const queue = new InferenceQueue({ run: runner.run, maximumSize: 2 });

    const low = queue.enqueue(task("low", { visibility: "near" }));
    void queue.enqueue(task("medium", { visibility: "visible" }));
    void queue.enqueue(task("manual", { manual: true }));

    expect(queue.size).toBe(2);
    expect(queue.has("low")).toBe(false);
    expect(queue.pendingIds()).toEqual(["manual", "medium"]);
    await expect(low).rejects.toThrow("Inference queue is full");
  });

  it("runs one task at a time when configured for WASM", async () => {
    const runner = createRunner();
    const queue = new InferenceQueue({ run: runner.run, concurrency: 1 });

    void queue.enqueue(task("a"));
    void queue.enqueue(task("b"));
    await flushQueue();

    expect(runner.activeIds).toEqual(["a"]);
    runner.resolveNext("a-result");
    await flushQueue();
    expect(runner.activeIds).toEqual(["b"]);
  });

  it("keeps expiration distinct from queued cancellation", async () => {
    const runner = createRunner();
    const queue = new InferenceQueue({
      run: runner.run,
      concurrency: 1,
      now: () => 100,
    });
    void queue.enqueue(task("running"));
    const expired = queue.enqueue(task("expired", { expiresAt: 99 }));
    const cancelled = queue.enqueue(task("cancelled"));
    const expiration = expired.catch((error: unknown) => error);

    const cancellation = expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(queue.cancel("cancelled")).toBe(true);
    expect(await expiration).toMatchObject({ name: "TimeoutError" });
    await cancellation;
    expect(queue.stats()).toMatchObject({ expired: 1, cancelled: 1 });
  });

  it("cancels a running task through the runner callback", async () => {
    const runner = createRunner();
    const cancelRunner = vi.fn();
    const queue = new InferenceQueue({ run: runner.run, cancelRunner });
    const result = queue.enqueue(task("running"));

    await flushQueue();
    expect(queue.cancel("running")).toBe(true);
    expect(cancelRunner).toHaveBeenCalledWith("running");
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });

  it("does not cancel shared running work when only a deduplicated follower cancels", async () => {
    const runner = createRunner();
    const cancelRunner = vi.fn();
    const queue = new InferenceQueue({ run: runner.run, cancelRunner });
    const first = queue.enqueue(task("runner", { textHash: "shared" }));

    await flushQueue();
    const follower = queue.enqueue(task("follower", { textHash: "shared" }));
    queue.cancel("follower");

    await expect(follower).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelRunner).not.toHaveBeenCalled();
    expect(queue.has("runner")).toBe(true);
    expect(queue.stats().running).toBe(1);

    runner.resolveNext("shared-result");
    await expect(first).resolves.toBe("shared-result");
  });

  it("uses the runner request id when the final running subscriber cancels", async () => {
    const runner = createRunner();
    const cancelRunner = vi.fn();
    const queue = new InferenceQueue({ run: runner.run, cancelRunner });
    const first = queue.enqueue(task("runner", { textHash: "shared" }));

    await flushQueue();
    const follower = queue.enqueue(task("follower", { textHash: "shared" }));
    queue.cancel("runner");
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelRunner).not.toHaveBeenCalled();

    queue.cancel("follower");
    await expect(follower).rejects.toMatchObject({ name: "AbortError" });
    expect(cancelRunner).toHaveBeenCalledWith("runner");
    runner.resolveNext("ignored-result");
  });

  it("expires an individual deduplicated subscriber while shared work remains queued", async () => {
    vi.useFakeTimers();
    try {
      const runner = createRunner();
      const queue = new InferenceQueue({ run: runner.run, concurrency: 1 });
      const blocker = queue.enqueue(task("blocker"));
      await flushQueue();
      const first = queue.enqueue(task("first", { textHash: "shared" }));
      const expiring = queue.enqueue(
        task("expiring", {
          textHash: "shared",
          manual: true,
          expiresAt: Date.now() + 100,
        }),
      );
      const expiration = expiring.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(100);
      expect(await expiration).toMatchObject({ name: "TimeoutError" });
      runner.resolveNext("blocker-result");
      await blocker;
      await flushQueue();
      runner.resolveNext("shared-result");
      await expect(first).resolves.toBe("shared-result");
    } finally {
      vi.useRealTimers();
    }
  });

  it("delays a platform after 30 starts in a rolling minute", async () => {
    vi.useFakeTimers();
    const runner = createRunner();
    const queue = new InferenceQueue({
      run: runner.run,
      concurrency: 31,
      now: () => Date.now(),
    });

    for (let index = 0; index < 31; index += 1) {
      void queue.enqueue(task(`task-${index}`));
    }
    await flushQueue();

    expect(runner.runCalls).toHaveLength(30);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(runner.runCalls).toHaveLength(31);
    vi.useRealTimers();
  });

  it("runs an eligible platform instead of waiting behind a rate-limited platform", async () => {
    vi.useFakeTimers();
    try {
      const runner = createRunner();
      const queue = new InferenceQueue({
        run: runner.run,
        concurrency: 32,
        now: () => Date.now(),
      });

      for (let index = 0; index < 30; index += 1) {
        void queue.enqueue(task(`linkedin-${index}`));
      }
      await flushQueue();
      queue.enqueue(task("linkedin-limited", { manual: true }));
      queue.enqueue(task("other-platform", { platform: "other" }));
      await flushQueue();

      expect(runner.runCalls).toHaveLength(31);
      expect(runner.runCalls.at(-1)?.id).toBe("other-platform");
    } finally {
      vi.useRealTimers();
    }
  });

  it("expires a rate-limited pending task before the rate timer fires", async () => {
    vi.useFakeTimers();
    try {
      const runner = createRunner();
      const queue = new InferenceQueue({
        run: runner.run,
        concurrency: 31,
        now: () => Date.now(),
      });

      for (let index = 0; index < 30; index += 1) {
        void queue.enqueue(task(`linkedin-${index}`));
      }
      await flushQueue();
      const expiring = queue.enqueue(
        task("rate-limited", { expiresAt: Date.now() + 100 }),
      );
      const expiration = expiring.catch((error: unknown) => error);

      await vi.advanceTimersByTimeAsync(100);
      expect(await expiration).toMatchObject({ name: "TimeoutError" });
      expect(queue.stats().expired).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("rechecks expiries that are farther away than the maximum timer delay", async () => {
    vi.useFakeTimers();
    try {
      const runner = createRunner();
      const queue = new InferenceQueue({ run: runner.run, concurrency: 1 });
      let settled: unknown = "pending";
      const expiresAt = Date.now() + 2_147_483_647 + 100;
      const expiring = queue.enqueue(task("far-future", { expiresAt }));
      void expiring.catch((error: unknown) => {
        settled = error;
      });

      await vi.advanceTimersByTimeAsync(2_147_483_647);
      await flushQueue();
      expect(settled).toBe("pending");

      await vi.advanceTimersByTimeAsync(100);
      await flushQueue();
      expect(settled).toMatchObject({ name: "TimeoutError" });
    } finally {
      vi.useRealTimers();
    }
  });

  it("runs up to two tasks concurrently when configured", async () => {
    const runner = createRunner();
    const queue = new InferenceQueue({ run: runner.run, concurrency: 2 });

    void queue.enqueue(task("a"));
    void queue.enqueue(task("b"));
    void queue.enqueue(task("c"));
    await flushQueue();

    expect(runner.activeIds).toEqual(["a", "b"]);
  });

  it("clears active work, registry entries and stats when disposed", async () => {
    const runner = createRunner();
    const cancelRunner = vi.fn();
    const queue = new InferenceQueue({ run: runner.run, cancelRunner });
    const running = queue.enqueue(task("running"));
    const queued = queue.enqueue(task("queued"));
    const settled = Promise.allSettled([running, queued]);

    await flushQueue();
    queue.dispose();

    expect(await settled).toEqual([
      expect.objectContaining({
        status: "rejected",
        reason: expect.any(DOMException),
      }),
      expect.objectContaining({
        status: "rejected",
        reason: expect.any(DOMException),
      }),
    ]);
    expect(cancelRunner).toHaveBeenCalledTimes(1);
    expect(cancelRunner).toHaveBeenCalledWith("running");
    expect(queue.size).toBe(0);
    expect(queue.has("running")).toBe(false);
    expect(queue.has("queued")).toBe(false);
    expect(queue.stats()).toEqual({
      queued: 0,
      running: 0,
      completed: 0,
      cancelled: 0,
      expired: 0,
      failed: 0,
    });
  });

  it("reuses a request id after its terminal registry record is cleaned", async () => {
    const runner = createRunner();
    const queue = new InferenceQueue({ run: runner.run });
    const first = queue.enqueue(task("reused"));

    await flushQueue();
    runner.resolveNext("first-result");
    await expect(first).resolves.toBe("first-result");
    const second = queue.enqueue(task("reused"));
    await flushQueue();

    expect(runner.runCalls).toHaveLength(2);
    runner.resolveNext("second-result");
    await expect(second).resolves.toBe("second-result");
  });

  it("starts fresh work when a cancelled running request is retried", async () => {
    const runner = createRunner();
    const queue = new InferenceQueue({ run: runner.run });
    const first = queue.enqueue(task("first", { textHash: "shared" }));

    await flushQueue();
    queue.cancel("first");
    await expect(first).rejects.toMatchObject({ name: "AbortError" });
    const retry = queue.enqueue(task("retry", { textHash: "shared" }));
    runner.resolveNext("stale-result");
    await flushQueue();

    expect(runner.runCalls).toHaveLength(2);
    runner.resolveNext("fresh-result");
    await expect(retry).resolves.toBe("fresh-result");
  });
});
