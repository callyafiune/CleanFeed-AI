import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CONTEXT_MENU_IDS,
  createContextMenuClickHandler,
  createContextMenus,
} from "@/background/context-menu";

const PORTUGUESE_LONG_TEXT = Array.from({ length: 120 }, () => "conteúdo").join(
  " ",
);

interface StubbedMenus {
  create: ReturnType<typeof vi.fn>;
  removeAll: ReturnType<typeof vi.fn>;
}

function stubContextMenus(): StubbedMenus {
  const create = vi.fn();
  const removeAll = vi.fn();
  vi.stubGlobal("chrome", { contextMenus: { create, removeAll } });
  return { create, removeAll };
}

function createdItems(
  create: ReturnType<typeof vi.fn>,
): Record<string, unknown>[] {
  return create.mock.calls.map(([item]) => item as Record<string, unknown>);
}

describe("createContextMenus", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("creates author-free context menu entries on installation", () => {
    const { create, removeAll } = stubContextMenus();

    createContextMenus();

    expect(removeAll).toHaveBeenCalledOnce();
    expect(createdItems(create).map((item) => item.id)).toEqual([
      "analyze-selection",
      "analyze-current-post",
      "report-missed",
      "report-wrong",
      "pause-site",
      "open-options",
    ]);
    expect(JSON.stringify(create.mock.calls)).not.toMatch(/autor|perfil/u);
  });

  it("gives every entry a Portuguese title", () => {
    const { create } = stubContextMenus();

    createContextMenus();

    for (const item of createdItems(create)) {
      expect(typeof item.title).toBe("string");
      expect((item.title as string).length).toBeGreaterThan(0);
    }
  });

  it("exposes the selection entry through the selection context on any allowed site", () => {
    const { create } = stubContextMenus();

    createContextMenus();

    const selection = createdItems(create).find(
      (item) => item.id === "analyze-selection",
    );
    expect(selection?.contexts).toEqual(["selection"]);
    expect(selection?.documentUrlPatterns).toBeUndefined();
  });

  it("restricts post-scoped entries to LinkedIn documents only", () => {
    const { create } = stubContextMenus();

    createContextMenus();

    for (const id of [
      "analyze-current-post",
      "report-missed",
      "report-wrong",
      "pause-site",
    ]) {
      const item = createdItems(create).find((entry) => entry.id === id);
      expect(item?.documentUrlPatterns).toEqual(["https://www.linkedin.com/*"]);
    }
  });

  it("removes existing menus before recreating them so installs stay idempotent", () => {
    const { create, removeAll } = stubContextMenus();

    createContextMenus();
    createContextMenus();

    expect(removeAll).toHaveBeenCalledTimes(2);
    expect(create).toHaveBeenCalledTimes(CONTEXT_MENU_IDS.length * 2);
  });
});

describe("context menu click dispatch", () => {
  function createActions() {
    return {
      manual: { open: vi.fn().mockResolvedValue(undefined) },
      analyzeCurrentPost: vi.fn().mockResolvedValue(undefined),
      reportWrongPost: vi.fn().mockResolvedValue(undefined),
      recordMissedReport: vi.fn().mockResolvedValue(undefined),
      pauseDomain: vi.fn().mockResolvedValue(undefined),
      openOptions: vi.fn(),
    };
  }

  it("uses selectionText only after the user invokes analyze selection", async () => {
    const actions = createActions();
    const handleContextMenuClick = createContextMenuClickHandler(actions);
    const manual = actions.manual;

    await handleContextMenuClick(
      { menuItemId: "analyze-selection", selectionText: PORTUGUESE_LONG_TEXT },
      { id: 7, url: "https://example.com/article" },
    );

    expect(manual.open).toHaveBeenCalledWith(7, PORTUGUESE_LONG_TEXT);
  });

  it("does not open manual analysis for an empty selection", async () => {
    const actions = createActions();
    const handle = createContextMenuClickHandler(actions);

    await handle(
      { menuItemId: "analyze-selection", selectionText: "" },
      { id: 7, url: "https://example.com/article" },
    );

    expect(actions.manual.open).not.toHaveBeenCalled();
  });

  it("routes analyze-current-post and report-wrong to the current tab", async () => {
    const actions = createActions();
    const handle = createContextMenuClickHandler(actions);
    const tab = { id: 3, url: "https://www.linkedin.com/feed/" };

    await handle({ menuItemId: "analyze-current-post" }, tab);
    await handle({ menuItemId: "report-wrong" }, tab);

    expect(actions.analyzeCurrentPost).toHaveBeenCalledWith(3);
    expect(actions.reportWrongPost).toHaveBeenCalledWith(3);
  });

  it("records a missed report locally and then opens manual analysis", async () => {
    const actions = createActions();
    const handle = createContextMenuClickHandler(actions);

    await handle(
      { menuItemId: "report-missed", selectionText: PORTUGUESE_LONG_TEXT },
      { id: 5, url: "https://www.linkedin.com/feed/" },
    );

    expect(actions.recordMissedReport).toHaveBeenCalledOnce();
    expect(actions.manual.open).toHaveBeenCalledWith(5, PORTUGUESE_LONG_TEXT);
  });

  it("pauses only the hostname of the current tab, never a full path", async () => {
    const actions = createActions();
    const handle = createContextMenuClickHandler(actions);

    await handle(
      { menuItemId: "pause-site" },
      { id: 9, url: "https://www.linkedin.com/in/someone/details/" },
    );

    expect(actions.pauseDomain).toHaveBeenCalledWith("www.linkedin.com");
  });

  it("opens the options page even without a target tab", async () => {
    const actions = createActions();
    const handle = createContextMenuClickHandler(actions);

    await handle({ menuItemId: "open-options" }, undefined);

    expect(actions.openOptions).toHaveBeenCalledOnce();
  });
});
