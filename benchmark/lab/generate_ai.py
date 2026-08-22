"""Generates the AI class, TOPIC-PAIRED with the human candidates.

For each deterministically-sampled human candidate, asks a provider model to
write an ORIGINAL pt-BR text on the same subject and at the SAME LENGTH. Topic
pairing prevents the classic corpus artifact where a classifier learns
"topic/era" instead of authorship; length pairing prevents the same artifact in
the word count, which is the cheapest feature a detector can find
(`target_word_count`, checked by `probe_length` in diagnostic_probes.py); asking
for an original text (never a rewrite) avoids near-dup collisions with the human
parent. The model's default style IS the signal we want to detect, so the prompt
applies no style tricks.

Every output carries the FULL generation recipe the closed schema requires
(provider/family/model/temperature/seed or seedNullReason/promptId/
promptSha256/generatedAt) plus a batch metadata file for the source-manifest.
Outputs run through the shared candidate pipeline (normalize -> word window ->
PII drop), with the pre-ChatGPT date cutoff disabled (these are generated NOW).

`--provider` admits the frozen lanes and nothing else, and refuses the rest at the parser.
GENERATION GOES THROUGH A HARNESS, NEVER A PROVIDER API: `agy`, `codex` and `gemini_cli`
authenticate through the operator's own login, and Gemini is reached through `agy` — the
same binary that serves the other vendors — rather than through the REST endpoint. The
`gemini-api` lane stays DECLARED because 1.650 rows already on disk carry it and retiring
it would make every one of them `UnmappableLane`; what it does not have is new material.

`ollama` is the exception the rule was never against: it is a runtime on THIS machine, and
what the rule forbids is a provider endpoint that hides both the harness and its version.
Here the version is read from the binary that answered, the weights are identified by
content id, and the sampling seed is ours — which is why it is the one provider in
`SEEDED_PROVIDERS`, and why the frozen policy gives it a channel of its own.

That is policy and this parser does not yet impose it: `--provider gemini` is still
admissible here, and imposing the decision is a ten-site change (this table,
`DEFAULT_MODELS`, `call_provider`, the `keys` dict, the `CLI_PROVIDERS` check, the env
scrub, `make_mixed.py`, and three tests that pin the sets equal). The debt is in the
ESTADO rather than papered over with a docstring that claims a guard nobody wrote.

`OUT_OF_SLATE_PROVIDERS` names the API surfaces this script used to offer, each with its
own reason.

`--island` is refused at the same boundary and for the same reason. With `promptTemplate`
back in the splitter's union list, a generated class whose template graph is CONNECTED is
one component the five partitions cannot receive, and `assign_partitions` refuses it —
after the quota is gone. So the plan of islands (`ISLAND_PLAN`,
benchmark/lab/assemble_corpus.py) is validated by the argparse `type=` before the seeds
file is opened, before the lane lock and before the first provider call, and the run
generates for ONE island: its templates and its block of human seeds. It does NOT
partition the generator version — that identity is the model id, and it is reported by
the audit rather than unioned by the splitter (see `GROUP_KEYS`, benchmark/split.ts).

Stdlib only. `urllib` serves two arms of `call_provider`: the declared `gemini` REST lane,
which no run reaches any more, and the local runtime, which is a call to loopback.

Usage (pilot):
  python benchmark/lab/generate_ai.py --provider agy --island ilha_00 \
    --humans ../data/candidates/carolina.jsonl \
    --output ../data/candidates/ai_agy.jsonl --per-provider 60
  (idem para --provider codex | gemini_cli; --dry-run mostra o plano sem chamar nada)

Usage (reserva OOD, runtime local — uma ilha RESERVADA por corrida):
  python benchmark/lab/generate_ai.py --provider ollama --island ilha_17     --model qwen2.5:7b --humans ../data/candidates-f3/wikipedia_fresh.jsonl     --output ../data/candidates-f3/ai_reserved_qwen.jsonl --per-provider 150
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
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

from common import MAXIMUM_WORDS, MINIMUM_WORDS, CandidateWriter, keep_sample


def assembler():
    """`assemble_corpus`, importado TARDE, e o motivo e um CICLO real e nao zelo.

    `assemble_corpus` importa `artifact_gate`, que importa ESTE modulo e le
    `generate_ai.RECIPES` durante o proprio import. Um `import assemble_corpus` no topo
    daqui fecha o ciclo, e o erro sai de `artifact_gate` com um `AttributeError` sobre
    `RECIPES` — a milhas de onde o import foi escrito. Importar dentro da funcao e o que
    mantem o plano de ilhas no arquivo que ja e dono da aritmetica das cinco fracoes sem
    inverter a dependencia entre montador e gerador.
    """
    import assemble_corpus

    return assemble_corpus

LICENSE_ID = "geracao-propria-v1"

# CLI generation channels (no API key — the user's own logged-in subscriptions).
# These carry the HELD-OUT generator families (models never seen in training):
# agy serves claude-sonnet-4-6, gpt-oss-120b, gemini-3.x, opus-4-6.
AGY_BIN = os.environ.get(
    "AGY_BIN", str(Path.home() / "AppData" / "Local" / "agy" / "bin" / "agy.exe")
)
CLI_PROVIDERS = {"agy", "codex", "gemini_cli"}
# The local inference runtime of the OOD reserve. It is neither a CLI nor a provider API,
# and the `local-runtime` channel of the frozen policy is what expresses the difference:
# the transport is a call to a server on this machine, so `temperature` and a real `seed`
# are ours to pass, and the runtime is a binary of ours, so its version is an input to the
# text and is captured. "Generation goes through a harness, never an API" is not violated
# by it — that rule is against a provider endpoint that hides both the harness and its
# version, and here the version is read from the binary that answered.
OLLAMA_BIN = os.environ.get("OLLAMA_BIN", "ollama")
OLLAMA_HOST = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434")
# Providers that need no credential of ours: the CLI logins plus the local runtime, which
# listens on loopback and authenticates nothing.
KEYLESS_PROVIDERS = CLI_PROVIDERS | {"ollama"}
# The ONE ceiling this lane needs and the others do not: a local runtime answers until it
# decides to stop, and a 7B model that loops on a short prompt can spend minutes on one
# line. Measured on the material this lane already produced: 400 lines in 249,8 min, i.e.
# 37,5 s per line on CPU, so a per-item ceiling well above that separates a slow line from
# a stuck one.
OLLAMA_TIMEOUT = 600.0
# A 429 the server says is temporary is waited out rather than counted as a
# wall; anything longer than this is treated as a wall regardless.
MAX_HONORED_RETRY_SECONDS = 120.0
MAX_THROTTLE_WAITS = 8
# Per-item ceiling for the gemini CLI. Kept modest because an unauthenticated
# CLI blocks forever on its consent prompt, and the lane should say so fast.
GEMINI_CLI_TIMEOUT = 180.0
# Banner/telemetry lines the gemini CLI prints around the answer, as LINE PREFIXES.
# The tuple is the authority and the pattern is built from it, because the anti-artifact
# gate reads the same list: only the `gemini-cli` lane strips these before writing, and a
# second copy of the list could leave the gate blind to a banner this lane already knows.
CLI_BANNER_PREFIXES = (
    "[dotenv",
    "Loaded cached credentials",
    "Data collection",
    "Flushing",
    "MCP STDERR",
    "Opening authentication",
)
GEMINI_NOISE = re.compile(
    r"^\s*(?:" + "|".join(re.escape(prefix) for prefix in CLI_BANNER_PREFIXES) + ")",
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
# (benchmark/preregistration-v4.json). Recorded on every row so the assembler reads a
# lane the GENERATOR observed instead of inferring one from a provider string, and so
# a provider that is not a frozen lane fails HERE rather than silently producing rows no
# v3 corpus can accept.
#
# `gemini` is in this table and is NOT a generation path: material comes through `agy`.
# It stays because the assembler must keep mapping the 1.650 rows on disk that carry the
# label, and because removing it here is the ten-site change the module docstring counts.
PROVIDER_LANE = {
    "agy": "agy",
    "codex": "codex",
    "gemini": "gemini-api",
    "gemini_cli": "gemini-cli",
    "ollama": "ollama",
}
# The two API surfaces this script used to offer that the frozen slate does NOT contain,
# kept by name with the reason. Refused at the parser and refused again in
# `call_provider`, because the row a lane outside the slate produces can name no frozen
# `generationLane` and the assembler drops it — after the call was paid for.
OUT_OF_SLATE_PROVIDERS = {
    "openai": (
        "the OpenAI API is not a lane of the slate. The OpenAI families are CORE — they "
        "reach training, by the operator's own decision, on the ground that ChatGPT is "
        "one of the families people actually use — and they get there through the frozen "
        "`codex` lane, whose harness version the row records"
    ),
    "anthropic": (
        "the Anthropic API is not a lane of the slate, and neither is `agy` for these "
        "families any more: the claude material is generated by Claude Code, whose "
        "frozen lane is `claude-code` and whose invocation is a subagent call from "
        "inside a session, not a subprocess this script can spawn"
    ),
}


def frozen_lane(value: str) -> str:
    """`--provider`'s type: a label of the frozen slate, or a refusal on the way in.

    The refusal has to be at the ENTRY. `PROVIDER_LANE[provider]` is read once per
    generated row, inside the loop, after the API call — so a provider outside the slate
    used to die with a `KeyError` on the first row it wrote, having already spent a real
    call, and to die again on every retry of the lane.
    """
    if value in PROVIDER_LANE:
        return value
    reason = OUT_OF_SLATE_PROVIDERS.get(
        value, "it is not one of the generation lanes this script drives"
    )
    admissible = ", ".join(
        f"{label} ({PROVIDER_LANE[label]})" for label in sorted(PROVIDER_LANE)
    )
    raise argparse.ArgumentTypeError(
        f"provider {value!r} is outside the frozen slate: {reason}. "
        f"Admissible lanes: {admissible}"
    )


def island_plan(value: str) -> dict:
    """`--island`'s type: an island of a plan that PASSES, or a refusal on the way in.

    Same boundary as `frozen_lane`, and the same reason: `assign_partitions` already
    refuses a corpus whose generated class is one component, but it refuses at ASSEMBLY,
    which is after every provider call has been paid for. Here nothing has been opened
    yet — argparse exits 2 before `main` reaches the seeds file, the lane lock or the
    first generation.

    THE CRITERION, stated rather than a sufficient condition deduced from it:
      1. the declared plan is a PARTITION — no generation template, no block of human seeds
         and no mixing template in two islands, and every seed bucket covered;
      2. the plan's GEOMETRY is accepted by `assert_components_can_fill_five_partitions`,
         assigned by `_plano_de_blocos` and realises fractions inside
         `within_class_tolerance` — the three PRODUCTION functions called, never a number
         compared;
      3. the reserve leaves room in the blind block for a core island;
      4. `--island` names an island of the plan, and the SLATE serves its templates.

    Leg 4 is the one that refuses today, and the refusal is the decision it names: the plan
    asks for two templates per island over twenty islands and `RECIPES` declares four
    names, so the slate has to grow before the ai class can be generated at all. That is
    the collection decision the operator owns; what this function owns is that the quota
    cannot be spent while the slate does not meet the plan.
    """
    lab = assembler()
    try:
        lab.assert_island_plan_is_a_partition(lab.ISLAND_PLAN)
        lab.assert_island_plan_realizes_the_five_fractions(lab.ISLAND_PLAN)
        lab.assert_island_plan_leaves_core_in_the_blind_block(lab.ISLAND_PLAN)
        island = lab.island_named(lab.ISLAND_PLAN, value)
    except lab.IslandPlanRefused as refused:
        raise argparse.ArgumentTypeError(str(refused)) from None
    if not island["templates"]:
        raise argparse.ArgumentTypeError(
            f"a ilha {value!r} declara zero template: uma corrida sem template nao escreve "
            "linha alguma, e a conferencia contra o slate passaria por vacuidade"
        )
    unserved = [name for name in island["templates"] if name not in RECIPES]
    if unserved:
        raise argparse.ArgumentTypeError(
            f"a ilha {value!r} pede os templates {tuple(island['templates'])} e o slate "
            f"declara {tuple(sorted(RECIPES))}: os que faltam sao {tuple(unserved)}. "
            "Cresca `RECIPES` ate cobrir o plano, ou emende o plano — gerar sob um slate "
            "que o plano nao cumpre produz uma classe que a montagem recusa depois de a "
            "cota estar gasta"
        )
    # A particao de ilha e sobre IDENTIDADE de template, e a identidade gravada e
    # `{recipe}_{digest[:16]}` — com o NOME no prefixo, porque um digest sozinho e ilegivel
    # num relatorio de cluster. O efeito colateral: dois nomes servindo bytes IDENTICOS
    # produzem identidades distintas, o grafo continua particionado, e a independencia de
    # template que o split modela fica FALSA. Escrever cem prompts copiando e ajustando e a
    # forma natural de escrever cem prompts, e nada mais acusaria.
    por_digesto: dict[str, list[str]] = {}
    for nome in sorted(RECIPES):
        por_digesto.setdefault(template_digest(nome), []).append(nome)
    repetidos = {
        digesto[:16]: nomes for digesto, nomes in por_digesto.items() if len(nomes) > 1
    }
    if repetidos:
        raise argparse.ArgumentTypeError(
            f"o slate serve receitas de bytes identicos: {repetidos}. A particao de ilha "
            "ficaria NOMINAL — identidades distintas sobre o mesmo prompt —, e o recall "
            "voltaria a ser medido sobre prompts ja vistos, que e o que a obrigacao de ilha "
            "existe para impedir"
        )
    return island


# argv that asks each CLI lane for its own version. `agy` is a single executable;
# codex and gemini are resolved through the npm entrypoint, so the prefix has to come
# from the same resolver that will actually run the generation — asking a shim on PATH
# could report a different build from the one that produced the text, which is the
# bug codex_command() already exists to avoid.
HARNESS_VERSION_ARGV = {
    "agy": lambda: [AGY_BIN, "--version"],
    "codex": lambda: codex_command() + ["--version"],
    "gemini_cli": lambda: gemini_command() + ["--version"],
    # The runtime, asked the same way as every other binary. The pool the uncommitted
    # script wrote recorded `ollama 0.32.6` — the word and the number — and this records
    # the bare dotted run, as the other three lanes do. The spelling difference is a
    # residue of that script and not a second convention: `_VERSION` takes the first
    # dotted run out of "ollama version is 0.32.15", so the axis token here is the version
    # and nothing else.
    "ollama": lambda: [OLLAMA_BIN, "--version"],
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


# The two facts a local model's identity needs beyond its tag, each read from the runtime
# and never composed: the CONTENT id, which is what identifies the weights (a tag is a
# label and `latest` is a moving one), and the QUANTIZATION, which is part of the
# generator family because two quantizations of one lineage are two generators.
_OLLAMA_QUANTIZATION = re.compile(r"^\s*quantization\s+(\S+)\s*$", re.MULTILINE)


class ModelIdentityUnread(RuntimeError):
    """The runtime did not tell us which weights it holds, so nothing may be written.

    Refused rather than defaulted, and the reason is narrower than "be careful": this
    lane's rows are the OOD reserve, and the reserve's positives floor is filtered by
    record eligibility. A row that names its weights by tag alone cannot be told apart
    from a row generated by a different pull of the same tag, so writing one would spend
    hours of generation on material that answers no question.
    """


def ollama_model_identity(tag: str, binary: str = OLLAMA_BIN) -> tuple[str, str]:
    """(content id, quantization) of one local tag, asked of the runtime.

    Both come from the binary because both are properties of the pull on THIS machine.
    `ollama list` prints the content id per tag and `ollama show` the quantization; a tag
    the list does not carry has not been pulled, and generating against it would ask the
    runtime to fetch weights nobody chose.
    """
    try:
        listing = subprocess.run(
            [binary, "list"], capture_output=True, timeout=120,
            stdin=subprocess.DEVNULL,
        )
        shown = subprocess.run(
            [binary, "show", tag], capture_output=True, timeout=120,
            stdin=subprocess.DEVNULL,
        )
    except (OSError, subprocess.SubprocessError) as error:
        raise ModelIdentityUnread(
            f"nao foi possivel perguntar ao runtime pela identidade de {tag!r}: {error}"
        ) from error
    if listing.returncode != 0 or shown.returncode != 0:
        raise ModelIdentityUnread(
            f"o runtime recusou a consulta de identidade de {tag!r} "
            f"(list rc={listing.returncode}, show rc={shown.returncode})"
        )
    content_id = ""
    for line in listing.stdout.decode("utf-8", errors="replace").splitlines():
        fields = line.split()
        if len(fields) >= 2 and fields[0] == tag:
            content_id = fields[1]
            break
    if not content_id:
        raise ModelIdentityUnread(
            f"o tag {tag!r} nao esta em `ollama list`: ele nao foi puxado nesta maquina, "
            "e gerar contra ele pediria ao runtime para buscar pesos que ninguem escolheu"
        )
    found = _OLLAMA_QUANTIZATION.search(shown.stdout.decode("utf-8", errors="replace"))
    if not found:
        raise ModelIdentityUnread(
            f"`ollama show {tag}` nao declara quantizacao: ela e parte da familia "
            "geradora, e duas quantizacoes de uma linhagem sao dois geradores"
        )
    return content_id, found.group(1)


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
# As oito TAREFAS do slate, cada uma a instrucao inteira de um pedido. A frase carrega
# `{words}` porque o comprimento pedido e o da propria semente humana (`target_word_count`),
# e nao um alvo do slate.
GENERATION_TASKS: dict[str, str] = {
    "original": (
        "Escreva um texto original em portugues do Brasil sobre o mesmo assunto do "
        "texto de referencia abaixo, com aproximadamente {words} palavras, sem copiar "
        "frases nem a estrutura dele."
    ),
    "parafrase": (
        "Reescreva o texto de referencia abaixo em portugues do Brasil com as suas "
        "proprias palavras, mantendo o mesmo significado e aproximadamente {words} "
        "palavras."
    ),
    "resumo": (
        "Resuma o texto de referencia abaixo em portugues do Brasil em aproximadamente "
        "{words} palavras, preservando os fatos principais e descartando o acessorio."
    ),
    "didatico": (
        "Explique em portugues do Brasil, para quem nunca leu sobre o assunto, o que o "
        "texto de referencia abaixo trata, em aproximadamente {words} palavras."
    ),
    "verbete": (
        "Escreva um verbete enciclopedico em portugues do Brasil sobre o tema central "
        "do texto de referencia abaixo, com aproximadamente {words} palavras, comecando "
        "pela definicao."
    ),
    "noticia": (
        "Escreva uma noticia curta em portugues do Brasil a partir do tema do texto de "
        "referencia abaixo, com aproximadamente {words} palavras, dizendo o que "
        "aconteceu e por que importa."
    ),
    "feed": (
        "Escreva uma publicacao de feed profissional em portugues do Brasil sobre o "
        "tema do texto de referencia abaixo, com aproximadamente {words} palavras, em "
        "paragrafos curtos e sem hashtags."
    ),
    "comentario": (
        "Escreva um comentario pessoal em portugues do Brasil reagindo ao assunto do "
        "texto de referencia abaixo, com aproximadamente {words} palavras, dizendo o "
        "que voce acha e por que."
    ),
}

# Os cinco REGISTROS, cada um a clausula que modula a tarefa.
GENERATION_REGISTERS: dict[str, str] = {
    "formal": (
        "Use registro formal: vocabulario preciso, frases completas, sem contracoes "
        "nem giria."
    ),
    "neutro": (
        "Use registro neutro: nem cerimonioso nem coloquial, do jeito que um texto de "
        "consulta e escrito."
    ),
    "coloquial": (
        "Use registro coloquial: escreva como quem conversa com um conhecido, frases "
        "curtas e palavras do dia a dia."
    ),
    "tecnico": (
        "Use registro tecnico: termos da area quando forem necessarios, precisao acima "
        "de fluidez."
    ),
    "apressado": (
        "Use registro apressado: escreva rapido, sem polir, do jeito que sai na "
        "primeira passada."
    ),
}

# O fecho, identico em todos: ele existe para o provedor devolver texto e nao um recado, e
# como a sonda de eco do gate antiartefato e um dicionario CHAVEADO PELO CHUNK, uma frase
# repetida nos quarenta templates vale UMA sonda.
_TASK_CLOSING = "Responda apenas com o texto, sem titulo e sem comentarios."

# As duas receitas de uma ilha diferem nas DUAS coordenadas, e e a regra que o impoe: o slot
# `a` tira a tarefa das quatro primeiras e o `b` das quatro ultimas, e o registro do `b` e
# deslocado de dois. Duas receitas que compartilhassem a tarefa ou o registro seriam
# variantes uma da outra, e a particao de template que o split modela ficaria decorativa —
# os digests seriam distintos e a dependencia de prompt, nao.
_REGISTER_SHIFT = 2

# Quantas ilhas o slate serve. E um ESPELHO de `assemble_corpus.ISLAND_COUNT`, e nao a
# leitura dele, porque ler o plano aqui fecha um ciclo de import MEDIDO: este modulo importa
# `assemble_corpus`, que importa `artifact_gate`, que le `RECIPES` no import dele — e
# `RECIPES` ainda nao existe. O espelho e pinado por igualdade em teste nomeado, contra os
# nomes que `_island()` declara em `templates`: o plano crescer sem o slate crescer fica
# vermelho la, e nao em silencio aqui.
_SLATE_ISLAND_COUNT = 20


def _slate_pair(indice: int) -> tuple[tuple[str, str], tuple[str, str]]:
    """As duas coordenadas (tarefa, registro) dos dois slots de uma ilha."""
    tarefas = tuple(GENERATION_TASKS)
    registros = tuple(GENERATION_REGISTERS)
    metade = len(tarefas) // 2
    grupo, resto = divmod(indice, len(registros))
    return (
        (tarefas[grupo], registros[resto]),
        (
            tarefas[metade + grupo],
            registros[(resto + _REGISTER_SHIFT) % len(registros)],
        ),
    )


def _slate_template(tarefa: str, registro: str) -> str:
    return (
        f"{GENERATION_TASKS[tarefa]} {GENERATION_REGISTERS[registro]} {_TASK_CLOSING}"
        "\n\n=== TEXTO DE REFERENCIA ===\n{reference}"
    )


def _build_slate() -> dict[str, dict]:
    """O slate DERIVADO do plano de ilhas, e nao quarenta literais.

    Duas razoes para derivar, e a segunda e medida. A primeira: os nomes tem de ser
    exactamente os que `assemble_corpus._island()` declara em `templates`, e uma segunda
    escrita deles divergiria sem nada reprovar. A segunda: o gate antiartefato deriva as
    sondas de ECO da prosa de instrucao de cada template (`artifact_gate`), chaveadas pelo
    chunk, e a taxa dessas sondas sobre a classe HUMANA em moldura tem teto pre-inscrito de
    2 %. Quarenta prompts de prosa propria multiplicariam a superficie de eco por dez contra
    esse teto; compor os quarenta de oito tarefas mais cinco registros mantem os chunks
    distintos na ordem de grandeza de hoje, porque a frase repetida vale UMA sonda.

    `weight` e uniforme porque numa ilha ele e o rateio entre os DOIS slots: qualquer outra
    mistura precisaria de um alvo por tarefa que autoridade alguma declara, e a mistura
    antiga (5/2/2/1 entre generos) era do slate de quatro, que nao era particionado por ilha.
    `task` e `register` sao campos DECLARADOS porque decisao a jusante le o campo e nunca o
    nome: `assemble_corpus` decide por eles se a linha e derivacao do pai.
    """
    slate: dict[str, dict] = {}
    for indice in range(_SLATE_ISLAND_COUNT):
        nomes = (f"pt-ilha-{indice:02d}-a", f"pt-ilha-{indice:02d}-b")
        for nome, (tarefa, registro) in zip(nomes, _slate_pair(indice), strict=True):
            slate[nome] = {
                "weight": 1,
                "template": _slate_template(tarefa, registro),
                "task": tarefa,
                "register": registro,
            }
    return slate


RECIPES: dict[str, dict] = _build_slate()

# As tarefas que REESCREVEM o pai em vez de escrever texto novo sobre o mesmo assunto. So a
# reescrita faz a linha ser DERIVACAO do pai; as outras nomeiam a semente e deixam
# `derivationRoot` em `notApplicable`, e colapsar os dois eixos inventaria uma derivacao ou
# perderia a semente. `assemble_corpus` le esta lista pelo CAMPO `task` da receita, nunca
# pelo nome dela: com o slate particionado por ilha, o nome nao diz mais que tarefa e.
REWRITING_TASKS: frozenset[str] = frozenset({"parafrase"})


class UnknownRecipe(RuntimeError):
    """Uma receita que o slate nao declara, e por isso nao tem tarefa a ler."""


def recipe_rewrites_the_parent(recipe: str) -> bool:
    """Se a receita reescreve o pai. Levanta em receita que o slate nao declara.

    Fail-fechado de proposito: adivinhar `False` para uma receita desconhecida escreveria
    `notApplicable` num eixo de conectividade sem que nada acuse, e adivinhar `True`
    inventaria derivacao. Quem chama trata a recusa por linha.
    """
    spec = RECIPES.get(recipe)
    if spec is None:
        raise UnknownRecipe(
            f"o slate nao declara a receita {recipe!r}: as tarefas dele sao "
            f"{tuple(sorted(GENERATION_TASKS))} e a classificacao de derivacao le o "
            "campo `task`, entao uma receita de fora dele nao tem tarefa a ler"
        )
    return str(spec["task"]) in REWRITING_TASKS

class SeedLengthOutOfWindow(RuntimeError):
    """A human seed whose length the extractor's own window would have refused."""


