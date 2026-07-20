// A local, in-memory circuit breaker for the TMR runtime. It counts ONLY the
// operational model/tokenization/inference/timeout failures inside a moving
// ten-minute window. Three such failures open it; once open it STAYS open until
// an explicit reset (a deliberate user retry). A restart or an update simply
// constructs a NEW instance, so no state survives them. Cancellations,
// unsupported input, a missing profile, a rule error or a UI failure never
// count toward the threshold — they are expected outcomes, not runtime faults.
//
// The Task-7 initialization failure causes an immediate fallback on its own and
// is deliberately NOT recorded here, so it can never be double-counted at the
// threshold.

/** Failures that reflect a genuine TMR runtime fault and count toward opening. */
export type OperationalFailureCode =
  | "MODEL_LOAD_FAILED"
  | "MODEL_INFERENCE_FAILED"
  | "MODEL_TIMEOUT"
  | "TOKENIZATION_FAILED";

/** Failures that are expected outcomes and must NEVER open the breaker. */
export type IgnoredFailureCode =
  | "CANCELLED"
  | "UNSUPPORTED_LANGUAGE"
  | "MODEL_PROFILE_MISSING"
  | "RULE_ERROR"
  | "UI_FAILURE";

export type CircuitBreakerFailureCode =
  OperationalFailureCode | IgnoredFailureCode;

/**
 * A share-safe diagnostic view of the breaker: counters and bounded timestamps
 * only. It never carries text, a URL, a hash or any request content.
 */
export interface CircuitBreakerSnapshot {
  open: boolean;
  failureCount: number;
  failureTimestamps: number[];
}

/** The moving window (ten minutes) over which operational failures accumulate. */
const WINDOW_MS = 600_000;
/** Three operational failures inside the window open the breaker. */
const FAILURE_THRESHOLD = 3;

const OPERATIONAL_CODES: ReadonlySet<CircuitBreakerFailureCode> =
  new Set<OperationalFailureCode>([
    "MODEL_LOAD_FAILED",
    "MODEL_INFERENCE_FAILED",
    "MODEL_TIMEOUT",
    "TOKENIZATION_FAILED",
  ]);

export class CircuitBreaker {
  private failures: number[] = [];
  private opened = false;

  /**
   * Records a failure. Non-operational codes are ignored. Once the count of
   * operational failures inside `[now-WINDOW_MS, now]` reaches the threshold,
   * the breaker latches open.
   */
  recordFailure(code: CircuitBreakerFailureCode, now: number): void {
    if (!OPERATIONAL_CODES.has(code)) {
      return;
    }
    this.failures.push(now);
    this.pruneToWindow(now);
    if (this.failures.length >= FAILURE_THRESHOLD) {
      this.opened = true;
    }
  }

  /** True while the TMR primary may still be attempted. Latches false once open. */
  canAttempt(now: number): boolean {
    if (this.opened) {
      return false;
    }
    this.pruneToWindow(now);
    return this.failures.length < FAILURE_THRESHOLD;
  }

  /** The only way back: a deliberate user retry (or a fresh instance on restart). */
  resetExplicitly(): void {
    this.failures = [];
    this.opened = false;
  }

  snapshot(now: number): CircuitBreakerSnapshot {
    if (!this.opened) {
      this.pruneToWindow(now);
    }
    return {
      open: this.opened,
      failureCount: this.failures.length,
      failureTimestamps: [...this.failures],
    };
  }

  private pruneToWindow(now: number): void {
    const cutoff = now - WINDOW_MS;
    this.failures = this.failures.filter((timestamp) => timestamp >= cutoff);
  }
}
