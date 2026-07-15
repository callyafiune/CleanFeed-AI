import { normalizeText } from "@/shared/text-normalization";
import type { ExtractedPost } from "@/shared/types";
import { LINKEDIN_SELECTORS } from "@/platforms/linkedin/selectors";

/**
 * Extracts only commentary rendered inside a LinkedIn post. The optional
 * activity URN is useful during one page session, but callers must persist
 * only a content hash rather than this identifier.
 */
export function extractLinkedInPost(
  element: HTMLElement,
): ExtractedPost | null {
  const commentary = findCommentary(element);
  if (commentary === null) return null;

  const text = cleanCommentary(commentary);
  if (text.length === 0) return null;

  const postId = element.dataset.urn;
  return {
    platform: "linkedin",
    ...(postId === undefined ? {} : { postId }),
    text,
    element,
  };
}

export function findCommentary(element: HTMLElement): HTMLElement | null {
  for (const selector of LINKEDIN_SELECTORS.commentary) {
    const commentary = [
      ...element.querySelectorAll<HTMLElement>(selector),
    ].find((candidate) => isLinkedInPostDescendant(element, candidate));
    if (commentary !== undefined) return commentary;
  }

  return null;
}

/** Returns whether a DOM signal belongs to this post rather than a nested UI. */
export function isLinkedInPostDescendant(
  post: HTMLElement,
  candidate: HTMLElement,
): boolean {
  if (candidate.closest(LINKEDIN_SELECTORS.posts.join(",")) !== post) {
    return false;
  }

  let current: HTMLElement | null = candidate;
  while (current !== null && current !== post) {
    if (current.matches(LINKEDIN_SELECTORS.excludedAncestors.join(","))) {
      return false;
    }
    current = current.parentElement;
  }

  return current === post;
}

function cleanCommentary(commentary: HTMLElement): string {
  const clone = commentary.cloneNode(true) as HTMLElement;
  const removable = [
    ...LINKEDIN_SELECTORS.uiNoise,
    "a[href^='/in/']",
    "a[href*='linkedin.com/in/']",
  ].join(",");
  clone.querySelectorAll(removable).forEach((node) => node.remove());

  // textContent does not preserve visual paragraph boundaries. Mark block
  // boundaries in the private clone before reading it, never in page DOM.
  clone.querySelectorAll("p, div, li, blockquote, br").forEach((node) => {
    node.before("\n");
    node.after("\n");
  });

  const paragraphs = normalizeText(clone.textContent ?? "")
    .split("\n\n")
    .filter((paragraph) => paragraph.length > 0);
  return [...new Set(paragraphs)].join("\n\n");
}
