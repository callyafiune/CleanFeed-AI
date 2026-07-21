import "@testing-library/jest-dom/vitest";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PresentationController } from "@/content/presentation/presentation-controller";
import { resetPlaceholderAnnouncement } from "@/content/presentation/restore";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { EffectiveSettings } from "@/shared/settings-types";
import type { ClassificationResult, PresentationMode } from "@/shared/types";

const MODES: PresentationMode[] = ["blur", "collapse", "hide"];

function makePost(): { post: HTMLElement; host: HTMLElement } {
  const container = document.createElement("div");
  const post = document.createElement("article");
  const host = document.createElement("div");
  host.setAttribute("data-host-node", "");
  host.textContent = "conteúdo original da publicação";
  post.append(host);
  container.append(post);
  document.body.append(container);
  return { post, host };
}

function strongAiResult(): ClassificationResult {
  return {
    aiScore: 0.98,
    humanScore: 0.02,
    confidence: "high",
    status: "strong_ai_indication",
    wordCount: 140,
    tokenCount: 150,
    runtimeIdentity: {
      kind: "builtin",
      modelId: "stylometric",
      modelVersion: "1.0.0",
      implementationVersion: "stylometric-v1",
    },
    evidence: {
      quality: "limited",
      coverage: 1,
      lexicalRatio: 1,
      truncated: false,
      exactTokenizer: false,
      reasonCodes: [],
    },
    decision: {
      status: "strong_ai_indication",
      calibratedScore: 0.98,
      actionCeiling: "hide",
      abstained: false,
      presentationAllowed: true,
      triggers: [],
      reasonCodes: [],
    },
    modelVersion: "mock-v1",
    modelId: "mock",
    backend: "mock",
    processingTimeMs: 4,
    demo: true,
  };
}

function settingsFor(mode: PresentationMode): EffectiveSettings {
  return { ...DEFAULT_SETTINGS, presentationMode: mode };
}

function snapshotAttributes(element: HTMLElement): Record<string, string> {
  return Object.fromEntries(
    element
      .getAttributeNames()
      .map((name) => [name, element.getAttribute(name) ?? ""]),
  );
}

describe("reversible presentation restoration", () => {
  let controller: PresentationController;

  beforeEach(() => {
    document.body.replaceChildren();
    resetPlaceholderAnnouncement();
    controller = new PresentationController();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it.each(MODES)(
    "keeps the original post and its content connected through apply, reveal and restore in %s mode",
    (mode) => {
      const { post, host } = makePost();

      controller.apply(post, strongAiResult(), settingsFor(mode));
      expect(post.isConnected).toBe(true);
      expect(host.isConnected).toBe(true);

      controller.reveal(post);
      expect(post.isConnected).toBe(true);
      expect(host.isConnected).toBe(true);
      expect(host.textContent).toBe("conteúdo original da publicação");

      controller.restore(post);
      expect(post.isConnected).toBe(true);
      expect(host.isConnected).toBe(true);
      expect(document.querySelectorAll("[data-cleanfeed-owned]")).toHaveLength(
        0,
      );
    },
  );

  it.each(MODES)(
    "restores the exact original attributes after apply and restore in %s mode",
    (mode) => {
      const { post } = makePost();
      post.className = "feed-item";
      post.style.display = "flex";
      post.setAttribute("aria-label", "Publicação de exemplo");
      const before = snapshotAttributes(post);

      controller.apply(post, strongAiResult(), settingsFor(mode));
      controller.restore(post);

      expect(snapshotAttributes(post)).toEqual(before);
    },
  );

  it("reveals a hidden post with the keyboard-operable placeholder button and keeps the badge until restore", () => {
    const { post } = makePost();

    controller.apply(post, strongAiResult(), settingsFor("hide"));
    expect(post).toHaveClass("cleanfeed-hidden");
    expect(post.getAttribute("aria-hidden")).toBe("true");

    const revealButton = screen.getByRole("button", {
      name: "Mostrar texto",
    });
    expect(revealButton.tagName).toBe("BUTTON");
    fireEvent.click(revealButton);

    expect(post).not.toHaveClass("cleanfeed-hidden");
    expect(post.getAttribute("aria-hidden")).toBeNull();
    expect(post.dataset.cleanfeedRevealed).toBe("true");
    expect(
      document.querySelector("[data-cleanfeed-owned='placeholder']"),
    ).toBeNull();
    expect(
      document.querySelector("[data-cleanfeed-owned='badge']"),
    ).not.toBeNull();

    controller.restore(post);
    expect(document.querySelector("[data-cleanfeed-owned]")).toBeNull();
  });

  it("moves focus to the badge when the reveal control is activated, not to <body>", () => {
    const { post } = makePost();

    controller.apply(post, strongAiResult(), settingsFor("hide"));
    const revealButton = screen.getByRole("button", {
      name: "Mostrar texto",
    });
    revealButton.focus();
    expect(document.activeElement).toBe(revealButton);

    fireEvent.click(revealButton);

    const badge = document.querySelector("[data-cleanfeed-owned='badge']");
    expect(badge).not.toBeNull();
    expect(document.activeElement).toBe(badge);
  });

  it("reveals a blurred post with the keyboard-operable toolbar button", () => {
    const { post, host } = makePost();

    controller.apply(post, strongAiResult(), settingsFor("blur"));
    expect(post).toHaveClass("cleanfeed-blurred");

    fireEvent.click(screen.getByRole("button", { name: "Mostrar texto" }));

    expect(post).not.toHaveClass("cleanfeed-blurred");
    expect(post.dataset.cleanfeedRevealed).toBe("true");
    expect(host.textContent).toBe("conteúdo original da publicação");
    expect(
      document.querySelector("[data-cleanfeed-owned='blur-toolbar']"),
    ).toBeNull();
  });

  it("never disconnects the original post node while clearing all presentation", () => {
    const first = makePost();
    const second = makePost();

    controller.apply(first.post, strongAiResult(), settingsFor("hide"));
    controller.apply(second.post, strongAiResult(), settingsFor("collapse"));

    controller.clearAll();

    expect(first.post.isConnected).toBe(true);
    expect(second.post.isConnected).toBe(true);
    expect(first.host.isConnected).toBe(true);
    expect(second.host.isConnected).toBe(true);
    expect(document.querySelectorAll("[data-cleanfeed-owned]")).toHaveLength(0);
  });
});
