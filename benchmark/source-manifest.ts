// Closed reviewed-source manifest (v1) for the PT-BR/LinkedIn corpus. Like
// schema.ts and dataset-manifest.ts this module is standalone and MUST NOT
// import from the extension bundle (src/); it depends only on the Phase 1
// canonical-json digest helper shared through contracts/.
//
// The manifest binds the private governance file (`private/source-manifest.json`)
// that never enters Git: it names — only by opaque, pseudonymised tokens and
// digests — every authorized source and every controlled-generation batch. It
// carries NO source URL, name, handle or raw consent receipt; a consent source
// binds its receipt solely through a `consentReceiptDigest`.
//
// "Closed" means every object is validated against an exact key set: any unknown
// field (in particular a smuggled `sourceUrl`, `authorName`, `handle` or raw
// `consentReceipt`), a licensed source without a `licenseId`, a consent source
// without a `consentReceiptDigest`, an incomplete generation recipe, non-distinct
// legal reviewers, a seed that is neither present nor explicitly waived, or a
// `sourceManifestDigest` that no longer matches the recomputed self-digest is a
// hard failure. There is no coercion and no last-write-wins.
//
// `sourceManifestDigest` is the canonical self-digest of the manifest body (its
// own digest field excluded), NOT the raw file SHA. The raw SHA lives on
// DatasetManifest/DatasetAudit; the two are bridged by `fit`.
//
// The module also carries the licence policy of the corpus: the registry of
// exact licence identifiers with their clauses (`CORPUS_LICENSE_REGISTRY`), the
// obligations they impose and the two guards that answer "is this source
// admissible, under which licence, with which obligations"
// (`sourceAdmissibility`, `assertLicenseInventoryAdmissible`). `NC` is
// admissible because the product and the model are non-commercial; `ND` is
// blocked because assembling a corpus is the derivative it restricts.
//
// WHO OWNS WHICH VALUE (this module is not the authority for all of it):
//   * `benchmark/rebuild-v3-policy.json`, validated by
//     `benchmark/rebuild-v3-policy.ts` and inside `EVALUATOR_FILES`, is the
//     authority for the frozen decisions themselves — `commercialUse: false`,
//     `attributionRequired`, `shareAlikeRequired`. The plan's frozen contract
//     says code may not repeat them as loose constants, so this module READS
//     them (`CORPUS_USE_POLICY.commercialUse`, `FROZEN_ARTIFACT_OBLIGATIONS`)
//     and never writes them down a second time.
//   * This module is the authority for the licence registry, the per-source
//     admissibility verdict and the obligations each licence imposes.
//   * `models/cleanfeed-ptbr-v1/license-review.json` and `NOTICE.md` PUBLISH the
//     result; `docs/corpus-sources.md` documents it.
// Each link is enforced by a named test in
// `benchmark/tests/source-manifest.test.ts`; see `CORPUS_USE_POLICY`.
//
// Reading the frozen policy makes this module Node-side (the policy module does
// one `readFileSync` at load). That is not a new constraint on its consumers —
// it is imported only by benchmark modules and by `scripts/` — but it does mean
// it must still never be imported from the extension bundle (src/).

import { canonicalSha256 } from "../contracts/canonical-json.ts";
import { REBUILD_V3_POLICY } from "./rebuild-v3-policy.ts";

export type ReviewedSourceEntryV1 =
  | {
      sourceId: string;
      sourceType: "linkedin-contribution";
      acquisition: "consent";
      evaluationUseApproved: true;
      licenseId: null;
      consentReceiptDigest: string;
      collectionProtocolVersion: "collection-v1";
      legalReviewerIds: [string, string];
    }
  | {
      sourceId: string;
      sourceType: "licensed-corpus";
      acquisition: "licensed";
      evaluationUseApproved: true;
      licenseId: string;
      consentReceiptDigest: null;
      collectionProtocolVersion: "collection-v1";
      legalReviewerIds: [string, string];
    }
  | {
      sourceId: string;
      sourceType: "controlled-generation";
      acquisition: "generated";
      evaluationUseApproved: true;
      licenseId: string;
      consentReceiptDigest: null;
      collectionProtocolVersion: "collection-v1";
      legalReviewerIds: [string, string];
    };

