import { CLEANFEED_ATTRIBUTES } from "@/shared/constants";

/**
 * The most candidates a single synchronous callback cycle may process. A
 * virtual-scroll insertion can add hundreds of nodes at once; capping the batch
 * and yielding between cycles keeps any one main-thread task well under budget.
 */
export const MAX_MUTATION_CANDIDATES_PER_CYCLE = 100;

export interface FeedMutationObserverOptions {
  debounceMs?: number;
}

export interface FeedMutationObserver {
  handle(records: readonly MutationRecord[]): void;
  disconnect(): void;
}

interface SchedulerLike {
  yield?: () => Promise<void>;
}

/**
 * Yields control back to the main thread between batches. Prefers the
 * Prioritized Task Scheduling API (`scheduler.yield`) when the browser exposes
 * it, and otherwise falls back to a macrotask (`setTimeout(0)`).
 */
function yieldToMainThread(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: SchedulerLike }).scheduler;
  if (scheduler !== undefined && typeof scheduler.yield === "function") {
    return scheduler.yield();
  }
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

export function createFeedMutationObserver(
  root: HTMLElement,
  callback: (candidates: HTMLElement[]) => void,
  { debounceMs = 100 }: FeedMutationObserverOptions = {},
): FeedMutationObserver {
  const candidates = new Set<HTMLElement>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disconnected = false;

  const flush = async (): Promise<void> => {
    timer = undefined;
    if (candidates.size === 0) return;
    const pending = [...candidates];
    candidates.clear();

    for (
      let start = 0;
      start < pending.length;
      start += MAX_MUTATION_CANDIDATES_PER_CYCLE
    ) {
      if (disconnected) return;
      callback(pending.slice(start, start + MAX_MUTATION_CANDIDATES_PER_CYCLE));
      if (start + MAX_MUTATION_CANDIDATES_PER_CYCLE < pending.length) {
        await yieldToMainThread();
      }
    }
  };

  const handle = (records: readonly MutationRecord[]) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (
          node instanceof HTMLElement &&
          !node.closest(`[${CLEANFEED_ATTRIBUTES.owned}]`)
        ) {
          candidates.add(node);
        }
      }
    }

    if (candidates.size > 0 && timer === undefined) {
      timer = setTimeout(() => void flush(), debounceMs);
    }
  };

  const observer = new MutationObserver(handle);
  observer.observe(root, { childList: true, subtree: true });

  return {
    handle,
    disconnect() {
      disconnected = true;
      observer.disconnect();
      if (timer !== undefined) clearTimeout(timer);
      timer = undefined;
      candidates.clear();
    },
  };
}
