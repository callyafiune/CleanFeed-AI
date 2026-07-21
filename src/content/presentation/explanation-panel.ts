import {
  FEEDBACK_COPY,
  PROBABILISTIC_DISCLOSURE,
  TECHNICAL_SCORE_DISCLAIMER,
} from "@/shared/classification-copy";
import type { FeedbackVerdict } from "@/storage/feedback";
import type {
  ClassificationResult,
  DecisionOutcome,
  DecisionReasonCode,
  ReasonCode,
} from "@/shared/types";

export type { FeedbackVerdict } from "@/storage/feedback";

export interface ExplanationPanelCallbacks {
  /** Records the user's local verdict about this classification. */
  onFeedback: (verdict: FeedbackVerdict) => void | Promise<void>;
  /** Invoked when the user dismisses the panel via its close control. */
  onClose?: () => void;
  /**
   * Whether the experimental personal-rules feature is enabled. Only then does
   * the panel offer a control to create a rule for the current post.
   */
  personalRulesEnabled?: boolean;
  /**
   * Opens the rule editor for this post. The panel never sees the post text, so
   * it cannot (and must not) prefill the pattern; the editor opens with an empty
   * pattern and the platform prefilled.
   */
  onCreateRule?: () => void;
}

export interface ExplanationPanelOptions {
  /**
   * Opt-in flag for the advanced technical diagnostic. Off by default: the
   * calibrated score is rendered ONLY when this is true AND the result comes
   * from a bundle runtime with a selected calibration profile and a decision
   * that did not abstain. It is always shown as the calibrated model score with
   * the caveat that it is not the real probability of authorship.
   */
  showTechnicalScore?: boolean;
}

const HEADING = "Indícios observados";
const FALLBACK_EVIDENCE =
  "Nenhum indício específico foi registrado para esta avaliação.";
const FEEDBACK_QUESTION = "Este resultado parece correto?";
const FEEDBACK_CONFIRMATION =
  "Recebemos seu feedback. Ele fica apenas neste navegador.";
const CLOSE_LABEL = "Fechar";
const CREATE_RULE_LABEL = "Adicionar regra para este post";
const TECHNICAL_DIAGNOSTICS_LABEL = "Diagnóstico avançado";
const TECHNICAL_SCORE_PREFIX = "Score calibrado do modelo: ";

/** Static, probabilistic phrasing for every reason code the pipeline emits. */
const REASON_PHRASES: Record<ReasonCode, string> = {
  HIGH_CHUNK_CONSISTENCY:
    "Os trechos analisados receberam pontuações consistentes entre si.",
  MOST_CHUNKS_ABOVE_THRESHOLD:
    "A maioria dos trechos ficou acima do limiar de marcação.",
  HIGH_AVERAGE_SCORE: "A pontuação média dos trechos ficou alta.",
  HIGH_MEDIAN_SCORE: "A pontuação mediana dos trechos ficou alta.",
  FORMULAIC_STRUCTURE: "A estrutura do texto seguiu um padrão formulaico.",
  LOW_SENTENCE_LENGTH_VARIATION:
    "Houve pouca variação no comprimento das frases.",
  REPETITIVE_TRANSITIONS:
    "As transições entre as frases se repetiram com frequência.",
  LISTICLE_PATTERN: "O texto seguiu um formato de lista.",
  EXCESSIVE_HASHTAGS: "O texto apresentou uso excessivo de hashtags.",
  CUSTOM_KEYWORD_RULE:
    "O texto correspondeu a uma regra de palavra-chave configurada por você.",
  INSUFFICIENT_EVIDENCE:
    "Não houve indícios suficientes para uma avaliação conclusiva.",
  LOW_MODEL_CONFIDENCE: "O modelo teve baixa confiança nesta avaliação.",
  CHUNK_DISAGREEMENT: "Os trechos analisados divergiram entre si.",
};

const FEEDBACK_OPTIONS: { verdict: FeedbackVerdict; label: string }[] = [
  { verdict: "human", label: FEEDBACK_COPY.human },
  { verdict: "ai", label: FEEDBACK_COPY.ai },
  { verdict: "unknown", label: FEEDBACK_COPY.unknown },
];

let panelSequence = 0;

