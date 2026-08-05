import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { stdout } from "node:process";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { canonicalSha256 } from "../../contracts/canonical-json.ts";
import type { SerializedCalibratorV1 } from "../../contracts/calibration-profile.ts";
import {
  computeRuntimeParityDigest,
  type RuntimeParityManifestV1,
} from "../../contracts/runtime-parity.ts";
import {
  computeSourceReadinessDigest,
  type CorpusSourceReadinessReport,
} from "../../contracts/source-readiness.ts";
import { parseCliArgs, runCli } from "../cli.ts";
import { PREREGISTRATION_V4 } from "../preregistration-v4.ts";
import {
  freezeProvisionalThreshold,
  type ProvisionalThresholdArtifact,
} from "../provisional-threshold.ts";
import {
  selectionThresholdEvidence,
  type FrozenCalibrationArtifact,
} from "../calibration-pipeline.ts";
import { runFit, type FitOptions } from "../commands/fit.ts";
import {
  emptyLabelBasisPublication,
  computeDatasetAuditDigest,
  type DatasetAudit,
  type DatasetManifest,
} from "../dataset-manifest.ts";
import {
  computeDatasetDigest,
  computeEvaluatorDigest,
  sha256BytesHex,
} from "../digests.ts";
import {
  beginHoldoutConsumption,
  resumeHoldoutConsumption,
  type HoldoutIdentity,
} from "../holdout-ledger.ts";
import {
  RELEASE_CHROME_VERSION,
  type PredictionManifestV1,
} from "../prediction-schema.ts";
import type { BenchmarkRecord } from "../schema.ts";
import { buildSplitArtifact } from "../split-artifact.ts";
import {
  DECLARED_GROUP_AXES,
  FROZEN_SPLIT_AUDIT_POLICY,
  auditBlockedSplit,
} from "../split-audit.ts";
import type { DatasetSplit } from "../split.ts";
import {
  asGeneratorFamily,
  normalizeGeneratorFamily,
} from "../generator-family.ts";

/** The same argument list with one `--flag value` pair removed. */
function withoutFlag(args: readonly string[], flag: string): string[] {
  const index = args.indexOf(flag);
  return [...args.slice(0, index), ...args.slice(index + 2)];
}

// ---------------------------------------------------------------------------
// Parsing and dispatch guards (no I/O required).
// ---------------------------------------------------------------------------

describe("benchmark CLI parsing and dispatch", () => {
  it("requires a named subcommand", () => {
    expect(() => parseCliArgs([])).toThrow(
      /expected one of cluster-ledger, ingest, validate, preflight-viability, split, validate-predictions, score, fit, evaluate, consume-holdout, publish-profile, verify-evidence/u,
    );
  });

  it("rejects an unknown subcommand", () => {
    expect(() => parseCliArgs(["frobnicate"])).toThrow(
      /expected one of cluster-ledger, ingest, validate, preflight-viability, split, validate-predictions, score, fit, evaluate, consume-holdout, publish-profile, verify-evidence/u,
    );
  });

  it("parses a known subcommand and its flags", () => {
    const parsed = parseCliArgs([
      "validate",
      "--dataset-dir",
      "d",
      "--output",
      "o",
    ]);
    expect(parsed.command).toBe("validate");
    expect(parsed.flags.get("dataset-dir")).toBe("d");
  });

  it("rejects an unknown flag on a known subcommand", async () => {
    await expect(
      runCli([
        "validate",
        "--dataset-dir",
        "d",
        "--output",
        "o",
        "--bogus",
        "x",
      ]),
    ).rejects.toThrow(/unknown flag --bogus/u);
  });

  it("requires validate's mandatory flags", async () => {
    await expect(runCli(["validate", "--dataset-dir", "d"])).rejects.toThrow(
      /--output/u,
    );
  });

  it("parses preflight-viability, which takes the dataset directory and nothing else", () => {
    const parsed = parseCliArgs([
      "preflight-viability",
      "--dataset-dir",
      "benchmark/data/cleanfeed-ptbr-cells-v1",
    ]);
    expect(parsed.command).toBe("preflight-viability");
    expect(parsed.flags.get("dataset-dir")).toBe(
      "benchmark/data/cleanfeed-ptbr-cells-v1",
    );
  });

  it("rejects --output on preflight-viability, which writes nothing", async () => {
    // A flag naming a destination would promise an artifact that never appears.
    await expect(
      runCli(["preflight-viability", "--dataset-dir", "d", "--output", "o"]),
    ).rejects.toThrow(/unknown flag --output/u);
  });

  it("requires preflight-viability's dataset directory", async () => {
    await expect(runCli(["preflight-viability"])).rejects.toThrow(
      /--dataset-dir/u,
    );
  });

  it("prints usage for --help without dispatching a command", async () => {
    await expect(runCli(["--help"])).resolves.toBeUndefined();
  });

  it("lists cluster-ledger and its closed action set in the usage text", async () => {
    const written: string[] = [];
    const write = stdout.write.bind(stdout);
    // The usage text is what an operator reads to find the command at all, so it
    // is asserted rather than assumed. Restored in a finally: a leaked stub would
    // silence every later test's output.
    (stdout as unknown as { write: (chunk: string) => boolean }).write = (
      chunk: string,
    ) => {
      written.push(chunk);
      return true;
    };
    try {
      await runCli(["--help"]);
    } finally {
      (stdout as unknown as { write: typeof write }).write = write;
    }
    const usage = written.join("");
    expect(usage).toContain("cluster-ledger");
    for (const action of [
      "init",
      "verify",
      "preflight",
      "record-pilot",
      "commit-split",
      "backup",
      "restore",
    ]) {
      expect(usage).toContain(action);
    }
    // The viability preflight is a NECESSARY condition, and the usage text is where an
    // operator meets the command: a line that only named the flag would let it be read
    // as a viability check that decides the question.
    expect(usage).toContain("preflight-viability");
    expect(usage).toContain("passing does NOT prove the");
  });

  it("parses cluster-ledger's positional action and its flags", () => {
    const parsed = parseCliArgs([
      "cluster-ledger",
      "verify",
      "--ledger",
      "l.jsonl",
      "--keyring",
      "k.json",
    ]);
    expect(parsed.command).toBe("cluster-ledger");
    expect(parsed.action).toBe("verify");
    expect(parsed.flags.get("ledger")).toBe("l.jsonl");
  });

  it("rejects a cluster-ledger action outside the closed set", () => {
    expect(() => parseCliArgs(["cluster-ledger", "rotate"])).toThrow(
      /cluster-ledger expects one of init, verify, preflight, record-pilot, commit-split, backup, restore/u,
    );
    expect(() => parseCliArgs(["cluster-ledger"])).toThrow(
      /cluster-ledger expects one of/u,
    );
  });

  it("refuses a positional action on any other subcommand", () => {
    expect(() => parseCliArgs(["validate", "init"])).toThrow(
      /unexpected argument: init/u,
    );
  });

  it("requires the flags each cluster-ledger action needs", async () => {
    await expect(runCli(["cluster-ledger", "init"])).rejects.toThrow(
      /--occurred-at/u,
    );
    await expect(runCli(["cluster-ledger", "restore"])).rejects.toThrow(
      /--backup/u,
    );
    await expect(
      runCli(["cluster-ledger", "verify", "--bogus", "x"]),
    ).rejects.toThrow(/unknown flag --bogus/u);
  });
});

// ---------------------------------------------------------------------------
// Partition guards: fit never touches test; validate-predictions ledger rules.
// ---------------------------------------------------------------------------

