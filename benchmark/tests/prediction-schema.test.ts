import { describe, expect, it } from "vitest";

import {
  assertPredictionCompleteness,
  computePredictionManifestDigest,
  parsePredictionManifest,
  parsePredictions,
  RELEASE_CHROME_VERSION,
  validatePredictionShards,
} from "../prediction-schema.ts";

const valid = {
  schemaVersion: 1,
  id: "post-001",
  status: "scored",
  documentRawScore: 0.7,
  localizedRawScore: 0.8,
  evidenceQuality: "sufficient",
  reasonCode: "SCORED",
  coverage: 1,
  latencyMs: 120,
  memoryBytes: 10_000,
};

describe("predictions", () => {
  it("rejects scores outside the probability range", () => {
    expect(() =>
      parsePredictions(JSON.stringify({ ...valid, documentRawScore: 1.1 })),
    ).toThrow(/documentRawScore must be between 0 and 1/);
  });

  it("rejects duplicate ids instead of overwriting", () => {
    expect(() =>
      parsePredictions(`${JSON.stringify(valid)}\n${JSON.stringify(valid)}`),
    ).toThrow(/duplicate prediction id post-001/);
  });

  it("requires null scores and a reason for abstained or error records", () => {
    expect(() =>
      parsePredictions(
        JSON.stringify({
          ...valid,
          status: "abstained",
          reasonCode: "TOO_SHORT",
        }),
      ),
    ).toThrow(/scores must be null unless status is scored/);
    expect(() =>
      parsePredictions(
        JSON.stringify({
          ...valid,
          status: "error",
          documentRawScore: null,
          localizedRawScore: null,
          reasonCode: "",
        }),
      ),
    ).toThrow(/reasonCode must be a non-empty string/);
  });

  it("fails on missing and extra predictions", () => {
    expect(() =>
      assertPredictionCompleteness(["post-001", "post-002"], [valid]),
    ).toThrow(/missing=post-002/);
    expect(() =>
      assertPredictionCompleteness(
        ["post-001"],
        [valid, { ...valid, id: "extra" }],
      ),
    ).toThrow(/extra=extra/);
  });

  it("accepts a well-formed batch of mixed statuses without dropping any", () => {
    const jsonl = [
      JSON.stringify(valid),
      JSON.stringify({
        ...valid,
        id: "post-002",
        status: "abstained",
        documentRawScore: null,
        localizedRawScore: null,
        evidenceQuality: "limited",
        reasonCode: "TOO_SHORT",
      }),
      JSON.stringify({
        ...valid,
        id: "post-003",
        status: "error",
        documentRawScore: null,
        localizedRawScore: null,
        evidenceQuality: "unsupported",
        reasonCode: "RUNTIME_FAILURE",
        memoryBytes: null,
      }),
    ].join("\n");
    const rows = parsePredictions(jsonl);
    expect(rows.map((row) => row.id)).toEqual([
      "post-001",
      "post-002",
      "post-003",
    ]);
  });

  it("rejects an abstained prediction that still claims sufficient evidence", () => {
    expect(() =>
      parsePredictions(
        JSON.stringify({
          ...valid,
          status: "abstained",
          documentRawScore: null,
          localizedRawScore: null,
          evidenceQuality: "sufficient",
          reasonCode: "TOO_SHORT",
        }),
      ),
    ).toThrow(/abstained prediction cannot have sufficient evidence/);
  });

  it("rejects an unknown key on a prediction row", () => {
    expect(() =>
      parsePredictions(JSON.stringify({ ...valid, sneaky: true })),
    ).toThrow(/unknown key/);
  });

  it("rejects coverage outside the unit interval", () => {
    expect(() =>
      parsePredictions(JSON.stringify({ ...valid, coverage: 1.5 })),
    ).toThrow(/coverage must be between 0 and 1/);
  });
});

const SHA = "a".repeat(64);

