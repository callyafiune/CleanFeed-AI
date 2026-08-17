// The prediction row -> evaluation item mapping, on its own.
//
// `runEvaluate` needs a real open holdout session, so the one line that used to
// hold the defect (`prediction.documentRawScore ?? 0`) was only reachable through
// a full consume-holdout run. `buildEvaluationItem` is exported precisely so the
// branch on `status` is testable directly: an error row must come out with no
// score and no decision, and a contradictory row must fail closed.

import { describe, expect, it } from "vitest";

import {
  buildEvaluationItem,
  certifyingCutFrom,
  certifyingEvaluationOptions,
  measuredCalibrationScoreBasis,
  type CertifyingCut,
} from "../commands/evaluate.ts";
import { CommandError } from "../commands/io.ts";
import type { EvaluationItem } from "../metrics.ts";
import type { StrictPredictionV2 } from "../prediction-schema.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import {
  freezeProvisionalThreshold,
  type ProvisionalThresholdArtifact,
} from "../provisional-threshold.ts";
import type { BenchmarkRecord } from "../schema.ts";

const DIGESTS = {
  datasetDigest: "a".repeat(64),
  datasetAuditDigest: "b".repeat(64),
  splitDigest: "c".repeat(64),
  evaluatorDigest: "d".repeat(64),
  sourceReadinessDigest: "e".repeat(64),
  developmentManifestDigest: "f".repeat(64),
  calibrationManifestDigest: "0".repeat(64),
} as const;

// A hundred human negatives at 0.000, 0.005, ... 0.495: the 0.95 upper quantile lands
// at 0.475, which is a cut a raw score of 0.9 clears and a raw score of 0.2 does not.
// Frozen by the shipped function so the cut under test is the one a fit would seal.
function sealedCut(): ProvisionalThresholdArtifact {
  return freezeProvisionalThreshold({
    samples: Array.from({ length: 100 }, (_unused, index) => ({
      id: `fit_${String(index).padStart(3, "0")}`,
      label: "human",
      partition: index % 2 === 0 ? "dev" : "cal-A",
      documentRawScore: index / 200,
    })),
    testIds: [],
    seed: PREREGISTRATION_V4.seeds.split,
    digests: DIGESTS,
  });
}

const CUT: CertifyingCut = certifyingCutFrom(sealedCut());

const RECORD = {
  id: "rec-1",
  label: "human",
  language: "pt-BR",
  wordCount: 120,
} as unknown as BenchmarkRecord;

function prediction(
  overrides: Partial<StrictPredictionV2> = {},
): StrictPredictionV2 {
  return {
    schemaVersion: 2,
    id: "rec-1",
    status: "scored",
    documentRawScore: 0.9,
    localizedRawScore: 0.9,
    evidenceQuality: "sufficient",
    reasonCode: "SCORED",
    coverage: 1,
    latencyMs: 12,
    memoryBytes: 2_048,
    ...overrides,
  } as StrictPredictionV2;
}

describe("the certifying cut", () => {
  // The achado this unit closes: the sealed pre-registration fixes the cut and the ECE
  // on `document-raw-score`, and the command decided on the calibrated score. Both
  // authorities point the same way — the policy pins the basis, and the operator pinned
  // `probabilisticCalibrator: "none"` — so the cut a certifying run applies is the
  // frozen quantile of the RAW score.
  it("is the pre-registered quantile of the raw document score", () => {
    const artifact = sealedCut();
    const cut = certifyingCutFrom(artifact);
    expect(cut.basis).toBe(PREREGISTRATION_V4.threshold.basis);
    expect(cut.basis).toBe("document-raw-score");
    expect(cut.basis).toBe(PREREGISTRATION_V4.calibrationGate.scoreBasis);
    expect(cut.documentThreshold).toBe(artifact.threshold);
    expect(cut.documentThreshold).toBeCloseTo(0.475, 12);
  });

  // Not "unset": the pre-registration declares ONE cut on ONE basis and pins
  // `maximumStage: "indicator"` with `actionsPromoted: false`, so a v1 measurement has
  // no action cut to apply. Reading the frozen calibration's visual threshold here
  // would apply a calibrated-scale number to raw scores.
  it("carries no action cut, because the v1 pre-inscribes none", () => {
    expect(certifyingCutFrom(sealedCut()).visualDocumentThreshold).toBeNull();
    expect(PREREGISTRATION_V4.rollout.actionsPromoted).toBe(false);
    expect(PREREGISTRATION_V4.rollout.maximumStage).toBe("indicator");
  });
});

