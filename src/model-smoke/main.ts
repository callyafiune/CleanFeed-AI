// Test-only entrypoint that runs the REAL TMR runtime once in a Chrome page and
// publishes a single, privacy-safe ModelSmokeReport on `window`.
//
// This file is built ONLY by `vite.model-smoke.config.ts` into `dist-model-smoke/`;
// it never enters `vite.config.ts`, `manifest.config.ts` or the production `dist/`.
//
// It does NOT inject a fake classifier, tokenizer or Transformers gateway. It
// assembles the cohesive `ModelRuntime` seam (`createModelRuntime` + the
// `ExactTokenizer`, which measures the special-token budget once and uses NATIVE
// `return_offsets_mapping` offsets — never substring reconstruction), runs two
// fixed, non-sensitive Portuguese inferences and reports the sealed identity,
// the measured token budget, the window counts, both aggregation raw scores and
// cold/warm timings.
//
// Fail-closed by design:
//   - if the ONNX binary is absent, it reports state "failed" +
//     errorCode "MODEL_ARTIFACT_MISSING" (never a fabricated score);
//   - if a sealed asset is corrupt (the `?scenario=corrupt` harness path), it
//     makes ONE switch to the indicative builtin fallback identity — no loop,
//     no oscillation — and reports errorCode "MODEL_ASSET_CORRUPTED".
//
// The report carries NO text, tokens, page URL or per-sample scores — only the
// two fixed probes' aggregate scores, which are non-sensitive by construction.

import { aggregateWindowsV2, type WindowScore } from "@/inference/aggregator";
import { bundledModelManifest } from "@/inference/bundled-model-metadata";
import { buildBuiltinIdentity } from "@/inference/builtin-runtime";
import { buildContentWindows } from "@/inference/chunker";
import type { CleanFeedModelManifest } from "@/inference/model-bundle";
import {
  createModelRuntime,
  type LoadedTransformersTokenizer,
  type ModelRuntime,
  type ModelRuntimeAssets,
} from "@/inference/model-runtime";
import {
  OnnxTextClassifier,
  TransformersJsModelGateway,
} from "@/inference/onnx-classifier";
import { configureTransformersEnvironment } from "@/inference/transformers-environment";
import { CleanFeedError } from "@/shared/errors";
import type { AggregationResultV2, RuntimeModelIdentity } from "@/shared/types";

/** The privacy-safe terminal report the Playwright smoke asserts against. */
export interface ModelSmokeReport {
  state: "passed" | "failed";
  runtimeIdentity: RuntimeModelIdentity | null;
  exactTokenizer: boolean;
  specialTokenCount: number;
  candidateWindowCount: number;
  selectedWindowCount: number;
  documentRawScore: number | null;
  localizedRawScore: number | null;
  coldStartMs: number;
  warmInferenceMs: number;
  peakMemoryBytes: number | null;
  errorCode: string | null;
}

/** The extension-relative directory of the sealed model bundle. */
const MODEL_DIR = "models/cleanfeed-ptbr-v1";

/** The canonical calibration locale the smoke exercises. */
const PROBE_LOCALE = "pt-BR";

/**
 * Two fixed, NON-sensitive Portuguese probes. They exist only to make the model
 * produce a well-formed distribution offline; nothing asserts their ground truth
 * and they contain no personal or private content.
 */
const PROBE_TEXTS: readonly [string, string] = [
  "A adoção de ferramentas locais de análise cresceu no mercado brasileiro e exige equipes atentas à privacidade dos dados.",
  "O relatório trimestral aponta melhorias graduais na experiência de uso da plataforma e uma retenção de clientes mais estável.",
];

