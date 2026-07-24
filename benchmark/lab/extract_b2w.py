"""Streams the B2W-Reviews01 CSV into human-text candidates (social-media
register: authentic pt-BR user-generated, informal/opinionated product
reviews).

B2W-Reviews01 (americanas-tech/b2w-reviews01) is a static 2018 release, so the
whole file is pre-ChatGPT by construction — the same guarantee as the SE/ptwiki
pre-2022 snapshots and Carolina Ada; the `submission_date` cutoff stays as
defense in depth. Only the review prose is read (title + body); the reviewer
columns (id, birth year, gender, state) are NEVER touched, and the shared
pipeline still PII-scrubs the text. License CC BY-NC-SA 4.0 -> cc-by-nc-sa-4.0.

The natural key is content-derived (submission_date + product + text), so ids
are stable across re-runs and identical duplicate reviews collapse to one id.

Usage:
  python benchmark/lab/extract_b2w.py \
    --input <B2W-Reviews01.csv> \
    --output benchmark/data/candidates/b2w_fresh.jsonl \
    [--limit 1500] [--sample-rate 1] [--exclude <ids-file>]
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from common import CandidateWriter, parse_iso_date, read_id_file

SOURCE_ID = "src_b2w"
LICENSE_ID = "cc-by-nc-sa-4.0"
DOMAIN_SOURCE = "b2w_reviews"
# CSV can exceed the default field-size limit on very long reviews.
csv.field_size_limit(10_000_000)


def _first_present(row: dict, names: tuple[str, ...]) -> str:
    for name in names:
        value = row.get(name)
        if value:
            return value
    return ""


def extract(input_path: Path, writer: CandidateWriter) -> None:
    with input_path.open(encoding="utf-8", newline="") as handle:
        # Sniff the delimiter (B2W ships comma-separated, but be forgiving).
        sample = handle.read(8192)
        handle.seek(0)
        try:
            dialect = csv.Sniffer().sniff(sample, delimiters=",;\t")
        except csv.Error:
            dialect = csv.excel
        reader = csv.DictReader(handle, dialect=dialect)
        for row in reader:
            if writer.full:
                break
            title = _first_present(row, ("review_title", "title"))
            body = _first_present(row, ("review_text", "review", "text"))
            if not body:
                continue
            # Title + body maximizes prose so short reviews can clear the word
            # window; the shared normalizer collapses whitespace.
            raw_text = f"{title}. {body}" if title else body
            date_raw = _first_present(
                row, ("submission_date", "date", "review_date")
            )
            created_at = parse_iso_date(date_raw.split(" ")[0]) if date_raw else None
            product = _first_present(row, ("product_id", "product_name"))
            natural_key = f"{date_raw}|{product}|{body[:80]}"
            writer.offer(
                natural_key=natural_key,
                license_id=LICENSE_ID,
                created_at=created_at,
                raw_text=raw_text,
                domain_source=DOMAIN_SOURCE,
            )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=1500)
    parser.add_argument("--sample-rate", type=int, default=1)
    parser.add_argument(
        "--exclude",
        type=Path,
        default=None,
        help="arquivo de candidate_ids (um por linha) a pular na emissão — "
        "extração fresca disjunta do que já foi usado",
    )
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
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
    print(
        f"{SOURCE_ID}: kept={writer.stats.kept} scanned={writer.stats.scanned}"
    )


if __name__ == "__main__":
    main()
