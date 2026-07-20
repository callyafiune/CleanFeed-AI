// Closed, fail-closed runtime calibration contracts. The runtime and the Phase
// 2 benchmark import THESE types — neither redefines the shape. The parser does
// NO coercion and rejects unknown keys: a profile is either byte-exact and
// statistically sound, or it is refused.

import { canonicalSha256 } from "./canonical-json";

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const ONE_HUNDRED_EIGHTY_DAYS_MS = 180 * 24 * 60 * 60 * 1000;
const ECE_BINS = 15;
const MINIMUM_OVERALL_NEGATIVES = 2000;
const MINIMUM_CRITICAL_FPR_SAMPLE = 300;
const MINIMUM_CRITICAL_RECALL_SAMPLE = 200;

export type LengthBucketV1 = "50-79" | "80-199" | "200-plus";

export type SerializedCalibratorV1 =
  | { kind: "platt"; slope: number; intercept: number }
  | { kind: "beta"; alpha: number; beta: number; intercept: number }
  | {
      kind: "isotonic";
      interpolation: "linear";
      clamp: true;
      knots: Array<{ rawScore: number; calibratedScore: number }>;
    };

export interface ProportionGateEvidenceV1 {
  estimate: number;
  lowerBound95: number;
  upperBound95: number;
  sampleSize: number;
}

export interface RuntimeCalibrationProfileV1 {
  schemaVersion: 1;
  profileId: string;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  tokenizerDigest: string;
  platform: string;
  locale: "pt-BR";
  lengthBucket: LengthBucketV1;
  aggregationVersion: string;
  contentCompositionVersion: string;
  datasetDigest: string;
  splitDigest: string;
  evaluatorDigest: string;
  issuedAt: string;
  expiresAt: string;
  calibrators: {
    document: SerializedCalibratorV1;
    localized: SerializedCalibratorV1;
  };
  thresholds: {
    documentIndicator: number;
    localizedIndicator: number;
    documentAction: number;
  };
  evidencePolicy: {
    minimumCoverage: number;
    minimumLexicalRatio: number;
    maximumStdDev: number;
    minimumChunkAgreement: number;
    exactTokenizerRequired: true;
  };
  gateEvidence: {
    decision: "indicator-only" | "pass";
    intervalMethod: "wilson-one-sided-95";
    ece: { value: number; bins: 15; sampleSize: number };
    overall: {
      indicatorFpr: ProportionGateEvidenceV1;
      indicatorRecall: ProportionGateEvidenceV1;
      actionFpr: ProportionGateEvidenceV1;
      actionRecall: ProportionGateEvidenceV1;
      coverage: ProportionGateEvidenceV1;
      mixedRecall: ProportionGateEvidenceV1;
    };
    criticalFprSlices: Record<
      string,
      {
        indicatorFpr: ProportionGateEvidenceV1;
        actionFpr: ProportionGateEvidenceV1;
      }
    >;
    criticalRecallSlices: Record<
      string,
      {
        indicatorRecall: ProportionGateEvidenceV1;
        actionRecall: ProportionGateEvidenceV1 | null;
      }
    >;
  };
  actionCeiling: "indicator" | "hide";
  profileDigest: string;
}

export interface CalibrationProfilesFileV1 {
  schemaVersion: 1;
  profiles: RuntimeCalibrationProfileV1[];
}

