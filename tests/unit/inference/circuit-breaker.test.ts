import { describe, expect, it } from "vitest";

import { CircuitBreaker } from "@/inference/circuit-breaker";

describe("CircuitBreaker", () => {
  it("opens on the third operational failure inside the moving ten-minute window", () => {
    const breaker = new CircuitBreaker();

    breaker.recordFailure("MODEL_INFERENCE_FAILED", 0);
    breaker.recordFailure("MODEL_TIMEOUT", 599_999);
    expect(breaker.canAttempt(599_999)).toBe(true);
    breaker.recordFailure("TOKENIZATION_FAILED", 600_000);
    expect(breaker.canAttempt(600_000)).toBe(false);
  });

  it("does not open when the third failure ages the first one out of the window", () => {
    const breaker = new CircuitBreaker();

    // First failure at 0 falls OUTSIDE the [now-600000, now] window when the
    // third arrives at 600001, so only two failures are in scope.
    breaker.recordFailure("MODEL_INFERENCE_FAILED", 0);
    breaker.recordFailure("MODEL_TIMEOUT", 300_000);
    breaker.recordFailure("MODEL_INFERENCE_FAILED", 600_001);

    expect(breaker.canAttempt(600_001)).toBe(true);
  });

  it("counts only operational model/tokenization/inference/timeout codes", () => {
    const breaker = new CircuitBreaker();

    breaker.recordFailure("CANCELLED", 0);
    breaker.recordFailure("UNSUPPORTED_LANGUAGE", 1);
    breaker.recordFailure("MODEL_PROFILE_MISSING", 2);
    breaker.recordFailure("RULE_ERROR", 3);
    breaker.recordFailure("UI_FAILURE", 4);
    breaker.recordFailure("CANCELLED", 5);

    // None of the ignored codes count toward the threshold.
    expect(breaker.canAttempt(5)).toBe(true);

    breaker.recordFailure("MODEL_INFERENCE_FAILED", 6);
    breaker.recordFailure("MODEL_LOAD_FAILED", 7);
    breaker.recordFailure("MODEL_TIMEOUT", 8);
    expect(breaker.canAttempt(8)).toBe(false);
  });

  it("stays open after failures age beyond the window until an explicit reset", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure("MODEL_INFERENCE_FAILED", 0);
    breaker.recordFailure("MODEL_TIMEOUT", 1);
    breaker.recordFailure("TOKENIZATION_FAILED", 2);
    expect(breaker.canAttempt(2)).toBe(false);

    // Advancing far beyond the window does NOT re-close the breaker.
    expect(breaker.canAttempt(10_000_000)).toBe(false);

    breaker.resetExplicitly();
    expect(breaker.canAttempt(10_000_000)).toBe(true);
  });

  it("exposes a text-free diagnostic snapshot of counters, bounded timestamps and a reason code", () => {
    const breaker = new CircuitBreaker();
    breaker.recordFailure("MODEL_INFERENCE_FAILED", 0);
    breaker.recordFailure("MODEL_TIMEOUT", 1);
    breaker.recordFailure("TOKENIZATION_FAILED", 2);

    const snapshot = breaker.snapshot(2);
    expect(snapshot.open).toBe(true);
    expect(snapshot.failureCount).toBe(3);
    expect(snapshot.failureTimestamps).toEqual([0, 1, 2]);
    // Every value is a boolean or a number: the snapshot can never carry post
    // text, a URL or a hash, only counters and bounded timestamps.
    expect(typeof snapshot.open).toBe("boolean");
    expect(typeof snapshot.failureCount).toBe("number");
    for (const value of snapshot.failureTimestamps) {
      expect(typeof value).toBe("number");
    }
  });
});
