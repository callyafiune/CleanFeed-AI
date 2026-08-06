// Builds the IMMUTABLE model publication from a frozen calibration artifact and
// a sealed benchmark report, then writes it to the model directory. Two outputs
// are produced together and always agree: the closed `CalibrationProfilesFileV1`
// (three runtime length buckets) and the `ModelReleaseDescriptorV1` that seals
// their identity and calibration-set digest.
//
// This module CONSUMES the Phase 1 contracts (`contracts/calibration-profile.ts`
// and `contracts/model-release.ts`) and never redefines a runtime shape: the
// profiles/release are validated by re-running the very parsers the extension
// uses, so a publication that would be refused at load is refused here first.
//
// The three §6.5 decision branches map as:
//   - pass          -> three profiles, rolloutState "indicator"; the 80-199 and
//                      200-plus buckets take a "hide" ceiling only where their
//                      constituent length bands passed the visual-action gate.
//   - indicator-only -> three profiles, every ceiling "indicator" and
//                      documentAction disabled (1), rolloutState "indicator".
//   - reject        -> NO profiles (empty file), rolloutState "bundle-verified";
//                      the descriptor preserves the un-promoted TMR identity.
//
// The initial scientific publication maps pass/indicator-only -> "indicator" and
// reject -> "bundle-verified"; only Phase 4 performs the later monotonic
// promotion to "actions".
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Deterministic: `issuedAt` is an explicit argument, never `Date.now()`.

import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  computeCalibrationProfileDigest,
  parseCalibrationProfilesFileV1,
  type CalibrationProfilesFileV1,
  type LengthBucketV1,
  type ProportionGateEvidenceV1,
  type RuntimeCalibrationProfileV1,
} from "../contracts/calibration-profile.ts";
import {
  computeCalibrationSetDigest,
  parseModelReleaseDescriptorV1,
  type ModelReleaseDescriptorV1,
} from "../contracts/model-release.ts";
import type { FrozenCalibrationArtifact } from "./calibration-pipeline.ts";
import type { GateReport, ReleaseDecision } from "./gates.ts";
import { wilsonOneSided } from "./intervals.ts";
import type { DecisionFamilies, MetricEstimate } from "./metrics.ts";
import { PREREGISTRATION_V4 } from "./preregistration-v4.ts";
import type { BenchmarkReport } from "./report.ts";

// v1 policy: calibration profiles are published for the single "generic"
// platform pool — the sealed corpus is generic pt-BR, not platform-specific.
// The runtime normalizes every adapter id to this same pool before the lookup
// (src/inference/calibration.ts normalizeCalibrationPlatform), so per-platform
// profiles remain possible later by emitting other platform values here and
// changing that normalization.
const PLATFORM = "generic";
const LOCALE = "pt-BR" as const;
const EXPIRY_MS = 180 * 86_400_000;

// The frozen fit seals this sentinel for a warning path that never fires within
// its budget. It is deliberately outside the contract's [0,1] range so a raw
// artifact can never masquerade as a runtime threshold; the builder maps it to
// a disabled 1 and MUST never emit a 2.
const NEVER_THRESHOLD = 2;

// The single canonical runtime evidence policy (spec §5.5 / §7): the same
// coverage/lexical/dispersion/agreement floors the extension enforces per post.
const EVIDENCE_POLICY: RuntimeCalibrationProfileV1["evidencePolicy"] = {
  minimumCoverage: 0.95,
  minimumLexicalRatio: 0.6,
  maximumStdDev: 0.25,
  minimumChunkAgreement: 0.5,
  exactTokenizerRequired: true,
};

// Profiles are emitted longest-bucket first so the always-indicator 50-79 bucket
// is last; the release's profileDigests preserve this order.
const BUILD_ORDER: readonly LengthBucketV1[] = ["200-plus", "80-199", "50-79"];

