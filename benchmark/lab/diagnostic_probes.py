"""The diagnostic probes: what a detector trained on this corpus could learn INSTEAD
of authorship.

FOUR PROBES, AND ONLY THE FIRST ONE DECIDES.

  1. `probe_partitions` — predict which of `train`, `dev` and `cal-A` a row belongs to.
     Adversarial validation: at chance the three open partitions are exchangeable, and
     above chance they are not, which means the number `dev` reports is not an estimate
     of anything `train` was fit for. This one REFUSES the assembly
     (`assert_partitions_are_exchangeable`).
  2. `probe_length` — predict the class from the WORD COUNT alone.
  3. `probe_lanes` — predict the generation lane inside the `ai` class.
  4. `probe_stylometry` — cheap, robust, legible features and the COEFFICIENTS of a
     logistic regression over them.

Probes 2 to 4, the spelling-error bias measure and the window dispersion are PUBLISHED
DIAGNOSTICS THAT DO NOT DECIDE — the layer `benchmark/gates.ts` names `diagnostic`. They
enter no primary family, they spend no share of the familial alpha and they become no
hypothesis. That is why their result objects carry no verdict field at all: a report with
no verdict cannot be read as a refusal by a caller under deadline, and a probe that
turned out to need alpha would change `m`, which is the operator's decision and not this
module's.

WHY THESE FOUR, AND NOT THE ONE THE FOUR-CELL FRAME NEEDED. With four cells the probe
worth having was "predict which cell the text came from", because a detector that learns
the cell publishes an FPR per cell that is really a cell classifier. The published frame
has ONE cell (`ptwiki`), so that probe has no target and the risk moved: with a single
source, what threatens the measurement is the detector learning LENGTH, TOPIC or the
typographic signature of a LANE instead of authorship. Probes 2 and 3 are those two
risks, and probe 4 is the reason the project can say which signal it is.

WHAT PROBE 1 CANNOT SEE, stated because the blind spot is load-bearing. A text present in
BOTH `train` and `dev` is invisible to a partition classifier by construction: the same
features carry two different labels, so the duplicated pair contributes nothing to the
AUC in either direction. Duplication across partitions is therefore checked SEPARATELY
and by exact normalized text (`sharedText` below), and the deep version of that check —
near-duplicate clusters as connected components — belongs to `near_dupes`,
`benchmark/split.ts` and `assemble_corpus.assert_components_can_fill_five_partitions`,
not here. Reading the AUC as a duplicate detector is the error this paragraph exists to
prevent.

THE THREE OPEN PARTITIONS, AND NOTHING ELSE. `cal-B` and `test` are blind
(`BLIND_PARTITIONS`, mirrored from `benchmark/cluster-exposure-ledger.ts`). This module
selects rows by block time and never emits anything about a blind row: not an id, not a
count per blind partition, not a text. `open_partition_rows` returns the open rows plus
ONE aggregate count of what it set aside, and `_assert_no_blind_partition_reached` runs
inside the probe so a widened `OPEN_PARTITIONS` raises instead of quietly training on a
blind block.

THE TEXT IS READ AS THE TRAINING READS IT. `contracts/text-normalization.ts` runs only in
inference, so the corpus text that reaches `train_detector.py` still carries the
invisible code points and the spacing the runtime would have folded. These probes read
the same bytes the training reads, on purpose: the question is what the detector CAN
learn, and it can only learn from what it is shown.

sklearn is required here and deliberately not in the assembly: `assemble_corpus` is
stdlib-only and deterministic, and a k-fold cross-validation inside it would run on every
assembly fixture, most of which hold too few rows per partition to fold at all. The
refusal therefore lives in this module's own exit code, which is a step of the runbook —
the same shape as the anti-artifact report that `train_detector.py` does not yet check.

Usage:
  python diagnostic_probes.py --records ../data/corpus-build-new/records.jsonl \
    --out ../data/corpus-build-new/diagnostic-probes.json

  # The pools INSIDE the published frame — the invocation that reproduces the rates
  # published in `docs/ESTADO.md` § 5.7. Bare `--pools` reads the whole directory, which
  # is 67.934 rows of mostly out-of-frame material: see `IN_FRAME_POOLS`.
  python diagnostic_probes.py --pools ../data/candidates --in-frame-pools \
    --out /tmp/probes.json
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import statistics
import unicodedata
from collections import Counter
from pathlib import Path
from typing import Callable, Iterable, Sequence

import assemble_corpus
import common
import group_axes

# ---------------------------------------------------------------------------
# Partitions: which ones a probe may read at all
# ---------------------------------------------------------------------------

# Byte-for-byte `BLIND_PARTITIONS` in benchmark/cluster-exposure-ledger.ts, pinned
# against it by test. The mirror exists so this module can name what it refuses; the
# TypeScript side remains the authority over what blindness means.
BLIND_PARTITIONS: tuple[str, ...] = ("cal-B", "test")

# The three a probe may read, derived from the block map rather than typed: the vocabulary
# of partitions is `assemble_corpus.BLOCK_TIME`, and a sixth partition added there without
# this list moving would be silently un-probed.
OPEN_PARTITIONS: tuple[str, ...] = tuple(
    partition
    for partition in assemble_corpus.BLOCK_TIME
    if partition not in BLIND_PARTITIONS
)

# The value the probe's folds are pinned to. A diagnostic's fold structure is not policy,
# so the seed is local and is deliberately NOT `seeds.publishableCheckpoint`: a diagnostic
# reading a sealed seed would make the sealed pre-registration an authority over a layer
# that decides no claim. It is the value `baseline_tfidf` pins, so two diagnostics over
# one corpus fold it identically and their AUCs are comparable.
PROBE_SEED = 42

# The folds every probe cross-validates over, and therefore the minimum rows per class:
# `StratifiedKFold` refuses a class with fewer members than there are splits.
PROBE_FOLDS = 5

# A partition is called predictable only when BOTH hold. The AUC floor is the effect and
# the significance is the noise: at 10.000 rows an AUC of 0.52 is significant and cannot
# matter, and at 60 rows an AUC of 0.75 is one lucky fold.
#
# Frozen in CODE and not in the pre-registration, for the reason `artifact_gate` states
# about its own ceiling: `preregistration-v4.json` is sealed and carries no field for an
# assembly acceptance rule, and adding one would be a change of policy rather than a
# reading of it.
#
# NEITHER NUMBER IS A SHARE OF THE FAMILIAL ALPHA. The family is `m=4` with
# `perHypothesisAlpha` 0.0125 and it certifies the published claim; this significance
# level accepts or refuses a CORPUS before any model is trained, in the same class as the
# anti-artifact ceiling. A probe that needed familial alpha would change `m`, and `m` is
# the operator's.
PARTITION_PREDICTABILITY_AUC_FLOOR = 0.60
PARTITION_PREDICTABILITY_SIGNIFICANCE = 0.01

VERDICT_EXCHANGEABLE = "exchangeable"
VERDICT_REFUSE_ASSEMBLY = "refuse-assembly"

REASON_PARTITION_PREDICTABLE = "partition-predictable"
REASON_TEXT_SHARED = "text-shared-across-partitions"


class BlindPartitionReachedTheProbe(RuntimeError):
    """A row of `cal-B` or `test` reached a probe that trains on its partition label.

    Fail-closed and not a filter: the probes select open rows themselves, so a row of a
    blind block arriving at the classifier means `OPEN_PARTITIONS` was widened, and the
    next thing that happens is a model fit on a block the release has not spent yet. The
    message names the partition CLASS and never a row id, because the id is the thing
    nobody may publish.
    """


class NotEnoughRowsToProbe(RuntimeError):
    """A class or a partition holds fewer rows than there are cross-validation folds.

    Its own type, and not the leakage refusal: "too small to measure" and "measured and
    leaking" call for opposite actions, and one exception for both is how an operator
    ends up regenerating a corpus that was merely small.
    """


class CorpusIsNotStamped(RuntimeError):
    """A row carries no block time, so it has no partition to probe.

    Also its own type: an unstamped corpus is a corpus `assign_partitions` never ran on,
    which is a pipeline-order defect and not a finding about the material.
    """


class PartitionLeakage(RuntimeError):
    """The three open partitions are not exchangeable. Refuses the assembly."""

    def __init__(self, message: str, report: dict) -> None:
        super().__init__(message)
        self.report = report


class BiasMeasureReachedTheFeatures(RuntimeError):
    """A bias measure is registered as a model feature. Refuses before any fit.

    See `SPELLING_BIAS_MEASURES`.
    """


# recordId-free: the partition of a row is the block its `createdAt` falls in, which is
# how `assemble_corpus` encodes it (a side map, never a record field).
_TIME_PARTITION = {time: name for name, time in assemble_corpus.BLOCK_TIME.items()}


def partition_of(record: dict) -> str:
    """The partition a stamped record's block time places it in.

    Reads the timestamp rather than a field because the record's key set is closed and
    carries no `partition`: `assemble_corpus.stamp_block` writes the block time into
    `createdAt`, and a second copy of the partition would be a value able to disagree
    with the timestamp that produced it.
    """
    created = record.get("createdAt")
    partition = _TIME_PARTITION.get(created)
    if partition is None:
        raise CorpusIsNotStamped(
            f"createdAt {created!r} is not one of the {len(assemble_corpus.BLOCK_TIME)} "
            f"block times {sorted(assemble_corpus.BLOCK_TIME.values())}: the corpus was "
            "not stamped by `assign_partitions`, so no row has a partition to probe"
        )
    return partition


def open_partition_rows(records: Iterable[dict]) -> tuple[list[dict], int]:
    """The rows of the three open partitions, plus how many were set aside as blind.

    The count is an aggregate over BOTH blind partitions and carries no id and no
    per-partition breakdown: with the five fractions frozen the total is arithmetic
    anybody can do from the corpus size, while a breakdown would state which rows are in
    which blind block.
    """
    open_rows: list[dict] = []
    blind = 0
    for record in records:
        if partition_of(record) in OPEN_PARTITIONS:
            open_rows.append(record)
        else:
            blind += 1
    return open_rows, blind


def _assert_no_blind_partition_reached(labels: Sequence[str]) -> None:
    reached = sorted({label for label in labels if label in BLIND_PARTITIONS})
    if reached:
        raise BlindPartitionReachedTheProbe(
            f"{len(reached)} blind partition class(es) reached the partition probe: "
            f"{', '.join(reached)}. `cal-B` and `test` are blind until v2.0 "
            "(BLIND_PARTITIONS, benchmark/cluster-exposure-ledger.ts), and a probe that "
            "fits on their labels has read the membership nothing may publish"
        )


# ---------------------------------------------------------------------------
# Rank AUC and its null, without scipy
# ---------------------------------------------------------------------------


def rank_auc(scores: Sequence[float], positive: Sequence[bool]) -> float:
    """The Mann-Whitney U statistic normalized to [0, 1] — the AUC, ties averaged.

    Written here rather than taken from sklearn because the p-value below needs the same
    U, and computing the statistic twice from two implementations is how a reported AUC
    and a reported p-value come to describe different numbers.
    """
    n_positive = sum(1 for flag in positive if flag)
    n_negative = len(positive) - n_positive
    if n_positive == 0 or n_negative == 0:
        raise NotEnoughRowsToProbe(
            f"an AUC needs both classes present: {n_positive} positive(s) and "
            f"{n_negative} negative(s)"
        )
    order = sorted(range(len(scores)), key=lambda index: scores[index])
    ranks = [0.0] * len(scores)
    position = 0
    while position < len(order):
        end = position
        while end + 1 < len(order) and scores[order[end + 1]] == scores[order[position]]:
            end += 1
        shared = (position + end) / 2 + 1
        for index in order[position : end + 1]:
            ranks[index] = shared
        position = end + 1
    positive_rank_sum = sum(
        ranks[index] for index, flag in enumerate(positive) if flag
    )
    u = positive_rank_sum - n_positive * (n_positive + 1) / 2
    return u / (n_positive * n_negative)


def auc_p_value(auc: float, n_positive: int, n_negative: int) -> float:
    """One-sided p-value for `auc > 0.5` under exchangeability, normal approximation.

    Under the null the labels carry no information about the score, so U is distributed
    with mean `n1*n2/2` and variance `n1*n2*(n1+n2+1)/12` (Mann-Whitney; the AUC is that
    U scaled, Bamber 1975). TIES ARE NOT CORRECTED, and the direction of that is
    deliberate: the tie correction only ever SHRINKS the variance, so an uncorrected
    p-value is the larger one and the probe refuses less often than the exact test would.

    The scores this is applied to are out-of-fold predictions, so the folds are not
    independent of the labels in general. Under the null they carry no label information
    at all, which is the standard adversarial-validation reading; a permutation null
    (Ojala & Garriga 2010) would not need that argument and is the declared alternative
    this module does not implement, because it multiplies the fit cost by the permutation
    count for a layer that only has to separate "at chance" from "not".
    """
    if n_positive <= 0 or n_negative <= 0:
        raise NotEnoughRowsToProbe(
            "a p-value needs both classes present: "
            f"{n_positive} positive(s), {n_negative} negative(s)"
        )
    variance = (n_positive + n_negative + 1) / (12 * n_positive * n_negative)
    z = (auc - 0.5) / math.sqrt(variance)
    return 0.5 * math.erfc(z / math.sqrt(2))


def _stratified_out_of_fold_probabilities(
    texts: Sequence[str], labels: Sequence[str], classes: Sequence[str]
) -> dict[str, list[float]]:
    """Out-of-fold `predict_proba`, one score vector per class, in `classes` order."""
    import numpy as np
    from sklearn.feature_extraction.text import TfidfVectorizer
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import StratifiedKFold
    from sklearn.pipeline import make_pipeline

    counts = Counter(labels)
    thin = {name: total for name, total in counts.items() if total < PROBE_FOLDS}
    if thin:
        raise NotEnoughRowsToProbe(
            f"{len(thin)} class(es) hold fewer than {PROBE_FOLDS} rows and cannot be "
            f"folded: {', '.join(f'{name} {total}' for name, total in sorted(thin.items()))}"
        )

    features = np.array(texts, dtype=object)
    targets = np.array(labels, dtype=object)
    scores: dict[str, list[float]] = {name: [0.0] * len(texts) for name in classes}
    folds = StratifiedKFold(
        n_splits=PROBE_FOLDS, shuffle=True, random_state=PROBE_SEED
    )
    for train_index, test_index in folds.split(features, targets):
        model = make_pipeline(
            TfidfVectorizer(
                ngram_range=(1, 2), min_df=1, max_features=50_000, sublinear_tf=True
            ),
            LogisticRegression(max_iter=2000, C=1.0),
        ).fit(features[train_index], targets[train_index])
        predicted = model.predict_proba(features[test_index])
        seen = list(model.classes_)
        for name in classes:
            if name not in seen:
                continue
            column = seen.index(name)
            for offset, row in enumerate(test_index):
                scores[name][row] = float(predicted[offset][column])
    return scores


# ---------------------------------------------------------------------------
# Probe 1 — the partition. THE ONLY ONE THAT DECIDES.
# ---------------------------------------------------------------------------


def _shared_text_across_partitions(rows: Sequence[dict]) -> list[dict]:
    """Normalized texts present in more than one OPEN partition, with the pair named.

    Exact text and not near-duplicate: the graduated near-duplicate contract
    (`drop_seen`, Jaccard >= 0.82 over 5-token shingles) is owned by `near_dupes` and by
    the split, and re-deciding it here would give the corpus two thresholds. What this
    adds is the failure mode the AUC above cannot express at all.
    """
    seen: dict[str, set[str]] = {}
    for row in rows:
        digest = hashlib.sha256(
            common.normalize_text(str(row.get("text", ""))).encode("utf-8")
        ).hexdigest()
        seen.setdefault(digest, set()).add(partition_of(row))
    shared: dict[tuple[str, ...], int] = {}
    for partitions in seen.values():
        if len(partitions) < 2:
            continue
        key = tuple(sorted(partitions))
        shared[key] = shared.get(key, 0) + 1
    return [
        {"partitions": list(key), "texts": count}
        for key, count in sorted(shared.items())
    ]


def probe_partitions(records: Iterable[dict]) -> dict:
    """Adversarial validation over `train`, `dev` and `cal-A`. The report, not the verdict.

    One-vs-rest out-of-fold AUC per open partition, its p-value under exchangeability,
    and the exact-text overlap the AUC is blind to. `assert_partitions_are_exchangeable`
    reads this report and is the only thing that refuses.
    """
    rows, blind = open_partition_rows(records)
    labels = [partition_of(row) for row in rows]
    _assert_no_blind_partition_reached(labels)
    present = [name for name in OPEN_PARTITIONS if name in set(labels)]
    if len(present) < 2:
        raise NotEnoughRowsToProbe(
            f"the partition probe needs at least two of {list(OPEN_PARTITIONS)} "
            f"populated and found {present}: with one class there is nothing to predict"
        )

    texts = [str(row.get("text", "")) for row in rows]
    scores = _stratified_out_of_fold_probabilities(texts, labels, present)
    measured: list[dict] = []
    for name in present:
        positive = [label == name for label in labels]
        auc = rank_auc(scores[name], positive)
        n_positive = sum(1 for flag in positive if flag)
        measured.append(
            {
                "partition": name,
                "rows": n_positive,
                "auc": auc,
                "pValue": auc_p_value(auc, n_positive, len(positive) - n_positive),
            }
        )

    shared = _shared_text_across_partitions(rows)
    reasons: list[str] = []
    if any(
        entry["auc"] >= PARTITION_PREDICTABILITY_AUC_FLOOR
        and entry["pValue"] < PARTITION_PREDICTABILITY_SIGNIFICANCE
        for entry in measured
    ):
        reasons.append(REASON_PARTITION_PREDICTABLE)
    if shared:
        reasons.append(REASON_TEXT_SHARED)

    return {
        "probe": "partition-exchangeability",
        "decides": True,
        "rows": len(rows),
        "rowsSetAsideAsBlind": blind,
        "openPartitions": list(OPEN_PARTITIONS),
        "folds": PROBE_FOLDS,
        "seed": PROBE_SEED,
        "aucFloor": PARTITION_PREDICTABILITY_AUC_FLOOR,
        "significance": PARTITION_PREDICTABILITY_SIGNIFICANCE,
        "macroAuc": statistics.fmean(entry["auc"] for entry in measured),
        "partitions": measured,
        "sharedText": shared,
        "reasons": reasons,
        "verdict": VERDICT_REFUSE_ASSEMBLY if reasons else VERDICT_EXCHANGEABLE,
    }


def assert_partitions_are_exchangeable(report: dict) -> None:
    """Refuses the assembly when the open partitions are distinguishable.

    Names the partitions and the metric, which is what an operator acts on: a predictable
    partition is fixed by re-splitting or by re-collecting, and neither action is chosen
    from a bare verdict.
    """
    if report["verdict"] == VERDICT_EXCHANGEABLE:
        return
    parts: list[str] = []
    if REASON_PARTITION_PREDICTABLE in report["reasons"]:
        over = [
            entry
            for entry in report["partitions"]
            if entry["auc"] >= report["aucFloor"]
            and entry["pValue"] < report["significance"]
        ]
        parts.append(
            "predictable partition(s) "
            + "; ".join(
                f"{entry['partition']} one-vs-rest AUC {entry['auc']:.4f} "
                f"(p={entry['pValue']:.2e}, n={entry['rows']})"
                for entry in over
            )
            + f" against a floor of {report['aucFloor']:.2f} at "
            f"p<{report['significance']}"
        )
    if REASON_TEXT_SHARED in report["reasons"]:
        parts.append(
            "text shared across partitions "
            + "; ".join(
                f"{' + '.join(entry['partitions'])}: {entry['texts']} text(s)"
                for entry in report["sharedText"]
            )
        )
    raise PartitionLeakage(
        "partition probe: the open partitions are not exchangeable — "
        + ". ".join(parts)
        + ". A partition a classifier can name is a partition whose metric does not "
        "estimate the population the other partitions were fit for, so the assembly is "
        "refused before any model is trained",
        report,
    )


# ---------------------------------------------------------------------------
# Probe 2 — the class from the word count alone. DIAGNOSTIC.
# ---------------------------------------------------------------------------

# The bands the length distribution is reported in. Deciles of the POOLED word count and
# not fixed bounds: fixed bounds chosen for one corpus describe the next one by accident,
# and the quantity that matters is where in the realized distribution the classes stop
# overlapping.
LENGTH_BANDS = 10


def probe_length(rows: Iterable[dict]) -> dict:
    """AUC of a logistic regression whose only feature is the word count.

    RULE OF DOMAIN. The human lines come from the lead sections of Wikipedia, whose
    length is reasonably uniform, while the length of a generated line is chosen by the
    prompt. The two distributions coinciding is therefore a property the GENERATION has
    to produce, not a fact about the material — so a high AUC here is a finding about the
    generation slate and not about the corpus being hard.

    The `mixed` class is excluded and the exclusion is named: mixture is graduated, the
    policy gives the mixed line below 50 % the `diagnostic-curve-only` role, and a binary
    length AUC over it would be a number about a class the claim does not make.

    Reports the AUC of the FITTED model and, beside it, the rank AUC of the raw word
    count. THE TWO ARE NOT THE SAME QUANTITY AND NEED NOT AGREE. A logistic regression on
    one feature is monotone in that feature, so within ONE fold the fitted score ranks the
    rows exactly as the count does; but the reported AUC pools the out-of-fold predictions
    of `PROBE_FOLDS` different models, each with its own intercept and coefficient, and a
    union of five monotone maps is not monotone. When the folds disagree in the SIGN of
    the coefficient the pooled AUC can even land on the other side of chance from the raw
    one, with nothing wrong with any fit. `coefficientPerFold` is published so that case
    is readable rather than inferred: a divergence with one sign throughout is sampling
    noise, and a divergence with both signs is folds that disagree.
    """
    import numpy as np
    from sklearn.linear_model import LogisticRegression
    from sklearn.model_selection import StratifiedKFold

    labelled = [row for row in rows if row.get("label") in ("human", "ai")]
    counts = [common.word_count(str(row.get("text", ""))) for row in labelled]
    positive = [row["label"] == "ai" for row in labelled]
    per_class = Counter("ai" if flag else "human" for flag in positive)
    thin = {name: n for name, n in per_class.items() if n < PROBE_FOLDS}
    if thin or len(per_class) < 2:
        raise NotEnoughRowsToProbe(
            "the length probe needs both `human` and `ai` with at least "
            f"{PROBE_FOLDS} rows each and found {dict(sorted(per_class.items()))}"
        )

    features = np.array([[value] for value in counts], dtype=float)
    targets = np.array([1 if flag else 0 for flag in positive])
    out_of_fold = [0.0] * len(labelled)
    coefficients: list[float] = []
    folds = StratifiedKFold(
        n_splits=PROBE_FOLDS, shuffle=True, random_state=PROBE_SEED
    )
    for train_index, test_index in folds.split(features, targets):
        model = LogisticRegression(max_iter=2000).fit(
            features[train_index], targets[train_index]
        )
        coefficients.append(float(model.coef_[0][0]))
        predicted = model.predict_proba(features[test_index])[:, 1]
        for offset, row in enumerate(test_index):
            out_of_fold[row] = float(predicted[offset])

    lower = _band_lower_bounds(counts, LENGTH_BANDS)
    upper = lower[1:] + [max(counts) + 1]
    bands: list[dict] = []
    for index, (low, high) in enumerate(zip(lower, upper)):
        in_band = [
            flag for value, flag in zip(counts, positive) if low <= value < high
        ]
        total = len(in_band)
        ai_in_band = sum(1 for flag in in_band if flag)
        bands.append(
            {
                "band": index + 1,
                "wordsFrom": low,
                "wordsBelow": high,
                "human": total - ai_in_band,
                "ai": ai_in_band,
                "aiShare": (ai_in_band / total) if total else 0.0,
            }
        )

    return {
        "probe": "class-from-length",
        "decides": False,
        "rows": len(labelled),
        "counts": dict(sorted(per_class.items())),
        "folds": PROBE_FOLDS,
        "seed": PROBE_SEED,
        "auc": rank_auc(out_of_fold, positive),
        "rawWordCountAuc": rank_auc([float(value) for value in counts], positive),
        "coefficientPerFold": coefficients,
        "wordCountMedian": {
            "human": statistics.median(
                [value for value, flag in zip(counts, positive) if not flag]
            ),
            "ai": statistics.median(
                [value for value, flag in zip(counts, positive) if flag]
            ),
        },
        "bands": bands,
    }


def _band_lower_bounds(values: Sequence[int], bands: int) -> list[int]:
    """The LOWER bound of each band: `bands` quantiles of the pooled values, deduplicated.

    Lower bounds and not `bands + 1` edges, because a bimodal length distribution puts
    half the quantiles on each mode and deduplicating a full edge list collapses the two
    modes into ONE band that holds everything — which is exactly the corpus this probe
    exists to describe. The upper bound of the last band is `max + 1`, so every band is
    half-open and every document lands in exactly one.
    """
    ordered = sorted(values)
    quantiles = [
        ordered[min(len(ordered) - 1, round(index * (len(ordered) - 1) / bands))]
        for index in range(bands)
    ]
    unique: list[int] = []
    for edge in quantiles:
        if not unique or edge > unique[-1]:
            unique.append(edge)
    return unique


# ---------------------------------------------------------------------------
# Probe 3 — the lane inside the `ai` class. DIAGNOSTIC.
# ---------------------------------------------------------------------------


def probe_lanes(rows: Iterable[dict]) -> dict:
    """One-vs-rest out-of-fold AUC per generation lane, over `ai` rows only.

    High separability is a GENERATOR SIGNATURE, which is the territory of the
    anti-artifact gate (`artifact_gate`, A4): a lane a classifier can name from its text
    hands the label away for free, and A4's remedy is to regenerate that lane rather than
    to filter what the probe found. This probe points; it decides nothing.

    A lane with fewer rows than there are folds is REPORTED as not probed rather than
    dropped in silence: an unprobed lane is exactly the lane whose signature nobody has
    looked at.
    """
    ai_rows = [row for row in rows if row.get("label") == "ai"]
    lanes = [_lane_of_row(row) for row in ai_rows]
    without_a_lane = sum(1 for lane in lanes if lane is None)
    counts = Counter(lane for lane in lanes if lane is not None)
    probeable = sorted(name for name, total in counts.items() if total >= PROBE_FOLDS)
    not_probed = {
        name: total for name, total in sorted(counts.items()) if total < PROBE_FOLDS
    }
    if len(probeable) < 2:
        raise NotEnoughRowsToProbe(
            f"the lane probe needs at least two lanes with {PROBE_FOLDS} rows or more "
            f"and found {probeable} (counts {dict(sorted(counts.items()))})"
        )

    kept = [
        (row, lane) for row, lane in zip(ai_rows, lanes) if lane in set(probeable)
    ]
    texts = [str(row.get("text", "")) for row, _ in kept]
    labels = [lane for _, lane in kept]
    scores = _stratified_out_of_fold_probabilities(texts, labels, probeable)
    measured = [
        {
            "lane": name,
            "rows": counts[name],
            "auc": rank_auc(scores[name], [label == name for label in labels]),
        }
        for name in probeable
    ]
    easiest = max(measured, key=lambda entry: entry["auc"])
    return {
        "probe": "lane-within-ai",
        "decides": False,
        "rows": len(kept),
        "folds": PROBE_FOLDS,
        "seed": PROBE_SEED,
        "macroAuc": statistics.fmean(entry["auc"] for entry in measured),
        "lanes": measured,
        "lanesNotProbed": not_probed,
        "rowsWithoutALane": without_a_lane,
        "mostSeparableLane": easiest["lane"],
        "mostSeparableAuc": easiest["auc"],
    }


def _lane_of_row(row: dict) -> str | None:
    """The row's frozen generation lane, or None when it names no lane at all.

    None is reachable only from a POOL row: `--provider` is restricted to the four frozen
    lanes in the argparse and the assembly drops a generated row it cannot map
    (`UnmappableLane`), so an assembled `ai` row always has one — which is why
    `rowsWithoutALane` is reported instead of being asserted away. A non-zero count over
    an assembled corpus is a defect, and over the pools it is the 237 rows the assembly
    already refuses.
    """
    lane = group_axes.identity_of((row.get("groups") or {}).get("generationLane"))
    if lane:
        return str(lane)
    meta = row.get("meta") or {}
    try:
        return assemble_corpus.lane_of(str(meta.get("provider", "")), meta.get("lane"))
    except assemble_corpus.UnmappableLane:
        return None


# ---------------------------------------------------------------------------
# The stylometric features: cheap, robust, and legible
# ---------------------------------------------------------------------------

_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)
_SENTENCE_END = re.compile(r"[.!?]+(?=\s|$)")
_VOWEL_GROUP = re.compile(r"[aeiouáéíóúâêôãõàüy]+", re.IGNORECASE)
_LIST_LINE = re.compile(r"^\s*(?:[-*•–]|\d+[.)]|[a-z][.)])\s+", re.MULTILINE)
_DASH = re.compile(r"—|–|(?<=\s)-(?=\s)")

# pt-BR function words: articles, prepositions, contractions, conjunctions, high-frequency
# pronouns and auxiliaries. A CLOSED list and not a frequency cut, because a frequency cut
# needs a reference corpus this diagnostic does not download, and the class of word being
# counted is a grammatical class rather than a frequency band.
FUNCTION_WORDS: frozenset[str] = frozenset(
    """a à às ao aos as após até com como contra cuja cujo da das de dela delas dele
    deles desde dessa desse desta deste disso do dos e ela elas ele eles em entre era
    eram essa essas esse esses esta estas este estes está estão eu foi for foram há
    havia isso isto já lhe lhes mas me mesmo meu minha muito na nas nem nesse nesta
    neste no nos nós num numa o os ou para pela pelas pelo pelos perante por porque
    pois qual quais quando que quem se seja sem sendo ser será seu seus si sobre sua
    suas são também te tem tenha ter teu tinha tu um uma umas uns você vocês é""".split()
)

# pt-BR discourse connectives, including the multi-word ones, which is why they are matched
# as PHRASES over the folded text and not as tokens.
CONNECTIVES: tuple[str, ...] = (
    "ademais",
    "ainda que",
    "além disso",
    "apesar disso",
    "assim",
    "com efeito",
    "consequentemente",
    "contudo",
    "de fato",
    "dessa forma",
    "desse modo",
    "dito isso",
    "em primeiro lugar",
    "em resumo",
    "em suma",
    "embora",
    "enfim",
    "entretanto",
    "finalmente",
    "isto é",
    "já que",
    "logo",
    "na verdade",
    "nesse sentido",
    "no entanto",
    "ou seja",
    "outrossim",
    "para concluir",
    "por conseguinte",
    "por exemplo",
    "por fim",
    "por isso",
    "por outro lado",
    "porém",
    "portanto",
    "primeiramente",
    "sobretudo",
    "todavia",
    "uma vez que",
    "visto que",
)

# Openers and closers a template-driven generator reaches for. Measured as an INDICATOR
# over the first and last sentence and not over the whole text: "em suma" in the middle of
# a paragraph is a connective, and it is already counted as one.
OPENING_FRAMES: tuple[str, ...] = (
    "a importância de",
    "atualmente",
    "cada vez mais",
    "em um mundo",
    "introdução",
    "no cenário atual",
    "nos dias de hoje",
    "nos últimos anos",
    "quando se trata de",
    "você já",
)
CONCLUSION_FRAMES: tuple[str, ...] = (
    "concluindo",
    "dessa forma",
    "em conclusão",
    "em resumo",
    "em síntese",
    "em suma",
    "finalmente",
    "para concluir",
    "por fim",
    "portanto",
)

# The TTR threshold MTLD's factor count is defined against (McCarthy & Jarvis 2010).
MTLD_THRESHOLD = 0.72
# A word longer than this counts as long. A LENGTH proxy for rarity and declared as one:
# the vocabulary-frequency list a real rarity measure needs is a download this diagnostic
# does not pay for, so rarity is read twice and cheaply — hapax rate inside the document,
# and this.
LONG_WORD_CHARS = 13


def words_of(text: str) -> list[str]:
    """Alphabetic tokens, casefolded. Digits and punctuation are counted elsewhere."""
    return [match.group(0).casefold() for match in _WORD.finditer(text)]


def sentences_of(text: str) -> list[str]:
    """Sentences by terminal punctuation, empties dropped."""
    parts = [part.strip() for part in _SENTENCE_END.split(text)]
    return [part for part in parts if part]


def fold_for_phrases(text: str) -> str:
    """Casefolded, whitespace-collapsed, ACCENTS KEPT.

    Accents survive because the phrase lists above are spelled with them and because the
    spelling-error measure below reads missing diacritics as its main signal; a shared
    accent-stripping fold would erase exactly what that measure looks for.
    """
    return re.sub(r"\s+", " ", unicodedata.normalize("NFC", text)).casefold()


def syllables_in(word: str) -> int:
    """Vowel groups, as a coarse pt-BR syllable count.

    Coarse on purpose and declared: it reads a diphthong as one syllable and a hiatus as
    one too, so it under-counts. It feeds only the readability index, which is a
    comparison between classes over the same estimator, and an exact syllabifier is a
    dictionary this diagnostic does not download.
    """
    return max(1, len(_VOWEL_GROUP.findall(word)))


def sentence_length_mean(text: str) -> float:
    lengths = [len(words_of(sentence)) for sentence in sentences_of(text)]
    return statistics.fmean(lengths) if lengths else 0.0


def sentence_length_variance(text: str) -> float:
    lengths = [len(words_of(sentence)) for sentence in sentences_of(text)]
    return statistics.pvariance(lengths) if len(lengths) > 1 else 0.0


def word_length_mean(text: str) -> float:
    words = words_of(text)
    return statistics.fmean([len(word) for word in words]) if words else 0.0


def type_token_ratio(text: str) -> float:
    words = words_of(text)
    return len(set(words)) / len(words) if words else 0.0


def mtld(text: str) -> float:
    """Measure of Textual Lexical Diversity, bidirectional (McCarthy & Jarvis 2010).

    TTR is length-dependent, which makes it useless for comparing texts of different
    length — and length is exactly what probe 2 says may differ between the classes here.
    MTLD counts how many words it takes for TTR to fall to `MTLD_THRESHOLD`, so it is the
    diversity number that survives a length difference. Both are published: TTR is the
    one every reader knows, MTLD is the one that holds.
    """
    words = words_of(text)
    if not words:
        return 0.0

    def factors(sequence: list[str]) -> float:
        count = 0.0
        types: set[str] = set()
        tokens = 0
        remainder = 0.0
        for word in sequence:
            tokens += 1
            types.add(word)
            ratio = len(types) / tokens
            if ratio <= MTLD_THRESHOLD:
                count += 1
                types, tokens = set(), 0
            else:
                remainder = (1 - ratio) / (1 - MTLD_THRESHOLD)
        if tokens:
            count += remainder
        return len(sequence) / count if count else float(len(sequence))

    return statistics.fmean([factors(words), factors(list(reversed(words)))])


def trigram_repetition(text: str) -> float:
    """Fraction of word trigrams that are not the first occurrence of their shape."""
    words = words_of(text)
    trigrams = [tuple(words[index : index + 3]) for index in range(len(words) - 2)]
    if not trigrams:
        return 0.0
    return 1 - len(set(trigrams)) / len(trigrams)


def function_word_rate(text: str) -> float:
    words = words_of(text)
    if not words:
        return 0.0
    return sum(1 for word in words if word in FUNCTION_WORDS) / len(words)


def _per_hundred_words(count: int, text: str) -> float:
    words = len(words_of(text))
    return 100 * count / words if words else 0.0


def punctuation_rate(text: str) -> float:
    """All punctuation per 100 words. Parentheses, colons and dashes also count here.

    Deliberately NOT the complement of the three specific features below: the specific
    ones exist because a generator's dash habit is the signal, and subtracting them from
    the total would leave a residue nobody can name.
    """
    return _per_hundred_words(
        sum(1 for char in text if unicodedata.category(char).startswith("P")), text
    )


def parenthesis_rate(text: str) -> float:
    return _per_hundred_words(sum(1 for char in text if char in "()[]{}"), text)


def colon_rate(text: str) -> float:
    return _per_hundred_words(text.count(":"), text)


def dash_rate(text: str) -> float:
    """Em dash, en dash and the spaced hyphen — never the hyphen inside a compound.

    `palavras-chave` is one word in pt-BR and its hyphen is orthography, not punctuation;
    counting it would make every text with compounds look like a text full of asides.
    """
    return _per_hundred_words(len(_DASH.findall(text)), text)


def connective_rate(text: str) -> float:
    folded = fold_for_phrases(text)
    hits = sum(
        len(re.findall(rf"(?<!\w){re.escape(phrase)}(?!\w)", folded))
        for phrase in CONNECTIVES
    )
    return _per_hundred_words(hits, text)


def list_line_rate(text: str) -> float:
    lines = [line for line in text.split("\n") if line.strip()]
    if not lines:
        return 0.0
    return len(_LIST_LINE.findall(text)) / len(lines)


def paragraph_break_rate(text: str) -> float:
    return _per_hundred_words(len(re.findall(r"\n\s*\n", text)), text)


def hapax_rate(text: str) -> float:
    """Words occurring once in THIS document.

    Rarity read document-internally, because a corpus frequency list is a download this
    diagnostic does not pay for. It measures the same axis a frequency list would —
    vocabulary spread — and it is reported beside `long-word-rate` so the two disagree
    visibly when one of them is being driven by something else.
    """
    words = words_of(text)
    if not words:
        return 0.0
    counts = Counter(words)
    return sum(1 for word, total in counts.items() if total == 1) / len(words)


def long_word_rate(text: str) -> float:
    words = words_of(text)
    if not words:
        return 0.0
    return sum(1 for word in words if len(word) >= LONG_WORD_CHARS) / len(words)


def flesch_pt(text: str) -> float:
    """Índice de Facilidade de Leitura, the pt-BR adaptation of Flesch.

    `248.835 - 1.015 * (words/sentences) - 84.6 * (syllables/words)` (Martins et al.
    1996). The coefficients are the pt-BR ones and not the English Flesch's: Portuguese
    words carry more syllables per word than English ones, so the English constants score
    every Portuguese text as harder than it is.
    """
    words = words_of(text)
    sentences = sentences_of(text)
    if not words or not sentences:
        return 0.0
    per_sentence = len(words) / len(sentences)
    per_word = sum(syllables_in(word) for word in words) / len(words)
    return 248.835 - 1.015 * per_sentence - 84.6 * per_word


def _frame_indicator(sentence: str, frames: tuple[str, ...]) -> float:
    folded = fold_for_phrases(sentence)
    return 1.0 if any(phrase in folded for phrase in frames) else 0.0


def opening_pattern(text: str) -> float:
    sentences = sentences_of(text)
    return _frame_indicator(sentences[0], OPENING_FRAMES) if sentences else 0.0


def conclusion_pattern(text: str) -> float:
    sentences = sentences_of(text)
    return _frame_indicator(sentences[-1], CONCLUSION_FRAMES) if sentences else 0.0


# The feature registry, in report order. A mapping and not a list of calls, because the
# guard below has to be able to ask what the model is allowed to see.
STYLOMETRIC_FEATURES: dict[str, Callable[[str], float]] = {
    "sentence-length-mean": sentence_length_mean,
    "sentence-length-variance": sentence_length_variance,
    "word-length-mean": word_length_mean,
    "type-token-ratio": type_token_ratio,
    "mtld": mtld,
    "trigram-repetition": trigram_repetition,
    "function-word-rate": function_word_rate,
    "punctuation-rate": punctuation_rate,
    "parenthesis-rate": parenthesis_rate,
    "colon-rate": colon_rate,
    "dash-rate": dash_rate,
    "connective-rate": connective_rate,
    "list-line-rate": list_line_rate,
    "paragraph-break-rate": paragraph_break_rate,
    "hapax-rate": hapax_rate,
    "long-word-rate": long_word_rate,
    "flesch-pt": flesch_pt,
    "opening-pattern": opening_pattern,
    "conclusion-pattern": conclusion_pattern,
}


# ---------------------------------------------------------------------------
# The spelling-error rate: a BIAS measure, and never a feature
# ---------------------------------------------------------------------------

# RULE OF DOMAIN, and the whole reason this lives in its own registry: a spelling error
# correlates with non-native writing and with a limited vocabulary, which are precisely the
# populations whose false-positive rate this project committed to watching. MEASURING it is
# what lets the project know whether its signal leans on it; FEEDING it to the model builds
# that bias inside the model, where no slice can find it afterwards.
#
# The shapes are missing diacritics on high-frequency words that have no unaccented
# homograph, plus a closed list of measured pt-BR misspellings. `esta`, `publico`, `pos`
# and `so` are deliberately ABSENT, and so are `ate` and `quiz`: each is also a correctly
# spelled pt-BR word — `ate` is the subjunctive of *atar* ("ate o sapato") and `quiz` is a
# current loanword ("um quiz") — so counting any of them turns a correct sentence into an
# error. The exclusion costs the two commonest shapes of all (`até`, `quis`) and is paid
# anyway, because the error it prevents falls on the HUMAN side, which is the side the
# ~7,5x reading depends on. `quizer` stays: it is no word.
#
# THE PROXY IS COARSE AND THE COARSENESS CUTS ONE WAY: an ASCII-only document — a code
# block, an old plain-text dump, a URL-heavy page — reads as maximally misspelled. That is
# a property of the proxy rather than of the writer, and it is a second reason the number
# may never reach a score.
PT_BR_SPELLING_SHAPES: tuple[str, ...] = (
    r"\bnao\b",
    r"\bvoce\b",
    r"\bvoces\b",
    r"\btambem\b",
    r"\bja\b",
    r"\bapos\b",
    r"\bporem\b",
    r"\batraves\b",
    r"\bpossivel\b",
    r"\bfacil\b",
    r"\bdificil\b",
    r"\bultimo\b",
    r"\bproprio\b",
    r"\bhistoria\b",
    r"\bfamilia\b",
    r"\bnecessario\b",
    r"\birmao\b",
    r"\bsao\b",
    r"\btres\b",
    r"\bconcerteza\b",
    r"\bderepente\b",
    r"\bderrepente\b",
    r"\bmenas\b",
    r"\bseje\b",
    r"\bexcess[ãa]o\b",
    r"\bprevil[ée]gio\b",
    r"\bbeneficiente\b",
    r"\bmeter[ée]ologia\b",
    r"\bimpecilho\b",
    r"\bcabelereiro\b",
    r"\bquizer\b",
    r"\btrouche\b",
    r"\bvo[çc]e[êe]\b",
)

_SPELLING = tuple(
    re.compile(shape, re.IGNORECASE | re.UNICODE) for shape in PT_BR_SPELLING_SHAPES
)


def spelling_error_rate(text: str) -> float:
    """Matches of `PT_BR_SPELLING_SHAPES` per 100 words. A BIAS MEASURE.

    Reported so the project knows whether its signal leans on it. It reaches no feature
    matrix, no model and no published score, and `assert_no_bias_measure_reaches_the_features`
    refuses before any fit if it ever does.
    """
    folded = fold_for_phrases(text)
    return _per_hundred_words(
        sum(len(pattern.findall(folded)) for pattern in _SPELLING), text
    )


# The measures that describe a POPULATION and must never describe a row to a model. A
# second registry rather than a naming convention: a convention is checked by a reader and
# this is checked by the code that builds the matrix.
SPELLING_BIAS_MEASURES: dict[str, Callable[[str], float]] = {
    "spelling-error-rate": spelling_error_rate,
}


def assert_no_bias_measure_reaches_the_features() -> None:
    """Refuses when a bias measure is registered as a feature, by NAME or by CALLABLE.

    Both checks are needed and neither implies the other: registering
    `spelling_error_rate` under a new name defeats a name check, and registering a
    one-line wrapper under the same name defeats an identity check.
    """
    shared_names = sorted(set(STYLOMETRIC_FEATURES) & set(SPELLING_BIAS_MEASURES))
    bias_callables = set(SPELLING_BIAS_MEASURES.values())
    shared_callables = sorted(
        name for name, function in STYLOMETRIC_FEATURES.items()
        if function in bias_callables
    )
    if not shared_names and not shared_callables:
        return
    raise BiasMeasureReachedTheFeatures(
        "a bias measure is registered as a model feature — "
        f"by name {shared_names}, by callable {shared_callables}. A spelling-error rate "
        "correlates with non-native writing and with a limited vocabulary, which are the "
        "populations whose false-positive rate this project committed to watching: "
        "measuring it protects them, feeding it to the model builds the bias inside the "
        "model, where no slice can find it afterwards"
    )


# ---------------------------------------------------------------------------
# Probe 4 — stylometry, and the coefficients. DIAGNOSTIC.
# ---------------------------------------------------------------------------


def feature_row(text: str) -> dict[str, float]:
    """One row of the feature matrix. Refuses first if a bias measure is registered."""
    assert_no_bias_measure_reaches_the_features()
    return {name: function(text) for name, function in STYLOMETRIC_FEATURES.items()}


def feature_matrix(texts: Sequence[str]) -> tuple[list[str], list[list[float]]]:
    """The feature names and the matrix, in registry order.

    The guard runs HERE and not only in the test, because a caller that reached the matrix
    is a caller one `fit` away from a score.
    """
    assert_no_bias_measure_reaches_the_features()
    names = list(STYLOMETRIC_FEATURES)
    return names, [[STYLOMETRIC_FEATURES[name](text) for name in names] for text in texts]


def stylometry_rows(records: Iterable[dict]) -> list[dict]:
    """`human` and `ai` rows of `train` and `dev` only, for a STAMPED corpus.

    `cal-A` is excluded although it is not blind: at `dev` 5 % + `cal-A` 10 % it is TWO
    THIRDS of the population that fits the provisional threshold (`benchmark/commands/fit.ts`
    — the human negatives of `dev` + `cal-A`, 600 lines under the one-cell frame), and a
    diagnostic has no business being the reason anybody looked at it.
    """
    return [
        row
        for row in records
        if partition_of(row) in ("train", "dev") and row.get("label") in ("human", "ai")
    ]


def fit_on_feature_matrix(
    matrix: Sequence[Sequence[float]], labels: Sequence[int], seed: int = PROBE_SEED
):
    """Standardized features into a logistic regression. Returns the fitted pipeline.

    Standardized because the coefficients are the OUTPUT: the features are in different
    units — words per sentence beside a rate per 100 words beside an indicator — and
    unscaled coefficients are a table of unit conversions rather than a table of
    contributions.

    NOT a forest and not boosting, and that is the point rather than a limitation:
    legibility is the deliverable here, and an importance ranking cannot say the
    DIRECTION a feature pushes. Permutation importance is available beside the
    coefficients for the robustness reading.

    Takes the MATRIX and not the rows because the fold loop fits five times over one
    corpus: extracting the features per fold would recompute MTLD, which is the most
    expensive feature here, five times for every document.
    """
    from sklearn.linear_model import LogisticRegression
    from sklearn.pipeline import make_pipeline
    from sklearn.preprocessing import StandardScaler

    return make_pipeline(
        StandardScaler(), LogisticRegression(max_iter=5000, random_state=seed)
    ).fit(list(matrix), list(labels))


def fit_stylometry_model(rows: Sequence[dict], seed: int = PROBE_SEED):
    """`fit_on_feature_matrix` over the rows' own texts, for callers holding rows."""
    _, matrix = feature_matrix([str(row.get("text", "")) for row in rows])
    return fit_on_feature_matrix(
        matrix, [1 if row.get("label") == "ai" else 0 for row in rows], seed=seed
    )


