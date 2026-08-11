// Corpus manifest, license inventory, human review rules and the closed
// 6k/4k/2k release sealing. Like schema.ts this module is standalone and MUST
// NOT import from the extension bundle (src/); it depends on the closed benchmark
// record schema, on the Phase 1 canonical-json digest helper shared through
// contracts/, and on the frozen pre-registration (which makes it Node-side, since
// that module reads its own JSON at load).
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
import { isHumanNegative } from "./metrics.ts";
import { PREREGISTRATION_V4 } from "./preregistration-v4.ts";
import {
  ALL_GROUP_AXES,
  AUTOMATED_UNREVIEWED,
  groupAxisIdentity,
  LABEL_DISPUTE_UNRESOLVED,
  recordEligibility,
  recordGroupAxes,
  reviewClaimSupport,
  validateBenchmarkRecord,
  type BenchmarkRecord,
  type GroupAxis,
} from "./schema.ts";

// Every axis any record version declares, in one fixed order, so a mixed-version
// array publishes every axis it actually holds instead of the axes of whichever
// version was hard-coded here. `canonicalJson` sorts keys, so this order decides
// nothing about a digest — it decides that no axis is silently dropped.
const PUBLISHED_AXES: readonly GroupAxis[] = ALL_GROUP_AXES;

