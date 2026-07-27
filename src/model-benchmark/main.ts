// Test-only entrypoint that assembles the EXACT uncalibrated TMR inference core
// in a Chrome page and exposes a page-local scoring API on `window` for the
// Playwright benchmark scorer. It is built ONLY by `vite.model-benchmark.config.ts`
// into `dist-model-benchmark/`; it never enters `vite.config.ts`,
// `manifest.config.ts` or the production `dist/`.
//
// It imports the SAME Phase 1 seam the product uses — `createModelRuntime` + the
// `ExactTokenizer`, `createTmrChunkPlan`, `aggregateWindowsV2` and `assessEvidence`
// — initializes WASM from the verified local bundle, and invokes the UNCALIBRATED
// core directly. It NEVER imports the backend selector, calibration registry,
// release selector, stylometric classifier, presentation policy, builtin fallback
// or the production `dist/`, so a pending release or zero published profiles can
// never silently turn a benchmark prediction into a stylometric score.
//
// Fail-closed by design: a missing/asset/backend failure publishes state "failed"
// (never a fabricated score and never a fallback); unsupported input abstains.
// The runtime-parity object is embedded at build time and mirrored into the
// emitted `runtime-parity.json`, so the scorer can bind embedded to emitted.

import { aggregateWindowsV2, type WindowScore } from "@/inference/aggregator";
import { bundledModelManifest } from "@/inference/bundled-model-metadata";
import {
  buildContentWindows,
  fitWindowSlice,
  selectDistributedWindows,
} from "@/inference/chunker";
import { assessEvidence } from "@/inference/evidence";
import type { CleanFeedModelManifest } from "@/inference/model-bundle";
import {
  createModelRuntime,
  createTmrChunkPlan,
  type LoadedTransformersTokenizer,
  type ModelRuntime,
  type ModelRuntimeAssets,
  type TmrChunkPlan,
} from "@/inference/model-runtime";
import {
  OnnxTextClassifier,
  TransformersJsModelGateway,
} from "@/inference/onnx-classifier";
import { configureTransformersEnvironment } from "@/inference/transformers-environment";
import { CleanFeedError } from "@/shared/errors";
import type { RuntimeModelIdentity } from "@/shared/types";

import { computeContentComposition } from "../../contracts/content-composition";
import { selectFailureDetail } from "../../contracts/failure-detail";
import { normalizeForInference } from "../../contracts/text-normalization";
import type { RuntimeParityManifestV1 } from "../../contracts/runtime-parity";

/** The runtime-parity manifest, embedded verbatim by the Vite build. */
declare const __CLEANFEED_RUNTIME_PARITY__: string;

/** The page-local status the benchmark scorer reads before sending any text. */
export interface ModelBenchmarkStatusV1 {
  schemaVersion: 1;
  state: "ready" | "failed";
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  runtimeParityDigest: string;
  backend: "wasm";
  exactTokenizer: boolean;
  errorCode: string | null;
}

/** The page-local per-document scoring outcome. */
export interface ModelBenchmarkScoreV1 {
  status: "scored" | "abstained" | "error";
  documentRawScore: number | null;
  localizedRawScore: number | null;
  evidenceQuality: "sufficient" | "limited" | "unsupported";
  reasonCode: string;
  /**
   * The sanitized cause, present on EVERY error outcome and on no other. It is
   * an allowlisted code from `contracts/failure-detail.ts`, optionally followed
   * by one of our own literal technical messages — never document text.
   */
  failureDetail?: string;
  coverage: number;
  latencyMs: number;
  memoryBytes: number | null;
}

/** The page-local API exposed only inside the unpacked test extension. */
export interface ModelBenchmarkApi {
  status: ModelBenchmarkStatusV1;
  score(text: string): Promise<ModelBenchmarkScoreV1>;
}

const MODEL_DIR = "models/cleanfeed-ptbr-v1";
const PROBE_LOCALE = "pt-BR";

function parityManifest(): RuntimeParityManifestV1 {
  return JSON.parse(__CLEANFEED_RUNTIME_PARITY__) as RuntimeParityManifestV1;
}

