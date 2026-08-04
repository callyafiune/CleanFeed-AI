import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import {
  computeSourceReadinessDigest,
  type CorpusSourceReadinessReport,
} from "../../contracts/source-readiness.ts";
import {
  computeRuntimeParityDigest,
  type RuntimeParityManifestV1,
} from "../../contracts/runtime-parity.ts";
import {
  validateFrozenCalibrationArtifact,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import { runFit, type FitOptions } from "../commands/fit.ts";
import { REBUILD_V3_POLICY } from "../rebuild-v3-policy.ts";
import {
  emptyLabelBasisPublication,
  computeDatasetAuditDigest,
  type DatasetAudit,
  type DatasetManifest,
} from "../dataset-manifest.ts";
import { sha256BytesHex } from "../digests.ts";
import { RELEASE_CHROME_VERSION } from "../prediction-schema.ts";
import type { BenchmarkRecord } from "../schema.ts";
import { buildSplitArtifact } from "../split-artifact.ts";
import {
  DECLARED_GROUP_AXES,
  FROZEN_SPLIT_AUDIT_POLICY,
  auditBlockedSplit,
} from "../split-audit.ts";
import type { DatasetSplit } from "../split.ts";
import {
  asGeneratorFamily,
  normalizeGeneratorFamily,
} from "../generator-family.ts";

// ---------------------------------------------------------------------------
// A fully consistent on-disk fit scenario: a sealed-shaped dataset, a frozen
// split artifact, the governance triplet (dataset audit, source readiness,
// runtime parity) and two sharded prediction artifacts. Every digest is
// COMPUTED so fit's own recomputation matches; nothing is a hand-typed hash.
//
// The fit set carries 105 human negatives so that a zero-false-positive warning
// threshold clears the 5% Wilson-upper budget (wilsonOneSided(0,105,"upper") is
// ~0.025), plus 20 positives with clearly higher raw scores.
// ---------------------------------------------------------------------------

function hex(label: string): string {
  let out = "";
  for (const ch of label) out += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return out.padEnd(64, "0").slice(0, 64);
}

const DATASET_ID = "ptbr-generic-v1";
const MODEL_ID = "cleanfeed-ptbr-v1";
const MODEL_VERSION = "1.0.0";
const BUNDLE = hex("bundle");
const TOKENIZER = hex("tokenizer");
const EXTENSION_BUILD = hex("extension-build");
const INFERENCE_CORE = hex("inference-core");
const AGGREGATION = "tmr-aggregation-v3";
const COMPOSITION = "lexical-content-v2";
const PRED_DATASET_DIGEST = hex("pred-dataset");
const PRED_SPLIT_DIGEST = hex("pred-split");
const RECORDS_SHA = hex("records");
const REVIEW_LEDGER_SHA = hex("review-ledger");
const FIT_SEED = 712019;

// Source manifest: raw bytes gate the audit/manifest raw SHA, while the
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

function makeRecord(
  id: string,
  label: BenchmarkRecord["label"],
  createdAt: number,
  // The provider's family label. Test-partition rows carry the reserved family, so
  // the manifest's reservation names a family the corpus actually contains — the
  // four-way invariant in benchmark/generator-family.ts refuses a reservation
  // nothing satisfies.
  family = "acme_family",
  // The SPLIT/EXPOSURE CLUSTER this row belongs to, carried by `source` — the ORIGIN
  // DOCUMENT, which is a union axis: several rows read out of one document are one
  // component. `domainSource` and `collectionBatch` are shared inside the cluster and
  // NESTED in it (a collection batch belongs to one stratum), and they are REPORTED
  // axes rather than union axes, so nothing but `source` glues these rows. Giving
  // every row of a corpus the same cluster describes a corpus that is ONE indivisible
  // cluster, which can be neither split nor cross-validated. Development, calibration
  // and test clusters are disjoint, so no component straddles a partition either.
  cluster = "c0",
): BenchmarkRecord {
  const base: BenchmarkRecord = {
    schemaVersion: 2,
    id,
    text: `Texto de exemplo suficientemente longo para o registro ${id}.`,
    normalizedTextSha256: hex(`content-${id}`),
    label,
    language: "pt-BR",
    platform: "generic",
    domain: "corporate",
    topic: "geral",
    wordCount: 60,
    createdAt,
    provenance: {
      sourceKind: "authorized-contribution",
      sourceId: `src_${id}`,
      sourceRevision: "rev_001",
      collectedAt: createdAt,
      licenseId: "consent-v1",
      legalBasis: "consent",
      consentId: `consent_${id}`,
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "reviewer_01",
        reviewedAt: createdAt,
      },
    },
    annotation: {
      protocolVersion: "annotation-v1",
      reviewerIds: ["reviewer_01", "reviewer_02"],
      agreement: "agree",
    },
    transformation: { kind: "none", severity: "none" },
    groups: {
      author: `author_${id}`,
      source: `doc_${cluster}`,
      domainSource: `ds_${cluster}`,
      collectionBatch: `batch_${cluster}`,
      nearDuplicate: `nd_${id}`,
      derivationRoot: id,
    },
  };
  if (label === "ai") {
    base.generation = {
      provider: "acme",
      family,
      model: "acme-1",
      version: "v1",
      promptId: `prompt_${id}`,
      promptSha256: hex(`prompt-${id}`),
      generatedAt: createdAt,
    };
    // The canonical field, required by the schema on every generated record and
    // the only one the split/slices/audit read (benchmark/generator-family.ts).
    base.groups.generatorFamily = normalizeGeneratorFamily(family);
  }
  return base;
}

