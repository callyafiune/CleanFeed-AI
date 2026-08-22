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
  derivedHumanLinesTotal,
  laneExposesDecoding,
  laneRunsHarness,
  parsePreregistrationV4,
  PREREGISTRATION_V4,
  PREREGISTRATION_V4_PATH,
  PreregistrationV4Error,
} from "../preregistration-v4.ts";
import {
  ALL_GROUP_AXES,
  groupAxisIdentity,
  validateBenchmarkRecordV4,
  type BenchmarkRecord,
} from "../schema.ts";
import { connectedComponentRoots, GROUP_KEYS } from "../split.ts";
import { EXPOSURE_IDENTITY_AXES } from "../cluster-exposure-ledger.ts";
import { REPORTED_GROUP_AXES } from "../split-audit.ts";
import { known, v4Ai, withAxis } from "./helpers/v3-record-fixture.ts";

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
    // The ONE cell of the declared frame, and the ONE spelling of it: since the frame
    // amendment `humanCoreStrata` and `quotaAxis.cells` are the same string, because two
    // vocabularies for the field a gate reads is what made the lab write a corpus every
    // gate counted as empty.
    expect(policy.humanCoreStrata).toEqual(["ptwiki"]);
    expect(policy.preRegistration.quotaAxis.cells).toEqual(["ptwiki"]);
    expect([...policy.humanCoreStrata]).toEqual([
      ...policy.preRegistration.quotaAxis.cells,
    ]);
    // EMPTY, and that is a value: the cell of the frame has a declared snapshot. The
    // three Carolina typologies are NOT here — they are out of frame, which is a
    // different fact from a declared cell with no material.
    expect(policy.uncoveredCoreStrata).toEqual([]);
    expect(policy.preRegistration.quotaAxis.axis).toBe("cell");
    // ONE snapshot: B2W and Carolina are outside the frame, PT.SO is refused by name.
    expect(policy.humanSources.snapshots).toEqual(["ptwiki"]);
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
    // The four certifying hypotheses: one FPR ceiling per cell, recall, calibration
    // and integrity. Content AND order, because `m` is derived from the length.
    expect(policy.multiplicity.primaryFamily).toEqual([
      "calibration-global",
      "fpr-ptwiki",
      "integrity",
      "recall-at-threshold",
    ]);
    expect(policy.multiplicity.primaryFamilySize).toBe(4);
    // And the family carries exactly one `fpr-<cell>` per declared cell: the gate derives
    // its hypothesis name that way (`cellFprHypothesis` in benchmark/gates.ts), so a cell
    // with no member is a hypothesis nothing decides and a member with no cell is a
    // hypothesis no corpus can produce.
    expect(
      policy.multiplicity.primaryFamily.filter((member) =>
        member.startsWith("fpr-"),
      ),
    ).toEqual(
      policy.preRegistration.quotaAxis.cells.map((cell) => `fpr-${cell}`),
    );
    expect(policy.multiplicity.familyAlpha).toBe(0.05);
    expect(policy.multiplicity.correction).toBe("bonferroni");
    expect(policy.multiplicity.frozenAt).toBe("G0.2");
    // Derived and conferred, recomputed here from the formula the policy names so it
    // cannot agree by being the same literal.
    expect(policy.multiplicity.perHypothesisAlpha).toBe(0.0125);
    expect(
      Math.abs(policy.multiplicity.perHypothesisAlpha - 0.05 / 4),
    ).toBeLessThan(1e-6);
    expect(policy.preRegistration.zeroEventCeiling.ceilingAtAdoptedFloor).toBe(
      0.014501,
    );
    expect(
      Math.abs(
        policy.preRegistration.zeroEventCeiling.ceilingAtAdoptedFloor -
          (1 - policy.multiplicity.perHypothesisAlpha ** (1 / 300)),
      ),
    ).toBeLessThan(1e-6);
    // The SECOND point of the same formula: the ceiling the collection is sized for, at
    // the blind block the target implies. Both are recomputed here from the formula the
    // policy names, so neither can agree by being the same literal.
    expect(
      policy.preRegistration.zeroEventCeiling.blindBlockLinesAtCollectionTarget,
    ).toBe(800);
    expect(
      policy.preRegistration.zeroEventCeiling.ceilingAtCollectionTarget,
    ).toBe(0.005463);
    expect(
      Math.abs(
        policy.preRegistration.zeroEventCeiling.ceilingAtCollectionTarget -
          (1 - policy.multiplicity.perHypothesisAlpha ** (1 / 800)),
      ),
    ).toBeLessThan(1e-6);
    // The blind block of the target is DERIVED, not a third number: 4.000 lines per cell
    // at a test fraction of 0.20.
    expect(
      policy.preRegistration.zeroEventCeiling.blindBlockLinesAtCollectionTarget,
    ).toBe(
      policy.collection.humanLinesPerCellTarget *
        policy.preRegistration.partitionFractions.test,
    );
    // More lines can only TIGHTEN a zero-event ceiling, and publishing the pair in the
    // wrong order is how the looser number reaches a model card.
    expect(
      policy.preRegistration.zeroEventCeiling.ceilingAtCollectionTarget,
    ).toBeLessThan(
      policy.preRegistration.zeroEventCeiling.ceilingAtAdoptedFloor,
    );
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
    // implies over the ONE cell. The total rests on the target and not on the floor,
    // because the seal compares the composition for exact equality.
    expect(policy.collection.humanLinesPerCellMinimum).toBe(1500);
    expect(policy.collection.humanLinesPerCellTarget).toBe(4000);
    expect(policy.collection.humanLinesTotal).toBe(4000);
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
    // Backbone and the export ceiling, which are ONE decision: the ceiling is sized
    // for THIS architecture's embedding matrix. The ONNX number is a CEILING and not
    // the target — a measured int8 export of this backbone is 109 681 931 bytes, and
    // the headroom is what a legitimate re-export (opset, quantization parameters,
    // head shape) is allowed to differ by.
    expect(policy.backbone).toBe("neuralmind/bert-base-portuguese-cased");
    expect(policy.backboneBakeOff).toBe(false);
    expect(policy.onnxMaximumInt8Bytes).toBe(130_000_000);
    expect(policy.onnxMaximumInt8Bytes).toBeGreaterThan(109_681_931);
    // Still refuses the two failure modes it exists for: an export that leaves the
    // 29 794 x 768 embedding table in fp32 (~1.78e8 bytes) and any encoder with a
    // 250 002-row embedding matrix (~2.8e8 int8).
    expect(policy.onnxMaximumInt8Bytes).toBeLessThan(178_327_307);
    expect(policy.onnxMaximumInt8Bytes).toBeLessThan(280_000_000);
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
      "generatorVersion",
    ]);
    // The SAME value `preRegistration.powerInventoryUnit` is asserted to hold above,
    // and one constant stands behind both `literal` calls in the parser, so a policy
    // outside this spelling is refused at PARSE and never reaches an assertion.
    expect(policy.connectivity.independentUnit).toBe("connected-components");
  });

  // The mirror the parser cannot hold either, and for the same reason as the union
  // axes below: benchmark/split-audit.ts imports `PREREGISTRATION_V4`, so importing
  // `REPORTED_GROUP_AXES` back into the parser would be a cycle. `frozenList` pins
  // this field against a literal in the parser's OWN file, which is a pin and not a
  // mirror — it cannot see the audit's list move.
  //
  // Both sides are READ, neither retyped. The two typed anchors that already exist
  // (the restatement above and the one in split-audit.test.ts) leave exactly one leg
  // uncovered between them: one side moving TOGETHER WITH its own anchor keeps both
  // green. This is that leg.
  //
  // The consequence, which is not what is asserted: `groupAxisRole` in
  // benchmark/split-audit.ts would call `namedReported` a different set from the one
  // the sealed artifact publishes with `connectivity.sharedValue: false`.
  it("declares exactly the reported axes the audit takes responsibility for", () => {
    // Non-vacuity FIRST: two empty lists satisfy the equality by executing nothing,
    // the shape split-audit.test.ts already names in writing.
    expect(PREREGISTRATION_V4.connectivity.reportedAxes.length).toBeGreaterThan(
      0,
    );
    expect([...PREREGISTRATION_V4.connectivity.reportedAxes]).toEqual([
      ...REPORTED_GROUP_AXES,
    ]);
  });

  // The mirror the parser cannot hold: the splitter READS this file, so importing
  // `GROUP_KEYS` into it would be a cycle. A policy that unions on a different set
  // from the splitter would publish a connectivity claim the split does not honour.
  it("declares exactly the split union axes the splitter uses", () => {
    expect([...PREREGISTRATION_V4.connectivity.splitUnionAxes]).toEqual([
      ...GROUP_KEYS,
    ]);
  });

  // The release seal must require exactly the quota cells the policy HAS a source
  // for. The two lists are not derived from each other on purpose — a derived list
  // cannot disagree with its source, so nothing would notice a rename on one side.
  //
  // The cells and NOT `humanCoreStrata`: the seal's coverage check reads the same
  // field the per-cell ceilings are measured on, and that field's vocabulary is the
  // one `cellFprHypothesis` turns into a member of `multiplicity.primaryFamily`.
  // `uncoveredCoreStrata` is asserted empty here because that is what makes "every
  // declared cell has a source" a fact and not an assumption.
  it("requires exactly the quota cells the frozen policy has a source for", () => {
    expect([...RELEASE_CORPUS_POLICY.requiredHumanSourceTypes].sort()).toEqual(
      [...PREREGISTRATION_V4.preRegistration.quotaAxis.cells].sort(),
    );
    expect(PREREGISTRATION_V4.uncoveredCoreStrata).toEqual([]);
    expect(RELEASE_CORPUS_POLICY.requiredHumanSourceTypes).toHaveLength(
      PREREGISTRATION_V4.humanCoreStrata.length,
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

  // --- the pre-registered length bands (X1) --------------------------------
  //
  // The bands are a DIAGNOSTIC and they are frozen anyway: a slice chosen after seeing
  // the result is post-hoc even when it spends no alpha, so the edges are pinned here
  // and the pin is legitimate precisely because nothing has been measured yet.
  it("carries the four length bands verbatim, content and order", () => {
    const bands = PREREGISTRATION_V4.lengthBands;
    expect(bands.role).toBe("diagnostic");
    expect(bands.decides).toBe(false);
    expect(bands.spendsAlpha).toBe(false);
    expect(bands.measuredPopulation).toBe("ptwiki-20220301-lead-sections");
    expect(
      bands.bands.map((band) => [
        band.key,
        band.minimumWords,
        band.maximumWords,
        band.expectedBlindBlockLines,
        band.diagnosticCeilingAtExpectedLines,
      ]),
    ).toEqual([
      ["50_79", 50, 79, 238, 0.018243],
      ["80_149", 80, 149, 239, 0.018168],
      ["150_299", 150, 299, 204, 0.021251],
      ["300_PLUS", 300, null, 119, 0.036154],
    ]);
  });

  it("starts the first band at the abstain floor and runs the last one to infinity", () => {
    const bands = PREREGISTRATION_V4.lengthBands.bands;
    expect(bands[0].minimumWords).toBe(
      PREREGISTRATION_V4.wordFloor.abstainBelow,
    );
    expect(bands[bands.length - 1].maximumWords).toBeNull();
    for (const band of bands.slice(0, -1)) {
      expect(band.maximumWords).not.toBeNull();
    }
  });

  // The bands cover the measured population and cover it once. A gap hides rows in no
  // published band; an overlap makes the shares sum past the denominator.
  it("partitions the population from the abstain floor to infinity", () => {
    const bands = PREREGISTRATION_V4.lengthBands.bands;
    for (let index = 1; index < bands.length; index += 1) {
      expect(bands[index].minimumWords).toBe(
        (bands[index - 1].maximumWords as number) + 1,
      );
    }
  });

  // The shares are the band's slice of the blind block the collection target implies,
  // and each band's ceiling is the zero-event ceiling at its own share — NOT at the
  // headline's 800. This is what stops the widest band being read as if it had the
  // headline's precision.
  it("apportions the blind block across the bands and derives each band's ceiling from its own share", () => {
    const policy = PREREGISTRATION_V4;
    const bands = policy.lengthBands.bands;
    const alpha = policy.multiplicity.perHypothesisAlpha;
    expect(
      bands.reduce((total, band) => total + band.expectedBlindBlockLines, 0),
    ).toBe(
      policy.preRegistration.zeroEventCeiling.blindBlockLinesAtCollectionTarget,
    );
    for (const band of bands) {
      expect(band.diagnosticCeilingAtExpectedLines).toBeCloseTo(
        1 - alpha ** (1 / band.expectedBlindBlockLines),
        6,
      );
      // Every band is WIDER than the headline, because every band's n is a fraction of
      // the headline's. A band that came out tighter would mean the shares no longer
      // add up to the block.
      expect(band.diagnosticCeilingAtExpectedLines).toBeGreaterThan(
        policy.preRegistration.zeroEventCeiling.ceilingAtCollectionTarget,
      );
    }
  });

  // The bands may not become hypotheses. Both lists are pinned to shipped literals, so
  // this is checked against the literals rather than by a parser branch no admissible
  // policy reaches: moving either list breaks it here.
  it("keeps every band out of the certifying family, in both spellings", () => {
    const family = PREREGISTRATION_V4.multiplicity.primaryFamily;
    for (const band of PREREGISTRATION_V4.lengthBands.bands) {
      expect(family).not.toContain(band.key);
      expect(family).not.toContain(`fpr-${band.key}`);
    }
    // And the diagnostic cannot re-price the headline: `m` is the family's length and
    // the bands are not in it, so the count is what it was before the bands existed.
    expect(family.length).toBe(4);
    expect(PREREGISTRATION_V4.multiplicity.primaryFamilySize).toBe(4);
    expect(PREREGISTRATION_V4.multiplicity.perHypothesisAlpha).toBe(0.0125);
  });

  // The RUNTIME profile bands are a different table with a different job, and this is
  // the assertion that keeps them from being confused: they do not share a vocabulary.
  it("keeps the runtime profile bands as a separate vocabulary from the diagnostic bands", () => {
    expect(PREREGISTRATION_V4.profileBands).toEqual([
      "50-79",
      "80-199",
      "200-plus",
    ]);
    for (const band of PREREGISTRATION_V4.lengthBands.bands) {
      expect(PREREGISTRATION_V4.profileBands).not.toContain(band.key);
    }
  });

  it("is deeply frozen so no consumer can mutate the pre-registration at runtime", () => {
    expect(Object.isFrozen(PREREGISTRATION_V4)).toBe(true);
    expect(Object.isFrozen(PREREGISTRATION_V4.fprBudgets)).toBe(true);
    expect(Object.isFrozen(PREREGISTRATION_V4.humanCoreStrata)).toBe(true);
    expect(Object.isFrozen(PREREGISTRATION_V4.connectivity)).toBe(true);
  });

  it("derives the harness requirement from the channel, in one place", () => {
    for (const row of Object.values(PREREGISTRATION_V4.generationLanes)) {
      expect(laneRunsHarness(row)).toBe(row.channel !== "api");
      expect(row.decodingConfigurable).toBe(laneExposesDecoding(row));
    }
  });

  // The two facts the channel decides are INDEPENDENT, and the table is the proof:
  // one lane has a harness and no knobs, one has knobs and no harness, and one has
  // both. Deriving either predicate from the other is what made `ollama` unwritable.
  it("keeps the harness fact and the decoding fact independent across the lanes", () => {
    const observed = Object.fromEntries(
      Object.entries(PREREGISTRATION_V4.generationLanes).map(([lane, row]) => [
        lane,
        [laneRunsHarness(row), laneExposesDecoding(row)],
      ]),
    );
    expect(observed).toEqual({
      agy: [true, false],
      "claude-code": [true, false],
      codex: [true, false],
      "gemini-api": [false, true],
      "gemini-cli": [true, false],
      ollama: [true, true],
    });
  });

  // The scale is the lane's whole ladder and not the slice a coverage plan uses:
  // a level the provider really accepts must not be refused as outside the scale.
  it("declares the complete effort ladder of every scale it names", () => {
    const lanes = PREREGISTRATION_V4.generationLanes;
    expect(lanes.codex.effortLevels).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
      "ultra",
    ]);
    expect(lanes["claude-code"].effortLevels).toEqual([
      "low",
      "medium",
      "high",
      "xhigh",
      "max",
    ]);
    expect(lanes.agy.effortLevels).toEqual(["low", "medium", "high"]);
    // No lane may reuse another's scale name: the name is the join key
    // `compareEffortWithinScale` resolves levels through.
    const scales = Object.values(lanes)
      .map((row) => row.effortScale)
      .filter((scale): scale is string => scale !== null);
    expect(new Set(scales).size).toBe(scales.length);
  });
});

