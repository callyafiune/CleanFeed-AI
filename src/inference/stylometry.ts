import { normalizeText } from "@/shared/text-normalization";
import type { ReasonCode } from "@/shared/types";

/**
 * Transparent stylometric feature extraction. Every signal here is a plain,
 * deterministic text statistic — sentence-length variation, repeated
 * discourse connectives, listicle shape, hashtag density, lexical diversity.
 * The signals are stylistic INDICATORS, never evidence of authorship: a
 * person can write formulaically and a language model can write bursty prose.
 * All scans are linear: edge punctuation is trimmed with a manual two-pointer
 * loop, and the only regexes are single-character classes or start-anchored
 * character-class runs, which cannot backtrack. The input is already
 * length-capped upstream.
 */

/** Per-feature signal strengths, each normalized into [0, 1]. */
export interface StylometricContributions {
  lowSentenceLengthVariation: number;
  repetitiveTransitions: number;
  formulaicStructure: number;
  listiclePattern: number;
  excessiveHashtags: number;
  /** Score-only signal: no dedicated reason code exists for it. */
  lowLexicalDiversity: number;
}

export interface SentenceStatistics {
  sentenceCount: number;
  meanWordsPerSentence: number;
  /** Standard deviation over mean of words per sentence; 0 when undefined. */
  lengthCoefficientOfVariation: number;
}

export interface StylometricFeatures {
  wordCount: number;
  sentence: SentenceStatistics;
  /** Sentences starting with a known discourse connective. */
  connectiveSentenceStarts: number;
  /** Extra occurrences of any repeated sentence-opening word bigram. */
  repeatedOpeningBigrams: number;
  /**
   * Punctuation-terminated sentences of at most
   * {@link FRAGMENT_MAXIMUM_WORDS} words that continue on the same line.
   * Short standalone lines are deliberately excluded: that shape is a human
   * layout habit ("broetry") measured only by the listicle signal.
   */
  fragmentSentences: number;
  /** Sentences terminated by a question mark. */
  questionSentences: number;
  /** Em/en dashes, colons and ellipsis runs across the text. */
  cadenceMarks: number;
  lineCount: number;
  /** Lines opening with a bullet or an enumeration such as "1." or "2)". */
  bulletLines: number;
  /** Lines with at most {@link SHORT_LINE_MAXIMUM_WORDS} words. */
  shortLines: number;
  hashtagCount: number;
  /** Unique lowercased words over total words; 0 for empty text. */
  typeTokenRatio: number;
  contributions: StylometricContributions;
}

/** A contribution at or above this threshold surfaces its reason code. */
export const STYLOMETRIC_REASON_THRESHOLD = 0.5;

// Guards and reference points for the normalized contributions. These are
// hand-chosen heuristics, not calibrated statistics; they only shape how raw
// counts map into [0, 1].
const MINIMUM_SENTENCES_FOR_VARIATION = 5;
const VARIATION_REFERENCE_CV = 0.5;
const TRANSITION_REFERENCE_RATIO = 0.2;
const MINIMUM_TRANSITION_EVENTS = 2;
/**
 * A repeated sentence-opening bigram is deliberate human anaphora far more
 * often than templating ("Não é sobre X. / Não é sobre Y."), so it enters the
 * transition signal at a small fraction of a discourse-connective opener's
 * weight instead of counting as a full event.
 */
