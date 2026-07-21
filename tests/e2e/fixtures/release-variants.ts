// Test-only release variant recipes. Each recipe names a canonical
// (rolloutState, gateDecision, profileMode) triple that the variant builder
// materializes into a throwaway `release.json` + `calibration-profiles.json`
// (with REAL digests bound to the sealed bundle identity) under
// `test-results/release-variants/<name>`. These variants exist ONLY to prove the
// runtime WIRING and PRESENTATION in the functional MV3 lane; they never enter
// `build:release`, and `audit:model` rejects them against the canonical sources.

/** The four canonical rollout situations the E2E exercises. */
export type ReleaseVariantName =
  "shadow" | "indicator-only" | "pass" | "expired";

/** The canonical (rollout, gate, profile) triple a variant build materializes. */
export interface ReleaseVariantRecipe {
  rolloutState: "shadow" | "indicator" | "actions";
  gateDecision: "pass" | "indicator-only";
  profileMode: "valid-indicator" | "valid-actions" | "expired";
}

/** The four variant names, in the deterministic order the builder writes them. */
export const RELEASE_VARIANT_NAMES: readonly ReleaseVariantName[] = [
  "shadow",
  "indicator-only",
  "pass",
  "expired",
];

/**
 * Maps a variant name to its canonical recipe. `shadow` runs the pass profile
 * but at a rollout that never presents; `indicator-only` caps every result at
 * indicator; `expired` ships a promoted `actions` release whose only profile is
 * already expired, so the TMR abstains and the stylometric fallback may only
 * indicate; `pass` is the fully-promoted `actions` release.
 */
export function createReleaseVariantRecipe(
  name: ReleaseVariantName,
): ReleaseVariantRecipe {
  if (name === "shadow") {
    return {
      rolloutState: "shadow",
      gateDecision: "pass",
      profileMode: "valid-actions",
    };
  }
  if (name === "indicator-only") {
    return {
      rolloutState: "indicator",
      gateDecision: "indicator-only",
      profileMode: "valid-indicator",
    };
  }
  if (name === "expired") {
    return {
      rolloutState: "actions",
      gateDecision: "pass",
      profileMode: "expired",
    };
  }
  return {
    rolloutState: "actions",
    gateDecision: "pass",
    profileMode: "valid-actions",
  };
}
