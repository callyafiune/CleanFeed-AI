// `evaluate`: the final, internal step of an already-open consume-holdout
// session. It NEVER opens the session nor starts scoring — Phase 3's
// consume-holdout orchestrator does that, then calls this with the emitted
// consumptionId and the resulting test manifest.
//
// It re-binds the frozen split and calibration, re-reads the sharded test
// predictions and the private test labels, resumes the started ledger lease
// under the FULL scientific tuple, applies the frozen calibration, computes the
// v2 metrics/slices/gates and seals the schema v2 report (frozen vs observed
// identity must match). The report and gate report are written atomically, then
// the ledger is marked `completed` — even when the gates reject, because a
// release evaluation consumes the holdout whether it passes or fails. A crash
// before completion leaves the started lease for `--resume`.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import {
  applyFrozenCalibration,
  validateFrozenCalibrationArtifact,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import { validateDatasetManifest } from "../dataset-manifest.ts";
import { computeEvaluatorDigest } from "../digests.ts";
import { evaluateReleaseGates, type IntegrityEvidence } from "../gates.ts";
import {
  completeHoldoutConsumption,
  resumeHoldoutConsumption,
  type HoldoutIdentity,
} from "../holdout-ledger.ts";
import { computeEvaluationMetrics, type EvaluationItem } from "../metrics.ts";
import {
  computePredictionManifestDigest,
  parsePredictionManifest,
  type PredictionManifestV1,
  type StrictPredictionV2,
} from "../prediction-schema.ts";
import {
  buildBenchmarkReport,
  renderReportMarkdown,
  SPLIT_STRATEGY,
  type GovernanceSeal,
} from "../report.ts";
import { parseBenchmarkDataset, type BenchmarkRecord } from "../schema.ts";
import { buildSlices, summarizeSlices } from "../slices.ts";
import {
  validateSplitArtifact,
  type SplitArtifact,
} from "../split-artifact.ts";
import {
  CommandError,
  readJsonFile,
  readPredictionArtifact,
  readTextFile,
  writeFileAtomic,
  writeJsonAtomic,
} from "./io.ts";