function failedStatus(errorCode: string): ModelBenchmarkStatusV1 {
  const parity = parityManifest();
  return {
    schemaVersion: 1,
    state: "failed",
    modelId: parity.modelId,
    modelVersion: parity.modelVersion,
    bundleDigest: parity.bundleDigest,
    aggregationVersion: parity.aggregationVersion,
    contentCompositionVersion: parity.contentCompositionVersion,
    tokenizerDigest: parity.tokenizerDigest,
    runtimeParityDigest: parity.runtimeParityDigest,
    backend: "wasm",
    exactTokenizer: false,
    errorCode,
  };
}

/**
 * An error outcome, ALWAYS carrying a non-empty sanitized detail. Which detail is
 * decided by {@link selectFailureDetail} — the rule lives in the shared contract
 * so it is unit-testable without a real Chrome run, since this module is
 * browser-only.
 */
function errorScore(
  reasonCode: string,
  cause?: unknown,
): ModelBenchmarkScoreV1 {
  return {
    status: "error",
    documentRawScore: null,
    localizedRawScore: null,
    evidenceQuality: "unsupported",
    reasonCode,
    failureDetail: selectFailureDetail(reasonCode, cause),
    coverage: 0,
    latencyMs: 0,
    memoryBytes: null,
  };
}

/** True when the extension-local asset responds without leaving the extension. */
async function assetPresent(url: string): Promise<boolean> {
  try {
    const response = await fetch(url, { method: "GET" });
    return response.ok;
  } catch {
    return false;
  }
}

/** The exact SHA-256 of a sealed artifact, read from the inlined v2 manifest. */
function artifactSha(path: string): string {
  const record = bundledModelManifest.artifacts.find(
    (artifact) => artifact.path === path,
  );
  if (record === undefined) {
    throw new CleanFeedError("MODEL_LOAD_FAILED", `missing artifact ${path}`);
  }
  return record.sha256;
}

/** Derives the v1 runtime manifest the ONNX classifier consumes from the bundle. */
function buildRuntimeManifest(): CleanFeedModelManifest {
  return {
    schemaVersion: 1,
    id: bundledModelManifest.modelId,
    name: "CleanFeed pt-BR AI Text Detector",
    version: bundledModelManifest.modelVersion,
    task: "ai_text_detection",
    architecture: "bert",
    modelPath: bundledModelManifest.modelFile,
    tokenizerPath: "tokenizer.json",
    configPath: "config.json",
    supportedLanguages: ["pt", "pt-BR"],
    maximumTokens: bundledModelManifest.windowing.modelMaxTokens,
    quantization: "int8",
    labels: { human: 0, ai: 1 },
    output: { name: "logits", kind: "logits" },
    license: "Projeto não-comercial; base BERTimbau (MIT)",
    source: `self-trained/${bundledModelManifest.modelId}@${bundledModelManifest.modelVersion}`,
    calibrationVersion: bundledModelManifest.aggregationVersion,
    sha256: {
      model: artifactSha(bundledModelManifest.modelFile),
      tokenizer: artifactSha("tokenizer.json"),
      config: artifactSha("config.json"),
    },
  };
}

/** One real ONNX classifier and one real Transformers.js tokenizer callable. */
function loadAssets(
  manifest: CleanFeedModelManifest,
): () => Promise<ModelRuntimeAssets> {
  return async () => {
    const classifier = new OnnxTextClassifier(
      manifest,
      new TransformersJsModelGateway(),
      "wasm",
    );
    await classifier.initialize();
    const { AutoTokenizer } = await import("@huggingface/transformers");
    const tokenizer = await AutoTokenizer.from_pretrained(manifest.id, {
      local_files_only: true,
    });
    return {
      classifier,
      tokenizer: tokenizer as unknown as LoadedTransformersTokenizer,
    };
  };
}

/** Best-effort process memory; null unless the UA exposes the measurement API. */
async function measurePeakMemoryBytes(): Promise<number | null> {
  const perf = performance as Performance & {
    measureUserAgentSpecificMemory?: () => Promise<{ bytes: number }>;
  };
  if (typeof perf.measureUserAgentSpecificMemory !== "function") {
    return null;
  }
  try {
    const sample = await perf.measureUserAgentSpecificMemory();
    return typeof sample.bytes === "number" ? sample.bytes : null;
  } catch {
    return null;
  }
}

