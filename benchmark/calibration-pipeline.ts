// Frozen fit and the JOINT selection of the 5%/2% thresholds for the Phase 2
// benchmark. This is where the design's §6.5 rule is made concrete and sealed:
//
//   - WARNING is the UNION of the document AND localized calibrated paths under
//     a SINGLE 5% false-positive budget measured over the union of markings —
//     never 5% per path. The chosen pair maximizes recall subject to
//     `wilsonOneSided(unionFalsePositives, negatives, "upper") <= 0.05`.
//   - The VISUAL ACTION scans ONLY the document score, requires a threshold at
//     or above the warning document threshold, and obeys a stricter 2% budget.
//   - The fit runs on dev + cal-A ONLY. It NEVER reads the blocked
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
import type {
  RuntimeParityDigestInput,
  RuntimeParityManifestV1,
} from "../contracts/runtime-parity.ts";
import type { SerializedCalibratorV1 } from "../contracts/calibration-profile.ts";
import { applyCalibrator } from "./calibrators.ts";
import {
  selectCalibrator,
  type CandidateCalibrationSummary,
  type ClusteredCalibrationSample,
  type FoldStratification,
} from "./cross-validation.ts";
import type { DatasetAudit, DatasetManifest } from "./dataset-manifest.ts";
import { sha256BytesHex } from "./digests.ts";
import { wilsonOneSided } from "./intervals.ts";
import {
  parsePredictionManifest,
  RELEASE_CHROME_VERSION,
  type PredictionManifestV1,
} from "./prediction-schema.ts";
import type { FitPartition } from "./split.ts";

const WARNING_FPR_BUDGET = 0.05;
const VISUAL_FPR_BUDGET = 0.02;
// A finite sentinel strictly above every calibrated score (which is clamped to
// [0,1]). Used as the "this path never fires" warning threshold so the frozen
// artifact stays canonicalizable — canonical JSON rejects +Infinity.
const NEVER_THRESHOLD = 2;

/** A single calibration record's raw path scores. Label comes from the list. */
export interface FitSampleScores {
  id: string;
  /**
   * The root of this row's SPLIT/EXPOSURE CLUSTER — the connected component of the
   * union of the applicable grouping axes — as `clusterRootsOf`
   * (benchmark/cross-validation.ts) produced it. It replaced an `authorGroup`, and
   * the rename is the point: `groups.author` is `notApplicable` on every generated
   * row and was one singleton per row on the v2 corpus, so a fold keyed on it was a
   * per-record-line fold.
   *
   * Deriving it through `clusterRootsOf` is a CALLER OBLIGATION that neither this
   * module nor the cross-validation can check — a synthesised value passes every
   * guard, because a record-line's own id is a well-formed pseudonym token and the
   * pipeline never sees the records the axes live on. When the obligation is broken
   * the folds silently become per-record-line ones; what surfaces it is
   * `FoldStratification.perRecordLineAtoms`, reported by `fit` and written to
   * `cross-validation.json`.
   */
  clusterRoot: string;
  documentRawScore: number;
  localizedRawScore: number;
}

