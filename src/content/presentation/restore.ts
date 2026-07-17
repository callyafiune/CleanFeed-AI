import { removeBadge } from "@/content/presentation/badge";
import type { PresentationMode } from "@/shared/types";

/** CSS classes the PresentationController toggles on an owned post element. */
export const PRESENTATION_MODE_CLASSES: Record<
  Exclude<PresentationMode, "indicator">,
  string
> = {
  blur: "cleanfeed-blurred",
  collapse: "cleanfeed-collapsed",
  hide: "cleanfeed-hidden",
};

/**
 * Every attribute CleanFeed may overwrite on the host post. Storing the whole
 * `class`/`style` string (and the presence of `aria-hidden`/`hidden`) lets us
 * restore the node byte-for-byte, including the case where an attribute was
 * absent and must not be left behind as an empty string.
 */
interface PresentationSnapshot {
  classAttribute: string | null;
  styleAttribute: string | null;
  ariaHidden: string | null;
  hidden: string | null;
  inert: string | null;
}

const originals = new WeakMap<HTMLElement, PresentationSnapshot>();

/** Extension-owned scaffolding (toolbars, placeholders) attached to a post. */
const artifacts = new WeakMap<HTMLElement, Set<HTMLElement>>();

/**
 * True exactly once per session, so a screen reader announces the filtering a
 * single time instead of once per hidden post in a long feed.
 */
let placeholderAnnounced = false;

/** Reserves the one-shot polite announcement for the first placeholder shown. */
export function claimPlaceholderAnnouncement(): boolean {
  if (placeholderAnnounced) return false;
  placeholderAnnounced = true;
  return true;
}

/** Test/session helper: forget that a placeholder has already announced. */
export function resetPlaceholderAnnouncement(): void {
  placeholderAnnounced = false;
}

/** Records an extension-owned node so restore/reveal can remove exactly it. */
export function registerOwnedArtifact(
  element: HTMLElement,
  node: HTMLElement,
): void {
  let owned = artifacts.get(element);
  if (owned === undefined) {
    owned = new Set();
    artifacts.set(element, owned);
  }
  owned.add(node);
}

/** Removes every owned scaffolding node; safe to call repeatedly. */
export function removeOwnedArtifacts(element: HTMLElement): void {
  const owned = artifacts.get(element);
  if (owned === undefined) return;
  for (const node of owned) node.remove();
  artifacts.delete(element);
}

function setOrRemoveAttribute(
  element: HTMLElement,
  name: string,
  value: string | null,
): void {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

export function rememberPresentation(element: HTMLElement): void {
  if (originals.has(element)) return;
  originals.set(element, {
    classAttribute: element.getAttribute("class"),
    styleAttribute: element.getAttribute("style"),
    ariaHidden: element.getAttribute("aria-hidden"),
    hidden: element.getAttribute("hidden"),
    inert: element.getAttribute("inert"),
  });
}

/** Removes only the CleanFeed mode classes; safe when none are present. */
export function removePresentationClasses(element: HTMLElement): void {
  for (const className of Object.values(PRESENTATION_MODE_CLASSES)) {
    element.classList.remove(className);
  }
}

function restoreSnapshotAttributes(element: HTMLElement): void {
  const original = originals.get(element);
  if (original === undefined) {
    // No snapshot to restore against: defensively drop only our own classes.
    removePresentationClasses(element);
    return;
  }
  setOrRemoveAttribute(element, "class", original.classAttribute);
  setOrRemoveAttribute(element, "style", original.styleAttribute);
  setOrRemoveAttribute(element, "aria-hidden", original.ariaHidden);
  setOrRemoveAttribute(element, "hidden", original.hidden);
  setOrRemoveAttribute(element, "inert", original.inert);
}

/** Resets a currently presented element but keeps its original snapshot. */
export function resetPresentation(element: HTMLElement): void {
  restoreSnapshotAttributes(element);
  delete element.dataset.cleanfeedStatus;
  delete element.dataset.cleanfeedScore;
  delete element.dataset.cleanfeedRevealed;
  removeBadge(element);
  removeOwnedArtifacts(element);
}

/** Removes only modifications owned by CleanFeed; safe to call repeatedly. */
export function restorePresentation(element: HTMLElement): void {
  resetPresentation(element);
  originals.delete(element);
}

/**
 * Drops only the visual treatment, keeping the badge marking. The content
 * becomes visible and as accessible as it was originally: mode classes and
 * owned scaffolding go away and `aria-hidden`/`hidden` return to their
 * pre-presentation values.
 */
export function revealPost(element: HTMLElement): void {
  const original = originals.get(element);
  if (original !== undefined) {
    setOrRemoveAttribute(element, "aria-hidden", original.ariaHidden);
    setOrRemoveAttribute(element, "hidden", original.hidden);
    setOrRemoveAttribute(element, "inert", original.inert);
  }
  removePresentationClasses(element);
  removeOwnedArtifacts(element);
}

export interface RevealPlaceholderOptions {
  mode: Exclude<PresentationMode, "indicator">;
  className: string;
  message: string;
  buttonLabel: string;
}

/**
 * Builds an extension-owned, keyboard-operable placeholder announcing that a
 * post was filtered and inserts it immediately before the post. Text is set via
 * `textContent` (never HTML). Only the first placeholder of a session gets a
 * polite live region so assistive tech is not flooded. The node is registered
 * as owned so restore/reveal remove it automatically.
 */
export function insertRevealPlaceholder(
  element: HTMLElement,
  options: RevealPlaceholderOptions,
  onReveal: () => void,
): HTMLElement {
  const doc = element.ownerDocument;
  const placeholder = doc.createElement("section");
  placeholder.className = options.className;
  placeholder.dataset.cleanfeedOwned = "placeholder";
  placeholder.dataset.cleanfeedMode = options.mode;
  if (claimPlaceholderAnnouncement()) {
    placeholder.setAttribute("aria-live", "polite");
  }

  const message = doc.createElement("p");
  message.className = "cleanfeed-placeholder__message";
  message.textContent = options.message;

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "cleanfeed-reveal";
  button.textContent = options.buttonLabel;
  button.addEventListener("click", () => {
    onReveal();
  });

  // Insert the (empty) placeholder first, then append its content, so a polite
  // live region announces the change: assistive tech does not announce the
  // initial content of a region that is already populated when inserted.
  element.parentNode?.insertBefore(placeholder, element);
  placeholder.append(message, button);
  registerOwnedArtifact(element, placeholder);
  return placeholder;
}
