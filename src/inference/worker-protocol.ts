import { CleanFeedError, type ErrorCode } from "@/shared/errors";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { ClassificationRequest } from "@/shared/messages";
import type { ClassificationResult } from "@/shared/types";

export interface WorkerClassifyRequest {
  type: "CLASSIFY";
  requestId: string;
  payload: ClassificationRequest;
}

export interface WorkerResultResponse {
  type: "RESULT";
  requestId: string;
  payload: ClassificationResult;
}

export interface WorkerErrorResponse {
  type: "ERROR";
  requestId: string;
  payload: SerializedCleanFeedError;
}

export interface SerializedCleanFeedError {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
}

export type WorkerRequest = WorkerClassifyRequest;
export type WorkerResponse = WorkerResultResponse | WorkerErrorResponse;

const errorCodes = new Set<ErrorCode>([
  "MODEL_LOAD_FAILED",
  "TOKENIZATION_FAILED",
  "INFERENCE_FAILED",
  "INFERENCE_TIMEOUT",
  "WORKER_UNAVAILABLE",
  "WEBGPU_UNAVAILABLE",
  "CACHE_ERROR",
  "STORAGE_ERROR",
  "INVALID_SETTINGS",
  "INVALID_MESSAGE",
  "PLATFORM_EXTRACTION_FAILED",
]);

export function parseWorkerRequest(value: unknown): WorkerRequest {
  if (
    !hasExactKeys(value, ["type", "requestId", "payload"]) ||
    value.type !== "CLASSIFY" ||
    !isBoundedString(value.requestId, 128) ||
    !isClassificationRequest(value.payload)
  ) {
    invalidWorkerMessage();
  }

  return value as unknown as WorkerClassifyRequest;
}

export function parseWorkerResponse(value: unknown): WorkerResponse {
  if (!hasExactKeys(value, ["type", "requestId", "payload"])) {
    invalidWorkerMessage();
  }

  if (value.type === "RESULT" && isBoundedString(value.requestId, 128)) {
    try {
      parseExtensionMessage({
        source: "offscreen",
        target: "background",
        type: "OFFSCREEN_RESULT",
        requestId: value.requestId,
        payload: value.payload,
      });
      return value as unknown as WorkerResultResponse;
    } catch {
      invalidWorkerMessage();
    }
  }

  if (
    value.type === "ERROR" &&
    isBoundedString(value.requestId, 128) &&
    isSerializedError(value.payload)
  ) {
    return value as unknown as WorkerErrorResponse;
  }

  invalidWorkerMessage();
}

export function serializeWorkerError(error: unknown): SerializedCleanFeedError {
  if (error instanceof CleanFeedError) {
    return {
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
    };
  }

  return {
    code: "INFERENCE_FAILED",
    message: "The local worker could not classify this text.",
    recoverable: true,
  };
}

function isClassificationRequest(
  value: unknown,
): value is ClassificationRequest {
  return (
    hasExactKeys(value, ["text", "platform", "manual"]) &&
    isBoundedString(value.text, 100_000) &&
    isBoundedString(value.platform, 128) &&
    typeof value.manual === "boolean"
  );
}

function isSerializedError(value: unknown): value is SerializedCleanFeedError {
  return (
    hasExactKeys(value, ["code", "message", "recoverable"]) &&
    typeof value.code === "string" &&
    errorCodes.has(value.code as ErrorCode) &&
    isBoundedString(value.message, 1_000) &&
    typeof value.recoverable === "boolean"
  );
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  if (!isSafeRecord(value) || Object.keys(value).length !== keys.length) {
    return false;
  }

  return keys.every((key) => Object.hasOwn(value, key));
}

function isSafeRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
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

function invalidWorkerMessage(): never {
  throw new CleanFeedError("INVALID_MESSAGE", "INVALID_WORKER_MESSAGE");
}
