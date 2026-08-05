"""Fixture tests for near-duplicate pruning (run: python -m unittest -v).

`drop_seen()` is the only thing in the pipeline that can see an overlap between the
corpus and the training set, and until this file it had no test at all — the module
had tests for the extractors and none for the pruning they feed.

What is pinned here is the CONTRACT, not independence: exact tokenized content plus
Jaccard >= 0.82 over 5-token shingles, compared as `shingle_key` keys. Where the
distinction bites, the expectation is derived from the shingle STRINGS inside the test
(`_verdict_over_strings`), because two key-based implementations agreeing with each other
say nothing about either honouring the sentence they publish.
`test_a_bucket_over_the_prune_cap_is_now_compared_instead_of_skipped` is the
regression for a real recall hole: `drop_seen` used to apply prune()'s MAX_BUCKET cap,
so a document whose only bridge to the training set ran through a shingle shared by
more than MAX_BUCKET training texts was never compared against it at all, and no
statistic said so.
"""

from __future__ import annotations

import base64
import json
import re
import tempfile
import unittest
from pathlib import Path
from zlib import crc32

import near_dupes


def words(count: int, *, start: int = 0, prefix: str = "palavra") -> str:
    return " ".join(f"{prefix}{index}" for index in range(start, start + count))


class DropSeenTests(unittest.TestCase):
    def test_exact_content_duplicate_is_dropped(self) -> None:
        text = words(80)
        drop, stats = near_dupes.drop_seen([("d1", text)], [text])
        self.assertEqual(drop, {"d1"})
        self.assertEqual(stats["dropped"], 1)
        self.assertEqual(stats["checked"], 1)
        self.assertEqual(stats["seen_texts"], 1)

    def test_normalization_makes_case_and_accents_form_irrelevant(self) -> None:
        # NFKC + lowercase, so a case change alone is still an exact duplicate.
        seen = "Acordo Coletivo DE Trabalho firmado entre as partes " + words(70)
        candidate = seen.lower()
        drop, _ = near_dupes.drop_seen([("d1", candidate)], [seen])
        self.assertEqual(drop, {"d1"})

    def test_unrelated_text_is_kept_and_reported_below_the_bar(self) -> None:
        drop, stats = near_dupes.drop_seen(
            [("d1", words(80, prefix="alpha"))], [words(80, prefix="beta")]
        )
        self.assertEqual(drop, set())
        self.assertLess(stats["highest_similarity_kept"], near_dupes.JACCARD_THRESHOLD)

    def test_near_duplicate_above_the_bar_is_dropped(self) -> None:
        seen = words(200)
        # Replace a handful of tokens: shingle overlap stays well above 0.82.
        edited = seen.replace("palavra7 ", "outra ").replace("palavra150 ", "outra2 ")
        similarity = near_dupes.jaccard(
            near_dupes.shingles_of(near_dupes.tokens_of(edited)),
            near_dupes.shingles_of(near_dupes.tokens_of(seen)),
        )
        self.assertGreaterEqual(similarity, near_dupes.JACCARD_THRESHOLD)
        drop, _ = near_dupes.drop_seen([("d1", edited)], [seen])
        self.assertEqual(drop, {"d1"})

    def test_a_kept_record_below_the_bar_reports_its_own_similarity(self) -> None:
        # Half shared, half fresh: real overlap, comfortably under the refusal bar.
        seen = words(120)
        candidate = words(60) + " " + words(60, start=500, prefix="nova")
        similarity = near_dupes.jaccard(
            near_dupes.shingles_of(near_dupes.tokens_of(candidate)),
            near_dupes.shingles_of(near_dupes.tokens_of(seen)),
        )
        self.assertLess(similarity, near_dupes.JACCARD_THRESHOLD)
        drop, stats = near_dupes.drop_seen([("d1", candidate)], [seen])
        self.assertEqual(drop, set())
        self.assertAlmostEqual(
            stats["highest_similarity_kept"], round(similarity, 3), places=3
        )

    def test_highest_similarity_kept_ignores_the_records_it_dropped(self) -> None:
        # A dropped record sits ABOVE the bar. If the statistic counted it, a pool
        # whose kept records are all clean would report a contaminated number.
        seen = words(200)
        clean = words(200, start=9000, prefix="outro")
        drop, stats = near_dupes.drop_seen(
            [("dirty", seen), ("clean", clean)], [seen]
        )
        self.assertEqual(drop, {"dirty"})
        self.assertLess(stats["highest_similarity_kept"], near_dupes.JACCARD_THRESHOLD)

    def test_a_bucket_over_the_prune_cap_is_now_compared_instead_of_skipped(self) -> None:
        """The regression, made deterministic.

        `MAX_BUCKET + 5` seen texts share one boilerplate opening, and each is short
        enough (< SAMPLE_MIN_SHINGLES) that the index keeps ALL its shingles rather
        than a 1/16 sample — that is what makes the bucket sizes exact instead of
        dependent on key values. The candidate then shares ONLY the boilerplate.

        Under the old cap those buckets were skipped, so the candidate proposed zero
        candidates and was compared against nothing. What this pins is that the
        comparison now HAPPENS: `candidates_evaluated` goes from 0 to the bucket's
        members. The candidate is legitimately kept — sharing boilerplate is not being
        a near-duplicate — and the point is that the gate looked.
        """
        boilerplate = words(12, prefix="clausula")
        seen = [
            f"{boilerplate} {words(40, start=1000 * index, prefix='enchimento')}"
            for index in range(near_dupes.MAX_BUCKET + 5)
        ]
        # Short enough to be indexed in full, which is what makes the count exact.
        for text in seen:
            self.assertLess(
                len(near_dupes.shingles_of(near_dupes.tokens_of(text))),
                near_dupes.SAMPLE_MIN_SHINGLES,
            )
        candidate = f"{boilerplate} {words(60, start=90_000, prefix='alvo')}"

        drop, stats = near_dupes.drop_seen([("d1", candidate)], seen)

        # The oversized-bucket path was really exercised: one hit per boilerplate
        # shingle, and every bucket holds all MAX_BUCKET + 5 seen texts.
        self.assertEqual(stats["buckets_over_prune_cap"], 8)
        self.assertEqual(
            stats["candidates_evaluated"],
            near_dupes.MAX_BUCKET + 5,
            "under the old cap this was 0: the only bridge to the seen set ran "
            "through buckets the cap discarded, so nothing was ever compared",
        )
        # And it is correctly kept — sharing boilerplate is not being a duplicate.
        self.assertEqual(drop, set())

    def test_a_real_duplicate_behind_a_common_shingle_is_dropped(self) -> None:
        # Same crowded index, but now the candidate really is a near-copy of one of
        # the seen texts. Nothing about a shingle being popular may hide that.
        boilerplate = words(12, prefix="clausula")
        seen = [
            f"{boilerplate} {words(40, start=1000 * index, prefix='enchimento')}"
            for index in range(near_dupes.MAX_BUCKET + 5)
        ]
        twin = seen[7]
        # The LAST token is replaced, not one in the middle: these seen texts are
        # deliberately short (48 shingles), and a token in the middle sits inside five
        # shingles, which drags Jaccard to 0.811 — under the bar, so the fixture would
        # be testing the wrong thing. The final token sits inside one.
        candidate = twin.rsplit(" ", 1)[0] + " trocada"
        self.assertGreaterEqual(
            near_dupes.jaccard(
                near_dupes.shingles_of(near_dupes.tokens_of(candidate)),
                near_dupes.shingles_of(near_dupes.tokens_of(twin)),
            ),
            near_dupes.JACCARD_THRESHOLD,
        )
        drop, stats = near_dupes.drop_seen([("d1", candidate)], seen)
        self.assertEqual(drop, {"d1"})
        self.assertGreater(stats["buckets_over_prune_cap"], 0)

    def test_stats_carry_the_contract_and_the_cost(self) -> None:
        # A NEAR duplicate, because that is the one that pays the candidate cost.
        seen = words(200)
        edited = seen.rsplit(" ", 1)[0] + " trocada"
        drop, stats = near_dupes.drop_seen([("d1", edited)], [seen])
        self.assertEqual(drop, {"d1"})
        # The contract travels WITH the number, so a printed stats line cannot be
        # read as an independence claim.
        # Spelled out and not read off the module: the sentence the stats carry names the
        # key comparison, because that is what the screen runs. A contract string that
        # said "over-5-token-shingles" while the comparison ran over keys is the
        # over-claim this literal exists to catch.
        self.assertEqual(
            stats["contract"],
            "exact-token-content-and-jaccard-0.82-over-5-token-shingle-keys",
        )
        self.assertGreater(stats["candidates_evaluated"], 0)
        self.assertEqual(stats["dropped_exact_content"], 0)

    def test_an_exact_copy_costs_no_candidate_work(self) -> None:
        # The exact-content index short-circuits before candidates are proposed, so
        # the cheapest case is also the one that cannot be silenced by sampling.
        text = words(80)
        drop, stats = near_dupes.drop_seen([("d1", text)], [text])
        self.assertEqual(drop, {"d1"})
        self.assertEqual(stats["dropped_exact_content"], 1)
        self.assertEqual(stats["candidates_evaluated"], 0)

    def test_a_blind_document_is_still_reachable_by_both_halves(self) -> None:
        """The codex cross-review's P1-1, pinned in both directions.

        A document with >= SAMPLE_MIN_SHINGLES shingles and NONE in the 1/16 remainder
        sample proposed zero candidates and was kept, however similar. Over the 36 971
        real seen texts, 40 documents land in that hole. Two mechanisms close it and
        neither covers the other case: the exact-content index catches an identical
        copy, and MINWISE_FLOOR catches a near copy no hash can see.
        """
        blind = None
        for seed in range(20_000):
            candidate = " ".join(f"p{seed}x{n}" for n in range(68))
            shingles = near_dupes.shingles_of(near_dupes.tokens_of(candidate))
            if len(shingles) < near_dupes.SAMPLE_MIN_SHINGLES:
                continue
            if any(
                near_dupes.shingle_key(shingle) % near_dupes.SAMPLE_MOD == 0
                for shingle in shingles
            ):
                continue
            blind = candidate
            break
        self.assertIsNotNone(blind, "no blind document found; the fixture proves nothing")
        assert blind is not None

        exact, exact_stats = near_dupes.drop_seen([("copy", blind)], [blind])
        self.assertEqual(exact, {"copy"})
        self.assertEqual(exact_stats["dropped_exact_content"], 1)

        edited = blind.rsplit(" ", 1)[0] + " trocada"
        similarity = near_dupes.jaccard(
            near_dupes.shingles_of(near_dupes.tokens_of(edited)),
            near_dupes.shingles_of(near_dupes.tokens_of(blind)),
        )
        self.assertGreaterEqual(similarity, near_dupes.JACCARD_THRESHOLD)
        near, near_stats = near_dupes.drop_seen([("near", edited)], [blind])
        self.assertEqual(
            near,
            {"near"},
            "a near copy of a blind document must still be proposed as a candidate",
        )
        # It was found through the shingle path, not the hash: this is the half the
        # exact-content index cannot cover.
        self.assertEqual(near_stats["dropped_exact_content"], 0)
        self.assertGreater(near_stats["candidates_evaluated"], 0)

    def test_empty_inputs_are_not_a_pass(self) -> None:
        # No seen texts means nothing was checked, not "nothing was contaminated".
        # The caller is what guards this (`if seen_texts:`), and the stats have to
        # make the emptiness visible rather than report a clean run.
        drop, stats = near_dupes.drop_seen([("d1", words(80))], [])
        self.assertEqual(drop, set())
        self.assertEqual(stats["seen_texts"], 0)
        self.assertEqual(stats["candidates_evaluated"], 0)


