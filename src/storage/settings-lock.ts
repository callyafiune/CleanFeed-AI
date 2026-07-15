type LockManagerLike = {
  request<T>(
    name: string,
    options: { mode: "exclusive" },
    callback: () => Promise<T>,
  ): Promise<T>;
};

const SETTINGS_MUTATION_LOCK = "cleanfeed.settings.mutation.v1";
const fallbackQueues = new Map<string, Promise<void>>();

function getLockManager(): LockManagerLike | undefined {
  if (typeof navigator === "undefined") {
    return undefined;
  }

  return (navigator as Navigator & { locks?: LockManagerLike }).locks;
}

async function runWithFallbackLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous =
    fallbackQueues.get(SETTINGS_MUTATION_LOCK) ?? Promise.resolve();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const queued = previous.catch(() => undefined).then(() => gate);
  fallbackQueues.set(SETTINGS_MUTATION_LOCK, queued);

  await previous.catch(() => undefined);
  try {
    return await operation();
  } finally {
    release();
    if (fallbackQueues.get(SETTINGS_MUTATION_LOCK) === queued) {
      fallbackQueues.delete(SETTINGS_MUTATION_LOCK);
    }
  }
}

/**
 * Serializes settings mutations across extension documents with Web Locks and
 * falls back to a process-wide queue where that API is unavailable (such as
 * tests). All global and platform settings share one lock because a global
 * write must validate the current set of platform overrides atomically.
 */
export async function runWithSettingsMutationLock<T>(
  operation: () => Promise<T>,
): Promise<T> {
  const lockManager = getLockManager();
  if (lockManager) {
    return lockManager.request(
      SETTINGS_MUTATION_LOCK,
      { mode: "exclusive" },
      operation,
    );
  }

  return runWithFallbackLock(operation);
}
