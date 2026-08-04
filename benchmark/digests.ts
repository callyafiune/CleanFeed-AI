// SHA-256 digests over benchmark evidence. Every structured value is serialized
// through the Phase 1 shared canonical-json contract (contracts/canonical-json.ts)
// BEFORE it is hashed, so a digest computed here is byte-identical to one computed
// by the runtime. This module NEVER redefines canonicalization: it only adds the
// Node-side byte hasher and the domain-specific digest recipes (dataset identity
// and evaluator-code identity).
//
// Standalone benchmark module: MUST NOT import from the extension bundle (src/).
// Node-only (node:crypto, node:fs): it runs in the benchmark/build tooling, never
// in the browser. There is no Date and no randomness anywhere in this module — a
// sealed digest is a pure function of the bytes it is fed, and seeds live in the
// split policy rather than here.

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { canonicalJson } from "../contracts/canonical-json.ts";
import type { DatasetManifest } from "./dataset-manifest.ts";
import type { BenchmarkRecord } from "./schema.ts";

/**
 * SHA-256 (lowercase hex) of raw bytes. This is the ONLY place node:crypto hashes
 * concatenated/streamed bytes directly; every structured value passes through the
 * shared `canonicalJson` first, so the bytes fed here are always canonical.
 */
export function sha256BytesHex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Digest of the whole dataset: the canonical manifest followed by every record in
 * ascending id order, one canonical-JSON line each, with a trailing newline.
 * Sorting by id makes the digest permutation-invariant — the physical order of the
 * record file cannot change it — while any changed scientific byte does: a record
 * field, or a manifest hash that `sealDataset` already tied to the real file bytes
 * (so a merely declared hash cannot pass unchecked).
 */
export async function computeDatasetDigest(
  manifest: DatasetManifest,
  records: readonly BenchmarkRecord[],
): Promise<string> {
  const sortedRecords = [...records].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const payload = `${canonicalJson(manifest)}\n${sortedRecords
    .map((record) => canonicalJson(record))
    .join("\n")}\n`;
  return sha256BytesHex(new TextEncoder().encode(payload));
}

// The closed set of files that constitute the evaluator's identity: the shared
// contracts, the runtime-parity inventory and every benchmark module that shapes a
// score or a gate, plus the exact dependency lockfile. A benchmark report is bound
// to the digest of THESE bytes, so a later code change can never masquerade as the
// same evaluator.
export const EVALUATOR_FILES = [
  "contracts/canonical-json.ts",
  "contracts/content-composition.ts",
  // The shared Unicode normalization every inference path applies before
  // tokenization. It decides which bytes the model ever sees — a changed
  // homoglyph entry, a changed NFKC exception or a changed removal set moves
  // every score — so it belongs to the evaluator's identity exactly as much as
  // the composition it is versioned by.
  "contracts/text-normalization.ts",
  // The failure-detail allowlist decides which causes a prediction row may name
  // and is the parser's validator for that field, so it shapes a scored row.
  "contracts/failure-detail.ts",
  "contracts/calibration-profile.ts",
  "contracts/model-release.ts",
  "contracts/source-readiness.ts",
  "contracts/runtime-parity.ts",
  "scripts/runtime-parity.mjs",
  "benchmark/schema.ts",
  // The canonical generator-family contract: one normalization, one nominal type
  // and the exact-equality invariant over the reserved families. It decides which
  // records the `generatorExposure` slice calls unseen and which the splitter
  // forces into the blocked test, so a changed byte here changes what the
  // evaluator measures.
  "benchmark/generator-family.ts",
  // The frozen pre-registration of the v1 release and its validator. Every budget,
  // floor, seed and threshold a gate reads comes from these two files, so a changed
  // byte in either changes the evaluator's identity.
  "benchmark/preregistration-v4.json",
  "benchmark/preregistration-v4.ts",
  // The one provisional threshold the v1 freezes. It decides which documents are
  // called positive at all, so its bytes belong to the evaluator's identity exactly
  // as much as the policy that pins the quantile.
  "benchmark/provisional-threshold.ts",
  "benchmark/dataset-manifest.ts",
  "benchmark/prediction-schema.ts",
  "benchmark/near-duplicates.ts",
  "benchmark/split.ts",
  "benchmark/split-audit.ts",
  // The cluster-exposure ledger and its CLI validation. They decide which
  // record-lines and which sampling units are still eligible for a blind test
  // block, so a post-freeze edit could hand back eligibility that was already
  // spent — which changes what the evaluator is allowed to measure at all.
  "benchmark/cluster-exposure-ledger.ts",
  "benchmark/commands/cluster-ledger.ts",
  // The frozen human-source inventory. `commands/split.ts` reads its
  // `declaredGroupAxes` and the audit FAILS on a declared axis left unknown, so a
  // changed declaration changes a gate verdict.
  "benchmark/source-manifest.ts",
  "benchmark/digests.ts",
  "benchmark/split-artifact.ts",
  "benchmark/intervals.ts",
  "benchmark/bootstrap.ts",
  "benchmark/calibrators.ts",
  "benchmark/cross-validation.ts",
  "benchmark/calibration-pipeline.ts",
  "benchmark/metrics.ts",
  "benchmark/slices.ts",
  "benchmark/gates.ts",
  "benchmark/report.ts",
  "benchmark/profile-artifact.ts",
  // Task-13 orchestration layer: the CLI, the holdout ledger and every
  // subcommand build the IntegrityEvidence and apply the calibration that
  // produce the gate decision, so they are part of the evaluator's identity.
  "benchmark/cli.ts",
  "benchmark/commands/evaluate.ts",
  "benchmark/commands/fit.ts",
  "benchmark/commands/io.ts",
  "benchmark/commands/publish-profile.ts",
  "benchmark/commands/split.ts",
  "benchmark/commands/validate-predictions.ts",
  "benchmark/commands/validate.ts",
  "benchmark/commands/verify-evidence.ts",
  "benchmark/holdout-ledger.ts",
  // Phase 3 scoring and holdout orchestration: the browser scorer maps every
  // page response to a prediction row, the shard store persists those rows, the
  // score/consume-holdout commands drive them, and the corpus-source audit and
  // candidate preflight are the source-readiness / freeze gates the report keys
  // on. A post-freeze edit to any of these reshapes a scored prediction or a gate
  // verdict, so each must live inside the evaluator's identity.
  "benchmark/browser-scorer.ts",
  "benchmark/candidate-preflight.ts",
  "benchmark/commands/consume-holdout.ts",
  "benchmark/commands/score.ts",
  "benchmark/corpus-source-audit.ts",
  "benchmark/prediction-shards.ts",
  "package-lock.json",
] as const;

