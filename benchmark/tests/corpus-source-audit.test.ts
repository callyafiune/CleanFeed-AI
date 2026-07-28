import { describe, expect, it } from "vitest";

import { canonicalJson } from "../../contracts/canonical-json.ts";
import {
  CORPUS_SOURCE_BLOCKING_CODES,
  parseCorpusSourceReadinessReport,
  type CorpusSourceBlockingCode,
} from "../../contracts/source-readiness.ts";
import {
  assertCorpusSourcesReady,
  auditCorpusSources,
  type CorpusSourceAuditInput,
} from "../corpus-source-audit.ts";
import {
  computeReviewedSourceManifestDigest,
  parseReviewedSourceManifest,
  type GenerationBatchV1,
  type ReviewedSourceEntryV1,
  type ReviewedSourceManifestV1,
} from "../source-manifest.ts";
import { validateBenchmarkRecordV3, type BenchmarkRecord } from "../schema.ts";
import { asGeneratorFamily } from "../generator-family.ts";
import {
  known,
  v3Ai,
  v3ApiAi,
  withAxis,
  withGeneration,
} from "./helpers/v3-record-fixture.ts";

// --- Reviewed source manifest fixtures -----------------------------------

// The authorized human-content source of the default fixture set. It used to be
// a `linkedin-contribution` / `acquisition: "consent"` entry: since B3
// (2026-07-26) per-document consent is a refused acquisition route, so a consent
// entry is no longer an AUTHORIZED source and cannot be the fixture for "fully
// authorized". It kept `sourceId`-shaped stability rather than semantic
// stability — nothing in the audit pairs a record's `sourceKind` with its
// source's `sourceType`, so the switch is confined to these fixtures.
const licensedHumanSource: ReviewedSourceEntryV1 = {
  sourceId: "src_human_licensed",
  sourceType: "licensed-corpus",
  acquisition: "licensed",
  evaluationUseApproved: true,
  licenseId: "lic_ptbr_human",
  consentReceiptDigest: null,
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_b"],
};

// The refused route, kept as a fixture precisely so the refusal can be asserted:
// the v1 schema can still spell it, and `auditCorpusSources` receives already-
// parsed objects (see `benchmark/lab/audit_sources.ts`, which JSON-parses a
// manifest and casts it), so the audit must block it on its own.
const consentSource: ReviewedSourceEntryV1 = {
  sourceId: "src_consent",
  sourceType: "linkedin-contribution",
  acquisition: "consent",
  evaluationUseApproved: true,
  licenseId: null,
  consentReceiptDigest: "a".repeat(64),
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_b"],
};

const licensedSource: ReviewedSourceEntryV1 = {
  sourceId: "src_licensed",
  sourceType: "licensed-corpus",
  acquisition: "licensed",
  evaluationUseApproved: true,
  licenseId: "lic_ptbr_1",
  consentReceiptDigest: null,
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_c"],
};

const generatedSource: ReviewedSourceEntryV1 = {
  sourceId: "src_generated",
  sourceType: "controlled-generation",
  acquisition: "generated",
  evaluationUseApproved: true,
  licenseId: "lic_generated_1",
  consentReceiptDigest: null,
  collectionProtocolVersion: "collection-v1",
  legalReviewerIds: ["legal_a", "legal_d"],
};

const batch: GenerationBatchV1 = {
  batchId: "batch_gen",
  sourceId: "src_generated",
  generationProtocolVersion: "generation-v1",
  provider: "acme",
  family: "acme_large",
  model: "acme_large_2",
  version: "2026-05",
  promptTemplateDigest: "1".repeat(64),
  temperature: 0.7,
  temperatureNullReason: null,
  generatedAt: 1_735_776_000_000,
  seed: "seed_1",
  seedNullReason: null,
};

// --- Benchmark record fixtures (schema v2) -------------------------------