describe("benchmark CLI partition and ledger flag guards", () => {
  const FIT_ARGS = [
    "--dataset-dir",
    "d",
    "--dataset-audit",
    "a.json",
    "--source-readiness",
    "s.json",
    "--split-artifact",
    "split.json",
    "--runtime-parity",
    "rp.json",
    "--development-predictions",
    "dev",
    "--calibration-predictions",
    "cal",
    "--output",
    "out",
    "--seed",
    "712019",
  ];

  it("prevents fit from receiving test labels, and still accepts the two it needs", async () => {
    await expect(
      runCli(["fit", ...FIT_ARGS, "--partition", "test"]),
    ).rejects.toThrow(/fit accepts only dev and cal-A/u);
    await expect(
      runCli(["fit", ...FIT_ARGS, "--partition", "cal-B"]),
    ).rejects.toThrow(/fit accepts only dev and cal-A/u);
    await expect(
      runCli(["fit", ...FIT_ARGS, "--partition", "train"]),
    ).rejects.toThrow(/fit accepts only dev and cal-A/u);

    // The other direction, without which this test would also pass if the allowlist
    // rejected EVERY name: `dev` and `cal-A` must get past the partition guard. They
    // still fail afterwards on absent input files, which is a different message.
    for (const accepted of ["dev", "cal-A"]) {
      await expect(
        runCli(["fit", ...FIT_ARGS, "--partition", accepted]),
      ).rejects.not.toThrow(/fit accepts only/u);
    }
  });

  it("forbids a ledger/consumption id on a development prediction validation", async () => {
    await expect(
      runCli([
        "validate-predictions",
        "--dataset-dir",
        "d",
        "--split-artifact",
        "split.json",
        "--partition",
        "dev",
        "--predictions",
        "dev",
        "--runtime-parity",
        "rp.json",
        "--ledger",
        "ledger.jsonl",
      ]),
    ).rejects.toThrow(/ledger.*only.*test|test.*ledger/iu);
  });

  it("requires ledger and consumption id when validating test predictions", async () => {
    await expect(
      runCli([
        "validate-predictions",
        "--dataset-dir",
        "d",
        "--split-artifact",
        "split.json",
        "--partition",
        "test",
        "--predictions",
        "test",
        "--runtime-parity",
        "rp.json",
      ]),
    ).rejects.toThrow(/--ledger|--consumption-id/u);
  });
});

// ---------------------------------------------------------------------------
// score guards: the candidate-only scorer never touches the holdout and never
// runs the production dist.
// ---------------------------------------------------------------------------

describe("benchmark CLI score guards", () => {
  const SCORE_ARGS = [
    "--dataset-dir",
    "benchmark/data/cleanfeed-ptbr-cells-v1",
    "--split-artifact",
    "split.json",
    "--candidate-extension-dir",
    "dist-model-benchmark",
    "--output",
    "out/predictions/development",
  ];

  it("parses the score subcommand and its flags", () => {
    const parsed = parseCliArgs(["score", ...SCORE_ARGS, "--partition", "dev"]);
    expect(parsed.command).toBe("score");
    expect(parsed.flags.get("candidate-extension-dir")).toBe(
      "dist-model-benchmark",
    );
  });

  it("rejects the test partition with HOLDOUT_REQUIRES_CONSUME_COMMAND", async () => {
    await expect(
      runCli(["score", ...SCORE_ARGS, "--partition", "test"]),
    ).rejects.toThrow(/HOLDOUT_REQUIRES_CONSUME_COMMAND/u);
  });

  it("rejects the production dist directory", async () => {
    await expect(
      runCli([
        "score",
        "--dataset-dir",
        "benchmark/data/cleanfeed-ptbr-cells-v1",
        "--split-artifact",
        "split.json",
        "--candidate-extension-dir",
        "dist",
        "--output",
        "out/predictions/development",
        "--partition",
        "dev",
      ]),
    ).rejects.toThrow(/production|dist/iu);
  });

  it("rejects an unknown flag on score", async () => {
    await expect(
      runCli(["score", ...SCORE_ARGS, "--partition", "dev", "--bogus", "x"]),
    ).rejects.toThrow(/unknown flag --bogus/u);
  });
});

describe("benchmark CLI consume-holdout parsing", () => {
  const CONSUME_ARGS = [
    "consume-holdout",
    "--dataset-dir",
    "benchmark/data/cleanfeed-ptbr-cells-v1",
    "--split-artifact",
    "benchmark/out/ptbr-v1/split/split-artifact.json",
    "--frozen-calibration",
    "benchmark/out/ptbr-v1/fit/frozen-calibration.json",
    "--ledger",
    "benchmark/data/cleanfeed-ptbr-cells-v1/private/holdout-ledger.jsonl",
    "--candidate-extension-dir",
    "dist-model-benchmark",
    "--work-dir",
    "benchmark/work/holdout",
    "--output",
    "benchmark/out/ptbr-v1/evaluate",
    "--bootstrap-seed",
    "712019",
  ];

  it("recognizes the consume-holdout subcommand", () => {
    const parsed = parseCliArgs(CONSUME_ARGS);
    expect(parsed.command).toBe("consume-holdout");
  });

  it("rejects a fresh run without --confirm-split-digest or --resume-consumption", async () => {
    await expect(runCli(CONSUME_ARGS)).rejects.toThrow(/confirm-split-digest/u);
  });

  it("rejects an unknown flag on consume-holdout", async () => {
    await expect(
      runCli([
        ...CONSUME_ARGS,
        "--confirm-split-digest",
        "abc",
        "--bogus",
        "x",
      ]),
    ).rejects.toThrow(/unknown flag --bogus/u);
  });

  it("no longer demands --ledger, because it defaults to the canonical ledger", async () => {
    // A mandatory `--ledger` is a path somebody types, and a typed path under a
    // directory that does not exist is how an absent ledger becomes a second
    // measurement of the same block. The default is what keeps it untyped.
    const message = await runCli([
      ...withoutFlag(CONSUME_ARGS, "--ledger"),
      "--confirm-split-digest",
      "abc",
    ]).then(
      () => "",
      (error: unknown) => (error as Error).message,
    );
    // It still fails — the fixture paths are not a corpus — but never for want of a
    // ledger flag.
    expect(message).not.toBe("");
    expect(message).not.toMatch(/--ledger/u);
  });

  it("keeps the evaluator root off the command line", async () => {
    // A flag here would let a run aim the evaluator identity check at a clean copy
    // while an altered evaluator produces the numbers, which is the hole the
    // pre-exposure check closes. The closed flag list is what forbids it.
    await expect(
      runCli([
        ...CONSUME_ARGS,
        "--confirm-split-digest",
        "abc",
        "--evaluator-root",
        "/tmp/clean-copy",
      ]),
    ).rejects.toThrow(/unknown flag --evaluator-root/u);
  });
});

