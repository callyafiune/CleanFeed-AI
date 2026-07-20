// `npm run benchmark -- <subcommand> [flags]` entrypoint.
//
// The workflow begins with `ingest` (materialize the canonical dataset
// directory from authorized local inputs) and then runs the fixed, ordered
// scientific pipeline — validate -> split -> validate-predictions -> fit ->
// evaluate -> publish-profile -> verify-evidence. This module is ONLY the parser
// and dispatcher: it rejects an unknown/missing subcommand, rejects unknown
// flags, enforces each command's required flags and the partition/ledger guards,
// then hands a typed options object to the command module. All scientific work
// lives in the pure benchmark modules; nothing here reads a dataset or a score.
//
// Runs under Node's native TypeScript execution (Node >= 22.18), so sibling
// imports use explicit .ts extensions and no transform-only TypeScript features.
//
// Standalone: MUST NOT import from the extension bundle (src/).

import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { runEvaluate, type EvaluateOptions } from "./commands/evaluate.ts";
import { runFit, type FitOptions } from "./commands/fit.ts";
import { runIngest, type IngestOptions } from "./commands/ingest.ts";
import {
  runPublishProfile,
  type PublishProfileOptions,
} from "./commands/publish-profile.ts";
import { runSplit, type SplitOptions } from "./commands/split.ts";
import { runValidate, type ValidateOptions } from "./commands/validate.ts";
import {
  runValidatePredictions,
  type ValidatePredictionsOptions,
} from "./commands/validate-predictions.ts";
import {
  runVerifyEvidence,
  type VerifyEvidenceOptions,
} from "./commands/verify-evidence.ts";
import type { Partition } from "./split.ts";

export const BENCHMARK_COMMANDS = [
  "ingest",
  "validate",
  "split",
  "validate-predictions",
  "fit",
  "evaluate",
  "publish-profile",
  "verify-evidence",
] as const;

export type BenchmarkCommand = (typeof BENCHMARK_COMMANDS)[number];

export interface CommonPaths {
  datasetDirectory: string;
  outputDirectory: string;
}

export interface ParsedCli {
  command: BenchmarkCommand;
  flags: Map<string, string | boolean>;
}

export class CliError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}

/** Parses the subcommand and its flags. A missing/unknown subcommand is fatal. */
export function parseCliArgs(args: readonly string[]): ParsedCli {
  const command = args[0];
  if (
    command === undefined ||
    !(BENCHMARK_COMMANDS as readonly string[]).includes(command)
  ) {
    throw new CliError(`expected one of ${BENCHMARK_COMMANDS.join(", ")}`);
  }
  return {
    command: command as BenchmarkCommand,
    flags: parseFlagTokens(args.slice(1)),
  };
}

/** Parses, validates and dispatches. `--help` prints usage without dispatching. */
export async function runCli(args: readonly string[]): Promise<void> {
  if (args[0] === "--help" || args[0] === "-h") {
    stdout.write(usage());
    return;
  }
  const { command, flags } = parseCliArgs(args);
  const message = await dispatch(command, flags);
  stdout.write(`${message}\n`);
}

async function dispatch(
  command: BenchmarkCommand,
  flags: FlagMap,
): Promise<string> {
  switch (command) {
    case "ingest":
      return runIngest(buildIngest(flags));
    case "validate":
      return runValidate(buildValidate(flags));
    case "split":
      return runSplit(buildSplit(flags));
    case "validate-predictions":
      return runValidatePredictions(buildValidatePredictions(flags));
    case "fit":
      return runFit(buildFit(flags));
    case "evaluate":
      return runEvaluate(buildEvaluate(flags));
    case "publish-profile":
      return runPublishProfile(buildPublishProfile(flags));
    case "verify-evidence":
      return runVerifyEvidence(buildVerifyEvidence(flags));
  }
}

type FlagMap = Map<string, string | boolean>;

