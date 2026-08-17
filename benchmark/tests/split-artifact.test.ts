import { mkdtemp, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  COMPOSITION_BOUNDS_NOT_MET,
  COMPOSITION_GATE_PARTITION,
  compositionBoundsOf,
  compositionBreachesOf,
  type CellComposition,
  type CompositionReport,
} from "../composition-gate.ts";
import {
  computeDatasetAuditDigest,
  emptyLabelBasisPublication,
  type DatasetAudit,
} from "../dataset-manifest.ts";
import { runSplit } from "../commands/split.ts";
import {
  assertSplitArtifactSelfConsistent,
  buildSplitArtifact,
  SplitArtifactError,
  validateSplitArtifact,
  withoutSplitDigest,
  type SplitArtifact,
  type SplitAssignment,
} from "../split-artifact.ts";
import {
  auditBlockedSplit,
  type SplitAudit,
  type SplitAuditPolicy,
} from "../split-audit.ts";
import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import {
  PARTITIONS,
  createBlockedSplit,
  type BlockedSplitPolicy,
  type DatasetSplit,
  type Partition,
} from "../split.ts";
import type { DatasetManifest } from "../dataset-manifest.ts";
import {
  groupAxisIdentity,
  type BenchmarkLabel,
  type BenchmarkRecord,
  type TransformationKind,
} from "../schema.ts";
import {
  asGeneratorFamily,
  normalizeGeneratorFamily,
  type GeneratorFamily,
} from "../generator-family.ts";

const SHA = "a".repeat(64);
/** The quota cells the frozen frame declares, read from the policy and never written out. */
const DECLARED_CELLS = PREREGISTRATION_V4.preRegistration.quotaAxis.cells;

const MANIFEST: DatasetManifest = {
  schemaVersion: 1,
  datasetId: "cleanfeed-ptbr-cells-v1",
  version: "1.0.0",
  scientificUse: "infrastructure-only",
  intendedLanguage: "pt-BR",
  intendedDomain: "scoped-cells",
  createdAt: "2026-07-19T00:00:00.000Z",
  normalizationVersion: "cleanfeed-text-v1",
  annotationProtocolVersion: "annotation-v1",
  recordsFile: "records.jsonl",
  recordsSha256: "1".repeat(64),
  reviewLedgerFile: "private/review-ledger.jsonl",
  reviewLedgerSha256: "2".repeat(64),
  sourceManifestFile: "private/source-manifest.json",
  sourceManifestSha256: "3".repeat(64),
  heldOutGeneratorFamilies: [asGeneratorFamily("family-unseen")],
  licenses: [
    {
      id: "cc-by",
      name: "CC BY",
      source: "fixture://license",
      evaluationUseApproved: true,
      redistribution: "allowed",
      notice: "fixture-only",
    },
  ],
};

interface RecordSpec {
  id: string;
  label: BenchmarkLabel;
  createdAt: number;
  domain: string;
  wordCount: number;
  humanSourceType?: string;
  hardNegativeFamily?: string;
  transformationKind?: TransformationKind;
  family?: string;
  aiFraction?: number;
  author: string;
  source: string;
  domainSource: string;
  collectionBatch: string;
  nearDuplicate: string;
  derivationRoot: string;
  generatorVersion?: string;
  promptTemplate?: string;
}

function rec(spec: RecordSpec): BenchmarkRecord {
  const kind: TransformationKind = spec.transformationKind ?? "none";
  const record: BenchmarkRecord = {
    schemaVersion: 2,
    id: spec.id,
    text: `texto ${spec.id}`,
    normalizedTextSha256: SHA,
    label: spec.label,
    language: "pt-BR",
    platform: "generic",
    domain: spec.domain,
    topic: "carreira",
    wordCount: spec.wordCount,
    createdAt: spec.createdAt,
    provenance: {
      sourceKind: "licensed-corpus",
      sourceId: "src",
      sourceRevision: "rev1",
      collectedAt: spec.createdAt,
      licenseId: "cc-by",
      legalBasis: "license",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "rev1",
        reviewedAt: spec.createdAt,
      },
    },
    annotation: {
      protocolVersion: "annotation-v1",
      reviewerIds: ["rev1", "rev2"],
      agreement: "agree",
    },
    transformation: {
      kind,
      severity: kind === "none" ? "none" : "medium",
    },
    groups: {
      author: spec.author,
      source: spec.source,
      domainSource: spec.domainSource,
      collectionBatch: spec.collectionBatch,
      nearDuplicate: spec.nearDuplicate,
      derivationRoot: spec.derivationRoot,
    },
  };
  if (spec.humanSourceType !== undefined) {
    record.humanSourceType = spec.humanSourceType;
  }
  if (spec.hardNegativeFamily !== undefined) {
    record.hardNegativeFamily = spec.hardNegativeFamily;
  }
  if (spec.generatorVersion !== undefined) {
    record.groups.generatorVersion = spec.generatorVersion;
  }
  if (spec.promptTemplate !== undefined) {
    record.groups.promptTemplate = spec.promptTemplate;
  }
  if (spec.family !== undefined) {
    // Both fields, as a valid record carries them: the provider's own label inside
    // the recipe, and the CANONICAL token in groups — the only field the splitter,
    // the audit and the slices read (benchmark/generator-family.ts). A fixture that
    // set only `generation.family` modelled a record the schema now refuses.
    record.generation = {
      provider: "acme",
      family: spec.family,
      model: `${spec.family}-model`,
      version: spec.generatorVersion ?? "v1",
      promptId: "prompt1",
      promptSha256: SHA,
      generatedAt: spec.createdAt,
    };
    record.groups.generatorFamily = normalizeGeneratorFamily(spec.family);
  }
  if (spec.aiFraction !== undefined) {
    record.mixture = {
      aiFraction: spec.aiFraction,
      humanFraction: Number((1 - spec.aiFraction).toFixed(4)),
      spans: [],
      generationMode: "mechanistic",
    };
  }
  return record;
}

// Release-scale corpus: enough human negatives that the 20% blocked test carries
// >=2000, every critical slice keeps its floor, and the audit passes.
function buildReleaseDataset(): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  const SLOTS = 100;
  // 105, not 46. The audit floor is 2000 human negatives inside the blocked test, and
  // test is 20% of the corpus rather than 50% — so the smallest corpus that clears the
  // floor now holds >= 10 000 humans. This fixture seals nothing, so it is free to be
  // that large.
  const perHuman = 105;
  const perAi = 15;
  const perMixed = 10;
  const lengths = [40, 180, 520];
  const aiKinds: TransformationKind[] = [
    "paraphrase",
    "back-translation",
    "expand",
  ];

  for (let slot = 1; slot <= SLOTS; slot += 1) {
    for (let i = 0; i < perHuman; i += 1) {
      records.push(
        rec({
          id: `h_${slot}_${i}`,
          label: "human",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: lengths[i % 3],
          humanSourceType: i % 2 === 0 ? "employee-post" : "newsletter",
          hardNegativeFamily: i % 2 === 0 ? "hn-legal" : "hn-marketing",
          author: `auth_h_${slot}_${i}`,
          source: `src_h_${slot}`,
          domainSource: `ds_h_${slot}`,
          collectionBatch: `cb_h_${slot}`,
          nearDuplicate: `nd_h_${slot}_${i}`,
          derivationRoot: `h_${slot}_${i}`,
        }),
      );
    }
    for (let i = 0; i < perAi; i += 1) {
      records.push(
        rec({
          id: `a_${slot}_${i}`,
          label: "ai",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: [50, 200, 480][i % 3],
          transformationKind: aiKinds[i % 3],
          family: "family-seen",
          author: `auth_a_${slot}_${i}`,
          source: `src_a_${slot}`,
          domainSource: `ds_a_${slot}`,
          collectionBatch: `cb_a_${slot}`,
          nearDuplicate: `nd_a_${slot}_${i}`,
          derivationRoot: `a_${slot}_${i}`,
          generatorVersion: `gv_seen_${slot}`,
          promptTemplate: `pt_a_${slot}`,
        }),
      );
    }
    for (let i = 0; i < perMixed; i += 1) {
      records.push(
        rec({
          id: `m_${slot}_${i}`,
          label: "mixed",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: [60, 220, 500][i % 3],
          transformationKind: "human-ai-mix",
          family: "family-seen",
          aiFraction: i % 2 === 0 ? 0.7 : 0.4,
          author: `auth_m_${slot}_${i}`,
          source: `src_m_${slot}`,
          domainSource: `ds_m_${slot}`,
          collectionBatch: `cb_m_${slot}`,
          nearDuplicate: `nd_m_${slot}_${i}`,
          derivationRoot: `m_${slot}_${i}`,
          promptTemplate: `pt_m_${slot}`,
        }),
      );
    }
  }
  for (let slot = 96; slot <= SLOTS; slot += 1) {
    for (let i = 0; i < 4; i += 1) {
      records.push(
        rec({
          id: `u_${slot}_${i}`,
          label: "ai",
          createdAt: slot,
          domain: "linkedin",
          wordCount: 300,
          transformationKind: "paraphrase",
          family: "family-unseen",
          author: `auth_u_${slot}_${i}`,
          source: `src_u_${slot}_${i}`,
          domainSource: `ds_u_${slot}_${i}`,
          collectionBatch: `cb_u_${slot}_${i}`,
          nearDuplicate: `nd_u_${slot}_${i}`,
          derivationRoot: `u_${slot}_${i}`,
          generatorVersion: `gv_unseen_${slot}`,
          promptTemplate: `pt_u_${slot}`,
        }),
      );
    }
  }
  return records;
}

/**
 * Release-scale corpus OF THE DECLARED QUOTA CELL, and the three differences from
 * {@link buildReleaseDataset} are exactly what the composition gate counts: every human
 * negative carries `humanSourceType` = the declared cell, and `source`, `domainSource` and
 * `collectionBatch` are per RECORD-LINE instead of per slot.
 *
 * The second half is not cosmetic: `source` IS the origin document, so 105 human lines sharing
 * one `source` are one document against a cap of one line per document AND one connected
 * component against a floor counted in components. A separate builder rather than a parameter
 * on the other one, because `RELEASE_SPLIT` and `RELEASE_AUDIT` are derived from it and dozens
 * of cases in this file are written against those.
 */
