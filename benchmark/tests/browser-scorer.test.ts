import { describe, expect, it, vi } from "vitest";

import type { HoldoutConsumption } from "../holdout-ledger.ts";
import type {
  PredictionManifestV1,
  StrictPredictionV2,
} from "../prediction-schema.ts";
import {
  assertBenchmarkStatusMatchesRun,
  assertBrowserScoreRunConsumption,
  runBrowserScore,
  toPredictionRow,
  type BenchmarkPage,
  type BrowserScoreRun,
  type ModelBenchmarkScoreV1,
  type ModelBenchmarkStatusV1,
  type PredictionShardStore,
} from "../browser-scorer.ts";

function hex(label: string): string {
  let out = "";
  for (const ch of label) out += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return out.padEnd(64, "0").slice(0, 64);
}

function devRun(overrides: Partial<BrowserScoreRun> = {}): BrowserScoreRun {
  return {
    schemaVersion: 1,
    runId: "run-development-0001",
    datasetDigest: hex("dataset"),
    splitDigest: hex("split"),
    partition: "dev",
    modelId: "cleanfeed-ptbr-v1",
    modelVersion: "1.0.0",
    bundleDigest: hex("bundle"),
    aggregationVersion: "tmr-aggregation-v3",
    contentCompositionVersion: "lexical-content-v2",
    tokenizerDigest: hex("tokenizer"),
    runtimeParityDigest: hex("parity"),
    extensionBuildDigest: hex("build"),
    chromeVersion: "150.0.7871.129",
    backend: "wasm",
    holdoutConsumptionId: null,
    shardSize: 100,
    ...overrides,
  };
}

function statusFor(
  run: BrowserScoreRun,
  overrides: Partial<ModelBenchmarkStatusV1> = {},
): ModelBenchmarkStatusV1 {
  return {
    schemaVersion: 1,
    state: "ready",
    modelId: run.modelId,
    modelVersion: run.modelVersion,
    bundleDigest: run.bundleDigest,
    aggregationVersion: run.aggregationVersion,
    contentCompositionVersion: run.contentCompositionVersion,
    tokenizerDigest: run.tokenizerDigest,
    runtimeParityDigest: run.runtimeParityDigest,
    backend: "wasm",
    exactTokenizer: true,
    errorCode: null,
    ...overrides,
  };
}

function scored(
  overrides: Partial<ModelBenchmarkScoreV1> = {},
): ModelBenchmarkScoreV1 {
  return {
    status: "scored",
    documentRawScore: 0.6,
    localizedRawScore: 0.7,
    evidenceQuality: "sufficient",
    reasonCode: "SCORED",
    coverage: 1,
    latencyMs: 25,
    memoryBytes: 1000,
    ...overrides,
  };
}

function testConsumption(id: string): HoldoutConsumption {
  return {
    schemaVersion: 1,
    consumptionId: id,
    startedAt: "2026-07-19T00:00:00.000Z",
    terminalAt: null,
    status: "started",
    reportDigest: null,
    failureCode: null,
    datasetDigest: hex("dataset"),
    datasetAuditDigest: hex("audit"),
    sourceReadinessDigest: hex("readiness"),
    splitDigest: hex("split"),
    modelId: "cleanfeed-ptbr-v1",
    modelVersion: "1.0.0",
    bundleDigest: hex("bundle"),
    aggregationVersion: "tmr-aggregation-v3",
    contentCompositionVersion: "lexical-content-v2",
    tokenizerDigest: hex("tokenizer"),
    runtimeParityDigest: hex("parity"),
    extensionBuildDigest: hex("build"),
    backend: "wasm",
    chromeVersion: "150.0.7871.129",
    evaluatorDigest: hex("evaluator"),
    calibrationArtifactDigest: hex("calibration"),
  };
}