describe("benchmark CLI evidence-publication parsing", () => {
  const PUBLISH_EVIDENCE_ARGS = [
    "publish-evidence",
    "--source-readiness",
    "sr.json",
    "--dataset-audit",
    "da.json",
    "--split-artifact",
    "split.json",
    "--frozen-calibration",
    "frozen.json",
    "--fit-report",
    "fit.json",
    "--report",
    "report.json",
    "--ledger",
    "ledger.jsonl",
    "--consumption-id",
    "consume-0001",
    "--model-dir",
    "models/cleanfeed-ptbr-v1",
    "--output",
    "benchmark/evidence/tmr-ptbr-v1",
  ];

  it("recognizes publish-evidence and verify-published-evidence", () => {
    expect(parseCliArgs(PUBLISH_EVIDENCE_ARGS).command).toBe(
      "publish-evidence",
    );
    expect(
      parseCliArgs([
        "verify-published-evidence",
        "--evidence-dir",
        "benchmark/evidence/tmr-ptbr-v1",
        "--model-dir",
        "models/cleanfeed-ptbr-v1",
      ]).command,
    ).toBe("verify-published-evidence");
  });

  it("still lists the Phase 2 subcommands in the dispatch error", () => {
    expect(() => parseCliArgs(["frobnicate"])).toThrow(
      /expected one of cluster-ledger, ingest, validate, preflight-viability, split, validate-predictions, score, fit, evaluate, consume-holdout, publish-profile, verify-evidence/u,
    );
  });

  it("rejects an unknown flag on publish-evidence", async () => {
    await expect(
      runCli([...PUBLISH_EVIDENCE_ARGS, "--bogus", "x"]),
    ).rejects.toThrow(/unknown flag --bogus/u);
  });

  it("requires publish-evidence's mandatory flags", async () => {
    await expect(
      runCli(["publish-evidence", "--report", "report.json"]),
    ).rejects.toThrow(/--source-readiness|--dataset-audit|--output/u);
  });

  it("no longer demands --ledger on publish-evidence either", async () => {
    const message = await runCli(
      withoutFlag(PUBLISH_EVIDENCE_ARGS, "--ledger"),
    ).then(
      () => "",
      (error: unknown) => (error as Error).message,
    );
    expect(message).not.toBe("");
    expect(message).not.toMatch(/--ledger/u);
  });

  it("requires verify-published-evidence's mandatory flags", async () => {
    await expect(
      runCli(["verify-published-evidence", "--evidence-dir", "e"]),
    ).rejects.toThrow(/--model-dir/u);
  });

  it("rejects an unknown flag on verify-published-evidence", async () => {
    await expect(
      runCli([
        "verify-published-evidence",
        "--evidence-dir",
        "e",
        "--model-dir",
        "m",
        "--bogus",
        "x",
      ]),
    ).rejects.toThrow(/unknown flag --bogus/u);
  });
});

// ---------------------------------------------------------------------------
// Full holdout consumption flow driven through the evaluate subcommand.
//
// A compact but end-to-end valid scenario: a tiny sealed-shaped dataset, a
// frozen split artifact and calibration, a test prediction manifest+shard and
// the private test labels. The scenario is deliberately small so the run stays
// in milliseconds while still exercising the real evaluate pipeline and the
// ledger's one-way lease.
// ---------------------------------------------------------------------------

function hex(label: string): string {
  let out = "";
  for (const ch of label) out += ch.charCodeAt(0).toString(16).padStart(2, "0");
  return out.padEnd(64, "0").slice(0, 64);
}

const MODEL_ID = "cleanfeed-ptbr-v1";
const MODEL_VERSION = "1.0.0";
const BUNDLE = hex("bundle");
const TOKENIZER = hex("tokenizer");
const PARITY = hex("runtime-parity");
const BUILD = hex("extension-build");
const AGGREGATION = "tmr-aggregation-v3";
const COMPOSITION = "lexical-content-v2";
const DATASET_AUDIT = hex("dataset-audit");
const SOURCE_READINESS = hex("source-readiness");
const SESSION_TIME = "2026-07-19T00:00:00.000Z";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

// The `evaluate` subcommand takes no evaluator root: the injection point is a deps
// field on the in-process callers, never a flag. So a frozen artifact driven through
// the CLI has to declare the digest of THIS working tree, or the identity check
// refuses the run before it reads a label. Memoized because hashing the inventory is
// the most expensive thing in this file.
let repoEvaluatorDigest: string | undefined;
async function evaluatorDigest(): Promise<string> {
  repoEvaluatorDigest ??= await computeEvaluatorDigest(REPO_ROOT);
  return repoEvaluatorDigest;
}

let recordCounter = 0;
function record(
  label: BenchmarkRecord["label"],
  createdAt: number,
  // The provider's family label for a generated record. Callers pass the reserved
  // one for rows they place in the test partition, so the manifest's reservation
  // names a family the corpus actually contains — the four-way invariant in
  // benchmark/generator-family.ts refuses a reservation nothing satisfies.
  family = "acme_family",
  // The SPLIT/EXPOSURE CLUSTER this row belongs to: the ORIGIN DOCUMENT (`source`) is
  // shared by every row of one cluster, and `domainSource`/`collectionBatch` are nested
  // in it, so the connected component of the union of the grouping axes is this cluster.
  // `source` is what carries it and not the other two: those name a stratum and an
  // acquisition event, which the splitter reports and never unions on, so keying the
  // cluster on them would make every row its own atom. The eight-record evaluate
  // scenario leaves the default and is therefore one cluster, which is all it needs;
  // the fit scenario names clusters, because a corpus of one indivisible cluster cannot
  // be cross-validated at all.
  cluster = "c0",
): BenchmarkRecord {
  recordCounter += 1;
  const id = `r${recordCounter}`;
  const base: BenchmarkRecord = {
    schemaVersion: 2,
    id,
    text: `Texto de exemplo suficientemente longo para o registro ${id}.`,
    normalizedTextSha256: hex(`content-${id}`),
    label,
    language: "pt-BR",
    platform: "generic",
    domain: "corporate",
    topic: "geral",
    wordCount: 60,
    createdAt,
    provenance: {
      sourceKind: "authorized-contribution",
      sourceId: `src_${id}`,
      sourceRevision: "rev_001",
      collectedAt: createdAt,
      licenseId: "consent-v1",
      legalBasis: "consent",
      consentId: `consent_${id}`,
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "reviewer_01",
        reviewedAt: createdAt,
      },
    },
    annotation: {
      protocolVersion: "annotation-v1",
      reviewerIds: ["reviewer_01", "reviewer_02"],
      agreement: "agree",
    },
    transformation: { kind: "none", severity: "none" },
    groups: {
      author: `author_${id}`,
      source: `doc_${cluster}`,
      domainSource: `ds_${cluster}`,
      collectionBatch: `batch_${cluster}`,
      nearDuplicate: `nd_${id}`,
      derivationRoot: id,
    },
  };
  if (label === "ai") {
    base.generation = {
      provider: "acme",
      family,
      model: "acme-1",
      version: "v1",
      promptId: `prompt_${id}`,
      promptSha256: hex(`prompt-${id}`),
      generatedAt: createdAt,
    };
    // The canonical field, required by the schema on every generated record and
    // the only one the split/slices/audit read (benchmark/generator-family.ts).
    base.groups.generatorFamily = normalizeGeneratorFamily(family);
    // The middle level of the ai-recall row of the frozen resampling table: the
    // recall interval of a positive is drawn over generator ⊃ prompt template ⊃
    // batch, and an absent axis is `unknown`, which is not a resampling unit.
    // Derived from the RECIPE and never from the record-line: a template id per row
    // makes that middle level one unit per row by construction, which is the
    // degeneration the resampling design exists to remove arriving through a fixture. It is scoped to
    // the CLUSTER, not to the whole corpus: `promptTemplate` is a value axis of the
    // split connectivity, so one template shared by every generated row would union
    // every cluster holding a generated row back into one component.
    base.groups.promptTemplate = `pt_${normalizeGeneratorFamily(family)}_${cluster}`;
  }
  if (label === "mixed") {
    base.mixture = {
      aiFraction: 0.6,
      humanFraction: 0.4,
      spans: [{ start: 0, end: 10, origin: "ai" }],
      generationMode: "mechanistic",
    };
    base.groups.derivationRoot = `parent_${id}`;
    // The recipe that produced the AI stretches of a MECHANISTIC mixed row: ours,
    // therefore provenance. v2 leaves it optional, but the schema refuses a
    // `groups.generatorFamily` with no recipe behind it, and this row needs the
    // family for the resampling levels below.
    base.generation = {
      provider: "acme",
      family,
      model: "acme-1",
      version: "v1",
      promptId: `prompt_${id}`,
      promptSha256: hex(`prompt-${id}`),
      generatedAt: createdAt,
    };
    // A mechanistic mixed row above the fraction floor is a warning positive, so
    // the ai-recall levels apply to it too. NOT `groups.humanSeed`: these are v2
    // records and the v2 schema has no such axis, which is why the mixed multiway
    // cannot be measured on a v2 corpus at all — the plan says so per run instead
    // of the evaluation failing over a declaration nothing gates.
    base.groups.generatorFamily = normalizeGeneratorFamily(family);
    base.groups.promptTemplate = `pt_${id}`;
  }
  return base;
}

