import { applyBadge, getBadge } from "@/content/presentation/badge";
import { applyBlur } from "@/content/presentation/blur";
import { applyCollapse } from "@/content/presentation/collapse";
import { applyHide } from "@/content/presentation/hide";
import {
  rememberPresentation,
  resetPresentation,
  restorePresentation,
  revealPost,
} from "@/content/presentation/restore";
import { SessionState } from "@/content/session-state";
import type { EffectiveSettings } from "@/shared/settings-types";
import type {
  ClassificationResult,
  ClassificationStatus,
  PresentationMode,
} from "@/shared/types";

export type PresentationState =
  | { kind: "clean" }
  | { kind: "presented"; mode: PresentationMode; result: ClassificationResult }
  | { kind: "revealed"; mode: PresentationMode; result: ClassificationResult }
  | { kind: "ignored"; result: ClassificationResult };

/** Aggressiveness ordering; a lower rank never yields to a higher one. */
export const MODE_RANK: Record<PresentationMode, number> = {
  indicator: 0,
  blur: 1,
  collapse: 2,
  hide: 3,
};

/** Only these statuses may ever be presented as likely AI. */
const FILTERABLE_STATUSES: ReadonlySet<ClassificationStatus> = new Set([
  "possibly_ai",
  "strong_ai_indication",
]);

const CLEAN: PresentationState = { kind: "clean" };

/**
 * Fail-closed presentability. A result is shown ONLY when its decision both
 * authorizes presentation and did not abstain, AND its status is filterable.
 * The score, calibrated score, isolated status, word range and any legacy
 * threshold are irrelevant here: a decision that did not authorize presentation
 * is never presented, however high the raw score.
 */
export function isPresentable(result: ClassificationResult): boolean {
  const { decision } = result;
  return (
    decision.presentationAllowed === true &&
    decision.abstained === false &&
    FILTERABLE_STATUSES.has(result.status)
  );
}

/**
 * Resolves the presentation mode as the LEAST-aggressive rank between the user's
 * preference and the decision's action ceiling. It reads ONLY
 * `settings.presentationMode` and `decision.actionCeiling` — never a score, an
 * isolated status, a word range or a legacy threshold. Returns `null` when the
 * decision does not authorize presentation.
 */
export function resolveMode(
  result: ClassificationResult,
  settings: EffectiveSettings,
): PresentationMode | null {
  if (!isPresentable(result)) return null;

  const configured = settings.presentationMode;
  const ceiling = result.decision.actionCeiling;
  return MODE_RANK[configured] <= MODE_RANK[ceiling] ? configured : ceiling;
}

export interface PresentationControllerOptions {
  session?: SessionState;
  onReveal?: (element: HTMLElement) => void;
  onRestore?: (element: HTMLElement) => void;
}

/**
 * Owns the reversible, per-element presentation state for one page session.
 * State lives in a `WeakMap`; a `Set` tracks live elements only so `clearAll`
 * can reach them. Every operation prunes disconnected elements. The controller
 * only ever adds, reveals or removes nodes and marks that CleanFeed owns.
 */
export class PresentationController {
  private readonly states = new WeakMap<HTMLElement, PresentationState>();
  private readonly tracked = new Set<HTMLElement>();
  private readonly session: SessionState;
  private readonly onReveal?: (element: HTMLElement) => void;
  private readonly onRestore?: (element: HTMLElement) => void;

  constructor(options: PresentationControllerOptions = {}) {
    this.session = options.session ?? new SessionState();
    this.onReveal = options.onReveal;
    this.onRestore = options.onRestore;
  }