// Conservative aggregation of the PRE-REGISTERED length bands
// (`lengthBands` in benchmark/preregistration-v4.json) into the three runtime
// buckets: a runtime bucket is authorized for `hide` only when every band whose word
// range overlaps it passed the action gate. 150_299 belongs to both 80-199 and
// 200-plus because its word range straddles them.
//
// What that rule DECIDES today is narrower than it reads, and the difference is
// measured: an action slice gate that fails — including one that is under-powered,
// whose ineligible arm fails on purpose — lands in `failedAction` and caps the whole
// release at `indicator-only`, where every bucket is `indicator` anyway. So with a
// `pass` every action gate present has passed, and the per-bucket question reduces to
// whether any constituent band produced a gate at all. The overlap survives as the
// conservative answer if the decision rule ever stops capping globally.
//
// The two tables are separate vocabularies on purpose — the bands are what the
// evaluation publishes a rate over, the runtime buckets are which profile the served
// bundle loads — and this map is the only place they meet. Coverage of the bands is
// therefore ENFORCED and not assumed (`assertLengthBandsAreMapped`): an unmapped band
// is read by no bucket, so its FAILURE would cap nothing while the other buckets keep
// authorizing `hide` over a length range nobody consulted.
const RUNTIME_BUCKET_CONSTITUENTS: Record<
  LengthBucketV1,
  ReadonlySet<string>
> = {
  "50-79": new Set(["50_79"]),
  "80-199": new Set(["80_149", "150_299"]),
  "200-plus": new Set(["150_299", "300_PLUS"]),
};

const MAPPED_LENGTH_BANDS: ReadonlySet<string> = new Set(
  Object.values(RUNTIME_BUCKET_CONSTITUENTS).flatMap((keys) => [...keys]),
);

export interface ModelPublicationInput {
  frozen: FrozenCalibrationArtifact;
  report: BenchmarkReport;
  /** Explicit issuance timestamp; expiry is exactly this + 180 days. */
  issuedAt: string;
  /** Raw models/.../calibration-profiles.json (validated before deriving). */
  profilesTemplate: unknown;
  /** Raw models/.../release.json (validated before deriving). */
  releaseTemplate: unknown;
}

export interface ModelPublication {
  profiles: CalibrationProfilesFileV1;
  release: ModelReleaseDescriptorV1;
}

/** Coded, fail-closed error thrown by the publication builder. */
export class CalibrationPublicationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CalibrationPublicationError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new CalibrationPublicationError(code, message);
}

interface PublicationIdentity {
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  tokenizerDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  datasetDigest: string;
  splitDigest: string;
  evaluatorDigest: string;
}

/**
 * Cross-checks the identity carried by the frozen artifact, the benchmark report
 * and the release template. Any divergence — including the canonical tokenizer —
 * is a hard failure: there is no last-write-wins.
 */
function crossCheckIdentity(
  frozen: FrozenCalibrationArtifact,
  report: BenchmarkReport,
  template: ModelReleaseDescriptorV1,
): PublicationIdentity {
  const check = (
    label: string,
    frozenValue: string,
    reportValue: string,
    templateValue: string,
  ): void => {
    if (frozenValue !== reportValue) {
      fail(
        "IDENTITY_DIVERGENCE",
        `${label} diverges between the frozen artifact and the report`,
      );
    }
    if (frozenValue !== templateValue) {
      fail(
        "IDENTITY_DIVERGENCE",
        `${label} diverges between the frozen artifact and the release template`,
      );
    }
  };

  check("modelId", frozen.model.modelId, report.model.id, template.modelId);
  check(
    "modelVersion",
    frozen.model.modelVersion,
    report.model.version,
    template.modelVersion,
  );
  check(
    "bundleDigest",
    frozen.model.bundleDigest,
    report.model.bundleDigest,
    template.bundleDigest,
  );
  check(
    "tokenizerDigest",
    frozen.model.tokenizerDigest,
    report.model.tokenizerDigest,
    template.tokenizerDigest,
  );
  check(
    "aggregationVersion",
    frozen.model.aggregationVersion,
    report.model.aggregationVersion,
    template.aggregationVersion,
  );
  check(
    "contentCompositionVersion",
    frozen.model.contentCompositionVersion,
    report.model.contentCompositionVersion,
    template.contentCompositionVersion,
  );

  if (frozen.datasetDigest !== report.dataset.digest) {
    fail("IDENTITY_DIVERGENCE", "datasetDigest diverges from the report");
  }
  if (frozen.splitDigest !== report.split.digest) {
    fail("IDENTITY_DIVERGENCE", "splitDigest diverges from the report");
  }
  if (frozen.evaluatorDigest !== report.evaluatorDigest) {
    fail("IDENTITY_DIVERGENCE", "evaluatorDigest diverges from the report");
  }

  return {
    modelId: frozen.model.modelId,
    modelVersion: frozen.model.modelVersion,
    bundleDigest: frozen.model.bundleDigest,
    tokenizerDigest: frozen.model.tokenizerDigest,
    aggregationVersion: frozen.model.aggregationVersion,
    contentCompositionVersion: frozen.model.contentCompositionVersion,
    datasetDigest: frozen.datasetDigest,
    splitDigest: frozen.splitDigest,
    evaluatorDigest: frozen.evaluatorDigest,
  };
}

