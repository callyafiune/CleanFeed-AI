// The evidence sanitizer: it turns a completed, sealed release run into the
// CLOSED seven-file public evidence set and refuses to emit anything that could
// leak a record. Two guarantees compose here:
//
//   - a WHITELIST: every public file is rebuilt field-by-field from aggregate
//     inputs, so counts, digests, identities, gate reasons and timestamps pass
//     while raw records, prediction rows, shard paths and per-record arrays are
//     simply never copied; and
//   - a BLACKLIST with teeth (`assertSanitized`): a final recursive scan of each
//     built file rejects the exact record-level keys, any shard/raw path and any
//     array of at least 100 scalar ids — a disguised record-id list — so a future
//     field added by mistake fails closed rather than shipping private data.
//
// `evidence-digest.json` binds the set together: `scientificEvidenceDigest`
// (identical to `release.evidenceDigest` and `report.reportDigest`), the
// canonical sorted file/hash inventory of the OTHER six files, the
// `calibrationSetDigest`, and `publicationDigest = sha256(canonicalJson({
// schemaVersion: 1, files }))`. The manifest never hashes itself, never the
// mutable release-file bytes, and the scientific/calibration digests stay OUTSIDE
// the publication payload as cross-checks.
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Deterministic: no Date, no randomness; every digest is a pure function of the
// bytes it is fed.

import { canonicalJson, canonicalSha256 } from "../contracts/canonical-json.ts";
import type { CalibrationProfilesFileV1 } from "../contracts/calibration-profile.ts";
import type { ModelReleaseDescriptorV1 } from "../contracts/model-release.ts";
import type { CorpusSourceReadinessReport } from "../contracts/source-readiness.ts";
import type { FitReport } from "./candidate-preflight.ts";
import {
  readThresholdEvidence,
  type FrozenCalibrationArtifact,
} from "./calibration-pipeline.ts";
import type { DatasetAudit } from "./dataset-manifest.ts";
import { sha256BytesHex } from "./digests.ts";
import { renderReportMarkdown, type BenchmarkReport } from "./report.ts";
import type { SplitArtifact } from "./split-artifact.ts";

export { canonicalJson };

/** The closed set of files `publish-evidence` may write — nothing else. */
export const EVIDENCE_FILE_NAMES = [
  "dataset-summary.json",
  "split-summary.json",
  "fit-summary.json",
  "benchmark-report.json",
  "benchmark-report.md",
  "decision.json",
  "evidence-digest.json",
] as const;

export type EvidenceFileName = (typeof EVIDENCE_FILE_NAMES)[number];

/** The six files whose bytes are hashed into the evidence-digest inventory. */
export const INVENTORY_FILE_NAMES: readonly EvidenceFileName[] =
  EVIDENCE_FILE_NAMES.filter((name) => name !== "evidence-digest.json");

/**
 * Exact record-level keys that must NEVER appear in public evidence. Note that
 * `predictions` is forbidden while the safe aggregate `predictionManifestDigests`
 * is not an exact match and is therefore preserved.
 */
export const FORBIDDEN_RECORD_KEYS: readonly string[] = [
  "text",
  "url",
  "author",
  "prompt",
  "contentSha256",
  "consentReceiptDigest",
  "sourceIdentifier",
  "records",
  "recordIds",
  "predictionRows",
  "predictions",
];

/** An array of at least this many scalar ids is treated as a disguised record list. */
export const MAX_SCALAR_ID_ARRAY_LENGTH = 100;

/** Coded, fail-closed error thrown by the sanitizer. */
export class EvidenceSanitizerError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "EvidenceSanitizerError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new EvidenceSanitizerError(code, message);
}

// A string that points at raw or sharded run output. Digests (64-hex),
// timestamps, identity strings, profile ids and family names never match.
function looksLikeRawPath(value: string): boolean {
  return (
    /shard[-_]?\d+/iu.test(value) ||
    /\.jsonl(?:$|[^a-z])/iu.test(value) ||
    /benchmark[\\/](?:data|out|work)[\\/]/iu.test(value) ||
    /(?:^|[\\/])private[\\/]/iu.test(value) ||
    /\b(?:records|predictions|test-input|test-labels)\.jsonl?\b/iu.test(value)
  );
}

