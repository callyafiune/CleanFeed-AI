"""The pre-training anti-artifact gate (A4), over the generated rows of an assembly.

WHAT IT DECIDES. Four detections, each named in the diagnosis it produces:

  * `prompt-echo` — the line repeats the instruction it was given;
  * `refusal` — the model declined the task instead of performing it;
  * `metaconversation` — the line talks ABOUT the task (delivers it, offers to revise
    it, identifies itself as a model) instead of being the text;
  * `harness-signature` — the mark of the binary or CLI that produced the line.

A generator family above `CONTAMINATION_CEILING` sends its whole LANE back for
regeneration. Selective pruning is not an outcome this module can produce: it names no
line, so nothing downstream can drop the lines it counted. That is A4's rule and the
reason for it — dropping the contaminated lines of a lane leaves a lane whose surviving
lines are the ones the artifact detector missed, and the corpus then carries the lane's
bias with no record of it.

WHERE THE PROBES COME FROM. `prompt-echo` and `harness-signature` are anchored in the
generator's own constants (`generate_ai.RECIPES`, `generate_ai.CLI_BANNER_PREFIXES`,
`generate_ai.GEMINI_AUTH_MARKERS`), so "the output repeats the prompt" means the prompts
this repository issues, and "harness residue" means the banners its lanes emit. The
refusal and metaconversation frames are written here, and every one of them names the
TASK or the assistant voice rather than a bare phrase: measured over the 14.783 pool
rows on disk, the bare phrasings match human prose (a Stack Overflow answer that ends
"espero ter ajudado", a review that says "não posso avaliar o produto", a robots.txt
excerpt that starts a line with "user"), and the frames do not.

POSITION IS NOT USED. Anchoring a frame to the opening of the line was measured and
rejected: the three human-prose matches of the bare refusal phrasings sit at offsets 10,
67 and 214, inside any opener window worth having. What separates a refusal from prose is
the frame, and a window would have bought a blind spot for the second half of a line.

Python stdlib only, deterministic, and it reads nothing but the records handed to it.
"""

from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass
from fractions import Fraction
from typing import Iterable

import generate_ai
import group_axes

DETECTION_PROMPT_ECHO = "prompt-echo"
DETECTION_REFUSAL = "refusal"
DETECTION_METACONVERSATION = "metaconversation"
DETECTION_HARNESS_SIGNATURE = "harness-signature"
# Canonical order, used by every report and message so two runs over one corpus produce
# the same bytes.
DETECTION_NAMES: tuple[str, ...] = (
    DETECTION_PROMPT_ECHO,
    DETECTION_REFUSAL,
    DETECTION_METACONVERSATION,
    DETECTION_HARNESS_SIGNATURE,
)

# A4, frozen 2026-07-26: a family above this fraction regenerates its whole lane. A
# Fraction and not a float because the verdict is a strict comparison at the boundary and
# `Fraction(21, 1000) > 0.02` is a float comparison with a value that is not 2/100.
#
# In CODE and not in the policy: `preregistration-v4.json` is sealed and carries no
# contamination field, and adding one would be a change of policy rather than a reading
# of it. When the pre-registration next moves, this is the constant that becomes a field.
#
# THERE IS NO MINIMUM DENOMINATOR, and in a smoke that is zero tolerance by arithmetic: at
# six rows in a family the smallest non-zero fraction is 1/6, so one detection refuses. That
# is the intended reading and not an oversight — the alternative is a family the gate
# measures and does not act on, which is a third outcome besides passing and refusing, and
# the one an operator under deadline would reach for. A fraction is scale-free, a detected
# artifact is an artifact at any n, and the remedy (regenerate the lane) costs least exactly
# when the lane is small.
CONTAMINATION_CEILING = Fraction(2, 100)

VERDICT_CLEAR = "clear"
VERDICT_REGENERATE_LANE = "regenerate-lane"

# Typographic quotes normalized to ASCII before matching: a model writes "can't" with
# U+2019 as often as with U+0027, and a probe list spelled both ways twice is a list that
# will be half-updated.
_QUOTES = {0x2018: "'", 0x2019: "'", 0x201C: '"', 0x201D: '"', 0x2032: "'"}

# The shortest literal a template chunk may contribute as an echo probe. Below it the
# chunks are ordinary Portuguese ("seu", "natural", "direto") and would match prose.
_ECHO_PROBE_MINIMUM_CHARS = 20

