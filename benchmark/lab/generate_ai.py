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
import re
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
CLI_PROVIDERS = {"agy", "codex", "gemini_cli"}
# A 429 the server says is temporary is waited out rather than counted as a
# wall; anything longer than this is treated as a wall regardless.
MAX_HONORED_RETRY_SECONDS = 120.0
MAX_THROTTLE_WAITS = 8
# Per-item ceiling for the gemini CLI. Kept modest because an unauthenticated
# CLI blocks forever on its consent prompt, and the lane should say so fast.
GEMINI_CLI_TIMEOUT = 180.0
# Banner/telemetry lines the gemini CLI prints around the answer.
GEMINI_NOISE = re.compile(
    r"^\s*(\[dotenv|Loaded cached credentials|Data collection|Flushing|"
    r"MCP STDERR|Opening authentication)",
    re.IGNORECASE,
)
# Substrings that mean the CLI is not logged in. It then prints an interactive
# prompt instead of an answer, which must never be mistaken for generated text.
GEMINI_AUTH_HINT = (
    "gemini CLI nao conseguiu autenticar. Rode `gemini` uma vez e conclua o "
    "login, depois relance a lane (o resume e automatico). ATENCAO: em contas "
    "individuais este CLI responde IneligibleTierError — o Google encerrou o "
    "Gemini Code Assist for individuals nele e aponta para o Antigravity. Nesse "
    "caso use --provider agy, que serve os mesmos modelos gemini-3.x."
)
# Phrases the CLI ITSELF emits when it cannot authenticate. Deliberately long
# and product-specific: these are matched against CLI diagnostics, and a short
# generic marker like "sign in" would also match the model's own prose about
# login flows (many seed topics are StackOverflow-pt auth questions) and abort a
# lane over a perfectly good generation.
GEMINI_AUTH_MARKERS = (
    "opening authentication page",
    "error authenticating",
    "ineligibletiererror",
    "please set an auth method",
    "no auth method configured",
    "migrate to the antigravity",
    "please visit the url to log in",
)


def looks_unauthenticated(*streams: str) -> bool:
    joined = " ".join(streams).lower()
    return any(marker in joined for marker in GEMINI_AUTH_MARKERS)


def npm_entrypoint(binary: str, package: str) -> list[str] | None:
    """`node <the JS entry the package declares>`, when resolvable.

    Same lesson as the codex channel: a shim on PATH can reach a stale native
    build that the server refuses, while the npm entrypoint works. The entry
    path comes from the package's own `bin` field rather than a guess — codex
    declares bin/codex.js and gemini-cli declares bundle/gemini.js.
    """
    shim = shutil.which(binary)
    node = shutil.which("node")
    if not shim or not node:
        return None
    root = Path(shim).parent / "node_modules" / Path(package)
    try:
        declared = json.loads((root / "package.json").read_text(encoding="utf-8"))["bin"]
    except (OSError, ValueError, KeyError):
        return None
    relative = declared.get(binary) if isinstance(declared, dict) else declared
    if not isinstance(relative, str):
        return None
    entry = root / relative
    return [node, str(entry)] if entry.exists() else None


def codex_command() -> list[str]:
    """The codex CLI as an argv prefix.

    Resolves the npm entrypoint because this machine also has a native install
    under AppData/Local/Programs/OpenAI/Codex whose server-side handshake
    rejects current models with "The '<model>' model requires a newer version of
    Codex" even though `codex --version` reports the same 0.145.0.

    Override with CODEX_BIN (split on spaces, so `node C:/path/codex.js` works).
    """
    override = os.environ.get("CODEX_BIN")
    if override:
        return shlex.split(override, posix=False)
    return npm_entrypoint("codex", "@openai/codex") or ["codex"]


def gemini_command() -> list[str]:
    """The gemini CLI as an argv prefix. Override with GEMINI_BIN."""
    override = os.environ.get("GEMINI_BIN")
    if override:
        return shlex.split(override, posix=False)
    return npm_entrypoint("gemini", "@google/gemini-cli") or ["gemini"]


