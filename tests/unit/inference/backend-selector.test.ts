import { describe, expect, it, vi } from "vitest";

import {
  BackendSelector,
  ClassifierLifecycleManager,
} from "@/inference/backend-selector";
import type { TextClassifier } from "@/shared/types";

function classifier(backend: "wasm" | "webgpu"): TextClassifier {
  return {
    initialize: vi.fn().mockResolvedValue(undefined),
    classify: vi.fn(),
    dispose: vi.fn().mockResolvedValue(undefined),
    getMetadata: () => ({
      id: `cleanfeed-${backend}`,
      name: "CleanFeed",
      version: "1.0.0",
      backend,
      supportedLanguages: ["pt"],
      maximumTokens: 256,
      supportsBatching: false,
    }),
  };
}

describe("BackendSelector", () => {
  it("uses WASM when WebGPU is unavailable", async () => {
    const factory = { wasm: vi.fn(() => classifier("wasm")), webgpu: vi.fn() };
    const selector = new BackendSelector(factory);

    const result = await selector.initialize({
      preference: "auto",
      hasWebGpu: false,
    });

    expect(result.backend).toBe("wasm");
    expect(factory.webgpu).not.toHaveBeenCalled();
  });

  it("does not attempt WebGPU when WASM is explicitly selected", async () => {
    const factory = { wasm: vi.fn(() => classifier("wasm")), webgpu: vi.fn() };
    const selector = new BackendSelector(factory);

    await selector.initialize({ preference: "wasm", hasWebGpu: true });

    expect(factory.webgpu).not.toHaveBeenCalled();
    expect(factory.wasm).toHaveBeenCalledOnce();
  });

  it("warns when an explicit WebGPU selection must use WASM", async () => {
    const factory = { wasm: vi.fn(() => classifier("wasm")), webgpu: vi.fn() };
    const result = await new BackendSelector(factory).initialize({
      preference: "webgpu",
      hasWebGpu: false,
    });

    expect(result).toMatchObject({
      backend: "wasm",
      fallbackFrom: "webgpu",
      warning: "WEBGPU_FALLBACK",
    });
    expect(factory.webgpu).not.toHaveBeenCalled();
  });

  it("falls back exactly once when WebGPU initialization fails", async () => {
    const failed = classifier("webgpu");
    vi.mocked(failed.initialize).mockRejectedValue(new Error("adapter failed"));
    const factory = {
      webgpu: vi.fn(() => failed),
      wasm: vi.fn(() => classifier("wasm")),
    };
    const selector = new BackendSelector(factory);

    const result = await selector.initialize({
      preference: "auto",
      hasWebGpu: true,
    });

    expect(factory.webgpu).toHaveBeenCalledTimes(1);
    expect(factory.wasm).toHaveBeenCalledTimes(1);
    expect(failed.dispose).toHaveBeenCalledOnce();
    expect(result).toMatchObject({ backend: "wasm", fallbackFrom: "webgpu" });
  });

  it("reports unavailable when both backends fail", async () => {
    const gpu = classifier("webgpu");
    const wasm = classifier("wasm");
    vi.mocked(gpu.initialize).mockRejectedValue(new Error("gpu"));
    vi.mocked(wasm.initialize).mockRejectedValue(new Error("wasm"));
    const selector = new BackendSelector({
      webgpu: vi.fn(() => gpu),
      wasm: vi.fn(() => wasm),
    });

    await expect(
      selector.initialize({ preference: "auto", hasWebGpu: true }),
    ).rejects.toMatchObject({ code: "MODEL_LOAD_FAILED" });
    expect(gpu.dispose).toHaveBeenCalledOnce();
    expect(wasm.dispose).toHaveBeenCalledOnce();
  });

  it("serializes replacement so the previous session is disposed once", async () => {
    const first = classifier("wasm");
    const second = classifier("wasm");
    const lifecycle = new ClassifierLifecycleManager(
      new BackendSelector({
        wasm: vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second),
        webgpu: vi.fn(() => classifier("webgpu")),
      }),
    );

    await Promise.all([
      lifecycle.initialize({ preference: "wasm", hasWebGpu: false }),
      lifecycle.initialize({ preference: "wasm", hasWebGpu: false }),
    ]);

    expect(first.dispose).toHaveBeenCalledOnce();
    expect(lifecycle.getStatus()).toMatchObject({
      state: "ready",
      backend: "wasm",
    });
  });
});
