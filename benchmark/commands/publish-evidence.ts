// `publish-evidence`: turn a completed, sealed release run into the CLOSED
// seven-file public evidence set — and nothing else.
//
// Phase 2's `publish-profile` remains the SOLE builder of the two model-metadata
// files; this command consumes them (it re-parses release.json and
// calibration-profiles.json but never rewrites them) and reuses Phase 2's
// `verify-evidence` to prove the descriptor is faithful to the report. It then
// binds the completed holdout ledger event, the approved model license review,
// and every dataset/split/evaluator/calibration/model digest before the
// sanitizer emits the allowlisted files. Any unfinished ledger, digest mismatch,
// unapproved license or missing report fails closed with no partial output.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { parseCalibrationProfilesFileV1 } from "../../contracts/calibration-profile.ts";
import { parseCorpusSourceReadinessReport } from "../../contracts/source-readiness.ts";
import { parseModelReleaseDescriptorV1 } from "../../contracts/model-release.ts";
import type { FitReport } from "../candidate-preflight.ts";
import {
  validateFrozenCalibrationArtifact,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import { parseDatasetAudit } from "../dataset-manifest.ts";
import {
  buildEvidenceBundle,
  EVIDENCE_FILE_NAMES,
  type EvidenceInput,
} from "../evidence-sanitizer.ts";
import { parseProvisionalThresholdArtifact } from "../provisional-threshold.ts";
import type { BenchmarkReport } from "../report.ts";
import {
  assertSplitArtifactSelfConsistent,
  type SplitArtifact,
} from "../split-artifact.ts";
import { CommandError, readJsonFile, readTextFile } from "./io.ts";
import { runVerifyEvidence } from "./verify-evidence.ts";

export interface PublishEvidenceOptions {
  sourceReadinessPath: string;
  datasetAuditPath: string;
  splitArtifactPath: string;
  frozenCalibrationPath: string;
  fitReportPath: string;
  reportPath: string;
  ledgerPath: string;
  consumptionId: string;
  modelDirectory: string;
  outputDirectory: string;
}

interface LedgerEvent {
  consumptionId: string;
  status: "started" | "completed" | "failed";
  reportDigest: string | null;
}

/**
 * Re-parses the ONE block of `fit-report.json` the public projection dereferences.
 *
 * The file itself is still read through a cast, which is a declared debt: what this
 * closes is the consequence of the cast at the only place it is followed by a
 * dereference. A fit report written by a `fit` that froze no cut — or one whose cut block
 * was edited — would otherwise reach a bare `TypeError` in the middle of assembling the
 * public bundle, and the artifact's own closed parser already names the offending path.
 */
function withParsedCut(fitReport: FitReport, path: string): FitReport {
  try {
    return {
      ...fitReport,
      provisionalThreshold: parseProvisionalThresholdArtifact(
        fitReport.provisionalThreshold,
      ),
    };
  } catch (error) {
    throw new CommandError(
      "FIT_REPORT_CUT_MALFORMED",
      `${path}: $.provisionalThreshold is not a sealed provisional-threshold artifact — ` +
        `${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function requireEqual(label: string, actual: string, expected: string): void {
  if (actual !== expected) {
    throw new CommandError(
      "EVIDENCE_DIGEST_MISMATCH",
      `${label} does not match the sealed report (${actual} != ${expected})`,
    );
  }
}

async function assertLicenseApproved(modelDirectory: string): Promise<void> {
  const review = (await readJsonFile(
    join(modelDirectory, "license-review.json"),
  )) as { status?: unknown };
  if (review.status !== "approved") {
    throw new CommandError(
      "MODEL_LICENSE_NOT_APPROVED",
      `model license review is not approved (status=${String(review.status)})`,
    );
  }
}

async function findCompletedLedgerEvent(
  ledgerPath: string,
  consumptionId: string,
  reportDigest: string,
): Promise<void> {
  const raw = await readTextFile(ledgerPath);
  let latest: LedgerEvent | undefined;
  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    let parsed: LedgerEvent;
    try {
      parsed = JSON.parse(trimmed) as LedgerEvent;
    } catch {
      throw new CommandError(
        "HOLDOUT_LEDGER_CORRUPT",
        "holdout ledger contains a line that is not valid JSON",
      );
    }
    if (parsed.consumptionId === consumptionId) latest = parsed;
  }
  if (latest === undefined) {
    throw new CommandError(
      "HOLDOUT_SESSION_UNKNOWN",
      `no holdout ledger event for consumption id ${consumptionId}`,
    );
  }
  if (latest.status !== "completed") {
    throw new CommandError(
      "HOLDOUT_SESSION_UNFINISHED",
      `holdout session ${consumptionId} is ${latest.status}, not completed`,
    );
  }
  if (latest.reportDigest !== reportDigest) {
    throw new CommandError(
      "HOLDOUT_REPORT_DIGEST_MISMATCH",
      "completed ledger event does not attest this report digest",
    );
  }
}

export async function runPublishEvidence(
  options: PublishEvidenceOptions,
): Promise<string> {
  // A missing report is refused first: no report, no evidence.
  const report = (await readJsonFile(options.reportPath)) as BenchmarkReport;

  const frozen = (await readJsonFile(
    options.frozenCalibrationPath,
  )) as FrozenCalibrationArtifact;
  validateFrozenCalibrationArtifact(frozen);

  const datasetAudit = await parseDatasetAudit(
    await readJsonFile(options.datasetAuditPath),
  );
  const sourceReadiness = await parseCorpusSourceReadinessReport(
    await readJsonFile(options.sourceReadinessPath),
  );
  // Self-consistency BEFORE anything is compared. The comparison below is against the
  // artifact's DECLARED `splitDigest`, which a tampered file satisfies simply by keeping
  // the old string — so without this the sealed `algorithm`, `counts`, `cutoffs` and the
  // whole `audit` reach public evidence unchecked. The dataset is not available here, so
  // this is the record-independent half; `validateSplitArtifact` is the full one.
  const splitArtifact = await assertSplitArtifactSelfConsistent(
    (await readJsonFile(options.splitArtifactPath)) as SplitArtifact,
  );
  // Release requires a composition attestation, and this is the one half of that invariant
  // decidable without the dataset: the pairing. Recomputing the attestation needs the records
  // (`validateSplitArtifact` does it); refusing a release artifact that carries none does not,
  // and the audit read above is where `scientificUse` is available.
  if (
    datasetAudit.scientificUse === "release" &&
    splitArtifact.compositionAttestation === null
  ) {
    throw new CommandError(
      "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MISSING",
      "the dataset audit declares scientificUse: release but the split artifact carries no " +
        "composition attestation",
    );
  }
  const fitReport = withParsedCut(
    (await readJsonFile(options.fitReportPath)) as FitReport,
    options.fitReportPath,
  );

  const release = await parseModelReleaseDescriptorV1(
    await readJsonFile(join(options.modelDirectory, "release.json")),
  );
  const profiles = await parseCalibrationProfilesFileV1(
    await readJsonFile(
      join(options.modelDirectory, "calibration-profiles.json"),
    ),
  );

  // Refuse an unapproved model license before anything is bound.
  await assertLicenseApproved(options.modelDirectory);

  // Reuse Phase 2 verify-evidence: it re-parses the descriptors and binds
  // release.evidenceDigest to report.reportDigest with the rollout invariants.
  await runVerifyEvidence({
    reportPath: options.reportPath,
    frozenCalibrationPath: options.frozenCalibrationPath,
    modelDirectory: options.modelDirectory,
  });

  // Every dataset/split/evaluator/calibration/model digest must agree.
  requireEqual(
    "frozen datasetDigest",
    frozen.datasetDigest,
    report.dataset.digest,
  );
  requireEqual("frozen splitDigest", frozen.splitDigest, report.split.digest);
  requireEqual(
    "frozen evaluatorDigest",
    frozen.evaluatorDigest,
    report.evaluatorDigest,
  );
  requireEqual(
    "frozen calibration digest",
    frozen.artifactDigest,
    report.calibrationArtifactDigest,
  );
  requireEqual(
    "frozen datasetAuditDigest",
    frozen.datasetAuditDigest,
    report.datasetAuditDigest,
  );
  requireEqual(
    "frozen sourceReadinessDigest",
    frozen.sourceReadinessDigest,
    report.sourceReadinessDigest,
  );
  requireEqual("model id", frozen.model.modelId, report.model.id);
  requireEqual(
    "model version",
    frozen.model.modelVersion,
    report.model.version,
  );
  requireEqual(
    "model bundleDigest",
    frozen.model.bundleDigest,
    report.model.bundleDigest,
  );
  requireEqual(
    "model tokenizerDigest",
    frozen.model.tokenizerDigest,
    report.model.tokenizerDigest,
  );
  requireEqual(
    "dataset auditDigest",
    datasetAudit.auditDigest,
    report.datasetAuditDigest,
  );
  requireEqual(
    "source readiness digest",
    sourceReadiness.reportDigest,
    report.sourceReadinessDigest,
  );
  requireEqual(
    "split splitDigest",
    splitArtifact.splitDigest,
    report.split.digest,
  );
  requireEqual(
    "split datasetDigest",
    splitArtifact.datasetDigest,
    report.dataset.digest,
  );
  requireEqual(
    "fit calibration digest",
    fitReport.calibrationArtifactDigest,
    frozen.artifactDigest,
  );

  // The completed, matching ledger event is the last precondition.
  await findCompletedLedgerEvent(
    options.ledgerPath,
    options.consumptionId,
    report.reportDigest,
  );

  const input: EvidenceInput = {
    datasetAudit,
    sourceReadiness,
    splitArtifact,
    frozenCalibration: frozen,
    fitReport,
    report,
    release,
    profiles,
  };
  const bundle = await buildEvidenceBundle(input);

  await writeClosedEvidenceSet(options.outputDirectory, bundle.files);

  return (
    `Published sanitized evidence: decision=${report.releaseDecision}, ` +
    `files=${bundle.files.length}, ` +
    `publicationDigest=${bundle.evidenceDigest.publicationDigest}.`
  );
}

// Writes exactly the seven allowlisted files, replaces the .gitkeep placeholder,
// and refuses to leave any non-allowlisted file behind in a fresh output dir.
async function writeClosedEvidenceSet(
  outputDirectory: string,
  files: { name: string; content: string }[],
): Promise<void> {
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outputDirectory, { recursive: true });

  const allowed = new Set<string>(EVIDENCE_FILE_NAMES);
  let existing: string[];
  try {
    existing = await readdir(outputDirectory);
  } catch {
    existing = [];
  }
  // The .gitkeep placeholder is retired once real evidence is published.
  for (const name of existing) {
    if (name === ".gitkeep") {
      await rm(join(outputDirectory, name), { force: true });
    } else if (!allowed.has(name)) {
      throw new CommandError(
        "EVIDENCE_OUTPUT_DIRTY",
        `refusing to publish into a directory holding non-allowlisted file "${name}"`,
      );
    }
  }

  for (const file of files) {
    await writeFile(join(outputDirectory, file.name), file.content, "utf8");
  }
}
