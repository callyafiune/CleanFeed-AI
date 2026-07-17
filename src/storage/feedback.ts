import { MAX_PLATFORM_ID_LENGTH } from "@/shared/constants";
import type { ClassificationStatus } from "@/shared/types";
import type { StorageArea } from "@/storage/storage-area";

const FEEDBACK_KEY = "cleanfeed.feedback.v1";
const SCHEMA_VERSION = 1;
const DEFAULT_MAX_RECORDS = 2_000;
const MODEL_VERSION_MAX_LENGTH = 256;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/** The user's local, non-identifying verdict about a single classification. */
export type FeedbackVerdict = "human" | "ai" | "unknown";

const verdicts = [
  "human",
  "ai",
  "unknown",
] as const satisfies readonly FeedbackVerdict[];

const statuses = [
  "probably_human",
  "inconclusive",
  "possibly_ai",
  "strong_ai_indication",
  "insufficient_evidence",
  "classification_failed",
] as const satisfies readonly ClassificationStatus[];

/**
 * A single feedback entry. It deliberately carries only a content hash plus the
 * minimal metadata needed to interpret the verdict later. It must never contain
 * the post's text, author or URL.
 */
export interface FeedbackRecord {
  textHash: string;
  predictedScore: number;
  predictedStatus: ClassificationStatus;
  feedback: FeedbackVerdict;
  modelVersion: string;
  platform: string;
  createdAt: number;
}

const RECORD_KEYS = [
  "textHash",
  "predictedScore",
  "predictedStatus",
  "feedback",
  "modelVersion",
  "platform",
  "createdAt",
] as const;

interface PersistedFeedback {
  schemaVersion: typeof SCHEMA_VERSION;
  records: FeedbackRecord[];
}

export interface FeedbackRepositoryOptions {
  maximumRecords?: number;
}

/**
 * A bounded, local-only store of classification feedback keyed by content hash.
 * Mirrors the other storage repositories: a single serialized value guarded by
 * an allowlist validator, a serialized mutation queue and versioned recovery.
 */
export class FeedbackRepository {
  private mutation = Promise.resolve();
  private readonly maximumRecords: number;

  constructor(
    private readonly storage: StorageArea,
    options: FeedbackRepositoryOptions = {},
  ) {
    const maximumRecords = options.maximumRecords ?? DEFAULT_MAX_RECORDS;
    if (!Number.isSafeInteger(maximumRecords) || maximumRecords < 1) {
      throw new RangeError("maximumRecords must be a positive safe integer.");
    }
    this.maximumRecords = maximumRecords;
  }

  /**
   * Persists one verdict, replacing any earlier verdict for the same
   * hash/model version and evicting the least recent records past the cap.
   */
  add(record: FeedbackRecord): Promise<void> {
    if (!isFeedbackRecord(record)) {
      return Promise.reject(new Error("INVALID_FEEDBACK"));
    }

    // Rebuild from allowlisted fields only: even a validated object can never
    // carry extra keys into storage.
    const clean = sanitize(record);
    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      const withoutPrevious = persisted.records.filter(
        (entry) =>
          !(
            entry.textHash === clean.textHash &&
            entry.modelVersion === clean.modelVersion
          ),
      );
      const records = [...withoutPrevious, clean]
        .sort((left, right) => left.createdAt - right.createdAt)
        .slice(-this.maximumRecords);
      await this.storage.set<PersistedFeedback>(FEEDBACK_KEY, {
        schemaVersion: SCHEMA_VERSION,
        records,
      });
    });
  }

  list(): Promise<FeedbackRecord[]> {
    return this.runMutation(async () => {
      const persisted = await this.readPersisted();
      return persisted.records.map(sanitize);
    });
  }

  clear(): Promise<void> {
    return this.runMutation(() => this.storage.remove(FEEDBACK_KEY));
  }

  private runMutation<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.mutation.then(operation, operation);
    this.mutation = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async readPersisted(): Promise<PersistedFeedback> {
    const value = await this.storage.get<unknown>(FEEDBACK_KEY);
    if (value === undefined) {
      return { schemaVersion: SCHEMA_VERSION, records: [] };
    }

    if (!isPersistedFeedback(value)) {
      await this.storage.remove(FEEDBACK_KEY);
      return { schemaVersion: SCHEMA_VERSION, records: [] };
    }

    return value;
  }
}

function sanitize(record: FeedbackRecord): FeedbackRecord {
  return {
    textHash: record.textHash,
    predictedScore: record.predictedScore,
    predictedStatus: record.predictedStatus,
    feedback: record.feedback,
    modelVersion: record.modelVersion,
    platform: record.platform,
    createdAt: record.createdAt,
  };
}

function isFeedbackRecord(value: unknown): value is FeedbackRecord {
  if (!isRecord(value)) {
    return false;
  }

  const keys = Object.keys(value);
  if (
    keys.length !== RECORD_KEYS.length ||
    !RECORD_KEYS.every((key) => Object.hasOwn(value, key))
  ) {
    return false;
  }

  return (
    typeof value.textHash === "string" &&
    SHA256_HEX.test(value.textHash) &&
    isProbability(value.predictedScore) &&
    statuses.includes(value.predictedStatus as ClassificationStatus) &&
    verdicts.includes(value.feedback as FeedbackVerdict) &&
    isBoundedString(value.modelVersion, MODEL_VERSION_MAX_LENGTH) &&
    isBoundedString(value.platform, MAX_PLATFORM_ID_LENGTH) &&
    isNonNegativeInteger(value.createdAt)
  );
}

function isPersistedFeedback(value: unknown): value is PersistedFeedback {
  return (
    isRecord(value) &&
    Object.keys(value).length === 2 &&
    value.schemaVersion === SCHEMA_VERSION &&
    Array.isArray(value.records) &&
    value.records.every(isFeedbackRecord)
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