// The record that draws on `licensedHumanSource`. Its id stays `human_c1` — the
// blocking-reason assertions below name it, and a fixture id carries no meaning —
// but its provenance is now the licensed one, so `acquisitionCounts` reads
// licensed 2 / consent 0 for the default set.
const humanFromLicensedBase: BenchmarkRecord = {
  schemaVersion: 2,
  id: "human_c1",
  text: "prosa corporativa autorizada em portugues do brasil",
  normalizedTextSha256: "1".repeat(64),
  label: "human",
  language: "pt-BR",
  platform: "generic",
  domain: "corporate",
  topic: "career",
  humanSourceType: "qa-informal",
  wordCount: 7,
  createdAt: 1_735_689_600_000,
  provenance: {
    sourceKind: "licensed-corpus",
    sourceId: "src_human_licensed",
    sourceRevision: "rev_1",
    collectedAt: 1_735_689_600_000,
    licenseId: "lic_ptbr_human",
    legalBasis: "license",
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "pii_1",
      reviewedAt: 1_735_689_600_000,
    },
  },
  annotation: {
    protocolVersion: "annotation-v1",
    reviewerIds: ["rev_a", "rev_b"],
    agreement: "agree",
  },
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: "author_c1",
    source: "src_human_licensed",
    domainSource: "licensed_human_base",
    collectionBatch: "batch_h_1",
    nearDuplicate: "nd_c1",
    derivationRoot: "human_c1",
  },
};

const humanLicensed: BenchmarkRecord = {
  schemaVersion: 2,
  id: "human_l1",
  text: "conteudo licenciado compativel em portugues do brasil",
  normalizedTextSha256: "2".repeat(64),
  label: "human",
  language: "pt-BR",
  platform: "generic",
  domain: "corporate",
  topic: "sales",
  humanSourceType: "sales",
  wordCount: 7,
  createdAt: 1_735_690_600_000,
  provenance: {
    sourceKind: "licensed-corpus",
    sourceId: "src_licensed",
    sourceRevision: "rev_2",
    collectedAt: 1_735_690_600_000,
    licenseId: "lic_ptbr_1",
    legalBasis: "license",
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "pii_2",
      reviewedAt: 1_735_690_600_000,
    },
  },
  annotation: {
    protocolVersion: "annotation-v1",
    reviewerIds: ["rev_a", "rev_c"],
    agreement: "agree",
  },
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: "author_l1",
    source: "src_licensed",
    domainSource: "licensed_corpus",
    collectionBatch: "batch_h_licensed",
    nearDuplicate: "nd_l1",
    derivationRoot: "human_l1",
  },
};

const aiGenerated: BenchmarkRecord = {
  schemaVersion: 2,
  id: "ai_g1",
  text: "conteudo sintetico gerado sob receita controlada",
  normalizedTextSha256: "3".repeat(64),
  label: "ai",
  language: "pt-BR",
  platform: "generic",
  domain: "corporate",
  topic: "technology",
  wordCount: 6,
  createdAt: 1_735_776_000_000,
  provenance: {
    sourceKind: "controlled-generation",
    sourceId: "src_generated",
    sourceRevision: "rev_3",
    collectedAt: 1_735_776_000_000,
    licenseId: "lic_generated_1",
    legalBasis: "generated",
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "pii_3",
      reviewedAt: 1_735_776_000_000,
    },
  },
  annotation: {
    protocolVersion: "annotation-v1",
    reviewerIds: ["rev_a", "rev_d"],
    agreement: "agree",
  },
  generation: {
    provider: "acme",
    family: "acme_large",
    model: "acme_large_2",
    version: "2026-05",
    promptId: "prompt_1",
    promptSha256: "1".repeat(64),
    temperature: 0.7,
    seed: "seed_1",
    generatedAt: 1_735_776_000_000,
  },
  transformation: { kind: "none", severity: "none" },
  groups: {
    author: "author_g1",
    source: "src_generated",
    domainSource: "generated_batch",
    generatorFamily: asGeneratorFamily("acme_family"),
    generatorVersion: "acme_v2",
    promptTemplate: "template_1",
    collectionBatch: "batch_gen",
    nearDuplicate: "nd_g1",
    derivationRoot: "ai_g1",
  },
};

type ManifestBody = Omit<ReviewedSourceManifestV1, "sourceManifestDigest">;

