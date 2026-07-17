import { describe, expect, it } from "vitest";

import {
  evaluateRegexRule,
  installRuleWorker,
  type RuleWorkerResponse,
  type RuleWorkerScope,
} from "@/rules/rule-worker";

// These tests exercise the ONLY code that actually compiles and runs a
// user-supplied regex (inside the disposable worker), which the timeout test's
// hand-rolled mock worker never reaches.
describe("evaluateRegexRule", () => {
  it("matches a safe pattern and honors case sensitivity", () => {
    expect(
      evaluateRegexRule({
        pattern: "compr\\w+",
        caseSensitive: false,
        text: "COMPRE agora",
      }),
    ).toBe(true);
    expect(
      evaluateRegexRule({
        pattern: "compr\\w+",
        caseSensitive: true,
        text: "COMPRE agora",
      }),
    ).toBe(false);
    expect(
      evaluateRegexRule({
        pattern: "xyz",
        caseSensitive: false,
        text: "curso",
      }),
    ).toBe(false);
  });

  it("throws on an unsafe pattern so new RegExp never runs it", () => {
    expect(() =>
      evaluateRegexRule({
        pattern: "(a+)+$",
        caseSensitive: false,
        text: "aaaa",
      }),
    ).toThrowError(/UNSAFE_REGEX/u);
  });

  it("caps the scanned text at 20000 characters", () => {
    // A match that only exists beyond the cap must not be found.
    const text = "b".repeat(30_000) + "needle";
    expect(
      evaluateRegexRule({ pattern: "needle", caseSensitive: false, text }),
    ).toBe(false);
  });
});

describe("installRuleWorker", () => {
  it("replies RESULT for a valid request and ERROR for an unsafe pattern", () => {
    const posted: RuleWorkerResponse[] = [];
    let listener: ((event: MessageEvent<unknown>) => void) | undefined;
    const scope: RuleWorkerScope = {
      addEventListener: (_type, handler) => {
        listener = handler;
      },
      postMessage: (message) => posted.push(message),
    };

    installRuleWorker(scope);
    listener?.({
      data: {
        type: "MATCH",
        requestId: "r1",
        payload: {
          pattern: "curso",
          caseSensitive: false,
          text: "faça o curso",
        },
      },
    } as MessageEvent<unknown>);
    listener?.({
      data: {
        type: "MATCH",
        requestId: "r2",
        payload: { pattern: "(a+)+$", caseSensitive: false, text: "aaaa" },
      },
    } as MessageEvent<unknown>);

    expect(posted).toEqual([
      { type: "RESULT", requestId: "r1", payload: { matched: true } },
      {
        type: "ERROR",
        requestId: "r2",
        payload: { reason: expect.stringMatching(/UNSAFE_REGEX/u) },
      },
    ]);
  });
});
