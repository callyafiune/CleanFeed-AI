// `fit`: freeze the two path calibrators and the 5%/2% thresholds WITHOUT ever
// reading the blocked test.
//
// Every governance input is re-parsed and cross-checked before any calibration:
// the sealed dataset audit (digest recomputed and bound to the manifest bytes),
// the source readiness report, the frozen split artifact and the runtime parity
// manifest. The development and calibration prediction artifacts supply the raw
// path scores; the test partition ids are passed only so the fit can REFUSE any
// of them. The output frozen-calibration.json seals it all, and the two consumed
// prediction manifests are written alongside so evaluate can re-bind them into
// the report.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { parseCorpusSourceReadinessReport } from "../../contracts/source-readiness.ts";
import { parseRuntimeParityManifestV1 } from "../../contracts/runtime-parity.ts";
import {
  fitFrozenCalibration,
  sealedCalibrationArtifact,
  type FitSampleScores,
} from "../calibration-pipeline.ts";
import {
  buildFitReport,
  runCandidatePreflight,
  verifyFrozenAgainstPreflight,
} from "../candidate-preflight.ts";
import {
  parseDatasetAudit,
  validateDatasetManifest,
} from "../dataset-manifest.ts";
import { computeEvaluatorDigest } from "../digests.ts";
import { isWarningPositive } from "../metrics.ts";
import {
  assertPredictionCompleteness,
  computePredictionManifestDigest,
} from "../prediction-schema.ts";
import {
  clusterRootsOf,
  type FoldStratification,
} from "../cross-validation.ts";
import { parseBenchmarkDataset, type BenchmarkRecord } from "../schema.ts";
import {
  validateSplitArtifact,
  type SplitArtifact,
} from "../split-artifact.ts";
import {
  CommandError,
  readJsonFile,
  readPredictionArtifact,
  readTextFile,
  writeJsonAtomic,
} from "./io.ts";

export interface FitOptions {
  datasetDirectory: string;
  datasetAuditPath: string;
  sourceReadinessPath: string;
  splitArtifactPath: string;
  runtimeParityPath: string;
  developmentPredictionsDirectory: string;
  calibrationPredictionsDirectory: string;
  outputDirectory: string;
  seed: number;
  /**
   * Free disk bytes fed to the candidate preflight. The CLI measures the real
   * figure; programmatic callers that omit it are treated as unconstrained
   * (`Number.MAX_SAFE_INTEGER`), so the 20 GiB gate is enforced at the CLI
   * boundary that operators actually use.
   */
  freeDiskBytes?: number;
}

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

