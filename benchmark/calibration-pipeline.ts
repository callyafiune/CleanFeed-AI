// Frozen fit and the JOINT selection of the 5%/2% thresholds for the Phase 2
// benchmark. This is where the design's §6.5 rule is made concrete and sealed:
//
//   - WARNING is the UNION of the document AND localized calibrated paths under
//     a SINGLE 5% false-positive budget measured over the union of markings —
//     never 5% per path. The chosen pair maximizes recall subject to
//     `wilsonOneSided(unionFalsePositives, negatives, "upper") <= 0.05`.
//   - The VISUAL ACTION scans ONLY the document score, requires a threshold at
//     or above the warning document threshold, and obeys a stricter 2% budget.
//   - The fit runs on development + calibration ONLY. It NEVER reads the blocked
//     test: any id assigned to the test partition is refused, no test scores or
//     labels are accepted, and `partitionsUsed` is frozen to the two fit splits.
//
// The output is an immutable `FrozenCalibrationArtifact` carrying the fitted
// calibrators, the joint thresholds, their evidence, the recorded seed and every
// governance/identity digest. Freezing means no later step may retune: mutating
// any embedded digest breaks `artifactDigest`, and the two prediction manifests,
// the source-readiness report and the dataset audit are all bound in.
//
// Standalone benchmark module: it MUST NOT import from the extension bundle
// (src/). It reuses the pure contracts and the sibling benchmark primitives, and
// stays deterministic — no Date, no randomness, no network, no model calls.

import { canonicalJson } from "../contracts/canonical-json.ts";
import type { CorpusSourceReadinessReport } from "../contracts/source-readiness.ts";
import type { RuntimeParityManifestV1 } from "../contracts/runtime-parity.ts";
import type { SerializedCalibratorV1 } from "../contracts/calibration-profile.ts";
import { applyCalibrator } from "./calibrators.ts";
import {
  selectCalibrator,
  type CandidateCalibrationSummary,
  type GroupedCalibrationSample,
} from "./cross-validation.ts";
import type { DatasetAudit, DatasetManifest } from "./dataset-manifest.ts";
import { sha256BytesHex } from "./digests.ts";
import { wilsonOneSided } from "./intervals.ts";
import {
  parsePredictionManifest,
  RELEASE_CHROME_VERSION,
  type PredictionManifestV1,
} from "./prediction-schema.ts";

const WARNING_FPR_BUDGET = 0.05;
const VISUAL_FPR_BUDGET = 0.02;
// A finite sentinel strictly above every calibrated score (which is clamped to
// [0,1]). Used as the "this path never fires" warning threshold so the frozen
// artifact stays canonicalizable — canonical JSON rejects +Infinity.
const NEVER_THRESHOLD = 2;

/** A single calibration record's raw path scores. Label comes from the list. */
export interface FitSampleScores {
  id: string;
  authorGroup: string;
  documentRawScore: number;
  localizedRawScore: number;
}

export interface FitFrozenCalibrationInput {
  /** Guard: the blocked test partition may never drive a fit. */
  partition: "development" | "calibration";
  fitSeed: number;
  /** Human negatives (label 0) that define the false-positive budget. */
  samples: readonly FitSampleScores[];
  /** AI / mixed positives (label 1) whose recall the thresholds maximize. */
  positives: readonly FitSampleScores[];
  /** Ids assigned to the blocked test partition by the split artifact. */
  testIds: readonly string[];
  evaluatorDigest: string;
  datasetManifest: DatasetManifest;
  datasetAudit: DatasetAudit;
  sourceReadiness: CorpusSourceReadinessReport;
  runtimeParity: RuntimeParityManifestV1;
  /** Exact bytes of the reviewed source manifest (private/source-manifest.json). */
  sourceManifestBytes: string;
  developmentManifest: PredictionManifestV1 | Record<string, unknown>;
  developmentManifestDigest: string;
  calibrationManifest: PredictionManifestV1 | Record<string, unknown>;
  calibrationManifestDigest: string;
}

export interface ThresholdEvidence {
  documentThreshold: number;
  localizedThreshold: number | null;
  negatives: number;
  falsePositives: number;
  fprUpper95: number;
  positives: number;
  truePositives: number;
  recall: number;
}

