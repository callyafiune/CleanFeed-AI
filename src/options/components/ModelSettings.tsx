import {
  resolveActiveModelProfile,
  type ModelProfile,
} from "@/inference/model-profile";
import type { ModelDiagnosticsView } from "@/shared/diagnostic-types";
import {
  BUILTIN_FALLBACK_COPY,
  CIRCUIT_BREAKER_COPY,
  formatEarliestExpiry,
  modelCalibrationLabel,
  modelGateLabel,
  modelOperationLabel,
  modelRolloutLabel,
} from "@/shared/model-diagnostics-client";
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
  diagnostics,
}: {
  settings: UserSettings;
  onUpdate: (update: Partial<UserSettings>) => void;
  profile?: ModelProfile;
  diagnostics?: ModelDiagnosticsView | null;
}) {
  const view = diagnostics ?? null;
  const active =
    profile ??
    resolveActiveModelProfile({
      useMockModel: settings.useMockModel,
      status: view?.status ?? null,
    });

  const isBuiltinFallback = view?.status.runtimeIdentity?.kind === "builtin";
  const circuitBreakerOpen =
    view?.status.reasonCodes.includes("CIRCUIT_BREAKER_OPEN") ?? false;

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
      {view === null ? null : (
        <dl>
          <dt>Operação</dt>
          <dd>{modelOperationLabel(view.status.state)}</dd>
          <dt>Decisão científica</dt>
          <dd>{modelGateLabel(view.release)}</dd>
          <dt>Rollout</dt>
          <dd>{modelRolloutLabel(view.release)}</dd>
          <dt>Perfis de calibração</dt>
          <dd>{view.status.profileCount}</dd>
          <dt>Validade mínima</dt>
          <dd>{formatEarliestExpiry(view.status.earliestExpiry)}</dd>
        </dl>
      )}
      {view === null ? null : (
        <p role="note">{modelCalibrationLabel(view.status)}</p>
      )}
      {isBuiltinFallback ? <p role="note">{BUILTIN_FALLBACK_COPY}</p> : null}
      {circuitBreakerOpen ? <p role="status">{CIRCUIT_BREAKER_COPY}</p> : null}
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