# The provider label this script uses -> the frozen generation lane
# (benchmark/rebuild-v3-policy.json). Recorded on every row so the assembler reads a
# lane the GENERATOR observed instead of inferring one from a provider string, and so
# a provider that is not one of the four frozen lanes fails HERE rather than silently
# producing rows no v3 corpus can accept.
PROVIDER_LANE = {
    "agy": "agy",
    "codex": "codex",
    "gemini": "gemini-api",
    "gemini_cli": "gemini-cli",
}
# argv that asks each CLI lane for its own version. `agy` is a single executable;
# codex and gemini are resolved through the npm entrypoint, so the prefix has to come
# from the same resolver that will actually run the generation — asking a shim on PATH
# could report a different build from the one that produced the text, which is the
# bug codex_command() already exists to avoid.
HARNESS_VERSION_ARGV = {
    "agy": lambda: [AGY_BIN, "--version"],
    "codex": lambda: codex_command() + ["--version"],
    "gemini_cli": lambda: gemini_command() + ["--version"],
}
# A version string is a line like "codex-cli 0.145.0" or "0.145.0"; take the first
# dotted numeric run and nothing else, so a banner around it cannot become part of the
# grouping identity.
_VERSION = re.compile(r"\d+(?:\.\d+)+(?:[-+][0-9A-Za-z.]+)?")


def harness_version(provider: str) -> str | None:
    """The REAL version of the binary that will generate, or None.

    Captured by asking the binary, never composed from a package name or a constant:
    `groups.harnessVersion` is a dependence axis, and a version we asserted rather
    than read would group records by a claim instead of by the artifact that produced
    them.

    None on any failure — binary absent, non-zero exit, unparseable output, timeout —
    and None means the record's axis becomes `unknown`, which costs it eligibility.
    That is the intended price. There is deliberately no fallback string: "unknown"
    filled in by hand is the substitution R6 forbids, and the version of a harness is
    exactly the kind of value that cannot be recovered later, because the binary may
    have been upgraded past recall by the time anyone notices.
    """
    build = HARNESS_VERSION_ARGV.get(provider)
    if build is None:
        return None
    try:
        proc = subprocess.run(
            build(), capture_output=True, timeout=60, stdin=subprocess.DEVNULL
        )
    except (OSError, subprocess.SubprocessError):
        return None
    if proc.returncode != 0:
        return None
    printed = (proc.stdout or b"").decode("utf-8", errors="replace")
    if not printed.strip():
        printed = (proc.stderr or b"").decode("utf-8", errors="replace")
    found = _VERSION.search(printed)
    return found.group(0) if found else None


def cli_env_without_keys() -> dict[str, str]:
    """Child environment with the Gemini API keys REMOVED.

    The CLI silently prefers an API key over the operator's login when one is
    exported, which would route this channel onto the free-tier REST quota — a
    different account, a different (exhausted) bucket, and a provenance lie.
    """
    return {
        key: value
        for key, value in os.environ.items()
        if key not in ("GEMINI_API_KEY", "GOOGLE_API_KEY")
    }


# Warning/error signatures that mean the answer is CUT SHORT rather than merely
# annotated. Checked against the CLI's own error/warnings channels, never prose.
GEMINI_INCOMPLETE = re.compile(
    r"invalid_stream|truncat|incomplete|max.?tokens|cut off|unexpected end",
    re.IGNORECASE,
)


