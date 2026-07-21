import {
  createExplanationPanel,
  type ExplanationPanelCallbacks,
  type ExplanationPanelOptions,
} from "@/content/presentation/explanation-panel";
import { registerOwnedArtifact } from "@/content/presentation/restore";
import { CLASSIFICATION_STATUS_COPY } from "@/shared/classification-copy";
import type { EffectiveSettings } from "@/shared/settings-types";
import type { ClassificationResult, PresentationMode } from "@/shared/types";

const badges = new WeakMap<HTMLElement, HTMLButtonElement>();

let panelSequence = 0;

/**
 * Adds the extension's reversible, keyboard-accessible status control. The badge
 * is strictly qualitative: it shows the shared band label and never the raw or
 * calibrated score, regardless of any setting. The calibrated score is reachable
 * only from the advanced diagnostic inside the explanation panel.
 */
export function applyBadge(
  element: HTMLElement,
  result: ClassificationResult,
  _settings: EffectiveSettings,
  mode?: PresentationMode,
): void {
  removeBadge(element);
  if (element.parentNode === null) return;

  const text = CLASSIFICATION_STATUS_COPY[result.status];
  const badge = element.ownerDocument.createElement("button");
  badge.type = "button";
  badge.className = "cleanfeed-badge";
  badge.dataset.cleanfeedOwned = "badge";
  // Kept temporarily for CSS and existing integrations that used this marker.
  badge.dataset.cleanfeedIndicator = "true";
  if (mode !== undefined) badge.dataset.cleanfeedMode = mode;
  badge.setAttribute("aria-label", `CleanFeed: ${text}`);
  badge.title = "Ver explicação do CleanFeed";

  const icon = element.ownerDocument.createElement("span");
  icon.className = "cleanfeed-badge__icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "◌";
  badge.append(icon, element.ownerDocument.createTextNode(` ${text}`));

  // The control is intentionally a sibling: it never alters post content or
  // the platform's own reading order. Future tasks attach its explanation UI.
  element.parentNode.insertBefore(badge, element);
  badges.set(element, badge);
}

export function getBadge(element: HTMLElement): HTMLButtonElement | undefined {
  return badges.get(element);
}

/**
 * Turns the badge into a disclosure that toggles the explanation panel. Opening
 * inserts the panel as an owned sibling and moves focus to its heading; closing
 * removes the panel and returns focus to the badge, so restore/reveal still
 * clear every CleanFeed node. Idempotent per badge.
 */
export function attachExplanationDisclosure(
  post: HTMLElement,
  badge: HTMLButtonElement,
  result: ClassificationResult,
  callbacks: Pick<ExplanationPanelCallbacks, "onFeedback"> &
    ExplanationPanelOptions,
): void {
  if (badge.dataset.cleanfeedExplains === "true") return;
  badge.dataset.cleanfeedExplains = "true";

  const panelId = `${(badge.id ||= `cleanfeed-badge-${++panelSequence}`)}-panel`;
  badge.setAttribute("aria-expanded", "false");
  // Declare the owned region up front. A collapsed disclosure legitimately has
  // no rendered panel yet; opening mints the element with exactly this id.
  badge.setAttribute("aria-controls", panelId);

  let panel: HTMLElement | null = null;

  const close = (): void => {
    if (panel === null) return;
    panel.remove();
    panel = null;
    badge.setAttribute("aria-expanded", "false");
    badge.focus();
  };

  const open = (): void => {
    if (panel !== null) return;
    panel = createExplanationPanel(
      result,
      {
        onFeedback: callbacks.onFeedback,
        onClose: close,
      },
      { showTechnicalScore: callbacks.showTechnicalScore },
    );
    panel.id = panelId;
    badge.setAttribute("aria-expanded", "true");
    badge.after(panel);
    registerOwnedArtifact(post, panel);
    panel
      .querySelector<HTMLElement>(".cleanfeed-explanation__heading")
      ?.focus();
  };

  badge.addEventListener("click", () => {
    if (panel === null) open();
    else close();
  });
}

export function removeBadge(element: HTMLElement): void {
  badges.get(element)?.remove();
  badges.delete(element);
}
