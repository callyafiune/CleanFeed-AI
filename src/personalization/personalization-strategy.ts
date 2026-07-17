import type { PersonalizationStage } from "@/shared/types";

/**
 * Sample counts that, in a FUTURE spec, could unlock richer personalization.
 * They are documented here as the intended boundary but stay DISABLED in the
 * MVP: nothing below reads them to change behavior.
 *
 * - `THRESHOLD_ADJUSTMENT_MINIMUM` (20): from here, per-user feedback could bias
 *   the marking thresholds. Requires a dedicated spec and explicit opt-in.
 * - `AUXILIARY_CLASSIFIER_MINIMUM` (100): from here, an auxiliary, on-device
 *   classifier could be trained on the collected feedback. Requires a dedicated
 *   spec and explicit opt-in.
 */
export const THRESHOLD_ADJUSTMENT_MINIMUM = 20;
export const AUXILIARY_CLASSIFIER_MINIMUM = 100;

/**
 * Resolves the personalization stage for a given number of collected feedback
 * samples. In the MVP this ALWAYS returns `collect_only`, regardless of count:
 * feedback is only stored, never used to adjust thresholds or train a
 * classifier. The `count` argument is accepted so the future boundary is
 * explicit and testable, but it deliberately does not change the outcome until
 * a new spec plus opt-in enables the documented stages above.
 */
export function getPersonalizationStage(count: number): PersonalizationStage {
  void count;
  return {
    stage: "collect_only",
    appliesThresholdAdjustment: false,
    trainsAuxiliaryClassifier: false,
  };
}