def gemini_cli_text(payload: str) -> str:
    """The answer out of `gemini -o json`, or a loud failure.

    Strict on purpose: this text goes into a sealed corpus, so a partial answer
    accepted as a whole one is a scientific defect, not a glitch.

    The CLI's JSON formatter is `format(sessionId, response, stats, error,
    warnings)` — `error` and `warnings` travel ALONGSIDE `response`, and the
    headless runner fills `error` with an INVALID_STREAM entry while still
    exiting 0 and still emitting the prose it managed to collect. So the failure
    channels are read FIRST; taking `response` before looking at them is exactly
    how a truncated generation would enter the corpus looking complete.
    """
    try:
        parsed = json.loads(payload)
    except ValueError:
        raise GenerationRefused(
            f"gemini CLI: saída não é JSON ({payload[:160]!r})"
        ) from None
    if isinstance(parsed, str):
        return parsed.strip()
    if isinstance(parsed, dict):
        reported = parsed.get("error")
        if reported:
            raise GenerationRefused(f"gemini CLI reportou erro: {str(reported)[:160]}")
        warnings = parsed.get("warnings")
        if warnings:
            rendered = json.dumps(warnings, ensure_ascii=False)
            if GEMINI_INCOMPLETE.search(rendered):
                raise GenerationRefused(
                    f"gemini CLI: resposta possivelmente truncada {rendered[:160]}"
                )
        for key in ("response", "text", "content", "output"):
            value = parsed.get(key)
            if isinstance(value, str) and value.strip():
                return value.strip()
    raise GenerationRefused(
        f"gemini CLI: JSON sem campo de texto reconhecido ({payload[:160]!r})"
    )


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
    # gemini_cli defaults to the family with a concrete deficit: flash-preview
    # needs >= 200 positives before it can be DECLARED held-out at all. Rotate
    # with --models gemini-3-flash-preview,gemini-3.5-flash-lite,... to spread
    # across the gemini-3.x buckets.
    "gemini_cli": "gemini-3-flash-preview",
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
    if provider == "gemini_cli":
        # Headless, read-only, JSON out; the operator's login supplies auth, so
        # the API keys are stripped from the child env (see cli_env_without_keys).
        argv = [
            *gemini_command(), "-p", prompt, "-m", model,
            "--approval-mode", "plan", "-o", "json",
        ]
        try:
            proc = subprocess.run(
                argv,
                stdin=subprocess.DEVNULL,
                capture_output=True,
                timeout=GEMINI_CLI_TIMEOUT,
                env=cli_env_without_keys(),
            )
        except subprocess.TimeoutExpired as expired:
            # Unauthenticated, the CLI prints its consent prompt and then BLOCKS
            # waiting for a keypress that will never come — closing stdin does
            # not end it. Read whatever it emitted to name the real cause
            # instead of reporting a generic timeout.
            if looks_unauthenticated(
                (expired.stdout or b"").decode("utf-8", errors="replace"),
                (expired.stderr or b"").decode("utf-8", errors="replace"),
            ):
                raise RuntimeError(GEMINI_AUTH_HINT) from None
            raise GenerationRefused(
                f"gemini_cli sem resposta em {GEMINI_CLI_TIMEOUT:.0f}s"
            ) from None
        stdout = proc.stdout.decode("utf-8", errors="replace")
        stderr = proc.stderr.decode("utf-8", errors="replace")
        # The auth check runs ONLY on paths where there is no valid answer.
        # stdout carries the model's prose, and a text about login flows would
        # otherwise abort the lane; unauthenticated means every remaining item
        # fails the same way, so it raises to end the lane rather than skip one.
        if proc.returncode != 0:
            if looks_unauthenticated(stdout, stderr):
                raise RuntimeError(GEMINI_AUTH_HINT)
            if "quota" in stderr.lower() or "429" in stderr:
                raise urllib.error.HTTPError(
                    "gemini_cli", 429, stderr[-200:], {}, None
                )
            raise GenerationRefused(f"gemini_cli rc={proc.returncode}: {stderr[-200:]}")
        payload = "\n".join(
            line for line in stdout.splitlines() if not GEMINI_NOISE.match(line)
        ).strip()
        if not payload:
            if looks_unauthenticated(stdout, stderr):
                raise RuntimeError(GEMINI_AUTH_HINT)
            raise GenerationRefused("gemini_cli saída vazia")
        try:
            return gemini_cli_text(payload)
        except GenerationRefused:
            # Unparseable output plus an auth complaint on stderr is the CLI
            # refusing to run at all, not one bad generation.
            if looks_unauthenticated(stderr):
                raise RuntimeError(GEMINI_AUTH_HINT) from None
            raise
    raise ValueError(f"unknown provider {provider}")


