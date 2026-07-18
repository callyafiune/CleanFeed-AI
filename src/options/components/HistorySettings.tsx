import { useEffect, useMemo, useState } from "react";

import type { HistoryApi } from "@/options/api-types";
import { ConfirmDialog } from "@/options/components/ConfirmDialog";
import { HistoryTable } from "@/options/components/HistoryTable";
import { downloadJson } from "@/options/download";
import type { UserSettings } from "@/shared/settings-types";
import type { ClassificationStatus, HistoryEntry } from "@/shared/types";
import {
  DEFAULT_HISTORY_MAXIMUM_ENTRIES,
  HISTORY_MAXIMUM_ENTRIES_RANGE,
} from "@/storage/history";

interface HistorySettingsProps {
  settings: UserSettings;
  api: HistoryApi;
  onSaveSettings: (change: Partial<UserSettings>) => void;
}

const PAGE_SIZE = 20;

const RETENTION_OPTIONS = [7, 14, 30, 60, 90, 180, 365] as const;

const STATUS_OPTIONS: readonly {
  value: ClassificationStatus;
  label: string;
}[] = [
  { value: "probably_human", label: "Provavelmente humano" },
  { value: "inconclusive", label: "Inconclusivo" },
  { value: "possibly_ai", label: "Possivelmente IA" },
  { value: "strong_ai_indication", label: "Forte indício de IA" },
  { value: "insufficient_evidence", label: "Evidência insuficiente" },
  { value: "classification_failed", label: "Falha na classificação" },
];

const STATUS_VALUES = new Set<string>(
  STATUS_OPTIONS.map((option) => option.value),
);

/**
 * Local classification-history controls. Enabling recording, retention and the
 * display cap save directly (they only ever reduce or bound stored data), but
 * enabling FULL-TEXT storage and CLEARING the history each require an explicit
 * modal confirmation, so no sensitive action happens on a single toggle. The
 * table never renders a text column while full-text storage is off.
 */
