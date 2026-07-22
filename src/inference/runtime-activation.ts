// The live activation seam for the calibrated TMR runtime. It binds three
// decisions the offscreen document and the worker must agree on:
//   1. WHETHER a cross-validated descriptor authorizes the TMR primary path
//      (only a promoted `indicator`/`actions` release with usable profiles);
//   2. the v1 runtime manifest the ONNX backend consumes, derived from the
//      SEALED v2 bundle metadata (never hand-authored, never from the network);
//   3. the calibrated runtime parts the worker plugs into its pipeline — the
//      ExactTokenizer-based ModelRuntime (native offsets), the release-bound
//      CalibrationRegistry, and the sealed bundle identity that the calibrated
//      decision and cache key ride on.
//
// A pending/bundle-verified/reject release authorizes nothing here, so the
// offscreen document omits the manifest and the worker keeps the indicative
// stylometric fallback — the Phase-1 fail-closed default.

import { bundledModelManifest } from "@/inference/bundled-model-metadata";
import { CalibrationRegistry } from "@/inference/calibration-registry";
import {
  selectCatalogRuntime,
  type CatalogSelectionInput,
} from "@/inference/model-catalog";
import type {
  CleanFeedModelManifest,
  RuntimeDescriptor,
} from "@/inference/model-bundle";
import {
  createModelRuntime,
  type LoadedTransformersTokenizer,
} from "@/inference/model-runtime";
import {
  TransformersTokenizer,
  type ExactTokenGateway,
  type Tokenizer,
} from "@/inference/tokenizer";
import type { WorkerInitializePayload } from "@/inference/worker-protocol";
import { CleanFeedError } from "@/shared/errors";
import type { RuntimeModelIdentity, TextClassifier } from "@/shared/types";

/**
 * Whether a cross-validated descriptor authorizes the calibrated TMR path as the
 * SET primary. It defers to {@link selectCatalogRuntime}: only a promoted
 * (`indicator`/`actions`) release carrying at least one valid, bundle-compatible
 * profile is authorized; every other state keeps the stylometric builtin primary.
 * The descriptor's profiles are already proven compatible and unexpired by
 * {@link crossValidateRuntimeDescriptor}, so their count is the valid count.
 */
export function authorizesTmrPrimary(
  descriptor: RuntimeDescriptor,
  buildMode: CatalogSelectionInput["buildMode"] = "production",
): boolean {
  return (
    selectCatalogRuntime({
      rolloutState: descriptor.release.rolloutState,
      validProfileCount: descriptor.profiles.profiles.length,
      buildMode,
    }).primary === "tmr"
  );
}

/**
 * Derives the v1 runtime manifest the ONNX backend consumes from the SEALED v2
 * bundle metadata. Every checksum comes from the pinned artifact records; the
 * label map (`{human:0, ai:1}`) and RoBERTa `logits` output are the bundle's
 * fixed config. It never reads the network or the filesystem.
 */
export function buildBundledRuntimeManifest(): CleanFeedModelManifest {
  return {
    schemaVersion: 1,
    id: bundledModelManifest.modelId,
    name: "TMR AI Text Detector",
    version: bundledModelManifest.modelVersion,
    task: "ai_text_detection",
    architecture: "roberta",
    modelPath: bundledModelManifest.modelFile,
    tokenizerPath: "tokenizer.json",
    configPath: "config.json",
    supportedLanguages: ["pt", "pt-BR"],
    maximumTokens: bundledModelManifest.windowing.modelMaxTokens,
    quantization: "int8",
    labels: { human: 0, ai: 1 },
    output: { name: "logits", kind: "logits" },
    license: "MIT",
    source: `onnx-community/tmr-ai-text-detector-ONNX@${bundledModelManifest.modelVersion}`,
    calibrationVersion: bundledModelManifest.aggregationVersion,
    sha256: {
      model: artifactSha(bundledModelManifest.modelFile),
      tokenizer: artifactSha("tokenizer.json"),
      config: artifactSha("config.json"),
    },
  };
}

function artifactSha(path: string): string {
  const record = bundledModelManifest.artifacts.find(
    (artifact) => artifact.path === path,
  );
  if (record === undefined) {
    throw new CleanFeedError("MODEL_LOAD_FAILED", `missing artifact ${path}`);
  }
  return record.sha256;
}

