"""Streams Corpus Carolina TEI zips into human-text candidates.

Reads every `Corpus/<typology>/**.xml` member EXCEPT the wikis typology (we
ingest Wikipedia directly; taking both would create cross-source near-dups).
For each <TEI> document it reads the CAROLINA-level availability (license) and
the `<date type="Download">` — the download date anchors the pre-ChatGPT
guarantee per document, which is what makes the v2.0 (Bea) package usable — and
keeps only documents whose license is in the allowlist. Only the body text and
non-identifying metadata (typology) are extracted; header names/authors are
never read. Stdlib only; memory-safe via iterparse + clearing.

Usage:
  python benchmark/lab/extract_carolina.py \
    --input <archive.zip> --output benchmark/data/candidates/carolina.jsonl \
    [--limit 4000] [--sample-rate 1]
"""

from __future__ import annotations

import argparse
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import group_axes
from common import CandidateWriter, parse_iso_date, read_id_file

SOURCE_ID = "src_carolina"
TEI_NS = "{http://www.tei-c.org/ns/1.0}"
EXCLUDED_TYPOLOGY_DIRS = {"wikis"}
# The date field as the TEI header names it, for the record's labelEvidenceRef. The
# download date is what makes the v2.0 (Bea) package usable at all — the package
# carries TEI dates from 2024 and 2025, so this filter is load-bearing, not a
# formality.
DATE_FIELD = "TEI@teiHeader/fileDesc/publicationStmt/date[@type=Download]"
SNAPSHOT = "carolina"

# Carolina availability license -> our inventory licenseId. Fail-closed: a
# license outside this map drops the document (counted as drop_license).
LICENSE_MAP = {
    "cc by-nc-sa 4.0": "cc-by-nc-sa-4.0",
    "cc by-sa 4.0": "cc-by-sa-4.0",
    "cc by 4.0": "cc-by-4.0",
    "public domain": "public-domain",
}


def typology_dir(member_name: str) -> str:
    parts = member_name.split("/")
    return parts[1] if len(parts) > 2 else ""


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")


def parse_document(element: ET.Element) -> tuple[str | None, str | None, str]:
    """Returns (license_key, download_date_text, body_text) for one <TEI>."""
    license_key: str | None = None
    download_date: str | None = None

    header = element.find(f"{TEI_NS}teiHeader")
    if header is not None:
        file_desc = header.find(f"{TEI_NS}fileDesc")
        publication = (
            file_desc.find(f"{TEI_NS}publicationStmt") if file_desc is not None else None
        )
        if publication is not None:
            for date in publication.findall(f"{TEI_NS}date"):
                if date.get("type") == "Download" and date.text:
                    download_date = date.text
            availability = publication.find(f"{TEI_NS}availability")
            license_el = (
                availability.find(f"{TEI_NS}licence")
                if availability is not None
                else None
            )
            if license_el is None and availability is not None:
                license_el = availability.find(f"{TEI_NS}license")
            if license_el is not None and (license_el.text or "").strip():
                license_key = license_el.text.strip().lower()

    body = element.find(f"{TEI_NS}text/{TEI_NS}body")
    paragraphs = (
        ["".join(p.itertext()) for p in body.iter(f"{TEI_NS}p")] if body is not None else []
    )
    return license_key, download_date, "\n\n".join(paragraphs)


def extract(
    input_path: Path,
    writer: CandidateWriter,
    per_typology_limit: int | None = None,
) -> None:
    """Fills candidates per typology (capped) so no typology monopolizes the
    overall limit just for coming first in the archive order."""
    with zipfile.ZipFile(str(input_path)) as archive:
        members = [
            info
            for info in archive.infolist()
            if not info.is_dir()
            and info.filename.endswith(".xml")
            and typology_dir(info.filename) not in EXCLUDED_TYPOLOGY_DIRS
        ]
        kept_by_typology: dict[str, int] = {}
        for info in members:
            typology = slug(typology_dir(info.filename)) or "unknown"
            if (
                per_typology_limit is not None
                and kept_by_typology.get(typology, 0) >= per_typology_limit
            ):
                continue
            with archive.open(info) as stream:
                sequence = 0
                for _, element in ET.iterparse(stream, events=("end",)):
                    if element.tag != f"{TEI_NS}TEI":
                        continue
                    sequence += 1
                    kept_before = writer.stats.kept
                    license_key, download_date, text = parse_document(element)
                    license_id = LICENSE_MAP.get(license_key or "")
                    if license_id is None:
                        writer.stats.scanned += 1
                        writer.stats.drop_license += 1
                    else:
                        created = parse_iso_date(download_date or "")
                        writer.offer(
                            # UNCHANGED: the candidate id derives from this string.
                            natural_key=f"carolina:{info.filename}:{sequence}",
                            license_id=license_id,
                            created_at=created,
                            raw_text=text,
                            domain_source=f"carolina_{typology}",
                            meta={
                                "typology": typology,
                                "dateField": DATE_FIELD,
                                "observedValue": (
                                    created.isoformat() if created else ""
                                ),
                                "snapshot": SNAPSHOT,
                                "groupAxes": {
                                    # The MEMBER FILE, which is the axis the plan
                                    # fixes for Carolina. It is a real cluster and
                                    # not a formality: one member holds many TEI
                                    # documents drawn from one crawl of one domain,
                                    # so they share topic, register and often
                                    # boilerplate. 361 non-wiki members carry the
                                    # whole Carolina contribution, so these are large
                                    # clusters — exactly the dependence `g_<recordId>`
                                    # erased.
                                    "source": group_axes.known(
                                        "carolina_member_"
                                        + group_axes.axis_token(info.filename)
                                    ),
                                    # This extractor never reads TEI header names (see
                                    # its docstring and parse_document, which touches
                                    # only availability, the download date and the
                                    # body), so no author identifier ever enters the
                                    # pipeline. notApplicable states that; `unknown`
                                    # would claim we tried and failed.
                                    "author": group_axes.not_applicable(
                                        group_axes.NO_AUTHOR_READ
                                    ),
                                },
                            },
                        )
                    if writer.stats.kept > kept_before:
                        kept_by_typology[typology] = (
                            kept_by_typology.get(typology, 0) + 1
                        )
                    element.clear()
                    if writer.full:
                        return
                    if (
                        per_typology_limit is not None
                        and kept_by_typology.get(typology, 0) >= per_typology_limit
                    ):
                        break


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=4000)
    parser.add_argument("--sample-rate", type=int, default=1)
    parser.add_argument("--per-typology-limit", type=int, default=None)
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
        extract(args.input, writer, per_typology_limit=args.per_typology_limit)
    finally:
        writer.close()
    print(f"{SOURCE_ID}: kept={writer.stats.kept} scanned={writer.stats.scanned}")


if __name__ == "__main__":
    main()
