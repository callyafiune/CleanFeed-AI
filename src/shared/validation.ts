import { CleanFeedError } from "@/shared/errors";
import type { Thresholds } from "@/shared/settings-types";

export function validateThresholds(thresholds: Thresholds): void {
  const values = [
    thresholds.marking,
    thresholds.blur,
    thresholds.collapse,
    thresholds.hide,
  ];

  const isValid =
    values.every(
      (value) => Number.isFinite(value) && value >= 0 && value <= 1,
    ) &&
    thresholds.marking <= thresholds.blur &&
    thresholds.blur <= thresholds.collapse &&
    thresholds.collapse <= thresholds.hide;

  if (!isValid) {
    throw new CleanFeedError("INVALID_SETTINGS", "INVALID_SETTINGS");
  }
}
