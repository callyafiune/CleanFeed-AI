"""The four theme-dependence instruments: what each one decides, and what none of them may.

Run: py -3.13 -m pytest test_theme_dependence.py -q
"""

from __future__ import annotations

import json
import random
import tempfile
import unittest
from pathlib import Path

import numpy as np

import baseline_tfidf as baseline
import diagnostic_probes as probes
import entity_masking as masking

LAB = Path(__file__).resolve().parent
BENCHMARK = LAB.parent


# --- instrument 1: entity masking -------------------------------------------


class EntityMaskingFindsWhatItClaims(unittest.TestCase):
    def test_masks_mid_sentence_capitals_numerals_and_dates(self) -> None:
        text = (
            "O Alentejo Central é uma sub-região portuguesa com 166 mil habitantes. "
            "Foi criada em 12 de março de 1998 pelo Instituto Nacional de Estatística."
        )
        result = masking.mask_entities(text)
        self.assertNotIn("Alentejo", result.text)
        self.assertNotIn("Instituto", result.text)
        self.assertNotIn("166", result.text)
        self.assertNotIn("1998", result.text)
        self.assertEqual(result.categories.get("date"), 1)
        self.assertGreaterEqual(result.categories.get("entity", 0), 2)
        self.assertGreaterEqual(result.categories.get("number", 0), 1)
        # The sentence boundaries survive: the masked arm must differ from the original in
        # entities and NOT in punctuation, or a score delta cannot be attributed.
        self.assertEqual(text.count("."), result.text.count("."))

    def test_recovers_a_sentence_opening_entity_evidenced_mid_sentence(self) -> None:
        # `Brasil` opens the second sentence AND appears mid-sentence in the first, so the
        # form is evidenced as a proper noun and both occurrences go.
        text = "A capital do Brasil é planejada. Brasil tem muitos municípios."
        result = masking.mask_entities(text)
        self.assertNotIn("Brasil", result.text)

    def test_leaves_an_unevidenced_sentence_opening_capital_alone(self) -> None:
        # The known UNDER-MASK, asserted so it is a measured property and not a surprise:
        # a capital that only ever opens a sentence is indistinguishable from a proper
        # noun by case alone, and leaving it can only push a verdict toward `survives`.
        text = "Muitos municípios existem. Eles crescem devagar."
        result = masking.mask_entities(text)
        self.assertIn("Muitos", result.text)
        self.assertIn("Eles", result.text)

    def test_a_text_too_poor_in_common_words_reports_the_placebo_shortfall(self) -> None:
        # Entity-dense and common-word-poor: the placebo cannot find eligible runs for every
        # requested length, and what it could not serve is the number that says the excess is
        # overstated. MEASURED on the 2026-08-07 sample: 5 of the 60 human rows had a
        # shortfall, one of them 23 words against 23 entity spans.
        text = (
            "Alentejo Central Portugal Lisboa Évora Beja Setúbal Faro Porto Braga. "
            "Coimbra Aveiro Leiria Viseu Guarda Santarém Tomar Sintra Cascais Oeiras."
        )
        entity = masking.mask_entities(text)
        placebo = masking.mask_placebo(
            text, [span.words for span in entity.spans], entity_spans=entity.spans
        )
        self.assertGreater(placebo.shortfall, 0)
        self.assertLess(placebo.words_masked, entity.words_masked)
        self.assertEqual(placebo.as_report()["shortfall"], placebo.shortfall)

    def test_the_placebo_matches_span_count_and_run_lengths(self) -> None:
        text = (
            "O Alentejo Central fica em Portugal e tem uma área grande com muitas "
            "cidades pequenas espalhadas pelo campo aberto e pelas serras baixas."
        )
        entity = masking.mask_entities(text)
        placebo = masking.mask_placebo(
            text, [span.words for span in entity.spans], entity_spans=entity.spans
        )
        self.assertEqual(len(placebo.spans), len(entity.spans))
        self.assertEqual(placebo.words_masked, entity.words_masked)
        self.assertEqual(placebo.shortfall, 0)
        # The placebo takes lowercase common words and leaves the entities standing.
        self.assertIn("Alentejo", placebo.text)
        self.assertIn("Portugal", placebo.text)


class MaskingReadsBothDirections(unittest.TestCase):
    """Two fixtures, two scorers, and the same reader — the instrument must answer both."""

    def _rows(self) -> list[dict]:
        rng = random.Random(7)
        entities = ["Alentejo", "Portugal", "Lisboa", "Évora", "Beja"]
        common = "cidade campo serra porto vila ponte estrada escola praca museu".split()
        rows = []
        for index in range(24):
            words = [rng.choice(common) for _ in range(40)]
            for position in range(0, 40, 8):
                words[position] = rng.choice(entities)
            sentences = [
                " ".join(words[start : start + 10]) + "."
                for start in range(0, 40, 10)
            ]
            rows.append(
                {
                    "id": f"row_{index:03d}",
                    "text": " ".join(sentences),
                    "label": 1 if index % 2 else 0,
                }
            )
        return rows

    @staticmethod
    def _entity_scorer(text: str) -> float:
        """Reads the entities and nothing else: masking must destroy this score."""
        words = text.split()
        capitals = sum(1 for word in words if word[:1].isupper())
        return min(1.0, capitals / max(1, len(words)) * 4)

    @staticmethod
    def _structure_scorer(text: str) -> float:
        """Reads sentence length and nothing else: masking must leave this score alone."""
        sentences = [part for part in text.split(".") if part.strip()]
        if not sentences:
            return 0.0
        mean = sum(len(part.split()) for part in sentences) / len(sentences)
        return min(1.0, mean / 20)

    def _read(self, scorer) -> dict:
        rows = self._rows()
        arms = masking.arm_rows(rows)
        scores = {
            arm: {row["id"]: scorer(row["text"]) for row in arms[arm]}
            for arm in masking.ARMS
        }
        labels = {
            str(row["id"]): ("ai" if row["label"] == 1 else "human") for row in rows
        }
        return masking.read_masking(
            scores, labels, arms["_masking"], threshold=0.5
        )

    def test_the_shortfall_of_every_class_reaches_the_published_report(self) -> None:
        report = self._read(self._structure_scorer)
        for wanted in ("ai", "human"):
            measured = report["perClass"][wanted]
            # Present in BOTH classes, including the human one the reading reports beside
            # the verdict: `mask_placebo` computed the shortfall from the start and
            # `read_masking` never read it, so the docstring's "published rather than
            # silently absorbed" was false for a class with a real shortfall.
            self.assertIn("placeboShortfallWords", measured)
            self.assertIn("placeboShortfallRecords", measured)
            self.assertIn("maxPlaceboShortfallWords", measured)
            self.assertGreaterEqual(measured["placeboShortfallWords"], 0)

    def test_a_shortfall_on_one_record_is_summed_into_its_class(self) -> None:
        rows = self._rows()
        arms = masking.arm_rows(rows)
        injected = {
            row_id: {
                "entity": entry["entity"],
                "placebo": {**entry["placebo"], "shortfall": 7},
            }
            for row_id, entry in arms["_masking"].items()
        }
        scores = {
            arm: {row["id"]: self._structure_scorer(row["text"]) for row in arms[arm]}
            for arm in masking.ARMS
        }
        labels = {
            str(row["id"]): ("ai" if row["label"] == 1 else "human") for row in rows
        }
        report = masking.read_masking(scores, labels, injected, threshold=0.5)
        measured = report["perClass"]["ai"]
        self.assertEqual(measured["placeboShortfallWords"], 7 * measured["records"])
        self.assertEqual(measured["placeboShortfallRecords"], measured["records"])
        self.assertEqual(measured["maxPlaceboShortfallWords"], 7)

    def test_collapses_when_the_entities_are_the_signal(self) -> None:
        report = self._read(self._entity_scorer)
        measured = report["perClass"]["ai"]
        self.assertGreater(measured["meanEntityDrop"], measured["meanPlaceboDrop"])
        self.assertGreaterEqual(
            measured["excessMeanDrop"], masking.MASKING_COLLAPSE_EXCESS_MEAN_DROP
        )
        self.assertEqual(report["verdict"], masking.VERDICT_COLLAPSES)

    def test_survives_when_the_entities_are_not_the_signal(self) -> None:
        report = self._read(self._structure_scorer)
        measured = report["perClass"]["ai"]
        # The masking DID bite — the share is published beside the verdict, so a
        # `survives` read off untouched text is visible instead of implied.
        self.assertGreater(measured["meanMaskedWordShare"], 0.05)
        self.assertLess(
            abs(measured["excessMeanDrop"]),
            masking.MASKING_COLLAPSE_EXCESS_MEAN_DROP,
        )
        self.assertEqual(report["verdict"], masking.VERDICT_SURVIVES)


