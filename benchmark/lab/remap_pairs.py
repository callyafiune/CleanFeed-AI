"""Rewrites ai_*.jsonl pair references from legacy sequential ids to stable ids.

The pilot's AI texts reference their human parents by the OLD sequence-based
candidateId. Candidate ids are now STABLE (derived from the natural key), so a
re-extraction renumbers nothing — but the pilot files predate that. This tool
joins old->new by the sha256 of the normalized text (exact within-source match)
and rewrites `meta.pairedWith` in place, refusing to write when any pair fails
to resolve (fail-closed; no partial remaps).

Usage:
  python remap_pairs.py \
    --old ../data/candidates/_old_ptso.jsonl ... \
    --new ../data/candidates/ptso.jsonl ... \
    --ai ../data/candidates/ai_gemini.jsonl ...
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def text_key(row: dict) -> str:
    return hashlib.sha256(row["text"].encode("utf-8")).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--old", required=True, nargs="+", type=Path)
    parser.add_argument("--new", required=True, nargs="+", type=Path)
    parser.add_argument("--ai", required=True, nargs="+", type=Path)
    args = parser.parse_args()

    old_by_id: dict[str, str] = {}
    for path in args.old:
        for row in read_jsonl(path):
            old_by_id[row["candidateId"]] = text_key(row)

    new_by_text: dict[str, str] = {}
    for path in args.new:
        for row in read_jsonl(path):
            new_by_text[text_key(row)] = row["candidateId"]

    for path in args.ai:
        rows = read_jsonl(path)
        misses: list[str] = []
        for row in rows:
            paired = row["meta"].get("pairedWith", "")
            digest = old_by_id.get(paired)
            target = new_by_text.get(digest or "")
            if target is None:
                misses.append(paired)
            else:
                row["meta"]["pairedWith"] = target
        if misses:
            print(f"{path.name}: {len(misses)} pares SEM correspondencia — NAO reescrito")
            for miss in misses[:5]:
                print("   ", miss)
            continue
        path.write_text(
            "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
            encoding="utf-8",
        )
        print(f"{path.name}: {len(rows)} pares remapeados")


if __name__ == "__main__":
    main()
