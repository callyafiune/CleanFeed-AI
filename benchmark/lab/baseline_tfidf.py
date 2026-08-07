"""TF-IDF + logistic-regression floor for the pilot (lab bench, sklearn).

The cheapest possible detector: TF-IDF into a linear model, 5-fold stratified CV
over the topic-paired pilot (AI texts vs their human parents — balanced and
topic-controlled by construction). Its AUC is the FLOOR any real detector must
beat; if even this separates the classes, there is learnable authorship signal in
the corpus.

FIVE VECTORIZATIONS, RUN TOGETHER AND REPORTED SIDE BY SIDE — word n-grams (1,2),
CHARACTER n-grams (3,6), and the cheap floor split into its two branches beside their
union. Not an ensemble: five numbers, because the reason for each is not performance. This
baseline's role in Phase 4 is to be a LEAKAGE DETECTOR (D19), and a word n-gram walks
straight past the typographic artifacts the anti-artifact gate hunts — an asterisk run, a
heading line, a non-breaking space, a mojibake sequence are not words, so the word
vectorizer never sees them while a character n-gram of length 3 to 6 lands on them
directly. A high AUC here still means ARTIFACT OF SOURCE rather than quality, and
the numbers say WHICH KIND: word high with char low is lexical or topical, char
high with word low is typographic, and both high is either or both.

`analyzer="char"` and NOT `char_wb`: `char_wb` pads at word boundaries and confines
its n-grams inside words, which is exactly where the marks are not. `** ` between two
words, a space before a newline, a pipe table's ` | ` all live ACROSS the boundary,
and confining the analyzer to the inside of words buys back the blind spot the
character n-gram was added to close.

THE CHEAP FLOOR IS TWO BRANCHES, AND ONLY ONE OF THEM IS THEME-BLIND.

  * `funcionais` — TF-IDF over a CLOSED list of pt-BR function words, and the only
    vectorization here that reads no content at all. THIS is the theme-blind floor: the gap
    from it to the large model is the MAXIMUM that could be thematic. It does not prove the
    gap IS thematic — it bounds it. The precedent is Mosteller & Wallace (1963) on the
    disputed Federalist Papers, who attributed authorship from function words precisely
    because function words are independent of topic (docs/references.md § O3).
  * `estilometria` — the 19 W3 stylometric features, and NOT theme-blind. Seven of them
    (`type-token-ratio`, `mtld`, `trigram-repetition`, `hapax-rate`, `long-word-rate`,
    `word-length-mean`, `flesch-pt`) are functions of the content words, and
    `_stylometry_matrix` is handed the whole text.
  * `funcionais+estilometria` — their union. The strongest cheap baseline, and blind to
    nothing; it bounds how much of the separation could be thematic no more than
    `estilometria` alone does.

The branches are reported SEPARATELY because the union alone was read as a theme-blind
number and it is not one. Measured over the 253 topic-paired pilot rows (2026-08-07,
docs/ESTADO.md § 5.8): the union reaches 0,9767, `estilometria` alone 0,9712 — 98,8 % of the
union's above-chance separation — while `funcionais` alone reaches 0,9313, just BELOW word
(0,9327) and char (0,9319). Publishing the union as theme-blind credited function words with
a separation that content-sensitive features carry, and made a floor that merely TIES the two
content-reading vectorizations look like it beat them.

`assert_the_function_word_list_is_the_declared_closed_class` and
`assert_no_content_word_reaches_the_vocabulary` are what make "blind" a property of the
code rather than of this docstring: the first pins `probes.FUNCTION_WORDS` to an inventory
enumerated here BY GRAMMATICAL CLASS, so any word added there refuses at construction
whether or not anybody listed it as content; the second refuses a fitted vectorizer whose
features are not a subset of that list — the shape a dropped `vocabulary=` argument takes.

Usage:
  python baseline_tfidf.py \
    --ai ../data/candidates/ai_fresh_*.jsonl \
    --humans ../data/candidates/wikipedia_fresh.jsonl \
    [--reserved-family <canonical family>] [--detector-scores <scored.jsonl>] \
    [--out <report.json>]

Only AI rows whose `meta.pairedWith` names a row of `--humans` enter the dataset, and only
those parents form the human side: the balanced, topic-paired shape is what the invocation
PRODUCES rather than something the caller has to arrange outside the tool.
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
from sklearn.pipeline import FeatureUnion, make_pipeline
from sklearn.preprocessing import FunctionTransformer, StandardScaler

import assemble_corpus
import diagnostic_probes as probes
import entity_masking

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


# --- the theme-blind branch (Mosteller & Wallace) ---------------------------
#
# The closed function-word list is `diagnostic_probes.FUNCTION_WORDS` and is READ, never
# copied: the stylometric probe already counts against it (`function-word-rate`), and two
# copies of a closed grammatical class is one copy that can drift.
FUNCTION_WORD_VOCABULARY: tuple[str, ...] = tuple(sorted(probes.FUNCTION_WORDS))

# The same list enumerated by the grammatical class that admits each word, which IS the
# criterion `docs/references.md` § O3 declares in the absence of a citable pt-BR list: a
# closed class, never a frequency band. A PIN and not a second source — the vectorizer reads
# `probes.FUNCTION_WORDS` — whose whole job is to refuse when the two disagree, so a word
# promoted into the function-word list to lift the branch's AUC has to be written here too,
# under a grammatical class that does not admit it.
DECLARED_FUNCTION_WORD_CLASSES: dict[str, frozenset[str]] = {
    "artigos": frozenset("a as o os um uma umas uns".split()),
    "preposicoes": frozenset(
        "após até com contra de desde em entre para perante por sem sobre".split()
    ),
    "contracoes": frozenset(
        """ao aos da das do dos dela delas dele deles dessa desse desta deste disso
        na nas nesse nesta neste no nos num numa pela pelas pelo pelos à às""".split()
    ),
    "conjuncoes": frozenset("como e mas nem ou pois porque que se".split()),
    "pronomes": frozenset(
        """cuja cujo ela elas ele eles essa essas esse esses esta estas este estes eu
        isso isto lhe lhes me meu minha nós quais qual quem seu seus si sua suas
        te teu tu você vocês""".split()
    ),
    "auxiliares": frozenset(
        """era eram está estão foi for foram havia há seja sendo ser será são tem
        tenha ter tinha é""".split()
    ),
    "adverbios": frozenset("já mesmo muito quando também".split()),
}

DECLARED_FUNCTION_WORDS: frozenset[str] = frozenset().union(
    *DECLARED_FUNCTION_WORD_CLASSES.values()
)

# Content words MEASURED in this material — the population the cell samples (Wikipedia
# lead sections) and the pools the generators wrote. They DO NOT carry the check any more;
# set equality against the declared classes does. A blacklist only ever refuses the content
# words somebody thought of, and while it was the check, `brasil` declared functional passed
# both guards and reached the fitted vocabulary. What this list still earns is the ERROR
# MESSAGE: it names the failure when the admitted word happens to be one of them. It stays
# deliberately SHORT of the obvious additions, so the closed-class check is exercised by a
# content word this list does not contain.
CONTENT_WORD_PROBES: frozenset[str] = frozenset(
    """município cidade estado país população habitantes região distrito sistema
    empresa produto filme álbum espécie futebol clube rio governo presidente
    universidade igreja guerra língua história saúde educação tecnologia mercado
    qualidade aparelho bateria entrega preço obra autor século área política
    economia cultura""".split()
)

# The theme-blind unigram range. Function-word BIGRAMS would need the cross product of the
# closed list as an explicit vocabulary — some thirty thousand entries over a pilot of a
# few thousand documents — and Mosteller & Wallace's own design counts single function
# words, which is the precedent this vectorization stands on.
FUNCTION_WORD_NGRAMS = (1, 1)

# `\w+` and NOT sklearn's default `(?u)\b\w\w+\b`, which drops every token shorter than two
# characters: five entries of the closed list are one character (`a`, `e`, `o`, `à`, `é`),
# and under the default they sit in the vocabulary with permanent zero mass — the three most
# frequent words of pt-BR, and exactly the material Mosteller & Wallace count. Measured cost
# of the default over the 253 pilot pairs: the branch reads 0,8944 instead of 0,9313.
FUNCTION_WORD_TOKEN_PATTERN = r"(?u)\b\w+\b"


class ContentWordReachedTheBaseline(RuntimeError):
    """The function-word list left its declared closed class, or a fitted vocabulary did."""


def assert_the_function_word_list_is_the_declared_closed_class() -> None:
    """Refuses when `probes.FUNCTION_WORDS` is not exactly `DECLARED_FUNCTION_WORDS`.

    Set equality, and not a test for "content": there is no computable test for content, so
    the check is against an inventory enumerated by grammatical class. The theme-blind
    branch is a floor of the theme-INDEPENDENT signal only if its vocabulary carries no
    subject matter at all, and a single word admitted here turns it into a topic classifier
    — the gap it was built to bound stops being a bound. Removals refuse too: a list that
    quietly lost `a`, `e` and `o` is a different measurement under the same name.
    """
    admitted = sorted(probes.FUNCTION_WORDS - DECLARED_FUNCTION_WORDS)
    dropped = sorted(DECLARED_FUNCTION_WORDS - probes.FUNCTION_WORDS)
    if not admitted and not dropped:
        return
    known_content = sorted(set(admitted) & CONTENT_WORD_PROBES)
    named = (
        f"; {known_content} are content words MEASURED in this material"
        if known_content
        else ""
    )
    raise ContentWordReachedTheBaseline(
        "the pt-BR function-word list is not the declared closed class — "
        f"{len(admitted)} admitted {admitted[:10]}, {len(dropped)} dropped {dropped[:10]}"
        f"{named}. The theme-blind branch bounds how much of the detector's separation "
        "COULD be thematic; a word outside the closed grammatical classes reads subject "
        "matter and the bound stops holding"
    )


def _stylometry_matrix(texts) -> np.ndarray:
    """The W3 stylometric features as a dense matrix, in registry order.

    Reached through `probes.feature_matrix`, which refuses first if a bias measure is
    registered as a feature — so the spelling-error rate cannot enter the floor either.
    """
    _, matrix = probes.feature_matrix([str(text) for text in texts])
    return np.asarray(matrix, dtype=float)


def _function_word_branch() -> TfidfVectorizer:
    """The closed list and nothing else.

    `vocabulary=` is the whole mechanism: with it, the vectorizer counts only the closed
    list and `fit` learns no vocabulary from the corpus. Without it the same code fits a
    normal bag of words, which is why `assert_no_content_word_reaches_the_vocabulary`
    reads the FITTED object instead of trusting this call.

    `min_df` is deliberately absent: it is a data-driven cut, and over an explicit
    vocabulary it would silently drop function words that a small fold happens not to
    contain, making the feature space a property of the fold.
    """
    return TfidfVectorizer(
        vocabulary=FUNCTION_WORD_VOCABULARY,
        ngram_range=FUNCTION_WORD_NGRAMS,
        token_pattern=FUNCTION_WORD_TOKEN_PATTERN,
        sublinear_tf=True,
        lowercase=True,
    )


def _stylometry_branch():
    return make_pipeline(
        # `validate=False`: the input is an object array of strings, and the default
        # validation would try to coerce it to a numeric array and fail.
        FunctionTransformer(_stylometry_matrix, validate=False),
        StandardScaler(),
    )


def function_word_pipeline():
    """THE theme-blind vectorization: the closed function-word list into a linear model.

    A `FeatureUnion` of a single branch rather than the bare vectorizer, so
    `assert_no_content_word_reaches_the_vocabulary` reads this model by the same path it
    reads the union's — one guard, and no second way to look up the fitted vocabulary.
    """
    assert_the_function_word_list_is_the_declared_closed_class()
    return make_pipeline(
        FeatureUnion([("function-words", _function_word_branch())]),
        LogisticRegression(max_iter=5000, C=1.0),
    )


def stylometry_pipeline():
    """The 19 W3 features alone, and NOT theme-blind.

    Seven of the nineteen are functions of the content words, so this number bounds nothing
    about theme. It is reported so the union's AUC can be attributed instead of assumed.
    """
    return make_pipeline(_stylometry_branch(), LogisticRegression(max_iter=5000, C=1.0))


def cheap_floor_pipeline():
    """Both branches into one linear model: the strongest cheap baseline, blind to nothing.

    This is the floor the reserved-family comparison reads, because that comparison wants
    the MOST a dumb model reaches — using the weaker theme-blind branch there would understate
    the lift and read easiness as generalization.
    """
    assert_the_function_word_list_is_the_declared_closed_class()
    return make_pipeline(
        FeatureUnion(
            [
                ("function-words", _function_word_branch()),
                ("stylometry", _stylometry_branch()),
            ]
        ),
        LogisticRegression(max_iter=5000, C=1.0),
    )


def assert_no_content_word_reaches_the_vocabulary(model) -> None:
    """Refuses when a fitted theme-blind model carries a feature outside the closed list.

    Reads the fitted vectorizer out of the union by NAME, and refuses when the name is
    absent as well: a union rebuilt without the function-word branch would otherwise pass
    a check that found nothing to check.
    """
    union = model[0]
    branches = dict(union.transformer_list)
    if "function-words" not in branches:
        raise ContentWordReachedTheBaseline(
            "the fitted theme-blind model carries no `function-words` branch, so its "
            "vocabulary cannot be checked at all"
        )
    fitted = branches["function-words"].vocabulary_
    outside = sorted(set(fitted) - probes.FUNCTION_WORDS)
    if outside:
        raise ContentWordReachedTheBaseline(
            f"{len(outside)} features outside the closed function-word list reached the "
            f"theme-blind baseline, first ten {outside[:10]}. A vectorizer that learns "
            "its vocabulary from the corpus is a topic model"
        )


# label -> factory, in report order. A mapping so a caller cannot run one without the
# others: reporting the word AUC alone is the reading D19 exists to prevent; reporting it
# without the theme-blind branch is the reading that cannot tell separation from topic; and
# reporting the UNION without its two branches is the reading that credits function words
# with a separation the stylometric branch carries, which is what happened on 2026-08-07.
VECTORIZATIONS = {
    "word(1,2)": word_pipeline,
    "char(3,6)": char_pipeline,
    "funcionais": function_word_pipeline,
    "estilometria": stylometry_pipeline,
    "funcionais+estilometria": cheap_floor_pipeline,
}

# The subset of `VECTORIZATIONS` that reads no content word, and therefore the only label
# whose gap to the detector bounds how much of the separation could be thematic.
THEME_BLIND_VECTORIZATIONS: frozenset[str] = frozenset({"funcionais"})

# label -> the check that runs on the FITTED model of that vectorization, `None` when the
# vectorization has none. Keys must equal `VECTORIZATIONS`' keys, which is what stops a
# sixth vectorization from arriving without a decision about its post-fit check.
POST_FIT_GUARDS = {
    "word(1,2)": None,
    "char(3,6)": None,
    "funcionais": assert_no_content_word_reaches_the_vocabulary,
    "estilometria": None,
    "funcionais+estilometria": assert_no_content_word_reaches_the_vocabulary,
}


def assert_every_vectorization_declares_its_post_fit_guard() -> None:
    if set(VECTORIZATIONS) != set(POST_FIT_GUARDS):
        raise ContentWordReachedTheBaseline(
            "a vectorization has no declared post-fit guard: "
            f"{sorted(set(VECTORIZATIONS) ^ set(POST_FIT_GUARDS))}"
        )
    orphans = sorted(THEME_BLIND_VECTORIZATIONS - set(VECTORIZATIONS))
    if orphans:
        raise ContentWordReachedTheBaseline(
            f"{orphans} is declared theme-blind and is not a vectorization: the label that "
            "names which number bounds the thematic share cannot point at nothing"
        )


def cross_validated_aucs(
    texts: np.ndarray, labels: np.ndarray, pipeline_factory, after_fit=None
) -> list[float]:
    """Per-fold AUC of one vectorization, stratified and seeded.

    `after_fit` runs on EVERY fold's fitted model, not once: the vocabulary is a property
    of a fit, so a check that ran on the first fold only would miss a fold that learned
    its own.
    """
    aucs: list[float] = []
    folds = StratifiedKFold(
        n_splits=BASELINE_FOLDS, shuffle=True, random_state=BASELINE_SEED
    )
    for train, test in folds.split(texts, labels):
        model = pipeline_factory().fit(texts[train], labels[train])
        if after_fit is not None:
            after_fit(model)
        probabilities = model.predict_proba(texts[test])[:, 1]
        aucs.append(roc_auc_score(labels[test], probabilities))
    return aucs


# --- the reserved family: does its number measure generalization or EASE? ----
#
# The reserved (OOD) family is a small open-weights model, and there is a measurement of
# its own showing it writes fluent, FACTUALLY WRONG pt-BR prose — "Tratado de Tordesilhas
# sob mediação da Coroa Francesa", "maior maré quando a Lua está em quadratura" (quadrature
# is when the tide is WEAKEST). That does not invalidate the label; it makes the OOD slice
# EASIER than the training families, and an easier slice inflates the unseen-generator
# number in the flattering direction.
#
# The instrument is the CHEAP FLOOR (`funcionais+estilometria`, the strongest of the dumb
# baselines here and blind to nothing) run against the reserved family and against the core
# families, and compared with the large model on the same texts. The quantity is
# dimensionless on purpose:
#
#     lift(family) = (AUC_floor(family) − 0.5) / (AUC_detector(family) − 0.5)
#
# — the share of the detector's above-chance separation that a dumb lexical model already
# reaches. If a dumb baseline reaches nearly as much of it on the reserved family as on the
# core ones, the reserved number measures EASE and not generalization. This is the third
# use of the D19 baseline, whose framing already is "performance too high means artifact,
# not quality".
#
# `0.10` is DECLARED and has no precedent in the literature (docs/references.md): it is a
# tenth of the lift scale, and the smallest round margin that no rounding of a five-fold
# AUC reaches. It decides HOW THE NUMBER IS PUBLISHED — generalization, or an optimistic
# bound — and never a gate: it holds no share of the family alpha.
OOD_EASINESS_MARGIN = 0.10
OOD_EASINESS_ROLE = "acceptance-criterion"
OOD_EASINESS_SPENDS_ALPHA = False
OOD_VERDICT_GENERALIZATION = "measures-generalization"
OOD_VERDICT_EASINESS = "measures-easiness"
OOD_VERDICT_NO_HEADROOM = "no-headroom"

# Below this the detector is at chance on the family and the ratio has no denominator.
OOD_DETECTOR_SEPARATION_FLOOR = 0.51

# HOW MUCH LIFT THE CORE FAMILIES MUST LEAVE UNCLAIMED for the comparison to resolve
# anything, and the reason it is a separate rule: if the cheap floor already reaches
# the detector on the TRAINING families, every lift is pinned near 1 and the excess is
# small BY CONSTRUCTION — the reserved family then reads `measures-generalization` because
# the instrument has no resolution, which is fail-OPEN in the direction that publishes an
# OOD number as generalization. Measured on the pilot pools over the paired parents: a cheap
# floor of 0,9830 on the core families sits at a lift of 0,9861 against a detector of 0,9898,
# so the excess was 0,0070 and could not have been anything else. A margin of 0,10
# is unresolvable unless the core lift is at least 0,10 below the ceiling; the third
# verdict is ABSTENTION, and `assert_reserved_family_measures_generalization` refuses it
# exactly like easiness, because an abstention read as acceptance is the whole failure.
OOD_LIFT_HEADROOM = 0.10


class ReservedFamilyIsUnreadable(RuntimeError):
    """The easiness comparison cannot be formed from these AUCs."""


class ReservedFamilyMeasuresEasiness(RuntimeError):
    """The reserved family is easier for the dumb baseline than the training families."""


def baseline_lift(floor_auc: float, detector_auc: float) -> float:
    """The share of the detector's above-chance separation the cheap floor reaches.

    Refuses instead of returning a large number when the detector is at chance: with
    `detector_auc` at 0.5 the denominator vanishes, and a lift computed from it would make
    every family look maximally easy — fail-OPEN in the direction that publishes an OOD
    result as generalization.
    """
    if detector_auc < OOD_DETECTOR_SEPARATION_FLOOR:
        raise ReservedFamilyIsUnreadable(
            f"the detector's AUC is {detector_auc:.4f}, below the "
            f"{OOD_DETECTOR_SEPARATION_FLOOR} separation floor: there is no above-chance "
            "separation for the floor to reach a share of, so no easiness comparison "
            "exists on this family"
        )
    return (floor_auc - 0.5) / (detector_auc - 0.5)


def read_ood_easiness(
    reserved_floor: float,
    reserved_detector: float,
    core_floor: float,
    core_detector: float,
) -> dict:
    """The easiness reading of the reserved family, and the verdict its margin decides."""
    reserved_lift = baseline_lift(reserved_floor, reserved_detector)
    core_lift = baseline_lift(core_floor, core_detector)
    excess = reserved_lift - core_lift
    has_headroom = core_lift <= 1.0 - OOD_LIFT_HEADROOM
    return {
        "role": OOD_EASINESS_ROLE,
        "spendsAlpha": OOD_EASINESS_SPENDS_ALPHA,
        "margin": OOD_EASINESS_MARGIN,
        "headroom": OOD_LIFT_HEADROOM,
        "hasHeadroom": has_headroom,
        "reserved": {
            "cheapFloorAuc": reserved_floor,
            "detectorAuc": reserved_detector,
            "baselineLift": reserved_lift,
        },
        "core": {
            "cheapFloorAuc": core_floor,
            "detectorAuc": core_detector,
            "baselineLift": core_lift,
        },
        "excessLift": excess,
        "verdict": _easiness_verdict(excess, has_headroom),
    }


def _easiness_verdict(excess: float, has_headroom: bool) -> str:
    """Easiness first, then abstention, then acceptance.

    The order matters: a run with no headroom AND an excess above the margin has still
    measured easiness, and reporting that as an abstention would lose the finding.
    """
    if excess >= OOD_EASINESS_MARGIN:
        return OOD_VERDICT_EASINESS
    if not has_headroom:
        return OOD_VERDICT_NO_HEADROOM
    return OOD_VERDICT_GENERALIZATION


def assert_reserved_family_measures_generalization(report: dict) -> None:
    """Refuses when the reserved family's number is a measure of EASE, or unresolvable.

    The acceptance criterion of the reserved family, read off a number instead of argued:
    the result goes back as an optimistic bound rather than as an unseen-generator number.
    Abstention refuses exactly like easiness — the fail-open this closes is an
    unresolvable comparison read as an acceptance.
    """
    verdict = report["verdict"]
    if verdict == OOD_VERDICT_EASINESS:
        raise ReservedFamilyMeasuresEasiness(
            "the reserved family is easier for the cheap floor than the training "
            f"families by {report['excessLift']:.4f} of lift, against a margin of "
            f"{report['margin']}. Its number is an OPTIMISTIC BOUND on unseen-generator "
            "performance and may not be published as generalization"
        )
    if verdict == OOD_VERDICT_NO_HEADROOM:
        raise ReservedFamilyMeasuresEasiness(
            "the cheap floor claims "
            f"{report['core']['baselineLift']:.4f} of the detector's above-chance "
            f"separation on the CORE families, leaving less than {report['headroom']} of "
            "lift for the comparison to resolve: the excess of "
            f"{report['excessLift']:.4f} is small by construction and decides nothing. "
            "An unresolvable comparison is not an acceptance"
        )


def cheap_floor_auc(texts: list[str], labels: list[int]) -> float:
    """Mean out-of-fold AUC of the cheap floor over one class pair."""
    aucs = cross_validated_aucs(
        np.array(texts, dtype=object),
        np.array(labels),
        cheap_floor_pipeline,
        after_fit=assert_no_content_word_reaches_the_vocabulary,
    )
    return float(np.mean(aucs))


def detector_auc(scores: list[float], is_ai: list[bool]) -> float:
    """Rank AUC of an EXTERNAL score column, so the two sides are read the same way."""
    return probes.rank_auc(scores, is_ai)


def _family_of(row: dict) -> str:
    return assemble_corpus.generator_family(str((row.get("meta") or {}).get("family", "")))


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--ai", required=True, nargs="+", type=Path)
    parser.add_argument("--humans", required=True, nargs="+", type=Path)
    parser.add_argument(
        "--reserved-family",
        default=None,
        help="canonical generator family reserved to the unseen-generator test; turns on "
        "the easiness comparison of the reserved slice",
    )
    parser.add_argument(
        "--detector-scores",
        type=Path,
        default=None,
        help="scored rows from score_pilot_local.py, for the detector side of the "
        "easiness comparison",
    )
    parser.add_argument("--out", type=Path, default=None)
    args = parser.parse_args()

    assert_every_vectorization_declares_its_post_fit_guard()
    entity_masking.assert_theme_probes_decide_no_hypothesis()

    pool_rows = [row for path in args.ai for row in read_jsonl(path)]
    humans_by_id = {
        row["candidateId"]: row
        for path in args.humans
        for row in read_jsonl(path)
    }
    # Topic pairing is this design's ONLY topic control, so the AI side is filtered to the
    # rows that HAVE a parent here instead of taking the pools whole: an unpaired AI row is
    # compared against humans of other subjects, and the separation it contributes is partly
    # the subject. Dropping is right and silence is not — the count is printed.
    ai_rows = [
        row
        for row in pool_rows
        if (row.get("meta") or {}).get("pairedWith") in humans_by_id
    ]
    parents = sorted({row["meta"]["pairedWith"] for row in ai_rows})
    parent_rows = [humans_by_id[pid] for pid in parents]
    if not ai_rows:
        raise ReservedFamilyIsUnreadable(
            f"none of the {len(pool_rows)} pool row(s) names a `meta.pairedWith` present in "
            f"--humans, so no topic-paired dataset exists over these files"
        )

    texts = [row["text"] for row in ai_rows]
    labels = [1] * len(ai_rows)
    texts += [row["text"] for row in parent_rows]
    labels += [0] * len(parent_rows)
    X = np.array(texts, dtype=object)
    y = np.array(labels)
    print(
        f"dataset: {len(ai_rows)} ai + {len(parent_rows)} human (topic-paired; "
        f"{len(pool_rows) - len(ai_rows)} ai row(s) without a parent in --humans dropped)"
    )

    report: dict = {"folds": BASELINE_FOLDS, "seed": BASELINE_SEED, "aucs": {}}
    for label, factory in VECTORIZATIONS.items():
        aucs = cross_validated_aucs(
            X, y, factory, after_fit=POST_FIT_GUARDS[label]
        )
        for fold, auc in enumerate(aucs, start=1):
            print(f"  {label} fold {fold}: AUC={auc:.4f}")
        print(
            f"baseline TF-IDF+LogReg {label}: AUC medio={np.mean(aucs):.4f} "
            f"(desvio={np.std(aucs):.4f})"
        )
        report["aucs"][label] = {
            "mean": float(np.mean(aucs)),
            "std": float(np.std(aucs)),
            "perFold": [float(auc) for auc in aucs],
        }
    print(
        "piso a ser superado pelo detector real, e DETECTOR DE VAZAMENTO (D19): "
        "desempenho alto aqui significa artefato de fonte, nao qualidade"
    )

    if args.reserved_family is not None:
        report["oodEasiness"] = _easiness_block(
            ai_rows,
            parent_rows,
            args.reserved_family,
            args.detector_scores,
        )
        print(json.dumps(report["oodEasiness"], ensure_ascii=False, indent=1))

    if args.out is not None:
        args.out.write_text(
            json.dumps(report, ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8",
            newline="\n",
        )


def assert_every_human_row_is_a_paired_parent(
    ai_rows: list[dict], human_rows: list[dict]
) -> None:
    """Refuses when the human side carries a row that parents no AI row of this comparison."""
    parents = {
        str((row.get("meta") or {}).get("pairedWith", "")) for row in ai_rows
    }
    strangers = sorted(
        str(row["candidateId"])
        for row in human_rows
        if str(row["candidateId"]) not in parents
    )
    if strangers:
        raise ReservedFamilyIsUnreadable(
            f"{len(strangers)} of {len(human_rows)} human row(s) on the easiness comparison "
            f"parent no ai row, first ten {strangers[:10]}. Topic pairing is the only topic "
            "control this design has, and a cheap floor measured against humans of other "
            "subjects rises for a reason that is not the generator: the core lift rises with "
            "it and the verdict moves on a cause other than the declared one"
        )


def _easiness_block(
    ai_rows: list[dict],
    human_rows: list[dict],
    reserved_family: str,
    detector_scores: Path | None,
) -> dict:
    """The cheap floor on the reserved slice and on the core slice, side by side.

    The HUMAN side is the same rows in both comparisons on purpose: two floors measured
    against two different human populations differ for reasons that have nothing to do
    with the generator. And it must be the PAIRED PARENTS, which
    `assert_every_human_row_is_a_paired_parent` refuses without: this is the one instrument
    that decides how the OOD number is published, and a floor measured against humans of
    other subjects rises for a reason that is not the generator, which raises the core lift
    and flips the verdict to `no-headroom` on a cause other than the declared one.
    """
    reserved = [row for row in ai_rows if _family_of(row) == reserved_family]
    core = [row for row in ai_rows if _family_of(row) != reserved_family]
    assert_every_human_row_is_a_paired_parent(ai_rows, human_rows)
    human_texts = [str(row["text"]) for row in human_rows]
    if not reserved:
        raise ReservedFamilyIsUnreadable(
            f"no pool row carries the reserved family {reserved_family!r}; the families "
            f"present are {sorted({_family_of(row) for row in ai_rows})}"
        )

    block: dict = {
        "reservedFamily": reserved_family,
        "rows": {
            "reserved": len(reserved),
            "core": len(core),
            "human": len(human_texts),
        },
        "cheapFloorAuc": {
            "reserved": cheap_floor_auc(
                [str(row["text"]) for row in reserved] + human_texts,
                [1] * len(reserved) + [0] * len(human_texts),
            ),
            "core": cheap_floor_auc(
                [str(row["text"]) for row in core] + human_texts,
                [1] * len(core) + [0] * len(human_texts),
            ),
        },
    }
    if detector_scores is None:
        block["reading"] = (
            "sem lado do detector: passe --detector-scores para completar a comparação "
            "de facilidade"
        )
        return block

    scored = {str(row["id"]): float(row["score"]) for row in read_jsonl(detector_scores)}
    human_ids = [str(row["candidateId"]) for row in human_rows]

    def detector_side(rows: list[dict]) -> float:
        ids = [str(row["candidateId"]) for row in rows]
        pairs = [(scored[i], True) for i in ids if i in scored]
        pairs += [(scored[i], False) for i in human_ids if i in scored]
        if not pairs:
            raise ReservedFamilyIsUnreadable(
                "no scored row joins the pool rows: the detector side of the comparison "
                "would be computed over an empty population"
            )
        return detector_auc([value for value, _ in pairs], [flag for _, flag in pairs])

    block["detectorAuc"] = {
        "reserved": detector_side(reserved),
        "core": detector_side(core),
    }
    easiness = read_ood_easiness(
        block["cheapFloorAuc"]["reserved"],
        block["detectorAuc"]["reserved"],
        block["cheapFloorAuc"]["core"],
        block["detectorAuc"]["core"],
    )
    block.update(easiness)
    return block


if __name__ == "__main__":
    main()
