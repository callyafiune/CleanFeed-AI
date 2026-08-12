import { afterAll, describe, expect, it } from "vitest";

import { readFile, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  canonicalJson,
  canonicalSha256,
} from "../../contracts/canonical-json.ts";
import {
  computeDatasetDigest,
  computeEvaluatorDigest,
  EVALUATOR_FILES,
  observeEvaluatorFiles,
  sha256BytesHex,
} from "../digests.ts";
import type { DatasetManifest } from "../dataset-manifest.ts";
import type { BenchmarkLabel, BenchmarkRecord } from "../schema.ts";
import { asGeneratorFamily } from "../generator-family.ts";
import {
  makeEvaluatorRoot,
  writeEvaluatorFixture,
} from "./helpers/evaluator-tree.ts";

const SHA = "a".repeat(64);

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

// computeEvaluatorDigest reads the real evaluator source tree. The RECIPE is exercised
// against controlled temporary trees, because the properties being measured are
// differences — one file's bytes moved, one file is absent — and a fixture is the only
// way to move one thing at a time. The NUMBER over the live tree is a separate
// assertion, below.
const tempRoots: string[] = [];
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function makeRoot(): Promise<string> {
  const root = await makeEvaluatorRoot();
  tempRoots.push(root);
  return root;
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

  it("binds the corpus-composition gate into the evaluator identity", () => {
    const files = new Set<string>(EVALUATOR_FILES);
    // It decides whether a `release` corpus may be frozen at all, so its bytes decide
    // which corpus the evaluator is ever allowed to measure. A future removal
    // regresses this test.
    expect(files.has("benchmark/composition-gate.ts")).toBe(true);
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

  it("changes when a composition-gate byte changes", async () => {
    // Load-bearing proof that the gate is inside the hashed set: without the
    // EVALUATOR_FILES entry the fixture never writes this file and the mutation is
    // invisible, so the two digests come out equal.
    const clean = await makeRoot();
    const tampered = await makeRoot();
    await writeEvaluatorFixture(clean);
    await writeEvaluatorFixture(tampered, (relativePath, content) =>
      relativePath === "benchmark/composition-gate.ts"
        ? `${content}// floor\n`
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
    await expect(computeEvaluatorDigest(root)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("is published in the ESTADO at the value the LIVE tree hashes to", async () => {
    // § 5.6 of `docs/ESTADO.md` is where this number is published as MEASURED, and prose
    // does not recompute: a digest read before the last edit to an evaluator file stays
    // in the document, agreeing with nothing, and the whole suite passes over it. Which
    // happened. Reading it here is the only thing that makes the published value a
    // measurement rather than a memory.
    const digest = await computeEvaluatorDigest(REPO_ROOT);
    const estado = await readFile(resolve(REPO_ROOT, "docs/ESTADO.md"), "utf8");
    expect(
      evaluatorDigestPublicationProblems(estado, digest),
      "docs/ESTADO.md",
    ).toEqual([]);
  });

  // The five below mutate the REAL bytes in memory. A synthetic ESTADO would prove the
  // criterion and nothing about the anchor matching the real document's form — the table
  // syntax and the row label are what the anchor keys on — and each one names an input the
  // assertion this replaced (`estado.toContain`) accepts.

  it("accepts the real ESTADO once its publication row carries the live digest", async () => {
    const digest = await computeEvaluatorDigest(REPO_ROOT);
    const estado = await readFile(resolve(REPO_ROOT, "docs/ESTADO.md"), "utf8");
    expect(
      evaluatorDigestPublicationProblems(
        withPublishedEvaluatorDigest(estado, digest),
        digest,
      ),
    ).toEqual([]);
  });

  it("refuses a stale publication row when the live value sits elsewhere in the document", async () => {
    const digest = await computeEvaluatorDigest(REPO_ROOT);
    const estado = await readFile(resolve(REPO_ROOT, "docs/ESTADO.md"), "utf8");
    const stale = `${withPublishedEvaluatorDigest(estado, "0".repeat(64))}\n## Histórico\n\n- medição anterior: \`${digest}\`\n`;
    expect(stale, "the whole-file read accepts this input").toContain(
      `\`${digest}\``,
    );
    expect(evaluatorDigestPublicationProblems(stale, digest)).toEqual([
      `the publication row does not carry the live digest \`${digest}\``,
    ]);
  });

  it("refuses two publication rows carrying two values", async () => {
    const digest = await computeEvaluatorDigest(REPO_ROOT);
    const estado = await readFile(resolve(REPO_ROOT, "docs/ESTADO.md"), "utf8");
    const twice = `${withPublishedEvaluatorDigest(estado, digest)}\n| \`evaluatorDigest\` da árvore | \`${"0".repeat(64)}\` |\n`;
    expect(twice, "the whole-file read accepts this input").toContain(
      `\`${digest}\``,
    );
    expect(evaluatorDigestPublicationProblems(twice, digest)).toEqual([
      "2 rows publish the evaluator digest, not exactly 1",
    ]);
  });

  it("refuses ONE publication row that keeps a second digest beside the live one", async () => {
    const digest = await computeEvaluatorDigest(REPO_ROOT);
    const estado = await readFile(resolve(REPO_ROOT, "docs/ESTADO.md"), "utf8");
    const beside = withPublishedEvaluatorDigest(estado, digest)
      .split(/\r?\n/u)
      .map((line) =>
        EVALUATOR_DIGEST_PUBLICATION_ROW.test(line)
          ? `${line.replace(/\|\s*$/u, "")} — antes: \`${"0".repeat(64)}\` |`
          : line,
      )
      .join("\n");
    // One row, and the live digest IS on it: reading the row for containment accepts this
    // input, and the stale hex stays printed next to the number a reader takes as measured.
    expect(
      beside
        .split(/\r?\n/u)
        .filter((line) => EVALUATOR_DIGEST_PUBLICATION_ROW.test(line)),
      "one row",
    ).toHaveLength(1);
    expect(
      beside
        .split(/\r?\n/u)
        .find((line) => EVALUATOR_DIGEST_PUBLICATION_ROW.test(line)),
      "the row-containment read accepts this input",
    ).toContain(`\`${digest}\``);
    expect(evaluatorDigestPublicationProblems(beside, digest)).toEqual([
      "the publication row carries 2 digest-shaped values, not exactly 1",
    ]);
  });

  it("refuses an ESTADO with no publication row at all", async () => {
    const digest = await computeEvaluatorDigest(REPO_ROOT);
    const estado = await readFile(resolve(REPO_ROOT, "docs/ESTADO.md"), "utf8");
    const deleted = estado
      .split(/\r?\n/u)
      .filter((line) => !EVALUATOR_DIGEST_PUBLICATION_ROW.test(line))
      .join("\n");
    expect(evaluatorDigestPublicationProblems(deleted, digest)).toEqual([
      "0 rows publish the evaluator digest, not exactly 1",
    ]);
  });
});

/**
 * The ESTADO row that PUBLISHES the evaluator digest, anchored on the row LABEL.
 *
 * The label, not the enclosing section: `### 5.6 Outros` delimits a region the operator
 * reorganises legitimately, while what a reader reads the number OFF is the table row. The
 * `^\|` is load-bearing — the document also mentions `evaluatorDigest` inside prose cells
 * (§ 5.1b names it while arguing that correcting the frozen bands would move it), and a
 * pattern without the row start counts those as publications.
 */
const EVALUATOR_DIGEST_PUBLICATION_ROW = /^\|\s*`evaluatorDigest`/u;

/**
 * Why the published number can go stale where a whole-file `toContain` cannot see it: the
 * digest occurring ANYWHERE satisfies containment, so a stale live row plus a `Histórico`
 * block carrying the new value reads as published. Exactly one row publishes it, that row
 * carries exactly one digest-shaped value, and that value is the live one.
 *
 * The middle condition is not decoration. Multiplicity across rows and multiplicity WITHIN
 * one row are the same defect — a hex the operator forgot to overwrite, sitting in the
 * document agreeing with nothing — and containment on the row is blind to the second: the
 * live digest being present makes the row pass while the stale one is still printed beside
 * it. Counting is what closes it, so the row is held to one value and not to containing one.
 */
function evaluatorDigestPublicationProblems(
  estado: string,
  digest: string,
): string[] {
  const rows = estado
    .split(/\r?\n/u)
    .filter((line) => EVALUATOR_DIGEST_PUBLICATION_ROW.test(line));
  if (rows.length !== 1) {
    return [`${rows.length} rows publish the evaluator digest, not exactly 1`];
  }
  const published = [...rows[0].matchAll(/`[0-9a-f]{64}`/gu)].map(
    (match) => match[0],
  );
  if (published.length !== 1) {
    return [
      `the publication row carries ${published.length} digest-shaped values, not exactly 1`,
    ];
  }
  return published[0] === `\`${digest}\``
    ? []
    : [`the publication row does not carry the live digest \`${digest}\``];
}

/**
 * The real ESTADO with `digest` written into whatever the publication row publishes.
 *
 * The mutations need a document whose row is at a KNOWN value while every other byte stays
 * real, and they must behave the same whether or not the tracked ESTADO happens to be up
 * to date — republishing after an `EVALUATOR_FILES` move is the operator's integration
 * step, not a precondition of these proofs.
 */
function withPublishedEvaluatorDigest(estado: string, digest: string): string {
  return estado
    .split(/\r?\n/u)
    .map((line) =>
      EVALUATOR_DIGEST_PUBLICATION_ROW.test(line)
        ? line.replaceAll(/`[0-9a-f]{64}`/gu, `\`${digest}\``)
        : line,
    )
    .join("\n");
}

/**
 * `line:column` for a byte offset, because `path:number` is read as a line number by
 * every editor and CI annotator, and a byte offset put there points nowhere. The
 * column counts BYTES, which is the same as characters only on an ASCII line, so the
 * caller keeps the exact offset in the message as well.
 */
function lineAndColumn(bytes: Buffer, offset: number): string {
  let line = 1;
  let lineStart = 0;
  for (let index = 0; index < offset; index += 1) {
    if (bytes[index] === 0x0a) {
      line += 1;
      lineStart = index + 1;
    }
  }
  return `${line}:${offset - lineStart + 1}`;
}

describe("the bytes EVALUATOR_FILES hashes", () => {
  it("carry no raw control byte, so no code-search tool can skip an evaluator file", async () => {
    // A raw 0x00 makes grep and ripgrep classify a source file as binary and skip it
    // whole, and makes `git diff` print "Binary files differ" instead of the change
    // once the byte sits inside the first 8000 bytes. Both hide a file whose BYTES are
    // the evaluator's identity, and neither is visible in review — which is why the
    // control characters these modules key composite fields on are written as escapes
    // (`benchmark/bootstrap.ts`, `benchmark/near-duplicates.ts`,
    // `benchmark/split-audit.ts`).
    //
    // The tracked-tree counterpart is in `tests/unit/repo/line-endings.test.ts`. This
    // one stays because it exempts NOTHING: the tree-wide sweep lets through whatever
    // extension `.gitattributes` declares binary, and no member of this list may be
    // skipped for any reason — their bytes are what the evaluator's identity is.
    //
    // CR is excluded on purpose: line endings are owned by the working-tree EOL check,
    // and failing here for a checkout setting would be a different defect wearing this
    // test's name.
    const offenders: string[] = [];
    for (const relativePath of EVALUATOR_FILES) {
      const bytes = await readFile(resolve(REPO_ROOT, relativePath));
      for (const [offset, byte] of bytes.entries()) {
        const invisible =
          (byte < 0x20 && byte !== 0x0a && byte !== 0x09 && byte !== 0x0d) ||
          byte === 0x7f;
        if (invisible) {
          offenders.push(
            `${relativePath}:${lineAndColumn(bytes, offset)} carries 0x${byte
              .toString(16)
              .padStart(2, "0")} at byte offset ${offset}`,
          );
          break;
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("observeEvaluatorFiles", () => {
  it("covers the whole inventory in lexicographic order without touching the aggregate", async () => {
    const root = await makeRoot();
    await writeEvaluatorFixture(root);
    const aggregateBefore = await computeEvaluatorDigest(root);

    const observed = await observeEvaluatorFiles(root);
    expect(observed.map((file) => file.path)).toEqual(
      [...EVALUATOR_FILES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    for (const file of observed) {
      expect(file.digest).toMatch(/^[0-9a-f]{64}$/u);
    }
    // Purely additive: observing the tree cannot move the sealed recipe, or a
    // digest written by an earlier fit would stop comparing equal.
    expect(await computeEvaluatorDigest(root)).toBe(aggregateBefore);
  });

  it("names exactly the file whose bytes moved", async () => {
    const clean = await makeRoot();
    const tampered = await makeRoot();
    await writeEvaluatorFixture(clean);
    await writeEvaluatorFixture(tampered, (relativePath, content) =>
      relativePath === "benchmark/gates.ts" ? `${content}// drift\n` : content,
    );

    const before = new Map(
      (await observeEvaluatorFiles(clean)).map((file) => [
        file.path,
        file.digest,
      ]),
    );
    const changed = (await observeEvaluatorFiles(tampered))
      .filter((file) => before.get(file.path) !== file.digest)
      .map((file) => file.path);
    expect(changed).toEqual(["benchmark/gates.ts"]);
  });

  it("reports an unreadable file as a null digest instead of throwing", async () => {
    const root = await makeRoot();
    await writeEvaluatorFixture(root);
    await rm(join(root, "benchmark", "gates.ts"));
    // The aggregate must break on the same tree, and the pair of behaviours is the
    // contract: the aggregate is a claim about identity, while this table is the
    // attachment to a terminal ledger event and has to survive to name the deletion.
    await expect(computeEvaluatorDigest(root)).rejects.toMatchObject({
      code: "ENOENT",
    });

    const observed = await observeEvaluatorFiles(root);
    expect(observed.map((file) => file.path)).toEqual(
      [...EVALUATOR_FILES].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    const missing = observed.filter((file) => file.digest === null);
    expect(missing.map((file) => file.path)).toEqual(["benchmark/gates.ts"]);
    expect(missing[0].writable).toBe(false);
  });

  it("names a deleted file as changed against an earlier observation", async () => {
    const clean = await makeRoot();
    const emptied = await makeRoot();
    await writeEvaluatorFixture(clean);
    await writeEvaluatorFixture(emptied);
    await rm(join(emptied, "benchmark", "report.ts"));

    const before = new Map(
      (await observeEvaluatorFiles(clean)).map((file) => [
        file.path,
        file.digest,
      ]),
    );
    const changed = (await observeEvaluatorFiles(emptied))
      .filter((file) => before.get(file.path) !== file.digest)
      .map((file) => file.path);
    // A `null` never equals the digest the receipt recorded, so taking a file away
    // is reported by the same comparison that reports a byte added to one.
    expect(changed).toEqual(["benchmark/report.ts"]);
  });

  it("reports a plain temporary file as writable", async () => {
    const root = await makeRoot();
    await writeEvaluatorFixture(root);
    const observed = await observeEvaluatorFiles(root);
    // The read-only ATTRIBUTE is what an accidental editor save trips over, and
    // absence of it is all this field claims: on Windows `access(W_OK)` never sees
    // an ACL, so `writable: true` is not a claim that the file is unprotected.
    expect(observed.every((file) => file.writable)).toBe(true);
  });
});
