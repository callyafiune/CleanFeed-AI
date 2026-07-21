// `verify-published-evidence`: revalidate a clean clone using ONLY the tracked
// sanitized evidence directory and the current model metadata — never a private
// run output under benchmark/out, benchmark/data or benchmark/work.
//
// It proves the seven-file set is complete and unaltered (the evidence-digest
// inventory hashes recompute, the publication digest recomputes, no file is
// missing or extra), then binds the immutable publication to it: model identity,
// gate decision, an ALLOWED rollout state, release.evidenceDigest,
// calibrationSetDigest and the exact profileDigests. A full release-file digest
// is deliberately absent, so the monotonic Phase 4 promotion pass/indicator ->
// pass/actions verifies without ever rewriting the scientific evidence;
// indicator-only stays indicator and reject stays bundle-verified.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { readdir } from "node:fs/promises";
import { join } from "node:path";

import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import {
  parseCalibrationProfilesFileV1,
  type CalibrationProfilesFileV1,
} from "../../contracts/calibration-profile.ts";
import {
  parseModelReleaseDescriptorV1,
  type ModelReleaseDescriptorV1,
} from "../../contracts/model-release.ts";
import { sha256BytesHex } from "../digests.ts";
import {
  assertSanitized,
  EVIDENCE_FILE_NAMES,
  INVENTORY_FILE_NAMES,
  type EvidenceDigestFileV1,
} from "../evidence-sanitizer.ts";
import { CommandError, readJsonFile, readTextFile } from "./io.ts";

export interface VerifyPublishedEvidenceOptions {
  evidenceDirectory: string;
  modelDirectory: string;
}

function fail(code: string, message: string): never {
  throw new CommandError(code, message);
}

function requireEqual(label: string, actual: string, expected: string): void {
  if (actual !== expected) {
    fail(
      "PUBLISHED_EVIDENCE_MISMATCH",
      `${label} does not match (${actual} != ${expected})`,
    );
  }
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

// The monotonic activation map: reject stays bundle-verified, indicator-only
// stays indicator, and pass may be indicator (initial) or actions (Phase 4).
function allowedRolloutStates(
  gateDecision: ModelReleaseDescriptorV1["gateDecision"],
): readonly ModelReleaseDescriptorV1["rolloutState"][] {
  switch (gateDecision) {
    case "reject":
      return ["bundle-verified"];
    case "indicator-only":
      return ["indicator"];
    case "pass":
      return ["indicator", "actions"];
    default:
      return [];
  }
}

async function assertClosedFileSet(evidenceDirectory: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(evidenceDirectory);
  } catch {
    fail(
      "EVIDENCE_DIR_MISSING",
      `evidence directory is missing: ${evidenceDirectory}`,
    );
  }
  const present = new Set(entries);
  const allowed = new Set<string>(EVIDENCE_FILE_NAMES);
  for (const name of present) {
    if (!allowed.has(name)) {
      fail(
        "EVIDENCE_EXTRA_FILE",
        `evidence directory holds a non-allowlisted file: ${name}`,
      );
    }
  }
  for (const name of EVIDENCE_FILE_NAMES) {
    if (!present.has(name)) {
      fail("EVIDENCE_MISSING_FILE", `evidence directory is missing ${name}`);
    }
  }
}

