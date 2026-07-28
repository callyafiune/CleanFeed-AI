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
import {
  GeneratorFamilyError,
  asGeneratorFamily,
  generatorFamilyOf,
  type GeneratorFamily,
} from "./generator-family.ts";
import { REBUILD_V3_POLICY } from "./rebuild-v3-policy.ts";
import {
  groupAxisIdentity,
  recordEligibility,
  V3_GROUP_AXES,
  validateBenchmarkRecord,
  type BenchmarkRecord,
} from "./schema.ts";

export interface DatasetManifest {
  schemaVersion: 1;
  datasetId: string;
  version: string;
  scientificUse: "release" | "infrastructure-only";
  intendedLanguage: "pt-BR";
  intendedDomain: "generic";
  createdAt: string;
  normalizationVersion: string;
  annotationProtocolVersion: "annotation-v1";
  recordsFile: "records.jsonl";
  recordsSha256: string;
  reviewLedgerFile: "private/review-ledger.jsonl";
  reviewLedgerSha256: string;
  sourceManifestFile: "private/source-manifest.json";
  sourceManifestSha256: string;
  // The reservation itself, in canonical form. This is the DECLARED set the split
  // must mark, the audit must derive and the report must publish — all four
  // compared for exact equality (benchmark/generator-family.ts).
  heldOutGeneratorFamilies: [GeneratorFamily, ...GeneratorFamily[]];
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
  // Generic pt-BR pivot: the five human source types map the licensed sources
  // the sealed corpus is drawn from — Stack Exchange PT (qa-informal),
  // Wikipedia PT (encyclopedic), Carolina social media/datasets (social-media),
  // Carolina university (university) and Carolina judicial/legislative
  // (institutional). Hard-negative families are STYLE families, not platform
  // families, so they are unchanged by the pivot.
  requiredHumanSourceTypes: [
    "qa-informal",
    "encyclopedic",
    "social-media",
    "university",
    "institutional",
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

/**
 * What the PUBLIC audit says about the evidence behind the human labels.
 *
 * NUMBERS ONLY, and that is a privacy requirement rather than a convenience. The
 * evidence itself lives in `private/source-manifest.json`, which never enters Git
 * and never enters this artifact; a record binds to it through an `entryId` and a
 * digest, and `assertLabelEvidenceResolves` (benchmark/schema.ts) does the
 * resolution with an index the caller builds. Nothing here can name a person, a
 * thread, a page or an evidence entry, because nothing here is an identifier.
 *
 *   * `records` — how many record-lines rest on each basis.
 *   * `samplingUnits` — per basis, per axis, how many DISTINCT `known` identities
 *     there are. Which axis is the resampling unit is decided per estimand by C4,
 *     so publishing one number would silently make that choice; publishing the
 *     count for every axis lets C4 choose from the artifact instead of re-reading
 *     the corpus, and lets a reader see that a "clustered" interval over an axis
 *     with as many units as records is an i.i.d. interval with another name. That
 *     is the exact reading the v2 audit made impossible.
 *   * `ineligible` — how many record-lines carry an `unknown` axis (R6). Published
 *     beside the others so an eligible denominator is never inferred by
 *     subtraction.
 *
 * All three are zero/empty for a v2 corpus, which carries no label basis at all.
 * That is the honest value: the v2 corpus did not record this evidence, and a
 * missing number must not read as a satisfied one.
 */
export interface LabelBasisPublication {
  records: Record<string, number>;
  samplingUnits: Record<string, Record<string, number>>;
  ineligible: Record<string, number>;
}

export interface DatasetAudit {
  datasetId: string;
  scientificUse: DatasetManifest["scientificUse"];
  releaseEligible: boolean;
  recordCount: number;
  counts: Record<"human" | "ai" | "mixed", number>;
  sourceTypes: Record<string, number>;
  hardNegativeFamilies: Record<string, number>;
  generatorFamilies: Record<string, number>;
  labelBasisCounts: LabelBasisPublication;
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
  "labelBasisCounts",
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
  literal(root.intendedDomain, "intendedDomain", "generic");
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
  // A declared family that is not already canonical is REFUSED, not normalized
  // into shape: the manifest is the reservation, and a reservation nobody else can
  // match by exact equality reserves nothing.
  const heldOutGeneratorFamilies = root.heldOutGeneratorFamilies.map(
    (family, index) => {
      const raw = nonEmptyString(family, `heldOutGeneratorFamilies[${index}]`);
      try {
        return asGeneratorFamily(raw);
      } catch (error) {
        return fail(
          "DATASET_FIELD_INVALID",
          `heldOutGeneratorFamilies[${index}] ${
            error instanceof GeneratorFamilyError
              ? error.message
              : String(error)
          }`,
        );
      }
    },
  ) as [GeneratorFamily, ...GeneratorFamily[]];

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
    intendedDomain: "generic",
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

/**
 * The block a corpus that records NO label basis publishes: a zero per allowed
 * basis and no sampling-unit row.
 *
 * Exported because a fixture must not write it down by hand. It is byte-identical
 * to what {@link publishLabelBasis} returns for a v2 corpus BY CONSTRUCTION — it
 * calls it — so a hand-written copy that drifted could not make a fixture's
 * `auditDigest` disagree with a sealed one.
 */
export function emptyLabelBasisPublication(): LabelBasisPublication {
  return publishLabelBasis([]);
}

/**
 * Counts the label-basis evidence of a corpus, as numbers.
 *
 * Every basis the frozen policy allows gets a row even when it is zero, so a basis
 * that nothing rests on is VISIBLE as a zero rather than absent — an absent key
 * reads as "not measured", and the difference matters for
 * `labelBasis.underPoweredRole`, which only means something if the count is known.
 * The same holds for the per-axis unit counts: every axis of every present basis is
 * published, so a reader can see that an axis has as many units as records.
 *
 * Nothing that leaves this function is an identifier. The identities are counted
 * into a `Set` and only its `size` escapes.
 */
function publishLabelBasis(
  records: readonly BenchmarkRecord[],
): LabelBasisPublication {
  const bases = REBUILD_V3_POLICY.labelBasis.allowed;
  const publication: LabelBasisPublication = {
    records: {},
    samplingUnits: {},
    ineligible: {},
  };
  const identities = new Map<string, Map<string, Set<string>>>();
  for (const basis of bases) {
    publication.records[basis] = 0;
    publication.ineligible[basis] = 0;
    identities.set(basis, new Map());
  }

  for (const record of records) {
    if (record.schemaVersion !== 3) continue;
    const basis = record.labelBasis;
    if (basis === undefined) continue;
    publication.records[basis] = (publication.records[basis] ?? 0) + 1;
    if (!recordEligibility(record).eligible) {
      publication.ineligible[basis] = (publication.ineligible[basis] ?? 0) + 1;
    }
    const perAxis = identities.get(basis);
    if (perAxis === undefined) continue;
    for (const axis of V3_GROUP_AXES) {
      const identity = groupAxisIdentity(record, axis);
      if (identity === undefined) continue;
      const set = perAxis.get(axis) ?? new Set<string>();
      set.add(identity);
      perAxis.set(axis, set);
    }
  }

  for (const basis of bases) {
    const perAxis = identities.get(basis);
    if (perAxis === undefined || perAxis.size === 0) continue;
    const counts: Record<string, number> = {};
    // V3_GROUP_AXES order, not insertion order, so the published block is stable
    // across corpora and its canonical digest does not depend on row order.
    for (const axis of V3_GROUP_AXES) {
      const set = perAxis.get(axis);
      if (set !== undefined) counts[axis] = set.size;
    }
    publication.samplingUnits[basis] = counts;
  }
  return publication;
}

// The closed parser for the same block. It has to reproduce the emitted shape
// EXACTLY, including which keys are present, because the audit's canonical digest
// covers it: a reader that dropped an empty `samplingUnits` row would recompute a
// different `auditDigest` and reject a valid audit.
function parseLabelBasisPublication(value: unknown): LabelBasisPublication {
  const obj = assertExactObject(
    value,
    "labelBasisCounts",
    ["records", "samplingUnits", "ineligible"],
    ["records", "samplingUnits", "ineligible"],
  );
  const samplingUnitsRaw = obj.samplingUnits;
  if (!isPlainObject(samplingUnitsRaw)) {
    fail(
      "DATASET_SCHEMA_INVALID",
      "labelBasisCounts.samplingUnits must be an object",
    );
  }
  const samplingUnits: Record<string, Record<string, number>> = {};
  for (const basis of Object.keys(samplingUnitsRaw)) {
    samplingUnits[basis] = integerTally(
      samplingUnitsRaw[basis],
      `labelBasisCounts.samplingUnits.${basis}`,
    );
  }
  return {
    records: integerTally(obj.records, "labelBasisCounts.records"),
    samplingUnits,
    ineligible: integerTally(obj.ineligible, "labelBasisCounts.ineligible"),
  };
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
    const family = generatorFamilyOf(record);
    if (family !== undefined) increment(generatorFamilies, family);
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
    labelBasisCounts: publishLabelBasis(normalized),
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
  const labelBasisCounts = parseLabelBasisPublication(root.labelBasisCounts);

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
    labelBasisCounts,
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
