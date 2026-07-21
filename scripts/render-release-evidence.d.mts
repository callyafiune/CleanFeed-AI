/** The structural slice of the release descriptor the renderer reads. */
export interface ReleaseEvidenceDescriptor {
  gateDecision: "pending" | "reject" | "indicator-only" | "pass";
  rolloutState: string;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  tokenizerDigest: string;
  evidenceDigest: string | null;
}

/** The sanitized scientific report the renderer consumes (aggregate only). */
export interface ReleaseEvidenceReport {
  reportDigest: string;
  runtimeParityDigest: string;
  metrics?: {
    warning?: {
      falsePositiveRate?: { upper95?: number };
      recall?: { lower95?: number };
    };
    action?: {
      falsePositiveRate?: { upper95?: number };
      recall?: { lower95?: number };
    };
    coverage?: { value?: number };
  };
  gates?: {
    gates?: Array<{
      id: string;
      tier: string;
      scope?: string;
      slice?: { axis: string; key: string } | null;
      eligible: boolean;
      passed: boolean;
    }>;
  };
}

/** The evidence manifest binding the sanitized evidence set together. */
export interface ReleaseEvidenceManifest {
  scientificEvidenceDigest: string;
  publicationDigest: string;
}

/** The structural slice of a published calibration profile the renderer reads. */
export interface ReleaseEvidenceProfile {
  profileId: string;
  lengthBucket: string;
  actionCeiling: string;
  locale: string;
  platform: string;
  expiresAt: string;
  gateEvidence?: {
    overall?: {
      indicatorFpr?: { upperBound95?: number };
      indicatorRecall?: { lowerBound95?: number };
    };
  };
}

export interface ReleaseEvidenceProfilesFile {
  profiles: readonly ReleaseEvidenceProfile[];
}

/** The reference performance receipt, or the reject N/A marker. */
export type ReleasePerformanceEvidence =
  | { status: "not-applicable" }
  | {
      status: "measured";
      report: {
        coldStartMs: number;
        warmInferenceP95Ms: number;
        incrementalMemoryBytes: number;
        inferenceErrorRate: number;
        maximumMainThreadTaskMs: number;
      };
    };

export interface RenderReleaseEvidenceInput {
  release: ReleaseEvidenceDescriptor;
  report: ReleaseEvidenceReport;
  evidenceManifest: ReleaseEvidenceManifest;
  profilesFile: ReleaseEvidenceProfilesFile;
  performanceEvidence: ReleasePerformanceEvidence;
  probabilisticDisclosure: string;
}

export declare function renderReleaseEvidence(
  input: RenderReleaseEvidenceInput,
): string;
