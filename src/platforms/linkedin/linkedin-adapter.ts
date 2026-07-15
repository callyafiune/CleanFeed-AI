import {
  extractLinkedInPost,
  findCommentary,
  isLinkedInPostDescendant,
} from "@/platforms/linkedin/extractor";
import {
  applyLinkedInPresentation,
  restoreLinkedInPresentation,
} from "@/platforms/linkedin/presenter";
import { LINKEDIN_SELECTORS } from "@/platforms/linkedin/selectors";
import type { EffectiveSettings } from "@/shared/settings-types";
import type {
  ClassificationResult,
  ExtractedPost,
  PlatformAdapter,
} from "@/shared/types";

export class LinkedInAdapter implements PlatformAdapter {
  readonly id = "linkedin";

  matches(url: URL): boolean {
    const host = url.hostname.toLowerCase();
    return host === "linkedin.com" || host.endsWith(".linkedin.com");
  }

  findFeedRoot(document: Document): HTMLElement | null {
    for (const selector of LINKEDIN_SELECTORS.feedRoots) {
      const root = document.querySelector<HTMLElement>(selector);
      if (root !== null) return root;
    }
    return null;
  }

  findPostElements(root: ParentNode): HTMLElement[] {
    const candidates = new Set<HTMLElement>();
    for (const selector of LINKEDIN_SELECTORS.posts) {
      if (root instanceof HTMLElement && root.matches(selector))
        candidates.add(root);
      root.querySelectorAll<HTMLElement>(selector).forEach((element) => {
        candidates.add(element);
      });
    }
    return [...candidates].filter((element) => this.isPostElement(element));
  }

  extractPost(element: HTMLElement): ExtractedPost | null {
    return this.isPostElement(element) ? extractLinkedInPost(element) : null;
  }

  applyPresentation(
    element: HTMLElement,
    result: ClassificationResult,
    settings: EffectiveSettings,
  ): void {
    applyLinkedInPresentation(element, result, settings);
  }

  restorePresentation(element: HTMLElement): void {
    restoreLinkedInPresentation(element);
  }

  isPostElement(element: HTMLElement): boolean {
    if (!element.matches(LINKEDIN_SELECTORS.posts.join(","))) return false;
    if (isExcluded(element)) return false;
    return findCommentary(element) !== null && hasActionRegion(element);
  }
}

function isExcluded(element: HTMLElement): boolean {
  return LINKEDIN_SELECTORS.excludedAncestors.some(
    (selector) =>
      element.matches(selector) || element.closest(selector) !== null,
  );
}

function hasActionRegion(element: HTMLElement): boolean {
  return [
    ...element.querySelectorAll<HTMLElement>(
      LINKEDIN_SELECTORS.actionRegions.join(","),
    ),
  ].some((actionRegion) => isLinkedInPostDescendant(element, actionRegion));
}
