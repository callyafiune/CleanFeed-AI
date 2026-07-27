import { describe, expect, it } from "vitest";

import {
  applyCalibrator,
  computeCalibrationProfileDigest,
  computeCalibrationSetDigest,
  parseCalibrationProfilesFileV1,
  type ProportionGateEvidenceV1,
  type RuntimeCalibrationProfileV1,
  type SerializedCalibratorV1,
} from "../../../contracts/calibration-profile";

const ISSUED_AT = "2026-01-01T00:00:00.000Z";
const EXPIRES_AT = new Date(
  Date.parse(ISSUED_AT) + 180 * 24 * 60 * 60 * 1000,
).toISOString();
const EMPTY_SET_DIGEST =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

function gate(estimate: number, sampleSize: number): ProportionGateEvidenceV1 {
  return {
    estimate,
    lowerBound95: Math.max(0, estimate - 0.01),
    upperBound95: Math.min(1, estimate + 0.01),
    sampleSize,
  };
}

/** A fully valid `pass`/`hide` profile for the 200-plus bucket. */
function baseProfile(): Omit<RuntimeCalibrationProfileV1, "profileDigest"> {
  return {
    schemaVersion: 1,
    profileId: "generic-200plus",
    modelId: "cleanfeed-ptbr-v1",
    modelVersion: "d8f77f870fbd35a17add2498b73d906bbc299026",
    bundleDigest: "a".repeat(64),
    tokenizerDigest: "b".repeat(64),
    platform: "generic",
    locale: "pt-BR",
    lengthBucket: "200-plus",
    aggregationVersion: "tmr-aggregation-v3",
    contentCompositionVersion: "lexical-content-v1",
    datasetDigest: "c".repeat(64),
    splitDigest: "d".repeat(64),
    evaluatorDigest: "e".repeat(64),
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    calibrators: {
      document: {
        kind: "isotonic",
        interpolation: "linear",
        clamp: true,
        knots: [
          { rawScore: 0, calibratedScore: 0 },
          { rawScore: 0.5, calibratedScore: 0.4 },
          { rawScore: 1, calibratedScore: 1 },
        ],
      },
      localized: { kind: "platt", slope: 1.2, intercept: -0.3 },
    },
    thresholds: {
      documentIndicator: 0.8,
      localizedIndicator: 0.82,
      documentAction: 0.9,
    },
    evidencePolicy: {
      minimumCoverage: 0.95,
      minimumLexicalRatio: 0.6,
      maximumStdDev: 0.25,
      minimumChunkAgreement: 0.5,
      exactTokenizerRequired: true,
    },
    gateEvidence: {
      decision: "pass",
      intervalMethod: "wilson-one-sided-95",
      ece: { value: 0.02, bins: 15, sampleSize: 5000 },
      overall: {
        indicatorFpr: gate(0.03, 2500),
        indicatorRecall: gate(0.7, 1200),
        actionFpr: gate(0.01, 2500),
        actionRecall: gate(0.6, 1200),
        coverage: gate(0.97, 3000),
        mixedRecall: gate(0.65, 1200),
      },
      criticalFprSlices: {
        "topic:tech": {
          indicatorFpr: gate(0.03, 400),
          actionFpr: gate(0.01, 400),
        },
      },
      criticalRecallSlices: {
        "topic:tech": {
          indicatorRecall: gate(0.7, 300),
          actionRecall: gate(0.6, 300),
        },
        "topic:health": {
          indicatorRecall: gate(0.68, 250),
          actionRecall: null,
        },
      },
    },
    actionCeiling: "hide",
  };
}

async function sealProfile(
  base: Omit<RuntimeCalibrationProfileV1, "profileDigest">,
): Promise<RuntimeCalibrationProfileV1> {
  const draft = { ...base, profileDigest: "" } as RuntimeCalibrationProfileV1;
  draft.profileDigest = await computeCalibrationProfileDigest(draft);
  return draft;
}

async function file(
  base: Omit<RuntimeCalibrationProfileV1, "profileDigest">,
): Promise<unknown> {
  return { schemaVersion: 1, profiles: [await sealProfile(base)] };
}