export interface GenerationBatchV1 {
  batchId: string;
  sourceId: string;
  generationProtocolVersion: "generation-v1";
  provider: string;
  family: string;
  model: string;
  version: string;
  promptTemplateDigest: string;
  temperature: number;
  generatedAt: number;
  seed: string | null;
  seedNullReason: string | null;
}

export interface ReviewedSourceManifestV1 {
  schemaVersion: 1;
  sources: ReviewedSourceEntryV1[];
  generationBatches: GenerationBatchV1[];
  sourceManifestDigest: string;
}

export type ReviewedSourceManifestBody = Omit<
  ReviewedSourceManifestV1,
  "sourceManifestDigest"
>;

/** Coded, fail-closed error thrown by the reviewed-source manifest parser. */
export class ReviewedSourceManifestError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "ReviewedSourceManifestError";
    this.code = code;
  }
}

function fail(code: string, message: string): never {
  throw new ReviewedSourceManifestError(code, message);
}

// ---------------------------------------------------------------------------
// Licence policy: which source is admissible, under which licence, with which
// obligations. This is the surface the corpus inventory, the model licence
// review and the NOTICE all answer to.
// ---------------------------------------------------------------------------

/**
 * The use declaration of the product and of the model: NOT commercial. There is
 * no commercial variant to preserve, so this is a constant and not a setting —
 * no flag, no override, no branch kept open.
 *
 * `commercialUse` is NOT decided here. It is the frozen-table row materialized
 * in `benchmark/rebuild-v3-policy.json` and validated by
 * `benchmark/rebuild-v3-policy.ts`, and it is read from there so the decision
 * exists in exactly one place. `policyId` and `redistribution` are local: they
 * are not rows of the frozen table, they name THIS module's regime.
 *
 * Which test enforces which link:
 *   * frozen file -> this constant: "reads the frozen non-commercial decision
 *     from the policy file, not a copy of it" (and "derives the frozen flag in
 *     its source instead of restating it", which fails if the literal comes
 *     back, because no runtime assertion can tell a copy that agrees from a
 *     derivation).
 *   * frozen obligations -> the registry: "imposes every obligation the frozen
 *     contract requires".
 *   * this module -> `license-review.json`: "the model licence review declares
 *     the same frozen use policy" and "…carries the registry's terms verbatim".
 *   * this module -> `NOTICE.md`: "the NOTICE states the non-commercial regime
 *     and its obligations" and "…lists every registered licence with exactly
 *     its obligations".
 *   * this module -> `docs/corpus-sources.md`: "the source inventory doc records
 *     every exact licence identifier".
 */
export const CORPUS_USE_POLICY = {
  policyId: "noncommercial-v1",
  commercialUse: REBUILD_V3_POLICY.commercialUse,
  redistribution: "not-published",
} as const;

/**
 * The use a caller declares. Only `commercialUse` can change a verdict: the
 * `NC` clause is about use, not about the corpus.
 */
export interface DeclaredCorpusUse {
  commercialUse: boolean;
}

/** An obligation a licence imposes on the derived artifact. */
export type LicenseObligation =
  "attribution" | "non-commercial" | "share-alike";

/** Canonical order for every obligation list this module returns. */
const OBLIGATION_ORDER: readonly LicenseObligation[] = [
  "attribution",
  "non-commercial",
  "share-alike",
];

/**
 * The obligations the frozen contract requires the artifact to carry, DERIVED
 * from `benchmark/rebuild-v3-policy.json` instead of listed here: the row "uso e
 * licença" is `commercialUse: false` plus `attributionRequired` plus
 * `shareAlikeRequired`.
 *
 * It is not the same statement as `artifactLicenseObligations(...)`, which
 * answers what a given set of licences happens to impose. This one is the floor:
 * a registry edit that dropped `shareAlike` from `cc-by-nc-sa-4.0` would lower
 * what the licences impose while the frozen requirement stayed, which is the
 * divergence the test "imposes every obligation the frozen contract requires"
 * exists to catch. C1/C5 should read this constant, not restate the flags.
 */
