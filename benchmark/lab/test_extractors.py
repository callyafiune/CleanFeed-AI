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
import extract_carolina as extract_carolina_module
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

# A run id in the SHAPE the extractors emit — module, material version, digest of the
# extractor's own bytes. A literal and never the real digest of the file on disk: the
# digest covers `extract_wikipedia.py` itself, so an expectation computed here would move
# with every edit of that module. A fixture only stands in for what some extractor
# stamped, and the assembler cannot tell one token from another anyway
# (`test_the_assembler_cannot_tell_a_hand_written_run_from_a_derived_one`).
FIXTURE_EXTRACTION_RUN = "er_extract_wikipedia_ptwiki-20220301_0f1e2d3c4b5a"

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


def receita_da_tarefa(tarefa: str) -> str:
    """A primeira receita do slate cuja tarefa e esta.

    Os fixtures pedem a receita pela TAREFA e nao pelo nome: o slate e particionado por
    ilha, entao `pt-ilha-05-a` nao diz que tarefa e, e um nome digitado aqui envelheceria na
    primeira vez que a atribuicao do plano mudasse. O que estes fixtures precisam distinguir
    e uma tarefa que escreve texto novo de uma que REESCREVE o pai, porque so a segunda faz
    a linha ser derivacao.
    """
    import generate_ai

    return next(
        nome
        for nome, spec in sorted(generate_ai.RECIPES.items())
        if spec["task"] == tarefa
    )


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


@contextlib.contextmanager
def readmitted_typologies(*typologies: str):
    """Stands in for an amendment that puts `typologies` back in the declared frame.

    The Carolina extractor refuses every run since the frame amendment, so the tests that
    measure HOW it reads a TEI package — the per-typology cap, the licence allowlist, the
    download-date cutoff, the axes it emits, the candidate ids it builds — have to say
    which future frame they are reading under. It patches the FRAME and nothing else: no
    licence, no cutoff and no axis is muted by it, so a refusal the extractor owes still
    fires inside the block.
    """
    original = extract_carolina_module.FRAME_TYPOLOGIES
    extract_carolina_module.FRAME_TYPOLOGIES = typologies
    try:
        yield
    finally:
        extract_carolina_module.FRAME_TYPOLOGIES = original