class MaskingCriterionIsPinned(unittest.TestCase):
    def test_the_two_frozen_numbers_and_the_noise_floor_they_clear(self) -> None:
        self.assertEqual(masking.MASKING_COLLAPSE_EXCESS_MEAN_DROP, 0.10)
        self.assertEqual(masking.MASKING_COLLAPSE_EXCESS_FLIP_RATE, 0.20)
        # The floor the thresholds have to clear is the largest delta the int8 parity gate
        # of the anchoring export tolerates. Reading it as an assertion is what stops a
        # threshold from drifting UNDER measurement noise.
        # `assertEqual` and not `assertAlmostEqual`: the default seven places would let the
        # ceiling drift from the eighth decimal on, and this number is a literal copy of
        # `maxAbsDelta` out of the export's parity report.
        self.assertEqual(masking.MASKING_NOISE_CEILING, 0.008950138668296859)
        self.assertGreater(
            masking.MASKING_COLLAPSE_EXCESS_MEAN_DROP,
            10 * masking.MASKING_NOISE_CEILING,
        )

    def test_the_verdict_reads_collapse_exactly_at_each_threshold(self) -> None:
        at_drop = {
            "ai": {
                "excessMeanDrop": masking.MASKING_COLLAPSE_EXCESS_MEAN_DROP,
                "excessFlipRate": 0.0,
            }
        }
        at_flips = {
            "ai": {
                "excessMeanDrop": 0.0,
                "excessFlipRate": masking.MASKING_COLLAPSE_EXCESS_FLIP_RATE,
            }
        }
        below_both = {
            "ai": {
                "excessMeanDrop": masking.MASKING_COLLAPSE_EXCESS_MEAN_DROP - 1e-9,
                "excessFlipRate": masking.MASKING_COLLAPSE_EXCESS_FLIP_RATE - 1e-9,
            }
        }
        self.assertEqual(masking.masking_verdict(at_drop), masking.VERDICT_COLLAPSES)
        self.assertEqual(masking.masking_verdict(at_flips), masking.VERDICT_COLLAPSES)
        self.assertEqual(masking.masking_verdict(below_both), masking.VERDICT_SURVIVES)

    def test_the_verdict_reads_the_ai_class_and_never_the_human_one(self) -> None:
        human_only = {
            "ai": {"excessMeanDrop": 0.0, "excessFlipRate": 0.0},
            "human": {"excessMeanDrop": 0.9, "excessFlipRate": 0.9},
        }
        self.assertEqual(masking.masking_verdict(human_only), masking.VERDICT_SURVIVES)

    def test_arms_over_different_populations_refuse_instead_of_intersecting(
        self,
    ) -> None:
        scores = {
            masking.ARM_ORIGINAL: {"a": 0.9, "b": 0.9},
            masking.ARM_ENTITY: {"a": 0.1},
            masking.ARM_PLACEBO: {"a": 0.9, "b": 0.9},
        }
        with self.assertRaises(masking.ScoreArmsDisagree) as caught:
            masking.read_masking(scores, {"a": "ai", "b": "ai"}, {})
        self.assertIn("do not cover the same record ids", str(caught.exception))

    def test_a_missing_arm_refuses(self) -> None:
        with self.assertRaises(masking.ScoreArmsDisagree) as caught:
            masking.read_masking({masking.ARM_ORIGINAL: {"a": 0.5}}, {"a": "ai"}, {})
        self.assertIn("arms absent", str(caught.exception))

    def test_a_record_with_no_masking_entry_refuses_instead_of_reporting_nothing(
        self,
    ) -> None:
        # The share and the shortfall are the bounds on the verdict, and `masking` used to be
        # optional: omitted, the report published a verdict with a null share beside it.
        scores = {arm: {"a": 0.9} for arm in masking.ARMS}
        with self.assertRaises(masking.MaskingRecordsUnaccounted) as caught:
            masking.read_masking(scores, {"a": "ai"}, {})
        self.assertIn("absent from the masking map", str(caught.exception))


# --- instrument 3: the theme-blind floor ------------------------------------


