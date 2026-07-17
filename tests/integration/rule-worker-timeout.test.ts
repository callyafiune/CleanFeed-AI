import { describe, expect, it, vi } from "vitest";

import {
  RuleWorkerClient,
  type RegexRuleInput,
} from "@/rules/rule-worker-client";

function createMockWorker() {
  const worker = {
    postMessage: vi.fn(),
    onmessage: null as ((event: MessageEvent<unknown>) => void) | null,
    onerror: null as ((event: ErrorEvent) => void) | null,
    terminate: vi.fn(),
    neverRespond(): void {
      // Deliberately never invoke onmessage so the client must time out.
    },
    respond(requestId: string, matched: boolean): void {
      worker.onmessage?.({
        data: { type: "RESULT", requestId, payload: { matched } },
      } as MessageEvent<unknown>);
    },
  };
  return worker;
}

function rule(overrides: Partial<RegexRuleInput> = {}): RegexRuleInput {
  return { pattern: "a", caseSensitive: false, ...overrides };
}

describe("rule worker timeout", () => {
  it("terminates the rule worker after 20ms", async () => {
    const worker = createMockWorker();
    const client = new RuleWorkerClient(() => worker);
    worker.neverRespond();
    await expect(
      client.match(rule({ pattern: "a" }), "a".repeat(20_000)),
    ).rejects.toMatchObject({ code: "INFERENCE_TIMEOUT" });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("resolves with the worker's match result before the timeout", async () => {
    const worker = createMockWorker();
    const client = new RuleWorkerClient(() => worker);
    const pending = client.match(rule(), "algum texto");
    const call = worker.postMessage.mock.calls[0]?.[0] as {
      requestId: string;
    };
    worker.respond(call.requestId, true);
    await expect(pending).resolves.toBe(true);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("resolves false when the worker refuses the pattern (ERROR response)", async () => {
    const worker = createMockWorker();
    const client = new RuleWorkerClient(() => worker);
    const pending = client.match(rule({ pattern: "(a+)+" }), "aaaa");
    const call = worker.postMessage.mock.calls[0]?.[0] as {
      requestId: string;
    };
    // A refused rule must resolve false, never throw into classification, and
    // must not tear the worker down.
    worker.onmessage?.({
      data: {
        type: "ERROR",
        requestId: call.requestId,
        payload: { reason: "UNSAFE_REGEX:NESTED_QUANTIFIER" },
      },
    } as MessageEvent<unknown>);
    await expect(pending).resolves.toBe(false);
    expect(worker.terminate).not.toHaveBeenCalled();
  });

  it("caps evaluated text at 20000 characters before posting", () => {
    const worker = createMockWorker();
    const client = new RuleWorkerClient(() => worker);
    const pending = client.match(rule(), "b".repeat(50_000));
    // Swallow the eventual timeout rejection and dispose so no real 20ms timer
    // leaks past the test.
    pending.catch(() => undefined);
    const call = worker.postMessage.mock.calls[0]?.[0] as {
      payload: { text: string };
    };
    expect(call.payload.text.length).toBe(20_000);
    client.dispose();
  });
});