async function buildInput(options: {
  sources?: ReviewedSourceEntryV1[];
  batches?: GenerationBatchV1[];
  records?: BenchmarkRecord[];
  digestOverride?: string;
}): Promise<CorpusSourceAuditInput> {
  const body: ManifestBody = {
    schemaVersion: 1,
    sources: options.sources ?? [
      licensedHumanSource,
      licensedSource,
      generatedSource,
    ],
    generationBatches: options.batches ?? [batch],
  };
  const sourceManifestDigest =
    options.digestOverride ?? (await computeReviewedSourceManifestDigest(body));
  return {
    records: options.records ?? [
      humanFromLicensedBase,
      humanLicensed,
      aiGenerated,
    ],
    sourceManifest: { ...body, sourceManifestDigest },
  };
}

// Launders a deliberately non-compliant source across the typed boundary so the
// audit can be exercised on manifests a well-typed caller could not construct.
function tamperSource(patch: Record<string, unknown>): ReviewedSourceEntryV1 {
  return { ...generatedSource, ...patch } as unknown as ReviewedSourceEntryV1;
}

function codesOf(report: {
  blockingReasons: { code: CorpusSourceBlockingCode }[];
}): CorpusSourceBlockingCode[] {
  return report.blockingReasons.map((reason) => reason.code);
}

