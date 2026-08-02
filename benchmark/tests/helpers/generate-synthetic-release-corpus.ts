// Deterministic synthetic release-corpus generator for the Task 13 scale smoke.
//
// It writes a 10,000-record infrastructure corpus (4,000 human / 4,000 ai /
// 2,000 mixed) whose records seal under the closed schema, laid out in the five
// blocked partitions with zero leakage. Determinism is total: every byte is a pure
// function of the record index and the seed — no Date, no randomness — so
// re-running produces byte-identical files and digests.
//
// The corpus is `scientificUse: "infrastructure-only"` and can NEVER be release
// eligible; it exists solely to exercise the pipeline at scale. It writes ONLY
// under benchmark/work/ and refuses any output path outside it.
//
// One temporal block per partition, so the splitter finds its four cuts BETWEEN
// them and the audit measures exactly 45/5/10/20/20 per class.
//
// WHAT THIS CORPUS CANNOT REACH, and it is not a defect of this file: the pre-registered
// human-negative threshold for a released FPR bound is 2,000 inside the blocked test,
// and test holds at most (0.20 + 0.02) x 4,000 = 880 of them. The audit PUBLISHES that
// count rather than failing on it, so the corpus still seals. Raising the human count is
// not available here either — `sealDataset` pins the composition at 4,000 / 4,000 /
// 2,000 for every corpus, release or not. So this corpus seals and splits, and publishes a
// human-negative count below the threshold for a released FPR bound — which is a true
// description of it, not a failure of this generator.
//
// Standalone benchmark support: MUST NOT import from the extension bundle (src/).

import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { argv, cwd, exit, stderr, stdout } from "node:process";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { canonicalSha256 } from "../../../contracts/canonical-json.ts";
import type { DatasetManifest } from "../../dataset-manifest.ts";
import type { BenchmarkRecordV2 } from "../../schema.ts";
import {
  asGeneratorFamily,
  normalizeGeneratorFamily,
} from "../../generator-family.ts";

const REPO_ROOT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
);
const WORK_ROOT = join(REPO_ROOT, "benchmark", "work");

const DATASET_ID = "ptbr-generic-synthetic-v1";
const LICENSE_ID = "synthetic-consent-v1";
const HELDOUT_FAMILY = "synthetic-heldout-family";

const TRAIN_TIME = 1_000;
const DEV_TIME = 2_000;
const CAL_A_TIME = 3_000;
const CAL_B_TIME = 4_000;
const TEST_TIME = 5_000;

const HUMAN_SOURCE_TYPES = [
  "qa-informal",
  "encyclopedic",
  "social-media",
  "university",
  "institutional",
] as const;
const HARD_NEGATIVE_FAMILIES = [
  "formulaic",
  "motivational",
  "highly-polished",
  "repetitive",
  "non-native",
  "corporate-structure",
] as const;

interface Block {
  createdAt: number;
  human: number;
  ai: number;
  mixed: number;
}

// 4,000 / 4,000 / 2,000 spread 45/5/10/20/20 across the five temporal blocks.
const BLOCKS: readonly Block[] = [
  { createdAt: TRAIN_TIME, human: 1_800, ai: 1_800, mixed: 900 },
  { createdAt: DEV_TIME, human: 200, ai: 200, mixed: 100 },
  { createdAt: CAL_A_TIME, human: 400, ai: 400, mixed: 200 },
  { createdAt: CAL_B_TIME, human: 800, ai: 800, mixed: 400 },
  { createdAt: TEST_TIME, human: 800, ai: 800, mixed: 400 },
];

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function paddedId(index: number): string {
  return `r${index.toString().padStart(6, "0")}`;
}

function buildText(id: string, seed: number, label: string): string {
  const tokens: string[] = [];
  for (let i = 0; i < 60; i += 1) tokens.push(`${label}_${id}_${seed}_${i}`);
  return `Registro sintetico ${id} (${label}). ${tokens.join(" ")}`;
}

interface GeneratedCorpus {
  records: BenchmarkRecordV2[];
  counts: { human: number; ai: number; mixed: number };
}

