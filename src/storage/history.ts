import { MAX_PLATFORM_ID_LENGTH } from "@/shared/constants";
import type {
  ClassificationStatus,
  Clock,
  HistoryEntry,
  HistoryFeedbackVerdict,
  HistoryOrigin,
  PresentationMode,
} from "@/shared/types";
import type { StorageArea } from "@/storage/storage-area";

/** Compact index describing which page keys exist and the total row count. */
export const HISTORY_INDEX_KEY = "cleanfeed.history.index.v1";
const PAGE_KEY_PREFIX = "cleanfeed.history.page.";

/** Storage key for one page of history rows (up to {@link PAGE_SIZE}). */
export const historyPageKey = (page: number): string =>
  `${PAGE_KEY_PREFIX}${page}`;

/**
 * Single storage key holding ALL opted-in full texts as one `hash -> text` map.
 * Using ONE key (rather than a key per hash) guarantees the text is always
 * reachable and removable regardless of the page index's state, so `clear()`
 * and `clearText()` can never leave orphaned, undeletable text behind if the
 * index or a page is corrupt or a write is interrupted. Text lives here ONLY
 * when the user opts in; it is never part of a page row nor of an export.
 */
export const HISTORY_TEXT_KEY = "cleanfeed.history.text.v1";

const SCHEMA_VERSION = 1;
const PAGE_SIZE = 100;
const DAY_MS = 86_400_000;

/** Default retention (days) applied when the caller does not specify one. */
export const DEFAULT_HISTORY_RETENTION_DAYS = 30;
/** Default row cap when history is enabled. */
export const DEFAULT_HISTORY_MAXIMUM_ENTRIES = 1_000;
/**
 * The user-facing configurable range for the row cap. Enforced by the settings
 * layer; the repository itself only requires a positive safe integer so tests
 * and callers can use tighter caps.
 */
export const HISTORY_MAXIMUM_ENTRIES_RANGE = { minimum: 100, maximum: 10_000 };

const SHA256_HEX = /^[0-9a-f]{64}$/;

const statuses = [
  "probably_human",
  "inconclusive",
  "possibly_ai",
  "strong_ai_indication",
  "insufficient_evidence",
  "classification_failed",
] as const satisfies readonly ClassificationStatus[];

const origins = ["ai", "rule"] as const satisfies readonly HistoryOrigin[];

const verdicts = [
  "human",
  "ai",
  "unknown",
] as const satisfies readonly HistoryFeedbackVerdict[];

const presentationModes = [
  "indicator",
  "blur",
  "collapse",
  "hide",
] as const satisfies readonly PresentationMode[];

export interface HistoryRepositoryOptions {
  retentionDays?: number;
  maximumEntries?: number;
  /**
   * The repository default for whether writes are recorded. It is `false` (OFF)
   * so a repository constructed without options records nothing; production
   * passes the user's `historyEnabled` setting per write instead.
   */
  historyEnabled?: boolean;
  /** The repository default for storing opted-in full text. `false` (no text). */
  storeFullText?: boolean;
}

/** Per-write overrides. Production supplies these from effective settings. */
export interface HistoryWriteOptions {
  historyEnabled?: boolean;
  storeFullText?: boolean;
  /** The post's normalized text; persisted (separately) only when opted in. */
  text?: string;
  /**
   * Retention window for this write's prune, from the user's live setting. When
   * omitted the repository default applies. Threaded per write so lowering the
   * setting takes effect without reconstructing the repository.
   */
  retentionDays?: number;
  /** Row cap for this write's prune, from the user's live setting. */
  maximumEntries?: number;
}

export interface HistoryQuery {
  platform?: string;
  status?: ClassificationStatus;
  from?: number;
  to?: number;
}

export interface HistoryExport {
  schemaVersion: typeof SCHEMA_VERSION;
  entries: HistoryEntry[];
}

interface HistoryIndex {
  schemaVersion: typeof SCHEMA_VERSION;
  pages: number[];
  count: number;
}

interface HistoryTextStore {
  schemaVersion: typeof SCHEMA_VERSION;
  texts: Record<string, string>;
}

/**
 * Number of page keys `clear()` sweeps unconditionally so pages survive no
 * matter what the (possibly corrupt) index says. Covers the full configurable
 * cap; enlarged for an instance whose cap exceeds the documented maximum.
 */
const CLEAR_SWEEP_PAGES = Math.ceil(
  HISTORY_MAXIMUM_ENTRIES_RANGE.maximum / PAGE_SIZE,
);

const realClock: Clock = { now: () => Date.now() };