# `palavras` as the plural noun, refusing the compound: `palavras-chave` is a different
# word. Measured, without the lookahead `de 3 a 5 palavras-chave` — a call for papers
# asking for keywords, in a Carolina university document — reads as a word-count
# instruction. It applies to every probe whose text contains the word, the DERIVED template
# chunks included, because two recipe chunks end in it.
_PALAVRAS_NOT_COMPOUNDED = r"palavras(?![-\w])"


def fold(text: str) -> str:
    """Casefolded, accent-stripped, whitespace-collapsed — newlines included.

    Accents are folded rather than kept because a 20-character instruction fragment that
    differs from the template only in accents is an echo either way, and models drop
    accents. Nothing here is written back anywhere: this is a comparison form.
    """
    text = text.translate(_QUOTES)
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    return re.sub(r"\s+", " ", text).casefold()


def fold_lines(text: str) -> str:
    """`fold`, but keeping the line structure the harness banners are anchored to.

    `generate_ai.GEMINI_NOISE` matches at the START of a line, which is what makes
    "Data collection" a telemetry banner instead of two ordinary words, so the flat fold
    cannot be used for it.
    """
    text = text.translate(_QUOTES)
    text = unicodedata.normalize("NFD", text)
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n")]
    return "\n".join(lines).casefold()


def _echo_probes_from_templates() -> dict[str, str]:
    """The instruction text of every recipe `generate_ai` issues, as label -> pattern.

    Only the part BEFORE `{reference}` becomes a probe. The reference is the human seed,
    so a line that repeats it is a near-duplicate of a human row, which `near_dupes`
    decides and this gate must not double-count under another name.

    `{words}` becomes `\\d+`: the number changes per item (it is derived from the seed's
    length), and a probe carrying one literal count would match one item in hundreds.

    The label is the readable chunk and the pattern is its escaped form, because the label
    is what the report publishes and an escaped regex is not a diagnosis anyone can read.

    `palavras` in a chunk becomes `_PALAVRAS_NOT_COMPOUNDED` for the reason stated there:
    two of the recipe chunks end in that word, so the compound has to be refused in the
    derivation and not only in the hand-written directive probes.
    """
    probes: dict[str, str] = {}
    for spec in generate_ai.RECIPES.values():
        instruction = str(spec["template"]).split("{reference}")[0]
        for chunk in re.split(r"[.,;]\s*", fold(instruction)):
            chunk = chunk.strip()
            if len(chunk.replace("{words}", "")) < _ECHO_PROBE_MINIMUM_CHARS:
                continue
            probes[chunk] = (
                re.escape(chunk)
                .replace(re.escape("{words}"), r"\d+")
                .replace("palavras", _PALAVRAS_NOT_COMPOUNDED)
            )
    return probes


# Instruction shapes that are prompt-shaped whatever prompt issued them. They exist
# because the measured echoes in the pools are echoes of a THIRD PARTY's prompt: the
# `madras` rows carry "aproximadamente 1000 palavras em portugues brasileiro" followed by
# a turn marker, and no template of this repository contains that sentence. A word-count
# directive addressed to a generator is not a sentence of prose.
_ECHO_DIRECTIVE_PROBES: dict[str, str] = {
    "<adverbio> {words} palavras": (
        r"(?:aproximadamente|cerca de|em torno de) \d+ " + _PALAVRAS_NOT_COMPOUNDED
    ),
    "{words}-{words} palavras": (
        r"\d+ ?(?:-|a|ate) ?\d+ " + _PALAVRAS_NOT_COMPOUNDED
    ),
    "palavras em portugues brasileiro": r"palavras em portugues brasileiro",
    "responda apenas com": r"responda apenas com",
}

# label -> pattern, in label order. The two halves are kept in one mapping because a
# caller must not be able to run one set without the other: the templates catch an echo of
# OUR prompt and the directives catch an echo of somebody else's.
ECHO_PROBES: dict[str, str] = {
    label: pattern
    for label, pattern in sorted(
        {**_echo_probes_from_templates(), **_ECHO_DIRECTIVE_PROBES}.items()
    )
}

