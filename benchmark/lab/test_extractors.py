"""Fixture tests for the lab-bench extractors (run: python -m unittest -v).

These prove the keep/drop pipeline (date cutoff, word window, PII drop,
deterministic sampling) and each format parser against tiny synthetic inputs,
so the multi-GB real runs start from verified logic.
"""

from __future__ import annotations

import bz2
import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
import zipfile
from pathlib import Path

from common import (
    CHATGPT_CUTOFF,
    CandidateWriter,
    keep_sample,
    normalize_text,
    parse_iso_date,
    pii_hits,
    word_count,
)
from extract_b2w import extract as extract_b2w
from pseudonymize import ClusterKeyring
from extract_carolina import extract as extract_carolina
from extract_stackexchange import extract as extract_stackexchange, html_to_text
from extract_wikipedia import lead_section, strip_templates
import extract_wikipedia

PROSE_60 = " ".join(f"palavra{i}" for i in range(60))

# The two person-carrying sources fail closed without a cluster-exposure keyring
# (pseudonymize.require_keyring), so every extractor test that reaches them has to
# supply one. A FIXTURE secret, deliberately not the operator's: the pseudonyms it
# produces are meaningless outside this file, which is the point — no test may
# depend on the real keyring, and no real pseudonym may be pinned in a test.
FIXTURE_KEYRING = ClusterKeyring("fixture-v1", {"person": "ab" * 32})


def run_writer(tmp: Path, name: str, fn) -> tuple[list[dict], dict]:
    output = tmp / f"{name}.jsonl"
    writer = CandidateWriter(output, source_id=f"src_{name}", limit=100, sample_rate=1)
    try:
        fn(writer)
    finally:
        writer.close()
    rows = [json.loads(line) for line in output.read_text(encoding="utf-8").splitlines()]
    stats = json.loads(output.with_suffix(".stats.json").read_text(encoding="utf-8"))
    return rows, stats