class ThemeBlindBaselineRefusesContentWords(unittest.TestCase):
    def test_the_closed_list_is_read_from_the_stylometric_probe(self) -> None:
        # READ, not copied: two copies of a closed grammatical class is one copy that can
        # drift away from the `function-word-rate` feature that counts against it.
        self.assertEqual(
            set(baseline.FUNCTION_WORD_VOCABULARY), set(probes.FUNCTION_WORDS)
        )
        self.assertGreater(len(baseline.FUNCTION_WORD_VOCABULARY), 100)

    def test_the_declared_classes_partition_the_list_exactly(self) -> None:
        baseline.assert_the_function_word_list_is_the_declared_closed_class()
        self.assertEqual(baseline.DECLARED_FUNCTION_WORDS, probes.FUNCTION_WORDS)
        self.assertEqual(len(baseline.DECLARED_FUNCTION_WORDS), 120)
        self.assertEqual(
            sorted(baseline.DECLARED_FUNCTION_WORD_CLASSES),
            [
                "adverbios",
                "artigos",
                "auxiliares",
                "conjuncoes",
                "contracoes",
                "preposicoes",
                "pronomes",
            ],
        )
        # A PARTITION, not a cover: a word listed under two classes would make the sum of the
        # classes disagree with the list while set equality still passed.
        total = sum(
            len(words) for words in baseline.DECLARED_FUNCTION_WORD_CLASSES.values()
        )
        self.assertEqual(total, len(baseline.DECLARED_FUNCTION_WORDS))
        for name, words in baseline.DECLARED_FUNCTION_WORD_CLASSES.items():
            self.assertGreater(len(words), 0, name)

    def test_no_content_word_is_declared_functional(self) -> None:
        baseline.assert_the_function_word_list_is_the_declared_closed_class()
        self.assertEqual(probes.FUNCTION_WORDS & baseline.CONTENT_WORD_PROBES, set())

    def test_one_content_word_admitted_into_the_list_refuses(self) -> None:
        saved = probes.FUNCTION_WORDS
        try:
            probes.FUNCTION_WORDS = frozenset(saved | {"presidente"})
            with self.assertRaises(baseline.ContentWordReachedTheBaseline) as caught:
                baseline.assert_the_function_word_list_is_the_declared_closed_class()
            self.assertIn("presidente", str(caught.exception))
            # And neither pipeline that carries the branch can be built: the guard runs at
            # construction, so no `fit` is reachable with the word in the vocabulary.
            with self.assertRaises(baseline.ContentWordReachedTheBaseline):
                baseline.function_word_pipeline()
            with self.assertRaises(baseline.ContentWordReachedTheBaseline):
                baseline.cheap_floor_pipeline()
        finally:
            probes.FUNCTION_WORDS = saved

    def test_a_content_word_the_probe_list_never_named_refuses_too(self) -> None:
        # `brasil` is a content word and is NOT in `CONTENT_WORD_PROBES`. While the check was
        # that blacklist, MEASURED: the construction guard passed with brasil/ano/casa/novo/
        # grande declared functional and `brasil` reached the fitted vocabulary. Set equality
        # against the declared grammatical classes is what closes that.
        self.assertNotIn("brasil", baseline.CONTENT_WORD_PROBES)
        saved = probes.FUNCTION_WORDS
        try:
            probes.FUNCTION_WORDS = frozenset(saved | {"brasil"})
            with self.assertRaises(baseline.ContentWordReachedTheBaseline) as caught:
                baseline.assert_the_function_word_list_is_the_declared_closed_class()
            self.assertIn("brasil", str(caught.exception))
            self.assertIn("not the declared closed class", str(caught.exception))
            with self.assertRaises(baseline.ContentWordReachedTheBaseline):
                baseline.function_word_pipeline()
        finally:
            probes.FUNCTION_WORDS = saved

    def test_a_word_dropped_from_the_list_refuses(self) -> None:
        # Removal is the other direction, and it is not symmetric with addition: dropping
        # `a`, `e` and `o` is a different measurement published under the same name.
        saved = probes.FUNCTION_WORDS
        try:
            probes.FUNCTION_WORDS = frozenset(saved - {"a", "e", "o"})
            with self.assertRaises(baseline.ContentWordReachedTheBaseline) as caught:
                baseline.assert_the_function_word_list_is_the_declared_closed_class()
            self.assertIn("3 dropped", str(caught.exception))
        finally:
            probes.FUNCTION_WORDS = saved

    def test_every_word_of_the_closed_list_is_reachable_by_the_analyzer(self) -> None:
        # sklearn's DEFAULT `token_pattern` is `(?u)\b\w\w+\b` and drops every token under
        # two characters, so `a`, `e`, `o`, `à` and `é` sat in the vocabulary with permanent
        # zero mass — the three most frequent words of pt-BR, and the material Mosteller &
        # Wallace count. A vocabulary entry that no text can reach is not a feature.
        vectorizer = baseline._function_word_branch()
        analyzer = vectorizer.build_analyzer()
        unreachable = sorted(
            word
            for word in baseline.FUNCTION_WORD_VOCABULARY
            if word not in analyzer(f"xis {word} zeta")
        )
        self.assertEqual(unreachable, [])
        single = sorted(
            word for word in baseline.FUNCTION_WORD_VOCABULARY if len(word) == 1
        )
        self.assertEqual(single, ["a", "e", "o", "à", "é"])

    def test_the_single_character_words_carry_mass_on_a_text_that_has_them(self) -> None:
        prose = "A cidade e o porto ficam à beira do rio, e o museu é antigo."
        vectorizer = baseline._function_word_branch()
        matrix = vectorizer.fit_transform([prose])
        names = list(vectorizer.get_feature_names_out())
        for word in ("a", "e", "o", "à", "é"):
            self.assertGreater(matrix[0, names.index(word)], 0.0, word)

    def test_the_fixture_makes_the_function_word_branch_produce_mass(self) -> None:
        # The guard below asserts over a FITTED vocabulary, and over a fixture with no
        # function word the branch is a matrix of zeros: the assertion would hold whatever
        # the vocabulary contained. Measured on the previous fixture: nnz 0 of 40x120.
        texts, labels = _pilot_fixture()
        model = baseline.function_word_pipeline().fit(texts, labels)
        fitted = dict(model[0].transformer_list)["function-words"]
        matrix = fitted.transform([str(text) for text in texts])
        self.assertGreater(matrix.nnz, 0)
        self.assertGreater(matrix.sum(), 0.0)

    def test_a_fitted_model_whose_vocabulary_left_the_list_refuses(self) -> None:
        texts, labels = _pilot_fixture()
        model = baseline.cheap_floor_pipeline().fit(texts, labels)
        baseline.assert_no_content_word_reaches_the_vocabulary(model)
        # A vectorizer that learned its vocabulary from the corpus is a topic model, and
        # that is the exact shape a dropped `vocabulary=` argument takes.
        from sklearn.feature_extraction.text import TfidfVectorizer

        learned = TfidfVectorizer().fit([str(text) for text in texts])
        model[0].transformer_list[0] = ("function-words", learned)
        with self.assertRaises(baseline.ContentWordReachedTheBaseline) as caught:
            baseline.assert_no_content_word_reaches_the_vocabulary(model)
        self.assertIn("outside the closed function-word list", str(caught.exception))

    def test_a_union_without_the_function_word_branch_refuses(self) -> None:
        texts, labels = _pilot_fixture()
        model = baseline.cheap_floor_pipeline().fit(texts, labels)
        model[0].transformer_list = [
            (name, transformer)
            for name, transformer in model[0].transformer_list
            if name != "function-words"
        ]
        with self.assertRaises(baseline.ContentWordReachedTheBaseline) as caught:
            baseline.assert_no_content_word_reaches_the_vocabulary(model)
        self.assertIn("no `function-words` branch", str(caught.exception))

    def test_the_post_fit_guard_runs_on_every_fold(self) -> None:
        texts, labels = _pilot_fixture()
        seen: list[object] = []
        baseline.cross_validated_aucs(
            texts,
            labels,
            baseline.cheap_floor_pipeline,
            after_fit=seen.append,
        )
        self.assertEqual(len(seen), baseline.BASELINE_FOLDS)

    def test_every_vectorization_declares_its_post_fit_guard(self) -> None:
        baseline.assert_every_vectorization_declares_its_post_fit_guard()
        self.assertEqual(
            list(baseline.VECTORIZATIONS),
            [
                "word(1,2)",
                "char(3,6)",
                "funcionais",
                "estilometria",
                "funcionais+estilometria",
            ],
        )
        for label in ("funcionais", "funcionais+estilometria"):
            self.assertIs(
                baseline.POST_FIT_GUARDS[label],
                baseline.assert_no_content_word_reaches_the_vocabulary,
            )

    def test_only_the_function_word_branch_is_declared_theme_blind(self) -> None:
        # The union was published as the theme-blind number and it is not one: MEASURED over
        # the 253 pilot pairs, `estilometria` alone reaches 0,9712 of the union's 0,9767 —
        # 98,8 % of the above-chance separation — and seven of its nineteen features are
        # functions of the content words. Only `funcionais` bounds the thematic share.
        self.assertEqual(baseline.THEME_BLIND_VECTORIZATIONS, {"funcionais"})
        self.assertTrue(
            baseline.THEME_BLIND_VECTORIZATIONS <= set(baseline.VECTORIZATIONS)
        )

    def test_a_theme_blind_label_that_names_no_vectorization_refuses(self) -> None:
        saved = baseline.THEME_BLIND_VECTORIZATIONS
        try:
            baseline.THEME_BLIND_VECTORIZATIONS = frozenset({"cego-a-tema"})
            with self.assertRaises(baseline.ContentWordReachedTheBaseline) as caught:
                baseline.assert_every_vectorization_declares_its_post_fit_guard()
            self.assertIn("declared theme-blind", str(caught.exception))
        finally:
            baseline.THEME_BLIND_VECTORIZATIONS = saved

    def test_the_stylometric_branch_reads_content_and_the_other_branch_does_not(
        self,
    ) -> None:
        # The measurement behind the split, not an appeal to the feature names: swapping every
        # CONTENT word for another content word while every function word stays put moves the
        # stylometric matrix and leaves the function-word matrix identical.
        before = "o presidente da cidade falou sobre a economia e a saúde da região"
        after = "o mercado da bateria falou sobre a tecnologia e a cultura da entrega"
        vectorizer = baseline._function_word_branch().fit([before, after])
        function_words = vectorizer.transform([before, after]).toarray()
        np.testing.assert_allclose(function_words[0], function_words[1])
        stylometry = baseline._stylometry_matrix([before, after])
        self.assertFalse(np.allclose(stylometry[0], stylometry[1]))
        content_sensitive = [
            "type-token-ratio",
            "mtld",
            "trigram-repetition",
            "hapax-rate",
            "long-word-rate",
            "word-length-mean",
            "flesch-pt",
        ]
        for name in content_sensitive:
            self.assertIn(name, probes.STYLOMETRIC_FEATURES)

    def test_a_vectorization_without_a_declared_guard_refuses(self) -> None:
        saved = dict(baseline.VECTORIZATIONS)
        try:
            baseline.VECTORIZATIONS["nova"] = baseline.word_pipeline
            with self.assertRaises(baseline.ContentWordReachedTheBaseline):
                baseline.assert_every_vectorization_declares_its_post_fit_guard()
        finally:
            baseline.VECTORIZATIONS.clear()
            baseline.VECTORIZATIONS.update(saved)

    def test_the_spelling_bias_measure_cannot_enter_the_floor(self) -> None:
        # The floor reaches stylometry through `probes.feature_matrix`, which refuses
        # first, so the bias measure is barred from this model by the same guard that
        # bars it from the stylometric probe.
        saved = dict(probes.STYLOMETRIC_FEATURES)
        try:
            probes.STYLOMETRIC_FEATURES["spelling-error-rate"] = (
                probes.spelling_error_rate
            )
            with self.assertRaises(probes.BiasMeasureReachedTheFeatures):
                baseline._stylometry_matrix(["um texto qualquer com palavras."])
        finally:
            probes.STYLOMETRIC_FEATURES.clear()
            probes.STYLOMETRIC_FEATURES.update(saved)


