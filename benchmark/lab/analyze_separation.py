"""Separation analysis over the paired TMR scores (the pilot go/no-go).

Reads the score_pairs.mjs output and reports, on the scored subset:
  - per-class score distributions (mean/median/p10/p90);
  - AUC via the rank-based Mann-Whitney estimator (P(score_ai > score_human));
  - the PAIRED analysis — for each (human parent, AI child) pair, whether the
    child outscored the parent (topic-controlled win rate) and the mean delta;
  - per-generator-family breakdown.

Stdlib only. AUC 0.5 = no separation; the paired win rate is the cleanest
signal because topic is held constant within a pair.

Usage: python analyze_separation.py --scores ../data/candidates/pair_scores.jsonl
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from statistics import mean, median


def load(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def percentile(sorted_values: list[float], fraction: float) -> float:
    if not sorted_values:
        return float("nan")
    index = min(len(sorted_values) - 1, int(fraction * len(sorted_values)))
    return sorted_values[index]


def auc_rank(ai: list[float], human: list[float]) -> float:
    """Mann-Whitney AUC: P(ai > human) + 0.5*P(tie)."""
    wins = ties = 0
    for a in ai:
        for h in human:
            if a > h:
                wins += 1
            elif a == h:
                ties += 1
    total = len(ai) * len(human)
    return (wins + 0.5 * ties) / total if total else float("nan")


def describe(label: str, values: list[float]) -> None:
    ordered = sorted(values)
    print(
        f"  {label:22s} n={len(values):4d} mean={mean(values):.4f} "
        f"median={median(values):.4f} p10={percentile(ordered, 0.10):.4f} "
        f"p90={percentile(ordered, 0.90):.4f}"
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--scores", required=True, type=Path)
    args = parser.parse_args()

    rows = load(args.scores)
    scored = [r for r in rows if r["status"] == "scored"]
    dropped = [r for r in rows if r["status"] != "scored"]
    print(f"linhas: {len(rows)} | pontuadas: {len(scored)} | nao-pontuadas: {len(dropped)}")
    if dropped:
        reasons: dict[str, int] = {}
        for r in dropped:
            key = f"{r['class']}:{r['reasonCode']}"
            reasons[key] = reasons.get(key, 0) + 1
        print("  nao-pontuadas por motivo:", reasons)

    human_scores = {
        r["id"]: r["documentRawScore"] for r in scored if r["class"] == "human"
    }
    ai_rows = [r for r in scored if r["class"] == "ai"]

    print("\n=== distribuicoes (documentRawScore) ===")
    describe("human (pais)", list(human_scores.values()))
    describe("ai (todas familias)", [r["documentRawScore"] for r in ai_rows])
    families = sorted({r["family"] for r in ai_rows})
    for family in families:
        describe(
            f"ai:{family}",
            [r["documentRawScore"] for r in ai_rows if r["family"] == family],
        )

    print("\n=== AUC global (rank-based) ===")
    overall = auc_rank(
        [r["documentRawScore"] for r in ai_rows], list(human_scores.values())
    )
    print(f"  AUC(ai vs human) = {overall:.4f}   (0.5 = nenhuma separacao)")
    for family in families:
        fam = [r["documentRawScore"] for r in ai_rows if r["family"] == family]
        print(f"  AUC {family:28s} = {auc_rank(fam, list(human_scores.values())):.4f}")

    print("\n=== analise PAREADA (topic-controlled) ===")
    deltas: list[float] = []
    wins = ties = losses = 0
    by_family: dict[str, list[float]] = {}
    for r in ai_rows:
        parent = human_scores.get(r["pairedWith"])
        if parent is None:
            continue
        delta = r["documentRawScore"] - parent
        deltas.append(delta)
        by_family.setdefault(r["family"], []).append(delta)
        if delta > 0:
            wins += 1
        elif delta == 0:
            ties += 1
        else:
            losses += 1
    total = wins + ties + losses
    if total:
        print(
            f"  pares avaliaveis: {total} | filho-IA acima do pai-humano: "
            f"{wins} ({100 * wins / total:.1f}%) | empates: {ties} | abaixo: {losses}"
        )
        print(f"  delta medio (ai - human) = {mean(deltas):+.4f} | mediano = {median(deltas):+.4f}")
        for family, values in sorted(by_family.items()):
            fam_wins = sum(1 for d in values if d > 0)
            print(
                f"    {family:28s} pares={len(values):3d} win-rate={100 * fam_wins / len(values):5.1f}% "
                f"delta-medio={mean(values):+.4f}"
            )
    else:
        print("  nenhum par avaliavel (pais nao pontuados?)")


if __name__ == "__main__":
    main()