class DeterministicReachTests(unittest.TestCase):
    """The guarantee itself: every candidate above the bar is PROPOSED, always.

    The cross-review rejected `MINWISE_FLOOR = 12` because a fixed count makes a miss
    unlikely rather than impossible, then pointed out that the blind-document test still
    passed with the fraction set to zero — so nothing stopped a return to a probabilistic
    floor. These tests are that stop, and they are deliberately NOT a behavioural
    counter-test: with the fraction at zero one shingle is still indexed, and a candidate
    sharing 92% of its shingles hits it about 92% of the time, so "it fails when weakened"
    would itself be a coin flip. What is pinned instead is the derivation (the constant)
    and the universality (an exhaustive sweep), which is what the promise actually claims.
    """

    def test_the_fraction_is_derived_from_the_threshold_and_not_chosen(self) -> None:
        # The bound is |A \ B| <= (1 - THRESHOLD) * |A|, so the indexed subset must be
        # LARGER than (1 - THRESHOLD) of A. Any other value is a different promise:
        # smaller and the guarantee is gone, larger and it pays for unusable coverage.
        self.assertAlmostEqual(
            near_dupes.MINWISE_FRACTION,
            1.0 - near_dupes.JACCARD_THRESHOLD,
            places=12,
        )

    def test_every_single_token_edit_above_the_bar_is_proposed(self) -> None:
        """Exhaustive over EDIT POSITION, which is what "always" has to mean.

        A blind document — none of its shingles in the 1/16 remainder sample — is edited
        at every one of its token positions in turn. Each edit that leaves Jaccard at or
        above the bar must be caught. A bottom-k floor fails this as soon as k minima
        happen to sit inside the five shingles one edit destroys, which is how the
        cross-review broke k=4; the fraction cannot fail it, because 181 shingles do not
        fit in a gap of at most 180.
        """
        blind = None
        for seed in range(20_000):
            candidate = " ".join(f"b{seed}n{n}" for n in range(68))
            shingles = near_dupes.shingles_of(near_dupes.tokens_of(candidate))
            if len(shingles) < near_dupes.SAMPLE_MIN_SHINGLES:
                continue
            if any(
                near_dupes.shingle_key(sh) % near_dupes.SAMPLE_MOD == 0
                for sh in shingles
            ):
                continue
            blind = candidate
            break
        self.assertIsNotNone(blind)
        assert blind is not None

        tokens = near_dupes.tokens_of(blind)
        original = near_dupes.shingles_of(tokens)
        checked = 0
        for position in range(len(tokens)):
            edited = list(tokens)
            edited[position] = "substituido"
            text = " ".join(edited)
            if (
                near_dupes.jaccard(
                    near_dupes.shingles_of(near_dupes.tokens_of(text)), original
                )
                < near_dupes.JACCARD_THRESHOLD
            ):
                continue
            checked += 1
            drop, _ = near_dupes.drop_seen([("x", text)], [blind])
            self.assertEqual(
                drop, {"x"}, f"edit at token {position} escaped the shingle index"
            )
        self.assertGreater(checked, 50, "the sweep must actually exercise edits")

    def test_a_thousand_shingle_document_at_the_bar_is_proposed(self) -> None:
        """The size where a fixed floor provably cannot hold.

        At n = 1000 the gap may hold up to 180 shingles, so ANY constant-size subset can
        fall entirely inside it. The edit budget is arithmetic, not guesswork: with
        |A| = |B| = n and d shingles differing on each side, (n - d) / (n + d) >= 0.82
        gives d <= 98, and one token edit touches at most SHINGLE_SIZE = 5 shingles, so
        15 well-spaced edits is comfortably inside the bar. A first attempt used 30 and
        the Jaccard fell to 0.74 — below the bar, testing nothing.
        """
        tokens = [f"w{n}" for n in range(1004)]
        seen = " ".join(tokens)
        original = near_dupes.shingles_of(near_dupes.tokens_of(seen))
        self.assertEqual(len(original), 1000)

        edited = list(tokens)
        for step in range(15):
            edited[20 + step * 65] = f"trocado{step}"
        candidate = " ".join(edited)
        similarity = near_dupes.jaccard(
            near_dupes.shingles_of(near_dupes.tokens_of(candidate)), original
        )
        self.assertGreaterEqual(similarity, near_dupes.JACCARD_THRESHOLD)

        drop, stats = near_dupes.drop_seen([("d1", candidate)], [seen])
        self.assertEqual(drop, {"d1"})
        self.assertEqual(stats["dropped_exact_content"], 0)
        self.assertGreater(stats["candidates_evaluated"], 0)


