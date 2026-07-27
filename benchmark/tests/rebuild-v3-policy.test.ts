import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { EVALUATOR_FILES } from "../digests.ts";
import {
  parseRebuildV3Policy,
  REBUILD_V3_POLICY,
  REBUILD_V3_POLICY_PATH,
  RebuildV3PolicyError,
} from "../rebuild-v3-policy.ts";

// The frozen table lives in the plan ("Contrato de execução sem decisões
// pendentes"). These tests are the only place that repeats its values as
// literals: everywhere else in the benchmark must read them from the policy.

async function rawPolicyText(): Promise<string> {
  // CRLF is normalized away: this repo is checked out on Windows with
  // core.autocrlf, and the canonical form being asserted is the KEY ORDER and
  // the indentation, not the platform's newline.
  return (await readFile(REBUILD_V3_POLICY_PATH, "utf8")).replace(
    /\r\n/gu,
    "\n",
  );
}

// Canonical form of the JSON file: object keys sorted by codepoint, two-space
// indentation, one trailing newline. Recomputed here so a hand edit that
// reorders a key or reformats a block fails instead of drifting silently.
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      (a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0),
    );
    const out: Record<string, unknown> = {};
    for (const [key, nested] of entries) out[key] = canonicalize(nested);
    return out;
  }
  return value;
}

function validPolicyObject(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(REBUILD_V3_POLICY)) as Record<
    string,
    unknown
  >;
}

