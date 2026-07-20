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

import {
  validateFrozenCalibrationArtifact,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import {
  buildModelPublication,
  writeModelPublication,
} from "../profile-artifact.ts";
import type { BenchmarkReport } from "../report.ts";
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

  const publication = await buildModelPublication({
    frozen,
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
