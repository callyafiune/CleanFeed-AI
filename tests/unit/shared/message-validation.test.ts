import { describe, expect, it } from "vitest";

import { parseExtensionMessage } from "@/shared/message-validation";

describe("parseExtensionMessage", () => {
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
          chunks: [{ index: 0, aiScore: 0.8, humanScore: 0.2 }],
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
});
