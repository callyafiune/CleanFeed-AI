import { describe, expect, it } from "vitest";

import { parseExtensionMessage } from "@/shared/message-validation";

const validSettings = {
  enabled: true,
  minimumWordCount: 100,
  languageMode: "portuguese_only",
  presentationMode: "indicator",
  markingThreshold: 0.8,
  blurThreshold: 0.92,
  collapseThreshold: 0.96,
  hideThreshold: 0.99,
  processVisibleOnly: true,
  experimentalShortTextDetection: false,
  manualAnalysisEnabled: true,
  showScore: false,
  showExplanation: true,
  debugMode: false,
  backendPreference: "auto",
  webGpuEnabled: true,
  wasmEnabled: true,
  wasmConcurrency: 1,
  webGpuConcurrency: 2,
  maximumQueueSize: 50,
  maximumPostsPerMinute: 30,
  batchingEnabled: false,
  chunkSizeTokens: 192,
  chunkOverlapTokens: 32,
  maximumTokens: 256,
  inferenceTimeoutMs: 20_000,
  cacheMaximumEntries: 500,
  cacheTtlMs: 604_800_000,
  historyEnabled: false,
  historyRetentionDays: 30,
  storeFullText: false,
};

const validClassificationResult = {
  aiScore: 0.8,
  humanScore: 0.2,
  confidence: "high",
  status: "possibly_ai",
  wordCount: 100,
  tokenCount: 128,
  modelVersion: "demo-1",
  modelId: "mock",
  backend: "mock",
  processingTimeMs: 10,
  demo: true,
};

const validMessages = [
  {
    source: "content",
    target: "background",
    type: "CLASSIFY_TEXT",
    requestId: "r-1",
    payload: { text: "texto válido", platform: "linkedin", manual: false },
  },
  {
    source: "background",
    target: "content",
    type: "CLASSIFICATION_RESULT",
    requestId: "r-1",
    payload: validClassificationResult,
  },
  {
    source: "content",
    target: "background",
    type: "CANCEL_CLASSIFICATION",
    requestId: "r-1",
    payload: undefined,
  },
  {
    source: "popup",
    target: "content",
    type: "GET_PAGE_STATS",
    payload: undefined,
  },
  {
    source: "content",
    target: "popup",
    type: "PAGE_STATS_RESULT",
    payload: {
      platform: "linkedin",
      postsFound: 1,
      analyzed: 1,
      skippedByLength: 0,
      skippedByLanguage: 0,
      marked: 1,
      blurred: 0,
      collapsed: 0,
      hidden: 0,
      restored: 0,
      averageInferenceMs: 10,
      queueSize: 0,
    },
  },
  {
    source: "options",
    target: "background",
    type: "UPDATE_SETTINGS",
    payload: { enabled: false },
  },
  {
    source: "popup",
    target: "content",
    type: "CLEAR_PAGE_PRESENTATION",
    payload: undefined,
  },
  {
    source: "popup",
    target: "background",
    type: "MODEL_STATUS_REQUEST",
    payload: undefined,
  },
  {
    source: "background",
    target: "popup",
    type: "MODEL_STATUS_RESULT",
    payload: {
      state: "ready",
      classifierId: "mock",
      modelVersion: "demo-1",
      backend: "mock",
    },
  },
  {
    source: "content",
    target: "background",
    type: "GET_SETTINGS",
    payload: undefined,
  },
  {
    source: "background",
    target: "content",
    type: "SETTINGS_RESULT",
    payload: validSettings,
  },
  {
    source: "options",
    target: "background",
    type: "CACHE_CLEAR",
    payload: undefined,
  },
  {
    source: "options",
    target: "background",
    type: "METRICS_CLEAR",
    payload: undefined,
  },
  {
    source: "background",
    target: "offscreen",
    type: "OFFSCREEN_CLASSIFY",
    requestId: "r-1",
    payload: {
      text: "texto válido",
      platform: "linkedin",
      manual: false,
      settings: validSettings,
    },
  },
  {
    source: "offscreen",
    target: "background",
    type: "OFFSCREEN_RESULT",
    requestId: "r-1",
    payload: validClassificationResult,
  },
  {
    source: "worker",
    target: "offscreen",
    type: "WORKER_STATUS",
    payload: {
      state: "ready",
      classifierId: "mock",
      modelVersion: "demo-1",
      backend: "mock",
    },
  },
  {
    source: "background",
    target: "content",
    type: "ERROR",
    payload: { code: "INFERENCE_FAILED", recoverable: true },
  },
];