export interface FrozenCalibrationArtifact {
  schemaVersion: 1;
  model: {
    modelId: string;
    modelVersion: string;
    bundleDigest: string;
    tokenizerDigest: string;
    aggregationVersion: string;
    contentCompositionVersion: string;
  };
  scoringRuntime: {
    runtimeParityDigest: string;
    extensionBuildDigest: string;
    backend: "wasm";
    chromeVersion: typeof RELEASE_CHROME_VERSION;
  };
  predictionManifestDigests: {
    development: string;
    calibration: string;
  };
  datasetDigest: string;
  datasetAuditDigest: string;
  sourceReadinessDigest: string;
  splitDigest: string;
  evaluatorDigest: string;
  partitionsUsed: ["development", "calibration"];
  calibrators: {
    document: SerializedCalibratorV1;
    localized: SerializedCalibratorV1;
  };
  selectionEvidence: {
    document: CandidateCalibrationSummary[];
    localized: CandidateCalibrationSummary[];
  };
  thresholds: {
    warningDocument: number;
    warningLocalized: number;
    visualDocument: number | null;
  };
  thresholdEvidence: {
    warning: ThresholdEvidence;
    visual: ThresholdEvidence | null;
  };
  fitSeed: number;
  artifactDigest: string;
}

export interface FrozenCalibrationResult extends FrozenCalibrationArtifact {
  applyDocument(rawScore: number): number;
  applyLocalized(rawScore: number): number;
}

export interface AppliedCalibration {
  documentScore: number;
  localizedScore: number;
  warnedByDocument: boolean;
  warnedByLocalized: boolean;
  warning: boolean;
  visualAction: boolean;
}

/** Coded, fail-closed error thrown by the frozen-calibration fit. */
export class CalibrationPipelineError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CalibrationPipelineError";
  }
}

function fail(message: string): never {
  throw new CalibrationPipelineError(message);
}

/** Synchronous canonical SHA-256 — byte-identical to `canonicalSha256`. */
function canonicalDigest(value: unknown): string {
  return sha256BytesHex(new TextEncoder().encode(canonicalJson(value)));
}

interface FrozenIdentity {
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  tokenizerDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  runtimeParityDigest: string;
  extensionBuildDigest: string;
  datasetDigest: string;
  splitDigest: string;
  developmentManifestDigest: string;
  calibrationManifestDigest: string;
  datasetAuditDigest: string;
  sourceReadinessDigest: string;
}

const IDENTITY_FIELDS = [
  "modelId",
  "modelVersion",
  "bundleDigest",
  "tokenizerDigest",
  "aggregationVersion",
  "contentCompositionVersion",
  "runtimeParityDigest",
  "extensionBuildDigest",
  "datasetDigest",
  "splitDigest",
] as const;

/**
 * Re-parses and cross-checks every governance and identity artifact BEFORE any
 * calibration happens. Nothing here is trusted from the caller: manifests are
 * re-parsed, digests are recomputed and compared, and the two governance reports
 * are bridged to the same source-manifest bytes.
 */
