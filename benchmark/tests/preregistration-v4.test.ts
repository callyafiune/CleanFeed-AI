import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

import { RELEASE_CORPUS_POLICY } from "../dataset-manifest.ts";
import { EVALUATOR_FILES } from "../digests.ts";
import {
  declaredResamplingPlan,
  resamplingDesignFor,
  resamplingDesignOf,
  type EvaluationItem,
} from "../metrics.ts";
import {
  laneRunsHarness,
  parsePreregistrationV4,
  PREREGISTRATION_V4,
  PREREGISTRATION_V4_PATH,
  PreregistrationV4Error,
} from "../preregistration-v4.ts";
import { ALL_GROUP_AXES, type BenchmarkRecord } from "../schema.ts";
import { GROUP_KEYS } from "../split.ts";

// The frozen pre-registration of the v1 release. This file is the only place that
// repeats its values as literals: everywhere else in the benchmark must read them
// from the policy.

async function rawPolicyText(): Promise<string> {
  // CRLF is normalized away: this repo is checked out on Windows with
  // core.autocrlf, and the canonical form being asserted is the KEY ORDER and the
  // indentation, not the platform's newline.
  return (await readFile(PREREGISTRATION_V4_PATH, "utf8")).replace(
    /\r\n/gu,
    "\n",
  );
}

// Canonical form of the JSON file: object keys sorted by codepoint, two-space
// indentation, one trailing newline. Recomputed here so a hand edit that reorders a
// key or reformats a block fails instead of drifting silently.
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
  return JSON.parse(JSON.stringify(PREREGISTRATION_V4)) as Record<
    string,
    unknown
  >;
}

function block(
  policy: Record<string, unknown>,
  key: string,
): Record<string, unknown> {
  return policy[key] as Record<string, unknown>;
}

