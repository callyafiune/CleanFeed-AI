// Closed prediction manifest, strict score rows and exact completeness. This
// module is part of the standalone benchmark package and MUST NOT import from
// the extension bundle (src/); from contracts/ it reuses ONLY pure helpers — the
// canonical-json digest and the shared failure-detail allowlist that the
// candidate page produces details with.
//
// "Closed" means every object is validated against an exact key set with no
// coercion. A missing prediction, an extra prediction, a duplicate id, a score
// outside [0,1], a contradictory status/evidence combination or a chromeVersion
// that is not the pinned release build is a HARD failure. There is no
// last-write-wins and no silent drop: there is exactly one row per id even for
// abstentions and errors, and prediction rows carry NO text, URL, author,
// prompt or content hash — only the identifier and the scoring outcome.

import { canonicalSha256 } from "../contracts/canonical-json.ts";
import { isSanitizedFailureDetail } from "../contracts/failure-detail.ts";
// Type-only, so this parser gains no runtime dependency on the splitter: the NAMES a
// manifest may declare cannot drift from the narrowed scoring vocabulary, while the
// runtime list below stays this module's own (see PARTITIONS).
import type { ScoringPartition } from "./split.ts";

/** The exact Chrome for Testing Stable build that release-eligible scoring uses. */
export const RELEASE_CHROME_VERSION = "150.0.7871.129" as const;

export interface StrictPredictionV2 {
  schemaVersion: 2;
  id: string;
  status: "scored" | "abstained" | "error";
  documentRawScore: number | null;
  localizedRawScore: number | null;
  evidenceQuality: "sufficient" | "limited" | "unsupported";
  reasonCode: string;
  /**
   * The sanitized cause of an error row. Optional in the SHAPE so a scored or
   * abstained row does not carry the key at all, but REQUIRED whenever
   * `status === "error"`: an error row with no readable cause is exactly the
   * artifact that made 325 inference failures undiagnosable. Its content is
   * constrained to the shared allowlist, so it can never hold document text.
   */
  failureDetail?: string;
  coverage: number;
  latencyMs: number;
  memoryBytes: number | null;
}

export interface PredictionShardDescriptor {
  index: number;
  file: string;
  sha256: string;
  recordCount: number;
}

export interface PredictionManifestV1 {
  schemaVersion: 1;
  modelId: string;
  modelVersion: string;
  bundleDigest: string;
  aggregationVersion: string;
  contentCompositionVersion: string;
  tokenizerDigest: string;
  runtimeParityDigest: string;
  extensionBuildDigest: string;
  backend: "wasm" | "webgpu";
  chromeVersion: string;
  datasetDigest: string;
  splitDigest: string;
  partition: ScoringPartition;
  shardSize: 100;
  shardCount: number;
  shards: PredictionShardDescriptor[];
  holdoutConsumptionId: string | null;
  createdAt: string;
}

export interface ParsePredictionManifestOptions {
  scientificUse?: "release" | "diagnostic";
}

/** Coded, fail-closed error thrown by every guard in this module. */
export class PredictionSchemaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PredictionSchemaError";
  }
}

function fail(message: string): never {
  throw new PredictionSchemaError(message);
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const SHARD_SIZE = 100;

const PREDICTION_KEYS = [
  "schemaVersion",
  "id",
  "status",
  "documentRawScore",
  "localizedRawScore",
  "evidenceQuality",
  "reasonCode",
  "coverage",
  "latencyMs",
  "memoryBytes",
] as const;

// Keys a row MAY carry. `failureDetail` is optional in the shape so rows written
// before it existed still parse; `validatePredictionRow` then requires it for
// exactly the error rows and forbids it everywhere else.
const PREDICTION_OPTIONAL_KEYS = ["failureDetail"] as const;

const MANIFEST_KEYS = [
  "schemaVersion",
  "modelId",
  "modelVersion",
  "bundleDigest",
  "aggregationVersion",
  "contentCompositionVersion",
  "tokenizerDigest",
  "runtimeParityDigest",
  "extensionBuildDigest",
  "backend",
  "chromeVersion",
  "datasetDigest",
  "splitDigest",
  "partition",
  "shardSize",
  "shardCount",
  "shards",
  "holdoutConsumptionId",
  "createdAt",
] as const;

const SHARD_KEYS = ["index", "file", "sha256", "recordCount"] as const;

const PREDICTION_STATUSES = ["scored", "abstained", "error"] as const;
const EVIDENCE_QUALITIES = ["sufficient", "limited", "unsupported"] as const;
// This module's OWN runtime enumeration, deliberately not the imported array. The validator
// has to be able to DISAGREE with the splitter: sharing one list means a name dropped on one
// side silently stops being refused on the other, and the disagreement is the signal.
const PARTITIONS = ["dev", "cal-A", "test"] as const;
const BACKENDS = ["wasm", "webgpu"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

/**
 * Closed-object guard: every key must be in `required` ∪ `optional`, and every
 * key in `required` must be present. Optional keys are declared separately so
 * "closed" never has to mean "every field is mandatory".
 */
function assertClosedObject(
  value: unknown,
  label: string,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    fail(`${label} must be an object`);
  }
  const allowedSet = new Set([...required, ...optional]);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      fail(`unknown key "${key}" in ${label}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail(`${label} is missing key "${key}"`);
    }
  }
  return value;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${name} must be a non-empty string`);
  }
  return value;
}

