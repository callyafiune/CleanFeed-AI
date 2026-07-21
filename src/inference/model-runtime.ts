// The single, cohesive TMR runtime seam. It binds ONE asset load to the four
// coordinates a calibrated decision depends on: the classifier, the EXACT
// tokenizer (native offsets, measured special-token budget), the sealed bundle
// identity and the windowing plan. The tokenizer is never the heuristic on this
// path, and the window limits come from the manifest — never from user settings.

import type {
  BundledModelManifest,
  BundledWindowingConfig,
} from "@/inference/bundled-model-metadata";
import { CleanFeedError } from "@/shared/errors";
import type { RuntimeModelIdentity, TextClassifier } from "@/shared/types";

/** Special tokens this manifest's tokenizer reserves (RoBERTa-family: <s>, </s>). */
const REQUIRED_SPECIAL_TOKEN_COUNT = 2;

/** Canonical digest of the empty calibration set (SHA-256 of "[]"). */
const EMPTY_CALIBRATION_SET_DIGEST =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

/** A fixed, content-only probe used to measure the special-token budget once. */
const SPECIAL_TOKEN_PROBE = "cleanfeed";

/** The window plan a calibrated TMR profile is pinned to; never user-editable. */
export interface TmrChunkPlan {
  modelMaxTokens: number;
  contentTokens: number;
  overlapTokens: number;
  maxWindows: number;
}

/** The exact encoding of one text: content token ids, native char offsets. */
export interface ExactTokenEncoding {
  inputIds: number[];
  offsets: { start: number; end: number }[];
  specialTokenCount: number;
}

/** Options passed to the loaded Transformers.js tokenizer's callable form. */
export interface TokenizerCallOptions {
  add_special_tokens: boolean;
  padding: false;
  truncation: false;
}

/** The raw tokenizer output shape the runtime reads (content token ids only). */
export interface TokenizerCallResult {
  input_ids: unknown;
}

/** Options passed to the tokenizer's `tokenize` surface (byte-level tokens). */
export interface TokenizeOptions {
  add_special_tokens: boolean;
}

/**
 * The minimal surface of an effectively-loaded Transformers.js tokenizer. It is
 * both callable (yielding content token ids) and exposes `tokenize`, which
 * returns the ByteLevel-BPE surface tokens (e.g. `"Ġado"`, `"Ã§"`). The exact
 * tokenizer derives NATIVE char offsets from those tokens' ByteLevel
 * segmentation — never `return_offsets_mapping` (this tokenizer never emits it)
 * and never a substring search over the source text.
 */
export interface LoadedTransformersTokenizer {
  (text: string, options: TokenizerCallOptions): TokenizerCallResult;
  tokenize(text: string, options: TokenizeOptions): string[];
}

/** The cohesive runtime seam: one asset load, four sealed coordinates. */
export interface ModelRuntime {
  classifier: TextClassifier;
  tokenizer: ExactTokenizer;
  identity: RuntimeModelIdentity;
  chunkPlan: TmrChunkPlan;
}

export interface ModelRuntimeAssets {
  classifier: TextClassifier;
  tokenizer: LoadedTransformersTokenizer;
}

export interface CreateModelRuntimeOptions {
  calibrationSetDigest?: string;
  requiredSpecialTokenCount?: number;
}

/**
 * Normalizes a BCP-47 tag and admits ONLY `pt` and `pt-BR` (case-insensitive)
 * to the canonical `pt-BR` calibration locale. Every other tag — `pt-PT`, `en`,
 * an unknown value or an empty/absent one — is unsupported and returns `null`.
 * The runtime, language gate and profile registry must normalize BEFORE they
 * decide support or form a profile key so `pt` and `pt-BR` share one profile.
 */
export function normalizeCalibrationLocale(
  locale: string | null | undefined,
): "pt-BR" | null {
  if (typeof locale !== "string") {
    return null;
  }
  const trimmed = locale.trim();
  if (trimmed.length === 0) {
    return null;
  }
  const subtags = trimmed.split("-");
  if (subtags[0]!.toLowerCase() !== "pt") {
    return null;
  }
  if (subtags.length === 1) {
    return "pt-BR";
  }
  return subtags[1]!.toUpperCase() === "BR" ? "pt-BR" : null;
}

/**
 * Validates and returns the sealed window plan. `contentTokens` is the number
 * of content tokens per window; the plan reserves the special-token budget on
 * top of it. When `specialTokenCount` is supplied (from the loaded tokenizer),
 * the plan additionally proves `contentTokens === modelMaxTokens - special`.
 */
