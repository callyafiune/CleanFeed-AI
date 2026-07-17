import {
  PRESENTATION_MODE_CLASSES,
  registerOwnedArtifact,
} from "@/content/presentation/restore";

const BLUR_CLASS = PRESENTATION_MODE_CLASSES.blur;
const REVEAL_LABEL = "Mostrar publicação";

/**
 * Blurs the post in place and adds a non-blurred reveal toolbar as an owned
 * sibling (kept outside the filtered element so it stays sharp and clickable).
 * The content is never removed. Returns an idempotent cleanup that removes the
 * class and the toolbar.
 */
export function applyBlur(
  element: HTMLElement,
  onReveal: () => void,
): () => void {
  element.classList.add(BLUR_CLASS);

  const doc = element.ownerDocument;
  const toolbar = doc.createElement("div");
  toolbar.className = "cleanfeed-blur-toolbar";
  toolbar.dataset.cleanfeedOwned = "blur-toolbar";

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "cleanfeed-reveal";
  button.textContent = REVEAL_LABEL;
  button.addEventListener("click", () => {
    onReveal();
  });
  toolbar.append(button);

  element.parentNode?.insertBefore(toolbar, element);
  registerOwnedArtifact(element, toolbar);

  let cleaned = false;
  return () => {
    if (cleaned) return;
    cleaned = true;
    element.classList.remove(BLUR_CLASS);
    toolbar.remove();
  };
}
