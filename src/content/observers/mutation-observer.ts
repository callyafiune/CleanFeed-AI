import { CLEANFEED_ATTRIBUTES } from "@/shared/constants";

export interface FeedMutationObserverOptions {
  debounceMs?: number;
}

export interface FeedMutationObserver {
  handle(records: readonly MutationRecord[]): void;
  disconnect(): void;
}

export function createFeedMutationObserver(
  root: HTMLElement,
  callback: (candidates: HTMLElement[]) => void,
  { debounceMs = 100 }: FeedMutationObserverOptions = {},
): FeedMutationObserver {
  const candidates = new Set<HTMLElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  const flush = () => {
    timer = undefined;
    if (candidates.size === 0) return;
    const batch = [...candidates];
    candidates.clear();
    callback(batch);
  };

  const handle = (records: readonly MutationRecord[]) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (
          node instanceof HTMLElement &&
          !node.hasAttribute(CLEANFEED_ATTRIBUTES.owned)
        ) {
          candidates.add(node);
        }
      }
    }

    if (candidates.size > 0 && timer === undefined) {
      timer = setTimeout(flush, debounceMs);
    }
  };

  const observer = new MutationObserver(handle);
  observer.observe(root, { childList: true, subtree: true });

  return {
    handle,
    disconnect() {
      observer.disconnect();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      candidates.clear();
    },
  };
}
