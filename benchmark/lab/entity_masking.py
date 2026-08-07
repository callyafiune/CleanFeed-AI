"""Entity masking: does the verdict read TOPIC, or read STRUCTURE?

INFERENCE-TIME PERTURBATION, never retraining. The sealed policy fixes the training
recipe and forbids ablation; it says nothing about the INPUT, so the question "is the
score carried by the named entities of the text?" is answerable by replacing those
entities with a placeholder and re-scoring with the SAME weights.

THREE ARMS, and the third is what makes the first two readable:

  * `original`        — the text as stored;
  * `entity-masked`   — every named entity, date and numeral replaced by ONE placeholder;
  * `placebo-masked`  — the same NUMBER OF SPANS and the same multiset of RUN LENGTHS
                        replaced, drawn from lowercase common words instead.

Without the placebo arm a score movement cannot be attributed: `[MASK]` is a token the
classification head never met after fine-tuning, so inserting fifteen of them moves the
score whatever they replaced. The quantity that carries the reading is therefore the
EXCESS of the entity arm over the placebo arm, never the entity arm alone.

WHY A HEURISTIC AND NOT A TAGGER. `ner_pilot.py` is in the tree and already screens pt-BR
entities, but its `screen` path needs `transformers` + `torch` and downloads two HF
checkpoints; only `tally` and its pure functions are stdlib. The lab test interpreter has
no `transformers`, so a masking transform built on it would be unexercised by the suite
that runs on every change, and a diagnostic would acquire a model download. What the pilot
offers on top of a tagger — offset windowing, span dedup, fail-closed label mapping — all
presupposes the tagger. So the entity finder here is a mid-sentence-capitalisation plus
numeral plus date heuristic, stdlib only.

WHAT THE HEURISTIC GETS WRONG, and the direction it errs in. A sentence-initial capital is
indistinguishable from a proper noun by case alone, so a sentence-opening entity survives
unless the same surface form is also seen capitalised mid-sentence in the same document
(`proper_forms`, which recovers most of them). The residue is an UNDER-MASK: the arm leaves
entity identity in the text. Under-masking can only make a verdict look more like
`survives`, so a `collapses` verdict is the strong one here and a `survives` verdict is
bounded by the recall of this heuristic — which the report publishes as `maskedWordShare`
so nobody reads a `survives` off a text that was barely touched.

DIAGNOSTIC. `role="diagnostic"`, `decides=False`, `spendsAlpha=False`: this instrument
publishes a reading and gates nothing, and `assert_theme_probes_decide_no_hypothesis`
refuses if any of its names ever reaches the sealed primary family.

THE THREE ARMS MUST BE SCORED THROUGH THE SAME WINDOW. `score_pilot_local.py` truncates at
`--max-length`, and masking SHORTENS the text, so on a document past the limit the masked
arm's window covers more of it than the original's and the delta stops being "the same text
minus its entities". `--max-length 512` is therefore fixed in the runbook below and the
count of rows past it is registered with the run (docs/ESTADO.md § 5.8: 3 of the 60 human
rows of the 2026-08-07 sample, 0 of the 180 `ai` rows).

Usage — the three arms are WRITTEN here and SCORED by `score_pilot_local.py`, because the
scorer already owns the ONNX session and the tokenizer:

  py -3.13 entity_masking.py arms --rows <sample.jsonl> --out-dir <dir>
  python score_pilot_local.py --model-dir <artifact> --dataset <dir>/original.jsonl \
      --output <dir>/scores_original.jsonl --max-length 512   # and the other two arms
  py -3.13 entity_masking.py read --scores <dir>/scores_*.jsonl --rows <sample.jsonl> \
      --masking <dir>/masking.json --out <report.json>
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import statistics
import unicodedata
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Sequence

POLICY_PATH = Path(__file__).resolve().parent.parent / "preregistration-v4.json"

# The sealed vocabulary has `[MASK]` as a SINGLE wordpiece (id 103 in the frozen
# BERTimbau vocab), so one placeholder costs one token however long the span it replaced.
# Three different placeholders — one per category — would leak the category back into the
# input: a `[DATA]` token tells the model a date stood there.
PLACEHOLDER = "[MASK]"

ARM_ORIGINAL = "original"
ARM_ENTITY = "entity-masked"
ARM_PLACEBO = "placebo-masked"
ARMS: tuple[str, ...] = (ARM_ORIGINAL, ARM_ENTITY, ARM_PLACEBO)

# The role of this instrument in the release, and the three fields every consumer reads
# before the numbers.
MASKING_ROLE = "diagnostic"
MASKING_DECIDES = False
MASKING_SPENDS_ALPHA = False

# The names this instrument and its three siblings publish. None of them may be a member
# of the sealed primary family; `assert_theme_probes_decide_no_hypothesis` is the guard.
THEME_PROBE_NAMES: tuple[str, ...] = (
    "theme-entity-masking",
    "theme-topic-slice",
    "theme-blind-baseline",
    "theme-ood-easiness",
)

# --- the collapse criterion ------------------------------------------------
#
# Read on the EXCESS over the placebo arm, and on the `ai` class, because the hypothesis
# under test is "text whose entity combination is improbable is read as AI". A movement on
# the human class is the false-positive direction: reported beside, never decided on.
#
# `0.10` of score and `0.20` of verdicts are DECLARED numbers with no precedent in the
# literature (docs/references.md). The floor they have to clear is measured: the export
# parity report that anchors the int8 ceiling accepts `maxAbsDelta` 0,008950 and ZERO
# verdict flips over 120 samples, so a mean excess drop of 0,10 is eleven times the largest
# delta the parity gate tolerates and cannot be quantization. The upper bound on a useful
# threshold is the score range itself; a tenth of it, and a fifth of the verdicts, is the
# smallest round pair that no measurement noise in this pipeline reaches.
MASKING_NOISE_CEILING = 0.008950138668296859
MASKING_COLLAPSE_EXCESS_MEAN_DROP = 0.10
MASKING_COLLAPSE_EXCESS_FLIP_RATE = 0.20

VERDICT_COLLAPSES = "collapses"
VERDICT_SURVIVES = "survives"

# The argmax of a two-logit head, and NOT the sealed provisional cut: the frozen
# `provisional-v1` threshold is a 0,95 quantile of human negatives over `dev` + `cal-A`,
# a value no artifact in this repository carries. A diagnostic that invented one would be
# publishing a cut nobody pre-registered.
DEFAULT_DECISION_THRESHOLD = 0.5


class ScoreArmsDisagree(RuntimeError):
    """The three arms do not cover the same record ids."""


class MaskingRecordsUnaccounted(RuntimeError):
    """A scored record has no masking record, so its share and shortfall are unknown."""


class ThemeProbeReachedTheFamily(RuntimeError):
    """A theme probe is a member of the sealed primary family, or `m` is not 4."""


# --- the entity finder -----------------------------------------------------

_WORD = re.compile(r"[^\W_]+", re.UNICODE)
# A capitalised token: first character uppercase. `\w` includes digits, so the digit case
# is excluded here and handled by the numeral pass.
_CAPITALISED = re.compile(r"^[^\W\d_][^\W_]*$", re.UNICODE)

# Lowercase words that JOIN two capitalised words inside one pt-BR proper name
# ("Universidade de São Paulo", "Machado de Assis"). Without them a single name is found as
# two entities and the placebo arm is asked for the wrong run lengths.
_NAME_JOINERS: frozenset[str] = frozenset(
    "de da do das dos e del della van von der di du la le dei"
    .split()
)

_MONTHS: tuple[str, ...] = (
    "janeiro",
    "fevereiro",
    "março",
    "abril",
    "maio",
    "junho",
    "julho",
    "agosto",
    "setembro",
    "outubro",
    "novembro",
    "dezembro",
)

# Dates run FIRST and are matched as whole phrases, because "12 de março de 1998" is three
# numerals and a month name to any later pass and would be masked as three spans.
_DATE_PATTERNS: tuple[re.Pattern[str], ...] = (
    re.compile(r"\b\d{1,2}\s*[/-]\s*\d{1,2}\s*[/-]\s*\d{2,4}\b"),
    re.compile(
        r"\b\d{1,2}\s+de\s+(?:" + "|".join(_MONTHS) + r")(?:\s+de\s+\d{3,4})?\b",
        re.IGNORECASE,
    ),
    re.compile(
        r"\b(?:" + "|".join(_MONTHS) + r")\s+de\s+\d{3,4}\b",
        re.IGNORECASE,
    ),
    # A four-digit year in running pt-BR prose: 1000-2099. A bare `\d{4}` would also take
    # populations and page counts, which the numeral pass takes anyway — the point of
    # naming the year shape is that it is a DATE for the report's category counts.
    re.compile(r"\b(?:1\d{3}|20\d{2})\b"),
)

# Anything left with a digit in it: populations, areas, percentages, ordinals, codes.
_NUMERAL = re.compile(r"\b\d[\d.,:]*\s*(?:%|km²|km|m²|ha)?", re.IGNORECASE)

# An acronym is masked wherever it stands, sentence-initial included: two or more
# consecutive uppercase letters is not a sentence-opening capital.
_ACRONYM = re.compile(r"\b[A-ZÁÉÍÓÚÂÊÔÃÕÀÜÇ]{2,}\b")


@dataclass(frozen=True)
class Span:
    start: int
    end: int
    category: str
    words: int


@dataclass
class Masked:
    """One arm's text, plus what was taken out of it."""

    text: str
    spans: tuple[Span, ...] = ()
    words_before: int = 0
    words_masked: int = 0
    shortfall: int = 0
    categories: dict[str, int] = field(default_factory=dict)

    @property
    def masked_word_share(self) -> float:
        if self.words_before == 0:
            return 0.0
        return self.words_masked / self.words_before

    def as_report(self) -> dict:
        return {
            "spans": len(self.spans),
            "wordsBefore": self.words_before,
            "wordsMasked": self.words_masked,
            "maskedWordShare": self.masked_word_share,
            "shortfall": self.shortfall,
            "categories": dict(sorted(self.categories.items())),
        }


