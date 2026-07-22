import type { PageStats } from "@/shared/types";

export function PageStatsSummary({ stats }: { stats: PageStats }) {
  // Every detected post lands in exactly one bucket; the ones not yet analyzed
  // (scrolled past before reaching the viewport, recycled by the feed's
  // virtualization, or filtered by a rule other than length/language) are the
  // difference, surfaced so "Encontrados" reconciles instead of looking like a
  // silent failure.
  const pending = Math.max(
    0,
    stats.postsFound -
      stats.analyzed -
      stats.skippedByLength -
      stats.skippedByLanguage -
      stats.queueSize,
  );
  const items: [label: string, value: string | number][] = [
    ["Encontrados", stats.postsFound],
    ["Analisados", stats.analyzed],
    ["Não analisados (rolagem/filtros)", pending],
    ["Ignorados por tamanho", stats.skippedByLength],
    ["Ignorados por idioma", stats.skippedByLanguage],
    ["Marcados", stats.marked],
    ["Desfocados", stats.blurred],
    ["Recolhidos", stats.collapsed],
    ["Ocultados", stats.hidden],
    ["Restaurados", stats.restored],
    ["Latência média", `${Math.round(stats.averageInferenceMs)} ms`],
    ["Fila", stats.queueSize],
  ];

  return (
    <section aria-label="Resumo da página" className="card">
      <h2>Resumo desta página</h2>
      <p>Plataforma: {platformLabel(stats.platform)}</p>
      <dl>
        {items.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function platformLabel(platform: PageStats["platform"]): string {
  if (platform === "linkedin") return "LinkedIn";
  return platform ?? "Desconhecida";
}
