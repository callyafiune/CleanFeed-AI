import {
  verifyModelBundle,
  type BundleFetch,
  type CleanFeedModelManifest,
} from "@/inference/model-bundle";
import { getConfiguredTransformerAssetPaths } from "@/inference/transformers-environment";
import { CleanFeedError } from "@/shared/errors";

export type LocalInferenceBackend = "wasm" | "webgpu";

/** Loads a sequence classifier from the configured extension-local bundle. */
export async function loadLocalSequenceClassifier(
  manifest: CleanFeedModelManifest,
  backend: LocalInferenceBackend,
  fetchImpl: BundleFetch = fetch,
) {
  const paths = getConfiguredTransformerAssetPaths();
  await verifyModelBundle(manifest, paths.modelBaseUrl, fetchImpl);
  const runtime = getTransformersRuntimeOptions(manifest);
  const { AutoModelForSequenceClassification } =
    await import("@huggingface/transformers");
  return AutoModelForSequenceClassification.from_pretrained(manifest.id, {
    local_files_only: true,
    device: backend,
    ...runtime,
  });
}

/** Maps the verified manifest paths to the exact Transformers.js requests. */
export function getTransformersRuntimeOptions(
  manifest: CleanFeedModelManifest,
): {
  model_file_name: string;
  subfolder: string;
  dtype: "fp32" | "int8" | "q4";
} {
  if (
    manifest.configPath !== "config.json" ||
    manifest.tokenizerPath !== "tokenizer.json"
  ) {
    modelLoadFailed();
  }

  const suffix = suffixForQuantization(manifest.quantization);
  const segments = manifest.modelPath.split("/");
  const filename = segments.pop();
  if (filename === undefined || !filename.endsWith(`${suffix}.onnx`)) {
    modelLoadFailed();
  }
  const model_file_name = filename.slice(0, -`${suffix}.onnx`.length);
  if (model_file_name.length === 0) modelLoadFailed();

  return {
    model_file_name,
    subfolder: segments.join("/"),
    dtype: dtypeForQuantization(manifest.quantization),
  };
}

function suffixForQuantization(
  quantization: CleanFeedModelManifest["quantization"],
): "" | "_int8" | "_q4" {
  if (quantization === "none") return "";
  if (quantization === "int8") return "_int8";
  return "_q4";
}

function dtypeForQuantization(
  quantization: CleanFeedModelManifest["quantization"],
): "fp32" | "int8" | "q4" {
  if (quantization === "none") return "fp32";
  if (quantization === "int8") return "int8";
  return "q4";
}

function modelLoadFailed(): never {
  throw new CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED");
}