def _fold(text: str) -> str:
    return unicodedata.normalize("NFC", text)


_OPENERS = r"[\s\"'“”«»(\[]*"


def _sentence_initial_offsets(text: str) -> set[int]:
    """Character offsets that open a sentence: start of text, or after `.!?:;` / newline.

    The opening quote or bracket is skipped, so the capital in `("Rio de Janeiro")` at the
    head of a sentence is still recognised as sentence-initial.
    """
    offsets = {len(re.match(_OPENERS, text).group(0))} if text else {0}
    for match in re.finditer(r"(?:[.!?:;•]|\n)+" + _OPENERS, text):
        offsets.add(match.end())
    return offsets


def proper_forms(text: str) -> set[str]:
    """Surface forms seen capitalised MID-SENTENCE, casefolded.

    A document that writes "Brasil" inside a sentence has evidenced the form as a proper
    noun, which is what lets the sentence-initial occurrence of the same form be masked
    too. Without this, every entity that happens to open a sentence stays in the text.
    """
    openers = _sentence_initial_offsets(text)
    forms: set[str] = set()
    for match in _WORD.finditer(text):
        if match.start() in openers:
            continue
        token = match.group(0)
        if _CAPITALISED.match(token) and token[:1].isupper():
            forms.add(token.casefold())
    return forms