# A refusal names the TASK it declines. The object is what makes the frame a refusal:
# measured, "nao posso ajudar", "nao posso escrever" and "nao posso te ajudar" all occur
# in human pool prose ("nao posso ajudar ninguem", "nao posso escrever aqui um
# testamento", a forum answer that says "eu nao posso te ajudar porem tenho uma
# informacao"), and none of those carries an object like "com isso" or "esse pedido".
REFUSAL_FRAMES: tuple[str, ...] = (
    "nao posso ajudar com isso",
    "nao posso ajudar com esse",
    "nao posso ajudar com essa",
    "nao posso te ajudar com isso",
    "nao posso atender a esse",
    "nao posso atender a essa",
    "nao posso atender esse pedido",
    "nao posso atender essa solicitacao",
    "nao posso fornecer esse tipo",
    "nao posso gerar esse tipo",
    "nao posso criar esse tipo",
    "nao posso escrever esse tipo",
    "nao posso produzir esse tipo",
    "nao posso realizar essa tarefa",
    "nao posso continuar com esse",
    "nao posso completar essa",
    "nao posso cumprir esse pedido",
    "nao consigo ajudar com isso",
    "nao consigo ajudar com esse",
    "sinto muito, mas nao posso",
    "desculpe, mas nao posso",
    "lamento, mas nao posso",
    "i cannot help with that",
    "i can't help with that",
    "i cannot assist with that",
    "i can't assist with that",
    "i'm sorry, but i can't",
    "i am sorry, but i cannot",
    "i'm not able to help with",
)

# Three frames, one detection. DELIVERY hands the artifact over ("aqui esta o texto"),
# OFFER proposes another round ("se precisar de mais"), SELF-IDENTIFICATION speaks as the
# model ("como um modelo de linguagem"). All three are the assistant talking about the
# task; none of them is the text the corpus asked for.
#
# The self-identification frames stay in the FIRST PERSON on purpose: "inteligencia
# artificial" is a topic 4.048 generated rows discuss, and a bare mention matched 26 of
# them, every one of them prose about AI.
METACONVERSATION_FRAMES: tuple[str, ...] = (
    "aqui esta o texto",
    "aqui esta a versao",
    "aqui esta o post",
    "aqui vai o texto",
    "segue o texto",
    "segue abaixo o texto",
    "texto conforme solicitado",
    "espero ter ajudado",
    "espero que ajude",
    "espero que isso ajude",
    "se precisar de mais",
    "estou a disposicao",
    "se quiser, posso",
    "posso ajustar o texto",
    "qualquer duvida, estou",
    "como um modelo de linguagem",
    "como uma inteligencia artificial",
    "sou uma inteligencia artificial",
    "nao tenho opinioes pessoais",
    "here is the text",
    "here's the text",
    "as an ai language model",
    "hope this helps",
    "let me know if",
)

# Chat-template markers, in the two spellings that cannot be anything else. `<s>` and
# `</s>` are NOT here: they are valid HTML, and the pools carry generated answers with
# HTML samples in them.
_HARNESS_TOKEN_MARKERS: tuple[str, ...] = (
    "<|endoftext|>",
    "<|im_start|>",
    "<|im_end|>",
    "<|assistant|>",
    "<|user|>",
    "<|system|>",
    "[inst]",
    "[/inst]",
)

# The role marker of a chat template that leaked into the answer, as a TURN boundary.
# `user` and `system` are deliberately absent as bare words: measured, they match a
# robots.txt excerpt ("user-agent: *") and a .NET stack trace ("exception details:
# System.ArgumentOutOfRangeException").
#
# Matched against `fold_lines` under MULTILINE, so `^` is the start of ANY line and not of
# the text: the canonical shape of the leak is the marker ALONE on its own line, and the
# flat fold turns every newline into a space, which leaves that shape with no boundary in
# front of it. Measured over the pools, sentence punctuation alone reaches 24 of the 4.048
# generated rows and the line boundary reaches 146, with zero matches in 42.100 human rows.
_HARNESS_ROLE_TURN = r"(?:^|[.!?:]\s)assistant\b"
# Terminal control bytes. `common.normalize_text` collapses spaces and normalizes line
# ends and does not touch these, so an escape sequence a CLI wrote survives into the pool.
_HARNESS_CONTROL = r"[\x00-\x08\x0b\x0c\x0e-\x1f]"


@dataclass(frozen=True)
class GeneratedLine:
    """One generated stretch of one record, with the family and lane that produced it."""

    record_id: str
    family: str
    lane: str
    text: str


class LineNotAttributable(RuntimeError):
    """A generated record whose family or lane the gate cannot read.

    Fail-closed, and it stops the run rather than skipping the line: a family the gate
    cannot name is a family whose contamination fraction is not measured, and A4's whole
    output is a per-family fraction. The record builders make both axes `known` on every
    generated row, so reaching this means the projection and the builders disagree.
    """


class GeneratedRowCarriesNoGeneratedSpan(RuntimeError):
    """A controlled-generation record whose mixture declares no `origin: "ai"` stretch.

    Fail-closed for the same reason `LineNotAttributable` is: the row goes into training as
    controlled generation, and a row that projects to no line is a row out of its family's
    denominator — the gate would report a fraction over a smaller corpus than the one it was
    handed, and say nothing about the difference. `mixed_record` computes `aiFraction` from
    exactly these spans, so a row reaching here would also be a mixed row that is 0 % AI.
    """