# --- instrument 4: is the reserved family EASY? -----------------------------


class ReservedFamilyAcceptanceIsReadOffANumber(unittest.TestCase):
    def test_the_criterion_is_pinned(self) -> None:
        self.assertEqual(baseline.OOD_EASINESS_MARGIN, 0.10)
        self.assertEqual(baseline.OOD_LIFT_HEADROOM, 0.10)
        self.assertEqual(baseline.OOD_DETECTOR_SEPARATION_FLOOR, 0.51)
        self.assertFalse(baseline.OOD_EASINESS_SPENDS_ALPHA)

    def test_accepts_when_the_reserved_family_is_no_easier(self) -> None:
        report = baseline.read_ood_easiness(
            reserved_floor=0.70,
            reserved_detector=0.95,
            core_floor=0.70,
            core_detector=0.95,
        )
        self.assertTrue(report["hasHeadroom"])
        self.assertEqual(report["verdict"], baseline.OOD_VERDICT_GENERALIZATION)
        baseline.assert_reserved_family_measures_generalization(report)

    def test_refuses_at_the_margin_exactly(self) -> None:
        # Core lift 0.4, reserved lift 0.5: the excess is the margin, and the boundary
        # counts as easiness rather than as acceptance.
        report = baseline.read_ood_easiness(
            reserved_floor=0.75,
            reserved_detector=1.0,
            core_floor=0.70,
            core_detector=1.0,
        )
        self.assertAlmostEqual(report["excessLift"], baseline.OOD_EASINESS_MARGIN, 12)
        self.assertEqual(report["verdict"], baseline.OOD_VERDICT_EASINESS)
        with self.assertRaises(baseline.ReservedFamilyMeasuresEasiness) as caught:
            baseline.assert_reserved_family_measures_generalization(report)
        self.assertIn("OPTIMISTIC BOUND", str(caught.exception))

    def test_abstains_when_the_floor_already_reaches_the_detector(self) -> None:
        # MEASURED on the pilot pools over the paired parents (2026-08-07): a cheap floor of
        # 0,9830 against a detector of 0,9898 leaves a core lift of 0,9861 and an excess of
        # 0,0070 that could not have been anything else. Accepting on that is fail-OPEN.
        report = baseline.read_ood_easiness(
            reserved_floor=0.9544863763687292,
            reserved_detector=0.9576562728736642,
            core_floor=0.9829885057471264,
            core_detector=0.9898050974512743,
        )
        self.assertFalse(report["hasHeadroom"])
        self.assertLess(report["excessLift"], baseline.OOD_EASINESS_MARGIN)
        self.assertEqual(report["verdict"], baseline.OOD_VERDICT_NO_HEADROOM)
        with self.assertRaises(baseline.ReservedFamilyMeasuresEasiness) as caught:
            baseline.assert_reserved_family_measures_generalization(report)
        self.assertIn("not an acceptance", str(caught.exception))

    def test_easiness_wins_over_abstention_when_both_hold(self) -> None:
        # The floor BEATS the detector on the reserved family (lift above 1) while the core
        # families leave no headroom: the run has measured easiness AND is unresolvable, and
        # reporting the abstention would lose the finding.
        report = baseline.read_ood_easiness(
            reserved_floor=0.99,
            reserved_detector=0.90,
            core_floor=0.96,
            core_detector=1.00,
        )
        self.assertFalse(report["hasHeadroom"])
        self.assertGreaterEqual(report["excessLift"], baseline.OOD_EASINESS_MARGIN)
        self.assertEqual(report["verdict"], baseline.OOD_VERDICT_EASINESS)

    def test_the_human_side_must_be_the_paired_parents(self) -> None:
        # The block used to be handed EVERY human row of `--humans` while the published AUCs
        # used only the paired parents, so the design's one topic control vanished in the
        # instrument that decides how the OOD number is published. Measured surface: 253
        # parents against a wikipedia_fresh pool of 5.000 rows.
        ai_rows = [
            {"candidateId": "ai_1", "text": "um texto", "meta": {"pairedWith": "hum_1"}},
        ]
        parents = [{"candidateId": "hum_1", "text": "outro texto"}]
        baseline.assert_every_human_row_is_a_paired_parent(ai_rows, parents)
        strangers = [*parents, {"candidateId": "hum_9", "text": "de outro tópico"}]
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
            baseline.assert_every_human_row_is_a_paired_parent(ai_rows, strangers)
        self.assertIn("parent no ai row", str(caught.exception))
        self.assertIn("hum_9", str(caught.exception))

    def test_the_easiness_block_refuses_unpaired_humans_before_it_fits_anything(
        self,
    ) -> None:
        ai_rows = [
            {
                "candidateId": f"ai_{index}",
                "text": "um texto qualquer com palavras.",
                "meta": {"pairedWith": f"hum_{index}", "family": "gpt-5_6-luna"},
            }
            for index in range(4)
        ]
        strangers = [
            {"candidateId": "hum_0", "text": "a."},
            {"candidateId": "estranho", "text": "b."},
        ]
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
            baseline._easiness_block(ai_rows, strangers, "gpt-5_6-luna", None)
        self.assertIn("parent no ai row", str(caught.exception))

    def test_a_detector_at_chance_has_no_denominator_and_refuses(self) -> None:
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
            baseline.baseline_lift(0.50, 0.50)
        self.assertIn("separation floor", str(caught.exception))
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable):
            baseline.read_ood_easiness(0.9, 0.505, 0.7, 0.95)


