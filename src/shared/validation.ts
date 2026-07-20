import { MODEL_MAX_TOKENS } from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";

export interface ChunkWindowOptions {
  chunkSizeTokens: number;
  overlapTokens: number;
  maximumTokens: number;
}

/**
 * Validates a single window plan: the chunk fits the token budget, the budget
 * fits the model capacity ({@link MODEL_MAX_TOKENS}), and the overlap is a
 * proper prefix of the chunk. This bounds the editable/builtin runtimes; the
 * calibrated TMR path pins its own plan from the manifest instead.
 */
export function validateChunkWindow(options: ChunkWindowOptions): void {
  const { chunkSizeTokens, overlapTokens, maximumTokens } = options;
  const valid =
    Number.isSafeInteger(chunkSizeTokens) &&
    Number.isSafeInteger(overlapTokens) &&
    Number.isSafeInteger(maximumTokens) &&
    chunkSizeTokens >= 1 &&
    chunkSizeTokens <= maximumTokens &&
    maximumTokens <= MODEL_MAX_TOKENS &&
    overlapTokens >= 0 &&
    overlapTokens < chunkSizeTokens;

  if (!valid) {
    throw new CleanFeedError("INVALID_SETTINGS", "INVALID_SETTINGS");
  }
}
