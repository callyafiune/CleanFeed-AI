import { PostController } from "@/content/post-controller";
import { LinkedInAdapter } from "@/platforms/linkedin/linkedin-adapter";
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

export type ContentMessageListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response: unknown) => void,
) => boolean | void;

export interface ContentRuntime {
  onMessage: { addListener(listener: ContentMessageListener): void };
}

export interface ContentScriptOptions {
  adapter?: PlatformAdapter;
  document?: Document;
  runtime?: ContentRuntime;
  storage?: StorageArea;
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

export async function startContentScript(
  options: ContentScriptOptions = {},
): Promise<PostController | undefined> {
  const adapter = options.adapter ?? new LinkedInAdapter();
  const contentDocument = options.document ?? document;
  if (!adapter.matches(new URL(contentDocument.location.href)))
    return undefined;

  const storage = options.storage ?? new ChromeStorageArea();
  const settings = await resolveContentSettings(adapter.id, storage);
  activeController?.stop();
  activeController = new PostController({
    adapter,
    document: contentDocument,
    settings,
  });
  activeController.start();
  (options.runtime ?? chrome.runtime).onMessage.addListener(
    createContentMessageListener(),
  );
  return activeController;
}

if (typeof chrome !== "undefined") {
  void startContentScript();
}