describe("certifying metric options", () => {
  // The cheap half of the guard against a measurement computed with NO multiplicity:
  // the divisor of `alpha_família` is the frozen family size, so a missing
  // `preRegisteredStatisticalGates` publishes no simultaneous bound at all and every
  // certifying gate then fails for missing evidence — indistinguishable, at the gate
  // report, from a breached budget. The end-to-end half is in
  // consume-holdout.test.ts, which reads `multiplicity.declared` off the sealed gate
  // report and so also catches a call site that bypasses this helper.
  it("declares the pre-registered family size as m", () => {
    const options = certifyingEvaluationOptions(20260804, true);
    expect(options.preRegisteredStatisticalGates).toBe(
      PREREGISTRATION_V4.multiplicity.primaryFamilySize,
    );
    expect(options.preRegisteredStatisticalGates).toBe(4);
    expect(options.bootstrapSeed).toBe(20260804);
    expect(options.visualActionAvailable).toBe(true);
  });
});

describe("the measured calibration basis", () => {
  // The half of the gate this closes. A constant declaring `document-raw-score` —
  // hand-written, or worse, read off the very policy field the gate compares it against —
  // keeps declaring it after somebody puts a calibrator back inside
  // `buildEvaluationItem`, and `score-basis-mismatch` then compares the hypothesis with
  // itself and agrees. Derived from the numbers, the declaration is a fact about the
  // mapping that ran.
  it("is the cut's own basis while the mapping transforms nothing", () => {
    const rows = [0, 0.2, 0.475, 1].map((raw) => {
      const prediction_ = prediction({
        documentRawScore: raw,
        localizedRawScore: raw,
      });
      return {
        prediction: prediction_,
        item: buildEvaluationItem(CUT, RECORD, prediction_),
      };
    });
    expect(measuredCalibrationScoreBasis(CUT, rows)).toBe(CUT.basis);
    expect(measuredCalibrationScoreBasis(CUT, rows)).toBe(
      PREREGISTRATION_V4.calibrationGate.scoreBasis,
    );
  });

  // One representable step is enough, and it has to be: a calibrator that barely moves
  // the score still moves the ECE off the pre-registered hypothesis, and the gate has to
  // see it.
  it("reports a calibrated basis when one single score was transformed", () => {
    const row = prediction({ documentRawScore: 0.9, localizedRawScore: 0.9 });
    const untouched = {
      prediction: row,
      item: buildEvaluationItem(CUT, RECORD, row),
    };
    const transformed = {
      prediction: row,
      item: {
        ...(buildEvaluationItem(CUT, RECORD, row) as EvaluationItem & {
          status: "scored";
        }),
        documentScore: 0.9 + Number.EPSILON,
      },
    };
    expect(measuredCalibrationScoreBasis(CUT, [untouched, transformed])).toBe(
      "document-calibrated-score",
    );
    // And `document-calibrated-score` is the value benchmark/gates.ts refuses the global
    // calibration hypothesis on — it is not a free-form label.
    expect(
      measuredCalibrationScoreBasis(CUT, [untouched, transformed]),
    ).not.toBe(PREREGISTRATION_V4.calibrationGate.scoreBasis);
  });

  function erroredRow(): {
    prediction: StrictPredictionV2;
    item: EvaluationItem;
  } {
    const errored = prediction({
      status: "error",
      documentRawScore: null,
      localizedRawScore: null,
      evidenceQuality: "unsupported",
      reasonCode: "INFERENCE_FAILED",
      failureDetail: "MODEL_TIMEOUT",
      coverage: 0,
      memoryBytes: null,
    });
    return {
      prediction: errored,
      item: buildEvaluationItem(CUT, RECORD, errored),
    };
  }

  // An unscored row carries no score to compare, and its absence must not read as a
  // transform: an errored block would otherwise refuse the basis it never touched.
  //
  // ONE scored row rides along, and it is what keeps this case apart from the empty one
  // below: with the errored row alone the answer would be the cut's basis for two
  // different reasons at once — nothing was transformed, and nothing was measured — and
  // the assertion could not tell which one it was reading.
  it("ignores rows that carry no score at all", () => {
    const untouched = prediction({
      documentRawScore: 0.3,
      localizedRawScore: 0.3,
    });
    expect(
      measuredCalibrationScoreBasis(CUT, [
        erroredRow(),
        {
          prediction: untouched,
          item: buildEvaluationItem(CUT, RECORD, untouched),
        },
      ]),
    ).toBe(CUT.basis);
  });

  // Nothing scored, so there is no calibration statistic and no basis it could have been
  // measured over: the derivation must REFUSE to name one instead of naming the cut's.
  // `rows.every` is vacuously true on a set with no scored row, so the empty answer used to
  // be `document-raw-score` — a claim about a computation that did not happen, and the one
  // the gate compares `calibrationGate.scoreBasis` against before publishing an ECE.
  it("names no basis when nothing was scored at all", () => {
    for (const rows of [[], [erroredRow()], [erroredRow(), erroredRow()]]) {
      expect(measuredCalibrationScoreBasis(CUT, rows)).toBe(
        "document-calibrated-score",
      );
      expect(measuredCalibrationScoreBasis(CUT, rows)).not.toBe(
        PREREGISTRATION_V4.calibrationGate.scoreBasis,
      );
    }
  });
});

