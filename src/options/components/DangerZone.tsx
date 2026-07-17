import { useEffect, useRef, useState } from "react";

type ClearTarget = "feedback" | "cache" | "metrics";

interface ClearAction {
  id: ClearTarget;
  label: string;
  confirm: string;
  cancel: string;
  description: string;
}

const CLEAR_ACTIONS: readonly ClearAction[] = [
  {
    id: "feedback",
    label: "Limpar feedback",
    confirm: "Confirmar limpeza de feedback",
    cancel: "Cancelar limpeza de feedback",
    description:
      "Remove o feedback local. Nenhum texto ou autor é armazenado; apenas verdicts por hash.",
  },
  {
    id: "cache",
    label: "Limpar cache",
    confirm: "Confirmar limpeza de cache",
    cancel: "Cancelar limpeza de cache",
    description: "Descarta os resultados de classificação em cache local.",
  },
  {
    id: "metrics",
    label: "Limpar métricas",
    confirm: "Confirmar limpeza de métricas",
    cancel: "Cancelar limpeza de métricas",
    description: "Zera os contadores agregados de desempenho locais.",
  },
];

interface DangerZoneProps {
  onClearFeedback: () => void;
  onClearCache: () => void;
  onClearMetrics: () => void;
}

/**
 * Destructive, local-only data controls. Each action is a two-step, explicit
 * confirmation so no store is cleared by a single accidental click, and each
 * control clears exactly one store (feedback, cache or metrics) and nothing
 * else.
 */
export function DangerZone({
  onClearFeedback,
  onClearCache,
  onClearMetrics,
}: DangerZoneProps) {
  const [armed, setArmed] = useState<ClearTarget | null>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const triggerRefs = useRef(new Map<ClearTarget, HTMLButtonElement | null>());
  // The row last armed, held in a ref so restoring focus never re-renders.
  const lastArmedRef = useRef<ClearTarget | null>(null);

  const handlers: Record<ClearTarget, () => void> = {
    feedback: onClearFeedback,
    cache: onClearCache,
    metrics: onClearMetrics,
  };

  // Keep keyboard focus inside the control: arming swaps the trigger for the
  // confirm/cancel pair, so move focus to the confirm button; disarming brings
  // the trigger back, so return focus to it instead of dropping to <body>.
  useEffect(() => {
    if (armed !== null) {
      lastArmedRef.current = armed;
      confirmRef.current?.focus();
    } else if (lastArmedRef.current !== null) {
      triggerRefs.current.get(lastArmedRef.current)?.focus();
      lastArmedRef.current = null;
    }
  }, [armed]);

  return (
    <section aria-labelledby="danger-zone-heading">
      <h3 id="danger-zone-heading">Dados locais</h3>
      <p>
        Estas ações apagam dados armazenados apenas neste navegador e não podem
        ser desfeitas.
      </p>
      <ul>
        {CLEAR_ACTIONS.map((action) => (
          <li key={action.id}>
            <p>{action.description}</p>
            {armed === action.id ? (
              <>
                <button
                  ref={confirmRef}
                  type="button"
                  onClick={() => {
                    handlers[action.id]();
                    setArmed(null);
                  }}
                >
                  {action.confirm}
                </button>
                <button type="button" onClick={() => setArmed(null)}>
                  {action.cancel}
                </button>
              </>
            ) : (
              <button
                ref={(element) => {
                  triggerRefs.current.set(action.id, element);
                }}
                type="button"
                onClick={() => setArmed(action.id)}
              >
                {action.label}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
