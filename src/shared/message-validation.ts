import {
  MAX_CLASSIFICATION_TEXT_LENGTH,
  MAX_PLATFORM_ID_LENGTH,
  MAX_REQUEST_ID_LENGTH,
} from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";
import type { ExtensionContext, ExtensionMessage } from "@/shared/messages";

const contextValues = [
  "content",
  "popup",
  "options",
  "background",
  "offscreen",
  "worker",
  "manual",
] as const;
const contexts = new Set<ExtensionContext>(contextValues);

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
  "SHOW_MANUAL_ANALYSIS",
  "MANUAL_ANALYSIS_READY",
  "MANUAL_ANALYSIS_RESULT",
  "OFFSCREEN_CLASSIFY",
  "OFFSCREEN_RESULT",
  "WORKER_STATUS",
  "ERROR",
] as const;
type MessageType = (typeof messageTypeValues)[number];
const messageTypes = new Set<MessageType>(messageTypeValues);

const errorCodes = new Set<string>([
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
const classificationStatuses = new Set<string>([
  "probably_human",
  "inconclusive",
  "possibly_ai",
  "strong_ai_indication",
  "insufficient_evidence",
  "classification_failed",
]);
const confidences = new Set<string>(["low", "medium", "high"]);
const backends = new Set<string>(["mock", "wasm", "webgpu"]);
const presentationModes = new Set<string>([
  "indicator",
  "blur",
  "collapse",
  "hide",
]);
const reasonCodes = new Set<string>([
  "HIGH_CHUNK_CONSISTENCY",
  "MOST_CHUNKS_ABOVE_THRESHOLD",
  "HIGH_AVERAGE_SCORE",
  "HIGH_MEDIAN_SCORE",
  "FORMULAIC_STRUCTURE",
  "LOW_SENTENCE_LENGTH_VARIATION",
  "REPETITIVE_TRANSITIONS",
  "LISTICLE_PATTERN",
  "EXCESSIVE_HASHTAGS",
  "CUSTOM_KEYWORD_RULE",
  "INSUFFICIENT_EVIDENCE",
  "LOW_MODEL_CONFIDENCE",
  "CHUNK_DISAGREEMENT",
]);
const modelStates = new Set<string>([
  "unavailable",
  "initializing",
  "ready",
  "disposing",
  "error",
]);

type Route = readonly [ExtensionContext, ExtensionContext];
const allowedRoutes: Record<MessageType, readonly Route[]> = {
  CLASSIFY_TEXT: [
    ["content", "background"],
    ["manual", "background"],
  ],
  CLASSIFICATION_RESULT: [
    ["background", "content"],
    ["background", "manual"],
  ],
  CANCEL_CLASSIFICATION: [
    ["content", "background"],
    ["background", "offscreen"],
  ],
  GET_PAGE_STATS: [["popup", "content"]],
  PAGE_STATS_RESULT: [["content", "popup"]],
  UPDATE_SETTINGS: [
    ["popup", "background"],
    ["options", "background"],
  ],
  CLEAR_PAGE_PRESENTATION: [["popup", "content"]],
  MODEL_STATUS_REQUEST: [
    ["popup", "background"],
    ["options", "background"],
    ["background", "offscreen"],
  ],
  MODEL_STATUS_RESULT: [
    ["background", "popup"],
    ["background", "options"],
    ["offscreen", "background"],
  ],
  GET_SETTINGS: [
    ["content", "background"],
    ["popup", "background"],
    ["options", "background"],
  ],
  SETTINGS_RESULT: [
    ["background", "content"],
    ["background", "popup"],
    ["background", "options"],
  ],
  CACHE_CLEAR: [
    ["popup", "background"],
    ["options", "background"],
  ],
  METRICS_CLEAR: [
    ["popup", "background"],
    ["options", "background"],
  ],
  SHOW_MANUAL_ANALYSIS: [["background", "manual"]],
  MANUAL_ANALYSIS_READY: [["manual", "background"]],
  MANUAL_ANALYSIS_RESULT: [["manual", "background"]],
  OFFSCREEN_CLASSIFY: [["background", "offscreen"]],
  OFFSCREEN_RESULT: [["offscreen", "background"]],
  WORKER_STATUS: [["worker", "offscreen"]],
  ERROR: [
    ["content", "background"],
    ["background", "content"],
    ["background", "popup"],
    ["background", "options"],
    ["background", "offscreen"],
    ["background", "manual"],
    ["offscreen", "background"],
    ["worker", "offscreen"],
  ],
};

const emptyPayloadMessageTypes = new Set<MessageType>([
  "CANCEL_CLASSIFICATION",
  "GET_PAGE_STATS",
  "CLEAR_PAGE_PRESENTATION",
  "MODEL_STATUS_REQUEST",
  "GET_SETTINGS",
  "CACHE_CLEAR",
  "METRICS_CLEAR",
  "MANUAL_ANALYSIS_READY",
]);
const requestMessageTypes = new Set<MessageType>([
  "CLASSIFY_TEXT",
  "OFFSCREEN_CLASSIFY",
  "CLASSIFICATION_RESULT",
  "OFFSCREEN_RESULT",
  "CANCEL_CLASSIFICATION",
]);
const dangerousKeys = new Set(["__proto__", "prototype", "constructor"]);
const maximumCollectionLength = 200;

const userSettingKeys = [
  "enabled",
  "minimumWordCount",
  "languageMode",
  "presentationMode",
  "markingThreshold",
  "blurThreshold",
  "collapseThreshold",
  "hideThreshold",
  "processVisibleOnly",
  "experimentalShortTextDetection",
  "manualAnalysisEnabled",
  "showScore",
  "showExplanation",
  "debugMode",
  "backendPreference",
  "webGpuEnabled",
  "wasmEnabled",
  "useMockModel",
  "wasmConcurrency",
  "webGpuConcurrency",
  "maximumQueueSize",
  "maximumPostsPerMinute",
  "batchingEnabled",
  "chunkSizeTokens",
  "chunkOverlapTokens",
  "maximumTokens",
  "inferenceTimeoutMs",
  "cacheMaximumEntries",
  "cacheTtlMs",
  "historyEnabled",
  "historyRetentionDays",
  "storeFullText",
] as const;
const userSettingKeySet = new Set<string>(userSettingKeys);

export function parseExtensionMessage(value: unknown): ExtensionMessage {
  if (!isSafeRecord(value)) {
    invalidMessage();
  }

  if (
    !isExtensionContext(value.source) ||
    !isExtensionContext(value.target) ||
    !isMessageType(value.type) ||
    !hasAllowedRoute(value.type, value.source, value.target)
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

function hasAllowedRoute(
  type: MessageType,
  source: ExtensionContext,
  target: ExtensionContext,
): boolean {
  return allowedRoutes[type].some(
    ([allowedSource, allowedTarget]) =>
      source === allowedSource && target === allowedTarget,
  );
}

function isValidPayload(type: MessageType, payload: unknown): boolean {
  if (emptyPayloadMessageTypes.has(type)) {
    return payload === undefined;
  }

  switch (type) {
    case "CLASSIFY_TEXT":
      return isClassificationRequest(payload);
    case "OFFSCREEN_CLASSIFY":
      return isOffscreenClassificationRequest(payload);
    case "CLASSIFICATION_RESULT":
    case "OFFSCREEN_RESULT":
      return isClassificationResult(payload);
    case "PAGE_STATS_RESULT":
      return isPageStats(payload);
    case "UPDATE_SETTINGS":
      return isSettings(payload, false);
    case "MODEL_STATUS_RESULT":
    case "WORKER_STATUS":
      return isModelStatus(payload);
    case "SETTINGS_RESULT":
      return isSettings(payload, true);
    case "SHOW_MANUAL_ANALYSIS":
      return isManualAnalysisRequest(payload);
    case "MANUAL_ANALYSIS_RESULT":
      return isClassificationResult(payload);
    case "ERROR":
      return isErrorPayload(payload);
    default:
      return false;
  }
}

function isClassificationRequest(value: unknown): boolean {
  if (!hasExactKeys(value, ["text", "platform", "manual"])) {
    return false;
  }

  return (
    isBoundedString(value.text, MAX_CLASSIFICATION_TEXT_LENGTH) &&
    isBoundedString(value.platform, MAX_PLATFORM_ID_LENGTH) &&
    typeof value.manual === "boolean"
  );
}

function isManualAnalysisRequest(value: unknown): boolean {
  return (
    hasExactKeys(value, ["selectedText", "minimumWordCount"]) &&
    isBoundedString(value.selectedText, MAX_CLASSIFICATION_TEXT_LENGTH) &&
    isNonNegativeInteger(value.minimumWordCount)
  );
}

function isOffscreenClassificationRequest(value: unknown): boolean {
  return (
    hasExactKeys(value, ["text", "platform", "manual", "settings"]) &&
    isBoundedString(value.text, MAX_CLASSIFICATION_TEXT_LENGTH) &&
    isBoundedString(value.platform, MAX_PLATFORM_ID_LENGTH) &&
    typeof value.manual === "boolean" &&
    isSettings(value.settings, true)
  );
}

function isClassificationResult(value: unknown): boolean {
  const requiredKeys = [
    "aiScore",
    "humanScore",
    "confidence",
    "status",
    "wordCount",
    "tokenCount",
    "modelVersion",
    "modelId",
    "backend",
    "processingTimeMs",
    "demo",
  ];
  const optionalKeys = [
    "language",
    "chunks",
    "aggregation",
    "explanation",
    "decision",
    "errorCode",
    "stageTimings",
  ];

  if (!hasOnlyAllowedKeys(value, requiredKeys, optionalKeys)) {
    return false;
  }

  return (
    isScore(value.aiScore) &&
    isScore(value.humanScore) &&
    isStringInSet(value.confidence, confidences) &&
    isStringInSet(value.status, classificationStatuses) &&
    isNonNegativeInteger(value.wordCount) &&
    isNonNegativeInteger(value.tokenCount) &&
    isBoundedString(value.modelVersion, 128) &&
    isBoundedString(value.modelId, 128) &&
    isStringInSet(value.backend, backends) &&
    isNonNegativeFinite(value.processingTimeMs) &&
    typeof value.demo === "boolean" &&
    isOptional(value.language, (item) => isBoundedString(item, 32)) &&
    isOptional(value.chunks, isChunkResults) &&
    isOptional(value.aggregation, isAggregationResult) &&
    isOptional(value.explanation, isClassificationExplanation) &&
    isOptional(value.decision, isDecisionOutcome) &&
    isOptional(value.errorCode, isErrorCode) &&
    isOptional(value.stageTimings, isStageTimings)
  );
}

function isStageTimings(value: unknown): boolean {
  return (
    hasExactKeys(value, [
      "languageMs",
      "tokenizationMs",
      "chunkingMs",
      "inferenceMs",
      "aggregationMs",
      "calibrationMs",
    ]) && Object.values(value).every(isNonNegativeFinite)
  );
}

function isChunkResults(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maximumCollectionLength &&
    value.every(
      (item) =>
        hasExactKeys(item, [
          "index",
          "startToken",
          "endToken",
          "aiScore",
          "humanScore",
          "processingTimeMs",
        ]) &&
        isNonNegativeInteger(item.index) &&
        isNonNegativeInteger(item.startToken) &&
        isNonNegativeInteger(item.endToken) &&
        item.startToken <= item.endToken &&
        isScore(item.aiScore) &&
        isScore(item.humanScore) &&
        isNonNegativeFinite(item.processingTimeMs),
    )
  );
}

function isAggregationResult(value: unknown): boolean {
  const keys = [
    "finalScore",
    "weightedMean",
    "median",
    "maximum",
    "minimum",
    "standardDeviation",
    "highScoreRatio",
    "chunkAgreement",
  ];

  return (
    hasExactKeys(value, keys) &&
    isScore(value.finalScore) &&
    isScore(value.weightedMean) &&
    isScore(value.median) &&
    isScore(value.maximum) &&
    isScore(value.minimum) &&
    isNonNegativeFinite(value.standardDeviation) &&
    isScore(value.highScoreRatio) &&
    isScore(value.chunkAgreement)
  );
}

function isClassificationExplanation(value: unknown): boolean {
  const requiredKeys = [
    "reasonCodes",
    "modelScore",
    "calibratedScore",
    "calibrationProfile",
  ];
  const optionalKeys = [
    "chunkAgreement",
    "chunksAboveThreshold",
    "totalChunks",
    "ruleScore",
  ];

  return (
    hasOnlyAllowedKeys(value, requiredKeys, optionalKeys) &&
    isReasonCodeList(value.reasonCodes) &&
    isScore(value.modelScore) &&
    isScore(value.calibratedScore) &&
    isBoundedString(value.calibrationProfile, 128) &&
    isOptional(value.chunkAgreement, isScore) &&
    isOptional(value.chunksAboveThreshold, isNonNegativeInteger) &&
    isOptional(value.totalChunks, isNonNegativeInteger) &&
    isOptional(value.ruleScore, isScore)
  );
}

function isDecisionOutcome(value: unknown): boolean {
  return (
    hasExactKeys(value, [
      "status",
      "calibratedScore",
      "actionCeiling",
      "abstained",
      "reasonCodes",
    ]) &&
    isStringInSet(value.status, classificationStatuses) &&
    isScore(value.calibratedScore) &&
    isStringInSet(value.actionCeiling, presentationModes) &&
    typeof value.abstained === "boolean" &&
    isReasonCodeList(value.reasonCodes)
  );
}

function isReasonCodeList(value: unknown): boolean {
  return (
    Array.isArray(value) &&
    value.length <= maximumCollectionLength &&
    value.every((item) => typeof item === "string" && reasonCodes.has(item))
  );
}

function isPageStats(value: unknown): boolean {
  const keys = [
    "platform",
    "postsFound",
    "analyzed",
    "skippedByLength",
    "skippedByLanguage",
    "marked",
    "blurred",
    "collapsed",
    "hidden",
    "restored",
    "averageInferenceMs",
    "queueSize",
  ];

  return (
    hasExactKeys(value, keys) &&
    (value.platform === null ||
      isBoundedString(value.platform, MAX_PLATFORM_ID_LENGTH)) &&
    [
      value.postsFound,
      value.analyzed,
      value.skippedByLength,
      value.skippedByLanguage,
      value.marked,
      value.blurred,
      value.collapsed,
      value.hidden,
      value.restored,
      value.queueSize,
    ].every(isNonNegativeInteger) &&
    isNonNegativeFinite(value.averageInferenceMs)
  );
}

function isModelStatus(value: unknown): boolean {
  return (
    hasOnlyAllowedKeys(
      value,
      ["state", "classifierId", "modelVersion", "backend"],
      [
        "fallbackFrom",
        "warning",
        "errorCode",
        "initializedAt",
        "supportsBatching",
      ],
    ) &&
    isStringInSet(value.state, modelStates) &&
    isBoundedString(value.classifierId, 128) &&
    isBoundedString(value.modelVersion, 128) &&
    isStringInSet(value.backend, backends) &&
    isOptional(value.fallbackFrom, (item) => item === "webgpu") &&
    isOptional(value.warning, (item) => item === "WEBGPU_FALLBACK") &&
    isOptional(value.errorCode, isErrorCode) &&
    isOptional(value.initializedAt, isNonNegativeFinite) &&
    isOptional(value.supportsBatching, (item) => typeof item === "boolean")
  );
}

function isErrorPayload(value: unknown): boolean {
  return (
    hasExactKeys(value, ["code", "recoverable"]) &&
    isErrorCode(value.code) &&
    typeof value.recoverable === "boolean"
  );
}

function isSettings(value: unknown, complete: boolean): boolean {
  if (
    !isSafeRecord(value) ||
    (complete
      ? !hasExactKeys(value, userSettingKeys)
      : !Object.keys(value).every((key) => userSettingKeySet.has(key)))
  ) {
    return false;
  }

  return (
    Object.entries(value).every(([key, settingValue]) =>
      isSettingValue(key, settingValue),
    ) && arePresentThresholdsOrdered(value)
  );
}

function arePresentThresholdsOrdered(value: Record<string, unknown>): boolean {
  return (
    isOrderedPair(value.markingThreshold, value.blurThreshold) &&
    isOrderedPair(value.blurThreshold, value.collapseThreshold) &&
    isOrderedPair(value.collapseThreshold, value.hideThreshold)
  );
}

function isOrderedPair(lower: unknown, upper: unknown): boolean {
  if (lower === undefined || upper === undefined) {
    return true;
  }

  return isScore(lower) && isScore(upper) && lower <= upper;
}

function isSettingValue(key: string, value: unknown): boolean {
  switch (key) {
    case "enabled":
    case "processVisibleOnly":
    case "experimentalShortTextDetection":
    case "manualAnalysisEnabled":
    case "showScore":
    case "showExplanation":
    case "debugMode":
    case "webGpuEnabled":
    case "wasmEnabled":
    case "useMockModel":
    case "batchingEnabled":
    case "historyEnabled":
    case "storeFullText":
      return typeof value === "boolean";
    case "languageMode":
      return (
        value === "portuguese_only" ||
        value === "model_supported" ||
        value === "experimental_any"
      );
    case "presentationMode":
      return isStringInSet(value, presentationModes);
    case "backendPreference":
      return value === "auto" || value === "wasm" || value === "webgpu";
    case "markingThreshold":
    case "blurThreshold":
    case "collapseThreshold":
    case "hideThreshold":
      return isScore(value);
    default:
      return isNonNegativeInteger(value);
  }
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return hasOnlyAllowedKeys(value, keys, []);
}

function hasOnlyAllowedKeys(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[],
): value is Record<string, unknown> {
  if (!isSafeRecord(value)) {
    return false;
  }

  const allowedKeys = new Set([...requiredKeys, ...optionalKeys]);
  return (
    requiredKeys.every((key) => Object.hasOwn(value, key)) &&
    Object.keys(value).every((key) => allowedKeys.has(key))
  );
}

function isOptional(
  value: unknown,
  predicate: (item: unknown) => boolean,
): boolean {
  return value === undefined || predicate(value);
}

function isScore(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isNonNegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function isNonNegativeInteger(value: unknown): value is number {
  return isNonNegativeFinite(value) && Number.isInteger(value);
}

function isErrorCode(value: unknown): boolean {
  return isStringInSet(value, errorCodes);
}

function isStringInSet(value: unknown, values: ReadonlySet<string>): boolean {
  return typeof value === "string" && values.has(value);
}

function isExtensionContext(value: unknown): value is ExtensionContext {
  return isBoundedString(value, 32) && contexts.has(value as ExtensionContext);
}

function isMessageType(value: unknown): value is MessageType {
  return isBoundedString(value, 64) && messageTypes.has(value as MessageType);
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

function isBoundedString(
  value: unknown,
  maximumLength: number,
): value is string {
  return typeof value === "string" && value.length <= maximumLength;
}

function invalidMessage(): never {
  throw new CleanFeedError("INVALID_MESSAGE", "INVALID_MESSAGE");
}
