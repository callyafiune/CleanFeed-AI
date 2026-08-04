"""Streams a Stack Exchange Posts.xml into human-text candidates.

Keeps questions (PostTypeId=1) and answers (PostTypeId=2) created BEFORE the
ChatGPT cutoff, strips the HTML body (dropping <code>/<pre> content entirely so
programming payloads never count as prose), and routes everything through the
shared candidate pipeline (normalize -> word window -> PII drop -> deterministic
sample). Stdlib only; memory-safe via iterparse + element clearing.

Usage:
  python benchmark/lab/extract_stackexchange.py \
    --input <Posts.xml> --output benchmark/data/candidates/ptso.jsonl \
    [--limit 4000] [--sample-rate 7]
"""

from __future__ import annotations

import argparse
import xml.etree.ElementTree as ET
from html import unescape
from html.parser import HTMLParser
from pathlib import Path

import group_axes
from common import CandidateWriter, parse_iso_date, read_id_file
from pseudonymize import (
    ClusterKeyring,
    PERSON_PURPOSE,
    load_cluster_keyring,
    require_keyring,
)

SOURCE_ID = "src_ptso"
LICENSE_ID = "cc-by-sa-4.0"
BLOCK_TAGS = {"p", "div", "li", "blockquote", "br", "h1", "h2", "h3"}
DROP_TAGS = {"code", "pre", "script", "style"}
# The date field AS IT IS NAMED AT SOURCE, for the record's labelEvidenceRef. The
# whole point of that field is that an auditor can go back to the dump and read the
# same attribute, so it names the file and the attribute rather than describing them.
DATE_FIELD = "Posts.xml@CreationDate"
# The snapshot token this extractor stamps. It is NO LONGER in
# benchmark/preregistration-v4.json humanSources.snapshots: decision A1 (2026-07-31)
# moved it to humanSources.blockedSnapshots, because the 2024 access terms of the dump
# exclude LLM-training projects and no verifiable legal disposition exists.
#
# This extractor is kept runnable on purpose, and that is a decision rather than an
# oversight: A1 is reversible if the disposition arrives, and deleting the extractor
# would put the cost of reversal on rediscovering how to read `Posts.xml`. What stops
# its output is downstream and fail-closed — `benchmark/schema.ts` refuses a record
# whose labelEvidenceRef.snapshot is not frozen, and `auditCorpusSources` blocks a
# manifest declaring `src_ptso` with SOURCE_BLOCKED_BY_ACCESS_TERMS. Running this
# script produces candidates that cannot be ingested.
SNAPSHOT = "pt-stackoverflow"


