"""Streams a MediaWiki pages-articles dump (.xml.bz2) into candidates.

Takes ONLY main-namespace, non-redirect articles; the candidate text is the
LEAD SECTION (prose before the first heading) after a conservative wikitext
clean — anything that still looks like markup is dropped rather than repaired.
The revision timestamp (last edit as of the dump) anchors the temporal cutoff;
using a pre-Nov/2022 snapshot keeps the whole stream pre-ChatGPT by
construction, and the cutoff stays as defense in depth. Stdlib only.

Usage:
  python benchmark/lab/extract_wikipedia.py \
    --input <ptwiki-...-pages-articles.xml.bz2> \
    --output benchmark/data/candidates/wikipedia.jsonl \
    [--limit 4000] [--sample-rate 40]
"""

from __future__ import annotations

import argparse
import bz2
import re
import xml.etree.ElementTree as ET
from pathlib import Path

from common import CandidateWriter, parse_iso_date, read_id_file

SOURCE_ID = "src_wikipedia_pt"
LICENSE_ID = "cc-by-sa-4.0"
MW_NS = "{http://www.mediawiki.org/xml/export-0.10/}"

_COMMENT = re.compile(r"<!--.*?-->", re.DOTALL)
_REF = re.compile(r"<ref[^>/]*/>|<ref[^>]*>.*?</ref>", re.DOTALL | re.IGNORECASE)
_TAG = re.compile(r"</?[A-Za-z][^>]*>")
_FILE_LINK = re.compile(
    r"\[\[(?:Ficheiro|File|Imagem|Image|Categoria|Category):[^\]]*\]\]",
    re.IGNORECASE,
)
_WIKILINK = re.compile(r"\[\[(?:[^|\]]*\|)?([^\]]*)\]\]")
_EXTLINK = re.compile(r"\[https?://[^\s\]]+\s*([^\]]*)\]")
_BOLD_ITALIC = re.compile(r"'{2,5}")


def strip_templates(text: str) -> str:
    """Removes {{...}} templates and {| ... |} tables, honoring nesting."""
    out: list[str] = []
    depth = 0
    index = 0
    length = len(text)
    while index < length:
        two = text[index : index + 2]
        if two == "{{" or two == "{|":
            depth += 1
            index += 2
        elif (two == "}}" or two == "|}") and depth > 0:
            depth -= 1
            index += 2
        elif depth == 0:
            out.append(text[index])
            index += 1
        else:
            index += 1
    return "".join(out)


def lead_section(wikitext: str) -> str:
    """The prose before the first heading, cleaned conservatively."""
    text = wikitext.split("\n==", 1)[0]
    text = _COMMENT.sub("", text)
    text = _REF.sub("", text)
    text = strip_templates(text)
    text = _FILE_LINK.sub("", text)
    text = _WIKILINK.sub(r"\1", text)
    text = _EXTLINK.sub(r"\1", text)
    text = _TAG.sub("", text)
    text = _BOLD_ITALIC.sub("", text)
    lines = [
        line
        for line in text.split("\n")
        # Prose only: drop list/table/indent leftovers rather than repairing.
        if line.strip() and not line.lstrip().startswith(("*", "#", ":", ";", "|", "{", "!"))
    ]
    return "\n\n".join(lines)


def extract(input_path: Path, writer: CandidateWriter) -> None:
    with bz2.open(str(input_path), "rb") as stream:
        for _, element in ET.iterparse(stream, events=("end",)):
            if element.tag != f"{MW_NS}page":
                continue
            try:
                ns = element.findtext(f"{MW_NS}ns")
                redirect = element.find(f"{MW_NS}redirect")
                if ns == "0" and redirect is None:
                    page_id = element.findtext(f"{MW_NS}id") or "0"
                    revision = element.find(f"{MW_NS}revision")
                    timestamp = (
                        revision.findtext(f"{MW_NS}timestamp") if revision is not None else None
                    )
                    wikitext = (
                        revision.findtext(f"{MW_NS}text") if revision is not None else None
                    )
                    if wikitext:
                        writer.offer(
                            natural_key=f"ptwiki:{page_id}",
                            license_id=LICENSE_ID,
                            created_at=parse_iso_date(timestamp or ""),
                            raw_text=lead_section(wikitext),
                            domain_source="ptwiki_lead",
                            meta={},
                        )
            finally:
                element.clear()
            if writer.full:
                break


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=4000)
    parser.add_argument("--sample-rate", type=int, default=40)
    parser.add_argument(
        "--exclude",
        type=Path,
        default=None,
        help="arquivo de candidate_ids (um por linha) a pular na emissão — "
        "extração fresca disjunta do que já foi usado",
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
        extract(args.input, writer)
    finally:
        writer.close()
    print(f"{SOURCE_ID}: kept={writer.stats.kept} scanned={writer.stats.scanned}")


if __name__ == "__main__":
    main()