class OneSlicePopulationForBothInstruments(unittest.TestCase):
    """A slice is one population, both instruments read it, and the block publishes it.

    The two floors are read AGAINST EACH OTHER by `read_ood_easiness`, so a negative side
    shared between the slices makes each floor carry a different share of off-topic
    negatives — `1 - n_slice/n_human` — and the comparison measures the slice sizes too.
    """

    def test_each_slice_reads_only_the_parents_of_its_own_rows(self) -> None:
        ai_rows, parents = _paired_fixture()
        self.assertEqual(len(parents), 9)
        block, floors = _block(ai_rows, parents)
        self.assertEqual(block["rows"]["reserved"], {"ai": 4, "human": 4})
        self.assertEqual(block["rows"]["core"], {"ai": 5, "human": 5})
        # Not the counts alone: the negatives of a slice ARE its own parents, so no id of the
        # other slice's parents may stand among them.
        reserved_negatives = {row_id for row_id, _ in floors["reserved"].human}
        core_negatives = {row_id for row_id, _ in floors["core"].human}
        self.assertEqual(reserved_negatives, {f"hum_res_{index}" for index in range(4)})
        self.assertEqual(core_negatives, {f"hum_core_{index}" for index in range(5)})
        self.assertEqual(reserved_negatives & core_negatives, set())

    def test_a_parent_shared_by_two_rows_enters_the_negative_side_once(self) -> None:
        # Measured on the pilot pools: rows per parent is exactly 1,000 in both slices, so
        # this is the contract for material that pairs two rows to one parent — a parent
        # entered twice weights its subject twice on one side of one slice.
        ai_rows, parents = _paired_fixture(shared_parent=True)
        self.assertEqual(len(parents), 8)
        block, floors = _block(ai_rows, parents)
        self.assertEqual(block["rows"]["reserved"], {"ai": 4, "human": 3})
        negatives = [row_id for row_id, _ in floors["reserved"].human]
        self.assertEqual(len(negatives), len(set(negatives)))

    def test_the_published_counts_are_the_populations_the_aucs_read(self) -> None:
        ai_rows, parents = _paired_fixture()
        ai_ids, human_ids = _ids_of(ai_rows, parents)
        block, _ = _block(ai_rows, parents, _scored_file(ai_ids, human_ids))
        self.assertEqual(
            block["rows"],
            {"reserved": {"ai": 4, "human": 4}, "core": {"ai": 5, "human": 5}},
        )
        # A flat `rows` with one `human` entry is the POOL's population, and 9 is the number
        # it publishes for both slices while each AUC reads 4 or 5.
        self.assertNotIn("human", block["rows"])
        published = [
            count for counts in block["rows"].values() for count in counts.values()
        ]
        self.assertNotIn(9, published)
        self.assertEqual(block["detectorScores"]["rowsJoined"], 4 + 4 + 5 + 5)
        self.assertEqual(block["detectorScores"]["rowsInFile"], 18)

    def test_the_floor_and_the_detector_read_one_population_per_slice(self) -> None:
        ai_rows, parents = _paired_fixture()
        ai_ids, human_ids = _ids_of(ai_rows, parents)
        block, _ = _block(ai_rows, parents, _scored_file(ai_ids, human_ids))
        # 18 of 18 declared: neither instrument read the union of both slices' parents,
        # which would have joined 4+9 and 5+9.
        self.assertEqual(block["detectorScores"]["rowsJoined"], 18)
        # The guard compares the ids the two readings PUBLISH, so a side that widened by one
        # id of the other slice refuses, and a permutation of the same ids does not.
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
            baseline.assert_both_instruments_read_one_population(
                "reserved",
                ("ai_res_0", "hum_res_0"),
                ("ai_res_0", "hum_res_0", "hum_core_0"),
            )
        self.assertIn("'cheapFloor': 2", str(caught.exception))
        self.assertIn("'detector': 3", str(caught.exception))
        # The mirrored direction: the detector read FEWER ids than the floor, the shape a
        # tolerant membership filter produces. A subset either way is not one population.
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
            baseline.assert_both_instruments_read_one_population(
                "reserved",
                ("ai_res_0", "ai_res_1", "hum_res_0", "hum_res_1"),
                ("ai_res_0", "hum_res_0", "hum_res_1"),
            )
        self.assertIn("'cheapFloor': 4", str(caught.exception))
        self.assertIn("'detector': 3", str(caught.exception))
        self.assertIn("ai_res_1", str(caught.exception))
        baseline.assert_both_instruments_read_one_population(
            "reserved", ("ai_res_0", "hum_res_0"), ("hum_res_0", "ai_res_0")
        )

    def test_the_criterion_is_the_ids_and_not_the_count(self) -> None:
        # Same COUNT, one id swapped for the other slice's: the sizes agree and the two AUCs
        # are over different populations. A criterion read off the counts passes this.
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
            baseline.assert_both_instruments_read_one_population(
                "reserved",
                ("ai_res_0", "hum_res_0"),
                ("ai_res_0", "hum_core_0"),
            )
        message = str(caught.exception)
        self.assertIn("'cheapFloor': 2", message)
        self.assertIn("'detector': 2", message)
        self.assertIn("hum_res_0", message)
        self.assertIn("hum_core_0", message)

    def test_the_block_refuses_when_the_two_readings_diverge_at_equal_counts(self) -> None:
        # The divergence born INSIDE one reading. The coverage guard reads the scored FILE
        # against the declared ids and this file covers all 18 of them, so it stays green
        # here: what carries the divergence is the ids the two readings published.
        #
        # Both slices are driven, and `core` is not decoration: the verdict is
        # `reservedLift - coreLift`, so a core read over two populations moves the published
        # number exactly as a reserved one does.
        for slice_name, swapped, intruder in (
            ("reserved", "hum_res_3", "hum_core_0"),
            ("core", "hum_core_4", "hum_res_0"),
        ):
            with self.subTest(slice=slice_name):
                ai_rows, parents = _paired_fixture()
                ai_ids, human_ids = _ids_of(ai_rows, parents)
                scores = _scored_file(ai_ids, human_ids)
                saved = baseline._detector_reading

                def read_one_parent_of_the_other_slice(population, scored):
                    reading = saved(population, scored)
                    if population.name != slice_name:
                        return reading
                    return baseline.SliceReading(
                        reading.auc,
                        tuple(
                            intruder if row_id == swapped else row_id
                            for row_id in reading.ids
                        ),
                    )

                try:
                    baseline._detector_reading = read_one_parent_of_the_other_slice
                    with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
                        _block(ai_rows, parents, scores)
                finally:
                    baseline._detector_reading = saved
                message = str(caught.exception)
                self.assertIn(f"'{slice_name}'", message)
                self.assertIn(swapped, message)
                self.assertIn(intruder, message)
                # Nothing in the counts carries this divergence.
                size = 8 if slice_name == "reserved" else 10
                self.assertIn(f"'cheapFloor': {size}", message)
                self.assertIn(f"'detector': {size}", message)

    def test_a_partial_join_refuses_instead_of_running_the_auc(self) -> None:
        ai_rows, parents = _paired_fixture()
        ai_ids, human_ids = _ids_of(ai_rows, parents)
        scores = _scored_file(ai_ids, human_ids, omit=("ai_res_3", "hum_res_3"))
        # The truncated population is NOT empty and carries both classes, so an emptiness
        # guard does not fire and the rank AUC returns a number over it: coverage of the
        # declared population is the only thing that can refuse this join.
        self.assertIsInstance(
            baseline.detector_auc(
                [0.9, 0.9, 0.9, 0.1, 0.1, 0.1], [True, True, True, False, False, False]
            ),
            float,
        )
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
            _block(ai_rows, parents, scores)
        message = str(caught.exception)
        self.assertIn("3/4", message)
        self.assertIn("ai_res_3", message)
        self.assertIn("hum_res_3", message)

    def test_a_join_missing_one_row_refuses(self) -> None:
        ai_rows, parents = _paired_fixture()
        ai_ids, human_ids = _ids_of(ai_rows, parents)
        # 17 of the 18 declared ids, and 7 of the reserved slice's 8 — 87,5 % joined, and it
        # refuses. There is no minimum-share constant in the module, and this is why: the
        # criterion is coverage of the declared population, which needs no number.
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
            _block(ai_rows, parents, _scored_file(ai_ids, human_ids, omit=("hum_res_2",)))
        message = str(caught.exception)
        self.assertIn("hum_res_2", message)
        self.assertIn("3/4", message)
        block, _ = _block(ai_rows, parents, _scored_file(ai_ids, human_ids))
        self.assertEqual(block["detectorScores"]["rowsJoined"], 18)

    def test_rows_the_declared_population_does_not_name_are_tolerated(self) -> None:
        # A scoring run may cover a whole corpus; only the declared ids are looked up.
        ai_rows, parents = _paired_fixture()
        ai_ids, human_ids = _ids_of(ai_rows, parents)
        scores = _scored_file(ai_ids, human_ids, extra=("de_outro_pool_1", "de_outro_pool_2"))
        block, _ = _block(ai_rows, parents, scores)
        self.assertEqual(block["detectorScores"]["rowsInFile"], 20)
        self.assertEqual(block["detectorScores"]["rowsJoined"], 18)

    def test_an_ai_row_whose_parent_is_absent_refuses(self) -> None:
        ai_rows, parents = _paired_fixture()
        orphaned = [row for row in parents if row["candidateId"] != "hum_res_3"]
        # Every remaining human row still parents an ai row, so the complementary guard has
        # nothing to say and only the new direction can refuse.
        baseline.assert_every_human_row_is_a_paired_parent(ai_rows, orphaned)
        saved = baseline.cheap_floor_auc

        def refuse_to_fit(population):
            raise AssertionError("the floor fitted before the guards refused")

        try:
            baseline.cheap_floor_auc = refuse_to_fit
            with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
                baseline._easiness_block(ai_rows, orphaned, _RESERVED_FAMILY, None)
        finally:
            baseline.cheap_floor_auc = saved
        self.assertIn("ai_res_3", str(caught.exception))
        self.assertIn("pairedWith", str(caught.exception))

    def test_the_two_pairing_guards_refuse_opposite_directions(self) -> None:
        ai_rows = [
            {"candidateId": "ai_1", "text": "um texto", "meta": {"pairedWith": "hum_1"}}
        ]
        parents = [{"candidateId": "hum_1", "text": "outro texto"}]
        baseline.assert_every_ai_row_has_its_parent_in_the_human_side(ai_rows, parents)
        baseline.assert_every_human_row_is_a_paired_parent(ai_rows, parents)
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
            baseline.assert_every_ai_row_has_its_parent_in_the_human_side(ai_rows, [])
        self.assertIn("ai_1", str(caught.exception))
        # A stranger among the humans is the OTHER failure: neither guard covers the other,
        # because one shrinks a slice's negatives and the other widens them.
        strangers = [*parents, {"candidateId": "hum_9", "text": "de outro tópico"}]
        baseline.assert_every_ai_row_has_its_parent_in_the_human_side(ai_rows, strangers)
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable):
            baseline.assert_every_human_row_is_a_paired_parent(ai_rows, strangers)

    def test_the_flat_row_counts_of_the_pool_refuse(self) -> None:
        ai_rows, parents = _paired_fixture()
        populations = _populations_of(ai_rows, parents)
        per_slice = {"reserved": {"ai": 4, "human": 4}, "core": {"ai": 5, "human": 5}}
        baseline.assert_the_published_counts_are_the_populations_read(
            {"rows": per_slice}, populations
        )
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
            baseline.assert_the_published_counts_are_the_populations_read(
                {"rows": {"reserved": 4, "core": 5, "human": 9}}, populations
            )
        self.assertIn("not the populations read", str(caught.exception))
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable) as caught:
            baseline.assert_the_published_counts_are_the_populations_read(
                {
                    "rows": per_slice,
                    "detectorAuc": {"reserved": 0.9, "core": 0.9},
                    "detectorScores": {"rowsInFile": 40, "rowsJoined": 12},
                },
                populations,
            )
        self.assertIn("against 18 declared", str(caught.exception))
        # A detector AUC published with no join counts beside it is unreadable as well.
        with self.assertRaises(baseline.ReservedFamilyIsUnreadable):
            baseline.assert_the_published_counts_are_the_populations_read(
                {"rows": per_slice, "detectorAuc": {"reserved": 0.9, "core": 0.9}},
                populations,
            )


