import {
  resolveActiveModelProfile,
  type ModelProfile,
} from "@/inference/model-profile";
import type { ModelDiagnosticsView } from "@/shared/diagnostic-types";
import {
  BUILTIN_FALLBACK_COPY,
  CIRCUIT_BREAKER_COPY,
  EXPERIMENTAL_UNCALIBRATED_COPY,
  formatEarliestExpiry,
  modelCalibrationLabel,
  modelGateLabel,
  modelOperationLabel,
  modelRolloutLabel,
} from "@/shared/model-diagnostics-client";
import type { Backend } from "@/shared/types";
import { SETTINGS_LIMITS } from "@/shared/constants";
import type { UserSettings } from "@/shared/settings-types";
import { Field } from "./Form/Field";
import { Input } from "./Form/Input";
import { Switch } from "./Form/Switch";

const THRESHOLD_LIMITS = SETTINGS_LIMITS.experimentalMarkingThresholdPercent;

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
  const experimentalActive =
    view?.status.reasonCodes.includes("TMR_EXPERIMENTAL_UNCALIBRATED") ?? false;

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
      {view === null || experimentalActive ? null : (
        <p role="note">{modelCalibrationLabel(view.status)}</p>
      )}
      {isBuiltinFallback ? <p role="note">{BUILTIN_FALLBACK_COPY}</p> : null}
      {experimentalActive ? (
        <p role="status">{EXPERIMENTAL_UNCALIBRATED_COPY}</p>
      ) : null}
      {circuitBreakerOpen ? <p role="status">{CIRCUIT_BREAKER_COPY}</p> : null}
      {!active.calibrated && !experimentalActive ? (
        <p role="note">
          Modelos sem calibração verificada apenas indicam: nunca desfocam,
          recolhem ou ocultam posts.
        </p>
      ) : null}
      <Field label="Detector experimental (preview / não calibrado)">
        <Switch
          aria-label="Ativar detector experimental (preview / não calibrado)"
          checked={settings.experimentalUncalibratedTmr}
          onChange={(experimentalUncalibratedTmr) =>
            onUpdate({ experimentalUncalibratedTmr })
          }
        />
      </Field>
      <p role="note">
        Liga o modelo TMR mesmo sem a decisão científica. É um preview
        experimental, ainda não calibrado para PT-BR: os resultados são apenas
        indicativos e podem errar. As ações visuais (desfocar, recolher,
        ocultar) seguem a sua escolha em “Modo de apresentação”; enquanto
        desligado, permanece o fallback estilométrico.
      </p>
      {settings.experimentalUncalibratedTmr ? (
        <Field
          label="Limiar de marcação experimental (%)"
          description="Pontuação mínima do modelo para marcar um post no modo experimental. Menor = mais sensível (marca mais, erra mais). Sem efeito no caminho calibrado."
        >
          <Input
            aria-label="Limiar de marcação experimental (%)"
            type="number"
            min={THRESHOLD_LIMITS.minimum}
            max={THRESHOLD_LIMITS.maximum}
            value={settings.experimentalMarkingThresholdPercent}
            onChange={(event) => {
              const next = Number(event.target.value);
              if (
                Number.isSafeInteger(next) &&
                next >= THRESHOLD_LIMITS.minimum &&
                next <= THRESHOLD_LIMITS.maximum
              ) {
                onUpdate({ experimentalMarkingThresholdPercent: next });
              }
            }}
          />
        </Field>
      ) : null}
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