/**
 * Builds the extension-owned, keyboard-accessible panel that explains a
 * classification using only its calculated evidence, plus local feedback
 * controls. All text is set via `textContent`; no field is ever interpreted as
 * markup, so hostile content in the result can never inject nodes.
 */
export function createExplanationPanel(
  result: ClassificationResult,
  callbacks: ExplanationPanelCallbacks,
  options: ExplanationPanelOptions = {},
): HTMLElement {
  const doc = document;
  const id = `cleanfeed-explanation-${++panelSequence}`;
  const headingId = `${id}-heading`;
  const feedbackLabelId = `${id}-feedback-label`;

  const panel = doc.createElement("section");
  panel.id = id;
  panel.className = "cleanfeed-explanation";
  panel.dataset.cleanfeedOwned = "explanation";
  panel.setAttribute("role", "region");
  panel.setAttribute("aria-labelledby", headingId);
  // All panel copy is Portuguese; declare it so assistive tech uses the right
  // voice even on a host page whose <html lang> is not pt.
  panel.lang = "pt-BR";

  const heading = doc.createElement("h2");
  heading.id = headingId;
  heading.className = "cleanfeed-explanation__heading";
  heading.tabIndex = -1;
  heading.textContent = HEADING;

  // The mandatory §7 disclosure: probabilistic phrasing, never an authorship
  // claim. It is the single shared string, so no other surface duplicates it.
  const disclosure = doc.createElement("p");
  disclosure.className = "cleanfeed-explanation__disclosure";
  disclosure.textContent = PROBABILISTIC_DISCLOSURE;

  panel.append(
    heading,
    disclosure,
    buildEvidence(doc, result),
    buildMeta(doc, result),
  );

  // The calibrated score is advanced-diagnostic only, never in the feed. It is
  // shown solely for a bundle runtime with a selected profile whose decision did
  // not abstain: a builtin/stylometric result or an abstention never qualifies.
  if (
    options.showTechnicalScore === true &&
    result.runtimeIdentity.kind === "bundle" &&
    result.selectedProfileDigest !== undefined &&
    !result.decision.abstained
  ) {
    panel.append(buildTechnicalDiagnostics(doc, result.decision));
  }

  panel.append(buildFeedback(doc, feedbackLabelId, callbacks));
  panel.append(buildFooter(doc, callbacks));

  return panel;
}

/**
 * Builds the collapsible advanced diagnostic. It presents the calibrated model
 * score to three pt-BR decimal places, always paired with the caveat that it is
 * NOT the real probability of authorship. It is never a percentage.
 */
function buildTechnicalDiagnostics(
  doc: Document,
  decision: DecisionOutcome,
): HTMLElement {
  const details = doc.createElement("details");
  details.className = "cleanfeed-explanation__diagnostics";

  const summary = doc.createElement("summary");
  summary.textContent = TECHNICAL_DIAGNOSTICS_LABEL;

  const score = doc.createElement("p");
  score.className = "cleanfeed-explanation__score";
  score.textContent =
    TECHNICAL_SCORE_PREFIX +
    decision.calibratedScore.toLocaleString("pt-BR", {
      minimumFractionDigits: 3,
      maximumFractionDigits: 3,
    });

  const warning = doc.createElement("p");
  warning.className = "cleanfeed-explanation__score-caveat";
  warning.textContent = TECHNICAL_SCORE_DISCLAIMER;

  details.append(summary, score, warning);
  return details;
}

function buildEvidence(
  doc: Document,
  result: ClassificationResult,
): HTMLElement {
  const list = doc.createElement("ul");
  list.className = "cleanfeed-explanation__evidence";

  const rawReasonCodes: DecisionReasonCode[] =
    result.explanation?.reasonCodes ?? result.decision.reasonCodes;
  const reasonCodes = rawReasonCodes.filter(
    (code): code is ReasonCode => code in REASON_PHRASES,
  );
  const phrases =
    reasonCodes.length > 0
      ? reasonCodes.map((code) => REASON_PHRASES[code])
      : [FALLBACK_EVIDENCE];

  for (const phrase of phrases) {
    const item = doc.createElement("li");
    item.textContent = phrase;
    list.append(item);
  }
  return list;
}