class CommonTests(unittest.TestCase):
    def test_normalize_collapses_whitespace_and_newlines(self) -> None:
        self.assertEqual(
            normalize_text("a  b\t c\r\n\r\n\r\n\r\nd  "), "a b c\n\nd"
        )

    def test_word_count(self) -> None:
        self.assertEqual(word_count("  um dois\ntrês  "), 3)

    def test_pii_patterns(self) -> None:
        self.assertEqual(pii_hits("contato: x@y.com"), ["email"])
        self.assertEqual(pii_hits("CPF 123.456.789-01"), ["cpf"])
        self.assertEqual(pii_hits("liga (11) 91234-5678"), ["phone"])
        self.assertEqual(pii_hits("fala @fulano_123"), ["handle"])
        self.assertEqual(pii_hits("texto limpo sem nada"), [])

    def test_keep_sample_is_deterministic(self) -> None:
        first = [keep_sample(f"k{i}", 7) for i in range(200)]
        second = [keep_sample(f"k{i}", 7) for i in range(200)]
        self.assertEqual(first, second)
        self.assertTrue(0 < sum(first) < 200)

    def test_parse_iso_date_and_cutoff(self) -> None:
        self.assertIsNone(parse_iso_date("desconhecida"))
        parsed = parse_iso_date("2021-11-18")
        self.assertIsNotNone(parsed)
        self.assertLess(parsed, CHATGPT_CUTOFF)
        self.assertGreaterEqual(parse_iso_date("2023-01-01"), CHATGPT_CUTOFF)

    def test_candidate_ids_are_stable_across_extractions(self) -> None:
        # The id derives from the natural key: a re-extraction with different
        # limits/sample-rates must issue the SAME id for the same source item.
        with tempfile.TemporaryDirectory() as raw:
            def one(name: str) -> str:
                rows, _ = run_writer(
                    Path(raw),
                    name,
                    lambda w: w.offer(
                        natural_key="ptso:42",
                        license_id="l",
                        created_at=parse_iso_date("2021-01-01"),
                        raw_text=PROSE_60,
                        domain_source="d",
                    ),
                )
                return rows[0]["candidateId"]

            first = one("a")
            second = one("b")
        self.assertEqual(first.split("_", 2)[-1], second.split("_", 2)[-1])

    def test_writer_drops_by_date_words_and_pii(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            def fn(writer: CandidateWriter) -> None:
                ok = dict(license_id="l", domain_source="d")
                writer.offer(natural_key="a", created_at=parse_iso_date("2021-01-01"),
                             raw_text=PROSE_60, **ok)
                writer.offer(natural_key="b", created_at=parse_iso_date("2023-01-01"),
                             raw_text=PROSE_60, **ok)
                writer.offer(natural_key="c", created_at=parse_iso_date("2021-01-01"),
                             raw_text="curto demais", **ok)
                writer.offer(natural_key="d", created_at=parse_iso_date("2021-01-01"),
                             raw_text=PROSE_60 + " mande email x@y.com", **ok)

            rows, stats = run_writer(Path(raw), "t", fn)
        self.assertEqual(len(rows), 1)
        self.assertEqual(stats["kept"], 1)
        self.assertEqual(stats["drop_date"], 1)
        self.assertEqual(stats["drop_words"], 1)
        self.assertEqual(stats["drop_pii"], 1)

    def test_writer_skips_excluded_ids(self) -> None:
        import hashlib

        excluded_id = "src_t_" + hashlib.sha1(b"a").hexdigest()[:12]
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "t.jsonl"
            writer = CandidateWriter(
                output,
                source_id="src_t",
                limit=100,
                sample_rate=1,
                exclude_ids=frozenset({excluded_id}),
            )
            ok = dict(license_id="l", domain_source="d",
                      created_at=parse_iso_date("2021-01-01"))
            writer.offer(natural_key="a", raw_text=PROSE_60, **ok)  # excluído
            writer.offer(natural_key="b", raw_text=PROSE_60, **ok)  # mantido
            writer.close()
            rows = [json.loads(x) for x in output.read_text(encoding="utf-8").splitlines()]
            stats = json.loads(output.with_suffix(".stats.json").read_text(encoding="utf-8"))
        self.assertEqual(len(rows), 1)
        self.assertNotEqual(rows[0]["candidateId"], excluded_id)
        self.assertEqual(stats["kept"], 1)
        self.assertEqual(stats["drop_excluded"], 1)


class StackExchangeTests(unittest.TestCase):
    def test_html_to_text_drops_code_and_breaks_blocks(self) -> None:
        html = "<p>Uma pergunta</p><pre><code>var x = segredo();</code></pre><p>fim</p>"
        text = html_to_text(html)
        self.assertIn("Uma pergunta", text)
        self.assertIn("fim", text)
        self.assertNotIn("segredo", text)

    def test_extract_survives_malformed_marked_section(self) -> None:
        # Real Posts.xml bodies occasionally contain `<![a-zA-Z]>`-style marked
        # sections that make the stdlib HTMLParser raise; one bad post must be
        # dropped (drop_other), never abort the run.
        bad = "&lt;![a-zA-Z]&gt;" + PROSE_60
        good = "&lt;p&gt;" + PROSE_60 + "&lt;/p&gt;"
        xml = (
            "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<posts>\n"
            f"  <row Id=\"1\" PostTypeId=\"1\" CreationDate=\"2014-05-01T10:00:00.000\" Body=\"{bad}\" />\n"
            f"  <row Id=\"2\" PostTypeId=\"2\" CreationDate=\"2014-05-01T10:00:00.000\" Body=\"{good}\" />\n"
            "</posts>\n"
        )
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            posts = tmp / "Posts.xml"
            posts.write_text(xml, encoding="utf-8")
            rows, stats = run_writer(
                tmp, "ptso_bad", lambda w: extract_stackexchange(posts, w, keyring=FIXTURE_KEYRING)
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(stats["drop_other"], 1)

    def test_extract_filters_by_type_and_date(self) -> None:
        body = "&lt;p&gt;" + PROSE_60 + "&lt;/p&gt;"
        xml = (
            "﻿<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<posts>\n"
            f"  <row Id=\"1\" PostTypeId=\"1\" CreationDate=\"2014-05-01T10:00:00.000\" Body=\"{body}\" />\n"
            f"  <row Id=\"2\" PostTypeId=\"2\" CreationDate=\"2023-05-01T10:00:00.000\" Body=\"{body}\" />\n"
            f"  <row Id=\"3\" PostTypeId=\"4\" CreationDate=\"2014-05-01T10:00:00.000\" Body=\"{body}\" />\n"
            "</posts>\n"
        )
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            posts = tmp / "Posts.xml"
            posts.write_text(xml, encoding="utf-8")
            rows, stats = run_writer(
                tmp, "ptso", lambda w: extract_stackexchange(posts, w, keyring=FIXTURE_KEYRING)
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["meta"]["postType"], "question")
        self.assertEqual(stats["drop_date"], 1)  # the 2023 answer


class WikipediaTests(unittest.TestCase):
    def test_strip_templates_handles_nesting(self) -> None:
        self.assertEqual(strip_templates("a {{x {{y}} z}} b"), "a  b")
        self.assertEqual(strip_templates("a {| tabela |} b"), "a  b")

    def test_lead_section_cleans_markup_and_stops_at_heading(self) -> None:
        wikitext = (
            "{{Info|param=1}}\n"
            "'''Termo''' é um [[conceito|conceito importante]] descrito"
            " em [https://x.exemplo fonte].<ref>nota</ref>\n"
            "* item de lista\n"
            "== História ==\nCorpo posterior."
        )
        lead = lead_section(wikitext)
        self.assertIn("Termo é um conceito importante", lead)
        self.assertIn("fonte", lead)
        self.assertNotIn("nota", lead)
        self.assertNotIn("item de lista", lead)
        self.assertNotIn("História", lead)

    def test_extract_from_bz2_keeps_ns0_non_redirect(self) -> None:
        ns = "http://www.mediawiki.org/xml/export-0.10/"
        page = (
            "<page><title>T</title><ns>0</ns><id>10</id><revision>"
            "<timestamp>2021-06-01T00:00:00Z</timestamp>"
            f"<text>{PROSE_60}</text></revision></page>"
        )
        redirect = (
            "<page><title>R</title><ns>0</ns><id>11</id><redirect title=\"T\"/>"
            f"<revision><timestamp>2021-06-01T00:00:00Z</timestamp><text>{PROSE_60}</text></revision></page>"
        )
        talk = page.replace("<ns>0</ns>", "<ns>1</ns>").replace("<id>10</id>", "<id>12</id>")
        xml = f"<mediawiki xmlns=\"{ns}\">{page}{redirect}{talk}</mediawiki>"
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            dump = tmp / "mini.xml.bz2"
            with bz2.open(dump, "wt", encoding="utf-8") as handle:
                handle.write(xml)
            rows, _ = run_writer(
                tmp, "wiki", lambda w: extract_wikipedia.extract(dump, w)
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["domainSource"], "ptwiki_lead")


class B2WTests(unittest.TestCase):
    def test_extract_keeps_reviews_drops_empty_and_post_cutoff(self) -> None:
        header = "submission_date,review_title,review_text,product_id\n"
        keep = f'2018-03-01 10:00:00,Bom,"{PROSE_60}",p1\n'
        empty = '2018-03-02 10:00:00,Sem texto,,p2\n'
        post_cutoff = f'2024-01-01 10:00:00,Novo,"{PROSE_60}",p3\n'
        csv_text = header + keep + empty + post_cutoff
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            path = tmp / "b2w.csv"
            path.write_text(csv_text, encoding="utf-8")
            rows, stats = run_writer(tmp, "b2w", lambda w: extract_b2w(path, w, keyring=FIXTURE_KEYRING))
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["domainSource"], "b2w_reviews")
        self.assertEqual(rows[0]["licenseId"], "cc-by-nc-sa-4.0")
        self.assertEqual(stats["drop_date"], 1)  # o review de 2024


class CarolinaTests(unittest.TestCase):
    def make_tei(self, *, license_text: str, download: str, body: str) -> str:
        return (
            "<TEI><teiHeader><fileDesc><publicationStmt>"
            f"<date type=\"Download\">{download}</date>"
            "<availability status=\"free\">"
            f"<license target=\"https://x\">{license_text}</license>"
            "</availability></publicationStmt></fileDesc></teiHeader>"
            f"<text><body><p>{body}</p></body></text></TEI>"
        )

    def test_per_typology_limit_balances_typologies(self) -> None:
        ns = "http://www.tei-c.org/ns/1.0"
        good = self.make_tei(
            license_text="CC BY-NC-SA 4.0", download="2021-11-18", body=PROSE_60
        )
        many = f"<teiCorpus xmlns=\"{ns}\"><teiHeader/>{good * 5}</teiCorpus>"
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            archive = tmp / "carolina.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("Corpus/university domains/UNIa.xml", many)
                z.writestr("Corpus/social media/SOCa.xml", many)
            rows, _ = run_writer(
                tmp,
                "carolina_bal",
                lambda w: extract_carolina(archive, w, per_typology_limit=2),
            )
        from collections import Counter

        dist = Counter(r["domainSource"] for r in rows)
        self.assertEqual(dist["carolina_university_domains"], 2)
        self.assertEqual(dist["carolina_social_media"], 2)

    def test_extract_filters_license_date_and_wikis(self) -> None:
        ns = "http://www.tei-c.org/ns/1.0"
        good = self.make_tei(
            license_text="CC BY-NC-SA 4.0", download="2021-11-18", body=PROSE_60
        )
        bad_license = self.make_tei(
            license_text="Proprietária", download="2021-11-18", body=PROSE_60
        )
        too_new = self.make_tei(
            license_text="CC BY-NC-SA 4.0", download="2024-01-05", body=PROSE_60
        )
        corpus = f"<teiCorpus xmlns=\"{ns}\"><teiHeader/>{good}{bad_license}{too_new}</teiCorpus>"
        wiki_corpus = f"<teiCorpus xmlns=\"{ns}\"><teiHeader/>{good}</teiCorpus>"
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            archive = tmp / "carolina.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("Corpus/social media/SOCa.xml", corpus)
                z.writestr("Corpus/wikis/pt/WIKaa.xml", wiki_corpus)
            rows, stats = run_writer(
                tmp, "carolina", lambda w: extract_carolina(archive, w)
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["licenseId"], "cc-by-nc-sa-4.0")
        self.assertEqual(rows[0]["domainSource"], "carolina_social_media")
        self.assertEqual(stats["drop_license"], 1)
        self.assertEqual(stats["drop_date"], 1)


class GenerateAiTests(unittest.TestCase):
    def humans(self) -> list[dict]:
        return [
            {"candidateId": f"src_x_{i:06d}", "wordCount": 80, "text": PROSE_60,
             "domainSource": "d"}
            for i in range(1, 41)
        ]

    def test_select_pairs_is_deterministic_and_resume_skips(self) -> None:
        from generate_ai import select_pairs

        first = select_pairs(self.humans(), "anthropic", 10, set())
        second = select_pairs(self.humans(), "anthropic", 10, set())
        self.assertEqual(
            [r["candidateId"] for r in first], [r["candidateId"] for r in second]
        )
        done = {first[0]["candidateId"], first[1]["candidateId"]}
        resumed = select_pairs(self.humans(), "anthropic", 10, done)
        self.assertFalse(done & {r["candidateId"] for r in resumed})

    def test_recipe_assignment_is_deterministic_and_weighted(self) -> None:
        from collections import Counter

        from generate_ai import RECIPES, recipe_for, template_digest

        ids = [f"src_x_{i:06d}" for i in range(2000)]
        first = [recipe_for("openai", cid) for cid in ids]
        second = [recipe_for("openai", cid) for cid in ids]
        self.assertEqual(first, second)
        counts = Counter(first)
        # Weights 5/2/2/1 over deterministic buckets of 10.
        self.assertGreater(counts["original"], counts["parafrase"])
        self.assertGreater(counts["parafrase"], counts["humanizado"])
        for name in RECIPES:
            self.assertIn(name, counts)
            self.assertEqual(len(template_digest(name)), 64)

    def test_writer_without_cutoff_accepts_current_dates(self) -> None:
        from datetime import datetime, timezone

        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "ai.jsonl"
            writer = CandidateWriter(
                output, source_id="src_ai", limit=10, sample_rate=1,
                date_cutoff=None,
            )
            writer.offer(
                natural_key="k", license_id="geracao-propria-v1",
                created_at=datetime.now(timezone.utc), raw_text=PROSE_60,
                domain_source="ai_test",
            )
            writer.close()
            rows = output.read_text(encoding="utf-8").splitlines()
        self.assertEqual(len(rows), 1)


if __name__ == "__main__":
    unittest.main(verbosity=2)


class PublicCorpusTests(unittest.TestCase):
    def test_leak_markers_drop_reasoning_channel_text(self) -> None:
        from import_public_corpus import looks_contaminated

        self.assertTrue(
            looks_contaminated("analysisWe need to write a scientific text…")
        )
        self.assertTrue(looks_contaminated("The user wants a post about X."))
        # Legitimate pt-BR prose — including the word "análise" — passes.
        self.assertFalse(
            looks_contaminated("A análise dos dados mostra que o mercado cresceu.")
        )
        # English quoted deep in the text (past the head window) is fine.
        self.assertFalse(
            looks_contaminated("Texto longo em português. " * 20 + "We need to go.")
        )


class CodexBatchTests(unittest.TestCase):
    def test_chunks_are_single_recipe_and_bounded(self) -> None:
        from codex_batch import chunk_pairs
        from generate_ai import recipe_for

        pairs = [
            {"candidateId": f"src_x_{i:06d}", "wordCount": 100, "text": PROSE_60}
            for i in range(97)
        ]
        chunks = chunk_pairs(pairs, "openai", 20)
        total = sum(len(rows) for _, rows in chunks)
        self.assertEqual(total, 97)
        for recipe, rows in chunks:
            self.assertLessEqual(len(rows), 20)
            for row in rows:
                self.assertEqual(recipe_for("openai", row["candidateId"]), recipe)


class BuildDatasetTests(unittest.TestCase):
    def test_pairs_are_atomic_and_buckets_deterministic(self) -> None:
        import build_dataset as bd

        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            humans = tmp / "h.jsonl"
            ais = tmp / "a.jsonl"
            human_rows = [
                {"candidateId": f"src_h_{i:04d}", "text": f"{PROSE_60} humano {i}",
                 "domainSource": "d", "wordCount": 61}
                for i in range(50)
            ]
            humans.write_text(
                "\n".join(json.dumps(r) for r in human_rows) + "\n", encoding="utf-8"
            )
            ai_rows = [
                {"candidateId": f"src_ai_{i:04d}", "text": f"{PROSE_60} ia {i}",
                 "domainSource": "ai_x", "wordCount": 61,
                 "meta": {"pairedWith": f"src_h_{i:04d}", "family": "f", "recipe": "original"}}
                for i in range(50)
            ]
            # one exact duplicate of a human text -> must be dropped
            ai_rows.append({"candidateId": "src_ai_dup", "text": human_rows[0]["text"],
                            "domainSource": "ai_x", "wordCount": 61,
                            "meta": {"pairedWith": "", "family": "f", "recipe": ""}})
            ais.write_text(
                "\n".join(json.dumps(r) for r in ai_rows) + "\n", encoding="utf-8"
            )

            rows = bd.assemble([humans], [ais])
            dropped = rows.pop("_dropped_dupes")
            self.assertEqual(dropped, 1)
            split_of = {}
            for split, split_rows in rows.items():
                for row in split_rows:
                    split_of[row["id"]] = split
            for i in range(50):
                self.assertEqual(
                    split_of[f"src_h_{i:04d}"], split_of[f"src_ai_{i:04d}"],
                    "par humano/IA deve ficar no MESMO split",
                )
            self.assertEqual(
                split_of["src_h_0000"],
                bd.split_name(bd.bucket_of("src_h_0000")),
            )
            total = sum(len(r) for r in rows.values())
            self.assertEqual(total, 100)


class MakeMixedTests(unittest.TestCase):
    def test_spans_tile_and_fractions_sum(self) -> None:
        from make_mixed import compute_mixture

        parent = "O mercado de trabalho brasileiro atravessa um período positivo."
        edited = "O mercado de trabalho brasileiro vive um momento francamente positivo."
        mixture = compute_mixture(parent, edited)
        self.assertAlmostEqual(
            mixture["aiFraction"] + mixture["humanFraction"], 1.0, places=6
        )
        spans = mixture["spans"]
        self.assertEqual(spans[0]["start"], 0)
        self.assertEqual(spans[-1]["end"], len(edited))
        for left, right in zip(spans, spans[1:]):
            self.assertEqual(left["end"], right["start"])  # ladrilham sem furo
            self.assertNotEqual(left["origin"], right["origin"])  # coalescidos
        self.assertTrue(any(s["origin"] == "ai" for s in spans))
        self.assertTrue(any(s["origin"] == "human" for s in spans))

    def test_interleave_by_family_round_robin(self) -> None:
        from make_mixed import interleave_by_family

        pending = [
            {"id": "a1", "family": "A"},
            {"id": "a2", "family": "A"},
            {"id": "a3", "family": "A"},
            {"id": "b1", "family": "B"},
            {"id": "b2", "family": "B"},
            {"id": "c1", "family": "C"},
        ]
        order = [p["id"] for p in interleave_by_family(pending)]
        # Qualquer prefixo cobre o máximo de famílias possível.
        self.assertEqual(order, ["a1", "b1", "c1", "a2", "b2", "a3"])
        self.assertEqual(sorted(order), sorted(p["id"] for p in pending))

    def test_identical_and_total_rewrite_extremes(self) -> None:
        from make_mixed import compute_mixture

        same = compute_mixture("texto igual", "texto igual")
        self.assertEqual(same["aiFraction"], 0.0)
        self.assertEqual(len(same["spans"]), 1)
        self.assertEqual(same["spans"][0]["origin"], "human")

        rewrite = compute_mixture("um texto qualquer", "conteúdo completamente novo")
        self.assertGreater(rewrite["aiFraction"], 0.8)


class GeneratorFamilyTests(unittest.TestCase):
    """The assembler's mirror of normalizeGeneratorFamily (A4).

    The TypeScript schema is the real enforcement — validateBenchmarkRecord refuses
    any record whose groups.generatorFamily is not exactly the canonical form of its
    generation.family — so these cases pin that the assembler writes what the schema
    will accept, not a second authority.
    """

    def test_both_corpus_spellings_converge(self) -> None:
        from assemble_corpus import generator_family

        self.assertEqual(
            generator_family("gemini-3.5-flash-low"), "gemini-3_5-flash-low"
        )
        self.assertEqual(
            generator_family("gemini-3_5-flash-low"), "gemini-3_5-flash-low"
        )

    def test_idempotent_and_case_preserving(self) -> None:
        from assemble_corpus import generator_family

        for raw in (
            "gemini-3.5-flash-low",
            "madras:victory (1)",
            "gpt-5.6-luna",
            "  spaced name  ",
            "Gemini-3.5",
            "A",
        ):
            once = generator_family(raw)
            self.assertEqual(generator_family(once), once)
        # Case survives: two provider labels differing only in case stay distinct.
        self.assertEqual(generator_family("Gemini-3.5"), "Gemini-3_5")
        self.assertNotEqual(
            generator_family("Gemini-3.5"), generator_family("gemini-3.5")
        )

    def test_fails_closed_instead_of_inventing_a_token(self) -> None:
        from assemble_corpus import generator_family, slug

        # slug() invents "x" for any caller; a generator family must not be named
        # by a placeholder, so this one raises.
        self.assertEqual(slug("..."), "x")
        with self.assertRaises(ValueError):
            generator_family("...")
        with self.assertRaises(ValueError):
            generator_family("")


class HeldOutFloorWarningTests(unittest.TestCase):
    """The assembler's floor warning must compare canonical against canonical.

    `held_out` is built from groups.generatorFamily (the canonical, underscored
    token). The warning used to count generation.family — the provider's own dotted
    label — and test membership in that set, so it could never fire on a real corpus
    whatever the record counts were. Same defect class as the slice and the split
    (A4), just in the bench assembler.
    """

    @staticmethod
    def _ai_record(family_canonical: str, provider_label: str) -> dict:
        """A record carrying BOTH spellings, as the real corpus does."""
        return {
            "label": "ai",
            "generation": {"family": provider_label},
            "groups": {"generatorFamily": family_canonical},
        }

    def test_reports_a_declared_family_the_corpus_does_not_stock(self) -> None:
        from assemble_corpus import thin_held_out_families

        records = [
            self._ai_record("gemini-3_5-flash-low", "gemini-3.5-flash-low")
            for _ in range(3)
        ]
        records.append({"label": "human", "groups": {}})
        self.assertEqual(
            thin_held_out_families(records, {"gemini-3_5-flash-low"}, minimum=200),
            {"gemini-3_5-flash-low": 3},
        )

    def test_family_at_the_floor_is_not_reported(self) -> None:
        from assemble_corpus import thin_held_out_families

        records = [
            self._ai_record("gemini-3_5-flash-low", "gemini-3.5-flash-low")
            for _ in range(3)
        ]
        self.assertEqual(
            thin_held_out_families(records, {"gemini-3_5-flash-low"}, minimum=3), {}
        )

    def test_a_family_that_was_not_declared_is_not_reported(self) -> None:
        from assemble_corpus import thin_held_out_families

        # gpt-5_6-luna is just as thin, but nobody claims the detector never saw it:
        # an ordinary AI family under the floor is not this check's business.
        records = [self._ai_record("gpt-5_6-luna", "gpt-5.6-luna")]
        records += [
            self._ai_record("gemini-3_5-flash-low", "gemini-3.5-flash-low")
            for _ in range(3)
        ]
        held_out = {"gemini-3_5-flash-low"}
        self.assertEqual(thin_held_out_families(records, held_out, minimum=3), {})
        # Non-vacuous: raise the floor and only the DECLARED family is named.
        self.assertEqual(
            thin_held_out_families(records, held_out, minimum=4),
            {"gemini-3_5-flash-low": 3},
        )

    def test_a_declared_family_with_no_record_at_all_is_reported_as_zero(self) -> None:
        from assemble_corpus import thin_held_out_families

        # The worst case for a held-out claim, and the one a Counter over the records
        # cannot see: the family is declared unseen and the corpus stocks none of it.
        self.assertEqual(
            thin_held_out_families([], {"gemini-3_5-flash-low"}, minimum=200),
            {"gemini-3_5-flash-low": 0},
        )


# ===========================================================================
# C2 — the assembler persists REAL groups.
#
# Every test below exists because `assemble_corpus.base_groups` used to mint
# `a_<recordId>` / `g_<recordId>` / `ds_<recordId>` / `cb_<recordId>` /
# `nd_<recordId>` — one identifier per record, on five axes at once, under the
# comment "All UNIQUE per record so the blocked split sees singleton
# components." A split over identifiers built never to collide reports no
# leakage because there is nothing left to collide, and a bootstrap clustered on
# them is i.i.d. over 10.000 groups of one.
#
# So the property under test is never "the axis is filled". It is "the axis
# carries the identity the SOURCE has, and says so when the source has none".
# ===========================================================================


class ClusterPseudonymTests(unittest.TestCase):
    """A person identifier is HMAC'd with a secret, or the run fails."""

    def test_missing_keyring_fails_closed_instead_of_hashing(self) -> None:
        from pseudonymize import ClusterKeyringMissing, load_cluster_keyring

        with tempfile.TemporaryDirectory() as raw:
            absent = Path(raw) / "cluster-exposure-keyring.v1.json"
            with self.assertRaises(ClusterKeyringMissing) as caught:
                load_cluster_keyring(absent)
        # The message has to point at C3's canonical path, because the operator's
        # next question is "where do I put it".
        self.assertIn("cluster-exposure-keyring.v1.json", str(caught.exception))

    def test_a_keyring_without_the_purpose_key_fails_closed(self) -> None:
        from pseudonymize import ClusterKeyringMissing, load_cluster_keyring

        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "cluster-exposure-keyring.v1.json"
            path.write_text(
                json.dumps({"keyringVersion": "v1", "secrets": {"other": "aa" * 32}}),
                encoding="utf-8",
            )
            keyring = load_cluster_keyring(path)
            with self.assertRaises(ClusterKeyringMissing):
                keyring.pseudonym("person", "40")

    def test_the_pseudonym_is_keyed_and_not_a_bare_digest(self) -> None:
        import hashlib

        from pseudonymize import ClusterKeyring

        left = ClusterKeyring("v1", {"person": "11" * 32})
        right = ClusterKeyring("v1", {"person": "22" * 32})
        first = left.pseudonym("person", "40")
        # Deterministic under one secret...
        self.assertEqual(first, left.pseudonym("person", "40"))
        # ...and NOT a function of the identifier alone. This is the whole point:
        # `OwnerUserId="40"` is low entropy, so an unkeyed digest of it is
        # reversible by enumerating the integers.
        self.assertNotEqual(first, right.pseudonym("person", "40"))
        self.assertNotIn(hashlib.sha256(b"40").hexdigest()[:16], first)
        self.assertNotIn(hashlib.sha1(b"40").hexdigest()[:16], first)
        # A pseudonym token: benchmark/schema.ts validates every group id against
        # /^[A-Za-z0-9_-]+$/, so a "." would be refused at ingest.
        self.assertRegex(first, r"^[A-Za-z0-9_-]+$")

    def test_the_purpose_separates_two_axes_of_the_same_raw_value(self) -> None:
        from pseudonymize import ClusterKeyring

        keyring = ClusterKeyring("v1", {"a": "11" * 32, "b": "11" * 32})
        # ASSERTED ON THE DIGEST HALF, not on the whole token, and that is the whole
        # point of this test. `pseudonym` returns `<purpose>_<digest[:16]>`, so
        # comparing whole tokens is satisfied by the `a_` / `b_` prefix alone: with
        # the purpose REMOVED from the MAC message both calls return the same digest
        # half (measured: 60cd07e428342f7d, which is hmac-sha256(bytes.fromhex("11"*32),
        # b"40").hexdigest()[:16], and the value this test PRINTS under that mutation)
        # and a whole-token assertion still passes. An earlier revision of this comment
        # said 3171c3888025f79c, which corresponds to nothing on the path: not the
        # ascii-key variant, not sha256 or sha1 of the raw, not the purpose-prefixed
        # message. A test that exists to record a measurement must not carry a second,
        # wrong one — which is also why the formula sits beside the number here, so the
        # next reader can re-derive it instead of trusting it.
        # What the mixing actually buys is MAC domain separation — the digest half
        # not being a cross-purpose join key — so the digest half is what has to be
        # compared. `ClusterKeyring.pseudonym`'s docstring records the same value and
        # the same reasoning.
        left = keyring.pseudonym("a", "40").rsplit("_", 1)[1]
        right = keyring.pseudonym("b", "40").rsplit("_", 1)[1]
        self.assertNotEqual(
            left,
            right,
            "one raw value on two axes must not produce one MAC: the digest half "
            "travels into reports and would be a join key across the two axes",
        )


class GroupAxisStateTests(unittest.TestCase):
    """The three states R6 allows, in the shape benchmark/schema.ts accepts."""

    def test_the_axis_list_mirrors_the_sealed_schema(self) -> None:
        import re as _re

        from group_axes import V3_GROUP_AXES

        source = (
            Path(__file__).resolve().parent.parent / "schema.ts"
        ).read_text(encoding="utf-8")
        block = source.split("export const V3_GROUP_AXES = [", 1)[1].split("]", 1)[0]
        self.assertEqual(list(V3_GROUP_AXES), _re.findall(r'"([a-zA-Z]+)"', block))

    def test_known_carries_an_id_and_the_others_carry_a_reason(self) -> None:
        from group_axes import known, not_applicable, unknown

        self.assertEqual(known("thread_7"), {"state": "known", "id": "thread_7"})
        self.assertEqual(
            not_applicable("no single author"),
            {"state": "notApplicable", "reason": "no single author"},
        )
        self.assertEqual(
            unknown("deleted account"),
            {"state": "unknown", "reason": "deleted account"},
        )

    def test_a_state_without_its_justification_is_refused(self) -> None:
        from group_axes import not_applicable, unknown

        # The reason is mandatory for exactly the failure mode R6 names: a producer
        # writing notApplicable to dodge ineligibility. A reason is something a
        # reviewer can disagree with; an empty string is not.
        for factory in (not_applicable, unknown):
            with self.assertRaises(ValueError):
                factory("")

    def test_known_refuses_a_raw_identifier_carrying_a_pii_separator(self) -> None:
        from group_axes import known

        # "." is the separator this project treats as PII-shaped, and the sealed
        # schema refuses it. Catching it here means the assembler fails on the lab
        # bench instead of after a full ingest run.
        with self.assertRaises(ValueError):
            known("gemini-3.5-flash-lite")

    def test_known_refuses_an_empty_identifier_with_its_own_diagnosis(self) -> None:
        from group_axes import known

        # A DIFFERENT refusal from the one above, and asserted on the MESSAGE rather
        # than on the exception type, because the type alone pins nothing here. I
        # measured it: `PSEUDONYM` is `^[A-Za-z0-9_-]+$`, and `+` does not match the
        # empty string, so with the dedicated guard replaced by `if False:` the regex
        # branch still raises ValueError — `'' is not a pseudonym token …`. A bare
        # assertRaises therefore CANNOT die under that mutation, and the only thing
        # the dedicated guard contributes is the diagnosis.
        #
        # That diagnosis is worth keeping and worth pinning, because the two failures
        # tell an author to do opposite things. "Slug it" is the fix for a bad
        # character; it is the WRONG fix for an empty identifier, where there is no
        # identity to slug and the real problem is that an empty string reads back as
        # `unknown` through `groupAxisState` — so `{"state": "known", "id": ""}` is a
        # record stating the opposite of what it means.
        with self.assertRaisesRegex(ValueError, "reads back as"):
            known("")


class SourceIdentityTests(unittest.TestCase):
    """Each extractor emits the identity the plan fixes for its source."""

    def setUp(self) -> None:
        self.keyring = FIXTURE_KEYRING

    def test_stackexchange_emits_thread_and_author(self) -> None:
        import extract_stackexchange

        xml = (
            "<posts>"
            f'<row Id="2" PostTypeId="1" CreationDate="2013-12-11T15:51:07.527"'
            f' OwnerUserId="40" Body="&lt;p&gt;{PROSE_60}&lt;/p&gt;" />'
            f'<row Id="4" PostTypeId="2" ParentId="2"'
            f' CreationDate="2013-12-11T15:54:31.357" OwnerUserId="57"'
            f' Body="&lt;p&gt;{PROSE_60}&lt;/p&gt;" />'
            f'<row Id="9" PostTypeId="2" ParentId="2"'
            f' CreationDate="2013-12-12T10:00:00.000"'
            f' Body="&lt;p&gt;{PROSE_60}&lt;/p&gt;" />'
            "</posts>"
        )
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "Posts.xml"
            path.write_text(xml, encoding="utf-8")
            rows, _ = run_writer(
                Path(raw),
                "ptso",
                lambda w: extract_stackexchange.extract(path, w, keyring=self.keyring),
            )
        self.assertEqual(len(rows), 3)
        axes = [r["meta"]["groupAxes"] for r in rows]
        # THREAD: the question is its own thread, and both answers belong to it. So
        # the three rows form ONE cluster of three on the `source` axis, which is
        # exactly what `g_<recordId>` could never express.
        self.assertEqual(axes[0]["source"], {"state": "known", "id": "ptso_thread_2"})
        self.assertEqual(axes[1]["source"], axes[0]["source"])
        self.assertEqual(axes[2]["source"], axes[0]["source"])
        # AUTHOR: two different real accounts, pseudonymised, never the raw id.
        self.assertEqual(axes[0]["author"]["state"], "known")
        self.assertNotEqual(axes[0]["author"]["id"], axes[1]["author"]["id"])
        self.assertNotIn("40", axes[0]["author"]["id"])
        # A post with NO OwnerUserId is a deleted account: the author exists and was
        # not recovered, which is `unknown` (the record becomes ineligible) and
        # never a synthesized token.
        self.assertEqual(axes[2]["author"]["state"], "unknown")
        self.assertTrue(axes[2]["author"]["reason"])

    def test_stackexchange_without_a_keyring_refuses_to_run(self) -> None:
        import extract_stackexchange
        from pseudonymize import ClusterKeyringMissing

        xml = (
            "<posts>"
            f'<row Id="2" PostTypeId="1" CreationDate="2013-12-11T15:51:07.527"'
            f' OwnerUserId="40" Body="&lt;p&gt;{PROSE_60}&lt;/p&gt;" />'
            "</posts>"
        )
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "Posts.xml"
            path.write_text(xml, encoding="utf-8")
            with self.assertRaises(ClusterKeyringMissing):
                run_writer(
                    Path(raw),
                    "ptso",
                    lambda w: extract_stackexchange.extract(path, w, keyring=None),
                )

    def test_wikipedia_emits_the_page_and_says_author_does_not_apply(self) -> None:
        page = (
            '<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.10/">'
            "<page><title>T</title><ns>0</ns><id>99</id><revision>"
            "<timestamp>2021-05-01T00:00:00Z</timestamp>"
            f"<text>{PROSE_60}</text>"
            "</revision></page></mediawiki>"
        )
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "ptwiki.xml.bz2"
            path.write_bytes(bz2.compress(page.encode("utf-8")))
            rows, _ = run_writer(
                Path(raw), "wiki", lambda w: extract_wikipedia.extract(path, w)
            )
        axes = rows[0]["meta"]["groupAxes"]
        self.assertEqual(axes["source"], {"state": "known", "id": "ptwiki_page_99"})
        # NOT `unknown`: a Wikipedia article is collectively written, so there is no
        # single author to recover. notApplicable is legitimate and does NOT cost
        # the record its eligibility — that distinction is the whole of R6.
        self.assertEqual(axes["author"]["state"], "notApplicable")
        self.assertTrue(axes["author"]["reason"])

    def test_b2w_emits_product_and_reviewer(self) -> None:
        import extract_b2w

        header = "submission_date,reviewer_id,product_id,review_title,review_text\n"
        body = (
            f"2018-01-01 00:11:28,rev_aaa,132532965,Bom,{PROSE_60}\n"
            f"2018-01-02 00:11:28,rev_bbb,132532965,Otimo,{PROSE_60} extra\n"
        )
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "b2w.csv"
            path.write_text(header + body, encoding="utf-8")
            rows, _ = run_writer(
                Path(raw),
                "b2w",
                lambda w: extract_b2w.extract(path, w, keyring=self.keyring),
            )
        self.assertEqual(len(rows), 2)
        axes = [r["meta"]["groupAxes"] for r in rows]
        # PRODUCT: two reviews of one product are one cluster of two.
        self.assertEqual(
            axes[0]["source"], {"state": "known", "id": "b2w_product_132532965"}
        )
        self.assertEqual(axes[1]["source"], axes[0]["source"])
        # REVIEWER: personal data even though the base is public, so HMAC and never
        # the raw column — B2W already ships a digest there, and a digest of a
        # digest is still the same join key.
        self.assertEqual(axes[0]["author"]["state"], "known")
        self.assertNotEqual(axes[0]["author"]["id"], axes[1]["author"]["id"])
        self.assertNotIn("rev_aaa", axes[0]["author"]["id"])

    def test_b2w_without_a_keyring_refuses_to_run(self) -> None:
        import extract_b2w
        from pseudonymize import ClusterKeyringMissing

        header = "submission_date,reviewer_id,product_id,review_title,review_text\n"
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "b2w.csv"
            path.write_text(
                header + f"2018-01-01 00:11:28,rev_aaa,1,Bom,{PROSE_60}\n",
                encoding="utf-8",
            )
            with self.assertRaises(ClusterKeyringMissing):
                run_writer(
                    Path(raw),
                    "b2w",
                    lambda w: extract_b2w.extract(path, w, keyring=None),
                )

    def test_carolina_emits_the_member_file(self) -> None:
        import extract_carolina

        tei = (
            '<teiCorpus xmlns="http://www.tei-c.org/ns/1.0">'
            "<TEI><teiHeader><fileDesc><publicationStmt>"
            '<date type="Download">2021-05-21</date>'
            "<availability><licence>CC BY-NC-SA 4.0</licence></availability>"
            "</publicationStmt></fileDesc></teiHeader>"
            f"<text><body><p>{PROSE_60}</p></body></text></TEI>"
            "<TEI><teiHeader><fileDesc><publicationStmt>"
            '<date type="Download">2021-05-22</date>'
            "<availability><licence>CC BY-NC-SA 4.0</licence></availability>"
            "</publicationStmt></fileDesc></teiHeader>"
            f"<text><body><p>{PROSE_60} outro</p></body></text></TEI>"
            "</teiCorpus>"
        )
        member = "Corpus/university_domains/uni.xml"
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "archive.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(member, tei)
            rows, _ = run_writer(
                Path(raw), "carolina", lambda w: extract_carolina.extract(path, w)
            )
        self.assertEqual(len(rows), 2)
        axes = [r["meta"]["groupAxes"] for r in rows]
        # The MEMBER FILE is the axis the plan fixes for Carolina, and two TEI
        # documents of one member share it — a real cluster of two.
        self.assertEqual(
            axes[0]["source"],
            {
                "state": "known",
                "id": "carolina_member_Corpus_university_domains_uni_xml",
            },
        )
        self.assertEqual(axes[1]["source"], axes[0]["source"])
        # The extractor deliberately never reads TEI header names, so there is no
        # author to pseudonymise and nothing was lost.
        self.assertEqual(axes[0]["author"]["state"], "notApplicable")

    def test_every_source_declares_the_axes_the_plan_fixes_for_it(self) -> None:
        from group_axes import SOURCE_DECLARED_AXES

        # Requirement 2 of the brief, as data: these domain sources and these axes,
        # no invented extra and none omitted. `source` is the thread / page /
        # product / member file; `author` is the post author or the reviewer, and
        # ONLY those two sources have one.
        self.assertEqual(
            {source: sorted(axes) for source, axes in SOURCE_DECLARED_AXES.items()},
            {
                "ptso_qa": ["author", "source"],
                "ptwiki_lead": ["source"],
                "b2w_reviews": ["author", "source"],
                "carolina_datasets_and_other_corpora": ["source"],
                "carolina_judicial_branch": ["source"],
                "carolina_legislative_branch": ["source"],
                "carolina_public_domain_works": ["source"],
                "carolina_social_media": ["source"],
                "carolina_university_domains": ["source"],
            },
        )


class CandidateIdStabilityTests(unittest.TestCase):
    """The re-extraction must not renumber the corpus."""

    def test_the_natural_key_strings_digest_to_the_values_measured_before_c2(
        self,
    ) -> None:
        import hashlib

        # WHAT THIS TEST DOES AND DOES NOT PROVE. It pins the four natural-key
        # STRINGS measured on the tree at eae6ce6, before C2 touched an extractor,
        # against their digests — and that is a statement about hashlib plus a
        # written record of the strings, NOT about what any extractor builds. Nothing
        # here connects these four literals to the code that constructs them: a
        # renamed key (`ptwiki-page:{page_id}`) leaves this test green.
        #
        # The tests below are the ones that close the loop, by running each real
        # extractor over a fixture and asserting the WHOLE candidateId. This one
        # stays because it is the historical receipt: if an extractor's key changes
        # deliberately, the end-to-end assertion moves and this one shows what the
        # id used to be derived from.
        for natural_key, digest in (
            ("ptso:2", "2a96d0991f15"),
            ("ptso:4", "9b92587c3035"),
            ("ptwiki:99", "ffb6a33e6516"),
            ("carolina:Corpus/university_domains/uni.xml:1", "929963677b0d"),
        ):
            self.assertEqual(
                hashlib.sha1(natural_key.encode("utf-8")).hexdigest()[:12],
                digest,
                natural_key,
            )

    # The three end-to-end halves. Each runs the REAL extractor over the same
    # fixture its axis test uses and asserts the whole candidateId, so a natural key
    # renamed anywhere in `extract_*.py` fails on its own line. `run_writer` names
    # the writer `src_<name>`, which is why the whole id is comparable and not only
    # its digest half — the digest half is the part the natural key decides.
    #
    # Requirement 3 of the brief calls id stability "o ativo": every mixed row's
    # `parentId`, every AI row's `pairedWith`, every ledger row and every
    # `promptId` names a candidateId, so renumbering one source silently unhooks
    # that source's whole lineage.

    def test_wikipedia_still_builds_the_candidate_id_measured_before_c2(self) -> None:
        page = (
            '<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.10/">'
            "<page><title>T</title><ns>0</ns><id>99</id><revision>"
            "<timestamp>2021-05-01T00:00:00Z</timestamp>"
            f"<text>{PROSE_60}</text>"
            "</revision></page></mediawiki>"
        )
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "ptwiki.xml.bz2"
            path.write_bytes(bz2.compress(page.encode("utf-8")))
            rows, _ = run_writer(
                Path(raw), "wiki", lambda w: extract_wikipedia.extract(path, w)
            )
        # sha1("ptwiki:99")[:12]. The page id is the whole natural key, so this is
        # the tightest possible pin on that extractor.
        self.assertEqual([r["candidateId"] for r in rows], ["src_wiki_ffb6a33e6516"])

    def test_carolina_still_builds_the_candidate_ids_measured_before_c2(self) -> None:
        import extract_carolina

        tei = (
            '<teiCorpus xmlns="http://www.tei-c.org/ns/1.0">'
            "<TEI><teiHeader><fileDesc><publicationStmt>"
            '<date type="Download">2021-05-21</date>'
            "<availability><licence>CC BY-NC-SA 4.0</licence></availability>"
            "</publicationStmt></fileDesc></teiHeader>"
            f"<text><body><p>{PROSE_60}</p></body></text></TEI>"
            "<TEI><teiHeader><fileDesc><publicationStmt>"
            '<date type="Download">2021-05-22</date>'
            "<availability><licence>CC BY-NC-SA 4.0</licence></availability>"
            "</publicationStmt></fileDesc></teiHeader>"
            f"<text><body><p>{PROSE_60} outro</p></body></text></TEI>"
            "</teiCorpus>"
        )
        member = "Corpus/university_domains/uni.xml"
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "archive.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr(member, tei)
            rows, _ = run_writer(
                Path(raw), "carolina", lambda w: extract_carolina.extract(path, w)
            )
        # sha1("carolina:<member>:<sequence>")[:12] for sequence 1 and 2. The
        # SEQUENCE is in the key, which is why two TEI documents of one member get
        # two ids while sharing the `source` axis — and why re-ordering the
        # documents inside a member would renumber both.
        self.assertEqual(
            [r["candidateId"] for r in rows],
            ["src_carolina_929963677b0d", "src_carolina_3f8b653ef23c"],
        )

    def test_b2w_still_builds_the_candidate_ids_measured_before_c2(self) -> None:
        import extract_b2w

        header = "submission_date,reviewer_id,product_id,review_title,review_text\n"
        body = (
            f"2018-01-01 00:11:28,rev_aaa,132532965,Bom,{PROSE_60}\n"
            f"2018-01-02 00:11:28,rev_bbb,132532965,Otimo,{PROSE_60} extra\n"
        )
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "b2w.csv"
            path.write_text(header + body, encoding="utf-8")
            rows, _ = run_writer(
                Path(raw),
                "b2w",
                lambda w: extract_b2w.extract(path, w, keyring=FIXTURE_KEYRING),
            )
        # sha1("<submission_date>|<product>|<body[:80]>")[:12]. B2W has no row id at
        # all, so the key is CONTENT-derived and every one of its three parts is
        # load-bearing: the two fixture rows share product and the first 80
        # characters of body, so only the date separates them. Narrowing the body
        # slice, dropping the date or reading `product_name` where the axis reads
        # `product_id` all renumber the source, and all three fail here.
        self.assertEqual(
            [r["candidateId"] for r in rows],
            ["src_b2w_c5d52edc9f7c", "src_b2w_404f6fe8d385"],
        )

    def test_adding_identity_to_meta_leaves_every_candidate_id_unchanged(self) -> None:
        import extract_stackexchange
        from pseudonymize import ClusterKeyring

        xml = (
            "<posts>"
            f'<row Id="2" PostTypeId="1" CreationDate="2013-12-11T15:51:07.527"'
            f' OwnerUserId="40" Body="&lt;p&gt;{PROSE_60}&lt;/p&gt;" />'
            f'<row Id="4" PostTypeId="2" ParentId="2"'
            f' CreationDate="2013-12-11T15:54:31.357" OwnerUserId="57"'
            f' Body="&lt;p&gt;{PROSE_60}&lt;/p&gt;" />'
            "</posts>"
        )
        keyring = ClusterKeyring("v1", {"person": "ab" * 32})
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "Posts.xml"
            path.write_text(xml, encoding="utf-8")
            rows, _ = run_writer(
                Path(raw),
                "ptso",
                lambda w: extract_stackexchange.extract(path, w, keyring=keyring),
            )
        # run_writer names the writer `src_ptso`, the same source id the real run
        # uses, so the WHOLE id is comparable and not only its digest half.
        self.assertEqual(
            [r["candidateId"] for r in rows],
            ["src_ptso_2a96d0991f15", "src_ptso_9b92587c3035"],
        )
        # And a SECOND run with a different keyring changes the author pseudonym
        # without moving the id: identity is not part of the natural key.
        other = ClusterKeyring("v1", {"person": "cd" * 32})
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "Posts.xml"
            path.write_text(xml, encoding="utf-8")
            again, _ = run_writer(
                Path(raw),
                "ptso",
                lambda w: extract_stackexchange.extract(path, w, keyring=other),
            )
        self.assertEqual(
            [r["candidateId"] for r in rows], [r["candidateId"] for r in again]
        )
        self.assertNotEqual(
            rows[0]["meta"]["groupAxes"]["author"]["id"],
            again[0]["meta"]["groupAxes"]["author"]["id"],
        )


class AssemblerRealGroupTests(unittest.TestCase):
    """`base_groups` is gone, and no path mints an identifier per record."""

    def test_no_module_mints_a_per_record_group_token(self) -> None:
        source = (Path(__file__).resolve().parent / "assemble_corpus.py").read_text(
            encoding="utf-8"
        )
        self.assertNotIn("def base_groups", source)
        # The five f-string tokens the old block wrote. Searched as literals rather
        # than by function name so reintroducing them under ANY name fails here.
        for minted in ('f"a_{', 'f"g_{', 'f"ds_{', 'f"cb_{', 'f"nd_{'):
            self.assertNotIn(minted, source)

    def _human_candidate(self, candidate_id: str, thread: str, author: str) -> dict:
        from group_axes import known

        return {
            "candidateId": candidate_id,
            "text": PROSE_60,
            "wordCount": 60,
            "domainSource": "ptso_qa",
            "createdAt": 1386720000000,
            "meta": {
                "dateField": "Posts.xml@CreationDate",
                "observedValue": "2013-12-11T00:00:00+00:00",
                "groupAxes": {"source": known(thread), "author": known(author)},
            },
        }

    def test_two_records_of_one_thread_share_the_source_axis(self) -> None:
        from assemble_corpus import human_record

        first = human_record(
            self._human_candidate("src_ptso_aaa", "ptso_thread_2", "person_x"),
            "qa-informal",
            None,
        )
        second = human_record(
            self._human_candidate("src_ptso_bbb", "ptso_thread_2", "person_x"),
            "qa-informal",
            None,
        )
        self.assertNotEqual(first["id"], second["id"])
        # The point of the whole task: ONE cluster of two, on both axes.
        self.assertEqual(first["groups"]["source"], second["groups"]["source"])
        self.assertEqual(first["groups"]["author"], second["groups"]["author"])
        self.assertEqual(first["groups"]["source"]["id"], "ptso_thread_2")
        # ...and no axis holds the record id, which is how the old block worked —
        # with ONE exception, stated for what it is rather than dressed up.
        # `nearDuplicate` IS the row's own id, and the reason is not that the value
        # is read from somewhere better: `main()` drops every non-representative
        # before building a record, so each surviving row is the only member of its
        # near-duplicate cluster and naming that cluster after its one member is a
        # description of the pruning result. Same value as the old nd- token,
        # different justification — the old one was minted BECAUSE uniqueness made
        # the split report `leakages: []`. See near_duplicate_axis's docstring for
        # why a representative parameter was deleted instead of wired.
        for axis, value in first["groups"].items():
            if axis == "nearDuplicate" or value.get("state") != "known":
                continue
            self.assertNotIn(first["id"], value["id"], axis)
        self.assertEqual(first["groups"]["nearDuplicate"]["id"], first["id"])

    def test_the_near_duplicate_axis_is_a_function_of_the_row_alone(self) -> None:
        from assemble_corpus import near_duplicate_axis

        # Pinned as a ONE-argument function on purpose. The signature used to take a
        # `representative` that nothing ever passed, which made a docstring claim
        # ("read from the pruning result", "would collide the moment two rows shared
        # a cluster") unreachable by construction — `near_dupes.prune` returns
        # `(drop, stats)` and publishes no representative map. If a future change
        # makes pruning KEEP both members of a cluster, this test is where the new
        # shared-cluster argument has to arrive, and it must arrive from a prune that
        # actually publishes one.
        self.assertEqual(
            near_duplicate_axis("src_ptso_aaa"),
            {"state": "known", "id": "src_ptso_aaa"},
        )
        with self.assertRaises(TypeError):
            near_duplicate_axis("src_ptso_aaa", "src_ptso_bbb")  # type: ignore[call-arg]

    def test_a_human_record_states_all_twelve_axes(self) -> None:
        from assemble_corpus import human_record
        from group_axes import V3_GROUP_AXES

        record = human_record(
            self._human_candidate("src_ptso_aaa", "ptso_thread_2", "person_x"),
            "qa-informal",
            None,
        )
        self.assertEqual(sorted(record["groups"]), sorted(V3_GROUP_AXES))
        self.assertEqual(record["schemaVersion"], 3)
        # Every generation axis genuinely does not apply to a human row, and saying
        # so is a statement, not a gap: it costs the record nothing.
        for axis in ("promptTemplate", "generatorFamily", "generationLane"):
            self.assertEqual(record["groups"][axis]["state"], "notApplicable")

    def test_an_unknown_axis_is_carried_and_never_synthesized(self) -> None:
        from assemble_corpus import human_record
        from group_axes import unknown

        candidate = self._human_candidate("src_ptso_ccc", "ptso_thread_2", "person_x")
        candidate["meta"]["groupAxes"]["author"] = unknown("conta removida")
        record = human_record(candidate, "qa-informal", None)
        self.assertEqual(record["groups"]["author"]["state"], "unknown")
        self.assertNotIn("id", record["groups"]["author"])


class LaneIdentityTests(unittest.TestCase):
    """The generated record names its lane, and the lane decides the rest."""

    def _ai_candidate(self, provider: str, model: str, recipe: str) -> dict:
        import hashlib

        lanes = {
            "agy": "agy",
            "codex": "codex",
            "gemini": "gemini-api",
            "gemini_cli": "gemini-cli",
        }
        return {
            "candidateId": f"src_ai_{provider}_deadbeef",
            "text": PROSE_60,
            "wordCount": 60,
            "meta": {
                "provider": provider,
                "family": model,
                "model": model,
                "version": model,
                "recipe": recipe,
                "generationLane": lanes[provider],
                "promptId": f"{recipe}_src_b2w_00848b3bc692",
                "promptSha256": hashlib.sha256(b"p").hexdigest(),
                "promptTemplateDigest": hashlib.sha256(b"t").hexdigest(),
                "pairedWith": "src_b2w_00848b3bc692",
                "generatedAt": "2026-07-24T13:51:05.004170+00:00",
            },
        }

    def test_an_api_lane_carries_the_temperature_it_actually_applied(self) -> None:
        from assemble_corpus import ai_record

        candidate = self._ai_candidate("gemini", "gemini-3.5-flash-lite", "original")
        candidate["meta"]["temperature"] = "0.8"
        record = ai_record(candidate)
        self.assertEqual(
            record["groups"]["generationLane"], {"state": "known", "id": "gemini-api"}
        )
        self.assertTrue(record["generation"]["decoding"]["configurable"])
        self.assertEqual(record["generation"]["decoding"]["temperature"], 0.8)
        # gemini-api runs no harness binary, so the axis genuinely does not apply.
        self.assertEqual(record["groups"]["harnessVersion"]["state"], "notApplicable")

    def test_a_cli_lane_refuses_the_temperature_the_pool_carries(self) -> None:
        from assemble_corpus import ai_record

        # MEASURED: generate_ai.py wrote "temperature": "0.8" into the meta of every
        # provider, including the three CLI lanes it invokes with no sampling flag.
        # The frozen policy sets decodingConfigurable false for them, so the number
        # describes nothing and the record must not carry it.
        candidate = self._ai_candidate("agy", "gemini-3.5-flash-medium", "original")
        candidate["meta"]["temperature"] = "0.8"
        record = ai_record(candidate)
        self.assertEqual(record["generation"]["decoding"], {"configurable": False})

    def test_an_uncaptured_harness_version_is_unknown_and_not_invented(self) -> None:
        from assemble_corpus import ai_record

        candidate = self._ai_candidate("agy", "claude-sonnet-4-6", "original")
        record = ai_record(candidate)
        # agy is an agent-CLI lane: claiming notApplicable would be false about it,
        # and inventing a version string would be false about the world. `unknown`
        # is true and costs the record its eligibility.
        self.assertEqual(record["groups"]["harnessVersion"]["state"], "unknown")
        candidate["meta"]["harnessVersion"] = "0.145.0"
        seen = ai_record(candidate)
        self.assertEqual(
            seen["groups"]["harnessVersion"], {"state": "known", "id": "0_145_0"}
        )

    def test_exactly_one_of_a_seed_and_a_written_reason_travels(self) -> None:
        from assemble_corpus import ai_record

        # The sealed schema demands exactly one, and never a seed we made up (D3
        # repeats the same rule). The pools carry the pair already — `"seed": ""` plus
        # a reason — and an EMPTY seed is not a seed: writing both keys, or writing
        # `seed: ""`, are the two ways to fail this.
        candidate = self._ai_candidate("agy", "claude-sonnet-4-6", "original")
        candidate["meta"]["seed"] = ""
        candidate["meta"]["seedNullReason"] = "provider API does not expose a seed"
        generation = ai_record(candidate)["generation"]
        self.assertNotIn("seed", generation)
        self.assertEqual(
            generation["seedNullReason"], "provider API does not expose a seed"
        )
        # A lane that DOES expose one carries the seed and no reason.
        candidate["meta"]["seed"] = "712019"
        generation = ai_record(candidate)["generation"]
        self.assertEqual(generation["seed"], "712019")
        self.assertNotIn("seedNullReason", generation)

    def test_a_row_with_neither_a_seed_nor_a_reason_gets_the_lane_default(self) -> None:
        from assemble_corpus import SEED_NULL_REASON, ai_record

        # No provider on any of the four frozen lanes exposes a sampling seed, and
        # that is a property of the LANES rather than of a pool row, so a row that
        # recorded neither gets the reason and never a synthesized seed. The default
        # fills in the REASON, which is the safe half of the pair to default.
        candidate = self._ai_candidate("agy", "claude-sonnet-4-6", "original")
        generation = ai_record(candidate)["generation"]
        self.assertNotIn("seed", generation)
        self.assertEqual(generation["seedNullReason"], SEED_NULL_REASON)

    def test_a_codex_row_without_a_recorded_effort_level_is_refused(self) -> None:
        from assemble_corpus import MissingRecipe, ai_record

        # MEASURED against the frozen policy, and it is a real blocker rather than a
        # quirk: `generationLanes.codex.effortSources` is ["flag", "provider-default"]
        # and NEITHER is "not-supported", while both of those EffortConfig branches
        # require a `level`. generate_ai.py never recorded one. So a codex row cannot
        # be written as v3 until the level is observed, and it is refused instead of
        # being given a level nobody read. Loosening the policy to admit
        # "not-supported" on codex would be relaxing a frozen contract to make data
        # fit (R3), which is not this task's call.
        candidate = self._ai_candidate("codex", "gpt-5.6-luna", "original")
        with self.assertRaises(MissingRecipe) as caught:
            ai_record(candidate)
        self.assertIn("not-supported", str(caught.exception))
        # With the level observed, the same row writes cleanly — so the refusal is
        # about the missing datum and not about the lane.
        candidate["meta"]["effortLevel"] = "medium"
        candidate["meta"]["effortSource"] = "flag"
        record = ai_record(candidate)
        self.assertEqual(
            record["generation"]["effort"],
            {
                "source": "flag",
                "configurable": True,
                "scale": "codex-reasoning-effort",
                "level": "medium",
            },
        )

    def test_effort_is_never_derived_from_the_model_name_suffix(self) -> None:
        from assemble_corpus import ai_record

        # `gpt-oss-120b-medium` EMBEDS its effort in the model id and `--effort`
        # exists as a session flag in parallel, so the precedence between them is
        # undetermined (to be measured by --dry-run before D3). Reading "medium" off
        # the suffix would be an identity we made up, which R6 forbids.
        candidate = self._ai_candidate("agy", "gpt-oss-120b-medium", "original")
        record = ai_record(candidate)
        self.assertEqual(
            record["generation"]["effort"],
            {"source": "not-supported", "configurable": False},
        )
        # When the lane DID record a level, it travels with its scale.
        candidate["meta"]["effortLevel"] = "medium"
        candidate["meta"]["effortSource"] = "model-id"
        record = ai_record(candidate)
        self.assertEqual(
            record["generation"]["effort"],
            {
                "source": "model-id",
                "configurable": False,
                "scale": "agy-model-id-tier",
                "level": "medium",
            },
        )

    def test_a_provider_outside_the_frozen_lanes_is_refused(self) -> None:
        from assemble_corpus import UnmappableLane, ai_record

        candidate = self._ai_candidate("gemini", "gemini-3.5-flash-lite", "original")
        candidate["meta"]["provider"] = "anthropic"
        del candidate["meta"]["generationLane"]
        # Four lanes are frozen. A fifth is not a lane to add here: the record has
        # no admissible `generationLane`, so it leaves the corpus rather than
        # borrowing a lane it never ran on.
        with self.assertRaises(UnmappableLane):
            ai_record(candidate)

    def test_a_pool_row_with_no_recipe_at_all_is_refused(self) -> None:
        from assemble_corpus import UnmappableLane, ai_record

        # MEASURED: ai_reserved.jsonl holds 1476 rows carrying only
        # {id, text, family, recipe, pairedWith, split} — no provider, no lane, no
        # template digest. `generationLane` must be `known` on an `ai` row, so these
        # cannot be written as v3 at all, and the honest outcome is to drop them.
        #
        # UnmappableLane and not MissingRecipe: such a row is missing BOTH its lane
        # and its template digest, and the lane is refused first because
        # `groups.generationLane` must be `known` on every ai row while the template
        # digest is a second requirement on top. Both derive from UnwritableInV3, so
        # the assembler's drop path catches either.
        with self.assertRaises(UnmappableLane):
            ai_record(
                {
                    "candidateId": "src_ai_reserved_1",
                    "text": PROSE_60,
                    "wordCount": 60,
                    "meta": {"family": "madras:synthetic_corpusqwn"},
                }
            )


class DerivationLineageTests(unittest.TestCase):
    """seed -> generation -> derivative, resolvable from the row."""

    def test_a_generated_record_resolves_its_human_seed(self) -> None:
        from assemble_corpus import ai_record

        candidate = LaneIdentityTests()._ai_candidate(
            "gemini", "gemini-3.5-flash-lite", "original"
        )
        candidate["meta"]["temperature"] = "0.8"
        record = ai_record(candidate)
        # The parent comes from `meta.pairedWith` here, which the fixture carries;
        # `promptId` is present too but `ai_record` reads `pairedWith` FIRST, so this
        # test does not exercise `parent_of_prompt`. The promptId-only path is pinned
        # by test_a_legacy_row_recovers_its_parent_from_the_prompt_id_alone below —
        # keeping the two apart matters, because a pool row written before
        # `pairedWith` existed has only the promptId to go on.
        self.assertEqual(
            record["groups"]["humanSeed"],
            {"state": "known", "id": "src_b2w_00848b3bc692"},
        )
        self.assertEqual(record["groups"]["derivationRoot"]["state"], "notApplicable")

    def test_a_paraphrase_resolves_both_the_seed_and_the_derivation(self) -> None:
        from assemble_corpus import ai_record

        candidate = LaneIdentityTests()._ai_candidate(
            "gemini", "gemini-3.5-flash-lite", "parafrase"
        )
        candidate["meta"]["temperature"] = "0.8"
        record = ai_record(candidate)
        # `parafrase` REWRITES the parent text, so this row IS a derivation of it.
        # The parent again comes from `pairedWith`, not from the promptId.
        self.assertEqual(
            record["groups"]["derivationRoot"],
            {"state": "known", "id": "src_b2w_00848b3bc692"},
        )
        self.assertEqual(record["groups"]["humanSeed"]["id"], "src_b2w_00848b3bc692")

    def test_a_legacy_row_recovers_its_parent_from_the_prompt_id_alone(self) -> None:
        from assemble_corpus import ai_record

        candidate = LaneIdentityTests()._ai_candidate(
            "gemini", "gemini-3.5-flash-lite", "original"
        )
        candidate["meta"]["temperature"] = "0.8"
        # The ONLY path that can recover a parent for a pool row written before
        # `pairedWith` existed. Removing the field is the whole point of the fixture:
        # with it present `ai_record` never calls `parent_of_prompt`, so the function
        # requirement 5 names by format (`original_src_b2w_00848b3bc692`) was reached
        # by no test at all.
        del candidate["meta"]["pairedWith"]
        record = ai_record(candidate)
        self.assertEqual(
            record["groups"]["humanSeed"],
            {"state": "known", "id": "src_b2w_00848b3bc692"},
        )

    def test_the_prompt_id_splits_on_the_first_underscore_not_the_last(self) -> None:
        from assemble_corpus import parent_of_prompt

        # A candidate id CONTAINS underscores (`src_b2w_00848b3bc692`), so the split
        # has to take everything after the FIRST one. Splitting on the last returns
        # the bare hex fragment `00848b3bc692`, which resolves to no record in the
        # corpus — a silent lineage break, not an error. Asserted directly because
        # the recipe name is the only part that varies and a two-underscore recipe
        # would otherwise look the same as a one-underscore one.
        self.assertEqual(
            parent_of_prompt("original_src_b2w_00848b3bc692"), "src_b2w_00848b3bc692"
        )
        self.assertEqual(
            parent_of_prompt("parafrase_src_ptso_0f89e00a4836"),
            "src_ptso_0f89e00a4836",
        )
        # No underscore at all, and an empty tail, are both "no parent" rather than
        # a fragment: naming a parent we cannot name is what R6 forbids.
        self.assertIsNone(parent_of_prompt("original"))
        self.assertIsNone(parent_of_prompt("original_"))
        self.assertIsNone(parent_of_prompt(""))

    def test_a_mixed_record_resolves_the_parent_it_was_edited_from(self) -> None:
        import hashlib

        from assemble_corpus import mixed_record

        candidate = {
            "parentId": "src_ptso_0f89e00a4836",
            "text": PROSE_60,
            "provider": "antigravity",
            "model": "gemini-3.6-flash-low",
            "generatedAt": "2026-07-23T18:53:31.606876+00:00",
            "promptTemplateId": "edit_v1",
            "promptTemplateDigest": hashlib.sha256(b"edit").hexdigest(),
            "parentFamily": "ptso_qa",
            "mixture": {
                "spans": [
                    {"start": 0, "end": 200, "origin": "human"},
                    {"start": 200, "end": len(PROSE_60), "origin": "ai"},
                ]
            },
        }
        record = mixed_record(candidate)
        parent = "src_ptso_0f89e00a4836"
        self.assertEqual(
            record["groups"]["derivationRoot"], {"state": "known", "id": parent}
        )
        self.assertEqual(record["groups"]["humanSeed"], {"state": "known", "id": parent})
        # A mechanistic mixed row is a human text WE edited, so the recipe is ours
        # and the row must carry it (schema.ts refuses a mechanistic row without).
        self.assertEqual(record["mixture"]["generationMode"], "mechanistic")
        self.assertEqual(record["groups"]["generationLane"]["id"], "agy")
        # ...and the derivation root is the parent, never the record itself, which
        # `groups.derivationRoot must not name the record itself` refuses.
        self.assertNotEqual(record["groups"]["derivationRoot"]["id"], record["id"])

    def test_a_mixed_row_with_no_recorded_template_is_refused(self) -> None:
        from assemble_corpus import MissingRecipe, mixed_record

        candidate = {
            "parentId": "src_ptso_0f89e00a4836",
            "text": PROSE_60,
            "provider": "antigravity",
            "model": "gemini-3.6-flash-low",
            "generatedAt": "2026-07-23T18:53:31.606876+00:00",
            "parentFamily": "ptso_qa",
            "mixture": {
                "spans": [{"start": 0, "end": len(PROSE_60), "origin": "human"}]
            },
        }
        # The mixing template digest is not recoverable from a pool row that never
        # recorded it. Guessing it from whichever template is in make_mixed.py TODAY
        # would attach a recipe the row cannot support, so the row leaves instead.
        with self.assertRaises(MissingRecipe):
            mixed_record(candidate)


class GenerationBatchAxisTests(unittest.TestCase):
    """`groups.collectionBatch` — the `batch` axis requirement 2 fixes for the IA source.

    THIS AXIS WAS REACHED BY NO TEST IN ANY LANGUAGE before this class. `ai_record`
    and `mixed_record` both write `unknown("the generation batch is derived after
    partitioning")`, and only `assign_generation_batches` — called once, from
    `main()`, after `assign_partitions` — turns that into a `known` `gb_` id. Two
    mutations measured the gap on the committed tree at c3362ca, and BOTH left the
    lab suite at 86 tests OK:

      * `return []` at the top of `assign_generation_batches`: every generated row
        keeps `collectionBatch: unknown`, so all 540 generated records of the
        delivered run become UNWRITABLE — `AXIS_STATE_RULE.collectionBatch` allows
        only `known` in every axis class, so `validate` refuses each one — while on
        the bench side the axis that feeds E3's power gate goes from the 27 clusters
        the delivered cluster-report.json publishes to **4**, over 246 grouped rows
        instead of 786, with the largest cluster moving `gb_mixed_0020`/90 ->
        `extraction_wikipedia_fresh`/73. (ERRATA, twice over: this bullet first said
        the 540 "turn INELIGIBLE", which is the price on `harnessVersion` and not on
        this axis; the correction then said the clusters go "to 0", which is also
        wrong and in the flattering direction — the four human `extraction_*` clusters
        survive, because `assign_generation_batches` never touches human rows. Both
        measurements, and the per-slice cells that DO go to 0, are in the comment on
        `test_no_generated_record_is_left_unknown_on_the_batch_axis`.);
      * the human fallback `f"extraction_{cand['domainSource']}"` rewritten to
        `"batch_x"`, even though `assign_generation_batches`' own docstring calls the
        `extraction_` prefix "structural rather than incidental" because it "cannot
        collide with a `gb_` id" — the governance audit refuses a non-generated
        record that names a declared generation batch.

    The two failures are opposite in kind, which is why both directions are pinned
    here: the first writes a corpus the sealed `validate` then refuses record by
    record, having stripped the power axis of every GENERATED row — not of every row,
    which is what makes it look survivable on the bench side — without raising
    anything where the corpus was built; the second manufactures a collision that
    surfaces only when the sealed audit runs, long after the corpus is written. Both
    are cheap here and expensive there, which is the whole reason the bench guard
    exists beside the schema one rather than instead of it.
    """

    TEMPLATE_DIGEST = "b" * 64

    def _api_candidate(self, candidate_id: str, **meta_overrides) -> dict:
        """One `gemini-api` pool row. Every batch-key component is a parameter.

        The lane is DECLARED (`generationLane`) rather than inferred from `provider`,
        because `lane_of` lets the declaration win — which is what makes `provider`
        variable independently of the lane, and therefore separately pinnable below.
        """
        meta = {
            "provider": "gemini",
            "generationLane": "gemini-api",
            "family": "gemini-3.5-flash-lite",
            "model": "gemini-3.5-flash-lite",
            "version": "gemini-3.5-flash-lite",
            "recipe": "original",
            "promptId": "original_src_b2w_00848b3bc692",
            "promptSha256": self.TEMPLATE_DIGEST,
            "promptTemplateDigest": self.TEMPLATE_DIGEST,
            "pairedWith": "src_b2w_00848b3bc692",
            "temperature": "0.8",
        }
        meta.update(meta_overrides)
        return {
            "candidateId": candidate_id,
            "text": PROSE_60,
            "wordCount": 60,
            "meta": meta,
        }

    def _mixed_candidate(self, parent_id: str, **overrides) -> dict:
        """A mixed pool row whose recipe matches `_api_candidate`'s exactly.

        Same provider, same declared lane, same model/family/version string, same
        template digest, same temperature, no seed — so when it is batched beside an
        AI row the ONLY differing component of the batch key is
        `provenance.sourceId` (`src_mixed` against `src_ai`). That isolation is the
        point: the batch ID embeds `rec["label"]` but the batch KEY does not, so
        without `sourceId` in the key a mixed record would link a `gb_ai_` batch.
        """
        row = {
            "parentId": parent_id,
            "text": PROSE_60,
            "provider": "gemini",
            "generationLane": "gemini-api",
            "model": "gemini-3.5-flash-lite",
            "promptTemplateId": "original",
            "promptTemplateDigest": self.TEMPLATE_DIGEST,
            "parentFamily": "ptso_qa",
            "temperature": "0.8",
            "mixture": {
                "spans": [
                    {"start": 0, "end": 200, "origin": "human"},
                    {"start": 200, "end": len(PROSE_60), "origin": "ai"},
                ]
            },
        }
        row.update(overrides)
        return row

    @staticmethod
    def _batched(records: list[dict], partitions: list[str] | None = None) -> list[dict]:
        """Stamp the block times, then derive the batches — main()'s real order.

        `generatedAt` is part of the batch key and is written by `stamp_block`, so
        calling `assign_generation_batches` before partitioning would key every batch
        on a missing timestamp. main() calls them in this order for that reason.
        """
        from assemble_corpus import assign_generation_batches, stamp_block

        blocks = partitions or ["development"] * len(records)
        for record, partition in zip(records, blocks):
            stamp_block(record, partition)
        return assign_generation_batches(records)

    def test_two_rows_of_one_recipe_share_one_declared_batch(self) -> None:
        from assemble_corpus import ai_record

        rows = [
            ai_record(self._api_candidate("src_ai_gemini_aaaaaaaaaaaa")),
            ai_record(self._api_candidate("src_ai_gemini_bbbbbbbbbbbb")),
        ]
        batches = self._batched(rows)
        # Two distinct records, ONE declared batch: the whole reason the axis cannot
        # be per-record. A per-record token names no batch in the reviewed manifest,
        # and that is how all 5726 generated records of the v2 run were blocked with
        # GENERATION_RECIPE_MISSING.
        self.assertNotEqual(rows[0]["id"], rows[1]["id"])
        self.assertEqual(len(batches), 1)
        axis = rows[0]["groups"]["collectionBatch"]
        self.assertEqual(axis["state"], "known")
        self.assertTrue(axis["id"].startswith("gb_ai_"), axis)
        self.assertEqual(axis, rows[1]["groups"]["collectionBatch"])
        # The axis names the batch that was actually declared, byte for byte. Without
        # this the two could agree with each other and match nothing published.
        self.assertEqual(axis["id"], batches[0]["batchId"])
        self.assertEqual(batches[0]["sourceId"], "src_ai")

    # (component name, the meta override that changes THAT component and nothing
    # else). Each row is one assertion that the component is load-bearing in the
    # batch key: drop it from the key and the pair collapses into one batch, and the
    # subTest carrying its name is the one that dies.
    RECIPE_COMPONENTS = (
        # `lane_of` prefers the DECLARED lane, so the provider label moves alone.
        ("provider", {"provider": "google-genai"}),
        ("family", {"family": "gemini-3.5-flash-low"}),
        ("model", {"model": "gemini-3.5-flash-lite-002"}),
        ("version", {"version": "gemini-3.5-flash-lite-002"}),
        ("promptTemplateDigest", {"promptTemplateDigest": "c" * 64}),
        ("decoding", {"temperature": "0.5"}),
        ("seed", {"seed": "4242"}),
    )

    def test_one_component_of_the_recipe_splits_the_batch(self) -> None:
        from assemble_corpus import ai_record

        for component, override in self.RECIPE_COMPONENTS:
            with self.subTest(component=component):
                left = ai_record(self._api_candidate("src_ai_gemini_aaaaaaaaaaaa"))
                right = ai_record(
                    self._api_candidate("src_ai_gemini_bbbbbbbbbbbb", **override)
                )
                batches = self._batched([left, right])
                self.assertEqual(len(batches), 2, component)
                self.assertNotEqual(
                    left["groups"]["collectionBatch"]["id"],
                    right["groups"]["collectionBatch"]["id"],
                    f"{component} is part of the recipe a batch declares: two rows "
                    "differing in it were generated under different conditions and "
                    "cannot be certified by one declared batch",
                )

    def test_the_effort_is_part_of_the_batch_key(self) -> None:
        from assemble_corpus import ai_record

        # On the `agy` lane, because that is where effort is expressible: gemini-api
        # offers only `not-supported` as an effort source, so an api row can carry no
        # level at all and this component would be unreachable from that fixture.
        def agy(candidate_id: str, level: str) -> dict:
            return self._api_candidate(
                candidate_id,
                provider="agy",
                generationLane="agy",
                family="gpt-oss-120b",
                model="gpt-oss-120b",
                version="gpt-oss-120b",
                effortSource="model-id",
                effortLevel=level,
            )

        left = ai_record(agy("src_ai_agy_aaaaaaaaaaaa", "low"))
        right = ai_record(agy("src_ai_agy_bbbbbbbbbbbb", "medium"))
        batches = self._batched([left, right])
        self.assertEqual(len(batches), 2)
        self.assertNotEqual(
            left["groups"]["collectionBatch"]["id"],
            right["groups"]["collectionBatch"]["id"],
        )
        # In v2 the key carried a bare temperature and no effort at all, so two runs
        # at different reasoning tiers — a real difference in what the provider was
        # asked to do — collapsed into one declared batch.
        self.assertEqual(left["generation"]["effort"]["level"], "low")
        self.assertEqual(right["generation"]["effort"]["level"], "medium")

    def test_a_batch_never_straddles_two_partitions(self) -> None:
        from assemble_corpus import ai_record

        left = ai_record(self._api_candidate("src_ai_gemini_aaaaaaaaaaaa"))
        right = ai_record(self._api_candidate("src_ai_gemini_bbbbbbbbbbbb"))
        batches = self._batched([left, right], ["development", "calibration"])
        # THE PROPERTY THAT MAKES A SHARED AXIS SAFE, and it was asserted nowhere.
        # `collectionBatch` IS a grouping axis, so two rows sharing it form one split
        # component; the docstring's argument that this cannot leak across blocks is
        # that `generatedAt` is part of the key and equals the record's block time, so
        # an identical recipe stamped into two blocks yields TWO batches. If that ever
        # stopped holding, a single batch would span development and test and the
        # split would be refused — with the corpus already written.
        self.assertEqual(len(batches), 2)
        self.assertNotEqual(
            left["groups"]["collectionBatch"]["id"],
            right["groups"]["collectionBatch"]["id"],
        )
        self.assertEqual(
            {b["generatedAt"] for b in batches},
            {left["generation"]["generatedAt"], right["generation"]["generatedAt"]},
        )

    def test_a_mixed_row_never_joins_a_generated_row_s_batch(self) -> None:
        from assemble_corpus import ai_record, mixed_record

        ai = ai_record(self._api_candidate("src_ai_gemini_aaaaaaaaaaaa"))
        mixed = mixed_record(self._mixed_candidate("src_ptso_0f89e00a4836"))
        batches = self._batched([ai, mixed])
        # The two recipes are identical in every component EXCEPT sourceId, which is
        # what this pins. The batch ID embeds `rec["label"]` while the batch KEY does
        # not, so `sourceId` is the only thing keeping a mixed record from linking a
        # batch published as `gb_ai_...` — a record whose class disagrees with the
        # batch it names.
        self.assertEqual(len(batches), 2)
        self.assertTrue(ai["groups"]["collectionBatch"]["id"].startswith("gb_ai_"))
        self.assertTrue(mixed["groups"]["collectionBatch"]["id"].startswith("gb_mixed_"))
        self.assertEqual(
            {b["sourceId"] for b in batches}, {"src_ai", "src_mixed"}
        )

    def test_no_generated_record_is_left_unknown_on_the_batch_axis(self) -> None:
        from assemble_corpus import ai_record, human_record, mixed_record

        human = human_record(
            AssemblerRealGroupTests()._human_candidate(
                "src_ptso_aaa", "ptso_thread_2", "person_x"
            ),
            "qa-informal",
            None,
        )
        records = [
            ai_record(self._api_candidate("src_ai_gemini_aaaaaaaaaaaa")),
            ai_record(self._api_candidate("src_ai_gemini_bbbbbbbbbbbb")),
            ai_record(
                self._api_candidate("src_ai_gemini_cccccccccccc", temperature="0.5")
            ),
            mixed_record(self._mixed_candidate("src_ptso_0f89e00a4836")),
            human,
        ]
        # Every generated row carries `unknown` UNTIL the batches are derived, which
        # is a true statement while it is true — `main()` closes it in the same run.
        for record in records[:-1]:
            self.assertEqual(
                record["groups"]["collectionBatch"]["state"], "unknown", record["id"]
            )
        self._batched(records)
        # THE ASSERTION THAT CATCHES THE SILENT DIRECTION: after the pass, no
        # controlled-generation record may still be `unknown` here.
        #
        # ERRATA 1. An earlier revision of this comment said an `unknown` axis "makes
        # a record ineligible (R6), so a regression that skipped rows would not raise,
        # would not print and would not fail validate". That generalisation is
        # imported from `harnessVersion`, where it holds, and it is FALSE for this
        # axis.
        #
        # ERRATA 2, which corrects the REPLACEMENT and not the original. The revision
        # that fixed ERRATA 1 said this axis "drops from the 27 clusters the delivered
        # cluster-report.json publishes to 0". That 0 was inferred too, and it is
        # wrong. Measured: the real `group_axes.cluster_report` over the delivered
        # records.jsonl (786 rows, sha256 216fbe5b…) with mutation A's effect applied
        # — the 540 controlled-generation rows put back to `unknown`, exactly the set
        # `assign_generation_batches` touches. The baseline reproduces the delivered
        # artifact exactly (clusters 27, largest gb_mixed_0020/90, ineligible 503), and
        # the mutant reports FOUR clusters, not zero:
        #
        #   BASELINE  collectionBatch clusters=27 registros_agrupados=786
        #             maior=gb_mixed_0020/90 estados={'known': 786}
        #   MUTANT    collectionBatch clusters=4  registros_agrupados=246
        #             maior=extraction_wikipedia_fresh/73
        #             estados={'known': 246, 'unknown': 540}
        #
        # The cause is stated three lines above the mutation point, in
        # `assign_generation_batches`' own docstring: "Human records are untouched here
        # and keep the `extraction_<domainSource>` batch their builder assigned". The
        # 246 human rows of the delivered corpus carry 4 distinct `extraction_*` ids
        # (41/59/73/73 rows), those 4 are already inside the delivered 27, and the
        # mutation cannot reach them. The error ran in the FLATTERING direction, which
        # is why it is corrected in place rather than quietly: `clusters=0 /
        # registros_agrupados=0` is a screaming tripwire in `render_cluster_report`,
        # while four mid-sized clusters over 246 grouped rows read like a healthy axis.
        # Four plausible clusters is a WEAKER signal than zero, so the regression is
        # MORE hidden than the previous revision claimed, not less.
        #
        # Where a 0 is the right number, named by statistic: the PER-SLICE cells, not
        # the aggregate. Every `<partition>/ai` and `<partition>/mixed` cell goes to
        # clusters=0 and grouped=0 — measured by label over the delivered corpus,
        # 20 -> 0 on ai and 3 -> 0 on mixed, which is what the delivered report's
        # per-partition generated cells sum to — while the four human cells are
        # untouched.
        #
        # What is silent and what is not, measured on the five fixtures of THIS test
        # (three `gemini-api` ai rows, one mechanistic mixed row, and the human row
        # beside them; the `agy` rows live in
        # `test_the_effort_is_part_of_the_batch_key`, not here):
        #
        #   * SILENT on the bench side in the sense that nothing raises and nothing
        #     fails: `assign_generation_batches` returning nothing raises no error and
        #     warns nothing, and `cluster_report` carries no verdict by design. Numbers
        #     do move, and some of them print. The header's `inelegiveis por eixo
        #     unknown` goes 503 -> 540, which is +37 only, because 503 of the 540
        #     generated rows are already ineligible on `harnessVersion`; the axis line's
        #     `estados` map goes {known: 786} to {known: 246, unknown: 540}, the loudest
        #     of the columns. The cluster count is the QUIETEST of them: 27 -> 4.
        #   * NOT SILENT on the sealed side. `AXIS_STATE_RULE.collectionBatch` in
        #     benchmark/schema.ts allows ONLY `known`, in all four axis classes, so
        #     `validate` -> `parseBenchmarkDataset` -> `validateBenchmarkRecordV3`
        #     refuses the record itself. Measured verbatim by forcing the axis back on
        #     each fixture above: `BENCHMARK_RECORD_INVALID: groups.collectionBatch of
        #     an ai record must be known, received unknown
        #     (id=src_ai_gemini_aaaaaaaaaaaa)`, `... of a mechanistic mixed record must
        #     be known, received unknown (id=mix_src_ptso_0f89e00a4836)`, and `... of a
        #     human record must be known, received unknown (id=src_ptso_aaa)`. The
        #     human class is refused IDENTICALLY, which matters here precisely because
        #     it is the row class that survives the mutation on the bench side and keeps
        #     the cluster count off zero. The `agy` rows of the sibling test are refused
        #     the same way, as `an ai record`.
        #
        # It is not that the row stops being eligible: THIS axis's `unknown` costs the
        # record, not eligibility. A record may well be ineligible for other reasons —
        # 503 of the delivered 540 are, on `harnessVersion` — but `recordEligibility`
        # is never REACHED for an `unknown` `collectionBatch`, because the parse throws
        # first. Measured on the valid fixtures, eligibility varies and is beside the
        # point: the three api rows and the human row are {eligible: true, unknownAxes:
        # []}, the mixed row is {eligible: false, unknownAxes: ["author", "source"]},
        # and the `agy` rows are {eligible: false, unknownAxes: ["harnessVersion"]} —
        # all seven refused with the messages above once the axis is forced back. Two
        # consequences for whoever reads this next: this test is NOT the only defence,
        # and the schema entry is NOT redundant with it. The reason the generalisation
        # does not carry is the rule itself: `harnessVersion` admits `unknown` for ai,
        # so there the price is eligibility; `collectionBatch` admits only `known` in
        # every class, so here the price is the record.
        for record in records:
            axis = record["groups"]["collectionBatch"]
            self.assertEqual(axis["state"], "known", record["id"])
        for record in records[:-1]:
            self.assertTrue(
                record["groups"]["collectionBatch"]["id"].startswith("gb_"),
                record["groups"]["collectionBatch"],
            )

    def test_a_human_row_keeps_its_extraction_batch_and_never_a_gb_id(self) -> None:
        from assemble_corpus import human_record

        candidate = AssemblerRealGroupTests()._human_candidate(
            "src_ptso_aaa", "ptso_thread_2", "person_x"
        )
        record = human_record(candidate, "qa-informal", None)
        # The EXTRACTION run that produced the row — `extraction_<domainSource>`,
        # shared by every candidate of one pool file, `known` from the start and never
        # touched by `assign_generation_batches`.
        self.assertEqual(
            record["groups"]["collectionBatch"],
            {"state": "known", "id": "extraction_ptso_qa"},
        )
        before = dict(record["groups"]["collectionBatch"])
        batches = self._batched([record])
        self.assertEqual(batches, [])
        self.assertEqual(record["groups"]["collectionBatch"], before)
        # THE NON-COLLISION THE DOCSTRING CALLS STRUCTURAL, asserted instead of
        # asserted-about: the governance audit rejects a non-generated record that
        # names a declared GENERATION batch, so the prefix carries a real obligation.
        # A fallback rewritten to a bare token (`batch_x`) satisfies every other test
        # in this file and breaks that obligation the first time a `gb_`-shaped value
        # appears on a human row.
        self.assertTrue(
            record["groups"]["collectionBatch"]["id"].startswith("extraction_"),
            record["groups"]["collectionBatch"],
        )
        self.assertFalse(record["groups"]["collectionBatch"]["id"].startswith("gb_"))

    def test_an_ai_record_states_all_twelve_axes(self) -> None:
        from assemble_corpus import ai_record
        from group_axes import V3_GROUP_AXES

        record = ai_record(self._api_candidate("src_ai_gemini_aaaaaaaaaaaa"))
        # The counterpart of test_a_human_record_states_all_twelve_axes. Without it no
        # test stated the IA axis SET at all — only individual axes of it.
        self.assertEqual(sorted(record["groups"]), sorted(V3_GROUP_AXES))
        self.assertEqual(record["schemaVersion"], 3)
        for axis, value in record["groups"].items():
            self.assertIn(
                value["state"], ("known", "notApplicable", "unknown"), axis
            )
        # The four axes requirement 2 fixes for the IA source — "seed + prompt +
        # batch + gerador" — named one by one, in the field each one actually is.
        self.assertEqual(record["groups"]["humanSeed"]["id"], "src_b2w_00848b3bc692")
        self.assertEqual(record["groups"]["promptTemplate"]["state"], "known")
        self.assertEqual(record["groups"]["generatorFamily"]["state"], "known")
        # `batch` is `unknown` HERE and `known` after `assign_generation_batches`,
        # because `generatedAt` is part of the batch key and is only fixed by
        # partitioning. Both halves are asserted so neither can be read as the whole.
        self.assertEqual(record["groups"]["collectionBatch"]["state"], "unknown")
        self._batched([record])
        self.assertEqual(record["groups"]["collectionBatch"]["state"], "known")
        # Generated text has no human author and no origin document. Both are facts
        # about the row, not gaps in what we recorded, so neither costs eligibility.
        self.assertEqual(record["groups"]["author"]["state"], "notApplicable")
        self.assertEqual(record["groups"]["source"]["state"], "notApplicable")


class ClusterDistributionReportTests(unittest.TestCase):
    """Counts, size distribution and the largest cluster, per axis and slice."""

    def _record(self, rid: str, label: str, partition: str, **axes) -> dict:
        import group_axes

        groups = {
            axis: group_axes.not_applicable("fixture")
            for axis in group_axes.V3_GROUP_AXES
        }
        for axis, value in axes.items():
            groups[axis] = group_axes.known(value)
        return {"id": rid, "label": label, "partition": partition, "groups": groups}

    def test_it_reports_count_distribution_and_largest_per_axis(self) -> None:
        from group_axes import cluster_report

        records = [
            self._record("h1", "human", "development", source="t1", author="a1"),
            self._record("h2", "human", "development", source="t1", author="a1"),
            self._record("h3", "human", "development", source="t1", author="a2"),
            self._record("h4", "human", "calibration", source="t2", author="a3"),
        ]
        report = cluster_report(records)
        source = report["axes"]["source"]
        self.assertEqual(source["clusters"], 2)
        self.assertEqual(source["records"], 4)
        # Size distribution as size -> how many clusters have it.
        self.assertEqual(source["sizeDistribution"], {"1": 1, "3": 1})
        self.assertEqual(source["largestCluster"], {"id": "t1", "size": 3})
        author = report["axes"]["author"]
        self.assertEqual(author["clusters"], 3)
        self.assertEqual(author["sizeDistribution"], {"1": 2, "2": 1})
        self.assertEqual(author["largestCluster"], {"id": "a1", "size": 2})

    def test_an_axis_no_row_knows_reports_no_cluster_at_all(self) -> None:
        from group_axes import cluster_report

        # `identity_of` returns None for BOTH notApplicable and unknown, and this is
        # the assertion that holds it there. Relax the guard from `state != known` to
        # `state == unknown` and `str(axis_value.get("id"))` yields the STRING "None"
        # for every notApplicable row, so the report publishes one invented cluster
        # joining all of them — on the delivered artifact that is 474 rows on
        # `author` and 360 on `source`, the manufactured dependence R6 forbids, in
        # the report that feeds E3's power gate.
        #
        # The other fixtures fill unspecified axes with not_applicable("fixture") and
        # then assert only on the axes they set, which is why nothing observed it.
        records = [
            self._record("h1", "human", "development", source="t1"),
            self._record("h2", "human", "development", source="t1"),
            self._record("h3", "human", "calibration", source="t2"),
        ]
        author = cluster_report(records)["axes"]["author"]
        self.assertEqual(author["clusters"], 0)
        self.assertEqual(author["records"], 0)
        self.assertIsNone(author["largestCluster"])
        self.assertEqual(author["sizeDistribution"], {})
        # The rows are not lost: the gap between the slice size and `records` is
        # visible in `states` rather than implied.
        self.assertEqual(author["states"], {"notApplicable": 3})

    def test_an_unknown_axis_also_joins_no_cluster(self) -> None:
        from group_axes import cluster_report, unknown

        # The other half of the same guard. `unknown` and `notApplicable` differ for
        # ELIGIBILITY and are identical for GROUPING — neither joins this row to
        # another — so an `unknown` value must not become a cluster either, whichever
        # direction the guard is weakened in.
        rows = [
            self._record("h1", "human", "development", source="t1"),
            self._record("h2", "human", "development", source="t1"),
        ]
        rows[0]["groups"]["author"] = unknown("conta removida")
        rows[1]["groups"]["author"] = unknown("conta removida")
        author = cluster_report(rows)["axes"]["author"]
        self.assertEqual((author["clusters"], author["records"]), (0, 0))
        self.assertIsNone(author["largestCluster"])
        self.assertEqual(author["states"], {"unknown": 2})

    def test_it_counts_the_states_rather_than_dropping_them(self) -> None:
        from group_axes import cluster_report, unknown

        records = [
            self._record("h1", "human", "development", source="t1"),
            self._record("h2", "human", "development", source="t1"),
        ]
        records[1]["groups"]["source"] = unknown("nao recuperado")
        report = cluster_report(records)
        source = report["axes"]["source"]
        # A row whose axis is not `known` joins no cluster, and saying so is the
        # difference between "one cluster of one" and "one cluster of two".
        self.assertEqual(source["clusters"], 1)
        self.assertEqual(source["records"], 1)
        self.assertEqual(source["states"], {"known": 1, "unknown": 1})
        self.assertEqual(report["ineligibleRecords"], 1)

    def test_it_reports_per_slice_and_not_only_in_aggregate(self) -> None:
        from group_axes import cluster_report

        records = [
            self._record("h1", "human", "development", source="t1"),
            self._record("h2", "human", "development", source="t1"),
            self._record("a1", "ai", "development", source="t1"),
            self._record("h3", "human", "calibration", source="t2"),
        ]
        report = cluster_report(records)
        # A slice is (partition, label): the aggregate hides that `t1` is one
        # cluster of three ACROSS two classes, which is the shape that leaks.
        slices = report["slices"]
        self.assertEqual(
            slices["development/human"]["axes"]["source"]["largestCluster"],
            {"id": "t1", "size": 2},
        )
        self.assertEqual(slices["development/ai"]["axes"]["source"]["clusters"], 1)
        self.assertEqual(
            slices["calibration/human"]["axes"]["source"]["sizeDistribution"], {"1": 1}
        )
        self.assertEqual(report["axes"]["source"]["largestCluster"]["size"], 3)

    def test_it_does_not_call_an_all_singleton_axis_degenerate(self) -> None:
        from group_axes import cluster_report

        # The plan is explicit: after near-duplicate pruning `nearDuplicate` MUST be
        # all singletons, and AI text has no human author, so a "no axis may be
        # 100% singletons" criterion would reward artificial grouping. The report
        # DESCRIBES; sufficient power per stratum is E3's criterion.
        records = [
            self._record("h1", "human", "development", nearDuplicate="nd1"),
            self._record("h2", "human", "development", nearDuplicate="nd2"),
        ]
        report = cluster_report(records)
        rendered = json.dumps(report)
        self.assertNotIn("degenerate", rendered)
        self.assertNotIn("degenerado", rendered)
        self.assertEqual(report["axes"]["nearDuplicate"]["sizeDistribution"], {"1": 2})


class GeneratorCaptureTests(unittest.TestCase):
    """What the GENERATORS have to record so a v3 row can be eligible."""

    def test_the_harness_version_is_read_from_the_binary_or_is_none(self) -> None:
        import subprocess

        import generate_ai

        real = subprocess.run

        def fake(argv, **kwargs):
            return subprocess.CompletedProcess(argv, 0, b"codex-cli 0.145.0\n", b"")

        try:
            subprocess.run = fake
            self.assertEqual(generate_ai.harness_version("codex"), "0.145.0")
        finally:
            subprocess.run = real

        # Every failure mode returns None, and None becomes `unknown` downstream —
        # never a placeholder string, which is the substitution R6 forbids.
        for outcome in (
            lambda argv, **kw: subprocess.CompletedProcess(argv, 1, b"", b"boom"),
            lambda argv, **kw: subprocess.CompletedProcess(argv, 0, b"no digits", b""),
            lambda argv, **kw: (_ for _ in ()).throw(FileNotFoundError("absent")),
            lambda argv, **kw: (_ for _ in ()).throw(
                subprocess.TimeoutExpired(argv, 60)
            ),
        ):
            try:
                subprocess.run = outcome
                self.assertIsNone(generate_ai.harness_version("codex"))
            finally:
                subprocess.run = real

        # An API lane has no harness to ask, which is a different answer from a
        # failed capture only downstream: harness_axis reads the lane, not this.
        self.assertIsNone(generate_ai.harness_version("gemini"))

    def test_the_version_regex_takes_the_number_and_not_the_banner(self) -> None:
        import generate_ai

        # A banner around the version must not become part of the grouping identity:
        # `axis_token` would turn "codex-cli 0.145.0" into one token and two builds
        # printing different banners would look like two harnesses.
        for printed, expected in (
            ("0.145.0", "0.145.0"),
            ("codex-cli 0.145.0", "0.145.0"),
            ("gemini 1.2.3-rc.4 (build x)", "1.2.3-rc.4"),
        ):
            self.assertEqual(generate_ai._VERSION.search(printed).group(0), expected)

    def test_every_provider_maps_onto_a_frozen_lane(self) -> None:
        import json as _json

        import generate_ai

        policy = _json.loads(
            (Path(__file__).resolve().parent.parent / "rebuild-v3-policy.json")
            .read_text(encoding="utf-8")
        )
        frozen = set(policy["generationLanes"])
        # Read against the POLICY rather than a retyped list, so a lane renamed in the
        # frozen file fails here instead of producing rows no corpus can accept.
        self.assertEqual(set(generate_ai.PROVIDER_LANE.values()), frozen)
        self.assertEqual(
            set(generate_ai.PROVIDER_LANE), set(generate_ai.CLI_PROVIDERS) | {"gemini"}
        )

    def test_the_mixing_lanes_record_which_template_produced_the_row(self) -> None:
        import io

        import make_mixed

        # Three templates, three digests: the nudge retry sends a DIFFERENT prompt, so
        # a row that was nudged came out of that one, and recording only the base
        # template would pool rows produced by different recipes.
        digests = {
            name: make_mixed.mix_template_digest(name) for name in make_mixed.MIX_TEMPLATES
        }
        self.assertEqual(len(set(digests.values())), 3, digests)

        buffer = io.StringIO()
        make_mixed.emit(
            buffer,
            {
                "id": "src_ptso_abc",
                "text": "uma frase. outra frase. terceira frase.",
                "family": "ptso_qa",
            },
            "uma frase reescrita. outra frase. terceira frase.",
            provider="antigravity",
            model="gemini-3.6-flash-low",
            template_id="mix_change_less_v1",
            harness_version="1.2.3",
        )
        row = json.loads(buffer.getvalue())
        self.assertEqual(row["promptTemplateId"], "mix_change_less_v1")
        self.assertEqual(row["promptTemplateDigest"], digests["mix_change_less_v1"])
        self.assertEqual(row["harnessVersion"], "1.2.3")
        # And that row is now writable as v3, which the legacy pools are not.
        from assemble_corpus import mixed_record

        record = mixed_record(row)
        self.assertEqual(record["groups"]["generationLane"]["id"], "agy")
        self.assertEqual(record["groups"]["harnessVersion"],
                         {"state": "known", "id": "1_2_3"})
        self.assertEqual(record["groups"]["derivationRoot"]["id"], "src_ptso_abc")
        self.assertEqual(record["groups"]["domainSource"]["id"], "ptso_qa")

    def test_an_uncaptured_editor_version_stays_unknown_and_has_no_cli_override(
        self,
    ) -> None:
        import io

        import make_mixed

        # The honest counterpart of the test above, and the enforcement of
        # requirement 6: a pairs file that never recorded the editor binary's version
        # writes None, the axis reads `unknown`, and the row is INELIGIBLE. That is
        # the specified outcome, not a gap to be patched.
        buffer = io.StringIO()
        make_mixed.emit(
            buffer,
            {
                "id": "src_ptso_abc",
                "text": "uma frase. outra frase. terceira frase.",
                "family": "ptso_qa",
            },
            "uma frase reescrita. outra frase. terceira frase.",
            provider="antigravity",
            model="gemini-3.6-flash-low",
            template_id="mix_edit_v1",
        )
        row = json.loads(buffer.getvalue())
        self.assertIsNone(row["harnessVersion"])

        from assemble_corpus import mixed_record

        record = mixed_record(row)
        self.assertEqual(record["groups"]["harnessVersion"]["state"], "unknown")
        self.assertNotIn("id", record["groups"]["harnessVersion"])

        # AND there is no command-line way to fill it. `--assume-harness` existed
        # here and was removed: unlike `--assume-template`, whose assertion is
        # checkable against make_mixed_agy.py / make_mixed_codex.py (one template
        # each, no corrective retry), the version of a binary that ran months ago is
        # recoverable from nothing — so typing it would invent a version string and
        # buy the row back its eligibility. Asserted against the PARSER rather than
        # the source text, so reintroducing the flag under another spelling that
        # feeds `harness_version` still has to get past the test above.
        printed = io.StringIO()
        argv = sys.argv
        sys.argv = ["make_mixed.py", "--help"]
        try:
            with contextlib.redirect_stdout(printed):
                with self.assertRaises(SystemExit):
                    make_mixed.main()
        finally:
            sys.argv = argv
        rendered = printed.getvalue()
        self.assertNotIn("--assume-harness", rendered)
        # The control: the template assertion IS still offered, so this test proves
        # the harness flag is absent rather than that --help stopped working.
        self.assertIn("--assume-template", rendered)

    def test_a_mixed_row_whose_parent_names_no_family_is_refused(self) -> None:
        import io

        from assemble_corpus import MissingRecipe, mixed_record
        import make_mixed

        # `emit` writes "?" when the parent row carried no family, and "?" normalises
        # to no token at all. `domainSource` must be `known` in every class, so the row
        # is refused rather than filed under an invented stratum — which would be worse
        # than dropping it, because it would pool unrelated rows into one cluster.
        buffer = io.StringIO()
        make_mixed.emit(
            buffer,
            {"id": "src_ptso_abc", "text": "uma frase. outra frase. terceira frase."},
            "uma frase reescrita. outra frase. terceira frase.",
            provider="antigravity",
            model="gemini-3.6-flash-low",
            template_id="mix_edit_v1",
        )
        row = json.loads(buffer.getvalue())
        self.assertEqual(row["parentFamily"], "?")
        with self.assertRaises(MissingRecipe):
            mixed_record(row)

    def test_the_mixing_template_has_no_default_a_caller_can_inherit(self) -> None:
        import io

        import make_mixed

        # `template_id` carried `= "mix_edit_v1"` until this round. Unreachable from
        # either production call site — both pass it explicitly — and therefore
        # unreachable by every test too, which is exactly why it survived the commit
        # whose subject line was removing the silent default. What a default costs is
        # paid by the NEXT caller: a lane that does not know which template ran would
        # publish `mix_edit_v1` plus its digest as an observation, and the row would be
        # written as v3 with a recipe nobody sent. The failure has to be at the call.
        with self.assertRaises(TypeError):
            make_mixed.emit(  # type: ignore[call-arg]
                io.StringIO(),
                {"id": "src_ptso_abc", "text": "uma frase. outra frase.", "family": "ptso_qa"},
                "uma frase reescrita. outra frase.",
                provider="antigravity",
                model="gemini-3.6-flash-low",
            )


class ReviewStateTests(unittest.TestCase):
    """C5 — the assembler emits `automated/unreviewed` and cannot mint a receipt.

    WHAT THIS CLASS EXISTS TO STOP COMING BACK. Until C5 the assembler stamped one
    constant annotation block (an annotation protocol, two reviewer tokens and an
    agreement) and one PII-audit function (a passed status, a manual-and-automated
    method, a reviewer token and the partition's block time) onto every record it
    wrote. All 10.000 rows of the sealed corpus therefore assert a two-reviewer
    agreement and a passed PII audit that never happened, with January-1970
    timestamps borrowed from the temporal split, and both governance gates passed
    over it because both asked only whether the field was present.

    No test in any language reached those two constants. Nothing had to: they were
    literals, so they could not be wrong about anything except the world.
    """

    def _human(self) -> dict:
        return AssemblerRealGroupTests()._human_candidate(
            "src_ptso_aaa", "ptso_thread_2", "person_x"
        )

    def test_every_record_class_states_automated_unreviewed(self) -> None:
        from assemble_corpus import ai_record, human_record, mixed_record

        rows = [
            human_record(self._human(), "qa-informal", None),
            ai_record(
                GenerationBatchAxisTests()._api_candidate("src_ai_gemini_aaaaaaaaaaaa")
            ),
            mixed_record(GenerationBatchAxisTests()._mixed_candidate("src_ptso_aaa")),
        ]
        for row in rows:
            self.assertEqual(row["review"]["state"], "automated/unreviewed", row["id"])
            # The three keys of the state, and NOTHING a receipt would add. Asserted
            # as an exact key set rather than key by key: a receipt field smuggled in
            # later is caught here even if every assertion below still holds.
            self.assertEqual(
                sorted(row["review"]),
                ["automatedFilters", "humanAuditAbsentReason", "state"],
                row["id"],
            )
            self.assertNotIn("annotation", row, row["id"])
            self.assertNotIn("piiAudit", row["provenance"], row["id"])

    def test_the_assembler_mints_no_review_receipt(self) -> None:
        # The source-level guard, in the same shape as
        # `test_no_module_mints_a_per_record_group_token`: the tokens the fabricated
        # blocks were spelled with must not appear in the module at all, so a future
        # edit cannot reintroduce them under a new variable name. The prose comment
        # in the module deliberately paraphrases them for exactly this reason.
        source = Path(__file__).with_name("assemble_corpus.py").read_text(
            encoding="utf-8"
        )
        for token in (
            "reviewer_a",
            "reviewer_b",
            "reviewer_pii",
            "manual-and-automated",
            "agreement",
            "piiAudit",
        ):
            self.assertNotIn(token, source, token)

    def test_the_state_carries_the_filters_the_extractor_recorded(self) -> None:
        from assemble_corpus import human_record

        candidate = self._human()
        candidate["meta"]["automatedFilters"] = [
            {
                "filter": "pii-pattern-scan",
                "implementation": "benchmark/lab/common.py:pii_hits",
                "outcome": "passed",
            }
        ]
        record = human_record(candidate, "qa-informal", None)
        self.assertEqual(
            record["review"]["automatedFilters"],
            candidate["meta"]["automatedFilters"],
        )

    def test_a_pool_that_recorded_no_filter_claims_none(self) -> None:
        from assemble_corpus import human_record

        # EMPTY, and that is the honest answer rather than a gap to fill. Pools
        # written before `CandidateWriter` recorded its filters say nowhere which
        # screens saw the row, and naming one here would be the old constant again on
        # a smaller scale. The state's own claim — no human audit happened — is still
        # made, and the reason is still written down.
        record = human_record(self._human(), "qa-informal", None)
        self.assertEqual(record["review"]["automatedFilters"], [])
        self.assertIn("no human reviewer", record["review"]["humanAuditAbsentReason"])

    def test_a_generated_row_claims_no_pii_screen_it_never_met(self) -> None:
        from assemble_corpus import ai_record

        # `CandidateWriter` is the HUMAN extraction path; the generation pools do not
        # go through it, so no filter of ours screened a generated row for personal
        # data. Passing the candidate here would have read a `meta` the pool does not
        # have — but a later edit that "helpfully" forwarded it would start claiming
        # the screen the moment a generator began writing that key for another reason.
        candidate = GenerationBatchAxisTests()._api_candidate(
            "src_ai_gemini_aaaaaaaaaaaa"
        )
        candidate["meta"]["automatedFilters"] = [
            {
                "filter": "pii-pattern-scan",
                "implementation": "benchmark/lab/common.py:pii_hits",
                "outcome": "passed",
            }
        ]
        self.assertEqual(ai_record(candidate)["review"]["automatedFilters"], [])

    def test_the_ledger_records_the_state_and_no_agreement(self) -> None:
        # `private/review-ledger.jsonl` is hashed into the manifest and the hash
        # feeds `integrity.review-ledger-hash`. It used to copy the reviewer tokens
        # and the agreement out of the fabricated block, so the gate certified a
        # review by certifying the bytes of its own invention.
        source = Path(__file__).with_name("assemble_corpus.py").read_text(
            encoding="utf-8"
        )
        self.assertIn('"reviewState": r["review"]["state"]', source)
        self.assertNotIn('r["annotation"]', source)

    def test_the_writer_records_the_filters_it_ran(self) -> None:
        from common import AUTOMATED_FILTERS_RUN

        with tempfile.TemporaryDirectory() as tmp:
            rows, _ = run_writer(
                Path(tmp),
                "filters",
                lambda w: w.offer(
                    natural_key="k1",
                    license_id="cc-by-sa-4.0",
                    created_at=parse_iso_date("2013-12-11"),
                    raw_text=PROSE_60,
                    domain_source="ptso_qa",
                ),
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(
            rows[0]["meta"]["automatedFilters"],
            [dict(f) for f in AUTOMATED_FILTERS_RUN],
        )
        # Every recorded outcome is "passed" BY CONSTRUCTION: a candidate that hit a
        # filter returned before this line and has no row to carry the fact. The
        # schema refuses "excluded" on a record that exists for the same reason.
        for run in rows[0]["meta"]["automatedFilters"]:
            self.assertEqual(run["outcome"], "passed")

    def test_a_callers_own_meta_still_wins(self) -> None:
        # The merge order, pinned: an extractor that ran additional filters (the
        # Carolina licence allowlist) must be able to say so, and the default must
        # not overwrite it.
        mine = [
            {
                "filter": "license-by-source",
                "implementation": "benchmark/lab/extract_carolina.py:ALLOWED_LICENSES",
                "outcome": "passed",
            }
        ]
        with tempfile.TemporaryDirectory() as tmp:
            rows, _ = run_writer(
                Path(tmp),
                "filters2",
                lambda w: w.offer(
                    natural_key="k2",
                    license_id="cc-by-nc-sa-4.0",
                    created_at=parse_iso_date("2013-12-11"),
                    raw_text=PROSE_60,
                    domain_source="carolina_social_media",
                    meta={"automatedFilters": mine},
                ),
            )
        self.assertEqual(rows[0]["meta"]["automatedFilters"], mine)


class NerPilotTests(unittest.TestCase):
    """The pure parts of the NER screening pilot (no model download, no torch).

    What these pin is the arithmetic the measurement rests on: the draw has to be
    reproducible and disjoint per pool, long text has to be COVERED rather than
    truncated, the duplicates that overlapping windows create must collapse to one
    finding, and an unmapped model label must raise instead of quietly counting as
    "not a person" — that last one is how a model swap would silently lower a flag
    rate nobody re-measured.
    """

    def test_sample_is_deterministic_and_seed_dependent(self) -> None:
        from ner_pilot import deterministic_sample

        ids = [f"src_x_{i:04d}" for i in range(500)]
        first = deterministic_sample(ids, 30, "seed-a")
        self.assertEqual(first, deterministic_sample(ids, 30, "seed-a"))
        self.assertEqual(len(set(first)), 30)
        self.assertNotEqual(first, deterministic_sample(ids, 30, "seed-b"))
        # A prefix property: growing the draw keeps every id already drawn, so a
        # pilot can be widened without re-randomising what was already reviewed.
        self.assertEqual(deterministic_sample(ids, 40, "seed-a")[:30], first)

    def test_sample_survives_pool_reordering(self) -> None:
        from ner_pilot import deterministic_sample

        ids = [f"src_x_{i:04d}" for i in range(200)]
        self.assertEqual(
            deterministic_sample(ids, 20, "s"),
            deterministic_sample(list(reversed(ids)), 20, "s"),
        )

    def test_windows_cover_every_token_with_overlap(self) -> None:
        from ner_pilot import offset_windows

        # A tokenizer's offset mapping: one (start, end) pair per wordpiece.
        text = " ".join(f"palavra{i}" for i in range(400))
        offsets = [(m.start(), m.end()) for m in re.finditer(r"\S+", text)]
        windows = offset_windows(offsets, max_tokens=150, overlap_tokens=25)
        self.assertGreater(len(windows), 1)
        # Coverage: every token lies inside at least one window. Truncation instead of
        # coverage would make the flag rate a fact about first paragraphs.
        for start, end in offsets:
            self.assertTrue(
                any(w_start <= start and end <= w_end for w_start, w_end in windows)
            )
        # Consecutive windows really overlap, which is what makes a name on a
        # boundary visible whole to at least one window.
        self.assertLess(windows[1][0], windows[0][1])

    def test_windows_of_short_and_empty_token_sequences(self) -> None:
        from ner_pilot import offset_windows

        self.assertEqual(offset_windows([], 150, 25), [])
        # Special tokens and padding arrive as zero-width offsets and are not content.
        self.assertEqual(offset_windows([(0, 0), (0, 0)], 150, 25), [])
        self.assertEqual(offset_windows([(0, 3), (4, 9)], 150, 25), [(0, 9)])

    def test_overlap_must_be_smaller_than_the_window(self) -> None:
        from ner_pilot import offset_windows

        with self.assertRaises(ValueError):
            offset_windows([(0, 1), (1, 2)], max_tokens=10, overlap_tokens=10)

    def test_labels_map_across_models_and_fail_closed(self) -> None:
        from ner_pilot import UnknownEntityLabel, canonical_category

        for label in ("PESSOA", "B-PESSOA", "I-PER", "L-PESSOA", "PER", "Pessoa"):
            self.assertEqual(canonical_category(label), "person")
        self.assertEqual(canonical_category("B-ORGANIZACAO"), "organization")
        self.assertEqual(canonical_category("I-LOC"), "place")
        with self.assertRaises(UnknownEntityLabel):
            canonical_category("B-GENE")

    def test_overlapping_findings_collapse_to_one(self) -> None:
        from ner_pilot import Entity, dedupe_entities

        # The same name seen by two windows, plus a distinct one further along.
        entities = [
            Entity("person", 100, 112, 0.91),
            Entity("person", 100, 112, 0.97),
            Entity("person", 106, 118, 0.80),
            Entity("place", 100, 112, 0.75),
            Entity("person", 400, 410, 0.60),
        ]
        merged = dedupe_entities(entities)
        self.assertEqual(
            [(e.category, e.start, e.end) for e in merged],
            [("place", 100, 112), ("person", 100, 118), ("person", 400, 410)],
        )
        # The merged person keeps the best score of the two windows that saw it.
        self.assertAlmostEqual(merged[1].score, 0.97)

    def test_person_count_honours_the_score_floor(self) -> None:
        from ner_pilot import persons_at

        row = {
            "entities": [
                {"category": "person", "score": 0.99, "mentionGroup": 1},
                {"category": "person", "score": 0.55, "mentionGroup": 2},
                {"category": "place", "score": 0.99, "mentionGroup": 0},
            ]
        }
        self.assertEqual(persons_at(row, 0.5), 2)
        self.assertEqual(persons_at(row, 0.7), 1)
        self.assertEqual(persons_at(row, 0.999), 0)

    def test_repeated_mentions_of_one_name_cost_one_judgement(self) -> None:
        from ner_pilot import person_mentions_at, persons_at

        # A court decision naming the same judge four times and one party once: five
        # highlights, two decisions. Counting highlights would inflate the budget.
        row = {
            "entities": [
                {"category": "person", "score": 0.99, "mentionGroup": 1},
                {"category": "person", "score": 0.98, "mentionGroup": 1},
                {"category": "person", "score": 0.97, "mentionGroup": 1},
                {"category": "person", "score": 0.96, "mentionGroup": 1},
                {"category": "person", "score": 0.95, "mentionGroup": 2},
            ]
        }
        self.assertEqual(person_mentions_at(row, 0.5), 5)
        self.assertEqual(persons_at(row, 0.5), 2)

    def test_mentions_group_by_normalized_surface(self) -> None:
        from ner_pilot import Entity, group_mentions

        text = "Fulano de Tal disse. Depois FULANO DE TAL, e ainda Beltrano."
        entities = [
            Entity("person", 0, 13, 0.99),
            Entity("person", 28, 41, 0.99),
            Entity("person", 51, 59, 0.99),
        ]
        grouped = group_mentions(entities, text)
        self.assertEqual([e.mention_group for e in grouped], [1, 1, 2])

    def test_junk_spans_are_not_person_findings(self) -> None:
        from ner_pilot import is_plausible_person

        self.assertTrue(is_plausible_person("Fulano de Tal"))
        self.assertTrue(is_plausible_person(" Min. Cármen "))
        # Shapes the models really emit on legal abbreviations.
        self.assertFalse(is_plausible_person("."))
        self.assertFalse(is_plausible_person(" - "))
        self.assertFalse(is_plausible_person("12"))
        self.assertFalse(is_plausible_person(""))

    def test_wilson_interval_brackets_the_point_estimate(self) -> None:
        from ner_pilot import wilson_interval

        low, high = wilson_interval(25, 125)
        self.assertLess(low, 0.2)
        self.assertGreater(high, 0.2)
        # Zero hits still yields a positive upper bound: "none seen" is not "none".
        zero_low, zero_high = wilson_interval(0, 300)
        self.assertEqual(zero_low, 0.0)
        self.assertGreater(zero_high, 0.0)

    def test_verdict_tally_refuses_an_unknown_verdict(self) -> None:
        from ner_pilot import tally_verdicts

        tally = tally_verdicts(
            {"a": "private-person", "b": "public-figure", "c": "false-positive", "d": "public-figure"}
        )
        self.assertEqual(tally["adjudicated"], 4)
        self.assertEqual(tally["public-figure"]["count"], 2)
        self.assertAlmostEqual(tally["private-person"]["share"], 0.25)
        with self.assertRaises(ValueError):
            tally_verdicts({"a": "maybe"})

    def test_extrapolation_propagates_both_intervals(self) -> None:
        from ner_pilot import extrapolate

        out = extrapolate(
            unit="distinct-name",
            flag_rate_low=0.10,
            flag_rate_high=0.20,
            corpus_records=9000,
            seconds_low=10.0,
            seconds_high=30.0,
            units_per_flagged_record=2.0,
        )
        self.assertEqual(out["flaggedRecords"], [900.0, 1800.0])
        self.assertEqual(out["units"], [1800.0, 3600.0])
        # 1800 names x 10 s = 5 h; 3600 x 30 s = 30 h.
        self.assertEqual(out["hours"], [5.0, 30.0])
        self.assertEqual(out["unit"], "distinct-name")