export function createTmrChunkPlan(
  windowing: BundledWindowingConfig,
  specialTokenCount?: number,
): TmrChunkPlan {
  const { modelMaxTokens, contentTokens, overlapTokens, maxWindows } =
    windowing;
  const consistentWithTokenizer =
    specialTokenCount === undefined ||
    (Number.isSafeInteger(specialTokenCount) &&
      specialTokenCount >= 0 &&
      contentTokens === modelMaxTokens - specialTokenCount);

  const valid =
    Number.isSafeInteger(modelMaxTokens) &&
    Number.isSafeInteger(contentTokens) &&
    Number.isSafeInteger(overlapTokens) &&
    Number.isSafeInteger(maxWindows) &&
    modelMaxTokens >= 1 &&
    contentTokens >= 1 &&
    contentTokens < modelMaxTokens &&
    overlapTokens >= 0 &&
    overlapTokens < contentTokens &&
    maxWindows >= 1 &&
    consistentWithTokenizer;

  if (!valid) {
    throw new CleanFeedError("INVALID_SETTINGS", "INVALID_CHUNK_PLAN");
  }

  return { modelMaxTokens, contentTokens, overlapTokens, maxWindows };
}

/**
 * The exact tokenizer for the TMR path. It wraps the effectively-loaded
 * Transformers.js tokenizer, measures the special-token budget ONCE at
 * construction with an `add_special_tokens` on/off probe (never a hardcoded
 * literal), and returns NATIVE char offsets derived from the tokenizer's own
 * ByteLevel-BPE segmentation: each surface token is a run of byte-alphabet
 * characters that maps back to a contiguous run of the source text's UTF-8
 * bytes, and those byte spans are converted to full-character UTF-16 offsets.
 * It never reconstructs offsets by substring search (no `indexOf`/`slice`
 * scanning) and never uses the heuristic tokenizer.
 */
export class ExactTokenizer {
  private constructor(
    private readonly tokenizer: LoadedTransformersTokenizer,
    readonly specialTokenCount: number,
  ) {}

  static create(
    tokenizer: LoadedTransformersTokenizer,
    requiredSpecialTokenCount: number = REQUIRED_SPECIAL_TOKEN_COUNT,
  ): ExactTokenizer {
    const withSpecial = countTokens(
      tokenizer(SPECIAL_TOKEN_PROBE, {
        add_special_tokens: true,
        padding: false,
        truncation: false,
      }).input_ids,
    );
    const withoutSpecial = countTokens(
      tokenizer(SPECIAL_TOKEN_PROBE, {
        add_special_tokens: false,
        padding: false,
        truncation: false,
      }).input_ids,
    );
    const measured = withSpecial - withoutSpecial;
    if (
      !Number.isSafeInteger(measured) ||
      measured < 0 ||
      measured !== requiredSpecialTokenCount
    ) {
      throw new CleanFeedError(
        "MODEL_LOAD_FAILED",
        `TMR tokenizer reserves ${measured} special tokens; ${requiredSpecialTokenCount} required.`,
      );
    }
    return new ExactTokenizer(tokenizer, measured);
  }

  encodeWithOffsets(text: string): ExactTokenEncoding {
    const output = this.tokenizer(text, {
      add_special_tokens: false,
      padding: false,
      truncation: false,
    });
    const inputIds = toTokenIdArray(output.input_ids);
    // The ByteLevel surface tokens (content only) whose byte runs tile the text.
    const tokens = this.tokenizer.tokenize(text, {
      add_special_tokens: false,
    });
    if (!Array.isArray(tokens) || tokens.length !== inputIds.length) {
      throw tokenizationFailed(
        "The loaded tokenizer's token and id streams disagree.",
      );
    }
    const offsets = deriveByteLevelOffsets(text, tokens);
    return { inputIds, offsets, specialTokenCount: this.specialTokenCount };
  }
}

/**
 * Assembles the runtime from a SINGLE asset load: the classifier and the exact
 * tokenizer are produced by one `load()` call, so backend and tokenizer share
 * one materialization. The window plan and identity are sealed from the manifest.
 */
export async function createModelRuntime(
  load: () => Promise<ModelRuntimeAssets>,
  manifest: BundledModelManifest,
  options: CreateModelRuntimeOptions = {},
): Promise<ModelRuntime> {
  const assets = await load();
  const tokenizer = ExactTokenizer.create(
    assets.tokenizer,
    options.requiredSpecialTokenCount,
  );
  const chunkPlan = createTmrChunkPlan(
    manifest.windowing,
    tokenizer.specialTokenCount,
  );
  const identity = buildBundleIdentity(
    manifest,
    options.calibrationSetDigest ?? EMPTY_CALIBRATION_SET_DIGEST,
  );
  return { classifier: assets.classifier, tokenizer, identity, chunkPlan };
}

function buildBundleIdentity(
  manifest: BundledModelManifest,
  calibrationSetDigest: string,
): RuntimeModelIdentity {
  return {
    kind: "bundle",
    modelId: manifest.modelId,
    modelVersion: manifest.modelVersion,
    bundleDigest: manifest.bundleDigest,
    tokenizerDigest: manifest.tokenizerDigest,
    aggregationVersion: manifest.aggregationVersion,
    contentCompositionVersion: manifest.contentCompositionVersion,
    calibrationSetDigest,
  };
}