const ANAPHORA_EVENT_WEIGHT = 0.15;
const MINIMUM_SENTENCES_FOR_STRUCTURE = 6;
const FRAGMENT_MAXIMUM_WORDS = 4;
const FRAGMENT_WEIGHT = 3;
const QUESTION_WEIGHT = 2;
const CADENCE_WEIGHT = 1;
const MINIMUM_BULLET_LINES = 3;
const BULLET_REFERENCE_COUNT = 5;
const MINIMUM_LINES_FOR_SHORT_RATIO = 6;
const SHORT_LINE_MAXIMUM_WORDS = 12;
const SHORT_LINE_RATIO_THRESHOLD = 0.75;
const SHORT_LINE_SIGNAL = 0.8;
const MINIMUM_HASHTAGS = 3;
const HASHTAG_REFERENCE_COUNT = 8;
const HASHTAG_REFERENCE_RATIO = 0.12;
const MINIMUM_WORDS_FOR_LEXICAL = 40;
const LEXICAL_REFERENCE_TTR = 0.55;
const LEXICAL_REFERENCE_RANGE = 0.25;

/**
 * Sentence-initial discourse connectives whose repetition is a common trait
 * of templated writing (tuned for pt-BR, with an English fallback list).
 */
const SENTENCE_CONNECTIVES = [
  // Portuguese
  "além disso",
  "alem disso",
  "no entanto",
  "por fim",
  "em resumo",
  "em suma",
  "portanto",
  "afinal",
  "então",
  "entao",
  "e então",
  "e entao",
  "meu palpite",
  "minha teoria",
  "ou seja",
  "dessa forma",
  "desse modo",
  "por outro lado",
  "em primeiro lugar",
  "primeiramente",
  "a verdade é que",
  "a verdade e que",
  // English fallback
  "furthermore",
  "moreover",
  "however",
  "in addition",
  "additionally",
  "in conclusion",
  "in summary",
  "in short",
  "finally",
  "ultimately",
  "that said",
  "my guess",
  "my theory",
  "here's the thing",
  "the truth is",
] as const;

const BULLET_PREFIXES = [
  "-",
  "–",
  "—",
  "*",
  "•",
  "‣",
  "▪",
  "◦",
  "→",
  "➡",
  "✅",
  "✔",
  "✓",
  "👉",
  "🔹",
  "🔸",
  "💡",
  "🚀",
] as const;

const SENTENCE_TERMINATORS = new Set([".", "!", "?", "…"]);
const WORD_CHARACTER = /[\p{L}\p{N}]/u;
// Start-anchored character-class run: linear, cannot backtrack. (An
// end-anchored variant would be O(n²) on interior punctuation runs, which is
// why coreOf trims edges with a manual loop instead of a regex.)
const LEADING_PUNCTUATION = /^[^\p{L}\p{N}]+/u;

const REASON_BY_FEATURE: readonly [
  keyof StylometricContributions,
  ReasonCode,
][] = [
  ["formulaicStructure", "FORMULAIC_STRUCTURE"],
  ["lowSentenceLengthVariation", "LOW_SENTENCE_LENGTH_VARIATION"],
  ["repetitiveTransitions", "REPETITIVE_TRANSITIONS"],
  ["listiclePattern", "LISTICLE_PATTERN"],
  ["excessiveHashtags", "EXCESSIVE_HASHTAGS"],
];

