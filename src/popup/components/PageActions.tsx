export interface PageActionsProps {
  host: string | null;
  paused: boolean;
  /** Whether the current tab has a running CleanFeed content script. */
  supported: boolean;
  pending: ReadonlySet<string>;
  onPause: () => void;
  onResume: () => void;
  onClear: () => void;
  onOpenOptions: () => void;
}

/**
 * The page-scoped quick controls: pause/resume this site, clear the visual
 * results on the page, and open the full options. The pause is scoped to the
 * current hostname (never a full URL); a page-session pause that ends with the
 * tab is handled in the content script, not here. Each control disables itself
 * while its action is in flight.
 */
export function PageActions({
  host,
  paused,
  supported,
  pending,
  onPause,
  onResume,
  onClear,
  onOpenOptions,
}: PageActionsProps) {
  return (
    <section aria-label="Ações desta página" className="card actions">
      <button
        type="button"
        onClick={paused ? onResume : onPause}
        disabled={host === null || pending.has("pause")}
      >
        {paused ? "Retomar neste site" : "Pausar neste site"}
      </button>
      <button
        type="button"
        onClick={onClear}
        disabled={!supported || pending.has("clear")}
      >
        Limpar resultados visuais
      </button>
      <button
        type="button"
        onClick={onOpenOptions}
        disabled={pending.has("options")}
      >
        Abrir opções
      </button>
    </section>
  );
}
