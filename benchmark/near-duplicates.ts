// Deterministic near-duplicate clustering for the benchmark split. Two records
// that are the "same" content dressed up differently (a paraphrase, a
// whitespace/case reflow, an appended sentence) must never straddle the
// development/calibration/test cut, or the split would leak. This module groups
// such records into stable clusters so benchmark/split.ts can treat each
// near-duplicate cluster as a single indivisible group.
//
// The pipeline is fully DETERMINISTIC: the same input always yields
// byte-identical clusters, and the result is invariant under input permutation.
// There is no wall clock and no randomness — MinHash uses a caller-supplied,
// recorded `seed`, and every hash is content-derived. The stages are:
//   1. normalize   — NFKC, pt-BR lowercase, Unicode letter/number tokens.
//   2. shingle     — contiguous windows of `shingleSize` tokens.
//   3. MinHash     — `permutations` FNV-1a-32 minima per record.
//   4. LSH banding — `bands` contiguous bands propose candidate pairs.
//   5. Jaccard     — each candidate is confirmed by exact set overlap; exact
//                    content-hash duplicates always union regardless of LSH.
//   6. union-find  — connected components become clusters keyed by the smallest
//                    content hash in the component, so the id is order-free.
//
// Standalone module: like the rest of benchmark/, it MUST NOT import from the
// extension bundle (src/). It depends only on plain record data and node:crypto.

import { createHash } from "node:crypto";

import type { BenchmarkRecord } from "./schema.ts";

// clusterNearDuplicates only needs the identity and raw text of a record; a full
// BenchmarkRecord is structurally assignable to this narrower input.
export type NearDuplicateInput = Pick<BenchmarkRecord, "id" | "text">;

// The v1 algorithm parameters are frozen literals: they are recorded verbatim in
// the result so a split artifact can prove which clustering produced it.
export interface NearDuplicateOptions {
  shingleSize: 5;
  permutations: 128;
  bands: 32;
  jaccardThreshold: 0.82;
  seed: number;
}

export interface NearDuplicateResult {
  algorithm: "minhash-lsh-jaccard-v1";
  options: NearDuplicateOptions;
  // record id -> stable cluster id ("near_" + first 16 hex of the component's
  // smallest content hash). Every input record has exactly one entry.
  clusterById: Map<string, string>;
  candidatePairCount: number;
  acceptedPairCount: number;
}

interface Prepared {
  id: string;
  contentHash: string;
  shingles: ReadonlySet<string>;
  signature: readonly number[] | undefined;
}

export function clusterNearDuplicates(
  records: readonly NearDuplicateInput[],
  options: NearDuplicateOptions,
): NearDuplicateResult {
  assertOptions(options);

  const prepared = records.map((record) => prepare(record, options));

  const disjoint = new DisjointSet();
  for (const item of prepared) disjoint.add(item.id);

  // Exact content duplicates always union, even when they are too short to
  // produce shingles or when LSH happens to miss them.
  const byContent = new Map<string, string[]>();
  for (const item of prepared) {
    const bucket = byContent.get(item.contentHash);
    if (bucket === undefined) {
      byContent.set(item.contentHash, [item.id]);
    } else {
      bucket.push(item.id);
    }
  }
  for (const ids of byContent.values()) {
    for (let i = 1; i < ids.length; i += 1) disjoint.union(ids[0], ids[i]);
  }

  const shinglesById = new Map<string, ReadonlySet<string>>();
  for (const item of prepared) shinglesById.set(item.id, item.shingles);

  const candidatePairs = collectCandidatePairs(prepared, options);
  let acceptedPairCount = 0;
  for (const [left, right] of candidatePairs.values()) {
    const a = shinglesById.get(left);
    const b = shinglesById.get(right);
    if (a === undefined || b === undefined) continue;
    if (jaccard(a, b) >= options.jaccardThreshold) {
      disjoint.union(left, right);
      acceptedPairCount += 1;
    }
  }

  // A component's cluster id is derived from the smallest content hash it
  // contains, which is independent of insertion order and of which member the
  // union-find picked as its internal root.
  const smallestHashByRoot = new Map<string, string>();
  for (const item of prepared) {
    const root = disjoint.find(item.id);
    const current = smallestHashByRoot.get(root);
    if (current === undefined || item.contentHash < current) {
      smallestHashByRoot.set(root, item.contentHash);
    }
  }

  const clusterById = new Map<string, string>();
  for (const item of prepared) {
    const root = disjoint.find(item.id);
    const smallest = smallestHashByRoot.get(root) as string;
    clusterById.set(item.id, `near_${smallest.slice(0, 16)}`);
  }

  return {
    algorithm: "minhash-lsh-jaccard-v1",
    options,
    clusterById,
    candidatePairCount: candidatePairs.size,
    acceptedPairCount,
  };
}

function prepare(
  record: NearDuplicateInput,
  options: NearDuplicateOptions,
): Prepared {
  const tokens = normalizeTokens(record.text);
  const contentHash = createHash("sha256")
    .update(tokens.join(" "), "utf8")
    .digest("hex");
  const shingles = shingleSet(tokens, options.shingleSize);
  const signature =
    shingles.size === 0 ? undefined : minHashSignature(shingles, options);
  return { id: record.id, contentHash, shingles, signature };
}