// Five clusters per fit partition, so the cluster-atomised cross-validation has
// ten atoms for its five folds and every class reaches every fold. The blocks are
// CONTIGUOUS rather than strided so a cluster does not coincide with one raw-score
// value: `humanScore`/`aiScore` cycle with the row index, and a cluster equal to
// `index % 5` would hand each fold a score region its own training half never sees.
const devHumans = Array.from({ length: 35 }, (_unused, i) =>
  makeRecord(
    `dev-h-${i}`,
    "human",
    10 + i,
    "acme_family",
    `dev_${(i / 7) | 0}`,
  ),
);
const devAis = Array.from({ length: 10 }, (_unused, i) =>
  makeRecord(`dev-a-${i}`, "ai", 50 + i, "acme_family", `dev_${(i / 2) | 0}`),
);
const calHumans = Array.from({ length: 35 }, (_unused, i) =>
  makeRecord(
    `cal-h-${i}`,
    "human",
    110 + i,
    "acme_family",
    `cal_${(i / 7) | 0}`,
  ),
);
const calAis = Array.from({ length: 10 }, (_unused, i) =>
  makeRecord(`cal-a-${i}`, "ai", 150 + i, "acme_family", `cal_${(i / 2) | 0}`),
);
const testRecords = [
  makeRecord("test-h-0", "human", 310, "acme_family", "tst_0"),
  makeRecord("test-h-1", "human", 311, "acme_family", "tst_0"),
  makeRecord("test-a-0", "ai", 320, "heldout_family", "tst_1"),
  makeRecord("test-a-1", "ai", 321, "heldout_family", "tst_1"),
];
// `train` and `cal-B` are PRESENT and outside the fit population, which is the whole
// point: with them empty, the coverage assertions could not tell an allowlist of
// `dev + cal-A` from a filter of "not test", and the fixture would stay green if the
// production filter regressed to the negative form.
//
// Their SIZES are not free. The sealed audit is re-derived from these records by
// `validateSplitArtifact`, so the split has to satisfy the frozen proportions per class —
// 45/5/10/20/20 — or the audit refuses it. Reading off the two fixed populations: 35 dev
// humans at 5% pins human to 700, and 10 dev AI rows pin ai to 200. Everything below is
// that arithmetic, and `cal-A` needs twice `dev` because its target is twice as large.
//
// The audit here is DERIVED from these records, never hand-written: a hand-written one
// can assert proportions the records do not have, and nothing compares the two.
const HUMAN_TOTAL = 700;
const AI_TOTAL = 200;

