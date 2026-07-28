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

import group_axes
from common import CandidateWriter, parse_iso_date, read_id_file
from pseudonymize import (
    ClusterKeyring,
    PERSON_PURPOSE,
    load_cluster_keyring,
    require_keyring,
)

SOURCE_ID = "src_b2w"
LICENSE_ID = "cc-by-nc-sa-4.0"
DOMAIN_SOURCE = "b2w_reviews"
DATE_FIELD = "B2W-Reviews01.csv@submission_date"
SNAPSHOT = "b2w-reviews01"
# CSV can exceed the default field-size limit on very long reviews.
csv.field_size_limit(10_000_000)


def _first_present(row: dict, names: tuple[str, ...]) -> str:
    for name in names:
        value = row.get(name)
        if value:
            return value
    return ""


def reviewer_axis(row: dict, keyring: ClusterKeyring) -> dict:
    """The reviewer, pseudonymised — or `unknown` when the row names none.

    B2W already ships `reviewer_id` as a sha256-shaped hex string, and that is
    exactly why it still has to be HMAC'd rather than copied: a digest is a stable
    JOIN KEY, so publishing it lets anyone re-attach our rows to the public B2W file
    and to every other review by the same person, which is the linkage
    pseudonymisation exists to break. The column being pre-hashed changes the shape,
    not the risk.
    """
    raw = _first_present(row, ("reviewer_id", "reviewer"))
    if not raw:
        return group_axes.unknown(group_axes.AUTHOR_NOT_RECOVERED)
    return group_axes.known(keyring.pseudonym(PERSON_PURPOSE, raw))


def extract(
    input_path: Path,
    writer: CandidateWriter,
    keyring: ClusterKeyring | None = None,
) -> None:
    # Before the first row: this source carries a person on a grouping axis.
    keyring = require_keyring(keyring, "B2W-Reviews01 (reviewer_id)")
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
            # UNCHANGED: the candidate id derives from this string, so the
            # re-extraction must keep it byte-identical.
            natural_key = f"{date_raw}|{product}|{body[:80]}"
            writer.offer(
                natural_key=natural_key,
                license_id=LICENSE_ID,
                created_at=created_at,
                raw_text=raw_text,
                domain_source=DOMAIN_SOURCE,
                meta={
                    "dateField": DATE_FIELD,
                    "observedValue": (
                        created_at.isoformat() if created_at else ""
                    ),
                    "snapshot": SNAPSHOT,
                    "groupAxes": {
                        # The PRODUCT. A genuinely large cluster: a popular notebook
                        # collects hundreds of reviews that share vocabulary, sentiment
                        # distribution and the very complaints being described, so
                        # splitting them across partitions leaks. `product_id` is read
                        # from the column and falls back to `product_name` only because
                        # the natural key already does — the two must agree or the id
                        # and the axis would disagree about what a product is.
                        "source": group_axes.known(
                            "b2w_product_" + group_axes.axis_token(product)
                        )
                        if product
                        else group_axes.unknown(
                            "the CSV row names neither product_id nor product_name"
                        ),
                        "author": reviewer_axis(row, keyring),
                    },
                },
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
    parser.add_argument(
        "--keyring",
        type=Path,
        default=None,
        help="cluster-exposure keyring (C3). OBRIGATÓRIO: o avaliador é dado "
        "pessoal e vai pseudonimizado por HMAC — não há caminho sem segredo",
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
        extract(args.input, writer, keyring=load_cluster_keyring(args.keyring))
    finally:
        writer.close()
    print(
        f"{SOURCE_ID}: kept={writer.stats.kept} scanned={writer.stats.scanned}"
    )


if __name__ == "__main__":
    main()
