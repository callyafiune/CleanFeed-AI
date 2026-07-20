import type { ModelStatus } from "@/shared/types";

export function ModelStatusCard({ status }: { status: ModelStatus | null }) {
  const items: [label: string, value: string][] = [
    ["Modelo", status?.runtimeIdentity?.modelId ?? "indisponível"],
    ["Versão", status?.runtimeIdentity?.modelVersion ?? "indisponível"],
    ["Backend", status?.backend ?? "indisponível"],
    ["Estado", modelStateLabel(status?.state)],
  ];

  return (
    <section aria-label="Estado do modelo">
      <h2>Modelo local</h2>
      <dl>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
      {status?.reasonCodes.includes("WEBGPU_FALLBACK") ? (
        <p role="status">WebGPU indisponível; usando WASM local.</p>
      ) : null}
    </section>
  );
}

function modelStateLabel(state: ModelStatus["state"] | undefined): string {
  switch (state) {
    case "initializing":
      return "inicializando";
    case "disposing":
      return "liberando modelo";
    case "ready":
      return "pronto";
    case "degraded":
      return "degradado";
    case "error":
      return "erro";
    default:
      return "indisponível";
  }
}