def probe_stylometry(
    rows: Sequence[dict], seed: int = PROBE_SEED, permutation_repeats: int = 0
) -> dict:
    """The coefficients, the out-of-fold AUC, and the bias measure BESIDE them.

    `biasMeasures` is reported here so the number is in front of whoever reads the
    coefficients, and it is not in `coefficients` because it is not in the model. The two
    live in one report and in two different fields on purpose.
    """
    import numpy as np
    from sklearn.model_selection import StratifiedKFold

    labelled = [row for row in rows if row.get("label") in ("human", "ai")]
    per_class = Counter(str(row["label"]) for row in labelled)
    thin = {name: n for name, n in per_class.items() if n < PROBE_FOLDS}
    if thin or len(per_class) < 2:
        raise NotEnoughRowsToProbe(
            "the stylometric probe needs both `human` and `ai` with at least "
            f"{PROBE_FOLDS} rows each and found {dict(sorted(per_class.items()))}"
        )

    texts = [str(row.get("text", "")) for row in labelled]
    names, matrix = feature_matrix(texts)
    features = np.array(matrix, dtype=float)
    targets = np.array([1 if row["label"] == "ai" else 0 for row in labelled])

    out_of_fold = [0.0] * len(labelled)
    folds = StratifiedKFold(n_splits=PROBE_FOLDS, shuffle=True, random_state=seed)
    for train_index, test_index in folds.split(features, targets):
        model = fit_on_feature_matrix(
            features[train_index], targets[train_index], seed=seed
        )
        predicted = model.predict_proba(features[test_index])[:, 1]
        for offset, row in enumerate(test_index):
            out_of_fold[row] = float(predicted[offset])

    whole = fit_on_feature_matrix(features, targets, seed=seed)
    coefficients = [
        {"feature": name, "coefficient": float(value)}
        for name, value in zip(names, whole[-1].coef_[0])
    ]
    report = {
        "probe": "stylometry",
        "decides": False,
        "rows": len(labelled),
        "counts": dict(sorted(per_class.items())),
        "folds": PROBE_FOLDS,
        "seed": seed,
        "auc": rank_auc(out_of_fold, [row["label"] == "ai" for row in labelled]),
        "intercept": float(whole[-1].intercept_[0]),
        "coefficients": sorted(
            coefficients, key=lambda entry: -abs(entry["coefficient"])
        ),
        "biasMeasures": {
            name: {
                "human": statistics.fmean(
                    [
                        measure(str(row.get("text", "")))
                        for row in labelled
                        if row["label"] == "human"
                    ]
                ),
                "ai": statistics.fmean(
                    [
                        measure(str(row.get("text", "")))
                        for row in labelled
                        if row["label"] == "ai"
                    ]
                ),
                "isFeature": False,
            }
            for name, measure in SPELLING_BIAS_MEASURES.items()
        },
    }
    if permutation_repeats > 0:
        from sklearn.inspection import permutation_importance

        importance = permutation_importance(
            whole,
            features,
            targets,
            n_repeats=permutation_repeats,
            random_state=seed,
            scoring="roc_auc",
        )
        report["permutationImportance"] = sorted(
            (
                {"feature": name, "meanAucDrop": float(value)}
                for name, value in zip(names, importance.importances_mean)
            ),
            key=lambda entry: -entry["meanAucDrop"],
        )
    return report