/** Computes all stylometric signals for a text. Pure and deterministic. */
export function extractStylometricFeatures(text: string): StylometricFeatures {
  const normalized = normalizeText(text);
  const tokens = tokensOf(normalized);
  const words = tokens.map(coreOf).filter((word) => word.length > 0);
  const hashtagCount = tokens.filter(isHashtag).length;
  const sentences = splitSentences(normalized);
  const sentenceWordCounts = sentences.map(
    (sentence) => wordTokensOf(sentence.text).length,
  );
  const lines = normalized
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const sentence = sentenceStatistics(sentenceWordCounts);
  const connectiveSentenceStarts = sentences.filter((entry) =>
    startsWithConnective(entry.text),
  ).length;
  const repeatedOpeningBigrams = countRepeatedOpeningBigrams(sentences);
  // A fragment only counts inside flowing prose: it must be closed by real
  // punctuation and the same line must continue after it. A short line of its
  // own (line break in the terminator run, or the final sentence of the text)
  // is the human "broetry"/listicle layout, measured solely by listiclePattern.
  const fragmentSentences = sentences.filter(
    (entry, index) =>
      index < sentences.length - 1 &&
      sentenceWordCounts[index]! > 0 &&
      sentenceWordCounts[index]! <= FRAGMENT_MAXIMUM_WORDS &&
      isProseFragmentTerminator(entry.terminator),
  ).length;
  const questionSentences = sentences.filter((entry) =>
    entry.terminator.includes("?"),
  ).length;
  const cadenceMarks = countCadenceMarks(normalized);
  const bulletLines = lines.filter(isBulletLine).length;
  const shortLines = lines.filter(
    (line) => wordTokensOf(line).length <= SHORT_LINE_MAXIMUM_WORDS,
  ).length;
  const typeTokenRatio =
    words.length === 0 ? 0 : new Set(words).size / words.length;

  const contributions = computeContributions({
    sentence,
    connectiveSentenceStarts,
    repeatedOpeningBigrams,
    fragmentSentences,
    questionSentences,
    cadenceMarks,
    lineCount: lines.length,
    bulletLines,
    shortLines,
    hashtagCount,
    wordCount: words.length,
    typeTokenRatio,
  });

  return {
    wordCount: words.length,
    sentence,
    connectiveSentenceStarts,
    repeatedOpeningBigrams,
    fragmentSentences,
    questionSentences,
    cadenceMarks,
    lineCount: lines.length,
    bulletLines,
    shortLines,
    hashtagCount,
    typeTokenRatio,
    contributions,
  };
}

/** The reason codes whose contributions crossed the surfacing threshold. */
export function getStylometricReasonCodes(
  features: StylometricFeatures,
): ReasonCode[] {
  return REASON_BY_FEATURE.filter(
    ([feature]) =>
      features.contributions[feature] >= STYLOMETRIC_REASON_THRESHOLD,
  ).map(([, code]) => code);
}

interface ContributionInput {
  sentence: SentenceStatistics;
  connectiveSentenceStarts: number;
  repeatedOpeningBigrams: number;
  fragmentSentences: number;
  questionSentences: number;
  cadenceMarks: number;
  lineCount: number;
  bulletLines: number;
  shortLines: number;
  hashtagCount: number;
  wordCount: number;
  typeTokenRatio: number;
}