class CarolinaTests(unittest.TestCase):
    """The Carolina extractor AFTER the frame amendment: kept, and refusing.

    The declared frame draws on no typology of this package (`FRAME_TYPOLOGIES` is
    empty), so every run refuses. The tests split in two:

      * the REFUSAL tests run against the shipped frame, which is the state of the tree;
      * the READING tests (per-typology cap, licence and date filters) run under
        `readmitted`, which patches `FRAME_TYPOLOGIES` to stand in for a future amendment.
        They are what makes "kept, not deleted" worth anything: the reason the module
        survives is that re-admitting the base must cost an amendment and not a
        rediscovery of how to read a TEI package, and an unread module rots. The patch
        moves the FRAME, never the licence allowlist or the date cutoff, so no refusal
        the extractor owes is muted by it.
    """

    def readmitted(self, *typologies: str):
        return readmitted_typologies(*typologies)

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
            with self.readmitted("university_domains", "social_media"):
                rows, _ = run_writer(
                    tmp,
                    "carolina_bal",
                    lambda w: extract_carolina(
                        archive,
                        w,
                        per_typology_limit=2,
                        snapshot_version=CAROLINA_SNAPSHOT_VERSION,
                        typologies=("university_domains", "social_media"),
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
            with self.readmitted("social_media"):
                rows, stats = run_writer(
                    tmp, "carolina", lambda w: extract_carolina(
                        archive,
                        w,
                        snapshot_version=CAROLINA_SNAPSHOT_VERSION,
                        typologies=("social_media",),
                    ),
                )
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["licenseId"], "cc-by-nc-sa-4.0")
        self.assertEqual(rows[0]["domainSource"], "carolina_social_media")
        self.assertEqual(stats["drop_license"], 1)
        self.assertEqual(stats["drop_date"], 1)

    def test_the_whole_package_is_out_of_frame_and_the_run_refuses_before_opening_it(
        self,
    ) -> None:
        """The frame amendment, at the entry point.

        `FRAME_TYPOLOGIES` is empty, so a run refuses instead of finishing empty — a
        3,1 GB pass that writes zero rows reads as a bad archive, and the operator goes
        looking for the file instead of reading the frame. The refusal is what carries the
        reason.

        The archive path does NOT exist, and that is the assertion about ordering:
        `zipfile.ZipFile` would raise `FileNotFoundError`, so `CarolinaOutOfFrame`
        proves nothing was opened.
        """
        import extract_carolina

        self.assertEqual(extract_carolina.FRAME_TYPOLOGIES, ())
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            missing = tmp / "never-opened.zip"
            with self.assertRaises(extract_carolina.CarolinaOutOfFrame) as caught:
                run_writer(
                    tmp, "carolina_out", lambda w: extract_carolina.extract(
                        missing, w, snapshot_version=CAROLINA_SNAPSHOT_VERSION
                    ),
                )
            self.assertFalse(missing.exists())
        message = str(caught.exception)
        # Every typology of the package is named with its reason, and the three that used
        # to be in the frame carry the MEASUREMENT that took them out.
        for typology in extract_carolina.OUT_OF_FRAME_TYPOLOGIES:
            self.assertIn(typology, message)
        self.assertIn("stf.jus.br", message)
        self.assertIn("jornal.usp.br", message)
        self.assertIn("wattpad.com", message)
        self.assertIn("104 authors", message)
        # And what it would take to come back, which is not a flag.
        self.assertIn("preRegistration.quotaAxis.cells", message)
        self.assertIn("multiplicity.primaryFamily", message)

    def test_every_typology_name_is_refused_on_the_way_in(self) -> None:
        import extract_carolina

        # With an empty frame `--typologies` has no admissible value at all, and the three
        # names that were in frame until the amendment are refused with the measurement
        # that removed them — not with a generic "not in the list".
        measured = {
            "judicial_branch": "stf.jus.br",
            "university_domains": "jornal.usp.br",
            "social_media": "wattpad.com",
        }
        for typology, evidence in measured.items():
            with self.assertRaises(argparse.ArgumentTypeError) as caught:
                extract_carolina.selected_typologies(typology)
            message = str(caught.exception)
            self.assertIn(typology, message)
            self.assertIn(evidence, message)
            self.assertIn("amendment of the frame", message)
        # The typologies that were never in frame are still refused with their own reason.
        with self.assertRaises(argparse.ArgumentTypeError) as caught:
            extract_carolina.selected_typologies("legislative_branch")
        self.assertIn("outside the sampling frame", str(caught.exception))

    def test_the_function_refuses_an_out_of_frame_typology_handed_to_it_directly(
        self,
    ) -> None:
        import extract_carolina

        # The argparse type is not the only door: `extract` takes `typologies`, so the
        # frame is checked there too. Without this, the command line would be the only
        # thing between an out-of-frame typology and a pool file no cell counts.
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            with self.assertRaises(extract_carolina.CarolinaOutOfFrame) as caught:
                run_writer(
                    tmp, "carolina_direct", lambda w: extract_carolina.extract(
                        tmp / "never-opened.zip",
                        w,
                        snapshot_version=CAROLINA_SNAPSHOT_VERSION,
                        typologies=("judicial_branch",),
                    ),
                )
        self.assertIn("judicial_branch", str(caught.exception))
        self.assertIn("stf.jus.br", str(caught.exception))

    def test_a_typology_nobody_decided_about_refuses_the_run_by_name(self) -> None:
        import extract_carolina

        # The fail-closed half, exercised under `readmitted` because it can only fire
        # while the frame draws on something: a typology that is neither in the frame nor
        # in the declared exclusions is UNDECIDED, and skipping it silently is the
        # dangerous direction — the releases spell the same typology with spaces and with
        # underscores, so a renamed in-frame directory would yield zero rows for a cell
        # whose FPR ceiling the release publishes, quietly. The guard is what a future
        # re-admission lands on, so it stays measured now.
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
            with self.readmitted("judicial_branch"):
                with self.assertRaises(extract_carolina.TypologyOutOfFrame) as caught:
                    run_writer(
                        tmp, "carolina_undecided", lambda w: extract_carolina.extract(
                            archive,
                            w,
                            snapshot_version=CAROLINA_SNAPSHOT_VERSION,
                            typologies=("judicial_branch",),
                        ),
                    )
        message = str(caught.exception)
        self.assertIn("poetry", message)
        self.assertIn("judicial_branch", message)

    def test_a_typology_outside_the_frame_is_refused_by_the_command_line(self) -> None:
        import subprocess
        import sys

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
                    "judicial_branch",
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
        self.assertIn("judicial_branch", proc.stderr)
        self.assertIn("outside the declared frame", proc.stderr)
        self.assertIn("amendment of the frame", proc.stderr)

    def test_a_default_run_refuses_from_the_command_line_too(self) -> None:
        import subprocess
        import sys

        # No `--typologies` at all: the default is the frame, the frame is empty, and the
        # run has to say so rather than write an empty pool file. A traceback is the
        # honest exit here — the message names every typology and its reason.
        script = Path(__file__).with_name("extract_carolina.py")
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "carolina.jsonl"
            proc = subprocess.run(
                [
                    sys.executable,
                    str(script),
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
        self.assertNotEqual(proc.returncode, 0)
        self.assertIn("CarolinaOutOfFrame", proc.stderr)
        self.assertIn("draws on no Carolina typology", proc.stderr)


class GenerateAiTests(unittest.TestCase):
    def humans(self) -> list[dict]:
        return [
            {"candidateId": f"src_x_{i:06d}", "wordCount": 80, "text": PROSE_60,
             "domainSource": "d"}
            for i in range(1, 41)
        ]

    def test_select_pairs_is_deterministic_and_resume_skips(self) -> None:
        from unittest import mock

        import assemble_corpus

        from generate_ai import select_pairs

        # Um plano de UMA ilha, para o filtro de bloco de semente admitir todo candidato: o
        # que este teste mede e o determinismo e o resume, e um plano de vinte deixaria a
        # amostra pequena demais para o resume ter o que pular. O filtro em si e medido em
        # `test_select_pairs_so_pega_semente_do_bloco_da_ilha`.
        uma = (dict(assemble_corpus.ISLAND_PLAN[0], seedBlock=0),)
        with mock.patch.object(assemble_corpus, "ISLAND_PLAN", uma):
            first = select_pairs(self.humans(), "anthropic", 10, set(), uma[0])
            second = select_pairs(self.humans(), "anthropic", 10, set(), uma[0])
            self.assertEqual(
                [r["candidateId"] for r in first], [r["candidateId"] for r in second]
            )
            done = {first[0]["candidateId"], first[1]["candidateId"]}
            resumed = select_pairs(self.humans(), "anthropic", 10, done, uma[0])
            self.assertFalse(done & {r["candidateId"] for r in resumed})

    def test_select_pairs_so_pega_semente_do_bloco_da_ilha(self) -> None:
        """G3, onde RODA: sem este filtro o particionamento de templates e decorativo.

        Medido nos pools em HEAD: 1046 identidades de semente em 1170 linhas, 116 delas
        emparelhadas por linhas de MAIS DE UMA corrida de versao — e uma uniao-find sobre as
        versoes com so essas arestas funde as cinco corridas numa ilha. Sob o plano, o bloco e
        funcao do id, entao duas ilhas nunca partilham uma semente.
        """
        import assemble_corpus

        from generate_ai import select_pairs

        humanos = [
            {"candidateId": f"src_x_{i:06d}", "wordCount": 80, "text": PROSE_60,
             "domainSource": "d"}
            for i in range(1, 2001)
        ]
        plano = assemble_corpus.ISLAND_PLAN
        escolhidos: dict[str, set[str]] = {}
        for ilha in plano[:3]:
            selecionados = select_pairs(humanos, "agy", 40, set(), ilha)
            # Nao vacuo: cada ilha recebe semente do bloco dela.
            self.assertTrue(selecionados, ilha["island"])
            escolhidos[ilha["island"]] = {r["candidateId"] for r in selecionados}
            for cid in escolhidos[ilha["island"]]:
                self.assertEqual(
                    assemble_corpus.island_of_seed(plano, cid)["island"],
                    ilha["island"],
                )
        # E o cruzamento entre as ilhas e ZERO, que e a condicao que a restricao impoe.
        nomes = list(escolhidos)
        for i, primeira in enumerate(nomes):
            for segunda in nomes[i + 1 :]:
                with self.subTest(par=(primeira, segunda)):
                    self.assertEqual(
                        escolhidos[primeira] & escolhidos[segunda], set()
                    )

    def test_the_slate_is_the_plan_and_the_per_provider_picker_is_gone(self) -> None:
        """Os nomes do slate SAO os do plano, por igualdade, e o picker por provedor saiu.

        A igualdade e o espelho: `generate_ai` nao pode LER o plano no import — o ciclo
        `assemble_corpus` -> `artifact_gate` -> `RECIPES` e real e foi medido —, entao ele
        deriva os nomes da mesma convencao e esta assercao e o que impede as duas de
        divergirem. Pertinencia nao bastaria: um slate com trinta e nove nomes do plano mais
        um alheio passaria.

        E o picker POR PROVEDOR nao existe mais. Ele escolhia entre as receitas em baldes de
        dez, o que sobre um slate de quarenta pesos alcanca so as dez primeiras — e a
        atribuicao tem de ser por ILHA, senao a identidade escrita numa linha vem de fora da
        ilha dela e a particao de template fica decorativa.
        """
        import assemble_corpus
        import generate_ai

        do_plano = sorted(
            nome for ilha in assemble_corpus.ISLAND_PLAN for nome in ilha["templates"]
        )
        self.assertEqual(sorted(generate_ai.RECIPES), do_plano)
        self.assertEqual(len(do_plano), 40)
        self.assertFalse(hasattr(generate_ai, "recipe_for"))
        for nome in generate_ai.RECIPES:
            self.assertEqual(len(generate_ai.template_digest(nome)), 64)

    def test_the_two_recipes_of_one_island_differ_in_BOTH_coordinates(self) -> None:
        """Tarefa E registro, e a razao de serem as duas: uma coordenada so faz variantes.

        Duas receitas que compartilhassem a tarefa seriam o mesmo pedido em dois tons, e o
        digest distinto faria a particao de template parecer modelada quando a dependencia de
        prompt continuaria inteira. Os quarenta pares (tarefa, registro) sao distintos por
        igualdade de contagem, e nenhuma ilha repete coordenada.
        """
        import assemble_corpus
        import generate_ai

        pares = set()
        for ilha in assemble_corpus.ISLAND_PLAN:
            coordenadas = [
                (
                    generate_ai.RECIPES[nome]["task"],
                    generate_ai.RECIPES[nome]["register"],
                )
                for nome in ilha["templates"]
            ]
            with self.subTest(ilha=ilha["island"]):
                (tarefa_a, registro_a), (tarefa_b, registro_b) = coordenadas
                self.assertNotEqual(tarefa_a, tarefa_b)
                self.assertNotEqual(registro_a, registro_b)
            pares.update(coordenadas)
        self.assertEqual(len(pares), 40)
        # Nao vacuo nas duas listas: as oito tarefas e os cinco registros aparecem todos.
        self.assertEqual(
            {tarefa for tarefa, _ in pares}, set(generate_ai.GENERATION_TASKS)
        )
        self.assertEqual(
            {registro for _, registro in pares}, set(generate_ai.GENERATION_REGISTERS)
        )

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
    """D6 — `--provider` admits the lanes this script drives, and refuses on the way IN.

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
        # The reason, not just a rejection — and the reason MOVED when the operator sent
        # the OpenAI families to the core: what the refusal has to say now is that the
        # API is not a lane and that `codex` is the way in. Pinning the word "OOD" here
        # would pin the policy that was reversed.
        self.assertIn("not a lane of the slate", proc.stderr)
        self.assertIn("codex", proc.stderr)
        for lane in ("agy", "codex", "gemini", "gemini_cli"):
            self.assertIn(lane, proc.stderr)

    def test_the_island_whose_templates_the_slate_does_not_serve_is_refused(
        self,
    ) -> None:
        """A guarda que cobra o slate, medida sob um slate CURTO em vez de contra o de hoje.

        O slate de producao cumpre o plano, entao a recusa nao tem mais entrada natural: o
        que a alcanca e um slate a que falta UM nome. A recusa nomeia o que falta e diz o que
        fazer, porque quem a le esta a decidir se cresce o slate ou emenda o plano — e ela
        acontece no `type=` do argparse, antes do arquivo de sementes, do lock e da primeira
        chamada de provedor.
        """
        import argparse
        from unittest import mock

        import assemble_corpus
        import generate_ai

        faltante = assemble_corpus.ISLAND_PLAN[0]["templates"][1]
        curto = {
            nome: spec
            for nome, spec in generate_ai.RECIPES.items()
            if nome != faltante
        }
        with mock.patch.object(generate_ai, "RECIPES", curto):
            with self.assertRaises(argparse.ArgumentTypeError) as ctx:
                generate_ai.island_plan("ilha_00")
        mensagem = str(ctx.exception)
        self.assertIn(faltante, mensagem)
        self.assertIn("Cresca `RECIPES`", mensagem)
        # E o slate INTEIRO nao recusa a mesma ilha: sem isto a assercao acima passaria
        # tambem se a guarda recusasse toda ilha, que era o estado anterior a esta unidade.
        self.assertEqual(
            generate_ai.island_plan("ilha_00")["island"], "ilha_00"
        )
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
                generate_ai.call_provider(provider, "m", "prompt", None, {}, 120)
            self.assertIn("outside the frozen slate", str(caught.exception))
        # Each reason names the lane that IS the way in, because that is the part a
        # caller can act on: `codex` for the OpenAI families, and — for Anthropic — the
        # fact that no lane carries Claude Code yet, so `agy` is no longer the answer.
        self.assertIn("codex", generate_ai.OUT_OF_SLATE_PROVIDERS["openai"])
        anthropic = generate_ai.OUT_OF_SLATE_PROVIDERS["anthropic"]
        self.assertIn("Claude Code", anthropic)
        self.assertNotIn("generated through the `agy` lane", anthropic)
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
        """Os chunks sao de UMA receita, e a receita e da ILHA e nao do slate inteiro.

        A chave passou de provedor para ILHA porque esta lane grava `promptTemplate`, que e
        eixo de UNIAO: um chunk montado do slate inteiro poria numa linha desta ilha um
        template de outra, e as duas ilhas viram uma no grafo.
        """
        import assemble_corpus

        from codex_batch import chunk_pairs
        from generate_ai import RECIPES, recipe_for_island

        ilha = dict(
            assemble_corpus.ISLAND_PLAN[0], templates=tuple(sorted(RECIPES))[:2]
        )
        # Somente as sementes DO BLOCO da ilha: `recipe_for_island` recusa as outras, e essa
        # recusa e o que faz o particionamento de templates valer alguma coisa.
        pairs = [
            {"candidateId": cid, "wordCount": 100, "text": PROSE_60}
            for cid in (f"src_x_{i:06d}" for i in range(2000))
            if assemble_corpus.island_of_seed(assemble_corpus.ISLAND_PLAN, cid)["island"]
            == ilha["island"]
        ]
        # Nao vacuo: o bloco da ilha recebe sementes, e mais de um chunk sai delas.
        self.assertGreater(len(pairs), 40)
        chunks = chunk_pairs(pairs, ilha, 20)
        total = sum(len(rows) for _, rows in chunks)
        self.assertEqual(total, len(pairs))
        self.assertGreater(len(chunks), 1)
        for recipe, rows in chunks:
            self.assertLessEqual(len(rows), 20)
            # A receita do chunk e DA ILHA, e nao uma qualquer do slate.
            self.assertIn(recipe, ilha["templates"])
            for row in rows:
                self.assertEqual(recipe_for_island(ilha, row["candidateId"]), recipe)


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
                 "meta": {"pairedWith": f"src_h_{i:04d}", "family": "f", "recipe": receita_da_tarefa("original")}}
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
            with readmitted_typologies("university_domains"):
                rows, _ = run_writer(
                    Path(raw), "carolina", lambda w: extract_carolina.extract(
                        path,
                        w,
                        snapshot_version=CAROLINA_SNAPSHOT_VERSION,
                        typologies=("university_domains",),
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

    def test_the_wikipedia_command_line_refuses_a_run_without_the_flag(self) -> None:
        # Driven as a subprocess because the unit test above proves the FUNCTION: with
        # `required=True` dropped, argparse passes `None` and the run dies on
        # `None.strip()` instead of naming the flag, and the unit test stays green
        # because it never goes through argparse.
        import subprocess
        import sys

        script = Path(__file__).with_name("extract_wikipedia.py")
        with tempfile.TemporaryDirectory() as raw:
            output = Path(raw) / "wikipedia.jsonl"
            dump = Path(raw) / "ptwiki.xml.bz2"
            dump.write_bytes(bz2.compress(b"<mediawiki/>"))
            proc = subprocess.run(
                [
                    sys.executable,
                    str(script),
                    "--input",
                    str(dump),
                    "--output",
                    str(output),
                ],
                capture_output=True,
                text=True,
            )
            # Nothing opened and nothing written: argparse exits before `main` builds
            # the writer, which is what creates the output file.
            self.assertFalse(output.exists())
        self.assertEqual(proc.returncode, 2, proc.stderr)
        self.assertIn("--snapshot-version", proc.stderr)

    # A batch DECLARATION, as opposed to a read of one. `build_governance.ts` mentions
    # `batchId` twice and only one is a declaration: the other is `batch.batchId` inside a
    # template string in the refusal message, and a counter keyed on the bare name reports
    # two declarations for one declared batch.
    _BATCH_DECLARATION = re.compile(r'batchId\s*:\s*"')

    @classmethod
    def _declared_material_batch_literals(
        cls, source: str | None = None
    ) -> tuple[list[str], list[str]]:
        """The top-level object literals of `DECLARED_MATERIAL_BATCHES`, and what went wrong.

        Reading TypeScript as text is the only cross-language route a stdlib test has, and
        the trap is that a LAYOUT-shaped regex is fail-open: a batch whose fields are
        written in another order, or with a comment between them, matches nothing and the
        caller's loop never sees it. So the array literal is split on brace depth — one
        slice per object, field order irrelevant, and a comment irrelevant AS LONG AS its
        braces are balanced.

        The splitter has NO notion of a string or of a comment, and cannot have one without
        a parser. So a `{`, `}` or `]` inside either corrupts the count: the scan can end
        early and drop every object after it, or never close the last slice, in both cases
        yielding well-formed slices for a source that declares more batches than it
        returned. The problems this returns exist to make that corruption LOUD instead —
        they are what the caller asserts on before it trusts the slices, and one of them
        counts the declarations the source makes independently of the split.

        `source` is a parameter so the caller's per-batch loop can be exercised against more
        than the one batch production declares; the default reads the real module.
        """
        if source is None:
            source = (
                Path(__file__)
                .with_name("build_governance.ts")
                .read_text(encoding="utf-8")
            )
        # From the first `{` after the declaration, NOT from the first `[`: the annotation
        # `readonly SourceMaterialBatchV1[]` puts an empty pair of brackets between the name
        # and the array literal, and walking from there ends the scan before it starts.
        opened = source.index("{", source.index("DECLARED_MATERIAL_BATCHES"))
        tail = source[opened:]
        literals: list[str] = []
        current: list[str] = []
        problems: list[str] = []
        depth = 0
        scanned = len(tail)
        terminated = False
        for offset, char in enumerate(tail):
            if char == "{":
                depth += 1
            if depth > 0:
                current.append(char)
            if char == "}":
                depth -= 1
                if depth < 0:
                    problems.append(
                        "brace depth went negative: a `}` outside any object closed one "
                        "that was never opened"
                    )
                    scanned = offset + 1
                    break
                if depth == 0:
                    literals.append("".join(current))
                    current = []
            elif depth == 0 and char == "]":
                scanned = offset + 1
                terminated = True
                break
        if not terminated and not problems:
            problems.append(
                "the scan ran off the end without reaching the array's `]`"
            )
        # Never the only problem reported — termination requires depth 0, so a non-zero
        # depth always arrives with the negative-depth or the ran-off-the-end problem. It
        # says WHERE the scan died, and the cases below pin it there rather than leaving an
        # invariant no mutation can kill.
        if depth != 0 or current:
            problems.append(
                f"the scan ended at brace depth {depth}"
                + (" with an object still open" if current else "")
            )
        region = tail[:scanned]
        inside = len(cls._BATCH_DECLARATION.findall(region))
        outside = len(cls._BATCH_DECLARATION.findall(source)) - inside
        if outside:
            problems.append(f"{outside} declared batch(es) lie outside the scan")
        if inside != len(literals):
            problems.append(
                f"{inside} batch declaration(s) inside the scan against "
                f"{len(literals)} slice(s)"
            )
        return literals, problems

    @staticmethod
    def _material_batch_derivation_violations(literals: list[str]) -> list[str]:
        """Per declared batch: the three fields this comparison needs, and the derived id.

        Extracted from the caller so the loop can be run over a list with more than one
        entry — production declares exactly one batch, and against one entry no restriction
        of the loop can be told from the loop.
        """
        from group_axes import material_batch_id

        violations: list[str] = []
        for literal in literals:
            fields = dict(
                re.findall(
                    r'\b(batchId|sourceId|materialVersion)\s*:\s*"([^"]+)"', literal
                )
            )
            if sorted(fields) != ["batchId", "materialVersion", "sourceId"]:
                violations.append(
                    "a declared batch is missing a field this test compares: "
                    f"{sorted(fields)}"
                )
                continue
            derived = material_batch_id(fields["materialVersion"])
            if fields["batchId"] != derived:
                violations.append(
                    f'batchId "{fields["batchId"]}" is not the id '
                    f'"{fields["materialVersion"]}" derives ({derived})'
                )
        return violations

    def test_the_declared_inventory_names_the_batch_the_extractor_stamps(self) -> None:
        """The reviewed manifest's inventory and the extractor's stamp are one id.

        `build_governance.ts` DECLARES the acquisition (version, window, evidence) and
        `extract_wikipedia` STAMPS a batch id derived from `--snapshot-version`; the two
        are written in different languages and compared by nothing at runtime, so a
        drifted spelling blocks every human row with SOURCE_REFERENCE_MISSING after a
        full extraction.

        The invariant asserted is per batch and not per source, so READMITTING a source
        (another dump, another corpus) stays green as long as its id derives from its own
        `materialVersion` — the drift this catches is the derivation, not the roster.
        """
        literals, problems = self._declared_material_batch_literals()
        self.assertEqual(problems, [], "the declaration scan does not hold together")
        self.assertTrue(literals, "no declared material batch found to compare")
        self.assertEqual(self._material_batch_derivation_violations(literals), [])
        wikipedia = [
            literal
            for literal in literals
            if f'sourceId: "{extract_wikipedia.SOURCE_ID}"' in literal
        ]
        self.assertEqual(
            len(wikipedia),
            1,
            "exactly one declared acquisition names the Wikipedia source: the cell has "
            "one dump, and two entries for it would make the row's batch ambiguous",
        )

    @staticmethod
    def _material_batch_source(*chunks: str) -> str:
        """A `build_governance.ts`-shaped declaration around the given chunks.

        Chunks go in verbatim so a case can place text BETWEEN two objects, which is where
        one of the two silent losses lives: at brace depth 0, where a stray `]` ends the
        scan instead of being swallowed by an object.
        """
        return (
            "export const DECLARED_MATERIAL_BATCHES: "
            "readonly SourceMaterialBatchV1[] = [\n" + "".join(chunks) + "];\n"
            'const message = `batch ${batch.batchId} names "${batch.sourceId}"`;\n'
        )

    @staticmethod
    def _clean_batch(token: str, inner: str = "") -> str:
        return (
            "  {"
            + inner
            + f'\n    batchId: "smb_{token}",'
            + f'\n    sourceId: "src_{token}",'
            + f'\n    materialVersion: "{token}",'
            + "\n  },\n"
        )

    def test_the_batch_splitter_reports_the_corruption_a_comment_can_cause(self) -> None:
        """The two silent losses, and the three shapes that stay legitimate.

        Both silent cases yield well-formed slices for a source that declares two batches,
        and every per-batch assertion the caller makes passes over them: the batch that
        drifted is simply not among the slices. What catches them is not a stronger split —
        brace depth cannot see a comment — but counting the declarations the source makes
        against the ones the scan reached.
        """
        clean_two = self._material_batch_source(
            self._clean_batch("b-1"), self._clean_batch("b-2")
        )
        literals, problems = self._declared_material_batch_literals(clean_two)
        self.assertEqual(problems, [])
        self.assertEqual(len(literals), 2)
        self.assertEqual(self._material_batch_derivation_violations(literals), [])

        reordered = self._material_batch_source(
            '  {\n    materialVersion: "b-1",\n    sourceId: "src_b-1",'
            '\n    batchId: "smb_b-1",\n  },\n'
        )
        literals, problems = self._declared_material_batch_literals(reordered)
        self.assertEqual(problems, [])
        self.assertEqual(self._material_batch_derivation_violations(literals), [])

        # A comment whose braces BALANCE stays irrelevant, which is the part of the
        # docstring's promise the mechanism really keeps.
        commented = self._material_batch_source(
            self._clean_batch("b-1", "\n    // shape: { startedAt, endedAt }")
        )
        literals, problems = self._declared_material_batch_literals(commented)
        self.assertEqual(problems, [])
        self.assertEqual(len(literals), 1)

        # SILENT A: a `]` in a comment between the objects ends the scan at brace depth 0.
        # The first slice is well formed and the second batch vanishes.
        early_end = self._material_batch_source(
            self._clean_batch("b-1"),
            "  // shape: readonly SourceMaterialBatchV1[]\n",
            self._clean_batch("b-2"),
        )
        literals, problems = self._declared_material_batch_literals(early_end)
        self.assertEqual(len(literals), 1)
        self.assertEqual(self._material_batch_derivation_violations(literals), [])
        self.assertIn("1 declared batch(es) lie outside the scan", problems)

        # SILENT B: an unbalanced `{` in a comment inside the LAST object. The scan never
        # meets the array's `]`, the last slice never closes, the earlier ones pass.
        never_closed = self._material_batch_source(
            self._clean_batch("b-1"),
            self._clean_batch("b-2", "\n    // the window is { startedAt"),
        )
        literals, problems = self._declared_material_batch_literals(never_closed)
        self.assertEqual(len(literals), 1)
        self.assertEqual(self._material_batch_derivation_violations(literals), [])
        self.assertIn(
            "the scan ran off the end without reaching the array's `]`", problems
        )
        self.assertIn("the scan ended at brace depth 1 with an object still open", problems)

        # A `}` inside a STRING closes a slice early and drives depth negative.
        brace_in_string = self._material_batch_source(
            '  {\n    batchId: "smb_b-1",\n    sourceId: "src_b}1",'
            '\n    materialVersion: "b-1",\n  },\n'
        )
        _, problems = self._declared_material_batch_literals(brace_in_string)
        self.assertIn(
            "brace depth went negative: a `}` outside any object closed one that was "
            "never opened",
            problems,
        )
        self.assertIn("the scan ended at brace depth -1", problems)

        # FUSION: an unbalanced `{` in the first object's comment and a matching `}` in the
        # second's put both objects in ONE slice. Depth returns to 0, the `]` terminates the
        # scan, and only the declaration count notices.
        fused = self._material_batch_source(
            self._clean_batch("b-1", "\n    // window: { startedAt"),
            self._clean_batch("b-2", "\n    // ... endedAt }"),
        )
        literals, problems = self._declared_material_batch_literals(fused)
        self.assertEqual(len(literals), 1)
        self.assertIn(
            "2 batch declaration(s) inside the scan against 1 slice(s)", problems
        )

    def test_every_declared_batch_is_compared_not_only_the_first(self) -> None:
        """One declared batch in production, so the loop needs a two-batch source.

        Restricting the derivation loop to the first slice is a no-op against
        `build_governance.ts`; against this source it is the difference between a reported
        drift and a silent one.
        """
        drifted = self._material_batch_source(
            self._clean_batch("b-1"),
            '  {\n    batchId: "smb_DRIFTED",\n    sourceId: "src_b-2",'
            '\n    materialVersion: "b-2",\n  },\n',
        )
        literals, problems = self._declared_material_batch_literals(drifted)
        self.assertEqual(problems, [])
        self.assertEqual(len(literals), 2)
        self.assertEqual(
            self._material_batch_derivation_violations(literals),
            ['batchId "smb_DRIFTED" is not the id "b-2" derives (smb_b-2)'],
        )

    def test_the_batch_declaration_count_skips_a_property_read(self) -> None:
        """`batch.batchId` in a template string is a read, not a declaration.

        The real module carries both spellings, so a counter keyed on the bare name reports
        one declaration too many and the invariant fails on a healthy file. The declaration
        form is what makes the count usable at all.
        """
        source = (
            Path(__file__)
            .with_name("build_governance.ts")
            .read_text(encoding="utf-8")
        )
        self.assertEqual(len(re.findall(r"batchId", source)), 2)
        self.assertEqual(len(self._BATCH_DECLARATION.findall(source)), 1)

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
            with readmitted_typologies("university_domains", "social_media"):
                rows, _ = run_writer(
                    Path(raw), "carolina", lambda w: extract_carolina.extract(
                        path,
                        w,
                        snapshot_version=CAROLINA_SNAPSHOT_VERSION,
                        typologies=("university_domains", "social_media"),
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
            with readmitted_typologies("social_media"):
                with self.assertRaises(ValueError) as caught:
                    run_writer(
                        Path(raw),
                        "carolina",
                        lambda w: extract_carolina.extract(
                            path, w, typologies=("social_media",)
                        ),
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


class ExtractionRunProducerTests(unittest.TestCase):
    """The EXTRACTOR is where `extractionRun` comes from, and nowhere else.

    The axis names the execution that OPENED the material, so only that execution can name
    itself. The layer that reads a pool afterwards knows a FILE NAME, and a file is not an
    execution: `CandidateWriter` takes `append=True`/`start_sequence`, so one pool file can
    hold the lines of more than one run. `assemble_corpus.human_record` refuses a human
    candidate that names no run, and that refusal only means something if something
    asserts the PRODUCER — otherwise the id is whatever the last layer to touch the row
    made up, which is the defect this class exists to keep out.
    """

    @staticmethod
    def _expected_run_id(module_name: str, snapshot_version: str) -> str:
        """The formula, recomputed here from the module on disk.

        RECOMPUTED and never pinned as a literal, because of what the id is: the digest
        covers the extractor's own bytes, so every edit of that module moves it and a hex
        constant here would be a test that breaks on a comment. It is also the mirror
        between the two copies of the formula — `group_axes.py` belongs to another unit, so
        each extractor carries its own expression, and this is what makes them drift into a
        failure instead of into two spellings.
        """
        import hashlib

        from group_axes import axis_token

        module = Path(__file__).with_name(f"{module_name}.py")
        digest = hashlib.sha256(module.read_bytes()).hexdigest()[:12]
        return f"er_{module_name}_{axis_token(snapshot_version)}_{digest}"

    @staticmethod
    def _two_page_dump(path: Path) -> None:
        """A dump with TWO articles, which is the minimum this axis can be measured on.

        The stamp lives inside the `iterparse` loop, so a one-page fixture cannot tell a
        stamp written for every page from one written for the first page it saw.
        """
        pages = "".join(
            "<page><title>T</title><ns>0</ns>"
            f"<id>{page_id}</id><revision>"
            "<timestamp>2021-05-01T00:00:00Z</timestamp>"
            f"<text>{PROSE_60}</text>"
            "</revision></page>"
            for page_id in (4101, 4102)
        )
        path.write_bytes(
            bz2.compress(
                (
                    '<mediawiki xmlns="http://www.mediawiki.org/xml/export-0.10/">'
                    f"{pages}</mediawiki>"
                ).encode("utf-8")
            )
        )

    def _wikipedia_rows(self, tmp: Path, name: str = "wiki") -> list[dict]:
        path = tmp / "ptwiki.xml.bz2"
        if not path.exists():
            self._two_page_dump(path)
        rows, _ = run_writer(
            tmp,
            name,
            lambda w: extract_wikipedia.extract(
                path, w, snapshot_version=WIKI_SNAPSHOT_VERSION
            ),
        )
        return rows

    def test_wikipedia_names_the_run_that_wrote_every_candidate(self) -> None:
        with tempfile.TemporaryDirectory() as raw:
            rows = self._wikipedia_rows(Path(raw))
        # BOTH pages, not just the first: the assertion is over every line the run wrote,
        # which is the only form that says anything about the loop.
        self.assertEqual(len(rows), 2)
        expected = self._expected_run_id("extract_wikipedia", WIKI_SNAPSHOT_VERSION)
        self.assertEqual(
            [r["meta"]["extractionRun"] for r in rows], [expected, expected]
        )
        # ...and the two lines really are two different candidates, so the equality above
        # is a statement about a loop and not about one row counted twice.
        self.assertEqual(len({r["candidateId"] for r in rows}), 2)

    def test_carolina_names_the_run_on_every_typology_of_one_download(self) -> None:
        import extract_carolina

        # TWO <TEI> documents per member and TWO members, so the fixture crosses both
        # levels of the nested loop: a stamp restricted to the first document of a member,
        # or to the first typology of the package, leaves fewer than four stamped lines.
        tei = (
            '<teiCorpus xmlns="http://www.tei-c.org/ns/1.0">'
            + 2
            * (
                "<TEI><teiHeader><fileDesc><publicationStmt>"
                '<date type="Download">2021-05-21</date>'
                "<availability><licence>CC BY-NC-SA 4.0</licence></availability>"
                "</publicationStmt></fileDesc></teiHeader>"
                f"<text><body><p>{PROSE_60}</p></body></text></TEI>"
            )
            + "</teiCorpus>"
        )
        with tempfile.TemporaryDirectory() as raw:
            path = Path(raw) / "archive.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Corpus/university domains/uni.xml", tei)
                archive.writestr("Corpus/social media/soc.xml", tei)
            with readmitted_typologies("university_domains", "social_media"):
                rows, _ = run_writer(
                    Path(raw),
                    "carolina",
                    lambda w: extract_carolina.extract(
                        path,
                        w,
                        snapshot_version=CAROLINA_SNAPSHOT_VERSION,
                        typologies=("university_domains", "social_media"),
                    ),
                )
        self.assertEqual(len(rows), 4)
        self.assertEqual(len({r["domainSource"] for r in rows}), 2)
        self.assertEqual(len({r["candidateId"] for r in rows}), 4)
        # ONE run over the four lines: the typologies partition a single execution over a
        # single download, exactly as they partition a single acquisition event.
        expected = self._expected_run_id("extract_carolina", CAROLINA_SNAPSHOT_VERSION)
        self.assertEqual({r["meta"]["extractionRun"] for r in rows}, {expected})

    def test_the_run_names_the_material_version_its_batch_names(self) -> None:
        """An execution cannot name itself without naming the material it read.

        Not a second emptiness check — `group_axes.material_batch_id` already refuses a run
        whose acquisition has no name, and a second authority over the same fact is how two
        spellings of one rule start disagreeing. What is asserted is the RELATION on the
        emitted line: the version inside the batch id is inside the run id of the same row.
        """
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
            tmp = Path(raw)
            emitted = list(self._wikipedia_rows(tmp))
            path = tmp / "archive.zip"
            with zipfile.ZipFile(path, "w") as archive:
                archive.writestr("Corpus/social media/soc.xml", tei)
            with readmitted_typologies("social_media"):
                carolina, _ = run_writer(
                    tmp,
                    "carolina",
                    lambda w: extract_carolina.extract(
                        path,
                        w,
                        snapshot_version=CAROLINA_SNAPSHOT_VERSION,
                        typologies=("social_media",),
                    ),
                )
            emitted += carolina
        self.assertEqual(len(emitted), 3)
        for row in emitted:
            with self.subTest(candidate=row["candidateId"]):
                version = row["meta"]["sourceMaterialBatch"].removeprefix("smb_")
                self.assertTrue(version)
                self.assertIn(version, row["meta"]["extractionRun"])
        # The two versions are DIFFERENT strings, so the loop above is not one fixture
        # measured twice: `carolina-v2.0` also exercises the tokenisation, since the
        # material version is not a pseudonym until `axis_token` runs over it.
        self.assertEqual(
            {r["meta"]["sourceMaterialBatch"] for r in emitted},
            {"smb_ptwiki-20220301", "smb_carolina-v2_0"},
        )

    def test_the_pool_file_name_is_not_the_run(self) -> None:
        """The criterion in POSITIVE form: one execution, two output names, one run id.

        The defect this replaces read the run off the pool file (`extraction_{fname}`), so
        it is the assertion that any route back to the file name fails — the id derived
        from `writer.output`, from the source id, from the stem plus a prefix.
        """
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            first = self._wikipedia_rows(tmp, "wikipedia_fresh")
            second = self._wikipedia_rows(tmp, "outro_nome_de_pool")
        self.assertEqual(
            first[0]["meta"]["extractionRun"], second[0]["meta"]["extractionRun"]
        )
        for name in ("wikipedia_fresh", "outro_nome_de_pool"):
            self.assertNotIn(name, first[0]["meta"]["extractionRun"])
        # ...and the two runs really did write different pools, so the equality is about
        # the id and not about one file read twice.
        self.assertNotEqual(
            first[0]["candidateId"], second[0]["candidateId"]
        )

    def test_two_runs_over_one_dump_with_different_limits_share_the_run_id(self) -> None:
        """DECLARED RESIDUE, fixed as accepted: the SELECTION parameters are not in the id.

        `--limit`, `--sample-rate` and `--exclude` live in `CandidateWriter` and decide
        which lines a run emits, not which module read which material, so two invocations
        differing only there carry one run id. The axis is diagnostic and the row already
        travels with the writer's own stats file; what would be dishonest is a comment
        claiming the id separates two such invocations.
        """
        ids: list[str] = []
        counts: list[int] = []
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._two_page_dump(tmp / "ptwiki.xml.bz2")
            for tag, limit in (("um", 1), ("dois", 100)):
                output = tmp / f"{tag}.jsonl"
                writer = CandidateWriter(
                    output, source_id=f"src_{tag}", limit=limit, sample_rate=1
                )
                try:
                    extract_wikipedia.extract(
                        tmp / "ptwiki.xml.bz2",
                        writer,
                        snapshot_version=WIKI_SNAPSHOT_VERSION,
                    )
                finally:
                    writer.close()
                rows = [
                    json.loads(line)
                    for line in output.read_text(encoding="utf-8").splitlines()
                ]
                counts.append(len(rows))
                ids.append(rows[0]["meta"]["extractionRun"])
        # The limits really did select differently — otherwise the equality below holds
        # because the two runs are the same run.
        self.assertEqual(counts, [1, 2])
        self.assertEqual(ids[0], ids[1])

    def test_the_run_id_digests_the_extractor_module_and_not_its_imports(self) -> None:
        """DECLARED RESIDUE, fixed as accepted: the digest covers ONE file.

        The id names WHICH extraction module read WHICH version of the material. It does
        not cover `common.py` or `group_axes.py`, so a change in the shared filter pipeline
        leaves both extractors' ids unmoved — which is why no comment may say the id names
        "the code that ran". The two digests are recomputed here rather than described.
        """
        import hashlib

        with tempfile.TemporaryDirectory() as raw:
            rows = self._wikipedia_rows(Path(raw))
        run = rows[0]["meta"]["extractionRun"]
        lab = Path(__file__).resolve().parent
        own = hashlib.sha256(
            (lab / "extract_wikipedia.py").read_bytes()
        ).hexdigest()[:12]
        self.assertIn(own, run)
        for imported in ("common.py", "group_axes.py"):
            other = hashlib.sha256((lab / imported).read_bytes()).hexdigest()[:12]
            self.assertNotIn(other, run, imported)

    def test_the_run_id_survives_the_assembler_that_consumes_it(self) -> None:
        """The producer's spelling is a pseudonym the sealed schema accepts.

        The mould is `test_the_batch_id_survives_the_assembler_that_consumes_it`: the two
        halves are written in different languages and compared by nobody at runtime, so a
        run id the axis validator refuses would only show up after a full assembly run.
        Asserted over the FORMULA for both extractors, and the tests above pin each
        extractor's emitted value to the formula, so the emitted value is covered too.
        """
        from group_axes import known

        for module_name, version in (
            ("extract_wikipedia", WIKI_SNAPSHOT_VERSION),
            ("extract_carolina", CAROLINA_SNAPSHOT_VERSION),
        ):
            with self.subTest(module=module_name):
                run = self._expected_run_id(module_name, version)
                self.assertEqual(known(run), {"state": "known", "id": run})

    def test_an_unstamped_out_of_frame_extractor_is_refused_and_not_silently_admitted(
        self,
    ) -> None:
        """`extract_stackexchange` and `extract_b2w` name no run, and their rows leave.

        Neither module belongs to this unit, so neither stamps, and their pools are
        inexpressible in v4. The measured cost is zero: both sources are already out of the
        declared frame (`A1_BLOCKED_DOMAIN_SOURCES` / `OUT_OF_FRAME_DOMAIN_SOURCES`) and
        `load_humans` opens neither pool file. What this pins is both halves — the emitted
        row really carries no run, and the row really leaves BY NAME rather than being
        admitted with something invented. Which refusal fires first is stated instead of
        implied: today it is the frame, and the run guard is what would catch these rows if
        an amendment ever readmitted the source
        (`test_a_row_naming_no_extraction_run_leaves_the_corpus`).
        """
        import extract_stackexchange
        from assemble_corpus import OutOfFrameDomainSource, human_record

        body = "&lt;p&gt;" + PROSE_60 + "&lt;/p&gt;"
        posts_xml = (
            '<?xml version="1.0" encoding="utf-8"?>\n<posts>\n'
            f'  <row Id="1" PostTypeId="1" CreationDate="2014-05-01T10:00:00.000" '
            f'Body="{body}" />\n'
            "</posts>\n"
        )
        csv_text = (
            "submission_date,review_title,review_text,product_id\n"
            f'2018-03-01 10:00:00,Bom,"{PROSE_60}",p1\n'
        )
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            posts = tmp / "Posts.xml"
            posts.write_text(posts_xml, encoding="utf-8")
            reviews = tmp / "b2w.csv"
            reviews.write_text(csv_text, encoding="utf-8")
            ptso, _ = run_writer(
                tmp,
                "ptso",
                lambda w: extract_stackexchange.extract(
                    posts, w, keyring=FIXTURE_KEYRING
                ),
            )
            b2w, _ = run_writer(
                tmp, "b2w", lambda w: extract_b2w(reviews, w, keyring=FIXTURE_KEYRING)
            )
        for rows in (ptso, b2w):
            with self.subTest(source=rows[0]["domainSource"]):
                self.assertEqual(len(rows), 1)
                self.assertNotIn("extractionRun", rows[0]["meta"])
                with self.assertRaises(OutOfFrameDomainSource):
                    human_record(rows[0], rows[0]["domainSource"], None)


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
            with readmitted_typologies("university_domains"):
                rows, _ = run_writer(
                    Path(raw), "carolina", lambda w: extract_carolina.extract(
                        path,
                        w,
                        snapshot_version=CAROLINA_SNAPSHOT_VERSION,
                        typologies=("university_domains",),
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

    def _human_candidate(self, candidate_id: str, page: str) -> dict:
        """A candidate of the ONE cell, shaped as `extract_wikipedia` emits it.

        Material of the declared frame, because that is the only material the assembler
        accepts: `author` is `notApplicable` with the Wikipedia reason (a lead section is
        the accreted work of many editors), and the cell yields no known author.
        """
        from group_axes import NO_SINGLE_AUTHOR, known, not_applicable

        return {
            "candidateId": candidate_id,
            "text": PROSE_60,
            "wordCount": 60,
            "domainSource": "ptwiki_lead",
            "licenseId": document_license_of("ptwiki_lead"),
            "createdAt": 1621555200000,
            "meta": {
                "dateField": "pages-articles.xml@revision/timestamp",
                "observedValue": "2021-05-21T00:00:00+00:00",
                "groupAxes": {
                    "source": known(page),
                    "author": not_applicable(NO_SINGLE_AUTHOR),
                },
                # The acquisition event and the extraction run, which v4 holds apart:
                # re-reading one dump produces a second run and no second material. Both
                # come from the EXTRACTOR — no layer downstream stamps either — so a
                # fixture without them is a fixture of a row the assembler refuses.
                "sourceMaterialBatch": "smb_ptwiki-20220301",
                "extractionRun": FIXTURE_EXTRACTION_RUN,
            },
        }

    def test_two_records_of_one_page_share_the_source_axis(self) -> None:
        from assemble_corpus import human_record

        first = human_record(
            self._human_candidate("src_wiki_aaa", "ptwiki_page_9042"),
            "ptwiki",
            None,
        )
        second = human_record(
            self._human_candidate("src_wiki_bbb", "ptwiki_page_9042"),
            "ptwiki",
            None,
        )
        self.assertNotEqual(first["id"], second["id"])
        # The point of the whole task: ONE cluster of two on the origin-document axis.
        # The extractor takes one lead section per page, so two rows of one page is a
        # LATER revision of it — which is exactly the dependence the axis exists to state,
        # and the reason the identity is the page and not the row.
        self.assertEqual(first["groups"]["source"], second["groups"]["source"])
        self.assertEqual(first["groups"]["source"]["id"], "ptwiki_page_9042")
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

        # A CONTRACT fixture for the builder, not a claim about the corpus: the declared
        # cell yields no known author (a Wikipedia lede is collective work), so the value
        # below is hypothetical material. What it pins is that the builder carries the axis the
        # extractor wrote instead of re-deriving it — two rows an extractor states share
        # an author have to come out sharing it, because that is the dependence the split
        # unions on.
        candidates = [
            self._human_candidate(f"src_wiki_{tag}", "ptwiki_page_9099")
            for tag in ("ccc", "ddd")
        ]
        for candidate in candidates:
            candidate["meta"]["groupAxes"]["author"] = known("au_hmac_shared")
        first, second = (
            human_record(candidate, "ptwiki", None)
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

        candidate = self._human_candidate("src_wiki_aaa", "ptwiki_page_9042")
        del candidate["meta"]["sourceMaterialBatch"]
        # No eligibility-priced escape exists on this axis: the rule admits only `known`
        # on a human row, so the row is unwritable and leaves. The mutation this catches
        # is the one the dead corpus shipped — key a fallback on the stratum
        # (`extraction_<domainSource>`) so every row of one stratum shares an invented
        # acquisition event. That fallback makes every downstream check pass and resolves
        # against no declared `materialBatches` entry.
        with self.assertRaises(MissingMaterialBatch) as caught:
            human_record(candidate, "ptwiki", None)
        self.assertIn("sourceMaterialBatch", str(caught.exception))
        self.assertIn("src_wiki_aaa", str(caught.exception))

    def test_a_row_naming_no_extraction_run_leaves_the_corpus(self) -> None:
        from assemble_corpus import MissingExtractionRun, human_record

        candidate = self._human_candidate("src_wiki_aaa", "ptwiki_page_9042")
        del candidate["meta"]["extractionRun"]
        # Diagnostic axis, non-negotiable state: `AXIS_STATE_RULE.extractionRun` admits
        # only `known` on a human row, so there is no eligibility-priced escape and the
        # row leaves. Only the execution that OPENED the material can name itself: a
        # value derived from the stratum, or from the pool file the reader happened to
        # open, merges lines written by different executions into one run that never ran.
        with self.assertRaises(MissingExtractionRun) as caught:
            human_record(candidate, "ptwiki", None)
        self.assertIn("extractionRun", str(caught.exception))
        self.assertIn("src_wiki_aaa", str(caught.exception))

    def test_the_assembler_cannot_tell_a_hand_written_run_from_a_derived_one(
        self,
    ) -> None:
        """DECLARED RESIDUE, fixed as accepted: this builder checks EXISTENCE, not origin.

        A pool line edited by hand to carry any token — including the invented
        `extraction_<pool file>` this unit removed — builds a record with that token. What
        the guard closes is that no layer of OURS derives one and that the extractor's id is
        recomputable by a third party; it does NOT close "only an extractor can have written
        this". Nothing resolves the axis against the reviewed manifest — it is a frozen
        DIAGNOSTIC axis, with no analogue of `assertMaterialBatchesResolve` — so there is no
        authority here to check a value against.

        Refusing by prefix (`er_`) or denylisting the old spelling was rejected on purpose:
        it would close one SPELLING while reading as closing the class.
        """
        from assemble_corpus import human_record

        candidate = self._human_candidate("src_wiki_aaa", "ptwiki_page_9042")
        candidate["meta"]["extractionRun"] = "extraction_wikipedia_fresh"
        record = human_record(candidate, "ptwiki", None)
        self.assertEqual(
            record["groups"]["extractionRun"],
            {"state": "known", "id": "extraction_wikipedia_fresh"},
        )

    def test_no_layer_of_ours_derives_an_extraction_run(self) -> None:
        source = (Path(__file__).resolve().parent / "assemble_corpus.py").read_text(
            encoding="utf-8"
        )
        # The other half of the assertion over the loader's ROWS: that one is immune to the
        # spelling, and this one is against reintroduction under a DIFFERENT name. Searched
        # as literals, in the pattern this file already uses for the minted per-record
        # tokens — a derived run is not a value this module may hold in any spelling.
        for derived in ('f"extraction_{', '"extraction_reserved"'):
            self.assertNotIn(derived, source)

    def test_a_reserved_row_invents_no_run_and_still_leaves_on_its_licence(self) -> None:
        """DECLARED RESIDUE, fixed as accepted: the reserved pool leaves on its LICENCE.

        `human_record` checks the document licence before the acquisition event and before
        the run, so the reserved rows — which predate every extractor and carry none of the
        three — are removed by `MissingDocumentLicense` and never by `MissingExtractionRun`.
        The run guard is not what empties that pool, and no message may suggest it is.

        What the loader used to write on these rows was `extraction_reserved`: a name for an
        execution that never ran, on a row that cannot be written anyway.
        """
        import assemble_corpus
        from assemble_corpus import MissingDocumentLicense, human_record, load_humans

        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            (tmp / "candidates").mkdir()
            (tmp / "dataset").mkdir()
            (tmp / "dataset" / "reserved.jsonl").write_text(
                json.dumps(
                    {
                        "id": "res_0001",
                        "text": PROSE_60,
                        "label": 0,
                        "family": "ptwiki_lead",
                    }
                )
                + "\n",
                encoding="utf-8",
            )
            saved = assemble_corpus.DATASET
            try:
                # Read by module constant, so a test that did not redirect it would load
                # the real reserved pool instead of this one row.
                assemble_corpus.DATASET = tmp / "dataset"
                rows = [
                    r
                    for r in load_humans(tmp / "candidates")
                    if r["candidateId"] == "res_0001"
                ]
            finally:
                assemble_corpus.DATASET = saved
        self.assertEqual(len(rows), 1)
        self.assertNotIn("extractionRun", rows[0]["meta"])
        with self.assertRaises(MissingDocumentLicense):
            human_record(rows[0], "ptwiki", None)

    def test_the_loader_stamps_neither_the_run_nor_the_acquisition(self) -> None:
        from assemble_corpus import load_humans

        # Asserted over the ROWS the loader returns, not over its source text: a stamp
        # written under a computed key (`"extraction" + "Run"`, a module constant, a
        # helper called from here) is the same defect and reads nothing like the
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
        meta = rows[0].get("meta") or {}
        # The loader knows WHICH FILE it opened, and a file is not an execution: the writer
        # appends, so one pool file can hold the lines of more than one run. Only the
        # execution that opened the material can name itself, so an unstamped line leaves
        # the loader unstamped and `human_record` refuses it — the count of what has to be
        # re-extracted is the honest outcome, and a name for the file is not.
        self.assertNotIn("extractionRun", meta)
        # It does not know the acquisition event either. A stamp here would invent one lot
        # per pool file — the same invented cluster the per-record token was, one level up
        # — and it would resolve against no declared `materialBatches` entry.
        self.assertNotIn("sourceMaterialBatch", meta)

    def test_a_human_record_states_all_fourteen_axes(self) -> None:
        from assemble_corpus import human_record
        from group_axes import V4_GROUP_AXES

        record = human_record(
            self._human_candidate("src_wiki_aaa", "ptwiki_page_9042"),
            "ptwiki",
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
            {"state": "known", "id": "smb_ptwiki-20220301"},
        )
        self.assertEqual(
            record["groups"]["extractionRun"],
            {"state": "known", "id": FIXTURE_EXTRACTION_RUN},
        )

    def test_an_unknown_axis_is_carried_and_never_synthesized(self) -> None:
        from assemble_corpus import human_record
        from group_axes import unknown

        candidate = self._human_candidate(
            "src_wiki_ccc", "ptwiki_page_9042"
        )
        candidate["meta"]["groupAxes"]["author"] = unknown("conta removida")
        record = human_record(candidate, "ptwiki", None)
        self.assertEqual(record["groups"]["author"]["state"], "unknown")
        self.assertNotIn("id", record["groups"]["author"])


def frozen_policy() -> dict:
    """The live pre-registration, as the lab's own authority reads it."""
    import assemble_corpus

    return json.loads(assemble_corpus.POLICY_PATH.read_text(encoding="utf-8"))


class PolicyLaneReadTests(unittest.TestCase):
    """The lane table is read at IMPORT time, so how it fails is part of the module.

    A bare `KeyError('generationLanes')` surfaces as a crash of whoever imported the
    module — the subprocess the first test below drives, and the assembly run on the
    operator's machine — with nothing saying which file was expected to hold what.
    """

    def test_a_policy_without_lanes_fails_the_import_and_names_the_file(self) -> None:
        import shutil
        import subprocess

        import assemble_corpus

        # A SUBPROCESS over a COPY of the module, because the read happens while the module
        # executes: assigning to `assemble_corpus.POLICY_PATH` reaches the helper and never
        # the module-level statement, and `importlib.reload` recomputes `POLICY_PATH` from
        # the file's own location. The copy sits one directory below the stand-in policy,
        # which is what `POLICY_PATH` resolves to. The policy is the live one MINUS the
        # block, because the module reads `collection` at import time too.
        lab = Path(assemble_corpus.__file__).resolve().parent
        with tempfile.TemporaryDirectory() as tmp:
            copied_lab = Path(tmp) / "lab"
            copied_lab.mkdir()
            shutil.copy2(assemble_corpus.__file__, copied_lab / "assemble_corpus.py")
            sem_lanes = Path(tmp) / "preregistration-v4.json"
            policy = json.loads(
                assemble_corpus.POLICY_PATH.read_bytes().decode("utf-8")
            )
            policy.pop("generationLanes")
            sem_lanes.write_bytes(json.dumps(policy, indent=2).encode("utf-8"))
            done = subprocess.run(
                [
                    sys.executable,
                    "-c",
                    "import sys\n"
                    f"sys.path.insert(0, {str(lab)!r})\n"
                    f"sys.path.insert(0, {str(copied_lab)!r})\n"
                    "import assemble_corpus\n",
                ],
                capture_output=True,
                text=True,
            )
            self.assertEqual(done.returncode, 1, done.stdout)
            self.assertIn("PolicyLanesUnreadable", done.stderr)
            self.assertIn("generationLanes", done.stderr)
            self.assertIn(str(sem_lanes), done.stderr)
            # The frame that says WHERE the read happened: the module-level statement, and
            # not a call this test made.
            self.assertIn("LANE_ROWS = lane_rows()", done.stderr)

    def test_the_import_time_table_is_the_frozen_lane_vocabulary(self) -> None:
        import assemble_corpus

        # Literals, because reading the same file the module reads compares a value against
        # itself and any renamed lane satisfies it. These are the slate's lanes, and
        # `lane_of` refuses every provider outside the table.
        self.assertEqual(
            sorted(assemble_corpus.LANE_ROWS),
            [
                "agy",
                "claude-code",
                "codex",
                "gemini-api",
                "gemini-cli",
                "ollama",
            ],
        )


class DeclaredFrameTests(unittest.TestCase):
    """D0 — the ONE cell of the frame is what the lab collects, and the rest is
    NAMED as outside rather than deleted.

    The frame is `ESTADO.md` § 2: Wikipedia pt, encyclopedic text, and nothing else.
    Stack Overflow is refused on access terms (A1/F0-6), product review has no cell, and
    every Carolina typology — including the three the frame drew on until the amendment -
    is outside the sampling frame.
    """

    def _candidate(self, candidate_id: str, domain_source: str) -> dict:
        from group_axes import NO_SINGLE_AUTHOR, known, not_applicable

        return {
            "candidateId": candidate_id,
            "text": PROSE_60,
            "wordCount": 60,
            "domainSource": domain_source,
            "licenseId": document_license_of(domain_source),
            "meta": {
                "dateField": "pages-articles.xml@revision/timestamp",
                "observedValue": "2021-05-21T00:00:00+00:00",
                "snapshot": "ptwiki",
                "sourceMaterialBatch": "smb_ptwiki-20220301",
                "extractionRun": FIXTURE_EXTRACTION_RUN,
                "groupAxes": {
                    "source": known("ptwiki_page_1"),
                    "author": not_applicable(NO_SINGLE_AUTHOR),
                },
            },
        }

    def test_the_cells_are_the_cells_every_gate_reads(self) -> None:
        import assemble_corpus

        policy = frozen_policy()
        # THE PIN whose absence let the defect through: every list that reaches a
        # record's `humanSourceType` has to hold the SAME strings, and each assertion
        # names the place that disagrees — "the vocabularies differ" is useless without
        # knowing which one moved.
        #
        # `quotaAxis.cells` is what the composition gate tallies over,
        # `multiplicity.primaryFamily` is what the per-cell FPR gate looks its own
        # hypothesis up in (`fpr-<cell>`), `REGISTER` is what the lab WRITES, and
        # `requiredHumanSourceTypes` is what the seal demands. A corpus written in a
        # vocabulary any one of them does not share counts zero lines in the cell and
        # leaves the certifying hypothesis undecided — which is what two spellings of
        # this list did once, with `humanCoreStrata` on one side and the cells on the
        # other.
        cells = set(policy["preRegistration"]["quotaAxis"]["cells"])
        certifying = {
            member.removeprefix("fpr-")
            for member in policy["multiplicity"]["primaryFamily"]
            if member.startswith("fpr-")
        }
        self.assertEqual(
            cells,
            certifying,
            "multiplicity.primaryFamily nao carrega um fpr-<cell> por celula de "
            "preRegistration.quotaAxis.cells",
        )
        self.assertEqual(
            set(assemble_corpus.REGISTER.values()),
            cells,
            "assemble_corpus.REGISTER escreve uma grafia que "
            "preRegistration.quotaAxis.cells nao declara",
        )
        self.assertEqual(
            assemble_corpus.QUOTA_CELLS,
            tuple(sorted(cells)),
            "assemble_corpus.QUOTA_CELLS divergiu de preRegistration.quotaAxis.cells",
        )
        # And QUOTA_CELLS is the DERIVATION over REGISTER, not a list that happens to
        # match it today: with one cell in frame a hand-typed tuple agrees with the
        # derivation, and it stops agreeing the moment REGISTER gains a cell.
        self.assertEqual(
            assemble_corpus.QUOTA_CELLS,
            assemble_corpus.quota_cells_of(assemble_corpus.REGISTER),
            "assemble_corpus.QUOTA_CELLS nao e mais a derivacao de REGISTER",
        )
        # `humanCoreStrata` is the fourth list, and since the frame amendment it holds the
        # SAME single string instead of a second vocabulary. Pinned here so a policy that
        # re-opens the second spelling fails in the test that exists for it.
        self.assertEqual(
            set(policy["humanCoreStrata"]),
            cells,
            "humanCoreStrata voltou a ser uma segunda grafia da mesma lista",
        )
        # And the seal's coverage check reads the SAME field, so its list has to carry
        # the same spelling: requiring another vocabulary would refuse every corpus the
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
        self.assertEqual(
            set(re.findall(r'"([^"]+)"', required.group(1))),
            cells,
            "RELEASE_CORPUS_POLICY.requiredHumanSourceTypes divergiu de "
            "preRegistration.quotaAxis.cells",
        )
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

    def test_the_quota_denominator_follows_the_register_past_one_cell(self) -> None:
        """`quota_cells_of` counts the register's cells, and is measured where it can fail.

        The frame declares one cell, so over the shipped `REGISTER` every wrong
        derivation of the denominator returns the right answer — a hand-typed
        `("ptwiki",)` included. Two registers that the shipped one cannot distinguish
        are what make the derivation falsifiable.
        """
        import assemble_corpus

        self.assertEqual(
            assemble_corpus.quota_cells_of({"ptwiki_lead": "ptwiki"}), ("ptwiki",)
        )
        # Two writing keys, two cells, in NAME order and not insertion order.
        self.assertEqual(
            assemble_corpus.quota_cells_of(
                {"wattpad_story": "social-media", "ptwiki_lead": "ptwiki"}
            ),
            ("ptwiki", "social-media"),
        )
        # Two writing keys into ONE cell is one cell: the denominator counts cells, not
        # the ways material reaches them.
        self.assertEqual(
            assemble_corpus.quota_cells_of(
                {"ptwiki_lead": "ptwiki", "ptwiki_body": "ptwiki"}
            ),
            ("ptwiki",),
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
        # Carolina row planted INSIDE the frame's own pool file, which is what the
        # reserved pool actually hands the loader now that the frame draws on one cell.
        # The FILE screen is measured by the rows planted in `carolina_fresh.jsonl`,
        # `b2w_fresh.jsonl` and `ptso_fresh.jsonl` carrying an IN-FRAME `domainSource`:
        # the register filter would admit them, so they can only be absent if those files
        # were never opened. A mislabelled row is exactly the case where the two screens
        # differ.
        with tempfile.TemporaryDirectory() as raw:
            cand = Path(raw)
            rows = {
                "wikipedia_fresh": [
                    ("src_wiki_in", "ptwiki_lead"),
                    ("src_wiki_jud", "carolina_judicial_branch"),
                ],
                "carolina_fresh": [("src_carolina_mislabelled", "ptwiki_lead")],
                "b2w_fresh": [("src_b2w_mislabelled", "ptwiki_lead")],
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
            "src_wiki_in",
            "src_wiki_jud",
            "src_carolina_mislabelled",
            "src_b2w_mislabelled",
            "src_ptso_1",
        }
        self.assertEqual(
            [r["candidateId"] for r in loaded if r["candidateId"] in planted],
            ["src_wiki_in"],
        )
        # The loader adds no run of its own, so the only run any returned row names is the
        # one its fixture already carried — and the reserved rows, whose `meta` the loader
        # BUILDS, name none at all. Held over every row it returns, planted or not, because
        # that is the form a claim about the loader takes.
        self.assertEqual(
            {(r.get("meta") or {}).get("extractionRun") for r in loaded}
            - {FIXTURE_EXTRACTION_RUN, None},
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
            ("carolina_legislative_branch", "outside the frame"),
            # The three the frame drew on until the amendment, each refused with the
            # MEASUREMENT that took it out and not with a generic "not in the list".
            ("carolina_judicial_branch", "stf.jus.br"),
            ("carolina_university_domains", "jornal.usp.br"),
            ("carolina_social_media", "wattpad.com"),
        ):
            candidate = self._candidate("src_x_1", domain_source)
            with self.assertRaises(OutOfFrameDomainSource) as caught:
                human_record(candidate, "ptwiki", None)
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
            human_record(candidate, "ptwiki", None)
        pair = {
            "parentId": "src_carolina_zzz",
            "text": PROSE_60,
            "provider": "antigravity",
            "model": "gemini-3.6-flash-low",
            "promptTemplateId": "mix_edit_v1",
            "promptTemplateDigest": hashlib.sha256(b"edit").hexdigest(),
            "parentFamily": "carolina_judicial_branch_v2",
            "sourceMaterialBatch": "smb_ptwiki-20220301",
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

        # The cell decides WHICH ceiling counts the row, and with one cell the mislabel
        # that matters is the reverse one: an OUT-OF-FRAME row handed in under the name of
        # the cell that exists. Accepting it would fill the published ceiling's
        # denominator with a population the frame does not sample.
        candidate = self._candidate("src_carolina_in", "carolina_judicial_branch")
        with self.assertRaises(OutOfFrameDomainSource) as caught:
            human_record(candidate, "ptwiki", None)
        message = str(caught.exception)
        self.assertIn("carolina_judicial_branch", message)
        self.assertIn("ptwiki_lead", message)

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
        # family is drawn from publishes a ceiling measured on material that never carries
        # the adversarial register. The families are STYLE families and the assignment is a
        # judgement about the material, so CONCENTRATION is admissible — with one cell in
        # frame all six families point at it — and the ABSENCE is not.
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

    A literal here is not a duplicate but a second authority: the target sets the `n` of
    the published zero-event ceiling, and a lab that wrote its own would collect for one
    ceiling while the release published another. The two numbers 4.000 and 4.000 agreeing
    today is the frame having one cell, not the check being vacuous — the per-cell target
    and the total are separate fields and the test compares both.
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
            self.assertIn(
                str(policy["collection"]["humanLinesPerCellTarget"]),
                str(caught.exception),
            )

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
                            "humanLinesTotal": floor
                            * len(assemble_corpus.QUOTA_CELLS),
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

        # ...and a SHORT cell stays short: the selection stops at what the cell has
        # instead of reaching the total, which is what makes the shortfall visible in the
        # run's own report rather than at the seal.
        thin_pool = by_cell["ptwiki_lead"][:5]
        thin = assemble_corpus.balanced_humans(
            thin_pool, assemble_corpus.TARGET["human"]
        )
        self.assertEqual(len(thin), 5)

        # The DENOMINATOR, which the case above cannot see, and with ONE cell the pool
        # that separates "declared" from "arrived" is the EMPTY one: declared is 1, so the
        # quota is the whole total and nothing is selected; dividing by the cells that
        # arrived would divide by zero. A run that survives an empty cell by rescaling is
        # a run that fills a ceiling's denominator out of another population.
        without = assemble_corpus.balanced_humans([], assemble_corpus.TARGET["human"])
        self.assertEqual(without, [])


class PowerFloorFeasibilityTests(unittest.TestCase):
    """The pre-registered floors are compared against the POOL, before the assembly.

    The composition gate counts the same quantities over the finished corpus at sealing
    time, so a cell that cannot reach them is a refusal that costs a whole extraction and
    a whole assembly to hear.
    """

    def _rows(self, documents: dict[str, int], lines_each: int = 1) -> list[dict]:
        from group_axes import NO_SINGLE_AUTHOR, known, not_applicable

        return [
            {
                "candidateId": f"{source}_{document:05d}_{line}",
                "text": PROSE_60,
                "wordCount": 60,
                "domainSource": source,
                "meta": {
                    "sourceMaterialBatch": "smb_ptwiki-20220301",
                    "extractionRun": FIXTURE_EXTRACTION_RUN,
                    "groupAxes": {
                        "source": known(f"{source}_document_{document:05d}"),
                        "author": not_applicable(NO_SINGLE_AUTHOR),
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
        # The count is what the MEASUREMENT of the old frame produced on its thinnest
        # cell: the Carolina package held 2 member files under the social-media typology
        # against this floor, and that is the shape a cell short of documents has. The
        # cell is the surviving one because it is the only one a row can name.
        rows = self._rows({"ptwiki_lead": 2}, lines_each=3)
        self.assertEqual(assemble_corpus.origin_documents_per_cell(rows), {"ptwiki": 2})
        with self.assertRaises(assemble_corpus.CellBelowOriginDocumentFloor) as caught:
            assemble_corpus.assert_cells_can_meet_the_origin_document_floor(rows)
        message = str(caught.exception)
        # The cell, its count and the floor: without all three the message does not say
        # which extraction has to grow, or by how much.
        for expected in ("ptwiki=2", str(floor)):
            self.assertIn(expected, message)
        # ...and a cell AT the floor is not named at all, because it is not a breach.
        enough = self._rows({"ptwiki_lead": floor})
        assemble_corpus.assert_cells_can_meet_the_origin_document_floor(enough)

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
        self.assertEqual(len(rows), len(assemble_corpus.REGISTER) * 5 * 100)
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

    The demands ADD UP per cell, because one row cannot carry two families — and with a
    one-cell frame all six styles are drawn from the same cell, so its pool has to cover
    six times the per-family count on its own.
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
        self.assertEqual(inside, {"ptwiki": 2})
        self.assertEqual(
            outside,
            {
                "carolina_judicial_branch": 3,
                "ptso_qa": 7,
                "b2w_reviews": 1,
                "?": 1,
            },
        )
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
            "anthropic": "claude-code",
            "codex": "codex",
            "gemini": "gemini-api",
            "gemini_cli": "gemini-cli",
            "ollama": "ollama",
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

        candidate = self._ai_candidate(
            "gemini", "gemini-3.5-flash-lite", receita_da_tarefa("original")
        )
        candidate["meta"]["temperature"] = "0.8"
        record = ai_record(candidate)
        self.assertEqual(
            record["groups"]["generationLane"], {"state": "known", "id": "gemini-api"}
        )
        self.assertTrue(record["generation"]["decoding"]["configurable"])
        self.assertEqual(record["generation"]["decoding"]["temperature"], 0.8)
        # gemini-api runs no harness binary, so the axis genuinely does not apply.
        self.assertEqual(record["groups"]["harnessVersion"]["state"], "notApplicable")

    def test_the_local_runtime_lane_keeps_the_version_and_the_seed_together(self) -> None:
        from assemble_corpus import ai_record

        # The shape of the pool the local runtime writes, and the three facts that no
        # other lane carries at once: the runtime version is KNOWN, the sampling knobs
        # were ours, and the seed is real. Declaring this lane `api` would drop the
        # version to notApplicable; declaring it `cli` would refuse the temperature and
        # leave the seed with no knob it belongs to.
        candidate = self._ai_candidate(
            "ollama", "qwen2.5-7b-q4km", receita_da_tarefa("original")
        )
        # The pool this lane wrote records the PROVIDER and no lane, so the mapping is
        # what places it — asserted without the declared lane, or the entry that does
        # the placing would have no reader here.
        del candidate["meta"]["generationLane"]
        candidate["meta"]["model"] = "qwen2.5:7b"
        candidate["meta"]["version"] = "qwen2.5:7b@845dbda0ea48"
        candidate["meta"]["harnessVersion"] = "ollama 0.32.6"
        candidate["meta"]["temperature"] = "0.8"
        candidate["meta"]["seed"] = "1637398500"
        record = ai_record(candidate)
        self.assertEqual(
            record["groups"]["generationLane"], {"state": "known", "id": "ollama"}
        )
        self.assertEqual(
            record["groups"]["harnessVersion"],
            {"state": "known", "id": "ollama_0_32_6"},
        )
        self.assertTrue(record["generation"]["decoding"]["configurable"])
        self.assertEqual(record["generation"]["decoding"]["temperature"], 0.8)
        self.assertEqual(record["generation"]["seed"], "1637398500")
        self.assertNotIn("seedNullReason", record["generation"])
        # No effort control in the path, and the arm says so rather than naming a level.
        self.assertEqual(
            record["generation"]["effort"],
            {"source": "not-supported", "configurable": False},
        )

    def test_the_interactive_anthropic_pool_maps_onto_the_claude_code_lane(self) -> None:
        from assemble_corpus import ai_record

        # The 122 rows on disk record `provider: "anthropic"`, no lane, no effort level
        # and no harness version — an interactive session exposed none of the three.
        # `not-supported` is the arm that states the absent control instead of naming a
        # level, and it is a fact about the RECORD: the same lane writes a level when the
        # invocation chose one.
        candidate = self._ai_candidate(
            "anthropic", "claude-fable-5", receita_da_tarefa("original")
        )
        del candidate["meta"]["generationLane"]
        candidate["meta"]["seed"] = ""
        candidate["meta"]["seedNullReason"] = (
            "interactive Claude session: sampling seed and temperature are not exposed"
        )
        record = ai_record(candidate)
        self.assertEqual(
            record["groups"]["generationLane"], {"state": "known", "id": "claude-code"}
        )
        self.assertEqual(
            record["generation"]["effort"],
            {"source": "not-supported", "configurable": False},
        )
        # A harness with no readable version: `unknown` and never notApplicable, which
        # costs the record its eligibility and is the price the core tolerates.
        self.assertEqual(record["groups"]["harnessVersion"]["state"], "unknown")
        self.assertEqual(record["generation"]["decoding"], {"configurable": False})
        candidate["meta"]["effortLevel"] = "max"
        candidate["meta"]["effortSource"] = "flag"
        self.assertEqual(
            ai_record(candidate)["generation"]["effort"],
            {
                "source": "flag",
                "configurable": True,
                "scale": "claude-code-effort",
                "level": "max",
            },
        )

    def test_effort_configurability_comes_from_the_source_not_from_the_lane(self) -> None:
        from assemble_corpus import ai_record

        # One lane, both forms. `agy` takes `--effort` on a base model id and embeds the
        # tier in the id of the others, so a per-lane boolean would have to be wrong
        # about one of them.
        candidate = self._ai_candidate(
            "agy", "gemini-3.1-pro", receita_da_tarefa("original")
        )
        candidate["meta"]["effortLevel"] = "low"
        candidate["meta"]["effortSource"] = "flag"
        self.assertEqual(
            ai_record(candidate)["generation"]["effort"],
            {
                "source": "flag",
                "configurable": True,
                "scale": "agy-model-id-tier",
                "level": "low",
            },
        )
        candidate["meta"]["effortSource"] = "model-id"
        self.assertEqual(
            ai_record(candidate)["generation"]["effort"]["configurable"], False
        )

    def test_a_cli_lane_refuses_the_temperature_the_pool_carries(self) -> None:
        from assemble_corpus import ai_record

        # MEASURED: generate_ai.py wrote "temperature": "0.8" into the meta of every
        # provider, including the three CLI lanes it invokes with no sampling flag.
        # The frozen policy sets decodingConfigurable false for them, so the number
        # describes nothing and the record must not carry it.
        candidate = self._ai_candidate(
            "agy", "gemini-3.5-flash-medium", receita_da_tarefa("original")
        )
        candidate["meta"]["temperature"] = "0.8"
        record = ai_record(candidate)
        self.assertEqual(record["generation"]["decoding"], {"configurable": False})

    def test_an_uncaptured_harness_version_is_unknown_and_not_invented(self) -> None:
        from assemble_corpus import ai_record

        candidate = self._ai_candidate(
            "agy", "claude-sonnet-4-6", receita_da_tarefa("original")
        )
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
        candidate = self._ai_candidate(
            "agy", "claude-sonnet-4-6", receita_da_tarefa("original")
        )
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

        # The `agy` lane exposes no sampling seed, and that is a property of the LANE
        # rather than of a pool row, so a row that recorded neither gets the reason and
        # never a synthesized seed. The default fills in the REASON, which is the safe
        # half of the pair to default.
        candidate = self._ai_candidate(
            "agy", "claude-sonnet-4-6", receita_da_tarefa("original")
        )
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
        candidate = self._ai_candidate(
            "codex", "gpt-5.6-luna", receita_da_tarefa("original")
        )
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

        # `gpt-oss-120b-medium` EMBEDS its effort in the model id and `--effort` is a
        # flag in parallel. Measured: agy refuses the pair only when the two DISAGREE
        # (`-low --effort high` conflicts; `-low --effort low` runs), and the ladder is
        # per model. Reading "medium" off the suffix would still be an identity we made
        # up, because it would name a source this run never consulted, which R6 forbids.
        candidate = self._ai_candidate(
            "agy", "gpt-oss-120b-medium", receita_da_tarefa("original")
        )
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

        candidate = self._ai_candidate(
            "gemini", "gemini-3.5-flash-lite", receita_da_tarefa("original")
        )
        candidate["meta"]["provider"] = "openai"
        del candidate["meta"]["generationLane"]
        # `openai` is not a fictional label: 2.004 rows on disk carry it, from the
        # direct-API runs that predate the frozen slate. It has no lane because the
        # slate reaches OpenAI through `codex`, so those rows leave the corpus rather
        # than borrowing a lane they never ran on. Adding a lane to rescue them would
        # be declaring a channel nobody ran.
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
            "gemini", "gemini-3.5-flash-lite", receita_da_tarefa("original")
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
            "gemini", "gemini-3.5-flash-lite", receita_da_tarefa("parafrase")
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
            "gemini", "gemini-3.5-flash-lite", receita_da_tarefa("original")
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
            "parentId": "src_wiki_0f89e00a4836",
            "text": PROSE_60,
            "provider": "antigravity",
            "model": "gemini-3.6-flash-low",
            "generatedAt": "2026-07-23T18:53:31.606876+00:00",
            "promptTemplateId": "edit_v1",
            "promptTemplateDigest": hashlib.sha256(b"edit").hexdigest(),
            "parentFamily": "ptwiki_lead",
            "sourceMaterialBatch": "smb_ptwiki-20220301",
            "mixture": {
                "spans": [
                    {"start": 0, "end": 200, "origin": "human"},
                    {"start": 200, "end": len(PROSE_60), "origin": "ai"},
                ]
            },
        }
        record = mixed_record(candidate)
        parent = "src_wiki_0f89e00a4836"
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
            "parentId": "src_wiki_0f89e00a4836",
            "text": PROSE_60,
            "provider": "antigravity",
            "model": "gemini-3.6-flash-low",
            "generatedAt": "2026-07-23T18:53:31.606876+00:00",
            "parentFamily": "ptwiki_lead",
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
            "parentId": "src_wiki_0f89e00a4836",
            "text": PROSE_60,
            "provider": "antigravity",
            "model": "gemini-3.6-flash-low",
            "generatedAt": "2026-07-23T18:53:31.606876+00:00",
            "promptTemplateId": "edit_v1",
            "promptTemplateDigest": hashlib.sha256(b"edit").hexdigest(),
            "parentFamily": "ptwiki_lead",
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
        self.assertIn("mix_src_wiki_0f89e00a4836", str(caught.exception))


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
            "recipe": receita_da_tarefa("original"),
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
            "parentFamily": "ptwiki_lead",
            "sourceMaterialBatch": "smb_ptwiki-20220301",
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
        mixed = mixed_record(self._mixed_candidate("src_wiki_0f89e00a4836"))
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
                "src_wiki_aaa", "ptwiki_page_9042"
            ),
            "ptwiki",
            None,
        )
        records = [
            ai_record(self._api_candidate("src_ai_gemini_aaaaaaaaaaaa")),
            ai_record(self._api_candidate("src_ai_gemini_bbbbbbbbbbbb")),
            ai_record(
                self._api_candidate("src_ai_gemini_cccccccccccc", temperature="0.5")
            ),
            mixed_record(self._mixed_candidate("src_wiki_0f89e00a4836")),
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
            "src_wiki_aaa", "ptwiki_page_9042"
        )
        record = human_record(candidate, "ptwiki", None)
        # The EXTRACTION run that wrote the row — stamped by the extractor, `known` from
        # the start and never touched by `assign_generation_batches` — and the ACQUISITION
        # event it was read out of, which is a different fact.
        self.assertEqual(
            record["groups"]["extractionRun"],
            {"state": "known", "id": FIXTURE_EXTRACTION_RUN},
        )
        self.assertEqual(
            record["groups"]["sourceMaterialBatch"],
            {"state": "known", "id": "smb_ptwiki-20220301"},
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
        # frozen file fails here instead of producing rows no corpus can accept. SUBSET
        # and not equality: this script spawns a subprocess, and two frozen lanes are not
        # subprocesses of it — `claude-code` is a subagent call from inside a session and
        # `ollama` is a local server with its own writer. The complement is asserted by
        # name so a lane silently dropped from this table still fails.
        self.assertTrue(set(generate_ai.PROVIDER_LANE.values()) <= frozen)
        self.assertEqual(
            frozen - set(generate_ai.PROVIDER_LANE.values()),
            {"claude-code", "ollama"},
        )
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

        # One digest per name, over the WHOLE slate: identity IS the bytes of a prompt,
        # so an alias — a second name pointing at a body that already has one — would
        # make the island partition nominal while every count still looked right.
        digests = {
            name: make_mixed.mix_template_digest(name) for name in make_mixed.MIX_TEMPLATES
        }
        self.assertEqual(len(set(digests.values())), len(digests), digests)

        # The LIVE case is an island identity, and it carries the cell with it: the name
        # says which slot of which island produced the row, and `mixOperation`/`mixLevel`
        # say what the run asked for. A row that recorded only the name could not be
        # distinguished from one that had done some other geometry under it.
        identidade = "mix-substituicao-ilha-00"
        buffer = io.StringIO()
        make_mixed.emit(
            buffer,
            {
                "id": "src_wiki_abc",
                "text": "uma frase. outra frase. terceira frase.",
                "family": "ptwiki_lead",
                "sourceMaterialBatch": "smb_ptwiki-20220301",
            },
            "uma frase reescrita. outra frase. terceira frase.",
            provider="antigravity",
            model="gemini-3.6-flash-low",
            template_id=identidade,
            mix_operation="substituicao",
            mix_level=50,
            harness_version="1.2.3",
        )
        row = json.loads(buffer.getvalue())
        self.assertEqual(row["promptTemplateId"], identidade)
        self.assertEqual(row["promptTemplateDigest"], digests[identidade])
        self.assertEqual(row["mixOperation"], "substituicao")
        self.assertEqual(row["mixLevel"], 50)
        self.assertEqual(row["harnessVersion"], "1.2.3")
        # The PARENT's acquisition event travels on the pair row. Without it the pair is
        # unwritable: the axis admits only `known` on a mechanistic mixed row, and the
        # parent id alone resolves no acquisition at assembly time.
        self.assertEqual(row["sourceMaterialBatch"], "smb_ptwiki-20220301")
        # And that row is now writable as a sealed record, which the legacy pools are not.
        from assemble_corpus import mixed_record

        record = mixed_record(row)
        self.assertEqual(
            record["groups"]["sourceMaterialBatch"],
            {"state": "known", "id": "smb_ptwiki-20220301"},
        )
        self.assertEqual(record["groups"]["generationLane"]["id"], "agy")
        self.assertEqual(record["groups"]["harnessVersion"],
                         {"state": "known", "id": "1_2_3"})
        self.assertEqual(
            record["groups"]["derivationRoot"]["id"], "src_wiki_abc"
        )
        self.assertEqual(
            record["groups"]["domainSource"]["id"], "ptwiki_lead"
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
                mix_operation=None,
                mix_level=None,
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
                "id": "src_wiki_abc",
                "text": "uma frase. outra frase. terceira frase.",
                "family": "ptwiki_lead",
                "sourceMaterialBatch": "smb_ptwiki-20220301",
            },
            "uma frase reescrita. outra frase. terceira frase.",
            provider="antigravity",
            model="gemini-3.6-flash-low",
            template_id="mix_edit_v1",
            mix_operation=None,
            mix_level=None,
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
            mix_operation=None,
            mix_level=None,
        )
        row = json.loads(buffer.getvalue())
        self.assertEqual(row["parentFamily"], "?")
        with self.assertRaises(MissingRecipe):
            mixed_record(row)

    def test_the_recipe_claims_have_no_default_a_caller_can_inherit(self) -> None:
        import io

        import make_mixed

        # `template_id` carried `= "mix_edit_v1"` until the round that removed it.
        # Unreachable from either production call site — both pass it explicitly — and
        # therefore unreachable by every test too, which is exactly why it survived the
        # commit whose subject line was removing the silent default. What a default costs
        # is paid by the NEXT caller: a lane that does not know which template ran would
        # publish `mix_edit_v1` plus its digest as an observation, and the row would be
        # written as v3 with a recipe nobody sent. The failure has to be at the call.
        #
        # THREE claims now, and each is checked with the other two supplied, because a
        # single call omitting all three is satisfied by any one of them still having a
        # default. The message has to NAME the missing one: `mixOperation` inherited by
        # default would stamp a geometry the text never had, which is the same class of
        # falsehood as an inherited recipe.
        completo = {
            "template_id": "mix-substituicao-ilha-00",
            "mix_operation": "substituicao",
            "mix_level": 50,
        }
        for ausente in completo:
            with self.subTest(ausente=ausente):
                argumentos = {k: v for k, v in completo.items() if k != ausente}
                with self.assertRaises(TypeError) as erro:
                    make_mixed.emit(  # type: ignore[call-arg]
                        io.StringIO(),
                        {
                            "id": "src_ptso_abc",
                            "text": "uma frase. outra frase.",
                            "family": "ptso_qa",
                        },
                        "uma frase reescrita. outra frase.",
                        provider="antigravity",
                        model="gemini-3.6-flash-low",
                        **argumentos,
                    )
                self.assertIn(ausente, str(erro.exception))
        # Nao vacuo: com os tres a chamada escreve.
        destino = io.StringIO()
        make_mixed.emit(
            destino,
            {
                "id": "src_ptso_abc",
                "text": "uma frase. outra frase.",
                "family": "ptso_qa",
            },
            "uma frase reescrita. outra frase.",
            provider="antigravity",
            model="gemini-3.6-flash-low",
            **completo,
        )
        self.assertEqual(json.loads(destino.getvalue())["mixLevel"], 50)


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
            "src_wiki_aaa", "ptwiki_page_9042"
        )

    def test_every_record_class_states_automated_unreviewed(self) -> None:
        from assemble_corpus import ai_record, human_record, mixed_record

        rows = [
            human_record(self._human(), "ptwiki", None),
            ai_record(
                GenerationBatchAxisTests()._api_candidate("src_ai_gemini_aaaaaaaaaaaa")
            ),
            mixed_record(GenerationBatchAxisTests()._mixed_candidate("src_wiki_aaa")),
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
        record = human_record(candidate, "ptwiki", None)
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
        record = human_record(self._human(), "ptwiki", None)
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

    def _corpus_de_uma_fonte(self, source_id="src_wikipedia_pt"):
        """O corpus das fracoes alvo, todo ele atribuido a UMA fonte declarada.

        `source` fica `known` em toda linha porque src_wikipedia_pt o declara: e o eixo que
        a mutacao de cada teste abaixo derruba, e comecar com ele preenchido e o que
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
        self.assertIn("src_wikipedia_pt", msg)
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

        A autoridade e por fonte, e com a moldura de uma celula ela tem UMA entrada:
        `src_b2w` e `src_carolina` sairam do inventario — resenha de produto nao e celula da
        alegacao, e as tres tipologias da Carolina sao de instituicao unica —, entao pedir o
        eixo de qualquer um dos dois aqui levantaria KeyError em vez de medir o que este
        teste mede. A lista e afirmada por igualdade para que uma fonte que volte ao
        inventario sem passar pela emenda apareca aqui.
        """
        from assemble_corpus import assert_stamped_corpus_is_splittable, declared_group_axes

        autoridade = declared_group_axes()
        self.assertEqual(sorted(autoridade), ["src_wikipedia_pt"])
        for source_id in ("src_wikipedia_pt",):
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
        # UMA linha: as outras 199 seguem em src_wikipedia_pt e nao podem ser arrastadas.
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
        mapa incompleto. O dano nao e leniencia sobre as linhas da fonte omitida — essas o
        consumidor recusa por nome ("fonte nao inventariada") —, e sim o espelho responder
        outra pergunta que a auditoria: a fonte esta no inventario, o espelhado a aceita e
        aqui ela deixa de existir. O que transforma isso em falha e contar as chaves
        `sourceId` do corpo e as entradas do array.
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

    def test_the_authority_fails_closed_on_a_spelling_it_cannot_read(self):
        """Tres grafias que TypeScript aceita e a extracao nao le: duas de chave, uma de valor.

        A entrada assim escrita sai do mapa em silencio, e contar `sourceId` COMO A EXTRACAO O
        LE — chave nua e valor entre aspas duplas — nao pega nenhuma das tres, porque a
        contagem some junto com ela. Quem as pega e a contagem de ENTRADAS, que nao depende de
        grafia alguma. O NOME na mensagem, esse sim, e colhido por uma varredura que aceita as
        tres.
        """
        from assemble_corpus import declared_group_axes

        for grafia, entrada in (
            ("aspas", '{ "sourceId": "src_omitida", declaredGroupAxes: ["author"] }'),
            (
                "apostrofos",
                "{ sourceId: 'src_omitida', declaredGroupAxes: [\"author\"] }",
            ),
            ("espaco", '{ sourceId : "src_omitida", declaredGroupAxes: ["author"] }'),
        ):
            with self.subTest(grafia=grafia):
                corpo = (
                    "export const V3_HUMAN_SOURCE_INVENTORY = [\n"
                    '  { sourceId: "src_ok", declaredGroupAxes: ["source"] },\n'
                    f"  {entrada},\n"
                    "];\n"
                )
                with self.assertRaises(RuntimeError) as ctx:
                    declared_group_axes(corpo)
                self.assertIn("parse parcial", str(ctx.exception))
                self.assertIn("src_omitida", str(ctx.exception))

    def test_the_authority_fails_closed_on_a_MISPAIRED_entry(self):
        """Eixos de OUTRA entrada, que e a unica direcao genuinamente fail-ABERTA.

        Com a chave de eixos de uma entrada corrompida, o passeio minimo do `.*?` atravessa a
        entrada seguinte e da a PRIMEIRA os eixos da SEGUNDA. Nao ha excecao e nao ha
        contagem divergente de `sourceId`: a fonte fica no mapa com a lista errada, e a
        checagem do eixo que ela perdeu deixa de morder.

        Duas formas, e cada uma e pega por uma contagem diferente: com a entrada seguinte
        entre aspas sobra uma CHAVE que o mapa nao tem; com uma entrada que nao nomeia fonte
        alguma as chaves batem, e o que sobra e uma ENTRADA.
        """
        from assemble_corpus import declared_group_axes

        for forma, seguinte, esperado in (
            (
                "chave entre aspas",
                '  { "sourceId": "src_B", declaredGroupAxes: ["source"] },\n',
                "src_B",
            ),
            (
                "entrada sem fonte",
                '  { snapshot: "outra", declaredGroupAxes: ["source"] },\n',
                "2 entrada(s)",
            ),
        ):
            with self.subTest(forma=forma):
                corpo = (
                    "export const V3_HUMAN_SOURCE_INVENTORY = [\n"
                    '  { sourceId: "src_A", declaredGroupAxesERRADO: ["author"] },\n'
                    f"{seguinte}"
                    "];\n"
                )
                with self.assertRaises(RuntimeError) as ctx:
                    declared_group_axes(corpo)
                self.assertIn("parse parcial", str(ctx.exception))
                self.assertIn(esperado, str(ctx.exception))

    def test_the_authority_REFUSES_a_nested_object_instead_of_parsing_it(self):
        """O limite declarado da contagem de entradas, fixado como recusa.

        Contar aberturas de `{` conta objeto ANINHADO como entrada, entao uma entrada bem
        formada que carregue um deles e RECUSADA em vez de lida. E a direcao fail-fechada, e
        sem este caso a ressalva escrita no codigo seria promessa sem medicao.
        """
        from assemble_corpus import declared_group_axes

        corpo = (
            "export const V3_HUMAN_SOURCE_INVENTORY = [\n"
            '  { sourceId: "src_ok", extra: { profundidade: 1 },\n'
            '    declaredGroupAxes: ["source"] },\n'
            "];\n"
        )
        with self.assertRaises(RuntimeError) as ctx:
            declared_group_axes(corpo)
        self.assertIn("parse parcial", str(ctx.exception))
        self.assertIn("2 entrada(s)", str(ctx.exception))

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
    lane cannot carry it: the two OpenAI families arrive on different lanes (`codex` and
    `agy`) and are both core, so the provider boundary crosses the lane boundary, and a
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
            self._generated("qwen2_5-7b-q4km"),
            self._generated("gpt-5_6-luna"),
            self._generated("gemini-3_5-flash-lite"),
            self._generated("gemini-3_1-flash-lite", label="mixed"),
            {"id": "h1", "label": "human", "groups": {}},
        ]
        # The OpenAI family is CORE and the local lineage is the reserve, which is the
        # pair that carries the operator's reversal: reading either role off a lane or a
        # prefix would put them the other way round.
        self.assertEqual(
            assemble_corpus.generator_family_roles(records),
            {
                "qwen2_5-7b-q4km": assemble_corpus.OOD_RESERVED_ROLE,
                "gpt-5_6-luna": assemble_corpus.CORE_ROLE,
                "gemini-3_5-flash-lite": assemble_corpus.CORE_ROLE,
                "gemini-3_1-flash-lite": assemble_corpus.CORE_ROLE,
            },
        )

    def test_a_family_the_slate_does_not_name_stops_the_run(self) -> None:
        import assemble_corpus

        # The failure the reserve exists to prevent: the reserved lineage is republished
        # under another tag, so a prefix rule reads it as core and the training set gets
        # it. It is also the shape the reserve's SECOND lineage has today — its lines do
        # not exist, and the day they do with no role naming them, this is what halts.
        renamed = "qwen2_5-7b-q8_0"
        self.assertNotIn(renamed, assemble_corpus.OOD_RESERVED_FAMILIES)
        self.assertNotIn(renamed, assemble_corpus.CORE_GENERATOR_FAMILIES)
        self.assertTrue(renamed.startswith("qwen2_5-7b"))
        with self.assertRaises(assemble_corpus.UndeclaredGeneratorFamily) as caught:
            assemble_corpus.generator_family_roles([self._generated(renamed)])
        message = str(caught.exception)
        self.assertIn(renamed, message)
        self.assertIn(assemble_corpus.OOD_RESERVED_ROLE, message)
        self.assertIn(assemble_corpus.CORE_ROLE, message)

    def test_the_role_reads_the_canonical_axis_and_not_the_provider_label(self) -> None:
        import assemble_corpus
        from group_axes import known

        # `generation.family` carries the provider's own label and never equals a slate
        # entry; the role has to come off `groups.generatorFamily`.
        record = {
            "id": "rec_dotted",
            "label": "ai",
            "generation": {"family": "qwen2.5-7b-q4km"},
            "groups": {"generatorFamily": known("qwen2_5-7b-q4km")},
        }
        self.assertEqual(
            assemble_corpus.generator_family_roles([record]),
            {"qwen2_5-7b-q4km": assemble_corpus.OOD_RESERVED_ROLE},
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
        # instead of predicted. The two are NOT the same arithmetic:
        # `assert_the_blind_block_holds_both_roles` compares reserved LINES and this one
        # compares the CLOSURE of the reserved components, so the refusal here is reachable
        # from `main` as well (the corpus that separates them is in
        # `ComponenteDeMaisDeUmaLinhaTests`). On this corpus every component is one line, so
        # closure and lines coincide and what is measured is the block arithmetic alone.
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
        self.assertIn("seats 5 line(s)", message)
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


class GeneratorVersionIsTheFamilyTests(unittest.TestCase):
    """`generatorVersion` carries the identity `generatorFamily` carries, em TODA linha.

    É a medição de que o comentário de `SPLIT_GROUP_KEYS` — e o de `GROUP_KEYS` em
    benchmark/split.ts — depende em DOIS lugares: para dizer que a versão cumpre a perna (c)
    (a identidade dela é o nível de TOPO da árvore de reamostragem) e para dizer que
    particioná-la por ilha custaria um ID DE MODELO por ilha, que é a razão de ela ser
    `namedReported` em vez de unida. Hoje a igualdade é acidente de
    `version = str(meta.get("version") or family_raw)` mais pools que gravam `version` igual a
    `family`: aqui ela passa a ser exigência, e um pool que gravar
    `gemini-3.5-flash-lite-002` fica vermelho.

    O laço percorre TODA linha que o construtor emite, e não uma amostra, porque o sítio é um
    laço: uma amostra provaria a igualdade nas linhas sorteadas e nada sobre a classe.

    Este teste NÃO decide a situação do eixo — isso é o critério da lista, medido em
    test_connectivity_feasibility.py. Ele fixa a igualdade de que o argumento depende.
    """

    @classmethod
    def setUpClass(cls) -> None:
        import assemble_corpus

        # A MESMA sequência de main(): dedup por texto contra um `seen` compartilhado, e só
        # então `enforce_unique_keys`. Sem os 295 renomeios os ids colidem entre lanes, e
        # `nearDuplicate` — que é o id da linha — deixaria de ter uma identidade por linha.
        seen: set[str] = set()
        cls.humans = assemble_corpus.dedup(
            assemble_corpus.load_humans(), lambda r: r["text"], seen
        )
        cls.ai_pool = assemble_corpus.dedup(
            assemble_corpus.load_ai(), lambda r: r["text"], seen
        )
        cls.mixed_pool = assemble_corpus.dedup(
            assemble_corpus.load_mixed(), lambda r: r["text"], seen
        )
        assemble_corpus.enforce_unique_keys(
            [
                (cls.ai_pool, "candidateId"),
                (cls.mixed_pool, "parentId"),
                (cls.humans, "candidateId"),
            ]
        )

    @staticmethod
    def _build(pool: list[dict], builder) -> list[dict]:
        built = []
        for cand in pool:
            try:
                built.append(builder(cand))
            except Exception:  # noqa: BLE001  — a recusa é do seletor, não deste teste
                continue
        return built

    def test_every_built_ai_line_carries_the_family_as_its_version(self) -> None:
        import assemble_corpus
        from group_axes import identity_of

        built = self._build(self.ai_pool, assemble_corpus.ai_record)
        # Falha fechada na vacuidade E no tamanho: um pool que passe a construir outra
        # quantidade muda os números que os comentários de `GROUP_KEYS` publicam, e eles têm
        # de ser reescritos junto.
        self.assertEqual(len(built), 1170)
        # O laço percorre TODA linha e o veredito é a LISTA de divergências, não uma asserção
        # por registro: com um `subTest` por linha esta medição levou quase três minutos para
        # relatar a mesma coisa, e um teste caro é um teste que alguém desliga.
        divergentes = [
            (
                rec["id"],
                identity_of(rec["groups"]["generatorVersion"]),
                identity_of(rec["groups"]["generatorFamily"]),
            )
            for rec in built
            if identity_of(rec["groups"]["generatorVersion"])
            != identity_of(rec["groups"]["generatorFamily"])
        ]
        self.assertEqual(
            divergentes[:5],
            [],
            f"{len(divergentes)} de {len(built)} linhas gravam uma `version` que não é a "
            "família: o argumento de que particionar a versão custa um id de modelo por ilha "
            "— e o resíduo que `groupAxisRole` declara sobre `generatorFamily` — deixa de "
            "estar justificado",
        )
        # E não é vácuo por a família ser única: são cinco identidades.
        self.assertEqual(
            len({identity_of(r["groups"]["generatorFamily"]) for r in built}), 5
        )

    def test_the_shared_catalogue_declares_the_shape_the_pools_produce(self) -> None:
        """As corridas de receita do caso compartilhado SÃO as medidas nos pools.

        Sem este elo o caso `forma-medida-da-classe-gerada` é um número escrito à mão: os dois
        lados da fronteira concordariam sobre um corpo que os pools não produzem, que é
        exactamente o defeito do fixture de um template por linha. É também o que fixa os
        números que o comentário de `SPLIT_GROUP_KEYS` publica — 4 identidades de template com
        a maior valendo 641, 5 de versão — porque o dia em que os pools mudarem, o caso e o
        comentário têm de ser reescritos juntos.
        """
        import assemble_corpus
        from group_axes import identity_of

        catalogo = json.loads(
            (
                Path(__file__).resolve().parent.parent
                / "tests"
                / "fixtures"
                / "viability-agreement.json"
            ).read_text(encoding="utf-8")
        )
        caso = next(
            c
            for c in catalogo["cases"]
            if c["name"] == "forma-medida-da-classe-gerada"
        )
        built = self._build(self.ai_pool, assemble_corpus.ai_record)
        self.assertEqual(caso["expected"]["recordLines"], len(built))
        for eixo, chave in (
            ("promptTemplate", "promptTemplateRuns"),
            ("generatorVersion", "generatorVersionRuns"),
        ):
            with self.subTest(eixo=eixo):
                medido = Counter(
                    identity_of(rec["groups"][eixo]) for rec in built
                )
                self.assertEqual(
                    sorted(medido.values(), reverse=True),
                    sorted(caso["generatedRecipe"][chave], reverse=True),
                )

    def test_o_lote_e_refinamento_do_template(self) -> None:
        """G5: a chave do lote CONTEM `promptTemplateDigest`, logo lote ⊆ template.

        E o fundamento NOVO da entrada de `generationBatch` em `INERT_UNION_AXES`, e ele e
        incondicional: nao depende mais de `stamp_block` sobrescrever `generatedAt`. Duas
        linhas de um mesmo lote tem a MESMA identidade de `promptTemplate`, entao o lote nao
        acrescenta classe de equivalencia alguma a uma uniao que ja contem o template.

        MEDIDO e nao deduzido do comentario: o corpo abaixo tem duas linhas que diferem SO no
        template, e a assercao e que a chave do lote as separa — tirar `promptTemplateDigest`
        da chave as juntaria num lote cujas linhas tem templates distintos, que e exactamente
        a contencao quebrada.
        """
        import assemble_corpus
        from group_axes import identity_of

        def linha(rid: str, digest: str, recipe: str) -> dict:
            return {
                "id": rid,
                "schemaVersion": 4,
                "label": "ai",
                "provenance": {
                    "sourceId": "src_ai_agy",
                    "sourceKind": "controlled-generation",
                },
                "generation": {
                    "provider": "agy",
                    "family": "gemini-3_5-flash-lite",
                    "model": "gemini-3.5-flash-lite",
                    "version": "gemini-3.5-flash-lite",
                    "promptTemplateDigest": digest,
                    "decoding": {"temperature": 0.8},
                    "effort": {"level": "medium"},
                    "generatedAt": "2026-08-12T00:00:00+00:00",
                    "seed": None,
                },
                "groups": {
                    "promptTemplate": assemble_corpus.group_axes.known(
                        f"{recipe}_{digest[:16]}"
                    ),
                },
            }

        registros = [
            linha("ai_um", "a" * 64, "original"),
            linha("ai_dois", "b" * 64, "parafrase"),
        ]
        assemble_corpus.assign_generation_batches(registros)
        lotes = {
            identity_of(rec["groups"]["generationBatch"]) for rec in registros
        }
        # A chave separa as duas linhas: dois lotes, um por template.
        self.assertEqual(len(lotes), 2)
        # E a CONTENCAO, dita como ela e verificavel: dentro de cada lote a identidade de
        # `promptTemplate` e unica. Com a chave mutilada as duas cairiam num lote e este
        # conjunto teria dois elementos.
        por_lote: dict[str, set[str]] = {}
        for rec in registros:
            chave = identity_of(rec["groups"]["generationBatch"])
            por_lote.setdefault(chave, set()).add(
                identity_of(rec["groups"]["promptTemplate"])
            )
        for chave, templates in por_lote.items():
            with self.subTest(lote=chave):
                self.assertEqual(len(templates), 1)
        # Nao vacuo: as duas linhas TEM templates diferentes, senao a contencao passaria por
        # o corpo nao ter mais de um template.
        self.assertEqual(
            len({identity_of(r["groups"]["promptTemplate"]) for r in registros}), 2
        )

    def test_the_two_inert_axes_are_measured_and_not_asserted(self) -> None:
        """As duas entradas da lista de união que entram por INÉRCIA, sobre o corpo real.

        `nearDuplicate` tem uma identidade por linha depois da poda, e `generationBatch` está
        `unknown` em toda linha gerada até `assign_generation_batches`. São os dois números que
        o comentário do critério publica, e sem esta medição eles são prosa.
        """
        import assemble_corpus
        from group_axes import UNKNOWN, identity_of, state_of

        built = self._build(self.ai_pool, assemble_corpus.ai_record)
        self.assertEqual(
            len({identity_of(r["groups"]["nearDuplicate"]) for r in built}), len(built)
        )
        self.assertEqual(
            sum(
                1
                for r in built
                if state_of(r["groups"]["generationBatch"]) == UNKNOWN
            ),
            len(built),
        )

    def test_the_mixed_class_builds_nothing_today_and_the_count_says_so(self) -> None:
        """A mesma exigência sobre `mixed_record`, e o estado que ela encontra.

        A classe mista constrói ZERO das 2135 candidatas oferecidas, então o laço abaixo roda
        vazio. A contagem é afirmada para que o dia em que ela voltar a construir fique
        VERMELHO aqui, em vez de a igualdade passar por vacuidade sobre a classe inteira.
        """
        import assemble_corpus
        from group_axes import identity_of

        built = self._build(self.mixed_pool, assemble_corpus.mixed_record)
        self.assertEqual(len(self.mixed_pool), 2135)
        self.assertEqual(len(built), 0)
        self.assertEqual(
            [
                rec["id"]
                for rec in built
                if identity_of(rec["groups"]["generatorVersion"])
                != identity_of(rec["groups"]["generatorFamily"])
            ],
            [],
        )


class ComponentStampingTests(unittest.TestCase):
    """O CARIMBADOR, chamado como PRODUTOR, sobre a forma medida da classe gerada.

    Os três testes de travessia deste arquivo chamam `assert_stamped_corpus_is_splittable`
    sobre corpo montado à mão: eles provam o critério e nada sobre o sítio. Aqui quem roda é
    `assign_partitions`, e o que se afirma é que o corpo que ela PRODUZ não tem componente
    atravessando bloco — sob mais de uma ordem da lista de entrada, porque uma ordem só prova
    a ordem de hoje.
    """

    LINHAS = 1170
    PARES_DE_DERIVACAO = 20
    IDENTIDADES_DE_SEMENTE = 1046
    GRUPOS_DE_SEMENTE_COM_MAIS_DE_UMA_LINHA = 116

    def forma_medida(self) -> list[dict]:
        """1170 linhas ai, 1046 identidades de `humanSeed` (116 com mais de uma linha) e 20
        grupos de `derivationRoot` espalhados — a forma que os pools produzem em HEAD.

        `humanSeed` nomeia semente AUSENTE, que é o estado medido do corpo mono-classe: 0 das
        1046 identidades resolve para linha do corpo, então a linhagem de pai não une nada e os
        20 grupos de derivação são a única fonte de componente com mais de uma linha.
        """
        from group_axes import (
            NOT_EXTRACTED,
            NO_DERIVATION,
            NO_HUMAN_AUTHOR,
            NO_MATERIAL_ACQUIRED,
            known,
            not_applicable,
            unknown,
        )

        # 116 grupos cobrindo 240 linhas (108 de duas e 8 de três) mais 930 solitárias dá
        # 1046 identidades sobre 1170 linhas, que é a distribuição medida.
        sementes: list[str] = []
        for grupo in range(108):
            sementes += [f"seed_par_{grupo}"] * 2
        for grupo in range(8):
            sementes += [f"seed_trio_{grupo}"] * 3
        sementes += [f"seed_so_{i}" for i in range(930)]
        if len(sementes) != self.LINHAS:
            raise AssertionError("a forma medida não fecha em 1170 linhas")

        registros = []
        for indice, semente in enumerate(sementes):
            registros.append(
                {
                    "id": f"a_{indice:05d}",
                    "schemaVersion": 4,
                    "label": "ai",
                    "provenance": {},
                    "generation": {},
                    "groups": {
                        "author": not_applicable(NO_HUMAN_AUTHOR),
                        "source": not_applicable("texto gerado"),
                        "domainSource": known("ai_gemini"),
                        "humanSeed": known(semente),
                        # UMA identidade de TEMPLATE por LINHA, e e o template que importa:
                        # ele e eixo de UNIAO, entao um template compartilhado poria as 1170
                        # linhas num componente e o preflight recusaria o corpo antes de o
                        # carimbador correr — e o SUJEITO deste fixture e o carimbador. A
                        # versao vem por linha por simetria e nao por necessidade: ela nao esta
                        # na uniao. A forma que este corpo descreve e a LINHAGEM dos pools
                        # (1046 sementes, 116 com mais de uma linha, 20 pares de derivacao),
                        # nao a receita deles.
                        "promptTemplate": known(f"pt_linha_{indice}"),
                        "generatorFamily": known("gemini-3_5-flash-lite"),
                        "generatorVersion": known(f"gv_linha_{indice}"),
                        "sourceMaterialBatch": not_applicable(NO_MATERIAL_ACQUIRED),
                        "generationBatch": unknown("derivado depois de particionar"),
                        "extractionRun": not_applicable(NOT_EXTRACTED),
                        "nearDuplicate": known(f"nd_{indice}"),
                        "derivationRoot": not_applicable(NO_DERIVATION),
                    },
                }
            )
        passo = self.LINHAS // self.PARES_DE_DERIVACAO
        for par in range(self.PARES_DE_DERIVACAO):
            raiz = known(f"dr_{par}")
            registros[par * passo]["groups"]["derivationRoot"] = raiz
            registros[par * passo + 1]["groups"]["derivationRoot"] = raiz
        return registros

    def corpo_pequeno(self) -> list[dict]:
        """A mesma classe de forma, pequena o bastante para TODA rotação ser afordável.

        Sessenta linhas em seis pares de derivação e quarenta e oito solitárias: 54
        componentes, o maior valendo 3,3 % e o menor 1,7 %, então as duas condições do
        preflight passam e o que sobra a medir é o carimbo.
        """
        registros = self.forma_medida()[:60]
        from group_axes import NO_DERIVATION, known, not_applicable

        for indice, rec in enumerate(registros):
            rec["groups"]["humanSeed"] = known(f"seed_so_{indice}")
            rec["groups"]["derivationRoot"] = not_applicable(NO_DERIVATION)
        for par in range(6):
            raiz = known(f"dr_{par}")
            registros[par * 10]["groups"]["derivationRoot"] = raiz
            registros[par * 10 + 1]["groups"]["derivationRoot"] = raiz
        return registros

    def corpo_de_pares_puros(self) -> list[dict]:
        """Sessenta linhas em TRINTA pares, e a razão é aritmética e não amostragem.

        `train` mede round(60 × 0,45) = 27 linhas, que é ÍMPAR, e todo componente aqui tem
        duas linhas. Logo QUALQUER carimbo que fatie a lista por posição — em qualquer ordem,
        contígua ou embaralhada, com ou sem rotação — corta um componente na fronteira de
        `train`: é prova, não sorte. Um corpo de componentes de tamanhos variados deixa a
        fronteira cair entre componentes por acaso, e uma emenda que ordena a lista para pôr
        irmãs lado a lado passa por acidente do fixture.

        O plano por componente passa aqui porque o alvo ímpar é inalcançável mas a TOLERÂNCIA
        não: 28/2/6/12/12 está a 1,67 pontos de 27/3/6/12/12, dentro dos dois do contrato.
        """
        from group_axes import known

        registros = self.forma_medida()[:60]
        for indice, rec in enumerate(registros):
            rec["groups"]["humanSeed"] = known(f"seed_so_{indice}")
            rec["groups"]["derivationRoot"] = known(f"dr_par_{indice // 2}")
        return registros

    def _mede(self, registros: list[dict]) -> dict[str, int]:
        import assemble_corpus

        assemble_corpus.PARTITION_OF.clear()
        try:
            assemble_corpus.assign_partitions(registros, set())
            atravessando = [
                raiz
                for raiz, blocos in assemble_corpus._blocos_por_componente(
                    registros
                ).items()
                if len(blocos) > 1
            ]
            self.assertEqual(atravessando, [])
            # Em seguida, e não em vez de: a guarda do corpo estampado tem de passar sobre o
            # corpo que este carimbador produziu.
            assemble_corpus.assert_stamped_corpus_is_splittable(registros, set())
            return Counter(
                assemble_corpus.PARTITION_OF[r["id"]] for r in registros
            )
        finally:
            assemble_corpus.PARTITION_OF.clear()

    def test_the_measured_shape_is_the_shape_this_test_stamps(self) -> None:
        import assemble_corpus
        from group_axes import identity_of

        registros = self.forma_medida()
        self.assertEqual(len(registros), self.LINHAS)
        sementes = Counter(
            identity_of(r["groups"]["humanSeed"]) for r in registros
        )
        self.assertEqual(len(sementes), self.IDENTIDADES_DE_SEMENTE)
        self.assertEqual(
            sum(1 for n in sementes.values() if n > 1),
            self.GRUPOS_DE_SEMENTE_COM_MAIS_DE_UMA_LINHA,
        )
        derivacoes = {
            identity_of(r["groups"]["derivationRoot"])
            for r in registros
            if identity_of(r["groups"]["derivationRoot"]) is not None
        }
        self.assertEqual(len(derivacoes), self.PARES_DE_DERIVACAO)
        # A semente não resolve para linha do corpo, então o componente com mais de uma linha
        # vem só da derivação: 1130 solitárias mais 20 pares.
        tamanhos = Counter(assemble_corpus.connected_components(registros).values())
        self.assertEqual(len(tamanhos), 1150)
        self.assertEqual(max(tamanhos.values()), 2)

    def test_no_component_straddles_under_any_of_several_orders(self) -> None:
        """A forma medida, sob rotações, invertida e embaralhada.

        As frações realizadas são as mesmas em TODA ordem, e é isso que separa "o plano é o
        critério" de "o plano é a ordem em que os pools foram concatenados".
        """
        import random

        registros = self.forma_medida()
        esperado = self._mede(list(registros))
        self.assertEqual(
            {b: esperado[b] for b in ("train", "dev", "cal-A", "cal-B", "test")},
            {"train": 526, "dev": 58, "cal-A": 117, "cal-B": 234, "test": 235},
        )
        ordens: list[tuple[str, list[dict]]] = [
            ("invertida", list(reversed(registros)))
        ]
        for rotacao in (1, 2, 43, 293, 526, 527, 585, 936, 1169):
            ordens.append(
                (f"rotacao {rotacao}", registros[rotacao:] + registros[:rotacao])
            )
        for semente in (1, 2, 3):
            embaralhada = list(registros)
            random.Random(semente).shuffle(embaralhada)
            ordens.append((f"embaralhada {semente}", embaralhada))
        for nome, ordem in ordens:
            with self.subTest(ordem=nome):
                self.assertEqual(self._mede(ordem), esperado)

    def test_no_component_straddles_under_EVERY_rotation_of_a_small_corpus(self) -> None:
        """TODAS as rotações, e não uma amostra delas.

        Uma amostra de rotações prova o critério nas rotações sorteadas: para um carimbo por
        POSIÇÃO existe sempre uma rotação que põe uma fronteira de bloco DENTRO de um
        componente — basta rodar a lista até que a fronteira caia entre as duas linhas dele —,
        e só o conjunto completo garante encontrá-la. Por isso o corpo aqui é pequeno: sessenta
        rotações são afordáveis e a garantia é exaustiva.
        """
        registros = self.corpo_pequeno()
        esperado = self._mede(list(registros))
        for rotacao in range(1, len(registros)):
            with self.subTest(rotacao=rotacao):
                self.assertEqual(
                    self._mede(registros[rotacao:] + registros[:rotacao]), esperado
                )

    def test_a_corpus_where_a_positional_stamp_MUST_cut_a_component(self) -> None:
        """O corpo em que o critério não pode ser satisfeito por ordenação alguma.

        Trinta componentes de duas linhas e uma fronteira de bloco em índice ímpar: fatiar a
        lista por posição corta um componente qualquer que seja a ordem, então uma emenda que
        só reordena a lista para pôr irmãs lado a lado é INSUFICIENTE por aritmética. Sem este
        corpo, uma emenda de ordenação passa por acidente da distribuição de tamanhos do
        fixture — foi medido passando.

        O plano por componente realiza 28/2/6/12/12, que é o alvo ímpar arredondado para
        dentro da tolerância, e nenhum componente atravessa.
        """
        import assemble_corpus

        registros = self.corpo_de_pares_puros()
        tamanhos = Counter(assemble_corpus.connected_components(registros).values())
        self.assertEqual(len(tamanhos), 30)
        self.assertEqual(set(tamanhos.values()), {2})
        # A fronteira de `train` é ÍMPAR: é o fato de que a insuficiência é aritmética.
        self.assertEqual(round(len(registros) * assemble_corpus.CLASS_FRACTIONS["train"]) % 2, 1)
        realizado = self._mede(list(registros))
        self.assertEqual(
            {b: realizado[b] for b in ("train", "dev", "cal-A", "cal-B", "test")},
            {"train": 28, "dev": 2, "cal-A": 6, "cal-B": 12, "test": 12},
        )
        for rotacao in range(1, len(registros)):
            with self.subTest(rotacao=rotacao):
                self.assertEqual(
                    self._mede(registros[rotacao:] + registros[:rotacao]), realizado
                )


class ComponenteDeMaisDeUmaLinhaTests(unittest.TestCase):
    """Os dois laços de `_plano_de_blocos` que decidem por COMPONENTE e não por linha.

      * o TETO por classe: um componente é colocado somente quando cabe em TODA classe que
        ele carrega, porque um componente de classe MISTA consome dos dois tetos do MESMO
        bloco. Trocar "toda classe" por "alguma classe" transborda um teto em vez de recusar;
      * a RESERVA: basta UMA linha de família reservada para o componente INTEIRO ser
        assentado em `test`. Exigir a família em todas as linhas manda o componente misto ao
        passeio guloso, e o corpo passa a ser RECUSADO em vez de montado.

    Nenhum dos dois laços é exercitado por um corpo de uma classe por componente nem por
    reserva de uma linha por componente — com um caso só as duas trocas não mudam resultado
    algum. Os fixtures daqui são as duas formas que faltavam: componente de classe mista, que
    é o que a linhagem produz assim que a classe humana entra no corpo, e componente
    reservado de mais de uma linha, que é o que a linhagem produz assim que uma geração
    reservada tem irmã de núcleo.

    A ARITMÉTICA é escolhida e não sorteada: 20 e 40 linhas por classe são os totais em que
    `int(n × (fração + 0,02))` coincide com `round(n × fração)`, ou seja em que o teto da
    tolerância É o alvo. Com folga zero em todo bloco, o plano só tem uma realização e a
    recusa é aritmética em vez de depender da ordem em que o passeio guloso encheu os blocos.
    """

    RESERVADA = "gpt-5_6-luna"
    NUCLEO = "gemini-3_5-flash-lite"

    def _gerada(
        self,
        rec_id: str,
        familia: str | None = None,
        derivacao: str | None = None,
        semente: str | None = None,
    ) -> dict:
        from group_axes import (
            NOT_EXTRACTED,
            NO_DERIVATION,
            NO_HUMAN_AUTHOR,
            NO_MATERIAL_ACQUIRED,
            known,
            not_applicable,
            unknown,
        )

        return {
            "id": rec_id,
            "schemaVersion": 4,
            "label": "ai",
            "provenance": {},
            "generation": {},
            "groups": {
                "author": not_applicable(NO_HUMAN_AUTHOR),
                "source": not_applicable("texto gerado"),
                "domainSource": known("ai_gemini"),
                # `humanSeed` é LINHAGEM DE PAI: só une quando a linha nomeada está no
                # conjunto. Um id de semente que não existe une nada, e é assim que uma
                # gerada fica solitária sem precisar de `notApplicable`.
                "humanSeed": known(semente or f"seed_{rec_id}"),
                "promptTemplate": known(f"pt_{rec_id}"),
                "generatorFamily": known(familia or self.NUCLEO),
                # `generatorVersion` NAO e eixo de uniao — e `namedReported` —, entao o valor
                # aqui nao move a geometria: quem decide os componentes deste fixture e
                # `promptTemplate` (proprio de cada linha) mais a linhagem. O que o esquema
                # exige e que ele seja `known` numa linha gerada, e a identidade escolhida e a
                # do componente que o fixture ja usa, para o registro nao inventar um terceiro
                # vocabulario.
                #
                # Version e family DIVERGEM aqui de proposito, e a divergencia e legal: a
                # igualdade das duas e propriedade MEDIDA dos pools
                # (`GeneratorVersionIsTheFamilyTests`), nunca regra do esquema. Nada no plano
                # de ilhas pede o contrario — o plano particiona templates, blocos de semente
                # e templates de mistura, e nao a versao.
                "generatorVersion": known(
                    f"gv_{derivacao or semente or rec_id}"
                ),
                "sourceMaterialBatch": not_applicable(NO_MATERIAL_ACQUIRED),
                "generationBatch": unknown("derivado depois de particionar"),
                "extractionRun": not_applicable(NOT_EXTRACTED),
                "nearDuplicate": known(f"nd_{rec_id}"),
                "derivationRoot": (
                    known(derivacao) if derivacao else not_applicable(NO_DERIVATION)
                ),
            },
        }

    def _humana(self, rec_id: str, autor: str | None = None) -> dict:
        from group_axes import NO_DERIVATION, known, not_applicable

        return {
            "id": rec_id,
            "schemaVersion": 4,
            "label": "human",
            "provenance": {},
            "generation": {},
            "groups": {
                "author": known(autor or f"au_{rec_id}"),
                "source": known(f"th_{rec_id}"),
                "domainSource": known("ptwiki_lead"),
                "humanSeed": not_applicable("linha humana não é semeada"),
                "promptTemplate": not_applicable("linha humana"),
                "generatorFamily": not_applicable("linha humana"),
                "generatorVersion": not_applicable("linha humana"),
                "sourceMaterialBatch": known("smb_ptwiki_1"),
                "generationBatch": not_applicable("linha humana"),
                "extractionRun": known("er_ptwiki_1"),
                "nearDuplicate": known(f"nd_{rec_id}"),
                "derivationRoot": not_applicable(NO_DERIVATION),
            },
        }

    def _humanas(self, pares: int) -> list[dict]:
        """Uma tripla e `pares` pares de autor: 3 + 2 × pares linhas, nenhuma solitária.

        Sem solitária de propósito: o componente misto tem DUAS linhas, e o passeio ordena por
        tamanho decrescente, então uma solitária humana seria considerada DEPOIS dele e o
        resíduo de capacidade que a recusa depende deixaria de existir.
        """
        registros = [self._humana(f"h_tri_{i}", autor="au_tri") for i in range(3)]
        for par in range(pares):
            registros.append(self._humana(f"h_par_{par:02d}_a", autor=f"au_par_{par:02d}"))
            registros.append(self._humana(f"h_par_{par:02d}_b", autor=f"au_par_{par:02d}"))
        return registros

    def _geradas(self, pares: int) -> list[dict]:
        registros = [self._gerada(f"a_tri_{i}", derivacao="dr_tri") for i in range(3)]
        for par in range(pares):
            registros.append(self._gerada(f"a_par_{par:02d}_a", derivacao=f"dr_par_{par:02d}"))
            registros.append(self._gerada(f"a_par_{par:02d}_b", derivacao=f"dr_par_{par:02d}"))
        return registros

    def _par_misto(self) -> list[dict]:
        """Uma humana e a geração que a semeia: UM componente com uma linha de cada classe.

        Os ids começam por `z_` porque o desempate do passeio é a RAIZ, e a raiz de um
        componente de linhagem é o id do FILHO: com `z_` o par misto é o último componente de
        duas linhas a ser considerado, que é onde os dois tetos já estão apertados.
        """
        return [
            self._humana("z_misto_humana"),
            self._gerada("z_misto_gerada", semente="z_misto_humana"),
        ]

    def _mede(self, registros: list[dict], reservadas: set[str]) -> dict[str, Counter]:
        import assemble_corpus

        assemble_corpus.PARTITION_OF.clear()
        try:
            assemble_corpus.assign_partitions(registros, reservadas)
            por_bloco: dict[str, Counter] = {}
            for rec in registros:
                bloco = assemble_corpus.PARTITION_OF[rec["id"]]
                por_bloco.setdefault(bloco, Counter())[rec["label"]] += 1
            return por_bloco
        finally:
            assemble_corpus.PARTITION_OF.clear()

    def test_o_teto_do_bloco_e_conferido_em_TODA_classe_do_componente(self) -> None:
        """O corpo em que o componente misto cabe por UMA classe e não cabe pela outra.

        40 humanas e 20 geradas, tetos iguais aos alvos nos dois totais. Ao chegar a vez do par
        misto, `train` tem 1 vaga humana e 0 geradas e `dev` tem 0 humanas e 1 gerada — os
        outros três blocos estão cheios nas duas classes. Não há bloco que receba UMA linha de
        cada, então a resposta certa é RECUSAR: conferir "alguma classe" acharia `train` e
        `dev` cabíveis e transbordaria um teto, e a recusa que o operador receberia seria a de
        fração por classe, uma etapa depois e sem nomear o componente.
        """
        import assemble_corpus

        assemble_corpus.PARTITION_OF.clear()
        registros = self._humanas(18) + self._geradas(8) + self._par_misto()
        classes = Counter(rec["label"] for rec in registros)
        self.assertEqual(classes, Counter({"human": 40, "ai": 20}))
        # O componente misto EXISTE e carrega as duas classes — sem esta medição o teste
        # passaria sobre um corpo em que a linhagem não uniu nada.
        raizes = assemble_corpus.connected_components(registros)
        por_componente: dict[str, Counter] = {}
        for rec in registros:
            por_componente.setdefault(raizes[rec["id"]], Counter())[rec["label"]] += 1
        mistos = [raiz for raiz, c in por_componente.items() if len(c) > 1]
        self.assertEqual(mistos, ["z_misto_gerada"])
        self.assertEqual(por_componente["z_misto_gerada"], Counter({"human": 1, "ai": 1}))

        with self.assertRaises(assemble_corpus.UnsplittableCorpus) as caught:
            assemble_corpus.assign_partitions(registros, set())
        message = str(caught.exception)
        # A recusa é a do TETO e nomeia o componente e as duas classes dele. A outra recusa
        # possível — "fração por classe" — chega uma etapa depois, de um corpo já estampado, e
        # é exatamente o que se recebe quando o teto é conferido por classe alguma.
        self.assertIn("nao cabe inteiro em bloco algum sem passar do teto", message)
        self.assertIn("z_misto_gerada", message)
        self.assertIn("'human': 1", message)
        self.assertIn("'ai': 1", message)
        self.assertNotIn("fracao", message)
        # Nada foi estampado: a recusa é do PLANO, antes do carimbo.
        self.assertNotIn("z_misto_gerada", assemble_corpus.PARTITION_OF)

    def test_um_componente_de_classe_mista_consome_dos_DOIS_tetos_do_mesmo_bloco(
        self,
    ) -> None:
        """A outra metade da promessa: quando cabe, ele cabe INTEIRO e conta nas duas classes.

        40 de cada classe, e o único bloco com vaga nas duas quando chega a vez do par misto é
        `train`. As duas linhas caem lá juntas e as duas classes realizam 18/2/4/8/8 exato.
        """
        import assemble_corpus

        registros = self._humanas(18) + self._geradas(18) + self._par_misto()
        self.assertEqual(
            Counter(rec["label"] for rec in registros), Counter({"human": 40, "ai": 40})
        )
        por_bloco = self._mede(registros, set())
        self.assertEqual(
            {bloco: dict(c) for bloco, c in sorted(por_bloco.items())},
            {
                "cal-A": {"human": 4, "ai": 4},
                "cal-B": {"human": 8, "ai": 8},
                "dev": {"human": 2, "ai": 2},
                "test": {"human": 8, "ai": 8},
                "train": {"human": 18, "ai": 18},
            },
        )

        # As duas linhas do componente misto no MESMO bloco, e é `train` que as recebeu — o
        # bloco cuja vaga humana e cuja vaga gerada eram as duas últimas.
        assemble_corpus.PARTITION_OF.clear()
        try:
            assemble_corpus.assign_partitions(registros, set())
            self.assertEqual(assemble_corpus.PARTITION_OF["z_misto_humana"], "train")
            self.assertEqual(assemble_corpus.PARTITION_OF["z_misto_gerada"], "train")
        finally:
            assemble_corpus.PARTITION_OF.clear()

    def test_UMA_linha_reservada_assenta_o_componente_inteiro_em_test(self) -> None:
        """A reserva é pelo COMPONENTE, e uma linha de núcleo ligada a ela vai com ele.

        O componente tem duas geradas com a mesma `derivationRoot`, uma da família reservada e
        outra do núcleo. Se a detecção exigisse a família em TODA linha, este componente iria
        ao passeio guloso — a raiz dele é a primeira da ordem, então cairia em `train` — e o
        corpo passaria a ser RECUSADO pela precedência da reserva em vez de montado.
        """
        import assemble_corpus

        misto = [
            self._gerada("a_00_res_a", familia=self.RESERVADA, derivacao="dr_reserva"),
            self._gerada("a_00_res_b", familia=self.NUCLEO, derivacao="dr_reserva"),
        ]
        # `[3:]` derruba a tripla: aqui todo componente tem DUAS linhas, porque é o tamanho
        # uniforme que faz a ordem do passeio depender só da raiz.
        registros = misto + self._geradas(19)[3:]
        # 40 geradas em 20 componentes de duas linhas cada.
        self.assertEqual(len(registros), 40)
        raizes = assemble_corpus.connected_components(registros)
        self.assertEqual(len(set(raizes.values())), 20)
        self.assertEqual(raizes["a_00_res_a"], raizes["a_00_res_b"])
        # UMA das duas linhas é reservada, e é isso que o laço tem de bastar para ver.
        from group_axes import identity_of

        familias = [
            identity_of(rec["groups"]["generatorFamily"])
            for rec in registros
            if raizes[rec["id"]] == raizes["a_00_res_a"]
        ]
        self.assertEqual(sorted(familias), sorted([self.NUCLEO, self.RESERVADA]))

        por_bloco = self._mede(registros, {self.RESERVADA})
        self.assertEqual(
            {bloco: dict(c) for bloco, c in sorted(por_bloco.items())},
            {
                "cal-A": {"ai": 4},
                "cal-B": {"ai": 8},
                "dev": {"ai": 2},
                "test": {"ai": 8},
                "train": {"ai": 18},
            },
        )
        # As DUAS ordens do par, porque o laço percorre `membros[raiz]` na ordem de
        # `records` e a linhagem não garante que a linha reservada venha primeiro. Ler só a
        # primeira posição basta quando ela é a reservada, e é por isso que a ordem
        # invertida é a que prende o laço: com `membros[raiz][:1]` o corpo é RECUSADO.
        for rotulo, par in (
            ("reservada primeiro", misto),
            ("reservada por último", list(reversed(misto))),
        ):
            with self.subTest(ordem=rotulo):
                corpo = par + self._geradas(19)[3:]
                assemble_corpus.PARTITION_OF.clear()
                try:
                    assemble_corpus.assign_partitions(corpo, {self.RESERVADA})
                    self.assertEqual(
                        assemble_corpus.PARTITION_OF["a_00_res_a"], "test"
                    )
                    # A LINHA DE NÚCLEO também, e é ela que separa "reserva por componente"
                    # de "reserva por linha": pela linha ela ficaria fora de `test`.
                    self.assertEqual(
                        assemble_corpus.PARTITION_OF["a_00_res_b"], "test"
                    )
                finally:
                    assemble_corpus.PARTITION_OF.clear()

    def test_o_FECHO_do_componente_reservado_transborda_um_bloco_que_as_linhas_cabem(
        self,
    ) -> None:
        """As duas aritméticas da reserva são DIFERENTES, e a de `main` é a mais frouxa.

        `assert_the_blind_block_holds_both_roles` compara linhas cuja `generatorFamily` está
        na reserva; `_plano_de_blocos` compara o FECHO dos componentes reservados. Fecho ≥
        linhas, então existe corpo aprovado pela primeira e recusado pela segunda — este: UMA
        linha reservada e vinte de núcleo no mesmo componente, 21 sobre um bloco cego de 20.
        É por isso que a recusa local não é inalcançável de `main`, e é por isso que a
        mensagem dela fala de linhas ASSENTADAS e não de linhas reservadas.
        """
        import assemble_corpus

        assemble_corpus.PARTITION_OF.clear()
        registros = [
            self._gerada("a_res_00", familia=self.RESERVADA, derivacao="dr_reserva")
        ]
        registros += [
            self._gerada(f"a_nucleo_{i:02d}", derivacao="dr_reserva") for i in range(20)
        ]
        registros += [self._gerada(f"a_so_{i:02d}") for i in range(79)]
        self.assertEqual(len(registros), 100)

        # A aritmética de `main` APROVA: uma linha reservada contra um bloco cego de 20.
        por_familia = assemble_corpus.positive_rows_per_family(registros)
        linhas = assemble_corpus.reserved_rows_per_class(por_familia, {self.RESERVADA})
        self.assertEqual(linhas, {"ai": 1})
        assemble_corpus.assert_the_blind_block_holds_both_roles(linhas, {"ai": 20})

        # E o plano RECUSA, porque o que é assentado é o fecho de 21.
        with self.assertRaises(assemble_corpus.ReserveFillsTheBlindBlock) as caught:
            assemble_corpus.assign_partitions(registros, {self.RESERVADA})
        message = str(caught.exception)
        self.assertIn("seats 21 line(s)", message)
        self.assertIn("holds 20", message)
        # A ação prescrita nomeia a linhagem, porque 20 das 21 linhas NÃO são da reserva e
        # "gerar menos linhas reservadas" não conserta este corpo.
        self.assertIn("joined to them by lineage", message)
        self.assertNotIn("a_res_00", assemble_corpus.PARTITION_OF)

    def test_a_guarda_do_componente_roda_ANTES_da_guarda_da_fracao(self) -> None:
        """A ordem das duas guardas de `assign_partitions`, pinada por comportamento.

        `_plano_de_blocos` não produz travessia, então a única forma de um corpo falhar as
        DUAS guardas é substituir o planejador. Num corpo assim a ordem decide o diagnóstico
        que o operador recebe: a guarda de componente nomeia o componente e os dois blocos, e
        a de fração só sabe dizer "fração por classe" sobre um corpo já estampado.
        """
        from unittest import mock

        import assemble_corpus

        registros = self._humanas(18) + self._geradas(18) + self._par_misto()

        def plano_que_atravessa(records: list[dict], held_out: set[str]) -> dict[str, str]:
            del held_out
            # Tudo em `train` menos UMA linha do componente misto: o componente atravessa E
            # as cinco frações ficam fora da tolerância.
            return {
                rec["id"]: ("dev" if rec["id"] == "z_misto_humana" else "train")
                for rec in records
            }

        assemble_corpus.PARTITION_OF.clear()
        try:
            with mock.patch.object(
                assemble_corpus, "_plano_de_blocos", plano_que_atravessa
            ):
                with self.assertRaises(assemble_corpus.UnsplittableCorpus) as caught:
                    assemble_corpus.assign_partitions(registros, set())
            message = str(caught.exception)
            self.assertIn("foi carimbado em mais de um bloco", message)
            self.assertIn("z_misto_gerada", message)
            self.assertIn("dev", message)
            self.assertNotIn("fracao", message)

            # Não vácuo: o MESMO corpo estampado falha a outra guarda também, e é isso que faz
            # da ordem uma decisão em vez de um acidente.
            with self.assertRaises(assemble_corpus.UnsplittableCorpus) as segunda:
                assemble_corpus.assert_stamped_corpus_is_splittable(registros, set())
            self.assertIn("fracao", str(segunda.exception))
        finally:
            assemble_corpus.PARTITION_OF.clear()


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

    RESERVED_FAMILY = "qwen2.5-7b-q4km"
    CORE_FAMILY = "gemini-3.5-flash-lite"
    LANE_OF = {
        "agy": "agy",
        "codex": "codex",
        "gemini": "gemini-api",
        "ollama": "ollama",
    }

    def _prose(self, tag: str) -> str:
        # Disjoint token sets per row, so neither the near-duplicate prune nor the global
        # seen prune collapses two fixture rows into one another.
        return " ".join(f"{tag}palavra{n}" for n in range(60))

    def _human(
        self, domain_source: str, index: int, license_id: str | None = None
    ) -> dict:
        from group_axes import NO_SINGLE_AUTHOR, known, not_applicable

        return {
            "candidateId": f"cand_{domain_source}_{index:04d}",
            "text": self._prose(f"h{domain_source}{index}"),
            "wordCount": 60,
            "domainSource": domain_source,
            "licenseId": license_id or document_license_of(domain_source),
            "meta": {
                "dateField": "teiHeader/publicationStmt/date",
                "observedValue": "2019-05-04",
                # Both batch axes come from the EXTRACTOR, so a pool fixture carries both
                # or its rows are unwritable — nothing downstream fills either in.
                "sourceMaterialBatch": "smb_fixture_v1",
                "extractionRun": FIXTURE_EXTRACTION_RUN,
                "groupAxes": {
                    "source": known(f"doc_{domain_source}_{index:04d}"),
                    "author": not_applicable(NO_SINGLE_AUTHOR),
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
            "recipe": receita_da_tarefa("original"),
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
            "parentFamily": "ptwiki_lead",
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
        document_license: str | None = None,
        overflow_rows: int = 0,
    ) -> dict:
        """The pool files, and the planted line a seen set may already hold.

        41 rows of the ONE declared cell, each its own origin document: the human class
        has to reach five partitions, and the smallest of them is 5 % of the class, so a
        pool of 11 components cannot be split at all (`assert_components_can_fill_five_
        partitions` refuses it as granularity, not size). The Carolina pool file is
        written too and must NOT be read — the frame no longer draws on it, and this is
        where the loader's file screen is measured end to end.

        `document_license` overrides what every encyclopedic DOCUMENT declares. It is what
        a per-stratum constant cannot reproduce: keyed on the stratum, the licence of a
        ptwiki row is always `cc-by-sa-4.0`, so a pool whose documents declare the other
        reviewed licence is the case where the constant and the reading disagree. One
        value for the whole pool and not a mixture, because a source under two licences is
        refused outright (`SourceCarriesTwoLicenses`) and that refusal is its own test.
        """
        cand = tmp / "candidates"
        family = reserved_family or self.RESERVED_FAMILY
        # 41 encyclopedic rows against a quota of 10, with the planted one FIRST: it is
        # selected unless the global prune removes it.
        wiki = [
            self._human("ptwiki_lead", index, document_license) for index in range(41)
        ]
        self._write(cand / "wikipedia_fresh.jsonl", wiki)
        # Out of frame since the amendment, and written anyway: a run that opened it would
        # take these rows, and no cell counts them.
        self._write(
            cand / "carolina_fresh.jsonl",
            [
                self._human(source, index)
                for source in (
                    "carolina_judicial_branch",
                    "carolina_social_media",
                    "carolina_university_domains",
                )
                for index in range(10)
            ],
        )
        core = [
            self._ai("gemini", self.CORE_FAMILY, index)
            for index in range(40 - reserved_rows - excluded_rows)
        ]
        self._write(cand / "ai_fresh_gemini.jsonl", core)
        if overflow_rows:
            # Core rows in a file the loader reads AFTER the reserve, so the class goes
            # OVER quota and the truncation has something to cut. Which rows it cuts is
            # the whole point: they are these, and never the reserved ones.
            self._write(
                cand / "ai_fresh_codex.jsonl",
                [
                    self._ai("codex", self.CORE_FAMILY, 3000 + index)
                    for index in range(overflow_rows)
                ],
            )
        # The reserve arrives on the lane it is generated by, and the file the loader
        # reads FIRST: a reserved row cut by the class quota is not a smaller reserve, it
        # is a reserve the assembly then refuses.
        reserved = [
            self._ai("ollama", family, 1000 + index) for index in range(reserved_rows)
        ]
        self._write(cand / "ai_reserved_qwen.jsonl", reserved)
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

    def test_a_pool_the_extractor_never_stamped_is_counted_out_by_the_run(self) -> None:
        """THE CALL SITE: the run guard bites from `main()`, not only from a direct call.

        Before this unit the guard was unreachable through `main()` — the loader stamped
        every pool line before `human_record` could look, so the refusal existed and had
        zero bite, which is the defect the finding named. Asserting the guard by calling it
        directly proves the criterion and nothing about the site.

        The whole human class comes out empty here, so the run dies later at a gate that
        needs a class to split. The count is printed before any of that, and `_main` keeps
        the stdout in its `finally`, so the assertion holds through the late abort.
        """
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp)
            pool = tmp / "candidates" / "wikipedia_fresh.jsonl"
            unstamped = []
            for line in pool.read_text(encoding="utf-8").splitlines():
                row = json.loads(line)
                # The pool every other test of this class uses IS stamped, because the
                # extractor names the run now. Stripping it is what turns this fixture into
                # a legacy pool, and this assertion is what keeps the strip meaningful: an
                # already-unstamped fixture would make the test pass over nothing.
                self.assertIn("extractionRun", row["meta"])
                del row["meta"]["extractionRun"]
                unstamped.append(row)
            self.assertEqual(len(unstamped), 41)
            self._write(pool, unstamped)
            with contextlib.suppress(Exception):
                self._main(tmp, seen_texts=[])
        # 40 and not 41: the class quota selects 40 of the 41 rows, and every selected one
        # leaves as a COUNTED drop — the same vocabulary `MissingMaterialBatch` uses for
        # legacy pools, and never an abort.
        self.assertIn("MissingExtractionRun: 40", self.stdout)

    def test_the_quota_truncation_cuts_core_rows_and_never_the_reserve(self) -> None:
        import assemble_corpus
        from group_axes import identity_of

        # The class goes six rows over its quota, and the cut comes off the END of the
        # pool order. The reserve is read FIRST for exactly this reason: a reserved row
        # cut by the quota is not a smaller reserve — the reserved family seats whole in
        # the blind block or its lines leave the corpus, so cutting it leaves the run
        # with nothing to declare (`HeldOutReserveEmpty`).
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp, overflow_rows=6)
            self._main(tmp, seen_texts=[])
            records, governance = self._outputs(tmp)

        reserved = assemble_corpus.generator_family(self.RESERVED_FAMILY)
        seated = [
            r
            for r in records
            if identity_of(r["groups"].get("generatorFamily")) == reserved
        ]
        self.assertEqual(len(seated), 6)
        self.assertEqual(governance["heldOutGeneratorFamilies"], [reserved])
        # And the class is still exactly at quota, so the six that were cut are the six
        # the overflow added.
        self.assertEqual(len([r for r in records if r["label"] == "ai"]), 40)

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
        # prune and not a short pool. The quota is the sampled one and the pool carries one
        # spare row, so the count is what the run asks for and the planted line is the one
        # left out.
        import assemble_corpus

        quota = round(assemble_corpus.TARGET["human"] * 100 / 10_000)
        self.assertEqual(
            sum(1 for r in records if r.get("humanSourceType") == "ptwiki"), quota
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
            # 1 of the 6 reserved rows = 16.67 %, far above the 2 % ceiling.
            self.assertEqual(self._contaminate(tmp, "ai_reserved_qwen", 1), 6)
            with self.assertRaises(artifact_gate.ArtifactContamination) as caught:
                self._main(tmp, seen_texts=[])
            # Nothing was written: the refusal sits ahead of records.jsonl, so a
            # contaminated corpus never exists on disk to be trained on by accident.
            self.assertFalse((tmp / "out" / "records.jsonl").exists())
        message = str(caught.exception)
        self.assertIn(self._family(self.RESERVED_FAMILY), message)
        self.assertIn("1/6", message)
        self.assertIn("16.67%", message)
        self.assertIn("ollama", message)
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
            self.assertEqual(self._contaminate(tmp, "ai_reserved_qwen", 1), 6)
            with self.assertRaises(artifact_gate.ArtifactContamination):
                self._main(tmp, seen_texts=[])
            report = json.loads(
                (tmp / "out" / "artifact-gate.json").read_text(encoding="utf-8")
            )
            # And it is the ONLY thing written: the corpus a training run could read does
            # not exist.
            self.assertFalse((tmp / "out" / "records.jsonl").exists())
            self.assertFalse((tmp / "out" / "governance-inputs.json").exists())
        self.assertEqual(report["lanesToRegenerate"], ["ollama"])
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
        # reproduce: every encyclopedic DOCUMENT declares `cc-by-nc-sa-4.0` while the
        # licence a constant keyed on the stratum would name is `cc-by-sa-4.0`. With the
        # base's usual licence the two agree, which is exactly the accident that hid the
        # defect in the first place.
        declared = "cc-by-nc-sa-4.0"
        self.assertNotEqual(declared, document_license_of("ptwiki_lead"))
        with tempfile.TemporaryDirectory() as raw:
            tmp = Path(raw)
            self._pools(tmp, document_license=declared)
            self._main(tmp, seen_texts=[])
            records, governance = self._outputs(tmp)

        by_source: dict[str, set[str]] = {}
        for record in records:
            provenance = record["provenance"]
            by_source.setdefault(provenance["sourceId"], set()).add(
                provenance["licenseId"]
            )
        self.assertEqual(by_source["src_wikipedia_pt"], {declared})
        # And no row of a source outside the frame reached the corpus at all: the loader
        # never opened the Carolina pool the fixture also wrote.
        self.assertNotIn("src_carolina", by_source)
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

    The extractor reads the availability element per document against a fail-closed
    allowlist (C1), and until now the assembler threw that reading away: it looked the
    licence up from the row's stratum, so every record of a base said that base's usual
    licence whatever its own document declared. These tests are about the rest of the
    journey, and they hand the builder a document licence the stratum would NOT have
    produced — otherwise the constant and the reading agree and nothing is measured.
    """

    def _candidate(self, license_id: str | None, source: str) -> dict:
        from group_axes import NO_SINGLE_AUTHOR, known, not_applicable

        candidate = {
            "candidateId": f"cand_{source}_0001",
            "text": PROSE_60,
            "wordCount": 60,
            "domainSource": source,
            "meta": {
                "dateField": "teiHeader/publicationStmt/date",
                "observedValue": "2019-05-04",
                "snapshot": "carolina" if source.startswith("carolina") else "ptwiki",
                "sourceMaterialBatch": "smb_ptwiki-20220301",
                "extractionRun": FIXTURE_EXTRACTION_RUN,
                "groupAxes": {
                    "source": known(f"doc_{source}"),
                    "author": not_applicable(NO_SINGLE_AUTHOR),
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
        candidate = self._candidate(None, "ptwiki_lead")
        with self.assertRaises(MissingDocumentLicense) as caught:
            human_record(candidate, "ptwiki", None)
        message = str(caught.exception)
        self.assertIn("cand_ptwiki_lead_0001", message)
        self.assertIn("licenseId", message)

    def test_the_license_the_document_declared_reaches_the_record(self) -> None:
        from assemble_corpus import human_record

        # `cc-by-nc-sa-4.0` on an ENCYCLOPEDIC row, which is the case the old code could
        # not express: the stratum lookup said `cc-by-sa-4.0` for every ptwiki document, so
        # a document declaring anything else was overwritten on the way in.
        declared = "cc-by-nc-sa-4.0"
        self.assertNotEqual(declared, document_license_of("ptwiki_lead"))
        entries: list[dict] = []
        record = human_record(
            self._candidate(declared, "ptwiki_lead"),
            "ptwiki",
            None,
            evidence_sink=entries,
        )
        self.assertEqual(record["provenance"]["licenseId"], declared)
        # And the label-evidence registration says the same thing, because the licence is
        # part of what the entry digest covers.
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0]["licenseId"], declared)
        self.assertIn("cc-by-nc-sa-4_0", entries[0]["entryId"])

    def test_a_license_the_inventory_cannot_publish_drops_the_row_by_name(self) -> None:
        from assemble_corpus import MissingDocumentLicense, human_record

        candidate = self._candidate("cc-by-4.0", "ptwiki_lead")
        with self.assertRaises(MissingDocumentLicense) as caught:
            human_record(candidate, "ptwiki", None)
        message = str(caught.exception)
        self.assertIn("cand_ptwiki_lead_0001", message)
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
        candidate = self._candidate("wtfpl-2.0", "ptwiki_lead")
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
            candidate = self._candidate(license_id, "ptwiki_lead")
            candidate["candidateId"] = f"cand_{license_id}"
            human_record(candidate, "ptwiki", None, evidence_sink=entries)
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

    # Invisible code points as ESCAPES, never as themselves — a literal ZWSP in a fixture
    # is a test nobody can review and an editor can delete without a diff.
    _ZWSP = "\u200b"
    _NBSP = "\u00a0"
    _LRM = "\u200e"
    _SOFT_HYPHEN = "\u00ad"
    _C1_CONTROL = "\u0083"
    _SECTION_SIGN = "\u00a7"
    _REPLACEMENT = "\ufffd"

    def test_anomalous_whitespace_is_named_spacing_anomaly(self) -> None:
        import artifact_gate

        # `common.normalize_text` collapses `[ \t]+` inside a line and strips every line,
        # and every pool written through `CandidateWriter.offer` has run it — so a space
        # run reaching the gate means a writer that skipped it. `make_mixed.emit` is that
        # writer: 185 of its 2.135 AI spans carry one, against 0 of 11.000 ptwiki rows.
        run = artifact_gate.detections_in("Texto com espaco  duplo. " + self._clean(24))
        self.assertIn(artifact_gate.DETECTION_SPACING, run)
        self.assertEqual(["space-run"], run[artifact_gate.DETECTION_SPACING])
        trailing = artifact_gate.detections_in(
            "Primeira linha \nsegunda linha. " + self._clean(25)
        )
        self.assertEqual(
            ["trailing-space-before-newline"],
            trailing[artifact_gate.DETECTION_SPACING],
        )

    def test_a_space_before_punctuation_is_not_a_spacing_anomaly(self) -> None:
        import artifact_gate

        # MEASURED AND REFUSED, which is why it is pinned: the shape fires on 7,15 % of the
        # in-frame human rows and 0,55 % of the generated ones — 13 times more often on the
        # class the label would be free against, and above the 2 % ceiling on the human
        # side. A probe whose direction is inverted would regenerate lanes for a shape
        # ptwiki writes.
        self.assertEqual(
            artifact_gate.detections_in(
                "Texto com espaco antes do ponto . " + self._clean(26)
            ),
            {},
        )

    def test_a_space_at_the_end_of_the_span_is_not_a_trailing_space(self) -> None:
        import artifact_gate

        # A mixed row's span is a SLICE, so a span that ends in a space may be where
        # `mixture.spans` cut it and not something the lane emitted. Measured, anchoring the
        # probe to the end of the text instead of a newline would have added 2 rows of
        # 2.135 and both are cuts.
        self.assertEqual(
            artifact_gate.detections_in(self._clean(27) + " "),
            {},
        )

    def test_broken_encoding_is_named_encoding_corruption(self) -> None:
        import artifact_gate

        single = artifact_gate.detections_in(
            "O cora" + "Ã" + self._SECTION_SIGN + "ao quebrado. " + self._clean(28)
        )
        self.assertEqual(
            ["mojibake-utf8-as-latin1"],
            single[artifact_gate.DETECTION_ENCODING],
        )
        double = artifact_gate.detections_in(
            "O cora" + "Ã" + self._C1_CONTROL + "ao quebrado. " + self._clean(29)
        )
        self.assertEqual(
            ["double-encoded-utf8"], double[artifact_gate.DETECTION_ENCODING]
        )
        lost = artifact_gate.detections_in(
            "O texto perdeu um " + self._REPLACEMENT + " caractere. " + self._clean(30)
        )
        self.assertEqual(
            ["replacement-character"], lost[artifact_gate.DETECTION_ENCODING]
        )

    def test_a_capital_a_tilde_of_ordinary_portuguese_is_not_mojibake(self) -> None:
        import artifact_gate

        # `Ã` and `Â` are pt-BR capitals — `SÃO`, `MÃE`, `CÂMARA` — and in every one of them
        # the next character is an ASCII letter. That is why the probe requires the
        # Latin-1/C1 tail and not the lead alone.
        self.assertEqual(
            artifact_gate.detections_in(
                "SÃO PAULO e a CÂMARA municipal. " + self._clean(31)
            ),
            {},
        )

    def test_an_invisible_code_point_is_named_invisible_character(self) -> None:
        import artifact_gate

        found = artifact_gate.detections_in(
            "Pala" + self._ZWSP + "vra partida. " + self._clean(32)
        )
        self.assertEqual(
            ["zero-width-space"], found[artifact_gate.DETECTION_INVISIBLE]
        )
        padded = artifact_gate.detections_in(
            "Texto" + self._NBSP + self._NBSP + "com enchimento. " + self._clean(33)
        )
        self.assertEqual(
            ["no-break-space-run"], padded[artifact_gate.DETECTION_INVISIBLE]
        )

    def test_one_no_break_space_is_typography_and_not_an_artifact(self) -> None:
        import artifact_gate

        # A single NBSP is the one between a number and its unit, and pt Wikipedia writes it
        # in 1,45 % of the in-frame human rows against 0,005 % of the generated ones. Probed
        # bare it put the line-level union over the human class at 2,18 % — above the
        # ceiling — so the gate would have refused a lane for being as clean as the negative
        # class. The RUN is what padding produces: 0,04 % human, 0 generated.
        self.assertEqual(
            artifact_gate.detections_in(
                "A cidade tem 468" + self._NBSP + "km de estradas. " + self._clean(34)
            ),
            {},
        )

    def test_markdown_syntax_is_named_markdown_formatting(self) -> None:
        import artifact_gate

        # The highest-yield detection of the six: 0,11 % of the in-frame human rows against
        # 44,72 % of the 19.673 `ai` rows.
        emphasis = artifact_gate.detections_in(
            "O termo **central** do assunto. " + self._clean(35)
        )
        self.assertEqual(
            ["emphasis-double-asterisk"],
            emphasis[artifact_gate.DETECTION_MARKDOWN],
        )
        listing = artifact_gate.detections_in(
            "Os pontos:\n- primeiro item\n- segundo item\n" + self._clean(36)
        )
        self.assertEqual(["list-marker"], listing[artifact_gate.DETECTION_MARKDOWN])
        fence = artifact_gate.detections_in(
            "Segue o exemplo:\n```\numa linha\n```\n" + self._clean(37)
        )
        self.assertEqual(["code-fence"], fence[artifact_gate.DETECTION_MARKDOWN])
        table = artifact_gate.detections_in(
            "| coluna | outra |\n| --- | --- |\n| a | b |\n" + self._clean(38)
        )
        self.assertIn("pipe-table", table[artifact_gate.DETECTION_MARKDOWN])

    def test_a_dash_inside_a_sentence_is_not_a_list_marker(self) -> None:
        import artifact_gate

        # The list probes are anchored to the START of a line, which is what keeps an
        # ordinary dash out: 0,06 % of the in-frame human rows against 22,06 % of the `ai`
        # rows.
        self.assertEqual(
            artifact_gate.detections_in(
                "O termo - usado assim - nao abre lista. " + self._clean(39)
            ),
            {},
        )

    def test_a_title_line_is_named_heading_line(self) -> None:
        import artifact_gate

        atx = artifact_gate.detections_in("## Introducao\n" + self._clean(40))
        self.assertEqual(["atx-heading"], atx[artifact_gate.DETECTION_HEADING])
        # The probes read `fold_lines`, which strips accents, so `Título:` arrives as
        # `titulo:` and the list carries one spelling of each word.
        label = artifact_gate.detections_in("Título: o assunto\n" + self._clean(41))
        self.assertEqual(["label-line"], label[artifact_gate.DETECTION_HEADING])
        numbered = artifact_gate.detections_in(
            "1. Contexto historico\n" + self._clean(42)
        )
        self.assertEqual(
            ["section-numbering"], numbered[artifact_gate.DETECTION_HEADING]
        )

    def test_a_reproduced_instruction_is_named_prompt_boilerplate(self) -> None:
        import artifact_gate

        # Where `prompt-echo` cannot reach: that detection is derived from this
        # repository's generator constants, so it only ever finds a prompt somebody here or
        # in `madras` issued. These frames are the SHAPE of an instruction, and they catch a
        # lane whose upstream prompt this repository never sees.
        directive = artifact_gate.detections_in(
            "Escreva um texto sobre o assunto. " + self._clean(43)
        )
        self.assertEqual(
            ["write-the-artifact"], directive[artifact_gate.DETECTION_BOILERPLATE]
        )
        role = artifact_gate.detections_in(
            "Atue como um especialista na materia. " + self._clean(44)
        )
        self.assertEqual(["assume-a-role"], role[artifact_gate.DETECTION_BOILERPLATE])

    def test_an_ordinary_verb_of_prose_is_not_a_role_assignment(self) -> None:
        import artifact_gate

        # Measured false positive: a bare "atue como" is a verb of ordinary prose and
        # reached 2 in-frame human rows. The ROLE noun is what makes the frame an
        # instruction.
        self.assertEqual(
            artifact_gate.detections_in(
                "Atue como mediador do conflito entre as partes. " + self._clean(45)
            ),
            {},
        )

    def test_a_line_with_two_detections_is_one_contaminated_line(self) -> None:
        import artifact_gate

        # A4's 2 % is a fraction of LINES. A line that echoes the prompt AND carries a
        # heading is ONE contaminated line with two named reasons — the denominator of the
        # ceiling cannot grow with the number of things wrong with a row.
        #
        # The numbers are chosen so the difference changes the VERDICT: 2 of 100 is exactly
        # the ceiling and passes, while counting the same two rows once per detection gives
        # 4 % and refuses.
        both = "## Resposta\nResponda apenas com o texto, sem titulo e sem comentarios. "
        named = artifact_gate.detections_in(both + self._clean(46))
        self.assertEqual(
            [artifact_gate.DETECTION_PROMPT_ECHO, artifact_gate.DETECTION_HEADING],
            list(named),
        )
        lines = [
            self._line(
                both + self._clean(index) if index < 2 else self._clean(index),
                index=index,
            )
            for index in range(100)
        ]
        report = artifact_gate.measure(lines)
        entry = report["families"][0]
        self.assertEqual((entry["contaminated"], entry["lines"]), (2, 100))
        self.assertEqual(entry["verdict"], artifact_gate.VERDICT_CLEAR)
        # Both reasons are still NAMED on the same two rows, and they sum to more than the
        # contaminated count — which is the whole point of counting per line.
        self.assertEqual(
            entry["byDetection"][artifact_gate.DETECTION_PROMPT_ECHO]["lines"], 2
        )
        self.assertEqual(
            entry["byDetection"][artifact_gate.DETECTION_HEADING]["lines"], 2
        )
        self.assertEqual(
            sum(counts["lines"] for counts in entry["byDetection"].values()), 4
        )

    def _family_on_a_heading_at(self, contaminated: int, total: int) -> dict:
        import artifact_gate

        return artifact_gate.measure(
            [
                self._line(
                    "## Introducao\n" + self._clean(index)
                    if index < contaminated
                    else self._clean(index),
                    index=index,
                )
                for index in range(total)
            ]
        )

    def test_a_family_over_the_ceiling_on_an_added_detection_regenerates_its_lane(
        self,
    ) -> None:
        import artifact_gate

        over = self._family_on_a_heading_at(21, 1000)
        entry = over["families"][0]
        self.assertEqual((entry["contaminated"], entry["lines"]), (21, 1000))
        self.assertAlmostEqual(entry["fraction"], 0.021)
        self.assertEqual(entry["verdict"], artifact_gate.VERDICT_REGENERATE_LANE)
        self.assertEqual(over["lanesToRegenerate"], ["codex"])
        with self.assertRaises(artifact_gate.ArtifactContamination) as caught:
            artifact_gate.assert_no_lane_needs_regeneration(over)
        message = str(caught.exception)
        self.assertIn("21/1000", message)
        self.assertIn("2.10%", message)
        # The ADDED detection is what the refusal names, so the six are inside the verdict
        # and not a second report beside it.
        self.assertIn(artifact_gate.DETECTION_HEADING, message)
        under = self._family_on_a_heading_at(19, 1000)
        self.assertEqual(
            under["families"][0]["verdict"], artifact_gate.VERDICT_CLEAR
        )
        self.assertEqual(under["lanesToRegenerate"], [])
        artifact_gate.assert_no_lane_needs_regeneration(under)

    def test_the_report_publishes_all_ten_detection_names(self) -> None:
        import artifact_gate

        # The report's inventory IS the list the verdict was computed over, so a detection
        # added to the module and left out of the canonical order would be measured and
        # never published.
        self.assertEqual(
            artifact_gate.measure([])["detections"],
            [
                "prompt-echo",
                "refusal",
                "metaconversation",
                "harness-signature",
                "spacing-anomaly",
                "encoding-corruption",
                "invisible-character",
                "markdown-formatting",
                "heading-line",
                "prompt-boilerplate",
            ],
        )
        for detection, probes, _ in artifact_gate._ADDED_PROBES:
            self.assertIn(detection, artifact_gate.DETECTION_NAMES, detection)
            self.assertNotEqual(probes, (), detection)

    def _in_frame_human_shapes(self) -> tuple[tuple[str, int], ...]:
        """The shapes the in-frame human class writes, with the count each has per 1.000.

        NOT the ptwiki pool: `benchmark/data/` is outside the repository, so what a
        checkout can hold is the pool's measured composition. Every rate is rounded UP to a
        whole row, which puts the fixture's union (1,0 %) a little above the pool's measured
        0,809 % — the safe direction for a ceiling guard.

        The four shapes the measurement REFUSED as probes are in here at their measured
        rates, and that is what makes re-adding a refused probe turn the guard red.
        """
        return (
            # 7,15 % — a space before punctuation, the refused probe's shape
            ("A vila foi fundada em 1554 , conforme o registro da paroquia. ", 72),
            # 1,63 % — a short line closed by a colon, refused as a heading probe
            ("Ver tambem:\nA divisao administrativa do municipio. ", 16),
            # 1,45 % — ONE no-break space, the one between a number and its unit
            ("O rio percorre 320" + self._NBSP + "km ate a foz. ", 15),
            # 0,38 % — a zero-width space, which comes from the wiki source
            ("A grafia do topo" + self._ZWSP + "nimo mudou em 1943. ", 4),
            # 0,12 % — a direction mark, from a quotation in Arabic script
            ("O titulo aparece como " + self._LRM + "kitab al-jabr na fonte. ", 1),
            # 0,10 % — one line with two pipes: pt Wikipedia writes table syntax
            ("| populacao | 12 mil habitantes na ultima contagem. ", 1),
            # 0,06 % — a list marker, from a list section of the article
            ("Bairros:\n- centro historico da cidade\n", 1),
            # 0,055 % — a soft hyphen, from a hyphenated heading
            ("A palavra hidro" + self._SOFT_HYPHEN + "grafia esta no verbete. ", 1),
            # 0,055 % — a section number
            ("2. Historia do municipio\n", 1),
            # 0,045 % — asterisk emphasis around a scientific name
            ("O nome cientifico *Panthera onca* consta do verbete. ", 1),
            # 0,045 % — an article ABOUT the language, which is what these rows are
            ("O verbete descreve variantes em portugues brasileiro. ", 1),
        )

    def test_the_union_over_the_in_frame_human_class_stays_below_the_ceiling(
        self,
    ) -> None:
        import artifact_gate

        # THE CALIBRATION RULE, as a guard instead of a sentence: run the gate over the
        # human class the frame publishes and the verdict has to be `clear`. A probe whose
        # direction is inverted — more frequent in the human class than in the generated
        # one — puts the negative class itself over the ceiling, and a gate in that state
        # regenerates lanes for being human-like. The bare NBSP probe did exactly that, at
        # 2,18 % against a 2 % ceiling.
        texts: list[str] = []
        for shape, count in self._in_frame_human_shapes():
            for _ in range(count):
                texts.append(shape + self._clean(len(texts)))
        shaped = len(texts)
        while len(texts) < 1000:
            texts.append(self._clean(len(texts)))
        report = artifact_gate.measure(
            [self._line(text, index=index) for index, text in enumerate(texts)]
        )
        entry = report["families"][0]
        self.assertEqual((shaped, entry["lines"]), (114, 1000))
        detected = {
            name: counts["lines"] for name, counts in entry["byDetection"].items()
        }
        self.assertLess(
            Fraction(entry["contaminated"], entry["lines"]),
            artifact_gate.CONTAMINATION_CEILING,
            f"the in-frame human class is at {entry['contaminated']}/1000, at or above "
            f"the ceiling — which means the gate refuses a lane for being as clean as "
            f"the negative class. Detections: {detected}",
        )
        self.assertEqual(entry["verdict"], artifact_gate.VERDICT_CLEAR)
        artifact_gate.assert_no_lane_needs_regeneration(report)
        # The fixture CARRIES the refused shapes at their measured counts. Without them the
        # guard is green whatever probe is added, and the rule stops being enforced.
        self.assertEqual(sum(1 for text in texts if " ," in text), 72)
        self.assertEqual(sum(1 for text in texts if self._NBSP in text), 15)
        self.assertEqual(sum(1 for text in texts if text.startswith("Ver tambem:")), 16)

    def _characters_the_inference_normalization_removes(self) -> set[str]:
        """The code points `contracts/text-normalization.ts` drops before tokenization.

        Parsed from the contract's own set literal rather than copied, because a copy is a
        second list that goes stale: the point of the test below is that the gate keeps
        accusing whatever THAT file removes.
        """
        import artifact_gate

        contract = (
            Path(artifact_gate.__file__).resolve().parents[2]
            / "contracts"
            / "text-normalization.ts"
        )
        source = contract.read_text(encoding="utf-8")
        # The DECLARATION and not the first mention: the file's header comment names the
        # set two hundred lines above it, and anchoring there reads the confusable table.
        start = source.index("export const REMOVED_INVISIBLE_CHARACTERS")
        body = source[start : source.index("]);", start)]
        return {
            chr(int(code_point, 16))
            for code_point in re.findall(r'"\\u([0-9A-Fa-f]{4})"', body)
        }

    def test_the_invisible_detection_fires_on_what_the_normalization_removes(
        self,
    ) -> None:
        import artifact_gate

        # THE HEART OF D13. `contracts/text-normalization.ts` removes these code points
        # BEFORE tokenization, so the detector may never see one — and the gate has to keep
        # accusing them, because what it measures is not what the model sees: it is
        # contamination of the LANE. A lane that emits a mark the human class does not hands
        # the label away for free whatever the tokenizer later erases, and A4's remedy is to
        # regenerate the lane, not to filter the character.
        removed = self._characters_the_inference_normalization_removes()
        self.assertGreaterEqual(len(removed), 20, "the contract's set failed to parse")
        accused: dict[str, list[str]] = {}
        for code_point in sorted(removed):
            found = artifact_gate.detections_in(
                "Pala" + code_point + "vra seguinte. " + self._clean(47)
            )
            if artifact_gate.DETECTION_INVISIBLE in found:
                accused[code_point] = found[artifact_gate.DETECTION_INVISIBLE]
        # EVERY code point of the contract's set, and not a named sample of it: a sample
        # leaves a code point added to the contract with no probe here silently unaccused,
        # and unaccused is precisely the hole — the inference path erases it before the
        # model while the lane that padded with it keeps its rows.
        self.assertEqual(
            sorted(hex(ord(char)) for char in removed if char not in accused),
            [],
            "the inference normalization removes these before tokenization and no probe "
            "of artifact_gate.INVISIBLE_PROBES accuses them, so a lane could pad with "
            "one and hand the label away for free",
        )
        self.assertEqual(accused.get(self._ZWSP), ["zero-width-space"])
        for code_point, probe in (
            ("\u200c", "zero-width-non-joiner"),
            ("\u00ad", "soft-hyphen"),
            ("\ufeff", "byte-order-mark"),
            ("\u2060", "word-joiner"),
            ("\u200e", "direction-mark"),
            ("\u200f", "direction-mark"),
            ("\u202e", "direction-mark"),
            ("\u061c", "direction-mark"),
            ("\u034f", "combining-grapheme-joiner"),
            ("\u115f", "hangul-filler"),
            ("\u3164", "hangul-filler"),
            ("\u180e", "mongolian-vowel-separator"),
            ("\u2062", "invisible-operator"),
        ):
            with self.subTest(code_point=hex(ord(code_point))):
                self.assertIn(code_point, removed)
                self.assertEqual(accused.get(code_point), [probe])
        # And the other half of the same fact: the text the MODEL gets — the one with the
        # character removed — trips nothing. The gate is accusing the character and not
        # something else in the fixture.
        self.assertEqual(
            artifact_gate.detections_in("Pala" + "vra seguinte. " + self._clean(47)),
            {},
        )

    def test_no_probe_is_spelled_with_a_literal_invisible_character(self) -> None:
        import artifact_gate

        # A probe written as the character itself is a probe nobody can review in a diff and
        # an editor can delete without leaving one. Asserted over the module's own source,
        # because that is the only place the spelling exists.
        #
        # The forbidden set is DERIVED from the contract's own removal set rather than
        # listed here: a hand-kept list goes stale exactly when a probe for a new invisible
        # code point is added, which is the moment the rule has to hold. The three extras
        # are the marks the gate probes and the contract does not remove unconditionally.
        source = Path(artifact_gate.__file__).resolve().read_text(encoding="utf-8")
        forbidden = (
            self._characters_the_inference_normalization_removes()
            | {chr(point) for point in range(0x0080, 0x00A1)}
            | {"\u200d", "\u202f", "\ufffd"}
        )
        present = sorted(hex(ord(char)) for char in forbidden if char in source)
        self.assertEqual(present, [])