class IndexedKeysPropertyTests(unittest.TestCase):
    """The guarantee as a set property, which is the only level it can be pinned at.

    The cross-review mutation-tested the text-level fixtures and found all 16 green after
    dropping the `+1` AND after replacing the fraction with a fixed 12. That is not a
    missing fixture: a test built out of text cannot choose which shingles an edit
    destroys, and those mutations only differ on inputs where the selected subset
    coincides with the destroyed one. So the property is asserted against
    `indexed_keys` directly, and each test below is written to FAIL under one of the
    mutations — that is the point of them, not a side effect.
    """

    @staticmethod
    def shingle_set(size: int, *, salt: str = "a") -> set[str]:
        return {f"{salt} shingle {n} of many words" for n in range(size)}

    def test_the_selected_subset_is_strictly_larger_than_the_gap(self) -> None:
        """Fails if the `+1` is dropped: at exactly the fraction, equality is possible.

        `floor(0.18 * n)` keys can coincide with a gap of `floor(0.18 * n)` keys. Strictly
        more cannot. This is checked over many sizes so it is the inequality being pinned
        and not one convenient n.
        """
        for size in [50, 64, 100, 121, 200, 500, 1000, 1001]:
            shingles = self.shingle_set(size)
            indexed = near_dupes.indexed_keys(shingles)
            gap = int(near_dupes.MINWISE_FRACTION * size)
            keyed = sorted(near_dupes.shingle_key(sh) for sh in shingles)
            smallest = set(keyed[: gap + 1])
            self.assertTrue(
                smallest <= indexed,
                f"n={size}: the smallest {gap + 1} keys must all be indexed",
            )
            self.assertGreater(
                len(smallest),
                gap,
                f"n={size}: the guaranteed subset must EXCEED the gap of {gap}",
            )

    def test_no_gap_within_the_bound_can_swallow_the_indexed_subset(self) -> None:
        """The guarantee itself, adversarially: the worst gap is the smallest keys.

        A gap of at most `floor(0.18 * n)` keys is chosen to be the WORST possible one —
        the lowest keys, exactly what a bottom-k selection would have picked — and
        the indexed set still has to survive it. Fails under a fixed floor as soon as the
        floor is smaller than the gap, which is what `guaranteed = 12` is for n >= 67.
        """
        for size in [64, 67, 100, 200, 1000]:
            shingles = self.shingle_set(size, salt=f"s{size}")
            indexed = near_dupes.indexed_keys(shingles)
            keyed = sorted(near_dupes.shingle_key(sh) for sh in shingles)
            worst_gap = set(keyed[: int(near_dupes.MINWISE_FRACTION * size)])
            self.assertTrue(
                indexed - worst_gap,
                f"n={size}: the whole indexed subset fell inside the gap, so a "
                f"candidate above the bar could be proposed by nothing",
            )

    def test_a_fixed_floor_would_not_survive_the_same_gap(self) -> None:
        """The counter-example spelled out, so the previous test cannot be read as luck.

        Twelve keys — the value the third review round rejected — DO fall entirely inside
        the worst-case gap once the document is long enough. This test asserts that fact
        about the rejected design, so anyone reverting to it can see the arithmetic fail
        rather than infer it from prose.
        """
        size = 1000
        shingles = self.shingle_set(size, salt="fixo")
        keyed = sorted(near_dupes.shingle_key(sh) for sh in shingles)
        worst_gap = set(keyed[: int(near_dupes.MINWISE_FRACTION * size)])
        rejected_floor = set(keyed[:12])
        self.assertTrue(
            rejected_floor <= worst_gap,
            "a 12-key floor must be shown to fit inside the gap, or this test is not "
            "documenting the rejected design",
        )
        # And the shipped selection does not.
        self.assertTrue(near_dupes.indexed_keys(shingles) - worst_gap)

    def test_a_short_document_is_indexed_in_full(self) -> None:
        # Below SAMPLE_MIN_SHINGLES every shingle is indexed, so the gap argument is
        # vacuous there and the fraction costs nothing.
        shingles = self.shingle_set(near_dupes.SAMPLE_MIN_SHINGLES - 1, salt="curto")
        indexed = near_dupes.indexed_keys(shingles)
        self.assertEqual(len(indexed), len(shingles))