export const FROZEN_ARTIFACT_OBLIGATIONS: readonly LicenseObligation[] =
  OBLIGATION_ORDER.filter((obligation) => {
    switch (obligation) {
      case "attribution":
        return REBUILD_V3_POLICY.attributionRequired;
      case "non-commercial":
        return !REBUILD_V3_POLICY.commercialUse;
      case "share-alike":
        return REBUILD_V3_POLICY.shareAlikeRequired;
    }
  });

/**
 * The exact Portuguese words the NOTICE uses for each obligation. They live
 * here so the NOTICE is checked against this module instead of being trusted:
 * the agreement test reads the licence line out of `NOTICE.md` and requires it
 * to state exactly the obligations the registry gives that licence.
 */
export const LICENSE_OBLIGATION_LABEL_PT = {
  attribution: "atribuição",
  "non-commercial": "não comercial",
  "share-alike": "share-alike",
} as const satisfies Record<LicenseObligation, string>;

/** A registered licence: its clauses plus what they imply for a derived corpus. */
export interface CorpusLicenseTermsV1 {
  /** The exact official identifier. Never "CC BY", "aberta" or "permissiva". */
  licenseId: string;
  name: string;
  source: string;
  attribution: boolean;
  nonCommercial: boolean;
  shareAlike: boolean;
  noDerivatives: boolean;
  derivedCorpus: "admissible" | "blocked";
  blockedBy: null | "no-derivatives";
}

type LicenseClauses = Omit<CorpusLicenseTermsV1, "derivedCorpus" | "blockedBy">;

// Every licence identifier the corpus inventory (docs/corpus-sources.md) has
// reviewed, with the clauses of the licence itself. Nothing here is a new
// review: each identifier is one already recorded in the repository, and the
// clauses are the licence's own. A source whose identifier is absent is NOT
// silently admitted — `sourceAdmissibility` reports `license-not-registered`.
const REGISTERED_LICENSES: readonly LicenseClauses[] = [
  {
    licenseId: "cc-by-sa-4.0",
    name: "Creative Commons Attribution-ShareAlike 4.0",
    source: "https://creativecommons.org/licenses/by-sa/4.0/",
    attribution: true,
    nonCommercial: false,
    shareAlike: true,
    noDerivatives: false,
  },
  {
    licenseId: "cc-by-nc-sa-4.0",
    name: "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
    source: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    attribution: true,
    nonCommercial: true,
    shareAlike: true,
    noDerivatives: false,
  },
  {
    licenseId: "cc-by-nc-nd-4.0",
    name: "Creative Commons Attribution-NonCommercial-NoDerivatives 4.0",
    source: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
    attribution: true,
    nonCommercial: true,
    shareAlike: false,
    noDerivatives: true,
  },
  {
    licenseId: "odc-by-1.0",
    name: "Open Data Commons Attribution License 1.0",
    source: "https://opendatacommons.org/licenses/by/1-0/",
    attribution: true,
    nonCommercial: false,
    shareAlike: false,
    noDerivatives: false,
  },
  {
    licenseId: "lei9610-art8",
    name: "Atos oficiais — Lei 9.610/98, art. 8º, I",
    source: "https://www.planalto.gov.br/ccivil_03/leis/l9610.htm",
    attribution: false,
    nonCommercial: false,
    shareAlike: false,
    noDerivatives: false,
  },
  {
    licenseId: "autorizacao-interna-v1",
    name: "Autorização interna escrita (conteúdo corporativo próprio)",
    source: "registro interno da autorização",
    attribution: false,
    nonCommercial: false,
    shareAlike: false,
    noDerivatives: false,
  },
  {
    licenseId: "autoria-propria-v1",
    name: "Autoria própria do operador",
    source: "declaração do operador",
    attribution: false,
    nonCommercial: false,
    shareAlike: false,
    noDerivatives: false,
  },
];

// `ND` is the ONLY clause that blocks a derived corpus, and assembling a corpus
// is exactly the derivative that `ND` restricts. `NC` blocks nothing here: the
// frozen policy satisfies it. The two restrictions never collapse into one
// "restrictive licence" notion, which is why the block reason is derived from
// `noDerivatives` alone and is named `no-derivatives`.
function withDerivedCorpusVerdict(
  clauses: LicenseClauses,
): CorpusLicenseTermsV1 {
  return {
    ...clauses,
    derivedCorpus: clauses.noDerivatives ? "blocked" : "admissible",
    blockedBy: clauses.noDerivatives ? "no-derivatives" : null,
  };
}

