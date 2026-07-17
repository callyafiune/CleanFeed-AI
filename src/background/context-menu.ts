import type { ManualAnalysisController } from "@/background/manual-analysis-controller";

/**
 * Stable, author-free identifiers for every CleanFeed context menu entry. The
 * order is meaningful: `createContextMenus` creates them in exactly this order.
 */
export const CONTEXT_MENU_IDS = [
  "analyze-selection",
  "analyze-current-post",
  "report-missed",
  "report-wrong",
  "pause-site",
  "open-options",
] as const;

export type ContextMenuId = (typeof CONTEXT_MENU_IDS)[number];

const LINKEDIN_DOCUMENT_PATTERNS = ["https://www.linkedin.com/*"] as const;

interface MenuDefinition {
  id: ContextMenuId;
  title: string;
  contexts: NonNullable<chrome.contextMenus.CreateProperties["contexts"]>;
  documentUrlPatterns?: string[];
}

/**
 * Menu definitions. The selection entry uses the `selection` context on any
 * activeTab-granted site; every post-scoped entry is limited to LinkedIn
 * documents so it never appears where the extension cannot act. No title or
 * pattern references an author or profile.
 */
const MENU_DEFINITIONS: readonly MenuDefinition[] = [
  {
    id: "analyze-selection",
    title: "Analisar seleção com o CleanFeed AI",
    contexts: ["selection"],
  },
  {
    id: "analyze-current-post",
    title: "Analisar esta publicação",
    contexts: ["page"],
    documentUrlPatterns: [...LINKEDIN_DOCUMENT_PATTERNS],
  },
  {
    id: "report-missed",
    title: "Reportar conteúdo não detectado",
    contexts: ["page", "selection"],
    documentUrlPatterns: [...LINKEDIN_DOCUMENT_PATTERNS],
  },
  {
    id: "report-wrong",
    title: "Classificação incorreta",
    contexts: ["page"],
    documentUrlPatterns: [...LINKEDIN_DOCUMENT_PATTERNS],
  },
  {
    id: "pause-site",
    title: "Pausar neste site",
    contexts: ["page"],
    documentUrlPatterns: [...LINKEDIN_DOCUMENT_PATTERNS],
  },
  {
    id: "open-options",
    title: "Abrir configurações",
    contexts: ["action"],
  },
];

/** The subset of `chrome.contextMenus` the creation routine relies on. */
export interface ContextMenusApi {
  removeAll(callback?: () => void): void;
  create(createProperties: chrome.contextMenus.CreateProperties): void;
}

/**
 * Removes any existing entries and recreates the full menu, so re-running it on
 * every `onInstalled` stays idempotent. It only ever touches CleanFeed's own
 * entries and never widens host permissions.
 */
export function createContextMenus(
  menus: ContextMenusApi = chrome.contextMenus,
): void {
  menus.removeAll();
  for (const definition of MENU_DEFINITIONS) {
    menus.create({
      id: definition.id,
      title: definition.title,
      contexts: definition.contexts,
      ...(definition.documentUrlPatterns === undefined
        ? {}
        : { documentUrlPatterns: definition.documentUrlPatterns }),
    });
  }
}

/** The click payload we read; a subset of `chrome.contextMenus.OnClickData`. */
export interface ContextMenuClickInfo {
  menuItemId: string | number;
  selectionText?: string;
}

/** The clicked tab; a subset of `chrome.tabs.Tab`. */
export interface ContextMenuTab {
  id?: number;
  url?: string;
}

/**
 * The side effects each menu entry drives. They are injected so the service
 * worker owns the concrete implementations (manual injection, tab commands,
 * local metrics, domain pause, options page) and this module stays testable.
 */
export interface ContextMenuActions {
  manual: Pick<ManualAnalysisController, "open">;
  analyzeCurrentPost: (tabId: number) => void | Promise<void>;
  reportWrongPost: (tabId: number) => void | Promise<void>;
  recordMissedReport: () => void | Promise<void>;
  pauseDomain: (hostname: string) => void | Promise<void>;
  openOptions: () => void;
}

export type ContextMenuClickHandler = (
  info: ContextMenuClickInfo,
  tab?: ContextMenuTab,
) => Promise<void>;

/**
 * Builds the `chrome.contextMenus.onClicked` handler. Every branch runs under
 * the user's gesture and reads only extension-owned inputs: `selectionText`
 * (already user-provided), the tab id, and the tab's hostname (never a path).
 */
export function createContextMenuClickHandler(
  actions: ContextMenuActions,
): ContextMenuClickHandler {
  return async (info, tab) => {
    const tabId = tab?.id;
    switch (info.menuItemId) {
      case "analyze-selection": {
        const selection = info.selectionText ?? "";
        if (tabId !== undefined && selection.length > 0) {
          await actions.manual.open(tabId, selection);
        }
        return;
      }
      case "analyze-current-post":
        if (tabId !== undefined) await actions.analyzeCurrentPost(tabId);
        return;
      case "report-missed":
        await actions.recordMissedReport();
        if (tabId !== undefined) {
          await actions.manual.open(tabId, info.selectionText ?? "");
        }
        return;
      case "report-wrong":
        if (tabId !== undefined) await actions.reportWrongPost(tabId);
        return;
      case "pause-site": {
        const hostname = hostnameOf(tab?.url);
        if (hostname !== undefined) await actions.pauseDomain(hostname);
        return;
      }
      case "open-options":
        actions.openOptions();
        return;
      default:
        return;
    }
  };
}

function hostnameOf(url: string | undefined): string | undefined {
  if (url === undefined) return undefined;
  try {
    return new URL(url).hostname;
  } catch {
    return undefined;
  }
}