class TheCheapFloorWeighsNoClass(unittest.TestCase):
    def test_the_cheap_floor_carries_no_class_weight(self) -> None:
        # The class-imbalance reading was MEASURED and does not hold: with the positives
        # nested (the 108 a subset of the 145) against the same 253 negatives the mean AUC
        # moves +0,00014, and `class_weight="balanced"` moves it −0,00101 — rank AUC is
        # insensitive to prevalence. The off-topic share of the negatives is what moves the
        # number, so a weight added here would shift the five published AUCs for nothing.
        self.assertIsNone(baseline.cheap_floor_pipeline()[-1].class_weight)
        for label, factory in baseline.VECTORIZATIONS.items():
            self.assertIsNone(factory()[-1].class_weight, label)
        # The COUNT, and not one estimator: a weight added to any factory of this module
        # moves a published AUC, and five factories is five places to add it.
        source = Path(baseline.__file__).read_text(encoding="utf-8")
        self.assertEqual(source.count("class_weight="), 0)


# --- none of the four is a hypothesis --------------------------------------


class NoThemeProbeReachesThePrimaryFamily(unittest.TestCase):
    def test_the_sealed_inventory_is_four_members_and_names_no_probe(self) -> None:
        masking.assert_theme_probes_decide_no_hypothesis()
        policy = json.loads(masking.POLICY_PATH.read_text(encoding="utf-8"))
        self.assertEqual(policy["multiplicity"]["primaryFamilySize"], 4)
        self.assertEqual(len(policy["multiplicity"]["primaryFamily"]), 4)
        self.assertEqual(len(masking.THEME_PROBE_NAMES), 4)
        for name in masking.THEME_PROBE_NAMES:
            self.assertNotIn(name, policy["multiplicity"]["primaryFamily"])

    def test_a_probe_promoted_to_a_hypothesis_refuses(self) -> None:
        policy = json.loads(masking.POLICY_PATH.read_text(encoding="utf-8"))
        policy["multiplicity"]["primaryFamily"] = [
            *policy["multiplicity"]["primaryFamily"],
            "theme-entity-masking",
        ]
        policy["multiplicity"]["primaryFamilySize"] = 5
        with self.assertRaises(masking.ThemeProbeReachedTheFamily) as caught:
            masking.assert_theme_probes_decide_no_hypothesis(_written(policy))
        self.assertIn("theme-entity-masking", str(caught.exception))

    def test_a_swap_that_keeps_the_count_at_four_still_refuses(self) -> None:
        # A member REPLACED by a probe keeps `m` at 4, so the count check alone would pass
        # it — which is why membership and count are both read.
        policy = json.loads(masking.POLICY_PATH.read_text(encoding="utf-8"))
        family = list(policy["multiplicity"]["primaryFamily"])
        family[0] = "theme-topic-slice"
        policy["multiplicity"]["primaryFamily"] = family
        with self.assertRaises(masking.ThemeProbeReachedTheFamily):
            masking.assert_theme_probes_decide_no_hypothesis(_written(policy))

    def test_a_family_that_lost_a_member_refuses(self) -> None:
        policy = json.loads(masking.POLICY_PATH.read_text(encoding="utf-8"))
        policy["multiplicity"]["primaryFamily"] = policy["multiplicity"][
            "primaryFamily"
        ][:3]
        policy["multiplicity"]["primaryFamilySize"] = 3
        with self.assertRaises(masking.ThemeProbeReachedTheFamily) as caught:
            masking.assert_theme_probes_decide_no_hypothesis(_written(policy))
        self.assertIn("not four members", str(caught.exception))

    def test_the_three_role_fields_say_diagnostic(self) -> None:
        self.assertEqual(masking.MASKING_ROLE, "diagnostic")
        self.assertFalse(masking.MASKING_DECIDES)
        self.assertFalse(masking.MASKING_SPENDS_ALPHA)


