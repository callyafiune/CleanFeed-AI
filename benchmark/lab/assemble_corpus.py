"""Assembles the corpus cleanfeed-ptbr-cells-v1 from candidate pools into the canonical
BenchmarkRecord **v3** shape that `ingest` + `validate` accept.

Emits (into --out-dir):
  records.jsonl                    the canonical records (human/ai/mixed)
  cluster-report.json              cluster count + size distribution + largest
                                   cluster, per axis and per slice (feeds E3)
  private/review-ledger.jsonl      one {recordId,reviewState,...} per record — the
                                   HONEST review state, never a fabricated concordance
  private/label-evidence.jsonl     the entries every human labelEvidenceRef resolves
                                   against, one per SOURCE registration
  governance-inputs.json           sourceIds + held-out families + licenses, for
                                   build_governance.ts to mint the digest-bound
                                   source-manifest.json and template manifest.json

WHAT CHANGED IN v3, AND WHY (C2). The v2 assembler wrote a fresh identifier per
record on five of the grouping axes, so the blocked split had nothing to find, the
clustered bootstrap resampled i.i.d. over singletons, and the near-duplicate axis
could not name a cluster. The long note above `UnmappableLane` states the defect and
its three measured consequences. Now:

  * every axis carries a STATE — `known` with an identity, `notApplicable` with a
    written reason, or `unknown` with a written reason and the cost of the record's
    eligibility (R6). Nothing is ever substituted;
  * the identities are the ones the sources have: the Stack Overflow THREAD, the
    Wikipedia PAGE, the B2W PRODUCT, the Carolina MEMBER FILE, the extraction RUN,
    the generation BATCH, the human SEED, the prompt TEMPLATE, the LANE;
  * person identifiers (SE author, B2W reviewer) are HMAC pseudonyms keyed by C3's
    keyring, never bare digests, and the extractors fail closed without it;
  * a human row states the basis of its `human` label — which date field, what value,
    against which cutoff, out of which snapshot — instead of asserting it;
  * a row the v3 contract cannot express is DROPPED AND COUNTED, never patched. v2
    accepted generated rows with no lane, no template digest and no effort, and human
    rows with no date evidence; those counts are printed, and they are the size of
    what has to be re-extracted or regenerated.

Design otherwise unchanged from the assembly map (memory:
cleanfeed-canonical-assembly):
  * OMIT normalizedTextSha256 (ingest recomputes + fills).
  * Pseudonyms /^[A-Za-z0-9_-]+$/ everywhere ids/groups live; families slugged.
  * label cross-rules: human->no generation; ai->generation; mixed->mixture
    (fractions sum to 1 at full float precision) + derivationRoot != id.
  * humanSourceType = register (5 required types). hardNegativeFamily tagged
    heuristically so all 6 required families are present on human records.
  * createdAt assigns a train/dev/cal-A/cal-B/test BLOCK (45/5/10/20/20 per class); held-out AI
    generator families are forced entirely into the test block (latest time),
    as the split requires them after the test cut.

Usage:
  python assemble_corpus.py --out-dir ../out/rebuild-v3/C2 [--sample 120]
    [--candidates-dir <pools>]

NEVER point --out-dir at benchmark/data/corpus-build: that is the sealed artifact of
the REPROVED run and §7 of the plan puts it in "Descarte", so overwriting it would
destroy the evidence the diagnosis rests on.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
import unicodedata
from collections import Counter
from pathlib import Path

import group_axes
import near_dupes

CAND = Path(__file__).resolve().parent.parent / "data" / "candidates"
DATASET = Path(__file__).resolve().parent.parent / "data" / "dataset"

# The cutoff every human label in this corpus rests on, as the ISO instant the
# record's labelEvidenceRef carries. Same value as common.CHATGPT_CUTOFF; spelled
# here because the record needs the string form and the extractor needs the datetime.
CUTOFF_ISO = "2022-11-30T00:00:00+00:00"

# provenance.sourceId -> the frozen snapshot token it was extracted from
# (benchmark/preregistration-v4.json humanSources.snapshots). The fallback for a
# candidate whose own meta does not carry the snapshot, which is every pool written
# before C2. It maps SOURCE to SNAPSHOT and nothing else: it does not record which
# concrete dump version, because that is a fact only the extractor saw and D1 is
# what registers it.
SOURCE_SNAPSHOT = {
    "src_ptso": "pt-stackoverflow",
    "src_wikipedia_pt": "ptwiki",
    "src_b2w": "b2w-reviews01",
    "src_carolina": "carolina",
}

# Block timestamps drive the temporal split, one per partition in temporal order
# (train < dev < cal-A < cal-B < test). The splitter finds its four cuts between these
# blocks, so the spacing only has to be strictly increasing.
BLOCK_TIME = {
    "train": 1_000_000,
    "dev": 2_000_000,
    "cal-A": 3_000_000,
    "cal-B": 4_000_000,
    "test": 5_000_000,
}
# The 45/5/10/20/20 blocks per class, and the ONLY place they are written down: a second
# spelling of one frozen decision could be edited without the first moving, so
# `assign_partitions` reads this dict rather than repeating the fractions inline.
# `test` carries no fraction because it is the REMAINDER — deriving it by rounding too
# would let the five blocks fail to sum to the class size.
CLASS_FRACTIONS = {"train": 0.45, "dev": 0.05, "cal-A": 0.1, "cal-B": 0.2}

# Mirrors `CLASS_TOLERANCE` in benchmark/split.ts, which is what the audit compares against.
# Absolute, not relative to the target: two points is forty percent of `dev`'s 5%, so a `dev`
# holding 3% or 7% of a class is legal, and a guard stricter than this refuses corpora the
# splitter accepts. `test_extractors.py` compares it against the TypeScript constant.
CLASS_TOLERANCE = 0.02

# O epsilon que toda comparacao de tolerancia soma, espelhando `CLASS_TOLERANCE_EPSILON` em
# benchmark/split.ts. A tolerancia e INCLUSIVA — 3% e 7% num `dev` sao legais pelo contrato — e
# float binario nao representa a borda: `abs(0.03 - 0.05)` da 0.020000000000000004, maior que
# 0.02. Comparar float cru recusa exactamente os dois valores que o contrato admite.
CLASS_TOLERANCE_EPSILON = 1e-9


def within_class_tolerance(fracao: float, alvo: float) -> bool:
    """`|fracao - alvo| <= CLASS_TOLERANCE`, com a borda INCLUIDA."""
    return abs(fracao - alvo) <= CLASS_TOLERANCE + CLASS_TOLERANCE_EPSILON

# domainSource (candidate) -> humanSourceType (register). datasets set aside.
REGISTER = {
    "ptso_qa": "qa-informal",
    "ptwiki_lead": "encyclopedic",
    "b2w_reviews": "social-media",
    "carolina_social_media": "social-media",
    "carolina_university_domains": "university",
    "carolina_judicial_branch": "institutional",
    "carolina_legislative_branch": "institutional",
}
# Register -> (provenance.sourceId, licenseId). sourceId must appear in the
# source-manifest sources[]; licenseId in the manifest licenses[].
HUMAN_SOURCE = {
    "ptso_qa": ("src_ptso", "cc-by-sa-4.0"),
    "ptwiki_lead": ("src_wikipedia_pt", "cc-by-sa-4.0"),
    "b2w_reviews": ("src_b2w", "cc-by-nc-sa-4.0"),
    "carolina_social_media": ("src_carolina", "cc-by-nc-sa-4.0"),
    "carolina_university_domains": ("src_carolina", "cc-by-nc-sa-4.0"),
    "carolina_judicial_branch": ("src_carolina", "cc-by-nc-sa-4.0"),
    "carolina_legislative_branch": ("src_carolina", "cc-by-nc-sa-4.0"),
}
GENERATED_LICENSE = "geracao-propria-v1"
HARD_NEGATIVE_FAMILIES = [
    "formulaic",
    "motivational",
    "highly-polished",
    "repetitive",
    "non-native",
    "corporate-structure",
]
# Which register a hard-negative style is drawn from (heuristic, presence-level).
HN_REGISTER = {
    "formulaic": "institutional",
    "corporate-structure": "institutional",
    "highly-polished": "encyclopedic",
    "repetitive": "social-media",
    "non-native": "social-media",
    "motivational": "qa-informal",
}
TARGET = {"human": 4000, "ai": 4000, "mixed": 2000}
# validate rejects any DECLARED held-out family with fewer positives.
HELD_OUT_MINIMUM = 200
# Families that CANNOT be claimed as unseen by the detector, and therefore must
# never be declared held-out — a provenance judgment, not something derivable
# from the corpus.
#
# The training set holds 721 records from the ALIAS `gemini-flash-lite-latest`,
# generated 2026-07-22 22:20 to 2026-07-23 08:43. Nothing on either side records
# which concrete version that alias resolved to. The benchmark's flash-lite lanes
# were generated 2026-07-24 13:50-16:48 — some 30 hours later, through the same
# API and key — and no plausible model rotation happens in 30 hours, so "latest"
# was in all likelihood one of these very families. It cannot be proven either
# way (the raw API responses, which carry modelVersion, were never persisted),
# and the burden of proof belongs to the held-out claim: declaring one of these
# would measure a "generator never seen in training" that the detector saw 721
# times, inflating the generalization result in the direction nobody notices.
#
# They stay in the corpus as ordinary AI families — no record is discarded, only
# the claim is withdrawn.
HELD_OUT_INELIGIBLE = {"gemini-3_5-flash-lite", "gemini-3_1-flash-lite"}
# No provider on these channels exposes a seed, so every declared batch records the
# same reason for its absence.
#
# `LAB_TEMPERATURE = 0.8` stood here and is DELETED. It had two readers before this
# task (`git show eae6ce6:benchmark/lab/assemble_corpus.py`, lines 246 and 302) and
# none after, because `decoding_config` now derives the temperature from the frozen
# LANE and from what the row recorded. Leaving a retyped 0.8 next to the function
# whose whole point is that the pools carry a temperature no lane ever applied is
# how it gets picked back up.
SEED_NULL_REASON = "provider API does not expose a sampling seed"
# The other half of the same pair, on the axis where an agent-CLI lane genuinely
# applies nothing: `agy`, `codex` and `gemini-cli` take no sampling flag at all
# (preregistration-v4.json, `decodingConfigurable: false`), so a batch of one of
# those lanes must say that instead of a number nothing applied.
TEMPERATURE_NULL_REASON = "agent-CLI lane: the binary accepts no sampling flag"
# The mixed cohort this lane produces. The frozen contract
# (benchmark/preregistration-v4.json, `materialAssistance.generationMode`) closes
# the vocabulary at "mechanistic" | "ecological", and only the first is a fact
# about anything this project makes.
MECHANISTIC_GENERATION_MODE = "mechanistic"


def slug(value: str) -> str:
    """Any string -> pseudonym token /^[A-Za-z0-9_-]+$/ (never empty)."""
    out = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")
    return out or "x"


def generator_family(value: str) -> str:
    """A provider label -> THE canonical generator family.

    The single Python-side mirror of normalizeGeneratorFamily in
    benchmark/generator-family.ts: collapse every run outside [A-Za-z0-9_-] into
    one "_", strip leading/trailing SEPARATORS ("_" and "-"), preserve case. So
    "gemini-3.5-flash-low" -> "gemini-3_5-flash-low", and the underscore form maps
    to itself.

    Both separators, because "-" is in the token class too: stripping only "_" mapped
    "gemini-3.5-" to "gemini-3_5-", a canonical token DISTINCT from "gemini-3_5" --
    two spellings of one family, which is the defect this pair of functions exists to
    prevent. The two sides must agree character for character or the assembler writes
    a family the schema refuses, so this strip and the TypeScript one move together.
    slug() keeps the narrower strip: it mints ordinary grouping tokens, and widening
    it there would rewrite batch and template identities that name nothing canonical.

    The underscore spelling is canonical because the value has to live in
    groups.generatorFamily, and every grouping token is validated as a pseudonym
    (no ".", which is a PII separator) — so the dotted spelling the provider uses
    cannot be it. generation.family keeps the provider's literal label, because the
    governance audit matches it byte for byte against the declared batch recipe.

    Unlike slug() this FAILS instead of returning a placeholder: a family we cannot
    name is a governance problem, not a string to patch over. The TypeScript schema
    is the real enforcement — validateBenchmarkRecord refuses any record whose
    groups.generatorFamily is not exactly this function's output for its
    generation.family — so this function exists to make the assembler write what
    the schema will accept, not to be a second authority.
    """
    out = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_-")
    if not out:
        raise ValueError(
            f"generator family {value!r} normalizes to nothing: "
            "it carries no character of [A-Za-z0-9_-]"
        )
    return out


def norm_hash(text: str) -> tuple[str, str]:
    """(normalized_text, sha256) matching ingest's normalizeCorpusText: CRLF/CR
    -> LF then NFC."""
    normalized = unicodedata.normalize(
        "NFC", text.replace("\r\n", "\n").replace("\r", "\n")
    )
    return normalized, hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


# --- the review state: this assembler cannot produce a receipt (C5) ----------
#
# WHAT WAS HERE, AND WHY IT WAS FALSIFICATION. One constant naming the annotation
# protocol, two reviewer tokens and a declared concordance between them, plus one
# function returning a personal-data verdict of "passed" over a method that claimed
# both a machine and a human stage, a third reviewer token and a timestamp — both
# stamped onto every record.
#
# (Described in prose rather than pasted as the original literals, for the reason
# C2's `base_groups` note gives: `test_the_assembler_mints_no_review_receipt` greps
# this file for those tokens, and a comment quoting any of them verbatim would defeat
# the guard that keeps them from coming back. `git show
# 743767c:benchmark/lab/assemble_corpus.py` has the original bytes.)
#
# All 10.000 rows of the sealed corpus therefore assert that two named reviewers
# examined them and concurred, and that a third audited them for personal data and
# cleared them — and no human ever looked at a single row. The review timestamps
# were the partition BLOCK TIMES (1.000.000 ms and up,
# January 1970), so even the dates were the split's bookkeeping wearing a governance
# label. `integrity.review-ledger-hash` and `integrity.dataset-audit-sealed` passed
# over all of it, because both asked whether the field was PRESENT.
#
# That is inventing a reviewer, a date and a verdict: the one thing R4 names
# outright. §7 of the plan puts both blocks in "Descarte".
#
# WHAT REPLACES IT. Nothing that claims a review. Every record this assembler writes
# is `automated/unreviewed`, which is a first-class state in `benchmark/schema.ts`
# and not an absence: it names the automated filters that DID run and why no human
# audit did. The receipt arm exists in the schema and has NO producer here — D1/D5
# are the tasks that bring real reviewers, and until they do, a release seal is
# refused (DATASET_REVIEW_INVALID) rather than granted on a fabricated receipt.
#
# DO NOT ADD A RECEIPT BUILDER HERE. It would be one function away from a corpus
# that claims 10.000 reviews again, and the assembler is the only place with the
# means: it writes every row. A receipt has to enter from the review's own output,
# per record, and it has to name a real person's pseudonym and a real instant.
NO_HUMAN_AUDIT = (
    "no human reviewer was assigned to this corpus build: the extractors' automated "
    "filters ran and no audit did, so the record supports no review claim (C5/R4)"
)


def review_state(cand: dict | None = None) -> dict:
    """The `automated/unreviewed` block of one record.

    The filter list is READ from the candidate row (`meta.automatedFilters`, written
    by `common.CandidateWriter.offer` at the moment it ran them) and is EMPTY when
    the row does not carry one. Empty is the honest answer and not a gap to fill:
    pools written before that field existed record nowhere which screens saw them,
    and naming one here would be the same invention as the old constant with a
    smaller blast radius. It is the same discipline the grouping axes follow — a
    value the row does not have is stated as missing, never substituted (R6/R7).

    Generated and mixed rows pass `cand=None`: `common.CandidateWriter` is the human
    extraction path, the generation pools do not go through it, and no filter of ours
    screened a generated row for personal data. Claiming otherwise would be a
    provenance we do not have.
    """
    meta = (cand or {}).get("meta") or {}
    declared = meta.get("automatedFilters")
    filters = list(declared) if isinstance(declared, list) else []
    return {
        "state": "automated/unreviewed",
        "automatedFilters": filters,
        # One spelling, read from the module constant, so 10.000 rows cannot end up
        # carrying two versions of the same sentence.
        "humanAuditAbsentReason": NO_HUMAN_AUDIT,
    }


# --- the grouping axes, from the identity the source actually has -------------
#
# WHAT WAS HERE, AND WHY IT WAS WRONG. `base_groups(rec_id, derivation_root)`
# returned a fresh identifier per record on five axes at once: author as
# a-underscore-recordId, source as g-, domainSource as ds-, collectionBatch as cb-
# and nearDuplicate as nd-, each interpolating the record id —
#
# (spelled out in prose rather than pasted as the original f-strings on purpose:
# `test_no_module_mints_a_per_record_group_token` greps this file for those five
# literals, and a comment quoting them verbatim would defeat the guard that keeps
# them from coming back. `git show 04c2cd5:benchmark/lab/assemble_corpus.py` has the
# original bytes.)
#
# — under the comment "All UNIQUE per record so the blocked split sees singleton
# components." Read as a design that is the whole defect stated out loud: the
# grouping axes were built to guarantee that the split would never find a shared
# component, and then the split's silence was read as evidence of no leakage.
#
# It is not merely uninformative, it is actively misleading in three measured ways:
#
#   * the blocked split reported `leakages: []` while separating identifiers that
#     could not collide — a true statement about nothing;
#   * `authorClusterKey` handed the bootstrap 10.000 distinct "authors", so a
#     clustered resample was i.i.d. and every interval came out narrower than the
#     data supports, in the direction that flatters the result;
#   * `nearDuplicate` could not name a cluster, so a surviving near-duplicate pair
#     cost BOTH records (ingest refuses every member of a cluster that straddles
#     more than one lineage) instead of collapsing to one representative.
#
# DO NOT REINTRODUCE IT AS AN OPTIMISATION. It is tempting, because a per-record
# token makes every downstream constraint pass on the first try: the split never
# refuses a component, no stratum is ever under-powered, no record is ever
# ineligible. That is exactly the reason it must not come back — it converts every
# check in the pipeline into a tautology. If an axis has no identity, the answer is
# `notApplicable` with a reason or `unknown` with a reason and the eligibility cost,
# and a source that cannot yield one of the three is a bug in the extractor.


class UnwritableInV3(ValueError):
    """The pool row cannot be expressed as a sealed record, so it leaves the corpus.

    A shared base so the assembler has ONE drop path: every subclass means the same
    thing operationally ("count it, name the reason, do not write it"), and none of
    them means "abort the assembly". The subclasses exist because the REASONS are
    different facts an operator has to act on differently — a lane that is not frozen
    needs a decision about the provider, a missing template digest needs a
    regeneration, a missing date needs a re-extraction.

    What no subclass ever means is "substitute a value and continue". Every one of
    these rows was accepted by the v2 schema, which asked for less; the corpus gets
    smaller and honest rather than complete and unverifiable.
    """


class UnmappableLane(UnwritableInV3):
    """The record's provider is not one of the four frozen generation lanes.

    Its own type because the correct handling is to DROP the record, not to abort
    the assembly: the pools hold rows from providers that predate the frozen lane
    table (`anthropic`, `openai`), and `groups.generationLane` must be `known` on
    every `ai` row. A lane cannot be added here to accommodate them — the four are
    frozen — and naming one they never ran on would be invented provenance (R4).
    """


class MissingRecipe(UnwritableInV3):
    """The pool row does not record enough of its own recipe to be written as v3.

    Also a drop-this-record signal rather than a crash. It fires on rows that the
    v2 schema accepted because v2 asked for less: `ai_reserved.jsonl` carries only
    {id, text, family, recipe, pairedWith, split} with no provider and no template
    digest, and the mixed pools never recorded which mixing template produced them.

    The alternative — reconstructing the missing field from whatever is in the lab
    scripts TODAY — is refused on purpose. The template in `make_mixed.EDIT_PROMPT`
    may not be the one that ran months ago, and a digest that merely looks plausible
    is worse than an absent row: it would make `promptTemplate` a cluster nobody can
    verify, which is the same class of defect as the per-record token above.
    """


class MissingMaterialBatch(UnwritableInV3):
    """The row does not name the MATERIAL it came from, and no value can be invented.

    `AXIS_STATE_RULE.sourceMaterialBatch` admits only `known` on a human row and on a
    mechanistic mixed one, so there is no eligibility-priced escape here: a row with no
    resolvable acquisition event is unwritable and leaves the corpus.

    The alternative is what the dead corpus did with `collectionBatch` — key a fallback
    on the stratum (`extraction_<domainSource>`) and let every row of one stratum share
    it. That is an invented cluster: it declares that rows acquired in different events
    depend on each other, and it declares it in the one axis the reviewed manifest is
    supposed to be the authority on. A batch this assembler makes up resolves against no
    `materialBatches` entry, so `assertMaterialBatchesResolve` would refuse it anyway —
    later, and after a full assembly run.
    """


class MissingExtractionRun(UnwritableInV3):
    """A human row that does not name the extraction RUN that wrote it.

    Diagnostic axis, non-negotiable state: `known` on every human row. The run is our
    own execution, so a gap there is a defect in a pipeline we control, and the loader
    is the layer that knows it — the pool FILE is the run, and only the reader knows
    which file it opened. Deriving the run from the stratum instead would merge rows
    written by different executions into one invented run and destroy the only handle
    that traces a defect back to the execution that produced it.
    """


class MissingLabelEvidence(UnwritableInV3):
    """A human row whose candidate does not carry the date it was labelled on.

    v3 requires `labelBasis` + `labelEvidenceRef` on every human record, because a
    human label with no stated basis is an assertion rather than evidence. The date
    is read from the source by the extractor; a candidate that lacks it came from a
    pool written before the extractors emitted it, and the honest outcome is to drop
    the row rather than to date it by guesswork.
    """


# provider label in the pools -> the frozen lane it corresponds to. Data, not
# heuristics: `antigravity` is the name make_mixed_agy.py records for the SAME agy
# binary generate_ai.py calls `agy`, which is why both map onto one lane.
PROVIDER_LANE = {
    "agy": "agy",
    "antigravity": "agy",
    "codex": "codex",
    "gemini": "gemini-api",
    "gemini_cli": "gemini-cli",
}

# The frozen lane rows, read from benchmark/preregistration-v4.json rather than
# retyped. The policy file is the single source of truth for what each lane accepts,
# and a copy here would be a second authority that can disagree with the schema.
POLICY_PATH = Path(__file__).resolve().parent.parent / "preregistration-v4.json"


def lane_rows() -> dict[str, dict]:
    return json.loads(POLICY_PATH.read_text(encoding="utf-8"))["generationLanes"]


LANE_ROWS = lane_rows()


def lane_of(provider: str, declared: str | None = None) -> str:
    """The frozen lane of a pool row.

    `declared` wins when the generator recorded it, because a lane the generator
    WROTE DOWN is an observation and a lane derived from a provider label is an
    inference. The inference is kept as a fallback only for the pools written before
    generate_ai.py emitted the field.
    """
    lane = declared or PROVIDER_LANE.get(provider or "")
    if lane not in LANE_ROWS:
        raise UnmappableLane(
            f"provider {provider!r} (declared lane {declared!r}) is not one of the "
            f"four frozen generation lanes {sorted(LANE_ROWS)}. The record cannot "
            "name a lane it never ran on, so it leaves the corpus"
        )
    return lane


def decoding_config(lane: str, meta: dict) -> dict:
    """`generation.decoding`, decided by the LANE and not by what the pool carries.

    MEASURED, and this is the sharpest datum C1 surfaced: generate_ai.py wrote
    `"temperature": str(TEMPERATURE)` into the meta of EVERY provider, including
    `agy`, `codex` and `gemini_cli`, which it invokes as CLIs with no sampling flag
    anywhere in the argv (`[AGY_BIN, "-p", prompt, "--mode", "plan", "--model",
    model]`). So the pools on disk carry temperature 0.8 on thousands of records
    where no temperature was ever applied.

    Under `decodingConfigurable: false` that number has nowhere to go and the schema
    refuses it outright, which is the right outcome: carrying it forward would let a
    reader — or a governance audit comparing a record against its declared batch —
    conclude that a sampling temperature was chosen for a run that had no such knob.
    """
    row = LANE_ROWS[lane]
    if not row["decodingConfigurable"]:
        return {"configurable": False}
    temperature = meta.get("temperature")
    return {
        "configurable": True,
        # The provider's own word for the strategy, when it names one. None is a real
        # state ("we did not set it, the default applied"), distinct from the
        # `configurable: false` branch above ("this lane has no such knob").
        "strategy": meta.get("decodingStrategy") or None,
        "temperature": float(temperature) if temperature not in (None, "") else None,
        "topP": float(meta["topP"]) if meta.get("topP") not in (None, "") else None,
        "repetitionPenalty": (
            float(meta["repetitionPenalty"])
            if meta.get("repetitionPenalty") not in (None, "")
            else None
        ),
    }


def effort_config(lane: str, meta: dict) -> dict:
    """`generation.effort`, from what the lane RECORDED — never from the model name.

    NOT DERIVED FROM THE MODEL ID SUFFIX, deliberately, even though on `agy` some
    model ids embed the tier (`gpt-oss-120b-medium`, `gemini-3.6-flash-low`) and the
    temptation to read it off the string is obvious. `--effort` exists as a session
    flag in parallel, so `model` and `effort` are NOT orthogonal on that lane, and
    the precedence between them has not been measured (it will be, by `--dry-run`,
    before D3). Reading "medium" off a suffix would record as an observation
    something that is a guess about which of two inputs won — the exact shape of
    invented identity R6 forbids. So the fields are modelled such that the
    precedence CAN be written down once it is known, and nothing is written until it
    is.

    The `not-supported` arm is only available on a lane whose frozen row offers it.
    `codex` does not: its `effortSources` are `flag` and `provider-default`, and both
    of those carry a level. A codex row whose effort was never recorded therefore
    cannot be written as v3 at all, and it is refused rather than given a level we
    do not know. That is a real blocker for the codex lane, not a quirk of this
    function — see the plan's C2 section.
    """
    row = LANE_ROWS[lane]
    level = meta.get("effortLevel")
    source = meta.get("effortSource")
    if level and source:
        return {
            "source": str(source),
            "configurable": bool(row["effortConfigurable"]),
            # The scale comes from the LANE, not from the record: effort is not
            # comparable across providers (codex reaches xhigh, agy stops at high),
            # so a level without its own lane's scale would read as a shared ordinal.
            "scale": str(row["effortScale"]),
            "level": str(level),
        }
    if "not-supported" in row["effortSources"]:
        return {"source": "not-supported", "configurable": False}
    raise MissingRecipe(
        f"the lane {lane!r} offers effort sources {row['effortSources']} and none of "
        "them is 'not-supported', so every record of this lane must name an effort "
        "level and a source. This pool row records neither, and a level we did not "
        "observe is not ours to supply"
    )


def harness_axis(lane: str, meta: dict) -> dict:
    """`groups.harnessVersion` — the CLI binary that is an input to the text.

    Three-way and the difference is the whole of R6. On an API lane there is no
    harness, so `notApplicable` is TRUE. On a CLI lane the binary injects a system
    prompt, loops over tools, retries and post-processes, so its version is an input
    to the text: `notApplicable` there would be a false statement about the lane, and
    a synthesized version string would be a false statement about the world. What is
    left is `unknown` — true, and priced at the record's eligibility.

    The pools on disk all take the `unknown` arm, because generate_ai.py did not
    capture the binary version until this task added it. That is a measured cost of
    the v2 generation runs and not something to paper over: those records are
    ineligible until they are regenerated.
    """
    row = LANE_ROWS[lane]
    if row["channel"] == "api":
        return group_axes.not_applicable(
            f"the lane {lane!r} is a direct API call: no harness binary runs, so "
            "there is no version to attribute"
        )
    version = meta.get("harnessVersion")
    if version:
        return group_axes.known(group_axes.axis_token(str(version)))
    return group_axes.unknown(
        f"the lane {lane!r} runs a harness binary whose version this generation run "
        "did not capture. The axis applies, so notApplicable would be false; the "
        "record is ineligible instead of being given a version we never read"
    )


def seed_pair(meta: dict) -> dict:
    """Exactly one of `seed` / `seedNullReason`, and NEVER an invented seed.

    The sealed schema refuses a recipe carrying both or neither, and the rule matters
    beyond well-formedness: a seed is the one field that would make a generation
    reproducible, so a fabricated one is a claim that the text can be regenerated
    when it cannot. D3 states the same prohibition.

    An EMPTY seed is not a seed. The pools spell the absent case as `"seed": ""` plus
    a reason, so a truthiness test is what reads them correctly; `is not None` would
    write `seed: ""` and be refused by `nonEmptyString` anyway — loudly, which is
    fine, but at the cost of a full assembly run to discover.

    Defaulting fills in the REASON and never the seed, which is the safe half: no
    provider on any of the four frozen lanes exposes a sampling seed, so for a row
    that recorded neither, "there was no seed" is a fact about the lane rather than a
    guess about the row.
    """
    seed = meta.get("seed")
    if seed:
        return {"seed": str(seed)}
    return {"seedNullReason": str(meta.get("seedNullReason") or SEED_NULL_REASON)}


def parent_of_prompt(prompt_id: str) -> str | None:
    """The human seed a generated row came from, out of its `promptId`.

    The observed format is `<recipe>_<candidateId>` — `original_src_b2w_00848b3bc692`
    — so the parent is everything after the first underscore. Split on the FIRST
    underscore only: candidate ids contain underscores themselves
    (`src_b2w_00848b3bc692`), and splitting on the last would return a hex fragment
    that resolves to no record.
    """
    if not prompt_id or "_" not in prompt_id:
        return None
    _, parent = prompt_id.split("_", 1)
    return parent or None


# Which recipes REWRITE their parent text rather than writing new text about the
# same subject. Only a rewrite makes the row a DERIVATION of the parent; `original`,
# `social` and `humanizado` all produce new text from a seed, so their
# `derivationRoot` is notApplicable while their `humanSeed` is known. Collapsing the
# two axes would either invent a derivation or lose the seed, which is why
# benchmark/schema.ts keeps them separate.
REWRITING_RECIPES = {"parafrase"}


def generation_axes(
    lane: str,
    family: str,
    version: str,
    recipe: str | None,
    template_digest: str,
    meta: dict,
) -> dict:
    """The six axes that name a piece of the generation apparatus."""
    return {
        "promptTemplate": group_axes.known(
            # The TEMPLATE, identified by the digest of its own bytes, so two records
            # of one recipe share the axis and a template edited between runs does
            # not silently pool with its predecessor. The recipe NAME is carried too
            # when the pool recorded it, because a digest alone is unreadable in a
            # cluster report.
            group_axes.axis_token(f"{recipe or 'recipe'}_{template_digest[:16]}")
        ),
        "generatorFamily": group_axes.known(generator_family(family)),
        "generatorVersion": group_axes.known(group_axes.axis_token(version)),
        "generationLane": group_axes.known(lane),
        "harnessVersion": harness_axis(lane, meta),
    }


def label_evidence(cand: dict, source_id: str, license_id: str) -> tuple[dict, dict]:
    """(labelEvidenceRef, the private entry it resolves against).

    The `human` label of every row in this corpus rests on ONE fact: the text
    predates the ChatGPT launch, read from a date field the source itself carries.
    v3 makes the row say so — which field, what value, against which cutoff, out of
    which snapshot — instead of asserting "human" and leaving the reader to trust it.

    `entryId`/`entryDigest` name an entry of the PRIVATE manifest and the digest of
    that entry's canonical bytes; only the digest crosses into the record, which is
    what keeps the private file out of every published artifact. The entry is per
    SOURCE (a registration: this base, this snapshot, this licence, this date field)
    while the payload is per RECORD (the value read for this row), and that split is
    the schema's, not ours.

    SCOPE: the canonical private source manifest is D1's artifact. What this function
    writes is the assembler's own evidence index, digest-consistent by construction
    with the records it emits, so C3's `assertLabelEvidenceResolves` has something
    real to resolve. It is not a stand-in for D1's registration and it does not
    record the snapshot digests, which the shared context assigns to D1.
    """
    meta = cand.get("meta") or {}
    date_field = meta.get("dateField")
    observed = meta.get("observedValue")
    snapshot = meta.get("snapshot") or SOURCE_SNAPSHOT.get(source_id)
    if not date_field or not observed or not snapshot:
        raise MissingLabelEvidence(
            f"candidate {cand.get('candidateId')!r} carries no "
            f"dateField/observedValue/snapshot (got {date_field!r}, {observed!r}, "
            f"{snapshot!r}), so its human label has no stated basis. Re-extract the "
            "pool with the current extractors; the date is not ours to guess"
        )
    entry = {
        "entryKind": "human-source-registration",
        "sourceId": source_id,
        "snapshot": snapshot,
        "licenseId": license_id,
        "dateField": date_field,
        "cutoff": CUTOFF_ISO,
    }
    # Canonical bytes: sorted keys, no spaces. The digest has to be reproducible by
    # anyone holding the entry, so the serialization is pinned rather than incidental.
    canonical = json.dumps(entry, sort_keys=True, separators=(",", ":"))
    entry_id = f"ev_{group_axes.axis_token(source_id)}_{group_axes.axis_token(snapshot)}"
    entry_digest = hashlib.sha256(canonical.encode("utf-8")).hexdigest()
    ref = {
        "basis": "date-cutoff",
        "entryId": entry_id,
        "entryDigest": entry_digest,
        "dateField": date_field,
        "observedValue": observed,
        "cutoff": CUTOFF_ISO,
        "snapshot": snapshot,
    }
    return ref, {"entryId": entry_id, "entryDigest": entry_digest, **entry}


def near_duplicate_axis(cand_id: str) -> dict:
    """`groups.nearDuplicate` — THE ROW'S OWN ID, because pruning left it alone here.

    Stated plainly, because an earlier version of this docstring claimed more than
    the code did: it said the identity was "read from the pruning result" and "would
    collide the moment two rows shared a cluster", via a `representative` parameter
    that `main()` never passed and that `near_dupes.prune` could not have supplied
    anyway — prune returns `(drop, stats)` and no row-to-representative map. So the
    value was always `cand_id`, and the claimed mechanism did not exist. The
    parameter is gone rather than wired, for the reason below.

    WHY THE ROW'S OWN ID IS THE HONEST VALUE HERE, and not the per-record token this
    task removed. `main()` runs `near_dupes.prune` over all three pools and DROPS
    every non-representative before any record is built, so by the time this function
    is called each surviving row is the sole member of its near-duplicate cluster.
    Naming a one-member cluster after its one member is a description of the pruning
    result, not an identifier minted to avoid collisions. That is also why wiring a
    representative map would buy nothing: it would be the identity function on every
    row that reaches here, an always-inert parameter that reads like a real one.

    The difference from `nd_<recordId>` is therefore in the JUSTIFICATION and not in
    the value, and the value is genuinely the same. The old token was minted per
    record BECAUSE uniqueness made the split report `leakages: []`; this one is one
    per record because pruning made the clusters singletons. An all-singleton
    distribution on this axis is the evidence that pruning worked, which is exactly
    why R6 and the plan forbid a "no axis may be 100% singletons" criterion — it
    would flag this axis for being correct.

    The consequence to keep in mind: this axis carries no information the record id
    does not already carry, so it cannot be the axis that catches a leaked
    near-duplicate pair. What catches that is the pruning step itself, and if pruning
    is ever changed to KEEP both members of a cluster, this function has to change
    with it — a shared cluster id would then be a real datum, and it would have to
    come from a prune that publishes one.
    """
    return group_axes.known(group_axes.axis_token(cand_id))


# --- record builders (return the canonical dict, block_time filled later) ----


def human_record(
    cand: dict,
    register: str,
    hard_neg: str | None,
    evidence_sink: list | None = None,
) -> dict:
    rec_id = slug(cand["candidateId"])
    source_id, license_id = HUMAN_SOURCE[cand["domainSource"]]
    meta = cand.get("meta") or {}
    axes = dict(meta.get("groupAxes") or {})
    ref, entry = label_evidence(cand, source_id, license_id)
    material_batch = str(meta.get("sourceMaterialBatch") or "")
    if not material_batch:
        raise MissingMaterialBatch(
            f"human candidate {rec_id!r} names no sourceMaterialBatch, so the acquisition "
            "event its material came from is not recoverable from the row. The extractor "
            "reads it from the material it opened and the reviewed manifest declares it; "
            "a value derived here from the stratum would be a cluster nobody can verify"
        )
    extraction_run = str(meta.get("extractionRun") or "")
    if not extraction_run:
        raise MissingExtractionRun(
            f"human candidate {rec_id!r} names no extractionRun. The pool FILE is the run "
            "and the loader stamps it; deriving one from the stratum would merge rows "
            "written by different executions into one invented run"
        )
    # AFTER every refusal, so a dropped candidate contributes no entry: the index is
    # the evidence for rows that exist, and a registration listed there for a row the
    # corpus does not contain is a claim about nothing.
    if evidence_sink is not None:
        evidence_sink.append(entry)
    rec = {
        "schemaVersion": 4,
        "id": rec_id,
        "text": cand["text"],
        "label": "human",
        "language": "pt-BR",
        "platform": "generic",
        "domain": register,
        "topic": "geral",
        "humanSourceType": register,
        "wordCount": int(cand["wordCount"]),
        # The whole basis of the human label, and the entry it resolves against.
        "labelBasis": "date-cutoff",
        "labelEvidenceRef": ref,
        "provenance": {
            "sourceKind": "licensed-corpus",
            "sourceId": source_id,
            "sourceRevision": "rev_001",
            "licenseId": license_id,
            "legalBasis": "license",
        },
        # The candidate is passed so the filters the EXTRACTOR ran travel with the
        # row instead of being asserted here.
        "review": review_state(cand),
        "transformation": {"kind": "none", "severity": "none"},
        "groups": {
            # From the SOURCE, via the extractor. `author` is `known` (HMAC
            # pseudonym), `notApplicable` (Wikipedia has no single author, Carolina
            # headers are never read) or `unknown` (deleted account) — the extractor
            # decides, because it is the only layer that saw the row.
            "author": axes.get("author")
            or group_axes.unknown(
                "the candidate pool predates the extractors that emit an author axis"
            ),
            "source": axes.get("source")
            or group_axes.unknown(
                "the candidate pool predates the extractors that emit a source axis"
            ),
            "domainSource": group_axes.known(
                group_axes.axis_token(cand["domainSource"])
            ),
            # A human row seeds generations; it is not itself seeded by one, and it
            # derives from nothing. Both are statements, and neither costs the row.
            "humanSeed": group_axes.not_applicable(
                "the record IS the human text: it is a seed, not something seeded"
            ),
            "promptTemplate": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            "generatorFamily": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            "generatorVersion": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            "generationLane": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            "harnessVersion": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            # The ACQUISITION EVENT the material came from: the unit of dependence
            # between acquisitions, declared in the reviewed manifest's
            # `materialBatches` and resolved against it by
            # `assertMaterialBatchesResolve`. Re-extracting the same dump does NOT
            # produce a new one, which is why the run below is a separate axis.
            "sourceMaterialBatch": group_axes.known(
                group_axes.axis_token(material_batch)
            ),
            # A human row can no longer name a generation batch at all: the rule admits
            # only `notApplicable` here, so the non-collision the dead corpus bought with
            # an `extraction_` prefix is now structural.
            "generationBatch": group_axes.not_applicable(
                group_axes.NOT_A_GENERATED_ROW
            ),
            # The EXTRACTION RUN that wrote the row: a real execution shared by every
            # candidate of one pool file, not a per-record token. Diagnostic — it names
            # no dependence, and it exists so a defect traces back to the run.
            "extractionRun": group_axes.known(
                group_axes.axis_token(extraction_run)
            ),
            "nearDuplicate": near_duplicate_axis(rec_id),
            "derivationRoot": group_axes.not_applicable(
                "the record is an extracted source text, derived from nothing in "
                "this corpus"
            ),
        },
    }
    if hard_neg is not None:
        rec["hardNegativeFamily"] = hard_neg
    return rec


def ai_record(cand: dict) -> dict:
    meta = cand.get("meta") or {}
    rec_id = slug(cand.get("candidateId") or cand["id"])
    family_raw = meta.get("family") or cand.get("family") or "unknown"
    lane = lane_of(str(meta.get("provider") or ""), meta.get("generationLane"))
    # The governance audit compares generation.promptSha256 against the batch's
    # promptTemplateDigest, so the record carries the TEMPLATE digest (shared by
    # every record of a recipe) rather than the per-record full-prompt digest, which
    # would force one declared batch per record. The instance stays identifiable
    # through promptId.
    template_digest = meta.get("promptTemplateDigest") or meta.get("promptSha256")
    if not template_digest:
        raise MissingRecipe(
            f"candidate {rec_id!r} records no prompt template digest, so its "
            "promptTemplate axis has no identity. v2 accepted such a row by keying "
            "a fallback on the family name; v3 requires the axis to be known, and a "
            "digest we invent is a cluster nobody can verify"
        )
    recipe = meta.get("recipe")
    prompt_id = slug(meta.get("promptId") or f"repro_{rec_id}")
    parent = meta.get("pairedWith") or parent_of_prompt(str(meta.get("promptId") or ""))
    model = str(meta.get("model") or family_raw)
    version = str(meta.get("version") or family_raw)
    axes = generation_axes(lane, str(family_raw), version, recipe, template_digest, meta)
    rec = {
        "schemaVersion": 4,
        "id": rec_id,
        "text": cand["text"],
        "label": "ai",
        "language": "pt-BR",
        "platform": "generic",
        "domain": "geral",
        "topic": "geral",
        "wordCount": int(cand["wordCount"]),
        "provenance": {
            "sourceKind": "controlled-generation",
            "sourceId": "src_ai",
            "sourceRevision": "rev_001",
            "licenseId": GENERATED_LICENSE,
            "legalBasis": "generated",
        },
        "review": review_state(),
        "generation": {
            "provider": str(meta.get("provider") or "reserved"),
            "family": str(family_raw),
            "model": model,
            "version": version,
            "promptId": prompt_id,
            "promptSha256": str(meta.get("promptSha256") or template_digest),
            "promptTemplateDigest": str(template_digest),
            "decoding": decoding_config(lane, meta),
            "effort": effort_config(lane, meta),
            **seed_pair(meta),
        },
        "transformation": {"kind": "none", "severity": "none"},
        "groups": {
            # Generated text has no human author and comes from no origin document,
            # and both of those are facts rather than gaps. The v2 fixtures wrote
            # `author: "author_gen_001"` on generated rows — a person-shaped token
            # for a row with no person.
            "author": group_axes.not_applicable(group_axes.NO_HUMAN_AUTHOR),
            "source": group_axes.not_applicable(
                "generated text has no origin document: its input was a prompt, "
                "which is groups.promptTemplate, and a seed, which is groups.humanSeed"
            ),
            "domainSource": group_axes.known(
                group_axes.axis_token(str(cand.get("domainSource") or f"ai_{lane}"))
            ),
            "humanSeed": (
                group_axes.known(group_axes.axis_token(str(parent)))
                if parent
                else group_axes.not_applicable(
                    "the recipe answered a bare topic prompt with no human parent"
                )
            ),
            **axes,
            "sourceMaterialBatch": group_axes.not_applicable(
                group_axes.NO_MATERIAL_ACQUIRED
            ),
            # Filled by assign_generation_batches once every record knows its
            # temporal block, because generatedAt is part of the batch key.
            "generationBatch": group_axes.unknown(
                "the generation batch is derived after partitioning"
            ),
            "extractionRun": group_axes.not_applicable(group_axes.NOT_EXTRACTED),
            "nearDuplicate": near_duplicate_axis(rec_id),
            "derivationRoot": (
                group_axes.known(group_axes.axis_token(str(parent)))
                if parent and recipe in REWRITING_RECIPES
                else group_axes.not_applicable(group_axes.NO_DERIVATION)
            ),
        },
    }
    return rec


def mixed_record(cand: dict) -> dict:
    parent = slug(cand["parentId"])
    rec_id = f"mix_{parent}"
    text = cand["text"]
    spans = cand["mixture"]["spans"]
    total = len(text)
    ai_chars = sum(s["end"] - s["start"] for s in spans if s["origin"] == "ai")
    ai_fraction = ai_chars / total if total else 0.0
    model = str(cand.get("model") or "unknown")
    lane = lane_of(str(cand.get("provider") or ""), cand.get("generationLane"))
    template_digest = cand.get("promptTemplateDigest")
    if not template_digest:
        raise MissingRecipe(
            f"mixed row {rec_id!r} records no mixing template digest. The template "
            "that produced it is not recoverable from the row, and taking whichever "
            "template make_mixed.py holds today would attach a recipe this row "
            "cannot support — the pool was written before the digest was persisted"
        )
    recipe = str(cand.get("promptTemplateId") or "mixed")
    # `domainSource` must be `known` in EVERY class: the stratum a row is counted
    # under is decided by our own extraction, so `unknown` there is a defect in a
    # pipeline we control rather than an unrecoverable gap in the world (schema.ts
    # AXIS_STATE_RULE says exactly that). `make_mixed.emit` writes "?" when the parent
    # row carried no family, and "?" normalises to nothing — so it is refused HERE with
    # a message naming the cause, instead of surfacing as a bare ValueError out of
    # axis_token halfway through an assembly.
    parent_family = str(cand.get("parentFamily") or "")
    if not parent_family or parent_family == "?":
        raise MissingRecipe(
            f"mixed row {rec_id!r} names no parent family (parentFamily="
            f"{cand.get('parentFamily')!r}), so it has no domainSource stratum to be "
            "counted under. The parent's family is on the parent row; re-emit the pair "
            "from a parents file that carries it"
        )
    # A mechanistic mixed row IS a human text with generated stretches, so the material
    # it depends on is the PARENT's material — and the axis rule admits only `known`
    # here, so there is no eligibility-priced escape. The pair row carries the parent's
    # batch; a value derived here would claim an acquisition event this row never had.
    material_batch = str(cand.get("sourceMaterialBatch") or "")
    if not material_batch:
        raise MissingMaterialBatch(
            f"mixed row {rec_id!r} names no sourceMaterialBatch. The material is the "
            "parent's, so the pair file has to carry the parent's batch; the parent id "
            "alone does not resolve an acquisition event at assembly time"
        )
    rec = {
        "schemaVersion": 4,
        "id": rec_id,
        "text": text,
        "label": "mixed",
        "language": "pt-BR",
        "platform": "generic",
        "domain": "geral",
        "topic": "geral",
        "wordCount": len(text.split()),
        "provenance": {
            "sourceKind": "controlled-generation",
            "sourceId": "src_mixed",
            "sourceRevision": "rev_001",
            "licenseId": GENERATED_LICENSE,
            "legalBasis": "generated",
        },
        "review": review_state(),
        "mixture": {
            "aiFraction": ai_fraction,
            "humanFraction": 1.0 - ai_fraction,
            "spans": [
                {"start": int(s["start"]), "end": int(s["end"]), "origin": s["origin"]}
                for s in spans
            ],
            # A FACT here and not a default: make_mixed.py chose and executed the
            # edits, so the provenance of every span is known while the coauthorship
            # distribution is ours. "ecological" would claim an observed writing
            # process this lane never watched, and this assembler must never write
            # it (R4).
            "generationMode": MECHANISTIC_GENERATION_MODE,
        },
        # The AI spans ARE controlled generation, and a mechanistic mixed row's
        # recipe is ours, so the schema requires it on the row.
        "generation": {
            "provider": str(cand.get("provider") or "reserved"),
            "family": model,
            "model": model,
            "version": model,
            "promptId": slug(f"{recipe}_{parent}"),
            "promptSha256": str(template_digest),
            "promptTemplateDigest": str(template_digest),
            "decoding": decoding_config(lane, cand),
            "effort": effort_config(lane, cand),
            **seed_pair(cand),
        },
        "transformation": {"kind": "human-ai-mix", "severity": "medium"},
        "groups": {
            # A mixed row IS a human text with generated stretches, so its human
            # author and origin document are real. The pools do not carry them (the
            # pairs files record only the parent id), so they are `unknown` and
            # inherited from the parent by C3 rather than fabricated here.
            "author": group_axes.unknown(
                "the mixing pools record only the parent id; the parent's author "
                "axis is resolved through groups.derivationRoot, not copied here"
            ),
            "source": group_axes.unknown(
                "the mixing pools record only the parent id; the parent's origin "
                "document is resolved through groups.derivationRoot"
            ),
            "domainSource": group_axes.known(group_axes.axis_token(parent_family)),
            # BOTH known, and both the same row: a mechanistic mixed record is built
            # by editing one specific human text, so that text is its seed AND the
            # thing it derives from. This is the lineage requirement 5 asks for, and
            # it is what keeps the whole seed -> generation -> derivative tree in one
            # partition once C3/E2 impose it.
            "humanSeed": group_axes.known(parent),
            "derivationRoot": group_axes.known(parent),
            **generation_axes(lane, model, model, recipe, str(template_digest), cand),
            "sourceMaterialBatch": group_axes.known(
                group_axes.axis_token(material_batch)
            ),
            "generationBatch": group_axes.unknown(
                "the generation batch is derived after partitioning"
            ),
            # No extractor read this row out of a source document: it was written by
            # editing a parent row that an extractor had already produced.
            "extractionRun": group_axes.not_applicable(group_axes.NOT_EXTRACTED),
            "nearDuplicate": near_duplicate_axis(rec_id),
        },
    }
    return rec


# recordId -> the partition its block time places it in. A SIDE map and not a field:
# the record's key set is closed and `partition` is not one of its keys, and the
# partition is a DERIVED fact (which block `createdAt` falls in) that would become a
# second copy able to disagree with the timestamp if it were stored on the record.
PARTITION_OF: dict[str, str] = {}


def stamp_block(rec: dict, partition: str) -> dict:
    """Fills every *At timestamp with the partition's block time."""
    PARTITION_OF[rec["id"]] = partition
    t = BLOCK_TIME[partition]
    rec["createdAt"] = t
    rec["provenance"]["collectedAt"] = t
    if "generation" in rec:
        rec["generation"]["generatedAt"] = t
    return rec