class ArtifactContamination(RuntimeError):
    """A generator family is above the ceiling, so its lane is regenerated whole.

    Names every contaminated family with its count, its measured fraction and its lane,
    and names no line, for the reason in the module docstring. It also carries the report,
    because the message states the detection NAMES and the counts while the probes that
    matched — the actionable half — are in the report alone.
    """

    def __init__(self, message: str, report: dict) -> None:
        super().__init__(message)
        self.report = report


def _ai_spans(record: dict) -> list[str]:
    """The GENERATED stretches of a record, in offset order.

    A mixed record is a human text with generated stretches, and `mixture.spans` records
    which is which — so only the generated ones are scanned. Without that restriction the
    human half decides the verdict: measured, 14 of the 2.135 mixed rows on disk carry an
    assistant-voice closer inside the HUMAN span, because their parents are pt-BR forum
    answers and that is how forum answers end.

    A frame that exists only across the seam between a human and a generated span is not
    a generated artifact and is not looked for.
    """
    text = str(record.get("text") or "")
    mixture = record.get("mixture")
    if not mixture:
        return [text]
    spans = mixture.get("spans") or []
    return [
        text[int(span["start"]) : int(span["end"])]
        for span in spans
        if span.get("origin") == "ai"
    ]


def generated_lines(records: Iterable[dict]) -> list[GeneratedLine]:
    """Every generated stretch of every controlled-generation record.

    The class is read from `provenance.sourceKind` and not from `label`, because both the
    `ai` and the `mixed` class are controlled generation and both go into training. One
    `GeneratedLine` per generated stretch: a mixed record contributes as many lines as it
    has AI spans, and it is COUNTED once — the family's denominator is records, not spans,
    so a record with ten spans cannot outvote nine records with one.
    """
    out: list[GeneratedLine] = []
    for record in records:
        if record["provenance"]["sourceKind"] != "controlled-generation":
            continue
        groups = record.get("groups") or {}
        family = group_axes.identity_of(groups.get("generatorFamily"))
        lane = group_axes.identity_of(groups.get("generationLane"))
        if not family or not lane:
            raise LineNotAttributable(
                f"generated record {record.get('id')!r} carries generatorFamily="
                f"{family!r} and generationLane={lane!r}; the gate measures a fraction "
                "PER FAMILY and reports the lane to regenerate, so a row missing either "
                "cannot be counted and must not be skipped"
            )
        spans = _ai_spans(record)
        if not spans:
            raise GeneratedRowCarriesNoGeneratedSpan(
                f"generated record {record.get('id')!r} of the family {family!r} declares "
                f"{len(record['mixture'].get('spans') or [])} mixture span(s) and none of "
                "them is origin='ai', so it projects to no generated line. A row of a "
                "family the gate counts cannot leave the denominator silently: either it "
                "carries a generated stretch or it is not controlled generation"
            )
        for span in spans:
            out.append(
                GeneratedLine(
                    record_id=str(record["id"]), family=family, lane=lane, text=span
                )
            )
    return out


def detections_in(text: str) -> dict[str, list[str]]:
    """detection name -> the probes that matched, in canonical order.

    Empty when the text trips nothing. The probes are returned rather than a boolean
    because they ARE the diagnosis: "this family echoes the word-count directive" tells a
    lane owner what to change, and "3 lines contaminated" does not.
    """
    flat = fold(text)
    lined = fold_lines(text)
    found: dict[str, list[str]] = {}

    echoes = [
        label for label, pattern in ECHO_PROBES.items() if re.search(pattern, flat)
    ]
    if echoes:
        found[DETECTION_PROMPT_ECHO] = echoes

    refusals = [frame for frame in REFUSAL_FRAMES if frame in flat]
    if refusals:
        found[DETECTION_REFUSAL] = refusals

    meta = [frame for frame in METACONVERSATION_FRAMES if frame in flat]
    if meta:
        found[DETECTION_METACONVERSATION] = meta

    harness = [marker for marker in _HARNESS_TOKEN_MARKERS if marker in flat]
    harness += [
        marker
        for marker in generate_ai.GEMINI_AUTH_MARKERS
        if marker in flat
    ]
    harness += [
        f"line-prefix:{prefix}".casefold()
        for prefix in generate_ai.CLI_BANNER_PREFIXES
        if re.search(rf"^{re.escape(prefix.casefold())}", lined, re.MULTILINE)
    ]
    if re.search(_HARNESS_ROLE_TURN, lined, re.MULTILINE):
        harness.append("role-turn:assistant")
    if re.search(_HARNESS_CONTROL, text):
        harness.append("terminal-control-bytes")
    if harness:
        found[DETECTION_HARNESS_SIGNATURE] = sorted(harness)

    return {name: found[name] for name in DETECTION_NAMES if name in found}


