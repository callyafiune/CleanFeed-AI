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
exact token-content duplicates always union. ONE difference, stated here and
carried in the contract: `drop_seen` compares shingles as fixed-width keys
(`shingle_key`), because the same screen has to run off an artifact that holds
no text, so identity of keys stands in for identity of shingles as far as the
key width makes it and no further.

Candidate generation differs on
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

import argparse
import base64
import hashlib
import json
import re
import struct
import sys
import unicodedata
from collections.abc import Iterable, Sequence
from collections.abc import Set as AbstractSet
from pathlib import Path
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
# at all — the subset may be chosen any way, so it stays the smallest-key one for the
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


def jaccard(a: AbstractSet[object], b: AbstractSet[object]) -> float:
    """|a n b| / |a u b|. Called over shingle STRINGS by prune() and over shingle KEYS by
    drop_seen_against, which is why the element type is open: the two callers compare
    different domains and a `set[str]` annotation was false in one of them."""
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


SHINGLE_KEY_BYTES = 8


def shingle_key(shingle: str) -> int:
    """One 5-token shingle -> the fixed-width key the seen screen compares it as.

    THE WIDTH IS THE CONTRACT. Two distinct shingles that share a key are the same
    element to `drop_seen_against`, and a collision INSIDE the shingles two documents
    share drops one element from the intersection AND one from the union, which LOWERS
    the measured Jaccard: 82/100 = 0.82 becomes 81/99 = 0.8181, under a bar of 0.82. So a
    collision does not only "add to an intersection" — it errs in BOTH directions, and
    the direction that matters keeps a near-duplicate the bar names.

    Under crc32 that was not hypothetical: the pair 'aa7275 bb7275 cc7275 dd7275 ee7275'
    and 'aa47144 bb47144 cc47144 dd47144 ee47144' collides (232429220), a search of
    seconds finds it, and a document pair built around it measures 0.82 over shingle
    strings and was KEPT. At 8 bytes of blake2b the expected number of colliding pairs
    over the real artifact's 3,3 M keys is n^2 / 2^65 ~ 3e-7. That residue is DECLARED
    and not claimed away: the screen compares keys, so a sentence about shingles is only
    as absolute as this width makes it, and the number is what says how absolute.
    """
    return int.from_bytes(
        hashlib.blake2b(
            shingle.encode("utf-8"), digest_size=SHINGLE_KEY_BYTES
        ).digest(),
        "little",
    )


def shingle_keys_of(shingle_set: set[str]) -> list[int]:
    """A document's shingles as SORTED keys, one key per shingle.

    Duplicates are kept rather than collapsed: two distinct shingles can share a key, and
    `indexed_keys_from` sizes the guaranteed subset from the number of SHINGLES, so
    de-duplicating the keys here would shrink that subset below the bound it rests on.
    """
    return sorted(shingle_key(shingle) for shingle in shingle_set)


def indexed_keys_from(keys: Sequence[int]) -> set[int]:
    """`indexed_keys` over the keys themselves; `keys` MUST be sorted ascending.

    The selection reads `keys[:guaranteed]`, so an unsorted sequence silently indexes an
    arbitrary subset and the bound in `MINWISE_FRACTION` no longer holds.
    """
    sample_all = len(keys) < SAMPLE_MIN_SHINGLES
    indexed = {key for key in keys if sample_all or key % SAMPLE_MOD == 0}
    guaranteed = int(MINWISE_FRACTION * len(keys)) + 1
    indexed.update(keys[:guaranteed])
    return indexed


