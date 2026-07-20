// The single, cohesive TMR runtime seam. It binds ONE asset load to the four
// coordinates a calibrated decision depends on: the classifier, the EXACT
// tokenizer (native offsets, measured special-token budget), the sealed bundle
// identity and the windowing plan. The tokenizer is never the heuristic on this
// path, and the window limits come from the manifest — never from user settings.

import type { BundledModelManifest, BundledWindowingConfig } from "@/inference/bundled-model-metadata";
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

/** Options passed to the loaded Transformers.js tokenizer. */
export interface TokenizerCallOptions {
  add_special_tokens: boolean;
  return_offsets_mapping?: boolean;
  padding: false;
  truncation: false;
}

/** The raw tokenizer output shape the runtime reads. */
export interface TokenizerCallResult {
  input_ids: unknown;
  offset_mapping?: unknown;
}

/** The minimal surface of an effectively-loaded Transformers.js tokenizer. */
export type LoadedTransformersTokenizer = (
  text: string,
  options: TokenizerCallOptions,
) => TokenizerCallResult;

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
  const { modelMaxTokens, contentTokens, overlapTokens, maxWindows } = windowing;
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
 * literal), and returns NATIVE char offsets from `return_offsets_mapping`. It
 * never reconstructs offsets by substring search and never uses the heuristic
 * tokenizer.
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
      return_offsets_mapping: true,
      padding: false,
      truncation: false,
    });
    const inputIds = toTokenIdArray(output.input_ids);
    const offsets = toOffsets(output.offset_mapping, inputIds.length, text.length);
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
  const chunkPlan = createTmrChunkPlan(manifest.windowing, tokenizer.specialTokenCount);
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
    throw tokenizationFailed("The loaded tokenizer emitted an invalid token id.");
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
  throw tokenizationFailed("The loaded tokenizer produced an invalid input_ids shape.");
}

function toOffsets(
  offsetMapping: unknown,
  tokenCount: number,
  textLength: number,
): { start: number; end: number }[] {
  if (!Array.isArray(offsetMapping)) {
    throw offsetsUnavailable();
  }
  // Allow a one-level batch nesting: [[ [s,e], ... ]].
  const pairs =
    offsetMapping.length === 1 &&
    Array.isArray(offsetMapping[0]) &&
    Array.isArray((offsetMapping[0] as unknown[])[0])
      ? (offsetMapping[0] as unknown[])
      : offsetMapping;

  if (pairs.length !== tokenCount) {
    throw offsetsUnavailable();
  }

  let previousEnd = 0;
  return pairs.map((pair) => {
    const [start, end] = normalizePair(pair);
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < previousEnd ||
      end < start ||
      end > textLength
    ) {
      throw offsetsUnavailable();
    }
    previousEnd = end;
    return { start, end };
  });
}

function normalizePair(pair: unknown): [number, number] {
  if (Array.isArray(pair) && pair.length === 2) {
    return [Number(pair[0]), Number(pair[1])];
  }
  if (
    typeof pair === "object" &&
    pair !== null &&
    "start" in pair &&
    "end" in pair
  ) {
    return [
      Number((pair as { start: unknown }).start),
      Number((pair as { end: unknown }).end),
    ];
  }
  throw offsetsUnavailable();
}

function offsetsUnavailable(): CleanFeedError {
  return new CleanFeedError("TOKENIZATION_FAILED", "MODEL_TOKEN_OFFSETS_UNAVAILABLE");
}

function tokenizationFailed(message: string): CleanFeedError {
  return new CleanFeedError("TOKENIZATION_FAILED", message);
}