function validateFitInputs(input: FitFrozenCalibrationInput): FrozenIdentity {
  if (input.partition !== "development" && input.partition !== "calibration") {
    fail("test partition is forbidden during fit");
  }

  // Re-parse both prediction manifests (closed schema, no coercion).
  const development = parsePredictionManifest(input.developmentManifest);
  const calibration = parsePredictionManifest(input.calibrationManifest);

  if (development.partition !== "development") {
    fail("development manifest must declare the development partition");
  }
  if (calibration.partition !== "calibration") {
    fail("calibration manifest must declare the calibration partition");
  }

  for (const manifest of [development, calibration]) {
    if (manifest.backend !== "wasm") {
      fail("scoring backend must be wasm; WebGPU is not release eligible");
    }
    if (manifest.chromeVersion !== RELEASE_CHROME_VERSION) {
      fail(
        `chromeVersion must equal the pinned release Chrome ${RELEASE_CHROME_VERSION}`,
      );
    }
  }

  for (const field of IDENTITY_FIELDS) {
    if (development[field] !== calibration[field]) {
      fail(`development and calibration manifests have a divergent ${field}`);
    }
  }

  // Recompute the canonical manifest digests and compare to the recorded ones:
  // a tampered manifest under a stale digest is refused.
  if (canonicalDigest(development) !== input.developmentManifestDigest) {
    fail("development prediction manifest digest does not match");
  }
  if (canonicalDigest(calibration) !== input.calibrationManifestDigest) {
    fail("calibration prediction manifest digest does not match");
  }

  // Runtime parity binds the SAME inference core as benchmark and release.
  const parity = input.runtimeParity;
  const parityIdentity = {
    schemaVersion: parity.schemaVersion,
    modelId: parity.modelId,
    modelVersion: parity.modelVersion,
    bundleDigest: parity.bundleDigest,
    aggregationVersion: parity.aggregationVersion,
    contentCompositionVersion: parity.contentCompositionVersion,
    tokenizerDigest: parity.tokenizerDigest,
    inferenceCoreDigest: parity.inferenceCoreDigest,
  };
  if (canonicalDigest(parityIdentity) !== parity.runtimeParityDigest) {
    fail("runtime parity digest does not match its identity fields");
  }
  if (parity.runtimeParityDigest !== development.runtimeParityDigest) {
    fail("runtime parity digest diverges from the prediction manifests");
  }
  if (
    parity.modelId !== development.modelId ||
    parity.modelVersion !== development.modelVersion ||
    parity.bundleDigest !== development.bundleDigest ||
    parity.tokenizerDigest !== development.tokenizerDigest ||
    parity.aggregationVersion !== development.aggregationVersion ||
    parity.contentCompositionVersion !== development.contentCompositionVersion
  ) {
    fail("runtime parity identity diverges from the prediction manifests");
  }

  // Dataset audit: sealed, self-consistent digest, right dataset, right bytes.
  const audit = input.datasetAudit;
  if (audit.sealed !== true) {
    fail("dataset audit must be sealed before a fit");
  }
  const auditIdentity = {
    datasetId: audit.datasetId,
    scientificUse: audit.scientificUse,
    releaseEligible: audit.releaseEligible,
    recordCount: audit.recordCount,
    counts: audit.counts,
    sourceTypes: audit.sourceTypes,
    hardNegativeFamilies: audit.hardNegativeFamilies,
    generatorFamilies: audit.generatorFamilies,
    licenses: audit.licenses,
    recordsSha256: audit.recordsSha256,
    reviewLedgerSha256: audit.reviewLedgerSha256,
    sourceManifestSha256: audit.sourceManifestSha256,
    sealed: audit.sealed,
  };
  if (canonicalDigest(auditIdentity) !== audit.auditDigest) {
    fail("dataset auditDigest does not match the recomputed audit");
  }
  const manifest = input.datasetManifest;
  if (audit.datasetId !== manifest.datasetId) {
    fail("dataset audit was sealed for a different dataset");
  }
  if (
    audit.recordsSha256 !== manifest.recordsSha256 ||
    audit.reviewLedgerSha256 !== manifest.reviewLedgerSha256 ||
    audit.sourceManifestSha256 !== manifest.sourceManifestSha256
  ) {
    fail("dataset audit file digests diverge from the dataset manifest");
  }
  if (audit.releaseEligible !== (manifest.scientificUse === "release")) {
    fail("releaseEligible must match the manifest scientificUse");
  }

  // Source readiness: ready, self-consistent digest.
  const readiness = input.sourceReadiness;
  if (readiness.status !== "ready") {
    fail("source readiness report must be ready before a fit");
  }
  const readinessIdentity = {
    schemaVersion: readiness.schemaVersion,
    status: readiness.status,
    sourceManifestDigest: readiness.sourceManifestDigest,
    recordCount: readiness.recordCount,
    sourceCount: readiness.sourceCount,
    acquisitionCounts: readiness.acquisitionCounts,
    protocols: readiness.protocols,
    blockingReasons: readiness.blockingReasons,
  };
  if (canonicalDigest(readinessIdentity) !== readiness.reportDigest) {
    fail("source readiness reportDigest does not match the recomputed report");
  }

  // Bridge the two governance reports to the SAME source-manifest bytes: the raw
  // SHA ties them to the audited file, the canonical self-digest ties them to
  // the readiness decision.
  const rawSha = sha256BytesHex(
    new TextEncoder().encode(input.sourceManifestBytes),
  );
  if (rawSha !== audit.sourceManifestSha256) {
    fail("source manifest bytes do not match the sealed raw SHA-256");
  }
  let sourceManifest: unknown;
  try {
    sourceManifest = JSON.parse(input.sourceManifestBytes);
  } catch {
    fail("source manifest bytes are not valid JSON");
  }
  if (
    typeof sourceManifest !== "object" ||
    sourceManifest === null ||
    Array.isArray(sourceManifest)
  ) {
    fail("source manifest must be a JSON object");
  }
  const sourceObject = sourceManifest as Record<string, unknown>;
  const declaredSourceDigest = sourceObject.sourceManifestDigest;
  if (typeof declaredSourceDigest !== "string") {
    fail("source manifest must carry a sourceManifestDigest");
  }
  const strippedSource: Record<string, unknown> = {};
  for (const key of Object.keys(sourceObject)) {
    if (key !== "sourceManifestDigest") {
      strippedSource[key] = sourceObject[key];
    }
  }
  if (canonicalDigest(strippedSource) !== declaredSourceDigest) {
    fail("source manifest sourceManifestDigest is inconsistent with its body");
  }
  if (declaredSourceDigest !== readiness.sourceManifestDigest) {
    fail("source manifest digest diverges from the readiness report");
  }

  // The blocked test is never read: no fit id may belong to the test partition.
  const testIds = new Set(input.testIds);
  for (const sample of [...input.samples, ...input.positives]) {
    if (testIds.has(sample.id)) {
      fail(
        `sample ${sample.id} is assigned to the blocked test partition and cannot be used during fit`,
      );
    }
  }

  return {
    modelId: development.modelId,
    modelVersion: development.modelVersion,
    bundleDigest: development.bundleDigest,
    tokenizerDigest: development.tokenizerDigest,
    aggregationVersion: development.aggregationVersion,
    contentCompositionVersion: development.contentCompositionVersion,
    runtimeParityDigest: development.runtimeParityDigest,
    extensionBuildDigest: development.extensionBuildDigest,
    datasetDigest: development.datasetDigest,
    splitDigest: development.splitDigest,
    developmentManifestDigest: input.developmentManifestDigest,
    calibrationManifestDigest: input.calibrationManifestDigest,
    datasetAuditDigest: audit.auditDigest,
    sourceReadinessDigest: readiness.reportDigest,
  };
}

