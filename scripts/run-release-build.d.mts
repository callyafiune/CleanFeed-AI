import type {
  ReleasePackagingPolicy,
  ReleasePolicyDescriptor,
  ReleasePolicyProfilesFile,
} from "./release-policy.mjs";
import type { ArtifactRecord } from "./verify-model-bundle.mjs";

export interface LicenseReview {
  status: "pending" | "approved";
}

export interface SourceLockLike {
  artifacts: ArtifactRecord[];
}

export interface ReleaseMetadata {
  release: ReleasePolicyDescriptor;
  profilesFile: ReleasePolicyProfilesFile;
  licenseReview: LicenseReview;
  sourceLock: SourceLockLike;
  publicModelDirectory: string;
  modelsDirectory: string;
  evidenceDirectory: string;
  modelManifestPath: string;
  benchmarkReportPath: string;
}

export interface RuntimeParityManifestLike {
  runtimeParityDigest: string;
}

export interface RunNodeOptions {
  stdio?: string;
  env?: Record<string, string | undefined>;
}

export interface ReleaseRunnerDependencies {
  loadReleaseMetadata?: (repositoryRoot: string) => Promise<ReleaseMetadata>;
  resolveReleasePolicy?: (
    release: ReleasePolicyDescriptor,
    profilesFile: ReleasePolicyProfilesFile,
    now: number,
  ) => ReleasePackagingPolicy;
  assertDistributionLicense?: (
    licenseReview: LicenseReview,
    policy: ReleasePackagingPolicy,
  ) => void | Promise<void>;
  verifySanitizedEvidence?: (
    evidenceDirectory: string,
    modelDirectory: string,
    release: ReleasePolicyDescriptor,
  ) => Promise<void>;
  verifyBundle?: (
    publicModelDirectory: string,
    input: { lock: SourceLockLike },
  ) => Promise<void>;
  runSmoke?: () => Promise<void>;
  runViteBuild?: () => Promise<void>;
  buildParity?: (args: {
    repoRoot: string;
    modelManifestPath: string;
  }) => Promise<RuntimeParityManifestLike>;
  writeParity?: (
    manifest: RuntimeParityManifestLike,
    distDirectory: string,
  ) => Promise<void>;
  assertParity?: (
    manifest: RuntimeParityManifestLike,
    benchmarkReportPath: string,
  ) => Promise<void>;
  materializeMetadata?: (args: {
    sourceDirectory: string;
    targetDirectory: string;
  }) => Promise<void>;
  verifyReleaseDir?: (
    target: string,
    metadata: ReleaseMetadata,
  ) => Promise<void>;
  removePath?: (
    target: string,
    options?: { recursive?: boolean; force?: boolean },
  ) => Promise<void>;
  listPackagedFiles?: (target: string) => Promise<string[]>;
  runNode?: (
    command: string,
    args: string[],
    options?: RunNodeOptions,
  ) => Promise<void>;
  execPath?: string;
  npmExecPath?: string | undefined;
  variantMetadataDir?: string | undefined;
}

export interface RunReleaseBuildOptions {
  repositoryRoot: string;
  publicDirectory?: string;
  distDirectory: string;
  now?: number;
  dependencies?: ReleaseRunnerDependencies;
}

export type RunReleaseBuildResult = ReleasePackagingPolicy & {
  packagedFiles: string[];
};

export declare function runReleaseBuild(
  options: RunReleaseBuildOptions,
): Promise<RunReleaseBuildResult>;