/** Every reviewed licence identifier with its terms and derived-corpus verdict. */
export const CORPUS_LICENSE_REGISTRY: readonly CorpusLicenseTermsV1[] =
  REGISTERED_LICENSES.map(withDerivedCorpusVerdict);

/** The registered terms of `licenseId`, or `null` when it is not registered. */
export function corpusLicenseTerms(
  licenseId: string,
): CorpusLicenseTermsV1 | null {
  return (
    CORPUS_LICENSE_REGISTRY.find((terms) => terms.licenseId === licenseId) ??
    null
  );
}

/** Why a source is not admissible. Each reason is a distinct diagnosis. */
export type LicenseBlockReason =
  "no-derivatives" | "commercial-use" | "license-not-registered";

export type SourceAdmissibility =
  | {
      admissible: true;
      licenseId: string;
      terms: CorpusLicenseTermsV1;
      obligations: readonly LicenseObligation[];
      blockedBy: null;
    }
  | {
      admissible: false;
      licenseId: string;
      terms: CorpusLicenseTermsV1 | null;
      obligations: readonly LicenseObligation[];
      blockedBy: LicenseBlockReason;
    };

function obligationsOf(
  terms: CorpusLicenseTermsV1,
): readonly LicenseObligation[] {
  const obligations: LicenseObligation[] = [];
  if (terms.attribution) obligations.push("attribution");
  if (terms.nonCommercial) obligations.push("non-commercial");
  if (terms.shareAlike) obligations.push("share-alike");
  return obligations;
}

/**
 * Is a source under `licenseId` admissible for a derived corpus under `use`,
 * and with which obligations? Defaults to the frozen non-commercial policy.
 *
 * `no-derivatives` is reported BEFORE `commercial-use` on purpose: an `ND`
 * licence blocks the corpus whatever the declared use, so naming `NC` there
 * would name a reason that satisfying it could not remove.
 */
export function sourceAdmissibility(
  licenseId: string,
  use: DeclaredCorpusUse = CORPUS_USE_POLICY,
): SourceAdmissibility {
  const terms = corpusLicenseTerms(licenseId);
  if (terms === null) {
    return {
      admissible: false,
      licenseId,
      terms: null,
      obligations: [],
      blockedBy: "license-not-registered",
    };
  }
  const obligations = obligationsOf(terms);
  if (terms.noDerivatives) {
    return {
      admissible: false,
      licenseId,
      terms,
      obligations,
      blockedBy: "no-derivatives",
    };
  }
  if (terms.nonCommercial && use.commercialUse) {
    return {
      admissible: false,
      licenseId,
      terms,
      obligations,
      blockedBy: "commercial-use",
    };
  }
  return { admissible: true, licenseId, terms, obligations, blockedBy: null };
}

/**
 * The obligations the artifact inherits from a set of licence identifiers, in
 * canonical order. Obligations do not depend on the declared use, so this
 * function does not take one; it fails closed on an unregistered identifier,
 * because a licence whose clauses are unknown cannot be said to impose none.
 */
export function artifactLicenseObligations(
  licenseIds: readonly string[],
): readonly LicenseObligation[] {
  const union = new Set<LicenseObligation>();
  for (const licenseId of licenseIds) {
    const terms = corpusLicenseTerms(licenseId);
    if (terms === null) {
      fail(
        "SOURCE_LICENSE_NOT_ADMISSIBLE",
        `licence "${licenseId}" is not admissible: license-not-registered`,
      );
    }
    for (const obligation of obligationsOf(terms)) union.add(obligation);
  }
  return OBLIGATION_ORDER.filter((obligation) => union.has(obligation));
}

/**
 * Refuses an inventory that contradicts `use`, and returns the obligations the
 * artifact must carry. A `commercialUse: true` declaration over an `NC` source
 * (Carolina) is a contradiction this throws on — not an inconsistency it
 * records. Sources with a `null` licenceId are consent sources: their basis is
 * a receipt digest, not a licence, so they impose no licence obligation.
 */
