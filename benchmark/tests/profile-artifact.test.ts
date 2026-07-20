import { describe, expect, it } from "vitest";

import { parseCalibrationProfilesFileV1 } from "../../contracts/calibration-profile.ts";
import { parseModelReleaseDescriptorV1 } from "../../contracts/model-release.ts";
import { buildModelPublication } from "../profile-artifact.ts";
import {
  indicatorInput,
  neverThresholdInput,
  passInput,
  rejectInput,
} from "./profile-artifact.fixtures.ts";

describe("calibration profile artifact", () => {
  it("binds every evidence digest and expires after exactly 180 days", async () => {
    const publication = await buildModelPublication(passInput);
    const profiles = await parseCalibrationProfilesFileV1(publication.profiles);
    const release = await parseModelReleaseDescriptorV1(publication.release);
    const profile = profiles.profiles[0];
    expect(Date.parse(profile.expiresAt) - Date.parse(profile.issuedAt)).toBe(
      180 * 86_400_000,
    );
    expect(profile.tokenizerDigest).toBe(
      passInput.frozen.model.tokenizerDigest,
    );
    expect(release.tokenizerDigest).toBe(
      passInput.frozen.model.tokenizerDigest,
    );
    expect(profile.actionCeiling).toBe("hide");
    expect(release.profileDigests).toEqual(
      profiles.profiles.map((item) => item.profileDigest),
    );
    expect(release.rolloutState).toBe("indicator");
  });

  it("publishes indicator-only without a visual threshold", async () => {
    const publication = await buildModelPublication(indicatorInput);
    expect(
      publication.profiles.profiles.every(
        (profile) => profile.actionCeiling === "indicator",
      ),
    ).toBe(true);
    expect(
      publication.profiles.profiles.every(
        (profile) => profile.thresholds.documentAction === 1,
      ),
    ).toBe(true);
    expect(publication.release.rolloutState).toBe("indicator");
    expect(publication.release.gateDecision).toBe("indicator-only");
  });

  it("publishes a rejected bundle-verified descriptor and empty profiles", async () => {
    const publication = await buildModelPublication(rejectInput);
    expect(publication.profiles.profiles).toEqual([]);
    expect(publication.release.rolloutState).toBe("bundle-verified");
    expect(publication.release.gateDecision).toBe("reject");
    expect(publication.release.profileDigests).toEqual([]);
  });

  it("maps the NEVER_THRESHOLD sentinel into a valid [0,1] threshold, never a 2", async () => {
    const publication = await buildModelPublication(neverThresholdInput);
    // Round-trips through the fail-closed parser (would reject a 2 as out of [0,1]).
    const profiles = await parseCalibrationProfilesFileV1(publication.profiles);
    for (const profile of profiles.profiles) {
      const { documentIndicator, localizedIndicator, documentAction } =
        profile.thresholds;
      for (const threshold of [
        documentIndicator,
        localizedIndicator,
        documentAction,
      ]) {
        expect(Number.isFinite(threshold)).toBe(true);
        expect(threshold).toBeGreaterThanOrEqual(0);
        expect(threshold).toBeLessThanOrEqual(1);
        expect(threshold).not.toBe(2);
      }
      // The localized warning path never fired (sentinel) → disabled at 1.
      expect(localizedIndicator).toBe(1);
    }
  });
});