export interface EvaluateOptions {
  datasetDirectory: string;
  splitArtifactPath: string;
  frozenCalibrationPath: string;
  testPredictionsDirectory: string;
  testLabelsPath: string;
  ledgerPath: string;
  consumptionId: string;
  outputDirectory: string;
  bootstrapSeed: number;
  /**
   * The tree whose bytes ARE the evaluator, for the identity check. Reachable only
   * from a caller in this process: `assertKnownFlags` keeps it off the CLI, because
   * a flag would let a run aim the check at a clean copy while an altered evaluator
   * produces the numbers.
   */
  evaluatorRoot?: string;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/** The injected evaluator tree, or the repository this code was loaded from. */
export function resolveEvaluatorRoot(root: string | undefined): string {
  return root ?? REPO_ROOT;
}

/**
 * Measures the evaluator's own bytes on disk and refuses when they diverge from the
 * digest the frozen calibration declares, returning the OBSERVED digest so a caller
 * can record what it saw rather than what it was told. The frozen artifact is not
 * part of the inventory, so its declared `evaluatorDigest` is a claim until this
 * comparison is made.
 */
export async function assertEvaluatorIdentity(
  evaluatorRoot: string,
  frozenEvaluatorDigest: string,
): Promise<string> {
  const observed = await computeEvaluatorDigest(evaluatorRoot);
  if (observed !== frozenEvaluatorDigest) {
    throw new CommandError(
      "EVALUATOR_DIGEST_PRE_EXPOSURE_MISMATCH",
      `the evaluator on disk (${observed}) is not the one the frozen calibration declares (${frozenEvaluatorDigest})`,
    );
  }
  return observed;
}

export async function runEvaluate(options: EvaluateOptions): Promise<string> {
  const evaluatorRoot = resolveEvaluatorRoot(options.evaluatorRoot);
  const frozen = (await readJsonFile(
    options.frozenCalibrationPath,
  )) as FrozenCalibrationArtifact;
  validateFrozenCalibrationArtifact(frozen);
  // Ahead of the dataset on purpose: records.jsonl carries `text` and `label` on
  // every record, so this is the last point at which the evaluator can be judged
  // by someone who has not seen a label.
  await assertEvaluatorIdentity(evaluatorRoot, frozen.evaluatorDigest);

  const manifest = validateDatasetManifest(
    await readJsonFile(join(options.datasetDirectory, "manifest.json")),
  );
  const records = parseBenchmarkDataset(
    await readTextFile(join(options.datasetDirectory, "records.jsonl")),
  );
  const recordsById = new Map(records.map((record) => [record.id, record]));

  const artifact = (await readJsonFile(
    options.splitArtifactPath,
  )) as SplitArtifact;
  await validateSplitArtifact(artifact, manifest, records);

  // The two prediction manifests the fit consumed live next to the frozen
  // calibration; they re-enter the report so its three manifest digests match
  // the sealed run.
  const fitDirectory = dirname(options.frozenCalibrationPath);
  const developmentManifest = parsePredictionManifest(
    await readJsonFile(
      join(fitDirectory, "development-prediction-manifest.json"),
    ),
  );
  const calibrationManifest = parsePredictionManifest(
    await readJsonFile(
      join(fitDirectory, "calibration-prediction-manifest.json"),
    ),
  );

  const { manifest: testManifest, predictions } = await readPredictionArtifact(
    options.testPredictionsDirectory,
    { scientificUse: "release" },
  );
  if (testManifest.partition !== "test") {
    throw new CommandError(
      "TEST_PARTITION_EXPECTED",
      "the prediction artifact does not declare the test partition",
    );
  }
  if (testManifest.holdoutConsumptionId !== options.consumptionId) {
    throw new CommandError(
      "HOLDOUT_SESSION_MISMATCH",
      "test manifest holdoutConsumptionId diverges from --consumption-id",
    );
  }

  const testIds = artifact.assignments
    .filter((assignment) => assignment.partition === "test")
    .map((assignment) => assignment.id);
  assertTestCoverage(
    testIds,
    predictions.map((prediction) => prediction.id),
  );

  const labels = await readTestLabels(
    options.testLabelsPath,
    testIds,
    recordsById,
  );

  // Resume the started lease under the FULL scientific tuple; a terminal session
  // or diverging tuple is refused here, before any report is sealed.
  const identity = buildIdentity(frozen, artifact);
  const session = await resumeHoldoutConsumption(
    options.ledgerPath,
    options.consumptionId,
    identity,
  );

  const items = predictions.map((prediction) => {
    const record = recordsById.get(prediction.id);
    if (record === undefined) {
      throw new CommandError(
        "PREDICTION_UNKNOWN_ID",
        `prediction ${prediction.id} has no matching record`,
      );
    }
    return buildEvaluationItem(frozen, record, prediction);
  });
  void labels;

  const visualActionAvailable = frozen.thresholds.visualDocument !== null;
  const metrics = computeEvaluationMetrics(items, {
    bootstrapSeed: options.bootstrapSeed,
    visualActionAvailable,
  });
  const slices = summarizeSlices(
    buildSlices(items, {
      bootstrapSeed: options.bootstrapSeed,
      visualActionAvailable,
      heldOutGeneratorFamilies: artifact.heldOutGeneratorFamilies,
    }),
  );

  // The third measurement of the same bytes, and the one the gate reads. It can
  // still differ from the check above: everything between them — the shard reads,
  // the labels, the metrics, the slices — is a window in which the tree can move.
  const evaluatorDigest = await computeEvaluatorDigest(evaluatorRoot);
  const developmentManifestDigest =
    await computePredictionManifestDigest(developmentManifest);
  const calibrationManifestDigest =
    await computePredictionManifestDigest(calibrationManifest);

  const integrity: IntegrityEvidence = {
    scientificUse:
      manifest.scientificUse === "release" ? "release" : "diagnostic",
    licenseInventoryComplete: true,
    reviewLedgerHashMatches: true,
    sourceManifestHashMatches: true,
    datasetAuditSealed: true,
    sourceReadinessReady: true,
    schemaValid: true,
    datasetDigestMatches: frozen.datasetDigest === artifact.datasetDigest,
    splitDigestMatches: frozen.splitDigest === artifact.splitDigest,
    evaluatorDigestMatches: frozen.evaluatorDigest === evaluatorDigest,
    calibrationDigestMatches: true,
    splitAuditPassed: artifact.audit.passed,
    predictionCompleteness: true,
    predictionManifestDigestsMatch:
      developmentManifestDigest ===
        frozen.predictionManifestDigests.development &&
      calibrationManifestDigest ===
        frozen.predictionManifestDigests.calibration,
    runtimeIdentityUnique: true,
    holdoutSessionActive: true,
  };
  // C4's plan, taken from the metrics themselves rather than rebuilt here: it is
  // assembled from the very resolutions the intervals were drawn over, so the unit
  // the gate reads cannot differ from the unit that was resampled. Never construct
  // a plan at this call site — a plan written beside the metrics instead of by them
  // is a claim about a computation nobody performed.
  const gates = evaluateReleaseGates({
    integrity,
    metrics,
    slices,
    resampling: metrics.resampling,
  });

  const frozenSeal = frozenGovernanceSeal(frozen, options.consumptionId);
  const observedSeal = observedGovernanceSeal(
    frozen,
    testManifest,
    identity,
    options.consumptionId,
  );

  const report = await buildBenchmarkReport({
    generatedAt: session.startedAt,
    dataset: {
      id: manifest.datasetId,
      version: manifest.version,
      digest: artifact.datasetDigest,
    },
    split: {
      digest: artifact.splitDigest,
      strategy: SPLIT_STRATEGY,
      // The same list the slices above were bucketed against, so the report
      // publishes the set its `unseen` bucket was actually measured over.
      heldOutGeneratorFamilies: artifact.heldOutGeneratorFamilies,
      audit: artifact.audit,
    },
    evaluatorDigest: frozen.evaluatorDigest,
    calibrationArtifactDigest: frozen.artifactDigest,
    frozen: frozenSeal,
    observed: observedSeal,
    predictionManifests: {
      development: developmentManifest,
      calibration: calibrationManifest,
      test: testManifest,
    },
    metrics,
    slices,
    gates,
  });

  await writeJsonAtomic(
    join(options.outputDirectory, "benchmark-report.json"),
    report,
  );
  await writeFileAtomic(
    join(options.outputDirectory, "benchmark-report.md"),
    renderReportMarkdown(report),
  );
  await writeJsonAtomic(
    join(options.outputDirectory, "gate-report.json"),
    gates,
  );

  // Consume the holdout — even on reject. Only a declared-irrecoverable failure
  // (a crash) leaves the lease started for --resume.
  const activeSessionPath = resolve(
    dirname(dirname(options.testPredictionsDirectory)),
    "active-session.json",
  );
  await completeHoldoutConsumption(
    options.ledgerPath,
    options.consumptionId,
    identity,
    report.reportDigest,
    session.startedAt,
    { activeSessionPath },
  );

  return (
    "Holdout session concluded; " +
    `decision=${report.releaseDecision}; reportDigest=${report.reportDigest}.`
  );
}

/**
 * Turns ONE prediction row into ONE evaluation item, branching on `status`.
 *
 * This is the site of the defect A3 removes. It used to read
 * `prediction.documentRawScore ?? 0`, so a `status: "error"` row — whose scores
 * are null BY SCHEMA — was calibrated from 0, the most human raw score there is,
 * and then counted as a true negative. There is now nowhere to put a substituted
 * score: only the `scored` branch of `EvaluationItem` carries one, and the
 * calibration is applied ONLY on that branch (R5).
 *
 * A `scored` row whose scores are somehow null fails closed with a coded error
 * instead of being coerced — the row parser already forbids that combination, so
 * reaching it means the artifact was written by something other than the parser.
 *
 * Exported because `runEvaluate` needs a real holdout session to run and this
 * mapping must be testable on its own.
 */
export function buildEvaluationItem(
  frozen: FrozenCalibrationArtifact,
  record: BenchmarkRecord,
  prediction: StrictPredictionV2,
): EvaluationItem {
  const telemetry: { latencyMs?: number; memoryBytes?: number } = {
    latencyMs: prediction.latencyMs,
  };
  if (prediction.memoryBytes !== null) {
    telemetry.memoryBytes = prediction.memoryBytes;
  }

  if (prediction.status !== "scored") {
    // No score and no decision: an abstention and a failure are outcomes, not
    // values to impute.
    return { record, status: prediction.status, ...telemetry };
  }
  if (
    prediction.documentRawScore === null ||
    prediction.localizedRawScore === null
  ) {
    throw new CommandError(
      "SCORED_PREDICTION_WITHOUT_SCORE",
      `prediction ${prediction.id} declares status "scored" with a null raw score`,
    );
  }
  const applied = applyFrozenCalibration(frozen, {
    documentRawScore: prediction.documentRawScore,
    localizedRawScore: prediction.localizedRawScore,
  });
  return {
    record,
    status: "scored",
    documentScore: applied.documentScore,
    warned: applied.warning,
    visualActioned: applied.visualAction,
    ...telemetry,
  };
}

function assertTestCoverage(
  expected: readonly string[],
  actual: readonly string[],
): void {
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = [...expectedSet].filter((id) => !actualSet.has(id)).sort();
  const extra = [...actualSet].filter((id) => !expectedSet.has(id)).sort();
  if (missing.length > 0 || extra.length > 0) {
    throw new CommandError(
      "TEST_COMPLETENESS_FAILED",
      `test prediction completeness failed: missing=${missing.join(",")} extra=${extra.join(",")}`,
    );
  }
}

async function readTestLabels(
  path: string,
  testIds: readonly string[],
  recordsById: ReadonlyMap<string, BenchmarkRecord>,
): Promise<Map<string, string>> {
  const text = await readTextFile(path);
  const labels = new Map<string, string>();
  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      throw new CommandError(
        "TEST_LABELS_INVALID",
        `test labels line ${index + 1} is not valid JSON`,
      );
    }
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      typeof (parsed as { id?: unknown }).id !== "string" ||
      typeof (parsed as { label?: unknown }).label !== "string"
    ) {
      throw new CommandError(
        "TEST_LABELS_INVALID",
        `test labels line ${index + 1} must be { id, label }`,
      );
    }
    const { id, label } = parsed as { id: string; label: string };
    if (labels.has(id)) {
      throw new CommandError(
        "TEST_LABELS_DUPLICATE",
        `duplicate test label for id ${id}`,
      );
    }
    labels.set(id, label);
  });

  const expected = new Set(testIds);
  if (labels.size !== expected.size) {
    throw new CommandError(
      "TEST_LABELS_INCOMPLETE",
      "test labels do not cover exactly the test partition",
    );
  }
  for (const id of testIds) {
    const label = labels.get(id);
    const record = recordsById.get(id);
    if (label === undefined || record === undefined || label !== record.label) {
      throw new CommandError(
        "TEST_LABELS_DIVERGENT",
        `test label for ${id} diverges from the sealed record label`,
      );
    }
  }
  return labels;
}

