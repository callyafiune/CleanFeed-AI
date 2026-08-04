// Mints the two governance files ingest needs, with correct digests, from the
// governance-inputs.json emitted by assemble_corpus.py:
//   <out>/private/source-manifest.json  (reviewed source manifest v1, self-digest)
//   <out>/manifest-template.json         (dataset manifest template, NO derived fields)
//
// The source-manifest self-digest MUST come from the real helper
// (computeReviewedSourceManifestDigest -> canonicalSha256), so we build it here
// in TS rather than reimplementing canonical JSON in Python.
//
// Run: node benchmark/lab/build_governance.ts <governance-inputs.json> <out-dir>

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { argv } from "node:process";
import { join, dirname } from "node:path";

import {
  asGeneratorFamily,
  type GeneratorFamily,
} from "../generator-family.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import {
  computeReviewedSourceManifestDigest,
  type ReviewedSourceManifestBody,
} from "../source-manifest.ts";

const ACQUISITION: Record<string, "licensed" | "generated" | "consent"> = {
  "licensed-corpus": "licensed",
  "controlled-generation": "generated",
  "linkedin-contribution": "consent",
};
const LEGAL_REVIEWERS: [string, string] = ["legal_rev_1", "legal_rev_2"];

async function main(): Promise<void> {
  const [, , inputsPath, outDir] = argv;
  if (!inputsPath || !outDir) {
    throw new Error(
      "usage: build_governance.ts <governance-inputs.json> <out-dir>",
    );
  }
  const inputs = JSON.parse(await readFile(inputsPath, "utf-8")) as {
    datasetId: string;
    sources: { sourceId: string; sourceType: string; licenseId: string }[];
    heldOutGeneratorFamilies: string[];
    licenses: { id: string; name: string; url: string }[];
    // Derived from the records by assemble_corpus: one entry per distinct
    // generation recipe, which is what makes every generated record's
    // groups.collectionBatch name a batch the governance audit can match.
    generationBatches: ReviewedSourceManifestBody["generationBatches"];
  };

  // The reservation is admitted into the canonical type HERE, at the write. Typed as
  // raw `string[]` above because that is what the JSON holds, and mapped through
  // `asGeneratorFamily` because this writer is the path C2 uses: a dotted provider
  // label compiles into `manifest-template.json` otherwise and is only refused two
  // steps later, in `validateDatasetManifest`, on a file nobody edited by hand.
  // REFUSES rather than normalizes — the reservation has to be written in the same
  // spelling every other place compares by exact equality.
  const heldOutGeneratorFamilies: GeneratorFamily[] =
    inputs.heldOutGeneratorFamilies.map(asGeneratorFamily);

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

  const body: ReviewedSourceManifestBody = {
    schemaVersion: 1,
    sources: sources as ReviewedSourceManifestBody["sources"],
    generationBatches: inputs.generationBatches ?? [],
  };
  const sourceManifestDigest = await computeReviewedSourceManifestDigest(body);
  const sourceManifest = { ...body, sourceManifestDigest };

  const template = {
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
  process.stdout.write(
    `governance escrito: ${sources.length} sources, held-out=${heldOutGeneratorFamilies.join(",")}, digest=${sourceManifestDigest.slice(0, 12)}...\n`,
  );
}

void main();
