export type ManualEmptyReason = "empty" | "below-minimum";

const MESSAGES: Record<ManualEmptyReason, string> = {
  empty: "Selecione um texto na página para analisar.",
  "below-minimum":
    "Este conteúdo possui menos palavras do que o mínimo configurado.",
};

/**
 * Explains, without technical jargon, why there is nothing to classify yet:
 * either no selection arrived or the selection is shorter than the configured
 * minimum. It renders only extension-owned copy.
 */
export function ManualEmptyState({ reason }: { reason: ManualEmptyReason }) {
  return (
    <p className="cleanfeed-manual__empty" role="status">
      {MESSAGES[reason]}
    </p>
  );
}
