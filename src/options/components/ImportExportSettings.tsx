import { useState } from "react";

import type { ImportExportApi } from "@/options/api-types";
import { ConfirmDialog } from "@/options/components/ConfirmDialog";
import { ImportPreview } from "@/options/components/ImportPreview";
import { downloadJson } from "@/options/download";
import { MAX_IMPORT_BYTES } from "@/shared/export-validation";
import type {
  ImportCategory,
  ImportMode,
  ImportPreview as ImportPreviewData,
} from "@/storage/import-export";

const CATEGORY_ORDER: readonly ImportCategory[] = [
  "settings",
  "platformSettings",
  "keywordRules",
  "feedback",
  "history",
  "metrics",
];

/**
 * Import/export controls. Export requires the user to opt sensitive categories
 * (feedback, history) in explicitly via checkboxes. Import reads the file's text
 * ONLY after a byte-size check, shows a preview/warnings/mode without writing
 * anything, and applies only behind a final modal confirmation.
 */
export function ImportExportSettings({ api }: { api: ImportExportApi }) {
  const [includeSettings, setIncludeSettings] = useState(true);
  const [includePlatformSettings, setIncludePlatformSettings] = useState(true);
  const [includeKeywordRules, setIncludeKeywordRules] = useState(true);
  const [includeFeedback, setIncludeFeedback] = useState(false);
  const [includeHistory, setIncludeHistory] = useState(false);
  const [includeMetrics, setIncludeMetrics] = useState(false);

  const [preview, setPreview] = useState<ImportPreviewData | null>(null);
  const [mode, setMode] = useState<ImportMode>("merge");
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const exportData = () => {
    void api
      .buildExport({
        includeSettings,
        includePlatformSettings,
        includeKeywordRules,
        includeFeedback,
        includeHistory,
        includeMetrics,
      })
      .then((value) => {
        downloadJson("cleanfeed-export.json", value);
        setError(null);
      })
      .catch(() => setError("Não foi possível exportar os dados."));
  };

  const readFile = async (file: File): Promise<void> => {
    setPreview(null);
    setStatus(null);
    if (file.size > MAX_IMPORT_BYTES) {
      setError("O arquivo excede o tamanho máximo permitido.");
      return;
    }
    try {
      const text = await file.text();
      const parsed = await api.parseImport(text);
      setPreview(api.previewImport(parsed));
      setError(null);
    } catch {
      setPreview(null);
      setError("O arquivo de importação não é válido.");
    }
  };

  const applyImport = () => {
    if (preview === null) return;
    setApplyDialogOpen(false);
    const categories = CATEGORY_ORDER.filter(
      (category) => preview.categories[category].present,
    );
    void api
      .applyImport(preview, { mode, categories })
      .then((result) => {
        setStatus(
          `Importação concluída (${result.applied.length} categorias).`,
        );
        setError(null);
      })
      .catch(() => setError("Falha ao aplicar a importação."));
  };

  return (
    <section aria-labelledby="import-export-heading">
      <h2 id="import-export-heading">Importar e exportar</h2>

      <h3 id="export-heading">Exportar dados</h3>
      <p>
        Selecione o que incluir. Feedback e histórico são dados sensíveis e
        ficam desmarcados por padrão.
      </p>
      <label>
        <input
          checked={includeSettings}
          type="checkbox"
          onChange={(event) => setIncludeSettings(event.target.checked)}
        />
        Incluir configurações na exportação
      </label>
      <label>
        <input
          checked={includePlatformSettings}
          type="checkbox"
          onChange={(event) => setIncludePlatformSettings(event.target.checked)}
        />
        Incluir ajustes por plataforma na exportação
      </label>
      <label>
        <input
          checked={includeKeywordRules}
          type="checkbox"
          onChange={(event) => setIncludeKeywordRules(event.target.checked)}
        />
        Incluir regras na exportação
      </label>
      <label>
        <input
          checked={includeFeedback}
          type="checkbox"
          onChange={(event) => setIncludeFeedback(event.target.checked)}
        />
        Incluir feedback na exportação
      </label>
      <label>
        <input
          checked={includeHistory}
          type="checkbox"
          onChange={(event) => setIncludeHistory(event.target.checked)}
        />
        Incluir histórico na exportação
      </label>
      <label>
        <input
          checked={includeMetrics}
          type="checkbox"
          onChange={(event) => setIncludeMetrics(event.target.checked)}
        />
        Incluir métricas na exportação
      </label>
      <button type="button" onClick={exportData}>
        Exportar dados
      </button>

      <h3 id="import-heading">Importar dados</h3>
      <label>
        Arquivo de importação
        <input
          accept="application/json"
          aria-label="Arquivo de importação"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void readFile(file);
          }}
        />
      </label>

      {error === null ? null : <p role="alert">{error}</p>}
      {status === null ? null : <p role="status">{status}</p>}

      {preview === null ? null : (
        <ImportPreview mode={mode} preview={preview} onModeChange={setMode} />
      )}

      <button
        disabled={preview === null}
        type="button"
        onClick={() => setApplyDialogOpen(true)}
      >
        Aplicar importação
      </button>

      {applyDialogOpen && preview !== null ? (
        <ConfirmDialog
          cancelLabel="Cancelar importação"
          confirmLabel="Confirmar importação"
          title="Confirmar importação"
          onCancel={() => setApplyDialogOpen(false)}
          onConfirm={applyImport}
        >
          <p>
            Os dados selecionados serão importados no modo{" "}
            {mode === "merge" ? "mesclar" : "substituir"}. Esta ação altera os
            dados locais da extensão.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
