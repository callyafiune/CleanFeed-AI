import { validateRegexPattern } from "@/rules/regex-safety";

/**
 * The dedicated, disposable Web Worker that evaluates personal keyword rules of
 * type `regex`. It is the ONLY place in the extension that compiles or runs a
 * user-supplied pattern: the caller's thread never touches `new RegExp`. The
 * worker recompiles the pattern per message, validates it first, caps the input
 * length, and is torn down and recreated by its client whenever a single
 * evaluation overruns the 20 ms budget.
 */

/** Longest normalized text the worker will ever scan for a single rule. */
export const MAX_RULE_TEXT_LENGTH = 20_000;

export interface RuleWorkerMatchPayload {
  pattern: string;
  caseSensitive: boolean;
  text: string;
}

export interface RuleWorkerRequest {
  type: "MATCH";
  requestId: string;
  payload: RuleWorkerMatchPayload;
}

export type RuleWorkerResponse =
  | { type: "RESULT"; requestId: string; payload: { matched: boolean } }
  | { type: "ERROR"; requestId: string; payload: { reason: string } };

export interface RuleWorkerScope {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<unknown>) => void,
  ): void;
  postMessage(message: RuleWorkerResponse): void;
}

/**
 * Compiles and tests a single regex rule. Throws if the pattern fails the
 * safety validator so a bad rule can never reach `new RegExp`; the input is
 * always capped before the (already-bounded) pattern runs against it.
 */
export function evaluateRegexRule(payload: RuleWorkerMatchPayload): boolean {
  const flags = payload.caseSensitive ? "u" : "iu";
  const safety = validateRegexPattern(payload.pattern, flags);
  if (!safety.safe) {
    throw new Error(`UNSAFE_REGEX:${safety.reason ?? "UNKNOWN"}`);
  }
  const regex = new RegExp(payload.pattern, flags);
  const text = payload.text.slice(0, MAX_RULE_TEXT_LENGTH);
  return regex.test(text);
}

/** Wires the worker scope so each valid MATCH request gets exactly one reply. */
export function installRuleWorker(scope: RuleWorkerScope): void {
  scope.addEventListener("message", (event) => {
    const request = event.data;
    if (!isMatchRequest(request)) return;
    try {
      const matched = evaluateRegexRule(request.payload);
      scope.postMessage({
        type: "RESULT",
        requestId: request.requestId,
        payload: { matched },
      });
    } catch (error) {
      scope.postMessage({
        type: "ERROR",
        requestId: request.requestId,
        payload: { reason: reasonFrom(error) },
      });
    }
  });
}

function reasonFrom(error: unknown): string {
  return error instanceof Error ? error.message : "RULE_EVALUATION_FAILED";
}

function isMatchRequest(value: unknown): value is RuleWorkerRequest {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  if (record.type !== "MATCH" || typeof record.requestId !== "string") {
    return false;
  }
  const payload = record.payload;
  if (typeof payload !== "object" || payload === null) return false;
  const match = payload as Record<string, unknown>;
  return (
    typeof match.pattern === "string" &&
    typeof match.caseSensitive === "boolean" &&
    typeof match.text === "string"
  );
}

installRuleWorker(self as unknown as RuleWorkerScope);