function buildMeta(doc: Document, result: ClassificationResult): HTMLElement {
  const list = doc.createElement("dl");
  list.className = "cleanfeed-explanation__meta";

  appendMeta(doc, list, "Modelo", result.modelId);
  appendMeta(doc, list, "Versão", result.modelVersion);
  appendMeta(doc, list, "Backend", result.backend);
  appendMeta(doc, list, "Palavras", String(result.wordCount));
  appendMeta(doc, list, "Tokens", String(result.tokenCount));

  const explanation = result.explanation;
  if (explanation !== undefined) {
    if (explanation.totalChunks !== undefined) {
      appendMeta(
        doc,
        list,
        "Trechos analisados",
        String(explanation.totalChunks),
      );
    }
    if (explanation.chunkAgreement !== undefined) {
      appendMeta(
        doc,
        list,
        "Consistência entre trechos",
        `${Math.round(explanation.chunkAgreement * 100)}%`,
      );
    }
    if (explanation.calibrationProfile.length > 0) {
      appendMeta(
        doc,
        list,
        "Perfil de calibração",
        explanation.calibrationProfile,
      );
    }
  }
  return list;
}

function appendMeta(
  doc: Document,
  list: HTMLElement,
  term: string,
  description: string,
): void {
  const termNode = doc.createElement("dt");
  termNode.textContent = term;
  const descriptionNode = doc.createElement("dd");
  descriptionNode.textContent = description;
  list.append(termNode, descriptionNode);
}

function buildFeedback(
  doc: Document,
  feedbackLabelId: string,
  callbacks: ExplanationPanelCallbacks,
): HTMLElement {
  const container = doc.createElement("div");
  container.className = "cleanfeed-explanation__feedback";

  const label = doc.createElement("p");
  label.id = feedbackLabelId;
  label.className = "cleanfeed-explanation__feedback-label";
  label.textContent = FEEDBACK_QUESTION;

  const group = doc.createElement("div");
  group.className = "cleanfeed-explanation__feedback-options";
  group.setAttribute("role", "group");
  group.setAttribute("aria-labelledby", feedbackLabelId);

  const status = doc.createElement("p");
  status.className = "cleanfeed-explanation__confirmation";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  // Programmatically focusable so focus can land here after the feedback
  // buttons (including the one that was focused) are disabled.
  status.tabIndex = -1;

  const buttons: HTMLButtonElement[] = [];
  for (const option of FEEDBACK_OPTIONS) {
    const button = doc.createElement("button");
    button.type = "button";
    button.className = "cleanfeed-explanation__feedback-option";
    button.dataset.verdict = option.verdict;
    button.textContent = option.label;
    button.addEventListener("click", () => {
      try {
        void callbacks.onFeedback(option.verdict);
      } catch {
        // Feedback is best-effort and strictly local; a storage failure must
        // never surface as an unhandled error in the page.
      }
      const hadFocus = doc.activeElement === button;
      for (const other of buttons) other.disabled = true;
      status.textContent = FEEDBACK_CONFIRMATION;
      // The activated button was just disabled, which drops focus to <body>;
      // move it to the (now populated) confirmation so keyboard users keep place.
      if (hadFocus) status.focus();
    });
    buttons.push(button);
    group.append(button);
  }

  container.append(label, group, status);
  return container;
}

function buildFooter(
  doc: Document,
  callbacks: ExplanationPanelCallbacks,
): HTMLElement {
  const footer = doc.createElement("div");
  footer.className = "cleanfeed-explanation__footer";

  // Only surface the personal-rule action when the experimental feature is on.
  // The panel intentionally cannot copy the post into the pattern: it never
  // receives the post text, so the editor opens with an empty pattern.
  if (callbacks.personalRulesEnabled === true) {
    const createRule = doc.createElement("button");
    createRule.type = "button";
    createRule.className = "cleanfeed-explanation__create-rule";
    createRule.textContent = CREATE_RULE_LABEL;
    createRule.addEventListener("click", () => {
      callbacks.onCreateRule?.();
    });
    footer.append(createRule);
  }

  const close = doc.createElement("button");
  close.type = "button";
  close.className = "cleanfeed-explanation__close";
  close.textContent = CLOSE_LABEL;
  close.addEventListener("click", () => {
    callbacks.onClose?.();
  });

  footer.append(close);
  return footer;
}
