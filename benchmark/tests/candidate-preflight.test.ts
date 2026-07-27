import { describe, expect, it } from "vitest";

import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import type { SerializedCalibratorV1 } from "../../contracts/calibration-profile.ts";
import {
  computeSourceReadinessDigest,
  type CorpusSourceReadinessReport,
} from "../../contracts/source-readiness.ts";
import {
  computeRuntimeParityDigest,
  type RuntimeParityManifestV1,
} from "../../contracts/runtime-parity.ts";
import type { FrozenCalibrationArtifact } from "../calibration-pipeline.ts";
import {
  buildFitReport,
  CandidatePreflightError,
  runCandidatePreflight,
  verifyFrozenAgainstPreflight,
  type CandidatePreflightInput,
} from "../candidate-preflight.ts";
import {
  computeDatasetAuditDigest,
  type DatasetAudit,
  type DatasetManifest,
} from "../dataset-manifest.ts";
import { sha256BytesHex } from "../digests.ts";
import {
  computePredictionManifestDigest,
  parsePredictionManifest,
  RELEASE_CHROME_VERSION,
  type PredictionManifestV1,
} from "../prediction-schema.ts";
import type { SplitArtifact } from "../split-artifact.ts";
import { asGeneratorFamily } from "../generator-family.ts";

// ---------------------------------------------------------------------------
// Shared identity fixtures. Every digest is COMPUTED so the preflight's own
// recomputation matches exactly; nothing is a hand-typed hash a caller forges.
// ---------------------------------------------------------------------------

const DATASET_ID = "ptbr-generic-v1";
const MODEL_ID = "cleanfeed-ptbr-v1";
const MODEL_VERSION = "d8f77f870fbd35a17add2498b73d906bbc299026";
const BUNDLE_DIGEST = "b".repeat(64);
const TOKENIZER_DIGEST = "c".repeat(64);
const EXTENSION_BUILD_DIGEST = "e".repeat(64);
const DATASET_DIGEST = "f".repeat(64);
const SPLIT_DIGEST = "0".repeat(64);
const INFERENCE_CORE_DIGEST = "1".repeat(64);
const RECORDS_SHA = "d".repeat(64);
const REVIEW_LEDGER_SHA = "9".repeat(64);
const EVALUATOR_DIGEST = "2".repeat(64);
const AGGREGATION_VERSION = "tmr-aggregation-v3";
const CONTENT_COMPOSITION_VERSION = "lexical-content-v1";
const TWENTY_GIB = 20 * 1024 ** 3;

const sourceManifestBase = {
  schemaVersion: 1,
  corpus: DATASET_ID,
  note: "fixture source manifest",
};
const SOURCE_MANIFEST_DIGEST = await canonicalSha256(sourceManifestBase);
const SOURCE_MANIFEST_BYTES = JSON.stringify({
  ...sourceManifestBase,
  sourceManifestDigest: SOURCE_MANIFEST_DIGEST,
});
const SOURCE_MANIFEST_SHA = sha256BytesHex(
  new TextEncoder().encode(SOURCE_MANIFEST_BYTES),
);

const datasetManifest: DatasetManifest = {
  schemaVersion: 1,
  datasetId: DATASET_ID,
  version: "1.0.0",
  scientificUse: "release",
  intendedLanguage: "pt-BR",
  intendedDomain: "generic",
  createdAt: "2026-07-19T00:00:00.000Z",
  normalizationVersion: "cleanfeed-text-v1",
  annotationProtocolVersion: "annotation-v1",
  recordsFile: "records.jsonl",
  recordsSha256: RECORDS_SHA,
  reviewLedgerFile: "private/review-ledger.jsonl",
  reviewLedgerSha256: REVIEW_LEDGER_SHA,
  sourceManifestFile: "private/source-manifest.json",
  sourceManifestSha256: SOURCE_MANIFEST_SHA,
  heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
  licenses: [
    {
      id: "consent-v1",
      name: "Authorized contribution",
      source: "fixture://consent",
      evaluationUseApproved: true,
      redistribution: "not-published",
      notice: "Contributed under explicit consent; raw text stays local.",
    },
  ],
};

