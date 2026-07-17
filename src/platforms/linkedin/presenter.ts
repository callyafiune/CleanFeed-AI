import { applyBadge } from "@/content/presentation/badge";
import { resolveMode } from "@/content/presentation/presentation-controller";
import {
  rememberPresentation,
  resetPresentation,
  restorePresentation,
} from "@/content/presentation/restore";
import type { EffectiveSettings } from "@/shared/settings-types";
import type { ClassificationResult } from "@/shared/types";

export function applyLinkedInPresentation(
  element: HTMLElement,
  result: ClassificationResult,
  settings: EffectiveSettings,
): void {
  const mode = resolveMode(result, settings);
  if (mode === null) {
    restoreLinkedInPresentation(element);
    return;
  }

  rememberPresentation(element);
  resetPresentation(element);
  element.dataset.cleanfeedStatus = result.status;
  element.dataset.cleanfeedScore = result.aiScore.toFixed(3);
  applyBadge(element, result, settings, mode);

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
