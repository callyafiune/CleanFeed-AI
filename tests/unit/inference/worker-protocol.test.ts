import { describe, expect, it } from "vitest";

import {
  parseWorkerResponse,
  serializeWorkerError,
} from "@/inference/worker-protocol";
import { CleanFeedError } from "@/shared/errors";

describe("worker error protocol", () => {
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
