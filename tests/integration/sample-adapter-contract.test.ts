import { afterEach, describe, expect, it } from "vitest";

import { PresentationController } from "@/content/presentation/presentation-controller";
import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";
import { PlatformRegistry } from "@/platforms/registry";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { EffectiveSettings } from "@/shared/settings-types";
import type {
  ClassificationResult,
  ExtractedPost,
  PlatformAdapter,
} from "@/shared/types";

/**
 * A fictional forum adapter that exists ONLY in this test; it is never imported
 * by any production code path. This test's whole purpose is to prove that a
 * brand-new platform can be added through `PlatformRegistry.register` ALONE —
 * without editing a single inference, storage or presentation core module. The
 * only shared collaborator it touches is the PresentationController, which it
 * reuses (never edits) exactly as docs/platform-adapters.md requires.
 */
class SampleForumAdapter implements PlatformAdapter {
  readonly id = "sample-forum";

  constructor(private readonly presentation: PresentationController) {}

  matches(url: URL): boolean {
    return url.hostname === "forum.example";
  }

  findFeedRoot(document: Document): HTMLElement | null {
    return document.querySelector<HTMLElement>("[data-test-root='thread']");
  }

  findPostElements(root: ParentNode): HTMLElement[] {
    return [...root.querySelectorAll<HTMLElement>(".thread-post")];
  }

  isPostElement(element: HTMLElement): boolean {
    return element.matches(".thread-post");
  }

  extractPost(element: HTMLElement): ExtractedPost | null {
    const body = element.querySelector<HTMLElement>(".post-body");
    const text = body?.textContent?.trim() ?? "";
    if (text.length === 0) return null;
    return { platform: this.id, text, element };
  }

  applyPresentation(
    element: HTMLElement,
    result: ClassificationResult,
    settings: EffectiveSettings,
  ): void {
    this.presentation.apply(element, result, settings);
  }

  restorePresentation(element: HTMLElement): void {
    this.presentation.restore(element);
  }
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

function makeThreadPost(): HTMLElement {
  document.body.replaceChildren();
  const root = document.createElement("main");
  root.setAttribute("data-test-root", "thread");
  const post = document.createElement("article");
  post.className = "thread-post";
  const body = document.createElement("div");
  body.className = "post-body";
  body.textContent = "conteudo do forum gerado para o teste de contrato.";
  post.append(body);
  root.append(post);
  document.body.append(root);
  return post;
}

describe("sample adapter contract", () => {
  afterEach(() => {
    document.body.replaceChildren();
  });

  it("registers a brand-new platform through registration alone", () => {
    const registry = new PlatformRegistry([new LinkedInAdapter()]);
    const adapter = new SampleForumAdapter(new PresentationController());

    // Registration is the ONLY wiring step; no core module is edited.
    registry.register(adapter);

    const forumUrl = new URL("https://forum.example/thread/42");
    expect(registry.match(forumUrl)?.id).toBe("sample-forum");
    // The built-in adapter still wins on its own host after registration.
    expect(registry.match(new URL("https://www.linkedin.com/feed/"))?.id).toBe(
      "linkedin",
    );

    const matched = registry.match(forumUrl);
    expect(matched).not.toBeNull();
    const extracted = matched!.extractPost(makeThreadPost());
    expect(extracted).toMatchObject({
      platform: "sample-forum",
      text: expect.any(String),
    });
  });

  it("delegates presentation to the shared PresentationController", () => {
    const registry = new PlatformRegistry([new LinkedInAdapter()]);
    const adapter = new SampleForumAdapter(new PresentationController());
    registry.register(adapter);

    const post = makeThreadPost();
    const settings: EffectiveSettings = {
      ...DEFAULT_SETTINGS,
      presentationMode: "blur",
    };

    adapter.applyPresentation(post, strongAiResult(), settings);
    // The shared controller — not the adapter — owns the reversible marking.
    expect(post.dataset.cleanfeedStatus).toBe("strong_ai_indication");
    expect(post.classList.contains("cleanfeed-blurred")).toBe(true);

    adapter.restorePresentation(post);
    expect(post.dataset.cleanfeedStatus).toBeUndefined();
    expect(post.classList.contains("cleanfeed-blurred")).toBe(false);
  });
});
