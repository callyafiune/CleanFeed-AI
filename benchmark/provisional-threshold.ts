// The ONE provisional threshold the v1 freezes, and nothing else.
//
// There is no calibrator competition here and no conformal interval: the v1
// pre-registration sets `threshold.probabilisticCalibrator: "none"`, so the cut is a
// one-sided quantile of the RAW document score over the human negatives of `dev` and
// `cal-A`, and the artifact says which score, which quantile, which partitions and
// over which governance digests it was frozen.
//
// DOMAIN RULE, because the code cannot reveal it: the score this module cuts is
// `documentRawScore` — the head's own softmax after document aggregation — and it is
// the SAME number the global calibration hypothesis is measured on
// (`calibrationGate.scoreBasis`, cross-checked by the policy parser). Bounding the
// calibration error of a raw softmax does NOT make it a probability, and nothing
// downstream may describe this threshold as "high confidence", "conservative" or a
// probability of anything.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// There is no Date and no randomness: the artifact is a pure function of the scores,
// the digests and the policy bytes.

import { canonicalJson } from "../contracts/canonical-json.ts";
import { sha256BytesHex } from "./digests.ts";
import { PREREGISTRATION_V4 } from "./preregistration-v4.ts";
import type { ScoreBasis } from "./preregistration-v4.ts";

/** Coded, fail-closed error of the provisional threshold freeze. */
export class ProvisionalThresholdError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(`${code}: ${message}`);
    this.name = "ProvisionalThresholdError";
    this.code = code;
  }
}

/**
 * One human negative of the fit population, with the raw document score it was given.
 *
 * `documentRawScore` is REQUIRED and not nullable on purpose. An unscored document is
 * not a zero: padding the human sample with fake zeros pulls the one-sided quantile
 * DOWN, which lowers the threshold and RAISES the real false-positive rate, so the
 * coercion breaks the accusation budget instead of erring toward it.
 */
export interface ThresholdSample {
  readonly id: string;
  /**
   * The record's own label. Passed IN so the freeze can REFUSE anything but `human`:
   * the pre-registered population is human negatives, and a positive that reached
   * this array would raise the quantile and widen the accusation budget without
   * anything in the artifact showing it.
   */
  readonly label: string;
  readonly partition: string;
  readonly documentRawScore: number;
}

/** The governance digests the frozen threshold is bound to. */
export interface ThresholdDigests {
  readonly datasetDigest: string;
  readonly datasetAuditDigest: string;
  readonly splitDigest: string;
  readonly evaluatorDigest: string;
  readonly sourceReadinessDigest: string;
  readonly developmentManifestDigest: string;
  readonly calibrationManifestDigest: string;
}

export interface FreezeProvisionalThresholdInput {
  readonly samples: readonly ThresholdSample[];
  /**
   * Every id assigned to the blocked test partition. Passed IN so it can be
   * REFUSED: a threshold fitted over even one test row has consumed the blind block
   * before the measurement it exists to enable.
   */
  readonly testIds: readonly string[];
  readonly seed: number;
  readonly digests: ThresholdDigests;
}

/**
 * The sealed provisional-threshold artifact.
 *
 * There is no calibrator field, no selection evidence and no per-band threshold, and
 * their absence is the decision rather than an omission: the v1 fits no probabilistic
 * calibrator at all.
 */
export interface ProvisionalThresholdArtifact {
  readonly schemaVersion: 1;
  readonly thresholdVersion: string;
  readonly thresholdBasis: ScoreBasis;
  readonly threshold: number;
  readonly fitPartitions: readonly string[];
  /**
   * The declared seed of the `fit` invocation. Recorded so the artifact names every
   * input it was produced from — NOT consumed by the quantile, which is deterministic:
   * a threshold that moved with the seed would not be a quantile of the sample.
   */
  readonly seed: number;
  readonly digests: ThresholdDigests;
  /**
   * What the artifact READ from the pre-registration, restated so a reader holding
   * only this file can check the cut against the family it belongs to.
   */
  readonly preRegistration: {
    readonly policyVersion: string;
    readonly calibrationScoreBasis: ScoreBasis;
    readonly fprBudgetPerCell: number;
    readonly multiplicity: {
      readonly correction: "bonferroni";
      readonly familyAlpha: number;
      readonly perHypothesisAlpha: number;
      readonly primaryFamilySize: number;
    };
    readonly probabilisticCalibrator: "none";
    readonly quantile: number;
    readonly side: "upper";
  };
  /** The sample the quantile was taken over, as counts only. */
  readonly population: {
    readonly humanNegatives: number;
    readonly atOrAboveThreshold: number;
  };
  readonly artifactDigest: string;
}

/** Synchronous canonical SHA-256 — byte-identical to `canonicalSha256`. */
function canonicalDigest(value: unknown): string {
  return sha256BytesHex(new TextEncoder().encode(canonicalJson(value)));
}

