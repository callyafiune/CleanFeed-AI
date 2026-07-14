import {
  MAX_CLASSIFICATION_TEXT_LENGTH,
  MAX_PLATFORM_ID_LENGTH,
  MAX_REQUEST_ID_LENGTH,
} from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";
import type { ExtensionContext, ExtensionMessage } from "@/shared/messages";

const contexts = new Set<ExtensionContext>([
  "content",
  "popup",
  "options",
  "background",
  "offscreen",
  "worker",
]);

const messageTypeValues = [
  "CLASSIFY_TEXT",
  "CLASSIFICATION_RESULT",
  "CANCEL_CLASSIFICATION",
  "GET_PAGE_STATS",
  "PAGE_STATS_RESULT",
  "UPDATE_SETTINGS",
  "CLEAR_PAGE_PRESENTATION",
  "MODEL_STATUS_REQUEST",
  "MODEL_STATUS_RESULT",
  "GET_SETTINGS",
  "SETTINGS_RESULT",
  "CACHE_CLEAR",
  "METRICS_CLEAR",
  "OFFSCREEN_CLASSIFY",
  "OFFSCREEN_RESULT",
  "WORKER_STATUS",
  "ERROR",
] as const;
const messageTypes = new Set(messageTypeValues);

const emptyPayloadMessageTypes = new Set<string>([
  "CANCEL_CLASSIFICATION",
  "GET_PAGE_STATS",
  "CLEAR_PAGE_PRESENTATION",
  "MODEL_STATUS_REQUEST",
  "GET_SETTINGS",
  "CACHE_CLEAR",
  "METRICS_CLEAR",
]);

const requestMessageTypes = new Set<string>([
  "CLASSIFY_TEXT",
  "OFFSCREEN_CLASSIFY",
  "CLASSIFICATION_RESULT",
  "OFFSCREEN_RESULT",
  "CANCEL_CLASSIFICATION",
]);

const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);
const maximumObjectDepth = 8;
const maximumObjectKeys = 200;
const maximumStringLength = MAX_CLASSIFICATION_TEXT_LENGTH;

export function parseExtensionMessage(value: unknown): ExtensionMessage {
  if (!isSafeRecord(value)) {
    invalidMessage();
  }

  if (
    !isBoundedString(value.source, 32) ||
    !contexts.has(value.source as ExtensionContext) ||
    !isBoundedString(value.target, 32) ||
    !contexts.has(value.target as ExtensionContext) ||
    !isBoundedString(value.type, 64) ||
    !messageTypes.has(value.type as (typeof messageTypeValues)[number])
  ) {
    invalidMessage();
  }

  if (
    value.requestId !== undefined &&
    !isBoundedString(value.requestId, MAX_REQUEST_ID_LENGTH)
  ) {
    invalidMessage();
  }

  if (
    requestMessageTypes.has(value.type) &&
    !isBoundedString(value.requestId, MAX_REQUEST_ID_LENGTH)
  ) {
    invalidMessage();
  }

  if (
    !Object.hasOwn(value, "payload") &&
    !emptyPayloadMessageTypes.has(value.type)
  ) {
    invalidMessage();
  }

  if (!isValidPayload(value.type, value.payload)) {
    invalidMessage();
  }

  return value as unknown as ExtensionMessage;
}

function isValidPayload(type: string, payload: unknown): boolean {
  if (emptyPayloadMessageTypes.has(type)) {
    return payload === undefined;
  }

  if (type === "CLASSIFY_TEXT" || type === "OFFSCREEN_CLASSIFY") {
    return isClassificationRequest(payload);
  }

  return isBoundedSafeValue(payload);
}

function isClassificationRequest(value: unknown): boolean {
  if (
    !isSafeRecord(value) ||
    !hasOnlyKeys(value, ["text", "platform", "manual"])
  ) {
    return false;
  }

  return (
    isBoundedString(value.text, MAX_CLASSIFICATION_TEXT_LENGTH) &&
    isBoundedString(value.platform, MAX_PLATFORM_ID_LENGTH) &&
    typeof value.manual === "boolean"
  );
}

function isBoundedSafeValue(
  value: unknown,
  depth = 0,
  seen = new WeakSet<object>(),
): boolean {
  if (typeof value === "string") {
    return value.length <= maximumStringLength;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value === "boolean" || value === null || value === undefined) {
    return true;
  }

  if (
    depth >= maximumObjectDepth ||
    typeof value !== "object" ||
    value === null ||
    seen.has(value)
  ) {
    return false;
  }

  seen.add(value);

  if (Array.isArray(value)) {
    return (
      value.length <= maximumObjectKeys &&
      value.every((nestedValue) =>
        isBoundedSafeValue(nestedValue, depth + 1, seen),
      )
    );
  }

  if (!isSafeRecord(value)) {
    return false;
  }

  const entries = Object.entries(value);
  return (
    entries.length <= maximumObjectKeys &&
    entries.every(
      ([key, nestedValue]) =>
        isBoundedString(key, 128) &&
        !dangerousKeys.has(key) &&
        isBoundedSafeValue(nestedValue, depth + 1, seen),
    )
  );
}

function isSafeRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  return Object.keys(value).every((key) => !dangerousKeys.has(key));
}

function hasOnlyKeys(value: Record<string, unknown>, keys: string[]): boolean {
  const ownKeys = Object.keys(value);
  return (
    ownKeys.length === keys.length && ownKeys.every((key) => keys.includes(key))
  );
}

function isBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === "string" && value.length <= maximumLength;
}

function invalidMessage(): never {
  throw new CleanFeedError("INVALID_MESSAGE", "INVALID_MESSAGE");
}
