"""The v3 grouping axes on the lab bench: how a state is written, and how the
realized cluster structure is reported.

THE PYTHON MIRROR of `V3_GROUP_AXES` / `GroupAxisValue` in `benchmark/schema.ts`.
The TypeScript side is the enforcement — `validateBenchmarkRecordV3` refuses any
record whose axes disagree with `AXIS_STATE_RULE` — so this module exists to make
the assembler WRITE what the sealed schema will accept, never to be a second
authority. `test_the_axis_list_mirrors_the_sealed_schema` reads the axis list out
of `schema.ts` and compares, so the two cannot drift apart silently.

WHAT THIS REPLACES. `assemble_corpus.base_groups` used to return

    {"author": f"a_{rec_id}", "source": f"g_{rec_id}",
     "domainSource": f"ds_{rec_id}", "collectionBatch": f"cb_{rec_id}",
     "nearDuplicate": f"nd_{rec_id}", ...}

under the comment "All UNIQUE per record so the blocked split sees singleton
components." Five axes, one fresh identifier each, per record. That is not a
grouping structure with unfortunate values; it is the ABSENCE of one, written in a
form that every consumer reads as present:

  * the blocked split reported `leakages: []` because it was separating
    identifiers built never to collide, so the report was true and meaningless;
  * `authorClusterKey` returned a distinct "author" for all 10.000 rows, so the
    author-clustered bootstrap resampled i.i.d. over singletons and every interval
    came out narrower than the data supports, in the direction that flatters;
  * the near-duplicate axis could not express a cluster, so a surviving pair cost
    both records instead of collapsing to one representative.

An axis is a claim about DEPENDENCE between rows. Minting one identifier per row
claims that no two rows in the corpus depend on each other, which is false for a
corpus built by extracting several posts from one thread, several reviews of one
product and several generations from one seed. The fix is not "better identifiers"
— it is reading the identity the source already has, and stating outright when it
has none.

WHAT THIS MODULE DELIBERATELY DOES NOT DO. It never judges an axis degenerate. The
plan is explicit that after near-duplicate pruning `nearDuplicate` MUST be all
singletons — that is what pruning does — and that AI text has no human author, so
a criterion like "no axis may be 100% singletons" would reward artificial grouping,
the exact opposite of the point. {@link cluster_report} DESCRIBES: counts, size
distribution, largest cluster, per axis and per slice. Whether a stratum has
sufficient statistical power is E3's question, and it is answered against these
numbers rather than inside them.

Python stdlib only, deterministic, no wall-clock.
"""

from __future__ import annotations

import re
from collections import Counter

# ---------------------------------------------------------------------------
# The axis vocabulary
# ---------------------------------------------------------------------------

# Byte-for-byte the order of `V3_GROUP_AXES` in benchmark/schema.ts, which is the
# reading order of a record's provenance: who wrote it, where it came from, what
# seeded it, what generated it, how it was collected, how it relates to other rows.
# Pinned against schema.ts by test, so an axis added on one side fails on the other.
V3_GROUP_AXES: tuple[str, ...] = (
    "author",
    "source",
    "domainSource",
    "humanSeed",
    "promptTemplate",
    "generatorFamily",
    "generatorVersion",
    "generationLane",
    "harnessVersion",
    "collectionBatch",
    "nearDuplicate",
    "derivationRoot",
)

# The three states R6 allows, and no fourth.
KNOWN = "known"
NOT_APPLICABLE = "notApplicable"
UNKNOWN = "unknown"

# Every grouping identifier is validated as a pseudonym by the sealed schema. "."
# is excluded because this project treats it as a PII separator, which is also why
# `groups.generatorFamily` carries `gemini-3_5-flash-lite` and never the provider's
# dotted spelling.
PSEUDONYM = re.compile(r"^[A-Za-z0-9_-]+$")


