"""Codex CLI lane for the mixed class: AI edits via the user's ChatGPT plan.

Runs `codex exec` (read-only sandbox, ephemeral, outside the repo) once per
parent with make_mixed's EDIT_PROMPT and appends {parentId, parentText,
editedText, family, provider, model} pairs. Import them afterwards with

  python make_mixed.py --from-pairs pares.jsonl --output mixed.jsonl

(the import recomputes the diff provenance and enforces the mixed band).

Resume-safe by parentId. The recorded model is parsed from the codex banner
("model: gpt-5.6-luna"). Stops after --max-failures consecutive errors so a
dead subscription/limit doesn't burn the whole parent list.

Windows PATH trap: CreateProcess appends ".exe" when resolving a bare
"codex", which can silently pick an OLD native-app install over the npm CLI
(shells pick the npm shim instead — same name, different binary, and the
server rejects outdated clients per model). Pass --codex-bin with the full
path to the npm vendored codex.exe to pin the right one.

Usage:
  python make_mixed_codex.py --parents codex_parents.jsonl \
    --pairs ../data/candidates/mixed_pairs_codex.jsonl [--target 200]
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from make_mixed import EDIT_PROMPT, already_done, read_jsonl


def run_codex(
    prompt: str, workdir: Path, model: str | None, timeout: int, codex_bin: str
) -> tuple[str, str]:
    """One codex exec call -> (edited_text, banner_log). Raises on failure."""
    out_file = workdir / "last_message.txt"
    out_file.unlink(missing_ok=True)
    argv = [
        codex_bin, "exec",
        "--sandbox", "read-only",
        "--ephemeral",
        "--skip-git-repo-check",
        "--cd", str(workdir),
        "--color", "never",
        "--output-last-message", str(out_file),
        "-",
    ]
    if model:
        argv[2:2] = ["--model", model]
    proc = subprocess.run(
        argv,
        input=prompt.encode("utf-8"),
        capture_output=True,
        timeout=timeout,
    )
    log = proc.stdout.decode("utf-8", errors="replace")
    if proc.returncode != 0:
        raise RuntimeError(
            f"codex exit {proc.returncode}: "
            f"{proc.stderr.decode('utf-8', errors='replace')[-300:]}"
        )
    edited = out_file.read_text(encoding="utf-8").strip()
    if not edited:
        raise RuntimeError("codex devolveu mensagem final vazia")
    return edited, log


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--parents", required=True, type=Path)
    parser.add_argument("--pairs", required=True, type=Path)
    parser.add_argument("--target", type=int, default=200)
    parser.add_argument("--model", default=None, help="passa --model ao codex")
    parser.add_argument("--timeout", type=int, default=300)
    parser.add_argument(
        "--codex-bin",
        default="codex",
        help="caminho do binário codex (evita a armadilha CreateProcess/.exe)",
    )
    parser.add_argument("--max-failures", type=int, default=3)
    parser.add_argument(
        "--item-retries",
        type=int,
        default=3,
        help="tentativas por pai — o gate de versão do servidor codex é "
        "intermitente (mesma chamada ora passa, ora leva 400)",
    )
    parser.add_argument("--retry-backoff", type=float, default=15.0)
    parser.add_argument("--pace", type=float, default=3.0)
    args = parser.parse_args()

    sys.stdout.reconfigure(
        encoding="utf-8", errors="replace", line_buffering=True
    )
    done = already_done(args.pairs)
    parents = [p for p in read_jsonl(args.parents) if p["id"] not in done]
    parents = parents[: args.target]
    print(f"codex lane: {len(parents)} pais (resume-skip={len(done)})")

    workdir = Path(tempfile.mkdtemp(prefix="codex_mixed_"))
    detected_model = args.model or ""
    failures = 0
    kept = 0
    with args.pairs.open("a", encoding="utf-8", newline="\n") as pairs_out:
        for index, parent in enumerate(parents, start=1):
            prompt = EDIT_PROMPT.format(parent=parent["text"][:6000])
            edited = log = None
            for attempt in range(args.item_retries):
                try:
                    edited, log = run_codex(
                        prompt, workdir, args.model, args.timeout, args.codex_bin
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
            if not detected_model:
                match = re.search(r"^model:\s*(\S+)", log, re.MULTILINE)
                detected_model = match.group(1) if match else "codex-desconhecido"
            pairs_out.write(
                json.dumps(
                    {
                        "parentId": parent["id"],
                        "parentText": parent["text"],
                        "editedText": edited,
                        "family": parent.get("family", "?"),
                        "provider": "openai",
                        "model": detected_model,
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
    print(f"pares codex: {kept} -> {args.pairs}")


if __name__ == "__main__":
    main()
