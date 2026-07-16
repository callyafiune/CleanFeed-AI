import type {
  ClassificationOptions,
  ClassificationResult,
  ClassifierMetadata,
  TextClassifier,
} from "@/inference/classifier-types";
import { loadLocalSequenceClassifier } from "@/inference/model-loader";
import type { CleanFeedModelManifest } from "@/inference/model-bundle";
import { CleanFeedError } from "@/shared/errors";
import { getTextLengthInfo } from "@/shared/word-count";

export interface ModelTokens {
  /** Model input IDs, including the model-specific special tokens. */
  inputIds: readonly number[];
  /** Number of special tokens included in inputIds. */
  specialTokenCount: number;
  /** UTF-16 source ranges for each non-special model token. */
  tokenOffsets: readonly ModelTokenOffset[];
  /** Opaque model inputs owned by the concrete gateway. */
  inputs?: Record<string, unknown>;
}

export interface ModelTokenOffset {
  start: number;
  end: number;
}

export interface TransformersModelGateway {
  load(
    manifest: CleanFeedModelManifest,
    backend: "wasm" | "webgpu",
  ): Promise<void>;
  tokenize(text: string): Promise<ModelTokens>;
  run(tokens: ModelTokens): Promise<Record<string, unknown>>;
  dispose(): Promise<void>;
}

interface LocalTokenizer {
  (text: string, options: TokenizerOptions): TokenizerOutput;
  decode(tokenIds: readonly number[], options: DecodeOptions): string;
}

interface TokenizerOptions {
  add_special_tokens: boolean;
  padding: false;
  return_tensor: boolean;
  truncation: false;
}

interface TokenizerOutput {
  input_ids: unknown;
  attention_mask?: unknown;
  token_type_ids?: unknown;
}

interface DecodeOptions {
  clean_up_tokenization_spaces: false;
  skip_special_tokens: true;
}

type LocalSequenceClassifier = {
  (inputs: Record<string, unknown>): Promise<Record<string, unknown>>;
  dispose(): Promise<unknown>;
};

/**
 * Small Transformers.js adapter. It only resolves extension-local files: the
 * shared model loader verifies the bundle before the model is opened.
 */
export class TransformersJsModelGateway implements TransformersModelGateway {
  private tokenizer: LocalTokenizer | undefined;
  private model: LocalSequenceClassifier | undefined;

  async load(
    manifest: CleanFeedModelManifest,
    backend: "wasm" | "webgpu",
  ): Promise<void> {
    const { AutoTokenizer } = await import("@huggingface/transformers");
    const model = await loadLocalSequenceClassifier(manifest, backend);
    const tokenizer = await AutoTokenizer.from_pretrained(manifest.id, {
      local_files_only: true,
    });
    this.tokenizer = tokenizer as unknown as LocalTokenizer;
    this.model = model as unknown as LocalSequenceClassifier;
  }

  async tokenize(text: string): Promise<ModelTokens> {
    const tokenizer = this.requireTokenizer();
    // Do not truncate here: the chunker is responsible for keeping input
    // within the model budget. Special tokens are added only for model input.
    const unadorned = tokenizer(text, {
      add_special_tokens: false,
      padding: false,
      return_tensor: false,
      truncation: false,
    });
    const modelInputs = tokenizer(text, {
      add_special_tokens: true,
      padding: false,
      return_tensor: true,
      truncation: false,
    });
    const inputIds = tokenIds(modelInputs.input_ids);
    const plainTokenIds = tokenIds(unadorned.input_ids);

    return {
      inputIds,
      specialTokenCount: inputIds.length - plainTokenIds.length,
      tokenOffsets: offsetsFromDecodedPrefixes(text, plainTokenIds, tokenizer),
      inputs: compactInputs(modelInputs),
    };
  }

  async run(tokens: ModelTokens): Promise<Record<string, unknown>> {
    if (tokens.inputs === undefined)
      inferenceFailed("Model inputs are missing.");
    return this.requireModel()(tokens.inputs);
  }

  async dispose(): Promise<void> {
    const model = this.model;
    this.tokenizer = undefined;
    this.model = undefined;
    await model?.dispose();
  }

  private requireTokenizer(): LocalTokenizer {
    if (this.tokenizer === undefined) {
      throw new CleanFeedError("MODEL_LOAD_FAILED", "Tokenizer is not loaded.");
    }
    return this.tokenizer;
  }

