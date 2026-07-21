import type { ReferenceEnvironmentFacts } from "./assert-reference-environment.mjs";

export { referenceBrowserLockDigest } from "./assert-reference-environment.mjs";

/** The sealed bundle identity a promoted measurement must carry. */
export interface BundleIdentity {
  kind: "bundle";
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  tokenizerDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  calibrationSetDigest: string;
}

/** The full, canonical performance report sealed as release evidence. */
export interface ReleasePerformanceReport {
  schemaVersion: 1;
  runtimeIdentity: BundleIdentity;
  backend: string;
  coldStartMs: number;
  warmInferenceCount: number;
  warmInferenceP95Ms: number;
  inferenceErrorRate: number;
  measuredAt: string;
  releaseDescriptorDigest: string;
  runtimeParityDigest: string;
  memoryMeasurement: "cdp-runtime-heap-v1";
  incrementalMemoryBytes: number;
  environment: ReferenceEnvironmentFacts;
  maximumMainThreadTaskMs: number;
  inferenceAttempts: number;
}

export interface PerformanceReportExpectations {
  releaseDescriptorDigest?: string;
  runtimeParityDigest?: string;
  runtimeIdentity?: BundleIdentity;
  browserExecutableSha256?: string;
}

export interface ReleasePerformanceEvidenceContext {
  descriptorDigest: string;
  gateDecision: "pending" | "reject" | "indicator-only" | "pass";
  rolloutState: "bundle-verified" | "shadow" | "indicator" | "actions";
  tmrDirectoryPresent: boolean;
}

export declare const PERFORMANCE_BUDGETS: {
  readonly coldStartMs: number;
  readonly warmInferenceP95Ms: number;
  readonly incrementalMemoryBytes: number;
  readonly inferenceErrorRate: number;
  readonly maximumMainThreadTaskMs: number;
  readonly minimumWarmInferences: number;
  readonly minimumInferenceAttempts: number;
};

export declare class PerformanceReportError extends Error {
  readonly code: string;
  constructor(code: string, message: string);
}

/** Validates a report's shape, EVERY budget, then optional cross-checks. */
export declare function assertPerformanceReport(
  value: unknown,
  expectations?: PerformanceReportExpectations,
): asserts value is ReleasePerformanceReport;

/** Validates the release-eligibility receipt against the canonical descriptor. */
export declare function assertReleasePerformanceEvidence(
  value: unknown,
  context: ReleasePerformanceEvidenceContext,
): void;
