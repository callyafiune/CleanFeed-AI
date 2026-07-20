import { normalizeCalibrationLocale } from "@/inference/model-runtime";
import { getTextLengthInfo } from "@/shared/word-count";
import type { LanguageDetectionResult, LanguageMode } from "@/shared/types";

const MAX_LEXICAL_TOKENS = 2_000;
const MINIMUM_LEXICAL_TOKENS = 20;
const MINIMUM_PORTUGUESE_SCORE = 0.35;
const REQUIRED_CONFIDENCE = 0.65;

const PORTUGUESE_STOPWORDS = new Set([
  "a",
  "ao",
  "aos",
  "as",
  "com",
  "como",
  "da",
  "das",
  "de",
  "do",
  "dos",
  "e",
  "ela",
  "ele",
  "em",
  "entre",
  "é",
  "essa",
  "esse",
  "esta",
  "este",
  "eu",
  "mais",
  "mas",
  "na",
  "nas",
  "não",
  "no",
  "nos",
  "o",
  "os",
  "para",
  "pela",
  "pelo",
  "por",
  "que",
  "se",
  "sem",
  "sua",
  "suas",
  "seu",
  "seus",
  "uma",
  "um",
]);

const ENGLISH_STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "between",
  "but",
  "by",
  "can",
  "for",
  "from",
  "has",
  "have",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "their",
  "this",
  "to",
  "when",
  "with",
]);

const SPANISH_STOPWORDS = new Set([
  "a",
  "al",
  "como",
  "con",
  "de",
  "del",
  "el",
  "en",
  "es",
  "esta",
  "este",
  "la",
  "las",
  "lo",
  "los",
  "más",
  "no",
  "para",
  "pero",
  "por",
  "que",
  "se",
  "sin",
  "sus",
  "un",
  "una",
  "y",
]);

const PORTUGUESE_MARKER = /(?:ção|ões|nh|lh)/giu;
const PORTUGUESE_DIACRITIC = /[áàâãéêíóôõúüç]/giu;
const LEXICAL_TOKEN = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;

export interface LanguageDetector {
  detect(text: string): Promise<LanguageDetectionResult>;
}

export interface LanguagePolicyDecision {
  allowed: boolean;
  abstain: boolean;
  reason?: "UNSUPPORTED_LANGUAGE" | "LOW_LANGUAGE_CONFIDENCE";
}

function tokenize(text: string): string[] {
  return (text.match(LEXICAL_TOKEN) ?? [])
    .slice(0, MAX_LEXICAL_TOKENS)
    .map((token) => token.toLocaleLowerCase("pt-BR"));
}

function countMatches(text: string, expression: RegExp): number {
  return text.match(expression)?.length ?? 0;
}

function countStopwords(tokens: string[], stopwords: Set<string>): number {
  return tokens.filter((token) => stopwords.has(token)).length;
}

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function unsupportedLanguage(): LanguageDetectionResult {
  return { language: "und", confidence: 0, supported: false };
}

/**
 * A deterministic and intentionally small Portuguese-language detector. It is
 * not a replacement for a model; it only gates inference before the model is
 * asked to process text.
 */
export class HeuristicPortugueseDetector implements LanguageDetector {
  async detect(text: string): Promise<LanguageDetectionResult> {
    if (getTextLengthInfo(text).wordCount < MINIMUM_LEXICAL_TOKENS) {
      return unsupportedLanguage();
    }

    const tokens = tokenize(text);
    if (tokens.length < MINIMUM_LEXICAL_TOKENS) {
      return unsupportedLanguage();
    }

    const normalizedText = tokens.join(" ");
    const tokenCount = tokens.length;
    const portugueseSignals =
      (countStopwords(tokens, PORTUGUESE_STOPWORDS) / tokenCount) * 2.4 +
      (countMatches(normalizedText, PORTUGUESE_MARKER) / tokenCount) * 0.8 +
      (countMatches(normalizedText, PORTUGUESE_DIACRITIC) / tokenCount) * 0.8;
    const nonPortuguesePenalty =
      (countStopwords(tokens, ENGLISH_STOPWORDS) / tokenCount) * 1.2 +
      (countStopwords(tokens, SPANISH_STOPWORDS) / tokenCount) * 0.8;
    const confidence = clampScore(portugueseSignals - nonPortuguesePenalty);

    if (confidence < MINIMUM_PORTUGUESE_SCORE) {
      return unsupportedLanguage();
    }

    return { language: "pt", confidence, supported: true };
  }
}

function abstain(
  reason: NonNullable<LanguagePolicyDecision["reason"]>,
): LanguagePolicyDecision {
  return { allowed: false, abstain: true, reason };
}

export function evaluateLanguagePolicy(
  detection: LanguageDetectionResult,
  mode: LanguageMode,
  supportedLanguages: string[],
): LanguagePolicyDecision {
  if (mode === "experimental_any") {
    return { allowed: true, abstain: false };
  }

  if (mode === "portuguese_only") {
    // Normalize the detected tag BEFORE deciding support: only `pt`/`pt-BR`
    // resolve to the calibrated pt-BR locale; `pt-PT`, `en` and unknown do not.
    if (normalizeCalibrationLocale(detection.language) === null) {
      return abstain("UNSUPPORTED_LANGUAGE");
    }

    return detection.confidence >= REQUIRED_CONFIDENCE
      ? { allowed: true, abstain: false }
      : abstain("LOW_LANGUAGE_CONFIDENCE");
  }

  if (!supportedLanguages.includes(detection.language)) {
    return abstain("UNSUPPORTED_LANGUAGE");
  }

  return detection.confidence >= REQUIRED_CONFIDENCE
    ? { allowed: true, abstain: false }
    : abstain("LOW_LANGUAGE_CONFIDENCE");
}