export function assertLicenseInventoryAdmissible(
  sources: readonly { sourceId: string; licenseId: string | null }[],
  use: DeclaredCorpusUse = CORPUS_USE_POLICY,
): readonly LicenseObligation[] {
  const union = new Set<LicenseObligation>();
  for (const source of sources) {
    if (source.licenseId === null) continue;
    const verdict = sourceAdmissibility(source.licenseId, use);
    if (!verdict.admissible) {
      fail(
        "SOURCE_LICENSE_NOT_ADMISSIBLE",
        `source ${source.sourceId} licence "${source.licenseId}" is not admissible under commercialUse=${String(use.commercialUse)}: ${verdict.blockedBy}`,
      );
    }
    for (const obligation of verdict.obligations) union.add(obligation);
  }
  return OBLIGATION_ORDER.filter((obligation) => union.has(obligation));
}

// The part of the licence policy the closed v1 parser itself enforces: a
// REGISTERED licence whose terms contradict the frozen policy is refused, so an
// `ND` source can never enter a parsed manifest. An UNREGISTERED identifier is
// tolerated here, deliberately: v1 predates this registry and its fixtures and
// the private manifest still carry opaque ids. Requiring registration of every
// identifier is a schema decision (v3), not this task's; callers that need the
// full guard call `assertLicenseInventoryAdmissible`, which fails closed on an
// unregistered id too.
function assertRegisteredLicensesAdmissible(
  sources: readonly ReviewedSourceEntryV1[],
): void {
  for (const source of sources) {
    if (source.licenseId === null) continue;
    if (corpusLicenseTerms(source.licenseId) === null) continue;
    assertLicenseInventoryAdmissible([
      { sourceId: source.sourceId, licenseId: source.licenseId },
    ]);
  }
}

const SHA256_PATTERN = /^[a-f0-9]{64}$/u;
// Pseudonymised identity/group tokens are opaque: no whitespace and no PII
// separators such as "@" or ".", so raw names, handles and addresses are
// rejected and grouping stays privacy preserving.
const PSEUDONYM = /^[A-Za-z0-9_-]+$/u;

const MANIFEST_KEYS = [
  "schemaVersion",
  "sources",
  "generationBatches",
  "sourceManifestDigest",
] as const;
const ENTRY_KEYS = [
  "sourceId",
  "sourceType",
  "acquisition",
  "evaluationUseApproved",
  "licenseId",
  "consentReceiptDigest",
  "collectionProtocolVersion",
  "legalReviewerIds",
] as const;
const BATCH_KEYS = [
  "batchId",
  "sourceId",
  "generationProtocolVersion",
  "provider",
  "family",
  "model",
  "version",
  "promptTemplateDigest",
  "temperature",
  "generatedAt",
  "seed",
  "seedNullReason",
] as const;

const ACQUISITION_BY_TYPE: Record<
  string,
  ReviewedSourceEntryV1["acquisition"]
> = {
  "linkedin-contribution": "consent",
  "licensed-corpus": "licensed",
  "controlled-generation": "generated",
};

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
    fail("SOURCE_MANIFEST_SCHEMA_INVALID", `${label} must be an object`);
  }
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) {
    if (!allowedSet.has(key)) {
      fail(
        "SOURCE_MANIFEST_SCHEMA_INVALID",
        `unknown key "${key}" in ${label}`,
      );
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(value, key)) {
      fail(
        "SOURCE_MANIFEST_SCHEMA_INVALID",
        `${label} is missing key "${key}"`,
      );
    }
  }
  return value;
}

function pseudonym(value: unknown, name: string): string {
  if (typeof value !== "string" || !PSEUDONYM.test(value)) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `${name} must be a pseudonymised token matching [A-Za-z0-9_-], never raw PII`,
    );
  }
  return value;
}

function nonEmptyString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    fail("SOURCE_MANIFEST_FIELD_INVALID", `${name} must be a non-empty string`);
  }
  return value;
}

function lowercaseSha256(value: unknown, name: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `${name} must be a lowercase 64-character sha256 hex digest`,
    );
  }
  return value;
}