describe("auditCorpusSources", () => {
  it("returns a ready report for fully authorized sources", async () => {
    const report = await auditCorpusSources(await buildInput({}));
    expect(report).toMatchObject({
      status: "ready",
      blockingReasons: [],
      recordCount: 3,
      sourceCount: 3,
      // Two licensed human records and one generated: the consent count is 0
      // because B3 leaves no admissible per-document-consent source to draw on.
      acquisitionCounts: { consent: 0, licensed: 2, generated: 1 },
      protocols: {
        corpus: "corpus-v1",
        collection: "collection-v1",
        annotation: "annotation-v1",
        generation: "generation-v1",
        pii: "pii-review-v1",
      },
    });
    expect(() => assertCorpusSourcesReady(report)).not.toThrow();
  });

  it("re-parses cleanly through the Phase 2 closed contract", async () => {
    const report = await auditCorpusSources(await buildInput({}));
    await expect(parseCorpusSourceReadinessReport(report)).resolves.toEqual(
      report,
    );
    expect(report.sourceManifestDigest).toBe(
      await computeReviewedSourceManifestDigest({
        schemaVersion: 1,
        sources: [licensedHumanSource, licensedSource, generatedSource],
        generationBatches: [batch],
      }),
    );
  });

  it("blocks a per-document-consent source however well formed it is", async () => {
    // B3 (2026-07-26): consent is a refused ACQUISITION route, so this entry is
    // not authorized even with a well-formed receipt digest, two distinct legal
    // reviewers and `evaluationUseApproved: true`. `parseReviewedSourceManifest`
    // already refuses it before a manifest ever loads; the audit has to refuse it
    // too, because `auditCorpusSources` takes an already-parsed object and
    // `benchmark/lab/audit_sources.ts` reaches it with a plain `JSON.parse`.
    const report = await auditCorpusSources(
      await buildInput({
        sources: [consentSource, licensedSource, generatedSource],
      }),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "LINKEDIN_SOURCE_NOT_AUTHORIZED",
        sourceId: "src_consent",
      }),
    );
  });

  it("blocks a licensed source whose licence is not a published base", async () => {
    // The other half of B3's rule, on the same second entry point. `licensed` +
    // `licensed-corpus` + a non-empty licenceId used to be enough, so a licence
    // registered as the OPERATOR'S OWN authorship was an authorized human source
    // here even after the parser learned to refuse it.
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          { ...licensedSource, licenseId: "autoria-propria-v1" },
          generatedSource,
        ],
      }),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "LINKEDIN_SOURCE_NOT_AUTHORIZED",
        sourceId: "src_licensed",
      }),
    );
  });

  it("keeps an unregistered licence id authorized", async () => {
    // The counter-case that stops the check above from refusing everything, and
    // the reason it is written `=== false` and not `!== true`: `lic_ptbr_1` is not
    // in the registry, which v1 tolerates deliberately, so it stays authorized.
    const report = await auditCorpusSources(
      await buildInput({ sources: [licensedSource, generatedSource] }),
    );
    expect(
      report.blockingReasons.filter(
        (reason) => reason.code === "LINKEDIN_SOURCE_NOT_AUTHORIZED",
      ),
    ).toEqual([]);
  });

  it("flags a LinkedIn source that is not authorized", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          {
            ...consentSource,
            evaluationUseApproved: false,
          } as unknown as ReviewedSourceEntryV1,
          licensedSource,
          generatedSource,
        ],
      }),
    );
    expect(report.status).toBe("blocked");
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "LINKEDIN_SOURCE_NOT_AUTHORIZED",
        sourceId: "src_consent",
      }),
    );
  });

  it("flags a source that is not approved for evaluation use", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          consentSource,
          licensedSource,
          tamperSource({ evaluationUseApproved: false }),
        ],
      }),
    );
    expect(codesOf(report)).toContain("EVALUATION_USE_NOT_APPROVED");
  });

  it("flags non-independent legal reviewers", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          consentSource,
          licensedSource,
          tamperSource({ legalReviewerIds: ["legal_a", "legal_a"] }),
        ],
      }),
    );
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "SOURCE_REVIEWERS_NOT_INDEPENDENT",
        sourceId: "src_generated",
      }),
    );
  });

  it("flags a missing legal review", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          consentSource,
          licensedSource,
          tamperSource({ legalReviewerIds: ["legal_a"] }),
        ],
      }),
    );
    expect(codesOf(report)).toContain("SOURCE_LEGAL_REVIEW_MISSING");
  });

  it("flags a collection protocol mismatch", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          consentSource,
          licensedSource,
          tamperSource({ collectionProtocolVersion: "collection-v0" }),
        ],
      }),
    );
    expect(codesOf(report)).toContain("COLLECTION_PROTOCOL_MISMATCH");
  });

  it("flags a record whose source is absent from the manifest", async () => {
    const orphan: BenchmarkRecord = {
      ...humanFromLicensedBase,
      provenance: {
        ...humanFromLicensedBase.provenance,
        sourceId: "src_absent",
      },
      groups: { ...humanFromLicensedBase.groups, source: "src_absent" },
    };
    const report = await auditCorpusSources(
      await buildInput({ records: [orphan, humanLicensed, aiGenerated] }),
    );
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "SOURCE_REFERENCE_MISSING",
        recordId: "human_c1",
      }),
    );
  });

  it("flags a generated record with no linked batch", async () => {
    const unlinked: BenchmarkRecord = {
      ...aiGenerated,
      groups: { ...aiGenerated.groups, collectionBatch: "batch_absent" },
    };
    const report = await auditCorpusSources(
      await buildInput({
        records: [humanFromLicensedBase, humanLicensed, unlinked],
      }),
    );
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "GENERATION_RECIPE_MISSING",
        recordId: "ai_g1",
      }),
    );
  });

  it("flags a generated record whose recipe diverges from its batch", async () => {
    const drifted: BenchmarkRecord = {
      ...aiGenerated,
      generation: { ...aiGenerated.generation!, model: "acme_large_9" },
    };
    const report = await auditCorpusSources(
      await buildInput({
        records: [humanFromLicensedBase, humanLicensed, drifted],
      }),
    );
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "GENERATION_RECIPE_MISMATCH",
        recordId: "ai_g1",
      }),
    );
  });

  it("forbids a human record from linking a generation batch", async () => {
    const linked: BenchmarkRecord = {
      ...humanFromLicensedBase,
      groups: { ...humanFromLicensedBase.groups, collectionBatch: "batch_gen" },
    };
    const report = await auditCorpusSources(
      await buildInput({ records: [linked, humanLicensed, aiGenerated] }),
    );
    expect(report.blockingReasons).toContainEqual(
      expect.objectContaining({
        code: "GENERATION_RECIPE_MISMATCH",
        recordId: "human_c1",
      }),
    );
  });

  it("flags a manifest whose self-digest does not match its body", async () => {
    const report = await auditCorpusSources(
      await buildInput({ digestOverride: "0".repeat(64) }),
    );
    expect(codesOf(report)).toContain("SOURCE_MANIFEST_INVALID");
  });

  it("only ever emits Phase 2 blocking codes", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        sources: [
          {
            ...consentSource,
            evaluationUseApproved: false,
          } as unknown as ReviewedSourceEntryV1,
          tamperSource({ collectionProtocolVersion: "collection-v0" }),
          tamperSource({ legalReviewerIds: ["legal_a", "legal_a"] }),
        ],
        records: [
          {
            ...humanFromLicensedBase,
            provenance: {
              ...humanFromLicensedBase.provenance,
              sourceId: "src_absent",
            },
          },
          humanLicensed,
          aiGenerated,
        ],
        digestOverride: "0".repeat(64),
      }),
    );
    const allowed = new Set<string>(CORPUS_SOURCE_BLOCKING_CODES);
    for (const code of codesOf(report)) {
      expect(allowed.has(code)).toBe(true);
    }
    await expect(parseCorpusSourceReadinessReport(report)).resolves.toEqual(
      report,
    );
  });

  it("throws from assertCorpusSourcesReady when blocked", async () => {
    const report = await auditCorpusSources(
      await buildInput({ digestOverride: "0".repeat(64) }),
    );
    expect(() => assertCorpusSourcesReady(report)).toThrow(
      /SOURCE_MANIFEST_INVALID/,
    );
  });
});