# --- fixtures --------------------------------------------------------------


# pt-BR prose and NOT a bag of content words. The earlier fixture was ten nouns drawn at
# random, so the function-word branch saw a matrix of ZEROS on every fold — 0 non-zeros over
# 40x120 — and every guard asserted over the fitted vocabulary passed whatever that
# vocabulary held, mutations included. A fixture that cannot make the branch produce mass
# cannot measure the branch.
_FIXTURE_CLAUSES: tuple[str, ...] = (
    "a cidade fica à beira do rio e o porto dela é muito antigo",
    "o museu da vila tem uma ponte de pedra que já existia no distrito",
    "as serras do campo são altas e há muitas estradas entre elas",
    "ele estudou na escola do bairro em que os pais dele viviam",
    "não existe praça neste distrito, mas há um mercado para as feiras",
    "quando o inverno chega, as chuvas sobem e o vale se enche de água",
    "essa estrada foi aberta pelos moradores, e desde então liga as duas vilas",
    "os campos ao redor da serra tiveram uma colheita boa também neste ano",
)


def _pilot_fixture() -> tuple[np.ndarray, np.ndarray]:
    """A topic-paired pilot shape: two classes that differ in STRUCTURE, not in subject."""
    rng = random.Random(11)
    texts: list[str] = []
    labels: list[int] = []
    for index in range(40):
        clauses = [rng.choice(_FIXTURE_CLAUSES) for _ in range(6)]
        if index % 2:
            body = ". ".join(clauses)
        else:
            body = ". ".join(
                " e ".join(clauses[start : start + 3]) for start in (0, 3)
            )
        texts.append(body + ".")
        labels.append(index % 2)
    return np.array(texts, dtype=object), np.array(labels)


