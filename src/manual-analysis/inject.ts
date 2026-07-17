import { createElement } from "react";
import { createRoot } from "react-dom/client";

import { App, type ManualAnalysisApi } from "@/manual-analysis/App";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import { parseExtensionMessage } from "@/shared/message-validation";
import type {
  ClassificationRequest,
  ManualAnalysisRequest,
} from "@/shared/messages";
import type { ClassificationResult } from "@/shared/types";

/** Marks the single host element CleanFeed injects for on-demand analysis. */
export const MANUAL_HOST_ATTRIBUTE = "data-cleanfeed-manual-host";

/**
 * All panel styling lives in this trusted constant and is injected into the
 * shadow root, so host-page CSS cannot reach the panel and the panel cannot
 * leak styles onto the page. It is never derived from page content.
 */
const MANUAL_PANEL_STYLES = `
:host { all: initial; }
.cleanfeed-manual__panel {
  position: fixed;
  top: 16px;
  inset-inline-end: 16px;
  z-index: 2147483647;
  max-width: 360px;
  padding: 16px;
  background: Canvas;
  color: CanvasText;
  border: 2px solid CanvasText;
  border-radius: 8px;
  font: 14px/1.5 system-ui, sans-serif;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.25);
}
.cleanfeed-manual__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}
.cleanfeed-manual__title { font-size: 16px; margin: 0; }
.cleanfeed-manual button {
  font: inherit;
  cursor: pointer;
  padding: 6px 10px;
  border: 2px solid CanvasText;
  border-radius: 6px;
  background: Canvas;
  color: CanvasText;
}
.cleanfeed-manual button:focus-visible { outline: 2px solid Highlight; outline-offset: 2px; }
.cleanfeed-manual button[disabled] { opacity: 0.6; cursor: default; }
.cleanfeed-manual__error { color: CanvasText; font-weight: 600; }
.cleanfeed-manual ul { margin: 4px 0 0; padding-inline-start: 18px; }
@media (prefers-reduced-motion: reduce) {
  .cleanfeed-manual * { transition: none !important; animation: none !important; }
}
`;

/**
 * The panel's link to the service worker. It is closed over the ShadowRoot's
 * React root so nothing is exposed on the host DOM.
 */
export interface ManualPanelMessaging {
  readonly api: ManualAnalysisApi;
  onShow(handler: (request: ManualAnalysisRequest) => void): void;
  sendReady(): void;
  dispose(): void;
}

export interface InjectDependencies {
  document?: Document;
  messaging?: ManualPanelMessaging;
  /**
   * Shadow root mode. Defaults to "closed" so page scripts cannot reach the
   * panel via `host.shadowRoot` (verdict spoofing / selection readout). Tests
   * pass "open" to inspect the rendered tree.
   */
  shadowMode?: ShadowRootMode;
}

const UNAVAILABLE_API: ManualAnalysisApi = {
  classify: () => Promise.reject(new Error("MANUAL_ANALYSIS_UNAVAILABLE")),
};

/**
 * Idempotently mounts the isolated manual analysis panel. Only extension-owned
 * nodes are created; the host page's DOM and styles are never touched. Called
 * again, it returns the existing host instead of mounting a second panel.
 */
export function injectManualAnalysisPanel(
  dependencies: InjectDependencies = {},
): HTMLElement {
  const doc = dependencies.document ?? document;
  const existing = doc.querySelector<HTMLElement>(`[${MANUAL_HOST_ATTRIBUTE}]`);
  if (existing !== null) return existing;

  const host = doc.createElement("div");
  host.setAttribute(MANUAL_HOST_ATTRIBUTE, "");
  host.dataset.cleanfeedOwned = "manual-host";
  // Harden the host against page CSS that could hide the whole panel (e.g. a
  // broad `div { display: none }` or a cosmetic filter). Inline !important beats
  // any non-inline page rule and the page cannot set inline styles on our node.
  host.style.setProperty("display", "block", "important");
  host.style.setProperty("visibility", "visible", "important");
  host.style.setProperty("opacity", "1", "important");
  const shadow = host.attachShadow({
    mode: dependencies.shadowMode ?? "closed",
  });

  const style = doc.createElement("style");
  style.textContent = MANUAL_PANEL_STYLES;
  const container = doc.createElement("div");
  container.className = "cleanfeed-manual";
  shadow.append(style, container);
  (doc.body ?? doc.documentElement).append(host);

  const messaging = dependencies.messaging ?? chromeMessaging();
  const root = createRoot(container);
  let selection: ManualAnalysisRequest | null = null;

  const close = (): void => {
    root.unmount();
    messaging?.dispose();
    host.remove();
  };

  const render = (): void => {
    root.render(
      createElement(App, {
        api: messaging?.api ?? UNAVAILABLE_API,
        selectedText: selection?.selectedText ?? "",
        minimumWordCount:
          selection?.minimumWordCount ?? DEFAULT_SETTINGS.minimumWordCount,
        onClose: close,
      }),
    );
  };

  render();
  if (messaging !== undefined) {
    messaging.onShow((request) => {
      selection = request;
      render();
    });
    messaging.sendReady();
  }
  return host;
}

/** Builds the chrome-backed messaging port, or undefined outside an extension. */
function chromeMessaging(): ManualPanelMessaging | undefined {
  if (
    typeof chrome === "undefined" ||
    chrome.runtime?.onMessage === undefined ||
    chrome.runtime.sendMessage === undefined
  ) {
    return undefined;
  }

  const runtime = chrome.runtime;
  let requestSequence = 0;
  let listener: Parameters<typeof runtime.onMessage.addListener>[0] | undefined;

  const api: ManualAnalysisApi = {
    async classify(request: ClassificationRequest) {
      const requestId = `manual-${++requestSequence}`;
      const response = await runtime.sendMessage({
        source: "manual",
        target: "background",
        type: "CLASSIFY_TEXT",
        requestId,
        payload: request,
      });
      const message = parseExtensionMessage(response);
      if (message.type === "ERROR") {
        throw new Error(message.payload.code);
      }
      if (
        message.type !== "CLASSIFICATION_RESULT" ||
        message.source !== "background"
      ) {
        throw new Error("INVALID_MANUAL_RESULT");
      }
      return message.payload;
    },
    reportResult(result: ClassificationResult) {
      void runtime.sendMessage({
        source: "manual",
        target: "background",
        type: "MANUAL_ANALYSIS_RESULT",
        payload: result,
      });
    },
  };

  return {
    api,
    onShow(handler) {
      listener = (rawMessage: unknown) => {
        try {
          const message = parseExtensionMessage(rawMessage);
          if (
            message.type === "SHOW_MANUAL_ANALYSIS" &&
            message.source === "background" &&
            message.target === "manual"
          ) {
            handler(message.payload);
          }
        } catch {
          // Ignore anything that is not part of the extension contract.
        }
      };
      runtime.onMessage.addListener(listener);
    },
    sendReady() {
      void runtime.sendMessage({
        source: "manual",
        target: "background",
        type: "MANUAL_ANALYSIS_READY",
        payload: undefined,
      });
    },
    dispose() {
      if (listener !== undefined) runtime.onMessage.removeListener(listener);
    },
  };
}

// Self-mount when injected into a tab by the service worker. Guarded so that
// importing this module in tests (no extension runtime) never mounts a panel.
if (typeof chrome !== "undefined" && chrome.runtime?.id !== undefined) {
  injectManualAnalysisPanel();
}
