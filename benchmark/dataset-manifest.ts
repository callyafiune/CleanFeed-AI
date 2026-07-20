// Corpus manifest, license inventory, human review rules and the closed
// 4k/4k/2k release sealing. Like schema.ts this module is standalone and MUST
// NOT import from the extension bundle (src/); it depends only on the closed
// benchmark record schema and on the Phase 1 canonical-json digest helper shared
// through contracts/.
//
// "Sealed" means sealDataset only produces a DatasetAudit when the observed file
// bytes match the manifest exactly, the composition equals the policy counts,
// every record carries two distinct reviewers (plus an independent adjudicator
// on divergence), and every referenced license is present and approved in the
// inventory. The audit is self-digested with canonicalSha256 so any later change
// to a conclusion invalidates auditDigest. There is no coercion and no
// last-write-wins.

import { canonicalSha256 } from "../contracts/canonical-json.ts";
import { validateBenchmarkRecord, type BenchmarkRecord } from "./schema.ts";

export interface DatasetManifest {
  schemaVersion: 1;
  datasetId: string;
  version: string;
  scientificUse: "release" | "infrastructure-only";
  intendedLanguage: "pt-BR";
  intendedDomain: "linkedin";
  createdAt: string;
  normalizationVersion: string;
  annotationProtocolVersion: "annotation-v1";
  recordsFile: "records.jsonl";
  recordsSha256: string;
  reviewLedgerFile: "private/review-ledger.jsonl";
  reviewLedgerSha256: string;
  sourceManifestFile: "private/source-manifest.json";
  sourceManifestSha256: string;
  heldOutGeneratorFamilies: [string, ...string[]];
  licenses: Array<{
    id: string;
    name: string;
    source: string;
    evaluationUseApproved: true;
    redistribution: "allowed" | "not-published";
    notice: string;
  }>;
}

export interface DatasetFileDigests {
  recordsSha256: string;
  reviewLedgerSha256: string;
  sourceManifestSha256: string;
}

export interface CorpusPolicy {
  counts: { human: number; ai: number; mixed: number };
  requiredHumanSourceTypes: readonly string[];
  requiredHardNegativeFamilies: readonly string[];
}

export const RELEASE_CORPUS_POLICY: CorpusPolicy = {
  counts: { human: 4_000, ai: 4_000, mixed: 2_000 },
  requiredHumanSourceTypes: [
    "broetry",
    "recruiting",
    "sales",
    "career",
    "technology",
    "formal",
  ],
  requiredHardNegativeFamilies: [
    "formulaic",
    "motivational",
    "highly-polished",
    "repetitive",
    "non-native",
    "corporate-structure",
  ],
};

export interface DatasetAudit {
  datasetId: string;
  scientificUse: DatasetManifest["scientificUse"];
  releaseEligible: boolean;
  recordCount: number;
  counts: Record<"human" | "ai" | "mixed", number>;
  sourceTypes: Record<string, number>;
  hardNegativeFamilies: Record<string, number>;
  generatorFamilies: Record<string, number>;
  licenses: string[];
  recordsSha256: string;
  reviewLedgerSha256: string;
  sourceManifestSha256: string;
  sealed: true;
  auditDigest: string;
}

/** Coded, fail-closed error thrown by the manifest and sealing logic. */
export class DatasetManifestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DatasetManifestError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new DatasetManifestError(code, message);
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
const LABELS: ReadonlyArray<"human" | "ai" | "mixed"> = [
  "human",
  "ai",
  "mixed",
];

