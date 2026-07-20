// The single, shared evidence-quality assessor. The inference worker and the
// manual-analysis path MUST both derive their `EvidenceAssessment` from this
// pure function so they can never drift into competing quality rules. Input
// dominated by links/hashtags/emoji is expressed through the versioned
// `lexicalRatio` (from `computeContentComposition`) — never a second regex.

import { normalizeCalibrationLocale } from "@/inference/model-runtime";
import type {
  DecisionReasonCode,
  EvidenceAssessment,
  EvidenceQuality,
} from "@/shared/types";

/** The closed set of signals an evidence assessment is a pure function of. */
export interface EvidenceInput {
  locale: string;
  wordCount: number;
  coverage: number;
  lexicalRatio: number;
  stdDev: number;
  chunkAgreement: number;
  truncated: boolean;
  exactTokenizer: boolean;
  backendError: boolean;
  artifactMismatch: boolean;
}

const MINIMUM_WORD_COUNT = 50;
const UNSUPPORTED_COVERAGE = 0.5;
const SUFFICIENT_COVERAGE = 0.95;
const UNSUPPORTED_LEXICAL_RATIO = 0.4;
const SUFFICIENT_LEXICAL_RATIO = 0.6;
const MAXIMUM_STD_DEV = 0.25;
const MINIMUM_CHUNK_AGREEMENT = 0.5;

/**
 * The canonical enum order for {@link DecisionReasonCode}. Accumulated reason
 * codes are emitted in this order, without duplicates.
 */
const DECISION_REASON_CODE_ORDER: DecisionReasonCode[] = [
  "HIGH_CHUNK_CONSISTENCY",
  "MOST_CHUNKS_ABOVE_THRESHOLD",
  "HIGH_AVERAGE_SCORE",
  "HIGH_MEDIAN_SCORE",
  "FORMULAIC_STRUCTURE",
  "LOW_SENTENCE_LENGTH_VARIATION",
  "REPETITIVE_TRANSITIONS",
  "LISTICLE_PATTERN",
  "EXCESSIVE_HASHTAGS",
  "CUSTOM_KEYWORD_RULE",
  "INSUFFICIENT_EVIDENCE",
  "LOW_MODEL_CONFIDENCE",
  "CHUNK_DISAGREEMENT",
  "LOCALIZED_SIGNAL",
  "LIMITED_EVIDENCE",
  "UNSUPPORTED_LANGUAGE",
  "TEXT_TOO_SHORT",
  "LOW_COVERAGE",
  "TRUNCATED_INPUT",
  "TOKENIZER_APPROXIMATE",
  "NON_LEXICAL_CONTENT",
  "MODEL_PROFILE_MISSING",
  "MODEL_PROFILE_MISMATCH",
  "PROFILE_EXPIRED",
  "BACKEND_ERROR",
  "ARTIFACT_MISMATCH",
  "DOCUMENT_EVIDENCE_PENDING",
  "CIRCUIT_BREAKER_OPEN",
  "WEBGPU_FALLBACK",
];

/**
 * Assesses evidence quality with a DETERMINISTIC precedence:
 *   1. artifact mismatch, backend error, non-pt-BR locale, < 50 words or an
 *      approximate tokenizer ⇒ `unsupported`;
 *   2. coverage < 0.50 or lexical ratio < 0.40 ⇒ `unsupported`;
 *   3. coverage < 0.95, lexical ratio < 0.60, stdDev > 0.25 or agreement < 0.50
 *      ⇒ `limited`;
 *   4. otherwise ⇒ `sufficient`.
 * `truncated` always contributes `TRUNCATED_INPUT` but, alone, never downgrades
 * an entry that still has coverage >= 0.95.
 */
export function assessEvidence(input: EvidenceInput): EvidenceAssessment {
  const localeSupported = normalizeCalibrationLocale(input.locale) === "pt-BR";
  const reasons = new Set<DecisionReasonCode>();

  if (input.artifactMismatch) reasons.add("ARTIFACT_MISMATCH");
  if (input.backendError) reasons.add("BACKEND_ERROR");
  if (!localeSupported) reasons.add("UNSUPPORTED_LANGUAGE");
  if (input.wordCount < MINIMUM_WORD_COUNT) reasons.add("TEXT_TOO_SHORT");
  if (!input.exactTokenizer) reasons.add("TOKENIZER_APPROXIMATE");
  if (input.coverage < SUFFICIENT_COVERAGE) reasons.add("LOW_COVERAGE");
  if (input.lexicalRatio < SUFFICIENT_LEXICAL_RATIO) {
    reasons.add("NON_LEXICAL_CONTENT");
  }
  if (
    input.stdDev > MAXIMUM_STD_DEV ||
    input.chunkAgreement < MINIMUM_CHUNK_AGREEMENT
  ) {
    reasons.add("CHUNK_DISAGREEMENT");
  }
  if (input.truncated) reasons.add("TRUNCATED_INPUT");

  return {
    quality: assessQuality(input, localeSupported),
    coverage: input.coverage,
    lexicalRatio: input.lexicalRatio,
    truncated: input.truncated,
    exactTokenizer: input.exactTokenizer,
    reasonCodes: orderReasonCodes(reasons),
  };
}

function assessQuality(
  input: EvidenceInput,
  localeSupported: boolean,
): EvidenceQuality {
  if (
    input.artifactMismatch ||
    input.backendError ||
    !localeSupported ||
    input.wordCount < MINIMUM_WORD_COUNT ||
    !input.exactTokenizer
  ) {
    return "unsupported";
  }
  if (
    input.coverage < UNSUPPORTED_COVERAGE ||
    input.lexicalRatio < UNSUPPORTED_LEXICAL_RATIO
  ) {
    return "unsupported";
  }
  if (
    input.coverage < SUFFICIENT_COVERAGE ||
    input.lexicalRatio < SUFFICIENT_LEXICAL_RATIO ||
    input.stdDev > MAXIMUM_STD_DEV ||
    input.chunkAgreement < MINIMUM_CHUNK_AGREEMENT
  ) {
    return "limited";
  }
  return "sufficient";
}

function orderReasonCodes(
  reasons: Set<DecisionReasonCode>,
): DecisionReasonCode[] {
  return DECISION_REASON_CODE_ORDER.filter((code) => reasons.has(code));
}
