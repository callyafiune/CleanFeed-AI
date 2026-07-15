import { removeBadge } from "@/content/presentation/badge";

interface PresentationSnapshot {
  display: string;
  filter: string;
  maxHeight: string;
  overflow: string;
}

const originals = new WeakMap<HTMLElement, PresentationSnapshot>();

export function rememberPresentation(element: HTMLElement): void {
  if (originals.has(element)) return;
  originals.set(element, {
    display: element.style.display,
    filter: element.style.filter,
    maxHeight: element.style.maxHeight,
    overflow: element.style.overflow,
  });
}

/** Resets a currently presented element but keeps its original snapshot. */
export function resetPresentation(element: HTMLElement): void {
  const original = originals.get(element);
  if (original !== undefined) {
    element.style.display = original.display;
    element.style.filter = original.filter;
    element.style.maxHeight = original.maxHeight;
    element.style.overflow = original.overflow;
  }
  delete element.dataset.cleanfeedStatus;
  delete element.dataset.cleanfeedScore;
  removeBadge(element);
}

/** Removes only modifications owned by CleanFeed; safe to call repeatedly. */
export function restorePresentation(element: HTMLElement): void {
  resetPresentation(element);
  originals.delete(element);
}