async function buildAudit(
  overrides: Partial<Omit<DatasetAudit, "auditDigest">> = {},
): Promise<DatasetAudit> {
  const base: Omit<DatasetAudit, "auditDigest"> = {
    datasetId: DATASET_ID,
    scientificUse: "release",
    releaseEligible: true,
    recordCount: 10_000,
    counts: { human: 4_000, ai: 4_000, mixed: 2_000 },
    sourceTypes: { "qa-informal": 1 },
    hardNegativeFamilies: { formulaic: 1 },
    generatorFamilies: { acme_family: 1 },
    licenses: ["consent-v1"],
    recordsSha256: RECORDS_SHA,
    reviewLedgerSha256: REVIEW_LEDGER_SHA,
    sourceManifestSha256: SOURCE_MANIFEST_SHA,
    sealed: true,
    ...overrides,
  };
  return { ...base, auditDigest: await computeDatasetAuditDigest(base) };
}

async function buildReadiness(): Promise<CorpusSourceReadinessReport> {
  const base = {
    schemaVersion: 1 as const,
    status: "ready" as const,
    sourceManifestDigest: SOURCE_MANIFEST_DIGEST,
    recordCount: 10_000,
    sourceCount: 3,
    acquisitionCounts: { consent: 4_000, licensed: 4_000, generated: 2_000 },
    protocols: {
      corpus: "corpus-v1" as const,
      collection: "collection-v1" as const,
      annotation: "annotation-v1" as const,
      generation: "generation-v1" as const,
      pii: "pii-review-v1" as const,
    },
    blockingReasons: [],
  };
  return { ...base, reportDigest: await computeSourceReadinessDigest(base) };
}

async function buildRuntimeParity(): Promise<RuntimeParityManifestV1> {
  const base = {
    schemaVersion: 1 as const,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: BUNDLE_DIGEST,
    aggregationVersion: AGGREGATION_VERSION,
    contentCompositionVersion: CONTENT_COMPOSITION_VERSION,
    tokenizerDigest: TOKENIZER_DIGEST,
    inferenceCoreDigest: INFERENCE_CORE_DIGEST,
  };
  return {
    ...base,
    runtimeParityDigest: await computeRuntimeParityDigest(base),
  };
}

const RUNTIME_PARITY = await buildRuntimeParity();
const DATASET_AUDIT = await buildAudit();
const SOURCE_READINESS = await buildReadiness();

function makeManifest(
  partition: "development" | "calibration" | "test",
  overrides: Record<string, unknown> = {},
): PredictionManifestV1 {
  return parsePredictionManifest({
    schemaVersion: 1,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: BUNDLE_DIGEST,
    aggregationVersion: AGGREGATION_VERSION,
    contentCompositionVersion: CONTENT_COMPOSITION_VERSION,
    tokenizerDigest: TOKENIZER_DIGEST,
    runtimeParityDigest: RUNTIME_PARITY.runtimeParityDigest,
    extensionBuildDigest: EXTENSION_BUILD_DIGEST,
    backend: "wasm",
    chromeVersion: RELEASE_CHROME_VERSION,
    datasetDigest: DATASET_DIGEST,
    splitDigest: SPLIT_DIGEST,
    partition,
    shardSize: 100,
    shardCount: 0,
    shards: [],
    holdoutConsumptionId: partition === "test" ? "session-1" : null,
    createdAt: "2026-07-19T00:00:00.000Z",
    ...overrides,
  });
}

const developmentManifest = makeManifest("development");
const calibrationManifest = makeManifest("calibration");
const DEV_DIGEST = await computePredictionManifestDigest(developmentManifest);
const CAL_DIGEST = await computePredictionManifestDigest(calibrationManifest);

// A split artifact whose only preflight-relevant surface is the assignment set
// (for coverage) and the leakage audit's verdict.
function makeSplit(
  nonTest: readonly string[],
  test: readonly string[],
  passed = true,
): SplitArtifact {
  const assignments = [
    ...nonTest.map((id, index) => ({
      id,
      partition: index % 2 === 0 ? "development" : "calibration",
    })),
    ...test.map((id) => ({ id, partition: "test" })),
  ];
  return { assignments, audit: { passed } } as unknown as SplitArtifact;
}

