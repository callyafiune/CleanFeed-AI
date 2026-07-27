// Corpus source governance audit. Produces the Phase 2 `CorpusSourceReadinessReport`
// from a reviewed-source manifest and the closed benchmark records. Like the rest
// of benchmark/, this module is standalone and MUST NOT import from the extension
// bundle (src/); it consumes only the pure Phase 1/2 contracts and the local
// benchmark schema.
//
// This audit is the SOLE producer of the nine corpus source blocking codes; it
// imports (never redeclares) the contract, its parser and its digest helper. It
// adds ONLY source authorization, consent/license evidence and collection/
// generation protocol coverage: record schema, class quotas, annotation /
// adjudication, mixed lineage, held-out families and slice minima stay with the
// separate Phase 2 `DatasetAudit`/`SplitAudit`. `validate` combines this report's
// status with the DatasetAudit; `split` remains the sole producer of
// leakage/slice reasons.
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
import type { BenchmarkRecord } from "./schema.ts";
import {
  computeReviewedSourceManifestDigest,
  type GenerationBatchV1,
  type ReviewedSourceEntryV1,
  type ReviewedSourceManifestV1,
} from "./source-manifest.ts";

export interface CorpusSourceAuditInput {
  /** The closed benchmark records; may be supplied in any order. */
  records: readonly BenchmarkRecord[];
  /** The reviewed source manifest (private/source-manifest.json). */
  sourceManifest: ReviewedSourceManifestV1;
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
 * A human-content source (LinkedIn contribution or licensed corpus) is
 * authorized only through an approved consent path (with a receipt digest) or an
 * approved compatible-license path (with a licenseId). Controlled generation is
 * not subject to the LinkedIn source policy.
 */
function isAuthorizedHumanSource(source: ReviewedSourceEntryV1): boolean {
  if (source.evaluationUseApproved !== true) return false;
  if (
    source.sourceType === "linkedin-contribution" &&
    source.acquisition === "consent"
  ) {
    return isNonEmptyString(source.consentReceiptDigest);
  }
  if (
    source.sourceType === "licensed-corpus" &&
    source.acquisition === "licensed"
  ) {
    return isNonEmptyString(source.licenseId);
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
    (generation.temperature ?? null) === batch.temperature &&
    generation.generatedAt === batch.generatedAt &&
    (generation.seed ?? null) === batch.seed
  );
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

    if (generated) {
      const linked = batchById.get(record.groups.collectionBatch);
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
    } else if (batchById.has(record.groups.collectionBatch)) {
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
  const sourceManifestDigest = await computeReviewedSourceManifestDigest({
    schemaVersion: sourceManifest.schemaVersion,
    sources: sourceManifest.sources,
    generationBatches: sourceManifest.generationBatches,
  });
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