interface CalibratedRecord {
  document: number;
  localized: number;
}

interface WarningCandidate {
  documentThreshold: number;
  localizedThreshold: number;
  falsePositives: number;
  fprUpper95: number;
  truePositives: number;
  recall: number;
}

// vence maior recall; empate favorece menor UCB e thresholds mais altos.
function warningOrderTuple(
  candidate: WarningCandidate,
): readonly [number, number, number, number] {
  return [
    -candidate.recall,
    candidate.fprUpper95,
    -candidate.documentThreshold,
    -candidate.localizedThreshold,
  ];
}

function compareTuples(a: readonly number[], b: readonly number[]): number {
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return a[index] < b[index] ? -1 : 1;
  }
  return 0;
}

function distinctSortedDescending(values: readonly number[]): number[] {
  return [...new Set(values)].sort((a, b) => b - a);
}

/**
 * Exact O(n²) search of the warning threshold PAIR. For each document
 * threshold, records passing the document path are pre-marked; the localized
 * threshold is then swept in DESCENDING order, adding only records not already
 * marked. That builds the UNION incrementally and never sums per-path FPRs. A
 * pair is eligible only when its union FPR upper bound is within the 5% budget.
 */
function selectWarningThresholds(
  negatives: readonly CalibratedRecord[],
  positives: readonly CalibratedRecord[],
): WarningCandidate {
  const negativeCount = negatives.length;
  const positiveCount = positives.length;

  const documentThresholds = [
    NEVER_THRESHOLD,
    ...distinctSortedDescending([
      ...negatives.map((record) => record.document),
      ...positives.map((record) => record.document),
    ]),
  ];
  const localizedThresholds = [
    NEVER_THRESHOLD,
    ...distinctSortedDescending([
      ...negatives.map((record) => record.localized),
      ...positives.map((record) => record.localized),
    ]),
  ];

  // Records sorted by localized score DESCENDING so the sweep advances a single
  // pointer as the localized threshold falls — O(n) per document threshold.
  const negByLocalized = [...negatives].sort(
    (a, b) => b.localized - a.localized,
  );
  const posByLocalized = [...positives].sort(
    (a, b) => b.localized - a.localized,
  );

  let best: WarningCandidate | null = null;

  for (const documentThreshold of documentThresholds) {
    const negMarked = negatives.map(
      (record) => record.document >= documentThreshold,
    );
    const posMarked = positives.map(
      (record) => record.document >= documentThreshold,
    );
    // Map each record to its index in the localized-sorted arrays.
    const negMarkedByLocalized = negByLocalized.map((record) =>
      negatives.indexOf(record),
    );
    const posMarkedByLocalized = posByLocalized.map((record) =>
      positives.indexOf(record),
    );

    let falsePositives = negMarked.filter(Boolean).length;
    let truePositives = posMarked.filter(Boolean).length;
    let negPointer = 0;
    let posPointer = 0;

    for (const localizedThreshold of localizedThresholds) {
      while (
        negPointer < negByLocalized.length &&
        negByLocalized[negPointer].localized >= localizedThreshold
      ) {
        const originalIndex = negMarkedByLocalized[negPointer];
        if (!negMarked[originalIndex]) {
          negMarked[originalIndex] = true;
          falsePositives += 1;
        }
        negPointer += 1;
      }
      while (
        posPointer < posByLocalized.length &&
        posByLocalized[posPointer].localized >= localizedThreshold
      ) {
        const originalIndex = posMarkedByLocalized[posPointer];
        if (!posMarked[originalIndex]) {
          posMarked[originalIndex] = true;
          truePositives += 1;
        }
        posPointer += 1;
      }

      const fprUpper95 =
        negativeCount === 0
          ? 0
          : wilsonOneSided(falsePositives, negativeCount, "upper").value;
      if (fprUpper95 > WARNING_FPR_BUDGET) continue;

      const candidate: WarningCandidate = {
        documentThreshold,
        localizedThreshold,
        falsePositives,
        fprUpper95,
        truePositives,
        recall: positiveCount === 0 ? 0 : truePositives / positiveCount,
      };
      if (
        best === null ||
        compareTuples(warningOrderTuple(candidate), warningOrderTuple(best)) < 0
      ) {
        best = candidate;
      }
    }
  }

  if (best === null) {
    fail(
      "no warning threshold keeps the union false-positive rate within the 5% budget",
    );
  }
  return best;
}

