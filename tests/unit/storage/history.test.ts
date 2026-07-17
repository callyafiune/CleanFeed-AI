import { describe, expect, it } from "vitest";

import type { Clock, HistoryEntry, StorageArea } from "@/shared/types";
import {
  HISTORY_INDEX_KEY,
  HISTORY_TEXT_KEY,
  HistoryRepository,
  historyPageKey,
} from "@/storage/history";

const DAY_MS = 86_400_000;
const NOW = 20_000 * DAY_MS;
const now = (): number => NOW;
const daysAgo = (days: number): number => NOW - days * DAY_MS;
const clock: Clock = { now };

const POST_TEXT =
  "Este é um texto de publicação em português que jamais deveria vazar em uma linha do histórico.";

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

function hashFor(seed: number): string {
  return (seed >>> 0).toString(16).padStart(64, "0");
}

function entry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    textHash: hashFor(1),
    platform: "linkedin",
    status: "possibly_ai",
    score: 0.9,
    timestamp: NOW,
    ...overrides,
  };
}

function entryAt(timestamp: number): HistoryEntry {
  return entry({ textHash: hashFor(timestamp), timestamp });
}

function createHistory(
  options: { retentionDays?: number; maximumEntries?: number } = {},
  storage: MemoryStorageArea = new MemoryStorageArea(),
): HistoryRepository {
  return new HistoryRepository(storage, clock, {
    historyEnabled: true,
    ...options,
  });
}

