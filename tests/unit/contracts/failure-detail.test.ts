import { describe, expect, it } from "vitest";

import { ERROR_CODES } from "@/shared/errors";

import {
  FAILURE_DETAIL_CODES,
  FAILURE_DETAIL_MAX_LENGTH,
  isSanitizedFailureDetail,
  KNOWN_FAILURE_MESSAGES,
  sanitizeFailureDetail,
  selectFailureDetail,
  truncateFailureDetail,
  UNCLASSIFIED_FAILURE_DETAIL_CODE,
} from "../../../contracts/failure-detail.ts";

// A real pt-BR excerpt standing in for corpus text. It must NEVER reach a
// prediction row: a failure detail is diagnostic metadata, not content.
const DOCUMENT_EXCERPT =
  "O Supremo Tribunal Federal negou provimento ao recurso extraordinário " +
  "interposto pela recorrente, por unanimidade, nos termos do voto do relator.";

describe("sanitizeFailureDetail", () => {
  it.each([
    ["Model input exceeds the model token limit.", "TOKEN_LIMIT_EXCEEDED"],
    ["Model input has an invalid length.", "INVALID_MODEL_INPUT_LENGTH"],
    ["Tokenizer emitted invalid IDs.", "TOKENIZER_INVALID_IDS"],
    ["Tokenizer output has an invalid shape.", "TOKENIZER_INVALID_SHAPE"],
    ["Model inputs are missing.", "MODEL_INPUTS_MISSING"],
    ["Model output has an invalid shape.", "MODEL_OUTPUT_INVALID_SHAPE"],
    [
      "Model probabilities must sum to one.",
      "MODEL_PROBABILITIES_UNNORMALIZED",
    ],
    [
      "Classifier must be initialized before classification.",
      "CLASSIFIER_NOT_INITIALIZED",
    ],
    ["ONNX inference failed.", "ONNX_INFERENCE_FAILED"],
  ])("keeps the known technical message %s readable", (message, code) => {
    expect(sanitizeFailureDetail(new Error(message))).toBe(
      `${code}: ${message}`,
    );
  });

  it("classifies an underlying WASM allocation failure without keeping its text", () => {
    const detail = sanitizeFailureDetail(
      new Error("Aborted(). RuntimeError: memory access out of bounds"),
    );

    expect(detail).toBe("WASM_OOM");
    expect(detail).not.toContain("Aborted");
  });

  it.each([
    ["failed to allocate memory: Out of memory", "WASM_OOM"],
    ["Cannot enlarge memory arrays to size 2147483648 bytes", "WASM_OOM"],
    ["Array buffer allocation failed", "WASM_OOM"],
    ["ort session run timed out after 60000 ms", "MODEL_TIMEOUT"],
    ["Deadline exceeded while waiting for the session", "MODEL_TIMEOUT"],
  ])("reduces the runtime message %s to a bare code", (message, code) => {
    expect(sanitizeFailureDetail(new Error(message))).toBe(code);
  });

  it("prefers the innermost cause over the wrapper that discarded it", () => {
    const wrapped = new Error("ONNX inference failed.", {
      cause: new Error("wasm function: out of memory"),
    });

    expect(sanitizeFailureDetail(wrapped)).toBe("WASM_OOM");
  });

  it("falls back to the wrapper when the cause is unclassifiable", () => {
    const wrapped = new Error("ONNX inference failed.", {
      cause: new Error("something nobody has seen before"),
    });

    expect(sanitizeFailureDetail(wrapped)).toBe(
      "ONNX_INFERENCE_FAILED: ONNX inference failed.",
    );
  });

  it("never lets document text survive, at any depth of the cause chain", () => {
    const direct = sanitizeFailureDetail(new Error(DOCUMENT_EXCERPT));
    const nested = sanitizeFailureDetail(
      new Error("ONNX inference failed.", {
        cause: new Error(`tokenizer rejected: ${DOCUMENT_EXCERPT}`),
      }),
    );

    expect(direct).toBe(UNCLASSIFIED_FAILURE_DETAIL_CODE);
    for (const word of ["Supremo", "recorrente", "relator", "recurso"]) {
      expect(direct).not.toContain(word);
      expect(nested).not.toContain(word);
    }
  });

  it("refuses to carry free text smuggled behind a valid code", () => {
    expect(sanitizeFailureDetail(`WASM_OOM: ${DOCUMENT_EXCERPT}`)).toBe(
      "WASM_OOM",
    );
  });

  it("reduces every unrecognized shape to the generic code, never to an empty string", () => {
    for (const value of [
      undefined,
      null,
      42,
      {},
      [],
      "",
      new Error(""),
      Symbol("boom"),
    ]) {
      expect(sanitizeFailureDetail(value)).toBe(
        UNCLASSIFIED_FAILURE_DETAIL_CODE,
      );
    }
  });

  it("survives a hostile accessor instead of taking the error path down with it", () => {
    // This function sits on the ONLY path that turns a throw into an error row:
    // if it throws, `score()` rejects, `runBrowserScore` has no per-document
    // catch, and the whole partition aborts mid-shard. A throw here must not
    // destroy the row it exists to make safe.
    const throwingCause = {
      message: "out of memory",
      get cause(): unknown {
        throw new Error("boom");
      },
    };
    const throwingMessage = {
      get message(): unknown {
        throw new Error("boom");
      },
    };

    expect(() => sanitizeFailureDetail(throwingCause)).not.toThrow();
    expect(sanitizeFailureDetail(throwingCause)).toBe("WASM_OOM");
    expect(() => sanitizeFailureDetail(throwingMessage)).not.toThrow();
    expect(sanitizeFailureDetail(throwingMessage)).toBe(
      UNCLASSIFIED_FAILURE_DETAIL_CODE,
    );
  });

  it("survives a cyclic cause chain instead of looping forever", () => {
    const inner: Error & { cause?: unknown } = new Error("inner");
    const outer = new Error("ONNX inference failed.", { cause: inner });
    inner.cause = outer;

    expect(sanitizeFailureDetail(outer)).toBe(
      "ONNX_INFERENCE_FAILED: ONNX inference failed.",
    );
  });

  it("is idempotent: every detail it emits is its own fixed point", () => {
    const inputs = [
      new Error("Model input exceeds the model token limit."),
      new Error("out of memory"),
      new Error(DOCUMENT_EXCERPT),
      "NON_FINITE_SCORE",
    ];
    for (const input of inputs) {
      const once = sanitizeFailureDetail(input);
      expect(sanitizeFailureDetail(once)).toBe(once);
      expect(once.length).toBeLessThanOrEqual(FAILURE_DETAIL_MAX_LENGTH);
    }
  });

  it("emits every allowlisted code as a recognized fixed point within the limit", () => {
    for (const code of FAILURE_DETAIL_CODES) {
      expect(sanitizeFailureDetail(code)).toBe(code);
      expect(isSanitizedFailureDetail(code)).toBe(true);
      expect(code.length).toBeLessThanOrEqual(FAILURE_DETAIL_MAX_LENGTH);
    }
  });

  it("emits every code+message PAIR as a recognized fixed point within the limit", () => {
    // Iterating the codes alone left the boundary unguarded: truncation breaks
    // the fixed point, because a cut `CODE: message` no longer matches the
    // allowlisted message on re-entry, so `isSanitizedFailureDetail` would
    // reject a detail the producer itself emitted and `validatePredictionRow`
    // would throw at parse time on a row we wrote. An allowlist entry long
    // enough to be truncated must fail HERE instead.
    expect(KNOWN_FAILURE_MESSAGES.size).toBeGreaterThan(0);
    for (const [message, code] of KNOWN_FAILURE_MESSAGES) {
      const detail = `${code}: ${message}`;

      expect(detail.length).toBeLessThanOrEqual(FAILURE_DETAIL_MAX_LENGTH);
      expect(sanitizeFailureDetail(new Error(message))).toBe(detail);
      expect(sanitizeFailureDetail(detail)).toBe(detail);
      expect(isSanitizedFailureDetail(detail)).toBe(true);
    }
  });
});

