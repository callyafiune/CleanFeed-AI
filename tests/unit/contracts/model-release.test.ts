import { describe, expect, it } from "vitest";

import {
  computeCalibrationSetDigest,
  parseModelReleaseDescriptorV1,
} from "../../../contracts/model-release";

const HEX = (char: string): string => char.repeat(64);
const ISSUED_AT = "2026-02-01T00:00:00.000Z";

interface DescriptorOverrides {
  [key: string]: unknown;
  profileDigests?: string[];
  calibrationSetDigest?: string;
}

async function descriptor(
  overrides: DescriptorOverrides = {},
): Promise<Record<string, unknown>> {
  const merged: Record<string, unknown> = {
    schemaVersion: 1,
    modelId: "cleanfeed-ptbr-v1",
    modelVersion: "d8f77f870fbd35a17add2498b73d906bbc299026",
    bundleDigest: HEX("a"),
    tokenizerDigest: HEX("b"),
    aggregationVersion: "tmr-aggregation-v2",
    contentCompositionVersion: "lexical-content-v1",
    profileDigests: [],
    rolloutState: "bundle-verified",
    gateDecision: "pending",
    issuedAt: null,
    evidenceDigest: null,
    ...overrides,
  };
  merged.calibrationSetDigest =
    overrides.calibrationSetDigest ??
    (await computeCalibrationSetDigest(merged.profileDigests as string[]));
  return merged;
}

describe("parseModelReleaseDescriptorV1", () => {
  it("accepts a pending bundle-verified descriptor", async () => {
    const parsed = await parseModelReleaseDescriptorV1(await descriptor());
    expect(parsed.rolloutState).toBe("bundle-verified");
    expect(parsed.gateDecision).toBe("pending");
    expect(parsed.calibrationSetDigest).toBe(
      await computeCalibrationSetDigest([]),
    );
  });

  it("accepts a reject bundle-verified descriptor with evidence and no profiles", async () => {
    const parsed = await parseModelReleaseDescriptorV1(
      await descriptor({
        gateDecision: "reject",
        issuedAt: ISSUED_AT,
        evidenceDigest: HEX("e"),
      }),
    );
    expect(parsed.gateDecision).toBe("reject");
  });

  it("accepts an indicator rollout with a profile", async () => {
    const parsed = await parseModelReleaseDescriptorV1(
      await descriptor({
        rolloutState: "indicator",
        gateDecision: "indicator-only",
        profileDigests: [HEX("1")],
        issuedAt: ISSUED_AT,
        evidenceDigest: HEX("e"),
      }),
    );
    expect(parsed.rolloutState).toBe("indicator");
    expect(parsed.profileDigests).toEqual([HEX("1")]);
  });

  it("accepts an actions rollout with a pass gate and a profile", async () => {
    const parsed = await parseModelReleaseDescriptorV1(
      await descriptor({
        rolloutState: "actions",
        gateDecision: "pass",
        profileDigests: [HEX("1"), HEX("2")],
        issuedAt: ISSUED_AT,
        evidenceDigest: HEX("e"),
      }),
    );
    expect(parsed.rolloutState).toBe("actions");
  });

  it("rejects an unknown key", async () => {
    const value = { ...(await descriptor()), rogue: 1 };
    await expect(parseModelReleaseDescriptorV1(value)).rejects.toMatchObject({
      code: "RELEASE_SCHEMA_INVALID",
    });
  });

  it("rejects the wrong schemaVersion", async () => {
    await expect(
      parseModelReleaseDescriptorV1(await descriptor({ schemaVersion: 2 })),
    ).rejects.toMatchObject({ code: "RELEASE_SCHEMA_INVALID" });
  });

  it("rejects an incoherent calibrationSetDigest", async () => {
    await expect(
      parseModelReleaseDescriptorV1(
        await descriptor({
          profileDigests: [HEX("1")],
          calibrationSetDigest: HEX("0"),
          rolloutState: "indicator",
          gateDecision: "pass",
          issuedAt: ISSUED_AT,
          evidenceDigest: HEX("e"),
        }),
      ),
    ).rejects.toMatchObject({ code: "RELEASE_DIGEST_MISMATCH" });
  });

  it("rejects bundle-verified paired with a promoted gate", async () => {
    await expect(
      parseModelReleaseDescriptorV1(
        await descriptor({ gateDecision: "indicator-only" }),
      ),
    ).rejects.toMatchObject({ code: "RELEASE_STATE_INVALID" });
  });

  it("rejects a pending descriptor that carries an issuedAt", async () => {
    await expect(
      parseModelReleaseDescriptorV1(await descriptor({ issuedAt: ISSUED_AT })),
    ).rejects.toMatchObject({ code: "RELEASE_STATE_INVALID" });
  });

  it("rejects a reject descriptor with a null evidenceDigest", async () => {
    await expect(
      parseModelReleaseDescriptorV1(
        await descriptor({
          gateDecision: "reject",
          issuedAt: ISSUED_AT,
          evidenceDigest: null,
        }),
      ),
    ).rejects.toMatchObject({ code: "RELEASE_STATE_INVALID" });
  });

  it("rejects a reject descriptor that still carries profiles", async () => {
    await expect(
      parseModelReleaseDescriptorV1(
        await descriptor({
          gateDecision: "reject",
          issuedAt: ISSUED_AT,
          evidenceDigest: HEX("e"),
          profileDigests: [HEX("1")],
        }),
      ),
    ).rejects.toMatchObject({ code: "RELEASE_STATE_INVALID" });
  });

  it("rejects an indicator rollout with no profiles", async () => {
    await expect(
      parseModelReleaseDescriptorV1(
        await descriptor({
          rolloutState: "indicator",
          gateDecision: "indicator-only",
          profileDigests: [],
          issuedAt: ISSUED_AT,
          evidenceDigest: HEX("e"),
        }),
      ),
    ).rejects.toMatchObject({ code: "RELEASE_STATE_INVALID" });
  });

  it("rejects an actions rollout without a pass gate", async () => {
    await expect(
      parseModelReleaseDescriptorV1(
        await descriptor({
          rolloutState: "actions",
          gateDecision: "indicator-only",
          profileDigests: [HEX("1")],
          issuedAt: ISSUED_AT,
          evidenceDigest: HEX("e"),
        }),
      ),
    ).rejects.toMatchObject({ code: "RELEASE_STATE_INVALID" });
  });
});
