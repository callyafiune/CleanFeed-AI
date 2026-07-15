import { describe, expect, it } from "vitest";

import {
  evaluateEligibility,
  type EligibilityInput,
} from "@/inference/eligibility";

function baseInput(text: string): EligibilityInput {
  return {
    text,
    enabled: true,
    domainEnabled: true,
    modelAvailable: true,
    extractionSucceeded: true,
    duplicateContent: false,
    experimentalShortTextDetection: false,
  };
}

describe("evaluateEligibility", () => {
  it.each([
    ["palavra ".repeat(49), "BELOW_MINIMUM_LENGTH"],
    [
      Array.from({ length: 100 }, (_, index) => `https://e.dev/${index}`).join(
        " ",
      ),
      "MOSTLY_LINKS",
    ],
    [
      Array.from({ length: 100 }, (_, index) => `#tag${index}`).join(" "),
      "MOSTLY_HASHTAGS",
    ],
    ["😀 ".repeat(100), "MOSTLY_EMOJIS"],
    [
      [
        "Ana Silva",
        "Bruno Souza",
        "Carla Lima",
        "Daniel Costa",
        "Eva Rocha",
      ].join("\n"),
      "INSUFFICIENT_CONTENT",
    ],
  ])("rejects ineligible content", (text, reason) => {
    expect(evaluateEligibility(baseInput(text)).reason).toBe(reason);
  });

  it("allows 50 to 79 words only in experimental mode", () => {
    expect(evaluateEligibility(baseInput("texto ".repeat(60))).eligible).toBe(
      false,
    );
    expect(
      evaluateEligibility({
        ...baseInput("texto ".repeat(60)),
        experimentalShortTextDetection: true,
      }).eligible,
    ).toBe(true);
  });

  it.each([
    ["enabled", false, "EXTENSION_DISABLED"],
    ["domainEnabled", false, "DOMAIN_DISABLED"],
    ["modelAvailable", false, "MODEL_UNAVAILABLE"],
    ["extractionSucceeded", false, "EXTRACTION_FAILED"],
    ["duplicateContent", true, "DUPLICATE_CONTENT"],
  ] as const)(
    "short-circuits %s flags before text heuristics",
    (key, value, reason) => {
      expect(
        evaluateEligibility({
          ...baseInput("texto ".repeat(100)),
          [key]: value,
        }),
      ).toEqual({ eligible: false, reason });
    },
  );

  it("accepts ordinary content at the configured minimum", () => {
    expect(evaluateEligibility(baseInput("conteúdo ".repeat(100)))).toEqual({
      eligible: true,
      reason: "ELIGIBLE",
    });
  });
});
