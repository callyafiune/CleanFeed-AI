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
    --snapshot-version ptwiki-20220301 \
    [--limit 4000] [--sample-rate 40]
"""

from __future__ import annotations

import argparse
import bz2
import hashlib
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import group_axes
from common import CandidateWriter, parse_iso_date, read_id_file

SOURCE_ID = "src_wikipedia_pt"
LICENSE_ID = "cc-by-sa-4.0"
MW_NS = "{http://www.mediawiki.org/xml/export-0.10/}"
# The date field as the DUMP names it, for the record's labelEvidenceRef.
DATE_FIELD = "pages-articles.xml@revision/timestamp"
# The frozen snapshot token. The dump on disk is ptwiki-20220301 — 1 March 2022,
# pre-ChatGPT, which is what satisfies the mandatory pre-Nov/2022 requirement of
# docs/corpus-sources.md. The policy vocabulary names the base, not the date, so the
# concrete dump version is recorded through --snapshot-version and never presumed.
SNAPSHOT = "ptwiki"

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

    DUPLICATED, and the copy has to agree: `extract_carolina` carries the same expression,
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
    snapshot_version: str = "",
) -> None:
    """Streams the dump, emitting the PAGE as the grouping identity.

    `snapshot_version` is the concrete dump name (`ptwiki-20220301`) and is recorded
    rather than presumed: the shared context is explicit that the version must be
    registered in the provenance, and the extractor is the only place that has seen
    the file. It is now MANDATORY, because it is also what names the acquisition
    event: `groups.sourceMaterialBatch` is derived from it here, and no later layer
    can name a batch it never saw the material of.
    """
    material_batch = group_axes.material_batch_id(snapshot_version)
    extraction_run = extraction_run_id(snapshot_version)
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
                        created = parse_iso_date(timestamp or "")
                        writer.offer(
                            # UNCHANGED: the candidate id derives from this string,
                            # and a re-extraction must not renumber the corpus.
                            natural_key=f"ptwiki:{page_id}",
                            license_id=LICENSE_ID,
                            created_at=created,
                            raw_text=lead_section(wikitext),
                            domain_source="ptwiki_lead",
                            meta={
                                "dateField": DATE_FIELD,
                                "observedValue": (
                                    created.isoformat() if created else ""
                                ),
                                "snapshot": SNAPSHOT,
                                "snapshotVersion": snapshot_version,
                                # The acquisition event, shared by every row of this
                                # dump. The assembler REFUSES a human candidate that
                                # names none rather than deriving one from the
                                # stratum, so this is the only place the value can
                                # come from.
                                "sourceMaterialBatch": material_batch,
                                # The EXECUTION that wrote this line, which is a
                                # different fact from the acquisition above:
                                # re-reading one dump is processing, not
                                # acquisition. Stamped per line and here, because
                                # only the execution that opened the material can
                                # name itself — a later layer knows the pool FILE,
                                # and one file can hold the lines of more than one
                                # run (the writer appends).
                                "extractionRun": extraction_run,
                                "groupAxes": {
                                    # The PAGE. Two lead sections never come from one
                                    # page (we take one per page), so this axis is
                                    # expected to be all singletons TODAY — and it is
                                    # still the right identity, because it is what
                                    # makes a future revision of the same page join
                                    # its predecessor instead of looking independent.
                                    "source": group_axes.known(
                                        f"ptwiki_page_{page_id}"
                                    ),
                                    # notApplicable and NOT unknown: there is no
                                    # single author to recover, so nothing was lost
                                    # and the record stays eligible. Writing
                                    # `unknown` here would make every Wikipedia row
                                    # ineligible over a value that does not exist.
                                    "author": group_axes.not_applicable(
                                        group_axes.NO_SINGLE_AUTHOR
                                    ),
                                },
                            },
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
    parser.add_argument(
        "--snapshot-version",
        required=True,
        help="nome concreto do dump (ex.: ptwiki-20220301). Registrado na "
        "proveniência e é o que nomeia o lote de material; não é inferido do arquivo",
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
        extract(args.input, writer, snapshot_version=args.snapshot_version)
    finally:
        writer.close()
    print(f"{SOURCE_ID}: kept={writer.stats.kept} scanned={writer.stats.scanned}")


if __name__ == "__main__":
    main()