def known(identifier: str) -> dict:
    """The axis has this identity.

    Refuses a value the sealed schema would refuse, HERE, rather than letting it
    reach `validate` after a full assembly run: a bad token costs seconds on the
    bench and an hour in the pipeline. It refuses an EMPTY identifier for a
    different reason — an empty string is what v2 wrote when an axis was never
    filled, and `groupAxisState` reads it as `unknown`, so accepting it would let a
    caller write "known" and have the schema read "unknown".
    """
    if not identifier:
        raise ValueError(
            "groups.<axis> known requires an identifier: an empty one reads back as "
            "unknown (benchmark/schema.ts groupAxisState), so it states the opposite"
        )
    if not PSEUDONYM.match(identifier):
        raise ValueError(
            f"{identifier!r} is not a pseudonym token /^[A-Za-z0-9_-]+$/, so the "
            "sealed schema will refuse it. Slug it (group_axes.axis_token) first — "
            'a "." in particular is treated as a PII separator'
        )
    return {"state": KNOWN, "id": identifier}


def not_applicable(reason: str) -> dict:
    """The axis genuinely does not apply, and here is why.

    LEGITIMATE and not a defect: a Wikipedia article is collectively written and
    has no single author; generated text has no human author at all. It does NOT
    cost the record its eligibility.

    The reason is mandatory, and that cost is deliberate. The failure mode R6 names
    is a producer writing `notApplicable` to dodge ineligibility, and a
    justification written down is something a reviewer can disagree with — an
    absent one is not.
    """
    return _stated(NOT_APPLICABLE, reason)


def unknown(reason: str) -> dict:
    """The axis applies, the value exists, and it was not recovered.

    This makes the record INELIGIBLE (`recordEligibility` in benchmark/schema.ts),
    and that price is the whole design: it is what makes `unknown` an honest answer
    instead of a cheap one, and it is why nothing here ever substitutes a
    synthesized identifier for a missing one.
    """
    return _stated(UNKNOWN, reason)


def _stated(state: str, reason: str) -> dict:
    if not reason or not reason.strip():
        raise ValueError(
            f"groups.<axis> {state} requires a written reason: an unjustified "
            f"{state} is indistinguishable from a producer dodging the cost of "
            "unknown, which is the substitution R6 exists to prevent"
        )
    return {"state": state, "reason": reason}


def axis_token(value: str) -> str:
    """Any string -> a pseudonym token, preserving case.

    The same normalisation `assemble_corpus.slug` and `normalizeGeneratorFamily`
    apply: collapse every run outside [A-Za-z0-9_-] into one "_", strip the edges.
    Unlike `slug` it FAILS on a value that normalises to nothing, because an
    identity we cannot name is a provenance problem and "x" would be a made-up
    cluster shared by every unnameable row.
    """
    out = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")
    if not out:
        raise ValueError(
            f"{value!r} carries no character of [A-Za-z0-9_-], so it cannot become "
            "a grouping identifier. A placeholder would join every unnameable row "
            "into one invented cluster"
        )
    return out


def state_of(axis_value: dict | str | None) -> str:
    """The state of one axis value, tolerating the v2 shape.

    Mirrors `groupAxisState`: a v2 record has no states, so a filled string reads
    `known` and an empty or absent one reads `unknown`. That mapping is truthful and
    NOT flattering — it means a v2 row with an absent axis is reported ineligible,
    because a v2 record has no way to say `notApplicable` about anything.
    """
    if axis_value is None:
        return UNKNOWN
    if isinstance(axis_value, str):
        return KNOWN if axis_value else UNKNOWN
    return str(axis_value.get("state") or UNKNOWN)


def identity_of(axis_value: dict | str | None) -> str | None:
    """The identity of one axis, or None when the axis is not `known`.

    None deliberately collapses `notApplicable` and `unknown`, because for code
    that is GROUPING rows the two behave identically: neither joins this row to
    another. The distinction matters for eligibility, which is a different question.
    """
    if axis_value is None:
        return None
    if isinstance(axis_value, str):
        return axis_value or None
    if axis_value.get("state") != KNOWN:
        return None
    return str(axis_value.get("id"))


# ---------------------------------------------------------------------------
# Which axes each SOURCE declares applicable
# ---------------------------------------------------------------------------

