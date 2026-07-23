"""Evaluates cleanfeed-ptbr-v1 on EXTERNAL public benchmarks (MULTITuDE etc.).

Third-party data = the strongest antidote to in-corpus circularity: humans and
generators we did NOT create. Reads a benchmark CSV/TSV (columns configurable;
MULTITuDE ships text/label/split/language/source), filters language + split,
scores every text with the LOCAL int8 ONNX (no network), and reports AUC,
accuracy@0.5 and FPR/recall per generator source — ready to compare against the
benchmark's published per-language numbers.

Caveats to carry into any report: benchmark era (MULTITuDE generators are
2023), register (news), pt variant mixing, and evaluation-only license terms.

Usage:
  python evaluate_external.py --data multitude.csv --artifacts <dir-with-onnx> \
    [--language pt] [--split test] [--text-col text] [--label-col label] \
    [--source-col multi_label] [--limit 0]
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path


def auc_rank(pos: list[float], neg: list[float]) -> float:
    if not pos or not neg:
        return float("nan")
    wins = ties = 0
    for a in pos:
        for b in neg:
            if a > b:
                wins += 1
            elif a == b:
                ties += 1
    return (wins + 0.5 * ties) / (len(pos) * len(neg))


def load_rows(args) -> list[dict]:
    delimiter = "\t" if args.data.suffix.lower() == ".tsv" else ","
    rows: list[dict] = []
    with args.data.open(encoding="utf-8", newline="") as handle:
        for row in csv.DictReader(handle, delimiter=delimiter):
            if args.language and row.get(args.language_col, "").lower() not in {
                args.language.lower(),
                f"{args.language.lower()}-br",
            }:
                continue
            if args.split and row.get(args.split_col, "").lower() != args.split.lower():
                continue
            text = (row.get(args.text_col) or "").strip()
            raw_label = (row.get(args.label_col) or "").strip().lower()
            if not text or raw_label not in {"0", "1", "human", "machine", "ai"}:
                continue
            rows.append(
                {
                    "text": text,
                    "label": 1 if raw_label in {"1", "machine", "ai"} else 0,
                    "source": (row.get(args.source_col) or "?").strip() or "?",
                }
            )
            if args.limit and len(rows) >= args.limit:
                break
    return rows


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--artifacts", required=True, type=Path)
    parser.add_argument("--language", default="pt")
    parser.add_argument("--split", default="test")
    parser.add_argument("--text-col", default="text")
    parser.add_argument("--label-col", default="label")
    parser.add_argument("--split-col", default="split")
    parser.add_argument("--language-col", default="language")
    parser.add_argument("--source-col", default="multi_label")
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--limit", type=int, default=0)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    rows = load_rows(args)
    human = sum(1 for r in rows if r["label"] == 0)
    print(f"avaliando {len(rows)} textos (human={human} ai={len(rows) - human})")
    if not rows:
        raise SystemExit("nenhuma linha após filtros — confira colunas/idioma/split")

    import numpy as np
    import onnxruntime as ort
    from transformers import AutoTokenizer

    tokenizer = AutoTokenizer.from_pretrained(str(args.artifacts))
    session = ort.InferenceSession(str(args.artifacts / "onnx" / "model_int8.onnx"))
    input_names = {i.name for i in session.get_inputs()}

    def p_ai(text: str) -> float:
        encoding = tokenizer(
            text, truncation=True, max_length=args.max_length, return_tensors="np"
        )
        feed = {
            name: encoding[name].astype(np.int64)
            for name in ("input_ids", "attention_mask", "token_type_ids")
            if name in input_names and name in encoding
        }
        logits = session.run(None, feed)[0][0]
        exp = np.exp(logits - logits.max())
        return float((exp / exp.sum())[1])

    for index, row in enumerate(rows, start=1):
        row["score"] = p_ai(row["text"])
        if index % 200 == 0:
            print(f"  {index}/{len(rows)}")

    ai_scores = [r["score"] for r in rows if r["label"] == 1]
    human_scores = [r["score"] for r in rows if r["label"] == 0]
    accuracy = sum(
        1 for r in rows if (r["score"] >= 0.5) == (r["label"] == 1)
    ) / len(rows)
    fpr = (
        sum(1 for r in rows if r["label"] == 0 and r["score"] >= 0.5)
        / max(1, len(human_scores))
    )
    report = {
        "data": str(args.data),
        "language": args.language,
        "split": args.split,
        "n": len(rows),
        "auc": auc_rank(ai_scores, human_scores),
        "accuracy_at_050": accuracy,
        "fpr_at_050": fpr,
        "per_source": {},
    }
    by_source: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        by_source[row["source"]].append(row)
    for source, group in sorted(by_source.items()):
        positives = [r["score"] for r in group if r["label"] == 1]
        recall = (
            sum(1 for s in positives if s >= 0.5) / len(positives)
            if positives
            else None
        )
        report["per_source"][source] = {
            "n": len(group),
            "recall_at_050": recall,
        }
    print(json.dumps(report, ensure_ascii=False, indent=2))
    if args.out:
        args.out.write_text(
            json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
        )


if __name__ == "__main__":
    main()
