import { getTextLengthInfo } from "@/shared/word-count";
import type { EligibilityResult } from "@/shared/types";

const DEFAULT_MINIMUM_WORD_COUNT = 100;
const EXPERIMENTAL_MINIMUM_WORD_COUNT = 50;
const MOSTLY_CONTENT_THRESHOLD = 0.6;
const URL_PATTERN = /^(?:https?:\/\/|www\.)\S+$/iu;
const HASHTAG_PATTERN = /^#[\p{L}\p{N}_]+$/u;
const EMOJI_PATTERN =
  /^\p{Extended_Pictographic}(?:\uFE0F|\u200D\p{Extended_Pictographic})*$/u;
const TITLE_CASE_NAME_PATTERN =
  /^(?:\p{Lu}\p{Ll}*)(?:[ '-](?:\p{Lu}\p{Ll}*))*$/u;
const SENTENCE_PUNCTUATION_PATTERN = /[.!?;:]/u;

export interface EligibilityInput {
  text: string;
  enabled: boolean;
  domainEnabled: boolean;
  modelAvailable: boolean;
  extractionSucceeded: boolean;
  duplicateContent: boolean;
  experimentalShortTextDetection: boolean;
  minimumWordCount?: number;
}

interface ContentComposition {
  meaningfulTokens: number;
  links: number;
  hashtags: number;
  emojis: number;
}

function ineligible(reason: EligibilityResult["reason"]): EligibilityResult {
  return { eligible: false, reason };
}

function getContentComposition(text: string): ContentComposition {
  const composition: ContentComposition = {
    meaningfulTokens: 0,
    links: 0,
    hashtags: 0,
    emojis: 0,
  };

  for (const token of text.match(/\S+/gu) ?? []) {
    if (URL_PATTERN.test(token)) {
      composition.meaningfulTokens += 1;
      composition.links += 1;
    } else if (HASHTAG_PATTERN.test(token)) {
      composition.meaningfulTokens += 1;
      composition.hashtags += 1;
    } else if (EMOJI_PATTERN.test(token)) {
      composition.meaningfulTokens += 1;
      composition.emojis += 1;
    } else if (/[\p{L}\p{N}]/u.test(token)) {
      composition.meaningfulTokens += 1;
    }
  }

  return composition;
}

function isMostly(count: number, total: number): boolean {
  return total > 0 && count / total >= MOSTLY_CONTENT_THRESHOLD;
}

function isNameList(text: string): boolean {
  const lines = text.split(/\r?\n/gu).filter((line) => line.trim().length > 0);

  if (lines.length < 5 || SENTENCE_PUNCTUATION_PATTERN.test(text)) {
    return false;
  }

  const nameLines = lines.filter((line) => {
    const words = line.trim().split(/\s+/u);
    return (
      words.length >= 1 &&
      words.length <= 4 &&
      words.every((word) => TITLE_CASE_NAME_PATTERN.test(word))
    );
  });

  return nameLines.length / lines.length >= 0.8;
}

/**
 * Applies inexpensive, deterministic checks before text reaches a classifier.
 * Callers provide state-derived flags so this function remains pure.
 */
export function evaluateEligibility(
  input: EligibilityInput,
): EligibilityResult {
  if (!input.enabled) {
    return ineligible("EXTENSION_DISABLED");
  }
  if (!input.domainEnabled) {
    return ineligible("DOMAIN_DISABLED");
  }
  if (!input.modelAvailable) {
    return ineligible("MODEL_UNAVAILABLE");
  }
  if (!input.extractionSucceeded) {
    return ineligible("EXTRACTION_FAILED");
  }
  if (input.duplicateContent) {
    return ineligible("DUPLICATE_CONTENT");
  }

  const composition = getContentComposition(input.text);
  if (isMostly(composition.links, composition.meaningfulTokens)) {
    return ineligible("MOSTLY_LINKS");
  }
  if (isMostly(composition.hashtags, composition.meaningfulTokens)) {
    return ineligible("MOSTLY_HASHTAGS");
  }
  if (isMostly(composition.emojis, composition.meaningfulTokens)) {
    return ineligible("MOSTLY_EMOJIS");
  }
  if (isNameList(input.text)) {
    return ineligible("INSUFFICIENT_CONTENT");
  }

  const configuredMinimum =
    input.minimumWordCount ?? DEFAULT_MINIMUM_WORD_COUNT;
  const minimumWordCount = input.experimentalShortTextDetection
    ? Math.min(configuredMinimum, EXPERIMENTAL_MINIMUM_WORD_COUNT)
    : Math.max(configuredMinimum, DEFAULT_MINIMUM_WORD_COUNT);
  if (getTextLengthInfo(input.text).wordCount < minimumWordCount) {
    return ineligible("BELOW_MINIMUM_LENGTH");
  }

  return { eligible: true, reason: "ELIGIBLE" };
}