function computeContributions(
  input: ContributionInput,
): StylometricContributions {
  const { sentenceCount, lengthCoefficientOfVariation } = input.sentence;

  // Uniform sentence lengths (low coefficient of variation) are typical of
  // templated prose. Tiny texts are guarded: variation is meaningless there.
  const lowSentenceLengthVariation =
    sentenceCount >= MINIMUM_SENTENCES_FOR_VARIATION
      ? clamp01(1 - lengthCoefficientOfVariation / VARIATION_REFERENCE_CV)
      : 0;

  // Sentences repeatedly opened by discourse connectives or by the same word
  // bigram. A single occurrence is normal writing, so the signal is zero
  // until at least MINIMUM_TRANSITION_EVENTS distinct events exist — a hard
  // gate, because in short texts a multiplicative damping factor of 0.5 used
  // to land exactly on the reason-code threshold and surfaced "repetition"
  // for one ubiquitous opener. Anaphora (repeated bigrams) is scaled down:
  // it is a human rhetorical device far more often than templating.
  const rawTransitionEvents =
    input.connectiveSentenceStarts + input.repeatedOpeningBigrams;
  const weightedTransitionEvents =
    input.connectiveSentenceStarts +
    ANAPHORA_EVENT_WEIGHT * input.repeatedOpeningBigrams;
  const repetitiveTransitions =
    sentenceCount === 0 || rawTransitionEvents < MINIMUM_TRANSITION_EVENTS
      ? 0
      : clamp01(
          weightedTransitionEvents / sentenceCount / TRANSITION_REFERENCE_RATIO,
        );

  // Dramatic fragment cadence, rhetorical questions and dash/colon/ellipsis
  // punctuation rhythm. Only measured once there is enough structure.
  const formulaicStructure =
    sentenceCount >= MINIMUM_SENTENCES_FOR_STRUCTURE
      ? clamp01(
          (FRAGMENT_WEIGHT * input.fragmentSentences +
            QUESTION_WEIGHT * input.questionSentences +
            CADENCE_WEIGHT * input.cadenceMarks) /
            sentenceCount,
        )
      : 0;

  // Bullet/enumeration lines, or a long run of very short single-line
  // paragraphs, betray a listicle skeleton.
  const bulletSignal =
    input.bulletLines >= MINIMUM_BULLET_LINES
      ? Math.min(1, input.bulletLines / BULLET_REFERENCE_COUNT)
      : 0;
  const shortLineRatio =
    input.lineCount >= MINIMUM_LINES_FOR_SHORT_RATIO
      ? input.shortLines / input.lineCount
      : 0;
  const listiclePattern = Math.max(
    bulletSignal,
    shortLineRatio >= SHORT_LINE_RATIO_THRESHOLD ? SHORT_LINE_SIGNAL : 0,
  );

  // Hashtag stuffing relative to the amount of actual prose.
  const excessiveHashtags =
    input.hashtagCount >= MINIMUM_HASHTAGS
      ? clamp01(
          Math.max(
            input.hashtagCount / HASHTAG_REFERENCE_COUNT,
            input.hashtagCount /
              Math.max(1, input.wordCount) /
              HASHTAG_REFERENCE_RATIO,
          ),
        )
      : 0;

  // Very low lexical diversity (type-token ratio) on longer texts.
  const lowLexicalDiversity =
    input.wordCount >= MINIMUM_WORDS_FOR_LEXICAL
      ? clamp01(
          (LEXICAL_REFERENCE_TTR - input.typeTokenRatio) /
            LEXICAL_REFERENCE_RANGE,
        )
      : 0;

  return {
    lowSentenceLengthVariation,
    repetitiveTransitions,
    formulaicStructure,
    listiclePattern,
    excessiveHashtags,
    lowLexicalDiversity,
  };
}

interface RawSentence {
  text: string;
  /** The full terminator run that closed the sentence ("" at end of text). */
  terminator: string;
}

/** Linear sentence splitter over ".", "!", "?", "…" runs and line breaks. */
function splitSentences(text: string): RawSentence[] {
  const sentences: RawSentence[] = [];
  let start = 0;
  let index = 0;
  while (index < text.length) {
    const character = text[index]!;
    if (SENTENCE_TERMINATORS.has(character) || character === "\n") {
      const terminatorStart = index;
      while (
        index < text.length &&
        (SENTENCE_TERMINATORS.has(text[index]!) || text[index] === "\n")
      ) {
        index += 1;
      }
      pushSentence(
        sentences,
        text.slice(start, terminatorStart),
        text.slice(terminatorStart, index),
      );
      start = index;
      continue;
    }
    index += 1;
  }
  pushSentence(sentences, text.slice(start), "");
  return sentences;
}

function pushSentence(
  sentences: RawSentence[],
  raw: string,
  terminator: string,
): void {
  const text = raw.trim();
  if (text.length > 0) sentences.push({ text, terminator });
}

function sentenceStatistics(wordCounts: number[]): SentenceStatistics {
  const measurable = wordCounts.filter((count) => count > 0);
  if (measurable.length === 0) {
    return {
      sentenceCount: 0,
      meanWordsPerSentence: 0,
      lengthCoefficientOfVariation: 0,
    };
  }
  const mean =
    measurable.reduce((sum, count) => sum + count, 0) / measurable.length;
  const variance =
    measurable.reduce((sum, count) => sum + (count - mean) ** 2, 0) /
    measurable.length;
  return {
    sentenceCount: measurable.length,
    meanWordsPerSentence: mean,
    lengthCoefficientOfVariation: mean === 0 ? 0 : Math.sqrt(variance) / mean,
  };
}

