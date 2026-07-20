// `npm run benchmark -- --input <jsonl> --output <dir>` entrypoint.
//
// Runs under Node's native TypeScript execution (Node >= 22.18), so sibling
// imports use explicit .ts extensions and no TypeScript features that require
// transformation (enums, namespaces, parameter properties) are used.
//
// Standalone: MUST NOT import from the extension bundle (src/).

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { argv, exit, stderr, stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { type BinaryMetrics, type SegmentMetrics } from "./metrics.ts";
import {
  assertPredictionCompleteness,
  parsePredictions,
  type StrictPredictionV2,
} from "./prediction-schema.ts";
import {
  buildBenchmarkReport,
  type BenchmarkReport,
  type ScoredRecord,
  type SplitStrategy,
} from "./report.ts";
import { parseBenchmarkDataset, type BenchmarkRecord } from "./schema.ts";
import { groupTimeSplit, type DatasetSplit } from "./split.ts";

const DEFAULT_BLOCK_THRESHOLD = 0.92;
const DEFAULT_TARGET_FPR = 0.01;

interface CliOptions {
  input: string;
  output: string;
  split: SplitStrategy;
  comparisonOnly: boolean;
  predictions?: string;
  blockThreshold: number;
  targetFpr: number;
}

export function parseCliArgs(args: readonly string[]): CliOptions {
  const flags = new Map<string, string | boolean>();
  for (let i = 0; i < args.length; i += 1) {
    const token = args[i];
    if (!token.startsWith("--")) {
      throw new CliError(`unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    const next = args[i + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(key, true);
    } else {
      flags.set(key, next);
      i += 1;
    }
  }

  const input = requireString(flags, "input");
  const output = requireString(flags, "output");
  const split = flags.get("split");
  const comparisonOnly = flags.get("comparison-only") === true;

  // The split strategy is a release-safety gate. group-time is mandatory for
  // any run that could inform a launch decision; random is only ever a
  // comparison baseline and is refused unless the caller explicitly opts into
  // comparison-only mode.
  if (split !== "group-time" && split !== "random") {
    throw new CliError(
      'required flag --split must be "group-time" (release-eligible) or "random" (comparison only)',
    );
  }
  if (split === "random" && !comparisonOnly) {
    throw new CliError(
      "--split random is only allowed together with --comparison-only; it can never inform a release decision",
    );
  }

  return {
    input,
    output,
    split,
    comparisonOnly,
    predictions: optionalString(flags, "predictions"),
    blockThreshold: numberFlag(
      flags,
      "block-threshold",
      DEFAULT_BLOCK_THRESHOLD,
    ),
    targetFpr: numberFlag(flags, "target-fpr", DEFAULT_TARGET_FPR),
  };
}

export async function main(args: readonly string[]): Promise<void> {
  const options = parseCliArgs(args);

  const dataset = parseBenchmarkDataset(await readFile(options.input, "utf8"));
  if (dataset.length === 0) {
    throw new CliError(`dataset ${options.input} contains no records`);
  }

  const split = splitDataset(dataset, options);
  // The leakage assertion only applies to the release-eligible group-time split.
  // The random baseline is a comparison-only mode that is EXPECTED to carry
  // author/temporal leakage (its report is already flagged not release-eligible),
  // so gating it here would crash the documented mode on any realistic dataset.
  if (options.split === "group-time") {
    assertNoLeakage(split);
  }

  await mkdir(options.output, { recursive: true });

  const predictions =
    options.predictions === undefined
      ? undefined
      : parsePredictions(await readFile(options.predictions, "utf8"));

  if (predictions === undefined) {
    const audit = buildAudit(dataset, split, options);
    await writeAudit(options.output, audit);
    stdout.write(
      `Dataset validated (${dataset.length} records). No --predictions supplied: ` +
        "wrote split audit only. Active backend remains mock; no scientific metrics produced.\n",
    );
    return;
  }

  // Strict completeness: every holdout record has exactly one prediction, and
  // there are no extras. A missing/extra/duplicate id or an out-of-range score
  // has already been rejected as a hard failure, never skipped.
  const scored = joinCompletePredictions(split.test, predictions);
  const report = buildBenchmarkReport({
    datasetName: options.input,
    modelId: "unknown",
    modelVersion: "unknown",
    splitStrategy: options.split,
    comparisonOnly: options.comparisonOnly,
    blockThreshold: options.blockThreshold,
    targetFpr: options.targetFpr,
    scored,
    splitSizes: {
      train: split.train.length,
      calibration: split.calibration.length,
      test: split.test.length,
    },
  });

  await writeReport(options.output, report);
  stdout.write(
    `Report written to ${options.output}. Headline precisionAmongBlocked=` +
      `${format(report.headline.value)}` +
      (report.split.releaseDecisionEligible
        ? ".\n"
        : " (NOT release-decision-eligible).\n"),
  );
}

function splitDataset(
  dataset: readonly BenchmarkRecord[],
  options: CliOptions,
): DatasetSplit<BenchmarkRecord> {
  if (options.split === "group-time") {
    // The closed v2 record keeps the author under `groups.author`; project it to
    // a top-level `authorGroup` so the group-time splitter (and the leakage
    // assertion below, which reads `authorGroup`) cluster by the real author.
    const grouped = dataset.map((record) => ({
      ...record,
      authorGroup: record.groups.author,
    }));
    return groupTimeSplit(grouped, {
      groupBy: "authorGroup",
      timeBy: "createdAt",
    });
  }
  // Random comparison baseline: deterministic, ordered by id so runs are
  // reproducible. Never release-eligible (guarded above).
  const ordered = [...dataset].sort((a, b) => a.id.localeCompare(b.id));
  const trainEnd = Math.floor(ordered.length * 0.6);
  const calibrationEnd = Math.floor(ordered.length * 0.8);
  return {
    train: ordered.slice(0, trainEnd),
    calibration: ordered.slice(trainEnd, calibrationEnd),
    test: ordered.slice(calibrationEnd),
  };
}

// Belt-and-suspenders check that the split we are about to report on carries no
// author or temporal leakage. Only meaningful for group-time; random baselines
// are already flagged as not release-eligible.
function assertNoLeakage(split: DatasetSplit<BenchmarkRecord>): void {
  const authorsOf = (rows: readonly BenchmarkRecord[]): Set<string> =>
    new Set(rows.map((row) => row.authorGroup));
  const train = authorsOf(split.train);
  const calibration = authorsOf(split.calibration);
  const test = authorsOf(split.test);

  for (const author of test) {
    if (train.has(author) || calibration.has(author)) {
      throw new CliError(
        `author leakage: ${author} appears in multiple splits`,
      );
    }
  }
  for (const author of calibration) {
    if (train.has(author)) {
      throw new CliError(
        `author leakage: ${author} appears in multiple splits`,
      );
    }
  }

  if (split.calibration.length > 0 && split.test.length > 0) {
    const latestCalibration = Math.max(
      ...split.calibration.map((row) => row.createdAt),
    );
    const earliestTest = Math.min(...split.test.map((row) => row.createdAt));
    if (earliestTest <= latestCalibration) {
      throw new CliError(
        "temporal leakage: a test record is not strictly newer than every calibration record",
      );
    }
  }
}

function joinCompletePredictions(
  records: readonly BenchmarkRecord[],
  predictions: readonly StrictPredictionV2[],
): ScoredRecord[] {
  assertPredictionCompleteness(
    records.map((record) => record.id),
    predictions,
  );
  const byId = new Map(
    predictions.map((prediction) => [prediction.id, prediction] as const),
  );
  return records.map((record) => {
    // Safe: assertPredictionCompleteness proved every record id has exactly one
    // prediction, so this lookup can never be undefined.
    const prediction = byId.get(record.id)!;
    const scored: ScoredRecord = {
      record,
      // Legacy binary report path: the document raw score is the AI score; an
      // abstained/error row (null score) contributes as a non-AI observation.
      aiScore: prediction.documentRawScore ?? 0,
    };
    if (prediction.memoryBytes !== null) {
      scored.memoryBytes = prediction.memoryBytes;
    }
    scored.latencyMs = prediction.latencyMs;
    return scored;
  });
}

interface SplitAudit {
  dataset: string;
  split: SplitStrategy;
  releaseDecisionEligible: boolean;
  sizes: { train: number; calibration: number; test: number };
  labels: Record<string, number>;
  languages: Record<string, number>;
  platforms: Record<string, number>;
  note: string;
}

function buildAudit(
  dataset: readonly BenchmarkRecord[],
  split: DatasetSplit<BenchmarkRecord>,
  options: CliOptions,
): SplitAudit {
  return {
    dataset: options.input,
    split: options.split,
    releaseDecisionEligible:
      options.split === "group-time" && !options.comparisonOnly,
    sizes: {
      train: split.train.length,
      calibration: split.calibration.length,
      test: split.test.length,
    },
    labels: tally(dataset, (record) => record.label),
    languages: tally(dataset, (record) => record.language),
    platforms: tally(dataset, (record) => record.platform),
    note: "Real model artifact not supplied: dataset validated and split audited, but no scientific metrics were produced. Active backend remains mock.",
  };
}

function tally(
  dataset: readonly BenchmarkRecord[],
  keyOf: (record: BenchmarkRecord) => string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of dataset) {
    const key = keyOf(record);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function writeAudit(output: string, audit: SplitAudit): Promise<void> {
  await writeFile(
    join(output, "split-audit.json"),
    `${JSON.stringify(audit, null, 2)}\n`,
  );
}

async function writeReport(
  output: string,
  report: BenchmarkReport,
): Promise<void> {
  await writeFile(
    join(output, "benchmark-report.json"),
    `${JSON.stringify(report, replacer, 2)}\n`,
  );
  await writeFile(join(output, "benchmark-report.md"), renderMarkdown(report));
}

// NaN is not valid JSON; serialise it as null so downstream tools do not choke.
function replacer(_key: string, value: unknown): unknown {
  return typeof value === "number" && Number.isNaN(value) ? null : value;
}

function renderMarkdown(report: BenchmarkReport): string {
  const lines: string[] = [];
  lines.push(`# Benchmark: ${report.model.id} ${report.model.version}`);
  lines.push("");
  lines.push(`- Dataset: \`${report.dataset}\``);
  lines.push(`- Gerado em: ${report.generatedAt}`);
  lines.push(`- Split: ${report.split.strategy}`);
  lines.push(
    report.split.releaseDecisionEligible
      ? "- Apto a decisões de lançamento: sim"
      : "- Apto a decisões de lançamento: NÃO",
  );
  if (report.split.sizes !== undefined) {
    lines.push(
      `- Tamanho dos splits: train ${report.split.sizes.train}, ` +
        `calibração ${report.split.sizes.calibration}, teste ${report.split.sizes.test}`,
    );
  }
  lines.push("");
  lines.push(
    `## Métrica principal: precisão entre bloqueados = ${format(report.headline.value)}`,
  );
  lines.push("");
  lines.push(metricsTable(report.overall));
  lines.push("");

  appendSegment(lines, "Tamanho (palavras)", report.segments.sizeBucket);
  appendSegment(lines, "Idioma", report.segments.language);
  appendSegment(lines, "Plataforma", report.segments.platform);
  appendSegment(lines, "Modelo gerador", report.segments.generatorModel);
  appendSegment(lines, "Transformação", report.segments.transformation);

  if (report.notes.length > 0) {
    lines.push("## Notas");
    lines.push("");
    for (const note of report.notes) lines.push(`- ${note}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

function metricsTable(metrics: BinaryMetrics): string {
  const rows: [string, string][] = [
    ["Amostra", String(metrics.sampleSize)],
    ["Precisão entre bloqueados", format(metrics.precisionAmongBlocked)],
    ["Recall", format(metrics.recall)],
    ["F1", format(metrics.f1)],
    ["FPR", format(metrics.falsePositiveRate)],
    ["FNR", format(metrics.falseNegativeRate)],
    ["ROC-AUC", format(metrics.rocAuc)],
    ["PR-AUC", format(metrics.prAuc)],
    [
      `Recall @ FPR<=${format(metrics.recallAtTargetFpr.targetFpr)}`,
      format(metrics.recallAtTargetFpr.recall),
    ],
    ["TP / FP / TN / FN", tpFpTnFn(metrics)],
  ];
  if (metrics.latency !== undefined) {
    rows.push([
      "Latência ms (p50/p95/max)",
      `${format(metrics.latency.p50Ms)} / ${format(metrics.latency.p95Ms)} / ${format(metrics.latency.maxMs)}`,
    ]);
  }
  if (metrics.memory !== undefined) {
    rows.push([
      "Memória bytes (média/máx)",
      `${format(metrics.memory.meanBytes)} / ${format(metrics.memory.maxBytes)}`,
    ]);
  }

  return [
    "| Métrica | Valor |",
    "| --- | --- |",
    ...rows.map(([name, value]) => `| ${name} | ${value} |`),
  ].join("\n");
}

function appendSegment(
  lines: string[],
  title: string,
  segments: readonly SegmentMetrics[],
): void {
  lines.push(`## Segmento: ${title}`);
  lines.push("");
  if (segments.length === 0) {
    lines.push("_Sem amostras._");
    lines.push("");
    return;
  }
  lines.push(
    "| Segmento | Amostra | Precisão entre bloqueados | Recall | ROC-AUC |",
  );
  lines.push("| --- | --- | --- | --- | --- |");
  for (const segment of segments) {
    lines.push(
      `| ${segment.key} | ${segment.metrics.sampleSize} | ` +
        `${format(segment.metrics.precisionAmongBlocked)} | ` +
        `${format(segment.metrics.recall)} | ${format(segment.metrics.rocAuc)} |`,
    );
  }
  lines.push("");
}

function tpFpTnFn(metrics: BinaryMetrics): string {
  return `${metrics.truePositives} / ${metrics.falsePositives} / ${metrics.trueNegatives} / ${metrics.falseNegatives}`;
}

function format(value: number): string {
  if (Number.isNaN(value)) return "n/a";
  if (!Number.isFinite(value)) return String(value);
  return Number.isInteger(value) ? String(value) : value.toFixed(4);
}

class CliError extends Error {}

function requireString(
  flags: Map<string, string | boolean>,
  key: string,
): string {
  const value = flags.get(key);
  if (typeof value !== "string" || value === "") {
    throw new CliError(`required flag --${key} <value> is missing`);
  }
  return value;
}

function optionalString(
  flags: Map<string, string | boolean>,
  key: string,
): string | undefined {
  const value = flags.get(key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

function numberFlag(
  flags: Map<string, string | boolean>,
  key: string,
  fallback: number,
): number {
  const value = flags.get(key);
  if (value === undefined) return fallback;
  const parsed = typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    throw new CliError(`flag --${key} must be a finite number`);
  }
  return parsed;
}

// Only run when invoked directly (`node benchmark/cli.ts`), not when imported.
if (argv[1] !== undefined && argv[1] === fileURLToPath(import.meta.url)) {
  main(argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`benchmark failed: ${message}\n`);
    exit(1);
  });
}