describe("parsePreregistrationV4 fails closed", () => {
  it("accepts the shipped policy unchanged", () => {
    expect(parsePreregistrationV4(validPolicyObject())).toEqual(
      PREREGISTRATION_V4,
    );
  });

  // The lane block, which is the one place the two channel facts can be written so
  // that they contradict the channel that decides them. Each mutation is a value a
  // hand edit would reach for while adding a lane.
  function withLane(
    lane: string,
    fields: Record<string, unknown>,
  ): Record<string, unknown> {
    const policy = validPolicyObject();
    const lanes = policy.generationLanes as Record<
      string,
      Record<string, unknown>
    >;
    lanes[lane] = { ...lanes[lane], ...fields };
    return policy;
  }

  it("refuses sampling knobs on a channel that exposes none", () => {
    expect(() =>
      parsePreregistrationV4(withLane("agy", { decodingConfigurable: true })),
    ).toThrow(/generationLanes\.agy\.decodingConfigurable/u);
  });

  it("refuses a channel whose exposed knobs the row denies", () => {
    // The direction the previous rule left unguarded, and the one that would have
    // been used to squeeze `ollama` into an existing channel: denying the knobs
    // discards the `seed`, the one field that makes a generation reproducible.
    expect(() =>
      parsePreregistrationV4(
        withLane("ollama", { decodingConfigurable: false }),
      ),
    ).toThrow(
      /generationLanes\.ollama\.decodingConfigurable must be true on the "local-runtime" channel/u,
    );
  });

  it("refuses a channel outside the frozen vocabulary", () => {
    expect(() =>
      parsePreregistrationV4(withLane("ollama", { channel: "local-server" })),
    ).toThrow(/generationLanes\.ollama\.channel/u);
  });

  it("refuses an effort source no record of a scale-less lane could occupy", () => {
    // The uninhabitable arm: every source but `not-supported` carries a level, and a
    // level is checked against the lane's scale, which here is `null`. Offering one
    // reads as a capability and is none.
    expect(() =>
      parsePreregistrationV4(
        withLane("ollama", { effortSources: ["not-supported", "model-id"] }),
      ),
    ).toThrow(/generationLanes\.ollama\.effortScale/u);
  });

  it("refuses a lane dropped from the frozen vocabulary", () => {
    const policy = validPolicyObject();
    const lanes = { ...(policy.generationLanes as Record<string, unknown>) };
    delete lanes.ollama;
    policy.generationLanes = lanes;
    expect(() => parsePreregistrationV4(policy)).toThrow(
      /generationLanes\.ollama is missing/u,
    );
  });

  it("refuses a lane row carrying the retired per-lane effort boolean", () => {
    // Closed key set, and this is the key it closes against: a reinstated
    // `effortConfigurable` would be a per-lane answer to a per-model question, and
    // it would sit beside the per-record derivation without either one yielding.
    expect(() =>
      parsePreregistrationV4(withLane("codex", { effortConfigurable: true })),
    ).toThrow(/generationLanes\.codex/u);
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

  it("refuses the material-assistance non-decision flipped, or either rearm condition dropped", () => {
    // Rearming the floor means editing the sealed policy, and this is what makes that
    // edit expensive: the literal refuses `true`, and the frozen list refuses a
    // rearm that names one condition instead of both — or names both out of order.
    const rearmed = validPolicyObject();
    block(rearmed, "materialAssistance").decides = true;
    expect(() => parsePreregistrationV4(rearmed)).toThrow(
      /materialAssistance\.decides/u,
    );

    for (const tampered of [
      ["sentence-or-token-head-formulation"],
      ["floor-derived-from-sourced-evidence"],
      [
        "floor-derived-from-sourced-evidence",
        "sentence-or-token-head-formulation",
      ],
    ]) {
      const policy = validPolicyObject();
      block(policy, "materialAssistance").rearmRequires = tampered;
      expect(() => parsePreregistrationV4(policy)).toThrow(
        /materialAssistance\.rearmRequires/u,
      );
    }
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
          policy.backbone = "xlm-roberta-base";
        },
      },
      {
        path: "onnxMaximumInt8Bytes",
        mutate: (policy) => {
          policy.onnxMaximumInt8Bytes = 340_000_000;
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

  // W1 — the backbone amendment. The two values are the pair that made the previous
  // freeze circular: the ceiling was RAISED to fit a backbone, and then the raised
  // ceiling was offered as the reason for choosing it. Refusing each one by name is
  // what stops either half from surviving the other.
  it("refuses the discarded bake-off candidate as the backbone", () => {
    const policy = validPolicyObject();
    policy.backbone = "xlm-roberta-base";
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe("backbone");
    expect((thrown as Error).message).toMatch(
      /is frozen at "neuralmind\/bert-base-portuguese-cased"/u,
    );
  });

  // The ceiling is only a ceiling where something is measured against it. The served
  // artifact itself is gitignored, but its size is declared in two TRACKED descriptors,
  // and those are the in-tree witnesses of the measurement the ceiling is anchored on.
  it("keeps the shipped artifact descriptors under the export ceiling", async () => {
    const modelDirectory = join(
      dirname(PREREGISTRATION_V4_PATH),
      "..",
      "models",
      "cleanfeed-ptbr-v1",
    );
    const declaredBytes = await Promise.all(
      ["source-lock.json", "cleanfeed-model.json"].map(async (name) => {
        const descriptor = JSON.parse(
          await readFile(join(modelDirectory, name), "utf8"),
        ) as { artifacts: { path: string; bytes: number }[] };
        const onnx = descriptor.artifacts.find(
          (artifact) => artifact.path === "onnx/model_int8.onnx",
        );
        expect(onnx, `${name} must declare onnx/model_int8.onnx`).toBeDefined();
        return onnx!.bytes;
      }),
    );
    // Both descriptors describe ONE file, so they must agree before either can witness
    // anything.
    expect(new Set(declaredBytes).size).toBe(1);
    expect(declaredBytes[0]).toBeLessThanOrEqual(
      PREREGISTRATION_V4.onnxMaximumInt8Bytes,
    );
    // The anchor itself: the ceiling was chosen as this number plus declared headroom.
    expect(declaredBytes[0]).toBe(109_681_931);
  });

  it("refuses the export ceiling that was sized for the discarded candidate", () => {
    const policy = validPolicyObject();
    policy.onnxMaximumInt8Bytes = 340_000_000;
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe(
      "onnxMaximumInt8Bytes",
    );
    expect((thrown as Error).message).toMatch(/is frozen at 130000000/u);
  });

  // T2 — the family moved to m = 4 and the per-hypothesis alpha stayed at the m = 7
  // value. The two are written down separately because a reader must not have to
  // divide, and this is exactly the defect that pairing exists to catch.
  it("refuses an alpha stranded at the m = 7 value", () => {
    const policy = validPolicyObject();
    block(policy, "multiplicity").perHypothesisAlpha = 0.007143;
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
    // This equality is also what ORDERS the two published ceilings, and it is the ONLY
    // thing asserted about that ordering: the floor's blind block IS the FPR denominator,
    // the target is refused unless it exceeds the floor, and `1 - alpha^(1/n)` is strictly
    // decreasing in `n`. So neither a parser check nor a second assertion comparing the
    // target's blind block against the denominator can fail — both would be branches no
    // admissible policy reaches, and this equality is what a re-derivation would break.
  });

  it("derives the collection total by SUMMING the per-cell target over the cells", () => {
    // The factor is asserted at more than one cell because at the one cell the frame
    // declares the derivation is an identity, and the shipped policy therefore cannot
    // tell `target * cells` from `target`. Two and three cells can.
    expect(derivedHumanLinesTotal(4_000, 1)).toBe(4_000);
    expect(derivedHumanLinesTotal(4_000, 2)).toBe(8_000);
    expect(derivedHumanLinesTotal(1_750, 4)).toBe(7_000);
    // And the shipped total IS that derivation over the shipped cells, so the parser and
    // this pin cannot drift apart.
    expect(PREREGISTRATION_V4.collection.humanLinesTotal).toBe(
      derivedHumanLinesTotal(
        PREREGISTRATION_V4.collection.humanLinesPerCellTarget,
        PREREGISTRATION_V4.preRegistration.quotaAxis.cells.length,
      ),
    );
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

  // T5 — the ceiling of the PREVIOUS family (m = 7 at n = 300 was 0.016337) left behind
  // by an amendment that moved `m`. This is the number a model card prints, so it is the
  // one an amendment is likeliest to forget.
  it("refuses the m = 7 ceiling under the m = 4 family", () => {
    for (const stale of [0.016337, 0.017375]) {
      const policy = validPolicyObject();
      (
        block(block(policy, "preRegistration"), "zeroEventCeiling") as Record<
          string,
          unknown
        >
      ).ceilingAtAdoptedFloor = stale;
      let thrown: unknown = null;
      try {
        parsePreregistrationV4(policy);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, String(stale)).toBeInstanceOf(PreregistrationV4Error);
      expect((thrown as PreregistrationV4Error).path).toBe(
        "preRegistration.zeroEventCeiling.ceilingAtAdoptedFloor",
      );
      expect((thrown as Error).message).toMatch(/1 - 0\.0125\^\(1\/300\)/u);
    }
  });

  // The ceiling at the COLLECTION TARGET is the other published number, and it is
  // derived from a line count that is itself derived. Two ways to get it wrong, two
  // paths named.
  it("refuses a collection-target ceiling that is not the formula at its own n", () => {
    const stale = validPolicyObject();
    (
      block(block(stale, "preRegistration"), "zeroEventCeiling") as Record<
        string,
        unknown
      >
    ).ceilingAtCollectionTarget = 0.006158;
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(stale);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe(
      "preRegistration.zeroEventCeiling.ceilingAtCollectionTarget",
    );
    expect((thrown as Error).message).toMatch(/1 - 0\.0125\^\(1\/800\)/u);

    // The line count itself: 350 was the blind block of the FOUR-cell collection target,
    // and it is arithmetically impeccable against the wrong target.
    const staleLines = validPolicyObject();
    const ceiling = block(
      block(staleLines, "preRegistration"),
      "zeroEventCeiling",
    ) as Record<string, unknown>;
    ceiling.blindBlockLinesAtCollectionTarget = 350;
    ceiling.ceilingAtCollectionTarget = 0.012442;
    let linesThrown: unknown = null;
    try {
      parsePreregistrationV4(staleLines);
    } catch (error) {
      linesThrown = error;
    }
    expect(linesThrown).toBeInstanceOf(PreregistrationV4Error);
    expect((linesThrown as PreregistrationV4Error).path).toBe(
      "preRegistration.zeroEventCeiling.blindBlockLinesAtCollectionTarget",
    );
  });

  // The family and the cells are ONE decision, and the amendment that moved them is the
  // reason each of these is refused by its own path rather than by the alpha check.
  it("refuses the m = 7 family and the four-cell quota axis", () => {
    const sevenFamily = validPolicyObject();
    const multiplicity = block(sevenFamily, "multiplicity");
    multiplicity.primaryFamily = [
      "calibration-global",
      "fpr-carolina-judicial",
      "fpr-carolina-social-media",
      "fpr-carolina-university",
      "fpr-ptwiki",
      "integrity",
      "recall-at-threshold",
    ];
    multiplicity.primaryFamilySize = 7;
    multiplicity.perHypothesisAlpha = 0.007143;
    let familyThrown: unknown = null;
    try {
      parsePreregistrationV4(sevenFamily);
    } catch (error) {
      familyThrown = error;
    }
    expect(familyThrown).toBeInstanceOf(PreregistrationV4Error);
    expect((familyThrown as PreregistrationV4Error).path).toBe(
      "multiplicity.primaryFamily",
    );

    const fourCells = validPolicyObject();
    (
      block(block(fourCells, "preRegistration"), "quotaAxis") as Record<
        string,
        unknown
      >
    ).cells = [
      "carolina-judicial",
      "carolina-social-media",
      "carolina-university",
      "ptwiki",
    ];
    let cellsThrown: unknown = null;
    try {
      parsePreregistrationV4(fourCells);
    } catch (error) {
      cellsThrown = error;
    }
    expect(cellsThrown).toBeInstanceOf(PreregistrationV4Error);
    expect((cellsThrown as PreregistrationV4Error).path).toBe(
      "preRegistration.quotaAxis.cells",
    );

    // And the register words the amendment collapsed: `humanCoreStrata` is the same
    // single string now, so the old vocabulary is refused where it is written.
    const registerWords = validPolicyObject();
    registerWords.humanCoreStrata = ["encyclopedic"];
    let strataThrown: unknown = null;
    try {
      parsePreregistrationV4(registerWords);
    } catch (error) {
      strataThrown = error;
    }
    expect(strataThrown).toBeInstanceOf(PreregistrationV4Error);
    expect((strataThrown as PreregistrationV4Error).path).toBe(
      "humanCoreStrata",
    );
  });

  // T6 — the empty list is a VALUE the parser accepts, and the two ways of getting it
  // wrong get two different diagnoses.
  it("accepts an empty uncoveredCoreStrata and refuses an entry that is not a stratum", () => {
    const shipped = validPolicyObject();
    expect(shipped.uncoveredCoreStrata).toEqual([]);
    expect(() => parsePreregistrationV4(shipped)).not.toThrow();

    const notAStratum = validPolicyObject();
    // `judicial` is the case the amendment created: a population that WAS a cell and is
    // now out of frame is not an uncovered stratum, because it is not a stratum at all.
    notAStratum.uncoveredCoreStrata = ["judicial"];
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(notAStratum);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    expect((thrown as PreregistrationV4Error).path).toBe("uncoveredCoreStrata");
    expect((thrown as Error).message).toMatch(
      /names "judicial", which is not one of the core strata/u,
    );

    // A real stratum declared uncovered is a different mistake: the frame has a source
    // for its one cell, so the list is frozen empty.
    const realStratum = validPolicyObject();
    realStratum.uncoveredCoreStrata = ["ptwiki"];
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
  // total derived from the per-cell FLOOR instead of the target. 1500 (and, under the
  // four-cell frame, 6000) is arithmetically impeccable and still wrong, because the seal
  // compares the composition for exact equality and would then refuse every corpus that
  // carries the collection margin.
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
      /at the TARGET of 4000 lines each is 4000/u,
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
  // arithmetic identity intact (1 x 1500 = 1500) and erases the margin silently,
  // which is the direction a re-derivation actually drifts in.
  it("refuses a collection target that merely EQUALS the floor", () => {
    const policy = validPolicyObject();
    const collection = block(policy, "collection");
    collection.humanLinesPerCellTarget = 1500;
    collection.humanLinesTotal = 1500;
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

  // --- the pre-registered length bands (X1) --------------------------------

  function bandsOf(policy: Record<string, unknown>): Record<string, unknown>[] {
    return block(policy, "lengthBands").bands as Record<string, unknown>[];
  }

  function refusal(policy: Record<string, unknown>): PreregistrationV4Error {
    let thrown: unknown = null;
    try {
      parsePreregistrationV4(policy);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(PreregistrationV4Error);
    return thrown as PreregistrationV4Error;
  }

  // The rule that is NOT optional: a band starting under the abstain floor names a
  // population the measurement never measures, so its rate is about nobody.
  it("refuses a first band below the abstain floor", () => {
    const policy = validPolicyObject();
    const bands = bandsOf(policy);
    bands[0].minimumWords = 1;
    expect(refusal(policy).path).toBe("lengthBands.bands[0].minimumWords");
  });

  // And above it, for the mirror reason: the rows between 50 and the first band would
  // be measured and named by no band.
  it("refuses a first band above the abstain floor", () => {
    const policy = validPolicyObject();
    const bands = bandsOf(policy);
    bands[0].minimumWords = 60;
    expect(refusal(policy).path).toBe("lengthBands.bands[0].minimumWords");
  });

  it("refuses bands that overlap", () => {
    const policy = validPolicyObject();
    const bands = bandsOf(policy);
    bands[1].minimumWords = 70;
    expect(refusal(policy).path).toBe("lengthBands.bands[1].minimumWords");
  });

  it("refuses bands that leave a gap", () => {
    const policy = validPolicyObject();
    const bands = bandsOf(policy);
    bands[2].minimumWords = 160;
    expect(refusal(policy).path).toBe("lengthBands.bands[2].minimumWords");
  });

  // A bounded top band leaves the longest documents — the ones whose rate is least
  // likely to transfer — in no published row at all.
  it("refuses a bounded top band", () => {
    const policy = validPolicyObject();
    const bands = bandsOf(policy);
    bands[3].maximumWords = 5000;
    expect(refusal(policy).path).toBe("lengthBands.bands[3].maximumWords");
  });

  it("refuses an unbounded band that is not the last one", () => {
    const policy = validPolicyObject();
    const bands = bandsOf(policy);
    bands[1].maximumWords = null;
    expect(refusal(policy).path).toBe("lengthBands.bands[1].maximumWords");
  });

  // The shares are a partition of the blind block, so they sum to it. A share moved
  // without the others would publish a band ceiling for an n the block cannot hold.
  it("refuses band shares that do not sum to the blind block", () => {
    const policy = validPolicyObject();
    const bands = bandsOf(policy);
    // The band's OWN ceiling is moved with its share, so the per-band derivation still
    // holds and the sum is the only rule left to catch this.
    bands[0].expectedBlindBlockLines = 200;
    bands[0].diagnosticCeilingAtExpectedLines = 0.021672;
    expect(refusal(policy).path).toBe("lengthBands.bands");
  });

  it("refuses a band ceiling that its own share does not produce", () => {
    const policy = validPolicyObject();
    const bands = bandsOf(policy);
    // The HEADLINE ceiling, on a band that holds a fraction of the headline's lines:
    // the exact misreading the per-band ceiling exists to make impossible.
    bands[3].diagnosticCeilingAtExpectedLines = 0.005463;
    expect(refusal(policy).path).toBe(
      "lengthBands.bands[3].diagnosticCeilingAtExpectedLines",
    );
  });

  it("refuses a renamed or reordered band", () => {
    const renamed = validPolicyObject();
    bandsOf(renamed)[1].key = "80_99";
    expect(refusal(renamed).path).toBe("lengthBands.bands");

    const reordered = validPolicyObject();
    const bands = bandsOf(reordered);
    reordered.lengthBands = {
      ...block(reordered, "lengthBands"),
      bands: [bands[1], bands[0], bands[2], bands[3]],
    };
    expect(refusal(reordered).path).toBe("lengthBands.bands");
  });

  // The role fields are the whole content of "diagnostic": a policy that flipped one
  // of them would publish the same table as a certifying claim.
  it("refuses a band block that claims to decide or to spend alpha", () => {
    const decides = validPolicyObject();
    block(decides, "lengthBands").decides = true;
    expect(refusal(decides).path).toBe("lengthBands.decides");

    const spends = validPolicyObject();
    block(spends, "lengthBands").spendsAlpha = true;
    expect(refusal(spends).path).toBe("lengthBands.spendsAlpha");

    const certifying = validPolicyObject();
    block(certifying, "lengthBands").role = "certifying";
    expect(refusal(certifying).path).toBe("lengthBands.role");
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

  it("names no degenerate stratum level now that the frame has one cell", () => {
    // A level with ONE value draws the same unit in every replicate: it adds no
    // variance, and a table that named it would read as if the published bound had
    // accounted for between-stratum variation it never saw. With one declared cell
    // `groups.domainSource` is exactly that, so neither human row nests it.
    expect(PREREGISTRATION_V4.preRegistration.quotaAxis.cells).toHaveLength(1);
    for (const estimand of ["human-specificity", "calibration"] as const) {
      const levels =
        PREREGISTRATION_V4.resampling.estimandClasses[estimand].levels;
      expect(levels.map((level) => level.axis)).not.toContain(
        "groups.domainSource",
      );
      // ...and the row still declares a unit: dropping the degenerate level must not
      // leave the estimand resampling independent rows, which is what
      // `fallbackToIndependentRows: false` refuses.
      expect(levels.length).toBeGreaterThan(0);
    }
    // The unit that remains is the author, falling back to the origin document — the
    // dependence the corpus actually has inside the cell.
    expect(
      PREREGISTRATION_V4.resampling.estimandClasses["human-specificity"]
        .levels[0],
    ).toEqual({ axis: "groups.author", fallbacks: ["groups.source"] });
    // `domainSource` is still a REPORTED axis and still not a union axis: what changed is
    // the table, not the axis vocabulary.
    expect([...PREREGISTRATION_V4.connectivity.reportedAxes]).toContain(
      "domainSource",
    );
    expect([...PREREGISTRATION_V4.connectivity.splitUnionAxes]).not.toContain(
      "domainSource",
    );
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

// --- o ELO que falta: um eixo REPORTADO tem de ser lido por algum gate -------

describe("o eixo que sai da união é carregado por outro mecanismo, e o conjunto é declarado", () => {
  // O CONTRATO. Tirar um eixo de `GROUP_KEYS` faz o splitter deixar de MODELAR a
  // dependência que ele carrega; ela não desaparece, e alguma outra coisa tem de carregá-la.
  //
  // A REGRA continua verdadeira e o CONJUNTO DE INSTÂNCIAS dela mudou DUAS vezes. Da emenda
  // de 2026-08-12 só `promptTemplate` voltou à união; `generatorVersion` ficou REPORTADO,
  // então ele é a instância de receita e tem de ter mecanismo nomeado. Tem, e é a TABELA:
  // o nível de TOPO de `ai-recall` é `groups.generatorFamily`, e a identidade de
  // `generatorVersion` é medida IGUAL à da família em toda linha montada dos pools
  // (`GeneratorVersionIsTheFamilyTests`, benchmark/lab/test_extractors.py) — logo reamostrar
  // por família é reamostrar pela versão. As outras instâncias são o par de MATERIAL, e a
  // tabela NÃO as carrega: nem `domainSource` nem `sourceMaterialBatch` é nível de estimando
  // algum (a dívida está medida três testes abaixo). O que as carrega é a dependência
  // REGISTRADA — `connectivity.dependencyAxis` com `splitUnionsOnDependencyAxis: false` mais
  // o inventário por partição da auditoria. Dizer que a tabela as carrega seria falso.
  const MOVED_TO_REPORTED: readonly string[] = ["generatorVersion"];

  /**
   * A classe GERADA -> os estimandos medidos sobre ela. Os nomes dos estimandos são
   * declarados; a classe de estimando de cada um é LIDA de `resampling.estimands`, então
   * remapear um estimando para outra classe muda o que este teste cobra.
   */
  const GENERATED_CLASS_ESTIMANDS: Readonly<Record<string, readonly string[]>> =
    {
      ai: ["action.recall", "warning.recall"],
      mixed: ["mixed.warning.recall"],
    };

  function declaredLevelAxes(estimands: readonly string[]): Set<string> {
    const { estimandClasses, estimands: byEstimand } =
      PREREGISTRATION_V4.resampling;
    const axes = new Set<string>();
    for (const estimand of estimands) {
      const className = byEstimand[estimand];
      expect(className, estimand).toBeDefined();
      const declared =
        estimandClasses[className as keyof typeof estimandClasses];
      expect(declared, className).toBeDefined();
      for (const level of declared.levels) {
        axes.add(level.axis);
        for (const fallback of level.fallbacks) axes.add(fallback);
      }
    }
    return axes;
  }

  it("nomeia `generatorVersion` como o eixo de receita fora da união, e o mecanismo que o carrega", () => {
    // A lista NÃO é vazia, e o laço abaixo é o que a mantém honesta: cada nome dela tem de
    // estar FORA da união e DENTRO dos reportados, e a tabela tem de nomear um nível que
    // carregue a dependência. Um eixo devolvido à união deixa isto vermelho, e o conjunto de
    // instâncias tem de ser redecidido junto com o mecanismo.
    expect(MOVED_TO_REPORTED).toEqual(["generatorVersion"]);
    const doAi = declaredLevelAxes(GENERATED_CLASS_ESTIMANDS.ai);
    for (const axis of MOVED_TO_REPORTED) {
      expect(GROUP_KEYS as readonly string[], axis).not.toContain(axis);
      expect(REPORTED_GROUP_AXES as readonly string[], axis).toContain(axis);
    }
    // O mecanismo, LIDO da tabela: o nível de topo de `ai-recall` é a família, e a
    // identidade da versão é a dela — medição no lab, citada no comentário acima.
    expect([...doAi]).toContain("groups.generatorFamily");
    // E o CONTRASTE, sem o qual o laço passaria por a união estar vazia: `promptTemplate`
    // ficou na união, então nada aqui o cobra.
    expect(GROUP_KEYS as readonly string[]).toContain("promptTemplate");
    expect(REPORTED_GROUP_AXES as readonly string[]).not.toContain(
      "promptTemplate",
    );
    // E as instâncias de MATERIAL: reportadas, fora da união, carregadas pela dependência
    // registrada e não pela tabela.
    expect([...REPORTED_GROUP_AXES]).toEqual([
      "domainSource",
      "sourceMaterialBatch",
      "generatorVersion",
    ]);
    expect(PREREGISTRATION_V4.connectivity.dependencyAxis).toBe(
      "sourceMaterialBatch",
    );
    expect(PREREGISTRATION_V4.connectivity.splitUnionsOnDependencyAxis).toBe(
      false,
    );
  });

  it("mantém aberta a DECISÃO do nível de gerador da classe mista, que a emenda não fecha", () => {
    // A exceção `(mixed, generatorVersion)` que a emenda de U4 registrou DISSOLVEU-SE, e
    // dissolveu-se pelo motivo errado para quem a leia depressa: não porque a classe mista
    // passou a declarar um nível de gerador, e sim porque o eixo deixou de ser reportado. A
    // pergunta que a exceção nomeava continua ABERTA e vai a ratificação, então ela migra
    // para uma asserção sobre a tabela em vez de desaparecer com a entrada.
    const mixed = PREREGISTRATION_V4.resampling.estimandClasses.mixed;
    expect(mixed.levels.map((level) => level.axis)).toEqual([
      "groups.humanSeed",
      "groups.promptTemplate",
    ]);
    // NENHUM nível de gerador, nem a família nem a versão, nem como fallback. A classe mista
    // constrói ZERO linhas hoje; no dia em que construir, um intervalo de
    // `mixed.warning.recall` é agrupado por semente e template e por mais nada, e é isso que
    // esta asserção mantém visível.
    const niveis = declaredLevelAxes(GENERATED_CLASS_ESTIMANDS.mixed);
    expect([...niveis]).not.toContain("groups.generatorFamily");
    expect([...niveis]).not.toContain("groups.generatorVersion");
    // A classe `ai` tem os dois, e é o contraste que impede a asserção acima de passar por a
    // tabela não nomear gerador em parte alguma.
    const doAi = declaredLevelAxes(GENERATED_CLASS_ESTIMANDS.ai);
    expect([...doAi]).toContain("groups.generatorFamily");
    expect([...doAi]).toContain("groups.promptTemplate");
  });

  it("confina DOIS dos três níveis de `ai-recall`, e MEDE que o de topo não fica confinado", () => {
    // `ai-recall` reamostra por família -> template -> lote, e o que a emenda entrega é DOIS
    // dos três níveis confinados a uma partição — não os três. Dizer três seria inferência:
    // com `generatorVersion` fora da união, nenhum membro dela carrega a identidade da
    // FAMÍLIA, e o nível de topo atravessa corte. O resíduo é esse, e está medido abaixo em
    // vez de afirmado.
    const niveis = PREREGISTRATION_V4.resampling.estimandClasses[
      "ai-recall"
    ].levels.map((level) => level.axis);
    expect(niveis).toEqual([
      "groups.generatorFamily",
      "groups.promptTemplate",
      "groups.generationBatch",
    ]);
    // Template e lote são níveis E eixos de união: o cluster de cada um é um subconjunto de
    // um componente, logo de uma partição.
    for (const axis of ["promptTemplate", "generationBatch"] as const) {
      expect(niveis, axis).toContain(`groups.${axis}`);
      expect(GROUP_KEYS as readonly string[], axis).toContain(axis);
    }
    // O nível de TOPO: fora da união, e nenhum eixo que está nela o carrega — `generatorVersion`
    // carregaria (a identidade dos dois é medida igual nos pools) e também está fora.
    expect(GROUP_KEYS as readonly string[]).not.toContain("generatorFamily");
    expect(GROUP_KEYS as readonly string[]).not.toContain("generatorVersion");
    // E a MEDIÇÃO da não-confinamento, sobre linhas reais: duas linhas geradas da MESMA
    // família e da mesma versão, distintas em todo eixo de união, são DOIS componentes. A
    // unidade que o splitter mantém inteira é o componente, então duas linhas em dois
    // componentes podem cair em partições diferentes: o cluster do nível de topo atravessa.
    const daMesmaFamilia = ["a_fam_1", "a_fam_2"].map((id, index) => {
      let raw: Record<string, unknown> = {
        ...v4Ai(),
        id,
        createdAt: index + 1,
      };
      raw = withAxis(raw, "promptTemplate", known(`pt_${id}`));
      raw = withAxis(raw, "generationBatch", known(`gb_${id}`));
      raw = withAxis(raw, "nearDuplicate", known(`nd_${id}`));
      // Semente de pai AUSENTE do conjunto, senão a linhagem — e não a família — uniria.
      raw = withAxis(raw, "humanSeed", known(`h_ausente_${id}`));
      return validateBenchmarkRecordV4(raw) as unknown as BenchmarkRecord;
    });
    // Não vácuo, e pelo acessor de PRODUÇÃO: a família E a versão são UMA identidade
    // DEFINIDA nas duas linhas. Sem o `toBeDefined` um par de `undefined` daria um conjunto
    // de tamanho 1 e a medição passaria por vacuidade.
    for (const axis of ["generatorFamily", "generatorVersion"] as const) {
      const identidades = daMesmaFamilia.map((row) =>
        groupAxisIdentity(row, axis),
      );
      for (const identity of identidades) expect(identity, axis).toBeDefined();
      expect(new Set(identidades).size, axis).toBe(1);
    }
    expect(new Set(connectedComponentRoots(daMesmaFamilia).values()).size).toBe(
      2,
    );
  });

  it("mede a perna que decide: `promptTemplate` É nível de `ai-recall`, e não um comentário", () => {
    // A asserção sobre a qual M3 morde. Ler os níveis da política — nunca restatá-los —
    // é o que faz apagar o nível ficar vermelho aqui em vez de verde em todo lugar.
    const aiRecall = PREREGISTRATION_V4.resampling.estimandClasses["ai-recall"];
    expect(aiRecall.levels.map((level) => level.axis)).toEqual([
      "groups.generatorFamily",
      "groups.promptTemplate",
      "groups.generationBatch",
    ]);
    expect(aiRecall.unitKind).toBe("hierarchical");
    // E a tabela é obrigatória e não cai para linhas independentes: é o que faz dela um
    // carregador da dependência e não um enfeite do relatório.
    expect(PREREGISTRATION_V4.resampling.required).toBe(true);
    expect(PREREGISTRATION_V4.resampling.fallbackToIndependentRows).toBe(false);
    expect(PREREGISTRATION_V4.resampling.publishedBound).toBe(
      "wider-of-analytic-and-resampled",
    );
    // O fator de `mixed`, medido pelo mesmo caminho.
    expect(
      PREREGISTRATION_V4.resampling.estimandClasses.mixed.levels.map(
        (level) => level.axis,
      ),
    ).toEqual(["groups.humanSeed", "groups.promptTemplate"]);
  });

  it("deixa a DÍVIDA de `domainSource` escrita, e não escondida", () => {
    // `domainSource` é REPORTADO, é `known` em toda linha gerada, e nenhum dos dois gates
    // que sobram o lê: não está em `EXPOSURE_IDENTITY_AXES` e não é nível de classe de
    // estimando alguma. É dívida PRÉ-EXISTENTE que o critério revelou, ela não é
    // consertada aqui, e esta asserção é o que a mantém visível — no dia em que alguém a
    // ligar a um gate, ela fica vermelha e a dívida sai do registro junto.
    expect([...REPORTED_GROUP_AXES]).toContain("domainSource");
    expect(EXPOSURE_IDENTITY_AXES as readonly string[]).not.toContain(
      "domainSource",
    );
    const todosOsNiveis = new Set<string>();
    for (const declared of Object.values(
      PREREGISTRATION_V4.resampling.estimandClasses,
    )) {
      for (const level of declared.levels) {
        todosOsNiveis.add(level.axis);
        for (const fallback of level.fallbacks) todosOsNiveis.add(fallback);
      }
    }
    expect([...todosOsNiveis]).not.toContain("groups.domainSource");
  });
});
