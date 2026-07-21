import { describe, expect, it } from "vitest";

import { parseExtensionMessage } from "@/shared/message-validation";

const validSettings = {
  enabled: true,
  minimumWordCount: 100,
  languageMode: "portuguese_only",
  presentationMode: "indicator",
  processVisibleOnly: true,
  experimentalShortTextDetection: false,
  experimentalUncalibratedTmr: false,
  experimentalMarkingThresholdPercent: 70,
  manualAnalysisEnabled: true,
  showScore: false,
  showExplanation: true,
  debugMode: false,
  backendPreference: "auto",
  webGpuEnabled: true,
  wasmEnabled: true,
  useMockModel: false,
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
  runtimeIdentity: {
    kind: "builtin",
    modelId: "stylometric",
    modelVersion: "1.0.0",
    implementationVersion: "stylometric-v1",
  },
  evidence: {
    quality: "limited",
    coverage: 1,
    lexicalRatio: 1,
    truncated: false,
    exactTokenizer: false,
    reasonCodes: [],
  },
  decision: {
    status: "possibly_ai",
    calibratedScore: 0.8,
    actionCeiling: "indicator",
    abstained: false,
    presentationAllowed: true,
    triggers: [],
    reasonCodes: [],
  },
  modelVersion: "demo-1",
  modelId: "mock",
  backend: "mock",
  processingTimeMs: 10,
  demo: true,
};

const validModelStatus = {
  state: "ready",
  backend: "mock",
  runtimeIdentity: {
    kind: "builtin",
    modelId: "mock",
    modelVersion: "demo-1",
    implementationVersion: "mock",
  },
  calibrationCoverage: "none",
  calibrationSetDigest: null,
  profileCount: 0,
  earliestExpiry: null,
  reasonCodes: [],
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
    payload: validModelStatus,
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
    payload: validModelStatus,
  },
  {
    source: "background",
    target: "content",
    type: "ERROR",
    payload: { code: "INFERENCE_FAILED", recoverable: true },
  },
  {
    source: "popup",
    target: "background",
    type: "PAUSE_DOMAIN",
    payload: { hostname: "www.linkedin.com", paused: true },
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

  it("rejects a settings update carrying a removed legacy threshold key", () => {
    expect(() =>
      parseExtensionMessage({
        source: "options",
        target: "background",
        type: "UPDATE_SETTINGS",
        payload: { markingThreshold: 0.9 },
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

  it("rejects a pause request whose hostname carries a path", () => {
    expect(() =>
      parseExtensionMessage({
        source: "popup",
        target: "background",
        type: "PAUSE_DOMAIN",
        payload: { hostname: "www.linkedin.com/feed/update/1", paused: true },
      }),
    ).toThrow("INVALID_MESSAGE");
  });

  it("rejects a pause request forged from the content script", () => {
    expect(() =>
      parseExtensionMessage({
        source: "content",
        target: "background",
        type: "PAUSE_DOMAIN",
        payload: { hostname: "www.linkedin.com", paused: true },
      }),
    ).toThrow("INVALID_MESSAGE");
  });

  it("accepts the disposing model lifecycle state", () => {
    expect(
      parseExtensionMessage({
        source: "background",
        target: "popup",
        type: "MODEL_STATUS_RESULT",
        payload: { ...validModelStatus, state: "disposing" },
      }),
    ).toMatchObject({ type: "MODEL_STATUS_RESULT" });
  });

  it("accepts a model status carrying the WebGPU fallback reason code", () => {
    expect(
      parseExtensionMessage({
        source: "background",
        target: "popup",
        type: "MODEL_STATUS_RESULT",
        payload: {
          ...validModelStatus,
          backend: "wasm",
          reasonCodes: ["WEBGPU_FALLBACK"],
        },
      }),
    ).toMatchObject({ type: "MODEL_STATUS_RESULT" });
  });

  it("rejects a model status with an unknown reason code", () => {
    expect(() =>
      parseExtensionMessage({
        source: "background",
        target: "popup",
        type: "MODEL_STATUS_RESULT",
        payload: {
          ...validModelStatus,
          backend: "wasm",
          reasonCodes: ["SOMETHING_ELSE"],
        },
      }),
    ).toThrow("INVALID_MESSAGE");
  });

  it("rejects a model status carrying a removed legacy field", () => {
    expect(() =>
      parseExtensionMessage({
        source: "background",
        target: "popup",
        type: "MODEL_STATUS_RESULT",
        payload: { ...validModelStatus, warning: "WEBGPU_FALLBACK" },
      }),
    ).toThrow("INVALID_MESSAGE");
  });
});