function buildPtwikiReleaseDataset(): BenchmarkRecord[] {
  const records: BenchmarkRecord[] = [];
  const SLOTS = 100;
  const perHuman = 105;
  const perAi = 15;
  const perMixed = 10;
  // 40 is BELOW the pre-registered word floor, so a third of the human lines are ones the
  // measurement abstains on: the receipt has to publish them apart from the counted ones.
  const lengths = [40, 180, 520];
  const aiKinds: TransformationKind[] = [
    "paraphrase",
    "back-translation",
    "expand",
  ];

  for (let slot = 1; slot <= SLOTS; slot += 1) {
    for (let i = 0; i < perHuman; i += 1) {
      records.push(
        rec({
          id: `h_${slot}_${i}`,
          label: "human",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: lengths[i % 3],
          humanSourceType: DECLARED_CELLS[0],
          hardNegativeFamily: i % 2 === 0 ? "hn-legal" : "hn-marketing",
          author: `auth_h_${slot}_${i}`,
          source: `src_h_${slot}_${i}`,
          domainSource: `ds_h_${slot}_${i}`,
          collectionBatch: `cb_h_${slot}_${i}`,
          nearDuplicate: `nd_h_${slot}_${i}`,
          derivationRoot: `h_${slot}_${i}`,
        }),
      );
    }
    for (let i = 0; i < perAi; i += 1) {
      records.push(
        rec({
          id: `a_${slot}_${i}`,
          label: "ai",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: [50, 200, 480][i % 3],
          transformationKind: aiKinds[i % 3],
          family: "family-seen",
          author: `auth_a_${slot}_${i}`,
          source: `src_a_${slot}_${i}`,
          domainSource: `ds_a_${slot}_${i}`,
          collectionBatch: `cb_a_${slot}_${i}`,
          nearDuplicate: `nd_a_${slot}_${i}`,
          derivationRoot: `a_${slot}_${i}`,
          generatorVersion: `gv_seen_${slot}`,
          promptTemplate: `pt_a_${slot}`,
        }),
      );
    }
    for (let i = 0; i < perMixed; i += 1) {
      records.push(
        rec({
          id: `m_${slot}_${i}`,
          label: "mixed",
          createdAt: slot,
          domain: i % 2 === 0 ? "corporate" : "linkedin",
          wordCount: [60, 220, 500][i % 3],
          transformationKind: "human-ai-mix",
          family: "family-seen",
          aiFraction: i % 2 === 0 ? 0.7 : 0.4,
          author: `auth_m_${slot}_${i}`,
          source: `src_m_${slot}_${i}`,
          domainSource: `ds_m_${slot}_${i}`,
          collectionBatch: `cb_m_${slot}_${i}`,
          nearDuplicate: `nd_m_${slot}_${i}`,
          derivationRoot: `m_${slot}_${i}`,
          promptTemplate: `pt_m_${slot}`,
        }),
      );
    }
  }
  for (let slot = 96; slot <= SLOTS; slot += 1) {
    for (let i = 0; i < 4; i += 1) {
      records.push(
        rec({
          id: `u_${slot}_${i}`,
          label: "ai",
          createdAt: slot,
          domain: "linkedin",
          wordCount: 300,
          transformationKind: "paraphrase",
          family: "family-unseen",
          author: `auth_u_${slot}_${i}`,
          source: `src_u_${slot}_${i}`,
          domainSource: `ds_u_${slot}_${i}`,
          collectionBatch: `cb_u_${slot}_${i}`,
          nearDuplicate: `nd_u_${slot}_${i}`,
          derivationRoot: `u_${slot}_${i}`,
          generatorVersion: `gv_unseen_${slot}`,
          promptTemplate: `pt_u_${slot}`,
        }),
      );
    }
  }
  return records;
}

// Human-light corpus: only 100 human records, so the blocked test can never reach
// the 2000-negative floor and the audit fails while every partition stays
// non-empty (so cutoffs remain finite and the artifact still builds).

const POLICY: BlockedSplitPolicy = {
  fractions: {
    train: 0.45,
    dev: 0.05,
    "cal-A": 0.1,
    "cal-B": 0.2,
    test: 0.2,
  },
  classTolerance: 0.02,
  heldOutGeneratorFamilies: [asGeneratorFamily("family-unseen")],
  seed: PREREGISTRATION_V4.seeds.split,
};

const AUDIT_POLICY: SplitAuditPolicy = {
  minimumTestHumanNegatives: 2_000,
  minimumCriticalFprNegatives: 300,
  minimumCriticalRecallPositives: 200,
  classTolerance: 0.02,
};

const RELEASE_DATASET = buildReleaseDataset();
const RELEASE_SPLIT = createBlockedSplit(RELEASE_DATASET, POLICY);
const RELEASE_AUDIT = auditBlockedSplit(
  RELEASE_DATASET,
  RELEASE_SPLIT,
  AUDIT_POLICY,
  POLICY.heldOutGeneratorFamilies,
);

const PTWIKI_DATASET = buildPtwikiReleaseDataset();
const PTWIKI_SPLIT = createBlockedSplit(PTWIKI_DATASET, POLICY);
const PTWIKI_AUDIT = auditBlockedSplit(
  PTWIKI_DATASET,
  PTWIKI_SPLIT,
  AUDIT_POLICY,
  POLICY.heldOutGeneratorFamilies,
);
const PTWIKI_MANIFEST: DatasetManifest = {
  ...MANIFEST,
  scientificUse: "release",
};

/**
 * The counts the FIXTURE puts in the blind block, derived from the records rather than from
 * the gate: a human line is counted when it clears the pre-registered word floor, and every
 * human line of this corpus carries its own `source`, so each counted line is one origin
 * document and one component.
 */
function ptwikiBlindBlockCounts(): {
  eligible: number;
  ineligible: number;
} {
  const humans = PTWIKI_SPLIT.test.filter((record) => record.label === "human");
  const floor = PREREGISTRATION_V4.wordFloor.abstainBelow;
  return {
    eligible: humans.filter((record) => record.wordCount >= floor).length,
    ineligible: humans.filter((record) => record.wordCount < floor).length,
  };
}

/**
 * A corpus of 300 singletons whose blocked split PASSES the leakage audit, so the only thing
 * left that can refuse it is the composition of its blind block — where the declared quota cell
 * holds nothing, because every human line carries another `humanSourceType`.
 *
 * Small on purpose: the site test writes it to disk and re-parses it through the command's own
 * parsers, and what it has to exercise is the refusal, not the scale.
 */
function buildShortReleaseDataset(): BenchmarkRecord[] {
  // Human and ai only. A `mixed` record is refused by `parseBenchmarkDataset` unless its
  // `derivationRoot` names a PARENT record-line, and `assertDerivedParentsResolve` then demands
  // that parent be in the corpus — which unions the pair into one component and is a different
  // fixture's subject. A class with no record-line publishes zeros the audit skips as vacuous.
  return Array.from({ length: 300 }, (_, index) => {
    const label: BenchmarkLabel = index % 2 === 0 ? "human" : "ai";
    // A normalized-text digest PER RECORD, unlike the in-memory fixtures: this corpus is
    // written out and re-read through `parseBenchmarkDataset`, which refuses a repeated one as
    // a duplicated record-line.
    const normalizedTextSha256 = index.toString(16).padStart(64, "0");
    // The reserve has to be POPULATED and it has to land in `test`: a declared held-out family
    // with no record-line is not honored, and the command refuses that disagreement before it
    // reaches the composition of the blind block.
    const family =
      label === "human"
        ? undefined
        : index >= 294
          ? "family-unseen"
          : "acme_family";
    return {
      ...rec({
        id: `s_${String(index).padStart(3, "0")}`,
        label,
        createdAt: index + 1,
        domain: "corporate",
        wordCount: 180,
        humanSourceType: label === "human" ? "employee-post" : undefined,
        transformationKind: label === "human" ? "none" : "paraphrase",
        family,
        author: `auth_${index}`,
        source: `src_${index}`,
        domainSource: `ds_${index}`,
        collectionBatch: `cb_${index}`,
        nearDuplicate: `nd_${index}`,
        derivationRoot: `s_${String(index).padStart(3, "0")}`,
        promptTemplate: label === "human" ? undefined : `tpl_${index}`,
      }),
      normalizedTextSha256,
    };
  });
}

/**
 * Um split montado a mao com duas fracoes de classe EXATAMENTE na borda da tolerancia:
 * `human` `dev` em 3 % contra alvo 5 %, e `ai` `cal-A` em 8 % contra alvo 10 %. Nas duas o
 * float cru recusa por um bit, entao e o epsilon do comparador que as admite.
 *
 * Montado a mao e nao pelo splitter porque a borda exata nao e um resultado que se possa
 * PEDIR a ele: os cortes caem onde o grid os deixa cair. Cada linha carrega os proprios
 * eixos — nada atravessa particao — e os blocos de tempo sao disjuntos e ordenados, entao a
 * fracao de classe e a unica coisa que este corpo pode reprovar. A familia reservada e
 * povoada dentro de `test`, como um artefato de verdade a carrega.
 */
function bordaSplit(): {
  records: BenchmarkRecord[];
  split: DatasetSplit<BenchmarkRecord>;
} {
  const records: BenchmarkRecord[] = [];
  const split: DatasetSplit<BenchmarkRecord> = {
    train: [],
    dev: [],
    "cal-A": [],
    "cal-B": [],
    test: [],
  };
  const janela: Record<Partition, number> = {
    train: 1_000,
    dev: 2_000,
    "cal-A": 3_000,
    "cal-B": 4_000,
    test: 5_000,
  };
  const porClasse: Record<"human" | "ai", Record<Partition, number>> = {
    human: { train: 45, dev: 3, "cal-A": 10, "cal-B": 20, test: 22 },
    ai: { train: 45, dev: 5, "cal-A": 8, "cal-B": 20, test: 22 },
  };
  for (const label of ["human", "ai"] as const) {
    for (const partition of PARTITIONS) {
      for (let i = 0; i < porClasse[label][partition]; i += 1) {
        const id = `b_${label}_${partition}_${i}`;
        const row = rec({
          id,
          label,
          createdAt: janela[partition] + (label === "human" ? 0 : 100) + i,
          domain: "corporate",
          wordCount: 180,
          humanSourceType: label === "human" ? DECLARED_CELLS[0] : undefined,
          transformationKind: label === "human" ? "none" : "paraphrase",
          family:
            label === "ai" && partition === "test" && i < 6
              ? "family-unseen"
              : label === "ai"
                ? "family-seen"
                : undefined,
          author: `au_${id}`,
          source: `sr_${id}`,
          domainSource: `ds_${id}`,
          collectionBatch: `cb_${id}`,
          nearDuplicate: `nd_${id}`,
          derivationRoot: id,
          promptTemplate: label === "human" ? undefined : `pt_${id}`,
        });
        records.push(row);
        split[partition].push(row);
      }
    }
  }
  return { records, split };
}

/**
 * The three inputs `runSplit` opens, in a temporary directory OUTSIDE the repository.
 *
 * The dataset audit is minted with the contract's own digest function rather than written by
 * hand, because `parseDatasetAudit` recomputes it and a hand-kept copy would refuse for the
 * wrong reason. The file digests are the manifest's own: the command compares the two copies
 * to each other and re-hashes no file, so they identify the pair and not the bytes.
 */
async function writeSplitInputs(
  manifest: DatasetManifest,
  records: readonly BenchmarkRecord[],
): Promise<{
  datasetDirectory: string;
  datasetAuditPath: string;
  outputDirectory: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "cleanfeed-split-site-"));
  const datasetDirectory = join(root, "dataset");
  await mkdir(datasetDirectory, { recursive: true });
  await writeFile(
    join(datasetDirectory, "manifest.json"),
    JSON.stringify(manifest),
    "utf8",
  );
  await writeFile(
    join(datasetDirectory, "records.jsonl"),
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8",
  );

  const counts: Record<BenchmarkLabel, number> = { human: 0, ai: 0, mixed: 0 };
  const sourceTypes: Record<string, number> = {};
  const hardNegativeFamilies: Record<string, number> = {};
  const generatorFamilies: Record<string, number> = {};
  for (const record of records) {
    counts[record.label] += 1;
    for (const [tally, key] of [
      [sourceTypes, record.humanSourceType],
      [hardNegativeFamilies, record.hardNegativeFamily],
      // Read through the accessor: on a v4 record the axis is a three-valued object, and only
      // a `known` state carries an identity a tally can key by.
      [generatorFamilies, groupAxisIdentity(record, "generatorFamily")],
    ] as const) {
      if (key === undefined) continue;
      tally[key] = (tally[key] ?? 0) + 1;
    }
  }
  const auditInput: Omit<DatasetAudit, "auditDigest"> = {
    datasetId: manifest.datasetId,
    scientificUse: manifest.scientificUse,
    releaseEligible: manifest.scientificUse === "release",
    recordCount: records.length,
    counts,
    sourceTypes,
    hardNegativeFamilies,
    generatorFamilies,
    labelBasisCounts: emptyLabelBasisPublication(),
    licenses: manifest.licenses.map((license) => license.id).sort(),
    recordsSha256: manifest.recordsSha256,
    reviewLedgerSha256: manifest.reviewLedgerSha256,
    sourceManifestSha256: manifest.sourceManifestSha256,
    sealed: true,
  };
  const datasetAuditPath = join(root, "dataset-audit.json");
  await writeFile(
    datasetAuditPath,
    JSON.stringify({
      ...auditInput,
      auditDigest: await computeDatasetAuditDigest(auditInput),
    }),
    "utf8",
  );
  return {
    datasetDirectory,
    datasetAuditPath,
    outputDirectory: join(root, "out"),
  };
}

