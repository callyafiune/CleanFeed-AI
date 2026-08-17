import { describe, expect, it } from "vitest";

import {
  applySerializedCalibrator,
  calibrateResult,
  decideWithProfile,
  getLengthBucket,
  normalizeCalibrationPlatform,
  resolveCalibrationProfile,
  type DecideWithProfileInput,
} from "@/inference/calibration";
import type { ProfileLookup } from "@/inference/calibration-registry";
import {
  DISABLED_THRESHOLD,
  type RuntimeCalibrationProfileV1,
  type SerializedCalibratorV1,
} from "../../../contracts/calibration-profile";
import type {
  AggregationResultV2,
  ClassificationResult,
  EvidenceAssessment,
} from "@/shared/types";
import {
  BETA_CALIBRATOR,
  BETA_VECTORS,
  ISOTONIC_CALIBRATOR,
  ISOTONIC_VECTORS,
  PLATT_CALIBRATOR,
  PLATT_VECTORS,
} from "../../helpers/calibration-vectors";
import {
  createBundleRuntimeIdentity,
  createDecisionOutcome,
  createEvidenceAssessment,
} from "../../helpers/model-fixtures";

const aggregation: AggregationResultV2 = {
  version: "tmr-aggregation-v3",
  documentRawScore: 0.95,
  localizedRawScore: 0.96,
  coverage: 1,
  truncated: false,
  weightedMean: 0.95,
  median: 0.95,
  min: 0.94,
  max: 0.96,
  stdDev: 0.02,
  highScoreRatio: 1,
  chunkAgreement: 0.96,
  candidateWindowCount: 3,
  selectedWindowIndices: [0, 1, 2],
};

function baseResult(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    aiScore: 0.95,
    humanScore: 0.05,
    confidence: "high",
    status: "possibly_ai",
    wordCount: 160,
    tokenCount: 180,
    language: "pt",
    aggregation,
    runtimeIdentity: createBundleRuntimeIdentity(),
    evidence: createEvidenceAssessment(),
    decision: createDecisionOutcome(),
    modelVersion: "test",
    modelId: "test-model",
    backend: "wasm",
    processingTimeMs: 1,
    demo: false,
    ...overrides,
  };
}

const IDENTITY: SerializedCalibratorV1 = {
  kind: "isotonic",
  interpolation: "linear",
  clamp: true,
  knots: [
    { rawScore: 0, calibratedScore: 0 },
    { rawScore: 1, calibratedScore: 1 },
  ],
};

const PROFILE_DIGEST = "a".repeat(64);
const PROFILE_EXPIRES_AT = "2026-06-30T00:00:00.000Z";

/**
 * A found-profile lookup with identity calibrators, so `calibratedScore` equals
 * the raw score and each threshold test isolates one branch of the policy. It
 * also carries a `profileDigest`/`expiresAt` so the applied-profile binding can
 * be asserted.
 */
function foundLookup(
  overrides: Partial<RuntimeCalibrationProfileV1> = {},
): ProfileLookup {
  const profile = {
    profileDigest: PROFILE_DIGEST,
    expiresAt: PROFILE_EXPIRES_AT,
    calibrators: { document: IDENTITY, localized: IDENTITY },
    thresholds: {
      documentIndicator: 0.8,
      localizedIndicator: 0.8,
      documentAction: 0.9,
    },
    gateEvidence: { decision: "pass" },
    actionCeiling: "hide",
    ...overrides,
  } as unknown as RuntimeCalibrationProfileV1;
  return { status: "found", profile };
}

function evidence(
  quality: EvidenceAssessment["quality"] = "sufficient",
): EvidenceAssessment {
  return {
    quality,
    coverage: 1,
    lexicalRatio: 1,
    truncated: false,
    exactTokenizer: true,
    reasonCodes: [],
  };
}

function agg(
  documentRawScore: number,
  localizedRawScore: number,
): AggregationResultV2 {
  return { ...aggregation, documentRawScore, localizedRawScore };
}

function decideInput(
  overrides: Partial<DecideWithProfileInput> = {},
): DecideWithProfileInput {
  return {
    lookup: foundLookup(),
    aggregation: agg(0.5, 0.5),
    evidence: evidence("sufficient"),
    rolloutState: "actions",
    wordCount: 200,
    ...overrides,
  };
}

