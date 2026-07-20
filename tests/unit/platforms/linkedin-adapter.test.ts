import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ClassificationResult, PresentationMode } from "@/shared/types";
import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";
import { PlatformRegistry } from "@/platforms/registry";

const fixturePath = resolve(process.cwd(), "tests/fixtures/linkedin-feed.html");

describe("LinkedInAdapter", () => {
  const adapter = new LinkedInAdapter();
  let fixture: Document;

  beforeAll(async () => {
    fixture = new DOMParser().parseFromString(
      await readFile(fixturePath, "utf8"),
      "text/html",
    );
  });

  function getPost(id: string): HTMLElement {
    const post = fixture.querySelector<HTMLElement>(`[data-test-post='${id}']`);
    if (post === null) throw new Error(`Missing post fixture: ${id}`);
    return post;
  }

  it("extracts only the post commentary text", () => {
    const extracted = adapter.extractPost(getPost("long"));
    expect(extracted).not.toBeNull();
    expect(extracted?.platform).toBe("linkedin");
    expect(extracted?.text).toContain("parágrafo principal");
    expect(extracted?.text).not.toMatch(
      /Curtir|Comentar|Compartilhar|Enviar|123 comentários/u,
    );
  });

  it.each(["menu", "comment", "author", "error-banner"])(
    "does not treat %s as a post",
    (id) => {
      const element = fixture.querySelector<HTMLElement>(
        `[data-test-node='${id}']`,
      );
      expect(element).not.toBeNull();
      expect(adapter.isPostElement(element!)).toBe(false);
    },
  );

  it("supports sponsored, reposted and expanded variants without duplicating text", () => {
    for (const id of ["sponsored", "repost", "expanded"]) {
      const result = adapter.extractPost(getPost(id));
      expect(result?.text.length).toBeGreaterThan(0);
      const paragraphs = result?.text.split("\n\n") ?? [];
      expect(new Set(paragraphs).size).toBe(paragraphs.length);
    }
  });

  it.each([
    "short",
    "hundred-words",
    "long",
    "paragraphs",
    "emoji",
    "links",
    "sponsored",
    "repost",
    "expanded",
    "removed-reinserted",
    "stylistic-false-positive",
    "formal-human",
  ])("finds the %s post in the feed", (id) => {
    const root = adapter.findFeedRoot(fixture);
    expect(root).not.toBeNull();
    expect(adapter.findPostElements(root!)).toContain(getPost(id));
    expect(adapter.extractPost(getPost(id))?.text).not.toHaveLength(0);
  });

  it("matches only LinkedIn URLs through the registry", () => {
    const registry = new PlatformRegistry([adapter]);
    expect(registry.match(new URL("https://www.linkedin.com/feed/"))).toBe(
      adapter,
    );
    expect(registry.match(new URL("https://example.com/feed/"))).toBeNull();
  });

  it("rejects a wrapper whose only commentary and actions belong to a comment", () => {
    const document = new DOMParser().parseFromString(
      `<article data-urn="urn:li:activity:wrapper">
        <div role="comment">
          <div class="update-components-text">Texto de comentário.</div>
          <div data-test-actions><button>Curtir</button></div>
        </div>
      </article>`,
      "text/html",
    );
    const wrapper = document.querySelector<HTMLElement>("article")!;

    expect(adapter.isPostElement(wrapper)).toBe(false);
    expect(adapter.extractPost(wrapper)).toBeNull();
  });

  it("does not include excluded nested content inside otherwise valid commentary", () => {
    const document = new DOMParser().parseFromString(
      `<article data-urn="urn:li:activity:valid">
        <div class="update-components-text">
          Texto editorial que deve permanecer.
          <div role="comment">Comentário aninhado que deve sumir.</div>
          <div data-test-node="quoted">Citação aninhada que deve sumir.</div>
          <div role="menu">Menu aninhado que deve sumir.</div>
        </div>
        <div data-test-actions><button>Curtir</button></div>
      </article>`,
      "text/html",
    );
    const post = document.querySelector<HTMLElement>("article")!;

    const extracted = adapter.extractPost(post);
    expect(extracted?.text).toContain("Texto editorial que deve permanecer.");
    expect(extracted?.text).not.toContain("Comentário aninhado");
    expect(extracted?.text).not.toContain("Citação aninhada");
    expect(extracted?.text).not.toContain("Menu aninhado");
  });
});

describe("LinkedInAdapter presentation", () => {
  const adapter = new LinkedInAdapter();

  afterEach(() => {
    document.body.replaceChildren();
  });

  function createPost(): HTMLElement {
    const element = document.createElement("article");
    document.body.append(element);
    return element;
  }

  function result(aiScore: number): ClassificationResult {
    return {
      aiScore,
      humanScore: 1 - aiScore,
      confidence: "medium",
      status: "possibly_ai",
      wordCount: 100,
      tokenCount: 100,
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
        status: "possibly_ai",
        calibratedScore: aiScore,
        actionCeiling: "hide",
        abstained: false,
        presentationAllowed: true,
        triggers: [],
        reasonCodes: [],
      },
      modelVersion: "test",
      modelId: "test",
      backend: "mock",
      processingTimeMs: 1,
      demo: true,
    };
  }

  function settings(presentationMode: PresentationMode) {
    return { ...DEFAULT_SETTINGS, presentationMode, markingThreshold: 0.8 };
  }

  it("is idempotent when presentation is applied repeatedly", () => {
    const element = createPost();
    adapter.applyPresentation(element, result(0.9), settings("blur"));
    adapter.applyPresentation(element, result(0.9), settings("blur"));

    expect(element.style.filter).toBe("blur(5px)");
    expect(
      document.querySelectorAll("[data-cleanfeed-indicator='true']"),
    ).toHaveLength(1);
    expect(
      element.querySelector("[data-cleanfeed-indicator='true']"),
    ).toBeNull();
    expect(
      element.previousElementSibling?.getAttribute("data-cleanfeed-indicator"),
    ).toBe("true");
  });

  it("reconciles every style while transitioning presentation modes", () => {
    const element = createPost();
    element.style.filter = "brightness(0.9)";
    element.style.maxHeight = "12rem";
    element.style.overflow = "auto";

    adapter.applyPresentation(element, result(0.9), settings("blur"));
    adapter.applyPresentation(element, result(0.9), settings("collapse"));
    expect(element.style.filter).toBe("brightness(0.9)");
    expect(element.style.maxHeight).toBe("6rem");
    expect(element.style.overflow).toBe("hidden");

    adapter.applyPresentation(element, result(0.9), settings("indicator"));
    expect(element.style.maxHeight).toBe("12rem");
    expect(element.style.overflow).toBe("auto");

    adapter.applyPresentation(element, result(0.9), settings("hide"));
    expect(element.style.display).toBe("none");
    expect(element.style.filter).toBe("brightness(0.9)");
  });

  it("restores a previously presented post when its score stops qualifying", () => {
    const element = createPost();
    element.style.display = "grid";
    element.style.filter = "contrast(1.1)";

    adapter.applyPresentation(element, result(0.9), settings("blur"));
    adapter.applyPresentation(element, result(0.2), settings("blur"));

    expect(element.style.display).toBe("grid");
    expect(element.style.filter).toBe("contrast(1.1)");
    expect(element.dataset.cleanfeedStatus).toBeUndefined();
    expect(
      document.querySelector("[data-cleanfeed-indicator='true']"),
    ).toBeNull();
  });
});
