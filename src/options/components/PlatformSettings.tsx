import type { PlatformSettings as PlatformSettingsValue } from "@/shared/settings-types";
import { Field } from "./Form/Field";
import { Fieldset } from "./Form/Fieldset";
import { Switch } from "./Form/Switch";

interface PlatformSettingsProps {
  platform: PlatformSettingsValue | null;
  onToggleEnabled: (enabled: boolean) => void;
  onReset: () => void;
}

/**
 * Per-platform overrides for the single platform shipping in the MVP
 * (LinkedIn). An override only exists when the user sets one; the reset control
 * removes the whole override so the platform falls back to the general
 * configuration. Broader per-platform tuning arrives with Phase 5.
 */
export function PlatformSettings({
  platform,
  onToggleEnabled,
  onReset,
}: PlatformSettingsProps) {
  const linkedInEnabled = platform?.enabled ?? true;
  const hasOverride =
    platform !== null &&
    Object.keys(platform).some((key) => key !== "platformId");

  return (
    <Fieldset title="Plataformas">
      <p>
        Ajustes por plataforma substituem a configuração geral apenas onde forem
        definidos.
      </p>
      <Field label="Ativar o CleanFeed AI no LinkedIn">
        <Switch
          aria-label="Ativar o CleanFeed AI no LinkedIn"
          checked={linkedInEnabled}
          onChange={(enabled) => onToggleEnabled(enabled)}
        />
      </Field>
      <button
        aria-describedby="linkedin-platform-heading"
        disabled={!hasOverride}
        type="button"
        onClick={onReset}
      >
        Restaurar padrões do LinkedIn
      </button>
    </Fieldset>
  );
}