describe("corpus source readiness privacy and determinism", () => {
  it("never serializes text, urls, prompts or raw receipts", async () => {
    const orphan: BenchmarkRecord = {
      ...humanFromLicensedBase,
      provenance: {
        ...humanFromLicensedBase.provenance,
        sourceId: "src_absent",
      },
    };
    const report = await auditCorpusSources(
      await buildInput({ records: [orphan, humanLicensed, aiGenerated] }),
    );
    const serialized = JSON.stringify(report);
    for (const forbidden of [
      "text",
      "url",
      "prompt",
      "authorGroup",
      "consentReceiptDigest",
      "contentSha256",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("produces byte-identical output when records are permuted", async () => {
    const forward = await auditCorpusSources(
      await buildInput({
        records: [humanFromLicensedBase, humanLicensed, aiGenerated],
      }),
    );
    const permuted = await auditCorpusSources(
      await buildInput({
        records: [aiGenerated, humanFromLicensedBase, humanLicensed],
      }),
    );
    expect(canonicalJson(permuted)).toBe(canonicalJson(forward));
    expect(permuted.reportDigest).toBe(forward.reportDigest);
  });
});

// ---------------------------------------------------------------------------
// C1 correction round — the recipe-identity comparison reads a v3 record's
// applied temperature through `recipeTemperature`, and the v3 ARM of that
// accessor was pinned by nothing.
//
// Every record fixture above is `schemaVersion: 2`, so replacing the whole v3
// branch of `recipeTemperature` with `return null` left the entire benchmark
// suite green. The consequence is in both directions and both are silent: a v3
// row whose applied temperature diverges from its reviewed batch compares
// `null === null` and is ADMITTED with no `GENERATION_RECIPE_MISMATCH`, and a v3
// row that genuinely matches a batch declaring `0.7` is reported as a mismatch.
// The compiler checked the shape of the accessor; nothing checked its value.
//
// The test lives here rather than only beside the accessor because this is the
// consumer that gives the value its meaning — governance recipe identity.
// ---------------------------------------------------------------------------

// The `gemini-api` lane is the one lane whose row sets
// `decodingConfigurable: true`, so it is the only place a v3 record can carry an
// applied temperature at all. The lane shape itself comes from `v3ApiAi` in the
// shared fixture helper — it was hand-built here AND in schema-v3.test.ts, down to
// a byte-identical `notApplicable` reason string, so a drift between the two
// copies would have been invisible in both. What stays local is the only thing
// that IS local: the alignment with `batch`, so that the temperature is the ONLY
// field which can decide the comparison.
function v3ApiRecordAtTemperature(temperature: number | null): BenchmarkRecord {
  const raw = withGeneration(v3ApiAi(temperature), {
    provider: batch.provider,
    family: batch.family,
    model: batch.model,
    version: batch.version,
    promptId: "prompt_1",
    // `recipeMatchesBatch` compares the record's `promptSha256` against the
    // batch's `promptTemplateDigest` — a pre-existing pairing, kept as is.
    promptSha256: batch.promptTemplateDigest,
    promptTemplateDigest: "3".repeat(64),
    generatedAt: batch.generatedAt,
    seed: batch.seed ?? undefined,
  });
  // The base fixture is a seedless agy row; this one carries the batch's seed, and
  // exactly one of the pair may be present.
  delete (raw.generation as Record<string, unknown>).seedNullReason;
  raw.id = "ai_v3_api";
  raw.provenance = {
    ...(raw.provenance as Record<string, unknown>),
    sourceId: "src_generated",
    licenseId: "lic_generated_1",
  };
  let record = withAxis(raw, "collectionBatch", known(batch.batchId));
  record = withAxis(record, "generatorFamily", known(batch.family));
  return validateBenchmarkRecordV3(record);
}

describe("the recipe comparison reads a v3 record's applied temperature", () => {
  it("matches a batch declaring the same temperature", async () => {
    const report = await auditCorpusSources(
      await buildInput({ records: [v3ApiRecordAtTemperature(0.7)] }),
    );
    expect(codesOf(report)).toEqual([]);
    expect(report.status).toBe("ready");
  });

  it("mismatches a batch declaring a different temperature", async () => {
    const report = await auditCorpusSources(
      await buildInput({ records: [v3ApiRecordAtTemperature(0.9)] }),
    );
    expect(codesOf(report)).toEqual(["GENERATION_RECIPE_MISMATCH"]);
  });

  it("mismatches a batch declaring a temperature when none was applied", async () => {
    // `null` inside `configurable: true` means the provider's default applied.
    // That is a DIFFERENT recipe from one that set 0.7.
    const report = await auditCorpusSources(
      await buildInput({ records: [v3ApiRecordAtTemperature(null)] }),
    );
    expect(codesOf(report)).toEqual(["GENERATION_RECIPE_MISMATCH"]);
  });

  // The two cases above are both refused under a v3 arm hardwired to `null`, so
  // they cannot tell a working accessor from a dead one on their own. These two
  // can: against a batch that declares NO temperature, a dead arm compares
  // `null === null` and ADMITS a record that applied 0.7 — the silent direction,
  // where a divergence from the reviewed recipe enters the corpus unreported.
  //
  // In the previous round this batch had to be LAUNDERED across the typed
  // boundary, because `GenerationBatchV1.temperature` was `number`. It no longer
  // does: a batch may now state that no temperature applied, with the reason
  // written down, exactly as it already could for a seed no provider exposes. That
  // change is what makes a CLI-lane batch expressible at all (see the block
  // below), and it turns this case from a malformed input the lab path could
  // deliver into a legitimate state of the contract.
  const noTemperatureBatch: GenerationBatchV1 = {
    ...batch,
    temperature: null,
    temperatureNullReason: "the provider default applied on this batch",
  };

  it("mismatches a batch declaring no temperature when one was applied", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        batches: [noTemperatureBatch],
        records: [v3ApiRecordAtTemperature(0.7)],
      }),
    );
    expect(codesOf(report)).toEqual(["GENERATION_RECIPE_MISMATCH"]);
  });

  it("matches a batch declaring no temperature when none was applied", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        batches: [noTemperatureBatch],
        records: [v3ApiRecordAtTemperature(null)],
      }),
    );
    expect(codesOf(report)).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// C1 second correction round — the recipe comparison on a CLI LANE, which is
