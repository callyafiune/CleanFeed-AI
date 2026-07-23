import { describe, expect, it } from "vitest";

import {
  applyFrozenCalibration,
  fitFrozenCalibration,
  validateFrozenCalibrationArtifact,
  type FitFrozenCalibrationInput,
  type FitSampleScores,
} from "../calibration-pipeline.ts";
import { sha256BytesHex } from "../digests.ts";
import { wilsonOneSided } from "../intervals.ts";
import {
  computeDatasetAuditDigest,
  type DatasetAudit,
  type DatasetManifest,
} from "../dataset-manifest.ts";
import {
  computePredictionManifestDigest,
  parsePredictionManifest,
  RELEASE_CHROME_VERSION,
} from "../prediction-schema.ts";
import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import {
  computeSourceReadinessDigest,
  type CorpusSourceReadinessReport,
} from "../../contracts/source-readiness.ts";
import {
  computeRuntimeParityDigest,
  type RuntimeParityManifestV1,
} from "../../contracts/runtime-parity.ts";

// ---------------------------------------------------------------------------
// Shared identity fixtures. Every digest below is COMPUTED so that fit's own
// synchronous recomputation matches exactly; nothing is a hand-typed hash the
// caller could forge.
// ---------------------------------------------------------------------------

const DATASET_ID = "ptbr-linkedin-v1";
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
const AGGREGATION_VERSION = "tmr-aggregation-v2";
const CONTENT_COMPOSITION_VERSION = "lexical-content-v1";
const FIT_SEED = 1234;

// Source manifest: raw bytes gate the DatasetAudit/manifest raw SHA, while the
// canonical self-digest (its own field excluded) gates the readiness report.
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
  intendedDomain: "linkedin",
  createdAt: "2026-07-19T00:00:00.000Z",
  normalizationVersion: "cleanfeed-text-v1",
  annotationProtocolVersion: "annotation-v1",
  recordsFile: "records.jsonl",
  recordsSha256: RECORDS_SHA,
  reviewLedgerFile: "private/review-ledger.jsonl",
  reviewLedgerSha256: REVIEW_LEDGER_SHA,
  sourceManifestFile: "private/source-manifest.json",
  sourceManifestSha256: SOURCE_MANIFEST_SHA,
  heldOutGeneratorFamilies: ["heldout_family"],
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