describe("HistoryRepository", () => {
  it("writes nothing while history is disabled", async () => {
    const storage = new MemoryStorageArea();
    const history = new HistoryRepository(storage, clock, {
      historyEnabled: true,
    });

    await history.add(entry(), { historyEnabled: false, storeFullText: false });

    expect(await storage.dump()).toEqual({});
  });

  it("prunes by retention and maximum entries", async () => {
    const repository = createHistory({ retentionDays: 30, maximumEntries: 2 });
    await repository.add(entryAt(daysAgo(31)));
    await repository.add(entryAt(daysAgo(2)));
    await repository.add(entryAt(daysAgo(1)));
    await repository.add(entryAt(now()));

    const entries = await repository.query({});
    expect(entries).toHaveLength(2);
    expect(entries.every((item) => item.timestamp >= daysAgo(1))).toBe(true);
  });

  it("filters by platform, status and date without loading text", async () => {
    const storage = new MemoryStorageArea();
    const history = createHistory({}, storage);
    await history.add(
      entry({
        textHash: hashFor(11),
        platform: "linkedin",
        status: "possibly_ai",
        timestamp: daysAgo(2),
      }),
      { historyEnabled: true, storeFullText: true, text: POST_TEXT },
    );
    await history.add(
      entry({
        textHash: hashFor(12),
        platform: "linkedin",
        status: "probably_human",
        timestamp: daysAgo(1),
      }),
    );
    await history.add(
      entry({
        textHash: hashFor(13),
        platform: "twitter",
        status: "possibly_ai",
        timestamp: daysAgo(1),
      }),
    );
    await history.add(
      entry({
        textHash: hashFor(14),
        platform: "linkedin",
        status: "possibly_ai",
        timestamp: daysAgo(30),
      }),
    );

    const rows = await history.query({
      platform: "linkedin",
      status: "possibly_ai",
      from: daysAgo(7),
      to: now(),
    });

    expect(rows.every((row) => !("text" in row))).toBe(true);
    expect(rows.map((row) => row.textHash)).toEqual([hashFor(11)]);
    expect(JSON.stringify(rows)).not.toContain(POST_TEXT);
  });

  it("persists entries in pages of at most 100 plus a compact index", async () => {
    const storage = new MemoryStorageArea();
    const history = createHistory({ maximumEntries: 1_000 }, storage);
    for (let index = 0; index < 250; index += 1) {
      await history.add(entryAt(NOW - index * 1_000));
    }

    const dump = await storage.dump();
    expect(dump[HISTORY_INDEX_KEY]).toBeDefined();
    expect(dump[historyPageKey(0)]).toBeDefined();
    expect(dump[historyPageKey(1)]).toBeDefined();
    expect(dump[historyPageKey(2)]).toBeDefined();
    expect(dump[historyPageKey(3)]).toBeUndefined();
    expect(await history.query({})).toHaveLength(250);
  });

  it("updates an existing entry by textHash instead of duplicating", async () => {
    const history = createHistory();
    await history.add(entry({ textHash: hashFor(7), revealed: false }));
    await history.add(
      entry({ textHash: hashFor(7), revealed: true, feedback: "human" }),
    );

    const rows = await history.query({});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revealed).toBe(true);
    expect(rows[0]?.feedback).toBe("human");
  });

  it("keeps the earliest timestamp when updating an entry by textHash", async () => {
    const history = createHistory();
    await history.add(entry({ textHash: hashFor(7), timestamp: daysAgo(3) }));
    await history.add(
      entry({ textHash: hashFor(7), timestamp: now(), feedback: "ai" }),
    );

    const rows = await history.query({});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.timestamp).toBe(daysAgo(3));
    expect(rows[0]?.feedback).toBe("ai");
  });

  it("never stores author or url even when passed by a caller", async () => {
    const storage = new MemoryStorageArea();
    const history = createHistory({}, storage);
    await history.add({
      ...entry({ textHash: hashFor(5) }),
      authorName: "Fulano",
      profileUrl: "https://example.test/fulano",
    } as never);

    const rows = await history.query({});
    expect(rows).toHaveLength(1);
    expect("authorName" in (rows[0] ?? {})).toBe(false);
    expect("profileUrl" in (rows[0] ?? {})).toBe(false);
    const serialized = JSON.stringify(await storage.dump());
    expect(serialized).not.toContain("Fulano");
    expect(serialized).not.toContain("example.test");
  });

  it("prunes an over-retention entry even when the cap is not reached", async () => {
    // A dedicated retention test with teeth: the cap (100) never binds, so only
    // the age filter can drop the 31-day-old entry. If retention pruning
    // regressed to cap-only, all three rows would survive.
    const history = createHistory({ retentionDays: 30, maximumEntries: 100 });
    await history.add(entryAt(daysAgo(31)));
    await history.add(entryAt(daysAgo(1)));
    await history.add(entryAt(now()));

    const rows = await history.query({});
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.textHash)).not.toContain(hashFor(daysAgo(31)));
  });

  it("honors a per-write retention window shorter than the default", async () => {
    // The retention setting is threaded per write, so lowering it takes effect
    // immediately without reconstructing the repository.
    const history = createHistory({ retentionDays: 365 });
    await history.add(entryAt(daysAgo(10)), {
      historyEnabled: true,
      retentionDays: 1,
    });
    await history.add(entryAt(now()), {
      historyEnabled: true,
      retentionDays: 1,
    });

    const rows = await history.query({});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.timestamp).toBe(now());
  });

  it("stores full text only in the single text map, independently clearable", async () => {
    const storage = new MemoryStorageArea();
    const history = createHistory({}, storage);
    await history.add(entry({ textHash: hashFor(9) }), {
      historyEnabled: true,
      storeFullText: true,
      text: POST_TEXT,
    });

    expect(JSON.stringify(await storage.get(HISTORY_TEXT_KEY))).toContain(
      POST_TEXT,
    );
    expect(JSON.stringify(await storage.get(historyPageKey(0)))).not.toContain(
      POST_TEXT,
    );

    await history.clearText();

    expect(await storage.get(HISTORY_TEXT_KEY)).toBeUndefined();
    expect(await history.query({})).toHaveLength(1);
  });

  it("removes the separate text when its entry is pruned", async () => {
    const storage = new MemoryStorageArea();
    const history = createHistory(
      { retentionDays: 30, maximumEntries: 1 },
      storage,
    );
    await history.add(entry({ textHash: hashFor(21), timestamp: daysAgo(2) }), {
      historyEnabled: true,
      storeFullText: true,
      text: POST_TEXT,
    });
    await history.add(entry({ textHash: hashFor(22), timestamp: now() }));

    expect(JSON.stringify(await storage.dump())).not.toContain(POST_TEXT);
    expect(await history.query({})).toHaveLength(1);
  });

  it("clears and clears text even when the index is corrupt (no orphaned text)", async () => {
    const storage = new MemoryStorageArea();
    const history = createHistory({}, storage);
    await history.add(entry({ textHash: hashFor(61) }), {
      historyEnabled: true,
      storeFullText: true,
      text: POST_TEXT,
    });
    // Corrupt the index so the text/pages are no longer reachable through it.
    await storage.set(HISTORY_INDEX_KEY, { pages: "corrupt" });

    await history.clear();

    // Nothing — especially the opted-in text — may survive a completed clear.
    expect(JSON.stringify(await storage.dump())).not.toContain(POST_TEXT);
    expect(await storage.get(HISTORY_TEXT_KEY)).toBeUndefined();
    expect(await storage.dump()).toEqual({});
  });

  it("clears every page, index and text key", async () => {
    const storage = new MemoryStorageArea();
    const history = createHistory({}, storage);
    await history.add(entry({ textHash: hashFor(31) }), {
      historyEnabled: true,
      storeFullText: true,
      text: POST_TEXT,
    });

    await history.clear();

    expect(await storage.dump()).toEqual({});
    expect(await history.query({})).toHaveLength(0);
  });

  it("exports entries without any text, even when full text is stored", async () => {
    const storage = new MemoryStorageArea();
    const history = createHistory({}, storage);
    await history.add(entry({ textHash: hashFor(41) }), {
      historyEnabled: true,
      storeFullText: true,
      text: POST_TEXT,
    });

    const exported = await history.export();
    expect(exported.entries).toHaveLength(1);
    expect(exported.entries.every((row) => !("text" in row))).toBe(true);
    expect(JSON.stringify(exported)).not.toContain(POST_TEXT);
  });

  it("recovers from a corrupt index", async () => {
    const storage = new MemoryStorageArea();
    await storage.set(HISTORY_INDEX_KEY, { pages: "corrupt" });
    const history = createHistory({}, storage);

    expect(await history.query({})).toHaveLength(0);
    await history.add(entry({ textHash: hashFor(51) }));
    expect(await history.query({})).toHaveLength(1);
  });

  it("rejects a non-positive maximumEntries", () => {
    expect(
      () =>
        new HistoryRepository(new MemoryStorageArea(), clock, {
          maximumEntries: 0,
        }),
    ).toThrow(RangeError);
  });
});