function datasetManifest(): DatasetManifest {
  return {
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
    recordsSha256: hex("records"),
    reviewLedgerFile: "private/review-ledger.jsonl",
    reviewLedgerSha256: hex("review-ledger"),
    sourceManifestFile: "private/source-manifest.json",
    sourceManifestSha256: hex("source-manifest"),
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
    licenses: [
      {
        id: "consent-v1",
        name: "Authorized contribution",
        source: "fixture://consent",
        evaluationUseApproved: true,
        redistribution: "not-published",
        notice: "Contributed under explicit consent.",
      },
    ],
  };
}

const PLATT: SerializedCalibratorV1 = {
  kind: "platt",
  slope: 2,
  intercept: -1,
};

function predictionManifest(
  partition: PredictionManifestV1["partition"],
  datasetDigest: string,
  splitDigest: string,
  holdoutConsumptionId: string | null,
  shards: PredictionManifestV1["shards"],
): PredictionManifestV1 {
  return {
    schemaVersion: 1,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: BUNDLE,
    aggregationVersion: AGGREGATION,
    contentCompositionVersion: COMPOSITION,
    tokenizerDigest: TOKENIZER,
    runtimeParityDigest: PARITY,
    extensionBuildDigest: BUILD,
    backend: "wasm",
    chromeVersion: "150.0.7871.129",
    datasetDigest,
    splitDigest,
    partition,
    shardSize: 100,
    shardCount: shards.length,
    shards,
    holdoutConsumptionId,
    createdAt: "2026-07-19T00:00:00.000Z",
  };
}

// A real provisional-threshold artifact, frozen by the shipped function so its digest
// and its restated pre-registration are the ones `evaluate` cross-checks.
async function provisionalThresholdFixture(
  datasetDigest: string,
  splitDigest: string,
  developmentDigest: string,
  calibrationDigest: string,
): Promise<ProvisionalThresholdArtifact> {
  const partitions = PREREGISTRATION_V4.threshold.quantilePartitions;
  const count = 100;
  return freezeProvisionalThreshold({
    samples: Array.from({ length: count }, (_unused, index) => ({
      id: `fit_${String(index).padStart(3, "0")}`,
      label: "human",
      partition: partitions[index % partitions.length],
      documentRawScore: index / count,
    })),
    testIds: [],
    seed: PREREGISTRATION_V4.seeds.split,
    digests: {
      datasetDigest,
      datasetAuditDigest: DATASET_AUDIT,
      splitDigest,
      evaluatorDigest: await evaluatorDigest(),
      sourceReadinessDigest: SOURCE_READINESS,
      developmentManifestDigest: developmentDigest,
      calibrationManifestDigest: calibrationDigest,
    },
  });
}

async function frozenCalibration(
  datasetDigest: string,
  splitDigest: string,
  developmentDigest: string,
  calibrationDigest: string,
): Promise<FrozenCalibrationArtifact> {
  const base: Omit<FrozenCalibrationArtifact, "artifactDigest"> = {
    schemaVersion: 1,
    model: {
      modelId: MODEL_ID,
      modelVersion: MODEL_VERSION,
      bundleDigest: BUNDLE,
      tokenizerDigest: TOKENIZER,
      aggregationVersion: AGGREGATION,
      contentCompositionVersion: COMPOSITION,
    },
    scoringRuntime: {
      runtimeParityDigest: PARITY,
      extensionBuildDigest: BUILD,
      backend: "wasm",
      chromeVersion: "150.0.7871.129",
    },
    predictionManifestDigests: {
      development: developmentDigest,
      calibration: calibrationDigest,
    },
    datasetDigest,
    datasetAuditDigest: DATASET_AUDIT,
    sourceReadinessDigest: SOURCE_READINESS,
    splitDigest,
    evaluatorDigest: await evaluatorDigest(),
    partitionsUsed: ["dev", "cal-A"],
    calibrators: { document: PLATT, localized: PLATT },
    selectionEvidence: { document: [], localized: [] },
    thresholds: {
      warningDocument: 0.5,
      warningLocalized: 0.5,
      visualDocument: 0.8,
    },
    thresholdEvidence: {
      warning: selectionThresholdEvidence({
        documentThreshold: 0.5,
        localizedThreshold: 0.5,
        negatives: 2,
        falsePositives: 0,
        selectionFprUpper95Nominal: 0.01,
        positives: 2,
        truePositives: 2,
        recall: 1,
      }),
      visual: selectionThresholdEvidence({
        documentThreshold: 0.8,
        localizedThreshold: null,
        negatives: 2,
        falsePositives: 0,
        selectionFprUpper95Nominal: 0.01,
        positives: 2,
        truePositives: 1,
        recall: 0.5,
      }),
    },
    fitSeed: 712019,
  };
  return { ...base, artifactDigest: await canonicalSha256(base) };
}

interface Scenario {
  datasetDir: string;
  /** Ids of the blind block, read off the split the scenario sealed. */
  testIds: string[];
  splitArtifactPath: string;
  frozenCalibrationPath: string;
  testPredictionsDir: string;
  testLabelsPath: string;
  ledgerPath: string;
  outputDir: string;
  activeSessionPath: string;
  identity: HoldoutIdentity;
}

