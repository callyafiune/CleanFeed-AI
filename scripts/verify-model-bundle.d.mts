export interface ArtifactRecord {
  path: string;
  bytes: number;
  sha256: string;
}

export interface WindowingConfig {
  modelMaxTokens: number;
  contentTokens: number;
  overlapTokens: number;
  maxWindows: number;
}

export interface ModelManifestV2 {
  schemaVersion: 2;
  modelId: string;
  modelVersion: string;
  task: string;
  backend: string;
  modelFile: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  windowing: WindowingConfig;
  artifacts: ArtifactRecord[];
  bundleDigest: string;
}

export interface CalibrationProfilesFileV1 {
  schemaVersion: 1;
  profiles: unknown[];
}

export type GateDecision = "pending" | "reject" | "indicator" | "actions";

export interface ReleaseDescriptorV1 {
  schemaVersion: 1;
  modelId: string;
  rolloutState: string;
  gateDecision: GateDecision;
  profileDigests: string[];
  calibrationSetDigest: string;
  evidenceDigest: string | null;
}

/** Any object exposing the pinned artifact records (a full lock, or a subset). */
export interface SourceLockLike {
  artifacts: ArtifactRecord[];
}

export interface VerifyMetadataInput {
  manifest: ModelManifestV2;
  lock: SourceLockLike;
  calibrationProfiles?: CalibrationProfilesFileV1;
  release?: ReleaseDescriptorV1;
}

export interface MetadataVerification {
  bundleDigest: string;
  tokenizerDigest: string;
}

export interface MaterializedVerification {
  fileCount: number;
  paths: string[];
}

export declare class ModelBundleError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

export declare const MATERIALIZED_INVENTORY: readonly string[];
export declare const MATERIALIZED_METADATA: readonly string[];

export declare function computeBundleDigest(
  artifacts: ReadonlyArray<ArtifactRecord>,
): string;

export declare function computeTokenizerDigest(
  artifacts: ReadonlyArray<ArtifactRecord>,
): string;

export declare function computeCalibrationSetDigest(
  profileDigests: ReadonlyArray<string>,
): string;

export declare function verifyModelMetadata(
  input: VerifyMetadataInput,
): MetadataVerification;

export declare function verifyMaterializedBundle(
  bundleDir: string,
  input: { lock: SourceLockLike },
): Promise<MaterializedVerification>;
