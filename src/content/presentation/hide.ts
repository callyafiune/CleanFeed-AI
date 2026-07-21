import {
  insertRevealPlaceholder,
  PRESENTATION_MODE_CLASSES,
} from "@/content/presentation/restore";
import { PRESENTATION_COPY } from "@/shared/classification-copy";

const HIDE_CLASS = PRESENTATION_MODE_CLASSES.hide;
const HIDE_MESSAGE = PRESENTATION_COPY.hide.message;
const REVEAL_LABEL = PRESENTATION_COPY.hide.reveal;

/**
 * Hides the post behind an accessible placeholder without removing it from the
 * DOM. The original stays connected but is taken out of layout by CSS class and
 * hidden from assistive tech via `aria-hidden`; the placeholder carries the
 * reveal affordance. Returns an idempotent cleanup restoring the prior state.
 */
export function applyHide(
  element: HTMLElement,
  onReveal: () => void,
): () => void {
  const previousAriaHidden = element.getAttribute("aria-hidden");
  const previousInert = element.getAttribute("inert");
  element.classList.add(HIDE_CLASS);
  element.setAttribute("aria-hidden", "true");
  // `display: none` already drops descendants from focus and the a11y tree;
  // `inert` keeps the guarantee even if the class is overridden by page CSS.
  element.setAttribute("inert", "");

  const placeholder = insertRevealPlaceholder(
    element,
    {
      mode: "hide",
      className: "cleanfeed-placeholder cleanfeed-placeholder--hide",
      message: HIDE_MESSAGE,
      buttonLabel: REVEAL_LABEL,
    },
    onReveal,
  );

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    element.classList.remove(HIDE_CLASS);
    if (previousAriaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", previousAriaHidden);
    if (previousInert === null) element.removeAttribute("inert");
    else element.setAttribute("inert", previousInert);
    placeholder.remove();
  };
}
