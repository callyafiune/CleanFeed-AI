import {
  DEFAULT_SETTINGS,
  MAX_CLASSIFICATION_TEXT_LENGTH,
} from "@/shared/constants";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { ManualAnalysisRequest } from "@/shared/messages";
import type { ClassificationResult } from "@/shared/types";

/**
 * Built, non-content-script entry the service worker injects on demand via
 * `chrome.scripting.executeScript`. It must land in `dist` under exactly this
 * name (see vite.config.ts).
 */
export const MANUAL_ANALYSIS_ENTRY = "manual-analysis.js";

/** Selections are capped to the classification character limit before sending. */
export const MAX_MANUAL_SELECTION_LENGTH = MAX_CLASSIFICATION_TEXT_LENGTH;

export interface ScriptingApi {
  executeScript(injection: {
    target: { tabId: number };
    files: string[];
  }): Promise<unknown>;
}

export interface TabMessenger {
  sendMessage(tabId: number, message: unknown): Promise<unknown>;
}

export interface ManualAnalysisControllerOptions {
  scripting: ScriptingApi;
  messenger: TabMessenger;
  /** Resolves the configured minimum word count for the panel's copy. */
  minimumWordCount?: () => number | Promise<number>;
  /** Receives every result a panel reports back, for local metrics. */
  onResult?: (result: ClassificationResult, tabId: number) => void;
  entry?: string;
}

/**
 * Coordinates the on-demand manual analysis panel from the service worker. It
 * injects the panel only under an explicit user gesture (activeTab/scripting),
 * hands it the selected text over a validated runtime message and never widens
 * host permissions. It keeps only ephemeral per-tab selection state.
 */
export class ManualAnalysisController {
  private readonly scripting: ScriptingApi;
  private readonly messenger: TabMessenger;
  private readonly resolveMinimumWordCount: () => number | Promise<number>;
  private readonly onResult?: (
    result: ClassificationResult,
    tabId: number,
  ) => void;
  private readonly entry: string;
  private readonly pending = new Map<number, ManualAnalysisRequest>();

  constructor(options: ManualAnalysisControllerOptions) {
    this.scripting = options.scripting;
    this.messenger = options.messenger;
    this.resolveMinimumWordCount =
      options.minimumWordCount ?? (() => DEFAULT_SETTINGS.minimumWordCount);
    this.onResult = options.onResult;
    this.entry = options.entry ?? MANUAL_ANALYSIS_ENTRY;
  }

  /**
   * Injects the panel into the given tab and hands it the (truncated) selection.
   * Because the panel attaches its listener asynchronously after mounting, the
   * `MANUAL_ANALYSIS_READY` handshake below re-delivers the selection if this
   * eager send arrives before the listener is live.
   */
  async open(tabId: number, selectedText: string): Promise<void> {
    const request: ManualAnalysisRequest = {
      selectedText: selectedText.slice(0, MAX_MANUAL_SELECTION_LENGTH),
      minimumWordCount: await this.resolveMinimumWordCount(),
    };
    this.pending.set(tabId, request);
    await this.scripting.executeScript({
      target: { tabId },
      files: [this.entry],
    });
    await this.messenger.sendMessage(tabId, showMessage(request));
  }

  /** Handles panel-originated messages (ready handshake and reported results). */
  async handleMessage(
    rawMessage: unknown,
    sender?: { tab?: { id?: number } },
  ): Promise<void> {
    const message = parseExtensionMessage(rawMessage);
    const tabId = sender?.tab?.id;
    if (tabId === undefined) return;

    if (message.type === "MANUAL_ANALYSIS_READY") {
      const request = this.pending.get(tabId);
      if (request !== undefined) {
        await this.messenger.sendMessage(tabId, showMessage(request));
      }
      return;
    }

    if (message.type === "MANUAL_ANALYSIS_RESULT") {
      this.onResult?.(message.payload, tabId);
    }
  }

  /** Forgets a tab's pending selection (e.g. when it navigates or closes). */
  forget(tabId: number): void {
    this.pending.delete(tabId);
  }
}

function showMessage(request: ManualAnalysisRequest) {
  return {
    source: "background",
    target: "manual",
    type: "SHOW_MANUAL_ANALYSIS",
    payload: request,
  } as const;
}
