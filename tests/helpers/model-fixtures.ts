// Concrete factories for the three versioned model descriptors, used by the
// bundle-verifier and release-gate tests. Every factory returns a fully-typed,
// internally-consistent object: after applying overrides it RE-COMPUTES the
// dependent digests (bundle, tokenizer, calibration-set) from the final field
// values, so a fixture is valid by construction unless a test deliberately
// overrides a digest to prove a mismatch is rejected. No factory uses a cast
// that omits a required field.

import {
  PINNED_MODEL_ID,
  PINNED_REVISION,
  SOURCE_ARTIFACTS,
} from "../../scripts/model-lock.mjs";
import {
  computeBundleDigest,
  computeCalibrationSetDigest,
  computeTokenizerDigest,
} from "../../scripts/verify-model-bundle.mjs";
import type {
  ArtifactRecord,
  CalibrationProfilesFileV1,
  ModelManifestV2,
  ReleaseDescriptorV1,
} from "../../scripts/verify-model-bundle.mjs";
import type {
  ClassificationResult,
  DecisionOutcome,
  EvidenceAssessment,
  ModelStatus,
  RuntimeModelIdentity,
} from "@/shared/types";

/** SHA-256 of the canonical empty calibration set ("[]"). */
const EMPTY_SET_DIGEST =
  "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945";

type BuiltinIdentity = Extract<RuntimeModelIdentity, { kind: "builtin" }>;
type BundleIdentity = Extract<RuntimeModelIdentity, { kind: "bundle" }>;

/** A builtin runtime identity (defaults to the stylometric fallback). */
export function createBuiltinRuntimeIdentity(
  overrides: Partial<BuiltinIdentity> = {},
): RuntimeModelIdentity {
  return {
    kind: "builtin",
    modelId: "stylometric",
    modelVersion: "1.0.0",
    implementationVersion: "stylometric-v1",
    ...overrides,
  };
}

/** A bundle runtime identity for the pinned sealed detector. */
export function createBundleRuntimeIdentity(
  overrides: Partial<BundleIdentity> = {},
): RuntimeModelIdentity {
  return {
    kind: "bundle",
    modelId: PINNED_MODEL_ID,
    modelVersion: PINNED_REVISION,
    bundleDigest: "a".repeat(64),
    tokenizerDigest: "b".repeat(64),
    aggregationVersion: "tmr-aggregation-v2",
    contentCompositionVersion: "lexical-content-v1",
    calibrationSetDigest: EMPTY_SET_DIGEST,
    ...overrides,
  };
}

/** A conservative `limited` evidence assessment. */
export function createEvidenceAssessment(
  overrides: Partial<EvidenceAssessment> = {},
): EvidenceAssessment {
  return {
    quality: "limited",
    coverage: 1,
    lexicalRatio: 1,
    truncated: false,
    exactTokenizer: false,
    reasonCodes: [],
    ...overrides,
  };
}

/** A conservative, presentable, indicator-ceiling decision. */
export function createDecisionOutcome(
  overrides: Partial<DecisionOutcome> = {},
): DecisionOutcome {
  return {
    status: "possibly_ai",
    calibratedScore: 0.5,
    actionCeiling: "indicator",
    abstained: false,
    presentationAllowed: true,
    triggers: [],
    reasonCodes: [],
    ...overrides,
  };
}

/**
 * A complete builtin `ClassificationResult`. Deep overrides win, and the
 * nested identity/evidence/decision default to the conservative builtin shape.
 */
export function createClassificationResult(
  overrides: Partial<ClassificationResult> = {},
): ClassificationResult {
  return {
    aiScore: 0.5,
    humanScore: 0.5,
    confidence: "low",
    status: "possibly_ai",
    wordCount: 120,
    tokenCount: 120,
    runtimeIdentity: createBuiltinRuntimeIdentity(),
    evidence: createEvidenceAssessment(),
    decision: createDecisionOutcome(),
    modelVersion: "1.0.0",
    modelId: "stylometric-v1",
    backend: "mock",
    processingTimeMs: 1,
    demo: true,
    ...overrides,
  };
}

/** A ready `ModelStatus` with no calibration coverage (the MVP default). */
export function createModelStatus(
  overrides: Partial<ModelStatus> = {},
): ModelStatus {
  return {
    state: "ready",
    backend: "mock",
    runtimeIdentity: createBuiltinRuntimeIdentity(),
    calibrationCoverage: "none",
    calibrationSetDigest: null,
    profileCount: 0,
    earliestExpiry: null,
    reasonCodes: [],
    ...overrides,
  };
}

/** A fresh, mutable copy of the six pinned source records. */
export function createSourceArtifacts(): ArtifactRecord[] {
  return SOURCE_ARTIFACTS.map((artifact) => ({
    path: artifact.path,
    bytes: artifact.bytes,
    sha256: artifact.sha256,
  }));
}

/**
 * Builds a schemaVersion-2 manifest. `bundleDigest` and `tokenizerDigest` are
 * derived from the (possibly overridden) artifacts unless the caller overrides
 * them explicitly — which is how a test forges a divergent digest.
 */
export function createModelManifestV2(
  overrides: Partial<ModelManifestV2> = {},
): ModelManifestV2 {
  const artifacts = overrides.artifacts ?? createSourceArtifacts();
  const windowing = overrides.windowing ?? {
    modelMaxTokens: 512,
    contentTokens: 510,
    overlapTokens: 64,
    maxWindows: 8,
  };
  return {
    schemaVersion: 2,
    modelId: PINNED_MODEL_ID,
    modelVersion: PINNED_REVISION,
    task: "text-classification",
    backend: "transformers-onnx",
    modelFile: "onnx/model_int8.onnx",
    aggregationVersion: "tmr-aggregation-v2",
    contentCompositionVersion: "lexical-content-v1",
    ...overrides,
    windowing,
    artifacts,
    tokenizerDigest:
      overrides.tokenizerDigest ?? computeTokenizerDigest(artifacts),
    bundleDigest: overrides.bundleDigest ?? computeBundleDigest(artifacts),
  };
}

/** Builds a schemaVersion-1 calibration-profiles file (empty by default). */
export function createCalibrationProfilesFileV1(
  overrides: Partial<CalibrationProfilesFileV1> = {},
): CalibrationProfilesFileV1 {
  return {
    schemaVersion: 1,
    profiles: [],
    ...overrides,
  };
}

/**
 * Builds a schemaVersion-1 release descriptor. `calibrationSetDigest` is derived
 * from the (possibly overridden) `profileDigests` unless the caller overrides it
 * explicitly, so a well-formed descriptor is coherent by construction.
 */
export function createReleaseDescriptorV1(
  overrides: Partial<ReleaseDescriptorV1> = {},
): ReleaseDescriptorV1 {
  const profileDigests = overrides.profileDigests ?? [];
  return {
    schemaVersion: 1,
    modelId: PINNED_MODEL_ID,
    rolloutState: "bundle-verified",
    gateDecision: "pending",
    evidenceDigest: null,
    ...overrides,
    profileDigests,
    calibrationSetDigest:
      overrides.calibrationSetDigest ??
      computeCalibrationSetDigest(profileDigests),
  };
}
