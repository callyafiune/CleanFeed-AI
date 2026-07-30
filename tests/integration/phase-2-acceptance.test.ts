import { describe, expect, it, vi } from "vitest";

import { PipelineRunner } from "@/inference/inference-worker";
import { MockClassifier } from "@/inference/mock-classifier";
import { DEFAULT_SETTINGS } from "@/shared/constants";
import type {
  ClassificationOptions,
  ClassificationResult,
  TextClassifier,
} from "@/shared/types";

const PORTUGUESE_TEXT = Array.from(
  { length: 80 },
  () => "Esta publicação local explica uma decisão com clareza e contexto.",
).join(" ");

/** How much clock time each classifier call is made to consume. */
const INDUCED_INFERENCE_MS = 250;

/**
 * A classifier that spends a KNOWN amount of the clock the pipeline reads, and
 * counts how many times it was asked. The pipeline issues one call per chunk and
 * reports the wall time of the whole inference stage, so the value it must report
 * is the call count times the induced cost.
 */
function classifierWithInducedLatency(
  delegate: TextClassifier,
  advance: (ms: number) => void,
): TextClassifier & { calls: () => number } {
  let calls = 0;
  return {
    calls: () => calls,
    initialize: () => delegate.initialize(),
    classify: (
      text: string,
      options?: ClassificationOptions,
    ): Promise<ClassificationResult> => {
      calls += 1;
      advance(INDUCED_INFERENCE_MS);
      return delegate.classify(text, options);
    },
    dispose: () => delegate.dispose(),
    getMetadata: () => delegate.getMetadata(),
  };
}

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

  // FIDELITY, which the `expect.any(Number)` above cannot express: that assertion
  // passes for a stage that always reports 0, and until this test no assertion
  // anywhere in the suite required a reported duration to match a real one. The
  // clock that DECIDES was covered (the timeout test); the clock that REPORTS was
  // not — and its value is what feeds the LATENCY_BUCKET_BOUNDS histogram, the
  // local diagnostic and the PSI drift comparison.
  //
  // The clock is INJECTED, so the declared tolerance is exact: the induced cost is
  // spent in the same clock the pipeline reads, and no scheduler slack enters.
  it("reports the inference time it actually spent", async () => {
    let clock = 0;
    const now = vi.spyOn(performance, "now").mockImplementation(() => clock);
    const classifier = classifierWithInducedLatency(
      new MockClassifier(),
      (ms) => {
        clock += ms;
      },
    );
    const runner = new PipelineRunner({ classifier });

    const result = await runner.classify(
      { text: PORTUGUESE_TEXT, platform: "linkedin", manual: false },
      { ...DEFAULT_SETTINGS, debugMode: true },
    );

    expect(classifier.calls()).toBeGreaterThan(0);
    expect(result.stageTimings?.inferenceMs).toBe(
      classifier.calls() * INDUCED_INFERENCE_MS,
    );
    // The whole-request duration contains the inference stage it is made of.
    expect(result.processingTimeMs).toBeGreaterThanOrEqual(
      classifier.calls() * INDUCED_INFERENCE_MS,
    );
    now.mockRestore();
  });
});