/** A minimal in-memory store that records writes and never touches disk. */
class FakeShardStore implements PredictionShardStore {
  opened: BrowserScoreRun | null = null;
  readonly writes = new Map<number, StrictPredictionV2[]>();
  finalizedWith: readonly string[] | null = null;
  constructor(private readonly preCompleted: ReadonlySet<string> = new Set()) {}
  open(run: BrowserScoreRun): Promise<void> {
    this.opened = run;
    return Promise.resolve();
  }
  completedIds(): Promise<ReadonlySet<string>> {
    return Promise.resolve(this.preCompleted);
  }
  writeAtomic(
    index: number,
    rows: readonly StrictPredictionV2[],
  ): Promise<void> {
    this.writes.set(index, [...rows]);
    return Promise.resolve();
  }
  finalize(expectedIds: readonly string[]): Promise<PredictionManifestV1> {
    this.finalizedWith = expectedIds;
    const manifest: PredictionManifestV1 = {
      schemaVersion: 1,
      modelId: this.opened!.modelId,
      modelVersion: this.opened!.modelVersion,
      bundleDigest: this.opened!.bundleDigest,
      aggregationVersion: this.opened!.aggregationVersion,
      contentCompositionVersion: this.opened!.contentCompositionVersion,
      tokenizerDigest: this.opened!.tokenizerDigest,
      runtimeParityDigest: this.opened!.runtimeParityDigest,
      extensionBuildDigest: this.opened!.extensionBuildDigest,
      backend: "wasm",
      chromeVersion: this.opened!.chromeVersion,
      datasetDigest: this.opened!.datasetDigest,
      splitDigest: this.opened!.splitDigest,
      partition: this.opened!.partition,
      shardSize: 100,
      shardCount: this.writes.size,
      shards: [],
      holdoutConsumptionId: this.opened!.holdoutConsumptionId,
      createdAt: "2026-07-19T00:00:00.000Z",
    };
    return Promise.resolve(manifest);
  }
}

function pageFrom(
  run: BrowserScoreRun,
  statusOverrides: Partial<ModelBenchmarkStatusV1> = {},
): BenchmarkPage & { scoreCalls: number } {
  const page = {
    scoreCalls: 0,
    status(): Promise<ModelBenchmarkStatusV1> {
      return Promise.resolve(statusFor(run, statusOverrides));
    },
    score(): Promise<ModelBenchmarkScoreV1> {
      page.scoreCalls += 1;
      return Promise.resolve(scored());
    },
  };
  return page;
}

describe("assertBenchmarkStatusMatchesRun", () => {
  it("accepts a status that matches every identity and parity field", () => {
    const run = devRun();
    expect(() =>
      assertBenchmarkStatusMatchesRun(statusFor(run), run),
    ).not.toThrow();
  });

  it("rejects a backend the run did not declare", () => {
    // O backend faz parte da identidade da corrida: uma pagina que pontuou em `webgpu` nao pode
    // reportar resultado para uma corrida declarada `wasm`, porque o numero nao e comparavel.
    //
    // Os DOIS lados sao tipados como o literal `"wasm"`, entao esta divergencia nao existe em
    // programa tipado — e a guarda nao e redundante por isso. O `status` atravessa a fronteira
    // de uma PAGINA do navegador, onde o tipo nao amarra nada, e e contra esse produtor que ela
    // vale. A coercao abaixo modela esse payload de fora, no mesmo idioma que
    // `prediction-shards.test.ts` usa para uma linha com campo proibido.
    const run = devRun();
    let capturado: unknown;
    try {
      assertBenchmarkStatusMatchesRun(
        statusFor(run, { backend: "webgpu" } as never),
        run,
      );
    } catch (erro) {
      capturado = erro;
    }
    expect(capturado).toMatchObject({ code: "SCORER_BACKEND_MISMATCH" });
  });

  it("rejects a runtime-parity digest mismatch (embedded vs emitted)", () => {
    const run = devRun();
    expect(() =>
      assertBenchmarkStatusMatchesRun(
        statusFor(run, { runtimeParityDigest: hex("other-parity") }),
        run,
      ),
    ).toThrow(/SCORER_PARITY_MISMATCH/u);
  });

  it("rejects a model identity mismatch", () => {
    const run = devRun();
    expect(() =>
      assertBenchmarkStatusMatchesRun(
        statusFor(run, { modelVersion: "9.9.9" }),
        run,
      ),
    ).toThrow(/SCORER_IDENTITY_MISMATCH/u);
  });

  it("rejects a non-ready or inexact-tokenizer status", () => {
    const run = devRun();
    expect(() =>
      assertBenchmarkStatusMatchesRun(
        statusFor(run, {
          state: "failed",
          errorCode: "MODEL_ARTIFACT_MISSING",
        }),
        run,
      ),
    ).toThrow(/SCORER_NOT_READY/u);
    expect(() =>
      assertBenchmarkStatusMatchesRun(
        statusFor(run, { exactTokenizer: false }),
        run,
      ),
    ).toThrow(/SCORER_INEXACT_TOKENIZER/u);
  });
});

