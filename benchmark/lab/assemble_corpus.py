"""Assembles the sealed corpus ptbr-generic-v1 from candidate pools into the
canonical BenchmarkRecord v2 shape that `ingest` + `validate` accept.

Emits (into --out-dir):
  records.jsonl                 the 10k canonical records (human/ai/mixed)
  private/review-ledger.jsonl   one {recordId,reviewerIds,agreement} per record
  governance-inputs.json        sourceIds + held-out families + licenses, for
                                build_governance.ts to mint the digest-bound
                                source-manifest.json and template manifest.json

Design pinned to the assembly map (memory: cleanfeed-canonical-assembly):
  * Closed v2 schema; OMIT normalizedTextSha256 (ingest recomputes + fills).
  * All groups.* tokens UNIQUE per record (author/source/domainSource/
    collectionBatch/nearDuplicate/derivationRoot) so the blocked split treats
    each record as its own connected component; domain/generatorFamily are NOT
    grouping axes. Mixed's derivationRoot points to its (out-of-corpus) parent.
  * Pseudonyms /^[A-Za-z0-9_-]+$/ everywhere ids/groups live; families slugged.
  * label cross-rules: human->no generation; ai->generation; mixed->mixture
    (fractions sum to 1 at full float precision) + derivationRoot != id.
  * humanSourceType = register (5 required types). hardNegativeFamily tagged
    heuristically so all 6 required families are present on human records.
  * createdAt assigns a dev/cal/test BLOCK (20/30/50 per class); held-out AI
    generator families are forced entirely into the test block (latest time),
    as the split requires them after the test cut.

Usage:
  python assemble_corpus.py --out-dir ../data/corpus-build [--sample 120]
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

import near_dupes

CAND = Path(__file__).resolve().parent.parent / "data" / "candidates"
DATASET = Path(__file__).resolve().parent.parent / "data" / "dataset"

# Block timestamps drive the temporal split (dev < cal < test).
BLOCK_TIME = {"development": 1_000_000, "calibration": 2_000_000, "test": 3_000_000}
CLASS_FRACTIONS = [("development", 0.2), ("calibration", 0.3), ("test", 0.5)]

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
# The lab generates at a fixed sampling temperature and no provider on these
# channels exposes a seed, so every declared batch records the same pair.
LAB_TEMPERATURE = 0.8
SEED_NULL_REASON = "provider API does not expose a sampling seed"
# The mixed cohort this lane produces. The frozen contract
# (benchmark/rebuild-v3-policy.json, `materialAssistance.generationMode`) closes
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
    one "_", strip leading/trailing "_", preserve case. So
    "gemini-3.5-flash-low" -> "gemini-3_5-flash-low", and the underscore form maps
    to itself.

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
    out = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")
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


ANNOTATION = {
    "protocolVersion": "annotation-v1",
    "reviewerIds": ["reviewer_a", "reviewer_b"],
    "agreement": "agree",
}


def pii_audit(block_time: int) -> dict:
    return {
        "status": "passed",
        "method": "manual-and-automated",
        "reviewerId": "reviewer_pii",
        "reviewedAt": block_time,
    }


def base_groups(rec_id: str, derivation_root: str) -> dict:
    # All UNIQUE per record so the blocked split sees singleton components.
    return {
        "author": f"a_{rec_id}",
        "source": f"g_{rec_id}",
        "domainSource": f"ds_{rec_id}",
        "collectionBatch": f"cb_{rec_id}",
        "nearDuplicate": f"nd_{rec_id}",
        "derivationRoot": derivation_root,
    }


# --- record builders (return the canonical dict, block_time filled later) ----


def human_record(cand: dict, register: str, hard_neg: str | None) -> dict:
    rec_id = slug(cand["candidateId"])
    source_id, license_id = HUMAN_SOURCE[cand["domainSource"]]
    rec = {
        "schemaVersion": 2,
        "id": rec_id,
        "text": cand["text"],
        "label": "human",
        "language": "pt-BR",
        "platform": "generic",
        "domain": register,
        "topic": "geral",
        "humanSourceType": register,
        "wordCount": int(cand["wordCount"]),
        "provenance": {
            "sourceKind": "licensed-corpus",
            "sourceId": source_id,
            "sourceRevision": "rev_001",
            "licenseId": license_id,
            "legalBasis": "license",
        },
        "annotation": dict(ANNOTATION),
        "transformation": {"kind": "none", "severity": "none"},
        "groups": base_groups(rec_id, rec_id),
    }
    if hard_neg is not None:
        rec["hardNegativeFamily"] = hard_neg
    return rec


def ai_record(cand: dict) -> dict:
    meta = cand.get("meta") or {}
    rec_id = slug(cand.get("candidateId") or cand["id"])
    family_raw = meta.get("family") or cand.get("family") or "unknown"
    family = generator_family(family_raw)
    prompt_id = slug(meta.get("promptId") or f"repro_{rec_id}")
    # The governance audit compares generation.promptSha256 against the batch's
    # promptTemplateDigest, so the record must carry the TEMPLATE digest (shared
    # by every record of a recipe) — not the per-record full-prompt digest, which
    # would force one declared batch per record. The instance stays identifiable
    # through promptId; candidates keep the full-prompt digest in their own meta.
    prompt_sha = (
        meta.get("promptTemplateDigest")
        or meta.get("promptSha256")
        # Reserved records carry no prompt metadata at all. Keying the fallback
        # on the record id would mint one declared batch per record (1476 of
        # them); the family is what is actually known about their recipe.
        or hashlib.sha256(f"reserved-recipe:{family_raw}".encode("utf-8")).hexdigest()
    )
    rec = {
        "schemaVersion": 2,
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
        "annotation": dict(ANNOTATION),
        "generation": {
            "provider": str(meta.get("provider") or "reserved"),
            "family": str(family_raw),
            "model": str(meta.get("model") or family_raw),
            "version": str(meta.get("version") or family_raw),
            "promptId": prompt_id,
            "promptSha256": prompt_sha,
            # Governance compares (temperature ?? null) against the declared
            # batch, whose temperature MUST be a finite number — so the record
            # has to carry it too, not leave it implicit.
            "temperature": float(meta.get("temperature") or LAB_TEMPERATURE),
        },
        "transformation": {"kind": "none", "severity": "none"},
        "groups": {**base_groups(rec_id, rec_id), "generatorFamily": family},
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
    family = generator_family(cand.get("model") or "unknown")
    rec = {
        "schemaVersion": 2,
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
        "annotation": dict(ANNOTATION),
        "mixture": {
            "aiFraction": ai_fraction,
            "humanFraction": 1.0 - ai_fraction,
            "spans": [
                {"start": int(s["start"]), "end": int(s["end"]), "origin": s["origin"]}
                for s in spans
            ],
            # Mandatory in the sealed schema (benchmark/schema.ts) and a FACT here,
            # not a default: make_mixed.py chose and executed the edits, so the
            # provenance of every span is known while the coauthorship
            # distribution is ours. "ecological" would claim an observed writing
            # process this lane never watched, and this assembler must never
            # write it (R4).
            "generationMode": MECHANISTIC_GENERATION_MODE,
        },
        # The AI spans ARE controlled generation, and governance demands a
        # recipe for every controlled-generation record. mixed candidates carry
        # no prompt digest of their own, so the mixing recipe is identified
        # deterministically by its model — shared by every record of the batch.
        "generation": {
            "provider": str(cand.get("provider") or "reserved"),
            "family": str(cand.get("model") or "unknown"),
            "model": str(cand.get("model") or "unknown"),
            "version": str(cand.get("model") or "unknown"),
            "promptId": f"mix_{family}",
            "promptSha256": hashlib.sha256(
                f"mixed-recipe:{cand.get('model') or 'unknown'}".encode("utf-8")
            ).hexdigest(),
            "temperature": LAB_TEMPERATURE,
        },
        "transformation": {"kind": "human-ai-mix", "severity": "medium"},
        # derivationRoot points to the (out-of-corpus) parent; != rec_id.
        "groups": {**base_groups(rec_id, parent), "generatorFamily": family},
    }
    return rec


def stamp_block(rec: dict, partition: str) -> dict:
    """Fills every *At timestamp with the partition's block time."""
    t = BLOCK_TIME[partition]
    rec["createdAt"] = t
    rec["provenance"]["collectedAt"] = t
    rec["provenance"]["piiAudit"] = pii_audit(t)
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

    Not the same question as `below_floor` in main(), which asks it of the
    declaration candidates: this one asks it of the records actually written, after
    partitioning. Today the two agree by construction, because a family is only
    declared when it already clears the floor; the point is that any later edit
    which prunes records after the declaration loop, or relaxes the floor, is caught
    here instead of writing a corpus that `validate` rejects with
    DATASET_COVERAGE_INVALID.
    """
    written = Counter((r.get("groups") or {}).get("generatorFamily") for r in records)
    return {f: written[f] for f in sorted(held_out) if written[f] < minimum}


def assign_partitions(records: list[dict], held_out: set[str]) -> None:
    """Exact 20/30/50 blocks per class, with held-out families INSIDE the test
    block rather than on top of it.

    The split imposes two constraints at once: a held-out component whose time
    reaches development/calibration is refused outright, AND the realized class
    fractions must land within classTolerance (0.02) of 20/30/50. Forcing
    held-out records into test on top of an independent 20/30/50 split of the
    remainder satisfies the first and breaks the second — held-out families
    reach the mixed class too (a mixing model is a generator), so 714 held-out
    mixed records would have pushed mixed's test share to 68% and the split
    would have refused the corpus. So size the test block first, seat the
    held-out records in it, and top it up from the rest.
    """
    by_class: dict[str, list[dict]] = {}
    for rec in records:
        by_class.setdefault(rec["label"], []).append(rec)
    for label, recs in by_class.items():
        n = len(recs)
        n_dev = round(n * 0.2)
        n_cal = round(n * 0.3)
        n_test = n - n_dev - n_cal
        forced = [
            r for r in recs if (r.get("groups") or {}).get("generatorFamily") in held_out
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
        for i, r in enumerate(rest):
            if i < top_up:
                stamp_block(r, "test")
            elif i < top_up + n_dev:
                stamp_block(r, "development")
            else:
                stamp_block(r, "calibration")


# --- loading + selection -----------------------------------------------------


def load_humans() -> list[dict]:
    """Fresh pools + reserved-clean humans, each tagged with its register.

    Only domainSources present in REGISTER are kept (carolina_datasets and
    public-domain are set aside — social-media is B2W-backed now)."""
    rows: list[dict] = []
    for fname in ("ptso_fresh", "wikipedia_fresh", "carolina_fresh", "b2w_fresh"):
        for r in read_jsonl(CAND / f"{fname}.jsonl"):
            if r["domainSource"] in REGISTER:
                rows.append(r)
    # reserved-clean humans (never trained, not mixed parents) reuse the same
    # candidate shape; their family field is the domainSource.
    parents = set()
    for f in ("mixed_candidates.jsonl", "mixed_from_pairs.jsonl"):
        for r in read_jsonl(CAND / f):
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
                    }
                )
    return rows


def load_ai() -> list[dict]:
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
        for r in read_jsonl(CAND / f"{fname}.jsonl"):
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


def load_mixed() -> list[dict]:
    rows: list[dict] = []
    for f in ("mixed_candidates.jsonl", "mixed_from_pairs.jsonl"):
        for r in read_jsonl(CAND / f):
            rows.append(r)
    return rows


def assign_generation_batches(records: list[dict]) -> list[dict]:
    """Group generated records into declared generation batches, in place.

    The governance audit refuses every controlled-generation record whose
    groups.collectionBatch does not name a batch in the reviewed source manifest
    whose declared recipe matches the record's generation block EXACTLY —
    sourceId, provider, family, model, version, prompt digest, temperature,
    generatedAt and seed. So batches are derived FROM the records: one per
    distinct recipe, which makes the match hold by construction.

    This is why collectionBatch cannot be unique per record, as it was: a
    per-record token names no declared batch, and all 5726 generated records
    were blocked with GENERATION_RECIPE_MISSING. Sharing it is safe for the
    split even though collectionBatch is a grouping axis — generatedAt is part
    of the batch key and equals the record's temporal block, so a batch is an
    indivisible component that can never straddle two blocks. Human records keep
    their per-record cb_ token, which must NOT name a batch (the audit rejects a
    non-generated record that links one) and cannot collide with a gb_ id.
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
            generation["promptSha256"],
            generation["temperature"],
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
                "promptTemplateDigest": generation["promptSha256"],
                "temperature": generation["temperature"],
                "generatedAt": generation["generatedAt"],
                # Exactly one of seed / seedNullReason, per the manifest parser.
                "seed": generation.get("seed"),
                "seedNullReason": (
                    None if generation.get("seed") else SEED_NULL_REASON
                ),
            }
            batches[key] = batch
        rec["groups"]["collectionBatch"] = batch["batchId"]
    return list(batches.values())


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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out-dir", required=True, type=Path)
    parser.add_argument(
        "--sample", type=int, default=0, help="montagem de fumaça: N registros totais"
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
    humans = dedup(load_humans(), lambda r: r["text"], seen)
    ai = dedup(load_ai(), lambda r: r["text"], seen)
    mixed = dedup(load_mixed(), lambda r: r["text"], seen)
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

    # The corpus must be independent of what the detector TRAINED on, which
    # pruning within the corpus cannot establish. The human pools re-extract the
    # same upstream sources the training set came from, so a revisited page
    # reappears with small edits and reads as fresh here while the detector has
    # effectively already seen it.
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

    records = [human_record(c, REGISTER[c["domainSource"]], None) for c in human_sel]
    records += [ai_record(c) for c in ai_sel]
    records += [mixed_record(c) for c in mixed_sel]

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
        family = r["groups"].get("generatorFamily")
        if family and r["label"] in ("ai", "mixed"):
            per_family.setdefault(family, Counter())[r["label"]] += 1
    positives = {f: sum(c.values()) for f, c in per_family.items()}
    class_size = Counter(r["label"] for r in records)
    test_capacity = {
        lab: n - round(n * 0.2) - round(n * 0.3) for lab, n in class_size.items()
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
        "datasetId": "ptbr-generic-v1",
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

    out = args.out_dir
    (out / "private").mkdir(parents=True, exist_ok=True)
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
                        "reviewerIds": r["annotation"]["reviewerIds"],
                        "agreement": r["annotation"]["agreement"],
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
    print(f"escrito em {out}")


if __name__ == "__main__":
    main()