/**
 * A receipt every dataset-free guard ACCEPTS: the declared cells, the frozen bounds, and the
 * breach list the CRITERION produces over those rows.
 *
 * Built by calling the criterion instead of writing a list down, so a case about some OTHER
 * refusal cannot pass merely because the receipt was malformed or incoherent.
 */
function coherentReceiptOf(
  cells: readonly CellComposition[],
): CompositionReport {
  const bounds = compositionBoundsOf(PREREGISTRATION_V4);
  const breaches = compositionBreachesOf(cells, bounds);
  return {
    partition: COMPOSITION_GATE_PARTITION,
    cells,
    lineFloor: bounds.lineFloor,
    unitFloor: bounds.unitFloor,
    maximumLinesPerOriginDocument: bounds.maximumLinesPerOriginDocument,
    breaches,
    passed: breaches.length === 0,
  };
}

/** One row per declared cell, every quantity at zero. */
function emptyDeclaredCells(): CellComposition[] {
  return DECLARED_CELLS.map((cell) => ({
    cell,
    humanNegativeLines: 0,
    ineligibleLines: 0,
    independentUnits: 0,
    originDocuments: 0,
    linesWithoutOriginDocument: 0,
    linesInBusiestOriginDocument: 0,
  }));
}

let ptwikiArtifact: SplitArtifact | undefined;
// Built ONCE: `computeDatasetDigest` walks the whole corpus, and every forgery below works on
// a structured clone of the same honest seal.
async function buildPtwikiRelease(): Promise<SplitArtifact> {
  ptwikiArtifact ??= await buildSplitArtifact({
    manifest: PTWIKI_MANIFEST,
    records: PTWIKI_DATASET,
    split: PTWIKI_SPLIT,
    policy: POLICY,
    audit: PTWIKI_AUDIT,
  });
  return ptwikiArtifact;
}

const HEX64 = /^[0-9a-f]{64}$/;

async function buildRelease(): Promise<SplitArtifact> {
  return buildSplitArtifact({
    manifest: MANIFEST,
    records: RELEASE_DATASET,
    split: RELEASE_SPLIT,
    policy: POLICY,
    audit: RELEASE_AUDIT,
  });
}

// Re-seals whatever mutation is applied, so the artifact stays SELF-CONSISTENT and
// the test cannot pass merely because a digest stopped matching.
async function resealed(
  mutate: (artifact: SplitArtifact) => void,
): Promise<SplitArtifact> {
  const artifact = structuredClone(await buildRelease()) as SplitArtifact;
  mutate(artifact);
  const sorted = [...artifact.assignments].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  artifact.assignments = sorted;
  artifact.assignmentsDigest = await canonicalSha256(sorted);
  artifact.algorithmDigest = await canonicalSha256({
    algorithm: artifact.algorithm,
    policy: artifact.policy,
  });
  artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
  return artifact;
}

describe("buildSplitArtifact", () => {
  it("captures one assignment per record and coherent counts", async () => {
    expect(RELEASE_AUDIT.passed).toBe(true);
    const artifact = await buildRelease();

    expect(artifact.schemaVersion).toBe(4);
    expect(artifact.algorithm).toBe("blocked-group-time-v2");
    expect(artifact.seed).toBe(POLICY.seed);
    expect(artifact.heldOutGeneratorFamilies).toEqual(["family-unseen"]);

    expect(artifact.assignments).toHaveLength(RELEASE_DATASET.length);
    const assignedIds = new Set(artifact.assignments.map((a) => a.id));
    expect(assignedIds.size).toBe(RELEASE_DATASET.length);

    expect(artifact.counts).toEqual({
      train: RELEASE_SPLIT.train.length,
      dev: RELEASE_SPLIT.dev.length,
      "cal-A": RELEASE_SPLIT["cal-A"].length,
      "cal-B": RELEASE_SPLIT["cal-B"].length,
      test: RELEASE_SPLIT.test.length,
    });
    expect(
      PARTITIONS.reduce(
        (total, partition) => total + artifact.counts[partition],
        0,
      ),
    ).toBe(RELEASE_DATASET.length);

    for (const digest of [
      artifact.datasetDigest,
      artifact.algorithmDigest,
      artifact.assignmentsDigest,
      artifact.splitDigest,
    ]) {
      expect(digest).toMatch(HEX64);
    }

    // The published boundaries are the audit's OBSERVED ones, copied rather than
    // reconstructed into cuts — `train` is the fallback, so its newest record can be
    // newer than a middle partition's and no cut is recoverable from a finished split.
    expect(artifact.cutoffs).toEqual(RELEASE_AUDIT.cutoffs);
    expect(artifact.cutoffs.earliestTest).toBeGreaterThan(
      artifact.cutoffs.latestCalB,
    );
  });

  it("is deterministic and permutation-invariant", async () => {
    const first = await buildRelease();
    const shuffled = await buildSplitArtifact({
      manifest: MANIFEST,
      records: [...RELEASE_DATASET].reverse(),
      split: {
        train: [...RELEASE_SPLIT.train].reverse(),
        dev: [...RELEASE_SPLIT.dev].reverse(),
        "cal-A": [...RELEASE_SPLIT["cal-A"]].reverse(),
        "cal-B": [...RELEASE_SPLIT["cal-B"]].reverse(),
        test: [...RELEASE_SPLIT.test].reverse(),
      },
      policy: POLICY,
      audit: RELEASE_AUDIT,
    });
    expect(shuffled.datasetDigest).toBe(first.datasetDigest);
    expect(shuffled.assignmentsDigest).toBe(first.assignmentsDigest);
    expect(shuffled.splitDigest).toBe(first.splitDigest);
  });
});