const MANIFEST_KEYS = [
  "schemaVersion",
  "datasetId",
  "version",
  "scientificUse",
  "intendedLanguage",
  "intendedDomain",
  "createdAt",
  "normalizationVersion",
  "annotationProtocolVersion",
  "recordsFile",
  "recordsSha256",
  "reviewLedgerFile",
  "reviewLedgerSha256",
  "sourceManifestFile",
  "sourceManifestSha256",
  "heldOutGeneratorFamilies",
  "licenses",
] as const;
const LICENSE_KEYS = [
  "id",
  "name",
  "source",
  "evaluationUseApproved",
  "redistribution",
  "notice",
] as const;
const AUDIT_KEYS = [
  "datasetId",
  "scientificUse",
  "releaseEligible",
  "recordCount",
  "counts",
  "sourceTypes",
  "hardNegativeFamilies",
  "generatorFamilies",
  "licenses",
  "recordsSha256",
  "reviewLedgerSha256",
  "sourceManifestSha256",
  "sealed",
  "auditDigest",
] as const;

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
    fail("DATASET_SCHEMA_INVALID", `${label} must be an object`);
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      fail("DATASET_SCHEMA_INVALID", `unknown key "${key}" in ${label}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail("DATASET_SCHEMA_INVALID", `${label} is missing key "${key}"`);
    }
  }
  return value;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("DATASET_FIELD_INVALID", `${name} must be a non-empty string`);
  }
  return value;
}

function literal<T extends string>(
  value: unknown,
  name: string,
  expected: T,
): T {
  if (value !== expected) {
    fail("DATASET_FIELD_INVALID", `${name} must equal "${expected}"`);
  }
  return expected;
}

function lowercaseSha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(
      "DATASET_FIELD_INVALID",
      `${name} must be a lowercase 64-character sha256 hex digest`,
    );
  }
  return value;
}

function nonNegativeInteger(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    fail("DATASET_FIELD_INVALID", `${name} must be a non-negative integer`);
  }
  return value;
}

/** Closed parser for the dataset manifest. Rejects any drift or unknown key. */
export function validateDatasetManifest(value: unknown): DatasetManifest {
  const root = assertExactObject(
    value,
    "dataset manifest",
    MANIFEST_KEYS,
    MANIFEST_KEYS,
  );

  if (root.schemaVersion !== 1) {
    fail("DATASET_SCHEMA_INVALID", "schemaVersion must be 1");
  }
  const datasetId = nonEmptyString(root.datasetId, "datasetId");
  const version = nonEmptyString(root.version, "version");
  if (
    root.scientificUse !== "release" &&
    root.scientificUse !== "infrastructure-only"
  ) {
    fail(
      "DATASET_FIELD_INVALID",
      'scientificUse must be "release" or "infrastructure-only"',
    );
  }
  const scientificUse = root.scientificUse;
  literal(root.intendedLanguage, "intendedLanguage", "pt-BR");
  literal(root.intendedDomain, "intendedDomain", "linkedin");
  const createdAt = nonEmptyString(root.createdAt, "createdAt");
  if (!Number.isFinite(Date.parse(createdAt))) {
    fail("DATASET_FIELD_INVALID", "createdAt must be a valid ISO timestamp");
  }
  const normalizationVersion = nonEmptyString(
    root.normalizationVersion,
    "normalizationVersion",
  );
  literal(
    root.annotationProtocolVersion,
    "annotationProtocolVersion",
    "annotation-v1",
  );
  literal(root.recordsFile, "recordsFile", "records.jsonl");
  const recordsSha256 = lowercaseSha256(root.recordsSha256, "recordsSha256");
  literal(
    root.reviewLedgerFile,
    "reviewLedgerFile",
    "private/review-ledger.jsonl",
  );
  const reviewLedgerSha256 = lowercaseSha256(
    root.reviewLedgerSha256,
    "reviewLedgerSha256",
  );
  literal(
    root.sourceManifestFile,
    "sourceManifestFile",
    "private/source-manifest.json",
  );
  const sourceManifestSha256 = lowercaseSha256(
    root.sourceManifestSha256,
    "sourceManifestSha256",
  );

  if (
    !Array.isArray(root.heldOutGeneratorFamilies) ||
    root.heldOutGeneratorFamilies.length === 0
  ) {
    fail(
      "DATASET_FIELD_INVALID",
      "heldOutGeneratorFamilies must list at least one family",
    );
  }
  const heldOutGeneratorFamilies = root.heldOutGeneratorFamilies.map(
    (family, index) =>
      nonEmptyString(family, `heldOutGeneratorFamilies[${index}]`),
  ) as [string, ...string[]];

  if (!Array.isArray(root.licenses) || root.licenses.length === 0) {
    fail("DATASET_FIELD_INVALID", "licenses must list at least one license");
  }
  const licenses = root.licenses.map((rawLicense, index) => {
    const licenseObj = assertExactObject(
      rawLicense,
      `licenses[${index}]`,
      LICENSE_KEYS,
      LICENSE_KEYS,
    );
    const id = nonEmptyString(licenseObj.id, `licenses[${index}].id`);
    const name = nonEmptyString(licenseObj.name, `licenses[${index}].name`);
    const source = nonEmptyString(
      licenseObj.source,
      `licenses[${index}].source`,
    );
    if (licenseObj.evaluationUseApproved !== true) {
      fail(
        "DATASET_FIELD_INVALID",
        `licenses[${index}].evaluationUseApproved must be true`,
      );
    }
    if (
      licenseObj.redistribution !== "allowed" &&
      licenseObj.redistribution !== "not-published"
    ) {
      fail(
        "DATASET_FIELD_INVALID",
        `licenses[${index}].redistribution must be "allowed" or "not-published"`,
      );
    }
    const notice = nonEmptyString(
      licenseObj.notice,
      `licenses[${index}].notice`,
    );
    // After the guard above, redistribution is one of the two allowed literals;
    // narrow it explicitly so the returned union type is exact.
    const redistribution: "allowed" | "not-published" =
      licenseObj.redistribution === "allowed" ? "allowed" : "not-published";
    return {
      id,
      name,
      source,
      evaluationUseApproved: true as const,
      redistribution,
      notice,
    };
  });

  return {
    schemaVersion: 1,
    datasetId,
    version,
    scientificUse,
    intendedLanguage: "pt-BR",
    intendedDomain: "linkedin",
    createdAt,
    normalizationVersion,
    annotationProtocolVersion: "annotation-v1",
    recordsFile: "records.jsonl",
    recordsSha256,
    reviewLedgerFile: "private/review-ledger.jsonl",
    reviewLedgerSha256,
    sourceManifestFile: "private/source-manifest.json",
    sourceManifestSha256,
    heldOutGeneratorFamilies,
    licenses,
  };
}

function increment(tally: Record<string, number>, key: string): void {
  tally[key] = (tally[key] ?? 0) + 1;
}

/** SHA-256 (hex) of the canonical bytes of the audit without `auditDigest`. */
export async function computeDatasetAuditDigest(
  input: Omit<DatasetAudit, "auditDigest">,
): Promise<string> {
  return canonicalSha256(input);
}

/**
 * Verifies the manifest, observed bytes and review rules, then produces the
 * signed DatasetAudit only for a corpus that matches the policy composition
 * exactly. Release-eligible corpora additionally require full source-type,
 * hard-negative and held-out-family coverage; synthetic infrastructure fixtures
 * run every scale validator but are never release eligible.
 */
export async function sealDataset(
  manifest: DatasetManifest,
  records: BenchmarkRecord[],
  policy: CorpusPolicy,
  observedFiles: DatasetFileDigests,
): Promise<DatasetAudit> {
  const m = validateDatasetManifest(manifest);

  if (observedFiles.recordsSha256 !== m.recordsSha256) {
    fail(
      "DATASET_DIGEST_MISMATCH",
      "observed recordsSha256 does not match the manifest",
    );
  }
  if (observedFiles.reviewLedgerSha256 !== m.reviewLedgerSha256) {
    fail(
      "DATASET_DIGEST_MISMATCH",
      "observed reviewLedgerSha256 does not match the manifest",
    );
  }
  if (observedFiles.sourceManifestSha256 !== m.sourceManifestSha256) {
    fail(
      "DATASET_DIGEST_MISMATCH",
      "observed sourceManifestSha256 does not match the manifest",
    );
  }

  const licenseIds = new Set(m.licenses.map((license) => license.id));

  const counts: Record<"human" | "ai" | "mixed", number> = {
    human: 0,
    ai: 0,
    mixed: 0,
  };
  const sourceTypes: Record<string, number> = {};
  const hardNegativeFamilies: Record<string, number> = {};
  const generatorFamilies: Record<string, number> = {};
  const seenIds = new Set<string>();
  const seenHashes = new Set<string>();
  const normalized: BenchmarkRecord[] = [];

  for (const raw of records) {
    const record = validateBenchmarkRecord(raw);

    if (seenIds.has(record.id)) {
      fail("DATASET_DUPLICATE", `duplicate record id ${record.id}`);
    }
    if (seenHashes.has(record.normalizedTextSha256)) {
      fail(
        "DATASET_DUPLICATE",
        `duplicate normalizedTextSha256 for record ${record.id}`,
      );
    }
    seenIds.add(record.id);
    seenHashes.add(record.normalizedTextSha256);

    const distinctReviewers = new Set(record.annotation.reviewerIds);
    if (distinctReviewers.size < 2) {
      fail(
        "DATASET_REVIEW_INVALID",
        `record ${record.id} requires two distinct reviewers`,
      );
    }
    if (
      record.annotation.agreement === "adjudicated" &&
      record.annotation.adjudicatorId !== undefined &&
      distinctReviewers.has(record.annotation.adjudicatorId)
    ) {
      fail(
        "DATASET_REVIEW_INVALID",
        `record ${record.id} adjudicator must be independent from its two reviewers`,
      );
    }

    if (!licenseIds.has(record.provenance.licenseId)) {
      fail(
        "DATASET_LICENSE_INVALID",
        `record ${record.id} references license "${record.provenance.licenseId}" absent from the inventory`,
      );
    }

    counts[record.label] += 1;
    if (record.humanSourceType !== undefined) {
      increment(sourceTypes, record.humanSourceType);
    }
    if (record.hardNegativeFamily !== undefined) {
      increment(hardNegativeFamilies, record.hardNegativeFamily);
    }
    if (record.groups.generatorFamily !== undefined) {
      increment(generatorFamilies, record.groups.generatorFamily);
    }
    normalized.push(record);
  }

  for (const label of LABELS) {
    if (counts[label] !== policy.counts[label]) {
      fail(
        "DATASET_COMPOSITION_INVALID",
        `expected ${label}=${policy.counts[label]}, received ${label}=${counts[label]}`,
      );
    }
  }

  const releaseEligible = m.scientificUse === "release";
  if (releaseEligible) {
    for (const sourceType of policy.requiredHumanSourceTypes) {
      if ((sourceTypes[sourceType] ?? 0) === 0) {
        fail(
          "DATASET_COVERAGE_INVALID",
          `release corpus is missing required human source type "${sourceType}"`,
        );
      }
    }
    for (const family of policy.requiredHardNegativeFamilies) {
      if ((hardNegativeFamilies[family] ?? 0) === 0) {
        fail(
          "DATASET_COVERAGE_INVALID",
          `release corpus is missing required hard-negative family "${family}"`,
        );
      }
    }
    for (const family of m.heldOutGeneratorFamilies) {
      const positives = normalized.filter(
        (record) =>
          (record.label === "ai" || record.label === "mixed") &&
          record.groups.generatorFamily === family,
      ).length;
      const appearsInHuman = normalized.some(
        (record) =>
          record.label === "human" && record.groups.generatorFamily === family,
      );
      if (appearsInHuman) {
        fail(
          "DATASET_COVERAGE_INVALID",
          `held-out generator family "${family}" must appear only in ai or mixed records`,
        );
      }
      if (positives < 200) {
        fail(
          "DATASET_COVERAGE_INVALID",
          `held-out generator family "${family}" requires at least 200 eligible positives`,
        );
      }
    }
  }

  const auditInput: Omit<DatasetAudit, "auditDigest"> = {
    datasetId: m.datasetId,
    scientificUse: m.scientificUse,
    releaseEligible,
    recordCount: normalized.length,
    counts,
    sourceTypes,
    hardNegativeFamilies,
    generatorFamilies,
    licenses: [...licenseIds].sort(),
    recordsSha256: m.recordsSha256,
    reviewLedgerSha256: m.reviewLedgerSha256,
    sourceManifestSha256: m.sourceManifestSha256,
    sealed: true,
  };
  const auditDigest = await computeDatasetAuditDigest(auditInput);
  return { ...auditInput, auditDigest };
}

function integerTally(value: unknown, name: string): Record<string, number> {
  if (!isPlainObject(value)) {
    fail("DATASET_SCHEMA_INVALID", `${name} must be an object`);
  }
  const tally: Record<string, number> = {};
  for (const key of Object.keys(value)) {
    nonEmptyString(key, `${name} key`);
    tally[key] = nonNegativeInteger(value[key], `${name}.${key}`);
  }
  return tally;
}

/** Closed parser for a signed DatasetAudit. Recomputes and verifies the digest. */
export async function parseDatasetAudit(value: unknown): Promise<DatasetAudit> {
  const root = assertExactObject(
    value,
    "dataset audit",
    AUDIT_KEYS,
    AUDIT_KEYS,
  );

  const datasetId = nonEmptyString(root.datasetId, "datasetId");
  if (
    root.scientificUse !== "release" &&
    root.scientificUse !== "infrastructure-only"
  ) {
    fail(
      "DATASET_FIELD_INVALID",
      'scientificUse must be "release" or "infrastructure-only"',
    );
  }
  const scientificUse = root.scientificUse;
  if (typeof root.releaseEligible !== "boolean") {
    fail("DATASET_FIELD_INVALID", "releaseEligible must be a boolean");
  }
  const releaseEligible = root.releaseEligible;
  if (releaseEligible !== (scientificUse === "release")) {
    fail(
      "DATASET_STATE_INVALID",
      "releaseEligible may only be true when scientificUse is release",
    );
  }
  const recordCount = nonNegativeInteger(root.recordCount, "recordCount");

  const countsObj = assertExactObject(root.counts, "counts", LABELS, LABELS);
  const counts: Record<"human" | "ai" | "mixed", number> = {
    human: nonNegativeInteger(countsObj.human, "counts.human"),
    ai: nonNegativeInteger(countsObj.ai, "counts.ai"),
    mixed: nonNegativeInteger(countsObj.mixed, "counts.mixed"),
  };

  const sourceTypes = integerTally(root.sourceTypes, "sourceTypes");
  const hardNegativeFamilies = integerTally(
    root.hardNegativeFamilies,
    "hardNegativeFamilies",
  );
  const generatorFamilies = integerTally(
    root.generatorFamilies,
    "generatorFamilies",
  );

  if (!Array.isArray(root.licenses)) {
    fail("DATASET_FIELD_INVALID", "licenses must be an array");
  }
  const licenses = root.licenses.map((license, index) =>
    nonEmptyString(license, `licenses[${index}]`),
  );

  const recordsSha256 = lowercaseSha256(root.recordsSha256, "recordsSha256");
  const reviewLedgerSha256 = lowercaseSha256(
    root.reviewLedgerSha256,
    "reviewLedgerSha256",
  );
  const sourceManifestSha256 = lowercaseSha256(
    root.sourceManifestSha256,
    "sourceManifestSha256",
  );

  if (root.sealed !== true) {
    fail("DATASET_STATE_INVALID", "sealed must be true");
  }

  const auditDigest = lowercaseSha256(root.auditDigest, "auditDigest");

  const auditInput: Omit<DatasetAudit, "auditDigest"> = {
    datasetId,
    scientificUse,
    releaseEligible,
    recordCount,
    counts,
    sourceTypes,
    hardNegativeFamilies,
    generatorFamilies,
    licenses,
    recordsSha256,
    reviewLedgerSha256,
    sourceManifestSha256,
    sealed: true,
  };
  const expectedDigest = await computeDatasetAuditDigest(auditInput);
  if (expectedDigest !== auditDigest) {
    fail(
      "DATASET_DIGEST_MISMATCH",
      "auditDigest does not match the recomputed dataset audit digest",
    );
  }

  return { ...auditInput, auditDigest };
}