// Every filler row of a group shares ONE timestamp, inside its partition's band. Adding
// the index instead would spread `train` across four hundred ticks and into the test
// band, which the audit refuses — `earliest(test)` must exceed `latest(train)`.
function filler(
  prefix: string,
  label: BenchmarkRecord["label"],
  count: number,
  createdAt: number,
): BenchmarkRecord[] {
  return Array.from({ length: count }, (_unused, index) =>
    makeRecord(
      `${prefix}-${index}`,
      label,
      createdAt,
      "acme_family",
      // One cluster per row: a shared cluster would straddle nothing here, but a
      // distinct one keeps the leakage audit non-vacuous over the filler too.
      `${prefix}_${index}`,
    ),
  );
}

// train: 45% of each class, oldest band.
const trainRecords = [
  ...filler("train-h", "human", Math.round(HUMAN_TOTAL * 0.45), 3),
  ...filler("train-a", "ai", Math.round(AI_TOTAL * 0.45), 5),
];
// cal-A: 10% of each class. 35 humans and 10 AI rows already carry predictions, so the
// remainder is filler that carries predictions too — it is inside the fit population.
const calAFillerHumans = filler(
  "cala-h",
  "human",
  Math.round(HUMAN_TOTAL * 0.1) - calHumans.length,
  140,
);
const calAFillerAis = filler(
  "cala-a",
  "ai",
  Math.round(AI_TOTAL * 0.1) - calAis.length,
  145,
);
// cal-B: 20% of each class, between cal-A and test.
const calBRecords = [
  ...filler("calb-h", "human", Math.round(HUMAN_TOTAL * 0.2), 250),
  ...filler("calb-a", "ai", Math.round(AI_TOTAL * 0.2), 255),
];
// test: 20% of each class. `testRecords` already holds four rows in this band.
const testFiller = [
  ...filler("tfill-h", "human", Math.round(HUMAN_TOTAL * 0.2) - 2, 350),
  ...filler("tfill-a", "ai", Math.round(AI_TOTAL * 0.2) - 2, 355),
];
const allRecords = [
  ...trainRecords,
  ...devHumans,
  ...devAis,
  ...calHumans,
  ...calAis,
  ...calAFillerHumans,
  ...calAFillerAis,
  ...calBRecords,
  ...testRecords,
  ...testFiller,
];

interface PredictionRow {
  schemaVersion: 2;
  id: string;
  status: "scored" | "abstained" | "error";
  documentRawScore: number | null;
  localizedRawScore: number | null;
  evidenceQuality: "sufficient" | "limited" | "unsupported";
  reasonCode: string;
  coverage: number;
  latencyMs: number;
  memoryBytes: number | null;
}

function scoredRow(id: string, doc: number, loc: number): PredictionRow {
  return {
    schemaVersion: 2,
    id,
    status: "scored",
    documentRawScore: doc,
    localizedRawScore: loc,
    evidenceQuality: "sufficient",
    reasonCode: "SCORED",
    coverage: 1,
    latencyMs: 40,
    memoryBytes: 1000,
  };
}

function abstainedRow(id: string): PredictionRow {
  return {
    schemaVersion: 2,
    id,
    status: "abstained",
    documentRawScore: null,
    localizedRawScore: null,
    evidenceQuality: "limited",
    reasonCode: "ABSTAINED",
    coverage: 0.5,
    latencyMs: 40,
    memoryBytes: 1000,
  };
}

// Negatives spread across 0.03..0.07, positives across 0.75..0.84, so the
// calibrators fit a non-degenerate curve and the warning threshold lands well
// above every negative (zero false positives).
function humanScore(index: number): number {
  return 0.03 + (index % 5) * 0.01;
}
function aiScore(index: number): number {
  return 0.75 + (index % 4) * 0.03;
}

