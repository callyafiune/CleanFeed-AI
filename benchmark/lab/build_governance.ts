// Mints the two governance files ingest needs, with correct digests, from the
// governance-inputs.json emitted by assemble_corpus.py:
//   <out>/private/source-manifest.json  (reviewed source manifest v2, self-digest)
//   <out>/manifest-template.json         (dataset manifest template, NO derived fields)
//
// The source-manifest self-digest MUST come from the real helper
// (computeReviewedSourceManifestDigest -> canonicalSha256), so we build it here
// in TS rather than reimplementing canonical JSON in Python.
//
// Run: node benchmark/lab/build_governance.ts <governance-inputs.json> <out-dir>

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { argv } from "node:process";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

import {
  asGeneratorFamily,
  type GeneratorFamily,
} from "../generator-family.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import {
  assertNoSourceLocator,
  computeReviewedSourceManifestDigest,
  type ReviewedSourceManifestV2,
  type SourceMaterialBatchV1,
} from "../source-manifest.ts";

const ACQUISITION: Record<string, "licensed" | "generated" | "consent"> = {
  "licensed-corpus": "licensed",
  "controlled-generation": "generated",
  "linkedin-contribution": "consent",
};
const LEGAL_REVIEWERS: [string, string] = ["legal_rev_1", "legal_rev_2"];

/** The body of the reviewed manifest, before its self-digest is appended. */
type ReviewedSourceManifestBodyV2 = Omit<
  ReviewedSourceManifestV2,
  "sourceManifestDigest"
>;

export interface GovernanceInputs {
  datasetId: string;
  sources: { sourceId: string; sourceType: string; licenseId: string }[];
  heldOutGeneratorFamilies: string[];
  licenses: { id: string; name: string; url: string }[];
  // Derived from the records by assemble_corpus: one entry per distinct
  // generation recipe, which is what makes every generated record's
  // groups.generationBatch name a batch the governance audit can match.
  generationBatches: ReviewedSourceManifestBodyV2["generationBatches"];
}

/**
 * The acquisition events of the material in frame, one entry per acquisition.
 *
 * DECLARED here and never derived from the pools, because three of the five fields —
 * `materialVersion`, `acquisitionWindow` and `evidence` — are facts about a download
 * that no code in this repository observed. A producer that synthesised them would
 * publish provenance nobody acquired.
 *
 * ONE acquisition of one snapshot is ONE batch, whatever an extractor later slices out
 * of it, and the id is keyed on the concrete version so two dumps of the same base stay
 * two acquisitions (`group_axes.material_batch_id` derives the same id on the extractor
 * side, from `--snapshot-version`).
 */
export const DECLARED_MATERIAL_BATCHES: readonly SourceMaterialBatchV1[] = [
  {
    batchId: "smb_ptwiki-20220301",
    sourceId: "src_wikipedia_pt",
    materialVersion: "ptwiki-20220301",
    // A point event: `startedAt === endedAt`, anchored on the mtime of the file on
    // disk. The mtime is EVIDENCE and not a declaration — nothing in it distinguishes
    // "downloaded then" from "copied then" — so the window is ratified rather than
    // computed, and a future acquisition declares its own.
    acquisitionWindow: { startedAt: 1784753446707, endedAt: 1784753446707 },
    // O digest do conteúdo e o arquivo com o seu tamanho: as duas formas que um terceiro
    // recomputa. Um localizador da fonte não entra — o dump concreto já está nomeado em
    // `materialVersion`, e o manifesto revisado não carrega URL.
    evidence: [
      "sha256:70c9ec4f700205ab586ab86dd21a5fe62fc543a5341770c84a28c343225f8b52",
      "ptwiki-20220301-pages-articles.xml.bz2 (1955910144 bytes)",
    ],
  },
];

/** Coded, fail-closed refusal raised before either governance file is written. */
export class GovernanceInputError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GovernanceInputError";
    this.code = code;
  }
}

