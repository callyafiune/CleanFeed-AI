import { describe, expect, it } from "vitest";

import { assessEvidence, type EvidenceInput } from "@/inference/evidence";

function input(overrides: Partial<EvidenceInput> = {}): EvidenceInput {
  return {
    locale: "pt-BR",
    wordCount: 200,
    coverage: 1,
    lexicalRatio: 1,
    stdDev: 0.05,
    chunkAgreement: 0.9,
    truncated: false,
    exactTokenizer: true,
    backendError: false,
    artifactMismatch: false,
    ...overrides,
  };
}

describe("assessEvidence", () => {
  it("rates a clean, well-covered PT-BR document as sufficient", () => {
    const assessment = assessEvidence(input());

    expect(assessment.quality).toBe("sufficient");
    expect(assessment.reasonCodes).toEqual([]);
    expect(assessment.coverage).toBe(1);
    expect(assessment.lexicalRatio).toBe(1);
    expect(assessment.exactTokenizer).toBe(true);
    expect(assessment.truncated).toBe(false);
  });

  describe("precedence 1: hard unsupported conditions", () => {
    it.each([
      ["artifact mismatch", { artifactMismatch: true }, "ARTIFACT_MISMATCH"],
      ["backend error", { backendError: true }, "BACKEND_ERROR"],
      ["non pt-BR locale", { locale: "en" }, "UNSUPPORTED_LANGUAGE"],
      ["european portuguese", { locale: "pt-PT" }, "UNSUPPORTED_LANGUAGE"],
      ["below 50 words", { wordCount: 49 }, "TEXT_TOO_SHORT"],
      ["approximate tokenizer", { exactTokenizer: false }, "TOKENIZER_APPROXIMATE"],
    ] as const)("is unsupported for %s", (_label, override, reasonCode) => {
      const assessment = assessEvidence(input(override));

      expect(assessment.quality).toBe("unsupported");
      expect(assessment.reasonCodes).toContain(reasonCode);
    });

    it("normalizes bare pt to the pt-BR calibration locale", () => {
      expect(assessEvidence(input({ locale: "pt" })).quality).toBe("sufficient");
      expect(assessEvidence(input({ locale: "PT-br" })).quality).toBe(
        "sufficient",
      );
    });

    it("keeps a 50-word document eligible", () => {
      expect(assessEvidence(input({ wordCount: 50 })).quality).toBe(
        "sufficient",
      );
    });
  });

  describe("precedence 2: coverage/lexical floors are unsupported", () => {
    it("is unsupported below 0.50 coverage", () => {
      const assessment = assessEvidence(input({ coverage: 0.49 }));

      expect(assessment.quality).toBe("unsupported");
      expect(assessment.reasonCodes).toContain("LOW_COVERAGE");
    });

    it("is unsupported below 0.40 lexical ratio", () => {
      const assessment = assessEvidence(input({ lexicalRatio: 0.39 }));

      expect(assessment.quality).toBe("unsupported");
      expect(assessment.reasonCodes).toContain("NON_LEXICAL_CONTENT");
    });
  });

  describe("precedence 3: intermediate ranges are limited", () => {
    it.each([
      ["coverage in [0.50, 0.95)", { coverage: 0.9 }, "LOW_COVERAGE"],
      ["lexical ratio in [0.40, 0.60)", { lexicalRatio: 0.5 }, "NON_LEXICAL_CONTENT"],
      ["stdDev above 0.25", { stdDev: 0.3 }, "CHUNK_DISAGREEMENT"],
      ["chunk agreement below 0.50", { chunkAgreement: 0.4 }, "CHUNK_DISAGREEMENT"],
    ] as const)("is limited for %s", (_label, override, reasonCode) => {
      const assessment = assessEvidence(input(override));

      expect(assessment.quality).toBe("limited");
      expect(assessment.reasonCodes).toContain(reasonCode);
    });
  });

  describe("precedence 4: boundary values stay sufficient", () => {
    it.each([
      ["coverage exactly 0.95", { coverage: 0.95 }],
      ["lexical ratio exactly 0.60", { lexicalRatio: 0.6 }],
      ["stdDev exactly 0.25", { stdDev: 0.25 }],
      ["chunk agreement exactly 0.50", { chunkAgreement: 0.5 }],
    ] as const)("is sufficient at %s", (_label, override) => {
      expect(assessEvidence(input(override)).quality).toBe("sufficient");
    });
  });

  describe("truncation", () => {
    it("always records TRUNCATED_INPUT but never downgrades a full-coverage entry", () => {
      const assessment = assessEvidence(input({ truncated: true }));

      expect(assessment.quality).toBe("sufficient");
      expect(assessment.truncated).toBe(true);
      expect(assessment.reasonCodes).toEqual(["TRUNCATED_INPUT"]);
    });

    it("records TRUNCATED_INPUT alongside a limited downgrade", () => {
      const assessment = assessEvidence(
        input({ truncated: true, coverage: 0.9 }),
      );

      expect(assessment.quality).toBe("limited");
      expect(assessment.reasonCodes).toEqual(["LOW_COVERAGE", "TRUNCATED_INPUT"]);
    });
  });

  it("lets unsupported win over limited when both fire", () => {
    const assessment = assessEvidence(input({ coverage: 0.4, stdDev: 0.3 }));

    expect(assessment.quality).toBe("unsupported");
    expect(assessment.reasonCodes).toEqual(["CHUNK_DISAGREEMENT", "LOW_COVERAGE"]);
  });

  it("accumulates reason codes in enum order without duplicates", () => {
    const assessment = assessEvidence(
      input({
        artifactMismatch: true,
        backendError: true,
        locale: "en",
        wordCount: 10,
        exactTokenizer: false,
        coverage: 0.4,
        lexicalRatio: 0.3,
        stdDev: 0.3,
        chunkAgreement: 0.2,
        truncated: true,
      }),
    );

    expect(assessment.quality).toBe("unsupported");
    expect(assessment.reasonCodes).toEqual([
      "CHUNK_DISAGREEMENT",
      "UNSUPPORTED_LANGUAGE",
      "TEXT_TOO_SHORT",
      "LOW_COVERAGE",
      "TRUNCATED_INPUT",
      "TOKENIZER_APPROXIMATE",
      "NON_LEXICAL_CONTENT",
      "BACKEND_ERROR",
      "ARTIFACT_MISMATCH",
    ]);
  });
});
