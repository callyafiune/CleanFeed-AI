import {
  buildBuiltinDecision,
  buildBuiltinEvidence,
  buildBuiltinIdentity,
} from "@/inference/builtin-runtime";
import { statusFromScore } from "@/inference/mock-classifier";
import {
  extractStylometricFeatures,
  getStylometricReasonCodes,
  type StylometricContributions,
} from "@/inference/stylometry";
import { CleanFeedError } from "@/shared/errors";
import { normalizeText } from "@/shared/text-normalization";
import { getTextLengthInfo } from "@/shared/word-count";
import type {
  ClassificationOptions,
  ClassificationResult,
  ClassifierMetadata,
  TextClassifier,
} from "@/shared/types";

/**
 * Transparent weights of the heuristic score. The base is the score of a text
 * with no signals; each contribution (already in [0, 1]) adds its weight. The
 * numbers are hand-chosen and documented, not learned or calibrated — which is
 * exactly why this classifier stays uncalibrated, low-confidence and capped to
 * the indicator action ceiling.
 *
 * The discourse-connective transition signal carries the largest weight on
 * purpose: repeated sentence-initial connectives over uniform full prose are
 * the least human-ambiguous of these signals, whereas the three structural
 * signals below overlap heavily with human layout habits and are jointly
 * capped (see {@link STRUCTURAL_CONTRIBUTION_CAP}).
 */
export const STYLOMETRIC_WEIGHTS = {
  base: 0.18,
  repetitiveTransitions: 0.32,
  formulaicStructure: 0.26,
  lowSentenceLengthVariation: 0.22,
  listiclePattern: 0.16,
  excessiveHashtags: 0.08,
  lowLexicalDiversity: 0.05,
} as const;

/**
 * Combined ceiling for the three STRUCTURAL signals (formulaic cadence,
 * listicle shape, uniform sentence lengths). They triple-count a single
 * shape — the line-broken "broetry" motivational post that humans dominated
 * on LinkedIn long before LLMs — so their sum is capped: one structural shape
 * can never carry a text past the 0.8 marking threshold by itself. Marking
 * additionally requires the transition signal (and, marginally, hashtag or
 * lexical evidence), which broetry does not exhibit.
 */
export const STRUCTURAL_CONTRIBUTION_CAP = 0.3;

/** The score never claims certainty in either direction. */
const MINIMUM_SCORE = 0.05;
const MAXIMUM_SCORE = 0.95;

const metadata: ClassifierMetadata = {
  id: "stylometric-v1",
  name: "Stylometric heuristic (uncalibrated indicator)",
  version: "1.0.0",
  backend: "mock",
  supportedLanguages: ["pt"],
  maximumTokens: 256,
  supportsBatching: false,
};

/**
 * Cache identity ("id:version") of the results this classifier produces. The
 * background classification cache must key entries by the model that made
 * them, so this constant is derived from the metadata instead of being
 * hardcoded at the call site.
 */
export const STYLOMETRIC_MODEL_KEY = `${metadata.id}:${metadata.version}`;

/**
 * A transparent stylometric HEURISTIC, not a validated detector. It computes
 * explainable text statistics (sentence-length variation, repeated
 * transitions, listicle shape, hashtag density, lexical diversity) and folds
 * them into a weighted score. Its output is probabilistic style evidence
 * only: it must never be presented as proof that a person or an AI wrote a
 * text, its confidence is always "low", and — being uncalibrated — the
 * pipeline's registry-aware calibration (`calibrateWithRegistry`) caps every
 * decision it produces at the conservative indicator-only action ceiling.
 */
export class StylometricClassifier implements TextClassifier {
  private initialized = false;

  async initialize(): Promise<void> {
    this.initialized = true;
  }

  async classify(
    text: string,
    options: ClassificationOptions = {},
  ): Promise<ClassificationResult> {
    const startedAt = performance.now();
    if (options.signal?.aborted) {
      throw new DOMException("The classification was aborted.", "AbortError");
    }
    if (!this.initialized) {
      throw new CleanFeedError(
        "INFERENCE_FAILED",
        "Stylometric classifier must be initialized before classification.",
      );
    }

    const normalizedText = normalizeText(text);
    const features = extractStylometricFeatures(normalizedText);
    const aiScore = scoreFromContributions(features.contributions);
    const reasonCodes = getStylometricReasonCodes(features);
    const length = getTextLengthInfo(normalizedText);
    const status = statusFromScore(aiScore);

    return {
      aiScore,
      humanScore: 1 - aiScore,
      // Heuristic style evidence never earns more than low confidence.
      confidence: "low",
      status,
      wordCount: length.wordCount,
      tokenCount: length.wordCount,
      ...(options.language === undefined ? {} : { language: options.language }),
      runtimeIdentity: buildBuiltinIdentity(metadata),
      evidence: buildBuiltinEvidence(normalizedText),
      decision: buildBuiltinDecision({ status, calibratedScore: aiScore }),
      // The computed signal codes travel with the result so the pipeline can
      // surface them; it must never invent stylistic reasons on its own.
      explanation: {
        reasonCodes,
        modelScore: aiScore,
        calibratedScore: aiScore,
        calibrationProfile: "stylometric-v1:uncalibrated",
      },
      modelVersion: metadata.version,
      modelId: metadata.id,
      backend: metadata.backend,
      processingTimeMs: performance.now() - startedAt,
      // Still demonstration-grade: no validated model is in use.
      demo: true,
    };
  }

  async dispose(): Promise<void> {
    this.initialized = false;
  }

  getMetadata(): ClassifierMetadata {
    return {
      ...metadata,
      supportedLanguages: [...metadata.supportedLanguages],
    };
  }
}

function scoreFromContributions(
  contributions: StylometricContributions,
): number {
  const structural = Math.min(
    STRUCTURAL_CONTRIBUTION_CAP,
    STYLOMETRIC_WEIGHTS.formulaicStructure * contributions.formulaicStructure +
      STYLOMETRIC_WEIGHTS.lowSentenceLengthVariation *
        contributions.lowSentenceLengthVariation +
      STYLOMETRIC_WEIGHTS.listiclePattern * contributions.listiclePattern,
  );
  const weighted =
    STYLOMETRIC_WEIGHTS.base +
    STYLOMETRIC_WEIGHTS.repetitiveTransitions *
      contributions.repetitiveTransitions +
    structural +
    STYLOMETRIC_WEIGHTS.excessiveHashtags * contributions.excessiveHashtags +
    STYLOMETRIC_WEIGHTS.lowLexicalDiversity * contributions.lowLexicalDiversity;
  return Math.min(MAXIMUM_SCORE, Math.max(MINIMUM_SCORE, weighted));
}
