// Closed reviewed-source manifest (v1 and v2) for the PT-BR/LinkedIn corpus. Like
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
//   * `./preregistration-v4.ts` — reads the frozen policy file at load, which is
//     what makes this module Node-side; see "WHO OWNS WHICH VALUE" below and
//     the load-cost note at the end of this header.
//   * `./schema.ts` — the record-side axis vocabulary (`GroupAxis`, the union over
//     every record version), imported as a TYPE only so a source's
//     `declaredGroupAxes` cannot name an axis no record can fill. The comparison itself lives on the record side
//     (`assertDeclaredAxesResolved`), which is what keeps this direction of the
//     dependency the only one.
// DEPENDENCIES (END)
//
// The manifest binds the private governance file (`private/source-manifest.json`)
// that never enters Git: it names — only by opaque, pseudonymised tokens and
// digests — every authorized source and every controlled-generation batch. It
// carries NO source URL, name, handle or raw consent receipt; a consent source
// binds its receipt solely through a `consentReceiptDigest`.
//
// "Closed" means every object is validated against an exact key set, and that is
// the KEY axis of the promise above: any unknown field (in particular a smuggled
// `sourceUrl`, `authorName`, `handle` or raw `consentReceipt`), a licensed source
// without a `licenseId`, a consent source without a `consentReceiptDigest`, an
// incomplete generation recipe, non-distinct legal reviewers, a seed that is
// neither present nor explicitly waived, or a `sourceManifestDigest` that no
// longer matches the recomputed self-digest is a hard failure. There is no
// coercion and no last-write-wins.
//
// The key axis decides which fields may exist and says nothing about the VALUE of
// a legitimate field, and the promise above is a promise about values as well:
// `assertNoSourceLocator` is that half. It sweeps every string leaf of the hashed
// projection (`reviewedSourceManifestProjection`) for a source locator or a
// contactable identity, and admits a material batch's `evidence` only in the two
// forms a third party can recompute — `<alg>:<hex>` or `<file> (<n> bytes)`. Both
// halves run before the self-digest is compared, so a leaked locator is never
// reported as a stale digest, whose remedy would make the leak permanent.
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
// WHOSE obligations, and over WHAT — read this before adding anything that
// returns a `LicenseObligation`. Every obligation this module computes is an
// obligation over the CORPUS: acquiring the bytes, preparing them, using them.
// None of them is an obligation over the trained WEIGHTS, and the naming says so
// throughout (`FROZEN_CORPUS_OBLIGATIONS`, `corpusLicenseObligations`).
//
// The reason is not tidiness. If the weights were held to be a derivative of the
// training sources, the registered licences would be jointly unsatisfiable:
// `cc-by-sa-4.0` forbids adding a restriction, so it forbids `NC`, while
// `cc-by-nc-sa-4.0` requires the derivative to carry the same licence, which
// includes `NC`. A function that derived the weights' licence from the union of
// the source licences would therefore be deriving the empty set and reporting it
// as a licence. What governs the weights is {@link WEIGHT_USE_POLICY}: the
// project's OWN policy, chosen rather than inherited, and its
// `sourceObligationsPropagate: false` is a declared position of the operator and
// NOT a legal finding — the Creative Commons primer says a model is frequently
// not an adaptation but reserves the copies made during training, and Brazil has
// no clear text-and-data-mining exception. `weightInheritanceOverclaimIn` is the
// third over-claim screen and it refuses the sentence that says otherwise.
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
// It carries a SECOND over-claim screen for the same reason (`reviewOverclaimIn`,
// C5 requirement 4 — "não deixe o filtro automático poder se apresentar como
// revisão", one level up from the record): the review receipt was removed from the
// records and from the assembler, and prose is the other place a removed claim comes
// back. What that screen does NOT do is decide whether a record was reviewed — the
// review state is a record field (`benchmark/schema.ts`) and the coherence gate is
// `sealDataset` (`benchmark/dataset-manifest.ts`); this module only refuses the
// SENTENCE.
//
// And a THIRD, `weightInheritanceOverclaimIn`, for the licence position stated
// above. Same defect one subject over: the claim was removed from the data
// (`license-review.json` no longer publishes a union of source obligations as the
// artifact's own) and prose is where a removed claim comes back. It refuses the
// sentence that the weights inherit or propagate the source licences'
// obligations, in either direction — inherited FROM the sources, or imposed ON a
// derivative.
//
// HOW THE THREE SCREENS ARE ENFORCED, said plainly because the sentence above about
// `parseReviewedSourceManifest` is about the acquisition guards and does not carry
// over: none of `humanLabelOverclaimIn`, `reviewOverclaimIn` and
// `weightInheritanceOverclaimIn` has a production
// caller, by design and not by oversight. They are lint rules over the governance
// documents, and the enforcement is the sweep in
// `benchmark/tests/source-manifest.test.ts`, which reads every screened file from
// disk and fails the suite on a violation. Note the consequence for provenance of
// the screen itself: this module IS in `EVALUATOR_FILES` (see
// `benchmark/digests.ts`), so every byte of it — the three screens included — is part
// of the evaluator's identity, and editing it AFTER `fit` fails
// `integrity.evaluator-digest` and burns the holdout grant (R1). It was added there
// by C3, because `commands/split.ts` now feeds the audit the real source
// declarations from `V3_HUMAN_SOURCE_INVENTORY`: a changed declaration changes a
// gate verdict. Editing it during Phase A/B/C is expected and allowed; the window
// that closes is G5.
//
// WHO OWNS WHICH VALUE (this module is not the authority for all of it):
//   * `benchmark/preregistration-v4.json`, validated by
//     `benchmark/preregistration-v4.ts` and inside `EVALUATOR_FILES`, is the
//     authority for the frozen decisions themselves — `commercialUse: false`,
//     `attributionRequired`, `shareAlikeRequired`. The plan's frozen contract
//     says code may not repeat them as loose constants, so this module READS
//     them (`CORPUS_USE_POLICY.commercialUse`, `FROZEN_CORPUS_OBLIGATIONS`)
//     and never writes them down a second time. All three are rows about the
//     CORPUS; none of them is a row about the weights.
//   * This module is the authority for the licence registry, the per-source
//     admissibility verdict and the obligations each licence imposes on the
//     corpus, AND for the weights' own use policy ({@link WEIGHT_USE_POLICY}),
//     which no source licence contributes to.
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
  PREREGISTRATION_V4,
  type LabelBasisValue,
} from "./preregistration-v4.ts";
import type { GroupAxis } from "./schema.ts";

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
  /**
   * The sampling temperature the batch APPLIED, or `null` on a lane that applies
   * none — in which case `temperatureNullReason` says why. Exactly one of the two
   * is present, the same pair `seed`/`seedNullReason` already uses, and for the
   * same kind of reason.
   *
   * It was a required `number` until the C1 correction round, and that made the
   * recipe-identity comparison in benchmark/corpus-source-audit.ts UNSATISFIABLE
   * for most of the v3 corpus. The CLI lanes — every frozen lane but `gemini-api`
   * and `ollama` — set `decodingConfigurable: false` in their policy row, so a v3
   * record on one of them has no
   * temperature field at all and `recipeTemperature` returns `null` BY
   * CONSTRUCTION; against a required number that comparison was `null ===
   * <number>` and always false. There was no way around it either: an axis class
   * requires `collectionBatch` to be `known`, so a row with no resolvable batch is
   * refused with GENERATION_RECIPE_MISSING rather than skipping the comparison.
   * Measured at 7a4d610 on an `agy` row aligned field-for-field with its batch:
   * `GENERATION_RECIPE_MISMATCH`, `status: "blocked"`.
   *
   * A bare nullable would have made the comparison satisfiable and left the datum
   * dishonest — `null` alone cannot be told apart from "nobody wrote it down",
   * which is exactly the ambiguity `decodingConfigurable` exists to remove on the
   * record's side. Hence the reason, and hence a batch of a CLI lane says the true
   * thing (the binary takes no sampling flag) instead of a number nothing applied.
   */
  temperature: number | null;
  /** Why no temperature applied. Exactly one of the pair above is present. */
  temperatureNullReason: string | null;
  generatedAt: number;
  seed: string | null;
  seedNullReason: string | null;
}

/**
 * Um LOTE DE MATERIAL: o conjunto de documentos que vieram do mesmo material, adquirido no mesmo
 * evento, na mesma versão imutável.
 *
 * É a unidade de DEPENDÊNCIA do lado humano, e existe porque a pré-inscrição abandonada
 * confundia lote com execução de extração: reextrair o mesmo material não produz material novo, e
 * tratar duas execuções como duas unidades independentes conta a mesma dependência duas vezes. O
 * vocabulário completo está em
 * `docs/superpowers/plans/2026-08-02-lotes-e-unidade-de-dependencia.md`.
 *
 * O campo é OPCIONAL no esquema v1 por uma razão de digest, não de rigor: a projeção que
 * `computeReviewedSourceManifestDigest` hasheia é escrita à mão, e incluir a chave sempre mudaria
 * o digest de todo manifesto v1 que não declara lote — inclusive o inventário v3 congelado. No
 * esquema **v2** ele é OBRIGATÓRIO e entra na projeção INCONDICIONALMENTE, porque um registro v4
 * nomeia `groups.sourceMaterialBatch` e o único inventário contra o qual esse nome resolve é este.
 */