/**
 * Maps a frozen threshold into the contract's [0,1] range. The NEVER_THRESHOLD
 * sentinel (and any out-of-range value) becomes 1 (disabled); a 2 is NEVER
 * emitted.
 */
function toRuntimeThreshold(value: number): number {
  if (!Number.isFinite(value) || value >= NEVER_THRESHOLD || value > 1) {
    return 1;
  }
  return value < 0 ? 0 : value;
}

function requireProportion(estimate: MetricEstimate): {
  value: number;
  lower95: number;
  upper95: number;
} {
  const { value, lower95, upper95 } = estimate;
  if (
    !Number.isFinite(value) ||
    lower95 === undefined ||
    upper95 === undefined ||
    !Number.isFinite(lower95) ||
    !Number.isFinite(upper95)
  ) {
    fail(
      "GATE_EVIDENCE_INCOMPLETE",
      "a gate estimate is missing its one-sided Wilson interval",
    );
  }
  return { value, lower95, upper95 };
}

function requireSampleSize(sampleSize: number, label: string): number {
  if (!Number.isSafeInteger(sampleSize) || sampleSize <= 0) {
    fail("GATE_EVIDENCE_INCOMPLETE", `${label} has no positive sample size`);
  }
  return sampleSize;
}

function toProportionEvidence(
  estimate: MetricEstimate,
  sampleSize: number,
  label: string,
): ProportionGateEvidenceV1 {
  const { value, lower95, upper95 } = requireProportion(estimate);
  return {
    estimate: value,
    lowerBound95: lower95,
    upperBound95: upper95,
    sampleSize: requireSampleSize(sampleSize, label),
  };
}

// A visual-action path that was never authorized fires on nothing: 0 successes
// over the observed sample. The upper bound is the honest one-sided Wilson tail.
function neverFiresEvidence(
  sampleSize: number,
  label: string,
): ProportionGateEvidenceV1 {
  const size = requireSampleSize(sampleSize, label);
  return {
    estimate: 0,
    lowerBound95: 0,
    upperBound95: wilsonOneSided(0, size, "upper").value,
    sampleSize: size,
  };
}

function actionFprEvidence(
  visualAction: DecisionFamilies | null,
  sampleSize: number,
  label: string,
): ProportionGateEvidenceV1 {
  return visualAction === null
    ? neverFiresEvidence(sampleSize, label)
    : toProportionEvidence(
        visualAction.endToEnd.falsePositiveRate,
        sampleSize,
        label,
      );
}