# Requirement 2 of the C2 brief, as data rather than as prose in a docstring: per
# human source, the axes the plan fixes. `source` is the ORIGIN DOCUMENT and it is
# a different thing per base — a thread, a page, a product, a member file — while
# `author` exists only where a single identifiable person wrote the text.
#
# The mapping is deliberately NOT "every axis every source could conceivably have".
#
# WHAT IT CONSTRAINS TODAY: nothing. It is a DECLARATION, consumed only by
# `test_every_source_declares_the_axes_the_plan_fixes_for_it`, which pins its
# contents against requirement 2 of the C2 brief. No production path reads it, and
# no code checks that a ptso row actually carries the two axes named here — the
# per-source fixture tests in `test_extractors.py` do that one source at a time. An
# earlier version of this comment described it as "the contract C3 checks a record
# against", which was a claim about a checker that does not exist yet.
#
# WHAT IT IS FOR: C3 to consume, as the input to `assertDeclaredAxesResolved`. The
# intended reading there is that an axis listed here and left `unknown` means the
# extractor failed to recover something the source HAS, while an axis listed here
# and marked `notApplicable` means the record CONTRADICTS its own source — two
# different mistakes.
#
# WHY C2 DID NOT TURN IT INTO A REFUSAL, since the table was sitting right here:
#   * refusing a row for `unknown` on a declared axis would contradict R6 outright.
#     `unknown` makes a record INELIGIBLE and is a legitimate state — a Stack
#     Exchange post whose account was deleted is exactly that, and there is a
#     fixture test asserting the row is written and marked `unknown`. Dropping it
#     instead would delete the evidence that the gap exists;
#   * refusing a row whose axis KEY is merely absent would drop the legacy candidate
#     pools, which predate the extractors that emit these axes and which
#     `human_record` deliberately reads as `unknown` with a written reason. That is a
#     change to what the corpus CONTAINS, and C2 was told not to make selection
#     decisions.
# Both refusals are C3's to make against a corpus, with the split in front of it.
#
# Why ptwiki and Carolina declare no `author`:
#   * a Wikipedia lead section is the accreted work of many editors, so there is no
#     single author to recover — `notApplicable`, not a gap;
#   * `extract_carolina.py` never reads TEI header names at all (its docstring says
#     so and its parser only touches availability, the download date and the body),
#     so no author identifier ever enters the pipeline and none is lost.
# Neither is an omission to be fixed later. Adding a synthesized author to either
# would re-create the defect this whole task removes.
SOURCE_DECLARED_AXES: dict[str, tuple[str, ...]] = {
    # A post belongs to a THREAD (a question and its answers) and to an ACCOUNT.
    "ptso_qa": ("source", "author"),
    # A lead section belongs to a PAGE. Collectively written.
    "ptwiki_lead": ("source",),
    # A review belongs to a PRODUCT and to a REVIEWER.
    "b2w_reviews": ("source", "author"),
    # A Carolina document belongs to the MEMBER FILE it was read out of. The
    # typologies are listed individually rather than matched by prefix so that a
    # typology appearing in the archive without a decision here is a KeyError at
    # assembly time instead of a silently unconstrained source.
    "carolina_datasets_and_other_corpora": ("source",),
    "carolina_judicial_branch": ("source",),
    "carolina_legislative_branch": ("source",),
    "carolina_public_domain_works": ("source",),
    "carolina_social_media": ("source",),
    "carolina_university_domains": ("source",),
}

# The written reasons, in one place, so two extractors cannot justify the same
# absence two different ways.
NO_SINGLE_AUTHOR = (
    "collectively written: a Wikipedia lead section is the accreted work of many "
    "editors, so no single author exists to recover"
)
NO_AUTHOR_READ = (
    "the Carolina extractor never reads TEI header names, so no author identifier "
    "enters the pipeline and none was lost"
)
AUTHOR_NOT_RECOVERED = (
    "the source row carries no account identifier (deleted or anonymous author), "
    "so the author exists and was not recovered"
)
NO_HUMAN_AUTHOR = "generated text has no human author"
NOT_A_GENERATED_ROW = "the record is human text: no generation apparatus produced it"
NO_DERIVATION = (
    "the recipe writes new text from a seed rather than rewriting it, so this row "
    "is a derivation of nothing"
)


# ---------------------------------------------------------------------------
# The realized cluster structure
# ---------------------------------------------------------------------------