/**
 * Digest of the evaluator's own code. For every file in EVALUATOR_FILES, taken in
 * lexicographic path order, hash the relative path, a NUL separator, then the
 * file's raw bytes. The NUL delimiter keeps a path change and a content change
 * distinct, and the fixed lexicographic order makes the digest independent of any
 * declaration order. Reads the real bytes on disk — a declared-but-absent file is
 * a hard failure, never trusted.
 */
export async function computeEvaluatorDigest(root: string): Promise<string> {
  const ordered = [...EVALUATOR_FILES].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  for (const relativePath of ordered) {
    const bytes = await readFile(resolve(root, relativePath));
    chunks.push(encoder.encode(relativePath));
    chunks.push(Uint8Array.of(0));
    chunks.push(
      new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    );
  }
  return sha256BytesHex(concatBytes(chunks));
}

/** One evaluator file as found on disk: its own bytes and whether it is writable. */
export interface EvaluatorFileObservation {
  path: string;
  /** `null` when the bytes could not be read at all: absent, renamed or denied. */
  digest: string | null;
  writable: boolean;
}

/**
 * Per-file view of the same closed inventory `computeEvaluatorDigest` aggregates,
 * in the same lexicographic order. Purely additive: it never feeds the aggregate,
 * so the sealed recipe stays a pure function of path + NUL + bytes and a digest
 * written by an earlier `fit` keeps comparing equal. It exists so a mismatch can
 * name WHICH file moved instead of only that something did.
 *
 * Unlike `computeEvaluatorDigest` this NEVER throws on a file it cannot read, and
 * that difference is the point of the two functions. The aggregate is a claim about
 * identity and a file it cannot read must break it; this table is written as the
 * ATTACHMENT to a terminal ledger event, and an attachment that throws would
 * suppress the record of the very deletion it exists to describe.
 */
export async function observeEvaluatorFiles(
  root: string,
): Promise<EvaluatorFileObservation[]> {
  const ordered = [...EVALUATOR_FILES].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const observations: EvaluatorFileObservation[] = [];
  for (const relativePath of ordered) {
    const absolute = resolve(root, relativePath);
    const bytes = await readFile(absolute).catch(() => null);
    observations.push({
      path: relativePath,
      digest:
        bytes === null
          ? null
          : sha256BytesHex(
              new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
            ),
      writable: await isWritable(absolute),
    });
  }
  return observations;
}

// On Windows `access(W_OK)` reports the FILE_ATTRIBUTE_READONLY attribute and NOT
// the ACL, so a deny-write ACL reads back as writable. `writable: false` therefore
// proves a file is protected; `writable: true` does not prove it is unprotected.
async function isWritable(absolutePath: string): Promise<boolean> {
  try {
    await access(absolutePath, fsConstants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function concatBytes(chunks: readonly Uint8Array[]): Uint8Array {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}
