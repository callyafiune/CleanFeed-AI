"""Streams Corpus Carolina TEI zips into human-text candidates — OUTSIDE THE FRAME.

The declared frame draws on NO Carolina typology (`FRAME_TYPOLOGIES` is empty), so this
extractor emits nothing: `extract` refuses with `CarolinaOutOfFrame` before opening the
archive. The module is kept, not deleted, for the reason every other exclusion in this
lab is kept — an extractor that disappears leaves no trace of why it left, and
re-admitting the base becomes a one-line edit that works instead of an amendment that
has to name the cell it would add. What was measured over the package on 2026-08-05
(member headers only, never a body) is written per typology in
`OUT_OF_FRAME_TYPOLOGIES`.

What still stops the output if someone runs it anyway, downstream and fail-closed:
`humanSources.snapshots` no longer stocks `carolina`, so `benchmark/schema.ts` refuses
every record whose `labelEvidenceRef.snapshot` names it; `auditCorpusSources` blocks a
manifest declaring `src_carolina` with `SOURCE_OUT_OF_DECLARED_FRAME`; and the
assembler's `REGISTER` has no cell for `carolina_*`.

How it reads the material, kept intact so re-admission costs an amendment and not a
rediscovery: the `Corpus/<typology>/**.xml` members, one <TEI> document at a time,
taking the CAROLINA-level availability (license) and the `<date type="Download">` — the
download date anchors the pre-ChatGPT guarantee per document, which is what makes the
v2.0 (Bea) package usable — and keeping only documents whose license is in the
allowlist. Only the body text and non-identifying metadata (typology) are extracted;
header names/authors are never read. Stdlib only; memory-safe via iterparse +
clearing.

Usage (refuses, by design):
  python benchmark/lab/extract_carolina.py \
    --input <archive.zip> --output benchmark/data/candidates/carolina.jsonl \
    --snapshot-version carolina-v2.0 \
    [--limit 4000] [--sample-rate 1]
"""

from __future__ import annotations

import argparse
import hashlib
import re
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

import group_axes
from common import CandidateWriter, parse_iso_date, read_id_file

