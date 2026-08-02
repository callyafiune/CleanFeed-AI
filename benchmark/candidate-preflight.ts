// Candidate freeze preflight: the closed, fail-SOFT readiness report that must
// be `ready` BEFORE the Phase 2 calibration pipeline is allowed to freeze a
// release candidate — and the fail-CLOSED cross-check that binds the frozen
// artifact back to that exact report afterwards.
//
// Unlike `calibration-pipeline.ts` (which THROWS on the first governance fault),
// the preflight accumulates every fault into `blockingReasons` and returns a
// single closed `CandidatePreflightReport`. `runFit` requires `status: "ready"`
// before it fits, and re-verifies each sealed digest against the report once the
// artifact exists. Every check here is redundant with `validateFitInputs`; that
// redundancy is deliberate defense-in-depth so a candidate can never be frozen
// on inputs that would not, independently, survive both gates.
//
// What is checked (all over dev/cal-A ONLY — the blocked test is never read, and
// neither is train or cal-B):
//   - the dataset audit is sealed, self-consistent and bound to the manifest;
//   - the source readiness report is `ready` and self-consistent, and its
//     source-manifest self-digest bridges to the sealed raw file SHA-256;
//   - the runtime-parity manifest is self-consistent and matches the candidate
//     prediction identities;
//   - the two prediction manifests share one model/tokenizer/aggregation/
//     composition/build/parity identity, are WASM + the pinned Chrome, declare
//     the dev and cal-A partitions (never test, never a holdout consumption id),
//     and their recorded digests recompute;
//   - the reviewed licenses are present and approved (verified bundle/license);
//   - the union of the two prediction id sets covers EXACTLY the dev + cal-A split
//     assignments (no missing, no extra, no cross-artifact collision) — so no test,
//     train or cal-B prediction is ever an accepted input;
//   - the leakage audit of the split passed;
//   - at least 20 GiB of disk is free.
//
// Standalone benchmark module: it MUST NOT import from the extension bundle
// (src/). It reuses the pure contracts and the sibling benchmark primitives and
// is synchronous and deterministic — no Date, no randomness, no network, no
// model calls, and (unlike the fit command) no filesystem access: the free-disk
// figure is measured by the caller and passed in.

import { canonicalJson } from "../contracts/canonical-json.ts";
import type { CorpusSourceReadinessReport } from "../contracts/source-readiness.ts";
import type { RuntimeParityManifestV1 } from "../contracts/runtime-parity.ts";
import type { FrozenCalibrationArtifact } from "./calibration-pipeline.ts";
import {
  datasetAuditIdentity,
  runtimeParityIdentity,
  sourceReadinessIdentity,
} from "./calibration-pipeline.ts";
import type { DatasetAudit, DatasetManifest } from "./dataset-manifest.ts";
import { sha256BytesHex } from "./digests.ts";
import {
  RELEASE_CHROME_VERSION,
  type PredictionManifestV1,
} from "./prediction-schema.ts";
import type { SplitArtifact } from "./split-artifact.ts";
import { FIT_PARTITIONS, type Partition } from "./split.ts";

/** At least this many free bytes (20 GiB) must be available before a freeze. */
export const MIN_FREE_DISK_BYTES = 20 * 1024 ** 3;

/** The closed candidate freeze preflight report. */
export interface CandidatePreflightReport {
  status: "ready" | "blocked";
  datasetDigest: string;
  datasetAuditDigest: string;
  sourceReadinessDigest: string;
  splitDigest: string;
  model: Pick<
    PredictionManifestV1,
    | "modelId"
    | "modelVersion"
    | "bundleDigest"
    | "aggregationVersion"
    | "contentCompositionVersion"
    | "tokenizerDigest"
    | "runtimeParityDigest"
    | "extensionBuildDigest"
    | "backend"
    | "chromeVersion"
  >;
  developmentPredictionManifestDigest: string;
  calibrationPredictionManifestDigest: string;
  freeDiskBytes: number;
  blockingReasons: string[];
}

