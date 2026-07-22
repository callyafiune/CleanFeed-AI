/**
 * Structural selectors for the LinkedIn feed. Two generations coexist:
 *
 * - the legacy class-based markup (`.feed-shared-update-v2`, `.update-components-text`,
 *   `data-urn`), and
 * - the current Server-Driven UI (SDUI) markup, whose CSS classes are hashed and
 *   unusable, so it is anchored on stable attributes: `role`, `data-testid`,
 *   `data-component-type`, `aria-label`, and semantic `componentkey` prefixes.
 *
 * Entries are ADDITIVE: the SDUI anchors are added alongside the legacy ones so a
 * single build works across the rollout. The adapter/extractor logic is
 * selector-driven, so supporting a new DOM is (almost) entirely done here.
 */
export const LINKEDIN_SELECTORS = {
  feedRoots: [
    "main",
    "[role='main']",
    ".scaffold-finite-scroll__content",
    // SDUI
    "[data-testid='mainFeed']",
    "main#workspace",
  ],
  posts: [
    "article",
    "[data-urn^='urn:li:activity:']",
    ".feed-shared-update-v2",
    // SDUI: a feed update is a list item whose componentkey ends in the feed type.
    "[role='listitem'][componentkey*='FeedType_MAIN_FEED']",
  ],
  commentary: [
    // SDUI post body first (comments use `comment-commentary_`, excluded below).
    "[componentkey^='feed-commentary_']",
    "[data-test-id='main-feed-activity-card__commentary']",
    ".update-components-text",
    // Current SDUI expandable body, as a fallback when the wrapper above is
    // absent. Comment bodies use the same testid but live under an excluded
    // comment subtree, so `isLinkedInPostDescendant` still rejects them.
    "[data-testid='expandable-text-box']",
  ],
  uiNoise: [
    "button",
    "nav",
    "[role='menu']",
    "[aria-label*='reaction']",
    "time",
  ],
  actionRegions: [
    "[data-test-actions]",
    ".feed-shared-social-action-bar",
    ".social-actions",
    "[class*='social-actions']",
    "[data-control-name*='social']",
    // SDUI social action bar (post-level; comments use "Responder", not these).
    "[aria-label='Comentar']",
    "[aria-label='Compartilhar']",
    "[aria-label='Enviar']",
  ],
  excludedAncestors: [
    "[role='menu']",
    "[role='comment']",
    ".comments-comment-item",
    ".feed-shared-article",
    ".update-components-article",
    "[data-test-node='comment']",
    "[data-test-node='menu']",
    "[data-test-node='quoted']",
    "[data-quoted-post]",
    // SDUI comment subtrees, so a comment body is never taken as the post body.
    "[componentkey^='replaceableComment_']",
    "[componentkey^='comment-commentary_']",
    "[componentkey^='commentsSectionContainer']",
  ],
} as const;
