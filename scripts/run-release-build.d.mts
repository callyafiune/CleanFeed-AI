import type { SourceLock } from "./model-lock.mjs";
import type {
  ModelManifestV2,
  ReleaseDescriptorV1,
} from "./verify-model-bundle.mjs";

export interface LicenseReview {
  status: "pending" | "approved";
}

export interface RunNodeOptions {
  stdio?: string;
  env?: Record<string, string | undefined>;
}

export interface ReleaseRunnerDependencies {
  runNode?: (
    command: string,
    args: string[],
    options?: RunNodeOptions,
  ) => Promise<void>;
  execPath?: string;
  npmExecPath?: string | undefined;
  verifyBundle?: (bundleDir: string) => Promise<void>;
}

export interface RunReleaseBuildOptions {
  release: ReleaseDescriptorV1;
  licenseReview: LicenseReview;
  manifest: ModelManifestV2;
  lock: Pick<SourceLock, "artifacts">;
  bundleDir: string;
  dependencies?: ReleaseRunnerDependencies;
}

export type ReleaseBuildResult =
  | {
      ok: false;
      code:
        | "MODEL_RELEASE_NOT_PROMOTED"
        | "MODEL_LICENSE_NOT_APPROVED"
        | "NPM_EXEC_PATH_MISSING"
        | "MODEL_RELEASE_DESCRIPTOR_INVALID";
    }
  | { ok: true; code: "RELEASE_COMPLETED"; mode: "reject" | "package" };

export declare function runReleaseBuild(
  options: RunReleaseBuildOptions,
): Promise<ReleaseBuildResult>;
