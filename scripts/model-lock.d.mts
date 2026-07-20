export const PINNED_REVISION: string;
export const PINNED_BASE_URL: string;
export const PINNED_MODEL_ID: string;

export interface SourceArtifact {
  path: string;
  bytes: number;
  sha256: string;
}

export interface SourceLock {
  schemaVersion: 1;
  modelId: string;
  revision: string;
  baseUrl: string;
  artifacts: SourceArtifact[];
}

export interface VerifyResult {
  fileCount: number;
}

/**
 * Minimal, injectable filesystem surface used by the atomic directory replace
 * (and shared by the acquisition module). All operations are async.
 */
export interface AtomicDirectoryFs {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

export declare class ModelLockError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export declare const SOURCE_ARTIFACTS: ReadonlyArray<Readonly<SourceArtifact>>;

export declare function readSourceLock(lockPath: string): Promise<SourceLock>;

export declare function verifyStagedAssets(
  directory: string,
  lock: Pick<SourceLock, "artifacts">,
): Promise<VerifyResult>;

export declare function verifyRequiredAssets(
  directory: string,
  lock: Pick<SourceLock, "artifacts">,
): Promise<VerifyResult>;

export declare function replaceDirectoryAtomically(
  staging: string,
  target: string,
  fsAdapter: AtomicDirectoryFs,
): Promise<void>;