describe("buildEvaluationItem", () => {
  it("carries the RAW score and cuts on it for a scored row", () => {
    const item = buildEvaluationItem(CUT, RECORD, prediction());
    expect(item.status).toBe("scored");
    if (item.status !== "scored") throw new Error("expected a scored item");
    // The published score IS the raw score, byte for byte: nothing is applied to it,
    // which is what makes the ECE the pre-registered hypothesis' own statistic.
    expect(item.documentScore).toBe(0.9);
    expect(item.warned).toBe(true);
    expect(item.visualActioned).toBe(false);
    expect(item.latencyMs).toBe(12);
    expect(item.memoryBytes).toBe(2_048);
  });

  // The mutation this pins: a `documentScore` produced by applying the frozen
  // calibrator moves off the raw value, so a run that restored the calibrated path
  // fails here naming the basis.
  it("leaves the raw score untransformed on both sides of the cut", () => {
    for (const raw of [0, 0.2, 0.474_999, 0.475, 0.9, 1]) {
      const item = buildEvaluationItem(
        CUT,
        RECORD,
        prediction({ documentRawScore: raw, localizedRawScore: raw }),
      );
      if (item.status !== "scored") throw new Error("expected a scored item");
      expect(item.documentScore).toBe(raw);
      expect(item.warned).toBe(raw >= CUT.documentThreshold);
    }
  });

  // `runtimeComparator: "score-ge-next-up-quantile"`: the draw AT the cut is one of
  // the accusations, and it is the same comparator `population.atOrAboveThreshold`
  // is counted with.
  it("warns AT the cut and not one draw above it", () => {
    const at = buildEvaluationItem(
      CUT,
      RECORD,
      prediction({
        documentRawScore: CUT.documentThreshold,
        localizedRawScore: 0,
      }),
    );
    if (at.status !== "scored") throw new Error("expected a scored item");
    expect(at.warned).toBe(true);
  });

  // The localized path decides nothing: the v1 pre-inscribes one cut, and a served
  // localized trigger would raise warnings the measurement never counted.
  it("never warns from the localized score", () => {
    const item = buildEvaluationItem(
      CUT,
      RECORD,
      prediction({ documentRawScore: 0.1, localizedRawScore: 1 }),
    );
    if (item.status !== "scored") throw new Error("expected a scored item");
    expect(item.warned).toBe(false);
  });

  it("gives an errored row no score and no decision at all", () => {
    const item = buildEvaluationItem(
      CUT,
      RECORD,
      prediction({
        status: "error",
        documentRawScore: null,
        localizedRawScore: null,
        evidenceQuality: "unsupported",
        reasonCode: "INFERENCE_FAILED",
        failureDetail: "MODEL_TIMEOUT",
        coverage: 0,
        memoryBytes: null,
      }),
    );

    expect(item.status).toBe("error");
    // No substituted score, and therefore no decision to be counted as a true
    // negative: the keys do not exist on the row at all.
    expect("documentScore" in item).toBe(false);
    expect("warned" in item).toBe(false);
    expect("visualActioned" in item).toBe(false);
    expect("memoryBytes" in item).toBe(false);
  });

  it("gives an abstained row no score and no decision either", () => {
    const item = buildEvaluationItem(
      CUT,
      RECORD,
      prediction({
        status: "abstained",
        documentRawScore: null,
        localizedRawScore: null,
        evidenceQuality: "limited",
        reasonCode: "INSUFFICIENT_EVIDENCE",
        coverage: 0,
      }),
    );

    expect(item.status).toBe("abstained");
    expect("documentScore" in item).toBe(false);
    expect("warned" in item).toBe(false);
  });

  it("fails closed on a scored row whose raw score is null", () => {
    for (const overrides of [
      { documentRawScore: null },
      { localizedRawScore: null },
    ]) {
      let thrown: unknown;
      try {
        buildEvaluationItem(CUT, RECORD, prediction(overrides));
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(CommandError);
      expect((thrown as CommandError).code).toBe(
        "SCORED_PREDICTION_WITHOUT_SCORE",
      );
    }
  });
});
