// Corpus source governance audit. Produces the Phase 2 `CorpusSourceReadinessReport`
// from a reviewed-source manifest and the closed benchmark records. Like the rest
// of benchmark/, this module is standalone and MUST NOT import from the extension
// bundle (src/); it consumes only the pure Phase 1/2 contracts and the local
// benchmark schema.
//
// This audit is the SOLE producer of the eleven corpus source blocking codes; it
// imports (never redeclares) the contract, its parser and its digest helper. It
// adds ONLY source authorization, consent/license evidence and collection/
// generation protocol coverage: record schema, class quotas, annotation /
// adjudication, mixed lineage, held-out families and slice minima stay with the
// separate Phase 2 `DatasetAudit`/`SplitAudit`. `validate` combines this report's
// status with the DatasetAudit; `split` remains the sole producer of
// leakage/slice reasons.
//
// WHAT THE `protocols` BLOCK OF THE REPORT DOES AND DOES NOT SAY (C5). It names the
// protocols the corpus is judged AGAINST — `annotation-v1`, `pii-review-v1` and the
// rest are literals in `contracts/source-readiness.ts` — and it is NOT a statement
// that every record passed them. Whether a record was reviewed is a per-record fact
// carried by `review` (`benchmark/schema.ts`): a receipt, or the first-class state
// `automated/unreviewed`, which is what all 10.000 sealed records really are once
// `reviewOf` downgrades their fabricated `annotation` block. The COHERENCE gate over
// that fact is `sealDataset` (`benchmark/dataset-manifest.ts`), which refuses a
// release corpus whose records sustain no review claim, and it lives there rather
// than here for the reason the paragraph above gives: annotation and adjudication
// belong to the DatasetAudit, and a second copy of the rule in this module could
// disagree with the first. The residual is stated rather than left implicit — a
// reader of a `ready` readiness report must not read `protocols.annotation` as
// evidence that an annotator existed.
//
// Output is deterministic and privacy preserving: reasons are sorted in the
// contract's canonical order and de-duplicated, records may be supplied in any
// order, and the report carries no text, URL, prompt, author group, consent
// receipt or per-record content hash — only opaque pseudonymised ids and digests.

import {
  computeSourceReadinessDigest,
  parseCorpusSourceReadinessReport,
  type CorpusSourceBlockingReason,
  type CorpusSourceReadinessReport,
  type SourceReadinessDigestInput,
} from "../contracts/source-readiness.ts";
import {
  groupAxisIdentity,
  materialBatchDefects,
  recipeTemperature,
  type BenchmarkRecord,
  type MaterialBatchDefectKind,
} from "./schema.ts";
import {
  A1_BLOCKED_HUMAN_SOURCES,
  OUT_OF_FRAME_HUMAN_SOURCES,
  batchNamespaceOf,
  computeReviewedSourceManifestDigest,
  licenseDescribesPublicBase,
  type GenerationBatchV1,
  type ReviewedSourceEntryV1,
  type ReviewedSourceManifest,
} from "./source-manifest.ts";

export interface CorpusSourceAuditInput {
  /** The closed benchmark records; may be supplied in any order. */
  records: readonly BenchmarkRecord[];
  /** The reviewed source manifest (private/source-manifest.json). */
  sourceManifest: ReviewedSourceManifest;
}

