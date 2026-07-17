import { beforeEach, describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { UserSettings } from "@/shared/settings-types";
import type { HistoryEntry, StorageArea } from "@/shared/types";
import { HistoryRepository } from "@/storage/history";
import {
  createImportExport,
  type ImportPreview,
} from "@/storage/import-export";
import { SettingsRepository } from "@/storage/settings";

/**
 * A storage area whose writes can be made to fail for a configurable set of
 * keys, so we can drive a mid-apply failure and assert the compensating
 * transaction restores every affected category.
 */
class FaultyStorageArea implements StorageArea {
  private readonly values = new Map<string, unknown>();
  failWrite?: (key: string) => boolean;

  async get<T>(key: string): Promise<T | undefined> {
    return this.values.get(key) as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    if (this.failWrite?.(key)) {
      throw new Error("quota");
    }
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
}

const HASH = "a".repeat(64);

function historyEntry(): HistoryEntry {
  return {
    textHash: HASH,
    platform: "linkedin",
    status: "possibly_ai",
    score: 0.9,
    // Recent, so it survives the repository's retention window on import.
    timestamp: Date.now(),
  };
}

describe("import atomicity", () => {
  let storage: FaultyStorageArea;
  let io: ReturnType<typeof createImportExport>;
  let originalSettings: UserSettings;
  let validPreview: ImportPreview;

  beforeEach(async () => {
    storage = new FaultyStorageArea();
    io = createImportExport({ storage, extensionVersion: "1.0.0" });

    originalSettings = { ...DEFAULT_SETTINGS };
    await new SettingsRepository(storage).save(originalSettings);

    const importedSettings: UserSettings = {
      ...DEFAULT_SETTINGS,
      enabled: false,
    };
    const exportJson = JSON.stringify({
      schemaVersion: 1,
      extensionVersion: "1.0.0",
      exportedAt: new Date(0).toISOString(),
      settings: importedSettings,
      history: [historyEntry()],
    });
    validPreview = io.previewImport(await io.parseImport(exportJson));
  });

  it("rolls back every category — including a destructive replace — when a later write fails", async () => {
    // Seed PRE-EXISTING history that a replace import will clear+rewrite. The
    // failure is injected on a LATER category (metrics) so the rollback's own
    // history restore writes are not themselves blocked — this proves the
    // destructive clear() was truly reverted, which an empty-history store could
    // not prove.
    const seededHash = "b".repeat(64);
    await new HistoryRepository(storage).add(
      {
        textHash: seededHash,
        platform: "linkedin",
        status: "probably_human",
        score: 0.2,
        timestamp: Date.now(),
      },
      { historyEnabled: true },
    );

    const preview = io.previewImport(
      await io.parseImport(
        JSON.stringify({
          schemaVersion: 1,
          extensionVersion: "1.0.0",
          exportedAt: new Date(0).toISOString(),
          settings: { ...DEFAULT_SETTINGS, enabled: false },
          history: [historyEntry()],
          metrics: { schemaVersion: 2, metrics: {} },
        }),
      ),
    );

    // Only the metrics write fails; settings + history (and their restores) work.
    storage.failWrite = (key) => key === "cleanfeed.metrics.v1";

    await expect(
      io.applyImport(preview, {
        mode: "replace",
        categories: ["settings", "history", "metrics"],
      }),
    ).rejects.toMatchObject({ code: "STORAGE_ERROR" });

    // Settings restored to the original (the enabled:false import was reverted).
    expect(await new SettingsRepository(storage).get()).toEqual(
      originalSettings,
    );
    // The pre-existing history survived: the replace-mode clear() + rewrite was
    // rolled back to exactly the seeded entry, not the imported one.
    const rows = await new HistoryRepository(storage).query();
    expect(rows).toHaveLength(1);
    expect(rows[0].textHash).toBe(seededHash);
  });

  it("commits every selected category when all writes succeed", async () => {
    await io.applyImport(validPreview, {
      mode: "replace",
      categories: ["settings", "history"],
    });

    expect((await new SettingsRepository(storage).get()).enabled).toBe(false);
    const rows = await new HistoryRepository(storage).query();
    expect(rows).toHaveLength(1);
    expect(rows[0].textHash).toBe(HASH);
  });
});