export function generateRecords(seed: number): GeneratedCorpus {
  const records: BenchmarkRecordV2[] = [];
  const counts = { human: 0, ai: 0, mixed: 0 };
  let index = 0;

  for (const block of BLOCKS) {
    const blockStart = index;
    const humanIds: string[] = [];

    // Humans first so mixed records in the same block can name an existing
    // parent that shares this block's timestamp (component stays in-partition).
    for (let n = 0; n < block.human; n += 1) {
      const id = paddedId(index);
      humanIds.push(id);
      records.push(humanRecord(id, seed, block.createdAt, blockStart + n));
      counts.human += 1;
      index += 1;
    }
    for (let n = 0; n < block.ai; n += 1) {
      const id = paddedId(index);
      const heldOut = block.createdAt === TEST_TIME && n % 4 === 0;
      records.push(aiRecord(id, seed, block.createdAt, n, heldOut));
      counts.ai += 1;
      index += 1;
    }
    for (let n = 0; n < block.mixed; n += 1) {
      const id = paddedId(index);
      const parentId = humanIds[n % humanIds.length];
      records.push(mixedRecord(id, seed, block.createdAt, parentId));
      counts.mixed += 1;
      index += 1;
    }
  }

  return { records, counts };
}

function baseGroups(id: string): BenchmarkRecordV2["groups"] {
  // Every value axis is unique per record, so the only union comes from a
  // mixed record naming its parent — always within the same temporal block.
  return {
    author: `author_${id}`,
    source: `source_${id}`,
    domainSource: `domainsource_${id}`,
    collectionBatch: `batch_${id}`,
    nearDuplicate: `nd_${id}`,
    derivationRoot: id,
  };
}

function provenance(
  id: string,
  createdAt: number,
  sourceKind: BenchmarkRecordV2["provenance"]["sourceKind"],
  legalBasis: BenchmarkRecordV2["provenance"]["legalBasis"],
): BenchmarkRecordV2["provenance"] {
  return {
    sourceKind,
    sourceId: `src_${id}`,
    sourceRevision: "rev_001",
    collectedAt: createdAt,
    licenseId: LICENSE_ID,
    legalBasis,
    piiAudit: {
      status: "passed",
      method: "manual-and-automated",
      reviewerId: "reviewer_pii",
      reviewedAt: createdAt,
    },
  };
}

const ANNOTATION: BenchmarkRecordV2["annotation"] = {
  protocolVersion: "annotation-v1",
  reviewerIds: ["reviewer_a", "reviewer_b"],
  agreement: "agree",
};

function humanRecord(
  id: string,
  seed: number,
  createdAt: number,
  ordinal: number,
): BenchmarkRecordV2 {
  const text = buildText(id, seed, "human");
  const record: BenchmarkRecordV2 = {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256: sha256Hex(text),
    label: "human",
    language: "pt-BR",
    platform: "generic",
    domain: "corporate",
    topic: "geral",
    humanSourceType: HUMAN_SOURCE_TYPES[ordinal % HUMAN_SOURCE_TYPES.length],
    wordCount: 60,
    createdAt,
    provenance: provenance(id, createdAt, "authorized-contribution", "consent"),
    annotation: ANNOTATION,
    transformation: { kind: "none", severity: "none" },
    groups: baseGroups(id),
  };
  // Give a rotating slice of humans a hard-negative family for coverage.
  if (ordinal % 3 === 0) {
    record.hardNegativeFamily =
      HARD_NEGATIVE_FAMILIES[ordinal % HARD_NEGATIVE_FAMILIES.length];
  }
  return record;
}

function aiRecord(
  id: string,
  seed: number,
  createdAt: number,
  ordinal: number,
  heldOut: boolean,
): BenchmarkRecordV2 {
  const text = buildText(id, seed, "ai");
  // The provider's label and the canonical field are the SAME fact written once:
  // the schema refuses a generated record whose groups.generatorFamily is not the
  // canonical form of its generation.family.
  const family = heldOut ? HELDOUT_FAMILY : `seen_family_${ordinal % 3}`;
  const canonicalFamily = normalizeGeneratorFamily(family);
  return {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256: sha256Hex(text),
    label: "ai",
    language: "pt-BR",
    platform: "generic",
    domain: "corporate",
    topic: "geral",
    wordCount: 60,
    createdAt,
    provenance: provenance(id, createdAt, "controlled-generation", "generated"),
    annotation: ANNOTATION,
    generation: {
      provider: "synthetic",
      family,
      model: "synthetic-model",
      version: "v1",
      promptId: `prompt_${id}`,
      promptSha256: sha256Hex(`prompt_${id}_${seed}`),
      generatedAt: createdAt,
    },
    transformation: { kind: "none", severity: "none" },
    groups: { ...baseGroups(id), generatorFamily: canonicalFamily },
  };
}

function mixedRecord(
  id: string,
  seed: number,
  createdAt: number,
  parentId: string,
): BenchmarkRecordV2 {
  const text = buildText(id, seed, "mixed");
  const groups = baseGroups(id);
  groups.derivationRoot = parentId;
  return {
    schemaVersion: 2,
    id,
    text,
    normalizedTextSha256: sha256Hex(text),
    label: "mixed",
    language: "pt-BR",
    platform: "generic",
    domain: "corporate",
    topic: "geral",
    wordCount: 60,
    createdAt,
    provenance: provenance(id, createdAt, "controlled-generation", "generated"),
    annotation: ANNOTATION,
    mixture: {
      aiFraction: 0.6,
      humanFraction: 0.4,
      spans: [{ start: 0, end: 5, origin: "ai" }],
      generationMode: "mechanistic",
    },
    transformation: { kind: "human-ai-mix", severity: "medium" },
    groups,
  };
}