export interface SourceMaterialBatchV1 {
  batchId: string;
  /** Uma fonte DECLARADA neste mesmo manifesto: o parser recusa lote órfão. */
  sourceId: string;
  /**
   * A versão concreta e imutável do que foi adquirido — número de dump, tag de release, digest do
   * arquivo. É o que torna "o mesmo material" verificável em vez de declarado.
   */
  materialVersion: string;
  /** A janela de aquisição. Um evento pontual é `startedAt === endedAt`, e isso é legítimo. */
  acquisitionWindow: { startedAt: number; endedAt: number };
  /**
   * O que torna os quatro campos acima verificáveis por terceiro. Não pode ser vazia: um lote sem
   * evidência é uma declaração sobre a qual ninguém pode discordar, que é exatamente o que a
   * governança deste projeto recusa em toda parte.
   *
   * Cada item é uma de DUAS formas, e nenhuma outra: `<alg>:<hex minúsculo>`, o digest do
   * conteúdo, ou `<nome> (<n> bytes)`, o arquivo em mão com o seu tamanho. É a FORMA que se
   * recomputa de quem tem os bytes — que o arquivo nomeado exista continua sendo obrigação da
   * revisão humana. Localizador que não caiba em nenhuma das duas formas é recusado aqui
   * mesmo (`assertNoSourceLocator`), porque a versão concreta já vive em `materialVersion`;
   * localizador VESTIDO de nome de arquivo (`dumps.wikimedia.org (10 bytes)`) permanece
   * resíduo, declarado em `SOURCE_LOCATOR_MARKS` e fixado como aceito por teste.
   */
  evidence: string[];
}

export interface ReviewedSourceManifestV1 {
  schemaVersion: 1;
  sources: ReviewedSourceEntryV1[];
  generationBatches: GenerationBatchV1[];
  materialBatches?: SourceMaterialBatchV1[];
  sourceManifestDigest: string;
}

/**
 * O inventário revisado na versão que a pré-inscrição nova exige.
 *
 * A única diferença com o v1 é `materialBatches`: aqui a chave é OBRIGATÓRIA e entra na projeção
 * do digest sem condição. As duas metades são necessárias e são a mesma decisão vista de dois
 * lados. Opcional, um manifesto poderia declarar zero lote e continuar válido, e nenhum registro
 * v4 teria contra o que resolver `groups.sourceMaterialBatch`. Fora da projeção, o inventário
 * nasceria FORJÁVEL — acrescentar, remover ou reescrever um lote não mexeria no `sourceManifestDigest`
 * que a evidência publica.
 *
 * Uma lista VAZIA continua expressável e continua significando algo verificável: nenhum lote de
 * material foi declarado, e portanto nenhum registro v4 humano resolve. O que deixa de ser
 * expressável é a AUSÊNCIA da declaração, que é indistinguível de ninguém ter escrito.
 */
export interface ReviewedSourceManifestV2 {
  schemaVersion: 2;
  sources: ReviewedSourceEntryV1[];
  generationBatches: GenerationBatchV1[];
  materialBatches: SourceMaterialBatchV1[];
  sourceManifestDigest: string;
}

/** Qualquer versão do inventário. `schemaVersion` é o discriminante. */
export type ReviewedSourceManifest =
  ReviewedSourceManifestV1 | ReviewedSourceManifestV2;

// Discriminada de propósito, e não `Omit` sobre a união: `Omit` funde as duas versões em uma
// forma só, e aí `schemaVersion` deixa de estreitar — o que faria a projeção do digest tratar
// `materialBatches` como opcional nas DUAS versões, que é exatamente a condicional que o v2
// existe para eliminar.
export type ReviewedSourceManifestBody =
  | Omit<ReviewedSourceManifestV1, "sourceManifestDigest">
  | Omit<ReviewedSourceManifestV2, "sourceManifestDigest">;

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
 * in `benchmark/preregistration-v4.json` and validated by
 * `benchmark/preregistration-v4.ts`, and it is read from there so the decision
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
  commercialUse: PREREGISTRATION_V4.commercialUse,
  redistribution: "not-published",
} as const;

/**
 * What governs the published WEIGHTS, as the project's own policy.
 *
 * This constant exists because the alternative does not work. Held to be a
 * derivative of its training sources, the model would owe `cc-by-sa-4.0` (which
 * forbids adding restrictions) and `cc-by-nc-sa-4.0` (whose share-alike requires
 * the derivative to carry `NC`, a restriction) at the same time; Creative Commons
 * documents that pair as incompatible. So the project takes a position instead of
 * deriving a contradiction, and the position is written down here rather than
 * implied by an absence.
 *
 * `sourceObligationsPropagate: false` is the position. Read what it is and is not:
 *
 *   * it is a RISK DECISION OF THE OPERATOR, recorded as decision B2 and as
 *     position (a) of `docs/superpowers/plans/2026-07-30-estado-do-projeto.md`;
 *   * it is NOT a legal finding, NOT a consensus, and NOT a conclusion of
 *     Creative Commons — the CC primer says a model is frequently not an
 *     adaptation, and in the same breath reserves the copies made during training
 *     and notes that jurisdictions diverge. Brazil has no clear text-and-data
 *     mining exception;
 *   * it says nothing about ACQUISITION. The obligations of the sources still
 *     govern how the bytes were obtained, prepared and used, which is what
 *     {@link FROZEN_CORPUS_OBLIGATIONS} and {@link corpusLicenseObligations} are
 *     about, and it is why a source's access terms can block it whatever this
 *     field says.
 *
 * `commercialUse: false` here agrees with `CORPUS_USE_POLICY.commercialUse` and is
 * deliberately NOT read from it. Two policies that happen to say the same thing
 * are not one policy: the corpus is non-commercial because the frozen contract
 * says so, the weights are non-commercial because the project chose it, and
 * threading one through the other would rebuild the inheritance this constant
 * exists to deny. Both are pinned to `PREREGISTRATION_V4.commercialUse` by test so
 * they cannot drift apart in silence either.
 *
 * `prohibitedUses` is the reason the licence has to be its own named instrument
 * rather than a permissive licence plus a paragraph in the extension: the copy
 * shipped in `src/shared/classification-copy.ts` does not travel with weights
 * somebody extracted from the bundle, and a use restriction that does not travel
 * with the artifact restricts nothing.
 */
export const WEIGHT_USE_POLICY = {
  licenseId: "cleanfeed-weights-nc-1.0",
  // Its OWN id, not `CORPUS_USE_POLICY.policyId`. The two policies say the same thing
  // about commercial use and are still two policies; reusing one identifier would
  // leave the published artifacts unable to name which of them a given `false` came
  // from, which is the confusion this whole constant exists to prevent.
  policyId: "weights-noncommercial-v1",
  commercialUse: false,
  sourceObligationsPropagate: false,
  positionAuthority: "operator-risk-decision",
  prohibitedUses: [
    "academic-integrity",
    "decisional",
    "disciplinary",
    "employment",
    "mass-screening",
  ],
} as const;

/**
 * The use a caller declares. Only `commercialUse` can change a verdict: the
 * `NC` clause is about use, not about the corpus.
 */
export interface DeclaredCorpusUse {
  commercialUse: boolean;
}

/**
 * An obligation a licence imposes on the derived CORPUS — on acquiring the bytes,
 * preparing them and using them.
 *
 * Not on the weights. The weights carry {@link WEIGHT_USE_POLICY}, which is the
 * project's own policy and takes no input from this type. The distinction is the
 * whole reason the type is named for the licence rather than for the artifact: a
 * value of this type answers "what does this licence require of the corpus", and
 * there is no operation in this module that turns it into a requirement on the
 * model.
 */
export type LicenseObligation =
  "attribution" | "non-commercial" | "share-alike";

/** Canonical order for every obligation list this module returns. */
const OBLIGATION_ORDER: readonly LicenseObligation[] = [
  "attribution",
  "non-commercial",
  "share-alike",
];

/**
 * The obligations the frozen contract requires the CORPUS to carry, DERIVED
 * from `benchmark/preregistration-v4.json` instead of listed here: the row "uso e
 * licença" is `commercialUse: false` plus `attributionRequired` plus
 * `shareAlikeRequired`.
 *
 * It is not the same statement as `corpusLicenseObligations(...)`, which
 * answers what a given set of licences happens to impose. This one is the floor:
 * a registry edit that dropped `shareAlike` from `cc-by-nc-sa-4.0` would lower
 * what the licences impose while the frozen requirement stayed, which is the
 * divergence the test "imposes every obligation the frozen contract requires"
 * exists to catch. C1/C5 should read this constant, not restate the flags.
 *
 * Its previous name said `ARTIFACT`, and that was the defect and not a wording
 * preference: the same three flags were being read as the licence of the trained
 * model. They are the corpus's. `non-commercial` appears here because the frozen
 * `commercialUse: false` governs how the corpus may be used — the weights are
 * non-commercial too, but by {@link WEIGHT_USE_POLICY} and not by this constant,
 * so the two agree without one deriving from the other.
 */
