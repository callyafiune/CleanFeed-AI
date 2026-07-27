import type { TokenizedText } from "@/inference/tokenizer";
import { CleanFeedError } from "@/shared/errors";
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
  /**
   * The selected windows themselves, ascending, each keeping the index it had
   * among ALL candidates. This is what lets a caller select BEFORE inferring:
   * it loops over exactly these windows and never has to re-derive which ones
   * the aggregation would have kept.
   */
  selectedWindows: WindowInterval[];
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
    selectedWindows: selected,
    coveredIntervals: selected.map((window) => ({
      start: window.tokenStart,
      end: window.tokenEnd,
    })),
    truncated: windows.length > selected.length,
  };
}

/** The stride parameters a content-window tiling needs from the sealed plan. */
export interface ContentWindowPlan {
  contentTokens: number;
  overlapTokens: number;
}

/**
 * Tiles `totalTokenCount` content tokens into candidate windows of
 * `contentTokens`, advancing by `contentTokens - overlapTokens` and stopping on
 * the window that reaches the last token. Windows are numbered from zero in
 * ascending order, and that number is the ONLY window identity downstream:
 * {@link selectDistributedWindows} keeps it, so an aggregation over a selected
 * subset still names the originals.
 *
 * It lives here, beside the selection policy, so the tiling and the truncation
 * that consumes it cannot drift apart. NOTE, honestly: `src/model-smoke/main.ts`
 * still carries a byte-identical private copy of this loop. Removing it is a
 * one-line change but it is not A2's file, and its only executable coverage is a
 * Playwright spec outside this task's verification, so the duplication is
 * recorded here rather than fixed on a typecheck.
 */
export function buildContentWindows(
  totalTokenCount: number,
  plan: ContentWindowPlan,
): WindowInterval[] {
  if (totalTokenCount <= 0) {
    return [];
  }
  const step = plan.contentTokens - plan.overlapTokens;
  const windows: WindowInterval[] = [];
  for (
    let start = 0, index = 0;
    start < totalTokenCount;
    start += step, index += 1
  ) {
    const end = Math.min(start + plan.contentTokens, totalTokenCount);
    windows.push({ index, tokenStart: start, tokenEnd: end });
    if (end === totalTokenCount) {
      break;
    }
  }
  return windows;
}

/** A window's text slice, after it was made to fit the model's token budget. */
export interface FittedWindowSlice {
  /** The window as SCORED: `tokenEnd` is reduced when tokens were dropped. */
  window: WindowInterval;
  /** The source text between the first and the last KEPT token's offsets. */
  text: string;
  /** How many content tokens were dropped from the end; normally zero. */
  trimmedTokens: number;
}

/**
 * Builds the text slice for one window and, when that slice re-encodes to MORE
 * content tokens than the model can accept, drops content tokens from the END —
 * deterministically, by the measured excess — until it fits.
 *
 * Why this exists: `contentTokens` is validated as `modelMaxTokens - special`
 * (510 of 512), so a full window occupies the model's entire capacity and the
 * slack is zero. The slice is cut at CHARACTER offsets rounded outward to whole
 * characters and re-tokenized in isolation, and that costs one or two tokens more
 * than the same span cost inside the whole document — measured over
 * development + calibration, every failing window whose offsets were sound landed
 * on 513 or 514 of 512, against exactly 512 for the longest windows that scored.
 * A single token over the budget threw away the whole document's score.
 *
 * It fails CLOSED rather than fabricating: when dropping tokens does not shorten
 * the slice — which is what the WordPiece coarse-offset fallback produces, since
 * it maps every token to the whole text — the window is really the entire
 * document, and scoring eight copies of the same text would be a fabricated
 * result rather than a repaired one.
 *
 * `countContentTokens` is injected because the authoritative count is the loaded
 * tokenizer's, and this module must stay pure and unit-testable.
 */
export function fitWindowSlice(
  text: string,
  offsets: readonly { start: number; end: number }[],
  window: WindowInterval,
  maxContentTokens: number,
  countContentTokens: (slice: string) => number,
): FittedWindowSlice {
  let tokenEnd = window.tokenEnd;
  // The loop terminates on its REAL condition — the token cursor reaching the
  // window's own start — and on nothing else. `tokenEnd` strictly decreases by at
  // least one every pass, so termination does not depend on an attempt budget; a
  // budget would mislabel a slice that IS still reducible (a tokenizer that
  // under-reports the excess converges one token at a time) as unshrinkable, and
  // that mislabelling costs a document its score.
  for (;;) {
    const start = offsets[window.tokenStart];
    const last = offsets[tokenEnd - 1];
    // An interval outside the offset array means the caller and the tokenizer
    // disagree about how many tokens exist. That is a different defect from a
    // degenerate offset map, so it gets its own code rather than borrowing the
    // "not reducible" one — one code for two causes is what made error rows
    // undiagnosable before A1.
    if (start === undefined || last === undefined) {
      throw new CleanFeedError(
        "INFERENCE_FAILED",
        "WINDOW_OFFSETS_OUT_OF_RANGE",
      );
    }
    const slice = text.slice(start.start, last.end);
    const count = countContentTokens(slice);
    if (count <= maxContentTokens) {
      return {
        window: { ...window, tokenEnd },
        text: slice,
        trimmedTokens: window.tokenEnd - tokenEnd,
      };
    }
    // Removing the measured excess converges in one step for a real overflow.
    // Progress is tracked on the TOKEN cursor rather than the slice length,
    // because neighbouring tokens can legitimately share one offset span (the
    // WordPiece derivation rounds every piece of a mismatched word to that
    // word), and a slice that did not shrink this step can still shrink the next.
    const nextEnd = tokenEnd - Math.max(1, count - maxContentTokens);
    if (nextEnd <= window.tokenStart) {
      throw new CleanFeedError(
        "INFERENCE_FAILED",
        "WINDOW_SLICE_NOT_REDUCIBLE",
      );
    }
    tokenEnd = nextEnd;
  }
}
