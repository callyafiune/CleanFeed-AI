import { describe, expect, it } from "vitest";

import {
  CalibrationRegistry,
  type CalibrationCoordinates,
} from "@/inference/calibration-registry";
import {
  computeCalibrationProfileDigest,
  computeCalibrationSetDigest,
  type RuntimeCalibrationProfileV1,
} from "../../../contracts/calibration-profile";

const ISSUED_AT = "2026-01-01T00:00:00.000Z";
const EXPIRES_AT = new Date(
  Date.parse(ISSUED_AT) + 180 * 24 * 60 * 60 * 1000,
).toISOString();
const BEFORE_EXPIRY = Date.parse(ISSUED_AT) + 24 * 60 * 60 * 1000;
const AT_EXPIRY = Date.parse(EXPIRES_AT);
const AFTER_EXPIRY = AT_EXPIRY + 1;

function gate(estimate: number, sampleSize: number) {
  return {
    estimate,
    lowerBound95: Math.max(0, estimate - 0.01),
    upperBound95: Math.min(1, estimate + 0.01),
    sampleSize,
  };
}

/** A fully valid `pass`/`hide` profile for the linkedin 200-plus bucket. */
function baseProfile(
  overrides: Partial<Omit<RuntimeCalibrationProfileV1, "profileDigest">> = {},
): Omit<RuntimeCalibrationProfileV1, "profileDigest"> {
  return {
    schemaVersion: 1,
    profileId: "linkedin-200plus",
    modelId: "tmr-ai-text-detector",
    modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
    bundleDigest: "a".repeat(64),
    tokenizerDigest: "b".repeat(64),
    platform: "linkedin",
    locale: "pt-BR",
    lengthBucket: "200-plus",
    aggregationVersion: "tmr-aggregation-v2",
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
      },
    },
    actionCeiling: "hide",
    ...overrides,
  };
}

async function sealProfile(
  base: Omit<RuntimeCalibrationProfileV1, "profileDigest">,
): Promise<RuntimeCalibrationProfileV1> {
  const draft = { ...base, profileDigest: "" } as RuntimeCalibrationProfileV1;
  draft.profileDigest = await computeCalibrationProfileDigest(draft);
  return draft;
}

async function releaseFor(
  profileDigests: string[],
  overrides: Record<string, unknown> = {},
): Promise<Record<string, unknown>> {
  return {
    schemaVersion: 1,
    modelId: "tmr-ai-text-detector",
    modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
    bundleDigest: "a".repeat(64),
    tokenizerDigest: "b".repeat(64),
    aggregationVersion: "tmr-aggregation-v2",
    contentCompositionVersion: "lexical-content-v1",
    calibrationSetDigest: await computeCalibrationSetDigest(profileDigests),
    profileDigests,
    rolloutState: "actions",
    gateDecision: "pass",
    issuedAt: ISSUED_AT,
    evidenceDigest: "f".repeat(64),
    ...overrides,
  };
}

/** Coordinates that exactly match {@link baseProfile}. */
function coordinates(
  overrides: Partial<CalibrationCoordinates> = {},
): CalibrationCoordinates {
  return {
    modelId: "tmr-ai-text-detector",
    modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
    bundleDigest: "a".repeat(64),
    tokenizerDigest: "b".repeat(64),
    platform: "linkedin",
    locale: "pt",
    lengthBucket: "200-plus",
    aggregationVersion: "tmr-aggregation-v2",
    contentCompositionVersion: "lexical-content-v1",
    ...overrides,
  };
}

async function registryWithBaseProfile(): Promise<CalibrationRegistry> {
  const sealed = await sealProfile(baseProfile());
  return CalibrationRegistry.load(await releaseFor([sealed.profileDigest]), {
    schemaVersion: 1,
    profiles: [sealed],
  });
}