def quota_hint(error: urllib.error.HTTPError) -> tuple[float | None, bool]:
    """(retryDelay in seconds, is-a-per-day-wall) from a 429 body.

    One 429 carries two very different meanings. A per-MINUTE throttle ships a
    RetryInfo saying exactly how long to wait — waiting is all that is needed.
    A per-DAY exhaustion is a wall: that model yields nothing else today.
    Telling them apart is the difference between a lane that keeps producing
    and one that stops after a handful of records.

    The body can only be read once, so the parse is cached on the exception for
    whichever handler looks next.
    """
    cached = getattr(error, "_quota_hint", None)
    if cached is not None:
        return cached
    try:
        payload = json.loads(error.read().decode("utf-8", errors="replace"))
        details = payload["error"].get("details", [])
    except (ValueError, KeyError, AttributeError, OSError):
        details = []
    delay: float | None = None
    daily = False
    for detail in details:
        kind = str(detail.get("@type", ""))
        if kind.endswith("RetryInfo"):
            match = re.match(r"([0-9.]+)s?$", str(detail.get("retryDelay", "")))
            if match:
                delay = float(match.group(1))
        elif kind.endswith("QuotaFailure"):
            for violation in detail.get("violations", []):
                if "PerDay" in str(violation.get("quotaId", "")):
                    daily = True
    hint = (delay, daily)
    error._quota_hint = hint
    return hint


def call_with_retries(transport, *args, attempts: int = 5):
    """Retry ladder for transient transport failures.

    A 429 that the server itself says is temporary does NOT consume the ladder:
    the old behaviour waited 2+4+8+16s and gave up, which is less than the ~41s
    a free-tier per-minute throttle asks for, so the caller read a throttle as
    an exhausted bucket and abandoned the lane.
    """
    delay = 2.0
    attempt = 0
    throttle_waits = 0
    while True:
        try:
            return transport(*args)
        except urllib.error.HTTPError as error:
            if error.code == 429:
                hinted, daily = quota_hint(error)
                if daily:
                    # Nothing to wait for: this bucket is done for the day, and
                    # the caller drops the model from the rotation.
                    raise
                honor = (
                    hinted is not None
                    and hinted <= MAX_HONORED_RETRY_SECONDS
                    and throttle_waits < MAX_THROTTLE_WAITS
                )
                if honor:
                    throttle_waits += 1
                    print(
                        f"  429 por minuto: aguardando {hinted:.0f}s "
                        f"({throttle_waits}/{MAX_THROTTLE_WAITS})"
                    )
                    time.sleep(hinted + 1.0)
                    continue  # deliberately does not spend an attempt
            if error.code not in RETRIABLE or attempt >= attempts - 1:
                raise
        except OSError:
            # URLError, TimeoutError de leitura do socket, ConnectionReset…
            # (HTTPError já foi tratado acima; GenerationRefused não é OSError)
            if attempt >= attempts - 1:
                raise
        attempt += 1
        time.sleep(delay)
        delay = min(delay * 2, 60)


def load_humans(paths: list[Path]) -> list[dict]:
    rows: list[dict] = []
    for path in paths:
        with path.open(encoding="utf-8") as handle:
            rows.extend(json.loads(line) for line in handle if line.strip())
    rows.sort(key=lambda r: r["candidateId"])  # deterministic order
    return rows


