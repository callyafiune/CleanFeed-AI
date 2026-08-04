import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../contracts/canonical-json.ts";
import { sha256BytesHex } from "../digests.ts";

import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import {
  freezeProvisionalThreshold,
  ProvisionalThresholdError,
  validateProvisionalThresholdArtifact,
  type ProvisionalThresholdArtifact,
  type ThresholdSample,
} from "../provisional-threshold.ts";

const DIGESTS = {
  datasetDigest: "a".repeat(64),
  datasetAuditDigest: "b".repeat(64),
  splitDigest: "c".repeat(64),
  evaluatorDigest: "d".repeat(64),
  sourceReadinessDigest: "e".repeat(64),
  developmentManifestDigest: "f".repeat(64),
  calibrationManifestDigest: "0".repeat(64),
} as const;

// A hundred human negatives whose raw scores are 0.00, 0.01, ... 0.99, split across
// BOTH frozen fit partitions. The scores are distinct so the quantile has a unique
// order statistic, and the partitions are both present because a fixture that used
// only `dev` would leave the `cal-A` half of the frozen population untested.
function population(count = 100): ThresholdSample[] {
  return Array.from({ length: count }, (_unused, index) => ({
    id: `rec_${String(index).padStart(3, "0")}`,
    label: "human",
    partition: index % 2 === 0 ? "dev" : "cal-A",
    documentRawScore: index / count,
  }));
}

function freeze(
  samples: readonly ThresholdSample[],
  testIds: readonly string[] = [],
): ReturnType<typeof freezeProvisionalThreshold> {
  return freezeProvisionalThreshold({
    samples,
    testIds,
    seed: PREREGISTRATION_V4.seeds.split,
    digests: DIGESTS,
  });
}

function keysDeep(value: unknown, path = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [];
  }
  const found: string[] = [];
  for (const [key, nested] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const here = path === "" ? key : `${path}.${key}`;
    found.push(here);
    found.push(...keysDeep(nested, here));
  }
  return found;
}

