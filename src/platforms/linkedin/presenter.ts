import { applyBadge } from "@/content/presentation/badge";
import {
  rememberPresentation,
  resetPresentation,
  restorePresentation,
} from "@/content/presentation/restore";
import type { EffectiveSettings } from "@/shared/settings-types";
import type { ClassificationResult, PresentationMode } from "@/shared/types";

export function applyLinkedInPresentation(
  element: HTMLElement,
  result: ClassificationResult,
  settings: EffectiveSettings,
): void {
  if (result.aiScore < settings.markingThreshold) {
    restoreLinkedInPresentation(element);
    return;
  }

  rememberPresentation(element);
  resetPresentation(element);
  element.dataset.cleanfeedStatus = result.status;
  element.dataset.cleanfeedScore = result.aiScore.toFixed(3);
  applyBadge(element, result, settings);

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
  restorePresentation(element);
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
