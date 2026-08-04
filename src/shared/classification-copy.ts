import classificationCopy from "@/shared/classification-copy.json";
import type {
  ClassificationResult,
  ClassificationStatus,
  EvidenceQuality,
  PresentationMode,
} from "@/shared/types";

/**
 * The single source of truth for the user-facing probabilistic copy and the two
 * mandatory caveats. Every presentation surface (feed badge, explanation panel,
 * reversible modes, manual analysis, options) imports from here so no component
 * keeps its own equivalent string. Three invariants live in this module:
 *
 * 1. The feed never claims authorship and never shows the raw/calibrated score;
 *    it speaks only in qualitative bands plus the mandatory disclosure below.
 * 2. The calibrated score is exposed ONLY in the advanced diagnostic, always
 *    paired with {@link TECHNICAL_SCORE_DISCLAIMER}, and never as the real
 *    probability that a text was authored by IA.
 * 3. NO string published here asserts authorship, intent or a real writing
 *    process. The frozen product target is {@link PRODUCT_TARGET}: textual
 *    COMPATIBILITY with AI generation. Invariant 3 is enforced rather than
 *    documented — {@link userFacingCopy} walks the one tree every export below is
 *    derived from, and `tests/unit/shared/classification-copy.test.ts` screens
 *    every string it yields with {@link overclaimIn}. A string added to this
 *    module is therefore swept without anybody remembering to list it anywhere.
 */

/**
 * What the detector estimates, as the frozen contract names it. It is NOT
 * user-facing copy: it is the identifier a surface can assert against, so the
 * claim the copy is allowed to make has one written form. Mirrors
 * `productTarget` in benchmark/preregistration-v4.json; the benchmark is
 * standalone and cannot be imported from the extension bundle, so the string is
 * pinned on both sides by test rather than shared by import.
 */
export const PRODUCT_TARGET: string = classificationCopy.productTarget;

/** The mandatory §7 disclosure shown wherever a signal is surfaced. */
export const PROBABILISTIC_DISCLOSURE: string =
  classificationCopy.probabilisticDisclosure;

/** The mandatory caveat that must accompany the calibrated score. */
export const TECHNICAL_SCORE_DISCLAIMER: string =
  classificationCopy.technicalScoreDisclaimer;

/** Short tag appended wherever an uncalibrated experimental-preview verdict shows. */
export const EXPERIMENTAL_UNCALIBRATED_LABEL: string =
  classificationCopy.experimentalUncalibratedLabel;

/** The fuller disclosure shown for the experimental preview (panels, banners). */
export const EXPERIMENTAL_UNCALIBRATED_DISCLOSURE: string =
  classificationCopy.experimentalUncalibratedDisclosure;

/**
 * Whether a result came from the opt-in "preview experimental / não calibrado"
 * path: it carries {@link DecisionReasonCode} `TMR_EXPERIMENTAL_UNCALIBRATED`.
 * Every surface keys its uncalibrated disclosure off this, never off a runtime
 * identity or rollout guess.
 */
export function isExperimentalUncalibrated(
  result: ClassificationResult,
): boolean {
  return result.decision.reasonCodes.includes("TMR_EXPERIMENTAL_UNCALIBRATED");
}

/** Qualitative band label for each decision status — never a percentage. */
export const CLASSIFICATION_STATUS_COPY: Record<ClassificationStatus, string> =
  {
    probably_human: "Sinais não detectados",
    inconclusive: "Resultado inconclusivo",
    possibly_ai: "Sinais detectados",
    strong_ai_indication: "Sinais mais fortes",
    insufficient_evidence: "Evidência limitada",
    classification_failed: "Avaliação indisponível",
  };

/** How the evidence quality behind a decision is described to the user. */
export const EVIDENCE_QUALITY_COPY: Record<EvidenceQuality, string> = {
  sufficient: "Evidência suficiente para o perfil aplicado",
  limited: "Evidência limitada",
  unsupported: "Conteúdo fora do escopo avaliado",
};

/** Message and reveal-control label for each reversible presentation mode. */
export const PRESENTATION_COPY: Record<
  Exclude<PresentationMode, "indicator">,
  { message: string; reveal: string }
> = {
  blur: {
    message:
      "Texto desfocado porque foram detectados sinais compatíveis com geração ou edição por IA.",
    reveal: "Mostrar texto",
  },
  collapse: {
    message:
      "Texto recolhido porque foram detectados sinais compatíveis com geração ou edição por IA.",
    reveal: "Mostrar texto",
  },
  hide: {
    message:
      "Texto ocultado porque foram detectados sinais compatíveis com geração ou edição por IA.",
    reveal: "Mostrar texto",
  },
};

/**
 * Feedback verdict labels. The internal verdict values stay `human|ai|unknown`;
 * only the rendered label changed to neutral, non-authorship phrasing.
 */
export const FEEDBACK_COPY = {
  human: "Não deveria ter sido marcado",
  ai: "A marcação parece correta",
  unknown: "Não sei",
} as const;

