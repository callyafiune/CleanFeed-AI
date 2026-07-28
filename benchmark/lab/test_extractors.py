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
        # Same secret, same raw value, different axis -> different pseudonym, so a
        # reviewer id that happens to equal an author id does not join two rows.
        self.assertNotEqual(keyring.pseudonym("a", "40"), keyring.pseudonym("b", "40"))


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

    def test_the_natural_keys_still_digest_to_the_ids_measured_before_c2(self) -> None:
        import hashlib

        # Measured on the tree at eae6ce6, BEFORE C2 touched an extractor. The id is
        # `<sourceId>_<sha1(naturalKey)[:12]>`, so pinning the digest of the natural
        # key pins the id: any change to a natural key renumbers the corpus and
        # breaks every pair reference and every ledger row that names an id.
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
        # with ONE argued exception. `nearDuplicate` names the surviving
        # representative of the pruning cluster, and after pruning every cluster has
        # exactly one member, so the representative IS this row. That is not a minted
        # token: it is read from the pruning result and would collide the moment two
        # rows shared a cluster, whereas the old nd- token was minted BECAUSE it
        # could not. The plan is explicit that this axis must be all singletons.
        for axis, value in first["groups"].items():
            if axis == "nearDuplicate" or value.get("state") != "known":
                continue
            self.assertNotIn(first["id"], value["id"], axis)
        self.assertEqual(first["groups"]["nearDuplicate"]["id"], first["id"])

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
        # `promptId` encodes the parent (`original_src_b2w_00848b3bc692`), which is
        # the datum requirement 5 says to persist. The `original` recipe writes NEW
        # text from that seed, so the seed is known and there is no derivation.
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
        self.assertEqual(
            record["groups"]["derivationRoot"],
            {"state": "known", "id": "src_b2w_00848b3bc692"},
        )
        self.assertEqual(record["groups"]["humanSeed"]["id"], "src_b2w_00848b3bc692")

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
            "mixture": {
                "spans": [{"start": 0, "end": len(PROSE_60), "origin": "human"}]
            },
        }
        # The mixing template digest is not recoverable from a pool row that never
        # recorded it. Guessing it from whichever template is in make_mixed.py TODAY
        # would attach a recipe the row cannot support, so the row leaves instead.
        with self.assertRaises(MissingRecipe):
            mixed_record(candidate)


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
