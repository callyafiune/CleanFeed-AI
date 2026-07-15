import { describe, expect, it } from "vitest";

import { normalizeText } from "@/shared/text-normalization";

describe("normalizeText", () => {
  it("normalizes whitespace while preserving semantic text characters", () => {
    expect(
      normalizeText(
        "  Olá\u200B,   MUNDO!\r\n\r\n#IA https://exemplo.dev 😀  ",
      ),
    ).toBe("Olá, MUNDO!\n\n#IA https://exemplo.dev 😀");
  });

  it("limits consecutive blank lines to two", () => {
    expect(normalizeText("primeira\n\n\n\nsegunda")).toBe(
      "primeira\n\nsegunda",
    );
  });

  it("preserves zero-width joiners used to compose emojis", () => {
    expect(normalizeText("família 👨‍👩‍👧‍👦")).toBe("família 👨‍👩‍👧‍👦");
  });
});