describe("preregistration-v4.json", () => {
  it("is stored in canonical JSON", async () => {
    const text = await rawPolicyText();
    const parsed = JSON.parse(text) as unknown;
    expect(text).toBe(`${JSON.stringify(canonicalize(parsed), null, 2)}\n`);
  });

  it("has exactly one formatting authority, so `npm run format` cannot move the evaluator digest", async () => {
    // Two tools may not decide the bytes of an EVALUATOR_FILES member.
    // `computeEvaluatorDigest` hashes this file raw, the canonical form asserted
    // above is `JSON.stringify(canonical, null, 2)`, and prettier would inline the
    // short arrays — so the file is in .prettierignore and the test above is the only
    // authority. If someone deletes that entry, `npm run format` starts rewriting a
    // hashed file and this fails first.
    // Resolved off the policy path, not off `import.meta.url`: Vite rewrites a
    // `new URL(..., import.meta.url)` literal into an asset URL that is not a `file:`
    // URL under vitest.
    const ignore = await readFile(
      join(dirname(PREREGISTRATION_V4_PATH), "..", ".prettierignore"),
      "utf8",
    );
    expect(
      ignore
        .split(/\r?\n/u)
        .map((line) => line.trim())
        .filter((line) => line !== "" && !line.startsWith("#")),
    ).toContain("benchmark/preregistration-v4.json");
  });

  // T15 — the swap is atomic in BOTH directions. The live pair is in the evaluator's
  // identity and the abandoned pair is out; a tree carrying both would hash a policy
  // nothing reads, and a tree carrying neither would let a budget move without moving
  // the digest.
  it("is part of the evaluator's identity, together with its validator, and the abandoned pair is not", () => {
    expect(EVALUATOR_FILES).toContain("benchmark/preregistration-v4.json");
    expect(EVALUATOR_FILES).toContain("benchmark/preregistration-v4.ts");
    expect(EVALUATOR_FILES).not.toContain("benchmark/rebuild-v3-policy.json");
    expect(EVALUATOR_FILES).not.toContain("benchmark/rebuild-v3-policy.ts");
    // The module that turns the pinned quantile into the ONE published cut.
    expect(EVALUATOR_FILES).toContain("benchmark/provisional-threshold.ts");
  });

  it("carries the ratified table verbatim", () => {
    const policy = PREREGISTRATION_V4;
    // Corpus identity, and the identifier it refuses by name.
    expect(policy.dataset.id).toBe("cleanfeed-ptbr-cells-v1");
    expect(policy.dataset.intendedDomain).toBe("scoped-cells");
    expect(policy.dataset.refusedIds.map((entry) => entry.id)).toEqual([
      "ptbr-generic-v1",
    ]);
    // Licence and use.
    expect(policy.commercialUse).toBe(false);
    expect(policy.attributionRequired).toBe(true);
    expect(policy.shareAlikeRequired).toBe(true);
    expect(policy.productTarget).toBe(
      "textual-compatibility-with-ai-generation",
    );
    expect(policy.infersAuthorship).toBe(false);
    // The four cells of the declared frame, and the strata that name them.
    expect(policy.humanCoreStrata).toEqual([
      "encyclopedic",
      "judicial",
      "social-media",
      "university",
    ]);
    // EMPTY, and that is a value: every cell of the frame has a declared snapshot.
    expect(policy.uncoveredCoreStrata).toEqual([]);
    expect(policy.preRegistration.quotaAxis.axis).toBe("cell");
    expect(policy.preRegistration.quotaAxis.cells).toEqual([
      "carolina-judicial",
      "carolina-social-media",
      "carolina-university",
      "ptwiki",
    ]);
    // Two snapshots: B2W is outside the frame, PT.SO is refused by name.
    expect(policy.humanSources.snapshots).toEqual(["carolina", "ptwiki"]);
    expect(policy.humanSources.newDownloadsAllowed).toBe(false);
    expect(policy.humanSources.blockedSnapshots).toEqual([
      {
        blockedBy: "access-terms-unresolved",
        snapshot: "pt-stackoverflow",
        unblockRequires: expect.stringContaining("termo de acesso"),
      },
    ]);
    expect(policy.hardNegativeFamilies).toEqual([
      "corporate-structure",
      "formulaic",
      "highly-polished",
      "motivational",
      "non-native",
      "repetitive",
    ]);
    expect(policy.profileBands).toEqual(["50-79", "80-199", "200-plus"]);
    expect(policy.rollout.stages).toEqual([
      "bundle-verified",
      "shadow",
      "indicator",
    ]);
    expect([...policy.materialAssistance.generationModes]).toEqual([
      "mechanistic",
      "ecological",
    ]);
    // The seven certifying hypotheses: one FPR ceiling per cell, recall, calibration
    // and integrity. Content AND order, because `m` is derived from the length.
    expect(policy.multiplicity.primaryFamily).toEqual([
      "calibration-global",
      "fpr-carolina-judicial",
      "fpr-carolina-social-media",
      "fpr-carolina-university",
      "fpr-ptwiki",
      "integrity",
      "recall-at-threshold",
    ]);
    expect(policy.multiplicity.primaryFamilySize).toBe(7);
    expect(policy.multiplicity.familyAlpha).toBe(0.05);
    expect(policy.multiplicity.correction).toBe("bonferroni");
    expect(policy.multiplicity.frozenAt).toBe("G0.2");
    // Derived and conferred, recomputed here from the formula the policy names so it
    // cannot agree by being the same literal.
    expect(policy.multiplicity.perHypothesisAlpha).toBe(0.007143);
    expect(
      Math.abs(policy.multiplicity.perHypothesisAlpha - 0.05 / 7),
    ).toBeLessThan(1e-6);
    expect(policy.preRegistration.zeroEventCeiling.ceilingAtAdoptedFloor).toBe(
      0.016337,
    );
    expect(
      Math.abs(
        policy.preRegistration.zeroEventCeiling.ceilingAtAdoptedFloor -
          (1 - policy.multiplicity.perHypothesisAlpha ** (1 / 300)),
      ),
    ).toBeLessThan(1e-6);
    // The floor per cell, written twice and joined by the parser.
    expect(policy.powerFloors.criticalFprHumanNegatives).toBe(300);
    expect(policy.powerFloors.criticalRecallPositives).toBe(200);
    expect(policy.powerFloors.samplingUnits).toBe(300);
    // ONE floor, read in three places, and which of the three is the `n` of the
    // published ceiling is the part that matters: it is the LINE floor, because that is
    // the FPR denominator. The unit floor is a different quantity that happens to carry
    // the same number, so the identity is asserted rather than assumed.
    expect(policy.preRegistration.zeroEventCeiling.adoptedFloorPerCell).toBe(
      policy.powerFloors.samplingUnits,
    );
    expect(policy.preRegistration.zeroEventCeiling.adoptedFloorPerCell).toBe(
      policy.powerFloors.criticalFprHumanNegatives,
    );
    expect(
      policy.preRegistration.zeroEventCeiling.ceilingAtAdoptedFloor,
    ).toBeCloseTo(
      1 -
        policy.multiplicity.perHypothesisAlpha **
          (1 / policy.powerFloors.criticalFprHumanNegatives),
      // Six places: the published number is rounded to six, and the parser accepts a
      // deviation up to DERIVED_TOLERANCE (1e-6) for exactly that reason.
      6,
    );
    expect(
      policy.preRegistration.zeroEventCeiling.unitsBelowFloorFailBeforeSealing,
    ).toBe(true);
    // Collection: the floor per cell, the TARGET per cell, and the total the target
    // implies over the four cells. The total rests on the target and not on the floor,
    // because the seal compares the composition for exact equality.
    expect(policy.collection.humanLinesPerCellMinimum).toBe(1500);
    expect(policy.collection.humanLinesPerCellTarget).toBe(1750);
    expect(policy.collection.humanLinesTotal).toBe(7000);
    expect(policy.collection.humanLinesTotal).toBe(
      policy.collection.humanLinesPerCellTarget *
        policy.preRegistration.quotaAxis.cells.length,
    );
    expect(policy.collection.humanLinesPerCellTarget).toBeGreaterThan(
      policy.collection.humanLinesPerCellMinimum,
    );
    expect(policy.collection.maximumLinesPerOriginDocument).toBe(1);
    // Partitions: re-derived, same values, and cal-B STAYS.
    expect(policy.preRegistration.partitionFractions).toEqual({
      calA: 0.1,
      calB: 0.2,
      dev: 0.05,
      test: 0.2,
      train: 0.45,
    });
    expect(policy.preRegistration.plannedCertifyingMeasurements).toBe(1);
    expect(policy.preRegistration.powerInventoryUnit).toBe(
      "connected-components",
    );
    expect(policy.preRegistration.crossVersionAdjustment).toBe("none");
    expect(policy.preRegistration.publicFeedbackAdaptation).toBe("none");
    expect(policy.preRegistration.eligibleCandidate).toBe(
      "weights-hash-from-f6-receipt",
    );
    expect(policy.parity.operationalMaximumInversions).toBe(0);
    // No calibrator on the v1, and the recall floor now lives here rather than in
    // benchmark/gates.ts.
    expect(policy.threshold.probabilisticCalibrator).toBe("none");
    expect(policy.threshold.basis).toBe("document-raw-score");
    expect(policy.threshold.side).toBe("upper");
    expect(policy.threshold.population).toBe("human-negatives");
    expect(policy.threshold.quantilePartitions).toEqual(["dev", "cal-A"]);
    expect(policy.threshold.quantile).toBe(1 - policy.fprBudgets.warning);
    expect(policy.calibrationGate.scoreBasis).toBe("document-raw-score");
    expect(policy.recallFloor).toBe(0.6);
    expect(policy.calibrator.reservedFor).toBe("v2");
    expect(policy.conformal).toEqual({
      population: "cal-b-humans",
      reservedFor: "v2",
    });
    // Backbone and the export ceiling. The ONNX number is a CEILING for
    // xlm-roberta-base and not the 109 681 931 of a backbone that is not ours.
    expect(policy.backbone).toBe("xlm-roberta-base");
    expect(policy.backboneBakeOff).toBe(false);
    expect(policy.onnxMaximumInt8Bytes).toBe(340_000_000);
    expect(policy.onnxMaximumInt8Bytes).toBeGreaterThan(278_000_000);
    // Seeds. The SPLIT seed is new — the abandoned pre-registration's draw was
    // inspected — while the bootstrap and cross-validation seeds are the inherited
    // ones, never spent on any measurement.
    expect(policy.seeds.publishableCheckpoint).toBe(712019);
    expect(policy.seeds.split).toBe(20260804);
    expect(policy.seeds.bootstrap).toBe(20260728);
    expect(policy.seeds.crossValidation).toBe(20260727);
    // The magnitudes the parser admits by SHAPE (integer, proportion, list of numbers)
    // rather than by value. Each one is a decision the abandoned policy's test pinned as
    // a literal, and each one would pass the parser at a different value: a policy is
    // only checkable where some literal is written down twice.
    expect(policy.bootstrapReplicates).toEqual({
      pilot: 10_000,
      release: 100_000,
    });
    expect(policy.training).toEqual({
      batchDocuments: 16,
      epochs: 3,
      learningRate: 0.00002,
      optimizer: "adamw",
      warmupFraction: 0.06,
      weightDecay: 0.01,
    });
    expect(policy.multiplicity.descriptiveConfidence).toBe(0.95);
    expect(policy.parity.rawMaximumMeanAbsDelta).toBe(0.02);
    expect(policy.blindReserveCompleteAttempts).toBe(2);
    expect(policy.profileValidityDays).toBe(180);
    expect(policy.temporalCohort.minimumDistinctTimestamps).toBe(4);
    expect(policy.wordFloor.abstainBelow).toBe(50);
    expect([...policy.predictiveValuePrevalences]).toEqual([0.01, 0.05, 0.1]);
    // And the four the gates read, restated here so the policy's own test is the one
    // place a reader can check the whole table without opening five other files.
    expect(policy.fprBudgets).toEqual({ visualAction: 0.02, warning: 0.05 });
    expect(policy.calibrationGate.eceMax).toBe(0.05);
    expect(policy.materialAssistance.minimumWarningRecall).toBe(0.5);
    // Connectivity: the dependency axis is declared and is NOT a union axis.
    expect(policy.connectivity.dependencyAxis).toBe("sourceMaterialBatch");
    expect(policy.connectivity.splitUnionsOnDependencyAxis).toBe(false);
    expect(policy.connectivity.diagnosticAxes).toEqual(["extractionRun"]);
    expect(policy.connectivity.reportedAxes).toEqual([
      "domainSource",
      "sourceMaterialBatch",
    ]);
    expect(policy.connectivity.independentUnit).toBe(
      "origin-document-components",
    );
  });

  // The mirror the parser cannot hold: the splitter READS this file, so importing
  // `GROUP_KEYS` into it would be a cycle. A policy that unions on a different set
  // from the splitter would publish a connectivity claim the split does not honour.
  it("declares exactly the split union axes the splitter uses", () => {
    expect([...PREREGISTRATION_V4.connectivity.splitUnionAxes]).toEqual([
      ...GROUP_KEYS,
    ]);
  });

  // The release seal must require exactly the strata the policy HAS a source for.
  // The two lists are not derived from each other on purpose — a derived list cannot
  // disagree with its source, so nothing would notice a rename on one side.
  it("requires exactly the core strata the frozen policy has a source for", () => {
    expect([...RELEASE_CORPUS_POLICY.requiredHumanSourceTypes].sort()).toEqual(
      [
        ...PREREGISTRATION_V4.humanCoreStrata.filter(
          (stratum) =>
            !PREREGISTRATION_V4.uncoveredCoreStrata.includes(stratum),
        ),
      ].sort(),
    );
    // And the human count the seal enforces is the total the pre-registration derives
    // from the collection TARGET, not from the per-cell floor: `sealDataset` compares
    // for exact equality, so a count at the floor would refuse the margin.
    expect(RELEASE_CORPUS_POLICY.counts.human).toBe(
      PREREGISTRATION_V4.collection.humanLinesTotal,
    );
    expect(RELEASE_CORPUS_POLICY.counts.human).toBeGreaterThan(
      PREREGISTRATION_V4.collection.humanLinesPerCellMinimum *
        PREREGISTRATION_V4.preRegistration.quotaAxis.cells.length,
    );
    expect(RELEASE_CORPUS_POLICY.counts.ai).toBe(4000);
    expect(RELEASE_CORPUS_POLICY.counts.mixed).toBe(2000);
  });

  it("is deeply frozen so no consumer can mutate the pre-registration at runtime", () => {
    expect(Object.isFrozen(PREREGISTRATION_V4)).toBe(true);
    expect(Object.isFrozen(PREREGISTRATION_V4.fprBudgets)).toBe(true);
    expect(Object.isFrozen(PREREGISTRATION_V4.humanCoreStrata)).toBe(true);
    expect(Object.isFrozen(PREREGISTRATION_V4.connectivity)).toBe(true);
  });

  it("derives the harness requirement from the channel, in one place", () => {
    for (const [lane, row] of Object.entries(
      PREREGISTRATION_V4.generationLanes,
    )) {
      expect(laneRunsHarness(row)).toBe(row.channel !== "api");
      expect(row.decodingConfigurable).toBe(lane === "gemini-api");
    }
  });
});

