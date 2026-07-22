"""TF-IDF + logistic-regression floor for the pilot (lab bench, sklearn).

The cheapest possible detector: word/char n-gram TF-IDF into a linear model,
5-fold stratified CV over the topic-paired pilot (AI texts vs their human
parents — balanced and topic-controlled by construction). Its AUC is the FLOOR
any real detector must beat; if even this separates the classes, there is
learnable authorship signal in the corpus.

Usage:
  python baseline_tfidf.py \
    --ai ../data/candidates/ai_*.jsonl --humans ../data/candidates/{ptso,carolina,wikipedia}.jsonl
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import roc_auc_score
from sklearn.model_selection import StratifiedKFold
from sklearn.pipeline import make_pipeline


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ai", required=True, nargs="+", type=Path)
    parser.add_argument("--humans", required=True, nargs="+", type=Path)
    args = parser.parse_args()

    ai_rows = [row for path in args.ai for row in read_jsonl(path)]
    humans_by_id = {
        row["candidateId"]: row
        for path in args.humans
        for row in read_jsonl(path)
    }
    parents = {
        row["meta"]["pairedWith"]
        for row in ai_rows
        if row["meta"].get("pairedWith") in humans_by_id
    }

    texts = [row["text"] for row in ai_rows]
    labels = [1] * len(ai_rows)
    texts += [humans_by_id[pid]["text"] for pid in sorted(parents)]
    labels += [0] * len(parents)
    X = np.array(texts, dtype=object)
    y = np.array(labels)
    print(f"dataset: {len(ai_rows)} ai + {len(parents)} human (topic-paired)")

    def pipeline():
        return make_pipeline(
            TfidfVectorizer(
                ngram_range=(1, 2), min_df=2, max_features=50_000, sublinear_tf=True
            ),
            LogisticRegression(max_iter=2000, C=1.0),
        )

    aucs: list[float] = []
    folds = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
    for fold, (train, test) in enumerate(folds.split(X, y), start=1):
        model = pipeline().fit(X[train], y[train])
        probabilities = model.predict_proba(X[test])[:, 1]
        auc = roc_auc_score(y[test], probabilities)
        aucs.append(auc)
        print(f"  fold {fold}: AUC={auc:.4f}")
    print(
        f"baseline TF-IDF+LogReg: AUC medio={np.mean(aucs):.4f} "
        f"(desvio={np.std(aucs):.4f}) — piso a ser superado pelo detector real"
    )


if __name__ == "__main__":
    main()
