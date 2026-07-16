import { env } from "@huggingface/transformers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureTransformersEnvironment } from "@/inference/transformers-environment";
import type { CleanFeedModelManifest } from "@/inference/model-bundle";
import { loadLocalSequenceClassifier } from "@/inference/model-loader";

const fromPretrained = vi.hoisted(() => vi.fn());

vi.mock("@huggingface/transformers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@huggingface/transformers")>()),
  AutoModelForSequenceClassification: { from_pretrained: fromPretrained },
}));

const originalEnvironment = {
  allowRemoteModels: env.allowRemoteModels,
  allowLocalModels: env.allowLocalModels,
  localModelPath: env.localModelPath,
  wasmPaths: wasmEnvironment().wasmPaths,
};

afterEach(() => {
  env.allowRemoteModels = originalEnvironment.allowRemoteModels;
  env.allowLocalModels = originalEnvironment.allowLocalModels;
  env.localModelPath = originalEnvironment.localModelPath;
  wasmEnvironment().wasmPaths = originalEnvironment.wasmPaths;
});

describe("Transformers environment", () => {
  it("disables all remote model access", () => {
    configureTransformersEnvironment({
      modelBaseUrl: "chrome-extension://test/models/",
      wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
    });

    expect(env.allowRemoteModels).toBe(false);
    expect(env.allowLocalModels).toBe(true);
    expect(env.localModelPath).toBe("chrome-extension://test/models/");
    expect(wasmEnvironment().wasmPaths).toBe(
      "chrome-extension://test/vendor/transformers-wasm/",
    );
  });

  it("rejects asset paths outside this extension", () => {
    expect(() =>
      configureTransformersEnvironment({
        modelBaseUrl: "https://models.example/",
        wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
      }),
    ).toThrow("MODEL_LOAD_FAILED");
  });

  it("loads its manifest id through the selected local backend", async () => {
    fromPretrained.mockResolvedValue({ id: "loaded-model" });
    const manifest = { id: "cleanfeed-detector-v1" } as CleanFeedModelManifest;

    await expect(
      loadLocalSequenceClassifier(manifest, "wasm"),
    ).resolves.toEqual({ id: "loaded-model" });
    expect(fromPretrained).toHaveBeenCalledWith("cleanfeed-detector-v1", {
      local_files_only: true,
      device: "wasm",
    });
  });
});

function wasmEnvironment(): NonNullable<typeof env.backends.onnx.wasm> {
  if (env.backends.onnx.wasm === undefined) {
    throw new Error("The Transformers runtime does not expose a WASM backend.");
  }
  return env.backends.onnx.wasm;
}
