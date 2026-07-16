import { env } from "@huggingface/transformers";
import { afterEach, describe, expect, it, vi } from "vitest";

import { configureTransformersEnvironment } from "@/inference/transformers-environment";
import type { CleanFeedModelManifest } from "@/inference/model-bundle";
import { loadLocalSequenceClassifier } from "@/inference/model-loader";
import validManifest from "../../fixtures/models/valid/cleanfeed-model.json";

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
  fromPretrained.mockReset();
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

  it("verifies the local model bundle before it reaches Transformers", async () => {
    fromPretrained.mockResolvedValue({ id: "loaded-model" });
    configureTransformersEnvironment({
      modelBaseUrl: "chrome-extension://test/models/",
      wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
    });
    const fetchLocalArtifact = vi.fn(async (input: string) => {
      const body = input.endsWith("model.onnx")
        ? "model"
        : input.endsWith("tokenizer.json")
          ? "tokenizer"
          : "config";
      return new Response(body, { status: 200 });
    });

    await expect(
      loadLocalSequenceClassifier(
        validManifest as CleanFeedModelManifest,
        "wasm",
        fetchLocalArtifact,
      ),
    ).resolves.toEqual({ id: "loaded-model" });
    expect(fromPretrained).toHaveBeenCalledWith("cleanfeed-detector-v1", {
      local_files_only: true,
      device: "wasm",
    });
    expect(fetchLocalArtifact).toHaveBeenCalledTimes(3);
  });

  it("fails closed when local bundle verification cannot fetch an artifact", async () => {
    fromPretrained.mockResolvedValue({ id: "must-not-load" });
    configureTransformersEnvironment({
      modelBaseUrl: "chrome-extension://test/models/",
      wasmBaseUrl: "chrome-extension://test/vendor/transformers-wasm/",
    });
    const deniedNetwork = vi.fn(async () => {
      throw new Error("network access denied");
    });

    await expect(
      loadLocalSequenceClassifier(
        validManifest as CleanFeedModelManifest,
        "wasm",
        deniedNetwork,
      ),
    ).rejects.toThrow("MODEL_LOAD_FAILED");
    expect(deniedNetwork).toHaveBeenCalledTimes(3);
    expect(fromPretrained).not.toHaveBeenCalled();
  });
});

function wasmEnvironment(): NonNullable<typeof env.backends.onnx.wasm> {
  if (env.backends.onnx.wasm === undefined) {
    throw new Error("The Transformers runtime does not expose a WASM backend.");
  }
  return env.backends.onnx.wasm;
}
