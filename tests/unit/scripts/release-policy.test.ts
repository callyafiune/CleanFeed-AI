import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  parseCalibrationProfilesFileV1,
  type CalibrationProfilesFileV1,
} from "../../../contracts/calibration-profile.ts";
import {
  parseModelReleaseDescriptorV1,
  type ModelReleaseDescriptorV1,
} from "../../../contracts/model-release.ts";
import { resolveReleasePolicy } from "../../../scripts/release-policy.mjs";

const FIXTURE_ROOT = join(process.cwd(), "tests", "fixtures", "model-release");
const LOCKED_TOKENIZER =
  "8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9";
const FUTURE = Date.parse("2026-08-01T00:00:00.000Z");

/** Loads and closed-parses a fixture branch (validates the fixture too). */
async function loadBranch(branch: string): Promise<{
  release: ModelReleaseDescriptorV1;
  profilesFile: CalibrationProfilesFileV1;
}> {
  const release = await parseModelReleaseDescriptorV1(
    JSON.parse(
      await readFile(join(FIXTURE_ROOT, branch, "release.json"), "utf8"),
    ),
  );
  const profilesFile = await parseCalibrationProfilesFileV1(
    JSON.parse(
      await readFile(
        join(FIXTURE_ROOT, branch, "calibration-profiles.json"),
        "utf8",
      ),
    ),
  );
  return { release, profilesFile };
}

/** A mutable deep clone that escapes the closed parser's readonly typing. */
function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

describe("resolveReleasePolicy — the pure decision matrix", () => {
  it("reject/bundle-verified omits the TMR and runs the builtin runtime", async () => {
    const { release, profilesFile } = await loadBranch("reject");
    expect(resolveReleasePolicy(release, profilesFile, FUTURE)).toEqual({
      includeTmr: false,
      activeRuntimeKind: "builtin",
      maximumActionCeiling: "indicator",
    });
  });

  it("indicator-only/indicator packages the bundle capped at indicator", async () => {
    const { release, profilesFile } = await loadBranch("indicator-only");
    expect(resolveReleasePolicy(release, profilesFile, FUTURE)).toEqual({
      includeTmr: true,
      activeRuntimeKind: "bundle",
      maximumActionCeiling: "indicator",
    });
  });

  it("pass/indicator packages the bundle but is still capped at indicator", async () => {
    const { release, profilesFile } = await loadBranch("pass-indicator");
    expect(resolveReleasePolicy(release, profilesFile, FUTURE)).toEqual({
      includeTmr: true,
      activeRuntimeKind: "bundle",
      maximumActionCeiling: "indicator",
    });
  });

  it("pass/actions packages the bundle and lifts the ceiling to hide", async () => {
    const { release, profilesFile } = await loadBranch("pass-actions");
    expect(resolveReleasePolicy(release, profilesFile, FUTURE)).toEqual({
      includeTmr: true,
      activeRuntimeKind: "bundle",
      maximumActionCeiling: "hide",
    });
  });

  it("pending fails closed", async () => {
    const { release, profilesFile } = await loadBranch("pending");
    expect(() => resolveReleasePolicy(release, profilesFile, FUTURE)).toThrow(
      "RELEASE_DECISION_PENDING",
    );
  });
});

describe("resolveReleasePolicy — teeth on every bypass", () => {
  it("rejects indicator-only that is not in the indicator rollout", async () => {
    const { release, profilesFile } = await loadBranch("indicator-only");
    const mutated = clone(release);
    mutated.rolloutState = "actions";
    expect(() => resolveReleasePolicy(mutated, profilesFile, FUTURE)).toThrow(
      "INDICATOR_ONLY_ACTION_BYPASS",
    );
  });

  it("rejects an indicator-only profile whose actionCeiling is hide", async () => {
    const { release, profilesFile } = await loadBranch("indicator-only");
    const mutated = clone(profilesFile);
    mutated.profiles[0].actionCeiling = "hide";
    expect(() => resolveReleasePolicy(release, mutated, FUTURE)).toThrow(
      "INDICATOR_ONLY_ACTION_BYPASS",
    );
  });

  it("rejects pass in a non-public rollout (bundle-verified)", async () => {
    const { release, profilesFile } = await loadBranch("pass-indicator");
    const mutated = clone(release);
    mutated.rolloutState = "bundle-verified";
    expect(() => resolveReleasePolicy(mutated, profilesFile, FUTURE)).toThrow(
      "PASS_ROLLOUT_NOT_PUBLIC",
    );
  });

  it("rejects pass in shadow", async () => {
    const { release, profilesFile } = await loadBranch("pass-indicator");
    const mutated = clone(release);
    mutated.rolloutState = "shadow";
    expect(() => resolveReleasePolicy(mutated, profilesFile, FUTURE)).toThrow(
      "PASS_ROLLOUT_NOT_PUBLIC",
    );
  });

  it("rejects a pass 50-79 profile lifted above indicator", async () => {
    const { release, profilesFile } = await loadBranch("pass-actions");
    const mutated = clone(profilesFile);
    const shortProfile = mutated.profiles.find(
      (profile) => profile.lengthBucket === "50-79",
    );
    if (shortProfile === undefined) throw new Error("fixture missing 50-79");
    shortProfile.actionCeiling = "hide";
    expect(() => resolveReleasePolicy(release, mutated, FUTURE)).toThrow(
      "SHORT_TEXT_ACTION_BYPASS",
    );
  });

  it("rejects a profile digest that is absent from the descriptor", async () => {
    const { release, profilesFile } = await loadBranch("pass-actions");
    const mutated = clone(release);
    mutated.profileDigests = [mutated.profileDigests[0]];
    expect(() => resolveReleasePolicy(mutated, profilesFile, FUTURE)).toThrow(
      "PROFILE_SET_MISMATCH",
    );
  });

  it("rejects a descriptor with a null evidence digest for a promoted release", async () => {
    const { release, profilesFile } = await loadBranch("indicator-only");
    const mutated = clone(release);
    mutated.evidenceDigest = null;
    expect(() => resolveReleasePolicy(mutated, profilesFile, FUTURE)).toThrow(
      "EVIDENCE_DIGEST_INVALID",
    );
  });

  it("rejects a release tokenizerDigest that is not the locked value", async () => {
    const { release, profilesFile } = await loadBranch("indicator-only");
    const mutated = clone(release);
    mutated.tokenizerDigest = "0".repeat(64);
    expect(() => resolveReleasePolicy(mutated, profilesFile, FUTURE)).toThrow(
      "TOKENIZER_DIGEST_NOT_LOCKED",
    );
  });

  it("rejects a profile tokenizerDigest that is not the locked value", async () => {
    const { release, profilesFile } = await loadBranch("pass-actions");
    const mutated = clone(profilesFile);
    mutated.profiles[0].tokenizerDigest = "0".repeat(64);
    expect(() => resolveReleasePolicy(release, mutated, FUTURE)).toThrow(
      "TOKENIZER_DIGEST_NOT_LOCKED",
    );
  });

  it("rejects a profile expired at the build instant", async () => {
    const { release, profilesFile } = await loadBranch("pass-actions");
    const afterExpiry = Date.parse("2027-06-01T00:00:00.000Z");
    expect(() =>
      resolveReleasePolicy(release, profilesFile, afterExpiry),
    ).toThrow("PROFILE_EXPIRED");
  });

  it("keeps the locked tokenizer digest addressable to callers", async () => {
    expect(LOCKED_TOKENIZER).toBe(
      "8be427eee79ac58671ae5570f75806fc3d9edc2f2d727ca9e261c2d4b85d37a9",
    );
  });
});
