import type { ArtifactRecord } from "./verify-model-bundle.mjs";

export interface VerifyPublishedEvidenceArgs {
  evidenceDirectory: string;
  modelDirectory: string;
}

export interface VerifyRuntimeParityArgs {
  distDir: string;
  evidenceDir: string;
}

export interface VerifyEvidenceChainArgs {
  evidenceDir: string;
  metadataDir: string;
  release: { evidenceDigest: string | null };
}

export interface AuditModelPackageDependencies {
  readFile?: (path: string, encoding: "utf8") => Promise<string>;
  lock?: { artifacts: ArtifactRecord[] };
  verifyRuntimeParity?: (args: VerifyRuntimeParityArgs) => Promise<void>;
  verifyEvidenceChain?: (args: VerifyEvidenceChainArgs) => Promise<void>;
  verifyPublishedEvidence?: (
    args: VerifyPublishedEvidenceArgs,
  ) => Promise<void>;
}

export interface AuditModelPackageOptions {
  distDir: string;
  metadataDir: string;
  evidenceDir: string;
  now?: number;
  dependencies?: AuditModelPackageDependencies;
}

export declare function auditModelPackage(
  options: AuditModelPackageOptions,
): Promise<void>;