def thin_held_out_families(
    records: list[dict], held_out: set[str], minimum: int = HELD_OUT_MINIMUM
) -> dict[str, int]:
    """Declared held-out families the WRITTEN corpus does not actually stock.

    Counts `groups.generatorFamily` — the SAME canonical field `held_out` is built
    from. It used to count `generation.family`, the provider's own dotted label
    (`gemini-3.5-flash-low`), and test membership in a set of canonical underscored
    tokens (`gemini-3_5-flash-low`): a comparison that could not match whatever the
    counts were, so this warning was silent by construction. Same defect class as
    the `generatorExposure` slice and the splitter's held-out mark (A4).

    It also iterates `held_out` rather than the Counter's keys, so a family that is
    declared unseen and stocked by NO record at all is reported as 0 instead of
    vanishing from the report — that is the worst case for a held-out claim, not an
    absence of one.

    Same QUESTION as `below_floor` in main(), asked at the other end: that one asks
    it of the declaration candidates, this one of the records actually written, after
    partitioning. So it has to count the same thing — POSITIVES (`ai` + `mixed`),
    which is what `validate` puts the 200-record floor on
    (DATASET_COVERAGE_INVALID). Counting record-lines of any label instead would give
    the two sides different denominators while the docstring claimed they agree, and
    a family padded to the floor by rows that are not positives would pass here and
    be refused by `validate`. The value of asking twice is catching a later edit that
    prunes records after the declaration loop, or relaxes the floor.
    """
    # `identity_of` and not a bare read: since C2 an axis is an object carrying a
    # state, and `.get("generatorFamily")` would compare a dict against a set of
    # strings and silently match nothing — the same defect class A4 fixed here, in a
    # new spelling. It reads the v2 string shape too, so this counter still works
    # against a v2 corpus on disk.
    written = Counter(
        group_axes.identity_of((r.get("groups") or {}).get("generatorFamily"))
        for r in records
        if r.get("label") in ("ai", "mixed")
    )
    return {f: written[f] for f in sorted(held_out) if written[f] < minimum}