/**
 * The already-parsed governance/prediction inputs the preflight cross-checks.
 * Everything here has been parsed through its closed contract by the caller; the
 * preflight recomputes digests and cross-references them but performs no I/O.
 */
export interface CandidatePreflightInput {
  datasetManifest: DatasetManifest;
  datasetAudit: DatasetAudit;
  sourceReadiness: CorpusSourceReadinessReport;
  runtimeParity: RuntimeParityManifestV1;
  /** Exact bytes of the reviewed source manifest (private/source-manifest.json). */
  sourceManifestBytes: string;
  splitArtifact: SplitArtifact;
  developmentManifest: PredictionManifestV1;
  developmentManifestDigest: string;
  calibrationManifest: PredictionManifestV1;
  calibrationManifestDigest: string;
  /** Ids that appear (any status) in the development prediction artifact. */
  developmentPredictionIds: readonly string[];
  /** Ids that appear (any status) in the calibration prediction artifact. */
  calibrationPredictionIds: readonly string[];
  /** Free disk bytes measured by the caller (never measured here). */
  freeDiskBytes: number;
}

/** The sealed fit report written alongside the frozen calibration. */
export interface FitReport {
  schemaVersion: 1;
  preflight: CandidatePreflightReport;
  calibrationArtifactDigest: string;
  fitSeed: number;
  partitionsUsed: ["dev", "cal-A"];
  model: FrozenCalibrationArtifact["model"];
  scoringRuntime: FrozenCalibrationArtifact["scoringRuntime"];
  predictionManifestDigests: FrozenCalibrationArtifact["predictionManifestDigests"];
  datasetDigest: string;
  datasetAuditDigest: string;
  sourceReadinessDigest: string;
  splitDigest: string;
  evaluatorDigest: string;
  thresholds: FrozenCalibrationArtifact["thresholds"];
  thresholdEvidence: FrozenCalibrationArtifact["thresholdEvidence"];
  selectionEvidence: FrozenCalibrationArtifact["selectionEvidence"];
}

/** Coded, fail-closed error thrown by the frozen-vs-preflight cross-check. */
export class CandidatePreflightError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CandidatePreflightError";
  }
}

/** Synchronous canonical SHA-256 — byte-identical to `canonicalSha256`. */
function canonicalDigest(value: unknown): string {
  return sha256BytesHex(new TextEncoder().encode(canonicalJson(value)));
}

// The identity fields the two prediction manifests must share, mirroring
// `calibration-pipeline.ts` so the two gates agree byte for byte.
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
 * Produces the closed candidate preflight report. NEVER throws for a governance
 * fault: every fault is collected into `blockingReasons` and the status is
 * `blocked` unless the list is empty.
 */
