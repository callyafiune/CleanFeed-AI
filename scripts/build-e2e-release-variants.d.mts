import type { ReleaseVariantRecipe } from "../tests/e2e/fixtures/release-variants";

export declare const VARIANT_NAMES: readonly [
  "shadow",
  "indicator-only",
  "pass",
  "expired",
];

export declare function buildReleaseVariant(
  name: string,
  recipe: ReleaseVariantRecipe,
  outputDirectory: string,
): Promise<string>;
