import { afterEach, describe, expect, it } from "vitest";

import { applyBadge } from "@/content/presentation/badge";
import { restorePresentation } from "@/content/presentation/restore";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ClassificationResult } from "@/shared/types";
import {
  createBuiltinRuntimeIdentity,
  createDecisionOutcome,
  createEvidenceAssessment,
} from "../../helpers/model-fixtures";

function result(status: ClassificationResult["status"]): ClassificationResult {
  return {
    aiScore: 0.9,
    humanScore: 0.1,
    confidence: "high",
    status,
    wordCount: 140,
    tokenCount: 150,
    runtimeIdentity: createBuiltinRuntimeIdentity(),
    evidence: createEvidenceAssessment(),
    decision: createDecisionOutcome({ status }),
    modelVersion: "test",
    modelId: "test",
    backend: "mock",
    processingTimeMs: 3,
    demo: true,
  };
}

describe("applyBadge", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("adds an accessible, score-free badge next to the post", () => {
    const post = document.createElement("article");
    post.textContent = "Conteúdo original";
    document.body.append(post);

    applyBadge(post, result("possibly_ai"), DEFAULT_SETTINGS);

    const badge = document.querySelector<HTMLButtonElement>(
      "[data-cleanfeed-owned='badge']",
    );
    expect(badge?.tagName).toBe("BUTTON");
    expect(badge?.textContent).toContain("Possivelmente gerado por IA");
    expect(badge?.textContent).not.toContain("90%");
    expect(badge?.getAttribute("aria-label")).toContain("Possivelmente");
    expect(badge?.previousElementSibling).toBeNull();
    expect(badge?.nextElementSibling).toBe(post);
  });

  it("restores only CleanFeed-owned nodes and is idempotent", () => {
    const post = document.createElement("article");
    post.textContent = "Conteúdo original";
    const unrelated = document.createElement("aside");
    unrelated.textContent = "Não pertence ao CleanFeed";
    document.body.append(post, unrelated);
    const original = post.textContent;

    applyBadge(post, result("strong_ai_indication"), DEFAULT_SETTINGS);
    restorePresentation(post);
    restorePresentation(post);

    expect(post.textContent).toBe(original);
    expect(document.body.contains(unrelated)).toBe(true);
    expect(document.querySelector("[data-cleanfeed-owned='badge']")).toBeNull();
  });
});
