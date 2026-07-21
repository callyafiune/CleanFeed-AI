export interface VerifyPublishedEvidenceArgs {
  evidenceDirectory: string;
  modelDirectory: string;
}

export interface ActivationDependencies {
  readFile?: (path: string, encoding: "utf8") => Promise<string>;
  writeFile?: (path: string, data: string) => Promise<void>;
  rename?: (from: string, to: string) => Promise<void>;
  rm?: (path: string, options?: { force?: boolean }) => Promise<void>;
  verifyPublishedEvidence?: (
    args: VerifyPublishedEvidenceArgs,
  ) => Promise<void>;
}

export interface ActivateModelReleaseOptions {
  releasePath: string;
  profilesPath: string;
  evidenceDir: string;
  expectedEvidenceDigest?: string;
  now?: number;
  dependencies?: ActivationDependencies;
}

export interface ActivationResult {
  activated: boolean;
  rolloutState: string;
  code: "ACTIVATED" | "ALREADY_ACTIVE" | "NO_ACTIVATION";
}

export declare function activateModelRelease(
  options: ActivateModelReleaseOptions,
): Promise<ActivationResult>;
