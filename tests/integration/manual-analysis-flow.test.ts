import { describe, expect, it, vi } from "vitest";

import {
  MANUAL_ANALYSIS_ENTRY,
  MAX_MANUAL_SELECTION_LENGTH,
  ManualAnalysisController,
} from "@/background/manual-analysis-controller";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { ClassificationResult } from "@/shared/types";

const PORTUGUESE_LONG_TEXT = Array.from({ length: 120 }, () => "conteúdo").join(
  " ",
);

const CLASSIFICATION: ClassificationResult = {
  aiScore: 0.86,
  humanScore: 0.14,
  confidence: "high",
  status: "possibly_ai",
  wordCount: 120,
  tokenCount: 150,
  modelVersion: "mock-v1",
  modelId: "mock",
  backend: "mock",
  processingTimeMs: 12,
  demo: true,
};

function createController(
  overrides: {
    onResult?: (result: ClassificationResult, tabId: number) => void;
    minimumWordCount?: number;
  } = {},
) {
  const executeScript = vi.fn().mockResolvedValue([]);
  const sendMessage = vi.fn().mockResolvedValue(undefined);
  const controller = new ManualAnalysisController({
    scripting: { executeScript },
    messenger: { sendMessage },
    minimumWordCount: () => overrides.minimumWordCount ?? 120,
    onResult: overrides.onResult,
  });
  return { controller, executeScript, sendMessage };
}

describe("manual analysis background flow", () => {
  it("injects the programmatic manual entry under the user gesture", async () => {
    const { controller, executeScript } = createController();

    await controller.open(7, PORTUGUESE_LONG_TEXT);

    expect(executeScript).toHaveBeenCalledWith({
      target: { tabId: 7 },
      files: [MANUAL_ANALYSIS_ENTRY],
    });
  });

  it("sends a valid SHOW_MANUAL_ANALYSIS message routed to the panel", async () => {
    const { controller, sendMessage } = createController({
      minimumWordCount: 120,
    });

    await controller.open(7, PORTUGUESE_LONG_TEXT);

    const [tabId, rawMessage] = sendMessage.mock.calls[0];
    expect(tabId).toBe(7);
    const message = parseExtensionMessage(rawMessage);
    expect(message).toMatchObject({
      source: "background",
      target: "manual",
      type: "SHOW_MANUAL_ANALYSIS",
      payload: { selectedText: PORTUGUESE_LONG_TEXT, minimumWordCount: 120 },
    });
  });

  it("truncates selections to the classification character limit", async () => {
    const { controller, sendMessage } = createController();
    const huge = "a".repeat(MAX_MANUAL_SELECTION_LENGTH + 500);

    await controller.open(7, huge);

    const message = parseExtensionMessage(sendMessage.mock.calls[0][1]);
    if (message.type !== "SHOW_MANUAL_ANALYSIS") throw new Error("wrong type");
    expect(message.payload.selectedText.length).toBe(
      MAX_MANUAL_SELECTION_LENGTH,
    );
  });

  it("resends the selection when the panel reports it is ready", async () => {
    const { controller, sendMessage } = createController();
    await controller.open(7, PORTUGUESE_LONG_TEXT);
    sendMessage.mockClear();

    await controller.handleMessage(
      {
        source: "manual",
        target: "background",
        type: "MANUAL_ANALYSIS_READY",
        payload: undefined,
      },
      { tab: { id: 7 } },
    );

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(parseExtensionMessage(sendMessage.mock.calls[0][1]).type).toBe(
      "SHOW_MANUAL_ANALYSIS",
    );
  });

  it("routes a reported manual result to its consumer", async () => {
    const onResult = vi.fn();
    const { controller } = createController({ onResult });

    await controller.handleMessage(
      {
        source: "manual",
        target: "background",
        type: "MANUAL_ANALYSIS_RESULT",
        payload: CLASSIFICATION,
      },
      { tab: { id: 9 } },
    );

    expect(onResult).toHaveBeenCalledWith(CLASSIFICATION, 9);
  });

  it("ignores ready messages for tabs without a pending analysis", async () => {
    const { controller, sendMessage } = createController();

    await controller.handleMessage(
      {
        source: "manual",
        target: "background",
        type: "MANUAL_ANALYSIS_READY",
        payload: undefined,
      },
      { tab: { id: 42 } },
    );

    expect(sendMessage).not.toHaveBeenCalled();
  });
});

describe("manual analysis message contract", () => {
  it("accepts the three manual analysis envelopes on their allowed routes", () => {
    const accepted = [
      {
        source: "background",
        target: "manual",
        type: "SHOW_MANUAL_ANALYSIS",
        payload: { selectedText: PORTUGUESE_LONG_TEXT, minimumWordCount: 100 },
      },
      {
        source: "manual",
        target: "background",
        type: "MANUAL_ANALYSIS_READY",
        payload: undefined,
      },
      {
        source: "manual",
        target: "background",
        type: "MANUAL_ANALYSIS_RESULT",
        payload: CLASSIFICATION,
      },
      {
        source: "manual",
        target: "background",
        type: "CLASSIFY_TEXT",
        requestId: "manual-1",
        payload: {
          text: PORTUGUESE_LONG_TEXT,
          platform: "manual",
          manual: true,
        },
      },
      {
        source: "background",
        target: "manual",
        type: "CLASSIFICATION_RESULT",
        requestId: "manual-1",
        payload: CLASSIFICATION,
      },
    ];

    for (const message of accepted) {
      expect(parseExtensionMessage(message).type).toBe(message.type);
    }
  });

  it("rejects forged routes for the manual analysis envelopes", () => {
    const forged = [
      {
        source: "manual",
        target: "background",
        type: "SHOW_MANUAL_ANALYSIS",
        payload: { selectedText: PORTUGUESE_LONG_TEXT, minimumWordCount: 100 },
      },
      {
        source: "background",
        target: "manual",
        type: "MANUAL_ANALYSIS_READY",
        payload: undefined,
      },
      {
        source: "background",
        target: "manual",
        type: "MANUAL_ANALYSIS_RESULT",
        payload: CLASSIFICATION,
      },
    ];

    for (const message of forged) {
      expect(() => parseExtensionMessage(message)).toThrow("INVALID_MESSAGE");
    }
  });

  it("rejects a SHOW_MANUAL_ANALYSIS selection above the character limit", () => {
    expect(() =>
      parseExtensionMessage({
        source: "background",
        target: "manual",
        type: "SHOW_MANUAL_ANALYSIS",
        payload: {
          selectedText: "a".repeat(MAX_MANUAL_SELECTION_LENGTH + 1),
          minimumWordCount: 100,
        },
      }),
    ).toThrow("INVALID_MESSAGE");
  });
});
