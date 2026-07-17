import { PostController } from "@/content/post-controller";
import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";
import { DomainPauseRepository } from "@/storage/domain-pause";
import { resolveEffectiveSettings } from "@/storage/effective-settings";
import { PlatformSettingsRepository } from "@/storage/platform-settings";
import { SettingsRepository } from "@/storage/settings";
import { ChromeStorageArea, type StorageArea } from "@/storage/storage-area";
import { parseExtensionMessage } from "@/shared/message-validation";
import type { PageStats, PlatformAdapter } from "@/shared/types";

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
  addListener(listener: () => void): void;
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
      chrome.storage.onChanged.addListener(() => {
        listener();
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
  const [settings, paused] = await Promise.all([
    resolveContentSettings(adapter.id, storage),
    resolveDomainPaused(
      new URL(contentDocument.location.href).hostname,
      storage,
    ),
  ]);
  activeController?.stop();
  activeController = new PostController({
    adapter,
    document: contentDocument,
    settings,
    domainEnabled: !paused,
  });
  activeController.start();
  (options.runtime ?? chrome.runtime).onMessage.addListener(
    createContentMessageListener(),
  );
  attachContextMenuTracking(contentDocument);

  // React to a pause toggled from the popup so it takes effect on this open tab
  // (not only on the next load). Re-reads the hostname-keyed pause store on any
  // storage change and flips the live domain gate.
  const hostname = new URL(contentDocument.location.href).hostname;
  const storageChanges = options.storageChanges ?? defaultStorageChanges();
  storageChanges?.addListener(() => {
    void resolveDomainPaused(hostname, storage).then((paused) => {
      activeController?.setDomainEnabled(!paused);
    });
  });

  return activeController;
}

if (typeof chrome !== "undefined") {
  void startContentScript();
}