export interface FitFrozenCalibrationInput {
  /** Guard: the blocked test partition may never drive a fit. */
  partition: FitPartition;
  fitSeed: number;
  /** Human negatives (label 0) that define the false-positive budget. */
  samples: readonly FitSampleScores[];
  /** AI / mixed positives (label 1) whose recall the thresholds maximize. */
  positives: readonly FitSampleScores[];
  /**
   * OPTIONAL scored-only negatives used to FIT the calibrators (the set fed to
   * selectCalibrator / CV via toGroupedSamples). When omitted it falls back to
   * `samples`. Threshold selection ALWAYS runs over `samples`, so a caller can
   * restrict calibrator fitting to `status === "scored"` records — mirroring
   * metrics.ts `scoredBinary` — without perturbing the false-positive
   * denominator that stays symmetric with evaluate's decision metrics.
   */
  calibratorSamples?: readonly FitSampleScores[];
  /** OPTIONAL scored-only positives for calibrator fitting; defaults to `positives`. */
  calibratorPositives?: readonly FitSampleScores[];
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

/**
 * How the false-positive bound recorded beside a frozen threshold is to be read.
 * It exists because the number it qualifies was computed on the very records that
 * CHOSE the threshold, and the name that number used to carry (`fprUpper95`) read
 * as a 95% guarantee it does not have.
 *
 * `selectWarningThresholds` below is an exact search: every distinct score value
 * is a candidate document threshold and every distinct score value a candidate
 * localized threshold, so the winning pair is the survivor of on the order of n²
 * hypotheses tested against the SAME negatives. A Wilson bound recomputed on
 * those negatives is therefore nominal and post-hoc, not a post-selection bound,
 * and it systematically understates the uncertainty of the published threshold
 * (assessment §4.8). Nothing about the arithmetic changes that; only the label
 * does, which is what rule R7 asks for — declare the contract, not the property.
 *
 * The certified bound is the one measured ONCE on the blind test partition at
 * H1. It does not exist at fit time, so `certifiedFprUpper` is `null` here and
 * this block says why, in the artifact, in prose: the frozen calibration travels
 * on its own and is cited on its own.
 */
export interface ThresholdFprBoundProvenance {
  estimator: "wilson-one-sided-upper";
  nominalConfidence: 0.95;
  /** The bound was computed on the same records that selected the threshold. */
  measuredOn: "threshold-selection-data";
  /** No multiplicity correction over the evaluated candidate grid was applied. */
  postSelectionCorrection: "none";
  /** Which is why the number decides nothing on its own. */
  role: "diagnostic";
  /**
   * `legacy-pre-a7` marks a block that was READ from an artifact written before
   * the field was renamed. It never marks a block this module produced.
   */
  vintage: "current" | "legacy-pre-a7";
  certification: {
    status: "pending";
    stage: "h1-blind-test";
    source: "blind-test-partition-measured-once";
    absentBecause: string;
  };
}

export interface ThresholdEvidence {
  documentThreshold: number;
  localizedThreshold: number | null;
  negatives: number;
  falsePositives: number;
  /**
   * The NOMINAL 95% Wilson upper bound of the winning pair's false-positive
   * rate, computed on the selection data. Diagnostic — see
   * `ThresholdFprBoundProvenance`. This is the same number the field
   * `fprUpper95` carried before task A7; only the name changed.
   */
  selectionFprUpper95Nominal: number;
  /**
   * The certified upper bound of the false-positive rate. Always `null` in a fit
   * artifact, because certification happens once on the blind test at H1. Never
   * a placeholder: absence is recorded as absence.
   */
  certifiedFprUpper: null;
  fprBound: ThresholdFprBoundProvenance;
  positives: number;
  truePositives: number;
  recall: number;
}

/**
 * A `thresholdEvidence` block as artifacts wrote it BEFORE task A7 renamed the
 * field. Accepted on READ so a historical fit stays auditable; never emitted.
 */
export interface LegacyThresholdEvidencePreA7 {
  documentThreshold: number;
  localizedThreshold: number | null;
  negatives: number;
  falsePositives: number;
  fprUpper95: number;
  positives: number;
  truePositives: number;
  recall: number;
}

const CERTIFICATION_ABSENT_BECAUSE =
  "No certified bound exists at fit time: the thresholds were selected on these " +
  "same records, so certification is a single measurement on the blind test " +
  "partition at H1. Until then this artifact carries a nominal, diagnostic " +
  "figure only.";

const NO_FPR_BOUND_MESSAGE =
  "frozen threshold evidence carries no FPR bound under either name " +
  "(selectionFprUpper95Nominal, or the pre-A7 fprUpper95): a threshold block " +
  "without a bound is refused, never republished as if it had one";

function selectionFprBoundProvenance(
  vintage: ThresholdFprBoundProvenance["vintage"],
): ThresholdFprBoundProvenance {
  return {
    estimator: "wilson-one-sided-upper",
    nominalConfidence: 0.95,
    measuredOn: "threshold-selection-data",
    postSelectionCorrection: "none",
    role: "diagnostic",
    vintage,
    certification: {
      status: "pending",
      stage: "h1-blind-test",
      source: "blind-test-partition-measured-once",
      absentBecause: CERTIFICATION_ABSENT_BECAUSE,
    },
  };
}

/** Everything a `thresholdEvidence` block carries except the provenance block. */
export interface ThresholdEvidenceCounts {
  documentThreshold: number;
  localizedThreshold: number | null;
  negatives: number;
  falsePositives: number;
  selectionFprUpper95Nominal: number;
  positives: number;
  truePositives: number;
  recall: number;
}

/**
 * The ONE constructor of a `thresholdEvidence` block, for both vintages. It
 * decides two things a fit artifact may never get wrong — the bound it publishes
 * is the NOMINAL selection one, and the certified bound is recorded as absent
 * rather than filled with the nominal number — and one thing a REPUBLISHED block
 * may never get wrong: the key order.
 *
 * Key order is load-bearing, not cosmetic. `evidence-sanitizer` writes the fit
 * summary with `JSON.stringify(value, null, 2)`, and that file's sha256 enters
 * the evidence inventory and `publicationDigest`. A second, hand-rolled builder
 * in the reader produced the same fields in a different order, so a
 * current-vintage block was republished with different BYTES from the ones the
 * sealed artifact carries — a published bundle moving for identical inputs. So
 * both `selectionThresholdEvidence` and `readThresholdEvidence` come through
 * here, and nothing else builds this shape.
 */
function thresholdEvidenceBlock(
  counts: ThresholdEvidenceCounts,
  vintage: ThresholdFprBoundProvenance["vintage"],
): ThresholdEvidence {
  return {
    documentThreshold: counts.documentThreshold,
    localizedThreshold: counts.localizedThreshold,
    negatives: counts.negatives,
    falsePositives: counts.falsePositives,
    selectionFprUpper95Nominal: counts.selectionFprUpper95Nominal,
    certifiedFprUpper: null,
    fprBound: selectionFprBoundProvenance(vintage),
    positives: counts.positives,
    truePositives: counts.truePositives,
    recall: counts.recall,
  };
}

/**
 * Builds a fit-time `thresholdEvidence` block from the counts the search
 * produced. Stamps `vintage: "current"`, because a block this repository just
 * computed is by definition not a historical read.
 */
export function selectionThresholdEvidence(
  counts: ThresholdEvidenceCounts,
): ThresholdEvidence {
  return thresholdEvidenceBlock(counts, "current");
}

/**
 * A field of a threshold block, checked to be a finite number before it is
 * republished. The name is in the message because "some count is wrong" does not
 * tell an operator which artifact field to go look at.
 */
function requireFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail(
      `frozen threshold evidence field \`${field}\` is not a finite number ` +
        `(got ${typeof value === "number" ? String(value) : typeof value}): ` +
        "a threshold block is republished whole or not at all",
    );
  }
  return value;
}

