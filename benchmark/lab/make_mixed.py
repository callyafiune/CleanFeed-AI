"""Builds the MIXED class: AI-edited human parents with per-span provenance.

The sealed schema requires mixture = {aiFraction, humanFraction, spans:
[{start, end, origin}]} where spans TILE the final text and fractions sum to 1.
Spans are derived mechanically from a character diff (difflib) between the
HUMAN parent and the AI-EDITED result: equal blocks keep origin "human";
replaced/inserted blocks are origin "ai". No LLM self-reporting — the diff IS
the provenance.

Two modes:
  --from-pairs pares.jsonl   # {parentId, parentText, editedText} já prontos
  --generate                 # pede a edição a um provedor (gemini via keys.env)

Sealed-corpus rule: parents MUST come from the reserved bucket (never trained).

Usage (generation, resume-safe):
  python make_mixed.py --generate --parents ../data/dataset/reserved.jsonl \
    --output ../data/candidates/mixed_candidates.jsonl --target 100
"""

from __future__ import annotations

import argparse
import difflib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

EDIT_PROMPT = (
    "Edite levemente o texto abaixo em português do Brasil: melhore a clareza e "
    "o encadeamento de 2 a 4 trechos, mantendo a MAIOR PARTE do texto original "
    "intacta (não reescreva tudo), sem mudar o sentido. Responda apenas com o "
    "texto editado, sem comentários.\n\n=== TEXTO ===\n{parent}"
)


def _word_offsets(text: str) -> list[tuple[str, int, int]]:
    """(token, start, end) for whitespace-delimited tokens, offsets in chars."""
    out: list[tuple[str, int, int]] = []
    index = 0
    for token in text.split():
        start = text.index(token, index)
        out.append((token, start, start + len(token)))
        index = start + len(token)
    return out


def compute_mixture(parent: str, edited: str) -> dict:
    """Spans over the EDITED text from a WORD-level diff vs the parent.

    Word-level (not char-level) so accidental character coincidences do not
    fragment provenance into confetti spans. equal -> origin "human";
    replace/insert -> origin "ai" (deletes leave no span in the edited text).
    Inter-word whitespace inherits the span it precedes; adjacent same-origin
    spans are coalesced; the result tiles [0, len(edited)) and fractions are
    char-length ratios.
    """
    parent_words = _word_offsets(parent)
    edited_words = _word_offsets(edited)
    matcher = difflib.SequenceMatcher(
        a=[w for w, _, _ in parent_words],
        b=[w for w, _, _ in edited_words],
        autojunk=False,
    )
    raw: list[tuple[int, int, str]] = []
    cursor = 0
    for tag, _i1, _i2, j1, j2 in matcher.get_opcodes():
        if j2 <= j1:
            continue
        end = edited_words[j2 - 1][2] if j2 - 1 < len(edited_words) else cursor
        origin = "human" if tag == "equal" else "ai"
        raw.append((cursor, end, origin))
        cursor = end
    if edited and (not raw or raw[-1][1] < len(edited)):
        # Trailing whitespace/punctuation resto: herda a última origem.
        last_origin = raw[-1][2] if raw else "human"
        raw.append((raw[-1][1] if raw else 0, len(edited), last_origin))

    spans: list[dict] = []
    for start, end, origin in raw:
        if spans and spans[-1]["origin"] == origin and spans[-1]["end"] == start:
            spans[-1]["end"] = end
        else:
            spans.append({"start": start, "end": end, "origin": origin})

    total = len(edited)
    ai_chars = sum(s["end"] - s["start"] for s in spans if s["origin"] == "ai")
    ai_fraction = ai_chars / total if total else 0.0
    return {
        "aiFraction": round(ai_fraction, 6),
        "humanFraction": round(1 - ai_fraction, 6),
        "spans": spans,
    }


def interleave_by_family(pending: list[dict]) -> list[dict]:
    """Round-robin by family, preserving in-family order.

    The reserved split is grouped by family; slicing "the first N" would make
    a single-register mixed class whenever quota stops a batch early. After
    interleaving, any prefix is close to maximally register-diverse.
    """
    by_family: dict[str, list[dict]] = {}
    for parent in pending:
        by_family.setdefault(parent.get("family", "?"), []).append(parent)
    from itertools import zip_longest

    return [
        parent
        for group in zip_longest(*by_family.values())
        for parent in group
        if parent is not None
    ]


def read_jsonl(path: Path) -> list[dict]:
    with path.open(encoding="utf-8") as handle:
        return [json.loads(line) for line in handle if line.strip()]


def already_done(output: Path) -> set[str]:
    done: set[str] = set()
    if output.exists():
        for row in read_jsonl(output):
            done.add(row.get("parentId", ""))
    return done