async function buildScenario(root: string): Promise<Scenario> {
  recordCounter = 0;
  // The eight rows the assertions below name, plus filler that makes the split satisfy
  // the frozen 45/5/10/20/20 per class. The sealed audit is re-derived from these records
  // by `validateSplitArtifact`, so the proportions have to be real: a class needs at least
  // twenty rows for 5% to land inside a two-point tolerance at all (1/20 = 0.05 exactly),
  // and every partition then takes its own share of that twenty.
  //
  // The named rows keep their partitions and their times. Filler goes to `train`, `cal-B`
  // and the tail of `test`, and each filler row gets its OWN cluster so the leakage audit
  // stays non-vacuous over it.
  // One cluster per PARTITION, never one cluster shared by every row: the cluster token
  // is what the union axes carry, so a single cluster spanning dev, cal-A and test is a
  // group value crossing partitions. Per partition keeps the prompt-template unit
  // multi-row — the non-degeneracy the resampling needs — without crossing a boundary.
  const named: BenchmarkRecord[] = [
    record("human", 10, "acme_family", "dv"),
    record("ai", 20, "acme_family", "dv"),
    record("human", 110, "acme_family", "ca"),
    record("mixed", 120, "acme_family", "ca"),
    record("human", 310, "acme_family", "ts"),
    record("human", 320, "acme_family", "ts"),
    record("ai", 330, "heldout_family", "ts_held"),
    record("mixed", 340, "acme_family", "ts"),
  ];
  const pad = (
    label: BenchmarkRecord["label"],
    count: number,
    createdAt: number,
    tag: string,
  ): BenchmarkRecord[] =>
    Array.from({ length: count }, (_unused, index) =>
      record(label, createdAt, "acme_family", `${tag}_${label}_${index}`),
    );
  // train 45% = 9 of each class, oldest band.
  const trainPad = [
    ...pad("human", 9, 2, "trn"),
    ...pad("ai", 9, 3, "trn"),
    ...pad("mixed", 9, 4, "trn"),
  ];
  // dev 5% = 1: human and ai are already there, mixed is not.
  const devPad = pad("mixed", 1, 12, "dvp");
  // cal-A 10% = 2: mixed has one, human has one, ai has none.
  const calAPad = [
    ...pad("human", 1, 112, "cla"),
    ...pad("ai", 2, 113, "cla"),
    // Mixed reaches twenty only with this row: cal-A's 10% is two and `named` gives one.
    ...pad("mixed", 1, 114, "cla"),
  ];
  // cal-B 20% = 4 of each class.
  const calBPad = [
    ...pad("human", 4, 200, "clb"),
    ...pad("ai", 4, 201, "clb"),
    ...pad("mixed", 4, 202, "clb"),
  ];
  // test 20% = 4: human has two, ai one, mixed one.
  // A cluster per ROW, which is what makes the resampling DEGENERATE — and degenerate is
  // `levels === items.length` (benchmark/bootstrap.ts), i.e. every item is its own
  // resampling unit, so there is nothing to resample over. Sharing one cluster across the
  // pad is what destroys it, not what creates it.
  const testPad = [
    ...pad("human", 2, 350, "tst"),
    ...pad("ai", 3, 351, "tst"),
    ...pad("mixed", 3, 352, "tst"),
  ];
  const records: BenchmarkRecord[] = [
    ...trainPad,
    ...named,
    ...devPad,
    ...calAPad,
    ...calBPad,
    ...testPad,
  ];
  const manifest = datasetManifest();
  const datasetDir = join(root, "dataset");
  await mkdir(join(datasetDir, "private"), { recursive: true });
  await writeFile(
    join(datasetDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(datasetDir, "records.jsonl"),
    `${records.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );

  const split: DatasetSplit<BenchmarkRecord> = {
    train: trainPad,
    dev: [named[0] as BenchmarkRecord, named[1] as BenchmarkRecord, ...devPad],
    "cal-A": [
      named[2] as BenchmarkRecord,
      named[3] as BenchmarkRecord,
      ...calAPad,
    ],
    "cal-B": calBPad,
    test: [
      named[4] as BenchmarkRecord,
      named[5] as BenchmarkRecord,
      named[6] as BenchmarkRecord,
      named[7] as BenchmarkRecord,
      ...testPad,
    ],
  };
  const policy = {
    fractions: {
      train: 0.45,
      dev: 0.05,
      "cal-A": 0.1,
      "cal-B": 0.2,
      test: 0.2,
    },
    classTolerance: 0.02,
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
    seed: 20260804,
  } as const;
  const artifact = await buildSplitArtifact({
    manifest,
    records,
    split,
    policy,
    audit: auditBlockedSplit(
      records,
      split,
      FROZEN_SPLIT_AUDIT_POLICY,
      policy.heldOutGeneratorFamilies,
      DECLARED_GROUP_AXES,
    ),
  });
  const splitArtifactPath = join(root, "split-artifact.json");
  await writeFile(splitArtifactPath, `${JSON.stringify(artifact, null, 2)}\n`);

  const datasetDigest = await computeDatasetDigest(manifest, records);
  const splitDigest = artifact.splitDigest;

  // Fit output directory: frozen calibration plus the two prediction manifests
  // it consumed, which evaluate re-reads for the report.
  const fitDir = join(root, "fit");
  await mkdir(fitDir, { recursive: true });
  const devManifest = predictionManifest(
    "dev",
    datasetDigest,
    splitDigest,
    null,
    [],
  );
  const calManifest = predictionManifest(
    "cal-A",
    datasetDigest,
    splitDigest,
    null,
    [],
  );
  const { computePredictionManifestDigest } =
    await import("../prediction-schema.ts");
  const devDigest = await computePredictionManifestDigest(devManifest);
  const calDigest = await computePredictionManifestDigest(calManifest);
  await writeFile(
    join(fitDir, "development-prediction-manifest.json"),
    `${JSON.stringify(devManifest, null, 2)}\n`,
  );
  await writeFile(
    join(fitDir, "calibration-prediction-manifest.json"),
    `${JSON.stringify(calManifest, null, 2)}\n`,
  );
  const frozen = await frozenCalibration(
    datasetDigest,
    splitDigest,
    devDigest,
    calDigest,
  );
  const frozenCalibrationPath = join(fitDir, "frozen-calibration.json");
  await writeFile(
    frozenCalibrationPath,
    `${JSON.stringify(frozen, null, 2)}\n`,
  );
  // `evaluate` REQUIRES the pre-registered cut beside the frozen calibration, over the
  // same dataset, split and evaluator digests.
  await writeFile(
    join(fitDir, "provisional-threshold.json"),
    `${JSON.stringify(await provisionalThresholdFixture(datasetDigest, splitDigest, devDigest, calDigest), null, 2)}\n`,
  );

  // Private test labels for the four test records.
  const testRecords = split.test;
  const testLabelsPath = join(datasetDir, "private", "test-labels.jsonl");
  await writeFile(
    testLabelsPath,
    `${testRecords
      .map((r) => JSON.stringify({ id: r.id, label: r.label }))
      .join("\n")}\n`,
  );

  const identity: HoldoutIdentity = {
    datasetDigest,
    datasetAuditDigest: DATASET_AUDIT,
    sourceReadinessDigest: SOURCE_READINESS,
    splitDigest,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: BUNDLE,
    aggregationVersion: AGGREGATION,
    contentCompositionVersion: COMPOSITION,
    tokenizerDigest: TOKENIZER,
    runtimeParityDigest: PARITY,
    extensionBuildDigest: BUILD,
    backend: "wasm",
    chromeVersion: "150.0.7871.129",
    evaluatorDigest: await evaluatorDigest(),
    calibrationArtifactDigest: frozen.artifactDigest,
  };

  const holdoutDir = join(root, "work", "holdout");
  await mkdir(holdoutDir, { recursive: true });

  return {
    datasetDir,
    splitArtifactPath,
    frozenCalibrationPath,
    testIds: split.test.map((r) => r.id),
    // filled in after the session id is known
    testPredictionsDir: "",
    testLabelsPath,
    ledgerPath: join(datasetDir, "private", "holdout-ledger.jsonl"),
    outputDir: join(root, "out"),
    activeSessionPath: join(holdoutDir, "active-session.json"),
    identity,
  };
}

async function writeTestPredictions(
  root: string,
  scenario: Scenario,
  consumptionId: string,
): Promise<string> {
  const datasetDigest = scenario.identity.datasetDigest;
  const splitDigest = scenario.identity.splitDigest;
  const dir = join(root, "work", "holdout", consumptionId, "predictions");
  await mkdir(dir, { recursive: true });
  // Every id the blind block holds, not the four named ones: `evaluate` demands exactly
  // one row per test assignment, and the block grew so the split satisfies the frozen
  // proportions per class.
  const rows = scenario.testIds.map((id, index) =>
    JSON.stringify({
      schemaVersion: 2,
      id,
      status: "scored",
      // Cycled, not accumulated: the blind block grew past ten rows and a running
      // increment leaves [0,1], which the closed prediction schema refuses.
      documentRawScore: 0.4 + (index % 5) * 0.1,
      localizedRawScore: 0.3 + (index % 5) * 0.1,
      evidenceQuality: "sufficient",
      reasonCode: "SCORED",
      coverage: 1,
      latencyMs: 40,
      memoryBytes: 1000,
    }),
  );
  const shardBody = `${rows.join("\n")}\n`;
  await writeFile(join(dir, "shard-000.jsonl"), shardBody);
  const shardSha = sha256BytesHex(new TextEncoder().encode(shardBody));
  const manifest = predictionManifest(
    "test",
    datasetDigest,
    splitDigest,
    consumptionId,
    [{ index: 0, file: "shard-000.jsonl", sha256: shardSha, recordCount: 4 }],
  );
  await writeFile(
    join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return dir;
}

describe("benchmark CLI holdout consumption via evaluate", () => {
  const created: string[] = [];

  afterEach(async () => {
    await Promise.all(
      created.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    created.length = 0;
  });

  it("requires an active consumption session and rejects a repeated tuple", async () => {
    const root = await mkdtemp(join(tmpdir(), "cf-bench-cli-eval-"));
    created.push(root);
    const scenario = await buildScenario(root);

    const evaluateArgs = (predictionsDir: string): string[] => [
      "evaluate",
      "--dataset-dir",
      scenario.datasetDir,
      "--split-artifact",
      scenario.splitArtifactPath,
      "--frozen-calibration",
      scenario.frozenCalibrationPath,
      "--test-predictions",
      predictionsDir,
      "--test-labels",
      scenario.testLabelsPath,
      "--ledger",
      scenario.ledgerPath,
      "--output",
      scenario.outputDir,
      "--bootstrap-seed",
      "712019",
    ];

    // Missing --consumption-id is rejected at flag validation.
    await expect(
      runCli(evaluateArgs(join(root, "placeholder"))),
    ).rejects.toThrow(/--consumption-id/u);

    // Open the atomic session and prove resume reopens the SAME started lease.
    const session = await beginHoldoutConsumption(
      scenario.ledgerPath,
      scenario.identity,
      SESSION_TIME,
      { activeSessionPath: scenario.activeSessionPath },
    );
    await expect(
      resumeHoldoutConsumption(
        scenario.ledgerPath,
        session.consumptionId,
        scenario.identity,
      ),
    ).resolves.toMatchObject({
      consumptionId: session.consumptionId,
      status: "started",
    });

    const predictionsDir = await writeTestPredictions(
      root,
      scenario,
      session.consumptionId,
    );

    await runCli([
      ...evaluateArgs(predictionsDir),
      "--consumption-id",
      session.consumptionId,
    ]);

    // The report was written and the session was consumed.
    const report = JSON.parse(
      await readFile(join(scenario.outputDir, "benchmark-report.json"), "utf8"),
    );
    expect(report.reportDigest).toMatch(/^[0-9a-f]{64}$/u);
    expect(report.holdoutConsumptionId).toBe(session.consumptionId);
    // The ai-recall design of the frozen table, as MEASURED over this corpus. Two
    // things are stated rather than left for a reader to infer, because a clustered
    // interval that is secretly an i.i.d. one is the defect C4 exists to remove:
    //
    //   * no level is a per-row id. The prompt template comes from the recipe, so
    //     the middle level is as coarse as the generator family it belongs to and
    //     not one unit per record-line;
    //   * and the unit is nevertheless DEGENERATE here, for a reason that is the
    //     population and not the fixture's ids: this scenario evaluates exactly two
    //     AI positives, one per generator family, and any grouping of two rows into
    //     two groups is one unit per row. Nobody may read a clustered recall
    //     interval off this corpus, and the assertion says so instead of the number
    //     looking valid.
    const recall = report.metrics.resampling.entries.find(
      (entry: { estimand: string }) => entry.estimand === "warning.recall",
    );
    expect(recall.unitAxes).toEqual([
      "groups.generatorFamily",
      "groups.promptTemplate",
      "groups.generationBatch",
    ]);
    // Positives in the blind block: four ai plus four mixed. The block holds 20% of each
    // class because the sealed audit is now re-derived from the records, so the split has
    // to satisfy the frozen proportions instead of asserting them.
    expect(recall.measured.items).toBe(8);
    expect(
      recall.measured.levels.map(
        (level: { axis: string; levels: number }) =>
          `${level.axis}=${level.levels}`,
      ),
      // Two generator families, eight prompt templates, eight batches. The template and batch
      // counts exceed the family count because a mechanistic mixed row takes `pt_${id}` — one
      // template per row, by design — so they scale with the number of mixed rows, and the
      // blind block carries 20% of every class
      // had a single mixed row.
    ).toEqual([
      "groups.generatorFamily=2",
      "groups.promptTemplate=8",
      "groups.generationBatch=8",
    ]);
    // Eight positives over eight resampling levels: every item is its own unit, which is
    // exactly the degeneracy this assertion guards.
    expect(recall.measured.degenerate).toBe(true);
    await expect(stat(scenario.activeSessionPath)).rejects.toMatchObject({
      code: "ENOENT",
    });

    // The block is consumed once; neither begin nor resume reopens it.
    await expect(
      beginHoldoutConsumption(
        scenario.ledgerPath,
        scenario.identity,
        SESSION_TIME,
        { activeSessionPath: scenario.activeSessionPath },
      ),
    ).rejects.toThrow(/holdout block was already consumed/u);
    await expect(
      resumeHoldoutConsumption(
        scenario.ledgerPath,
        session.consumptionId,
        scenario.identity,
      ),
    ).rejects.toThrow(/holdout session is terminal/u);
  });
});

// ---------------------------------------------------------------------------
// Candidate freeze: the fit gate refuses any test-prediction flag, the freeze
// is byte-identical under changed hidden test labels/scores, the fit report
// carries no test metric, and the append-only holdout ledger is never opened.
//
// A self-contained on-disk fit scenario (distinct from the evaluate scenario
// above): a sealed-shaped dataset, the governance triplet, two sharded
// prediction artifacts, plus HIDDEN test labels and a HIDDEN test-prediction
// artifact that fit must never read. Every digest is COMPUTED so the fit's own
// recomputation matches. 70 human negatives clear the 5% Wilson-upper warning
// budget with zero false positives; 20 positives score clearly higher.
// ---------------------------------------------------------------------------

const FIT_BUNDLE = hex("fit-bundle");
const FIT_TOKENIZER = hex("fit-tokenizer");
const FIT_BUILD = hex("fit-extension-build");
const FIT_INFERENCE = hex("fit-inference-core");
const FIT_PRED_DATASET = hex("fit-pred-dataset");
const FIT_PRED_SPLIT = hex("fit-pred-split");

interface FitScoreRow {
  schemaVersion: 2;
  id: string;
  status: "scored";
  documentRawScore: number;
  localizedRawScore: number;
  evidenceQuality: "sufficient";
  reasonCode: string;
  coverage: number;
  latencyMs: number;
  memoryBytes: number;
}

function fitScored(id: string, doc: number, loc: number): FitScoreRow {
  return {
    schemaVersion: 2,
    id,
    status: "scored",
    documentRawScore: doc,
    localizedRawScore: loc,
    evidenceQuality: "sufficient",
    reasonCode: "SCORED",
    coverage: 1,
    latencyMs: 40,
    memoryBytes: 1000,
  };
}

function humanScore(index: number): number {
  return 0.03 + (index % 5) * 0.01;
}
function aiScore(index: number): number {
  return 0.75 + (index % 4) * 0.03;
}

async function writeFitPredictions(
  dir: string,
  partition: "dev" | "cal-A",
  rows: readonly FitScoreRow[],
  parityDigest: string,
): Promise<void> {
  await mkdir(dir, { recursive: true });
  const shardBody = `${rows.map((r) => JSON.stringify(r)).join("\n")}\n`;
  await writeFile(join(dir, "shard-000.jsonl"), shardBody);
  const shardSha = sha256BytesHex(new TextEncoder().encode(shardBody));
  const manifest: PredictionManifestV1 = {
    schemaVersion: 1,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: FIT_BUNDLE,
    aggregationVersion: AGGREGATION,
    contentCompositionVersion: COMPOSITION,
    tokenizerDigest: FIT_TOKENIZER,
    runtimeParityDigest: parityDigest,
    extensionBuildDigest: FIT_BUILD,
    backend: "wasm",
    chromeVersion: RELEASE_CHROME_VERSION,
    datasetDigest: FIT_PRED_DATASET,
    splitDigest: FIT_PRED_SPLIT,
    partition,
    shardSize: 100,
    shardCount: 1,
    shards: [
      {
        index: 0,
        file: "shard-000.jsonl",
        sha256: shardSha,
        recordCount: rows.length,
      },
    ],
    holdoutConsumptionId: null,
    createdAt: "2026-07-19T00:00:00.000Z",
  };
  await writeFile(
    join(dir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
}

interface FitScenario {
  options: FitOptions;
  datasetDir: string;
  testLabelsPath: string;
  testPredictionsDir: string;
  ledgerPath: string;
}

// Builds the scenario twice-reproducibly: the development/calibration inputs
// and all governance are IDENTICAL across calls (recordCounter is reset), and
// only the hidden test labels/scores vary with `testVariant`.
async function buildFitScenario(
  root: string,
  testVariant: number,
  freeDiskBytes: number,
): Promise<FitScenario> {
  recordCounter = 0;
  // Five clusters per fit partition, so the cluster-atomised cross-validation has
  // ten atoms for its five folds. The blocks are CONTIGUOUS rather than strided so a
  // cluster does not coincide with one raw-score value, which would hand a fold a
  // score region its own training half never sees.
  const devHumans = Array.from({ length: 35 }, (_u, i) =>
    record("human", 10 + i, "acme_family", `dev_${(i / 7) | 0}`),
  );
  const devAis = Array.from({ length: 10 }, (_u, i) =>
    record("ai", 50 + i, "acme_family", `dev_${(i / 2) | 0}`),
  );
  const calHumans = Array.from({ length: 35 }, (_u, i) =>
    record("human", 110 + i, "acme_family", `cal_${(i / 7) | 0}`),
  );
  const calAis = Array.from({ length: 10 }, (_u, i) =>
    record("ai", 150 + i, "acme_family", `cal_${(i / 2) | 0}`),
  );
  const testRecords = [
    record("human", 310, "acme_family", "tst_0"),
    record("human", 311, "acme_family", "tst_0"),
    record("ai", 320, "heldout_family", "tst_1"),
    record("ai", 321, "heldout_family", "tst_1"),
  ];
  // Filler that makes the split satisfy the frozen proportions per class, since the sealed
  // audit is re-derived from these records. Reading off the two fixed dev populations:
  // 35 dev humans at 5% pin human to 700, and 10 dev AI rows pin ai to 200. `cal-A` needs
  // twice `dev` because its target is twice as large.
  const padB = (
    label: BenchmarkRecord["label"],
    count: number,
    createdAt: number,
    tag: string,
  ): BenchmarkRecord[] =>
    Array.from({ length: count }, (_u, i) =>
      record(label, createdAt, "acme_family", `${tag}_${label}_${i}`),
    );
  const trainPadB = [
    ...padB("human", 315, 2, "trn"),
    ...padB("ai", 90, 3, "trn"),
  ];
  const calAPadB = [
    ...padB("human", 35, 180, "cla"),
    ...padB("ai", 10, 181, "cla"),
  ];
  const calBPadB = [
    ...padB("human", 140, 200, "clb"),
    ...padB("ai", 40, 201, "clb"),
  ];
  // Never the reserved family outside the block it belongs to.
  const testPadB = [
    ...padB("human", 138, 350, "tst"),
    ...padB("ai", 38, 351, "tst"),
  ];
  const allRecords = [
    ...trainPadB,
    ...devHumans,
    ...devAis,
    ...calHumans,
    ...calAis,
    ...calAPadB,
    ...calBPadB,
    ...testRecords,
    ...testPadB,
  ];

  // Source manifest: raw bytes gate the audit/manifest raw SHA; the canonical
  // self-digest (its own field excluded) gates the readiness report.
  const sourceBase = {
    schemaVersion: 1,
    corpus: "cleanfeed-ptbr-cells-v1",
    note: "fixture source manifest",
  };
  const sourceDigest = await canonicalSha256(sourceBase);
  const sourceBytes = JSON.stringify({
    ...sourceBase,
    sourceManifestDigest: sourceDigest,
  });
  const sourceSha = sha256BytesHex(new TextEncoder().encode(sourceBytes));
  const reviewLedgerSha = hex("fit-review-ledger");

  const manifest: DatasetManifest = {
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
    recordsSha256: hex("fit-records"),
    reviewLedgerFile: "private/review-ledger.jsonl",
    reviewLedgerSha256: reviewLedgerSha,
    sourceManifestFile: "private/source-manifest.json",
    sourceManifestSha256: sourceSha,
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
    licenses: [
      {
        id: "consent-v1",
        name: "Authorized contribution",
        source: "fixture://consent",
        evaluationUseApproved: true,
        redistribution: "not-published",
        notice: "Contributed under explicit consent.",
      },
    ],
  };

  const datasetDir = join(root, "dataset");
  await mkdir(join(datasetDir, "private"), { recursive: true });
  await writeFile(
    join(datasetDir, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  await writeFile(
    join(datasetDir, "records.jsonl"),
    `${allRecords.map((r) => JSON.stringify(r)).join("\n")}\n`,
  );
  await writeFile(
    join(datasetDir, "private", "source-manifest.json"),
    sourceBytes,
  );

  const split: DatasetSplit<BenchmarkRecord> = {
    train: trainPadB,
    dev: [...devHumans, ...devAis],
    "cal-A": [...calHumans, ...calAis, ...calAPadB],
    "cal-B": calBPadB,
    test: [...testRecords, ...testPadB],
  };
  const policy = {
    fractions: {
      train: 0.45,
      dev: 0.05,
      "cal-A": 0.1,
      "cal-B": 0.2,
      test: 0.2,
    },
    classTolerance: 0.02,
    heldOutGeneratorFamilies: [asGeneratorFamily("heldout_family")],
    seed: 20260804,
  } as const;
  const splitArtifact = await buildSplitArtifact({
    manifest,
    records: allRecords,
    split,
    policy,
    audit: auditBlockedSplit(
      allRecords,
      split,
      FROZEN_SPLIT_AUDIT_POLICY,
      policy.heldOutGeneratorFamilies,
      DECLARED_GROUP_AXES,
    ),
  });
  const splitArtifactPath = join(root, "split-artifact.json");
  await writeFile(
    splitArtifactPath,
    `${JSON.stringify(splitArtifact, null, 2)}\n`,
  );

  const humanCount = allRecords.filter((r) => r.label === "human").length;
  const aiCount = allRecords.filter((r) => r.label === "ai").length;
  const auditBase: Omit<DatasetAudit, "auditDigest"> = {
    datasetId: "cleanfeed-ptbr-cells-v1",
    scientificUse: "infrastructure-only",
    releaseEligible: false,
    recordCount: allRecords.length,
    counts: { human: humanCount, ai: aiCount, mixed: 0 },
    sourceTypes: { "qa-informal": 1 },
    hardNegativeFamilies: { formulaic: 1 },
    generatorFamilies: { acme_family: aiCount },
    labelBasisCounts: emptyLabelBasisPublication(),
    licenses: ["consent-v1"],
    recordsSha256: hex("fit-records"),
    reviewLedgerSha256: reviewLedgerSha,
    sourceManifestSha256: sourceSha,
    sealed: true,
  };
  const audit: DatasetAudit = {
    ...auditBase,
    auditDigest: await computeDatasetAuditDigest(auditBase),
  };
  const datasetAuditPath = join(root, "dataset-audit.json");
  await writeFile(datasetAuditPath, `${JSON.stringify(audit, null, 2)}\n`);

  const readinessBase = {
    schemaVersion: 1 as const,
    status: "ready" as const,
    sourceManifestDigest: sourceDigest,
    recordCount: 94,
    sourceCount: 3,
    acquisitionCounts: { consent: 40, licensed: 40, generated: 14 },
    protocols: {
      corpus: "corpus-v1" as const,
      collection: "collection-v1" as const,
      annotation: "annotation-v1" as const,
      generation: "generation-v1" as const,
      pii: "pii-review-v1" as const,
    },
    blockingReasons: [],
  };
  const readiness: CorpusSourceReadinessReport = {
    ...readinessBase,
    reportDigest: await computeSourceReadinessDigest(readinessBase),
  };
  const sourceReadinessPath = join(root, "source-readiness.json");
  await writeFile(
    sourceReadinessPath,
    `${JSON.stringify(readiness, null, 2)}\n`,
  );

  const parityBase = {
    schemaVersion: 1 as const,
    modelId: MODEL_ID,
    modelVersion: MODEL_VERSION,
    bundleDigest: FIT_BUNDLE,
    aggregationVersion: AGGREGATION,
    contentCompositionVersion: COMPOSITION,
    tokenizerDigest: FIT_TOKENIZER,
    inferenceCoreDigest: FIT_INFERENCE,
  };
  const parity: RuntimeParityManifestV1 = {
    ...parityBase,
    runtimeParityDigest: await computeRuntimeParityDigest(parityBase),
  };
  const runtimeParityPath = join(root, "runtime-parity.json");
  await writeFile(runtimeParityPath, `${JSON.stringify(parity, null, 2)}\n`);

  const developmentPredictionsDirectory = join(root, "dev");
  const calibrationPredictionsDirectory = join(root, "cal");
  await writeFitPredictions(
    developmentPredictionsDirectory,
    "dev",
    [
      ...devHumans.map((r, i) => fitScored(r.id, humanScore(i), humanScore(i))),
      ...devAis.map((r, i) => fitScored(r.id, aiScore(i), aiScore(i))),
    ],
    parity.runtimeParityDigest,
  );
  await writeFitPredictions(
    calibrationPredictionsDirectory,
    "cal-A",
    [
      ...calHumans.map((r, i) => fitScored(r.id, humanScore(i), humanScore(i))),
      ...calAis.map((r, i) => fitScored(r.id, aiScore(i), aiScore(i))),
      // The cal-A filler is inside the fit population, so `fit` demands a row per id.
      ...calAPadB.map((r, i) =>
        r.label === "human"
          ? fitScored(r.id, humanScore(i), humanScore(i))
          : fitScored(r.id, aiScore(i), aiScore(i)),
      ),
    ],
    parity.runtimeParityDigest,
  );

  // HIDDEN test labels and HIDDEN test scores — fit must read NEITHER. Their
  // contents vary with `testVariant` so a byte-identical freeze proves it.
  const testLabelsPath = join(datasetDir, "private", "test-labels.jsonl");
  await writeFile(
    testLabelsPath,
    `${testRecords
      .map((r, i) =>
        JSON.stringify({
          id: r.id,
          label: testVariant === 0 ? r.label : i % 2 === 0 ? "ai" : "human",
        }),
      )
      .join("\n")}\n`,
  );
  const testPredictionsDir = join(root, "test-predictions");
  await mkdir(testPredictionsDir, { recursive: true });
  await writeFile(
    join(testPredictionsDir, "shard-000.jsonl"),
    `${testRecords
      .map((r, i) =>
        JSON.stringify(
          fitScored(
            r.id,
            testVariant === 0 ? 0.1 + i * 0.1 : 0.9 - i * 0.1,
            testVariant === 0 ? 0.2 + i * 0.1 : 0.8 - i * 0.1,
          ),
        ),
      )
      .join("\n")}\n`,
  );

  const outputDirectory = join(root, "out");
  await mkdir(outputDirectory, { recursive: true });

  return {
    options: {
      datasetDirectory: datasetDir,
      datasetAuditPath,
      sourceReadinessPath,
      splitArtifactPath,
      runtimeParityPath,
      developmentPredictionsDirectory,
      calibrationPredictionsDirectory,
      outputDirectory,
      seed: 712019,
      freeDiskBytes,
    },
    datasetDir,
    testLabelsPath,
    testPredictionsDir,
    ledgerPath: join(datasetDir, "private", "holdout-ledger.jsonl"),
  };
}

const FIT_FREEZE_TIMEOUT_MS = 120_000;
const SUFFICIENT_DISK = 30 * 1024 ** 3;

describe("benchmark CLI fit freeze — holdout independence", () => {
  const created: string[] = [];
  afterEach(async () => {
    await Promise.all(
      created.map((dir) => rm(dir, { recursive: true, force: true })),
    );
    created.length = 0;
  });
  async function newRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), "cf-fit-freeze-"));
    created.push(root);
    return root;
  }

  it("rejects a test-prediction flag on fit as an unknown flag", async () => {
    await expect(
      runCli([
        "fit",
        "--dataset-dir",
        "d",
        "--dataset-audit",
        "a.json",
        "--source-readiness",
        "s.json",
        "--split-artifact",
        "split.json",
        "--runtime-parity",
        "rp.json",
        "--development-predictions",
        "dev",
        "--calibration-predictions",
        "cal",
        "--output",
        "out",
        "--seed",
        "712019",
        "--test-predictions",
        "test",
      ]),
    ).rejects.toThrow(/unknown flag --test-predictions/u);
  });

  it(
    "freezes byte-identically under changed hidden test labels/scores, writes no test metric, and never opens the ledger",
    async () => {
      const rootA = await newRoot();
      const scenarioA = await buildFitScenario(rootA, 0, SUFFICIENT_DISK);
      await expect(runFit(scenarioA.options)).resolves.toContain(
        "no test access",
      );
      const frozenA = await readFile(
        join(scenarioA.options.outputDirectory, "frozen-calibration.json"),
        "utf8",
      );
      const fitReportA = await readFile(
        join(scenarioA.options.outputDirectory, "fit-report.json"),
        "utf8",
      );

      const rootB = await newRoot();
      const scenarioB = await buildFitScenario(rootB, 1, SUFFICIENT_DISK);
      await runFit(scenarioB.options);
      const frozenB = await readFile(
        join(scenarioB.options.outputDirectory, "frozen-calibration.json"),
        "utf8",
      );
      const fitReportB = await readFile(
        join(scenarioB.options.outputDirectory, "fit-report.json"),
        "utf8",
      );

      // The hidden test labels/scores genuinely differ between the two runs...
      expect(await readFile(scenarioA.testLabelsPath, "utf8")).not.toEqual(
        await readFile(scenarioB.testLabelsPath, "utf8"),
      );
      // ...yet the frozen calibration and the fit report are byte-identical.
      expect(frozenA).toEqual(frozenB);
      expect(fitReportA).toEqual(fitReportB);

      // The fit report binds the ready preflight and carries no test metric.
      const fitReport = JSON.parse(fitReportA);
      expect(fitReport.preflight.status).toBe("ready");
      expect(fitReport.partitionsUsed).toEqual(["dev", "cal-A"]);
      const frozen = JSON.parse(frozenA);
      expect(fitReport.calibrationArtifactDigest).toBe(frozen.artifactDigest);
      expect(fitReport.datasetAuditDigest).toBe(
        fitReport.preflight.datasetAuditDigest,
      );
      expect(fitReport.predictionManifestDigests).toEqual({
        development: fitReport.preflight.developmentPredictionManifestDigest,
        calibration: fitReport.preflight.calibrationPredictionManifestDigest,
      });
      const forbidden = /test|holdout|consumption/i;
      const walk = (value: unknown): void => {
        if (Array.isArray(value)) {
          value.forEach(walk);
        } else if (value !== null && typeof value === "object") {
          for (const key of Object.keys(value)) {
            expect(key).not.toMatch(forbidden);
            walk((value as Record<string, unknown>)[key]);
          }
        }
      };
      walk(fitReport);

      // The append-only holdout ledger is never opened by a fit.
      await expect(stat(scenarioA.ledgerPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
      await expect(
        stat(join(scenarioA.datasetDir, "private", "active-session.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    },
    FIT_FREEZE_TIMEOUT_MS,
  );

  it(
    "requires a ready preflight: a fit with under 20 GiB free disk is blocked before it fits",
    async () => {
      const root = await newRoot();
      const scenario = await buildFitScenario(root, 0, 19 * 1024 ** 3);
      await expect(runFit(scenario.options)).rejects.toThrow(
        /CANDIDATE_PREFLIGHT_BLOCKED|disk/u,
      );
      // Nothing was frozen and the ledger stays unopened.
      await expect(
        stat(join(scenario.options.outputDirectory, "frozen-calibration.json")),
      ).rejects.toMatchObject({ code: "ENOENT" });
      await expect(stat(scenario.ledgerPath)).rejects.toMatchObject({
        code: "ENOENT",
      });
    },
    FIT_FREEZE_TIMEOUT_MS,
  );
});
