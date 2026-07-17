import "@testing-library/jest-dom/vitest";
import { fireEvent, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { applyBlur } from "@/content/presentation/blur";
import { applyCollapse } from "@/content/presentation/collapse";
import { applyHide } from "@/content/presentation/hide";
import { PresentationController } from "@/content/presentation/presentation-controller";
import {
  rememberPresentation,
  resetPlaceholderAnnouncement,
  revealPost,
} from "@/content/presentation/restore";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { EffectiveSettings } from "@/shared/settings-types";
import type { ClassificationResult, PresentationMode } from "@/shared/types";

const COLLAPSE_COPY =
  "Publicação recolhida por apresentar fortes indícios de geração por IA.";
const HIDE_COPY = "Uma publicação foi ocultada pelo filtro.";

function makePost(): HTMLElement {
  const container = document.createElement("div");
  const post = document.createElement("article");
  const host = document.createElement("div");
  host.setAttribute("data-host-node", "");
  host.textContent = "conteúdo original";
  post.append(host);
  container.append(post);
  document.body.append(container);
  return post;
}

function strongAiResult(): ClassificationResult {
  return {
    aiScore: 0.98,
    humanScore: 0.02,
    confidence: "high",
    status: "strong_ai_indication",
    wordCount: 140,
    tokenCount: 150,
    modelVersion: "mock-v1",
    modelId: "mock",
    backend: "mock",
    processingTimeMs: 4,
    demo: true,
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

describe("presentation modes", () => {
  beforeEach(() => {
    document.body.replaceChildren();
    resetPlaceholderAnnouncement();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  describe("blur", () => {
    it("blur leaves content in place and exposes an immediate reveal button", () => {
      const post = makePost();
      const onReveal = vi.fn();

      applyBlur(post, onReveal);

      expect(post).toHaveClass("cleanfeed-blurred");
      expect(post.querySelector("[data-host-node]")?.textContent).toBe(
        "conteúdo original",
      );
      const button = screen.getByRole("button", { name: "Mostrar publicação" });
      expect(button.tagName).toBe("BUTTON");
      fireEvent.click(button);
      expect(onReveal).toHaveBeenCalledOnce();
    });

    it("keeps the reveal toolbar outside the blurred element so it is never filtered", () => {
      const post = makePost();

      applyBlur(post, vi.fn());

      const button = screen.getByRole("button", { name: "Mostrar publicação" });
      expect(post.contains(button)).toBe(false);
    });

    it("returns an idempotent cleanup that removes the class and toolbar", () => {
      const post = makePost();

      const cleanup = applyBlur(post, vi.fn());
      cleanup();
      cleanup();

      expect(post).not.toHaveClass("cleanfeed-blurred");
      expect(
        screen.queryByRole("button", { name: "Mostrar publicação" }),
      ).toBeNull();
    });
  });

  describe.each([
    ["collapse", applyCollapse, COLLAPSE_COPY] as const,
    ["hide", applyHide, HIDE_COPY] as const,
  ])("%s", (mode, applyMode, copy) => {
    it("keeps the original post connected behind an accessible placeholder", () => {
      const post = makePost();

      applyMode(post, vi.fn());

      expect(post).toBeInTheDocument();
      expect(post.querySelector("[data-host-node]")?.isConnected).toBe(true);
      expect(post.getAttribute("aria-hidden")).toBe("true");
      // inert removes the (possibly clipped) subtree from the tab order and the
      // accessibility tree, so no descendant is focusable inside aria-hidden.
      expect(post.getAttribute("inert")).toBe("");
      expect(screen.getByText(copy)).toBeVisible();
      expect(
        screen.getByRole("button", { name: "Mostrar conteúdo" }),
      ).toBeVisible();
    });

    it("inserts the placeholder as an owned sibling immediately before the post", () => {
      const post = makePost();

      applyMode(post, vi.fn());

      const placeholder = post.previousElementSibling;
      expect(placeholder?.getAttribute("data-cleanfeed-owned")).toBe(
        "placeholder",
      );
      expect(placeholder?.getAttribute("data-cleanfeed-mode")).toBe(mode);
    });

    it("invokes the reveal callback from the placeholder button", () => {
      const post = makePost();
      const onReveal = vi.fn();

      applyMode(post, onReveal);
      fireEvent.click(screen.getByRole("button", { name: "Mostrar conteúdo" }));

      expect(onReveal).toHaveBeenCalledOnce();
    });

    it("returns an idempotent cleanup that removes the class, aria-hidden, inert and placeholder", () => {
      const post = makePost();

      const cleanup = applyMode(post, vi.fn());
      cleanup();
      cleanup();

      expect(post.getAttribute("aria-hidden")).toBeNull();
      expect(post.getAttribute("inert")).toBeNull();
      expect(
        document.querySelector("[data-cleanfeed-owned='placeholder']"),
      ).toBeNull();
    });
  });

  it("announces only the first placeholder to assistive technology", () => {
    const first = makePost();
    const second = makePost();

    applyHide(first, vi.fn());
    applyCollapse(second, vi.fn());

    const placeholders = document.querySelectorAll(
      "[data-cleanfeed-owned='placeholder']",
    );
    expect(placeholders[0]?.getAttribute("aria-live")).toBe("polite");
    expect(placeholders[1]?.getAttribute("aria-live")).toBeNull();
  });

  it("revealPost drops the visual treatment and owned nodes while restoring aria-hidden", () => {
    const post = makePost();
    rememberPresentation(post);

    applyHide(post, vi.fn());
    expect(post.getAttribute("aria-hidden")).toBe("true");
    expect(post.getAttribute("inert")).toBe("");

    revealPost(post);

    expect(post).not.toHaveClass("cleanfeed-hidden");
    expect(post.getAttribute("aria-hidden")).toBeNull();
    expect(post.getAttribute("inert")).toBeNull();
    expect(
      document.querySelector("[data-cleanfeed-owned='placeholder']"),
    ).toBeNull();
    expect(post.querySelector("[data-host-node]")?.isConnected).toBe(true);
  });

  describe("through the controller", () => {
    let controller: PresentationController;

    beforeEach(() => {
      controller = new PresentationController();
    });

    it.each([
      ["collapse", COLLAPSE_COPY],
      ["hide", HIDE_COPY],
    ] as const)(
      "%s keeps the original post connected behind an accessible placeholder",
      (mode, copy) => {
        const post = makePost();

        controller.apply(post, strongAiResult(), settingsFor(mode));

        expect(post).toBeInTheDocument();
        expect(screen.getByText(copy)).toBeVisible();
        expect(
          screen.getByRole("button", { name: "Mostrar conteúdo" }),
        ).toBeVisible();
      },
    );

    it("restores original inline styles and aria attributes exactly", () => {
      const post = makePost();
      post.className = "feed-item layout";
      post.style.display = "flex";
      post.style.color = "rgb(1, 2, 3)";
      post.setAttribute("aria-label", "Publicação");
      const before = snapshotAttributes(post);

      controller.apply(post, strongAiResult(), settingsFor("hide"));
      controller.restore(post);

      expect(snapshotAttributes(post)).toEqual(before);
    });

    it("preserves a pre-existing aria-hidden value across apply and restore", () => {
      const post = makePost();
      post.setAttribute("aria-hidden", "false");
      const before = snapshotAttributes(post);

      controller.apply(post, strongAiResult(), settingsFor("collapse"));
      expect(post.getAttribute("aria-hidden")).toBe("true");

      controller.restore(post);
      expect(snapshotAttributes(post)).toEqual(before);
      expect(post.getAttribute("aria-hidden")).toBe("false");
    });
  });
});
