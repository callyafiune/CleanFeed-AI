"""TF-IDF + logistic-regression floor for the pilot (lab bench, sklearn).

The cheapest possible detector: TF-IDF into a linear model, 5-fold stratified CV
over the topic-paired pilot (AI texts vs their human parents — balanced and
topic-controlled by construction). Its AUC is the FLOOR any real detector must
beat; if even this separates the classes, there is learnable authorship signal in
the corpus.

TWO VECTORIZATIONS, RUN IN PARALLEL AND REPORTED SIDE BY SIDE — word n-grams (1,2)
and CHARACTER n-grams (3,6). Not a union and not an ensemble: two numbers, because
the reason for the second one is not performance. This baseline's role in Phase 4 is
to be a LEAKAGE DETECTOR (D19), and a word n-gram walks straight past the
typographic artifacts the anti-artifact gate hunts — an asterisk run, a heading
line, a non-breaking space, a mojibake sequence are not words, so the word
vectorizer never sees them while a character n-gram of length 3 to 6 lands on them
directly. A high AUC here still means ARTIFACT OF SOURCE rather than quality, and
the two numbers say WHICH KIND: word high with char low is lexical or topical, char
high with word low is typographic, and both high is either or both.

`analyzer="char"` and NOT `char_wb`: `char_wb` pads at word boundaries and confines
its n-grams inside words, which is exactly where the marks are not. `** ` between two
words, a space before a newline, a pipe table's ` | ` all live ACROSS the boundary,
and confining the analyzer to the inside of words buys back the blind spot the
character n-gram was added to close.

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

# Pinned, and the value `diagnostic_probes.PROBE_SEED` pins too, so two diagnostics
# over one corpus fold it identically and their AUCs are comparable.
BASELINE_SEED = 42
BASELINE_FOLDS = 5

# The word n-gram range and the character one. `min_df=2` on both: a shape that occurs
# in exactly one document is that document's fingerprint, and a leakage detector whose
# vocabulary is fingerprints reports memorization as separation.
WORD_NGRAMS = (1, 2)
CHAR_NGRAMS = (3, 6)


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def word_pipeline():
    return make_pipeline(
        TfidfVectorizer(
            ngram_range=WORD_NGRAMS, min_df=2, max_features=50_000, sublinear_tf=True
        ),
        LogisticRegression(max_iter=2000, C=1.0),
    )


def char_pipeline():
    return make_pipeline(
        TfidfVectorizer(
            analyzer="char",
            ngram_range=CHAR_NGRAMS,
            min_df=2,
            max_features=200_000,
            sublinear_tf=True,
        ),
        LogisticRegression(max_iter=2000, C=1.0),
    )


# label -> factory, in report order. A mapping so a caller cannot run one without the
# other: reporting the word AUC alone is the reading D19 exists to prevent.
VECTORIZATIONS = {"word(1,2)": word_pipeline, "char(3,6)": char_pipeline}


def cross_validated_aucs(
    texts: np.ndarray, labels: np.ndarray, pipeline_factory
) -> list[float]:
    """Per-fold AUC of one vectorization, stratified and seeded."""
    aucs: list[float] = []
    folds = StratifiedKFold(
        n_splits=BASELINE_FOLDS, shuffle=True, random_state=BASELINE_SEED
    )
    for train, test in folds.split(texts, labels):
        model = pipeline_factory().fit(texts[train], labels[train])
        probabilities = model.predict_proba(texts[test])[:, 1]
        aucs.append(roc_auc_score(labels[test], probabilities))
    return aucs


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

    for label, factory in VECTORIZATIONS.items():
        aucs = cross_validated_aucs(X, y, factory)
        for fold, auc in enumerate(aucs, start=1):
            print(f"  {label} fold {fold}: AUC={auc:.4f}")
        print(
            f"baseline TF-IDF+LogReg {label}: AUC medio={np.mean(aucs):.4f} "
            f"(desvio={np.std(aucs):.4f})"
        )
    print(
        "piso a ser superado pelo detector real, e DETECTOR DE VAZAMENTO (D19): "
        "desempenho alto aqui significa artefato de fonte, nao qualidade"
    )


if __name__ == "__main__":
    main()