class SeenIndexArtifactTests(unittest.TestCase):
    """The artifact carries the screen and NOT the material.

    The seen set is the dead corpus, and part of it sat in a blind partition, so the
    assembly reads this artifact instead of those record-lines. Two things therefore have
    to hold at once: the screen has to give the same verdicts as the text-fed one, and the
    file has to contain no token of the material.
    """

    # Tokens no pt-BR text would carry, so their absence from the artifact is evidence
    # rather than coincidence — a short marker could appear inside base64 by chance.
    RARE = ("zyzzyvamalucofuligem", "petrichorvaporwaveimbondeiro", "quixotescaefemeride")

    def _blind_text(self) -> str:
        return " ".join(
            [*self.RARE, *(f"{token}{n}" for n in range(60) for token in self.RARE[:1])]
        )

    def _artifact(self, texts: list[str]) -> tuple[Path, dict, str]:
        directory = Path(tempfile.mkdtemp())
        path = directory / "seen-index.jsonl"
        index = near_dupes.build_seen_index(texts)
        header = near_dupes.write_seen_index(
            index, path, {"path": "fixture", "sha256": "0" * 64, "lines": len(texts)}
        )
        return path, header, path.read_text(encoding="utf-8")

    def test_the_artifact_carries_no_clear_text(self) -> None:
        blind = self._blind_text()
        path, header, body = self._artifact([blind, words(200, prefix="outro")])

        # Nothing structural can carry text: the header and the document lines both admit
        # a closed field set, one field a 64-hex digest and the other base64 of whole
        # fixed-width keys.
        lines = body.splitlines()
        self.assertEqual(json.loads(lines[0]), header)
        self.assertEqual(
            sorted(header),
            [
                "artifact",
                "contract",
                "documents",
                "jaccardThreshold",
                "shingleEncoding",
                "shingleKeys",
                "shingleSize",
                "source",
                "version",
            ],
        )
        self.assertEqual(sorted(header["source"]), list(near_dupes.SEEN_SOURCE_FIELDS))
        self.assertEqual(len(lines), 3)
        for line in lines[1:]:
            row = json.loads(line)
            self.assertEqual(set(row), set(near_dupes.SEEN_INDEX_FIELDS))
            self.assertRegex(row["content"], r"^[0-9a-f]{64}$")
            raw = base64.b64decode(row["shingles"], validate=True)
            self.assertEqual(len(raw) % near_dupes.SHINGLE_KEY_BYTES, 0)
            self.assertGreater(len(raw), 0)

        # And nothing incidental either: neither a token of the material nor any of its
        # 5-token shingles appears anywhere in the artifact's bytes.
        haystack = body.lower()
        for token in self.RARE:
            self.assertNotIn(token, haystack)
        for shingle in near_dupes.shingles_of(near_dupes.tokens_of(blind)):
            self.assertNotIn(shingle, haystack)
        # A last, blunt check on the alphabet: no line outside the header holds a letter
        # sequence that is not hex or base64 payload.
        self.assertFalse(re.search(r'"[^"]*\b(zyzzyva|petrichor|quixotesca)', haystack))
        path.unlink()

    def test_a_provenance_field_outside_the_declared_set_is_refused(self) -> None:
        # The provenance is where a caller would reach for "just a sample so we can tell
        # which corpus this came from", and a sample IS the material.
        index = near_dupes.build_seen_index([words(120)])
        with self.assertRaises(near_dupes.SeenIndexUnreadable) as caught:
            near_dupes.seen_index_header(
                index,
                {
                    "path": "records.jsonl",
                    "sha256": "0" * 64,
                    "lines": 1,
                    "sample": "acordo coletivo de trabalho firmado entre as partes",
                },
            )
        self.assertIn("could carry text", str(caught.exception))
        self.assertIn("sample", str(caught.exception))

    def _shingles(self, text: str) -> set[str]:
        return near_dupes.shingles_of(near_dupes.tokens_of(text))

    def _verdict_over_strings(self, text: str, seen: list[str]) -> bool:
        """What the CONTRACT owes, computed here over shingle strings.

        The screen compares keys. Comparing the two key-based implementations to each
        other cannot say whether either honours the sentence they publish, so the
        expectation is derived from the strings instead.
        """
        return max(
            (
                near_dupes.jaccard(self._shingles(text), self._shingles(other))
                for other in seen
            ),
            default=0.0,
        ) >= near_dupes.JACCARD_THRESHOLD

    def test_the_artifact_screens_exactly_as_the_texts_do(self) -> None:
        seen = [words(200), words(200, start=5000, prefix="outro")]
        candidates = [
            ("copia", seen[0]),
            ("editado", seen[1].rsplit(" ", 1)[0] + " trocada"),
            ("limpo", words(200, start=90_000, prefix="alvo")),
        ]
        path, _header, _body = self._artifact(seen)
        try:
            from_index, index_stats = near_dupes.drop_seen_against(
                candidates, near_dupes.read_seen_index(path)[0]
            )
        finally:
            path.unlink()
        from_texts, text_stats = near_dupes.drop_seen(candidates, seen)
        self.assertEqual(from_index, {"copia", "editado"})
        self.assertEqual(from_index, from_texts)
        self.assertEqual(index_stats, text_stats)
        # And both against the arithmetic of the published contract, not against each
        # other: `drop_seen` delegates to `drop_seen_against`, so the two equalities above
        # move together under any mutation of the shared comparator.
        for doc_id, text in candidates:
            self.assertEqual(doc_id in from_index, self._verdict_over_strings(text, seen))

    # Two 5-token shingles with the SAME crc32, found by search in seconds. The pair is
    # the regression fixture for a screen that compared 32-bit keys while publishing a
    # sentence about shingles.
    CRC32_COLLIDING_SHINGLES = (
        "aa7275 bb7275 cc7275 dd7275 ee7275",
        "aa47144 bb47144 cc47144 dd47144 ee47144",
    )

    def _pair_at_the_bar(self) -> tuple[str, str]:
        """(seen, candidate) whose shingle-string Jaccard is EXACTLY 0.82.

        The two colliding 5-grams are windows 0 and 5 of a shared 86-token opening, so
        both documents hold both of them; the tails are disjoint. 91 shingles each, 82
        shared, 100 in the union. Under a colliding key the pair reads 81/99 = 0.8181 and
        survives a bar of 0.82 — one collision inside the intersection is enough.
        """
        shared = [
            *self.CRC32_COLLIDING_SHINGLES[0].split(),
            *self.CRC32_COLLIDING_SHINGLES[1].split(),
            *(f"enchimento{n}" for n in range(76)),
        ]
        return (
            " ".join([*shared, *(f"caudavista{n}" for n in range(9))]),
            " ".join([*shared, *(f"caudanova{n}" for n in range(9))]),
        )

    def test_a_pair_at_the_bar_is_dropped_even_where_crc32_conflates_two_shingles(
        self,
    ) -> None:
        left, right = self.CRC32_COLLIDING_SHINGLES
        self.assertEqual(crc32(left.encode("utf-8")), crc32(right.encode("utf-8")))
        # The screen's own key has to SEPARATE them, or the pair below is one shingle.
        self.assertNotEqual(near_dupes.shingle_key(left), near_dupes.shingle_key(right))

        seen, candidate = self._pair_at_the_bar()
        over_strings = near_dupes.jaccard(
            self._shingles(candidate), self._shingles(seen)
        )
        self.assertEqual(over_strings, 0.82)
        self.assertGreaterEqual(over_strings, near_dupes.JACCARD_THRESHOLD)
        self.assertTrue(self._verdict_over_strings(candidate, [seen]))

        drop, stats = near_dupes.drop_seen([("cand", candidate)], [seen])
        self.assertEqual(drop, {"cand"})
        self.assertEqual(stats["dropped"], 1)
        # And the same verdict off the artifact, which is the path a release runs.
        path, _header, _body = self._artifact([seen])
        try:
            from_index, _stats = near_dupes.drop_seen_against(
                [("cand", candidate)], near_dupes.read_seen_index(path)[0]
            )
        finally:
            path.unlink()
        self.assertEqual(from_index, {"cand"})

    def test_keys_out_of_ascending_order_are_refused_instead_of_indexed(self) -> None:
        # The one invariant of the artifact whose violation weakens the reach bound in
        # SILENCE: `indexed_keys_from` reads the LEADING slice of the order.
        path, header, body = self._artifact([words(200)])
        lines = body.splitlines()
        row = json.loads(lines[1])
        keys = near_dupes._unpack_keys(row["shingles"])
        self.assertEqual(keys, sorted(keys))
        try:
            path.write_text(
                "\n".join(
                    [
                        lines[0],
                        json.dumps(
                            {**row, "shingles": near_dupes._pack_keys(keys[::-1])}
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(near_dupes.SeenIndexUnreadable) as caught:
                near_dupes.read_seen_index(path)
        finally:
            path.unlink()
        message = str(caught.exception)
        self.assertIn("ascending order", message)
        self.assertIn("line 2", message)

    def test_an_artifact_of_another_contract_is_refused_rather_than_read(self) -> None:
        path, header, body = self._artifact([words(120)])
        lines = body.splitlines()
        try:
            for field, wrong in (
                ("contract", "jaccard-0.70-over-3-token-shingles"),
                ("shingleSize", 3),
                ("jaccardThreshold", 0.7),
                ("shingleEncoding", "sha256-hex"),
                ("version", 99),
                ("artifact", "something-else"),
            ):
                path.write_text(
                    "\n".join([json.dumps({**header, field: wrong}), *lines[1:]]) + "\n",
                    encoding="utf-8",
                )
                with self.assertRaises(near_dupes.SeenIndexUnreadable) as caught:
                    near_dupes.read_seen_index(path)
                self.assertIn(field, str(caught.exception))
        finally:
            path.unlink()

    def test_a_document_line_may_not_smuggle_a_field(self) -> None:
        path, header, body = self._artifact([words(120)])
        lines = body.splitlines()
        row = json.loads(lines[1])
        try:
            path.write_text(
                "\n".join([lines[0], json.dumps({**row, "text": "acordo coletivo"})])
                + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(near_dupes.SeenIndexUnreadable) as caught:
                near_dupes.read_seen_index(path)
            self.assertIn("could carry text", str(caught.exception))
        finally:
            path.unlink()

    def test_a_truncated_index_is_refused_instead_of_screening_less(self) -> None:
        path, header, body = self._artifact([words(120), words(120, prefix="outro")])
        lines = body.splitlines()
        try:
            path.write_text("\n".join(lines[:2]) + "\n", encoding="utf-8")
            with self.assertRaises(near_dupes.SeenIndexUnreadable) as caught:
                near_dupes.read_seen_index(path)
            self.assertIn("truncated", str(caught.exception))
        finally:
            path.unlink()

    def test_a_shingle_blob_of_the_wrong_width_is_refused(self) -> None:
        path, header, body = self._artifact([words(120)])
        lines = body.splitlines()
        row = json.loads(lines[1])
        raw = base64.b64decode(row["shingles"], validate=True)
        try:
            path.write_text(
                "\n".join(
                    [
                        lines[0],
                        json.dumps(
                            {
                                **row,
                                "shingles": base64.b64encode(raw[:-1]).decode("ascii"),
                            }
                        ),
                    ]
                )
                + "\n",
                encoding="utf-8",
            )
            with self.assertRaises(near_dupes.SeenIndexUnreadable) as caught:
                near_dupes.read_seen_index(path)
            self.assertIn(near_dupes.SEEN_SHINGLE_ENCODING, str(caught.exception))
        finally:
            path.unlink()

    def test_the_header_counts_what_it_indexed(self) -> None:
        texts = [words(120), words(120, prefix="outro"), words(90, prefix="terceiro")]
        path, header, _body = self._artifact(texts)
        try:
            index, read_header = near_dupes.read_seen_index(path)
        finally:
            path.unlink()
        self.assertEqual(header["documents"], len(texts))
        self.assertEqual(read_header, header)
        self.assertEqual(len(index), len(texts))
        self.assertEqual(index.shingle_keys(), header["shingleKeys"])
        self.assertEqual(header["source"]["lines"], len(texts))

    def test_two_identical_seen_texts_keep_two_documents(self) -> None:
        # The exact-content half is a SET and the shingle half is a LIST: collapsing the
        # two identical texts into one document would make the two halves disagree about
        # how many documents the index covers, which `SeenIndex` refuses outright.
        text = words(120)
        index = near_dupes.build_seen_index([text, text])
        self.assertEqual(len(index), 2)
        self.assertEqual(len(index.content_hashes), 1)

    def test_the_index_keys_are_the_keys_the_shingles_hash_to(self) -> None:
        # `indexed_keys_from` has to select exactly what `indexed_keys` selects, or the
        # artifact proposes a different candidate set from the text-fed screen.
        for size in [50, 64, 100, 200, 1000]:
            shingles = {f"shingle {n} de muitas palavras" for n in range(size)}
            self.assertEqual(
                near_dupes.indexed_keys(shingles),
                near_dupes.indexed_keys_from(near_dupes.shingle_keys_of(shingles)),
            )


class ContractDescriptionTests(unittest.TestCase):
    """R7 over the module's own prose: declare the contract, not the property."""

    def test_drop_seen_never_describes_itself_as_independence(self) -> None:
        doc = near_dupes.drop_seen.__doc__ or ""
        self.assertIn("Jaccard >= 0.82", doc)
        # It must SAY what it does not prove. The word may appear, but only in the
        # denying direction — which is why the assertion is on the denial and not on
        # the absence of the word.
        self.assertRegex(doc, r"(?i)does not prove[\s\S]*independence")


if __name__ == "__main__":
    unittest.main()