/**
 * Reads a `thresholdEvidence` block of either vintage into the CURRENT shape, so
 * that a consumer which republishes one — `evidence-sanitizer`'s fit summary is
 * the only one — never emits the pre-A7 name.
 *
 * Pure and non-destructive: the block handed in is not mutated, so a historical
 * artifact's bytes, and therefore its `artifactDigest`, stay exactly as sealed.
 * That is deliberate — `validateFrozenCalibrationArtifact` recomputes the digest
 * over the object as read from disk, and normalizing before validating would
 * make every pre-A7 fit fail its own seal.
 *
 * Fail-closed over the WHOLE block, not just the bound. The block arrives as
 * `readJsonFile(...) as FrozenCalibrationArtifact` and the only validation it
 * passed is `validateFrozenCalibrationArtifact`, which recomputes
 * `artifactDigest` and checks no field's type. A bound whose `negatives` and
 * `falsePositives` are missing cannot be re-derived by an auditor, which is the
 * same defect as no bound at all — so every count and threshold is required to be
 * a finite number here (`localizedThreshold` may also be `null`, which is a real
 * state: a warning path with no localized threshold).
 */
export function readThresholdEvidence(
  evidence: ThresholdEvidence | LegacyThresholdEvidencePreA7,
): ThresholdEvidence {
  // Shared by both vintages, so read before deciding which one this is. The
  // bound is the one field whose NAME depends on the vintage, so it is added by
  // the branch below.
  const counts = {
    documentThreshold: requireFiniteNumber(
      evidence.documentThreshold,
      "documentThreshold",
    ),
    localizedThreshold:
      evidence.localizedThreshold === null
        ? null
        : requireFiniteNumber(
            evidence.localizedThreshold,
            "localizedThreshold",
          ),
    negatives: requireFiniteNumber(evidence.negatives, "negatives"),
    falsePositives: requireFiniteNumber(
      evidence.falsePositives,
      "falsePositives",
    ),
    positives: requireFiniteNumber(evidence.positives, "positives"),
    truePositives: requireFiniteNumber(evidence.truePositives, "truePositives"),
    recall: requireFiniteNumber(evidence.recall, "recall"),
  } as const;
  if ("selectionFprUpper95Nominal" in evidence) {
    // Both names at once is the shape a migration tool would write mid-flight.
    // Read as current, the legacy number would be dropped without a word, and
    // nothing says the two agree. There is no defensible winner, so refuse.
    if ("fprUpper95" in evidence) {
      fail(
        "frozen threshold evidence carries both selectionFprUpper95Nominal and " +
          "the pre-A7 fprUpper95: refusing to guess which bound is authoritative",
      );
    }
    // Division of labour with `requireFiniteNumber` below: absent or non-numeric
    // is "no bound under either name", which is its own diagnosis and its own
    // message; NaN and Infinity are numbers, so the finite check catches those.
    if (typeof evidence.selectionFprUpper95Nominal !== "number") {
      fail(NO_FPR_BOUND_MESSAGE);
    }
    // The provenance is derived by the constructor, never copied from disk: that
    // block is what THIS module asserts about the number it just read, not data
    // to be trusted from the file. It is a constant apart from `vintage`, and
    // only the branch taken here can know the vintage. So a block cannot arrive
    // without provenance, or with a vintage that contradicts the name it uses.
    return thresholdEvidenceBlock(
      {
        ...counts,
        selectionFprUpper95Nominal: requireFiniteNumber(
          evidence.selectionFprUpper95Nominal,
          "selectionFprUpper95Nominal",
        ),
      },
      "current",
    );
  }
  // Neither name, or a non-numeric one. This used to fall into the branch above,
  // where `selectionFprUpper95Nominal` became `undefined`, JSON.stringify
  // dropped the key, and a fit summary went out with NO FPR bound at all —
  // stamped `vintage: "current"`. Publishing no bound silently is the one thing
  // this function exists to prevent, so it fails closed instead.
  if (typeof evidence.fprUpper95 !== "number") fail(NO_FPR_BOUND_MESSAGE);
  return thresholdEvidenceBlock(
    {
      ...counts,
      selectionFprUpper95Nominal: requireFiniteNumber(
        evidence.fprUpper95,
        "fprUpper95",
      ),
    },
    "legacy-pre-a7",
  );
}

