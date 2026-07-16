/** A heuristic token span whose offsets refer to the original UTF-16 string. */
export interface TokenSpan {
  /** A deterministic mock-only hash; it is never a model vocabulary ID. */
  id: number;
  start: number;
  end: number;
}

export interface TokenizedText {
  spans: TokenSpan[];
  tokenCount: number;
  /** Whether tokenCount was produced by the backing model tokenizer. */
  exact: boolean;
}

export interface Tokenizer {
  readonly id: string;
  encode(text: string, signal?: AbortSignal): Promise<TokenizedText>;
}

interface ExactTokenGateway {
  tokenize(text: string): Promise<{
    inputIds: readonly number[];
    specialTokenCount: number;
  }>;
}

/** Uses the model's own tokenizer for exact chunk-planning token counts. */
export class TransformersTokenizer implements Tokenizer {
  readonly id: string;

  constructor(
    modelId: string,
    private readonly gateway: ExactTokenGateway,
  ) {
    this.id = `transformers-${modelId}`;
  }

  async encode(text: string, signal?: AbortSignal): Promise<TokenizedText> {
    throwIfAborted(signal);
    const tokens = await this.gateway.tokenize(text);
    throwIfAborted(signal);

    const tokenCount = tokens.inputIds.length - tokens.specialTokenCount;
    if (
      !Number.isSafeInteger(tokens.specialTokenCount) ||
      tokens.specialTokenCount < 0 ||
      tokenCount < 0
    ) {
      throw new Error("The model tokenizer returned an invalid token count.");
    }

    return { spans: [], tokenCount, exact: true };
  }
}

const TOKEN_PATTERN =
  /\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic}\uFE0F?)*|[\p{L}\p{M}\p{N}_]+|[^\s\p{L}\p{M}\p{N}_]/gu;
const ABORT_CHECK_INTERVAL = 256;

/**
 * A replaceable approximation for model tokenization. It preserves source
 * offsets, but its token IDs and count must not be used as model values.
 */
export class HeuristicTokenizer implements Tokenizer {
  readonly id = "heuristic-v1";

  async encode(text: string, signal?: AbortSignal): Promise<TokenizedText> {
    throwIfAborted(signal);

    const spans: TokenSpan[] = [];

    for (const match of text.matchAll(TOKEN_PATTERN)) {
      if (spans.length % ABORT_CHECK_INTERVAL === 0) {
        throwIfAborted(signal);
      }

      const start = match.index;
      const value = match[0];

      spans.push({
        id: fnv1a(value),
        start,
        end: start + value.length,
      });
    }

    return {
      spans,
      tokenCount: spans.length,
      exact: false,
    };
  }
}

function fnv1a(value: string): number {
  let hash = 0x811c9dc5;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The tokenization was aborted.", "AbortError");
  }
}