describe("parseExtensionMessage", () => {
  it("accepts INSUFFICIENT_EVIDENCE as an observable error code", () => {
    expect(
      parseExtensionMessage({
        source: "background",
        target: "content",
        type: "ERROR",
        payload: { code: "INSUFFICIENT_EVIDENCE", recoverable: true },
      }).type,
    ).toBe("ERROR");
  });

  it("accepts a bounded classify request", () => {
    expect(
      parseExtensionMessage({
        source: "content",
        target: "background",
        type: "CLASSIFY_TEXT",
        requestId: "r-1",
        payload: { text: "texto válido", platform: "linkedin", manual: false },
      }).type,
    ).toBe("CLASSIFY_TEXT");
  });

  it("accepts a classification result with bounded chunk data", () => {
    expect(
      parseExtensionMessage({
        source: "background",
        target: "content",
        type: "CLASSIFICATION_RESULT",
        requestId: "r-1",
        payload: {
          ...validClassificationResult,
          chunks: [
            {
              index: 0,
              startToken: 0,
              endToken: 128,
              aiScore: 0.8,
              humanScore: 0.2,
              processingTimeMs: 10,
            },
          ],
        },
      }).type,
    ).toBe("CLASSIFICATION_RESULT");
  });

  it.each([
    {},
    { type: "UNKNOWN" },
    {
      source: "content",
      target: "background",
      type: "CLASSIFY_TEXT",
      payload: {},
    },
    {
      source: "content",
      target: "background",
      type: "CLASSIFY_TEXT",
      requestId: "r-1",
      payload: {
        text: "x".repeat(100_001),
        platform: "linkedin",
        manual: false,
      },
    },
    {
      source: "content",
      target: "background",
      type: "CLASSIFY_TEXT",
      requestId: "r".repeat(129),
      payload: { text: "texto válido", platform: "linkedin", manual: false },
    },
  ])("rejects invalid input %j", (value) => {
    expect(() => parseExtensionMessage(value)).toThrow("INVALID_MESSAGE");
  });

  it("rejects a prototype-polluting key in an importable payload", () => {
    const payload = JSON.parse(
      '{"__proto__":{"polluted":true},"settings":{"enabled":true}}',
    );

    expect(() =>
      parseExtensionMessage({
        source: "options",
        target: "background",
        type: "UPDATE_SETTINGS",
        payload,
      }),
    ).toThrow("INVALID_MESSAGE");
  });

  it.each(validMessages)("accepts the valid %s envelope", (message) => {
    expect(parseExtensionMessage(message).type).toBe(message.type);
  });

  it.each(validMessages)("rejects an invalid %s payload", (message) => {
    expect(() =>
      parseExtensionMessage({ ...message, payload: { invalid: true } }),
    ).toThrow("INVALID_MESSAGE");
  });

  it("rejects unordered threshold fields in a settings update", () => {
    expect(() =>
      parseExtensionMessage({
        source: "options",
        target: "background",
        type: "UPDATE_SETTINGS",
        payload: { markingThreshold: 0.9, blurThreshold: 0.8 },
      }),
    ).toThrow("INVALID_MESSAGE");
  });

  it.each([
    {
      source: "content",
      target: "content",
      type: "CLASSIFY_TEXT",
      requestId: "r-1",
      payload: { text: "texto válido", platform: "linkedin", manual: false },
    },
    {
      source: "popup",
      target: "background",
      type: "OFFSCREEN_CLASSIFY",
      requestId: "r-1",
      payload: { text: "texto válido", platform: "linkedin", manual: false },
    },
    {
      source: "background",
      target: "content",
      type: "WORKER_STATUS",
      payload: {
        state: "ready",
        classifierId: "mock",
        modelVersion: "demo-1",
        backend: "mock",
      },
    },
  ])("rejects forged route for %s", (message) => {
    expect(() => parseExtensionMessage(message)).toThrow("INVALID_MESSAGE");
  });

  it("accepts the disposing model lifecycle state", () => {
    expect(
      parseExtensionMessage({
        source: "background",
        target: "popup",
        type: "MODEL_STATUS_RESULT",
        payload: {
          state: "disposing",
          classifierId: "mock",
          modelVersion: "demo-1",
          backend: "mock",
        },
      }),
    ).toMatchObject({ type: "MODEL_STATUS_RESULT" });
  });
});
