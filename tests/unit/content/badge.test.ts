import "@testing-library/jest-dom/vitest";
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { applyBadge } from "@/content/presentation/badge";
import { restorePresentation } from "@/content/presentation/restore";
import { CLASSIFICATION_STATUS_COPY } from "@/shared/classification-copy";
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

  it("shows only the qualitative band and never a score, whatever showScore is", () => {
    const post = document.createElement("article");
    post.textContent = "Conteúdo original";
    document.body.append(post);

    // The raw/calibrated score must never leak into the feed, even when the
    // advanced diagnostic toggle is on: the badge is purely qualitative.
    for (const showScore of [false, true]) {
      applyBadge(post, result("possibly_ai"), {
        ...DEFAULT_SETTINGS,
        showScore,
      });
      const badge = screen.getByRole("button");
      expect(badge.textContent).toBe(
        `◌ ${CLASSIFICATION_STATUS_COPY.possibly_ai}`,
      );
      expect(badge.textContent).toBe("◌ Sinais detectados");
      expect(badge.textContent).not.toMatch(/%|0[.,]9/u);
      expect(badge.getAttribute("aria-label")).toBe(
        `CleanFeed: ${CLASSIFICATION_STATUS_COPY.possibly_ai}`,
      );
    }
  });

  it("labels a stronger indication with the qualitative band, still score-free", () => {
    const post = document.createElement("article");
    post.textContent = "Conteúdo original";
    document.body.append(post);

    applyBadge(post, result("strong_ai_indication"), {
      ...DEFAULT_SETTINGS,
      showScore: true,
    });

    const badge = screen.getByRole("button");
    expect(badge.textContent).toBe(
      `◌ ${CLASSIFICATION_STATUS_COPY.strong_ai_indication}`,
    );
    expect(badge.textContent).toBe("◌ Sinais mais fortes");
    expect(badge.textContent).not.toMatch(/%|0[.,]9/u);
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