def emit(output, parent_row, edited: str, provider: str, model: str) -> None:
    mixture = compute_mixture(parent_row["text"], edited)
    record = {
        "parentId": parent_row["id"],
        "text": edited,
        "mixture": mixture,
        "provider": provider,
        "model": model,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "parentFamily": parent_row.get("family", "?"),
    }
    output.write(json.dumps(record, ensure_ascii=False) + "\n")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--from-pairs", type=Path, default=None)
    parser.add_argument("--generate", action="store_true")
    parser.add_argument("--parents", type=Path, default=None)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--target", type=int, default=100)
    parser.add_argument("--sleep", type=float, default=6.0)
    parser.add_argument("--model", default="gemini-flash-lite-latest")
    parser.add_argument(
        "--cooldown",
        type=float,
        default=70.0,
        help="segundos de espera quando o 429 persiste (bucket ~1 req/min)",
    )
    parser.add_argument(
        "--max-cooldowns",
        type=int,
        default=8,
        help="429s consecutivos antes de tratar como cota do dia e parar",
    )
    args = parser.parse_args()

    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    done = already_done(args.output)

    with args.output.open("a", encoding="utf-8", newline="\n") as output:
        if args.from_pairs is not None:
            emitted = 0
            for pair in read_jsonl(args.from_pairs):
                if pair["parentId"] in done:
                    continue
                emit(
                    output,
                    {"id": pair["parentId"], "text": pair["parentText"]},
                    pair["editedText"],
                    provider=pair.get("provider", "external"),
                    model=pair.get("model", "external"),
                )
                emitted += 1
            print(f"pares importados: {emitted}")
            return

        if not args.generate or args.parents is None:
            raise SystemExit("use --from-pairs OU --generate com --parents")

        sys.path.insert(0, str(Path(__file__).parent))
        import os

        from generate_ai import GenerationRefused, call_provider, call_with_retries
        import urllib.error

        keys = {
            "gemini": os.environ.get("GEMINI_API_KEY", "")
            or os.environ.get("GOOGLE_API_KEY", ""),
            "openai": os.environ.get("OPENAI_API_KEY", ""),
            "anthropic": os.environ.get("ANTHROPIC_API_KEY", ""),
        }
        if not keys["gemini"]:
            raise SystemExit("defina GEMINI_API_KEY (keys.env)")

        # Sealed rule: parents come from the RESERVED split (label 0 only).
        parents = [
            {"id": r["id"], "text": r["text"], "family": r.get("family", "?")}
            for r in read_jsonl(args.parents)
            if r.get("label") == 0 and 50 <= len(r["text"].split()) <= 450
        ]
        def edit_with_cooldown(prompt: str) -> str | None:
            """None = 429 persistiu além do teto (cota do dia): aborta o lote.

            O free tier do Gemini é um token bucket (rajada ~3, recarga
            ~1 req/min): o backoff curto do call_with_retries não alcança a
            recarga, então quem espera o bucket é este loop — a lane se
            auto-regula à cota disponível em vez de morrer no primeiro 429.
            """
            streak = 0
            while True:
                try:
                    return call_with_retries(
                        call_provider, "gemini", args.model, prompt, None, keys
                    )
                except urllib.error.HTTPError as error:
                    if error.code != 429:
                        raise
                    streak += 1
                    if streak > args.max_cooldowns:
                        return None
                    print(
                        f"  429 — cooldown {streak}/{args.max_cooldowns} "
                        f"({args.cooldown:.0f}s)"
                    )
                    time.sleep(args.cooldown)

        pending = interleave_by_family(
            [p for p in parents if p["id"] not in done]
        )[: args.target]
        print(f"gerando {len(pending)} mistos (resume-skip={len(done)})")
        kept = 0
        for index, parent in enumerate(pending, start=1):
            prompt = EDIT_PROMPT.format(parent=parent["text"][:6000])
            try:
                edited = edit_with_cooldown(prompt)
            except GenerationRefused as refused:
                print(f"  {parent['id']} recusado: {refused}")
                continue
            if edited is None:
                print(f"  cota persistente após {kept} — resume automático depois")
                break
            mixture = compute_mixture(parent["text"], edited)
            # An edit that rewrote (quase) tudo não é "misto" — descarta.
            if not 0.05 <= mixture["aiFraction"] <= 0.7:
                print(
                    f"  {parent['id']} fora da faixa mista "
                    f"(aiFraction={mixture['aiFraction']:.2f}) — descartado"
                )
                continue
            emit(output, parent, edited, provider="gemini", model=args.model)
            kept += 1
            if index % 10 == 0:
                print(f"  {index}/{len(pending)} (kept={kept})")
            time.sleep(args.sleep)
        print(f"mistos gerados: {kept}")


if __name__ == "__main__":
    main()