// three of the four frozen lanes and was UNSATISFIABLE.
//
// `recipeTemperature` returns `null` whenever `decoding.configurable` is false,
// and `benchmark/rebuild-v3-policy.json` sets `decodingConfigurable: false` on
// `agy`, `codex` and `gemini-cli` — only `gemini-api` is true. While
// `GenerationBatchV1.temperature` was a required `number`, the comparison
// `recipeTemperature(generation) === batch.temperature` was `null === <number>` on
// every one of those lanes: always false, no escape. There was no escape through
// the batch link either, because `collectionBatch` must be `known` in every axis
// class, so a row with no resolvable batch is refused with
// GENERATION_RECIPE_MISSING instead of skipping the comparison — and
// `calibration-pipeline.ts` / `candidate-preflight.ts` hard-fail unless readiness
// is `ready`.
//
// The previous round's coverage sat entirely on `gemini-api`, the ONE lane where
// the comparison can succeed, so the suite documented the satisfiable lane and
// left the majority lane both broken and unpinned — the same defect class that
// round was fixing, one lane over. Measured on the committed tree at 7a4d610: an
// `agy` row aligned field-for-field with its batch reported
// `{recipeTemperature: null, batchTemperature: 0.7, codes:
// [GENERATION_RECIPE_MISMATCH], status: "blocked"}`.
// ---------------------------------------------------------------------------