function isScalarId(value: unknown): boolean {
  return typeof value === "string" || typeof value === "number";
}

/**
 * Recursively refuses any value carrying a forbidden record-level key, a raw or
 * shard path string, or an array of at least 100 scalar ids. Aggregate objects
 * (count maps, digests, gate reasons) pass untouched.
 */
export function assertSanitized(value: unknown, where = "$"): void {
  if (typeof value === "string") {
    if (looksLikeRawPath(value)) {
      fail(
        "FORBIDDEN_PATH",
        `${where} looks like a raw or shard path: ${value}`,
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    if (
      value.length >= MAX_SCALAR_ID_ARRAY_LENGTH &&
      value.every((element) => isScalarId(element))
    ) {
      fail(
        "FORBIDDEN_ID_ARRAY",
        `${where} is an array of ${value.length} scalar ids (>= ${MAX_SCALAR_ID_ARRAY_LENGTH})`,
      );
    }
    value.forEach((element, index) =>
      assertSanitized(element, `${where}[${index}]`),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      if (FORBIDDEN_RECORD_KEYS.includes(key)) {
        fail(
          "FORBIDDEN_KEY",
          `${where}.${key} is a forbidden record-level key`,
        );
      }
      assertSanitized(child, `${where}.${key}`);
    }
  }
}

export interface EvidenceInput {
  datasetAudit: DatasetAudit;
  sourceReadiness: CorpusSourceReadinessReport;
  splitArtifact: SplitArtifact;
  frozenCalibration: FrozenCalibrationArtifact;
  fitReport: FitReport;
  report: BenchmarkReport;
  release: ModelReleaseDescriptorV1;
  profiles: CalibrationProfilesFileV1;
}

export interface EvidenceInventoryEntry {
  file: string;
  sha256: string;
}

export interface EvidenceDigestFileV1 {
  schemaVersion: 1;
  scientificEvidenceDigest: string;
  calibrationSetDigest: string;
  files: EvidenceInventoryEntry[];
  publicationDigest: string;
}

export interface EvidenceFile {
  name: EvidenceFileName;
  content: string;
}

export interface EvidenceBundle {
  files: EvidenceFile[];
  evidenceDigest: EvidenceDigestFileV1;
}

function jsonBytes(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function datasetSummary(input: EvidenceInput): unknown {
  const audit = input.datasetAudit;
  const readiness = input.sourceReadiness;
  return {
    schemaVersion: 1,
    datasetId: audit.datasetId,
    scientificUse: audit.scientificUse,
    releaseEligible: audit.releaseEligible,
    recordCount: audit.recordCount,
    counts: { ...audit.counts },
    sourceTypes: { ...audit.sourceTypes },
    hardNegativeFamilies: { ...audit.hardNegativeFamilies },
    generatorFamilies: { ...audit.generatorFamilies },
    licenses: [...audit.licenses],
    datasetDigest: input.report.dataset.digest,
    datasetAuditDigest: audit.auditDigest,
    sourceReadiness: {
      status: readiness.status,
      sourceManifestDigest: readiness.sourceManifestDigest,
      recordCount: readiness.recordCount,
      sourceCount: readiness.sourceCount,
      acquisitionCounts: { ...readiness.acquisitionCounts },
      protocols: { ...readiness.protocols },
      reportDigest: readiness.reportDigest,
    },
  };
}

function splitSummary(input: EvidenceInput): unknown {
  const split = input.splitArtifact;
  const audit = split.audit;
  // The per-record `assignments` array is deliberately omitted: the closed
  // summary carries only the split's digests, counts, cutoffs and audit verdict.
  return {
    schemaVersion: 1,
    datasetDigest: split.datasetDigest,
    algorithm: split.algorithm,
    algorithmDigest: split.algorithmDigest,
    seed: split.seed,
    splitDigest: split.splitDigest,
    assignmentsDigest: split.assignmentsDigest,
    compositionAttestation: split.compositionAttestation,
    cutoffs: { ...split.cutoffs },
    counts: { ...split.counts },
    heldOutGeneratorFamilies: [...split.heldOutGeneratorFamilies],
    audit: {
      sizes: { ...audit.sizes },
      classFractions: {
        human: { ...audit.classFractions.human },
        ai: { ...audit.classFractions.ai },
        mixed: { ...audit.classFractions.mixed },
      },
      cutoffs: { ...audit.cutoffs },
      leakageCount: audit.leakages.length,
      criticalSliceSampleCount: audit.criticalSliceSamples.length,
      heldOutGeneratorFamilies: [...audit.heldOutGeneratorFamilies],
      passed: audit.passed,
      reasons: [...audit.reasons],
    },
  };
}

function fitSummary(input: EvidenceInput): unknown {
  const frozen = input.frozenCalibration;
  const preflight = input.fitReport.preflight;
  const cut = input.fitReport.provisionalThreshold;
  return {
    schemaVersion: 1,
    // The cut the release DECIDED on, as a closed projection: which score, which
    // quantile, the value, the population it was taken over and the digest of the sealed
    // artifact. The benchmark report names a threshold SOURCE and the profiles carry the
    // number, but neither published the population or the artifact digest, so a reader
    // holding the public bundle could not check the cut against the pre-registration it
    // claims to follow. Counts only — the sample itself never leaves the fit.
    provisionalThreshold: {
      thresholdVersion: cut.thresholdVersion,
      thresholdBasis: cut.thresholdBasis,
      threshold: cut.threshold,
      fitPartitions: [...cut.fitPartitions],
      quantile: cut.preRegistration.quantile,
      side: cut.preRegistration.side,
      probabilisticCalibrator: cut.preRegistration.probabilisticCalibrator,
      population: { ...cut.population },
      artifactDigest: cut.artifactDigest,
    },
    fitSeed: frozen.fitSeed,
    partitionsUsed: [...frozen.partitionsUsed],
    model: { ...frozen.model },
    scoringRuntime: { ...frozen.scoringRuntime },
    // Safe aggregate — REQUIRED where defined.
    predictionManifestDigests: { ...frozen.predictionManifestDigests },
    datasetDigest: frozen.datasetDigest,
    datasetAuditDigest: frozen.datasetAuditDigest,
    sourceReadinessDigest: frozen.sourceReadinessDigest,
    splitDigest: frozen.splitDigest,
    evaluatorDigest: frozen.evaluatorDigest,
    calibrationArtifactDigest: frozen.artifactDigest,
    thresholds: { ...frozen.thresholds },
    // This is the only place a frozen artifact's threshold evidence is emitted
    // into a public file, so it is where the pre-A7 field name has to stop. A
    // historical artifact is still readable — `readThresholdEvidence` copies and
    // never mutates, so its sealed bytes and its artifactDigest are untouched —
    // but the published bundle only ever carries `selectionFprUpper95Nominal`,
    // with the vintage marked and `certifiedFprUpper` explicitly absent.
    thresholdEvidence: {
      warning: readThresholdEvidence(frozen.thresholdEvidence.warning),
      visual:
        frozen.thresholdEvidence.visual === null
          ? null
          : readThresholdEvidence(frozen.thresholdEvidence.visual),
    },
    preflight: {
      status: preflight.status,
      freeDiskBytes: preflight.freeDiskBytes,
      blockingReasons: [...preflight.blockingReasons],
    },
  };
}

function benchmarkReportEvidence(report: BenchmarkReport): unknown {
  // A closed projection of the sealed report: every scientific field, none of
  // the raw run inputs (the report already carries no record text).
  return {
    schemaVersion: report.schemaVersion,
    generatedAt: report.generatedAt,
    holdoutConsumptionId: report.holdoutConsumptionId,
    dataset: { ...report.dataset },
    datasetAuditDigest: report.datasetAuditDigest,
    sourceReadinessDigest: report.sourceReadinessDigest,
    split: {
      digest: report.split.digest,
      strategy: report.split.strategy,
      audit: report.split.audit,
    },
    evaluatorDigest: report.evaluatorDigest,
    runtimeParityDigest: report.runtimeParityDigest,
    model: { ...report.model },
    scoringRuntime: { ...report.scoringRuntime },
    predictionManifestDigests: { ...report.predictionManifestDigests },
    calibrationArtifactDigest: report.calibrationArtifactDigest,
    metrics: report.metrics,
    slices: report.slices,
    gates: report.gates,
    releaseDecision: report.releaseDecision,
    reportDigest: report.reportDigest,
    notes: [...report.notes],
  };
}

function decisionSummary(input: EvidenceInput): unknown {
  const report = input.report;
  const release = input.release;
  return {
    schemaVersion: 1,
    releaseDecision: report.releaseDecision,
    gateDecision: release.gateDecision,
    rolloutState: release.rolloutState,
    reportDigest: report.reportDigest,
    evidenceDigest: release.evidenceDigest,
    calibrationSetDigest: release.calibrationSetDigest,
    profileDigests: [...release.profileDigests],
    holdoutConsumptionId: report.holdoutConsumptionId,
    generatedAt: report.generatedAt,
    issuedAt: release.issuedAt,
    model: {
      id: report.model.id,
      version: report.model.version,
      bundleDigest: report.model.bundleDigest,
      tokenizerDigest: report.model.tokenizerDigest,
      aggregationVersion: report.model.aggregationVersion,
      contentCompositionVersion: report.model.contentCompositionVersion,
    },
    scoringRuntime: { ...report.scoringRuntime },
    runtimeParityDigest: report.runtimeParityDigest,
    failedGates: {
      integrity: [...report.gates.failedIntegrity],
      warning: [...report.gates.failedWarning],
      action: [...report.gates.failedAction],
      // The cross-tier subset that falls on a pre-registered hypothesis. A summary
      // with the three tiers and not this one publishes what was blocked without
      // publishing which certified claim of the version fell with it.
      certifying: [...report.gates.failedCertifying],
    },
    notes: [...report.notes],
  };
}

/**
 * Builds the closed seven-file evidence set from a completed, sealed run. The
 * only hard cross-check performed here is that the release evidence digest and
 * the report digest agree, because the published `scientificEvidenceDigest`
 * copies that value; every other binding is the caller's (publish-evidence).
 */
export async function buildEvidenceBundle(
  input: EvidenceInput,
): Promise<EvidenceBundle> {
  if (input.release.evidenceDigest !== input.report.reportDigest) {
    fail(
      "EVIDENCE_DIGEST_MISMATCH",
      "release evidenceDigest does not equal the report reportDigest",
    );
  }

  const contentObjects: Record<string, unknown> = {
    "dataset-summary.json": datasetSummary(input),
    "split-summary.json": splitSummary(input),
    "fit-summary.json": fitSummary(input),
    "benchmark-report.json": benchmarkReportEvidence(input.report),
    "decision.json": decisionSummary(input),
  };

  // Defense in depth: the closed projections above should never carry private
  // content, but the scan is the fail-closed proof of it.
  for (const [name, value] of Object.entries(contentObjects)) {
    assertSanitized(value, name);
  }

  const markdown = renderReportMarkdown(input.report);

  const contentBytes = new Map<EvidenceFileName, string>([
    ["dataset-summary.json", jsonBytes(contentObjects["dataset-summary.json"])],
    ["split-summary.json", jsonBytes(contentObjects["split-summary.json"])],
    ["fit-summary.json", jsonBytes(contentObjects["fit-summary.json"])],
    [
      "benchmark-report.json",
      jsonBytes(contentObjects["benchmark-report.json"]),
    ],
    ["benchmark-report.md", markdown],
    ["decision.json", jsonBytes(contentObjects["decision.json"])],
  ]);

  const files: EvidenceInventoryEntry[] = [...INVENTORY_FILE_NAMES]
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
    .map((name) => ({
      file: name,
      sha256: sha256BytesHex(
        new TextEncoder().encode(contentBytes.get(name) as string),
      ),
    }));

  const publicationDigest = await canonicalSha256({ schemaVersion: 1, files });

  const evidenceDigest: EvidenceDigestFileV1 = {
    schemaVersion: 1,
    scientificEvidenceDigest: input.report.reportDigest,
    calibrationSetDigest: input.release.calibrationSetDigest,
    files,
    publicationDigest,
  };
  assertSanitized(evidenceDigest, "evidence-digest.json");

  const bundle: EvidenceFile[] = [];
  for (const name of EVIDENCE_FILE_NAMES) {
    if (name === "evidence-digest.json") {
      bundle.push({ name, content: jsonBytes(evidenceDigest) });
    } else {
      bundle.push({ name, content: contentBytes.get(name) as string });
    }
  }

  return { files: bundle, evidenceDigest };
}
