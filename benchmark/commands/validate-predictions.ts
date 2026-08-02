// `validate-predictions`: prove a prediction artifact is complete and bound to
// the frozen split and the same inference core.
//
// It re-parses the closed prediction manifest, recomputes its digest, verifies
// every shard hash, and asserts EXACT completeness against the partition's ids
// (no missing, extra or duplicate). The RuntimeParityManifestV1 is parsed and
// its digest must equal the manifest's. dev and cal-A forbid any
// ledger/consumption id; test requires them and an active started session whose
// holdoutConsumptionId matches.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).

import { join } from "node:path";

import { parseRuntimeParityManifestV1 } from "../../contracts/runtime-parity.ts";
import { validateDatasetManifest } from "../dataset-manifest.ts";
import { assertHoldoutStarted } from "../holdout-ledger.ts";
import { assertPredictionCompleteness } from "../prediction-schema.ts";
import { parseBenchmarkDataset } from "../schema.ts";
import {
  validateSplitArtifact,
  type SplitArtifact,
} from "../split-artifact.ts";
import type { ScoringPartition } from "../split.ts";
import {
  CommandError,
  readJsonFile,
  readPredictionArtifact,
  readTextFile,
} from "./io.ts";

export interface ValidatePredictionsOptions {
  datasetDirectory: string;
  splitArtifactPath: string;
  partition: ScoringPartition;
  predictionsDirectory: string;
  runtimeParityPath: string;
  ledgerPath?: string;
  consumptionId?: string;
}

export async function runValidatePredictions(
  options: ValidatePredictionsOptions,
): Promise<string> {
  const manifest = validateDatasetManifest(
    await readJsonFile(join(options.datasetDirectory, "manifest.json")),
  );
  const records = parseBenchmarkDataset(
    await readTextFile(join(options.datasetDirectory, "records.jsonl")),
  );
  const artifact = (await readJsonFile(
    options.splitArtifactPath,
  )) as SplitArtifact;
  await validateSplitArtifact(artifact, manifest, records);

  const { manifest: predictionManifest, predictions } =
    await readPredictionArtifact(options.predictionsDirectory, {
      scientificUse: "release",
    });

  if (predictionManifest.partition !== options.partition) {
    throw new CommandError(
      "PREDICTION_PARTITION_MISMATCH",
      `prediction manifest declares ${predictionManifest.partition}, expected ${options.partition}`,
    );
  }
  if (predictionManifest.datasetDigest !== artifact.datasetDigest) {
    throw new CommandError(
      "PREDICTION_DATASET_MISMATCH",
      "prediction manifest datasetDigest diverges from the split artifact",
    );
  }
  if (predictionManifest.splitDigest !== artifact.splitDigest) {
    throw new CommandError(
      "PREDICTION_SPLIT_MISMATCH",
      "prediction manifest splitDigest diverges from the split artifact",
    );
  }

  const parity = await parseRuntimeParityManifestV1(
    await readJsonFile(options.runtimeParityPath),
  );
  if (parity.runtimeParityDigest !== predictionManifest.runtimeParityDigest) {
    throw new CommandError(
      "RUNTIME_PARITY_MISMATCH",
      "prediction manifest runtimeParityDigest diverges from the runtime parity manifest",
    );
  }

  const partitionIds = artifact.assignments
    .filter((assignment) => assignment.partition === options.partition)
    .map((assignment) => assignment.id);
  assertPredictionCompleteness(partitionIds, predictions);

  if (options.partition === "test") {
    if (
      options.ledgerPath === undefined ||
      options.consumptionId === undefined
    ) {
      throw new CommandError(
        "HOLDOUT_SESSION_REQUIRED",
        "test predictions require --ledger and --consumption-id",
      );
    }
    if (predictionManifest.holdoutConsumptionId !== options.consumptionId) {
      throw new CommandError(
        "HOLDOUT_SESSION_MISMATCH",
        "prediction manifest holdoutConsumptionId diverges from --consumption-id",
      );
    }
    // The started lease must exist for this id. The full tuple is not
    // reconstructable from a prediction manifest, so identity is re-verified in
    // full at evaluate time against the frozen calibration; here we only require
    // an open (non-terminal) session.
    await assertHoldoutStarted(options.ledgerPath, options.consumptionId);
  }

  const duplicates =
    predictions.length - new Set(predictions.map((p) => p.id)).size;
  return (
    `Prediction artifact valid: missing=0 extra=0 duplicate=${duplicates} ` +
    `shardSize=${predictionManifest.shardSize}.`
  );
}