interface VisualCandidate {
  documentThreshold: number;
  falsePositives: number;
  fprUpper95: number;
  truePositives: number;
  recall: number;
}

function visualOrderTuple(
  candidate: VisualCandidate,
): readonly [number, number, number] {
  return [
    -candidate.recall,
    candidate.fprUpper95,
    -candidate.documentThreshold,
  ];
}

/**
 * Scans ONLY the document score for a visual-action threshold at or above the
 * warning document threshold, under the stricter 2% budget. Returns null when
 * no finite threshold qualifies — the warning stays valid regardless.
 */
function selectVisualThreshold(
  negatives: readonly CalibratedRecord[],
  positives: readonly CalibratedRecord[],
  warningDocumentThreshold: number,
): VisualCandidate | null {
  const negativeCount = negatives.length;
  const positiveCount = positives.length;
  const candidates = distinctSortedDescending([
    ...negatives.map((record) => record.document),
    ...positives.map((record) => record.document),
  ]).filter((threshold) => threshold >= warningDocumentThreshold);

  let best: VisualCandidate | null = null;
  for (const documentThreshold of candidates) {
    const falsePositives = negatives.filter(
      (record) => record.document >= documentThreshold,
    ).length;
    const fprUpper95 =
      negativeCount === 0
        ? 0
        : wilsonOneSided(falsePositives, negativeCount, "upper").value;
    if (fprUpper95 > VISUAL_FPR_BUDGET) continue;
    const truePositives = positives.filter(
      (record) => record.document >= documentThreshold,
    ).length;
    const candidate: VisualCandidate = {
      documentThreshold,
      falsePositives,
      fprUpper95,
      truePositives,
      recall: positiveCount === 0 ? 0 : truePositives / positiveCount,
    };
    if (
      best === null ||
      compareTuples(visualOrderTuple(candidate), visualOrderTuple(best)) < 0
    ) {
      best = candidate;
    }
  }
  return best;
}