# ---------------------------------------------------------------------------
# Dispersion across windows. DIAGNOSTIC.
# ---------------------------------------------------------------------------

SEALED_MODEL_MANIFEST = (
    Path(__file__).resolve().parent.parent.parent
    / "models"
    / "cleanfeed-ptbr-v1"
    / "cleanfeed-model.json"
)


def sealed_window_plan(manifest_path: Path = SEALED_MODEL_MANIFEST) -> dict:
    """`windowing` out of the sealed model manifest — READ, never retyped.

    The stride is what decides how many windows a document has, so a copy on this side
    would be a second authority able to disagree with the artifact the runtime loads.
    """
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    return dict(manifest["windowing"])


def content_windows(
    total_tokens: int, content_tokens: int, overlap_tokens: int
) -> list[tuple[int, int, int]]:
    """`(index, start, end)` per candidate window — the mirror of `buildContentWindows`.

    Byte-for-byte the loop in `src/inference/chunker.ts`: advance by
    `contentTokens - overlapTokens`, stop on the window that reaches the last token.
    """
    if total_tokens <= 0:
        return []
    step = content_tokens - overlap_tokens
    windows: list[tuple[int, int, int]] = []
    start = 0
    index = 0
    while start < total_tokens:
        end = min(start + content_tokens, total_tokens)
        windows.append((index, start, end))
        if end == total_tokens:
            break
        start += step
        index += 1
    return windows