/**
 * Freezes the provisional threshold, or refuses with a code naming why.
 *
 * The cut is the empirical one-sided quantile of the sample by the classic
 * conservative order statistic: sort ascending, take position `ceil(q * n)`. It is a
 * QUANTILE and nothing more — whether the false-positive rate it produces meets
 * `fprBudgets.warning` is decided on `test` by the gates, not here, and the two are
 * different statements. What this module publishes so the difference is visible is
 * `population.atOrAboveThreshold`, counted with `>=` because that is the comparator
 * the runtime applies (`runtimeComparator: "score-ge-next-up-quantile"`): on a sample
 * whose scores are tied at the cut, that count is large and the reader sees it
 * instead of inferring a budget that was never checked.
 */
export function freezeProvisionalThreshold(
  input: FreezeProvisionalThresholdInput,
): ProvisionalThresholdArtifact {
  const policy = PREREGISTRATION_V4;
  const allowed = policy.threshold.quantilePartitions;
  const blocked = new Set(input.testIds);

  const seen = new Set<string>();
  for (const sample of input.samples) {
    if (blocked.has(sample.id)) {
      throw new ProvisionalThresholdError(
        "THRESHOLD_TEST_ID_PRESENT",
        `record "${sample.id}" is assigned to the blocked test partition and may not enter the threshold fit`,
      );
    }
    if (seen.has(sample.id)) {
      throw new ProvisionalThresholdError(
        "THRESHOLD_DUPLICATE_ID",
        `record "${sample.id}" appears twice in the fit population; a repeated line double-weights one draw in the quantile and inflates the published denominator`,
      );
    }
    seen.add(sample.id);
    if (sample.label !== "human") {
      throw new ProvisionalThresholdError(
        "THRESHOLD_POPULATION_NOT_HUMAN",
        `record "${sample.id}" is labelled "${sample.label}"; the frozen population is ${policy.threshold.population} and a positive in it raises the cut`,
      );
    }
    if (!allowed.includes(sample.partition)) {
      throw new ProvisionalThresholdError(
        "THRESHOLD_PARTITION_FORBIDDEN",
        `record "${sample.id}" is in partition "${sample.partition}"; the frozen fit population is ${allowed.join(" + ")}`,
      );
    }
    if (!Number.isFinite(sample.documentRawScore)) {
      throw new ProvisionalThresholdError(
        "THRESHOLD_SCORE_MISSING",
        `record "${sample.id}" has no finite ${policy.threshold.basis}; an unscored document is not a zero`,
      );
    }
  }

  // The quantile needs enough draws for its own tail to exist: with a budget of
  // `1 - quantile`, a sample of fewer than `1 / (1 - quantile)` rows cannot place a
  // single row above the cut, so every threshold would read as satisfying the budget
  // by having no tail at all.
  const budget = 1 - policy.threshold.quantile;
  const minimumSamples = Math.ceil(1 / budget);
  if (input.samples.length < minimumSamples) {
    throw new ProvisionalThresholdError(
      "THRESHOLD_POPULATION_TOO_SMALL",
      `the fit population holds ${input.samples.length} human negative(s); a ${policy.threshold.quantile} quantile needs at least ${minimumSamples}`,
    );
  }

  const scores = input.samples
    .map((sample) => sample.documentRawScore)
    .sort((a, b) => a - b);
  const total = scores.length;
  // `ceil(q * n)` as a ZERO-BASED index, which leaves `n - position` draws at or
  // above the cut — the smallest tail that is still within `1 - q`. Taking
  // `ceil(q * n) - 1` instead (the textbook quantile for a `>` comparator) leaves one
  // draw too many, because the runtime warns on `score >= threshold` and the draw AT
  // the cut is one of the accusations. That off-by-one is 6 % where the budget is 5 %.
  //
  // No clamp against `total - 1`, and the floor above is why: `n >= 1/(1-q)` gives
  // `q*n <= n-1`, and `n-1` is an integer at least `q*n`, so `ceil(q*n) <= n-1` for
  // every population this function accepts. A clamp here would be a branch no input
  // can reach, which reads as a defence and is not one.
  const position = Math.ceil(policy.threshold.quantile * total);
  const threshold = scores[position];
  let atOrAbove = 0;
  for (const score of scores) {
    if (score >= threshold) atOrAbove += 1;
  }

  const withoutDigest = {
    schemaVersion: 1 as const,
    thresholdVersion: policy.threshold.version,
    thresholdBasis: policy.threshold.basis,
    threshold,
    fitPartitions: [...allowed],
    seed: input.seed,
    digests: { ...input.digests },
    preRegistration: {
      policyVersion: policy.policyVersion,
      calibrationScoreBasis: policy.calibrationGate.scoreBasis,
      fprBudgetPerCell: policy.fprBudgets.warning,
      multiplicity: {
        correction: policy.multiplicity.correction,
        familyAlpha: policy.multiplicity.familyAlpha,
        perHypothesisAlpha: policy.multiplicity.perHypothesisAlpha,
        primaryFamilySize: policy.multiplicity.primaryFamilySize,
      },
      probabilisticCalibrator: policy.threshold.probabilisticCalibrator,
      quantile: policy.threshold.quantile,
      side: policy.threshold.side,
    },
    population: {
      humanNegatives: total,
      atOrAboveThreshold: atOrAbove,
    },
  };
  return Object.freeze({
    ...withoutDigest,
    artifactDigest: canonicalDigest(withoutDigest),
  });
}