export interface DatasetManifest {
  schemaVersion: 1;
  datasetId: string;
  version: string;
  scientificUse: "release" | "infrastructure-only";
  intendedLanguage: "pt-BR";
  /**
   * The FRAME the corpus draws from, and never "any pt-BR text": the claim is
   * published as a table of declared cells, so a manifest that called its domain
   * generic would name a population with no sampling frame behind it. Read from the
   * pre-registration rather than written here, so the vocabulary and the corpus
   * identity move together.
   */
  intendedDomain: typeof PREREGISTRATION_V4.dataset.intendedDomain;
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
  // 4.000 human lines is `collection.humanLinesTotal`: ONE quota cell at the per-cell
  // TARGET of 4.000, not at the 1.500 floor. `sealDataset` compares the composition
  // for EXACT equality, so the number written here is the number the corpus must hold
  // — and writing the floor instead would refuse every corpus that carries the
  // collection margin. The margin is not slack: 4.000 lines put 800 into a 20 % blind
  // block, which is the `n` the published zero-event ceiling of 0,55 % is read at,
  // while the floor's block is exactly the 300-line FPR denominator. The floor stays
  // the gate's number; this one is the collection's.
  counts: { human: 4_000, ai: 4_000, mixed: 2_000 },
  // The ONE cell of the declared frame: encyclopedic text, Wikipedia pt. Hard-negative
  // families are STYLE families, not platform families, so they are untouched by this.
  //
  // The spelling is `preRegistration.quotaAxis.cells`, which since the frame amendment
  // is the ONLY spelling — `humanCoreStrata` names the same single string. Coverage
  // here is checked over the same field the per-cell ceilings are measured on
  // (`CELL_FPR_AXIS`), and that field's vocabulary is decided by the gate that names
  // its hypothesis `fpr-<value>` against the frozen `multiplicity.primaryFamily`.
  // Requiring a second vocabulary would refuse every corpus the composition gate can
  // pass, and passing this check with it would seal a corpus in which the cell counts
  // zero lines — which is what two spellings did once already.
  //
  // Written out rather than derived from the policy, although that is what it equals:
  // a derived list cannot disagree with its source, so nothing would notice a cell
  // renamed in one place and not the other. The agreement is held by test
  // ("requires exactly the quota cells the frozen policy has a source for"), the
  // same way the NOTICE is held to the licence registry.
  requiredHumanSourceTypes: ["ptwiki"],
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
  literal(
    root.intendedDomain,
    "intendedDomain",
    PREREGISTRATION_V4.dataset.intendedDomain,
  );
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
    intendedDomain: PREREGISTRATION_V4.dataset.intendedDomain,
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
 * The filter is asked of the AXIS-STATED versions only, and that is not a loophole
 * left for v2 to slip through. On v2 `recordEligibility` is constant false for
 * STRUCTURAL reasons
 * rather than per-record ones: a v2 `groups` block is a closed object of nine keys
 * with no `humanSeed`, `generationLane` or `harnessVersion`, so `groupAxisState`
 * reads those three as `unknown` on every v2 record that has ever been written
 * (measured: a v2 human record reports six unknown axes, since a human row also
 * omits the generator axes). Filtering unconditionally would therefore not tighten
 * the floor — it would set every v2 family's count to 0 and refuse the sealed
 * corpus on disk, which is `scientificUse: "release"` and v2. That is precisely
 * the defect this block was just repaired for, with the versions swapped.
 *
 * So the rule is the honest one: eligibility is a statement only a record with axis
 * states is able to make, and it is only asked of the records that can make it. Once
 * the corpus carries states there is no v2 row to exempt, and until then a v2 corpus
 * is judged by the only criterion its schema can express — presence.
 */
function countsTowardHeldOutFloor(record: BenchmarkRecord): boolean {
  if (record.schemaVersion === 2) return true;
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
    (record) => record.schemaVersion !== 2,
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

/** One record that sustains no review claim, with the reason it does not. */
type UnsustainedReview = {
  id: string;
  support: Exclude<ReturnType<typeof reviewClaimSupport>, { sustains: true }>;
};
type ReviewShortfallReason = UnsustainedReview["support"]["reason"];

/**
 * The act that answers each reason a review claim fails, one sentence per reason.
 *
 * A `Record` over the reason union rather than one closing paragraph, because the
 * refusal used to end with the `automated-filter-only` sentence whatever the reason
 * was: a release corpus refused solely over `1 label-disputed` got a diagnosis about
 * an automated filter that had nothing to do with it, in the one place an operator
 * reads. `satisfies Record<ReviewShortfallReason, string>` makes a fifth reason a
 * compile error here, so the message cannot go stale the way the count in
 * {@link reviewClaimSupport}'s docstring did.
 *
 * Each value ENDS WITH A PERIOD, and that is load-bearing rather than editorial:
 * {@link reviewClaimShortfall} concatenates the acts of every reason present, so
 * without a terminator two acts fused into one run-on sentence ("...a gate that
 * requires review A record whose blind reviewers...") in the sole operator-facing
 * diagnosis of this gate. The period lives here rather than in the join so that
 * every value is a whole sentence wherever it is read.
 *
 * `as const` matches the four sibling tables of this shape (`schema.ts`'s
 * `V3_AXIS_STATE_RULE`, `source-manifest.ts`'s obligation and regime tables): the
 * values type as their literals and the module-level table is not writable, which a
 * bare `satisfies` left open. The exhaustiveness above is unaffected.
 */
const REVIEW_SHORTFALL_ACTION = {
  "automated-filter-only": `A record whose only governance is the automated filter is "${AUTOMATED_UNREVIEWED}" — legitimate in the corpus, and it never counts toward a gate that requires review.`,
  "reviewer-saw-detector-score":
    "A reviewer or adjudicator who saw the detector's score may have corroborated the score instead of the document: the receipt stands as the truth of what happened, and the review is re-run blind (D1).",
  "reviewer-saw-candidate-class":
    "A reviewer or adjudicator who saw the candidate class was shown the answer before deciding: the receipt stands, and the review is re-run blind (D1).",
  "label-disputed": `A record whose blind reviewers contradict its label keeps the dissent ("${LABEL_DISPUTE_UNRESOLVED}") and sustains no claim: nothing in a record resolves it, so resolving means re-deriving the label's own evidence or withdrawing the row (D1/D5).`,
} as const satisfies Record<ReviewShortfallReason, string>;

/**
 * The review claim's refusal: the count, the breakdown by reason, the first record,
 * and the act that answers each reason PRESENT — never the acts of reasons absent.
 *
 * Both halves of that promise are pinned by test, and the "each" half only became so
 * in this round: `reasons.slice(0, 1).map(...)` type-checked and left the whole
 * benchmark suite green, because every assertion on this message covered a corpus
 * with exactly ONE distinct reason. `names the act of every reason present, in the
 * breakdown's order` is the two-reason corpus that kills it and pins the sort.
 *
 * The parameter is a NON-EMPTY tuple, so the caller's `length > 0` guard is the type
 * rather than a convention in another scope. Before that it was `readonly
 * UnsustainedReview[]` read through `unsustained[0]?.id`, which rendered the literal
 * `undefined` as a record id — a refusal naming nothing, with an empty breakdown and
 * no act, thrown at an operator whose corpus is fine. Same fail-loudly rule A3's
 * round put on `item()`: refuse the impossible input at the boundary.
 */
function reviewClaimShortfall(
  unsustained: readonly [UnsustainedReview, ...UnsustainedReview[]],
  total: number,
): string {
  const byReason = new Map<ReviewShortfallReason, number>();
  for (const entry of unsustained) {
    byReason.set(
      entry.support.reason,
      (byReason.get(entry.support.reason) ?? 0) + 1,
    );
  }
  const reasons = [...byReason.keys()].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const breakdown = reasons
    .map((reason) => `${byReason.get(reason)} ${reason}`)
    .join(", ");
  const actions = reasons
    .map((reason) => REVIEW_SHORTFALL_ACTION[reason])
    .join(" ");
  return `a release corpus requires a human review receipt on every record: ${unsustained.length} of ${total} sustain no review claim (${breakdown}), first ${unsustained[0].id}. ${actions}`;
}

/**
 * One human row that no declared quota cell covers, with the cell it declared.
 *
 * `spelling: undefined` is a row that declares no cell at all; a string is a cell
 * the declared frame does not name. The two are separate POPULATIONS and not one
 * "bad row" count, because the act that answers them differs: the first is a row
 * missing a value, the second is a frame missing a cell.
 */
type OutOfFrameHumanRow = { id: string; spelling: string | undefined };

/** The breakdown's key for the rows that declare no cell at all. */
const NO_CELL_DECLARED = "(none declared)";

/**
 * How many distinct spellings the refusal names before it counts the rest.
 *
 * A bound is required rather than tidy: the offending spellings are an OPEN set —
 * `humanSourceType` is free string in every schema version, so 4.000 human rows can
 * carry 4.000 distinct values — unlike the four closed reasons of
 * {@link REVIEW_SHORTFALL_ACTION}. Named once so the guard and the "+k more"
 * suffix cannot disagree about the number.
 */
const OUT_OF_FRAME_SPELLING_LIMIT = 5;

/**
 * The act that answers each way a human row falls outside the frame, one sentence
 * per population, each ENDING WITH A PERIOD because
 * {@link cellMembershipShortfall} concatenates the acts of the populations PRESENT
 * and two acts without a terminator read as one run-on sentence.
 *
 * Only the populations present are printed: a corpus whose rows merely omit the
 * field must not be told to amend its frame, which names no cell those rows could
 * be moved to.
 */
const OUT_OF_FRAME_ACTION = {
  absent:
    "A human row that declares no quota cell belongs to no published cell, so it either receives the cell of the material it was drawn from or leaves the release.",
  spelled:
    "A human row whose declared cell is outside the frame is covered by no published ceiling, so either the frame is amended to declare that cell or the row leaves the release.",
} as const;

/**
 * The membership refusal: how many human rows of how many, the breakdown by
 * observed spelling, the first row's id, the declared cells, and the act of each
 * population present.
 *
 * The id is the parsed `id`, which `pseudonym` has already established as an opaque
 * token, and the spellings are cell vocabulary. Nothing else of a row may enter this
 * sentence — it is written to a command's error output.
 */
function cellMembershipShortfall(
  offenders: readonly [OutOfFrameHumanRow, ...OutOfFrameHumanRow[]],
  humanLines: number,
  declaredCells: readonly string[],
): string {
  let absent = 0;
  const bySpelling = new Map<string, number>();
  for (const offender of offenders) {
    if (offender.spelling === undefined) {
      absent += 1;
      continue;
    }
    bySpelling.set(
      offender.spelling,
      (bySpelling.get(offender.spelling) ?? 0) + 1,
    );
  }
  // The rows that declare nothing come first and the declared spellings follow in
  // one fixed order, so the sentence does not depend on row order.
  const entries = [
    ...(absent > 0 ? [`${absent} ${NO_CELL_DECLARED}`] : []),
    ...[...bySpelling.keys()]
      .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
      .map((spelling) => `${bySpelling.get(spelling)} ${spelling}`),
  ];
  const shown = entries.slice(0, OUT_OF_FRAME_SPELLING_LIMIT);
  const omitted = entries.length - shown.length;
  const breakdown =
    omitted > 0
      ? `${shown.join(", ")}, +${omitted} more spellings`
      : shown.join(", ");
  const actions = [
    ...(absent > 0 ? [OUT_OF_FRAME_ACTION.absent] : []),
    ...(bySpelling.size > 0 ? [OUT_OF_FRAME_ACTION.spelled] : []),
  ].join(" ");
  return `a release corpus requires every human row to declare one of its quota cells: ${offenders.length} of ${humanLines} human rows declare none (${breakdown}), first ${offenders[0].id}; declared cells: ${declaredCells.join(", ")}. ${actions}`;
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
  const bases = PREREGISTRATION_V4.labelBasis.allowed;
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
    if (record.schemaVersion === 2) continue;
    const basis = record.labelBasis;
    if (basis === undefined) continue;
    publication.records[basis] = (publication.records[basis] ?? 0) + 1;
    if (!recordEligibility(record).eligible) {
      publication.ineligible[basis] = (publication.ineligible[basis] ?? 0) + 1;
    }
    const perAxis = identities.get(basis);
    if (perAxis === undefined) continue;
    for (const axis of recordGroupAxes(record)) {
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
    // A fixed axis order, not insertion order, so the published block is stable
    // across corpora and does not depend on row order.
    for (const axis of PUBLISHED_AXES) {
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
  const unsustained: UnsustainedReview[] = [];
  // The quota-cell tally of the HUMAN class, and the human rows no declared cell
  // covers. Private to the seal: `sourceTypes` above is the PUBLISHED table and
  // counts every record that carries the field, which is a different population —
  // the schema lets a generated row carry a `humanSourceType`, and one such row
  // makes a cell with zero human rows look covered.
  const humanCells: Record<string, number> = {};
  const outOfFrameHumanRows: OutOfFrameHumanRow[] = [];
  // The denominator of the membership refusal, counted over the same predicate the
  // guard judges rather than read off `counts.human`, so the sentence cannot report
  // a fraction of a population it did not measure.
  let humanLines = 0;

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
    // non-sustaining state and a release seal counts it against the claim. Asserted
    // rather than reasoned: "refuses a release corpus over one disputed row" seals a
    // 201-row v3 release corpus with exactly one disputed row and reads the count,
    // the reason and the act off the refusal.
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
    // The PUBLISHED table, over every record that carries the field whatever its
    // label. The `!== undefined` protection decides which keys exist, and the keys
    // are inside `auditDigest`: a row that declares no cell mints no key here, so a
    // default value would rename absence into a cell every reader of the audit
    // would count.
    if (record.humanSourceType !== undefined) {
      increment(sourceTypes, record.humanSourceType);
    }
    // The membership of the human class in the declared frame, collected for every
    // record of every schema version and priced only on a release corpus below.
    // `isHumanNegative` is imported and not re-spelled as `label === "human"`: the
    // composition gate that counts the per-cell denominators reads its rows through
    // the same predicate, and a second spelling here could disagree with it.
    if (isHumanNegative(record)) {
      humanLines += 1;
      const cell = record.humanSourceType;
      if (cell !== undefined) increment(humanCells, cell);
      if (
        cell === undefined ||
        !policy.requiredHumanSourceTypes.includes(cell)
      ) {
        outOfFrameHumanRows.push({ id: record.id, spelling: cell });
      }
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
    // THE FRAME IS A PARTITION OF THE HUMAN CLASS, and these two guards are its two
    // halves. The release claim is published as a table with one row per declared
    // cell, and the denominator of each row is that cell — so a human row that
    // declares no cell of the frame is described by no row of the table, and every
    // ceiling the table publishes is silent about it.
    //
    // Membership first and presence second, because the order is cause before
    // consequence: rows that declare no cell are why a cell can hold none.
    //
    // What this does NOT reach: the row is still ACCEPTED by every schema version,
    // which keeps `humanSourceType` free string and optional — the frame is a
    // property of a corpus policy, not of a record. So an `infrastructure-only`
    // corpus still seals with such rows, and downstream the split audit, the slices
    // and the composition gate still drop them without a word. A release corpus is
    // out of that silence only because `runSplit` admits a corpus on
    // `dataset-audit.json`, which is this function's output, and that is the whole
    // of the claim.
    const [firstOutOfFrame, ...restOutOfFrame] = outOfFrameHumanRows;
    if (firstOutOfFrame !== undefined) {
      fail(
        "DATASET_COVERAGE_INVALID",
        cellMembershipShortfall(
          [firstOutOfFrame, ...restOutOfFrame],
          humanLines,
          policy.requiredHumanSourceTypes,
        ),
      );
    }
    // The vocabulary is the POLICY's, never `PREREGISTRATION_V4`'s cell list: an
    // `infrastructure-only` corpus is legitimately sealed against another
    // composition, and the agreement between the frozen frame and the release policy
    // is held by test in benchmark/tests/preregistration-v4.test.ts.
    for (const sourceType of policy.requiredHumanSourceTypes) {
      if ((humanCells[sourceType] ?? 0) === 0) {
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
      // NO current path reaches this branch, in either version, and that is the
      // stronger state rather than a reason to drop it. `validateBenchmarkRecord`
      // above refuses the leak first with BENCHMARK_RECORD_INVALID: on v3 because
      // `AXIS_STATE_RULE` allows `generatorFamily` only `notApplicable` on a human
      // row, and on v2 because a family with no `generation` behind it is refused
      // outright (A4-fix imposed that coherence in both directions — the one-way rule
      // let a human row carry a family, and this guard runs only for a `release`
      // corpus, so a non-release corpus accepted the row and counted it in the
      // `generatorExposure` denominator).
      //
      // It stays because the two refusals are about the RECORD and this one is about
      // the CORPUS: it is the only place that knows which families were reserved, so
      // it is the line that would still speak if the record-level coherence were
      // narrowed, or if a caller ever assembled a record array past the validator.
      // What it may not claim any more is that it is v2's last line — it is nobody's
      // first line today.
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
    //
    // Destructured rather than tested with `length > 0`, because TypeScript does not
    // narrow an array to a non-empty tuple from its length: this is what lets
    // `reviewClaimShortfall` DEMAND a first element instead of rendering `undefined`
    // into a refusal if this guard is ever moved or lost.
    const [firstUnsustained, ...restUnsustained] = unsustained;
    if (firstUnsustained !== undefined) {
      fail(
        "DATASET_REVIEW_INVALID",
        reviewClaimShortfall(
          [firstUnsustained, ...restUnsustained],
          normalized.length,
        ),
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
