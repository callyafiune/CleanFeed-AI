import { env } from "@huggingface/transformers";

import { CleanFeedError } from "@/shared/errors";

export interface TransformerAssetPaths {
  modelBaseUrl: string;
  wasmBaseUrl: string;
}

/** Configures Transformers.js to resolve every artifact from this extension. */
export function configureTransformersEnvironment(
  paths: TransformerAssetPaths,
): void {
  assertExtensionUrl(paths.modelBaseUrl, "/models/");
  assertExtensionUrl(paths.wasmBaseUrl, "/vendor/transformers-wasm/");

  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = paths.modelBaseUrl;
  const wasm = env.backends.onnx.wasm;
  if (wasm === undefined) modelLoadFailed();
  wasm.wasmPaths = paths.wasmBaseUrl;
}

function assertExtensionUrl(value: string, pathname: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    modelLoadFailed();
  }
  if (
    url.protocol !== "chrome-extension:" ||
    url.hostname === "" ||
    url.pathname !== pathname ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    modelLoadFailed();
  }
}

function modelLoadFailed(): never {
  throw new CleanFeedError("MODEL_LOAD_FAILED", "MODEL_LOAD_FAILED");
}
