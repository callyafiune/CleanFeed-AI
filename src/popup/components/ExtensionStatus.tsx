export interface ExtensionStatusProps {
  host: string | null;
  enabled: boolean;
  paused: boolean;
  toggling: boolean;
  onToggleEnabled: () => void;
}

/**
 * Shows which site the popup is acting on and whether CleanFeed is active there,
 * plus the general on/off control. Only the hostname is ever displayed.
 */
export function ExtensionStatus({
  host,
  enabled,
  paused,
  toggling,
  onToggleEnabled,
}: ExtensionStatusProps) {
  return (
    <section aria-label="Estado da extensão">
      <p>{host ?? "Página atual indisponível"}</p>
      <p>
        {enabled
          ? paused
            ? "Pausado neste site"
            : "CleanFeed ativado"
          : "CleanFeed desativado"}
      </p>
      <button type="button" onClick={onToggleEnabled} disabled={toggling}>
        {enabled ? "Desativar CleanFeed" : "Ativar CleanFeed"}
      </button>
    </section>
  );
}