function buildGateEvidence(
  decision: "indicator-only" | "pass",
  report: BenchmarkReport,
): RuntimeCalibrationProfileV1["gateEvidence"] {
  const metrics = report.metrics;
  // The published profile carries the END-TO-END family: the runtime evidence a
  // consumer reads must charge inference failures against the system, exactly
  // like the release gates do.
  const warning = metrics.warning.endToEnd;
  const visual = metrics.visualAction;

  if (!Number.isFinite(metrics.ece15.value)) {
    fail("GATE_EVIDENCE_INCOMPLETE", "ECE-15 is not finite");
  }
  const evaluatedSampleSize = requireSampleSize(
    warning.sampleSize,
    "overall evaluated sample",
  );

  const mixed = metrics.mixed.atLeastHalfAi;
  const mixedSampleSize = requireSampleSize(
    mixed.sampleSize,
    "mixed >=50% AI recall",
  );
  const mixedWarned = Math.round(mixed.warningRecall * mixedSampleSize);
  const mixedRecall: ProportionGateEvidenceV1 = {
    estimate: mixed.warningRecall,
    lowerBound95: wilsonOneSided(mixedWarned, mixedSampleSize, "lower").value,
    upperBound95: wilsonOneSided(mixedWarned, mixedSampleSize, "upper").value,
    sampleSize: mixedSampleSize,
  };

  const criticalFprSlices: RuntimeCalibrationProfileV1["gateEvidence"]["criticalFprSlices"] =
    {};
  const criticalRecallSlices: RuntimeCalibrationProfileV1["gateEvidence"]["criticalRecallSlices"] =
    {};
  for (const slice of report.slices.slices) {
    const key = `${slice.axis}:${slice.key}`;
    if (slice.fprGateEligible) {
      criticalFprSlices[key] = {
        indicatorFpr: toProportionEvidence(
          slice.metrics.warning.endToEnd.falsePositiveRate,
          slice.negatives,
          `${key} indicatorFpr`,
        ),
        actionFpr: actionFprEvidence(
          slice.metrics.visualAction,
          slice.negatives,
          `${key} actionFpr`,
        ),
      };
    }
    if (slice.recallGateEligible) {
      // Action recall exists only when visual action is authorized (a pass with
      // a measured visual matrix); otherwise it is explicitly null, never omitted.
      //
      // POPULATION (B2): `visualAction.endToEnd.recall` counts the WARNING
      // positives, so this is diagnostic evidence and NOT the statistic behind
      // `action.recall.overall`, which reads `metrics.actionAuthorization` over the
      // integral positives alone. It is deliberately not repointed here: this axis
      // list includes `mixedFraction`, whose slices hold no integral positives at
      // all, and `requireSampleSize` fails a zero — so reading the authorizing
      // population per slice would refuse to publish a legitimate corpus, and
      // routing that zero to `null` would spell "action not authorized". The
      // caveat is recorded on the field in contracts/calibration-profile.ts;
      // renaming it is a published-contract change and is tracked in the plan.
      const actionRecall =
        decision === "pass" && slice.metrics.visualAction !== null
          ? toProportionEvidence(
              slice.metrics.visualAction.endToEnd.recall,
              slice.positives,
              `${key} actionRecall`,
            )
          : null;
      criticalRecallSlices[key] = {
        indicatorRecall: toProportionEvidence(
          slice.metrics.warning.endToEnd.recall,
          slice.positives,
          `${key} indicatorRecall`,
        ),
        actionRecall,
      };
    }
  }

  return {
    decision,
    intervalMethod: "wilson-one-sided-95",
    ece: {
      value: metrics.ece15.value,
      bins: 15,
      sampleSize: evaluatedSampleSize,
    },
    overall: {
      indicatorFpr: toProportionEvidence(
        warning.falsePositiveRate,
        warning.negatives,
        "overall indicatorFpr",
      ),
      indicatorRecall: toProportionEvidence(
        warning.recall,
        warning.positives,
        "overall indicatorRecall",
      ),
      actionFpr: actionFprEvidence(
        visual,
        warning.negatives,
        "overall actionFpr",
      ),
      // Warning positives, like the per-slice field above: diagnostic evidence,
      // not the `action.recall.overall` gate's statistic. Both the denominator
      // (`warning.positives`) and the numerator's matrix count integral generation
      // AND mechanistic material assistance, so this number can exceed the one the
      // gate observed over the integral positives alone.
      actionRecall:
        visual === null
          ? neverFiresEvidence(
              warning.positives,
              "overall actionRecall (warning positives)",
            )
          : toProportionEvidence(
              visual.endToEnd.recall,
              warning.positives,
              "overall actionRecall (warning positives)",
            ),
      coverage: toProportionEvidence(
        metrics.coverage,
        evaluatedSampleSize,
        "overall coverage",
      ),
      mixedRecall,
    },
    criticalFprSlices,
    criticalRecallSlices,
  };
}