function emptyReport(): ModelSmokeReport {
  return {
    state: "failed",
    runtimeIdentity: null,
    exactTokenizer: false,
    specialTokenCount: 0,
    candidateWindowCount: 0,
    selectedWindowCount: 0,
    documentRawScore: null,
    localizedRawScore: null,
    coldStartMs: 0,
    warmInferenceMs: 0,
    peakMemoryBytes: null,
    errorCode: null,
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

/**
 * Derives the v1 runtime manifest the ONNX classifier consumes from the sealed v2
 * bundle metadata and the model's own `config.json` label map (`{human:0, ai:1}`,
 * RoBERTa `logits` output). Every checksum comes from the pinned artifact records.
 */
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

/**
 * The single asset load `createModelRuntime` binds its four coordinates to: one
 * real ONNX classifier and one real Transformers.js tokenizer callable (the raw
 * `(text, options) => { input_ids, offset_mapping }` shape the ExactTokenizer
 * wraps). No fake gateway is ever substituted.
 */
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

/**
 * Scores one document with the real runtime: exact native-offset tokenization,
 * sealed windowing, one classifier call per candidate window and the v2
 * aggregation (which itself re-selects at most eight windows). The two decision
 * signals are never blended.
 */
async function scoreDocument(
  runtime: ModelRuntime,
  text: string,
): Promise<AggregationResultV2> {
  const encoding = runtime.tokenizer.encodeWithOffsets(text);
  const windows = buildContentWindows(
    encoding.inputIds.length,
    runtime.chunkPlan,
  );
  const scored: WindowScore[] = [];
  for (const window of windows) {
    const slice = text.slice(
      encoding.offsets[window.tokenStart]!.start,
      encoding.offsets[window.tokenEnd - 1]!.end,
    );
    const result = await runtime.classifier.classify(slice, {
      language: PROBE_LOCALE,
    });
    scored.push({
      index: window.index,
      tokenStart: window.tokenStart,
      tokenEnd: window.tokenEnd,
      rawScore: result.aiScore,
    });
  }
  return aggregateWindowsV2(scored, encoding.inputIds.length);
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

async function disposeQuietly(runtime: ModelRuntime): Promise<void> {
  try {
    await runtime.classifier.dispose();
  } catch {
    // Disposal is best-effort; a partial session must never mask the report.
  }
}

/**
 * Builds the terminal failure report. A corrupt sealed asset makes ONE switch to
 * the indicative builtin fallback identity (no retry, no loop); every other
 * failure carries the structured error code verbatim.
 */
function failureReport(
  error: unknown,
  scenario: string | null,
): ModelSmokeReport {
  const base = emptyReport();
  if (scenario === "corrupt") {
    return {
      ...base,
      state: "failed",
      runtimeIdentity: buildBuiltinIdentity({
        id: "stylometric-v1",
        version: "unavailable",
      }),
      errorCode: "MODEL_ASSET_CORRUPTED",
    };
  }
  const code =
    error instanceof CleanFeedError ? error.code : "MODEL_SMOKE_FAILED";
  return { ...base, state: "failed", errorCode: code };
}

async function run(): Promise<ModelSmokeReport> {
  const scenario = new URLSearchParams(location.search).get("scenario");

  // Fail closed the moment the sealed ONNX binary is absent — never fabricate.
  const onnxUrl = chrome.runtime.getURL(
    `${MODEL_DIR}/${bundledModelManifest.modelFile}`,
  );
  if (scenario !== "corrupt" && !(await assetPresent(onnxUrl))) {
    return {
      ...emptyReport(),
      state: "failed",
      errorCode: "MODEL_ARTIFACT_MISSING",
    };
  }

  configureTransformersEnvironment({
    modelBaseUrl: chrome.runtime.getURL("models/"),
    wasmBaseUrl: chrome.runtime.getURL("vendor/transformers-wasm/"),
  });

  const manifest = buildRuntimeManifest();
  let runtime: ModelRuntime;
  const coldStartedAt = performance.now();
  try {
    runtime = await createModelRuntime(
      loadAssets(manifest),
      bundledModelManifest,
    );
    const coldAggregation = await scoreDocument(runtime, PROBE_TEXTS[0]);
    void coldAggregation;
  } catch (error) {
    return failureReport(error, scenario);
  }
  const coldStartMs = performance.now() - coldStartedAt;

  let warmAggregation: AggregationResultV2;
  const warmStartedAt = performance.now();
  try {
    warmAggregation = await scoreDocument(runtime, PROBE_TEXTS[1]);
  } catch (error) {
    await disposeQuietly(runtime);
    return failureReport(error, scenario);
  }
  const warmInferenceMs = performance.now() - warmStartedAt;

  const peakMemoryBytes = await measurePeakMemoryBytes();
  const identity = runtime.identity;
  const specialTokenCount = runtime.tokenizer.specialTokenCount;
  await disposeQuietly(runtime);

  return {
    state: "passed",
    runtimeIdentity: identity,
    exactTokenizer: true,
    specialTokenCount,
    candidateWindowCount: warmAggregation.candidateWindowCount,
    selectedWindowCount: warmAggregation.selectedWindowIndices.length,
    documentRawScore: warmAggregation.documentRawScore,
    localizedRawScore: warmAggregation.localizedRawScore,
    coldStartMs,
    warmInferenceMs,
    peakMemoryBytes,
    errorCode: null,
  };
}

declare global {
  interface Window {
    __cleanfeedModelSmoke?: ModelSmokeReport;
  }
}

void (async () => {
  let report: ModelSmokeReport;
  try {
    report = await run();
  } catch (error) {
    report = failureReport(
      error,
      new URLSearchParams(location.search).get("scenario"),
    );
  }
  // Publish only after reaching a terminal state, so the harness never reads a
  // half-populated report.
  window.__cleanfeedModelSmoke = report;
})();
