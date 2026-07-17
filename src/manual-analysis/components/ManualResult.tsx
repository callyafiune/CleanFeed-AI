import type {
  ClassificationResult,
  Confidence,
  ReasonCode,
} from "@/shared/types";

const STATUS_COPY: Record<ClassificationResult["status"], string> = {
  probably_human: "Provavelmente escrito por uma pessoa",
  inconclusive: "Resultado inconclusivo",
  possibly_ai: "Possivelmente gerado por IA",
  strong_ai_indication: "Fortes indícios de IA",
  insufficient_evidence: "Resultado inconclusivo",
  classification_failed: "Resultado inconclusivo",
};

const CONFIDENCE_COPY: Record<Confidence, string> = {
  low: "baixa",
  medium: "média",
  high: "alta",
};

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
  const reasonCodes =
    result.explanation?.reasonCodes ?? result.decision?.reasonCodes ?? [];

  return (
    <div className="cleanfeed-manual__result">
      <h2 className="cleanfeed-manual__status">{STATUS_COPY[result.status]}</h2>
      {result.demo ? (
        <p className="cleanfeed-manual__demo" role="note">
          {DEMO_WARNING}
        </p>
      ) : null}
      <p className="cleanfeed-manual__count">
        {result.wordCount} palavras · {result.tokenCount} tokens
      </p>
      <p className="cleanfeed-manual__confidence">
        Confiança: {CONFIDENCE_COPY[result.confidence]}
      </p>
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
