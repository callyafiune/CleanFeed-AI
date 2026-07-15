import type { TextLengthInfo } from "@/shared/types";

const WORD_PATTERN = /[\p{L}\p{N}]+(?:[-'’][\p{L}\p{N}]+)*/gu;

function countWordsWithFallback(text: string): number {
  return text.match(WORD_PATTERN)?.length ?? 0;
}

function countWordsWithSegmenter(text: string): number {
  const Segmenter = Intl.Segmenter;

  if (typeof Segmenter === "undefined") {
    return countWordsWithFallback(text);
  }

  return Array.from(
    new Segmenter("pt", { granularity: "word" }).segment(text),
  ).filter((segment) => segment.isWordLike).length;
}

export function getTextLengthInfo(text: string): TextLengthInfo {
  return {
    characterCount: text.length,
    wordCount: countWordsWithSegmenter(text),
  };
}
