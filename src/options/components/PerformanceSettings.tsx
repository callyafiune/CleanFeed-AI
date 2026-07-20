import type { UserSettings } from "@/shared/settings-types";

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
    <section aria-labelledby="performance-settings-heading">
      <h2 id="performance-settings-heading">Desempenho</h2>
      <label>
        Tamanho máximo da fila
        <input
          aria-label="Tamanho máximo da fila"
          max={500}
          min={1}
          type="number"
          value={settings.maximumQueueSize}
          onChange={(event) =>
            updateInteger("maximumQueueSize", event.target.value, 1, 500)
          }
        />
      </label>
      <label>
        Concorrência WASM
        <input
          aria-label="Concorrência WASM"
          disabled
          type="number"
          value={1}
        />
      </label>
      <label>
        Concorrência WebGPU
        <input
          aria-label="Concorrência WebGPU"
          max={4}
          min={1}
          type="number"
          value={settings.webGpuConcurrency}
          onChange={(event) =>
            updateInteger("webGpuConcurrency", event.target.value, 1, 4)
          }
        />
      </label>
      <label>
        Timeout de inferência (ms)
        <input
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
      </label>
      <label>
        Tamanho do chunk
        <input
          aria-label="Tamanho do chunk"
          max={512}
          min={32}
          type="number"
          value={settings.chunkSizeTokens}
          onChange={(event) =>
            updateInteger("chunkSizeTokens", event.target.value, 32, 512)
          }
        />
      </label>
      <label>
        Sobreposição de chunks
        <input
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
      </label>
      <label>
        Entradas máximas no cache
        <input
          aria-label="Entradas máximas no cache"
          max={5_000}
          min={10}
          type="number"
          value={settings.cacheMaximumEntries}
          onChange={(event) =>
            updateInteger("cacheMaximumEntries", event.target.value, 10, 5_000)
          }
        />
      </label>
      <label>
        <input
          aria-label="Incluir rastreamentos de depuração"
          checked={settings.debugMode}
          type="checkbox"
          onChange={(event) => onUpdate({ debugMode: event.target.checked })}
        />
        Incluir rastreamentos de depuração na resposta local
      </label>
    </section>
  );
}
