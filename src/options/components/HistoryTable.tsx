import { CLASSIFICATION_STATUS_COPY } from "@/shared/classification-copy";
import type { HistoryEntry } from "@/shared/types";
import type { PresentationMode } from "@/shared/types";

interface HistoryTableProps {
  entries: HistoryEntry[];
  storeFullText: boolean;
  texts: Record<string, string>;
}

const ACTION_LABELS: Record<PresentationMode, string> = {
  indicator: "Indicador",
  blur: "Desfoque",
  collapse: "Recolhimento",
  hide: "Ocultação",
};

const TEXT_STYLE: React.CSSProperties = {
  display: "inline-block",
  maxWidth: "32ch",
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
  verticalAlign: "bottom",
};

function formatDate(timestamp: number): string {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toISOString().replace("T", " ").slice(0, 16);
}

/**
 * Renders the (always text-free) history rows. The raw/calibrated score is never
 * shown — there is no score column and `row.score` (kept only for storage
 * migration and cache identity) is never rendered. The "Texto integral" column
 * is rendered ONLY when the user opted into full-text storage; while the opt-in
 * is off, no text column exists at all, so no opted-out text can ever be shown.
 */
export function HistoryTable({
  entries,
  storeFullText,
  texts,
}: HistoryTableProps) {
  return (
    <table aria-label="Histórico de classificações">
      <thead>
        <tr>
          <th scope="col">Data</th>
          <th scope="col">Plataforma</th>
          <th scope="col">Resultado</th>
          <th scope="col">Ação</th>
          <th scope="col">Origem</th>
          {storeFullText ? <th scope="col">Texto integral</th> : null}
        </tr>
      </thead>
      <tbody>
        {entries.length === 0 ? (
          <tr>
            <td colSpan={storeFullText ? 6 : 5}>
              Nenhum registro no histórico.
            </td>
          </tr>
        ) : (
          entries.map((row) => (
            <tr key={row.textHash}>
              <td>{formatDate(row.timestamp)}</td>
              <td>{row.platform}</td>
              <td>{CLASSIFICATION_STATUS_COPY[row.status]}</td>
              <td>
                {row.action === undefined ? "—" : ACTION_LABELS[row.action]}
              </td>
              <td>{row.origin === "rule" ? "Regra" : "Modelo"}</td>
              {storeFullText ? (
                <td>
                  <span style={TEXT_STYLE} title={texts[row.textHash] ?? ""}>
                    {texts[row.textHash] ?? "—"}
                  </span>
                </td>
              ) : null}
            </tr>
          ))
        )}
      </tbody>
    </table>
  );
}
