import {
  BackgroundMessageRouter,
  RuntimeOffscreenClient,
  classificationErrorMessage,
} from "@/background/message-router";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import { CleanFeedError } from "@/shared/errors";
import { parseExtensionMessage } from "@/shared/message-validation";
import { ClassificationCache } from "@/storage/cache";
import { MetricsRepository } from "@/storage/metrics";
import { ChromeStorageArea } from "@/storage/storage-area";

const storage = new ChromeStorageArea();
const router = new BackgroundMessageRouter({
  cache: new ClassificationCache(
    storage,
    { now: () => Date.now() },
    {
      maximumEntries: DEFAULT_SETTINGS.cacheMaximumEntries,
      ttlMs: DEFAULT_SETTINGS.cacheTtlMs,
    },
  ),
  metrics: new MetricsRepository(storage),
  offscreenClient: new RuntimeOffscreenClient(),
  modelKey: "mock:1.0.0",
  settingsFingerprint: "settings-v1",
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  void router
    .handle(message, sender)
    .then((response) => sendResponse(response))
    .catch((error: unknown) => {
      try {
        const request = parseExtensionMessage(message);
        if (!isClassifyTextMessage(request)) {
          sendResponse(undefined);
          return;
        }

        sendResponse(
          classificationErrorMessage(
            request,
            error instanceof CleanFeedError
              ? error
              : new CleanFeedError("INFERENCE_FAILED", "INFERENCE_FAILED"),
          ),
        );
      } catch {
        sendResponse(undefined);
      }
    });
  return true;
});

function isClassifyTextMessage(
  message: ReturnType<typeof parseExtensionMessage>,
): message is Parameters<typeof classificationErrorMessage>[0] {
  return message.target === "background" && message.type === "CLASSIFY_TEXT";
}