async function buildAudit(overrides: {
  datasetId?: string;
  scientificUse?: DatasetAudit["scientificUse"];
  releaseEligible?: boolean;
}): Promise<DatasetAudit> {
  const base: Omit<DatasetAudit, "auditDigest"> = {
    datasetId: overrides.datasetId ?? DATASET_ID,
    scientificUse: overrides.scientificUse ?? "release",
    releaseEligible: overrides.releaseEligible ?? true,
    recordCount: 10_000,
    counts: { human: 4_000, ai: 4_000, mixed: 2_000 },
    sourceTypes: { broetry: 1 },
    hardNegativeFamilies: { formulaic: 1 },
    generatorFamilies: { acme_family: 1 },
    licenses: ["consent-v1"],
    recordsSha256: RECORDS_SHA,
    reviewLedgerSha256: REVIEW_LEDGER_SHA,
    sourceManifestSha256: SOURCE_MANIFEST_SHA,
    sealed: true,
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

function makeManifest(
  partition: "development" | "calibration" | "test",
  overrides: Record<string, unknown> = {},
) {
  return {
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
  };
}

async function manifestDigest(raw: Record<string, unknown>): Promise<string> {
  return computePredictionManifestDigest(parsePredictionManifest(raw));
}

// ---------------------------------------------------------------------------
// Calibration score fixtures.
//
// calibrationFixture: the WARNING budget is a single 5% ceiling over the UNION
// of the document and localized paths. Two positive groups can only be caught
// by dropping a threshold below a "noisy" human that outscores them, so a
// per-path 5% policy would mark one negative on EACH path (each fine alone) but
// their union (2/100) blows the 5% ceiling; the joint budget must refuse the
// second path and settle for 2/3 recall with exactly one union false positive.
// ---------------------------------------------------------------------------

function neg(id: string, doc: number, loc: number): FitSampleScores {
  return { id, authorGroup: id, documentRawScore: doc, localizedRawScore: loc };
}

function buildCalibrationScores(): {
  samples: FitSampleScores[];
  positives: FitSampleScores[];
} {
  const samples: FitSampleScores[] = [];
  for (let i = 0; i < 98; i += 1) samples.push(neg(`clean-${i}`, 0.05, 0.05));
  samples.push(neg("doc-noisy", 0.75, 0.05));
  samples.push(neg("loc-noisy", 0.05, 0.75));

  const positives: FitSampleScores[] = [];
  for (let i = 0; i < 10; i += 1) positives.push(neg(`pos-a-${i}`, 0.7, 0.05));
  for (let i = 0; i < 10; i += 1) positives.push(neg(`pos-b-${i}`, 0.05, 0.7));
  for (let i = 0; i < 10; i += 1) positives.push(neg(`pos-c-${i}`, 0.9, 0.05));
  return { samples, positives };
}

// localizedSpikeFixture: document is the binding path for both warning and the
// visual action; localized is spiked/interleaved so it can never beat document.
// Warning (5%) can afford the one borderline human and reach full recall at
// document threshold cal(0.60); the action (2%) cannot afford that human, so it
// is forced up to cal(0.90) — strictly ABOVE the warning threshold.
function buildLocalizedSpikeScores(): {
  samples: FitSampleScores[];
  positives: FitSampleScores[];
} {
  const samples: FitSampleScores[] = [];
  for (let i = 0; i < 140; i += 1) samples.push(neg(`clean-${i}`, 0.05, 0.05));
  samples.push(neg("doc-borderline", 0.65, 0.05));
  samples.push(neg("loc-spike-0", 0.05, 0.8));
  samples.push(neg("loc-spike-1", 0.05, 0.8));

  const positives: FitSampleScores[] = [];
  for (let i = 0; i < 20; i += 1) positives.push(neg(`pos-l-${i}`, 0.6, 0.1));
  for (let i = 0; i < 10; i += 1) positives.push(neg(`pos-h-${i}`, 0.9, 0.1));
  return { samples, positives };
}

async function buildBaseInput(
  scores: { samples: FitSampleScores[]; positives: FitSampleScores[] },
  overrides: Partial<FitFrozenCalibrationInput> = {},
): Promise<FitFrozenCalibrationInput> {
  const developmentManifest = makeManifest("development");
  const calibrationManifest = makeManifest("calibration");
  return {
    partition: "calibration",
    fitSeed: FIT_SEED,
    samples: scores.samples,
    positives: scores.positives,
    testIds: ["blocked-test-1", "blocked-test-2"],
    evaluatorDigest: EVALUATOR_DIGEST,
    datasetManifest,
    datasetAudit: await buildAudit({}),
    sourceReadiness: await buildReadiness(),
    runtimeParity: RUNTIME_PARITY,
    sourceManifestBytes: SOURCE_MANIFEST_BYTES,
    developmentManifest,
    developmentManifestDigest: await manifestDigest(developmentManifest),
    calibrationManifest,
    calibrationManifestDigest: await manifestDigest(calibrationManifest),
    ...overrides,
  };
}

const calibrationScores = buildCalibrationScores();
const localizedSpikeScores = buildLocalizedSpikeScores();
const calibrationFixture = await buildBaseInput(calibrationScores);
const localizedSpikeFixture = await buildBaseInput(localizedSpikeScores);

// Each real fit runs two grouped-CV calibrator selections, so it is expensive.
// Memoize the two successful fits once at module scope and let the read-only
// assertions share them; only the determinism test re-fits (with a timeout).
const calibrationResult = fitFrozenCalibration(calibrationFixture);
const spikeResult = fitFrozenCalibration(localizedSpikeFixture);
const FIT_TIMEOUT_MS = 30_000;

describe("fitFrozenCalibration", () => {
  it("budgets document OR localized warnings jointly", () => {
    const result = calibrationResult;
    const markedHumans = calibrationFixture.samples.filter(
      (sample) =>
        result.applyDocument(sample.documentRawScore) >=
          result.thresholds.warningDocument ||
        result.applyLocalized(sample.localizedRawScore) >=
          result.thresholds.warningLocalized,
    );
    expect(result.thresholdEvidence.warning.falsePositives).toBe(
      markedHumans.length,
    );
    expect(result.thresholdEvidence.warning.fprUpper95).toBeLessThanOrEqual(
      0.05,
    );
  });

  it("enforces a single 5% ceiling over the union, not 5% per path", () => {
    const result = calibrationResult;
    // Each path alone could afford one false positive under 5%...
    expect(wilsonOneSided(1, 100, "upper").value).toBeLessThanOrEqual(0.05);
    // ...but the union of both would be two, which breaks the single ceiling.
    expect(wilsonOneSided(2, 100, "upper").value).toBeGreaterThan(0.05);
    // The joint fit therefore refuses the second path: one union FP, 2/3 recall.
    expect(result.thresholdEvidence.warning.negatives).toBe(100);
    expect(result.thresholdEvidence.warning.positives).toBe(30);
    expect(result.thresholdEvidence.warning.falsePositives).toBe(1);
    expect(result.thresholdEvidence.warning.recall).toBeCloseTo(2 / 3);
  });

  it("uses only document score for visual actions", () => {
    const result = spikeResult;
    expect(result.thresholds.visualDocument).toBeGreaterThanOrEqual(
      result.thresholds.warningDocument,
    );
    expect(result.thresholds).not.toHaveProperty("visualLocalized");
  });

  it("drives the visual action strictly above the warning threshold under 2%", () => {
    const result = spikeResult;
    expect(result.thresholds.visualDocument).not.toBeNull();
    const visual = result.thresholds.visualDocument as number;
    expect(visual).toBeGreaterThan(result.thresholds.warningDocument);
    expect(result.thresholdEvidence.visual).not.toBeNull();
    expect(
      (result.thresholdEvidence.visual as { fprUpper95: number }).fprUpper95,
    ).toBeLessThanOrEqual(0.02);
    // The visual action never consults the localized calibrator.
    expect(
      (result.thresholdEvidence.visual as { localizedThreshold: number | null })
        .localizedThreshold,
    ).toBeNull();
  });

  it("rejects a test partition in fit input", () => {
    expect(() =>
      // The test partition value is deliberately illegal at the type level; the
      // guard rejects it at runtime.
      fitFrozenCalibration({
        ...calibrationFixture,
        partition: "test" as unknown as "calibration",
      }),
    ).toThrow(/test partition is forbidden during fit/);
  });

  it("never reads the blocked test: a fit id assigned to test is refused", () => {
    const clash: FitFrozenCalibrationInput = {
      ...calibrationFixture,
      testIds: [...calibrationFixture.testIds, "doc-noisy"],
    };
    expect(() => fitFrozenCalibration(clash)).toThrow(/blocked test/);

    // A clean fit only ever declares the two non-holdout partitions.
    expect(calibrationResult.partitionsUsed).toEqual([
      "development",
      "calibration",
    ]);
  });

  it(
    "freezes rules, mapping, thresholds, seed and digests deterministically",
    () => {
      const a = calibrationResult;
      const b = fitFrozenCalibration(calibrationFixture);
      expect(a.artifactDigest).toBe(b.artifactDigest);
      expect(a.fitSeed).toBe(FIT_SEED);
      expect(a.calibrators.document.kind).toBeDefined();
      expect(a.calibrators.localized.kind).toBeDefined();
      expect(a.selectionEvidence.document.length).toBe(3);
      expect(a.selectionEvidence.localized.length).toBe(3);
      expect(a.datasetAuditDigest).toBe(
        calibrationFixture.datasetAudit.auditDigest,
      );
      expect(a.sourceReadinessDigest).toBe(
        calibrationFixture.sourceReadiness.reportDigest,
      );
      expect(a.predictionManifestDigests.development).toBe(
        calibrationFixture.developmentManifestDigest,
      );
      expect(a.predictionManifestDigests.calibration).toBe(
        calibrationFixture.calibrationManifestDigest,
      );
      expect(a.datasetDigest).toBe(DATASET_DIGEST);
      expect(a.splitDigest).toBe(SPLIT_DIGEST);
      expect(a.evaluatorDigest).toBe(EVALUATOR_DIGEST);
      expect(a.scoringRuntime).toEqual({
        runtimeParityDigest: RUNTIME_PARITY.runtimeParityDigest,
        extensionBuildDigest: EXTENSION_BUILD_DIGEST,
        backend: "wasm",
        chromeVersion: RELEASE_CHROME_VERSION,
      });
    },
    FIT_TIMEOUT_MS,
  );

  it("applies the frozen calibration into warning and visual booleans", () => {
    const result = spikeResult;
    const applied = applyFrozenCalibration(result, {
      documentRawScore: 0.9,
      localizedRawScore: 0.1,
    });
    expect(applied.warnedByDocument).toBe(true);
    expect(applied.warning).toBe(true);
    expect(applied.visualAction).toBe(true);

    const quiet = applyFrozenCalibration(result, {
      documentRawScore: 0.05,
      localizedRawScore: 0.05,
    });
    expect(quiet.warning).toBe(false);
    expect(quiet.visualAction).toBe(false);
  });
});

describe("fitFrozenCalibration governance guards", () => {
  it("refuses a WebGPU backend", async () => {
    const input = await buildBaseInput(calibrationScores, {
      calibrationManifest: makeManifest("calibration", { backend: "webgpu" }),
    });
    expect(() => fitFrozenCalibration(input)).toThrow(/backend must be wasm/);
  });

  it("refuses a Chrome build that diverges from the pinned release", async () => {
    const input = await buildBaseInput(calibrationScores, {
      calibrationManifest: makeManifest("calibration", {
        chromeVersion: "150.0.7871.130",
      }),
    });
    expect(() => fitFrozenCalibration(input)).toThrow(/chromeVersion/);
  });

  it("refuses a divergent runtimeParityDigest between the two paths", async () => {
    const input = await buildBaseInput(calibrationScores, {
      calibrationManifest: makeManifest("calibration", {
        runtimeParityDigest: "a".repeat(64),
      }),
    });
    expect(() => fitFrozenCalibration(input)).toThrow(/divergent/);
  });

  it("refuses a divergent tokenizer or build digest", async () => {
    const tokenizer = await buildBaseInput(calibrationScores, {
      calibrationManifest: makeManifest("calibration", {
        tokenizerDigest: "7".repeat(64),
      }),
    });
    expect(() => fitFrozenCalibration(tokenizer)).toThrow(/divergent/);
    const build = await buildBaseInput(calibrationScores, {
      calibrationManifest: makeManifest("calibration", {
        extensionBuildDigest: "8".repeat(64),
      }),
    });
    expect(() => fitFrozenCalibration(build)).toThrow(/divergent/);
  });

  it("refuses a tampered prediction manifest under a stale digest", async () => {
    const input = await buildBaseInput(calibrationScores, {
      calibrationManifest: makeManifest("calibration", {
        createdAt: "2020-01-01T00:00:00.000Z",
      }),
    });
    expect(() => fitFrozenCalibration(input)).toThrow(
      /prediction manifest digest/,
    );
  });

  it("refuses a non-null holdoutConsumptionId on a fit manifest", async () => {
    const input = await buildBaseInput(calibrationScores, {
      calibrationManifest: makeManifest("calibration", {
        holdoutConsumptionId: "session-1",
      }),
    });
    expect(() => fitFrozenCalibration(input)).toThrow(
      /holdoutConsumptionId must be null/,
    );
  });

  it("refuses an unsealed dataset audit", async () => {
    const audit = await buildAudit({});
    const input = await buildBaseInput(calibrationScores, {
      datasetAudit: { ...audit, sealed: false } as unknown as DatasetAudit,
    });
    expect(() => fitFrozenCalibration(input)).toThrow(/sealed/);
  });

  it("refuses a tampered auditDigest", async () => {
    const audit = await buildAudit({});
    const input = await buildBaseInput(calibrationScores, {
      datasetAudit: { ...audit, auditDigest: "0".repeat(64) },
    });
    expect(() => fitFrozenCalibration(input)).toThrow(/auditDigest/);
  });

  it("refuses a dataset audit sealed for a different dataset", async () => {
    const input = await buildBaseInput(calibrationScores, {
      datasetAudit: await buildAudit({ datasetId: "other-dataset-v9" }),
    });
    expect(() => fitFrozenCalibration(input)).toThrow(/different dataset/);
  });

  it("refuses a source readiness report that is not ready", async () => {
    const readiness = await buildReadiness();
    const input = await buildBaseInput(calibrationScores, {
      sourceReadiness: {
        ...readiness,
        status: "blocked",
      } as CorpusSourceReadinessReport,
    });
    expect(() => fitFrozenCalibration(input)).toThrow(/ready/);
  });

  it("refuses source manifest bytes that do not match the sealed raw SHA", async () => {
    const input = await buildBaseInput(calibrationScores, {
      sourceManifestBytes: `${SOURCE_MANIFEST_BYTES} `,
    });
    expect(() => fitFrozenCalibration(input)).toThrow(/source manifest bytes/);
  });

  it("invalidates artifactDigest when a frozen digest is altered afterwards", () => {
    const result = calibrationResult;
    expect(() => validateFrozenCalibrationArtifact(result)).not.toThrow();
    expect(() =>
      validateFrozenCalibrationArtifact({
        ...result,
        datasetAuditDigest: "0".repeat(64),
      }),
    ).toThrow(/artifactDigest/);
    expect(() =>
      validateFrozenCalibrationArtifact({
        ...result,
        predictionManifestDigests: {
          ...result.predictionManifestDigests,
          calibration: "0".repeat(64),
        },
      }),
    ).toThrow(/artifactDigest/);
  });
});