export const FROZEN_CORPUS_OBLIGATIONS: readonly LicenseObligation[] =
  OBLIGATION_ORDER.filter((obligation) => {
    switch (obligation) {
      case "attribution":
        return PREREGISTRATION_V4.attributionRequired;
      case "non-commercial":
        return !PREREGISTRATION_V4.commercialUse;
      case "share-alike":
        return PREREGISTRATION_V4.shareAlikeRequired;
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
 * The obligations a set of licence identifiers imposes on the CORPUS, in
 * canonical order. Obligations do not depend on the declared use, so this
 * function does not take one; it fails closed on an unregistered identifier,
 * because a licence whose clauses are unknown cannot be said to impose none.
 *
 * The union is over the corpus and stops there. Passing this return value on as
 * the licence of the trained weights is the one thing this module refuses to
 * support: it would be reading a joint requirement out of licences that cannot
 * jointly hold (see the header, "WHOSE obligations, and over WHAT"), and
 * `weightInheritanceOverclaimIn` refuses the sentence that states it.
 */
export function corpusLicenseObligations(
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
 * corpus must carry. A `commercialUse: true` declaration over an `NC` source
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
 * `benchmark/preregistration-v4.json` is the authority (`labelBasis.allowed`) and
 * `benchmark/preregistration-v4.ts` types it, so this module re-exports the type
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
  /**
   * The dependence axes this source CAN fill, declared by the source rather than
   * discovered from its records.
   *
   * It exists so the audit can compare a declaration against what a record-line
   * actually filled: C3 calls `assertDeclaredAxesResolved`
   * (benchmark/schema.ts) with this list, and a record that leaves a declared
   * axis `unknown` fails, as does one that states `notApplicable` and thereby
   * contradicts its own source. Without the declaration there is nothing to
   * compare against, and "every axis this record happens to have filled" is
   * trivially satisfied — which is how the v2 corpus passed its leakage audit
   * with eight axes of singletons.
   *
   * The lists come from the plan's fixed mapping, and each names a real unit of
   * the source rather than a convenient one: a Stack Overflow answer belongs to a
   * THREAD and to an account; a Wikipedia article belongs to a PAGE and to no
   * single author (it is collectively written, so `author` is legitimately
   * `notApplicable` on those records and is deliberately NOT declared here); a
   * B2W review belongs to a PRODUCT and to a reviewer; a Carolina text belongs to
   * a MEMBER FILE of the package, whose own authorship the TEI header does not
   * give per document.
   *
   * `sourceMaterialBatch` is declared by EVERY human source, and what the declaration
   * adds is narrower than "the axis's teeth" — say which refusal belongs to whom, or
   * the next reader will trust the wrong one. The axis is not a split-union axis (one
   * acquisition event per source would make each quota cell one indivisible component),
   * so nothing in the PARTITIONING notices a missing material batch. Of the two
   * refusals that do:
   *
   *   * on a HUMAN row the state table admits only `known`, so `unknown` there is a
   *     VALIDATOR error and the declaration adds nothing to it; and a batch that names
   *     no declared lot is refused by `auditCorpusSources` against `materialBatches`,
   *     which is also not this list;
   *   * what THIS declaration reaches is the one cohort whose acquisition event may
   *     legitimately be `unknown` — `mixed-ecological`, an observed coauthored document
   *     — plus a row of any cohort that has no such key at all. Both pass the validator
   *     and both leave the dependence BETWEEN acquisitions unnamed, and the audit is the
   *     only stage that refuses them.
   *
   * An axis a record's own schema version does not HAVE is not a gap: v2 and v3
   * records have no `sourceMaterialBatch` key at all, so the audit asks whether the
   * RECORD'S VERSION declares the axis before reading its state, which separates "this
   * row did not answer" from "this version was never asked".
   */
  declaredGroupAxes: readonly GroupAxis[];
}

/** Why a human source is not admissible. Each reason is a distinct diagnosis. */
export type HumanSourceBlockReason =
  | "access-terms-unresolved"
  | "individual-acquisition"
  | "no-public-license"
  | "non-public-base-license"
  | "no-declared-group-axis"
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
 *   4. then `no-declared-group-axis`: a source that declares no applicable
 *      dependence axis cannot support a blocked split at all.
 *   5. then the label basis, and only for a `date-cutoff` basis the field the
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
  // Step 1.5: the BASE itself is refused, whatever its licence or publication
  // regime. Below the route because the route is the more general statement — B3
  // refuses `recruited-donor` for every source, while this refuses one base — and
  // above the licence because a base that may not be used at all cannot be admitted
  // by what its clauses permit. Reporting the licence here would name a reason a
  // caller could satisfy: the Stack Exchange dump really is `cc-by-sa-4.0` and
  // really is a published base, and neither fact lifts the block.
  //
  // Distinct from `snapshot-not-frozen`, which lives in
  // `assertV3HumanInventoryAdmissible` and means only "this corpus does not stock
  // it". That one has to stay out of admissibility so a public instrumented base
  // can be admissible while being absent from v3. This one belongs HERE, because
  // the source is not allowed to exist as a source at all until the access terms
  // get a verifiable legal disposition.
  if (
    PREREGISTRATION_V4.humanSources.blockedSnapshots.some(
      (blocked) => blocked.snapshot === registration.snapshot,
    )
  ) {
    return refuse("access-terms-unresolved");
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
  // Step 3.5: a source that declares NO applicable axis cannot support any
  // grouping, so every record drawn from it is a component of one and the blocked
  // split degenerates. That is not a hypothetical — it is the state the v2 corpus
  // was in, with `leakages: []` reported over eight axes of singletons. It sits
  // after the licence because a source that cannot enter at all has nothing to
  // group, and before the label basis because it is a fact about the source's
  // structure rather than about the evidence for its label.
  if (registration.declaredGroupAxes.length === 0) {
    return refuse("no-declared-group-axis", licence.obligations);
  }
  if (labelBasis === null) {
    return refuse("label-basis-undeclared", licence.obligations);
  }
  // Membership is checked against the frozen list rather than against this
  // module's own type, so a policy that stops allowing a basis takes effect here
  // without an edit, and a value smuggled past the type is still refused.
  if (!PREREGISTRATION_V4.labelBasis.allowed.includes(labelBasis)) {
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
 * The human source A1 refused, kept with its declaration intact.
 *
 * It is here and not deleted for a reason the split audit makes concrete: the
 * working tree still holds records under `src_ptso`, and an audit that no longer
 * knows the source goes SILENT on them instead of failing. A registration the
 * module can still see is a registration `humanSourceAdmissibility` can still
 * refuse, by name and with a diagnosis.
 *
 * Keeping the anchor field and the axes is also what makes A1 cheap to revert: if
 * the access terms ever get a verifiable legal disposition, the source returns by
 * moving this entry back and dropping the blocked row from the frozen policy — not
 * by rediscovering that a Stack Exchange answer belongs to a thread and an account.
 *
 * It is deliberately NOT part of {@link V3_HUMAN_SOURCE_INVENTORY}:
 * `assertV3HumanInventoryAdmissible` throws on the first inadmissible entry, so a
 * blocked source inside that list would make the whole inventory unusable rather
 * than make one source refused.
 */
export const A1_BLOCKED_HUMAN_SOURCES: readonly HumanSourceRegistrationV1[] = [
  {
    sourceId: "src_ptso",
    snapshot: "pt-stackoverflow",
    acquisition: "public-dataset",
    licenseId: "cc-by-sa-4.0",
    labelBasis: "date-cutoff",
    anchorDateField: "Posts.xml@CreationDate",
    anchorDateScope: "document",
    // An answer belongs to a THREAD and to an account, and the dump it was read
    // out of is one acquisition event.
    declaredGroupAxes: ["author", "source", "sourceMaterialBatch"],
  },
];

/**
 * The human sources v3 stocks, one per frozen snapshot, with the field each
 * extractor actually reads the date from. Every anchor field below was read out
 * of the extractor that uses it, not inferred from the format:
 *
 *   * `ptwiki` — `<revision><timestamp>` of the page
 *     (`benchmark/lab/extract_wikipedia.py`). Document-level, and bounded above
 *     by the dump: `pages-articles` carries only the current revision, so a
 *     recent dump drops everything instead of admitting recent text — the
 *     failure is closed, which is why the field still qualifies.
 *
 * `b2w-reviews01` and `carolina` are NOT here: product review and the three Carolina
 * typologies are outside the declared frame, so they sit in
 * {@link OUT_OF_FRAME_HUMAN_SOURCES} with the reason rather than being deleted.
 *
 * It sustains `date-cutoff` and not `observed-process`: no published instrumented
 * pt-BR base of the required size exists, and inventing one would be inventing
 * provenance (R4). That is a limitation of this inventory, recorded in
 * `docs/limitations.md`, not a property of the field.
 *
 * BOTH keys here are join keys, and both are pinned by test. `snapshot` joins to
 * `PREREGISTRATION_V4.humanSources.snapshots` (asserted set-equal). `sourceId`
 * joins to the `sourceId` of the reviewed source manifest, and these values
 * are the ones the manifests an operator actually holds use —
 * `src_wikipedia_pt`, plus the out-of-frame `src_carolina` and `src_b2w` in
 * {@link OUT_OF_FRAME_HUMAN_SOURCES} and the refused `src_ptso` in
 * {@link A1_BLOCKED_HUMAN_SOURCES}, in
 * `benchmark/data/corpus-build/**\/private/source-manifest.json`. That file is a
 * gitignored build artifact, so no test can read it; the ids are pinned as
 * literals by "declares the sourceId a reviewed manifest joins on" instead, and a
 * rename on either side has to move both.
 */
export const V3_HUMAN_SOURCE_INVENTORY: readonly HumanSourceRegistrationV1[] = [
  {
    sourceId: "src_wikipedia_pt",
    snapshot: "ptwiki",
    acquisition: "public-dataset",
    licenseId: "cc-by-sa-4.0",
    labelBasis: "date-cutoff",
    anchorDateField: "page/revision/timestamp",
    anchorDateScope: "document",
    // An article belongs to a PAGE and to no single author: collectively
    // written, so `author` is legitimately notApplicable on those records. One
    // dump is one acquisition event.
    declaredGroupAxes: ["source", "sourceMaterialBatch"],
  },
];

/**
 * A human source whose route and licence are admissible and whose SNAPSHOT is
 * outside the declared frame.
 *
 * Held apart from both other lists because the reason is a third one. `src_ptso` in
 * {@link A1_BLOCKED_HUMAN_SOURCES} is refused on access terms — a legal condition
 * that could be satisfied. The two here are not refused at all: product review and the
 * three Carolina typologies are simply not the cell the claim is published over
 * (`preRegistration.quotaAxis.cells`), so there is no cell for their records to carry
 * a quota in and `humanSources.snapshots` does not stock their bases.
 *
 * WHY `src_carolina` is here, measured over the package on 2026-08-05 (headers only,
 * never a document body): the three typologies the frame used to draw on are
 * SINGLE-INSTITUTION corpora — judicial branch is 5 hosts, all `*.stf.jus.br`;
 * university domains is `jornal.usp.br` alone; social media is `wattpad.com` alone —
 * and no document declares an author. So "FPR in judicial text" read off the STF, or
 * "in university-domain text" read off one newspaper, names a population the material
 * does not sample, and the count of independent units is not merely small: between one
 * (the institution) and 38 187 (the documents) the package offers no basis to choose.
 * A frame cell whose independence cannot be established at the scale the interval
 * assumes is not a narrower claim, it is an unsupported one. No `n` repairs it.
 *
 * Declared rather than deleted, for the reason `blockedSnapshots` gives: a source
 * that leaves by being erased leaves no trace, and re-admitting it becomes a one-line
 * edit that works instead of a decision that has to name the cell it would add. Both
 * keep their anchor field and axes, so re-admission costs an amendment and not a
 * rediscovery of how to read the material.
 */
export const OUT_OF_FRAME_HUMAN_SOURCES: readonly HumanSourceRegistrationV1[] =
  [
    {
      sourceId: "src_b2w",
      snapshot: "b2w-reviews01",
      acquisition: "public-dataset",
      licenseId: "cc-by-nc-sa-4.0",
      labelBasis: "date-cutoff",
      anchorDateField: "submission_date",
      anchorDateScope: "document",
      // A review belongs to a PRODUCT and to a reviewer; the CSV release it was read
      // out of is one acquisition event.
      declaredGroupAxes: ["author", "source", "sourceMaterialBatch"],
    },
    {
      sourceId: "src_carolina",
      snapshot: "carolina",
      acquisition: "public-dataset",
      licenseId: "cc-by-nc-sa-4.0",
      labelBasis: "date-cutoff",
      anchorDateField: 'teiHeader//date[@type="Download"]',
      anchorDateScope: "document",
      // A text belongs to a MEMBER FILE of the package; the TEI header gives no
      // per-document authorship, so `author` is not declared. The typologies inside
      // one package are partitions of a SINGLE acquisition, not separate ones.
      declaredGroupAxes: ["source", "sourceMaterialBatch"],
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
  const frozen = PREREGISTRATION_V4.humanSources.snapshots;
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
// Unicode word edges, NOT `\b`. `\b` in JavaScript is ASCII-only, so it sees a boundary
// between `sem` and `â` — which means `sem` matched inside `semântica`, and every screen
// reading this pattern treated "independência semântica" as containing a denial. The word
// is central to this domain, so the blind spot sat exactly where it mattered: the sentence
// asserting that very property was read as its own denial and returned null. The same
// ASCII `\b` had already broken a lookahead after `é` one round earlier; two failures from
// one cause is why every edge here is explicit now.
//
// This pattern is shared with `humanLabelOverclaimIn` and `reviewOverclaimIn`, so the fix
// reaches two sealed-path screens that were blind the same way. That is NOT the same thing
// as open finding 1, which is about those two screens refusing correct denials that use
// `nenhum`/`nenhuma` — a separate defect, still open, and untouched by this.
const WORD_EDGE_BEFORE = "(?<![\\p{L}\\p{N}])";
const WORD_EDGE_AFTER = "(?![\\p{L}\\p{N}])";
const HUMAN_LABEL_DENIAL = new RegExp(
  `${WORD_EDGE_BEFORE}(?:n[ãa]o|nunca|nem|jamais|sem)${WORD_EDGE_AFTER}`,
  "iu",
);
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

// --- the over-claim screen for the review receipt (C5) ---------------------
//
// The SAME defect as the human label's, one governance level up, and the reason it
// needs its own screen is that C5 removed the claim from the DATA and prose is the
// other place a removed claim comes back. Ten thousand records asserted a
// two-reviewer concordance and a cleared personal-data audit that never happened;
// `benchmark/schema.ts` makes the record-level assertion unwritable and
// `benchmark/lab/assemble_corpus.py` no longer mints one, so what is left is a
// sentence in a document saying the corpus was reviewed. A reader believes the
// sentence exactly as much as they believed the field.
//
// It reuses {@link HUMAN_LABEL_CLAIM} and {@link HUMAN_LABEL_DENIAL} rather than
// respelling them: the verbs that turn a mitigation into a proof are the same verbs,
// and two copies of that list would drift. Only the SUBJECT changes.
//
// WHAT IT DELIBERATELY DOES NOT FIRE ON, because the project must keep saying it:
// the protocols DESCRIBE a review in the present tense ("cada registro passa por
// revisão manual", "o revisor inspeciona os candidatos"), and a description of what
// a protocol requires is not a claim that it ran. So a violation still needs three
// things in one clause — a review subject, a claim verb, and no denial in front of
// it — plus one extra pattern for the past-tense assertion that the work is DONE
// ("todo registro foi revisado", "cada registro foi auditado"), which is the exact
// sentence the corpus's own fabricated field made true-looking.
const REVIEW_SUBJECT =
  /\brevis[ãa]o\s+(?:humana|manual|dupla|independente)\b|\bdois\s+revisores\b|\brevisores\s+(?:independentes|humanos)\b|\bconcord[âa]ncia\s+entre\s+(?:os\s+)?revisores\b|\baudit(?:oria|ado|ada)\s+de\s+(?:PII|dados\s+pessoais)\b|\bauditoria\s+humana\b/iu;

// The past-tense assertion that the review HAPPENED over the corpus. Narrow on
// purpose: it requires a corpus-wide quantifier and the passive of one of the two
// acts, so "o protocolo exige que cada registro seja revisado" (subjunctive, a
// requirement) and "o revisor inspeciona" (present, a description) both survive.
const REVIEW_DONE_CLAIM =
  /\b(?:todos?\s+os\s+registros|cada\s+registro|todo\s+registro|os\s+10\.?000\s+registros)\s+(?:j[áa]\s+)?(?:foi|foram)\s+(?:revisad[oa]s?|auditad[oa]s?)\b/giu;

/**
 * The first forbidden claim that the corpus WAS humanly reviewed or PII-audited, or
 * `null` when the text makes none. Same return shape as
 * {@link humanLabelOverclaimIn}: the claim and its clause, so a failing screen names
 * what fired and where.
 */
export function reviewOverclaimIn(text: string): string | null {
  const unwrapped = unwrapSoftLines(text);
  for (const clause of unwrapped.split(CLAUSE_BOUNDARY)) {
    for (const match of clause.matchAll(REVIEW_DONE_CLAIM)) {
      const before = clause.slice(
        Math.max(0, match.index - DENIAL_WINDOW),
        match.index,
      );
      if (HUMAN_LABEL_DENIAL.test(before)) continue;
      return `${match[0]} @ ${clause.trim().slice(0, 160)}`;
    }
    if (!REVIEW_SUBJECT.test(clause)) continue;
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

// --- the over-claim screen for the weights' licence (position (a)) ----------
//
// The THIRD screen, same machinery, one subject over. The claim was removed from
// the DATA — `license-review.json` no longer publishes a union of source
// obligations as the artifact's own, and the module no longer computes one — and
// prose is the other place a removed claim comes back. The sentence it refuses is
// "the weights inherit the obligations of the source licences", in either
// direction: inherited FROM the sources, or propagated ON to a derivative.
//
// Why the sentence is the thing to refuse and not merely a wording slip: it is a
// legal claim the project cannot make. Under it the model owes `NC` and owes not
// adding `NC` at the same time, so a reader who believes the sentence cannot
// comply with it, and a downstream user who relies on it inherits a defect they
// have no way to detect. It is also the sentence the repository shipped: it stood
// in `models/cleanfeed-ptbr-v1/NOTICE.md`, the file that travels with the weights.
//
// It reuses {@link unwrapSoftLines}, {@link CLAUSE_BOUNDARY} and
// {@link HUMAN_LABEL_DENIAL} for the same reason `reviewOverclaimIn` does: prose
// in `docs/` wraps at about 80 columns, a denial is not a claim, and three copies
// of that logic would drift. What it does NOT reuse is `HUMAN_LABEL_CLAIM` — the
// verbs that turn a mitigation into a proof ("prova", "garante") are not the verbs
// that transfer an obligation ("herda", "propaga", "se estende a").
//
// WHAT IT DELIBERATELY DOES NOT FIRE ON, because the project must keep saying it:
//   * the DENIAL, which is now the project's own position — "as obrigações das
//     fontes NÃO se propagam aos pesos", "os pesos não herdam a licença";
//   * inheritance predicated of the CORPUS, which is true and required — "o
//     corpus herda as obrigações das fontes";
//   * the BASE MODEL's licence, which really does travel with the weights:
//     BERTimbau is MIT and saying so is provenance, not propagation.
// So a violation needs a weights subject, a propagation verb, and no denial in
// front of it, inside one clause.

// The subject: the model, its weights, the artifact. `artefato` is included
// because that is the word the removed `artifactObligations` field used, and it is
// how the claim came back the last time it was removed.
//
// `derivado` is deliberately NOT a subject here, although the forbidden sentence
// ends in "propaga para qualquer derivado". A DERIVED CORPUS really does inherit
// the source obligations, the documents say so in those words, and a screen that
// fired on "o corpus derivado herda as obrigações" would refuse a true sentence.
// The propagation-to-a-derivative claim is still caught, because the clause that
// makes it names the artifact as the thing propagating.
const WEIGHT_SUBJECT =
  /\bpesos?\b|\bmodelo\b|\bartefato\b|\bcheckpoints?\b|\bdetector\b|\bclassificador\b/iu;

// `alcança`/`alcançam` and `recai`/`recaem` are in this list because they are the
// verbs the shipped NOTICE and the weights licence use to STATE the position — "as
// obrigações [...] NÃO alcançam o artefato treinado". A screen that does not carry
// the project's own wording goes silent the moment someone deletes one `não` from
// the sentence it was written to guard.
//
// The propagation verbs, written out rather than stemmed. `herd\w*` would fire on
// "herdeiro" and `propag\w*` on "propagação de erro", and inflection in Portuguese
// is regular enough to list.
const WEIGHT_INHERITANCE_CLAIM =
  /\b(?:herda|herdam|herdar|herdada|herdadas|herdado|herdados|propaga|propagam|propagar|propagada|propagadas|propagado|propagados|propaga[çc][ãa]o|transfere|transferem|transferir|transferida|transferidas|transferido|transferidos|estende|estendem|estender|estendida|estendidas|estendido|estendidos|vincula|vinculam|vincular|vinculada|vinculadas|vinculado|vinculados|sujeit[oa]s?|submetid[oa]s?|alcan[çc]a|alcan[çc]am|alcan[çc]ar|recai|recaem|recair|recebe|recebem|recebeu|receber|herdam-se|passam\s+a\s+valer|aplicam-se|aplica-se|valem\s+para|vale\s+para)\b/giu;

// The object that makes it a licence claim rather than any other transfer: an
// obligation, a licence, or one of the three clause names. Without it "o modelo
// herda o vocabulário do tokenizer" would fire, which is a sentence about
// tokenizers.
const LICENCE_OBJECT =
  /\bobriga[çc][õo]es?\b|\blicen[çc]as?\b|\bcopyleft\b|\bshare-?alike\b|\bn[ãa]o\s+comercial\b|\batribui[çc][ãa]o\b|\bcl[áa]usulas?\b|\bNC\b|\bSA\b/iu;

// WHERE the obligation is claimed to come from. Required, and this is the guard
// that keeps the screen from refusing a sentence the weights licence has to make.
//
// `cleanfeed-weights-nc-1.0` is an OpenRAIL-M-shaped instrument: its use
// restrictions bind downstream recipients and it says so, because a restriction
// that stops at the first recipient restricts nothing. That sentence has a weights
// subject, a propagation verb and a licence object — every ingredient of the
// forbidden claim — and it is correct. What makes the forbidden claim forbidden is
// the SOURCE as the origin: the obligation arriving from the training corpus. So
// the origin has to be named in the clause for the screen to fire, and "estas
// restrições acompanham qualquer derivado destes pesos" passes while "os pesos
// herdam as obrigações das fontes" does not.
// Contrast markers, local to the weights screen. Each starts a second statement with a
// subject of its own, which is what lets the project state the distinction in one
// sentence without the screen reading the halves as a single claim.
//
// `, e não X,` is deliberately NOT here, although it looks like the same thing. It is an
// appositive negation INSIDE one clause — "os pesos, e não o corpus, herdam as
// obrigações" is a single assertion about the weights, and splitting on it gave two
// harmless halves and let the claim through. That case belongs to
// {@link propagationIsDenied}, which truncates the denial window at the comma instead.
const CONTRAST_BOUNDARY =
  /\b(?:enquanto|ao\s+passo\s+que|j[áa]\s+(?:o|a|os|as))\b/iu;

const SOURCE_REFERENT =
  /\bfontes?\b|\bcorpus\b|\bdados\s+de\s+treino\b|\bconjunto\s+de\s+(?:treino|dados)\b|\bcc-by\b|\bodc-by\b|\blei9610\b|\bcarolina\b|\bwikip[ée]dia\b|\bb2w\b|\bstack\s*exchange\b|\bbases?\b|\bsnapshots?\b/iu;

// The denial, widened over {@link HUMAN_LABEL_DENIAL} by exactly two words: `nenhum` and
// `nenhuma`. Both of the newest screens use it, which is why it is one constant.
//
// NOT `nada`. That word was in this pattern, then in a screen-local variant of it, and is
// now in no screen at all — see {@link INDEPENDENCE_DENIAL}. Worth stating plainly because
// this comment went on describing the previous position for a round after the code had
// moved: the weights screen needs `nenhum`/`nenhuma` because the project's own position is
// written as "NENHUMA obrigação de licença de fonte é transferida ao modelo", and the
// independence screen writes its denial with `não` for exactly the reason `nada` was
// dropped.
//
// It is widened HERE and not in `HUMAN_LABEL_DENIAL` on purpose, and open finding 1 is
// still what that leaves behind: the two OLDER screens do not carry `nenhum`/`nenhuma`, so
// "nenhuma evidência prova a autoria humana" still reads as an over-claim to them. That is
// a real defect in sealed-path functions neither of these tasks was asked to change, and it
// is NOT what the Unicode word edges below fixed — those fixed a different blindness in the
// same two screens.
const WIDENED_DENIAL = new RegExp(
  `${WORD_EDGE_BEFORE}(?:n[ãa]o|nunca|nem|jamais|sem|nenhum|nenhuma)${WORD_EDGE_AFTER}`,
  "iu",
);

// `nada` is in NEITHER screen, and it took three positions to get there — recorded as the
// lesson rather than the conclusion. It was added because a denial the shared pattern
// refused begins with it. It was then split out of the weights screen, because a sentence
// of the form "Nada muda o fato de que os pesos herdam…" is a CLAIM the shared pattern let
// through. The cross-review then produced the same shape for the independence screen, and
// that settled it: `nada` is the subject of whatever verb follows it, so it negates in one
// sentence and reinforces in the next. A marker that cannot be told apart without parsing
// belongs in no lexical screen. The project writes its denials with `não`, which costs
// nothing.
//
// So this is an alias, not a wider pattern. It is kept as a NAME because the independence
// screen reads better saying what it denies, and because a future round that does need a
// different denial there has an obvious place to put it.
const INDEPENDENCE_DENIAL = WIDENED_DENIAL;

/**
 * Is the propagation verb at `index` denied by something in front of it?
 *
 * The window is the same 40 characters the other two screens use, TRUNCATED at the
 * last comma. The truncation is what tells a denial of the verb apart from a
 * denial of an appositive: in "os pesos, e não o corpus, herdam as obrigações" the
 * `não` negates `o corpus`, the verb is asserted, and a plain 40-character window
 * reads the sentence as its own denial and lets the claim through. Cutting at the
 * comma leaves an empty window there, so the claim fires.
 *
 * The two older screens have the same blind spot and it is not fixed here, for the
 * reason given on {@link WIDENED_DENIAL}: they are sealed-path functions this task
 * was not asked to change.
 */
function propagationIsDenied(clause: string, index: number): boolean {
  const window = clause.slice(Math.max(0, index - DENIAL_WINDOW), index);
  const lastComma = window.lastIndexOf(",");
  return WIDENED_DENIAL.test(
    lastComma === -1 ? window : window.slice(lastComma + 1),
  );
}

/**
 * The first forbidden claim that the WEIGHTS inherit or propagate the source
 * licences' obligations, or `null` when the text makes none. Same return shape as
 * {@link humanLabelOverclaimIn}: the claim and its clause, so a failing screen
 * names what fired and where.
 */
export function weightInheritanceOverclaimIn(text: string): string | null {
  for (const sentence of unwrapSoftLines(text).split(CLAUSE_BOUNDARY)) {
    // A contrast marker starts a second statement, and this screen splits on it where
    // the other two do not. The sentence that forced it is the correct one: "a licença
    // própria vincula os pesos, ENQUANTO as licenças das fontes vinculam o corpus" —
    // one sentence, two subjects, two predicates, and exactly the distinction position
    // (a) exists to draw. Judged whole it carries a weights subject, a licence object,
    // a source referent and a binding verb, so lexical co-occurrence refuses the
    // clearest true statement anyone would write. Split on the contrast and each half
    // is judged against its own subject.
    for (const clause of sentence.split(CONTRAST_BOUNDARY)) {
      // A weights subject is required, which is also what lets the true statement
      // through: "o corpus herda as obrigações das fontes" names no weights subject
      // and never reaches the verbs.
      if (!WEIGHT_SUBJECT.test(clause)) continue;
      if (!LICENCE_OBJECT.test(clause)) continue;
      if (!SOURCE_REFERENT.test(clause)) continue;
      for (const match of clause.matchAll(WEIGHT_INHERITANCE_CLAIM)) {
        if (propagationIsDenied(clause, match.index)) continue;
        return `${match[0]} @ ${clause.trim().slice(0, 160)}`;
      }
    }
  }
  return null;
}

// --- the over-claim screen for corpus/training independence (R7) ------------
//
// The FOURTH screen, and the subject furthest from licences, which is why it earns a
// note about why it lives here: the machinery is here (`unwrapSoftLines`,
// `CLAUSE_BOUNDARY`, the denial window), the other three screens are here, and a
// governance claim the project has forbidden itself is the same kind of object
// wherever its subject comes from.
//
// What it refuses is the sentence that the sealed corpus is INDEPENDENT of the
// detector's training set. What the pipeline actually proves is narrower and is
// stated as a contract in `benchmark/lab/near_dupes.py` (`drop_seen`): no exact
// tokenized-content duplicate and nothing reaching Jaccard >= 0.82 over 5-token
// shingles, measured against `train.jsonl` + `dev.jsonl`. Two texts can share a
// subject, cite the same source, or paraphrase one another and clear that bar
// comfortably. Semantic independence is not measured here and is not measured
// anywhere in this repository.
//
// The documents were already correct when this screen was added — the runbook says
// "não é independência semântica" in as many words. That is exactly the reason to add
// it: prose that is right today is one careless edit from being a claim, and the plan
// says this one may NEVER be made, not that it is currently absent.
//
// SHAPE. A violation needs TWO things in one clause and no denial anywhere in it: an
// independence predicate and a TRAINING referent. The training referent is what keeps
// "não é independência semântica" out of range — that clause names no training set, so
// it never reaches the predicate test.
//
// It asked for a corpus subject too, until the cross-review showed that requirement
// creating a false negative through a conjunction. See the notes on
// {@link CONJUNCTION_BOUNDARY} and {@link INDEPENDENCE_PREDICATE}.
//
// WHY THE PREDICATE LIST IS SHORT. Only `independente`/`independência`/`disjunto`,
// and deliberately not `limpo` or `não visto`. `limpo` appears in a sentence the
// runbook must keep — "um corpus limpo contra um treino não é limpo contra outro" —
// and `não visto` states the property THROUGH a negation, so the denial window would
// read the claim as its own denial. A screen that fires on the first and is blind to
// the second would be worse than the narrow one: it would refuse a true sentence
// while missing a false one.
// `, mas` is here for the same reason `e é` is: the cross-review's "O corpus não contém
// duplicatas, MAS é independente do treino" put the denial in the first half and the claim
// in the second, and a whole-clause denial test reads the first half as covering both.
//
// A conjunction that starts a SECOND PREDICATION, and this screen splits on it where the
// other three do not. The cross-review's false negative is why: "O corpus não contém
// duplicatas E é independente do treino" carries a denial that belongs to the FIRST half,
// and judged whole the clause looks like its own denial. Split there and the second half
// — "é independente do treino" — stands alone with nothing denying it.
//
// The lookahead for a copula is load-bearing and was not in the first attempt. Splitting
// on every `e` broke the opposite case immediately: "prova a independência entre o corpus
// E o treino" is ONE predication whose subject list happens to be coordinated, and
// cutting it left "…entre o corpus" (predicate, no training referent) beside "o treino"
// (referent, no predicate), so the clearest form of the forbidden claim stopped firing.
// Requiring a copula after the `e` distinguishes a new predication from a coordinated
// noun: "e é", "e são", "e permanece" open a claim; "e o treino" continues a list.
// `(?=\s)` and NOT `\b`, and this cost a false claim in a report: `\b` in JavaScript is
// ASCII-only, so it does not match after `é`. The lookahead `(?:é|…)\b` therefore failed
// on the exact string it was written for — "e é independente" — and the boundary never
// fired. The 11-case check that "passed" had been run against the previous, wider
// boundary and was never re-run after this pattern replaced it.
const CONJUNCTION_BOUNDARY =
  /\s+(?:e|mas|por[ée]m|todavia|contudo|entretanto)\s+(?=(?:é|s[ãa]o|est[áa]|est[ãa]o|foi|foram|permanece|permanecem|continua|continuam)(?=\s))|\s*[;,]\s*(?:mas|por[ée]m|todavia|contudo|entretanto)\s+|\s*;\s*/iu;

// PREDICATIVE position only, plus the two nouns. Dropping the corpus-subject requirement
// in an earlier round left `independentes` firing attributively, and the cross-review
// found the sentence that matters: "No treinamento, dois revisores INDEPENDENTES avaliam
// cada registro" — where the adjective qualifies the reviewers and the training referent
// is incidental. Requiring a copula in front distinguishes "o corpus É independente"
// (a claim) from "revisores independentes" (a description), which is the distinction the
// corpus-subject test was reaching for without getting.
//
// The nouns `independência` and `disjunção` need no copula: naming the property IS the
// claim, and "prova a independência entre o corpus e o treino" carries no copula at all.
const INDEPENDENCE_PREDICATE =
  /(?:é|s[ãa]o|est[áa]|est[ãa]o|permanece|permanecem|continua|continuam|fica|ficam|seria|seriam)\s+(?:mutuamente\s+)?(?:independentes?|disjunt[oa]s?)\b|\bindepend[êe]ncia\b|\bdisjun[çc][ãa]o\b/iu;

// No corpus subject is required, and dropping that requirement is what closes the
// cross-review's false negative. A clause pairing an independence predicate with a
// TRAINING referent is specific enough on its own — "é independente do treino" is the
// forbidden claim whether or not its subject survived the clause split — and requiring
// the subject meant a conjunction could strand it in the other half. The training
// referent is doing the discriminating work: it is what keeps "dois revisores
// independentes" and "componentes conectados independentes" out of range.

const TRAINING_REFERENT =
  /\btreino\b|\btreinamento\b|\btreinou\b|\btreinad[oa]s?\b|\btrain\b|\btrain\.jsonl\b|\bdev\.jsonl\b|\bfine-?tune\b/iu;

/**
 * The first forbidden claim that the corpus is independent of the training set, or
 * `null` when the text makes none. Same return shape as the other three screens: the
 * claim and its clause, so a failing screen names what fired and where.
 *
 * It uses {@link WIDENED_DENIAL} — which is what {@link INDEPENDENCE_DENIAL} aliases —
 * rather than the shared `HUMAN_LABEL_DENIAL`, because the denials this project writes
 * use `nenhum`/`nenhuma` and the shared pattern reads those as the claim.
 *
 * This paragraph justified the choice with a sentence beginning `nada` for two rounds
 * after that word had been removed from every screen. Kept as a note because it is the
 * same failure the screens exist to catch, one level up: prose that outlives the decision
 * it describes.
 */
export function trainingIndependenceOverclaimIn(text: string): string | null {
  // No exemption for quoted text, and the second cross-review round is why one was
  // tried and withdrawn. Blanking double-quoted spans looked like "a citation is
  // attributed, not asserted", and it is not: `A garantia publicada é: "O corpus é
  // independente do treino"` passed the screen while asserting exactly the claim. There
  // is no lexical test that separates auditing a sentence from making it, so the screen
  // stays severe and the DOCUMENT adapts — the audit in
  // `docs/detector-rebuild-assessment.md` now names the claim without putting predicate
  // and training referent in one clause.
  for (const sentence of unwrapSoftLines(text).split(CLAUSE_BOUNDARY)) {
    for (const clause of sentence.split(CONJUNCTION_BOUNDARY)) {
      if (!INDEPENDENCE_PREDICATE.test(clause)) continue;
      if (!TRAINING_REFERENT.test(clause)) continue;
      // The denial is looked for across the WHOLE clause, not in a window before the
      // predicate. The cross-review's false positive is why: "A independência semântica
      // entre o corpus e o treino não é medida aqui" puts the predicate first and the
      // denial last, so a backward window sees nothing and refuses a sentence the
      // project must be able to write. Portuguese puts the negation on the verb, and the
      // verb can sit on either side of the noun being denied.
      if (INDEPENDENCE_DENIAL.test(clause)) continue;
      const match = INDEPENDENCE_PREDICATE.exec(clause);
      if (match === null) continue;
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
  "materialBatches",
  "sourceManifestDigest",
] as const;
// No esquema v1 `materialBatches` e ADMITIDA e nao EXIGIDA: um manifesto v1 que nao declara lote
// continua valido, e o digest dele continua o mesmo. A distincao entre as duas listas e o que
// permite acrescentar o inventario sem reescrever o inventario v3 congelado. No v2 a chave e
// exigida, e la a lista exigida e `MANIFEST_KEYS` inteira.
const MANIFEST_REQUIRED_KEYS = MANIFEST_KEYS.filter(
  (key) => key !== "materialBatches",
);
const MATERIAL_BATCH_KEYS = [
  "batchId",
  "sourceId",
  "materialVersion",
  "acquisitionWindow",
  "evidence",
] as const;
const ACQUISITION_WINDOW_KEYS = ["startedAt", "endedAt"] as const;
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
  "temperatureNullReason",
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
  const generatedAt = finiteNumber(
    obj.generatedAt,
    `batch ${batchId} generatedAt`,
  );

  // Exactly one of `temperature` and a non-empty `temperatureNullReason` is
  // present — the same shape as the seed pair below, deliberately written the same
  // way. The presence test reads null/undefined and NOT falsiness, because `0` is a
  // legitimate applied temperature (a deliberate greedy decode, and one of the
  // frozen sweep values); treating it as an absence would turn a real recipe into
  // "the lane has no knob".
  const hasTemperature =
    obj.temperature !== null && obj.temperature !== undefined;
  const hasTemperatureReason =
    obj.temperatureNullReason !== null &&
    obj.temperatureNullReason !== undefined;
  if (hasTemperature === hasTemperatureReason) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `batch ${batchId} must record exactly one of temperature or temperatureNullReason`,
    );
  }
  let temperature: number | null = null;
  let temperatureNullReason: string | null = null;
  if (hasTemperature) {
    temperature = finiteNumber(obj.temperature, `batch ${batchId} temperature`);
  } else {
    temperatureNullReason = nonEmptyString(
      obj.temperatureNullReason,
      `batch ${batchId} temperatureNullReason`,
    );
  }

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
    temperatureNullReason,
    generatedAt,
    seed,
    seedNullReason,
  };
}

function validateMaterialBatch(
  value: unknown,
  index: number,
  declaredSourceIds: ReadonlySet<string>,
): SourceMaterialBatchV1 {
  const obj = assertExactObject(
    value,
    `materialBatches[${index}]`,
    MATERIAL_BATCH_KEYS,
    MATERIAL_BATCH_KEYS,
  );
  const batchId = pseudonym(obj.batchId, `materialBatches[${index}].batchId`);
  const sourceId = pseudonym(
    obj.sourceId,
    `materialBatches[${index}].sourceId`,
  );
  if (!declaredSourceIds.has(sourceId)) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `material batch ${batchId} names sourceId "${sourceId}", which this manifest does not ` +
        "declare: a batch whose source is undeclared has no reviewed provenance",
    );
  }
  const materialVersion = nonEmptyString(
    obj.materialVersion,
    `material batch ${batchId} materialVersion`,
  );

  const window = assertExactObject(
    obj.acquisitionWindow,
    `material batch ${batchId} acquisitionWindow`,
    ACQUISITION_WINDOW_KEYS,
    ACQUISITION_WINDOW_KEYS,
  );
  const startedAt = finiteNumber(
    window.startedAt,
    `material batch ${batchId} acquisitionWindow.startedAt`,
  );
  const endedAt = finiteNumber(
    window.endedAt,
    `material batch ${batchId} acquisitionWindow.endedAt`,
  );
  if (endedAt < startedAt) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `material batch ${batchId} acquisitionWindow ends before it starts`,
    );
  }

  if (!Array.isArray(obj.evidence) || obj.evidence.length === 0) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      `material batch ${batchId} evidence must be a non-empty array`,
    );
  }
  const evidence = obj.evidence.map((item, position) =>
    nonEmptyString(item, `material batch ${batchId} evidence[${position}]`),
  );

  return {
    batchId,
    sourceId,
    materialVersion,
    acquisitionWindow: { startedAt, endedAt },
    evidence,
  };
}

/**
 * A projeção do corpo que o self-digest hasheia — o objeto inteiro, e nada além dele.
 *
 * Existe como função porque DOIS lados a consomem: o digest e a varredura de localizador. Com o
 * objeto escrito à mão nos dois, um campo novo entraria no digest sem entrar na varredura, e o
 * alcance da promessa passaria a ser alegação. Sendo o mesmo objeto, é fato: uma chave que entra
 * aqui nasce varrida, e uma chave que não entra aqui já é forjável por razão independente.
 */
export function reviewedSourceManifestProjection(
  body: ReviewedSourceManifestBody,
): Record<string, unknown> {
  return {
    schemaVersion: body.schemaVersion,
    sources: body.sources,
    generationBatches: body.generationBatches,
    // No v2 a chave entra SEMPRE, porque lá ela é obrigatória. No v1 ela entra só quando existe,
    // e as duas metades dessa condicional são necessárias: fora da projeção o inventário de lotes
    // nasceria FORJÁVEL, e dentro dela sem condição `canonicalJson` RECUSA `undefined` em vez de
    // omitir, então a chave presente com valor ausente derrubaria todo manifesto v1 que não
    // declara lote — inclusive o inventário v3 congelado, cujo digest é byte selado.
    ...(body.schemaVersion === 2
      ? { materialBatches: body.materialBatches }
      : body.materialBatches === undefined
        ? {}
        : { materialBatches: body.materialBatches }),
  };
}

/** SHA-256 (hex) of the canonical bytes of the manifest without its digest. */
export async function computeReviewedSourceManifestDigest(
  body: ReviewedSourceManifestBody,
): Promise<string> {
  return canonicalSha256(reviewedSourceManifestProjection(body));
}

/**
 * As cinco marcas de LOCALIZADOR ou de identidade contactável, cada uma com o seu diagnóstico.
 *
 * `authority`: por RFC 3986 §3.2 o `//` É a declaração de um componente de autoridade, então uma
 * regra sobre ele alcança `https://`, `ftp://`, `s3://`, `file://` e o relativo-de-esquema
 * `//host/path` sem lista de esquemas para manter em dia.
 * `host-path`: o mesmo localizador com o esquema arrancado, que é a evasão imediata da primeira
 * regra. Exige rótulo PONTUADO antes da barra, e é por isso que uma barra única de coordenada de
 * modelo (`meta-llama/Llama-3.1-8B`) não é localizador.
 * `handle` e `email` exigem que o `@` não seja precedido de letra/dígito/`_` e que o último rótulo
 * seja ALFABÉTICO, respectivamente: neste domínio `@` também é vocabulário de versão
 * (`gemini-cli@0.1.5`) e de rótulo de campo (`Posts.xml@CreationDate`), e uma regra sobre `@` cru
 * recusaria dado real.
 *
 * O que estas regras NÃO decidem, declarado aqui em vez de silenciado, e ACEITO por medição em
 * "documenta o resíduo que a guarda NÃO decide":
 *
 * 1. HOST NU, sem esquema e sem barra (`dumps.wikimedia.org`), e nome próprio cru ("João Silva"):
 *    indistinguíveis por FORMA de um nome de módulo (`common.py`) ou de prosa. Em `evidence` a
 *    whitelist de forma (`EVIDENCE_FORMS`) fecha a GRAFIA NUA — um host solto não é nenhuma das
 *    duas formas — e não a CLASSE: vestido de nome de arquivo, `dumps.wikimedia.org (10 bytes)` é
 *    evidência válida, como `JoaoSilva (100 bytes)` é. Separar host de nome de arquivo por forma
 *    pediria uma lista de TLD, que leria como completude sendo subconjunto. Nas outras folhas
 *    livres o resíduo é inteiro, e em todas ele permanece obrigação de revisão humana.
 * 2. ESQUEMA com autoridade malformada ou escapada: `https:/dumps.wikimedia.org` (barra única) e
 *    `https:%2F%2Fdumps.wikimedia.org%2Fptwiki` passam, porque nenhum tem `//` nem rótulo pontuado
 *    antes de uma barra. A regra que os pegaria é a do componente de ESQUEMA (RFC 3986 §3.1), e
 *    ela colidiria com `sha256:<hex>`, que é a grafia da evidência deste próprio módulo.
 */
const SOURCE_LOCATOR_MARKS: readonly (readonly [string, RegExp])[] = [
  ["authority", /\/\//u],
  ["www", /(?<![A-Za-z0-9])www\./iu],
  ["host-path", /[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\//u],
  ["handle", /(?<![A-Za-z0-9_])@[A-Za-z0-9._-]{2,}/u],
  [
    "email",
    /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/u,
  ],
];

/**
 * As duas formas de evidência que um terceiro recomputa, ANCORADAS.
 *
 * A ancoragem é carga e não estilo, nas DUAS formas e nas duas pontas: sem `$` um item como
 * `"sha256:70c9… (baixado de dumps.wikimedia.org)"` casa pelo prefixo, e sem `^` um item como
 * `"baixado de ptwiki.xml.bz2 (100 bytes)"` casa pelo sufixo. Em qualquer das quatro faltas a
 * whitelist decide apenas que o item CONTÉM uma das formas, e conter é o que a prosa com um digest
 * colado dentro já faz.
 *
 * A família de algoritmos é ABERTA (`[a-z0-9]+:`) e o hex é minúsculo, como `lowercaseSha256` já
 * exige no resto do módulo: um md5 ou blake3 futuro não deve obrigar a editar este arquivo, e um
 * digest em maiúscula não é a grafia que o módulo escreve.
 */
const EVIDENCE_FORMS: readonly RegExp[] = [
  /^[a-z0-9]+:[a-f0-9]{32,128}$/u,
  /^[A-Za-z0-9][A-Za-z0-9._-]* \([1-9][0-9]* bytes\)$/u,
];

function locatorMarkIn(value: string): string | null {
  for (const [mark, pattern] of SOURCE_LOCATOR_MARKS) {
    if (pattern.test(value)) return mark;
  }
  return null;
}

function assertLeavesCarryNoLocator(value: unknown, where: string): void {
  if (typeof value === "string") {
    const mark = locatorMarkIn(value);
    if (mark !== null) {
      fail(
        "SOURCE_MANIFEST_SOURCE_LOCATOR",
        `${where} carries a source locator (${mark}): ${value} — this manifest names its ` +
          "sources only by pseudonymised tokens and digests, and a locator is neither",
      );
    }
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((element, index) =>
      assertLeavesCarryNoLocator(element, `${where}[${index}]`),
    );
    return;
  }
  if (value !== null && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      assertLeavesCarryNoLocator(child, `${where}.${key}`);
    }
  }
}

/**
 * O eixo de VALOR da promessa do cabeçalho, imposto sobre a projeção INTEIRA.
 *
 * UMA operação e não duas, chamada em dois lugares e nunca em quatro: a varredura de localizador e
 * a whitelist de forma da evidência se compõem — a varredura tem dentes onde a forma é livre, e a
 * whitelist recusa a GRAFIA NUA do host, que a varredura não decide; a CLASSE não, e o resíduo está
 * declarado em `SOURCE_LOCATOR_MARKS` — e um chamador que recebesse duas funções chamaria uma e
 * esqueceria a outra.
 *
 * A varredura é RECURSIVA sobre a projeção e não uma chamada por campo, porque assim uma folha de
 * string nova nasce coberta; com uma chamada por campo, nasceria descoberta.
 *
 * O espelho de forma é `assertSanitized` (benchmark/evidence-sanitizer.ts) — varredura recursiva,
 * recusa por FORMA do valor, rótulo de caminho `$.a.b[0]` e erro codificado. Das TRÊS condições de
 * falha dele, duas NÃO são espelhadas e a decisão é esta: `FORBIDDEN_PATH` e `FORBIDDEN_ID_ARRAY`
 * guardam artefato PÚBLICO contra caminho de saída de execução e contra lista de ids de registro
 * disfarçada, e a promessa daqui é sobre LOCALIZADOR DA FONTE em um arquivo que nunca é publicado —
 * então `materialVersion: "private/source-manifest.json"` e uma `evidence` de 500 digests são
 * VÁLIDAS aqui (medido em "o espelho decide o que esta guarda não decide"): comprimento não diz
 * nada sobre localizador, e caminho de saída não é fonte. `FORBIDDEN_KEY` não é duplicada porque
 * `assertExactObject` já torna `url`/`author`/`text` inexpressáveis, uma segunda lista de chaves
 * criaria uma segunda autoridade sobre o conjunto de chaves, e `consentReceiptDigest` — que o
 * sanitizer proíbe — é chave LEGÍTIMA neste esquema.
 *
 * @throws SOURCE_MANIFEST_SOURCE_LOCATOR se qualquer folha de string da projeção carrega
 *   localizador ou identidade contactável.
 * @throws SOURCE_MANIFEST_EVIDENCE_NOT_VERIFIABLE se um item de `evidence` não é uma das duas
 *   formas recomputáveis.
 */
export function assertNoSourceLocator(body: ReviewedSourceManifestBody): void {
  const projection = reviewedSourceManifestProjection(body);
  assertLeavesCarryNoLocator(projection, "$");

  const materialBatches = projection.materialBatches;
  if (!Array.isArray(materialBatches)) return;
  materialBatches.forEach((batch, index) => {
    const where = `$.materialBatches[${index}].evidence`;
    const evidence = isPlainObject(batch) ? batch.evidence : undefined;
    if (!Array.isArray(evidence)) {
      fail(
        "SOURCE_MANIFEST_EVIDENCE_NOT_VERIFIABLE",
        `${where} must list the evidence of the acquisition`,
      );
    }
    evidence.forEach((item: unknown, position: number) => {
      if (
        typeof item === "string" &&
        EVIDENCE_FORMS.some((form) => form.test(item))
      ) {
        return;
      }
      fail(
        "SOURCE_MANIFEST_EVIDENCE_NOT_VERIFIABLE",
        `${where}[${position}] is not verifiable: ${String(item)} — evidence is either ` +
          "`<alg>:<lowercase hex>` (the digest of the content) or `<name> (<n> bytes)` (the " +
          "file in hand and its size), and a claim nobody can recompute is not evidence",
      );
    });
  });
}

/** Closed parser for the reviewed-source manifest. Rejects any drift. */
export async function parseReviewedSourceManifest(
  value: unknown,
): Promise<ReviewedSourceManifest> {
  // A versão é lida ANTES do conjunto de chaves, porque é ela que decide se
  // `materialBatches` é exigida: fechar o objeto contra a lista errada produz
  // diagnóstico enganoso — um manifesto v2 sem lote sairia como "missing key" de um
  // esquema que o admite, escondendo o bump.
  const version = isPlainObject(value) ? value.schemaVersion : undefined;
  if (version !== 1 && version !== 2) {
    fail("SOURCE_MANIFEST_SCHEMA_INVALID", "schemaVersion must be 1 or 2");
  }
  const root = assertExactObject(
    value,
    "reviewed source manifest",
    MANIFEST_KEYS,
    version === 2 ? MANIFEST_KEYS : MANIFEST_REQUIRED_KEYS,
  );

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

  // Os lotes de material dividem o NAMESPACE de `batchId` com os de geracao, e de proposito: a
  // auditoria recusa um registro nao gerado que nomeie um lote de GERACAO, e essa recusa so e
  // decidivel enquanto um id pertence a um dos dois e nunca aos dois.
  let materialBatches: SourceMaterialBatchV1[] | undefined;
  // No v2 a chave é EXIGIDA como lista, e a distinção contra o v1 é o valor `undefined`:
  // `assertExactObject` usa `Object.hasOwn`, então `{materialBatches: undefined}` satisfaz a
  // exigência da chave. Sem esta recusa o v2 leria a chave presente-com-valor-ausente como
  // "zero lote declarado", que é exatamente a única forma que o bump v2 existe para tornar
  // inexpressável. JSON em disco não escreve `undefined`; um chamador em memória escreve, e
  // `benchmark/lab/audit_sources.ts` chega ao audit com `JSON.parse` + cast.
  if (version === 2 && !Array.isArray(root.materialBatches)) {
    fail(
      "SOURCE_MANIFEST_FIELD_INVALID",
      "materialBatches must be an array: schemaVersion 2 requires the declaration, and a " +
        "key present with no value states nothing rather than zero batches",
    );
  }
  if (root.materialBatches !== undefined) {
    if (!Array.isArray(root.materialBatches)) {
      fail(
        "SOURCE_MANIFEST_FIELD_INVALID",
        "materialBatches must be an array when present",
      );
    }
    materialBatches = root.materialBatches.map((entry, index) => {
      const parsed = validateMaterialBatch(entry, index, seenSourceIds);
      if (seenBatchIds.has(parsed.batchId)) {
        fail(
          "SOURCE_MANIFEST_FIELD_INVALID",
          `duplicate batchId "${parsed.batchId}"`,
        );
      }
      seenBatchIds.add(parsed.batchId);
      return parsed;
    });
  }

  const sourceManifestDigest = lowercaseSha256(
    root.sourceManifestDigest,
    "sourceManifestDigest",
  );
  const body: ReviewedSourceManifestBody =
    version === 2
      ? {
          schemaVersion: 2,
          sources,
          generationBatches,
          // Não é `?? []`: a recusa de `!Array.isArray` acima já garantiu que o ramo v2 só
          // chega aqui com a lista parseada, então um `??` seria um caminho morto que
          // reintroduziria a leitura de "chave ausente = zero lote".
          materialBatches: materialBatches as SourceMaterialBatchV1[],
        }
      : {
          schemaVersion: 1,
          sources,
          generationBatches,
          ...(materialBatches === undefined ? {} : { materialBatches }),
        };
  // ANTES da conferência do self-digest, e a ordem é carga: um manifesto com localizador e digest
  // velho diagnosticado como "o digest não bate" convida o operador a RECOMPUTAR o digest, remédio
  // que torna o localizador permanente e abençoado por um self-digest válido. A recusa do corpo vem
  // antes da certificação do corpo.
  assertNoSourceLocator(body);
  const expected = await computeReviewedSourceManifestDigest(body);
  if (expected !== sourceManifestDigest) {
    fail(
      "SOURCE_MANIFEST_DIGEST_MISMATCH",
      "sourceManifestDigest does not match the recomputed self-digest",
    );
  }

  // `Omit` sobre uma união funde os dois corpos em UMA forma (a chave é a mesma nas duas
  // versões, só a obrigatoriedade muda), então o discriminante não estreita o spread. O campo
  // de digest é idêntico nas duas versões, e a asserção reúne as duas metades em um lugar em
  // vez de duplicar o retorno.
  return { ...body, sourceManifestDigest } as ReviewedSourceManifest;
}

/**
 * As duas metades do NAMESPACE de `batchId`, como o lado do registro precisa delas para cruzar
 * `groups.sourceMaterialBatch` contra o inventário (`materialBatchDefects` em
 * benchmark/schema.ts, consumida por `auditCorpusSources`).
 *
 * Duas coleções e não uma, e é a exclusividade entre elas que a auditoria gasta: um registro que
 * nomeie um lote de GERAÇÃO onde o eixo pede um lote de MATERIAL está declarando que o material
 * dele foi produzido em vez de adquirido, e essa contradição só é decidível enquanto um id pertence
 * a exatamente uma das duas listas — o que `parseReviewedSourceManifest` impõe recusando
 * `batchId` duplicado entre elas.
 *
 * Só ids opacos saem daqui, nunca a entrada do manifesto: é a mesma fronteira de privacidade do
 * índice `entryId -> digest` de `assertLabelEvidenceResolves`, e é o que mantém a direção desta
 * dependência a única existente.
 */
export function batchNamespaceOf(manifest: ReviewedSourceManifest): {
  /** `batchId` -> a `sourceId` que o lote declara. */
  material: ReadonlyMap<string, string>;
  generation: ReadonlySet<string>;
} {
  return {
    // O `?? []` cobre a OPCIONALIDADE do v1, que é real: um manifesto v1 pode legitimamente
    // não declarar lote nenhum, e aí o namespace de material é vazio — todo registro v4 que
    // nomeie um lote cai, que é a resposta correta. No v2 o parser já recusou a chave ausente,
    // então este ramo nunca é o v2 lendo "zero lote" de uma declaração que não existe.
    material: new Map(
      (manifest.materialBatches ?? []).map((batch) => [
        batch.batchId,
        batch.sourceId,
      ]),
    ),
    generation: new Set(
      manifest.generationBatches.map((batch) => batch.batchId),
    ),
  };
}
