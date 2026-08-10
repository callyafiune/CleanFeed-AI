// `publish-profile`: build and write the immutable model publication from a
// sealed benchmark report and its frozen calibration.
//
// pass and indicator-only write three runtime profiles and an `indicator`
// rollout descriptor; reject writes an empty profiles file and a
// `bundle-verified` / `gateDecision=reject` descriptor — without error. The
// builder re-runs the Phase 1 parsers on the committed templates and on both
// outputs, so a publication that would be refused at load is refused here first.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { dirname, join } from "node:path";

import {
  validateFrozenCalibrationArtifact,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import {
  buildModelPublication,
  writeModelPublication,
} from "../profile-artifact.ts";
import {
  parseProvisionalThresholdArtifact,
  validateProvisionalThresholdArtifact,
} from "../provisional-threshold.ts";
import type { BenchmarkReport } from "../report.ts";
import { thresholdBinding } from "./evaluate.ts";
import { readJsonFile } from "./io.ts";

export interface PublishProfileOptions {
  reportPath: string;
  frozenCalibrationPath: string;
  issuedAt: string;
  modelDirectory: string;
}

export async function runPublishProfile(
  options: PublishProfileOptions,
): Promise<string> {
  const report = (await readJsonFile(options.reportPath)) as BenchmarkReport;
  const frozen = (await readJsonFile(
    options.frozenCalibrationPath,
  )) as FrozenCalibrationArtifact;
  validateFrozenCalibrationArtifact(frozen);

  // The cut the measurement decided on, read from beside the frozen calibration and
  // bound to the SAME seven governance digests the fit sealed. It is what the published
  // profiles carry, so publishing cannot serve a cut the evidence never measured.
  const provisionalThreshold = parseProvisionalThresholdArtifact(
    await readJsonFile(
      join(
        dirname(options.frozenCalibrationPath),
        "provisional-threshold.json",
      ),
    ),
  );
  validateProvisionalThresholdArtifact(
    provisionalThreshold,
    thresholdBinding(frozen),
  );

  const publication = await buildModelPublication({
    frozen,
    provisionalThreshold,
    report,
    issuedAt: options.issuedAt,
    profilesTemplate: await readJsonFile(
      `${options.modelDirectory}/calibration-profiles.json`,
    ),
    releaseTemplate: await readJsonFile(
      `${options.modelDirectory}/release.json`,
    ),
  });

  await writeModelPublication(publication, options.modelDirectory);

  const profileCount = publication.profiles.profiles.length;
  return (
    `Published: decision=${publication.release.gateDecision}, ` +
    `rolloutState=${publication.release.rolloutState}, profiles=${profileCount}.`
  );
}