describe("validateSplitArtifact", () => {
  it("accepts a freshly built, audited artifact", async () => {
    const artifact = await buildRelease();
    await expect(
      validateSplitArtifact(artifact, MANIFEST, RELEASE_DATASET),
    ).resolves.toEqual(artifact);
  });

  it("rejects a tampered assignment partition", async () => {
    const artifact = await buildRelease();
    const tampered: SplitArtifact = {
      ...artifact,
      assignments: artifact.assignments.map((assignment, index) =>
        index === 0
          ? {
              id: assignment.id,
              partition: assignment.partition === "test" ? "train" : "test",
            }
          : assignment,
      ),
    };
    // `counts` is what catches it now, and earlier than the digests: moving one
    // assignment makes the published per-partition totals disagree with the assignments
    // they summarise. The digest checks would also have caught it; this one names the
    // field that is wrong instead of only saying a hash moved.
    await expect(
      validateSplitArtifact(tampered, MANIFEST, RELEASE_DATASET),
    ).rejects.toThrow(/counts|assignments|digest/i);
  });

  it("rejects a tampered splitDigest", async () => {
    const artifact = await buildRelease();
    await expect(
      validateSplitArtifact(
        { ...artifact, splitDigest: "0".repeat(64) },
        MANIFEST,
        RELEASE_DATASET,
      ),
    ).rejects.toThrow(/split.*digest/i);
  });

  it("rejects a datasetDigest that does not match the dataset", async () => {
    // RE-SEALED on purpose. Editing `datasetDigest` and leaving the digests stale is caught by
    // self-consistency, which says nothing about whether the artifact describes THIS dataset.
    // Only a competent forgery isolates the binding that has to refuse it.
    const forged = await resealed((artifact) => {
      artifact.datasetDigest = "0".repeat(64);
    });
    await expect(
      validateSplitArtifact(forged, MANIFEST, RELEASE_DATASET),
    ).rejects.toThrow(/dataset/i);
  });

  it("rejects a missing assignment", async () => {
    const artifact = await buildRelease();
    await expect(
      validateSplitArtifact(
        { ...artifact, assignments: artifact.assignments.slice(1) },
        MANIFEST,
        RELEASE_DATASET,
      ),
    ).rejects.toThrow(/assignment/i);
  });

  it("rejects an extra assignment", async () => {
    const artifact = await buildRelease();
    await expect(
      validateSplitArtifact(
        {
          ...artifact,
          assignments: [
            ...artifact.assignments,
            { id: "ZZZ_not_in_dataset", partition: "test" },
          ],
        },
        MANIFEST,
        RELEASE_DATASET,
      ),
    ).rejects.toThrow(/assignment/i);
  });

  it("rejects a duplicate assignment", async () => {
    const artifact = await buildRelease();
    await expect(
      validateSplitArtifact(
        {
          ...artifact,
          assignments: [...artifact.assignments, artifact.assignments[0]],
        },
        MANIFEST,
        RELEASE_DATASET,
      ),
    ).rejects.toThrow(/assignment/i);
  });

  // The two refusals a sealed artifact re-entering the typed world from JSON needs,
  // exercised through `buildSplitArtifact` so `splitDigest` is computed OVER the
  // divergence: mutating a built artifact in place would fail on the digest first
  // and never reach these branches, which is how both mappings stayed untested.
  it("rejects a sealed artifact whose audited reserve is not the declared one", async () => {
    const artifact = await buildSplitArtifact({
      manifest: MANIFEST,
      records: RELEASE_DATASET,
      split: RELEASE_SPLIT,
      policy: POLICY,
      // The partitions honoured nothing while the policy reserved `family-unseen`:
      // the report would print a reserve the blind block does not hold.
      audit: { ...RELEASE_AUDIT, heldOutGeneratorFamilies: [] },
    });
    const failure = await validateSplitArtifact(
      artifact,
      MANIFEST,
      RELEASE_DATASET,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SplitArtifactError);
    expect((failure as SplitArtifactError).code).toBe(
      "SPLIT_ARTIFACT_HELD_OUT_FAMILY_DISAGREEMENT",
    );
    expect((failure as Error).message).toMatch(/omits \[family-unseen\]/u);
  });

  it("rejects a sealed artifact carrying the provider's dotted spelling", async () => {
    const artifact = await buildSplitArtifact({
      manifest: MANIFEST,
      records: RELEASE_DATASET,
      split: RELEASE_SPLIT,
      policy: POLICY,
      audit: {
        ...RELEASE_AUDIT,
        // A JSON-loaded artifact is only nominally typed, so the cast models the
        // real hazard: a dotted label that reached the file cannot be compared as a
        // plain string, it has to be refused.
        heldOutGeneratorFamilies: [
          "family.unseen",
        ] as unknown as GeneratorFamily[],
      },
    });
    const failure = await validateSplitArtifact(
      artifact,
      MANIFEST,
      RELEASE_DATASET,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SplitArtifactError);
    expect((failure as SplitArtifactError).code).toBe(
      "SPLIT_ARTIFACT_HELD_OUT_FAMILY_INVALID",
    );
    expect((failure as Error).message).toMatch(
      /audit\.heldOutGeneratorFamilies\[0\]/u,
    );
  });

  // The incidental list enters no set agreement — it is diagnosis — but the report
  // prints it, so the canonical form and the presence of the key are still refused
  // here rather than surfacing later as a TypeError from the renderer.
  it("rejects a dotted spelling in the incidental test-only families", async () => {
    const artifact = await buildSplitArtifact({
      manifest: MANIFEST,
      records: RELEASE_DATASET,
      split: RELEASE_SPLIT,
      policy: POLICY,
      audit: {
        ...RELEASE_AUDIT,
        incidentalTestOnlyGeneratorFamilies: [
          "family.incidental",
        ] as unknown as GeneratorFamily[],
      },
    });
    const failure = await validateSplitArtifact(
      artifact,
      MANIFEST,
      RELEASE_DATASET,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SplitArtifactError);
    expect((failure as SplitArtifactError).code).toBe(
      "SPLIT_ARTIFACT_HELD_OUT_FAMILY_INVALID",
    );
    expect((failure as Error).message).toMatch(
      /audit\.incidentalTestOnlyGeneratorFamilies\[0\]/u,
    );
  });

  it("rejects a sealed artifact that never measured the incidental families", async () => {
    const staleAudit: SplitAudit = { ...RELEASE_AUDIT };
    delete (staleAudit as Partial<SplitAudit>)
      .incidentalTestOnlyGeneratorFamilies;
    const artifact = await buildSplitArtifact({
      manifest: MANIFEST,
      records: RELEASE_DATASET,
      split: RELEASE_SPLIT,
      policy: POLICY,
      // The shape a split-artifact.json sealed BEFORE the field existed really has:
      // the key is ABSENT, not `undefined` (contracts/canonical-json.ts refuses an
      // undefined property outright, so no writer can even digest that). Absent is
      // the hazard that gets past every digest — the stale file's own splitDigest
      // recomputes perfectly, because canonicalizing it reproduces the bytes the old
      // writer signed — which is why the check has to live in the validator. A
      // missing key must stay distinguishable from a writer that measured and found
      // nothing, so it fails naming the path instead of being defaulted to `[]`.
      audit: staleAudit,
    });
    const failure = await validateSplitArtifact(
      artifact,
      MANIFEST,
      RELEASE_DATASET,
    ).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(SplitArtifactError);
    expect((failure as SplitArtifactError).code).toBe(
      "SPLIT_ARTIFACT_HELD_OUT_FAMILY_INVALID",
    );
    expect((failure as Error).message).toMatch(
      /audit\.incidentalTestOnlyGeneratorFamilies must be an array/u,
    );
  });

  it("rejects an artifact whose audit did not pass", async () => {
    // The failure mode is TEMPORAL, not the human-negative count. That count is a
    // published reporting threshold and no longer fails an audit, so a fixture that
    // relied on it would now produce `passed: true` and prove nothing here.
    //
    // Five populated partitions with `test` oldest: every boundary is finite, so the
    // artifact still builds, and the audit refuses on ordering.
    const solo = (id: string, createdAt: number): BenchmarkRecord =>
      rec({
        id,
        label: "human",
        createdAt,
        domain: "corporate",
        wordCount: 100,
        author: `auth_${id}`,
        source: `src_${id}`,
        domainSource: `ds_${id}`,
        collectionBatch: `cb_${id}`,
        nearDuplicate: `nd_${id}`,
        derivationRoot: id,
      });
    const failingDataset = [
      solo("tr", 10),
      solo("dv", 20),
      solo("ca", 30),
      solo("cb", 40),
      solo("ts", 1),
    ];
    const failingPolicy: BlockedSplitPolicy = {
      ...POLICY,
      heldOutGeneratorFamilies: [],
    };
    const split: DatasetSplit<BenchmarkRecord> = {
      train: [failingDataset[0] as BenchmarkRecord],
      dev: [failingDataset[1] as BenchmarkRecord],
      "cal-A": [failingDataset[2] as BenchmarkRecord],
      "cal-B": [failingDataset[3] as BenchmarkRecord],
      test: [failingDataset[4] as BenchmarkRecord],
    };
    const audit = auditBlockedSplit(
      failingDataset,
      split,
      AUDIT_POLICY,
      failingPolicy.heldOutGeneratorFamilies,
    );
    expect(audit.passed).toBe(false);
    expect(audit.reasons.some((reason) => /temporal/.test(reason))).toBe(true);

    const artifact = await buildSplitArtifact({
      manifest: MANIFEST,
      records: failingDataset,
      split,
      policy: failingPolicy,
      audit,
    });
    await expect(
      validateSplitArtifact(artifact, MANIFEST, failingDataset),
    ).rejects.toThrow(/audit/i);
  });
});

// --- a stale artifact must not re-enter the typed world -----------------------
//
// Every command loads this artifact with `as SplitArtifact` over parsed JSON, so the
// literal types on `schemaVersion` and `algorithm` constrain nothing about a file. Each
// case below is internally CONSISTENT — every digest recomputes and every coverage check
// passes — while naming a split vocabulary this build does not implement, so only a
// runtime check separates it from an honest artifact.
describe("validateSplitArtifact refuses a stale vocabulary", () => {
  async function codeOf(artifact: SplitArtifact): Promise<string> {
    try {
      await validateSplitArtifact(artifact, MANIFEST, RELEASE_DATASET);
    } catch (error) {
      return (error as SplitArtifactError).code;
    }
    return "ACCEPTED";
  }

  it("refuses the previous schemaVersion", async () => {
    const stale = await resealed((artifact) => {
      (artifact as { schemaVersion: number }).schemaVersion = 1;
    });
    expect(await codeOf(stale)).toBe("SPLIT_ARTIFACT_SCHEMA_UNSUPPORTED");
  });

  it("refuses the previous algorithm identity", async () => {
    const stale = await resealed((artifact) => {
      (artifact as { algorithm: string }).algorithm = "blocked-group-time-v1";
    });
    expect(await codeOf(stale)).toBe("SPLIT_ARTIFACT_ALGORITHM_UNSUPPORTED");
  });

  it("refuses an assignment naming a partition from the old vocabulary", async () => {
    const stale = await resealed((artifact) => {
      const first = artifact.assignments[0] as { partition: string };
      first.partition = "development";
    });
    expect(await codeOf(stale)).toBe("SPLIT_ARTIFACT_PARTITION_UNKNOWN");
  });

  it("refuses counts keyed by the old vocabulary", async () => {
    const stale = await resealed((artifact) => {
      (artifact as unknown as { counts: Record<string, number> }).counts = {
        development: 2_000,
        calibration: 3_000,
        test: 5_000,
      };
    });
    expect(await codeOf(stale)).toBe("SPLIT_ARTIFACT_PARTITION_UNKNOWN");
  });

  it("refuses a policy edited after sealing even when BOTH digests are recomputed", async () => {
    // `resealed` recomputes BOTH digests, and that is what makes this a competent
    // forgery: every digest in the file only proves the file agrees with itself, which
    // re-sealing restores. Leaving `algorithmDigest` stale would refuse for the wrong
    // reason and prove nothing.
    const forged = await resealed((artifact) => {
      artifact.seed = 999_999;
    });
    // The TOP-LEVEL copy is the one edited: `policy.seed` stays the pre-registered value, so
    // the authority check passes and what remains is the divergence between the two published
    // copies — of which only the one inside the policy is under `algorithmDigest`.
    expect(await codeOf(forged)).toBe("SPLIT_ARTIFACT_SEED_MISMATCH");
  });

  it("refuses fractions that are not the pre-registered ones, both digests recomputed", async () => {
    // Nothing inside the file can catch this: the edited policy is covered by both
    // recomputed digests. It is refused only because the fractions are compared against
    // the frozen pre-registration, which lives outside the artifact.
    const forged = await resealed((artifact) => {
      (artifact.policy.fractions as unknown as Record<string, number>).train =
        0.5;
      (artifact.policy.fractions as unknown as Record<string, number>)[
        "cal-B"
      ] = 0.15;
    });
    expect(await codeOf(forged)).toBe(
      "SPLIT_ARTIFACT_POLICY_NOT_PREREGISTERED",
    );
  });

  it("refuses a widened classTolerance, both digests recomputed", async () => {
    const forged = await resealed((artifact) => {
      (artifact.policy as unknown as Record<string, number>).classTolerance =
        0.5;
    });
    expect(await codeOf(forged)).toBe(
      "SPLIT_ARTIFACT_POLICY_NOT_PREREGISTERED",
    );
  });

  it("refuses counts that disagree with the assignments they summarise", async () => {
    const forged = await resealed((artifact) => {
      (artifact.counts as unknown as Record<string, number>).train += 1;
    });
    expect(await codeOf(forged)).toBe("SPLIT_ARTIFACT_COUNTS_MISMATCH");
  });

  it("refuses an audit whose own shapes still use the old vocabulary", async () => {
    // A current header over an audit keyed by other partition names. Every digest recomputes,
    // because the audit is sealed as-is — so what has to refuse it is the audit's OWN shapes
    // being checked, not the header.
    const forged = await resealed((artifact) => {
      (artifact.audit as unknown as { sizes: Record<string, number> }).sizes = {
        development: 2_000,
        calibration: 3_000,
        test: 5_000,
      };
    });
    expect(await codeOf(forged)).toBe("SPLIT_ARTIFACT_PARTITION_UNKNOWN");
  });
});

