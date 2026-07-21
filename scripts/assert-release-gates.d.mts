import type { AuditModelPackageOptions } from "./audit-model-package.mjs";
import type { SourceLock } from "./model-lock.mjs";
import type {
  ReleasePackagingPolicy,
  ReleasePolicyDescriptor,
  ReleasePolicyProfilesFile,
} from "./release-policy.mjs";

export interface ReleaseMetadata {
  release: ReleasePolicyDescriptor;
  profilesFile: ReleasePolicyProfilesFile;
}

export interface AssertReleaseMetadataDependencies {
  readFile?: (path: string, encoding: "utf8") => Promise<string>;
}

export declare function assertReleaseMetadata(
  metadataDirectory: string,
  dependencies?: AssertReleaseMetadataDependencies,
): Promise<ReleaseMetadata>;

export interface StatLike {
  isDirectory(): boolean;
  isFile(): boolean;
  size: number;
}

export interface AssertRealModelFilesDependencies {
  stat?: (path: string) => Promise<StatLike>;
}

export declare function assertRealModelFiles(
  modelDirectory: string,
  dependencies?: AssertRealModelFilesDependencies,
): Promise<void>;

export interface VerifyModelBundleDependencies {
  readSourceLock?: (path: string) => Promise<SourceLock>;
  verifyMaterializedBundle?: (
    bundleDir: string,
    input: { lock: SourceLock },
  ) => Promise<unknown>;
}

export interface VerifyModelBundleOptions {
  metadataDirectory: string;
  dependencies?: VerifyModelBundleDependencies;
}

export declare function verifyModelBundle(
  modelDirectory: string,
  options?: VerifyModelBundleOptions,
): Promise<void>;

export interface PackageScriptsShape {
  scripts?: Record<string, unknown>;
}

export declare function assertReleaseScriptOwners(
  packageJson: PackageScriptsShape | unknown,
): void;

export interface AssertReleaseInputsDependencies {
  loadReleaseMetadata?: (metadataDirectory: string) => Promise<ReleaseMetadata>;
  resolveReleasePolicy?: (
    release: ReleasePolicyDescriptor,
    profilesFile: ReleasePolicyProfilesFile,
    now: number,
  ) => ReleasePackagingPolicy;
  assertRealModelFiles?: (modelDirectory: string) => Promise<void>;
  verifyModelBundle?: (
    modelDirectory: string,
    options: { metadataDirectory: string },
  ) => Promise<void>;
  auditModelPackage?: (options: AuditModelPackageOptions) => Promise<void>;
}

export interface AssertReleaseInputsOptions {
  modelDirectory: string;
  metadataDirectory: string;
  distDirectory: string;
  evidenceDirectory?: string;
  now?: number;
  dependencies?: AssertReleaseInputsDependencies;
}

export declare function assertReleaseInputs(
  options: AssertReleaseInputsOptions,
): Promise<ReleasePackagingPolicy>;
