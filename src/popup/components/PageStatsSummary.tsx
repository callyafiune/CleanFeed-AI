import type { PageStats } from "@/shared/types";

export function PageStatsSummary({ stats }: { stats: PageStats }) {
  const items: [label: string, value: string | number][] = [
    ["Encontrados", stats.postsFound],
    ["Analisados", stats.analyzed],
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
    <section aria-label="Resumo da página">
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