async function baseInput(
  overrides: Partial<CandidatePreflightInput> = {},
): Promise<CandidatePreflightInput> {
  return {
    datasetManifest,
    datasetAudit: DATASET_AUDIT,
    sourceReadiness: SOURCE_READINESS,
    runtimeParity: RUNTIME_PARITY,
    sourceManifestBytes: SOURCE_MANIFEST_BYTES,
    splitArtifact: makeSplit(
      ["dev-1", "dev-2", "cal-1", "cal-2"],
      ["test-1", "test-2"],
    ),
    developmentManifest,
    developmentManifestDigest: DEV_DIGEST,
    calibrationManifest,
    calibrationManifestDigest: CAL_DIGEST,
    developmentPredictionIds: ["dev-1", "dev-2"],
    calibrationPredictionIds: ["cal-1", "cal-2"],
    freeDiskBytes: 25 * 1024 ** 3,
    ...overrides,
  };
}

const PLATT: SerializedCalibratorV1 = {
  kind: "platt",
  slope: 2,
  intercept: -1,
};

async function buildFrozen(): Promise<FrozenCalibrationArtifact> {
  const base: Omit<FrozenCalibrationArtifact, "artifactDigest"> = {
    schemaVersion: 1,
    model: {
      modelId: MODEL_ID,
      modelVersion: MODEL_VERSION,
      bundleDigest: BUNDLE_DIGEST,
      tokenizerDigest: TOKENIZER_DIGEST,
      aggregationVersion: AGGREGATION_VERSION,
      contentCompositionVersion: CONTENT_COMPOSITION_VERSION,
    },
    scoringRuntime: {
      runtimeParityDigest: RUNTIME_PARITY.runtimeParityDigest,
      extensionBuildDigest: EXTENSION_BUILD_DIGEST,
      backend: "wasm",
      chromeVersion: RELEASE_CHROME_VERSION,
    },
    predictionManifestDigests: {
      development: DEV_DIGEST,
      calibration: CAL_DIGEST,
    },
    datasetDigest: DATASET_DIGEST,
    datasetAuditDigest: DATASET_AUDIT.auditDigest,
    sourceReadinessDigest: SOURCE_READINESS.reportDigest,
    splitDigest: SPLIT_DIGEST,
    evaluatorDigest: EVALUATOR_DIGEST,
    partitionsUsed: ["development", "calibration"],
    calibrators: { document: PLATT, localized: PLATT },
    selectionEvidence: { document: [], localized: [] },
    thresholds: {
      warningDocument: 0.5,
      warningLocalized: 0.5,
      visualDocument: 0.8,
    },
    thresholdEvidence: {
      warning: {
        documentThreshold: 0.5,
        localizedThreshold: 0.5,
        negatives: 70,
        falsePositives: 0,
        fprUpper95: 0.037,
        positives: 20,
        truePositives: 20,
        recall: 1,
      },
      visual: null,
    },
    fitSeed: 712019,
  };
  return { ...base, artifactDigest: await canonicalSha256(base) };
}

// ---------------------------------------------------------------------------

describe("runCandidatePreflight — ready report", () => {
  it("produces a ready report carrying the exact governance and prediction digests", async () => {
    const report = runCandidatePreflight(await baseInput());
    expect(report.status).toBe("ready");
    expect(report.blockingReasons).toEqual([]);
    expect(report.datasetDigest).toBe(DATASET_DIGEST);
    expect(report.datasetAuditDigest).toBe(DATASET_AUDIT.auditDigest);
    expect(report.sourceReadinessDigest).toBe(SOURCE_READINESS.reportDigest);
    expect(report.splitDigest).toBe(SPLIT_DIGEST);
    expect(report.developmentPredictionManifestDigest).toBe(DEV_DIGEST);
    expect(report.calibrationPredictionManifestDigest).toBe(CAL_DIGEST);
    expect(report.freeDiskBytes).toBe(25 * 1024 ** 3);
    expect(report.model).toEqual({
      modelId: MODEL_ID,
      modelVersion: MODEL_VERSION,
      bundleDigest: BUNDLE_DIGEST,
      aggregationVersion: AGGREGATION_VERSION,
      contentCompositionVersion: CONTENT_COMPOSITION_VERSION,
      tokenizerDigest: TOKENIZER_DIGEST,
      runtimeParityDigest: RUNTIME_PARITY.runtimeParityDigest,
      extensionBuildDigest: EXTENSION_BUILD_DIGEST,
      backend: "wasm",
      chromeVersion: RELEASE_CHROME_VERSION,
    });
  });

  it("treats exactly 20 GiB as sufficient and below-threshold as blocking", async () => {
    const exact = runCandidatePreflight(
      await baseInput({ freeDiskBytes: TWENTY_GIB }),
    );
    expect(exact.status).toBe("ready");

    const low = runCandidatePreflight(
      await baseInput({ freeDiskBytes: TWENTY_GIB - 1 }),
    );
    expect(low.status).toBe("blocked");
    expect(low.blockingReasons.join(" ")).toMatch(/disk|GiB/i);
    // The reported number still reflects what was measured.
    expect(low.freeDiskBytes).toBe(TWENTY_GIB - 1);
  });
});