function finiteNumber(value: unknown, name: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    fail("SOURCE_MANIFEST_FIELD_INVALID", `${name} must be a finite number`);
  }
  return value;
}

function legalReviewers(value: unknown, sourceId: string): [string, string] {
  if (!Array.isArray(value) || value.length !== 2) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `source ${sourceId} legalReviewerIds must list exactly two reviewers`,
    );
  }
  const first = pseudonym(value[0], `source ${sourceId} legalReviewerIds[0]`);
  const second = pseudonym(value[1], `source ${sourceId} legalReviewerIds[1]`);
  if (first === second) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `source ${sourceId} legalReviewerIds must be two distinct reviewers`,
    );
  }
  return [first, second];
}

function validateEntry(value: unknown, index: number): ReviewedSourceEntryV1 {
  const obj = assertExactObject(
    value,
    `sources[${index}]`,
    ENTRY_KEYS,
    ENTRY_KEYS,
  );
  const sourceId = pseudonym(obj.sourceId, `sources[${index}].sourceId`);

  const sourceType = obj.sourceType;
  if (
    sourceType !== "linkedin-contribution" &&
    sourceType !== "licensed-corpus" &&
    sourceType !== "controlled-generation"
  ) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `source ${sourceId} has an unknown sourceType`,
    );
  }
  if (obj.acquisition !== ACQUISITION_BY_TYPE[sourceType]) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `source ${sourceId} acquisition must be "${ACQUISITION_BY_TYPE[sourceType]}" for sourceType "${sourceType}"`,
    );
  }
  if (obj.evaluationUseApproved !== true) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `source ${sourceId} evaluationUseApproved must be true`,
    );
  }
  if (obj.collectionProtocolVersion !== "collection-v1") {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `source ${sourceId} collectionProtocolVersion must equal "collection-v1"`,
    );
  }
  const legalReviewerIds = legalReviewers(obj.legalReviewerIds, sourceId);

  if (sourceType === "linkedin-contribution") {
    if (obj.licenseId !== null) {
      fail(
        "SOURCE_MANIFEST_FIELD_INVALID",
        `consent source ${sourceId} must have a null licenseId`,
      );
    }
    const consentReceiptDigest = lowercaseSha256(
      obj.consentReceiptDigest,
      `consent source ${sourceId} consentReceiptDigest`,
    );
    return {
      sourceId,
      sourceType: "linkedin-contribution",
      acquisition: "consent",
      evaluationUseApproved: true,
      licenseId: null,
      consentReceiptDigest,
      collectionProtocolVersion: "collection-v1",
      legalReviewerIds,
    };
  }

  if (obj.consentReceiptDigest !== null) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `source ${sourceId} must have a null consentReceiptDigest`,
    );
  }
  const licenseId = nonEmptyString(
    obj.licenseId,
    `source ${sourceId} licenseId`,
  );
  if (sourceType === "licensed-corpus") {
    return {
      sourceId,
      sourceType: "licensed-corpus",
      acquisition: "licensed",
      evaluationUseApproved: true,
      licenseId,
      consentReceiptDigest: null,
      collectionProtocolVersion: "collection-v1",
      legalReviewerIds,
    };
  }
  return {
    sourceId,
    sourceType: "controlled-generation",
    acquisition: "generated",
    evaluationUseApproved: true,
    licenseId,
    consentReceiptDigest: null,
    collectionProtocolVersion: "collection-v1",
    legalReviewerIds,
  };
}

