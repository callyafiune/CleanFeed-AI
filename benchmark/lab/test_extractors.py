"""Fixture tests for the lab-bench extractors (run: python -m unittest -v).

These prove the keep/drop pipeline (date cutoff, word window, PII drop,
deterministic sampling) and each format parser against tiny synthetic inputs,
so the multi-GB real runs start from verified logic.
"""

from __future__ import annotations

import argparse
import bz2
import contextlib
import io
import json
import re
import sys
import tempfile
import unittest
import zipfile
from collections import Counter
from fractions import Fraction
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


def document_license_of(domain_source: str) -> str:
    """The licence the extractor of that base writes on a document of it.

    Fixtures carry it because the RECORD carries it: the assembler reads the licence off
    the pool row and has nothing to fall back on, so a fixture without one is a fixture
    of a row the assembler refuses.
    """
    return "cc-by-sa-4.0" if domain_source.startswith("ptwiki") else "cc-by-nc-sa-4.0"

# The concrete acquisition each extractor test declares. Both extractors REFUSE to run
# without it, because it is what names `groups.sourceMaterialBatch`; the values are the
# real snapshots (ESTADO.md § 2: ptwiki dump 2022-03-01, Carolina Bea 2.0).
WIKI_SNAPSHOT_VERSION = "ptwiki-20220301"
CAROLINA_SNAPSHOT_VERSION = "carolina-v2.0"

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
                tmp, "wiki", lambda w: extract_wikipedia.extract(
                    dump, w, snapshot_version=WIKI_SNAPSHOT_VERSION
                ),
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
                lambda w: extract_carolina(
                    archive,
                    w,
                    per_typology_limit=2,
                    snapshot_version=CAROLINA_SNAPSHOT_VERSION,
                ),
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
                tmp, "carolina", lambda w: extract_carolina(
                    archive, w, snapshot_version=CAROLINA_SNAPSHOT_VERSION
                ),
            )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["licenseId"], "cc-by-nc-sa-4.0")
        self.assertEqual(rows[0]["domainSource"], "carolina_social_media")
        self.assertEqual(stats["drop_license"], 1)
        self.assertEqual(stats["drop_date"], 1)

    def test_a_typology_outside_the_frame_is_neither_emitted_nor_scanned(self) -> None:
        """D7: the allowlist, measured on the two things it has to do at once.

        The mutation this catches is adding `legislative_branch` (or any of the other
        three declared exclusions) to `FRAME_TYPOLOGIES`: the rows appear, and they
        appear as a `carolina_legislative_branch` stratum that no cell counts, in a
        typology that is 4.477 MB of the package. The SCAN assertion is the second half —
        an out-of-frame member that is opened and then dropped still consumes the run's
        quota, so in-frame material would be crowded out by the frame's own exclusions.
        """
        ns = "http://www.tei-c.org/ns/1.0"
        good = self.make_tei(
            license_text="CC BY-NC-SA 4.0", download="2021-11-18", body=PROSE_60
        )
        corpus = f"<teiCorpus xmlns=\"{ns}\"><teiHeader/>{good}</teiCorpus>"
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            archive = tmp / "carolina.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("Corpus/judicial branch/JUDa.xml", corpus)
                z.writestr("Corpus/legislative branch/LEGa.xml", corpus)
                z.writestr("Corpus/public domain works/PDWa.xml", corpus)
                z.writestr("Corpus/datasets and other corpora/DSa.xml", corpus)
            rows, stats = run_writer(
                tmp, "carolina_frame", lambda w: extract_carolina(
                    archive, w, snapshot_version=CAROLINA_SNAPSHOT_VERSION
                ),
            )
        self.assertEqual([r["domainSource"] for r in rows], ["carolina_judicial_branch"])
        self.assertEqual(stats["scanned"], 1)

    def test_a_narrowed_run_still_refuses_a_typology_outside_the_frame(self) -> None:
        import extract_carolina

        # `--typologies` narrows WITHIN the frame and cannot widen past it. Refused on the
        # way in — before the archive is opened — because a multi-gigabyte pass that
        # discovers on its last member that it was asked for the legislative branch has
        # already spent the run.
        self.assertEqual(
            extract_carolina.selected_typologies("social media,judicial_branch"),
            ("social_media", "judicial_branch"),
        )
        with self.assertRaises(argparse.ArgumentTypeError) as caught:
            extract_carolina.selected_typologies("legislative_branch")
        message = str(caught.exception)
        self.assertIn("legislative_branch", message)
        self.assertIn("outside the sampling frame", message)
        for admissible in extract_carolina.FRAME_TYPOLOGIES:
            self.assertIn(admissible, message)

    def test_a_typology_nobody_decided_about_refuses_the_run_by_name(self) -> None:
        import extract_carolina

        # The fail-closed half. A typology that is neither in the frame nor in the
        # declared exclusions is UNDECIDED, and skipping it silently is the dangerous
        # direction: the releases spell the same typology with spaces and with
        # underscores, so a renamed in-frame directory would yield zero rows for a cell
        # whose FPR ceiling the release publishes, quietly.
        ns = "http://www.tei-c.org/ns/1.0"
        good = self.make_tei(
            license_text="CC BY-NC-SA 4.0", download="2021-11-18", body=PROSE_60
        )
        corpus = f"<teiCorpus xmlns=\"{ns}\"><teiHeader/>{good}</teiCorpus>"
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            archive = tmp / "carolina.zip"
            with zipfile.ZipFile(archive, "w") as z:
                z.writestr("Corpus/judicial branch/JUDa.xml", corpus)
                z.writestr("Corpus/poetry/POEa.xml", corpus)
            with self.assertRaises(extract_carolina.TypologyOutOfFrame) as caught:
                run_writer(
                    tmp, "carolina_undecided", lambda w: extract_carolina.extract(
                        archive, w, snapshot_version=CAROLINA_SNAPSHOT_VERSION
                    ),
                )
        message = str(caught.exception)
        self.assertIn("poetry", message)
        for admissible in extract_carolina.FRAME_TYPOLOGIES:
            self.assertIn(admissible, message)

    def test_a_typology_outside_the_frame_is_refused_by_the_command_line(self) -> None:
        import subprocess
        import sys

        import extract_carolina

        # The refusal has to live on the PARSER, not only in the function: a
        # multi-gigabyte pass that discovers on its last member that it was asked for the
        # legislative branch has already spent the run. Driven as a subprocess for that
        # reason — the unit test above stays green if `type=` is dropped from the
        # argument, and then the name reaches `extract` instead of argparse.
        script = Path(__file__).with_name("extract_carolina.py")
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "carolina.jsonl"
            proc = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--typologies",
                    "legislative_branch",
                    "--input",
                    str(Path(raw) / "archive.zip"),
                    "--output",
                    str(output),
                    "--snapshot-version",
                    CAROLINA_SNAPSHOT_VERSION,
                ],
                capture_output=True,
                text=True,
            )
            # Nothing opened and nothing written: argparse exits 2 before `main` reaches
            # the archive, which does not even exist here.
            self.assertFalse(output.exists())
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("legislative_branch", proc.stderr)
        self.assertIn("outside the declared frame", proc.stderr)
        for admissible in extract_carolina.FRAME_TYPOLOGIES:
            self.assertIn(admissible, proc.stderr)


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


