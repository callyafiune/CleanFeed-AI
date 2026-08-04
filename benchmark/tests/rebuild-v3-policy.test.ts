import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { EVALUATOR_FILES } from "../digests.ts";
import {
  laneRunsHarness,
  parseRebuildV3Policy,
  REBUILD_V3_POLICY,
  REBUILD_V3_POLICY_PATH,
  RebuildV3PolicyError,
} from "../rebuild-v3-policy.ts";

// The ABANDONED v3 contract (`rebuild-v3-policy.ABANDONADA.md`). It is kept readable
// and byte-exact, so these tests still pin its values as literals — an abandoned
// pre-registration that got quietly reformatted or edited would be
// indistinguishable from one that always said that. What they no longer assert is
// that anything READS it: the live contract is `benchmark/preregistration-v4.json`.

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

  it("has exactly one formatting authority, so `npm run format` cannot rewrite an abandoned contract", async () => {
    // The canonical form asserted above is `JSON.stringify(canonical, null, 2)`, and
    // prettier would inline the short arrays. The file is no longer hashed into the
    // evaluator digest, so the stake changed rather than disappeared: a reformatted
    // abandoned pre-registration cannot be told apart from an edited one.
    // Resolved off the policy path, not off `import.meta.url`: Vite rewrites a
    // `new URL(..., import.meta.url)` literal into an asset URL that is not a
    // `file:` URL under vitest.
    const ignore = await readFile(
      join(dirname(REBUILD_V3_POLICY_PATH), "..", ".prettierignore"),
      "utf8",
    );
    expect(
      ignore
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#")),
    ).toContain("benchmark/rebuild-v3-policy.json");
  });

  it("is OUT of the evaluator's identity, together with its validator", () => {
    // The swap is atomic: the live pair is in and the dead pair is out. A dead policy
    // left inside `EVALUATOR_FILES` would keep moving the evaluator digest every time
    // someone touched a file nothing reads.
    expect(EVALUATOR_FILES).not.toContain("benchmark/rebuild-v3-policy.json");
    expect(EVALUATOR_FILES).not.toContain("benchmark/rebuild-v3-policy.ts");
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
    // B2: the three-target table's own rows.
    expect(policy.materialAssistance.minimumWarningRecall).toBe(0.5);
    expect(policy.materialAssistance.cohortsAggregated).toBe(false);
    expect([...policy.materialAssistance.generationModes]).toEqual([
      "mechanistic",
      "ecological",
    ]);
    expect(policy.integralPositive.visualActionRequiresDocumentGates).toBe(
      true,
    );
    expect(policy.localization.metricsRole).toBe("diagnostic");
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
    // Three, not four: A1 refused the Stack Exchange dump. It is not absent, it
    // is BLOCKED BY NAME, and the two lists may not both hold it.
    expect(policy.humanSources.snapshots).toEqual([
      "b2w-reviews01",
      "carolina",
      "ptwiki",
    ]);
    expect(policy.humanSources.blockedSnapshots).toEqual([
      {
        blockedBy: "access-terms-unresolved",
        snapshot: "pt-stackoverflow",
        unblockRequires: expect.stringContaining("termo de acesso"),
      },
    ]);
    // The stratum that base fed keeps its place in the record vocabulary and is
    // declared uncovered, so the gap is data instead of a shrunken denominator.
    expect(policy.uncoveredCoreStrata).toEqual(["qa-informal"]);
    expect(policy.humanCoreStrata).toContain("qa-informal");
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
    // m, named. A range is not a pre-registration, and the per-hypothesis alpha
    // is recomputed at load rather than trusted (see `derivedAlpha`).
    expect(policy.multiplicity.primaryFamilySize).toBe(4);
    expect(policy.multiplicity.primaryFamily).toEqual([
      "calibration-global",
      "fpr-worst-core-stratum",
      "integrity",
      "recall-at-threshold",
    ]);
    expect(policy.multiplicity.perHypothesisAlpha).toBe(0.0125);
    // The pre-registration Phase 0.2 froze. `plannedCertifyingMeasurements` is 1
    // while `blindReserveCompleteAttempts` above is still 2: the reserve sizing
    // and the declared objective disagree, and the divergence is recorded here
    // rather than resolved by quietly re-freezing the older field.
    expect(policy.preRegistration.powerInventoryUnit).toBe(
      "connected-components",
    );
    expect(policy.preRegistration.plannedCertifyingMeasurements).toBe(1);
    expect(policy.preRegistration.publicFeedbackAdaptation).toBe("none");
    expect(policy.preRegistration.quotaAxis.axis).toBe("source");
    expect(policy.preRegistration.quotaAxis.cells).toHaveLength(4);
    expect(policy.preRegistration.quotaAxis.poolingIsResolutionLoss).toBe(true);
    expect(policy.preRegistration.partitionFractions).toEqual({
      calA: 0.1,
      calB: 0.2,
      dev: 0.05,
      test: 0.2,
      train: 0.45,
    });
    expect(policy.powerFloors.samplingUnits).toBe(250);
    // The two published ceilings, recomputed here from the formula the policy
    // names — independently of the module's own derivation, so they cannot agree
    // by being the same literal.
    const alpha = policy.multiplicity.familyAlpha / 4;
    expect(policy.preRegistration.zeroEventCeiling.ceilingAtAdoptedFloor).toBe(
      Number((1 - alpha ** (1 / 250)).toFixed(6)),
    );
    expect(policy.preRegistration.zeroEventCeiling.ceilingAt512).toBe(
      Number((1 - alpha ** (1 / 512)).toFixed(6)),
    );
    expect(policy.calibrationGate).toEqual({
      eceBinning: "equal-mass",
      eceBins: 15,
      eceBound: "bootstrap-simultaneous-upper",
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
    // The four rows of the frozen resampling table, verbatim: source over
    // author/donor for human specificity, generator over template over batch for
    // AI recall, human parent CROSSED with the edit operation for mixed text, and
    // the stratum's own unit for calibration.
    expect(policy.resampling.estimandClasses["human-specificity"]).toEqual({
      unitKind: "hierarchical",
      levels: [
        { axis: "groups.domainSource", fallbacks: [] },
        { axis: "groups.author", fallbacks: ["groups.source"] },
      ],
    });
    expect(policy.resampling.estimandClasses["ai-recall"]).toEqual({
      unitKind: "hierarchical",
      levels: [
        { axis: "groups.generatorFamily", fallbacks: [] },
        { axis: "groups.promptTemplate", fallbacks: [] },
        { axis: "groups.collectionBatch", fallbacks: [] },
      ],
    });
    // The mixed row's second crossed factor is a DECLARED SUBSTITUTE, and the
    // substitution lives in the policy file rather than in prose somewhere else:
    // the frozen table crosses the human parent with the EDIT OPERATION, and no
    // axis of the v3 schema records that operation. A reader of this file who saw
    // only `groups.promptTemplate` would read the row as implemented.
    expect(policy.resampling.estimandClasses.mixed).toEqual({
      unitKind: "multiway",
      levels: [
        { axis: "groups.humanSeed", fallbacks: [] },
        {
          axis: "groups.promptTemplate",
          fallbacks: [],
          proxyFor: "operação de edição",
          proxyReason: expect.stringMatching(
            /nenhum eixo do schema v3 registra a operação de edição/u,
          ),
        },
      ],
    });
    // Every OTHER row is the table's own axis, so none of them carries a proxy: a
    // substitution that spread silently is the failure this field exists to stop.
    for (const row of [
      "human-specificity",
      "ai-recall",
      "calibration",
    ] as const) {
      for (const level of policy.resampling.estimandClasses[row].levels) {
        expect(level.proxyFor).toBeUndefined();
        expect(level.proxyReason).toBeUndefined();
      }
    }
    expect(policy.resampling.estimandClasses.calibration.unitKind).toBe(
      "hierarchical",
    );
    expect(policy.resampling.estimands["warning.fpr"]).toBe(
      "human-specificity",
    );
    expect(policy.resampling.estimands["warning.recall"]).toBe("ai-recall");
    expect(policy.resampling.estimands["calibration.ece"]).toBe("calibration");
    expect(policy.resampling.estimands["mixed.warning.recall"]).toBe("mixed");
    // WHICH ESTIMATOR'S LIMIT A GATE READS is a frozen value, not something the
    // estimator decides for itself: it shapes release verdicts.
    expect(policy.resampling.publishedBound).toBe(
      "wider-of-analytic-and-resampled",
    );
    // Row 4 is "calibração (ECE, Brier)". AUROC and PR-AUC are separability
    // statistics and no row names them, so their mapping onto that row is a
    // DECLARED EXTENSION and says so where the value lives — the same rule the
    // mixed row's substituted factor follows.
    expect(Object.keys(policy.resampling.estimandExtensions).sort()).toEqual([
      "separability.auroc",
      "separability.prAuc",
    ]);
    for (const estimand of ["separability.auroc", "separability.prAuc"]) {
      expect(policy.resampling.estimands[estimand]).toBe("calibration");
      expect(policy.resampling.estimandExtensions[estimand]).toEqual({
        standsInFor: "calibração (ECE, Brier)",
        reason: expect.stringMatching(
          /não é estatística de calibração e nenhuma linha da tabela congelada a nomeia/u,
        ),
      });
    }
    // And no estimand the table covers on its own carries one: an extension that
    // spread silently is the failure this block exists to stop.
    for (const estimand of Object.keys(policy.resampling.estimands)) {
      if (estimand.startsWith("separability.")) continue;
      expect(policy.resampling.estimandExtensions[estimand]).toBeUndefined();
    }
    // Power floors: the two §6.4 minima in ROWS, plus the one in independent
    // SAMPLING UNITS that Phase 0.2 pre-registered. It was null until the primary
    // family had a size, because a floor with no arithmetic behind it is a number
    // somebody picked; now it is 250 connected components, the n at which
    // `1 - alpha^(1/n)` gives the 1.7375% ceiling the project intends to publish.
    // The two row minima are NOT the same quantity and stay as they are: 300 rows
    // in one cluster is 300 rows and one unit.
    expect(policy.powerFloors.criticalFprHumanNegatives).toBe(300);
    expect(policy.powerFloors.criticalRecallPositives).toBe(200);
    expect(policy.powerFloors.samplingUnits).toBe(250);
    expect(policy.preRegistration.zeroEventCeiling.adoptedFloorPerCell).toBe(
      policy.powerFloors.samplingUnits,
    );
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

  it("rejects a rewritten frozen LIST, not just a malformed one", () => {
    // The validator is what a future consumer trusts, so it has to refuse the
    // same things the test suite would catch. Every case below is a well-formed
    // array of distinct non-empty strings from the right vocabulary — the shape
    // check passes and the decision is still gone.
    const reorderedTieBreak = validPolicyObject();
    (reorderedTieBreak.calibrator as Record<string, unknown>).tieBreakOrder = [
      "isotonic",
      "beta",
      "platt",
    ];
    expect(() => parseRebuildV3Policy(reorderedTieBreak)).toThrow(
      /calibrator\.tieBreakOrder/u,
    );

    const oneCalibrator = validPolicyObject();
    (oneCalibrator.calibrator as Record<string, unknown>).tieBreakOrder = [
      "isotonic",
    ];
    expect(() => parseRebuildV3Policy(oneCalibrator)).toThrow(
      /calibrator\.tieBreakOrder/u,
    );

    const fewerCandidates = validPolicyObject();
    (fewerCandidates.calibrator as Record<string, unknown>).candidates = [
      "platt",
      "beta",
    ];
    expect(() => parseRebuildV3Policy(fewerCandidates)).toThrow(
      /calibrator\.candidates/u,
    );

    const inventedStratum = validPolicyObject();
    inventedStratum.humanCoreStrata = ["foo"];
    expect(() => parseRebuildV3Policy(inventedStratum)).toThrow(
      /humanCoreStrata/u,
    );

    const droppedFamily = validPolicyObject();
    droppedFamily.hardNegativeFamilies = [
      "corporate-structure",
      "formulaic",
      "highly-polished",
      "motivational",
      "non-native",
    ];
    expect(() => parseRebuildV3Policy(droppedFamily)).toThrow(
      /hardNegativeFamilies/u,
    );

    const reorderedBands = validPolicyObject();
    reorderedBands.profileBands = ["200-plus", "80-199", "50-79"];
    expect(() => parseRebuildV3Policy(reorderedBands)).toThrow(/profileBands/u);

    const extraSnapshot = validPolicyObject();
    (extraSnapshot.humanSources as Record<string, unknown>).snapshots = [
      "b2w-reviews01",
      "carolina",
      "iberautextification",
      "pt-stackoverflow",
      "ptwiki",
    ];
    expect(() => parseRebuildV3Policy(extraSnapshot)).toThrow(
      /humanSources\.snapshots/u,
    );

    const extraStage = validPolicyObject();
    (extraStage.rollout as Record<string, unknown>).stages = [
      "bundle-verified",
      "shadow",
      "indicator",
      "actions",
    ];
    expect(() => parseRebuildV3Policy(extraStage)).toThrow(/rollout\.stages/u);
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

    // B2: pooling the two mixed cohorts, and letting a span authorize an action
    // on its own, are both decisions the frozen table settled the other way.
    const pooledCohorts = validPolicyObject();
    (
      pooledCohorts.materialAssistance as Record<string, unknown>
    ).cohortsAggregated = true;
    expect(() => parseRebuildV3Policy(pooledCohorts)).toThrow(
      /materialAssistance\.cohortsAggregated/u,
    );

    const gatingSpans = validPolicyObject();
    (gatingSpans.localization as Record<string, unknown>).metricsRole =
      "gating";
    expect(() => parseRebuildV3Policy(gatingSpans)).toThrow(
      /localization\.metricsRole/u,
    );

    const modes = validPolicyObject();
    (modes.materialAssistance as Record<string, unknown>).generationModes = [
      "mechanistic",
    ];
    expect(() => parseRebuildV3Policy(modes)).toThrow(
      /materialAssistance\.generationModes/u,
    );
  });
});

// C1 — the generation-lane table. Frozen here because the schema, the assembler
// (C2) and the generator matrix (D3) must read ONE table: `agy` serves 3 of the 4
// core families and is absent from the OOD family, so a detector that learned the
// harness signature would fail the OOD family for the wrong reason.
describe("generationLanes", () => {
  it("declares four lanes: one API and three CLIs", () => {
    expect(Object.keys(REBUILD_V3_POLICY.generationLanes).sort()).toEqual([
      "agy",
      "codex",
      "gemini-api",
      "gemini-cli",
    ]);
    const channels = Object.values(REBUILD_V3_POLICY.generationLanes).map(
      (row) => row.channel,
    );
    expect(channels.filter((channel) => channel === "api")).toHaveLength(1);
    expect(channels.filter((channel) => channel !== "api")).toHaveLength(3);
  });

  // MEASURED 2026-07-27 by probing agy directly: `--effort` is refused on
  // claude-sonnet-4-6 and claude-opus-4-6-thinking, and conflicts with models whose
  // id embeds the tier. So on agy the effort either IS the model id or does not
  // exist; it is never an independent flag. On codex it is real
  // (`model_reasoning_effort`) and reaches `xhigh`.
  it("records where effort is real and where it is the model id", () => {
    const agy = REBUILD_V3_POLICY.generationLanes.agy;
    expect(agy.effortConfigurable).toBe(false);
    expect([...agy.effortSources]).toEqual(["model-id", "not-supported"]);
    expect([...agy.effortLevels]).toEqual(["low", "medium", "high"]);

    const codex = REBUILD_V3_POLICY.generationLanes.codex;
    expect(codex.effortConfigurable).toBe(true);
    expect(codex.effortSources).toContain("flag");
    expect([...codex.effortLevels]).toEqual(["low", "medium", "high", "xhigh"]);

    // The two scales are DIFFERENT names, which is what stops a level from being
    // read as a shared ordinal across providers.
    expect(agy.effortScale).not.toBe(codex.effortScale);
  });

  it("derives the harness requirement from the channel, in one place", () => {
    for (const [lane, row] of Object.entries(
      REBUILD_V3_POLICY.generationLanes,
    )) {
      expect(laneRunsHarness(row)).toBe(row.channel !== "api");
      // Only the API lane accepts sampling parameters. A CLI takes no
      // temperature/top_p, which is why a temperature recorded on a CLI row
      // describes nothing.
      expect(row.decodingConfigurable).toBe(lane === "gemini-api");
    }
  });

  it("refuses a harness lane that claims configurable decoding", () => {
    const policy = validPolicyObject();
    const lanes = policy.generationLanes as Record<
      string,
      Record<string, unknown>
    >;
    lanes.agy = { ...lanes.agy, decodingConfigurable: true };
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /generationLanes\.agy\.decodingConfigurable/u,
    );
  });

  it("refuses a scale with no levels and levels with no scale", () => {
    const noLevels = validPolicyObject();
    const a = noLevels.generationLanes as Record<
      string,
      Record<string, unknown>
    >;
    a.agy = { ...a.agy, effortLevels: [] };
    expect(() => parseRebuildV3Policy(noLevels)).toThrow(
      /generationLanes\.agy\.effortLevels/u,
    );

    const noScale = validPolicyObject();
    const b = noScale.generationLanes as Record<
      string,
      Record<string, unknown>
    >;
    b.agy = { ...b.agy, effortScale: null };
    expect(() => parseRebuildV3Policy(noScale)).toThrow(
      /generationLanes\.agy\.effort(Levels|Scale)/u,
    );
  });

  it("refuses a configurable effort that no flag can set", () => {
    const policy = validPolicyObject();
    const lanes = policy.generationLanes as Record<
      string,
      Record<string, unknown>
    >;
    lanes.agy = { ...lanes.agy, effortConfigurable: true };
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /generationLanes\.agy\.effortConfigurable/u,
    );
  });

  it("refuses a lane dropped from the frozen vocabulary", () => {
    const policy = validPolicyObject();
    const lanes = { ...(policy.generationLanes as Record<string, unknown>) };
    delete lanes["gemini-cli"];
    policy.generationLanes = lanes;
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /generationLanes\.gemini-cli is missing/u,
    );
  });
});

