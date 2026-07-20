// `verify-evidence`: prove that the published model descriptors are faithful to
// the sealed report and internally consistent — the last gate before a release.
//
// It re-parses calibration-profiles.json and release.json with the exact Phase 1
// parsers (so every profile digest and the calibration-set digest are
// recomputed and checked), then binds the descriptor to the report:
// `release.evidenceDigest` must equal `report.reportDigest`. The three decisions
// are all accepted — reject demands an empty profile set with
// `gateDecision:"reject"` and `rolloutState:"bundle-verified"`; indicator-only
// demands the `indicator` state; pass accepts the initial `indicator` and the
// later monotonic promotion to `actions`, never altering the evidence digest.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { join } from "node:path";

import { parseCalibrationProfilesFileV1 } from "../../contracts/calibration-profile.ts";
import { parseModelReleaseDescriptorV1 } from "../../contracts/model-release.ts";
import {
  validateFrozenCalibrationArtifact,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import type { BenchmarkReport } from "../report.ts";
import { CommandError, readJsonFile } from "./io.ts";

export interface VerifyEvidenceOptions {
  reportPath: string;
  frozenCalibrationPath: string;
  modelDirectory: string;
}

export async function runVerifyEvidence(
  options: VerifyEvidenceOptions,
): Promise<string> {
  const report = (await readJsonFile(options.reportPath)) as BenchmarkReport;
  const frozen = (await readJsonFile(
    options.frozenCalibrationPath,
  )) as FrozenCalibrationArtifact;
  validateFrozenCalibrationArtifact(frozen);

  // Re-parse both descriptors: parseCalibrationProfilesFileV1 recomputes every
  // profile digest; parseModelReleaseDescriptorV1 recomputes the calibration-set
  // digest from the profile digests and enforces the rollout invariants.
  const profiles = await parseCalibrationProfilesFileV1(
    await readJsonFile(
      join(options.modelDirectory, "calibration-profiles.json"),
    ),
  );
  const release = await parseModelReleaseDescriptorV1(
    await readJsonFile(join(options.modelDirectory, "release.json")),
  );

  const decision = report.releaseDecision;

  if (decision === "reject") {
    if (
      profiles.profiles.length !== 0 ||
      release.gateDecision !== "reject" ||
      release.rolloutState !== "bundle-verified"
    ) {
      throw new CommandError(
        "REJECT_STATE_INVALID",
        "a reject release requires empty profiles, gateDecision reject and rolloutState bundle-verified",
      );
    }
  } else {
    if (profiles.profiles.length === 0) {
      throw new CommandError(
        "PROFILES_MISSING",
        `a ${decision} release requires at least one profile`,
      );
    }
    if (decision === "indicator-only" && release.rolloutState !== "indicator") {
      throw new CommandError(
        "INDICATOR_STATE_INVALID",
        "an indicator-only release must be in the indicator rollout state",
      );
    }
    // A pass release starts scientific life in `indicator` and may later be
    // promoted monotonically to `actions` by Phase 4.
    if (
      decision === "pass" &&
      release.rolloutState !== "indicator" &&
      release.rolloutState !== "actions"
    ) {
      throw new CommandError(
        "PASS_STATE_INVALID",
        "a pass release must be in the indicator or actions rollout state",
      );
    }
  }

  if (release.evidenceDigest !== report.reportDigest) {
    throw new CommandError(
      "EVIDENCE_DIGEST_MISMATCH",
      "release evidenceDigest does not equal the report reportDigest",
    );
  }
  if (release.gateDecision !== decision) {
    throw new CommandError(
      "GATE_DECISION_MISMATCH",
      "release gateDecision does not equal the report release decision",
    );
  }

  return (
    "Evidence verified: parsers and every report/profile/release digest agree " +
    `(decision=${decision}, profiles=${profiles.profiles.length}).`
  );
}
