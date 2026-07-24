"""Generates the AI class, TOPIC-PAIRED with the human candidates.

For each deterministically-sampled human candidate, asks a provider model to
write an ORIGINAL pt-BR text on the same subject with a similar length. Topic
pairing prevents the classic corpus artifact where a classifier learns
"topic/era" instead of authorship; asking for an original text (never a
rewrite) avoids near-dup collisions with the human parent. The model's default
style IS the signal we want to detect, so the prompt applies no style tricks.

Every output carries the FULL generation recipe the closed schema requires
(provider/family/model/temperature/seed or seedNullReason/promptId/
promptSha256/generatedAt) plus a batch metadata file for the source-manifest.
Outputs run through the shared candidate pipeline (normalize -> word window ->
PII drop), with the pre-ChatGPT date cutoff disabled (these are generated NOW).

Stdlib only (urllib against the three REST APIs). Keys come from the
environment and are NEVER printed or stored:
  OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY (or GOOGLE_API_KEY)

Usage (pilot):
  python benchmark/lab/generate_ai.py --provider anthropic \
    --humans ../data/candidates/ptso.jsonl ../data/candidates/carolina.jsonl \
    --output ../data/candidates/ai_anthropic.jsonl --per-provider 60
  (idem para --provider openai | gemini; --dry-run mostra o plano sem chamar API)
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import shutil
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from common import CandidateWriter, keep_sample

LICENSE_ID = "geracao-propria-v1"

# CLI generation channels (no API key — the user's own logged-in subscriptions).
# These carry the HELD-OUT generator families (models never seen in training):
# agy serves claude-sonnet-4-6, gpt-oss-120b, gemini-3.x, opus-4-6.
AGY_BIN = os.environ.get(
    "AGY_BIN", str(Path.home() / "AppData" / "Local" / "agy" / "bin" / "agy.exe")
)
CLI_PROVIDERS = {"agy", "codex"}


def codex_command() -> list[str]:
    """The codex CLI as an argv prefix.

    Resolves to `node <npm>/node_modules/@openai/codex/bin/codex.js` when that
    entrypoint is present, because launching codex any other way here reaches a
    STALE build: this machine also has a native install under
    AppData/Local/Programs/OpenAI/Codex whose server-side handshake rejects
    current models with "The '<model>' model requires a newer version of Codex"
    even though `codex --version` reports the same 0.145.0. The npm entrypoint
    accepts the same argv, model flag included.

    Override with CODEX_BIN (split on spaces, so `node C:/path/codex.js` works).
    """
    override = os.environ.get("CODEX_BIN")
    if override:
        return shlex.split(override, posix=False)
    shim = shutil.which("codex")
    node = shutil.which("node")
    if shim and node:
        entry = (
            Path(shim).parent / "node_modules" / "@openai" / "codex" / "bin" / "codex.js"
        )
        if entry.exists():
            return [node, str(entry)]
    return ["codex"]

# The V2 plan's recipe mix. `parafrase` is a deliberate near-dup of its parent
# (hard positive for TRAINING ONLY — the sealed eval assembly's cross-lineage
# near-dup refusal would reject it, by design). `humanizado` measures robustness
# to "make it sound human" prompting. Weights sum to 10 (deterministic buckets).
RECIPES: dict[str, dict] = {
    "original": {
        "weight": 5,
        "template": (
            "Escreva um texto original em português do Brasil sobre o mesmo "
            "assunto do texto de referência abaixo, com aproximadamente {words} "
            "palavras. Não copie frases nem a estrutura do texto de referência; "
            "produza um texto novo, seu, sobre o mesmo tema. Responda apenas com "
            "o texto, sem título e sem comentários.\n\n"
            "=== TEXTO DE REFERÊNCIA ===\n{reference}"
        ),
    },
    "parafrase": {
        "weight": 2,
        "template": (
            "Reescreva o texto abaixo em português do Brasil com as suas "
            "próprias palavras, mantendo o mesmo significado e aproximadamente "
            "{words} palavras. Responda apenas com o texto reescrito, sem título "
            "e sem comentários.\n\n=== TEXTO ===\n{reference}"
        ),
    },
    "social": {
        "weight": 2,
        "template": (
            "Escreva um post de rede social profissional em português do Brasil "
            "sobre o tema central do texto de referência abaixo, com "
            "aproximadamente {words} palavras. Tom de publicação de feed "
            "(parágrafos curtos), sem hashtags inventadas em excesso, sem "
            "título. Não copie frases da referência. Responda apenas com o "
            "post.\n\n=== TEXTO DE REFERÊNCIA ===\n{reference}"
        ),
    },
    "humanizado": {
        "weight": 1,
        "template": (
            "Escreva um texto casual e espontâneo em português do Brasil sobre "
            "o mesmo assunto do texto de referência abaixo, com aproximadamente "
            "{words} palavras, como uma pessoa comum escreveria rapidamente — "
            "natural, direto, com leve informalidade, sem parecer redação "
            "polida. Não copie frases da referência. Responda apenas com o "
            "texto.\n\n=== TEXTO DE REFERÊNCIA ===\n{reference}"
        ),
    },
}


def recipe_for(provider: str, candidate_id: str) -> str:
    """Deterministic recipe assignment honoring the weight mix (buckets of 10)."""
    digest = hashlib.sha256(f"recipe:{provider}:{candidate_id}".encode()).digest()
    bucket = digest[0] % 10
    cursor = 0
    for name, spec in RECIPES.items():
        cursor += spec["weight"]
        if bucket < cursor:
            return name
    return "original"


def template_digest(recipe: str) -> str:
    return hashlib.sha256(RECIPES[recipe]["template"].encode("utf-8")).hexdigest()

DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "anthropic": "claude-haiku-4-5-20251001",
    "gemini": "gemini-2.0-flash",
    # CLI channels — held-out families via the user's login (no key).
    "agy": "claude-sonnet-4-6",
    "codex": "gpt-5.6-luna",
}
# Only OpenAI exposes a sampling seed on this API surface.
SEEDED_PROVIDERS = {"openai"}
SEED_NULL_REASON = "provider API does not expose a sampling seed"
TEMPERATURE = 0.8
MAX_OUTPUT_TOKENS = 1024
RETRIABLE = {429, 500, 502, 503, 529}


def http_json(url: str, payload: dict, headers: dict[str, str]) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json", **headers}
    )
    with urllib.request.urlopen(request, timeout=120) as response:
        return json.loads(response.read().decode("utf-8"))


class GenerationRefused(Exception):
    """The provider answered without usable content (safety block, empty
    candidates, truncated shape). Deterministic per item — the caller must SKIP
    the item, never retry it and never abort the batch."""


def call_provider(
    provider: str, model: str, prompt: str, seed: int | None, keys: dict[str, str]
) -> str:
    if provider == "openai":
        payload = {
            "model": model,
            "messages": [{"role": "user", "content": prompt}],
            "temperature": TEMPERATURE,
            "max_tokens": MAX_OUTPUT_TOKENS,
        }
        if seed is not None:
            payload["seed"] = seed
        data = http_json(
            "https://api.openai.com/v1/chat/completions",
            payload,
            {"Authorization": f"Bearer {keys['openai']}"},
        )
        choices = data.get("choices") or []
        content = (choices[0].get("message") or {}).get("content") if choices else None
        if not content:
            raise GenerationRefused(f"openai sem conteudo: {str(data)[:160]}")
        return content
    if provider == "anthropic":
        data = http_json(
            "https://api.anthropic.com/v1/messages",
            {
                "model": model,
                "max_tokens": MAX_OUTPUT_TOKENS,
                "temperature": TEMPERATURE,
                "messages": [{"role": "user", "content": prompt}],
            },
            {"x-api-key": keys["anthropic"], "anthropic-version": "2023-06-01"},
        )
        text = "".join(
            part.get("text", "")
            for part in data.get("content") or []
            if part.get("type") == "text"
        )
        if not text:
            raise GenerationRefused(f"anthropic sem conteudo: {str(data)[:160]}")
        return text
    if provider == "gemini":
        data = http_json(
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={keys['gemini']}",
            {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": TEMPERATURE,
                    "maxOutputTokens": MAX_OUTPUT_TOKENS,
                },
            },
            {},
        )
        candidates = data.get("candidates") or []
        parts = (
            (candidates[0].get("content") or {}).get("parts") if candidates else None
        ) or []
        text = "".join(part.get("text", "") for part in parts)
        if not text:
            # Safety block / empty candidate: promptFeedback carries the reason.
            raise GenerationRefused(
                f"gemini sem conteudo: {str(data.get('promptFeedback') or data)[:160]}"
            )
        return text
    if provider == "agy":
        # Plan mode = read-only (no tool use); stdin closed or it hangs on
        # Windows. stdout is the generated text.
        proc = subprocess.run(
            [AGY_BIN, "-p", prompt, "--mode", "plan", "--model", model],
            stdin=subprocess.DEVNULL,
            capture_output=True,
            timeout=360,
        )
        if proc.returncode != 0:
            stderr = proc.stderr.decode("utf-8", errors="replace")
            # Quota wall surfaces on stderr; raise as HTTP 429 so the shared
            # retry/stop path treats it like an API quota wall.
            if "quota" in stderr.lower():
                raise urllib.error.HTTPError(AGY_BIN, 429, stderr[-200:], {}, None)
            raise GenerationRefused(f"agy rc={proc.returncode}: {stderr[-200:]}")
        text = proc.stdout.decode("utf-8", errors="replace").strip()
        if not text:
            raise GenerationRefused("agy saída vazia")
        return text
    if provider == "codex":
        import tempfile

        workdir = Path(tempfile.mkdtemp(prefix="codex_gen_"))
        out_file = workdir / "msg.txt"
        proc = subprocess.run(
            [
                *codex_command(), "exec", "--sandbox", "read-only", "--ephemeral",
                "--skip-git-repo-check", "--cd", str(workdir), "--color", "never",
                "--model", model, "--output-last-message", str(out_file), "-",
            ],
            input=prompt.encode("utf-8"),
            capture_output=True,
            timeout=360,
        )
        if proc.returncode != 0:
            raise GenerationRefused(
                f"codex rc={proc.returncode}: "
                f"{proc.stderr.decode('utf-8', errors='replace')[-200:]}"
            )
        text = out_file.read_text(encoding="utf-8").strip() if out_file.exists() else ""
        if not text:
            raise GenerationRefused("codex saída vazia")
        return text
    raise ValueError(f"unknown provider {provider}")


def call_with_retries(transport, *args, attempts: int = 5):
    delay = 2.0
    for attempt in range(attempts):
        try:
            return transport(*args)
        except urllib.error.HTTPError as error:
            if error.code not in RETRIABLE or attempt == attempts - 1:
                raise
        except OSError:
            # URLError, TimeoutError de leitura do socket, ConnectionReset…
            # (HTTPError já foi tratado acima; GenerationRefused não é OSError)
            if attempt == attempts - 1:
                raise
        time.sleep(delay)
        delay = min(delay * 2, 60)
    raise RuntimeError("unreachable")


def load_humans(paths: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for path in paths:
        with path.open(encoding="utf-8") as handle:
            rows.extend(json.loads(line) for line in handle if line.strip())
    rows.sort(key=lambda r: r["candidateId"])  # deterministic order
    return rows


def already_paired(output: Path) -> set[str]:
    done: set[str] = set()
    if output.exists():
        with output.open(encoding="utf-8") as handle:
            for line in handle:
                if line.strip():
                    done.add(json.loads(line)["meta"].get("pairedWith", ""))
    return done


def select_pairs(humans: list[dict], provider: str, count: int, done: set[str]) -> list[dict]:
    """Deterministic provider-specific sample of human topic seeds."""
    selected: list[dict] = []
    for rate in (3, 2, 1):  # widen deterministically until count is met
        for row in humans:
            if len(selected) >= count:
                return selected
            cid = row["candidateId"]
            if cid in done or any(s["candidateId"] == cid for s in selected):
                continue
            if keep_sample(f"{provider}:{cid}", rate):
                selected.append(row)
    return selected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--provider", required=True, choices=sorted(DEFAULT_MODELS))
    parser.add_argument("--humans", required=True, nargs="+", type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--per-provider", type=int, default=60)
    parser.add_argument("--model", default=None)
    parser.add_argument(
        "--models",
        default=None,
        help="lista separada por vírgula: rotaciona modelos ao esbarrar em "
        "429/5xx (buckets do free tier são POR MODELO) e remove 404; cada "
        "família held-out vira um gerador distinto. Sobrepõe --model",
    )
    parser.add_argument("--sleep", type=float, default=1.0)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    import os

    provider = args.provider
    models = (
        [m.strip() for m in args.models.split(",") if m.strip()]
        if args.models
        else [args.model or DEFAULT_MODELS[provider]]
    )
    model = models[0]
    keys = {
        "openai": os.environ.get("OPENAI_API_KEY", ""),
        "anthropic": os.environ.get("ANTHROPIC_API_KEY", ""),
        "gemini": os.environ.get("GEMINI_API_KEY", "")
        or os.environ.get("GOOGLE_API_KEY", ""),
    }

    humans = load_humans(args.humans)
    done = already_paired(args.output)
    pairs = select_pairs(humans, provider, args.per_provider, done)
    print(
        f"{provider}/{model}: {len(pairs)} a gerar "
        f"(humans={len(humans)}, resume-skip={len(done)})"
    )
    if args.dry_run:
        for row in pairs[:5]:
            print(f"  seed-topic {row['candidateId']} ({row['wordCount']} palavras)")
        return
    # CLI channels authenticate via the user's login, not an env key.
    if provider not in CLI_PROVIDERS and not keys[provider]:
        raise SystemExit(
            f"defina a variável de ambiente da chave do provedor '{provider}'"
        )

    writer = CandidateWriter(
        args.output,
        source_id=f"src_ai_{provider}",
        limit=10**9,
        sample_rate=1,
        date_cutoff=None,
        append=True,
        start_sequence=len(done),
    )
    batch_path = args.output.with_suffix(".batch.json")
    # Free-tier buckets are per model: on a wall, hop to the next model
    # (sticking to whichever flows) instead of stopping; drop 404s; the
    # record records the model that ACTUALLY generated it.
    live = list(models)
    cursor = {"i": 0}

    def generate(prompt: str, seed: int | None) -> tuple[str, str] | None:
        walls = 0  # 429s consecutivos; zera ao primeiro sucesso (via return)
        while live:
            active = live[cursor["i"] % len(live)]
            try:
                return call_with_retries(
                    call_provider, provider, active, prompt, seed, keys
                ), active
            except urllib.error.HTTPError as error:
                if error.code == 404:
                    print(f"  {active} respondeu 404 — fora da rotação")
                    live.remove(active)
                    continue
                if error.code not in RETRIABLE:
                    raise
                # 429 e 5xx persistentes (sobreviveram aos retries) = bucket/
                # backend deste modelo indisponível agora: pula para o próximo.
                cursor["i"] += 1
                walls += 1
                if walls >= len(live):
                    return None  # todos os modelos murados de uma vez
                continue
            except OSError:
                # Timeout/reset de socket que passou dos retries: trata o
                # modelo como indisponível e roda a rotação.
                cursor["i"] += 1
                walls += 1
                if walls >= len(live):
                    return None
                continue
        return None

    try:
        for index, row in enumerate(pairs, start=1):
            recipe = recipe_for(provider, row["candidateId"])
            target_words = max(60, min(int(row["wordCount"]), 350))
            prompt = RECIPES[recipe]["template"].format(
                words=target_words, reference=row["text"][:6000]
            )
            seed = (
                int.from_bytes(
                    hashlib.sha256(row["candidateId"].encode()).digest()[:4], "big"
                )
                if provider in SEEDED_PROVIDERS
                else None
            )
            try:
                result = generate(prompt, seed)
            except GenerationRefused as refused:
                print(f"  item {row['candidateId']} recusado (pulado): {refused}")
                continue
            if result is None:
                print(
                    f"  cota esgotada apos {writer.stats.kept} mantidos — "
                    "relance a lane mais tarde (resume automatico)"
                )
                break
            text, model = result
            generated_at = datetime.now(timezone.utc)
            writer.offer(
                natural_key=f"ai:{provider}:{row['candidateId']}",
                license_id=LICENSE_ID,
                created_at=generated_at,
                raw_text=text,
                domain_source=f"ai_{provider}",
                meta={
                    "provider": provider,
                    "family": model,
                    "model": model,
                    "version": model,
                    "recipe": recipe,
                    "temperature": str(TEMPERATURE),
                    "seed": str(seed) if seed is not None else "",
                    "seedNullReason": "" if seed is not None else SEED_NULL_REASON,
                    "promptId": f"{recipe}_{row['candidateId']}",
                    "promptSha256": hashlib.sha256(prompt.encode("utf-8")).hexdigest(),
                    "promptTemplateDigest": template_digest(recipe),
                    "generatedAt": generated_at.isoformat(),
                    "pairedWith": row["candidateId"],
                    "pairedDomainSource": row["domainSource"],
                },
            )
            if index % 10 == 0:
                print(f"  {index}/{len(pairs)} (kept={writer.stats.kept})")
            time.sleep(args.sleep)
    finally:
        writer.close()
        batch_family = ",".join(models)
        batch_path.write_text(
            json.dumps(
                {
                    "batchId": f"batch_{provider}_{'-'.join(models)}".replace(
                        ".", "_"
                    ),
                    "sourceId": f"src_ai_{provider}",
                    "generationProtocolVersion": "generation-v1",
                    "provider": provider,
                    "family": batch_family,
                    "model": batch_family,
                    "version": batch_family,
                    "models": models,
                    "recipes": {name: template_digest(name) for name in RECIPES},
                    "temperature": TEMPERATURE,
                    "seedPolicy": (
                        "per-record deterministic seed"
                        if provider in SEEDED_PROVIDERS
                        else SEED_NULL_REASON
                    ),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
    print(
        f"{provider}: kept={writer.stats.kept} pii_dropped={writer.stats.drop_pii} "
        f"words_dropped={writer.stats.drop_words}"
    )


if __name__ == "__main__":
    main()