function buildIdentity(
  frozen: FrozenCalibrationArtifact,
  artifact: SplitArtifact,
): HoldoutIdentity {
  return {
    datasetDigest: artifact.datasetDigest,
    datasetAuditDigest: frozen.datasetAuditDigest,
    sourceReadinessDigest: frozen.sourceReadinessDigest,
    splitDigest: artifact.splitDigest,
    modelId: frozen.model.modelId,
    modelVersion: frozen.model.modelVersion,
    bundleDigest: frozen.model.bundleDigest,
    aggregationVersion: frozen.model.aggregationVersion,
    contentCompositionVersion: frozen.model.contentCompositionVersion,
    tokenizerDigest: frozen.model.tokenizerDigest,
    runtimeParityDigest: frozen.scoringRuntime.runtimeParityDigest,
    extensionBuildDigest: frozen.scoringRuntime.extensionBuildDigest,
    backend: "wasm",
    chromeVersion: frozen.scoringRuntime.chromeVersion,
    evaluatorDigest: frozen.evaluatorDigest,
    calibrationArtifactDigest: frozen.artifactDigest,
  };
}

function frozenGovernanceSeal(
  frozen: FrozenCalibrationArtifact,
  consumptionId: string,
): GovernanceSeal {
  return {
    datasetAuditDigest: frozen.datasetAuditDigest,
    sourceReadinessDigest: frozen.sourceReadinessDigest,
    holdoutConsumptionId: consumptionId,
    runtimeParityDigest: frozen.scoringRuntime.runtimeParityDigest,
    model: {
      id: frozen.model.modelId,
      version: frozen.model.modelVersion,
      bundleDigest: frozen.model.bundleDigest,
      tokenizerDigest: frozen.model.tokenizerDigest,
      aggregationVersion: frozen.model.aggregationVersion,
      contentCompositionVersion: frozen.model.contentCompositionVersion,
    },
    scoringRuntime: {
      extensionBuildDigest: frozen.scoringRuntime.extensionBuildDigest,
      backend: "wasm",
      chromeVersion: frozen.scoringRuntime.chromeVersion,
    },
  };
}