  /** Presents the post if warranted; idempotent for an unchanged decision. */
  apply(
    element: HTMLElement,
    result: ClassificationResult,
    settings: EffectiveSettings,
  ): PresentationMode | null {
    this.prune();
    if (this.session.isIgnored(element)) return null;

    const mode = resolveMode(result, settings);
    const current = this.states.get(element) ?? CLEAN;

    if (mode === null) {
      if (current.kind !== "clean") this.restore(element);
      return null;
    }

    if (
      (current.kind === "presented" || current.kind === "revealed") &&
      current.mode === mode
    ) {
      // Same visual mode already applied: keep it (and any user reveal), but
      // refresh the badge and data attributes when the decision content changed
      // so a stale label/score is never left in the DOM.
      if (
        current.result.status !== result.status ||
        current.result.aiScore !== result.aiScore
      ) {
        element.dataset.cleanfeedStatus = result.status;
        element.dataset.cleanfeedScore = result.aiScore.toFixed(3);
        applyBadge(element, result, settings, mode);
        if (current.kind === "revealed") {
          const badge = getBadge(element);
          if (badge !== undefined) badge.dataset.cleanfeedRevealed = "true";
        }
      }
      this.states.set(element, { ...current, result });
      return mode;
    }

    rememberPresentation(element);
    resetPresentation(element);
    this.present(element, result, settings, mode);
    this.states.set(element, { kind: "presented", mode, result });
    this.tracked.add(element);
    return mode;
  }

  /** Drops the visual treatment but keeps the badge and the classification. */
  reveal(element: HTMLElement): void {
    const current = this.states.get(element);
    if (current === undefined || current.kind !== "presented") return;

    // The reveal control lives inside the scaffolding revealPost is about to
    // remove; note whether it currently holds focus so we can move focus to the
    // badge afterwards instead of dropping it to <body>.
    const active = element.ownerDocument.activeElement;
    const revealControlHadFocus =
      active instanceof HTMLElement &&
      active.classList.contains("cleanfeed-reveal");

    revealPost(element);
    element.dataset.cleanfeedRevealed = "true";
    const badge = getBadge(element);
    if (badge !== undefined) badge.dataset.cleanfeedRevealed = "true";
    if (revealControlHadFocus) badge?.focus();

    this.states.set(element, {
      kind: "revealed",
      mode: current.mode,
      result: current.result,
    });
    this.onReveal?.(element);
  }

  /** Returns the post to its exact original state and drops all owned nodes. */
  restore(element: HTMLElement): void {
    const current = this.states.get(element);
    if (current === undefined || current.kind === "clean") return;

    restorePresentation(element);
    this.states.set(element, CLEAN);
    this.tracked.delete(element);
    this.onRestore?.(element);
  }

  /** Restores the post and blocks any further presentation this session. */
  ignore(element: HTMLElement): void {
    const current = this.states.get(element);
    restorePresentation(element);
    this.session.ignore(element);
    this.tracked.delete(element);
    this.states.set(
      element,
      current !== undefined && "result" in current
        ? { kind: "ignored", result: current.result }
        : CLEAN,
    );
  }

  clearAll(): void {
    // Restore every tracked element WITHOUT pruning first: restore() removes the
    // badge through the `badges` WeakMap, so it clears an owned badge that was
    // orphaned when its post was detached individually. Pruning first would drop
    // that element and leak its still-connected badge.
    for (const element of [...this.tracked]) this.restore(element);
  }

  stateOf(element: HTMLElement): PresentationState {
    return this.states.get(element) ?? CLEAN;
  }

  private present(
    element: HTMLElement,
    result: ClassificationResult,
    settings: EffectiveSettings,
    mode: PresentationMode,
  ): void {
    element.dataset.cleanfeedStatus = result.status;
    element.dataset.cleanfeedScore = result.aiScore.toFixed(3);
    applyBadge(element, result, settings, mode);
    const reveal = () => this.reveal(element);
    if (mode === "blur") applyBlur(element, reveal);
    else if (mode === "collapse") applyCollapse(element, reveal);
    else if (mode === "hide") applyHide(element, reveal);
    // indicator: badge only, nothing to reveal.
  }

  private prune(): void {
    for (const element of [...this.tracked]) {
      if (element.isConnected) continue;
      // The post node is gone but its owned siblings (badge, placeholder,
      // toolbar) may still be connected. Restore removes them via the WeakMaps
      // before we drop our only strong reference to the detached element.
      restorePresentation(element);
      this.states.set(element, CLEAN);
      this.tracked.delete(element);
    }
  }
}
