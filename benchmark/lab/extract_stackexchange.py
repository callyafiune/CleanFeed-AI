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

from common import CandidateWriter, parse_iso_date

SOURCE_ID = "src_ptso"
LICENSE_ID = "cc-by-sa-4.0"
BLOCK_TAGS = {"p", "div", "li", "blockquote", "br", "h1", "h2", "h3"}
DROP_TAGS = {"code", "pre", "script", "style"}


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


def extract(input_path: Path, writer: CandidateWriter) -> None:
    for _, element in ET.iterparse(str(input_path), events=("end",)):
        if element.tag != "row":
            continue
        post_type = element.get("PostTypeId")
        if post_type in {"1", "2"}:
            body = element.get("Body") or ""
            created = parse_iso_date(element.get("CreationDate") or "")
            post_id = element.get("Id") or "0"
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
                    natural_key=f"ptso:{post_id}",
                    license_id=LICENSE_ID,
                    created_at=created,
                    raw_text=text,
                    domain_source="ptso_qa",
                    meta={"postType": "question" if post_type == "1" else "answer"},
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
    args = parser.parse_args()

    writer = CandidateWriter(
        args.output,
        source_id=SOURCE_ID,
        limit=args.limit,
        sample_rate=args.sample_rate,
    )
    try:
        extract(args.input, writer)
    finally:
        writer.close()
    print(f"{SOURCE_ID}: kept={writer.stats.kept} scanned={writer.stats.scanned}")


if __name__ == "__main__":
    main()
