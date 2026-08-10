// Pure, closed governance contract for corpus source readiness. This module is
// shared by Phase 3 (which PRODUCES the report) and never touches Node, DOM or
// Chrome APIs: it depends only on the canonical-json digest helper from Phase 1.
//
// "Closed" means the parser validates every object against an exact key set with
// no coercion: any unknown key, malformed digest, out-of-order or duplicated
// blocking reason, or a `reportDigest` that no longer matches the recomputed
// self-digest is a hard failure. The contract is the single source of the eleven
// blocking codes and of the report shape; Phase 3 imports and produces, never
// redeclares. A code ADDED here is refused by an older parser, which is fail-closed in
// the right direction: a report naming a reason the reader has no vocabulary for must
// not read as a clean one.
//
// `sourceManifestDigest` is the canonical self-digest of Phase 3's reviewed
// source manifest (its own digest field excluded), NOT the raw file SHA. The raw
// SHA lives on DatasetManifest/DatasetAudit; `fit` verifies both to bridge the
// readiness decision to the sealed bytes.

import { canonicalSha256 } from "./canonical-json.ts";

/** The closed, ordered set of the eleven corpus source blocking codes. */
export const CORPUS_SOURCE_BLOCKING_CODES = [
  "SOURCE_MANIFEST_INVALID",
  "SOURCE_REFERENCE_MISSING",
  "EVALUATION_USE_NOT_APPROVED",
  "LINKEDIN_SOURCE_NOT_AUTHORIZED",
  "SOURCE_LEGAL_REVIEW_MISSING",
  "SOURCE_REVIEWERS_NOT_INDEPENDENT",
  "COLLECTION_PROTOCOL_MISMATCH",
  "GENERATION_RECIPE_MISSING",
  "GENERATION_RECIPE_MISMATCH",
  // A1: the source's own access terms are unresolved, whatever its licence permits.
  // Its own code and not `EVALUATION_USE_NOT_APPROVED`, because approving the use is
  // not what is missing — a verifiable legal disposition of the dump's 2024 access
  // terms is, and no field of a manifest entry can supply one.
  "SOURCE_BLOCKED_BY_ACCESS_TERMS",
  // The source's route and licence are admissible and its SNAPSHOT is outside the
  // declared frame, so its records have no quota cell to be counted in. Its own code
  // and not `SOURCE_BLOCKED_BY_ACCESS_TERMS`, because nothing about it is refused: the
  // two would be conflated into "this source is not allowed", which is false of one of
  // them and erases what re-admitting it would cost — naming the cell it would add.
  "SOURCE_OUT_OF_DECLARED_FRAME",
] as const;

export type CorpusSourceBlockingCode =
  (typeof CORPUS_SOURCE_BLOCKING_CODES)[number];

export interface CorpusSourceBlockingReason {
  code: CorpusSourceBlockingCode;
  recordId?: string;
  sourceId?: string;
}

export interface CorpusSourceReadinessReport {
  schemaVersion: 1;
  status: "ready" | "blocked";
  sourceManifestDigest: string;
  recordCount: number;
  sourceCount: number;
  acquisitionCounts: {
    consent: number;
    licensed: number;
    generated: number;
  };
  protocols: {
    corpus: "corpus-v1";
    collection: "collection-v1";
    annotation: "annotation-v1";
    generation: "generation-v1";
    pii: "pii-review-v1";
  };
  blockingReasons: CorpusSourceBlockingReason[];
  reportDigest: string;
}

export type SourceReadinessDigestInput = Omit<
  CorpusSourceReadinessReport,
  "reportDigest"
>;

/** Coded, fail-closed error thrown by the source readiness parser. */
export class SourceReadinessError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "SourceReadinessError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new SourceReadinessError(code, message);
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

