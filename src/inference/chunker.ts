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

/** A candidate window, identified and bounded by its content-token interval. */
export interface WindowInterval {
  index: number;
  tokenStart: number;
  tokenEnd: number;
}

/** The outcome of distributing at most `limit` windows over the candidates. */
export interface DistributedWindowSelection {
  candidateWindowCount: number;
  selectedWindowCount: number;
  /** The `index` of each selected window, in ascending order. */
  selectedIndices: number[];
  /** The token intervals of the selected windows (raw, may overlap). */
  coveredIntervals: { start: number; end: number }[];
  truncated: boolean;
}

/**
 * Distributes at most `limit` window slots across `total` candidates using the
 * literal formula `round(i * (total - 1) / (limit - 1))` for `i = 0..limit-1`,
 * deduplicating defensively. The first (0) and last (`total - 1`) candidate are
 * always preserved. Returns candidate positions in ascending order.
 */
export function distributedIndices(total: number, limit: number): number[] {
  if (total <= 0 || limit <= 0) {
    return [];
  }
  if (total <= limit) {
    return Array.from({ length: total }, (_, index) => index);
  }
  if (limit === 1) {
    return [0];
  }

  const positions = new Set<number>();
  for (let i = 0; i < limit; i += 1) {
    positions.add(Math.round((i * (total - 1)) / (limit - 1)));
  }
  return [...positions].sort((left, right) => left - right);
}

/**
 * Selects at most `limit` windows via {@link distributedIndices} and reports
 * exactly what was analyzed: candidate/selected counts, the selected windows'
 * own indices, their covered token intervals, and whether any candidate was
 * dropped. The single source of the eight-window truncation policy.
 */
export function selectDistributedWindows(
  windows: WindowInterval[],
  limit: number,
): DistributedWindowSelection {
  const selectedPositions = distributedIndices(windows.length, limit);
  const selected = selectedPositions.map((position) => windows[position]!);

  return {
    candidateWindowCount: windows.length,
    selectedWindowCount: selected.length,
    selectedIndices: selected.map((window) => window.index),
    coveredIntervals: selected.map((window) => ({
      start: window.tokenStart,
      end: window.tokenEnd,
    })),
    truncated: windows.length > selected.length,
  };
}
