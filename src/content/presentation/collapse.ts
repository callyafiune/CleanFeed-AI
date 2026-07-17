import {
  insertRevealPlaceholder,
  PRESENTATION_MODE_CLASSES,
} from "@/content/presentation/restore";

const COLLAPSE_CLASS = PRESENTATION_MODE_CLASSES.collapse;
const COLLAPSE_MESSAGE =
  "Publicação recolhida por apresentar fortes indícios de geração por IA.";
const REVEAL_LABEL = "Mostrar conteúdo";

/**
 * Collapses the post behind an accessible placeholder without touching its
 * content. The original stays connected but is clipped by CSS class and hidden
 * from assistive tech via `aria-hidden`; the placeholder carries the reveal
 * affordance. Returns an idempotent cleanup restoring the pre-collapse state.
 */
export function applyCollapse(
  element: HTMLElement,
  onReveal: () => void,
): () => void {
  const previousAriaHidden = element.getAttribute("aria-hidden");
  const previousInert = element.getAttribute("inert");
  element.classList.add(COLLAPSE_CLASS);
  element.setAttribute("aria-hidden", "true");
  // `overflow: hidden` only clips; descendants below the fold stay focusable,
  // which inside an aria-hidden subtree is a keyboard trap. `inert` removes the
  // whole subtree from the tab order and the accessibility tree.
  element.setAttribute("inert", "");

  const placeholder = insertRevealPlaceholder(
    element,
    {
      mode: "collapse",
      className: "cleanfeed-placeholder cleanfeed-placeholder--collapse",
      message: COLLAPSE_MESSAGE,
      buttonLabel: REVEAL_LABEL,
    },
    onReveal,
  );

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    element.classList.remove(COLLAPSE_CLASS);
    if (previousAriaHidden === null) element.removeAttribute("aria-hidden");
    else element.setAttribute("aria-hidden", previousAriaHidden);
    if (previousInert === null) element.removeAttribute("inert");
    else element.setAttribute("inert", previousInert);
    placeholder.remove();
  };
}