def distributed_indices(total: int, limit: int) -> list[int]:
    """The mirror of `distributedIndices` in `src/inference/chunker.ts`.

    `round(i * (total - 1) / (limit - 1))`, deduplicated, first and last always kept.
    Python's `round` is banker's rounding and JavaScript's `Math.round` is half-up, so
    the halves are taken with `floor(x + 0.5)` rather than with `round`.
    """
    if total <= 0 or limit <= 0:
        return []
    if total <= limit:
        return list(range(total))
    if limit == 1:
        return [0]
    positions = {
        math.floor(index * (total - 1) / (limit - 1) + 0.5) for index in range(limit)
    }
    return sorted(positions)


def window_texts(text: str, plan: dict) -> list[str]:
    """The text of every SELECTED window, tiled and truncated as the runtime does.

    TECHNICAL DIVERGENCE, DECLARED. The runtime tiles WordPiece content tokens; this
    tiles whitespace tokens, because a WordPiece tokenizer is a model download and a
    diagnostic does not pay for one. So the RULE is the sealed one — the stride, the
    overlap and the `maxWindows` truncation are read from the manifest — and the UNIT is
    coarser, which means the window boundaries are not the runtime's boundaries. The
    quantity being reported is the dispersion ACROSS windows of one document, and the
    comparison is between documents measured the same way.
    """
    tokens = str(text).split()
    windows = content_windows(
        len(tokens), int(plan["contentTokens"]), int(plan["overlapTokens"])
    )
    selected = distributed_indices(len(windows), int(plan["maxWindows"]))
    return [
        " ".join(tokens[windows[position][1] : windows[position][2]])
        for position in selected
    ]


