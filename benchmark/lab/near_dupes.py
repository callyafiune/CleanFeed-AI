"""Near-duplicate pruning for corpus assembly, mirroring the sealed pipeline's
`benchmark/near-duplicates.ts` (algorithm minhash-lsh-jaccard-v1).

WHY: ingest clusters near-duplicates and REJECTS every member of any cluster
that straddles more than one declared lineage. assemble_corpus gives each
record a UNIQUE groups.derivationRoot (so the blocked split sees singletons),
which means any near-duplicate cluster of size >= 2 is cross-lineage by
construction and the whole cluster is refused. So the pool must contain at most
one representative of each cluster BEFORE selection.

FIDELITY: normalization (NFKC + pt-BR-ish lowercase, [\\p{L}\\p{N}]+ tokens),
5-token shingles and the Jaccard >= 0.82 confirmation are ported exactly, and
exact token-content duplicates always union. Candidate generation differs on
purpose: the TS side uses MinHash+LSH (128 perms / 32 bands) purely as a cheap
candidate proposer, which is far too slow to reproduce in pure Python. Here
candidates come from a shared-shingle inverted index over a deterministic 1/16
hash sample of each document's shingles (all shingles kept for short documents,
where a sample could miss the only overlap). Sharing one shingle is a much
weaker bar than sharing a whole LSH band, so this proposes a SUPERSET of LSH's
candidates; the exact Jaccard gate then decides. Erring toward proposing more
can only drop extra records, never leave a cluster the sealed ingest refuses.
"""

from __future__ import annotations

import hashlib
import re
import unicodedata
from zlib import crc32

SHINGLE_SIZE = 5
JACCARD_THRESHOLD = 0.82
# Keep 1 shingle in SAMPLE_MOD for the candidate index; documents with fewer
# than SAMPLE_MIN_SHINGLES shingles are indexed in full.
SAMPLE_MOD = 16
SAMPLE_MIN_SHINGLES = 64
# A shingle shared by more documents than this is boilerplate, not evidence of
# duplication; pairing them all would be quadratic. Reported by prune().
MAX_BUCKET = 40

TOKEN_RE = re.compile(r"[^\W_]+", re.UNICODE)


def tokens_of(text: str) -> list[str]:
    """NFKC + lowercase, then Unicode letter/number runs (mirrors normalizeTokens)."""
    return TOKEN_RE.findall(unicodedata.normalize("NFKC", text).lower())


def shingles_of(tokens: list[str]) -> set[str]:
    return {
        " ".join(tokens[i : i + SHINGLE_SIZE])
        for i in range(len(tokens) - SHINGLE_SIZE + 1)
    }


def content_hash(tokens: list[str]) -> str:
    return hashlib.sha256(" ".join(tokens).encode("utf-8")).hexdigest()


def jaccard(a: set[str], b: set[str]) -> float:
    if not a and not b:
        return 0.0
    inter = len(a & b)
    union = len(a) + len(b) - inter
    return inter / union if union else 0.0


class _DisjointSet:
    def __init__(self) -> None:
        self.parent: dict[int, int] = {}

    def add(self, item: int) -> None:
        self.parent.setdefault(item, item)

    def find(self, item: int) -> int:
        root = item
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[item] != root:  # path compression
            self.parent[item], item = root, self.parent[item]
        return root

    def union(self, left: int, right: int) -> None:
        a, b = self.find(left), self.find(right)
        if a != b:
            self.parent[max(a, b)] = min(a, b)