class UnsplittableCorpus(RuntimeError):
    """A stamped corpus the connected splitter cannot honor."""


# The two union relations of `connectedComponentRoots` (benchmark/split.ts), mirrored.
# They are DIFFERENT relations and the distinction is the whole point:
#
#   * SHARED VALUE (`GROUP_KEYS`): two record-lines carrying the same identity here are
#     always one component. `generatorFamily` is deliberately NOT in this list — unioning
#     on it would collapse a whole family into one indivisible block.
#   * PARENT LINKAGE (`PARENT_LINKAGE_AXES`): a record-line whose identity NAMES ANOTHER
#     record-line's id joins that row, and only when the named row is present. Naming
#     itself unions nothing.
#
# `domainSource` and `sourceMaterialBatch` are absent, and that is arithmetic rather than
# taste: there is ONE acquisition event per source and one stratum per quota cell, so
# either axis unions a whole cell into a single indivisible component — human partition
# fractions in multiples of ~25%, `dev`'s 0.05 unreachable, and a unit floor counted in
# components reading 1 per cell forever. Both stay axes of REGISTRATION, MANIFEST and
# LEDGER, and `extractionRun` never unions at all: re-extracting one dump produces no new
# material, so unioning on it would count one dependence twice.
#
# Both lists are a COPY of the ones benchmark/split.ts declares, and a copy that drifts accepts
# an axis the splitter unions on or refuses one it ignores.
SPLIT_GROUP_KEYS: tuple[str, ...] = (
    "author",
    "source",
    "generatorVersion",
    "promptTemplate",
    "generationBatch",
    "nearDuplicate",
    "derivationRoot",
)