/** Coded, fail-closed error thrown by the calibration parser. */
export class CalibrationProfileError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "CalibrationProfileError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new CalibrationProfileError(code, message);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function hasExactKeys(
  value: unknown,
  keys: readonly string[],
): value is Record<string, unknown> {
  return (
    isPlainObject(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}

function isSha256(value: unknown): value is string {
  return typeof value === "string" && SHA256_PATTERN.test(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isUnitInterval(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function isUtcTimestamp(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) {
    return false;
  }
  return Number.isFinite(Date.parse(value));
}

function parseCalibrator(
  value: unknown,
  where: string,
): SerializedCalibratorV1 {
  if (!isPlainObject(value) || typeof value.kind !== "string") {
    fail(
      "CALIBRATOR_INVALID",
      `${where} calibrator must be an object with a kind`,
    );
  }
  if (value.kind === "platt") {
    if (
      !hasExactKeys(value, ["kind", "slope", "intercept"]) ||
      !Number.isFinite(value.slope) ||
      !Number.isFinite(value.intercept)
    ) {
      fail("CALIBRATOR_INVALID", `${where} platt calibrator is malformed`);
    }
    return value as unknown as SerializedCalibratorV1;
  }
  if (value.kind === "beta") {
    if (
      !hasExactKeys(value, ["kind", "alpha", "beta", "intercept"]) ||
      typeof value.alpha !== "number" ||
      typeof value.beta !== "number" ||
      !(value.alpha >= 0) ||
      !(value.beta >= 0) ||
      !Number.isFinite(value.intercept)
    ) {
      fail("CALIBRATOR_INVALID", `${where} beta calibrator is malformed`);
    }
    return value as unknown as SerializedCalibratorV1;
  }
  if (value.kind === "isotonic") {
    if (
      !hasExactKeys(value, ["kind", "interpolation", "clamp", "knots"]) ||
      value.interpolation !== "linear" ||
      value.clamp !== true ||
      !Array.isArray(value.knots) ||
      value.knots.length < 2
    ) {
      fail("CALIBRATOR_INVALID", `${where} isotonic calibrator is malformed`);
    }
    let previousRaw = Number.NEGATIVE_INFINITY;
    for (const knot of value.knots) {
      if (
        !hasExactKeys(knot, ["rawScore", "calibratedScore"]) ||
        !isUnitInterval(knot.rawScore) ||
        !isUnitInterval(knot.calibratedScore)
      ) {
        fail(
          "CALIBRATOR_INVALID",
          `${where} isotonic knot is out of [0,1] or malformed`,
        );
      }
      if (!((knot.rawScore as number) > previousRaw)) {
        fail(
          "CALIBRATOR_NOT_MONOTONIC",
          `${where} isotonic knots must be strictly increasing in rawScore`,
        );
      }
      previousRaw = knot.rawScore as number;
    }
    return value as unknown as SerializedCalibratorV1;
  }
  fail("CALIBRATOR_INVALID", `${where} calibrator has an unknown kind`);
}

function parseGateEvidence(
  value: unknown,
  where: string,
): ProportionGateEvidenceV1 {
  if (
    !hasExactKeys(value, [
      "estimate",
      "lowerBound95",
      "upperBound95",
      "sampleSize",
    ]) ||
    !isUnitInterval(value.estimate) ||
    !isUnitInterval(value.lowerBound95) ||
    !isUnitInterval(value.upperBound95) ||
    !isPositiveInteger(value.sampleSize) ||
    (value.lowerBound95 as number) > (value.estimate as number) ||
    (value.estimate as number) > (value.upperBound95 as number)
  ) {
    fail("GATE_EVIDENCE_INVALID", `${where} proportion evidence is malformed`);
  }
  return value as unknown as ProportionGateEvidenceV1;
}

function parseThresholds(
  value: unknown,
): RuntimeCalibrationProfileV1["thresholds"] {
  if (
    !hasExactKeys(value, [
      "documentIndicator",
      "localizedIndicator",
      "documentAction",
    ]) ||
    !isUnitInterval(value.documentIndicator) ||
    !isUnitInterval(value.localizedIndicator) ||
    !isUnitInterval(value.documentAction)
  ) {
    fail("THRESHOLDS_INVALID", "thresholds must be finite and within [0,1]");
  }
  return value as unknown as RuntimeCalibrationProfileV1["thresholds"];
}

function parseEvidencePolicy(
  value: unknown,
): RuntimeCalibrationProfileV1["evidencePolicy"] {
  if (
    !hasExactKeys(value, [
      "minimumCoverage",
      "minimumLexicalRatio",
      "maximumStdDev",
      "minimumChunkAgreement",
      "exactTokenizerRequired",
    ]) ||
    !isUnitInterval(value.minimumCoverage) ||
    !isUnitInterval(value.minimumLexicalRatio) ||
    !isUnitInterval(value.maximumStdDev) ||
    !isUnitInterval(value.minimumChunkAgreement) ||
    value.exactTokenizerRequired !== true
  ) {
    fail("EVIDENCE_POLICY_INVALID", "evidencePolicy is malformed");
  }
  return value as unknown as RuntimeCalibrationProfileV1["evidencePolicy"];
}

function parseSliceRecord(
  value: unknown,
  innerKeys: readonly string[],
  parseInner: (slice: Record<string, unknown>, sliceName: string) => void,
  label: string,
): void {
  if (!isPlainObject(value)) {
    fail("SLICES_INVALID", `${label} must be an object`);
  }
  for (const [sliceName, slice] of Object.entries(value)) {
    if (!hasExactKeys(slice, innerKeys)) {
      fail("SLICES_INVALID", `${label}["${sliceName}"] has unexpected keys`);
    }
    parseInner(slice, sliceName);
  }
}

function parseGateEvidenceBlock(
  value: unknown,
): RuntimeCalibrationProfileV1["gateEvidence"] {
  if (
    !hasExactKeys(value, [
      "decision",
      "intervalMethod",
      "ece",
      "overall",
      "criticalFprSlices",
      "criticalRecallSlices",
    ])
  ) {
    fail("GATE_EVIDENCE_INVALID", "gateEvidence has unexpected keys");
  }
  if (value.decision !== "indicator-only" && value.decision !== "pass") {
    fail(
      "GATE_EVIDENCE_INVALID",
      "gateEvidence.decision must be indicator-only or pass",
    );
  }
  if (value.intervalMethod !== "wilson-one-sided-95") {
    fail(
      "GATE_EVIDENCE_INVALID",
      "gateEvidence.intervalMethod must be wilson-one-sided-95",
    );
  }
  if (
    !hasExactKeys(value.ece, ["value", "bins", "sampleSize"]) ||
    typeof value.ece.value !== "number" ||
    !Number.isFinite(value.ece.value) ||
    value.ece.value < 0 ||
    value.ece.bins !== ECE_BINS ||
    !isPositiveInteger(value.ece.sampleSize)
  ) {
    fail(
      "ECE_INVALID",
      "ece must have exactly 15 bins and a finite non-negative value",
    );
  }

  const overall = value.overall;
  if (
    !hasExactKeys(overall, [
      "indicatorFpr",
      "indicatorRecall",
      "actionFpr",
      "actionRecall",
      "coverage",
      "mixedRecall",
    ])
  ) {
    fail("GATE_EVIDENCE_INVALID", "gateEvidence.overall has unexpected keys");
  }
  const indicatorFpr = parseGateEvidence(
    overall.indicatorFpr,
    "overall.indicatorFpr",
  );
  parseGateEvidence(overall.indicatorRecall, "overall.indicatorRecall");
  const actionFpr = parseGateEvidence(overall.actionFpr, "overall.actionFpr");
  parseGateEvidence(overall.actionRecall, "overall.actionRecall");
  parseGateEvidence(overall.coverage, "overall.coverage");
  parseGateEvidence(overall.mixedRecall, "overall.mixedRecall");

  if (
    indicatorFpr.sampleSize < MINIMUM_OVERALL_NEGATIVES ||
    actionFpr.sampleSize < MINIMUM_OVERALL_NEGATIVES
  ) {
    fail(
      "INSUFFICIENT_NEGATIVES",
      `overall FPR gates require at least ${MINIMUM_OVERALL_NEGATIVES} negatives`,
    );
  }

  parseSliceRecord(
    value.criticalFprSlices,
    ["indicatorFpr", "actionFpr"],
    (slice, sliceName) => {
      const sliceIndicator = parseGateEvidence(
        slice.indicatorFpr,
        `criticalFprSlices["${sliceName}"].indicatorFpr`,
      );
      const sliceAction = parseGateEvidence(
        slice.actionFpr,
        `criticalFprSlices["${sliceName}"].actionFpr`,
      );
      if (
        sliceIndicator.sampleSize < MINIMUM_CRITICAL_FPR_SAMPLE ||
        sliceAction.sampleSize < MINIMUM_CRITICAL_FPR_SAMPLE
      ) {
        fail(
          "INSUFFICIENT_SLICE_SAMPLE",
          `criticalFprSlices["${sliceName}"] needs sampleSize >= ${MINIMUM_CRITICAL_FPR_SAMPLE}`,
        );
      }
    },
    "criticalFprSlices",
  );

  parseSliceRecord(
    value.criticalRecallSlices,
    ["indicatorRecall", "actionRecall"],
    (slice, sliceName) => {
      const indicatorRecall = parseGateEvidence(
        slice.indicatorRecall,
        `criticalRecallSlices["${sliceName}"].indicatorRecall`,
      );
      if (indicatorRecall.sampleSize < MINIMUM_CRITICAL_RECALL_SAMPLE) {
        fail(
          "INSUFFICIENT_SLICE_SAMPLE",
          `criticalRecallSlices["${sliceName}"].indicatorRecall needs sampleSize >= ${MINIMUM_CRITICAL_RECALL_SAMPLE}`,
        );
      }
      // An inapplicable action recall must be NULL, never omitted.
      if (slice.actionRecall !== null) {
        const actionRecall = parseGateEvidence(
          slice.actionRecall,
          `criticalRecallSlices["${sliceName}"].actionRecall`,
        );
        if (actionRecall.sampleSize < MINIMUM_CRITICAL_RECALL_SAMPLE) {
          fail(
            "INSUFFICIENT_SLICE_SAMPLE",
            `criticalRecallSlices["${sliceName}"].actionRecall needs sampleSize >= ${MINIMUM_CRITICAL_RECALL_SAMPLE}`,
          );
        }
      }
    },
    "criticalRecallSlices",
  );

  return value as unknown as RuntimeCalibrationProfileV1["gateEvidence"];
}

const PROFILE_KEYS = [
  "schemaVersion",
  "profileId",
  "modelId",
  "modelVersion",
  "bundleDigest",
  "tokenizerDigest",
  "platform",
  "locale",
  "lengthBucket",
  "aggregationVersion",
  "contentCompositionVersion",
  "datasetDigest",
  "splitDigest",
  "evaluatorDigest",
  "issuedAt",
  "expiresAt",
  "calibrators",
  "thresholds",
  "evidencePolicy",
  "gateEvidence",
  "actionCeiling",
  "profileDigest",
] as const;

const LENGTH_BUCKETS: readonly LengthBucketV1[] = [
  "50-79",
  "80-199",
  "200-plus",
];

/** SHA-256 of the canonical profile with `profileDigest` excluded. */
export async function computeCalibrationProfileDigest(
  profile: RuntimeCalibrationProfileV1,
): Promise<string> {
  const { profileDigest: _profileDigest, ...rest } = profile;
  void _profileDigest;
  return canonicalSha256(rest);
}

async function parseProfile(
  value: unknown,
): Promise<RuntimeCalibrationProfileV1> {
  if (!hasExactKeys(value, PROFILE_KEYS)) {
    fail("PROFILE_SCHEMA_INVALID", "profile has missing or unexpected keys");
  }
  if (value.schemaVersion !== 1) {
    fail("PROFILE_SCHEMA_INVALID", "profile schemaVersion must be 1");
  }
  if (
    !isNonEmptyString(value.profileId) ||
    !isNonEmptyString(value.modelId) ||
    !isNonEmptyString(value.modelVersion) ||
    !isNonEmptyString(value.platform) ||
    !isNonEmptyString(value.aggregationVersion) ||
    !isNonEmptyString(value.contentCompositionVersion)
  ) {
    fail("PROFILE_FIELD_INVALID", "profile identity strings must be non-empty");
  }
  if (
    !isSha256(value.bundleDigest) ||
    !isSha256(value.tokenizerDigest) ||
    !isSha256(value.datasetDigest) ||
    !isSha256(value.splitDigest) ||
    !isSha256(value.evaluatorDigest) ||
    !isSha256(value.profileDigest)
  ) {
    fail("PROFILE_FIELD_INVALID", "profile digests must be sha256 hex strings");
  }
  if (value.locale !== "pt-BR") {
    fail("PROFILE_FIELD_INVALID", 'profile locale must be "pt-BR"');
  }
  if (!LENGTH_BUCKETS.includes(value.lengthBucket as LengthBucketV1)) {
    fail("PROFILE_FIELD_INVALID", "profile lengthBucket is unknown");
  }
  if (!isUtcTimestamp(value.issuedAt) || !isUtcTimestamp(value.expiresAt)) {
    fail(
      "PROFILE_FIELD_INVALID",
      "issuedAt/expiresAt must be valid timestamps",
    );
  }
  if (
    Date.parse(value.expiresAt) - Date.parse(value.issuedAt) !==
    ONE_HUNDRED_EIGHTY_DAYS_MS
  ) {
    fail(
      "PROFILE_EXPIRY_INVALID",
      "expiresAt must be exactly issuedAt + 180 days",
    );
  }

  if (!hasExactKeys(value.calibrators, ["document", "localized"])) {
    fail(
      "CALIBRATOR_INVALID",
      "calibrators must have exactly document and localized",
    );
  }
  parseCalibrator(value.calibrators.document, "document");
  parseCalibrator(value.calibrators.localized, "localized");

  const thresholds = parseThresholds(value.thresholds);
  parseEvidencePolicy(value.evidencePolicy);
  const gateEvidence = parseGateEvidenceBlock(value.gateEvidence);

  if (value.actionCeiling !== "indicator" && value.actionCeiling !== "hide") {
    fail("PROFILE_FIELD_INVALID", "actionCeiling must be indicator or hide");
  }

  // Cross-field policy invariants.
  if (gateEvidence.decision === "indicator-only") {
    if (value.actionCeiling !== "indicator") {
      fail(
        "POLICY_INVALID",
        "indicator-only decision requires actionCeiling indicator",
      );
    }
    if (thresholds.documentAction !== 1) {
      fail(
        "POLICY_INVALID",
        "indicator-only decision requires documentAction === 1",
      );
    }
  }
  if (value.lengthBucket === "50-79" && value.actionCeiling !== "indicator") {
    fail("POLICY_INVALID", "the 50-79 bucket always has an indicator ceiling");
  }
  if (value.actionCeiling === "hide" && gateEvidence.decision !== "pass") {
    fail("POLICY_INVALID", "a hide ceiling requires a pass decision");
  }

  const profile = value as unknown as RuntimeCalibrationProfileV1;
  const expectedDigest = await computeCalibrationProfileDigest(profile);
  if (expectedDigest !== profile.profileDigest) {
    fail(
      "PROFILE_DIGEST_MISMATCH",
      "profileDigest does not match the canonical digest",
    );
  }
  return profile;
}

/** Closed parser for the calibration-profiles file. Rejects any drift. */
export async function parseCalibrationProfilesFileV1(
  value: unknown,
): Promise<CalibrationProfilesFileV1> {
  if (!hasExactKeys(value, ["schemaVersion", "profiles"])) {
    fail("CALIBRATION_SCHEMA_INVALID", "file has missing or unexpected keys");
  }
  if (value.schemaVersion !== 1) {
    fail("CALIBRATION_SCHEMA_INVALID", "schemaVersion must be 1");
  }
  if (!Array.isArray(value.profiles)) {
    fail("CALIBRATION_SCHEMA_INVALID", "profiles must be an array");
  }
  const profiles: RuntimeCalibrationProfileV1[] = [];
  for (const profile of value.profiles) {
    profiles.push(await parseProfile(profile));
  }
  return { schemaVersion: 1, profiles };
}

/**
 * Canonical digest of a calibration set: profile digests sorted
 * lexicographically and de-duplicated, serialized as a canonical JSON array,
 * then SHA-256. The empty set hashes to the canonical empty-array digest.
 */
export async function computeCalibrationSetDigest(
  profileDigests: readonly string[],
): Promise<string> {
  const sortedUnique = [...new Set(profileDigests)].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return canonicalSha256(sortedUnique);
}

function sigmoid(logit: number): number {
  if (logit >= 0) {
    return 1 / (1 + Math.exp(-logit));
  }
  const exponent = Math.exp(logit);
  return exponent / (1 + exponent);
}

function clampUnit(value: number): number {
  return Math.min(1, Math.max(0, value));
}

/**
 * Applies a serialized calibrator to a raw score in [0,1]. Isotonic uses linear
 * interpolation between the strictly-increasing knots and clamps at the
 * extremes — never a step function.
 */
export function applyCalibrator(
  calibrator: SerializedCalibratorV1,
  rawScore: number,
): number {
  const raw = clampUnit(rawScore);
  if (calibrator.kind === "platt") {
    return clampUnit(sigmoid(calibrator.slope * raw + calibrator.intercept));
  }
  if (calibrator.kind === "beta") {
    const epsilon = 1e-6;
    const bounded = Math.min(1 - epsilon, Math.max(epsilon, raw));
    const logit =
      calibrator.intercept +
      calibrator.alpha * Math.log(bounded) -
      calibrator.beta * Math.log(1 - bounded);
    return clampUnit(sigmoid(logit));
  }
  const { knots } = calibrator;
  const first = knots[0]!;
  const last = knots[knots.length - 1]!;
  if (raw <= first.rawScore) {
    return clampUnit(first.calibratedScore);
  }
  if (raw >= last.rawScore) {
    return clampUnit(last.calibratedScore);
  }
  for (let index = 1; index < knots.length; index += 1) {
    const lower = knots[index - 1]!;
    const upper = knots[index]!;
    if (raw <= upper.rawScore) {
      const span = upper.rawScore - lower.rawScore;
      const ratio = span === 0 ? 0 : (raw - lower.rawScore) / span;
      return clampUnit(
        lower.calibratedScore +
          ratio * (upper.calibratedScore - lower.calibratedScore),
      );
    }
  }
  return clampUnit(last.calibratedScore);
}
