import { CleanFeedError, type ErrorCode } from "@/shared/errors";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { ClassificationRequest } from "@/shared/messages";
import type { UserSettings } from "@/shared/settings-types";
import type { ClassificationResult, ModelStatus } from "@/shared/types";

export type WorkerClassifyPayload = ClassificationRequest & {
  settings?: UserSettings;
};
export type WorkerBatchClassifyPayload = {
  requests: { requestId: string; payload: WorkerClassifyPayload }[];
};
export type WorkerInitializePayload = null;

export type WorkerRequest =
  | { type: "INITIALIZE"; requestId: string; payload: WorkerInitializePayload }
  | {
      type: "CLASSIFY";
      requestId: string;
      payload: WorkerClassifyPayload | WorkerBatchClassifyPayload;
    }
  | { type: "CANCEL"; requestId: string; payload: null }
  | { type: "STATUS"; requestId: string; payload: null }
  | { type: "DISPOSE"; requestId: string; payload: null };

export type WorkerResponse =
  | { type: "RESULT"; requestId: string; payload: ClassificationResult }
  | { type: "STATUS"; requestId: string; payload: ModelStatus }
  | { type: "CANCELLED"; requestId: string; payload: null }
  | { type: "ERROR"; requestId: string; payload: SerializedCleanFeedError };

export interface SerializedCleanFeedError {
  code: ErrorCode;
  message: string;
  recoverable: boolean;
}

const errorCodes = new Set<ErrorCode>([
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
]);

export function parseWorkerRequest(value: unknown): WorkerRequest {
  if (
    !hasExactKeys(value, ["type", "requestId", "payload"]) ||
    !isBoundedString(value.requestId, 128)
  ) {
    invalidWorkerMessage();
  }
  if (
    value.type === "CLASSIFY" &&
    (isWorkerClassifyPayload(value.payload) ||
      isWorkerBatchClassifyPayload(value.payload))
  )
    return value as unknown as WorkerRequest;
  if (
    ["INITIALIZE", "CANCEL", "STATUS", "DISPOSE"].includes(
      value.type as string,
    ) &&
    value.payload === null
  )
    return value as unknown as WorkerRequest;
  invalidWorkerMessage();
}

function isWorkerBatchClassifyPayload(
  value: unknown,
): value is WorkerBatchClassifyPayload {
  return (
    hasExactKeys(value, ["requests"]) &&
    Array.isArray(value.requests) &&
    value.requests.length > 0 &&
    value.requests.length <= 8 &&
    value.requests.every(
      (item) =>
        hasExactKeys(item, ["requestId", "payload"]) &&
        isBoundedString(item.requestId, 128) &&
        isWorkerClassifyPayload(item.payload),
    )
  );
}

export function parseWorkerResponse(value: unknown): WorkerResponse {
  if (
    !hasExactKeys(value, ["type", "requestId", "payload"]) ||
    !isBoundedString(value.requestId, 128)
  )
    invalidWorkerMessage();
  if (value.type === "RESULT") {
    try {
      parseExtensionMessage({
        source: "offscreen",
        target: "background",
        type: "OFFSCREEN_RESULT",
        requestId: value.requestId,
        payload: value.payload,
      });
      return value as unknown as WorkerResponse;
    } catch {
      invalidWorkerMessage();
    }
  }
  if (value.type === "STATUS" && isModelStatus(value.payload))
    return value as unknown as WorkerResponse;
  if (value.type === "CANCELLED" && value.payload === null)
    return value as unknown as WorkerResponse;
  if (value.type === "ERROR" && isSerializedError(value.payload))
    return value as unknown as WorkerResponse;
  invalidWorkerMessage();
}

export function serializeWorkerError(error: unknown): SerializedCleanFeedError {
  if (error instanceof CleanFeedError)
    return {
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
    };
  return {
    code: "INFERENCE_FAILED",
    message: "The local worker could not classify this text.",
    recoverable: true,
  };
}

function isWorkerClassifyPayload(
  value: unknown,
): value is WorkerClassifyPayload {
  return (
    isSafeRecord(value) &&
    hasOnlyKeys(value, ["text", "platform", "manual", "settings"]) &&
    isClassificationRequest(value) &&
    (value.settings === undefined || isSettingsSnapshot(value.settings))
  );
}

function isClassificationRequest(
  value: unknown,
): value is ClassificationRequest {
  return (
    isSafeRecord(value) &&
    isBoundedString(value.text, 100_000) &&
    isBoundedString(value.platform, 128) &&
    typeof value.manual === "boolean"
  );
}

function isSettingsSnapshot(value: unknown): value is UserSettings {
  return (
    isSafeRecord(value) &&
    typeof value.languageMode === "string" &&
    typeof value.markingThreshold === "number" &&
    Number.isFinite(value.markingThreshold) &&
    Number.isSafeInteger(value.chunkSizeTokens) &&
    Number.isSafeInteger(value.chunkOverlapTokens) &&
    Number.isSafeInteger(value.maximumTokens) &&
    Number.isSafeInteger(value.inferenceTimeoutMs)
  );
}

function isModelStatus(value: unknown): value is ModelStatus {
  return (
    isSafeRecord(value) &&
    ["unavailable", "initializing", "ready", "disposing", "error"].includes(
      value.state as string,
    ) &&
    isBoundedString(value.classifierId, 128) &&
    isBoundedString(value.modelVersion, 128) &&
    ["mock", "wasm", "webgpu"].includes(value.backend as string)
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
  return (
    isSafeRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  keys: readonly string[],
): boolean {
  return (
    keys
      .filter((key) => key !== "settings")
      .every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => keys.includes(key))
  );
}

function isSafeRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return false;
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
