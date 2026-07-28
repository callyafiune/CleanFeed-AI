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
import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

# O modo de falha depende do registro do pai: em texto informal o modelo
# tende a reescrever tudo (aiFraction > 0.7); em texto já polido, a devolver
# uma cópia idêntica (0.0). Daí o "copie palavra por palavra, sem corrigir" e
# os dois prompts corretivos usados no nudge retry.
EDIT_PROMPT = (
    "Reescreva com suas palavras de 2 a 4 frases do texto abaixo, em português "
    "do Brasil, preservando o sentido. Copie TODAS as outras frases exatamente "
    "como estão, palavra por palavra, sem corrigir nem melhorar nada nelas — "
    "mude no máximo um terço do texto. Responda apenas com o texto completo "
    "resultante, sem comentários.\n\n=== TEXTO ===\n{parent}"
)
PROMPT_CHANGE_LESS = (
    "Reescreva com suas palavras APENAS 2 frases curtas do texto abaixo, em "
    "português do Brasil, preservando o sentido. Copie todo o resto exatamente "
    "como está, palavra por palavra, sem corrigir nem melhorar nada — é "
    "obrigatório que a maior parte do texto fique idêntica ao original. "
    "Responda apenas com o texto completo resultante, sem comentários."
    "\n\n=== TEXTO ===\n{parent}"
)
PROMPT_CHANGE_MORE = (
    "Reescreva com suas palavras EXATAMENTE 3 frases do texto abaixo (escolha "
    "as mais longas), em português do Brasil, preservando o sentido — é "
    "obrigatório reformular essas 3 frases, não as copie. Copie todas as "
    "outras frases exatamente como estão, palavra por palavra. Responda apenas "
    "com o texto completo resultante, sem comentários.\n\n=== TEXTO ===\n{parent}"
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


MIXED_BAND = (0.05, 0.7)


def in_mixed_band(mixture: dict) -> bool:
    """An edit that rewrote (quase) tudo não é "misto"; idem cópia fiel."""
    return MIXED_BAND[0] <= mixture["aiFraction"] <= MIXED_BAND[1]


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


# The mixing templates, each identified by the digest of its own bytes, so
# `groups.promptTemplate` groups mixed rows by the recipe that actually produced them.
#
# THREE and not one, because the nudge retry is part of the recipe: a row whose first
# edit fell outside the mixed band was re-asked with PROMPT_CHANGE_LESS or
# PROMPT_CHANGE_MORE, and the text that survived came out of THAT template. Recording
# only EDIT_PROMPT would put rows produced by different prompts into one cluster.
#
# The pools already on disk record none of this, and it is NOT reconstructable from
# them: nothing in a written row says whether a nudge fired. So the assembler refuses
# those rows (MissingRecipe) instead of stamping them with whichever template this
# file holds today — see assemble_corpus.mixed_record.
MIX_TEMPLATES = {
    "mix_edit_v1": lambda: EDIT_PROMPT,
    "mix_change_less_v1": lambda: PROMPT_CHANGE_LESS,
    "mix_change_more_v1": lambda: PROMPT_CHANGE_MORE,
}


def mix_template_digest(template_id: str) -> str:
    return hashlib.sha256(
        MIX_TEMPLATES[template_id]().encode("utf-8")
    ).hexdigest()


def emit(
    output,
    parent_row,
    edited: str,
    provider: str,
    model: str,
    template_id: str = "mix_edit_v1",
    harness_version: str | None = None,
) -> None:
    mixture = compute_mixture(parent_row["text"], edited)
    record = {
        "parentId": parent_row["id"],
        "text": edited,
        "mixture": mixture,
        "provider": provider,
        "model": model,
        # WHICH template produced this row, and its digest. Persisted from this run
        # rather than derivable later, which is the whole point: a mixed row is a
        # controlled generation, so v3 requires a recipe on it, and the recipe has to
        # be captured while the run still knows which prompt it sent.
        "promptTemplateId": template_id,
        "promptTemplateDigest": mix_template_digest(template_id),
        # The editor binary's version on the CLI lanes, so the mixed rows can be
        # eligible for the same reason the generated ones can. None when the lane is
        # an API call or the capture failed — never a placeholder.
        "harnessVersion": harness_version,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "parentFamily": parent_row.get("family", "?"),
    }
    output.write(json.dumps(record, ensure_ascii=False) + "\n")
    # Cada registro custou cota real — nada pode viver só no buffer.
    output.flush()


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
        "--models",
        default=None,
        help="lista separada por vírgula: rotaciona modelos ao esbarrar em "
        "429 (buckets de cota são POR MODELO) e remove os que respondem 404; "
        "sobrepõe --model",
    )
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
    parser.add_argument(
        "--assume-template",
        default=None,
        choices=sorted(MIX_TEMPLATES),
        help="afirma qual template produziu um arquivo de pares ANTIGO, que não grava "
        "o campo. Só é verdadeiro para lanes de um único prompt sem nudge retry "
        "(make_mixed_agy.py, make_mixed_codex.py hoje) — sem isto a importação de um "
        "par sem template FALHA em vez de supor",
    )
    parser.add_argument(
        "--assume-harness",
        default=None,
        help="idem para a versão do binário editor de um arquivo de pares antigo. "
        "Ausente => o eixo fica unknown e os registros ficam inelegíveis, que é o "
        "resultado honesto",
    )
    parser.add_argument(
        "--nudge-retries",
        type=int,
        default=1,
        help="novas tentativas com prompt corretivo quando a edição sai da "
        "faixa mista (0 desliga)",
    )
    args = parser.parse_args()

    sys.stdout.reconfigure(
        encoding="utf-8", errors="replace", line_buffering=True
    )
    done = already_done(args.output)
    # Bound once, so the assertion the operator made on the command line is read in
    # exactly one place and reported when it is used.
    assumed_template = args.assume_template
    if assumed_template is not None:
        print(
            f"assumindo template {assumed_template} "
            f"(digest {mix_template_digest(assumed_template)[:16]}) para pares que "
            "não declaram o campo — afirmação do operador, não dado do arquivo"
        )

    with args.output.open("a", encoding="utf-8", newline="\n") as output:
        if args.from_pairs is not None:
            emitted = skipped = 0
            for pair in read_jsonl(args.from_pairs):
                if pair["parentId"] in done:
                    continue
                mixture = compute_mixture(pair["parentText"], pair["editedText"])
                if not in_mixed_band(mixture):
                    print(
                        f"  {pair['parentId']} fora da faixa mista "
                        f"(aiFraction={mixture['aiFraction']:.2f}) — descartado"
                    )
                    skipped += 1
                    continue
                if not pair.get("promptTemplateId") and assumed_template is None:
                    raise SystemExit(
                        f"o par {pair['parentId']} não declara promptTemplateId e "
                        "--assume-template não foi passado. Um registro misto é uma "
                        "geração controlada, então a v3 exige a receita nele; supor "
                        "um template aqui atribuiria uma receita que a linha não "
                        "sustenta"
                    )
                emit(
                    output,
                    {
                        "id": pair["parentId"],
                        "text": pair["parentText"],
                        "family": pair.get("family", "?"),
                    },
                    pair["editedText"],
                    provider=pair.get("provider", "external"),
                    model=pair.get("model", "external"),
                    # The template the pair itself declares. A pairs file written
                    # before that field existed declares nothing, and the fallback is
                    # NOT a default in this code: `--assume-template` makes the
                    # operator assert it on the command line, so the assertion is
                    # visible in the shell history that produced the corpus instead of
                    # buried in a `or` here.
                    #
                    # For the two existing pair-producing lanes that assertion is
                    # checkable rather than a guess: make_mixed_agy.py and
                    # make_mixed_codex.py send ONE template and have no corrective
                    # retry (the nudge lives in the --generate path below), so
                    # `mix_edit_v1` is what ran. A future pairs lane that nudges would
                    # break that, which is exactly why it must not be silent.
                    template_id=pair.get("promptTemplateId") or assumed_template,
                    harness_version=pair.get("harnessVersion") or args.assume_harness,
                )
                emitted += 1
            print(f"pares importados: {emitted} (fora da faixa: {skipped})")
            return

        if not args.generate or args.parents is None:
            raise SystemExit("use --from-pairs OU --generate com --parents")

        sys.path.insert(0, str(Path(__file__).parent))
        import os

        from generate_ai import (
            RETRIABLE,
            GenerationRefused,
            call_provider,
            call_with_retries,
        )
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
        models = (
            [m.strip() for m in args.models.split(",") if m.strip()]
            if args.models
            else [args.model]
        )
        state = {"i": 0}

        def edit_with_failover(prompt: str) -> tuple[str, str] | None:
            """(texto, modelo) — ou None quando TODOS os modelos esgotaram.

            Cotas do free tier são POR MODELO: no 429, pula imediatamente
            para o próximo bucket (fica "grudado" no que funcionou); só
            dorme --cooldown quando uma rodada inteira falhou, e desiste
            após --max-cooldowns rodadas secas. Modelos que respondem 404
            (descomissionados) saem da rotação.
            """
            dry_rounds = 0
            while dry_rounds <= args.max_cooldowns:
                for _ in range(len(models)):
                    model = models[state["i"] % len(models)]
                    try:
                        text = call_with_retries(
                            call_provider, "gemini", model, prompt, None, keys
                        )
                        return text, model
                    except urllib.error.HTTPError as error:
                        if error.code == 404:
                            print(f"  {model} respondeu 404 — fora da rotação")
                            models.remove(model)
                            if not models:
                                return None
                            continue
                        if error.code not in RETRIABLE:
                            raise
                        # 429 e 5xx persistentes = bucket/backend deste modelo
                        # indisponível agora: pula para o próximo.
                        state["i"] += 1
                    except OSError:
                        # Timeout/reset que sobreviveu aos retries: trata o
                        # modelo como indisponível e roda a rotação.
                        state["i"] += 1
                dry_rounds += 1
                if dry_rounds <= args.max_cooldowns:
                    print(
                        f"  todos os modelos em 429 — cooldown "
                        f"{dry_rounds}/{args.max_cooldowns} ({args.cooldown:.0f}s)"
                    )
                    time.sleep(args.cooldown)
            return None

        in_band = in_mixed_band

        pending = interleave_by_family(
            [p for p in parents if p["id"] not in done]
        )[: args.target]
        print(f"gerando {len(pending)} mistos (resume-skip={len(done)})")
        kept = 0
        for index, parent in enumerate(pending, start=1):
            # Reset PER PARENT, not once outside the loop: a nudge on one row must not
            # leave the next row claiming the corrective template it never saw.
            template_id = "mix_edit_v1"
            try:
                result = edit_with_failover(
                    MIX_TEMPLATES[template_id]().format(parent=parent["text"][:6000])
                )
                mixture = (
                    compute_mixture(parent["text"], result[0]) if result else None
                )
                for _ in range(args.nudge_retries):
                    if result is None or in_band(mixture):
                        break
                    # The nudge sends a DIFFERENT template, so the id has to move
                    # with it: the surviving text came out of this prompt, not out of
                    # EDIT_PROMPT, and grouping the two together would put rows
                    # produced by different recipes in one promptTemplate cluster.
                    template_id = (
                        "mix_change_less_v1"
                        if mixture["aiFraction"] > MIXED_BAND[1]
                        else "mix_change_more_v1"
                    )
                    template = MIX_TEMPLATES[template_id]()
                    result = edit_with_failover(
                        template.format(parent=parent["text"][:6000])
                    )
                    if result is not None:
                        mixture = compute_mixture(parent["text"], result[0])
            except GenerationRefused as refused:
                print(f"  {parent['id']} recusado: {refused}")
                continue
            if result is None:
                print(f"  cota persistente após {kept} — resume automático depois")
                break
            if not in_band(mixture):
                print(
                    f"  {parent['id']} fora da faixa mista "
                    f"(aiFraction={mixture['aiFraction']:.2f}) — descartado"
                )
                continue
            edited, used_model = result
            emit(
                output,
                parent,
                edited,
                provider="gemini",
                model=used_model,
                template_id=template_id,
                # gemini-api is a direct API call: no harness binary runs, so there is
                # no version to attribute and the axis is notApplicable downstream.
                harness_version=None,
            )
            kept += 1
            if index % 10 == 0:
                print(f"  {index}/{len(pending)} (kept={kept})")
            time.sleep(args.sleep)
        print(f"mistos gerados: {kept}")


if __name__ == "__main__":
    main()
