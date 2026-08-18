"""Shared lab-bench helpers for the corpus candidate extractors.

Lab bench ONLY (see docs/corpus-sources.md and the ML tooling decision): this
package produces CANDIDATE human texts for later review/ingestion. It never
touches the sealed TypeScript pipeline, never fabricates provenance, and never
emits author information — candidates carry only text, license, dates, typology
and deterministic bookkeeping.

Zero-PII policy is enforced by DROPPING any candidate whose text matches a PII
pattern (e-mail, BR phone, CPF/CNPJ, @handle). Dropping — never rewriting — so
no candidate text is ever silently mutated.

Python stdlib only. Deterministic: no randomness, no wall-clock in outputs.
"""

from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path

# Texts must predate the ChatGPT launch to sustain the `human` label.
CHATGPT_CUTOFF = datetime(2022, 11, 30, tzinfo=timezone.utc)

MINIMUM_WORDS = 50
MAXIMUM_WORDS = 5_000

# --- normalization ----------------------------------------------------------


def normalize_text(text: str) -> str:
    """NFC + LF + espaco colapsado + trim. NAO e a regra SELADA, e a diferenca decide corpus.

    `benchmark/corpus-import.ts::normalizeCorpusText` faz DUAS coisas — CRLF/CR para LF e NFC —
    e e ela que o caminho selado aplica antes de hashear e guardar. Esta faz mais TRES: colapsa
    `[ 	]+` dentro da linha, apara cada linha, e colapsa `
{3,}`. Logo ela REESCREVE
    espacamento que a regra selada preserva, e um pool escrito com esta regra nao e
    byte-identico ao que a ingestao produziria do mesmo texto.

    Medido em 2026-08-18, e e por isso que a frase antiga saiu: ela dizia espelhar a semantica
    de `corpus-import.ts`, e nao espelha. Quem for normalizar um escritor novo tem de escolher
    a regra de proposito — a selada preserva o espacamento que o gate antiartefato acusa, esta
    o apaga — em vez de herdar esta por ela estar a mao.
    """
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    text = unicodedata.normalize("NFC", text)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    text = "\n".join(lines)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def word_count(text: str) -> int:
    return len([w for w in re.split(r"\s+", text.strip()) if w])


# --- PII (drop, never rewrite) ----------------------------------------------

PII_PATTERNS: dict[str, re.Pattern[str]] = {
    "email": re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}"),
    "cpf": re.compile(r"\b\d{3}\.\d{3}\.\d{3}-\d{2}\b"),
    "cnpj": re.compile(r"\b\d{2}\.\d{3}\.\d{3}/\d{4}-\d{2}\b"),
    # BR phone shapes: (11) 91234-5678 / 11 91234-5678 / +55 11 91234 5678.
    "phone": re.compile(
        r"(?:\+55[\s.-]?)?(?:\(\d{2}\)|\b\d{2})[\s.-]?9?\d{4}[\s.-]\d{4}\b"
    ),
    # Social handle. Not an email (handled above); require word boundary.
    "handle": re.compile(r"(?<![\w@.])@[A-Za-z0-9_]{2,}"),
}


def pii_hits(text: str) -> list[str]:
    return [name for name, pattern in PII_PATTERNS.items() if pattern.search(text)]


# --- automated filters are not an audit (C5) ---------------------------------
#
# `pii_hits` above is a regex screen over five identifier shapes. It is a FILTER:
# it drops a candidate on a hit and never rewrites one, and it reads no context, so
# it cannot find an identifier it has no pattern for — a full name in running prose,
# an address, a rare handle shape. A human audit is a different act, and the sealed
# corpus asserting `piiAudit.status: "passed"`, `method: "manual-and-automated"` on
# 10.000 records that only ever met this function is precisely the falsification C5
# removes (R4).
#
# So the writer RECORDS which filters ran, as evidence produced by the code that ran
# them, and the record built from the candidate carries them inside
# `review.automatedFilters` under state `automated/unreviewed`. Nothing here may
# write a reviewer, a date or a verdict: `benchmark/schema.ts` refuses a receipt key
# on that state, and a pool row has no way to spell one.
AUTOMATED_FILTERS_RUN: tuple[dict[str, str], ...] = (
    {
        "filter": "pii-pattern-scan",
        "implementation": "benchmark/lab/common.py:pii_hits",
        "outcome": "passed",
    },
    {
        "filter": "length-floor",
        "implementation": "benchmark/lab/common.py:CandidateWriter.offer",
        "outcome": "passed",
    },
)


# --- deterministic sampling ---------------------------------------------------


def read_id_file(path) -> frozenset[str]:
    """Loads a plain-text id-per-line file into a set (blank lines ignored)."""
    from pathlib import Path

    text = Path(path).read_text(encoding="utf-8")
    return frozenset(line.strip() for line in text.splitlines() if line.strip())


def keep_sample(key: str, rate: int) -> bool:
    """Deterministic 1-in-`rate` sampler keyed on a stable id (no randomness)."""
    if rate <= 1:
        return True
    digest = hashlib.sha1(key.encode("utf-8")).digest()
    return int.from_bytes(digest[:4], "big") % rate == 0


# --- candidate records --------------------------------------------------------