def measure(lines: Iterable[GeneratedLine]) -> dict:
    """The gate's report: one entry per generator family, with its verdict.

    Counts RECORDS and not spans: a record trips a detection when any of its generated
    stretches does, so the fraction is "how many generated rows of this family carry an
    artifact" — the quantity A4's 2 % is written about.
    """
    families: dict[str, dict] = {}
    seen_records: dict[str, set[str]] = {}
    for line in lines:
        entry = families.setdefault(
            line.family,
            {
                "family": line.family,
                "lanes": set(),
                "lines": 0,
                "contaminated": 0,
                "byDetection": {},
            },
        )
        entry["lanes"].add(line.lane)
        records = seen_records.setdefault(line.family, set())
        first_span = line.record_id not in records
        records.add(line.record_id)
        if first_span:
            entry["lines"] += 1
        found = detections_in(line.text)
        if not found:
            continue
        already = entry.setdefault("_contaminated", set())
        if line.record_id not in already:
            already.add(line.record_id)
            entry["contaminated"] += 1
        for name, probes in found.items():
            slot = entry["byDetection"].setdefault(name, {"lines": 0, "probes": set()})
            if line.record_id not in slot.setdefault("_ids", set()):
                slot["_ids"].add(line.record_id)
                slot["lines"] += 1
            slot["probes"].update(probes)

    reported: list[dict] = []
    regenerate: set[str] = set()
    for family in sorted(families):
        entry = families[family]
        lines_count = entry["lines"]
        contaminated = entry["contaminated"]
        ratio = Fraction(contaminated, lines_count) if lines_count else Fraction(0)
        over = ratio > CONTAMINATION_CEILING
        if over:
            regenerate.update(entry["lanes"])
        reported.append(
            {
                "family": family,
                "lanes": sorted(entry["lanes"]),
                "lines": lines_count,
                "contaminated": contaminated,
                "fraction": float(ratio),
                "verdict": VERDICT_REGENERATE_LANE if over else VERDICT_CLEAR,
                "byDetection": {
                    name: {
                        "lines": entry["byDetection"][name]["lines"],
                        "probes": sorted(entry["byDetection"][name]["probes"]),
                    }
                    for name in DETECTION_NAMES
                    if name in entry["byDetection"]
                },
            }
        )
    return {
        "gate": "anti-artifact-pretraining",
        "rule": "A4",
        "ceiling": float(CONTAMINATION_CEILING),
        "ceilingSource": "constant:artifact_gate.CONTAMINATION_CEILING",
        "detections": list(DETECTION_NAMES),
        "families": reported,
        "lanesToRegenerate": sorted(regenerate),
    }


def _breach_sentence(entry: dict) -> str:
    """One family's breach, as the refusal states it: family, lane, count, fraction.

    The three quantities A4 requires plus the detections behind them. No line id: the
    refusal is what an operator acts on, and the action is to regenerate the lane.
    """
    detections = ", ".join(
        f"{name} {counts['lines']}" for name, counts in entry["byDetection"].items()
    )
    return (
        f"{entry['family']} on lane(s) {', '.join(entry['lanes'])}: "
        f"{entry['contaminated']}/{entry['lines']} = {entry['fraction'] * 100:.2f}% "
        f"({detections})"
    )


def assert_no_lane_needs_regeneration(report: dict) -> None:
    """Refuses the run when any family is over the ceiling, naming what A4 requires.

    The ONLY outcome besides passing. There is no parameter that prunes and continues,
    and the report the refusal carries names no line, so the pruning A4 forbids is not
    reachable from here.
    """
    over = [
        entry
        for entry in report["families"]
        if entry["verdict"] == VERDICT_REGENERATE_LANE
    ]
    if not over:
        return
    ceiling = report["ceiling"]
    breaches = "; ".join(_breach_sentence(entry) for entry in over)
    raise ArtifactContamination(
        f"anti-artifact gate: {len(over)} generator family(ies) above the "
        f"{ceiling * 100:.0f}% ceiling — {breaches}. A4: the whole lane is REGENERATED "
        f"({', '.join(report['lanesToRegenerate'])}). Dropping the contaminated lines is "
        "not the remedy — it leaves the lane's surviving lines selected by what the "
        "detector missed, and the corpus then carries that bias with no record of it",
        report,
    )
