/**
 * Every coded error class the extension can raise, as a VALUE rather than only a
 * type. It is enumerable at runtime so the failure-detail allowlist can be
 * checked against it by a test instead of by hand: `ErrorCode` and
 * `FAILURE_DETAIL_CODES` are two vocabularies that must not drift, and a union
 * type cannot be iterated.
 */
export const ERROR_CODES = [
  "MODEL_LOAD_FAILED",
  "TOKENIZATION_FAILED",
  "INSUFFICIENT_EVIDENCE",
  "INFERENCE_FAILED",
  "INFERENCE_TIMEOUT",
  "WORKER_UNAVAILABLE",
  "WEBGPU_UNAVAILABLE",
  "CACHE_ERROR",
  "STORAGE_ERROR",
  "INVALID_SETTINGS",
  "INVALID_MESSAGE",
  "PLATFORM_EXTRACTION_FAILED",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

/**
 * Options for a coded error. `cause` exists so a wrapper never has to DISCARD
 * the underlying failure: three distinct origins used to collapse into one
 * opaque `INFERENCE_FAILED`, which made the real cause undiagnosable from the
 * scored artifacts. The cause is for diagnosis only — it is reduced through the
 * shared failure-detail allowlist before anything is stored.
 */
export interface CleanFeedErrorOptions {
  cause?: unknown;
}

export class CleanFeedError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly recoverable = true,
    options?: CleanFeedErrorOptions,
  ) {
    super(message, options);
    this.name = "CleanFeedError";
  }
}