function defaultDevRows(): PredictionRow[] {
  return [
    ...devHumans.map((r, i) => scoredRow(r.id, humanScore(i), humanScore(i))),
    ...devAis.map((r, i) => scoredRow(r.id, aiScore(i), aiScore(i))),
  ];
}
function defaultCalRows(): PredictionRow[] {
  return [
    ...calHumans.map((r, i) => scoredRow(r.id, humanScore(i), humanScore(i))),
    ...calAis.map((r, i) => scoredRow(r.id, aiScore(i), aiScore(i))),
    // The cal-A filler is inside the fit population, so it needs rows too. The score
    // pattern cycles the same way, so the threshold and calibrator populations grow
    // without changing shape.
    ...calAFillerHumans.map((r, i) =>
      scoredRow(r.id, humanScore(i), humanScore(i)),
    ),
    ...calAFillerAis.map((r, i) => scoredRow(r.id, aiScore(i), aiScore(i))),
  ];
}

// Development rows with dev-h-0 replaced by a caller-chosen row (abstained vs
// scored-at-raw-0), holding every other row fixed.
function devRowsWithSpecial(special: PredictionRow): PredictionRow[] {
  return [
    special,
    ...devHumans
      .slice(1)
      .map((r, i) => scoredRow(r.id, humanScore(i + 1), humanScore(i + 1))),
    ...devAis.map((r, i) => scoredRow(r.id, aiScore(i), aiScore(i))),
  ];
}

function datasetManifest(): DatasetManifest {
  return {
    schemaVersion: 1,
    datasetId: DATASET_ID,
    version: "1.0.0",
    scientificUse: "infrastructure-only",
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
        notice: "Contributed under explicit consent.",
      },
    ],
  };
}

async function buildAudit(): Promise<DatasetAudit> {
  const human = allRecords.filter((r) => r.label === "human").length;
  const ai = allRecords.filter((r) => r.label === "ai").length;
  const base: Omit<DatasetAudit, "auditDigest"> = {
    datasetId: DATASET_ID,
    scientificUse: "infrastructure-only",
    // Coupled to `scientificUse` by the manifest contract: this is an infrastructure
    // corpus, so it is not release eligible. It never was — it carries no `mixed` class.
    releaseEligible: false,
    recordCount: allRecords.length,
    counts: { human, ai, mixed: 0 },
    sourceTypes: { "qa-informal": 1 },
    hardNegativeFamilies: { formulaic: 1 },
    generatorFamilies: { acme_family: ai },
    labelBasisCounts: emptyLabelBasisPublication(),
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
    recordCount: allRecords.length,
    sourceCount: 3,
    // Derived, never typed: the corpus grew to satisfy the frozen proportions, and a
    // hand-written triple would silently stop summing to the record count.
    acquisitionCounts: {
      consent: 40,
      licensed: allRecords.length - 40 - 14,
      generated: 14,
    },
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
    bundleDigest: BUNDLE,
    aggregationVersion: AGGREGATION,
    contentCompositionVersion: COMPOSITION,
    tokenizerDigest: TOKENIZER,
    inferenceCoreDigest: INFERENCE_CORE,
  };
  return {
    ...base,
    runtimeParityDigest: await computeRuntimeParityDigest(base),
  };
}

const runtimeParity = await buildRuntimeParity();
const PARITY_DIGEST = runtimeParity.runtimeParityDigest;

interface ShardDescriptor {
  index: number;
  file: string;
  sha256: string;
  recordCount: number;
}

