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
        failureDetail: "WASM_OOM",
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

// The failure detail is what turns 325 opaque INFERENCE_FAILED rows into a
// diagnosable population. It is optional in the shape so a scored or abstained
// row never carries it, and REQUIRED the moment a row claims status "error".
const errorRow = {
  ...valid,
  id: "post-err",
  status: "error",
  documentRawScore: null,
  localizedRawScore: null,
  evidenceQuality: "unsupported",
  reasonCode: "INFERENCE_FAILED",
  memoryBytes: null,
};

describe("prediction failureDetail", () => {
  it("requires a failure detail on an error row", () => {
    expect(() => parsePredictions(JSON.stringify(errorRow))).toThrow(
      /error prediction must carry a failureDetail/,
    );
  });

  it("accepts and preserves an allowlisted detail on an error row", () => {
    const [row] = parsePredictions(
      JSON.stringify({
        ...errorRow,
        failureDetail:
          "TOKEN_LIMIT_EXCEEDED: Model input exceeds the model token limit.",
      }),
    );

    expect(row?.failureDetail).toBe(
      "TOKEN_LIMIT_EXCEEDED: Model input exceeds the model token limit.",
    );
  });

  it("forbids a failure detail on a scored or abstained row", () => {
    expect(() =>
      parsePredictions(JSON.stringify({ ...valid, failureDetail: "WASM_OOM" })),
    ).toThrow(/failureDetail is only allowed when status is error/);
    expect(() =>
      parsePredictions(
        JSON.stringify({
          ...valid,
          status: "abstained",
          documentRawScore: null,
          localizedRawScore: null,
          evidenceQuality: "limited",
          reasonCode: "TEXT_TOO_SHORT",
          failureDetail: "WASM_OOM",
        }),
      ),
    ).toThrow(/failureDetail is only allowed when status is error/);
  });

  it("rejects document text smuggled into the failure detail", () => {
    expect(() =>
      parsePredictions(
        JSON.stringify({
          ...errorRow,
          failureDetail:
            "O réu foi absolvido por insuficiência de provas nos autos.",
        }),
      ),
    ).toThrow(/failureDetail must be an allowlisted sanitized detail/);
  });

  it("rejects a non-string and an over-long failure detail", () => {
    expect(() =>
      parsePredictions(JSON.stringify({ ...errorRow, failureDetail: 7 })),
    ).toThrow(/failureDetail must be an allowlisted sanitized detail/);
    expect(() =>
      parsePredictions(
        JSON.stringify({
          ...errorRow,
          failureDetail: `WASM_OOM${"!".repeat(160)}`,
        }),
      ),
    ).toThrow(/failureDetail must be an allowlisted sanitized detail/);
  });

  it("still parses a scored row that carries no detail at all", () => {
    const [row] = parsePredictions(JSON.stringify(valid));

    expect(row?.failureDetail).toBeUndefined();
    expect(Object.hasOwn(row ?? {}, "failureDetail")).toBe(false);
  });
});

const SHA = "a".repeat(64);

function validManifest() {
  return {
    schemaVersion: 1,
    modelId: "cleanfeed-ptbr-v1",
    modelVersion: "d8f77f870fbd35a17add2498b73d906bbc299026",
    bundleDigest: "b".repeat(64),
    aggregationVersion: "tmr-aggregation-v3",
    contentCompositionVersion: "lexical-content-v2",
    tokenizerDigest: "c".repeat(64),
    runtimeParityDigest: "d".repeat(64),
    extensionBuildDigest: "e".repeat(64),
    backend: "wasm",
    chromeVersion: RELEASE_CHROME_VERSION,
    datasetDigest: "f".repeat(64),
    splitDigest: "0".repeat(64),
    partition: "dev",
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
    expect(manifest.partition).toBe("dev");
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
        partition: "cal-A",
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
