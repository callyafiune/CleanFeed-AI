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
# The FRACTION of a seen document's shingles that must reach the drop_seen index, and
# the reason it is a fraction rather than a count.
#
# The contract this function publishes is ABSOLUTE — for every id it does not return, no
# seen text reaches Jaccard >= 0.82 — and an absolute contract cannot be honoured by a
# probabilistic index. Two earlier attempts got this wrong in the same way. The 1/16
# remainder sample can be empty, so a document proposed nothing at all. A bottom-k floor
# (k=4, then k=12) made the miss unlikely instead of impossible: the cross-review built a
# blind document of 1 000 shingles with 12 edits, Jaccard 0.886792, and drop_seen kept it
# with zero candidates evaluated. `0.18^k` is a per-pair risk, not a guarantee, and it
# also leans on crc32 being independent of the edit, which nothing here establishes.
#
# THE DETERMINISTIC BOUND. Let A be a seen document's shingles and B a candidate's. If
# J(A, B) >= THRESHOLD then |A n B| >= THRESHOLD * |A u B| >= THRESHOLD * |A|, so the
# shingles of A that B does NOT have number at most (1 - THRESHOLD) * |A|. Index any
# subset S of A with |S| > (1 - THRESHOLD) * |A| and S cannot fit inside that gap: S and B
# must share a shingle, so the candidate is always proposed. With THRESHOLD = 0.82 that is
# more than 18% of each seen document, and the argument uses no assumption about the hash
# at all — the subset may be chosen any way, so it stays the smallest-crc32 one for the
# reason bottom-k was chosen originally.
#
# COST, as the UNION of the two sources and not one of them. The 1/16 remainder sample
# stays, so a long document contributes about 18% + 6.25% * (1 - 18%) = 23.125% of its
# shingles, which is roughly 3.7x the old index — not 3x, which is what this note said
# while the runbook said 3.7x. For the real 36 971 seen texts averaging a few hundred
# shingles that is order 10^6 postings. It is the price of the contract being true rather
# than probably true, and it is the honest way round: the alternative is publishing the
# absolute sentence while running a screen that can miss.
MINWISE_FRACTION = 1.0 - JACCARD_THRESHOLD
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


def indexed_keys(shingle_set: set[str]) -> set[int]:
    """The crc32 keys of `shingle_set` that reach the drop_seen index.

    Extracted from drop_seen so the GUARANTEE can be tested where it lives. The
    cross-review mutation-tested the previous shape and found that dropping the `+1`, or
    replacing the fraction with a fixed 12, left all 16 tests green — and it is not a
    fixture that was missing. No test built out of TEXT can distinguish those mutations,
    because a test cannot choose which shingles an edit destroys, and the mutations only
    differ on inputs where the selected subset coincides with the destroyed one. As a set
    operation the property is directly checkable; see `IndexedKeysPropertyTests`.

    Two sources, unioned:

      * the 1/16 remainder sample (all shingles for a short document), kept because it is
        what lets two documents that share ARBITRARY shingles find each other rather than
        only ones that agree on their minima;
      * the smallest `floor(MINWISE_FRACTION * n) + 1` keys, which is the part carrying
        the guarantee. Strictly MORE than the fraction, hence the `+1`: at exactly
        `MINWISE_FRACTION * n` the selected subset could coincide with the gap.
    """
    keyed = sorted((crc32(shingle.encode("utf-8")), shingle) for shingle in shingle_set)
    sample_all = len(shingle_set) < SAMPLE_MIN_SHINGLES
    indexed = {key for key, _ in keyed if sample_all or key % SAMPLE_MOD == 0}
    guaranteed = int(MINWISE_FRACTION * len(keyed)) + 1
    indexed.update(key for key, _ in keyed[:guaranteed])
    return indexed