def _capitalised_runs(text: str) -> list[tuple[int, int, int]]:
    """`(start, end, words)` of capitalised runs, joiners included, openers recovered."""
    openers = _sentence_initial_offsets(text)
    evidenced = proper_forms(text)
    tokens = [(m.start(), m.end(), m.group(0)) for m in _WORD.finditer(text)]

    def is_entity_token(index: int) -> bool:
        start, _, token = tokens[index]
        if not _CAPITALISED.match(token) or not token[:1].isupper():
            return False
        if start not in openers:
            return True
        return token.casefold() in evidenced

    def adjacent(left: int, right: int) -> bool:
        """Only whitespace stands between two tokens.

        Punctuation must break a run, or `Sistema Agroflorestal (SAF)` becomes one span
        that eats the opening parenthesis and leaves the closing one behind — the masked
        arm would then differ from the original in punctuation as well as in entities.
        """
        return text[tokens[left][1] : tokens[right][0]].strip() == ""

    runs: list[tuple[int, int, int]] = []
    index = 0
    while index < len(tokens):
        if not is_entity_token(index):
            index += 1
            continue
        run_start = tokens[index][0]
        run_end = tokens[index][1]
        words = 1
        cursor = index + 1
        while cursor < len(tokens):
            if is_entity_token(cursor) and adjacent(cursor - 1, cursor):
                run_end = tokens[cursor][1]
                words += 1
                cursor += 1
                continue
            # A joiner extends the run only when another capitalised token follows it.
            if (
                tokens[cursor][2].casefold() in _NAME_JOINERS
                and cursor + 1 < len(tokens)
                and is_entity_token(cursor + 1)
                and adjacent(cursor - 1, cursor)
                and adjacent(cursor, cursor + 1)
            ):
                run_end = tokens[cursor + 1][1]
                words += 2
                cursor += 2
                continue
            break
        runs.append((run_start, run_end, words))
        index = cursor
    return runs


