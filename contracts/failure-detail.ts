// The shared, CLOSED vocabulary for the sanitized failure detail that travels
// with every `status: "error"` scoring outcome.
//
// Why this module exists: 325 test-partition records failed inference under a
// single opaque `INFERENCE_FAILED`, and three distinct origins collapsed into
// that one code, so the cause was not determinable from the artifacts at all.
// A detail field alone would not be safe — an underlying runtime message can
// echo its input back, and a prediction row must NEVER carry document text.
// So the detail is not a message: it is an ALLOWLISTED code, optionally
// followed by one of OUR OWN literal technical messages. Anything else is
// reduced deterministically to a code, and free text is discarded.
//
// Shared contract: it is imported by the candidate page (`src/model-benchmark`)
// that PRODUCES the detail and by the benchmark row parser
// (`benchmark/prediction-schema.ts`) that VALIDATES it, so the two sides can
// never drift. Pure: no I/O, no Date, no randomness. It deliberately does not
// import from `src/`, so the standalone benchmark package can use it.
//
// The validator is defined as a fixed point of the producer:
// `isSanitizedFailureDetail(d)` iff `sanitizeFailureDetail(d) === d`. That makes
// "no document text can be stored" a property of one function rather than of two
// lists that have to agree.

/** Hard cap on a stored detail, in UTF-16 code units. */
export const FAILURE_DETAIL_MAX_LENGTH = 160;

/**
 * Every code a failure detail may name. The first four are the ones the v3
 * rebuild plan's window-slack decision keys on, so they must stay separately
 * observable; the rest exist because collapsing them would recreate exactly the
 * defect this module was written to remove.
 */
export const FAILURE_DETAIL_CODES = [
  // Causes the long-document correction discriminates on.
  "TOKEN_LIMIT_EXCEEDED",
  "WASM_OOM",
  "MODEL_TIMEOUT",
  "NON_FINITE_SCORE",
  // Aggregation branches that used to share one code with NON_FINITE_SCORE.
  "SCORE_OUT_OF_RANGE",
  "ZERO_UNIQUE_TOKEN_WEIGHT",
  "INVALID_TOTAL_TOKEN_COUNT",
  // Classifier-side guards, each with its own literal message.
  "INVALID_MODEL_INPUT_LENGTH",
  "TOKENIZER_INVALID_IDS",
  "TOKENIZER_INVALID_SHAPE",
  "MODEL_INPUTS_MISSING",
  "MODEL_OUTPUT_INVALID_SHAPE",
  "MODEL_PROBABILITIES_UNNORMALIZED",
  "CLASSIFIER_NOT_INITIALIZED",
  "ONNX_INFERENCE_FAILED",
  // Harness/assembly outcomes that also produce an error row.
  "MODEL_ARTIFACT_MISSING",
  "RUNTIME_PARITY_IDENTITY_MISMATCH",
  "MODEL_BENCHMARK_FAILED",
  "MODEL_LOAD_FAILED",
  "TOKENIZATION_FAILED",
  "INFERENCE_FAILED",
  "INFERENCE_TIMEOUT",
  "INSUFFICIENT_EVIDENCE",
  // The deterministic reduction for anything outside this allowlist.
  "UNCLASSIFIED_RUNTIME_FAILURE",
] as const;

export type FailureDetailCode = (typeof FAILURE_DETAIL_CODES)[number];

/** What any unrecognized failure reduces to. Never an empty detail. */
export const UNCLASSIFIED_FAILURE_DETAIL_CODE =
  "UNCLASSIFIED_RUNTIME_FAILURE" satisfies FailureDetailCode;

const CODES: ReadonlySet<string> = new Set<string>(FAILURE_DETAIL_CODES);

/**
 * Exact-match allowlist of OUR OWN thrown literals. Exact match is what makes
 * this safe to echo verbatim: these strings are source constants, so a document
 * excerpt can never equal one. Keep it in sync with the throw sites — the
 * propagation test asserts each site's real message lands here.
 */
const KNOWN_FAILURE_MESSAGES: ReadonlyMap<string, FailureDetailCode> = new Map([
  ["Model input exceeds the model token limit.", "TOKEN_LIMIT_EXCEEDED"],
  ["Model input has an invalid length.", "INVALID_MODEL_INPUT_LENGTH"],
  ["Tokenizer emitted invalid IDs.", "TOKENIZER_INVALID_IDS"],
  ["Tokenizer output has an invalid shape.", "TOKENIZER_INVALID_SHAPE"],
  ["Model inputs are missing.", "MODEL_INPUTS_MISSING"],
  ["Model output has an invalid shape.", "MODEL_OUTPUT_INVALID_SHAPE"],
  ["Model probabilities must sum to one.", "MODEL_PROBABILITIES_UNNORMALIZED"],
  [
    "Classifier must be initialized before classification.",
    "CLASSIFIER_NOT_INITIALIZED",
  ],
  ["ONNX inference failed.", "ONNX_INFERENCE_FAILED"],
  ["Tokenizer is not loaded.", "MODEL_LOAD_FAILED"],
  ["Model is not loaded.", "MODEL_LOAD_FAILED"],
]);

/**
 * Pattern allowlist for messages we do NOT own (Transformers.js, onnxruntime,
 * the WASM heap). A pattern match yields the BARE code and discards the message,
 * so nothing that matched can be reconstructed from the stored detail. A pattern
 * may therefore be liberal without becoming a privacy risk; the cost of a wrong
 * guess is a wrong code, which is why each pattern is a phrase these runtimes
 * actually emit rather than a single word.
 */
