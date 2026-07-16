import { CleanFeedError } from "@/shared/errors";
import type { AggregationResult, ChunkResult } from "@/shared/types";

export function aggregateChunkResults(
  chunks: ChunkResult[],
  highThreshold: number,
): AggregationResult {
  if (chunks.length === 0) {
    throw new CleanFeedError("INSUFFICIENT_EVIDENCE", "INSUFFICIENT_EVIDENCE");
  }

  if (
    !isScore(highThreshold) ||
    chunks.some((chunk) => !isScore(chunk.aiScore))
  ) {
    throw new CleanFeedError("INFERENCE_FAILED", "INFERENCE_FAILED");
  }

  const scores = chunks.map((chunk) => chunk.aiScore);
  const weights = chunks.map((chunk, index) => {
    const length = chunk.endToken - chunk.startToken;
    const previousStartToken = chunks[index - 1]?.startToken;

    return index === 0
      ? length
      : Math.min(length, chunk.startToken - (previousStartToken ?? 0));
  });
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);

  if (totalWeight <= 0) {
    throw new CleanFeedError("INFERENCE_FAILED", "INFERENCE_FAILED");
  }

  const weightedMean =
    scores.reduce(
      (sum, score, index) => sum + score * (weights[index] ?? 0),
      0,
    ) / totalWeight;
  const median = calculateMedian(scores);
  const minimum = Math.min(...scores);
  const maximum = Math.max(...scores);
  const standardDeviation = calculateStandardDeviation(scores);
  const highScoreRatio =
    scores.reduce(
      (sum, score, index) =>
        sum + (score >= highThreshold ? (weights[index] ?? 0) : 0),
      0,
    ) / totalWeight;
  const finalScore = clamp(
    0.5 * weightedMean + 0.25 * median + 0.15 * highScoreRatio + 0.1 * maximum,
  );

  return {
    finalScore,
    weightedMean,
    median,
    maximum,
    minimum,
    standardDeviation,
    highScoreRatio,
    chunkAgreement: clamp(1 - standardDeviation / 0.5),
  };
}

function calculateMedian(scores: number[]): number {
  const sorted = [...scores].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0
    ? ((sorted[middle - 1] ?? 0) + (sorted[middle] ?? 0)) / 2
    : (sorted[middle] ?? 0);
}

function calculateStandardDeviation(scores: number[]): number {
  const mean = scores.reduce((sum, score) => sum + score, 0) / scores.length;
  const variance =
    scores.reduce((sum, score) => sum + (score - mean) ** 2, 0) / scores.length;

  return Math.sqrt(variance);
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function isScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
