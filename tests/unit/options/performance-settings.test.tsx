import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { PerformanceSettings } from "@/options/components/PerformanceSettings";
import { DEFAULT_SETTINGS } from "@/shared/constants";

describe("PerformanceSettings", () => {
  afterEach(cleanup);

  it("only submits values within the documented performance limits", () => {
    const onUpdate = vi.fn();
    render(
      <PerformanceSettings settings={DEFAULT_SETTINGS} onUpdate={onUpdate} />,
    );

    fireEvent.change(screen.getByLabelText("Tamanho máximo da fila"), {
      target: { value: "501" },
    });
    fireEvent.change(screen.getByLabelText("Sobreposição de chunks"), {
      target: { value: "192" },
    });
    expect(onUpdate).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Concorrência WebGPU"), {
      target: { value: "3" },
    });
    fireEvent.change(screen.getByLabelText("Timeout de inferência (ms)"), {
      target: { value: "1000" },
    });
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