SPLIT_PARENT_LINKAGE_AXES: tuple[str, ...] = ("derivationRoot", "humanSeed")


def connected_components(records: list[dict]) -> dict[str, str]:
    """Every record id -> its component root, by the splitter's own two relations.

    Union-find with transitive closure, because a chain seed -> generation -> derivative is
    ONE component even though no single axis links its ends.
    """
    parent: dict[str, str] = {rec["id"]: rec["id"] for rec in records}

    def find(x: str) -> str:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a: str, b: str) -> None:
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[rb] = ra

    for axis in SPLIT_GROUP_KEYS:
        first_by_value: dict[str, str] = {}
        for rec in records:
            identity = group_axes.identity_of((rec.get("groups") or {}).get(axis))
            if identity is None:
                continue
            seen = first_by_value.get(identity)
            if seen is None:
                first_by_value[identity] = rec["id"]
            else:
                union(seen, rec["id"])

    ids = {rec["id"] for rec in records}
    for rec in records:
        for axis in SPLIT_PARENT_LINKAGE_AXES:
            named = group_axes.identity_of((rec.get("groups") or {}).get(axis))
            if named is not None and named != rec["id"] and named in ids:
                union(rec["id"], named)

    return {rec["id"]: find(rec["id"]) for rec in records}


def declared_group_axes(corpo_injetado: str | None = None) -> dict[str, tuple[str, ...]]:
    """`provenance.sourceId` -> the axes that source DECLARED applicable.

    Read from `benchmark/source-manifest.ts`, the same frozen inventory the audit joins
    against, instead of restated here: a second spelling of the join would let this side
    accept an axis the audit refuses.
    """
    if corpo_injetado is not None:
        # Só os testes injetam. Existe porque provar que o parse falha fechado exige um corpo
        # malformado, e um teste que apenas chama a função contra o arquivo atual não prova nada.
        fonte = corpo_injetado
    else:
        fonte = (
            Path(__file__).resolve().parent.parent / "source-manifest.ts"
        ).read_text(encoding="utf-8")
    # SOMENTE o corpo de `V3_HUMAN_SOURCE_INVENTORY`, que e a autoridade que a auditoria
    # usa. Varrer o arquivo inteiro colhe tambem `A1_BLOCKED_HUMAN_SOURCES` — foi medido
    # trazendo `src_ptso`, que esta BLOQUEADO — e uma autoridade com fonte a mais aceita
    # linha que a auditoria recusa.
    marcador = "export const V3_HUMAN_SOURCE_INVENTORY"
    if marcador not in fonte:
        raise RuntimeError(
            "source-manifest.ts nao expoe V3_HUMAN_SOURCE_INVENTORY: espelho nao pode "
            "adivinhar a autoridade"
        )
    corpo = fonte.split(marcador, 1)[1]
    fim = corpo.find(chr(10) + "];")
    if fim == -1:
        raise RuntimeError(
            "V3_HUMAN_SOURCE_INVENTORY nao termina em ']' reconhecivel: parse incompleto"
        )
    corpo = corpo[:fim]

    por_fonte: dict[str, tuple[str, ...]] = {}
    for source_id, _meio, eixos in re.findall(
        r'sourceId:\s*"([^"]+)"(.*?)declaredGroupAxes:\s*\[([^\]]*)\]',
        corpo,
        re.S,
    ):
        if source_id in por_fonte:
            raise RuntimeError(
                f"{source_id} aparece duas vezes no inventario: espelho ambiguo"
            )
        por_fonte[source_id] = tuple(re.findall(r'"([a-zA-Z]+)"', eixos))

    # CONSUMO COMPLETO, nao "pelo menos uma". Uma entrada malformada faz a regex saltar
    # sobre ela e o mapa volta MENOR, silenciosamente — e um mapa com fonte a menos deixa
    # de recusar linha que a auditoria recusa. Contar os `sourceId` do corpo e exigir
    # igualdade e o que transforma parse parcial em falha.
    declarados = re.findall(r'sourceId:\s*"([^"]+)"', corpo)
    if len(declarados) != len(por_fonte):
        faltando = sorted(set(declarados) - set(por_fonte))
        raise RuntimeError(
            f"inventario tem {len(declarados)} sourceId e o espelho extraiu "
            f"{len(por_fonte)}: parse parcial, faltando {faltando}"
        )
    if not por_fonte:
        raise RuntimeError("nenhuma fonte extraida do inventario: parse falhou fechado")
    return por_fonte