// Two hand-maintained vocabularies with no link drift silently, and this one had
// drifted in both directions: seven ErrorCodes were absent from the allowlist, so
// a reason code the runtime already knew exactly was stored as
// "UNCLASSIFIED_RUNTIME_FAILURE". `ERROR_CODES` exists as a value so this can be
// a red test rather than a comment.
describe("the failure-detail allowlist and ErrorCode", () => {
  it("allowlists every coded error class the runtime can raise", () => {
    const codes = new Set<string>(FAILURE_DETAIL_CODES);
    const missing = ERROR_CODES.filter((code) => !codes.has(code));

    expect(missing).toEqual([]);
  });

  it("names a reason code the runtime already knew, instead of discarding it", () => {
    expect(
      selectFailureDetail("INVALID_SETTINGS", new Error("INVALID_CHUNK_PLAN")),
    ).toBe("INVALID_SETTINGS");
    expect(selectFailureDetail("CACHE_ERROR", new Error("nothing known"))).toBe(
      "CACHE_ERROR",
    );
  });
});

// The six literals `encodeWithOffsets` can throw. They are ByteLevel/WordPiece
// offset-tiling guards on the FIRST call `scoreDocument` makes, i.e. exactly the
// class the diagnosis's §6.4 (Unicode) makes plausible for long Carolina
// documents. Collapsing them into a bare "TOKENIZATION_FAILED" reproduced, one
// layer down, the defect this module exists to remove: three different bugs with
// three different remedies would have been indistinguishable in a scored row.
describe("tokenizer offset-derivation failures", () => {
  const MODEL_RUNTIME_MESSAGES = [
    "The loaded tokenizer's token and id streams disagree.",
    "The loaded tokenizer emitted an invalid token id.",
    "The loaded tokenizer produced an invalid input_ids shape.",
    "A ByteLevel token does not fit the source byte layout.",
    "The ByteLevel token stream did not tile the source text.",
    "A tokenizer surface token used a non-ByteLevel character.",
  ] as const;

  it("gives each tokenizer guard its own code instead of one opaque one", () => {
    const details = MODEL_RUNTIME_MESSAGES.map((message) =>
      selectFailureDetail("TOKENIZATION_FAILED", new Error(message)),
    );

    expect(new Set(details).size).toBe(MODEL_RUNTIME_MESSAGES.length);
    for (const detail of details) {
      expect(detail).not.toBe("TOKENIZATION_FAILED");
      expect(detail).not.toBe(UNCLASSIFIED_FAILURE_DETAIL_CODE);
      expect(isSanitizedFailureDetail(detail)).toBe(true);
    }
  });
});

