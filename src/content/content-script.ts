import { PostController } from "@/content/post-controller";
import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";
import { DEFAULT_SETTINGS, SETTINGS_STORAGE_KEYS } from "@/shared/constants";
import {
  DOMAIN_PAUSE_KEY,
  DomainPauseRepository,
} from "@/storage/domain-pause";
import { resolveEffectiveSettings } from "@/storage/effective-settings";
import { PlatformSettingsRepository } from "@/storage/platform-settings";
import { SettingsRepository } from "@/storage/settings";
import { ChromeStorageArea, type StorageArea } from "@/storage/storage-area";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { EffectiveSettings, UserSettings } from "@/shared/settings-types";
import type { PageStats, PlatformAdapter } from "@/shared/types";

/** Whether two resolved settings agree on every user-facing field (ignores sourceMap). */
export function effectiveSettingsEqual(
  a: EffectiveSettings,
  b: EffectiveSettings,
): boolean {
  return (Object.keys(DEFAULT_SETTINGS) as Array<keyof UserSettings>).every(
    (key) => a[key] === b[key],
  );
}

interface ContentController {
  readonly stats: { snapshot(): PageStats };
  clearPresentation(): void;
}

/** The slice of the controller the right-click tracker needs. */
export interface ContextTrackingController {
  noteContextTarget(node: EventTarget | null): void;
}

export type ContentMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | void;

export interface ContentRuntime {
  onMessage: { addListener(listener: ContentMessageListener): void };
}

/** Minimal subscription to storage mutations, so the tab can react live. */
export interface StorageChangeSubscription {
  /**
   * Registers a listener. It receives the changed storage keys when the source
   * can supply them, so the content tab can ignore unrelated writes
   * (metrics/history/cache). An undefined list means "unknown — react anyway".
   */
  addListener(listener: (changedKeys?: readonly string[]) => void): void;
}

/** The storage keys whose change must re-resolve the content controller. */
const CONTENT_RELEVANT_KEYS: ReadonlySet<string> = new Set([
  SETTINGS_STORAGE_KEYS.global,
  SETTINGS_STORAGE_KEYS.platform,
  DOMAIN_PAUSE_KEY,
]);

export function touchesContentSettings(
  changedKeys?: readonly string[],
): boolean {
  // Unknown keys (e.g. a test-injected subscription) conservatively react.
  return (
    changedKeys === undefined ||
    changedKeys.some((key) => CONTENT_RELEVANT_KEYS.has(key))
  );
}

export interface ContentScriptOptions {
  adapter?: PlatformAdapter;
  document?: Document;
  runtime?: ContentRuntime;
  storage?: StorageArea;
  storageChanges?: StorageChangeSubscription;
}

function defaultStorageChanges(): StorageChangeSubscription | undefined {
  if (
    typeof chrome === "undefined" ||
    chrome.storage?.onChanged === undefined
  ) {
    return undefined;
  }
  return {
    addListener: (listener) =>
      chrome.storage.onChanged.addListener((changes, areaName) => {
        // Settings, platform overrides and domain pause all live in local.
        if (areaName !== "local") return;
        listener(Object.keys(changes));
      }),
  };
}

let activeController: PostController | undefined;

export async function resolveContentSettings(
  platformId: string,
  storage: StorageArea,
) {
  const [global, platform] = await Promise.all([
    new SettingsRepository(storage).get(),
    new PlatformSettingsRepository(storage).get(platformId),
  ]);

  return resolveEffectiveSettings({ global, platform });
}

/**
 * Reads whether the user has paused CleanFeed on this hostname. Reads only the
 * hostname-keyed pause store; it never inspects the path, query or page text.
 */
export async function resolveDomainPaused(
  hostname: string,
  storage: StorageArea,
): Promise<boolean> {
  return new DomainPauseRepository(storage).isPaused(hostname);
}

