"""The diagnostic probes: what decides, what only reports, and what may never be a feature.

Run: py -3.13 -m pytest test_diagnostic_probes.py -q
"""

from __future__ import annotations

import json
import os
import random
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import numpy as np

import assemble_corpus
import baseline_tfidf
import codex_batch
import diagnostic_probes as probes
import generate_ai

LAB = Path(__file__).resolve().parent
BENCHMARK = LAB.parent
REPO = BENCHMARK.parent

# Enough distinct pt-BR vocabulary that a bag-of-words over 80-word documents is not
# degenerate, and no marker any probe looks for.
_VOCABULARY = """cidade rio serra planalto porto vila campo ponte bairro estrada
    escola praca mercado museu teatro estacao fabrica igreja parque jardim
    fundada construida ampliada restaurada inaugurada demolida transferida
    regiao provincia municipio distrito freguesia comarca termo sesmaria
    povoado arraial nucleo colonia assentamento sitio fazenda chacara
    milho cafe algodao cana arroz feijao trigo cacau borracha erva
    ferrovia rodovia canal aqueduto represa usina moinho engenho curtume
    antiga nova pequena grande larga estreita alta baixa profunda rasa
    populacao habitantes moradores familias operarios lavradores pescadores""".split()


def _text(seed: int, words: int = 80, marker: str = "") -> str:
    """A deterministic pseudo-document. `marker` is the only thing a probe can key on."""
    rng = random.Random(seed)
    tokens = [rng.choice(_VOCABULARY) for _ in range(words)]
    if marker:
        for position in range(0, len(tokens), 8):
            tokens[position] = marker
    sentences: list[str] = []
    for start in range(0, len(tokens), 10):
        chunk = tokens[start : start + 10]
        sentences.append(chunk[0].capitalize() + " " + " ".join(chunk[1:]) + ".")
    return " ".join(sentences)


def _record(
    row_id: str,
    partition: str,
    label: str = "human",
    *,
    text: str | None = None,
    lane: str | None = None,
    words: int = 80,
    marker: str = "",
    seed: int | None = None,
) -> dict:
    record: dict = {
        "id": row_id,
        "label": label,
        "createdAt": assemble_corpus.BLOCK_TIME[partition],
        "text": _text(seed if seed is not None else hash(row_id) % 10_000, words, marker)
        if text is None
        else text,
        "groups": {},
    }
    if lane is not None:
        record["groups"]["generationLane"] = {"state": "known", "id": lane}
    return record


