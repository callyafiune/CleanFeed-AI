import type {
  CalibrationQuery,
  CalibrationRegistry,
} from "@/inference/calibration-registry";
import type {
  CalibrationProfile,
  ClassificationResult,
  ClassificationStatus,
  DecisionOutcome,
  LengthBucket,
  PresentationMode,
  ReasonCode,
} from "@/shared/types";

const LENGTH_THRESHOLDS = {
  "50_79": {
    marking: 0.92,
    blur: 0.97,
    collapse: 1,
    hide: 1,
    actionCeiling: "indicator",
  },
  "80_99": {
    marking: 0.88,
    blur: 0.95,
    collapse: 1,
    hide: 1,
    actionCeiling: "blur",
  },
  "100_149": {
    marking: 0.8,
    blur: 0.92,
    collapse: 1,
    hide: 1,
    actionCeiling: "blur",
  },
  "150_299": {
    marking: 0.8,
    blur: 0.92,
    collapse: 0.96,
    hide: 0.99,
    actionCeiling: "hide",
  },
  "300_PLUS": {
    marking: 0.8,
    blur: 0.92,
    collapse: 0.96,
    hide: 0.99,
    actionCeiling: "hide",
  },
} as const satisfies Record<
  LengthBucket,
  {
    marking: number;
    blur: number;
    collapse: number;
    hide: number;
    actionCeiling: PresentationMode;
  }
>;

const MINIMUM_CHUNK_AGREEMENT = 0.5;
const MAXIMUM_STANDARD_DEVIATION = 0.25;
const MINIMUM_SCORE_MARGIN = 0.1;

type CalibrationInput = Pick<ClassificationResult, "wordCount" | "language">;

export function getLengthBucket(wordCount: number): LengthBucket {
  if (wordCount < 80) {
    return "50_79";
  }

  if (wordCount < 100) {
    return "80_99";
  }

  if (wordCount < 150) {
    return "100_149";
  }

  return wordCount < 300 ? "150_299" : "300_PLUS";
}

export function resolveCalibrationProfile(
  result: CalibrationInput,
): CalibrationProfile {
  const lengthBucket = getLengthBucket(result.wordCount);
  const thresholds = LENGTH_THRESHOLDS[lengthBucket];
  const language = result.language ?? "und";

  return {
    id: `default-${language}-${lengthBucket}`,
    platform: "default",
    language,
    lengthBucket,
    markingThreshold: thresholds.marking,
    blurThreshold: thresholds.blur,
    collapseThreshold: thresholds.collapse,
    hideThreshold: thresholds.hide,
  };
}

export function calibrateResult(result: ClassificationResult): DecisionOutcome {
  const profile = resolveCalibrationProfile(result);
  const calibratedScore = result.aggregation?.finalScore ?? result.aiScore;
  const reasonCodes = getEvidenceReasons(result, profile);

  if (mustAbstain(result, calibratedScore)) {
    const abstentionReasons: ReasonCode[] = [
      "INSUFFICIENT_EVIDENCE",
      ...reasonCodes,
    ];

    if (result.confidence === "low") {
      abstentionReasons.push("LOW_MODEL_CONFIDENCE");
    }

    if (hasChunkDisagreement(result)) {
      abstentionReasons.push("CHUNK_DISAGREEMENT");
    }

    return {
      status: "insufficient_evidence",
      calibratedScore: isScore(calibratedScore) ? calibratedScore : 0,
      actionCeiling: "indicator",
      abstained: true,
      // An abstention is not presented; the distributed trigger set is empty
      // until the aggregation-v2 work lands.
      presentationAllowed: false,
      triggers: [],
      reasonCodes: uniqueReasonCodes(abstentionReasons),
    };
  }

  return {
    status: getStatus(calibratedScore, profile),
    calibratedScore,
    actionCeiling: getActionCeiling(profile.lengthBucket),
    abstained: false,
    // A non-abstained decision is presentable at its ceiling (mirrors the
    // pre-migration behaviour); trigger attribution is a later task.
    presentationAllowed: true,
    triggers: [],
    reasonCodes,
  };
}