function validateBatch(value: unknown, index: number): GenerationBatchV1 {
  const obj = assertExactObject(
    value,
    `generationBatches[${index}]`,
    BATCH_KEYS,
    BATCH_KEYS,
  );
  const batchId = pseudonym(obj.batchId, `generationBatches[${index}].batchId`);
  const sourceId = pseudonym(
    obj.sourceId,
    `generationBatches[${index}].sourceId`,
  );
  if (obj.generationProtocolVersion !== "generation-v1") {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `batch ${batchId} generationProtocolVersion must equal "generation-v1"`,
    );
  }
  const provider = nonEmptyString(obj.provider, `batch ${batchId} provider`);
  const family = nonEmptyString(obj.family, `batch ${batchId} family`);
  const model = nonEmptyString(obj.model, `batch ${batchId} model`);
  const version = nonEmptyString(obj.version, `batch ${batchId} version`);
  const promptTemplateDigest = lowercaseSha256(
    obj.promptTemplateDigest,
    `batch ${batchId} promptTemplateDigest`,
  );
  const temperature = finiteNumber(
    obj.temperature,
    `batch ${batchId} temperature`,
  );
  const generatedAt = finiteNumber(
    obj.generatedAt,
    `batch ${batchId} generatedAt`,
  );

  // Exactly one of `seed` and a non-empty `seedNullReason` is present.
  const hasSeed = obj.seed !== null && obj.seed !== undefined;
  const hasReason =
    obj.seedNullReason !== null && obj.seedNullReason !== undefined;
  if (hasSeed === hasReason) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `batch ${batchId} must record exactly one of seed or seedNullReason`,
    );
  }
  let seed: string | null = null;
  let seedNullReason: string | null = null;
  if (hasSeed) {
    seed = nonEmptyString(obj.seed, `batch ${batchId} seed`);
  } else {
    seedNullReason = nonEmptyString(
      obj.seedNullReason,
      `batch ${batchId} seedNullReason`,
    );
  }

  return {
    batchId,
    sourceId,
    generationProtocolVersion: "generation-v1",
    provider,
    family,
    model,
    version,
    promptTemplateDigest,
    temperature,
    generatedAt,
    seed,
    seedNullReason,
  };
}

/** SHA-256 (hex) of the canonical bytes of the manifest without its digest. */
export async function computeReviewedSourceManifestDigest(
  body: ReviewedSourceManifestBody,
): Promise<string> {
  return canonicalSha256({
    schemaVersion: body.schemaVersion,
    sources: body.sources,
    generationBatches: body.generationBatches,
  });
}

/** Closed parser for the reviewed-source manifest. Rejects any drift. */
export async function parseReviewedSourceManifest(
  value: unknown,
): Promise<ReviewedSourceManifestV1> {
  const root = assertExactObject(
    value,
    "reviewed source manifest",
    MANIFEST_KEYS,
    MANIFEST_KEYS,
  );

  if (root.schemaVersion !== 1) {
    fail("SOURCE_MANIFEST_SCHEMA_INVALID", "schemaVersion must be 1");
  }
  if (!Array.isArray(root.sources)) {
    fail("SOURCE_MANIFEST_FIELD_INVALID", "sources must be an array");
  }
  if (!Array.isArray(root.generationBatches)) {
    fail("SOURCE_MANIFEST_FIELD_INVALID", "generationBatches must be an array");
  }

  const seenSourceIds = new Set<string>();
  const sources = root.sources.map((entry, index) => {
    const parsed = validateEntry(entry, index);
    if (seenSourceIds.has(parsed.sourceId)) {
      fail(
        "SOURCE_MANIFEST_FIELD_INVALID",
        `duplicate sourceId "${parsed.sourceId}"`,
      );
    }
    seenSourceIds.add(parsed.sourceId);
    return parsed;
  });
  assertRegisteredLicensesAdmissible(sources);

  const seenBatchIds = new Set<string>();
  const generationBatches = root.generationBatches.map((entry, index) => {
    const parsed = validateBatch(entry, index);
    if (seenBatchIds.has(parsed.batchId)) {
      fail(
        "SOURCE_MANIFEST_FIELD_INVALID",
        `duplicate batchId "${parsed.batchId}"`,
      );
    }
    seenBatchIds.add(parsed.batchId);
    return parsed;
  });

  const sourceManifestDigest = lowercaseSha256(
    root.sourceManifestDigest,
    "sourceManifestDigest",
  );
  const body: ReviewedSourceManifestBody = {
    schemaVersion: 1,
    sources,
    generationBatches,
  };
  const expected = await computeReviewedSourceManifestDigest(body);
  if (expected !== sourceManifestDigest) {
    fail(
      "SOURCE_MANIFEST_DIGEST_MISMATCH",
      "sourceManifestDigest does not match the recomputed self-digest",
    );
  }

  return { ...body, sourceManifestDigest };
}