async function writeCorpus(
  outputDirectory: string,
  seed: number,
): Promise<{ human: number; ai: number; mixed: number }> {
  const { records, counts } = generateRecords(seed);

  const recordsJsonl = `${records
    .map((record) => JSON.stringify(record))
    .join("\n")}\n`;
  const reviewLedgerJsonl = `${records
    .map((record) =>
      JSON.stringify({
        recordId: record.id,
        reviewerIds: record.annotation.reviewerIds,
        agreement: record.annotation.agreement,
      }),
    )
    .join("\n")}\n`;

  const sourceManifestBody = {
    schemaVersion: 1,
    corpus: DATASET_ID,
    seed,
    sources: [
      { id: "consent", kind: "authorized-contribution" },
      { id: "generated", kind: "controlled-generation" },
    ],
    note: "synthetic infrastructure corpus; no real content",
  };
  const sourceManifestJson = `${JSON.stringify(
    {
      ...sourceManifestBody,
      sourceManifestDigest: await canonicalSha256(sourceManifestBody),
    },
    null,
    2,
  )}\n`;

  const manifest: DatasetManifest = {
    schemaVersion: 1,
    datasetId: DATASET_ID,
    version: "1.0.0",
    scientificUse: "infrastructure-only",
    intendedLanguage: "pt-BR",
    intendedDomain: "generic",
    createdAt: "2026-07-19T00:00:00.000Z",
    normalizationVersion: "cleanfeed-text-v1",
    annotationProtocolVersion: "annotation-v1",
    recordsFile: "records.jsonl",
    recordsSha256: sha256Hex(recordsJsonl),
    reviewLedgerFile: "private/review-ledger.jsonl",
    reviewLedgerSha256: sha256Hex(reviewLedgerJsonl),
    sourceManifestFile: "private/source-manifest.json",
    sourceManifestSha256: sha256Hex(sourceManifestJson),
    heldOutGeneratorFamilies: [asGeneratorFamily(HELDOUT_FAMILY)],
    licenses: [
      {
        id: LICENSE_ID,
        name: "Synthetic consent (infrastructure only)",
        source: "synthetic://consent",
        evaluationUseApproved: true,
        redistribution: "not-published",
        notice: "Synthetic records generated for infrastructure testing only.",
      },
    ],
  };

  await mkdir(join(outputDirectory, "private"), { recursive: true });
  await writeFile(join(outputDirectory, "records.jsonl"), recordsJsonl, "utf8");
  await writeFile(
    join(outputDirectory, "private", "review-ledger.jsonl"),
    reviewLedgerJsonl,
    "utf8",
  );
  await writeFile(
    join(outputDirectory, "private", "source-manifest.json"),
    sourceManifestJson,
    "utf8",
  );
  await writeFile(
    join(outputDirectory, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );

  return counts;
}

function parseArgs(args: readonly string[]): { output: string; seed: number } {
  let output: string | undefined;
  let seed: number | undefined;
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === "--output") {
      output = args[i + 1];
      i += 1;
    } else if (args[i] === "--seed") {
      seed = Number(args[i + 1]);
      i += 1;
    }
  }
  if (output === undefined || output === "") {
    throw new Error("--output <dir> is required");
  }
  if (seed === undefined || !Number.isFinite(seed)) {
    throw new Error("--seed <number> is required");
  }
  return { output, seed };
}

// Refuses any output that does not resolve under benchmark/work/.
function assertUnderWork(outputDirectory: string): string {
  const resolved = resolve(cwd(), outputDirectory);
  if (resolved !== WORK_ROOT && !resolved.startsWith(`${WORK_ROOT}${sep}`)) {
    throw new Error(`refusing to write outside benchmark/work/: ${resolved}`);
  }
  return resolved;
}

export async function main(args: readonly string[]): Promise<void> {
  const { output, seed } = parseArgs(args);
  const resolved = assertUnderWork(output);
  const counts = await writeCorpus(resolved, seed);
  stdout.write(`human=${counts.human} ai=${counts.ai} mixed=${counts.mixed}\n`);
}

if (argv[1] !== undefined && argv[1] === fileURLToPath(import.meta.url)) {
  main(argv.slice(2)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`generate-synthetic-release-corpus failed: ${message}\n`);
    exit(1);
  });
}