/**
 * Scores one document with the UNCALIBRATED core: the SHARED Unicode
 * normalization, exact native-offset tokenization, sealed windowing, one
 * classifier call per window and the v2 aggregation. Unsupported evidence
 * abstains; a backend/tokenizer failure is surfaced as an error by the caller —
 * never a fabricated score, never a fallback.
 *
 * The normalization is the SAME function `src/inference/inference-worker.ts`
 * calls (`contracts/text-normalization.ts`), not a second copy: a benchmark that
 * scored differently-prepared text than the runtime would measure a detector
 * nobody ships. `normalized.segments` is the map back to the caller's own
 * offsets, which is what a D4 span head has to place its spans in.
 */
async function scoreDocument(
  runtime: ModelRuntime,
  plan: TmrChunkPlan,
  rawText: string,
): Promise<ModelBenchmarkScoreV1> {
  const startedAt = performance.now();
  const normalized = normalizeForInference(rawText);
  const text = normalized.text;
  const encoding = runtime.tokenizer.encodeWithOffsets(text);
  const composition = computeContentComposition(text);
  if (encoding.inputIds.length === 0) {
    return {
      status: "abstained",
      documentRawScore: null,
      localizedRawScore: null,
      evidenceQuality: "unsupported",
      reasonCode: "TEXT_TOO_SHORT",
      coverage: 0,
      latencyMs: performance.now() - startedAt,
      memoryBytes: null,
    };
  }

  // Select BEFORE inferring. The aggregation keeps at most `maxWindows` windows,
  // so inferring every candidate first and discarding the rest afterwards paid
  // for windows no result ever used. The policy is the SAME function the
  // aggregation would have applied, and the accounting it produces
  // (`candidateWindowCount`, `truncated`, the original indices) is handed to the
  // aggregation, so the report still says how many candidates existed.
  const selection = selectDistributedWindows(
    buildContentWindows(encoding.inputIds.length, plan),
    plan.maxWindows,
  );
  const maxContentTokens = plan.modelMaxTokens - encoding.specialTokenCount;
  const scored: WindowScore[] = [];
  for (const candidate of selection.selectedWindows) {
    // A full window is exactly the model's capacity, and re-tokenizing the
    // character slice on its own costs one or two tokens more than the same span
    // cost inside the whole document, which threw the document away. The fitter
    // drops content tokens from the END until the slice fits, and the SCORED
    // interval is what it returns — so coverage describes the text really scored.
    const fitted = fitWindowSlice(
      text,
      encoding.offsets,
      candidate,
      maxContentTokens,
      (slice) => runtime.tokenizer.encodeWithOffsets(slice).inputIds.length,
    );
    const result = await runtime.classifier.classify(fitted.text, {
      language: PROBE_LOCALE,
    });
    scored.push({
      index: fitted.window.index,
      tokenStart: fitted.window.tokenStart,
      tokenEnd: fitted.window.tokenEnd,
      rawScore: result.aiScore,
    });
  }

  const aggregation = aggregateWindowsV2(scored, encoding.inputIds.length, {
    selection,
  });
  const assessment = assessEvidence({
    locale: PROBE_LOCALE,
    wordCount: composition.totalUnits,
    coverage: aggregation.coverage,
    lexicalRatio: composition.lexicalRatio,
    stdDev: aggregation.stdDev,
    chunkAgreement: aggregation.chunkAgreement,
    truncated: aggregation.truncated,
    exactTokenizer: true,
    backendError: false,
    artifactMismatch: false,
  });
  const latencyMs = performance.now() - startedAt;
  const memoryBytes = await measurePeakMemoryBytes();
  const reasonCode = assessment.reasonCodes[0] ?? "SCORED";

  if (assessment.quality === "unsupported") {
    return {
      status: "abstained",
      documentRawScore: null,
      localizedRawScore: null,
      evidenceQuality: "unsupported",
      reasonCode,
      coverage: aggregation.coverage,
      latencyMs,
      memoryBytes,
    };
  }
  return {
    status: "scored",
    documentRawScore: aggregation.documentRawScore,
    localizedRawScore: aggregation.localizedRawScore,
    evidenceQuality: assessment.quality,
    reasonCode,
    coverage: aggregation.coverage,
    latencyMs,
    memoryBytes,
  };
}

