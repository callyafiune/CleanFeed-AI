import {
  getMarkingBand,
  resolveCalibrationProfile,
} from "@/inference/calibration";
import type {
  ClassificationExplanation,
  ClassificationResult,
  DecisionOutcome,
  ReasonCode,
} from "@/shared/types";

export function buildExplanation(
  result: ClassificationResult,
  outcome: DecisionOutcome,
): ClassificationExplanation;
export function buildExplanation(
  result: ClassificationResult,
  possibleOutcome?: DecisionOutcome,
): ClassificationExplanation {
  if (!possibleOutcome) {
    throw new TypeError("buildExplanation requires a ClassificationResult");
  }

  const profile = resolveCalibrationProfile(result);
  const marking = getMarkingBand(result.wordCount);
  const chunksAboveThreshold = result.chunks?.filter(
    (chunk) => chunk.aiScore >= marking,
  ).length;

  return {
    reasonCodes: getEvidenceReasons(result, possibleOutcome),
    ...(result.aggregation
      ? { chunkAgreement: result.aggregation.chunkAgreement }
      : {}),
    ...(chunksAboveThreshold !== undefined ? { chunksAboveThreshold } : {}),
    ...(result.chunks ? { totalChunks: result.chunks.length } : {}),
    modelScore: result.aiScore,
    calibratedScore: possibleOutcome.calibratedScore,
    calibrationProfile: profile.id,
  };
}

function getEvidenceReasons(
  result: ClassificationResult,
  outcome: DecisionOutcome,
): ReasonCode[] {
  const reasonCodes: ReasonCode[] = [];
  const aggregation = result.aggregation;
  const marking = getMarkingBand(result.wordCount);

  if (outcome.abstained) {
    reasonCodes.push("INSUFFICIENT_EVIDENCE");
  }

  if (result.confidence === "low") {
    reasonCodes.push("LOW_MODEL_CONFIDENCE");
  }

  if (!aggregation) {
    return reasonCodes;
  }

  if (aggregation.chunkAgreement < 0.5 || aggregation.stdDev > 0.25) {
    reasonCodes.push("CHUNK_DISAGREEMENT");
  }

  if (aggregation.chunkAgreement >= 0.75) {
    reasonCodes.push("HIGH_CHUNK_CONSISTENCY");
  }

  if (aggregation.highScoreRatio >= 0.5) {
    reasonCodes.push("MOST_CHUNKS_ABOVE_THRESHOLD");
  }

  if (aggregation.weightedMean >= marking) {
    reasonCodes.push("HIGH_AVERAGE_SCORE");
  }

  if (aggregation.median >= marking) {
    reasonCodes.push("HIGH_MEDIAN_SCORE");
  }

  return reasonCodes;
}
