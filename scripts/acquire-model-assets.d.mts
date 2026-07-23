import type { AtomicDirectoryFs, SourceLock } from "./model-lock.mjs";

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

export declare function assertFetchableLock(
  lock: Pick<SourceLock, "modelId" | "baseUrl">,
): void;

export declare function acquireModelSourceAssets(
  options: AcquireModelSourceAssetsOptions,
): Promise<{ fileCount: 6; stagingDirectory: string }>;

export interface MaterializeDependencies {
  randomUUID(): string;
  fs: AtomicDirectoryFs;
  cp(
    source: string,
    destination: string,
    options?: { recursive?: boolean },
  ): Promise<void>;
}

export interface MaterializeModelBundleOptions {
  sourceStaging: string;
  versionedDir: string;
  target: string;
  lock: Pick<SourceLock, "artifacts">;
  dependencies?: Partial<MaterializeDependencies>;
}

export declare function materializeModelBundle(
  options: MaterializeModelBundleOptions,
): Promise<{ fileCount: 9; target: string }>;
