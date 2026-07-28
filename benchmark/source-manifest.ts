// Closed reviewed-source manifest (v1) for the PT-BR/LinkedIn corpus. Like
// schema.ts and dataset-manifest.ts this module MUST NOT import from the
// extension bundle (src/).
//
// DEPENDENCIES (BEGIN) — this block, and not the prose around it, is the
// authority on what this module loads. The test "declares in its header exactly
// the specifiers it imports at load" asserts it enumerates EXACTLY the module's
// own `import` statements, so add an import and you add its specifier here in
// the same commit, or that test fails. Do not summarise this list in a sentence
// above: two rounds of such a summary went stale and contradicted the imports.
//   * `../contracts/canonical-json.ts` — the Phase 1 canonical-json digest
//     helper, shared with the runtime through contracts/.
//   * `./rebuild-v3-policy.ts` — reads the frozen policy file at load, which is
//     what makes this module Node-side; see "WHO OWNS WHICH VALUE" below and
//     the load-cost note at the end of this header.
// DEPENDENCIES (END)
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
// On top of the licence it carries the B3 acquisition policy: a human source is
// admissible only as a PUBLISHED base (`humanSourceAdmissibility`,
// `assertV3HumanInventoryAdmissible`), it declares which basis its `human` label
// rests on and which date field the pre-ChatGPT cutoff is compared against, and
// the documentation is screened for claims that upgrade that cutoff into proof
// (`humanLabelOverclaimIn`). `parseReviewedSourceManifest` CALLS both halves of
// that refusal, so neither is merely available to a caller: the acquisition axis
// (`assertNoIndividualAcquisition`, which retires the legacy v1 consent route) and
// the publication axis (`assertPublicBaseLicensesOnly`, which retires the two
// registered authorization licences that are not published bases). The two axes
// are separate because they refuse different things — HOW the bytes were acquired
// and WHETHER the base was published — and a licence can fail one without the
// other. What remains for C1 is the record-side vocabulary, and that residual is
// written out on `assertNoIndividualAcquisition` itself.
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
import {
  REBUILD_V3_POLICY,
  type LabelBasisValue,
} from "./rebuild-v3-policy.ts";

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

/**
 * WHAT KIND of base a licence describes. This is not a clause of the licence: it
 * is what the licence is an instrument OF, and it is the datum B3's "só admite
 * base pública licenciada" is decided from.
 *
 *   * `published-base` — the licence governs a base someone PUBLISHED. Every
 *     Creative Commons and Open Data Commons identifier here is one, and so is
 *     `lei9610-art8`: official acts are published by the state.
 *   * `operator-authorship` — the "licence" is the operator declaring they wrote
 *     the text. There is no publisher and no third party; the bytes exist because
 *     we produced them.
 *   * `internal-authorization` — an organization authorizing its own unpublished
 *     content. There IS a third party and a real written authorization, so this is
 *     not the same thing as operator authorship, but the base is still not public.
 *
 * The distinction is invisible in the clauses, which is exactly why it needs its
 * own field: `autoria-propria-v1`, `autorizacao-interna-v1` and `lei9610-art8`
 * all carry attribution/NC/SA/ND false, and only the first two are refused.
 */
export type LicensePublicationRegime =
  "published-base" | "operator-authorship" | "internal-authorization";