describe("truncateFailureDetail", () => {
  it("keeps the first 160 characters, deterministically", () => {
    const long = "A".repeat(200);

    expect(truncateFailureDetail(long)).toHaveLength(FAILURE_DETAIL_MAX_LENGTH);
    expect(truncateFailureDetail(long)).toBe(
      long.slice(0, FAILURE_DETAIL_MAX_LENGTH),
    );
    expect(truncateFailureDetail(long)).toBe(truncateFailureDetail(long));
  });

  it("leaves a detail at or under the limit untouched", () => {
    expect(truncateFailureDetail("WASM_OOM")).toBe("WASM_OOM");
    expect(truncateFailureDetail("B".repeat(FAILURE_DETAIL_MAX_LENGTH))).toBe(
      "B".repeat(FAILURE_DETAIL_MAX_LENGTH),
    );
  });
});

describe("isSanitizedFailureDetail", () => {
  it("accepts a bare code and a code with its own allowlisted message", () => {
    expect(isSanitizedFailureDetail("NON_FINITE_SCORE")).toBe(true);
    expect(
      isSanitizedFailureDetail("ONNX_INFERENCE_FAILED: ONNX inference failed."),
    ).toBe(true);
  });

  it("rejects a message paired with the wrong code", () => {
    expect(isSanitizedFailureDetail("WASM_OOM: ONNX inference failed.")).toBe(
      false,
    );
  });

  it("narrows to string, so no caller needs a cast to read the detail", () => {
    // Compile-time assertion: `value.length` only typechecks if the predicate
    // narrows. It is what lets benchmark/prediction-schema.ts stay cast-free.
    const value: unknown = "NON_FINITE_SCORE";

    expect(isSanitizedFailureDetail(value)).toBe(true);
    if (isSanitizedFailureDetail(value)) {
      expect(value.length).toBe("NON_FINITE_SCORE".length);
    }
  });

  it("rejects empty, oversized, non-string and free-text details", () => {
    expect(isSanitizedFailureDetail("")).toBe(false);
    expect(isSanitizedFailureDetail("X".repeat(161))).toBe(false);
    expect(isSanitizedFailureDetail(undefined)).toBe(false);
    expect(isSanitizedFailureDetail(7)).toBe(false);
    expect(isSanitizedFailureDetail(DOCUMENT_EXCERPT)).toBe(false);
  });
});