def target_word_count(human_word_count: int) -> int:
    """The length asked of the generated line: the length of the human line it is paired with.

    RULE OF DOMAIN, and it is the reason this is a function and not a number in the
    prompt. The detector must not be able to read the class off the word count. The
    human class is the lead sections of Wikipedia pt, whose measured distribution is
    long-tailed (p25 = 72, p50 = 120, p75 = 221, max 1 774 words over 25 036 admissible
    pages), so ANY constant or clamped target makes the generated class a truncated copy
    of it: no generated twin below the lower clamp, none above the upper one, and the
    count alone then separates the classes at both tails. `probe_length` in
    diagnostic_probes.py — predict the class from the word count alone — is the criterion
    this function is written against, and a clamp reintroduced here is what turns that
    probe's AUC away from chance.

    Pairing per seed rather than drawing from the distribution: the seeds ARE the
    distribution, so matching each one is the distribution match, and it survives a
    change in the human material without a second place to update.

    Refuses a seed outside the extractor's admissible window instead of clamping it into
    range. A seed of 20 or 9 000 words did not come out of the rules the measurement
    describes, and generating against it would put a length in the AI class that the
    human class cannot hold.

    Unlike `GenerationRefused`, this ABORTS the lane instead of skipping the item: the
    seeds come from an extractor that enforces the same window, so a row outside it says
    the input file is not extractor output — a fact about the whole file. Skipping would
    drop precisely the tail this function exists to preserve and report success.
    """
    if not MINIMUM_WORDS <= human_word_count <= MAXIMUM_WORDS:
        raise SeedLengthOutOfWindow(
            f"a semente humana tem {human_word_count} palavras, fora da janela "
            f"admissivel [{MINIMUM_WORDS}, {MAXIMUM_WORDS}] do extrator: gerar contra "
            "ela poe na classe IA um comprimento que a classe humana nao tem, e o "
            "comprimento sozinho passa a separar as classes"
        )
    return int(human_word_count)