export async function runVerifyPublishedEvidence(
  options: VerifyPublishedEvidenceOptions,
): Promise<string> {
  const { evidenceDirectory, modelDirectory } = options;

  await assertClosedFileSet(evidenceDirectory);

  const evidenceDigest = (await readJsonFile(
    join(evidenceDirectory, "evidence-digest.json"),
  )) as EvidenceDigestFileV1;

  // The inventory must name exactly the other six files, sorted.
  const inventoryNames = evidenceDigest.files.map((entry) => entry.file);
  if (
    !arraysEqual(
      inventoryNames,
      [...INVENTORY_FILE_NAMES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    )
  ) {
    fail(
      "EVIDENCE_INVENTORY_INVALID",
      "evidence-digest inventory does not list exactly the other six files",
    );
  }

  // Every inventory hash must recompute over the real bytes on disk.
  for (const entry of evidenceDigest.files) {
    const bytes = await readTextFile(join(evidenceDirectory, entry.file));
    const observed = sha256BytesHex(new TextEncoder().encode(bytes));
    if (observed !== entry.sha256) {
      fail(
        "EVIDENCE_FILE_ALTERED",
        `evidence file ${entry.file} does not match its recorded hash`,
      );
    }
  }

  // The publication digest recomputes over {schemaVersion, files} only.
  const expectedPublicationDigest = await canonicalSha256({
    schemaVersion: 1,
    files: evidenceDigest.files,
  });
  requireEqual(
    "publicationDigest",
    evidenceDigest.publicationDigest,
    expectedPublicationDigest,
  );

  // Read the sanitized scientific report and decision from the evidence set.
  const reportEvidence = (await readJsonFile(
    join(evidenceDirectory, "benchmark-report.json"),
  )) as { reportDigest: string };
  const decision = (await readJsonFile(
    join(evidenceDirectory, "decision.json"),
  )) as {
    releaseDecision: string;
    gateDecision: string;
    profileDigests: string[];
    calibrationSetDigest: string;
    model: {
      id: string;
      version: string;
      bundleDigest: string;
      tokenizerDigest: string;
      aggregationVersion: string;
      contentCompositionVersion: string;
    };
  };

  // Defense in depth: the tracked files must still be free of private content.
  for (const name of INVENTORY_FILE_NAMES) {
    if (name.endsWith(".json")) {
      assertSanitized(await readJsonFile(join(evidenceDirectory, name)), name);
    }
  }

  requireEqual(
    "scientific evidence digest vs report",
    evidenceDigest.scientificEvidenceDigest,
    reportEvidence.reportDigest,
  );

  // Read the current model metadata separately (Phase 1 parsers recompute the
  // profile and calibration-set digests and enforce the rollout invariants).
  const release: ModelReleaseDescriptorV1 = await parseModelReleaseDescriptorV1(
    await readJsonFile(join(modelDirectory, "release.json")),
  );
  const profiles: CalibrationProfilesFileV1 =
    await parseCalibrationProfilesFileV1(
      await readJsonFile(join(modelDirectory, "calibration-profiles.json")),
    );

  // Model identity: the live release equals the descriptor sealed in evidence.
  requireEqual("model id", release.modelId, decision.model.id);
  requireEqual("model version", release.modelVersion, decision.model.version);
  requireEqual(
    "model bundleDigest",
    release.bundleDigest,
    decision.model.bundleDigest,
  );
  requireEqual(
    "model tokenizerDigest",
    release.tokenizerDigest,
    decision.model.tokenizerDigest,
  );
  requireEqual(
    "model aggregationVersion",
    release.aggregationVersion,
    decision.model.aggregationVersion,
  );
  requireEqual(
    "model contentCompositionVersion",
    release.contentCompositionVersion,
    decision.model.contentCompositionVersion,
  );

  // Gate decision, evidence digest and calibration-set digest are immutable.
  requireEqual("gateDecision", release.gateDecision, decision.gateDecision);
  requireEqual(
    "release evidenceDigest",
    release.evidenceDigest ?? "",
    evidenceDigest.scientificEvidenceDigest,
  );
  requireEqual(
    "calibrationSetDigest",
    release.calibrationSetDigest,
    evidenceDigest.calibrationSetDigest,
  );
  requireEqual(
    "decision calibrationSetDigest",
    decision.calibrationSetDigest,
    release.calibrationSetDigest,
  );

  // Exact profile-digest set (unchanged by a rollout activation).
  if (!arraysEqual(release.profileDigests, decision.profileDigests)) {
    fail(
      "PROFILE_DIGESTS_MISMATCH",
      "release profileDigests do not equal the published decision profileDigests",
    );
  }
  if (release.profileDigests.length !== profiles.profiles.length) {
    fail(
      "PROFILE_COUNT_MISMATCH",
      "release profileDigests count does not match the calibration profiles file",
    );
  }

  // The live rollout state must be an ALLOWED activation of the gate decision;
  // equality is deliberately NOT required, so pass -> actions verifies.
  const allowed = allowedRolloutStates(release.gateDecision);
  if (!allowed.includes(release.rolloutState)) {
    fail(
      "ROLLOUT_STATE_INVALID",
      `rolloutState ${release.rolloutState} is not an allowed activation of ${release.gateDecision}`,
    );
  }

  return (
    `Published evidence verified: decision=${decision.releaseDecision}, ` +
    `gateDecision=${release.gateDecision}, rolloutState=${release.rolloutState}.`
  );
}