def _five_partition_corpus(
    *, dev_marker: str = "", shared_text: str | None = None
) -> list[dict]:
    """A stamped fixture that populates ALL FIVE partitions.

    The blind two are populated on purpose: what the probe must do with them is set them
    aside, and a fixture that omits them cannot tell "set aside" from "absent".
    """
    sizes = {"train": 45, "dev": 10, "cal-A": 15, "cal-B": 20, "test": 20}
    # Two lanes, so the lane probe has something to separate; both are frozen lanes.
    lanes = ("agy", "codex")
    rows: list[dict] = []
    seed = 0
    for partition, total in sizes.items():
        for index in range(total):
            seed += 1
            generated = index % 2 == 1
            rows.append(
                _record(
                    f"{partition}_{index}",
                    partition,
                    "ai" if generated else "human",
                    lane=lanes[(index // 2) % 2] if generated else None,
                    marker=dev_marker if partition == "dev" else "",
                    seed=seed,
                )
            )
    if shared_text is not None:
        rows[0]["text"] = shared_text
        rows[45]["text"] = shared_text
    return rows


class PartitionProbeTests(unittest.TestCase):
    """Probe 1 is the only one that decides, and it decides the ASSEMBLY."""

    def test_partitions_drawn_from_one_pool_are_at_chance_and_pass(self) -> None:
        report = probes.probe_partitions(_five_partition_corpus())
        self.assertEqual(report["verdict"], probes.VERDICT_EXCHANGEABLE)
        self.assertEqual(report["reasons"], [])
        self.assertLess(report["macroAuc"], probes.PARTITION_PREDICTABILITY_AUC_FLOOR)
        # No exception, and the returned value is the report rather than a bare bool.
        self.assertIsNone(probes.assert_partitions_are_exchangeable(report))

    def test_the_deciding_probe_does_not_move_with_the_order_of_the_rows(self) -> None:
        # THE ONE THAT DECIDES, so the invariance matters most here: a verdict that depends
        # on the order the pool files were concatenated in is a verdict about the
        # concatenation. Eight orders, and the whole decision surface compared — verdict,
        # reasons, macro AUC and the per-partition table.
        import random

        rows = _five_partition_corpus()
        rng = random.Random(20260822)
        orders: list[list[int]] = [list(range(len(rows)))]
        while len(orders) < 8:
            order = list(range(len(rows)))
            rng.shuffle(order)
            if order not in orders:
                orders.append(order)

        readings = set()
        for order in orders:
            report = probes.probe_partitions([rows[position] for position in order])
            readings.add(
                (
                    report["verdict"],
                    tuple(report["reasons"]),
                    round(report["macroAuc"], 12),
                    tuple(
                        (
                            entry["partition"],
                            round(entry["auc"], 12),
                            round(entry["pValue"], 12),
                        )
                        for entry in sorted(
                            report["partitions"], key=lambda item: item["partition"]
                        )
                    ),
                )
            )
        self.assertEqual(len(readings), 1, readings)

    def test_a_signature_only_dev_carries_refuses_naming_the_partition_and_the_metric(
        self,
    ) -> None:
        """The leak this probe CAN see: `dev` drawn from material `train` is not.

        A text present in both `train` and `dev` is invisible to a partition classifier
        by construction (the same features carry two labels), which is why exact overlap
        is checked separately below. What a partition classifier sees is
        non-exchangeability, and that is the leak that makes a `dev` number stop
        estimating anything `train` was fit for.
        """
        report = probes.probe_partitions(_five_partition_corpus(dev_marker="zumbaia"))
        self.assertEqual(report["verdict"], probes.VERDICT_REFUSE_ASSEMBLY)
        self.assertIn(probes.REASON_PARTITION_PREDICTABLE, report["reasons"])
        dev = next(entry for entry in report["partitions"] if entry["partition"] == "dev")
        self.assertGreaterEqual(dev["auc"], probes.PARTITION_PREDICTABILITY_AUC_FLOOR)
        self.assertLess(dev["pValue"], probes.PARTITION_PREDICTABILITY_SIGNIFICANCE)

        with self.assertRaises(probes.PartitionLeakage) as caught:
            probes.assert_partitions_are_exchangeable(report)
        message = str(caught.exception)
        self.assertIn("dev", message)
        self.assertIn("one-vs-rest AUC", message)
        # The VALUES and not only the words: a refusal that names the metric without its
        # number leaves an operator deciding between re-splitting and re-collecting on
        # nothing.
        self.assertIn(f"{dev['auc']:.4f}", message)
        self.assertIn(f"p={dev['pValue']:.2e}", message)
        self.assertIn(f"n={dev['rows']}", message)
        self.assertIn(f"floor of {probes.PARTITION_PREDICTABILITY_AUC_FLOOR:.2f}", message)
        self.assertIs(caught.exception.report, report)

    def test_a_text_shared_between_train_and_dev_refuses_naming_both_partitions(
        self,
    ) -> None:
        shared = _text(999, 90)
        report = probes.probe_partitions(_five_partition_corpus(shared_text=shared))
        self.assertEqual(report["verdict"], probes.VERDICT_REFUSE_ASSEMBLY)
        self.assertIn(probes.REASON_TEXT_SHARED, report["reasons"])
        self.assertEqual(
            report["sharedText"], [{"partitions": ["dev", "train"], "texts": 1}]
        )
        with self.assertRaises(probes.PartitionLeakage) as caught:
            probes.assert_partitions_are_exchangeable(report)
        self.assertIn("text shared across partitions", str(caught.exception))
        self.assertIn("dev + train", str(caught.exception))

    def test_the_two_blind_partitions_are_set_aside_as_a_count_and_never_named(
        self,
    ) -> None:
        report = probes.probe_partitions(_five_partition_corpus())
        self.assertEqual(report["rows"], 70)
        self.assertEqual(report["rowsSetAsideAsBlind"], 40)
        self.assertEqual(report["openPartitions"], ["train", "dev", "cal-A"])
        self.assertEqual(
            [entry["partition"] for entry in report["partitions"]],
            ["train", "dev", "cal-A"],
        )
        # Nothing anywhere in the report may name a blind partition or a blind row.
        published = json.dumps(report)
        for blind in probes.BLIND_PARTITIONS:
            self.assertNotIn(f'"{blind}"', published)
            self.assertNotIn(f"{blind}_", published)

    def test_no_blind_spelling_reaches_the_WHOLE_report_of_every_probe(self) -> None:
        """The full `_probe_all` artifact, and not just probe 1's slice of it.

        The narrow version of this assertion covered `probe_partitions` alone while the
        document claimed it covered the report. It matters at the moment a FIELD IS ADDED
        to `_probe_all` — which just happened, for `inputs` — because that is when a new
        path to the output appears and nobody re-reads the old assertion.
        """
        report = probes._probe_all(
            _five_partition_corpus(), stamped=True, permutation_repeats=0
        )
        self.assertEqual(
            sorted(report),
            [
                "classFromLength",
                "governance",
                "inputs",
                "laneWithinAi",
                "partitionExchangeability",
                "report",
                "rows",
                "stylometry",
                "windowDispersion",
            ],
            "a key added to the report is a new path to the output: assert it here",
        )
        published = json.dumps(report)
        for blind in probes.BLIND_PARTITIONS:
            with self.subTest(blind=blind):
                self.assertNotIn(f'"{blind}"', published)
                self.assertNotIn(f"{blind}_", published)
        # The open three DO appear — otherwise the assertion above would pass over a
        # report that names no partition at all.
        for open_partition in probes.OPEN_PARTITIONS:
            with self.subTest(open=open_partition):
                self.assertIn(f'"{open_partition}"', published)

    def test_a_blind_row_reaching_the_classifier_refuses_before_the_fit(self) -> None:
        """The guard that makes a widened `OPEN_PARTITIONS` fail instead of training."""
        with self.assertRaises(probes.BlindPartitionReachedTheProbe) as caught:
            probes._assert_no_blind_partition_reached(["train", "dev", "cal-B"])
        self.assertIn("cal-B", str(caught.exception))
        self.assertIn("BLIND_PARTITIONS", str(caught.exception))

    def test_widening_the_open_set_to_a_blind_partition_is_refused_end_to_end(
        self,
    ) -> None:
        original = probes.OPEN_PARTITIONS
        try:
            probes.OPEN_PARTITIONS = ("train", "dev", "cal-A", "cal-B")
            with self.assertRaises(probes.BlindPartitionReachedTheProbe):
                probes.probe_partitions(_five_partition_corpus())
        finally:
            probes.OPEN_PARTITIONS = original

    def test_an_unstamped_row_is_a_pipeline_defect_and_not_a_finding(self) -> None:
        rows = _five_partition_corpus()
        rows[3]["createdAt"] = 1_234
        with self.assertRaises(probes.CorpusIsNotStamped) as caught:
            probes.probe_partitions(rows)
        self.assertIn("assign_partitions", str(caught.exception))

    def test_a_partition_thinner_than_the_folds_is_its_own_refusal(self) -> None:
        rows = [_record(f"t{index}", "train", seed=index) for index in range(20)]
        rows += [_record(f"d{index}", "dev", seed=100 + index) for index in range(3)]
        with self.assertRaises(probes.NotEnoughRowsToProbe) as caught:
            probes.probe_partitions(rows)
        self.assertIn("dev 3", str(caught.exception))


class PartitionProbeBlindSpotTests(unittest.TestCase):
    def test_a_text_duplicated_across_partitions_is_invisible_to_the_auc(self) -> None:
        """The blind spot, asserted so nobody reads the AUC as a duplicate detector.

        The duplicated pair carries the same features under two different labels, so it
        moves no one-vs-rest AUC in either direction. Duplication is caught by
        `sharedText` here, and near-duplication by `near_dupes` + `benchmark/split.ts`.
        """
        shared = _text(999, 90)
        report = probes.probe_partitions(_five_partition_corpus(shared_text=shared))
        self.assertLess(report["macroAuc"], probes.PARTITION_PREDICTABILITY_AUC_FLOOR)
        self.assertNotIn(probes.REASON_PARTITION_PREDICTABLE, report["reasons"])
        self.assertIn(probes.REASON_TEXT_SHARED, report["reasons"])


class LengthProbeTests(unittest.TestCase):
    """Probe 2 reports a length artifact and refuses nothing."""

    def _length_correlated_corpus(self) -> list[dict]:
        rows: list[dict] = []
        for index in range(30):
            rows.append(_record(f"h{index}", "train", "human", words=70, seed=index))
            rows.append(
                _record(f"a{index}", "train", "ai", words=300, seed=500 + index)
            )
        return rows

    def _distinguishable_corpus(self) -> list[dict]:
        """A corpus whose rows DIFFER within each class, which the batteries need.

        `_length_correlated_corpus` gives every human row 70 words and every ai row 300, so
        its rows are indistinguishable inside a class: the fold PARTITION moves with the
        input order while the fold CONTENTS do not, and a battery riding it is green with
        the order dependence in place — measured, three mutants survived on it. Here every
        row has its own word count and its own text.
        """
        return [
            _record(f"h{index}", "train", "human", words=60 + 4 * index, seed=index)
            for index in range(30)
        ] + [
            _record(f"a{index}", "train", "ai", words=62 + 4 * index, seed=500 + index)
            for index in range(30)
        ]

    @staticmethod
    def _orders(count: int, total: int = 8) -> list[list[int]]:
        """`total` DISTINCT permutations of `range(count)`, deterministically."""
        import random

        rng = random.Random(20260822)
        orders: list[list[int]] = [list(range(count))]
        while len(orders) < total:
            order = list(range(count))
            rng.shuffle(order)
            if order not in orders:
                orders.append(order)
        return orders

    def test_the_permutation_fixture_moves_the_folds(self) -> None:
        # What keeps the batteries below from being vacuous: the fold PARTITION itself has
        # to move with the input order, or a battery that finds the AUC unchanged would be
        # green with the defect in place. `StratifiedKFold` partitions by position and
        # `shuffle=True` permutes whatever came in, which is why a fixed seed does not fix
        # it.
        import numpy as np
        from sklearn.model_selection import StratifiedKFold

        rows = self._distinguishable_corpus()
        counts = [len(str(row["text"]).split()) for row in rows]
        labels = [1 if row["label"] == "ai" else 0 for row in rows]
        folds = StratifiedKFold(
            n_splits=probes.PROBE_FOLDS, shuffle=True, random_state=probes.PROBE_SEED
        )

        def partition_of(order: list[int]) -> tuple:
            features = np.array([[counts[position]] for position in order], dtype=float)
            targets = np.array([labels[position] for position in order])
            return tuple(
                frozenset(order[position] for position in test)
                for _, test in folds.split(features, targets)
            )

        orders = self._orders(len(rows))
        raw = partition_of(orders[0])
        for order in orders[1:]:
            self.assertNotEqual(partition_of(order), raw)

    def test_the_length_probe_does_not_move_with_the_order_of_the_rows(self) -> None:
        # The invariance itself, over eight orders. It is a property of the FUNCTION over
        # every input order, so no predicate over one array can state it — the battery is
        # what asserts it.
        rows = self._distinguishable_corpus()
        readings = set()
        for order in self._orders(len(rows)):
            report = probes.probe_length([rows[position] for position in order])
            readings.add(
                (
                    round(report["auc"], 12),
                    round(report["rawWordCountAuc"], 12),
                    # The PER-FOLD coefficients too, and they are the sharper half: the AUC
                    # is out-of-fold over the whole population and can survive a moved
                    # partition, while a coefficient is fitted on one fold's rows.
                    tuple(round(value, 12) for value in report["coefficientPerFold"]),
                    tuple(
                        (band["band"], band["wordsFrom"], band["human"], band["ai"])
                        for band in report["bands"]
                    ),
                )
            )
        self.assertEqual(len(readings), 1, readings)

    def test_the_stylometry_probe_does_not_move_with_the_order_of_the_rows(self) -> None:
        rows = self._distinguishable_corpus()
        readings = {
            round(
                probes.probe_stylometry([rows[position] for position in order])["auc"], 12
            )
            for order in self._orders(len(rows))
        }
        self.assertEqual(len(readings), 1, readings)

    def test_length_correlated_with_the_class_reports_a_high_auc_and_does_not_refuse(
        self,
    ) -> None:
        report = probes.probe_length(self._length_correlated_corpus())
        self.assertGreater(report["auc"], 0.95)
        self.assertFalse(report["decides"])
        # STRUCTURAL, not a convention: a report with no verdict cannot be read as one.
        self.assertNotIn("verdict", report)
        self.assertNotIn("reasons", report)
        self.assertEqual(report["counts"], {"ai": 30, "human": 30})

    def _overlapping_length_corpus(self) -> list[dict]:
        return [
            _record(f"h{index}", "train", "human", words=60 + 4 * index, seed=index)
            for index in range(30)
        ] + [
            _record(f"a{index}", "train", "ai", words=62 + 4 * index, seed=500 + index)
            for index in range(30)
        ]

    def test_the_two_auc_columns_are_different_quantities_and_diverge(self) -> None:
        """The published pair does NOT have to agree, and on real material it does not.

        The reported `auc` pools the out-of-fold predictions of five models with five
        intercepts and five coefficients; `rawWordCountAuc` ranks by the count itself. A
        union of monotone maps is not monotone, so the two are different quantities. Where
        the folds disagree in SIGN the pooled AUC lands on the other side of chance from
        the raw one — asserted here so nobody re-derives "they coincide" from a fixture
        that separates perfectly, and so replacing the pooled out-of-fold prediction with
        the in-sample prediction of a single model (which WOULD make them equal) is red.
        """
        report = probes.probe_length(self._overlapping_length_corpus())
        # Arithmetic on word counts, no estimator in it: safe to pin by value.
        self.assertAlmostEqual(report["rawWordCountAuc"], 31 / 60, places=12)
        self.assertGreater(report["rawWordCountAuc"], 0.5)
        self.assertLess(report["auc"], 0.5)
        self.assertGreater(
            abs(report["auc"] - report["rawWordCountAuc"]),
            0.05,
            "the pooled out-of-fold AUC is not the raw rank AUC",
        )
        signs = {value > 0 for value in report["coefficientPerFold"]}
        self.assertEqual(signs, {True, False}, "the folds disagree in sign")
        # And the divergence is NOT an error: no exception, and still no verdict.
        self.assertNotIn("verdict", report)

    def test_a_perfectly_separated_fixture_makes_the_two_columns_degenerate(
        self,
    ) -> None:
        """Both AUCs are exactly 1.0 here — which is why this fixture cannot test agreement.

        Kept as the named statement of the degeneracy: an equality asserted over this
        corpus is `1.0 == 1.0` and no mutation of `probe_length` can redden it.
        """
        report = probes.probe_length(self._length_correlated_corpus())
        self.assertEqual(report["auc"], 1.0)
        self.assertEqual(report["rawWordCountAuc"], 1.0)
        self.assertTrue(all(value > 0 for value in report["coefficientPerFold"]))

    def test_the_bands_are_deciles_of_the_pooled_distribution_and_show_where_it_splits(
        self,
    ) -> None:
        """A bimodal corpus yields ONE band per mode, and the split is visible in them.

        Half the deciles sit on each mode, so the deduplicated lower bounds are two — and
        that is the reading, not a degeneracy: the classes do not overlap in a single band.
        """
        report = probes.probe_length(self._length_correlated_corpus())
        self.assertEqual(
            sum(band["human"] + band["ai"] for band in report["bands"]), 60
        )
        self.assertEqual(len(report["bands"]), 2)
        self.assertEqual(report["bands"][0]["ai"], 0)
        self.assertEqual(report["bands"][0]["human"], 30)
        self.assertEqual(report["bands"][-1]["human"], 0)
        self.assertEqual(report["bands"][-1]["ai"], 30)
        self.assertEqual(report["bands"][0]["aiShare"], 0.0)
        self.assertEqual(report["bands"][-1]["aiShare"], 1.0)
        self.assertLess(
            report["wordCountMedian"]["human"], report["wordCountMedian"]["ai"]
        )

    def test_overlapping_lengths_spread_over_ten_bands_and_every_row_lands_in_one(
        self,
    ) -> None:
        report = probes.probe_length(self._overlapping_length_corpus())
        self.assertEqual(len(report["bands"]), 10)
        self.assertEqual(
            sum(band["human"] + band["ai"] for band in report["bands"]), 60
        )
        for band in report["bands"]:
            with self.subTest(band=band["band"]):
                self.assertLess(band["wordsFrom"], band["wordsBelow"])

    def test_lengths_drawn_from_one_distribution_stay_at_chance(self) -> None:
        rows = [
            _record(f"h{index}", "train", "human", words=100, seed=index)
            for index in range(30)
        ] + [
            _record(f"a{index}", "train", "ai", words=100, seed=500 + index)
            for index in range(30)
        ]
        report = probes.probe_length(rows)
        self.assertLess(abs(report["auc"] - 0.5), 0.2)

    def test_the_mixed_class_is_excluded_rather_than_folded_into_a_binary_auc(
        self,
    ) -> None:
        rows = self._length_correlated_corpus()
        rows += [
            _record(f"m{index}", "train", "mixed", words=1000, seed=900 + index)
            for index in range(20)
        ]
        report = probes.probe_length(rows)
        self.assertEqual(report["rows"], 60)
        self.assertNotIn("mixed", report["counts"])


class MatchedGenerationLengthTests(unittest.TestCase):
    """The length asked of the generated class, held against the probe that reproves it.

    `generate_ai.target_word_count` and `probes.probe_length` are two halves of one rule:
    the generated length distribution has to MATCH the measured human one, and the probe
    that predicts the class from the word count alone is the criterion. These tests wire
    the two together, so a clamp or a constant reintroduced in the generator is red here
    and not only in a future run of the slate.
    """

    # The MEASURED shape of the human class: quantiles of the word count over the 25 036
    # admissible lead sections of the ptwiki-20220301 dump (measured 2026-08-06, mirroring
    # the extractor's own `lead_section`/`normalize_text`/`word_count`/`pii_hits` and its
    # 50/5 000 window). Long-tailed on purpose — the tail is what a clamp destroys.
    MEASURED_QUANTILES = (
        (0.00, 50),
        (0.10, 56),
        (0.25, 72),
        (0.50, 120),
        (0.75, 221),
        (0.90, 362),
        (1.00, 1774),
    )

    def _human_word_counts(self, rows: int) -> list[int]:
        """`rows` counts drawn off the measured quantiles by linear interpolation."""
        counts: list[int] = []
        for index in range(rows):
            fraction = index / (rows - 1)
            for position in range(1, len(self.MEASURED_QUANTILES)):
                low_q, low_words = self.MEASURED_QUANTILES[position - 1]
                high_q, high_words = self.MEASURED_QUANTILES[position]
                if fraction <= high_q:
                    span = high_q - low_q
                    weight = 0.0 if span == 0 else (fraction - low_q) / span
                    counts.append(round(low_words + weight * (high_words - low_words)))
                    break
        return counts

    def _paired_corpus(self, target: "callable[[int], int]") -> list[dict]:
        rows: list[dict] = []
        for index, words in enumerate(self._human_word_counts(80)):
            rows.append(_record(f"h{index}", "train", "human", words=words, seed=index))
            rows.append(
                _record(
                    f"a{index}",
                    "train",
                    "ai",
                    words=target(words),
                    seed=5_000 + index,
                )
            )
        return rows

    def test_the_fixture_carries_the_word_count_it_declares(self) -> None:
        """Otherwise the whole file measures the text builder and not the target."""
        for words in (50, 56, 120, 362, 1774):
            self.assertEqual(probes.common.word_count(_text(1, words)), words)

    def test_the_target_is_the_seed_length_across_the_measured_distribution(
        self,
    ) -> None:
        for words in self._human_word_counts(80):
            self.assertEqual(generate_ai.target_word_count(words), words)

    def test_a_seed_outside_the_extractor_window_is_refused_and_never_clamped(
        self,
    ) -> None:
        for words in (0, 49, 5_001):
            with self.assertRaises(generate_ai.SeedLengthOutOfWindow) as caught:
                generate_ai.target_word_count(words)
            self.assertIn("fora da janela", str(caught.exception))

    def test_the_matched_target_leaves_every_band_of_the_length_probe_at_chance(
        self,
    ) -> None:
        """THE criterion, and it is the BAND table rather than the AUC.

        With the target equal to the seed's count the two word-count multisets are
        identical, so the raw rank AUC is exactly 0.5 (every pair is a tie) and every
        decile of the pooled distribution holds as many generated lines as human ones.
        The pooled out-of-fold AUC is deliberately NOT pinned: over an all-ties feature it
        is decided by tie-breaking inside five folds and not by the feature, so a value
        pinned here would be a fixture artifact.
        """
        report = probes.probe_length(self._paired_corpus(generate_ai.target_word_count))
        # Arithmetic on word counts, no estimator in it: safe to pin by value.
        self.assertEqual(report["rawWordCountAuc"], 0.5)
        # One band per decile of the pooled counts. Pinned against the constant so the
        # band count of the report cannot drift away from the reporting choice in
        # silence — over these 160 spread-out counts no two decile bounds collide.
        self.assertEqual(len(report["bands"]), probes.LENGTH_PROBE_DECILES)
        self.assertEqual(
            report["wordCountMedian"]["human"], report["wordCountMedian"]["ai"]
        )
        for band in report["bands"]:
            self.assertEqual(
                band["aiShare"],
                0.5,
                f"band {band['band']} ({band['wordsFrom']}-{band['wordsBelow']}) "
                "does not hold as many generated lines as human ones",
            )
        # Still a diagnostic: it reports the artifact and refuses nothing.
        self.assertFalse(report["decides"])
        self.assertNotIn("verdict", report)

    def test_a_clamped_target_is_invisible_to_the_auc_and_visible_in_the_bands(
        self,
    ) -> None:
        """The measurement that decided the shape of this guard, kept as a test.

        The generator used to ask for `max(60, min(count, 350))`. MEASURED over the human
        distribution above, that clamp leaves the rank AUC at 0.504 — it is invisible to
        a monotone AUC, because clamping the low tail UP and the high tail DOWN produces
        two rank inversions that cancel. So an AUC at chance is not evidence that the two
        length distributions agree, which is why the criterion is the band table and the
        extremes.

        What the clamp does produce is a band no generated line can reach: 50-59 words is
        HUMAN with certainty (`aiShare` 0.0), a free label for a seventh of the fixture.
        And it caps the generated maximum at the clamp while the human class keeps its
        tail out to 1 774 words.
        """
        clamped = probes.probe_length(
            self._paired_corpus(lambda words: max(60, min(words, 350)))
        )
        self.assertLess(
            abs(clamped["rawWordCountAuc"] - 0.5),
            0.01,
            "the two-sided clamp is invisible to the AUC, which is the finding",
        )
        shares = [band["aiShare"] for band in clamped["bands"]]
        self.assertEqual(shares[0], 0.0, "the lowest band holds no generated line")
        self.assertGreater(shares[1], 0.7, "the clamped lines pile into the next band")
        # The upper clamp does not show up as a class-pure band here — 350 lands on a band
        # edge — so it is checked where it does show: the generated maximum.
        counts = [
            (row["label"], probes.common.word_count(row["text"]))
            for row in self._paired_corpus(lambda words: max(60, min(words, 350)))
        ]
        human_max = max(count for label, count in counts if label == "human")
        ai_max = max(count for label, count in counts if label == "ai")
        self.assertEqual(ai_max, 350)
        self.assertGreater(human_max, ai_max)

    def test_the_matched_target_keeps_the_extremes_of_both_classes_together(
        self,
    ) -> None:
        """The other half of the criterion: the tails, which the band table averages."""
        counts = [
            (row["label"], probes.common.word_count(row["text"]))
            for row in self._paired_corpus(generate_ai.target_word_count)
        ]
        human = sorted(count for label, count in counts if label == "human")
        generated = sorted(count for label, count in counts if label == "ai")
        self.assertEqual(human, generated)
        self.assertEqual(human[0], 50)
        self.assertEqual(human[-1], 1774)


class GeneratedLengthReachesTheProviderTests(unittest.TestCase):
    """The paired length where it is SPENT: the two lanes' call sites and the transport.

    `target_word_count` returning the seed's own count proves nothing about what runs — a
    guard only guards where it is called. MEASURED: with the tests above alone, putting
    the old clamp back on the line inside `main()` left all six of them green. So these
    drive `main()` of the REST lane, `chunk_prompt` of the codex lane, and the transport
    that has to carry a length budget wide enough for the tail.
    """

    # A ilha que a lane gera, e o slate de teste que a serve. O driver passou a gerar para UMA
    # ilha do plano — `--island`, recusado no `type=` do argparse antes de qualquer chamada —,
    # então uma semente fora do bloco dessa ilha é recusada por `recipe_for_island` e um
    # template fora dela nunca é proposto. As sementes deste fixture são escolhidas DENTRO do
    # bloco, e a ilha recebe nomes de `RECIPES` porque o que se mede aqui é o COMPRIMENTO que
    # chega ao provedor, não a decisão de coleta que faz o slate crescer.
    ILHA = "ilha_00"

    def _plano_de_teste(self) -> tuple[dict, ...]:
        import assemble_corpus
        import generate_ai

        receitas = tuple(sorted(generate_ai.RECIPES))[:2]
        return tuple(
            dict(ilha, templates=receitas) if ilha["island"] == self.ILHA else ilha
            for ilha in assemble_corpus.ISLAND_PLAN
        )

    def _humans(self, counts: list[int]) -> list[dict]:
        """Uma semente por comprimento, todas do bloco de `ILHA`.

        O índice não é o do enumerate: é o próximo id cujo bucket é o da ilha. Sem isto a
        maioria das sementes cairia noutras ilhas e a lane geraria menos linhas do que
        `counts` tem, medindo cobertura em vez de comprimento.
        """
        import assemble_corpus

        plano = self._plano_de_teste()
        rows: list[dict] = []
        indice = 0
        for words in counts:
            while True:
                candidato = f"src_h_{indice:04d}"
                indice += 1
                if (
                    assemble_corpus.island_of_seed(plano, candidato)["island"]
                    == self.ILHA
                ):
                    break
            rows.append(
                {
                    "candidateId": candidato,
                    "text": _text(indice, words),
                    "wordCount": words,
                    "domainSource": "ptwiki",
                }
            )
        return rows

    def _drive_rest_lane(
        self, counts: list[int]
    ) -> tuple[list[dict], list[str], list[dict]]:
        """Runs `generate_ai.main()` over `counts`, capturing every REST payload."""
        payloads: list[dict] = []
        answers: list[str] = []

        def fake_http_json(url: str, payload: dict, headers: dict) -> dict:
            payloads.append(payload)
            prompt = payload["contents"][0]["parts"][0]["text"]
            asked = int(re.search(r"aproximadamente (\d+) palavras", prompt).group(1))
            answer = _text(9_000 + asked, asked)
            answers.append(answer)
            return {
                "candidates": [
                    {
                        "content": {"parts": [{"text": answer}]},
                        "finishReason": "STOP",
                    }
                ]
            }

        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            humans = tmp / "humans.jsonl"
            humans.write_bytes(
                "".join(
                    json.dumps(row, ensure_ascii=False) + "\n"
                    for row in self._humans(counts)
                ).encode("utf-8")
            )
            output = tmp / "ai_gemini.jsonl"
            argv = [
                "generate_ai.py",
                "--provider", "gemini",
                "--island", self.ILHA,
                "--humans", str(humans),
                "--output", str(output),
                "--per-provider", str(len(counts)),
                "--sleep", "0",
            ]
            import assemble_corpus

            with mock.patch.object(sys, "argv", argv):
                with mock.patch.object(
                    assemble_corpus, "ISLAND_PLAN", self._plano_de_teste()
                ):
                    with mock.patch.dict(
                        os.environ, {"GEMINI_API_KEY": "chave-de-teste"}
                    ):
                        with mock.patch.object(
                            generate_ai, "http_json", fake_http_json
                        ):
                            generate_ai.main()
            written = [
                json.loads(line)
                for line in output.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
        return payloads, answers, written

    def test_main_asks_the_provider_for_the_seed_length_of_every_pair(self) -> None:
        """The CALL SITE, driven: the prompt that leaves `main()` carries the seed's count."""
        counts = [50, 56, 72, 120, 221, 362, 1774]
        payloads, answers, written = self._drive_rest_lane(counts)
        self.assertEqual(len(payloads), len(counts))
        rows = {row["candidateId"]: row for row in self._humans(counts)}
        asked: list[int] = []
        for payload in payloads:
            prompt = payload["contents"][0]["parts"][0]["text"]
            words = int(
                re.search(r"aproximadamente (\d+) palavras", prompt).group(1)
            )
            asked.append(words)
            seeds = [
                row for row in rows.values() if row["text"][:6000] in prompt
            ]
            self.assertEqual(len(seeds), 1, "the prompt must carry exactly one seed")
            self.assertEqual(
                words,
                seeds[0]["wordCount"],
                "the prompt asked for a length that is not its own seed's",
            )
        self.assertEqual(sorted(asked), sorted(counts))
        # And the pipeline kept what the provider returned, at the length it returned:
        # the written `wordCount` is measured on the answer, not copied from the target.
        self.assertEqual(len(written), len(counts))
        self.assertEqual(
            sorted(row["wordCount"] for row in written),
            sorted(probes.common.word_count(answer) for answer in answers),
        )

    def test_main_aborts_on_a_seed_the_extractor_window_would_have_refused(
        self,
    ) -> None:
        with self.assertRaises(generate_ai.SeedLengthOutOfWindow):
            self._drive_rest_lane([20])

    def test_the_rest_budget_scales_with_the_target_and_never_caps_the_tail(
        self,
    ) -> None:
        """A fixed budget is a clamp on the far side of the transport."""
        seen: dict[str, dict] = {}

        def fake_http_json(url: str, payload: dict, headers: dict) -> dict:
            seen["payload"] = payload
            return {
                "candidates": [
                    {"content": {"parts": [{"text": "texto"}]}, "finishReason": "STOP"}
                ]
            }

        with mock.patch.object(generate_ai, "http_json", fake_http_json):
            text = generate_ai.call_provider(
                "gemini", "m", "prompt", None, {"gemini": "k"}, 1774
            )
        self.assertEqual(text, "texto")
        budget = seen["payload"]["generationConfig"]["maxOutputTokens"]
        self.assertEqual(budget, generate_ai.max_output_tokens(1774))
        # More tokens than the words asked for, and strictly increasing in the target:
        # every count of the measured distribution gets a budget of its own.
        previous = 0
        for words in (50, 56, 72, 120, 221, 362, 1774, generate_ai.MAXIMUM_WORDS):
            current = generate_ai.max_output_tokens(words)
            self.assertGreater(current, words)
            self.assertGreater(current, previous)
            previous = current
        # The constant that used to sit here could not hold the tail of the human class.
        self.assertGreater(generate_ai.max_output_tokens(1774), 1024)

    def test_a_cut_short_rest_answer_is_refused_naming_the_reason(self) -> None:
        for finish in ("MAX_TOKENS", "SAFETY", "RECITATION"):
            with self.subTest(finishReason=finish):

                def fake_http_json(url: str, payload: dict, headers: dict) -> dict:
                    return {
                        "candidates": [
                            {
                                "content": {"parts": [{"text": "metade de um texto"}]},
                                "finishReason": finish,
                            }
                        ]
                    }

                with mock.patch.object(generate_ai, "http_json", fake_http_json):
                    with self.assertRaises(generate_ai.GenerationRefused) as caught:
                        generate_ai.call_provider(
                            "gemini", "m", "prompt", None, {"gemini": "k"}, 800
                        )
                message = str(caught.exception)
                self.assertIn(finish, message)
                self.assertIn("cortado", message)

    def test_a_finished_rest_answer_is_accepted_with_or_without_a_reason(self) -> None:
        for finish in ("STOP", "FINISH_REASON_STOP", None):
            with self.subTest(finishReason=finish):
                candidate: dict = {"content": {"parts": [{"text": "texto inteiro"}]}}
                if finish is not None:
                    candidate["finishReason"] = finish

                def fake_http_json(url: str, payload: dict, headers: dict) -> dict:
                    return {"candidates": [candidate]}

                with mock.patch.object(generate_ai, "http_json", fake_http_json):
                    self.assertEqual(
                        generate_ai.call_provider(
                            "gemini", "m", "prompt", None, {"gemini": "k"}, 800
                        ),
                        "texto inteiro",
                    )

    def test_the_codex_lane_asks_for_the_seed_length_and_refuses_a_clamp(self) -> None:
        """The other driver: `codex_batch` builds its own prompt and had its own clamp.

        `generationLane` is a grouping axis, so a clamp in one lane makes the word count a
        proxy for that lane — and the codex lane is the one carrying the OpenAI families
        reserved for the unseen-generator test.
        """
        counts = [50, 72, 120, 300, 350, 1774]
        prompt = codex_batch.chunk_prompt("original", self._humans(counts))
        items = json.loads(prompt.split("ITENS:\n", 1)[1])
        self.assertEqual([item["targetWords"] for item in items], counts)
        # The same window as the REST lane, from the same function.
        with self.assertRaises(generate_ai.SeedLengthOutOfWindow):
            codex_batch.chunk_prompt("original", self._humans([20]))


class LaneProbeTests(unittest.TestCase):
    """Probe 3 points at the lane with a signature; it decides nothing."""

    def test_a_signed_lane_is_pointed_at_by_name(self) -> None:
        rows: list[dict] = []
        for index in range(20):
            rows.append(
                _record(f"g{index}", "train", "ai", lane="gemini-api", seed=index)
            )
            rows.append(
                _record(
                    f"c{index}", "train", "ai", lane="codex", marker="zumbaia",
                    seed=500 + index,
                )
            )
            rows.append(_record(f"h{index}", "train", "human", seed=900 + index))
        report = probes.probe_lanes(rows)
        self.assertEqual(report["mostSeparableLane"], "codex")
        self.assertGreater(report["mostSeparableAuc"], 0.95)
        self.assertEqual(report["rows"], 40)
        self.assertFalse(report["decides"])
        self.assertNotIn("verdict", report)

    def test_a_lane_thinner_than_the_folds_is_reported_and_not_dropped_in_silence(
        self,
    ) -> None:
        rows = [
            _record(f"g{index}", "train", "ai", lane="gemini-api", seed=index)
            for index in range(20)
        ]
        rows += [
            _record(f"a{index}", "train", "ai", lane="agy", seed=300 + index)
            for index in range(20)
        ]
        rows += [
            _record(f"c{index}", "train", "ai", lane="codex", seed=700 + index)
            for index in range(3)
        ]
        report = probes.probe_lanes(rows)
        self.assertEqual(report["lanesNotProbed"], {"codex": 3})
        self.assertEqual(report["rowsWithoutALane"], 0)

    def test_a_pool_row_whose_provider_is_outside_the_four_lanes_has_no_lane(
        self,
    ) -> None:
        """`--provider` refuses these at the argparse and the assembly drops them.

        The count is reported so a non-zero value over an ASSEMBLED corpus is visible;
        over the pools it is the rows the assembly already refuses in `UnmappableLane`.
        """
        self.assertIsNone(
            probes._lane_of_row({"label": "ai", "meta": {"provider": "openai"}})
        )
        self.assertEqual(
            probes._lane_of_row({"label": "ai", "meta": {"provider": "gemini"}}),
            "gemini-api",
        )


class StylometryProbeTests(unittest.TestCase):
    """Probe 4 publishes coefficients, which is why it is a linear model."""

    def _corpus(self) -> list[dict]:
        rows: list[dict] = []
        for index in range(25):
            rows.append(_record(f"h{index}", "train", "human", seed=index))
            rows.append(
                _record(
                    f"a{index}",
                    "train",
                    "ai",
                    text=(
                        "Em um mundo cada vez mais digital, "
                        + _text(500 + index, 60)
                        + " Portanto, em suma, por fim, concluindo."
                    ),
                    seed=500 + index,
                )
            )
        rows.append(_record("h_dev", "dev", "human", seed=77))
        rows.append(_record("a_dev", "dev", "ai", seed=78))
        return rows

    def test_the_coefficients_are_byte_identical_across_runs_with_the_pinned_seed(
        self,
    ) -> None:
        rows = self._corpus()
        first = probes.probe_stylometry(rows)
        second = probes.probe_stylometry(rows)
        self.assertEqual(
            json.dumps(first["coefficients"]), json.dumps(second["coefficients"])
        )
        self.assertEqual(first["intercept"], second["intercept"])
        self.assertEqual(first["auc"], second["auc"])
        self.assertEqual(first["seed"], probes.PROBE_SEED)

    def test_every_registered_feature_gets_a_coefficient_with_a_direction(self) -> None:
        report = probes.probe_stylometry(self._corpus())
        self.assertEqual(
            sorted(entry["feature"] for entry in report["coefficients"]),
            sorted(probes.STYLOMETRIC_FEATURES),
        )
        self.assertEqual(len(probes.STYLOMETRIC_FEATURES), 19)
        # Ordered by absolute size: the table is read top-down.
        magnitudes = [abs(entry["coefficient"]) for entry in report["coefficients"]]
        self.assertEqual(magnitudes, sorted(magnitudes, reverse=True))
        self.assertFalse(report["decides"])
        self.assertNotIn("verdict", report)

    def test_the_stylometric_rows_are_train_and_dev_and_never_cal_a(self) -> None:
        rows = _five_partition_corpus()
        selected = probes.stylometry_rows(rows)
        self.assertEqual(
            sorted({probes.partition_of(row) for row in selected}), ["dev", "train"]
        )
        self.assertEqual(len(selected), 55)

    def test_permutation_importance_is_available_beside_the_coefficients(self) -> None:
        report = probes.probe_stylometry(self._corpus(), permutation_repeats=3)
        self.assertEqual(
            sorted(entry["feature"] for entry in report["permutationImportance"]),
            sorted(probes.STYLOMETRIC_FEATURES),
        )

    def test_mtld_survives_a_length_difference_that_ttr_does_not(self) -> None:
        """The reason both are published: TTR is length-dependent and MTLD is not."""
        short = _text(1, 60)
        long = _text(1, 60) + " " + _text(2, 300)
        self.assertGreater(
            probes.type_token_ratio(short), probes.type_token_ratio(long)
        )
        self.assertLess(
            abs(probes.mtld(short) - probes.mtld(long)) / probes.mtld(short), 0.5
        )

    def test_the_dash_rate_ignores_the_hyphen_inside_a_pt_br_compound(self) -> None:
        """`palavras-chave` is one word and its hyphen is orthography, not punctuation."""
        self.assertEqual(probes.dash_rate("as palavras-chave do texto agora"), 0.0)
        self.assertGreater(probes.dash_rate("as palavras — chave do texto agora"), 0.0)


class SpellingBiasIsolationTests(unittest.TestCase):
    """The spelling-error rate is measured and may never reach a score."""

    def test_the_measure_reports_and_is_not_registered_as_a_feature(self) -> None:
        self.assertEqual(
            list(probes.SPELLING_BIAS_MEASURES), ["spelling-error-rate"]
        )
        self.assertNotIn("spelling-error-rate", probes.STYLOMETRIC_FEATURES)
        self.assertGreater(
            probes.spelling_error_rate("nao sei se voce viu, mas concerteza foi ele"),
            0.0,
        )
        self.assertEqual(
            probes.spelling_error_rate("não sei se você viu, mas com certeza foi ele"),
            0.0,
        )

    # Correctly spelled pt-BR words that an unaccented-shape list is tempted to swallow.
    # `ate` is the subjunctive of *atar*, `quiz` a current loanword, `quis`/`para`/`mais`
    # ordinary vocabulary. Counting any of them turns a correct sentence into an error.
    CORRECT_PT_BR_WORDS = (
        "esta",
        "publico",
        "pos",
        "so",
        "e",
        "a",
        "ate",
        "quiz",
        "quis",
        "para",
        "mais",
        "sede",
        "seria",
        "cara",
        "duvida",
        "sabia",
    )

    def test_no_correctly_spelled_word_is_counted_as_an_error(self) -> None:
        """DERIVED from the shapes, not from a list of the ones already excluded.

        The earlier version iterated six words the author had already left out, so it
        passed green while `\\bate\\b` and `\\bquiz\\b` sat in the list. Here every shape
        is matched against the vocabulary: a correct word entering
        `PT_BR_SPELLING_SHAPES` is caught wherever in the list it is added.
        """
        for word in self.CORRECT_PT_BR_WORDS:
            with self.subTest(word=word):
                matched = [
                    shape
                    for shape, pattern in zip(
                        probes.PT_BR_SPELLING_SHAPES, probes._SPELLING
                    )
                    if pattern.search(word)
                ]
                self.assertEqual(
                    matched,
                    [],
                    f"{word!r} is correct pt-BR and is matched by {matched}",
                )
                self.assertEqual(probes.spelling_error_rate(word), 0.0)
        self.assertEqual(
            probes.spelling_error_rate(
                "esta casa publico o texto pos a reforma, e ate quis mais"
            ),
            0.0,
        )
        # The two the exclusion cost, kept visible: the shapes they belonged to are gone,
        # so their accented forms are no longer measurable at all.
        self.assertEqual(probes.spelling_error_rate("ate o sapato com o cordao"), 0.0)
        self.assertEqual(probes.spelling_error_rate("o quiz de ontem foi longo"), 0.0)

    def test_the_bias_measure_is_reported_beside_the_coefficients_and_flagged(
        self,
    ) -> None:
        rows = [
            _record(f"h{index}", "train", "human", seed=index) for index in range(20)
        ] + [_record(f"a{index}", "train", "ai", seed=500 + index) for index in range(20)]
        report = probes.probe_stylometry(rows)
        measured = report["biasMeasures"]["spelling-error-rate"]
        self.assertFalse(measured["isFeature"])
        self.assertIn("human", measured)
        self.assertIn("ai", measured)
        self.assertNotIn(
            "spelling-error-rate",
            [entry["feature"] for entry in report["coefficients"]],
        )

    def test_registering_the_bias_measure_as_a_feature_refuses_before_any_fit(
        self,
    ) -> None:
        """THE mutation this guard exists for: turning the feature on.

        Registered under its own NAME here and under a fresh name below, because a name
        check and an identity check each let one of the two through.
        """
        original = dict(probes.STYLOMETRIC_FEATURES)
        try:
            probes.STYLOMETRIC_FEATURES["spelling-error-rate"] = (
                probes.spelling_error_rate
            )
            with self.assertRaises(probes.BiasMeasureReachedTheFeatures) as caught:
                probes.feature_matrix(["nao sei se voce viu"])
            self.assertIn("spelling-error-rate", str(caught.exception))
            self.assertIn("non-native writing", str(caught.exception))
        finally:
            probes.STYLOMETRIC_FEATURES.clear()
            probes.STYLOMETRIC_FEATURES.update(original)

    def test_registering_the_same_callable_under_another_name_is_also_refused(
        self,
    ) -> None:
        original = dict(probes.STYLOMETRIC_FEATURES)
        try:
            probes.STYLOMETRIC_FEATURES["typo-density"] = probes.spelling_error_rate
            with self.assertRaises(probes.BiasMeasureReachedTheFeatures) as caught:
                probes.feature_row("nao sei se voce viu")
            self.assertIn("typo-density", str(caught.exception))
        finally:
            probes.STYLOMETRIC_FEATURES.clear()
            probes.STYLOMETRIC_FEATURES.update(original)

    def test_the_guard_runs_on_the_matrix_path_and_not_only_in_a_test(self) -> None:
        """Deleting the call from `feature_matrix` has to be what turns red.

        Driven through the PRODUCTION entry points (`feature_matrix`, `feature_row`) with
        the registry mutated, so a guard moved out of the score path fails here.
        """
        source = (LAB / "diagnostic_probes.py").read_text(encoding="utf-8")
        for function in ("def feature_row(", "def feature_matrix("):
            body = source.split(function, 1)[1].split("\ndef ", 1)[0]
            with self.subTest(function=function):
                self.assertIn(
                    "assert_no_bias_measure_reaches_the_features()", body
                )


class GovernanceTests(unittest.TestCase):
    """Only probe 1 decides, and no probe spends a share of the familial alpha."""

    def test_the_probe_significance_is_not_a_share_of_the_familial_alpha(self) -> None:
        policy = json.loads(
            (BENCHMARK / "preregistration-v4.json").read_text(encoding="utf-8")
        )
        multiplicity = policy["multiplicity"]
        self.assertNotEqual(
            probes.PARTITION_PREDICTABILITY_SIGNIFICANCE,
            multiplicity["perHypothesisAlpha"],
        )
        self.assertNotEqual(
            probes.PARTITION_PREDICTABILITY_SIGNIFICANCE, multiplicity["familyAlpha"]
        )
        # And no probe may READ the family: a probe wired to the familial alpha would
        # change `m`, which is the operator's decision.
        source = (LAB / "diagnostic_probes.py").read_text(encoding="utf-8")
        for field in ("perHypothesisAlpha", "familyAlpha", "primaryFamily"):
            with self.subTest(field=field):
                self.assertNotIn(f'"{field}"', source)
                self.assertNotIn(f"['{field}']", source)

    def test_exactly_one_probe_declares_that_it_decides(self) -> None:
        rows = _five_partition_corpus()
        deciding = {
            "partitionExchangeability": probes.probe_partitions(rows),
        }
        reporting = {
            "classFromLength": probes.probe_length(rows),
            "laneWithinAi": probes.probe_lanes(rows),
            "stylometry": probes.probe_stylometry(probes.stylometry_rows(rows)),
        }
        for name, report in deciding.items():
            with self.subTest(probe=name):
                self.assertTrue(report["decides"])
                self.assertIn("verdict", report)
        for name, report in reporting.items():
            with self.subTest(probe=name):
                self.assertFalse(report["decides"])
                self.assertNotIn("verdict", report)


class CrossLanguagePinTests(unittest.TestCase):
    """Every constant mirrored from the TypeScript side, pinned against its source."""

    def test_the_blind_partitions_mirror_the_cluster_exposure_ledger(self) -> None:
        source = (BENCHMARK / "cluster-exposure-ledger.ts").read_text(encoding="utf-8")
        declared = source.split(
            "export const BLIND_PARTITIONS: readonly LedgerPartition[] = [", 1
        )[1].split("]", 1)[0]
        self.assertEqual(
            list(probes.BLIND_PARTITIONS), re.findall(r'"([\w-]+)"', declared)
        )

    def test_the_open_partitions_are_the_five_minus_the_blind_two(self) -> None:
        self.assertEqual(
            set(probes.OPEN_PARTITIONS) | set(probes.BLIND_PARTITIONS),
            set(assemble_corpus.BLOCK_TIME),
        )
        self.assertEqual(
            set(probes.OPEN_PARTITIONS) & set(probes.BLIND_PARTITIONS), set()
        )
        self.assertEqual(list(probes.OPEN_PARTITIONS), ["train", "dev", "cal-A"])

    def test_the_window_plan_is_read_from_the_sealed_manifest(self) -> None:
        manifest = json.loads(
            (
                REPO / "models" / "cleanfeed-ptbr-v1" / "cleanfeed-model.json"
            ).read_text(encoding="utf-8")
        )
        self.assertEqual(probes.sealed_window_plan(), manifest["windowing"])

    def test_the_tiling_mirrors_build_content_windows(self) -> None:
        """The stride loop of `src/inference/chunker.ts`, on the values it is fed."""
        plan = probes.sealed_window_plan()
        content = int(plan["contentTokens"])
        overlap = int(plan["overlapTokens"])
        step = content - overlap
        self.assertEqual(probes.content_windows(0, content, overlap), [])
        self.assertEqual(
            probes.content_windows(10, content, overlap), [(0, 0, 10)]
        )
        self.assertEqual(
            probes.content_windows(content, content, overlap), [(0, 0, content)]
        )
        self.assertEqual(
            probes.content_windows(content + 1, content, overlap),
            [(0, 0, content), (1, step, content + 1)],
        )

        # THE STOP CONDITION, which none of the assertions above reach. `content + 1`
        # terminates on the loop guard (`start < total`) whether or not the early break
        # exists, so it is not a witness. A witness needs a total that a window ends
        # exactly on WHILE the next start is still inside the document — then the break is
        # the only thing between the caller and a further window nested in the last one.
        boundary = 2 * step + 1
        self.assertLessEqual(boundary, step + content, "the witness needs two windows")
        self.assertEqual(
            probes.content_windows(boundary, content, overlap),
            [(0, 0, content), (1, step, boundary)],
        )
        # The same shape on small values, so the arithmetic is readable: without the break
        # a third window `(2, 12, 13)` appears, one token long and inside the second.
        self.assertEqual(probes.content_windows(13, 10, 4), [(0, 0, 10), (1, 6, 13)])

        source = (REPO / "src" / "inference" / "chunker.ts").read_text(encoding="utf-8")
        self.assertIn("plan.contentTokens - plan.overlapTokens", source)
        self.assertIn("Math.min(start + plan.contentTokens, totalTokenCount)", source)
        self.assertIn("if (end === totalTokenCount)", source)

    def test_the_selection_mirrors_distributed_indices_including_the_rounding(
        self,
    ) -> None:
        """JavaScript rounds halves UP and Python's `round` rounds them to EVEN.

        The two disagree only on a half whose floor is even, so `1.5` is not a witness
        (both give 2) and `2.5` is: `Math.round(2.5)` is 3 and `round(2.5)` is 2. Six
        candidates into three slots lands exactly there — `1 * 5 / 2` — which is why that
        pair is asserted by value.
        """
        self.assertEqual(probes.distributed_indices(0, 8), [])
        self.assertEqual(probes.distributed_indices(5, 8), [0, 1, 2, 3, 4])
        self.assertEqual(probes.distributed_indices(20, 8), [0, 3, 5, 8, 11, 14, 16, 19])
        self.assertEqual(probes.distributed_indices(3, 2), [0, 2])
        self.assertEqual(probes.distributed_indices(2, 1), [0])
        self.assertEqual(probes.distributed_indices(4, 3), [0, 2, 3])
        # The half that Python's banker's rounding sends the other way: 2.5 -> 2, not 3.
        self.assertEqual(probes.distributed_indices(6, 3), [0, 3, 5])
        self.assertEqual(probes.distributed_indices(10, 5), [0, 2, 5, 7, 9])
        source = (REPO / "src" / "inference" / "chunker.ts").read_text(encoding="utf-8")
        self.assertIn("Math.round((i * (total - 1)) / (limit - 1))", source)


class WindowDispersionTests(unittest.TestCase):
    """The dispersion is computed over REAL windows of the document."""

    def _long_text(self, tokens: int) -> str:
        rng = random.Random(7)
        return " ".join(rng.choice(_VOCABULARY) for _ in range(tokens))

    def test_the_windows_come_from_tiling_the_real_text_and_not_from_a_placeholder(
        self,
    ) -> None:
        plan = probes.sealed_window_plan()
        text = self._long_text(1_200)
        slices = probes.window_texts(text, plan)
        self.assertEqual(len(slices), 3)
        self.assertEqual(
            [len(slice_.split()) for slice_ in slices],
            [510, 510, 1_200 - (510 - 64) * 2],
        )
        # The tiling covers the document from its first token to its last, which a
        # placeholder that returns `[text]` or a fixed list cannot do.
        self.assertTrue(text.startswith(slices[0].split(" ", 1)[0]))
        self.assertTrue(text.endswith(slices[-1].rsplit(" ", 1)[-1]))
        self.assertEqual(
            slices[1].split()[:64], slices[0].split()[510 - 64 :]
        )
        measured = probes.window_dispersion(text, lambda _: 0.5, plan)
        self.assertEqual(measured["windows"], len(slices))

    def test_a_short_document_yields_one_window_and_a_spread_of_zero_by_arithmetic(
        self,
    ) -> None:
        plan = probes.sealed_window_plan()
        measured = probes.window_dispersion(self._long_text(80), lambda _: 0.9, plan)
        self.assertEqual(measured["windows"], 1)
        self.assertEqual(measured["spread"], 0.0)
        self.assertEqual(measured["mean"], 0.9)

    def test_a_document_whose_halves_disagree_shows_the_spread_a_uniform_one_does_not(
        self,
    ) -> None:
        plan = probes.sealed_window_plan()

        def score(slice_: str) -> float:
            return 1.0 if "zumbaia" in slice_ else 0.0

        uniform = self._long_text(1_200)
        # The marker in the LAST 500 tokens only: with a 510/64 tiling that is the third
        # window and part of the second, so the windows disagree the way a mixed document's
        # do.
        mixed = " ".join(uniform.split()[:700] + ["zumbaia"] * 500)
        self.assertEqual(probes.window_dispersion(uniform, score, plan)["spread"], 0.0)
        self.assertEqual(probes.window_dispersion(mixed, score, plan)["spread"], 1.0)

        report = probes.probe_window_dispersion(
            [
                {"label": "human", "text": uniform},
                {"label": "ai", "text": " ".join(["zumbaia"] * 1_200)},
                {"label": "mixed", "text": mixed},
            ],
            score,
            plan,
        )
        self.assertEqual(report["classes"]["mixed"]["meanSpread"], 1.0)
        self.assertEqual(report["classes"]["human"]["meanSpread"], 0.0)
        self.assertEqual(report["classes"]["ai"]["meanSpread"], 0.0)
        self.assertFalse(report["decides"])
        self.assertNotIn("verdict", report)

    def test_single_window_documents_are_counted_apart_from_the_means(self) -> None:
        plan = probes.sealed_window_plan()
        report = probes.probe_window_dispersion(
            [
                {"label": "human", "text": self._long_text(80)},
                {"label": "human", "text": self._long_text(1_200)},
            ],
            lambda _: 0.5,
            plan,
        )
        self.assertEqual(report["singleWindowDocuments"], {"human": 1})
        self.assertEqual(report["classes"]["human"]["documents"], 1)


class CharacterNgramBaselineTests(unittest.TestCase):
    """D19: the baseline is a LEAKAGE detector, and character n-grams see typography."""

    @staticmethod
    def _emphasize(text: str) -> str:
        """The typographic mark and nothing else: `**` around every longer word.

        `**palavra**` and `palavra` produce the SAME token under the word analyzer's
        default pattern, so the mark is invisible to the word vectorization and lands
        squarely inside a character 3- to 6-gram (`**p`, `a**`).
        """
        return re.sub(r"\b(\w{6,})\b", r"**\1**", text)

    def _typographic_only_corpus(self) -> tuple[np.ndarray, np.ndarray]:
        """Two classes from ONE vocabulary at ONE length, differing only in markup.

        UNPAIRED on purpose: pairing each marked text with its own plain twin puts a
        SECOND signal in the fixture — document identity — and that one the word
        vectorization can memorize, in the wrong direction (the paired test below).
        """
        texts = [_text(index, 80) for index in range(30)]
        texts += [self._emphasize(_text(500 + index, 80)) for index in range(30)]
        return np.array(texts, dtype=object), np.array([0] * 30 + [1] * 30)

    def test_the_word_analyzer_cannot_see_the_mark_the_character_analyzer_reads(
        self,
    ) -> None:
        """The noise-free half of the claim: the two token streams are IDENTICAL.

        An AUC over 60 short documents carries sampling noise of a few hundredths either
        way; the token streams do not. This is what "the word n-gram walks past it" means
        exactly, and the AUC test below is the consequence rather than the evidence.
        """
        plain = _text(3, 80)
        marked = self._emphasize(plain)
        self.assertNotEqual(plain, marked)
        word_analyzer = baseline_tfidf.word_pipeline()[0].build_analyzer()
        self.assertEqual(word_analyzer(plain), word_analyzer(marked))
        char_analyzer = baseline_tfidf.char_pipeline()[0].build_analyzer()
        added = set(char_analyzer(marked)) - set(char_analyzer(plain))
        self.assertNotEqual(added, set())
        # `**` alone is two characters and the range starts at three, so the evidence is
        # an n-gram that carries the mark ACROSS the word boundary — which is exactly what
        # `char_wb` would have confined away.
        self.assertIn("** ", added)
        self.assertIn(" **", added)

    def test_word_ngrams_do_not_separate_where_character_ngrams_do(self) -> None:
        texts, labels = self._typographic_only_corpus()
        word = float(
            np.mean(
                baseline_tfidf.cross_validated_aucs(
                    texts, labels, baseline_tfidf.word_pipeline
                )
            )
        )
        char = float(
            np.mean(
                baseline_tfidf.cross_validated_aucs(
                    texts, labels, baseline_tfidf.char_pipeline
                )
            )
        )
        # A one-sided floor and not a band around 0.5: the word vectorization has no
        # information about the class here, so where its AUC lands BELOW chance is
        # sampling noise over 60 short documents, and asserting a two-sided band would be
        # asserting the noise.
        self.assertLess(word, 0.65, f"word AUC {word:.4f} separated the classes")
        self.assertGreater(char, 0.95, f"char AUC {char:.4f} did not separate")

    def test_a_topic_paired_fixture_drives_the_word_baseline_below_chance(self) -> None:
        """MEASURED, and it matters because the pilot corpus IS topic-paired.

        When every generated text is the marked twin of a human one, the two are the same
        point in word space carrying opposite labels. Out of fold the model has seen the
        twin and predicts the twin's label, so the word AUC lands far BELOW 0.5 — which is
        memorization of the pair and not a signal about the class. Reading a below-chance
        word AUC as "no artifact here" is the mistake this asserts against.
        """
        texts: list[str] = []
        labels: list[int] = []
        for index in range(30):
            plain = _text(index, 80)
            texts += [plain, self._emphasize(plain)]
            labels += [0, 1]
        word = float(
            np.mean(
                baseline_tfidf.cross_validated_aucs(
                    np.array(texts, dtype=object),
                    np.array(labels),
                    baseline_tfidf.word_pipeline,
                )
            )
        )
        char = float(
            np.mean(
                baseline_tfidf.cross_validated_aucs(
                    np.array(texts, dtype=object),
                    np.array(labels),
                    baseline_tfidf.char_pipeline,
                )
            )
        )
        self.assertLess(word, 0.2, f"word AUC {word:.4f} did not invert")
        self.assertGreater(char, 0.95, f"char AUC {char:.4f} did not separate")

    def test_every_vectorization_is_registered_so_none_can_run_alone(self) -> None:
        # Five: word alone is the D19 reading this registry exists to prevent; word plus char
        # without the function-word branch is the reading that cannot tell separation from
        # subject matter; and the UNION without its two branches is the reading that credits
        # function words with a separation the stylometric branch carries.
        self.assertEqual(
            list(baseline_tfidf.VECTORIZATIONS),
            [
                "word(1,2)",
                "char(3,6)",
                "funcionais",
                "estilometria",
                "funcionais+estilometria",
            ],
        )
        self.assertEqual(baseline_tfidf.WORD_NGRAMS, (1, 2))
        self.assertEqual(baseline_tfidf.CHAR_NGRAMS, (3, 6))
        self.assertEqual(baseline_tfidf.FUNCTION_WORD_NGRAMS, (1, 1))
        self.assertEqual(baseline_tfidf.FUNCTION_WORD_TOKEN_PATTERN, r"(?u)\b\w+\b")

    def test_the_character_analyzer_crosses_word_boundaries(self) -> None:
        """`char_wb` would confine the n-grams inside words, where the marks are not."""
        vectorizer = baseline_tfidf.char_pipeline()[0]
        self.assertEqual(vectorizer.analyzer, "char")
        self.assertIn("** ", vectorizer.build_analyzer()("a **b** c"))


class RankAucTests(unittest.TestCase):
    def test_the_auc_is_the_mann_whitney_statistic_with_ties_averaged(self) -> None:
        self.assertEqual(probes.rank_auc([1.0, 2.0], [False, True]), 1.0)
        self.assertEqual(probes.rank_auc([2.0, 1.0], [False, True]), 0.0)
        self.assertEqual(probes.rank_auc([1.0, 1.0], [False, True]), 0.5)
        self.assertEqual(
            probes.rank_auc([1.0, 1.0, 2.0, 3.0], [False, True, False, True]), 0.625
        )

    def test_the_auc_agrees_with_sklearn_on_a_tied_vector(self) -> None:
        from sklearn.metrics import roc_auc_score

        rng = random.Random(11)
        scores = [rng.choice([0.1, 0.2, 0.2, 0.3]) for _ in range(200)]
        positive = [rng.random() < 0.4 for _ in range(200)]
        self.assertAlmostEqual(
            probes.rank_auc(scores, positive),
            roc_auc_score([int(flag) for flag in positive], scores),
            places=12,
        )

    def test_the_null_p_value_is_one_sided_and_uncorrected_for_ties(self) -> None:
        self.assertAlmostEqual(probes.auc_p_value(0.5, 100, 100), 0.5, places=12)
        self.assertLess(probes.auc_p_value(0.9, 100, 100), 1e-9)
        self.assertGreater(probes.auc_p_value(0.6, 5, 5), 0.1)
        # The tie correction only shrinks the variance, so the uncorrected p-value is the
        # larger one and the probe refuses LESS often than the exact test would.
        self.assertGreater(
            probes.auc_p_value(0.7, 10, 10), probes.auc_p_value(0.7, 40, 40)
        )

    def test_an_auc_needs_both_classes(self) -> None:
        with self.assertRaises(probes.NotEnoughRowsToProbe) as caught:
            probes.rank_auc([1.0, 2.0], [True, True])
        self.assertIn("0 negative", str(caught.exception))


class PoolAdapterTests(unittest.TestCase):
    """The pools, and WHICH of them a run read."""

    def setUp(self) -> None:
        self.candidates = LAB / "_probe_pool_fixture"
        self.candidates.mkdir(exist_ok=True)
        self._write("wikipedia_fresh.jsonl", "h", 0, 3, "ptwiki_lead", {})
        self._write("ai_fresh_agy.jsonl", "a", 100, 3, "ai_agy", {"provider": "agy"})
        # Out of frame, and the reason `names` is not housekeeping: Stack Overflow is
        # blocked by name (F0-6) and would otherwise be read as `human` by this adapter.
        self._write("ptso.jsonl", "s", 200, 4, "ptso_answer", {})
        (self.candidates / "_ignored.jsonl").write_bytes(b"{}\n")

    def tearDown(self) -> None:
        for path in self.candidates.glob("*"):
            path.unlink()
        self.candidates.rmdir()

    def _write(
        self,
        name: str,
        prefix: str,
        seed: int,
        count: int,
        domain_source: str,
        meta: dict,
    ) -> None:
        (self.candidates / name).write_bytes(
            b"".join(
                (
                    json.dumps(
                        {
                            "candidateId": f"{prefix}{index}",
                            "text": _text(seed + index, 60),
                            "domainSource": domain_source,
                            "meta": meta,
                        },
                        ensure_ascii=False,
                    )
                    + "\n"
                ).encode("utf-8")
                for index in range(count)
            )
        )

    def test_pool_rows_carry_class_lane_and_text_but_no_partition(self) -> None:
        rows = probes.rows_from_pools(self.candidates)
        self.assertTrue(all("createdAt" not in row for row in rows))
        with self.assertRaises(probes.CorpusIsNotStamped):
            probes.probe_partitions(rows)

    def test_the_file_selection_is_honoured_and_is_what_keeps_a_run_in_frame(
        self,
    ) -> None:
        """`names` selects, and a run that ignores it silently measures another population.

        The unselected file here is `ptso.jsonl` — blocked by name by F0-6 — and this
        adapter would label it `human`, so ignoring the argument does not fail loudly: it
        publishes the stylometry of a population the claim does not name.
        """
        every = probes.rows_from_pools(self.candidates)
        self.assertEqual(len(every), 10)
        self.assertEqual(
            sorted(row["label"] for row in every),
            ["ai"] * 3 + ["human"] * 7,
        )

        selected = probes.rows_from_pools(
            self.candidates, ("wikipedia_fresh.jsonl", "ai_fresh_agy.jsonl")
        )
        self.assertEqual(len(selected), 6)
        self.assertEqual(
            sorted(row["label"] for row in selected), ["ai"] * 3 + ["human"] * 3
        )
        self.assertEqual(
            {row["poolFile"] for row in selected},
            {"wikipedia_fresh.jsonl", "ai_fresh_agy.jsonl"},
        )
        self.assertNotIn("ptso.jsonl", {row["poolFile"] for row in selected})

        # A name nobody wrote selects nothing rather than everything.
        self.assertEqual(probes.rows_from_pools(self.candidates, ("absent.jsonl",)), [])

    def test_the_report_names_the_material_it_was_computed_over(self) -> None:
        """Provenance in the ARTIFACT, not only in the runbook.

        "In frame" is a claim about the input, and a reader holding the JSON has no other
        way to check it. Per file and not just a total, because a total is reproducible by
        a dozen different selections.
        """
        rows = probes.rows_from_pools(
            self.candidates, ("wikipedia_fresh.jsonl", "ai_fresh_agy.jsonl")
        )
        provenance = probes.input_provenance(rows)
        self.assertEqual(
            provenance,
            {
                "rows": 6,
                "files": 2,
                "rowsPerFile": {
                    "ai_fresh_agy.jsonl": 3,
                    "wikipedia_fresh.jsonl": 3,
                },
            },
        )
        # An assembled corpus carries no pool file, and the key stays present: an absent
        # key would read as "not measured" instead of "read from a corpus".
        assembled = probes.input_provenance(
            [_record(f"h{index}", "train", seed=index) for index in range(2)]
        )
        self.assertEqual(assembled["files"], 1)
        self.assertEqual(
            assembled["rowsPerFile"], {probes.ASSEMBLED_INPUT: 2}
        )

    def test_the_in_frame_selection_is_the_nine_files_the_published_rates_came_from(
        self,
    ) -> None:
        """The recipe as a constant, because it was recorded as prose once and was wrong.

        Bare `--pools` reads the whole directory. Every name absent from this tuple is
        absent for a reason the plan states, so a name added here without one is the thing
        this assertion exists to make visible.
        """
        self.assertEqual(len(probes.IN_FRAME_POOLS), 9)
        self.assertEqual(len(set(probes.IN_FRAME_POOLS)), 9)
        self.assertEqual(
            probes.IN_FRAME_POOLS[0],
            "wikipedia_fresh.jsonl",
            "the one human pool of the one published cell",
        )
        self.assertEqual(
            sum(1 for name in probes.IN_FRAME_POOLS if name.startswith("ai_fresh_")), 6
        )
        self.assertEqual(
            sum(1 for name in probes.IN_FRAME_POOLS if name.startswith("mixed_")), 2
        )
        for blocked in ("ptso.jsonl", "ptso_fresh.jsonl"):
            with self.subTest(blocked=blocked):
                self.assertNotIn(blocked, probes.IN_FRAME_POOLS)
        for reserved in ("ai_openai.jsonl", "ai_public_madras.jsonl"):
            with self.subTest(reserved=reserved):
                self.assertNotIn(reserved, probes.IN_FRAME_POOLS)
        for out_of_frame in ("carolina.jsonl", "carolina_fresh.jsonl", "b2w_fresh.jsonl"):
            with self.subTest(out_of_frame=out_of_frame):
                self.assertNotIn(out_of_frame, probes.IN_FRAME_POOLS)
        # `wikipedia.jsonl` is the pre-frame dump and `wikipedia_fresh.jsonl` the framed
        # one: an exact-name check, since one is a prefix of the other.
        self.assertNotIn("wikipedia.jsonl", probes.IN_FRAME_POOLS)


if __name__ == "__main__":
    unittest.main()