export interface RegistryCalibrationOptions {
  platform?: string;
}

/**
 * Additive, registry-aware wrapper around {@link calibrateResult}. The base
 * decision is computed exactly as before; the registry only decides whether a
 * classifier has earned the right to act beyond an indicator. Any classifier
 * without a benchmark-verified calibration for its exact coordinates —
 * including the demo mock and the stylometric heuristic, which can never be
 * registered because the registry refuses uncalibrated profiles — keeps its
 * score/status but is capped to `actionCeiling: "indicator"` so it can never
 * blur, collapse, or hide a post. This is the documented honesty invariant:
 * an uncalibrated model may only indicate.
 */
export function calibrateWithRegistry(
  result: ClassificationResult,
  registry: CalibrationRegistry,
  options: RegistryCalibrationOptions = {},
): DecisionOutcome {
  const outcome = calibrateResult(result);

  const query: CalibrationQuery = {
    modelId: result.modelId,
    modelVersion: result.modelVersion,
    platform: options.platform ?? "default",
    language: result.language ?? "und",
    lengthBucket: getLengthBucket(result.wordCount),
  };

  if (registry.get(query).calibrated) {
    return outcome;
  }

  return outcome.actionCeiling === "indicator"
    ? outcome
    : { ...outcome, actionCeiling: "indicator" };
}

function getEvidenceReasons(
  result: ClassificationResult,
  profile: CalibrationProfile,
): ReasonCode[] {
  const aggregation = result.aggregation;

  if (!aggregation) {
    return [];
  }

  const reasonCodes: ReasonCode[] = [];

  if (aggregation.chunkAgreement >= 0.75) {
    reasonCodes.push("HIGH_CHUNK_CONSISTENCY");
  }

  if (aggregation.highScoreRatio >= 0.5) {
    reasonCodes.push("MOST_CHUNKS_ABOVE_THRESHOLD");
  }

  if (aggregation.weightedMean >= profile.markingThreshold) {
    reasonCodes.push("HIGH_AVERAGE_SCORE");
  }

  if (aggregation.median >= profile.markingThreshold) {
    reasonCodes.push("HIGH_MEDIAN_SCORE");
  }

  if (hasChunkDisagreement(result)) {
    reasonCodes.push("CHUNK_DISAGREEMENT");
  }

  return uniqueReasonCodes(reasonCodes);
}

function mustAbstain(
  result: ClassificationResult,
  calibratedScore: number,
): boolean {
  return (
    result.language !== "pt" ||
    result.errorCode !== undefined ||
    !isScore(calibratedScore) ||
    !isScore(result.humanScore) ||
    hasChunkDisagreement(result) ||
    Math.abs(result.aiScore - result.humanScore) < MINIMUM_SCORE_MARGIN ||
    (result.confidence === "low" && !isDemoMock(result))
  );
}

function hasChunkDisagreement(result: ClassificationResult): boolean {
  const aggregation = result.aggregation;

  return (
    aggregation !== undefined &&
    (aggregation.chunkAgreement < MINIMUM_CHUNK_AGREEMENT ||
      aggregation.standardDeviation > MAXIMUM_STANDARD_DEVIATION)
  );
}

function isDemoMock(result: ClassificationResult): boolean {
  return result.backend === "mock" && result.demo;
}

function getStatus(
  calibratedScore: number,
  profile: CalibrationProfile,
): ClassificationStatus {
  if (calibratedScore >= profile.blurThreshold) {
    return "strong_ai_indication";
  }

  return calibratedScore >= profile.markingThreshold
    ? "possibly_ai"
    : "probably_human";
}

function getActionCeiling(lengthBucket: LengthBucket): PresentationMode {
  return LENGTH_THRESHOLDS[lengthBucket].actionCeiling;
}

function uniqueReasonCodes(reasonCodes: ReasonCode[]): ReasonCode[] {
  return [...new Set(reasonCodes)];
}

function isScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
