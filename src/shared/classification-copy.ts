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
 * keeps its own equivalent string. Two invariants live in this module:
 *
 * 1. The feed never claims authorship and never shows the raw/calibrated score;
 *    it speaks only in qualitative bands plus the mandatory disclosure below.
 * 2. The calibrated score is exposed ONLY in the advanced diagnostic, always
 *    paired with {@link TECHNICAL_SCORE_DISCLAIMER}, and never as the real
 *    probability that a text was authored by IA.
 */

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