  private requireModel(): LocalSequenceClassifier {
    if (this.model === undefined) {
      throw new CleanFeedError("MODEL_LOAD_FAILED", "Model is not loaded.");
    }
    return this.model;
  }
}

/**
 * Runs a locally verified ONNX sequence-classification model. ONNX execution
 * itself is not safely interruptible; a hard timeout must recreate its host.
 */
export class OnnxTextClassifier implements TextClassifier {
  private initialized = false;
  private gatewayLoaded = false;
  private generation = 0;
  private initialization: Promise<void> | undefined;
  private disposal: Promise<void> | undefined;

  constructor(
    private readonly manifest: CleanFeedModelManifest,
    private readonly gateway: TransformersModelGateway,
    private readonly backend: "wasm" | "webgpu",
  ) {}

  async initialize(): Promise<void> {
    if (this.disposal !== undefined) {
      await this.disposal;
      return this.initialize();
    }
    if (this.initialization !== undefined) return this.initialization;

    const generation = this.generation;
    const initialization = this.gateway
      .load(this.manifest, this.backend)
      .then(() => {
        this.gatewayLoaded = true;
        if (this.generation === generation) this.initialized = true;
      });
    this.initialization = initialization;
    void initialization.then(
      () => this.clearInitialization(initialization),
      () => this.clearInitialization(initialization),
    );
    return this.initialization;
  }

  async classify(
    text: string,
    options: ClassificationOptions = {},
  ): Promise<ClassificationResult> {
    if (!this.initialized) {
      inferenceFailed("Classifier must be initialized before classification.");
    }

    const startedAt = performance.now();
    throwIfAborted(options.signal);

    try {
      const tokens = await this.gateway.tokenize(text);
      throwIfAborted(options.signal);
      validateTokens(tokens, this.manifest.maximumTokens);

      const output = await this.gateway.run(tokens);
      throwIfAborted(options.signal);
      const scores = parseScores(output, this.manifest);
      const tokenCount = tokens.inputIds.length - tokens.specialTokenCount;

      return {
        aiScore: scores[this.manifest.labels.ai]!,
        humanScore: scores[this.manifest.labels.human]!,
        confidence: "low",
        // Calibration and presentation policy are deliberately outside the
        // model adapter; the worker replaces this with its calibrated status.
        status: "inconclusive",
        wordCount: getTextLengthInfo(text).wordCount,
        tokenCount,
        ...(options.language === undefined
          ? {}
          : { language: options.language }),
        modelVersion: this.manifest.version,
        modelId: this.manifest.id,
        backend: this.backend,
        processingTimeMs: performance.now() - startedAt,
        demo: false,
      };
    } catch (error) {
      if (isAbortError(error) || error instanceof CleanFeedError) throw error;
      throw new CleanFeedError("INFERENCE_FAILED", "ONNX inference failed.");
    }
  }

  async dispose(): Promise<void> {
    if (this.disposal !== undefined) return this.disposal;

    this.generation += 1;
    this.initialized = false;
    const initialization = this.initialization;
    const disposal = (async () => {
      try {
        await initialization;
      } catch {
        // A failed load has no usable session, but disposal remains idempotent.
      }

      if (this.gatewayLoaded) {
        await this.gateway.dispose();
        this.gatewayLoaded = false;
      }
    })();
    this.disposal = disposal;
    void disposal.then(
      () => this.clearDisposal(disposal),
      () => this.clearDisposal(disposal),
    );
    return disposal;
  }

  getMetadata(): ClassifierMetadata {
    return {
      id: this.manifest.id,
      name: this.manifest.name,
      version: this.manifest.version,
      backend: this.backend,
      quantization: this.manifest.quantization,
      supportedLanguages: [...this.manifest.supportedLanguages],
      maximumTokens: this.manifest.maximumTokens,
      supportsBatching: false,
    };
  }

  private clearInitialization(initialization: Promise<void>): void {
    if (this.initialization === initialization) {
      this.initialization = undefined;
    }
  }

  private clearDisposal(disposal: Promise<void>): void {
    if (this.disposal === disposal) this.disposal = undefined;
  }
}

function compactInputs(output: TokenizerOutput): Record<string, unknown> {
  return {
    input_ids: output.input_ids,
    ...(output.attention_mask === undefined
      ? {}
      : { attention_mask: output.attention_mask }),
    ...(output.token_type_ids === undefined
      ? {}
      : { token_type_ids: output.token_type_ids }),
  };
}