// --- the over-claim screen -------------------------------------------------

/**
 * Every user-facing string this module publishes, as one walkable tree.
 *
 * This is the mechanism behind invariant 3 and it is structural, not a checklist:
 * the exports above are the leaves of this object, so a new message is screened
 * the moment it is added here. Adding a string to a surface WITHOUT routing it
 * through this module escapes the screen — which is why every surface imports its
 * copy from here and keeps none of its own.
 */
const USER_FACING_COPY = {
  probabilisticDisclosure: PROBABILISTIC_DISCLOSURE,
  technicalScoreDisclaimer: TECHNICAL_SCORE_DISCLAIMER,
  experimentalUncalibratedLabel: EXPERIMENTAL_UNCALIBRATED_LABEL,
  experimentalUncalibratedDisclosure: EXPERIMENTAL_UNCALIBRATED_DISCLOSURE,
  status: CLASSIFICATION_STATUS_COPY,
  evidenceQuality: EVIDENCE_QUALITY_COPY,
  presentation: PRESENTATION_COPY,
  feedback: FEEDBACK_COPY,
} as const;

/** One user-facing string with the dotted path it is published under. */
export interface CopyEntry {
  path: string;
  text: string;
}

/** Every user-facing string, depth-first, each with its own path. */
export function userFacingCopy(): CopyEntry[] {
  const entries: CopyEntry[] = [];
  const walk = (value: unknown, path: string): void => {
    if (typeof value === "string") {
      entries.push({ path, text: value });
      return;
    }
    if (value === null || typeof value !== "object") return;
    for (const [key, nested] of Object.entries(value)) {
      walk(nested, path === "" ? key : `${path}.${key}`);
    }
  };
  walk(USER_FACING_COPY, "");
  return entries;
}

/**
 * The claims the frozen target forbids: authorship ("escrito por IA", "autoria
 * é"), a real generation process ("foi gerado por", "produzido por um modelo"),
 * and the bare identity claim ("é de IA").
 *
 * Deliberately about ASSERTIONS and not about words. "autoria" and "gerado"
 * appear in copy the product must keep — the mandatory disclosure says the score
 * "não equivale à probabilidade real de autoria" and that the text shows patterns
 * "compatíveis com conteúdo gerado" — so each pattern matches a construction that
 * predicates AI of the text, and the compatibility hedge (`compatíve...`,
 * `padrões`, `sinais`) and the explicit denials (`não comprova`, `não equivale`)
 * are what keeps the legitimate phrasings out. Stateless: no `g`/`y` flag, so
 * `RegExp.prototype.test` does not depend on call order.
 */
export const AUTHORSHIP_CLAIM_PATTERNS: readonly RegExp[] = [
  // A PARTICIPLE immediately followed by its agent: "escrito por IA", "gerado
  // por um modelo", "produzido por ChatGPT". The mandatory disclosure's
  // "conteúdo gerado ou editado por IA" does NOT match, because the participle
  // there is not adjacent to `por` — which is exactly the difference between
  // naming a kind of content and asserting who made this text.
  /\b(escrit|redigid|criad|produzid|feit|gerad|elaborad)[oa]s?\s+por\s+(uma?\s+)?(IA|intelig[êe]nc|modelo|ChatGPT|LLM|rob[ôo])/iu,
  // The bare identity claim: "este texto é de IA", "o post é uma IA".
  /\b(este|esse|o|a)\s+(texto|post|conte[úu]do|mensagem)\s+[ée]\s+(de\s+)?(uma?\s+)?(IA|intelig[êe]nc)/iu,
  // Authorship asserted as a fact ABOUT this text: "a autoria deste texto é...".
  // Not the bare word: the score disclaimer must keep saying that the number
  // "não equivale à probabilidade real de autoria por IA", and that is a denial.
  // NOTE the trailing `\s`, not `\b`: under the `u` flag `\b` is ASCII-only, so
  // "…é " has no boundary after the accented letter and the pattern would never
  // fire. Measured, not assumed — the version with `\b` matched none of the six
  // sentences the test screens for.
  /\bautoria\s+d(este|esse|o)\s+(texto|post|conte[úu]do)\s+[ée]\s/iu,
  // Intent and tooling attributed to a person: "o autor usou", "o autor quis".
  /\b[oa]s?\s+autor(es|a|as)?\s+(usou|usaram|utilizou|utilizaram|quis|quiseram|pretendia|pretendiam|pediu|pediram|copiou|copiaram)\b/iu,
];

/**
 * The first forbidden claim `text` makes, or `null` when it makes none. Returns
 * the offending pattern's source so a failing test names WHICH rule fired instead
 * of only that something did.
 */
export function overclaimIn(text: string): string | null {
  for (const pattern of AUTHORSHIP_CLAIM_PATTERNS) {
    if (pattern.test(text)) return pattern.source;
  }
  return null;
}
