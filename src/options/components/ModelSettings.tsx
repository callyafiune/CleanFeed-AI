import {
  resolveActiveModelProfile,
  type ModelProfile,
} from "@/inference/model-profile";
import type { Backend } from "@/shared/types";
import type { UserSettings } from "@/shared/settings-types";
import { Field } from "./Form/Field";
import { Switch } from "./Form/Switch";

const backendLabels: Record<Backend, string> = {
  mock: "mock (demonstração)",
  wasm: "WASM (local)",
  webgpu: "WebGPU (local)",
};

function backendLabel(backend: Backend): string {
  return backendLabels[backend];
}

export function ModelSettings({
  settings,
  onUpdate,
  profile,
}: {
  settings: UserSettings;
  onUpdate: (update: Partial<UserSettings>) => void;
  profile?: ModelProfile;
}) {
  const active =
    profile ??
    resolveActiveModelProfile({ useMockModel: settings.useMockModel });

  return (
    <>
      <h3 id="model-settings-heading">Modelo e calibração</h3>
      <dl>
        <dt>Modelo</dt>
        <dd>{active.modelId}</dd>
        <dt>Versão</dt>
        <dd>{active.modelVersion}</dd>
        <dt>Backend</dt>
        <dd>{backendLabel(active.backend)}</dd>
        <dt>Calibração</dt>
        <dd>
          {active.calibrated ? "calibrado" : "não calibrado"}
          {active.calibrationVersion === undefined
            ? ""
            : ` (${active.calibrationVersion})`}
        </dd>
      </dl>
      {active.calibrated ? null : (
        <p role="note">
          Modelos sem calibração verificada apenas indicam: nunca desfocam,
          recolhem ou ocultam posts.
        </p>
      )}
      <Field label="Usar modelo mock (demonstração)">
        <Switch
          aria-label="Usar modelo mock (demonstração)"
          checked={settings.useMockModel}
          onChange={(useMockModel) => onUpdate({ useMockModel })}
        />
      </Field>
    </>
  );
}
