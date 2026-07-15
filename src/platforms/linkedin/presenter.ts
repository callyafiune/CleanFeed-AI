import type { EffectiveSettings } from "@/shared/settings-types";
import type { ClassificationResult, PresentationMode } from "@/shared/types";

interface PresentationSnapshot {
  display: string;
  filter: string;
  maxHeight: string;
  overflow: string;
}

const originals = new WeakMap<HTMLElement, PresentationSnapshot>();

export function applyLinkedInPresentation(
  element: HTMLElement,
  result: ClassificationResult,
  settings: EffectiveSettings,
): void {
  if (result.aiScore < settings.markingThreshold) {
    restoreLinkedInPresentation(element);
    return;
  }

  remember(element);
  restoreStyles(element);
  removeIndicator(element);
  element.dataset.cleanfeedStatus = result.status;
  element.dataset.cleanfeedScore = result.aiScore.toFixed(3);
  appendIndicator(element, result);

  const mode = ceiling(
    settings.presentationMode,
    result.decision?.actionCeiling,
  );
  if (mode === "blur") {
    element.style.filter = "blur(5px)";
  } else if (mode === "collapse") {
    element.style.maxHeight = "6rem";
    element.style.overflow = "hidden";
  } else if (mode === "hide") {
    element.style.display = "none";
  }
}

export function restoreLinkedInPresentation(element: HTMLElement): void {
  const original = originals.get(element);
  if (original !== undefined) {
    restoreStyles(element);
    originals.delete(element);
  }
  delete element.dataset.cleanfeedStatus;
  delete element.dataset.cleanfeedScore;
  removeIndicator(element);
}

function restoreStyles(element: HTMLElement): void {
  const original = originals.get(element);
  if (original === undefined) return;
  element.style.display = original.display;
  element.style.filter = original.filter;
  element.style.maxHeight = original.maxHeight;
  element.style.overflow = original.overflow;
}

function remember(element: HTMLElement): void {
  if (originals.has(element)) return;
  originals.set(element, {
    display: element.style.display,
    filter: element.style.filter,
    maxHeight: element.style.maxHeight,
    overflow: element.style.overflow,
  });
}

function appendIndicator(
  element: HTMLElement,
  result: ClassificationResult,
): void {
  const indicator = element.ownerDocument.createElement("div");
  indicator.dataset.cleanfeedIndicator = "true";
  indicator.setAttribute("role", "status");
  indicator.textContent = `CleanFeed: ${result.status}`;
  element.prepend(indicator);
}

function removeIndicator(element: HTMLElement): void {
  element
    .querySelectorAll<HTMLElement>("[data-cleanfeed-indicator='true']")
    .forEach((indicator) => indicator.remove());
}

function ceiling(
  configured: PresentationMode,
  maximum: PresentationMode | undefined,
): PresentationMode {
  if (maximum === undefined) return configured;

  const ranks: Record<PresentationMode, number> = {
    indicator: 0,
    blur: 1,
    collapse: 2,
    hide: 3,
  };
  return ranks[configured] <= ranks[maximum] ? configured : maximum;
}