describe("parsePreregistrationV4 fails closed", () => {
  it("accepts the shipped policy unchanged", () => {
    expect(parsePreregistrationV4(validPolicyObject())).toEqual(
      PREREGISTRATION_V4,
    );
  });

  it("rejects a non-object", () => {
    for (const bad of [null, 42, "policy", []]) {
      expect(() => parsePreregistrationV4(bad)).toThrow(PreregistrationV4Error);
    }
  });

  it("never substitutes a default for a missing value", () => {
    const withoutThreshold = validPolicyObject();
    delete withoutThreshold.threshold;
    expect(() => parsePreregistrationV4(withoutThreshold)).toThrow(
      /threshold/u,
    );

    const withoutBudget = validPolicyObject();
    delete block(withoutBudget, "fprBudgets").warning;
    expect(() => parsePreregistrationV4(withoutBudget)).toThrow(
      /fprBudgets\.warning/u,
    );

    expect(() => parsePreregistrationV4({})).toThrow(PreregistrationV4Error);
  });

  it("rejects an unknown key instead of ignoring it", () => {
    const extra = { ...validPolicyObject(), warningFprBudget: 0.07 };
    expect(() => parsePreregistrationV4(extra)).toThrow(/warningFprBudget/u);

    // The two residues of the v3 pre-registration that must NOT come back: the
    // ceiling at n = 512 and the "if A1 is reverted" quota axis.
    const withCeilingAt512 = validPolicyObject();
    (
      block(
        block(withCeilingAt512, "preRegistration"),
        "zeroEventCeiling",
      ) as Record<string, unknown>
    ).ceilingAt512 = 0.008522;
    expect(() => parsePreregistrationV4(withCeilingAt512)).toThrow(
      /preRegistration\.zeroEventCeiling\.ceilingAt512 is not a policy key/u,
    );

    const withRevertedAxis = validPolicyObject();
    (
      block(block(withRevertedAxis, "preRegistration"), "quotaAxis") as Record<
        string,
        unknown
      >
    ).axisIfA1Reverted = "record";
    expect(() => parsePreregistrationV4(withRevertedAxis)).toThrow(
      /preRegistration\.quotaAxis\.axisIfA1Reverted is not a policy key/u,
    );
  });

  // T1 — every frozen field is pinned by the PARSER and not only by a test, and the
  // refusal names the path. A unilateral edit of the JSON is refused; a unilateral
  // edit of the parser makes the shipped JSON stop loading.
  it("pins each frozen field to its value, naming the path", () => {
    const cases: {
      readonly path: string;
      readonly mutate: (policy: Record<string, unknown>) => void;
    }[] = [
      {
        path: "backbone",
        mutate: (policy) => {
          policy.backbone = "neuralmind/bert-base-portuguese-cased";
        },
      },
      {
        path: "recallFloor",
        // 0.55, not 1.5: a value out of (0,1) is refused by the proportion check that
        // every other proportion in the file also has, so it never measured the PIN.
        // 0.55 is a legal proportion and a different gate bound, which is the edit that
        // actually happens.
        mutate: (policy) => {
          policy.recallFloor = 0.55;
        },
      },
      {
        path: "dataset.id",
        mutate: (policy) => {
          block(policy, "dataset").id = "cleanfeed-ptbr-cells-v2";
        },
      },
      {
        path: "dataset.intendedDomain",
        mutate: (policy) => {
          block(policy, "dataset").intendedDomain = "generic";
        },
      },
      {
        path: "humanCoreStrata",
        mutate: (policy) => {
          policy.humanCoreStrata = [
            "encyclopedic",
            "institutional",
            "social-media",
            "university",
          ];
        },
      },
      {
        path: "humanSources.snapshots",
        mutate: (policy) => {
          block(policy, "humanSources").snapshots = [
            "b2w-reviews01",
            "carolina",
            "ptwiki",
          ];
        },
      },
      {
        path: "multiplicity.primaryFamily",
        mutate: (policy) => {
          block(policy, "multiplicity").primaryFamily = [
            "calibration-global",
            "fpr-worst-core-stratum",
            "integrity",
            "recall-at-threshold",
          ];
        },
      },
      {
        path: "preRegistration.quotaAxis.cells",
        mutate: (policy) => {
          (
            block(block(policy, "preRegistration"), "quotaAxis") as Record<
              string,
              unknown
            >
          ).cells = [
            "b2w",
            "carolina-judicial",
            "carolina-university",
            "ptwiki",
          ];
        },
      },
      {
        path: "powerFloors.criticalFprHumanNegatives",
        mutate: (policy) => {
          block(policy, "powerFloors").criticalFprHumanNegatives = 250;
        },
      },
      {
        path: "collection.humanLinesPerCellMinimum",
        mutate: (policy) => {
          block(policy, "collection").humanLinesPerCellMinimum = 1250;
        },
      },
      {
        path: "seeds.publishableCheckpoint",
        mutate: (policy) => {
          block(policy, "seeds").publishableCheckpoint = 712020;
        },
      },
      {
        path: "threshold.probabilisticCalibrator",
        mutate: (policy) => {
          block(policy, "threshold").probabilisticCalibrator = "platt";
        },
      },
      {
        path: "threshold.basis",
        mutate: (policy) => {
          block(policy, "threshold").basis = "calibrated-probability";
        },
      },
      {
        path: "conformal.reservedFor",
        mutate: (policy) => {
          block(policy, "conformal").reservedFor = "v1";
        },
      },
      {
        path: "conformal.population",
        mutate: (policy) => {
          block(policy, "conformal").population = "cal-a-humans";
        },
      },
      {
        path: "connectivity.dependencyAxis",
        mutate: (policy) => {
          block(policy, "connectivity").dependencyAxis = "domainSource";
        },
      },
      {
        path: "connectivity.splitUnionsOnDependencyAxis",
        mutate: (policy) => {
          block(policy, "connectivity").splitUnionsOnDependencyAxis = true;
        },
      },
      {
        path: "connectivity.splitUnionAxes",
        mutate: (policy) => {
          block(policy, "connectivity").splitUnionAxes = [
            "author",
            "source",
            "domainSource",
            "generatorVersion",
            "promptTemplate",
            "generationBatch",
            "nearDuplicate",
            "derivationRoot",
          ];
        },
      },
      {
        path: "parity.operationalMaximumInversions",
        mutate: (policy) => {
          block(policy, "parity").operationalMaximumInversions = 1;
        },
      },
      {
        path: "preRegistration.plannedCertifyingMeasurements",
        mutate: (policy) => {
          block(policy, "preRegistration").plannedCertifyingMeasurements = 2;
        },
      },
      {
        path: "backboneBakeOff",
        mutate: (policy) => {
          policy.backboneBakeOff = true;
        },
      },
      {
        path: "calibrationGate.scoreBasis",
        mutate: (policy) => {
          block(policy, "calibrationGate").scoreBasis =
            "calibrated-probability";
        },
      },
      {
        path: "humanSources.blockedSnapshots",
        mutate: (policy) => {
          block(policy, "humanSources").blockedSnapshots = [];
        },
      },
    ];
    for (const testCase of cases) {
      const policy = validPolicyObject();
      testCase.mutate(policy);
      let thrown: unknown = null;
      try {
        parsePreregistrationV4(policy);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, testCase.path).toBeInstanceOf(PreregistrationV4Error);
      const error = thrown as PreregistrationV4Error;
      expect(error.path, testCase.path).toMatch(
        new RegExp(
          `^${testCase.path.replace(/[.[\]]/gu, (char) => `\\${char}`)}`,
          "u",
        ),
      );
    }
  });

  // The one pin that is NOT a `literal`: dropping the blocked snapshot is refused
  // because the refusal by name is what makes re-adding PT.SO a diagnosis.
  it("refuses a policy that stops naming the blocked snapshot", () => {
    const policy = validPolicyObject();
    block(policy, "humanSources").blockedSnapshots = [];
    expect(() => parsePreregistrationV4(policy)).toThrow(
      /must still block "pt-stackoverflow" by name/u,
    );
  });

  // T2 — the family moved to m = 7 and the per-hypothesis alpha stayed at the m = 4
  // value. The two are written down separately because a reader must not have to
  // divide, and this is exactly the defect that pairing exists to catch.
  it("refuses an alpha stranded at the m = 4 value", () => {
    const policy = validPolicyObject();
    block(policy, "multiplicity").perHypothesisAlpha = 0.0125;
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe(
      "multiplicity.perHypothesisAlpha",
    );
    expect((thrown as Error).message).toMatch(
      /a Bonferroni alpha may not disagree with its own m/u,
    );
  });

  // T3 — `test` and `cal-B` swapped. The SUM is still 1, so a sum check alone would
  // load a policy whose published quota was computed for a test partition of a
  // different size.
  it("refuses test and cal-B swapped even though the fractions still sum to one", () => {
    const policy = validPolicyObject();
    const fractions = block(
      block(policy, "preRegistration"),
      "partitionFractions",
    );
    fractions.test = 0.2;
    fractions.calB = 0.2;
    // Swapping two equal values changes nothing, so the mutation that must be caught
    // is the one that MOVES mass between them.
    fractions.test = 0.05;
    fractions.calB = 0.35;
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toMatch(
      /^preRegistration\.partitionFractions\.(test|calB)$/u,
    );
  });

  it("keeps the five fractions summing to one, which is what a fifth edit would break", () => {
    // Every fraction is pinned to its value, so the parser refuses a single edit
    // before the sum is ever consulted. The sum check is what survives a FUTURE
    // re-derivation that moves every pin together: an unimplemented decision has no
    // runtime that would notice it does not add up, so the total is asserted on the
    // shipped file too.
    const fractions = PREREGISTRATION_V4.preRegistration.partitionFractions;
    const total =
      fractions.train +
      fractions.dev +
      fractions.calA +
      fractions.calB +
      fractions.test;
    expect(Math.abs(total - 1)).toBeLessThan(1e-6);
    // And `test` is exactly the floor over the collection target, which is where the
    // 0.20 came from: 300 lines in `test` out of 1.500 per cell.
    expect(
      PREREGISTRATION_V4.collection.humanLinesPerCellMinimum * fractions.test,
    ).toBe(PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives);
  });

  // T4 — the floor per cell is ONE decision written in two places.
  it("refuses the floor written twice with two values", () => {
    const policy = validPolicyObject();
    block(policy, "powerFloors").samplingUnits = 250;
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe(
      "powerFloors.samplingUnits",
    );
  });

  it("refuses the ceiling's own floor moved away from the power floor", () => {
    const policy = validPolicyObject();
    (
      block(block(policy, "preRegistration"), "zeroEventCeiling") as Record<
        string,
        unknown
      >
    ).adoptedFloorPerCell = 250;
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe(
      "preRegistration.zeroEventCeiling.adoptedFloorPerCell",
    );
  });

  // T5 — the published ceiling carried over from the v3 pre-registration, where the
  // family was m = 4 and the floor was n = 250.
  it("refuses the v3 ceiling under the v4 family and floor", () => {
    const policy = validPolicyObject();
    (
      block(block(policy, "preRegistration"), "zeroEventCeiling") as Record<
        string,
        unknown
      >
    ).ceilingAtAdoptedFloor = 0.017375;
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe(
      "preRegistration.zeroEventCeiling.ceilingAtAdoptedFloor",
    );
    expect((thrown as Error).message).toMatch(/1 - 0\.007143\^\(1\/300\)/u);
  });

  // T6 — the empty list is a VALUE the parser accepts, and the two ways of getting it
  // wrong get two different diagnoses.
  it("accepts an empty uncoveredCoreStrata and refuses an entry that is not a stratum", () => {
    const shipped = validPolicyObject();
    expect(shipped.uncoveredCoreStrata).toEqual([]);
    expect(() => parsePreregistrationV4(shipped)).not.toThrow();

    const notAStratum = validPolicyObject();
    notAStratum.uncoveredCoreStrata = ["qa-informal"];
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(notAStratum);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe("uncoveredCoreStrata");
    expect((thrown as Error).message).toMatch(
      /names "qa-informal", which is not one of the core strata/u,
    );

    // A real stratum declared uncovered is a different mistake: the frame has a
    // source for all four, so the list is frozen empty.
    const realStratum = validPolicyObject();
    realStratum.uncoveredCoreStrata = ["judicial"];
    expect(() => parsePreregistrationV4(realStratum)).toThrow(
      /uncoveredCoreStrata is frozen at \[\]/u,
    );

    // And it must still be a list of strings, not a scalar or an object.
    const notAList = validPolicyObject();
    notAList.uncoveredCoreStrata = "";
    expect(() => parsePreregistrationV4(notAList)).toThrow(
      /uncoveredCoreStrata must be an array/u,
    );
  });

  it("refuses a live dataset id that is also refused by name", () => {
    const policy = validPolicyObject();
    block(policy, "dataset").refusedIds = [
      {
        id: "cleanfeed-ptbr-cells-v1",
        refusedBecause: "porque sim",
      },
    ];
    expect(() => parsePreregistrationV4(policy)).toThrow(
      /an identifier cannot be both live and dead/u,
    );
  });

  it("refuses a policy that stops refusing the abandoned dataset id", () => {
    const policy = validPolicyObject();
    block(policy, "dataset").refusedIds = [
      { id: "ptbr-generic-v2", refusedBecause: "porque sim" },
    ];
    expect(() => parsePreregistrationV4(policy)).toThrow(
      /must still refuse "ptbr-generic-v1" by name/u,
    );
  });

  it("refuses a union that includes the dependency axis", () => {
    const policy = validPolicyObject();
    block(policy, "connectivity").splitUnionAxes = [
      "author",
      "source",
      "generatorVersion",
      "promptTemplate",
      "generationBatch",
      "nearDuplicate",
      "derivationRoot",
      "sourceMaterialBatch",
    ];
    expect(() => parsePreregistrationV4(policy)).toThrow(
      /connectivity\.splitUnionAxes/u,
    );
  });

  it("refuses a quantile that does not leave the FPR budget as its tail", () => {
    const policy = validPolicyObject();
    block(policy, "threshold").quantile = 0.99;
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe("threshold.quantile");
    expect((thrown as Error).message).toMatch(
      /the budget is the tail the quantile leaves/u,
    );
  });

  // The mutation that MATTERS here is the one the abandoned design made by hand: a
  // total derived from the per-cell FLOOR instead of the target. 4 x 1500 = 6000 is
  // arithmetically impeccable and still wrong, because the seal compares the
  // composition for exact equality and would then refuse every corpus that carries
  // the collection margin.
  it("refuses a total taken over the per-cell FLOOR instead of the target", () => {
    const policy = validPolicyObject();
    block(policy, "collection").humanLinesTotal = 6000;
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe(
      "collection.humanLinesTotal",
    );
    expect((thrown as Error).message).toMatch(
      /at the TARGET of 1750 lines each is 7000/u,
    );
  });

  it("refuses a collection target below the floor it has to satisfy", () => {
    const policy = validPolicyObject();
    block(policy, "collection").humanLinesPerCellTarget = 1400;
    expect(() => parsePreregistrationV4(policy)).toThrow(
      /collection\.humanLinesPerCellTarget/u,
    );
  });

  // Equality, not just being under: a target EQUAL to the floor keeps every
  // arithmetic identity intact (4 x 1500 = 6000) and erases the margin silently,
  // which is the direction a re-derivation actually drifts in.
  it("refuses a collection target that merely EQUALS the floor", () => {
    const policy = validPolicyObject();
    const collection = block(policy, "collection");
    collection.humanLinesPerCellTarget = 1500;
    collection.humanLinesTotal = 6000;
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe(
      "collection.humanLinesPerCellTarget",
    );
    expect((thrown as Error).message).toMatch(
      /standard deviation of roughly 15 lines/u,
    );
  });
});

