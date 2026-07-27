import {
  selectDistributedWindows,
  type DistributedWindowSelection,
} from "@/inference/chunker";
import { CleanFeedError } from "@/shared/errors";
import type { AggregationResultV2 } from "@/shared/types";

/** A scored content window: its interval plus the model's raw AI score. */
export interface WindowScore {
  index: number;
  tokenStart: number;
  tokenEnd: number;
  rawScore: number;
}

/**
 * The version stamp of this aggregation rule; part of the calibration key.
 *
 * `v3` is A2's window policy: the selection may happen before inference (which
 * changes no output), and a window's `tokenEnd` may be REDUCED so its re-encoded
 * slice fits the model's token budget (`fitWindowSlice`, in `chunker.ts`). A
 * reduced `tokenEnd` shrinks that window's share in `uniqueTokenWeights`, which
 * moves `documentRawScore` and `coverage` — and it also converts what used to be
 * an inference error into a score. `truncated` is NOT affected: it is returned
 * verbatim from `selection.truncated`, a property of window SELECTION, not of
 * slice fitting. So scores produced under `v3` are not interchangeable with `v2`.
 * `aggregator.test.ts` binds this constant to the sealed manifest's coordinate,
 * so a one-sided bump is a red test rather than a scoring-time identity mismatch.
 */
export const AGGREGATION_VERSION = "tmr-aggregation-v3" as const;

/**
 * FALLBACK window budget, for the callers that hold no manifest. The sealed
 * `manifest.windowing.maxWindows` is AUTHORITATIVE and must be passed through
 * {@link AggregateWindowsOptions}; this constant only keeps the uncalibrated
 * demonstration paths working.
 *
 * It must stay equal to the sealed value, and that is a BOUND contract, not a
 * declaration: `aggregator.test.ts` asserts equality against
 * `bundledModelManifest.windowing.maxWindows` rather than the literal, so
 * changing the sealed budget turns that test red instead of leaving the
 * production worker and the smoke harness silently on the old number. This module
 * cannot import the manifest itself — it must stay free of bundle state.
 */
export const FALLBACK_MAX_AGGREGATION_WINDOWS = 8;

/** Raw score at or above which a window is diagnosed as high-scoring. */
const HIGH_SCORE_THRESHOLD = 0.8;

/** A window's score counts as agreeing within this band of the document score. */
const AGREEMENT_BAND = 0.15;

/** How the caller supplies the window budget, or a selection already made. */
export interface AggregateWindowsOptions {
  /**
   * The window budget, from `manifest.windowing.maxWindows`. Defaults to
   * {@link FALLBACK_MAX_AGGREGATION_WINDOWS}. Ignored when `selection` is given,
   * because that selection already applied a budget.
   */
  maxWindows?: number;
  /**
   * The selection made BEFORE inference, when the caller inferred only the
   * chosen windows instead of all candidates. `windows` must then be exactly
   * those windows; the accounting (`candidateWindowCount`, `truncated`, the
   * original indices) comes from here, so the report still describes how many
   * candidates existed rather than how many were scored.
   */
  selection?: DistributedWindowSelection;
}

/**
 * Aggregates window scores into the v2 result WITHOUT ever blending the two
 * decision signals. At most `maxWindows` windows are selected (first, last and
 * evenly distributed); each token is attributed to the FIRST selected window
 * covering it, so overlap is discounted exactly once. `documentRawScore` is the
 * unique-token-weighted mean; `localizedRawScore` is the highest valid single
 * window; `coverage` is the union of selected intervals over `totalTokenCount`.
 * Median, min, max, stdDev and highScoreRatio are diagnostics only.
 *
 * The selection may equivalently be made by the CALLER, before inference, and
 * passed in — the policy is the same function either way
 * ({@link selectDistributedWindows}), so a document with more candidates than
 * the budget pays one inference per SELECTED window instead of one per
 * candidate, and the aggregation is bit-identical.
 */
export function aggregateWindowsV2(
  windows: WindowScore[],
  totalTokenCount: number,
  options: AggregateWindowsOptions = {},
): AggregationResultV2 {
  if (windows.length === 0) {
    throw new CleanFeedError("INSUFFICIENT_EVIDENCE", "INSUFFICIENT_EVIDENCE");
  }

  const selection =
    options.selection ??
    selectDistributedWindows(
      windows,
      options.maxWindows ?? FALLBACK_MAX_AGGREGATION_WINDOWS,
    );
  const selected: WindowScore[] = [];
  for (const index of selection.selectedIndices) {
    const window = windows.find((candidate) => candidate.index === index);
    if (window !== undefined) {
      selected.push(window);
    }
  }
  // A SUPPLIED selection is a claim that `windows` are exactly the windows it
  // chose — the claim a caller makes when it selected before inferring. If it is
  // false, `candidateWindowCount`, `truncated` and `selectedWindowIndices` below
  // describe a DIFFERENT subset than the model actually saw, and `coverage` is
  // computed over intervals that were never scored. Preserving that accounting is
  // the whole point of selecting before inference, so the disagreement fails
  // closed here rather than being published as a quietly wrong report.
  if (
    selected.length !== selection.selectedIndices.length ||
    (options.selection !== undefined && selected.length !== windows.length)
  ) {
    throw new CleanFeedError("INFERENCE_FAILED", "WINDOW_SELECTION_MISMATCH");
  }

  // The SAME inputs are rejected as before, but each branch now names itself.
  // While all four shared the message "INFERENCE_FAILED" the scored artifacts
  // could not tell a non-finite model score from an empty window, so no
  // correction could be more than a guess. The message is a code from the shared
  // failure-detail allowlist (contracts/failure-detail.ts); the ErrorCode stays
  // INFERENCE_FAILED so existing recovery keeps recognizing the class.
  if (!Number.isFinite(totalTokenCount) || totalTokenCount <= 0) {
    throw new CleanFeedError("INFERENCE_FAILED", "INVALID_TOTAL_TOKEN_COUNT");
  }
  if (selected.some((window) => !Number.isFinite(window.rawScore))) {
    throw new CleanFeedError("INFERENCE_FAILED", "NON_FINITE_SCORE");
  }
  if (selected.some((window) => !isScore(window.rawScore))) {
    throw new CleanFeedError("INFERENCE_FAILED", "SCORE_OUT_OF_RANGE");
  }

  const uniqueTokens = uniqueTokenWeights(selected);
  const totalUnique = uniqueTokens.reduce((sum, weight) => sum + weight, 0);

  if (totalUnique <= 0) {
    throw new CleanFeedError("INFERENCE_FAILED", "ZERO_UNIQUE_TOKEN_WEIGHT");
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