/** Thrown by {@link assertCorpusSourcesReady} when readiness is blocked. */
export class CorpusSourceNotReadyError extends Error {
  readonly codes: readonly string[];
  constructor(codes: readonly string[]) {
    super(`corpus sources are not ready: ${codes.join(", ")}`);
    this.name = "CorpusSourceNotReadyError";
    this.codes = codes;
  }
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

function reasonKey(reason: CorpusSourceBlockingReason): string {
  return JSON.stringify([
    reason.code,
    reason.recordId ?? "",
    reason.sourceId ?? "",
  ]);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/**
 * A human-content source is authorized only through an approved
 * compatible-licence path: a `licensed-corpus` entry, acquired as `licensed`,
 * carrying a licenceId that is not registered as a non-public base. Controlled
 * generation is not subject to this policy.
 *
 * There used to be a second admissible path here — a `linkedin-contribution`
 * entry with a consent receipt digest. B3 (2026-07-26) removed it: per-document
 * consent is a refused ACQUISITION route, so a consent entry is not an authorized
 * source at any receipt quality, and it is reported as
 * `LINKEDIN_SOURCE_NOT_AUTHORIZED` like any other unauthorized human source.
 *
 * The licence check is `=== false` and not `!== true` on purpose, because
 * `licenseDescribesPublicBase` has three answers and only one of them is a
 * refusal. `null` means the identifier is not in the registry, which v1 tolerates
 * deliberately — the private manifests and every fixture here still carry opaque
 * ids like `lic_ptbr_1`, and requiring registration of every identifier is a v3
 * schema decision, not this predicate's. So an unregistered id stays authorized
 * and only a licence the registry has CLASSIFIED as `operator-authorship` or
 * `internal-authorization` is refused.
 *
 * Why both refusals have to be repeated here and not only in
 * `parseReviewedSourceManifest` (which calls `assertNoIndividualAcquisition` and
 * `assertPublicBaseLicensesOnly`): this module is handed an ALREADY-PARSED
 * `ReviewedSourceManifestV1`, and `benchmark/lab/audit_sources.ts` reaches it with
 * a plain `JSON.parse` and a cast, never touching the parser. That is a second,
 * independent way in, so this predicate cannot rely on the first one having run.
 */
function isAuthorizedHumanSource(source: ReviewedSourceEntryV1): boolean {
  if (source.evaluationUseApproved !== true) return false;
  if (
    source.sourceType === "licensed-corpus" &&
    source.acquisition === "licensed"
  ) {
    if (!isNonEmptyString(source.licenseId)) return false;
    return licenseDescribesPublicBase(source.licenseId) !== false;
  }
  return false;
}

function auditSources(
  sources: readonly ReviewedSourceEntryV1[],
  reasons: CorpusSourceBlockingReason[],
): void {
  const seen = new Set<string>();
  for (const source of sources) {
    if (seen.has(source.sourceId)) {
      reasons.push({
        code: "SOURCE_MANIFEST_INVALID",
        sourceId: source.sourceId,
      });
    }
    seen.add(source.sourceId);

    if (source.evaluationUseApproved !== true) {
      reasons.push({
        code: "EVALUATION_USE_NOT_APPROVED",
        sourceId: source.sourceId,
      });
    }
    if (source.collectionProtocolVersion !== "collection-v1") {
      reasons.push({
        code: "COLLECTION_PROTOCOL_MISMATCH",
        sourceId: source.sourceId,
      });
    }

    // A1: refused by name, and refused HERE and not only in
    // `humanSourceAdmissibility`, because this audit reads a reviewed MANIFEST — which
    // carries no snapshot — and it is what decides `status: "ready"`. Without it the
    // audit authorizes a manifest declaring the blocked source, which is exactly the
    // silence that keeping the registration was supposed to prevent.
    if (
      A1_BLOCKED_HUMAN_SOURCES.some(
        (blocked) => blocked.sourceId === source.sourceId,
      )
    ) {
      reasons.push({
        code: "SOURCE_BLOCKED_BY_ACCESS_TERMS",
        sourceId: source.sourceId,
      });
    }

    // Out of frame, refused HERE for the same reason A1 is: the registration was kept
    // rather than deleted so that a manifest declaring the source FAILS instead of the
    // audit not knowing the id. Leaving the list purely declarative reproduced exactly
    // the silence it exists to prevent — and worse than before, because dropping the
    // source from the stocked inventory ALSO stops `auditDeclaredAxes` from checking
    // its declared axes, which skips a sourceId it has no entry for.
    if (
      OUT_OF_FRAME_HUMAN_SOURCES.some(
        (outside) => outside.sourceId === source.sourceId,
      )
    ) {
      reasons.push({
        code: "SOURCE_OUT_OF_DECLARED_FRAME",
        sourceId: source.sourceId,
      });
    }

    const reviewers: readonly unknown[] = source.legalReviewerIds;
    if (
      !Array.isArray(reviewers) ||
      reviewers.length < 2 ||
      !isNonEmptyString(reviewers[0]) ||
      !isNonEmptyString(reviewers[1])
    ) {
      reasons.push({
        code: "SOURCE_LEGAL_REVIEW_MISSING",
        sourceId: source.sourceId,
      });
    } else if (reviewers[0] === reviewers[1]) {
      reasons.push({
        code: "SOURCE_REVIEWERS_NOT_INDEPENDENT",
        sourceId: source.sourceId,
      });
    }

    // LinkedIn source policy applies to human-content sources only.
    if (
      source.sourceType !== "controlled-generation" &&
      !isAuthorizedHumanSource(source)
    ) {
      reasons.push({
        code: "LINKEDIN_SOURCE_NOT_AUTHORIZED",
        sourceId: source.sourceId,
      });
    }
  }
}

function auditBatches(
  batches: readonly GenerationBatchV1[],
  sourceById: ReadonlyMap<string, ReviewedSourceEntryV1>,
  reasons: CorpusSourceBlockingReason[],
): void {
  const seen = new Set<string>();
  for (const batch of batches) {
    if (seen.has(batch.batchId)) {
      reasons.push({
        code: "SOURCE_MANIFEST_INVALID",
        sourceId: batch.sourceId,
      });
    }
    seen.add(batch.batchId);

    const source = sourceById.get(batch.sourceId);
    if (source === undefined || source.acquisition !== "generated") {
      reasons.push({
        code: "SOURCE_REFERENCE_MISSING",
        sourceId: batch.sourceId,
      });
    }
    if (batch.generationProtocolVersion !== "generation-v1") {
      reasons.push({
        code: "GENERATION_RECIPE_MISMATCH",
        sourceId: batch.sourceId,
      });
    }
  }
}

// The ONE legitimate comparison against `generation.family`: this is the recipe
// identity check, matching a record's declared recipe field-for-field against the
// reviewed generation batch. Both sides are the PROVIDER's own label, kept
// unnormalized on purpose, and neither is the canonical grouping family — nothing
// here asks whether a family was reserved as unseen. Any comparison that DOES ask
// that must go through `generatorFamilyOf` and the canonical field
// (benchmark/generator-family.ts).
function recipeMatchesBatch(
  generation: NonNullable<BenchmarkRecord["generation"]>,
  batch: GenerationBatchV1,
  recordSourceId: string,
): boolean {
  return (
    batch.sourceId === recordSourceId &&
    generation.provider === batch.provider &&
    generation.family === batch.family &&
    generation.model === batch.model &&
    generation.version === batch.version &&
    generation.promptSha256 === batch.promptTemplateDigest &&
    // Read through the version-aware accessor: v2 keeps the temperature at the top
    // of `generation`, v3 inside the `configurable: true` branch of `decoding`, and
    // a raw `generation.temperature` no longer compiles against the union — which is
    // the compile-time net doing its job rather than an inconvenience.
    //
    // Both sides can now say "none applied": `batch.temperature` is nullable with
    // `batch.temperatureNullReason` carrying the why. Until that pair existed this
    // very line was UNSATISFIABLE on `agy`, `codex` and `gemini-cli` — three of the
    // four frozen lanes, whose policy rows set `decodingConfigurable: false`, so
    // `recipeTemperature` returns `null` there by construction and the batch was
    // forced to declare a number. `temperatureNullReason` is deliberately NOT
    // compared, exactly as `seedNullReason` is not: the reason is prose for an
    // auditor, and identity is a question about the value that was applied.
    recipeTemperature(generation) === batch.temperature &&
    generation.generatedAt === batch.generatedAt &&
    (generation.seed ?? null) === batch.seed
  );
}

// Which closed code each material-batch defect is REPORTED as. The closed vocabulary
// already distinguishes the two facts that matter to a report: a reference into the
// manifest that does not resolve to the acquisition it must, and a non-generated row
// linking a declared generation batch — which is the same fact the human-record branch
// below already reports as GENERATION_RECIPE_MISMATCH, read on the material axis
// instead of the recipe one. The four-way distinction survives in
// `materialBatchDefects`, for the caller that refuses rather than reports.
const MATERIAL_BATCH_DEFECT_CODE: Record<
  MaterialBatchDefectKind,
  CorpusSourceBlockingReason["code"]
> = {
  unresolved: "SOURCE_REFERENCE_MISSING",
  "generation-batch": "GENERATION_RECIPE_MISMATCH",
  "foreign-source": "SOURCE_REFERENCE_MISSING",
  "parent-disagreement": "SOURCE_REFERENCE_MISSING",
};

// The cross-check the material axis exists for: every `groups.sourceMaterialBatch` a
// record declares resolves against the manifest's material inventory. It lives here
// because this is the step that holds the records AND the reviewed manifest, and
// because a v4 corpus whose acquisitions are undeclared is not ready to seal —
// reporting `blocked` is the truthful answer, not an inconvenience.
//
// The manifest that DECLARES the inventory is written by `benchmark/lab/build_governance.ts`,
// where the acquisitions are a constant of reviewed code rather than something derived from
// the pools: `materialVersion`, the acquisition window and the evidence are facts no code in
// this repository observed, and synthesising them from the records would be the fabricated
// provenance R4 forbids.
function auditMaterialBatches(
  records: readonly BenchmarkRecord[],
  sourceManifest: ReviewedSourceManifest,
  reasons: CorpusSourceBlockingReason[],
): void {
  for (const defect of materialBatchDefects(
    records,
    batchNamespaceOf(sourceManifest),
  )) {
    reasons.push({
      code: MATERIAL_BATCH_DEFECT_CODE[defect.kind],
      recordId: defect.recordId,
    });
  }
}

function auditRecords(
  records: readonly BenchmarkRecord[],
  sourceById: ReadonlyMap<string, ReviewedSourceEntryV1>,
  batchById: ReadonlyMap<string, GenerationBatchV1>,
  reasons: CorpusSourceBlockingReason[],
): void {
  for (const record of records) {
    const sourceId = record.provenance.sourceId;
    const source = sourceById.get(sourceId);
    const generated = record.provenance.sourceKind === "controlled-generation";

    if (source === undefined) {
      reasons.push({
        code: "SOURCE_REFERENCE_MISSING",
        recordId: record.id,
        sourceId,
      });
    }

    // The declared generation batch, read through the version-aware accessor: from
    // v3 on the axis is a three-valued object and only a `known` state names a batch
    // a manifest entry could match. WHICH axis carries it is a version fact: v2 and
    // v3 conflate the generation batch and the extraction run in `collectionBatch`,
    // and v4 splits them, so reading one name on a v4 row would report every
    // generated record as GENERATION_RECIPE_MISSING.
    const batchId = groupAxisIdentity(
      record,
      record.schemaVersion === 4 ? "generationBatch" : "collectionBatch",
    );

    if (generated) {
      const linked = batchId === undefined ? undefined : batchById.get(batchId);
      if (linked === undefined || record.generation === undefined) {
        reasons.push({
          code: "GENERATION_RECIPE_MISSING",
          recordId: record.id,
        });
      } else if (!recipeMatchesBatch(record.generation, linked, sourceId)) {
        reasons.push({
          code: "GENERATION_RECIPE_MISMATCH",
          recordId: record.id,
        });
      }
    } else if (batchId !== undefined && batchById.has(batchId)) {
      // Human records must never link a generation batch.
      reasons.push({
        code: "GENERATION_RECIPE_MISMATCH",
        recordId: record.id,
      });
    }
  }
}

function countAcquisitions(records: readonly BenchmarkRecord[]): {
  consent: number;
  licensed: number;
  generated: number;
} {
  const counts = { consent: 0, licensed: 0, generated: 0 };
  for (const record of records) {
    switch (record.provenance.legalBasis) {
      case "consent":
        counts.consent += 1;
        break;
      case "license":
        counts.licensed += 1;
        break;
      case "generated":
        counts.generated += 1;
        break;
    }
  }
  return counts;
}

/**
 * Audits corpus source governance and produces a signed
 * `CorpusSourceReadinessReport`. Never throws on a governance failure: it reports
 * `status: "blocked"` with sorted, de-duplicated blocking reasons.
 */
export async function auditCorpusSources(
  input: CorpusSourceAuditInput,
): Promise<CorpusSourceReadinessReport> {
  const { records, sourceManifest } = input;
  const reasons: CorpusSourceBlockingReason[] = [];

  // The report binds the recalculated canonical self-digest, distinct from the
  // raw file SHA-256 held by the DatasetManifest/DatasetAudit.
  // The projection is the manifest's own body, `materialBatches` included: dropping
  // a key the parser hashed would recompute a different digest and report a valid
  // manifest as SOURCE_MANIFEST_INVALID.
  const sourceManifestDigest = await computeReviewedSourceManifestDigest(
    sourceManifest.schemaVersion === 2
      ? {
          schemaVersion: 2,
          sources: sourceManifest.sources,
          generationBatches: sourceManifest.generationBatches,
          materialBatches: sourceManifest.materialBatches,
        }
      : {
          schemaVersion: 1,
          sources: sourceManifest.sources,
          generationBatches: sourceManifest.generationBatches,
          ...(sourceManifest.materialBatches === undefined
            ? {}
            : { materialBatches: sourceManifest.materialBatches }),
        },
  );
  if (sourceManifestDigest !== sourceManifest.sourceManifestDigest) {
    reasons.push({ code: "SOURCE_MANIFEST_INVALID" });
  }

  const sourceById = new Map<string, ReviewedSourceEntryV1>();
  for (const source of sourceManifest.sources) {
    if (!sourceById.has(source.sourceId)) {
      sourceById.set(source.sourceId, source);
    }
  }
  const batchById = new Map<string, GenerationBatchV1>();
  for (const batch of sourceManifest.generationBatches) {
    if (!batchById.has(batch.batchId)) {
      batchById.set(batch.batchId, batch);
    }
  }

  auditSources(sourceManifest.sources, reasons);
  auditBatches(sourceManifest.generationBatches, sourceById, reasons);
  auditRecords(records, sourceById, batchById, reasons);
  auditMaterialBatches(records, sourceManifest, reasons);

  // Sort into the contract's canonical order and drop exact duplicates.
  reasons.sort(compareReasons);
  const deduped: CorpusSourceBlockingReason[] = [];
  const seenKeys = new Set<string>();
  for (const reason of reasons) {
    const key = reasonKey(reason);
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      deduped.push(reason);
    }
  }

  const digestInput: SourceReadinessDigestInput = {
    schemaVersion: 1,
    status: deduped.length === 0 ? "ready" : "blocked",
    sourceManifestDigest,
    recordCount: records.length,
    sourceCount: sourceManifest.sources.length,
    acquisitionCounts: countAcquisitions(records),
    protocols: {
      corpus: "corpus-v1",
      collection: "collection-v1",
      annotation: "annotation-v1",
      generation: "generation-v1",
      pii: "pii-review-v1",
    },
    blockingReasons: deduped,
  };
  const reportDigest = await computeSourceReadinessDigest(digestInput);

  // Round-trip through the closed contract parser so any drift in what we
  // produce fails loudly here rather than downstream.
  return parseCorpusSourceReadinessReport({ ...digestInput, reportDigest });
}

/** Throws {@link CorpusSourceNotReadyError} unless the report is `ready`. */
export function assertCorpusSourcesReady(
  report: CorpusSourceReadinessReport,
): void {
  if (report.status !== "ready") {
    const codes = [...new Set(report.blockingReasons.map((r) => r.code))];
    throw new CorpusSourceNotReadyError(codes);
  }
}
