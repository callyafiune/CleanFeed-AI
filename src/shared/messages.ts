import type { CleanFeedError } from "@/shared/errors";
import type { ModelDiagnosticsView } from "@/shared/diagnostic-types";
import type { UserSettings } from "@/shared/settings-types";
import type {
  ClassificationResult,
  ModelStatus,
  PageStats,
} from "@/shared/types";

export type ExtensionContext =
  | "content"
  | "popup"
  | "options"
  | "background"
  | "offscreen"
  | "worker"
  | "manual";

export interface MessageEnvelope<TType extends string, TPayload> {
  source: ExtensionContext;
  target: ExtensionContext;
  type: TType;
  requestId?: string;
  payload: TPayload;
}

export interface ClassificationRequest {
  text: string;
  platform: string;
  manual: boolean;
}

export type OffscreenClassificationRequest = ClassificationRequest & {
  settings: UserSettings;
};

/**
 * The selection the service worker hands to a freshly injected manual analysis
 * panel. It carries only extension-owned data: the user-selected text (already
 * bounded to the classification limit) and the configured minimum word count so
 * the panel can explain a too-short selection without a round trip.
 */
export interface ManualAnalysisRequest {
  selectedText: string;
  minimumWordCount: number;
}

/**
 * A request to pause or resume CleanFeed on a single site. It carries only the
 * site's hostname (never a path, query or post text) so the background can keep
 * a hostname-only pause store.
 */
export interface DomainPauseRequest {
  hostname: string;
  paused: boolean;
}

type EmptyPayload = undefined;

export type ExtensionMessage =
  | (MessageEnvelope<
      "CLASSIFY_TEXT" | "OFFSCREEN_CLASSIFY",
      ClassificationRequest | OffscreenClassificationRequest
    > & {
      requestId: string;
    })
  | (MessageEnvelope<
      "CLASSIFICATION_RESULT" | "OFFSCREEN_RESULT",
      ClassificationResult
    > & {
      requestId: string;
    })
  | (MessageEnvelope<"CANCEL_CLASSIFICATION", EmptyPayload> & {
      requestId: string;
    })
  | MessageEnvelope<"GET_PAGE_STATS" | "CLEAR_PAGE_PRESENTATION", EmptyPayload>
  | MessageEnvelope<"PAGE_STATS_RESULT", PageStats>
  | MessageEnvelope<"UPDATE_SETTINGS", Partial<UserSettings>>
  | MessageEnvelope<"MODEL_STATUS_REQUEST", EmptyPayload>
  | MessageEnvelope<"MODEL_STATUS_RESULT" | "WORKER_STATUS", ModelStatus>
  | MessageEnvelope<"MODEL_DIAGNOSTICS_REQUEST", EmptyPayload>
  | MessageEnvelope<"MODEL_DIAGNOSTICS_RESULT", ModelDiagnosticsView>
  | MessageEnvelope<
      "GET_SETTINGS" | "CACHE_CLEAR" | "METRICS_CLEAR",
      EmptyPayload
    >
  | MessageEnvelope<"SETTINGS_RESULT", UserSettings>
  | MessageEnvelope<"SHOW_MANUAL_ANALYSIS", ManualAnalysisRequest>
  | MessageEnvelope<"MANUAL_ANALYSIS_READY", EmptyPayload>
  | MessageEnvelope<"MANUAL_ANALYSIS_RESULT", ClassificationResult>
  | MessageEnvelope<"PAUSE_DOMAIN", DomainPauseRequest>
  | MessageEnvelope<
      "ERROR",
      { code: CleanFeedError["code"]; recoverable: boolean }
    >;