const ROOT_KEYS = [
  "schemaVersion",
  "status",
  "sourceManifestDigest",
  "recordCount",
  "sourceCount",
  "acquisitionCounts",
  "protocols",
  "blockingReasons",
  "reportDigest",
] as const;
const ACQUISITION_KEYS = ["consent", "licensed", "generated"] as const;
const PROTOCOL_KEYS = [
  "corpus",
  "collection",
  "annotation",
  "generation",
  "pii",
] as const;
const PROTOCOL_LITERALS: Record<(typeof PROTOCOL_KEYS)[number], string> = {
  corpus: "corpus-v1",
  collection: "collection-v1",
  annotation: "annotation-v1",
  generation: "generation-v1",
  pii: "pii-review-v1",
};
const REASON_ALLOWED_KEYS = ["code", "recordId", "sourceId"] as const;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function assertExactObject(
  value: unknown,
  label: string,
  allowed: readonly string[],
  required: readonly string[],
): Record<string, unknown> {
  if (!isPlainObject(value)) {
    fail("SOURCE_READINESS_SCHEMA_INVALID", `${label} must be an object`);
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      fail(
        "SOURCE_READINESS_SCHEMA_INVALID",
        `unknown key "${key}" in ${label}`,
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail(
        "SOURCE_READINESS_SCHEMA_INVALID",
        `${label} is missing key "${key}"`,
      );
    }
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail(
      "SOURCE_READINESS_FIELD_INVALID",
      `${name} must be a non-negative integer`,
    );
  }
  return value;
}

function lowercaseSha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(
      "SOURCE_READINESS_FIELD_INVALID",
      `${name} must be a lowercase 64-character sha256 hex digest`,
    );
  }
  return value;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail(
      "SOURCE_READINESS_FIELD_INVALID",
      `${name} must be a non-empty string`,
    );
  }
  return value;
}

function reasonSortKey(reason: CorpusSourceBlockingReason): string {
  return JSON.stringify([
    reason.code,
    reason.recordId ?? "",
    reason.sourceId ?? "",
  ]);
}

function compareReasons(
  a: CorpusSourceBlockingReason,
  b: CorpusSourceBlockingReason,
): number {
  const left: [string, string, string] = [
    a.code,
    a.recordId ?? "",
    a.sourceId ?? "",
  ];
  const right: [string, string, string] = [
    b.code,
    b.recordId ?? "",
    b.sourceId ?? "",
  ];
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] < right[index]) return -1;
    if (left[index] > right[index]) return 1;
  }
  return 0;
}

/** SHA-256 (hex) of the canonical bytes of the report without `reportDigest`. */
export async function computeSourceReadinessDigest(
  value: SourceReadinessDigestInput,
): Promise<string> {
  return canonicalSha256(value);
}

