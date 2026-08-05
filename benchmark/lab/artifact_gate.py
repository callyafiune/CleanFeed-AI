"""The pre-training anti-artifact gate (A4), over the generated rows of an assembly.

WHAT IT DECIDES. Ten detections, each named in the diagnosis it produces:

  * `prompt-echo` — the line repeats the instruction it was given;
  * `refusal` — the model declined the task instead of performing it;
  * `metaconversation` — the line talks ABOUT the task (delivers it, offers to revise
    it, identifies itself as a model) instead of being the text;
  * `harness-signature` — the mark of the binary or CLI that produced the line;
  * `spacing-anomaly` — whitespace the candidate writers' own normalization does not
    leave behind;
  * `encoding-corruption` — mojibake, double-encoded UTF-8, U+FFFD;
  * `invisible-character` — a code point that renders as nothing;
  * `markdown-formatting` — fences, list markers, asterisk emphasis, pipe tables;
  * `heading-line` — a title line, a label line, a section number;
  * `prompt-boilerplate` — the line reproduces the SHAPE of a template instruction
    instead of executing it.

A generator family above `CONTAMINATION_CEILING` sends its whole LANE back for
regeneration. Selective pruning is not an outcome this module can produce: it names no
line, so nothing downstream can drop the lines it counted. That is A4's rule and the
reason for it — dropping the contaminated lines of a lane leaves a lane whose surviving
lines are the ones the artifact detector missed, and the corpus then carries the lane's
bias with no record of it.

WHAT IT MEASURES IS NOT WHAT THE MODEL SEES, and the last six detections only make
sense read that way. `contracts/text-normalization.ts` neutralizes part of this before
tokenization — it removes the invisible code points of
`REMOVED_INVISIBLE_CHARACTERS`, folds every separator to U+0020/U+000A, and runs NFKC
per grapheme — so a detector trained on this corpus may never see a ZWSP or an NBSP at
all. The gate accuses them anyway, because the quantity it measures is LANE
CONTAMINATION: a lane that emits a mark at a rate the human class does not is a lane
that hands the label away for free, whatever the tokenizer later erases. Neutralization
downstream is not a reason to stop counting upstream, and A4's remedy is to regenerate
the lane, not to filter the character.

The counting is PER LINE and never per detection: a line that is both a prompt echo and
a heading is ONE contaminated line with two named reasons, which is what
`CONTAMINATION_CEILING` is a fraction of.

HOW THE SIX ADDED PROBES WERE CALIBRATED: measured over the pool candidates
on disk, and stated as the rate in the IN-FRAME human material (11.000 ptwiki rows)
beside the rate in the generated pools (19.673 `ai` rows, 2.135 mixed rows scanned on
their AI spans alone). The in-frame human rate is the one that decides, because the
célula the frame publishes is ptwiki and that is the negative class a free label would
be free against; the out-of-frame human pools (Stack Overflow markdown, B2W reviews)
were measured too and are reported in the register, not used to calibrate.

Two shapes were MEASURED AND REFUSED rather than added, and both are recorded where
they were rejected: a space before punctuation (`SPACING_PROBES`) and anchoring the
trailing-space probe to the end of the span instead of a newline (same place).

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
DETECTION_SPACING = "spacing-anomaly"
DETECTION_ENCODING = "encoding-corruption"
DETECTION_INVISIBLE = "invisible-character"
DETECTION_MARKDOWN = "markdown-formatting"
DETECTION_HEADING = "heading-line"
DETECTION_BOILERPLATE = "prompt-boilerplate"
# Canonical order, used by every report and message so two runs over one corpus produce
# the same bytes.
DETECTION_NAMES: tuple[str, ...] = (
    DETECTION_PROMPT_ECHO,
    DETECTION_REFUSAL,
    DETECTION_METACONVERSATION,
    DETECTION_HARNESS_SIGNATURE,
    DETECTION_SPACING,
    DETECTION_ENCODING,
    DETECTION_INVISIBLE,
    DETECTION_MARKDOWN,
    DETECTION_HEADING,
    DETECTION_BOILERPLATE,
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

# --- the six detections added by D13 ----------------------------------------
#
# Each probe below carries the rate it was MEASURED at, as
# `in-frame human / ai pools / mixed AI spans` over 11.000 ptwiki rows, 19.673 `ai`
# rows and 2.135 mixed rows. The in-frame human rate is the number that decides
# whether a probe may exist at all: above the 2 % ceiling on the human side, the probe
# would send lanes to regeneration for a shape the negative class carries.
#
# Every invisible code point is written as an escape and never as itself. A literal ZWSP
# in this file is a probe nobody can review and an editor can delete without a diff.

# Whitespace no candidate writer leaves behind. `common.normalize_text` collapses
# `[ \t]+` inside a line, strips each line and trims the text, and EVERY pool written
# through `CandidateWriter.offer` has run it — the human extractors, `generate_ai` and
# `import_public_corpus` alike. `make_mixed.emit` does NOT: it writes `text: edited`
# straight from the editor's output. That asymmetry is why these probes discriminate at
# all, and it is the measurement: 0 of 11.000 ptwiki rows and 0 of 19.673 `ai` rows
# carry a space run, against 185 of 2.135 mixed AI spans (8,67 %).
#
# A SPACE BEFORE PUNCTUATION IS NOT HERE, and that is measured, not an omission. It
# fires on 7,15 % of the in-frame human rows against 0,55 % of the generated ones — 13
# times more often on the class the label would be free against, and above the ceiling
# on the human side. A probe whose direction is inverted cannot be a contamination
# probe: it would regenerate lanes for a shape ptwiki writes.
#
# The trailing-space probe requires a real NEWLINE and never the end of the text. A
# mixed row's span is a SLICE of the text, so a span that ends in a space may just be
# where `mixture.spans` cut it. Measured, the end-of-text arm would have added 2 rows of
# 2.135 and both of them are a cut, while the newline arm finds 113.
SPACING_PROBES: dict[str, str] = {
    # 0 / 0 / 8,67 %
    "space-run": r"  +",
    # 0 / 0 / 0 — no measured occurrence; a tab inside a line is a shape no writer emits
    "tab-inside-line": r"\S\t",
    # 0 / 0 / 5,29 %
    "trailing-space-before-newline": r"[ \t]+\n",
}

# UTF-8 read as Latin-1 produces a lead of `Ã`/`Â` followed by a code point in
# U+0080-U+00BF, and doing it TWICE puts a C1 control there instead of a Latin-1
# punctuation character — which is what separates the two probes. The lead-plus-tail
# shape is required because `Ã` and `Â` are ordinary pt-BR capitals: `SÃO`, `MÃE` and
# `CÂMARA` all write one, and in every one of them the next character is an ASCII letter.
ENCODING_PROBES: dict[str, str] = {
    # 0 / 0 / 0 — the shape of a re-encoded mojibake, with no measured occurrence
    "double-encoded-utf8": r"[ÃÂ][\u0080-\u009f]",
    # 0 / 0,005 % / 0
    "mojibake-utf8-as-latin1": r"[ÃÂ][\u00a0-\u00bf]",
    # 0 / 0,04 % / 0
    "replacement-character": r"\ufffd",
}

# Code points that render as nothing. THE POINT OF THIS DETECTION is stated in the module
# docstring: `contracts/text-normalization.ts` removes most of these before tokenization,
# so the model may never see one, and the gate accuses them anyway because what it
# measures is the lane and not the model's input.
#
# EVERY ONE OF THESE PROBES RUNS INVERTED ON TODAY'S POOLS, and the numbers belong here
# rather than in a document because they are what the detection's value rests on: on the
# in-frame human material ZWSP reaches 0,38 %, the direction marks 0,12 % and the soft
# hyphen 0,05 %, against 0,02 % over the `ai` rows and 0,05 % over the mixed ones. In the
# ptwiki célula an invisible character is a HUMAN-side mark — it comes from the wiki
# source, and no extractor strips it — so this detection is a guard against a FUTURE
# harness that pads with one, not a description of what the lanes emit now. Each probe is
# far enough below the ceiling that keeping it costs nothing, and the whole detection is
# 0,59 % on ptwiki.
#
# The union of the ten detections over the in-frame human class must stay BELOW the
# ceiling, and that is a calibration rule and not a coincidence: a lane refused for being
# as clean as the negative class is a gate refusing lanes for being human-like. A bare
# NBSP probe broke it (see `no-break-space-run`) and is the reason the rule is written
# down.
#
# The ZWJ probe requires an ALPHANUMERIC neighbour. A ZWJ between two pictographs is the
# joiner of an emoji sequence — `text-normalization.ts` keeps exactly those, for a
# measured reason — and 158 of the 19.673 `ai` rows carry one, none of them inside a
# word. What splits a token is the ZWJ in a word, and that is 0 everywhere measured.
#
# THIS TABLE COVERS EVERY CODE POINT `REMOVED_INVISIBLE_CHARACTERS` REMOVES, and a test
# asserts the two sets are the same one. The coupling is not incidental: the contract's set
# is "invisible code points removed unconditionally" and this detection's subject is "a code
# point that renders as nothing", so a code point the inference path has to strip is by
# construction a code point a lane can pad with. One added there and not here would be
# erased before the model and never counted against the lane — the exact hole this
# detection exists to close — so the difference is refused and the fix is a probe here.
INVISIBLE_PROBES: dict[str, str] = {
    # 0 / 0 / 0
    "byte-order-mark": r"\ufeff",
    # 0 / 0 / 0, and 1 of the 31.100 out-of-frame human rows — U+034F, whose only
    # standardized use is forcing a grapheme boundary that renders as nothing
    "combining-grapheme-joiner": r"\u034f",
    # 0,12 % / 0 / 0 — LRM, RLM, ALM, the embedding/override run and the isolate run
    "direction-mark": r"[\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]",
    # 0 / 0 / 0 — the Hangul fillers. U+3164 and U+FFA0 fold to U+1160 under NFKC, so
    # the four are one shape: a syllable block with no glyph, in a pt-BR corpus
    "hangul-filler": r"[\u115f\u1160\u3164\uffa0]",
    # 0 / 0 / 0 — U+2061 to U+2064, the invisible math operators
    "invisible-operator": r"[\u2061-\u2064]",
    # 0 / 0 / 0 — U+180E, reclassified from space to format in Unicode 6.3.0, which is
    # why no whitespace probe reaches it
    "mongolian-vowel-separator": r"\u180e",
    # 0,04 % / 0 / 0 — the RUN and not a bare NBSP. Bare, it is 1,45 % of the in-frame
    # human rows against 0,005 % of the generated ones: inverted, and on its own it put
    # the whole line-level union over the in-frame human class at 2,18 % — ABOVE the
    # ceiling, which would mean refusing a lane for being as clean as the negative class.
    # A typographic NBSP does not repeat — it is the one between a number and its unit,
    # and pt Wikipedia writes exactly one of them. Padding repeats.
    "no-break-space-run": r"\u00a0\u00a0+",
    # 0,05 % / 0,005 % / 0
    "soft-hyphen": r"\u00ad",
    # 0 / 0 / 0
    "word-joiner": r"\u2060",
    # 0 / 0 / 0 (a bare ZWJ: 0 / 0,80 % / 0, all of it emoji)
    "zero-width-joiner-in-word": r"(?:\w\u200d|\u200d\w)",
    # 0,02 % / 0 / 0
    "zero-width-non-joiner": r"\u200c",
    # 0,38 % / 0,02 % / 0,05 %
    "zero-width-space": r"\u200b",
}

# Markdown, matched against `fold_lines` because four of the five shapes are anchored to
# the start of a line. This is the highest-yield detection of the six by an order of
# magnitude: 0,11 % of the in-frame human rows against 44,72 % of the `ai` rows.
#
# ORDERED numbering is NOT here — it is `heading-line`'s `section-numbering`. `1. ` is
# the same syntax in both readings, and in generated pt-BR prose it is a section number
# far more often than a Markdown ordered list; one home keeps the diagnosis a lane owner
# reads unambiguous.
#
# The pipe-table probe demands the SEPARATOR row or two consecutive rows with two pipes
# each. A single line with two pipes reaches 0,10 % of the in-frame human rows (pt
# Wikipedia writes table syntax) against 0,49 % of the generated ones, which is too
# little separation to act on; the stricter shape is 0 against 0,40 %.
MARKDOWN_PROBES: dict[str, str] = {
    # 0 / 0,46 % / 0,05 %
    "code-fence": r"^(?:```|~~~)",
    # 0 / 39,74 % / 0,23 %
    "emphasis-double-asterisk": r"\*\*[^*\n]+\*\*",
    # 0,05 % / 17,09 % / 3,75 %
    "emphasis-single-asterisk": r"(?<![*\w])\*[^*\n]+\*(?!\w)",
    # 0,06 % / 22,06 % / 3,28 %
    "list-marker": r"^[-*+•] \S",
    # 0 / 0,40 % / 0
    "pipe-table": (
        r"(?:^\|? *:?-{3,}:? *\|)"
        r"|(?:^[^\n|]*\|[^\n|]*\|[^\n]*\n[^\n|]*\|[^\n|]*\|)"
    ),
}

# A title line. Matched against `fold_lines`, which strips accents, so `Título:` reaches
# the probe as `titulo:` and the list carries one spelling of each word.
#
# `colon-terminated-short-line` — any short line ending in a colon — was measured and
# REFUSED: 1,63 % of the in-frame human rows and 33,18 % of the out-of-frame ones. It is
# the shape of a colon, not of a heading.
HEADING_PROBES: dict[str, str] = {
    # 0 / 6,70 % / 0
    "atx-heading": r"^#{1,6} +\S",
    # 0,01 % / 3,60 % / 0
    "label-line": (
        r"^(?:titulo|resposta|texto|saida|resultado|introducao|conclusao|resumo) *:"
    ),
    # 0,05 % / 12,84 % / 1,55 %
    "section-numbering": r"^\d+(?:\.\d+)*[.)] +\S",
    # 0 / 0,005 % / 0
    "setext-underline": r"^={3,} *$",
}

# The line reproduces the SHAPE of a template instruction instead of executing it. This
# is where `prompt-echo` cannot reach, and the difference is the anchor and not the
# wording: `prompt-echo` is derived from this repository's own generator constants plus
# the third-party directives measured in the pools, so it can only ever find a prompt
# somebody here or in `madras` issued. These frames are the shape of an instruction — a
# second-person directive whose object is the artifact being asked for, a role
# assignment, a reference to the prompt's own material — and they are what catch a lane
# whose upstream prompt this repository never sees.
#
# A line can trip both, and then it is ONE contaminated line with two named reasons.
_ARTIFACT_NOUNS = r"(?:texto|artigo|redacao|paragrafo|post|resenha|conteudo)"
BOILERPLATE_PROBES: dict[str, str] = {
    # 0 / 0,005 % / 0 — the ROLE nouns are required: a bare "atue como" is a verb of
    # ordinary prose ("atue como mediador") and reached 2 in-frame human rows
    "assume-a-role": (
        r"(?:(?:atue|aja) como (?:um|uma) (?:especialista|assistente|jornalista"
        r"|redator|redatora|escritor|escritora|editor|editora|professor|professora)"
        r"|voce e (?:um|uma) (?:assistente|especialista|redator|redatora))"
    ),
    # 0 / 0,08 % / 0
    "follow-the-instructions": r"(?:siga|seguindo) as instrucoes",
    # 0 / 0,05 % / 0
    "keep-the-tone": r"mantenha (?:o mesmo |a mesma )?(?:tom|estilo|registro|linguagem)",
    # 0 / 0 / 0
    "no-heading-directive": (
        r"(?:sem incluir|nao inclua|nao coloque|sem colocar) (?:titulo|titulos|cabecalho)"
    ),
    # 0 / 0 / 0
    "reference-the-prompt-material": (
        r"com base no (?:texto|trecho|conteudo) (?:acima|abaixo|a seguir)"
    ),
    # 0 / 0,01 % / 0 — `no formato` alone was refused: 0,20 % of the in-frame human rows
    "requested-format": r"(?:formato solicitado|conforme o formato solicitado)",
    # 0 / 0,005 % / 0
    "rewrite-the-artifact": r"reescreva (?:o|a|este|esta|esse|essa) ",
    # 0,05 % / 2,99 % / 0,05 % — the highest-yield frame of the six, and the in-frame
    # human hits are pt Wikipedia articles ABOUT the language
    "target-language": r"em portugues (?:brasileiro|do brasil)",
    # 0 / 0 / 0 — the compound is refused for the reason in `_PALAVRAS_NOT_COMPOUNDED`
    "word-budget": (
        r"(?:no maximo|no minimo|ate|limite de) \d+ " + _PALAVRAS_NOT_COMPOUNDED
    ),
    # 0 / 0,005 % / 0
    "write-the-artifact": (
        r"(?:escreva|gere|produza|crie|elabore|redija) (?:um|uma) " + _ARTIFACT_NOUNS
    ),
}

# Which comparison form each probe table reads. The RAW text is a subject in its own
# right and not an oversight: `fold` collapses every whitespace run and `fold_lines`
# strips each line, so a probe for a space run or a trailing space against either of them
# can never match. It is the same reason `_HARNESS_CONTROL` reads the raw text.
_SUBJECT_RAW = "raw"
_SUBJECT_LINED = "lined"
_SUBJECT_FLAT = "flat"


def _compiled(probes: dict[str, str]) -> tuple[tuple[str, re.Pattern[str]], ...]:
    """label -> compiled probe, in LABEL order.

    Sorted rather than in declaration order, so the probe list a report publishes does
    not depend on how the table above happens to be typed.
    """
    return tuple(
        (label, re.compile(probes[label], re.MULTILINE)) for label in sorted(probes)
    )


_ADDED_PROBES: tuple[tuple[str, tuple[tuple[str, re.Pattern[str]], ...], str], ...] = (
    (DETECTION_SPACING, _compiled(SPACING_PROBES), _SUBJECT_RAW),
    (DETECTION_ENCODING, _compiled(ENCODING_PROBES), _SUBJECT_RAW),
    (DETECTION_INVISIBLE, _compiled(INVISIBLE_PROBES), _SUBJECT_RAW),
    (DETECTION_MARKDOWN, _compiled(MARKDOWN_PROBES), _SUBJECT_LINED),
    (DETECTION_HEADING, _compiled(HEADING_PROBES), _SUBJECT_LINED),
    (DETECTION_BOILERPLATE, _compiled(BOILERPLATE_PROBES), _SUBJECT_FLAT),
)


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

    subjects = {_SUBJECT_RAW: text, _SUBJECT_LINED: lined, _SUBJECT_FLAT: flat}
    for detection, probes, subject in _ADDED_PROBES:
        matched = [
            label for label, pattern in probes if pattern.search(subjects[subject])
        ]
        if matched:
            found[detection] = matched

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
