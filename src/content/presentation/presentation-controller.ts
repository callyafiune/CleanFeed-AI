import { applyBadge, getBadge } from "@/content/presentation/badge";
import {
  PRESENTATION_MODE_CLASSES,
  rememberPresentation,
  removePresentationClasses,
  resetPresentation,
  restorePresentation,
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
 * True only for non-abstained decisions whose status indicates AI. Human,
 * inconclusive, insufficient-evidence, failed and abstained results are never
 * filtered, regardless of score.
 */
export function isPresentable(result: ClassificationResult): boolean {
  if (result.decision?.abstained === true) return false;
  return FILTERABLE_STATUSES.has(result.status);
}

/**
 * Resolves the least-aggressive mode allowed by the score and settings, never
 * exceeding the decision's action ceiling. Returns `null` when nothing should
 * be shown.
 */
export function resolveMode(
  result: ClassificationResult,
  settings: EffectiveSettings,
): PresentationMode | null {
  if (!isPresentable(result)) return null;
  if (result.aiScore < settings.markingThreshold) return null;

  const configured = settings.presentationMode;
  const ceiling = result.decision?.actionCeiling;
  if (ceiling === undefined) return configured;
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

    removePresentationClasses(element);
    element.dataset.cleanfeedRevealed = "true";
    const badge = getBadge(element);
    if (badge !== undefined) badge.dataset.cleanfeedRevealed = "true";

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
    if (mode !== "indicator") {
      element.classList.add(PRESENTATION_MODE_CLASSES[mode]);
    }
  }

  private prune(): void {
    for (const element of [...this.tracked]) {
      if (!element.isConnected) this.tracked.delete(element);
    }
  }
}