function parseFlagTokens(tokens: readonly string[]): FlagMap {
  const flags: FlagMap = new Map();
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token.startsWith("--")) {
      throw new CliError(`unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = tokens[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(key, true);
    } else {
      flags.set(key, next);
      index += 1;
    }
  }
  return flags;
}

function assertKnownFlags(flags: FlagMap, allowed: readonly string[]): void {
  const allowedSet = new Set(allowed);
  for (const key of flags.keys()) {
    if (!allowedSet.has(key)) {
      throw new CliError(`unknown flag --${key}`);
    }
  }
}

function requireFlag(flags: FlagMap, key: string): string {
  const value = flags.get(key);
  if (typeof value !== "string" || value === "") {
    throw new CliError(`required flag --${key} <value> is missing`);
  }
  return value;
}

function optionalFlag(flags: FlagMap, key: string): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function requireNumberFlag(flags: FlagMap, key: string): number {
  const value = requireFlag(flags, key);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new CliError(`flag --${key} must be a finite number`);
  }
  return parsed;
}

// --- per-command option builders ------------------------------------------

function buildIngest(flags: FlagMap): IngestOptions {
  assertKnownFlags(flags, [
    "input",
    "review-ledger",
    "sources",
    "dataset-manifest-template",
    "dataset-dir",
  ]);
  return {
    inputRecordsPath: requireFlag(flags, "input"),
    reviewLedgerPath: requireFlag(flags, "review-ledger"),
    sourceManifestPath: requireFlag(flags, "sources"),
    datasetManifestTemplatePath: requireFlag(
      flags,
      "dataset-manifest-template",
    ),
    datasetDirectory: requireFlag(flags, "dataset-dir"),
  };
}

function buildValidate(flags: FlagMap): ValidateOptions {
  assertKnownFlags(flags, ["dataset-dir", "output"]);
  return {
    datasetDirectory: requireFlag(flags, "dataset-dir"),
    outputDirectory: requireFlag(flags, "output"),
  };
}

function buildSplit(flags: FlagMap): SplitOptions {
  assertKnownFlags(flags, ["dataset-dir", "dataset-audit", "output", "seed"]);
  return {
    datasetDirectory: requireFlag(flags, "dataset-dir"),
    datasetAuditPath: requireFlag(flags, "dataset-audit"),
    outputDirectory: requireFlag(flags, "output"),
    seed: requireNumberFlag(flags, "seed"),
  };
}

function buildValidatePredictions(flags: FlagMap): ValidatePredictionsOptions {
  assertKnownFlags(flags, [
    "dataset-dir",
    "split-artifact",
    "partition",
    "predictions",
    "runtime-parity",
    "ledger",
    "consumption-id",
  ]);
  const partition = requirePartition(flags);
  const ledgerPath = optionalFlag(flags, "ledger");
  const consumptionId = optionalFlag(flags, "consumption-id");
  if (partition === "test") {
    if (ledgerPath === undefined || consumptionId === undefined) {
      throw new CliError(
        "test predictions require --ledger and --consumption-id",
      );
    }
  } else if (ledgerPath !== undefined || consumptionId !== undefined) {
    throw new CliError(
      "--ledger and --consumption-id are only valid for the test partition",
    );
  }
  const options: ValidatePredictionsOptions = {
    datasetDirectory: requireFlag(flags, "dataset-dir"),
    splitArtifactPath: requireFlag(flags, "split-artifact"),
    partition,
    predictionsDirectory: requireFlag(flags, "predictions"),
    runtimeParityPath: requireFlag(flags, "runtime-parity"),
  };
  if (ledgerPath !== undefined) options.ledgerPath = ledgerPath;
  if (consumptionId !== undefined) options.consumptionId = consumptionId;
  return options;
}

function buildFit(flags: FlagMap): FitOptions {
  assertKnownFlags(flags, [
    "dataset-dir",
    "dataset-audit",
    "source-readiness",
    "split-artifact",
    "runtime-parity",
    "development-predictions",
    "calibration-predictions",
    "output",
    "seed",
    "partition",
  ]);
  const partition = optionalFlag(flags, "partition");
  if (
    partition !== undefined &&
    partition !== "development" &&
    partition !== "calibration"
  ) {
    throw new CliError("fit accepts only development and calibration");
  }
  return {
    datasetDirectory: requireFlag(flags, "dataset-dir"),
    datasetAuditPath: requireFlag(flags, "dataset-audit"),
    sourceReadinessPath: requireFlag(flags, "source-readiness"),
    splitArtifactPath: requireFlag(flags, "split-artifact"),
    runtimeParityPath: requireFlag(flags, "runtime-parity"),
    developmentPredictionsDirectory: requireFlag(
      flags,
      "development-predictions",
    ),
    calibrationPredictionsDirectory: requireFlag(
      flags,
      "calibration-predictions",
    ),
    outputDirectory: requireFlag(flags, "output"),
    seed: requireNumberFlag(flags, "seed"),
  };
}

function buildEvaluate(flags: FlagMap): EvaluateOptions {
  assertKnownFlags(flags, [
    "dataset-dir",
    "split-artifact",
    "frozen-calibration",
    "test-predictions",
    "test-labels",
    "ledger",
    "consumption-id",
    "output",
    "bootstrap-seed",
  ]);
  return {
    datasetDirectory: requireFlag(flags, "dataset-dir"),
    splitArtifactPath: requireFlag(flags, "split-artifact"),
    frozenCalibrationPath: requireFlag(flags, "frozen-calibration"),
    testPredictionsDirectory: requireFlag(flags, "test-predictions"),
    testLabelsPath: requireFlag(flags, "test-labels"),
    ledgerPath: requireFlag(flags, "ledger"),
    consumptionId: requireFlag(flags, "consumption-id"),
    outputDirectory: requireFlag(flags, "output"),
    bootstrapSeed: requireNumberFlag(flags, "bootstrap-seed"),
  };
}

function buildPublishProfile(flags: FlagMap): PublishProfileOptions {
  assertKnownFlags(flags, [
    "report",
    "frozen-calibration",
    "issued-at",
    "model-dir",
  ]);
  return {
    reportPath: requireFlag(flags, "report"),
    frozenCalibrationPath: requireFlag(flags, "frozen-calibration"),
    issuedAt: requireFlag(flags, "issued-at"),
    modelDirectory: requireFlag(flags, "model-dir"),
  };
}

function buildVerifyEvidence(flags: FlagMap): VerifyEvidenceOptions {
  assertKnownFlags(flags, ["report", "frozen-calibration", "model-dir"]);
  return {
    reportPath: requireFlag(flags, "report"),
    frozenCalibrationPath: requireFlag(flags, "frozen-calibration"),
    modelDirectory: requireFlag(flags, "model-dir"),
  };
}

function requirePartition(flags: FlagMap): Partition {
  const partition = requireFlag(flags, "partition");
  if (
    partition !== "development" &&
    partition !== "calibration" &&
    partition !== "test"
  ) {
    throw new CliError("--partition must be development, calibration or test");
  }
  return partition;
}

function usage(): string {
  return [
    "CleanFeed AI benchmark — gated scientific workflow.",
    "",
    "Usage: npm run benchmark -- <subcommand> [flags]",
    "",
    "Subcommands (run in order):",
    "  ingest               --input --review-ledger --sources",
    "                       --dataset-manifest-template --dataset-dir",
    "  validate             --dataset-dir --output",
    "  split                --dataset-dir --dataset-audit --output --seed",
    "  validate-predictions --dataset-dir --split-artifact --partition --predictions",
    "                       --runtime-parity [test: --ledger --consumption-id]",
    "  fit                  --dataset-dir --dataset-audit --source-readiness --split-artifact",
    "                       --runtime-parity --development-predictions --calibration-predictions",
    "                       --output --seed",
    "  evaluate             --dataset-dir --split-artifact --frozen-calibration --test-predictions",
    "                       --test-labels --ledger --consumption-id --output --bootstrap-seed",
    "  publish-profile      --report --frozen-calibration --issued-at --model-dir",
    "  verify-evidence      --report --frozen-calibration --model-dir",
    "",
    "The benchmark is standalone (never imports src/) and deterministic.",
    "Scoring the holdout belongs to Phase 3, under a single consume-holdout session.",
    "",
  ].join("\n");
}

/** Entry alias used by the direct-invocation guard and by tests. */
export async function main(args: readonly string[]): Promise<void> {
  await runCli(args);
}

// Only run when invoked directly (`node benchmark/cli.ts`), not when imported.
if (argv[1] !== undefined && argv[1] === fileURLToPath(import.meta.url)) {
  main(argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`benchmark failed: ${message}\n`);
    exit(1);
  });
}
