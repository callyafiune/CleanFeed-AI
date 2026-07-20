import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PerformanceSettings } from "@/options/components/PerformanceSettings";
import { DEFAULT_SETTINGS } from "@/shared/constants";

describe("PerformanceSettings", () => {
  afterEach(cleanup);

  it("accepts the 512-token window limits and rejects values outside them", () => {
    const onUpdate = vi.fn();
    render(
      <PerformanceSettings settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />,
    );

    // Out of range: queue above 500 and an overlap that is not below the chunk.
    fireEvent.change(screen.getByLabelText("Tamanho máximo da fila"), {
      target: { value: "501" },
    });
    fireEvent.change(screen.getByLabelText("Sobreposição de chunks"), {
      target: { value: "510" },
    });
    expect(onUpdate).not.toHaveBeenCalled();

    // In range: a 512-token chunk (the model capacity) and a below-chunk
    // overlap are now accepted (the default overlap is already 64).
    fireEvent.change(screen.getByLabelText("Tamanho do chunk"), {
      target: { value: "512" },
    });
    fireEvent.change(screen.getByLabelText("Sobreposição de chunks"), {
      target: { value: "128" },
    });
    fireEvent.change(screen.getByLabelText("Concorrência WebGPU"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Timeout de inferência (ms)"), {
      target: { value: "1000" },
    });
    expect(onUpdate).toHaveBeenCalledWith({ chunkSizeTokens: 512 });
    expect(onUpdate).toHaveBeenCalledWith({ chunkOverlapTokens: 128 });
    expect(onUpdate).toHaveBeenCalledWith({ webGpuConcurrency: 3 });
    expect(onUpdate).toHaveBeenCalledWith({ inferenceTimeoutMs: 1000 });
    expect(screen.getByLabelText("Concorrência WASM")).toHaveProperty(
      "disabled",
      true,
    );

    fireEvent.click(
      screen.getByLabelText("Incluir rastreamentos de depuração"),
    );
    expect(onUpdate).toHaveBeenCalledWith({ debugMode: true });
  });
});
