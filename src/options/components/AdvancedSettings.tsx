import { useState } from "react";

import { ModelSettings } from "@/options/components/ModelSettings";
import type { UserSettings } from "@/shared/settings-types";
import { Fieldset } from "./Form/Fieldset";

interface AdvancedSettingsProps {
  settings: UserSettings;
  onUpdate: (update: Partial<UserSettings>) => void;
  onReset: () => void;
  /**
   * Downloads the sanitized diagnostic report. Optional so the section still
   * renders when the diagnostics service is not wired (e.g. in tests).
   */
  onDownloadDiagnostics?: () => void;
}

/**
 * Advanced controls: the read-only model/calibration card and a guarded reset to
 * defaults. Decision thresholds are no longer user-editable — the scientific
 * limits live exclusively in the calibration profile, and how a result is
 * presented is chosen in Geral. Calibration authoring arrives with a later
 * phase, so no decorative controls are rendered for services that do not exist.
 */
export function AdvancedSettings({
  settings,
  onUpdate,
  onReset,
  onDownloadDiagnostics,
}: AdvancedSettingsProps) {
  const [resetArmed, setResetArmed] = useState(false);

  return (
    <Fieldset title="Avançado">
      <ModelSettings settings={settings} onUpdate={onUpdate} />

      {onDownloadDiagnostics === undefined ? null : (
        <>
          <h3 id="diagnostics-heading">Diagnóstico</h3>
          <p>
            Gera um relatório local e sanitizado (versão, permissões, métricas
            agregadas e um resumo das configurações). Ele nunca inclui texto de
            posts, autores, URLs, hashes ou histórico.
          </p>
          <div className="button-group">
            <button
              aria-describedby="diagnostics-heading"
              type="button"
              onClick={onDownloadDiagnostics}
            >
              Baixar diagnóstico
            </button>
          </div>
        </>
      )}

      <h3 id="reset-heading">Restaurar configurações</h3>
      {resetArmed ? (
        <>
          <p role="status">
            Isto substituirá todas as configurações gerais pelos valores padrão.
          </p>
          <div className="button-group">
            <button
              type="button"
              onClick={() => {
                setResetArmed(false);
                onReset();
              }}
            >
              Confirmar restauração
            </button>
            <button type="button" onClick={() => setResetArmed(false)}>
              Cancelar restauração
            </button>
          </div>
        </>
      ) : (
        <div className="button-group">
          <button type="button" onClick={() => setResetArmed(true)}>
            Restaurar configurações padrão
          </button>
        </div>
      )}
    </Fieldset>
  );
}
