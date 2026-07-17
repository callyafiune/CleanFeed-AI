import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { createExplanationPanel } from "@/content/presentation/explanation-panel";
import { RuleEngine, type KeywordRule } from "@/rules/rule-engine";
import type { RuleWorkerClient } from "@/rules/rule-worker-client";
import type { ClassificationResult } from "@/shared/types";

function rule(overrides: Partial<KeywordRule> = {}): KeywordRule {
  return {
    id: "rule-1",
    pattern: "curso",
    matchType: "contains",
    caseSensitive: false,
    action: "blur",
    platforms: ["linkedin"],
    enabled: true,
    ...overrides,
  };
}

describe("RuleEngine.evaluate", () => {
  it("returns a separate rule result without changing AI status", async () => {
    const engine = new RuleEngine();
    const result = await engine.evaluate("Compre CURSO agora", "linkedin", [
      rule({
        pattern: "curso",
        matchType: "contains",
        caseSensitive: false,
        action: "blur",
      }),
    ]);
    expect(result).toMatchObject({ matched: true, action: "blur" });
    expect(result.label).toBe("Conteúdo filtrado por uma regra personalizada.");
    expect(result).not.toHaveProperty("aiScore");
  });

  it("respects case sensitivity for contains rules", async () => {
    const engine = new RuleEngine();
    await expect(
      engine.evaluate("Compre CURSO agora", "linkedin", [
        rule({ pattern: "curso", caseSensitive: true }),
      ]),
    ).resolves.toMatchObject({ matched: false });
  });

  it("matches exact rules only on the whole normalized text", async () => {
    const engine = new RuleEngine();
    const rules = [
      rule({ pattern: "spam", matchType: "exact", caseSensitive: false }),
    ];
    await expect(
      engine.evaluate("spam", "linkedin", rules),
    ).resolves.toMatchObject({ matched: true });
    await expect(
      engine.evaluate("this is spam text", "linkedin", rules),
    ).resolves.toMatchObject({ matched: false });
  });

  it("skips rules for other platforms or that are disabled", async () => {
    const engine = new RuleEngine();
    await expect(
      engine.evaluate("curso", "linkedin", [rule({ platforms: ["manual"] })]),
    ).resolves.toMatchObject({ matched: false });
    await expect(
      engine.evaluate("curso", "linkedin", [rule({ enabled: false })]),
    ).resolves.toMatchObject({ matched: false });
  });

  it("returns a bare unmatched result when nothing matches", async () => {
    const engine = new RuleEngine();
    const result = await engine.evaluate("texto qualquer", "linkedin", [
      rule({ pattern: "outro" }),
    ]);
    expect(result).toEqual({ matched: false });
  });

  it("delegates a regex rule to the worker and never compiles it inline", async () => {
    // The engine must hand a safe regex pattern to the worker client rather than
    // build a RegExp on this (main) thread. A fake client lets us prove the
    // delegation happens with the capped text and that the result flows back.
    const match = vi.fn().mockResolvedValue(true);
    const client = {
      match,
      dispose: vi.fn(),
    } as unknown as RuleWorkerClient;
    const engine = new RuleEngine({ workerClient: client });

    const result = await engine.evaluate("compre agora", "linkedin", [
      rule({ pattern: "compr\\w+", matchType: "regex", action: "hide" }),
    ]);

    expect(match).toHaveBeenCalledWith(
      expect.objectContaining({ pattern: "compr\\w+" }),
      "compre agora",
    );
    expect(result).toMatchObject({ matched: true, action: "hide" });
    expect(result).not.toHaveProperty("aiScore");
  });

  it("isolates a regex rule whose worker fails and keeps evaluating the rest", async () => {
    // A worker timeout/unavailable rejection for one rule must not abort the
    // ruleset: the following contains rule must still be evaluated and match.
    const match = vi.fn().mockRejectedValue(new Error("INFERENCE_TIMEOUT"));
    const client = {
      match,
      dispose: vi.fn(),
    } as unknown as RuleWorkerClient;
    const engine = new RuleEngine({ workerClient: client });

    const result = await engine.evaluate("compre o curso", "linkedin", [
      rule({ id: "r-regex", pattern: "compr\\w+", matchType: "regex" }),
      rule({
        id: "r-contains",
        pattern: "curso",
        matchType: "contains",
        action: "collapse",
      }),
    ]);

    expect(match).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      matched: true,
      ruleId: "r-contains",
      action: "collapse",
    });
  });
});

describe("explanation panel current-post rule action", () => {
  function makeResult(): ClassificationResult {
    return {
      aiScore: 0.9,
      humanScore: 0.1,
      confidence: "high",
      status: "possibly_ai",
      wordCount: 140,
      tokenCount: 150,
      modelVersion: "mock-v1",
      modelId: "mock-detector",
      backend: "mock",
      processingTimeMs: 4,
      demo: true,
    };
  }

  it("offers a current-post rule action only when personal rules are enabled", () => {
    const result = makeResult();
    const callbacks = { onFeedback: vi.fn() };
    const panel = createExplanationPanel(result, {
      ...callbacks,
      personalRulesEnabled: true,
      onCreateRule: vi.fn(),
    });
    document.body.append(panel);
    expect(
      screen.getByRole("button", { name: "Adicionar regra para este post" }),
    ).toBeVisible();
    document.body.replaceChildren();
  });

  it("hides the rule action when personal rules are disabled", () => {
    const panel = createExplanationPanel(makeResult(), {
      onFeedback: vi.fn(),
    });
    document.body.append(panel);
    expect(
      screen.queryByRole("button", {
        name: "Adicionar regra para este post",
      }),
    ).toBeNull();
    document.body.replaceChildren();
  });

  it("invokes onCreateRule when the rule action is activated", () => {
    const onCreateRule = vi.fn();
    const panel = createExplanationPanel(makeResult(), {
      onFeedback: vi.fn(),
      personalRulesEnabled: true,
      onCreateRule,
    });
    document.body.append(panel);
    screen
      .getByRole("button", { name: "Adicionar regra para este post" })
      .click();
    expect(onCreateRule).toHaveBeenCalledOnce();
    document.body.replaceChildren();
  });
});
