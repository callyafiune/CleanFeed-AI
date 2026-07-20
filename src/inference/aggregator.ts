import { selectDistributedWindows } from "@/inference/chunker";
import { CleanFeedError } from "@/shared/errors";
import type { AggregationResultV2 } from "@/shared/types";

/** A scored content window: its interval plus the model's raw AI score. */
export interface WindowScore {
  index: number;
  tokenStart: number;
  tokenEnd: number;
  rawScore: number;
}

/** The version stamp of this aggregation rule; part of the calibration key. */
export const AGGREGATION_VERSION = "tmr-aggregation-v2" as const;

/** At most eight windows are analyzed per document (part of the rule version). */
const MAX_AGGREGATION_WINDOWS = 8;

/** Raw score at or above which a window is diagnosed as high-scoring. */
const HIGH_SCORE_THRESHOLD = 0.8;

/** A window's score counts as agreeing within this band of the document score. */
const AGREEMENT_BAND = 0.15;

/**
 * Aggregates window scores into the v2 result WITHOUT ever blending the two
 * decision signals. At most eight windows are selected (first, last and evenly
 * distributed); each token is attributed to the FIRST selected window covering
 * it, so overlap is discounted exactly once. `documentRawScore` is the
 * unique-token-weighted mean; `localizedRawScore` is the highest valid single
 * window; `coverage` is the union of selected intervals over `totalTokenCount`.
 * Median, min, max, stdDev and highScoreRatio are diagnostics only.
 */
export function aggregateWindowsV2(
  windows: WindowScore[],
  totalTokenCount: number,
): AggregationResultV2 {
  if (windows.length === 0) {
    throw new CleanFeedError("INSUFFICIENT_EVIDENCE", "INSUFFICIENT_EVIDENCE");
  }

  const selection = selectDistributedWindows(windows, MAX_AGGREGATION_WINDOWS);
  const selected = selection.selectedIndices.map((index) =>
    windows.find((window) => window.index === index)!,
  );

  if (
    !Number.isFinite(totalTokenCount) ||
    totalTokenCount <= 0 ||
    selected.some((window) => !isScore(window.rawScore))
  ) {
    throw new CleanFeedError("INFERENCE_FAILED", "INFERENCE_FAILED");
  }

  const uniqueTokens = uniqueTokenWeights(selected);
  const totalUnique = uniqueTokens.reduce((sum, weight) => sum + weight, 0);

  if (totalUnique <= 0) {
    throw new CleanFeedError("INFERENCE_FAILED", "INFERENCE_FAILED");
  }

  // A weighted mean over normalized unique-token weights: each window's score
  // is scaled by its share of the covered tokens, so overlap is discounted
  // exactly once and the two decision signals are never blended.
  const documentRawScore = selected.reduce(
    (sum, window, index) =>
      sum + window.rawScore * (uniqueTokens[index]! / totalUnique),
    0,
  );
  const scores = selected.map((window) => window.rawScore);
  const localizedRawScore = Math.max(...scores);
  const mean = documentRawScore;
  const variance =
    selected.reduce(
      (sum, window, index) =>
        sum + uniqueTokens[index]! * (window.rawScore - mean) ** 2,
      0,
    ) / totalUnique;
  const stdDev = Math.sqrt(variance);
  const highScoreCount = scores.filter(
    (score) => score >= HIGH_SCORE_THRESHOLD,
  ).length;
  const agreeingCount = scores.filter(
    (score) => Math.abs(score - documentRawScore) <= AGREEMENT_BAND,
  ).length;

  return {
    version: AGGREGATION_VERSION,
    documentRawScore,
    localizedRawScore,
    coverage: totalUnique / totalTokenCount,
    truncated: selection.truncated,
    weightedMean: documentRawScore,
    median: calculateMedian(scores),
    min: Math.min(...scores),
    max: Math.max(...scores),
    stdDev,
    highScoreRatio: highScoreCount / scores.length,
    chunkAgreement: agreeingCount / scores.length,
    candidateWindowCount: selection.candidateWindowCount,
    selectedWindowIndices: selection.selectedIndices,
  };
}

/**
 * Assigns each token to the FIRST selected window covering it, returning the
 * per-window count of tokens it uniquely owns. Windows are processed in
 * ascending start order so overlap is charged to the earlier window.
 */
function uniqueTokenWeights(windows: WindowScore[]): number[] {
  const ordered = windows
    .map((window, position) => ({ window, position }))
    .sort(
      (left, right) =>
        left.window.tokenStart - right.window.tokenStart ||
        left.window.index - right.window.index,
    );

  const weights = new Array<number>(windows.length).fill(0);
  let coveredUntil = 0;
  for (const { window, position } of ordered) {
    const start = Math.max(window.tokenStart, coveredUntil);
    weights[position] = Math.max(0, window.tokenEnd - start);
    coveredUntil = Math.max(coveredUntil, window.tokenEnd);
  }
  return weights;
}

function calculateMedian(scores: number[]): number {
  const sorted = [...scores].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function isScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