/** Closed parser for the corpus source readiness report. Rejects any drift. */
export async function parseCorpusSourceReadinessReport(
  value: unknown,
): Promise<CorpusSourceReadinessReport> {
  const root = assertExactObject(value, "report", ROOT_KEYS, ROOT_KEYS);

  if (root.schemaVersion !== 1) {
    fail("SOURCE_READINESS_SCHEMA_INVALID", "schemaVersion must be 1");
  }

  if (root.status !== "ready" && root.status !== "blocked") {
    fail(
      "SOURCE_READINESS_FIELD_INVALID",
      'status must be "ready" or "blocked"',
    );
  }
  const status = root.status;

  const sourceManifestDigest = lowercaseSha256(
    root.sourceManifestDigest,
    "sourceManifestDigest",
  );
  const recordCount = nonNegativeInteger(root.recordCount, "recordCount");
  const sourceCount = nonNegativeInteger(root.sourceCount, "sourceCount");

  const acquisitionObj = assertExactObject(
    root.acquisitionCounts,
    "acquisitionCounts",
    ACQUISITION_KEYS,
    ACQUISITION_KEYS,
  );
  const consent = nonNegativeInteger(
    acquisitionObj.consent,
    "acquisitionCounts.consent",
  );
  const licensed = nonNegativeInteger(
    acquisitionObj.licensed,
    "acquisitionCounts.licensed",
  );
  const generated = nonNegativeInteger(
    acquisitionObj.generated,
    "acquisitionCounts.generated",
  );
  if (consent + licensed + generated !== recordCount) {
    fail(
      "SOURCE_READINESS_FIELD_INVALID",
      "acquisitionCounts must sum to recordCount",
    );
  }

  const protocolObj = assertExactObject(
    root.protocols,
    "protocols",
    PROTOCOL_KEYS,
    PROTOCOL_KEYS,
  );
  for (const key of PROTOCOL_KEYS) {
    if (protocolObj[key] !== PROTOCOL_LITERALS[key]) {
      fail(
        "SOURCE_READINESS_FIELD_INVALID",
        `protocols.${key} must equal "${PROTOCOL_LITERALS[key]}"`,
      );
    }
  }

  if (!Array.isArray(root.blockingReasons)) {
    fail("SOURCE_READINESS_FIELD_INVALID", "blockingReasons must be an array");
  }
  const codeSet = new Set<string>(CORPUS_SOURCE_BLOCKING_CODES);
  const reasons: CorpusSourceBlockingReason[] = root.blockingReasons.map(
    (raw, index) => {
      const reasonObj = assertExactObject(
        raw,
        `blockingReasons[${index}]`,
        REASON_ALLOWED_KEYS,
        ["code"],
      );
      const code = reasonObj.code;
      if (typeof code !== "string" || !codeSet.has(code)) {
        fail(
          "SOURCE_READINESS_FIELD_INVALID",
          `blockingReasons[${index}].code is not a recognized corpus source blocking code`,
        );
      }
      const reason: CorpusSourceBlockingReason = {
        code: code as CorpusSourceBlockingCode,
      };
      if (Object.hasOwn(reasonObj, "recordId")) {
        reason.recordId = nonEmptyString(
          reasonObj.recordId,
          `blockingReasons[${index}].recordId`,
        );
      }
      if (Object.hasOwn(reasonObj, "sourceId")) {
        reason.sourceId = nonEmptyString(
          reasonObj.sourceId,
          `blockingReasons[${index}].sourceId`,
        );
      }
      return reason;
    },
  );

  for (let index = 1; index < reasons.length; index += 1) {
    const order = compareReasons(reasons[index - 1], reasons[index]);
    if (order > 0) {
      fail(
        "SOURCE_READINESS_FIELD_INVALID",
        "blockingReasons must be sorted in canonical order",
      );
    }
    if (
      order === 0 &&
      reasonSortKey(reasons[index - 1]) === reasonSortKey(reasons[index])
    ) {
      fail(
        "SOURCE_READINESS_FIELD_INVALID",
        "duplicate blockingReasons entry is not allowed",
      );
    }
  }

  if (status === "ready" && reasons.length !== 0) {
    fail(
      "SOURCE_READINESS_STATE_INVALID",
      'status "ready" requires empty blockingReasons',
    );
  }
  if (status === "blocked" && reasons.length === 0) {
    fail(
      "SOURCE_READINESS_STATE_INVALID",
      'status "blocked" requires at least one blockingReasons entry',
    );
  }

  const reportDigest = lowercaseSha256(root.reportDigest, "reportDigest");

  const digestInput: SourceReadinessDigestInput = {
    schemaVersion: 1,
    status,
    sourceManifestDigest,
    recordCount,
    sourceCount,
    acquisitionCounts: { consent, licensed, generated },
    protocols: {
      corpus: "corpus-v1",
      collection: "collection-v1",
      annotation: "annotation-v1",
      generation: "generation-v1",
      pii: "pii-review-v1",
    },
    blockingReasons: reasons,
  };
  const expectedDigest = await computeSourceReadinessDigest(digestInput);
  if (expectedDigest !== reportDigest) {
    fail(
      "SOURCE_READINESS_DIGEST_MISMATCH",
      "reportDigest does not match the recomputed source readiness digest",
    );
  }

  return { ...digestInput, reportDigest };
}