// NFKC canonicalization + pt-BR lowercase, then Unicode letter/number tokens.
// Splitting on non-alphanumerics inherently collapses runs of whitespace and
// drops punctuation, so surface formatting never affects the shingle set.
function normalizeTokens(text: string): string[] {
  const normalized = text.normalize("NFKC").toLocaleLowerCase("pt-BR");
  return normalized.match(/[\p{L}\p{N}]+/gu) ?? [];
}

function shingleSet(tokens: readonly string[], size: number): Set<string> {
  const shingles = new Set<string>();
  for (let i = 0; i + size <= tokens.length; i += 1) {
    shingles.add(tokens.slice(i, i + size).join(" "));
  }
  return shingles;
}

// For permutation i, the record's value is the minimum FNV-1a-32 bit hash of
// `${seed + i}\0${shingle}` over all shingles. Seeding by (seed + i) gives 128
// independent-yet-reproducible permutations.
function minHashSignature(
  shingles: ReadonlySet<string>,
  options: NearDuplicateOptions,
): number[] {
  const signature = new Array<number>(options.permutations).fill(0xffffffff);
  for (const shingle of shingles) {
    for (let i = 0; i < options.permutations; i += 1) {
      const hash = fnv1a32(`${options.seed + i}\0${shingle}`);
      if (hash < signature[i]) signature[i] = hash;
    }
  }
  return signature;
}

// LSH: split each signature into `bands` contiguous bands of equal width and
// bucket records by `bandIndex:hex:hex:hex:hex`. Records sharing any band bucket
// become a candidate pair, deduplicated by their ordered id key.
function collectCandidatePairs(
  prepared: readonly Prepared[],
  options: NearDuplicateOptions,
): Map<string, [string, string]> {
  const valuesPerBand = Math.floor(options.permutations / options.bands);
  const buckets = new Map<string, string[]>();

  for (const item of prepared) {
    const signature = item.signature;
    if (signature === undefined) continue;
    for (let band = 0; band < options.bands; band += 1) {
      const start = band * valuesPerBand;
      let key = `${band}`;
      for (let offset = 0; offset < valuesPerBand; offset += 1) {
        key += `:${signature[start + offset].toString(16)}`;
      }
      const bucket = buckets.get(key);
      if (bucket === undefined) {
        buckets.set(key, [item.id]);
      } else {
        bucket.push(item.id);
      }
    }
  }

  const pairs = new Map<string, [string, string]>();
  for (const ids of buckets.values()) {
    if (ids.length < 2) continue;
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const [left, right] =
          ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        const pairKey = `${left} ${right}`;
        if (!pairs.has(pairKey)) pairs.set(pairKey, [left, right]);
      }
    }
  }
  return pairs;
}

function jaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  const [small, large] = a.size <= b.size ? [a, b] : [b, a];
  let intersection = 0;
  for (const value of small) {
    if (large.has(value)) intersection += 1;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function assertOptions(options: NearDuplicateOptions): void {
  const { shingleSize, permutations, bands, jaccardThreshold, seed } = options;
  if (!Number.isInteger(shingleSize) || shingleSize < 1) {
    throw new Error("NEAR_DUPLICATE_OPTIONS_INVALID: shingleSize must be >= 1");
  }
  if (!Number.isInteger(permutations) || permutations < 1) {
    throw new Error(
      "NEAR_DUPLICATE_OPTIONS_INVALID: permutations must be >= 1",
    );
  }
  if (!Number.isInteger(bands) || bands < 1 || permutations % bands !== 0) {
    throw new Error(
      "NEAR_DUPLICATE_OPTIONS_INVALID: bands must divide permutations",
    );
  }
  if (!(jaccardThreshold > 0 && jaccardThreshold <= 1)) {
    throw new Error(
      "NEAR_DUPLICATE_OPTIONS_INVALID: jaccardThreshold must be within (0,1]",
    );
  }
  if (!Number.isFinite(seed)) {
    throw new Error("NEAR_DUPLICATE_OPTIONS_INVALID: seed must be finite");
  }
}

// Local union-find over opaque string ids. `union` always makes the
// lexicographically smaller root the parent, so the structure is deterministic;
// the emitted cluster ids do not depend on the internal root regardless.
class DisjointSet {
  private readonly parent = new Map<string, string>();

  add(id: string): void {
    if (!this.parent.has(id)) this.parent.set(id, id);
  }

  find(id: string): string {
    const parent = this.parent.get(id);
    if (parent === undefined) throw new Error(`unknown disjoint-set id ${id}`);
    if (parent === id) return id;
    const root = this.find(parent);
    this.parent.set(id, root);
    return root;
  }

  union(left: string, right: string): void {
    const a = this.find(left);
    const b = this.find(right);
    if (a !== b) {
      this.parent.set(
        a.localeCompare(b) <= 0 ? b : a,
        a.localeCompare(b) <= 0 ? a : b,
      );
    }
  }
}