export function createContentMessageListener(
  getController: () => ContentController | undefined = () => activeController,
): ContentMessageListener {
  return (rawMessage, _sender, sendResponse) => {
    try {
      const message = parseExtensionMessage(rawMessage);
      const controller = getController();
      if (controller === undefined || message.target !== "content")
        return false;

      if (message.type === "GET_PAGE_STATS") {
        sendResponse({
          source: "content",
          target: "popup",
          type: "PAGE_STATS_RESULT",
          payload: controller.stats.snapshot(),
        });
        return false;
      }

      if (message.type === "CLEAR_PAGE_PRESENTATION") {
        controller.clearPresentation();
        sendResponse(undefined);
      }
    } catch {
      // Ignore malformed messages received from outside the extension contract.
    }

    return false;
  };
}

/**
 * Records the post under a right-click so the background's current-post menu
 * actions can target it. It captures only the event target (the controller
 * resolves it to an owned post element and keeps a WeakRef); no author or URL
 * is read or stored. Returns a detach function.
 */
export function attachContextMenuTracking(
  target: Document = document,
  getController: () => ContextTrackingController | undefined = () =>
    activeController,
): () => void {
  const listener = (event: Event): void => {
    getController()?.noteContextTarget(event.target);
  };
  target.addEventListener("contextmenu", listener, true);
  return () => target.removeEventListener("contextmenu", listener, true);
}

export async function startContentScript(
  options: ContentScriptOptions = {},
): Promise<PostController | undefined> {
  const adapter = options.adapter ?? new LinkedInAdapter();
  const contentDocument = options.document ?? document;
  if (!adapter.matches(new URL(contentDocument.location.href)))
    return undefined;

  const storage = options.storage ?? new ChromeStorageArea();
  const hostname = new URL(contentDocument.location.href).hostname;
  let currentSettings = await resolveContentSettings(adapter.id, storage);
  let paused = await resolveDomainPaused(hostname, storage);

  // (Re)builds the controller for the given settings, REUSING the shared adapter
  // (and thus its PresentationController) so presentation state stays coherent
  // across a live rebuild — apply/restore remain idempotent per element.
  const buildController = (
    settings: EffectiveSettings,
    domainEnabled: boolean,
  ): PostController => {
    activeController?.clearPresentation();
    activeController?.stop();
    activeController = new PostController({
      adapter,
      document: contentDocument,
      settings,
      domainEnabled,
    });
    activeController.start();
    return activeController;
  };

  buildController(currentSettings, !paused);
  (options.runtime ?? chrome.runtime).onMessage.addListener(
    createContentMessageListener(),
  );
  attachContextMenuTracking(contentDocument);

  // React to a live edit on the ALREADY-open tab (not only on the next load).
  // A pause toggle flips the domain gate; a settings edit (presentation mode,
  // experimental preview, marking threshold, …) rebuilds the controller so the
  // visible posts are re-presented and re-classified under the new config. The
  // fresh decision comes from the background's fresh settings and a
  // fingerprint-invalidated cache; the offscreen reloads/unloads the TMR on its
  // own storage listener. Storage writes that leave the effective settings
  // unchanged (metrics/history/cache) never rebuild.
  const storageChanges = options.storageChanges ?? defaultStorageChanges();
  storageChanges?.addListener((changedKeys) => {
    if (!touchesContentSettings(changedKeys)) return;
    void (async () => {
      const [nextSettings, nextPaused] = await Promise.all([
        resolveContentSettings(adapter.id, storage),
        resolveDomainPaused(hostname, storage),
      ]);
      if (!effectiveSettingsEqual(currentSettings, nextSettings)) {
        currentSettings = nextSettings;
        paused = nextPaused;
        buildController(nextSettings, !nextPaused);
        return;
      }
      if (nextPaused !== paused) {
        paused = nextPaused;
        activeController?.setDomainEnabled(!nextPaused);
      }
    })();
  });

  return activeController;
}

if (typeof chrome !== "undefined") {
  void startContentScript();
}
