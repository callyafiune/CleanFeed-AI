import type { AtomicDirectoryFs } from "./model-lock.mjs";

export interface AcquireDependencies {
  fetch: typeof globalThis.fetch;
  randomUUID(): string;
  fs: AtomicDirectoryFs;
}

export interface AcquireModelSourceAssetsOptions {
  lockPath: string;
  stagingParent: string;
  dependencies?: Partial<AcquireDependencies>;
}

export declare function acquireModelSourceAssets(
  options: AcquireModelSourceAssetsOptions,
): Promise<{ fileCount: 7; stagingDirectory: string }>;
