import type { PlatformSettings as PlatformSettingsValue } from "@/shared/settings-types";

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
    <section aria-labelledby="platform-settings-heading">
      <h2 id="platform-settings-heading">Plataformas</h2>
      <p>
        Ajustes por plataforma substituem a configuração geral apenas onde forem
        definidos.
      </p>
      <h3 id="linkedin-platform-heading">LinkedIn</h3>
      <label>
        <input
          checked={linkedInEnabled}
          type="checkbox"
          onChange={(event) => onToggleEnabled(event.target.checked)}
        />
        Ativar o CleanFeed AI no LinkedIn
      </label>
      <button
        aria-describedby="linkedin-platform-heading"
        disabled={!hasOverride}
        type="button"
        onClick={onReset}
      >
        Restaurar padrões do LinkedIn
      </button>
    </section>
  );
}