/**
 * The reviewed manifest body, at schema **v2**.
 *
 * `materialBatches` arrives by parameter rather than being read straight off
 * `DECLARED_MATERIAL_BATCHES`, so the two refusals below can be exercised against a
 * list that is not the embedded one: against the embedded list alone, a writer that
 * skipped the checks answers exactly like one that runs them.
 */
export function reviewedSourceManifestBodyOf(
  inputs: GovernanceInputs,
  materialBatches: readonly SourceMaterialBatchV1[],
): ReviewedSourceManifestBodyV2 {
  const sources = inputs.sources.map((s) => ({
    sourceId: s.sourceId,
    sourceType: s.sourceType as
      "licensed-corpus" | "controlled-generation" | "linkedin-contribution",
    acquisition: ACQUISITION[s.sourceType],
    evaluationUseApproved: true as const,
    licenseId: s.licenseId,
    consentReceiptDigest: null,
    collectionProtocolVersion: "collection-v1" as const,
    legalReviewerIds: LEGAL_REVIEWERS,
  }));

  // An EMPTY inventory is expressible in the schema and means "no acquisition was
  // declared", which is a state no v4 corpus can be built against: every human row
  // names `groups.sourceMaterialBatch` and the audit blocks each one with
  // SOURCE_REFERENCE_MISSING. Writing it would hand the operator a manifest whose
  // own digest certifies the gap.
  if (materialBatches.length === 0) {
    throw new GovernanceInputError(
      "MATERIAL_BATCHES_EMPTY",
      "materialBatches is empty: a v2 manifest declares the acquisition inventory, " +
        "and every v4 human row names a batch that resolves against it, so an empty " +
        "inventory blocks the whole human class instead of shipping one row",
    );
  }

  const declaredSourceIds = new Set(sources.map((source) => source.sourceId));
  for (const batch of materialBatches) {
    if (!declaredSourceIds.has(batch.sourceId)) {
      throw new GovernanceInputError(
        "MATERIAL_BATCH_SOURCE_UNDECLARED",
        `material batch ${batch.batchId} names sourceId "${batch.sourceId}", which ` +
          `this manifest does not declare (${[...declaredSourceIds].sort().join(", ") || "no source at all"}): ` +
          "a batch whose source is undeclared has no reviewed provenance",
      );
    }
  }

  const body: ReviewedSourceManifestBodyV2 = {
    schemaVersion: 2,
    sources: sources as ReviewedSourceManifestBodyV2["sources"],
    generationBatches: inputs.generationBatches ?? [],
    materialBatches: [...materialBatches],
  };
  // A mesma operação que o parser chama, sobre o mesmo corpo, e aqui ela roda ANTES do primeiro
  // `mkdir`: o que o parser recusa, o escritor não escreve. Importa porque `governance-inputs.json`
  // vem do lado Python — um `licenseId` ou um `model` com URL vindo de lá é recusado na escrita, e
  // não dois passos depois, num arquivo que ninguém editou à mão.
  //
  // O erro do módulo do manifesto PROPAGA em vez de ser reembrulhado em `GovernanceInputError`: a
  // recusa é do manifesto, e um segundo código para uma condição só produziria duas semânticas.
  assertNoSourceLocator(body);
  return body;
}