describe("getLengthBucket", () => {
  it.each([
    [50, "50_79"],
    [79, "50_79"],
    [80, "80_99"],
    [100, "100_149"],
    [150, "150_299"],
    [300, "300_PLUS"],
  ] as const)("maps %i words to %s", (count, bucket) => {
    expect(getLengthBucket(count)).toBe(bucket);
  });
});

describe("normalizeCalibrationPlatform", () => {
  it.each(["linkedin", "manual", "any-future-adapter"])(
    'maps adapter "%s" to the single generic v1 profile pool',
    (adapterId) => {
      // v1 policy: calibration profiles are published with platform "generic"
      // (generic pt-BR corpus), so EVERY adapter id normalizes to that pool
      // and a "generic" profile is found for a "linkedin" request.
      expect(normalizeCalibrationPlatform(adapterId)).toBe("generic");
    },
  );
});

describe("resolveCalibrationProfile", () => {
  it("labels the conservative profile by length and language without threshold fields", () => {
    const profile = resolveCalibrationProfile(baseResult({ wordCount: 120 }));
    expect(profile).toEqual({
      id: "default-pt-100_149",
      platform: "default",
      language: "pt",
      lengthBucket: "100_149",
    });
    expect(profile).not.toHaveProperty("markingThreshold");
  });
});

describe("calibrateResult (builtin heuristic path)", () => {
  it("abstains on unsupported language and chunk disagreement", () => {
    const outcome = calibrateResult(
      baseResult({
        language: "und",
        aggregation: { ...aggregation, stdDev: 0.4, chunkAgreement: 0.2 },
      }),
    );
    expect(outcome.status).toBe("insufficient_evidence");
    expect(outcome.abstained).toBe(true);
    expect(outcome.actionCeiling).toBe("indicator");
  });
});

describe("applySerializedCalibrator", () => {
  it("reproduces the shared isotonic vector (0.25/-1/2)", () => {
    for (const { rawScore, expected } of ISOTONIC_VECTORS) {
      expect(
        applySerializedCalibrator(ISOTONIC_CALIBRATOR, rawScore),
      ).toBeCloseTo(expected, 10);
    }
  });

  it("reproduces the shared platt vector", () => {
    for (const { rawScore, expected } of PLATT_VECTORS) {
      expect(applySerializedCalibrator(PLATT_CALIBRATOR, rawScore)).toBeCloseTo(
        expected,
        10,
      );
    }
  });

  it("reproduces the shared beta vector", () => {
    for (const { rawScore, expected } of BETA_VECTORS) {
      expect(applySerializedCalibrator(BETA_CALIBRATOR, rawScore)).toBeCloseTo(
        expected,
        6,
      );
    }
  });
});

