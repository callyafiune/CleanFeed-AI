import { resolveCalibrationProfile } from "@/inference/calibration";
import type {
  ClassificationExplanation,
  ClassificationResult,
  DecisionOutcome,
} from "@/shared/types";

export function buildExplanation(
  outcome: DecisionOutcome,
): ClassificationExplanation;
export function buildExplanation(
  result: ClassificationResult,
  outcome: DecisionOutcome,
): ClassificationExplanation;
export function buildExplanation(
  resultOrOutcome: ClassificationResult | DecisionOutcome,
  possibleOutcome?: DecisionOutcome,
): ClassificationExplanation {
  const result = possibleOutcome
    ? (resultOrOutcome as ClassificationResult)
    : undefined;
  const outcome = possibleOutcome ?? (resultOrOutcome as DecisionOutcome);
  const profile = result ? resolveCalibrationProfile(result) : undefined;
  const chunksAboveThreshold = result?.chunks?.filter(
    (chunk) => chunk.aiScore >= (profile?.markingThreshold ?? 1),
  ).length;

  return {
    reasonCodes: outcome.reasonCodes,
    ...(result?.aggregation
      ? { chunkAgreement: result.aggregation.chunkAgreement }
      : {}),
    ...(chunksAboveThreshold !== undefined ? { chunksAboveThreshold } : {}),
    ...(result?.chunks ? { totalChunks: result.chunks.length } : {}),
    modelScore: result?.aiScore ?? outcome.calibratedScore,
    calibratedScore: outcome.calibratedScore,
    calibrationProfile: profile?.id ?? "decision-outcome",
  };
}