/**
 * A bounded, local-only, OPT-IN store of classification history. Privacy is the
 * core requirement:
 *
 * - It is OFF by default: a write whose effective `historyEnabled` is false
 *   touches no storage at all (the storage dump stays empty).
 * - A row NEVER carries the post's text, author or URL. Rows are sanitized to a
 *   fixed allowlist before persisting.
 * - Full text is stored ONLY when the user opts in, under a SEPARATE key
 *   ({@link HISTORY_TEXT_KEY}); it is never part of a page row nor of an export.
 *   This local separation is convenience, not protection against the local user
 *   who owns the machine, so it is independently clearable via {@link clearText}.
 *
 * Rows are persisted in pages of up to {@link PAGE_SIZE} entries plus a compact
 * index, and pruned by BOTH retention age and the maximum-entry cap.
 */
export class HistoryRepository {
  private mutation = Promise.resolve();
  private readonly retentionMs: number;
  private readonly maximumEntries: number;
  private readonly defaultEnabled: boolean;
  private readonly defaultStoreFullText: boolean;

  constructor(
    private readonly storage: StorageArea,
    private readonly clock: Clock = realClock,
    options: HistoryRepositoryOptions = {},
  ) {
    const retentionDays =
      options.retentionDays ?? DEFAULT_HISTORY_RETENTION_DAYS;
    const maximumEntries =
      options.maximumEntries ?? DEFAULT_HISTORY_MAXIMUM_ENTRIES;
    if (!Number.isSafeInteger(retentionDays) || retentionDays < 1) {
      throw new RangeError("retentionDays must be a positive safe integer.");
    }
    if (!Number.isSafeInteger(maximumEntries) || maximumEntries < 1) {
      throw new RangeError("maximumEntries must be a positive safe integer.");
    }
    this.retentionMs = retentionDays * DAY_MS;
    this.maximumEntries = maximumEntries;
    this.defaultEnabled = options.historyEnabled ?? false;
    this.defaultStoreFullText = options.storeFullText ?? false;
  }

  /**
   * Records one entry, merging by `textHash` (so reveal/feedback updates never
   * duplicate a row) and pruning by retention and cap. Writes NOTHING when the
   * effective `historyEnabled` is false. Persists full text separately only when
   * the effective `storeFullText` is true and text is provided.
   */
  add(entry: HistoryEntry, options: HistoryWriteOptions = {}): Promise<void> {
    const enabled = options.historyEnabled ?? this.defaultEnabled;
    if (!enabled) {
      return Promise.resolve();
    }
    const storeFullText = options.storeFullText ?? this.defaultStoreFullText;
    const clean = sanitizeEntry(entry);
    if (clean === null) {
      return Promise.reject(new Error("INVALID_HISTORY_ENTRY"));
    }
    const text = options.text;
    const retentionMs = resolveRetentionMs(
      options.retentionDays,
      this.retentionMs,
    );
    const maximumEntries = resolvePositiveInteger(
      options.maximumEntries,
      this.maximumEntries,
    );
    return this.runMutation(async () => {
      const { entries, pages } = await this.readState();
      const existingIndex = entries.findIndex(
        (row) => row.textHash === clean.textHash,
      );
      if (existingIndex >= 0) {
        entries[existingIndex] = mergeEntry(entries[existingIndex], clean);
      } else {
        entries.push(clean);
      }
      const { kept, removedHashes } = this.pruneEntries(
        entries,
        retentionMs,
        maximumEntries,
      );
      const keptHashes = new Set(kept.map((row) => row.textHash));

      const store = storeFullText ? "keep" : "drop";
      if (
        store === "keep" &&
        typeof text === "string" &&
        text.length > 0 &&
        keptHashes.has(clean.textHash)
      ) {
        // Removing the pruned hashes and adding this one in a single map write.
        await this.updateTexts(removedHashes, [clean.textHash, text]);
      } else {
        await this.removeTexts(removedHashes);
      }
      await this.writeState(kept, pages);
    });
  }

  /**
   * Returns rows matching the filter, newest first. Rows never carry text: the
   * filter is applied to the lightweight page rows without touching text keys.
   */
  query(filter: HistoryQuery = {}): Promise<HistoryEntry[]> {
    return this.runMutation(async () => {
      const { entries } = await this.readState();
      return entries
        .filter((row) => matchesFilter(row, filter))
        .sort((left, right) => right.timestamp - left.timestamp)
        .map(sanitizeStored);
    });
  }

  /** Exports the (text-free) rows. A generic export NEVER carries full text. */
  export(): Promise<HistoryExport> {
    return this.runMutation(async () => {
      const { entries } = await this.readState();
      return {
        schemaVersion: SCHEMA_VERSION,
        entries: entries
          .sort((left, right) => right.timestamp - left.timestamp)
          .map(sanitizeStored),
      };
    });
  }

