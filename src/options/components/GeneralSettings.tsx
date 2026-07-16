import type { UserSettings } from "@/shared/settings-types";

const languageModes = new Set<string>([
  "portuguese_only",
  "model_supported",
  "experimental_any",
]);
const presentationModes = new Set<string>(["indicator", "blur"]);

function isLanguageMode(value: string): value is UserSettings["languageMode"] {
  return languageModes.has(value);
}

function isPresentationMode(
  value: string,
): value is UserSettings["presentationMode"] {
  return presentationModes.has(value);
}

export function GeneralSettings({
  settings,
  onUpdate,
}: {
  settings: UserSettings;
  onUpdate: (update: Partial<UserSettings>) => void;
}) {
  return (
    <section aria-labelledby="general-settings-heading">
      <h2 id="general-settings-heading">Configurações gerais</h2>
      <label>
        <input
          checked={settings.enabled}
          type="checkbox"
          onChange={(event) => onUpdate({ enabled: event.target.checked })}
        />
        Ativar filtro
      </label>
      <label>
        Mínimo de palavras
        <select
          aria-label="Mínimo de palavras"
          value={settings.minimumWordCount}
          onChange={(event) => {
            const minimumWordCount = Number(event.target.value);
            if (
              Number.isSafeInteger(minimumWordCount) &&
              minimumWordCount >= 50 &&
              minimumWordCount <= 5_000
            ) {
              onUpdate({ minimumWordCount });
            }
          }}
        >
          {[50, 100, 150, 250, 500].map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>
      <label>
        Idioma
        <select
          value={settings.languageMode}
          onChange={(event) => {
            const languageMode = event.target.value;
            if (isLanguageMode(languageMode)) {
              onUpdate({ languageMode });
            }
          }}
        >
          <option value="portuguese_only">Apenas português</option>
          <option value="model_supported">
            Idiomas suportados pelo modelo
          </option>
          <option value="experimental_any">
            Qualquer idioma (experimental)
          </option>
        </select>
      </label>
      <label>
        Apresentação
        <select
          value={settings.presentationMode}
          onChange={(event) => {
            const presentationMode = event.target.value;
            if (isPresentationMode(presentationMode)) {
              onUpdate({ presentationMode });
            }
          }}
        >
          <option value="indicator">Apenas indicador</option>
          <option value="blur">Desfocar</option>
        </select>
      </label>
    </section>
  );
}