function countRepeatedOpeningBigrams(sentences: RawSentence[]): number {
  const seen = new Map<string, number>();
  for (const sentence of sentences) {
    const words = wordTokensOf(sentence.text)
      .slice(0, 2)
      .map(coreOf)
      .filter((word) => word.length > 0);
    if (words.length < 2) continue;
    const bigram = `${words[0]} ${words[1]}`;
    seen.set(bigram, (seen.get(bigram) ?? 0) + 1);
  }
  let repeats = 0;
  for (const count of seen.values()) {
    if (count > 1) repeats += count - 1;
  }
  return repeats;
}

function startsWithConnective(sentence: string): boolean {
  const start = sentence.toLowerCase().replace(LEADING_PUNCTUATION, "");
  return SENTENCE_CONNECTIVES.some(
    (connective) =>
      start.startsWith(connective) &&
      !WORD_CHARACTER.test(start.charAt(connective.length)),
  );
}

/**
 * True only for a sentence closed by real punctuation that continues on the
 * same line. A line break in the terminator run means the "sentence" was a
 * standalone line — that shape belongs to the listicle signal, not here.
 */
function isProseFragmentTerminator(terminator: string): boolean {
  if (terminator.includes("\n")) return false;
  for (const character of terminator) {
    if (SENTENCE_TERMINATORS.has(character)) return true;
  }
  return false;
}

/**
 * Dashes, colons and ellipsis runs; one run of dots counts once. A dash that
 * opens a line is a bullet marker already measured by the listicle signal,
 * so it is skipped here instead of being double-counted as prose cadence.
 */
function countCadenceMarks(text: string): number {
  let marks = 0;
  let dotRun = 0;
  let atLineStart = true;
  for (const character of text) {
    if (character === ".") {
      dotRun += 1;
      atLineStart = false;
      continue;
    }
    if (dotRun >= 2) marks += 1;
    dotRun = 0;
    if (character === "\n") {
      atLineStart = true;
      continue;
    }
    const isDash = character === "—" || character === "–";
    if (isDash ? !atLineStart : character === ":" || character === "…") {
      marks += 1;
    }
    if (character !== " " && character !== "\t") {
      atLineStart = false;
    }
  }
  if (dotRun >= 2) marks += 1;
  return marks;
}

function isBulletLine(line: string): boolean {
  if (BULLET_PREFIXES.some((prefix) => line.startsWith(prefix))) return true;
  let digits = 0;
  while (digits < 3 && digits < line.length && isAsciiDigit(line[digits]!)) {
    digits += 1;
  }
  if (digits === 0) return false;
  const next = line[digits];
  return (
    next === "." || next === ")" || next === ":" || next === "-" || next === "–"
  );
}

function isAsciiDigit(character: string): boolean {
  return character >= "0" && character <= "9";
}

function tokensOf(text: string): string[] {
  return text.split(/\s+/u).filter((token) => token.length > 0);
}

function wordTokensOf(text: string): string[] {
  return tokensOf(text).filter((token) => WORD_CHARACTER.test(token));
}

/**
 * Trims non-word edge characters with a manual two-pointer scan. This is the
 * linear replacement for an `/^[^…]+|[^…]+$/` regex whose `$`-anchored
 * alternative backtracked quadratically on long interior punctuation runs.
 */
function coreOf(token: string): string {
  let start = 0;
  let end = token.length;
  while (start < end && !WORD_CHARACTER.test(token[start]!)) start += 1;
  while (end > start && !WORD_CHARACTER.test(token[end - 1]!)) end -= 1;
  return token.slice(start, end).toLowerCase();
}

function isHashtag(token: string): boolean {
  return (
    token.length > 1 &&
    token.startsWith("#") &&
    WORD_CHARACTER.test(token.charAt(1))
  );
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