def _word_count(text: str) -> int:
    return len(_WORD.findall(text))


def _non_overlapping(spans: Iterable[Span]) -> list[Span]:
    """Earliest-start, longest-first; a span that overlaps an accepted one is dropped."""
    ordered = sorted(spans, key=lambda span: (span.start, -(span.end - span.start)))
    accepted: list[Span] = []
    for span in ordered:
        if accepted and span.start < accepted[-1].end:
            continue
        accepted.append(span)
    return accepted


def _replace(text: str, spans: Sequence[Span]) -> str:
    pieces: list[str] = []
    cursor = 0
    for span in spans:
        pieces.append(text[cursor : span.start])
        pieces.append(PLACEHOLDER)
        cursor = span.end
    pieces.append(text[cursor:])
    return "".join(pieces)


def mask_entities(text: str) -> Masked:
    """Named entities, dates and numerals replaced by one `PLACEHOLDER` each."""
    folded = _fold(text)
    candidates: list[Span] = []
    for pattern in _DATE_PATTERNS:
        for match in pattern.finditer(folded):
            candidates.append(
                Span(match.start(), match.end(), "date", _word_count(match.group(0)))
            )
    for start, end, words in _capitalised_runs(folded):
        candidates.append(Span(start, end, "entity", words))
    for match in _ACRONYM.finditer(folded):
        candidates.append(
            Span(match.start(), match.end(), "entity", _word_count(match.group(0)))
        )
    for match in _NUMERAL.finditer(folded):
        # A terminal `.`/`,`/`:` belongs to the sentence and not to the number: taking it
        # would delete the sentence boundary, and the masked arm would then differ from the
        # original in punctuation as well as in entities.
        surface = match.group(0).rstrip().rstrip(".,:")
        if not surface:
            continue
        candidates.append(
            Span(
                match.start(),
                match.start() + len(surface),
                "number",
                _word_count(surface),
            )
        )
    spans = _non_overlapping(candidates)
    categories: dict[str, int] = {}
    for span in spans:
        categories[span.category] = categories.get(span.category, 0) + 1
    return Masked(
        text=_replace(folded, spans),
        spans=tuple(spans),
        words_before=_word_count(folded),
        words_masked=sum(span.words for span in spans),
        categories=categories,
    )


