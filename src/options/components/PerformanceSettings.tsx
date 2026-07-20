import type { UserSettings } from "@/shared/settings-types";
import { Field } from "./Form/Field";
import { Fieldset } from "./Form/Fieldset";
import { Input } from "./Form/Input";
import { Switch } from "./Form/Switch";

type NumericSetting =
  | "maximumQueueSize"
  | "webGpuConcurrency"
  | "inferenceTimeoutMs"
  | "chunkSizeTokens"
  | "chunkOverlapTokens"
  | "cacheMaximumEntries";

interface PerformanceSettingsProps {
  settings: UserSettings;
  onUpdate: (update: Partial<UserSettings>) => void;
}

export function PerformanceSettings({
  settings,
  onUpdate,
}: PerformanceSettingsProps) {
  const updateInteger = (
    key: NumericSetting,
    value: string,
    minimum: number,
    maximum: number,
  ) => {
    const numericValue = Number(value);
    if (
      Number.isSafeInteger(numericValue) &&
      numericValue >= minimum &&
      numericValue <= maximum
    ) {
      onUpdate({ [key]: numericValue });
    }
  };

  return (
    <Fieldset title="Desempenho">
      <Field
        label="Tamanho máximo da fila"
        description="Número de posts que podem aguardar na fila para análise."
      >
        <Input
          aria-label="Tamanho máximo da fila"
          max={500}
          min={1}
          type="number"
          value={settings.maximumQueueSize}
          onChange={(event) =>
            updateInteger("maximumQueueSize", event.target.value, 1, 500)
          }
        />
      </Field>
      <Field
        label="Concorrência WASM"
        description="Número de threads para inferência em WASM."
      >
        <Input
          aria-label="Concorrência WASM"
          disabled
          type="number"
          value={1}
        />
      </Field>
      <Field
        label="Concorrência WebGPU"
        description="Número de threads para inferência em WebGPU."
      >
        <Input
          aria-label="Concorrência WebGPU"
          max={4}
          min={1}
          type="number"
          value={settings.webGpuConcurrency}
          onChange={(event) =>
            updateInteger("webGpuConcurrency", event.target.value, 1, 4)
          }
        />
      </Field>
      <Field
        label="Timeout de inferência (ms)"
        description="Tempo máximo para uma análise antes de ser descartada."
      >
        <Input
          aria-label="Timeout de inferência (ms)"
          max={120_000}
          min={1_000}
          type="number"
          value={settings.inferenceTimeoutMs}
          onChange={(event) =>
            updateInteger(
              "inferenceTimeoutMs",
              event.target.value,
              1_000,
              120_000,
            )
          }
        />
      </Field>
      <Field
        label="Tamanho do chunk"
        description="Tamanho de cada pedaço de texto enviado para análise."
      >
        <Input
          aria-label="Tamanho do chunk"
          max={512}
          min={32}
          type="number"
          value={settings.chunkSizeTokens}
          onChange={(event) =>
            updateInteger("chunkSizeTokens", event.target.value, 32, 512)
          }
        />
      </Field>
      <Field
        label="Sobreposição de chunks"
        description="Quanto cada pedaço de texto se sobrepõe ao anterior para manter o contexto."
      >
        <Input
          aria-label="Sobreposição de chunks"
          max={settings.chunkSizeTokens - 1}
          min={0}
          type="number"
          value={settings.chunkOverlapTokens}
          onChange={(event) =>
            updateInteger(
              "chunkOverlapTokens",
              event.target.value,
              0,
              settings.chunkSizeTokens - 1,
            )
          }
        />
      </Field>
      <Field
        label="Entradas máximas no cache"
        description="Número máximo de análises a serem mantidas no cache."
      >
        <Input
          aria-label="Entradas máximas no cache"
          max={5_000}
          min={10}
          type="number"
          value={settings.cacheMaximumEntries}
          onChange={(event) =>
            updateInteger("cacheMaximumEntries", event.target.value, 10, 5_000)
          }
        />
      </Field>
      <Field
        label="Incluir rastreamentos de depuração"
        description="Adiciona rastreamentos de depuração na resposta local da análise."
      >
        <Switch
          aria-label="Incluir rastreamentos de depuração"
          checked={settings.debugMode}
          onChange={(debugMode) => onUpdate({ debugMode })}
        />
      </Field>
    </Fieldset>
  );
}