# Two canonical generator families, and the fixture keeps their parents DISJOINT because the
# pilot's are: `generator_family` maps these spellings to themselves.
_RESERVED_FAMILY = "gpt-5_6-luna"
_CORE_FAMILY = "gemini-3_5-flash-lite"


def _clauses(seed: str, joined: bool) -> str:
    """pt-BR prose from the fixture clauses; `joined` is the structure the floor can read."""
    rng = random.Random(seed)
    picked = [rng.choice(_FIXTURE_CLAUSES) for _ in range(6)]
    if joined:
        return ". ".join(
            " e ".join(picked[start : start + 3]) for start in (0, 3)
        ) + "."
    return ". ".join(picked) + "."


def _paired_fixture(
    reserved: int = 4, core: int = 5, shared_parent: bool = False
) -> tuple[list[dict], list[dict]]:
    """(ai rows, parent rows) in the pilot's measured shape: 1:1 inside each slice, parents
    DISJOINT between the slices — so a slice that reads the other's parents shows up as a
    count and as an id. `shared_parent` points the reserved slice's second row at the first
    one's parent, the one shape that separates a SET of parents from one entry per ai row.
    """
    ai_rows: list[dict] = []
    for family, tag, count in (
        (_RESERVED_FAMILY, "res", reserved),
        (_CORE_FAMILY, "core", core),
    ):
        for index in range(count):
            parent = 0 if (shared_parent and tag == "res" and index == 1) else index
            ai_rows.append(
                {
                    "candidateId": f"ai_{tag}_{index}",
                    "text": _clauses(f"ai_{tag}_{index}", joined=True),
                    "meta": {"pairedWith": f"hum_{tag}_{parent}", "family": family},
                }
            )
    parents = [
        {"candidateId": parent_id, "text": _clauses(parent_id, joined=False)}
        for parent_id in sorted({row["meta"]["pairedWith"] for row in ai_rows})
    ]
    return ai_rows, parents


def _ids_of(ai_rows: list[dict], parents: list[dict]) -> tuple[list[str], list[str]]:
    return (
        [row["candidateId"] for row in ai_rows],
        [row["candidateId"] for row in parents],
    )


def _populations_of(ai_rows: list[dict], parents: list[dict]) -> dict:
    humans_by_id = {row["candidateId"]: row for row in parents}
    return {
        name: baseline._slice_population(
            name,
            [
                row
                for row in ai_rows
                if (row["meta"]["family"] == _RESERVED_FAMILY) == (name == "reserved")
            ],
            humans_by_id,
        )
        for name in ("reserved", "core")
    }


def _scored_file(
    ai_ids, human_ids, omit: tuple[str, ...] = (), extra: tuple[str, ...] = ()
) -> Path:
    """A `score_pilot_local.py`-shaped file: one object per line, id/class/family/score."""
    omitted = set(omit)
    rows = [
        {"id": row_id, "class": "ai", "family": "?", "score": 0.90}
        for row_id in ai_ids
        if row_id not in omitted
    ]
    rows += [
        {"id": row_id, "class": "human", "family": "?", "score": 0.10}
        for row_id in human_ids
        if row_id not in omitted
    ]
    rows += [
        {"id": row_id, "class": "ai", "family": "?", "score": 0.50} for row_id in extra
    ]
    handle = tempfile.NamedTemporaryFile(
        "w", suffix=".jsonl", delete=False, encoding="utf-8", newline="\n"
    )
    with handle:
        for row in rows:
            handle.write(json.dumps(row) + "\n")
    return Path(handle.name)


def _block(
    ai_rows: list[dict],
    parents: list[dict],
    detector_scores: Path | None = None,
    reserved_family: str = _RESERVED_FAMILY,
) -> tuple[dict, dict]:
    """`_easiness_block` over the fixture, plus the populations the cheap floor received.

    TWO folds: `StratifiedKFold` refuses more splits than the smaller class has members, and
    a slice here holds four or three rows a side. `cross_validated_aucs` reads
    `BASELINE_FOLDS` at call time, so the module attribute is the whole mechanism.
    """
    seen: dict[str, object] = {}
    saved_folds = baseline.BASELINE_FOLDS
    saved_floor = baseline.cheap_floor_auc

    def watched(population):
        seen[population.name] = population
        return saved_floor(population)

    try:
        baseline.BASELINE_FOLDS = 2
        baseline.cheap_floor_auc = watched
        block = baseline._easiness_block(
            ai_rows, parents, reserved_family, detector_scores
        )
    finally:
        baseline.BASELINE_FOLDS = saved_folds
        baseline.cheap_floor_auc = saved_floor
    return block, seen


def _written(policy: dict) -> Path:
    handle = tempfile.NamedTemporaryFile(
        "w", suffix=".json", delete=False, encoding="utf-8", newline="\n"
    )
    with handle:
        json.dump(policy, handle)
    return Path(handle.name)


if __name__ == "__main__":
    unittest.main()
