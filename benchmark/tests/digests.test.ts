import { afterAll, describe, expect, it } from "vitest";

import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  canonicalJson,
  canonicalSha256,
} from "../../contracts/canonical-json.ts";
import {
  computeDatasetDigest,
  computeEvaluatorDigest,
  EVALUATOR_FILES,
  sha256BytesHex,
} from "../digests.ts";
import type { DatasetManifest } from "../dataset-manifest.ts";
import type { BenchmarkLabel, BenchmarkRecord } from "../schema.ts";

const SHA = "a".repeat(64);

const manifest: DatasetManifest = {
  schemaVersion: 1,
  datasetId: "ptbr-generic-v1",
  version: "1.0.0",
  scientificUse: "infrastructure-only",
  intendedLanguage: "pt-BR",
  intendedDomain: "generic",
  createdAt: "2026-07-19T00:00:00.000Z",
  normalizationVersion: "cleanfeed-text-v1",
  annotationProtocolVersion: "annotation-v1",
  recordsFile: "records.jsonl",
  recordsSha256: "1".repeat(64),
  reviewLedgerFile: "private/review-ledger.jsonl",
  reviewLedgerSha256: "2".repeat(64),
  sourceManifestFile: "private/source-manifest.json",
  sourceManifestSha256: "3".repeat(64),
  heldOutGeneratorFamilies: ["family-unseen"],
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

function makeRecord(id: string, label: BenchmarkLabel): BenchmarkRecord {
  return {
    schemaVersion: 2,
    id,
    text: `texto ${id}`,
    normalizedTextSha256: SHA,
    label,
    language: "pt-BR",
    platform: "generic",
    domain: "corporate",
    topic: "carreira",
    wordCount: 100,
    createdAt: 1,
    provenance: {
      sourceKind: "licensed-corpus",
      sourceId: "src",
      sourceRevision: "rev1",
      collectedAt: 1,
      licenseId: "cc-by",
      legalBasis: "license",
      piiAudit: {
        status: "passed",
        method: "manual-and-automated",
        reviewerId: "rev1",
        reviewedAt: 1,
      },
    },
    annotation: {
      protocolVersion: "annotation-v1",
      reviewerIds: ["rev1", "rev2"],
      agreement: "agree",
    },
    transformation: { kind: "none", severity: "none" },
    groups: {
      author: `author_${id}`,
      source: `source_${id}`,
      domainSource: `ds_${id}`,
      collectionBatch: `cb_${id}`,
      nearDuplicate: `nd_${id}`,
      derivationRoot: id,
    },
  };
}

const record = makeRecord("h_0001", "human");
const records = [
  makeRecord("h_0001", "human"),
  makeRecord("a_0001", "ai"),
  makeRecord("m_0001", "mixed"),
];

describe("canonical evidence", () => {
  it("sorts object keys while preserving array order", () => {
    expect(canonicalJson({ z: 1, a: [3, { y: 2, x: 1 }] })).toBe(
      '{"a":[3,{"x":1,"y":2}],"z":1}',
    );
  });

  it("rejects non-finite numbers", () => {
    expect(() => canonicalJson({ value: Number.NaN })).toThrow(/non-finite/);
  });

  it("changes the dataset digest when one record changes", async () => {
    const first = await computeDatasetDigest(manifest, [record]);
    const second = await computeDatasetDigest(manifest, [
      { ...record, text: `${record.text}!` },
    ]);
    expect(first).not.toBe(second);
  });
});

describe("computeDatasetDigest", () => {
  it("reuses Phase 1 canonicalization with no drift", async () => {
    // The Phase 1 sealed empty-set vector: the benchmark byte hasher must land on
    // the exact same digest as the shared canonicalSha256, proving no drift.
    expect(sha256BytesHex(new TextEncoder().encode(canonicalJson([])))).toBe(
      "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945",
    );
    const value = { z: 1, a: [3, { y: 2, x: 1 }] };
    expect(sha256BytesHex(new TextEncoder().encode(canonicalJson(value)))).toBe(
      await canonicalSha256(value),
    );
  });

  it("is deterministic and permutation-invariant across record order", async () => {
    const forward = await computeDatasetDigest(manifest, records);
    const again = await computeDatasetDigest(manifest, records);
    const reversed = await computeDatasetDigest(
      manifest,
      [...records].reverse(),
    );
    expect(again).toBe(forward);
    expect(reversed).toBe(forward);
  });

  it("orders records by unicode codepoint, never host locale collation", async () => {
    // Uppercase "B" (U+0042) sorts BEFORE lowercase "a" (U+0061) by codepoint,
    // whereas a locale-aware collation orders ["a","B"]. The digest must be a
    // pure function of the bytes, so it must land on the codepoint order on any
    // host regardless of the ICU tables installed there.
    const recordA = makeRecord("a", "human");
    const recordB = makeRecord("B", "ai");
    const codepointPayload = `${canonicalJson(manifest)}\n${canonicalJson(
      recordB,
    )}\n${canonicalJson(recordA)}\n`;
    const collationPayload = `${canonicalJson(manifest)}\n${canonicalJson(
      recordA,
    )}\n${canonicalJson(recordB)}\n`;
    const codepointDigest = sha256BytesHex(
      new TextEncoder().encode(codepointPayload),
    );
    const collationDigest = sha256BytesHex(
      new TextEncoder().encode(collationPayload),
    );
    expect(codepointDigest).not.toBe(collationDigest);

    const digest = await computeDatasetDigest(manifest, [recordA, recordB]);
    expect(digest).toBe(codepointDigest);
    expect(digest).not.toBe(collationDigest);
    // Independent of insertion order.
    expect(await computeDatasetDigest(manifest, [recordB, recordA])).toBe(
      codepointDigest,
    );
  });

  it("changes when only the manifest reviewLedgerSha256 changes", async () => {
    const base = await computeDatasetDigest(manifest, records);
    const drifted = await computeDatasetDigest(
      { ...manifest, reviewLedgerSha256: "9".repeat(64) },
      records,
    );
    expect(drifted).not.toBe(base);
  });

  it("changes when only the manifest sourceManifestSha256 changes", async () => {
    const base = await computeDatasetDigest(manifest, records);
    const drifted = await computeDatasetDigest(
      { ...manifest, sourceManifestSha256: "9".repeat(64) },
      records,
    );
    expect(drifted).not.toBe(base);
  });
});

// computeEvaluatorDigest reads the real evaluator source tree; several listed
// modules belong to later Phase 2 tasks and do not exist yet, so the digest is
// exercised against controlled temporary trees rather than the live repo.
const tempRoots: string[] = [];

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "cleanfeed-evaluator-"));
  tempRoots.push(root);
  return root;
}