/**
 * Refuses to publish while a length band is outside `RUNTIME_BUCKET_CONSTITUENTS`,
 * from either side: a band the pre-registration publishes a rate over, or a band the
 * gate report carries an action gate for.
 *
 * `bucketAuthorizesAction` reads ONLY the gates of its own constituents, so an unmapped
 * band is silently dropped from every bucket's evidence — its failure caps nothing, and
 * the buckets that do have constituents go on authorizing `hide`. Filtering an unknown
 * key out is the fail-OPEN direction; refusing is the closed one, because the honest
 * answer to "which profile covers 80-199 now" is that the map no longer knows.
 */
function assertLengthBandsAreMapped(gates: GateReport): void {
  for (const band of PREREGISTRATION_V4.lengthBands.bands) {
    if (!MAPPED_LENGTH_BANDS.has(band.key)) {
      fail(
        "LENGTH_BAND_UNMAPPED",
        `the pre-registered length band ${band.key} overlaps no runtime bucket: ` +
          "RUNTIME_BUCKET_CONSTITUENTS must cover every band, or the band's action " +
          "gate caps nothing while the other buckets keep authorizing hide",
      );
    }
  }
  for (const gate of gates.gates) {
    if (
      gate.tier === "action" &&
      gate.scope === "slice" &&
      gate.slice !== undefined &&
      gate.slice.axis === "lengthBucket" &&
      !MAPPED_LENGTH_BANDS.has(gate.slice.key)
    ) {
      fail(
        "LENGTH_BAND_UNMAPPED",
        `the report carries an action gate for the length band ${gate.slice.key}, ` +
          "which belongs to no runtime bucket: its verdict would reach no published " +
          "profile",
      );
    }
  }
}

function bucketAuthorizesAction(
  bucket: LengthBucketV1,
  gates: GateReport,
): boolean {
  const constituents = RUNTIME_BUCKET_CONSTITUENTS[bucket];
  const relevant = gates.gates.filter(
    (gate) =>
      gate.tier === "action" &&
      gate.scope === "slice" &&
      gate.slice !== undefined &&
      gate.slice.axis === "lengthBucket" &&
      constituents.has(gate.slice.key),
  );
  return (
    relevant.length > 0 &&
    relevant.every((gate) => gate.eligible && gate.passed)
  );
}

function ceilingFor(
  bucket: LengthBucketV1,
  decision: "indicator-only" | "pass",
  gates: GateReport,
): "indicator" | "hide" {
  // The 50-79 bucket always keeps an indicator ceiling (spec §5.5).
  if (decision !== "pass" || bucket === "50-79") return "indicator";
  return bucketAuthorizesAction(bucket, gates) ? "hide" : "indicator";
}

async function buildProfile(
  bucket: LengthBucketV1,
  decision: "indicator-only" | "pass",
  identity: PublicationIdentity,
  frozen: FrozenCalibrationArtifact,
  gateEvidence: RuntimeCalibrationProfileV1["gateEvidence"],
  gates: GateReport,
  issuedAt: string,
  expiresAt: string,
): Promise<RuntimeCalibrationProfileV1> {
  const actionCeiling = ceilingFor(bucket, decision, gates);
  const documentIndicator = toRuntimeThreshold(
    frozen.thresholds.warningDocument,
  );
  const localizedIndicator = toRuntimeThreshold(
    frozen.thresholds.warningLocalized,
  );
  const actionBase =
    frozen.thresholds.visualDocument === null
      ? 1
      : toRuntimeThreshold(frozen.thresholds.visualDocument);
  const documentAction = actionCeiling === "hide" ? actionBase : 1;

  const profile: RuntimeCalibrationProfileV1 = {
    schemaVersion: 1,
    profileId: `${identity.modelId}::${PLATFORM}::${LOCALE}::${bucket}`,
    modelId: identity.modelId,
    modelVersion: identity.modelVersion,
    bundleDigest: identity.bundleDigest,
    tokenizerDigest: identity.tokenizerDigest,
    platform: PLATFORM,
    locale: LOCALE,
    lengthBucket: bucket,
    aggregationVersion: identity.aggregationVersion,
    contentCompositionVersion: identity.contentCompositionVersion,
    datasetDigest: identity.datasetDigest,
    splitDigest: identity.splitDigest,
    evaluatorDigest: identity.evaluatorDigest,
    issuedAt,
    expiresAt,
    calibrators: {
      document: frozen.calibrators.document,
      localized: frozen.calibrators.localized,
    },
    thresholds: { documentIndicator, localizedIndicator, documentAction },
    evidencePolicy: EVIDENCE_POLICY,
    gateEvidence,
    actionCeiling,
    profileDigest: "",
  };
  profile.profileDigest = await computeCalibrationProfileDigest(profile);
  return profile;
}

