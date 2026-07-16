import { parseExtensionMessage } from "@/shared/message-validation";
import type {
  CachedClassification,
  ClassificationResult,
  Clock,
} from "@/shared/types";
import type { StorageArea } from "@/storage/storage-area";

const INDEX_KEY = "cleanfeed.cache.index.v1";
const entryKey = (key: string): string => `cleanfeed.cache.entry.${key}`;

interface CacheIndexEntry {
  key: string;
  lastAccessedAt: number;
  expiresAt: number;
}

interface CacheIndex {
  entries: CacheIndexEntry[];
}

export interface ClassificationCacheOptions {
  maximumEntries: number;
  ttlMs: number;
}

export const buildCacheKey = (
  platform: string,
  model: string,
  settings: string,
  hash: string,
): string => `${platform}:${model}:${settings}:${hash}`;

/** A bounded local cache whose keys deliberately include model and settings versions. */
export class ClassificationCache {
  private mutation = Promise.resolve();

  constructor(
    private readonly storage: StorageArea,
    private readonly clock: Clock,
    private readonly options: ClassificationCacheOptions,
  ) {
    if (
      !Number.isSafeInteger(options.maximumEntries) ||
      options.maximumEntries < 1 ||
      !Number.isSafeInteger(options.ttlMs) ||
      options.ttlMs < 1
    ) {
      throw new RangeError("Cache limits must be positive safe integers.");
    }
  }

  get(key: string): Promise<ClassificationResult | undefined> {
    return this.runMutation(async () => {
      const index = await this.readIndex();
      const indexed = index.entries.find((entry) => entry.key === key);
      if (indexed === undefined) {
        return undefined;
      }

      const cached = await this.storage.get<unknown>(entryKey(key));
      if (
        indexed.expiresAt <= this.clock.now() ||
        !isCachedClassification(cached) ||
        cached.expiresAt !== indexed.expiresAt
      ) {
        await this.removeEntries(index, [key]);
        return undefined;
      }

      const lastAccessedAt = this.clock.now();
      const result = withoutDebugTimings(cached.result);
      await this.storage.set(entryKey(key), {
        ...cached,
        result,
        lastAccessedAt,
      });
      await this.writeIndex({
        entries: index.entries.map((entry) =>
          entry.key === key ? { ...entry, lastAccessedAt } : entry,
        ),
      });

      return result;
    });
  }

  set(key: string, result: ClassificationResult): Promise<void> {
    return this.runMutation(async () => {
      const now = this.clock.now();
      const index = await this.readIndex();
      const entry: CachedClassification = {
        result: withoutDebugTimings(result),
        createdAt: now,
        lastAccessedAt: now,
        expiresAt: now + this.options.ttlMs,
      };
      const entries = index.entries.filter((item) => item.key !== key);
      entries.push({
        key,
        lastAccessedAt: entry.lastAccessedAt,
        expiresAt: entry.expiresAt,
      });

      await this.storage.set(entryKey(key), entry);
      await this.writeIndex({ entries });
      await this.pruneInternal();
    });
  }

  clear(): Promise<void> {
    return this.runMutation(async () => {
      const index = await this.readIndex();
      await this.storage.remove(
        index.entries.map((entry) => entryKey(entry.key)),
      );
      await this.storage.remove(INDEX_KEY);
    });
  }

  prune(): Promise<void> {
    return this.runMutation(() => this.pruneInternal());
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async readIndex(): Promise<CacheIndex> {
    const value = await this.storage.get<unknown>(INDEX_KEY);
    if (value === undefined) {
      return { entries: [] };
    }

    if (!isCacheIndex(value)) {
      await this.storage.remove(INDEX_KEY);
      return { entries: [] };
    }

    return value;
  }

  private async writeIndex(index: CacheIndex): Promise<void> {
    await this.storage.set(INDEX_KEY, index);
  }

  private async removeEntries(
    index: CacheIndex,
    keys: string[],
  ): Promise<void> {
    if (keys.length === 0) {
      return;
    }

    const removed = new Set(keys);
    await this.storage.remove(keys.map(entryKey));
    await this.writeIndex({
      entries: index.entries.filter((entry) => !removed.has(entry.key)),
    });
  }

  private async pruneInternal(): Promise<void> {
    const index = await this.readIndex();
    const now = this.clock.now();
    const liveEntries = index.entries.filter((entry) => entry.expiresAt > now);
    const staleKeys = index.entries
      .filter((entry) => entry.expiresAt <= now)
      .map((entry) => entry.key);
    const leastRecentlyUsedFirst = [...liveEntries].sort(
      (left, right) =>
        left.lastAccessedAt - right.lastAccessedAt ||
        left.key.localeCompare(right.key),
    );
    const overflow = Math.max(
      0,
      leastRecentlyUsedFirst.length - this.options.maximumEntries,
    );
    const evictedKeys = leastRecentlyUsedFirst
      .slice(0, overflow)
      .map((entry) => entry.key);
    const removed = new Set([...staleKeys, ...evictedKeys]);

    if (removed.size > 0) {
      await this.storage.remove([...removed].map(entryKey));
    }

    const keptEntries = liveEntries.filter((entry) => !removed.has(entry.key));
    if (removed.size > 0 || keptEntries.length !== index.entries.length) {
      await this.writeIndex({ entries: keptEntries });
    }
  }
}

/** Debug timings are response-only and must never reach persistent storage. */
function withoutDebugTimings(
  result: ClassificationResult,
): ClassificationResult {
  const { stageTimings: _stageTimings, ...cached } = result;
  return cached;
}

function isCacheIndex(value: unknown): value is CacheIndex {
  return (
    isRecord(value) &&
    Object.keys(value).length === 1 &&
    Array.isArray(value.entries) &&
    value.entries.every(isCacheIndexEntry) &&
    new Set(value.entries.map((entry) => entry.key)).size ===
      value.entries.length
  );
}

function isCacheIndexEntry(value: unknown): value is CacheIndexEntry {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    typeof value.key === "string" &&
    value.key.length > 0 &&
    isTimestamp(value.lastAccessedAt) &&
    isTimestamp(value.expiresAt) &&
    value.expiresAt >= value.lastAccessedAt
  );
}

function isCachedClassification(value: unknown): value is CachedClassification {
  return (
    isRecord(value) &&
    Object.keys(value).length === 4 &&
    isTimestamp(value.createdAt) &&
    isTimestamp(value.lastAccessedAt) &&
    isTimestamp(value.expiresAt) &&
    value.createdAt <= value.lastAccessedAt &&
    value.lastAccessedAt <= value.expiresAt &&
    isClassificationResult(value.result)
  );
}

function isClassificationResult(value: unknown): value is ClassificationResult {
  try {
    parseExtensionMessage({
      source: "background",
      target: "content",
      type: "CLASSIFICATION_RESULT",
      requestId: "cache-validation",
      payload: value,
    });
    return true;
  } catch {
    return false;
  }
}

function isTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
