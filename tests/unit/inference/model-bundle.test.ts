import { describe, expect, it, vi } from "vitest";

import {
  parseModelManifest,
  verifyModelBundle,
} from "@/inference/model-bundle";
import { ModelCatalog } from "@/inference/model-catalog";
import validManifest from "../../fixtures/models/valid/cleanfeed-model.json";

describe("model bundles", () => {
  it("accepts an explicit binary AI/human manifest", () => {
    expect(parseModelManifest(validManifest)).toMatchObject({
      schemaVersion: 1,
      task: "ai_text_detection",
      labels: { human: 0, ai: 1 },
      maximumTokens: 256,
    });
  });

  it.each([
    { ...validManifest, labels: { human: 1, ai: 1 } },
    { ...validManifest, modelPath: "../../outside.onnx" },
    { ...validManifest, supportedLanguages: [] },
    { ...validManifest, license: "" },
    { ...validManifest, sha256: { model: "not-a-hash" } },
  ])("rejects unsafe or ambiguous manifest %#", (manifest) => {
    expect(() => parseModelManifest(manifest)).toThrowError(
      "MODEL_LOAD_FAILED",
    );
  });

  it("rejects a checksum array even when its string coercion is a valid digest", () => {
    expect(() =>
      parseModelManifest({
        ...validManifest,
        sha256: {
          ...validManifest.sha256,
          model: [validManifest.sha256.model],
        },
      }),
    ).toThrowError("MODEL_LOAD_FAILED");
  });

  it("verifies each bundle file below its extension-local model directory", async () => {
    const fetchImpl = vi.fn(async (input: string) => {
      const body = input.endsWith("model.onnx")
        ? "model"
        : input.endsWith("tokenizer.json")
          ? "tokenizer"
          : "config";
      return new Response(body, { status: 200 });
    });

    await expect(
      verifyModelBundle(
        parseModelManifest(validManifest),
        "chrome-extension://cleanfeed/models/",
        fetchImpl,
      ),
    ).resolves.toEqual(parseModelManifest(validManifest));

    expect(fetchImpl).toHaveBeenCalledWith(
      "chrome-extension://cleanfeed/models/cleanfeed-detector-v1/model.onnx",
      { redirect: "error" },
    );
  });

  it("rejects bundle fetches that leave their extension-local origin", async () => {
    const fetchImpl = vi.fn(async () => new Response("model", { status: 200 }));

    await expect(
      verifyModelBundle(
        parseModelManifest(validManifest),
        "https://models.example/",
        fetchImpl,
      ),
    ).rejects.toThrowError("MODEL_LOAD_FAILED");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("rejects a fetched artifact whose checksum differs from its manifest", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("tampered", { status: 200 }),
    );

    await expect(
      verifyModelBundle(
        parseModelManifest(validManifest),
        "chrome-extension://cleanfeed/models/",
        fetchImpl,
      ),
    ).rejects.toThrowError("MODEL_LOAD_FAILED");
  });

  it("rejects a redirected local artifact response", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      redirected: true,
      url: "",
      arrayBuffer: () => new Response("model").arrayBuffer(),
    }));

    await expect(
      verifyModelBundle(
        parseModelManifest(validManifest),
        "chrome-extension://cleanfeed/models/",
        fetchImpl,
      ),
    ).rejects.toThrowError("MODEL_LOAD_FAILED");
  });

  it("rejects a nonempty final URL outside the expected extension origin", async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      redirected: false,
      url: "chrome-extension://another-extension/models/cleanfeed-detector-v1/model.onnx",
      arrayBuffer: () => new Response("model").arrayBuffer(),
    }));

    await expect(
      verifyModelBundle(
        parseModelManifest(validManifest),
        "chrome-extension://cleanfeed/models/",
        fetchImpl,
      ),
    ).rejects.toThrowError("MODEL_LOAD_FAILED");
  });

  it("indexes only validated local manifests by id", () => {
    const manifest = parseModelManifest(validManifest);
    const catalog = new ModelCatalog([manifest]);

    expect(catalog.get(manifest.id)).toEqual(manifest);
    expect(catalog.list()).toEqual([manifest]);
    expect(() =>
      catalog.add({ ...validManifest, id: "../../escape" }),
    ).toThrowError("MODEL_LOAD_FAILED");
  });
});