def realized_blocks(records: list[dict]) -> dict[str, str]:
    """Each record id -> the block the SPLITTER will actually place it in.

    A component whose record-lines all carry one stamp keeps that block. One that straddles
    falls through to `train`, because the splitter places a component only when its WHOLE
    time range fits inside a band and `train` is its fallback. So the stamps are a proposal,
    and this is what the proposal becomes.
    """
    roots = connected_components(records)
    block_of_root: dict[str, str] = {}
    for rec in records:
        block = PARTITION_OF.get(rec["id"])
        if block is None:
            continue
        root = roots[rec["id"]]
        seen = block_of_root.get(root)
        if seen is None:
            block_of_root[root] = block
        elif seen != block:
            block_of_root[root] = "train"
    return {
        rec["id"]: block_of_root[roots[rec["id"]]]
        for rec in records
        if rec["id"] in PARTITION_OF
    }


# As cinco frações-alvo do desenho de cinco partições. `CLASS_FRACTIONS` declara quatro e `test`
# é o resto, então a lista abaixo não pode ser escrita à mão: um alvo a menos aqui aceitaria
# corpo que o splitter recusa.
FIVE_TARGETS: tuple[float, ...] = (
    *CLASS_FRACTIONS.values(),
    round(1.0 - sum(CLASS_FRACTIONS.values()), 10),
)


# O escopo agregado, ao lado de cada classe, e a ORDEM em que os dois são checados.
# Espelham `CORPUS_SCOPE` e `LABEL_REPORT_ORDER` de benchmark/viability-preflight.ts: a guarda
# e o preflight do benchmark recusam pela MESMA condição no MESMO escopo, e o catálogo de
# corpos compartilhado (em `benchmark/tests/fixtures/`, lido pelos dois lados) afirma isso das
# duas pontas. Uma ordem diferente aqui faria os dois discordarem sobre QUAL condição recusa.
CORPUS_SCOPE = "corpus"
LABEL_REPORT_ORDER: tuple[str, ...] = ("human", "ai", "mixed")


def component_fractions_by_scope(
    records: list[dict],
) -> list[tuple[str, int, list[float]]]:
    """(escopo, denominador, frações crescentes) — o corpo, e depois cada classe presente.

    A fração de uma classe é sobre o TOTAL DA CLASSE, que é o denominador que o splitter
    divide por (`classTotals` em benchmark/split.ts), e conta só os componentes que têm linha
    dessa classe: um componente sem linha da classe não contribui e pode ir a qualquer
    partição, então incluí-lo como zero inventaria uma granularidade que não existe.
    """
    raizes = connected_components(records)
    por_escopo: dict[str, dict[str, int]] = {CORPUS_SCOPE: {}}
    for rec in records:
        raiz = raizes[rec["id"]]
        agregado = por_escopo[CORPUS_SCOPE]
        agregado[raiz] = agregado.get(raiz, 0) + 1
        classe = rec["label"]
        if classe not in LABEL_REPORT_ORDER:
            raise UnsplittableCorpus(
                f"registro {rec['id']} tem classe {classe!r}, fora do vocabulário "
                f"{LABEL_REPORT_ORDER}: sem escopo declarado a fração dela não seria checada"
            )
        da_classe = por_escopo.setdefault(classe, {})
        da_classe[raiz] = da_classe.get(raiz, 0) + 1
    ordem = (CORPUS_SCOPE, *LABEL_REPORT_ORDER)
    saida: list[tuple[str, int, list[float]]] = []
    for escopo in sorted(por_escopo, key=ordem.index):
        tamanhos = por_escopo[escopo]
        total = sum(tamanhos.values())
        saida.append((escopo, total, sorted(n / total for n in tamanhos.values())))
    return saida