function toGroupedSamples(
  input: FitFrozenCalibrationInput,
  path: "document" | "localized",
): GroupedCalibrationSample[] {
  const read = (sample: FitSampleScores): number =>
    path === "document" ? sample.documentRawScore : sample.localizedRawScore;
  return [
    ...input.samples.map((sample) => ({
      id: sample.id,
      authorGroup: sample.authorGroup,
      rawScore: read(sample),
      label: 0 as const,
    })),
    ...input.positives.map((sample) => ({
      id: sample.id,
      authorGroup: sample.authorGroup,
      rawScore: read(sample),
      label: 1 as const,
    })),
  ];
}

function artifactWithoutDigest(
  artifact: FrozenCalibrationArtifact,
): Omit<FrozenCalibrationArtifact, "artifactDigest"> {
  return {
    schemaVersion: artifact.schemaVersion,
    model: artifact.model,
    scoringRuntime: artifact.scoringRuntime,
    predictionManifestDigests: artifact.predictionManifestDigests,
    datasetDigest: artifact.datasetDigest,
    datasetAuditDigest: artifact.datasetAuditDigest,
    sourceReadinessDigest: artifact.sourceReadinessDigest,
    splitDigest: artifact.splitDigest,
    evaluatorDigest: artifact.evaluatorDigest,
    partitionsUsed: artifact.partitionsUsed,
    calibrators: artifact.calibrators,
    selectionEvidence: artifact.selectionEvidence,
    thresholds: artifact.thresholds,
    thresholdEvidence: artifact.thresholdEvidence,
    fitSeed: artifact.fitSeed,
  };
}

/**
 * Fits the two path calibrators on the CALIBRATION split, jointly selects the
 * warning and visual thresholds, and seals the immutable artifact. Synchronous
 * and deterministic for a fixed seed.
 */
