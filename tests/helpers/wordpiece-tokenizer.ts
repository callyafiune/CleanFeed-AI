// A dict-driven WordPiece fake (BERT family), faithful to the sealed bundle's
// own `tokenizer.json` for the three behaviours our offset derivation depends on:
//
//   - `BertNormalizer` with `handle_chinese_chars: true` puts a SPACE around
//     every CJK ideograph, so each one becomes its own basic word. That is not a
//     detail: `neuralmind/bert-base-portuguese-cased` has no bare CJK ideograph
//     in `vocab.txt` (only the `##`-prefixed forms), so `花巻市` is three words
//     and therefore three `[UNK]` tokens — the exact shape that desynchronized
//     the offset stream on `mix_src_wikipedia_pt_d3e3087c4ae9`;
//   - `BertPreTokenizer` splits on whitespace and makes every punctuation
//     character its own word;
//   - `WordPiece` is all-or-nothing per word: an unknown word collapses to a
//     single `[UNK]`, it does not fall back to characters.
//
// `strip_accents` is null and `lowercase` is false in the sealed config, so the
// fake does neither. The callable and `tokenize` are built from the SAME piece
// stream, and the detection probe "a b" resolves to `["a", "b"]`, exactly like a
// real BERT tokenizer.

import type { LoadedTransformersTokenizer } from "@/inference/model-runtime";

/**
 * The ranges `BertNormalizer::handle_chinese_chars` treats as Chinese, verbatim
 * from `tokenizers`' `is_chinese_char`. Kana and Hangul are deliberately absent
 * there, and so they are here.
 */
const CHINESE_CHARACTER =
  /[\u4E00-\u9FFF\u3400-\u4DBF\uF900-\uFAFF]|[\u{20000}-\u{2A6DF}]|[\u{2A700}-\u{2B73F}]|[\u{2B740}-\u{2B81F}]|[\u{2B820}-\u{2CEAF}]|[\u{2F800}-\u{2FA1F}]/gu;

/** Whitespace/punctuation basic split, after the CJK padding. */
export function basicWords(text: string): string[] {
  const padded = text.replace(CHINESE_CHARACTER, (char) => ` ${char} `);
  return padded.match(/[^\s\p{P}]+|\p{P}/gu) ?? [];
}

export function fakeWordPieceTokenizer(
  wordPieces: Record<string, string[]>,
): LoadedTransformersTokenizer {
  const vocabulary = new Map<string, number>();
  const idOf = (piece: string): number => {
    if (!vocabulary.has(piece)) vocabulary.set(piece, 10 + vocabulary.size);
    return vocabulary.get(piece)!;
  };
  const withDefaults: Record<string, string[]> = {
    a: ["a"],
    b: ["b"],
    ...wordPieces,
  };
  const piecesFor = (text: string): string[] =>
    basicWords(text).flatMap((word) => withDefaults[word] ?? ["[UNK]"]);
  const tokenizer = ((text: string, callOptions) => {
    const ids = piecesFor(text).map(idOf);
    return {
      input_ids: callOptions.add_special_tokens ? [101, ...ids, 102] : ids,
    };
  }) as LoadedTransformersTokenizer;
  tokenizer.tokenize = (text: string) => piecesFor(text);
  return tokenizer;
}
