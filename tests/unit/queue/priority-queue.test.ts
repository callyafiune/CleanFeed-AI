import { describe, expect, it } from "vitest";

import { PriorityQueue } from "@/queue/priority-queue";

describe("PriorityQueue", () => {
  it("removes higher priority items first and keeps equal priorities stable", () => {
    const queue = new PriorityQueue<{ id: string; priority: number }>(
      (left, right) => right.priority - left.priority,
    );

    queue.push({ id: "near", priority: 50 });
    queue.push({ id: "visible", priority: 100 });
    queue.push({ id: "first-equal", priority: 100 });

    expect([queue.pop()?.id, queue.pop()?.id, queue.pop()?.id]).toEqual([
      "visible",
      "first-equal",
      "near",
    ]);
  });

  it("removes a matching pending item without disturbing the remaining order", () => {
    const queue = new PriorityQueue<{ id: string; priority: number }>(
      (left, right) => right.priority - left.priority,
    );

    queue.push({ id: "low", priority: 1 });
    queue.push({ id: "high", priority: 2 });

    expect(queue.remove((item) => item.id === "low")?.id).toBe("low");
    expect(queue.values().map((item) => item.id)).toEqual(["high"]);
  });
});
