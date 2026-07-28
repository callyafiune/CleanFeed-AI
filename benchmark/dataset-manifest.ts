// Corpus manifest, license inventory, human review rules and the closed
// 4k/4k/2k release sealing. Like schema.ts this module is standalone and MUST
// NOT import from the extension bundle (src/); it depends only on the closed
// benchmark record schema and on the Phase 1 canonical-json digest helper shared
// through contracts/.
//
// "Sealed" means sealDataset only produces a DatasetAudit when the observed file
// bytes match the manifest exactly, the composition equals the policy counts, the
// review rules of the record's own schema version hold, and every referenced
// license is present and approved in the inventory. The audit is self-digested
// with canonicalSha256 so any later change to a conclusion invalidates
// auditDigest. There is no coercion and no last-write-wins.
//
// THE REVIEW RULES ARE VERSION-AWARE SINCE C5, and the asymmetry is deliberate. A
// v2 record can only be asked what its `annotation` block can answer — two distinct
// reviewers, an adjudicator who is not one of them — so those two checks are
// unchanged. A v3 record carries `review`, whose coherence `validateBenchmarkRecord`
// already enforced (one decision per declared reviewer, an agreement its decisions
// support, an adjudication behind every disagreement, a PII audit naming a method
// and a real instant), so this module does not restate them. What it adds on top of
// both is the CORPUS-level question neither version can answer per record: a
// RELEASE corpus must have a review receipt on every row. `reviewOf` reads a v2
// annotation block as `automated/unreviewed` — it cannot substantiate the agreement
// it declares — so a release seal of the corpus on disk is now refused, which is the
// intended consequence of removing simulated governance rather than a regression.