async function writeEvaluatorFixture(
  root: string,
  mutate?: (relativePath: string, content: string) => string,
): Promise<void> {
  for (const relativePath of EVALUATOR_FILES) {
    const absolute = join(root, relativePath);
    await mkdir(dirname(absolute), { recursive: true });
    const base = `// fixture content for ${relativePath}\n`;
    await writeFile(
      absolute,
      mutate ? mutate(relativePath, base) : base,
      "utf8",
    );
  }
}

afterAll(async () => {
  await Promise.all(
    tempRoots.map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("computeEvaluatorDigest", () => {
  it("binds the Task-13 orchestration layer into the evaluator identity", () => {
    const files = new Set<string>(EVALUATOR_FILES);
    // The layer that builds the IntegrityEvidence and applies the calibration
    // to produce the gate decision must be inside the closed inventory, so a
    // change to it cannot masquerade as the same evaluator.
    expect(files.has("benchmark/commands/evaluate.ts")).toBe(true);
    expect(files.has("benchmark/cli.ts")).toBe(true);
    expect(files.has("benchmark/holdout-ledger.ts")).toBe(true);
    for (const command of [
      "validate",
      "split",
      "validate-predictions",
      "fit",
      "evaluate",
      "publish-profile",
      "verify-evidence",
      "io",
    ]) {
      expect(files.has(`benchmark/commands/${command}.ts`)).toBe(true);
    }
  });

  it("binds the Phase-3 scoring/holdout orchestration into the evaluator identity", () => {
    const files = new Set<string>(EVALUATOR_FILES);
    // Every module that shapes a scored prediction, the frozen-calibration
    // freeze precondition or the release/source-readiness gate verdict must be
    // inside the closed inventory, so a post-freeze edit to any of them cannot
    // masquerade as the same evaluator. A future removal regresses this test.
    for (const relativePath of [
      "benchmark/browser-scorer.ts",
      "benchmark/prediction-shards.ts",
      "benchmark/candidate-preflight.ts",
      "benchmark/commands/score.ts",
      "benchmark/commands/consume-holdout.ts",
      "benchmark/corpus-source-audit.ts",
    ]) {
      expect(files.has(relativePath)).toBe(true);
    }
  });

  it("is deterministic for two identical evaluator trees", async () => {
    const first = await makeRoot();
    const second = await makeRoot();
    await writeEvaluatorFixture(first);
    await writeEvaluatorFixture(second);
    expect(await computeEvaluatorDigest(first)).toBe(
      await computeEvaluatorDigest(second),
    );
  });

  it("changes when a single evaluator byte changes", async () => {
    const clean = await makeRoot();
    const tampered = await makeRoot();
    await writeEvaluatorFixture(clean);
    await writeEvaluatorFixture(tampered, (relativePath, content) =>
      relativePath === "benchmark/split.ts" ? `${content}// drift\n` : content,
    );
    expect(await computeEvaluatorDigest(tampered)).not.toBe(
      await computeEvaluatorDigest(clean),
    );
  });

  it("changes when a Phase-3 scoring byte changes (browser-scorer.ts)", async () => {
    // Load-bearing proof that the newly-bound scoring module is inside the
    // hashed set: tampering browser-scorer.ts must move the evaluator digest.
    // Before this file was added to EVALUATOR_FILES the fixture never wrote it
    // and the mutation was invisible, so the two digests were equal.
    const clean = await makeRoot();
    const tampered = await makeRoot();
    await writeEvaluatorFixture(clean);
    await writeEvaluatorFixture(tampered, (relativePath, content) =>
      relativePath === "benchmark/browser-scorer.ts"
        ? `${content}// clamp\n`
        : content,
    );
    expect(await computeEvaluatorDigest(tampered)).not.toBe(
      await computeEvaluatorDigest(clean),
    );
  });

  it("refuses a declared-but-absent evaluator file", async () => {
    const root = await makeRoot();
    await writeEvaluatorFixture(root);
    await rm(join(root, "package-lock.json"));
    await expect(computeEvaluatorDigest(root)).rejects.toThrow();
  });
});