export async function runFit(options: FitOptions): Promise<string> {
  const manifest = validateDatasetManifest(
    await readJsonFile(join(options.datasetDirectory, "manifest.json")),
  );
  const records = parseBenchmarkDataset(
    await readTextFile(join(options.datasetDirectory, "records.jsonl")),
  );

  const datasetAudit = await parseDatasetAudit(
    await readJsonFile(options.datasetAuditPath),
  );
  if (
    datasetAudit.datasetId !== manifest.datasetId ||
    datasetAudit.recordsSha256 !== manifest.recordsSha256 ||
    datasetAudit.reviewLedgerSha256 !== manifest.reviewLedgerSha256 ||
    datasetAudit.sourceManifestSha256 !== manifest.sourceManifestSha256
  ) {
    throw new CommandError(
      "DATASET_AUDIT_MISMATCH",
      "dataset audit does not match the dataset manifest/bytes",
    );
  }

  const sourceReadiness = await parseCorpusSourceReadinessReport(
    await readJsonFile(options.sourceReadinessPath),
  );
  const runtimeParity = await parseRuntimeParityManifestV1(
    await readJsonFile(options.runtimeParityPath),
  );

  const artifact = (await readJsonFile(
    options.splitArtifactPath,
  )) as SplitArtifact;
  await validateSplitArtifact(artifact, manifest, records);

  const development = await readPredictionArtifact(
    options.developmentPredictionsDirectory,
    { scientificUse: "release" },
  );
  const calibration = await readPredictionArtifact(
    options.calibrationPredictionsDirectory,
    { scientificUse: "release" },
  );

  const recordsById = new Map(records.map((record) => [record.id, record]));

  // Fail closed on prediction completeness, exactly like validate-predictions
  // (assertPredictionCompleteness) and evaluate (assertTestCoverage): the union
  // of the development and calibration prediction ids must cover EXACTLY the set
  // of non-test split-assigned ids — one row per id (ANY status counts for
  // coverage), no missing, no extra, and no duplicate/cross-artifact id
  // collision — so the sealed thresholds are never fit over a denominator that
  // diverges from the frozen split.
  const nonTestIds = artifact.assignments
    .filter((assignment) => assignment.partition !== "test")
    .map((assignment) => assignment.id);
  const combinedPredictions = [
    ...development.predictions,
    ...calibration.predictions,
  ];
  const seenPredictionIds = new Set<string>();
  for (const prediction of combinedPredictions) {
    if (seenPredictionIds.has(prediction.id)) {
      throw new CommandError(
        "FIT_PREDICTION_COLLISION",
        `prediction id "${prediction.id}" appears in both the development and calibration artifacts`,
      );
    }
    seenPredictionIds.add(prediction.id);
  }
  try {
    assertPredictionCompleteness(nonTestIds, combinedPredictions);
  } catch (error) {
    throw new CommandError(
      "FIT_PREDICTIONS_INCOMPLETE",
      error instanceof Error ? error.message : String(error),
    );
  }

  const scoreById = new Map(
    combinedPredictions.map(
      (prediction) => [prediction.id, prediction] as const,
    ),
  );

  // KNOWN DEFECT, retained on purpose pending plan tasks G1/G2: threshold
  // selection below consumes ALL non-test records with null raw scores coerced
  // to 0 (`documentRawScore ?? 0`). That coercion is the R5 violation A3
  // removed everywhere else, and the symmetry it used to claim with
  // evaluate.ts's decision metrics ENDED with A3: evaluate.ts no longer scores
  // an undecided row at all, so nothing here mirrors it any more. Direction of
  // the bias, so nobody preserves it by accident: padding the human sample with
  // fake 0s pulls the one-sided quantile DOWN, which LOWERS the threshold and
  // RAISES the real FPR. It breaks the accusation budget rather than flattering
  // it. G2 rewrites this population wholesale (conformal quantile over
  // date-cutoff core humans of cal-B) and must NOT carry the `?? 0` over.
  // Calibrator fitting is already clean: it consumes ONLY status === "scored"
  // records, mirroring metrics.ts `scoredBinary`, so an abstained/errored raw-0
  // never contaminates the calibration curve.
  // The split/exposure cluster of every row, over the WHOLE corpus. Restricting it
  // to the fit population would give the SAME roots — `createBlockedSplit` assigns
  // whole components to one partition, so no component straddles the test cut — and
  // the reason for the whole set is therefore not that a component could be split:
  // it is defence in depth, plus a root that does not depend on which partition a row
  // landed in. It reads only the grouping axes: no test label and no test score.
  //
  // The price, stated because it is a real behaviour: `fit` now ABORTS when any row
  // anywhere in the corpus declares an `unknown` connectivity axis, including a row
  // of the blocked test block that enters neither the calibrator nor the thresholds
  // nor the folds. That is fail-closed in the direction R6 asks for — a corpus with
  // unnameable clusters is not one this fit should freeze a calibrator over.
  const clusterRootById = clusterRootsOf(records);

  const samples: FitSampleScores[] = [];
  const positives: FitSampleScores[] = [];
  const calibratorSamples: FitSampleScores[] = [];
  const calibratorPositives: FitSampleScores[] = [];
  const testIds: string[] = [];
  for (const assignment of artifact.assignments) {
    if (assignment.partition === "test") {
      testIds.push(assignment.id);
      continue;
    }
    const record = recordsById.get(assignment.id);
    const prediction = scoreById.get(assignment.id);
    if (record === undefined || prediction === undefined) continue;
    const clusterRoot = clusterRootById.get(record.id);
    if (clusterRoot === undefined) {
      throw new CommandError(
        "FIT_CLUSTER_MISSING",
        `record "${record.id}" has no split/exposure cluster`,
      );
    }
    const scores: FitSampleScores = {
      id: record.id,
      clusterRoot,
      documentRawScore: prediction.documentRawScore ?? 0,
      localizedRawScore: prediction.localizedRawScore ?? 0,
    };
    const scored = prediction.status === "scored";
    if (isPositive(record)) {
      positives.push(scores);
      if (scored) calibratorPositives.push(scores);
    } else if (record.label === "human") {
      samples.push(scores);
      if (scored) calibratorSamples.push(scores);
    }
  }

  const sourceManifestBytes = await readTextFile(
    join(options.datasetDirectory, "private", "source-manifest.json"),
  );

  const developmentManifestDigest = await computePredictionManifestDigest(
    development.manifest,
  );
  const calibrationManifestDigest = await computePredictionManifestDigest(
    calibration.manifest,
  );

  // The candidate freeze preflight must be READY before any calibration runs:
  // ready source/dataset/split audits and their exact digests, matching
  // prediction identities/parity/coverage, verified bundle/license, WASM-only
  // manifests, no test-prediction input and at least 20 GiB free disk. The
  // free-disk figure is measured at the CLI boundary and threaded through here.
  const preflight = runCandidatePreflight({
    datasetManifest: manifest,
    datasetAudit,
    sourceReadiness,
    runtimeParity,
    sourceManifestBytes,
    splitArtifact: artifact,
    developmentManifest: development.manifest,
    developmentManifestDigest,
    calibrationManifest: calibration.manifest,
    calibrationManifestDigest,
    developmentPredictionIds: development.predictions.map(
      (prediction) => prediction.id,
    ),
    calibrationPredictionIds: calibration.predictions.map(
      (prediction) => prediction.id,
    ),
    freeDiskBytes: options.freeDiskBytes ?? Number.MAX_SAFE_INTEGER,
  });
  if (preflight.status !== "ready") {
    throw new CommandError(
      "CANDIDATE_PREFLIGHT_BLOCKED",
      `candidate preflight is blocked: ${preflight.blockingReasons.join("; ")}`,
    );
  }

  const evaluatorDigest = await computeEvaluatorDigest(REPO_ROOT);

  const frozen = fitFrozenCalibration({
    partition: "calibration",
    fitSeed: options.seed,
    samples,
    positives,
    calibratorSamples,
    calibratorPositives,
    testIds,
    evaluatorDigest,
    datasetManifest: manifest,
    datasetAudit,
    sourceReadiness,
    runtimeParity,
    sourceManifestBytes,
    developmentManifest: development.manifest,
    developmentManifestDigest,
    calibrationManifest: calibration.manifest,
    calibrationManifestDigest,
  });

  // EXACTLY the digest-sealed fields, enumerated by the module that computes the
  // digest. Not a rest-spread that drops the two closures: that shape wrote every
  // field the fit result happened to carry, and `crossValidation` rode it into
  // frozen-calibration.json without being covered by `artifactDigest`.
  const artifactFields = sealedCalibrationArtifact(frozen);

  // Fail-closed: the frozen artifact must carry exactly the identities and
  // digests the preflight cleared — defense-in-depth over validateFitInputs.
  verifyFrozenAgainstPreflight(artifactFields, preflight);

  await writeJsonAtomic(
    join(options.outputDirectory, "frozen-calibration.json"),
    artifactFields,
  );
  // The cross-validation diagnosis travels in its own file, outside the seal, for the
  // reason `FrozenCalibrationResult.crossValidation` gives. It is written even when
  // nothing is wrong, because "no file" and "no degeneracy" must not look alike.
  await writeJsonAtomic(
    join(options.outputDirectory, "cross-validation.json"),
    frozen.crossValidation,
  );
  await writeJsonAtomic(
    join(options.outputDirectory, "fit-report.json"),
    buildFitReport(preflight, artifactFields),
  );
  await writeJsonAtomic(
    join(options.outputDirectory, "development-prediction-manifest.json"),
    development.manifest,
  );
  await writeJsonAtomic(
    join(options.outputDirectory, "calibration-prediction-manifest.json"),
    calibration.manifest,
  );

  return (
    "Calibration frozen without test access; " +
    "warning UCB target=0.05; action UCB target=0.02. " +
    describeCrossValidation(frozen.crossValidation)
  );
}