describe("runCandidatePreflight — blocking reasons", () => {
  it("blocks a WebGPU (non-WASM) candidate manifest", async () => {
    const webgpu = parsePredictionManifest({
      schemaVersion: 1,
      modelId: MODEL_ID,
      modelVersion: MODEL_VERSION,
      bundleDigest: BUNDLE_DIGEST,
      aggregationVersion: AGGREGATION_VERSION,
      contentCompositionVersion: CONTENT_COMPOSITION_VERSION,
      tokenizerDigest: TOKENIZER_DIGEST,
      runtimeParityDigest: RUNTIME_PARITY.runtimeParityDigest,
      extensionBuildDigest: EXTENSION_BUILD_DIGEST,
      backend: "webgpu",
      chromeVersion: RELEASE_CHROME_VERSION,
      datasetDigest: DATASET_DIGEST,
      splitDigest: SPLIT_DIGEST,
      partition: "calibration",
      shardSize: 100,
      shardCount: 0,
      shards: [],
      holdoutConsumptionId: null,
      createdAt: "2026-07-19T00:00:00.000Z",
    });
    const report = runCandidatePreflight(
      await baseInput({
        calibrationManifest: webgpu,
        calibrationManifestDigest:
          await computePredictionManifestDigest(webgpu),
      }),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons.join(" ")).toMatch(/wasm|backend/i);
  });

  it("blocks a test-partition manifest smuggled in as calibration (no test prediction input)", async () => {
    const test = makeManifest("test");
    const report = runCandidatePreflight(
      await baseInput({
        calibrationManifest: test,
        calibrationManifestDigest: await computePredictionManifestDigest(test),
      }),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons.join(" ")).toMatch(/test|partition/i);
  });

  it("blocks a source readiness report that is not ready", async () => {
    const blocked = {
      ...SOURCE_READINESS,
      status: "blocked",
    } as CorpusSourceReadinessReport;
    const report = runCandidatePreflight(
      await baseInput({ sourceReadiness: blocked }),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons.join(" ")).toMatch(/ready/i);
  });

  it("blocks an unsealed and a tampered dataset audit", async () => {
    const unsealed = runCandidatePreflight(
      await baseInput({
        datasetAudit: {
          ...DATASET_AUDIT,
          sealed: false,
        } as unknown as DatasetAudit,
      }),
    );
    expect(unsealed.status).toBe("blocked");
    expect(unsealed.blockingReasons.join(" ")).toMatch(/seal/i);

    const tampered = runCandidatePreflight(
      await baseInput({
        datasetAudit: { ...DATASET_AUDIT, auditDigest: "0".repeat(64) },
      }),
    );
    expect(tampered.status).toBe("blocked");
    expect(tampered.blockingReasons.join(" ")).toMatch(/audit/i);
  });

  it("blocks a prediction manifest digest that does not match", async () => {
    const report = runCandidatePreflight(
      await baseInput({ developmentManifestDigest: "0".repeat(64) }),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons.join(" ")).toMatch(/digest/i);
  });

  it("blocks divergent identity between the two candidate manifests", async () => {
    const diverging = makeManifest("calibration", {
      bundleDigest: "a".repeat(64),
    });
    const report = runCandidatePreflight(
      await baseInput({
        calibrationManifest: diverging,
        calibrationManifestDigest:
          await computePredictionManifestDigest(diverging),
      }),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons.join(" ")).toMatch(/diverge|identity/i);
  });

  it("blocks incomplete, extra and colliding prediction coverage", async () => {
    const missing = runCandidatePreflight(
      await baseInput({ calibrationPredictionIds: ["cal-1"] }),
    );
    expect(missing.status).toBe("blocked");
    expect(missing.blockingReasons.join(" ")).toMatch(/coverage|missing/i);

    // A test id present in a prediction set is an "extra" — and proves no test
    // prediction is ever accepted as fit input.
    const extra = runCandidatePreflight(
      await baseInput({
        developmentPredictionIds: ["dev-1", "dev-2", "test-1"],
      }),
    );
    expect(extra.status).toBe("blocked");
    expect(extra.blockingReasons.join(" ")).toMatch(/coverage|extra|test/i);

    const collision = runCandidatePreflight(
      await baseInput({
        developmentPredictionIds: ["dev-1", "dev-2", "cal-1"],
      }),
    );
    expect(collision.status).toBe("blocked");
    expect(collision.blockingReasons.join(" ")).toMatch(
      /collision|coverage|duplicate/i,
    );
  });

  it("blocks source manifest bytes that do not match the sealed raw SHA", async () => {
    const report = runCandidatePreflight(
      await baseInput({ sourceManifestBytes: `${SOURCE_MANIFEST_BYTES} ` }),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons.join(" ")).toMatch(/source manifest/i);
  });

  it("blocks a split artifact whose leakage audit did not pass", async () => {
    const report = runCandidatePreflight(
      await baseInput({
        splitArtifact: makeSplit(
          ["dev-1", "dev-2", "cal-1", "cal-2"],
          ["test-1", "test-2"],
          false,
        ),
      }),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons.join(" ")).toMatch(/audit|leak|split/i);
  });
});