describe("CalibrationRegistry.findExact", () => {
  it("returns the exact profile for a fully matching coordinate (locale normalized)", async () => {
    const registry = await registryWithBaseProfile();
    const lookup = registry.findExact(coordinates(), BEFORE_EXPIRY);
    expect(lookup.status).toBe("found");
    if (lookup.status === "found") {
      expect(lookup.profile.profileId).toBe("linkedin-200plus");
    }
  });

  it.each([
    ["modelId", { modelId: "other-model" }],
    ["modelVersion", { modelVersion: "0.0.0" }],
    ["bundleDigest", { bundleDigest: "0".repeat(64) }],
    ["tokenizerDigest", { tokenizerDigest: "0".repeat(64) }],
    ["platform", { platform: "twitter" }],
    ["locale", { locale: "en" }],
    ["lengthBucket", { lengthBucket: "50-79" as const }],
    ["aggregationVersion", { aggregationVersion: "tmr-aggregation-v3" }],
    ["contentCompositionVersion", { contentCompositionVersion: "v2" }],
  ])(
    "misses when %s diverges in isolation and never returns the closest profile",
    async (_name, override) => {
      const registry = await registryWithBaseProfile();
      const lookup = registry.findExact(
        coordinates(override as Partial<CalibrationCoordinates>),
        BEFORE_EXPIRY,
      );
      expect(lookup.status).toBe("missing");
      if (lookup.status === "missing") {
        expect(lookup.reason).toBe("MODEL_PROFILE_MISSING");
      }
    },
  );

  it("rejects a profile whose digest is outside the release set", async () => {
    const sealed = await sealProfile(baseProfile());
    // The release references a DIFFERENT digest, so the indexed profile is not
    // part of the promoted calibration set.
    const registry = await CalibrationRegistry.load(
      await releaseFor(["9".repeat(64)]),
      { schemaVersion: 1, profiles: [sealed] },
    );
    const lookup = registry.findExact(coordinates(), BEFORE_EXPIRY);
    expect(lookup.status).toBe("out-of-release");
    if (lookup.status === "out-of-release") {
      expect(lookup.reason).toBe("MODEL_PROFILE_MISMATCH");
    }
  });

  it("treats now === expiresAt as expired", async () => {
    const registry = await registryWithBaseProfile();
    const lookup = registry.findExact(coordinates(), AT_EXPIRY);
    expect(lookup.status).toBe("expired");
    if (lookup.status === "expired") {
      expect(lookup.reason).toBe("PROFILE_EXPIRED");
    }
  });

  it("reports an expired profile after its expiry", async () => {
    const registry = await registryWithBaseProfile();
    expect(registry.findExact(coordinates(), AFTER_EXPIRY).status).toBe(
      "expired",
    );
  });

  it("misses when there is no profile at all", async () => {
    const registry = await CalibrationRegistry.load(
      await releaseFor([], {
        rolloutState: "bundle-verified",
        gateDecision: "pending",
        issuedAt: null,
        evidenceDigest: null,
      }),
      { schemaVersion: 1, profiles: [] },
    );
    expect(registry.findExact(coordinates(), BEFORE_EXPIRY).status).toBe(
      "missing",
    );
  });

  it("rejects a duplicate coordinate key at construction", async () => {
    const first = await sealProfile(baseProfile());
    const second = await sealProfile(baseProfile({ profileId: "duplicate" }));
    await expect(
      CalibrationRegistry.load(
        await releaseFor([first.profileDigest, second.profileDigest]),
        { schemaVersion: 1, profiles: [first, second] },
      ),
    ).rejects.toThrow();
  });

  it("rejects an unknown key in the release descriptor", async () => {
    const sealed = await sealProfile(baseProfile());
    await expect(
      CalibrationRegistry.load(
        await releaseFor([sealed.profileDigest], { rogue: true }),
        { schemaVersion: 1, profiles: [sealed] },
      ),
    ).rejects.toThrow();
  });

  it("rejects an unknown key inside a profile", async () => {
    const sealed = await sealProfile(baseProfile());
    await expect(
      CalibrationRegistry.load(await releaseFor([sealed.profileDigest]), {
        schemaVersion: 1,
        profiles: [{ ...sealed, rogue: true }],
      }),
    ).rejects.toThrow();
  });
});
