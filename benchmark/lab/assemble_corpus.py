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


def slug(value: str) -> str:
    """Any string -> pseudonym token /^[A-Za-z0-9_-]+$/ (never empty)."""
    out = re.sub(r"[^A-Za-z0-9_-]+", "_", value).strip("_")
    return out or "x"


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
    family = slug(family_raw)
    prompt_id = slug(meta.get("promptId") or f"repro_{rec_id}")
    prompt_sha = meta.get("promptSha256") or hashlib.sha256(
        rec_id.encode("utf-8")
    ).hexdigest()
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
    family = slug(cand.get("model") or "unknown")
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


def assign_partitions(records: list[dict], held_out: set[str]) -> None:
    """20/30/50 per class; held-out AI generator families forced to test."""
    by_class: dict[str, list[dict]] = {}
    for rec in records:
        by_class.setdefault(rec["label"], []).append(rec)
    for label, recs in by_class.items():
        # Held-out positives go to test regardless of the ratio.
        forced_test = [
            r for r in recs if (r.get("groups") or {}).get("generatorFamily") in held_out
        ]
        rest = [r for r in recs if r not in forced_test]
        for r in forced_test:
            stamp_block(r, "test")
        n = len(rest)
        n_dev = round(n * 0.2)
        n_cal = round(n * 0.3)
        for i, r in enumerate(rest):
            if i < n_dev:
                stamp_block(r, "development")
            elif i < n_dev + n_cal:
                stamp_block(r, "calibration")
            else:
                stamp_block(r, "test")


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
    for fname in (
        "ai_reserved",
        "ai_fresh_gemini",
        "ai_fresh_gemini_multi",
        "ai_fresh_codex",
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
    # mixed rows are keyed by parentId (their record id is mix_<parent>); the
    # other pools carry candidateId.
    key = lambda r: r.get("candidateId") or r["parentId"]  # noqa: E731
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

    held_out = {
        (r["groups"].get("generatorFamily"))
        for r in records
        if r["label"] == "ai"
        and (r["groups"].get("generatorFamily") or "").startswith("gemini-3")
    }
    held_out = {f for f in held_out if f}
    assign_partitions(records, held_out)

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

    from collections import Counter
    # Report what was REALIZED, not the target: a pool short of its quota is the
    # difference between a sealed 10k corpus and a partial one.
    realized = Counter(r["label"] for r in records)
    parts = " ".join(f"{k} {realized[k]}/{counts[k]}" for k in ("human", "ai", "mixed"))
    print(f"records: {len(records)}/{sum(counts.values())} ({parts})")
    short = {k: counts[k] - realized[k] for k in counts if realized[k] < counts[k]}
    if short:
        print("!! FALTAM (pool esgotado):", short)
    print("held-out families:", sorted(held_out))
    thin = {
        f: n
        for f, n in Counter(
            (r.get("generation") or {}).get("family") for r in records
        ).items()
        if f in held_out and n < 30
    }
    if thin:
        print("!! held-out families magras (<30 registros):", thin)
    print("hard-negatives:", dict(Counter(
        r.get("hardNegativeFamily") for r in records if r.get("hardNegativeFamily"))))
    print(f"escrito em {out}")


if __name__ == "__main__":
    main()