/**
 * The three governance identities that a self-digest covers, in ONE place each.
 *
 * Each is declared as `Record<keyof T, boolean>` — every field of the contract classified as
 * inside the identity or outside it. A field added to the contract and not classified is a
 * COMPILE error, which is the only thing that keeps a projection from silently going stale
 * while its digest still recomputes. The canonical serialization sorts keys, so selecting the
 * fields moves no digest.
 */

const DATASET_AUDIT_IDENTITY: Record<keyof DatasetAudit, boolean> = {
  datasetId: true,
  scientificUse: true,
  releaseEligible: true,
  recordCount: true,
  counts: true,
  sourceTypes: true,
  hardNegativeFamilies: true,
  generatorFamilies: true,
  labelBasisCounts: true,
  licenses: true,
  recordsSha256: true,
  reviewLedgerSha256: true,
  sourceManifestSha256: true,
  sealed: true,
  auditDigest: false,
};

const SOURCE_READINESS_IDENTITY: Record<
  keyof CorpusSourceReadinessReport,
  boolean
> = {
  schemaVersion: true,
  status: true,
  sourceManifestDigest: true,
  recordCount: true,
  sourceCount: true,
  acquisitionCounts: true,
  protocols: true,
  blockingReasons: true,
  reportDigest: false,
};

function identityOf<T extends object>(
  value: T,
  fields: Record<keyof T, boolean>,
): Record<string, unknown> {
  const projected: Record<string, unknown> = {};
  for (const key of Object.keys(fields) as (keyof T)[]) {
    if (fields[key]) projected[key as string] = value[key];
  }
  return projected;
}

