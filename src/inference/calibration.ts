import type { ProfileLookup } from "@/inference/calibration-registry";
import {
  applyCalibrator,
  thresholdFires,
  type LengthBucketV1,
  type SerializedCalibratorV1,
} from "../../contracts/calibration-profile";
import type { RolloutState } from "../../contracts/model-release";
import type {
  AggregationResultV2,
  ClassificationResult,
  ClassificationStatus,
  DecisionOutcome,
  DecisionReasonCode,
  DecisionTrigger,
  EvidenceAssessment,
  LengthBucket,
  PresentationMode,
  ReasonCode,
} from "@/shared/types";

/**
 * Internal, hand-tuned decision bands for the UNCALIBRATED builtin heuristic
 * path (mock/stylometric). These are NOT user settings and NOT the scientific
 * calibration profile — they only shape the builtin's own status/reason codes,
 * and the builtin is always capped to the indicator ceiling. The calibrated TMR
 * path ignores them entirely and reads {@link RuntimeCalibrationProfileV1}.
 */
const LENGTH_THRESHOLDS = {
  "50_79": { marking: 0.92, blur: 0.97, actionCeiling: "indicator" },
  "80_99": { marking: 0.88, blur: 0.95, actionCeiling: "blur" },
  "100_149": { marking: 0.8, blur: 0.92, actionCeiling: "blur" },
  "150_299": { marking: 0.8, blur: 0.92, actionCeiling: "hide" },
  "300_PLUS": { marking: 0.8, blur: 0.92, actionCeiling: "hide" },
} as const satisfies Record<
  LengthBucket,
  { marking: number; blur: number; actionCeiling: PresentationMode }
>;

const MINIMUM_CHUNK_AGREEMENT = 0.5;
const MAXIMUM_STANDARD_DEVIATION = 0.25;
const MINIMUM_SCORE_MARGIN = 0.1;

/** The 50-79 word bucket keeps an indicator ceiling on every path (spec §5.5). */
const SHORT_BUCKET_MINIMUM_WORDS = 50;
const SHORT_BUCKET_MAXIMUM_WORDS = 79;

type CalibrationInput = Pick<ClassificationResult, "wordCount" | "language">;

/** Identity of the conservative builtin profile for a result (no thresholds). */
export interface BuiltinProfileLabel {
  id: string;
  platform: string;
  language: string;
  lengthBucket: LengthBucket;
}

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

/** The builtin marking band for a word count (diagnostics/explanation only). */
export function getMarkingBand(wordCount: number): number {
  return LENGTH_THRESHOLDS[getLengthBucket(wordCount)].marking;
}

/** Maps a word count to the contract length bucket used as a profile coordinate. */
export function contractLengthBucket(wordCount: number): LengthBucketV1 {
  if (wordCount < 80) {
    return "50-79";
  }
  return wordCount < 200 ? "80-199" : "200-plus";
}

export function resolveCalibrationProfile(
  result: CalibrationInput,
): BuiltinProfileLabel {
  const lengthBucket = getLengthBucket(result.wordCount);
  const language = result.language ?? "und";
  return {
    id: `default-${language}-${lengthBucket}`,
    platform: "default",
    language,
    lengthBucket,
  };
}

/**
 * The UNCALIBRATED builtin heuristic decision. It abstains conservatively and,
 * when it does present, is always capped to the indicator ceiling by the caller
 * (an uncalibrated model may only indicate). Kept score-based on purpose: it is
 * the transparent stylometric fallback, never a validated detector.
 */
export function calibrateResult(result: ClassificationResult): DecisionOutcome {
  const bucket = getLengthBucket(result.wordCount);
  const marking = LENGTH_THRESHOLDS[bucket].marking;
  const calibratedScore =
    result.aggregation?.documentRawScore ?? result.aiScore;
  const reasonCodes = getEvidenceReasons(result, marking);

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
      presentationAllowed: false,
      triggers: [],
      reasonCodes: uniqueReasonCodes(abstentionReasons),
    };
  }

  return {
    status: getBuiltinStatus(calibratedScore, bucket),
    calibratedScore,
    actionCeiling: LENGTH_THRESHOLDS[bucket].actionCeiling,
    abstained: false,
    presentationAllowed: true,
    triggers: [],
    reasonCodes,
  };
}

