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

  it("expires pending tasks and rejects queued cancellation with AbortError", async () => {
    const runner = createRunner();
    const queue = new InferenceQueue({
      run: runner.run,
      concurrency: 1,
      now: () => 100,
    });
    void queue.enqueue(task("running"));
    const expired = queue.enqueue(task("expired", { expiresAt: 99 }));
    const cancelled = queue.enqueue(task("cancelled"));

    const cancellation = expect(cancelled).rejects.toMatchObject({
      name: "AbortError",
    });
    expect(queue.cancel("cancelled")).toBe(true);
    await expect(expired).rejects.toMatchObject({ name: "AbortError" });
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
});
