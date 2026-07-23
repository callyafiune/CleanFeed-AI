"""Honest, confound-aware evaluation of a trained detector (Colab bench).

A near-perfect dev AUC is a RED FLAG for this dataset: the human class comes
entirely from licensed corpora (SE/Wikipedia/Carolina) and the AI class from
generators (Madras/frontier), so a classifier can separate the two by SOURCE
FINGERPRINT instead of authorship. This script exposes that:

  1. per-SOURCE score distributions — if every human source scores ~0 and every
     AI family ~1 regardless of content, source is doing the work;
  2. the TOPIC-PAIRED AUC — restricted to (human parent, its AI child) pairs
     that both landed in this split: topic is held constant, so this is the
     honest authorship signal (still not the feed register — that is gate D);
  3. paired win-rate + mean delta (like the pilot go/no-go).

Run on Colab after training (the checkpoint is already there):
  !python evaluate_slices.py --checkpoint bertimbau/best --eval dev.jsonl
"""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True, type=Path)
    parser.add_argument("--eval", required=True, type=Path)
    parser.add_argument("--max-length", type=int, default=512)
    parser.add_argument("--batch", type=int, default=32)
    args = parser.parse_args()

    import torch
    from transformers import AutoModelForSequenceClassification, AutoTokenizer

    rows = read_jsonl(args.eval)
    device = "cuda" if torch.cuda.is_available() else "cpu"
    tokenizer = AutoTokenizer.from_pretrained(str(args.checkpoint))
    model = AutoModelForSequenceClassification.from_pretrained(
        str(args.checkpoint)
    ).to(device)
    model.eval()

    scores: list[float] = []
    with torch.no_grad():
        for start in range(0, len(rows), args.batch):
            batch = rows[start : start + args.batch]
            encoding = tokenizer(
                [r["text"] for r in batch],
                truncation=True,
                max_length=args.max_length,
                padding=True,
                return_tensors="pt",
            ).to(device)
            probs = torch.softmax(model(**encoding).logits.float(), dim=-1)[:, 1]
            scores.extend(probs.cpu().tolist())
    for row, score in zip(rows, scores):
        row["score"] = score

    human = [r["score"] for r in rows if r["label"] == 0]
    ai = [r["score"] for r in rows if r["label"] == 1]
    print(f"eval n={len(rows)} (human={len(human)} ai={len(ai)})")
    print(f"AUC global = {auc_rank(ai, human):.5f}  <- inflado por fonte, NAO confiar")

    print("\n=== score medio por FONTE (confundidor) ===")
    by_source: dict[tuple[int, str], list[float]] = defaultdict(list)
    for row in rows:
        by_source[(row["label"], row.get("family", "?"))].append(row["score"])
    for (label, family), values in sorted(by_source.items()):
        tag = "AI " if label == 1 else "HUM"
        print(f"  [{tag}] {family:34s} n={len(values):4d} score_medio={sum(values) / len(values):.3f}")

    # Topic-paired honest AUC: pairs whose human parent is present in this eval.
    human_score = {r["id"]: r["score"] for r in rows if r["label"] == 0}
    paired_ai: list[float] = []
    paired_hu: list[float] = []
    deltas: list[float] = []
    for row in rows:
        if row["label"] != 1:
            continue
        parent = human_score.get(row.get("pairedWith", ""))
        if parent is None:
            continue
        paired_ai.append(row["score"])
        paired_hu.append(parent)
        deltas.append(row["score"] - parent)
    print("\n=== TOPIC-PAIRED (honesto: mesmo topico, so muda autoria) ===")
    if deltas:
        wins = sum(1 for d in deltas if d > 0)
        print(f"  pares={len(deltas)}  AUC_pareada={auc_rank(paired_ai, paired_hu):.4f}")
        print(f"  win-rate (IA>humano)={100 * wins / len(deltas):.1f}%  "
              f"delta_medio={sum(deltas) / len(deltas):+.4f}")
    else:
        print("  (nenhum par com o pai humano neste split — reduza o --eval a um "
              "split que contenha ambos, ou rode no reserved)")
    print("\nNOTA: o numero que decide o produto e o slice LinkedIn real (portao D), "
          "nao este.")


if __name__ == "__main__":
    main()