// ---------------------------------------------------------------------------
// The resampling table over the v4 axes, and the widening that makes it
// reachable. The deferral this closes: metrics.ts read a v3-only axis tuple, so
// naming a v4 axis in the table threw before any measurement could run.
// ---------------------------------------------------------------------------

describe("the resampling table names v4 axes and metrics.ts accepts them", () => {
  it("nests the AI-recall row on the generation batch, not on the axis v4 deleted", () => {
    const row = PREREGISTRATION_V4.resampling.estimandClasses["ai-recall"];
    expect(row.unitKind).toBe("hierarchical");
    expect(row.levels.map((level) => level.axis)).toEqual([
      "groups.generatorFamily",
      "groups.promptTemplate",
      "groups.generationBatch",
    ]);
    // `collectionBatch` does not exist in v4 and may not survive anywhere in the
    // sealed table — including as a fallback, which would freeze a dead axis.
    expect(JSON.stringify(PREREGISTRATION_V4.resampling)).not.toContain(
      "collectionBatch",
    );
  });

  it("keeps domainSource legal as a table axis while it is no longer a union axis", () => {
    // Two different questions. `domainSource` is the cell's stratum and the outer
    // level of the human rows; it stopped being an axis the SPLITTER unions on, which
    // is what `connectivity.splitUnionAxes` says.
    for (const estimand of ["human-specificity", "calibration"] as const) {
      expect(
        PREREGISTRATION_V4.resampling.estimandClasses[estimand].levels[0].axis,
      ).toBe("groups.domainSource");
    }
    expect([...PREREGISTRATION_V4.connectivity.splitUnionAxes]).not.toContain(
      "domainSource",
    );
    // The human outer level is the cell, and the inner unit is the author inside it.
    expect(
      PREREGISTRATION_V4.resampling.estimandClasses["human-specificity"]
        .levels[1],
    ).toEqual({ axis: "groups.author", fallbacks: ["groups.source"] });
  });

  it("builds the design of every mapped estimand instead of throwing on a v4 axis", () => {
    // This is what the deferral cost: with a v3-only axis set, `resamplingDesignFor`
    // threw a RangeError naming `groups.generationBatch` before a single item was
    // read, so no downstream guard was reachable.
    for (const estimand of Object.keys(
      PREREGISTRATION_V4.resampling.estimands,
    )) {
      expect(() => resamplingDesignFor(estimand), estimand).not.toThrow();
    }
    const recall = resamplingDesignFor("warning.recall");
    expect(recall.method).toBe("hierarchical");
    expect(
      recall.method === "hierarchical"
        ? recall.levels.map((chain) => chain.declared.axis)
        : [],
    ).toEqual([
      "groups.generatorFamily",
      "groups.promptTemplate",
      "groups.generationBatch",
    ]);
  });

  it("publishes the declared plan over the v4 axes, sourced from the new policy", () => {
    const plan = declaredResamplingPlan();
    expect(plan.planId).toBe(
      `c4-resampling-plan/${PREREGISTRATION_V4.policyVersion}`,
    );
    expect(plan.source).toBe("benchmark/preregistration-v4.json#resampling");
    const recall = plan.entries.find(
      (entry) => entry.estimand === "warning.recall",
    );
    expect(recall?.unitAxes).toEqual([
      "groups.generatorFamily",
      "groups.promptTemplate",
      "groups.generationBatch",
    ]);
  });

  it("refuses an estimand no row of the table covers", () => {
    // A DIFFERENT refusal from the one below, and the two used to be conflated: this
    // one fires while looking the estimand up, before any axis is read.
    expect(() => resamplingDesignFor("no.such.estimand")).toThrow(
      /no row of the frozen resampling table covers the estimand/u,
    );
  });

  it("refuses a level naming something no record version declares as an axis", () => {
    // The widening is to the UNION over versions, not to "any string": a synthetic
    // per-row key is the one thing R6 forbids outright, and a typo must not read as
    // an axis that is simply unknown on every row. Exercised through the class row,
    // because the frozen table on disk names no such axis and a policy that did name
    // one would be refused by the parser first.
    expect(ALL_GROUP_AXES).toContain("generationBatch");
    expect(ALL_GROUP_AXES).not.toContain("recordId");
    expect(() =>
      resamplingDesignOf("warning.recall", {
        unitKind: "hierarchical",
        levels: [{ axis: "groups.recordId", fallbacks: [] }],
      }),
    ).toThrow(
      /the resampling table names "groups\.recordId", which is not a record grouping axis/u,
    );
    // A FALLBACK is built by the same helper, so the refusal has to reach there too.
    expect(() =>
      resamplingDesignOf("warning.recall", {
        unitKind: "hierarchical",
        levels: [
          { axis: "groups.generatorFamily", fallbacks: ["groups.recordId"] },
        ],
      }),
    ).toThrow(/which is not a record grouping axis/u);
  });
});