function predictionManifest(
  partition: "dev" | "cal-A",
  shards: ShardDescriptor[],
): Record<string, unknown> {
  return {
    schemaVersion: 1,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: BUNDLE,
    aggregationVersion: AGGREGATION,
    contentCompositionVersion: COMPOSITION,
    tokenizerDigest: TOKENIZER,
    runtimeParityDigest: PARITY_DIGEST,
    extensionBuildDigest: EXTENSION_BUILD,
    backend: "wasm",
    chromeVersion: RELEASE_CHROME_VERSION,
    datasetDigest: PRED_DATASET_DIGEST,
    splitDigest: PRED_SPLIT_DIGEST,
    partition,
    shardSize: 100,
    shardCount: shards.length,
    shards,
    holdoutConsumptionId: null,
    createdAt: "2026-07-19T00:00:00.000Z",
  };
}

async function writePredictionArtifact(
  dir: string,
  partition: "dev" | "cal-A",
  rows: readonly PredictionRow[],
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const shardBody = `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
  await writeFile(join(dir, "shard-000.jsonl"), shardBody);
  const shardSha = sha256BytesHex(new TextEncoder().encode(shardBody));
  const manifest = predictionManifest(partition, [
    {
      index: 0,
      file: "shard-000.jsonl",
      sha256: shardSha,
      recordCount: rows.length,
    },
  ]);
  await writeFile(
    join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

async function buildScenario(
  root: string,
  devRows: readonly PredictionRow[],
  calRows: readonly PredictionRow[],
): Promise<FitOptions> {
  const manifest = datasetManifest();
  const datasetDirectory = join(root, "dataset");
  await mkdir(join(datasetDirectory, "private"), { recursive: true });
  await writeFile(
    join(datasetDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(datasetDirectory, "records.jsonl"),
    `${allRecords.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
  // Exact source-manifest bytes: their raw SHA must equal the sealed audit hash.
  await writeFile(
    join(datasetDirectory, "private", "source-manifest.json"),
    SOURCE_MANIFEST_BYTES,
  );

  const split: DatasetSplit<BenchmarkRecord> = {
    train: trainRecords,
    dev: [...devHumans, ...devAis],
    "cal-A": [...calHumans, ...calAis, ...calAFillerHumans, ...calAFillerAis],
    "cal-B": calBRecords,
    test: [...testRecords, ...testFiller],
  };
  const policy = {
    fractions: {
      train: 0.45,
      dev: 0.05,
      "cal-A": 0.1,
      "cal-B": 0.2,
      test: 0.2,
    },
    classTolerance: 0.02,
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
    seed: REBUILD_V3_POLICY.seeds.split,
  } as const;
  const artifact = await buildSplitArtifact({
    manifest,
    records: allRecords,
    split,
    policy,
    // Measured from these records, never hand-written: `validateSplitArtifact` re-derives
    // it and refuses an audit that does not reproduce, so a fabricated one cannot pass.
    audit: auditBlockedSplit(
      allRecords,
      split,
      FROZEN_SPLIT_AUDIT_POLICY,
      policy.heldOutGeneratorFamilies,
      DECLARED_GROUP_AXES,
    ),
  });
  const splitArtifactPath = join(root, "split-artifact.json");
  await writeFile(splitArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  const datasetAuditPath = join(root, "dataset-audit.json");
  await writeFile(
    datasetAuditPath,
    `${JSON.stringify(await buildAudit(), null, 2)}\n`,
  );
  const sourceReadinessPath = join(root, "source-readiness.json");
  await writeFile(
    sourceReadinessPath,
    `${JSON.stringify(await buildReadiness(), null, 2)}\n`,
  );
  const runtimeParityPath = join(root, "runtime-parity.json");
  await writeFile(
    runtimeParityPath,
    `${JSON.stringify(runtimeParity, null, 2)}\n`,
  );

  const developmentPredictionsDirectory = join(root, "dev");
  const calibrationPredictionsDirectory = join(root, "cal");
  await writePredictionArtifact(
    developmentPredictionsDirectory,
    "dev",
    devRows,
  );
  await writePredictionArtifact(
    calibrationPredictionsDirectory,
    "cal-A",
    calRows,
  );

  const outputDirectory = join(root, "out");
  await mkdir(outputDirectory, { recursive: true });

  return {
    datasetDirectory,
    datasetAuditPath,
    sourceReadinessPath,
    splitArtifactPath,
    runtimeParityPath,
    developmentPredictionsDirectory,
    calibrationPredictionsDirectory,
    outputDirectory,
    seed: FIT_SEED,
  };
}

const FIT_TIMEOUT_MS = 60_000;

describe("runFit prediction completeness (fail closed)", () => {
  const created: string[] = [];
  afterEach(async () => {
    await Promise.all(
      created.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    created.length = 0;
  });
  async function newRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "cf-fit-"));
    created.push(root);
    return root;
  }

  it(
    "accepts predictions that cover exactly the non-test split ids",
    async () => {
      const options = await buildScenario(
        await newRoot(),
        defaultDevRows(),
        defaultCalRows(),
      );
      await expect(runFit(options)).resolves.toContain("Calibration frozen");
      const frozen = JSON.parse(
        await readFile(
          join(options.outputDirectory, "frozen-calibration.json"),
          "utf8",
        ),
      );
      expect(frozen.artifactDigest).toMatch(/^[0-9a-f]{64}$/u);
    },
    FIT_TIMEOUT_MS,
  );

  it(
    "writes a frozen-calibration.json whose EVERY top-level key the digest covers",
    async () => {
      // The pin this file did not have, and the absence is why an unsealed key shipped:
      // the assertion above checks `artifactDigest` against a hex regex, which a file
      // with an extra key satisfies just as well. `crossValidation` rode the
      // rest-spread in fit.ts into this file while `artifactWithoutDigest` omitted it,
      // so the block could be rewritten on disk and the artifact still validated.
      const options = await buildScenario(
        await newRoot(),
        defaultDevRows(),
        defaultCalRows(),
      );
      await runFit(options);
      const frozen = JSON.parse(
        await readFile(
          join(options.outputDirectory, "frozen-calibration.json"),
          "utf8",
        ),
      ) as Record<string, unknown>;

      expect(Object.keys(frozen).sort()).toEqual([
        "artifactDigest",
        "calibrators",
        "datasetAuditDigest",
        "datasetDigest",
        "evaluatorDigest",
        "fitSeed",
        "model",
        "partitionsUsed",
        "predictionManifestDigests",
        "schemaVersion",
        "scoringRuntime",
        "selectionEvidence",
        "sourceReadinessDigest",
        "splitDigest",
        "thresholdEvidence",
        "thresholds",
      ]);
      expect(frozen).not.toHaveProperty("crossValidation");

      // The key set above is a list a future edit could extend in both places at once.
      // This is the property that cannot be satisfied that way: removing ANY key must
      // break the seal, which is false for exactly the keys the digest does not cover.
      validateFrozenCalibrationArtifact(
        frozen as unknown as FrozenCalibrationArtifact,
      );
      // Both refusals count and neither is available for an UNCOVERED key: a missing
      // field the digest enumerates fails canonicalization, a missing field it hashes
      // structurally fails the digest comparison, and a field outside the seal
      // validates happily — which is the case this loop exists to catch.
      for (const key of Object.keys(frozen)) {
        if (key === "artifactDigest") continue;
        const tampered = { ...frozen };
        delete tampered[key];
        expect(() =>
          validateFrozenCalibrationArtifact(
            tampered as unknown as FrozenCalibrationArtifact,
          ),
        ).toThrow(/artifactDigest|canonicaliz/u);
      }
    },
    FIT_TIMEOUT_MS,
  );

  it(
    "publishes the cross-validation diagnosis in its own file and in what fit returns",
    async () => {
      // Outside the seal by decision, so it must be somewhere a reader reaches: an
      // oversized atom or an all-singleton atom set has to APPEAR (brief requirement 4)
      // and before this it was a field with no file, no log and no consumer.
      const options = await buildScenario(
        await newRoot(),
        defaultDevRows(),
        defaultCalRows(),
      );
      const message = await runFit(options);
      const crossValidation = JSON.parse(
        await readFile(
          join(options.outputDirectory, "cross-validation.json"),
          "utf8",
        ),
      );
      for (const path of ["document", "localized"] as const) {
        const stratification = crossValidation[path];
        expect(stratification.folds).toBe(
          REBUILD_V3_POLICY.calibrator.crossValidationFolds,
        );
        expect(stratification.seed).toBe(
          REBUILD_V3_POLICY.seeds.crossValidation,
        );
        expect(stratification.clusters).toBeGreaterThan(0);
        expect(stratification.clusters).toBeLessThan(stratification.items);
        expect(stratification.perRecordLineAtoms).toBe(false);
        for (const balance of stratification.balance) {
          expect(balance.deviation).toBeGreaterThanOrEqual(
            balance.deviationFloor,
          );
        }
      }
      expect(message).toContain("Grouped CV");
      expect(message).toContain(
        `${crossValidation.document.clusters} cluster(s)`,
      );
    },
    FIT_TIMEOUT_MS,
  );

  it("throws when a dev/cal assigned id has no prediction", async () => {
    const devRows = defaultDevRows().filter((r) => r.id !== "dev-h-3");
    const options = await buildScenario(
      await newRoot(),
      devRows,
      defaultCalRows(),
    );
    await expect(runFit(options)).rejects.toThrow(/completeness|missing/iu);
  });

  it("throws on an extra prediction id absent from the non-test split", async () => {
    const devRows = [...defaultDevRows(), scoredRow("ghost-extra", 0.05, 0.05)];
    const options = await buildScenario(
      await newRoot(),
      devRows,
      defaultCalRows(),
    );
    await expect(runFit(options)).rejects.toThrow(/completeness|extra/iu);
  });

  it("throws on a duplicate id colliding across the two artifacts", async () => {
    // "cal-h-0" is a calibration id; injecting it into the development artifact
    // makes it appear in both, a cross-artifact collision.
    const devRows = [...defaultDevRows(), scoredRow("cal-h-0", 0.05, 0.05)];
    const options = await buildScenario(
      await newRoot(),
      devRows,
      defaultCalRows(),
    );
    await expect(runFit(options)).rejects.toThrow(
      /both the development and calibration|collision|duplicate/iu,
    );
  });
});