class FrozenLaneEntryTests(unittest.TestCase):
    """D6 — `--provider` admits the four frozen lanes, and refuses on the way IN.

    Where the refusal happens is the whole point. `PROVIDER_LANE[provider]` is read once
    per generated row, inside the loop, AFTER the provider call: a lane outside the slate
    used to burn a real API call and then die with a `KeyError` on the first row it wrote,
    and to do it again on every resume.
    """

    def test_a_provider_outside_the_slate_is_refused_before_any_call(self) -> None:
        import subprocess
        import sys

        script = Path(__file__).with_name("generate_ai.py")
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "ai_openai.jsonl"
            proc = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--provider",
                    "openai",
                    "--humans",
                    str(Path(raw) / "humans.jsonl"),
                    "--output",
                    str(output),
                ],
                capture_output=True,
                text=True,
            )
            # Nothing was opened, nothing was written, nothing was spent: argparse exits
            # 2 before `main` reaches the humans file or the lane lock.
            self.assertFalse(output.exists())
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("outside the frozen slate", proc.stderr)
        # The reason, not just a rejection: the OpenAI families are the unseen-generator
        # test, and they reach the corpus through the frozen `codex` lane only.
        self.assertIn("OOD", proc.stderr)
        for lane in ("agy", "codex", "gemini", "gemini_cli"):
            self.assertIn(lane, proc.stderr)

    def test_the_admissible_lanes_are_the_frozen_ones_and_each_has_a_default(
        self,
    ) -> None:
        import generate_ai

        # Read against `PROVIDER_LANE`, which `test_every_provider_maps_onto_a_frozen_lane`
        # already pins to the policy file, so this test does not retype the slate. A lane
        # the parser admits with no default model would fail at `DEFAULT_MODELS[provider]`
        # — after the parser said yes, which is the failure D6 names one step later.
        self.assertEqual(set(generate_ai.DEFAULT_MODELS), set(generate_ai.PROVIDER_LANE))
        for lane in generate_ai.PROVIDER_LANE:
            self.assertEqual(generate_ai.frozen_lane(lane), lane)
        self.assertEqual(
            set(generate_ai.OUT_OF_SLATE_PROVIDERS) & set(generate_ai.PROVIDER_LANE),
            set(),
        )

    def test_the_out_of_slate_names_are_refused_and_not_deleted(self) -> None:
        import generate_ai

        # Same discipline as `dataset.refusedIds` and the blocked snapshot: a name that
        # leaves by deletion is a name a caller can ask for again and get "unknown
        # provider" for. Both surfaces answer with the REASON, and `call_provider` no
        # longer holds a transport that could produce a row the corpus cannot accept.
        for provider in ("openai", "anthropic"):
            with self.assertRaises(ValueError) as caught:
                generate_ai.call_provider(provider, "m", "prompt", None, {})
            self.assertIn("outside the frozen slate", str(caught.exception))
        self.assertIn("reserved for the unseen-generator test", str(
            generate_ai.OUT_OF_SLATE_PROVIDERS["openai"]
        ))
        source = Path(__file__).with_name("generate_ai.py").read_text(encoding="utf-8")
        self.assertNotIn("api.openai.com", source)
        self.assertNotIn("api.anthropic.com", source)


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

    def test_strips_both_separators_off_both_ends(self) -> None:
        from assemble_corpus import generator_family

        # The TypeScript normalizer trims "_" AND "-" from both ends, and this mirror
        # has to trim the same characters: stripping only "_" mapped "gemini-3.5-" to
        # "gemini-3_5-", a token the schema calls canonical and which is a DIFFERENT
        # family from "gemini-3_5". A record written with one and declared with the
        # other is the two-spellings defect, in a corpus nobody could re-derive.
        for raw, canonical in (
            ("gemini-3.5-", "gemini-3_5"),
            ("-gemini-3.5", "gemini-3_5"),
            ("_gemini-3.5_", "gemini-3_5"),
            ("--gemini-3.5--", "gemini-3_5"),
        ):
            self.assertEqual(generator_family(raw), canonical)
        with self.assertRaises(ValueError):
            generator_family("-_-")

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

    def test_counts_the_same_denominator_the_floor_is_written_on(self) -> None:
        from assemble_corpus import thin_held_out_families

        # `validate` puts the 200-record floor on POSITIVES, and main()'s
        # `below_floor` counts `ai` + `mixed`. This counter asks the same question of
        # the written records, so it has to count the same rows: a family padded by a
        # row that is not a positive must still be reported as thin, or the two sides
        # disagree while the docstring claims they agree. (The schema refuses a human
        # row carrying a family, which is why this is a guard rather than a corpus
        # shape — the counter must not be the one place such a row reads as stock.)
        records = [
            self._ai_record("gemini-3_5-flash-low", "gemini-3.5-flash-low")
            for _ in range(2)
        ]
        records.append(
            {
                "label": "human",
                "groups": {"generatorFamily": "gemini-3_5-flash-low"},
            }
        )
        self.assertEqual(
            thin_held_out_families(records, {"gemini-3_5-flash-low"}, minimum=3),
            {"gemini-3_5-flash-low": 2},
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

        from group_axes import V3_GROUP_AXES, V4_GROUP_AXES

        source = (
            Path(__file__).resolve().parent.parent / "schema.ts"
        ).read_text(encoding="utf-8")
        # BOTH tuples, and the v3 one is not vestigial: the dead corpus is still read to
        # seed `drop_seen`, so a reader that lost the v3 vocabulary would report
        # `collectionBatch` as an axis nobody declares.
        for name, mirror in (
            ("V3_GROUP_AXES", V3_GROUP_AXES),
            ("V4_GROUP_AXES", V4_GROUP_AXES),
        ):
            with self.subTest(tuple=name):
                block = source.split(f"export const {name} = [", 1)[1].split("]", 1)[0]
                self.assertEqual(
                    list(mirror), _re.findall(r'"([a-zA-Z]+)"', block), name
                )
        # The RELATION between the two, which neither pin above states on its own: v4 is
        # v3 minus the one axis that conflated three facts, plus the three that separate
        # them. Without this, dropping an axis from both sides at once passes both pins.
        self.assertEqual(
            set(V3_GROUP_AXES) - set(V4_GROUP_AXES), {"collectionBatch"}
        )
        self.assertEqual(
            set(V4_GROUP_AXES) - set(V3_GROUP_AXES),
            {"sourceMaterialBatch", "generationBatch", "extractionRun"},
        )
        self.assertEqual(len(V4_GROUP_AXES), 14)

    def test_the_total_order_over_both_tuples_mirrors_schema_ts(self) -> None:
        """`ALL_GROUP_AXES` e copia, e o que ela ordena entra num artefato SELADO.

        Os dois lados ordenam o relatorio de cluster por esta lista, e `clusters.axes` e um
        ARRAY dentro do artefato selado por `splitDigest`. Reordenar de um lado so move o
        digest de um lado so, e as duas tuplas por si nao dizem a ordem da CONCATENACAO:
        `V4_GROUP_AXES` poe os tres eixos novos antes de `nearDuplicate`/`derivationRoot`, e
        a concatenacao os poe no fim.
        """
        import re as _re

        from group_axes import ALL_GROUP_AXES

        source = (Path(__file__).resolve().parent.parent / "schema.ts").read_text(
            encoding="utf-8"
        )
        bloco = source.split("export const ALL_GROUP_AXES: readonly GroupAxis[] = [", 1)[
            1
        ]
        bloco = " ".join(bloco[: bloco.index("\n];")].split())
        # A DERIVACAO lida do fonte: o v3 inteiro primeiro, depois o v4 filtrado contra ele.
        # Sem isto, trocar a ordem dos dois spreads no TS passa pela igualdade de valor
        # abaixo, que le as TUPLAS e nao esta lista.
        self.assertEqual(
            _re.findall(r"\.\.\.(\w+)", bloco), ["V3_GROUP_AXES", "V4_GROUP_AXES"]
        )
        self.assertIn("V4_GROUP_AXES.filter(", bloco)
        self.assertIn("!(V3_GROUP_AXES as readonly string[]).includes(axis)", bloco)
        # E o VALOR que essa derivacao produz sobre as tuplas do proprio fonte.
        tuplas = {}
        for nome in ("V3_GROUP_AXES", "V4_GROUP_AXES"):
            corpo = source.split(f"export const {nome} = [", 1)[1].split("]", 1)[0]
            tuplas[nome] = _re.findall(r'"([a-zA-Z]+)"', corpo)
        self.assertEqual(
            list(ALL_GROUP_AXES),
            tuplas["V3_GROUP_AXES"]
            + [a for a in tuplas["V4_GROUP_AXES"] if a not in tuplas["V3_GROUP_AXES"]],
        )

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
                Path(raw), "wiki", lambda w: extract_wikipedia.extract(
                    path, w, snapshot_version=WIKI_SNAPSHOT_VERSION
                ),
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
                Path(raw), "carolina", lambda w: extract_carolina.extract(
                    path, w, snapshot_version=CAROLINA_SNAPSHOT_VERSION
                ),
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


class MaterialBatchProducerTests(unittest.TestCase):
    """The EXTRACTOR is where `sourceMaterialBatch` comes from, and nowhere else.

    `assemble_corpus.human_record` refuses a candidate that names no acquisition event,
    so a pipeline whose extractors do not emit one writes a corpus of `ai` rows only —
    and it does it QUIETLY, because `main()` counts the drops. Asserting the assembler's
    refusal is therefore not enough: something has to assert the PRODUCER, or the
    refusal is the only half that exists.
    """

    def test_wikipedia_names_the_acquisition_event_on_every_candidate(self) -> None:
        page = (
            '<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.10/">'
            "<page><title>T</title><ns>0</ns><id>77</id><revision>"
            "<timestamp>2021-05-01T00:00:00Z</timestamp>"
            f"<text>{PROSE_60}</text>"
            "</revision></page></mediawiki>"
        )
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "ptwiki.xml.bz2"
            path.write_bytes(bz2.compress(page.encode("utf-8")))
            rows, _ = run_writer(
                Path(raw), "wiki", lambda w: extract_wikipedia.extract(
                    path, w, snapshot_version=WIKI_SNAPSHOT_VERSION
                ),
            )
        # The batch is keyed on the concrete DUMP, so two dumps of the Wikipedia are
        # two acquisitions and not one indistinguishable block.
        self.assertEqual(rows[0]["meta"]["sourceMaterialBatch"], "smb_ptwiki-20220301")

    def test_wikipedia_refuses_a_run_whose_acquisition_has_no_name(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "ptwiki.xml.bz2"
            path.write_bytes(bz2.compress(b"<mediawiki/>"))
            with self.assertRaises(ValueError) as caught:
                run_writer(
                    Path(raw),
                    "wiki",
                    lambda w: extract_wikipedia.extract(path, w),
                )
        self.assertIn("--snapshot-version", str(caught.exception))
        self.assertIn("groups.sourceMaterialBatch", str(caught.exception))

    def test_carolina_gives_every_typology_of_one_download_one_batch(self) -> None:
        import extract_carolina

        tei = (
            '<teiCorpus xmlns="http://www.tei-c.org/ns/1.0">'
            "<TEI><teiHeader><fileDesc><publicationStmt>"
            '<date type="Download">2021-05-21</date>'
            "<availability><licence>CC BY-NC-SA 4.0</licence></availability>"
            "</publicationStmt></fileDesc></teiHeader>"
            f"<text><body><p>{PROSE_60}</p></body></text></TEI>"
            "</teiCorpus>"
        )
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "archive.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Corpus/university domains/uni.xml", tei)
                archive.writestr("Corpus/social media/soc.xml", tei)
            rows, _ = run_writer(
                Path(raw), "carolina", lambda w: extract_carolina.extract(
                    path, w, snapshot_version=CAROLINA_SNAPSHOT_VERSION
                ),
            )
        self.assertEqual(len(rows), 2)
        # ONE batch for both cells: the typologies partition a single download, they
        # are not separate acquisitions. Two blocks here would state a dependence
        # boundary that no acquisition event supports.
        self.assertEqual(
            {r["meta"]["sourceMaterialBatch"] for r in rows}, {"smb_carolina-v2_0"}
        )
        self.assertNotEqual(
            rows[0]["domainSource"], rows[1]["domainSource"]
        )

    def test_carolina_refuses_a_run_whose_acquisition_has_no_name(self) -> None:
        import extract_carolina

        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "archive.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Corpus/social media/soc.xml", "<teiCorpus/>")
            with self.assertRaises(ValueError) as caught:
                run_writer(
                    Path(raw),
                    "carolina",
                    lambda w: extract_carolina.extract(path, w),
                )
        self.assertIn("--snapshot-version", str(caught.exception))

    def test_the_batch_id_survives_the_assembler_that_consumes_it(self) -> None:
        """The producer's spelling is a pseudonym the sealed schema accepts.

        The two halves are written in different languages and compared by nobody at
        runtime, so a batch id that the axis validator refuses would only show up
        after a full assembly run.
        """
        from group_axes import known, material_batch_id

        for version in (WIKI_SNAPSHOT_VERSION, CAROLINA_SNAPSHOT_VERSION):
            batch = material_batch_id(version)
            self.assertEqual(known(batch), {"state": "known", "id": batch})

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
                Path(raw), "wiki", lambda w: extract_wikipedia.extract(
                    path, w, snapshot_version=WIKI_SNAPSHOT_VERSION
                ),
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
                Path(raw), "carolina", lambda w: extract_carolina.extract(
                    path, w, snapshot_version=CAROLINA_SNAPSHOT_VERSION
                ),
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

    def _human_candidate(self, candidate_id: str, member: str) -> dict:
        """A candidate of the JUDICIAL cell, shaped as `extract_carolina` emits it.

        Material of the declared frame, because that is the only material the assembler
        accepts now: `author` is `notApplicable` with the Carolina reason (the extractor
        never reads TEI header names), and no cell of the frame yields a known author.
        """
        from group_axes import NO_AUTHOR_READ, known, not_applicable

        return {
            "candidateId": candidate_id,
            "text": PROSE_60,
            "wordCount": 60,
            "domainSource": "carolina_judicial_branch",
            "licenseId": document_license_of("carolina_judicial_branch"),
            "createdAt": 1621555200000,
            "meta": {
                "dateField": (
                    "TEI@teiHeader/fileDesc/publicationStmt/date[@type=Download]"
                ),
                "observedValue": "2021-05-21T00:00:00+00:00",
                "groupAxes": {
                    "source": known(member),
                    "author": not_applicable(NO_AUTHOR_READ),
                },
                # The acquisition event and the extraction run, which v4 holds apart:
                # re-reading one dump produces a second run and no second material.
                "sourceMaterialBatch": "smb_carolina-v2_0",
                "extractionRun": "extraction_carolina_fresh",
            },
        }

    def test_two_records_of_one_member_file_share_the_source_axis(self) -> None:
        from assemble_corpus import human_record

        first = human_record(
            self._human_candidate("src_carolina_aaa", "carolina_member_judicial_2"),
            "carolina-judicial",
            None,
        )
        second = human_record(
            self._human_candidate("src_carolina_bbb", "carolina_member_judicial_2"),
            "carolina-judicial",
            None,
        )
        self.assertNotEqual(first["id"], second["id"])
        # The point of the whole task: ONE cluster of two on the origin-document axis.
        # A member file holds many TEI documents drawn from one crawl of one domain, so
        # this is a real cluster and the axis is what states it.
        self.assertEqual(first["groups"]["source"], second["groups"]["source"])
        self.assertEqual(first["groups"]["source"]["id"], "carolina_member_judicial_2")
        # The author axis is `notApplicable` on both. That is a statement about the CELL
        # and not a proof about the axis — both fixtures carry the same literal, so the
        # equality holds by construction. The axis itself is exercised by
        # `test_the_author_axis_the_extractor_wrote_travels_unchanged`.
        self.assertEqual(first["groups"]["author"]["state"], "notApplicable")
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

    def test_the_author_axis_the_extractor_wrote_travels_unchanged(self) -> None:
        from assemble_corpus import human_record
        from group_axes import known

        # A CONTRACT fixture for the builder, not a claim about the corpus: no cell of
        # the declared frame yields a known author (the Wikipedia lede is collective work
        # and the Carolina extractor never opens a TEI header), so the value below is
        # hypothetical material. What it pins is that the builder carries the axis the
        # extractor wrote instead of re-deriving it — two rows an extractor states share
        # an author have to come out sharing it, because that is the dependence the split
        # unions on.
        candidates = [
            self._human_candidate(f"src_carolina_{tag}", "carolina_member_judicial_9")
            for tag in ("ccc", "ddd")
        ]
        for candidate in candidates:
            candidate["meta"]["groupAxes"]["author"] = known("au_hmac_shared")
        first, second = (
            human_record(candidate, "carolina-judicial", None)
            for candidate in candidates
        )
        self.assertEqual(first["groups"]["author"], {"state": "known", "id": "au_hmac_shared"})
        self.assertEqual(first["groups"]["author"], second["groups"]["author"])

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

    def test_a_row_naming_no_material_batch_leaves_the_corpus(self) -> None:
        from assemble_corpus import MissingMaterialBatch, human_record

        candidate = self._human_candidate("src_carolina_aaa", "carolina_member_judicial_2")
        del candidate["meta"]["sourceMaterialBatch"]
        # No eligibility-priced escape exists on this axis: the rule admits only `known`
        # on a human row, so the row is unwritable and leaves. The mutation this catches
        # is the one the dead corpus shipped — key a fallback on the stratum
        # (`extraction_<domainSource>`) so every row of one stratum shares an invented
        # acquisition event. That fallback makes every downstream check pass and resolves
        # against no declared `materialBatches` entry.
        with self.assertRaises(MissingMaterialBatch) as caught:
            human_record(candidate, "carolina-judicial", None)
        self.assertIn("sourceMaterialBatch", str(caught.exception))
        self.assertIn("src_carolina_aaa", str(caught.exception))

    def test_a_row_naming_no_extraction_run_leaves_the_corpus(self) -> None:
        from assemble_corpus import MissingExtractionRun, human_record

        candidate = self._human_candidate("src_carolina_aaa", "carolina_member_judicial_2")
        del candidate["meta"]["extractionRun"]
        # Diagnostic axis, non-negotiable state: the run is our own execution, so a gap
        # is a defect in a pipeline we control. The loader is the layer that knows it —
        # the pool FILE is the run — and deriving it from the stratum would merge rows
        # written by different executions into one invented run, destroying the only
        # handle that traces a defect back to the execution that produced it.
        with self.assertRaises(MissingExtractionRun) as caught:
            human_record(candidate, "carolina-judicial", None)
        self.assertIn("extractionRun", str(caught.exception))

    def test_the_loader_stamps_the_run_and_never_the_acquisition(self) -> None:
        from assemble_corpus import load_humans

        # Asserted over the ROWS the loader returns, not over its source text: a stamp
        # written under a computed key (`"source" + "MaterialBatch"`, a module constant,
        # a helper called from here) is the same defect and reads nothing like the
        # literal spelling.
        with tempfile.TemporaryDirectory() as raw:
            cand = Path(raw)
            (cand / "wikipedia_fresh.jsonl").write_text(
                json.dumps(
                    {
                        "candidateId": "ptwiki_0001",
                        "text": PROSE_60,
                        "wordCount": 60,
                        "domainSource": "ptwiki_lead",
                        "meta": {"snapshot": "ptwiki"},
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            rows = [
                r for r in load_humans(cand) if r["candidateId"] == "ptwiki_0001"
            ]
        self.assertEqual(len(rows), 1)
        meta = rows[0]["meta"]
        # The loader knows WHICH FILE it opened, so it can name the run.
        self.assertEqual(meta["extractionRun"], "extraction_wikipedia_fresh")
        # It does NOT know the acquisition event. A stamp here would invent one lot per
        # pool file — the same invented cluster the per-record token was, one level up —
        # and it would resolve against no declared `materialBatches` entry.
        self.assertNotIn("sourceMaterialBatch", meta)

    def test_a_human_record_states_all_fourteen_axes(self) -> None:
        from assemble_corpus import human_record
        from group_axes import V4_GROUP_AXES

        record = human_record(
            self._human_candidate("src_carolina_aaa", "carolina_member_judicial_2"),
            "carolina-judicial",
            None,
        )
        self.assertEqual(sorted(record["groups"]), sorted(V4_GROUP_AXES))
        self.assertEqual(record["schemaVersion"], 4)
        # Every generation axis genuinely does not apply to a human row, and saying
        # so is a statement, not a gap: it costs the record nothing. `generationBatch`
        # is in the list because that is what makes "a human row can never name a
        # declared generation batch" structural instead of a naming convention.
        for axis in (
            "promptTemplate",
            "generatorFamily",
            "generationLane",
            "generationBatch",
        ):
            self.assertEqual(record["groups"][axis]["state"], "notApplicable")
        # The two batch axes a human row DOES fill, and they are different facts: one
        # acquisition event, one execution that read it. Re-extracting the same dump
        # yields a second run and no second material, which is why one axis cannot
        # carry both.
        self.assertEqual(
            record["groups"]["sourceMaterialBatch"],
            {"state": "known", "id": "smb_carolina-v2_0"},
        )
        self.assertEqual(
            record["groups"]["extractionRun"],
            {"state": "known", "id": "extraction_carolina_fresh"},
        )

    def test_an_unknown_axis_is_carried_and_never_synthesized(self) -> None:
        from assemble_corpus import human_record
        from group_axes import unknown

        candidate = self._human_candidate(
            "src_carolina_ccc", "carolina_member_judicial_2"
        )
        candidate["meta"]["groupAxes"]["author"] = unknown("conta removida")
        record = human_record(candidate, "carolina-judicial", None)
        self.assertEqual(record["groups"]["author"]["state"], "unknown")
        self.assertNotIn("id", record["groups"]["author"])


def frozen_policy() -> dict:
    """The live pre-registration, as the lab's own authority reads it."""
    import assemble_corpus

    return json.loads(assemble_corpus.POLICY_PATH.read_text(encoding="utf-8"))


class DeclaredFrameTests(unittest.TestCase):
    """D0 — the four cells of the frame are what the lab collects, and the rest is
    NAMED as outside rather than deleted.

    The frame is `ESTADO.md` § 2: Wikipedia pt (encyclopedic), Carolina judicial branch,
    Carolina university domains, Carolina social media. Stack Overflow is refused on
    access terms (A1/F0-6), product review has no cell, and the other Carolina
    typologies are outside the sampling frame.
    """

    def _candidate(self, candidate_id: str, domain_source: str) -> dict:
        from group_axes import NO_AUTHOR_READ, known, not_applicable

        return {
            "candidateId": candidate_id,
            "text": PROSE_60,
            "wordCount": 60,
            "domainSource": domain_source,
            "licenseId": document_license_of(domain_source),
            "meta": {
                "dateField": (
                    "TEI@teiHeader/fileDesc/publicationStmt/date[@type=Download]"
                ),
                "observedValue": "2021-05-21T00:00:00+00:00",
                "snapshot": "carolina",
                "sourceMaterialBatch": "smb_carolina-v2_0",
                "extractionRun": "extraction_carolina_fresh",
                "groupAxes": {
                    "source": known("carolina_member_1"),
                    "author": not_applicable(NO_AUTHOR_READ),
                },
            },
        }

    def test_the_cells_are_the_cells_every_gate_reads(self) -> None:
        import assemble_corpus

        policy = frozen_policy()
        # THREE authorities name a per-cell population, and only two of them decide
        # anything. `quotaAxis.cells` is what the composition gate tallies over, and
        # `multiplicity.primaryFamily` is what the per-cell FPR gate looks its own
        # hypothesis up in (`fpr-<cell>`); a corpus written in the third vocabulary
        # (`humanCoreStrata`) counts zero lines in all four cells and leaves all four
        # certifying hypotheses undecided. So the two that gate are pinned, and they
        # have to agree with each other.
        cells = set(policy["preRegistration"]["quotaAxis"]["cells"])
        certifying = {
            member.removeprefix("fpr-")
            for member in policy["multiplicity"]["primaryFamily"]
            if member.startswith("fpr-")
        }
        self.assertEqual(cells, certifying)
        self.assertEqual(set(assemble_corpus.REGISTER.values()), cells)
        self.assertEqual(assemble_corpus.QUOTA_CELLS, tuple(sorted(cells)))
        # And the seal's coverage check reads the SAME field, so its list has to carry
        # the same spelling: requiring the register words would refuse every corpus the
        # composition gate can pass. Parsed out of the TypeScript constant because that
        # is the artifact `sealDataset` reads.
        source = (
            Path(__file__).resolve().parent.parent / "dataset-manifest.ts"
        ).read_text(encoding="utf-8")
        required = re.search(
            r"requiredHumanSourceTypes:\s*\[([^\]]*)\]", source, re.DOTALL
        )
        self.assertIsNotNone(
            required, "RELEASE_CORPUS_POLICY.requiredHumanSourceTypes nao foi encontrado"
        )
        self.assertEqual(set(re.findall(r'"([^"]+)"', required.group(1))), cells)
        # Keyed alike, because one map decides the cell and the other the provenance: a
        # candidate admitted by one and unknown to the other is a row with a cell and no
        # source, or a source counted under no ceiling.
        self.assertEqual(
            sorted(assemble_corpus.REGISTER), sorted(assemble_corpus.HUMAN_SOURCE)
        )
        # And the sources those cells draw on are exactly the ones the reviewed inventory
        # stocks — parsed from `source-manifest.ts`, which is the authority the corpus
        # audit joins against, so the two cannot drift apart silently.
        self.assertEqual(
            set(assemble_corpus.HUMAN_SOURCE.values()),
            set(assemble_corpus.declared_group_axes()),
        )

    def test_no_source_outside_the_frame_is_admitted_by_either_map(self) -> None:
        import assemble_corpus

        outside = set(assemble_corpus.OUT_OF_FRAME_DOMAIN_SOURCES) | set(
            assemble_corpus.A1_BLOCKED_DOMAIN_SOURCES
        )
        # Declared AND disjoint. The pair of lists is the F0-6 discipline (a source that
        # leaves by deletion is one the pipeline goes silent on), and this assertion is
        # the other half: naming it must not admit it.
        self.assertEqual(outside & set(assemble_corpus.REGISTER), set())
        for expected in ("b2w_reviews", "carolina_legislative_branch"):
            self.assertIn(expected, assemble_corpus.OUT_OF_FRAME_DOMAIN_SOURCES)
        self.assertIn("ptso_qa", assemble_corpus.A1_BLOCKED_DOMAIN_SOURCES)
        # Two different facts, and the reasons say which is which: an access term is a
        # legal condition that can be satisfied, having no cell is a scope decision.
        self.assertIn(
            "access terms", assemble_corpus.A1_BLOCKED_DOMAIN_SOURCES["ptso_qa"]
        )
        self.assertIn(
            "no cell", assemble_corpus.OUT_OF_FRAME_DOMAIN_SOURCES["b2w_reviews"]
        )

    def test_a_pool_row_outside_the_frame_never_reaches_the_selection(self) -> None:
        from assemble_corpus import load_humans

        # TWO screens, and the fixture separates them. The register filter has to drop a
        # legislative row planted INSIDE the Carolina pool, which is what a re-extraction
        # that forgets the typology allowlist writes. The FILE screen is measured by the
        # row planted in `b2w_fresh.jsonl` carrying an in-frame `domainSource`: the filter
        # would admit it, so it can only be absent if the file was never opened. A
        # mislabelled row is exactly the case where the two screens differ.
        with tempfile.TemporaryDirectory() as raw:
            cand = Path(raw)
            rows = {
                "carolina_fresh": [
                    ("src_carolina_in", "carolina_judicial_branch"),
                    ("src_carolina_leg", "carolina_legislative_branch"),
                ],
                "b2w_fresh": [("src_b2w_mislabelled", "carolina_social_media")],
                "ptso_fresh": [("src_ptso_1", "ptso_qa")],
            }
            for name, entries in rows.items():
                (cand / f"{name}.jsonl").write_text(
                    "".join(
                        json.dumps(self._candidate(cid, source)) + "\n"
                        for cid, source in entries
                    ),
                    encoding="utf-8",
                )
            loaded = load_humans(cand)
        # Filtered to the planted ids: `load_humans` also reads the reserved pool from
        # `benchmark/data/dataset`, which the `cand` parameter does not redirect, so an
        # assertion over everything it returns would depend on a gitignored file.
        planted = {
            "src_carolina_in",
            "src_carolina_leg",
            "src_b2w_mislabelled",
            "src_ptso_1",
        }
        self.assertEqual(
            [r["candidateId"] for r in loaded if r["candidateId"] in planted],
            ["src_carolina_in"],
        )
        # The run stamp is the loader's own record of WHICH FILE it opened, so this holds
        # over every row it returns, planted or not.
        self.assertEqual(
            {r["meta"]["extractionRun"] for r in loaded}
            - {
                "extraction_wikipedia_fresh",
                "extraction_carolina_fresh",
                "extraction_reserved",
            },
            set(),
        )

    def test_a_row_outside_the_frame_is_refused_by_name_and_only_counted(self) -> None:
        from assemble_corpus import (
            OutOfFrameDomainSource,
            UnwritableInV3,
            human_record,
        )

        # The structural half: even handed straight to the builder, the row leaves. And it
        # leaves as an `UnwritableInV3`, so `main` COUNTS it — the size of what the frame
        # change costs is reported, never swallowed and never a crash.
        self.assertTrue(issubclass(OutOfFrameDomainSource, UnwritableInV3))
        for domain_source, expected in (
            ("b2w_reviews", "no cell"),
            ("ptso_qa", "access terms"),
            ("carolina_legislative_branch", "outside the sampling frame"),
        ):
            candidate = self._candidate("src_x_1", domain_source)
            with self.assertRaises(OutOfFrameDomainSource) as caught:
                human_record(candidate, "carolina-judicial", None)
            message = str(caught.exception)
            self.assertIn(domain_source, message)
            self.assertIn(expected, message)
            self.assertIn("ptwiki_lead", message)

    def test_a_domain_source_nobody_decided_about_refuses_the_run(self) -> None:
        import hashlib

        from assemble_corpus import (
            UndecidedDomainSource,
            UnwritableInV3,
            cell_of,
            human_record,
            mixed_record,
        )

        # The asymmetry `extract_carolina` already has on the typology axis, on the source
        # axis: a DECIDED exclusion is a counted drop, an UNDECIDED one stops the run. The
        # two declared lists ARE the decision, so a name in neither is a name nobody
        # looked at — and the case is real, because `domainSource` is minted from the
        # typology directory and the Carolina releases spell it two ways.
        self.assertFalse(issubclass(UndecidedDomainSource, UnwritableInV3))
        candidate = self._candidate("src_x_9", "carolina_judicial_branch_v2")
        with self.assertRaises(UndecidedDomainSource) as caught:
            cell_of(candidate)
        message = str(caught.exception)
        self.assertIn("carolina_judicial_branch_v2", message)
        for named in ("ptwiki_lead", "ptso_qa", "carolina_legislative_branch"):
            self.assertIn(named, message)
        # Both builders, because both are the drop-and-count path: a run that swallows
        # this as an ordinary out-of-frame drop empties a cell in silence.
        with self.assertRaises(UndecidedDomainSource):
            human_record(candidate, "carolina-judicial", None)
        pair = {
            "parentId": "src_carolina_zzz",
            "text": PROSE_60,
            "provider": "antigravity",
            "model": "gemini-3.6-flash-low",
            "promptTemplateId": "mix_edit_v1",
            "promptTemplateDigest": hashlib.sha256(b"edit").hexdigest(),
            "parentFamily": "carolina_judicial_branch_v2",
            "sourceMaterialBatch": "smb_carolina-v2_0",
            "mixture": {
                "spans": [
                    {"start": 0, "end": 200, "origin": "human"},
                    {"start": 200, "end": len(PROSE_60), "origin": "ai"},
                ]
            },
        }
        with self.assertRaises(UndecidedDomainSource):
            mixed_record(pair)

    def test_a_row_labelled_with_another_cells_name_is_refused(self) -> None:
        from assemble_corpus import OutOfFrameDomainSource, human_record

        # The cell decides WHICH ceiling counts the row. A judicial line counted as
        # university moves two published ceilings at once, and neither is then about the
        # population it names.
        candidate = self._candidate("src_carolina_in", "carolina_judicial_branch")
        with self.assertRaises(OutOfFrameDomainSource) as caught:
            human_record(candidate, "carolina-university", None)
        self.assertIn("carolina-judicial", str(caught.exception))
        self.assertIn("carolina-university", str(caught.exception))

    def test_a_mixed_row_whose_parent_is_outside_the_frame_leaves_too(self) -> None:
        import hashlib

        from assemble_corpus import OutOfFrameDomainSource, mixed_record

        # A mechanistic mixed row IS its parent's human text with generated stretches, so
        # it is counted in the parent's cell. The pairs on disk were mixed from B2W and
        # Stack Overflow parents, and they have to leave with their parents instead of
        # entering as a stratum no ceiling covers.
        candidate = {
            "parentId": "src_b2w_00848b3bc692",
            "text": PROSE_60,
            "provider": "antigravity",
            "model": "gemini-3.6-flash-low",
            "promptTemplateId": "mix_edit_v1",
            "promptTemplateDigest": hashlib.sha256(b"edit").hexdigest(),
            "parentFamily": "b2w_reviews",
            "sourceMaterialBatch": "smb_b2w_2018",
            "mixture": {
                "spans": [
                    {"start": 0, "end": 200, "origin": "human"},
                    {"start": 200, "end": len(PROSE_60), "origin": "ai"},
                ]
            },
        }
        with self.assertRaises(OutOfFrameDomainSource) as caught:
            mixed_record(candidate)
        self.assertIn("b2w_reviews", str(caught.exception))
        self.assertIn("no cell", str(caught.exception))

    def test_no_hard_negative_family_points_at_a_cell_no_material_feeds(self) -> None:
        import assemble_corpus

        # The silent failure this catches, measured: the tagging pass reads
        # `by_reg_recs[HN_REGISTER[family]]`, so a style pointing at a cell the register
        # no longer produces gets an EMPTY pool, tags nothing, and the family it names is
        # then absent from `requiredHardNegativeFamilies` — the seal is refused at the end
        # of a full assembly, by a dict entry that reads as harmless.
        self.assertEqual(
            set(assemble_corpus.HN_REGISTER), set(assemble_corpus.HARD_NEGATIVE_FAMILIES)
        )
        self.assertEqual(
            set(assemble_corpus.HN_REGISTER.values()) - set(assemble_corpus.QUOTA_CELLS),
            set(),
        )
        # And the OTHER direction, which is about the published claim rather than about
        # an empty pool: every cell publishes its own FPR ceiling, so a cell no style
        # family is drawn from publishes a ceiling measured on material that never
        # carries the adversarial register the other three cells carry. The families are
        # STYLE families and the assignment is a judgement about the material, so the
        # concentration is admissible (three come from social media) and the ABSENCE is
        # not.
        self.assertEqual(
            set(assemble_corpus.QUOTA_CELLS) - set(assemble_corpus.HN_REGISTER.values()),
            set(),
        )
        # The families of the policy, not a retyped list: a seventh family added to the
        # frozen `hardNegativeFamilies` without an entry here would tag nothing and the
        # seal would refuse the corpus for it.
        self.assertEqual(
            sorted(assemble_corpus.HARD_NEGATIVE_FAMILIES),
            sorted(frozen_policy()["hardNegativeFamilies"]),
        )

    def test_the_snapshot_fallback_names_only_the_stocked_snapshots(self) -> None:
        import assemble_corpus

        policy = frozen_policy()
        blocked = {
            row["snapshot"] for row in policy["humanSources"]["blockedSnapshots"]
        }
        # `label_evidence` falls back to this map, so an entry here dates a row against a
        # snapshot: one for a base the policy does not stock would write label evidence
        # naming material the frame has no access to.
        self.assertEqual(
            set(assemble_corpus.SOURCE_SNAPSHOT.values()),
            set(policy["humanSources"]["snapshots"]),
        )
        self.assertEqual(set(assemble_corpus.SOURCE_SNAPSHOT.values()) & blocked, set())

    def test_the_carolina_typologies_of_the_frame_are_the_lab_cells(self) -> None:
        import assemble_corpus
        import extract_carolina

        # The join between the two modules, in the two vocabularies that name the same
        # fact: the extractor speaks typology directories, the assembler speaks
        # domainSources (`carolina_<typology>`). Without this, the extractor could emit a
        # typology the assembler refuses — a full extraction whose rows all drop.
        self.assertEqual(
            {f"carolina_{name}" for name in extract_carolina.FRAME_TYPOLOGIES},
            {name for name in assemble_corpus.REGISTER if name.startswith("carolina_")},
        )
        self.assertEqual(
            {f"carolina_{name}" for name in extract_carolina.OUT_OF_FRAME_TYPOLOGIES}
            - set(assemble_corpus.OUT_OF_FRAME_DOMAIN_SOURCES),
            set(),
        )


class CollectionTargetTests(unittest.TestCase):
    """D4 — the human target per cell is READ from the pre-registration.

    `TARGET["human"]` was 4.000 for a frame of four cells whose blind block has to hold
    300 human negatives each: 1.000 lines per cell put ~200 into `test`, a third under
    the denominator the published ceiling needs.
    """

    def test_the_human_target_is_the_policys_and_never_a_literal(self) -> None:
        import assemble_corpus

        collection = frozen_policy()["collection"]
        self.assertEqual(assemble_corpus.TARGET["human"], collection["humanLinesTotal"])
        self.assertEqual(
            assemble_corpus.TARGET["human"],
            collection["humanLinesPerCellTarget"] * len(assemble_corpus.QUOTA_CELLS),
        )
        # The three class quotas together are what `sealDataset` compares against, BY
        # EXACT EQUALITY, so the lab's composition is pinned to the release policy rather
        # than to three numbers that happen to agree today. Read out of the TypeScript
        # constant because that is the artifact the seal reads.
        source = (
            Path(__file__).resolve().parent.parent / "dataset-manifest.ts"
        ).read_text(encoding="utf-8")
        counts = re.search(
            r"counts:\s*\{\s*human:\s*([\d_]+),\s*ai:\s*([\d_]+),\s*mixed:\s*([\d_]+)",
            source,
        )
        self.assertIsNotNone(counts, "RELEASE_CORPUS_POLICY.counts nao foi encontrado")
        self.assertEqual(
            assemble_corpus.TARGET,
            {
                "human": int(counts.group(1).replace("_", "")),
                "ai": int(counts.group(2).replace("_", "")),
                "mixed": int(counts.group(3).replace("_", "")),
            },
        )

    def test_a_collection_block_that_does_not_close_is_refused(self) -> None:
        import assemble_corpus

        policy = frozen_policy()
        with tempfile.TemporaryDirectory() as raw:
            def written(collection: dict) -> Path:
                path = Path(raw) / "policy.json"
                path.write_text(
                    json.dumps({**policy, "collection": collection}), encoding="utf-8"
                )
                return path

            # The total derived from the FLOOR instead of the target — the exact mistake
            # the ratification corrected. It would refuse every corpus carrying the
            # collection margin, because the seal compares by exact equality.
            with self.assertRaises(ValueError) as caught:
                assemble_corpus.collection_targets(
                    written(
                        {
                            **policy["collection"],
                            "humanLinesTotal": 6_000,
                        }
                    )
                )
            self.assertIn("6000", str(caught.exception).replace("_", ""))
            self.assertIn("1750", str(caught.exception))

            # And a target AT the floor, which removes the margin: the expected count in
            # a 20 % blind block is then exactly the floor, so half the draws fail the
            # composition gate with nothing wrong with the corpus.
            floor = policy["collection"]["humanLinesPerCellMinimum"]
            with self.assertRaises(ValueError) as caught:
                assemble_corpus.collection_targets(
                    written(
                        {
                            **policy["collection"],
                            "humanLinesPerCellTarget": floor,
                            "humanLinesTotal": floor * 4,
                        }
                    )
                )
            self.assertIn("floor", str(caught.exception))

    def test_the_quota_is_per_cell_and_never_filled_from_another_cell(self) -> None:
        from collections import Counter

        import assemble_corpus

        per_cell = frozen_policy()["collection"]["humanLinesPerCellTarget"]
        by_cell = {
            source: [
                {
                    "candidateId": f"{source}_{index:05d}",
                    "text": PROSE_60,
                    "wordCount": 60,
                    "domainSource": source,
                }
                for index in range(per_cell + 40)
            ]
            for source in assemble_corpus.REGISTER
        }
        pool = [row for rows in by_cell.values() for row in rows]
        chosen = assemble_corpus.balanced_humans(pool, assemble_corpus.TARGET["human"])
        counted = Counter(
            assemble_corpus.REGISTER[row["domainSource"]] for row in chosen
        )
        # Every cell gets the POLICY's per-cell target, and the surplus of a rich pool is
        # left on the floor. The mutation this catches is dividing by the cells the pools
        # happen to contain instead of the cells the frame declares.
        self.assertEqual(
            dict(counted), {cell: per_cell for cell in assemble_corpus.QUOTA_CELLS}
        )

        # ...and a SHORT cell stays short. Topping it up out of another cell's pool
        # reaches the total, spends the budget on material the missing cell's ceiling
        # cannot use, and the composition gate refuses the seal at the end of the run.
        short = [row for row in pool if row["domainSource"] != "carolina_social_media"]
        short += by_cell["carolina_social_media"][:5]
        thin = assemble_corpus.balanced_humans(short, assemble_corpus.TARGET["human"])
        thin_counted = Counter(
            assemble_corpus.REGISTER[row["domainSource"]] for row in thin
        )
        self.assertEqual(thin_counted["carolina-social-media"], 5)
        self.assertEqual(len(thin), per_cell * 3 + 5)

        # The DENOMINATOR, which the case above cannot see: with four cells present,
        # "declared" and "arrived" are the same number. A cell contributing NOTHING
        # separates them — declared keeps the other three at the per-cell target
        # (3 x 1.750 = 5.250 selected), while dividing by what arrived would raise each
        # of them to 2.334/2.333/2.333 and reach the total out of the wrong material.
        absent = [row for row in pool if row["domainSource"] != "carolina_social_media"]
        without = assemble_corpus.balanced_humans(
            absent, assemble_corpus.TARGET["human"]
        )
        without_counted = Counter(
            assemble_corpus.REGISTER[row["domainSource"]] for row in without
        )
        self.assertEqual(
            dict(without_counted),
            {
                cell: per_cell
                for cell in assemble_corpus.QUOTA_CELLS
                if cell != "carolina-social-media"
            },
        )
        self.assertEqual(len(without), per_cell * 3)


class PowerFloorFeasibilityTests(unittest.TestCase):
    """The pre-registered floors are compared against the POOL, before the assembly.

    The composition gate counts the same quantities over the finished corpus at sealing
    time, so a cell that cannot reach them is a refusal that costs a whole extraction and
    a whole assembly to hear.
    """

    def _rows(self, documents: dict[str, int], lines_each: int = 1) -> list[dict]:
        from group_axes import NO_AUTHOR_READ, known, not_applicable

        return [
            {
                "candidateId": f"{source}_{document:05d}_{line}",
                "text": PROSE_60,
                "wordCount": 60,
                "domainSource": source,
                "meta": {
                    "sourceMaterialBatch": "smb_carolina-v2_0",
                    "extractionRun": "extraction_carolina_fresh",
                    "groupAxes": {
                        "source": known(f"{source}_member_{document:05d}"),
                        "author": not_applicable(NO_AUTHOR_READ),
                    },
                },
            }
            for source, count in documents.items()
            for document in range(count)
            for line in range(lines_each)
        ]

    def test_a_cell_short_of_origin_documents_is_refused_before_the_assembly(
        self,
    ) -> None:
        import assemble_corpus

        floor = frozen_policy()["powerFloors"]["samplingUnits"]
        # The numbers are the MEASURED ones: the Carolina package holds 37 member files
        # under the judicial typology, 7 under university domains and 2 under social
        # media, and the member file is the `source` axis this counts.
        rows = self._rows(
            {
                "ptwiki_lead": floor,
                "carolina_judicial_branch": 37,
                "carolina_university_domains": 7,
                "carolina_social_media": 2,
            },
            lines_each=3,
        )
        self.assertEqual(
            assemble_corpus.origin_documents_per_cell(rows),
            {
                "ptwiki": floor,
                "carolina-judicial": 37,
                "carolina-university": 7,
                "carolina-social-media": 2,
            },
        )
        with self.assertRaises(assemble_corpus.CellBelowOriginDocumentFloor) as caught:
            assemble_corpus.assert_cells_can_meet_the_origin_document_floor(rows)
        message = str(caught.exception)
        for expected in (
            "carolina-judicial=37",
            "carolina-university=7",
            "carolina-social-media=2",
            str(floor),
        ):
            self.assertIn(expected, message)
        # The cell that reaches the floor is not named: the refusal is per cell, and a
        # message that listed all four would not say which extraction has to grow.
        self.assertNotIn("ptwiki", message)

    def test_lines_never_stand_in_for_origin_documents(self) -> None:
        import assemble_corpus

        floor = frozen_policy()["powerFloors"]["samplingUnits"]
        # The derivation the guard rests on: one line per origin document is the
        # pre-registered cap, so 300 lines sliced out of 5 member files are 5 draws and
        # the cell can hold at most 5 of them in the blind block. A pool that is enormous
        # in LINES and thin in documents is exactly the shape that used to reach the seal.
        rows = self._rows(
            {source: 5 for source in assemble_corpus.REGISTER}, lines_each=100
        )
        self.assertEqual(len(rows), 4 * 5 * 100)
        with self.assertRaises(assemble_corpus.CellBelowOriginDocumentFloor) as caught:
            assemble_corpus.assert_cells_can_meet_the_origin_document_floor(rows)
        self.assertIn("=5", str(caught.exception))
        # ...and a pool AT the floor passes: the bound is inclusive, like every other
        # comparison against a pre-registered floor in this pipeline.
        enough = self._rows({source: floor for source in assemble_corpus.REGISTER})
        assemble_corpus.assert_cells_can_meet_the_origin_document_floor(enough)

    def test_the_release_assembly_calls_the_floor_before_selecting(self) -> None:
        source = (Path(__file__).resolve().parent / "assemble_corpus.py").read_text(
            encoding="utf-8"
        )
        # A guard with no production caller is a guard that only tests run. The floor has
        # to be compared where the run can still be stopped cheaply, which is before
        # `balanced_humans` spends the quota.
        self.assertIn("assert_cells_can_meet_the_origin_document_floor(humans)", source)
        self.assertLess(
            source.index("assert_cells_can_meet_the_origin_document_floor(humans)"),
            source.index("human_sel = balanced_humans("),
        )


class HardNegativeTaggingTests(unittest.TestCase):
    """Every required style family is tagged out of the cell it is drawn from.

    The demands ADD UP per cell, because one row cannot carry two families — and three of
    the six styles are drawn from social media, which is the thinnest cell of the frame.
    """

    def _humans(self, per_cell: dict[str, int]) -> list[dict]:
        return [
            {"label": "human", "id": f"{cell}_{index:05d}", "humanSourceType": cell}
            for cell, count in per_cell.items()
            for index in range(count)
        ]

    def test_every_required_family_is_tagged_out_of_its_own_cell(self) -> None:
        import assemble_corpus

        tag_per = 35
        demand = assemble_corpus.hard_negative_demand_per_cell(tag_per)
        self.assertEqual(
            sum(demand.values()), tag_per * len(assemble_corpus.HARD_NEGATIVE_FAMILIES)
        )
        # Sized EXACTLY at the demand, which is what makes the fixture sensitive to which
        # cell each family is drawn from: moving one family onto another cell puts that
        # cell over its pool.
        records = self._humans(demand)
        tagged = assemble_corpus.tag_hard_negatives(records, tag_per)
        self.assertEqual(
            tagged,
            {family: tag_per for family in assemble_corpus.HARD_NEGATIVE_FAMILIES},
        )
        for record in records:
            family = record.get("hardNegativeFamily")
            if family is not None:
                self.assertEqual(
                    assemble_corpus.HN_REGISTER[family], record["humanSourceType"]
                )

    def test_a_cell_that_cannot_cover_its_families_refuses_before_tagging(self) -> None:
        import assemble_corpus

        tag_per = 35
        demand = assemble_corpus.hard_negative_demand_per_cell(tag_per)
        thin = max(demand, key=lambda cell: demand[cell])
        records = self._humans({**demand, thin: demand[thin] - 1})
        with self.assertRaises(assemble_corpus.HardNegativeCellUnderfilled) as caught:
            assemble_corpus.tag_hard_negatives(records, tag_per)
        message = str(caught.exception)
        self.assertIn(thin, message)
        self.assertIn(str(demand[thin]), message)
        for family in assemble_corpus.HARD_NEGATIVE_FAMILIES:
            if assemble_corpus.HN_REGISTER[family] == thin:
                self.assertIn(family, message)
        # NOTHING was tagged: a corpus tagged halfway travels to the seal and is refused
        # there, which is the failure this replaces.
        self.assertEqual([r for r in records if "hardNegativeFamily" in r], [])


class MixedFrameAccountingTests(unittest.TestCase):
    """The mixed class is counted in the PARENT's cell, and its deficit is reported."""

    def _pair(self, parent_family: str, index: int) -> dict:
        return {
            "parentId": f"src_{parent_family}_{index:05d}",
            "parentFamily": parent_family,
            "text": PROSE_60,
        }

    def test_the_mixed_deficit_is_reported_by_parent(self) -> None:
        import assemble_corpus

        # Measured over the pairs on disk: 1.337 of 2.135 mixed rows were mixed from
        # parents outside the frame, so the class comes out at 798 against a quota of
        # 2.000 compared BY EXACT EQUALITY. Which parents they were is the number that
        # says what a regeneration has to draw on.
        rows = (
            [self._pair("carolina_judicial_branch", i) for i in range(3)]
            + [self._pair("ptwiki_lead", i) for i in range(2)]
            + [self._pair("ptso_qa", i) for i in range(7)]
            + [self._pair("b2w_reviews", i) for i in range(1)]
            + [{"parentId": "src_orphan", "parentFamily": "?", "text": PROSE_60}]
        )
        inside, outside = assemble_corpus.mixed_parents_by_frame(rows)
        self.assertEqual(inside, {"carolina-judicial": 3, "ptwiki": 2})
        self.assertEqual(outside, {"ptso_qa": 7, "b2w_reviews": 1, "?": 1})
        # A partition, so no row is counted twice and none disappears: a screen that
        # empties the class in silence is the failure being reported against.
        self.assertEqual(sum(inside.values()) + sum(outside.values()), len(rows))

    def test_the_run_reports_the_deficit_it_would_otherwise_swallow(self) -> None:
        source = (Path(__file__).resolve().parent / "assemble_corpus.py").read_text(
            encoding="utf-8"
        )
        self.assertIn("mixed_parents_by_frame(mixed)", source)


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
            "parentId": "src_carolina_0f89e00a4836",
            "text": PROSE_60,
            "provider": "antigravity",
            "model": "gemini-3.6-flash-low",
            "generatedAt": "2026-07-23T18:53:31.606876+00:00",
            "promptTemplateId": "edit_v1",
            "promptTemplateDigest": hashlib.sha256(b"edit").hexdigest(),
            "parentFamily": "carolina_judicial_branch",
            "sourceMaterialBatch": "smb_carolina-v2_0",
            "mixture": {
                "spans": [
                    {"start": 0, "end": 200, "origin": "human"},
                    {"start": 200, "end": len(PROSE_60), "origin": "ai"},
                ]
            },
        }
        record = mixed_record(candidate)
        parent = "src_carolina_0f89e00a4836"
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
            "parentId": "src_carolina_0f89e00a4836",
            "text": PROSE_60,
            "provider": "antigravity",
            "model": "gemini-3.6-flash-low",
            "generatedAt": "2026-07-23T18:53:31.606876+00:00",
            "parentFamily": "carolina_judicial_branch",
            "mixture": {
                "spans": [{"start": 0, "end": len(PROSE_60), "origin": "human"}]
            },
        }
        # The mixing template digest is not recoverable from a pool row that never
        # recorded it. Guessing it from whichever template is in make_mixed.py TODAY
        # would attach a recipe the row cannot support, so the row leaves instead.
        with self.assertRaises(MissingRecipe):
            mixed_record(candidate)

    def test_a_mixed_pair_that_lost_the_parent_s_material_batch_is_refused(self) -> None:
        import hashlib

        from assemble_corpus import MissingMaterialBatch, mixed_record

        candidate = {
            "parentId": "src_carolina_0f89e00a4836",
            "text": PROSE_60,
            "provider": "antigravity",
            "model": "gemini-3.6-flash-low",
            "generatedAt": "2026-07-23T18:53:31.606876+00:00",
            "promptTemplateId": "edit_v1",
            "promptTemplateDigest": hashlib.sha256(b"edit").hexdigest(),
            "parentFamily": "carolina_judicial_branch",
            "mixture": {
                "spans": [
                    {"start": 0, "end": 200, "origin": "human"},
                    {"start": 200, "end": len(PROSE_60), "origin": "ai"},
                ]
            },
        }
        # The material a mixed row depends on is the PARENT's acquisition event, and the
        # axis rule admits only `known` on a mechanistic mixed row — so there is no
        # eligibility-priced escape and no value to derive. A placeholder here
        # (`smb_unknown`, or the parent id) would pool every pair whose parent's batch was
        # lost into one invented acquisition, and it would resolve against no declared
        # `materialBatches` entry. The pair file has to carry it; a pair that does not
        # leaves the corpus.
        with self.assertRaises(MissingMaterialBatch) as caught:
            mixed_record(candidate)
        self.assertIn("sourceMaterialBatch", str(caught.exception))
        self.assertIn("mix_src_carolina_0f89e00a4836", str(caught.exception))


class GenerationBatchAxisTests(unittest.TestCase):
    """`groups.generationBatch` — the `batch` axis requirement 2 fixes for the IA source.

    THIS AXIS WAS REACHED BY NO TEST IN ANY LANGUAGE before this class. `ai_record`
    and `mixed_record` both write `unknown("the generation batch is derived after
    partitioning")`, and only `assign_generation_batches` — called once, from
    `main()`, after `assign_partitions` — turns that into a `known` `gb_` id. Two
    mutations measured the gap on the committed tree at c3362ca, and BOTH left the
    lab suite at 86 tests OK:

      * `return []` at the top of `assign_generation_batches`: every generated row
        keeps `generationBatch: unknown`, so all 540 generated records of the
        delivered run become UNWRITABLE — `AXIS_STATE_RULE.generationBatch` allows
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
            "parentFamily": "carolina_judicial_branch",
            "sourceMaterialBatch": "smb_carolina-v2_0",
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

        blocks = partitions or ["dev"] * len(records)
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
        axis = rows[0]["groups"]["generationBatch"]
        self.assertEqual(axis["state"], "known")
        self.assertTrue(axis["id"].startswith("gb_ai_"), axis)
        self.assertEqual(axis, rows[1]["groups"]["generationBatch"])
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
                    left["groups"]["generationBatch"]["id"],
                    right["groups"]["generationBatch"]["id"],
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
            left["groups"]["generationBatch"]["id"],
            right["groups"]["generationBatch"]["id"],
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
        batches = self._batched([left, right], ["dev", "cal-A"])
        # THE PROPERTY THAT MAKES A SHARED AXIS SAFE, and it was asserted nowhere.
        # `generationBatch` IS a grouping axis, so two rows sharing it form one split
        # component; the docstring's argument that this cannot leak across blocks is
        # that `generatedAt` is part of the key and equals the record's block time, so
        # an identical recipe stamped into two blocks yields TWO batches. If that ever
        # stopped holding, a single batch would span dev and test and the
        # split would be refused — with the corpus already written.
        self.assertEqual(len(batches), 2)
        self.assertNotEqual(
            left["groups"]["generationBatch"]["id"],
            right["groups"]["generationBatch"]["id"],
        )
        self.assertEqual(
            {b["generatedAt"] for b in batches},
            {left["generation"]["generatedAt"], right["generation"]["generatedAt"]},
        )

    def test_a_mixed_row_never_joins_a_generated_row_s_batch(self) -> None:
        from assemble_corpus import ai_record, mixed_record

        ai = ai_record(self._api_candidate("src_ai_gemini_aaaaaaaaaaaa"))
        mixed = mixed_record(self._mixed_candidate("src_carolina_0f89e00a4836"))
        batches = self._batched([ai, mixed])
        # The two recipes are identical in every component EXCEPT sourceId, which is
        # what this pins. The batch ID embeds `rec["label"]` while the batch KEY does
        # not, so `sourceId` is the only thing keeping a mixed record from linking a
        # batch published as `gb_ai_...` — a record whose class disagrees with the
        # batch it names.
        self.assertEqual(len(batches), 2)
        self.assertTrue(ai["groups"]["generationBatch"]["id"].startswith("gb_ai_"))
        self.assertTrue(mixed["groups"]["generationBatch"]["id"].startswith("gb_mixed_"))
        self.assertEqual(
            {b["sourceId"] for b in batches}, {"src_ai", "src_mixed"}
        )

    def test_no_generated_record_is_left_unknown_on_the_batch_axis(self) -> None:
        from assemble_corpus import ai_record, human_record, mixed_record

        human = human_record(
            AssemblerRealGroupTests()._human_candidate(
                "src_carolina_aaa", "carolina_member_judicial_2"
            ),
            "carolina-judicial",
            None,
        )
        records = [
            ai_record(self._api_candidate("src_ai_gemini_aaaaaaaaaaaa")),
            ai_record(self._api_candidate("src_ai_gemini_bbbbbbbbbbbb")),
            ai_record(
                self._api_candidate("src_ai_gemini_cccccccccccc", temperature="0.5")
            ),
            mixed_record(self._mixed_candidate("src_carolina_0f89e00a4836")),
            human,
        ]
        # Every generated row carries `unknown` UNTIL the batches are derived, which
        # is a true statement while it is true — `main()` closes it in the same run.
        for record in records[:-1]:
            self.assertEqual(
                record["groups"]["generationBatch"]["state"], "unknown", record["id"]
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
        #   BASELINE  generationBatch clusters=27 registros_agrupados=786
        #             maior=gb_mixed_0020/90 estados={'known': 786}
        #   MUTANT    generationBatch clusters=4  registros_agrupados=246
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
        #   * NOT SILENT on the sealed side. `AXIS_STATE_RULE.generationBatch` in
        #     benchmark/schema.ts allows ONLY `known`, in all four axis classes, so
        #     `validate` -> `parseBenchmarkDataset` -> `validateBenchmarkRecordV3`
        #     refuses the record itself. Measured verbatim by forcing the axis back on
        #     each fixture above: `BENCHMARK_RECORD_INVALID: groups.generationBatch of
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
        # is never REACHED for an `unknown` `generationBatch`, because the parse throws
        # first. Measured on the valid fixtures, eligibility varies and is beside the
        # point: the three api rows and the human row are {eligible: true, unknownAxes:
        # []}, the mixed row is {eligible: false, unknownAxes: ["author", "source"]},
        # and the `agy` rows are {eligible: false, unknownAxes: ["harnessVersion"]} —
        # all seven refused with the messages above once the axis is forced back. Two
        # consequences for whoever reads this next: this test is NOT the only defence,
        # and the schema entry is NOT redundant with it. The reason the generalisation
        # does not carry is the rule itself: `harnessVersion` admits `unknown` for ai,
        # so there the price is eligibility; `generationBatch` admits only `known` in
        # every class, so here the price is the record.
        for record in records[:-1]:
            axis = record["groups"]["generationBatch"]
            self.assertEqual(axis["state"], "known", record["id"])
            self.assertTrue(axis["id"].startswith("gb_"), axis)
        # The human row is the one that does NOT become `known` here, and the axis rule
        # is what makes it so: `generationBatch` admits only `notApplicable` on a human
        # record, so the pass cannot reach it even by accident.
        self.assertEqual(
            records[-1]["groups"]["generationBatch"]["state"], "notApplicable"
        )

    def test_a_human_row_keeps_its_two_batch_axes_and_can_name_no_gb_id(self) -> None:
        from assemble_corpus import human_record

        candidate = AssemblerRealGroupTests()._human_candidate(
            "src_carolina_aaa", "carolina_member_judicial_2"
        )
        record = human_record(candidate, "carolina-judicial", None)
        # The EXTRACTION run that wrote the row — shared by every candidate of one pool
        # file, `known` from the start and never touched by `assign_generation_batches`
        # — and the ACQUISITION event it was read out of, which is a different fact.
        self.assertEqual(
            record["groups"]["extractionRun"],
            {"state": "known", "id": "extraction_carolina_fresh"},
        )
        self.assertEqual(
            record["groups"]["sourceMaterialBatch"],
            {"state": "known", "id": "smb_carolina-v2_0"},
        )
        before = {
            axis: dict(record["groups"][axis])
            for axis in ("sourceMaterialBatch", "extractionRun", "generationBatch")
        }
        batches = self._batched([record])
        self.assertEqual(batches, [])
        for axis, value in before.items():
            self.assertEqual(record["groups"][axis], value, axis)
        # THE NON-COLLISION, now structural rather than a prefix convention: the
        # governance audit rejects a non-generated record that names a declared
        # GENERATION batch, and `generationBatch` admits only `notApplicable` on a human
        # row, so there is no value at all a human record could carry there. The dead
        # corpus bought this obligation with `extraction_` not colliding with `gb_`, and
        # a fallback rewritten to a bare token (`batch_x`) broke it silently.
        self.assertEqual(
            record["groups"]["generationBatch"]["state"], "notApplicable"
        )
        self.assertNotIn("id", record["groups"]["generationBatch"])

    def test_an_ai_record_states_all_fourteen_axes(self) -> None:
        from assemble_corpus import ai_record
        from group_axes import V4_GROUP_AXES

        record = ai_record(self._api_candidate("src_ai_gemini_aaaaaaaaaaaa"))
        # The counterpart of test_a_human_record_states_all_fourteen_axes. Without it no
        # test stated the IA axis SET at all — only individual axes of it.
        self.assertEqual(sorted(record["groups"]), sorted(V4_GROUP_AXES))
        self.assertEqual(record["schemaVersion"], 4)
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
        self.assertEqual(record["groups"]["generationBatch"]["state"], "unknown")
        self._batched([record])
        self.assertEqual(record["groups"]["generationBatch"]["state"], "known")
        # Generated text has no human author and no origin document. Both are facts
        # about the row, not gaps in what we recorded, so neither costs eligibility.
        self.assertEqual(record["groups"]["author"]["state"], "notApplicable")
        self.assertEqual(record["groups"]["source"]["state"], "notApplicable")
        # The other two batch axes are facts too, and this is the pair the axis split
        # exists for: no acquisition event produced this text (its material dependence
        # travels through humanSeed/derivationRoot to the row that WAS acquired), and no
        # extractor read it out of a source document. Writing a material batch here
        # would claim the text was acquired rather than produced.
        for axis in ("sourceMaterialBatch", "extractionRun"):
            self.assertEqual(record["groups"][axis]["state"], "notApplicable", axis)
            self.assertNotIn("id", record["groups"][axis])


class ClusterDistributionReportTests(unittest.TestCase):
    """Counts, size distribution and the largest cluster, per axis and slice."""

    def _record(
        self, rid: str, label: str, partition: str, version: int = 4, **axes
    ) -> dict:
        import group_axes

        tuple_of_version = (
            group_axes.V4_GROUP_AXES if version == 4 else group_axes.V3_GROUP_AXES
        )
        groups = {
            axis: group_axes.not_applicable("fixture") for axis in tuple_of_version
        }
        for axis, value in axes.items():
            groups[axis] = group_axes.known(value)
        return {
            "schemaVersion": version,
            "id": rid,
            "label": label,
            "partition": partition,
            "groups": groups,
        }

    def test_the_report_carries_the_axes_the_ROWS_declare(self) -> None:
        from group_axes import V3_GROUP_AXES, V4_GROUP_AXES, cluster_report

        v4 = cluster_report([self._record("a", "human", "dev", source="t1")])
        self.assertEqual(sorted(v4["axes"]), sorted(V4_GROUP_AXES))
        # A v3 corpus reports TWELVE, and none of the three v4 axes appears as an axis
        # whose state is `unknown`. Pinning either tuple here instead would publish
        # `clusters: 0, states: {unknown: N}` for every axis the corpus's own version
        # does not have — which reads as a broken axis rather than an absent one, and it
        # would also count every row of the other version as ineligible.
        v3 = cluster_report(
            [self._record("a", "human", "dev", version=3, source="t1")]
        )
        self.assertEqual(sorted(v3["axes"]), sorted(V3_GROUP_AXES))
        self.assertEqual(v3["ineligibleRecords"], 0)
        self.assertEqual(v4["ineligibleRecords"], 0)
        # A MIXED array reports the union, and each row is still judged against its own
        # tuple: neither row is ineligible for an axis its version never had.
        mixed = cluster_report(
            [
                self._record("a", "human", "dev", source="t1"),
                self._record("b", "human", "dev", version=3, source="t1"),
            ]
        )
        self.assertEqual(
            sorted(mixed["axes"]),
            sorted(set(V3_GROUP_AXES) | set(V4_GROUP_AXES)),
        )
        self.assertEqual(mixed["ineligibleRecords"], 0)

    def test_the_projection_the_RUN_builds_reaches_the_v4_branch(self) -> None:
        """The report of a real run, through `assemble_corpus.cluster_report_rows`.

        `axes_of` branches on `schemaVersion`, so a projection that omits the key makes
        every v4 row read against the v3 tuple: the published report then carries the
        twelve v3 axes, `collectionBatch` as `{"unknown": n}` with zero clusters, none
        of the three axes v4 exists to introduce, and `ineligibleRecords == records`.
        Asserting `cluster_report` over a hand-written dict cannot see that, because the
        hand-written dict is exactly where the missing key was supplied.
        """
        from assemble_corpus import PARTITION_OF, cluster_report_rows
        from group_axes import V4_GROUP_AXES, cluster_report

        rows = [
            self._record("h1", "human", "dev", source="t1"),
            self._record("h2", "human", "dev", source="t1"),
        ]
        PARTITION_OF.clear()
        PARTITION_OF.update({"h1": "dev", "h2": "dev"})
        try:
            report = cluster_report(cluster_report_rows(rows))
        finally:
            PARTITION_OF.clear()
        self.assertEqual(sorted(report["axes"]), sorted(V4_GROUP_AXES))
        self.assertNotIn("collectionBatch", report["axes"])
        for axis in ("sourceMaterialBatch", "generationBatch", "extractionRun"):
            self.assertIn(axis, report["axes"])
        self.assertEqual(report["ineligibleRecords"], 0)
        self.assertEqual(report["records"], 2)
        # The slice key comes from the projection too, so a partition dropped there
        # would publish every row under "unassigned".
        self.assertIn("dev/human", report["slices"])

    def test_a_slice_with_no_row_reports_no_axis_rather_than_a_version_s_tuple(
        self,
    ) -> None:
        from group_axes import cluster_report

        # An array with no row declares no schemaVersion, so there is no tuple to
        # report: naming one would pick a version arbitrarily and publish twelve or
        # fourteen axes with `clusters: 0` about a slice that has nothing in it. Pinned
        # because it is the one input where "the axes the ROWS declare" is empty.
        report = cluster_report([])
        self.assertEqual(report["records"], 0)
        self.assertEqual(report["ineligibleRecords"], 0)
        self.assertEqual(report["axes"], {})
        self.assertEqual(report["slices"], {})

    def test_it_reports_count_distribution_and_largest_per_axis(self) -> None:
        from group_axes import cluster_report

        records = [
            self._record("h1", "human", "dev", source="t1", author="a1"),
            self._record("h2", "human", "dev", source="t1", author="a1"),
            self._record("h3", "human", "dev", source="t1", author="a2"),
            self._record("h4", "human", "cal-A", source="t2", author="a3"),
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
            self._record("h1", "human", "dev", source="t1"),
            self._record("h2", "human", "dev", source="t1"),
            self._record("h3", "human", "cal-A", source="t2"),
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
            self._record("h1", "human", "dev", source="t1"),
            self._record("h2", "human", "dev", source="t1"),
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
            self._record("h1", "human", "dev", source="t1"),
            self._record("h2", "human", "dev", source="t1"),
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
            self._record("h1", "human", "dev", source="t1"),
            self._record("h2", "human", "dev", source="t1"),
            self._record("a1", "ai", "dev", source="t1"),
            self._record("h3", "human", "cal-A", source="t2"),
        ]
        report = cluster_report(records)
        # A slice is (partition, label): the aggregate hides that `t1` is one
        # cluster of three ACROSS two classes, which is the shape that leaks.
        slices = report["slices"]
        self.assertEqual(
            slices["dev/human"]["axes"]["source"]["largestCluster"],
            {"id": "t1", "size": 2},
        )
        self.assertEqual(slices["dev/ai"]["axes"]["source"]["clusters"], 1)
        self.assertEqual(
            slices["cal-A/human"]["axes"]["source"]["sizeDistribution"], {"1": 1}
        )
        self.assertEqual(report["axes"]["source"]["largestCluster"]["size"], 3)

    def test_it_does_not_call_an_all_singleton_axis_degenerate(self) -> None:
        from group_axes import cluster_report

        # The plan is explicit: after near-duplicate pruning `nearDuplicate` MUST be
        # all singletons, and AI text has no human author, so a "no axis may be
        # 100% singletons" criterion would reward artificial grouping. The report
        # DESCRIBES; sufficient power per stratum is E3's criterion.
        records = [
            self._record("h1", "human", "dev", nearDuplicate="nd1"),
            self._record("h2", "human", "dev", nearDuplicate="nd2"),
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
            (Path(__file__).resolve().parent.parent / "preregistration-v4.json")
            .read_text(encoding="utf-8")
        )
        frozen = set(policy["generationLanes"])
        # Read against the POLICY rather than a retyped list, so a lane renamed in the
        # frozen file fails here instead of producing rows no corpus can accept.
        self.assertEqual(set(generate_ai.PROVIDER_LANE.values()), frozen)
        # And against the LIVE pre-registration by name. The abandoned rebuild-v3-policy
        # left EVALUATOR_FILES, so a byte changed there no longer moves the
        # evaluatorDigest — an authority outside the evaluator's identity decides without
        # being watched, which is why nothing may read it.
        import assemble_corpus

        self.assertEqual(assemble_corpus.POLICY_PATH.name, "preregistration-v4.json")
        self.assertTrue(assemble_corpus.POLICY_PATH.exists())
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
                "id": "src_carolina_abc",
                "text": "uma frase. outra frase. terceira frase.",
                "family": "carolina_judicial_branch",
                "sourceMaterialBatch": "smb_carolina-v2_0",
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
        # The PARENT's acquisition event travels on the pair row. Without it the pair is
        # unwritable: the axis admits only `known` on a mechanistic mixed row, and the
        # parent id alone resolves no acquisition at assembly time.
        self.assertEqual(row["sourceMaterialBatch"], "smb_carolina-v2_0")
        # And that row is now writable as a sealed record, which the legacy pools are not.
        from assemble_corpus import mixed_record

        record = mixed_record(row)
        self.assertEqual(
            record["groups"]["sourceMaterialBatch"],
            {"state": "known", "id": "smb_carolina-v2_0"},
        )
        self.assertEqual(record["groups"]["generationLane"]["id"], "agy")
        self.assertEqual(record["groups"]["harnessVersion"],
                         {"state": "known", "id": "1_2_3"})
        self.assertEqual(
            record["groups"]["derivationRoot"]["id"], "src_carolina_abc"
        )
        self.assertEqual(
            record["groups"]["domainSource"]["id"], "carolina_judicial_branch"
        )

    def test_the_production_projection_of_a_parent_carries_its_material_batch(
        self,
    ) -> None:
        """The projection BOTH mixing paths build, not a dict written beside it.

        A test that hands `emit` a parent dict with the key already in it proves the
        plumbing inside `emit` and nothing about who fills it. The two production
        callers read two different files — the reserved pool (`id`/`text`) and a pairs
        file (`parentId`/`parentText`) — and a projection that drops the batch makes
        every mixed row unwritable while the assembler merely counts the drop.
        """
        import io

        import make_mixed

        pool_row = {
            "id": "src_ptso_abc",
            "text": "uma frase. outra frase. terceira frase.",
            "family": "ptso_qa",
            "label": 0,
            "sourceMaterialBatch": "smb_ptwiki-20220301",
        }
        pair_row = {
            "parentId": "src_ptso_abc",
            "parentText": "uma frase. outra frase. terceira frase.",
            "family": "ptso_qa",
            "editedText": "uma frase reescrita. outra frase. terceira frase.",
            "sourceMaterialBatch": "smb_ptwiki-20220301",
        }
        projections = [
            make_mixed.parent_projection(pool_row),
            make_mixed.parent_projection(
                pair_row, id_key="parentId", text_key="parentText"
            ),
        ]
        for projected in projections:
            self.assertEqual(
                set(projected), set(make_mixed.PARENT_PROJECTION_KEYS), projected
            )
            self.assertEqual(projected["sourceMaterialBatch"], "smb_ptwiki-20220301")
            buffer = io.StringIO()
            make_mixed.emit(
                buffer,
                projected,
                pair_row["editedText"],
                provider="antigravity",
                model="gemini-3.6-flash-low",
                template_id="mix_edit_v1",
                harness_version="1.2.3",
            )
            record = json.loads(buffer.getvalue())
            self.assertEqual(record["sourceMaterialBatch"], "smb_ptwiki-20220301")

    def test_a_parent_that_names_no_acquisition_projects_none_and_is_not_invented(
        self,
    ) -> None:
        import make_mixed

        # The reserved pool predates the extractors that emit a batch, so `None` is the
        # truthful projection. The row is dropped at assembly, never filed under a
        # batch this projection made up.
        projected = make_mixed.parent_projection(
            {"id": "res_0001", "text": "uma frase. outra.", "label": 0}
        )
        self.assertIsNone(projected["sourceMaterialBatch"])

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
                "id": "src_carolina_abc",
                "text": "uma frase. outra frase. terceira frase.",
                "family": "carolina_judicial_branch",
                "sourceMaterialBatch": "smb_carolina-v2_0",
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
            "src_carolina_aaa", "carolina_member_judicial_2"
        )

    def test_every_record_class_states_automated_unreviewed(self) -> None:
        from assemble_corpus import ai_record, human_record, mixed_record

        rows = [
            human_record(self._human(), "carolina-judicial", None),
            ai_record(
                GenerationBatchAxisTests()._api_candidate("src_ai_gemini_aaaaaaaaaaaa")
            ),
            mixed_record(GenerationBatchAxisTests()._mixed_candidate("src_carolina_aaa")),
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
        record = human_record(candidate, "carolina-judicial", None)
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
        record = human_record(self._human(), "carolina-judicial", None)
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


class StampedCorpusSplittabilityTest(unittest.TestCase):
    """O montador tem de recusar corpus que o splitter OU a auditoria rejeitariam.

    A auditoria reprova por cinco coisas, e a guarda espelha as que um corpus ESTAMPADO ja
    determina: fracoes por classe dentro de `CLASS_TOLERANCE`; `test` estritamente mais novo
    que cada uma das outras QUATRO, inclusive `train`; as tres do meio ordenadas
    earliest-contra-latest entre si; e precedencia da reserva held-out. Checar so uma dessas
    dimensoes erra nas duas direcoes, dependendo de qual falta.

    Um componente que atravessa carimbos NAO e defeito por si: ele cai em `train`, que e o
    fallback do splitter, e o que decide e o tamanho dele e quais bandas ele cruza.
    """

    @staticmethod
    def _rec(rid, *, label, block, **eixos):
        import group_axes
        from assemble_corpus import BLOCK_TIME

        grupos = {
            axis: group_axes.known(valor) for axis, valor in eixos.items() if valor
        }
        # O tempo vem do bloco, como `stamp_block` faz. Sem isso o corpus de teste nao tem
        # bandas temporais e a guarda nao pode decidir a ordem.
        return {
            "id": rid,
            "label": label,
            "groups": grupos,
            "createdAt": BLOCK_TIME[block],
            "_block": block,
        }

    def _corpus(self, por_classe=200):
        """Corpus estampado exatamente nas fracoes alvo, cada linha em seu componente."""
        from assemble_corpus import CLASS_FRACTIONS

        blocos = []
        for bloco, fr in CLASS_FRACTIONS.items():
            blocos.extend([bloco] * round(por_classe * fr))
        blocos.extend(["test"] * (por_classe - len(blocos)))
        recs = []
        for label in ("human", "ai"):
            for i, bloco in enumerate(blocos):
                recs.append(
                    self._rec(
                        f"{label}_{i}",
                        label=label,
                        block=bloco,
                        author=f"a_{label}_{i}",
                    )
                )
        return recs

    def _guardar(self, recs):
        from assemble_corpus import PARTITION_OF

        self._anterior = dict(PARTITION_OF)
        for r in recs:
            PARTITION_OF[r["id"]] = r["_block"]

    def tearDown(self):
        from assemble_corpus import PARTITION_OF

        if hasattr(self, "_anterior"):
            PARTITION_OF.clear()
            PARTITION_OF.update(self._anterior)

    @staticmethod
    def _unir(a, b, token="componente_unido"):
        """Poe duas linhas no mesmo componente, por valor compartilhado em `author`."""
        import group_axes

        a["groups"]["author"] = group_axes.known(token)
        b["groups"]["author"] = group_axes.known(token)

    def _de(self, recs, block, label="human"):
        return next(r for r in recs if r["_block"] == block and r["label"] == label)

    def test_the_target_fractions_are_accepted(self):
        from assemble_corpus import assert_stamped_corpus_is_splittable

        recs = self._corpus()
        self._guardar(recs)
        assert_stamped_corpus_is_splittable(recs)

    def test_a_small_train_dev_straddle_is_ACCEPTED(self):
        """Atravessar carimbos nao implica corpus inviavel.

        A linha de `dev` cai em `train` junto com a outra: `dev` perde uma em 200, meio ponto,
        dentro dos dois de tolerancia. E o tempo dela, sendo de banda anterior a `test`, nao
        quebra nenhuma das relacoes temporais.
        """
        from assemble_corpus import assert_stamped_corpus_is_splittable

        recs = self._corpus()
        self._unir(self._de(recs, "train"), self._de(recs, "dev"))
        self._guardar(recs)
        assert_stamped_corpus_is_splittable(recs)

    def test_a_train_test_straddle_LEGAL_IN_FRACTIONS_is_refused(self):
        """O caso que uma guarda so de fracoes aceita, e a auditoria reprova.

        A linha de `test` cai em `train` levando o TEMPO da banda de teste consigo. As fracoes
        continuam legais — `test` perde uma em 200 — mas `earliest(test)` deixa de ser
        estritamente maior que `latest(train)`, que e texto do periodo de teste dentro do
        treino: vazamento real.
        """
        from assemble_corpus import (
            UnsplittableCorpus,
            assert_stamped_corpus_is_splittable,
        )

        recs = self._corpus()
        self._unir(self._de(recs, "train"), self._de(recs, "test"))
        self._guardar(recs)
        with self.assertRaises(UnsplittableCorpus) as ctx:
            assert_stamped_corpus_is_splittable(recs)
        self.assertIn("temporal", str(ctx.exception))
        self.assertIn("latest(train)", str(ctx.exception))

    def test_a_held_out_component_reaching_an_earlier_block_is_refused(self):
        """A reserva tem PRECEDENCIA: o splitter a senta em `test` seja qual for o tempo.

        Uma linha reservada que realiza fora de `test` e falha de restricao, nao de fracao, e
        uma guarda que ignora a reserva a aceita.
        """
        import group_axes
        from assemble_corpus import (
            UnsplittableCorpus,
            assert_stamped_corpus_is_splittable,
        )

        recs = self._corpus()
        reservada = self._de(recs, "train")
        reservada["groups"]["generatorFamily"] = group_axes.known("family_reservada")
        self._guardar(recs)
        with self.assertRaises(UnsplittableCorpus) as ctx:
            assert_stamped_corpus_is_splittable(recs, {"family_reservada"})
        self.assertIn("reserva", str(ctx.exception))

    def test_a_straddle_large_enough_to_break_a_class_is_refused(self):
        import group_axes
        from assemble_corpus import (
            UnsplittableCorpus,
            assert_stamped_corpus_is_splittable,
        )

        recs = self._corpus()
        token = "componente_grande"
        group_axes_known = group_axes.known
        self._de(recs, "train")["groups"]["author"] = group_axes_known(token)
        for r in recs:
            if r["_block"] == "dev" and r["label"] == "human":
                r["groups"]["author"] = group_axes_known(token)
        self._guardar(recs)
        with self.assertRaises(UnsplittableCorpus) as ctx:
            assert_stamped_corpus_is_splittable(recs)
        self.assertIn("human/dev", str(ctx.exception))

    def test_a_non_connective_axis_shared_across_blocks_is_ACCEPTED(self):
        """`generatorFamily` nao conecta: unir por ela colapsaria uma familia inteira."""
        import group_axes
        from assemble_corpus import assert_stamped_corpus_is_splittable

        recs = self._corpus()
        for r in recs:
            r["groups"]["generatorFamily"] = group_axes.known("acme_family")
        self._guardar(recs)
        assert_stamped_corpus_is_splittable(recs)

    def test_a_parent_reference_unions_and_can_break_a_class(self):
        """`humanSeed` une por REFERENCIA, e a uniao conta para as fracoes realizadas."""
        import group_axes
        from assemble_corpus import (
            UnsplittableCorpus,
            assert_stamped_corpus_is_splittable,
        )

        recs = self._corpus()
        pai = self._de(recs, "train")
        for r in recs:
            if r["_block"] == "dev" and r["label"] == "human":
                r["groups"]["humanSeed"] = group_axes.known(pai["id"])
        self._guardar(recs)
        with self.assertRaises(UnsplittableCorpus):
            assert_stamped_corpus_is_splittable(recs)

    def test_a_parent_reference_to_an_absent_row_unions_nothing(self):
        import group_axes
        from assemble_corpus import assert_stamped_corpus_is_splittable

        recs = self._corpus()
        for r in recs:
            if r["_block"] == "dev":
                r["groups"]["humanSeed"] = group_axes.known("fora_do_corpus")
        self._guardar(recs)
        assert_stamped_corpus_is_splittable(recs)

    def test_a_transitive_chain_is_one_component(self):
        """A liga B por valor compartilhado, B liga C por referencia: os tres sao um so.

        O valor compartilhado e `generationBatch` — o lote de GERACAO, que une por valor —,
        e por isso as tres linhas sao `ai`: a tabela de estados admite `generationBatch`
        conhecido so onde uma receita nossa rodou, e numa linha humana ele e
        `notApplicable`.
        """
        from assemble_corpus import connected_components

        recs = [
            self._rec("a", label="ai", block="train", generationBatch="gb_lote_1"),
            self._rec("b", label="ai", block="train", generationBatch="gb_lote_1"),
            self._rec("c", label="ai", block="test", derivationRoot="b"),
        ]
        self._guardar(recs)
        roots = connected_components(recs)
        self.assertEqual(roots["a"], roots["c"])

    def _corpus_de_uma_fonte(self, source_id="src_carolina"):
        """O corpus das fracoes alvo, todo ele atribuido a UMA fonte declarada.

        `source` fica `known` em toda linha porque src_carolina o declara: e o eixo que a
        mutacao de cada teste abaixo derruba, e comecar com ele preenchido e o que
        separa "a guarda pegou a mutacao" de "a guarda recusa o fixture inteiro".
        """
        import group_axes

        recs = self._corpus()
        for r in recs:
            r["provenance"] = {"sourceId": source_id}
            r["groups"]["source"] = group_axes.known(f"g_{r['id']}")
        return recs

    def test_a_declared_axis_left_unknown_is_refused(self):
        """A quinta reprovacao da auditoria, que a guarda omitia.

        A fonte DECLARA que o eixo se aplica; a linha o deixa `unknown`. As fracoes ficam
        perfeitas, entao a unica coisa que pega este caso e consultar o inventario de fontes.

        O EIXO e a CONTAGEM sao afirmados, nao so o prefixo da mensagem: a fonte declara
        mais de um eixo, e uma reprovacao vinda de qualquer um dos outros satisfaz
        `assertIn("eixo declarado")` sem que a mutacao deliberada tenha participado. Um
        eixo a mais no inventario basta para mascarar a injecao, e ai a guarda fica verde
        por construcao do fixture em vez de por medicao.
        """
        import group_axes
        from assemble_corpus import (
            UnsplittableCorpus,
            assert_stamped_corpus_is_splittable,
        )

        recs = self._corpus_de_uma_fonte()
        alvo = self._de(recs, "train")
        alvo["groups"]["source"] = group_axes.unknown("nao recuperado")
        self._guardar(recs)
        with self.assertRaises(UnsplittableCorpus) as ctx:
            assert_stamped_corpus_is_splittable(recs)
        msg = str(ctx.exception)
        self.assertIn("eixo declarado", msg)
        self.assertIn("src_carolina", msg)
        self.assertIn('"source" aplicavel', msg)
        self.assertIn(alvo["id"], msg)
        # UMA linha, e nao 400: a recusa e da mutacao e de nada mais.
        self.assertEqual(msg.count("eixo declarado"), 1)
        self.assertNotIn("sourceMaterialBatch", msg)

    def test_the_declared_axis_join_ignores_an_axis_the_version_lacks(self):
        """O corpo SAO da fonte declarada passa, e e isso que torna o teste acima uma guarda.

        Toda fonte humana declara `sourceMaterialBatch`, que e eixo de v4 apenas; estas
        linhas sao v3 e nao tem a chave. Ler o estado de ELEGIBILIDADE aqui (chave ausente
        => unknown) recusaria o corpo inteiro, enquanto `auditDeclaredAxes` em
        benchmark/split-audit.ts o aceita — uma guarda que se declara espelho e recusa o que
        o espelhado aceita.

        AS DUAS fontes estocadas, porque a autoridade e por fonte: uma so delas nao mede a
        tabela inteira. `src_b2w` saiu do inventario com a moldura nova — resenha de produto
        nao e celula da alegacao —, entao pedir o eixo dele aqui levantaria KeyError em vez
        de medir o que este teste mede.
        """
        from assemble_corpus import assert_stamped_corpus_is_splittable, declared_group_axes

        autoridade = declared_group_axes()
        self.assertEqual(sorted(autoridade), ["src_carolina", "src_wikipedia_pt"])
        for source_id in ("src_wikipedia_pt", "src_carolina"):
            with self.subTest(fonte=source_id):
                # Nao vacuo: o eixo esta na autoridade, e nenhuma linha carrega a chave.
                self.assertIn("sourceMaterialBatch", autoridade[source_id])
                recs = self._corpus_de_uma_fonte(source_id)
                self.assertTrue(
                    all("sourceMaterialBatch" not in r["groups"] for r in recs)
                )
                self._guardar(recs)
                assert_stamped_corpus_is_splittable(recs)

    def test_a_human_row_from_a_source_outside_the_authority_is_REFUSED(self):
        """Fonte fora do inventario: recusada, nao saltada.

        `autoridade.get(source_id, ())` devolvia tupla vazia, entao a linha atravessava sem
        UM eixo conferido — e retirar uma fonte do inventario DESLIGAVA a checagem para as
        linhas dela em vez de recusa-las. O lado espelhado (corpus-source-audit.ts) recusa
        por nome, logo o espelho aceitava mais que o espelhado.

        A linha carrega um eixo declarado em `unknown` de proposito: sob o comportamento
        antigo isso passava em silencio, que e exatamente o que se quer ver falhar.
        """
        import group_axes
        from assemble_corpus import (
            UnsplittableCorpus,
            assert_stamped_corpus_is_splittable,
        )

        recs = self._corpus_de_uma_fonte()
        alvo = self._de(recs, "train")
        alvo["provenance"] = {"sourceId": "src_b2w"}
        alvo["groups"]["source"] = group_axes.unknown("nao recuperado")
        self._guardar(recs)
        with self.assertRaises(UnsplittableCorpus) as ctx:
            assert_stamped_corpus_is_splittable(recs)
        msg = str(ctx.exception)
        self.assertIn("fonte nao inventariada", msg)
        self.assertIn("src_b2w", msg)
        self.assertIn(alvo["id"], msg)
        # UMA linha: as outras 199 seguem em src_carolina e nao podem ser arrastadas.
        self.assertEqual(msg.count("fonte nao inventariada"), 1)

    def test_a_GENERATED_row_outside_the_human_authority_is_accepted(self):
        """O contra-caso que impede a guarda acima de recusar todo corpus.

        Fonte gerada nao tem registro humano e nao declara eixo nenhum por desenho, entao
        `src_gen_*` fora da autoridade e o estado normal e nao um defeito.
        """
        from assemble_corpus import assert_stamped_corpus_is_splittable

        recs = self._corpus_de_uma_fonte()
        for r in recs:
            if r["label"] != "human":
                r["provenance"] = {"sourceId": "src_gen_lane_agy"}
        self._guardar(recs)
        assert_stamped_corpus_is_splittable(recs)

    def test_a_v4_row_that_WRITES_the_batch_unknown_is_still_refused(self):
        """A outra direcao: consciencia de versao nao pode virar afrouxamento.

        A linha e v4, entao a versao dela TEM o eixo, e ela escreve `unknown` nele. A
        recusa tem de sobreviver a troca de leitura — senao o conserto do espelho apagou a
        quinta reprovacao em vez de corrigi-la.
        """
        import group_axes
        from assemble_corpus import (
            UnsplittableCorpus,
            assert_stamped_corpus_is_splittable,
        )

        recs = self._corpus_de_uma_fonte()
        alvo = self._de(recs, "train")
        alvo["schemaVersion"] = 4
        alvo["groups"]["sourceMaterialBatch"] = group_axes.unknown(
            "lote de aquisicao nao recuperado"
        )
        self._guardar(recs)
        with self.assertRaises(UnsplittableCorpus) as ctx:
            assert_stamped_corpus_is_splittable(recs)
        msg = str(ctx.exception)
        self.assertIn('"sourceMaterialBatch" aplicavel', msg)
        self.assertIn(alvo["id"], msg)
        self.assertEqual(msg.count("eixo declarado"), 1)

    def test_the_declared_axes_authority_equals_the_inventory_exactly(self):
        """Igualdade EXATA, e a ausencia das bloqueadas faz parte da igualdade.

        Checar apenas que uma fonte esta presente deixa passar o defeito real: a primeira
        versao varria o arquivo inteiro e colhia `A1_BLOCKED_HUMAN_SOURCES`, trazendo
        `src_ptso`, que esta BLOQUEADO. Uma autoridade com fonte a mais aceita linha que a
        auditoria recusa.
        """
        import re as _re

        from assemble_corpus import declared_group_axes

        fonte = (Path(__file__).resolve().parent.parent / "source-manifest.ts").read_text(
            encoding="utf-8"
        )
        corpo = fonte.split("export const V3_HUMAN_SOURCE_INVENTORY", 1)[1]
        corpo = corpo[: corpo.find(chr(10) + "];")]
        esperado = {
            source_id: tuple(_re.findall(r'"([a-zA-Z]+)"', eixos))
            for source_id, _meio, eixos in _re.findall(
                r'sourceId:\s*"([^"]+)"(.*?)declaredGroupAxes:\s*\[([^\]]*)\]',
                corpo,
                _re.S,
            )
        }
        self.assertEqual(declared_group_axes(), esperado)
        self.assertNotIn("src_ptso", declared_group_axes())

    def test_the_authority_fails_closed_on_partial_parse(self):
        """Uma entrada malformada nao pode devolver mapa MENOR em silencio.

        A regex salta sobre a entrada quebrada, entao "pelo menos uma reconhecida" aceita um
        mapa incompleto — e mapa com fonte a menos deixa de recusar linha que a auditoria
        recusa. O que transforma isso em falha e contar os `sourceId` do corpo.
        """
        from assemble_corpus import declared_group_axes

        corpo = (
            "export const V3_HUMAN_SOURCE_INVENTORY = [\n"
            '  { sourceId: "src_ok", declaredGroupAxes: ["source"] },\n'
            '  { sourceId: "src_quebrado", declaredGroupAxesERRADO: ["source"] },\n'
            "];\n"
        )
        with self.assertRaises(RuntimeError) as ctx:
            declared_group_axes(corpo)
        self.assertIn("parse parcial", str(ctx.exception))
        self.assertIn("src_quebrado", str(ctx.exception))

    def test_the_authority_fails_closed_on_a_duplicate_source(self):
        from assemble_corpus import declared_group_axes

        corpo = (
            "export const V3_HUMAN_SOURCE_INVENTORY = [\n"
            '  { sourceId: "src_dup", declaredGroupAxes: ["source"] },\n'
            '  { sourceId: "src_dup", declaredGroupAxes: ["author"] },\n'
            "];\n"
        )
        with self.assertRaises(RuntimeError) as ctx:
            declared_group_axes(corpo)
        self.assertIn("duas vezes", str(ctx.exception))

    def test_the_authority_fails_closed_without_a_terminator(self):
        """Sem `];` o corpo nao tem fim reconhecivel, e adivinhar seria pior que falhar."""
        from assemble_corpus import declared_group_axes

        corpo = (
            "export const V3_HUMAN_SOURCE_INVENTORY = [\n"
            '  { sourceId: "src_ok", declaredGroupAxes: ["source"] },\n'
        )
        with self.assertRaises(RuntimeError) as ctx:
            declared_group_axes(corpo)
        self.assertIn("parse incompleto", str(ctx.exception))

    def test_the_authority_fails_closed_when_the_inventory_is_absent(self):
        from assemble_corpus import declared_group_axes

        with self.assertRaises(RuntimeError) as ctx:
            declared_group_axes("export const OUTRA_COISA = [];")
        self.assertIn("nao expoe", str(ctx.exception))

    def test_the_tolerance_boundary_is_INCLUSIVE_in_python(self):
        """3% e 7% num `dev` de alvo 5% sao LEGAIS pelo contrato.

        Float binario nao representa a borda: `abs(0.03 - 0.05)` da 0.020000000000000004,
        maior que 0.02. Comparar float cru recusa exactamente os dois valores que o contrato
        admite.
        """
        from assemble_corpus import within_class_tolerance

        self.assertTrue(within_class_tolerance(0.03, 0.05))
        self.assertTrue(within_class_tolerance(0.07, 0.05))
        self.assertFalse(within_class_tolerance(0.0299, 0.05))
        self.assertFalse(within_class_tolerance(0.0701, 0.05))

    def test_the_epsilon_mirrors_split_ts(self):
        from assemble_corpus import CLASS_TOLERANCE_EPSILON

        fonte = (Path(__file__).resolve().parent.parent / "split.ts").read_text(
            encoding="utf-8"
        )
        declarado = fonte.split("export const CLASS_TOLERANCE_EPSILON = ", 1)[1].split(
            ";", 1
        )[0]
        self.assertEqual(CLASS_TOLERANCE_EPSILON, float(declarado))

    def test_the_two_relations_and_the_tolerance_mirror_split_ts(self):
        """As listas e a tolerancia sao copia; sem estes pinos elas envelhecem em silencio."""
        import re as _re

        from assemble_corpus import (
            CLASS_TOLERANCE,
            SPLIT_GROUP_KEYS,
            SPLIT_PARENT_LINKAGE_AXES,
        )

        fonte = (Path(__file__).resolve().parent.parent / "split.ts").read_text(
            encoding="utf-8"
        )
        chaves = fonte.split("export const GROUP_KEYS = [", 1)[1].split("]", 1)[0]
        self.assertEqual(list(SPLIT_GROUP_KEYS), _re.findall(r'"([a-zA-Z]+)"', chaves))
        linkage = fonte.split("export const PARENT_LINKAGE_AXES = [", 1)[1].split("]", 1)[0]
        self.assertEqual(
            list(SPLIT_PARENT_LINKAGE_AXES),
            _re.findall(r'"([a-zA-Z]+)"', linkage),
        )
        declarado = fonte.split("export const CLASS_TOLERANCE = ", 1)[1].split(";", 1)[0]
        self.assertEqual(CLASS_TOLERANCE, float(declarado))


class SlateRoleTests(unittest.TestCase):
    """The slate decides each generated family by NAME, and refuses what it cannot decide.

    The role is what says whether the training set may contain a family. A prefix or a
    lane cannot carry it: the two OpenAI families of the reserve arrive on different lanes
    (`codex` and `agy`), so the provider boundary crosses the lane boundary, and a
    provider rename slides past a prefix in silence.
    """

    def test_the_roles_partition_the_families_the_slate_knows(self) -> None:
        import assemble_corpus

        assemble_corpus.assert_slate_roles_are_consistent()
        lists = (
            set(assemble_corpus.OOD_RESERVED_FAMILIES),
            set(assemble_corpus.CORE_GENERATOR_FAMILIES),
            set(assemble_corpus.EXCLUDED_GENERATOR_FAMILIES),
        )
        for left in range(len(lists)):
            for right in range(left + 1, len(lists)):
                self.assertEqual(lists[left] & lists[right], set())
        # Every declared name is a canonical family token, so exact equality against
        # `groups.generatorFamily` can match at all.
        for family in set().union(*lists):
            self.assertEqual(assemble_corpus.generator_family(family), family)

    def test_every_family_the_pools_deliver_has_exactly_one_role(self) -> None:
        import assemble_corpus

        # The coverage the comment on CORE_GENERATOR_FAMILIES used to CLAIM. Measured over
        # `load_ai` + `load_mixed` on 2026-08-05 and carried as POOL_GENERATOR_FAMILIES,
        # because the pool files are not in Git and a test cannot read them.
        roles = assemble_corpus.slate_roles()
        self.assertEqual(set(roles), set(assemble_corpus.POOL_GENERATOR_FAMILIES))
        self.assertEqual(
            sorted(
                family
                for family, role in roles.items()
                if role == assemble_corpus.EXCLUDED_ROLE
            ),
            sorted(assemble_corpus.EXCLUDED_GENERATOR_FAMILIES),
        )
        # And the nine excluded ones are the pool's own, not a list invented here.
        self.assertEqual(
            sum(
                assemble_corpus.POOL_GENERATOR_FAMILIES[family]
                for family in assemble_corpus.EXCLUDED_GENERATOR_FAMILIES
            ),
            1185,
        )

    def test_a_pool_family_with_no_role_refuses_before_the_pools_are_read(self) -> None:
        import assemble_corpus

        # The family this unit exists to decide: `madras_synthetic_corpus_gptoss5` names
        # gpt-oss, the reserved provider. Classified by DEFAULT it would be trainable.
        family = "madras_synthetic_corpus_gptoss5"
        saved = dict(assemble_corpus.EXCLUDED_GENERATOR_FAMILIES)
        try:
            del assemble_corpus.EXCLUDED_GENERATOR_FAMILIES[family]
            with self.assertRaises(assemble_corpus.SlateContradiction) as caught:
                assemble_corpus.assert_slate_roles_are_consistent()
        finally:
            assemble_corpus.EXCLUDED_GENERATOR_FAMILIES.clear()
            assemble_corpus.EXCLUDED_GENERATOR_FAMILIES.update(saved)
        message = str(caught.exception)
        self.assertIn(family, message)
        self.assertIn("POOL_GENERATOR_FAMILIES", message)
        self.assertIn(assemble_corpus.EXCLUDED_ROLE, message)

    def test_a_role_over_a_family_the_pools_never_deliver_is_refused(self) -> None:
        import assemble_corpus

        # The other direction, and the one that produced the false comment: a list written
        # from the generation slate reads as a list written from the pools.
        saved = dict(assemble_corpus.OOD_RESERVED_FAMILIES)
        try:
            assemble_corpus.OOD_RESERVED_FAMILIES["gpt-9_9-inexistente"] = "lane futura"
            with self.assertRaises(assemble_corpus.SlateContradiction) as caught:
                assemble_corpus.assert_slate_roles_are_consistent()
        finally:
            assemble_corpus.OOD_RESERVED_FAMILIES.clear()
            assemble_corpus.OOD_RESERVED_FAMILIES.update(saved)
        message = str(caught.exception)
        self.assertIn("gpt-9_9-inexistente", message)
        self.assertIn("re-measure POOL_GENERATOR_FAMILIES", message)

    def test_an_excluded_family_leaves_the_corpus_counted_by_family(self) -> None:
        import assemble_corpus

        excluded = sorted(assemble_corpus.EXCLUDED_GENERATOR_FAMILIES)[0]
        records = [
            self._generated("gpt-5_6-luna"),
            self._generated(excluded),
            self._generated(excluded, label="mixed"),
            {"id": "h1", "label": "human", "groups": {}},
        ]
        roles = assemble_corpus.generator_family_roles(records)
        self.assertEqual(roles[excluded], assemble_corpus.EXCLUDED_ROLE)
        kept, dropped = assemble_corpus.drop_excluded_families(records, roles)
        self.assertEqual(dropped, {excluded: 2})
        # The human row stays: the exclusion is a family verdict over generated rows.
        self.assertEqual([r["id"] for r in kept], ["rec_gpt-5_6-luna_ai", "h1"])

    def test_a_family_in_both_roles_refuses_before_the_pools_are_read(self) -> None:
        import assemble_corpus

        family = sorted(assemble_corpus.CORE_GENERATOR_FAMILIES)[0]
        saved = dict(assemble_corpus.OOD_RESERVED_FAMILIES)
        try:
            assemble_corpus.OOD_RESERVED_FAMILIES[family] = "conflito de fixture"
            with self.assertRaises(assemble_corpus.SlateContradiction) as caught:
                assemble_corpus.assert_slate_roles_are_consistent()
        finally:
            assemble_corpus.OOD_RESERVED_FAMILIES.clear()
            assemble_corpus.OOD_RESERVED_FAMILIES.update(saved)
        message = str(caught.exception)
        self.assertIn(family, message)
        self.assertIn(assemble_corpus.OOD_RESERVED_ROLE, message)
        self.assertIn(assemble_corpus.CORE_ROLE, message)

    def test_reserving_a_family_whose_claim_was_withdrawn_is_refused(self) -> None:
        import assemble_corpus

        # A name of neither list, so this is the WITHDRAWAL that refuses and not the
        # both-roles clash: the two real withdrawn families are core today, and a core
        # family reserved would be caught one check earlier.
        family = "gemini-9_9-retirada"
        self.assertNotIn(family, assemble_corpus.CORE_GENERATOR_FAMILIES)
        saved = dict(assemble_corpus.OOD_RESERVED_FAMILIES)
        try:
            assemble_corpus.OOD_RESERVED_FAMILIES[family] = "reserva de fixture"
            assemble_corpus.HELD_OUT_INELIGIBLE.add(family)
            with self.assertRaises(assemble_corpus.SlateContradiction) as caught:
                assemble_corpus.assert_slate_roles_are_consistent()
        finally:
            assemble_corpus.HELD_OUT_INELIGIBLE.discard(family)
            assemble_corpus.OOD_RESERVED_FAMILIES.clear()
            assemble_corpus.OOD_RESERVED_FAMILIES.update(saved)
        self.assertIn(family, str(caught.exception))
        self.assertIn("HELD_OUT_INELIGIBLE", str(caught.exception))

    def test_every_withdrawn_family_the_slate_names_is_core_and_not_reserved(self) -> None:
        import assemble_corpus

        # The withdrawal is a claim that was taken back, and the two families it names stay
        # in the corpus as ordinary trainable ones — never absent (a deleted name comes
        # back) and never reserved (that is the claim itself).
        self.assertTrue(
            assemble_corpus.HELD_OUT_INELIGIBLE
            <= assemble_corpus.CORE_GENERATOR_FAMILIES
        )

    def test_a_dotted_spelling_in_the_slate_is_refused_as_unmatchable(self) -> None:
        import assemble_corpus

        saved = dict(assemble_corpus.OOD_RESERVED_FAMILIES)
        try:
            assemble_corpus.OOD_RESERVED_FAMILIES["gpt-5.7-luna"] = "grafia do provedor"
            with self.assertRaises(assemble_corpus.SlateContradiction) as caught:
                assemble_corpus.assert_slate_roles_are_consistent()
        finally:
            assemble_corpus.OOD_RESERVED_FAMILIES.clear()
            assemble_corpus.OOD_RESERVED_FAMILIES.update(saved)
        self.assertIn("gpt-5.7-luna", str(caught.exception))
        self.assertIn("gpt-5_7-luna", str(caught.exception))

    def _generated(self, family: str, label: str = "ai") -> dict:
        from group_axes import known

        return {
            "id": f"rec_{family}_{label}",
            "label": label,
            "groups": {"generatorFamily": known(family)},
        }

    def test_every_generated_family_of_the_corpus_gets_its_declared_role(self) -> None:
        import assemble_corpus

        records = [
            self._generated("gpt-5_6-luna"),
            self._generated("gemini-3_5-flash-lite"),
            self._generated("gemini-3_1-flash-lite", label="mixed"),
            {"id": "h1", "label": "human", "groups": {}},
        ]
        self.assertEqual(
            assemble_corpus.generator_family_roles(records),
            {
                "gpt-5_6-luna": assemble_corpus.OOD_RESERVED_ROLE,
                "gemini-3_5-flash-lite": assemble_corpus.CORE_ROLE,
                "gemini-3_1-flash-lite": assemble_corpus.CORE_ROLE,
            },
        )

    def test_a_family_the_slate_does_not_name_stops_the_run(self) -> None:
        import assemble_corpus

        # The failure the reserve exists to prevent: the provider renames the reserved
        # family, so a prefix rule reads it as core and the training set gets it.
        renamed = "gpt-5_7-luna"
        self.assertNotIn(renamed, assemble_corpus.OOD_RESERVED_FAMILIES)
        self.assertNotIn(renamed, assemble_corpus.CORE_GENERATOR_FAMILIES)
        self.assertTrue(renamed.startswith("gpt-"))
        with self.assertRaises(assemble_corpus.UndeclaredGeneratorFamily) as caught:
            assemble_corpus.generator_family_roles([self._generated(renamed)])
        message = str(caught.exception)
        self.assertIn(renamed, message)
        self.assertIn(assemble_corpus.OOD_RESERVED_ROLE, message)
        self.assertIn(assemble_corpus.CORE_ROLE, message)

    def test_the_role_reads_the_canonical_axis_and_not_the_provider_label(self) -> None:
        import assemble_corpus
        from group_axes import known

        # `generation.family` carries the dotted provider label and never equals a slate
        # entry; the role has to come off `groups.generatorFamily`.
        record = {
            "id": "rec_dotted",
            "label": "ai",
            "generation": {"family": "gpt-5.6-luna"},
            "groups": {"generatorFamily": known("gpt-5_6-luna")},
        }
        self.assertEqual(
            assemble_corpus.generator_family_roles([record]),
            {"gpt-5_6-luna": assemble_corpus.OOD_RESERVED_ROLE},
        )


class BlindBlockCompositionTests(unittest.TestCase):
    """The reserve is seated in `test` and never fills it.

    The blind block carries two hypotheses at once — recall over positives the training
    set contains, and the unseen-generator slice over the reserve — so a reserve equal to
    the block leaves the first with no population.
    """

    def _per_family(self, spec: dict[str, dict[str, int]]) -> dict:
        from collections import Counter

        return {family: Counter(rows) for family, rows in spec.items()}

    def test_reserved_rows_are_counted_per_class(self) -> None:
        import assemble_corpus

        per_family = self._per_family(
            {
                "gpt-5_6-luna": {"ai": 240, "mixed": 30},
                "gpt-oss-120b-medium": {"mixed": 60},
                "gemini-3_5-flash-lite": {"ai": 900},
            }
        )
        self.assertEqual(
            assemble_corpus.reserved_rows_per_class(
                per_family, {"gpt-5_6-luna", "gpt-oss-120b-medium"}
            ),
            {"ai": 240, "mixed": 90},
        )

    def test_a_reserve_that_fits_with_room_beside_it_is_accepted(self) -> None:
        import assemble_corpus

        assemble_corpus.assert_the_blind_block_holds_both_roles(
            {"ai": 400, "mixed": 90}, {"ai": 800, "mixed": 400, "human": 1400}
        )
        # The boundary is STRICT: exactly filling the block is refused, because the recall
        # hypothesis then has no core positive in `test`.
        assemble_corpus.assert_the_blind_block_holds_both_roles({"ai": 799}, {"ai": 800})
        with self.assertRaises(assemble_corpus.ReserveFillsTheBlindBlock):
            assemble_corpus.assert_the_blind_block_holds_both_roles(
                {"ai": 800}, {"ai": 800}
            )

    def test_a_reserve_larger_than_the_block_names_the_class_and_both_numbers(
        self,
    ) -> None:
        import assemble_corpus

        # Measured on the pools: the codex lane holds 1.402 fresh `gpt-5.6-luna` lines
        # while the ratified ai quota of 4.000 leaves a test block of 800.
        with self.assertRaises(assemble_corpus.ReserveFillsTheBlindBlock) as caught:
            assemble_corpus.assert_the_blind_block_holds_both_roles(
                {"ai": 1402}, {"ai": 800}
            )
        message = str(caught.exception)
        self.assertIn("'ai'", message)
        self.assertIn("1402", message)
        self.assertIn("800", message)

    def test_the_mixed_class_is_checked_too_because_a_mixer_is_a_generator(self) -> None:
        import assemble_corpus

        with self.assertRaises(assemble_corpus.ReserveFillsTheBlindBlock) as caught:
            assemble_corpus.assert_the_blind_block_holds_both_roles(
                {"ai": 10, "mixed": 714}, {"ai": 800, "mixed": 400}
            )
        self.assertIn("'mixed'", str(caught.exception))
        self.assertIn("714", str(caught.exception))

    def _generated_line(self, rec_id: str, family: str) -> dict:
        from group_axes import (
            NO_DERIVATION,
            NO_HUMAN_AUTHOR,
            NO_MATERIAL_ACQUIRED,
            NOT_EXTRACTED,
            axis_token,
            known,
            not_applicable,
        )

        # One component per line: every union axis of SPLIT_GROUP_KEYS is per-record, so
        # the geometry preflight `assign_partitions` runs first has nothing to refuse and
        # the block arithmetic is what is under test.
        return {
            "id": rec_id,
            "schemaVersion": 4,
            "label": "ai",
            "groups": {
                "author": not_applicable(NO_HUMAN_AUTHOR),
                "source": not_applicable("texto gerado"),
                "domainSource": known(axis_token("ai_codex")),
                "humanSeed": known(f"seed_{rec_id}"),
                "promptTemplate": known(f"pt_{rec_id}"),
                "generatorFamily": known(family),
                "generatorVersion": known(f"gv_{rec_id}"),
                "sourceMaterialBatch": not_applicable(NO_MATERIAL_ACQUIRED),
                "generationBatch": known(f"gb_{rec_id}"),
                "extractionRun": not_applicable(NOT_EXTRACTED),
                "nearDuplicate": known(f"nd_{rec_id}"),
                "derivationRoot": not_applicable(NO_DERIVATION),
            },
        }

    def test_a_reserve_that_overflows_the_block_refuses_at_stamping_too(self) -> None:
        import assemble_corpus

        # The second half of the same rule, at the place where the two numbers are real
        # instead of predicted. `main` cannot reach it — `assert_the_blind_block_holds_both
        # _roles` runs the same arithmetic with a strict comparison first — but
        # `assign_partitions` is callable on its own, and it used to PRINT and carry on,
        # stamping every reserved row into a block that cannot hold them and leaving the
        # splitter to refuse a corpus one step later.
        reserved = "gpt-5_6-luna"
        records = [
            self._generated_line(f"rec_core_{index:02d}", "gemini-3_5-flash-lite")
            for index in range(15)
        ] + [
            self._generated_line(f"rec_res_{index:02d}", reserved) for index in range(5)
        ]
        # 20 ai lines: 9/1/2/4 rounded, so `test` is the remainder of 4 and the 5 reserved
        # rows do not fit.
        with self.assertRaises(assemble_corpus.ReserveFillsTheBlindBlock) as caught:
            assemble_corpus.assign_partitions(records, {reserved})
        message = str(caught.exception)
        self.assertIn("5 reserved rows", message)
        self.assertIn("holds 4", message)
        self.assertNotIn("rec_res_00", assemble_corpus.PARTITION_OF)

    def test_a_thin_reserve_is_named_with_the_floor_validate_enforces(self) -> None:
        import assemble_corpus

        floor = assemble_corpus.HELD_OUT_MINIMUM
        thin = assemble_corpus.reserved_families_below_the_recall_floor(
            {"gpt-5_6-luna": floor - 1, "gpt-oss-120b-medium": floor},
            {"gpt-5_6-luna", "gpt-oss-120b-medium"},
        )
        self.assertEqual(thin, {"gpt-5_6-luna": floor - 1})

    def test_the_floor_counts_lines_and_not_the_sealed_eligible_population(self) -> None:
        import assemble_corpus
        from group_axes import known, unknown

        # WHICH population, pinned: the lab counts every ai/mixed LINE of the family.
        # `sealDataset` counts `positiveRows.filter(countsTowardHeldOutFloor)`, which on a
        # v4 corpus is the ELIGIBLE rows, so the sealed floor is the stricter of the two
        # and the lab's count is an upper bound. The row below is one the sealed side would
        # NOT count — `harnessVersion` left `unknown`, which is the state every CLI-lane row
        # of today's pools is in — and it counts here.
        records = [
            {
                "id": "rec_inelegivel",
                "label": "ai",
                "groups": {
                    "generatorFamily": known("gpt-5_6-luna"),
                    "harnessVersion": unknown("the run did not capture the binary version"),
                },
            },
            {
                "id": "rec_elegivel",
                "label": "mixed",
                "groups": {"generatorFamily": known("gpt-5_6-luna")},
            },
            {"id": "h1", "label": "human", "groups": {}},
        ]
        per_family = assemble_corpus.positive_rows_per_family(records)
        self.assertEqual(per_family, {"gpt-5_6-luna": Counter({"ai": 1, "mixed": 1})})
        positives = {f: sum(c.values()) for f, c in per_family.items()}
        self.assertEqual(positives, {"gpt-5_6-luna": 2})
        # Eligibility is not consulted here, and it cannot be: at this point in the run
        # `generationBatch` is `unknown` on every generated row (it is derived after
        # partitioning), so an eligibility count would return zero for every family.
        self.assertEqual(
            assemble_corpus.reserved_families_below_the_recall_floor(
                positives, {"gpt-5_6-luna"}, minimum=2
            ),
            {},
        )


class HeldOutDeclarationTests(unittest.TestCase):
    """An empty reserve is a refusal, never a family name.

    `parseDatasetManifest` refuses a manifest whose `heldOutGeneratorFamilies` is empty, so
    there is no legal empty state to fall back to — and the one thing that must never fill
    the gap is a name, because every withdrawn candidate was withdrawn for a reason that
    still holds.
    """

    def test_the_seated_reserve_is_what_the_governance_declares(self) -> None:
        import assemble_corpus

        self.assertEqual(
            assemble_corpus.declared_held_out_families(
                {"gpt-oss-120b-medium", "gpt-5_6-luna"}, {}
            ),
            ["gpt-5_6-luna", "gpt-oss-120b-medium"],
        )

    def test_an_empty_reserve_refuses_and_carries_every_withdrawal_reason(self) -> None:
        import assemble_corpus

        withdrawn = {
            "gpt-5_6-luna": "37 positivos, abaixo do piso de 200",
            "gpt-oss-120b-medium": "nenhuma linha sobreviveu a lane de mistura",
        }
        with self.assertRaises(assemble_corpus.HeldOutReserveEmpty) as caught:
            assemble_corpus.declared_held_out_families(set(), withdrawn)
        message = str(caught.exception)
        for family, reason in withdrawn.items():
            self.assertIn(family, message)
            self.assertIn(reason, message)
        self.assertIn("empty list", message)

    def test_an_empty_reserve_with_no_candidate_at_all_still_refuses(self) -> None:
        import assemble_corpus

        with self.assertRaises(assemble_corpus.HeldOutReserveEmpty) as caught:
            assemble_corpus.declared_held_out_families(set(), {})
        self.assertIn("reserve reached the corpus at all", str(caught.exception))

    def test_the_governance_block_of_the_run_calls_the_declaration(self) -> None:
        source = (Path(__file__).resolve().parent / "assemble_corpus.py").read_text(
            encoding="utf-8"
        )
        # The refusal only exists if the run uses it; a literal beside `held_out` would
        # reinstate the withdrawn claim without touching the function above.
        self.assertIn(
            "declared_held_out_families(held_out, withdrawn)",
            source,
        )


class SeenSetIndexTests(unittest.TestCase):
    """The global prune reads an artifact, and a release refuses without one."""

    def _header(self, **overrides) -> dict:
        import assemble_corpus

        return {
            "documents": assemble_corpus.DEAD_CORPUS_DOCUMENTS,
            "source": {
                "path": "records.jsonl",
                "sha256": assemble_corpus.DEAD_CORPUS_SHA256,
                "lines": assemble_corpus.DEAD_CORPUS_DOCUMENTS,
            },
            **overrides,
        }

    def test_a_partial_index_is_refused_against_the_dead_corpus_size(self) -> None:
        import assemble_corpus

        documents = assemble_corpus.DEAD_CORPUS_DOCUMENTS
        assemble_corpus.assert_the_seen_index_covers_the_dead_corpus(self._header())
        with self.assertRaises(assemble_corpus.SeenIndexIncomplete) as caught:
            assemble_corpus.assert_the_seen_index_covers_the_dead_corpus(
                self._header(
                    documents=documents - 1,
                    source={
                        "path": "parcial.jsonl",
                        "sha256": assemble_corpus.DEAD_CORPUS_SHA256,
                    },
                )
            )
        message = str(caught.exception)
        self.assertIn(str(documents - 1), message)
        self.assertIn(str(documents), message)
        self.assertIn("parcial.jsonl", message)

    def test_an_index_built_over_another_file_is_refused_by_digest(self) -> None:
        import assemble_corpus

        # The count does not identify the material. An index built by mistake over the
        # fresh pools (13.880 candidate rows on disk) satisfies `documents >= 10.000`, and
        # the run would then print its own pools compared against themselves as the
        # contamination number.
        other = "f" * 64
        with self.assertRaises(assemble_corpus.SeenIndexOfAnotherCorpus) as caught:
            assemble_corpus.assert_the_seen_index_covers_the_dead_corpus(
                self._header(
                    documents=13_880,
                    source={"path": "candidates/pools.jsonl", "sha256": other},
                )
            )
        message = str(caught.exception)
        self.assertIn(other, message)
        self.assertIn(assemble_corpus.DEAD_CORPUS_SHA256, message)
        self.assertIn("candidates/pools.jsonl", message)

    def test_an_index_that_declares_no_source_digest_is_refused(self) -> None:
        import assemble_corpus

        with self.assertRaises(assemble_corpus.SeenIndexOfAnotherCorpus) as caught:
            assemble_corpus.assert_the_seen_index_covers_the_dead_corpus(
                self._header(source={"path": "sem-digest.jsonl"})
            )
        self.assertIn(assemble_corpus.DEAD_CORPUS_SHA256, str(caught.exception))

    def test_the_dead_corpus_size_and_digest_are_the_measured_ones(self) -> None:
        import assemble_corpus

        # The dead corpus is a frozen artifact of the reproved run: 10.000 record-lines
        # over all five partitions, which is what the global prune is declared over. The
        # digest is `sha256sum benchmark/data/corpus-build/dataset/records.jsonl`, and it
        # is a constant here rather than prose in a comment because a measurement nothing
        # compares against is folklore.
        self.assertEqual(assemble_corpus.DEAD_CORPUS_DOCUMENTS, 10_000)
        self.assertEqual(
            assemble_corpus.DEAD_CORPUS_SHA256,
            "595739107e895cfc7b09409f29c13b998d195e921f1ca7eec1e5c8406772116a",
        )


class _AssemblyStdout(io.StringIO):
    # `main` calls sys.stdout.reconfigure to force utf-8, and io.StringIO has no such
    # method: a bare StringIO under redirect_stdout kills the run before it starts.
    def reconfigure(self, **kwargs) -> None:
        return None


class AssemblyRunTests(unittest.TestCase):
    """`main()` end to end, over a smoke corpus that populates all FIVE partitions.

    The sizes are derived, not picked. `--sample 100` asks for 40 human, 40 ai and 20
    mixed lines, and 40 is a class size whose four rounded blocks and remainder all land
    inside `CLASS_TOLERANCE` (0.45/0.05/0.10/0.20 of 40 are whole numbers and `test` is the
    remainder); at 12 or 15 they are not, and the stamped-corpus guard refuses before the
    run reaches anything under test.

    Every generated row carries its OWN `version` and template digest because both are
    union axes (`SPLIT_GROUP_KEYS`): rows sharing either are one component, and one
    component per class fails the geometry guard. Each human row carries its own origin
    document for the same reason. The mixed pool rows are deliberately unwritable — they
    record no mixing template — which is the state of the pairs on disk today, so the mixed
    class comes out empty and its shortfall is reported.
    """

    RESERVED_FAMILY = "gpt-5.6-luna"
    CORE_FAMILY = "gemini-3.5-flash-lite"
    LANE_OF = {"agy": "agy", "codex": "codex", "gemini": "gemini-api"}

    def _prose(self, tag: str) -> str:
        # Disjoint token sets per row, so neither the near-duplicate prune nor the global
        # seen prune collapses two fixture rows into one another.
        return " ".join(f"{tag}palavra{n}" for n in range(60))

    def _human(
        self, domain_source: str, index: int, license_id: str | None = None
    ) -> dict:
        from group_axes import NO_AUTHOR_READ, known, not_applicable

        return {
            "candidateId": f"cand_{domain_source}_{index:04d}",
            "text": self._prose(f"h{domain_source}{index}"),
            "wordCount": 60,
            "domainSource": domain_source,
            "licenseId": license_id or document_license_of(domain_source),
            "meta": {
                "dateField": "teiHeader/publicationStmt/date",
                "observedValue": "2019-05-04",
                "sourceMaterialBatch": "smb_fixture_v1",
                "groupAxes": {
                    "source": known(f"doc_{domain_source}_{index:04d}"),
                    "author": not_applicable(NO_AUTHOR_READ),
                },
            },
        }

    def _ai(self, provider: str, family: str, index: int) -> dict:
        import hashlib

        digest = hashlib.sha256(f"{family}:{index}".encode("utf-8")).hexdigest()
        meta = {
            "provider": provider,
            "family": family,
            "model": family,
            "version": f"{family}-build-{index:04d}",
            "recipe": "original",
            "generationLane": self.LANE_OF[provider],
            "promptId": f"original_ausente_{index:04d}",
            "promptSha256": digest,
            "promptTemplateDigest": digest,
            "pairedWith": f"ausente_{index:04d}",
            "harnessVersion": "1.0.0",
        }
        if self.LANE_OF[provider] == "codex":
            # `codex` offers no `not-supported` effort source, so a row of that lane
            # recording no level is unwritable at all — a real blocker of the lane.
            meta["effortLevel"] = "high"
            meta["effortSource"] = "flag"
        return {
            "candidateId": f"cand_ai_{index:04d}",
            "text": self._prose(f"a{index}"),
            "wordCount": 60,
            "meta": meta,
        }

    def _mixed(self, index: int) -> dict:
        return {
            "parentId": f"pai_ausente_{index:04d}",
            "parentFamily": "carolina_judicial_branch",
            "text": self._prose(f"m{index}"),
            "provider": "gemini",
            "model": "gemini-3.1-flash-lite",
            "mixture": {"spans": [{"start": 0, "end": 10, "origin": "ai"}]},
        }

    def _write(self, path: Path, rows: list[dict]) -> None:
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            for row in rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    def _pools(
        self,
        tmp: Path,
        *,
        reserved_rows: int = 6,
        reserved_family: str | None = None,
        excluded_rows: int = 0,
        excluded_family: str = "madras:synthetic_corpusqwn",
        carolina_license: str | None = None,
    ) -> dict:
        """The four pool files, and the planted line a seen set may already hold.

        `carolina_license` overrides what the Carolina DOCUMENTS declare. By default the
        two bases declare different licences, which is the state a per-stratum constant
        happens to reproduce; pass the encyclopedic licence to get the case where the
        constant and the reading disagree.
        """
        cand = tmp / "candidates"
        family = reserved_family or self.RESERVED_FAMILY
        # 11 encyclopedic rows against a quota of 10, with the planted one FIRST: it is
        # selected unless the global prune removes it.
        wiki = [self._human("ptwiki_lead", index) for index in range(11)]
        self._write(cand / "wikipedia_fresh.jsonl", wiki)
        carolina = [
            self._human(source, index, carolina_license)
            for source in (
                "carolina_judicial_branch",
                "carolina_social_media",
                "carolina_university_domains",
            )
            for index in range(10)
        ]
        self._write(cand / "carolina_fresh.jsonl", carolina)
        core = [
            self._ai("gemini", self.CORE_FAMILY, index)
            for index in range(40 - reserved_rows - excluded_rows)
        ]
        self._write(cand / "ai_fresh_gemini.jsonl", core)
        reserved = [
            self._ai("codex", family, 1000 + index) for index in range(reserved_rows)
        ]
        self._write(cand / "ai_fresh_codex.jsonl", reserved)
        if excluded_rows:
            # `ai_reserved.jsonl` is the pool the role lists did not cover, and it is read
            # LAST — so these rows are inside the quota only because the core count above
            # makes room for them. With the metadata the re-extraction will give them they
            # are writable rows, which is the state in which the exclusion is what removes
            # them rather than `UnmappableLane`.
            self._write(
                cand / "ai_reserved.jsonl",
                [
                    self._ai("gemini", excluded_family, 2000 + index)
                    for index in range(excluded_rows)
                ],
            )
        self._write(
            cand / "mixed_candidates.jsonl", [self._mixed(index) for index in range(20)]
        )
        return {"plantedId": wiki[0]["candidateId"], "plantedText": wiki[0]["text"]}

    def _main(
        self, tmp: Path, *, seen_texts: list[str] | None, sample: str | None = "100"
    ) -> None:
        import assemble_corpus
        import near_dupes

        seen_path = tmp / "seen-index.jsonl"
        if seen_texts is not None:
            near_dupes.write_seen_index(
                near_dupes.build_seen_index(seen_texts),
                seen_path,
                {"path": "fixture", "sha256": "0" * 64, "lines": len(seen_texts)},
            )
        buffer = _AssemblyStdout()
        saved_argv, saved_dataset = sys.argv, assemble_corpus.DATASET
        try:
            sys.argv = [
                "assemble_corpus.py",
                "--out-dir",
                str(tmp / "out"),
                "--candidates-dir",
                str(tmp / "candidates"),
                "--seen-index",
                str(seen_path),
                *(("--sample", sample) if sample else ()),
            ]
            # `benchmark/data/dataset/reserved.jsonl` is read by module constant, so a run
            # that did not redirect it would assemble the real reserved pool as well.
            assemble_corpus.DATASET = tmp / "dataset"
            assemble_corpus.PARTITION_OF.clear()
            with contextlib.redirect_stdout(buffer):
                assemble_corpus.main()
        finally:
            sys.argv, assemble_corpus.DATASET = saved_argv, saved_dataset
            self.stdout = buffer.getvalue()

    def _outputs(self, tmp: Path) -> tuple[list[dict], dict]:
        out = tmp / "out"
        records = [
            json.loads(line)
            for line in (out / "records.jsonl").read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        governance = json.loads(
            (out / "governance-inputs.json").read_text(encoding="utf-8")
        )
        return records, governance

    def test_the_run_seats_the_reserve_in_test_and_declares_only_it(self) -> None:
        import assemble_corpus
        from group_axes import identity_of

        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp)
            self._main(tmp, seen_texts=[])
            records, governance = self._outputs(tmp)
            partitions = dict(assemble_corpus.PARTITION_OF)

        self.assertEqual(
            sorted(set(partitions.values())),
            ["cal-A", "cal-B", "dev", "test", "train"],
        )
        self.assertEqual(len(records), 80)
        counts: dict[str, int] = {}
        for record in records:
            counts[record["label"]] = counts.get(record["label"], 0) + 1
        self.assertEqual(counts, {"human": 40, "ai": 40})

        # The declaration is the slate's reserve and nothing else.
        reserved = assemble_corpus.generator_family(self.RESERVED_FAMILY)
        self.assertEqual(governance["heldOutGeneratorFamilies"], [reserved])
        # Every line of it realizes in the blind block, which is what "reserved from
        # training" means operationally.
        seated = [
            r
            for r in records
            if identity_of(r["groups"].get("generatorFamily")) == reserved
        ]
        self.assertEqual(len(seated), 6)
        self.assertEqual({partitions[r["id"]] for r in seated}, {"test"})
        # The core family is NOT reserved: it reaches train, which is what makes the
        # reserve a distinction rather than a label.
        core = assemble_corpus.generator_family(self.CORE_FAMILY)
        core_blocks = {
            partitions[r["id"]]
            for r in records
            if identity_of(r["groups"].get("generatorFamily")) == core
        }
        self.assertIn("train", core_blocks)
        self.assertIn("test", core_blocks)
        self.assertIn(f"'{reserved}': 'ood-reserved'", self.stdout)
        self.assertIn(f"'{core}': 'core'", self.stdout)

    def test_a_line_of_the_dead_corpus_does_not_survive_the_global_prune(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            planted = self._pools(tmp)
            self._main(tmp, seen_texts=[planted["plantedText"]])
            records, _governance = self._outputs(tmp)

        self.assertNotIn(planted["plantedId"], {r["id"] for r in records})
        # The quota is still met out of the rest of the cell's pool, so the absence is the
        # prune and not a short pool.
        self.assertEqual(
            sum(1 for r in records if r.get("humanSourceType") == "ptwiki"), 10
        )
        self.assertIn("vazamento vs corpus morto", self.stdout)
        self.assertIn("'dropped': 1", self.stdout)
        self.assertIn("'dropped_exact_content': 1", self.stdout)

    def test_the_same_line_survives_when_the_seen_set_does_not_hold_it(self) -> None:
        # The counter-test that makes the one above about the PRUNE and not about pool
        # ordering: same pools, same quota, empty seen set.
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            planted = self._pools(tmp)
            self._main(tmp, seen_texts=[])
            records, _governance = self._outputs(tmp)
        self.assertIn(planted["plantedId"], {r["id"] for r in records})

    def test_a_reserve_the_pools_do_not_carry_refuses_the_assembly(self) -> None:
        import assemble_corpus

        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp, reserved_rows=0)
            with self.assertRaises(assemble_corpus.HeldOutReserveEmpty) as caught:
                self._main(tmp, seen_texts=[])
            # No family was substituted: the run wrote no governance at all.
            self.assertFalse((tmp / "out" / "governance-inputs.json").exists())
        message = str(caught.exception)
        self.assertIn("empty list", message)
        self.assertIn("no unseen-generator claim", message)

    def test_a_renamed_openai_family_stops_the_run_instead_of_reaching_train(
        self,
    ) -> None:
        import assemble_corpus

        # The rename the reserve exists against: same provider, same lane, a name the
        # slate does not carry. Under a `gpt-*` prefix rule this family would be classed
        # core and its six lines would land in train.
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp, reserved_family="gpt-5.7-luna")
            with self.assertRaises(assemble_corpus.UndeclaredGeneratorFamily) as caught:
                self._main(tmp, seen_texts=[])
            self.assertFalse((tmp / "out" / "records.jsonl").exists())
        self.assertIn("gpt-5_7-luna", str(caught.exception))

    def test_an_excluded_family_is_dropped_and_counted_instead_of_trained_on(
        self,
    ) -> None:
        import assemble_corpus
        from group_axes import identity_of

        # Four writable rows of a family whose row records no provider. Under a default —
        # or under the two-role slate that preceded this — they are trainable rows of a
        # possible OpenAI generation.
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp, excluded_rows=4)
            self._main(tmp, seen_texts=[])
            records, governance = self._outputs(tmp)
            partitions = dict(assemble_corpus.PARTITION_OF)

        excluded = assemble_corpus.generator_family("madras:synthetic_corpusqwn")
        self.assertIn(excluded, assemble_corpus.EXCLUDED_GENERATOR_FAMILIES)
        families = {identity_of(r["groups"].get("generatorFamily")) for r in records}
        self.assertNotIn(excluded, families)
        # The four lines are GONE, not moved to the blind block: 40 human + 36 ai.
        self.assertEqual(len(records), 76)
        self.assertEqual(sum(1 for r in records if r["label"] == "ai"), 36)
        self.assertEqual(sorted(set(partitions.values())),
                         ["cal-A", "cal-B", "dev", "test", "train"])
        # Counted, by family, with the reason the slate gives.
        self.assertIn("familias excluidas pelo slate", self.stdout)
        self.assertIn(f"'{excluded}': 4", self.stdout)
        self.assertIn("records no provider", self.stdout)
        # And the declaration is untouched by the drop.
        self.assertEqual(
            governance["heldOutGeneratorFamilies"],
            [assemble_corpus.generator_family(self.RESERVED_FAMILY)],
        )

    def test_a_release_assembly_refuses_without_the_seen_set_artifact(self) -> None:
        import assemble_corpus

        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp)
            with self.assertRaises(assemble_corpus.SeenIndexMissing) as caught:
                self._main(tmp, seen_texts=None, sample=None)
        message = str(caught.exception)
        self.assertIn("build-seen-index", message)
        self.assertIn("no seen-set artifact", message)

    def test_a_smoke_without_the_artifact_says_so_instead_of_claiming_a_clean_pool(
        self,
    ) -> None:
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp)
            self._main(tmp, seen_texts=None)
            records, _governance = self._outputs(tmp)
        self.assertEqual(len(records), 80)
        self.assertIn("sem indice de vistos", self.stdout)
        self.assertNotIn("vazamento vs corpus morto", self.stdout)

    # --- the anti-artifact gate ON the path a real assembly takes (D13/A4) ----

    def _family(self, spelling: str) -> str:
        import assemble_corpus

        return assemble_corpus.generator_family(spelling)

    def _contaminate(self, tmp: Path, pool: str, rows: int) -> int:
        """Prefixes `rows` lines of one AI pool with an assistant-voice delivery."""
        path = tmp / "candidates" / f"{pool}.jsonl"
        lines = [
            json.loads(line)
            for line in path.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        for row in lines[:rows]:
            row["text"] = "Aqui está o texto que você pediu: " + row["text"]
        self._write(path, lines)
        return len(lines)

    def test_a_contaminated_family_refuses_the_assembly_before_the_split(self) -> None:
        import artifact_gate

        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp)
            # 1 of the 6 codex rows = 16.67 %, far above the 2 % ceiling.
            self.assertEqual(self._contaminate(tmp, "ai_fresh_codex", 1), 6)
            with self.assertRaises(artifact_gate.ArtifactContamination) as caught:
                self._main(tmp, seen_texts=[])
            # Nothing was written: the refusal sits ahead of records.jsonl, so a
            # contaminated corpus never exists on disk to be trained on by accident.
            self.assertFalse((tmp / "out" / "records.jsonl").exists())
        message = str(caught.exception)
        self.assertIn(self._family(self.RESERVED_FAMILY), message)
        self.assertIn("1/6", message)
        self.assertIn("16.67%", message)
        self.assertIn("codex", message)
        self.assertIn("REGENERATED", message)
        # The lane's other five lines are not offered as a corpus, and stdout says the
        # same thing in the same words.
        self.assertIn("regenerate-lane", self.stdout)

    def test_the_refusal_publishes_the_gate_report_too(self) -> None:
        import artifact_gate

        # The refusal message names the detections and the counts; the PROBES that matched
        # are the actionable half ("this family echoes the word-count directive" tells a lane
        # owner what to change) and they live only in the report. Published before the
        # verdict, so the diagnosis of a refused run survives on disk.
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp)
            self.assertEqual(self._contaminate(tmp, "ai_fresh_codex", 1), 6)
            with self.assertRaises(artifact_gate.ArtifactContamination):
                self._main(tmp, seen_texts=[])
            report = json.loads(
                (tmp / "out" / "artifact-gate.json").read_text(encoding="utf-8")
            )
            # And it is the ONLY thing written: the corpus a training run could read does
            # not exist.
            self.assertFalse((tmp / "out" / "records.jsonl").exists())
            self.assertFalse((tmp / "out" / "governance-inputs.json").exists())
        self.assertEqual(report["lanesToRegenerate"], ["codex"])
        breached = [
            entry
            for entry in report["families"]
            if entry["verdict"] == artifact_gate.VERDICT_REGENERATE_LANE
        ]
        self.assertEqual(
            [entry["family"] for entry in breached],
            [self._family(self.RESERVED_FAMILY)],
        )
        self.assertEqual(
            (breached[0]["contaminated"], breached[0]["lines"]), (1, 6)
        )
        self.assertEqual(
            breached[0]["byDetection"][artifact_gate.DETECTION_METACONVERSATION][
                "probes"
            ],
            ["aqui esta o texto"],
        )
        # Still no line id anywhere: publishing the report must not make the pruning A4
        # forbids reachable.
        serialized = json.dumps(report, ensure_ascii=False)
        self.assertNotIn("cand_ai_", serialized)

    def test_the_manifest_licenses_are_the_ones_the_records_of_the_same_run_carry(
        self,
    ) -> None:
        import assemble_corpus

        # The projection, end to end. The fixture is the case a per-stratum constant CANNOT
        # reproduce: the Carolina documents declare the encyclopedic licence, so a constant
        # keyed on the stratum says `cc-by-nc-sa-4.0` for rows whose headers say
        # `cc-by-sa-4.0` — and with the pools' default licences the two agree, which is
        # exactly the accident that hid the defect in the first place.
        declared = document_license_of("ptwiki_lead")
        self.assertNotEqual(declared, document_license_of("carolina_judicial_branch"))
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp, carolina_license=declared)
            self._main(tmp, seen_texts=[])
            records, governance = self._outputs(tmp)

        by_source: dict[str, set[str]] = {}
        for record in records:
            provenance = record["provenance"]
            by_source.setdefault(provenance["sourceId"], set()).add(
                provenance["licenseId"]
            )
        self.assertEqual(by_source["src_carolina"], {declared})
        self.assertEqual(by_source["src_wikipedia_pt"], {declared})
        self.assertEqual(
            {entry["sourceId"]: entry["licenseId"] for entry in governance["sources"]},
            {source: next(iter(licenses)) for source, licenses in by_source.items()},
        )
        # And `licenses[]` is exactly the set the rows carry, with the reviewed terms of
        # each: an entry more declares terms the corpus is not under, one fewer makes the
        # seal refuse the whole corpus (DATASET_LICENSE_INVALID). Two entries here, out of an
        # inventory of three.
        used = {licence for licenses in by_source.values() for licence in licenses}
        self.assertEqual({entry["id"] for entry in governance["licenses"]}, used)
        self.assertLess(len(used), len(assemble_corpus.LICENSE_INVENTORY))
        for entry in governance["licenses"]:
            self.assertEqual(
                entry,
                {"id": entry["id"], **assemble_corpus.LICENSE_INVENTORY[entry["id"]]},
            )

    def test_a_clean_assembly_publishes_the_gate_report_anyway(self) -> None:
        import artifact_gate

        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp)
            self._main(tmp, seen_texts=[])
            report = json.loads(
                (tmp / "out" / "artifact-gate.json").read_text(encoding="utf-8")
            )
        # "Clean" is a measurement over named families with named denominators, so the
        # artifact exists for a passing corpus too — otherwise the only evidence the gate
        # ran at all would be the absence of a refusal.
        self.assertEqual(report["rule"], "A4")
        self.assertEqual(report["lanesToRegenerate"], [])
        self.assertEqual(
            sorted(entry["family"] for entry in report["families"]),
            sorted(
                {
                    self._family(self.CORE_FAMILY),
                    self._family(self.RESERVED_FAMILY),
                }
            ),
        )
        for entry in report["families"]:
            self.assertEqual(entry["verdict"], artifact_gate.VERDICT_CLEAR)
            self.assertGreater(entry["lines"], 0)
            self.assertEqual(entry["contaminated"], 0)


class DocumentLicenseTests(unittest.TestCase):
    """D8: the licence read from the DOCUMENT reaches the assembled record.

    The extractor reads the TEI availability element per document against a fail-closed
    allowlist (C1), and until now the assembler threw that reading away: it looked the
    licence up from the row's stratum, so every Carolina record said `cc-by-nc-sa-4.0`
    whatever its header declared. These tests are about the rest of the journey.
    """

    def _candidate(self, license_id: str | None, source: str) -> dict:
        from group_axes import NO_AUTHOR_READ, known, not_applicable

        candidate = {
            "candidateId": f"cand_{source}_0001",
            "text": PROSE_60,
            "wordCount": 60,
            "domainSource": source,
            "meta": {
                "dateField": "teiHeader/publicationStmt/date",
                "observedValue": "2019-05-04",
                "snapshot": "carolina" if source.startswith("carolina") else "ptwiki",
                "sourceMaterialBatch": "smb_carolina-v2_0",
                "extractionRun": "extraction_carolina_fresh",
                "groupAxes": {
                    "source": known(f"doc_{source}"),
                    "author": not_applicable(NO_AUTHOR_READ),
                },
            },
        }
        if license_id is not None:
            candidate["licenseId"] = license_id
        return candidate

    def test_a_record_with_no_resolved_license_is_refused_naming_the_document(
        self,
    ) -> None:
        from assemble_corpus import (
            MissingDocumentLicense,
            UnwritableInV3,
            human_record,
        )

        # A counted drop and not an abort: the pools written before the extractors emitted
        # a licence hold rows in exactly this state, and the honest outcome is a smaller
        # corpus plus a count — the same treatment `MissingLabelEvidence` gets.
        self.assertTrue(issubclass(MissingDocumentLicense, UnwritableInV3))
        candidate = self._candidate(None, "carolina_judicial_branch")
        with self.assertRaises(MissingDocumentLicense) as caught:
            human_record(candidate, "carolina-judicial", None)
        message = str(caught.exception)
        self.assertIn("cand_carolina_judicial_branch_0001", message)
        self.assertIn("licenseId", message)

    def test_the_license_the_document_declared_reaches_the_record(self) -> None:
        from assemble_corpus import human_record

        # `cc-by-sa-4.0` on a CAROLINA row, which is the case the old code could not
        # express: the stratum lookup said `cc-by-nc-sa-4.0` for every Carolina document,
        # so a header declaring anything else was overwritten on the way in.
        entries: list[dict] = []
        record = human_record(
            self._candidate("cc-by-sa-4.0", "carolina_judicial_branch"),
            "carolina-judicial",
            None,
            evidence_sink=entries,
        )
        self.assertEqual(record["provenance"]["licenseId"], "cc-by-sa-4.0")
        # And the label-evidence registration says the same thing, because the licence is
        # part of what the entry digest covers.
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["licenseId"], "cc-by-sa-4.0")
        self.assertIn("cc-by-sa-4_0", entries[0]["entryId"])

    def test_a_license_the_inventory_cannot_publish_drops_the_row_by_name(self) -> None:
        from assemble_corpus import MissingDocumentLicense, human_record

        candidate = self._candidate("cc-by-4.0", "carolina_judicial_branch")
        with self.assertRaises(MissingDocumentLicense) as caught:
            human_record(candidate, "carolina-judicial", None)
        message = str(caught.exception)
        self.assertIn("cand_carolina_judicial_branch_0001", message)
        self.assertIn("cc-by-4.0", message)
        # The reason, and the licences that ARE publishable — a drop with neither is a row
        # that vanished under a name nobody can act on.
        self.assertIn("no terms for it", message)
        self.assertIn("cc-by-nc-sa-4.0", message)

    def test_a_license_no_list_decided_about_stops_the_run(self) -> None:
        from assemble_corpus import (
            UndecidedDocumentLicense,
            UnwritableInV3,
            document_license,
        )

        # The asymmetry `UndecidedDomainSource` already has, on the licence axis: a DECIDED
        # exclusion is counted, an UNDECIDED one halts. A source that starts shipping a new
        # availability string is the real case, and a counted drop would hide it.
        self.assertFalse(issubclass(UndecidedDocumentLicense, UnwritableInV3))
        candidate = self._candidate("wtfpl-2.0", "carolina_judicial_branch")
        with self.assertRaises(UndecidedDocumentLicense) as caught:
            document_license(candidate)
        message = str(caught.exception)
        self.assertIn("wtfpl-2.0", message)
        for named in ("cc-by-nc-sa-4.0", "cc-by-4.0", "public-domain"):
            self.assertIn(named, message)

    def test_two_licenses_of_one_snapshot_are_two_evidence_entries(self) -> None:
        from assemble_corpus import human_record

        # `assertLabelEvidenceResolves` indexes entryId -> ONE digest, and the licence is
        # inside the digested bytes. An entryId that omitted it would give these two rows
        # one key and two digests, and whichever entry lost the dedup would take its
        # records down with a digest divergence that names no document.
        entries: list[dict] = []
        for license_id in ("cc-by-nc-sa-4.0", "cc-by-sa-4.0"):
            candidate = self._candidate(license_id, "carolina_judicial_branch")
            candidate["candidateId"] = f"cand_{license_id}"
            human_record(candidate, "carolina-judicial", None, evidence_sink=entries)
        self.assertEqual(len(entries), 2)
        self.assertEqual(len({entry["entryId"] for entry in entries}), 2)
        self.assertEqual(len({entry["entryDigest"] for entry in entries}), 2)

    def test_the_manifest_inventory_is_the_licenses_the_records_carry(self) -> None:
        from assemble_corpus import LICENSE_INVENTORY, used_license_inventory

        records = [
            {"id": "r1", "provenance": {"licenseId": "cc-by-sa-4.0"}},
            {"id": "r2", "provenance": {"licenseId": "cc-by-sa-4.0"}},
        ]
        inventory = used_license_inventory(records)
        # Exactly what the rows carry: an entry the corpus does not use declares terms the
        # corpus is not under, and a missing one refuses the whole seal.
        self.assertEqual([entry["id"] for entry in inventory], ["cc-by-sa-4.0"])
        self.assertEqual(
            inventory[0]["name"], LICENSE_INVENTORY["cc-by-sa-4.0"]["name"]
        )

    def test_a_license_with_no_inventory_entry_stops_the_projection(self) -> None:
        from assemble_corpus import UndecidedDocumentLicense, used_license_inventory

        with self.assertRaises(UndecidedDocumentLicense) as caught:
            used_license_inventory(
                [{"id": "r9", "provenance": {"licenseId": "cc-by-nd-4.0"}}]
            )
        message = str(caught.exception)
        self.assertIn("r9", message)
        self.assertIn("cc-by-nd-4.0", message)

    def test_a_source_under_two_licenses_refuses_the_manifest(self) -> None:
        from assemble_corpus import SourceCarriesTwoLicenses, source_licenses

        records = [
            {
                "id": "r1",
                "provenance": {"sourceId": "src_carolina", "licenseId": "cc-by-sa-4.0"},
            },
            {
                "id": "r2",
                "provenance": {
                    "sourceId": "src_carolina",
                    "licenseId": "cc-by-nc-sa-4.0",
                },
            },
        ]
        with self.assertRaises(SourceCarriesTwoLicenses) as caught:
            source_licenses(records)
        message = str(caught.exception)
        self.assertIn("src_carolina", message)
        self.assertIn("cc-by-sa-4.0", message)
        self.assertIn("cc-by-nc-sa-4.0", message)

    def test_one_license_per_source_is_projected_from_the_records(self) -> None:
        from assemble_corpus import source_licenses

        self.assertEqual(
            source_licenses(
                [
                    {
                        "id": "r1",
                        "provenance": {
                            "sourceId": "src_wikipedia_pt",
                            "licenseId": "cc-by-sa-4.0",
                        },
                    },
                    {
                        "id": "r2",
                        "provenance": {
                            "sourceId": "src_ai",
                            "licenseId": "geracao-propria-v1",
                        },
                    },
                ]
            ),
            {"src_ai": "geracao-propria-v1", "src_wikipedia_pt": "cc-by-sa-4.0"},
        )

    def test_every_license_the_extractor_admits_is_decided_by_one_of_the_two_lists(
        self,
    ) -> None:
        import assemble_corpus
        import extract_carolina

        admitted = set(extract_carolina.LICENSE_MAP.values())
        publishable = set(assemble_corpus.LICENSE_INVENTORY)
        unreviewed = set(assemble_corpus.UNREVIEWED_DOCUMENT_LICENSES)
        # Declared AND disjoint, the F0-6 discipline on the licence axis: naming a licence
        # must not admit it. The pin is against the EXTRACTOR's allowlist, so a licence
        # added there without a decision here surfaces as this failure instead of as a
        # counted drop nobody asked for.
        self.assertEqual(publishable & unreviewed, set())
        self.assertEqual(admitted - publishable, unreviewed)
        # And the generated class writes its own licence directly, so that one needs an
        # entry too or the projection refuses every assembly.
        self.assertIn(assemble_corpus.GENERATED_LICENSE, publishable)

    def test_a_generated_candidate_that_declares_another_license_stops_the_run(
        self,
    ) -> None:
        import assemble_corpus

        # The generated classes do NOT read the licence off the row: the text was produced
        # here and the grant is this repository's to make. That holds only while every
        # generated pool is this repository's own generation, and `import_public_corpus.py`
        # is a live producer of the other case — it writes a third party's generated corpus
        # under that party's licence (`odc-by-1.0`). Republishing those rows as
        # `geracao-propria-v1` would publish a grant nobody here can issue.
        candidate = {
            "candidateId": "cand_ai_public_0001",
            "text": PROSE_60,
            "wordCount": 60,
            "meta": {"family": "madras:qwen", "provider": "codex",
                     "promptTemplateDigest": "a" * 64},
        }
        # The same row without a licence is a DROP, and it is the drop that makes the
        # ordering matter: the refusal has to sit ahead of it, or a mislicensed pool leaves
        # the corpus row by row with the licence never named.
        with self.assertRaises(assemble_corpus.MissingRecipe):
            assemble_corpus.ai_record(candidate)
        candidate["licenseId"] = "odc-by-1.0"
        with self.assertRaises(
            assemble_corpus.GeneratedRowDeclaresAnotherLicense
        ) as caught:
            assemble_corpus.ai_record(candidate)
        message = str(caught.exception)
        self.assertIn("cand_ai_public_0001", message)
        self.assertIn("odc-by-1.0", message)
        self.assertIn(assemble_corpus.GENERATED_LICENSE, message)
        # It ABORTS rather than dropping: a counted drop of every row of a mislicensed pool
        # is a silent way to end up with a corpus written under the wrong grant.
        self.assertFalse(
            issubclass(
                assemble_corpus.GeneratedRowDeclaresAnotherLicense,
                assemble_corpus.UnwritableInV3,
            )
        )
        # The repository's OWN grant on the row is not a contradiction, and neither is a row
        # that names none — which is the shape of every generated pool on disk today.
        for declared in (assemble_corpus.GENERATED_LICENSE, "", None):
            self.assertEqual(
                assemble_corpus.generated_license(
                    {"candidateId": "c", "licenseId": declared}
                ),
                assemble_corpus.GENERATED_LICENSE,
            )


class AntiArtifactGateTests(unittest.TestCase):
    """D13/A4: the pre-training anti-artifact gate, in code.

    Four detections, each asserted by the NAME it puts in the diagnosis, because the name
    is what a lane owner acts on: an echo of the prompt is fixed in the template, a
    refusal in the seed selection, a harness signature in how the lane captures output.
    """

    def _line(self, text: str, *, index: int = 0, family: str = "fam-a",
              lane: str = "codex"):
        from artifact_gate import GeneratedLine

        return GeneratedLine(
            record_id=f"rec_{index:05d}", family=family, lane=lane, text=text
        )

    def _clean(self, index: int) -> str:
        return " ".join(f"palavra{index}x{n}" for n in range(60))

    def test_a_line_that_repeats_the_prompt_is_named_prompt_echo(self) -> None:
        import artifact_gate

        # The probe is the template's own sentence, so this is the prompt this repository
        # issues coming back out of the model.
        found = artifact_gate.detections_in(
            "Responda apenas com o texto, sem titulo e sem comentarios. "
            + self._clean(1)
        )
        self.assertIn(artifact_gate.DETECTION_PROMPT_ECHO, found)
        self.assertEqual(list(found), [artifact_gate.DETECTION_PROMPT_ECHO])
        self.assertIn(
            "responda apenas com o texto",
            found[artifact_gate.DETECTION_PROMPT_ECHO],
        )

    def test_a_line_that_declines_the_task_is_named_refusal(self) -> None:
        import artifact_gate

        found = artifact_gate.detections_in(
            "Desculpe, mas não posso ajudar com isso. " + self._clean(2)
        )
        self.assertIn(artifact_gate.DETECTION_REFUSAL, found)
        self.assertIn(
            "nao posso ajudar com isso", found[artifact_gate.DETECTION_REFUSAL]
        )

    def test_prose_that_merely_says_it_cannot_help_is_not_a_refusal(self) -> None:
        import artifact_gate

        # Measured on the pools: the bare phrasings match human prose — a review saying
        # "não posso avaliar o produto", a forum answer saying "eu não posso te ajudar
        # porém tenho uma informação", a note saying "não posso ajudar ninguém". What
        # separates a refusal is the object it declines, not the modal verb.
        for prose in (
            "Não posso avaliar o produto, pois ele já não estava disponível. ",
            "Joguei dinheiro fora e ainda por cima não posso ajudar ninguém. ",
            "Se for esse o caso eu não posso te ajudar porém tenho uma informação. ",
        ):
            found = artifact_gate.detections_in(prose + self._clean(3))
            self.assertEqual(found, {}, prose)

    def test_a_line_that_talks_about_the_task_is_named_metaconversation(self) -> None:
        import artifact_gate

        found = artifact_gate.detections_in(
            "Aqui está o texto que você pediu: " + self._clean(4)
        )
        self.assertIn(artifact_gate.DETECTION_METACONVERSATION, found)
        self.assertIn(
            "aqui esta o texto", found[artifact_gate.DETECTION_METACONVERSATION]
        )

    def test_a_line_carrying_the_harness_mark_is_named_harness_signature(self) -> None:
        import artifact_gate
        import generate_ai

        # Three shapes of the same fact, and all three are the BINARY and not the model:
        # the CLI banner (whose list is the generator's own), the chat-template turn
        # marker, and a terminal control byte. Only the `gemini-cli` lane strips banners
        # before writing, so the other three lanes can carry one into the pool.
        banner = artifact_gate.detections_in(
            f"{generate_ai.CLI_BANNER_PREFIXES[0]} injecting env\n" + self._clean(5)
        )
        self.assertIn(artifact_gate.DETECTION_HARNESS_SIGNATURE, banner)
        turn = artifact_gate.detections_in(
            "800-1200 palavras em portugues brasileiro. assistant ### Introducao "
            + self._clean(6)
        )
        self.assertIn(artifact_gate.DETECTION_HARNESS_SIGNATURE, turn)
        self.assertIn(
            "role-turn:assistant", turn[artifact_gate.DETECTION_HARNESS_SIGNATURE]
        )
        control = artifact_gate.detections_in("\x1b[2K Texto. " + self._clean(7))
        self.assertIn(artifact_gate.DETECTION_HARNESS_SIGNATURE, control)
        self.assertIn(
            "terminal-control-bytes",
            control[artifact_gate.DETECTION_HARNESS_SIGNATURE],
        )

    def test_a_turn_marker_on_its_own_line_is_a_harness_signature(self) -> None:
        import artifact_gate

        # The CANONICAL shape of a chat-template leak is the marker ALONE on its own line,
        # and it is the common one: measured over the pools, sentence punctuation alone
        # reaches 24 of the 4.048 generated rows and the line boundary reaches 146. A probe
        # run against the flat fold cannot see it — every newline is a space there, so the
        # marker has no boundary in front of it.
        for text in (
            "Escreva um texto sobre gatos\nassistant\n" + self._clean(17),
            "Escreva um texto sobre gatos\n   assistant\n" + self._clean(18),
            "Escreva um texto sobre gatos. assistant " + self._clean(19),
        ):
            found = artifact_gate.detections_in(text)
            self.assertIn(
                artifact_gate.DETECTION_HARNESS_SIGNATURE, found, repr(text[:44])
            )
            self.assertIn(
                "role-turn:assistant",
                found[artifact_gate.DETECTION_HARNESS_SIGNATURE],
                repr(text[:44]),
            )
        # And the word mid-sentence is not a turn boundary, which is what the anchor buys:
        # zero matches in 42.100 human pool rows.
        self.assertEqual(
            artifact_gate.detections_in(
                "O assistant virtual da empresa respondeu ao cliente. " + self._clean(20)
            ),
            {},
        )

    def test_a_clean_line_trips_nothing(self) -> None:
        import artifact_gate

        self.assertEqual(artifact_gate.detections_in(self._clean(8)), {})

    def test_a_word_count_directive_from_a_foreign_prompt_is_still_prompt_echo(
        self,
    ) -> None:
        import artifact_gate

        # The echoes MEASURED in the pools are echoes of a third party's prompt: the
        # `madras` rows carry "aproximadamente 1000 palavras em portugues brasileiro", a
        # sentence no template of this repository contains. Deriving the probes from our
        # own templates alone would name those rows harness-signature and miss the echo
        # that is right next to the marker.
        found = artifact_gate.detections_in(
            "Definicoes, contexto e implicacoes praticas. Aproximadamente 1000 "
            "palavras em portugues brasileiro. " + self._clean(14)
        )
        self.assertIn(artifact_gate.DETECTION_PROMPT_ECHO, found)
        self.assertIn(
            "palavras em portugues brasileiro",
            found[artifact_gate.DETECTION_PROMPT_ECHO],
        )

    def test_a_call_for_keywords_is_not_a_word_count_directive(self) -> None:
        import artifact_gate

        # Measured false positive, from a Carolina university document: a call for papers
        # asking for "de 3 a 5 palavras-chave" reads as a word-count instruction unless the
        # probe refuses the hyphen. `palavras-chave` is the compound; a word count is never
        # followed by one.
        #
        # Both halves of the mapping are exercised, because the compound has to be refused
        # in the DERIVED template probes too: two recipe chunks end in `palavras`, and the
        # second sentence here matches one of them character for character up to the hyphen.
        for prose in (
            "O participante deve enviar um resumo e de 3 a 5 palavras-chave. ",
            "Enviar resumo com aproximadamente 5 palavras-chave e titulo em ingles. ",
        ):
            self.assertEqual(
                artifact_gate.detections_in(prose + self._clean(15)), {}, prose
            )
        # The counter-case that keeps this about the compound and not about the probe being
        # dead: the same directive with the bare noun IS an echo.
        self.assertIn(
            artifact_gate.DETECTION_PROMPT_ECHO,
            artifact_gate.detections_in(
                "Escreva com aproximadamente 500 palavras sobre o tema. " + self._clean(21)
            ),
        )

    def test_a_curly_apostrophe_does_not_hide_a_refusal(self) -> None:
        import artifact_gate

        # Models write "can't" with U+2019 as often as with U+0027, and a probe list
        # spelled both ways twice is a list that gets half-updated.
        found = artifact_gate.detections_in(
            "I’m sorry, but I can’t help with that. " + self._clean(16)
        )
        self.assertIn(artifact_gate.DETECTION_REFUSAL, found)

    def _family_at(self, contaminated: int, total: int) -> dict:
        import artifact_gate

        lines = [
            self._line(
                "Aqui está o texto: " + self._clean(index)
                if index < contaminated
                else self._clean(index),
                index=index,
            )
            for index in range(total)
        ]
        return artifact_gate.measure(lines)

    def test_a_family_above_two_percent_sends_its_whole_lane_to_regeneration(
        self,
    ) -> None:
        import artifact_gate

        report = self._family_at(21, 1000)
        entry = report["families"][0]
        self.assertEqual((entry["contaminated"], entry["lines"]), (21, 1000))
        self.assertAlmostEqual(entry["fraction"], 0.021)
        self.assertEqual(entry["verdict"], artifact_gate.VERDICT_REGENERATE_LANE)
        # The LANE, whole. A4: the family is what is measured and the lane is what is
        # remade, because the artifact rate is a property of how the lane was run.
        self.assertEqual(report["lanesToRegenerate"], ["codex"])
        with self.assertRaises(artifact_gate.ArtifactContamination) as caught:
            artifact_gate.assert_no_lane_needs_regeneration(report)
        message = str(caught.exception)
        # Family, count and measured fraction, which are the three quantities A4 asks the
        # report to name.
        self.assertIn("fam-a", message)
        self.assertIn("21/1000", message)
        self.assertIn("2.10%", message)
        self.assertIn("codex", message)
        self.assertIn(artifact_gate.DETECTION_METACONVERSATION, message)

    def test_a_family_below_two_percent_is_clear(self) -> None:
        import artifact_gate

        report = self._family_at(19, 1000)
        entry = report["families"][0]
        self.assertEqual((entry["contaminated"], entry["lines"]), (19, 1000))
        self.assertEqual(entry["verdict"], artifact_gate.VERDICT_CLEAR)
        self.assertEqual(report["lanesToRegenerate"], [])
        # No refusal, and the family is still REPORTED with its count: "clear" is a
        # measurement over a named denominator, not a silence.
        artifact_gate.assert_no_lane_needs_regeneration(report)
        self.assertEqual(entry["byDetection"]["metaconversation"]["lines"], 19)

    def test_the_ceiling_is_exclusive_at_exactly_two_percent(self) -> None:
        import artifact_gate

        # A4 says "more than 2 %". The comparison is exact rational arithmetic, so the
        # boundary is not decided by whether 0.02 is representable in binary.
        report = self._family_at(20, 1000)
        self.assertEqual(
            report["families"][0]["verdict"], artifact_gate.VERDICT_CLEAR
        )
        self.assertEqual(artifact_gate.CONTAMINATION_CEILING, Fraction(2, 100))

    def test_a_smoke_denominator_gives_zero_tolerance_and_that_is_the_rule(self) -> None:
        import artifact_gate

        # There is NO minimum denominator, and at smoke sizes the ceiling degenerates to
        # zero tolerance by arithmetic: 1 of 6 is 16.67 %, so one detection refuses. Pinned
        # because it is a decision and not a side effect — a family the gate measures and
        # declines to act on would be a third outcome besides passing and refusing, and the
        # one an operator under deadline reaches for.
        report = self._family_at(1, 6)
        entry = report["families"][0]
        self.assertEqual((entry["contaminated"], entry["lines"]), (1, 6))
        self.assertEqual(entry["verdict"], artifact_gate.VERDICT_REGENERATE_LANE)
        with self.assertRaises(artifact_gate.ArtifactContamination) as caught:
            artifact_gate.assert_no_lane_needs_regeneration(report)
        self.assertIn("1/6", str(caught.exception))
        # Clean at the same denominator is still clean: the rule is the fraction, not the
        # size of the family.
        self.assertEqual(
            self._family_at(0, 6)["families"][0]["verdict"],
            artifact_gate.VERDICT_CLEAR,
        )
        # And no knob names a family size below which the gate reports without refusing.
        self.assertEqual(
            [
                name
                for name in dir(artifact_gate)
                if any(
                    word in name.upper()
                    for word in ("DENOMINATOR", "MIN_LINES", "MINLINES", "SMOKE")
                )
            ],
            [],
        )

    def test_a_mixed_row_with_no_generated_span_stops_the_run(self) -> None:
        import artifact_gate

        # `mixed_record` computes `aiFraction` from these spans and does not refuse zero, so
        # a controlled-generation row with no `origin: "ai"` stretch is constructible. It
        # must not be SKIPPED: the row goes into training and the family's denominator would
        # be smaller than the corpus the gate was handed, with nothing saying so.
        record = self._generated_record(
            4, "Aqui está o texto: " + self._clean(22), mixture={"spans": []}
        )
        with self.assertRaises(artifact_gate.GeneratedRowCarriesNoGeneratedSpan) as caught:
            artifact_gate.generated_lines([record])
        message = str(caught.exception)
        self.assertIn("rec_00004", message)
        self.assertIn("fam-a", message)
        self.assertIn("origin='ai'", message)
        # Human-only spans are the same fact spelled differently, and refuse the same way.
        human_only = self._generated_record(
            5,
            self._clean(23),
            mixture={"spans": [{"start": 0, "end": 10, "origin": "human"}]},
        )
        with self.assertRaises(artifact_gate.GeneratedRowCarriesNoGeneratedSpan):
            artifact_gate.generated_lines([human_only])

    def test_selective_pruning_is_not_an_outcome_the_gate_offers(self) -> None:
        import artifact_gate

        # A4 forbids pruning the contaminated lines: what survives is then selected by
        # what the detector missed, and the lane's bias enters the corpus unrecorded. The
        # gate makes that unreachable rather than merely discouraged — the report names no
        # line, so there is nothing downstream to drop.
        report = self._family_at(21, 1000)
        serialized = json.dumps(report, ensure_ascii=False)
        for index in range(1000):
            self.assertNotIn(f"rec_{index:05d}", serialized)
        # And the module exposes no entry point that removes lines and continues.
        surface = [
            name
            for name in dir(artifact_gate)
            if not name.startswith("_")
            and any(verb in name.lower() for verb in ("prune", "drop", "filter", "clean"))
        ]
        self.assertEqual(surface, [])
        # The refusal states the remedy, and states that pruning is not it.
        with self.assertRaises(artifact_gate.ArtifactContamination) as caught:
            artifact_gate.assert_no_lane_needs_regeneration(report)
        message = str(caught.exception)
        self.assertIn("REGENERATED", message)
        self.assertIn("not the remedy", message)

    def _generated_record(
        self, index: int, text: str, *, family: str = "fam-a", lane: str = "codex",
        mixture: dict | None = None,
    ) -> dict:
        from group_axes import known

        record = {
            "id": f"rec_{index:05d}",
            "text": text,
            "provenance": {"sourceKind": "controlled-generation"},
            "groups": {
                "generatorFamily": known(family),
                "generationLane": known(lane),
            },
        }
        if mixture is not None:
            record["mixture"] = mixture
        return record

    def test_only_the_generated_spans_of_a_mixed_row_are_scanned(self) -> None:
        import artifact_gate

        # A mixed row IS a human text with generated stretches, and `mixture.spans` says
        # which is which. Measured on the pools: scanning the whole text of the 2.135 mixed
        # rows finds 15 assistant-voice closers and scanning only the AI spans finds 1 —
        # the other 14 are Stack Overflow answers that genuinely end "espero ter ajudado",
        # so the human half would have decided the lane's verdict.
        human_half = "Use o modificador protected nesse caso. Espero ter ajudado. "
        ai_half = self._clean(9)
        text = human_half + ai_half
        record = self._generated_record(
            1,
            text,
            mixture={
                "spans": [
                    {"start": 0, "end": len(human_half), "origin": "human"},
                    {"start": len(human_half), "end": len(text), "origin": "ai"},
                ]
            },
        )
        report = artifact_gate.measure(artifact_gate.generated_lines([record]))
        self.assertEqual(report["families"][0]["contaminated"], 0)
        # Without the span restriction the same row reads as contaminated, which is what
        # makes the restriction load-bearing rather than tidy.
        self.assertIn(
            artifact_gate.DETECTION_METACONVERSATION,
            artifact_gate.detections_in(text),
        )

    def test_a_mixed_row_counts_once_however_many_ai_spans_it_has(self) -> None:
        import artifact_gate

        # The denominator is RECORDS: a row cut into ten generated stretches must not
        # outvote ten rows, in either direction.
        meta = "Aqui está o texto: "
        text = meta + self._clean(10)
        spans = [{"start": 0, "end": len(meta), "origin": "ai"}] + [
            {"start": len(meta), "end": len(text), "origin": "ai"}
        ]
        report = artifact_gate.measure(
            artifact_gate.generated_lines(
                [self._generated_record(2, text, mixture={"spans": spans})]
            )
        )
        entry = report["families"][0]
        self.assertEqual((entry["lines"], entry["contaminated"]), (1, 1))

    def test_a_human_record_is_not_scanned_at_all(self) -> None:
        import artifact_gate

        human = {
            "id": "rec_human",
            "text": "Espero ter ajudado. " + self._clean(11),
            "provenance": {"sourceKind": "licensed-corpus"},
            "groups": {},
        }
        self.assertEqual(artifact_gate.generated_lines([human]), [])

    def test_a_generated_row_whose_family_is_unreadable_stops_the_run(self) -> None:
        import artifact_gate
        from group_axes import unknown

        # Fail-closed and NOT skipped: a family the gate cannot name is a family whose
        # fraction goes unmeasured, and the gate's entire output is a per-family fraction.
        record = self._generated_record(3, self._clean(12))
        record["groups"]["generatorFamily"] = unknown("the pool recorded no family")
        with self.assertRaises(artifact_gate.LineNotAttributable) as caught:
            artifact_gate.generated_lines([record])
        message = str(caught.exception)
        self.assertIn("rec_00003", message)
        self.assertIn("generatorFamily", message)

    def test_the_probes_are_the_generators_own_constants(self) -> None:
        import artifact_gate
        import generate_ai

        # "The output repeats the prompt" means the prompts THIS repository issues, so the
        # echo probes are derived from the recipe templates rather than guessed. A recipe
        # added to `generate_ai` without a probe of its own would be an echo nobody looks
        # for, so what is asserted is the DERIVATION and not the resulting list: read over
        # `ECHO_PROBES` this passes on the hand-written directive labels alone, because
        # "responda apenas com" happens to sit in all four templates.
        derived = artifact_gate._echo_probes_from_templates()
        self.assertNotEqual(derived, {})
        for spec in generate_ai.RECIPES.values():
            instruction = str(spec["template"]).split("{reference}")[0]
            folded = artifact_gate.fold(instruction)
            contributed = [label for label in derived if label in folded]
            self.assertNotEqual(contributed, [], spec["template"][:40])
            # And every derived label is reachable through the mapping the gate runs, so a
            # derivation whose output the merge drops is not a passing state either.
            for label in contributed:
                self.assertIn(label, artifact_gate.ECHO_PROBES, label)
        # Same for the harness banners: one list, two readers, and only one of the four
        # lanes strips them before writing.
        for prefix in generate_ai.CLI_BANNER_PREFIXES:
            found = artifact_gate.detections_in(f"{prefix} something\n" + self._clean(13))
            self.assertIn(artifact_gate.DETECTION_HARNESS_SIGNATURE, found, prefix)

    def test_the_banner_filter_of_the_gemini_lane_reads_the_same_list(self) -> None:
        import generate_ai

        # `GEMINI_NOISE` is COMPILED from `CLI_BANNER_PREFIXES` so the lane that strips
        # banners and the gate that detects them cannot know different lists. Asserted at
        # the pattern and not at the constant, because what the lane does is filter: a
        # prefix dropped from the tuple would silently start reaching the pool as text.
        for prefix in generate_ai.CLI_BANNER_PREFIXES:
            self.assertIsNotNone(
                generate_ai.GEMINI_NOISE.match(f"  {prefix} rest of the line"), prefix
            )
            self.assertIsNotNone(
                generate_ai.GEMINI_NOISE.match(prefix.upper()), prefix
            )
        # And it is anchored: the same words inside a sentence are not a banner.
        self.assertIsNone(
            generate_ai.GEMINI_NOISE.match(
                "A pesquisa mostrou que Data collection e um problema"
            )
        )

    def test_the_ceiling_is_a_constant_and_the_sealed_policy_carries_no_field_for_it(
        self,
    ) -> None:
        import artifact_gate

        # The threshold reads from a constant BECAUSE the frozen pre-registration has no
        # field for it, and adding one would be a change of policy rather than a reading of
        # one. This is the assertion that makes the choice re-derivable: the day the policy
        # gains the field, this test is what says so.
        policy = frozen_policy()
        flat = json.dumps(policy)
        for absent in ("contamination", "artifactCeiling", "antiArtifact"):
            self.assertNotIn(absent, flat)
        self.assertEqual(
            artifact_gate.measure([])["ceilingSource"],
            "constant:artifact_gate.CONTAMINATION_CEILING",
        )