// ---------------------------------------------------------------------------
// The batch level reads the OLDER schema spelling of the same fact, and stops at
// human rows. The frozen table names `groups.generationBatch`, which only v4
// declares, while every corpus on disk is v2 or v3 and spells that fact
// `collectionBatch` — but only on a GENERATED row. On a human row the same v3 key
// held the extraction run, a different fact that may not be read as a batch.
// ---------------------------------------------------------------------------

describe("the AI-recall batch level across schema versions", () => {
  // The batch is the innermost level of the ai-recall row, so its chain is the one the
  // alias decides. Looked up by axis NAME and not by index, so a reordered table fails
  // here instead of silently testing a different level.
  function batchLevel() {
    const design = resamplingDesignFor("warning.recall");
    if (design.method !== "hierarchical") {
      throw new Error("the ai-recall row is hierarchical");
    }
    const chain = design.levels.find(
      (level) => level.declared.axis === "groups.generationBatch",
    );
    if (chain === undefined) {
      throw new Error(
        "no level of the ai-recall row names the generation batch",
      );
    }
    return chain.declared;
  }

  function itemWith(
    label: "human" | "ai",
    groups: Record<string, unknown>,
  ): EvaluationItem {
    const record = {
      label,
      language: "pt-BR",
      wordCount: 120,
      domain: "corporate",
      platform: "generic-platform",
      provenance: { sourceId: "corpus-generic" },
      createdAt: 1_000,
      transformation: { kind: "none", severity: "none" },
      groups,
    } as unknown as BenchmarkRecord;
    return {
      record,
      status: "scored",
      documentScore: 0.5,
      warned: false,
      visualActioned: false,
    };
  }

  it("resolves a v4 generated row by its OWN generationBatch", () => {
    const identity = batchLevel().identity(
      itemWith("ai", {
        generatorFamily: { state: "known", id: "gpt" },
        promptTemplate: { state: "known", id: "tpl-a" },
        generationBatch: { state: "known", id: "gb_v4" },
        collectionBatch: { state: "known", id: "cb_decoy" },
      }),
    );
    // The record's own axis wins over the older spelling: both keys are present and
    // the v4 one answers, so the alias never fires on a v4 row.
    expect(identity).toEqual({ state: "known", id: "gb_v4" });
  });

  it("resolves a v3 GENERATED row by the collectionBatch it actually carries", () => {
    // The IDENTITY, not the level count. A count is the same under any alias target:
    // mapping the batch onto `promptTemplate` would give an identical number of levels
    // over a different unit, which is why this asserts the id itself.
    const identity = batchLevel().identity(
      itemWith("ai", {
        generatorFamily: { state: "known", id: "gpt" },
        promptTemplate: { state: "known", id: "tpl-a" },
        collectionBatch: { state: "known", id: "cb_v3_generated" },
      }),
    );
    expect(identity).toEqual({ state: "known", id: "cb_v3_generated" });
  });

  it("resolves a v2 GENERATED row by its string-valued collectionBatch", () => {
    const identity = batchLevel().identity(
      itemWith("ai", {
        generatorFamily: "gpt",
        promptTemplate: "tpl-a",
        collectionBatch: "cb_v2_generated",
      }),
    );
    expect(identity).toEqual({ state: "known", id: "cb_v2_generated" });
  });

  it("leaves a v3 HUMAN row unknown instead of reading its extraction run", () => {
    // On a human row the v3 `collectionBatch` held the EXTRACTION RUN — one local run
    // of a deterministic extractor, which is not a statistical unit. Reading it as a
    // generation batch would build clusters out of extractor invocations and narrow
    // every interval that rests on this level.
    const identity = batchLevel().identity(
      itemWith("human", {
        author: { state: "known", id: "a1" },
        domainSource: { state: "known", id: "ptwiki" },
        collectionBatch: { state: "known", id: "extraction_ptwiki_01" },
      }),
    );
    expect(identity).toEqual({ state: "unknown" });
  });

  it("leaves a v2 HUMAN row unknown for the same reason", () => {
    const identity = batchLevel().identity(
      itemWith("human", {
        author: "a1",
        domainSource: "ptwiki",
        collectionBatch: "extraction_ptwiki_01",
      }),
    );
    expect(identity).toEqual({ state: "unknown" });
  });

  it("maps the batch onto exactly one older name and nothing else", () => {
    // The alias is not a general fallback chain: a generated row declaring NO batch
    // under either spelling stays unknown rather than demoting onto whichever axis the
    // row happens to carry.
    const identity = batchLevel().identity(
      itemWith("ai", {
        generatorFamily: { state: "known", id: "gpt" },
        promptTemplate: { state: "known", id: "tpl-a" },
      }),
    );
    expect(identity).toEqual({ state: "unknown" });
  });

  it("keeps a DECLARED unknown batch unknown, on both spellings", () => {
    // Inside a version that declares the axis, an explicit `unknown` is a gap, and the
    // alias may not paper over it with the other spelling.
    expect(
      batchLevel().identity(
        itemWith("ai", {
          generatorFamily: { state: "known", id: "gpt" },
          generationBatch: { state: "unknown" },
          collectionBatch: { state: "known", id: "cb_would_paper_over" },
        }),
      ),
    ).toEqual({ state: "unknown" });
    expect(
      batchLevel().identity(
        itemWith("ai", {
          generatorFamily: { state: "known", id: "gpt" },
          collectionBatch: { state: "unknown" },
        }),
      ),
    ).toEqual({ state: "unknown" });
  });

  it("passes notApplicable through instead of turning it into a gap", () => {
    // `notApplicable` demotes to the next unit the source declares; `unknown` fails.
    // benchmark/bootstrap.ts enforces that difference, so the level has to report it.
    expect(
      batchLevel().identity(
        itemWith("ai", {
          generatorFamily: { state: "known", id: "gpt" },
          collectionBatch: { state: "notApplicable" },
        }),
      ),
    ).toEqual({ state: "notApplicable" });
  });
});
