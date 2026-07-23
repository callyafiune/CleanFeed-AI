"""Fixture tests for the lab-bench extractors (run: python -m unittest -v).

These prove the keep/drop pipeline (date cutoff, word window, PII drop,
deterministic sampling) and each format parser against tiny synthetic inputs,
so the multi-GB real runs start from verified logic.
"""

from __future__ import annotations

import bz2
import io
import json
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
from extract_carolina import extract as extract_carolina
from extract_stackexchange import extract as extract_stackexchange, html_to_text
from extract_wikipedia import lead_section, strip_templates
import extract_wikipedia

PROSE_60 = " ".join(f"palavra{i}" for i in range(60))


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
                tmp, "ptso_bad", lambda w: extract_stackexchange(posts, w)
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
                tmp, "ptso", lambda w: extract_stackexchange(posts, w)
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