SOURCE_ID = "src_carolina"
TEI_NS = "{http://www.tei-c.org/ns/1.0}"
# EMPTY: the declared frame draws on no typology of this package. It stays a list rather
# than becoming a boolean because it is the shape a re-admission takes — one name here,
# one cell in `preRegistration.quotaAxis.cells`, one `fpr-<cell>` member in
# `multiplicity.primaryFamily` — and every message below reads its emptiness.
FRAME_TYPOLOGIES: tuple[str, ...] = ()
# Every typology the package holds, with the reason it is outside the frame. Declared
# rather than deleted: an allowlist alone cannot tell a typology that was DECIDED against
# from one nobody has looked at, and the second case has to stop the run (see
# `TypologyOutOfFrame`).
#
# The first three were IN the frame until the frame amendment, and their reasons are
# measurements over this package (2026-08-05, member headers and URLs only): each is a
# single-institution corpus that declares no author, so the population a per-cell FPR
# would name is one institution and the number of independent units is undecidable
# between one and tens of thousands. That is not a claim about the register's quality —
# it is that the material does not carry the provenance the claim needs.
OUT_OF_FRAME_TYPOLOGIES = {
    "judicial_branch": (
        "single institution: 38.187 documents over 5 hosts, all *.stf.jus.br, and ZERO "
        "declare an author — one court is not 'judicial text', and between 1 and 38.187 "
        "independent units the package gives no basis to choose"
    ),
    "university_domains": (
        "single institution: 26.409 documents from jornal.usp.br alone, ZERO with an "
        "author — one newspaper is not 'university-domain text'"
    ),
    "social_media": (
        "single platform: 3.294 documents from wattpad.com alone, whose 104 authors are "
        "below the 300-unit floor — and fiction posted to one site is not the "
        "social-media register the cell claimed"
    ),
    "legislative_branch": (
        "a different population from every cell the frame has ever declared, and outside "
        "the sampling frame"
    ),
    "public_domain_works": (
        "literary and historical works, which the declared cell does not describe"
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
    renamed directory would produce ZERO rows without saying so.
    """


class CarolinaOutOfFrame(ValueError):
    """This whole package is outside the declared frame, so the run refuses.

    Raised at the ENTRY POINT rather than letting the pass finish empty: a run that reads
    3,1 GB and writes zero rows looks like a bad archive, and the operator would go
    looking for the file instead of reading the frame. The refusal is where the reason
    lives.
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


def admissible_typologies() -> str:
    """What `--typologies` may name, as prose — including the empty-frame case."""
    if not FRAME_TYPOLOGIES:
        return (
            "none: the declared frame draws on no typology of this package, so there is "
            "no admissible value. Re-admitting one is an amendment of the frame "
            "(preRegistration.quotaAxis.cells and multiplicity.primaryFamily), not a "
            "flag"
        )
    return ", ".join(FRAME_TYPOLOGIES)


def selected_typologies(requested: str | None) -> tuple[str, ...]:
    """The typologies one run extracts: the frame's own, or a named subset of them.

    Refuses on the WAY IN, naming the typology, why it is outside the frame when that is
    written down, and what is admissible. The refusal has to happen before the archive
    is opened: a multi-gigabyte pass that discovers on the last member that it was asked
    for the legislative branch has already spent the run.
    """
    if requested is None:
        return FRAME_TYPOLOGIES
    asked = tuple(slug(name) for name in requested.split(",") if name.strip())
    if not asked:
        raise argparse.ArgumentTypeError(
            "--typologies was given no name; omit it to extract the whole frame "
            f"({admissible_typologies()})"
        )
    for name in asked:
        if name not in FRAME_TYPOLOGIES:
            reason = OUT_OF_FRAME_TYPOLOGIES.get(
                name, "the declared frame does not draw on it"
            )
            raise argparse.ArgumentTypeError(
                f"typology {name!r} is outside the declared frame: {reason}. "
                f"Admissible: {admissible_typologies()}"
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


def extraction_run_id(snapshot_version: str) -> str:
    """The execution that reads the material, named so a third party can recompute it.

    DERIVED and not declared: which extraction module ran, over which version of the
    material, plus the digest of this module's own bytes. Nobody types it, so nobody can
    reuse one run's name for another run — different code or different material yields a
    different id, and anyone with the file on disk gets the same value.

    What it names is the MODULE and the material version, and nothing wider. The digest
    covers this file only, not `common` or `group_axes`; and two invocations differing only
    in the writer's selection parameters (`--limit`, `--sample-rate`, `--exclude`) share
    the id. The emptiness of `snapshot_version` is not checked here on purpose:
    `group_axes.material_batch_id` already refuses it by name, and a second authority over
    one fact is how two spellings of a rule start disagreeing.

    DUPLICATED, and the copy has to agree: `extract_wikipedia` carries the same expression,
    whose natural home is `group_axes` beside `material_batch_id`.
    `test_extractors.ExtractionRunProducerTests` recomputes the formula and pins both, so a
    drift between them is a failure rather than two spellings.
    """
    module = Path(__file__).resolve()
    digest = hashlib.sha256(module.read_bytes()).hexdigest()[:12]
    return f"er_{module.stem}_{group_axes.axis_token(snapshot_version)}_{digest}"


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

    An EMPTY `typologies` refuses too, and that is the state the frame amendment left the
    module in: it is the difference between "this package contributes nothing" said out
    loud and a silent zero-row pass over 3,1 GB.
    """
    if not typologies:
        raise CarolinaOutOfFrame(
            "the declared frame draws on no Carolina typology, so this extractor emits "
            "nothing. Every typology of the package is declared outside the frame with "
            "its measured reason: "
            + "; ".join(
                f"{name} — {reason}"
                for name, reason in sorted(OUT_OF_FRAME_TYPOLOGIES.items())
            )
            + ". Re-admitting one is an amendment of preRegistration.quotaAxis.cells and "
            "multiplicity.primaryFamily, and it moves every published ceiling"
        )
    # A caller may hand `typologies` in directly, so the frame is checked HERE and not
    # only in the argparse type: the refusal has to hold for the function, or the
    # command line is the only thing standing between an out-of-frame typology and a
    # pool file that no cell counts.
    outside = tuple(name for name in typologies if name not in FRAME_TYPOLOGIES)
    if outside:
        raise CarolinaOutOfFrame(
            "asked for "
            + ", ".join(
                f"{name} ({OUT_OF_FRAME_TYPOLOGIES.get(name, 'undeclared')})"
                for name in outside
            )
            + f", which the declared frame does not draw on (admissible: "
            f"{admissible_typologies()})"
        )
    material_batch = group_axes.material_batch_id(snapshot_version)
    extraction_run = extraction_run_id(snapshot_version)
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
                    f"frame's ({admissible_typologies()}) nor one of the declared "
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
                                # shared by every typology it feeds. The assembler
                                # REFUSES a human candidate that names none rather
                                # than deriving one from the stratum, so this is the
                                # only place the value can come from.
                                "sourceMaterialBatch": material_batch,
                                # The EXECUTION that wrote this line, which is a
                                # different fact from the acquisition above:
                                # re-reading one download is processing, not
                                # acquisition. Stamped per line and here, because
                                # only the execution that opened the material can
                                # name itself — a later layer knows the pool FILE,
                                # and one file can hold the lines of more than one
                                # run (the writer appends). One execution over the
                                # package, so every typology it feeds shares it.
                                "extractionRun": extraction_run,
                                "groupAxes": {
                                    # The MEMBER FILE. One member holds many TEI
                                    # documents from one crawl of one domain, so they
                                    # share topic, register and often boilerplate,
                                    # and treating them as one cluster is the
                                    # conservative reading of the dependence.
                                    #
                                    # It is ALSO why this package cannot carry a cell:
                                    # the frame's three typologies held 37, 7 and 2
                                    # member files against a floor of 300 units, so
                                    # the coarse axis that is right for dependence is
                                    # also too coarse for the interval. The finer axis
                                    # the claim would need is the author, and the TEI
                                    # header declares none on any document.
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
        f"({admissible_typologies()}); tipologia fora da moldura é recusada AQUI, antes "
        "de o arquivo ser aberto",
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