def window_dispersion(
    text: str, score_window: Callable[[str], float], plan: dict
) -> dict:
    """Count, mean, spread and standard deviation of one document's window scores.

    Free of charge: the document score is already an aggregation over windows, so the
    dispersion is a quantity the aggregation throws away. It is the natural signal of
    MIXED authorship — a document written half by a person carries windows on both sides
    of the cut, and a document written by one carries windows that agree.
    """
    slices = window_texts(text, plan)
    if not slices:
        return {"windows": 0, "mean": 0.0, "spread": 0.0, "standardDeviation": 0.0}
    scores = [float(score_window(slice_)) for slice_ in slices]
    return {
        "windows": len(scores),
        "mean": statistics.fmean(scores),
        "spread": max(scores) - min(scores),
        "standardDeviation": (
            statistics.pstdev(scores) if len(scores) > 1 else 0.0
        ),
    }


def probe_window_dispersion(
    rows: Iterable[dict],
    score_window: Callable[[str], float],
    plan: dict | None = None,
) -> dict:
    """Mean window dispersion per class, over documents that HAVE more than one window.

    A single-window document has a spread of zero by arithmetic and not by agreement, so
    it is counted separately instead of pulling every mean towards zero.
    """
    plan = sealed_window_plan() if plan is None else plan
    per_class: dict[str, list[dict]] = {}
    single = Counter()
    for row in rows:
        label = str(row.get("label", "?"))
        measured = window_dispersion(str(row.get("text", "")), score_window, plan)
        if measured["windows"] <= 1:
            single[label] += 1
            continue
        per_class.setdefault(label, []).append(measured)
    return {
        "probe": "window-dispersion",
        "decides": False,
        "windowPlan": plan,
        "tokenUnit": "whitespace",
        "classes": {
            label: {
                "documents": len(measured),
                "meanWindows": statistics.fmean(
                    [entry["windows"] for entry in measured]
                ),
                "meanSpread": statistics.fmean([entry["spread"] for entry in measured]),
                "meanStandardDeviation": statistics.fmean(
                    [entry["standardDeviation"] for entry in measured]
                ),
            }
            for label, measured in sorted(per_class.items())
        },
        "singleWindowDocuments": dict(sorted(single.items())),
    }


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def rows_from_pools(candidates: Path, names: Sequence[str] | None = None) -> list[dict]:
    """Candidate pool rows in the shape the probes read, WITHOUT a partition.

    The pools predate the split, so probe 1 is unreachable from here and says so
    (`CorpusIsNotStamped`). What the pools do carry is class, lane and text, which is
    everything probes 2 to 4, the bias measure and the dispersion need — and measuring
    them before an assembly exists is the point, since the generation slate is what a
    length or a lane artifact sends back for regeneration.

    `names` selects pool FILES, and selecting them is NOT optional housekeeping: the
    published frame has one cell, so `names=None` reads the out-of-frame human pools
    (Stack Overflow — blocked by name by F0-6 —, B2W, Carolina) and the generator family
    the plan reserves for OOD, which together are most of the directory. A probe run over
    them reports the stylometry of a population the claim does not name.
    `load_humans` opens `wikipedia_fresh.jsonl` and nothing else; `IN_FRAME_POOLS` is the
    selection that reproduces the published rates.

    Every row carries the pool file it came from (`poolFile`), so `input_provenance` can
    put the material in the report: a report that does not name its input cannot be told
    apart from one run over the whole directory.
    """
    rows: list[dict] = []
    wanted = None if names is None else set(names)
    for path in sorted(candidates.glob("*.jsonl")):
        name = path.name
        if name.startswith("_"):
            continue
        if wanted is not None and name not in wanted:
            continue
        for row in read_jsonl(path):
            text = row.get("text")
            if not isinstance(text, str) or not text.strip():
                continue
            if name.startswith("ai_"):
                label = "ai"
            elif "mixed" in name:
                label = "mixed"
            else:
                label = "human"
            rows.append(
                {
                    "id": row.get("candidateId") or row.get("id") or path.stem,
                    "label": label,
                    "text": text,
                    "meta": row.get("meta") or {},
                    "domainSource": row.get("domainSource"),
                    "poolFile": name,
                }
            )
    return rows