function offsetsFromDecodedPrefixes(
  text: string,
  tokenIds: readonly number[],
  tokenizer: LocalTokenizer,
): ModelTokenOffset[] {
  let previousEnd = 0;

  return tokenIds.map((_, index) => {
    const decoded = tokenizer.decode(tokenIds.slice(0, index + 1), {
      clean_up_tokenization_spaces: false,
      skip_special_tokens: true,
    });
    if (
      !text.startsWith(decoded) ||
      decoded.length <= previousEnd ||
      decoded.length > text.length
    ) {
      throw new CleanFeedError(
        "TOKENIZATION_FAILED",
        "MODEL_TOKEN_OFFSETS_UNAVAILABLE",
      );
    }

    const offset = { start: previousEnd, end: decoded.length };
    previousEnd = offset.end;
    return offset;
  });
}

function tokenIds(value: unknown): number[] {
  const values = arrayValues(value);
  const ids =
    values.length === 1 && Array.isArray(values[0]) ? values[0] : values;
  const normalized = ids.map(toTokenId);
  if (normalized.some((id) => id === undefined)) {
    inferenceFailed("Tokenizer emitted invalid IDs.");
  }
  return normalized as number[];
}

function arrayValues(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "data" in value &&
    ArrayBuffer.isView(value.data)
  ) {
    return Array.from(value.data as unknown as ArrayLike<unknown>);
  }
  inferenceFailed("Tokenizer output has an invalid shape.");
}

function validateTokens(tokens: ModelTokens, maximumTokens: number): void {
  if (
    !Array.isArray(tokens.inputIds) ||
    !tokens.inputIds.every(isSafeNumber) ||
    !Number.isSafeInteger(tokens.specialTokenCount) ||
    tokens.specialTokenCount < 0 ||
    tokens.specialTokenCount > tokens.inputIds.length ||
    tokens.inputIds.length > maximumTokens
  ) {
    inferenceFailed("Model input has an invalid length.");
  }
}

function parseScores(
  output: Record<string, unknown>,
  manifest: CleanFeedModelManifest,
): [number, number] {
  const values = output[manifest.output.name];
  const row = scoreRow(values);
  if (row.length !== 2 || !row.every(Number.isFinite)) {
    inferenceFailed("Model output has an invalid shape.");
  }

  if (manifest.output.kind === "logits") return softmax(row);

  const total = row[0]! + row[1]!;
  if (
    row.some((score) => score < 0 || score > 1) ||
    total < 0.999 ||
    total > 1.001
  ) {
    inferenceFailed("Model probabilities must sum to one.");
  }
  return [row[0]!, row[1]!];
}

function scoreRow(value: unknown): number[] {
  if (Array.isArray(value)) {
    if (value.length !== 1 || !Array.isArray(value[0])) {
      inferenceFailed("Model output has an invalid shape.");
    }
    return value[0] as number[];
  }
  if (
    typeof value === "object" &&
    value !== null &&
    "dims" in value &&
    Array.isArray(value.dims) &&
    value.dims.length === 2 &&
    value.dims[0] === 1 &&
    value.dims[1] === 2 &&
    "data" in value &&
    ArrayBuffer.isView(value.data)
  ) {
    return Array.from(value.data as unknown as ArrayLike<unknown>).map(Number);
  }
  inferenceFailed("Model output has an invalid shape.");
}

function softmax([first, second]: number[]): [number, number] {
  const maximum = Math.max(first!, second!);
  const firstExponent = Math.exp(first! - maximum);
  const secondExponent = Math.exp(second! - maximum);
  const total = firstExponent + secondExponent;
  return [firstExponent / total, secondExponent / total];
}

function isSafeNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function toTokenId(value: unknown): number | undefined {
  if (isSafeNumber(value)) return value;
  if (
    typeof value === "bigint" &&
    value >= BigInt(Number.MIN_SAFE_INTEGER) &&
    value <= BigInt(Number.MAX_SAFE_INTEGER)
  ) {
    return Number(value);
  }
  return undefined;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new DOMException("The classification was aborted.", "AbortError");
  }
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function inferenceFailed(message: string): never {
  throw new CleanFeedError("INFERENCE_FAILED", message);
}