class BodyTextExtractor(HTMLParser):
    """Flattens post HTML to prose, dropping code/pre content entirely."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.parts: list[str] = []
        self._drop_depth = 0

    def handle_starttag(self, tag: str, attrs: object) -> None:
        if tag in DROP_TAGS:
            self._drop_depth += 1
        elif tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in DROP_TAGS and self._drop_depth > 0:
            self._drop_depth -= 1
        elif tag in BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if self._drop_depth == 0:
            self.parts.append(data)

    def text(self) -> str:
        return "".join(self.parts)


def html_to_text(body_html: str) -> str:
    extractor = BodyTextExtractor()
    extractor.feed(unescape(body_html))
    extractor.close()
    return extractor.text()


def thread_of(element: ET.Element) -> str:
    """The THREAD a post belongs to: its own Id for a question, ParentId for an
    answer.

    This is the dependence structure the corpus actually has and the v2 assembler
    could not express. A question and its eight answers discuss one problem, in one
    voice-community, often quoting each other — so they are one cluster, and a split
    that puts the question in `dev` and an answer in `test` has leaked. The
    old `g_<recordId>` made every post its own thread, which is why the blocked
    split found nothing to complain about.

    ParentId is read from the dump and not reconstructed: `<row Id="4"
    PostTypeId="2" ParentId="2" ...>` is verbatim what Posts.xml carries.
    """
    return element.get("ParentId") or element.get("Id") or "0"


def author_axis(element: ET.Element, keyring: ClusterKeyring) -> dict:
    """The post's account, pseudonymised — or `unknown` when there is none.

    `OwnerUserId` is absent on posts whose account was deleted and on posts made by
    the anonymous/community user. That is a real author who was not recovered, so it
    is `unknown` (the record becomes ineligible) and never a per-record token: a
    synthesized author is precisely the defect this task removes, and it would be
    worst here, where the missing value is not random — deleted accounts correlate
    with old and low-quality posts.
    """
    owner = element.get("OwnerUserId")
    if not owner:
        return group_axes.unknown(group_axes.AUTHOR_NOT_RECOVERED)
    return group_axes.known(keyring.pseudonym(PERSON_PURPOSE, owner))


def extract(
    input_path: Path,
    writer: CandidateWriter,
    keyring: ClusterKeyring | None = None,
) -> None:
    # BEFORE the first row is read: this source carries a person on a grouping
    # axis, so a run that cannot pseudonymise must fail on its arguments rather
    # than after streaming 748 MB and writing half a pool.
    keyring = require_keyring(keyring, "pt.stackoverflow (OwnerUserId)")
    for _, element in ET.iterparse(str(input_path), events=("end",)):
        if element.tag != "row":
            continue
        post_type = element.get("PostTypeId")
        if post_type in {"1", "2"}:
            body = element.get("Body") or ""
            created_raw = element.get("CreationDate") or ""
            created = parse_iso_date(created_raw)
            post_id = element.get("Id") or "0"
            thread_id = thread_of(element)
            author = author_axis(element, keyring)
            # Real-world bodies occasionally carry malformed markup (e.g. a
            # `<![a-zA-Z]>`-style marked section) that makes the stdlib parser
            # raise. One bad post must never abort the multi-GB run: drop it.
            try:
                text = html_to_text(body)
            except Exception:
                writer.stats.scanned += 1
                writer.stats.drop_other += 1
                text = None
            if text is not None:
                writer.offer(
                    # UNCHANGED, and load-bearing that it is unchanged: the
                    # candidate id is `src_ptso_<sha1(naturalKey)[:12]>`, so touching
                    # this string renumbers the corpus and breaks every pair
                    # reference and ledger row that names an id. Identity goes into
                    # `meta`, which the key never reads.
                    natural_key=f"ptso:{post_id}",
                    license_id=LICENSE_ID,
                    created_at=created,
                    raw_text=text,
                    domain_source="ptso_qa",
                    meta={
                        "postType": "question" if post_type == "1" else "answer",
                        # The label evidence, as the SOURCE names it: a v3 human row
                        # has to point at the date field it rests on, not merely
                        # carry a normalized millisecond count.
                        "dateField": DATE_FIELD,
                        "observedValue": created.isoformat() if created else "",
                        "snapshot": SNAPSHOT,
                        "groupAxes": {
                            "source": group_axes.known(f"ptso_thread_{thread_id}"),
                            "author": author,
                        },
                    },
                )
        element.clear()
        if writer.full:
            break


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=4000)
    parser.add_argument("--sample-rate", type=int, default=1)
    parser.add_argument(
        "--exclude",
        type=Path,
        default=None,
        help="arquivo de candidate_ids (um por linha) a pular na emissão — "
        "extração fresca disjunta do que já foi usado",
    )
    parser.add_argument(
        "--keyring",
        type=Path,
        default=None,
        help="cluster-exposure keyring (C3). OBRIGATÓRIO: o autor do post é dado "
        "pessoal e vai pseudonimizado por HMAC — não há caminho sem segredo",
    )
    args = parser.parse_args()

    writer = CandidateWriter(
        args.output,
        source_id=SOURCE_ID,
        limit=args.limit,
        sample_rate=args.sample_rate,
        exclude_ids=read_id_file(args.exclude) if args.exclude else None,
    )
    try:
        extract(args.input, writer, keyring=load_cluster_keyring(args.keyring))
    finally:
        writer.close()
    print(f"{SOURCE_ID}: kept={writer.stats.kept} scanned={writer.stats.scanned}")


if __name__ == "__main__":
    main()