/** Wraps the contract's calibrator math; the runtime never re-implements it. */
export function applySerializedCalibrator(
  calibrator: SerializedCalibratorV1,
  score: number,
): number {
  return applyCalibrator(calibrator, score);
}

/**
 * Maps a platform adapter id (e.g. `"linkedin"`) to the platform coordinate of
 * the calibration-profile lookup. v1 policy: the sealed corpus is generic
 * pt-BR, so ONE pool of `"generic"` profiles serves every adapter and this
 * function returns `"generic"` unconditionally. Per-platform profiles remain
 * possible in the future by publishing profiles under other platform values
 * and routing adapter ids here — this function is the single seam to change.
 * Only the CALIBRATION lookup is normalized: the adapter keeps its own id
 * everywhere else (settings, cache keys, explanation labels).
 */
export function normalizeCalibrationPlatform(_adapterId: string): string {
  return "generic";
}

export interface DecideWithProfileInput {
  /** The exact-match lookup from {@link CalibrationRegistry.findExact}. */
  lookup: ProfileLookup;
  aggregation: AggregationResultV2;
  evidence: EvidenceAssessment;
  rolloutState: RolloutState;
  wordCount: number;
}

/** The audit digest and cache-validity bound of a profile that was applied. */
export interface AppliedProfile {
  /** Digest of the profile used for THIS request only — never a global. */
  profileDigest: string;
  /** The profile's expiry; upper-bounds the cached record's TTL. */
  expiresAt: string;
}

/**
 * The calibrated decision plus, ONLY when an exact/in-release/unexpired profile
 * was actually applied, that profile's audit identity. `appliedProfile` is
 * deliberately absent for every abstention — unsupported evidence or a
 * missing/expired/incompatible profile — so the caller emits
 * `selectedProfileDigest`/`cacheValidUntil` if and only if a verdict truly rode
 * on a profile.
 */
export interface ProfileDecision {
  outcome: DecisionOutcome;
  appliedProfile?: AppliedProfile;
}

/**
 * The authoritative calibrated (TMR) decision policy. It applies the exact
 * profile, never a heuristic, and follows a fixed order:
 *   1. unsupported evidence            → abstain, no presentation;
 *   2. missing/expired/incompatible    → TMR abstains with a specific reason;
 *   3. calibrate document + localized separately;
 *   4. triggers in canonical order (document, then localized);
 *   5. calibratedScore = max over triggers, else the document calibrated score;
 *   6. no trigger                      → no presentation;
 *   7. localized-only / limited / 50-79 words → indicator ceiling;
 *   8. hide requires a document action, sufficient evidence, a pass profile and
 *      an actions rollout;
 *   9. bundle-verified/shadow never present; indicator rollout caps at indicator.
 */