// --- the sealed audit has to reproduce from the dataset -----------------------
//
// The checks above all prove the file agrees with ITSELF, which a re-sealed forgery does
// by construction. None of them reads the dataset, so none can tell whether the audit
// DATA is true of it. `validateSplitArtifact` is the one entry point that receives the
// records, so it is the only place the audit can be reproduced — and every case below was
// ACCEPTED before it did.
describe("validateSplitArtifact reproduces the sealed audit", () => {
  async function forgedAudit(
    mutate: (audit: SplitAudit) => void,
  ): Promise<SplitArtifact> {
    const artifact = structuredClone(await buildRelease()) as SplitArtifact;
    mutate(artifact.audit);
    // Re-sealed in dependency order, so every digest agrees with the forgery.
    artifact.assignmentsDigest = await canonicalSha256(artifact.assignments);
    artifact.algorithmDigest = await canonicalSha256({
      algorithm: artifact.algorithm,
      policy: artifact.policy,
    });
    artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
    return artifact;
  }

  async function codeOfFull(artifact: SplitArtifact): Promise<string> {
    try {
      await validateSplitArtifact(artifact, MANIFEST, RELEASE_DATASET);
    } catch (error) {
      return (error as SplitArtifactError).code;
    }
    return "ACCEPTED";
  }

  it("refuses a human-negative count the blind block cannot hold", async () => {
    // The exact shape that reached a fixture: a number far larger than the partition it
    // describes, sealed consistently.
    const forged = await forgedAudit((audit) => {
      audit.testHumanNegatives = {
        count: 2_000_000,
        reportingThreshold: 2_000,
        sufficientForReleaseFpr: true,
      };
    });
    expect(await codeOfFull(forged)).toBe(
      "SPLIT_ARTIFACT_AUDIT_NOT_REPRODUCIBLE",
    );
  });

  it("refuses class fractions that were never measured, even inside the tolerance", async () => {
    // The 0.01 is REDISTRIBUTED, not invented: moving it from `cal-B` keeps the five cells
    // summing to 1 and every cell inside its tolerance, so neither the sum check nor the
    // per-cell check can see it. What remains is a value the policy would accept and the
    // corpus never produced — which only re-derivation decides.
    const forged = await forgedAudit((audit) => {
      audit.classFractions.human.train = 0.46;
      audit.classFractions.human["cal-B"] = 0.19;
    });
    expect(await codeOfFull(forged)).toBe(
      "SPLIT_ARTIFACT_AUDIT_NOT_REPRODUCIBLE",
    );
  });

  it("refuses a fraction outside the frozen target without needing the dataset", async () => {
    const forged = await forgedAudit((audit) => {
      audit.classFractions.human.train = 0.99;
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_AUDIT_INCOHERENT");
  });

  it("refuses a verdict flipped to passing over reasons that remain", async () => {
    // The coherence check precedes re-derivation, so the refusal names the field rather
    // than reporting that a hash moved.
    const forged = await forgedAudit((audit) => {
      audit.reasons = ["temporal leakage: invented"];
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_AUDIT_INCOHERENT");
  });

  it("refuses observed boundaries the audit did not measure", async () => {
    // Editing `audit.cutoffs` makes the artifact's republished copy disagree with it, and
    // that comparison precedes re-derivation.
    const forged = await forgedAudit((audit) => {
      audit.cutoffs = { ...audit.cutoffs, earliestTest: 0 };
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_CUTOFFS_MISMATCH");
  });

  it("refuses artifact boundaries that disagree with the audit's", async () => {
    const artifact = structuredClone(await buildRelease()) as SplitArtifact;
    artifact.cutoffs = { ...artifact.cutoffs, latestTrain: 12_345 };
    artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
    expect(await codeOfFull(artifact)).toBe("SPLIT_ARTIFACT_CUTOFFS_MISMATCH");
  });

  it("refuses a seed that is not the pre-registered one", async () => {
    // Re-running the splitter cannot catch this: the algorithm consumes no randomness, so a
    // swapped seed produces the identical placement. What makes the seed verifiable is the
    // frozen pre-registration naming the value, so the refusal comes from that authority.
    const forged = await resealed((artifact) => {
      artifact.seed = PREREGISTRATION_V4.seeds.split + 1;
      artifact.policy = {
        ...artifact.policy,
        seed: PREREGISTRATION_V4.seeds.split + 1,
      };
    });
    expect(await codeOfFull(forged)).toBe(
      "SPLIT_ARTIFACT_SEED_NOT_PRE_REGISTERED",
    );
  });

  it("refuses a placement the algorithm would not produce, with an audit that reproduces and passes", async () => {
    // The only forgery class the re-execution decides ALONE. Every other placement tamper is
    // caught earlier: on a corpus whose rows share a generator, a collection batch or a
    // derivation chain, moving a single record splits its connected component and the leakage
    // check refuses it. So the corpus here is all singletons — every group axis unique per
    // record — which is what lets one record cross a boundary without leaking.
    //
    // The record moved is cal-B's EARLIEST, derived rather than fixed: sending it back to
    // cal-A keeps `latest(cal-A) < earliest(cal-B)`, so temporal order still holds, and one
    // record shifts each fraction by 1/classTotal, inside the two-point tolerance. The audit
    // therefore re-derives IDENTICAL and passing over the tampered placement — leaving the
    // provenance check as the only thing between the file and acceptance.
    const singletons: BenchmarkRecord[] = [];
    const labels: BenchmarkLabel[] = ["human", "ai", "mixed"];
    for (let index = 0; index < 300; index += 1) {
      const label = labels[index % 3] as BenchmarkLabel;
      // The reserve has to be POPULATED: a declared held-out family with no record-line is
      // not honored, so the derived reserve would come back empty and disagree with the
      // policy before provenance is ever reached. The newest instants land in `test`, which
      // is where a reserved family belongs.
      const family =
        label === "human"
          ? undefined
          : index >= 294
            ? "family-unseen"
            : "acme_family";
      singletons.push(
        rec({
          id: `s_${String(index).padStart(3, "0")}`,
          label,
          createdAt: index + 1,
          domain: "corporate",
          wordCount: 180,
          humanSourceType: label === "human" ? "employee-post" : undefined,
          transformationKind: label === "human" ? "none" : "paraphrase",
          family,
          aiFraction: label === "mixed" ? 0.5 : undefined,
          author: `auth_${index}`,
          source: `src_${index}`,
          domainSource: `ds_${index}`,
          collectionBatch: `cb_${index}`,
          nearDuplicate: `nd_${index}`,
          derivationRoot: `s_${String(index).padStart(3, "0")}`,
          promptTemplate: label === "human" ? undefined : `tpl_${index}`,
        }),
      );
    }

    const honestSplit = createBlockedSplit(singletons, POLICY);
    const honestAudit = auditBlockedSplit(
      singletons,
      honestSplit,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );
    expect(honestAudit.passed).toBe(true);

    const calB = [...honestSplit["cal-B"]].sort(
      (a, b) => a.createdAt - b.createdAt,
    );
    const moved = calB[0] as BenchmarkRecord;
    const forgedSplit: DatasetSplit<BenchmarkRecord> = {
      train: [...honestSplit.train],
      dev: [...honestSplit.dev],
      "cal-A": [...honestSplit["cal-A"], moved],
      "cal-B": calB.slice(1),
      test: [...honestSplit.test],
    };
    const forgedAuditVerdict = auditBlockedSplit(
      singletons,
      forgedSplit,
      AUDIT_POLICY,
      POLICY.heldOutGeneratorFamilies,
    );
    expect(forgedAuditVerdict.reasons).toEqual([]);
    expect(forgedAuditVerdict.passed).toBe(true);

    const forged = await buildSplitArtifact({
      manifest: MANIFEST,
      records: singletons,
      split: forgedSplit,
      policy: POLICY,
      audit: forgedAuditVerdict,
    });
    expect(forged.assignments.find((a) => a.id === moved.id)?.partition).toBe(
      "cal-A",
    );

    await expect(
      validateSplitArtifact(forged, MANIFEST, singletons),
    ).rejects.toMatchObject({
      code: "SPLIT_ARTIFACT_ASSIGNMENTS_NOT_REPRODUCIBLE",
    });
  });

  // --- guardas que uma auditoria de MUTACAO mostrou sem teste ------------------------
  //
  // Desligar o `throw` de cada codigo e rodar a suite mede quais guardas alguma coisa
  // exercita. Sete nao eram mencionadas por teste nenhum, entre elas as duas do atestado de
  // composicao — que sao o centro da regra que exige o atestado derivado. Uma guarda que
  // nenhuma entrada alcanca nao protege nada.

  const RELEASE_MANIFEST = {
    ...MANIFEST,
    scientificUse: "release" as const,
  };

  async function buildForRelease(): Promise<SplitArtifact> {
    return buildSplitArtifact({
      manifest: RELEASE_MANIFEST,
      records: RELEASE_DATASET,
      split: RELEASE_SPLIT,
      policy: POLICY,
      audit: RELEASE_AUDIT,
    });
  }

  it("refuses a composition attestation the corpus does not produce", async () => {
    // O atestado e DERIVADO do inventario por classe e particao. Trocar o digest por outro
    // bem formado passa por toda checagem de forma; so recomputar do dataset separa os dois.
    const artifact = await buildForRelease();
    expect(artifact.compositionAttestation).not.toBeNull();
    const forged = structuredClone(artifact) as SplitArtifact;
    forged.compositionAttestation = "b".repeat(64);
    forged.splitDigest = await canonicalSha256(withoutSplitDigest(forged));
    await expect(
      validateSplitArtifact(forged, RELEASE_MANIFEST, RELEASE_DATASET),
    ).rejects.toMatchObject({
      code: "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MISMATCH",
    });
  });

  it("refuses an attestation on a corpus that is not release", async () => {
    // Publicar inventario de composicao para corpus que nao e release afirma algo que ninguem
    // tem direito de afirmar sobre ele.
    //
    // O par atestado/recibo e falsificado INTEIRO: os dois vem do mesmo `scientificUse`, e um
    // atestado sozinho e recusado antes como despareado — o que provaria a outra guarda.
    const forged = await resealed((artifact) => {
      artifact.compositionAttestation = "c".repeat(64);
      artifact.compositionReceipt = coherentReceiptOf(emptyDeclaredCells());
    });
    expect(await codeOfFull(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_UNEXPECTED",
    );
  });

  it("refuses an audit that failed, coherently", async () => {
    // `passed: false` com razoes presentes e INTERNAMENTE coerente, entao a checagem de
    // coerencia aceita — o que recusa e a guarda que exige veredito aprovado.
    const forged = await resealed((artifact) => {
      artifact.audit.passed = false;
      artifact.audit.reasons = ["temporal leakage: invented"];
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_AUDIT_FAILED");
  });

  it("refuses a stale assignmentsDigest", async () => {
    const artifact = structuredClone(await buildRelease()) as SplitArtifact;
    artifact.assignmentsDigest = "d".repeat(64);
    artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
    expect(await codeOfFull(artifact)).toBe(
      "SPLIT_ARTIFACT_ASSIGNMENTS_DIGEST_MISMATCH",
    );
  });

  it("refuses a stale algorithmDigest even with the seal recomputed", async () => {
    const artifact = structuredClone(await buildRelease()) as SplitArtifact;
    artifact.algorithmDigest = "e".repeat(64);
    artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
    expect(await codeOfFull(artifact)).toBe(
      "SPLIT_ARTIFACT_ALGORITHM_DIGEST_MISMATCH",
    );
  });

  it("refuses an assignment for an id the dataset does not contain", async () => {
    const forged = await resealed((artifact) => {
      (artifact.assignments[0] as SplitAssignment).id = "id_que_nao_existe";
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_EXTRA_ASSIGNMENT");
  });

  it("refuses a dataset id left without an assignment", async () => {
    // As CONTAGENS acompanham a remocao, senao a incoerencia entre `counts` e a tally recusa
    // antes e o teste provaria outra coisa.
    const forged = await resealed((artifact) => {
      const removida = artifact.assignments[0] as SplitAssignment;
      artifact.assignments = artifact.assignments.slice(1);
      artifact.counts[removida.partition] -= 1;
      artifact.audit.sizes[removida.partition] -= 1;
    });
    expect(await codeOfFull(forged)).toBe("SPLIT_ARTIFACT_MISSING_ASSIGNMENT");
  });

  it("accepts the honest artifact, so the refusals above are about the forgery", async () => {
    expect(await codeOfFull(await buildRelease())).toBe("ACCEPTED");
  });
});

// --- the publication path carries every dataset-independent check ---------------
//
// `publish-evidence` has no dataset, so the partial guard is the only one it can call. Every
// forgery below is decidable WITHOUT the dataset, which is why that guard alone must refuse it —
// and the refusal code names which invariant caught it, since several of these would also be
// refused later by re-derivation.
describe("assertSplitArtifactSelfConsistent covers what needs no dataset", () => {
  async function codeOfPartial(artifact: SplitArtifact): Promise<string> {
    try {
      await assertSplitArtifactSelfConsistent(artifact);
    } catch (error) {
      return (error as SplitArtifactError).code;
    }
    return "ACCEPTED";
  }

  it("refuses a passing verdict over reasons that remain", async () => {
    const forged = await resealed((artifact) => {
      artifact.audit.reasons = ["temporal leakage: invented"];
    });
    expect(await codeOfPartial(forged)).toBe("SPLIT_ARTIFACT_AUDIT_INCOHERENT");
  });

  it("refuses a duplicate assignment id even when the counts still add up", async () => {
    const forged = await resealed((artifact) => {
      const first = artifact.assignments[0] as SplitAssignment;
      const second = artifact.assignments[1] as SplitAssignment;
      // Same id twice in the same partition: `counts` stays coherent, so only a uniqueness
      // check separates this from a legitimate artifact.
      second.id = first.id;
      second.partition = first.partition;
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_DUPLICATE_ASSIGNMENT",
    );
  });

  it("refuses artifact boundaries that disagree with the audit's", async () => {
    const forged = await resealed((artifact) => {
      artifact.cutoffs = { ...artifact.cutoffs, latestTrain: 12_345 };
    });
    expect(await codeOfPartial(forged)).toBe("SPLIT_ARTIFACT_CUTOFFS_MISMATCH");
  });

  it("refuses an unknown root field, which no digest covers", async () => {
    // `splitDigest` seals a projection of KNOWN fields, so an extra root key is invisible to
    // it: the file re-verifies untouched while carrying payload nobody sealed. Only checking
    // the key SET catches it, which is why this runs before any digest is trusted.
    const smuggled = structuredClone(await buildRelease()) as SplitArtifact & {
      unsealedExtra?: string;
    };
    smuggled.unsealedExtra = "rides along unsealed";
    expect(await codeOfPartial(smuggled)).toBe("SPLIT_ARTIFACT_UNKNOWN_FIELD");
  });

  it("refuses a class label outside the closed vocabulary", async () => {
    // Re-sealed, so every digest recomputes. The per-class checks look up `human`, `ai` and
    // `mixed` individually and never ask what else the object holds, so an invented label
    // publishes fractions for a class the corpus has no vocabulary for.
    const forged = await resealed((artifact) => {
      (
        artifact.audit.classFractions as unknown as Record<string, unknown>
      ).robot = {
        train: 0.45,
        dev: 0.05,
        "cal-A": 0.1,
        "cal-B": 0.2,
        test: 0.2,
      };
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_UNKNOWN_CLASS_LABEL",
    );
  });

  it("refuses an unknown partition BEFORE it is used as a key, leaving Object.prototype clean", async () => {
    // `__proto__` as a partition name is not a hypothetical: the composition inventory keys by
    // the partition string, so on a plain object this assignment would write through to
    // `Object.prototype` and every later object in the process would inherit the entry. The
    // vocabulary check has to precede any use of the value, and the inventory uses `Map`.
    const forged = await resealed((artifact) => {
      (artifact.assignments[0] as SplitAssignment).partition =
        "__proto__" as Partition;
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_PARTITION_UNKNOWN",
    );
    expect(
      (Object.prototype as unknown as Record<string, unknown>).human,
    ).toBeUndefined();
  });

  it("refuses an attestation that is not a sha256, which the type cannot prevent", async () => {
    // A parsed file enters by cast, so `string | null` is a compile-time claim only.
    const forged = await resealed((artifact) => {
      (artifact as unknown as Record<string, unknown>).compositionAttestation =
        42;
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MALFORMED",
    );
  });

  it("refuses a seed that is not the pre-registered one, on the publication path too", async () => {
    // `publish-evidence` has no dataset, so it reaches this guard and nothing else. An
    // arbitrary seed needs no dataset to be refused.
    const forged = await resealed((artifact) => {
      artifact.seed = 99;
      artifact.policy = { ...artifact.policy, seed: 99 };
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_SEED_NOT_PRE_REGISTERED",
    );
  });

  it("refuses a __proto__ root key, which only a PARSED file can carry", async () => {
    // In an object literal `__proto__` sets the prototype instead of creating a key, so this
    // forgery exists only on parsed JSON — which is exactly how every command loads the
    // artifact. `key in allowed` would have called it permitted, because `in` walks the
    // prototype chain.
    const honest = await buildRelease();
    const smuggled = JSON.parse(
      JSON.stringify(honest).replace(/^\{/u, '{"__proto__":{"smuggled":true},'),
    ) as SplitArtifact;
    expect(await codeOfPartial(smuggled)).toBe("SPLIT_ARTIFACT_UNKNOWN_FIELD");
  });

  it("refuses a __proto__ class label on a parsed audit", async () => {
    const honest = await buildRelease();
    const smuggled = JSON.parse(
      JSON.stringify(honest).replace(
        '"classFractions":{',
        '"classFractions":{"__proto__":{"train":0.45,"dev":0.05,"cal-A":0.1,"cal-B":0.2,"test":0.2},',
      ),
    ) as SplitArtifact;
    expect(await codeOfPartial(smuggled)).toBe(
      "SPLIT_ARTIFACT_UNKNOWN_CLASS_LABEL",
    );
  });

  it("refuses an attestation whose toString lands on a digest", async () => {
    // `String(["<64 hex>"])` IS that hex string, so a coerced test accepts an array. The
    // check has to establish the type before it establishes the shape.
    const forged = await resealed((artifact) => {
      (artifact as unknown as Record<string, unknown>).compositionAttestation =
        ["a".repeat(64)];
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_ATTESTATION_MALFORMED",
    );
  });

  it("refuses values whose TYPE the parsed file never established", async () => {
    // Key sets say which fields exist; they say nothing about what sits under them. A numeric
    // id, a fraction that is the string "0.45" and a string cutoff all satisfy every digest —
    // the file agrees with itself — and then reach the published evidence summary.
    const numericId = await resealed((artifact) => {
      (artifact.assignments[0] as unknown as Record<string, unknown>).id = 42;
    });
    expect(await codeOfPartial(numericId)).toBe(
      "SPLIT_ARTIFACT_ASSIGNMENT_ID_INVALID",
    );

    const stringFraction = await resealed((artifact) => {
      (
        artifact.audit.classFractions.human as unknown as Record<
          string,
          unknown
        >
      ).train = "0.45";
    });
    expect(await codeOfPartial(stringFraction)).toBe(
      "SPLIT_ARTIFACT_CLASS_FRACTION_INVALID",
    );

    // BOTH copies, so the agreement check between them passes and the type check is the only
    // thing left that can refuse it.
    const stringCutoff = await resealed((artifact) => {
      (artifact.cutoffs as unknown as Record<string, unknown>).latestTrain =
        "100";
      (
        artifact.audit.cutoffs as unknown as Record<string, unknown>
      ).latestTrain = "100";
    });
    expect(await codeOfPartial(stringCutoff)).toBe(
      "SPLIT_ARTIFACT_CUTOFFS_INVALID",
    );
  });

  it("refuses overlapping middle ranges whose latest values are still monotonic", async () => {
    // The relation the audit asserts is earliest-against-latest. Ordered ranges IMPLY
    // monotonic `latest`, and the converse does not hold: here `latestDev < latestCalA` while
    // cal-A starts before dev ends, so the two bands overlap and a check on `latest` alone
    // calls it ordered.
    const forged = await resealed((artifact) => {
      artifact.cutoffs = { ...artifact.cutoffs, earliestCalA: 1 };
      artifact.audit.cutoffs = { ...artifact.audit.cutoffs, earliestCalA: 1 };
    });
    expect(await codeOfPartial(forged)).toBe("SPLIT_ARTIFACT_AUDIT_INCOHERENT");
  });

  it("accepts the honest artifact, so the refusals above are about the forgery", async () => {
    expect(await codeOfPartial(await buildRelease())).toBe("ACCEPTED");
  });
});

// --- o recibo do gate de composicao entra no ARTEFATO SELADO -----------------------
//
// O gate media as tres quantidades por celula de cota e o veredito era descartado: passar nao
// deixava prova. O recibo agora e DERIVADO pelo construtor, fica DENTRO da projecao que
// `splitDigest` sela — logo atestado por tudo que ja compara esse digest — e e RECONTADO do
// corpus na validacao, o que um arquivo irmao nunca poderia ser.
describe("o recibo do gate de composicao", () => {
  const LINE_FLOOR = PREREGISTRATION_V4.powerFloors.criticalFprHumanNegatives;
  const UNIT_FLOOR = PREREGISTRATION_V4.powerFloors.samplingUnits;
  const LINE_CAP = PREREGISTRATION_V4.collection.maximumLinesPerOriginDocument;

  async function codeOfPartial(artifact: SplitArtifact): Promise<string> {
    try {
      await assertSplitArtifactSelfConsistent(artifact);
    } catch (error) {
      return (error as SplitArtifactError).code;
    }
    return "ACCEPTED";
  }

  async function codeOfFull(artifact: SplitArtifact): Promise<string> {
    try {
      await validateSplitArtifact(artifact, PTWIKI_MANIFEST, PTWIKI_DATASET);
    } catch (error) {
      return (error as SplitArtifactError).code;
    }
    return "ACCEPTED";
  }

  // Re-sela a falsificacao, entao o artefato continua auto-consistente e nenhum caso abaixo
  // passa porque um digest deixou de fechar.
  async function resealedPtwiki(
    mutate: (artifact: SplitArtifact) => void,
  ): Promise<SplitArtifact> {
    const artifact = structuredClone(
      await buildPtwikiRelease(),
    ) as SplitArtifact;
    mutate(artifact);
    artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
    return artifact;
  }

  /** Troca a linha de celula e recomputa as brechas pelo criterio, e so isso. */
  async function resealedCell(row: CellComposition): Promise<SplitArtifact> {
    return resealedPtwiki((artifact) => {
      artifact.compositionReceipt = coherentReceiptOf([row]);
    });
  }

  /** O recibo do artefato, sem `?.` espalhado pelos casos. */
  function receiptOf(artifact: SplitArtifact): CompositionReport {
    const receipt = artifact.compositionReceipt;
    if (receipt === null) throw new Error("o artefato nao carrega recibo");
    return receipt;
  }

  /** A linha de celula do recibo, como objeto mutavel de uma falsificacao. */
  function cellRowOf(artifact: SplitArtifact): Record<string, unknown> {
    return receiptOf(artifact).cells[0] as unknown as Record<string, unknown>;
  }

  let shortRelease: SplitArtifact | undefined;
  // Um artefato release cujo recibo REPROVOU: `RELEASE_DATASET` carrega outros
  // `humanSourceType`, entao a celula declarada nao tem linha nenhuma.
  async function buildShortRelease(): Promise<SplitArtifact> {
    shortRelease ??= await buildSplitArtifact({
      manifest: PTWIKI_MANIFEST,
      records: RELEASE_DATASET,
      split: RELEASE_SPLIT,
      policy: POLICY,
      audit: RELEASE_AUDIT,
    });
    return shortRelease;
  }

  async function resealedShort(
    mutate: (artifact: SplitArtifact) => void,
  ): Promise<SplitArtifact> {
    const artifact = structuredClone(
      await buildShortRelease(),
    ) as SplitArtifact;
    mutate(artifact);
    artifact.splitDigest = await canonicalSha256(withoutSplitDigest(artifact));
    return artifact;
  }

  it("um artefato release carrega o recibo com as tres quantidades da celula declarada", async () => {
    const artifact = await buildPtwikiRelease();
    const receipt = receiptOf(artifact);
    const { eligible, ineligible } = ptwikiBlindBlockCounts();
    // Nao vacuo nas duas direcoes: o bloco cego tem folga larga sobre o piso E tem linhas que a
    // medicao abstem, que e o campo que diz POR QUE uma celula coletada no piso fica curta.
    expect(eligible).toBeGreaterThan(LINE_FLOOR);
    expect(ineligible).toBeGreaterThan(0);

    expect(receipt.partition).toBe("test");
    expect(receipt.cells.map((row) => row.cell)).toEqual([...DECLARED_CELLS]);
    // Cada linha contada traz seu proprio `source` e nenhum outro eixo que a cole a outra:
    // uma linha, um documento de origem, um componente.
    expect(receipt.cells[0]).toEqual({
      cell: DECLARED_CELLS[0],
      humanNegativeLines: eligible,
      ineligibleLines: ineligible,
      independentUnits: eligible,
      originDocuments: eligible,
      linesWithoutOriginDocument: 0,
      linesInBusiestOriginDocument: 1,
    });
    expect(receipt.lineFloor).toBe(LINE_FLOOR);
    expect(receipt.unitFloor).toBe(UNIT_FLOOR);
    expect(receipt.maximumLinesPerOriginDocument).toBe(LINE_CAP);
    expect(receipt.breaches).toEqual([]);
    expect(receipt.passed).toBe(true);

    await expect(assertSplitArtifactSelfConsistent(artifact)).resolves.toBe(
      artifact,
    );
  });

  it("aceita o artefato cujas fracoes publicadas estao na borda inclusiva", async () => {
    // A comparacao do ARTEFATO, que e a segunda que decide publicacao e a que nenhuma
    // fixture de borda alcancava: `human` `dev` em 3 % contra alvo 5 % e `ai` `cal-A` em 8 %
    // contra 10 %. Nas duas o float CRU recusaria por um bit, entao o que as faz passar e o
    // epsilon do comparador — e um artefato coerente na borda nao pode ser recusado como
    // incoerente.
    const { records, split } = bordaSplit();
    const audit = auditBlockedSplit(records, split, AUDIT_POLICY, [
      asGeneratorFamily("family-unseen"),
    ]);
    expect(audit.passed).toBe(true);
    for (const [label, partition, target] of [
      ["human", "dev", 0.05],
      ["ai", "cal-A", 0.1],
    ] as const) {
      expect(
        Math.abs(audit.classFractions[label][partition] - target),
        `${label} ${partition} esta na borda`,
      ).toBeGreaterThan(0.02);
    }

    const artifact = await buildSplitArtifact({
      manifest: MANIFEST,
      records,
      split,
      policy: POLICY,
      audit,
    });
    await expect(assertSplitArtifactSelfConsistent(artifact)).resolves.toBe(
      artifact,
    );
  });

  it("um artefato infrastructure-only nao carrega recibo", async () => {
    expect(MANIFEST.scientificUse).toBe("infrastructure-only");
    const artifact = await buildRelease();
    expect(artifact.compositionReceipt).toBeNull();
    expect(artifact.compositionAttestation).toBeNull();
  });

  it("mutar uma contagem do recibo quebra o selo", async () => {
    const artifact = structuredClone(
      await buildPtwikiRelease(),
    ) as SplitArtifact;
    const row = cellRowOf(artifact);
    // Uma linha a mais, SEM re-selar: aritmeticamente coerente e ainda muito acima dos dois
    // pisos, entao nenhuma guarda de forma tem o que dizer e o que recusa e o selo. E a prova
    // de que o recibo esta DENTRO da projecao de `withoutSplitDigest`.
    row.humanNegativeLines = (row.humanNegativeLines as number) + 1;
    expect(await codeOfPartial(artifact)).toBe(
      "SPLIT_ARTIFACT_SPLIT_DIGEST_MISMATCH",
    );
  });

  it("a via de publicacao recusa artefato com atestado presente e recibo nulo", async () => {
    const forged = await resealedPtwiki((artifact) => {
      artifact.compositionReceipt = null;
    });
    expect(forged.compositionAttestation).not.toBeNull();
    // `assertSplitArtifactSelfConsistent` e a via que `publish-evidence` alcanca, e ela sozinha
    // e que tem de recusar: composta com a recusa de release-sem-atestado que ja existe la,
    // release passa a exigir recibo sem uma linha mudar naquele comando.
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_UNPAIRED",
    );
  });

  it("a via de publicacao ACEITA um recibo reprovado e coerente, e e o comando que recusa", async () => {
    const artifact = await buildShortRelease();
    const receipt = receiptOf(artifact);
    expect(receipt.passed).toBe(false);
    // Dois limites por celula vazia: os dois pisos, e nenhum cap de documento a romper.
    expect(receipt.breaches).toHaveLength(DECLARED_CELLS.length * 2);
    // RESIDUO fixado por teste, para que ninguem leia a guarda como mais forte do que ela e: a
    // guarda sem dataset NAO exige `passed`. Quem impede o congelamento e
    // `benchmark/commands/split.ts`, a unica via que escreve artefato em disco — fixado pelo
    // caso do sitio abaixo.
    expect(await codeOfPartial(artifact)).toBe("ACCEPTED");
  });

  it("runSplit CONGELA o corpus release cuja composicao passa, e o recibo em disco diz passed", async () => {
    // O caminho positivo do condicional de release, que so o ramo negativo prendia: com os
    // dois casos de composicao curta esperando recusa, recusar TODO corpus release ficava
    // verde. Aqui o mesmo par manifesto/corpus cujo recibo selado ja e afirmado `passed`
    // atravessa o COMANDO inteiro, e o que se le e o artefato em disco.
    // Duas correcoes que o caminho de DISCO exige e o fixture em memoria nao: um digest de
    // texto por linha, porque `parseBenchmarkDataset` le digest repetido como linha
    // duplicada; e a linha `mixed` apontando `derivationRoot` para o humano do slot, porque
    // o parser exige que a mista nomeie um PAI e o fixture a deixa apontando para si mesma.
    // A segunda une cada mista ao humano de que ela deriva, o que e a co-locacao que o
    // esquema pede — e nenhum humano passa a dividir componente com outro humano, entao a
    // celula declarada segue com uma unidade por linha contada.
    const inputs = await writeSplitInputs(
      PTWIKI_MANIFEST,
      PTWIKI_DATASET.map((record, index) => {
        const escrito = structuredClone(record);
        escrito.normalizedTextSha256 = index.toString(16).padStart(64, "0");
        if (escrito.label === "mixed") {
          (escrito.groups as Record<string, unknown>).derivationRoot =
            `h_${escrito.createdAt}_0`;
        }
        return escrito;
      }),
    );
    await expect(
      runSplit({ ...inputs, seed: PREREGISTRATION_V4.seeds.split }),
    ).resolves.toContain("Split frozen");

    const frozen = JSON.parse(
      await readFile(
        join(inputs.outputDirectory, "split-artifact.json"),
        "utf8",
      ),
    ) as SplitArtifact;
    const receipt = frozen.compositionReceipt;
    expect(receipt?.passed).toBe(true);
    expect(receipt?.breaches).toEqual([]);
    // Nao vacuo: a celula declarada carrega o piso de linhas, entao o `true` e do gate
    // tendo contado e comparado, e nao de uma celula vazia que nada compara.
    expect(receipt?.cells[0]?.humanNegativeLines).toBeGreaterThanOrEqual(
      LINE_FLOOR,
    );
  });

  it("runSplit recusa o corpus release curto, e nao escreve o diretorio de saida", async () => {
    const inputs = await writeSplitInputs(
      PTWIKI_MANIFEST,
      buildShortReleaseDataset(),
    );
    const refusal = await runSplit({
      ...inputs,
      seed: PREREGISTRATION_V4.seeds.split,
    }).then(
      () => null,
      (error: unknown) => error as { code?: string; message: string },
    );

    // O codigo separa esta recusa das outras do comando: a auditoria de vazamento PASSA neste
    // corpus, entao o que refuta e a composicao do bloco cego.
    expect(refusal?.code).toBe(COMPOSITION_BOUNDS_NOT_MET);
    expect(refusal?.message).toContain(`cell "${DECLARED_CELLS[0]}" holds 0`);
    expect(refusal?.message).toContain(`floor of ${LINE_FLOOR}`);
    // "falha de restricao nao escreve OUTPUT", literal: o diretorio nao chega a existir.
    await expect(readdir(inputs.outputDirectory)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  // A guarda e uma DISJUNCAO de tres digests, e a tabela e o que impede duas delas de ficarem
  // sem prova: com um caso so, dois dos tres comparados podem ser apagados sem cor mudar. O
  // `datasetId` fica INTACTO de proposito — e o que separa esta recusa da guarda vizinha, que
  // carrega o mesmo codigo e responde por dataset trocado.
  it.each([
    ["recordsSha256"],
    ["reviewLedgerSha256"],
    ["sourceManifestSha256"],
  ])(
    "runSplit recusa a auditoria de dataset cujo %s divergiu do manifesto",
    async (campo) => {
      // A forja tem de ser COMPETENTE: adulterar o digest e RECOMPUTAR `auditDigest`, senao
      // `parseDatasetAudit` recusa antes pelo auto-digest e o caso mediria coerencia interna
      // em vez do vinculo ao dataset.
      const inputs = await writeSplitInputs(
        PTWIKI_MANIFEST,
        buildShortReleaseDataset(),
      );
      const bruto = JSON.parse(
        await readFile(inputs.datasetAuditPath, "utf8"),
      ) as Record<string, unknown>;
      delete bruto.auditDigest;
      const adulterado = { ...bruto, [campo]: "e".repeat(64) };
      expect(adulterado.datasetId).toBe(PTWIKI_MANIFEST.datasetId);
      await writeFile(
        inputs.datasetAuditPath,
        JSON.stringify({
          ...adulterado,
          auditDigest: await computeDatasetAuditDigest(adulterado as never),
        }),
        "utf8",
      );

      await expect(
        runSplit({ ...inputs, seed: PREREGISTRATION_V4.seeds.split }),
      ).rejects.toMatchObject({
        code: "DATASET_AUDIT_MISMATCH",
        message: expect.stringContaining(
          "file digests diverge",
        ) as unknown as string,
      });
    },
  );

  it("recusa por VAZAMENTO o corpus release que vaza E e curto, que e o que fixa a ordem", async () => {
    // A precedencia que o comando afirma: a auditoria de vazamento decide ANTES da
    // composicao. Nenhum outro corpus desta arvore e as duas coisas ao mesmo tempo — o
    // vazado e `infrastructure-only` e os curtos passam na auditoria —, entao sem este caso
    // mover o bloco de vazamento para depois do bloco de release nao muda cor nenhuma.
    const records = buildShortReleaseDataset();
    // UM componente atravessando o ultimo corte: uma linha do bloco de `test` declara o
    // DOCUMENTO DE ORIGEM da mais antiga, entao as duas sao um componente, ele cai em `train`
    // por ser o fallback, e texto do periodo de `test` fica no treino. A linha escolhida NAO
    // e da familia reservada: uma reservada com pai antigo faz o splitter recusar antes, por
    // elegibilidade temporal, e a recusa medida aqui seria outra.
    const anchor = records[0] as BenchmarkRecord;
    const straddling = records[292] as BenchmarkRecord;
    expect(groupAxisIdentity(straddling, "generatorFamily")).toBeUndefined();
    // Lido pelo ACESSOR e nao pelo bloco: num registro v4 o eixo e objeto de tres estados, e
    // so o estado `known` carrega identidade que duas linhas podem compartilhar.
    const documento = groupAxisIdentity(anchor, "source");
    expect(documento).toBeDefined();
    const leaking = records.map((record) => {
      if (record.id !== straddling.id) return record;
      const unido = structuredClone(record);
      (unido.groups as Record<string, unknown>).source = documento;
      return unido;
    });

    const refusal = await runSplit({
      ...(await writeSplitInputs(PTWIKI_MANIFEST, leaking)),
      seed: PREREGISTRATION_V4.seeds.split,
    }).then(
      () => null,
      (error: unknown) => error as { code?: string; message: string },
    );
    expect(refusal?.code).toBe("SPLIT_AUDIT_FAILED");

    // Nao vacuo, e e o que faz deste caso uma prova de ORDEM: o MESMO corpus sem a linha
    // unida chega a composicao e e recusado por ela.
    const semVazamento = await runSplit({
      ...(await writeSplitInputs(PTWIKI_MANIFEST, records)),
      seed: PREREGISTRATION_V4.seeds.split,
    }).then(
      () => null,
      (error: unknown) => error as { code?: string },
    );
    expect(semVazamento?.code).toBe(COMPOSITION_BOUNDS_NOT_MET);
  });

  it("recusa o artefato da forma antiga nomeando a chave ausente", async () => {
    // `schemaVersion` fica 4 e NAO distingue as duas formas — residuo aceito. O que recusa um
    // artefato selado antes desta chave e a checagem de conjunto, que roda antes da versao e
    // nomeia o que falta; nao ha aceitacao silenciosa nem via de re-selagem.
    const stale = JSON.parse(
      JSON.stringify(await buildPtwikiRelease()),
    ) as Record<string, unknown>;
    delete stale.compositionReceipt;
    expect(stale.schemaVersion).toBe(4);
    const failure = await assertSplitArtifactSelfConsistent(
      stale as unknown as SplitArtifact,
    ).catch((error: unknown) => error);
    expect((failure as SplitArtifactError).code).toBe(
      "SPLIT_ARTIFACT_UNKNOWN_FIELD",
    );
    expect((failure as Error).message).toMatch(/absent compositionReceipt/u);
  });

  it("recusa chave desconhecida dentro do recibo, que re-selar torna invisivel", async () => {
    // O digest COBRE a chave a mais, e e por isso que ele nao a recusa: re-selar restaura o
    // digest sobre o recibo inchado. So a checagem de conjunto separa o recibo do gate de um
    // recibo com um numero ao lado que nada le.
    const forged = await resealedPtwiki((artifact) => {
      (
        receiptOf(artifact) as unknown as Record<string, unknown>
      ).ineligibleUnits = 12;
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED",
    );
  });

  it("recusa contagem desconhecida numa linha de celula", async () => {
    const forged = await resealedPtwiki((artifact) => {
      cellRowOf(artifact).linesInQuietestOriginDocument = 1;
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED",
    );
  });

  it("recusa __proto__ numa linha de celula de arquivo parseado", async () => {
    // Num literal `__proto__` troca o prototipo em vez de criar chave, entao esta falsificacao
    // existe so em JSON parseado — que e exatamente como todo comando carrega o artefato.
    // `key in allowed` a teria chamado permitida, porque `in` sobe a cadeia de prototipos.
    const honest = await buildPtwikiRelease();
    const smuggled = JSON.parse(
      JSON.stringify(honest).replace(
        '"cells":[{',
        `"cells":[{"__proto__":{"cell":"${DECLARED_CELLS[0]}"},`,
      ),
    ) as SplitArtifact;
    expect(await codeOfPartial(smuggled)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED",
    );
  });

  it("recusa a contagem que e string como MALFORMED, e nao como incoerencia", async () => {
    // `"300" < 300` e `false` por coercao relacional: uma contagem que e string limpa um piso em
    // silencio E a lista de brechas recomputada concorda com a selada, porque os dois lados
    // coagem igual. Por isso a checagem de inteiro vem ANTES da recomputacao.
    const clearsTheFloor = await resealedPtwiki((artifact) => {
      cellRowOf(artifact).independentUnits = String(UNIT_FLOOR);
    });
    expect(await codeOfPartial(clearsTheFloor)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED",
    );

    // A MESMA falsificacao com "0": aqui a comparacao coerciva PRODUZ uma brecha que a lista
    // selada nao tem, entao a ordem invertida recusaria por INCOERENCIA — e a contagem que e
    // string teria passado por checada.
    const coercedIntoBreach = await resealedPtwiki((artifact) => {
      cellRowOf(artifact).independentUnits = "0";
    });
    expect(await codeOfPartial(coercedIntoBreach)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED",
    );
  });

  it("recusa contagem fracionaria e contagem negativa", async () => {
    // `ineligibleLines` nao entra em comparacao de piso nem em relacao aritmetica, entao uma
    // checagem de "numero finito" aceitaria as duas e o artefato seria ACEITO: o que as recusa
    // e serem contagens, e uma contagem e inteiro >= 0.
    for (const value of [2.5, -1]) {
      const forged = await resealedPtwiki((artifact) => {
        cellRowOf(artifact).ineligibleLines = value;
      });
      expect(await codeOfPartial(forged), String(value)).toBe(
        "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED",
      );
    }
  });

  it("recusa recibo cujo piso foi baixado ate as contagens que ele tem", async () => {
    const lines = 12;
    const forged = await resealedPtwiki((artifact) => {
      artifact.compositionReceipt = {
        partition: COMPOSITION_GATE_PARTITION,
        cells: DECLARED_CELLS.map((cell) => ({
          cell,
          humanNegativeLines: lines,
          ineligibleLines: 0,
          independentUnits: lines,
          originDocuments: lines,
          linesWithoutOriginDocument: 0,
          linesInBusiestOriginDocument: LINE_CAP,
        })),
        lineFloor: lines,
        unitFloor: lines,
        maximumLinesPerOriginDocument: LINE_CAP,
        breaches: [],
        passed: true,
      };
    });
    // Internamente PERFEITO: 12 >= 12 nos dois pisos, brechas vazias e veredito de acordo com a
    // lista. So um limite lido de FORA do arquivo separa isto de um recibo honesto.
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_NOT_PREREGISTERED",
    );
  });

  it("recusa recibo que nomeia celula que o frame nao declara", async () => {
    const undeclared = "encyclopedic";
    expect([...DECLARED_CELLS]).not.toContain(undeclared);
    const forged = await resealedCell({
      cell: undeclared,
      humanNegativeLines: LINE_FLOOR,
      ineligibleLines: 0,
      independentUnits: UNIT_FLOOR,
      originDocuments: LINE_FLOOR,
      linesWithoutOriginDocument: 0,
      linesInBusiestOriginDocument: LINE_CAP,
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_NOT_PREREGISTERED",
    );
  });

  it("recusa recibo sem a celula declarada", async () => {
    const forged = await resealedPtwiki((artifact) => {
      artifact.compositionReceipt = coherentReceiptOf([]);
    });
    // Zero celula e zero brecha: sem a lista externa, um recibo vazio passa por aprovado.
    expect(receiptOf(forged).passed).toBe(true);
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_NOT_PREREGISTERED",
    );
  });

  it("recusa recibo sobre particao que nao e o bloco cego", async () => {
    const forged = await resealedPtwiki((artifact) => {
      (receiptOf(artifact) as unknown as Record<string, unknown>).partition =
        "cal-B";
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_NOT_PREREGISTERED",
    );
  });

  it("recusa recibo cuja lista de brechas foi esvaziada", async () => {
    const forged = await resealedShort((artifact) => {
      const receipt = receiptOf(artifact) as unknown as Record<string, unknown>;
      receipt.breaches = [];
      receipt.passed = true;
    });
    // `passed === (breaches.length === 0)` ACEITA isto: a lista esta vazia e o veredito concorda
    // com ela. So a recomputacao pelo criterio recusa.
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_INCOHERENT",
    );
  });

  it("recusa veredito virado para aprovado sobre brechas que continuam la", async () => {
    const forged = await resealedShort((artifact) => {
      (receiptOf(artifact) as unknown as Record<string, unknown>).passed = true;
    });
    // As brechas corretas continuam publicadas, entao a recomputacao sozinha nao pega nada: o
    // que recusa e a equivalencia entre o veredito e a lista.
    expect(receiptOf(forged).breaches.length).toBeGreaterThan(0);
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_INCOHERENT",
    );
  });

  it("recusa linhas de origem irrecuperavel escondidas atras de um documento mais cheio de 1", async () => {
    // A falsificacao que SUPERESTIMA poder: 300 linhas que ninguem pode mostrar vindas de
    // documentos distintos, publicadas com `linesInBusiestOriginDocument` de 1, limpam o cap e
    // os dois pisos. O balde irrecuperavel E um dos baldes, e `busiest` e o maximo sobre eles.
    const forged = await resealedCell({
      cell: DECLARED_CELLS[0],
      humanNegativeLines: LINE_FLOOR,
      ineligibleLines: 0,
      independentUnits: UNIT_FLOOR,
      originDocuments: 0,
      linesWithoutOriginDocument: LINE_FLOOR,
      linesInBusiestOriginDocument: LINE_CAP,
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED",
    );
  });

  it("recusa linhas espalhadas por documento nenhum", async () => {
    const forged = await resealedCell({
      cell: DECLARED_CELLS[0],
      humanNegativeLines: LINE_FLOOR,
      ineligibleLines: 0,
      independentUnits: UNIT_FLOOR,
      originDocuments: 0,
      linesWithoutOriginDocument: 0,
      linesInBusiestOriginDocument: 0,
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED",
    );
  });

  it("recusa mais unidades independentes que linhas", async () => {
    const forged = await resealedCell({
      cell: DECLARED_CELLS[0],
      humanNegativeLines: LINE_FLOOR,
      ineligibleLines: 0,
      independentUnits: LINE_FLOOR + 1,
      originDocuments: LINE_FLOOR,
      linesWithoutOriginDocument: 0,
      linesInBusiestOriginDocument: LINE_CAP,
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED",
    );
  });

  it("recusa mais documentos de origem que as linhas que eles contribuiram", async () => {
    const forged = await resealedCell({
      cell: DECLARED_CELLS[0],
      humanNegativeLines: LINE_FLOOR,
      ineligibleLines: 0,
      independentUnits: UNIT_FLOOR,
      originDocuments: LINE_FLOOR + 1,
      linesWithoutOriginDocument: 0,
      linesInBusiestOriginDocument: LINE_CAP,
    });
    expect(await codeOfPartial(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MALFORMED",
    );
  });

  it("recusa recibo internamente perfeito que o corpus nao produz", async () => {
    const forged = await resealedPtwiki((artifact) => {
      const row = cellRowOf(artifact);
      row.humanNegativeLines = (row.humanNegativeLines as number) + 1;
    });
    // Uma linha a mais mantem tudo coerente: aritmetica, limites congelados, celula declarada,
    // brechas recomputadas e veredito. Nenhuma guarda sem dataset pode recusa-lo — e essa
    // aceitacao e o que faz da recontagem a unica coisa que decide quem foi CONTADO.
    expect(await codeOfPartial(forged)).toBe("ACCEPTED");
    expect(await codeOfFull(forged)).toBe(
      "SPLIT_ARTIFACT_COMPOSITION_RECEIPT_MISMATCH",
    );
  });

  it("aceita o artefato honesto, para que as recusas acima sejam sobre a falsificacao", async () => {
    expect(await codeOfFull(await buildPtwikiRelease())).toBe("ACCEPTED");
  });
});
