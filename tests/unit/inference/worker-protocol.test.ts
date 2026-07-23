import { describe, expect, it } from "vitest";

import {
  parseWorkerRequest,
  parseWorkerResponse,
  serializeWorkerError,
} from "@/inference/worker-protocol";
import { CleanFeedError } from "@/shared/errors";

describe("worker error protocol", () => {
  it("accepts extension-local assets in INITIALIZE", () => {
    expect(
      parseWorkerRequest({
        type: "INITIALIZE",
        requestId: "worker-initialize",
        payload: {
          modelBaseUrl: "chrome-extension://test/models/",
          wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
        },
      }),
    ).toMatchObject({ type: "INITIALIZE" });
  });

  it("accepts INITIALIZE carrying an already-parsed runtime descriptor", () => {
    expect(
      parseWorkerRequest({
        type: "INITIALIZE",
        requestId: "worker-initialize",
        payload: {
          modelBaseUrl: "chrome-extension://test/models/",
          wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
          descriptor: {
            manifest: { modelId: "cleanfeed-ptbr-v1" },
            release: { rolloutState: "bundle-verified" },
            profiles: { schemaVersion: 1, profiles: [] },
            sourceLock: { modelId: "cleanfeed-ptbr-v1" },
          },
        },
      }),
    ).toMatchObject({ type: "INITIALIZE" });
  });

  it("rejects an INITIALIZE payload with an unknown key", () => {
    expect(() =>
      parseWorkerRequest({
        type: "INITIALIZE",
        requestId: "worker-initialize",
        payload: {
          modelBaseUrl: "chrome-extension://test/models/",
          wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
          bogus: 1,
        },
      }),
    ).toThrowError("INVALID_WORKER_MESSAGE");
  });

  it("accepts a CLASSIFY request whose settings snapshot carries no thresholds", () => {
    const request = parseWorkerRequest({
      type: "CLASSIFY",
      requestId: "classify-1",
      payload: {
        text: "texto de publicação",
        platform: "linkedin",
        manual: false,
        settings: {
          languageMode: "portuguese_only",
          presentationMode: "indicator",
          chunkSizeTokens: 510,
          chunkOverlapTokens: 64,
          maximumTokens: 512,
          inferenceTimeoutMs: 20_000,
        },
      },
    });

    expect(request).toMatchObject({ type: "CLASSIFY" });
  });

  it("serializes and accepts INSUFFICIENT_EVIDENCE error responses", () => {
    const payload = serializeWorkerError(
      new CleanFeedError("INSUFFICIENT_EVIDENCE", "INSUFFICIENT_EVIDENCE"),
    );

    expect(payload.code).toBe("INSUFFICIENT_EVIDENCE");
    expect(
      parseWorkerResponse({
        type: "ERROR",
        requestId: "request-1",
        payload,
      }),
    ).toMatchObject({ type: "ERROR", payload });
  });
});
