import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PresentationController } from "@/content/presentation/presentation-controller";
import { SessionState } from "@/content/session-state";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { EffectiveSettings } from "@/shared/settings-types";
import type {
  ClassificationResult,
  ClassificationStatus,
  DecisionOutcome,
  PresentationMode,
} from "@/shared/types";

const decision: DecisionOutcome = {
  status: "strong_ai_indication",
  calibratedScore: 0.97,
  actionCeiling: "hide",
  abstained: false,
  reasonCodes: ["HIGH_AVERAGE_SCORE"],
};

function result(
  overrides: Partial<ClassificationResult> & {
    status?: ClassificationStatus;
    aiScore?: number;
  } = {},
): ClassificationResult {
  const {
    status = "strong_ai_indication",
    aiScore = 0.97,
    ...rest
  } = overrides;
  return {
    aiScore,
    humanScore: 1 - aiScore,
    confidence: "high",
    status,
    wordCount: 140,
    tokenCount: 150,
    modelVersion: "mock-v1",
    modelId: "mock",
    backend: "mock",
    processingTimeMs: 4,
    demo: true,
    ...rest,
  };
}

function settingsFor(mode: PresentationMode): EffectiveSettings {
  return { ...DEFAULT_SETTINGS, presentationMode: mode, markingThreshold: 0.8 };
}

function snapshotAttributes(element: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    element
      .getAttributeNames()
      .map((name) => [name, element.getAttribute(name) ?? ""]),
  );
}

const hideSettings = settingsFor("hide");
const aiResult = result({ status: "strong_ai_indication", aiScore: 0.97 });

const MODE_CLASSES = [
  "cleanfeed-blurred",
  "cleanfeed-collapsed",
  "cleanfeed-hidden",
] as const;

