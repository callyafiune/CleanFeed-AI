import {
  BackgroundMessageRouter,
  RuntimeOffscreenClient,
} from "@/background/message-router";
import { DEFAULT_SETTINGS } from "@/shared/constants";
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
    .catch(() => sendResponse(undefined));
  return true;
});
