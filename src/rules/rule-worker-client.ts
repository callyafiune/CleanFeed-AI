import { CleanFeedError } from "@/shared/errors";
// Type-only: importing the worker module as a value would run its top-level
// `installRuleWorker(self)` on this (main) thread. Only its message shapes are
// imported here, which are erased at build time.
import type {
  RuleWorkerRequest,
  RuleWorkerResponse,
} from "@/rules/rule-worker";

/**
 * Client for the disposable {@link RuleWorkerClient} worker. It owns the 20 ms
 * kill-switch that makes untrusted regex safe to run: if a single evaluation
 * does not answer within the budget, the worker is terminated and a fresh one
 * recreated, and the pending call rejects with `INFERENCE_TIMEOUT`. Regex is
 * never compiled or executed here — only posted to the worker.
 */

/** Hard ceiling on how long the worker may take to answer one rule. */
export const RULE_MATCH_TIMEOUT_MS = 20;

/** Longest normalized text posted for a single rule; capped before it is sent. */
export const MAX_RULE_TEXT_LENGTH = 20_000;

/** The minimal rule shape the worker needs: a pattern and its case mode. */
export interface RegexRuleInput {
  pattern: string;
  caseSensitive?: boolean;
}

export interface RuleWorkerLike {
  postMessage(message: RuleWorkerRequest): void;
  onmessage: ((event: MessageEvent<unknown>) => void) | null;
  onerror: ((event: ErrorEvent) => void) | null;
  terminate(): void;
}

interface PendingMatch {
  resolve: (matched: boolean) => void;
  reject: (reason: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export class RuleWorkerClient {
  private worker: RuleWorkerLike;
  private sequence = 0;
  private readonly pending = new Map<string, PendingMatch>();

  constructor(
    private readonly createWorker: () => RuleWorkerLike = () =>
      new Worker(new URL("./rule-worker.ts", import.meta.url), {
        type: "module",
      }),
  ) {
    this.worker = this.createWorker();
    this.attach(this.worker);
  }

  /**
   * Posts one regex rule to the worker and resolves with whether it matched.
   * The text is capped to {@link MAX_RULE_TEXT_LENGTH} before it leaves this
   * thread. Rejects with `INFERENCE_TIMEOUT` if the worker overruns the budget.
   */
  match(rule: RegexRuleInput, text: string): Promise<boolean> {
    const requestId = `rule-${(this.sequence += 1)}`;
    const payloadText = text.slice(0, MAX_RULE_TEXT_LENGTH);
    return new Promise<boolean>((resolve, reject) => {
      const timeout = setTimeout(
        () => this.handleTimeout(requestId),
        RULE_MATCH_TIMEOUT_MS,
      );
      this.pending.set(requestId, { resolve, reject, timeout });
      try {
        this.worker.postMessage({
          type: "MATCH",
          requestId,
          payload: {
            pattern: rule.pattern,
            caseSensitive: rule.caseSensitive ?? false,
            text: payloadText,
          },
        });
      } catch (error) {
        this.settle(requestId)?.reject(error);
      }
    });
  }

  /** Terminates the current worker and drops any in-flight work. */
  dispose(): void {
    this.rejectAll(workerUnavailable());
    this.worker.terminate();
  }

  private attach(worker: RuleWorkerLike): void {
    worker.onmessage = (event) => {
      if (this.worker === worker) this.handleMessage(event.data);
    };
    worker.onerror = () => {
      if (this.worker === worker) this.recreateWorker(workerUnavailable());
    };
  }

  private handleMessage(data: unknown): void {
    if (!isResponse(data)) return;
    const pending = this.settle(data.requestId);
    if (pending === undefined) return;
    // An ERROR means the worker refused the pattern; a refused rule simply does
    // not match and must never surface as a thrown error in classification.
    pending.resolve(data.type === "RESULT" ? data.payload.matched : false);
  }

  private handleTimeout(requestId: string): void {
    const pending = this.settle(requestId);
    if (pending === undefined) return;
    const timeoutError = new CleanFeedError(
      "INFERENCE_TIMEOUT",
      "INFERENCE_TIMEOUT",
    );
    // Kill the worker that overran, then reject the offender and any siblings
    // whose worker just died, and stand a fresh worker back up.
    this.recreateWorker(timeoutError);
    pending.reject(timeoutError);
  }

  private recreateWorker(reason: unknown): void {
    this.worker.terminate();
    this.rejectAll(reason);
    this.worker = this.createWorker();
    this.attach(this.worker);
  }

  private rejectAll(reason: unknown): void {
    for (const [requestId, pending] of this.pending) {
      clearTimeout(pending.timeout);
      this.pending.delete(requestId);
      pending.reject(reason);
    }
  }

  private settle(requestId: string): PendingMatch | undefined {
    const pending = this.pending.get(requestId);
    if (pending !== undefined) {
      clearTimeout(pending.timeout);
      this.pending.delete(requestId);
    }
    return pending;
  }
}

function workerUnavailable(): CleanFeedError {
  return new CleanFeedError("WORKER_UNAVAILABLE", "WORKER_UNAVAILABLE");
}

function isResponse(value: unknown): value is RuleWorkerResponse {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    (record.type === "RESULT" || record.type === "ERROR") &&
    typeof record.requestId === "string" &&
    typeof record.payload === "object" &&
    record.payload !== null
  );
}