/** A registered licence: its clauses plus what they imply for a derived corpus. */
export interface CorpusLicenseTermsV1 {
  /** The exact official identifier. Never "CC BY", "aberta" or "permissiva". */
  licenseId: string;
  name: string;
  source: string;
  /**
   * Which kind of base the licence is an instrument of. Declared per entry and
   * NOT inferred from the clauses; see {@link LicensePublicationRegime} for why
   * the clauses cannot carry this.
   */
  publicationRegime: LicensePublicationRegime;
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
    publicationRegime: "published-base",
    attribution: true,
    nonCommercial: false,
    shareAlike: true,
    noDerivatives: false,
  },
  {
    licenseId: "cc-by-nc-sa-4.0",
    name: "Creative Commons Attribution-NonCommercial-ShareAlike 4.0",
    source: "https://creativecommons.org/licenses/by-nc-sa/4.0/",
    publicationRegime: "published-base",
    attribution: true,
    nonCommercial: true,
    shareAlike: true,
    noDerivatives: false,
  },
  {
    licenseId: "cc-by-nc-nd-4.0",
    name: "Creative Commons Attribution-NonCommercial-NoDerivatives 4.0",
    source: "https://creativecommons.org/licenses/by-nc-nd/4.0/",
    publicationRegime: "published-base",
    attribution: true,
    nonCommercial: true,
    shareAlike: false,
    noDerivatives: true,
  },
  {
    licenseId: "odc-by-1.0",
    name: "Open Data Commons Attribution License 1.0",
    source: "https://opendatacommons.org/licenses/by/1-0/",
    publicationRegime: "published-base",
    attribution: true,
    nonCommercial: false,
    shareAlike: false,
    noDerivatives: false,
  },
  {
    licenseId: "lei9610-art8",
    name: "Atos oficiais — Lei 9.610/98, art. 8º, I",
    source: "https://www.planalto.gov.br/ccivil_03/leis/l9610.htm",
    publicationRegime: "published-base",
    attribution: false,
    nonCommercial: false,
    shareAlike: false,
    noDerivatives: false,
  },
  {
    licenseId: "autorizacao-interna-v1",
    name: "Autorização interna escrita (conteúdo corporativo próprio)",
    source: "registro interno da autorização",
    publicationRegime: "internal-authorization",
    attribution: false,
    nonCommercial: false,
    shareAlike: false,
    noDerivatives: false,
  },
  {
    licenseId: "autoria-propria-v1",
    name: "Autoria própria do operador",
    source: "declaração do operador",
    publicationRegime: "operator-authorship",
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

// ---------------------------------------------------------------------------
// B3 — public bases only. WHICH route a human source may be acquired through,
// WHICH evidence basis its `human` label rests on, and WHICH date field the
// pre-ChatGPT cutoff is compared against.
//
// The decision (2026-07-26) is about ACQUISITION and nothing else: the project
// will not recruit donors, will not obtain per-document consent and will not
// record writing sessions of its own, so human text comes from published bases
// under a licence verified at the source. It is NOT a ban on a CATEGORY of
// evidence — a public base that already ran instrumented sessions stays
// admissible and keeps the stronger basis (`observed-process`). Collapsing the
// two would delete a whole class of legitimate source from the data model, which
// is why `acquisition` and `labelBasis` are separate fields with separate
// verdicts and neither is derived from the other.
// ---------------------------------------------------------------------------

/**
 * How the bytes of a human source reached the project. Closed vocabulary; only
 * the first is admissible.
 *
 *   * `public-dataset` — a published base, licence verified at the source. The
 *     only route B3 leaves open.
 *   * `per-document-consent` — a person authorizing one document of theirs.
 *   * `recruited-donor` — a person recruited to supply text.
 *   * `operator-authored-session` — a writing session we would run and record.
 *
 * The last three are three different things, listed separately because a reader
 * who sees only "no consent" tends to assume the other two survive. They do not:
 * each ACQUIRES text from an individual, which is the thing the project cannot
 * fund or govern (see plan §L1 — "restrição local, não impossibilidade da área").
 */
export type HumanSourceAcquisition =
  | "public-dataset"
  | "per-document-consent"
  | "recruited-donor"
  | "operator-authored-session";

// One verdict per route, exhaustively. `satisfies Record<...>` is what makes
// this a decision table rather than a list: adding a route to the union without
// deciding about it is a type error here, and no route is admissible by default.
const ACQUISITION_IS_INDIVIDUAL = {
  "public-dataset": false,
  "per-document-consent": true,
  "recruited-donor": true,
  "operator-authored-session": true,
} as const satisfies Record<HumanSourceAcquisition, boolean>;

// Whether each publication regime is the ONE thing B3 admits: a published base.
// Same decision-table shape and same reason — a regime added to the union without
// a verdict here is a type error, and nothing is a public base by default.
const REGIME_IS_PUBLIC_BASE = {
  "published-base": true,
  "operator-authorship": false,
  "internal-authorization": false,
} as const satisfies Record<LicensePublicationRegime, boolean>;

// Which acquisition route each regime DETERMINES, when it determines one.
//
// `operator-authorship` determines `operator-authored-session` because that is
// literally what it is: a licence whose whole basis is "the operator wrote this"
// describes the writing session the route names. It is the one place where a
// licence identifies a route, and it is why `autoria-propria-v1` is refused with
// an ACQUISITION reason rather than a publication one.
//
// The other two determine nothing, for two DIFFERENT reasons that must not be
// collapsed:
//
//   * `published-base` determines nothing because a published-base licence does
//     not testify that these particular bytes came from a published base — the
//     same CC identifier can cover a document written to order. Returning
//     `public-dataset` here would manufacture the very claim B3 exists to require
//     evidence for, so the route still has to be declared by a
//     {@link HumanSourceRegistrationV1}.
//   * `internal-authorization` determines nothing because corporate
//     self-authorization is NOT individual acquisition: there is a real third
//     party and a real written authorization, so none of the three forbidden
//     routes describes it truthfully, and naming one would be inventing
//     provenance (R4). It is still refused — by
//     {@link assertPublicBaseLicensesOnly}, on the publication axis — because
//     B3's rule is "só admite base pública licenciada", not "só recusa doador
//     individual".
const REGIME_DETERMINES_ACQUISITION = {
  "published-base": null,
  "operator-authorship": "operator-authored-session",
  "internal-authorization": null,
} as const satisfies Record<
  LicensePublicationRegime,
  HumanSourceAcquisition | null
>;

/**
 * Does `licenseId` describe a base someone published?
 *
 * `null` means the identifier is not registered, which is NOT the same answer as
 * `false`: v1 predates the registry and its manifests still carry opaque ids
 * (`lic_ptbr_1`), so an unregistered id is an unanswered question and the callers
 * that must not guess treat it as one. `assertLicenseInventoryAdmissible` is the
 * guard that fails closed on an unregistered id.
 */
export function licenseDescribesPublicBase(licenseId: string): boolean | null {
  const terms = corpusLicenseTerms(licenseId);
  return terms === null ? null : REGIME_IS_PUBLIC_BASE[terms.publicationRegime];
}

/**
 * The evidence basis of a `human` label. The vocabulary is NOT written down here:
 * `benchmark/rebuild-v3-policy.json` is the authority (`labelBasis.allowed`) and
 * `benchmark/rebuild-v3-policy.ts` types it, so this module re-exports the type
 * and validates against the frozen list.
 *
 * `observed-process` is STRONGER evidence than `date-cutoff`, not a synonym for
 * it: watching a text being written establishes the process, whereas a date only
 * excludes one tool circumstantially. The power floors are separate too — the
 * largest published instrumented base carries 95 `human-only` texts (one-sided
 * upper bound 2,77%), against the pipeline's floor of 300 per critical slice.
 */
export type HumanLabelBasis = LabelBasisValue;

/**
 * WHERE the date that anchors a document's bytes is read from.
 *
 *   * `document` — a field of the document itself (a post's creation date, a
 *     revision timestamp, the TEI header of that one text, a review's
 *     submission date).
 *   * `container` — the vintage of the dump, archive or release that carries it.
 *
 * Only `document` sustains a `date-cutoff` basis. A container vintage is a fact
 * about the file we downloaded, not about when the text was written: Carolina
 * 2.0 (Bea) carries TEI dates of 2024 and 2025, and a `pages-articles` dump
 * holds only the CURRENT revision of every page, so a recent snapshot of either
 * is full of post-LLM text under an old-looking name.
 */
export type AnchorDateScope = "document" | "container";

/**
 * The pre-ChatGPT cutoff, as the ISO instant the Python bench already applies.
 *
 * This is DOCUMENTATION of `benchmark/lab/common.py` (`CHATGPT_CUTOFF`, the
 * default of `CandidateWriter.date_cutoff`), not a second implementation: no
 * function in this module compares a date, and the cutoff is enforced where the
 * bytes are read. The test "reads the same cutoff the extractors apply, from
 * common.py" parses the date out of the Python source and compares it to this
 * string, so the two cannot drift apart in silence.
 */
export const PRE_CHATGPT_CUTOFF_ISO = "2022-11-30T00:00:00.000Z";

/**
 * What a human source declares about itself, beyond its licence: how it was
 * acquired, which label basis it sustains, and which date field the cutoff is
 * compared against.
 *
 * `labelBasis` is nullable so that "undeclared" is a STATE and not a default: a
 * source that declares nothing is refused (`label-basis-undeclared`), never
 * quietly treated as `date-cutoff`. The same holds for the anchor fields.
 *
 * The record-line counterpart of `labelBasis` lands in C1, which adds it to the
 * closed schema for `label === "human"` only. This layer is the SOURCE-level
 * half: it is what the corpus inventory can enforce today, and it is what makes
 * a record-level requirement checkable at all — a record can only carry a basis
 * its source sustains.
 */
export interface HumanSourceRegistrationV1 {
  /** Pseudonymised source token, as used by the reviewed-source manifest. */
  sourceId: string;
  /**
   * The published base this source draws from. Checked against the frozen
   * snapshot list by {@link assertV3HumanInventoryAdmissible} and NOT by
   * {@link humanSourceAdmissibility} — the frozen list is what v3 stocks, while
   * admissibility is what the policy allows to exist. Keeping them apart is what
   * lets a public instrumented base be admissible without being in v3.
   */
  snapshot: string;
  acquisition: HumanSourceAcquisition;
  /** `null` means there is no public licence, which is a refusal. */
  licenseId: string | null;
  labelBasis: HumanLabelBasis | null;
  /** The field whose value the cutoff compares, named as it appears at source. */
  anchorDateField: string | null;
  anchorDateScope: AnchorDateScope | null;
}

/** Why a human source is not admissible. Each reason is a distinct diagnosis. */
export type HumanSourceBlockReason =
  | "individual-acquisition"
  | "no-public-license"
  | "non-public-base-license"
  | "label-basis-undeclared"
  | "label-basis-not-allowed"
  | "anchor-date-field-missing"
  | "anchor-date-is-container-vintage"
  | LicenseBlockReason;

export type HumanSourceAdmissibility =
  | {
      admissible: true;
      sourceId: string;
      labelBasis: HumanLabelBasis;
      obligations: readonly LicenseObligation[];
      blockedBy: null;
    }
  | {
      admissible: false;
      sourceId: string;
      labelBasis: HumanLabelBasis | null;
      obligations: readonly LicenseObligation[];
      blockedBy: HumanSourceBlockReason;
    };

/**
 * Is `registration` admissible as a human source under B3, and with which
 * obligations?
 *
 * The guard order is the order of what a caller CANNOT satisfy away, the same
 * rule `sourceAdmissibility` follows for `ND` over `NC`:
 *
 *   1. `individual-acquisition` first. Reporting the missing licence there would
 *      tell a donor-recruiting caller that finding a licence unblocks
 *      recruitment, which is false — B3 refuses the route, whatever its licence.
 *   2. then `non-public-base-license`, for a licence the registry classifies as
 *      something other than a published base. It sits above the clause-level
 *      verdict because a base that was never published cannot enter whatever its
 *      clauses permit, and it sits below the route because a declared route is
 *      the stronger statement — a registration that says `recruited-donor` under
 *      `cc-by-sa-4.0` is refused for the route, not for the licence.
 *   3. then the licence clauses, because a source with no admissible public
 *      licence cannot enter at all, so there is nothing for a label basis to be
 *      about.
 *   4. then the label basis, and only for a `date-cutoff` basis the field the
 *      cutoff is compared against.
 *
 * Two pairs pin the order, both realistic. An individually-acquired source has no
 * public licence either, so 1 and 3 could fire on the same input ("names the
 * acquisition, not the missing licence, when both could fire"). And an operator's
 * own writing session declared honestly — `acquisition: "operator-authored-session"`
 * under `autoria-propria-v1` — is the pair where 1 and 2 fire together, and 1 wins
 * ("names the declared route, not the licence's regime, when both could fire").
 *
 * Step 2 is what the `public-dataset` LIE runs into: a registration that declares
 * `public-dataset` while naming `autoria-propria-v1` contradicts itself, guard 1
 * believes the declared route and lets it through, and guard 2 refuses it on the
 * licence the registration named itself. Without step 2 that registration was
 * admissible, which is how `assertV3HumanInventoryAdmissible` could have stocked
 * v3 from an unpublished base.
 */
export function humanSourceAdmissibility(
  registration: HumanSourceRegistrationV1,
  use: DeclaredCorpusUse = CORPUS_USE_POLICY,
): HumanSourceAdmissibility {
  const { sourceId, labelBasis } = registration;
  const refuse = (
    blockedBy: HumanSourceBlockReason,
    obligations: readonly LicenseObligation[] = [],
  ): HumanSourceAdmissibility => ({
    admissible: false,
    sourceId,
    labelBasis,
    obligations,
    blockedBy,
  });

  if (ACQUISITION_IS_INDIVIDUAL[registration.acquisition]) {
    return refuse("individual-acquisition");
  }
  if (registration.licenseId === null) {
    return refuse("no-public-license");
  }
  // Step 2: the licence names a base that was never published. Distinct from
  // `no-public-license` above, which is the absence of any licence at all, and
  // from the clause verdict below, which is about what a published base permits.
  if (licenseDescribesPublicBase(registration.licenseId) === false) {
    return refuse("non-public-base-license");
  }
  const licence = sourceAdmissibility(registration.licenseId, use);
  if (!licence.admissible) {
    return refuse(licence.blockedBy, licence.obligations);
  }
  if (labelBasis === null) {
    return refuse("label-basis-undeclared", licence.obligations);
  }
  // Membership is checked against the frozen list rather than against this
  // module's own type, so a policy that stops allowing a basis takes effect here
  // without an edit, and a value smuggled past the type is still refused.
  if (!REBUILD_V3_POLICY.labelBasis.allowed.includes(labelBasis)) {
    return refuse("label-basis-not-allowed", licence.obligations);
  }
  if (labelBasis === "date-cutoff") {
    if (
      registration.anchorDateField === null ||
      registration.anchorDateScope === null
    ) {
      return refuse("anchor-date-field-missing", licence.obligations);
    }
    if (registration.anchorDateScope === "container") {
      return refuse("anchor-date-is-container-vintage", licence.obligations);
    }
  }
  return {
    admissible: true,
    sourceId,
    labelBasis,
    obligations: licence.obligations,
    blockedBy: null,
  };
}

/**
 * The human sources v3 stocks, one per frozen snapshot, with the field each
 * extractor actually reads the date from. Every anchor field below was read out
 * of the extractor that uses it, not inferred from the format:
 *
 *   * `pt-stackoverflow` — `Posts.xml` attribute `CreationDate`
 *     (`benchmark/lab/extract_stackexchange.py`, `element.get("CreationDate")`).
 *   * `ptwiki` — `<revision><timestamp>` of the page
 *     (`benchmark/lab/extract_wikipedia.py`). Document-level, and bounded above
 *     by the dump: `pages-articles` carries only the current revision, so a
 *     recent dump drops everything instead of admitting recent text — the
 *     failure is closed, which is why the field still qualifies.
 *   * `carolina` — TEI header `<date type="Download">` of that one document
 *     (`benchmark/lab/extract_carolina.py`). Per document, not per package: the
 *     2.0 (Bea) package header is one thing and its documents carry dates of
 *     2024 and 2025, which is exactly why the package vintage may not stand in.
 *   * `b2w-reviews01` — CSV column `submission_date` (`extract_b2w.py`, with
 *     `date`/`review_date` as the alternate spellings of the same column).
 *
 * All four sustain `date-cutoff` and none sustains `observed-process`: no
 * published instrumented pt-BR base of the required size exists, and inventing
 * one would be inventing provenance (R4). That is a limitation of this
 * inventory, recorded in `docs/limitations.md`, not a property of the field.
 *
 * BOTH keys here are join keys, and both are pinned by test. `snapshot` joins to
 * `REBUILD_V3_POLICY.humanSources.snapshots` (asserted set-equal). `sourceId`
 * joins to the `sourceId` of the reviewed source manifest, and these four values
 * are the ones the manifests an operator actually holds use — `src_ptso`,
 * `src_wikipedia_pt`, `src_carolina`, `src_b2w` in
 * `benchmark/data/corpus-build/**\/private/source-manifest.json`. That file is a
 * gitignored build artifact, so no test can read it; the ids are pinned as
 * literals by "declares the sourceId a reviewed manifest joins on" instead, and a
 * rename on either side has to move both.
 */
export const V3_HUMAN_SOURCE_INVENTORY: readonly HumanSourceRegistrationV1[] = [
  {
    sourceId: "src_ptso",
    snapshot: "pt-stackoverflow",
    acquisition: "public-dataset",
    licenseId: "cc-by-sa-4.0",
    labelBasis: "date-cutoff",
    anchorDateField: "Posts.xml@CreationDate",
    anchorDateScope: "document",
  },
  {
    sourceId: "src_wikipedia_pt",
    snapshot: "ptwiki",
    acquisition: "public-dataset",
    licenseId: "cc-by-sa-4.0",
    labelBasis: "date-cutoff",
    anchorDateField: "page/revision/timestamp",
    anchorDateScope: "document",
  },
  {
    sourceId: "src_carolina",
    snapshot: "carolina",
    acquisition: "public-dataset",
    licenseId: "cc-by-nc-sa-4.0",
    labelBasis: "date-cutoff",
    anchorDateField: 'teiHeader//date[@type="Download"]',
    anchorDateScope: "document",
  },
  {
    sourceId: "src_b2w",
    snapshot: "b2w-reviews01",
    acquisition: "public-dataset",
    licenseId: "cc-by-nc-sa-4.0",
    labelBasis: "date-cutoff",
    anchorDateField: "submission_date",
    anchorDateScope: "document",
  },
];

/**
 * Refuses a v3 human inventory and returns the obligations it imposes.
 *
 * Two refusals, deliberately distinct. `snapshot-not-frozen` is not a policy
 * judgement about the base: it is `humanSources.newDownloadsAllowed: false`, so
 * a base outside the frozen list has no bytes on disk to stock v3 with, however
 * admissible its route and licence are. That is why the snapshot check lives
 * here and not in {@link humanSourceAdmissibility} — a public instrumented base
 * must stay admissible in the model while being absent from this corpus.
 */
export function assertV3HumanInventoryAdmissible(
  registrations: readonly HumanSourceRegistrationV1[],
  use: DeclaredCorpusUse = CORPUS_USE_POLICY,
): readonly LicenseObligation[] {
  const frozen = REBUILD_V3_POLICY.humanSources.snapshots;
  const union = new Set<LicenseObligation>();
  for (const registration of registrations) {
    const verdict = humanSourceAdmissibility(registration, use);
    if (!verdict.admissible) {
      fail(
        "HUMAN_SOURCE_NOT_ADMISSIBLE",
        `human source ${registration.sourceId} is not admissible: ${verdict.blockedBy}`,
      );
    }
    if (!frozen.includes(registration.snapshot)) {
      fail(
        "HUMAN_SOURCE_NOT_ADMISSIBLE",
        `human source ${registration.sourceId} draws on "${registration.snapshot}": snapshot-not-frozen (no new download is authorized)`,
      );
    }
    for (const obligation of verdict.obligations) union.add(obligation);
  }
  return OBLIGATION_ORDER.filter((obligation) => union.has(obligation));
}

/**
 * The B3 acquisition route a v1 manifest entry DETERMINES, or `null` when the
 * entry does not determine one.
 *
 * Two things can determine a route, and the entry carries both:
 *
 *   * `sourceType`. `linkedin-contribution` determines `per-document-consent`:
 *     its whole legal basis is a consent receipt digest, so there is nothing else
 *     it could be. `controlled-generation` is not a human source at all.
 *   * the LICENCE of a `licensed-corpus` entry, through its publication regime.
 *     An earlier round returned `null` for every `licensed-corpus` entry and said
 *     in this docstring that `autorizacao-interna-v1` and `autoria-propria-v1`
 *     "are licensed-corpus entries too, and neither is a public base" — a correct
 *     observation with no consequence attached, so a manifest carrying either id
 *     parsed clean. It is recorded here rather than deleted, because the failure
 *     shape is the one that recurs: a policy stated in prose and reachable by no
 *     guard. Now `REGIME_DETERMINES_ACQUISITION` answers it from the registry, so
 *     `autoria-propria-v1` determines `operator-authored-session` and the refusal
 *     comes from data instead of from a hardcoded id list.
 *
 * An UNREGISTERED licence id still determines nothing, deliberately: it is an
 * unanswered question, not a public base (see {@link licenseDescribesPublicBase}).
 */
export function determinedHumanAcquisition(
  entry: Pick<ReviewedSourceEntryV1, "sourceType" | "licenseId">,
): HumanSourceAcquisition | null {
  if (entry.sourceType === "linkedin-contribution") {
    return "per-document-consent";
  }
  if (entry.sourceType !== "licensed-corpus" || entry.licenseId === null) {
    return null;
  }
  const terms = corpusLicenseTerms(entry.licenseId);
  return terms === null
    ? null
    : REGIME_DETERMINES_ACQUISITION[terms.publicationRegime];
}

/**
 * Refuses every v1 manifest entry whose determined route B3 forbids.
 *
 * `parseReviewedSourceManifest` calls this, so the refusal is on the admission
 * path and not merely available to a caller: a manifest carrying a
 * `linkedin-contribution` entry no longer loads. An earlier round left it
 * uncalled on the argument that the consent route runs through three contracts
 * that move together, and that argument was WRONG on measurement, so it is
 * recorded here rather than deleted:
 *
 *   * `benchmark/corpus-import.ts` cross-checks only `provenance.sourceId`
 *     against the manifest's id set. There is no `sourceKind`/`legalBasis`
 *     pairing check anywhere, so a record can reference a licensed source with
 *     no change to `benchmark/schema.ts` or `contracts/source-readiness.ts`.
 *   * No `ReviewedSourceManifestV1` on disk carries a `linkedin-contribution`
 *     entry, so no sealed artifact becomes unreadable by refusing the route. The
 *     claim is scoped to THIS shape deliberately: the synthetic smoke corpus under
 *     `benchmark/work/` does carry `{"id": "consent", "kind":
 *     "authorized-contribution"}`, which is a different artifact with different
 *     keys, written by a different producer and read by a different loader. This
 *     parser would reject it on an unknown key long before the acquisition sweep,
 *     so the sweep does not apply to it.
 *
 * What genuinely remains for C1 is narrower and is a vocabulary cleanup, not a
 * hole: `provenance.sourceKind: "authorized-contribution"` and
 * `provenance.legalBasis: "consent"` are still spellable by the record schema,
 * and `acquisitionCounts.consent` is still a required key of the readiness
 * contract. Neither can bring in a source the manifest refuses, because a record
 * whose `sourceId` is absent from the manifest is rejected as
 * `SOURCE_ENTRY_ABSENT`.
 */
export function assertNoIndividualAcquisition(
  sources: readonly Pick<
    ReviewedSourceEntryV1,
    "sourceId" | "sourceType" | "licenseId"
  >[],
): void {
  for (const source of sources) {
    const route = determinedHumanAcquisition(source);
    if (route !== null && ACQUISITION_IS_INDIVIDUAL[route]) {
      fail(
        "HUMAN_SOURCE_NOT_ADMISSIBLE",
        `source ${source.sourceId} is acquired through "${route}": individual-acquisition is refused (B3)`,
      );
    }
  }
}

/**
 * Refuses every v1 manifest entry whose licence is registered as something other
 * than a published base. The companion of {@link assertNoIndividualAcquisition}
 * on the other axis of B3's rule: that one asks HOW the bytes were acquired, this
 * one asks whether the base they came from was ever published.
 *
 * Both are needed and neither subsumes the other. `autoria-propria-v1` fails both
 * (the acquisition guard runs first and reports the route, because "publish your
 * own writing session" does not unblock a route B3 refuses, so naming the
 * publication would name a reason a caller could satisfy without becoming
 * admissible — the same precedence rule `sourceAdmissibility` follows for ND over
 * NC and `humanSourceAdmissibility` follows for the route over the licence).
 * `autorizacao-interna-v1` fails only this one, because corporate
 * self-authorization is not individual acquisition.
 *
 * It applies to EVERY entry and not only to `licensed-corpus`, because the reason
 * is a property of the base and not of the label the entry gives itself: a
 * `controlled-generation` entry claiming `autoria-propria-v1` is still a corpus
 * built on an unpublished base.
 *
 * An UNREGISTERED licence id passes here, and that is the same deliberate v1
 * tolerance `assertRegisteredLicensesAdmissible` documents: the private manifests
 * and the fixtures still carry opaque ids, and requiring registration of every
 * identifier is a schema decision (v3), not this guard's. Callers that need the
 * full closure call `assertLicenseInventoryAdmissible`.
 */
export function assertPublicBaseLicensesOnly(
  sources: readonly Pick<ReviewedSourceEntryV1, "sourceId" | "licenseId">[],
): void {
  for (const source of sources) {
    if (source.licenseId === null) continue;
    if (licenseDescribesPublicBase(source.licenseId) === false) {
      const terms = corpusLicenseTerms(source.licenseId);
      fail(
        "HUMAN_SOURCE_NOT_ADMISSIBLE",
        `source ${source.sourceId} licence "${source.licenseId}" is ${terms?.publicationRegime ?? "unregistered"}: non-public-base is refused (B3 admits only a published base)`,
      );
    }
  }
}

// --- the over-claim screen for the human label -----------------------------
//
// R7 in one function: declare the contract, not the property. The date cutoff is
// a declared mitigation, and the documentation may not upgrade it into proof. The
// technique is the one `src/shared/classification-copy.ts` already uses for
// authorship copy, and the plan already uses in H4 ("busca normalizada pelas
// expressões proibidas").
//
// It screens ASSERTIONS, not words, because every forbidden word appears in text
// the project must keep: MultiSocial's own formulation is that human authorship
// "não pode ser garantida em 100%", our own sentence is that the cutoff is
// "mitigação declarada de risco, não prova de autoria humana", and the PII
// paragraph of docs/corpus-sources.md says a property is "garantido
// estruturalmente pelo pipeline" — about PII, which is a different subject. So a
// violation needs THREE things at once, inside one clause: a subject that is the
// human label or the cutoff, a claim verb, and no negation in front of the verb.

/** Subjects whose claim this screen governs: the human label and the cutoff. */
const HUMAN_LABEL_SUBJECT =
  /\bautoria\s+humana\b|\bautoria\s+d(?:este|esse|o)\s+(?:texto|documento)\b|\br[óo]tulo\s+`?human(?:o|a)?`?\b|\bcorte\s+(?:de\s+data|temporal)\b/iu;

// The claim verbs, in the inflections Portuguese actually uses. Written out
// rather than stemmed with `\w*`: `prov\w*` would fire on "provedor",
// "provavelmente" and "provisório", none of which claims anything.
const HUMAN_LABEL_CLAIM =
  /\b(?:garante|garantem|garantia|garantias|garantir|garantido|garantida|garantidos|garantidas|prova|provas|provam|provar|provado|provada|provados|provadas|comprova|comprovam|comprovar|comprovado|comprovada|comprova[çc][ãa]o|certifica|certificam|certificar|certificado|certificada|certifica[çc][ãa]o|assegura|asseguram|assegurar|assegurado|assegurada|atesta|atestam|atestar|atestado)\b|\bpor\s+constru[çc][ãa]o\b/giu;

// A denial is not a claim. The window is 40 characters of the same clause, which
// covers "não pode ser garantida", "nunca prova", "não é prova de" and "sem
// garantia de" without reaching into the previous sentence.
const HUMAN_LABEL_DENIAL = /\b(?:n[ãa]o|nunca|nem|jamais|sem)\b/iu;
const DENIAL_WINDOW = 40;

// Clause boundaries: blank lines, markdown table cell walls and sentence-final
// punctuation. The cell walls matter — a table row is one line, and without the
// split a subject in one column would pair with a verb three columns away.
const CLAUSE_BOUNDARY = /\r?\n+|\||(?<=[.:;!?])\s+/u;

// A markdown line that OPENS a block rather than continuing the previous one:
// heading, list item, ordered item, table row, fence, or a blank line.
const MARKDOWN_BLOCK_START = /^\s*(?:#{1,6}\s|[-*+]\s|\d+[.)]\s|\||```|$)/u;
const BLOCKQUOTE_MARKER = /^[ \t]*>[ \t]?/u;

/**
 * Rejoins the soft line wraps of a markdown paragraph, so a clause split across
 * two physical lines is judged as the one clause it is.
 *
 * This is not cosmetic and it was not in the first version of this screen: prose
 * in `docs/` wraps at about 80 columns, so "a autoria humana está\ncomprovada"
 * put the subject on one line and its verb on the next, and a per-line screen saw
 * a clause with a subject and no claim beside a clause with a claim and no
 * subject — the exact wording it exists to catch, invisible for a reason that has
 * nothing to do with meaning. Blockquote markers are stripped first, because the
 * frozen-decision blocks of `docs/corpus-sources.md` are blockquotes and a `>`
 * per line would otherwise defeat the rejoin the same way.
 *
 * A line that OPENS a block is never joined to the previous one, which keeps two
 * neighbouring list items or table rows from being read as a single clause.
 */
function unwrapSoftLines(text: string): string {
  const joined: string[] = [];
  for (const raw of text.split(/\r?\n/u)) {
    const line = raw.replace(BLOCKQUOTE_MARKER, "");
    const previous = joined.at(-1);
    if (
      previous !== undefined &&
      previous.trim() !== "" &&
      !MARKDOWN_BLOCK_START.test(line)
    ) {
      joined[joined.length - 1] = `${previous} ${line.trim()}`;
      continue;
    }
    joined.push(line);
  }
  return joined.join("\n");
}

/**
 * The first forbidden claim about the human label in `text`, or `null` when it
 * makes none. Returns the claim and its clause so a failing test names WHAT
 * fired and WHERE, instead of only that something did.
 */
export function humanLabelOverclaimIn(text: string): string | null {
  for (const clause of unwrapSoftLines(text).split(CLAUSE_BOUNDARY)) {
    if (!HUMAN_LABEL_SUBJECT.test(clause)) continue;
    // Fresh lastIndex per clause: the pattern carries `g` for `matchAll`, so it
    // must never be shared as a stateful cursor across clauses.
    for (const match of clause.matchAll(HUMAN_LABEL_CLAIM)) {
      const before = clause.slice(
        Math.max(0, match.index - DENIAL_WINDOW),
        match.index,
      );
      if (HUMAN_LABEL_DENIAL.test(before)) continue;
      return `${match[0]} @ ${clause.trim().slice(0, 160)}`;
    }
  }
  return null;
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
  // B3: the acquisition route is refused here, at the only place a manifest on
  // disk becomes a `ReviewedSourceManifestV1`. It runs AFTER the licence check
  // so the two reasons stay distinguishable in the order `humanSourceAdmissibility`
  // documents — a blocked licence is a licence problem whatever the route, and a
  // forbidden route is refused whatever the licence (a `linkedin-contribution`
  // entry is required to carry `licenseId: null`, so no licence reason can fire
  // on it at all).
  assertNoIndividualAcquisition(sources);
  // ...and then the publication axis. Order is load-bearing and pinned by
  // "names the route, not the publication, when both could fire": an
  // `autoria-propria-v1` entry fails both guards, and the route is the reason a
  // caller cannot satisfy away.
  assertPublicBaseLicensesOnly(sources);

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