describe("verifyFrozenAgainstPreflight", () => {
  it("accepts a frozen artifact whose bound digests match the ready report", async () => {
    const report = runCandidatePreflight(await baseInput());
    const frozen = await buildFrozen();
    expect(() => verifyFrozenAgainstPreflight(frozen, report)).not.toThrow();
  });

  it("rejects any drift between the frozen artifact and the report", async () => {
    const report = runCandidatePreflight(await baseInput());
    const frozen = await buildFrozen();

    expect(() =>
      verifyFrozenAgainstPreflight(
        { ...frozen, datasetAuditDigest: "0".repeat(64) },
        report,
      ),
    ).toThrow(CandidatePreflightError);
    expect(() =>
      verifyFrozenAgainstPreflight(
        { ...frozen, sourceReadinessDigest: "0".repeat(64) },
        report,
      ),
    ).toThrow(/source readiness|match/i);
    expect(() =>
      verifyFrozenAgainstPreflight(
        {
          ...frozen,
          predictionManifestDigests: {
            ...frozen.predictionManifestDigests,
            calibration: "0".repeat(64),
          },
        },
        report,
      ),
    ).toThrow(/prediction|match/i);
    expect(() =>
      verifyFrozenAgainstPreflight(
        {
          ...frozen,
          scoringRuntime: {
            ...frozen.scoringRuntime,
            runtimeParityDigest: "0".repeat(64),
          },
        },
        report,
      ),
    ).toThrow(/parity|runtime|match/i);
  });
});

describe("buildFitReport", () => {
  it("carries the ready preflight, calibration digest and thresholds with no test metric", async () => {
    const report = runCandidatePreflight(await baseInput());
    const frozen = await buildFrozen();
    const fitReport = buildFitReport(report, frozen);

    expect(fitReport.preflight.status).toBe("ready");
    expect(fitReport.calibrationArtifactDigest).toBe(frozen.artifactDigest);
    expect(fitReport.partitionsUsed).toEqual(["development", "calibration"]);
    expect(fitReport.thresholds).toEqual(frozen.thresholds);

    // No key anywhere in the fit report names the blocked test or the holdout.
    const forbidden = /test|holdout|consumption/i;
    const walk = (value: unknown): void => {
      if (Array.isArray(value)) {
        value.forEach(walk);
      } else if (value !== null && typeof value === "object") {
        for (const key of Object.keys(value)) {
          expect(key).not.toMatch(forbidden);
          walk((value as Record<string, unknown>)[key]);
        }
      }
    };
    walk(fitReport);
  });
});