/**
 * The identity fields `runtimeParityDigest` seals. Typed by the contract's own
 * `RuntimeParityDigestInput`, so a field added to the manifest and omitted here is a compile
 * error rather than a projection that quietly stops covering it.
 */
export function runtimeParityIdentity(
  parity: RuntimeParityManifestV1,
): RuntimeParityDigestInput {
  return {
    schemaVersion: parity.schemaVersion,
    modelId: parity.modelId,
    modelVersion: parity.modelVersion,
    bundleDigest: parity.bundleDigest,
    aggregationVersion: parity.aggregationVersion,
    contentCompositionVersion: parity.contentCompositionVersion,
    tokenizerDigest: parity.tokenizerDigest,
    inferenceCoreDigest: parity.inferenceCoreDigest,
  };
}

/** The identity fields `auditDigest` seals. */
export function datasetAuditIdentity(
  audit: DatasetAudit,
): Record<string, unknown> {
  return identityOf(audit, DATASET_AUDIT_IDENTITY);
}

/** The identity fields `reportDigest` seals. */
export function sourceReadinessIdentity(
  readiness: CorpusSourceReadinessReport,
): Record<string, unknown> {
  return identityOf(readiness, SOURCE_READINESS_IDENTITY);
}

/**
 * The one version of the frozen-calibration artifact this evaluator reads. It is a
 * CONSTANT and not only a literal type because the file enters by cast and the type
 * cannot check a file — `validateFrozenCalibrationArtifact` compares against this.
 */
export const FROZEN_CALIBRATION_SCHEMA_VERSION = 1;

export interface FrozenCalibrationArtifact {
  schemaVersion: typeof FROZEN_CALIBRATION_SCHEMA_VERSION;
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
  partitionsUsed: ["dev", "cal-A"];
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
  /**
   * What the cluster-atomised cross-validation ACHIEVED for each path: how many
   * split/exposure clusters the population held, whether every atom was a single
   * record-line, the class deviation each fold ended with against the floor no
   * packing could beat, and any atom too large for even balancing.
   *
   * It is NOT part of the sealed artifact and `artifactDigest` does not cover it.
   * That is a decision with a consequence, so it is stated rather than implied: the
   * block travels in its own file (`cross-validation.json`, written by
   * `benchmark/commands/fit.ts`) and an auditor holding only
   * `frozen-calibration.json` cannot verify it. The alternative was sealing it, which
   * would fix the shape of a diagnostic block that G1 still has to restructure across
   * `cal-A`/`cal-B`.
   *
   * What made this worth writing down: the block used to ride the rest-spread in
   * `fit.ts` INTO `frozen-calibration.json` while `artifactWithoutDigest` omitted it,
   * so the sealed file carried an unsealed key that could be edited on disk without
   * breaking its own digest. {@link sealedCalibrationArtifact} exists so the file and
   * the digest cannot drift apart again.
   */
  crossValidation: {
    document: FoldStratification;
    localized: FoldStratification;
  };
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
  if (input.partition !== "dev" && input.partition !== "cal-A") {
    fail("test partition is forbidden during fit");
  }

  // Re-parse both prediction manifests (closed schema, no coercion).
  const development = parsePredictionManifest(input.developmentManifest);
  const calibration = parsePredictionManifest(input.calibrationManifest);

