import type { PageStats } from "@/shared/types";

export function PageStatsSummary({ stats }: { stats: PageStats }) {
  return (
    <section aria-label="Resumo da página">
      <h2>Resumo desta página</h2>
      <p>
        {stats.postsFound} encontradas · {stats.analyzed} analisadas ·{" "}
        {stats.marked} marcadas
      </p>
      <p>
        {stats.skippedByLength} curtas ignoradas · {stats.skippedByLanguage}{" "}
        ignoradas por idioma
      </p>
      <p>
        Latência média: {Math.round(stats.averageInferenceMs)} ms · Fila:{" "}
        {stats.queueSize}
      </p>
    </section>
  );
}
