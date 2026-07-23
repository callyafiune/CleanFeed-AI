"""Assembles the V2 TRAINING dataset from candidate JSONLs (T3).

Split policy (anti-leakage, from the phase plan):
  bucket = sha1(candidateId) % 10  ->  0-7 train | 8 dev | 9 RESERVED
Pairs are ATOMIC: an AI row that references a human parent (pairedWith)
inherits the PARENT's bucket, so a topic pair can never straddle splits (the
model would otherwise see the topic in train and be graded on its twin in dev).
The reserved bucket is written to its own file and must NEVER be trained on —
it is the untouched pool available to the future sealed evaluation corpus.

Exact-text dedup across all inputs (first occurrence wins). Paraphrase-recipe
rows are near-dups of their parents BY DESIGN (hard positives) and survive
because only exact duplicates are dropped here; the sealed pipeline's MinHash
near-dup refusal is deliberately NOT applied to training data.

Output schema per row:
  {id, text, label: 0|1, family, recipe, domainSource, wordCount, split}

Usage:
  python build_dataset.py \
    --humans ../data/candidates/{ptso,carolina,wikipedia}.jsonl \
    --ai ../data/candidates/ai_*.jsonl \
    --outdir ../data/dataset
"""

from __future__ import annotations

import argparse
import hashlib
import json
from collections import Counter
from pathlib import Path

TRAIN_BUCKETS = set(range(8))
DEV_BUCKET = 8
RESERVED_BUCKET = 9


def bucket_of(candidate_id: str) -> int:
    digest = hashlib.sha1(candidate_id.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % 10


def split_name(bucket: int) -> str:
    if bucket in TRAIN_BUCKETS:
        return "train"
    return "dev" if bucket == DEV_BUCKET else "reserved"


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def assemble(human_paths: list[Path], ai_paths: list[Path]) -> dict[str, list[dict]]:
    rows: dict[str, list[dict]] = {"train": [], "dev": [], "reserved": []}
    seen_texts: set[str] = set()
    dropped_dupes = 0

    def push(row: dict, split: str) -> None:
        nonlocal dropped_dupes
        digest = hashlib.sha256(row["text"].encode("utf-8")).hexdigest()
        if digest in seen_texts:
            dropped_dupes += 1
            return
        seen_texts.add(digest)
        rows[split].append(row)

    human_bucket: dict[str, int] = {}
    for path in human_paths:
        for source_row in read_jsonl(path):
            cid = source_row["candidateId"]
            bucket = bucket_of(cid)
            human_bucket[cid] = bucket
            push(
                {
                    "id": cid,
                    "text": source_row["text"],
                    "label": 0,
                    "family": source_row["domainSource"],
                    "recipe": "",
                    "domainSource": source_row["domainSource"],
                    "wordCount": source_row["wordCount"],
                    "split": split_name(bucket),
                },
                split_name(bucket),
            )

    for path in ai_paths:
        for source_row in read_jsonl(path):
            cid = source_row["candidateId"]
            meta = source_row.get("meta", {})
            parent = meta.get("pairedWith", "")
            # Pair atomicity: inherit the parent's bucket when the parent is
            # known; unpaired AI (public datasets) buckets on its own id.
            bucket = human_bucket.get(parent, bucket_of(cid))
            push(
                {
                    "id": cid,
                    "text": source_row["text"],
                    "label": 1,
                    "family": meta.get("family", source_row["domainSource"]),
                    "recipe": meta.get("recipe", ""),
                    "domainSource": source_row["domainSource"],
                    "wordCount": source_row["wordCount"],
                    "split": split_name(bucket),
                },
                split_name(bucket),
            )

    rows["_dropped_dupes"] = dropped_dupes  # type: ignore[assignment]
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--humans", required=True, nargs="+", type=Path)
    parser.add_argument("--ai", required=True, nargs="+", type=Path)
    parser.add_argument("--outdir", required=True, type=Path)
    args = parser.parse_args()

    rows = assemble(args.humans, args.ai)
    dropped = rows.pop("_dropped_dupes")
    args.outdir.mkdir(parents=True, exist_ok=True)
    stats: dict = {"droppedExactDupes": dropped}
    for split, split_rows in rows.items():
        path = args.outdir / f"{split}.jsonl"
        with path.open("w", encoding="utf-8", newline="\n") as handle:
            for row in split_rows:
                handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        labels = Counter(r["label"] for r in split_rows)
        stats[split] = {
            "total": len(split_rows),
            "human": labels.get(0, 0),
            "ai": labels.get(1, 0),
            "families": dict(Counter(r["family"] for r in split_rows).most_common(20)),
            "recipes": dict(Counter(r["recipe"] for r in split_rows if r["recipe"])),
        }
        print(
            f"{split:9s} total={len(split_rows):6d}  human={labels.get(0, 0):6d}  "
            f"ai={labels.get(1, 0):6d}"
        )
    print(f"dupes exatas descartadas: {dropped}")
    (args.outdir / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )


if __name__ == "__main__":
    main()
