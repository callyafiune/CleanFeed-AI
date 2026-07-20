import { parseExtensionMessage } from "@/shared/message-validation";
import type {
  CachedClassification,
  ClassificationResult,
  Clock,
  RuntimeModelIdentity,
} from "@/shared/types";
import type { StorageArea } from "@/storage/storage-area";
import { canonicalJson } from "../../contracts/canonical-json";

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

/**
 * The model component of a cache key: the FULL runtime identity, serialized
 * canonically. Changing any sealing coordinate — a bundle's bundleDigest,
 * tokenizerDigest, aggregationVersion, contentCompositionVersion or
 * calibrationSetDigest, or a builtin's implementationVersion — changes the key,
 * so a result from one model can never be served as another's. The selected
 * calibration profile is deliberately absent: it is known only AFTER the lookup,
 * and its expiry bounds the STORED record's TTL rather than the key. Identity is
 * never derived from the legacy `modelId`/`modelVersion` fields alone.
 */
export const buildRuntimeModelKey = (identity: RuntimeModelIdentity): string =>
  canonicalJson(identity);

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
    return this.lookup(key, this.clock.now(), undefined);
  }

  /**
   * The identity-bound read of the two-phase flow: reads under `now`, then
   * RE-COMPARES the stored result's full runtime identity against `identity`.
   * A record produced by a different (e.g. superseded) model is rejected and
   * evicted even though it was found under this key, so a stale identity can
   * never be served after a bundle, aggregation or calibration change.
   */
  getCachedClassification(
    key: string,
    now: number,
    identity: RuntimeModelIdentity,
  ): Promise<ClassificationResult | undefined> {
    return this.lookup(key, now, identity);
  }

  private lookup(
    key: string,
    now: number,
    identity: RuntimeModelIdentity | undefined,
  ): Promise<ClassificationResult | undefined> {
    return this.runMutation(async () => {
      const index = await this.readIndex();
      const indexed = index.entries.find((entry) => entry.key === key);
      if (indexed === undefined) {
        return undefined;
      }

      const cached = await this.storage.get<unknown>(entryKey(key));
      if (
        indexed.expiresAt <= now ||
        !isCachedClassification(cached) ||
        cached.expiresAt !== indexed.expiresAt ||
        (identity !== undefined &&
          canonicalJson(cached.result.runtimeIdentity) !==
            canonicalJson(identity))
      ) {
        await this.removeEntries(index, [key]);
        return undefined;
      }

      const lastAccessedAt = now;
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
        // The selected profile's expiry bounds the record's life: a valid TMR
        // profile that expires before the normal TTL must not keep serving.
        expiresAt: clampToProfileExpiry(
          now + this.options.ttlMs,
          result.cacheValidUntil,
        ),
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

  /**
   * Removes a single entry by key. Used to migrate away a result cached under
   * the old fixed model key once the same content is written under the new
   * identity-bound key. A no-op when the key is absent.
   */
  remove(key: string): Promise<void> {
    return this.runMutation(async () => {
      const index = await this.readIndex();
      if (!index.entries.some((entry) => entry.key === key)) {
        return;
      }
      await this.removeEntries(index, [key]);
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

/**
 * Bounds the normal TTL expiry by the selected profile's expiry when present.
 * A malformed or absent `cacheValidUntil` leaves the normal TTL untouched.
 */
function clampToProfileExpiry(
  ttlExpiresAt: number,
  cacheValidUntil: string | undefined,
): number {
  if (cacheValidUntil === undefined) {
    return ttlExpiresAt;
  }
  const profileExpiresAt = Date.parse(cacheValidUntil);
  if (Number.isNaN(profileExpiresAt)) {
    return ttlExpiresAt;
  }
  return Math.min(ttlExpiresAt, profileExpiresAt);
}

/** Debug timings are response-only and must never reach persistent storage. */
function withoutDebugTimings(
  result: ClassificationResult,
): ClassificationResult {
  const cached = { ...result };
  delete cached.stageTimings;
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