def _weighted_recipe(names: tuple[str, ...], salt: str) -> str:
    """Deterministic pick among `names`, honouring their declared weight mix.

    The weights are the V2 plan's mix and they are a DESIGN decision, so restricting the
    candidate set to one island must not silently flatten them: the bucket is taken modulo
    the weight sum OF THE NAMES OFFERED, which keeps the ratio between whichever of them
    the island carries.
    """
    if not names:
        raise ValueError(
            f"nenhum template oferecido para {salt!r}: uma ilha sem template nao pode "
            "gerar linha alguma"
        )
    total = sum(RECIPES[name]["weight"] for name in names)
    digest = hashlib.sha256(f"recipe:{salt}".encode()).digest()
    bucket = int.from_bytes(digest[:4], "big") % total
    cursor = 0
    for name in names:
        cursor += RECIPES[name]["weight"]
        if bucket < cursor:
            return name
    return names[-1]


def recipe_for_island(island: dict, candidate_id: str) -> str:
    """The template of ONE line, and it is a template OF THIS ISLAND — imposed, not promised.

    Two refusals rather than a comment. The seed is checked against the island's own block
    first: a candidate the plan puts in another island cannot be paired here at all, and
    without that check the template partition is decorative — measured on the pools in HEAD,
    116 of the 1046 seeds are paired by lines of MORE THAN ONE generation run, and those
    edges alone fuse the five runs into one component. The fusing relation is `humanSeed`
    LINEAGE, so it bites whatever the runs are named by. Then the pick is restricted to the
    island's templates, so the identity written on the row cannot come from outside it.
    """
    lab = assembler()
    dono = lab.island_of_seed(lab.ISLAND_PLAN, candidate_id)
    if dono["island"] != island["island"]:
        raise lab.IslandPlanRefused(
            f"a semente {candidate_id!r} pertence ao bloco da ilha {dono['island']!r} e a "
            f"corrida e da ilha {island['island']!r}: emparelhar as duas funde as ilhas "
            "pelo pai humano, e o particionamento de templates fica decorativo"
        )
    return _weighted_recipe(tuple(island["templates"]), f"{island['island']}:{candidate_id}")