def mask_placebo(
    text: str,
    run_lengths: Sequence[int],
    entity_spans: Sequence[Span] | None = None,
) -> Masked:
    """The same span count and the same run lengths, taken from lowercase common words.

    The control arm. Eligible positions are runs of consecutive lowercase alphabetic
    tokens that no entity span covers, and the requested lengths are served
    longest-first from evenly spaced positions, so a text with few eligible runs spends
    them on the long requests instead of exhausting them on the short ones. What could
    not be served is `shortfall`, published rather than silently absorbed: a placebo that
    removed less than the entity arm makes the excess look larger than it is.
    """
    folded = _fold(text)
    spans_to_avoid = (
        mask_entities(folded).spans if entity_spans is None else tuple(entity_spans)
    )
    tokens = [(m.start(), m.end(), m.group(0)) for m in _WORD.finditer(folded)]

    def covered(index: int) -> bool:
        start, end, _ = tokens[index]
        return any(span.start < end and start < span.end for span in spans_to_avoid)

    eligible = [
        index
        for index in range(len(tokens))
        if not covered(index) and tokens[index][2].isalpha() and tokens[index][2].islower()
    ]
    eligible_set = set(eligible)

    def adjacent(left: int, right: int) -> bool:
        return folded[tokens[left][1] : tokens[right][0]].strip() == ""

    taken: set[int] = set()
    chosen: list[Span] = []
    shortfall = 0
    for length in sorted(run_lengths, reverse=True):
        starts = [
            index
            for index in eligible
            if index not in taken
            and all(
                (index + offset) in eligible_set and (index + offset) not in taken
                for offset in range(length)
            )
            and all(
                adjacent(index + offset, index + offset + 1)
                for offset in range(length - 1)
            )
        ]
        if not starts:
            shortfall += length
            continue
        # Evenly spaced rather than leftmost: a placebo packed into the first sentence
        # measures the opening of the document instead of the document.
        start_index = starts[len(starts) // 2]
        chosen.append(
            Span(
                tokens[start_index][0],
                tokens[start_index + length - 1][1],
                "placebo",
                length,
            )
        )
        taken.update(range(start_index, start_index + length))

    spans = _non_overlapping(chosen)
    return Masked(
        text=_replace(folded, spans),
        spans=tuple(spans),
        words_before=_word_count(folded),
        words_masked=sum(span.words for span in spans),
        shortfall=shortfall,
        categories={"placebo": len(spans)},
    )


def arm_rows(rows: Iterable[dict]) -> dict[str, list[dict]]:
    """The three arms of every row, in the `{id, text, label, family}` shape the scorer reads.

    The id is CARRIED UNCHANGED across the arms: the reading is per-record paired, so an
    arm that renamed its rows could not be joined back.
    """
    arms: dict[str, list[dict]] = {arm: [] for arm in ARMS}
    masking: dict[str, dict] = {}
    for row in rows:
        row_id = str(row["id"])
        text = str(row["text"])
        label = int(row["label"])
        family = str(row.get("family", "?"))
        entity = mask_entities(text)
        placebo = mask_placebo(
            text,
            [span.words for span in entity.spans],
            entity_spans=entity.spans,
        )
        masking[row_id] = {
            "entity": entity.as_report(),
            "placebo": placebo.as_report(),
        }
        for arm, arm_text in (
            (ARM_ORIGINAL, text),
            (ARM_ENTITY, entity.text),
            (ARM_PLACEBO, placebo.text),
        ):
            arms[arm].append(
                {"id": row_id, "text": arm_text, "label": label, "family": family}
            )
    arms["_masking"] = masking  # type: ignore[assignment]
    return arms


# --- the reading -----------------------------------------------------------


def _mean(values: Sequence[float]) -> float | None:
    return statistics.fmean(values) if values else None


def _excess(entity: float | None, placebo: float | None) -> float | None:
    if entity is None or placebo is None:
        return None
    return entity - placebo


def read_masking(
    scores: dict[str, dict[str, float]],
    labels: dict[str, str],
    masking: dict[str, dict],
    threshold: float = DEFAULT_DECISION_THRESHOLD,
) -> dict:
    """The diagnostic report, and the verdict its frozen criterion reads off it.

    `scores` is `{arm: {record id: p(ai)}}`. Every arm must cover the same ids: a joined
    reading over three arms with different populations is a comparison of three different
    corpora, so the mismatch RAISES instead of intersecting.

    `masking` is REQUIRED and every read record must appear in it. The masked-word share and
    the placebo shortfall are the two numbers that say whether the verdict is readable at
    all, and both live in that map: optional, they were absent by default on the very run
    that got published.
    """
    missing = [arm for arm in ARMS if arm not in scores]
    if missing:
        raise ScoreArmsDisagree(f"arms absent from the score set: {sorted(missing)}")
    populations = {arm: set(scores[arm]) for arm in ARMS}
    if len({frozenset(population) for population in populations.values()}) != 1:
        sizes = {arm: len(population) for arm, population in populations.items()}
        raise ScoreArmsDisagree(
            "the three arms do not cover the same record ids — "
            f"sizes {sizes}; a joined reading over different populations compares "
            "three corpora and not three arms"
        )

    ids = sorted(populations[ARM_ORIGINAL])
    per_class: dict[str, dict] = {}
    for wanted in ("ai", "human"):
        rows = [row_id for row_id in ids if labels.get(row_id) == wanted]
        if not rows:
            per_class[wanted] = {"records": 0}
            continue
        original = [scores[ARM_ORIGINAL][row_id] for row_id in rows]
        entity = [scores[ARM_ENTITY][row_id] for row_id in rows]
        placebo = [scores[ARM_PLACEBO][row_id] for row_id in rows]
        # A DROP is `original - arm`, so a positive number always means "the arm moved the
        # score away from AI", whichever class the row belongs to.
        entity_drop = _mean([o - a for o, a in zip(original, entity)])
        placebo_drop = _mean([o - a for o, a in zip(original, placebo)])
        decided = [value >= threshold for value in original]
        entity_flips = _mean(
            [
                1.0 if (a >= threshold) != was else 0.0
                for a, was in zip(entity, decided)
            ]
        )
        placebo_flips = _mean(
            [
                1.0 if (a >= threshold) != was else 0.0
                for a, was in zip(placebo, decided)
            ]
        )
        unaccounted = [row_id for row_id in rows if row_id not in masking]
        if unaccounted:
            raise MaskingRecordsUnaccounted(
                f"{len(unaccounted)} scored record(s) of class {wanted!r} are absent from "
                f"the masking map, first ten {sorted(unaccounted)[:10]}. The masked-word "
                "share and the placebo shortfall are what make the verdict readable, and a "
                "class whose records have neither would publish a verdict with no bounds"
            )
        # How much text the entity arm actually removed. A `survives` verdict read off a
        # class whose texts were barely touched says nothing about the entity signal, so
        # the share travels WITH the verdict instead of living in a separate artifact.
        shares = [
            float(masking[row_id]["entity"]["maskedWordShare"]) for row_id in rows
        ]
        # Words the placebo arm could NOT match, because the text ran out of eligible runs
        # of common lowercase words. A shortfall means the placebo removed less than the
        # entity arm, so its drop is understated and the EXCESS is overstated — the bias
        # points at `collapses`, which for this instrument is the alarm and not the
        # dismissal. Published per class, because the verdict cannot be read without it.
        shortfalls = [int(masking[row_id]["placebo"]["shortfall"]) for row_id in rows]
        per_class[wanted] = {
            "records": len(rows),
            "meanMaskedWordShare": _mean(shares),
            "placeboShortfallWords": sum(shortfalls),
            "placeboShortfallRecords": sum(1 for value in shortfalls if value > 0),
            "maxPlaceboShortfallWords": max(shortfalls, default=0),
            "meanOriginal": _mean(original),
            "meanEntityMasked": _mean(entity),
            "meanPlaceboMasked": _mean(placebo),
            "meanEntityDrop": entity_drop,
            "meanPlaceboDrop": placebo_drop,
            "excessMeanDrop": _excess(entity_drop, placebo_drop),
            "entityFlipRate": entity_flips,
            "placeboFlipRate": placebo_flips,
            "excessFlipRate": _excess(entity_flips, placebo_flips),
        }

    return {
        "role": MASKING_ROLE,
        "decides": MASKING_DECIDES,
        "spendsAlpha": MASKING_SPENDS_ALPHA,
        "criterion": {
            "readsClass": "ai",
            "excessMeanDrop": MASKING_COLLAPSE_EXCESS_MEAN_DROP,
            "excessFlipRate": MASKING_COLLAPSE_EXCESS_FLIP_RATE,
            "noiseCeiling": MASKING_NOISE_CEILING,
            "decisionThreshold": threshold,
        },
        "records": len(ids),
        "perClass": per_class,
        "verdict": masking_verdict(per_class),
    }


def masking_verdict(per_class: dict[str, dict]) -> str:
    """`collapses` when the EXCESS over the placebo clears either frozen number.

    Reads the `ai` class only. A record set with no `ai` row cannot answer the question
    and reads `survives`, which is the conservative direction for this instrument: it
    leaves the shortcut hypothesis un-dismissed.
    """
    measures = per_class.get("ai") or {}
    drop = measures.get("excessMeanDrop")
    flips = measures.get("excessFlipRate")
    if drop is not None and drop >= MASKING_COLLAPSE_EXCESS_MEAN_DROP:
        return VERDICT_COLLAPSES
    if flips is not None and flips >= MASKING_COLLAPSE_EXCESS_FLIP_RATE:
        return VERDICT_COLLAPSES
    return VERDICT_SURVIVES


def assert_theme_probes_decide_no_hypothesis(policy_path: Path = POLICY_PATH) -> None:
    """Refuses when a theme probe is a member of the sealed family, or when `m` moved.

    Read out of `preregistration-v4.json` and not out of a constant here: the inventory
    of gates is derived from `multiplicity.primaryFamily`, so a probe promoted to a
    hypothesis would divide the family alpha by five and quietly loosen every ceiling.
    Both directions are checked — membership AND the count — because a swap that removed
    a real hypothesis to make room for a probe keeps the count at four.
    """
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    family = list(policy["multiplicity"]["primaryFamily"])
    declared_size = int(policy["multiplicity"]["primaryFamilySize"])
    promoted = sorted(set(family) & set(THEME_PROBE_NAMES))
    if promoted:
        raise ThemeProbeReachedTheFamily(
            f"a theme probe is a member of the sealed primary family: {promoted}. "
            "The four instruments are diagnostics: they publish a reading, spend no "
            "alpha and decide no gate"
        )
    if len(family) != declared_size or declared_size != 4:
        raise ThemeProbeReachedTheFamily(
            f"the mandatory gate inventory is not four members — {family} against a "
            f"declared size of {declared_size}. The per-hypothesis alpha every published "
            "ceiling reads is the family alpha divided by this number"
        )


# --- CLI -------------------------------------------------------------------


def _read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def _write_jsonl(path: Path, rows: Sequence[dict]) -> None:
    with path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


SAMPLE_SEED = "theme-entity-masking-20260807"


def _draw(rows: Sequence[dict], limit: int) -> list[dict]:
    """A keyed-hash order over ids, so the same seed draws the same rows forever."""
    keyed = sorted(
        rows,
        key=lambda row: hashlib.sha256(
            (SAMPLE_SEED + "|" + str(row["id"])).encode("utf-8")
        ).hexdigest(),
    )
    return keyed[:limit]


def sample_from_pools(
    pools: Sequence[Path], label: int, per_pool: int
) -> list[dict]:
    """`{id, text, label, family}` rows drawn per POOL FILE, not per concatenation.

    Per file rather than proportional, because a proportional draw over concatenated
    pools reports the mix of THESE pool sizes instead of a rate that survives a change
    of quota.
    """
    drawn: list[dict] = []
    for path in pools:
        rows = [
            {
                "id": str(row["candidateId"]),
                "text": str(row["text"]),
                "label": label,
                "family": str(row.get("meta", {}).get("family", row.get("domainSource", "?"))),
                "poolFile": path.name,
            }
            for row in _read_jsonl(path)
        ]
        drawn.extend(_draw(rows, per_pool))
    return drawn


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sample = sub.add_parser("sample", help="draw a deterministic row sample from pools")
    sample.add_argument("--humans", nargs="+", type=Path, default=[])
    sample.add_argument("--ai", nargs="+", type=Path, default=[])
    sample.add_argument("--per-pool", type=int, default=60)
    sample.add_argument("--out", required=True, type=Path)

    arms = sub.add_parser("arms", help="write the three arms of a row sample")
    arms.add_argument("--rows", required=True, type=Path)
    arms.add_argument("--out-dir", required=True, type=Path)

    read = sub.add_parser("read", help="join the scored arms and publish the reading")
    read.add_argument("--scores", required=True, nargs="+", type=Path)
    read.add_argument("--rows", required=True, type=Path)
    read.add_argument("--out", required=True, type=Path)
    read.add_argument("--threshold", type=float, default=DEFAULT_DECISION_THRESHOLD)
    read.add_argument("--masking", required=True, type=Path)

    args = parser.parse_args(argv)
    assert_theme_probes_decide_no_hypothesis()

    if args.command == "sample":
        rows = sample_from_pools(args.humans, 0, args.per_pool)
        rows += sample_from_pools(args.ai, 1, args.per_pool)
        _write_jsonl(args.out, rows)
        humans = sum(1 for row in rows if row["label"] == 0)
        print(f"{len(rows)} linhas ({humans} humanas, {len(rows) - humans} ai) -> {args.out}")
        return 0

    if args.command == "arms":
        rows = _read_jsonl(args.rows)
        built = arm_rows(rows)
        args.out_dir.mkdir(parents=True, exist_ok=True)
        for arm in ARMS:
            _write_jsonl(args.out_dir / f"{arm}.jsonl", built[arm])
        (args.out_dir / "masking.json").write_text(
            json.dumps(built["_masking"], ensure_ascii=False, indent=1) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        shares = [
            entry["entity"]["maskedWordShare"] for entry in built["_masking"].values()
        ]
        print(f"{len(rows)} linhas x {len(ARMS)} braços -> {args.out_dir}")
        print(f"fração de palavras mascaradas (média): {statistics.fmean(shares):.4f}")
        return 0

    scores: dict[str, dict[str, float]] = {}
    for path in args.scores:
        for row in _read_jsonl(path):
            arm = str(row["arm"]) if "arm" in row else _arm_of_path(path)
            scores.setdefault(arm, {})[str(row["id"])] = float(row["score"])
    labels = {
        str(row["id"]): ("ai" if int(row["label"]) == 1 else "human")
        for row in _read_jsonl(args.rows)
    }
    masking = json.loads(args.masking.read_text(encoding="utf-8"))
    report = read_masking(scores, labels, masking, threshold=args.threshold)
    args.out.write_text(
        json.dumps(report, ensure_ascii=False, indent=1) + "\n",
        encoding="utf-8",
        newline="\n",
    )
    print(json.dumps(report["perClass"], ensure_ascii=False, indent=1))
    print(f"veredito: {report['verdict']} (DIAGNÓSTICO, não decide gate)")
    return 0


def _arm_of_path(path: Path) -> str:
    for arm in ARMS:
        if arm in path.stem:
            return arm
    raise ScoreArmsDisagree(
        f"the arm of {path.name} cannot be read from its name; expected one of "
        f"{list(ARMS)} in the stem, or an `arm` field on every row"
    )


if __name__ == "__main__":
    raise SystemExit(main())
