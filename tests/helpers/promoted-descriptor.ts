// Builds a fully-coherent PROMOTED runtime descriptor for the sealed TMR bundle,
// so a test can exercise the calibrated (decideWithProfile) path without
// fabricating a real promotion in the tracked release.json. The manifest and
// source lock are the REAL sealed pair; only the release + one profile are
// synthesised, with coordinates matching the sealed identity, so
// `crossValidateRuntimeDescriptor` accepts it and the CalibrationRegistry
// findExact-matches at the runtime identity.

import {
  bundledModelManifest,
  bundledSourceLock,
} from "@/inference/bundled-model-metadata";
import type { RuntimeDescriptor } from "@/inference/model-bundle";
import type { LoadedTransformersTokenizer } from "@/inference/model-runtime";
import {
  computeCalibrationProfileDigest,
  computeCalibrationSetDigest,
  type CalibrationProfilesFileV1,
  type RuntimeCalibrationProfileV1,
} from "../../contracts/calibration-profile";
import type { ModelReleaseDescriptorV1 } from "../../contracts/model-release";

const DAY_MS = 24 * 60 * 60 * 1000;
const ISSUED_AT = new Date(Date.now() - DAY_MS).toISOString();
const EXPIRES_AT = new Date(Date.parse(ISSUED_AT) + 180 * DAY_MS).toISOString();

function gate(estimate: number, sampleSize: number) {
  return {
    estimate,
    lowerBound95: Math.max(0, estimate - 0.01),
    upperBound95: Math.min(1, estimate + 0.01),
    sampleSize,
  };
}

/** A pass/hide profile whose coordinates match the sealed bundle identity. */
function baseProfile(): Omit<RuntimeCalibrationProfileV1, "profileDigest"> {
  return {
    schemaVersion: 1,
    profileId: "linkedin-200plus",
    modelId: bundledModelManifest.modelId,
    modelVersion: bundledModelManifest.modelVersion,
    bundleDigest: bundledModelManifest.bundleDigest,
    tokenizerDigest: bundledModelManifest.tokenizerDigest,
    platform: "linkedin",
    locale: "pt-BR",
    lengthBucket: "200-plus",
    aggregationVersion: bundledModelManifest.aggregationVersion,
    contentCompositionVersion: bundledModelManifest.contentCompositionVersion,
    datasetDigest: "c".repeat(64),
    splitDigest: "d".repeat(64),
    evaluatorDigest: "e".repeat(64),
    issuedAt: ISSUED_AT,
    expiresAt: EXPIRES_AT,
    calibrators: {
      document: {
        kind: "isotonic",
        interpolation: "linear",
        clamp: true,
        knots: [
          { rawScore: 0, calibratedScore: 0 },
          { rawScore: 0.5, calibratedScore: 0.4 },
          { rawScore: 1, calibratedScore: 1 },
        ],
      },
      localized: { kind: "platt", slope: 1.2, intercept: -0.3 },
    },
    thresholds: {
      documentIndicator: 0.8,
      localizedIndicator: 0.82,
      documentAction: 0.9,
    },
    evidencePolicy: {
      minimumCoverage: 0.95,
      minimumLexicalRatio: 0.6,
      maximumStdDev: 0.25,
      minimumChunkAgreement: 0.5,
      exactTokenizerRequired: true,
    },
    gateEvidence: {
      decision: "pass",
      intervalMethod: "wilson-one-sided-95",
      ece: { value: 0.02, bins: 15, sampleSize: 5000 },
      overall: {
        indicatorFpr: gate(0.03, 2500),
        indicatorRecall: gate(0.7, 1200),
        actionFpr: gate(0.01, 2500),
        actionRecall: gate(0.6, 1200),
        coverage: gate(0.97, 3000),
        mixedRecall: gate(0.65, 1200),
      },
      criticalFprSlices: {
        "topic:tech": {
          indicatorFpr: gate(0.03, 400),
          actionFpr: gate(0.01, 400),
        },
      },
      criticalRecallSlices: {
        "topic:tech": {
          indicatorRecall: gate(0.7, 300),
          actionRecall: gate(0.6, 300),
        },
      },
    },
    actionCeiling: "hide",
  };
}