describe("runFit excludes non-scored records from calibrator fitting", () => {
  const created: string[] = [];
  afterEach(async () => {
    await Promise.all(
      created.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    created.length = 0;
  });
  async function newRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "cf-fit-"));
    created.push(root);
    return root;
  }

  it(
    "keeps the threshold denominator but drops an abstained record from the calibration curve",
    async () => {
      // Run A: dev-h-0 abstained — its null raw scores coerce to 0 for the
      // threshold sweep but it must never become a calibration point.
      const optionsA = await buildScenario(
        await newRoot(),
        devRowsWithSpecial(abstainedRow("dev-h-0")),
        defaultCalRows(),
      );
      await runFit(optionsA);
      const frozenA = JSON.parse(
        await readFile(
          join(optionsA.outputDirectory, "frozen-calibration.json"),
          "utf8",
        ),
      );

      // Run B: dev-h-0 SCORED at raw 0.0 — an identical raw-0 threshold
      // contribution, but a legitimate calibration point.
      const optionsB = await buildScenario(
        await newRoot(),
        devRowsWithSpecial(scoredRow("dev-h-0", 0, 0)),
        defaultCalRows(),
      );
      await runFit(optionsB);
      const frozenB = JSON.parse(
        await readFile(
          join(optionsB.outputDirectory, "frozen-calibration.json"),
          "utf8",
        ),
      );

      // The false-positive denominator is unchanged: both runs count the record
      // among the 105 human negatives, with a raw-0 coercion (symmetry with
      // evaluate.ts's decision metrics).
      // 35 in dev plus 70 in cal-A. The corpus grew so the split satisfies the frozen
      // proportions per class, and cal-A's target is twice dev's — so its human population
      // is twice as large, and this denominator follows from that arithmetic.
      expect(frozenA.thresholdEvidence.warning.negatives).toBe(105);
      expect(frozenB.thresholdEvidence.warning.negatives).toBe(105);

      // But the FITTED CALIBRATORS diverge: A drops the abstained record from
      // the calibration curve, B keeps it as a raw-0 point. The calibrator is a
      // pure function of the fit sample scores (independent of the prediction
      // manifest digests, which differ trivially between abstained and scored
      // rows), so if the abstained record were (wrongly) fed into calibrator
      // fitting as raw-0 the two runs would fit byte-identical calibrators.
      // They must not.
      expect(frozenA.calibrators).not.toEqual(frozenB.calibrators);
    },
    FIT_TIMEOUT_MS,
  );
});