describe("assertBrowserScoreRunConsumption", () => {
  it("allows development/calibration with a null consumption", () => {
    expect(() =>
      assertBrowserScoreRunConsumption(devRun(), null),
    ).not.toThrow();
    expect(() =>
      assertBrowserScoreRunConsumption(
        devRun({ partition: "cal-A" }),
        undefined,
      ),
    ).not.toThrow();
  });

  it("forbids a consumption for development/calibration", () => {
    expect(() =>
      assertBrowserScoreRunConsumption(devRun(), testConsumption("abc")),
    ).toThrow(/SCORE_RUN_FORBIDS_CONSUMPTION/u);
  });

  it("requires an active consumption for the test partition", () => {
    const run = devRun({
      partition: "test",
      runId: "sess-1",
      holdoutConsumptionId: "sess-1",
    });
    expect(() => assertBrowserScoreRunConsumption(run, null)).toThrow(
      /HOLDOUT_CONSUMPTION_REQUIRED/u,
    );
  });

  it("rejects a test run whose id diverges from the consumption id", () => {
    const run = devRun({
      partition: "test",
      runId: "sess-1",
      holdoutConsumptionId: "sess-1",
    });
    expect(() =>
      assertBrowserScoreRunConsumption(run, testConsumption("sess-2")),
    ).toThrow(/HOLDOUT_CONSUMPTION_MISMATCH/u);
  });

  it("accepts a test run bound to the matching started consumption", () => {
    const run = devRun({
      partition: "test",
      runId: "sess-1",
      holdoutConsumptionId: "sess-1",
    });
    expect(() =>
      assertBrowserScoreRunConsumption(run, testConsumption("sess-1")),
    ).not.toThrow();
  });
});

describe("toPredictionRow", () => {
  it("maps a page score to a strict v2 row carrying only the opaque id and outcome", () => {
    const row = toPredictionRow("post-42", scored());
    expect(Object.keys(row).sort()).toEqual(
      [
        "coverage",
        "documentRawScore",
        "evidenceQuality",
        "id",
        "latencyMs",
        "localizedRawScore",
        "memoryBytes",
        "reasonCode",
        "schemaVersion",
        "status",
      ].sort(),
    );
    expect(row.id).toBe("post-42");
    expect(row.schemaVersion).toBe(2);
  });

  it("carries the sanitized failure detail through for an error outcome", () => {
    const row = toPredictionRow("post-43", {
      status: "error",
      documentRawScore: null,
      localizedRawScore: null,
      evidenceQuality: "unsupported",
      reasonCode: "INFERENCE_FAILED",
      failureDetail: "WASM_OOM",
      coverage: 0,
      latencyMs: 5,
      memoryBytes: null,
    });

    expect(row.failureDetail).toBe("WASM_OOM");
  });
});

describe("runBrowserScore", () => {
  it("scores every item, mapping page responses to strict rows and 100-id shards", async () => {
    const run = devRun();
    const items = Array.from({ length: 150 }, (_unused, index) => ({
      id: `post-${String(index).padStart(4, "0")}`,
      text: `Texto de exemplo ${index}`,
    }));
    const store = new FakeShardStore();
    const page = pageFrom(run);
    const manifest = await runBrowserScore({ run, page, store, items });
    expect(store.opened).toEqual(run);
    expect(store.writes.size).toBe(2);
    expect(store.writes.get(0)?.length).toBe(100);
    expect(store.writes.get(1)?.length).toBe(50);
    expect(page.scoreCalls).toBe(150);
    expect(manifest.partition).toBe("dev");
    expect(store.finalizedWith).toEqual(items.map((item) => item.id));
  });

  it("never recomputes ids already committed to a shard on resume", async () => {
    const run = devRun();
    const items = Array.from({ length: 150 }, (_unused, index) => ({
      id: `post-${String(index).padStart(4, "0")}`,
      text: `Texto ${index}`,
    }));
    const completed = new Set(items.slice(0, 100).map((item) => item.id));
    const store = new FakeShardStore(completed);
    const page = pageFrom(run);
    await runBrowserScore({ run, page, store, items });
    // Shard 0 is fully committed; only the 50 remaining ids are re-scored.
    expect(page.scoreCalls).toBe(50);
    expect(store.writes.has(0)).toBe(false);
    expect(store.writes.get(1)?.length).toBe(50);
  });

  it("refuses to send any corpus text when the parity digest diverges", async () => {
    const run = devRun();
    const store = new FakeShardStore();
    const page = pageFrom(run, { runtimeParityDigest: hex("wrong") });
    const scoreSpy = vi.spyOn(page, "score");
    await expect(
      runBrowserScore({
        run,
        page,
        store,
        items: [{ id: "post-0001", text: "abc" }],
      }),
    ).rejects.toThrow(/SCORER_PARITY_MISMATCH/u);
    expect(scoreSpy).not.toHaveBeenCalled();
  });

  it("fails closed on a non-ready page and never fabricates a score", async () => {
    const run = devRun();
    const store = new FakeShardStore();
    const page = pageFrom(run, {
      state: "failed",
      errorCode: "MODEL_ASSET_CORRUPTED",
    });
    await expect(
      runBrowserScore({
        run,
        page,
        store,
        items: [{ id: "post-0001", text: "abc" }],
      }),
    ).rejects.toThrow(/SCORER_NOT_READY/u);
  });
});