describe("resampling estimand table", () => {
  function withResampling(
    mutate: (resampling: Record<string, unknown>) => void,
  ): Record<string, unknown> {
    const policy = validPolicyObject();
    const resampling = policy.resampling as Record<string, unknown>;
    mutate(resampling);
    return policy;
  }

  it("refuses a row of the frozen table being dropped", () => {
    const policy = withResampling((resampling) => {
      const classes = {
        ...(resampling.estimandClasses as Record<string, unknown>),
      };
      delete classes.mixed;
      resampling.estimandClasses = classes;
    });
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /resampling\.estimandClasses\.mixed is missing/u,
    );
  });

  it("refuses a multiway row that crosses fewer than two factors", () => {
    const policy = withResampling((resampling) => {
      const classes = {
        ...(resampling.estimandClasses as Record<string, unknown>),
      };
      classes.mixed = {
        unitKind: "multiway",
        levels: [{ axis: "groups.humanSeed", fallbacks: [] }],
      };
      resampling.estimandClasses = classes;
    });
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /fewer than two factors/u,
    );
  });

  it("refuses a level that is not a record grouping axis", () => {
    const policy = withResampling((resampling) => {
      const classes = {
        ...(resampling.estimandClasses as Record<string, unknown>),
      };
      classes["human-specificity"] = {
        unitKind: "hierarchical",
        levels: [{ axis: "record.id", fallbacks: [] }],
      };
      resampling.estimandClasses = classes;
    });
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /must name a record grouping axis/u,
    );
  });

  it("refuses a fallback that repeats the axis it falls back from", () => {
    const policy = withResampling((resampling) => {
      const classes = {
        ...(resampling.estimandClasses as Record<string, unknown>),
      };
      classes["human-specificity"] = {
        unitKind: "hierarchical",
        levels: [
          { axis: "groups.domainSource", fallbacks: [] },
          { axis: "groups.author", fallbacks: ["groups.author"] },
        ],
      };
      resampling.estimandClasses = classes;
    });
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /repeats the axis groups\.author/u,
    );
  });

  it("refuses a substituted factor that says what it replaces but not why", () => {
    // Half a declaration is worse than none: `proxyFor` on its own reads as a
    // synonym for the table's factor, which is exactly the impression that let a
    // degenerate stand-in pass for the crossed pair the table froze.
    const policy = withResampling((resampling) => {
      const classes = {
        ...(resampling.estimandClasses as Record<string, unknown>),
      };
      classes.mixed = {
        unitKind: "multiway",
        levels: [
          { axis: "groups.humanSeed", fallbacks: [] },
          {
            axis: "groups.promptTemplate",
            fallbacks: [],
            proxyFor: "operação de edição",
          },
        ],
      };
      resampling.estimandClasses = classes;
    });
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /proxyReason is required whenever the other is present/u,
    );
  });

  it("refuses an empty substitution string", () => {
    const policy = withResampling((resampling) => {
      const classes = {
        ...(resampling.estimandClasses as Record<string, unknown>),
      };
      classes.mixed = {
        unitKind: "multiway",
        levels: [
          { axis: "groups.humanSeed", fallbacks: [] },
          {
            axis: "groups.promptTemplate",
            fallbacks: [],
            proxyFor: "   ",
            proxyReason: "porque sim",
          },
        ],
      };
      resampling.estimandClasses = classes;
    });
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /proxyFor must be a non-empty string/u,
    );
  });

  it("refuses an estimand pointing at a row the table does not have", () => {
    const policy = withResampling((resampling) => {
      resampling.estimands = {
        ...(resampling.estimands as Record<string, unknown>),
        "warning.fpr": "independent-rows",
      };
    });
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /resampling\.estimands\.warning\.fpr must be one of/u,
    );
  });

  // `publishedBound` decides which estimator's limit a release gate reads, so it is
  // frozen exactly like `fallbackToIndependentRows` beside it: the parser refuses
  // any other value instead of handing the estimator a rule it does not implement.
  it("refuses a published-bound rule other than the frozen one", () => {
    const policy = withResampling((resampling) => {
      resampling.publishedBound = "resampled-only";
    });
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /resampling\.publishedBound is frozen at "wider-of-analytic-and-resampled"/u,
    );
  });

  it("refuses an extension for an estimand no row maps", () => {
    const policy = withResampling((resampling) => {
      resampling.estimandExtensions = {
        ...(resampling.estimandExtensions as Record<string, unknown>),
        "warning.precision": {
          standsInFor: "calibração (ECE, Brier)",
          reason: "porque sim",
        },
      };
    });
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /resampling\.estimandExtensions\.warning\.precision declares an extension for an estimand that resampling\.estimands does not map/u,
    );
  });

  it("refuses half an extension", () => {
    // The same both-or-neither rule the substituted factor follows: `standsInFor`
    // alone reads as a synonym and a bare reason leaves the row looking covered.
    const policy = withResampling((resampling) => {
      resampling.estimandExtensions = {
        "separability.auroc": { standsInFor: "calibração (ECE, Brier)" },
      };
    });
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /resampling\.estimandExtensions\.separability\.auroc/u,
    );
  });

  it("refuses an empty extension reason", () => {
    const policy = withResampling((resampling) => {
      resampling.estimandExtensions = {
        "separability.auroc": {
          standsInFor: "calibração (ECE, Brier)",
          reason: "   ",
        },
      };
    });
    expect(() => parseRebuildV3Policy(policy)).toThrow(
      /resampling\.estimandExtensions\.separability\.auroc\.reason must be a non-empty string/u,
    );
  });
});