function lowercaseSha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(`${name} must be a lowercase 64-character sha256 hex digest`);
  }
  return value;
}

function enumValue<T extends string>(
  value: unknown,
  name: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    fail(`${name} must be one of ${allowed.join(", ")}`);
  }
  return value as T;
}

function integer(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    fail(`${name} must be an integer`);
  }
  return value;
}

function assertProbability(value: unknown, name: string): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  ) {
    fail(`${name} must be between 0 and 1`);
  }
  return value;
}

function numberOrNull(value: unknown, name: string): number | null {
  if (value === null) return null;
  if (typeof value !== "number") {
    fail(`${name} must be a number or null`);
  }
  return value;
}

/** Validates a single prediction row against the closed schema and invariants. */
export function validatePredictionRow(value: unknown): StrictPredictionV2 {
  const row = assertClosedObject(
    value,
    "prediction",
    PREDICTION_KEYS,
    PREDICTION_OPTIONAL_KEYS,
  );

  // The manifest pins the authoritative row version; each row only asserts a
  // recognized version integer (v1 diagnostic or v2 release rows).
  if (row.schemaVersion !== 1 && row.schemaVersion !== 2) {
    fail("schemaVersion must be 1 or 2");
  }
  const id = nonEmptyString(row.id, "id");
  const status = enumValue(row.status, "status", PREDICTION_STATUSES);
  const documentRawScore = numberOrNull(
    row.documentRawScore,
    "documentRawScore",
  );
  const localizedRawScore = numberOrNull(
    row.localizedRawScore,
    "localizedRawScore",
  );
  const evidenceQuality = enumValue(
    row.evidenceQuality,
    "evidenceQuality",
    EVIDENCE_QUALITIES,
  );
  if (typeof row.reasonCode !== "string") {
    fail("reasonCode must be a non-empty string");
  }
  const reasonCode = row.reasonCode;
  if (typeof row.coverage !== "number" || !Number.isFinite(row.coverage)) {
    fail("coverage must be between 0 and 1");
  }
  const coverage = row.coverage;
  if (typeof row.latencyMs !== "number" || !Number.isFinite(row.latencyMs)) {
    fail("latencyMs must be a finite number");
  }
  const latencyMs = row.latencyMs;
  const memoryBytes = numberOrNull(row.memoryBytes, "memoryBytes");

  if (coverage < 0 || coverage > 1) {
    fail("coverage must be between 0 and 1");
  }
  if (reasonCode.trim() === "") {
    fail("reasonCode must be a non-empty string");
  }
  if (status === "scored") {
    assertProbability(documentRawScore, "documentRawScore");
    assertProbability(localizedRawScore, "localizedRawScore");
  } else if (documentRawScore !== null || localizedRawScore !== null) {
    fail("scores must be null unless status is scored");
  }
  if (status === "abstained" && evidenceQuality === "sufficient") {
    fail("abstained prediction cannot have sufficient evidence");
  }
  if (status === "error" && evidenceQuality !== "unsupported") {
    fail("error prediction must have unsupported evidence");
  }
  // An error row without a readable, sanitized cause is the artifact this field
  // exists to abolish, so it is required here and forbidden anywhere else.
  const carriesDetail = Object.hasOwn(row, "failureDetail");
  // The guard narrows, so the detail is read without a cast, like every other
  // field in this parser: if the sanitized-detail contract ever widened to admit
  // a non-string, this line would turn red instead of laundering the value into
  // StrictPredictionV2 as a string.
  const failureDetail = isSanitizedFailureDetail(row.failureDetail)
    ? row.failureDetail
    : undefined;
  if (carriesDetail && failureDetail === undefined) {
    fail(
      "failureDetail must be an allowlisted sanitized detail of at most 160 characters",
    );
  }
  if (status === "error" && !carriesDetail) {
    fail("error prediction must carry a failureDetail");
  }
  if (status !== "error" && carriesDetail) {
    fail("failureDetail is only allowed when status is error");
  }
  if (
    memoryBytes !== null &&
    (!Number.isFinite(memoryBytes) || memoryBytes < 0)
  ) {
    fail("memoryBytes must be null or a finite nonnegative number");
  }

  return {
    schemaVersion: 2,
    id,
    status,
    documentRawScore,
    localizedRawScore,
    evidenceQuality,
    reasonCode,
    coverage,
    latencyMs,
    memoryBytes,
    ...(failureDetail === undefined ? {} : { failureDetail }),
  };
}

