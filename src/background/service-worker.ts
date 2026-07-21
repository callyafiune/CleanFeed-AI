import {
  createContextMenuClickHandler,
  createContextMenus,
} from "@/background/context-menu";
import {
  ManualAnalysisController,
  isManualPanelMessage,
} from "@/background/manual-analysis-controller";
import {
  BackgroundMessageRouter,
  RuntimeOffscreenClient,
  classificationErrorMessage,
} from "@/background/message-router";
import { createSettingsFingerprintProvider } from "@/background/settings-fingerprint";
import { loadRuntimeDescriptor } from "@/inference/model-bundle";
import { STYLOMETRIC_MODEL_KEY } from "@/inference/stylometric-classifier";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type { DiagnosticReleaseStatus } from "@/shared/diagnostic-types";
import { CleanFeedError } from "@/shared/errors";
import { parseExtensionMessage } from "@/shared/message-validation";
import { ClassificationCache } from "@/storage/cache";
import { DomainPauseRepository } from "@/storage/domain-pause";
import { MetricsRepository } from "@/storage/metrics";
import { PlatformSettingsRepository } from "@/storage/platform-settings";
import { SettingsRepository } from "@/storage/settings";
import { ChromeStorageArea } from "@/storage/storage-area";

const storage = new ChromeStorageArea();
const settings = new SettingsRepository(storage);
const platformSettings = new PlatformSettingsRepository(storage);
const metrics = new MetricsRepository(storage);
const domainPause = new DomainPauseRepository(storage);
const offscreenClient = new RuntimeOffscreenClient();

/** The fail-closed rollout coordinates reported if the descriptor cannot be read. */
const FALLBACK_RELEASE_STATUS: DiagnosticReleaseStatus = {
  gateDecision: "pending",
  rolloutState: "bundle-verified",
};

/**
 * The immutable release descriptor's rollout coordinates, parsed once from the
 * closed compile-time bundle (the same sealed `release.json` the offscreen loads).
 * Only `gateDecision`/`rolloutState` are surfaced — the evidence stage — so the
 * popup/options diagnostics reflect a promoted release instead of the fail-closed
 * default. The ACTIVE runtime status travels separately, from the worker. A parse
 * failure degrades to the fail-closed default rather than rejecting popup polling.
 */
const releaseStatus: Promise<DiagnosticReleaseStatus> = loadRuntimeDescriptor()
  .then((descriptor) => ({
    gateDecision: descriptor.release.gateDecision,
    rolloutState: descriptor.release.rolloutState,
  }))
  .catch(() => FALLBACK_RELEASE_STATUS);

const router = new BackgroundMessageRouter({
  cache: new ClassificationCache(
    storage,
    { now: () => Date.now() },
    {
      maximumEntries: DEFAULT_SETTINGS.cacheMaximumEntries,
      ttlMs: DEFAULT_SETTINGS.cacheTtlMs,
    },
  ),
  metrics,
  offscreenClient,
  // Derived from the active fallback classifier's metadata: cache entries are
  // keyed by the model that produced them, so results from a previous
  // classifier (the hash mock) can never be served as stylometric results.
  modelKey: STYLOMETRIC_MODEL_KEY,
  settings,
  domainPause,
  modelStatus: () => offscreenClient.getModelStatus(),
  modelRelease: () => releaseStatus,
  settingsFingerprint: createSettingsFingerprintProvider(
    settings,
    platformSettings,
  ),
});

/**
 * Coordinates the on-demand manual analysis panel. Injection happens only under
 * the user's context-menu gesture (activeTab/scripting). The panel classifies
 * over the standard CLASSIFY_TEXT path, which already records the anonymous
 * inference metric in the router, so the MANUAL_ANALYSIS_RESULT echo is not
 * recorded again here (doing so would double-count every manual analysis).
 */
const manualAnalysis = new ManualAnalysisController({
  scripting: {
    executeScript: (injection) => chrome.scripting.executeScript(injection),
  },
  messenger: {
    sendMessage: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  },
  minimumWordCount: async () => (await settings.get()).minimumWordCount,
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // The router returns undefined for MANUAL_ANALYSIS_* panel messages; route
  // those to the controller instead while leaving all other routing intact.
  if (isManualPanelMessage(message)) {
    void manualAnalysis
      .handleMessage(message, sender)
      .catch(() => undefined)
      .finally(() => sendResponse(undefined));
    return true;
  }

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

const handleContextMenuClick = createContextMenuClickHandler({
  manual: manualAnalysis,
  analyzeCurrentPost: (tabId) =>
    sendCurrentPostCommand(tabId, "ANALYZE_CURRENT_POST"),
  reportWrongPost: (tabId) =>
    sendCurrentPostCommand(tabId, "REPORT_CURRENT_POST"),
  recordMissedReport: () => {
    // NOTE(integrator): a dedicated local "missed report" metric counter is not
    // yet defined in MetricsRepository (src/storage/metrics.ts). Wire this to
    // that counter once it exists; report-missed still opens manual analysis.
  },
  pauseDomain: (hostname) => domainPause.pause(hostname),
  openOptions: () => {
    void chrome.runtime.openOptionsPage();
  },
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  void handleContextMenuClick(info, tab);
});

chrome.runtime.onInstalled.addListener(() => {
  createContextMenus();
});

// Drop any pending manual selection once its tab closes or navigates away, so
// no per-tab state outlives the gesture that created it.
chrome.tabs.onRemoved.addListener((tabId) => {
  manualAnalysis.forget(tabId);
});
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    manualAnalysis.forget(tabId);
  }
});

function isClassifyTextMessage(
  message: ReturnType<typeof parseExtensionMessage>,
): message is Parameters<typeof classificationErrorMessage>[0] {
  return message.target === "background" && message.type === "CLASSIFY_TEXT";
}

/**
 * Sends a current-post command to the LinkedIn tab under the user's gesture.
 *
 * NOTE(integrator): the `ANALYZE_CURRENT_POST` / `REPORT_CURRENT_POST` envelopes
 * are not yet part of the validated runtime contract (src/shared/messages.ts +
 * src/shared/message-validation.ts) and the content script does not yet route
 * them. Add those `background -> content` routes and a content listener branch
 * calling `PostController.analyzeContextPost()` / `reportContextFeedback()` to
 * complete the flow; the content side already tracks the right-clicked post.
 */
async function sendCurrentPostCommand(
  tabId: number,
  type: string,
): Promise<void> {
  try {
    await chrome.tabs.sendMessage(tabId, {
      source: "background",
      target: "content",
      type,
      payload: undefined,
    });
  } catch {
    // The content script may be absent on this tab; ignore.
  }
}
