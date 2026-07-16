import {
  verifyModelBundle,
  type BundleFetch,
  type CleanFeedModelManifest,
} from "@/inference/model-bundle";
import { getConfiguredTransformerAssetPaths } from "@/inference/transformers-environment";

export type LocalInferenceBackend = "wasm" | "webgpu";

/** Loads a sequence classifier from the configured extension-local bundle. */
export async function loadLocalSequenceClassifier(
  manifest: CleanFeedModelManifest,
  backend: LocalInferenceBackend,
  fetchImpl: BundleFetch = fetch,
) {
  const paths = getConfiguredTransformerAssetPaths();
  await verifyModelBundle(manifest, paths.modelBaseUrl, fetchImpl);
  const { AutoModelForSequenceClassification } =
    await import("@huggingface/transformers");
  return AutoModelForSequenceClassification.from_pretrained(manifest.id, {
    local_files_only: true,
    device: backend,
  });
}
