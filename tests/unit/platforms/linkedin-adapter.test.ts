import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
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
});
