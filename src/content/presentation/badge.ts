import type { EffectiveSettings } from "@/shared/settings-types";
import type { ClassificationResult } from "@/shared/types";

const badges = new WeakMap<HTMLElement, HTMLButtonElement>();

const COPY: Record<ClassificationResult["status"], string> = {
  probably_human: "Provavelmente escrito por uma pessoa",
  inconclusive: "Resultado inconclusivo",
  possibly_ai: "Possivelmente gerado por IA",
  strong_ai_indication: "Fortes indícios de IA",
  insufficient_evidence: "Resultado inconclusivo",
  classification_failed: "Resultado inconclusivo",
};

/** Adds the extension's reversible, keyboard-accessible status control. */
export function applyBadge(
  element: HTMLElement,
  result: ClassificationResult,
  settings: EffectiveSettings,
): void {
  removeBadge(element);
  if (element.parentNode === null) return;

  const text = COPY[result.status];
  const badge = element.ownerDocument.createElement("button");
  badge.type = "button";
  badge.className = "cleanfeed-badge";
  badge.dataset.cleanfeedOwned = "badge";
  // Kept temporarily for CSS and existing integrations that used this marker.
  badge.dataset.cleanfeedIndicator = "true";
  badge.setAttribute("aria-label", `CleanFeed: ${text}`);
  badge.title = "Ver explicação do CleanFeed";

  const icon = element.ownerDocument.createElement("span");
  icon.className = "cleanfeed-badge__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "◌";
  badge.append(icon, element.ownerDocument.createTextNode(` ${text}`));
  if (settings.showScore) {
    badge.append(
      element.ownerDocument.createTextNode(
        ` (${Math.round(result.aiScore * 100)}%)`,
      ),
    );
  }

  // The control is intentionally a sibling: it never alters post content or
  // the platform's own reading order. Future tasks attach its explanation UI.
  element.parentNode.insertBefore(badge, element);
  badges.set(element, badge);
}

export function removeBadge(element: HTMLElement): void {
  badges.get(element)?.remove();
  badges.delete(element);
}