function countTokens(inputIds: unknown): number {
  return toTokenIdArray(inputIds).length;
}

function toTokenIdArray(value: unknown): number[] {
  const values = arrayValues(value);
  const ids =
    values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  return ids.map((id) => {
    if (typeof id === "number" && Number.isSafeInteger(id)) {
      return id;
    }
    if (
      typeof id === "bigint" &&
      id >= BigInt(Number.MIN_SAFE_INTEGER) &&
      id <= BigInt(Number.MAX_SAFE_INTEGER)
    ) {
      return Number(id);
    }
    throw tokenizationFailed(
      "The loaded tokenizer emitted an invalid token id.",
    );
  });
}

function arrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) {
    return value;
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    ArrayBuffer.isView((value as { data: unknown }).data)
  ) {
    return Array.from(
      (value as { data: ArrayLike<unknown> }).data as ArrayLike<unknown>,
    );
  }
  throw tokenizationFailed(
    "The loaded tokenizer produced an invalid input_ids shape.",
  );
}

/**
 * The GPT-2/RoBERTa ByteLevel byte-alphabet: the 256 characters the ByteLevel
 * pre-tokenizer uses to render each raw byte as a printable code point (0x20 →
 * `Ġ`, 0xC3 → `Ã`, …). It is the SAME alphabet the loaded tokenizer emits in its
 * surface tokens, so each surface-token character corresponds to exactly one
 * source byte. Built once and frozen.
 */
const BYTE_LEVEL_ALPHABET: ReadonlySet<string> = buildByteLevelAlphabet();

function buildByteLevelAlphabet(): ReadonlySet<string> {
  const printable: number[] = [];
  for (let byte = 0x21; byte <= 0x7e; byte += 1) printable.push(byte);
  for (let byte = 0xa1; byte <= 0xac; byte += 1) printable.push(byte);
  for (let byte = 0xae; byte <= 0xff; byte += 1) printable.push(byte);
  const codePoints = new Set(printable);
  let next = 0;
  for (let byte = 0; byte < 256; byte += 1) {
    if (!printable.includes(byte)) {
      codePoints.add(256 + next);
      next += 1;
    }
  }
  return new Set([...codePoints].map((code) => String.fromCharCode(code)));
}

/**
 * Derives NATIVE per-token char offsets from the ByteLevel surface tokens. Each
 * token is a run of byte-alphabet characters mapping 1:1 to source UTF-8 bytes,
 * so the token stream tiles the text's bytes contiguously; each token's byte run
 * is converted to the enclosing FULL-character UTF-16 range (rounding outward so
 * a multi-byte character split across BPE tokens never yields a mid-codepoint
 * index). No substring search is performed. Fails closed if the byte run does
 * not tile the text exactly (e.g. an unexpected prefix-space tokenizer).
 */
function deriveByteLevelOffsets(
  text: string,
  tokens: string[],
): { start: number; end: number }[] {
  const encoder = new TextEncoder();
  const totalBytes = encoder.encode(text).length;
  // For every source byte, the UTF-16 start and end of the character owning it.
  const byteCharStart = new Int32Array(totalBytes);
  const byteCharEnd = new Int32Array(totalBytes);
  let bytePos = 0;
  let unitPos = 0;
  for (const char of text) {
    const unitLength = char.length;
    const byteLength = encoder.encode(char).length;
    for (let offset = 0; offset < byteLength; offset += 1) {
      byteCharStart[bytePos + offset] = unitPos;
      byteCharEnd[bytePos + offset] = unitPos + unitLength;
    }
    bytePos += byteLength;
    unitPos += unitLength;
  }

  const offsets: { start: number; end: number }[] = [];
  let cursor = 0;
  for (const token of tokens) {
    const tokenBytes = tokenByteLength(token);
    const byteStart = cursor;
    const byteEnd = cursor + tokenBytes;
    cursor = byteEnd;
    if (tokenBytes <= 0 || byteEnd > totalBytes) {
      throw tokenizationFailed(
        "A ByteLevel token does not fit the source byte layout.",
      );
    }
    offsets.push({
      start: byteCharStart[byteStart]!,
      end: byteCharEnd[byteEnd - 1]!,
    });
  }
  if (cursor !== totalBytes) {
    throw tokenizationFailed(
      "The ByteLevel token stream did not tile the source text.",
    );
  }
  return offsets;
}

/** Counts a ByteLevel token's source bytes (one per byte-alphabet character). */
function tokenByteLength(token: string): number {
  let bytes = 0;
  for (const char of token) {
    if (!BYTE_LEVEL_ALPHABET.has(char)) {
      throw tokenizationFailed(
        "A tokenizer surface token used a non-ByteLevel character.",
      );
    }
    bytes += 1;
  }
  return bytes;
}

function tokenizationFailed(message: string): CleanFeedError {
  return new CleanFeedError("TOKENIZATION_FAILED", message);
}