@dataclass
class Candidate:
    candidate_id: str
    source_id: str
    license_id: str
    created_at_ms: int
    text: str
    words: int
    domain_source: str
    # Not `dict[str, str]`: since C2 the extractors carry `groupAxes`, a nested
    # object per grouping axis ({"state": ..., "id"/"reason": ...}). The annotation
    # is widened rather than the axes being flattened into strings, because a
    # three-valued state squeezed into a string is precisely the v2 defect — an
    # empty string that means "unknown" to one reader and "not applicable" to
    # another.
    meta: dict[str, object] = field(default_factory=dict)

    def to_json(self) -> str:
        return json.dumps(
            {
                "candidateId": self.candidate_id,
                "sourceId": self.source_id,
                "licenseId": self.license_id,
                "createdAt": self.created_at_ms,
                "text": self.text,
                "wordCount": self.words,
                "domainSource": self.domain_source,
                "meta": self.meta,
            },
            ensure_ascii=False,
        )


@dataclass
class Stats:
    scanned: int = 0
    kept: int = 0
    drop_date: int = 0
    drop_words: int = 0
    drop_pii: int = 0
    drop_license: int = 0
    drop_other: int = 0
    drop_sampled_out: int = 0
    drop_excluded: int = 0
    pii_kinds: dict[str, int] = field(default_factory=dict)

    def note_pii(self, kinds: list[str]) -> None:
        self.drop_pii += 1
        for kind in kinds:
            self.pii_kinds[kind] = self.pii_kinds.get(kind, 0) + 1

    def to_json(self) -> str:
        return json.dumps(self.__dict__, ensure_ascii=False, indent=2)


class CandidateWriter:
    """JSONL writer that owns the shared keep/drop pipeline for one source."""

    def __init__(
        self,
        output: Path,
        *,
        source_id: str,
        limit: int,
        sample_rate: int,
        date_cutoff: datetime | None = CHATGPT_CUTOFF,
        append: bool = False,
        start_sequence: int = 0,
        exclude_ids: frozenset[str] | None = None,
    ) -> None:
        self.output = output
        self.source_id = source_id
        self.limit = limit
        self.sample_rate = sample_rate
        # Fresh-extraction disjointness: candidate ids already spent in a prior
        # split (train/dev/reserved) or as mixed-class parents are skipped on
        # emit, so a re-run of the SAME dump yields out-of-training material
        # without touching the stable-id scheme.
        self.exclude_ids = exclude_ids or frozenset()
        # HUMAN candidates require pre-ChatGPT provenance; GENERATED (ai-class)
        # candidates are created now, so their writer passes date_cutoff=None.
        self.date_cutoff = date_cutoff
        self.stats = Stats()
        # Resume support: an appending writer continues the id sequence so
        # candidate ids stay unique across runs.
        self._sequence = start_sequence
        output.parent.mkdir(parents=True, exist_ok=True)
        self._handle = output.open(
            "a" if append else "w", encoding="utf-8", newline="\n"
        )

    @property
    def full(self) -> bool:
        return self.stats.kept >= self.limit

    def offer(
        self,
        *,
        natural_key: str,
        license_id: str,
        created_at: datetime | None,
        raw_text: str,
        domain_source: str,
        meta: dict[str, object] | None = None,
    ) -> None:
        """Runs the shared filters and writes the candidate when ALL pass."""
        stats = self.stats
        stats.scanned += 1
        if self.full:
            return
        if created_at is None or (
            self.date_cutoff is not None and created_at >= self.date_cutoff
        ):
            stats.drop_date += 1
            return
        text = normalize_text(raw_text)
        words = word_count(text)
        if words < MINIMUM_WORDS or words > MAXIMUM_WORDS:
            stats.drop_words += 1
            return
        hits = pii_hits(text)
        if hits:
            stats.note_pii(hits)
            return
        if not keep_sample(natural_key, self.sample_rate):
            stats.drop_sampled_out += 1
            return
        # STABLE id: derived from the natural key, so re-extraction with wider
        # limits/sample-rates keeps every previously-issued id unchanged (pair
        # references and hash-partition splits survive corpus growth).
        stable = hashlib.sha1(natural_key.encode("utf-8")).hexdigest()[:12]
        candidate_id = f"{self.source_id}_{stable}"
        if candidate_id in self.exclude_ids:
            stats.drop_excluded += 1
            return
        self._sequence += 1
        candidate = Candidate(
            candidate_id=candidate_id,
            source_id=self.source_id,
            license_id=license_id,
            created_at_ms=int(created_at.timestamp() * 1000),
            text=text,
            words=words,
            domain_source=domain_source,
            # The two filters this method just ran, recorded on the row that
            # survived them. `outcome` is always "passed" here BY CONSTRUCTION: a
            # candidate that hit either filter returned above and has no row to
            # carry the fact, which is why the schema refuses "excluded" on a
            # record that exists. A caller's own `meta` wins, so an extractor that
            # ran additional filters (the Carolina licence allowlist) can say so.
            meta={"automatedFilters": [dict(f) for f in AUTOMATED_FILTERS_RUN], **(meta or {})},
        )
        self._handle.write(candidate.to_json() + "\n")
        stats.kept += 1

    def close(self) -> None:
        self._handle.close()
        stats_path = self.output.with_suffix(".stats.json")
        stats_path.write_text(self.stats.to_json() + "\n", encoding="utf-8")


def parse_iso_date(value: str) -> datetime | None:
    """Parses `YYYY-MM-DD` or full ISO timestamps; None on anything else."""
    value = value.strip()
    match = re.match(r"^(\d{4})-(\d{2})-(\d{2})", value)
    if not match:
        return None
    try:
        return datetime(
            int(match.group(1)),
            int(match.group(2)),
            int(match.group(3)),
            tzinfo=timezone.utc,
        )
    except ValueError:
        return None