/**
 * Re-reads a sealed provisional-threshold artifact and refuses it unless it is the
 * cut THIS pre-registration frozen over THESE governance digests.
 *
 * Three failures, kept apart because they are different news: bytes that do not
 * recompute to `artifactDigest`; a cut whose restated pre-registration disagrees with
 * the policy the reader loaded (the fit ran under different frozen values); and a cut
 * bound to a different dataset, split or evaluator than the run consuming it.
 *
 * Called by the certifying path so the pre-registered cut cannot simply be MISSING at
 * measurement time. Freezing it and never reading it again would leave the policy's
 * `probabilisticCalibrator: "none"` as a claim nothing checks.
 */
export function validateProvisionalThresholdArtifact(
  artifact: ProvisionalThresholdArtifact,
  boundTo: Pick<
    ThresholdDigests,
    "datasetDigest" | "splitDigest" | "evaluatorDigest"
  >,
): void {
  const policy = PREREGISTRATION_V4;
  const { artifactDigest, ...withoutDigest } = artifact;
  const recomputed = canonicalDigest(withoutDigest);
  if (recomputed !== artifactDigest) {
    throw new ProvisionalThresholdError(
      "THRESHOLD_ARTIFACT_DIGEST_MISMATCH",
      `the artifact's bytes hash to ${recomputed} but it declares ${artifactDigest}`,
    );
  }
  const restated: ReadonlyArray<readonly [string, unknown, unknown]> = [
    ["thresholdBasis", artifact.thresholdBasis, policy.threshold.basis],
    ["thresholdVersion", artifact.thresholdVersion, policy.threshold.version],
    [
      "preRegistration.policyVersion",
      artifact.preRegistration.policyVersion,
      policy.policyVersion,
    ],
    [
      "preRegistration.probabilisticCalibrator",
      artifact.preRegistration.probabilisticCalibrator,
      policy.threshold.probabilisticCalibrator,
    ],
    [
      "preRegistration.quantile",
      artifact.preRegistration.quantile,
      policy.threshold.quantile,
    ],
    [
      "preRegistration.side",
      artifact.preRegistration.side,
      policy.threshold.side,
    ],
    [
      "preRegistration.calibrationScoreBasis",
      artifact.preRegistration.calibrationScoreBasis,
      policy.calibrationGate.scoreBasis,
    ],
    [
      "preRegistration.fprBudgetPerCell",
      artifact.preRegistration.fprBudgetPerCell,
      policy.fprBudgets.warning,
    ],
    [
      "preRegistration.multiplicity.primaryFamilySize",
      artifact.preRegistration.multiplicity.primaryFamilySize,
      policy.multiplicity.primaryFamilySize,
    ],
    [
      "preRegistration.multiplicity.perHypothesisAlpha",
      artifact.preRegistration.multiplicity.perHypothesisAlpha,
      policy.multiplicity.perHypothesisAlpha,
    ],
  ];
  for (const [field, found, expected] of restated) {
    if (found !== expected) {
      throw new ProvisionalThresholdError(
        "THRESHOLD_PREREGISTRATION_DRIFT",
        `the frozen threshold declares ${field} = ${JSON.stringify(found)} while the pre-registration on disk says ${JSON.stringify(expected)}`,
      );
    }
  }
  if (
    [...artifact.fitPartitions].join(",") !==
    [...policy.threshold.quantilePartitions].join(",")
  ) {
    throw new ProvisionalThresholdError(
      "THRESHOLD_PREREGISTRATION_DRIFT",
      `the frozen threshold was fitted over [${artifact.fitPartitions.join(", ")}] while the pre-registration names [${policy.threshold.quantilePartitions.join(", ")}]`,
    );
  }
  for (const key of [
    "datasetDigest",
    "splitDigest",
    "evaluatorDigest",
  ] as const) {
    if (artifact.digests[key] !== boundTo[key]) {
      throw new ProvisionalThresholdError(
        "THRESHOLD_GOVERNANCE_MISMATCH",
        `the frozen threshold's ${key} (${artifact.digests[key]}) is not the one this run is bound to (${boundTo[key]})`,
      );
    }
  }
}