def template_digest(recipe: str) -> str:
    return hashlib.sha256(RECIPES[recipe]["template"].encode("utf-8")).hexdigest()

# One default per lane the parser admits, and the sets are pinned equal by test: a lane
# without an entry here fails at `DEFAULT_MODELS[provider]` after the parser accepted it.
DEFAULT_MODELS = {
    "gemini": "gemini-2.0-flash",
    # CLI channels — held-out families via the user's login (no key).
    "agy": "claude-sonnet-4-6",
    "codex": "gpt-5.6-luna",
    # gemini_cli defaults to the family with a concrete deficit: flash-preview
    # needs >= 200 positives before it can be DECLARED held-out at all. Rotate
    # with --models gemini-3-flash-preview,gemini-3.5-flash-lite,... to spread
    # across the gemini-3.x buckets.
    "gemini_cli": "gemini-3-flash-preview",
    # The first of the two reserved lineages. The tag is EXPLICIT and never `latest`: a
    # moving pointer resolves to one set of weights today and another tomorrow, so it does
    # not identify what generated a line.
    "ollama": "qwen2.5:7b",
}
# The lanes that accept a sampling seed, which is ONE: the local runtime. On it the seed is
# derived from the paired candidate id, so a resumed run reproduces the same seed for the
# same line — a seed drawn at random would be recorded and never reproducible, which is
# the opposite of what the field is for. Every other lane records `seedNullReason`, and
# `seed_pair` on the assembler side expects exactly one of the two.
SEEDED_PROVIDERS: set[str] = {"ollama"}
SEED_NULL_REASON = "provider API does not expose a sampling seed"
TEMPERATURE = 0.8
# Output budget of the REST lane, per generation. A token covers a FRACTION of a word of
# pt-BR prose, so these two turn a word target into a token ceiling; 2.0 is above the
# ~1.4-1.7 tokens per word this kind of prose costs, and the margin absorbs punctuation
# and the rare long word. Ceiling and not target: a model that stops on its own spends
# nothing extra.
OUTPUT_TOKENS_PER_WORD = 2.0
OUTPUT_TOKEN_MARGIN = 256
# The `finishReason` values that mean the model STOPPED, as opposed to being cut off.
# Anything else — MAX_TOKENS, SAFETY, RECITATION — is a partial answer.
COMPLETE_FINISH_REASONS = {"STOP", "FINISH_REASON_STOP"}
RETRIABLE = {429, 500, 502, 503, 529}


