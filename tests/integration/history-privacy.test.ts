import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { Clock, HistoryEntry, StorageArea } from "@/shared/types";
import {
  HISTORY_TEXT_KEY,
  HistoryRepository,
  historyPageKey,
} from "@/storage/history";

const DAY_MS = 86_400_000;
const NOW = 20_000 * DAY_MS;
const clock: Clock = { now: () => NOW };

const POST_TEXT =
  "Conteúdo integral de uma publicação que representa dados pessoais sensíveis do usuário.";

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

const hash = "a".repeat(64);

function entry(): HistoryEntry {
  return {
    textHash: hash,
    platform: "linkedin",
    status: "possibly_ai",
    score: 0.88,
    timestamp: NOW,
  };
}

describe("history privacy guarantees", () => {
  it("is disabled by default, mirroring DEFAULT_SETTINGS", () => {
    expect(DEFAULT_SETTINGS.historyEnabled).toBe(false);
    expect(DEFAULT_SETTINGS.storeFullText).toBe(false);
  });

  it("writes nothing when the repository is used with default (off) settings", async () => {
    const storage = new MemoryStorageArea();
    const history = new HistoryRepository(storage, clock);

    await history.add(entry(), {
      historyEnabled: DEFAULT_SETTINGS.historyEnabled,
      storeFullText: DEFAULT_SETTINGS.storeFullText,
      text: POST_TEXT,
    });

    expect(await storage.dump()).toEqual({});
  });

  it("never persists post text while enabled but not storing full text", async () => {
    const storage = new MemoryStorageArea();
    const history = new HistoryRepository(storage, clock, {
      historyEnabled: true,
    });

    await history.add(entry(), {
      historyEnabled: true,
      storeFullText: false,
      text: POST_TEXT,
    });

    const serialized = JSON.stringify(await storage.dump());
    expect(serialized).not.toContain(POST_TEXT);
    expect(await storage.get(HISTORY_TEXT_KEY)).toBeUndefined();
    const rows = await history.query({});
    expect(rows).toHaveLength(1);
    expect(rows.every((row) => !("text" in row))).toBe(true);
  });

  it("keeps opted-in full text out of pages and generic export", async () => {
    const storage = new MemoryStorageArea();
    const history = new HistoryRepository(storage, clock, {
      historyEnabled: true,
    });

    await history.add(entry(), {
      historyEnabled: true,
      storeFullText: true,
      text: POST_TEXT,
    });

    // The text lives only in the single, dedicated text map.
    expect(JSON.stringify(await storage.get(HISTORY_TEXT_KEY))).toContain(
      POST_TEXT,
    );
    expect(JSON.stringify(await storage.get(historyPageKey(0)))).not.toContain(
      POST_TEXT,
    );
    const exported = await history.export();
    expect(JSON.stringify(exported)).not.toContain(POST_TEXT);

    // Clearing text independently leaves the (text-free) entries intact.
    await history.clearText();
    expect(await storage.get(HISTORY_TEXT_KEY)).toBeUndefined();
    expect(await history.query({})).toHaveLength(1);
  });
});
