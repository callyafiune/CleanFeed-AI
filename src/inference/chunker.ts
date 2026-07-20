import type { TokenizedText } from "@/inference/tokenizer";
import type { TextChunk } from "@/shared/types";
import { validateChunkWindow } from "@/shared/validation";

export interface TextChunkOptions {
  chunkSizeTokens: number;
  overlapTokens: number;
  maximumTokens: number;
}

export function createTextChunks(
  text: string,
  tokenized: TokenizedText,
  options: TextChunkOptions,
): TextChunk[] {
  validateChunkWindow(options);

  const { spans } = tokenized;
  if (spans.length === 0) {
    return [];
  }

  const step = options.chunkSizeTokens - options.overlapTokens;
  const chunks: TextChunk[] = [];

  for (
    let start = 0, index = 0;
    start < spans.length;
    start += step, index += 1
  ) {
    const end = Math.min(start + options.chunkSizeTokens, spans.length);
    chunks.push({
      index,
      startToken: start,
      endToken: end,
      text: text.slice(spans[start]!.start, spans[end - 1]!.end).trim(),
    });

    if (end === spans.length) {
      break;
    }
  }

  return chunks;
}
