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

/**
 * The read-only model card. It surfaces the active identity and operation plus
 * the descriptor's scientific decision and rollout, the calibration coverage and
 * the earliest profile expiry. It never claims quality or authorship, never
 * shows an individual score, `selectedProfileDigest`, `cacheValidUntil` or a
 * calibration digest, and makes the degraded/fallback state visible.
 */
export function ModelStatusCard({
  diagnostics,
}: {
  diagnostics: ModelDiagnosticsView | null;
}) {
  const status = diagnostics?.status ?? null;
  const identity = status?.runtimeIdentity ?? null;

  const items: [label: string, value: string][] = [
    ["Modelo", identity?.modelId ?? "indisponível"],
    ["Versão", identity?.modelVersion ?? "indisponível"],
    ["Backend", status?.backend ?? "indisponível"],
    ["Estado", modelOperationLabel(status?.state)],
  ];
  if (diagnostics !== null) {
    items.push(
      ["Decisão científica", modelGateLabel(diagnostics.release)],
      ["Rollout", modelRolloutLabel(diagnostics.release)],
      ["Perfis de calibração", String(diagnostics.status.profileCount)],
      [
        "Validade mínima",
        formatEarliestExpiry(diagnostics.status.earliestExpiry),
      ],
    );
  }

  const isBuiltinFallback = identity?.kind === "builtin";
  const circuitBreakerOpen =
    status?.reasonCodes.includes("CIRCUIT_BREAKER_OPEN") ?? false;
  const webGpuFallback =
    status?.reasonCodes.includes("WEBGPU_FALLBACK") ?? false;
  const experimentalUncalibrated =
    status?.reasonCodes.includes("TMR_EXPERIMENTAL_UNCALIBRATED") ?? false;

  return (
    <section aria-label="Estado do modelo" className="card">
      <h2>Modelo local</h2>
      <dl>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {diagnostics !== null ? (
        <p role="note">{modelCalibrationLabel(diagnostics.status)}</p>
      ) : null}
      {isBuiltinFallback ? <p role="note">{BUILTIN_FALLBACK_COPY}</p> : null}
      {experimentalUncalibrated ? (
        <p role="status">{EXPERIMENTAL_UNCALIBRATED_COPY}</p>
      ) : null}
      {circuitBreakerOpen ? <p role="status">{CIRCUIT_BREAKER_COPY}</p> : null}
      {webGpuFallback ? (
        <p role="status">WebGPU indisponível; usando WASM local.</p>
      ) : null}
    </section>
  );
}
