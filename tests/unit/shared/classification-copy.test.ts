import { describe, expect, it } from "vitest";

import {
  AUTHORSHIP_CLAIM_PATTERNS,
  CLASSIFICATION_STATUS_COPY,
  EVIDENCE_QUALITY_COPY,
  FEEDBACK_COPY,
  overclaimIn,
  PRESENTATION_COPY,
  PROBABILISTIC_DISCLOSURE,
  PRODUCT_TARGET,
  TECHNICAL_SCORE_DISCLAIMER,
  userFacingCopy,
} from "@/shared/classification-copy";

// B2 — the product target is frozen: the detector indicates TEXTUAL
// COMPATIBILITY with AI generation and never infers authorship, intent or a real
// writing process. These tests are the mechanism that makes an over-claiming
// string impossible rather than merely unlikely: `userFacingCopy()` walks the one
// tree every export is derived from, so a new string is swept the moment it is
// added, without anybody remembering to list it here.

describe("the frozen product target", () => {
  it("is textual compatibility, never authorship", () => {
    expect(PRODUCT_TARGET).toBe("textual-compatibility-with-ai-generation");
  });

  it("says compatibility and denies proof of origin in the mandatory disclosure", () => {
    expect(PROBABILISTIC_DISCLOSURE).toMatch(/compat[íi]veis/u);
    expect(PROBABILISTIC_DISCLOSURE).toMatch(/n[ãa]o comprova/u);
  });

  it("denies that the calibrated score is a probability of authorship", () => {
    expect(TECHNICAL_SCORE_DISCLAIMER).toMatch(/n[ãa]o equivale/u);
  });
});

describe("userFacingCopy", () => {
  it("covers every published copy export", () => {
    const strings = userFacingCopy().map((entry) => entry.text);
    const published = [
      PROBABILISTIC_DISCLOSURE,
      TECHNICAL_SCORE_DISCLAIMER,
      ...Object.values(CLASSIFICATION_STATUS_COPY),
      ...Object.values(EVIDENCE_QUALITY_COPY),
      ...Object.values(PRESENTATION_COPY).flatMap((mode) => [
        mode.message,
        mode.reveal,
      ]),
      ...Object.values(FEEDBACK_COPY),
    ];
    for (const text of published) expect(strings).toContain(text);
  });

  it("names the path of every string, so a failure says which one broke", () => {
    for (const entry of userFacingCopy()) {
      expect(entry.path).toMatch(/^[A-Za-z0-9_.-]+$/u);
      expect(entry.text.length).toBeGreaterThan(0);
    }
  });
});

describe("no message asserts authorship, intent or a real process", () => {
  it("holds for every user-facing string this module publishes", () => {
    const offenders = userFacingCopy()
      .map((entry) => ({ ...entry, claim: overclaimIn(entry.text) }))
      .filter((entry) => entry.claim !== null);
    expect(offenders).toEqual([]);
  });

  it("catches the claims it is there to catch", () => {
    // Each of these is a sentence a well-meaning copy edit could produce, and
    // each is a claim the frozen target forbids.
    for (const forbidden of [
      "Este texto foi escrito por IA.",
      "Texto gerado por IA.",
      "A autoria deste texto é de uma IA.",
      "Este texto é de IA.",
      "O autor usou ChatGPT para escrever isto.",
      "O texto foi produzido por um modelo de linguagem.",
    ]) {
      expect(overclaimIn(forbidden)).not.toBeNull();
    }
  });

  it("does not fire on the compatibility phrasing the product actually uses", () => {
    for (const allowed of [
      PROBABILISTIC_DISCLOSURE,
      TECHNICAL_SCORE_DISCLAIMER,
      "Texto desfocado porque foram detectados sinais compatíveis com geração ou edição por IA.",
      "Sinais detectados",
    ]) {
      expect(overclaimIn(allowed)).toBeNull();
    }
  });

  it("publishes the patterns it screens with, so the rule is auditable", () => {
    expect(AUTHORSHIP_CLAIM_PATTERNS.length).toBeGreaterThan(0);
    for (const pattern of AUTHORSHIP_CLAIM_PATTERNS) {
      expect(pattern.flags).toContain("u");
      // Stateless: a `g`/`y` flag would make `test` depend on call order.
      expect(pattern.flags).not.toContain("g");
      expect(pattern.flags).not.toContain("y");
    }
  });
});

describe("no copy promises a visual action for the warning-only targets", () => {
  it("keeps visual-action wording inside PRESENTATION_COPY", () => {
    // Material assistance and observed spans authorize `indicator` only, so no
    // string outside the three reversible presentation modes may announce that
    // text was hidden, blurred or collapsed.
    const visualActionWords = /desfocad|recolhid|ocultad/u;
    const outsidePresentation = userFacingCopy().filter(
      (entry) => !entry.path.startsWith("presentation."),
    );
    for (const entry of outsidePresentation) {
      expect(entry.text).not.toMatch(visualActionWords);
    }
    for (const mode of Object.values(PRESENTATION_COPY)) {
      expect(mode.message).toMatch(visualActionWords);
    }
  });
});
