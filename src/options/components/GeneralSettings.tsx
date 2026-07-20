import type { UserSettings } from "@/shared/settings-types";
import { Field } from "./Form/Field";
import { Fieldset } from "./Form/Fieldset";
import { Select } from "./Form/Select";
import { Switch } from "./Form/Switch";

const languageModes = new Set<string>([
  "portuguese_only",
  "model_supported",
  "experimental_any",
]);
const presentationModes = new Set<string>([
  "indicator",
  "blur",
  "collapse",
  "hide",
]);

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
    <Fieldset title="Geral">
      <Field
        label="Ativar filtro"
        description="Ativa ou desativa a análise de posts no seu feed."
      >
        <Switch
          aria-label="Ativar filtro"
          checked={settings.enabled}
          onChange={(enabled) => onUpdate({ enabled })}
        />
      </Field>
      <Field
        label="Mínimo de palavras"
        description="Posts com menos palavras que o valor selecionado não serão analisados."
      >
        <Select
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
        </Select>
      </Field>
      <Field
        label="Idioma"
        description="Idiomas considerados ao decidir se um post deve ser analisado."
      >
        <Select
          aria-label="Idioma"
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
        </Select>
      </Field>
      <Field
        label="Apresentação"
        description="Como um resultado autorizado é apresentado no feed."
      >
        <Select
          aria-label="Apresentação"
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
          <option value="collapse">Recolher</option>
          <option value="hide">Ocultar</option>
        </Select>
      </Field>
      <p>
        A escolha define somente como apresentar um resultado autorizado. O
        perfil calibrado pode reduzir esta ação, nunca aumentá-la.
      </p>
    </Fieldset>
  );
}