  if (development.partition !== "dev") {
    fail("development manifest must declare the dev partition");
  }
  if (calibration.partition !== "cal-A") {
    fail("calibration manifest must declare the cal-A partition");
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
  const parityIdentity = runtimeParityIdentity(parity);
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
  const auditIdentity = datasetAuditIdentity(audit);
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
  const readinessIdentity = sourceReadinessIdentity(readiness);
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
  // `Object.create(null)`, not `{}`: the keys come from a parsed manifest, and assigning to
  // `__proto__` on a plain object replaces the prototype instead of creating a key — the key
  // would disappear from the canonical identity the digest is computed over.
  const strippedSource = Object.create(null) as Record<string, unknown>;
  for (const key of Object.keys(sourceObject)) {
    if (key !== "sourceManifestDigest") {
      strippedSource[key] = sourceObject[key];
    }
  }
  // Canonicalization can THROW on a hostile key — `__proto__` survives the copy above and
  // the canonical serializer refuses it. This path is fail-closed, so the refusal is right;
  // what matters is that it carries this module's coded error instead of leaking a
  // serializer exception to the caller.
  let recomputedSourceDigest: string;
  try {
    recomputedSourceDigest = canonicalDigest(strippedSource);
  } catch {
    fail("source manifest carries a key the canonical serialization refuses");
  }
  if (recomputedSourceDigest !== declaredSourceDigest) {
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

// Module-private search state, NOT an artifact shape. `fprUpper95` here is the
// budget test the search applies while it is still searching; it reaches the
// sealed artifact only as `selectionFprUpper95Nominal`, whose provenance block
// says on what data it was computed. Task A7 deliberately left both search
// functions byte-identical — it changed no arithmetic, no estimator and no
// comparison, only the name the artifact publishes.
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

function toClusteredSamples(
  samples: readonly FitSampleScores[],
  positives: readonly FitSampleScores[],
  path: "document" | "localized",
): ClusteredCalibrationSample[] {
  const read = (sample: FitSampleScores): number =>
    path === "document" ? sample.documentRawScore : sample.localizedRawScore;
  return [
    ...samples.map((sample) => ({
      id: sample.id,
      clusterRoot: sample.clusterRoot,
      rawScore: read(sample),
      label: 0 as const,
    })),
    ...positives.map((sample) => ({
      id: sample.id,
      clusterRoot: sample.clusterRoot,
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
 * The sealed artifact and NOTHING else out of a fit result — the object that may be
 * written to `frozen-calibration.json`.
 *
 * Its key set is `artifactWithoutDigest`'s plus `artifactDigest`, by construction and
 * not by convention, so every key of the written file is a key the digest covers.
 * `fit.ts` used to extract the same object with `const { applyDocument,
 * applyLocalized, ...rest } = frozen`, which silently carried whatever else
 * {@link FrozenCalibrationResult} grew — and it grew `crossValidation`, so the file
 * `benchmark/report.ts` calls "selado por `artifactDigest` e imutável" had a key
 * outside the seal. A rest-spread cannot express "exactly the sealed fields"; this
 * function can.
 */
export function sealedCalibrationArtifact(
  result: FrozenCalibrationArtifact,
): FrozenCalibrationArtifact {
  return {
    ...artifactWithoutDigest(result),
    artifactDigest: result.artifactDigest,
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

  // Calibrator fitting runs over the scored-only subset when the caller supplies
  // it; threshold selection below still runs over the full `samples`/`positives`.
  const calibratorSamples = input.calibratorSamples ?? input.samples;
  const calibratorPositives = input.calibratorPositives ?? input.positives;

  // No seed is passed: the fold assignment runs under the frozen CV seed the
  // policy declares, not under the fit seed. Handing `fitSeed` to the CV made the
  // folds — and therefore the calibrator the competition returned — move with a
  // number the contract froze for something else.
  const documentSelection = selectCalibrator(
    toClusteredSamples(calibratorSamples, calibratorPositives, "document"),
  );
  const localizedSelection = selectCalibrator(
    toClusteredSamples(calibratorSamples, calibratorPositives, "localized"),
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

  // The two searches above compute a nominal Wilson bound on the records that
  // chose the winning candidate. The artifact publishes that number under a name
  // that says so, plus an explicitly absent `certifiedFprUpper`: the certified
  // bound is a single measurement on the blind test at H1 and does not exist yet.
  const warningEvidence: ThresholdEvidence = selectionThresholdEvidence({
    documentThreshold: warning.documentThreshold,
    localizedThreshold: warning.localizedThreshold,
    negatives: negatives.length,
    falsePositives: warning.falsePositives,
    selectionFprUpper95Nominal: warning.fprUpper95,
    positives: positives.length,
    truePositives: warning.truePositives,
    recall: warning.recall,
  });
  const visualEvidence: ThresholdEvidence | null =
    visual === null
      ? null
      : selectionThresholdEvidence({
          documentThreshold: visual.documentThreshold,
          localizedThreshold: null,
          negatives: negatives.length,
          falsePositives: visual.falsePositives,
          selectionFprUpper95Nominal: visual.fprUpper95,
          positives: positives.length,
          truePositives: visual.truePositives,
          recall: visual.recall,
        });

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
    partitionsUsed: ["dev", "cal-A"],
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
    crossValidation: {
      document: documentSelection.stratification,
      localized: localizedSelection.stratification,
    },
  };
}

const SHA256_HEX = /^[a-f0-9]{64}$/u;

/**
 * The FORM of `predictionManifestDigests`: exactly `development` and `calibration`, each a
 * lowercase 64-character hex digest.
 *
 * A digest recomputation does not imply a form. The artifact reaches every command as
 * `readJsonFile(...) as FrozenCalibrationArtifact` — a cast, not a parser — so an artifact
 * re-sealed over a truncated or renamed block satisfies its own `artifactDigest` and is
 * then read BY KEY: `thresholdBinding` (benchmark/commands/evaluate.ts) takes `development`
 * and `calibration` as two of the seven digests the pre-registered cut is bound to, and the
 * public fit summary spreads the block whole (benchmark/evidence-sanitizer.ts).
 */
// `unknown` and not the declared property type: every command reads this artifact with
// `readJsonFile(...) as FrozenCalibrationArtifact`, so the declared type here is a claim
// about the file and not a fact about it.
function assertPredictionManifestDigestForm(digests: unknown): void {
  if (
    typeof digests !== "object" ||
    digests === null ||
    Array.isArray(digests)
  ) {
    fail("frozen calibration predictionManifestDigests is not an object");
  }
  const block = digests as Record<string, unknown>;
  const keys = Object.keys(block).sort();
  if (keys.join(",") !== "calibration,development") {
    fail(
      "frozen calibration predictionManifestDigests must carry exactly " +
        `[calibration, development] and carries [${keys.join(", ")}]`,
    );
  }
  for (const key of ["development", "calibration"] as const) {
    const found = block[key];
    if (typeof found !== "string" || !SHA256_HEX.test(found)) {
      fail(
        `frozen calibration predictionManifestDigests.${key} must be 64 lowercase hex characters`,
      );
    }
  }
}

/**
 * Recomputes `artifactDigest` over the frozen fields and refuses any drift.
 * Because the digest covers the embedded governance/identity digests, altering
 * the dataset audit, either prediction manifest or the readiness report after
 * the fit is detected here.
 *
 * The seal is not the whole check: it proves the bytes are the bytes that were sealed and
 * says nothing about their shape, so the one block a reader DEREFERENCES by key —
 * `predictionManifestDigests` — is also checked in form.
 *
 * The seal comes FIRST, and the order is a property of the suite rather than a taste: a
 * `frozen-calibration.json` with any one key deleted has to be refused for the SEAL, which
 * is what makes "every key of the written file is a key the digest covers" measurable by
 * deleting keys one at a time (benchmark/tests/fit.test.ts). A form check ahead of it would
 * answer for `predictionManifestDigests` before the seal could, and that key would then be
 * refused whether the digest covered it or not.
 */
export function validateFrozenCalibrationArtifact(
  artifact: FrozenCalibrationArtifact,
): void {
  const expected = canonicalDigest(artifactWithoutDigest(artifact));
  if (expected !== artifact.artifactDigest) {
    fail("frozen calibration artifactDigest does not match its contents");
  }
  // AFTER the seal, for the reason above, and it is not shape hygiene: the file enters
  // the two consumers by CAST (`as FrozenCalibrationArtifact` in commands/evaluate.ts and
  // commands/consume-holdout.ts), so the literal `1` of the type is a compile-time claim
  // about a file nothing parsed. A `schemaVersion: 2` document RE-SEALED — its own digest
  // recomputed over its own contents — satisfies the check above and every consumer then
  // reads fields whose meaning the version was supposed to fix.
  if (artifact.schemaVersion !== FROZEN_CALIBRATION_SCHEMA_VERSION) {
    fail(
      `frozen calibration declares schemaVersion ${String(artifact.schemaVersion)}, not ` +
        `${FROZEN_CALIBRATION_SCHEMA_VERSION}: the version is what fixes the meaning of ` +
        "every other field, and a re-sealed document of another version satisfies the " +
        "digest while saying something else",
    );
  }
  assertPredictionManifestDigestForm(artifact.predictionManifestDigests);
}
