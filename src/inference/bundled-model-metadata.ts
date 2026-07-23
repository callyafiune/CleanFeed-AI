// Compile-time access to the three versioned, closed model descriptors.
//
// These JSON files are the single source of truth for the sealed bundle's
// identity (`cleanfeed-model.json`), its calibration profiles
// (`calibration-profiles.json`) and its release/promotion state
// (`release.json`). They live under `models/cleanfeed-ptbr-v1/` — tracked,
// small and auditable — and are imported here via `resolveJsonModule` so Vite
// inlines them into the extension. The runtime therefore never reads them from
// disk or the network; the closed bundle identity travels inside the code.

import calibrationProfilesJson from "../../models/cleanfeed-ptbr-v1/calibration-profiles.json";
import cleanfeedModelJson from "../../models/cleanfeed-ptbr-v1/cleanfeed-model.json";
import releaseDescriptorJson from "../../models/cleanfeed-ptbr-v1/release.json";
import sourceLockJson from "../../models/cleanfeed-ptbr-v1/source-lock.json";

/** A single pinned upstream artifact: its bundle-relative path, byte length and SHA-256. */
export interface BundledArtifactRecord {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** Windowing parameters the runtime feeds the tokenizer/model. */
export interface BundledWindowingConfig {
  readonly modelMaxTokens: number;
  readonly contentTokens: number;
  readonly overlapTokens: number;
  readonly maxWindows: number;
}

/** The closed CleanFeed manifest (schemaVersion 2) for the sealed bundle. */
export interface BundledModelManifest {
  readonly schemaVersion: 2;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly task: string;
  readonly backend: string;
  readonly modelFile: string;
  readonly aggregationVersion: string;
  readonly contentCompositionVersion: string;
  readonly tokenizerDigest: string;
  readonly windowing: BundledWindowingConfig;
  readonly artifacts: readonly BundledArtifactRecord[];
  readonly bundleDigest: string;
}

/** The versioned calibration-profiles descriptor (schemaVersion 1). */
export interface BundledCalibrationProfilesFile {
  readonly schemaVersion: 1;
  readonly profiles: readonly unknown[];
}

/** The pinned upstream source lock: the authoritative artifact inventory. */
export interface BundledSourceLock {
  readonly schemaVersion: 1;
  readonly modelId: string;
  readonly revision: string;
  readonly baseUrl: string;
  readonly artifacts: readonly BundledArtifactRecord[];
}

/**
 * The versioned release/promotion descriptor (schemaVersion 1). It re-declares
 * the sealed bundle identity so {@link crossValidateRuntimeDescriptor} can prove
 * the manifest, the release and every calibration profile agree BEFORE any
 * WorkerHost or ONNX session is built. This mirrors the closed
 * `ModelReleaseDescriptorV1` contract exactly.
 */
export interface BundledReleaseDescriptor {
  readonly schemaVersion: 1;
  readonly modelId: string;
  readonly modelVersion: string;
  readonly bundleDigest: string;
  readonly tokenizerDigest: string;
  readonly aggregationVersion: string;
  readonly contentCompositionVersion: string;
  readonly calibrationSetDigest: string;
  readonly profileDigests: readonly string[];
  readonly rolloutState: string;
  readonly gateDecision: string;
  readonly issuedAt: string | null;
  readonly evidenceDigest: string | null;
}

/** The sealed bundle manifest, inlined at build time. */
export const bundledModelManifest: BundledModelManifest =
  cleanfeedModelJson as BundledModelManifest;

/** The versioned calibration profiles, inlined at build time. */
export const bundledCalibrationProfiles: BundledCalibrationProfilesFile =
  calibrationProfilesJson as BundledCalibrationProfilesFile;

/** The versioned release descriptor, inlined at build time. */
export const bundledReleaseDescriptor: BundledReleaseDescriptor =
  releaseDescriptorJson as BundledReleaseDescriptor;

/** The pinned upstream source lock, inlined at build time. */
export const bundledSourceLock: BundledSourceLock =
  sourceLockJson as BundledSourceLock;