/** The sealed calibration profile and its digest for the promoted descriptor. */
export async function promotedProfile(): Promise<{
  profile: RuntimeCalibrationProfileV1;
  profilesFile: CalibrationProfilesFileV1;
  profileDigest: string;
}> {
  const draft = {
    ...baseProfile(),
    profileDigest: "",
  } as RuntimeCalibrationProfileV1;
  draft.profileDigest = await computeCalibrationProfileDigest(draft);
  return {
    profile: draft,
    profilesFile: { schemaVersion: 1, profiles: [draft] },
    profileDigest: draft.profileDigest,
  };
}

/** The promoted (`actions`) release descriptor bound to the sealed identity. */
export async function promotedRelease(
  profileDigest: string,
): Promise<ModelReleaseDescriptorV1> {
  return {
    schemaVersion: 1,
    modelId: bundledModelManifest.modelId,
    modelVersion: bundledModelManifest.modelVersion,
    bundleDigest: bundledModelManifest.bundleDigest,
    tokenizerDigest: bundledModelManifest.tokenizerDigest,
    aggregationVersion: bundledModelManifest.aggregationVersion,
    contentCompositionVersion: bundledModelManifest.contentCompositionVersion,
    calibrationSetDigest: await computeCalibrationSetDigest([profileDigest]),
    profileDigests: [profileDigest],
    rolloutState: "actions",
    gateDecision: "pass",
    issuedAt: ISSUED_AT,
    evidenceDigest: "f".repeat(64),
  } as ModelReleaseDescriptorV1;
}

/**
 * A cross-validation-clean PROMOTED descriptor: the real sealed manifest and
 * source lock, plus a synthesised `actions` release and one matching profile.
 */
export async function promotedDescriptor(): Promise<{
  descriptor: RuntimeDescriptor;
  profileDigest: string;
}> {
  const { profilesFile, profileDigest } = await promotedProfile();
  const release = await promotedRelease(profileDigest);
  return {
    descriptor: {
      manifest: bundledModelManifest,
      release,
      profiles: profilesFile,
      sourceLock: bundledSourceLock,
    },
    profileDigest,
  };
}

/**
 * A raw ByteLevel-BPE fake tokenizer: it reserves two special tokens (measured
 * by the exact tokenizer's probe) and segments text one code point per token,
 * rendering each to its byte-alphabet surface form so the derived offsets tile
 * the source exactly. No model, no network — enough to drive the calibrated path.
 */
export function fakeByteLevelTokenizer(): LoadedTransformersTokenizer {
  const byteToChar = byteToCharMap();
  const utf8 = new TextEncoder();
  const surface = (piece: string): string =>
    Array.from(utf8.encode(piece), (byte) => byteToChar.get(byte)).join("");
  const contentTokens = (text: string): string[] => Array.from(text);
  const tokenizer = ((text: string, options) => {
    const ids = contentTokens(text).map((_, index) => index + 10);
    return {
      input_ids: options.add_special_tokens ? [0, ...ids, 2] : ids,
    };
  }) as LoadedTransformersTokenizer;
  tokenizer.tokenize = (text: string) =>
    contentTokens(text).map((char) => surface(char));
  return tokenizer;
}

function byteToCharMap(): Map<number, string> {
  const bs: number[] = [];
  for (let b = 0x21; b <= 0x7e; b += 1) bs.push(b);
  for (let b = 0xa1; b <= 0xac; b += 1) bs.push(b);
  for (let b = 0xae; b <= 0xff; b += 1) bs.push(b);
  const cs = bs.slice();
  let next = 0;
  for (let b = 0; b < 256; b += 1) {
    if (!bs.includes(b)) {
      bs.push(b);
      cs.push(256 + next);
      next += 1;
    }
  }
  const map = new Map<number, string>();
  for (let i = 0; i < bs.length; i += 1)
    map.set(bs[i]!, String.fromCharCode(cs[i]!));
  return map;
}
