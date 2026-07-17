import { describe, expect, it } from "vitest";

import type { StorageArea } from "@/shared/types";
import { FeedbackRepository, type FeedbackRecord } from "@/storage/feedback";

class MemoryStorageArea implements StorageArea {
  private readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    this.values.set(key, value);
  }

  async remove(keys: string | string[]): Promise<void> {
    for (const key of typeof keys === "string" ? [keys] : keys) {
      this.values.delete(key);
    }
  }

  async getMany<T>(keys: string[]): Promise<Record<string, T>> {
    return Object.fromEntries(
      keys
        .filter((key) => this.values.has(key))
        .map((key) => [key, this.values.get(key) as T]),
    );
  }

  async dump(): Promise<Record<string, unknown>> {
    return Object.fromEntries(this.values);
  }
}

const HASH = "a".repeat(64);
const PORTUGUESE_TEXT =
  "Este é um texto de publicação em português que jamais deveria ser persistido.";

function record(overrides: Partial<FeedbackRecord> = {}): FeedbackRecord {
  return {
    textHash: HASH,
    predictedScore: 0.91,
    predictedStatus: "possibly_ai",
    feedback: "human",
    modelVersion: "mock-v1",
    platform: "linkedin",
    createdAt: 1,
    ...overrides,
  };
}

function hashFor(index: number): string {
  return index.toString(16).padStart(64, "0");
}

describe("FeedbackRepository", () => {
  it("stores feedback keyed by hash without text or author", async () => {
    const storage = new MemoryStorageArea();
    const feedback = new FeedbackRepository(storage);

    await feedback.add(record());

    expect(JSON.stringify(await storage.dump())).not.toContain(PORTUGUESE_TEXT);
    expect((await feedback.list())[0]?.textHash).toBe(HASH);
  });

  it("rejects and never persists records carrying post text, author or url", async () => {
    const storage = new MemoryStorageArea();
    const feedback = new FeedbackRepository(storage);

    await expect(
      feedback.add({ ...record(), text: PORTUGUESE_TEXT } as never),
    ).rejects.toThrowError("INVALID_FEEDBACK");
    await expect(
      feedback.add({ ...record(), authorName: "Fulano" } as never),
    ).rejects.toThrowError("INVALID_FEEDBACK");
    await expect(
      feedback.add({ ...record(), profileUrl: "https://x/y" } as never),
    ).rejects.toThrowError("INVALID_FEEDBACK");

    expect(JSON.stringify(await storage.dump())).not.toContain(PORTUGUESE_TEXT);
    expect(await feedback.list()).toHaveLength(0);
  });

  it("rejects malformed score, status, verdict and hash", async () => {
    const feedback = new FeedbackRepository(new MemoryStorageArea());

    await expect(
      feedback.add(record({ predictedScore: 1.5 })),
    ).rejects.toThrowError("INVALID_FEEDBACK");
    await expect(
      feedback.add(record({ predictedStatus: "not_a_status" as never })),
    ).rejects.toThrowError("INVALID_FEEDBACK");
    await expect(
      feedback.add(record({ feedback: "maybe" as never })),
    ).rejects.toThrowError("INVALID_FEEDBACK");
    await expect(
      feedback.add(record({ textHash: "not-a-hash" })),
    ).rejects.toThrowError("INVALID_FEEDBACK");
  });

  it("replaces earlier feedback for the same hash and model version", async () => {
    const storage = new MemoryStorageArea();
    const feedback = new FeedbackRepository(storage);

    await feedback.add(record({ feedback: "human", createdAt: 1 }));
    await feedback.add(record({ feedback: "ai", createdAt: 2 }));

    const stored = await feedback.list();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.feedback).toBe("ai");
  });

  it("keeps distinct feedback for different model versions of the same hash", async () => {
    const feedback = new FeedbackRepository(new MemoryStorageArea());

    await feedback.add(record({ modelVersion: "mock-v1", createdAt: 1 }));
    await feedback.add(record({ modelVersion: "mock-v2", createdAt: 2 }));

    expect(await feedback.list()).toHaveLength(2);
  });

  it("caps stored feedback by dropping the least recent records", async () => {
    const storage = new MemoryStorageArea();
    const feedback = new FeedbackRepository(storage, { maximumRecords: 3 });

    for (let index = 1; index <= 4; index += 1) {
      await feedback.add(
        record({ textHash: hashFor(index), createdAt: index }),
      );
    }

    const stored = await feedback.list();
    expect(stored).toHaveLength(3);
    expect(stored.map((entry) => entry.textHash)).not.toContain(hashFor(1));
    expect(stored.map((entry) => entry.textHash)).toEqual([
      hashFor(2),
      hashFor(3),
      hashFor(4),
    ]);
  });

  it("recovers from corrupt persisted feedback", async () => {
    const storage = new MemoryStorageArea();
    await storage.set("cleanfeed.feedback.v1", { records: "corrupt" });
    const feedback = new FeedbackRepository(storage);

    expect(await feedback.list()).toHaveLength(0);
    await expect(storage.get("cleanfeed.feedback.v1")).resolves.toBeUndefined();
  });

  it("clears all stored feedback", async () => {
    const storage = new MemoryStorageArea();
    const feedback = new FeedbackRepository(storage);
    await feedback.add(record());

    await feedback.clear();

    expect(await feedback.list()).toHaveLength(0);
    await expect(storage.get("cleanfeed.feedback.v1")).resolves.toBeUndefined();
  });
});
