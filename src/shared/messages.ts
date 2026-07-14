import type { CleanFeedError } from "@/shared/errors";
import type { UserSettings } from "@/shared/settings-types";
import type {
  ClassificationResult,
  ModelStatus,
  PageStats,
} from "@/shared/types";

export type ExtensionContext =
  "content" | "popup" | "options" | "background" | "offscreen" | "worker";

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

type EmptyPayload = undefined;

export type ExtensionMessage =
  | (MessageEnvelope<
      "CLASSIFY_TEXT" | "OFFSCREEN_CLASSIFY",
      ClassificationRequest
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
  | MessageEnvelope<
      "GET_SETTINGS" | "CACHE_CLEAR" | "METRICS_CLEAR",
      EmptyPayload
    >
  | MessageEnvelope<"SETTINGS_RESULT", UserSettings>
  | MessageEnvelope<
      "ERROR",
      { code: CleanFeedError["code"]; recoverable: boolean }
    >;