function validManifest() {
  return {
    schemaVersion: 1,
    modelId: "tmr-ai-text-detector",
    modelVersion: "b9aa251e5bcda7e429fcc936767d921435945b60",
    bundleDigest: "b".repeat(64),
    aggregationVersion: "tmr-aggregation-v2",
    contentCompositionVersion: "lexical-content-v1",
    tokenizerDigest: "c".repeat(64),
    runtimeParityDigest: "d".repeat(64),
    extensionBuildDigest: "e".repeat(64),
    backend: "wasm",
    chromeVersion: RELEASE_CHROME_VERSION,
    datasetDigest: "f".repeat(64),
    splitDigest: "0".repeat(64),
    partition: "development",
    shardSize: 100,
    shardCount: 2,
    shards: [
      { index: 0, file: "shard-000.jsonl", sha256: SHA, recordCount: 100 },
      { index: 1, file: "shard-001.jsonl", sha256: SHA, recordCount: 37 },
    ],
    holdoutConsumptionId: null,
    createdAt: "2026-07-19T00:00:00.000Z",
  };
}

describe("prediction manifest", () => {
  it("parses a well-formed development manifest", () => {
    const manifest = parsePredictionManifest(validManifest());
    expect(manifest.partition).toBe("development");
    expect(manifest.holdoutConsumptionId).toBeNull();
  });

  it("rejects an unknown top-level key", () => {
    expect(() =>
      parsePredictionManifest({ ...validManifest(), extra: 1 }),
    ).toThrow(/unknown key/);
  });

  it("requires a null holdoutConsumptionId for development and calibration", () => {
    expect(() =>
      parsePredictionManifest({
        ...validManifest(),
        partition: "calibration",
        holdoutConsumptionId: "session-1",
      }),
    ).toThrow(/holdoutConsumptionId must be null/);
  });

  it("requires a session id for a test manifest", () => {
    expect(() =>
      parsePredictionManifest({
        ...validManifest(),
        partition: "test",
        holdoutConsumptionId: null,
      }),
    ).toThrow(/test manifest requires a holdoutConsumptionId/);
  });

  it("accepts a diagnostic chromeVersion but rejects it for release use", () => {
    const diagnostic = { ...validManifest(), chromeVersion: "149.0.0.1" };
    expect(parsePredictionManifest(diagnostic).chromeVersion).toBe("149.0.0.1");
    expect(() =>
      parsePredictionManifest(diagnostic, { scientificUse: "release" }),
    ).toThrow(/chromeVersion must equal/);
  });

  it("computes a stable digest that changes with the payload", async () => {
    const a = await computePredictionManifestDigest(
      parsePredictionManifest(validManifest()),
    );
    const b = await computePredictionManifestDigest(
      parsePredictionManifest(validManifest()),
    );
    expect(a).toBe(b);
    const c = await computePredictionManifestDigest(
      parsePredictionManifest({ ...validManifest(), shardCount: 2 }),
    );
    expect(c).toBe(a);
  });
});

describe("prediction shards", () => {
  it("accepts contiguous shards where only the last is under the shard size", () => {
    expect(() =>
      validatePredictionShards(parsePredictionManifest(validManifest())),
    ).not.toThrow();
  });

  it("rejects a non-contiguous shard index", () => {
    const manifest = validManifest();
    manifest.shards[1].index = 2;
    expect(() =>
      validatePredictionShards(parsePredictionManifest(manifest)),
    ).toThrow(/shard index/);
  });

  it("rejects a shard larger than the shard size", () => {
    const manifest = validManifest();
    manifest.shards[0].recordCount = 101;
    expect(() =>
      validatePredictionShards(parsePredictionManifest(manifest)),
    ).toThrow(/recordCount/);
  });

  it("rejects a non-final shard that is under the shard size", () => {
    const manifest = validManifest();
    manifest.shards[0].recordCount = 99;
    expect(() =>
      validatePredictionShards(parsePredictionManifest(manifest)),
    ).toThrow(/only the last shard/);
  });

  it("rejects a shard path that escapes with ..", () => {
    const manifest = validManifest();
    manifest.shards[0].file = "../secret.jsonl";
    expect(() => parsePredictionManifest(manifest)).toThrow(/shard file/);
  });
});