describe("rebuild-v3-policy.json", () => {
  it("is stored in canonical JSON", async () => {
    const text = await rawPolicyText();
    const parsed = JSON.parse(text) as unknown;
    expect(text).toBe(`${JSON.stringify(canonicalize(parsed), null, 2)}\n`);
  });

  it("is part of the evaluator's identity, together with its validator", () => {
    expect(EVALUATOR_FILES).toContain("benchmark/rebuild-v3-policy.json");
    expect(EVALUATOR_FILES).toContain("benchmark/rebuild-v3-policy.ts");
  });

  it("carries the frozen table verbatim", () => {
    const policy = REBUILD_V3_POLICY;
    // Licence and use.
    expect(policy.commercialUse).toBe(false);
    expect(policy.attributionRequired).toBe(true);
    expect(policy.shareAlikeRequired).toBe(true);
    // Product target: a claim about textual compatibility, never authorship.
    expect(policy.productTarget).toBe(
      "textual-compatibility-with-ai-generation",
    );
    expect(policy.infersAuthorship).toBe(false);
    // Positives, material assistance, localization, mixed below half.
    expect(policy.integralPositive.label).toBe("ai");
    expect(policy.materialAssistance.minimumAiFraction).toBe(0.5);
    expect(policy.materialAssistance.generationMode).toBe("mechanistic");
    expect(policy.materialAssistance.authorizes).toBe("warning-only");
    expect(policy.localization.authorizesVisualAction).toBe(false);
    expect(policy.mixedBelowHalfAiRole).toBe("diagnostic-curve-only");
    // Strata, bands, families, sources.
    expect(policy.humanCoreStrata).toEqual([
      "encyclopedic",
      "institutional",
      "qa-informal",
      "social-media",
      "university",
    ]);
    expect(policy.profileBands).toEqual(["50-79", "80-199", "200-plus"]);
    expect(policy.wordFloor.abstainBelow).toBe(50);
    expect(policy.hardNegativeFamilies).toEqual([
      "corporate-structure",
      "formulaic",
      "highly-polished",
      "motivational",
      "non-native",
      "repetitive",
    ]);
    expect(policy.humanSources.snapshots).toEqual([
      "b2w-reviews01",
      "carolina",
      "pt-stackoverflow",
      "ptwiki",
    ]);
    expect(policy.humanSources.newDownloadsAllowed).toBe(false);
    // Temporal cohort.
    expect(policy.temporalCohort.quartilesOf).toBe("createdAt");
    expect(policy.temporalCohort.minimumDistinctTimestamps).toBe(4);
    expect(policy.temporalCohort.insufficientPowerLabel).toBe("notApplicable");
    // Backbone, seeds, bootstrap, training, ONNX size.
    expect(policy.backbone).toBe("neuralmind/bert-base-portuguese-cased");
    expect(policy.backboneBakeOff).toBe(false);
    expect(policy.seeds.ablation).toEqual([
      712019, 712020, 712021, 712022, 712023,
    ]);
    expect(policy.seeds.publishableCheckpoint).toBe(712019);
    expect(policy.seeds.split).toBe(20260726);
    expect(policy.seeds.crossValidation).toBe(20260727);
    expect(policy.seeds.bootstrap).toBe(20260728);
    expect(policy.bootstrapReplicates).toEqual({
      pilot: 10_000,
      release: 100_000,
    });
    expect(policy.training).toEqual({
      batchDocuments: 16,
      epochs: 3,
      learningRate: 2e-5,
      optimizer: "adamw",
      warmupFraction: 0.06,
      weightDecay: 0.01,
    });
    expect(policy.onnxMaximumInt8Bytes).toBe(109_681_931);
    // FPR budgets and conformal construction.
    expect(policy.fprBudgets).toEqual({ warning: 0.05, visualAction: 0.02 });
    expect(policy.conformal.warning.documentEpsilon).toBe(0.025);
    expect(policy.conformal.warning.localizedEpsilon).toBe(0.025);
    expect(policy.conformal.action.documentEpsilon).toBe(0.02);
    expect(policy.conformal.action.localizedEpsilon).toBeNull();
    expect(policy.conformal.population).toBe("cal-b-humans");
    expect(policy.runtimeComparator).toBe("score-ge-next-up-quantile");
    // Calibrator competition and its tie-break order.
    expect(policy.calibrator.candidates).toEqual(["platt", "beta", "isotonic"]);
    expect(policy.calibrator.crossValidationFolds).toBe(5);
    expect(policy.calibrator.selectionMetric).toBe("brier-out-of-fold");
    expect(policy.calibrator.tieToleranceAbsolute).toBe(1e-4);
    expect(policy.calibrator.tieBreakOrder).toEqual([
      "platt",
      "beta",
      "isotonic",
    ]);
    expect(policy.calibrator.scope).toBe("global-per-path");
    // Multiplicity, calibration gate, parity, reserve, validity, rollout.
    expect(policy.multiplicity.familyAlpha).toBe(0.05);
    expect(policy.multiplicity.correction).toBe("bonferroni");
    expect(policy.multiplicity.descriptiveConfidence).toBe(0.95);
    expect(policy.calibrationGate).toEqual({
      eceBinning: "equal-mass",
      eceBins: 15,
      eceBound: "bootstrap-upper95",
      eceMax: 0.05,
    });
    expect(policy.parity).toEqual({
      operationalMaximumInversions: 0,
      rawMaximumMeanAbsDelta: 0.02,
    });
    expect(policy.blindReserveCompleteAttempts).toBe(2);
    expect(policy.profileValidityDays).toBe(180);
    expect(policy.rollout.maximumStage).toBe("indicator");
    expect(policy.rollout.actionsPromoted).toBe(false);
    // Label basis: two bases, never pooled into one claim.
    expect(policy.labelBasis.allowed).toEqual([
      "date-cutoff",
      "observed-process",
    ]);
    expect(policy.labelBasis.appliesToLabel).toBe("human");
    expect(policy.labelBasis.pooledClaimAllowed).toBe(false);
    expect(policy.labelBasis.underPoweredRole).toBe("supplementary-diagnostic");
    // Resampling evidence: no fallback to independent rows.
    expect(policy.resampling.required).toBe(true);
    expect(policy.resampling.fallbackToIndependentRows).toBe(false);
    expect(policy.resampling.allowedUnitKinds).toEqual([
      "hierarchical",
      "multiway",
    ]);
    // Power floors: the two §6.4 minima, and an explicitly absent one.
    expect(policy.powerFloors.criticalFprHumanNegatives).toBe(300);
    expect(policy.powerFloors.criticalRecallPositives).toBe(200);
    expect(policy.powerFloors.samplingUnits).toBeNull();
    // Prevalences for the PPV/NPV projection.
    expect(policy.predictiveValuePrevalences).toEqual([0.01, 0.05, 0.1]);
  });

  it("is deeply frozen so no consumer can mutate the frozen table at runtime", () => {
    expect(Object.isFrozen(REBUILD_V3_POLICY)).toBe(true);
    expect(Object.isFrozen(REBUILD_V3_POLICY.fprBudgets)).toBe(true);
    expect(Object.isFrozen(REBUILD_V3_POLICY.humanCoreStrata)).toBe(true);
  });
});

