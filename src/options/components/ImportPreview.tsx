import type {
  ImportCategory,
  ImportMode,
  ImportPreview as ImportPreviewData,
} from "@/storage/import-export";

interface ImportPreviewProps {
  preview: ImportPreviewData;
  mode: ImportMode;
  onModeChange: (mode: ImportMode) => void;
}

const CATEGORY_ORDER: readonly ImportCategory[] = [
  "settings",
  "platformSettings",
  "keywordRules",
  "feedback",
  "history",
  "metrics",
];

const CATEGORY_NAMES: Record<ImportCategory, string> = {
  settings: "Configurações",
  platformSettings: "Ajustes por plataforma",
  keywordRules: "Regras personalizadas",
  feedback: "Feedback",
  history: "Histórico",
  metrics: "Métricas",
};

function summaryLabel(category: ImportCategory, count: number): string {
  const singular = count === 1;
  switch (category) {
    case "settings":
      return singular ? "configuração" : "configurações";
    case "platformSettings":
      return singular ? "plataforma" : "plataformas";
    case "keywordRules":
      return singular ? "regra" : "regras";
    case "feedback":
      return singular ? "feedback" : "feedbacks";
    case "history":
      return singular ? "entrada de histórico" : "entradas de histórico";
    case "metrics":
      return singular ? "métrica" : "métricas";
  }
}

function buildSummary(preview: ImportPreviewData): string {
  const parts = CATEGORY_ORDER.filter(
    (category) =>
      preview.categories[category].present &&
      preview.categories[category].count > 0,
  ).map((category) => {
    const { count } = preview.categories[category];
    return `${count} ${summaryLabel(category, count)}`;
  });
  return parts.length === 0 ? "Nenhum dado reconhecido" : parts.join(", ");
}

/**
 * Presentational preview of a parsed import: a plain-language summary, the
 * per-category counts, any warnings and the merge/replace mode selector. It
 * writes nothing — applying the import is a separate, explicitly confirmed step
 * owned by the parent.
 */
export function ImportPreview({
  preview,
  mode,
  onModeChange,
}: ImportPreviewProps) {
  return (
    <div aria-labelledby="import-preview-heading">
      <h3 id="import-preview-heading">Pré-visualização da importação</h3>
      <p>{buildSummary(preview)}</p>
      <p>
        Exportado por versão {preview.extensionVersion} em {preview.exportedAt}.
      </p>

      <ul>
        {CATEGORY_ORDER.map((category) => (
          <li key={category}>
            {CATEGORY_NAMES[category]}:{" "}
            {preview.categories[category].present
              ? preview.categories[category].count
              : "ausente"}
          </li>
        ))}
      </ul>

      {preview.warnings.length === 0 ? null : (
        <div role="alert">
          <p>Avisos da importação</p>
          <ul aria-label="Avisos da importação">
            {preview.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      <fieldset>
        <legend>Modo de importação</legend>
        <label>
          <input
            checked={mode === "merge"}
            name="import-mode"
            type="radio"
            value="merge"
            onChange={() => onModeChange("merge")}
          />
          Mesclar com os dados atuais
        </label>
        <label>
          <input
            checked={mode === "replace"}
            name="import-mode"
            type="radio"
            value="replace"
            onChange={() => onModeChange("replace")}
          />
          Substituir os dados atuais
        </label>
      </fieldset>
    </div>
  );
}