describe("decideWithProfile", () => {
  it("abstains without presentation when evidence is unsupported, even at score 1", () => {
    const { outcome } = decideWithProfile(
      decideInput({
        aggregation: agg(1, 1),
        evidence: evidence("unsupported"),
      }),
    );
    expect(outcome.abstained).toBe(true);
    expect(outcome.presentationAllowed).toBe(false);
    expect(outcome.triggers).toEqual([]);
    expect(outcome.reasonCodes).toContain("INSUFFICIENT_EVIDENCE");
  });

  it.each([
    ["missing", "MODEL_PROFILE_MISSING"],
    ["expired", "PROFILE_EXPIRED"],
    ["out-of-release", "MODEL_PROFILE_MISMATCH"],
  ] as const)(
    "abstains with a specific reason when the profile is %s",
    (status, reason) => {
      const lookup = { status, reason } as ProfileLookup;
      const { outcome } = decideWithProfile(
        decideInput({ lookup, aggregation: agg(1, 1) }),
      );
      expect(outcome.abstained).toBe(true);
      expect(outcome.presentationAllowed).toBe(false);
      expect(outcome.reasonCodes).toContain(reason);
    },
  );

  it("produces no trigger and no presentation when both signals are below threshold", () => {
    const { outcome } = decideWithProfile(
      decideInput({ aggregation: agg(0.5, 0.5) }),
    );
    expect(outcome.triggers).toEqual([]);
    expect(outcome.presentationAllowed).toBe(false);
    expect(outcome.abstained).toBe(false);
    expect(outcome.calibratedScore).toBeCloseTo(0.5, 10);
    expect(outcome.status).toBe("probably_human");
  });

  it("fires the document trigger alone (calibratedScore = document)", () => {
    const { outcome } = decideWithProfile(
      decideInput({ aggregation: agg(0.85, 0.5) }),
    );
    expect(outcome.triggers).toEqual(["document"]);
    expect(outcome.calibratedScore).toBeCloseTo(0.85, 10);
    expect(outcome.actionCeiling).toBe("indicator");
    expect(outcome.status).toBe("possibly_ai");
    expect(outcome.presentationAllowed).toBe(true);
  });

  it("fires the localized trigger alone and caps at indicator", () => {
    const { outcome } = decideWithProfile(
      decideInput({ aggregation: agg(0.5, 0.85) }),
    );
    expect(outcome.triggers).toEqual(["localized"]);
    expect(outcome.calibratedScore).toBeCloseTo(0.85, 10);
    expect(outcome.actionCeiling).toBe("indicator");
    expect(outcome.reasonCodes).toContain("LOCALIZED_SIGNAL");
  });

  it("fires both triggers in canonical order and takes the max calibrated score", () => {
    const { outcome } = decideWithProfile(
      decideInput({ aggregation: agg(0.95, 0.85) }),
    );
    expect(outcome.triggers).toEqual(["document", "localized"]);
    expect(outcome.calibratedScore).toBeCloseTo(0.95, 10);
  });

  it("authorizes a hide ceiling only with a document action under an actions rollout", () => {
    const { outcome } = decideWithProfile(
      decideInput({ aggregation: agg(0.95, 0.85) }),
    );
    expect(outcome.actionCeiling).toBe("hide");
    expect(outcome.status).toBe("strong_ai_indication");
    expect(outcome.presentationAllowed).toBe(true);
  });

  it("caps at indicator when evidence is only limited", () => {
    const { outcome } = decideWithProfile(
      decideInput({
        aggregation: agg(0.95, 0.5),
        evidence: evidence("limited"),
      }),
    );
    expect(outcome.actionCeiling).toBe("indicator");
    expect(outcome.reasonCodes).toContain("LIMITED_EVIDENCE");
  });

  it("caps at indicator for the 50-79 word bucket", () => {
    const { outcome } = decideWithProfile(
      decideInput({ aggregation: agg(0.95, 0.5), wordCount: 60 }),
    );
    expect(outcome.actionCeiling).toBe("indicator");
  });

  it("caps at indicator under an indicator rollout even when the action gate passes", () => {
    const { outcome } = decideWithProfile(
      decideInput({ aggregation: agg(0.95, 0.85), rolloutState: "indicator" }),
    );
    expect(outcome.actionCeiling).toBe("indicator");
    expect(outcome.presentationAllowed).toBe(true);
  });

  it.each(["bundle-verified", "shadow"] as const)(
    "never permits presentation under a %s rollout",
    (rolloutState) => {
      const { outcome } = decideWithProfile(
        decideInput({ aggregation: agg(0.95, 0.85), rolloutState }),
      );
      expect(outcome.presentationAllowed).toBe(false);
    },
  );

  // The v1 profile this release publishes: the document cut is the pre-registered
  // quantile, and BOTH other thresholds are the contract's disabled 1. A saturated score
  // is exactly 1 and not 0.999… — the localized score is a max over chunk softmaxes — so
  // a bare `score >= threshold` fired the localized trigger and authorized the action on
  // a path the measurement never counted. It has to fire on nothing.
  it("never fires a disabled threshold, not even at a saturated score of 1", () => {
    const { outcome } = decideWithProfile(
      decideInput({
        lookup: foundLookup({
          thresholds: {
            documentIndicator: 0.475,
            localizedIndicator: DISABLED_THRESHOLD,
            documentAction: DISABLED_THRESHOLD,
          },
        }),
        aggregation: agg(0.1, 1),
      }),
    );
    expect(outcome.triggers).toEqual([]);
    expect(outcome.reasonCodes).not.toContain("LOCALIZED_SIGNAL");
    expect(outcome.status).toBe("probably_human");
    expect(outcome.presentationAllowed).toBe(false);
  });

  // The DOCUMENT half of the disabled encoding, which the two cases around it never
  // reach: both serve the pre-registered cut on `documentIndicator`, so the only trigger
  // that was ever measured against a 1 is the localized one. A profile whose document
  // indicator is the sentinel is what a `reject` publication would have to be read as —
  // and a bare `score >= threshold` there would accuse every saturated document while the
  // release estimated the false-positive rate of nothing at all.
  it("fires no document trigger against a disabled indicator, at a saturated score of 1", () => {
    const { outcome } = decideWithProfile(
      decideInput({
        lookup: foundLookup({
          thresholds: {
            documentIndicator: DISABLED_THRESHOLD,
            localizedIndicator: DISABLED_THRESHOLD,
            documentAction: DISABLED_THRESHOLD,
          },
        }),
        aggregation: agg(1, 1),
      }),
    );
    expect(outcome.triggers).toEqual([]);
    expect(outcome.status).toBe("probably_human");
    expect(outcome.presentationAllowed).toBe(false);
    // `actions` is the rollout of `decideInput`, so the ceiling is not held down by the
    // rollout: nothing fired, and a decision nothing fired for presents nothing.
    expect(outcome.abstained).toBe(false);
    expect(outcome.actionCeiling).toBe("indicator");
  });

  // The other half of the same encoding: a document score of exactly 1 fires the
  // indicator it was measured against and STILL authorizes no action, because the action
  // threshold is off rather than merely high.
  it("keeps a saturated document score at the indicator ceiling", () => {
    const { outcome } = decideWithProfile(
      decideInput({
        lookup: foundLookup({
          thresholds: {
            documentIndicator: 0.475,
            localizedIndicator: DISABLED_THRESHOLD,
            documentAction: DISABLED_THRESHOLD,
          },
        }),
        aggregation: agg(1, 1),
      }),
    );
    expect(outcome.triggers).toEqual(["document"]);
    expect(outcome.actionCeiling).toBe("indicator");
    expect(outcome.status).toBe("possibly_ai");
  });
});