// A batch of the `agy` agent-CLI lane. The base v3 AI fixture IS an agy row, so
// every recipe field here is the fixture's own — nothing is aligned by hand — and
// the batch states the one thing the lane makes true: the binary takes no sampling
// flag, so no temperature was applied and here is why.
const cliLaneBatch: GenerationBatchV1 = {
  batchId: "batch_agy",
  sourceId: "src_generated",
  generationProtocolVersion: "generation-v1",
  provider: "agy",
  family: "gemini-3.5-flash-medium",
  model: "gemini-3.5-flash-medium",
  version: "gemini-3.5-flash-medium",
  promptTemplateDigest: "2".repeat(64),
  temperature: null,
  temperatureNullReason:
    "agent-CLI lane: the agy binary accepts no sampling flag",
  generatedAt: 1_784_926_573_575,
  seed: null,
  seedNullReason: "provider API does not expose a sampling seed",
};

function v3CliRecord(): BenchmarkRecord {
  const raw = v3Ai();
  raw.provenance = {
    ...(raw.provenance as Record<string, unknown>),
    sourceId: "src_generated",
    licenseId: "lic_generated_1",
  };
  return validateBenchmarkRecordV3(
    withAxis(raw, "collectionBatch", known(cliLaneBatch.batchId)),
  );
}

// The batch goes through `parseReviewedSourceManifest` and the audit is handed the
// PARSED value. That indirection is the whole point of these two tests and it is
// worth saying why, because the obvious shorter version proves nothing:
// `auditCorpusSources` never validates its input (`benchmark/lab/audit_sources.ts`
// JSON-parses and casts), so a hand-written literal carrying `temperature: null`
// compares `null === null` and reports "ready" even on the tree where the contract
// forbade such a batch — the unsatisfiability lives in the MANIFEST, not in the
// audit. Sealing through the parser is what pins the whole chain: a batch a real
// reviewed manifest can carry, matched against the row it describes.
async function sealedBatch(
  overrides: Partial<GenerationBatchV1> = {},
): Promise<GenerationBatchV1> {
  const body = {
    schemaVersion: 1 as const,
    sources: [licensedHumanSource, licensedSource, generatedSource],
    generationBatches: [{ ...cliLaneBatch, ...overrides }],
  };
  const manifest = await parseReviewedSourceManifest({
    ...body,
    sourceManifestDigest: await computeReviewedSourceManifestDigest(body),
  });
  return manifest.generationBatches[0]!;
}

describe("the recipe comparison on an agent-CLI lane, which applies no temperature", () => {
  it("matches its reviewed batch", async () => {
    const report = await auditCorpusSources(
      await buildInput({
        batches: [await sealedBatch()],
        records: [v3CliRecord()],
      }),
    );
    // The assertion the previous round could not have made: before a batch could
    // say "no temperature applied, and here is why", no sealed manifest could
    // describe an `agy`, `codex` or `gemini-cli` batch at all, and a hand-built one
    // was reported as ["GENERATION_RECIPE_MISMATCH"] / `status: "blocked"`.
    expect(codesOf(report)).toEqual([]);
    expect(report.status).toBe("ready");
  });

  it("mismatches a batch declaring a temperature the lane cannot apply", async () => {
    // The other direction, and it is not a formality: a batch claiming 0.7 on a
    // lane with no sampling flag describes a recipe that CANNOT have produced the
    // row, so the divergence has to be reported rather than waved through by a
    // comparison that stopped asking. This is the case that dies if the
    // temperature comparison is dropped from `recipeMatchesBatch`.
    const report = await auditCorpusSources(
      await buildInput({
        batches: [
          await sealedBatch({ temperature: 0.7, temperatureNullReason: null }),
        ],
        records: [v3CliRecord()],
      }),
    );
    expect(codesOf(report)).toEqual(["GENERATION_RECIPE_MISMATCH"]);
  });
});