/**
 * Parses a JSONL batch of prediction rows. Every non-blank line must be a valid
 * closed row and every id must be unique: a repeated id is a hard failure, never
 * a silent overwrite.
 */
export function parsePredictions(jsonl: string): StrictPredictionV2[] {
  const predictions: StrictPredictionV2[] = [];
  const seen = new Set<string>();
  jsonl.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === "") return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      fail(`prediction line ${index + 1} is not valid JSON`);
    }
    const prediction = validatePredictionRow(parsed);
    if (seen.has(prediction.id)) {
      fail(`duplicate prediction id ${prediction.id}`);
    }
    seen.add(prediction.id);
    predictions.push(prediction);
  });
  return predictions;
}

function assertSafeRelativePath(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(`${name} must be a non-empty relative path`);
  }
  if (
    value.includes("\\") ||
    value.startsWith("/") ||
    /^[a-zA-Z]:/u.test(value)
  ) {
    fail(`${name} must be a safe relative path`);
  }
  for (const segment of value.split("/")) {
    if (segment === "" || segment === "." || segment === "..") {
      fail(`${name} must be a safe relative path without "." or ".." segments`);
    }
  }
  return value;
}

function validateShardDescriptor(
  value: unknown,
  index: number,
): PredictionShardDescriptor {
  const shard = assertClosedObject(value, `shards[${index}]`, SHARD_KEYS);
  const shardIndex = integer(shard.index, `shards[${index}].index`);
  if (shardIndex < 0) {
    fail(`shards[${index}].index must be non-negative`);
  }
  const file = assertSafeRelativePath(
    shard.file,
    `shard file shards[${index}].file`,
  );
  const sha256 = lowercaseSha256(shard.sha256, `shards[${index}].sha256`);
  const recordCount = integer(
    shard.recordCount,
    `shards[${index}].recordCount`,
  );
  if (recordCount < 0) {
    fail(`shards[${index}].recordCount must be non-negative`);
  }
  return { index: shardIndex, file, sha256, recordCount };
}

