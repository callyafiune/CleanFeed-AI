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
