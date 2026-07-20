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
import { Field } from "./Form/Field";
import { Fieldset } from "./Form/Fieldset";
import { Switch } from "./Form/Switch";

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
    <Fieldset title="Importar e exportar">
      <p>
        Use esta seção para fazer backup das suas configurações e regras, ou
        para restaurá-las em outro navegador.
      </p>

      <h3>Exportar dados</h3>
      <p>
        Selecione o que incluir. Feedback e histórico são dados sensíveis e
        ficam desmarcados por padrão.
      </p>
      <Field label="Configurações">
        <Switch
          aria-label="Incluir configurações na exportação"
          checked={includeSettings}
          onChange={setIncludeSettings}
        />
      </Field>
      <Field label="Ajustes por plataforma">
        <Switch
          aria-label="Incluir ajustes por plataforma na exportação"
          checked={includePlatformSettings}
          onChange={setIncludePlatformSettings}
        />
      </Field>
      <Field label="Regras">
        <Switch
          aria-label="Incluir regras na exportação"
          checked={includeKeywordRules}
          onChange={setIncludeKeywordRules}
        />
      </Field>
      <Field label="Feedback">
        <Switch
          aria-label="Incluir feedback na exportação"
          checked={includeFeedback}
          onChange={setIncludeFeedback}
        />
      </Field>
      <Field label="Histórico">
        <Switch
          aria-label="Incluir histórico na exportação"
          checked={includeHistory}
          onChange={setIncludeHistory}
        />
      </Field>
      <Field label="Métricas">
        <Switch
          aria-label="Incluir métricas na exportação"
          checked={includeMetrics}
          onChange={setIncludeMetrics}
        />
      </Field>
      <div className="button-group">
        <button type="button" onClick={exportData}>
          Exportar dados
        </button>
      </div>

      <h3>Importar dados</h3>
      <Field label="Arquivo de importação">
        <input
          accept="application/json"
          aria-label="Arquivo de importação"
          type="file"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file !== undefined) void readFile(file);
          }}
        />
      </Field>

      {error === null ? null : <p role="alert">{error}</p>}
      {status === null ? null : <p role="status">{status}</p>}

      {preview === null ? null : (
        <ImportPreview mode={mode} preview={preview} onModeChange={setMode} />
      )}

      <div className="button-group">
        <button
          disabled={preview === null}
          type="button"
          onClick={() => setApplyDialogOpen(true)}
        >
          Aplicar importação
        </button>
      </div>

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
    </Fieldset>
  );
}