export function decideWithProfile(
  input: DecideWithProfileInput,
): ProfileDecision {
  const { lookup, aggregation, evidence, rolloutState, wordCount } = input;

  // (1) Unsupported evidence abstains regardless of score. No profile is
  // applied here even if one was found, so no audit digest is emitted.
  if (evidence.quality === "unsupported") {
    return {
      outcome: abstain(["INSUFFICIENT_EVIDENCE", ...evidence.reasonCodes]),
    };
  }

  // (2) No exact, in-release, unexpired profile: the TMR abstains fail-closed.
  if (lookup.status !== "found") {
    return { outcome: abstain([lookup.reason]) };
  }

  const { profile } = lookup;
  // From here the exact profile is genuinely applied, so its audit digest and
  // expiry ride with every outcome this function returns below.
  const appliedProfile: AppliedProfile = {
    profileDigest: profile.profileDigest,
    expiresAt: profile.expiresAt,
  };

  // (3) Calibrate the two signals independently — never blended.
  const documentScore = applyCalibrator(
    profile.calibrators.document,
    aggregation.documentRawScore,
  );
  const localizedScore = applyCalibrator(
    profile.calibrators.localized,
    aggregation.localizedRawScore,
  );

  // (4) Canonical trigger order: document before localized. Through
  // `thresholdFires`, because a threshold of 1 is the contract's DISABLED encoding and
  // a bare `>=` fires on a saturated score: the v1 serves a document cut and no
  // localized cut, and a localized trigger it raised would be an accusation over a path
  // whose false-positive rate the release never estimated.
  const triggers: DecisionTrigger[] = [];
  if (thresholdFires(documentScore, profile.thresholds.documentIndicator)) {
    triggers.push("document");
  }
  if (thresholdFires(localizedScore, profile.thresholds.localizedIndicator)) {
    triggers.push("localized");
  }

  const documentTrigger = triggers.includes("document");
  const localizedTrigger = triggers.includes("localized");

  // (5) calibratedScore = max over the fired triggers, else document.
  const triggeredScores: number[] = [];
  if (documentTrigger) triggeredScores.push(documentScore);
  if (localizedTrigger) triggeredScores.push(localizedScore);
  const calibratedScore =
    triggeredScores.length > 0 ? Math.max(...triggeredScores) : documentScore;

  // (6) No trigger fired: not AI-indicated, so nothing is presented. The
  // profile was still applied, so its audit digest and expiry still ride along.
  if (triggers.length === 0) {
    return {
      outcome: {
        status: "probably_human",
        calibratedScore,
        actionCeiling: "indicator",
        abstained: false,
        presentationAllowed: false,
        triggers: [],
        reasonCodes: [],
      },
      appliedProfile,
    };
  }

  // (7)/(8) Determine the action ceiling.
  const shortBucket =
    wordCount >= SHORT_BUCKET_MINIMUM_WORDS &&
    wordCount <= SHORT_BUCKET_MAXIMUM_WORDS;
  const localizedOnly = triggers.length === 1 && localizedTrigger;
  const forceIndicator =
    localizedOnly || evidence.quality !== "sufficient" || shortBucket;

  const actionAuthorized =
    !forceIndicator &&
    documentTrigger &&
    thresholdFires(documentScore, profile.thresholds.documentAction) &&
    evidence.quality === "sufficient" &&
    profile.gateEvidence.decision === "pass" &&
    profile.actionCeiling === "hide" &&
    rolloutState === "actions";
  const actionCeiling: PresentationMode = actionAuthorized
    ? "hide"
    : "indicator";

  // (9) Rollout gates presentation. Only indicator/actions ever present; a
  // bundle-verified or shadow release never shows a TMR result.
  const presentationAllowed =
    rolloutState === "indicator" || rolloutState === "actions";

  const reasonCodes: DecisionReasonCode[] = [];
  if (localizedTrigger) reasonCodes.push("LOCALIZED_SIGNAL");
  if (evidence.quality === "limited") reasonCodes.push("LIMITED_EVIDENCE");

  return {
    outcome: {
      status: actionCeiling === "hide" ? "strong_ai_indication" : "possibly_ai",
      calibratedScore,
      actionCeiling,
      abstained: false,
      presentationAllowed,
      triggers,
      reasonCodes,
    },
    appliedProfile,
  };
}

function abstain(reasonCodes: DecisionReasonCode[]): DecisionOutcome {
  return {
    status: "insufficient_evidence",
    calibratedScore: 0,
    actionCeiling: "indicator",
    abstained: true,
    presentationAllowed: false,
    triggers: [],
    reasonCodes: [...new Set(reasonCodes)],
  };
}

function getEvidenceReasons(
  result: ClassificationResult,
  marking: number,
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
  if (aggregation.weightedMean >= marking) {
    reasonCodes.push("HIGH_AVERAGE_SCORE");
  }
  if (aggregation.median >= marking) {
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
      aggregation.stdDev > MAXIMUM_STANDARD_DEVIATION)
  );
}

function isDemoMock(result: ClassificationResult): boolean {
  return result.backend === "mock" && result.demo;
}

function getBuiltinStatus(
  calibratedScore: number,
  bucket: LengthBucket,
): ClassificationStatus {
  const { marking, blur } = LENGTH_THRESHOLDS[bucket];
  if (calibratedScore >= blur) {
    return "strong_ai_indication";
  }
  return calibratedScore >= marking ? "possibly_ai" : "probably_human";
}

function uniqueReasonCodes(reasonCodes: ReasonCode[]): ReasonCode[] {
  return [...new Set(reasonCodes)];
}

function isScore(value: number): boolean {
  return Number.isFinite(value) && value >= 0 && value <= 1;
}