import { canonicalSha256 } from "../contracts/canonical-json.ts";
import {
  GeneratorFamilyError,
  asGeneratorFamily,
  generatorFamilyOf,
  type GeneratorFamily,
} from "./generator-family.ts";
import { REBUILD_V3_POLICY } from "./rebuild-v3-policy.ts";
import {
  AUTOMATED_UNREVIEWED,
  groupAxisIdentity,
  recordEligibility,
  reviewClaimSupport,
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
 * WHETHER a positive row counts toward the held-out family's positives floor.
 *
 * Stated once, as a named function, because the refusal message PROMISES it. The
 * message has said "at least 200 eligible positives" since 31a4b8a while the
 * counter applied no eligibility filter at all, and the promise went unkept: a
 * release corpus reserving a family could clear the floor on 200 rows each
 * carrying an `unknown` grouping axis — rows that cannot be placed in a split
 * cluster or a resampling unit, so the gate certified a reservation the corpus
 * cannot support. That is §3.3's empty-unseen-generator failure arriving THROUGH
 * the gate instead of around it. Measured before the fix: 200 such rows sealed
 * with `releaseEligible: true` and `generatorFamilies[family] === 200`.
 *
 * The filter is asked of v3 rows ONLY, and that is not a loophole left for v2 to
 * slip through. On v2 `recordEligibility` is constant false for STRUCTURAL reasons
 * rather than per-record ones: a v2 `groups` block is a closed object of nine keys
 * with no `humanSeed`, `generationLane` or `harnessVersion`, so `groupAxisState`
 * reads those three as `unknown` on every v2 record that has ever been written
 * (measured: a v2 human record reports six unknown axes, since a human row also
 * omits the generator axes). Filtering unconditionally would therefore not tighten
 * the floor — it would set every v2 family's count to 0 and refuse the sealed
 * corpus on disk, which is `scientificUse: "release"` and v2. That is precisely
 * the defect this block was just repaired for, with the versions swapped.
 *
 * So the rule is the honest one: eligibility is a statement only a v3 record is
 * able to make, and it is only asked of the records that can make it. When the
 * corpus is v3 there is no v2 row to exempt, and until then a v2 corpus is judged
 * by the only criterion its schema can express — presence.
 */
function countsTowardHeldOutFloor(record: BenchmarkRecord): boolean {
  if (record.schemaVersion !== 3) return true;
  return recordEligibility(record).eligible;
}

/**
 * Positives a reserved generator family must supply before a release corpus may
 * claim it as held out. Named once so the guard and the sentence it prints cannot
 * disagree about the number — R3: it is not loosened here, only stated once.
 */
const HELD_OUT_POSITIVES_FLOOR = 200;

/**
 * The held-out floor's refusal, saying WHICH population it counted.
 *
 * The number and its denominator are not enough on their own, because the two rows
 * of a mixed-version corpus are judged by two different criteria — v3 rows by
 * `recordEligibility`, v2 rows by presence, for the structural reason
 * {@link countsTowardHeldOutFloor} spells out — and the word "eligible" is only
 * true of the first. The message said it of both: on a v2 corpus a thin family was
 * refused with "5 eligible of 5 positive rows" while `recordEligibility` reports
 * every one of those rows INELIGIBLE (a v2 human row reports six unknown axes; a v2
 * `groups` block is a closed nine-key object with no `humanSeed`, `generationLane`
 * or `harnessVersion`). Asserting eligibility for rows the same module calls
 * ineligible is the same class of over-claim the eligibility filter was added to
 * remove — surviving in the one place an operator reads.
 *
 * So the sentence names its own rule. Three cases and not two, because a
 * mixed-version array is reachable: `parseBenchmarkDataset` refuses a JSONL that
 * mixes versions, but `sealDataset` takes an array and the calibration and preflight
 * paths build theirs in memory.
 */
function heldOutFloorShortfall(
  family: string,
  counted: number,
  positiveRows: readonly BenchmarkRecord[],
): string {
  const stateEligibility = positiveRows.filter(
    (record) => record.schemaVersion === 3,
  ).length;
  const head = `held-out generator family "${family}" requires at least ${HELD_OUT_POSITIVES_FLOOR}`;
  // BOTH numbers in every case, because they answer different questions. "0 of
  // 200" tells an operator the family is stocked and the grouping axes are not
  // recovered; "0 of 0" tells them the family is absent — and "0 of 0" is what a
  // broken accessor looks like, which is the failure this block had.
  const counts = `received ${counted} of ${positiveRows.length} positive rows`;
  if (stateEligibility === positiveRows.length) {
    // Includes the empty case, where 0 of 0 asserts eligibility of nothing.
    return `${head} eligible positives, received ${counted} eligible of ${positiveRows.length} positive rows`;
  }
  if (stateEligibility === 0) {
    return `${head} positives, ${counts} (no positive row states eligibility: schemaVersion 2 has no axis states, so the floor is judged on presence)`;
  }
  return `${head} positives, ${counts} (${stateEligibility} judged by eligibility, ${positiveRows.length - stateEligibility} of schemaVersion 2 judged on presence)`;
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
  // Records whose review sustains no governance claim, with the reason each one
  // failed. Collected rather than thrown on, because "how many records support the
  // claim" is a question about the CORPUS and is decided once the loop is done.
  const unsustained: Array<{
    id: string;
    support: Exclude<ReturnType<typeof reviewClaimSupport>, { sustains: true }>;
  }> = [];

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

    // The review rules, version-aware since C5.
    //
    // v2 keeps the two checks it always had, byte for byte, because two tests pin
    // them and because they are the only questions its `annotation` block can be
    // asked. What it CANNOT do is substantiate the agreement it declares, and the
    // consequence of that is priced once, below, on the release claim — not here,
    // where it would refuse every corpus already on disk for a reason that is
    // about the whole corpus rather than about one record.
    //
    // v3 needs no equivalent loop: `validateBenchmarkRecord` above already refused
    // an incoherent receipt (a vote count that does not match the assignment, an
    // agreement over decisions that differ, a disagreement with no adjudication, an
    // adjudicator who was also a reviewer, a PII audit with no method or a
    // synthetic date). Repeating those here would be a second copy of the rules
    // able to disagree with the first.
    //
    // One v3 state is deliberately NOT a parse error and lands here instead: a
    // receipt whose conclusion contradicts the record's label declares the
    // divergence (`review.labelDispute`) and parses, because refusing the row would
    // erase the reviewers' dissent (R4). `reviewClaimSupport` prices it
    // (`label-disputed`), so it flows into `unsustained` below like any other
    // non-sustaining state and a release seal counts it against the claim.
    if (record.schemaVersion === 2) {
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
    }
    const support = reviewClaimSupport(record);
    if (!support.sustains) unsustained.push({ id: record.id, support });

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
      // BOTH comparisons go through `generatorFamilyOf`, the same accessor the
      // tally above uses, and NOT through `record.groups.generatorFamily`. The raw
      // read typechecks on the union — the v2 arm of the axis IS a
      // `GeneratorFamily` — so the compiler does not object, and it is always
      // false on a v3 record, whose axis holds `{ state, id }`. That produced two
      // failures pointing the wrong way: every held-out family counted 0
      // positives, so a complete corpus was refused for "requires at least 200
      // eligible positives", and `appearsInHuman` could never be true, so the leak
      // check was silently dead. Same defect class A4 fixed: two spellings that
      // never meet.
      const positiveRows = normalized.filter(
        (record) =>
          (record.label === "ai" || record.label === "mixed") &&
          generatorFamilyOf(record) === family,
      );
      const positives = positiveRows.filter(countsTowardHeldOutFloor).length;
      const appearsInHuman = normalized.some(
        (record) =>
          record.label === "human" && generatorFamilyOf(record) === family,
      );
      // On a v3 corpus this branch is unreachable and that is the stronger state,
      // not a reason to drop it: `AXIS_STATE_RULE` allows `generatorFamily` only
      // `notApplicable` on a human row, so `validateBenchmarkRecord` above refuses
      // the leak first, with BENCHMARK_RECORD_INVALID. It stays because v2 records
      // are what the sealed corpus on disk still is, and there the axis is a bare
      // string a human row may legally carry.
      if (appearsInHuman) {
        fail(
          "DATASET_COVERAGE_INVALID",
          `held-out generator family "${family}" must appear only in ai or mixed records`,
        );
      }
      if (positives < HELD_OUT_POSITIVES_FLOOR) {
        fail(
          "DATASET_COVERAGE_INVALID",
          heldOutFloorShortfall(family, positives, positiveRows),
        );
      }
    }

    // THE REVIEW CLAIM (C5), and the reason it is the last release check rather
    // than the first. Every refusal above names ONE record — a duplicate, an
    // incoherent receipt, a licence absent from the inventory — and those must keep
    // firing first, because they point an operator at a row to fix. This one names a
    // COUNT over the whole corpus, so it cannot be asked until the loop has ended,
    // and it is the coarsest thing that can be wrong: nobody reviewed the corpus.
    //
    // It fires on the sealed corpus on disk, which is v2 and `scientificUse:
    // "release"`, and that is the intended outcome and not a regression. Ten thousand
    // records declare `agreement: "agree"` and a passed PII audit that never
    // happened; `reviewOf` reads every one of them as `automated/unreviewed`, so the
    // release claim has nothing under it. An `automated/unreviewed` record is honest
    // and may exist in a corpus — an `infrastructure-only` seal is unaffected, which
    // is what "does not count toward a gate" means (R6, D5). What it may not do is
    // sustain a claim that a human looked.
    //
    // R3: this is not a loosened threshold anywhere. The refusal is new and there is
    // no way to satisfy it except a real review (D1/D5), which is exactly the input
    // this execution does not have.
    if (unsustained.length > 0) {
      const byReason = new Map<string, number>();
      for (const entry of unsustained) {
        byReason.set(
          entry.support.reason,
          (byReason.get(entry.support.reason) ?? 0) + 1,
        );
      }
      const breakdown = [...byReason.entries()]
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([reason, count]) => `${count} ${reason}`)
        .join(", ");
      fail(
        "DATASET_REVIEW_INVALID",
        `a release corpus requires a human review receipt on every record: ${unsustained.length} of ${normalized.length} sustain no review claim (${breakdown}), first ${unsustained[0]?.id}. A record whose only governance is the automated filter is "${AUTOMATED_UNREVIEWED}" — legitimate in the corpus, and it never counts toward a gate that requires review`,
      );
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