def indexed_keys(shingle_set: set[str]) -> set[int]:
    """The keys of `shingle_set` that reach the drop_seen index.

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
    return indexed_keys_from(shingle_keys_of(shingle_set))


# --- the seen set as an artifact, so no assembly opens the material --------------
#
# The seen set is the DEAD CORPUS, and part of it sat in a blind partition. Both halves
# of the contract need only derived values — one digest of the whole tokenized text and
# the keys of its 5-token shingles — so the screen can be carried by an artifact
# that holds no token of the material. Nothing here may be widened to store text: a
# reader of the artifact would then be reading the blind partition.
#
# The artifact is not a publishable object either. A 64-bit digest of a 5-token
# shingle is not text and is not invertible on its own, but a dictionary of pt-BR
# 5-grams could test candidates against it, so the artifact lives where the material it
# derives from lives (`benchmark/data/`, never Git, never an evidence bundle) and is
# strictly less exposing than that material, not unconditionally opaque.
SEEN_INDEX_ARTIFACT = "seen-corpus-index"
# Version 2 widened the shingle key from crc32 to 8 bytes of blake2b. It is a new
# generation of the artifact and not an edit of the old one: a v1 file answers the same
# question over a key width whose collisions are constructible by search, so it must
# never be read as this one. Three things say so independently — this field, the
# `shingleEncoding` field and the file name.
SEEN_INDEX_VERSION = 2
SEEN_INDEX_CONTRACT = "exact-token-content-and-jaccard-0.82-over-5-token-shingle-keys"
# The shingle key on the wire. Not a detail of storage: a reader that unpacked another
# width would compute Jaccard over garbage and keep every duplicate.
SEEN_SHINGLE_ENCODING = "blake2b64-uint64le-base64"
SEEN_INDEX_FIELDS: tuple[str, ...] = ("content", "shingles")
# The provenance of what was hashed, and a CLOSED vocabulary for the same reason the
# document line has one: a free-form provenance dict is a place a caller can park a
# sample of the material, and the artifact would then carry the text it exists to avoid.
SEEN_SOURCE_FIELDS: tuple[str, ...] = ("lines", "path", "sha256")


class SeenIndexUnreadable(RuntimeError):
    """The artifact does not declare the contract this module screens under.

    Fail-closed rather than best-effort: an index written under another shingle size,
    another threshold or another key width answers a different question, and reading it
    as if it answered this one reports a clean pool for a screen that never ran.
    """


class SeenIndex:
    """The seen set, as one content digest plus one shingle-key list per document."""

    __slots__ = ("digests", "content_hashes", "documents", "shingles", "postings")

    def __init__(self, digests: Iterable[str], documents: Iterable[Sequence[int]]):
        self.digests: list[str] = [str(digest) for digest in digests]
        self.content_hashes: set[str] = set(self.digests)
        self.documents: list[tuple[int, ...]] = [tuple(keys) for keys in documents]
        if len(self.digests) != len(self.documents):
            raise SeenIndexUnreadable(
                f"the index carries {len(self.digests)} content digests and "
                f"{len(self.documents)} shingle lists: the two halves of the contract "
                "would then be screening different document sets"
            )
        self.shingles: list[frozenset[int]] = [
            frozenset(keys) for keys in self.documents
        ]
        self.postings: dict[int, list[int]] = {}
        for position, keys in enumerate(self.documents):
            for key in indexed_keys_from(keys):
                self.postings.setdefault(key, []).append(position)

    def __len__(self) -> int:
        return len(self.documents)

    def shingle_keys(self) -> int:
        return sum(len(keys) for keys in self.documents)


def build_seen_index(texts: Iterable[str]) -> SeenIndex:
    """The index of a seen set, from the texts, keeping no text."""
    digests: list[str] = []
    documents: list[list[int]] = []
    for text in texts:
        tokens = tokens_of(text)
        digests.append(content_hash(tokens))
        documents.append(shingle_keys_of(shingles_of(tokens)))
    return SeenIndex(digests, documents)


def _pack_keys(keys: Sequence[int]) -> str:
    return base64.b64encode(struct.pack(f"<{len(keys)}Q", *keys)).decode("ascii")


def _unpack_keys(blob: str) -> list[int]:
    raw = base64.b64decode(blob, validate=True)
    if len(raw) % SHINGLE_KEY_BYTES:
        raise SeenIndexUnreadable(
            f"a document's shingle blob is {len(raw)} bytes, which is not a whole "
            f"number of {SHINGLE_KEY_BYTES}-byte keys ({SEEN_SHINGLE_ENCODING})"
        )
    return list(struct.unpack(f"<{len(raw) // SHINGLE_KEY_BYTES}Q", raw))


def seen_index_header(index: SeenIndex, source: dict) -> dict:
    if set(source) != set(SEEN_SOURCE_FIELDS):
        raise SeenIndexUnreadable(
            f"the provenance carries {sorted(source)} and the artifact declares "
            f"{list(SEEN_SOURCE_FIELDS)}: a field outside that list could carry text"
        )
    return {
        "artifact": SEEN_INDEX_ARTIFACT,
        "version": SEEN_INDEX_VERSION,
        "contract": SEEN_INDEX_CONTRACT,
        "shingleSize": SHINGLE_SIZE,
        "jaccardThreshold": JACCARD_THRESHOLD,
        "shingleEncoding": SEEN_SHINGLE_ENCODING,
        "documents": len(index),
        "shingleKeys": index.shingle_keys(),
        "source": dict(source),
    }


def write_seen_index(index: SeenIndex, path: Path, source: dict) -> dict:
    """Write the artifact; returns the header it wrote.

    One document per line so a 10.000-document index streams instead of being held as
    one JSON value, and the content digests ride on the documents rather than in the
    header: a header list of 10.000 digests would have to be read whole before the first
    document could be checked.
    """
    header = seen_index_header(index, source)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        handle.write(json.dumps(header, ensure_ascii=False, sort_keys=True) + "\n")
        for digest, keys in zip(index.digests, index.documents):
            handle.write(
                json.dumps(
                    {"content": digest, "shingles": _pack_keys(keys)},
                    ensure_ascii=False,
                    sort_keys=True,
                )
                + "\n"
            )
    return header


def read_seen_index(path: Path) -> tuple[SeenIndex, dict]:
    """(index, header) from the artifact, refusing anything written under another contract.

    Read as a stream — header line, then one document per line — which is the reason
    `write_seen_index` chose the format. The whole file was held in memory before, so the
    format admitted streaming while the reader did not do it.
    """
    header: dict | None = None
    digests: list[str] = []
    documents: list[list[int]] = []
    expected = {
        "artifact": SEEN_INDEX_ARTIFACT,
        "version": SEEN_INDEX_VERSION,
        "contract": SEEN_INDEX_CONTRACT,
        "shingleSize": SHINGLE_SIZE,
        "jaccardThreshold": JACCARD_THRESHOLD,
        "shingleEncoding": SEEN_SHINGLE_ENCODING,
    }
    with path.open(encoding="utf-8") as handle:
        for number, line in enumerate(handle, start=1):
            if not line.strip():
                continue
            row = json.loads(line)
            if header is None:
                header = row
                for field, value in expected.items():
                    if header.get(field) != value:
                        raise SeenIndexUnreadable(
                            f"{path} declares {field}={header.get(field)!r} and this "
                            f"module screens under {field}={value!r}: the artifact "
                            "answers a different question"
                        )
                continue
            if set(row) != set(SEEN_INDEX_FIELDS):
                raise SeenIndexUnreadable(
                    f"{path} line {number} carries the fields {sorted(row)} and the "
                    f"artifact declares {list(SEEN_INDEX_FIELDS)}: an extra field is a "
                    "field that could carry text"
                )
            keys = _unpack_keys(str(row["shingles"]))
            # ASCENDING is an invariant of the format and not a courtesy of the writer:
            # `indexed_keys_from` reads `keys[:guaranteed]`, so an unsorted line indexes
            # an arbitrary subset and the bound in `MINWISE_FRACTION` stops holding —
            # silently, because every other check still passes.
            if any(keys[i] > keys[i + 1] for i in range(len(keys) - 1)):
                raise SeenIndexUnreadable(
                    f"{path} line {number} carries shingle keys out of ascending order "
                    f"({SEEN_SHINGLE_ENCODING} is written sorted). The guaranteed subset "
                    "is the leading slice of that order, so an unsorted line indexes an "
                    "arbitrary subset and the reach bound no longer holds"
                )
            digests.append(str(row["content"]))
            documents.append(keys)
    if header is None:
        raise SeenIndexUnreadable(f"{path} is empty: it declares no contract at all")
    if len(documents) != header.get("documents"):
        raise SeenIndexUnreadable(
            f"{path} declares {header.get('documents')!r} documents and carries "
            f"{len(documents)}: a truncated index screens less than it says it does"
        )
    return SeenIndex(digests, documents), header


def drop_seen_against(
    docs: list[tuple[str, str]], index: SeenIndex
) -> tuple[set[str], dict]:
    """ids in `docs` that are near-duplicates of anything the index covers.

    The contract, the statistics and the refusals are `drop_seen`'s; the difference is
    only that the seen side arrives as hashes and shingle keys instead of as text.
    """
    drop: set[str] = set()
    highest_kept = 0.0
    candidates_evaluated = 0
    buckets_over_prune_cap = 0
    exact_hits = 0
    for doc_id, text in docs:
        tokens = tokens_of(text)
        if content_hash(tokens) in index.content_hashes:
            drop.add(doc_id)
            exact_hits += 1
            continue
        shingle_set = frozenset(shingle_keys_of(shingles_of(tokens)))
        candidates: set[int] = set()
        for key in shingle_set:
            bucket = index.postings.get(key)
            if bucket is None:
                continue
            if len(bucket) > MAX_BUCKET:
                buckets_over_prune_cap += 1
            candidates.update(bucket)
        best = 0.0
        for position in candidates:
            candidates_evaluated += 1
            best = max(best, jaccard(shingle_set, index.shingles[position]))
            if best >= JACCARD_THRESHOLD:
                break
        if best >= JACCARD_THRESHOLD:
            drop.add(doc_id)
        else:
            highest_kept = max(highest_kept, best)
    return drop, {
        "seen_texts": len(index),
        "checked": len(docs),
        "dropped": len(drop),
        "dropped_exact_content": exact_hits,
        "highest_similarity_kept": round(highest_kept, 3),
        "candidates_evaluated": candidates_evaluated,
        "buckets_over_prune_cap": buckets_over_prune_cap,
        # The contract this number is evidence FOR, carried next to it so a reader
        # of the printed stats cannot mistake it for an independence claim.
        "contract": SEEN_INDEX_CONTRACT,
    }


def drop_seen(
    docs: list[tuple[str, str]], seen_texts: list[str]
) -> tuple[set[str], dict]:
    """ids in `docs` that are near-duplicates of anything in `seen_texts`.

    WHAT THIS PROVES, stated as the contract and not as the property (R7): for
    every id NOT returned, no text in `seen_texts` shares its exact tokenized
    content and none reaches Jaccard >= 0.82 over 5-token shingles, COMPARED AS
    `shingle_key` keys. That is all, and the qualifier is load-bearing: two
    distinct shingles sharing a key are one element here, so the sentence is
    absolute up to the key width, whose residue `shingle_key` measures (~3e-7
    over the real artifact). The earlier version of this line said Jaccard over
    shingles with no qualifier while the screen ran over 32-bit keys, and a pair
    at exactly 0.82 survived it.

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

    Same shingle contract as prune() — 5-token shingles, exact Jaccard >= 0.82,
    candidates proposed by a shared-shingle inverted index over a 1/16 sample — with ONE
    stated difference: prune() compares shingle strings, and this side compares
    `shingle_key` keys, because the same screen has to run off an artifact that holds no
    text. The two agree on every pair whose shingles do not collide under that key.

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

    THE SEEN SIDE IS COMPARED AS SHINGLE KEYS, not as shingle strings, because the same
    screen has to run off an artifact that holds no text (`drop_seen_against`). A key
    collision errs in BOTH directions and the width is what bounds it — see
    `shingle_key`, which carries the arithmetic and the measured residue. The claim that
    a collision "can only add to an intersection" stood here and was WRONG: a collision
    between two shingles both documents share removes one element from the intersection
    and one from the union at once, which lowers Jaccard and keeps the near-duplicate.
    """
    return drop_seen_against(docs, build_seen_index(seen_texts))


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


def file_digest(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


def texts_of_records(path: Path) -> Iterable[str]:
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)["text"]


def build_seen_index_command(records: Path, out: Path) -> dict:
    """Turn a records file into the seen-set artifact, printing only counts.

    The records file is the DEAD CORPUS and covers all five partitions, so this is the
    one step that opens it. Nothing derived from a token is printed or written: the
    artifact carries digests and shingle keys, and the summary carries counts.
    """
    lines = 0
    digest = file_digest(records)
    texts: list[str] = []
    for text in texts_of_records(records):
        lines += 1
        texts.append(text)
    index = build_seen_index(texts)
    del texts
    header = write_seen_index(
        index,
        out,
        {"path": records.as_posix(), "sha256": digest, "lines": lines},
    )
    return header


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="seen-set index for corpus assembly")
    sub = parser.add_subparsers(dest="command", required=True)
    build = sub.add_parser(
        "build-seen-index",
        help="hash + shingle a records file into the artifact assemble_corpus reads",
    )
    build.add_argument("--records", required=True, type=Path)
    build.add_argument("--out", required=True, type=Path)
    args = parser.parse_args(argv)
    header = build_seen_index_command(args.records, args.out)
    print(json.dumps(header, ensure_ascii=False, sort_keys=True))
    print(f"escrito em {args.out} ({args.out.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
