export type ErrorCode =
  | "MODEL_LOAD_FAILED"
  | "TOKENIZATION_FAILED"
  | "INFERENCE_FAILED"
  | "INFERENCE_TIMEOUT"
  | "WORKER_UNAVAILABLE"
  | "WEBGPU_UNAVAILABLE"
  | "CACHE_ERROR"
  | "STORAGE_ERROR"
  | "INVALID_SETTINGS"
  | "INVALID_MESSAGE"
  | "PLATFORM_EXTRACTION_FAILED";

export class CleanFeedError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly recoverable = true,
  ) {
    super(message);
    this.name = "CleanFeedError";
  }
}