def assert_components_can_fill_five_partitions(records: list[dict]) -> None:
    """PREFLIGHT: recusa antes da montagem um corpo cujos componentes não podem realizar 45/5/10/20/20.

    O splitter põe o componente conexo INTEIRO numa única partição E compara fração POR CLASSE
    (uma linha de cinco alvos por classe presente, sobre o total daquela classe). Dos dois fatos
    saem duas condições NECESSÁRIAS, e elas valem em TODO escopo — o corpo agregado e cada
    classe:

    1. **Todo componente cabe em alguma partição.** Um componente que vale, num escopo, mais que
       o maior alvo mais a tolerância não tem onde ser posto inteiro.
    2. **Toda partição pode ser preenchida.** Todo alvo excede a tolerância, então toda partição
       tem de receber fração NÃO NULA de todo escopo, e qualquer conjunto de componentes que
       realize o MENOR alvo inclui pelo menos um componente que carrega aquele escopo. Logo o que
       limita é a menor contribuição NÃO NULA, não a maior.

    O ESCOPO DO CORPO não é duplicata dos escopos de classe, nas duas direções: a fração agregada
    de uma partição é a combinação convexa das frações por classe, então ela cai na mesma faixa de
    tolerância e a condição agregada é necessária; mas um corpo cujos componentes são todos
    grossos no agregado, tendo cada classe um componente fino, satisfaz todas as condições por
    classe e ainda assim não preenche a menor partição. Na direção contrária — a caro — uma
    metade gerada fina derruba toda fração agregada, então uma metade humana degenerada em um
    componente por célula passa por um teste só agregado. Num corpo mono-classe os dois escopos
    são a MESMA comparação, e a recusa nomeia os dois.

    | o que este preflight decide            | o que ele NÃO decide                              |
    |----------------------------------------|---------------------------------------------------|
    | as duas condições necessárias acima,   | se existe atribuição completa dos componentes     |
    | no corpo e em cada classe              | às cinco partições — isso é soma de subconjuntos, |
    |                                        | e passar aqui não é garantia de viabilidade       |
    | granularidade grosseira demais         | ordenação temporal, precedência de held-out e a   |
    |                                        | realização conjunta das frações por classe, que   |
    |                                        | só um corpo ESTAMPADO determina                   |
    |                                        | (`assert_stamped_corpus_is_splittable`)           |

    Necessária e não suficiente é o que se pode afirmar sem resolver soma de subconjuntos, e
    afirmar mais que isso seria a suposição que a pré-inscrição abandonada fez.
    """
    if not records:
        raise UnsplittableCorpus("corpo vazio: não há componente a distribuir")

    maior_alvo = max(FIVE_TARGETS)
    menor_alvo = min(FIVE_TARGETS)
    limite_max = maior_alvo + CLASS_TOLERANCE + CLASS_TOLERANCE_EPSILON
    limite_min = menor_alvo + CLASS_TOLERANCE + CLASS_TOLERANCE_EPSILON

    for escopo, total, fracoes in component_fractions_by_scope(records):
        menor, maior = fracoes[0], fracoes[-1]
        onde = "do corpo" if escopo == CORPUS_SCOPE else f'da classe "{escopo}"'

        if maior > limite_max:
            raise UnsplittableCorpus(
                f"o maior componente vale {maior:.4f} {onde} ({total} linha(s)) e o maior "
                f"alvo é {maior_alvo:.2f} (±{CLASS_TOLERANCE}): não há partição que o receba "
                f"inteiro. {len(fracoes)} componente(s), frações {fracoes[:8]}"
            )

        if menor > limite_min:
            raise UnsplittableCorpus(
                f"o MENOR componente vale {menor:.4f} {onde} ({total} linha(s)) e o menor "
                f"alvo é {menor_alvo:.2f} (±{CLASS_TOLERANCE}): nenhum subconjunto não vazio "
                f"realiza a menor partição, porque todo subconjunto inclui ao menos um "
                f"componente. Isto é granularidade, não tamanho de corpo: "
                f"{len(fracoes)} componente(s), frações {fracoes[:8]}"
            )


def assert_stamped_corpus_is_splittable(
    records: list[dict],
    held_out: set[str] | None = None,
    declared: dict[str, tuple[str, ...]] | None = None,
) -> None:
    """Refuse a stamped corpus the splitter or the audit would reject.

    Mirrors the audit's failing conditions that a STAMPED corpus already determines, and all
    of them rather than a subset — checking only one dimension refuses corpora the audit
    accepts, or accepts corpora it rejects, depending on which dimension is missing:

    * per-class fractions within `CLASS_TOLERANCE` of the targets, in all five partitions;
    * `test` strictly newer than each of the other four, INCLUDING `train` — `train` is the
      fallback, so a component straddling the last cut lands there carrying test-period text,
      which is real leakage and the fraction check cannot see it;
    * the three middle partitions ordered earliest-against-latest among themselves, with
      `train` excluded because absorbing straddlers legitimately makes its newest record
      exceed a middle partition's;
    * held-out precedence: the splitter seats a reserved family in `test` regardless of time,
      so a reserved component that realizes anywhere else is a constraint failure, not a
      fraction one;
    * no DECLARED group axis left `unknown`: the source states the dependence exists, and an
      axis nobody recovered cannot support the split.

    The audit refuses on five things, and the decision for each is stated rather than implied:

    | condição da auditoria        | aqui           | por quê                                     |
    |------------------------------|----------------|---------------------------------------------|
    | vazamento de grupo           | NÃO espelhado  | `realized_blocks` põe o componente conexo   |
    |                              |                | INTEIRO numa partição, então vazamento é    |
    |                              |                | impossível por construção nesta simulação   |
    | eixo declarado em `unknown`  | espelhado      | decidível dos registros e do inventário     |
    | `test` estritamente mais novo| espelhado      | decidível dos tempos estampados             |
    | meio ordenado                | espelhado      | idem                                        |
    | frações por classe           | espelhado      | idem                                        |

    Mais a precedência da reserva, que é do splitter e não da auditoria.

    A straddling component is not by itself a defect: it lands in `train`, and whether that
    breaks anything depends on its size and on which bands it spans.
    """
    blocks = realized_blocks(records)
    if not blocks:
        return

    problemas: list[str] = []

    targets = dict(CLASS_FRACTIONS)
    targets["test"] = round(1.0 - sum(CLASS_FRACTIONS.values()), 10)

    counts: dict[str, dict[str, int]] = {}
    totals: dict[str, int] = {}
    for rec in records:
        block = blocks.get(rec["id"])
        if block is None:
            continue
        label = rec["label"]
        counts.setdefault(label, {})[block] = counts.setdefault(label, {}).get(block, 0) + 1
        totals[label] = totals.get(label, 0) + 1
    for label in sorted(counts):
        for block, alvo in targets.items():
            obtido = counts[label].get(block, 0) / totals[label]
            if not within_class_tolerance(obtido, alvo):
                problemas.append(
                    f"fracao {label}/{block} realiza {obtido:.4f} contra alvo {alvo}"
                )

    # Stamped times, per REALIZED block. A straddling component keeps the times its
    # record-lines were stamped with, so `train` can end up holding a test-band instant.
    tempos: dict[str, list[int]] = {}
    for rec in records:
        block = blocks.get(rec["id"])
        if block is None:
            continue
        tempos.setdefault(block, []).append(int(rec.get("createdAt", 0)))

    def mais_novo(block: str) -> int | None:
        return max(tempos[block]) if tempos.get(block) else None

    def mais_antigo(block: str) -> int | None:
        return min(tempos[block]) if tempos.get(block) else None

    inicio_test = mais_antigo("test")
    if inicio_test is not None:
        for block in ("train", "dev", "cal-A", "cal-B"):
            fim_bloco = mais_novo(block)
            if fim_bloco is not None and not inicio_test > fim_bloco:
                problemas.append(
                    f"temporal: earliest(test)={inicio_test} nao e estritamente maior que "
                    f"latest({block})={fim_bloco}"
                )

    meio = ("dev", "cal-A", "cal-B")
    for i in range(1, len(meio)):
        anterior, atual = meio[i - 1], meio[i]
        fim_anterior, inicio_atual = mais_novo(anterior), mais_antigo(atual)
        if fim_anterior is None or inicio_atual is None:
            continue
        if not inicio_atual > fim_anterior:
            problemas.append(
                f"temporal: earliest({atual})={inicio_atual} nao e estritamente maior que "
                f"latest({anterior})={fim_anterior}"
            )

    if held_out:
        for rec in records:
            block = blocks.get(rec["id"])
            if block is None or block == "test":
                continue
            familia = group_axes.identity_of(
                (rec.get("groups") or {}).get("generatorFamily")
            )
            if familia in held_out:
                problemas.append(
                    f"reserva: {rec['id']} e da familia reservada {familia} e realiza em "
                    f"{block} em vez de test"
                )

    autoridade = declared_group_axes() if declared is None else declared
    for rec in records:
        if rec["id"] not in blocks:
            continue
        source_id = (rec.get("provenance") or {}).get("sourceId")
        # Uma linha HUMANA que NOMEIA uma fonte fora da autoridade nao tem eixo algum
        # conferido: `get(..., ())` salta o laco inteiro em silencio, entao tirar uma
        # fonte do inventario DESLIGA a checagem de lacuna para as linhas dela em vez de
        # recusa-las. O lado espelhado (corpus-source-audit.ts) recusa; o espelho passaria
        # a aceitar mais que o espelhado. Duas exclusoes, ambas deliberadas: linha gerada
        # (fonte gerada nao tem registro humano e nao declara eixo nenhum por desenho) e
        # linha sem `provenance.sourceId` (nao nomear fonte e outro defeito, e o schema
        # fechado o recusa antes — o corpo estampado dos fixtures do lab e mais frouxo).
        if (
            rec.get("label") == "human"
            and source_id is not None
            and str(source_id) not in autoridade
        ):
            problemas.append(
                f"fonte nao inventariada: {rec['id']} e humana e vem de {source_id}, "
                "que nao esta em V3_HUMAN_SOURCE_INVENTORY — nenhum eixo declarado dela "
                "pode ser conferido"
            )
            continue
        for axis in autoridade.get(str(source_id), ()):  # type: ignore[arg-type]
            # `declared_state_of` e nao `state_of`: a autoridade e parseada do
            # source-manifest.ts, que declara `sourceMaterialBatch` para toda fonte
            # humana, e `state_of` le chave AUSENTE como unknown. Ler elegibilidade aqui
            # recusaria todo corpo v3 por um eixo que a versao dele nao tem — e a
            # auditoria TS, que esta guarda espelha, aceita esse corpo.
            estado = group_axes.declared_state_of(rec, axis)
            if estado == group_axes.UNKNOWN:
                problemas.append(
                    f"eixo declarado: {rec['id']} vem de {source_id}, que declara "
                    f"\"{axis}\" aplicavel, e a linha o deixa unknown"
                )

    if not problemas:
        return

    atravessando = sum(
        1
        for raiz, blocos in _blocos_por_componente(records).items()
        if len(blocos) > 1
    )
    mostra = "; ".join(problemas[:6])
    resto = "" if len(problemas) <= 6 else f" (+{len(problemas) - 6} mais)"
    raise UnsplittableCorpus(
        f"o corpus estampado nao e splitavel: {mostra}{resto}. "
        f"{atravessando} componente(s) conectado(s) atravessam blocos e por isso caem em "
        "train, que e o fallback do splitter."
    )


def _blocos_por_componente(records: list[dict]) -> dict[str, set[str]]:
    roots = connected_components(records)
    por_raiz: dict[str, set[str]] = {}
    for rec in records:
        block = PARTITION_OF.get(rec["id"])
        if block is not None:
            por_raiz.setdefault(roots[rec["id"]], set()).add(block)
    return por_raiz


def assign_partitions(records: list[dict], held_out: set[str]) -> None:
    """Exact 45/5/10/20/20 blocks per class, with held-out families INSIDE the test
    block rather than on top of it.

    The split imposes two constraints at once: a held-out component whose time
    reaches any earlier partition is refused outright, AND the realized class
    fractions must land within classTolerance (0.02) of 45/5/10/20/20. Forcing
    held-out records into test on top of an independent split of the remainder
    satisfies the first and breaks the second — held-out families reach the mixed
    class too (a mixing model is a generator), so 714 held-out mixed records would
    have pushed mixed's test share far past its 20% target and the split would have
    refused the corpus. So size the test block first, seat the held-out records in
    it, and top it up from the rest.

    `test` is sized as the REMAINDER after the four rounded blocks, so the five always
    sum to the class size exactly. That also means test absorbs the rounding error of
    the other four — at 20% with a two-point tolerance there is room for it, and at
    dev's 5% there would not have been.
    """
    # A GEOMETRIA antes do carimbo: um corpo cujos componentes não podem realizar as cinco
    # frações não fica divisível por ser estampado, e a recusa daqui nomeia granularidade — a
    # guarda do corpo estampado, abaixo, só sabe dizer "fração por classe".
    assert_components_can_fill_five_partitions(records)

    by_class: dict[str, list[dict]] = {}
    for rec in records:
        by_class.setdefault(rec["label"], []).append(rec)
    # Temporal order, and `test` last because it is the remainder.
    blocks = ["train", "dev", "cal-A", "cal-B"]
    for label, recs in by_class.items():
        n = len(recs)
        sizes = {block: round(n * CLASS_FRACTIONS[block]) for block in blocks}
        n_test = n - sum(sizes.values())
        forced = [
            r
            for r in recs
            if group_axes.identity_of((r.get("groups") or {}).get("generatorFamily"))
            in held_out
        ]
        forced_ids = {id(r) for r in forced}
        rest = [r for r in recs if id(r) not in forced_ids]
        if len(forced) > n_test:
            print(
                f"!! {label}: {len(forced)} registros held-out nao cabem no bloco "
                f"de teste ({n_test}) — split recusaria por fracao de classe"
            )
        for r in forced:
            stamp_block(r, "test")
        top_up = max(0, n_test - len(forced))
        # One cursor walked in temporal order: test first (it is being topped up),
        # then each earlier block in turn. Written as a walk rather than as a chain of
        # elif thresholds because five hand-written cumulative bounds is where an
        # off-by-one silently starves `dev`, the block with the least room to lose.
        cursor = 0
        for r in rest[:top_up]:
            stamp_block(r, "test")
        cursor = top_up
        for block in blocks:
            for r in rest[cursor : cursor + sizes[block]]:
                stamp_block(r, block)
            cursor += sizes[block]
        # Whatever rounding left over goes to train, the largest block and the one the
        # splitter itself uses as its fallback.
        for r in rest[cursor:]:
            stamp_block(r, "train")

    assert_stamped_corpus_is_splittable(records, held_out)