# The nine pool files inside the published frame — one cell, `ptwiki` human text. Written
# as a constant and not left to the caller because the recipe was recorded in prose once
# and the prose said `--pools` with no restriction, which reads 67.934 rows instead of
# 9.707. Anything absent here is absent for a reason the plan states: `ptso*` is blocked by
# name (F0-6), `carolina*`/`b2w*`/`wikipedia.jsonl` are out of frame, `ai_openai` and
# `ai_public_madras` are the family reserved for the OOD slice.
IN_FRAME_POOLS: tuple[str, ...] = (
    "wikipedia_fresh.jsonl",
    "ai_fresh_agy.jsonl",
    "ai_fresh_agy_low.jsonl",
    "ai_fresh_codex.jsonl",
    "ai_fresh_codex_topup.jsonl",
    "ai_fresh_gemini.jsonl",
    "ai_fresh_gemini_multi.jsonl",
    "mixed_candidates.jsonl",
    "mixed_from_pairs.jsonl",
)

ASSEMBLED_INPUT = "<assembled records.jsonl>"


def input_provenance(rows: Sequence[dict]) -> dict:
    """Which material a report was computed over, counted per pool file.

    Belongs in the report and not only in the runbook: the qualifier "in frame" is a claim
    about the INPUT, and a reader holding the artifact has no other way to check it. Rows
    of an assembled corpus carry no pool file and count under `ASSEMBLED_INPUT`, which
    keeps the key present — an absent key would read as "not measured" instead of "read
    from a corpus".
    """
    per_file = Counter(str(row.get("poolFile") or ASSEMBLED_INPUT) for row in rows)
    return {
        "rows": len(rows),
        "files": len(per_file),
        "rowsPerFile": dict(sorted(per_file.items())),
    }