def drop_seen(
    docs: list[tuple[str, str]], seen_texts: list[str]
) -> tuple[set[str], dict]:
    """ids in `docs` that are near-duplicates of anything in `seen_texts`.

    WHY: the sealed corpus must be independent of what the detector was trained
    on, and pruning within the corpus cannot show that — a benchmark text can be
    unique among its peers while being a near-copy of a training document. The
    human pools are re-extractions of the same upstream sources used for
    training, so a page revisited at a different revision reappears with small
    edits: measured against train+dev, three records landed at jaccard 0.931,
    0.897 and 0.855, all above the 0.82 refusal bar.

    Same contract as prune(): 5-token shingles, exact Jaccard >= 0.82, candidates
    proposed by a shared-shingle inverted index over a 1/16 sample.
    """
    index: dict[int, list[int]] = {}
    seen_shingles: list[set[str]] = []
    for text in seen_texts:
        shingle_set = shingles_of(tokens_of(text))
        position = len(seen_shingles)
        seen_shingles.append(shingle_set)
        sample_all = len(shingle_set) < SAMPLE_MIN_SHINGLES
        for shingle in shingle_set:
            key = crc32(shingle.encode("utf-8"))
            if sample_all or key % SAMPLE_MOD == 0:
                index.setdefault(key, []).append(position)

    drop: set[str] = set()
    worst = 0.0
    for doc_id, text in docs:
        shingle_set = shingles_of(tokens_of(text))
        candidates: set[int] = set()
        for shingle in shingle_set:
            bucket = index.get(crc32(shingle.encode("utf-8")))
            if bucket is not None and len(bucket) <= MAX_BUCKET:
                candidates.update(bucket)
        best = 0.0
        for position in candidates:
            best = max(best, jaccard(shingle_set, seen_shingles[position]))
            if best >= JACCARD_THRESHOLD:
                break
        worst = max(worst, best if best < JACCARD_THRESHOLD else worst)
        if best >= JACCARD_THRESHOLD:
            drop.add(doc_id)
    return drop, {
        "seen_texts": len(seen_texts),
        "checked": len(docs),
        "dropped": len(drop),
        "highest_similarity_kept": round(worst, 3),
    }


def prune(docs: list[tuple[str, str, int]]) -> tuple[set[str], dict]:
    """docs: (id, text, priority) — LOWER priority wins when a cluster spans
    several documents (ties broken by input order, so the result is order-stable
    for a fixed input).

    Returns (ids_to_drop, stats).
    """
    shingles: list[set[str]] = []
    hashes: list[str] = []
    for _, text, _prio in docs:
        toks = tokens_of(text)
        shingles.append(shingles_of(toks))
        hashes.append(content_hash(toks))

    disjoint = _DisjointSet()
    for index in range(len(docs)):
        disjoint.add(index)

    # Exact token-content duplicates always union, matching the TS pipeline.
    by_content: dict[str, int] = {}
    for index, digest in enumerate(hashes):
        first = by_content.setdefault(digest, index)
        if first != index:
            disjoint.union(first, index)

    # Inverted index over sampled shingles -> candidate pairs.
    index_map: dict[int, list[int]] = {}
    for doc_index, shingle_set in enumerate(shingles):
        sample_all = len(shingle_set) < SAMPLE_MIN_SHINGLES
        for shingle in shingle_set:
            key = crc32(shingle.encode("utf-8"))
            if sample_all or key % SAMPLE_MOD == 0:
                index_map.setdefault(key, []).append(doc_index)

    candidates: set[tuple[int, int]] = set()
    oversized = 0
    for bucket in index_map.values():
        if len(bucket) < 2:
            continue
        if len(bucket) > MAX_BUCKET:
            oversized += 1
            continue
        for i in range(len(bucket)):
            for j in range(i + 1, len(bucket)):
                left, right = bucket[i], bucket[j]
                if left != right:
                    candidates.add((min(left, right), max(left, right)))

    accepted = 0
    for left, right in candidates:
        if disjoint.find(left) == disjoint.find(right):
            continue
        if jaccard(shingles[left], shingles[right]) >= JACCARD_THRESHOLD:
            disjoint.union(left, right)
            accepted += 1

    # Keep one representative per cluster: lowest priority, then input order.
    best: dict[int, int] = {}
    for doc_index in range(len(docs)):
        root = disjoint.find(doc_index)
        held = best.get(root)
        if held is None or docs[doc_index][2] < docs[held][2]:
            best[root] = doc_index

    keep = set(best.values())
    drop = {docs[i][0] for i in range(len(docs)) if i not in keep}
    stats = {
        "docs": len(docs),
        "candidate_pairs": len(candidates),
        "accepted_pairs": accepted,
        "clusters_collapsed": len(docs) - len(keep),
        "oversized_buckets_skipped": oversized,
    }
    return drop, stats