def max_output_tokens(target_words: int) -> int:
    """The output ceiling of one REST generation, scaled to the length being asked for.

    RULE OF DOMAIN, and it is why this is a function and not a constant. A FIXED token
    budget is a length clamp on the far side of the transport: the 1 024 that used to sit
    here stopped the answer at roughly 600 words of pt-BR, while the human class this
    generation is paired against runs to 1 774 words (p90 = 362). The paired target would
    be honoured in the prompt and truncated in the response, which is the same defect
    `GEMINI_INCOMPLETE` exists to prevent on the CLI lane — and it would put a ceiling in
    the AI class that the human class does not have, so the count alone separates them at
    the tail.

    A budget the provider's own output limit cannot hold is NOT silently clamped here:
    the request either errors or comes back with a truncating `finishReason`, and
    `call_provider` refuses the item rather than accepting a cut text.
    """
    return math.ceil(target_words * OUTPUT_TOKENS_PER_WORD) + OUTPUT_TOKEN_MARGIN


def http_json(
    url: str, payload: dict, headers: dict[str, str], timeout: float = 120
) -> dict:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": "application/json", **headers}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


class GenerationRefused(Exception):
    """The provider answered without usable content (safety block, empty
    candidates, truncated shape). Deterministic per item — the caller must SKIP
    the item, never retry it and never abort the batch."""