def _probe_all(rows: Sequence[dict], stamped: bool, permutation_repeats: int) -> dict:
    report: dict = {
        "report": "diagnostic-probes",
        "governance": (
            "only `partition-exchangeability` decides, and it decides the ASSEMBLY. "
            "Every other probe here is a published diagnostic (the `diagnostic` role of "
            "benchmark/gates.ts): it enters no primary family, spends no familial alpha "
            "and is no hypothesis"
        ),
        "rows": len(rows),
        "inputs": input_provenance(rows),
    }
    if stamped:
        report["partitionExchangeability"] = probe_partitions(rows)
        # Probes 2 and 3 describe the CORPUS, so they read every open partition; probe 4
        # reads `train` + `dev` only, for the reason `stylometry_rows` states.
        open_rows, _ = open_partition_rows(rows)
        stylometry_input: Sequence[dict] = stylometry_rows(rows)
    else:
        report["partitionExchangeability"] = {
            "probe": "partition-exchangeability",
            "decides": True,
            "notRun": "the input carries no partition: a pool row predates the split",
        }
        open_rows = list(rows)
        stylometry_input = open_rows
    report["classFromLength"] = probe_length(open_rows)
    report["laneWithinAi"] = probe_lanes(open_rows)
    report["stylometry"] = probe_stylometry(
        stylometry_input, permutation_repeats=permutation_repeats
    )
    model = fit_stylometry_model(
        [row for row in stylometry_input if row.get("label") in ("human", "ai")]
    )

    def score_window(slice_: str) -> float:
        _, matrix = feature_matrix([slice_])
        return float(model.predict_proba(matrix)[0][1])

    report["windowDispersion"] = probe_window_dispersion(open_rows, score_window)
    return report


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument(
        "--records", type=Path, help="an ASSEMBLED records.jsonl (stamped partitions)"
    )
    source.add_argument(
        "--pools", type=Path, help="a candidates/ directory (no partitions; probe 1 off)"
    )
    parser.add_argument(
        "--pool-file",
        action="append",
        default=None,
        help="restrict --pools to these file names (repeatable); see rows_from_pools",
    )
    parser.add_argument(
        "--in-frame-pools",
        action="store_true",
        help=f"restrict --pools to IN_FRAME_POOLS ({len(IN_FRAME_POOLS)} files)",
    )
    parser.add_argument("--out", type=Path, required=True)
    parser.add_argument("--permutation-repeats", type=int, default=0)
    args = parser.parse_args()

    if args.records is not None:
        if args.in_frame_pools or args.pool_file:
            parser.error("--pool-file and --in-frame-pools apply to --pools only")
        rows = read_jsonl(args.records)
        stamped = True
    else:
        if args.in_frame_pools and args.pool_file:
            parser.error("--in-frame-pools and --pool-file select the same thing")
        names = IN_FRAME_POOLS if args.in_frame_pools else args.pool_file
        rows = rows_from_pools(args.pools, names)
        stamped = False

    report = _probe_all(rows, stamped, args.permutation_repeats)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(f"diagnostic probes -> {args.out}")
    if stamped:
        assert_partitions_are_exchangeable(report["partitionExchangeability"])


if __name__ == "__main__":
    main()
