import { vi } from "vitest";

type StorageValues = Record<string, unknown>;

export function installChromeStorageMock(initial: StorageValues = {}): {
  seed(key: string, value: unknown): void;
  read(key: string): unknown;
} {
  const values: StorageValues = { ...initial };

  vi.stubGlobal("chrome", {
    storage: {
      local: {
        async get(keys?: string | string[]): Promise<StorageValues> {
          if (keys === undefined) {
            return { ...values };
          }

          const requestedKeys = typeof keys === "string" ? [keys] : keys;
          return Object.fromEntries(
            requestedKeys
              .filter((key) => key in values)
              .map((key) => [key, values[key]]),
          );
        },
        async set(entries: StorageValues): Promise<void> {
          Object.assign(values, entries);
        },
        async remove(keys: string | string[]): Promise<void> {
          for (const key of typeof keys === "string" ? [keys] : keys) {
            delete values[key];
          }
        },
      },
    },
  });

  return {
    seed(key, value) {
      values[key] = value;
    },
    read(key) {
      return values[key];
    },
  };
}