def call_provider(
    provider: str,
    model: str,
    prompt: str,
    seed: int | None,
    keys: dict[str, str],
    target_words: int,
) -> str:
    # The transports of the two out-of-slate API surfaces are GONE from this function,
    # and the names are not: a caller that asks for one gets the reason, where before it
    # got a generation this corpus cannot accept. Reinstating a transport is a slate
    # amendment, not an edit here.
    if provider in OUT_OF_SLATE_PROVIDERS:
        raise ValueError(
            f"provider {provider!r} is outside the frozen slate: "
            f"{OUT_OF_SLATE_PROVIDERS[provider]}. Admissible lanes: "
            + ", ".join(sorted(PROVIDER_LANE))
        )
    if provider == "gemini":
        data = http_json(
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{model}:generateContent?key={keys['gemini']}",
            {
                "contents": [{"parts": [{"text": prompt}]}],
                "generationConfig": {
                    "temperature": TEMPERATURE,
                    "maxOutputTokens": max_output_tokens(target_words),
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
        # Read AFTER the text so an empty candidate still reports promptFeedback, which
        # names the cause. A reason other than STOP means the answer was CUT SHORT and
        # the text on hand is a fragment: MAX_TOKENS is truncation, SAFETY and RECITATION
        # are partial answers. An ABSENT reason is not a failure — the field is optional
        # on a normal stop — but a present one that is not STOP is, on the same ground as
        # `GEMINI_INCOMPLETE` on the CLI lane: a partial answer accepted as a whole one is
        # a scientific defect, not a glitch.
        finish = str(candidates[0].get("finishReason") or "")
        if finish and finish.upper() not in COMPLETE_FINISH_REASONS:
            raise GenerationRefused(
                f"gemini interrompeu a resposta ({finish}) com {len(text)} caracteres "
                f"para um alvo de {target_words} palavras: texto cortado nao entra no "
                "corpus"
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
    if provider == "ollama":
        # The one lane where the sampling parameters are OURS, and all three are passed:
        # the seed makes the line reproducible, the temperature is the same 0.8 the rest of
        # the corpus was generated under, and `num_predict` is the output ceiling scaled to
        # the paired length. `stream: false` because a streamed answer would have to be
        # reassembled here and a reassembly bug is indistinguishable from a truncation.
        data = http_json(
            f"{OLLAMA_HOST}/api/generate",
            {
                "model": model,
                "prompt": prompt,
                "stream": False,
                "options": {
                    "temperature": TEMPERATURE,
                    "seed": seed,
                    "num_predict": max_output_tokens(target_words),
                },
            },
            {},
            timeout=OLLAMA_TIMEOUT,
        )
        text = str(data.get("response") or "")
        if not text.strip():
            raise GenerationRefused(
                f"ollama sem conteudo: {str(data)[:160]}"
            )
        # `done_reason` is the runtime's own word for why it stopped, and anything but
        # `stop` means the answer is a fragment — `length` is the `num_predict` ceiling
        # hit, `load` is a model that never got going. A fragment accepted as a whole
        # answer is a scientific defect, which is the same rule the other lanes apply to
        # their own truncation signals.
        reason = str(data.get("done_reason") or "")
        if reason and reason != "stop":
            raise GenerationRefused(
                f"ollama interrompeu a resposta ({reason}) com {len(text)} caracteres "
                f"para um alvo de {target_words} palavras: texto cortado nao entra no "
                "corpus"
            )
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


def select_pairs(
    humans: list[dict], provider: str, count: int, done: set[str], island: dict
) -> list[dict]:
    """Deterministic provider-specific sample of the seeds OF ONE ISLAND.

    `island` is required and not defaulted. The sampling salt is per PROVIDER and `done` is
    per output file, so nothing here ever confined a lane to a block of seeds: measured on
    the pools in HEAD, 116 of the 1046 seeds are paired by lines of more than one generation
    run, and a union-find over the runs with only those `humanSeed` edges fuses the five into
    ONE component. A parameter with a default would let a caller keep the old behaviour and
    the partition of templates would go back to being decorative.
    """
    lab = assembler()
    selected: list[dict] = []
    for rate in (3, 2, 1):  # widen deterministically until count is met
        for row in humans:
            if len(selected) >= count:
                return selected
            cid = row["candidateId"]
            if cid in done or any(s["candidateId"] == cid for s in selected):
                continue
            if lab.island_of_seed(lab.ISLAND_PLAN, cid)["island"] != island["island"]:
                continue
            if keep_sample(f"{provider}:{cid}", rate):
                selected.append(row)
    return selected


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--provider",
        required=True,
        type=frozen_lane,
        choices=sorted(PROVIDER_LANE),
        metavar="{" + ",".join(sorted(PROVIDER_LANE)) + "}",
    )
    # REQUIRED, and the `type=` is where the plan is judged. A default would make a run
    # that forgot the flag generate for whichever island the default names, which is the
    # one thing the plan exists to prevent: two lanes writing into one island draw from the
    # same two prompt templates and their rows are ONE component.
    parser.add_argument(
        "--island",
        required=True,
        type=island_plan,
        metavar="{"
        + ",".join(ilha["island"] for ilha in assembler().ISLAND_PLAN[:2])
        + ",...}",
    )
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
    # The reserve generates in the RESERVED islands, imposed here and not promised
    # downstream. The seating is by FAMILY and by COMPONENT: one reserved line drags its
    # whole component into `test`, and a component reaches whatever the human seed unions
    # — so a reserved row seeded from a core island pulls that island's core rows into the
    # blind block and spends the reserve's line budget somewhere the plan did not put it.
    # Refused before the seeds file is opened, before the lane lock and before the first
    # generation, on the same ground as the island check itself.
    #
    # The CONVERSE is not guarded: a core lane pointed at a reserved island is admitted
    # here, and it would consume the budget the plan set aside for the reserve. That is a
    # coverage-plan question and this refusal does not decide it.
    if args.provider == "ollama" and args.island["island"] not in (
        assembler().RESERVED_ISLANDS
    ):
        raise SystemExit(
            f"a ilha {args.island['island']!r} nao e reservada, e esta lane escreve a "
            f"reserva OOD. Ilhas reservadas: "
            f"{', '.join(assembler().RESERVED_ISLANDS)}. Uma linha reservada semeada "
            "numa ilha de nucleo arrasta o componente dela — e as linhas de nucleo que o "
            "pai humano une — para o bloco cego"
        )

    import os

    provider = args.provider
    models = (
        [m.strip() for m in args.models.split(",") if m.strip()]
        if args.models
        else [args.model or DEFAULT_MODELS[provider]]
    )
    model = models[0]
    # One key, because one frozen lane is an API endpoint and the other three
    # authenticate through the operator's own login. A dict entry for a provider the
    # parser cannot admit would be an environment variable this project never has.
    keys = {
        "gemini": os.environ.get("GEMINI_API_KEY", "")
        or os.environ.get("GOOGLE_API_KEY", ""),
    }

    island = args.island
    humans = load_humans(args.humans)
    done = already_paired(args.output)
    pairs = select_pairs(humans, provider, args.per_provider, done, island)
    print(
        f"{provider}/{model} @ {island['island']}: {len(pairs)} a gerar "
        f"(humans={len(humans)}, resume-skip={len(done)})"
    )
    if args.dry_run:
        # TODAS as linhas propostas, e nao uma amostra: o que se le aqui e o template de
        # cada linha que a corrida escreveria, e uma amostra provaria a ilha nas cinco
        # sorteadas e nada sobre a corrida.
        for row in pairs:
            print(
                f"  seed-topic {row['candidateId']} ({row['wordCount']} palavras) "
                f"receita={recipe_for_island(island, row['candidateId'])}"
            )
        return
    # CLI channels authenticate via the user's login, not an env key.
    if provider not in KEYLESS_PROVIDERS and not keys[provider]:
        raise SystemExit(
            f"defina a variável de ambiente da chave do provedor '{provider}'"
        )

    # ONCE per lane, before any generation: the binary does not change mid-run, and
    # asking it 400 times would be 400 subprocesses for one answer. Captured BEFORE
    # the first call so the version recorded is the one that produced the first row
    # as well as the last.
    captured_harness = harness_version(provider)
    if provider == "ollama" and captured_harness is None:
        # Refused instead of written as `unknown`, and ONLY on this lane. Everywhere else
        # an uncaptured version costs the row its eligibility and the core does not need
        # it; here the rows ARE the OOD reserve, whose positives floor
        # (`countsTowardHeldOutFloor`) is filtered by that very eligibility. Hours of
        # generation that cannot count toward the floor answer no question.
        raise SystemExit(
            "a versao do runtime ollama nao foi capturada. Esta lane escreve a reserva "
            "OOD, cujo piso de positivos e filtrado por elegibilidade, entao uma corrida "
            "sem versao produz material que nao conta — e uma versao inventada e a "
            "substituicao que R6 proibe"
        )
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

    def generate(
        prompt: str, seed: int | None, target_words: int
    ) -> tuple[str, str] | None:
        walls = 0  # 429s consecutivos; zera ao primeiro sucesso (via return)
        while live:
            active = live[cursor["i"] % len(live)]
            try:
                return call_with_retries(
                    call_provider, provider, active, prompt, seed, keys, target_words
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

    # The identity a row writes for its generator, per provider. On every lane but the
    # local runtime the three fields are the model id, because the id is all the provider
    # gives; on `ollama` the family carries the QUANTIZATION and the version carries the
    # CONTENT ID, because a tag is a label and the weights behind it are what generated
    # the text. Read once, before the first call, for the same reason the harness version
    # is: it identifies what produced the first row as well as the last.
    def generator_identity(model: str) -> tuple[str, str, str]:
        if provider != "ollama":
            return model, model, model
        content_id, quantization = ollama_model_identity(model)
        return (
            assembler().reserve_family(model, quantization),
            model,
            f"{model}@{content_id}",
        )

    identities = {model: generator_identity(model) for model in models}

    try:
        for index, row in enumerate(pairs, start=1):
            recipe = recipe_for_island(island, row["candidateId"])
            target_words = target_word_count(int(row["wordCount"]))
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
                result = generate(prompt, seed, target_words)
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
                    "family": identities[model][0],
                    "model": identities[model][1],
                    "version": identities[model][2],
                    "recipe": recipe,
                    # The lane the generator OBSERVED itself running on, plus the
                    # version of the binary that produced this very text. Both are
                    # grouping axes in v3, and both were missing from every row the
                    # v2 runs wrote — so every CLI-lane row of those pools takes the
                    # `unknown` arm of `harness_axis` and is ineligible on that axis
                    # alone. The COUNT is deliberately not written here: it is a
                    # property of one assembly run, not of this writer, and an earlier
                    # revision of this comment carried "323 of 635" long after the
                    # delivered run measured otherwise — two figures for one command.
                    # The current number lives in the C2 debt table of
                    # docs/superpowers/plans/2026-07-26-detector-v3-rebuild-implementation.md,
                    # which is re-measured per run.
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
        batch_path.write_text(
            json.dumps(
                {
                    "batchId": f"batch_{provider}_{'-'.join(models)}".replace(
                        ".", "_"
                    ),
                    "sourceId": f"src_ai_{provider}",
                    "generationProtocolVersion": "generation-v1",
                    "provider": provider,
                    # The batch names what the ROWS name, field for field: the governance
                    # audit compares a record against its declared batch by exact
                    # equality, so a batch that spelled the family or the version its own
                    # way would block every row it describes.
                    "family": ",".join(identities[m][0] for m in models),
                    "model": ",".join(identities[m][1] for m in models),
                    "version": ",".join(identities[m][2] for m in models),
                    "models": models,
                    "island": island["island"],
                    "islandSeedBlock": island["seedBlock"],
                    # Só as receitas DESTA ilha. Declarar todas as `RECIPES` fazia o lote
                    # nomear receita que a corrida não usou, e um lote que declara um
                    # template ausente das suas linhas descreve outra corrida.
                    "recipes": {
                        name: template_digest(name) for name in island["templates"]
                    },
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