/**
 * Assembles the INITIALIZE payload. The manifest — which is what makes the worker
 * load the sealed TMR — is carried when the descriptor authorizes the CALIBRATED
 * primary, OR when the user opted into the "preview experimental / não calibrado"
 * mode. In the experimental case the release is still `pending`, so the worker
 * loads the model but runs it UNCALIBRATED; a promoted release always outranks the
 * experimental flag (it produces a calibrated registry, this does not).
 */
export function buildWorkerInitializePayload(params: {
  modelBaseUrl: string;
  wasmBaseUrl: string;
  descriptor: RuntimeDescriptor;
  settings?: WorkerInitializePayload["settings"];
  buildMode?: CatalogSelectionInput["buildMode"];
  experimentalUncalibratedTmr?: boolean;
}): WorkerInitializePayload {
  const { modelBaseUrl, wasmBaseUrl, descriptor, settings, buildMode } = params;
  const calibrated = authorizesTmrPrimary(descriptor, buildMode);
  // Experimental only when the flag is on AND the release is NOT promoted: a
  // promoted release is calibrated, never experimental.
  const experimental =
    !calibrated && params.experimentalUncalibratedTmr === true;
  return {
    modelBaseUrl,
    wasmBaseUrl,
    descriptor,
    ...(settings === undefined ? {} : { settings }),
    ...(calibrated || experimental
      ? { modelManifest: buildBundledRuntimeManifest() }
      : {}),
    ...(experimental ? { experimentalUncalibratedTmr: true } : {}),
  };
}

/** How the worker loads the raw Transformers.js tokenizer (injectable for tests). */
export type TokenizerLoader = (
  modelId: string,
) => Promise<LoadedTransformersTokenizer>;

/** The TMR runtime parts the worker plugs into its pipeline for the bundle path. */
export interface CalibratedRuntimeParts {
  /** Exact, native-offset tokenizer bound to the sealed window plan. */
  tokenizer: Tokenizer;
  /**
   * The release-bound registry; every miss is a typed, fail-closed abstention.
   * UNDEFINED in the uncalibrated experimental preview, so the worker routes the
   * decision through the provisional experimental mapping instead of the
   * profile lookup — while STILL using the exact tokenizer below.
   */
  calibration: CalibrationRegistry | undefined;
  /** The sealed v2 bundle identity the calibrated decision and cache key ride on. */
  identity: RuntimeModelIdentity;
}

/**
 * Builds the TMR runtime parts from a descriptor and the already-selected
 * classifier. It assembles the cohesive {@link createModelRuntime} seam
 * (ExactTokenizer + sealed window plan + authoritative identity) and adapts the
 * ExactTokenizer to the pipeline's {@link Tokenizer} via {@link TransformersTokenizer}
 * (so chunk planning uses NATIVE offsets AND evidence sees an EXACT tokenizer).
 * When `calibrated` (default), it also binds the {@link CalibrationRegistry} to the
 * release + profiles (the calibrated `decideWithProfile` path); the experimental
 * preview passes `calibrated: false` so no registry is built and the pipeline uses
 * the provisional experimental decision — but on the SAME exact tokenizer, so
 * evidence is not spuriously "unsupported".
 */
export async function buildCalibratedRuntimeParts(params: {
  classifier: TextClassifier;
  descriptor: RuntimeDescriptor;
  loadTokenizer: TokenizerLoader;
  calibrated?: boolean;
}): Promise<CalibratedRuntimeParts> {
  const { classifier, descriptor, loadTokenizer, calibrated = true } = params;
  const runtime = await createModelRuntime(
    async () => ({
      classifier,
      tokenizer: await loadTokenizer(descriptor.manifest.modelId),
    }),
    descriptor.manifest,
    { calibrationSetDigest: descriptor.release.calibrationSetDigest },
  );
  const gateway: ExactTokenGateway = {
    async tokenize(text: string) {
      const encoding = runtime.tokenizer.encodeWithOffsets(text);
      // The exact tokenizer already excludes special tokens, so the content ids
      // ARE the pipeline's tokens: report zero specials so the chunk-planning
      // token count equals the native-offset count.
      return {
        inputIds: encoding.inputIds,
        specialTokenCount: 0,
        tokenOffsets: encoding.offsets,
      };
    },
  };
  return {
    tokenizer: new TransformersTokenizer(descriptor.manifest.modelId, gateway),
    calibration: calibrated
      ? new CalibrationRegistry(descriptor.release, descriptor.profiles)
      : undefined,
    identity: runtime.identity,
  };
}
