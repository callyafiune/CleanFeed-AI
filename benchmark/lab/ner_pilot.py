"""NER screening pilot: how many records a human would have to adjudicate.

This is a MEASUREMENT, not the PII triage itself. `benchmark/protocols/pii-review-v1.md`
splits the audit in two stages, and stage 1 (`common.py:pii_hits`) DROPS a candidate on a
hit instead of flagging it. So every surviving pool row is clean-as-far-as-five-regexes,
and the open question is the escape rate — the identifiers the regex has no pattern for,
which `common.py:70-76` names as "a full name in running prose, an address, a rare handle
shape". A NER screen is the only entry point a per-finding human adjudication can have;
the cost of that adjudication is the FLAG RATE times the cost per finding, and neither
number had been measured. This script measures the first and instruments the second.

WHAT IT MEASURES, and the conditional that makes the number meaningful: the pools were
already filtered by `pii_hits`, so a flag rate computed here is
`P(NER flags a person | the regex screen said clean)`. That is exactly the population a
stage-2 adjudication would receive. It is NOT the prevalence of PII in the raw dumps.

WINDOWING, not truncation. A BERT token classifier stops at 512 wordpieces and the pools
reach 5.000 words. Truncating would silently make the flag rate a property of each
record's first paragraph, so text is covered by overlapping windows cut on the tokenizer's
own offsets and findings are deduplicated by span. The overlap has to exceed the longest
entity we expect, or an identifier straddling a boundary is seen twice in halves and
counted as two.

NO ENTITY TEXT IN ANY ARTIFACT. A finding row carries the record id, the canonical
category and the span offsets — never the surface form and never the surrounding prose.
The `show` subcommand prints surface forms to the CONSOLE for a human to adjudicate; that
output is transient by design and is never written to `benchmark/out/`.

Deterministic: the sample is a keyed hash order over candidate ids, so the same seed draws
the same 500 records forever, and the draw is fixed BEFORE anyone looks at a text.

Needs `transformers` + `torch` (already pinned in the bench environment) for `screen`.
`tally` and every pure function are stdlib only.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import time
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

BENCHMARK_DIR = Path(__file__).resolve().parent.parent
DEFAULT_CANDIDATES_DIR = BENCHMARK_DIR / "data" / "candidates"
DEFAULT_OUTPUT_DIR = BENCHMARK_DIR / "out" / "rebuild-v3" / "ner-pilot"

# One pool per human source of the v3 corpus. Stratification is mandatory rather than
# cosmetic: PII density is a property of the genre (a product review names the buyer, an
# encyclopedia lede names public figures, a court document names the parties), so a
# proportional draw over the concatenated pools would report the mix of THESE pool sizes
# instead of a per-source rate that survives a change of quota.
DEFAULT_POOLS: tuple[str, ...] = (
    "ptso_fresh.jsonl",
    "wikipedia_fresh.jsonl",
    "b2w_fresh.jsonl",
    "carolina_fresh.jsonl",
)

SAMPLE_SEED = "ner-pilot-20260729"
PER_SOURCE = 125

# BERTimbau + HAREM "selective" (PESSOA/ORGANIZACAO/LOCAL/TEMPO/VALOR). Chosen as primary
# because HAREM is the genre-mixed Portuguese gold corpus (news, web, blogs, literature)
# rather than a single-domain one, and because the backbone is the project's own frozen
# backbone, so the pilot introduces no second pt-BR vocabulary into the bench.
PRIMARY_MODEL = "jordyvl/bert-base-portuguese-cased_harem-selective-sm-first-ner"
# Different training distribution (Wikipedia-derived silver data, multilingual mBERT), so
# disagreement between the two separates "the corpus has names" from "this model says so".
SECONDARY_MODEL = "Babelscape/wikineural-multilingual-ner"

# WORDPIECES, not words. The first version of this script windowed by word count on the
# assumption that 150 pt-BR words stay under the 512-token limit; a Carolina court document
# tokenised 150 words into 520 wordpieces and the run died with
# "The size of tensor a (520) must match the size of tensor b (512)". Legal prose is full
# of abbreviations, process numbers and dates, which shatter into many pieces each, so the
# words-per-token ratio is a property of the GENRE and cannot be assumed from a mean.
# Windows are therefore cut on the tokenizer's own offsets, with headroom for the drift
# that re-tokenising a substring introduces at its edges.
WINDOW_TOKENS = 400
# Must exceed the longest person name we expect to meet in wordpieces, or a name split by a
# boundary is seen in halves and counted twice.
WINDOW_OVERLAP_TOKENS = 40

# Inference-time subword resolution. "first" gives a word the label of its first wordpiece,
# which is how Portuguese NER is normally scored, and it is applied to both models so the
# comparison is not confounded by the aggregation.
AGGREGATION_STRATEGY = "first"

# The score floor the flag rate is reported at. Screening wants recall, so the default is
# permissive and `summary.json` carries the whole sweep — the cost of the audit is a
# function of this number and must not be hidden inside it.
DEFAULT_MIN_SCORE = 0.5
SCORE_SWEEP: tuple[float, ...] = (0.0, 0.5, 0.7, 0.9, 0.95)

PERSON_CATEGORY = "person"

# A person span has to contain a letter and at least two characters. Declared as a step
# rather than folded into the counts silently, because the models do emit spans like a bare
# "." on legal abbreviations, and a queue of those measures the tokenizer instead of the
# corpus. `summary.json` reports how many spans this dropped.
MIN_PERSON_CHARS = 2

# Every model in the candidate set spells its labels differently, and two of them use
# tag schemes with more than B/I. Mapping is FAIL-CLOSED (see `canonical_category`): an
# unmapped label must never fall through to "not a person", because that turns a model
# swap into a silently lower flag rate.
LABEL_TO_CATEGORY: dict[str, str] = {
    "PESSOA": PERSON_CATEGORY,
    "PER": PERSON_CATEGORY,
    "PERSON": PERSON_CATEGORY,
    "ORGANIZACAO": "organization",
    "ORG": "organization",
    "LOCAL": "place",
    "LOC": "place",
    "TEMPO": "time",
    "DATA": "time",
    "VALOR": "value",
    "PROFISSAO": "profession",
    "LEGISLACAO": "legislation",
    "JURISPRUDENCIA": "case-law",
    "MISC": "misc",
    "PUB": "misc",
}

BIO_PREFIXES = ("B-", "I-", "L-", "U-", "E-", "S-")


class UnknownEntityLabel(ValueError):
    """Raised when a model emits a label this script has no canonical category for."""


# --- deterministic sampling ---------------------------------------------------


def sample_key(seed: str, candidate_id: str) -> str:
    return hashlib.sha256(f"{seed}:{candidate_id}".encode("utf-8")).hexdigest()


def deterministic_sample(candidate_ids, size: int, seed: str) -> list[str]:
    """The `size` ids whose keyed digest sorts first: a reproducible SRS without replacement.

    Keyed on the id rather than on position, so the draw survives the pool being
    re-extracted with a different limit or in a different order.
    """
    ordered = sorted(candidate_ids, key=lambda cid: (sample_key(seed, cid), cid))
    return ordered[:size]


# --- windowing ----------------------------------------------------------------


def offset_windows(
    token_offsets,
    max_tokens: int = WINDOW_TOKENS,
    overlap_tokens: int = WINDOW_OVERLAP_TOKENS,
) -> list[tuple[int, int]]:
    """Char spans covering a token sequence in overlapping windows.

    Takes the tokenizer's own `(start, end)` offsets so the arithmetic is testable without
    loading a model, and returns spans into the ORIGINAL string — which is what lets a
    finding from any window be reported as a span of the record.
    """
    if overlap_tokens >= max_tokens:
        raise ValueError("overlap must be smaller than the window")
    offsets = [(int(s), int(e)) for s, e in token_offsets if int(e) > int(s)]
    if not offsets:
        return []
    step = max_tokens - overlap_tokens
    windows: list[tuple[int, int]] = []
    index = 0
    while index < len(offsets):
        chunk = offsets[index : index + max_tokens]
        windows.append((chunk[0][0], chunk[-1][1]))
        if index + max_tokens >= len(offsets):
            break
        index += step
    return windows


# --- entity normalization -----------------------------------------------------


def canonical_category(label: str) -> str:
    """Canonical category for a model label, refusing anything unmapped."""
    bare = label.strip()
    for prefix in BIO_PREFIXES:
        if bare.upper().startswith(prefix):
            bare = bare[len(prefix) :]
            break
    key = bare.upper()
    if key not in LABEL_TO_CATEGORY:
        raise UnknownEntityLabel(
            f"no canonical category for model label {label!r}; add it to LABEL_TO_CATEGORY"
        )
    return LABEL_TO_CATEGORY[key]


@dataclass(frozen=True)
class Entity:
    category: str
    start: int
    end: int
    score: float
    # Which distinct surface form inside this record the span is a mention of. A court
    # decision names the same judge fifteen times and a reviewer judges that name ONCE,
    # so counting mentions would inflate the cost estimate by an order of magnitude.
    mention_group: int = 0

    def as_json(self) -> dict[str, object]:
        # Deliberately no surface form and no context: the span plus the mention group is
        # enough to point a reviewer at the text and to count distinct names, and the
        # artifact stays free of personal data.
        return {
            "category": self.category,
            "start": self.start,
            "end": self.end,
            "chars": self.end - self.start,
            "score": round(self.score, 4),
            "mentionGroup": self.mention_group,
        }


SURFACE_STRIP_RE = re.compile(r"^[^\w]+|[^\w]+$", re.UNICODE)
SURFACE_SPACE_RE = re.compile(r"\s+")


def normalize_surface(surface: str) -> str:
    """Case- and whitespace-insensitive key for "the same name again".

    Deliberately EXACT after normalization: "Min. Cármen Lúcia" and "Cármen Lúcia" stay
    separate groups. That over-counts distinct names, so every cost figure built on it is
    an upper bound — the safe direction for a budget.
    """
    folded = SURFACE_SPACE_RE.sub(" ", surface).strip().casefold()
    return SURFACE_STRIP_RE.sub("", folded)


def is_plausible_person(surface: str) -> bool:
    stripped = normalize_surface(surface)
    return len(stripped) >= MIN_PERSON_CHARS and any(c.isalpha() for c in stripped)


def group_mentions(entities, text: str) -> list[Entity]:
    """Numbers each person span by the distinct normalized surface form it repeats."""
    groups: dict[str, int] = {}
    numbered: list[Entity] = []
    for entity in entities:
        if entity.category != PERSON_CATEGORY:
            numbered.append(entity)
            continue
        key = normalize_surface(text[entity.start : entity.end])
        index = groups.setdefault(key, len(groups) + 1)
        numbered.append(
            Entity(
                category=entity.category,
                start=entity.start,
                end=entity.end,
                score=entity.score,
                mention_group=index,
            )
        )
    return numbered


def dedupe_entities(entities) -> list[Entity]:
    """Collapses the duplicates that overlapping windows produce, keeping the best score.

    Same category and overlapping spans is ONE finding: the windows are deliberately
    overlapping, so an entity in the shared region is seen twice and a human would be
    asked to judge the same name twice.
    """
    best: list[Entity] = []
    for entity in sorted(entities, key=lambda e: (e.start, e.end, -e.score)):
        merged = False
        for index, kept in enumerate(best):
            if kept.category != entity.category:
                continue
            if entity.start < kept.end and kept.start < entity.end:
                best[index] = Entity(
                    category=kept.category,
                    start=min(kept.start, entity.start),
                    end=max(kept.end, entity.end),
                    score=max(kept.score, entity.score),
                )
                merged = True
                break
        if not merged:
            best.append(entity)
    return sorted(best, key=lambda e: (e.start, e.end, e.category))


# --- statistics ---------------------------------------------------------------


def wilson_interval(hits: int, total: int, z: float = 1.96) -> tuple[float, float]:
    """Wilson score interval for a proportion. Named because the method is the claim (R7)."""
    if total <= 0:
        return (0.0, 1.0)
    phat = hits / total
    denominator = 1 + z * z / total
    center = (phat + z * z / (2 * total)) / denominator
    half = (
        z
        * math.sqrt(phat * (1 - phat) / total + z * z / (4 * total * total))
        / denominator
    )
    return (max(0.0, center - half), min(1.0, center + half))


# --- pool reading -------------------------------------------------------------


@dataclass
class PoolRecord:
    candidate_id: str
    source_id: str
    pool: str
    word_count: int
    text: str


def read_pool(path: Path) -> dict[str, PoolRecord]:
    records: dict[str, PoolRecord] = {}
    with path.open(encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if not line:
                continue
            row = json.loads(line)
            records[row["candidateId"]] = PoolRecord(
                candidate_id=row["candidateId"],
                source_id=row["sourceId"],
                pool=path.stem,
                word_count=row["wordCount"],
                text=row["text"],
            )
    return records


def draw_sample(
    candidates_dir: Path, pools, per_source: int, seed: str
) -> list[PoolRecord]:
    drawn: list[PoolRecord] = []
    for pool in pools:
        path = candidates_dir / pool
        records = read_pool(path)
        if len(records) < per_source:
            raise ValueError(f"{pool} holds {len(records)} rows, fewer than {per_source}")
        for candidate_id in deterministic_sample(records, per_source, seed):
            drawn.append(records[candidate_id])
    return drawn


# --- screening ----------------------------------------------------------------


def build_pipeline(model_id: str):
    """Imported here so `tally` and the unit tests never pay for torch."""
    from transformers import pipeline

    return pipeline(
        "token-classification",
        model=model_id,
        aggregation_strategy=AGGREGATION_STRATEGY,
    )


def token_limit_of(recognizer) -> int:
    """Wordpieces a window may hold, minus the two special tokens the model adds."""
    declared = int(getattr(recognizer.tokenizer, "model_max_length", 512))
    # A tokenizer with no declared limit reports a sentinel in the billions.
    if declared > 4096:
        declared = 512
    return declared - 2


def fitted_windows(recognizer, text: str) -> list[tuple[int, str]]:
    """Overlapping windows of `text`, each verified to re-tokenise under the model limit.

    The verification is not paranoia: the windows are cut from the offsets of the WHOLE
    text, and the pipeline then re-tokenises each window as a standalone string, which can
    add pieces at the edges. A window still over the limit is halved rather than truncated,
    because truncating would drop text silently and turn the flag rate into a statement
    about the first part of long records.
    """
    limit = token_limit_of(recognizer)
    # transformers warns "Token indices sequence length is longer than the specified
    # maximum" here. Expected and harmless: this call only asks for offsets and never
    # reaches the model — the windows built FROM these offsets are what gets classified.
    encoded = recognizer.tokenizer(
        text, add_special_tokens=False, return_offsets_mapping=True
    )
    pending = offset_windows(encoded["offset_mapping"])
    fitted: list[tuple[int, str]] = []
    while pending:
        start, end = pending.pop(0)
        window = text[start:end]
        length = len(
            recognizer.tokenizer(window, add_special_tokens=False)["input_ids"]
        )
        if length <= limit or end - start <= 1:
            fitted.append((start, window))
            continue
        middle = start + (end - start) // 2
        pending.insert(0, (middle, end))
        pending.insert(0, (start, middle))
    return sorted(fitted)


def screen_record(recognizer, record: PoolRecord) -> tuple[list[Entity], int]:
    """Runs the model over every window and returns (findings, spans dropped as junk)."""
    windows = fitted_windows(recognizer, record.text)
    if not windows:
        return ([], 0)
    batches = recognizer([window for _, window in windows])
    if isinstance(batches, dict):
        batches = [batches]
    entities: list[Entity] = []
    implausible = 0
    for (offset, _), found in zip(windows, batches):
        for item in found:
            category = canonical_category(item["entity_group"])
            start = offset + int(item["start"])
            end = offset + int(item["end"])
            # The text slice, not the pipeline's `word`: the aggregation rebuilds a word
            # from wordpieces and the reviewer will read the ORIGINAL characters.
            if category == PERSON_CATEGORY and not is_plausible_person(
                record.text[start:end]
            ):
                implausible += 1
                continue
            entities.append(
                Entity(
                    category=category, start=start, end=end, score=float(item["score"])
                )
            )
    return (group_mentions(dedupe_entities(entities), record.text), implausible)


def person_mentions_at(finding_row: dict, min_score: float) -> int:
    """Every person SPAN above the floor — the number of highlights on the page."""
    return sum(
        1
        for entity in finding_row["entities"]
        if entity["category"] == PERSON_CATEGORY and entity["score"] >= min_score
    )


def persons_at(finding_row: dict, min_score: float) -> int:
    """Distinct person NAMES above the floor — the number of human judgements a record costs."""
    return len(
        {
            entity["mentionGroup"]
            for entity in finding_row["entities"]
            if entity["category"] == PERSON_CATEGORY and entity["score"] >= min_score
        }
    )


def summarize(findings, min_score: float) -> dict[str, object]:
    by_pool: dict[str, list[dict]] = {}
    for row in findings:
        by_pool.setdefault(row["pool"], []).append(row)

    per_source = []
    for pool, rows in sorted(by_pool.items()):
        counts = Counter(persons_at(row, min_score) for row in rows)
        flagged = sum(count for persons, count in counts.items() if persons >= 1)
        low, high = wilson_interval(flagged, len(rows))
        categories: Counter = Counter()
        for row in rows:
            for entity in row["entities"]:
                if entity["score"] >= min_score:
                    categories[entity["category"]] += 1
        distinct_names = sum(persons_at(row, min_score) for row in rows)
        per_source.append(
            {
                "pool": pool,
                "sourceId": rows[0]["sourceId"],
                "sampled": len(rows),
                "flagged": flagged,
                "flagRate": flagged / len(rows),
                "flagRateWilson95": [round(low, 4), round(high, 4)],
                "distinctPersonNames": distinct_names,
                "personMentions": sum(
                    person_mentions_at(row, min_score) for row in rows
                ),
                "distinctNamesPerFlaggedRecord": (
                    round(distinct_names / flagged, 3) if flagged else 0.0
                ),
                "distinctNamesPerRecord": {
                    str(persons): count for persons, count in sorted(counts.items())
                },
                "maxDistinctNamesInOneRecord": max(counts),
                "entityCategories": dict(sorted(categories.items())),
            }
        )

    total_counts = Counter(persons_at(row, min_score) for row in findings)
    total_flagged = sum(count for persons, count in total_counts.items() if persons >= 1)
    low, high = wilson_interval(total_flagged, len(findings))
    total_names = sum(persons_at(row, min_score) for row in findings)
    return {
        "minScore": min_score,
        "perSource": per_source,
        "overall": {
            "sampled": len(findings),
            "flagged": total_flagged,
            "flagRate": total_flagged / len(findings) if findings else 0.0,
            "flagRateWilson95": [round(low, 4), round(high, 4)],
            "distinctPersonNames": total_names,
            "personMentions": sum(
                person_mentions_at(row, min_score) for row in findings
            ),
            "distinctNamesPerFlaggedRecord": (
                round(total_names / total_flagged, 3) if total_flagged else 0.0
            ),
            "distinctNamesPerRecord": {
                str(persons): count for persons, count in sorted(total_counts.items())
            },
        },
    }


def score_sweep(findings) -> list[dict[str, object]]:
    sweep = []
    for min_score in SCORE_SWEEP:
        flagged = sum(1 for row in findings if persons_at(row, min_score) >= 1)
        sweep.append(
            {
                "minScore": min_score,
                "flagged": flagged,
                "flagRate": flagged / len(findings) if findings else 0.0,
                "distinctPersonNames": sum(
                    persons_at(row, min_score) for row in findings
                ),
                "personMentions": sum(
                    person_mentions_at(row, min_score) for row in findings
                ),
            }
        )
    return sweep


# --- adjudication cost --------------------------------------------------------

VERDICTS = ("private-person", "public-figure", "false-positive")


def adjudication_batch(findings, size: int, seed: str, min_score: float) -> list[str]:
    """Deterministic draw among the FLAGGED records, for the manual precision check."""
    flagged = [row["candidateId"] for row in findings if persons_at(row, min_score) >= 1]
    return deterministic_sample(flagged, size, f"{seed}:adjudication")


def tally_verdicts(verdicts: dict[str, str]) -> dict[str, object]:
    counts = Counter(verdicts.values())
    unknown = sorted(set(counts) - set(VERDICTS))
    if unknown:
        raise ValueError(f"unknown verdicts: {unknown}; expected one of {VERDICTS}")
    total = sum(counts.values())
    out: dict[str, object] = {"adjudicated": total, "counts": dict(counts)}
    for verdict in VERDICTS:
        hits = counts.get(verdict, 0)
        low, high = wilson_interval(hits, total)
        out[verdict] = {
            "count": hits,
            "share": hits / total if total else 0.0,
            "wilson95": [round(low, 4), round(high, 4)],
        }
    return out


def extrapolate(
    *,
    unit: str,
    flag_rate_low: float,
    flag_rate_high: float,
    corpus_records: int,
    seconds_low: float,
    seconds_high: float,
    units_per_flagged_record: float,
) -> dict[str, object]:
    """Hours of adjudication implied by a flag rate and a per-unit cost.

    Both inputs are intervals and BOTH are propagated: a point estimate would hide that
    the flag rate is a 500-record estimate and that the per-unit cost is a stated
    assumption rather than a measurement of a human reviewer.

    `unit` names what one human decision covers — a flagged record or a distinct name —
    because the same flag rate produces very different budgets under the two, and the
    difference is the repeat-mention factor, not a modelling choice.
    """
    low_records = flag_rate_low * corpus_records
    high_records = flag_rate_high * corpus_records
    return {
        "unit": unit,
        "corpusRecords": corpus_records,
        "flaggedRecords": [round(low_records, 1), round(high_records, 1)],
        "unitsPerFlaggedRecord": round(units_per_flagged_record, 3),
        "units": [
            round(low_records * units_per_flagged_record, 1),
            round(high_records * units_per_flagged_record, 1),
        ],
        "secondsPerUnit": [seconds_low, seconds_high],
        "hours": [
            round(low_records * units_per_flagged_record * seconds_low / 3600, 2),
            round(high_records * units_per_flagged_record * seconds_high / 3600, 2),
        ],
    }


# --- subcommands --------------------------------------------------------------


def cmd_screen(args: argparse.Namespace) -> int:
    output_dir = Path(args.outdir)
    output_dir.mkdir(parents=True, exist_ok=True)
    sample = draw_sample(
        Path(args.candidates_dir), args.pools, args.per_source, args.seed
    )
    manifest = {
        "seed": args.seed,
        "perSource": args.per_source,
        "pools": list(args.pools),
        "sampled": len(sample),
        "windowTokens": WINDOW_TOKENS,
        "windowOverlapTokens": WINDOW_OVERLAP_TOKENS,
        "aggregationStrategy": AGGREGATION_STRATEGY,
        "records": [
            {
                "candidateId": record.candidate_id,
                "sourceId": record.source_id,
                "pool": record.pool,
                "wordCount": record.word_count,
            }
            for record in sample
        ],
    }
    (output_dir / "sample.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    recognizer = build_pipeline(args.model)
    slug = args.model.split("/")[-1]
    started = time.monotonic()
    findings = []
    implausible_total = 0
    for index, record in enumerate(sample, start=1):
        entities, implausible = screen_record(recognizer, record)
        implausible_total += implausible
        findings.append(
            {
                "candidateId": record.candidate_id,
                "sourceId": record.source_id,
                "pool": record.pool,
                "wordCount": record.word_count,
                "entities": [entity.as_json() for entity in entities],
            }
        )
        if index % 50 == 0:
            elapsed = time.monotonic() - started
            print(f"  {index}/{len(sample)} records, {elapsed:.0f}s", flush=True)
    elapsed = time.monotonic() - started

    findings_path = output_dir / f"findings-{slug}.jsonl"
    with findings_path.open("w", encoding="utf-8", newline="\n") as handle:
        for row in findings:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")

    summary = {
        "model": args.model,
        "seed": args.seed,
        "sampleSize": len(sample),
        "wallClockSeconds": round(elapsed, 1),
        "secondsPerRecord": round(elapsed / len(sample), 3) if sample else None,
        "windowTokens": WINDOW_TOKENS,
        "windowOverlapTokens": WINDOW_OVERLAP_TOKENS,
        "aggregationStrategy": AGGREGATION_STRATEGY,
        "personSpansDroppedAsImplausible": implausible_total,
        "scoreSweep": score_sweep(findings),
        **summarize(findings, args.min_score),
    }
    (output_dir / f"summary-{slug}.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    batch = adjudication_batch(
        findings, args.adjudication_size, args.seed, args.min_score
    )
    (output_dir / f"adjudication-batch-{slug}.json").write_text(
        json.dumps(
            {
                "model": args.model,
                "seed": f"{args.seed}:adjudication",
                "minScore": args.min_score,
                "size": len(batch),
                "candidateIds": batch,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary["overall"], ensure_ascii=False, indent=2))
    print(f"wrote {findings_path}")
    return 0


def cmd_show(args: argparse.Namespace) -> int:
    """Prints the flagged spans of the adjudication batch to the CONSOLE.

    Transient on purpose: a reviewer needs the surface form and a little context to tell a
    private person from a cited author, and neither may be persisted.
    """
    output_dir = Path(args.outdir)
    batch = json.loads((output_dir / args.batch).read_text(encoding="utf-8"))
    findings = {
        row["candidateId"]: row
        for row in (
            json.loads(line)
            for line in (output_dir / args.findings)
            .read_text(encoding="utf-8")
            .splitlines()
            if line.strip()
        )
    }
    texts: dict[str, PoolRecord] = {}
    for pool in args.pools:
        texts.update(read_pool(Path(args.candidates_dir) / pool))
    for candidate_id in batch["candidateIds"]:
        row = findings[candidate_id]
        text = texts[candidate_id].text
        print(f"\n=== {candidate_id} [{row['pool']}] {row['wordCount']}w")
        # One line per DISTINCT name: the reviewer judges a name once, so showing every
        # repeated mention would measure reading speed instead of judgement.
        shown: set[int] = set()
        for entity in row["entities"]:
            if entity["category"] != PERSON_CATEGORY:
                continue
            if entity["score"] < batch["minScore"]:
                continue
            if entity["mentionGroup"] in shown:
                continue
            shown.add(entity["mentionGroup"])
            left = max(0, entity["start"] - args.context)
            right = min(len(text), entity["end"] + args.context)
            surface = text[entity["start"] : entity["end"]]
            context = text[left:right].replace("\n", " ")
            print(f"  g{entity['mentionGroup']} [{entity['score']:.2f}] {surface!r} .. {context}")
    return 0


def cmd_tally(args: argparse.Namespace) -> int:
    """Turns hand-written verdicts into an hours estimate.

    The verdicts file is authored by whoever adjudicated, and its shape is:

        {
          "verdicts": {"<candidateId>": "private-person" | "public-figure" | "false-positive"},
          "secondsPerUnitBasis": {
            "flagged-record": {"low": <s>, "high": <s>, "source": "<how this was obtained>"},
            "distinct-name":   {"low": <s>, "high": <s>, "source": "<how this was obtained>"}
          }
        }

    `source` is required to be prose because the seconds are the one input that is NOT a
    measurement of this corpus, and a number whose origin is not stated is a guess wearing
    a decimal point (R7).
    """
    output_dir = Path(args.outdir)
    verdict_file = json.loads((output_dir / args.verdicts).read_text(encoding="utf-8"))
    summary = json.loads((output_dir / args.summary).read_text(encoding="utf-8"))
    findings = [
        json.loads(line)
        for line in (output_dir / args.findings).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    min_score = summary["minScore"]
    flagged = [row for row in findings if persons_at(row, min_score) >= 1]
    names_per_flagged = (
        sum(persons_at(row, min_score) for row in flagged) / len(flagged)
        if flagged
        else 0.0
    )
    low, high = summary["overall"]["flagRateWilson95"]
    basis = verdict_file["secondsPerUnitBasis"]
    report = {
        "model": summary["model"],
        "minScore": min_score,
        "flagRate": summary["overall"]["flagRate"],
        "flagRateWilson95": [low, high],
        "verdicts": tally_verdicts(verdict_file["verdicts"]),
        # How the adjudicator reached each verdict. This is what makes the seconds
        # transferable: the mix of "obvious from the span" against "had to read the
        # surrounding prose" survives a change of reader, where one reader's clock does not.
        "difficulty": dict(Counter(verdict_file.get("difficulty", {}).values())),
        "secondsPerUnitBasis": basis,
        # Two units, both reported, because the amendment's table costs "NER findings"
        # while a reviewer actually opens a record. Neither is derivable from the other
        # without the repeat-mention factor, so neither is left implicit.
        "extrapolation": [
            extrapolate(
                unit=unit,
                flag_rate_low=low,
                flag_rate_high=high,
                corpus_records=args.corpus_records,
                seconds_low=basis[unit]["low"],
                seconds_high=basis[unit]["high"],
                units_per_flagged_record=(
                    1.0 if unit == "flagged-record" else names_per_flagged
                ),
            )
            for unit in ("flagged-record", "distinct-name")
        ],
    }
    (output_dir / "adjudication-cost.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--candidates-dir", default=str(DEFAULT_CANDIDATES_DIR))
    parser.add_argument("--outdir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--pools", nargs="+", default=list(DEFAULT_POOLS))
    parser.add_argument("--seed", default=SAMPLE_SEED)
    subparsers = parser.add_subparsers(dest="command", required=True)

    screen = subparsers.add_parser("screen", help="draw the sample and run the NER model")
    screen.add_argument("--model", default=PRIMARY_MODEL)
    screen.add_argument("--per-source", type=int, default=PER_SOURCE)
    screen.add_argument("--min-score", type=float, default=DEFAULT_MIN_SCORE)
    screen.add_argument("--adjudication-size", type=int, default=30)
    screen.set_defaults(func=cmd_screen)

    show = subparsers.add_parser("show", help="print the adjudication batch (console only)")
    show.add_argument("--batch", required=True)
    show.add_argument("--findings", required=True)
    show.add_argument("--context", type=int, default=90)
    show.set_defaults(func=cmd_show)

    tally = subparsers.add_parser("tally", help="turn verdicts into an hours estimate")
    tally.add_argument("--verdicts", required=True)
    tally.add_argument("--summary", required=True)
    tally.add_argument("--findings", required=True)
    tally.add_argument("--corpus-records", type=int, default=9000)
    tally.set_defaults(func=cmd_tally)

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