def _axis_summary(values: list[dict | str | None]) -> dict:
    """Counts, size distribution and largest cluster for ONE axis of ONE slice."""
    states: Counter = Counter(state_of(value) for value in values)
    sizes: Counter = Counter()
    for value in values:
        identity = identity_of(value)
        if identity is not None:
            sizes[identity] += 1
    distribution: Counter = Counter(sizes.values())
    largest = None
    if sizes:
        # Ties broken by identifier so the report is byte-stable across runs; a
        # report that changes without the corpus changing cannot be diffed.
        identity, size = max(sizes.items(), key=lambda pair: (pair[1], pair[0]))
        largest = {"id": identity, "size": size}
    return {
        # How many distinct clusters the axis realizes...
        "clusters": len(sizes),
        # ...over how many rows. `records` counts only rows the axis GROUPS, so it
        # is smaller than the slice whenever an axis is notApplicable or unknown,
        # and the gap is visible in `states` rather than implied.
        "records": sum(sizes.values()),
        "states": dict(sorted(states.items())),
        # size -> how many clusters have exactly that size. Keys are strings
        # because this is written out as JSON, where an integer key would come back
        # as a string anyway and the two spellings would not compare equal.
        "sizeDistribution": {
            str(size): count for size, count in sorted(distribution.items())
        },
        "largestCluster": largest,
    }


def cluster_report(records: list[dict]) -> dict:
    """Cluster count and size distribution per axis AND per slice.

    A slice is `<partition>/<label>`, and reporting per slice is not decoration:
    the aggregate hides the shape that actually leaks. One thread contributing two
    human rows to `development` and one AI row derived from the same seed is ONE
    cluster of three in the aggregate and looks like three well-behaved little
    clusters if you only ever look per class. E3's power criterion is evaluated per
    stratum, so the numbers have to exist per stratum.

    `ineligibleRecords` counts rows carrying `unknown` on at least one axis, which
    is `recordEligibility` in one line. It is reported next to the clusters because
    an axis whose clusters look healthy while half its rows are ineligible is not a
    healthy axis, and the two numbers are only comparable side by side.

    Deliberately contains no verdict. There is no `degenerate` flag, in either
    language, and a test asserts the word does not appear in the output: after
    pruning, `nearDuplicate` is all singletons BY DESIGN, and AI rows have no human
    author BY RULE, so any threshold on singleton share would flag correct
    behaviour and reward artificial grouping.
    """
    slices: dict[str, list[dict]] = {}
    for record in records:
        key = f"{record.get('partition') or 'unassigned'}/{record.get('label')}"
        slices.setdefault(key, []).append(record)

    def summarize(rows: list[dict]) -> dict:
        groups = [row.get("groups") or {} for row in rows]
        return {
            "records": len(rows),
            "ineligibleRecords": sum(
                1
                for group in groups
                if any(state_of(group.get(axis)) == UNKNOWN for axis in V3_GROUP_AXES)
            ),
            "axes": {
                axis: _axis_summary([group.get(axis) for group in groups])
                for axis in V3_GROUP_AXES
            },
        }

    report = summarize(records)
    report["slices"] = {key: summarize(rows) for key, rows in sorted(slices.items())}
    return report


def render_cluster_report(report: dict) -> str:
    """The report as lines an operator reads in a terminal.

    Prints the largest cluster per axis because that is the number the plan asks to
    be reported, and the singleton share beside it because "500 clusters" means two
    completely different things at 1 and at 20 rows each.
    """
    lines: list[str] = [
        f"registros: {report['records']} "
        f"(inelegiveis por eixo unknown: {report['ineligibleRecords']})"
    ]
    for axis, summary in report["axes"].items():
        largest = summary["largestCluster"]
        singletons = summary["sizeDistribution"].get("1", 0)
        lines.append(
            f"  {axis:17s} clusters={summary['clusters']:<6d} "
            f"registros_agrupados={summary['records']:<6d} "
            f"singletons={singletons:<6d} "
            f"maior={largest['id'] + '/' + str(largest['size']) if largest else '-'} "
            f"estados={summary['states']}"
        )
    for key, summary in report["slices"].items():
        lines.append(f"  fatia {key}: registros={summary['records']}")
        for axis, axis_summary in summary["axes"].items():
            if axis_summary["clusters"] == 0:
                continue
            largest = axis_summary["largestCluster"]
            lines.append(
                f"    {axis:15s} clusters={axis_summary['clusters']:<6d} "
                f"maior={largest['id']}/{largest['size']} "
                f"dist={axis_summary['sizeDistribution']}"
            )
    return "\n".join(lines)
