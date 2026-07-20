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
  type FitSampleScores,
} from "../calibration-pipeline.ts";
import {
  parseDatasetAudit,
  validateDatasetManifest,
} from "../dataset-manifest.ts";
import { computeEvaluatorDigest } from "../digests.ts";
import { computePredictionManifestDigest } from "../prediction-schema.ts";
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
  const scoreById = new Map(
    [...development.predictions, ...calibration.predictions].map(
      (prediction) => [prediction.id, prediction] as const,
    ),
  );

  const samples: FitSampleScores[] = [];
  const positives: FitSampleScores[] = [];
  const testIds: string[] = [];
  for (const assignment of artifact.assignments) {
    if (assignment.partition === "test") {
      testIds.push(assignment.id);
      continue;
    }
    const record = recordsById.get(assignment.id);
    const prediction = scoreById.get(assignment.id);
    if (record === undefined || prediction === undefined) continue;
    const scores: FitSampleScores = {
      id: record.id,
      authorGroup: record.groups.author,
      documentRawScore: prediction.documentRawScore ?? 0,
      localizedRawScore: prediction.localizedRawScore ?? 0,
    };
    if (isPositive(record)) positives.push(scores);
    else if (record.label === "human") samples.push(scores);
  }

  const sourceManifestBytes = await readTextFile(
    join(options.datasetDirectory, "private", "source-manifest.json"),
  );
  const evaluatorDigest = await computeEvaluatorDigest(REPO_ROOT);

  const frozen = fitFrozenCalibration({
    partition: "calibration",
    fitSeed: options.seed,
    samples,
    positives,
    testIds,
    evaluatorDigest,
    datasetManifest: manifest,
    datasetAudit,
    sourceReadiness,
    runtimeParity,
    sourceManifestBytes,
    developmentManifest: development.manifest,
    developmentManifestDigest: await computePredictionManifestDigest(
      development.manifest,
    ),
    calibrationManifest: calibration.manifest,
    calibrationManifestDigest: await computePredictionManifestDigest(
      calibration.manifest,
    ),
  });

  // The apply* closures are not serialisable and not part of the sealed artifact.
  const { applyDocument, applyLocalized, ...artifactFields } = frozen;
  void applyDocument;
  void applyLocalized;

  await writeJsonAtomic(
    join(options.outputDirectory, "frozen-calibration.json"),
    artifactFields,
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
    "warning UCB target=0.05; action UCB target=0.02."
  );
}

// Warning positives are AI records and mixed records with at least 50% AI.
function isPositive(record: BenchmarkRecord): boolean {
  if (record.label === "ai") return true;
  if (record.label === "mixed") return (record.mixture?.aiFraction ?? 0) >= 0.5;
  return false;
}