  /**
   * Removes the opted-in text, the index and a bounded superset of page keys
   * unconditionally, so NOTHING is left orphaned even if the index or a page is
   * corrupt (StorageArea exposes no key enumeration, hence the deterministic
   * page sweep). A completed clear always leaves the store empty.
   */
  clear(): Promise<void> {
    return this.runMutation(async () => {
      const index = await this.readIndex();
      const pageCount = Math.max(
        CLEAR_SWEEP_PAGES,
        Math.ceil(this.maximumEntries / PAGE_SIZE),
        ...index.pages.map((page) => page + 1),
      );
      const pageKeys = Array.from({ length: pageCount }, (_, page) =>
        historyPageKey(page),
      );
      await this.storage.remove([
        ...pageKeys,
        HISTORY_INDEX_KEY,
        HISTORY_TEXT_KEY,
      ]);
    });
  }

  /**
   * Removes only the opted-in full text, leaving the (already text-free) rows
   * intact. Removing the single text key is unconditional, so it cannot leave
   * orphaned text even if the index is unreadable.
   */
  clearText(): Promise<void> {
    return this.runMutation(async () => {
      await this.storage.remove(HISTORY_TEXT_KEY);
    });
  }

  /** Applies retention and cap pruning on demand (repository defaults). */
  prune(): Promise<void> {
    return this.runMutation(async () => {
      const { entries, pages } = await this.readState();
      const { kept, removedHashes } = this.pruneEntries(
        entries,
        this.retentionMs,
        this.maximumEntries,
      );
      if (removedHashes.length === 0 && kept.length === entries.length) {
        return;
      }
      await this.removeTexts(removedHashes);
      await this.writeState(kept, pages);
    });
  }

  private pruneEntries(
    entries: HistoryEntry[],
    retentionMs: number,
    maximumEntries: number,
  ): {
    kept: HistoryEntry[];
    removedHashes: string[];
  } {
    const cutoff = this.clock.now() - retentionMs;
    const chronological = [...entries].sort(
      (left, right) =>
        left.timestamp - right.timestamp ||
        left.textHash.localeCompare(right.textHash),
    );
    const withinRetention = chronological.filter(
      (row) => row.timestamp >= cutoff,
    );
    const kept = withinRetention.slice(-maximumEntries);
    const keptHashes = new Set(kept.map((row) => row.textHash));
    const removedHashes = entries
      .filter((row) => !keptHashes.has(row.textHash))
      .map((row) => row.textHash);
    return { kept, removedHashes };
  }

  /** Reads the opted-in `hash -> text` map (empty when absent or malformed). */
  private async readTexts(): Promise<Record<string, string>> {
    const value = await this.storage.get<unknown>(HISTORY_TEXT_KEY);
    if (!isRecord(value) || !isRecord(value.texts)) {
      return {};
    }
    const texts: Record<string, string> = {};
    for (const [hash, text] of Object.entries(value.texts)) {
      if (typeof text === "string") texts[hash] = text;
    }
    return texts;
  }

  private async writeTexts(texts: Record<string, string>): Promise<void> {
    if (Object.keys(texts).length === 0) {
      await this.storage.remove(HISTORY_TEXT_KEY);
      return;
    }
    await this.storage.set<HistoryTextStore>(HISTORY_TEXT_KEY, {
      schemaVersion: SCHEMA_VERSION,
      texts,
    });
  }

  /** Drops the given hashes' texts from the map in a single read-modify-write. */
  private async removeTexts(hashes: string[]): Promise<void> {
    if (hashes.length === 0) return;
    const texts = await this.readTexts();
    let changed = false;
    for (const hash of hashes) {
      if (hash in texts) {
        delete texts[hash];
        changed = true;
      }
    }
    if (changed) await this.writeTexts(texts);
  }