export function datasetManifestTemplateOf(
  inputs: GovernanceInputs,
): Record<string, unknown> {
  // The reservation is admitted into the canonical type HERE, at the write. Typed as
  // raw `string[]` on the input because that is what the JSON holds, and mapped through
  // `asGeneratorFamily` because this writer is the path C2 uses: a dotted provider
  // label compiles into `manifest-template.json` otherwise and is only refused two
  // steps later, in `validateDatasetManifest`, on a file nobody edited by hand.
  // REFUSES rather than normalizes — the reservation has to be written in the same
  // spelling every other place compares by exact equality.
  //
  // An EMPTY reservation is admitted here on purpose, and it is not the same admission:
  // this writer also runs over a human-only intermediate, where there is no generated
  // family to reserve. `validateDatasetManifest` refuses the empty list at the seal, which
  // is the step that must not pass without a reservation; refusing it here would make the
  // intermediate unwritable and would move the refusal to a stage that has no remedy.
  const heldOutGeneratorFamilies: GeneratorFamily[] =
    inputs.heldOutGeneratorFamilies.map(asGeneratorFamily);

  return {
    schemaVersion: 1,
    datasetId: inputs.datasetId,
    version: "1.0.0",
    scientificUse: "release",
    intendedLanguage: "pt-BR",
    intendedDomain: PREREGISTRATION_V4.dataset.intendedDomain,
    createdAt: "2026-07-24T00:00:00.000Z",
    normalizationVersion: "cleanfeed-text-v1",
    annotationProtocolVersion: "annotation-v1",
    heldOutGeneratorFamilies,
    licenses: inputs.licenses.map((l) => ({
      id: l.id,
      name: l.name,
      source: l.url,
      evaluationUseApproved: true,
      redistribution: "not-published",
      notice:
        "Uso exclusivo de avaliacao local; o corpus nao e redistribuido; " +
        "atribuicao coletiva registrada. Share-alike nao acionado (sem redistribuicao).",
    })),
  };
}

/**
 * No refusal leaves a file behind.
 *
 * Every refusal fires before the first `mkdir`, so a rejected inventory leaves no
 * half-written manifest for a later step to pick up as if it had been reviewed.
 *
 * The two writes are NOT atomic with respect to each other: an I/O failure on the second
 * leaves a reviewed manifest with a correct digest and no template beside it, and nothing
 * here rolls that back. What is guaranteed is the refusal path, which is what the tests
 * assert.
 */
export async function writeGovernance(
  inputs: GovernanceInputs,
  outDir: string,
  materialBatches: readonly SourceMaterialBatchV1[],
): Promise<{ sources: number; heldOut: string[]; digest: string }> {
  const body = reviewedSourceManifestBodyOf(inputs, materialBatches);
  const template = datasetManifestTemplateOf(inputs);
  const sourceManifestDigest = await computeReviewedSourceManifestDigest(body);
  const sourceManifest = { ...body, sourceManifestDigest };

  const privateDir = join(outDir, "private");
  await mkdir(privateDir, { recursive: true });
  await writeFile(
    join(privateDir, "source-manifest.json"),
    JSON.stringify(sourceManifest, null, 2) + "\n",
    "utf-8",
  );
  await writeFile(
    join(outDir, "manifest-template.json"),
    JSON.stringify(template, null, 2) + "\n",
    "utf-8",
  );
  return {
    sources: body.sources.length,
    heldOut: template.heldOutGeneratorFamilies as string[],
    digest: sourceManifestDigest,
  };
}

async function main(): Promise<void> {
  const [, , inputsPath, outDir] = argv;
  if (!inputsPath || !outDir) {
    throw new Error(
      "usage: build_governance.ts <governance-inputs.json> <out-dir>",
    );
  }
  const inputs = JSON.parse(
    await readFile(inputsPath, "utf-8"),
  ) as GovernanceInputs;
  const written = await writeGovernance(
    inputs,
    outDir,
    DECLARED_MATERIAL_BATCHES,
  );
  process.stdout.write(
    `governance escrito: manifesto v2, ${written.sources} sources, ` +
      `${DECLARED_MATERIAL_BATCHES.length} lote(s) de material, ` +
      `held-out=${written.heldOut.join(",")}, digest=${written.digest.slice(0, 12)}...\n`,
  );
}

// Importing this module must not run the writer: the refusals are asserted by a test
// that calls `writeGovernance` directly, and a top-level `main()` would throw the
// usage error on import.
if (argv[1] !== undefined && argv[1] === fileURLToPath(import.meta.url)) {
  void main();
}
