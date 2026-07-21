import {
  PRESENTATION_MODE_CLASSES,
  registerOwnedArtifact,
} from "@/content/presentation/restore";
import { PRESENTATION_COPY } from "@/shared/classification-copy";

const BLUR_CLASS = PRESENTATION_MODE_CLASSES.blur;
const BLUR_COPY = PRESENTATION_COPY.blur;

/**
 * Blurs the post in place and adds a non-blurred reveal toolbar as an owned
 * sibling (kept outside the filtered element so it stays sharp and clickable).
 * The toolbar carries the probabilistic reason and the "Mostrar texto" control.
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

  const message = doc.createElement("p");
  message.className = "cleanfeed-blur-toolbar__message";
  message.textContent = BLUR_COPY.message;

  const button = doc.createElement("button");
  button.type = "button";
  button.className = "cleanfeed-reveal";
  button.textContent = BLUR_COPY.reveal;
  button.addEventListener("click", () => {
    onReveal();
  });
  toolbar.append(message, button);

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