export function runCandidatePreflight(
  input: CandidatePreflightInput,
): CandidatePreflightReport {
  const reasons: string[] = [];
  const add = (reason: string): void => {
    reasons.push(reason);
  };

  const development = input.developmentManifest;
  const calibration = input.calibrationManifest;

  // --- prediction identity, parity and WASM/Chrome shell --------------------
  if (development.partition !== "dev") {
    add("development prediction manifest does not declare the dev partition");
  }
  if (calibration.partition !== "cal-A") {
    add("calibration prediction manifest does not declare the cal-A partition");
  }
  // Absence of any test-prediction input: a test manifest carries a holdout
  // consumption id, and no fit manifest ever does.
  if (development.holdoutConsumptionId !== null) {
    add(
      "development prediction manifest carries a holdout consumption id (test input)",
    );
  }
  if (calibration.holdoutConsumptionId !== null) {
    add(
      "calibration prediction manifest carries a holdout consumption id (test input)",
    );
  }

  for (const [label, manifest] of [
    ["development", development],
    ["calibration", calibration],
  ] as const) {
    if (manifest.backend !== "wasm") {
      add(
        `${label} prediction manifest is not WASM (release-eligible scoring is WASM only)`,
      );
    }
    if (manifest.chromeVersion !== RELEASE_CHROME_VERSION) {
      add(
        `${label} prediction manifest Chrome is not the pinned release ${RELEASE_CHROME_VERSION}`,
      );
    }
  }

  for (const field of IDENTITY_FIELDS) {
    if (development[field] !== calibration[field]) {
      add(
        `development and calibration prediction manifests diverge on ${field} (identity mismatch)`,
      );
    }
  }

  // Recorded prediction-manifest digests must recompute over the parsed bytes.
  if (canonicalDigest(development) !== input.developmentManifestDigest) {
    add("development prediction manifest digest does not match its contents");
  }
  if (canonicalDigest(calibration) !== input.calibrationManifestDigest) {
    add("calibration prediction manifest digest does not match its contents");
  }

  // Runtime parity binds the SAME inference core as benchmark and release.
  const parity = input.runtimeParity;
  const parityIdentity = runtimeParityIdentity(parity);
  if (canonicalDigest(parityIdentity) !== parity.runtimeParityDigest) {
    add("runtime parity digest does not match its identity fields");
  }
  if (parity.runtimeParityDigest !== development.runtimeParityDigest) {
    add("runtime parity digest diverges from the prediction manifests");
  }
  if (
    parity.modelId !== development.modelId ||
    parity.modelVersion !== development.modelVersion ||
    parity.bundleDigest !== development.bundleDigest ||
    parity.tokenizerDigest !== development.tokenizerDigest ||
    parity.aggregationVersion !== development.aggregationVersion ||
    parity.contentCompositionVersion !== development.contentCompositionVersion
  ) {
    add("runtime parity identity diverges from the prediction manifests");
  }

  // --- dataset audit: sealed, self-consistent, bound to the manifest --------
  const audit = input.datasetAudit;
  const manifest = input.datasetManifest;
  if (audit.sealed !== true) {
    add("dataset audit is not sealed");
  }
  const auditIdentity = datasetAuditIdentity(audit);
  if (canonicalDigest(auditIdentity) !== audit.auditDigest) {
    add("dataset auditDigest does not match the recomputed audit");
  }
  if (audit.datasetId !== manifest.datasetId) {
    add("dataset audit was sealed for a different dataset");
  }
  if (
    audit.recordsSha256 !== manifest.recordsSha256 ||
    audit.reviewLedgerSha256 !== manifest.reviewLedgerSha256 ||
    audit.sourceManifestSha256 !== manifest.sourceManifestSha256
  ) {
    add("dataset audit file digests diverge from the dataset manifest");
  }
  if (audit.releaseEligible !== (manifest.scientificUse === "release")) {
    add(
      "dataset audit releaseEligible does not match the manifest scientificUse",
    );
  }

  // Verified license: at least one reviewed license, all approved for use.
  if (manifest.licenses.length === 0) {
    add("dataset manifest carries no license");
  }
  for (const license of manifest.licenses) {
    if (license.evaluationUseApproved !== true) {
      add(`license "${license.id}" is not approved for evaluation use`);
    }
  }

  // --- source readiness: ready, self-consistent, bridged to the raw file ----
  const readiness = input.sourceReadiness;
  if (readiness.status !== "ready") {
    add("source readiness report is not ready");
  }
  const readinessIdentity = sourceReadinessIdentity(readiness);
  if (canonicalDigest(readinessIdentity) !== readiness.reportDigest) {
    add("source readiness reportDigest does not match the recomputed report");
  }

  // Bridge both governance reports to the SAME source-manifest bytes.
  const rawSha = sha256BytesHex(
    new TextEncoder().encode(input.sourceManifestBytes),
  );
  if (rawSha !== audit.sourceManifestSha256) {
    add("source manifest bytes do not match the sealed raw SHA-256");
  }
  let sourceManifest: unknown;
  let parsedSource = true;
  try {
    sourceManifest = JSON.parse(input.sourceManifestBytes);
  } catch {
    parsedSource = false;
    add("source manifest bytes are not valid JSON");
  }
  if (parsedSource) {
    if (
      typeof sourceManifest !== "object" ||
      sourceManifest === null ||
      Array.isArray(sourceManifest)
    ) {
      add("source manifest must be a JSON object");
    } else {
      const sourceObject = sourceManifest as Record<string, unknown>;
      const declaredSourceDigest = sourceObject.sourceManifestDigest;
      if (typeof declaredSourceDigest !== "string") {
        add("source manifest must carry a sourceManifestDigest");
      } else {
        // `Object.create(null)`, not `{}`: the keys come from a parsed manifest, and assigning to
        // `__proto__` on a plain object replaces the prototype instead of creating a key — the key
        // would disappear from the canonical identity the digest is computed over.
        const strippedSource = Object.create(null) as Record<string, unknown>;
        for (const key of Object.keys(sourceObject)) {
          if (key !== "sourceManifestDigest") {
            strippedSource[key] = sourceObject[key];
          }
        }
        // Canonicalization can THROW on a hostile key — `__proto__` survives the copy above
        // and the canonical serializer refuses it — and this function's contract is that a
        // governance failure comes back as a blocking reason, never as an exception.
        let recomputedSourceDigest: string | null = null;
        try {
          recomputedSourceDigest = canonicalDigest(strippedSource);
        } catch {
          add(
            "source manifest carries a key the canonical serialization refuses",
          );
        }
        if (
          recomputedSourceDigest !== null &&
          recomputedSourceDigest !== declaredSourceDigest
        ) {
          add(
            "source manifest sourceManifestDigest is inconsistent with its body",
          );
        }
        if (declaredSourceDigest !== readiness.sourceManifestDigest) {
          add("source manifest digest diverges from the readiness report");
        }
      }
    }
  }

  // --- split leakage audit and prediction coverage --------------------------
  if (input.splitArtifact.audit.passed !== true) {
    add("split artifact carries a leakage audit that did not pass");
  }

  // POSITIVE allowlist, for the same reason as in `commands/fit.ts`: a negative filter
  // over partition names admits `train` and `cal-B`, and the compiler cannot see it.
  const fitPopulationIds = input.splitArtifact.assignments
    .filter((assignment) =>
      (FIT_PARTITIONS as readonly Partition[]).includes(assignment.partition),
    )
    .map((assignment) => assignment.id);
  const expected = new Set(fitPopulationIds);
  const combined = [
    ...input.developmentPredictionIds,
    ...input.calibrationPredictionIds,
  ];
  const seen = new Set<string>();
  const collisions: string[] = [];
  for (const id of combined) {
    if (seen.has(id)) collisions.push(id);
    seen.add(id);
  }
  const missing = [...expected].filter((id) => !seen.has(id)).sort();
  const extra = [...seen].filter((id) => !expected.has(id)).sort();
  if (collisions.length > 0) {
    add(
      `prediction id collision across the development and calibration artifacts: ${[...new Set(collisions)].sort().join(",")}`,
    );
  }
  if (missing.length > 0 || extra.length > 0) {
    add(
      `prediction coverage does not match the fit split (dev + cal-A): ` +
        `missing=${missing.join(",")} extra=${extra.join(",")}`,
    );
  }

  // --- free disk ------------------------------------------------------------
  if (
    !Number.isFinite(input.freeDiskBytes) ||
    input.freeDiskBytes < MIN_FREE_DISK_BYTES
  ) {
    add(
      `insufficient free disk: ${input.freeDiskBytes} bytes available, at least ${MIN_FREE_DISK_BYTES} (20 GiB) required`,
    );
  }

  return {
    status: reasons.length === 0 ? "ready" : "blocked",
    datasetDigest: development.datasetDigest,
    datasetAuditDigest: audit.auditDigest,
    sourceReadinessDigest: readiness.reportDigest,
    splitDigest: development.splitDigest,
    model: {
      modelId: development.modelId,
      modelVersion: development.modelVersion,
      bundleDigest: development.bundleDigest,
      aggregationVersion: development.aggregationVersion,
      contentCompositionVersion: development.contentCompositionVersion,
      tokenizerDigest: development.tokenizerDigest,
      runtimeParityDigest: development.runtimeParityDigest,
      extensionBuildDigest: development.extensionBuildDigest,
      backend: development.backend,
      chromeVersion: development.chromeVersion,
    },
    developmentPredictionManifestDigest: input.developmentManifestDigest,
    calibrationPredictionManifestDigest: input.calibrationManifestDigest,
    freeDiskBytes: input.freeDiskBytes,
    blockingReasons: reasons,
  };
}

