"""Streams Corpus Carolina TEI zips into human-text candidates.

Reads the `Corpus/<typology>/**.xml` members of the THREE typologies the declared
frame draws on, and no others (`FRAME_TYPOLOGIES`). For each <TEI> document it reads
the CAROLINA-level availability (license) and the `<date type="Download">` — the
download date anchors the pre-ChatGPT guarantee per document, which is what makes the
v2.0 (Bea) package usable — and keeps only documents whose license is in the
allowlist. Only the body text and non-identifying metadata (typology) are extracted;
header names/authors are never read. Stdlib only; memory-safe via iterparse +
clearing.

Usage:
  python benchmark/lab/extract_carolina.py \
    --input <archive.zip> --output benchmark/data/candidates/carolina.jsonl \
    --snapshot-version carolina-v2.0 \
    [--limit 4000] [--sample-rate 1] [--typologies judicial_branch,social_media]
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
# The typologies of the declared frame, as the archive's directory names slug to. Three
# of the four quota cells come out of this one package, one typology each, and each of
# them publishes its own FPR ceiling — so this list IS the sampling frame on the
# Carolina side, not a convenience filter.
FRAME_TYPOLOGIES: tuple[str, ...] = (
    "judicial_branch",
    "social_media",
    "university_domains",
)
# The typologies the package also holds and the frame does NOT draw on, with the reason
# each one is outside. Declared rather than deleted: an allowlist alone cannot tell a
# typology that was DECIDED against from one nobody has looked at, and the second case
# has to stop the run (see `TypologyOutOfFrame`).
OUT_OF_FRAME_TYPOLOGIES = {
    "legislative_branch": (
        "the frame names the judicial typology alone; legislative text is a different "
        "population and is outside the sampling frame"
    ),
    "public_domain_works": (
        "literary and historical works, which none of the four cells describes"
    ),
    "wikis": (
        "outside the sampling frame, and the encyclopedic cell is served by the "
        "Wikipedia dump directly: taking both bases would make cross-source "
        "near-duplicates of the same articles"
    ),
    "datasets_and_other_corpora": (
        "a compilation of other corpora is not a register: the provenance is whatever "
        "each compiled base was, and it overlaps the other typologies"
    ),
}


class TypologyOutOfFrame(ValueError):
    """The archive holds a typology this module has no decision about.

    Fail-closed, and it stops the RUN rather than skipping the member. A typology that
    is neither in the frame nor in the declared exclusions is undecided, and deciding it
    by silence is the reverse of fail-closed in the direction that hurts: the Carolina
    directory names carry spaces in some releases and underscores in others, so a
    renamed in-frame directory would produce ZERO rows for a cell whose FPR ceiling the
    release publishes, and produce them quietly.
    """


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


def selected_typologies(requested: str | None) -> tuple[str, ...]:
    """The typologies one run extracts: all three of the frame, or a named subset.

    Refuses on the WAY IN, naming the typology, why it is outside the frame when that is
    written down, and the admissible names. The refusal has to happen before the archive
    is opened: a multi-gigabyte pass that discovers on the last member that it was asked
    for the legislative branch has already spent the run.
    """
    if requested is None:
        return FRAME_TYPOLOGIES
    asked = tuple(slug(name) for name in requested.split(",") if name.strip())
    if not asked:
        raise argparse.ArgumentTypeError(
            "--typologies was given no name; omit it to extract the whole frame "
            f"({', '.join(FRAME_TYPOLOGIES)})"
        )
    for name in asked:
        if name not in FRAME_TYPOLOGIES:
            reason = OUT_OF_FRAME_TYPOLOGIES.get(
                name, "the declared frame does not draw on it"
            )
            raise argparse.ArgumentTypeError(
                f"typology {name!r} is outside the declared frame: {reason}. "
                f"Admissible: {', '.join(FRAME_TYPOLOGIES)}"
            )
    return asked


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
    snapshot_version: str = "",
    typologies: tuple[str, ...] = FRAME_TYPOLOGIES,
) -> None:
    """Fills candidates per typology (capped) so no typology monopolizes the
    overall limit just for coming first in the archive order.

    `snapshot_version` is the concrete package version (`carolina-v2.0`) and is
    MANDATORY: it names the acquisition event that `groups.sourceMaterialBatch`
    resolves against, and one download of the package is ONE batch — the typologies
    are partitions of it, not separate acquisitions, so all three cells that come
    out of this archive share the batch.

    A member of a typology outside `typologies` is never opened, so it emits nothing and
    consumes none of the run's quota — the whole point of an allowlist over a per-cell
    cap is that out-of-frame material cannot crowd out in-frame material. A typology
    that is neither in the frame nor in `OUT_OF_FRAME_TYPOLOGIES` refuses the run.
    """
    material_batch = group_axes.material_batch_id(snapshot_version)
    with zipfile.ZipFile(str(input_path)) as archive:
        members: list[tuple[zipfile.ZipInfo, str]] = []
        for info in archive.infolist():
            if info.is_dir() or not info.filename.endswith(".xml"):
                continue
            # Compared as the SLUG, because that is the form the candidate's
            # `domainSource` carries and the releases spell the same typology two ways
            # ("social media" and "social_media"): matching the raw directory name would
            # admit one spelling and refuse the other.
            found = slug(typology_dir(info.filename))
            if found in typologies:
                members.append((info, found))
            elif found not in FRAME_TYPOLOGIES and found not in OUT_OF_FRAME_TYPOLOGIES:
                raise TypologyOutOfFrame(
                    f"member {info.filename!r} belongs to the typology {found!r}, which "
                    "this extractor has no decision about: it is neither one of the "
                    f"frame's ({', '.join(FRAME_TYPOLOGIES)}) nor one of the declared "
                    f"exclusions ({', '.join(sorted(OUT_OF_FRAME_TYPOLOGIES))}). "
                    "Declare it in one of the two before extracting from this package"
                )
        kept_by_typology: dict[str, int] = {}
        for info, typology in members:
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
                                "snapshotVersion": snapshot_version,
                                # The acquisition event: one download of the package,
                                # shared by all three cells it feeds. The assembler
                                # REFUSES a human candidate that names none rather
                                # than deriving one from the stratum, so this is the
                                # only place the value can come from.
                                "sourceMaterialBatch": material_batch,
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
    parser.add_argument(
        "--snapshot-version",
        required=True,
        help="versão concreta do pacote (ex.: carolina-v2.0). Registrada na "
        "proveniência e é o que nomeia o lote de material",
    )
    parser.add_argument(
        "--typologies",
        type=selected_typologies,
        default=FRAME_TYPOLOGIES,
        help="lista separada por vírgula, subconjunto da moldura "
        f"({', '.join(FRAME_TYPOLOGIES)}); omitida, extrai as três. Tipologia fora da "
        "moldura é recusada AQUI, antes de o arquivo ser aberto",
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
        extract(
            args.input,
            writer,
            per_typology_limit=args.per_typology_limit,
            snapshot_version=args.snapshot_version,
            typologies=args.typologies,
        )
    finally:
        writer.close()
    print(f"{SOURCE_ID}: kept={writer.stats.kept} scanned={writer.stats.scanned}")


if __name__ == "__main__":
    main()
