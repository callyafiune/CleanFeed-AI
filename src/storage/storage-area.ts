import type { StorageArea as StorageAreaContract } from "@/shared/types";

export type StorageArea = StorageAreaContract;

export class ChromeStorageArea implements StorageArea {
  async get<T>(key: string): Promise<T | undefined> {
    const value = await chrome.storage.local.get(key);
    return value[key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async remove(keys: string | string[]): Promise<void> {
    await chrome.storage.local.remove(keys);
  }

  async getMany<T>(keys: string[]): Promise<Record<string, T>> {
    return (await chrome.storage.local.get(keys)) as Record<string, T>;
  }
}