const RUNTIME_FAILURE_PATTERNS: readonly (readonly [
  RegExp,
  FailureDetailCode,
])[] = [
  [/\bout of memory\b/iu, "WASM_OOM"],
  [/\bcannot enlarge memory\b/iu, "WASM_OOM"],
  [/\bmemory access out of bounds\b/iu, "WASM_OOM"],
  [/\ballocation (?:failed|size overflow)\b/iu, "WASM_OOM"],
  [/\bfailed to allocate\b/iu, "WASM_OOM"],
  [/\bwasm memory\b/iu, "WASM_OOM"],
  [/\btimed out\b/iu, "MODEL_TIMEOUT"],
  [/\btimeout\b/iu, "MODEL_TIMEOUT"],
  [/\bdeadline exceeded\b/iu, "MODEL_TIMEOUT"],
];

/** Deterministic cap: keep the first {@link FAILURE_DETAIL_MAX_LENGTH} units. */
export function truncateFailureDetail(detail: string): string {
  return detail.length <= FAILURE_DETAIL_MAX_LENGTH
    ? detail
    : detail.slice(0, FAILURE_DETAIL_MAX_LENGTH);
}

function isFailureDetailCode(value: string): value is FailureDetailCode {
  return CODES.has(value);
}

function messageOf(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof (value as { message: unknown }).message === "string"
  ) {
    return (value as { message: string }).message;
  }
  return undefined;
}

function causeOf(value: unknown): unknown {
  if (typeof value === "object" && value !== null && "cause" in value) {
    return (value as { cause: unknown }).cause;
  }
  return undefined;
}

/**
 * The messages of a thrown value and its `cause` chain, INNERMOST FIRST. The
 * wrapper says "ONNX inference failed"; the cause says why — so the cause must
 * be classified first or the wrapper would mask it, which is the exact defect
 * this module removes. The depth cap also makes a cyclic chain terminate.
 */
function failureMessageChain(value: unknown): string[] {
  const messages: string[] = [];
  let current: unknown = value;
  for (
    let depth = 0;
    depth < 8 && current !== undefined && current !== null;
    depth += 1
  ) {
    const message = messageOf(current);
    if (message !== undefined && message !== "") messages.push(message);
    current = causeOf(current);
  }
  return messages.reverse();
}

/**
 * Recognizes an ALREADY sanitized detail (which makes the function idempotent):
 * a bare code, or a code followed by exactly the allowlisted message that maps
 * to it. A valid code carrying anything else is reduced to the code alone, so
 * free text can never ride along behind a legitimate prefix.
 */
function recognizeSanitizedDetail(message: string): string | undefined {
  const separator = message.indexOf(": ");
  const code = separator === -1 ? message : message.slice(0, separator);
  if (!isFailureDetailCode(code)) return undefined;
  if (separator === -1) return code;
  const remainder = message.slice(separator + 2);
  return KNOWN_FAILURE_MESSAGES.get(remainder) === code
    ? truncateFailureDetail(message)
    : code;
}

function classifyMessage(message: string): string | undefined {
  const recognized = recognizeSanitizedDetail(message);
  if (recognized !== undefined) return recognized;

  const known = KNOWN_FAILURE_MESSAGES.get(message);
  if (known !== undefined) return truncateFailureDetail(`${known}: ${message}`);

  for (const [pattern, code] of RUNTIME_FAILURE_PATTERNS) {
    if (pattern.test(message)) return code;
  }
  return undefined;
}

/**
 * Reduces any thrown value to a storable failure detail. The result is ALWAYS a
 * non-empty allowlisted code, optionally followed by one of our own literal
 * messages, and never longer than {@link FAILURE_DETAIL_MAX_LENGTH}. No
 * substring of an unrecognized message survives — that is the whole point: the
 * detail is diagnostic metadata, and prediction rows carry no content.
 */
export function sanitizeFailureDetail(value: unknown): string {
  for (const message of failureMessageChain(value)) {
    const detail = classifyMessage(message);
    if (detail !== undefined) return detail;
  }
  return UNCLASSIFIED_FAILURE_DETAIL_CODE;
}

/**
 * The detail an error outcome carries, given the harness's own reason code and
 * the thrown value when there is one.
 *
 * `cause` wins when the allowlist can classify it, because it names the real
 * origin. It loses in exactly two cases: there was no throwable at all (an
 * assembly failure such as a missing artifact or a parity mismatch), or the
 * chain reduced to {@link UNCLASSIFIED_FAILURE_DETAIL_CODE} — and a reason code
 * is strictly more informative than "unclassified".
 *
 * This lives in the contract rather than beside its single caller because the
 * caller (`errorScore` in `src/model-benchmark/main.ts`) is browser-only, so this
 * rule would otherwise be reachable only through a real Chrome run.
 */
export function selectFailureDetail(
  reasonCode: string,
  cause?: unknown,
): string {
  const fromCause =
    cause === undefined ? undefined : sanitizeFailureDetail(cause);
  return fromCause === undefined ||
    fromCause === UNCLASSIFIED_FAILURE_DETAIL_CODE
    ? sanitizeFailureDetail(reasonCode)
    : fromCause;
}

/**
 * True when `value` is exactly what {@link sanitizeFailureDetail} would emit for
 * it. Defining the validator as the producer's fixed point means a row can only
 * store a detail that the sanitizer itself would have produced.
 */
export function isSanitizedFailureDetail(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > FAILURE_DETAIL_MAX_LENGTH) {
    return false;
  }
  return sanitizeFailureDetail(value) === value;
}