export function HistorySettings({
  settings,
  api,
  onSaveSettings,
}: HistorySettingsProps) {
  const [entries, setEntries] = useState<HistoryEntry[]>([]);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const [platform, setPlatform] = useState("");
  const [status, setStatus] = useState("");
  const [maxEntries, setMaxEntries] = useState(DEFAULT_HISTORY_MAXIMUM_ENTRIES);
  const [page, setPage] = useState(0);
  const [fullTextDialogOpen, setFullTextDialogOpen] = useState(false);
  const [clearDialogOpen, setClearDialogOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queryFilter = {
    platform: platform === "" ? undefined : platform,
    status: status === "" ? undefined : (status as ClassificationStatus),
  };

  // Re-usable reload for the mutation handlers (event context, not an effect).
  const refresh = (): Promise<void> =>
    api.query(queryFilter).then(
      (rows) => {
        setEntries(rows);
        setPage(0);
        setError(null);
      },
      () => setError("Não foi possível carregar o histórico."),
    );

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const rows = await api.query({
          platform: platform === "" ? undefined : platform,
          status: status === "" ? undefined : (status as ClassificationStatus),
        });
        if (active) {
          setEntries(rows);
          setPage(0);
          setError(null);
        }
      } catch {
        if (active) setError("Não foi possível carregar o histórico.");
      }
    })();
    return () => {
      active = false;
    };
  }, [api, platform, status]);

  useEffect(() => {
    const getTexts = api.getTexts;
    if (!settings.storeFullText || getTexts === undefined) return;
    let active = true;
    void (async () => {
      try {
        const loaded = await getTexts();
        if (active) setTexts(loaded);
      } catch {
        // A failed text read leaves the previous (unused-while-off) map.
      }
    })();
    return () => {
      active = false;
    };
  }, [api, settings.storeFullText]);

  const capped = useMemo(
    () => entries.slice(0, Math.max(1, maxEntries)),
    [entries, maxEntries],
  );
  const pageCount = Math.max(1, Math.ceil(capped.length / PAGE_SIZE));
  const safePage = Math.min(page, pageCount - 1);
  const visible = capped.slice(
    safePage * PAGE_SIZE,
    (safePage + 1) * PAGE_SIZE,
  );

  const handleFullTextToggle = (checked: boolean) => {
    if (checked) {
      setFullTextDialogOpen(true);
    } else {
      onSaveSettings({ storeFullText: false });
    }
  };

  const confirmFullText = () => {
    setFullTextDialogOpen(false);
    onSaveSettings({ storeFullText: true });
  };

  const confirmClear = () => {
    setClearDialogOpen(false);
    void api
      .clear()
      .then(refresh)
      .catch(() => setError("Não foi possível limpar o histórico."));
  };

  const exportHistory = () => {
    void api
      .export()
      .then((value) => downloadJson("cleanfeed-history.json", value))
      .catch(() => setError("Não foi possível exportar o histórico."));
  };

  return (
    <section aria-labelledby="history-heading">
      <h2 id="history-heading">Histórico local</h2>
      <p>
        O histórico é local e desativado por padrão. As linhas nunca guardam o
        texto, o autor ou a URL do post.
      </p>

      <label>
        <input
          checked={settings.historyEnabled}
          type="checkbox"
          onChange={(event) =>
            onSaveSettings({ historyEnabled: event.target.checked })
          }
        />
        Registrar histórico local
      </label>

      <label>
        <input
          checked={settings.storeFullText}
          type="checkbox"
          onChange={(event) => handleFullTextToggle(event.target.checked)}
        />
        Armazenar texto integral
      </label>

      <label>
        Retenção (dias)
        <select
          aria-label="Retenção (dias)"
          value={settings.historyRetentionDays}
          onChange={(event) =>
            onSaveSettings({ historyRetentionDays: Number(event.target.value) })
          }
        >
          {RETENTION_OPTIONS.map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </label>

      <label>
        Máximo de registros exibidos
        <input
          aria-label="Máximo de registros exibidos"
          max={HISTORY_MAXIMUM_ENTRIES_RANGE.maximum}
          min={HISTORY_MAXIMUM_ENTRIES_RANGE.minimum}
          type="number"
          value={maxEntries}
          onChange={(event) => {
            const value = Number(event.target.value);
            if (Number.isSafeInteger(value) && value >= 1) setMaxEntries(value);
          }}
        />
      </label>

      <label>
        Filtrar por plataforma
        <select
          aria-label="Filtrar por plataforma"
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
        >
          <option value="">Todas</option>
          <option value="linkedin">LinkedIn</option>
          <option value="manual">Análise manual</option>
        </select>
      </label>

      <label>
        Filtrar por resultado
        <select
          aria-label="Filtrar por resultado"
          value={status}
          onChange={(event) =>
            setStatus(
              STATUS_VALUES.has(event.target.value) ? event.target.value : "",
            )
          }
        >
          <option value="">Todos</option>
          {STATUS_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </label>

      <button type="button" onClick={exportHistory}>
        Exportar histórico
      </button>
      <button type="button" onClick={() => setClearDialogOpen(true)}>
        Limpar histórico
      </button>

      {error === null ? null : <p role="alert">{error}</p>}

      <HistoryTable
        entries={visible}
        storeFullText={settings.storeFullText}
        texts={texts}
      />

      <nav aria-label="Paginação do histórico">
        <button
          disabled={safePage <= 0}
          type="button"
          onClick={() => setPage(Math.max(0, safePage - 1))}
        >
          Página anterior
        </button>
        <span>
          Página {safePage + 1} de {pageCount}
        </span>
        <button
          disabled={safePage >= pageCount - 1}
          type="button"
          onClick={() => setPage(Math.min(pageCount - 1, safePage + 1))}
        >
          Próxima página
        </button>
      </nav>

      {fullTextDialogOpen ? (
        <ConfirmDialog
          cancelLabel="Cancelar armazenamento"
          confirmLabel="Confirmar armazenamento"
          title="Confirmar armazenamento de texto"
          onCancel={() => setFullTextDialogOpen(false)}
          onConfirm={confirmFullText}
        >
          <p>
            O texto integral dos posts será armazenado localmente neste
            navegador. Ele continua nunca saindo do dispositivo, mas fica
            legível para quem tiver acesso a este perfil. Confirme apenas se
            você deseja essa retenção.
          </p>
        </ConfirmDialog>
      ) : null}

      {clearDialogOpen ? (
        <ConfirmDialog
          cancelLabel="Cancelar limpeza de histórico"
          confirmLabel="Confirmar limpeza de histórico"
          title="Confirmar limpeza de histórico"
          onCancel={() => setClearDialogOpen(false)}
          onConfirm={confirmClear}
        >
          <p>
            Isto remove todos os registros do histórico e qualquer texto
            integral armazenado. A ação não pode ser desfeita.
          </p>
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