describe("parseRebuildV3Policy fails closed", () => {
  it("accepts the shipped policy unchanged", () => {
    expect(parseRebuildV3Policy(validPolicyObject())).toEqual(
      REBUILD_V3_POLICY,
    );
  });

  it("rejects a non-object", () => {
    for (const bad of [null, 42, "policy", []]) {
      expect(() => parseRebuildV3Policy(bad)).toThrow(RebuildV3PolicyError);
    }
  });

  it("never substitutes a default for a missing value", () => {
    const withoutBudgets = validPolicyObject();
    delete withoutBudgets.fprBudgets;
    expect(() => parseRebuildV3Policy(withoutBudgets)).toThrow(/fprBudgets/u);

    const withoutWarningBudget = validPolicyObject();
    delete (withoutWarningBudget.fprBudgets as Record<string, unknown>).warning;
    expect(() => parseRebuildV3Policy(withoutWarningBudget)).toThrow(
      /fprBudgets\.warning/u,
    );

    // An empty object must name a missing path, never parse to defaults.
    expect(() => parseRebuildV3Policy({})).toThrow(RebuildV3PolicyError);
  });

  it("rejects an unknown key instead of ignoring it", () => {
    const extra = { ...validPolicyObject(), warningFprBudget: 0.07 };
    expect(() => parseRebuildV3Policy(extra)).toThrow(/warningFprBudget/u);

    const nestedExtra = validPolicyObject();
    (nestedExtra.fprBudgets as Record<string, unknown>).indicator = 0.05;
    expect(() => parseRebuildV3Policy(nestedExtra)).toThrow(
      /fprBudgets\.indicator/u,
    );
  });

  it("rejects a wrong type", () => {
    const stringBudget = validPolicyObject();
    (stringBudget.fprBudgets as Record<string, unknown>).warning = "0.05";
    expect(() => parseRebuildV3Policy(stringBudget)).toThrow(
      /fprBudgets\.warning/u,
    );

    const stringSeed = validPolicyObject();
    (stringSeed.seeds as Record<string, unknown>).split = "20260726";
    expect(() => parseRebuildV3Policy(stringSeed)).toThrow(/seeds\.split/u);
  });

  it("rejects a value outside its domain", () => {
    const overOne = validPolicyObject();
    (overOne.fprBudgets as Record<string, unknown>).warning = 1.5;
    expect(() => parseRebuildV3Policy(overOne)).toThrow(/fprBudgets\.warning/u);

    const negativeAlpha = validPolicyObject();
    (negativeAlpha.multiplicity as Record<string, unknown>).familyAlpha = 0;
    expect(() => parseRebuildV3Policy(negativeAlpha)).toThrow(
      /multiplicity\.familyAlpha/u,
    );

    const fractionalBytes = validPolicyObject();
    fractionalBytes.onnxMaximumInt8Bytes = 109_681_931.5;
    expect(() => parseRebuildV3Policy(fractionalBytes)).toThrow(
      /onnxMaximumInt8Bytes/u,
    );

    const emptyStrata = validPolicyObject();
    emptyStrata.humanCoreStrata = [];
    expect(() => parseRebuildV3Policy(emptyStrata)).toThrow(/humanCoreStrata/u);

    const duplicatedFamily = validPolicyObject();
    duplicatedFamily.hardNegativeFamilies = [
      "formulaic",
      "formulaic",
      "highly-polished",
      "motivational",
      "non-native",
      "repetitive",
    ];
    expect(() => parseRebuildV3Policy(duplicatedFamily)).toThrow(
      /hardNegativeFamilies/u,
    );
  });

  it("rejects a value outside its enum", () => {
    const badBinning = validPolicyObject();
    (badBinning.calibrationGate as Record<string, unknown>).eceBinning =
      "equal-width";
    expect(() => parseRebuildV3Policy(badBinning)).toThrow(
      /calibrationGate\.eceBinning/u,
    );

    const badKind = validPolicyObject();
    (badKind.resampling as Record<string, unknown>).allowedUnitKinds = [
      "independent-rows",
    ];
    expect(() => parseRebuildV3Policy(badKind)).toThrow(
      /resampling\.allowedUnitKinds/u,
    );
  });

  it("rejects a loosened frozen decision", () => {
    // R3: a frozen decision is not a default a caller may relax. The parser
    // pins the decisions whose whole point is that they are settled.
    const commercial = validPolicyObject();
    commercial.commercialUse = true;
    expect(() => parseRebuildV3Policy(commercial)).toThrow(/commercialUse/u);

    const iidFallback = validPolicyObject();
    (
      iidFallback.resampling as Record<string, unknown>
    ).fallbackToIndependentRows = true;
    expect(() => parseRebuildV3Policy(iidFallback)).toThrow(
      /resampling\.fallbackToIndependentRows/u,
    );

    const pooled = validPolicyObject();
    (pooled.labelBasis as Record<string, unknown>).pooledClaimAllowed = true;
    expect(() => parseRebuildV3Policy(pooled)).toThrow(
      /labelBasis\.pooledClaimAllowed/u,
    );

    const promoted = validPolicyObject();
    (promoted.rollout as Record<string, unknown>).actionsPromoted = true;
    expect(() => parseRebuildV3Policy(promoted)).toThrow(
      /rollout\.actionsPromoted/u,
    );
  });
});
