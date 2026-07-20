// Assembles a full benchmark report from scored records. The report leads with
// precisionAmongBlocked, segments results across every axis the plan requires
// (size bucket, language, platform, generatorModel, transformation) with a
// sample size on each, and records whether the run is eligible to inform a
// release decision.
//
// Standalone module: sibling imports use explicit .ts extensions so the report
// and CLI run under Node's native TypeScript execution. It MUST NOT import from
// the extension bundle (src/).

import {
  computeBinaryMetrics,
  computeSegmentedMetrics,
  countWords,
  sizeBucket,
  type BinaryMetrics,
  type BinaryMetricsOptions,
  type Prediction,
  type SegmentMetrics,
} from "./metrics.ts";
import type { BenchmarkRecord } from "./schema.ts";

export type SplitStrategy = "group-time" | "random";

export interface ScoredRecord {
  record: BenchmarkRecord;
  // Model-predicted probability that the text is AI (0..1).
  aiScore: number;
  latencyMs?: number;
  memoryBytes?: number;
}

export interface BenchmarkReportInput {
  datasetName: string;
  modelId: string;
  modelVersion: string;
  splitStrategy: SplitStrategy;
  comparisonOnly: boolean;
  blockThreshold: number;
  targetFpr?: number;
  scored: readonly ScoredRecord[];
  splitSizes?: { train: number; calibration: number; test: number };
  generatedAt?: string;
}

export interface BenchmarkReport {
  schemaVersion: 1;
  generatedAt: string;
  dataset: string;
  model: { id: string; version: string };
  split: {
    strategy: SplitStrategy;
    releaseDecisionEligible: boolean;
    sizes?: { train: number; calibration: number; test: number };
  };
  primaryMetric: "precisionAmongBlocked";
  headline: { metric: "precisionAmongBlocked"; value: number };
  overall: BinaryMetrics;
  segments: {
    sizeBucket: SegmentMetrics[];
    language: SegmentMetrics[];
    platform: SegmentMetrics[];
    generatorModel: SegmentMetrics[];
    transformation: SegmentMetrics[];
  };
  excludedMixedCount: number;
  notes: string[];
}

export function buildBenchmarkReport(
  input: BenchmarkReportInput,
): BenchmarkReport {
  const releaseDecisionEligible =
    input.splitStrategy === "group-time" && !input.comparisonOnly;
  const options: BinaryMetricsOptions = {
    blockThreshold: input.blockThreshold,
    targetFpr: input.targetFpr,
  };

  // Binary metrics only cover unambiguous human/ai ground truth. Records
  // labelled "mixed" are counted but excluded from the confusion matrix.
  const binaryScored = input.scored.filter(
    (item) => item.record.label !== "mixed",
  );
  const excludedMixedCount = input.scored.length - binaryScored.length;

  const overall = computeBinaryMetrics(
    binaryScored.map((item) => toPrediction(item)),
    options,
  );

  return {
    schemaVersion: 1,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    dataset: input.datasetName,
    model: { id: input.modelId, version: input.modelVersion },
    split: {
      strategy: input.splitStrategy,
      releaseDecisionEligible,
      sizes: input.splitSizes,
    },
    primaryMetric: "precisionAmongBlocked",
    headline: {
      metric: "precisionAmongBlocked",
      value: overall.precisionAmongBlocked,
    },
    overall,
    segments: {
      sizeBucket: segment(binaryScored, options, (item) =>
        sizeBucket(countWords(item.record.text)),
      ),
      language: segment(binaryScored, options, (item) => item.record.language),
      platform: segment(binaryScored, options, (item) => item.record.platform),
      generatorModel: segment(
        binaryScored,
        options,
        (item) => item.record.generation?.model ?? "unknown",
      ),
      transformation: segment(
        binaryScored,
        options,
        (item) => item.record.transformation.kind,
      ),
    },
    excludedMixedCount,
    notes: buildNotes(
      input.splitStrategy,
      releaseDecisionEligible,
      excludedMixedCount,
    ),
  };
}

function segment(
  items: readonly ScoredRecord[],
  options: BinaryMetricsOptions,
  toSegmentKey: (item: ScoredRecord) => string,
): SegmentMetrics[] {
  return computeSegmentedMetrics(items, toPrediction, toSegmentKey, options);
}

function toPrediction(item: ScoredRecord): Prediction {
  return {
    label: item.record.label === "ai" ? "ai" : "human",
    score: item.aiScore,
    latencyMs: item.latencyMs,
    memoryBytes: item.memoryBytes,
  };
}

function buildNotes(
  splitStrategy: SplitStrategy,
  releaseDecisionEligible: boolean,
  excludedMixedCount: number,
): string[] {
  const notes: string[] = [];

  if (!releaseDecisionEligible) {
    notes.push(
      splitStrategy === "random"
        ? "Split aleatório: relatório apenas para comparação; não é apto a decisões de lançamento."
        : "Modo comparação: relatório não é apto a decisões de lançamento.",
    );
  }

  if (excludedMixedCount > 0) {
    notes.push(
      `${excludedMixedCount} registro(s) rotulados como "mixed" ficaram fora da matriz binária.`,
    );
  }

  notes.push(
    'Métrica principal: precisão entre bloqueados (precisionAmongBlocked). "Acurácia" nunca é headline.',
  );

  return notes;
}