describe("decideWithProfile applied-profile binding", () => {
  it("surfaces the applied profile's digest and expiry when a trigger fires", () => {
    const { outcome, appliedProfile } = decideWithProfile(
      decideInput({ aggregation: agg(0.85, 0.5) }),
    );
    expect(outcome.triggers).toEqual(["document"]);
    expect(appliedProfile).toEqual({
      profileDigest: PROFILE_DIGEST,
      expiresAt: PROFILE_EXPIRES_AT,
    });
  });

  it("still surfaces the applied profile when no trigger fires (probably_human)", () => {
    const { outcome, appliedProfile } = decideWithProfile(
      decideInput({ aggregation: agg(0.5, 0.5) }),
    );
    expect(outcome.status).toBe("probably_human");
    expect(appliedProfile).toEqual({
      profileDigest: PROFILE_DIGEST,
      expiresAt: PROFILE_EXPIRES_AT,
    });
  });

  it("omits the applied profile when evidence is unsupported, even with a found profile", () => {
    const { appliedProfile } = decideWithProfile(
      decideInput({
        aggregation: agg(1, 1),
        evidence: evidence("unsupported"),
      }),
    );
    expect(appliedProfile).toBeUndefined();
  });

  it.each([
    ["missing", "MODEL_PROFILE_MISSING"],
    ["expired", "PROFILE_EXPIRED"],
    ["out-of-release", "MODEL_PROFILE_MISMATCH"],
  ] as const)(
    "omits the applied profile when the profile is %s",
    (status, reason) => {
      const lookup = { status, reason } as ProfileLookup;
      const { appliedProfile } = decideWithProfile(
        decideInput({ lookup, aggregation: agg(1, 1) }),
      );
      expect(appliedProfile).toBeUndefined();
    },
  );
});