/**
 * The one-line reading of the cross-validation diagnosis, so that a degenerate fold
 * design reaches the operator who ran `fit` and not only a file nobody opens.
 *
 * Three things must be visible here rather than inferred: atoms that are all single
 * record-lines (the per-record-line folds of assessment §3.6, which cannot be refused
 * because R6 allows an all-singleton axis), an atom too large for the class balance to
 * be reachable, and imbalance the packer left ABOVE the floor the atom sizes impose.
 * The first two are corpus facts and the third is the packer's, which is exactly why
 * they are reported apart.
 */
function describeCrossValidation(crossValidation: {
  document: FoldStratification;
  localized: FoldStratification;
}): string {
  const parts: string[] = [];
  for (const [path, stratification] of Object.entries(crossValidation)) {
    const notes: string[] = [
      `${stratification.clusters} cluster(s) over ${stratification.items} record-line(s)`,
    ];
    if (stratification.perRecordLineAtoms) {
      notes.push(
        "EVERY atom is a single record-line: these folds are per-record-line folds, " +
          "not grouped ones",
      );
    }
    if (stratification.oversizedClusters.length > 0) {
      notes.push(
        `${stratification.oversizedClusters.length} atom(s) larger than one fold's ideal class share`,
      );
    }
    const worstExcess = Math.max(
      0,
      ...stratification.balance.map((balance) => balance.excessOverFloor),
    );
    if (worstExcess > 0) {
      notes.push(
        `class imbalance ${worstExcess.toFixed(4)} above the floor the atom sizes impose`,
      );
    }
    parts.push(`${path}: ${notes.join("; ")}`);
  }
  return `Grouped CV — ${parts.join(" | ")}.`;
}

// Warning positives, from the ONE definition (benchmark/metrics.ts): integral
// generation plus MECHANISTIC material assistance at or above the frozen AI
// fraction. Delegated rather than restated, because the copy that used to live
// here hardcoded 0.5 and knew nothing about the generation mode — so an
// `ecological` row would have been a fit-time positive and an evaluation-time
// non-positive, which is precisely the cross-cohort pooling B2 forbids.
function isPositive(record: BenchmarkRecord): boolean {
  return isWarningPositive(record);
}
