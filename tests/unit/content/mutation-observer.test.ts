import { afterEach, describe, expect, it, vi } from "vitest";
import { CLEANFEED_ATTRIBUTES } from "@/shared/constants";
import { createFeedMutationObserver } from "@/content/observers/mutation-observer";

class MockMutationObserver {
  static lastInstance: MockMutationObserver | undefined;
  static lastOptions: MutationObserverInit | undefined;

  readonly observe = vi.fn();
  readonly disconnect = vi.fn();
  readonly takeRecords = vi.fn(() => [] as MutationRecord[]);

  constructor(readonly callback: MutationCallback) {
    MockMutationObserver.lastInstance = this;
  }
}

function mutationWith(...nodes: Node[]): MutationRecord {
  return { addedNodes: nodes } as unknown as MutationRecord;
}

describe("createFeedMutationObserver", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    MockMutationObserver.lastInstance = undefined;
    MockMutationObserver.lastOptions = undefined;
  });

  it("observes only feed child-list changes", () => {
    vi.stubGlobal("MutationObserver", MockMutationObserver);
    const root = document.createElement("main");

    createFeedMutationObserver(root, vi.fn());

    expect(MockMutationObserver.lastInstance!.observe).toHaveBeenCalledWith(
      root,
      {
        childList: true,
        subtree: true,
      },
    );
  });

  it("batches mutations and ignores CleanFeed-owned nodes", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MutationObserver", MockMutationObserver);
    const root = document.createElement("main");
    const post = document.createElement("article");
    const cleanFeedBadge = document.createElement("div");
    cleanFeedBadge.setAttribute(CLEANFEED_ATTRIBUTES.owned, "true");
    const onCandidates = vi.fn();
    const observer = createFeedMutationObserver(root, onCandidates, {
      debounceMs: 50,
    });

    observer.handle([
      mutationWith(post),
      mutationWith(post),
      mutationWith(cleanFeedBadge),
    ]);
    await vi.advanceTimersByTimeAsync(50);

    expect(onCandidates).toHaveBeenCalledWith([post]);
  });

  it("ignores nodes inserted inside CleanFeed-owned UI", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MutationObserver", MockMutationObserver);
    const root = document.createElement("main");
    const post = document.createElement("article");
    const cleanFeedPanel = document.createElement("aside");
    const panelChild = document.createElement("button");
    cleanFeedPanel.setAttribute(CLEANFEED_ATTRIBUTES.owned, "true");
    cleanFeedPanel.append(panelChild);
    const onCandidates = vi.fn();
    const observer = createFeedMutationObserver(root, onCandidates, {
      debounceMs: 50,
    });

    observer.handle([mutationWith(post), mutationWith(panelChild)]);
    await vi.advanceTimersByTimeAsync(50);

    expect(onCandidates).toHaveBeenCalledWith([post]);
  });

  it("clears pending callbacks when disconnected", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("MutationObserver", MockMutationObserver);
    const onCandidates = vi.fn();
    const observer = createFeedMutationObserver(
      document.createElement("main"),
      onCandidates,
    );

    observer.handle([mutationWith(document.createElement("article"))]);
    observer.disconnect();
    await vi.advanceTimersByTimeAsync(100);

    expect(onCandidates).not.toHaveBeenCalled();
    expect(
      MockMutationObserver.lastInstance!.disconnect,
    ).toHaveBeenCalledOnce();
  });
});