/**
 * Fail-closed cross-check that the frozen calibration artifact carries exactly
 * the identities and digests the ready preflight observed. Because the preflight
 * and the fit both derive these from the same inputs, any divergence means the
 * fit did not run on the very inputs the freeze was cleared for — a hard stop.
 */
export function verifyFrozenAgainstPreflight(
  frozen: FrozenCalibrationArtifact,
  report: CandidatePreflightReport,
): void {
  const mismatches: string[] = [];
  const check = (label: string, actual: unknown, expected: unknown): void => {
    if (actual !== expected) {
      mismatches.push(`${label} does not match the preflight report`);
    }
  };

  check("datasetDigest", frozen.datasetDigest, report.datasetDigest);
  check(
    "datasetAuditDigest",
    frozen.datasetAuditDigest,
    report.datasetAuditDigest,
  );
  check(
    "sourceReadinessDigest",
    frozen.sourceReadinessDigest,
    report.sourceReadinessDigest,
  );
  check("splitDigest", frozen.splitDigest, report.splitDigest);
  check(
    "development prediction manifest digest",
    frozen.predictionManifestDigests.development,
    report.developmentPredictionManifestDigest,
  );
  check(
    "calibration prediction manifest digest",
    frozen.predictionManifestDigests.calibration,
    report.calibrationPredictionManifestDigest,
  );
  check("modelId", frozen.model.modelId, report.model.modelId);
  check("modelVersion", frozen.model.modelVersion, report.model.modelVersion);
  check("bundleDigest", frozen.model.bundleDigest, report.model.bundleDigest);
  check(
    "tokenizerDigest",
    frozen.model.tokenizerDigest,
    report.model.tokenizerDigest,
  );
  check(
    "aggregationVersion",
    frozen.model.aggregationVersion,
    report.model.aggregationVersion,
  );
  check(
    "contentCompositionVersion",
    frozen.model.contentCompositionVersion,
    report.model.contentCompositionVersion,
  );
  check(
    "runtime parity digest",
    frozen.scoringRuntime.runtimeParityDigest,
    report.model.runtimeParityDigest,
  );
  check(
    "extensionBuildDigest",
    frozen.scoringRuntime.extensionBuildDigest,
    report.model.extensionBuildDigest,
  );
  check("backend", frozen.scoringRuntime.backend, report.model.backend);
  check(
    "chromeVersion",
    frozen.scoringRuntime.chromeVersion,
    report.model.chromeVersion,
  );

  if (mismatches.length > 0) {
    throw new CandidatePreflightError(
      `frozen calibration does not match the candidate preflight: ${mismatches.join("; ")}`,
    );
  }
}

/**
 * Assembles the sealed fit report from the ready preflight and the frozen
 * artifact. It carries only dev/cal-A evidence — the CV selection
 * summaries, the joint thresholds and their fit evidence, and the bound
 * identities — and NEVER any test score, label or metric.
 */
export function buildFitReport(
  preflight: CandidatePreflightReport,
  frozen: FrozenCalibrationArtifact,
): FitReport {
  return {
    schemaVersion: 1,
    preflight,
    calibrationArtifactDigest: frozen.artifactDigest,
    fitSeed: frozen.fitSeed,
    partitionsUsed: ["dev", "cal-A"],
    model: frozen.model,
    scoringRuntime: frozen.scoringRuntime,
    predictionManifestDigests: frozen.predictionManifestDigests,
    datasetDigest: frozen.datasetDigest,
    datasetAuditDigest: frozen.datasetAuditDigest,
    sourceReadinessDigest: frozen.sourceReadinessDigest,
    splitDigest: frozen.splitDigest,
    evaluatorDigest: frozen.evaluatorDigest,
    thresholds: frozen.thresholds,
    thresholdEvidence: frozen.thresholdEvidence,
    selectionEvidence: frozen.selectionEvidence,
  };
}