// ---------------------------------------------------------------------------
// Tres das quatro recusas que a auditoria por mutacao mediu sem teste em `commands/fit.ts`.
//
// A quarta, `FIT_CLUSTER_MISSING`, fica FORA de proposito: o mapa de raizes e construido a partir
// dos MESMOS registros que o laco percorre, entao um registro sem raiz exigiria que a construcao
// do mapa tivesse deixado um de fora. E assercao de invariante interna, da mesma familia de
// `FOLD_HALF_EMPTY`, e nao tenho prova de inalcancabilidade — fica nomeada, nao silenciada.
// ---------------------------------------------------------------------------

describe("fit — recusas de auditoria e de populacao de predicao", () => {
  const criados: string[] = [];
  afterEach(async () => {
    await Promise.all(
      criados.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    criados.length = 0;
  });
  async function novaRaiz(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "cf-fit-recusas-"));
    criados.push(root);
    return root;
  }

  it(
    "refuses a dataset audit whose digests are not the manifest's",
    async () => {
      // A forja tem de ser COMPETENTE: alterar o digest e RECOMPUTAR `auditDigest`, senao a
      // checagem do auto-digest recusa antes e o teste prova coerencia interna em vez do vinculo
      // ao dataset. E a mesma rota do caso 3e em corpus-import.
      const root = await novaRaiz();
      const options = await buildScenario(
        root,
        defaultDevRows(),
        defaultCalRows(),
      );
      const bruto = JSON.parse(
        await readFile(options.datasetAuditPath, "utf8"),
      ) as Record<string, unknown>;
      delete bruto.auditDigest;
      const adulterado = { ...bruto, recordsSha256: "e".repeat(64) };
      await writeFile(
        options.datasetAuditPath,
        `${JSON.stringify(
          {
            ...adulterado,
            auditDigest: await computeDatasetAuditDigest(adulterado as never),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
      await expect(runFit(options)).rejects.toMatchObject({
        code: "DATASET_AUDIT_MISMATCH",
      });
    },
    FIT_TIMEOUT_MS,
  );

  it(
    "refuses the same prediction id in both fit partitions",
    async () => {
      // Uma predicao que aparece em `dev` e em `cal-A` seria contada duas vezes no ajuste, e a
      // colisao e conferida ANTES da completude — que e o que a torna diagnosticavel.
      const root = await novaRaiz();
      const dev = defaultDevRows();
      const options = await buildScenario(root, dev, [
        ...defaultCalRows(),
        dev[0],
      ]);
      await expect(runFit(options)).rejects.toMatchObject({
        code: "FIT_PREDICTION_COLLISION",
      });
    },
    FIT_TIMEOUT_MS,
  );

  it(
    "refuses a fit population with a prediction missing",
    async () => {
      const root = await novaRaiz();
      const options = await buildScenario(
        root,
        defaultDevRows().slice(1),
        defaultCalRows(),
      );
      await expect(runFit(options)).rejects.toMatchObject({
        code: "FIT_PREDICTIONS_INCOMPLETE",
      });
    },
    FIT_TIMEOUT_MS,
  );
});
