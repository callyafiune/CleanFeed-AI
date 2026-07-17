import { useState } from "react";

import { ModelSettings } from "@/options/components/ModelSettings";
import type { UserSettings } from "@/shared/settings-types";
import { validateThresholds } from "@/shared/validation";

const THRESHOLD_FIELDS = [
  { key: "markingThreshold", label: "Limiar de marcação" },
  { key: "blurThreshold", label: "Limiar de desfoque" },
  { key: "collapseThreshold", label: "Limiar de recolhimento" },
  { key: "hideThreshold", label: "Limiar de ocultação" },
] as const;

type ThresholdKey = (typeof THRESHOLD_FIELDS)[number]["key"];
type ThresholdDraft = Record<ThresholdKey, string>;

interface AdvancedSettingsProps {
  settings: UserSettings;
  onUpdate: (update: Partial<UserSettings>) => void;
  onSave: (update: Partial<UserSettings>) => void;
  onReset: () => void;
}

function thresholdDraft(settings: UserSettings): ThresholdDraft {
  return {
    markingThreshold: String(settings.markingThreshold),
    blurThreshold: String(settings.blurThreshold),
    collapseThreshold: String(settings.collapseThreshold),
    hideThreshold: String(settings.hideThreshold),
  };
}

function thresholdKey(settings: UserSettings): string {
  return [
    settings.markingThreshold,
    settings.blurThreshold,
    settings.collapseThreshold,
    settings.hideThreshold,
  ].join(":");
}

/**
 * Advanced controls: decision thresholds edited as a local draft and validated
 * only on submit (so an out-of-order value can be typed and corrected without
 * being rejected key-by-key), the read-only model/calibration card and a guarded
 * reset to defaults. Diagnostics and calibration authoring arrive with Phase 5,
 * so no decorative controls are rendered for services that do not yet exist.
 */
export function AdvancedSettings({
  settings,
  onUpdate,
  onSave,
  onReset,
}: AdvancedSettingsProps) {
  const [draft, setDraft] = useState<ThresholdDraft>(() =>
    thresholdDraft(settings),
  );
  const [thresholdError, setThresholdError] = useState<string | null>(null);
  const [resetArmed, setResetArmed] = useState(false);

  // Re-seed the draft from the canonical settings whenever they change (initial
  // load, save or reset) without an effect: React re-renders in place when state
  // is adjusted during render. In-progress edits change only the draft, so they
  // are never clobbered by an unrelated re-render.
  const [syncedKey, setSyncedKey] = useState(() => thresholdKey(settings));
  const currentKey = thresholdKey(settings);
  if (currentKey !== syncedKey) {
    setSyncedKey(currentKey);
    setDraft(thresholdDraft(settings));
  }

  const submit = () => {
    const parsed = {
      marking: Number(draft.markingThreshold),
      blur: Number(draft.blurThreshold),
      collapse: Number(draft.collapseThreshold),
      hide: Number(draft.hideThreshold),
    };

    try {
      validateThresholds(parsed);
    } catch {
      setThresholdError(
        "A ordem dos limiares não é válida. Cada limiar deve estar entre 0 e 1 e ser maior ou igual ao anterior.",
      );
      return;
    }

    setThresholdError(null);
    onSave({
      markingThreshold: parsed.marking,
      blurThreshold: parsed.blur,
      collapseThreshold: parsed.collapse,
      hideThreshold: parsed.hide,
    });
  };

  return (
    <section aria-labelledby="advanced-settings-heading">
      <h2 id="advanced-settings-heading">Avançado</h2>

      <ModelSettings settings={settings} onUpdate={onUpdate} />

      <h3 id="thresholds-heading">Limiares de decisão</h3>
      <p>
        Cada limiar define a partir de qual pontuação uma ação mais forte é
        permitida. Os valores devem crescer da marcação até a ocultação.
      </p>
      {THRESHOLD_FIELDS.map(({ key, label }) => (
        <label key={key}>
          {label}
          <input
            aria-label={label}
            max={1}
            min={0}
            step={0.01}
            type="number"
            value={draft[key]}
            onChange={(event) =>
              setDraft((previous) => ({
                ...previous,
                [key]: event.target.value,
              }))
            }
          />
        </label>
      ))}
      <button type="button" onClick={submit}>
        Salvar
      </button>
      {thresholdError === null ? null : <p role="alert">{thresholdError}</p>}

      <h3 id="reset-heading">Restaurar configurações</h3>
      {resetArmed ? (
        <>
          <p role="status">
            Isto substituirá todas as configurações gerais pelos valores padrão.
          </p>
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
        </>
      ) : (
        <button type="button" onClick={() => setResetArmed(true)}>
          Restaurar configurações padrão
        </button>
      )}
    </section>
  );
}
