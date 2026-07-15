export const LINKEDIN_SELECTORS = {
  feedRoots: ["main", "[role='main']", ".scaffold-finite-scroll__content"],
  posts: [
    "article",
    "[data-urn^='urn:li:activity:']",
    ".feed-shared-update-v2",
  ],
  commentary: [
    "[data-test-id='main-feed-activity-card__commentary']",
    ".update-components-text",
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
  ],
} as const;