# --- loading + selection -----------------------------------------------------


def load_humans(cand: Path = CAND) -> list[dict]:
    """Fresh pools + reserved-clean humans, each tagged with its register.

    Only domainSources present in REGISTER are kept (carolina_datasets and
    public-domain are set aside — social-media is B2W-backed now).

    `cand` is a parameter so a RE-EXTRACTION can be assembled without overwriting
    the pools of the failed run: §7 of the plan puts benchmark/data/corpus-build in
    "Descarte", and reading from a fresh directory is how C2 proves the identity
    comes out right end to end without destroying the evidence of the diagnosis."""
    rows: list[dict] = []
    for fname in ("ptso_fresh", "wikipedia_fresh", "carolina_fresh", "b2w_fresh"):
        for r in read_jsonl(cand / f"{fname}.jsonl"):
            if r["domainSource"] in REGISTER:
                # The EXTRACTION RUN this row came out of: a real execution shared by
                # every candidate of one pool file. Stamped by the loader rather than the
                # extractor because the pool FILE is the run, and only the reader knows
                # which file it opened. `sourceMaterialBatch` is deliberately NOT stamped
                # here — the loader knows the file, not the acquisition event, and only
                # the extractor that opened the material can name it.
                meta = r.setdefault("meta", {})
                meta.setdefault("extractionRun", f"extraction_{fname}")
                rows.append(r)
    # reserved-clean humans (never trained, not mixed parents) reuse the same
    # candidate shape; their family field is the domainSource.
    parents = set()
    for f in ("mixed_candidates.jsonl", "mixed_from_pairs.jsonl"):
        for r in read_jsonl(cand / f):
            parents.add(r["parentId"])
    for r in read_jsonl(DATASET / "reserved.jsonl"):
        if r.get("label") == 0 and r["id"] not in parents:
            fam = r.get("family", "?")
            if fam in REGISTER:
                rows.append(
                    {
                        "candidateId": r["id"],
                        "text": r["text"],
                        "wordCount": len(r["text"].split()),
                        "domainSource": fam,
                        # No identity meta: these rows predate the extractors that emit
                        # one, so their author/source axes are `unknown`, they carry no
                        # date evidence and they name no acquisition event.
                        # `human_record` refuses them (MissingLabelEvidence,
                        # MissingMaterialBatch) and main() counts them — a v2 corpus
                        # could take them and a sealed one cannot, which is a real cost
                        # of the reserved pool and not something to fill in by hand.
                        "meta": {"extractionRun": "extraction_reserved"},
                    }
                )
    return rows


def load_ai(cand: Path = CAND) -> list[dict]:
    rows: list[dict] = []
    # ORDER IS THE SELECTION PRIORITY: the pool is truncated at the class quota
    # from the end, so the least reproducible generations come first. The
    # gemini-3.x lanes carry the held-out families, and two of those models have
    # since left the provider's roster — those records can never be regenerated.
    # ai_reserved (madras + luna) is the replaceable bulk, so it absorbs the cut.
    for fname in (
        "ai_fresh_agy",
        "ai_fresh_agy_low",
        "ai_fresh_gemini",
        "ai_fresh_gemini_multi",
        "ai_fresh_codex",
        "ai_fresh_codex_topup",
        "ai_reserved",
    ):
        for r in read_jsonl(cand / f"{fname}.jsonl"):
            # reserved rows lack candidateId/meta; normalize the shape.
            if "candidateId" not in r:
                r = {
                    "candidateId": r["id"],
                    "text": r["text"],
                    "wordCount": r.get("wordCount", len(r["text"].split())),
                    "meta": {"family": r.get("family", "unknown")},
                }
            rows.append(r)
    return rows


def load_mixed(cand: Path = CAND) -> list[dict]:
    rows: list[dict] = []
    for f in ("mixed_candidates.jsonl", "mixed_from_pairs.jsonl"):
        for r in read_jsonl(cand / f):
            rows.append(r)
    return rows


def assign_generation_batches(records: list[dict]) -> list[dict]:
    """Group generated records into declared generation batches, in place.

    The governance audit refuses every controlled-generation record whose
    groups.generationBatch does not name a batch in the reviewed source manifest
    whose declared recipe matches the record's generation block EXACTLY —
    sourceId, provider, family, model, version, prompt digest, temperature,
    generatedAt and seed. So batches are derived FROM the records: one per
    distinct recipe, which makes the match hold by construction.

    This is why the axis cannot be unique per record, as it was: a per-record token
    names no declared batch, and all 5726 generated records of the dead corpus were
    blocked with GENERATION_RECIPE_MISSING. Sharing it is safe for the split even
    though generationBatch is a grouping axis — generatedAt is part of the batch key
    and equals the record's temporal block, so a batch is an indivisible component
    that can never straddle two blocks.

    Human records are untouched here, and no longer by convention: the axis rule admits
    only `notApplicable` for `generationBatch` on a human row, so a human record cannot
    name a declared generation batch at all. Its own two batch axes —
    `sourceMaterialBatch` and `extractionRun` — are assigned by its builder.
    """
    batches: dict[tuple, dict] = {}
    for rec in records:
        generation = rec.get("generation")
        if rec["provenance"]["sourceKind"] != "controlled-generation":
            continue
        if not generation:
            continue
        key = (
            rec["provenance"]["sourceId"],
            generation["provider"],
            generation["family"],
            generation["model"],
            generation["version"],
            generation["promptTemplateDigest"],
            # The DECODING and the EFFORT, canonicalised, are part of the batch key
            # now. In v2 the key carried a bare `temperature`, which could not tell a
            # CLI lane (no sampling knob at all) from an api lane that happened to
            # leave the default in place — so two recipes that differ in what the
            # provider was allowed to do collapsed into one declared batch.
            json.dumps(generation["decoding"], sort_keys=True),
            json.dumps(generation["effort"], sort_keys=True),
            generation["generatedAt"],
            generation.get("seed"),
        )
        batch = batches.get(key)
        if batch is None:
            batch = {
                "batchId": f"gb_{rec['label']}_{len(batches):04d}",
                "sourceId": key[0],
                "generationProtocolVersion": "generation-v1",
                "provider": generation["provider"],
                "family": generation["family"],
                "model": generation["model"],
                "version": generation["version"],
                "promptTemplateDigest": generation["promptTemplateDigest"],
                # Exactly one of temperature / temperatureNullReason, the pair C1
                # closed. This is the arm C1's own comment said "the v3
                # repropagation (C2) is what will emit": on a lane whose frozen row
                # sets `decodingConfigurable: false` there is no temperature to
                # declare, and the batch now SAYS SO instead of publishing the 0.8
                # that generate_ai.py wrote into every provider's meta while
                # invoking three of them with no sampling flag.
                "temperature": recipe_temperature(generation),
                "temperatureNullReason": (
                    None
                    if recipe_temperature(generation) is not None
                    else TEMPERATURE_NULL_REASON
                ),
                "generatedAt": generation["generatedAt"],
                # Exactly one of seed / seedNullReason, per the manifest parser.
                "seed": generation.get("seed"),
                "seedNullReason": (
                    None if generation.get("seed") else SEED_NULL_REASON
                ),
            }
            batches[key] = batch
        # Sharing it across a batch is safe for the split even though generationBatch IS
        # a grouping axis: generatedAt is part of the batch key and equals the record's
        # temporal block, so a batch is an indivisible component that can never straddle
        # two blocks.
        rec["groups"]["generationBatch"] = group_axes.known(batch["batchId"])
    return list(batches.values())


def recipe_temperature(generation: dict) -> float | None:
    """The temperature the recipe APPLIED, or None when none did.

    The Python mirror of `recipeTemperature` in benchmark/schema.ts, and it exists
    for the same reason: a consumer comparing a record against a declared batch is
    asking one question, and the answer lives in a different place depending on
    whether the lane could be configured at all.
    """
    decoding = generation.get("decoding") or {}
    if not decoding.get("configurable"):
        return None
    return decoding.get("temperature")


def enforce_unique_keys(pools: list[tuple[list[dict], str]]) -> int:
    """Make the candidate key unique across ALL pools, in place.

    A candidate id is derived from (provider, parent), so two generation lanes
    asked for the same parent produce DIFFERENT texts under the SAME id —
    sibling lanes only dedupe against their own output file, and two lanes
    appending to one file dedupe against whatever it held when each started.

    The sealed ingest is fail-closed on DUPLICATE_ID, and colliding ids would
    also collapse the per-record group tokens that keep split components
    singleton, so the clash is resolved here rather than costing a full ingest
    run to discover. The suffix is a digest of the record's own text: stable
    across runs, and it keeps both texts instead of discarding hard-won
    generations that are only accidentally named alike.
    """
    seen: set[str] = set()
    renamed = 0
    for rows, field in pools:
        for row in rows:
            key = row[field]
            if key not in seen:
                seen.add(key)
                continue
            _, digest = norm_hash(row["text"])
            candidate = f"{key}_{digest[:8]}"
            suffix = 0
            while candidate in seen:  # digest collision: still must be unique
                suffix += 1
                candidate = f"{key}_{digest[:8]}_{suffix}"
            row[field] = candidate
            seen.add(candidate)
            renamed += 1
    return renamed


def dedup(records: list[dict], text_key, seen: set[str]) -> list[dict]:
    out = []
    for r in records:
        _, h = norm_hash(text_key(r))
        if h in seen:
            continue
        seen.add(h)
        out.append(r)
    return out