describe("the v1 provisional threshold", () => {
  // T13 — the artifact carries the six fields the pre-registration names and NO
  // calibrator anywhere in it. Their absence is the decision
  // (`threshold.probabilisticCalibrator: "none"`), so it is asserted rather than
  // assumed: an artifact that grew a calibrator block would be a v2 artifact wearing
  // a v1 version string.
  it("carries the frozen fields and no calibrator field at any depth", () => {
    const artifact = freeze(population());
    expect(Object.keys(artifact).sort()).toEqual([
      "artifactDigest",
      "digests",
      "fitPartitions",
      "population",
      "preRegistration",
      "schemaVersion",
      "seed",
      "threshold",
      "thresholdBasis",
      "thresholdVersion",
    ]);
    // Enumerated rather than pattern-excluded: two keys legitimately spell
    // "calibration" — the digest of the `cal-A` prediction manifest, and the score
    // basis the calibration hypothesis shares with this cut — and a blanket regex
    // would have to be loosened to admit them, which is how a real calibrator block
    // would later slip past. Any THIRD such key is a v2 field on a v1 artifact.
    expect(
      keysDeep(artifact)
        .filter((key) => /calibrat/iu.test(key))
        .sort(),
    ).toEqual([
      "digests.calibrationManifestDigest",
      "preRegistration.calibrationScoreBasis",
      "preRegistration.probabilisticCalibrator",
    ]);
    for (const key of keysDeep(artifact)) {
      expect(key, key).not.toMatch(/conformal|profileBand|selectionEvidence/iu);
    }
    expect(artifact.thresholdVersion).toBe(
      PREREGISTRATION_V4.threshold.version,
    );
    expect(artifact.thresholdBasis).toBe(PREREGISTRATION_V4.threshold.basis);
    expect([...artifact.fitPartitions]).toEqual([
      ...PREREGISTRATION_V4.threshold.quantilePartitions,
    ]);
    expect(artifact.seed).toBe(PREREGISTRATION_V4.seeds.split);
    expect(artifact.digests).toEqual(DIGESTS);
    // `preRegistration.probabilisticCalibrator` is the DECLARATION that none was fit,
    // which is the opposite of a calibrator field, and it says `none`.
    expect(artifact.preRegistration.probabilisticCalibrator).toBe("none");
  });

  it("reads the multiplicity block, the per-cell budget and the ECE score basis from the policy", () => {
    const artifact = freeze(population());
    expect(artifact.preRegistration.policyVersion).toBe(
      PREREGISTRATION_V4.policyVersion,
    );
    expect(artifact.preRegistration.multiplicity).toEqual({
      correction: "bonferroni",
      familyAlpha: PREREGISTRATION_V4.multiplicity.familyAlpha,
      perHypothesisAlpha: PREREGISTRATION_V4.multiplicity.perHypothesisAlpha,
      primaryFamilySize: PREREGISTRATION_V4.multiplicity.primaryFamilySize,
    });
    expect(artifact.preRegistration.fprBudgetPerCell).toBe(
      PREREGISTRATION_V4.fprBudgets.warning,
    );
    expect(artifact.preRegistration.calibrationScoreBasis).toBe(
      PREREGISTRATION_V4.calibrationGate.scoreBasis,
    );
    // The score the threshold cuts and the score the calibration hypothesis is
    // measured on are the SAME one. The parser joins them; this is the artifact
    // publishing that they agreed.
    expect(artifact.preRegistration.calibrationScoreBasis).toBe(
      artifact.thresholdBasis,
    );
    expect(artifact.preRegistration.quantile).toBe(
      PREREGISTRATION_V4.threshold.quantile,
    );
    expect(artifact.preRegistration.side).toBe("upper");
  });

  it("cuts at the declared order statistic of the sample", () => {
    // 100 draws at 0.00..0.99, quantile 0.95: position ceil(0.95 * 100) = 95, so the
    // cut is 0.95 and exactly five draws sit AT OR ABOVE it — the budget's own tail
    // under the `>=` comparator the runtime applies.
    const artifact = freeze(population());
    expect(artifact.threshold).toBeCloseTo(0.95, 10);
    expect(artifact.population).toEqual({
      humanNegatives: 100,
      atOrAboveThreshold: 5,
    });
  });

  it("publishes the tail a tied population produces instead of claiming a budget", () => {
    // Every draw at the same score: the quantile still exists and IS that score, and
    // the count at or above it is the whole sample. Publishing that number is what
    // stops a reader from inferring a 5 % rate that was never checked — the budget is
    // decided on `test`, by the gates, not here.
    const tied = population().map((sample) => ({
      ...sample,
      documentRawScore: 0.42,
    }));
    const artifact = freeze(tied);
    expect(artifact.threshold).toBe(0.42);
    expect(artifact.population.atOrAboveThreshold).toBe(100);
  });

  it("is a pure function of its inputs, digest included", () => {
    const first = freeze(population());
    const second = freeze(population());
    expect(second).toEqual(first);
    // The invariant worth asserting is that the ORDER of the samples moves nothing:
    // the cut is an order statistic of the sample, so a caller iterating the split
    // artifact in a different order must land on the same threshold and the same
    // digest. Re-freezing the identical array would only re-assert determinism.
    const shuffled = [...population()].reverse();
    const rotated = [...population().slice(37), ...population().slice(0, 37)];
    const moved = freeze(shuffled);
    expect(moved.threshold).toBe(first.threshold);
    expect(moved.artifactDigest).toBe(first.artifactDigest);
    expect(freeze(rotated).artifactDigest).toBe(first.artifactDigest);
    // A different governance digest is a different artifact.
    const other = freezeProvisionalThreshold({
      samples: population(),
      testIds: [],
      seed: PREREGISTRATION_V4.seeds.split,
      digests: { ...DIGESTS, splitDigest: "9".repeat(64) },
    });
    expect(other.artifactDigest).not.toBe(first.artifactDigest);
  });

  // T13, second half — a test id inside the fit population is refused BY NAME rather
  // than by its absence. Refusing on absence would make the guard an accident of
  // whichever predictions the caller happened to supply.
  it("refuses a blocked test id in the fit population, naming the record", () => {
    const samples = population();
    let thrown: unknown = null;
    try {
      freeze(samples, ["rec_007"]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvisionalThresholdError);
    expect((thrown as ProvisionalThresholdError).code).toBe(
      "THRESHOLD_TEST_ID_PRESENT",
    );
    expect((thrown as Error).message).toMatch(/rec_007/u);
    expect((thrown as Error).message).toMatch(/blocked test partition/u);
  });

  it("refuses a partition outside the frozen fit population", () => {
    // A POSITIVE allowlist and not a negative filter: `train` is data the detector was
    // trained on and `cal-B` stays byte-untouched until the v2, and neither exclusion
    // is visible to the compiler because every partition name is the same type.
    for (const partition of ["train", "cal-B", "test"]) {
      const samples = population();
      samples[3] = { ...samples[3], partition };
      let thrown: unknown = null;
      try {
        freeze(samples);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, partition).toBeInstanceOf(ProvisionalThresholdError);
      expect((thrown as ProvisionalThresholdError).code, partition).toBe(
        "THRESHOLD_PARTITION_FORBIDDEN",
      );
      expect((thrown as Error).message, partition).toMatch(
        new RegExp(`"${partition}"`, "u"),
      );
    }
  });

  it("refuses a population too small for the quantile to have a tail", () => {
    // With a budget of 0.05 a sample under 20 draws cannot place a single draw above
    // the cut, so every threshold would read as satisfying the budget by having no
    // tail at all.
    const nineteen = population(19);
    let thrown: unknown = null;
    try {
      freeze(nineteen);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvisionalThresholdError);
    expect((thrown as ProvisionalThresholdError).code).toBe(
      "THRESHOLD_POPULATION_TOO_SMALL",
    );
    expect((thrown as Error).message).toMatch(/at least 20/u);
    expect(() => freeze(population(20))).not.toThrow();
  });

  it("refuses an unscored document instead of counting it as a confident negative", () => {
    // The direction is what matters: padding the human sample with fake zeros pulls
    // the quantile DOWN, which LOWERS the threshold and RAISES the real
    // false-positive rate. The coercion breaks the budget rather than erring toward it.
    const samples = population();
    samples[5] = { ...samples[5], documentRawScore: Number.NaN };
    let thrown: unknown = null;
    try {
      freeze(samples);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvisionalThresholdError);
    expect((thrown as ProvisionalThresholdError).code).toBe(
      "THRESHOLD_SCORE_MISSING",
    );
    expect((thrown as Error).message).toMatch(/is not a zero/u);
  });
  // The order statistic is total over every population the floor admits, so a clamp
  // against `total - 1` would be a branch no input reaches. Asserted rather than
  // assumed: for the smallest legal population the index lands exactly on the last
  // element, which is the only case where a clamp could ever have mattered.
  it("indexes inside the sample for the smallest population it accepts", () => {
    const smallest = Math.ceil(1 / (1 - PREREGISTRATION_V4.threshold.quantile));
    const artifact = freeze(population(smallest));
    expect(artifact.population.humanNegatives).toBe(smallest);
    expect(Number.isFinite(artifact.threshold)).toBe(true);
    // ceil(q*n) === n-1 here, so the cut is the largest draw and its tail is one row.
    expect(artifact.population.atOrAboveThreshold).toBe(1);
  });

  it("refuses the same record twice in the fit population", () => {
    const samples = population();
    let thrown: unknown = null;
    try {
      freeze([...samples, samples[3]]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvisionalThresholdError);
    expect((thrown as ProvisionalThresholdError).code).toBe(
      "THRESHOLD_DUPLICATE_ID",
    );
    expect((thrown as Error).message).toMatch(/rec_003/u);
    expect((thrown as Error).message).toMatch(/double-weights/u);
  });

  it("refuses a row that is not a human negative, naming its label", () => {
    const samples = population();
    let thrown: unknown = null;
    try {
      freeze([
        ...samples,
        {
          id: "gen_001",
          label: "ai",
          partition: "dev",
          documentRawScore: 0.99,
        },
      ]);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvisionalThresholdError);
    expect((thrown as ProvisionalThresholdError).code).toBe(
      "THRESHOLD_POPULATION_NOT_HUMAN",
    );
    expect((thrown as Error).message).toMatch(/gen_001/u);
    expect((thrown as Error).message).toMatch(/"ai"/u);
    expect((thrown as Error).message).toMatch(/human-negatives/u);
  });
});

// ---------------------------------------------------------------------------
// The re-read on the certifying path. Freezing the cut and never reading it again
// would leave `probabilisticCalibrator: "none"` as a claim nothing checks, so
// `evaluate` requires this artifact and refuses it on three different failures.
// ---------------------------------------------------------------------------

describe("re-reading the sealed provisional threshold", () => {
  function sealed(): ProvisionalThresholdArtifact {
    return freezeProvisionalThreshold({
      samples: Array.from({ length: 100 }, (_unused, index) => ({
        id: `rec_${String(index).padStart(3, "0")}`,
        label: "human",
        partition: index % 2 === 0 ? "dev" : "cal-A",
        documentRawScore: index / 100,
      })),
      testIds: [],
      seed: PREREGISTRATION_V4.seeds.split,
      digests: DIGESTS,
    });
  }

  const BOUND_TO = {
    datasetDigest: DIGESTS.datasetDigest,
    splitDigest: DIGESTS.splitDigest,
    evaluatorDigest: DIGESTS.evaluatorDigest,
  } as const;

  it("accepts the artifact the freeze produced", () => {
    expect(() =>
      validateProvisionalThresholdArtifact(sealed(), BOUND_TO),
    ).not.toThrow();
  });

  it("refuses bytes that do not recompute to the declared digest", () => {
    const artifact = { ...sealed(), threshold: 0.5 };
    let thrown: unknown = null;
    try {
      validateProvisionalThresholdArtifact(artifact, BOUND_TO);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvisionalThresholdError);
    expect((thrown as ProvisionalThresholdError).code).toBe(
      "THRESHOLD_ARTIFACT_DIGEST_MISMATCH",
    );
  });

  it("refuses a cut frozen under a calibrator the pre-registration forbids", () => {
    // The mutation this exists for: a fit that DID select a calibrator and said so.
    // Re-digested, so the refusal comes from the cross-check and not from the digest.
    const base = sealed();
    const drifted = {
      ...base,
      preRegistration: {
        ...base.preRegistration,
        probabilisticCalibrator: "platt" as unknown as "none",
      },
    };
    const rebuilt = reseal(drifted);
    let thrown: unknown = null;
    try {
      validateProvisionalThresholdArtifact(rebuilt, BOUND_TO);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvisionalThresholdError);
    expect((thrown as ProvisionalThresholdError).code).toBe(
      "THRESHOLD_PREREGISTRATION_DRIFT",
    );
    expect((thrown as Error).message).toMatch(/probabilisticCalibrator/u);
    expect((thrown as Error).message).toMatch(/"platt"/u);
  });

  it("refuses a cut whose score basis is not the pre-registered one", () => {
    const base = sealed();
    const rebuilt = reseal({
      ...base,
      thresholdBasis: "calibrated-document-score" as never,
    });
    expect(() =>
      validateProvisionalThresholdArtifact(rebuilt, BOUND_TO),
    ).toThrow(/thresholdBasis/u);
  });

  it("refuses a cut fitted over partitions the pre-registration does not name", () => {
    const base = sealed();
    const rebuilt = reseal({ ...base, fitPartitions: ["dev"] });
    expect(() =>
      validateProvisionalThresholdArtifact(rebuilt, BOUND_TO),
    ).toThrow(/fitted over \[dev\]/u);
  });

  it("refuses a cut bound to a different split than the run consuming it", () => {
    let thrown: unknown = null;
    try {
      validateProvisionalThresholdArtifact(sealed(), {
        ...BOUND_TO,
        splitDigest: "7".repeat(64),
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ProvisionalThresholdError);
    expect((thrown as ProvisionalThresholdError).code).toBe(
      "THRESHOLD_GOVERNANCE_MISMATCH",
    );
    expect((thrown as Error).message).toMatch(/splitDigest/u);
  });

  it("refuses a cut bound to a different evaluator", () => {
    expect(() =>
      validateProvisionalThresholdArtifact(sealed(), {
        ...BOUND_TO,
        evaluatorDigest: "8".repeat(64),
      }),
    ).toThrow(/evaluatorDigest/u);
  });
});

// Re-seals an edited artifact so its `artifactDigest` covers the edit. Without this
// every mutation below would be caught by the digest check and the cross-checks
// would never be reached — which is the false-green the review named.
function reseal(
  artifact: ProvisionalThresholdArtifact,
): ProvisionalThresholdArtifact {
  const withoutDigest = withoutArtifactDigest(artifact);
  return {
    ...withoutDigest,
    artifactDigest: canonicalSha256Hex(withoutDigest),
  } as unknown as ProvisionalThresholdArtifact;
}

function withoutArtifactDigest(value: unknown): Record<string, unknown> {
  const copy = { ...(value as Record<string, unknown>) };
  delete copy.artifactDigest;
  return copy;
}

function canonicalSha256Hex(value: unknown): string {
  return sha256BytesHex(new TextEncoder().encode(canonicalJson(value)));
}
