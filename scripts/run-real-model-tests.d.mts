export type RealModelTestMode = "candidate" | "release";

export interface RunNodeOptions {
  stdio?: string;
  env?: Record<string, string | undefined>;
}

export interface PlaywrightRunResult {
  exitCode: number;
}

export interface RealModelTestsDependencies {
  runNode?: (
    command: string,
    args: string[],
    options?: RunNodeOptions,
  ) => Promise<void>;
  runPlaywright?: (
    command: string,
    args: string[],
    options?: RunNodeOptions,
  ) => Promise<PlaywrightRunResult>;
  execPath?: string;
  npmExecPath?: string | undefined;
  onnxPresent?: () => boolean;
  readReleaseGateDecision?: () => Promise<string>;
  readPlaywrightReport?: () => Promise<unknown>;
  repoRoot?: string;
}

export interface RunRealModelTestsOptions {
  mode: RealModelTestMode;
  dependencies?: RealModelTestsDependencies;
}

export type RealModelTestsResult =
  | {
      ok: false;
      code:
        | "NPM_EXEC_PATH_MISSING"
        | "MODEL_ARTIFACT_MISSING"
        | "MODEL_SMOKE_SKIPPED"
        | "MODEL_SMOKE_FAILED"
        | "MODEL_RELEASE_NOT_PROMOTED"
        | "MODEL_RELEASE_DESCRIPTOR_INVALID";
      exitCode?: number;
    }
  | {
      ok: true;
      code: "MODEL_SMOKE_PASSED" | "RELEASE_TESTS_PASSED";
      mode: RealModelTestMode;
    };

export declare function runRealModelTests(
  options: RunRealModelTestsOptions,
): Promise<RealModelTestsResult>;