// The identity recomputed from the ACTUAL test run: the model/runtime come from
// the test prediction manifest, the governance digests from the resumed session
// tuple. It must match the frozen seal byte for byte or the report refuses.
function observedGovernanceSeal(
  frozen: FrozenCalibrationArtifact,
  testManifest: PredictionManifestV1,
  identity: HoldoutIdentity,
  consumptionId: string,
): GovernanceSeal {
  if (testManifest.backend !== "wasm") {
    throw new CommandError(
      "OBSERVED_BACKEND_INVALID",
      "test prediction manifest must declare the wasm backend",
    );
  }
  if (testManifest.chromeVersion !== frozen.scoringRuntime.chromeVersion) {
    throw new CommandError(
      "OBSERVED_CHROME_INVALID",
      "test prediction manifest Chrome version diverges from the frozen shell",
    );
  }
  return {
    datasetAuditDigest: identity.datasetAuditDigest,
    sourceReadinessDigest: identity.sourceReadinessDigest,
    holdoutConsumptionId: consumptionId,
    runtimeParityDigest: testManifest.runtimeParityDigest,
    model: {
      id: testManifest.modelId,
      version: testManifest.modelVersion,
      bundleDigest: testManifest.bundleDigest,
      tokenizerDigest: testManifest.tokenizerDigest,
      aggregationVersion: testManifest.aggregationVersion,
      contentCompositionVersion: testManifest.contentCompositionVersion,
    },
    scoringRuntime: {
      extensionBuildDigest: testManifest.extensionBuildDigest,
      backend: "wasm",
      chromeVersion: frozen.scoringRuntime.chromeVersion,
    },
  };
}
