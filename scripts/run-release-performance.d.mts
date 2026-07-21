export interface RunReleasePerformanceOptions {
  releasePath: string;
  outputPath: string;
  browserLockPath?: string;
}

/**
 * Orchestrates the reference-performance lane for the canonical descriptor:
 * reject writes only the closed `not-applicable` receipt; indicator-only/pass
 * installs the pinned browser, rebuilds/audits the package, verifies the
 * environment, runs the Playwright spec against `dist`, and enforces the budget
 * gate (a regression BLOCKS the lane).
 */
export declare function runReleasePerformance(
  options: RunReleasePerformanceOptions,
): Promise<void>;