function identityMatchesParity(
  identity: RuntimeModelIdentity,
  parity: RuntimeParityManifestV1,
): boolean {
  return (
    identity.kind === "bundle" &&
    identity.modelId === parity.modelId &&
    identity.modelVersion === parity.modelVersion &&
    identity.bundleDigest === parity.bundleDigest &&
    identity.tokenizerDigest === parity.tokenizerDigest &&
    identity.aggregationVersion === parity.aggregationVersion &&
    identity.contentCompositionVersion === parity.contentCompositionVersion
  );
}

async function assemble(): Promise<ModelBenchmarkApi> {
  const parity = parityManifest();

  const onnxUrl = chrome.runtime.getURL(
    `${MODEL_DIR}/${bundledModelManifest.modelFile}`,
  );
  if (!(await assetPresent(onnxUrl))) {
    return {
      status: failedStatus("MODEL_ARTIFACT_MISSING"),
      score: () => Promise.resolve(errorScore("MODEL_ARTIFACT_MISSING")),
    };
  }

  configureTransformersEnvironment({
    modelBaseUrl: chrome.runtime.getURL("models/"),
    wasmBaseUrl: chrome.runtime.getURL("vendor/transformers-wasm/"),
  });

  let runtime: ModelRuntime;
  try {
    runtime = await createModelRuntime(
      loadAssets(buildRuntimeManifest()),
      bundledModelManifest,
    );
  } catch (error) {
    const code =
      error instanceof CleanFeedError ? error.code : "MODEL_BENCHMARK_FAILED";
    return {
      status: failedStatus(code),
      score: () => Promise.resolve(errorScore(code, error)),
    };
  }

  if (!identityMatchesParity(runtime.identity, parity)) {
    return {
      status: failedStatus("RUNTIME_PARITY_IDENTITY_MISMATCH"),
      score: () =>
        Promise.resolve(errorScore("RUNTIME_PARITY_IDENTITY_MISMATCH")),
    };
  }

  const plan = createTmrChunkPlan(
    bundledModelManifest.windowing,
    runtime.tokenizer.specialTokenCount,
  );
  const status: ModelBenchmarkStatusV1 = {
    schemaVersion: 1,
    state: "ready",
    modelId: parity.modelId,
    modelVersion: parity.modelVersion,
    bundleDigest: parity.bundleDigest,
    aggregationVersion: parity.aggregationVersion,
    contentCompositionVersion: parity.contentCompositionVersion,
    tokenizerDigest: parity.tokenizerDigest,
    runtimeParityDigest: parity.runtimeParityDigest,
    backend: "wasm",
    exactTokenizer: true,
    errorCode: null,
  };

  return {
    status,
    score: async (text: string): Promise<ModelBenchmarkScoreV1> => {
      try {
        return await scoreDocument(runtime, plan, text);
      } catch (error) {
        if (
          error instanceof CleanFeedError &&
          error.code === "INSUFFICIENT_EVIDENCE"
        ) {
          return {
            status: "abstained",
            documentRawScore: null,
            localizedRawScore: null,
            evidenceQuality: "unsupported",
            reasonCode: "INSUFFICIENT_EVIDENCE",
            coverage: 0,
            latencyMs: 0,
            memoryBytes: null,
          };
        }
        return errorScore(
          error instanceof CleanFeedError
            ? error.code
            : "MODEL_BENCHMARK_FAILED",
          error,
        );
      }
    },
  };
}

declare global {
  interface Window {
    __cleanfeedModelBenchmark?: ModelBenchmarkApi;
  }
}

void (async () => {
  let api: ModelBenchmarkApi;
  try {
    api = await assemble();
  } catch (error) {
    const code =
      error instanceof CleanFeedError ? error.code : "MODEL_BENCHMARK_FAILED";
    api = {
      status: failedStatus(code),
      score: () => Promise.resolve(errorScore(code, error)),
    };
  }
  // Publish only after a terminal assembly outcome, so the scorer never reads a
  // half-initialized API.
  window.__cleanfeedModelBenchmark = api;
})();