  /** Drops some hashes and upserts one text in a single map write. */
  private async updateTexts(
    removeHashes: string[],
    upsert: readonly [hash: string, text: string],
  ): Promise<void> {
    const texts = await this.readTexts();
    for (const hash of removeHashes) delete texts[hash];
    texts[upsert[0]] = upsert[1];
    await this.writeTexts(texts);
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async readState(): Promise<{
    entries: HistoryEntry[];
    pages: number[];
  }> {
    const index = await this.readIndex();
    if (index.pages.length === 0) {
      return { entries: [], pages: [] };
    }
    const stored = await this.storage.getMany<unknown>(
      index.pages.map(historyPageKey),
    );
    const entries: HistoryEntry[] = [];
    for (const page of index.pages) {
      const value = stored[historyPageKey(page)];
      if (!Array.isArray(value)) {
        continue;
      }
      for (const row of value) {
        const clean = sanitizeEntry(row);
        if (clean !== null) {
          entries.push(clean);
        }
      }
    }
    return { entries, pages: index.pages };
  }

  private async readIndex(): Promise<HistoryIndex> {
    const value = await this.storage.get<unknown>(HISTORY_INDEX_KEY);
    if (value === undefined) {
      return { schemaVersion: SCHEMA_VERSION, pages: [], count: 0 };
    }
    if (!isHistoryIndex(value)) {
      await this.storage.remove(HISTORY_INDEX_KEY);
      return { schemaVersion: SCHEMA_VERSION, pages: [], count: 0 };
    }
    return value;
  }

  private async writeState(
    entries: HistoryEntry[],
    previousPages: number[],
  ): Promise<void> {
    if (entries.length === 0) {
      if (previousPages.length > 0) {
        await this.storage.remove(previousPages.map(historyPageKey));
      }
      await this.storage.remove(HISTORY_INDEX_KEY);
      return;
    }

    const pageCount = Math.ceil(entries.length / PAGE_SIZE);
    const pages = Array.from({ length: pageCount }, (_, page) => page);
    for (const page of pages) {
      const slice = entries.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
      await this.storage.set(historyPageKey(page), slice);
    }
    const stalePages = previousPages.filter((page) => page >= pageCount);
    if (stalePages.length > 0) {
      await this.storage.remove(stalePages.map(historyPageKey));
    }
    await this.storage.set<HistoryIndex>(HISTORY_INDEX_KEY, {
      schemaVersion: SCHEMA_VERSION,
      pages,
      count: entries.length,
    });
  }
}

function isPositiveSafeInteger(value: number): boolean {
  return Number.isSafeInteger(value) && value >= 1;
}

/** Per-write retention window; falls back to the default for invalid input. */
function resolveRetentionMs(
  retentionDays: number | undefined,
  fallback: number,
): number {
  if (retentionDays === undefined) return fallback;
  return isPositiveSafeInteger(retentionDays)
    ? retentionDays * DAY_MS
    : fallback;
}

/** Per-write positive integer; falls back to the default for invalid input. */
function resolvePositiveInteger(
  value: number | undefined,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  return isPositiveSafeInteger(value) ? value : fallback;
}

/**
 * Merges an incoming entry onto an existing one keyed by the same `textHash`.
 * The original `timestamp` (first-seen classification time) is preserved so
 * retention stays deterministic; any newly-provided field overrides.
 */
function mergeEntry(
  existing: HistoryEntry,
  incoming: HistoryEntry,
): HistoryEntry {
  return {
    ...existing,
    ...incoming,
    timestamp: existing.timestamp,
  };
}

function matchesFilter(row: HistoryEntry, filter: HistoryQuery): boolean {
  if (filter.platform !== undefined && row.platform !== filter.platform) {
    return false;
  }
  if (filter.status !== undefined && row.status !== filter.status) {
    return false;
  }
  if (filter.from !== undefined && row.timestamp < filter.from) {
    return false;
  }
  if (filter.to !== undefined && row.timestamp > filter.to) {
    return false;
  }
  return true;
}

/** Rebuilds a row from allowlisted, validated fields; returns null if invalid. */
function sanitizeEntry(value: unknown): HistoryEntry | null {
  if (!isRecord(value)) {
    return null;
  }
  if (
    typeof value.textHash !== "string" ||
    !SHA256_HEX.test(value.textHash) ||
    !isBoundedString(value.platform, MAX_PLATFORM_ID_LENGTH) ||
    !statuses.includes(value.status as ClassificationStatus) ||
    !isProbability(value.score) ||
    !isNonNegativeInteger(value.timestamp)
  ) {
    return null;
  }
  const entry: HistoryEntry = {
    textHash: value.textHash,
    platform: value.platform,
    status: value.status as ClassificationStatus,
    score: value.score,
    timestamp: value.timestamp,
  };
  if (origins.includes(value.origin as HistoryOrigin)) {
    entry.origin = value.origin as HistoryOrigin;
  }
  if (presentationModes.includes(value.action as PresentationMode)) {
    entry.action = value.action as PresentationMode;
  }
  if (typeof value.revealed === "boolean") {
    entry.revealed = value.revealed;
  }
  if (verdicts.includes(value.feedback as HistoryFeedbackVerdict)) {
    entry.feedback = value.feedback as HistoryFeedbackVerdict;
  }
  return entry;
}

/** A defensive copy of an already-validated stored row (allowlist only). */
function sanitizeStored(entry: HistoryEntry): HistoryEntry {
  return sanitizeEntry(entry) as HistoryEntry;
}

function isHistoryIndex(value: unknown): value is HistoryIndex {
  return (
    isRecord(value) &&
    Object.keys(value).length === 3 &&
    value.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(value.pages) &&
    value.pages.every(
      (page) => Number.isSafeInteger(page) && (page as number) >= 0,
    ) &&
    isNonNegativeInteger(value.count)
  );
}

function isProbability(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maximumLength
  );
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
