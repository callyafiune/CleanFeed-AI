"""Builds the market-style detector comparison table — with what vendors omit.

Consumes score JSONLs over IDENTICAL texts ({class: human|ai, score} rows;
the go/no-go format with documentRawScore is also accepted) and emits a
markdown table: FPR / Recall / Precision / Accuracy at 0.5, each error rate
with a two-sided Wilson 95% CI, plus rank AUC and N — so a reader can tell
0.08% measured on 40 texts apart from 0.08% measured on 4,000.

Usage:
  python compare_detectors.py \
    --run "cleanfeed-ptbr-v1=../data/candidates/scores_cleanfeed_pilot.jsonl" \
    --run "TMR (RAID/EN 2023)=../data/candidates/pair_scores.jsonl" \
    --run "Desklib v1.01 (EN)=../data/candidates/scores_desklib_pilot.jsonl" \
    [--threshold 0.5] [--out tabela.md]
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path


def wilson(successes: int, total: int, z: float = 1.959964) -> tuple[float, float]:
    if total == 0:
        return (0.0, 1.0)
    p = successes / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    half = (
        z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    )
    return (max(0.0, center - half), min(1.0, center + half))


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


def load_scores(path: Path) -> list[tuple[int, float]]:
    rows: list[tuple[int, float]] = []
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            record = json.loads(line)
            if record.get("status") not in (None, "scored"):
                continue
            score = record.get("score", record.get("documentRawScore"))
            if score is None:
                continue
            rows.append((1 if record["class"] == "ai" else 0, float(score)))
    return rows


def pct(value: float) -> str:
    return f"{100 * value:.2f}%"


def ci(bounds: tuple[float, float]) -> str:
    return f"[{100 * bounds[0]:.2f}–{100 * bounds[1]:.2f}]"


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--run", action="append", required=True, metavar="NOME=arquivo.jsonl"
    )
    parser.add_argument("--threshold", type=float, default=0.5)
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    lines = [
        "| Detector | FPR (IC95) | Recall (IC95) | Precision | Accuracy | AUC | N (hum/ai) |",
        "| --- | --- | --- | --- | --- | --- | --- |",
    ]
    for spec in args.run:
        name, _, file_part = spec.partition("=")
        rows = load_scores(Path(file_part))
        humans = [score for label, score in rows if label == 0]
        ais = [score for label, score in rows if label == 1]
        threshold = args.threshold
        fp = sum(1 for s in humans if s >= threshold)
        tp = sum(1 for s in ais if s >= threshold)
        fn = len(ais) - tp
        tn = len(humans) - fp
        fpr = fp / len(humans) if humans else float("nan")
        recall = tp / len(ais) if ais else float("nan")
        precision = tp / (tp + fp) if (tp + fp) else float("nan")
        accuracy = (tp + tn) / len(rows) if rows else float("nan")
        lines.append(
            f"| {name} | {pct(fpr)} {ci(wilson(fp, len(humans)))} | "
            f"{pct(recall)} {ci(wilson(tp, len(ais)))} | {pct(precision)} | "
            f"{pct(accuracy)} | {auc_rank(ais, humans):.4f} | "
            f"{len(humans)}/{len(ais)} |"
        )
    table = "\n".join(lines)
    print(table)
    if args.out:
        args.out.write_text(table + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
