import type { CleanFeedModelManifest } from "@/inference/model-bundle";

export type LocalInferenceBackend = "wasm" | "webgpu";

/** Loads a sequence classifier from the configured extension-local bundle. */
export async function loadLocalSequenceClassifier(
  manifest: CleanFeedModelManifest,
  backend: LocalInferenceBackend,
) {
  const { AutoModelForSequenceClassification } =
    await import("@huggingface/transformers");
  return AutoModelForSequenceClassification.from_pretrained(manifest.id, {
    local_files_only: true,
    device: backend,
  });
}