function isoExpiry(issuedAt: string): string {
  const issued = Date.parse(issuedAt);
  if (!Number.isFinite(issued)) {
    fail("ISSUED_AT_INVALID", "issuedAt is not a valid timestamp");
  }
  return new Date(issued + EXPIRY_MS).toISOString();
}

// The initial scientific rollout state per decision. Only Phase 4 promotes to
// "actions"; pass and indicator-only both publish under "indicator".
function rolloutStateFor(
  decision: ReleaseDecision,
): ModelReleaseDescriptorV1["rolloutState"] {
  return decision === "reject" ? "bundle-verified" : "indicator";
}

/**
 * Builds the two publication artifacts and proves them by re-running the Phase 1
 * parsers. `reject` yields an empty profiles file and a bundle-verified
 * descriptor that preserves the un-promoted TMR identity.
 */
export async function buildModelPublication(
  input: ModelPublicationInput,
): Promise<ModelPublication> {
  // Load the templates through the closed Phase 1 parsers before deriving.
  const releaseTemplate = await parseModelReleaseDescriptorV1(
    input.releaseTemplate,
  );
  await parseCalibrationProfilesFileV1(input.profilesTemplate);

  const identity = crossCheckIdentity(
    input.frozen,
    input.report,
    releaseTemplate,
  );
  assertLengthBandsAreMapped(input.report.gates);
  const decision = input.report.gates.decision;

  const issuedAt = input.issuedAt;
  const expiresAt = isoExpiry(issuedAt);

  let profileList: RuntimeCalibrationProfileV1[] = [];
  if (decision === "pass" || decision === "indicator-only") {
    const gateEvidence = buildGateEvidence(decision, input.report);
    profileList = await Promise.all(
      BUILD_ORDER.map((bucket) =>
        buildProfile(
          bucket,
          decision,
          identity,
          input.frozen,
          gateEvidence,
          input.report.gates,
          issuedAt,
          expiresAt,
        ),
      ),
    );
  }

  const profileDigests = profileList.map((profile) => profile.profileDigest);
  const calibrationSetDigest =
    await computeCalibrationSetDigest(profileDigests);

  const release: ModelReleaseDescriptorV1 = {
    schemaVersion: 1,
    // modelId/modelVersion/bundleDigest are preserved from the template (equal
    // to the frozen identity by the cross-check above).
    modelId: releaseTemplate.modelId,
    modelVersion: releaseTemplate.modelVersion,
    bundleDigest: releaseTemplate.bundleDigest,
    tokenizerDigest: identity.tokenizerDigest,
    aggregationVersion: identity.aggregationVersion,
    contentCompositionVersion: identity.contentCompositionVersion,
    calibrationSetDigest,
    profileDigests,
    rolloutState: rolloutStateFor(decision),
    gateDecision: decision,
    issuedAt,
    // The scientific report digest — NOT the later sanitized-package digest.
    evidenceDigest: input.report.reportDigest,
  };

  const profilesFile: CalibrationProfilesFileV1 = {
    schemaVersion: 1,
    profiles: profileList,
  };

  // Prove both outputs against the exact parsers the runtime uses at load.
  const profiles = await parseCalibrationProfilesFileV1(profilesFile);
  const parsedRelease = await parseModelReleaseDescriptorV1(release);

  return { profiles, release: parsedRelease };
}

/** Writes the publication to `<modelDirectory>/{calibration-profiles,release}.json`. */
export async function writeModelPublication(
  publication: ModelPublication,
  modelDirectory: string,
): Promise<void> {
  await mkdir(modelDirectory, { recursive: true });
  await writeFile(
    resolve(modelDirectory, "calibration-profiles.json"),
    `${JSON.stringify(publication.profiles, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    resolve(modelDirectory, "release.json"),
    `${JSON.stringify(publication.release, null, 2)}\n`,
    "utf8",
  );
}
