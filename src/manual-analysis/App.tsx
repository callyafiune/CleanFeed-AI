import {
  type KeyboardEvent,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

import { ManualEmptyState } from "@/manual-analysis/components/ManualEmptyState";
import { ManualResult } from "@/manual-analysis/components/ManualResult";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { ClassificationRequest } from "@/shared/messages";
import type { ClassificationResult } from "@/shared/types";
import { getTextLengthInfo } from "@/shared/word-count";

/** Platform identifier used for on-demand analysis outside a known adapter. */
export const MANUAL_PLATFORM_ID = "manual";

/**
 * The panel's dependency on the rest of the extension. `classify` reuses the
 * standard classification path (a `CLASSIFY_TEXT` message with `manual: true`);
 * `reportResult` optionally echoes the outcome back to the service worker for
 * local metrics. Both are injected so the panel is fully testable in isolation.
 */
export interface ManualAnalysisApi {
  classify(request: ClassificationRequest): Promise<ClassificationResult>;
  reportResult?(result: ClassificationResult): void;
}

export interface AppProps {
  api: ManualAnalysisApi;
  selectedText: string;
  minimumWordCount?: number;
  platform?: string;
  onClose?: () => void;
}

type AnalysisState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "done"; result: ClassificationResult }
  | { kind: "error" };

const ERROR_MESSAGE =
  "Não foi possível concluir a análise. Tente novamente em instantes.";

/**
 * The on-demand analysis panel. It renders only extension-owned UI, never
 * modifies the host page and shows results exclusively inside itself.
 */
export function App({
  api,
  selectedText,
  minimumWordCount = DEFAULT_SETTINGS.minimumWordCount,
  platform = MANUAL_PLATFORM_ID,
  onClose,
}: AppProps) {
  const [state, setState] = useState<AnalysisState>({ kind: "idle" });
  const panelRef = useRef<HTMLElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);

  // On mount: move focus into the dialog so assistive tech announces it and
  // keyboard users land inside it, and promote it to the browser top layer so a
  // transformed host ancestor cannot push the fixed panel off-screen. The
  // popover call is guarded because jsdom (tests) has no top-layer support.
  useEffect(() => {
    const panel = panelRef.current;
    if (panel === null) return;
    const withPopover = panel as HTMLElement & { showPopover?: () => void };
    if (typeof withPopover.showPopover === "function") {
      panel.setAttribute("popover", "manual");
      try {
        withPopover.showPopover();
      } catch {
        // Already shown or unsupported here; the fixed-position fallback applies.
      }
    }
    panel.focus();
  }, []);

  // When analysis completes, move focus to the result region (a live region) so
  // the outcome is announced instead of focus dropping when the button is gone.
  useEffect(() => {
    if (state.kind === "done") resultRef.current?.focus();
  }, [state.kind]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === "Escape" && onClose !== undefined) {
        event.stopPropagation();
        onClose();
      }
    },
    [onClose],
  );

  const runAnalysis = useCallback(() => {
    setState({ kind: "loading" });
    Promise.resolve(
      api.classify({ text: selectedText, platform, manual: true }),
    )
      .then((result) => {
        setState({ kind: "done", result });
        api.reportResult?.(result);
      })
      .catch(() => setState({ kind: "error" }));
  }, [api, platform, selectedText]);

  const trimmed = selectedText.trim();
  const wordCount = getTextLengthInfo(selectedText).wordCount;
  const busy = state.kind === "loading";

  return (
    <section
      ref={panelRef}
      className="cleanfeed-manual__panel"
      role="dialog"
      aria-label="Análise manual do CleanFeed"
      lang="pt-BR"
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <header className="cleanfeed-manual__header">
        <h1 className="cleanfeed-manual__title">Análise manual</h1>
        {onClose === undefined ? null : (
          <button
            type="button"
            className="cleanfeed-manual__close"
            onClick={onClose}
          >
            Fechar
          </button>
        )}
      </header>
      {renderBody()}
    </section>
  );

  function renderBody() {
    if (trimmed.length === 0) {
      return <ManualEmptyState reason="empty" />;
    }
    if (wordCount < minimumWordCount) {
      return <ManualEmptyState reason="below-minimum" />;
    }

    if (state.kind === "done") {
      return (
        <div
          className="cleanfeed-manual__result"
          role="status"
          aria-live="polite"
          tabIndex={-1}
          ref={resultRef}
        >
          <ManualResult
            result={state.result}
            onRetry={runAnalysis}
            busy={busy}
          />
        </div>
      );
    }

    return (
      <div className="cleanfeed-manual__body">
        <p className="cleanfeed-manual__count">
          {wordCount} palavras selecionadas
        </p>
        {state.kind === "error" ? (
          <p className="cleanfeed-manual__error" role="alert">
            {ERROR_MESSAGE}
          </p>
        ) : null}
        {busy ? (
          <p className="cleanfeed-manual__status" role="status">
            Analisando a seleção…
          </p>
        ) : null}
        <button
          type="button"
          className="cleanfeed-manual__analyze"
          onClick={runAnalysis}
          disabled={busy}
        >
          {state.kind === "error" ? "Analisar novamente" : "Analisar seleção"}
        </button>
      </div>
    );
  }
}