def drop_seen(
    docs: list[tuple[str, str]], seen_texts: list[str]
) -> tuple[set[str], dict]:
    """ids in `docs` that are near-duplicates of anything in `seen_texts`.

    WHAT THIS PROVES, stated as the contract and not as the property (R7): for
    every id NOT returned, no text in `seen_texts` shares its exact tokenized
    content and none reaches Jaccard >= 0.82 over 5-token shingles. That is all.

    WHAT IT DOES NOT PROVE, and may never be described as: independence between
    the corpus and the training set. Two texts can discuss the same subject, cite
    the same source, or paraphrase one another and pass this bar comfortably.
    Semantic independence is not measured here, is not measured anywhere in this
    repository, and a report that calls this "independence" is over-claiming.

    WHY IT EXISTS ANYWAY: pruning WITHIN the corpus cannot see this class of
    overlap at all — a benchmark text can be unique among its peers while being a
    near-copy of a training document. The human pools re-extract the same upstream
    sources the training set came from, so a page revisited at a different revision
    reappears with small edits: measured against train+dev, three records landed at
    jaccard 0.931, 0.897 and 0.855, all above the refusal bar.

    Same shingle contract as prune(): 5-token shingles, exact Jaccard >= 0.82,
    candidates proposed by a shared-shingle inverted index over a 1/16 sample.

    BOTH HALVES WERE BROKEN FOR THE SAME REASON and are fixed separately, because no
    single mechanism covers both. See `MINWISE_FRACTION` for the near-duplicate half and
    the bound that makes the promise below absolute rather than probable.

    THE EXACT-CONTENT HALF IS ITS OWN INDEX, and that is a fix rather than a detail.
    Until 2026-07-31 this function had no content-hash index at all: it proposed
    candidates ONLY through sampled shingles, so a document whose shingles all missed
    the 1/16 sample proposed nothing and was kept — including a byte-identical copy of
    a training text. It is not hypothetical. Over the 36 971 real seen texts, 40 long
    documents have zero sampled shingles, and an exact copy of 27 of them would have
    produced zero candidate postings and passed. prune() never had this hole because it
    always unioned exact `content_hash` duplicates outright; the contract said "exact
    token content AND Jaccard" while neither half ran reliably here — the first not at
    all, the second only for documents the sample happened to reach.

    ONE DELIBERATE DIFFERENCE from prune(): the MAX_BUCKET cap is NOT applied here.
    In prune() that cap bounds a genuinely quadratic step — it forms every PAIR inside a
    bucket, so a bucket of n documents costs n^2/2 pairs. Here a bucket only contributes
    its members to a candidate SET, so the growth is linear rather than quadratic.

    It DOES cost something, and an earlier version of this note claimed otherwise. Each
    extra candidate is one `set.update` member plus, for a document that is finally
    KEPT, one full Jaccard intersection — the `break` only helps documents that are
    dropped, because a kept document is compared against every candidate before the loop
    ends. So the trade is recall for time on the clean majority, not a free lunch.

    Measured on the real index (36 971 seen texts): 47 buckets exceed MAX_BUCKET, the
    largest holds 209, and those buckets carry 4 138 postings in total. That is the
    bound on the extra work per candidate document that shares one of those shingles —
    material but not an explosion. The load over the full candidate pool has NOT been
    measured, and if assembly time regresses noticeably this is the first place to look.

    What the cap cost was recall, in silence: a document whose only bridge to the
    training set ran through a shingle common to more than MAX_BUCKET training texts was
    never compared against it, and no statistic said so. Since the index is built over
    train+dev, frequent pt-BR shingles hit that cap far more often than anything in
    prune() does. `buckets_over_prune_cap` reports how many buckets the old cap would
    have dropped, so the change stays measurable.
    """
    index: dict[int, list[int]] = {}
    seen_shingles: list[set[str]] = []
    # Exact tokenized content, indexed independently of the shingle sample. This is the
    # half of the contract the sampled index cannot carry: sampling decides which
    # shingles PROPOSE a candidate, and a document that proposes none is never compared,
    # however identical it is.
    seen_content: set[str] = set()
    for text in seen_texts:
        tokens = tokens_of(text)
        seen_content.add(content_hash(tokens))
        shingle_set = shingles_of(tokens)
        position = len(seen_shingles)
        seen_shingles.append(shingle_set)
        for key in indexed_keys(shingle_set):
            index.setdefault(key, []).append(position)

    drop: set[str] = set()
    # The highest similarity among the records KEPT. Named for what it holds: a
    # previous name ("worst") read as a worst case, and the dropped records are
    # deliberately excluded — including them would report a number above the bar
    # and make a clean pool look contaminated.
    highest_kept = 0.0
    candidates_evaluated = 0
    buckets_over_prune_cap = 0
    exact_hits = 0
    for doc_id, text in docs:
        tokens = tokens_of(text)
        # Exact content first, and unconditionally: it needs no candidate proposal, so
        # it is the one check that cannot be silenced by sampling or by a bucket cap.
        if content_hash(tokens) in seen_content:
            drop.add(doc_id)
            exact_hits += 1
            continue
        shingle_set = shingles_of(tokens)
        candidates: set[int] = set()
        for shingle in shingle_set:
            bucket = index.get(crc32(shingle.encode("utf-8")))
            if bucket is None:
                continue
            if len(bucket) > MAX_BUCKET:
                buckets_over_prune_cap += 1
            candidates.update(bucket)
        best = 0.0
        for position in candidates:
            candidates_evaluated += 1
            best = max(best, jaccard(shingle_set, seen_shingles[position]))
            if best >= JACCARD_THRESHOLD:
                break
        if best >= JACCARD_THRESHOLD:
            drop.add(doc_id)
        else:
            highest_kept = max(highest_kept, best)
    return drop, {
        "seen_texts": len(seen_texts),
        "checked": len(docs),
        "dropped": len(drop),
        "dropped_exact_content": exact_hits,
        "highest_similarity_kept": round(highest_kept, 3),
        "candidates_evaluated": candidates_evaluated,
        "buckets_over_prune_cap": buckets_over_prune_cap,
        # The contract this number is evidence FOR, carried next to it so a reader
        # of the printed stats cannot mistake it for an independence claim.
        "contract": "exact-token-content-and-jaccard-0.82-over-5-token-shingles",
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