describe("parseCalibrationProfilesFileV1", () => {
  it("accepts a coherent single-profile file", async () => {
    const parsed = await parseCalibrationProfilesFileV1(
      await file(baseProfile()),
    );
    expect(parsed.profiles).toHaveLength(1);
    expect(parsed.profiles[0]!.actionCeiling).toBe("hide");
  });

  it("accepts the empty profiles file", async () => {
    await expect(
      parseCalibrationProfilesFileV1({ schemaVersion: 1, profiles: [] }),
    ).resolves.toEqual({ schemaVersion: 1, profiles: [] });
  });

  it("rejects the wrong schemaVersion", async () => {
    await expect(
      parseCalibrationProfilesFileV1({ schemaVersion: 2, profiles: [] }),
    ).rejects.toMatchObject({ code: "CALIBRATION_SCHEMA_INVALID" });
  });

  it("rejects an unknown top-level key", async () => {
    await expect(
      parseCalibrationProfilesFileV1({
        schemaVersion: 1,
        profiles: [],
        extra: 1,
      }),
    ).rejects.toMatchObject({ code: "CALIBRATION_SCHEMA_INVALID" });
  });

  it("rejects an unknown key inside a profile", async () => {
    const profile = { ...(await sealProfile(baseProfile())), rogue: true };
    await expect(
      parseCalibrationProfilesFileV1({ schemaVersion: 1, profiles: [profile] }),
    ).rejects.toMatchObject({ code: "PROFILE_SCHEMA_INVALID" });
  });

  it("rejects an expiry that is not issuedAt + 180 days", async () => {
    const profile = await sealProfile({
      ...baseProfile(),
      expiresAt: new Date(
        Date.parse(ISSUED_AT) + 179 * 86_400_000,
      ).toISOString(),
    });
    await expect(
      parseCalibrationProfilesFileV1({ schemaVersion: 1, profiles: [profile] }),
    ).rejects.toMatchObject({ code: "PROFILE_EXPIRY_INVALID" });
  });

  it("rejects a tampered profileDigest", async () => {
    const profile = {
      ...(await sealProfile(baseProfile())),
      profileDigest: "f".repeat(64),
    };
    await expect(
      parseCalibrationProfilesFileV1({ schemaVersion: 1, profiles: [profile] }),
    ).rejects.toMatchObject({ code: "PROFILE_DIGEST_MISMATCH" });
  });

  it("rejects an ECE that is not 15 bins", async () => {
    const base = baseProfile();
    base.gateEvidence.ece = {
      value: 0.02,
      bins: 10 as unknown as 15,
      sampleSize: 5000,
    };
    await expect(
      parseCalibrationProfilesFileV1(await file(base)),
    ).rejects.toMatchObject({ code: "ECE_INVALID" });
  });

  it("rejects fewer than 2000 overall negatives", async () => {
    const base = baseProfile();
    base.gateEvidence.overall.indicatorFpr = gate(0.03, 1999);
    await expect(
      parseCalibrationProfilesFileV1(await file(base)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_NEGATIVES" });
  });

  it("rejects a critical FPR slice below 300", async () => {
    const base = baseProfile();
    base.gateEvidence.criticalFprSlices["topic:tech"]!.actionFpr = gate(
      0.01,
      299,
    );
    await expect(
      parseCalibrationProfilesFileV1(await file(base)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SLICE_SAMPLE" });
  });

  it("rejects a non-null critical recall slice below 200", async () => {
    const base = baseProfile();
    base.gateEvidence.criticalRecallSlices["topic:tech"]!.actionRecall = gate(
      0.6,
      199,
    );
    await expect(
      parseCalibrationProfilesFileV1(await file(base)),
    ).rejects.toMatchObject({ code: "INSUFFICIENT_SLICE_SAMPLE" });
  });

  it("requires actionRecall to be null, never omitted", async () => {
    const base = baseProfile();
    // Remove the actionRecall key entirely instead of setting it to null.
    base.gateEvidence.criticalRecallSlices["topic:health"] = {
      indicatorRecall: gate(0.68, 250),
    } as unknown as (typeof base.gateEvidence.criticalRecallSlices)[string];
    await expect(
      parseCalibrationProfilesFileV1(await file(base)),
    ).rejects.toMatchObject({ code: "SLICES_INVALID" });
  });

  it("requires indicator-only to pair with an indicator ceiling and documentAction 1", async () => {
    const base = baseProfile();
    base.gateEvidence.decision = "indicator-only";
    // actionCeiling stays "hide" and documentAction stays 0.9 — both illegal.
    await expect(
      parseCalibrationProfilesFileV1(await file(base)),
    ).rejects.toMatchObject({ code: "POLICY_INVALID" });
  });

  it("accepts a valid indicator-only 50-79 profile", async () => {
    const base = baseProfile();
    base.lengthBucket = "50-79";
    base.gateEvidence.decision = "indicator-only";
    base.actionCeiling = "indicator";
    base.thresholds.documentAction = 1;
    const parsed = await parseCalibrationProfilesFileV1(await file(base));
    expect(parsed.profiles[0]!.lengthBucket).toBe("50-79");
  });

  it("forbids a hide ceiling in the 50-79 bucket", async () => {
    const base = baseProfile();
    base.lengthBucket = "50-79";
    // decision pass + hide is legal elsewhere, but never for 50-79.
    await expect(
      parseCalibrationProfilesFileV1(await file(base)),
    ).rejects.toMatchObject({ code: "POLICY_INVALID" });
  });

  it("rejects non-strictly-increasing isotonic knots", async () => {
    const base = baseProfile();
    base.calibrators.document = {
      kind: "isotonic",
      interpolation: "linear",
      clamp: true,
      knots: [
        { rawScore: 0, calibratedScore: 0 },
        { rawScore: 0, calibratedScore: 0.5 },
      ],
    };
    await expect(
      parseCalibrationProfilesFileV1(await file(base)),
    ).rejects.toMatchObject({ code: "CALIBRATOR_NOT_MONOTONIC" });
  });

  it("rejects isotonic knots outside [0,1]", async () => {
    const base = baseProfile();
    base.calibrators.document = {
      kind: "isotonic",
      interpolation: "linear",
      clamp: true,
      knots: [
        { rawScore: 0, calibratedScore: 0 },
        { rawScore: 1.2, calibratedScore: 1 },
      ],
    };
    await expect(
      parseCalibrationProfilesFileV1(await file(base)),
    ).rejects.toMatchObject({ code: "CALIBRATOR_INVALID" });
  });
});

describe("computeCalibrationProfileDigest", () => {
  it("excludes only profileDigest (a different profileDigest yields the same digest)", async () => {
    const sealed = await sealProfile(baseProfile());
    const withOtherDigest = { ...sealed, profileDigest: "0".repeat(64) };
    expect(await computeCalibrationProfileDigest(withOtherDigest)).toBe(
      await computeCalibrationProfileDigest(sealed),
    );
  });

  it("changes when any other field changes", async () => {
    const sealed = await sealProfile(baseProfile());
    const mutated = { ...sealed, platform: "twitter" };
    expect(await computeCalibrationProfileDigest(mutated)).not.toBe(
      await computeCalibrationProfileDigest(sealed),
    );
  });
});

describe("computeCalibrationSetDigest", () => {
  it("hashes the empty set to the sealed empty-array digest", async () => {
    expect(await computeCalibrationSetDigest([])).toBe(EMPTY_SET_DIGEST);
  });

  it("sorts and de-duplicates before hashing", async () => {
    const a = "1".repeat(64);
    const b = "2".repeat(64);
    expect(await computeCalibrationSetDigest([b, a, a])).toBe(
      await computeCalibrationSetDigest([a, b]),
    );
  });
});

describe("applyCalibrator", () => {
  const isotonic: SerializedCalibratorV1 = {
    kind: "isotonic",
    interpolation: "linear",
    clamp: true,
    knots: [
      { rawScore: 0.2, calibratedScore: 0.1 },
      { rawScore: 0.6, calibratedScore: 0.9 },
    ],
  };

  it("interpolates linearly between knots (never a step)", () => {
    // Midpoint raw 0.4 -> halfway between 0.1 and 0.9 = 0.5.
    expect(applyCalibrator(isotonic, 0.4)).toBeCloseTo(0.5, 10);
    // A quarter of the way: raw 0.3 -> 0.1 + 0.25*(0.8) = 0.3.
    expect(applyCalibrator(isotonic, 0.3)).toBeCloseTo(0.3, 10);
  });

  it("clamps below the first and above the last knot", () => {
    expect(applyCalibrator(isotonic, 0)).toBeCloseTo(0.1, 10);
    expect(applyCalibrator(isotonic, 1)).toBeCloseTo(0.9, 10);
  });

  it("maps platt through a sigmoid", () => {
    expect(
      applyCalibrator({ kind: "platt", slope: 0, intercept: 0 }, 0.7),
    ).toBeCloseTo(0.5, 10);
  });
});
