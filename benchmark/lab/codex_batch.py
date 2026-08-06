"""Codex-CLI batch driver — the OpenAI frontier lane without API credits.

Drives `codex exec` (the user's ChatGPT-subscription CLI) in sequential chunks
of topic-paired generations. Pairs are selected deterministically (same
select_pairs as the API lane), each parent gets its deterministic recipe, and
chunks are SINGLE-RECIPE (one instruction per chunk, items as JSON with
pairedWith/targetWords/reference). The final message is written by codex to a
raw file (-o), parsed fail-closed, and pushed through the shared candidate
pipeline with the full session-style recipe (generationMode=codex-cli;
seed/temperature not exposed -> seedNullReason).

Resume-safe: already-generated pairedWith ids are skipped; a failed/timeout
chunk is skipped and its items return to the pool on the next run.

Usage:
  python codex_batch.py --humans <files...> --output ../data/candidates/ai_openai.jsonl \
    [--target 2000] [--chunk-size 20] [--max-chunks 100]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path

from common import CandidateWriter
from generate_ai import (
    load_humans,
    already_paired,
    select_pairs,
    recipe_for,
    target_word_count,
)

LICENSE_ID = "geracao-propria-v1"
SEED_NULL_REASON = (
    "codex CLI session: sampling seed and temperature are not exposed"
)

CHUNK_INSTRUCTIONS: dict[str, str] = {
    "original": (
        "Para CADA item do array JSON abaixo, escreva um texto ORIGINAL em "
        "português do Brasil sobre o MESMO ASSUNTO do campo 'reference', com "
        "aproximadamente 'targetWords' palavras. Não copie frases nem a "
        "estrutura da referência."
    ),
    "parafrase": (
        "Para CADA item do array JSON abaixo, reescreva o texto do campo "
        "'reference' em português do Brasil com as suas próprias palavras, "
        "mantendo o significado, com aproximadamente 'targetWords' palavras."
    ),
    "social": (
        "Para CADA item do array JSON abaixo, escreva um post de rede social "
        "profissional em português do Brasil sobre o tema central do campo "
        "'reference', com aproximadamente 'targetWords' palavras, em tom de "
        "publicação de feed (parágrafos curtos). Não copie frases da referência."
    ),
    "humanizado": (
        "Para CADA item do array JSON abaixo, escreva um texto casual e "
        "espontâneo em português do Brasil sobre o mesmo assunto do campo "
        "'reference', com aproximadamente 'targetWords' palavras, como uma "
        "pessoa comum escreveria rapidamente — natural, direto, com leve "
        "informalidade. Não copie frases da referência."
    ),
}
COMMON_SUFFIX = (
    " Regras para todos: sem título, sem comentários meta, sem numeração; "
    "NUNCA inclua e-mails, @handles, telefones, CPF ou nomes de pessoas reais. "
    "RESPONDA SOMENTE com um array JSON válido: "
    '[{"pairedWith": "<id>", "text": "<texto>"}, ...] — nada antes nem depois.'
)


def chunk_pairs(
    pairs: list[dict], provider: str, size: int
) -> list[tuple[str, list[dict]]]:
    """Groups pairs by their deterministic recipe into single-recipe chunks."""
    by_recipe: dict[str, list[dict]] = {}
    for row in pairs:
        by_recipe.setdefault(recipe_for(provider, row["candidateId"]), []).append(row)
    chunks: list[tuple[str, list[dict]]] = []
    for recipe, rows in sorted(by_recipe.items()):
        for start in range(0, len(rows), size):
            chunks.append((recipe, rows[start : start + size]))
    return chunks


def chunk_prompt(recipe: str, rows: list[dict]) -> str:
    # `targetWords` is the seed's OWN word count, through the same function the REST
    # lane uses: the length distribution of the generated class has to match the human
    # one in EVERY lane, or the word count becomes a proxy for the lane, and
    # `generationLane` is a grouping axis. A clamp here would leave the codex lane — the
    # OpenAI families, reserved for the unseen-generator test — with a truncated copy of
    # the human distribution while the other lanes carry the whole of it.
    items = [
        {
            "pairedWith": row["candidateId"],
            "targetWords": target_word_count(int(row["wordCount"])),
            "reference": row["text"][:1200],
        }
        for row in rows
    ]
    return (
        CHUNK_INSTRUCTIONS[recipe]
        + COMMON_SUFFIX
        + "\n\nITENS:\n"
        + json.dumps(items, ensure_ascii=False)
    )


def run_codex(codex: str, prompt: str, raw_path: Path) -> str | None:
    """Runs one codex exec; returns the model name from the header, or None."""
    with tempfile.NamedTemporaryFile(
        "w", suffix=".txt", delete=False, encoding="utf-8"
    ) as handle:
        handle.write(prompt)
        prompt_file = Path(handle.name)
    try:
        with prompt_file.open("r", encoding="utf-8") as stdin:
            result = subprocess.run(
                [
                    codex,
                    "exec",
                    "-s",
                    "read-only",
                    "--skip-git-repo-check",
                    "-o",
                    str(raw_path),
                    "-",
                ],
                stdin=stdin,
                capture_output=True,
                text=True,
                timeout=900,
            )
        match = re.search(r"model:\s*(\S+)", result.stderr or "")
        return match.group(1) if match else "codex-default"
    except subprocess.TimeoutExpired:
        return None
    finally:
        prompt_file.unlink(missing_ok=True)


def parse_array(raw_path: Path) -> list[dict]:
    if not raw_path.exists():
        return []
    raw = raw_path.read_text(encoding="utf-8", errors="replace")
    start, end = raw.find("["), raw.rfind("]")
    if start < 0 or end <= start:
        return []
    try:
        data = json.loads(raw[start : end + 1])
    except json.JSONDecodeError:
        return []
    return [
        item
        for item in data
        if isinstance(item.get("pairedWith"), str)
        and isinstance(item.get("text"), str)
        and item["text"].strip()
    ]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--humans", required=True, nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--target", type=int, default=2000)
    parser.add_argument("--chunk-size", type=int, default=20)
    parser.add_argument("--max-chunks", type=int, default=120)
    args = parser.parse_args()

    codex = shutil.which("codex")
    if codex is None:
        raise SystemExit("codex CLI não encontrado no PATH")

    humans = load_humans(args.humans)
    done = already_paired(args.output)
    pairs = select_pairs(humans, "openai", args.target, done)
    chunks = chunk_pairs(pairs, "openai", args.chunk_size)[: args.max_chunks]
    print(
        f"codex lane: {sum(len(c[1]) for c in chunks)} itens em {len(chunks)} chunks "
        f"(resume-skip={len(done)})"
    )

    writer = CandidateWriter(
        args.output,
        source_id="src_ai_openai",
        limit=10**9,
        sample_rate=1,
        date_cutoff=None,
        append=True,
        start_sequence=len(done),
    )
    raw_path = args.output.parent / "_session" / "codex_batch.raw"
    raw_path.parent.mkdir(parents=True, exist_ok=True)
    failed = 0
    try:
        for index, (recipe, rows) in enumerate(chunks, start=1):
            prompt = chunk_prompt(recipe, rows)
            raw_path.unlink(missing_ok=True)
            model = run_codex(codex, prompt, raw_path)
            items = parse_array(raw_path) if model is not None else []
            if not items:
                failed += 1
                print(f"  chunk {index}/{len(chunks)} [{recipe}] FALHOU (pulado)")
                continue
            generated_at = datetime.now(timezone.utc)
            prompt_sha = hashlib.sha256(prompt.encode("utf-8")).hexdigest()
            template_sha = hashlib.sha256(
                (CHUNK_INSTRUCTIONS[recipe] + COMMON_SUFFIX).encode("utf-8")
            ).hexdigest()
            for item in items:
                if item["pairedWith"] in done:
                    continue
                done.add(item["pairedWith"])
                writer.offer(
                    natural_key=f"ai:openai:{item['pairedWith']}",
                    license_id=LICENSE_ID,
                    created_at=generated_at,
                    raw_text=item["text"],
                    domain_source="ai_openai",
                    meta={
                        "provider": "openai",
                        "family": model,
                        "model": model,
                        "version": model,
                        "recipe": recipe,
                        "temperature": "",
                        "seed": "",
                        "seedNullReason": SEED_NULL_REASON,
                        "promptId": f"{recipe}_chunk{index}",
                        "promptSha256": prompt_sha,
                        "promptTemplateDigest": template_sha,
                        "generatedAt": generated_at.isoformat(),
                        "pairedWith": item["pairedWith"],
                        "generationMode": "codex-cli",
                    },
                )
            print(
                f"  chunk {index}/{len(chunks)} [{recipe}] ok "
                f"(+{len(items)}, kept={writer.stats.kept})"
            )
    finally:
        writer.close()
    print(
        f"codex lane: kept={writer.stats.kept} chunks_falhos={failed} "
        f"pii_dropped={writer.stats.drop_pii}"
    )


if __name__ == "__main__":
    main()
