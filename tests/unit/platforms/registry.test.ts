import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";

import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";
import { PlatformRegistry } from "@/platforms/registry";
import type { PlatformAdapter } from "@/shared/types";

const fixturePath = resolve(
  process.cwd(),
  "tests/fixtures/generic-adapter.html",
);

/**
 * A sample third-party adapter that lives ONLY in this test — it is never part
 * of the production bundle. It exists to prove that PlatformRegistry is the
 * sole extension point a new platform needs. A real adapter would delegate
 * `applyPresentation`/`restorePresentation` to the shared PresentationController
 * (see docs/platform-adapters.md); here those hooks are unused stubs because
 * these cases only exercise matching and extraction.
 */
const genericAdapter: PlatformAdapter = {
  id: "generic-test",
  matches(url) {
    return url.hostname === "forum.example";
  },
  findFeedRoot(document) {
    return document.querySelector<HTMLElement>("[data-test-root='thread']");
  },
  findPostElements(root) {
    return [...root.querySelectorAll<HTMLElement>(".thread-post")];
  },
  isPostElement(element) {
    return element.matches(".thread-post");
  },
  extractPost(element) {
    const body = element.querySelector<HTMLElement>(".post-body");
    const text = body?.textContent?.trim() ?? "";
    if (text.length === 0) return null;
    return { platform: "generic-test", text, element };
  },
  applyPresentation() {
    // Real adapters delegate to the shared PresentationController.
  },
  restorePresentation() {
    // Real adapters delegate to the shared PresentationController.
  },
};

describe("PlatformRegistry", () => {
  const linkedinAdapter = new LinkedInAdapter();
  let fixturePost: HTMLElement;

  beforeAll(async () => {
    const document = new DOMParser().parseFromString(
      await readFile(fixturePath, "utf8"),
      "text/html",
    );
    const post = document.querySelector<HTMLElement>(".thread-post");
    if (post === null) throw new Error("Missing generic post fixture");
    fixturePost = post;
  });

  it("adds a new platform through registration only", async () => {
    const registry = new PlatformRegistry([linkedinAdapter]);
    registry.register(genericAdapter);
    expect(registry.match(new URL("https://forum.example/thread/1"))?.id).toBe(
      "generic-test",
    );
    const result = registry
      .match(new URL("https://forum.example/thread/1"))!
      .extractPost(fixturePost);
    expect(result).toMatchObject({
      platform: "generic-test",
      text: expect.any(String),
    });
  });

  it("rejects duplicate adapter IDs", () => {
    const registry = new PlatformRegistry([linkedinAdapter]);
    expect(() =>
      registry.register({ ...genericAdapter, id: "linkedin" }),
    ).toThrow();
  });

  it("keeps matching the built-in LinkedIn adapter after registration", () => {
    const registry = new PlatformRegistry([linkedinAdapter]);
    registry.register(genericAdapter);
    expect(registry.match(new URL("https://www.linkedin.com/feed/"))?.id).toBe(
      "linkedin",
    );
    expect(registry.match(new URL("https://example.com/"))).toBeNull();
  });

  it("looks up a registered adapter by id", () => {
    const registry = new PlatformRegistry([linkedinAdapter]);
    registry.register(genericAdapter);
    expect(registry.get("generic-test")).toBe(genericAdapter);
    expect(registry.get("linkedin")).toBe(linkedinAdapter);
    expect(registry.get("unknown")).toBeNull();
  });

  it("rejects duplicate IDs supplied to the constructor", () => {
    expect(
      () => new PlatformRegistry([linkedinAdapter, linkedinAdapter]),
    ).toThrow();
  });
});