def balanced_humans(cands: list[dict], total: int) -> list[dict]:
    by_reg: dict[str, list[dict]] = {}
    for c in cands:
        by_reg.setdefault(REGISTER[c["domainSource"]], []).append(c)
    per = total // len(by_reg)
    chosen: list[dict] = []
    for reg, pool in sorted(by_reg.items()):
        chosen.extend(pool[:per])
    # top up to exactly `total` from the largest pools if rounding left a gap
    idx = 0
    pools = [p for _, p in sorted(by_reg.items())]
    while len(chosen) < total:
        p = pools[idx % len(pools)]
        if len(p) > per:
            extra = p[per + (idx // len(pools))]
            chosen.append(extra)
        idx += 1
        if idx > total * 4:
            break
    return chosen[:total]


def cluster_report_rows(records: list[dict]) -> list[dict]:
    """The projection `group_axes.cluster_report` reads, and the only one.

    `schemaVersion` is IN the projection because `group_axes.axes_of` branches on it:
    without it every v4 row is read against the v3 tuple, so the report publishes
    `collectionBatch` with `{"unknown": n}` and clusters 0, omits the three axes v4
    introduced, and counts every row as ineligible. A named function rather than a
    literal inside `main` so the report the tests exercise is the report the run
    writes — a projection tested only through a hand-written dict is a projection
    nothing checks.
    """
    return [
        {
            "schemaVersion": r["schemaVersion"],
            "id": r["id"],
            "label": r["label"],
            "partition": PARTITION_OF.get(r["id"], "unassigned"),
            "groups": r["groups"],
        }
        for r in records
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument(
        "--sample", type=int, default=0, help="montagem de fumaça: N registros totais"
    )
    parser.add_argument(
        "--candidates-dir",
        type=Path,
        default=CAND,
        help="pools de candidatos a ler (default: benchmark/data/candidates). "
        "Aponte para uma re-extração fresca; NÃO sobrescreva "
        "benchmark/data/corpus-build, que é a evidência da execução reprovada",
    )
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")

    counts = (
        {"human": round(args.sample * 0.4), "ai": round(args.sample * 0.4),
         "mixed": args.sample - 2 * round(args.sample * 0.4)}
        if args.sample
        else dict(TARGET)
    )

    seen: set[str] = set()
    humans = dedup(load_humans(args.candidates_dir), lambda r: r["text"], seen)
    ai = dedup(load_ai(args.candidates_dir), lambda r: r["text"], seen)
    mixed = dedup(load_mixed(args.candidates_dir), lambda r: r["text"], seen)
    print(f"pools (dedup): human={len(humans)} ai={len(ai)} mixed={len(mixed)}")

    # Exact-hash dedup is not enough: ingest refuses EVERY member of a
    # near-duplicate cluster that straddles more than one lineage, and our
    # derivationRoots are unique per record, so a surviving near-dup pair costs
    # us both records. Prune to one representative per cluster, across all three
    # pools at once (a human and its AI paraphrase is exactly the dangerous
    # case). AI is the scarcest class, so it outranks mixed, which outranks the
    # human surplus.
    def key(row: dict) -> str:
        # mixed rows are keyed by parentId (their record id is mix_<parent>);
        # the other pools carry candidateId.
        return row.get("candidateId") or row["parentId"]

    docs = (
        [(key(r), r["text"], 0) for r in ai]
        + [(key(r), r["text"], 1) for r in mixed]
        + [(key(r), r["text"], 2) for r in humans]
    )
    dropped, nd_stats = near_dupes.prune(docs)
    if dropped:
        humans = [r for r in humans if key(r) not in dropped]
        ai = [r for r in ai if key(r) not in dropped]
        mixed = [r for r in mixed if key(r) not in dropped]
    print(f"near-dup prune: {nd_stats}")
    print(f"pools (near-dup): human={len(humans)} ai={len(ai)} mixed={len(mixed)}")

    # Prune what the detector has already SEEN, under a stated contract: exact
    # tokenized content plus Jaccard >= 0.82 over 5-token shingles, against
    # train+dev. That contract is NOT independence between corpus and training set
    # — paraphrase and shared subject matter pass it — and no report may call it
    # that (R7). What it does catch is the overlap pruning WITHIN the corpus cannot
    # see: the human pools re-extract the same upstream sources the training set
    # came from, so a revisited page reappears with small edits and reads as fresh
    # here while the detector has effectively already seen it.
    seen_texts: list[str] = []
    for split in ("train", "dev"):
        seen_texts.extend(r["text"] for r in read_jsonl(DATASET / f"{split}.jsonl"))
    if seen_texts:
        contaminated, seen_stats = near_dupes.drop_seen(
            [(key(r), r["text"]) for r in humans + ai + mixed], seen_texts
        )
        if contaminated:
            humans = [r for r in humans if key(r) not in contaminated]
            ai = [r for r in ai if key(r) not in contaminated]
            mixed = [r for r in mixed if key(r) not in contaminated]
        print(f"vazamento vs train+dev: {seen_stats}")

    renamed = enforce_unique_keys(
        [(ai, "candidateId"), (mixed, "parentId"), (humans, "candidateId")]
    )
    if renamed:
        print(f"ids desambiguados (colisao entre lanes): {renamed}")

    # Within the reproducibility order, push records whose topic seed is already
    # taken to the END, so the quota truncation drops them FIRST. Two lanes asked
    # for the same human parent (sibling lanes only dedupe against their own
    # output), which repeats a topic inside the AI class without repeating text
    # — measured jaccard median 0.048, max 0.430, far under the 0.82 refusal bar.
    # They are kept while the class is short and displaced as soon as it is not.
    seen_parents: set[str] = set()
    unique_parent, repeat_parent = [], []
    for row in ai:
        parent = (row.get("meta") or {}).get("pairedWith")
        if parent and parent in seen_parents:
            repeat_parent.append(row)
            continue
        if parent:
            seen_parents.add(parent)
        unique_parent.append(row)
    if repeat_parent:
        print(f"pais de topico reusados (descartados primeiro): {len(repeat_parent)}")
    ai = unique_parent + repeat_parent

    human_sel = balanced_humans(humans, counts["human"])
    ai_sel = ai[: counts["ai"]]
    mixed_sel = mixed[: counts["mixed"]]

    # Every builder can REFUSE a row now, and a refusal is counted rather than
    # swallowed or worked around. This is where the v2 corpus's hidden debt becomes
    # visible: v2 accepted a generated row with no lane, no template digest and no
    # effort, and a human row with no date evidence, because it asked for none of
    # them. v3 asks, so those rows leave — and the count below is the honest size of
    # what has to be re-extracted or regenerated, which is exactly the number a
    # `?? 0`-style substitution would have hidden.
    evidence_entries: list[dict] = []
    refused: Counter = Counter()
    refused_examples: dict[str, str] = {}

    def build(rows: list[dict], make) -> list[dict]:
        out: list[dict] = []
        for row in rows:
            try:
                out.append(make(row))
            except UnwritableInV3 as error:
                reason = type(error).__name__
                refused[reason] += 1
                refused_examples.setdefault(reason, str(error))
        return out

    records = build(
        human_sel,
        lambda c: human_record(
            c, REGISTER[c["domainSource"]], None, evidence_sink=evidence_entries
        ),
    )
    records += build(ai_sel, ai_record)
    records += build(mixed_sel, mixed_record)
    if refused:
        print("!! registros que a v3 nao consegue expressar (descartados):")
        for reason, count in sorted(refused.items()):
            print(f"   {reason}: {count} — ex.: {refused_examples[reason][:160]}")

    # Hard-negative tagging: ensure every required family present on >=1 human.
    by_reg_recs: dict[str, list[dict]] = {}
    for r in records:
        if r["label"] == "human":
            by_reg_recs.setdefault(r["humanSourceType"], []).append(r)
    tag_per = max(1, counts["human"] // 200)
    tagged: set[int] = set()
    for fam in HARD_NEGATIVE_FAMILIES:
        pool = by_reg_recs.get(HN_REGISTER[fam], [])
        picked = 0
        for r in pool:
            if id(r) in tagged or "hardNegativeFamily" in r:
                continue
            r["hardNegativeFamily"] = fam
            tagged.add(id(r))
            picked += 1
            if picked >= tag_per:
                break

    # Held-out candidates: the gemini-3.x generators. validate enforces >= 200
    # positives per DECLARED held-out family (DATASET_COVERAGE_INVALID), so a
    # thin family must NOT be declared — it stays an ordinary AI family instead
    # of making the whole release corpus unvalidatable.
    # Declaring a held-out family is squeezed from two sides. validate demands
    # >= 200 positives per DECLARED family, while the split demands every record
    # of one sit after the test cut — so a family only fits if its records fit
    # in what is left of each class's test block, or the class fraction blows
    # past classTolerance and the split refuses the corpus. Mixing models count
    # as generators, so gemini-3.x reaches the mixed class in bulk: declaring
    # every eligible family needed 1170 of mixed's 1000 test slots.
    # Declare richest-in-AI-mass first (that mass is what a generalization claim
    # rests on) and stop when the next family would not fit.
    per_family: dict[str, Counter] = {}
    for r in records:
        family = group_axes.identity_of(r["groups"].get("generatorFamily"))
        if family and r["label"] in ("ai", "mixed"):
            per_family.setdefault(family, Counter())[r["label"]] += 1
    positives = {f: sum(c.values()) for f, c in per_family.items()}
    class_size = Counter(r["label"] for r in records)
    # The SAME arithmetic `assign_partitions` uses, so the two cannot disagree about how
    # much room the blind block has: test is the remainder after the four rounded blocks.
    # A second, independently written copy of this sum would let a family be declared
    # held-out with no room to hold it.
    test_capacity = {
        lab: n - sum(round(n * CLASS_FRACTIONS[b]) for b in CLASS_FRACTIONS)
        for lab, n in class_size.items()
    }

    eligible = sorted(
        (
            f
            for f in per_family
            if f.startswith("gemini-3") and f not in HELD_OUT_INELIGIBLE
        ),
        key=lambda f: (-per_family[f]["ai"], -positives[f], f),
    )
    withheld = {
        f: positives[f] for f in per_family if f in HELD_OUT_INELIGIBLE
    }
    if withheld:
        print(f"!! nao declaradas held-out (vistas no treino via alias): {withheld}")
    below_floor = {f: positives[f] for f in eligible if positives[f] < HELD_OUT_MINIMUM}
    held_out: set[str] = set()
    used: Counter = Counter()
    declined: dict[str, dict] = {}
    for family in eligible:
        if positives[family] < HELD_OUT_MINIMUM:
            continue
        need = per_family[family]
        if all(used[lab] + need[lab] <= test_capacity.get(lab, 0) for lab in need):
            held_out.add(family)
            used.update(need)
        else:
            declined[family] = dict(need)
    if below_floor:
        print(
            f"!! nao declaradas held-out (<{HELD_OUT_MINIMUM} positivos, "
            f"validate exige): {below_floor}"
        )
    if declined:
        print(f"!! nao declaradas held-out (bloco de teste cheio): {declined}")
    assign_partitions(records, held_out)
    # AFTER partitioning: generatedAt is part of the batch key, so batches can
    # only be derived once each record knows its temporal block.
    batches = assign_generation_batches(records)

    # Governance inputs for build_governance.ts.
    sources = {
        "src_ptso": ("licensed-corpus", "cc-by-sa-4.0"),
        "src_wikipedia_pt": ("licensed-corpus", "cc-by-sa-4.0"),
        "src_carolina": ("licensed-corpus", "cc-by-nc-sa-4.0"),
        "src_b2w": ("licensed-corpus", "cc-by-nc-sa-4.0"),
        "src_ai": ("controlled-generation", GENERATED_LICENSE),
        "src_mixed": ("controlled-generation", GENERATED_LICENSE),
    }
    used_sources = {r["provenance"]["sourceId"] for r in records}
    governance = {
        # The live corpus identity, spelled once. `ptbr-generic-v1` is refused BY NAME by
        # `ingestAuthorizedRecords` (`dataset.refusedIds` in the pre-registration), so a
        # producer that still wrote it would build a corpus the importer cannot accept.
        "datasetId": "cleanfeed-ptbr-cells-v1",
        "sources": [
            {"sourceId": sid, "sourceType": sources[sid][0], "licenseId": sources[sid][1]}
            for sid in sorted(used_sources)
        ],
        "heldOutGeneratorFamilies": sorted(held_out) or ["gemini-3_5-flash-lite"],
        "generationBatches": batches,
        "licenses": [
            {"id": "cc-by-sa-4.0", "name": "CC BY-SA 4.0",
             "url": "https://creativecommons.org/licenses/by-sa/4.0/"},
            {"id": "cc-by-nc-sa-4.0", "name": "CC BY-NC-SA 4.0",
             "url": "https://creativecommons.org/licenses/by-nc-sa/4.0/"},
            {"id": GENERATED_LICENSE, "name": "Geracao propria (nao comercial)",
             "url": "https://cleanfeed.local/license/geracao-propria-v1"},
        ],
    }

    # THE CLUSTER DISTRIBUTION REPORT (requirement 7). Counts, size distribution and
    # the largest cluster per axis AND per slice, over the records actually written.
    # It feeds E3's power gate, and it is what makes the old per-record token
    # impossible to reintroduce unnoticed: under `base_groups` every axis would read
    # `clusters == records`, `sizeDistribution == {"1": n}` and largest size 1 —
    # which is what this report would have said all along, had anyone asked it.
    report = group_axes.cluster_report(cluster_report_rows(records))

    out = args.out_dir
    (out / "private").mkdir(parents=True, exist_ok=True)
    (out / "cluster-report.json").write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    # The private evidence index every human row's labelEvidenceRef resolves against.
    # Deduplicated by entryId: it is one entry per SOURCE registration and not one per
    # record, so thousands of human rows point at four entries.
    by_entry = {entry["entryId"]: entry for entry in evidence_entries}
    (out / "private" / "label-evidence.jsonl").write_text(
        "".join(
            json.dumps(entry, ensure_ascii=False) + "\n"
            for _, entry in sorted(by_entry.items())
        ),
        encoding="utf-8",
    )
    with (out / "records.jsonl").open("w", encoding="utf-8", newline="\n") as fh:
        for r in records:
            fh.write(json.dumps(r, ensure_ascii=False) + "\n")
    with (out / "private" / "review-ledger.jsonl").open(
        "w", encoding="utf-8", newline="\n"
    ) as fh:
        for r in records:
            fh.write(
                json.dumps(
                    {
                        "recordId": r["id"],
                        # The LEDGER records the state, and for an unreviewed row
                        # that is all there is: no reviewer token and no verdict,
                        # because there was no reviewer and no review. It used to
                        # copy both out of the fabricated annotation block, which is
                        # how a hash over this file came to certify a review that
                        # never happened (integrity.review-ledger-hash).
                        "reviewState": r["review"]["state"],
                        "automatedFilters": [
                            f["filter"] for f in r["review"]["automatedFilters"]
                        ],
                        "humanAuditAbsentReason": r["review"][
                            "humanAuditAbsentReason"
                        ],
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
    (out / "governance-inputs.json").write_text(
        json.dumps(governance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )

    # Report what was REALIZED, not the target: a pool short of its quota is the
    # difference between a sealed 10k corpus and a partial one.
    realized = Counter(r["label"] for r in records)
    parts = " ".join(f"{k} {realized[k]}/{counts[k]}" for k in ("human", "ai", "mixed"))
    print(f"records: {len(records)}/{sum(counts.values())} ({parts})")
    print(f"lotes de geracao declarados: {len(batches)}")
    short = {k: counts[k] - realized[k] for k in counts if realized[k] < counts[k]}
    if short:
        print("!! FALTAM (pool esgotado):", short)
    print("held-out families:", sorted(held_out))
    thin = thin_held_out_families(records, held_out)
    if thin:
        print(f"!! held-out families magras (<{HELD_OUT_MINIMUM}):", thin)
    print("hard-negatives:", dict(Counter(
        r.get("hardNegativeFamily") for r in records if r.get("hardNegativeFamily"))))
    print("--- distribuicao de clusters por eixo e por fatia ---")
    print(group_axes.render_cluster_report(report))
    print(f"entradas de evidencia de rotulo: {len(by_entry)}")
    print(f"escrito em {out}")


if __name__ == "__main__":
    main()