/** Closed parser for a prediction manifest. Rejects any drift. */
export function parsePredictionManifest(
  value: unknown,
  options: ParsePredictionManifestOptions = {},
): PredictionManifestV1 {
  const root = assertClosedObject(value, "manifest", MANIFEST_KEYS);

  if (root.schemaVersion !== 1) {
    fail("manifest.schemaVersion must be 1");
  }
  const modelId = nonEmptyString(root.modelId, "modelId");
  const modelVersion = nonEmptyString(root.modelVersion, "modelVersion");
  const bundleDigest = lowercaseSha256(root.bundleDigest, "bundleDigest");
  const aggregationVersion = nonEmptyString(
    root.aggregationVersion,
    "aggregationVersion",
  );
  const contentCompositionVersion = nonEmptyString(
    root.contentCompositionVersion,
    "contentCompositionVersion",
  );
  const tokenizerDigest = lowercaseSha256(
    root.tokenizerDigest,
    "tokenizerDigest",
  );
  const runtimeParityDigest = lowercaseSha256(
    root.runtimeParityDigest,
    "runtimeParityDigest",
  );
  const extensionBuildDigest = lowercaseSha256(
    root.extensionBuildDigest,
    "extensionBuildDigest",
  );
  const backend = enumValue(root.backend, "backend", BACKENDS);
  const chromeVersion = nonEmptyString(root.chromeVersion, "chromeVersion");
  if (
    options.scientificUse === "release" &&
    chromeVersion !== RELEASE_CHROME_VERSION
  ) {
    fail(
      `chromeVersion must equal ${RELEASE_CHROME_VERSION} for release-eligible scoring`,
    );
  }
  const datasetDigest = lowercaseSha256(root.datasetDigest, "datasetDigest");
  const splitDigest = lowercaseSha256(root.splitDigest, "splitDigest");
  const partition = enumValue(root.partition, "partition", PARTITIONS);

  if (root.shardSize !== SHARD_SIZE) {
    fail(`shardSize must be ${SHARD_SIZE}`);
  }
  const shardCount = integer(root.shardCount, "shardCount");
  if (shardCount < 0) {
    fail("shardCount must be non-negative");
  }
  if (!Array.isArray(root.shards)) {
    fail("shards must be an array");
  }
  if (root.shards.length !== shardCount) {
    fail("shardCount must equal the number of shards");
  }
  const shards = root.shards.map((shard, index) =>
    validateShardDescriptor(shard, index),
  );

  const holdoutConsumptionId = root.holdoutConsumptionId;
  if (partition === "test") {
    if (
      typeof holdoutConsumptionId !== "string" ||
      holdoutConsumptionId === ""
    ) {
      fail("test manifest requires a holdoutConsumptionId session id");
    }
  } else if (holdoutConsumptionId !== null) {
    fail("holdoutConsumptionId must be null for dev and cal-A manifests");
  }

  const createdAt = nonEmptyString(root.createdAt, "createdAt");

  return {
    schemaVersion: 1,
    modelId,
    modelVersion,
    bundleDigest,
    aggregationVersion,
    contentCompositionVersion,
    tokenizerDigest,
    runtimeParityDigest,
    extensionBuildDigest,
    backend,
    chromeVersion,
    datasetDigest,
    splitDigest,
    partition,
    shardSize: SHARD_SIZE,
    shardCount,
    shards,
    holdoutConsumptionId:
      partition === "test" ? (holdoutConsumptionId as string) : null,
    createdAt,
  };
}

/** SHA-256 (hex) of the full canonical prediction manifest. */
export async function computePredictionManifestDigest(
  manifest: PredictionManifestV1,
): Promise<string> {
  return canonicalSha256(manifest);
}

/**
 * Validates the shard inventory: shards must be contiguous from zero, each at
 * most the shard size, and only the last shard may be short. Callers that read
 * the shard files recompute each sha256 before concatenating lines; this checks
 * the declared structure that gates that read.
 */
export function validatePredictionShards(manifest: PredictionManifestV1): void {
  if (manifest.shardSize !== SHARD_SIZE) {
    fail(`shardSize must be ${SHARD_SIZE}`);
  }
  if (manifest.shards.length !== manifest.shardCount) {
    fail("shardCount must equal the number of shards");
  }
  manifest.shards.forEach((shard, index) => {
    if (shard.index !== index) {
      fail(
        `shard index must be contiguous from zero; expected ${index} at position ${index}`,
      );
    }
    if (shard.recordCount > SHARD_SIZE) {
      fail(`shard recordCount must not exceed ${SHARD_SIZE}`);
    }
    const isLast = index === manifest.shards.length - 1;
    if (!isLast && shard.recordCount !== SHARD_SIZE) {
      fail(`only the last shard may hold fewer than ${SHARD_SIZE} records`);
    }
  });
}

/**
 * Verifies that predictions cover EXACTLY the expected ids: one row per id, no
 * missing and no extra. Throws a single ordered error naming every discrepancy.
 */
export function assertPredictionCompleteness(
  expectedIds: readonly string[],
  predictions: readonly { id: string }[],
): void {
  const expected = new Set(expectedIds);
  const actual = new Set(predictions.map((prediction) => prediction.id));
  const missing = [...expected].filter((id) => !actual.has(id)).sort();
  const extra = [...actual].filter((id) => !expected.has(id)).sort();
  if (missing.length > 0 || extra.length > 0) {
    fail(
      `prediction completeness failed: missing=${missing.join(",")} extra=${extra.join(",")}`,
    );
  }
}