describe("PresentationController", () => {
  let post: HTMLElement;
  let controller: PresentationController;

  beforeEach(() => {
    document.body.replaceChildren();
    const container = document.createElement("div");
    post = document.createElement("article");
    post.append(hostChild());
    container.append(post);
    document.body.append(container);
    controller = new PresentationController();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  function hostChild(): HTMLElement {
    const node = document.createElement("div");
    node.setAttribute("data-host-node", "");
    node.textContent = "conteúdo original";
    return node;
  }

  it("does not filter human, inconclusive or abstained results", () => {
    for (const status of [
      "probably_human",
      "inconclusive",
      "insufficient_evidence",
    ] as const) {
      controller.apply(post, result({ status, aiScore: 0.99 }), hideSettings);
      expect(post).not.toHaveClass(...MODE_CLASSES);
      expect(
        document.querySelector("[data-cleanfeed-owned='badge']"),
      ).toBeNull();
      controller.restore(post);
    }
  });

  it("never presents an abstained decision even with a high score", () => {
    controller.apply(
      post,
      result({ aiScore: 0.99, decision: { ...decision, abstained: true } }),
      hideSettings,
    );
    expect(post).not.toHaveClass(...MODE_CLASSES);
    expect(document.querySelector("[data-cleanfeed-owned='badge']")).toBeNull();
  });

  it("applies the least aggressive mode allowed by calibration", () => {
    controller.apply(
      post,
      result({
        aiScore: 0.999,
        decision: { ...decision, actionCeiling: "blur" },
      }),
      hideSettings,
    );
    expect(post).toHaveClass("cleanfeed-blurred");
    expect(post).not.toHaveClass("cleanfeed-hidden");
    expect(post).not.toHaveClass("cleanfeed-collapsed");
  });

  it("is idempotent and removes only owned nodes", () => {
    const hostNode = post.querySelector("[data-host-node]");
    controller.apply(post, aiResult, hideSettings);
    controller.apply(post, aiResult, hideSettings);
    expect(
      document.querySelectorAll("[data-cleanfeed-owned='badge']"),
    ).toHaveLength(1);
    controller.restore(post);
    expect(hostNode).toBeInTheDocument();
    expect(hostNode?.isConnected).toBe(true);
    expect(document.querySelectorAll("[data-cleanfeed-owned]")).toHaveLength(0);
  });

  it("records the active mode on the badge", () => {
    controller.apply(post, aiResult, settingsFor("collapse"));
    const badge = document.querySelector<HTMLElement>(
      "[data-cleanfeed-owned='badge']",
    );
    expect(badge?.dataset.cleanfeedMode).toBe("collapse");
  });

  it("transitions cleanly between modes without stacking classes or badges", () => {
    controller.apply(post, aiResult, settingsFor("blur"));
    expect(post).toHaveClass("cleanfeed-blurred");

    controller.apply(post, result({ aiScore: 0.97 }), settingsFor("collapse"));
    expect(post).not.toHaveClass("cleanfeed-blurred");
    expect(post).toHaveClass("cleanfeed-collapsed");
    expect(
      document.querySelectorAll("[data-cleanfeed-owned='badge']"),
    ).toHaveLength(1);
  });

  it("reveals by dropping the visual class while keeping the badge", () => {
    const onReveal = vi.fn();
    controller = new PresentationController({ onReveal });
    controller.apply(post, aiResult, hideSettings);
    expect(post).toHaveClass("cleanfeed-hidden");

    controller.reveal(post);
    expect(post).not.toHaveClass("cleanfeed-hidden");
    expect(post.dataset.cleanfeedRevealed).toBe("true");
    expect(
      document.querySelector("[data-cleanfeed-owned='badge']"),
    ).not.toBeNull();
    expect(onReveal).toHaveBeenCalledOnce();

    // Re-applying the same decision must not undo the user's reveal.
    controller.apply(post, aiResult, hideSettings);
    expect(post).not.toHaveClass("cleanfeed-hidden");
  });

  it("restores original attributes exactly and reports the restoration", () => {
    const onRestore = vi.fn();
    controller = new PresentationController({ onRestore });
    post.className = "feed-item";
    post.setAttribute("aria-label", "Publicação");
    post.style.display = "flex";
    const before = snapshotAttributes(post);

    controller.apply(post, aiResult, hideSettings);
    expect(post).toHaveClass("cleanfeed-hidden");
    controller.restore(post);

    expect(snapshotAttributes(post)).toEqual(before);
    expect(post.dataset.cleanfeedStatus).toBeUndefined();
    expect(post.dataset.cleanfeedScore).toBeUndefined();
    expect(onRestore).toHaveBeenCalledOnce();
  });

  it("ignores a post for the session and stops re-applying presentation", () => {
    controller.apply(post, aiResult, hideSettings);
    expect(post).toHaveClass("cleanfeed-hidden");

    controller.ignore(post);
    expect(post).not.toHaveClass("cleanfeed-hidden");
    expect(document.querySelector("[data-cleanfeed-owned='badge']")).toBeNull();

    controller.apply(post, aiResult, hideSettings);
    expect(post).not.toHaveClass("cleanfeed-hidden");
    expect(document.querySelector("[data-cleanfeed-owned='badge']")).toBeNull();
  });

  it("honours ignore state shared through session state", () => {
    const session = new SessionState();
    session.ignore(post);
    controller = new PresentationController({ session });

    controller.apply(post, aiResult, hideSettings);
    expect(post).not.toHaveClass("cleanfeed-hidden");
  });

  it("clears every tracked post and prunes disconnected ones", () => {
    const secondContainer = document.createElement("div");
    const secondPost = document.createElement("article");
    secondContainer.append(secondPost);
    document.body.append(secondContainer);

    controller.apply(post, aiResult, hideSettings);
    controller.apply(secondPost, aiResult, hideSettings);
    expect(
      document.querySelectorAll("[data-cleanfeed-owned='badge']"),
    ).toHaveLength(2);

    secondContainer.remove();
    expect(() => controller.clearAll()).not.toThrow();

    expect(post).not.toHaveClass("cleanfeed-hidden");
    expect(document.querySelectorAll("[data-cleanfeed-owned]")).toHaveLength(0);
  });

  it("removes an owned badge orphaned when its post is detached individually", () => {
    controller.apply(post, aiResult, hideSettings);
    const badge = document.querySelector("[data-cleanfeed-owned='badge']");
    expect(badge).not.toBeNull();

    // Detach only the article; the badge sibling stays connected in the parent.
    post.remove();
    expect(badge?.isConnected).toBe(true);

    controller.clearAll();
    expect(document.querySelector("[data-cleanfeed-owned]")).toBeNull();
  });

  it("cleans owned siblings of an individually-detached post on the next apply", () => {
    const secondContainer = document.createElement("div");
    const secondPost = document.createElement("article");
    secondContainer.append(secondPost);
    document.body.append(secondContainer);

    controller.apply(post, aiResult, hideSettings);
    expect(document.querySelectorAll("[data-cleanfeed-owned]")).toHaveLength(2);

    // Detach only the first article; its badge + placeholder siblings remain.
    post.remove();

    // The next apply runs prune(), which must remove the orphaned siblings.
    controller.apply(secondPost, aiResult, hideSettings);
    expect(document.querySelectorAll("[data-cleanfeed-owned]")).toHaveLength(2);
  });

  it("refreshes a stale badge label and score when the decision changes at the same mode", () => {
    controller.apply(
      post,
      result({ status: "possibly_ai", aiScore: 0.85 }),
      hideSettings,
    );
    controller.apply(
      post,
      result({ status: "strong_ai_indication", aiScore: 0.99 }),
      hideSettings,
    );

    const badges = document.querySelectorAll("[data-cleanfeed-owned='badge']");
    expect(badges).toHaveLength(1);
    expect(badges[0]?.textContent).toContain("Fortes indícios de IA");
    expect(post.dataset.cleanfeedStatus).toBe("strong_ai_indication");
    expect(post.dataset.cleanfeedScore).toBe("0.990");
  });
});
