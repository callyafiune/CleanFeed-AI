import { PresentationController } from "@/content/presentation/presentation-controller";
import {
  extractLinkedInPost,
  findCommentary,
  isLinkedInPostDescendant,
} from "@/platforms/linkedin/extractor";
import { LINKEDIN_SELECTORS } from "@/platforms/linkedin/selectors";
import type { EffectiveSettings } from "@/shared/settings-types";
import type {
  ClassificationResult,
  ExtractedPost,
  PlatformAdapter,
} from "@/shared/types";

/**
 * LinkedIn adapter. Site-specific DOM knowledge (selectors, extraction) lives
 * here; the reversible visual treatment is NOT reimplemented — it is delegated
 * to the shared {@link PresentationController}, exactly as
 * docs/platform-adapters.md requires. The controller owns the class + accessible
 * placeholder, the reveal affordance and the byte-for-byte restore, so a
 * promoted decision that authorizes an action actually blurs/collapses/hides the
 * post (and a fail-closed decision presents nothing).
 */
export class LinkedInAdapter implements PlatformAdapter {
  readonly id = "linkedin";

  private readonly presentation: PresentationController;

  constructor(
    presentation: PresentationController = new PresentationController(),
  ) {
    this.presentation = presentation;
  }

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
    // The shared controller owns the reversible marking: it resolves the mode
    // from the decision's action ceiling and the user preference, applies the
    // class + accessible placeholder for blur/collapse/hide, and restores a post
    // whose decision no longer authorizes presentation (fail-closed).
    this.presentation.apply(element, result, settings);
  }

  restorePresentation(element: HTMLElement): void {
    this.presentation.restore(element);
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
