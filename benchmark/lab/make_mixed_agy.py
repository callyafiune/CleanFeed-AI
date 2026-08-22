"""Antigravity CLI lane for the mixed class: edits via the user's Google login.

Runs `agy -p` (plan mode, read-only, stdin closed — it hangs otherwise on
Windows) once per parent; stdout is the edited text. Emits pairs; import them
afterwards with

  python make_mixed.py --from-pairs pares.jsonl --output mixed.jsonl

(the import recomputes the diff provenance and enforces the mixed band).

`--island` is REQUIRED and the run is of ONE island, exactly as the generation lane's
is. Two things follow from it and neither is optional. The parents come from that
island's own seed block, because a mixed row names its parent in `derivationRoot` and
`humanSeed` and `connected_components` unions BY VALUE: a parent from another island
fuses the two, and the template partition is decorative once the quota is spent. And the
identity written on the row comes from the island's `mixingTemplates`, one slot per
operation, so a row cannot claim a recipe that belongs to no island.

The loop iterates the CELLS of the island — operation × level, the twenty
`assemble_corpus.mix_cells()` derives — and not just its parents. Each parent gets the
cell its position in the island's interleaved order buys, so a resumed run gives the same
parent the same cell: indexing by the position in THIS run would give it a different one
and the row would declare a level nobody asked for.

Resume-safe by parentId; --max-failures consecutive dead items stop the batch. provider
is recorded as "antigravity" and model is the exact --model id (agy serves multi-vendor
models: gemini-3.6-flash-low, gpt-oss-120b-medium, ...) — pick different models per
tranche for editor diversity.

Usage:
  python make_mixed_agy.py --island ilha_03 \
    --parents ../data/candidates/lane_parents_agy.jsonl \
    --pairs ../data/candidates/mixed_pairs_agy.jsonl \
    --model gemini-3.6-flash-low --target 100
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from generate_ai import harness_version
from make_mixed import (
    MIX_TEMPLATES,
    adjacent_mix_level,
    already_done,
    assembler,
    canonical_text,
    compute_mixture,
    in_mixed_band,
    interleave_by_family,
    island_plan,
    mixed_bands,
    parent_projection,
    read_jsonl,
)

AGY_DEFAULT = str(
    Path.home() / "AppData" / "Local" / "agy" / "bin" / "agy.exe"
)


def run_agy(
    prompt: str, model: str, timeout: int, agy_bin: str, cwd: str
) -> str:
    proc = subprocess.run(
        [agy_bin, "-p", prompt, "--mode", "plan", "--model", model],
        stdin=subprocess.DEVNULL,
        capture_output=True,
        timeout=timeout,
        cwd=cwd,
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"agy exit {proc.returncode}: "
            f"{proc.stderr.decode('utf-8', errors='replace')[-300:]}"
        )
    edited = proc.stdout.decode("utf-8", errors="replace").strip()
    if not edited:
        raise RuntimeError("agy devolveu saída vazia")
    return edited


def cell_of_each_parent(
    parents: list[dict], island: dict
) -> dict[str, tuple[str, int]]:
    """parent id -> the cell (operation, level) the plan buys for it.

    Assigned by the parent's position in the island's WHOLE interleaved order, not by its
    position in this run: `already_done` counts the pairs of every run in the same file,
    so indexing by the run would move a parent's cell on every resume and the row would
    declare a level the request never carried.

    The allocation is exactly the island's mixed quota, so it is also the ceiling on how
    many parents a run may take. A parent with no cell would be a line outside the plan.
    """
    lab = assembler()
    allocation = lab.mix_cell_allocation(island["lines"]["mixed"])
    ordered = interleave_by_family(parents)
    return {
        parent["id"]: allocation[position]
        for position, parent in enumerate(ordered[: len(allocation)])
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parents", required=True, type=Path)
    parser.add_argument("--pairs", required=True, type=Path)
    parser.add_argument(
        "--island",
        required=True,
        type=island_plan,
        help="a ilha desta corrida: os pais saem do bloco de sementes dela e a "
        "identidade de mistura sai dos slots dela",
    )
    parser.add_argument("--target", type=int, default=100)
    parser.add_argument("--model", required=True)
    parser.add_argument("--timeout", type=int, default=360)
    parser.add_argument("--agy-bin", default=AGY_DEFAULT)
    parser.add_argument("--max-failures", type=int, default=3)
    parser.add_argument("--item-retries", type=int, default=3)
    parser.add_argument("--retry-backoff", type=float, default=20.0)
    parser.add_argument("--nudge-retries", type=int, default=1)
    parser.add_argument("--pace", type=float, default=2.0)
    args = parser.parse_args()

    sys.stdout.reconfigure(
        encoding="utf-8", errors="replace", line_buffering=True
    )
    lab = assembler()
    done = already_done(args.pairs)
    # The island's OWN seed block, imposed before a single call is spent. The parents file
    # is the corpus's, and the island takes the slice the plan gives it.
    parents = [
        parent_projection(row)
        for row in read_jsonl(args.parents)
        if lab.island_of_seed(lab.ISLAND_PLAN, row["id"])["island"]
        == args.island["island"]
    ]
    cell_of = cell_of_each_parent(parents, args.island)
    pending = [
        parent
        for parent in interleave_by_family(parents)
        if parent["id"] in cell_of and parent["id"] not in done
    ][: args.target]
    print(
        f"agy misto ({args.model}) @ {args.island['island']}: {len(pending)} pares "
        f"em {len(set(cell_of.values()))} celulas (resume-skip={len(done)})"
    )

    # Captured ONCE, before the first edit: the binary does not change mid-run, and
    # the version is a grouping axis, so it is read from the binary and never composed.
    # None when the capture fails, which costs the rows their eligibility rather than
    # giving them a version nobody read.
    captured_harness = harness_version("agy")
    print(f"harness agy: {captured_harness or 'NAO CAPTURADA (registros inelegiveis)'}")
    workdir = tempfile.mkdtemp(prefix="agy_mixed_")
    failures = 0
    kept = 0
    with args.pairs.open("a", encoding="utf-8", newline="\n") as pairs_out:
        for index, parent in enumerate(pending, start=1):
            operation, cell_level = cell_of[parent["id"]]
            # The identity comes from the ISLAND and the OPERATION and never from a fixed
            # name: it is the slot the island reserves for this operation. Stamping a
            # recipe that belongs to no island is what the assembly refuses row by row,
            # after the quota is gone.
            template_id = args.island["mixingTemplates"][operation]
            template = MIX_TEMPLATES[template_id]["template"]
            # Reset PER PARENT and not once outside the loop: a nudge on one line must not
            # leave the next declaring the neighbouring level it never asked for.
            level = cell_level
            # The prompt is built from the CANONICAL parent, because the 6.000-character
            # cut depends on spacing: with a raw parent the material sent and the material
            # compared could differ in the truncation.
            base = canonical_text(parent["text"])
            edited = None
            last_error: Exception | None = None
            for attempt in range(args.item_retries):
                try:
                    edited = canonical_text(
                        run_agy(
                            template.format(parent=base[:6000], nivel=level),
                            args.model,
                            args.timeout,
                            args.agy_bin,
                            workdir,
                        )
                    )
                    break
                except (RuntimeError, subprocess.TimeoutExpired) as error:
                    last_error = error
                    if attempt < args.item_retries - 1:
                        time.sleep(args.retry_backoff)
            if edited is None:
                failures += 1
                print(
                    f"  {parent['id']} falhou ({failures}/{args.max_failures}): "
                    f"{last_error}"
                )
                if failures >= args.max_failures:
                    print(f"  falhas consecutivas — parando após {kept} (resume depois)")
                    break
                continue
            failures = 0
            mixture = compute_mixture(base, edited)
            # The nudge re-runs the SAME template at the NEIGHBOURING level: the correction
            # lives in the PARAMETER, because the island reserves ONE slot per operation
            # and swapping identity here would undercount the sixty. The direction
            # compensates the observed miss — text that became all AI asks for the level
            # BELOW, text left almost untouched for the one above — and at the end of the
            # curve there is no neighbour, where the run spends no call: repeating the same
            # request would buy another draw of the same lottery.
            for _ in range(args.nudge_retries):
                if in_mixed_band(mixture):
                    break
                neighbour = adjacent_mix_level(
                    level, para_baixo=mixture["aiFraction"] >= mixed_bands()[-1][2]
                )
                if neighbour is None:
                    break
                level = neighbour
                try:
                    edited = canonical_text(
                        run_agy(
                            template.format(parent=base[:6000], nivel=level),
                            args.model,
                            args.timeout,
                            args.agy_bin,
                            workdir,
                        )
                    )
                except (RuntimeError, subprocess.TimeoutExpired) as error:
                    print(f"  {parent['id']} nudge falhou: {error}")
                    break
                mixture = compute_mixture(base, edited)
            if not in_mixed_band(mixture):
                print(
                    f"  {parent['id']} fora da faixa mista "
                    f"(aiFraction={mixture['aiFraction']:.2f}) — descartado"
                )
                continue
            pairs_out.write(
                json.dumps(
                    {
                        "parentId": parent["id"],
                        "parentText": base,
                        "editedText": edited,
                        "family": parent.get("family", "?"),
                        # The parent's acquisition event. It has to travel on the PAIR
                        # because `--from-pairs` reassembles the mixed row from this
                        # file alone, and a parent id does not resolve to a batch at
                        # assembly time.
                        "sourceMaterialBatch": parent.get("sourceMaterialBatch"),
                        "provider": "antigravity",
                        "model": args.model,
                        # WHICH template and WHICH binary produced this pair, plus the
                        # CELL the request carried. All three are recorded rather than
                        # assumed downstream: `emit` refuses a row whose declared
                        # operation disagrees with the identity, and the level travels
                        # because it is the target the request asked for and no reading
                        # of the written text recovers it.
                        "promptTemplateId": template_id,
                        "mixOperation": operation,
                        # The level of the request that SURVIVED and not the cell's: when
                        # the nudge runs, the written text came from the neighbour, and
                        # recording the cell's target would claim a request that did not
                        # produce this text. The loss against the plan shows up as an
                        # under-filled cell, which is measurable; the wrong claim is not.
                        "mixLevel": level,
                        "harnessVersion": captured_harness,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            pairs_out.flush()
            kept += 1
            if index % 10 == 0:
                print(f"  {index}/{len(pending)} (kept={kept})")
            time.sleep(args.pace)
    print(f"pares agy: {kept} -> {args.pairs}")


if __name__ == "__main__":
    main()
