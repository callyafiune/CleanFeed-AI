export type ErrorCode =
  | "MODEL_LOAD_FAILED"
  | "TOKENIZATION_FAILED"
  | "INSUFFICIENT_EVIDENCE"
  | "INFERENCE_FAILED"
  | "INFERENCE_TIMEOUT"
  | "WORKER_UNAVAILABLE"
  | "WEBGPU_UNAVAILABLE"
  | "CACHE_ERROR"
  | "STORAGE_ERROR"
  | "INVALID_SETTINGS"
  | "INVALID_MESSAGE"
  | "PLATFORM_EXTRACTION_FAILED";

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
