"""Antigravity CLI lane for the mixed class: edits via the user's Google login.

Runs `agy -p` (plan mode, read-only, stdin closed — it hangs otherwise on
Windows) once per parent with make_mixed's EDIT_PROMPT; stdout is the edited
text. Emits {parentId, parentText, editedText, family, provider, model}
pairs; import them afterwards with

  python make_mixed.py --from-pairs pares.jsonl --output mixed.jsonl

(the import recomputes the diff provenance and enforces the mixed band).

Resume-safe by parentId; --max-failures consecutive dead items stop the
batch. provider is recorded as "antigravity" and model is the exact --model
id (agy serves multi-vendor models: gemini-3.6-flash-low, claude-sonnet-4-6,
gpt-oss-120b-medium, ...) — pick different models per tranche for editor
diversity.

Usage:
  python make_mixed_agy.py --parents ../data/candidates/lane_parents_agy.jsonl \
    --pairs ../data/candidates/mixed_pairs_agy.jsonl \
    --model gemini-3.6-flash-low --target 470
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
from make_mixed import MIX_TEMPLATES, already_done, read_jsonl

# This lane sends the base editing prompt and runs no corrective retry (the nudge
# lives in make_mixed.py's --generate path), so the template is fixed here.
TEMPLATE_ID = "mix_edit_v1"
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


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parents", required=True, type=Path)
    parser.add_argument("--pairs", required=True, type=Path)
    parser.add_argument("--target", type=int, default=470)
    parser.add_argument("--model", required=True)
    parser.add_argument("--timeout", type=int, default=360)
    parser.add_argument("--agy-bin", default=AGY_DEFAULT)
    parser.add_argument("--max-failures", type=int, default=3)
    parser.add_argument("--item-retries", type=int, default=3)
    parser.add_argument("--retry-backoff", type=float, default=20.0)
    parser.add_argument("--pace", type=float, default=2.0)
    args = parser.parse_args()

    sys.stdout.reconfigure(
        encoding="utf-8", errors="replace", line_buffering=True
    )
    done = already_done(args.pairs)
    parents = [p for p in read_jsonl(args.parents) if p["id"] not in done]
    parents = parents[: args.target]
    print(f"agy lane ({args.model}): {len(parents)} pais (resume-skip={len(done)})")

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
        for index, parent in enumerate(parents, start=1):
            prompt = MIX_TEMPLATES[TEMPLATE_ID]().format(
                parent=parent["text"][:6000]
            )
            edited = None
            for attempt in range(args.item_retries):
                try:
                    edited = run_agy(
                        prompt, args.model, args.timeout, args.agy_bin, workdir
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
            pairs_out.write(
                json.dumps(
                    {
                        "parentId": parent["id"],
                        "parentText": parent["text"],
                        "editedText": edited,
                        "family": parent.get("family", "?"),
                        "provider": "antigravity",
                        "model": args.model,
                        # WHICH template and WHICH binary produced this pair. This
                        # lane sends one template and runs no nudge retry, so the id
                        # is constant here — but it is RECORDED rather than assumed
                        # downstream, because assemble_corpus refuses a mixed row that
                        # does not name its own recipe instead of guessing one.
                        "promptTemplateId": TEMPLATE_ID,
                        "harnessVersion": captured_harness,
                    },
                    ensure_ascii=False,
                )
                + "\n"
            )
            pairs_out.flush()
            kept += 1
            if index % 10 == 0:
                print(f"  {index}/{len(parents)} (kept={kept})")
            time.sleep(args.pace)
    print(f"pares agy: {kept} -> {args.pairs}")


if __name__ == "__main__":
    main()