export function fitFrozenCalibration(
  input: FitFrozenCalibrationInput,
): FrozenCalibrationResult {
  const identity = validateFitInputs(input);

  const documentSelection = selectCalibrator(
    toGroupedSamples(input, "document"),
    input.fitSeed,
  );
  const localizedSelection = selectCalibrator(
    toGroupedSamples(input, "localized"),
    input.fitSeed,
  );

  const negatives: CalibratedRecord[] = input.samples.map((sample) => ({
    document: applyCalibrator(documentSelection.model, sample.documentRawScore),
    localized: applyCalibrator(
      localizedSelection.model,
      sample.localizedRawScore,
    ),
  }));
  const positives: CalibratedRecord[] = input.positives.map((sample) => ({
    document: applyCalibrator(documentSelection.model, sample.documentRawScore),
    localized: applyCalibrator(
      localizedSelection.model,
      sample.localizedRawScore,
    ),
  }));

  const warning = selectWarningThresholds(negatives, positives);
  const visual = selectVisualThreshold(
    negatives,
    positives,
    warning.documentThreshold,
  );

  const warningEvidence: ThresholdEvidence = {
    documentThreshold: warning.documentThreshold,
    localizedThreshold: warning.localizedThreshold,
    negatives: negatives.length,
    falsePositives: warning.falsePositives,
    fprUpper95: warning.fprUpper95,
    positives: positives.length,
    truePositives: warning.truePositives,
    recall: warning.recall,
  };
  const visualEvidence: ThresholdEvidence | null =
    visual === null
      ? null
      : {
          documentThreshold: visual.documentThreshold,
          localizedThreshold: null,
          negatives: negatives.length,
          falsePositives: visual.falsePositives,
          fprUpper95: visual.fprUpper95,
          positives: positives.length,
          truePositives: visual.truePositives,
          recall: visual.recall,
        };

  const base: Omit<FrozenCalibrationArtifact, "artifactDigest"> = {
    schemaVersion: 1,
    model: {
      modelId: identity.modelId,
      modelVersion: identity.modelVersion,
      bundleDigest: identity.bundleDigest,
      tokenizerDigest: identity.tokenizerDigest,
      aggregationVersion: identity.aggregationVersion,
      contentCompositionVersion: identity.contentCompositionVersion,
    },
    scoringRuntime: {
      runtimeParityDigest: identity.runtimeParityDigest,
      extensionBuildDigest: identity.extensionBuildDigest,
      backend: "wasm",
      chromeVersion: RELEASE_CHROME_VERSION,
    },
    predictionManifestDigests: {
      development: identity.developmentManifestDigest,
      calibration: identity.calibrationManifestDigest,
    },
    datasetDigest: identity.datasetDigest,
    datasetAuditDigest: identity.datasetAuditDigest,
    sourceReadinessDigest: identity.sourceReadinessDigest,
    splitDigest: identity.splitDigest,
    evaluatorDigest: input.evaluatorDigest,
    partitionsUsed: ["development", "calibration"],
    calibrators: {
      document: documentSelection.model,
      localized: localizedSelection.model,
    },
    selectionEvidence: {
      document: documentSelection.candidates,
      localized: localizedSelection.candidates,
    },
    thresholds: {
      warningDocument: warning.documentThreshold,
      warningLocalized: warning.localizedThreshold,
      visualDocument: visual === null ? null : visual.documentThreshold,
    },
    thresholdEvidence: {
      warning: warningEvidence,
      visual: visualEvidence,
    },
    fitSeed: input.fitSeed,
  };

  const artifact: FrozenCalibrationArtifact = {
    ...base,
    artifactDigest: canonicalDigest(base),
  };

  return {
    ...artifact,
    applyDocument: (rawScore: number): number =>
      applyCalibrator(artifact.calibrators.document, rawScore),
    applyLocalized: (rawScore: number): number =>
      applyCalibrator(artifact.calibrators.localized, rawScore),
  };
}

/**
 * Applies a frozen calibration to a pair of raw scores. The warning is the
 * UNION of the two calibrated paths; the visual action consults ONLY the
 * document path and only when a visual threshold was frozen.
 */
export function applyFrozenCalibration(
  artifact: FrozenCalibrationArtifact,
  rawScores: { documentRawScore: number; localizedRawScore: number },
): AppliedCalibration {
  const documentScore = applyCalibrator(
    artifact.calibrators.document,
    rawScores.documentRawScore,
  );
  const localizedScore = applyCalibrator(
    artifact.calibrators.localized,
    rawScores.localizedRawScore,
  );
  const warnedByDocument = documentScore >= artifact.thresholds.warningDocument;
  const warnedByLocalized =
    localizedScore >= artifact.thresholds.warningLocalized;
  const visualAction =
    artifact.thresholds.visualDocument !== null &&
    documentScore >= artifact.thresholds.visualDocument;
  return {
    documentScore,
    localizedScore,
    warnedByDocument,
    warnedByLocalized,
    warning: warnedByDocument || warnedByLocalized,
    visualAction,
  };
}

/**
 * Recomputes `artifactDigest` over the frozen fields and refuses any drift.
 * Because the digest covers the embedded governance/identity digests, altering
 * the dataset audit, either prediction manifest or the readiness report after
 * the fit is detected here.
 */
export function validateFrozenCalibrationArtifact(
  artifact: FrozenCalibrationArtifact,
): void {
  const expected = canonicalDigest(artifactWithoutDigest(artifact));
  if (expected !== artifact.artifactDigest) {
    fail("frozen calibration artifactDigest does not match its contents");
  }
}
