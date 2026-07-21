import {
  CLASSIFICATION_STATUS_COPY,
  EVIDENCE_QUALITY_COPY,
  PROBABILISTIC_DISCLOSURE,
} from "@/shared/classification-copy";
import type {
  ClassificationResult,
  DecisionReasonCode,
  ReasonCode,
} from "@/shared/types";

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

const DEMO_WARNING =
  "Modo de demonstração: nenhum modelo real está sendo utilizado.";

export interface ManualResultProps {
  result: ClassificationResult;
  onRetry: () => void;
  busy?: boolean;
}

/**
 * Renders one manual classification using only its calculated signals and
 * probabilistic language. Every string is React text content, so a hostile
 * result can never inject markup into the panel or the host page.
 */
export function ManualResult({
  result,
  onRetry,
  busy = false,
}: ManualResultProps) {
  // The explanation carries the human-facing signal codes. The decision may
  // additionally carry model-evidence codes without a display phrase, so the
  // fallback is filtered to codes this panel knows how to phrase.
  const rawReasonCodes: DecisionReasonCode[] =
    result.explanation?.reasonCodes ?? result.decision.reasonCodes;
  const reasonCodes = rawReasonCodes.filter(
    (code): code is ReasonCode => code in REASON_PHRASES,
  );

  return (
    <div className="cleanfeed-manual__result">
      <h2 className="cleanfeed-manual__status">
        {CLASSIFICATION_STATUS_COPY[result.status]}
      </h2>
      {result.demo ? (
        <p className="cleanfeed-manual__demo" role="note">
          {DEMO_WARNING}
        </p>
      ) : null}
      <p className="cleanfeed-manual__count">
        {result.wordCount} palavras · {result.tokenCount} tokens
      </p>
      <p className="cleanfeed-manual__evidence-quality">
        {EVIDENCE_QUALITY_COPY[result.evidence.quality]}
      </p>
      <p className="cleanfeed-manual__disclosure">{PROBABILISTIC_DISCLOSURE}</p>
      {reasonCodes.length > 0 ? (
        <section className="cleanfeed-manual__evidence">
          <h3>Indícios observados</h3>
          <ul>
            {reasonCodes.map((code) => (
              <li key={code}>{REASON_PHRASES[code]}</li>
            ))}
          </ul>
        </section>
      ) : null}
      <button
        type="button"
        className="cleanfeed-manual__retry"
        onClick={onRetry}
        disabled={busy}
      >
        Analisar novamente
      </button>
    </div>
  );
}