def acquire_lane_lock(output: Path) -> Path:
    """Claim exclusive ownership of an output file, or refuse to start.

    Lanes resume by reading which parents the output file ALREADY contains, so
    two processes appending to one file each dedupe against the snapshot they
    saw at startup and then regenerate the same parents — 190 colliding ids in a
    single afternoon, discovered only when the sealed ingest refused the corpus.
    O_CREAT|O_EXCL makes the claim atomic, so the second lane fails to start
    instead of quietly corrupting the first one's output.
    """
    lock = output.with_name(output.name + ".lock")
    try:
        handle = os.open(str(lock), os.O_CREAT | os.O_EXCL | os.O_WRONLY)
    except FileExistsError:
        raise SystemExit(
            f"já existe uma lane escrevendo em {output.name} (lock {lock.name}). "
            "Se o processo anterior morreu, apague o lock e relance — o resume "
            "por pais já gerados é automático."
        ) from None
    os.write(handle, str(os.getpid()).encode())
    os.close(handle)
    return lock


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
    parser.add_argument(
        "--effort",
        default=None,
        help="nível de esforço de raciocínio APLICADO (ex.: medium). Gravado como "
        "observação; NUNCA inferido do nome do modelo. Obrigatório nas lanes cuja "
        "linha congelada não oferece 'not-supported' (hoje: codex)",
    )
    parser.add_argument(
        "--effort-source",
        default=None,
        choices=["model-id", "flag", "provider-default"],
        help="DE ONDE veio o nível: do id do modelo, de uma flag que passamos, ou do "
        "default do provedor. Sem isto um esforço gravado é indistinguível de um "
        "inferido, que é o que R6 proíbe",
    )
    args = parser.parse_args()
    if (args.effort is None) != (args.effort_source is None):
        raise SystemExit(
            "--effort e --effort-source andam juntos: um nível sem origem declarada "
            "não é distinguível de um nível inferido"
        )

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

    # ONCE per lane, before any generation: the binary does not change mid-run, and
    # asking it 400 times would be 400 subprocesses for one answer. Captured BEFORE
    # the first call so the version recorded is the one that produced the first row
    # as well as the last.
    captured_harness = harness_version(provider)
    if provider in HARNESS_VERSION_ARGV:
        print(
            f"harness {provider}: "
            + (
                captured_harness
                if captured_harness
                else "NAO CAPTURADA — os registros desta lane ficam INELEGIVEIS "
                "(groups.harnessVersion unknown). Nenhuma versao e inventada"
            )
        )
    lock = acquire_lane_lock(args.output)
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
                if error.code == 429 and quota_hint(error)[1]:
                    # Per-day wall: this bucket yields nothing else today, so
                    # drop the model instead of rotating back onto it later.
                    print(f"  {active} sem cota diária — fora da rotação")
                    live.remove(active)
                    cursor["i"] = 0
                    walls = 0
                    continue
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
                    # The lane the generator OBSERVED itself running on, plus the
                    # version of the binary that produced this very text. Both are
                    # grouping axes in v3, and both were missing from every row the
                    # v2 runs wrote — which is why 323 of 635 records in C2's
                    # assembly are ineligible on `harnessVersion` alone.
                    "generationLane": PROVIDER_LANE[provider],
                    "harnessVersion": captured_harness or "",
                    # The reasoning effort, recorded ONLY when the operator declared
                    # it. Never derived from the model id, even though `agy` embeds
                    # the tier in some ids (`gpt-oss-120b-medium`) — `--effort` is a
                    # session flag in parallel and the precedence between the two is
                    # not yet measured, so a value read off the suffix would record a
                    # guess about which input won as though it were an observation.
                    "effortSource": args.effort_source or "",
                    "effortLevel": args.effort or "",
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
                    # The lane, the harness and the declared effort, so the batch
                    # record says what the rows say. `harnessVersion` is null rather
                    # than a placeholder when the capture failed: a batch that names a
                    # version it did not read would contradict its own rows.
                    "generationLane": PROVIDER_LANE[provider],
                    "harnessVersion": captured_harness,
                    "effortSource": args.effort_source,
                    "effortLevel": args.effort,
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
        lock.unlink(missing_ok=True)
    print(
        f"{provider}: kept={writer.stats.kept} pii_dropped={writer.stats.drop_pii} "
        f"words_dropped={writer.stats.drop_words}"
    )


if __name__ == "__main__":
    main()