// `selectFailureDetail` is the exact detail-selection rule that `errorScore()` in
// src/model-benchmark/main.ts applies. It lives here, and is tested here, because
// main.ts is browser-only (it dynamically imports the Transformers.js runtime and
// reads an inlined model manifest), so the branch that decides WHICH detail a real
// error row carries had no unit coverage at all while it was a private function.
describe("selectFailureDetail", () => {
  it("prefers a classifiable cause over the reason code", () => {
    expect(
      selectFailureDetail(
        "INFERENCE_FAILED",
        new Error("Model input exceeds the model token limit."),
      ),
    ).toBe("TOKEN_LIMIT_EXCEEDED: Model input exceeds the model token limit.");
  });

  it("falls back to the reason code when the cause is unclassifiable", () => {
    // The reason code is strictly more informative than "unclassified", and the
    // document excerpt must not survive either way.
    const detail = selectFailureDetail(
      "MODEL_BENCHMARK_FAILED",
      new Error(DOCUMENT_EXCERPT),
    );

    expect(detail).toBe("MODEL_BENCHMARK_FAILED");
    expect(detail).not.toContain("Supremo");
    expect(detail).not.toContain("recorrente");
  });

  it("names the reason code when there is no cause at all", () => {
    // Assembly failures with no throwable: a missing artifact, a parity mismatch.
    expect(selectFailureDetail("MODEL_ARTIFACT_MISSING")).toBe(
      "MODEL_ARTIFACT_MISSING",
    );
    expect(selectFailureDetail("RUNTIME_PARITY_IDENTITY_MISMATCH")).toBe(
      "RUNTIME_PARITY_IDENTITY_MISMATCH",
    );
  });

  it("refuses to store INFERENCE_FAILED as a detail, since that says nothing", () => {
    // INFERENCE_FAILED is the exact code whose three collapsed origins created
    // this module. A row whose DETAIL reads "INFERENCE_FAILED" is
    // indistinguishable from a pre-instrumentation row, and it would make the
    // genuinely unknown population invisible: A2 tallies failureDetail to size
    // the residue, so unknowns must land under one countable code.
    expect(
      selectFailureDetail(
        "INFERENCE_FAILED",
        new Error("nobody has seen this"),
      ),
    ).toBe(UNCLASSIFIED_FAILURE_DETAIL_CODE);
    expect(selectFailureDetail("INFERENCE_FAILED")).toBe(
      UNCLASSIFIED_FAILURE_DETAIL_CODE,
    );
    // A classifiable cause still wins: the rule only governs the fallback.
    expect(
      selectFailureDetail("INFERENCE_FAILED", new Error("NON_FINITE_SCORE")),
    ).toBe("NON_FINITE_SCORE");
  });

  it("keeps a reason code that does name something", () => {
    // The fallback is only worthless for the one code that means "we do not
    // know"; every other reason code identifies a layer or a guard.
    expect(
      selectFailureDetail("TOKENIZATION_FAILED", new Error("nothing known")),
    ).toBe("TOKENIZATION_FAILED");
    expect(
      selectFailureDetail("MODEL_BENCHMARK_FAILED", new Error("nothing known")),
    ).toBe("MODEL_BENCHMARK_FAILED");
  });

  it("never yields an empty or unstorable detail, even for an unknown reason code", () => {
    // Each row pins the EXACT value, not just "non-empty and sanitized" — that
    // weaker assertion is what let an unclassifiable failure be filed under
    // "INFERENCE_FAILED" without any test noticing.
    for (const [reasonCode, cause, expected] of [
      ["INFERENCE_FAILED", undefined, UNCLASSIFIED_FAILURE_DETAIL_CODE],
      [
        "SOMETHING_NOBODY_ALLOWLISTED",
        undefined,
        UNCLASSIFIED_FAILURE_DETAIL_CODE,
      ],
      [
        "SOMETHING_NOBODY_ALLOWLISTED",
        new Error(DOCUMENT_EXCERPT),
        UNCLASSIFIED_FAILURE_DETAIL_CODE,
      ],
      ["INFERENCE_FAILED", new Error("out of memory"), "WASM_OOM"],
    ] as const) {
      const detail = selectFailureDetail(reasonCode, cause);

      expect(detail).toBe(expected);
      expect(detail.length).toBeGreaterThan(0);
      expect(isSanitizedFailureDetail(detail)).toBe(true);
    }
  });
});
