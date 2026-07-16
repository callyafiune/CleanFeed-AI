import { describe, expect, it } from "vitest";

import { PipelineRunner } from "@/inference/inference-worker";
import { DEFAULT_SETTINGS } from "@/shared/constants";

const PORTUGUESE_TEXT = Array.from(
  { length: 80 },
  () => "Esta publicação local explica uma decisão com clareza e contexto.",
).join(" ");

describe("Phase 2 acceptance", () => {
  it("returns detailed performance timings only when debug mode is enabled", async () => {
    const runner = new PipelineRunner();
    const request = {
      text: PORTUGUESE_TEXT,
      platform: "linkedin",
      manual: false,
    };

    const normal = await runner.classify(request, DEFAULT_SETTINGS);
    const debug = await runner.classify(request, {
      ...DEFAULT_SETTINGS,
      debugMode: true,
    });

    expect(normal.stageTimings).toBeUndefined();
    expect(debug.stageTimings).toEqual(
      expect.objectContaining({
        languageMs: expect.any(Number),
        tokenizationMs: expect.any(Number),
        chunkingMs: expect.any(Number),
        inferenceMs: expect.any(Number),
        aggregationMs: expect.any(Number),
        calibrationMs: expect.any(Number),
      }),
    );
    expect(JSON.stringify(debug.stageTimings)).not.toContain(
      PORTUGUESE_TEXT.slice(0, 30),
    );
  });
});
