"""Imports the SYNTHETIC subset of Madras1/corpus-ptbr-v1 as an AI-class lane.

Public-dataset lane (T2b): modern OPEN-model pt-BR generations (Qwen, GPT-OSS,
OpenRouter mixes — 2024/25 era) sampled from locally-downloaded parquet files.
ONLY the synthetic subset is used — the dataset's "real" side is Common
Crawl/FineWeb2, which our governance rejects for the human label.

Quality gate: some rows leak the generator's reasoning channel as English
meta-text ("analysisWe need to write…"). Those are DROPPED — a detector trained
on them would learn "english meta = AI", a false shortcut. Everything else runs
through the shared candidate pipeline (word window, PII drop, deterministic
per-batch caps).

License: ODC-By 1.0 (attribution recorded in docs/corpus-sources.md).
Requires pyarrow (the lab's one non-stdlib exception, local parquet reading).

Usage:
  python import_public_corpus.py \
    --parquet <madras_*.parquet ...> \
    --output ../data/candidates/ai_public_madras.jsonl \
    [--per-source-limit 1500] [--limit 12000]
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from pathlib import Path

from common import CandidateWriter

LICENSE_ID = "odc-by-1.0"
# Deterministic stand-in for unknown per-row generation dates: the dataset
# snapshot vintage (card last updated ~May 2026). AI-class rows bypass the
# pre-ChatGPT cutoff anyway (date_cutoff=None); this keeps createdAt honest-ish
# and reproducible instead of stamping import wall-clock.
DATASET_VINTAGE = datetime(2026, 5, 1, tzinfo=timezone.utc)

# English reasoning-channel / meta-instruction leakage markers. Checked against
# the text HEAD only (pt-BR prose legitimately quoting English later is fine).
LEAK_MARKERS = (
    "analysis",
    "assistantfinal",
    "assistantanalysis",
    "<|channel|>",
    "We need to",
    "The user wants",
    "The user asks",
    "Let's write",
    "I need to write",
    "I will write",
)
HEAD_WINDOW = 160


def looks_contaminated(text: str) -> bool:
    head = text[:HEAD_WINDOW]
    return any(marker in head for marker in LEAK_MARKERS)


def import_parquets(
    paths: list[Path],
    writer: CandidateWriter,
    per_source_limit: int,
    max_words: int | None = None,
) -> dict[str, int]:
    """`max_words` keeps the AI class in the deployment register (feed posts are
    50-300 words; Madras skews long-form) and kills the "long = AI" shortcut —
    both class length distributions must overlap."""
    import pyarrow.parquet as pq

    kept_by_source: dict[str, int] = {}
    for path in paths:
        table = pq.ParquetFile(str(path)).read(
            columns=["subset", "source", "language", "text"]
        )
        subsets = table.column("subset")
        sources = table.column("source")
        languages = table.column("language")
        texts = table.column("text")
        for index in range(table.num_rows):
            if writer.full:
                return kept_by_source
            if subsets[index].as_py() != "synthetic":
                continue
            if (languages[index].as_py() or "").lower() not in {"pt-br", "pt"}:
                continue
            source = sources[index].as_py() or "unknown"
            if kept_by_source.get(source, 0) >= per_source_limit:
                continue
            text = texts[index].as_py() or ""
            if looks_contaminated(text):
                writer.stats.scanned += 1
                writer.stats.drop_other += 1
                continue
            if max_words is not None and len(text.split()) > max_words:
                writer.stats.scanned += 1
                writer.stats.drop_words += 1
                continue
            kept_before = writer.stats.kept
            writer.offer(
                natural_key=f"madras:{path.name}:{index}",
                license_id=LICENSE_ID,
                created_at=DATASET_VINTAGE,
                raw_text=text,
                domain_source="ai_public_madras",
                meta={
                    "provider": "public-dataset",
                    "family": f"madras:{source}",
                    "model": source,
                    "version": "corpus-ptbr-v1",
                    "recipe": "public-dataset",
                    "seedNullReason": "public dataset; generation params not published",
                    "generationMode": "public-dataset",
                    "datasetId": "Madras1/corpus-ptbr-v1",
                },
            )
            if writer.stats.kept > kept_before:
                kept_by_source[source] = kept_by_source.get(source, 0) + 1
    return kept_by_source


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parquet", required=True, nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--limit", type=int, default=12000)
    parser.add_argument("--per-source-limit", type=int, default=1500)
    parser.add_argument("--max-words", type=int, default=450)
    args = parser.parse_args()

    writer = CandidateWriter(
        args.output,
        source_id="src_ai_public_madras",
        limit=args.limit,
        sample_rate=1,
        date_cutoff=None,
    )
    try:
        kept = import_parquets(
            args.parquet, writer, args.per_source_limit, max_words=args.max_words
        )
    finally:
        writer.close()
    print(f"madras: kept={writer.stats.kept} leak_dropped={writer.stats.drop_other} "
          f"pii_dropped={writer.stats.drop_pii} words_dropped={writer.stats.drop_words}")
    for source, count in sorted(kept.items()):
        print(f"  {source:36s} {count}")


if __name__ == "__main__":
    main()
